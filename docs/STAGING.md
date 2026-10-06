# Staging en Vercel + Neon (capa gratuita)

> **Estado: propuesta, nada implementado.** Este documento recoge el análisis de compatibilidad, los límites conocidos y cómo orientar la implementación. Cuando se implemente, registrar la desviación en `docs/DECISIONS.md` y mover la parte operativa a `docs/DEPLOY.md`.

Objetivo: tener un ambiente de pruebas accesible por internet, sin costo, para que la DOM pruebe mapa, registros y roles. Producción sigue siendo el despliegue con Docker descrito en `docs/DEPLOY.md`; este documento no lo modifica.

## 1. Resumen

Vercel + Neon es **compatible con un alcance reducido**. PostGIS no es un problema; lo que no encaja con serverless es todo lo que hoy depende de disco local o de un proceso permanente:

| Pieza | Compatible | Motivo |
| --- | --- | --- |
| Next.js, Route Handlers, Better Auth, MapLibre | Sí | Sin cambios. |
| PostGIS y `pg_trgm` | Sí | Neon los ofrece en todos los planes; `drizzle/0000_extensions.sql` debería correr tal cual. |
| Driver `postgres` | Sí | `src/db/client.ts` ya usa `prepare: false`, requisito del pooler PgBouncer de Neon. |
| Adjuntos tipo archivo | **No** | `src/server/storage.ts` escribe en `./storage`; el disco de Vercel es de solo lectura (salvo `/tmp`, efímero). |
| Archivos de importación | **No** | Mismo `storage`; además análisis y confirmación ocurren en peticiones distintas. |
| Worker pg-boss (`pnpm worker`) | **No** | Vercel no ofrece procesos permanentes. |
| Importación del padrón (admin, hasta 20 MB) | **No** | Excede el tope de cuerpo de petición de Vercel. |
| Adjuntos tipo enlace | Sí | Solo guardan una URL en la base. |

## 2. Límites conocidos

Valores tomados de la documentación pública a octubre de 2026; **verificarlos antes de depender de ellos**, los planes cambian.

**Neon (plan gratuito)**
- 0,5 GB de almacenamiento por proyecto. Hay que medir cuánto pesan el padrón (~42.600 roles) y los polígonos de `data/geo/` antes de cargarlos.
- 100 CU-horas de cómputo al mes; al agotarse, el cómputo se suspende.
- Escala a cero tras 5 minutos sin actividad: la primera petición después de una pausa es lenta (arranque en frío).
- Pooler PgBouncer incluido (modo transacción). Dos cadenas de conexión: _pooled_ (host con `-pooler`) y _direct_.

**Vercel (plan Hobby)**
- Duración máxima de función: 300 s.
- Cron: 2 tareas, mínimo una ejecución diaria.
- Cuerpo de petición a una función: unos **4,5 MB** (dato recordado, **no confirmado** en la búsqueda). Nuestros topes actuales (adjuntos 20 MB, importación 10 MB, padrón 20 MB) lo superan.
- Disco de solo lectura salvo `/tmp`, que no se comparte entre instancias.
- Los términos del plan Hobby restringen el uso comercial; confirmar que un staging institucional los cumple.

**Del propio código (no cambian con el hosting)**
- Rate limit en memoria (`src/server/rate-limit.ts`): en serverless cada instancia tiene su contador, así que casi no limita. Inofensivo en staging.
- Geocodificación externa limitada a 1 req/s (`src/server/geocoding/throttle.ts`): una tanda grande no cabe en 300 s.

## 3. Alcance acordado para staging

| Capacidad | Producción (`full`) | Staging (`staging`) |
| --- | --- | --- |
| Subir archivo adjunto | Sí, 20 MB | **No.** Los enlaces siguen funcionando. |
| Importar planillas | Sí, 10 MB | Sí, **≤ 4 MB y ≤ 1.000 filas** |
| Geocodificación externa al importar | Sí | **No** (solo padrón) |
| Importar padrón de roles desde la web | Sí | **No** (se hace por CLI desde un equipo con acceso a Neon) |
| Procesamiento de importaciones | Worker pg-boss | **Dentro de la petición** con `after()` |
| Archivos de importación | Disco | **Tabla en Postgres** |

Los topes (4 MB / 1.000 filas) son un punto de partida; ajustar tras medir tiempos reales en Neon.

## 4. Qué hay que implementar

### 4.1 Flag y capacidades
- Variable `NEXT_PUBLIC_DEPLOY_MODE` (`full` | `staging`, por defecto `full`) en `src/env.ts`, `.env.example` y `.env.production.example`. Al ser `NEXT_PUBLIC_*` se fija en el _build_: el proyecto de Vercel de staging la define en su propio entorno.
- `src/shared/capabilities.ts`: función pura que, dado el modo, devuelve las capacidades de la tabla anterior (booleanos, topes numéricos y textos de aviso en español). Se importa desde servidor y cliente.
- Con `full` el comportamiento actual no cambia.

### 4.2 Guardias en el servidor
- `addFile` y `getDownload` en `src/server/services/attachments.ts`: rechazar con un `AppError` que explique que este ambiente no admite archivos y que se puede usar un enlace.
- `uploadImport` en `src/server/import/upload.ts`: aplicar el tope de MB de las capacidades y rechazar, **antes de guardar**, planillas con más filas que el máximo.
- Análisis de importación: forzar `geocode: false` en staging.
- `app/api/roles/import/route.ts`: rechazar en staging indicando la alternativa por CLI.
- Todos los errores con `AppError` (nunca `throw new Error` hacia el cliente), con mensaje que diga qué pasó y qué hacer.

### 4.3 Almacenamiento en Postgres
- Nueva tabla `file_blobs` (clave, `bytea`, tamaño, fecha) en `src/db/schema/*`; `pnpm db:generate` y `pnpm db:migrate`. La migración se aplica también en producción (tabla vacía e inocua).
- Segundo backend de `storage` con la misma interfaz (`put`, `get`, `getStream`, `exists`, `size`, `delete`, `deleteMany`), elegido según el modo. Revisar que cubra los usos de `upload.ts`, `source.ts`, `review.ts`, `commit.ts`, `cleanup.ts` y `attachments.ts`.
- Es necesario porque el análisis y la confirmación son peticiones distintas y `/tmp` no se comparte entre instancias.

### 4.4 Jobs sin worker
- En `src/server/jobs/boss.ts`, `enqueue()` en staging **no usa pg-boss**: ejecuta `runAnalyze` / `runCommit` con `after()` de Next. Importar los handlers de forma dinámica para evitar el ciclo con `src/server/import/jobs.ts`. No crear instancia ni conexiones de pg-boss.
- `export const maxDuration = 300` en las rutas de analizar y confirmar importación (inocuo fuera de Vercel).
- En `runAnalyze`, no encolar `import.geocode-external` en staging.
- La limpieza diaria de borradores vencidos (`import.cleanup`, 03:00) no corre sin worker: ejecutarla de forma oportunista al subir una importación nueva.
- Que una importación atascada en `ANALYZING` (función cortada a mitad) pueda descartarse y reintentarse desde la interfaz.

### 4.5 Interfaz
Principio rector: usuarios con baja habilidad digital; español de Chile sin jerga, etiquetas visibles, controles ≥ 44 px, mensajes que digan qué pasó y qué hacer.
- Banner permanente en el shell autenticado (`app/(app)/layout.tsx` o el componente de cabecera): «Ambiente de pruebas: no se pueden subir archivos y las importaciones son más pequeñas», con `HelpLink`.
- `AttachmentsList`: «Subir archivo» deshabilitado con el motivo visible; «Agregar enlace» intacto.
- `UploadStep`: el tope de MB hoy está fijo en 10; tomarlo de las capacidades y mostrar los límites de staging.
- Paso de columnas: ocultar la opción de geocodificar.
- Administración: deshabilitar la carga del padrón con explicación.

### 4.6 Pruebas y documentación
- Tests unitarios de `capabilities`; tests de BD para los tres rechazos (adjunto, exceso de filas, padrón) y uno de la importación completa en modo inline.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm knip` antes de dar por terminado.
- Entrada en `docs/DECISIONS.md` y trasladar la sección operativa a `docs/DEPLOY.md`.

## 5. Cómo orientar la implementación

- **La regla vive en los servicios, la interfaz solo la refleja.** Un bloqueo solo visual se salta llamando a la API directamente. No usar `proxy.ts` para esto: ahí solo se ve la ruta, no se puede avisar en pantalla ni contar filas.
- **Una única fuente de verdad** (`capabilities.ts`) para topes y textos, de modo que servidor, cliente y tests no se desincronicen.
- **Cambios aditivos y detrás del flag.** Lo que ya funciona en producción no debe cambiar de comportamiento; el modo `full` es el camino por defecto y debe seguir pasando todos los tests actuales.
- **No introducir dependencias externas** (Blob, S3) para el staging: guardar en Postgres evita cuentas y claves adicionales y se puede borrar con la base.
- **Orden sugerido:** 4.1 → 4.2 → 4.5 (adjuntos y avisos) → 4.3 → 4.4 (importación reducida) → 4.6. Así se puede desplegar un primer staging útil sin importaciones y sumarlas después.

## 6. Configuración de la base y despliegue (a documentar en DEPLOY.md)

- **Dos URLs de Neon.** La _pooled_ para la app, con `max` bajo (1 a 3) porque cada instancia serverless abre su propio pool. La _direct_ (sin `-pooler`) para `db:migrate`, `db:seed` y demás scripts, que usan sesiones y DDL. Hoy todo usa `DATABASE_URL`; probablemente haga falta una variable adicional (p. ej. `DATABASE_URL_DIRECT`) que usen los scripts.
- **Migraciones y datos iniciales** ya no tienen `entrypoint.sh`: ejecutar `db:migrate`, `db:seed`, `geo:import`, `roles:import` y `auth:create-admin` desde un equipo con acceso a Neon, apuntando a la URL direct.
- Variables de entorno en Vercel: `DATABASE_URL`, `BETTER_AUTH_SECRET` (distinto al de producción), `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_MAP_STYLE_URL`, `NEXT_PUBLIC_DEPLOY_MODE=staging`, `GEOCODER_PROVIDERS=padron`.
- Cuidado con datos personales: el padrón de roles es dato personal (Ley 19.628). Para staging preferir datos de muestra o anonimizados en lugar de copiar los reales.

## 7. Riesgos y puntos abiertos

- Una importación de 1.000 filas debe terminar dentro de 300 s incluyendo el arranque en frío de Neon. Medir antes de fijar el tope.
- Si la función se corta a mitad, la importación queda en `ANALYZING`: necesita salida en la interfaz (4.4).
- 100 CU-horas al mes pueden agotarse si se usa el staging de forma intensa; al agotarse, el cómputo se suspende hasta el mes siguiente.
- Pendiente de verificar en el código y la documentación:
  - Documentación de `after()` y `maxDuration` en esta versión de Next (ver `node_modules/next/dist/docs/`, según `AGENTS.md`).
  - Dónde está el shell que alojará el banner, y dónde están la opción de geocodificar y la carga del padrón en la interfaz.
  - Cómo `createBulkContext` decide `needsExternalGeocode`, para anularlo limpiamente.
  - Tope real de cuerpo de petición en Vercel Hobby.
- Los adjuntos de archivo que existieran en una base restaurada desde producción no se podrán descargar en staging; la base de staging debería partir vacía.

## 8. Criterios de aceptación

- Con `NEXT_PUBLIC_DEPLOY_MODE` ausente o `full`, toda la suite actual pasa sin cambios y la interfaz no muestra avisos nuevos.
- En `staging`: el banner aparece en todas las pantallas autenticadas; «Subir archivo» está deshabilitado con motivo y la API rechaza el envío; los enlaces se agregan normalmente.
- En `staging`: se importa una planilla de ≤ 4 MB y ≤ 1.000 filas de punta a punta (subir, mapear, revisar, confirmar, revertir); una más grande se rechaza al subirla con un mensaje claro.
- En `staging`: no se crean tablas ni conexiones de pg-boss, y nada intenta escribir en disco.
