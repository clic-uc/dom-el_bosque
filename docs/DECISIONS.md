# Decisiones de diseño

Registro de toda desviación o precisión respecto de `PROMPT.md`. Formato: fecha, decisión, motivo.

## Principio transversal: UX para usuarios con baja habilidad digital

**2026-10-04.** Indicación explícita del equipo: toda decisión de diseño debe privilegiar la experiencia de uso, porque los funcionarios que usarán la plataforma en general tienen baja habilidad digital. Reglas que se aplican en toda la UI:

- Español de Chile, sin jerga técnica. Los mensajes dicen qué pasó y qué hacer a continuación ("No se pudo guardar. Revisa el campo N° Permiso e intenta de nuevo").
- Etiquetas siempre visibles (nunca solo *placeholder*), tipografía base 16 px, controles de al menos 44 px de alto, foco visible.
- Una acción principal por pantalla o diálogo; las secundarias se ven como secundarias.
- Las confirmaciones explican la consecuencia concreta ("Se eliminarán los valores de 120 registros") y usan verbos en el botón ("Eliminar capa", no "Aceptar").
- Entradas tolerantes: rol con o sin ceros, fechas `dd-mm-aaaa` o `dd/mm/aaaa`, números con coma o punto, coordenadas con separadores de miles.
- Valores por defecto sensatos para que el flujo común no exija configurar nada; las opciones avanzadas quedan plegadas.
- `HelpLink` contextual junto a cada concepto no obvio (campos únicos, correlativos, coordenadas del rol).
- Estados vacíos y de carga con texto explicativo, nunca una pantalla en blanco.

## Stack y versiones

**2026-10-04 — Next.js 16 en lugar de 15.** El prompt dice "Next.js 15+". Al iniciar, la versión estable es 16.3, que se adopta. Consecuencia: el archivo `middleware.ts` pasa a llamarse `proxy.ts` (export `proxy`), que es el nombre que usa Next 16; la lógica es la misma que describe la sección 6.1.

**2026-10-04 — TypeScript fijado en 5.9.** La versión 7.x (port nativo) todavía no es compatible con `typescript-eslint` (acepta `<6.1`). Se fija `~5.9.3`.

**2026-10-04 — TanStack Table v8.** Existe v9 pero el prompt especifica v8 y la API cambió; se mantiene v8.

**2026-10-04 — ESLint 9.** Se fija ESLint 9 (flat config) para asegurar compatibilidad con `eslint-config-next` 16 y `typescript-eslint`.

**2026-10-04 — Sin `dotenv`.** Node ≥ 22 trae `process.loadEnvFile()`; se usa en `drizzle.config.ts`, scripts CLI y tests. Una dependencia menos.

**2026-10-04 — `radix-ui` unificado.** shadcn/ui actual instala el paquete `radix-ui` (un solo paquete) en lugar de `@radix-ui/react-*` individuales.

**2026-10-04 — Scripts CLI en Docker.** Los scripts de `scripts/*.ts` se empaquetan con `esbuild` a `dist-scripts/*.js` en la etapa `build` del Dockerfile y se copian al `runner` como `scripts/*.js` (el prompt dice "compilados con tsx"; `tsx` ejecuta, no compila, y no se quiere en la imagen final).

**2026-10-04 — Tests con base de datos real.** Los tests de servicios que tocan la BD corren contra la misma PostGIS de `docker compose` usando una base `sigdom_test` (variable `DATABASE_URL` en `.env.test`), con `TRUNCATE` entre tests. Es más fiel que mockear Drizzle y las reglas espaciales/JSONB se prueban de verdad.

## Fases 0–2

**2026-10-05 — Grupos de rutas para el cambio obligatorio de contraseña.** `app/(app)/layout.tsx` exige sesión; `app/(app)/(main)/layout.tsx` además redirige a `/account/password` mientras `must_change_password` sea `true`. Así la página de cambio de contraseña queda dentro del shell autenticado sin excepciones por ruta.

**2026-10-05 — Endpoint `POST /api/account/password-changed`.** Better Auth no expone un hook simple sobre `changePassword` para apagar `must_change_password`; tras el cambio exitoso el cliente llama a este endpoint (único que acepta sesión con contraseña temporal) y luego el shell revalida. Es idempotente e inocuo si se llama de más.

**2026-10-05 — `getFeatures` siempre incluye los 3 primeros campos.** El prompt lo plantea solo "para capas grandes"; incluirlos siempre simplifica el hover y el tamaño extra es marginal. El detalle completo sigue cargándose por id.

**2026-10-05 — Comparación de identidades en SQL aproximada, verificación en JS.** La normalización de §8.4 (acentos, espacios, minúsculas) se replica en SQL con `translate/regexp_replace/lower/trim` para preseleccionar candidatos y se verifica en JS con `normalizeText` (que usa NFD). Para la importación masiva se carga un índice en memoria de identidades de la capa (40k filas caben sin problema).

**2026-10-05 — Correlativos: `maxExisting` solo cuenta valores JSON numéricos.** Un correlativo histórico importado como texto no se considera; la conversión a `autonumber` (§7.2) exige enteros y los deja como números, así que en la práctica no ocurre.

**2026-10-05 — Datos de prueba e2e.** Los tests de servicios corren contra bases `sigdom_test*` reales; cada área usa su propia base para poder ejecutarse en paralelo. Las pruebas del geocodificador externo usan proveedores falsos (`createGeocoder({ overrides })`).

**2026-10-05 — `exceljs` como devDependency.** Solo para generar fixtures `.xlsx` en los tests de importación (la lectura en producción sigue siendo `read-excel-file`).
