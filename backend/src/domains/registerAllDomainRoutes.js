import { routeDeps } from "../http/routeDeps.js";
import { registerFollowupRoutes } from "../followup/routes.js";
import { registerJourneysRoutes } from "../followup/journeysRoutes.js";
import { registerGeracaoDigitalRoutes } from "./geracaoDigitalRoutes.js";
import { registerOnboardingRoutes } from "../onboarding/routes.js";
import { query as fupQuery } from "../followup/db.js";
import { getFollowupQueue } from "../followup/queue.js";
import { registerEventosRoutes } from "./eventos/routes.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerVexoSalesRoutes } from "./vexoSales/routes.js";
import { registerLeadsRoutes } from "./leads/routes.js";
import { registerInsightsRoutes } from "./insights/routes.js";
import { registerIntegrationsRoutes } from "./integrations/routes.js";
import { registerChatbotRoutes } from "./chatbot/routes.js";
import { registerCampaignsRoutes } from "./campaigns/routes.js";

/**
 * Registers all HTTP routes (extracted from legacy server.js).
 * routeDeps must be populated in server.js before this runs.
 *
 * Cada domínio (auth, vexoSales, leads, insights, integrations, chatbot, campaigns)
 * é registrado por seu próprio módulo em src/domains/<dominio>/routes.js e recebe
 * routeDeps inteiro (sem destructure aqui) -- cada módulo destructura só o que usa.
 *
 * As rotas de /api/followup-queue abaixo (GET, PATCH reschedule/discard, POST convert)
 * permanecem inline aqui: são um domínio à parte (não fazem parte de campaigns nem de
 * nenhum dos módulos já extraídos) e não estavam no escopo desta extração -- ver
 * relato da tarefa.
 */
export function registerAllDomainRoutes(app) {
  const {
    normalizeString,
    pgDatabasePool,
    requireAdminAccess,
    requireFirebaseAuth,
    requireInternalAccess,
    requireInternalPageAccess,
    sendError,
    supabase,
  } = routeDeps;

  registerInsightsRoutes(app, routeDeps);

  registerLeadsRoutes(app, routeDeps);

  registerIntegrationsRoutes(app, routeDeps);

  registerAuthRoutes(app, routeDeps);

  registerVexoSalesRoutes(app, routeDeps);

  registerChatbotRoutes(app, routeDeps);

  registerCampaignsRoutes(app, routeDeps);


  // ── Followup Queue (novo módulo) ─────────────────────────────────────────────

  // GET /api/followup-queue — lê followup_schedules + joins + status derivado
  app.get("/api/followup-queue", requireFirebaseAuth, async (req, res) => {
    const companyId = normalizeString(req.query?.companyId) || null;
    const campaignId = normalizeString(req.query?.campaignId) || null;
    const status = normalizeString(req.query?.status) || null;
    const dateFrom = normalizeString(req.query?.dateFrom) || null;
    const dateTo = normalizeString(req.query?.dateTo) || null;
    const rawPage = Number.parseInt(String(req.query?.page ?? "1"), 10);
    const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const rawLimit = Number.parseInt(String(req.query?.limit ?? "50"), 10);
    const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 200);

    const validStatuses = ["active", "awaiting_reply", "replied", "failed", "cancelled", "converted"];
    if (status && !validStatuses.includes(status)) {
      return sendError(res, 400, "INVALID_QUERY", `status must be one of: ${validStatuses.join(", ")}`);
    }

    try {
      const params = [];
      const filters = [];
      let idx = 1;
      if (companyId) { params.push(companyId); filters.push(`fco.id = $${idx++}`); }
      if (campaignId) { params.push(campaignId); filters.push(`fc.id = $${idx++}`); }
      if (dateFrom)   { params.push(dateFrom);   filters.push(`fs.created_at >= $${idx++}`); }
      if (dateTo)     { params.push(dateTo);     filters.push(`fs.created_at <= $${idx++}`); }
      const baseWhere = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

      let statusWhere = "";
      if (status) { params.push(status); statusWhere = `WHERE derived_status = $${idx++}`; }

      params.push(limit, (page - 1) * limit);
      const limitIdx = idx++, offsetIdx = idx++;

      const sql = `
        WITH base AS (
          SELECT
            fs.id,
            fs.lead_name,
            fs.phone,
            fs.origin,
            fs.meeting_datetime,
            fs.created_at,
            fs.campaign_id,
            fc.name       AS campaign_name,
            fc.company_id,
            fco.name      AS company_name,
            COUNT(fj.id) FILTER (WHERE fj.status = 'sent')    AS jobs_sent,
            COUNT(fj.id) FILTER (WHERE fj.status = 'failed')  AS jobs_failed,
            COUNT(fj.id) FILTER (WHERE fj.status = 'pending') AS jobs_pending,
            MAX(fj.sent_at)                                    AS last_sent_at,
            CASE
              WHEN fs.status = 'cancelled' THEN 'cancelled'
              WHEN fs.status = 'converted' THEN 'converted'
              WHEN EXISTS (
                SELECT 1 FROM followup_replies r
                WHERE r.company_id = fc.company_id AND r.phone = fs.phone
              ) THEN 'replied'
              WHEN COUNT(fj.id) FILTER (WHERE fj.status = 'failed') > 0
               AND COUNT(fj.id) FILTER (WHERE fj.status = 'pending') = 0 THEN 'failed'
              WHEN COUNT(fj.id) FILTER (WHERE fj.status = 'sent') > 0
               AND COUNT(fj.id) FILTER (WHERE fj.status = 'pending') = 0 THEN 'awaiting_reply'
              ELSE 'active'
            END AS derived_status
          FROM followup_schedules fs
          JOIN followup_campaigns fc  ON fc.id  = fs.campaign_id
          JOIN followup_companies fco ON fco.id = fc.company_id
          LEFT JOIN followup_jobs fj  ON fj.schedule_id = fs.id
          ${baseWhere}
          GROUP BY fs.id, fc.id, fco.id, fc.name, fco.name
        )
        SELECT *, COUNT(*) OVER() AS total_count
        FROM base
        ${statusWhere}
        ORDER BY created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;

      const { rows } = await fupQuery(sql, params);
      let total = rows.length > 0 ? Number(rows[0].total_count) : 0;

      const items = rows.map((r) => ({
        id:              r.id,
        leadName:        r.lead_name,
        phone:           r.phone,
        origin:          r.origin,
        companyId:       r.company_id,
        companyName:     r.company_name,
        campaignId:      r.campaign_id,
        campaignName:    r.campaign_name,
        status:          r.derived_status,
        jobsSent:        Number(r.jobs_sent),
        jobsFailed:      Number(r.jobs_failed),
        jobsPending:     Number(r.jobs_pending),
        lastSentAt:      r.last_sent_at || null,
        meetingDatetime: r.meeting_datetime || null,
        createdAt:       r.created_at,
      }));

      if (!companyId) {
        const { data: crmRows, error: crmRowsError } = await supabase
          .from("lead_import_items")
          .select("id, import_id, client_id, telefone, nome, normalized_data, ultima_interacao_bot, created_at")
          .not("ultima_interacao_bot", "is", null)
          .is("ultima_interacao_usuario", null)
          .or("followup_status.is.null,followup_status.eq.pending")
          .order("ultima_interacao_bot", { ascending: false })
          .limit(limit);

        if (crmRowsError) {
          console.warn("[followup-queue] crm campaign dispatch lookup failed:", crmRowsError.message || crmRowsError);
        } else if (crmRows?.length) {
          const clientIds = [...new Set(crmRows.map((row) => row.client_id).filter(Boolean))];
          const importIds = [...new Set(crmRows.map((row) => row.import_id).filter(Boolean))];

          const [{ data: crmClients }, { data: crmCampaigns }] = await Promise.all([
            clientIds.length
              ? supabase.from("leads_clients").select("id, name").in("id", clientIds)
              : Promise.resolve({ data: [] }),
            importIds.length
              ? supabase.from("campaigns").select("id, name, import_id, client_id").in("import_id", importIds)
              : Promise.resolve({ data: [] }),
          ]);

          const clientNameById = {};
          for (const client of crmClients || []) {
            if (client?.id) clientNameById[client.id] = client.name || client.id;
          }

          const campaignByImport = {};
          for (const campaign of crmCampaigns || []) {
            if (campaign?.import_id && campaign?.client_id) {
              campaignByImport[`${campaign.client_id}:${campaign.import_id}`] = campaign;
            }
          }

          const existingPhones = new Set(items.map((item) => `${item.companyId}:${item.phone}`));
          for (const row of crmRows) {
            const phone = normalizeString(row.telefone);
            const client = normalizeString(row.client_id);
            if (!phone || !client || existingPhones.has(`${client}:${phone}`)) continue;

            const campaign = campaignByImport[`${client}:${row.import_id}`] || null;
            const normalized = row.normalized_data && typeof row.normalized_data === "object" ? row.normalized_data : {};

            items.push({
              id: `crm_campaign_dispatch_${row.id}`,
              leadName: normalizeString(row.nome || normalized.nome || normalized.name) || null,
              phone,
              origin: "crm_campaign",
              companyId: client,
              companyName: clientNameById[client] || client,
              campaignId: campaign?.id || null,
              campaignName: campaign?.name || "Campanha CRM",
              status: "awaiting_reply",
              jobsSent: 1,
              jobsFailed: 0,
              jobsPending: 0,
              lastSentAt: row.ultima_interacao_bot || null,
              meetingDatetime: null,
              createdAt: row.created_at,
            });
            existingPhones.add(`${client}:${phone}`);
          }

          total += crmRows.length;
        }
      }

      return res.json({ success: true, items, total });
    } catch (err) {
      sendError(res, 500, "FOLLOWUP_QUEUE_FETCH_FAILED", err instanceof Error ? err.message : "Failed to fetch followup queue");
    }
  });

  // PATCH /api/followup-queue/:scheduleId/reschedule — cria novo job BullMQ com delay
  app.patch("/api/followup-queue/:scheduleId/reschedule", requireFirebaseAuth, async (req, res) => {
    const scheduleId = normalizeString(req.params?.scheduleId);
    if (!scheduleId) return sendError(res, 400, "INVALID_PARAM", "Missing scheduleId");

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const delayMinutes = Number(body.delayMinutes);
    const templateId = normalizeString(body.templateId) || null;

    if (!Number.isFinite(delayMinutes) || delayMinutes < 0) {
      return sendError(res, 400, "INVALID_BODY", "delayMinutes must be a non-negative number");
    }

    try {
      const { rows: schedRows } = await fupQuery(
        `SELECT fs.id, fs.campaign_id FROM followup_schedules fs WHERE fs.id = $1`,
        [scheduleId]
      );
      if (!schedRows.length) return sendError(res, 404, "NOT_FOUND", "Schedule not found");

      const { campaign_id } = schedRows[0];

      let resolvedTemplateId = templateId;
      if (!resolvedTemplateId) {
        const { rows: tplRows } = await fupQuery(
          `SELECT id FROM followup_templates WHERE campaign_id = $1 AND is_active = true ORDER BY order_index ASC LIMIT 1`,
          [campaign_id]
        );
        if (!tplRows.length) return sendError(res, 400, "NO_TEMPLATE", "No active template found for this campaign");
        resolvedTemplateId = tplRows[0].id;
      }

      const { rows: jobRows } = await fupQuery(
        `INSERT INTO followup_jobs (schedule_id, template_id, status) VALUES ($1, $2, 'pending') RETURNING id`,
        [scheduleId, resolvedTemplateId]
      );
      const newJobId = jobRows[0].id;

      await getFollowupQueue().add(
        "send-followup",
        { jobId: newJobId },
        { delay: delayMinutes * 60 * 1000, jobId: `fup-reschedule-${newJobId}` }
      );

      return res.json({ success: true, jobId: newJobId, delayMinutes });
    } catch (err) {
      sendError(res, 500, "RESCHEDULE_FAILED", err instanceof Error ? err.message : "Failed to reschedule");
    }
  });

  // PATCH /api/followup-queue/:scheduleId/discard — cancela schedule e jobs pendentes
  app.patch("/api/followup-queue/:scheduleId/discard", requireFirebaseAuth, async (req, res) => {
    const scheduleId = normalizeString(req.params?.scheduleId);
    if (!scheduleId) return sendError(res, 400, "INVALID_PARAM", "Missing scheduleId");

    try {
      const { rows } = await fupQuery(
        `UPDATE followup_schedules SET status = 'cancelled' WHERE id = $1 RETURNING id`,
        [scheduleId]
      );
      if (!rows.length) return sendError(res, 404, "NOT_FOUND", "Schedule not found");

      await fupQuery(
        `UPDATE followup_jobs SET status = 'cancelled' WHERE schedule_id = $1 AND status = 'pending'`,
        [scheduleId]
      );

      return res.json({ success: true, id: scheduleId });
    } catch (err) {
      sendError(res, 500, "DISCARD_FAILED", err instanceof Error ? err.message : "Failed to discard schedule");
    }
  });

  // POST /api/followup-queue/:scheduleId/convert — converte para inbound e dispara webhook
  app.post("/api/followup-queue/:scheduleId/convert", requireFirebaseAuth, async (req, res) => {
    const scheduleId = normalizeString(req.params?.scheduleId);
    if (!scheduleId) return sendError(res, 400, "INVALID_PARAM", "Missing scheduleId");

    try {
      const { rows } = await fupQuery(
        `UPDATE followup_schedules SET status = 'converted' WHERE id = $1 RETURNING id`,
        [scheduleId]
      );
      if (!rows.length) return sendError(res, 404, "NOT_FOUND", "Schedule not found");

      const { rows: infoRows } = await fupQuery(
        `SELECT fs.lead_name, fs.phone, fs.origin,
                fc.name AS campaign_name,
                fco.name AS company_name, fco.webhook_url
           FROM followup_schedules fs
           JOIN followup_campaigns fc  ON fc.id  = fs.campaign_id
           JOIN followup_companies fco ON fco.id = fc.company_id
          WHERE fs.id = $1`,
        [scheduleId]
      );

      if (infoRows.length && infoRows[0].webhook_url) {
        const info = infoRows[0];
        fetch(info.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lead_name:     info.lead_name,
            phone:         info.phone,
            origin:        info.origin,
            campaign_name: info.campaign_name,
            company_name:  info.company_name,
          }),
        }).catch((e) => console.error("[followup-queue/convert] webhook error:", e.message));
      }

      return res.json({ success: true, id: scheduleId });
    } catch (err) {
      sendError(res, 500, "CONVERT_FAILED", err instanceof Error ? err.message : "Failed to convert schedule");
    }
  });






  // ─── Módulo de Follow-up (BullMQ + campanhas independentes) ───────────────
  registerFollowupRoutes(app, requireFirebaseAuth, requireInternalPageAccess, requireAdminAccess);
  registerJourneysRoutes(app, requireFirebaseAuth, requireInternalPageAccess, requireAdminAccess);
  registerGeracaoDigitalRoutes(app, pgDatabasePool, requireFirebaseAuth, requireInternalPageAccess);

  // ─── Módulo de Onboarding (criação transacional de empresa + campanha + templates) ───
  registerOnboardingRoutes(app, requireFirebaseAuth, requireInternalAccess);

  // ─── Módulo de Eventos ───
  app.use("/api/eventos", registerEventosRoutes(routeDeps));
}
