@AGENTS.md

# SIGDOM El Bosque — guía para agentes

Plataforma de georreferenciación de la DOM de El Bosque. Monolito Next.js 16 (App Router) + PostgreSQL/PostGIS + MapLibre, con un worker pg-boss. La especificación es `../sigdom legacy/PROMPT.md`; las desviaciones se registran en `docs/DECISIONS.md`; el estado del proyecto en `docs/HANDOFF.md`.

## Principio rector
Los usuarios son funcionarios con baja habilidad digital. Toda decisión de UI privilegia claridad: español de Chile sin jerga, etiquetas visibles, controles ≥44 px, confirmaciones que explican la consecuencia con verbo en el botón, mensajes que dicen qué pasó y qué hacer, `HelpLink` junto a conceptos no obvios. Nunca `alert`/`confirm`/`console.log` en `src/`.

## Comandos
- `docker compose up -d db` · `pnpm dev` · `pnpm worker`
- `pnpm typecheck && pnpm lint && pnpm test && pnpm knip` antes de dar algo por terminado
- Tests de BD: `DATABASE_URL=postgres://postgres:password@localhost:5432/sigdom_test pnpm vitest run <ruta>` (bases `sigdom_test*` ya migradas; `pnpm db:migrate` con esa `DATABASE_URL` tras cambiar el esquema)
- e2e: `pnpm e2e:seed --temp` una vez, luego `E2E_BASE_URL=http://localhost:3000 pnpm test:e2e`
- Esquema: editar `src/db/schema/*`, `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:check`

## Convenciones
- Route Handlers: `withActor` + Zod de `src/shared/schemas` (`src/server/http.ts`); errores con `AppError` (`src/server/errors.ts`), nunca `throw new Error` hacia el cliente.
- Servicios en `src/server/services/*` reciben `(db | tx, actor, input)`; toda mutación audita en la misma transacción.
- Tipos compartidos solo desde `src/shared/types.ts`; claves de TanStack Query en `src/lib/query-keys.ts`; `api()` de `src/lib/api.ts` para fetch.
- Reglas de negocio con tests: coordenadas (§8.3), duplicados (§8.4), importación (§8.5), correlativos (§8.8), operaciones de rol (§8.9).
- `map` solo nombra la visualización MapLibre; la entidad temática es `layer` / "capa".
