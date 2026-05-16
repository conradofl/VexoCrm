---
name: Backend modular routes (routeDeps)
type: decision
tags: [#backend, #vexocrm, #architecture]
status: active
created: 2026-05-12
updated: 2026-05-12
---

# Decision: route registration split from server.js

## Context
`backend/src/server.js` exceeded 11k lines mixing bootstrap, domain logic, and HTTP routes.

## Decision
- Keep a **modular monolith**: one Node process, one Express `app`.
- Move all `app.get/post/...` registrations to `backend/src/domains/registerAllDomainRoutes.js`.
- Introduce `backend/src/http/routeDeps.js` — a plain object populated via `Object.assign(routeDeps, { ... })` from `server.js` after all helpers exist, then call `registerAllDomainRoutes(app)`.
- Route module destructures `routeDeps` once per request registration scope (not per HTTP request).

## Alternatives considered
- `with(routeDeps)` — invalid in ES modules (strict).
- Per-request `ctx` parameter on every handler — too large a change for one pass.

## Consequences
- Regenerate `populateRouteDeps.snippet.js` / `registerAllDomainRoutes.js` with `scripts/gen-domain-routes.mjs` when adding top-level bindings used by routes.
- Next step: split `registerAllDomainRoutes.js` into smaller files under `domains/<name>/routes.js` without changing HTTP paths.

## Links
- Implementation: `VexoCrm/backend/src/server.js`, `VexoCrm/backend/src/domains/registerAllDomainRoutes.js`, `VexoCrm/backend/src/http/routeDeps.js`