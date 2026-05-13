# HTTP domains (VexoCrm backend)

## Layout
- `registerAllDomainRoutes.js` — all Express route registrations (`app.get`, `app.post`, …). Generated/maintained alongside `server.js` via `scripts/gen-domain-routes.mjs`.
- `../http/routeDeps.js` — mutable dependency bag filled from `server.js` before routes mount.
- `../http/populateRouteDeps.snippet.js` — helper output from the generator (shorthand `Object.assign` list); do not import at runtime.

## Regenerating after editing `server.js` helpers
If you add a new top-level `function` / `const` / `let` used by route handlers, re-run:
`node scripts/gen-domain-routes.mjs`
Then restore any **manual** imports at the top of `registerAllDomainRoutes.js` (e.g. chatbot persistence) if the generator drops them.

## Next refactor
Split this file into `domains/<area>/routes.js` modules that each export `registerAreaRoutes(app)` and share `routeDeps`, without changing URL paths.