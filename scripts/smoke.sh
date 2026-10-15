#!/bin/bash
# Prueba de humo contra una instancia de SIGDOM El Bosque (§13, Fase 11).
#
#   ./scripts/smoke.sh [URL]                       # por defecto http://localhost:3000
#   SMOKE_EMAIL=... SMOKE_PASSWORD=... ./scripts/smoke.sh https://sigdomelbosque.cl
#   SMOKE_INSECURE=1 ./scripts/smoke.sh https://localhost   # acepta el certificado local de Caddy
#
# Comprueba: /api/health 200 · / 200 · /api/layers sin sesión 401 · inicio de sesión · /api/layers con sesión 200.
# Si no se definen SMOKE_EMAIL y SMOKE_PASSWORD, se omiten los dos últimos pasos.

set -uo pipefail

BASE_URL="${1:-${SMOKE_URL:-http://localhost:3000}}"
BASE_URL="${BASE_URL%/}"
EMAIL="${SMOKE_EMAIL:-}"
PASSWORD="${SMOKE_PASSWORD:-}"
COOKIES="$(mktemp)"
trap 'rm -f "$COOKIES"' EXIT

FAILED=0

# Con SMOKE_INSECURE=1, todas las llamadas aceptan un certificado no confiable (Caddy con SITE_ADDRESS=localhost).
curl() {
  if [ "${SMOKE_INSECURE:-}" = "1" ]; then command curl -k "$@"; else command curl "$@"; fi
}
ok()   { echo "  OK    $1"; }
fail() { echo "  FALLA $1"; FAILED=1; }

status_of() {
  # status_of <método> <ruta> [opciones curl...]
  local method="$1" path="$2"; shift 2
  curl -sS -o /dev/null -w '%{http_code}' -X "$method" "$BASE_URL$path" "$@" 2>/dev/null || echo "000"
}

echo "Prueba de humo contra $BASE_URL"

# 1) Salud
code="$(status_of GET /api/health)"
body="$(curl -sS "$BASE_URL/api/health" 2>/dev/null)"
if [ "$code" = "200" ] && echo "$body" | grep -q '"db":"ok"'; then ok "GET /api/health -> 200 ($body)"; else fail "GET /api/health -> $code ($body)"; fi

# 2) Página de ingreso
code="$(status_of GET /)"
if [ "$code" = "200" ]; then ok "GET / -> 200"; else fail "GET / -> $code"; fi

# 3) API protegida sin sesión
code="$(status_of GET /api/layers -H 'Accept: application/json')"
if [ "$code" = "401" ]; then ok "GET /api/layers sin sesión -> 401"; else fail "GET /api/layers sin sesión -> $code (se esperaba 401)"; fi

# 4) Inicio de sesión + API con sesión
if [ -n "$EMAIL" ] && [ -n "$PASSWORD" ]; then
  payload="$(printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD")"
  code="$(curl -sS -o /dev/null -w '%{http_code}' -c "$COOKIES" \
    -H 'Content-Type: application/json' -H "Origin: $BASE_URL" \
    -X POST "$BASE_URL/api/auth/sign-in/email" --data "$payload" 2>/dev/null || echo "000")"
  if [ "$code" = "200" ]; then ok "POST /api/auth/sign-in/email -> 200"; else fail "POST /api/auth/sign-in/email -> $code"; fi

  code="$(status_of GET /api/layers -b "$COOKIES" -H 'Accept: application/json')"
  if [ "$code" = "200" ]; then
    count="$(curl -sS -b "$COOKIES" "$BASE_URL/api/layers" 2>/dev/null | grep -o '"id"' | wc -l | tr -d ' ')"
    ok "GET /api/layers con sesión -> 200 ($count capas)"
  else
    fail "GET /api/layers con sesión -> $code"
  fi

  curl -sS -o /dev/null -b "$COOKIES" -H "Origin: $BASE_URL" -X POST "$BASE_URL/api/auth/sign-out" 2>/dev/null || true
else
  echo "  --    Inicio de sesión omitido (define SMOKE_EMAIL y SMOKE_PASSWORD para probarlo)"
fi

if [ "$FAILED" = "0" ]; then
  echo "Resultado: todo en orden"
else
  echo "Resultado: hay fallas"
  exit 1
fi
