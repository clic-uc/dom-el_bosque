# SIGDOM El Bosque

Plataforma de georreferenciación de la Dirección de Obras Municipales (DOM) de la Municipalidad de El Bosque. Monolito Next.js (App Router) + PostgreSQL/PostGIS + MapLibre, con un proceso *worker* para tareas largas (importaciones, geocodificación).

La especificación completa está en `../sigdom legacy/PROMPT.md`; las desviaciones se registran en [docs/DECISIONS.md](docs/DECISIONS.md).

## Requisitos

- Node.js ≥ 22.12 y pnpm 10 (`corepack enable`)
- Docker (para la base de datos PostGIS en desarrollo)

## Levantar en desarrollo

```bash
cp .env.example .env            # completar BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm install
docker compose up -d db         # PostgreSQL 17 + PostGIS 3.5 en localhost:5432
pnpm db:migrate                 # aplica las migraciones de drizzle/
pnpm db:seed                    # crea las 15 capas iniciales (idempotente)
pnpm geo:import                 # carga los polígonos de data/geo/ (idempotente)
pnpm roles:import ruta/roles.csv   # padrón de roles (no se versiona)
pnpm auth:create-admin --email admin@municipalidad.cl --name "Administrador"
pnpm dev                        # http://localhost:3000
pnpm worker                     # en otra terminal: cola de tareas (pg-boss)
```

## Scripts

| Script | Qué hace |
|---|---|
| `pnpm dev` / `pnpm worker` | app Next y worker de tareas |
| `pnpm build` / `pnpm start` | build standalone y arranque en producción |
| `pnpm typecheck` / `pnpm lint` / `pnpm knip` | tipos, lint, código y dependencias sin uso |
| `pnpm test` / `pnpm test:e2e` | Vitest / Playwright |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:check` | migraciones Drizzle |
| `pnpm db:seed` / `pnpm geo:import` / `pnpm roles:import` | datos iniciales |
| `pnpm auth:create-admin` | primer usuario administrador |

## Estructura

Ver la sección 4 de `PROMPT.md`. Resumen: `app/` (rutas y API), `src/db` (esquema Drizzle), `src/server` (servicios, auth, importación, geocodificación, jobs), `src/shared` (Zod, tipos y constantes compartidas con el cliente), `src/features` (UI por funcionalidad), `content/help` (manual en MDX), `scripts/` (CLI), `data/geo` (polígonos versionados).

## Despliegue

Ver [docs/DEPLOY.md](docs/DEPLOY.md).
