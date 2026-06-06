# VexoCrm/backend/src/repos

Phase 1 of the Postgres migration keeps **one compatibility client** in [pgSupabaseCompat.js](../pgSupabaseCompat.js) so `server.js` can keep calling `supabase.from("table").select()...` without per-domain repository files.

Later phases may extract SQL here (`leadsRepo.js`, `campaignsRepo.js`, …) if queries outgrow the shim or you need typed helpers for tests.
