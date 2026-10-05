#!/bin/sh
# Punto de entrada del servicio `app` (§12.2): aplica las migraciones pendientes y arranca el servidor.
# El servicio `worker` no pasa por aquí (usa `node scripts/worker.js`), así que solo la app migra.
set -eu

echo "[entrypoint] Aplicando migraciones de base de datos…"
node scripts/migrate.js

echo "[entrypoint] Iniciando servidor Next en ${HOSTNAME:-0.0.0.0}:${PORT:-3000}"
exec node server.js
