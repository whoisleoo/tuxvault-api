#!/bin/sh
set -e

echo "[entrypoint] Ensuring vault directory exists..."
mkdir -p "${VAULT_PATH:-/data/vault}"

echo "[entrypoint] Running database migrations..."
node migrate.mjs

echo "[entrypoint] Starting server..."
exec node dist/server.js
