# syntax=docker/dockerfile:1.7
#
# SIGDOM El Bosque — imagen única para `app` (Next standalone) y `worker` (pg-boss) (§12.2).
#
#   docker build --target runner -t sigdom .
#   docker compose -f docker-compose.prod.yml up -d --build
#
# Etapas: base (node + pnpm fijado) → deps (pnpm install) → build (next build + scripts CLI) → runner.

# ---------------------------------------------------------------------------
# base: Node 22 + pnpm en la versión exacta de `packageManager` (package.json)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    CI=1
# libc6-compat: binarios nativos (sharp, @tailwindcss/oxide) en Alpine.
RUN apk add --no-cache libc6-compat
WORKDIR /app
COPY package.json ./
# corepack instala exactamente la versión declarada en "packageManager".
RUN corepack enable \
 && corepack prepare "$(node -p "require('./package.json').packageManager")" --activate \
 && pnpm --version

# ---------------------------------------------------------------------------
# deps: dependencias con lockfile congelado (cacheable por capa)
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# build: next build (output standalone) + scripts CLI empaquetados con esbuild
# ---------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Variables públicas: Next las inserta en el bundle del navegador en tiempo de build.
# docker-compose.prod.yml las pasa como build args desde .env.production.
ARG NEXT_PUBLIC_APP_URL=https://sigdomelbosque.cl
ARG NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_MAP_STYLE_URL=$NEXT_PUBLIC_MAP_STYLE_URL \
    NODE_ENV=production

# Durante el build no hay base de datos ni secretos: se omite la validación de env.ts.
# Los valores reales llegan en runtime desde .env.production.
RUN SKIP_ENV_VALIDATION=1 \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    BETTER_AUTH_SECRET=build-only-secret-not-used-at-runtime-0000 \
    BETTER_AUTH_URL=$NEXT_PUBLIC_APP_URL \
    pnpm build \
 && pnpm build:scripts

# ---------------------------------------------------------------------------
# runner: imagen final mínima, usuario no root, dumb-init como PID 1
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runner
RUN apk add --no-cache dumb-init libc6-compat wget \
 && addgroup -S -g 1001 nodejs \
 && adduser -S -u 1001 -G nodejs nextjs \
 && mkdir -p /app /data/storage \
 && chown -R nextjs:nodejs /app /data/storage

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    STORAGE_DIR=/data/storage

# Servidor standalone (server.js + node_modules trazados + .next/server)
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
# Contenido y datos que leen los scripts y la app en runtime
COPY --from=build --chown=nextjs:nodejs /app/content ./content
COPY --from=build --chown=nextjs:nodejs /app/data/geo ./data/geo
COPY --from=build --chown=nextjs:nodejs /app/drizzle ./drizzle
# Scripts CLI empaquetados: node scripts/{migrate,seed,geo-import,import-roles,create-admin,worker}.js
COPY --from=build --chown=nextjs:nodejs /app/dist-scripts ./scripts
COPY --chown=nextjs:nodejs entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000

# El worker no expone HTTP: docker-compose.prod.yml desactiva este healthcheck en ese servicio.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1

ENTRYPOINT ["dumb-init", "--"]
# app: migraciones + servidor. worker: `command: ["node", "scripts/worker.js"]`.
CMD ["./entrypoint.sh"]
