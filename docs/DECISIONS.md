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

**2026-10-15 — Los registros numerados se protegen en todos los caminos que los borran o les quitan el número.** La regla de `deleteRecord` (§8.8: solo un administrador, con motivo) ahora rige también al eliminar una capa, al quitar su correlativo (eliminarlo, cambiarle el tipo o, en el anual, eliminar el campo de año) y al revertir una importación que quitaría números. Un editor recibe `403`. Un administrador sin motivo recibe `400 VALIDATION` con `details: { reasonRequired: true, count }`: la UI pide el motivo y reenvía, sin un código de error nuevo. Los registros afectados se leen con `FOR UPDATE`, y su número (y año) queda en `metadata.numberedRecords` de la auditoría junto al motivo. Quitar el correlativo conserva `number_assigned_at`, así que esos registros siguen pidiendo administrador para borrarse. Revertir desde el historial de la capa no tiene dónde pedir el motivo: el aviso indica hacerlo desde Administración. El reemplazo completo no tiene camino con motivo: al confirmar vuelve a leer los marcados con `FOR UPDATE`, conserva los que entretanto recibieron correlativo o adjuntos (`resolution = 'keep'`, `deletable = false`) y los cuenta en `keptProtected` del log `IMPORT`. `LayerWithCount` suma `numberedRecordCount` para que la UI avise antes de intentarlo.

**2026-10-05 — Datos de prueba e2e.** Los tests de servicios corren contra bases `sigdom_test*` reales; cada área usa su propia base para poder ejecutarse en paralelo. Las pruebas del geocodificador externo usan proveedores falsos (`createGeocoder({ overrides })`).

**2026-10-05 — `exceljs` como devDependency.** Solo para generar fixtures `.xlsx` en los tests de importación (la lectura en producción sigue siendo `read-excel-file`).

## Fase 3 — Capas

**2026-10-05 — Clave interna siempre derivada del nombre.** La `key` de un campo se genera con `toFieldKey` + sufijo único y nunca se edita a mano (para usuarios no técnicos es un detalle; se muestra en texto pequeño). En edición, "Cambiar también la clave interna" solo aparece si el nombre nuevo daría otra clave, y explica cuántos registros se moverán.

**2026-10-05 — Orden de campos con Subir/Bajar y campos únicos como casillas.** En vez de arrastrar y soltar o combobox multi-selección: más accesible y claro para el público objetivo.

**2026-10-05 — Rol SII activado por defecto al crear una capa.** La mayoría de las capas de la DOM lo usan.

**2026-10-05 — Formularios que se montan al abrir y se desmontan al cerrar** (`key` por capa/modo) en vez de `form.reset` en efectos: cumple las reglas del React Compiler y parte siempre del dato actual. Se aplica en LayerFormDialog, IconPicker, CreateRecordDialog, CoordinateUpdateDialog y FiltersPanel.

**2026-10-05 — Cambio de tipo de campo.** Sin valores guardados no pide confirmación; con valores exige revisar la vista previa y marcar la confirmación; a correlativo con valores no enteros queda bloqueado mostrando ejemplos.

**2026-10-05 — Bugs de fundación corregidos.** (1) `listLayers` calculaba `recordCount` con una subconsulta sin alias (Drizzle no califica columnas en selects de una sola tabla y `"id"` resolvía a `records.id`). (2) Las migraciones JSONB de §7.2 fallaban por parámetros sin tipo en `jsonb_build_object($n, …)`: se agregó `::text`. (3) El `before` de auditoría de `setNextNumber` era incorrecto. El mismo problema de alias se corrigió en `users.listUsers`.

**2026-10-05 — Tests de servicios no paralelos por archivo.** `vitest.config.mts` fija `fileParallelism: false` en el proyecto `node`: los archivos comparten BD y hacen TRUNCATE. Además, los tests de capas se serializan con `pg_advisory_lock`.

## Fases 4–6 — UI del mapa

**2026-10-05 — Paneles derechos dentro del layout, no en portal.** RecordSidePanel, RoleSheet, PolygonSidePanel y FiltersPanel usan un shell propio (`SidePanel`, `role="dialog"` no modal) como columna junto al mapa: el mapa se encoge y sigue recibiendo clics, el panel no tapa la toolbar y se evitan los problemas de Radix con diálogos no modales. El `Sheet` de Radix se usa solo para el sidebar en pantallas < 1024 px. Un panel derecho a la vez (registro | rol | polígono); el de filtros puede coexistir.

**2026-10-05 — El mapa permanece montado en vista tabla** (`display: none`) para no perder imágenes de marcador, vista ni fuentes.

**2026-10-05 — Orden de dibujo con capas ancla y `beforeId`** (polígonos → calor → superpuestas → trabajo → selección) para que las fuentes cargadas de forma perezosa se inserten en su lugar.

**2026-10-05 — Filtros de ubicación y correlativo en la URL** como `loc=none|approx` y `num=with|without` (el prompt solo define `f[...]`). En vista mapa el texto de búsqueda no se escribe en la URL (§8.6); en vista tabla sí (`q`).

**2026-10-05 — Mapa de calor.** `wMax` = percentil 95; sin selección explícita se incluyen todas las capas visibles (en modo Valor, las que tienen campo numérico). Radio, intensidad y "Mostrar puntos" son estado local.

**2026-10-05 — Estilo de respaldo del mapa.** Si `NEXT_PUBLIC_MAP_STYLE_URL` no está definido, raster OSM con glyphs de OpenFreeMap.

## Fases 8–9 — Administración, polígonos y adjuntos

**2026-10-05 — Headers de admin para Better Auth.** Los Route Handlers pasan `req.headers` al servicio y este llama `auth.api.setRole/setUserPassword/revokeUserSessions/removeUser({ body, headers })`; `createUser` se llama sin headers (el rol lo verificó `withActor`). Los `APIError` de Better Auth se traducen a errores de dominio en español.

**2026-10-05 — Un admin no puede asignarse contraseña temporal desde el panel** (le cerraría la sesión): usa "Mi cuenta". Cambios de rol con confirmación solo para "Nombrar administrador" y "Quitar rol"; rol por defecto "Visor" al crear usuarios.

**2026-10-05 — `getPolygonStats` incluye polígonos con 0 registros** (LEFT JOIN, al final) para que coropletas y paneles tengan la lista completa. ETag de polígonos `W/"polygons-<kind>-<count>-<max(updated_at)>"`.

**2026-10-05 — Límite de adjuntos en cliente** con el valor por defecto (20 MB) y los tipos de `constants.ts`; la validación real es del servidor.

## Fase 10 — Manual

**2026-10-05 — `meta` duplicado en `registry.ts` y en cada MDX.** El índice y la navegación leen el registro para no cargar 24 módulos por vista; un test garantiza que coincidan. `mdx-components.tsx` en la raíz, sin `@tailwindcss/typography`. Tres páginas redactadas completas (primeros-pasos, registros/asignar-numero, capas/campos-unicos); el resto en borrador con esquema.

## Fase 11 — Producción

**2026-10-05 — Scripts CLI en CommonJS con esbuild;** `next`, `next/*`, `pg-native` y `pino-pretty` externos. `NEXT_PUBLIC_*` se fijan como build args del Dockerfile; el comando canónico es `docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build`. `name: sigdom` en el compose para volúmenes predecibles.

**2026-10-05 — Restore recrea la base** (DROP/CREATE WITH FORCE) en vez de `--clean`, por las extensiones PostGIS; dump `--no-owner --no-privileges`.

**2026-10-05 — e2e y rate limit.** Cada contexto de Playwright envía un `X-Forwarded-For` 10.x.y.z aleatorio porque el límite de 5 intentos/min por IP bloqueaba la suite; Caddy sobrescribe esa cabecera en producción. CI levanta la app con `pnpm build && pnpm start`.

**2026-10-05 — Ingreso con recarga completa.** `SignInForm` usa `window.location.assign` tras el sign-in: con `router.replace + router.refresh` el redirect de `/` ganaba y `?next=` se perdía.

## Fases 4–6 — Backend de registros, roles y operaciones

**2026-10-05 — Los roles de origen de una operación deben existir;** los resultantes se crean si no existen. Un error de tipeo en el origen crearía un rol falso y lo dejaría no vigente. Un rol no vigente no puede ser origen de ninguna operación (ni de una modificación); el mensaje sugiere los resultantes o eliminar la operación que lo reemplazó.

**2026-10-05 — `resultCoords: 'inherit'`** asigna coordenadas solo a los resultantes que no las tienen (subdivisión/rectificación: las del origen; fusión: promedio de los orígenes) y las propaga a sus registros según §8.3. `superseded_at` se recalcula con `min(effective_date)` de las operaciones donde el rol es origen, al crear y al eliminar.

**2026-10-05 — Bugs de fundación corregidos.** (1) `exportCsv` exportaba solo 2.000 filas: ahora pagina por cursor `id > lastId`. (2) `getGeocoder` quedaba atado a la primera transacción recibida: se construye sobre `db`. (3) `updateCoordinates` con alcance rol contaba dos veces el registro movido. (4) `setNumber` fallaba si otro registro tenía texto en el campo correlativo. (5) Un rol mal formado en la URL daba 500: `parseRoleIdParam` → 400. (6) Buscar "50-2" no encontraba `00050-00002`: `listRecords` aplica los mismos patrones de prefijo que `searchRoles`.

**2026-10-05 — Búsqueda de texto libre.** `attributes::text ILIKE '%q%'` ronda 0,7 s con 40k registros. Pendiente de evaluar con datos reales: índice `GIN ((attributes::text) gin_trgm_ops)` (§7.3). El criterio de la Fase 5 (página de 50 con filtro por valor < 300 ms) se cumple.

**2026-10-05 — Tests de servicios con `pg_advisory_lock` por archivo** en una conexión reservada, además de `fileParallelism: false`.

## Fase 7 — Importación

**2026-10-05 — Fila de encabezados autodetectada** (primera fila con ≥2 celdas con texto; las filas de título se saltan) y **delimitador CSV con detección propia** (la de PapaParse falla con títulos sin delimitador sobre los encabezados). Las filas vacías se saltan conservando la numeración real de la planilla.

**2026-10-05 — Celdas XLSX se guardan como texto** en `raw` (Date → `aaaa-mm-dd`, decimales con coma, booleanos Sí/No) para que el mismo casteo aplique a CSV y Excel. El orden de encabezados se guarda en `imports.progress.headers` (JSONB no conserva el orden de claves).

**2026-10-05 — Ubicaciones no exactas quedan como sugerencia** (`suggestedLocation` + candidatos) hasta aceptarlas por fila o en bloque; si no se aceptan, la fila se importa sin ubicación. Rol por dirección aproximada → `suggestedRoleId`. La geocodificación local se hace en lote (`padron-batch.ts`) replicando las reglas del proveedor `padron`.

**2026-10-05 — Valores fijados a mano** (rol/lat/lon sin columna mapeada) se guardan en `raw` bajo claves reservadas `__roleId/__lat/__lon`, ocultas en UI y CSV.

**2026-10-05 — Escrituras en bloque con `jsonb_to_recordset` y `UPDATE … FROM (VALUES …)`**: 10k filas se analizan en 1,7 s y se confirman en 2,9 s. `committedAt` usa `now()` de la BD para que la detección de "modificado después de importar" no dependa del reloj del proceso.

**2026-10-05 — Índice `import_rows_record_idx`** (migración 0002): la FK `ON DELETE SET NULL` sin índice hacía que cada borrado de registro recorriera `import_rows` (revertir 10k filas tardaba ~30 s).

**2026-10-05 — Permisos de importación.** Cualquier usuario autenticado puede listar importaciones y ver estado/filas/errores; las mutaciones son editor/admin y "propias" salvo admin. El análisis puede relanzarse desde UPLOADED/REVIEW/FAILED; `PATCH source` solo en UPLOADED.

## Integración final

**2026-10-05 — Worker de MapLibre servido desde `public/`.** Con Turbopack, MapLibre no puede resolver la URL de su worker desde `import.meta.url` ("Worker failed to load"). `scripts/copy-maplibre-worker.mjs` (hooks `predev`/`prebuild`) copia `maplibre-gl-worker.mjs` y `maplibre-gl-shared.mjs` a `public/` (ignorados por git) y `MapView` llama `setWorkerUrl('/maplibre-gl-worker.mjs')`. Cumple la CSP `worker-src 'self'`.

**2026-10-05 — El proxy no intercepta estáticos.** El matcher de `proxy.ts` excluye `.js/.mjs/.css/.map/.woff2` además de imágenes: el worker se pedía con redirección 307 al ingreso.

**2026-10-05 — CSP con `'unsafe-eval'` solo en desarrollo** (React y el HMR lo requieren); en producción se mantiene estricta. `script-src` admite `blob:` para los workers de MapLibre.

**2026-10-05 — `STORAGE_DIR` con valor por defecto en `storage.ts`.** Durante `next build` se omite la validación de env (`SKIP_ENV_VALIDATION`) y el módulo se evalúa al recolectar rutas; sin el valor por defecto el build en Docker fallaba.

**2026-10-05 — Limpieza de knip.** Se eliminaron 10 componentes shadcn sin uso (y `cmdk`, `date-fns`, `react-day-picker`). Los contratos compartidos (`src/shared/**`, servicios, `http.ts`, `lib/*`) se declaran como *entries* de knip: sus exports son API interna pública aunque hoy no todos tengan consumidor; `ignoreExportsUsedInFile` evita falsos positivos.

**2026-10-05 — `errors.ts` sin dependencia de Next.** `toApiError` (usa `NextResponse`) se movió a `http.ts`; `errors.ts` queda puro para que los bundles del worker y de los scripts CLI no requieran `next/server` (la imagen standalone no lo expone a `scripts/*.js`). Los handlers de importación se importan de forma estática en `jobs/handlers.ts`: el `import()` dinámico con `catch` ocultaba el fallo.

## Staging (Vercel + Neon)

Implementa `docs/STAGING.md`; la parte operativa está en `docs/DEPLOY.md` §7. Producción (`full`) no cambia de comportamiento.

**2026-10-12 — Modo de despliegue con capacidades centralizadas.** `NEXT_PUBLIC_DEPLOY_MODE` (`full` | `staging`, por defecto `full`; cualquier otro valor es `full`) se fija en el build. `src/shared/capabilities.ts` es la única fuente de topes, banderas y textos; los servicios aplican la regla y la interfaz la refleja. Los tests de staging fijan la variable con `vi.hoisted` antes de importar.

**2026-10-12 — Capacidad no disponible → `ConflictError` (409)** con mensaje que dice qué hacer (adjuntos: usar un enlace; padrón: `roles:import`). La guardia del padrón vive en la ruta y no en el servicio porque el CLI usa el mismo servicio y es justamente la alternativa. No existe interfaz web de carga del padrón, así que no hubo nada que deshabilitar en Administración.

**2026-10-12 — En staging se mantiene la búsqueda de direcciones en el padrón; solo se apaga OpenStreetMap.** STAGING.md §4.2 pedía forzar `geocode: false`, pero eso también apaga la búsqueda local en el padrón, contra la tabla de §3 ("solo padrón"). Se anula `needsExternalGeocode` (las filas no ubicadas quedan `location_missing` en vez de `location_pending`) y `runAnalyze` no encola `import.geocode-external`. Por lo mismo la casilla "Buscar ubicación por dirección" no se oculta: su texto explica que solo se busca en el padrón.

**2026-10-12 — Tope de filas antes de guardar.** `uploadImport` lee la planilla desde el buffer (`parseImportBuffer`) antes de escribirla en storage: una planilla ilegible o con demasiadas filas no deja nada guardado (también en `full`, donde antes se escribía y luego se borraba). El tope también se revisa al cambiar de hoja y al analizar.

**2026-10-12 — Archivos en `file_blobs` (`bytea`, migración 0003).** Segundo backend de `storage` con la misma interfaz, elegido por `capabilities.fileStorage`; el de disco se exporta como `diskStorage`. La tabla se crea también en producción y queda vacía.

**2026-10-12 — Tareas sin worker en `src/server/jobs/inline.ts`.** En staging `enqueue()` no toca pg-boss: agenda `runAnalyze`/`runCommit` con `after()`. `next/server` y los handlers se importan de forma dinámica (evita el ciclo con `import/analyze`/`import/commit` y que el worker dependa de Next). Va en un módulo aparte de `boss.ts` porque los tests existentes simulan `jobs/boss` completo. La limpieza de borradores vencidos se agenda con `after()` en cada subida. Rutas de analizar y confirmar con `maxDuration = 300`.

**2026-10-12 — Análisis interrumpido.** `startAnalyze` guarda `progress.startedAt` (`withProgress` lo conserva). Con tareas en la petición, un ANALYZING con más de 360 s (300 s de `maxDuration` + margen) es `stalled` en `GET /api/imports/:id`: la revisión ofrece "Volver a analizar" (mismas opciones guardadas) o "Descartar", y `startAnalyze` lo acepta. Se calcula en el servidor para no depender del reloj del navegador. No cubre COMMITTING: la confirmación escribe en lotes de 500 con una transacción por lote, así que un corte a mitad dejaría escrituras parciales; con 1.000 filas tarda menos de un segundo.

**2026-10-12 — Aviso de staging sin romper vistas de pantalla completa.** El shell autenticado publica el alto del aviso en `--app-banner-h`; las utilidades `h-app` / `min-h-app` (`globals.css`) descuentan ese alto y equivalen a `100dvh` en producción. La página del manual `ambiente-de-pruebas` solo aparece en el índice en staging (en producción sigue accesible por URL).

**2026-10-12 — Conexiones en staging.** Pool de la app con `max: 2` (cada instancia serverless abre el suyo contra el pooler de Neon). Los scripts usan `DATABASE_URL_DIRECT` si existe (`scripts/_env.ts`): migraciones y DDL no pasan por PgBouncer en modo transacción. `.gitignore` ahora versiona `.env.*.example` (`.env.production.example` estaba ignorado por error) y se agrega `.env.staging.example`.
