# API HTTP

Contratos de los Route Handlers de `app/api/**` (PROMPT.md §9). La API es _same-origin_: la consume la propia interfaz con `fetch` y la sesión viaja en una cookie de Better Auth; no hay CORS ni tokens. Todos los cuerpos de entrada se validan con los esquemas Zod de `src/shared/schemas/*` y las respuestas usan los tipos de `src/shared/types.ts`, compartidos con el cliente.

> Estado: esta tabla documenta el contrato objetivo de §9. Las rutas se van implementando por fases; una ruta no implementada responde 404 de Next.

## Convenciones

### Autenticación y roles

- Sin sesión, `proxy.ts` responde `401` con el cuerpo de error uniforme en `/api/*` (salvo `/api/auth/*` y `/api/health`). La validación real de la sesión ocurre en cada handler (`getActor()`), nunca solo por la cookie.
- Roles: `viewer` ⊂ `editor` ⊂ `admin`. En la tabla, "viewer" significa cualquier usuario autenticado (incluido "Sin rol", que se trata como visor); "editor" incluye a admin. Rol insuficiente → `403 FORBIDDEN`.
- Usuario con contraseña temporal (`must_change_password`): toda la API responde `403 PASSWORD_CHANGE_REQUIRED` salvo `/api/auth/*`. Al cambiar la contraseña, el servidor apaga la marca.
- "(propia)": un editor solo opera sobre importaciones que creó; un admin sobre todas.

### Formato de error

Único para toda la API (`src/server/errors.ts`):

```json
{ "error": { "code": "VALIDATION", "message": "N° Permiso: es obligatorio", "details": { "issues": [] } } }
```

| `code`                     | HTTP | Cuándo                                                                                                                                   |
| -------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `VALIDATION`               | 400  | Cuerpo, query o parámetro no pasa el esquema Zod (`details.issues[]` con `path` y `message`)                                             |
| `UNAUTHORIZED`             | 401  | Sin sesión o sesión vencida                                                                                                              |
| `FORBIDDEN`                | 403  | Rol insuficiente o recurso ajeno ("propia")                                                                                              |
| `PASSWORD_CHANGE_REQUIRED` | 403  | Contraseña temporal pendiente de cambio                                                                                                  |
| `NOT_FOUND`                | 404  | El recurso no existe                                                                                                                     |
| `CONFLICT`                 | 409  | Estado incompatible: duplicado por identidad (`details: DuplicateConflictDetails`), capa con registros, importación en otro estado, etc. |
| `RATE_LIMITED`             | 429  | Límite de tasa superado                                                                                                                  |
| `INTERNAL`                 | 500  | Error no controlado (se registra en el log; el mensaje es genérico)                                                                      |

Los `message` están en español y pensados para mostrarse al usuario.

**Ambiente de pruebas** (`NEXT_PUBLIC_DEPLOY_MODE=staging`, `docs/DEPLOY.md` §7): `POST /api/attachments` con archivo, `GET /api/attachments/:id/download` y `POST /api/roles/import` responden `409 CONFLICT` con un mensaje que indica la alternativa; `POST /api/imports` rechaza (`400 VALIDATION`) planillas de más de 4 MB o 1.000 filas; analizar y confirmar corren en la misma invocación (sin worker); `GET /api/imports/:id` incluye `stalled: true` si un análisis quedó cortado, y en ese caso `POST /api/imports/:id/analyze` lo vuelve a lanzar.

### Paginación

Los listados paginados aceptan `page` (desde 1, por defecto 1) y `pageSize` (1–200, por defecto 50; `paginationSchema`) y responden `Paginated<T>`:

```ts
{ data: T[]; total: number; page: number; pageSize: number }
```

Ordenamiento: `sort` y `dir` (`asc` | `desc`) donde se indica.

### Filtros por campo (`filters[k]=v`)

Los endpoints de registros y features filtran por campo de la capa con la sintaxis de query `filters[<fieldKey>]=<valor>`; una misma clave repetida se interpreta como "cualquiera de" (`filters[destino]=Vivienda&filters[destino]=Comercio`). Para campos de texto libre el valor se compara con "contiene" sin distinguir mayúsculas ni acentos; para campos con pocas opciones (ver `GET /api/layers/:id/filters`) es igualdad. `src/lib/api.ts` (`buildQuery`) serializa `{ filters: { destino: ['Vivienda'] } }` con esta sintaxis.

Parámetros booleanos en query aceptan `true|1|on` y `false|0` (`boolish`). Las fechas en query van como `aaaa-mm-dd` (`isoDateSchema`).

### Límites de tasa

| Ámbito                                   | Límite                    | Implementación                                            |
| ---------------------------------------- | ------------------------- | --------------------------------------------------------- |
| `POST /api/auth/sign-in/email`           | 5 por minuto por IP       | Better Auth (`rateLimit.customRules`)                     |
| `POST /api/auth/change-password`         | 10 por minuto por IP      | Better Auth                                               |
| Resto de `/api/auth/*`                   | 60 por minuto por IP      | Better Auth                                               |
| `POST /api/imports` (subida de archivos) | 10 por minuto por usuario | `rateLimit('importUpload')` en `src/server/rate-limit.ts` |
| `GET /api/geocode`                       | 30 por minuto por usuario | `rateLimit('geocode')`                                    |
| `POST /api/attachments` (archivo)        | 30 por minuto por usuario | `rateLimit('attachmentUpload')`                           |
| `/api/admin/*`                           | 60 por minuto por usuario | `rateLimit('admin')`                                      |

Al superarlos: `429 RATE_LIMITED` (Better Auth responde 429 con su propio cuerpo y cabecera `X-Retry-After`). La IP se toma de `X-Forwarded-For`, que Caddy fija con la IP real del cliente.

### Tamaños

Importaciones: `MAX_IMPORT_FILE_MB` (10 por defecto). Adjuntos: `MAX_ATTACHMENT_MB` (20 por defecto) y solo los tipos/extensiones de `attachmentAllowedMimeTypes` / `attachmentAllowedExtensions` (`src/shared/constants.ts`). Padrón (`POST /api/roles/import`): 20 MB. Las tres rutas de subida (`POST /api/attachments` con archivo, `POST /api/imports` y `POST /api/roles/import`) rechazan por `Content-Length` antes de leer el cuerpo, con un margen de 1 MB para el multipart: si se pasa, o si falta `Content-Length`, responden `400 VALIDATION`. En producción, Caddy corta en 25 MB el cuerpo que la app lea y responde `413`; no rechaza por `Content-Length`, así que una petición que la app no lee (sin sesión, o una subida que rechaza por su tamaño) recibe la respuesta de la app.

### Fechas y números

Las respuestas son JSON: las fechas viajan como texto ISO 8601 (`Jsonified<T>`), las coordenadas como números decimales (`lat`, `lon`, WGS84), los ids de capas/registros/polígonos son enteros y los de usuarios/importaciones son UUID. Los roles SII se devuelven normalizados (`NNNNN-NNNNN`) y se aceptan en cualquier formato tolerante (`normalizeRoleId`, §8.1).

---

## Público

| Método y ruta            | Entrada                                                                                                                                                                                                                                                                                                                                   | Respuesta                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET`/`POST /api/auth/*` | Solo los endpoints de Better Auth que usa la UI: `GET get-session` y `POST` a `sign-in/email`, `sign-out`, `change-password` (siempre cierra las otras sesiones y rechaza repetir la contraseña actual con `PASSWORD_UNCHANGED`) y `update-user`. El resto (incluidos `sign-up/email` y los del plugin `admin`) responde `404 NOT_FOUND`. | Según Better Auth                                                                                                    |
| `GET /api/health`        | —                                                                                                                                                                                                                                                                                                                                         | `{ status: 'ok', db: 'ok' }` (200) o `{ status: 'degraded', db: 'error' }` (503). Lo usa el `HEALTHCHECK` de Docker. |

## Capas

| Método y ruta                             | Rol                                         | Entrada                                                                                                     | Respuesta                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/layers`                         | viewer                                      | —                                                                                                           | `LayerWithCount[]` (capas con `recordCount` y `numberedRecordCount`, ordenadas por `sortOrder`)                                                                                                                                                                                                                               |
| `POST /api/layers`                        | editor                                      | `createLayerSchema` → `CreateLayerInput`                                                                    | `Layer` · 201                                                                                                                                                                                                                                                                                                                 |
| `GET /api/layers/:id`                     | viewer                                      | —                                                                                                           | `Layer`                                                                                                                                                                                                                                                                                                                       |
| `PATCH /api/layers/:id`                   | editor                                      | `updateLayerSchema` → `UpdateLayerInput` (incluye `renames[]`, `convertTypes[]` y `reason?`, §7.2)          | `Layer`. `400 VALIDATION` si un campo cambia de tipo sin estar en `convertTypes`. Si el cambio quita el correlativo, lo deja con otro tipo o elimina su campo de año, y hay registros con número asignado: `403` si no es admin; `400 VALIDATION` con `details: { reasonRequired: true, count }` si es admin y falta `reason` |
| `DELETE /api/layers/:id`                  | editor (admin si tiene registros numerados) | `deleteLayerSchema`: `{ reason? }`                                                                          | 204. Elimina la capa, sus registros, adjuntos e importaciones. Con registros numerados: `403` si no es admin; `400` con `details.reasonRequired` si falta `reason`. Los números quedan en auditoría                                                                                                                           |
| `GET /api/layers/:id/features`            | viewer                                      | `featuresQuerySchema`: `search?`, `filters[k]`, `weight?`, `hasCoordinates?`, `coordsSource?`, `hasNumber?` | `RecordFeatureCollection` (GeoJSON `FeatureCollection<Point>`; `properties` con `id`, `roleId`, `coordsSource`, los 3 primeros campos y `w` si `weight=1`)                                                                                                                                                                    |
| `GET /api/layers/:id/records`             | viewer                                      | `recordsQuerySchema`: `page`, `pageSize`, `sort` (`id                                                       | roleId                                                                                                                                                                                                                                                                                                                        | lat | lon | updatedAt | createdAt | attr:<key>`), `dir`, `search?`, `filters[k]`, `hasCoordinates?`, `coordsSource?`, `hasNumber?` | `Paginated<RecordListItem>` |
| `GET /api/layers/:id/filters`             | viewer                                      | —                                                                                                           | `FilterOptions`: `{ [fieldKey]: string[] \| 'text' }` (lista de valores si hay pocos distintos; `'text'` si es texto libre)                                                                                                                                                                                                   |
| `GET /api/layers/:id/duplicates?keys=a,b` | editor                                      | `duplicatesPreviewQuerySchema` (`keys` separados por coma)                                                  | `DuplicatesPreview` (`groups`, `records`, `sample[]`) para `UniqueKeysEditor`                                                                                                                                                                                                                                                 |
| `GET /api/layers/:id/export?delimiter=;`  | viewer                                      | `exportQuerySchema` (`delimiter` `;` por defecto o `,`) + los mismos filtros de `records`                   | CSV (`text/csv; charset=utf-8`, con BOM, `Content-Disposition: attachment`), en streaming                                                                                                                                                                                                                                     |
| `GET /api/layers/:id/counters`            | editor                                      | —                                                                                                           | `LayerCounter[]`: `{ fieldKey, period, lastValue, next }[]` (§8.8)                                                                                                                                                                                                                                                            |
| `PUT /api/layers/:id/counters`            | admin                                       | `setNextNumberSchema`: `{ period?, next, reason }`                                                          | `{ next }`. `409` si `next` es menor o igual al último asignado (el contador nunca baja)                                                                                                                                                                                                                                      |

## Registros

| Método y ruta                        | Rol                                 | Entrada                                                                                    | Respuesta                                                                                                                                     |
| ------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/records`                  | editor                              | `createRecordSchema` → `CreateRecordInput`                                                 | `RecordDetail` · 201. `409 CONFLICT` con `details: DuplicateConflictDetails` si ya existe un registro con el mismo rol + campos únicos (§8.4) |
| `GET /api/records/:id`               | viewer                              | —                                                                                          | `RecordDetail` (registro + `role`, `layer`, `attachments`, `sameRoleCount`, `backsOperation`, `roleLastOperation`)                            |
| `PATCH /api/records/:id`             | editor                              | `updateRecordSchema` → `UpdateRecordInput`                                                 | `RecordDetail`                                                                                                                                |
| `PATCH /api/records/:id/coordinates` | editor                              | `updateCoordinatesSchema`: `{ lat, lon, scope: 'record' \| 'role' }` o `{ useRole: true }` | `{ updated: number }` (registros reubicados; con `scope: 'role'` mueve también el rol y los registros que dependen de él, §8.3)               |
| `POST /api/records/:id/number`       | editor                              | —                                                                                          | `{ number }`. Asigna el siguiente correlativo de la capa (§8.8). `409` si ya tiene número o la capa no tiene campo correlativo                |
| `PUT /api/records/:id/number`        | admin                               | `setNumberSchema`: `{ value: number \| null, reason }`                                     | `{ number }`. Corrige o quita un correlativo; queda en auditoría con el motivo                                                                |
| `DELETE /api/records/:id`            | editor (admin si tiene correlativo) | `deleteRecordSchema`: `{ reason? }`                                                        | 204                                                                                                                                           |

## Roles SII

| Método y ruta                    | Rol    | Entrada                                                                                   | Respuesta                                                                                                                                                      |
| -------------------------------- | ------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/roles?q=&limit=`       | viewer | `rolesSearchSchema`: `q` (rol parcial o dirección), `limit` (1–20, por defecto 8)         | `RoleDto[]` (con `vigente`, `resultRoleIds?`, `recordCount?`)                                                                                                  |
| `GET /api/roles/:roleId`         | viewer | —                                                                                         | `RoleDto`                                                                                                                                                      |
| `PATCH /api/roles/:roleId`       | editor | `updateRoleSchema` → `UpdateRoleInput`: `{ lat?, lon?, address? }`                        | `RoleDto`. Mover el rol reubica los registros con `coordsSource = 'role'` (§8.3)                                                                               |
| `DELETE /api/roles/:roleId`      | editor | —                                                                                         | 204. `409` si tiene registros u operaciones asociadas                                                                                                          |
| `GET /api/roles/:roleId/records` | viewer | `roleRecordsQuerySchema`: `includeLineage?` (incluye registros de roles anteriores, §8.9) | `RoleRecords` (`role`, `history`, `total`, `layerCount`, `groups[]` por departamento y capa)                                                                   |
| `POST /api/roles/import`         | admin  | `multipart/form-data` con `file` (CSV `;` del padrón)                                     | `BulkImportSummary` (`totalRows`, `upsertedRoles`, `updatedRecords`, `invalidRows[]`, `missingFromPadron[]`). También disponible por CLI (`pnpm roles:import`) |

### Operaciones sobre roles (§8.9)

| Método y ruta                     | Rol    | Entrada                                                                                                                                                                         | Respuesta                                                                                                                            |
| --------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/role-operations`        | viewer | `roleOperationsQuerySchema`: `page`, `pageSize`, `type?`, `from?`, `to?`, `roleId?`                                                                                             | `Paginated<RoleOperationDto>`                                                                                                        |
| `POST /api/role-operations`       | editor | `createRoleOperationSchema` → `CreateRoleOperationInput` (`type`, `effectiveDate`, `originRoleIds[]`, `resultRoleIds[]`, `resultCoords`, `reference?`, `recordId?`, `comment?`) | `RoleOperationDto` · 201. Valida la cardinalidad por tipo (`roleOperationCardinality`); `409` si un rol de origen ya no está vigente |
| `DELETE /api/role-operations/:id` | admin  | `deleteRoleOperationSchema`: `{ reason }`                                                                                                                                       | 204. Devuelve la vigencia a los roles de origen                                                                                      |

## Geocodificación

| Método y ruta         | Rol    | Entrada                                      | Respuesta                                                                                                                                                                                                                |
| --------------------- | ------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/geocode?q=` | viewer | `geocodeQuerySchema`: `q` (3–200 caracteres) | `GeocodeResult \| null` (`lat`, `lon`, `provider`, `confidence`, `roleId?`, `label`, `candidates?`). Pasa por el padrón local, la caché y, si corresponde, Nominatim/Photon desde el servidor (§8.7). 30/min por usuario |

## Importaciones (§8.5)

| Método y ruta                            | Rol                     | Entrada                                                                                                                                                              | Respuesta                                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/imports`                       | viewer (todas: admin)   | `importsQuerySchema`: `page`, `pageSize`, `layerId?`, `status?`, `userId?` (solo admin; un editor ve las suyas)                                                      | `Paginated<ImportItem>`                                                                                                                                                                                                                                                                                               |
| `POST /api/imports`                      | editor                  | `multipart/form-data`: `layerId` (`importUploadFieldsSchema`) y `file` (.csv o .xlsx, hasta `MAX_IMPORT_FILE_MB`)                                                    | `ImportSource` · 201 (hojas, cabeceras, vista previa de 20 filas, `suggestedMapping`). 10/min por usuario                                                                                                                                                                                                             |
| `GET /api/imports/:id`                   | editor                  | —                                                                                                                                                                    | `ImportStatusDto` (estado, `counts` por estado de fila, `codeCounts`, `removals?`, `nextNumber?`)                                                                                                                                                                                                                     |
| `PATCH /api/imports/:id`                 | editor (propia)         | `importSourcePatchSchema`: `{ sheetName?, headerRow?, delimiter? }`                                                                                                  | `ImportSource` (relee cabeceras y vista previa)                                                                                                                                                                                                                                                                       |
| `DELETE /api/imports/:id`                | editor (propia)         | —                                                                                                                                                                    | 204. Descarta un borrador (`UPLOADED`/`REVIEW`) y borra el archivo                                                                                                                                                                                                                                                    |
| `POST /api/imports/:id/analyze`          | editor (propia)         | `analyzeImportSchema` → `AnalyzeImportInput` (`columnMapping`, `rowFrom?`, `rowTo?`, `duplicateStrategy`, `keepExistingOnEmpty`, `geocode`, `fullReplace`)           | 202 `{ importId }`. Encola `import.analyze` en el worker; consultar progreso con `GET /api/imports/:id`                                                                                                                                                                                                               |
| `GET /api/imports/:id/rows`              | editor                  | `importRowsQuerySchema`: `status?` (`valid                                                                                                                           | warning                                                                                                                                                                                                                                                                                                               | duplicate | error   | excluded`), `code?` (`ImportMessageCode`), `page`, `pageSize` | `Paginated<ImportRowDto>` (con `existing[]` para comparar duplicados) |
| `PATCH /api/imports/:id/rows/:rowNumber` | editor (propia)         | `importRowPatchSchema` → `ImportRowPatch` (`raw?`, `resolution?`, `updateTargetId?`, `excluded?`, `roleId?`, `lat?`, `lon?`, `acceptSuggestion?`, `candidateIndex?`) | `ImportRowDto` revalidada                                                                                                                                                                                                                                                                                             |
| `POST /api/imports/:id/rows/bulk`        | editor (propia)         | `importRowsBulkSchema`: `{ filter: { status?, code? }, action }` (`skip                                                                                              | update                                                                                                                                                                                                                                                                                                                | create    | exclude | include                                                       | accept_suggestion`)                                                   | `{ updated: number }` |
| `GET /api/imports/:id/removals`          | editor                  | `page`, `pageSize`                                                                                                                                                   | `Paginated<ImportRemovalDto>` (registros que faltan en un reemplazo completo)                                                                                                                                                                                                                                         |
| `PATCH /api/imports/:id/removals`        | editor (propia)         | `importRemovalsPatchSchema`: `{ recordIds[] \| all: true, resolution: 'keep' \| 'delete' }`                                                                          | `{ updated: number }`. No permite eliminar registros con adjuntos o correlativo                                                                                                                                                                                                                                       |
| `POST /api/imports/:id/commit`           | editor (propia)         | `importCommitSchema`: `{ acceptPendingGeocode? }`                                                                                                                    | 202. Encola `import.commit`; `409` si quedan duplicados sin resolver o errores                                                                                                                                                                                                                                        |
| `GET /api/imports/:id/errors`            | viewer                  | —                                                                                                                                                                    | CSV con las filas con error y sus mensajes                                                                                                                                                                                                                                                                            |
| `POST /api/imports/:id/revert`           | editor (propia) / admin | `importRevertSchema`: `{ force?: boolean, reason? }`                                                                                                                 | `ImportRevertResult`: `{ deletedRecords, restoredRecords, reinsertedRecords }`. Si quitaría números asignados (creados que hoy tienen número, o actualizados que lo recibieron después): `403` si no es admin; `400` con `details.reasonRequired` si falta `reason`. `409` si hubo cambios posteriores y no se fuerza |

## Polígonos

| Método y ruta                            | Rol    | Entrada                                         | Respuesta                                                                                               |
| ---------------------------------------- | ------ | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /api/polygons?kind=`                | viewer | `polygonsQuerySchema`: `kind` (`comuna          | sector                                                                                                  | villa`) | `PolygonFeatureCollection` (GeoJSON con `properties { id, kind, name, code }`) |
| `GET /api/polygons/stats?kind=&layerId=` | viewer | `polygonStatsQuerySchema`                       | `PolygonStat[]`: `{ polygonId, name, count }[]` (registros de la capa dentro de cada polígono, PostGIS) |
| `GET /api/polygons/:id`                  | viewer | —                                               | `PolygonDetail` (sin geometría; con `attachments`, `counts[]` por capa, `sector?`, `bbox`, `centroid`)  |
| `PATCH /api/polygons/:id`                | editor | `updatePolygonSchema`: `{ name?, properties? }` | `PolygonDetail`                                                                                         |

## Adjuntos

| Método y ruta                                | Rol    | Entrada                                                                                                                                                                           | Respuesta                                                                                                   |
| -------------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /api/attachments?entityType=&entityId=` | viewer | `attachmentsQuerySchema`: `entityType` (`record                                                                                                                                   | polygon`), `entityId`                                                                                       | `AttachmentDto[]` |
| `POST /api/attachments`                      | editor | JSON `createLinkAttachmentSchema` (`entityType`, `entityId`, `title`, `url` http/https) **o** `multipart/form-data` con los campos de `createFileAttachmentFieldsSchema` + `file` | `AttachmentDto` · 201. Archivos: tipo y extensión permitidos, hasta `MAX_ATTACHMENT_MB`; 30/min por usuario |
| `DELETE /api/attachments/:id`                | editor | —                                                                                                                                                                                 | 204 (borra también el archivo del almacenamiento)                                                           |
| `GET /api/attachments/:id/download`          | viewer | —                                                                                                                                                                                 | El archivo (`Content-Disposition: attachment; filename*=…`). Para enlaces: redirección 302 a la URL         |

## Auditoría

| Método y ruta         | Rol                  | Entrada                                                                                                                                                                                | Respuesta                |
| --------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `GET /api/audit/logs` | viewer (toda: admin) | `auditLogsQuerySchema`: `page`, `pageSize`, `action?` (`AuditAction`), `entityType?` (`AuditEntity`), `layerId?`, `userId?` (solo admin; los demás ven solo lo propio), `from?`, `to?` | `Paginated<AuditLogDto>` |

## Administración de usuarios

Solo `admin`. La gestión de usuarios pasa solo por estas rutas: llaman a Better Auth desde el servidor (`auth.api.*`) con las validaciones de negocio (§7.8) y el formato de error uniforme. `/api/auth/admin/*` no está expuesto. 60/min por usuario.

| Método y ruta                       | Entrada                                                                                   | Respuesta                                                                                                              |
| ----------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/users`              | `usersQuerySchema`: `limit` (1–100, por defecto 20), `offset`, `query?` (nombre o correo) | `{ data: UserItem[], total }`                                                                                          |
| `POST /api/admin/users`             | `createUserSchema` → `CreateUserInput`: `{ name, email, password, role }`                 | `UserItem` · 201. El usuario queda con `mustChangePassword = true` (contraseña temporal). `409` si el correo ya existe |
| `PUT /api/admin/users/:id/role`     | `setUserRoleSchema`: `{ role: 'admin' \| 'editor' \| 'viewer' \| null }`                  | `{ role }`. `409` si el admin intenta quitarse su propio rol                                                           |
| `PUT /api/admin/users/:id/password` | `setUserPasswordSchema`: `{ password }` (10–128 caracteres)                               | 204. Asigna una contraseña temporal, cierra las sesiones del usuario y marca `mustChangePassword`                      |
| `DELETE /api/admin/users/:id`       | —                                                                                         | 204. `409` si el admin intenta eliminarse a sí mismo                                                                   |

---

## Ejemplos

Iniciar sesión (Better Auth) y listar capas con `curl` conservando la cookie:

```bash
curl -c jar.txt -H 'Content-Type: application/json' -H 'Origin: https://sigdomelbosque.cl' \
  -d '{"email":"dom@imelbosque.cl","password":"…"}' https://sigdomelbosque.cl/api/auth/sign-in/email
curl -b jar.txt https://sigdomelbosque.cl/api/layers
```

Registros de la capa 3 filtrados y ordenados:

```
GET /api/layers/3/records?page=1&pageSize=50&sort=attr:fecha_aprobacion&dir=desc&filters[destino]=Vivienda&hasCoordinates=1
```

Error de validación:

```json
HTTP/1.1 400
{ "error": { "code": "VALIDATION", "message": "department: Elige un departamento", "details": { "issues": [{ "path": "department", "message": "Elige un departamento" }] } } }
```

`scripts/smoke.sh` ejercita el flujo mínimo (`/api/health`, `/`, `/api/layers` sin y con sesión) contra cualquier URL.
