# Database migrations (Supabase CLI vs VPS Postgres)

## Local development (`npm run dev` / `npm start`)

From `VexoCrm/backend`, npm runs `predev` / `prestart`, which execute `scripts/conditional-migrate.mjs`. That script runs `npx supabase db push --db-url` using `SUPABASE_DB_URL` or `DATABASE_URL` from `backend/.env`. Set `SKIP_DB_MIGRATE=1` to skip. This path is independent of `RUN_SUPABASE_MIGRATIONS_ON_START` (that variable is only read by Docker `start.sh`).

## Supabase-hosted project

`start.sh` runs [apply-supabase-migrations.sh](./apply-supabase-migrations.sh) when `RUN_SUPABASE_MIGRATIONS_ON_START=1`.

- Prefer `SUPABASE_DB_URL` for `supabase db push --db-url` inside CI/container.
- Or `SUPABASE_ACCESS_TOKEN` + `SUPABASE_DB_PASSWORD` with a linked project.

## Self-hosted Postgres (VPS)

When the schema is already applied (dump/restore or manual apply), **disable** auto-migrate on boot to avoid the CLI hitting the wrong target:

```bash
RUN_SUPABASE_MIGRATIONS_ON_START=0
```

To apply the same SQL migration files in `backend/supabase/migrations` against the VPS, set:

```bash
export SUPABASE_DB_URL="$DATABASE_URL"
RUN_SUPABASE_MIGRATIONS_ON_START=1
```

so `apply-supabase-migrations.sh` uses `supabase db push --db-url` against your VPS connection string (requires `npx supabase` network access from the container).

Alternatively, run `psql "$DATABASE_URL" -f path/to/migration.sql` manually for each file when you do not want the Supabase CLI.
