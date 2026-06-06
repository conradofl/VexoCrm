# Smoke checklist: backend with Postgres (VPS)

Prereqs: `DATABASE_URL` reachable from the machine; `DB_DRIVER=postgres` **or** `DATABASE_URL` with `DATA_SOURCE` not set to `supabase`.

1. `GET /health` — expect `services.databaseDriver: "postgres"`, `services.postgresPing: true`.
2. `GET /api/lead-clients` (Firebase auth) — list tenants.
3. `GET /api/leads?clientId=<id>` — rows return.
4. `GET /api/dashboard?clientId=<id>` — aggregates without 500.
5. `GET /api/notifications` — list + unread count path (head count query).
6. `POST /api/n8n-error-webhook` (valid bearer) — upsert log + optional notification insert.

If `postgresPing` is false, check firewall, SSL mode in `DATABASE_URL`, and pool timeout envs (`PG_CONNECTION_TIMEOUT_MS`).
