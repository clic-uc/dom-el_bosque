#!/bin/bash
# Respaldo de SIGDOM El Bosque (§12.2): base de datos (pg_dump comprimido) + adjuntos (volumen app_storage).
#
#   ./scripts/backup-db.sh [etiqueta]
#
# Genera en ./backups:
#   backup_<etiqueta_>AAAAMMDD_HHMMSS.sql.gz   (toda la base: capas, registros, roles, auth, pgboss)
#   storage_<etiqueta_>AAAAMMDD_HHMMSS.tar.gz  (adjuntos e importaciones del volumen app_storage)
# y elimina los respaldos con más de RETENTION_DAYS días (7 por defecto).
#
# El respaldo incluye las tablas de auth (usuarios y contraseñas hasheadas) y los adjuntos:
# el directorio ./backups debe tener permisos restringidos (chmod 700) y, si se copia fuera del
# servidor, viajar cifrado. Ejecutar desde la raíz del proyecto (donde está docker-compose.prod.yml).

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
PROJECT="${COMPOSE_PROJECT_NAME:-sigdom}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
DB_NAME="${POSTGRES_DB:-sigdom}"
DB_USER="${POSTGRES_USER:-postgres}"
DATE="$(date +%Y%m%d_%H%M%S)"
LABEL="${1:+${1}_}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR" 2>/dev/null || true
BACKUP_DIR_ABS="$(cd "$BACKUP_DIR" && pwd)"

DB_FILE="$BACKUP_DIR/backup_${LABEL}${DATE}.sql.gz"
STORAGE_FILE="$BACKUP_DIR/storage_${LABEL}${DATE}.tar.gz"

echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') Iniciando respaldo (proyecto: $PROJECT)"

# 1) Base de datos: dump plano, sin propietarios ni privilegios, para restaurar en cualquier instancia.
echo "[backup] Base de datos '$DB_NAME' -> $DB_FILE"
docker compose -f "$COMPOSE_FILE" exec -T db \
  pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges --encoding=UTF8 \
  | gzip -9 > "$DB_FILE"
echo "[backup] Base de datos lista: $(du -h "$DB_FILE" | cut -f1)"

# 2) Adjuntos: tar del volumen app_storage (nombre <proyecto>_app_storage) con un contenedor efímero.
STORAGE_VOLUME="$(docker volume ls -q \
  --filter "label=com.docker.compose.project=$PROJECT" \
  --filter "label=com.docker.compose.volume=app_storage" | head -n 1)"
STORAGE_VOLUME="${STORAGE_VOLUME:-${PROJECT}_app_storage}"

if docker volume inspect "$STORAGE_VOLUME" >/dev/null 2>&1; then
  echo "[backup] Adjuntos (volumen $STORAGE_VOLUME) -> $STORAGE_FILE"
  docker run --rm \
    -v "$STORAGE_VOLUME:/data:ro" \
    -v "$BACKUP_DIR_ABS:/backups" \
    alpine tar czf "/backups/$(basename "$STORAGE_FILE")" -C /data .
  echo "[backup] Adjuntos listos: $(du -h "$STORAGE_FILE" | cut -f1)"
else
  echo "[backup] Aviso: no existe el volumen $STORAGE_VOLUME; se omite el respaldo de adjuntos"
fi

# 3) Retención
echo "[backup] Eliminando respaldos con más de $RETENTION_DAYS días"
find "$BACKUP_DIR" -type f \( -name 'backup_*.sql.gz' -o -name 'storage_*.tar.gz' \) -mtime "+$RETENTION_DAYS" -print -delete

echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') Respaldo completado"
