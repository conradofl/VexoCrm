// backend/src/domains/notifications/routes.js
// Domínio de Notificações Operacionais do CRM (Sininho de Notificações)
// Multi-tenant estrito por client_id via resolveAuthorizedClientId.

export function registerNotificationsRoutes(app, deps) {
  const {
    ensureDb,
    pgDatabasePool,
    requireFirebaseAuth,
    resolveAuthorizedClientId,
    sendError,
  } = deps;

  // Bootstrap idempotente da tabela notifications
  (async () => {
    try {
      if (pgDatabasePool?.query) {
        await pgDatabasePool.query(`
          CREATE TABLE IF NOT EXISTS public.notifications (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id TEXT NOT NULL,
            user_id TEXT,
            type TEXT NOT NULL,
            title TEXT NOT NULL,
            description TEXT,
            link TEXT,
            read BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
          )
        `);
        await pgDatabasePool.query(`
          CREATE INDEX IF NOT EXISTS idx_notifications_client_read_created
            ON public.notifications (client_id, read, created_at DESC)
        `);
      }
    } catch (err) {
      console.warn("[notifications-domain] Bootstrap warning:", err?.message || err);
    }
  })();

  // GET /api/notifications: feed de notificações do usuário/tenant
  app.get("/api/notifications", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const clientId = resolveAuthorizedClientId(req, res);
    if (!clientId) return;

    const limit = Math.min(50, Math.max(1, parseInt(req.query?.limit ?? "20", 10) || 20));
    const onlyUnread = String(req.query?.onlyUnread || "false") === "true";

    try {
      const params = [clientId];
      const conditions = ["n.client_id = $1"];

      if (onlyUnread) {
        conditions.push("n.read = false");
      }

      const whereClause = `WHERE ${conditions.join(" AND ")}`;
      params.push(limit);
      const limitParam = params.length;

      const itemsQuery = `
        SELECT
          n.id,
          n.client_id,
          n.user_id,
          n.type,
          n.title,
          n.description,
          n.link,
          n.read,
          n.created_at
        FROM public.notifications n
        ${whereClause}
        ORDER BY n.created_at DESC
        LIMIT $${limitParam}
      `;

      const unreadCountQuery = `
        SELECT count(*)::int AS count
        FROM public.notifications n
        WHERE n.client_id = $1 AND n.read = false
      `;

      const [{ rows: items }, { rows: unreadRows }] = await Promise.all([
        pgDatabasePool.query(itemsQuery, params),
        pgDatabasePool.query(unreadCountQuery, [clientId]),
      ]);

      res.json({
        items: items || [],
        unreadCount: unreadRows[0]?.count ?? 0,
      });
    } catch (error) {
      console.error("[notifications] Falha ao consultar notificações:", error?.message || error);
      sendError(res, 500, "NOTIFICATIONS_QUERY_FAILED", "Falha ao consultar notificações.", {
        cause: error?.message,
      });
    }
  });

  // PATCH /api/notifications: marcar notificações como lidas
  app.patch("/api/notifications", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const clientId = resolveAuthorizedClientId(req, res);
    if (!clientId) return;

    const { id, read, markAllRead } = req.body || {};

    try {
      if (markAllRead) {
        await pgDatabasePool.query(
          `UPDATE public.notifications
           SET read = true
           WHERE client_id = $1 AND read = false`,
          [clientId]
        );
        return res.json({ success: true });
      }

      if (!id) {
        return sendError(res, 400, "INVALID_BODY", "id ou markAllRead é obrigatório.");
      }

      const isRead = read === undefined ? true : Boolean(read);
      const { rowCount } = await pgDatabasePool.query(
        `UPDATE public.notifications
         SET read = $1
         WHERE id = $2 AND client_id = $3`,
        [isRead, id, clientId]
      );

      if (rowCount === 0) {
        return sendError(res, 404, "NOT_FOUND", "Notificação não encontrada.");
      }

      res.json({ success: true });
    } catch (error) {
      console.error("[notifications] Falha ao atualizar notificação:", error?.message || error);
      sendError(res, 500, "NOTIFICATIONS_UPDATE_FAILED", "Falha ao atualizar notificação.", {
        cause: error?.message,
      });
    }
  });
}
