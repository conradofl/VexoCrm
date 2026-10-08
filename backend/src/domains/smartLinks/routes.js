// backend/src/domains/smartLinks/routes.js
// Domínio de Smart Links & Redirecionamento Público do Vexo OS
// Rotas públicas de redirecionamento e endpoint de live feed para alertas em tempo real.

import { recordLinkClick } from "../../services/smartLinks.js";
import { notifySdrOnLinkClick } from "../../services/smartLinkAlerts.js";
import { resolveAuthorizedClientId as defaultResolveAuthorizedClientId } from "../../services/tenant.js";

/**
 * Registra as rotas de smart links.
 * @param {import("express").Express} app - Aplicação Express
 * @param {object} deps - Dependências do servidor (routeDeps)
 */
export function registerSmartLinksRoutes(app, deps) {
  const getPool = () => deps?.pgDatabasePool || deps?.pool;
  const resolveClientId = deps?.resolveAuthorizedClientId || defaultResolveAuthorizedClientId;
  const requireAuth = deps?.requireFirebaseAuth || ((_req, _res, next) => next());

  // ─── 1. Rota Pública de Redirecionamento (GET /l/:code e alias /api/l/:code) ───
  const handleRedirect = async (req, res) => {
    const rawCode = req.params?.code;
    const code = typeof rawCode === "string" ? rawCode.trim() : "";

    if (!code) {
      if (req.headers?.accept?.includes("application/json")) {
        return res.status(404).json({ error: "Link não encontrado ou expirado" });
      }
      return res.status(404).send("Link não encontrado ou expirado");
    }

    const pool = getPool();
    if (!pool) {
      console.error("[smartLinks] Pool de banco não disponível no redirecionamento público");
      return res.status(500).send("Serviço temporariamente indisponível");
    }

    try {
      const { rows } = await pool.query(
        "SELECT * FROM public.smart_links WHERE code = $1",
        [code]
      );

      const link = rows?.[0];
      if (!link) {
        if (req.headers?.accept?.includes("application/json")) {
          return res.status(404).json({ error: "Link não encontrado ou expirado" });
        }
        return res.status(404).send("Link não encontrado ou expirado");
      }

      // Dispara gravação do clique e notificação do SDR em background (não bloqueia o 302)
      recordLinkClick(pool, { link, req })
        .then(async (clickRow) => {
          if (clickRow) {
            await notifySdrOnLinkClick(pool, { link, click: clickRow }).catch((alertErr) => {
              console.warn(`[smartLinks] Falha ao disparar alerta SDR para link ${link.code}:`, alertErr?.message);
            });
          }
        })
        .catch((clickErr) => {
          console.error(`[smartLinks] Falha assíncrona ao registrar clique no link ${link.code}:`, clickErr);
        });

      // Evita cache agressivo do redirect para registrar múltiplos cliques
      res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");

      let destination = link.destination_url.trim();
      if (!/^https?:\/\//i.test(destination)) {
        destination = `https://${destination}`;
      }

      return res.redirect(302, destination);
    } catch (err) {
      console.error(`[smartLinks] Erro ao buscar smart link ${code}:`, err);
      return res.status(500).send("Erro interno ao processar redirecionamento");
    }
  };

  app.get("/l/:code", handleRedirect);
  app.get("/api/l/:code", handleRedirect);

  // ─── 2. Endpoint Autenticado de Feed em Tempo Real (GET /api/smart-links/live-feed) ───
  app.get("/api/smart-links/live-feed", requireAuth, async (req, res) => {
    if (deps?.ensureDb && !deps.ensureDb(res)) return;

    const requestedClientId = req.query?.clientId ? String(req.query.clientId).trim() : null;
    const clientId = resolveClientId(req, res, requestedClientId);
    if (!clientId) return; // resolveAuthorizedClientId já enviou resposta 403 se não autorizado

    const pool = getPool();
    if (!pool) {
      if (deps?.sendError) {
        return deps.sendError(res, 500, "DB_UNAVAILABLE", "Banco de dados indisponível");
      }
      return res.status(500).json({ error: "Banco de dados indisponível" });
    }

    try {
      const rawLimit = Number.parseInt(String(req.query?.limit || "20"), 10);
      const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20;

      const sinceParam = req.query?.since ? String(req.query.since).trim() : null;
      const values = [clientId];
      let sinceClause = "";

      if (sinceParam) {
        const sinceDate = new Date(sinceParam);
        if (!isNaN(sinceDate.getTime())) {
          values.push(sinceDate.toISOString());
          sinceClause = `AND c.clicked_at > $${values.length}`;
        }
      }

      values.push(limit);
      const limitPlaceholder = `$${values.length}`;

      const sql = `
        SELECT 
          c.id AS click_id,
          c.clicked_at,
          c.device_type,
          c.ip_address,
          l.code,
          l.destination_url,
          l.title AS link_title,
          l.clicks_count,
          l.lead_id,
          ld.nome AS lead_nome,
          ld.telefone AS lead_telefone,
          ld.stage AS lead_stage,
          l.campaign_id,
          cmp.name AS campaign_name
        FROM public.smart_link_clicks c
        JOIN public.smart_links l ON l.id = c.link_id
        LEFT JOIN public.leads ld ON ld.id = l.lead_id
        LEFT JOIN public.campaigns cmp ON cmp.id = l.campaign_id
        WHERE l.client_id = $1
        ${sinceClause}
        ORDER BY c.clicked_at DESC
        LIMIT ${limitPlaceholder};
      `;

      const { rows } = await pool.query(sql, values);
      return res.json({ clicks: rows });
    } catch (err) {
      console.error("[smartLinks] Erro ao consultar live feed:", err);
      if (deps?.sendError) {
        return deps.sendError(res, 500, "LIVE_FEED_ERROR", "Falha ao carregar live feed de links", err.message);
      }
      return res.status(500).json({ error: "Falha ao carregar live feed de links", message: err.message });
    }
  });
}
