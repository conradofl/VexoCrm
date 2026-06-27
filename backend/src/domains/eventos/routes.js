import { Router } from "express";

export function registerEventosRoutes(routeDeps) {
  const router = Router();
  const { pgDatabasePool, requireFirebaseAuth, requireInternalPageAccess, sendError } = routeDeps;
  router.use(requireFirebaseAuth);
  router.use(requireInternalPageAccess("eventos"));

  // List events
  router.get("/", requireFirebaseAuth, async (req, res) => {
    try {
      const result = await pgDatabasePool.query(
        "SELECT id, name, date, location, created_at, updated_at FROM public.events ORDER BY date DESC"
      );
      res.json(result.rows);
    } catch (error) {
      sendError(res, 500, "DATABASE_ERROR", "Failed to list events", error.message);
    }
  });

  // Create event
  router.post("/", requireFirebaseAuth, async (req, res) => {
    const { name, date, location } = req.body;
    if (!name) return sendError(res, 400, "BAD_REQUEST", "Name is required");
    try {
      const result = await pgDatabasePool.query(
        "INSERT INTO public.events (name, date, location) VALUES ($1, $2, $3) RETURNING *",
        [name, date, location]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      sendError(res, 500, "DATABASE_ERROR", "Failed to create event", error.message);
    }
  });

  return router;
}
