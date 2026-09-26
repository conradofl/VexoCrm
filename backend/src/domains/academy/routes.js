// backend/src/domains/academy/routes.js
//
// Vexo Academy — medição de uso das receitas (academy_recipe_usage). Sem
// isso não há como saber qual receita serve: quem só abriu, quem copiou o
// conteúdo de um bloco, quem de fato instalou.

const VALID_ACTIONS = new Set(["opened", "copied", "installed"]);

export function registerAcademyRoutes(app, deps) {
  const {
    ensureDb,
    normalizeString,
    pgDatabasePool,
    requireFirebaseAuth,
    resolveAuthorizedClientId,
    sendError,
  } = deps;

  // POST /api/academy/recipe-usage — registra uma ação (abriu/copiou/instalou)
  // sobre uma receita. Não sobrescreve nada: cada chamada é uma linha nova,
  // pra dar histórico real de uso, não um contador que reseta.
  app.post("/api/academy/recipe-usage", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const recipeId = normalizeString(req.body?.recipeId);
    const action = normalizeString(req.body?.action);
    if (!recipeId) {
      return sendError(res, 400, "MISSING_RECIPE_ID", "recipeId é obrigatório");
    }
    if (!VALID_ACTIONS.has(action)) {
      return sendError(res, 400, "INVALID_ACTION", 'action deve ser "opened", "copied" ou "installed"');
    }

    try {
      await pgDatabasePool.query(
        `INSERT INTO public.academy_recipe_usage (client_id, recipe_id, action) VALUES ($1, $2, $3)`,
        [clientId, recipeId, action]
      );
      res.status(201).json({ success: true });
    } catch (err) {
      sendError(res, 500, "RECIPE_USAGE_LOG_FAILED", err instanceof Error ? err.message : "Failed to log recipe usage");
    }
  });

  // GET /api/academy/diagnostics — "o que falta neste tenant": no máximo três
  // linhas, cada uma lida do estado real (não de suposição), cada uma
  // levando à receita que resolve. Sem nada a apontar, a lista vem vazia —
  // a tela decide sumir a faixa a partir disso, não este endpoint.
  const STALE_LEADS_THRESHOLD = 5;

  app.get("/api/academy/diagnostics", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const lines = [];

    // "Leads parados sem cadência" — leva direto à receita que resolve.
    try {
      const { rows } = await pgDatabasePool.query(
        `SELECT COUNT(*)::int AS n
         FROM public.lead_import_items
         WHERE client_id = $1
           AND created_at < now() - interval '2 days'
           AND (followup_status IS NULL OR followup_status = 'pending')`,
        [clientId]
      );
      const staleCount = rows[0]?.n || 0;
      if (staleCount >= STALE_LEADS_THRESHOLD) {
        lines.push({
          id: "leads-sem-cadencia",
          text: `${staleCount} leads parados há mais de 2 dias, sem cadência de retorno.`,
          recipeId: "recipe-recuperar-lead-frio",
        });
      }
    } catch (err) {
      console.error("[academy-diagnostics] leads-sem-cadencia error:", err);
    }

    res.json({ lines: lines.slice(0, 3) });
  });
}
