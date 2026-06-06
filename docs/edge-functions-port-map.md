# rotas Express to Express port map

Maps each active Postgres rota Express (see [postgres-functions.md](./postgres-functions.md)) to the **preferred** backend replacement on the VPS. Status reflects the repo as of 2026-05-07.

| rota Express | Backend route / status | Notes |
| --- | --- | --- |
| `conversation-memory` | `POST` [server.js](../backend/src/server.js) `/api/conversation-memory` | **partial** — see [Edge parity](#edge-parity). |
| `conversation-memory-latest` | `GET` `/api/conversation-memory/latest?telefone=` | **OK** (bearer via `N8N_WEBHOOK_SECRET`). |
| `lead-webhook` | `POST` [`/api/lead-webhook`](../backend/src/server.js) | **OK** — same contract as Edge (`action`, Bearer via `LEAD_WEBHOOK_BEARER_TOKEN`, default `@Vexo2026`). Bulk Infinié import remains [`POST /api/import-lead-infinie-n8n`](../backend/src/server.js). |
| `n8n-planilha-webhook` | *No n8n bearer route*; CRM uses `/api/lead-imports` (Firebase) | **missing** for n8n — see [Edge parity](#edge-parity). |
| `mark-lead-dispatched` | *Not implemented* | **missing** — see [Edge parity](#edge-parity). |
| `n8n-error-webhook` | `POST` `/api/n8n-error-webhook` | **partial** (error JSON shape differs on failures). |
| `notifications-api` | `GET` + `PATCH` `/api/notifications` | **partial** (Firebase vs Postgres JWT). |
| `get-leads-disparo` | `GET` `/api/leads-for-dispatch` (closest; not identical) | **partial** — see [Edge parity](#edge-parity). |

## Cutover checklist (n8n)

1. Point each HTTP Request node from `https://<ref>.Postgres.co/functions/v1/...` to `https://<api-host>/api/...`.
2. Reuse existing bearer secrets configured per client where applicable.
3. Run flows in staging with `DATABASE_URL` pointed at VPS Postgres.

## Edge parity

**Rule:** New backend routes that replace rotas Express com Postgres direto for n8n or external automations **must** match the Edge HTTP contract (method, path/query, required headers, status codes, and JSON bodies on success and on handled errors) unless the change is **explicitly versioned** (e.g. new path prefix or `Accept`/header gate) and documented here.

Canonical Edge sources (repo): [`frontend/postgres/functions/<name>/index.ts`](../frontend/postgres/functions/) (no mirror under `backend/postgres/` in this repo).

| rota Express | Parity | Backend target | Notes |
| --- | --- | --- | --- |
| `conversation-memory` | **partial** | `POST` [`/api/conversation-memory`](../backend/src/server.js) | Edge `GET` on this function is **not** exposed on the same path; use `GET /api/conversation-memory/latest` for the richer n8n flow. POST: Edge allows `tamanho_original >= 0` and raw payload; backend validates **gzip+base64**, `tamanho_original` **> 0**, and **5MB** decompressed cap — stricter by design. Success body aligned with Edge (`created_at` included). Auth: Edge `EDGE_FUNCTION_BEARER_TOKEN`; backend `N8N_WEBHOOK_SECRET` via `requireN8nWebhookSecret`. Errors: Edge `{ success, error, details? }`; many backend paths use `sendError` `{ error: { code, message, details? } }`. |
| `conversation-memory-latest` | **OK** | `GET` [`/api/conversation-memory/latest`](../backend/src/server.js) | Query `telefone`; success/error shapes match Edge. Auth: Edge fixed `Bearer @Vexo2026`; backend `Bearer ${N8N_WEBHOOK_SECRET}` — set env to the legacy token for cutover. |
| `lead-webhook` | **OK** | [`POST /api/lead-webhook`](../backend/src/server.js) | Matches Edge: `action` `create` \| `finalize`, flat JSON errors, success shapes. Bearer: env `LEAD_WEBHOOK_BEARER_TOKEN` or default `@Vexo2026`. Phone normalization is digits-only (Edge parity), not the BR expansion used by [`POST /api/import-lead-infinie-n8n`](../backend/src/server.js). |
| `n8n-planilha-webhook` | **missing** | *No public n8n route with same response* | Edge: `POST` only in [`index.ts`](../frontend/postgres/functions/n8n-planilha-webhook/index.ts); per-client bearer from `lead_client_n8n_settings`; response `success`, `total_rows`, `items`, etc. CRM import lives under [`POST /api/lead-imports`](../backend/src/server.js) with **Firebase** auth — not interchangeable for n8n without a new route. (Docs mentioning `GET` for this function are stale vs current Edge file.) |
| `mark-lead-dispatched` | **missing** | *Not implemented* | Edge: `POST`, `Bearer @Vexo2026`, body `telefone`, updates `lead_import_items.skip_reason`. No matching Express handler found. |
| `n8n-error-webhook` | **partial** | [`POST /api/n8n-error-webhook`](../backend/src/server.js) | `200` `{ success: true }` matches Edge. `401`/`400`/`500`: Edge uses flat `{ error, details? }`; backend uses `sendError` nested `error.code` / `error.message`. |
| `notifications-api` | **partial** | `GET` / `PATCH` [`/api/notifications`](../backend/src/server.js) | Edge validates **Postgres JWT** (`DATABASE_ANON_KEY` + user session). Backend uses **Firebase** (`requireFirebaseAuth`) and notification scoping helpers. JSON: `GET` returns `{ items, unreadCount }` (aligned). `PATCH`: backend may return `{ success: true, updated: n }` for scoped `markAllRead` — beyond Edge’s `{ success: true }`. |
| `get-leads-disparo` | **partial** | [`GET /api/leads-for-dispatch`](../backend/src/server.js) | Edge: global `Bearer @Vexo2026`, reads **`lead_import_items`**, dedupes by phone, optional `campaignId` echo in response. Backend: per-client **`validateN8nInboundBearer`**, reads **`leads`** (filters `status != dispatched`), default `limit` 50 vs Edge unbounded; response shape similar (`success`, `total`, `leads`) but field sources differ. [`GET /api/lead-import-items`](../backend/src/server.js) is Firebase-only — not an n8n drop-in. |
