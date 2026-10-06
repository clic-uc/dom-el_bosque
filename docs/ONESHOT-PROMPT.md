# PROMPT — Reconstruir SIGDOM El Bosque como monolito Next.js

> Este documento es un prompt de trabajo para un agente de código. Contiene todo lo necesario para construir desde cero, en un único repositorio Next.js, la plataforma de georreferenciación de la Dirección de Obras Municipales (DOM) de la Municipalidad de El Bosque (Chile), hoy repartida en dos repos legacy: `backend-el-bosque` (NestJS + TypeORM + PostgreSQL) y `website-el-bosque` (React + Vite + Leaflet).
>
> Trabaja por fases (sección 13), en el orden indicado, y no avances de fase sin cumplir sus criterios de aceptación. Cuando algo no esté definido aquí, elige la opción más simple y estándar del stack indicado, déjala documentada en `docs/DECISIONS.md`, y sigue.

---

## 0. Contexto del dominio

- **Qué es**: un SIG interno (Sistema de Información Geográfica) para funcionarios municipales. Muestra sobre un mapa de la comuna de El Bosque "registros" georreferenciados agrupados en "capas" temáticas (Obras Menores, Recepción Final, Calzadas, Viviendas CSP, etc.), cada capa con sus propias columnas.
- **Terminología**: en el código legacy la capa se llama `map` (tabla `maps`, columna `mapId`, "Mapa" en la UI). En el nuevo sistema se llama siempre **`layer`** en código/BD/API y **"capa"** en la UI. La palabra "mapa" (`map`) queda reservada para la visualización MapLibre.
- **Usuarios**: funcionarios con cuenta interna (Better Auth, sección 6). No hay registro público: solo un administrador crea cuentas. Tres roles: `admin` ("Administrador"), `editor` ("Editor"), `viewer` ("Visor").
- **Concepto clave — Rol SII**: en Chile cada predio tiene un "rol de avalúo" del Servicio de Impuestos Internos con formato `NNNNN-NNNNN` (manzana-predio, 5 dígitos cada parte, con ceros a la izquierda). En la app se le llama "Rol SII" o simplemente "rol". Un rol tiene una ubicación de referencia (lat/lon), puede aparecer en varias capas y **puede tener varios registros en una misma capa** (por ejemplo, varios permisos de obra menor de años distintos). Hay un CSV maestro ("padrón de roles") con ~42.600 roles, su dirección y sus coordenadas.
- **Operaciones sobre roles**: un predio puede subdividirse (un rol da origen a varios), fusionarse (varios dan origen a uno) o rectificarse (cambia su número). Los permisos anteriores **conservan el rol original**; los nuevos se registran con el rol resultante. La plataforma guarda estas operaciones como un historial que enlaza roles de origen y resultantes (8.9), y lo muestra en la ficha del rol y en los registros involucrados.
- **Correlativos**: cada tipo de permiso tiene su propia numeración incremental (Obras Nuevas va en el 6.000 y tanto; Subdivisión y Fusión se reiniciaba cada año hasta 2020 y desde entonces sigue sin reiniciar). El número se asigna **al final del proceso**, cuando el permiso está aprobado y los derechos municipales pagados, y se usa en los certificados, así que no debe repetirse ni saltarse (8.8).
- **Idioma de la UI**: español de Chile. Fechas `es-CL`. Nombre visible: "Georreferenciación DOM" / "SIGDOM El Bosque". Dominio de producción: `sigdomelbosque.cl`.
- **Identidad visual** (colores institucionales de la Municipalidad, tomados de `municipalidadelbosque.cl` y del logo). Definir como tokens en `@theme`:

  | token | hex | uso |
  |---|---|---|
  | `primary` | `#73308a` | morado institucional: header, botones primarios, links, foco. Texto blanco encima (contraste 8.3:1) |
  | `primary-light` | `#8a42a3` | hover de primario (6.2:1 con blanco) |
  | `primary-dark` | `#5a2370` | pressed, texto de títulos sobre fondos claros |
  | `primary-soft` | `#f4ecf7` | fondos suaves (item activo del sidebar, badges) |
  | `secondary` | `#8ebb37` | verde institucional: acentos, indicadores, item seleccionado. **Nunca** con texto blanco (2.2:1); encima va texto oscuro `#1a1a1a` |
  | `secondary-strong` | `#4f7a1c` | verde para botones secundarios con texto blanco (5.1:1) y texto verde sobre fondo claro |
  | `secondary-soft` | `#f1f7e6` | fondos suaves verdes (toasts de éxito, badges) |

  Logo: `website-el-bosque/public/logo_el_bosque.png` (copiar a `public/`).
- **Área geográfica**: centro `[-33.56056, -70.66144]` (lat, lon), zoom inicial 14. Bounds de la comuna: lon `[-70.75860, -70.64506]`, lat `[-33.59221, -33.53141]`.

---

## 1. Objetivo de la reconstrucción

1. Un solo proyecto **Next.js (App Router)** que contenga UI, API y acceso a datos, más un proceso *worker* (misma base de código) para tareas largas. Sin NestJS, sin Vite, sin nginx para el frontend.
2. **Eliminar la tabla intermedia `record_attributes`**. Cada registro pertenece a exactamente una capa (`records.layer_id NOT NULL`) y guarda sus valores en `records.attributes JSONB`. La capa define las columnas (`layers.fields`) y qué campos identifican a un registro (`layers.unique_keys`).
3. **Reemplazar librerías** por alternativas modernas (sección 2), en particular Leaflet + react-leaflet + react-leaflet-cluster + react-leaflet-draw por **MapLibre GL JS** (fork libre de Mapbox GL, WebGL, sin token ni facturación) vía `react-map-gl/maplibre`.
4. **Autenticación interna** con Better Auth sobre la misma base PostgreSQL. Ninguna plataforma externa que requiera cuenta o credenciales (se elimina Clerk). Las APIs abiertas sin credenciales (tiles OSM, Nominatim) sí se pueden usar.
5. **Georreferenciación automática sin Google**: coordenadas desde el rol, desde el padrón de roles por dirección, y desde APIs abiertas de OpenStreetMap como respaldo (8.7).
6. **Importación en dos fases** (subir y analizar → revisar → confirmar), con CSV y Excel (8.5).
7. **No repetir los errores del legacy** (sección 3). Léela completa antes de escribir código.
8. **Partir con la base de datos vacía**: no se migran datos ni usuarios del legacy. Los datos se cargan con la herramienta de importación (8.5) y los usuarios se crean desde cero (6.1).

---

## 2. Stack objetivo

| Área | Elección | Motivo / notas |
|---|---|---|
| Framework | **Next.js 15+ (App Router), React 19, TypeScript strict** | Monolito: RSC para páginas, Route Handlers para API consumida por el cliente (GeoJSON, tabla, export, import), Server Actions para mutaciones simples. `output: 'standalone'` para Docker. |
| Package manager | **pnpm** | Igual que el legacy. Fijar versión con `packageManager` en `package.json`. |
| Base de datos | **PostgreSQL 17 + PostGIS 3.5** (imagen `postgis/postgis:17-3.5`) + `pg_trgm` | PostGIS para conteos de registros por polígono y consultas espaciales (5.8). `pg_trgm` para búsquedas aproximadas de roles y direcciones. |
| ORM / migraciones | **Drizzle ORM + drizzle-kit** con driver `postgres` (postgres.js) | Tipado real, SQL explícito, migraciones versionadas en `drizzle/`. Nunca `synchronize`. Tipos PostGIS no soportados nativamente se definen con `customType`. |
| Validación | **Zod** | Un único esquema por DTO, compartido entre formularios (cliente) y handlers/actions (servidor). |
| Auth | **Better Auth (`better-auth`)** con `drizzleAdapter` | Usuarios, sesiones y cuentas en la propia BD. Email + contraseña (`emailAndPassword`) con **registro deshabilitado**, plugin `admin` con roles `admin`/`editor`/`viewer` definidos con `createAccessControl`, plugin `nextCookies()` para Server Actions. Rate limit integrado en los endpoints de auth. Handler en `app/api/auth/[...all]/route.ts`. Sin envío de correos (ver 6.1). |
| Tareas en segundo plano | **pg-boss** (cola sobre la misma PostgreSQL) | Análisis y confirmación de importaciones, geocodificación externa con límite de tasa, limpieza de importaciones vencidas. Corre en un proceso `worker` aparte (`scripts/worker.ts`), misma imagen Docker. |
| Mapa | **MapLibre GL JS** + **react-map-gl** (`react-map-gl/maplibre`) | Clustering nativo (`cluster: true` en la fuente GeoJSON), íconos como style layers `symbol` con imágenes registradas en runtime, polígonos como style layers `fill`/`line`, mapas de calor con style layers `heatmap`. Sin plugins de cluster ni de dibujo. |
| Tiles/estilo base | **OpenFreeMap** (`https://tiles.openfreemap.org/styles/liberty`, vector, gratis, sin key) con alternativa raster OSM (`https://tile.openstreetmap.org/{z}/{x}/{y}.png`) | Hacer configurable por env (`NEXT_PUBLIC_MAP_STYLE_URL`). Incluir siempre atribución OSM. |
| Geocodificación | **Padrón de roles local** + **Nominatim** (OSM) + **Photon** opcional | Ver 8.7. Las llamadas externas se hacen solo desde el servidor, con caché en BD y respetando las políticas de uso. URLs configurables para poder apuntar a una instancia propia. |
| Estado servidor en cliente | **TanStack Query v5** | Cache, invalidación por `queryKeys`, mutaciones, polling del estado de importaciones. |
| Tablas | **TanStack Table v8** | Paginación/ordenamiento/filtro **del lado servidor**. |
| Formularios | **react-hook-form + @hookform/resolvers (zod)** | |
| UI | **Tailwind CSS v4 + shadcn/ui (Radix)** + **lucide-react** + **sonner** (toasts) | Un solo set de íconos (eliminar react-icons). Nada de `alert()`/`confirm()`: usar `Dialog`/`AlertDialog` y toasts. |
| CSV | **PapaParse** (en servidor) | Reemplaza el parser manual. Soporta comillas, delimitador auto, BOM. |
| Excel | **read-excel-file** (en servidor) | Solo lectura de `.xlsx`, liviana, lee varias hojas. **No** usar el paquete `xlsx` de npm (versión de SheetJS desactualizada y con vulnerabilidades conocidas). |
| Archivos adjuntos | Disco local (`STORAGE_DIR`, volumen Docker) detrás de `src/server/storage.ts` | Adjuntos de registros y polígonos, y archivos de importación temporales. |
| Manual de uso | **@next/mdx** | Páginas del manual en MDX dentro del repo (10.7). |
| Env tipado | **@t3-oss/env-nextjs** | Falla en build si falta una variable. |
| Testing | **Vitest + Testing Library** (unitario/servicios), **Playwright** (e2e crítico) | |
| Lint/format | **ESLint 9 (flat) + Prettier** (o Biome) | |
| Contenedores | **Docker multi-stage + docker compose** (app + worker + db) y **Caddy** como reverse proxy con TLS automático | Reemplaza nginx + certbot manual. |
| Logs | `pino` (JSON en prod) | |

Dependencias del legacy que **no** se traen: `leaflet`, `react-leaflet`, `react-leaflet-cluster`, `react-leaflet-draw`, `@types/leaflet`, `react-icons`, `axios` (usar `fetch`), `@floating-ui/react` (Radix lo cubre), `uuid` (usar `crypto.randomUUID()`), `react-router-dom`, `@vis.gl/react-google-maps`, `typeorm`, `class-validator`, `class-transformer`, `@nestjs/*`, `passport`, `helmet` (Next maneja headers en `next.config`), `multer` (usar `request.formData()`), `@clerk/*` (incluye `@clerk/localizations`), `svix`.

---

## 3. Errores del legacy que NO se deben repetir

Lista extraída de leer ambos repos. Cada punto indica el problema y la regla para el nuevo sistema. Los identificadores entre backticks del problema son los del código legacy (`maps`, `mapId`, etc.).

### 3.1 Modelo de datos
1. **Tabla intermedia `record_attributes`** (record ↔ map con JSONB). Hacía que un "registro" no supiera a qué capa pertenece, complicaba filtros (`INNER JOIN ... mapId = :mapId`), duplicados, auditoría (`import_batch_records` tenía PK sobre `recordAttributeId`) y la UI tenía que buscar `recordAttributes.find(ra => ra.mapId === mapId)` en todos lados. **Regla**: `records.layer_id` obligatorio, `records.attributes` JSONB. Un rol que aparece en N capas son N registros, y puede tener varios registros en la misma capa.
2. **Definición de la capa escondida en un JSONB `maps.attributes: { name, fields: string[] }`**. Nombre y columnas mezclados en un blob, sin tipos por campo, con la columna `key` creada por la migración inicial pero eliminada de la entidad (drift). **Regla**: columnas reales `layers.name`, `layers.slug`, `layers.fields JSONB` con esquema Zod estricto (`[{ key, label, type, required, options }]`), `layers.unique_keys`.
3. **Renombrar un campo de la capa dejaba huérfanos los datos** guardados bajo la clave antigua. **Regla**: al renombrar/eliminar un campo, migrar las claves JSONB de los registros de esa capa en la misma transacción (ver 7.2).
4. **Nombre de columna FK autogenerado `roleRoleId`**. **Regla**: `snake_case` explícito en todas las columnas (`role_id`, `layer_id`).
5. **Drift entre migraciones y entidades** (`links` con default `'[]'` en SQL pero `nullable` sin default en la entidad; `maps.key` fantasma). **Regla**: el esquema Drizzle es la única fuente; `drizzle-kit generate` produce las migraciones; CI falla si `drizzle-kit check` detecta drift.
6. **Coordenadas en `roles` y en `records` sin reglas escritas** de cuándo se copian de una a otra. **Regla**: se mantienen ambas porque cumplen papeles distintos (ver 8.3), con el origen de las coordenadas del registro explícito en `records.coords_source` y todas las reglas implementadas en un único lugar (`services/coordinates.ts`).
7. **El CSV maestro de roles trae `DIRECCION` y `COMPLEMENTO` que se descartaban**. **Regla**: `roles.address` se guarda, normalizada además para geocodificar (8.7).
8. **Duplicados definidos solo por el rol en capas con rol** (un rol = un registro por capa), lo que impedía registrar varios permisos de una misma propiedad. **Regla**: la identidad de un registro dentro de una capa es rol + `unique_keys` (8.4); no hay índice único por rol.

### 3.2 API
9. **`GET /records` devolvía un array o un objeto paginado según hubiera `page`+`limit`**, y el frontend normalizaba con `Array.isArray(data) ? data : data.data`. **Regla**: endpoints distintos con contratos fijos: `/features` (GeoJSON) y `/records` (paginado siempre).
10. **Filtros de atributos como JSON serializado en un query param `filters`**, parseado con `JSON.parse` sin validar. **Regla**: `filters[campo]=valor` repetible o body POST validado con Zod.
11. **`limit` sin default en `PaginationQueryDto` y `@Query('limit', ParseIntPipe) limit = 100` (lanza 400 si falta)**. Regla: defaults y límites en el esquema Zod (`pageSize` 1..200, default 50).
12. **`DELETE /records` y `DELETE /roles` hacían `TRUNCATE ... CASCADE`** expuestos a editores, sin confirmación real (el comentario decía `confirm=true required` pero no se validaba). **Regla**: no existen endpoints de borrado masivo. Si hace falta, es un script CLI.
13. **Errores lanzados como `throw new Error(...)` en controladores → 500** (revert de importación). **Regla**: errores de dominio tipados (`NotFound`, `Conflict`, `Validation`, `Forbidden`) mapeados a 404/409/400/403 en un único helper `toApiError`.
14. **La búsqueda de "presencia del rol en otras capas" hacía `GET /records?search=rol` (prefijo) y filtraba en el cliente**, y el resultado quedaba escondido en una tarjeta al final de la ficha. **Regla**: `GET /api/roles/[roleId]/records` agrupado en servidor, mostrado en una ficha del rol propia (10.2).
15. **Búsqueda global y filtrado de la tabla en el cliente sobre todos los registros descargados**. **Regla**: búsqueda/filtros/paginación/orden del lado servidor.
16. **Auditoría "de todos los usuarios" que en realidad solo devolvía los logs del usuario actual**, con paginación fake (`offset` ignorado, `total = data.length`). **Regla**: admin ve todo, paginado real con `total`.

### 3.3 Importación
17. **Parser CSV artesanal** (sin soporte real de comillas multi-línea, delimitador por defecto `;` en el util y `,` en el servicio). **Regla**: PapaParse, delimitador seleccionable con autodetección, detección de codificación (UTF-8 o Windows-1252); Excel con `read-excel-file`.
18. **Una transacción por fila con `upsert` de rol y `findOne` de la capa por fila** → decenas de miles de round-trips. **Regla**: validar todo en memoria, luego escribir en lotes de 500–1000 dentro de una transacción por lote; upsert de roles en lote (`INSERT ... ON CONFLICT DO NOTHING`).
19. **Exigía que el CSV tuviera exactamente las columnas de la capa, ni una más ni una menos** (`Faltan: ...`, `columnas que no están definidas`). Un CSV con una columna extra fallaba entero. **Regla**: el mapeo de columnas se resuelve en la UI y las columnas no mapeadas se ignoran; los campos `required` de la capa deben estar mapeados.
20. **Heurística de coordenadas que borra todos los separadores e inserta el punto tras 2 dígitos** (`"-70.456.345" → -70.456345`, pero `"-3.5" → 35`). Existía porque los Excel municipales exportaban coordenadas con puntos de miles. **Regla**: parseo normal primero (`Number(v.replace(',', '.'))`); aplicar la heurística solo si el valor tiene más de un separador o queda fuera de rango; validar además contra los bounds de la comuna y marcar como *advertencia* (no error) si queda fuera.
21. **La preview del CSV en el cliente hacía `split(delimiter)` sin comillas y reescribía el archivo con `\r\n`** para renombrar cabeceras. **Regla**: el archivo se sube tal cual y la vista previa la genera el servidor; el mapeo cabecera→campo se guarda aparte, nunca se reescribe el archivo.
22. **Importación de una sola pasada**: todo o nada por fila, sin forma de revisar duplicados ni errores antes de escribir. **Regla**: importación en dos fases con filas en preparación (`import_rows`), revisión fila a fila y confirmación explícita (8.5).
23. **La importación no era reversible por completo** (revertir borraba records pero no deshacía `REPLACE`, que además borraba y recreaba el registro perdiendo su id). **Regla**: actualizar un duplicado es un `UPDATE` en el lugar que conserva id, comentarios y adjuntos; se guarda la versión anterior en `import_rows.previous_snapshot` para restaurarla al revertir.

### 3.4 Frontend
24. **Descargar todos los registros de la capa (`limit: 5000` en un momento, luego sin límite) y convertirlos a "shapes" en el cliente**, repitiendo `comments`, `links`, `operations` dentro de `shape.attributes`. Al guardar, `operations` se filtraba mal y **se colaba dentro del JSONB de atributos**. **Regla**: el mapa consume GeoJSON del servidor con `properties` mínimas (`id`, `roleId`, campos de la capa); el panel lateral carga el detalle completo con `GET /api/records/[id]`. Nunca mezclar metadatos del registro con `attributes`.
25. **El panel lateral permitía editar el "Rol SII" pero al guardar lo eliminaba del payload** (no tenía efecto). **Regla**: cada control de la UI está conectado a un campo real del DTO; test e2e de "editar rol desde panel".
26. **`activeMaps: number[]` pero la UI era un radio (una capa a la vez) y solo `activeMaps[0]` cargaba datos** (con TODO en el código). **Regla**: decidir explícitamente: **una capa de trabajo** (`workingLayerId`, la que alimenta tabla, filtros, búsqueda y creación) más **capas superpuestas** de visualización (`overlayLayerIds[]`). Los polígonos de referencia también son multi-selección.
27. **Tipos desalineados entre back y front**: `Role.operations[].type` (back) vs `.operation` (front); `SeedSummary` distinto; `createdAt/updatedAt` en tipos del front que la BD no tenía. **Regla**: los tipos vienen del esquema Drizzle + Zod (`z.infer`) y se importan en cliente y servidor desde `src/shared/`.
28. **Íconos de marcador renderizados con `renderToString` de `react-dom/server` en el navegador por cada marcador**. **Regla**: una imagen por `(icon, color)` registrada una vez en MapLibre (`map.addImage`) y usada por una style layer `symbol`.
29. **Código muerto**: `MapContainer.jsx` (Google Maps), `useLoadGeoJson.js`, `useDrawHooks`, `useCoordinates`, `ApiTestPage`, `lib/api.ts` (fetch duplicando axios), `App.css` de la plantilla Vite, `index.html` cargando Leaflet 1.9.4 y 1.7.1 desde CDN además de npm. **Regla**: `knip` o `ts-prune` en CI; cero dependencias sin uso.
30. **`tailwind.config.js` de 26 KB con todo el theme por defecto copiado y `presets: []`**. **Regla**: Tailwind v4 con `@theme` mínimo (colores de marca).
31. **Guerra de `z-index` mágicos (`z-[500]`, `z-[2000]`, `z-[10000]`) contra los panes de Leaflet**. **Regla**: MapLibre no impone panes; usar portales de Radix para modales y una escala de z-index definida en el theme (`z-map`, `z-panel`, `z-modal`).
32. **`window.confirm`/`alert` para todo** (crear, borrar, errores). **Regla**: `AlertDialog` + toasts `sonner`.
33. **Dropdown de usuario "on hover" con `UserButton` de Clerk mutilado por CSS** (popover oculto). **Regla**: menú de usuario propio (`UserMenu`) con `DropdownMenu` de shadcn, abierto por click y accesible por teclado (ver 10.2).
34. **Formulario de "Agregar mapa" solo listaba departamentos que ya tenían capas** (no se podía crear la primera capa de un departamento). **Regla**: los departamentos vienen del enum.
35. **Paginación de la tabla en cliente** sobre el dataset completo. Ver punto 15.
36. **Sin manejo de estados vacíos/errores consistente** (`Cargando mapas...` en texto plano, errores en `console.error`). **Regla**: componentes `EmptyState`, `ErrorState`, `Skeleton` reutilizables; `error.tsx` y `loading.tsx` por segmento.

### 3.5 Auth y seguridad
37. **Asignar el rol por defecto haciendo una llamada a la API de Clerk dentro del guard en cada request sin rol** (efecto secundario en un guard, mutaba los claims en memoria), con registro abierto a cualquiera. **Regla**: sin registro público; el admin elige el rol al crear la cuenta; leer la sesión nunca escribe nada; un usuario "sin rol" (`users.role = NULL`) se trata como `viewer` en lectura.
38. **CORS con `*` + credentials**, Helmet configurado a mano, throttling global 100/min sin distinguir rutas. **Regla**: monolito same-origin → sin CORS. Headers de seguridad en `next.config.ts` (`headers()`): CSP con `connect-src` limitado a `'self'` y el proveedor de tiles, `frame-ancestors 'none'`, etc. Rate limit solo en auth (el de Better Auth), subida de importaciones (10/min/usuario), geocodificación puntual (30/min/usuario) y endpoints admin.
39. **Endpoints de seeds e importación de roles públicos en algún momento del historial** (commits "change access control to public"). **Regla**: seeds e importación masiva de roles solo por CLI (`pnpm db:seed`, `pnpm roles:import`) o `admin`.

### 3.6 Infra
40. **`init.ts` compilado con un `tsc` manual en el Dockerfile porque SWC no lo alcanzaba desde `main.ts`**. **Regla**: scripts CLI con `tsx` en `scripts/` y un stage de Docker que los incluye.
41. **Dos imágenes (nginx para SPA + node para API) + nginx en el host + certbot en cron**. **Regla**: una imagen Next standalone (servicios `app` y `worker`) + PostgreSQL/PostGIS + Caddy (TLS automático). Backups con `pg_dump` y del volumen de archivos por cron (mantener `scripts/backup-db.sh` y `restore-db.sh` adaptados).

---

## 4. Estructura del repositorio

```
sigdom/
├─ app/
│  ├─ (auth)/page.tsx                 # "/" ingreso (solo login)
│  ├─ (app)/
│  │  ├─ layout.tsx                   # shell autenticado (valida sesión en servidor, cambio de contraseña obligatorio, QueryClientProvider, Toaster)
│  │  ├─ map/page.tsx                 # "/map" vista principal
│  │  ├─ account/password/page.tsx    # cambio de contraseña obligatorio (6.1)
│  │  ├─ help/[[...slug]]/page.tsx    # manual de uso (10.7)
│  │  └─ admin/
│  │     ├─ layout.tsx                # guard admin
│  │     ├─ page.tsx                  # redirect a /admin/users
│  │     ├─ users/page.tsx
│  │     └─ audit/page.tsx
│  ├─ api/
│  │  ├─ auth/[...all]/route.ts               # Better Auth (toNextJsHandler)
│  │  ├─ health/route.ts
│  │  ├─ layers/route.ts                      # GET list, POST create
│  │  ├─ layers/[id]/route.ts                 # GET, PATCH, DELETE
│  │  ├─ layers/[id]/features/route.ts        # GET GeoJSON
│  │  ├─ layers/[id]/records/route.ts         # GET paginado (tabla)
│  │  ├─ layers/[id]/filters/route.ts         # GET valores distintos por campo
│  │  ├─ layers/[id]/duplicates/route.ts      # GET vista previa de repetidos para unos campos únicos
│  │  ├─ layers/[id]/export/route.ts          # GET CSV stream
│  │  ├─ records/route.ts                     # POST
│  │  ├─ records/[id]/route.ts                # GET, PATCH, DELETE
│  │  ├─ records/[id]/coordinates/route.ts    # PATCH
│  │  ├─ records/[id]/number/route.ts         # POST asignar correlativo, PUT corregir (admin)
│  │  ├─ layers/[id]/counters/route.ts        # GET, PUT (admin)
│  │  ├─ roles/route.ts                       # GET search
│  │  ├─ roles/[roleId]/route.ts              # GET, PATCH, DELETE
│  │  ├─ roles/[roleId]/records/route.ts      # GET ficha del rol (registros agrupados + historial)
│  │  ├─ role-operations/route.ts             # GET list, POST create
│  │  ├─ role-operations/[id]/route.ts        # DELETE (admin)
│  │  ├─ geocode/route.ts                     # GET geocodificación puntual
│  │  ├─ imports/route.ts                     # GET list, POST upload
│  │  ├─ imports/[id]/route.ts                # GET estado, PATCH origen (hoja, fila de cabecera, delimitador), DELETE descartar
│  │  ├─ imports/[id]/analyze/route.ts        # POST
│  │  ├─ imports/[id]/rows/route.ts           # GET filas en revisión
│  │  ├─ imports/[id]/rows/[rowNumber]/route.ts  # PATCH corregir/resolver una fila
│  │  ├─ imports/[id]/rows/bulk/route.ts      # POST resolver en bloque
│  │  ├─ imports/[id]/removals/route.ts       # GET, PATCH (reemplazo completo)
│  │  ├─ imports/[id]/commit/route.ts         # POST
│  │  ├─ imports/[id]/revert/route.ts         # POST
│  │  ├─ imports/[id]/errors/route.ts         # GET CSV de filas fallidas
│  │  ├─ polygons/route.ts                    # GET GeoJSON por tipo
│  │  ├─ polygons/stats/route.ts              # GET conteos por polígono
│  │  ├─ polygons/[id]/route.ts               # GET detalle, PATCH
│  │  ├─ attachments/route.ts                 # GET list, POST (enlace o archivo)
│  │  ├─ attachments/[id]/route.ts            # DELETE
│  │  ├─ attachments/[id]/download/route.ts   # GET
│  │  ├─ audit/logs/route.ts
│  │  ├─ admin/users/route.ts                 # GET list/search, POST create
│  │  ├─ admin/users/[id]/route.ts            # DELETE
│  │  ├─ admin/users/[id]/role/route.ts       # PUT {role|null}
│  │  └─ admin/users/[id]/password/route.ts   # PUT {password}
│  ├─ layout.tsx, globals.css, error.tsx, not-found.tsx
├─ content/help/**/*.mdx      # páginas del manual (10.7)
├─ src/
│  ├─ db/
│  │  ├─ schema/{auth,layers,records,roles,polygons,attachments,imports,audit,geocode}.ts + index.ts
│  │  ├─ client.ts                    # drizzle(postgres(env.DATABASE_URL))
│  │  └─ seed/{layers.seed.ts,index.ts}
│  ├─ server/
│  │  ├─ auth/
│  │  │  ├─ index.ts                  # instancia betterAuth(...)
│  │  │  └─ session.ts                # getActor(), requireRole()
│  │  ├─ errors.ts                    # AppError, toApiError
│  │  ├─ services/{layers,records,roles,roleOperations,export,audit,filters,coordinates,duplicates,numbering,polygons,attachments,users}.ts
│  │  ├─ import/{upload.ts,parse-csv.ts,parse-xlsx.ts,analyze.ts,review.ts,commit.ts,revert.ts}
│  │  ├─ geocoding/{normalize-address.ts,index.ts,providers/{padron,nominatim,photon}.ts}
│  │  ├─ parsing/{coordinates.ts,values.ts}   # parseo de coordenadas y casteo por tipo de campo
│  │  ├─ jobs/{boss.ts,handlers.ts}   # pg-boss: definición de colas y handlers
│  │  ├─ storage.ts                   # put/get/delete sobre STORAGE_DIR
│  │  └─ rate-limit.ts
│  ├─ shared/                         # importable desde cliente y servidor
│  │  ├─ schemas/*.ts                 # Zod DTOs
│  │  ├─ types.ts                     # z.infer + tipos derivados de Drizzle
│  │  ├─ constants.ts                 # departamentos, labels, bounds, colores
│  │  ├─ permissions.ts               # createAccessControl: statements + roles admin/editor/viewer
│  │  ├─ help-slugs.ts                # lista tipada de páginas del manual (10.7)
│  │  └─ role-id.ts                   # normalizeRoleId (puro)
│  ├─ features/
│  │  ├─ map/          # MapView, style-layers, hooks (useLayerFeatures), RecordSidePanel, RoleSheet, PolygonSidePanel, HeatmapPanel, CoordinateUpdateDialog
│  │  ├─ layers/       # LayersSidebar, LayerFormDialog (crear/editar), UniqueKeysEditor, IconPicker
│  │  ├─ records/      # RecordsTable, CreateRecordDialog, RecordSearch, FiltersPanel
│  │  ├─ import/       # ImportWizard y sus pasos (Upload, Mapping, Review, Result)
│  │  ├─ export/       # ExportDialog
│  │  ├─ attachments/  # AttachmentsList, AddAttachmentDialog
│  │  ├─ help/         # HelpLink, HelpLayout, DraftBanner
│  │  ├─ admin/        # UsersTable, RoleActions, CreateUserDialog, ResetPasswordDialog, AuditLogList, ImportList
│  │  └─ auth/         # SignInForm, UserMenu, AccountDialog, ForcedPasswordChange, useCurrentRole, can()
│  ├─ components/ui/   # shadcn
│  ├─ lib/{query-client.ts,query-keys.ts,api.ts (fetch wrapper),auth-client.ts,utils.ts}
│  └─ env.ts
├─ public/logo_el_bosque.png
├─ data/geo/{comuna,sectores,villas-poblaciones}.geojson   # fuente versionada de los polígonos (10.5), se carga a BD con geo:import
├─ scripts/
│  ├─ seed.ts, import-roles.ts, create-admin.ts, worker.ts, geo-import.ts, backup-db.sh, restore-db.sh
│  └─ convert-legacy-geojson.ts
├─ drizzle/                 # migraciones generadas
├─ docs/{DECISIONS.md,API.md,DEPLOY.md}
├─ e2e/                     # Playwright
├─ middleware.ts
├─ Dockerfile, docker-compose.yml, docker-compose.prod.yml, Caddyfile
├─ drizzle.config.ts, next.config.ts, tsconfig.json, .env.example
```

---

## 5. Modelo de datos (nuevo)

Todo en `snake_case`. Timestamps `created_at`/`updated_at` (`timestamptz`, default `now()`) en todas las tablas. Enums Postgres nativos. Extensiones `postgis` y `pg_trgm` en la primera migración.

### 5.1 Enums

```ts
export const departmentEnum        = pgEnum('department', ['edificacion', 'ejecucion', 'emergencias', 'vivienda']);
export const auditActionEnum       = pgEnum('audit_action', ['CREATE', 'UPDATE', 'DELETE', 'IMPORT', 'REVERT', 'ASSIGN_NUMBER']);
export const auditEntityEnum       = pgEnum('audit_entity', ['LAYER', 'RECORD', 'ROLE', 'ROLE_OPERATION', 'USER', 'POLYGON', 'ATTACHMENT', 'IMPORT']);
export const roleOperationTypeEnum = pgEnum('role_operation_type', ['subdivision', 'fusion', 'rectificacion', 'modificacion']); // etiquetas: Subdivisión, Fusión, Rectificación, Modificación
export const roleOperationSideEnum = pgEnum('role_operation_side', ['origin', 'result']);
export const coordsSourceEnum      = pgEnum('coords_source', ['role', 'own', 'geocoded']);   // ver 8.3
export const importStatusEnum      = pgEnum('import_status', ['UPLOADED', 'ANALYZING', 'REVIEW', 'COMMITTING', 'COMPLETED', 'FAILED', 'DISCARDED', 'REVERTED']);
export const duplicateStrategyEnum = pgEnum('duplicate_strategy', ['ask', 'skip', 'update']);
export const importRowStatusEnum   = pgEnum('import_row_status', ['valid', 'warning', 'duplicate', 'error', 'excluded']);
export const importRowResolutionEnum = pgEnum('import_row_resolution', ['create', 'update', 'skip']);
export const importRowActionEnum   = pgEnum('import_row_action', ['created', 'updated']);
export const polygonKindEnum       = pgEnum('polygon_kind', ['comuna', 'sector', 'villa']);
export const attachmentEntityEnum  = pgEnum('attachment_entity', ['record', 'polygon']);
export const attachmentKindEnum    = pgEnum('attachment_kind', ['link', 'file']);
// Solo Zod (viven en JSONB):
export const fieldTypes = ['string', 'number', 'boolean', 'date', 'autonumber'] as const; // autonumber = correlativo (8.8)
export const geocodeConfidences = ['exact', 'interpolated', 'approx', 'street'] as const; // ver 8.7
```

Etiquetas de departamento (constante compartida):

| valor | etiqueta |
|---|---|
| `edificacion` | Edificación y Urbanismo |
| `ejecucion` | Ejecución de Obras |
| `emergencias` | Emergencias |
| `vivienda` | Vivienda |

### 5.2 `layers`

```ts
export const layers = pgTable('layers', {
  id: serial('id').primaryKey(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),      // 'obras-menores'
  name: varchar('name', { length: 120 }).notNull(),               // 'Obras Menores'
  department: departmentEnum('department').notNull(),
  hasRole: boolean('has_role').notNull().default(false),          // la capa usa Rol SII
  fields: jsonb('fields').$type<LayerField[]>().notNull().default([]),
  uniqueKeys: jsonb('unique_keys').$type<string[]>().notNull().default([]), // campos que, junto al rol, identifican un registro (8.4)
  addressFieldKey: varchar('address_field_key', { length: 80 }),            // campo con la dirección, para geocodificar (8.7)
  heatmapFieldKey: varchar('heatmap_field_key', { length: 80 }),            // campo numérico para mapas de calor por valor (10.2)
  icon: varchar('icon', { length: 50 }).notNull().default('building-2'),    // nombre lucide kebab-case
  iconColor: varchar('icon_color', { length: 20 }).notNull().default('#3b82f6'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt, updatedAt,
});
```

```ts
// Zod
export const layerFieldSchema = z.object({
  key: z.string().min(1).max(80).regex(/^[a-z][a-z0-9_]*$/), // clave en records.attributes; inmutable salvo por "renombrar campo"
  label: z.string().min(1).max(120),       // texto visible
  type: z.enum(fieldTypes).default('string'),
  required: z.boolean().default(false),
  options: z.record(z.string(), z.unknown()).default({}), // configuración específica del tipo; reservado para tipos futuros (p. ej. listas cerradas)
});
// options de un campo 'autonumber' (8.8):
export const autonumberOptionsSchema = z.object({
  reset: z.enum(['never', 'yearly']).default('never'),
  yearFieldKey: z.string().optional(),     // obligatorio si reset = 'yearly': campo donde se guarda el año del correlativo
});
export const layerFieldsSchema = z.array(layerFieldSchema).max(60)
  .refine(fs => new Set(fs.map(f => f.key)).size === fs.length, 'Claves duplicadas')
  .refine(fs => fs.filter(f => f.type === 'autonumber').length <= 1, 'Solo puede haber un correlativo por capa')
  .refine(fs => !fs.some(f => ['id','roleId','lat','lon','comments'].includes(f.key)), 'Clave reservada');
```

Reglas:
- La `key` de un campo nuevo se genera del `label` en `snake_case` sin acentos ni símbolos (`'N° Permiso'` → `'n_permiso'`), con sufijo `_2`, `_3` si choca.
- `uniqueKeys ⊆ fields.map(f => f.key)`. Se permite con o sin `hasRole` (8.4).
- `addressFieldKey`, si existe, apunta a un campo `string`. `heatmapFieldKey`, si existe, apunta a un campo `number`.
- Un campo `autonumber` no se llena en los formularios de creación/edición: se asigna con la acción "Asignar número" (8.8). Si la capa tiene correlativo, `LayerFormDialog` sugiere incluirlo en `uniqueKeys` (con el campo de año si reinicia cada año).
- `slug` se genera del nombre (`slugify`) y se garantiza único con sufijo `-2`, `-3`.
- Al **renombrar la `key` de un campo**, **eliminarlo** o **cambiar su tipo**, ver 7.2.

### 5.3 `roles` (Rol SII) y caché de geocodificación

```ts
export const roles = pgTable('roles', {
  id: varchar('id', { length: 11 }).primaryKey(),                 // '00050-00001' normalizado
  lat: doublePrecision('lat'),                                    // ubicación de referencia del predio (padrón); el mapa NO la lee (8.3)
  lon: doublePrecision('lon'),
  address: text('address'),                                       // DIRECCION + COMPLEMENTO del padrón, tal cual
  addressNorm: text('address_norm'),                              // normalizeAddress(address) (8.7)
  streetNorm: text('street_norm'),                                // calle normalizada, sin número
  houseNumber: integer('house_number'),                           // número de la dirección
  supersededAt: date('superseded_at'),                            // fecha desde la que el rol ya no está vigente (8.9); NULL = vigente
  createdAt, updatedAt,
}, t => [
  index('roles_address_norm_trgm').using('gin', sql`${t.addressNorm} gin_trgm_ops`),
  index('roles_street_number_idx').on(t.streetNorm, t.houseNumber),
]);

// Historial de operaciones sobre roles (8.9). Solo se agregan filas: nunca se reescriben registros ni roles existentes.
export const roleOperations = pgTable('role_operations', {
  id: serial('id').primaryKey(),
  type: roleOperationTypeEnum('type').notNull(),
  effectiveDate: date('effective_date').notNull(),                // fecha de la resolución u operación
  reference: varchar('reference', { length: 200 }),               // p. ej. "Res. 45/2024"
  recordId: integer('record_id').references(() => records.id, { onDelete: 'set null' }), // registro que respalda la operación (p. ej. en Subdivisión y Fusión)
  comment: text('comment'),
  createdBy: varchar('created_by', { length: 64 }),
  createdAt,
});

export const roleOperationRoles = pgTable('role_operation_roles', {
  operationId: integer('operation_id').notNull().references(() => roleOperations.id, { onDelete: 'cascade' }),
  roleId: varchar('role_id', { length: 11 }).notNull().references(() => roles.id, { onDelete: 'restrict' }),
  side: roleOperationSideEnum('side').notNull(),                  // 'origin' = rol anterior, 'result' = rol resultante
}, t => [ primaryKey({ columns: [t.operationId, t.roleId, t.side] }), index().on(t.roleId) ]);

export const geocodeCache = pgTable('geocode_cache', {
  provider: varchar('provider', { length: 20 }).notNull(),        // 'nominatim' | 'photon'
  query: text('query').notNull(),                                 // dirección normalizada
  result: jsonb('result').$type<GeocodeResult | null>(),          // null = sin resultado (también se cachea)
  createdAt,
}, t => [ primaryKey({ columns: [t.provider, t.query] }) ]);
```

- `normalizeRoleId('4631-30') === '04631-00030'`. Rechaza si no son dos grupos numéricos separados por `-`. Trata `"sin rol"`, `"s/rol"`, `"s/ rol"`, vacío → `null`.

### 5.4 `records`

```ts
export const records = pgTable('records', {
  id: serial('id').primaryKey(),
  layerId: integer('layer_id').notNull().references(() => layers.id, { onDelete: 'cascade' }),
  roleId: varchar('role_id', { length: 11 }).references(() => roles.id, { onDelete: 'set null' }), // rol con el que se registró; las operaciones de rol no lo cambian (8.9)
  lat: doublePrecision('lat'),                                    // coordenadas que dibuja el mapa (8.3)
  lon: doublePrecision('lon'),
  geom: pointGeometry('geom').generatedAlwaysAs(sql`CASE WHEN lon IS NOT NULL THEN ST_SetSRID(ST_MakePoint(lon, lat), 4326) END`), // STORED; para consultas espaciales (5.8)
  coordsSource: coordsSourceEnum('coords_source'),                // 'role' | 'own' | 'geocoded'; NULL si no hay coordenadas
  geocode: jsonb('geocode').$type<{ provider: string; confidence: GeocodeConfidence; query: string }>(), // solo si coords_source = 'geocoded'
  attributes: jsonb('attributes').$type<Record<string, unknown>>().notNull().default({}),
  comments: text('comments'),
  numberAssignedAt: timestamp('number_assigned_at', { withTimezone: true }), // cuándo la plataforma asignó el correlativo (8.8); NULL si no lo asignó ella
  numberAssignedBy: varchar('number_assigned_by', { length: 64 }),
  createdBy: varchar('created_by', { length: 64 }),               // users.id (sin FK: el usuario puede eliminarse)
  updatedBy: varchar('updated_by', { length: 64 }),
  createdAt, updatedAt,
}, t => [
  index('records_layer_idx').on(t.layerId),
  index('records_role_idx').on(t.roleId),
  index('records_layer_role_idx').on(t.layerId, t.roleId),
  index('records_geom_gist').using('gist', t.geom),
  index('records_attributes_gin').using('gin', t.attributes),     // jsonb_path_ops opcional
  check('records_coords_pair', sql`(lat IS NULL) = (lon IS NULL) AND (lat IS NULL) = (coords_source IS NULL)`),
  check('records_coords_role', sql`coords_source <> 'role' OR role_id IS NOT NULL`),
]);
```

- No hay índice único por rol: un rol puede tener varios registros en la misma capa. La detección de duplicados está en 8.4.
- Los enlaces externos de un registro viven en `attachments` (5.5), no en una columna.
- `attributes` solo contiene claves definidas en `layers.fields[].key`. El servicio de escritura **filtra** claves desconocidas y castea según `type` (`number` → `Number` aceptando `1.234,5` y `1234.5`, `autonumber` → entero positivo, `boolean` → `true/false/'sí'/'no'`, `date` → ISO `YYYY-MM-DD` aceptando `dd-mm-aaaa`, `dd/mm/aaaa` y fechas de Excel, vacío → `null`).

Contadores de correlativos (8.8):

```ts
export const layerCounters = pgTable('layer_counters', {
  layerId: integer('layer_id').notNull().references(() => layers.id, { onDelete: 'cascade' }),
  fieldKey: varchar('field_key', { length: 80 }).notNull(),
  period: varchar('period', { length: 4 }).notNull().default(''), // '' si no reinicia; el año ('2026') si reinicia cada año
  lastValue: integer('last_value').notNull().default(0),          // último número entregado; nunca baja
  updatedAt,
}, t => [ primaryKey({ columns: [t.layerId, t.fieldKey, t.period] }) ]);
```

### 5.5 Polígonos de referencia y adjuntos

```ts
export const polygons = pgTable('polygons', {
  id: serial('id').primaryKey(),
  kind: polygonKindEnum('kind').notNull(),
  code: varchar('code', { length: 50 }),                          // id de origen del GeoJSON, para re-importar de forma idempotente
  name: varchar('name', { length: 200 }),
  properties: jsonb('properties').$type<Record<string, unknown>>().notNull().default({}),
  geom: multiPolygonGeometry('geom').notNull(),                   // customType geometry(MultiPolygon,4326)
  createdAt, updatedAt,
}, t => [ index('polygons_geom_gist').using('gist', t.geom), uniqueIndex('polygons_kind_code_uq').on(t.kind, t.code) ]);

export const attachments = pgTable('attachments', {
  id: uuid('id').primaryKey().defaultRandom(),
  entityType: attachmentEntityEnum('entity_type').notNull(),
  entityId: varchar('entity_id', { length: 64 }).notNull(),       // records.id o polygons.id como texto
  kind: attachmentKindEnum('kind').notNull(),
  title: varchar('title', { length: 200 }).notNull(),             // "Plano de loteo", "Reglamento de copropiedad"
  url: text('url'),                                               // kind = 'link' (Drive u otro)
  storageKey: text('storage_key'),                                // kind = 'file'
  fileName: varchar('file_name', { length: 255 }),
  mimeType: varchar('mime_type', { length: 120 }),
  sizeBytes: integer('size_bytes'),
  createdBy: varchar('created_by', { length: 64 }),
  createdAt,
}, t => [
  index('attachments_entity_idx').on(t.entityType, t.entityId),
  check('attachments_kind_fields', sql`(kind = 'link' AND url IS NOT NULL) OR (kind = 'file' AND storage_key IS NOT NULL)`),
]);
```

- Al borrar un registro o polígono, el servicio borra sus adjuntos (y los archivos del storage) en la misma operación.
- Archivos: máximo `MAX_ATTACHMENT_MB` (default 20), tipos permitidos PDF, imágenes, documentos Office y DWG/DXF.

### 5.6 Importaciones

```ts
export const imports = pgTable('imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  layerId: integer('layer_id').notNull().references(() => layers.id, { onDelete: 'cascade' }),
  userId: varchar('user_id', { length: 64 }).notNull(),
  userEmail: varchar('user_email', { length: 255 }),
  fileName: varchar('file_name', { length: 500 }).notNull(),
  fileType: varchar('file_type', { length: 4 }).notNull(),        // 'csv' | 'xlsx'
  fileKey: text('file_key'),                                      // archivo en storage; se borra al completar, descartar o vencer
  sheetName: varchar('sheet_name', { length: 120 }),              // solo xlsx
  headerRow: integer('header_row').notNull().default(1),          // fila de la planilla con los encabezados
  delimiter: varchar('delimiter', { length: 1 }),                 // solo csv
  columnMapping: jsonb('column_mapping').$type<Record<string, string | null>>().notNull().default({}), // encabezado -> field.key | 'roleId' | 'lat' | 'lon' | null
  rowFrom: integer('row_from'),                                   // rango opcional, en números de fila de la planilla
  rowTo: integer('row_to'),
  duplicateStrategy: duplicateStrategyEnum('duplicate_strategy').notNull().default('ask'),
  keepExistingOnEmpty: boolean('keep_existing_on_empty').notNull().default(true), // al actualizar, una celda vacía no borra el valor existente
  fullReplace: boolean('full_replace').notNull().default(false),   // el archivo es la capa completa: revisar los registros que no vienen en él (8.5)
  geocode: boolean('geocode').notNull().default(true),
  status: importStatusEnum('status').notNull().default('UPLOADED'),
  progress: jsonb('progress').$type<{ phase?: string; done?: number; total?: number }>().notNull().default({}),
  totalRows: integer('total_rows').notNull().default(0),
  createdCount: integer('created_count').notNull().default(0),
  updatedCount: integer('updated_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  errorMessage: text('error_message'),                            // si status = FAILED
  createdAt,
  analyzedAt: timestamp('analyzed_at', { withTimezone: true }),
  committedAt: timestamp('committed_at', { withTimezone: true }),
  revertedAt: timestamp('reverted_at', { withTimezone: true }),
  revertedBy: varchar('reverted_by', { length: 64 }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),     // borradores vencen a los 7 días
}, t => [ index().on(t.layerId, t.createdAt), index().on(t.userId, t.createdAt), index().on(t.status) ]);

export const importRows = pgTable('import_rows', {
  importId: uuid('import_id').notNull().references(() => imports.id, { onDelete: 'cascade' }),
  rowNumber: integer('row_number').notNull(),                     // número de fila tal como se ve en la planilla
  raw: jsonb('raw').$type<Record<string, string>>().notNull(),    // encabezado -> valor original (editable en revisión)
  parsed: jsonb('parsed').$type<ParsedRow>(),                     // { roleId, lat, lon, coordsSource, geocode, attributes }
  status: importRowStatusEnum('status').notNull(),
  messages: jsonb('messages').$type<{ level: 'error'|'warning'|'info'; code: string; message: string }[]>().notNull().default([]),
  duplicateOf: jsonb('duplicate_of').$type<number[]>().notNull().default([]),  // ids de registros existentes con la misma identidad
  fileDuplicateOf: integer('file_duplicate_of'),                  // rowNumber de la primera ocurrencia dentro del archivo
  resolution: importRowResolutionEnum('resolution'),
  recordId: integer('record_id').references(() => records.id, { onDelete: 'set null' }), // tras confirmar
  action: importRowActionEnum('action'),                          // tras confirmar
  previousSnapshot: jsonb('previous_snapshot'),                   // registro antes de actualizarlo (para revertir)
}, t => [ primaryKey({ columns: [t.importId, t.rowNumber] }), index().on(t.importId, t.status) ]);

// Solo con fullReplace: registros existentes de la capa cuya identidad no aparece en el archivo
export const importRemovals = pgTable('import_removals', {
  importId: uuid('import_id').notNull().references(() => imports.id, { onDelete: 'cascade' }),
  recordId: integer('record_id').notNull(),                       // sin FK: el registro puede borrarse al confirmar
  deletable: boolean('deletable').notNull(),                      // false si tiene adjuntos o correlativo asignado por la plataforma
  reason: varchar('reason', { length: 200 }),                     // por qué no se puede borrar, o "creado en la plataforma"
  resolution: varchar('resolution', { length: 6 }).notNull().default('keep'), // 'keep' | 'delete'
  deleted: boolean('deleted').notNull().default(false),           // tras confirmar
  snapshot: jsonb('snapshot'),                                    // registro completo antes de borrarlo (para revertir)
}, t => [ primaryKey({ columns: [t.importId, t.recordId] }) ]);
```

### 5.7 Auditoría

```ts
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: varchar('user_id', { length: 64 }).notNull(),
  userEmail: varchar('user_email', { length: 255 }),              // snapshot: se conserva aunque el usuario se elimine
  action: auditActionEnum('action').notNull(),
  entityType: auditEntityEnum('entity_type').notNull(),
  entityId: varchar('entity_id', { length: 64 }).notNull(),
  layerId: integer('layer_id'),                                   // denormalizado para filtrar
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),   // { before, after } en UPDATE; conteos en IMPORT
  createdAt,
}, t => [ index().on(t.userId, t.createdAt), index().on(t.entityType, t.entityId), index().on(t.createdAt) ]);
```

Una importación confirmada genera **un** log `IMPORT` (entidad `IMPORT`, con conteos), no uno por fila.

### 5.8 Decisiones geoespaciales

- `lat`/`lon` (`double precision`) son la fuente de verdad en registros y roles (compatibles con los archivos y con la UI). El servidor construye GeoJSON `[lon, lat]`.
- `records.geom` es una columna generada (`STORED`) con índice GiST, usada para conteos por polígono (`ST_Covers(polygons.geom, records.geom)`) y consultas espaciales. Nunca se escribe directamente.
- Los polígonos de referencia viven en `polygons` (no como archivos estáticos) para poder nombrarlos, adjuntarles documentos y contar registros dentro de ellos.

### 5.9 Tablas de auth (`src/db/schema/auth.ts`)

- Generadas una vez con `pnpm dlx @better-auth/cli generate` (con los plugins configurados) y ajustadas a mano: tablas en plural (`users`, `sessions`, `accounts`, `verifications`; `usePlural: true` en el adapter), columnas SQL en `snake_case` con claves TS en camelCase (`emailVerified: boolean('email_verified')`), que es lo que el adapter espera.
- Campos del plugin `admin`: `users.role` (text, **nullable**: `NULL` = "Sin rol"), `users.banned`, `users.ban_reason`, `users.ban_expires`, `sessions.impersonated_by`.
- Campo adicional `users.must_change_password` (boolean, default `false`), declarado en `user.additionalFields` de Better Auth (6.1).
- Las migraciones de estas tablas las genera `drizzle-kit` como el resto. Nunca usar `better-auth migrate`.

---

## 6. Autenticación, roles y permisos

### 6.1 Better Auth
- `src/shared/permissions.ts`: `createAccessControl({ ...defaultStatements })` del plugin admin y tres roles: `admin` (`adminAc`), `editor` y `viewer` (sin permisos sobre usuarios). Exporta `ac`, `roles` y `type Role = 'admin' | 'editor' | 'viewer'`. Se usa en servidor (`admin({ ac, roles })`) y en cliente (`adminClient({ ac, roles })`).
- `src/server/auth/index.ts`:
  ```ts
  export const auth = betterAuth({
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: 'pg', schema: authSchema, usePlural: true }),
    emailAndPassword: { enabled: true, minPasswordLength: 10, disableSignUp: true },
    user: { additionalFields: { mustChangePassword: { type: 'boolean', defaultValue: false, input: false } } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24 }, // sin cookieCache: cambios de rol aplican en el siguiente request
    rateLimit: { enabled: true, customRules: { '/sign-in/email': { window: 60, max: 5 } } },
    plugins: [admin({ ac, roles, defaultRole: 'viewer', adminRoles: ['admin'] }), nextCookies()],
  });
  ```
- **Registro cerrado**: no existe registro público (`disableSignUp: true`, sin formulario de registro). Solo un admin crea cuentas desde `/admin/users` (`auth.api.createUser`), elige el rol y define una contraseña temporal.
- **Contraseña temporal**: al crear un usuario o asignarle una contraseña temporal, `must_change_password = true`. Mientras esté en `true`, `app/(app)/layout.tsx` redirige a `/account/password` y la API responde 403 `PASSWORD_CHANGE_REQUIRED` salvo en `/api/auth/*`. Al cambiarla (`authClient.changePassword({ revokeOtherSessions: true })`) queda en `false`.
- **Sin correos**: no hay invitaciones, verificación de email ni recuperación de contraseña por correo. Si alguien olvida su contraseña, un admin le asigna una temporal.
- `app/api/auth/[...all]/route.ts`: `export const { GET, POST } = toNextJsHandler(auth)`.
- `middleware.ts`: chequeo optimista con `getSessionCookie(request)` (`better-auth/cookies`). Rutas públicas `/`, `/api/health`, `/api/auth/(.*)`. Sin cookie → redirect a `/` (páginas) o 401 JSON (API). La cookie **no** es validación: la validación real ocurre siempre en `getActor()`.
- `src/server/auth/session.ts`:
  ```ts
  export type Actor = { userId: string; email: string; name: string; role: Role };
  export async function getActor(): Promise<Actor>            // auth.api.getSession({ headers: await headers() }); lanza Unauthorized si no hay sesión; role null → 'viewer'
  export async function requireRole(...allowed: Role[]): Promise<Actor>  // lanza Forbidden
  ```
- `app/(app)/layout.tsx` valida la sesión en servidor y redirige a `/` si no hay; `/` redirige a `/map` si ya hay sesión.
- Cliente: `src/lib/auth-client.ts` con `createAuthClient({ plugins: [adminClient({ ac, roles })] })`. `useCurrentRole()` lee `authClient.useSession().data?.user.role` (`null` → "Sin rol", se comporta como `viewer`); helper `can(role, action)` con la matriz de abajo para ocultar controles (la autorización real siempre es en servidor).
- Primer admin: `pnpm auth:create-admin --email <correo> --name "<nombre>"` (usa `auth.api.createUser` con `role: 'admin'`; pide la contraseña por stdin o genera una y la imprime una vez; este usuario no queda con cambio obligatorio).

### 6.2 Matriz de permisos

| Acción | viewer | editor | admin |
|---|:-:|:-:|:-:|
| Ver capas, registros, roles, filtros, polígonos, adjuntos, mapas de calor | ✓ | ✓ | ✓ |
| Exportar CSV | ✓ | ✓ | ✓ |
| Ver el manual | ✓ | ✓ | ✓ |
| Editar su propio nombre y contraseña | ✓ | ✓ | ✓ |
| Crear/editar/eliminar capa (incluye campos únicos) | | ✓ | ✓ |
| Crear/editar/eliminar registro, mover coordenadas | | ✓ | ✓ |
| Asignar correlativo a un registro | | ✓ | ✓ |
| Corregir un correlativo, ajustar el próximo número, eliminar un registro con correlativo | | | ✓ |
| Agregar/eliminar adjuntos (registros y polígonos), editar nombre de polígonos | | ✓ | ✓ |
| Editar rol (coordenadas, dirección) y registrar operaciones sobre roles | | ✓ | ✓ |
| Eliminar una operación sobre roles registrada por error | | | ✓ |
| Importar archivos (CSV/Excel) a una capa | | ✓ | ✓ |
| Revertir una importación | | ✓ (propias) | ✓ (todas) |
| Ver auditoría | propia | propia | toda |
| Importar CSV maestro de roles | | | ✓ (y CLI) |
| Gestión de usuarios (listar, buscar, crear, cambiar rol, asignar contraseña temporal, eliminar) | | | ✓ |
| Ejecutar seeds | | | CLI |

Etiquetas: `admin` → "Administrador", `editor` → "Editor", `viewer` → "Visor", sin rol → "Sin rol".

---

## 7. Servicios de dominio (servidor)

Todos los servicios reciben `(db | tx, actor, input)` y devuelven datos planos. Los Route Handlers / Server Actions solo: parsean con Zod → llaman al servicio → serializan. Toda mutación escribe en `audit_logs` dentro de la misma transacción.

### 7.1 `layers.service`
- `listLayers()` → ordenadas por `department`, `sortOrder`, `name`. Incluir `recordCount` (subquery) para mostrar en el sidebar.
- `getLayer(id)`.
- `createLayer(input)` / `updateLayer(id, patch)` / `deleteLayer(id)` (cascade borra registros y el servicio borra sus adjuntos; pedir confirmación en UI escribiendo el nombre de la capa si `recordCount > 0`).
- `previewDuplicates(layerId, uniqueKeys)` → `{ groups: number, records: number, sample: [{ key: Record<string,string>, recordIds: number[] }] }` (hasta 10 grupos): cuántos grupos de registros existentes quedarían con la misma identidad si se usan esos campos únicos (8.4). Lo usa `LayerFormDialog` antes de guardar.

### 7.2 Cambios en `fields` (dentro de `updateLayer`)
Comparar `before.fields` vs `after.fields` por `key`:
- **Nuevo campo**: nada que migrar.
- **Campo eliminado**: `UPDATE records SET attributes = attributes - 'key' WHERE layer_id = $1`. La UI advierte "Se eliminarán los valores de N registros".
- **Campo renombrado** (la UI envía `renames: [{ from, to }]`): `UPDATE records SET attributes = (attributes - from) || jsonb_build_object(to, attributes->from) WHERE layer_id = $1 AND attributes ? from`.
- **Cambio de `type`**: la UI muestra antes cuántos valores existentes se pueden convertir al nuevo tipo (misma lógica de casteo de 5.4) y un ejemplo de los que no. Al confirmar, se convierten los convertibles y los demás quedan como texto; el resultado se informa y se audita. Pasar un campo a `autonumber` exige que todos los valores existentes sean enteros (la UI lista los que no, para corregirlos antes).
- `uniqueKeys`, `addressFieldKey` y `heatmapFieldKey` que referencian keys eliminadas se quitan; los que referencian keys renombradas se actualizan; `heatmapFieldKey` se quita si el campo deja de ser `number`.

### 7.3 `records.service`
- `getFeatures(layerId, { search?, filters?, weight? })` → `FeatureCollection` con `Feature<Point, { id, roleId, coordsSource, ...attributesVisibles }>` de registros con coordenadas. Con `weight=true` y `layer.heatmapFieldKey` definido, agrega `w` (número; se omiten los registros sin valor). Respuesta con `Cache-Control: private, no-store` pero calculada con una sola query. Para capas grandes, `properties` incluye solo `id`, `roleId`, `coordsSource`, `w` y los primeros 3 campos (para el hover); el resto se pide por id.
- `listRecords(layerId, { page, pageSize, sort, search, filters, hasCoordinates?, coordsSource? })` → `{ data, total, page, pageSize }`. `sort` admite `id`, `roleId`, `lat`, `lon`, `updatedAt`, y `attr:<key>` (ordena por `attributes->>key`).
- `search` (ILIKE `%q%`) sobre `role_id`, `comments` y `attributes::text` (o `jsonb_path_exists` por campo). Índices trigram si el rendimiento lo exige.
- `filters`: `{ [key]: string | string[] }` → array ⇒ `attributes->>key IN (...)`; string ⇒ `attributes->>key ILIKE 'q%'` con escape de `%_\`.
- `getRecord(id)` → registro + `role` + `layer` (name, fields) + `attachments` + `sameRoleCount` (otros registros del mismo rol en todas las capas).
- `createRecord(input)`: valida `layerId`, filtra/castea `attributes` según `fields`, normaliza `roleId` (upsert del rol si no existe), resuelve coordenadas (8.3), detecta duplicado (8.4) → `Conflict` si existe.
- `updateRecord(id, patch)`: `attributes` se **mezcla** (merge) con los existentes; `roleId: null` desasocia; cambios de `roleId` o de lat/lon aplican 8.3; si el cambio deja al registro con la identidad de otro (8.4) → `Conflict`; guarda `before/after` en auditoría.
- `updateCoordinates(id, { lat, lon, scope: 'record' | 'role' })`: `scope='record'` deja el registro en `'own'`; `scope='role'` actualiza el rol **y** todos los registros con ese `role_id`, que quedan en `'role'`.
- `useRoleCoordinates(id)`: copia las coordenadas del rol al registro y lo deja en `'role'` (8.3).
- `deleteRecord(id, reason?)` (borra también sus adjuntos). Un registro con correlativo asignado por la plataforma solo lo puede borrar un admin, indicando el motivo; su número no se reutiliza (8.8).

### 7.4 `roles.service`
- `searchRoles(q, limit=8)` → prefijo sobre `id` (normalizando la entrada si parece un rol) y similitud trigram sobre `address_norm`.
- `searchRoles` y `getRole` devuelven `vigente` (`superseded_at IS NULL`) y, si no lo está, los roles resultantes.
- `getRole(id)`, `updateRole(id, patch)` (lat, lon, address; un cambio de lat/lon se propaga según 8.3; un cambio de `address` recalcula los campos normalizados), `deleteRole(id)`: `Conflict` si el rol participa en alguna operación (8.9); si no, en una transacción, primero pasa a `'own'` los registros del rol con `'role'` (si no, el `ON DELETE SET NULL` violaría `records_coords_role`) y luego borra el rol; los registros quedan con `role_id = null` y conservan sus coordenadas.
- `getRoleRecords(roleId, { includeLineage? })` → `{ role, history, total, groups: [{ department, layers: [{ layerId, layerName, icon, iconColor, records: [{ id, roleId, summary: [{ label, value }], updatedAt, hasCoordinates }] }] }] }`. `summary` son los 3 primeros campos con valor. Orden: departamento según el enum, capas por `sortOrder`, registros por `updatedAt` descendente. `history` es `getRoleHistory(roleId)`. Con `includeLineage`, suma los registros de los roles de origen (hacia atrás, toda la cadena), indicando en cada uno su `roleId` original.
- `getRoleHistory(roleId)` → operaciones en las que participa el rol, en orden cronológico, cada una con su tipo, fecha, referencia, registro de respaldo y los roles de origen y resultantes; más `ancestors` y `descendants` (toda la cadena, con CTE recursiva, profundidad máxima 20).
- `importRoleCoordinates(file)` (admin/CLI): columnas requeridas `roleId`, `lat`, `lon`; opcionales `DIRECCION`, `COMPLEMENTO` → `address = trim(concat_ws(' ', DIRECCION, COMPLEMENTO))` y sus campos normalizados (8.7). Upsert en lotes de 1000 (`ON CONFLICT (id) DO UPDATE SET lat=EXCLUDED.lat, lon=EXCLUDED.lon, address=COALESCE(EXCLUDED.address, roles.address), ...`). Luego, para los roles del archivo, `UPDATE records r SET lat = ro.lat, lon = ro.lon, coords_source = 'role', geocode = NULL FROM roles ro WHERE r.role_id = ro.id AND ro.lat IS NOT NULL AND (r.coords_source IN ('role', 'geocoded') OR r.coords_source IS NULL)` (8.3: los `'own'` no se tocan). Devuelve `BulkImportSummary` con cuántos registros se actualizaron y cuántos roles vigentes del sistema **no** vienen en el padrón (con la lista descargable), como pista de operaciones pendientes de registrar. La importación del padrón nunca borra roles ni cambia su vigencia.

### 7.5 `filters.service`
- `getFilterOptions(layerId)` → `{ [fieldKey]: string[] | 'text' }`: por cada campo de la capa, `SELECT DISTINCT attributes->>key ... LIMIT 101`; si ≤100 valores devuelve la lista ordenada (incluye `''` como "(Vacío)"), si no devuelve `'text'`. Cachear 60 s por capa (`unstable_cache` o memoria) e invalidar al escribir.

### 7.6 `export.service`
- `exportCsv(layerId, { delimiter: ','|';' })` → stream `text/csv; charset=utf-8` con BOM. Columnas: `id`, `roleId` (solo si `hasRole`), `lat`, `lon`, `origen_coordenadas`, luego `fields[].label` en orden, luego `comments`. Nombre `export-<slug>-<YYYY-MM-DDTHH-mm-ss>.csv`. Todos los registros de la capa (con y sin coordenadas).

### 7.7 `audit.service`
- `log(tx, { actor, action, entityType, entityId, layerId?, metadata? })`.
- `listLogs({ page, pageSize, userId?, action?, entityType?, layerId?, from?, to? })` — admin puede omitir `userId`; otros roles siempre filtran por el propio.

### 7.8 `users.service` (Better Auth + Drizzle)
- `listUsers({ limit, offset, query? })` → query Drizzle sobre `users` (`name`/`email` ILIKE) con `lastSignInAt = max(sessions.created_at)` → `{ data: [{ id, name, email, role, lastSignInAt, mustChangePassword }], total }`.
- `createUser({ name, email, password, role })` → `auth.api.createUser` con `mustChangePassword: true`. `Conflict` si el correo ya existe.
- `setUserRole(id, role | null)` → con rol: `auth.api.setRole`; con `null`: `UPDATE users SET role = NULL` (el plugin no permite quitar el rol). Un admin **no** puede quitarse su propio rol admin (`Conflict`).
- `setUserPassword(id, password)` → `auth.api.setUserPassword` + `mustChangePassword = true` + `auth.api.revokeUserSessions`.
- `deleteUser(id)` → `auth.api.removeUser`; `Conflict` si es el propio usuario. `records.created_by` y `audit_logs` conservan el id y el email snapshot.
- Todas las mutaciones se auditan con `entityType: 'USER'` (nunca guardar contraseñas en `metadata`).

### 7.9 `polygons.service`
- `listPolygons(kind)` → `FeatureCollection` (`properties: { id, kind, name }`), con `ETag` basado en `max(updated_at)` y `Cache-Control: private, max-age=0, must-revalidate`.
- `getPolygon(id)` → datos + `attachments` + `counts: [{ layerId, layerName, icon, iconColor, count }]` (solo capas con ≥1 registro dentro, `ST_Covers`) + para villas, el sector que más la cubre.
- `updatePolygon(id, { name, properties })` (editor/admin). La geometría no se edita desde la app; se re-importa con `geo:import`.
- `getPolygonStats({ kind, layerId })` → `[{ polygonId, name, count }]` ordenado por `count` descendente (una sola query con `GROUP BY`).

### 7.10 `attachments.service`
- `listAttachments(entityType, entityId)`, `addLink({ entityType, entityId, title, url })` (valida `http(s)://`), `addFile({ entityType, entityId, title, file })` (valida tamaño y tipo, guarda en storage con clave `attachments/<uuid>`), `deleteAttachment(id)` (borra también el archivo), `getDownload(id)` → stream con `Content-Disposition: attachment` y el `mimeType` guardado.

### 7.11 `roleOperations.service` (8.9)
- `createOperation({ type, effectiveDate, reference?, recordId?, comment?, originRoleIds, resultRoleIds, resultCoords? })` (editor/admin): valida según 8.9, crea los roles resultantes que no existan (normalizados, sin coordenadas salvo `resultCoords`), inserta la operación y sus roles, marca `superseded_at = effectiveDate` en los roles de origen cuando corresponde, y audita `CREATE` sobre `ROLE_OPERATION`, todo en una transacción.
- `deleteOperation(id, reason)` (solo admin, para operaciones registradas por error): borra la operación, recalcula `superseded_at` de sus roles de origen y audita con el motivo. Los roles resultantes creados por ella quedan (pueden tener registros).
- `listOperations({ page, pageSize, type?, from?, to? })` para consulta general.

### 7.12 `numbering.service` (correlativos, 8.8)
- `assignNumber(recordId)` (editor/admin): en una transacción, bloquea la fila de `layer_counters` de ese campo y período (`SELECT ... FOR UPDATE`, creándola si no existe), calcula `next = greatest(lastValue, max(número existente en la capa para ese período)) + 1`, lo guarda en `attributes[fieldKey]` (y el año en `yearFieldKey` si reinicia cada año), fija `number_assigned_at/by`, actualiza `lastValue = next` y audita `ASSIGN_NUMBER`. `Conflict` si el registro ya tiene número.
- `previewNextNumber(layerId)` → el número que se asignaría ahora (informativo; el definitivo es el que devuelve `assignNumber`).
- `setNumber(recordId, value | null, reason)` (solo admin): corrección excepcional. Valida que el número no lo tenga otro registro de la capa en el mismo período (`Conflict`); si `value > lastValue`, sube el contador. Quitar un número no lo libera: el contador no baja.
- `getCounters(layerId)` / `setNextNumber(layerId, period, next)` (solo admin): ajustar el próximo número (por ejemplo, si se entregaron números fuera de la plataforma). `next` debe ser mayor que el máximo existente en la capa para ese período.

---

## 8. Reglas de negocio detalladas

### 8.1 Normalización de Rol SII (`shared/role-id.ts`, pura, con tests)
```
entrada            → salida
'4631-30'          → '04631-00030'
'04631-00030'      → '04631-00030'
' 12-3 '           → '00012-00003'
'sin rol' / 's/rol' / 's/ rol' / '' / null → null
'abc-12', '123', '1-2-3' → RoleIdInvalidError('Debe ser XXXXX-XXXXX con solo números')
```
Alias de cabecera aceptados al importar (case/acento-insensible): `roleId`, `rol`, `rol sii`, `rol_sii`, `role`.

### 8.2 Parseo de coordenadas (`server/parsing/coordinates.ts`, con tests)
1. `trim`; vacío o `0` → `null` (los Excel municipales usan `0` como "sin coordenada"). Celdas numéricas de Excel se usan tal cual (pasos 4–5).
2. Si contiene exactamente un separador (`,` o `.`) → `Number(v.replace(',', '.'))`.
3. Si contiene más de un separador o el resultado queda fuera de rango (`lat ∉ [-90,90]`, `lon ∉ [-180,180]`): quitar todos los separadores y signo, insertar `.` después de los 2 primeros dígitos, reaplicar signo (heurística legacy para "-33.546.553").
4. Redondear a 6 decimales.
5. Si sigue fuera de rango → **error** de fila. Si está en rango pero fuera de los bounds de la comuna con margen de 0.05° → **advertencia**, se importa igual.

### 8.3 Coordenadas de roles y de registros (`services/coordinates.ts`)

Hay coordenadas en dos tablas porque cumplen papeles distintos:

- **`roles.lat/lon`**: ubicación de referencia del predio. Persiste el padrón de roles (7.4) y existe aunque el rol todavía no tenga ningún registro. Sirve para ubicar automáticamente un registro nuevo que se asocia a ese rol. **El mapa nunca la lee.**
- **`records.lat/lon`**: coordenadas que dibuja el mapa. Todo registro las guarda, tenga o no rol. Un registro sin rol no tiene de dónde heredarlas, y uno con rol puede estar en un punto distinto al del predio (un poste o una vereda frente al predio, por ejemplo).
- **`records.coords_source`** indica de dónde salieron las coordenadas del registro:
  - `'role'`: copiadas del rol; lo siguen si el rol cambia.
  - `'own'`: propias (ingresadas, venían en el archivo importado o se movieron a mano); nada automático las pisa.
  - `'geocoded'`: obtenidas de la dirección (8.7), con su proveedor y confianza en `records.geocode`; son aproximadas y se reemplazan si aparecen coordenadas del rol.
  - `NULL` si el registro no tiene coordenadas.

Así `getFeatures` y `listRecords` leen solo `records`, sin join a `roles`.

Orden para ubicar un registro al crearlo o importarlo:
1. Coordenadas propias válidas → `'own'`.
2. Rol con coordenadas → `'role'`. En capas con rol, si la fila no trae rol pero la dirección calza **exacto** con el padrón, se asigna ese rol (con aviso "Rol asignado por dirección"); si calza de forma aproximada, se sugiere y el usuario confirma.
3. Dirección geocodificable (la capa tiene `addressFieldKey`) → `'geocoded'`.
4. Nada de lo anterior → sin coordenadas (solo aparece en la tabla; advertencia "Sin ubicación").

Reglas:
- Si un registro con rol trae coordenadas propias y el rol **no** tenía coordenadas, el rol las adopta (así el próximo registro con ese rol ya sale ubicado). Las coordenadas `'geocoded'` **nunca** se copian al rol.
- Registro **sin** rol → solo puede tener coordenadas `'own'`, `'geocoded'` o ninguna.
- Editar lat/lon en el panel o en la tabla → `'own'`.
- Mover un marcador (drag) → diálogo: "Solo este registro" (default, queda `'own'`) o "Todos los registros con el rol X" (solo si tiene rol): actualiza el rol y todos sus registros, que quedan `'role'`.
- Cambiar las coordenadas de un rol (padrón, `PATCH /api/roles/:id` o drag con alcance "todos") → se propagan a los registros de ese rol con `'role'`, `'geocoded'` o sin coordenadas. Los `'own'` no se tocan.
- Cambiar el `roleId` de un registro → si sus coordenadas eran `'role'` o `'geocoded'` y el nuevo rol tiene coordenadas, toma las del nuevo rol (la UI avisa "Coordenadas del rol cargadas automáticamente"); si eran `'own'`, no cambian. Quitar el rol a un registro con `'role'` conserva las coordenadas y las pasa a `'own'`.
- Botón "Usar coordenadas del rol" en el panel (si el registro tiene rol con coordenadas y no está en `'role'`): copia las del rol y vuelve a `'role'`.

### 8.4 Duplicados e identidad de un registro (`services/duplicates.ts`)

La **identidad** de un registro dentro de su capa es:
- capa con rol: `rol + valores de uniqueKeys`;
- capa sin rol: `valores de uniqueKeys`.

Los valores se comparan normalizados (texto, `trim`, espacios colapsados, minúsculas, sin acentos; números por su valor). Dos registros son duplicados si tienen la misma identidad en la misma capa.

- Capa con rol y sin `uniqueKeys`: no se detectan duplicados; un mismo rol puede tener todos los registros que se quiera. La revisión de importación muestra como información "El rol ya tiene N registro(s) en esta capa". `LayerFormDialog` advierte que, sin campos únicos, reimportar un archivo crea registros repetidos.
- Capa sin rol y sin `uniqueKeys`: no se detectan duplicados.
- Si alguno de los campos únicos de una fila o registro está vacío, no se compara (no se puede identificar) y se marca advertencia "Campos únicos incompletos".
- Creación o edición manual que produce una identidad existente → `Conflict` con mensaje "Ya existe un registro con rol X y N° Permiso Y en esta capa" (según los campos) y botón para abrir el existente.
- Cambiar los `uniqueKeys` de una capa no modifica registros; antes de guardar se muestra `previewDuplicates` ("Con esta configuración hay N grupos de registros repetidos") con ejemplos.
- En importación, el detalle está en 8.5.

### 8.5 Importación de registros (`server/import/*`)

Proceso en dos fases con filas en preparación. Las tareas pesadas corren en el worker (pg-boss) y la UI consulta el estado con polling (`GET /api/imports/:id`, cada 1 s mientras haya una tarea en curso).

**Subir** — `POST /api/imports` (multipart: `layerId`, `file`):
1. Acepta `.csv` y `.xlsx` hasta `MAX_IMPORT_FILE_MB` (10). Guarda el archivo en storage (`imports/<id>`) y crea la importación en `UPLOADED` con `expiresAt = now + 7 días`.
2. Lee el archivo en el request (sin worker):
   - CSV: decodificar como UTF-8; si falla, Windows-1252. PapaParse con `skipEmptyLines: 'greedy'` y delimitador autodetectado.
   - XLSX: `read-excel-file`, lista de hojas; por defecto la primera. Fechas de Excel → ISO, números como número, fórmulas → valor calculado.
3. Responde `{ importId, fileType, sheets?, headerRow, headers, totalRows, preview: 20 filas }`. Error 400 si hay encabezados duplicados o vacíos (indicando cuáles).
4. `PATCH /api/imports/:id` con `{ sheetName?, headerRow?, delimiter? }` vuelve a leer y responde lo mismo (para planillas con títulos sobre la fila de encabezados o varias hojas).

Los números de fila (`rowNumber`) son siempre los de la planilla tal como la ve el usuario en Excel.

**Analizar** — `POST /api/imports/:id/analyze` con `{ columnMapping, rowFrom?, rowTo?, duplicateStrategy, keepExistingOnEmpty, geocode, fullReplace }`:
1. Validar mapping: si `layer.hasRole`, `roleId` o el campo de dirección deben estar mapeados; todos los `fields` con `required` deben estar mapeados; `lat`/`lon` ambos o ninguno; un destino no se repite.
2. Encolar `import.analyze`; estado `ANALYZING`. El worker, para cada fila dentro del rango, en memoria: normaliza rol (8.1), coordenadas (8.2), castea atributos por tipo (5.4), ubica el registro (8.3) usando el geocodificador local (8.7), y guarda la fila en `import_rows` con su `status` y `messages`:
   - `error`: rol inválido, campo requerido vacío, valor no convertible al tipo, coordenada fuera de rango.
   - `duplicate`: misma identidad (8.4) que un registro existente (`duplicateOf`) o que una fila anterior del archivo (`fileDuplicateOf`).
   - `warning`: ubicación aproximada o sin ubicación, fuera de la comuna, rol asignado o sugerido por dirección, campos únicos incompletos, rol nuevo (no está en el padrón), rol no vigente (8.9).
   - `valid`: todo lo demás.
3. Resolución inicial de duplicados según `duplicateStrategy`: `skip` → `resolution = 'skip'`; `update` → `resolution = 'update'` si hay exactamente un registro existente con esa identidad (si hay varios, queda sin resolver); `ask` → sin resolver. Duplicados dentro del archivo: la segunda ocurrencia queda sin resolver.
4. **Reemplazo completo** (`fullReplace`, para volver a subir una planilla entera que se corrigió): solo se permite si la capa tiene `uniqueKeys` y sin rango de filas. Además del análisis normal, `duplicateStrategy` pasa a `update` (lo que ya existe se actualiza en el lugar, conservando id, coordenadas propias, comentarios y adjuntos) y se registran en `import_removals` los registros de la capa cuya identidad no aparece en el archivo, con `resolution = 'keep'` por defecto. No se pueden borrar desde la importación (`deletable = false`) los que tienen adjuntos o correlativo asignado por la plataforma; los creados en la plataforma (no por una importación) se marcan con esa razón para que el usuario los revise con cuidado.
5. Las filas que el geocodificador local no pudo ubicar se encolan en `import.geocode-external` (8.7), que avanza en segundo plano con el límite de tasa del proveedor y actualiza cada fila al terminar. El estado pasa a `REVIEW` sin esperar a la geocodificación externa; `progress` informa cuántas quedan.
6. Campos `autonumber`: los números del archivo se importan tal cual (históricos), como enteros; un valor no entero es error. No tocan el contador: el próximo número se calcula desde el máximo existente (8.8).
7. Performance: 40k filas analizadas (sin geocodificación externa) en menos de 60 s.

**Revisar** — estado `REVIEW`:
- `GET /api/imports/:id/rows?status=&code=&page=` pagina las filas por estado o tipo de mensaje; `GET /api/imports/:id` devuelve conteos por estado.
- `PATCH /api/imports/:id/rows/:rowNumber` con `{ raw?, resolution?, excluded?, roleId?, lat?, lon?, acceptSuggestion? }`: corregir valores de la fila (se revalida sola), resolver un duplicado (`create` = crear igual, `update` = actualizar el existente elegido, `skip` = omitir), excluir la fila, fijar ubicación a mano o aceptar el rol/ubicación sugeridos.
- `POST /api/imports/:id/rows/bulk` con `{ filter: { status?, code? }, action }`: aplicar una resolución o exclusión a todas las filas que calzan (por ejemplo "omitir todos los duplicados" o "aceptar todas las ubicaciones aproximadas").
- Con reemplazo completo: `GET /api/imports/:id/removals?page=` lista los registros que no vienen en el archivo; `PATCH /api/imports/:id/removals` con `{ recordIds | all: true, resolution: 'keep' | 'delete' }` los marca (los no borrables se ignoran).
- `DELETE /api/imports/:id` descarta el borrador (`DISCARDED`, borra filas y archivo).

**Confirmar** — `POST /api/imports/:id/commit`:
1. Requiere que no queden duplicados sin resolver. Las filas `error` que no se corrigieron cuentan como fallidas; las `excluded` y `skip`, como omitidas. Las filas aún pendientes de geocodificación externa se importan sin coordenadas si el usuario confirma igual (la UI lo advierte).
2. Encolar `import.commit`; estado `COMMITTING`. El worker: upsert de roles nuevos en lote (`ON CONFLICT DO NOTHING`); luego escribe en lotes de 500, una transacción por lote:
   - nuevo (`valid`, `warning` o `resolution = 'create'`) → `INSERT`, `action = 'created'`;
   - `resolution = 'update'` → guarda `previousSnapshot` y hace `UPDATE` en el lugar del registro existente: mezcla solo los campos mapeados (si `keepExistingOnEmpty`, una celda vacía no borra el valor existente); coordenadas según 8.3; conserva id, comentarios y adjuntos; `action = 'updated'`.
   - `import_removals` con `resolution = 'delete'` → guarda `snapshot` y borra el registro; `deleted = true`.
3. Un lote fallido no revierte los anteriores; la importación registra lo que efectivamente entró y queda `COMPLETED` con los conteos, o `FAILED` con `errorMessage` si no pudo escribir nada. Log `IMPORT` con los conteos. Se borra el archivo del storage.
4. Performance: 40k filas confirmadas en menos de 60 s.

**Después**:
- `GET /api/imports/:id/errors` → CSV con los encabezados originales + columna `Error` (filas fallidas).
- `POST /api/imports/:id/revert` (editor: solo propias; admin: todas): en una transacción borra los registros `created`, restaura los `updated` desde `previousSnapshot` y vuelve a insertar los borrados por reemplazo completo desde `import_removals.snapshot` con su id original. Si algún registro fue modificado después de la importación (`updated_at > committed_at`), responde `Conflict` con la lista y solo continúa si la petición trae `force: true`. Marca `REVERTED`; log `REVERT`.
- Tarea diaria `import.cleanup`: borradores vencidos (`expiresAt < now` y no confirmados) → `DISCARDED`, se borran filas y archivo.
- Rate limit: 10 subidas por minuto por usuario.

### 8.6 Búsqueda (barra superior)
Un solo campo con debounce 250 ms y resultados agrupados en el dropdown:
- **Registros** de la capa de trabajo: `GET /api/layers/[id]/records?search=q&pageSize=8`; muestra rol (o "Sin rol"), el primer campo que coincide (`label: valor`) y un ícono si no tiene coordenadas. Seleccionar → `flyTo` zoom 18 (si tiene coordenadas) + abrir su panel.
- **Roles**: `GET /api/roles?q=q&limit=5` (por rol o por dirección del padrón); si lo escrito parece un rol, va primero. Seleccionar → abrir la ficha del rol (`RoleSheet`).
- **Dirección**: si no hay roles que calcen y lo escrito parece una dirección, opción "Ir a <dirección>" → `GET /api/geocode?q=` → `flyTo` y marcador temporal.
- En vista tabla, el texto también filtra la tabla del servidor.

### 8.7 Geocodificación (`server/geocoding/*`)

Interfaz única: `geocode(address): Promise<GeocodeResult | null>` con `GeocodeResult = { lat, lon, provider, confidence, roleId?, label, candidates? }`. Proveedores en cadena según `GEOCODER_PROVIDERS` (default `padron,nominatim`); el primero que devuelve un resultado dentro de la comuna gana. Resultados fuera de los bounds de la comuna se descartan.

**`normalizeAddress(text)`** (pura, con tests): minúsculas, sin acentos ni puntuación; unifica abreviaturas (`av`, `avda` → `avenida`; `psje`, `pje` → `pasaje`; `gral` → `general`; `pob` → `poblacion`; `vla` → `villa`, etc.); quita "el bosque", "region metropolitana", "santiago", "chile"; separa la calle (`streetNorm`) del número (`houseNumber`, reconociendo `N°`, `#`, `nro`; `S/N` → sin número) y descarta complementos (`depto`, `block`, `casa`, `local`).

**1. `padron` (local, sin límites)**: busca en `roles` usando los campos normalizados.
- `exact`: misma `street_norm` y mismo `house_number` → devuelve coordenadas y `roleId` del predio.
- `interpolated`: misma calle sin ese número → interpola entre los dos números más cercanos de la misma calle y paridad.
- `approx`: similitud trigram de `address_norm` ≥ 0,6 → el mejor candidato, con hasta 3 `candidates` para que el usuario elija.

**2. `nominatim` (OSM, externo)**: `GET {NOMINATIM_URL}/search?street=<número> <calle>&city=El Bosque&state=Región Metropolitana&country=Chile&format=jsonv2&addressdetails=1&limit=3&viewbox=<bounds>&bounded=1`. `confidence = 'exact'` si el resultado es una dirección con número, `'street'` si es solo la calle. Cumple la política de uso de Nominatim: `User-Agent` identificable con `GEOCODER_CONTACT_EMAIL`, **máximo 1 petición por segundo** en todo el sistema (una sola cola del worker con concurrencia 1), y todos los resultados (también los vacíos) se guardan en `geocode_cache`. `NOMINATIM_URL` permite apuntar a una instancia propia si el volumen crece.

**3. `photon` (opcional)**: si `PHOTON_URL` está definido, mismo contrato con `bbox` de la comuna. Mismas reglas de límite y caché.

Uso:
- Importación: el análisis usa solo `padron` (rápido); las filas sin resultado pasan a la cola `import.geocode-external` (proveedores externos). En revisión, todo lo que no sea `exact` queda como advertencia para confirmar.
- Puntual: `GET /api/geocode?q=` (rate limit 30/min por usuario) para la búsqueda (8.6) y para "Buscar dirección" en `CreateRecordDialog`. Usa la cadena completa, con caché.

### 8.8 Correlativos (`services/numbering.ts`)

- Cada capa puede tener **un** campo `autonumber` con su propia secuencia (por ejemplo, N° Permiso en Obras Nuevas, N° Recepción Final en Recepción Final, Resolución en Subdivisión y Fusión). No se comparten números entre capas.
- **Cuándo se asigna**: nunca al crear el registro. Un editor ejecuta "Asignar número" cuando el permiso ya está aprobado y los derechos pagados. La acción pide confirmación y no se puede deshacer desde la UI.
- **Sin saltos ni repetidos**: el número se calcula y guarda dentro de una transacción con la fila del contador bloqueada, así que dos asignaciones simultáneas nunca obtienen el mismo número ni dejan huecos. El contador nunca baja: si un permiso se anula después de aprobado, se recomienda dejar el registro marcado como anulado (en un campo de la capa) en vez de borrarlo; si se borra, su número no se reutiliza.
- **Próximo número** = el mayor entre el último número entregado por la plataforma y el máximo número existente en la capa, más uno. Así, después de importar una planilla con los números históricos (por ejemplo, Obras Nuevas hasta el 6.123), el siguiente es el 6.124 sin configurar nada.
- **Reinicio anual** (`reset: 'yearly'`): la secuencia es por año (`period` = año de la asignación, guardado en `yearFieldKey`). Existe para las capas que numeraron así (Subdivisión y Fusión antes de 2020); por defecto `never`. En ese caso, los campos únicos de la capa deben ser el número + el año.
- **Excepciones** (números mal puestos, números entregados fuera de la plataforma): solo un admin corrige el número de un registro o ajusta el próximo número, siempre con motivo; queda en auditoría.
- **Uso en paralelo con Excel**: mientras se sigan asignando números en Excel, una importación puede traer un número que la plataforma ya entregó a otro registro. Si el correlativo está en los campos únicos, eso aparece como duplicado en la revisión.

### 8.9 Operaciones sobre roles (`services/roleOperations.ts`)

Funciona como un historial de migraciones: cada operación se **agrega** y enlaza roles de origen con roles resultantes; nunca se reescriben los registros existentes ni se renombran roles.

| Tipo | Origen | Resultado | Efecto en los roles de origen |
|---|---|---|---|
| Subdivisión | 1 rol | 2 o más roles | dejan de estar vigentes desde la fecha |
| Fusión | 2 o más roles | 1 rol | dejan de estar vigentes desde la fecha |
| Rectificación | 1 rol | 1 rol (el número corregido) | deja de estar vigente desde la fecha |
| Modificación | 1 o más roles | ninguno | siguen vigentes; es solo una anotación en su historial |

Reglas:
- Un rol de resultado no puede ser también de origen en la misma operación. Un rol ya no vigente no puede ser origen de otra operación (`Conflict`), salvo que se elimine primero la operación que lo reemplazó.
- `superseded_at` de un rol = la fecha más antigua entre las operaciones de tipo subdivisión, fusión o rectificación donde es origen; se recalcula al crear o eliminar operaciones.
- **Registros existentes**: conservan su `role_id` original. No cambian sus coordenadas ni sus datos.
- **Registros nuevos**: al elegir o importar un rol no vigente, se muestra la advertencia "El rol X fue subdividido el dd-mm-aaaa en Y, Z (Res. …)" con los roles resultantes como sugerencia. No se bloquea, porque puede tratarse de un permiso antiguo que se está ingresando ahora. En importación es una advertencia (`role_superseded`) con acción "Usar rol resultante" cuando hay un único resultado.
- **Coordenadas de los roles resultantes**: si no vienen en el padrón, `createOperation` puede asignarles provisionalmente las del rol de origen (subdivisión o rectificación) o el promedio de los de origen (fusión), con la casilla "Usar la ubicación de origen mientras no se actualice el padrón". La próxima importación del padrón las reemplaza.
- **Búsqueda y ficha**: un rol no vigente se muestra con el badge "No vigente" y enlaces a sus roles resultantes; un rol resultante muestra de qué rol proviene.

---

## 9. Contratos de API (resumen)

Formato de error uniforme: `{ error: { code: 'NOT_FOUND'|'CONFLICT'|'VALIDATION'|'FORBIDDEN'|'UNAUTHORIZED'|'PASSWORD_CHANGE_REQUIRED'|'RATE_LIMITED'|'INTERNAL', message: string, details?: unknown } }`.

| Método y ruta | Rol | Body / query | Respuesta |
|---|---|---|---|
| `GET/POST /api/auth/*` | público | endpoints de Better Auth (sin sign-up) | según Better Auth |
| `GET /api/health` | público | | `{ status: 'ok', db: 'ok' }` |
| `GET /api/layers` | viewer | | `LayerWithCount[]` |
| `POST /api/layers` | editor | `CreateLayerInput` | `Layer` 201 |
| `GET /api/layers/:id` | viewer | | `Layer` |
| `PATCH /api/layers/:id` | editor | `UpdateLayerInput` (+ `renames`, + `convertTypes`) | `Layer` |
| `DELETE /api/layers/:id` | editor | | 204 |
| `GET /api/layers/:id/features` | viewer | `search?`, `filters[k]=v`, `weight?` | `FeatureCollection` |
| `GET /api/layers/:id/records` | viewer | `page`, `pageSize`, `sort`, `dir`, `search`, `filters[k]`, `hasCoordinates`, `coordsSource` | `Paginated<RecordRow>` |
| `GET /api/layers/:id/filters` | viewer | | `{ [key]: string[] \| 'text' }` |
| `GET /api/layers/:id/duplicates?keys=a,b` | editor | | `DuplicatesPreview` |
| `GET /api/layers/:id/export?delimiter=;` | viewer | | CSV stream |
| `POST /api/records` | editor | `CreateRecordInput` | `RecordDetail` 201 |
| `GET /api/records/:id` | viewer | | `RecordDetail` (con `role`, `layer`, `attachments`) |
| `PATCH /api/records/:id` | editor | `UpdateRecordInput` | `RecordDetail` |
| `PATCH /api/records/:id/coordinates` | editor | `{ lat, lon, scope }` o `{ useRole: true }` | `{ updated: number }` |
| `POST /api/records/:id/number` | editor | | `{ number }` |
| `PUT /api/records/:id/number` | admin | `{ value: number \| null, reason }` | `{ number }` |
| `DELETE /api/records/:id` | editor (admin si tiene correlativo) | `{ reason? }` | 204 |
| `GET /api/layers/:id/counters` | editor | | `{ fieldKey, period, lastValue, next }[]` |
| `PUT /api/layers/:id/counters` | admin | `{ period?, next, reason }` | `{ next }` |
| `GET /api/roles?q=&limit=` | viewer | | `Role[]` |
| `GET /api/roles/:roleId` | viewer | | `Role` |
| `PATCH /api/roles/:roleId` | editor | `UpdateRoleInput` | `Role` |
| `DELETE /api/roles/:roleId` | editor | | 204 |
| `GET /api/roles/:roleId/records` | viewer | `includeLineage?` | `RoleRecords` (incluye `history`) |
| `GET /api/role-operations` | viewer | `page`, `pageSize`, `type?`, `from?`, `to?` | `Paginated<RoleOperation>` |
| `POST /api/role-operations` | editor | `CreateRoleOperationInput` | `RoleOperation` 201 |
| `DELETE /api/role-operations/:id` | admin | `{ reason }` | 204 |
| `POST /api/roles/import` | admin | multipart | `BulkImportSummary` |
| `GET /api/geocode?q=` | viewer | | `GeocodeResult \| null` |
| `GET /api/imports` | viewer/admin | `page`, `pageSize`, `layerId?`, `status?`, `userId?` (admin) | `Paginated<ImportItem>` |
| `POST /api/imports` | editor | multipart `{ layerId, file }` | `ImportSource` 201 |
| `GET /api/imports/:id` | editor | | `ImportStatus` (estado, progreso, conteos por estado) |
| `PATCH /api/imports/:id` | editor | `{ sheetName?, headerRow?, delimiter? }` | `ImportSource` |
| `DELETE /api/imports/:id` | editor (propia) | | 204 |
| `POST /api/imports/:id/analyze` | editor (propia) | `AnalyzeInput` | 202 |
| `GET /api/imports/:id/rows` | editor | `status?`, `code?`, `page`, `pageSize` | `Paginated<ImportRow>` |
| `PATCH /api/imports/:id/rows/:rowNumber` | editor (propia) | `ImportRowPatch` | `ImportRow` |
| `POST /api/imports/:id/rows/bulk` | editor (propia) | `{ filter, action }` | `{ updated: number }` |
| `GET /api/imports/:id/removals` | editor | `page`, `pageSize` | `Paginated<ImportRemoval>` |
| `PATCH /api/imports/:id/removals` | editor (propia) | `{ recordIds \| all, resolution }` | `{ updated: number }` |
| `POST /api/imports/:id/commit` | editor (propia) | | 202 |
| `GET /api/imports/:id/errors` | viewer | | CSV |
| `POST /api/imports/:id/revert` | editor (propia)/admin | `{ force?: boolean }` | `{ deletedRecords, restoredRecords }` |
| `GET /api/polygons?kind=` | viewer | | `FeatureCollection` |
| `GET /api/polygons/stats?kind=&layerId=` | viewer | | `PolygonStat[]` |
| `GET /api/polygons/:id` | viewer | | `PolygonDetail` |
| `PATCH /api/polygons/:id` | editor | `{ name?, properties? }` | `PolygonDetail` |
| `GET /api/attachments?entityType=&entityId=` | viewer | | `Attachment[]` |
| `POST /api/attachments` | editor | JSON (enlace) o multipart (archivo) | `Attachment` 201 |
| `DELETE /api/attachments/:id` | editor | | 204 |
| `GET /api/attachments/:id/download` | viewer | | archivo |
| `GET /api/audit/logs` | viewer/admin | `page`, `pageSize`, `action?`, `entityType?`, `layerId?`, `userId?` (admin), `from?`, `to?` | `Paginated<AuditLog>` |
| `GET /api/admin/users` | admin | `limit`, `offset`, `query?` | `{ data: UserItem[], total }` |
| `POST /api/admin/users` | admin | `{ name, email, password, role }` | `UserItem` 201 |
| `PUT /api/admin/users/:id/role` | admin | `{ role: 'admin'\|'editor'\|'viewer'\|null }` | `{ role }` |
| `PUT /api/admin/users/:id/password` | admin | `{ password }` | 204 |
| `DELETE /api/admin/users/:id` | admin | | 204 |

"(propia)": un editor solo puede operar sobre importaciones que creó; un admin sobre todas.

Documentar en `docs/API.md` (puede generarse con `zod-openapi` si se quiere Swagger; no es obligatorio).

---

## 10. Vistas y componentes

Todas las pantallas en español, responsivas desde 1024 px (uso en escritorio; en móvil el sidebar es un `Sheet`). Estados de carga con `Skeleton`, vacíos con `EmptyState`, errores con `ErrorState` + botón reintentar. Toda acción destructiva pasa por `AlertDialog`. Toda mutación muestra toast de éxito/error con el mensaje del servidor. Donde un concepto necesite explicación, un `HelpLink` (10.7) abre la página del manual correspondiente.

### 10.1 `/` — Ingreso
- Fondo `slate-100`, tarjeta centrada `max-w-xl` con kicker "DOM El Bosque", título "Ingreso a plataforma georreferenciada", logo.
- `SignInForm` (react-hook-form + Zod): correo, contraseña → `authClient.signIn.email`; éxito → `/map` (o `/account/password` si debe cambiarla).
- Errores en línea en español, mapeando los códigos de Better Auth (`INVALID_EMAIL_OR_PASSWORD` → "Correo o contraseña incorrectos", 429 → "Demasiados intentos, espera un minuto").
- Textos de ayuda: "¿No tienes cuenta? Solicítala a un administrador de la DOM." y "¿Olvidaste tu contraseña? Pide a un administrador que te asigne una temporal."
- Si ya hay sesión → redirect a `/map`.

`/account/password`: tarjeta "Define tu contraseña" (actual, nueva, confirmar), sin acceso al resto de la app hasta completarla.

### 10.2 `/map` — Vista principal (única pantalla de trabajo)

Layout en tres zonas: **sidebar izquierdo** (320 px, colapsable), **toolbar superior**, **área central** (mapa o tabla) + **panel derecho** deslizable (registro, ficha del rol o polígono) + **panel de filtros** deslizable (400 px).

Estado de URL (search params) para que sea compartible: `?layer=<id>&overlays=3,5&view=map|table&record=<id>&role=<rolId>&polygon=<id>&polys=comuna,sectores&heat=density|value&heatLayers=3,5&q=...&f[...]`.

**Capa de trabajo y capas superpuestas**
- **Capa de trabajo** (una): alimenta la tabla, los filtros, la búsqueda de registros, "Crear registro" (capa por defecto) y la exportación (capa por defecto).
- **Capas superpuestas** (hasta 6): solo se dibujan en el mapa, sin filtros. Sus puntos se pueden abrir (el panel funciona igual que en la capa de trabajo) y el panel ofrece "Trabajar en esta capa".

**`LayersSidebar` "Departamentos y Capas"**
- Cabecera con título, botón "+" (editor/admin) que abre `LayerFormDialog` en modo crear, y botón colapsar. Cuando está colapsado aparece un botón ">" en la toolbar.
- Acordeón por departamento (4, todos expandidos al inicio) con etiqueta y contador de capas. Cada capa en una fila: radio para elegirla como capa de trabajo, ícono (lucide, con su color), nombre, contador de registros `(N)`, un botón ojo para superponerla (deshabilitado si es la de trabajo) y al hover un botón "⋯" (editor/admin) que abre `LayerFormDialog` en modo editar.
- Cambiar la capa de trabajo: cierra el panel de registro, limpia filtros y búsqueda, hace `fitBounds` a los puntos de la capa si tiene (≥1) o vuelve al centro de la comuna. La capa anterior no queda superpuesta salvo que el usuario la marque.
- Sección "Polígonos" (checkboxes multi-selección): **Comuna**, **Sectores**, **Villas/Poblaciones**. Persistir en URL.
- Sección "Mapa de calor": abre `HeatmapPanel`.
- Al pie: versión de la app, link "Manual de uso" (`/help`) y link a `/admin` si es admin.

**Toolbar**
- Izquierda: `RecordSearch` (8.6) con placeholder "Buscar por rol, dirección o cualquier campo…"; botón "Filtros" (ícono `Filter`, con badge de cantidad de filtros activos) que abre/cierra `FiltersPanel`.
- Derecha: botón "Importar" (editor/admin, abre `ImportWizard` con la capa de trabajo), "Exportar" (todos), "Crear registro" (editor/admin, ícono `Plus`), toggle "Ver en tabla / Ver en mapa" (`view`), y `UserMenu`.

**`UserMenu`** (`DropdownMenu`, abre por click)
- Disparador: avatar con iniciales + badge del rol (`admin` morado, `editor` verde fuerte, `viewer` gris, "Sin rol" gris con borde).
- Contenido: nombre y correo, "Mi cuenta" (abre `AccountDialog`), "Manual de uso" (`/help`), "Panel de administración" (solo admin), separador, "Cerrar sesión" (`authClient.signOut` → `/`).
- `AccountDialog`: editar nombre (`authClient.updateUser`) y cambiar contraseña (actual, nueva, confirmar → `authClient.changePassword({ revokeOtherSessions: true })`).

**`MapView` (react-map-gl/maplibre)**
- `initialViewState` centro/zoom de la sección 0; `maxBounds` = bounds de la comuna ampliados 0.1°; `NavigationControl` abajo-izquierda; `ScaleControl`; atribución OSM/OpenFreeMap.
- Una fuente por capa visible, `records-<layerId>` (GeoJSON de `/features`; la capa de trabajo con sus filtros), con `cluster: true, clusterMaxZoom: 16, clusterRadius: 50`. Las style layers de la capa de trabajo van por encima de las superpuestas.
  - Style layer `clusters-<id>` (`circle`): color = `iconColor` de la capa, radio 18/22/26 por `point_count` (≤10 / ≤100 / >100), borde blanco 3 px.
  - Style layer `cluster-count-<id>` (`symbol`, `text-field: {point_count_abbreviated}`, blanco, bold).
  - Style layer `points-<id>` (`symbol`, `icon-image: 'marker-<icon>-<color>'`, `icon-allow-overlap: true`). La imagen es un SVG generado en runtime: círculo blanco de 40 px con borde 2 px del color y el ícono lucide (24 px, `strokeWidth 2`) centrado; registrar con `map.addImage(name, imageData, { pixelRatio: 2 })` una vez por combinación. Fallback ícono `building-2` color `#3b82f6`. Los puntos con `coordsSource = 'geocoded'` llevan un anillo punteado (ubicación aproximada).
  - Style layer `points-selected` (`circle` halo) para el registro abierto en el panel.
- Interacciones: click en cluster → `easeTo` al `getClusterExpansionZoom`; click en punto → abrir `RecordSidePanel(id)`; click en un polígono visible donde no hay punto → abrir `PolygonSidePanel(id)`; hover → cursor pointer + `Popup` ligero con nombre de la capa, rol y primer campo (o nombre del polígono).
- **Mover coordenadas** (editor/admin): al seleccionar un punto se muestra un `Marker` DOM arrastrable superpuesto (solo uno, el seleccionado). `onDragEnd` → `CoordinateUpdateDialog`. Cancelar devuelve el marcador a su posición.
- **Crear registro desde el mapa**: cuando `CreateRecordDialog` pide "Seleccionar en el mapa", el diálogo se minimiza a una barra flotante arriba ("Haz clic en el mapa para seleccionar la ubicación" + Cancelar), el cursor es `crosshair`, y el click devuelve `lat/lon` al formulario.
- `flyTo` desde búsqueda, ficha del rol o panel de polígono.
- Polígonos: fuentes GeoJSON desde `GET /api/polygons?kind=` cargadas al activar (lazy):

  | kind | línea | ancho | opacidad | relleno |
  |---|---|---|---|---|
  | `comuna` | `#73308a` | 3 | 0.8 | `#73308a` 0.06 |
  | `sector` | `#3B82F6` | 2 | 0.7 | `#3B82F6` 0.08 |
  | `villa` | `#10B981` | 2 | 0.7 | `#10B981` 0.08 |

**`HeatmapPanel`** (popover desde el sidebar)
- Toggle "Mapa de calor". Modo: **Densidad** (cantidad de puntos) o **Valor** (suma de un valor numérico).
- Capas incluidas: checkboxes entre la capa de trabajo y las superpuestas (por defecto todas). En modo Valor solo se pueden marcar las capas con `heatmapFieldKey`; cada una muestra el campo que aporta ("Monto inversión") y las demás aparecen deshabilitadas con la explicación "Esta capa no tiene un campo numérico para mapas de calor" + `HelpLink`.
- Aviso en modo Valor con varias capas: "Los valores se suman tal cual; úsalo con capas que midan lo mismo (por ejemplo, montos en pesos)".
- Controles: radio (px) e intensidad; casilla "Mostrar puntos" (por defecto apagada mientras el calor está activo). Leyenda "Menos → Más".
- Implementación: pide `/features?weight=true` de cada capa incluida, une los puntos en una sola fuente `heatmap` y usa una style layer `heatmap` con `heatmap-weight = w / wMax` (modo Valor; `wMax` = percentil 95 de los valores, para que un valor extremo no apague el resto) o `1` (modo Densidad).

**`RecordSidePanel`** (derecha, 360 px, `Sheet` no modal para seguir viendo el mapa)
- Carga `GET /api/records/:id`. Cabecera "Datos del registro" + nombre de la capa + botón cerrar (+ "Trabajar en esta capa" si es de una capa superpuesta).
- Si `layer.hasRole`: bloque "Rol SII" con input (máscara `00000-00000`, validación en vivo, `Combobox` con sugerencias de `/api/roles?q=`), badge "existente"/"nuevo"/"no vigente", y link "Ver ficha del rol (N registros)". **Guardar sí envía `roleId`.** Si el rol tiene operaciones, aviso bajo el rol con la última (por ejemplo "Este rol fue subdividido el 12-03-2024 en 00050-00012, 00050-00013"), con enlace a la ficha; el registro conserva su rol. Si el registro respalda una operación (`role_operations.record_id`), se indica "Este registro respalda la subdivisión de 00050-00001".
- Coordenadas (lat/lon, 6 decimales, editables, botón "Centrar") con una etiqueta de origen: "Del rol" (`'role'`), "Propias" (`'own'`) o "Aproximadas por dirección" (`'geocoded'`, con la confianza). Si no están en `'role'` y el rol tiene coordenadas, botón "Usar coordenadas del rol" (8.3).
- Un control por `field` según `type`: `string` → `Input`; `number` → `Input type=number`; `boolean` → `Switch`; `date` → `DatePicker`. Debajo, en gris, "Actual: …" si hay valor; placeholder "Sin valor".
- El campo `autonumber` se muestra destacado arriba y no es editable: el número, o "Sin número asignado" + botón "Asignar <label>" (editor/admin) → `AlertDialog` "Se asignará el N° 6.124 (número referencial). Asigna el número solo cuando el permiso esté aprobado y los derechos pagados. Esta acción no se puede deshacer." Tras asignar, muestra quién y cuándo. Admin ve además "Corregir número" (valor + motivo obligatorio). `HelpLink` a `registros/asignar-numero`.
- Bloque "Comentarios" (`Textarea`) y bloque "Adjuntos" (`AttachmentsList`: enlaces y archivos, con "+ Agregar enlace" / "+ Subir archivo" para editor/admin).
- Pie: "Cancelar"/"Cerrar" y "Guardar" (editor/admin) con `isPending`. Visor ve todo deshabilitado. Botón "Eliminar registro" (rojo, `AlertDialog`).
- Al guardar: `PATCH /api/records/:id` con solo los campos cambiados; invalidar `features`, `records`, `filters`. Un `Conflict` por identidad repetida (8.4) muestra el mensaje con botón "Abrir registro existente".

**`RoleSheet`** — ficha del rol (derecha, 400 px, `?role=<id>`)
- Carga `GET /api/roles/:roleId/records`. Cabecera: rol, badge "Vigente" / "No vigente", dirección del padrón, badge "N registros en M capas", botón "Ver en el mapa" (`flyTo` a las coordenadas del rol).
- Si no está vigente, aviso destacado arriba: "Subdividido el dd-mm-aaaa en 00050-00012, 00050-00013 (Res. 45/2024). Los permisos nuevos deben usar los roles resultantes." con enlaces a sus fichas. Si es resultado de una operación: "Proviene de la subdivisión de 00050-00001".
- Bloque "Historial del rol": línea de tiempo de `history` (tipo, fecha, referencia, roles de origen → resultantes, enlace al registro que la respalda, comentario). Botón "Registrar operación" (editor/admin) → `RoleOperationDialog`; admin puede eliminar una operación con motivo.
- Luego los registros agrupados por departamento → capa (ícono y color de la capa), cada uno con su resumen y fecha de actualización. Casilla "Incluir registros de roles anteriores" (si tiene origen): suma los registros de toda la cadena de roles de origen, cada uno con su rol original visible. Click → si la capa no es la de trabajo, la superpone; hace `flyTo` y abre el `RecordSidePanel` de ese registro.
- Se abre desde la búsqueda, desde el `RecordSidePanel` y desde la celda de rol en la tabla.

**`RoleOperationDialog`** (registrar operación sobre roles)
- Tipo (`Select` con los 4 tipos y una frase que explica cada uno), fecha, referencia (texto), registro que la respalda (opcional, buscador de registros de cualquier capa; por defecto el registro desde el que se abrió si aplica), comentario.
- Roles de origen (el rol de la ficha precargado) y roles resultantes: inputs de rol con máscara y `Combobox`; badge "nuevo" si no existe. La cantidad exigida cambia según el tipo (tabla de 8.9) y el formulario lo valida en vivo.
- Si algún rol resultante no tiene coordenadas: casilla "Usar la ubicación de origen mientras no se actualice el padrón".
- Resumen antes de confirmar: "El rol 00050-00001 dejará de estar vigente desde el 12-03-2024. Sus 4 registros conservan este rol." `HelpLink` a `roles/operaciones`.

**`PolygonSidePanel`** (derecha, 360 px, `?polygon=<id>`)
- Carga `GET /api/polygons/:id`. Nombre (editable para editor/admin), tipo, y para villas el sector.
- "Registros en este polígono": lista de capas con su conteo (ícono y color); click en una capa la superpone.
- "Documentos": `AttachmentsList` (plano de loteo, vivienda tipo, reglamento y certificado de copropiedad, links a Drive…).

**`CoordinateUpdateDialog`**
- Título "Confirmar cambio de coordenadas". Muestra rol (si hay), coordenadas anteriores → nuevas (6 decimales). Si hay rol: checkbox "Actualizar todos los registros con el mismo rol" con explicación + `HelpLink`. Botones "Cancelar" / "Confirmar cambio" → `PATCH /coordinates`.

**`FiltersPanel`** (derecha, 400 px)
- Cabecera "Filtros" + "Limpiar" + "Aplicar". Por cada campo de la capa de trabajo: si `/filters` devolvió lista → `Command`/checkbox-list con búsqueda interna y "(Vacío)" para `''`; si `'text'` → `Input` (prefijo). Filtro adicional "Ubicación": todas / sin coordenadas / aproximadas. Aplicar actualiza URL y refetch de `features`/`records`. Se limpian al cambiar de capa de trabajo.

**`RecordsTable`** (vista `table`, capa de trabajo)
- TanStack Table con datos de `/records` (servidor). Columnas: `Rol SII` (si `hasRole`; click abre la ficha del rol), `Latitud`, `Longitud`, una por `field` (`label`), `Actualizado`, `Acciones` (sticky derecha, editor/admin). Ordenables (`sort`), anchos redimensionables, `whitespace-nowrap` con scroll horizontal, cabecera sticky.
- Edición inline por fila (editor/admin): "Editar" convierte la fila en inputs; "Guardar" envía `PATCH` con los cambios; "Cancelar". "Eliminar" con `AlertDialog`. Click en una celda de coordenadas también entra en edición.
- Click en una fila (fuera de edición) abre `RecordSidePanel`. Botón "Ver en mapa" en la fila si tiene coordenadas.
- Pie: "Mostrando a–b de N", selector 25/50/100/200 (default 50), Primera/Anterior/Página X de Y/Siguiente/Última.
- La columna del correlativo no se edita inline; las filas sin número muestran "Sin número" y el `FiltersPanel` permite filtrar "con número / sin número".
- Indicador de filas sin coordenadas (ícono `MapPinOff`) o aproximadas — la tabla muestra **todos** los registros de la capa, el mapa solo los georreferenciados.

**`LayerFormDialog`** (crear / editar capa)
- Campos: Departamento (`Select` con los 4 del enum), Nombre, "Esta capa incluye Rol SII" (`Switch`), Ícono (preview + botón "Editar ícono" → `IconPicker`).
- **Campos**: editor de lista ordenable (label, tipo, requerido, botón eliminar; agregar campo). Al editar una capa existente, cambiar el label de un campo no cambia su `key` salvo que el usuario marque "renombrar clave"; eliminar muestra la advertencia de 7.2 con el conteo de registros afectados; cambiar el tipo muestra la vista previa de conversión de 7.2. El tipo "Correlativo" (`autonumber`) pide "¿Reinicia cada año?" y, si sí, el campo de año; en edición, un admin ve el próximo número y puede ajustarlo (con motivo). `HelpLink` a `capas/campos` y `capas/correlativos`.
- **Campos únicos** (`UniqueKeysEditor`): multi-select de campos, visible siempre. Texto: "Campos que, junto con el rol, identifican a un registro. Ej.: N° Permiso." (sin rol: "Campos que identifican a un registro. Ej.: Rut"). Al cambiar la selección muestra `previewDuplicates`. Si la capa no tiene campos únicos, aviso: "Sin campos únicos, reimportar un archivo creará registros repetidos". `HelpLink` a `capas/campos-unicos`.
- **Campo de dirección** (`Select` entre campos de texto, opcional): para georreferenciar por dirección. **Valor para mapas de calor** (`Select` entre campos numéricos, opcional). `HelpLink` a `capas/direccion-y-valor`.
- En edición además: botón "Importar registros" (abre `ImportWizard` con esta capa), historial de importaciones de la capa (`GET /api/imports?layerId=` con "Revertir"), y botón "Eliminar capa" (rojo, `AlertDialog` que exige escribir el nombre si tiene registros).
- Validación con `createLayerSchema`/`updateLayerSchema`.

**`IconPicker`**
- Modal grande: preview (ícono 48 px con color), 12 colores predefinidos (Gris `#6b7280`, Azul `#3b82f6`, Verde `#10b981`, Rojo `#ef4444`, Amarillo `#f59e0b`, Púrpura `#8b5cf6`, Rosa `#ec4899`, Índigo `#6366f1`, Teal `#14b8a6`, Naranja `#f97316`, Cian `#06b6d4`, Lima `#84cc16`) + `input type=color` + hex; buscador de íconos con grilla de 8 columnas virtualizada sobre los nombres de `lucide-react` (`icons` export → kebab-case), "Cancelar"/"Guardar cambios".

**`CreateRecordDialog`**
- Capa (`Select`, preseleccionada la de trabajo). Si `hasRole`: input de Rol con `Combobox` de sugerencias (`/api/roles?q=`), badge existente/nuevo/no vigente; al elegir uno existente con coordenadas se autocompletan lat/lon con aviso "Coordenadas del rol cargadas automáticamente". Al elegir uno no vigente, advertencia de 8.9 con botones para cambiar a un rol resultante.
- Ubicación (obligatoria en creación manual): lat/lon + botón "📍 Seleccionar en el mapa" + campo "Buscar dirección" (`/api/geocode`); si la dirección calza exacto con un predio del padrón en una capa con rol, propone ese rol.
- Un input por `field` de la capa (según tipo, salvo el correlativo, que se asigna después) y Comentarios. Los adjuntos se agregan después de crear, desde el panel.
- "Crear registro" → `POST /api/records`; si `Conflict` por identidad repetida (8.4), mostrar mensaje con botón "Abrir registro existente". Éxito → toast, cerrar, `flyTo` al nuevo punto y abrir su panel.

**`ExportDialog`**
- Capa (`Select`, default la de trabajo), Delimitador (`,`/`;`), texto "Columnas incluidas: …". "Exportar CSV" → descarga desde `/export` (`<a download>`).

**`ImportWizard`** (diálogo grande `max-w-6xl`, 4 pasos; se puede cerrar y retomar un borrador desde el historial)
1. **Archivo**: dropzone `.csv` / `.xlsx` (≤10 MB). Tras subir: si es Excel, selector de hoja; selector de fila de encabezados; para CSV, delimitador (auto/`,`/`;`/tab). Vista previa de 20 filas con los números de fila reales. `HelpLink` a `importacion/preparar-archivo`.
2. **Columnas y opciones**: tabla con una fila por encabezado: "Columna" → `Select` destino (`Rol SII`, `Latitud`, `Longitud`, cada `field.label`, `Ignorar`). Auto-mapeo por nombre (case/acento-insensible y alias de 8.1). Errores en línea ("Mapea el Rol SII o el campo de dirección", "Campo requerido X sin mapear"). Opciones: rango de filas (desde/hasta, opcional), "Si un registro ya existe" (`Preguntarme uno por uno` / `Omitirlo` / `Actualizarlo`), "Las celdas vacías no borran datos existentes" (on), "Buscar ubicación por dirección" (on si hay campo de dirección), "Este archivo es la capa completa (reemplazar)" (solo si la capa tiene campos únicos; desactiva el rango de filas y explica qué hace, con `HelpLink` a `importacion/reemplazar-capa`). Botón "Analizar".
3. **Revisión**: barra de progreso mientras analiza. Luego pestañas con contadores: **Con errores**, **Duplicados**, **Advertencias**, **Listas**, **Excluidas**. Tabla paginada con número de fila, valores y mensajes:
   - errores: edición inline de las celdas (revalida) o "Excluir";
   - duplicados: el registro existente al lado de la fila (diferencias resaltadas) y botones "Omitir" / "Actualizar existente" / "Crear igual"; acciones en bloque sobre la pestaña;
   - advertencias: para ubicaciones aproximadas, mini mapa con el punto y los candidatos, "Aceptar" / elegir candidato / fijar a mano; para rol sugerido, "Aceptar rol"; acciones en bloque.
   - con reemplazo completo, pestaña adicional **No están en el archivo**: registros existentes que el archivo no trae, con su resumen, marcados "Conservar" por defecto; "Eliminar" por registro o en bloque; los no borrables aparecen deshabilitados con su motivo y los creados en la plataforma destacados.
   - Indicador "Buscando N direcciones en OpenStreetMap…" mientras avance la geocodificación externa.
   - Pie: resumen "Se crearán X, se actualizarán Y, se omitirán Z, fallarán W" (+ "se eliminarán V" con reemplazo completo) y botón "Confirmar importación" (deshabilitado mientras haya duplicados sin resolver). "Descartar" borra el borrador.
4. **Resultado**: tarjetas Creados / Actualizados / Omitidos / Fallidos (/ Eliminados), el próximo correlativo de la capa si tiene uno, botón "Descargar filas con errores (N)" y "Cerrar".

### 10.3 `/admin` — Panel de administración (solo admin; otros roles ven "Sin acceso" con link "Volver al mapa")
- Header: kicker "Municipalidad de El Bosque", título "Panel de administración", link "Volver al mapa". Tabs: **Gestión de usuarios**, **Auditoría**.

**Usuarios** (`/admin/users`)
- Buscador (nombre o correo) + "Ver listado general" + botón "Crear usuario" (`CreateUserDialog`: nombre, correo, rol, contraseña temporal con botón "Generar"; al crear, muestra la contraseña una sola vez con botón copiar y el recordatorio "El usuario deberá cambiarla al ingresar").
- Lista paginada (20) en tarjetas o tabla: nombre, correo, badge rol, último acceso, indicador "Debe cambiar contraseña", `RoleActions` (tres botones "Asignar Administrador/Editor/Visor", el activo deshabilitado; "Quitar rol"), botón "Asignar contraseña temporal" (`ResetPasswordDialog`: genera una contraseña, la muestra una sola vez con botón copiar y avisa que se cerrarán las sesiones del usuario) y botón eliminar (rojo, `AlertDialog`). Paginación "Mostrando a–b de N".

**Auditoría** (`/admin/audit`)
- Sub-tabs **Logs** e **Importaciones**. Filtros: acción, entidad, capa, usuario, rango de fechas.
- Logs: badge de acción con colores (CREATE verde, UPDATE azul, DELETE rojo, IMPORT púrpura, REVERT naranjo), "Capa #id / Registro #id / Rol id / Usuario / Polígono #id / Adjunto / Importación", email del actor, fecha `es-CL`, `<details>` "Ver detalles" con JSON del `metadata` (diff before/after resaltado).
- Importaciones: nombre de archivo, badge de estado (Borrador/Analizando/En revisión/Completada/Revertida/Descartada/Fallida), capa, creados/actualizados/omitidos/fallidos, fecha, usuario, "Continuar" si está en revisión, "Descargar errores" si hay, "Revertir importación" (`AlertDialog`) si `COMPLETED`.
- Paginación real (20 por página).

### 10.4 Componentes de shell
- `app/(app)/layout.tsx`: valida la sesión en servidor y el cambio de contraseña obligatorio; `QueryClientProvider`, `Toaster`, `TooltipProvider`. Sin scroll global en `/map` (el mapa ocupa `h-dvh`), scroll normal en `/admin` y `/help`.
- `error.tsx` con "Algo salió mal" + reintentar; `not-found.tsx`.

### 10.5 GeoJSON de polígonos (conversión única y carga)
Los archivos legacy en `website-el-bosque/src/data/`:
- `poligono_comuna.geojson.js` → GeoJSON estándar válido (exportado por overpass-turbo). Guardar como `data/geo/comuna.geojson` (quitar `export const Comuna =`).
- `poligonos_sectores.geojson.js` (114 KB) y `poligonos_villas_poblaciones.geojson.js` (1.5 MB) → **formato propio**: `features[].{ id, type: 'poly', layerId, coordinates: [[ [lat, lon], ... ]] }` con coordenadas **invertidas** respecto a GeoJSON (el `layerId` de estos archivos no tiene relación con las capas de registros; se descarta). `scripts/convert-legacy-geojson.ts` los convierte a `FeatureCollection` de `Polygon` con `[lon, lat]`, `properties: { id, name? }`, y opcionalmente simplifica (`@turf/simplify`, tolerancia 0.00001) para bajar el peso de villas. Se ejecuta una vez y se versionan los `.geojson` resultantes en `data/geo/`.
- `pnpm geo:import` carga `data/geo/*.geojson` a `polygons` (`ST_Multi(ST_GeomFromGeoJSON(...))`, `ST_MakeValid`), idempotente por `(kind, code)`: actualiza geometría y conserva nombre editado y adjuntos.

### 10.6 Adjuntos
- `AttachmentsList` (registros y polígonos): lista con ícono por tipo (enlace, PDF, imagen, plano), título, quién y cuándo; enlaces abren en pestaña nueva; archivos se descargan desde `/api/attachments/:id/download`. Editor/admin: "+ Agregar enlace" (título + URL), "+ Subir archivo" (título + archivo, con límite y tipos de 5.5) y eliminar (`AlertDialog`).

### 10.7 Manual de uso (`/help`) — esqueleto

El manual queda **preparado** en esta versión: rutas, navegación, enlaces contextuales y una página por tema con su esquema de contenido. La redacción final se hace después.

Implementación:
- Páginas MDX en `content/help/<slug>.mdx` con `@next/mdx`. Cada página exporta `export const meta = { title, section, order, draft: true }`.
- `/help`: índice agrupado por sección con buscador por título (cliente). `/help/[...slug]`: la página, con navegación lateral y "Anterior/Siguiente".
- Las páginas con `draft: true` muestran el banner "Esta sección está en preparación" y, debajo, la lista "Qué se explicará aquí" (el contenido de la tabla de abajo), para que el esqueleto sea útil desde ya.
- `src/shared/help-slugs.ts` define la lista tipada de slugs. `HelpLink slug="capas/campos-unicos"` (ícono `CircleHelp`, tooltip "¿Cómo funciona?") solo acepta slugs de esa lista y abre la página en una pestaña nueva. Un test verifica que cada slug tenga su archivo MDX y viceversa.

Páginas y qué debe explicar cada una:

| slug | título | qué explicar |
|---|---|---|
| `primeros-pasos` | Primeros pasos | Qué es SIGDOM y para qué sirve; cómo ingresar; que las cuentas las crea un administrador; los tres roles (Administrador, Editor, Visor) y qué puede hacer cada uno; cambio obligatorio de la contraseña temporal; cómo cambiar la contraseña después. |
| `mapa/navegacion` | Navegar el mapa | Capa de trabajo vs capas superpuestas y cuándo usar cada una; agrupaciones de puntos (clusters) y zoom; polígonos de referencia; vista mapa vs vista tabla; que la dirección de la página se puede compartir y abre la misma vista. |
| `mapa/busqueda` | Buscar | Buscar por rol, por dirección o por cualquier campo; qué muestra cada grupo de resultados; "Ir a dirección". |
| `mapa/ficha-del-rol` | Ficha del rol | Qué muestra (dirección, vigencia, historial de operaciones, todos los registros del rol agrupados por departamento y capa); incluir registros de roles anteriores; cómo abrirla; cómo ir de la ficha a un registro. |
| `roles/operaciones` | Subdivisiones, fusiones y rectificaciones | Qué es cada tipo de operación y cuántos roles de origen y resultantes lleva; que los permisos anteriores conservan el rol original y los nuevos usan el resultante; qué significa "No vigente"; cómo registrar una operación desde la ficha y enlazar la resolución que la respalda; ubicación provisional de roles nuevos hasta actualizar el padrón; qué hacer si una operación se registró por error; cómo usar la lista de "roles que no vienen en el padrón" para detectar operaciones pendientes. |
| `mapa/mapas-de-calor` | Mapas de calor | Densidad vs valor, con ejemplos (incendios y emergencias por densidad; inversión en calzadas, veredas, sedes y plazas por monto); qué capas se pueden incluir y por qué algunas aparecen deshabilitadas; que los valores se suman y deben estar en la misma unidad; cómo leer la leyenda; radio e intensidad. |
| `mapa/poligonos` | Polígonos | Comuna, sectores y villas/poblaciones; información al pinchar un polígono; conteo de registros por capa; documentos adjuntos (planos de loteo, vivienda tipo, reglamento y certificado de copropiedad). |
| `capas/crear-y-editar` | Crear y editar capas | Departamento, nombre, ícono y color; qué significa "incluye Rol SII"; eliminar una capa y sus consecuencias. |
| `capas/campos` | Campos de una capa | Tipos de campo (texto, número, sí/no, fecha) y cuándo usar cada uno; campos requeridos; renombrar la etiqueta vs renombrar la clave; eliminar un campo borra sus valores; cambiar el tipo y cómo se convierten los valores existentes. |
| `capas/campos-unicos` | Campos únicos | Ver el esquema detallado abajo. |
| `capas/correlativos` | Correlativos | Qué es un campo correlativo y qué capas deberían tenerlo; que cada capa lleva su propia numeración; reinicio anual (solo para capas que numeran por año) y por qué entonces el año debe ser parte de los campos únicos; cómo se calcula el próximo número después de importar números históricos; quién puede ajustar el próximo número y cuándo hacerlo; convertir un campo existente en correlativo. |
| `capas/direccion-y-valor` | Dirección y valor para mapas de calor | Para qué sirve marcar el campo de dirección (georreferenciar registros sin rol ni coordenadas); para qué sirve el valor numérico (mapas de calor por valor) y por qué solo puede haber uno por capa. |
| `registros/crear-y-editar` | Crear y editar registros | Crear desde el botón; ubicar con el rol, con una dirección o haciendo clic en el mapa; editar en el panel o en la tabla; comentarios y adjuntos; mensaje de registro repetido y cómo abrir el existente. |
| `registros/asignar-numero` | Asignar el número de un permiso | Asignar el número solo cuando el permiso está aprobado y los derechos pagados; por qué no se puede deshacer; qué hacer con un permiso anulado (marcarlo, no borrarlo); cómo pedir a un administrador que corrija un número mal asignado. |
| `registros/coordenadas` | Ubicación de un registro | Coordenadas "del rol", "propias" y "aproximadas por dirección", y qué pasa con cada una cuando cambia el rol o el padrón; mover un marcador: solo este registro vs todos los del rol; "Usar coordenadas del rol". |
| `importacion/preparar-archivo` | Preparar el archivo | CSV o Excel; una fila de encabezados (y cómo indicar cuál es si hay títulos arriba); elegir la hoja; formatos aceptados de rol, fechas, números y coordenadas; tamaño máximo; qué columnas son obligatorias según la capa. |
| `importacion/asistente` | Importar paso a paso | Los cuatro pasos; mapear columnas; importar solo un rango de filas; qué significa cada pestaña de la revisión; corregir errores sin volver a subir el archivo; resolver duplicados uno por uno o en bloque (omitir, actualizar el existente, crear igual); que las celdas vacías no borran datos; retomar un borrador; que los borradores vencen a los 7 días. |
| `importacion/reemplazar-capa` | Volver a subir una planilla completa | Cuándo usarlo (la planilla se corrigió o reordenó entera); que requiere campos únicos; que los registros que vienen en el archivo se actualizan conservando ubicación, comentarios y adjuntos; revisar la pestaña "No están en el archivo" antes de eliminar; por qué algunos no se pueden eliminar; que se puede revertir. Alternativa: subir solo las filas nuevas con un rango. |
| `importacion/georreferenciacion` | Ubicación automática | De dónde salen las coordenadas (columnas del archivo, rol, padrón por dirección, OpenStreetMap); niveles de confianza; revisar y corregir ubicaciones aproximadas; por qué la búsqueda en OpenStreetMap puede tardar. |
| `importacion/revertir` | Historial y revertir | Dónde ver las importaciones; descargar las filas con errores; revertir (qué se borra y qué se restaura); aviso cuando hubo cambios posteriores a la importación. |
| `exportacion` | Exportar | Elegir capa y delimitador; abrir el CSV en Excel; columnas incluidas. |
| `administracion/usuarios` | Usuarios | Crear un usuario y entregarle la contraseña temporal; cambiar el rol; nombrar a otros administradores; asignar una contraseña temporal; eliminar; que un administrador no puede quitarse su rol ni eliminarse. |
| `administracion/auditoria` | Auditoría | Qué se registra; filtros; cómo leer el detalle de un cambio. |
| `administracion/padron-de-roles` | Padrón de roles | Qué es el CSV maestro; cuándo reimportarlo; cómo afecta a las coordenadas de los registros y a la búsqueda por dirección. |

Esquema de `capas/campos-unicos` (la página más importante del manual):
1. **Qué son**: los campos que, junto con el Rol SII, identifican a un registro dentro de una capa. Ejemplo: en Obras Menores, una propiedad puede tener varios permisos; el rol por sí solo no distingue uno de otro, el rol + N° Permiso sí.
2. **Para qué sirven**: detectar registros repetidos al importar y al crear a mano; que reimportar el mismo Excel actualice los registros existentes en vez de duplicarlos.
3. **Cómo se combinan con el rol**: en capas con rol, identidad = rol + campos únicos; sin campos únicos, un rol puede repetirse libremente y no se detectan duplicados. En capas sin rol, identidad = solo los campos únicos.
4. **Cómo elegirlos**: campos que no cambian con el tiempo y se llenan siempre (número de permiso, número de resolución, Rut); evitar campos escritos a mano o que cambian (propietario, dirección, observaciones). Si la capa tiene correlativo, normalmente es el campo único. Ejemplos sugeridos por capa (a validar con la DOM): Obras Menores, Obras Nuevas, Leyes 19.583 y 20.898 → N° Permiso; Recepción Final → N° Recepción Final; Subdivisión y Fusión → Resolución + Año (porque la numeración se reinició cada año hasta 2020); Actividades Comerciales → Rut; Puntos de parada → Nombre.
5. **Qué pasa con valores vacíos**: si falta alguno de los campos únicos, esa fila no se puede comparar y aparece como advertencia.
6. **Cambiarlos en una capa con datos**: no modifica registros; revisar el aviso "N grupos de registros repetidos" y qué hacer con ellos (revisarlos en la tabla, corregir o eliminar).
7. **Cómo se ve en la importación**: la pestaña Duplicados y las tres opciones (omitir, actualizar el existente, crear igual).

---

## 11. Seeds

`pnpm db:seed` es idempotente (upsert por `slug`). Crea las 15 capas siguientes. Los campos se crean con `type: 'string'`, `required: false` y la `key` derivada del label según 5.2. `uniqueKeys` queda vacío (lo configura la DOM desde la UI, guiada por el manual). `addressFieldKey = 'direccion'` en las capas que tienen el campo Dirección y `'direccion_comercial'` en Actividades Comerciales; `heatmapFieldKey` queda vacío.

| slug | department | hasRole | icon | name | fields |
|---|---|:-:|---|---|---|
| `obras-menores` | edificacion | ✓ | `hammer` | Obras Menores | Dirección; Población / Villa; Propietario; N° Permiso; M2; Fecha Aprobación; N° Folio; N° Ingreso; Destino; Recepción Final; Fecha Recepción Final |
| `obras-nuevas` | edificacion | ✓ | `building-2` | Obras Nuevas | Dirección; Propietario; N° Permiso; Fecha Aprobación; M2; Destino; Acogido; N° Ingreso |
| `ley-19583` | edificacion | ✓ | `file-text` | Ley 19.583 | Dirección; Población / Villa; Propietario; N° Permiso; M2; Fecha; N° Solicitud |
| `ley-20898` | edificacion | ✓ | `scroll-text` | Ley 20.898 | Dirección; N° Permiso; M2; Fecha Aprobación; Propietario; N° Ingreso; Destino |
| `ley-20251` | edificacion | ✓ | `scale` | Ley 20.251 | Dirección; N° Ley; Propietario; M2 |
| `recepcion-final` | edificacion | ✓ | `clipboard-check` | Recepción Final | Tipo; N° Permiso; N° Resolución; Tipo de Permiso; Fecha; Dirección; M2; Propietario; Destino; N° Recepción Final; Parcial o Total |
| `subdivision-fusion` | edificacion | ✓ | `split` | Subdivisión y Fusión | Dirección; Propietario; Resolución; Año; N° Caja |
| `inmuebles-municipales` | edificacion | ✓ | `landmark` | Inmuebles Municipales | N°; Dirección; Población; SP; Establecimiento; Tipología Destino; Permiso; Recepción; Planos; M2; M2 Terreno; Observaciones |
| `calzadas` | ejecucion | | `move-horizontal` | Calzadas | (ninguno) |
| `infraestructura-deportiva` | ejecucion | | `trophy` | Infraestructura deportiva | (ninguno) |
| `platabandas-plazas` | ejecucion | | `trees` | Platabandas - Plazas | (ninguno) |
| `puntos-de-parada` | ejecucion | | `bus` | Puntos de parada | Nombre |
| `veredas` | ejecucion | | `footprints` | Veredas | (ninguno) |
| `actividades-comerciales-industrias-riesgo` | emergencias | | `triangle-alert` | Actividades Comerciales e Industrias con Riesgo | Rut; Razón Social; Dirección Comercial; Giro; Nivel de Riesgo; Material Peligroso; Tipo |
| `viviendas-csp` | vivienda | ✓ | `home` | Viviendas CSP | N; Rut; Nombre; Dirección; Población; Sector; Correo; Teléfono; Comité; Año Construcción; Estado Proyecto |

`iconColor` por defecto `#3b82f6` para todas (el legacy no definía color en seeds). `sortOrder` = posición en esta tabla.

`pnpm roles:import <ruta.csv>`: importa el padrón de roles (`backend-el-bosque/seeds/data/roles.csv`, ~42.600 filas, delimitador `;`, cabeceras `roleId;DIRECCION;COMPLEMENTO;lat;lon`) usando `roles.service.importRoleCoordinates`. **No** versionar el CSV (datos personales); documentar en `docs/DEPLOY.md` dónde colocarlo.

`pnpm geo:import`: carga los polígonos de `data/geo/` (10.5).

---

## 12. Infraestructura y configuración

### 12.1 Variables de entorno (`src/env.ts`, `.env.example`)
```
DATABASE_URL=postgres://postgres:password@localhost:5432/sigdom
BETTER_AUTH_SECRET=            # openssl rand -base64 32
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty
NEXT_PUBLIC_APP_URL=http://localhost:3000
STORAGE_DIR=./storage          # en Docker: /data/storage (volumen)
MAX_IMPORT_FILE_MB=10
MAX_ATTACHMENT_MB=20
GEOCODER_PROVIDERS=padron,nominatim
NOMINATIM_URL=https://nominatim.openstreetmap.org
PHOTON_URL=                    # vacío = desactivado
GEOCODER_CONTACT_EMAIL=        # obligatorio si se usa nominatim/photon público (política de uso)
LOG_LEVEL=info
```

### 12.2 Docker
- `Dockerfile` multi-stage: `deps` (pnpm install --frozen-lockfile) → `build` (`pnpm build` con `output: 'standalone'`, `drizzle-kit generate` ya versionado) → `runner` (node:22-alpine, usuario no root, `dumb-init`, copia `.next/standalone`, `.next/static`, `public`, `content`, `data/geo`, `drizzle/`, `scripts/` compilados con `tsx`). `HEALTHCHECK` a `/api/health`.
- `entrypoint.sh`: `node scripts/migrate.js` (aplica migraciones con `drizzle-orm/postgres-js/migrator`) y luego `node server.js`. El servicio `worker` usa la misma imagen con comando `node scripts/worker.js` (sin migraciones).
- `docker-compose.yml` (dev): `db` (`postgis/postgis:17-3.5`, puerto 5432, volumen) + `app`/`worker` opcionales. En dev normal se usa `pnpm dev` y `pnpm worker` contra la BD del compose.
- `docker-compose.prod.yml`: `db` (sin puerto expuesto, healthcheck, volumen `db_data`, `./backups`), `app` (env desde `.env.production`, `expose 3000`, volumen `app_storage` en `/data/storage`), `worker` (mismo env y volumen), `caddy` (puertos 80/443, `Caddyfile` con `sigdomelbosque.cl { reverse_proxy app:3000 }`, volumen para certificados). Límites de recursos: db 1 CPU/1 GB, app 1 CPU/512 MB, worker 1 CPU/512 MB.
- `scripts/backup-db.sh` (pg_dump gzip + tar del volumen `app_storage`, retención 7 días) y `restore-db.sh` adaptados a los nuevos nombres de servicio; `crontab.example` con backup diario 02:00. El backup incluye las tablas de auth (usuarios y contraseñas hasheadas) y los adjuntos: proteger el directorio `./backups`.
- `docs/DEPLOY.md`: pasos de primer despliegue (DNS, `.env.production` con `BETTER_AUTH_SECRET` propio y `GEOCODER_CONTACT_EMAIL`, `docker compose up -d`, `docker compose exec app node scripts/seed.js`, `docker compose exec app node scripts/geo-import.js`, `docker compose exec app node scripts/import-roles.js /tmp/roles.csv`, `docker compose exec app node scripts/create-admin.js --email ... --name ...`).

### 12.3 `next.config.ts`
- `output: 'standalone'`, `reactStrictMode`, `pageExtensions` con `mdx` (`@next/mdx`), `headers()` con CSP (`default-src 'self'`; `script-src 'self' 'unsafe-inline'`; `connect-src 'self' https://tiles.openfreemap.org https://tile.openstreetmap.org`; `img-src 'self' data: blob: https:`; `worker-src 'self' blob:` (MapLibre); `frame-ancestors 'none'`; `form-action 'self'`), `X-Content-Type-Options`, `Referrer-Policy`. La geocodificación externa se hace desde el servidor, no necesita CSP.
- `experimental.serverActions.bodySizeLimit` no aplica a Route Handlers; los límites de import y adjuntos se validan a mano.

### 12.4 Scripts `package.json`
`dev`, `worker`, `build`, `start`, `lint`, `typecheck`, `test`, `test:e2e`, `db:generate`, `db:migrate`, `db:studio`, `db:seed`, `roles:import`, `geo:convert`, `geo:import`, `auth:create-admin`, `knip`.

### 12.5 CI (GitHub Actions)
`pnpm install` → `typecheck` → `lint` → `knip` → `drizzle-kit check` → `vitest` → build Docker. Playwright en un job aparte con PostGIS de servicio y el worker levantado (el job crea sus usuarios de prueba con `auth:create-admin` y `auth.api.createUser`). Los tests nunca llaman a Nominatim/Photon reales: el proveedor externo se reemplaza por uno falso.

---

## 13. Plan de ejecución por fases

Cada fase termina con: `pnpm typecheck && pnpm lint && pnpm test` en verde, commit, y una nota en `docs/DECISIONS.md` si hubo decisiones.

**Fase 0 — Bootstrap**
- `create-next-app` (TS, App Router, Tailwind, `src/` no —usar la estructura de la sección 4—), pnpm, ESLint/Prettier, shadcn init, Vitest, Playwright, knip, `env.ts`, `docker-compose.yml` con PostGIS, README con cómo levantar.
- Aceptación: `pnpm dev` muestra la página de ingreso; `pnpm test` corre un test trivial; CI en verde.

**Fase 1 — Base de datos**
- Esquema Drizzle completo (sección 5, incluidas las tablas de auth de 5.9), extensiones `postgis` y `pg_trgm`, primera migración, `db:seed` con las 15 capas, `normalizeAddress`, `roles:import` con dirección normalizada, `geo:convert`, `geo:import`, `storage.ts`, pg-boss + `worker` con una tarea de prueba.
- Tests: `normalizeRoleId`, `parseCoordinate`, casteo de valores por tipo, `normalizeAddress`, esquemas Zod de `fields`.
- Aceptación: seed y `geo:import` idempotentes (segunda ejecución = 0 cambios); import de 42k roles < 30 s; `drizzle-kit check` sin drift; el worker procesa la tarea de prueba.

**Fase 2 — Auth y shell**
- Better Auth (instancia, handler, middleware, `permissions.ts`, plugin admin, registro deshabilitado, `must_change_password`), `getActor/requireRole`, `errors.ts`, `/` con login, `/account/password`, `UserMenu` + `AccountDialog`, `auth:create-admin`, layout de `/map` vacío con sidebar que lista capas desde `/api/layers`, `/admin` con guard.
- Aceptación: sin sesión → redirect; login/logout funcionan; `POST /api/auth/sign-up/email` responde error; un usuario con contraseña temporal no accede a nada hasta cambiarla; visor no ve botones de edición; API responde 401/403 correctos (tests de Route Handlers con `vitest` + `next-test-api-route-handler` o llamando a los handlers directamente); 6 intentos fallidos de login en un minuto → 429.

**Fase 3 — Capas CRUD**
- `layers.service`, Route Handlers, `LayerFormDialog` (editor de campos incluido el tipo correlativo, renombres y conversión de tipo 7.2, `UniqueKeysEditor` con `previewDuplicates`, campo de dirección, valor para mapas de calor), `IconPicker`, eliminación con confirmación.
- Aceptación: crear capa, agregar/renombrar/eliminar campo con registros existentes migra el JSONB; cambiar un campo a número convierte los valores convertibles y reporta los demás; convertir a correlativo falla si hay valores no enteros; `previewDuplicates` cuenta bien los grupos (tests de servicio).

**Fase 4 — Mapa interactivo**
- `getFeatures`, `MapView` con MapLibre: capa de trabajo + superpuestas, clusters, símbolos con íconos, selección, `RecordSidePanel` (lectura y edición completa incl. rol, comentarios, adjuntos de tipo enlace), `RoleSheet` (sin historial de operaciones, que llega en la fase 6), polígonos desde la API, búsqueda (registros y roles), `flyTo`, estado en URL.
- Aceptación: capa con 40k puntos se mueve a 60 fps con 2 capas superpuestas; abrir/editar/guardar un registro refleja el cambio sin recargar; la ficha de un rol con registros en 3 capas los muestra agrupados; e2e "editar rol desde el panel" pasa.

**Fase 5 — Tabla, filtros, export**
- `listRecords` paginado/ordenado/filtrado, `RecordsTable` con edición inline, `FiltersPanel` (incluye filtro de ubicación), `getFilterOptions`, `ExportDialog` + stream CSV.
- Aceptación: página de 50 filas responde < 300 ms con 40k registros; export de 40k filas abre correctamente en Excel (BOM, `;`).

**Fase 6 — Crear y mover registros, geocodificación, correlativos, operaciones de rol**
- Geocodificador (8.7: `padron`, `nominatim`, `photon`, caché, límite de tasa en el worker), `/api/geocode`, búsqueda "Ir a dirección", `CreateRecordDialog` (selección en mapa, autocompletado de rol, buscar dirección), `CoordinateUpdateDialog`, `updateCoordinates` con scope, reglas 8.3/8.4, `numbering.service` y la asignación de número en el panel (8.8).
- `roleOperations.service`, `RoleOperationDialog`, historial y vigencia en `RoleSheet`, avisos en `RecordSidePanel`, `CreateRecordDialog` y búsqueda (8.9).
- Aceptación adicional de operaciones: una subdivisión deja al rol de origen no vigente sin tocar sus registros; crear un registro con el rol de origen muestra la advertencia con los resultantes; la ficha de un rol resultante con "Incluir registros de roles anteriores" muestra los permisos del rol original; eliminar la operación devuelve la vigencia (tests de servicio).
- Aceptación adicional de correlativos: 20 asignaciones simultáneas en la misma capa producen 20 números consecutivos sin repetidos ni huecos; con números históricos hasta N, la primera asignación da N+1; borrar el registro con el último número no hace que se reutilice; reinicio anual usa una secuencia por año (tests de servicio).
- Aceptación: tests de servicio para cada regla de 8.3 (en particular: re-importar el padrón con coordenadas corregidas mueve los registros `'role'` y `'geocoded'` y no los `'own'`) y de 8.4 (mismo rol con distinto N° Permiso no es duplicado; mismo rol y mismo N° Permiso sí; campos únicos vacíos no se comparan); tests del geocodificador con padrón de prueba (`exact`, `interpolated`, `approx`) y proveedor externo falso (respeta 1 req/s y usa la caché); e2e de creación con click en mapa.

**Fase 7 — Importación en dos fases**
- `server/import/*` (8.5) con tareas del worker, lectura CSV y XLSX, `ImportWizard` completo, errores CSV, revertir con snapshots, limpieza de borradores.
- Aceptación: fixture XLSX de 10k filas con títulos sobre los encabezados, errores, duplicados (contra la BD y dentro del archivo) y direcciones sin coordenadas: se analiza en < 20 s; corregir una celda en la revisión la revalida; "omitir todos los duplicados" en bloque funciona; confirmar crea y actualiza lo esperado; el CSV de errores contiene exactamente las filas fallidas; revertir restaura los registros actualizados; reemplazo completo de una capa actualiza los que calzan conservando id y adjuntos, lista los que faltan, no permite borrar los que tienen adjuntos o correlativo asignado, y revertir devuelve los borrados con su id (tests de servicio + e2e del asistente).

**Fase 8 — Administración y auditoría**
- `/admin/users` (listar, buscar, crear con contraseña temporal, roles, contraseña temporal, eliminar), `/admin/audit` con filtros y paginación real (logs e importaciones), `users.service` con protecciones.
- Aceptación: un admin no puede quitarse su rol ni borrarse; un admin puede nombrar a otro admin; asignar contraseña temporal cierra las sesiones del usuario y obliga a cambiarla; editor solo revierte sus importaciones.

**Fase 9 — Polígonos, adjuntos y mapas de calor**
- `PolygonSidePanel` con conteos por capa y edición de nombre, `polygons/stats`, `attachments.service` con archivos (storage) y enlaces para registros y polígonos, `HeatmapPanel` (densidad y valor).
- Aceptación: el conteo de registros de una capa dentro de un sector coincide con un cálculo de referencia; subir, descargar y eliminar un archivo adjunto funciona y respeta tamaño y tipo; mapa de calor por valor con 2 capas usa el campo configurado de cada una y excluye las capas sin campo numérico.

**Fase 10 — Manual (esqueleto)**
- `@next/mdx`, `/help` con índice y navegación, las páginas de 10.7 como borradores con su lista "Qué se explicará aquí", `HelpLink` en todos los lugares indicados en la sección 10, test de slugs.
- Aceptación: todas las páginas de la tabla de 10.7 existen y se ven; ningún `HelpLink` apunta a una página inexistente.

**Fase 11 — Producción**
- Dockerfile standalone, compose prod (app + worker + db + caddy), backups de BD y adjuntos, `DEPLOY.md`, `API.md`, CSP verificada, `knip` limpio, Lighthouse accesibilidad ≥ 90 en `/map`.
- Aceptación: `docker compose -f docker-compose.prod.yml up` levanta todo con healthchecks verdes; smoke e2e contra el contenedor (incluye una importación completa procesada por el worker).

---

## 14. Checklist final antes de dar por terminado

- [ ] No existe `record_attributes` ni ningún concepto equivalente en código o UI.
- [ ] El concepto de capa se llama `layer`/"capa" en todo el código, BD, API y UI; `map` solo se usa para la visualización.
- [ ] Un rol puede tener varios registros en la misma capa; los duplicados se detectan solo por rol + campos únicos.
- [ ] Los correlativos se asignan solo con la acción explícita, sin repetidos ni huecos bajo concurrencia, y el contador nunca baja.
- [ ] Ningún `alert`, `confirm`, `console.log` en `src/`.
- [ ] Ninguna dependencia de la lista "no se traen" (sección 2) en `package.json`.
- [ ] Ninguna plataforma externa con cuenta o credenciales; no existe registro público de usuarios.
- [ ] Las llamadas a Nominatim/Photon pasan por la caché y respetan 1 petición por segundo.
- [ ] Todos los textos de la UI en español; fechas `es-CL`.
- [ ] Todos los endpoints tienen esquema Zod de entrada y test de autorización.
- [ ] Todo `HelpLink` apunta a una página existente del manual.
- [ ] `knip`, `typecheck`, `lint`, `vitest`, `playwright` en verde en CI.
- [ ] `docs/DECISIONS.md` registra cada desviación de este prompt.

---

## Apéndice A — Recursos a copiar del legacy

| Origen | Destino | Nota |
|---|---|---|
| `website-el-bosque/public/logo_el_bosque.png` | `public/logo_el_bosque.png` | |
| `website-el-bosque/src/data/poligono_comuna.geojson.js` | `data/geo/comuna.geojson` | quitar `export const` |
| `website-el-bosque/src/data/poligonos_sectores.geojson.js` | `data/geo/sectores.geojson` | convertir (10.5) |
| `website-el-bosque/src/data/poligonos_villas_poblaciones.geojson.js` | `data/geo/villas-poblaciones.geojson` | convertir + simplificar |
| `backend-el-bosque/seeds/data/roles.csv` | fuera del repo | `;` — `roleId;DIRECCION;COMPLEMENTO;lat;lon` |
| `backend-el-bosque/src/seeds/seed-data.ts` | `src/db/seed/layers.seed.ts` | reescrito según sección 11 |
| `backend-el-bosque/scripts/backup-db.sh`, `restore-db.sh`, `crontab.example` | `scripts/` | adaptar nombres de servicio y agregar el volumen de adjuntos |

## Apéndice B — Glosario

- **Capa** (`layer`): conjunto temático de registros con esquema propio de columnas (`fields`). En el legacy se llamaba `map`. No es un mapa base, ni un archivo, ni una style layer de MapLibre.
- **Capa de trabajo**: la capa sobre la que se filtra, busca, ve en tabla y crea registros. Hay una a la vez.
- **Capa superpuesta**: capa adicional que solo se dibuja en el mapa para comparar.
- **Campos únicos** (`uniqueKeys`): campos que, junto con el rol, identifican a un registro dentro de su capa; definen qué es un duplicado.
- **Correlativo** (`autonumber`): número incremental propio de cada capa (N° Permiso, N° Recepción Final…), asignado por la plataforma al final del proceso, sin repetidos ni huecos.
- **Mapa**: la visualización MapLibre donde se dibujan los registros de las capas visibles y los polígonos.
- **Style layer**: capa de dibujo de MapLibre (`circle`, `symbol`, `fill`, `line`, `heatmap`). Detalle de implementación del mapa, sin relación con las capas de datos.
- **Registro** (record): fila georreferenciada (o pendiente de georreferenciar) que pertenece a una capa.
- **Rol / Rol SII**: identificador predial `NNNNN-NNNNN`; entidad `roles` con ubicación de referencia y dirección.
- **Operación de rol**: subdivisión, fusión, rectificación o modificación registrada en el historial de roles; enlaza roles de origen y resultantes sin cambiar los registros existentes.
- **Rol no vigente**: rol reemplazado por una operación; sus registros anteriores lo conservan, los nuevos deberían usar el rol resultante.
- **Padrón de roles**: el CSV maestro con todos los roles de la comuna, su dirección y coordenadas; base de la georreferenciación por dirección.
- **Geocodificar**: obtener coordenadas a partir de una dirección (8.7).
- **Departamento**: agrupador de capas (Edificación y Urbanismo, Ejecución de Obras, Emergencias, Vivienda).
- **Importación**: una carga de un archivo CSV o Excel sobre una capa; pasa por análisis, revisión y confirmación, y es reversible.
- **Polígonos**: áreas de referencia guardadas en la BD (límite comunal, sectores, villas/poblaciones), con nombre, adjuntos y conteo de registros. No tienen columnas propias.
- **Adjunto**: enlace o archivo asociado a un registro o a un polígono.
