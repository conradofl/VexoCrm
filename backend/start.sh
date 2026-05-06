#!/usr/bin/env bash

set -euo pipefail

if [[ "${RUN_SUPABASE_MIGRATIONS_ON_START:-0}" == "1" ]]; then
    echo "==> Running Supabase migrations before starting the API..."
    bash ./scripts/apply-supabase-migrations.sh
else
    echo "==> Skipping Supabase migrations because RUN_SUPABASE_MIGRATIONS_ON_START=${RUN_SUPABASE_MIGRATIONS_ON_START:-0}"
fi

if [[ "${VEXO_START_DRY_RUN:-0}" == "1" ]]; then
    echo "==> Dry run enabled. Skipping API start."
    exit 0
fi

exec npm start
