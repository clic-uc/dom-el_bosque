# Despliegue en producción

Guía para instalar, actualizar y respaldar SIGDOM El Bosque en un servidor propio (VPS). Todo corre en Docker con `docker compose`: base de datos PostgreSQL/PostGIS, la aplicación Next.js, el proceso _worker_ (tareas en segundo plano) y Caddy como proxy inverso con certificados TLS automáticos.

```
Internet ──443──▶ caddy ──▶ app:3000 (Next.js standalone)
                              │
                              ├──▶ db:5432 (PostgreSQL 17 + PostGIS 3.5)   volumen sigdom_db_data
                              └──▶ /data/storage (adjuntos e importaciones) volumen sigdom_app_storage
                 worker ──────┘   (misma imagen que app; consume la cola pg-boss en la misma BD)
```

Archivos relevantes: `Dockerfile`, `entrypoint.sh`, `docker-compose.prod.yml`, `Caddyfile`, `.env.production.example`, `scripts/backup-db.sh`, `scripts/restore-db.sh`, `scripts/crontab.example`, `scripts/smoke.sh`.

Para un ambiente de pruebas gratuito en Vercel + Neon, con alcance reducido, ver la [sección 7](#7-staging-en-vercel--neon). No reemplaza a este despliegue.

## 1. Requisitos del servidor

- Linux de 64 bits (Ubuntu 22.04/24.04 LTS o Debian 12 recomendado), 2 vCPU, 4 GB de RAM, 40 GB de disco SSD. Los límites de recursos de compose suman 2,5 CPU y 2 GB para db + app + worker; con 2 vCPU funciona porque no coinciden en su máximo.
- Docker Engine 24+ con el plugin `docker compose` v2 (`docker compose version`). Instalación oficial: <https://docs.docker.com/engine/install/>.
- `git`, `curl`, `openssl` y `cron` (vienen en las distribuciones mencionadas).
- Puertos 80 y 443 abiertos hacia Internet (firewall del VPS y del proveedor). El puerto 5432 **no** se expone.
- Un usuario no root con permiso para usar Docker (grupo `docker`). En esta guía el proyecto vive en `/opt/sigdom`.

## 2. DNS

Crea un registro `A` (y `AAAA` si hay IPv6) de `sigdomelbosque.cl` apuntando a la IP pública del servidor. Comprueba la propagación con `dig +short sigdomelbosque.cl` antes de levantar Caddy: Let's Encrypt necesita resolver el dominio hacia este servidor para emitir el certificado. Si se usa otro dominio, cámbialo en `SITE_ADDRESS`, `BETTER_AUTH_URL` y `NEXT_PUBLIC_APP_URL` de `.env.production`.

## 3. Primer despliegue

### 3.1 Clonar el repositorio

```bash
sudo mkdir -p /opt/sigdom && sudo chown "$USER" /opt/sigdom
git clone <url-del-repositorio> /opt/sigdom
cd /opt/sigdom
```

### 3.2 Configurar `.env.production`

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Edita `.env.production` y completa:

| Variable                                                   | Qué poner                                                                                                                                                               |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                                        | Contraseña propia de la base: `openssl rand -hex 24`                                                                                                                    |
| `DATABASE_URL`                                             | `postgres://postgres:<POSTGRES_PASSWORD>@db:5432/sigdom` (host `db` = servicio de compose; debe calzar con `POSTGRES_*`)                                                |
| `BETTER_AUTH_SECRET`                                       | Secreto de sesiones: `openssl rand -base64 32`. Nunca reutilizar el de otro ambiente; cambiarlo cierra todas las sesiones.                                              |
| `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL`                   | `https://sigdomelbosque.cl` (sin barra final)                                                                                                                           |
| `SITE_ADDRESS`                                             | `sigdomelbosque.cl` (dominio que atiende Caddy)                                                                                                                         |
| `GEOCODER_CONTACT_EMAIL`                                   | **Obligatorio**: correo institucional de contacto. Nominatim (OpenStreetMap) exige identificar a quien consulta; sin él la geocodificación externa queda deshabilitada. |
| `NEXT_PUBLIC_MAP_STYLE_URL`, `NOMINATIM_URL`, `PHOTON_URL` | Dejar los valores por defecto salvo que se use una instancia propia                                                                                                     |

`.env.production` contiene secretos: no se versiona (está en `.gitignore`) y no se copia a ningún otro lugar que no sea el respaldo cifrado del servidor.

### 3.3 Construir y levantar

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

Usa siempre `--env-file .env.production`: así compose toma de ahí `NEXT_PUBLIC_*` (se insertan en el bundle del navegador al construir la imagen) y `SITE_ADDRESS` para Caddy. Si existiera un `.env` de desarrollo en la carpeta, compose lo usaría en su lugar y la imagen quedaría apuntando a `localhost`.

La primera construcción tarda varios minutos (instala dependencias y compila). Al arrancar, el servicio `app` ejecuta `node scripts/migrate.js` (crea las extensiones `postgis` y `pg_trgm`, las tablas y los índices) y luego el servidor; `worker` espera a que `app` responda `/api/health` y `caddy` espera a `app`.

Verifica:

```bash
docker compose -f docker-compose.prod.yml ps          # todos "running", app y db "healthy"
docker compose -f docker-compose.prod.yml logs -f app # "Migraciones aplicadas." y "Ready"
curl -fsS https://sigdomelbosque.cl/api/health        # {"status":"ok","db":"ok"}
```

### 3.4 Datos iniciales

Los scripts CLI están empaquetados dentro de la imagen (`/app/scripts/*.js`) y se ejecutan con `docker compose exec app`. Todos son idempotentes: se pueden repetir sin duplicar datos.

```bash
# 1) Las 15 capas iniciales (Obras Menores, Obras Nuevas, Ley 19.583, …)
docker compose -f docker-compose.prod.yml exec app node scripts/seed.js

# 2) Polígonos de referencia (límite comunal, sectores, villas y poblaciones) desde data/geo/
docker compose -f docker-compose.prod.yml exec app node scripts/geo-import.js

# 3) Padrón de roles (ver 3.5): copiar el CSV al contenedor e importarlo
docker compose -f docker-compose.prod.yml cp /ruta/segura/roles.csv app:/tmp/roles.csv
docker compose -f docker-compose.prod.yml exec app node scripts/import-roles.js /tmp/roles.csv
docker compose -f docker-compose.prod.yml exec app rm /tmp/roles.csv

# 4) Primer administrador (pide la contraseña o genera una y la muestra una sola vez)
docker compose -f docker-compose.prod.yml exec app node scripts/create-admin.js --email dom@imelbosque.cl --name "Administrador DOM"
```

El administrador creado por CLI entra con la contraseña indicada y no se le exige cambiarla. El resto de las cuentas se crea desde la plataforma (Panel de administración → Gestión de usuarios) con una contraseña temporal que cada persona cambia en su primer ingreso. No existe registro público ni recuperación por correo: si alguien olvida su contraseña, un administrador le asigna una temporal.

### 3.5 Dónde colocar el padrón de roles

`roles.csv` (≈42.600 filas, separador `;`, cabeceras `roleId;DIRECCION;COMPLEMENTO;lat;lon`) contiene direcciones asociadas a roles prediales: **son datos personales según la Ley 19.628 y no deben versionarse ni quedar en carpetas públicas**. Recomendaciones:

- Guardarlo fuera del repositorio, por ejemplo en `/opt/sigdom-data/roles.csv` con permisos `600` y dueño el usuario que opera el servidor.
- Copiarlo al contenedor solo para importar y borrarlo de `/tmp` después (como en el bloque anterior).
- Reimportar cuando el SII o la DOM entreguen un padrón actualizado: la importación actualiza coordenadas y direcciones, mueve los registros que toman la ubicación del rol y lista los roles vigentes que ya no vienen en el padrón.
- Si una versión nueva cambia la normalización de direcciones (`normalizeAddress`), recalcular la dirección normalizada del padrón guardado una vez después de desplegar: `docker compose -f docker-compose.prod.yml exec app node scripts/import-roles.js --renormalize`. No necesita el CSV, es idempotente y solo escribe los roles que cambian. Sin este paso, el padrón y las direcciones nuevas se normalizan distinto y dejan de calzar.

El repositorio ignora `roles.csv` y `data/roles*.csv` por si se deja una copia local en desarrollo.

### 3.6 Prueba de humo

```bash
SMOKE_EMAIL=dom@imelbosque.cl SMOKE_PASSWORD='la-contraseña' ./scripts/smoke.sh https://sigdomelbosque.cl
```

Comprueba `/api/health`, la página de ingreso, que la API exige sesión (401), el inicio de sesión y la lista de capas.

## 4. Operación diaria

### 4.1 Estado, logs y salud

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f --tail=200 app
docker compose -f docker-compose.prod.yml logs -f --tail=200 worker
docker compose -f docker-compose.prod.yml logs -f --tail=200 caddy
docker stats --no-stream
```

Los logs de `app` y `worker` son JSON (pino) con `level`, `time`, `service` y `msg`; los de Docker rotan solos (10 MB × 3 archivos por servicio). `GET /api/health` responde `{"status":"ok","db":"ok"}` con 200 cuando la base responde y 503 si no; Docker lo consulta cada 30 s y reinicia el servicio `app` cuando falla tres veces seguidas (`restart: unless-stopped`).

### 4.2 Actualizar a una nueva versión

```bash
cd /opt/sigdom
./scripts/backup-db.sh pre-actualizacion          # respaldo previo (recomendado)
git pull
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f app   # esperar "Migraciones aplicadas." y "Ready"
```

Las migraciones de base de datos corren automáticamente en el entrypoint de `app` antes de arrancar el servidor; no hay que ejecutar nada a mano. Si una nueva versión trae capas o polígonos nuevos, repite `seed.js` y `geo-import.js` (son idempotentes). La indisponibilidad durante la actualización es de unos segundos (el tiempo de reemplazar el contenedor).

### 4.3 Si algo falla tras actualizar (rollback)

1. Mira los logs: `docker compose -f docker-compose.prod.yml logs --tail=300 app`. Si la migración falló, el contenedor se reinicia en bucle y los logs muestran el error SQL.
2. Vuelve a la versión anterior del código y reconstruye:
   ```bash
   git log --oneline -5                  # identificar el commit anterior
   git checkout <commit-anterior>
   docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
   ```
   Como alternativa más rápida, antes de actualizar etiqueta la imagen que funciona (`docker tag sigdom-app:latest sigdom-app:estable`) y, si hace falta, vuelve a ella con `docker tag sigdom-app:estable sigdom-app:latest && docker compose -f docker-compose.prod.yml up -d --no-build app worker`.
3. Si la migración nueva ya modificó la base y la versión anterior no la entiende, restaura el respaldo previo (4.5) **después** de volver al código anterior.
4. Documenta el incidente y corrige en una rama antes de reintentar.

### 4.4 Respaldos

`scripts/backup-db.sh` genera en `./backups`:

- `backup_<fecha>.sql.gz`: `pg_dump` completo de la base (capas, registros, roles, importaciones, auditoría, **usuarios y contraseñas hasheadas**, cola pg-boss).
- `storage_<fecha>.tar.gz`: contenido del volumen `sigdom_app_storage` (adjuntos de registros y polígonos, archivos de importación).

y borra los que tienen más de 7 días (`RETENTION_DAYS` para cambiarlo). Programa el respaldo diario con cron:

```bash
chmod 700 /opt/sigdom/backups
crontab -e        # pegar el contenido de scripts/crontab.example ajustando la ruta
```

Protege `./backups`: contiene datos personales y credenciales hasheadas. Debe ser legible solo por el usuario operador (`chmod 700`) y conviene copiar los archivos cifrados a otro lugar (otro servidor, almacenamiento de objetos) con `rclone`, `restic` o similar; un respaldo que vive solo en el mismo disco no protege ante la pérdida del servidor. Prueba una restauración completa al menos una vez al semestre.

### 4.5 Restaurar un respaldo

```bash
cd /opt/sigdom
./scripts/restore-db.sh backups/backup_20260601_020000.sql.gz backups/storage_20260601_020000.tar.gz
```

El script pide confirmación (`SI`), detiene `app` y `worker`, recrea la base de datos desde el dump, restaura los adjuntos en el volumen (si se indicó el segundo archivo) y vuelve a levantar los servicios; al arrancar, `app` aplica las migraciones que falten si el respaldo es de una versión anterior. Mientras dura, la plataforma no está disponible (típicamente uno o dos minutos). Si solo se restauró la base pero no los adjuntos (o al revés), pueden quedar referencias a archivos inexistentes: restaura siempre el par del mismo día.

Para restaurar en un servidor nuevo: instala según la sección 3 hasta el paso 3.3 (sin datos iniciales), copia la carpeta `backups` y ejecuta la restauración.

### 4.6 Certificados TLS

Caddy obtiene y renueva los certificados de Let's Encrypt automáticamente y los guarda en el volumen `sigdom_caddy_data`. No hay `certbot` ni tareas de renovación. Si el certificado no se emite, revisa `docker compose -f docker-compose.prod.yml logs caddy`: casi siempre es DNS que todavía no apunta al servidor o el puerto 80/443 cerrado.

### 4.7 Usuarios y accesos

- Crear, cambiar rol, asignar contraseña temporal o eliminar cuentas: Panel de administración → Gestión de usuarios (solo administradores).
- Un administrador no puede quitarse su propio rol ni eliminarse; si no queda ningún administrador operativo, crea uno por CLI con `create-admin.js` (3.4).
- Toda acción sobre datos queda en Auditoría (Panel de administración → Auditoría).

## 5. Pruebas locales de la imagen de producción

Para ensayar el despliegue en un computador sin dominio público:

```bash
cp .env.production.example .env.production
# En .env.production: SITE_ADDRESS=localhost, BETTER_AUTH_URL=https://localhost, NEXT_PUBLIC_APP_URL=https://localhost
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
curl -k https://localhost/api/health
```

Caddy emite un certificado local autofirmado para `localhost` (el navegador avisará). Para probar solo la imagen sin Caddy, el `docker-compose.yml` de desarrollo tiene el perfil `full` (`docker compose --profile full up --build`), que publica la app en `http://localhost:3000`.

## 6. Resumen de comandos

| Tarea                 | Comando                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Levantar / actualizar | `docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build`          |
| Estado                | `docker compose -f docker-compose.prod.yml ps`                                                |
| Logs                  | `docker compose -f docker-compose.prod.yml logs -f app` (o `worker`, `db`, `caddy`)           |
| Salud                 | `curl -fsS https://sigdomelbosque.cl/api/health`                                              |
| Seeds / polígonos     | `… exec app node scripts/seed.js` / `… exec app node scripts/geo-import.js`                   |
| Padrón de roles       | `… cp roles.csv app:/tmp/roles.csv && … exec app node scripts/import-roles.js /tmp/roles.csv` |
| Primer administrador  | `… exec app node scripts/create-admin.js --email <correo> --name "<nombre>"`                  |
| Recalcular direcciones del padrón | `… exec app node scripts/import-roles.js --renormalize` (tras un cambio de `normalizeAddress`) |
| Respaldo              | `./scripts/backup-db.sh [etiqueta]`                                                           |
| Restaurar             | `./scripts/restore-db.sh backups/backup_….sql.gz [backups/storage_….tar.gz]`                  |
| Prueba de humo        | `SMOKE_EMAIL=… SMOKE_PASSWORD=… ./scripts/smoke.sh https://sigdomelbosque.cl`                 |
| Detener todo          | `docker compose -f docker-compose.prod.yml down` (los datos quedan en los volúmenes)          |

`…` abrevia `docker compose -f docker-compose.prod.yml`.

## 7. Staging en Vercel + Neon

Ambiente de pruebas accesible por internet y sin costo, para que la DOM pruebe mapa, registros, roles e importaciones pequeñas. **No es producción**: no tiene disco persistente ni proceso _worker_, así que funciona con alcance reducido. El análisis de compatibilidad está en `docs/STAGING.md` y las decisiones en `docs/DECISIONS.md` ("Staging").

```
Navegador ──▶ Vercel (Next.js, funciones serverless, NEXT_PUBLIC_DEPLOY_MODE=staging)
                 │  importaciones: after() en la misma invocación (sin pg-boss)
                 └──▶ Neon (PostgreSQL + PostGIS, conexión pooled)   archivos de importación en file_blobs
Tu equipo ──────────▶ Neon (conexión direct): migraciones, seeds, polígonos, padrón, administrador
```

### 7.1 Qué cambia con `NEXT_PUBLIC_DEPLOY_MODE=staging`

La única fuente de verdad es `src/shared/capabilities.ts`; los servicios aplican cada regla y la interfaz solo la refleja.

| Capacidad                             | Producción (`full`) | Staging                                                     |
| ------------------------------------- | ------------------- | ----------------------------------------------------------- |
| Subir / descargar archivo adjunto     | Sí, 20 MB           | No (409 con mensaje). Los enlaces funcionan.                |
| Importar planillas                    | Sí, 10 MB           | Sí, ≤ 4 MB y ≤ 1.000 filas (se rechaza al subir)            |
| Buscar direcciones en OpenStreetMap   | Sí                  | No: solo el padrón                                          |
| Cargar el padrón desde la web         | Sí (API)            | No (409); se carga por CLI                                  |
| Procesar importaciones                | Worker pg-boss      | `after()` dentro de la petición, hasta 300 s                |
| Archivos de importación               | Disco               | Tabla `file_blobs`                                          |
| Limpieza de borradores vencidos       | Worker, 03:00       | Al subir cada importación nueva                             |
| Análisis interrumpido                 | El worker reintenta | Tras 6 min la revisión ofrece "Volver a analizar" o "Descartar" |
| Aviso en pantalla                     | —                   | Franja amarilla "Ambiente de pruebas" en todo el shell      |

La variable se fija **en el build** (`NEXT_PUBLIC_*`): si se cambia en Vercel hay que volver a desplegar.

### 7.2 Base de datos en Neon

1. Crear un proyecto en Neon (región más cercana: São Paulo, `aws-sa-east-1`). PostGIS y `pg_trgm` vienen disponibles; `drizzle/0000_extensions.sql` los activa.
2. En **Connection Details** copiar dos cadenas: la _pooled_ (host con `-pooler`) y la _direct_ (mismo host sin `-pooler`).
3. Completar `.env.staging` (copia de `.env.staging.example`, nunca se versiona): `DATABASE_URL` = pooled, `DATABASE_URL_DIRECT` = direct, `BETTER_AUTH_SECRET` propio (distinto al de producción) y las URLs de Vercel.
4. Desde tu equipo, con la conexión direct (los scripts usan `DATABASE_URL_DIRECT` si existe):

   ```bash
   ENV_FILE=.env.staging pnpm db:migrate
   ENV_FILE=.env.staging pnpm db:seed
   ENV_FILE=.env.staging pnpm geo:import
   ENV_FILE=.env.staging pnpm auth:create-admin --email <correo> --name "<nombre>"
   ```

   En PowerShell: `$env:ENV_FILE='.env.staging'; pnpm db:migrate` (y lo mismo para el resto). Si la terminal ya tiene `DATABASE_URL` definida, `ENV_FILE` se ignora.

5. **Padrón de roles**: es dato personal (Ley 19.628). Para staging preferir una muestra o datos anonimizados: `ENV_FILE=.env.staging pnpm roles:import <ruta/muestra.csv>`. La carga web está deshabilitada en este modo. Si una versión nueva cambia la normalización de direcciones: `ENV_FILE=.env.staging pnpm roles:renormalize`.

La base de staging debe partir vacía: los adjuntos de archivo de una base restaurada desde producción no se pueden descargar aquí.

### 7.3 Proyecto en Vercel

1. **Add New → Project** e importar el repositorio. Framework: Next.js. Node.js 22.
2. **Build Command**: `pnpm map:worker && pnpm build` (copia el worker de MapLibre a `public/` aunque pnpm no ejecute el hook `prebuild`).
3. **Environment Variables** (las de `.env.staging` salvo `DATABASE_URL_DIRECT`):

   | Variable                    | Valor                                                       |
   | --------------------------- | ----------------------------------------------------------- |
   | `NEXT_PUBLIC_DEPLOY_MODE`   | `staging`                                                   |
   | `DATABASE_URL`              | cadena pooled de Neon (`…-pooler…?sslmode=require`)         |
   | `BETTER_AUTH_SECRET`        | secreto propio de staging (`openssl rand -base64 32`)       |
   | `BETTER_AUTH_URL`           | URL pública del proyecto (`https://….vercel.app`)           |
   | `NEXT_PUBLIC_APP_URL`       | la misma URL                                                |
   | `NEXT_PUBLIC_MAP_STYLE_URL` | `https://tiles.openfreemap.org/styles/liberty`              |
   | `GEOCODER_PROVIDERS`        | `padron`                                                    |

4. Desplegar. Las rutas de analizar y confirmar importación declaran `maxDuration = 300`. En staging el pool de la app abre como máximo 2 conexiones por instancia.
5. Revisar en la primera prueba que `output: 'standalone'` de `next.config.ts` no interfiere con el build de Vercel.

### 7.4 Verificación

- La franja "Ambiente de pruebas" aparece en mapa, administración, manual y cambio de contraseña.
- En la ficha de un registro, "Subir archivo" está deshabilitado con el motivo; "Agregar enlace" funciona.
- Importar una planilla de ≤ 1.000 filas de punta a punta (subir, columnas, revisar, confirmar, revertir); una de 1.001 filas o más de 4 MB se rechaza al subirla con un mensaje claro.
- En Neon no aparece el esquema `pgboss`.

### 7.5 Límites del plan gratuito

Verificarlos antes de depender de ellos (cambian): Neon gratuito con 0,5 GB por proyecto, 100 CU-horas al mes y pausa tras 5 min sin uso (la primera petición después es lenta); Vercel Hobby con funciones de hasta 300 s, cuerpo de petición de unos 4,5 MB y restricciones de uso comercial. Una importación de 1.000 filas debe terminar dentro de 300 s incluyendo el arranque en frío de Neon: medirlo y ajustar los topes en `src/shared/capabilities.ts` si hace falta.
