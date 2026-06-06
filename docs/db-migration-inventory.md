# Database migration inventory (VexoCrm backend)

Generated for the Postgres cutover. All SQL traffic from [backend/src/server.js](backend/src/server.js) goes through the `Postgres` handle (either `pg` or [backend/src/pgPostgresCompat.js](backend/src/pgPostgresCompat.js)).

## Tables touched via `.from("...")`

| Table | Typical operations |
| --- | --- |
| `access_profiles` | select |
| `analytics_insights` | select, delete (tenant purge) |
| `campaign_dispatch_logs` | insert |
| `campaigns` | select, insert, update, delete |
| `commercial_intelligence_settings` | select, insert, update |
| `crm_consultants` | select, insert, update, delete |
| `lead_assignments` | select, delete (tenant purge) |
| `lead_client_n8n_settings` | select, upsert |
| `lead_conversations` | insert, select |
| `lead_conversions` | select, delete |
| `lead_distribution_rules` | select, insert, update, delete |
| `lead_import_items` | select, insert, update, delete |
| `lead_imports` | select, insert, delete |
| `lead_messages` | select, delete |
| `leads` | select, insert, update, delete |
| `leads_clients` | select, insert, delete |
| `metric_snapshots` | delete (tenant purge) |
| `n8n_error_logs` | upsert |
| `notifications` | select (incl. head count), insert, update |

## Postgres chain features used (compat layer must support)

- `select`, `insert`, `update`, `upsert`, `delete` (with `{ count: "exact" }` for bulk deletes)
- Filters: `eq`, `neq`, `in`, `is`, `not(..., "is", null)`, `lte`
- `order(..., { ascending, nullsFirst })`, `limit`
- `single`, `maybeSingle`
- `select("*", { count: "exact", head: true })` for unread notification counts

## Route groups (high level)

| Area | Routes (examples) | Tables |
| --- | --- | --- |
| Tenants / N8N settings | `/api/lead-clients`, `/api/lead-clients/:id/n8n-settings` | `leads_clients`, `lead_client_n8n_settings` |
| Leads & webhooks | `/api/leads`, `/api/import-lead-infinie-n8n`, dashboard | `leads`, `leads_clients`, imports, campaigns, CI tables |
| Imports | `/api/lead-imports`, `/api/lead-import-items` | `lead_imports`, `lead_import_items` |
| Campaigns | `/api/campaigns/*`, scheduler | `campaigns`, `campaign_dispatch_logs`, `leads`, `lead_import_items` |
| Notifications | `/api/notifications` | `notifications` |
| n8n / memory | `/api/n8n-error-webhook`, `/api/conversation-memory` | `n8n_error_logs`, `notifications`, `leads`, `lead_conversations` |
| Commercial intelligence | `/api/commercial-intelligence/*` | `crm_consultants`, `lead_distribution_rules`, `lead_assignments`, `commercial_intelligence_settings`, `analytics_insights`, etc. |

For smoke validation see [backend-postgres-smoke.md](./backend-postgres-smoke.md).
