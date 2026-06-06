#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SUPABASE_DIR="${SUPABASE_DIR:-$BACKEND_ROOT/supabase}"
SUPABASE_CONFIG_FILE="$SUPABASE_DIR/config.toml"
SUPABASE_MIGRATIONS_DIR="$SUPABASE_DIR/migrations"
SUPABASE_MIGRATIONS_DRY_RUN="${SUPABASE_MIGRATIONS_DRY_RUN:-0}"

require_env() {
    local name="$1"
    if [[ -z "${!name:-}" ]]; then
        echo "Missing required environment variable: $name" >&2
        exit 1
    fi
}

print_command() {
    printf "+"
    for arg in "$@"; do
        printf " %q" "$arg"
    done
    printf "\n"
}

run_supabase() {
    if [[ "$SUPABASE_MIGRATIONS_DRY_RUN" == "1" ]]; then
        print_command supabase "$@"
        return 0
    fi

    if ! command -v node >/dev/null 2>&1 || ! command -v npx >/dev/null 2>&1; then
        echo "Node.js with npx is required to run Supabase migrations." >&2
        exit 1
    fi

    npx --yes supabase@latest "$@"
}

if [[ ! -f "$SUPABASE_CONFIG_FILE" ]]; then
    echo "Supabase config not found at $SUPABASE_CONFIG_FILE" >&2
    exit 1
fi

if [[ ! -d "$SUPABASE_MIGRATIONS_DIR" ]]; then
    echo "Supabase migrations directory not found at $SUPABASE_MIGRATIONS_DIR" >&2
    exit 1
fi

shopt -s nullglob
migration_files=("$SUPABASE_MIGRATIONS_DIR"/*.sql)
shopt -u nullglob

if [[ ${#migration_files[@]} -eq 0 ]]; then
    echo "No Supabase migrations found in $SUPABASE_MIGRATIONS_DIR"
    exit 0
fi

PROJECT_ID="${SUPABASE_PROJECT_ID:-}"
if [[ -z "$PROJECT_ID" ]]; then
    PROJECT_ID="$(
        sed -nE 's/^project_id[[:space:]]*=[[:space:]]*"([^"]+)".*$/\1/p' "$SUPABASE_CONFIG_FILE" | head -n 1
    )"
fi

cd "$BACKEND_ROOT"

echo "==> Found ${#migration_files[@]} Supabase migration file(s) in backend/supabase/migrations"

if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
    echo "==> Applying Supabase migrations using SUPABASE_DB_URL"
    run_supabase db push --db-url "$SUPABASE_DB_URL"
    echo "==> Supabase migrations applied successfully."
    exit 0
fi

require_env SUPABASE_ACCESS_TOKEN
require_env SUPABASE_DB_PASSWORD

if [[ -z "$PROJECT_ID" ]]; then
    echo "Could not resolve SUPABASE_PROJECT_ID from environment or $SUPABASE_CONFIG_FILE" >&2
    exit 1
fi

echo "==> Linking Supabase project $PROJECT_ID"
run_supabase link --project-ref "$PROJECT_ID" -p "$SUPABASE_DB_PASSWORD"

echo "==> Applying Supabase migrations to linked project"
run_supabase db push --linked -p "$SUPABASE_DB_PASSWORD"

echo "==> Supabase migrations applied successfully."
