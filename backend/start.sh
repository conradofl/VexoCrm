#!/usr/bin/env bash
# Optional DB migrations before `npm start`.
# When targeting VPS Postgres only, read backend/scripts/README-db-migrations.md (often set RUN_SUPABASE_MIGRATIONS_ON_START=0).

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

# Migrations condicionais (equivalente ao `npm prestart`). Rodadas ANTES do exec.
node scripts/conditional-migrate.mjs

# `exec node` faz o node virar PID 1 → recebe SIGTERM/SIGINT direto do Docker/Easypanel
# (sem a camada do npm, que não repassava o sinal e deixava o processo antigo segurando
# a porta no restart → EADDRINUSE no novo processo).
exec node src/server.js
