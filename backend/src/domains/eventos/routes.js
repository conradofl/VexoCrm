import { Router } from "express";
import { resolveAuthorizedClientId } from "../../services/tenant.js";

/**
 * registerEventosRoutes
 * CRUD completo e multi-tenant para gestão de eventos, esteiras temporais e métricas.
 */
export function registerEventosRoutes(routeDeps) {
  const router = Router();
  const { pgDatabasePool, requireFirebaseAuth, sendError } = routeDeps;

  router.use(requireFirebaseAuth);

  // GET /api/eventos — Lista eventos do tenant autenticado ordenados por data
  router.get("/", async (req, res) => {
    const clientId = resolveAuthorizedClientId(req, res, req.query.client_id || req.query.clientId);
    if (!clientId) return;

    try {
      const result = await pgDatabasePool.query(
        `SELECT id, client_id, name, date, location, description,
                COALESCE(tickets_sold, 0) AS tickets_sold,
                COALESCE(esteiras_status, '{"esteira1":"aguardando_disparo","esteira2":"processando_prompts","esteira5":"aguardando_data"}'::jsonb) AS esteiras_status,
                created_at, updated_at
           FROM public.events
          WHERE client_id = $1
          ORDER BY date ASC`,
        [clientId]
      );
      res.json(result.rows);
    } catch (error) {
      sendError(res, 500, "DATABASE_ERROR", "Failed to list events", error.message);
    }
  });

  // POST /api/eventos — Cria novo evento garantindo client_id
  router.post("/", async (req, res) => {
    const clientId = resolveAuthorizedClientId(req, res, req.body.client_id || req.body.clientId);
    if (!clientId) return;

    const { name, date, location, description, esteiras_status, esteirasStatus, tickets_sold, ticketsSold } = req.body || {};
    if (!name || !String(name).trim()) {
      return sendError(res, 400, "BAD_REQUEST", "Nome do evento é obrigatório");
    }
    if (!date) {
      return sendError(res, 400, "BAD_REQUEST", "Data do evento é obrigatória");
    }

    const initialEsteiras = esteiras_status || esteirasStatus || {
      esteira1: "aguardando_disparo",
      esteira2: "processando_prompts",
      esteira5: "aguardando_data",
    };

    const initialTickets = Number(tickets_sold ?? ticketsSold) || 0;

    try {
      const result = await pgDatabasePool.query(
        `INSERT INTO public.events (client_id, name, date, location, description, tickets_sold, esteiras_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
         RETURNING id, client_id, name, date, location, description, tickets_sold, esteiras_status, created_at, updated_at`,
        [
          clientId,
          String(name).trim(),
          date,
          location ? String(location).trim() : null,
          description ? String(description).trim() : null,
          initialTickets,
          JSON.stringify(initialEsteiras),
        ]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      sendError(res, 500, "DATABASE_ERROR", "Failed to create event", error.message);
    }
  });

  // PATCH /api/eventos/:id — Atualiza dados ou status das esteiras do evento
  router.patch("/:id", async (req, res) => {
    const clientId = resolveAuthorizedClientId(
      req,
      res,
      req.body.client_id || req.body.clientId || req.query.client_id || req.query.clientId
    );
    if (!clientId) return;

    const { id } = req.params;
    if (!id) return sendError(res, 400, "BAD_REQUEST", "Event ID is required");

    const { name, date, location, description, esteiras_status, esteirasStatus, tickets_sold, ticketsSold } = req.body || {};

    const updates = [];
    const values = [clientId, id];
    let idx = 3;

    if (name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(String(name).trim());
    }
    if (date !== undefined) {
      updates.push(`date = $${idx++}`);
      values.push(date);
    }
    if (location !== undefined) {
      updates.push(`location = $${idx++}`);
      values.push(location ? String(location).trim() : null);
    }
    if (description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(description ? String(description).trim() : null);
    }
    if (tickets_sold !== undefined || ticketsSold !== undefined) {
      updates.push(`tickets_sold = $${idx++}`);
      values.push(Number(tickets_sold ?? ticketsSold) || 0);
    }
    if (esteiras_status !== undefined || esteirasStatus !== undefined) {
      updates.push(`esteiras_status = $${idx++}`);
      values.push(JSON.stringify(esteiras_status || esteirasStatus));
    }

    if (updates.length === 0) {
      return sendError(res, 400, "BAD_REQUEST", "Nenhum campo para atualizar");
    }

    updates.push(`updated_at = NOW()`);

    try {
      const result = await pgDatabasePool.query(
        `UPDATE public.events
            SET ${updates.join(", ")}
          WHERE client_id = $1 AND id = $2
        RETURNING id, client_id, name, date, location, description, tickets_sold, esteiras_status, created_at, updated_at`,
        values
      );

      if (result.rows.length === 0) {
        return sendError(res, 404, "NOT_FOUND", "Evento não encontrado para este tenant");
      }

      res.json(result.rows[0]);
    } catch (error) {
      sendError(res, 500, "DATABASE_ERROR", "Failed to update event", error.message);
    }
  });

  // DELETE /api/eventos/:id — Exclui evento do tenant com segurança
  router.delete("/:id", async (req, res) => {
    const clientId = resolveAuthorizedClientId(
      req,
      res,
      req.query.client_id || req.query.clientId || req.body.client_id || req.body.clientId
    );
    if (!clientId) return;

    const { id } = req.params;
    if (!id) return sendError(res, 400, "BAD_REQUEST", "Event ID is required");

    try {
      const result = await pgDatabasePool.query(
        "DELETE FROM public.events WHERE client_id = $1 AND id = $2 RETURNING id",
        [clientId, id]
      );

      if (result.rows.length === 0) {
        return sendError(res, 404, "NOT_FOUND", "Evento não encontrado para este tenant");
      }

      res.json({ success: true, id });
    } catch (error) {
      sendError(res, 500, "DATABASE_ERROR", "Failed to delete event", error.message);
    }
  });

  return router;
}
