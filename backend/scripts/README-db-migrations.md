# Database migrations with direct Postgres

From `VexoCrm/backend`, `npm run dev` and `npm start` execute `scripts/conditional-migrate.mjs` before starting the API. The script reads SQL files from `backend/postgres/migrations` and applies pending files through the `pg` driver using `DATABASE_URL`.

Set `SKIP_DB_MIGRATE=1` to skip the prestart/predev migration step.

For Docker startup, `start.sh` can run the same migration path before the API:

```bash
RUN_POSTGRES_MIGRATIONS_ON_START=1
DATABASE_URL=postgresql://user:password@host:5432/database
```

The runner records applied files in `public.app_schema_migrations`.
