#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

INITDB_BIN="$(command -v initdb || true)"
if [[ -z "$INITDB_BIN" ]]; then
  echo "[ISOLATED_PREVIEW_BLOCKED] PostgreSQL local não está instalado."
  exit 1
fi
PG_BIN="$(dirname "$INITDB_BIN")"
if [[ ! -x "$PG_BIN/pg_ctl" || ! -x "$PG_BIN/createdb" ]]; then
  echo "[ISOLATED_PREVIEW_BLOCKED] PostgreSQL local não está instalado."
  exit 1
fi

HTTP_PORT="${ISOLATED_PREVIEW_HTTP_PORT:-5000}"
if [[ "$HTTP_PORT" != "5000" && "$HTTP_PORT" != "5001" ]]; then
  echo "[ISOLATED_PREVIEW_BLOCKED] Porta HTTP não permitida."
  exit 1
fi

TMP_ROOT="$(mktemp -d /tmp/vivafrutaz-isolated-preview.XXXXXX)"
case "$TMP_ROOT" in
  /tmp/vivafrutaz-isolated-preview.*) ;;
  *)
    echo "[ISOLATED_PREVIEW_BLOCKED] Diretório temporário inesperado."
    exit 1
    ;;
esac

PG_DATA="$TMP_ROOT/postgres"
PG_LOG="$TMP_ROOT/postgres.log"
PG_PORT=55439
PG_STARTED=0

clean_pg() {
  env -i PATH="$PATH" HOME="${HOME:-/tmp}" LC_ALL=C \
    "$PG_BIN/pg_ctl" -D "$PG_DATA" -m fast -w stop >/dev/null 2>&1 || true
}

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ "$PG_STARTED" == "1" ]]; then
    clean_pg
  fi
  rm -rf -- "$TMP_ROOT"
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

env -i PATH="$PATH" HOME="${HOME:-/tmp}" LC_ALL=C \
  "$PG_BIN/initdb" \
  -D "$PG_DATA" \
  --auth-local=trust \
  --auth-host=trust \
  --username=preview \
  --encoding=UTF8 \
  --no-locale \
  --no-sync

env -i PATH="$PATH" HOME="${HOME:-/tmp}" LC_ALL=C \
  PGHOST=127.0.0.1 PGPORT="$PG_PORT" PGUSER=preview \
  "$PG_BIN/pg_ctl" \
  -D "$PG_DATA" \
  -l "$PG_LOG" \
  -o "-h 127.0.0.1 -p $PG_PORT -c listen_addresses=127.0.0.1 -c unix_socket_directories=$TMP_ROOT -c fsync=off -c synchronous_commit=off" \
  -w start
PG_STARTED=1

env -i PATH="$PATH" HOME="${HOME:-/tmp}" LC_ALL=C \
  PGHOST=127.0.0.1 PGPORT="$PG_PORT" PGUSER=preview \
  "$PG_BIN/createdb" vivafrutaz_preview

ISOLATED_PREVIEW_DATABASE_URL="postgresql://preview@127.0.0.1:${PG_PORT}/vivafrutaz_preview"
ISOLATED_PREVIEW_SESSION_SECRET="local-isolated-preview-session-${TMP_ROOT##*.}"

echo "[ISOLATED_PREVIEW] PostgreSQL efêmero em loopback; sem seeds, migrations, workers ou credenciais externas."

env -i \
  PATH="$PATH" \
  HOME="${HOME:-/tmp}" \
  PWD="$ROOT_DIR" \
  NODE_ENV=development \
  ISOLATED_PREVIEW_MODE=1 \
  ISOLATED_PREVIEW_DATABASE_URL="$ISOLATED_PREVIEW_DATABASE_URL" \
  ISOLATED_PREVIEW_DATA_DIR="$TMP_ROOT" \
  DOTENV_CONFIG_PATH=/dev/null \
  PORT="$HTTP_PORT" \
  HOST=0.0.0.0 \
  SESSION_SECRET="$ISOLATED_PREVIEW_SESSION_SECRET" \
  NFE_SEFAZ_MODE=mock \
  NFE_AMBIENTE=2 \
  NFE_UF=SP \
  ENABLE_NFE_IDEMPOTENCY_GUARD=true \
  node_modules/.bin/tsx server/index.ts
