#!/bin/bash
# Restauración de SIGDOM El Bosque (§12.2) desde los archivos que genera backup-db.sh.
#
#   ./scripts/restore-db.sh backups/backup_AAAAMMDD_HHMMSS.sql.gz [backups/storage_AAAAMMDD_HHMMSS.tar.gz]
#
# Reemplaza TODA la base de datos (y los adjuntos, si se indica el segundo archivo). Detiene app y
# worker durante la restauración y los vuelve a levantar al final (la app aplica las migraciones
# pendientes en su entrypoint, por lo que un respaldo de una versión anterior queda al día solo).
# Ejecutar desde la raíz del proyecto (donde está docker-compose.prod.yml).

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
PROJECT="${COMPOSE_PROJECT_NAME:-sigdom}"
DB_NAME="${POSTGRES_DB:-sigdom}"
DB_USER="${POSTGRES_USER:-postgres}"

DB_FILE="${1:-}"
STORAGE_FILE="${2:-}"

usage() {
  echo "Uso: $0 <backup_*.sql.gz> [storage_*.tar.gz]"
  echo
  echo "Respaldos disponibles en ./backups:"
  ls -lh backups/backup_*.sql.gz backups/storage_*.tar.gz 2>/dev/null || echo "  (no hay respaldos)"
}

if [ -z "$DB_FILE" ]; then
  usage
  exit 1
fi
if [ ! -f "$DB_FILE" ]; then
  echo "Error: no existe el archivo $DB_FILE"
  exit 1
fi
if [ -n "$STORAGE_FILE" ] && [ ! -f "$STORAGE_FILE" ]; then
  echo "Error: no existe el archivo $STORAGE_FILE"
  exit 1
fi

echo "ADVERTENCIA: se reemplazará toda la base de datos '$DB_NAME'$([ -n "$STORAGE_FILE" ] && echo ' y todos los adjuntos')."
echo "  Base de datos: $DB_FILE"
[ -n "$STORAGE_FILE" ] && echo "  Adjuntos:      $STORAGE_FILE"
if [ -z "${FORCE:-}" ]; then
  read -r -p "Escribe SI para continuar: " REPLY
  if [ "$REPLY" != "SI" ]; then
    echo "Operación cancelada."
    exit 1
  fi
fi

compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

echo "[restore] Deteniendo app y worker"
compose stop app worker

echo "[restore] Recreando la base de datos '$DB_NAME'"
compose exec -T db psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 <<SQL
DROP DATABASE IF EXISTS "$DB_NAME" WITH (FORCE);
CREATE DATABASE "$DB_NAME";
SQL

echo "[restore] Cargando $DB_FILE"
if [[ "$DB_FILE" == *.gz ]]; then
  gunzip -c "$DB_FILE" | compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -q -v ON_ERROR_STOP=1
else
  compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -q -v ON_ERROR_STOP=1 < "$DB_FILE"
fi
echo "[restore] Base de datos restaurada"

if [ -n "$STORAGE_FILE" ]; then
  STORAGE_VOLUME="$(docker volume ls -q \
    --filter "label=com.docker.compose.project=$PROJECT" \
    --filter "label=com.docker.compose.volume=app_storage" | head -n 1)"
  STORAGE_VOLUME="${STORAGE_VOLUME:-${PROJECT}_app_storage}"
  echo "[restore] Restaurando adjuntos en el volumen $STORAGE_VOLUME"
  docker volume inspect "$STORAGE_VOLUME" >/dev/null 2>&1 || docker volume create "$STORAGE_VOLUME" >/dev/null
  docker run --rm \
    -v "$STORAGE_VOLUME:/data" \
    -v "$(cd "$(dirname "$STORAGE_FILE")" && pwd):/backups:ro" \
    alpine sh -c "rm -rf /data/* /data/.[!.]* 2>/dev/null; tar xzf '/backups/$(basename "$STORAGE_FILE")' -C /data && chown -R 1001:1001 /data"
  echo "[restore] Adjuntos restaurados"
fi

echo "[restore] Levantando app y worker"
compose start app worker

echo "[restore] Listo. Verifica con: curl -fsS https://\$SITE_ADDRESS/api/health"
