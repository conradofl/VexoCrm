import { Router } from "express";
import { resolveAuthorizedClientId } from "../../services/tenant.js";
export function registerEventosRoutes(routeDeps) {
  const router = Router();
  const { pgDatabasePool, requireFirebaseAuth, requireInternalPageAccess, sendError } = routeDeps;
  router.use(requireFirebaseAuth);
  router.use(requireInternalPageAccess("eventos"));

  // List events
  router.get("/", requireFirebaseAuth, async (req, res) => {
    const clientId = resolveAuthorizedClientId(req, res, req.query.client_id || req.body.client_id);
    if (!clientId) return;

    try {
      const result = await pgDatabasePool.query(
        "SELECT id, name, date, location, created_at, updated_at FROM public.events WHERE client_id = $1 ORDER BY date DESC",
        [clientId]
      );
      res.json(result.rows);
    } catch (error) {
      sendError(res, 500, "DATABASE_ERROR", "Failed to list events", error.message);
    }
  });

  // Create event
  router.post("/", requireFirebaseAuth, async (req, res) => {
    const clientId = resolveAuthorizedClientId(req, res, req.body.client_id);
    if (!clientId) return;

    const { name, date, location } = req.body;
    if (!name) return sendError(res, 400, "BAD_REQUEST", "Name is required");
    try {
      const result = await pgDatabasePool.query(
        "INSERT INTO public.events (client_id, name, date, location) VALUES ($1, $2, $3, $4) RETURNING *",
        [clientId, name, date, location]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      sendError(res, 500, "DATABASE_ERROR", "Failed to create event", error.message);
    }
  });

  return router;
}
