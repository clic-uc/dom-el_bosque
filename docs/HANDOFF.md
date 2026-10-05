# Handoff — estado de la reconstrucción de SIGDOM El Bosque

Última actualización: 2026-10-05.

## Cómo retomar

1. Leer `../sigdom legacy/PROMPT.md` (especificación), `docs/DECISIONS.md` (desviaciones) y `CLAUDE.md` (convenciones).
2. Entorno: `docker compose up -d db` (PostGIS en 5432). La BD `sigdom` está migrada, con seed de 15 capas, polígonos (1 comuna, 7 sectores, 240 villas) y el padrón de 42.628 roles. Usuarios de prueba: `admin@sigdom.test` / `AdminPrueba2026!`; e2e: `admin|editor|viewer|temporal@e2e.test` / `Sigdom-e2e-2026!`.
3. `pnpm dev` (puerto 3000) + `pnpm worker` en otra terminal. El hook `predev` copia el worker de MapLibre a `public/`.
4. Verificación global: `pnpm typecheck && pnpm lint && pnpm knip && DATABASE_URL=postgres://postgres:password@localhost:5432/sigdom_test pnpm test`.
5. e2e: `E2E_BASE_URL=http://localhost:3000 pnpm test:e2e` (con la app levantada).

## Estado por fase (PROMPT.md §13)

| Fase | Estado |
|---|---|
| 0 Bootstrap | ✅ |
| 1 Base de datos | ✅ (3 migraciones; `drizzle-kit check` sin drift; seed/geo idempotentes; padrón 42k en 8 s) |
| 2 Auth y shell | ✅ (verificado por HTTP y e2e) |
| 3 Capas | ✅ (23 tests de servicio + 3 UI) |
| 4–6 Registros, mapa, roles, operaciones, correlativos, geocodificación | ✅ (98 tests de reglas de negocio + 7 de autorización; UI del mapa con 24 tests) |
| 7 Importación en dos fases | ✅ (33 tests; 10k filas: análisis 1,7 s, confirmación 2,9 s; smoke real con worker) |
| 8–9 Administración, auditoría, polígonos, adjuntos, mapas de calor | ✅ (16 tests de servicio + 7 UI) |
| 10 Manual | ✅ (24 páginas MDX; 3 redactadas completas, 21 en borrador con esquema) |
| 11 Producción | ✅ Dockerfile, compose prod + Caddy, CI, backups, DEPLOY/API.md, e2e (17 pasan, 1 fixme). Ver pendientes. |

Totales: 250 tests de Vitest en verde (31 archivos), 17 e2e, typecheck/lint/knip limpios, `pnpm build` OK.

## Pendientes conocidos

- [ ] Smoke de la pila de producción completa (`docker compose --env-file .env.production -f docker-compose.prod.yml up -d` con `SITE_ADDRESS=localhost` + `scripts/smoke.sh`). El build de la imagen se validó tras corregir `storage.ts`; el `up` completo no se ejecutó en esta sesión.
- [ ] e2e marcado `fixme`: "respeta ?next= tras ingresar" (el arreglo en `SignInForm` ya está; quitar el `test.fixme` y verificar).
- [ ] Índice trigram opcional sobre `attributes::text` si la búsqueda libre con 40k registros (≈0,7 s) resulta lenta en uso real (§7.3).
- [ ] Redacción final de las 21 páginas del manual en borrador (requiere validar ejemplos con la DOM).
- [ ] `uniqueKeys` de las capas: el seed las deja vacías a propósito (§11); la DOM las configura desde la UI guiada por `capas/campos-unicos`.
- [ ] Lighthouse accesibilidad ≥ 90 en `/map` (no medido).

## Convenciones a mantener

Ver `CLAUDE.md`. Resumen: español de Chile y UX para baja habilidad digital; `withActor` + Zod en rutas; errores `AppError`; tipos desde `src/shared/types.ts`; toda mutación audita; esquema Drizzle como única fuente de verdad.
