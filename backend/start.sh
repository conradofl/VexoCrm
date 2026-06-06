#!/usr/bin/env bash
# Optional DB migrations before `npm start`.

set -euo pipefail

if [[ "${RUN_POSTGRES_MIGRATIONS_ON_START:-0}" == "1" ]]; then
    echo "==> Running Postgres migrations before starting the API..."
    node ./scripts/conditional-migrate.mjs
else
    echo "==> Skipping Postgres migrations because RUN_POSTGRES_MIGRATIONS_ON_START=${RUN_POSTGRES_MIGRATIONS_ON_START:-0}"
fi

if [[ "${VEXO_START_DRY_RUN:-0}" == "1" ]]; then
    echo "==> Dry run enabled. Skipping API start."
    exit 0
fi

exec npm start
