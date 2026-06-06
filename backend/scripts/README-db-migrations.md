# Database migrations with direct Postgres

From `VexoCrm/backend`, run `npm run migrate` when you explicitly want to apply SQL migrations. The script reads SQL files from `backend/postgres/migrations` and applies pending files through the `pg` driver using `DATABASE_URL`.

Plain `npm start` and `npm run dev` do not apply migrations.

For Docker startup, `start.sh` can run the same migration path before the API:

```bash
RUN_POSTGRES_MIGRATIONS_ON_START=1
DATABASE_URL=postgresql://user:password@host:5432/database
```

The runner records applied files in `public.app_schema_migrations`.
