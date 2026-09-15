// backend/src/followup/queueRoutes.js
// Rotas do painel de moderação da fila de follow-up (/api/followup-queue).
// Extraídas de registerAllDomainRoutes.js — movimento puro, handlers idênticos.

import { query as fupQuery } from "./db.js";
import { getFollowupQueue } from "./queue.js";
import { adjustDateToSendWindow, resolveSendWindowConfig } from "../services/sendWindow.js";
import { getLeadClientN8nSettings } from "../services/n8nSettings.js";

// Guarda de escopo por tenant, reusada por toda rota que expõe dados
// agregados por tenant (fila de moderação e, na Etapa 5 Commit 3, a faixa
// dos próximos 7 dias e o calendário em routes.js). Não depende de `deps` —
// só lê req.authAccess — por isso vive no escopo do módulo e é exportada,
// em vez de presa dentro de registerFollowupQueueRoutes. Uma chave só: nunca
// aceite tenantId vindo do payload da requisição, sempre resolvido a partir
// da linha (campaign/schedule/job → company → tenant_id).
export function hasTenantAccess(req, tenantId) {
  const access = req.authAccess;
  const isUnrestricted =
    access?.role === "superadmin" ||
    access?.isAdmin ||
    access?.scopeMode === "all_clients";
  if (isUnrestricted) return true;

  const clientIds = Array.isArray(access?.clientIds)
    ? access.clientIds
    : access?.clientId
    ? [access.clientId]
    : [];
  return Boolean(tenantId && clientIds.includes(tenantId));
}

export function registerFollowupQueueRoutes(app, deps) {
  const { normalizeString, requireFirebaseAuth, sendError, supabase } = deps;

  // GET /api/followup-queue — lê followup_schedules + joins + status derivado
  app.get("/api/followup-queue", requireFirebaseAuth, async (req, res) => {
    const tenantId = normalizeString(req.query?.tenantId || req.query?.clientId) || null;
    const companyId = normalizeString(req.query?.companyId) || null;
    const campaignId = normalizeString(req.query?.campaignId) || null;
    const status = normalizeString(req.query?.status) || null;
    const dateFrom = normalizeString(req.query?.dateFrom) || null;
    const dateTo = normalizeString(req.query?.dateTo) || null;
    const rawPage = Number.parseInt(String(req.query?.page ?? "1"), 10);
    const page = Number.isNaN(rawPage) || rawPage < 1 ? 1 : rawPage;
    const rawLimit = Number.parseInt(String(req.query?.limit ?? "50"), 10);
    const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 200);

    const validStatuses = ["active", "awaiting_reply", "replied", "failed", "cancelled", "completed", "converted"];
    if (status && !validStatuses.includes(status)) {
      return sendError(res, 400, "INVALID_QUERY", `status must be one of: ${validStatuses.join(", ")}`);
    }

    try {
      const params = [];
      const filters = [];
      let idx = 1;
      if (tenantId)   { params.push(tenantId);   filters.push(`fco.tenant_id = $${idx++}`); }
      if (companyId)  { params.push(companyId);  filters.push(`fco.id = $${idx++}`); }
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
            fs.status     AS raw_status,
            COALESCE(fc.name, 'Avulso') AS campaign_name,
            fs.company_id,
            fco.name      AS company_name,
            fco.tenant_id,
            COALESCE((
              SELECT COUNT(ft.id)
                FROM followup_templates ft
               WHERE ft.campaign_id = fs.campaign_id AND ft.is_active = true
            ), 1) AS total_steps,
            COUNT(fj.id) FILTER (WHERE fj.status = 'sent')    AS jobs_sent,
            COUNT(fj.id) FILTER (WHERE fj.status = 'failed')  AS jobs_failed,
            COUNT(fj.id) FILTER (WHERE fj.status = 'pending') AS jobs_pending,
            MAX(fj.sent_at)                                    AS last_sent_at,
            MIN(fj.scheduled_for) FILTER (WHERE fj.status = 'pending') AS next_scheduled_for,
            (
              SELECT fj_next.id
                FROM followup_jobs fj_next
               WHERE fj_next.schedule_id = fs.id AND fj_next.status = 'pending'
               ORDER BY fj_next.scheduled_for ASC
               LIMIT 1
            ) AS next_job_id,
            (
              SELECT fj_msg.custom_message
                FROM followup_jobs fj_msg
               WHERE fj_msg.schedule_id = fs.id
               ORDER BY fj_msg.created_at DESC
               LIMIT 1
            ) AS custom_message,
            (
              SELECT fj_err.error_log
                FROM followup_jobs fj_err
               WHERE fj_err.schedule_id = fs.id AND fj_err.status = 'failed'
               ORDER BY fj_err.created_at DESC
               LIMIT 1
            ) AS last_error_log,
            CASE
              WHEN fs.status = 'cancelled' THEN 'cancelled'
              WHEN fs.status = 'converted' THEN 'converted'
              WHEN fs.status = 'missing_phone' THEN 'missing_phone'
              WHEN EXISTS (
                SELECT 1 FROM followup_replies r
                WHERE r.company_id = fs.company_id AND r.phone = fs.phone
              ) THEN 'replied'
              WHEN COUNT(fj.id) FILTER (WHERE fj.status = 'failed') > 0
               AND COUNT(fj.id) FILTER (WHERE fj.status = 'pending') = 0 THEN 'failed'
              WHEN COUNT(fj.id) FILTER (WHERE fj.status = 'sent') > 0
               AND COUNT(fj.id) FILTER (WHERE fj.status = 'pending') = 0 THEN 'completed'
              ELSE 'active'
            END AS derived_status
          FROM followup_schedules fs
          LEFT JOIN followup_campaigns fc  ON fc.id  = fs.campaign_id
          JOIN followup_companies fco ON fco.id = fs.company_id
          LEFT JOIN followup_jobs fj  ON fj.schedule_id = fs.id
          ${baseWhere}
          GROUP BY fs.id, fc.id, fco.id, fc.name, fco.name, fco.tenant_id
        )
        SELECT *, COUNT(*) OVER() AS total_count
        FROM base
        ${statusWhere}
        ORDER BY created_at DESC
        LIMIT $${limitIdx} OFFSET $${offsetIdx}
      `;

      const { rows } = await fupQuery(sql, params);
      let total = rows.length > 0 ? Number(rows[0].total_count) : 0;

      const items = rows.map((r) => {
        const jobsSent = Number(r.jobs_sent) || 0;
        const jobsFailed = Number(r.jobs_failed) || 0;
        const jobsPending = Number(r.jobs_pending) || 0;
        const totalSteps = Number(r.total_steps) || 1;
        const currentStep = Math.min(totalSteps, jobsSent + (jobsPending > 0 || jobsFailed > 0 ? 1 : 0));

        return {
          id:              r.id,
          nextJobId:       r.next_job_id || null,
          leadName:        r.lead_name,
          phone:           r.phone,
          origin:          r.origin,
          companyId:       r.company_id,
          companyName:     r.company_name,
          tenantId:        r.tenant_id,
          campaignId:      r.campaign_id,
          campaignName:    r.campaign_name,
          customMessage:   r.custom_message || null,
          status:          r.derived_status,
          rawStatus:       r.raw_status,
          jobsSent,
          jobsFailed,
          jobsPending,
          totalSteps,
          currentStep:     currentStep || 1,
          lastSentAt:      r.last_sent_at || null,
          nextScheduledFor: r.next_scheduled_for || null,
          lastErrorLog:    r.last_error_log || null,
          meetingDatetime: r.meeting_datetime || null,
          createdAt:       r.created_at,
        };
      });

      if (!companyId && !tenantId) {
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

  async function ensureScheduleTenantAccess(req, res, scheduleId) {
    const { rows } = await fupQuery(
      `SELECT fs.id, fs.campaign_id, fco.tenant_id
         FROM followup_schedules fs
         JOIN followup_companies fco ON fco.id = fs.company_id
        WHERE fs.id = $1`,
      [scheduleId]
    );
    if (!rows.length) {
      sendError(res, 404, "NOT_FOUND", "Schedule not found");
      return null;
    }
    const tenantId = rows[0].tenant_id;
    if (hasTenantAccess(req, tenantId)) {
      return rows[0];
    }
    sendError(res, 404, "NOT_FOUND", "Schedule not found");
    return null;
  }

  // PATCH /api/followup-queue/:scheduleId/reschedule — cria novo job BullMQ com delay e cancela anterior
  app.patch("/api/followup-queue/:scheduleId/reschedule", requireFirebaseAuth, async (req, res) => {
    const scheduleId = normalizeString(req.params?.scheduleId);
    if (!scheduleId) return sendError(res, 400, "INVALID_PARAM", "Missing scheduleId");

    const scheduleRecord = await ensureScheduleTenantAccess(req, res, scheduleId);
    if (!scheduleRecord) return;

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const rawScheduledFor = body.scheduledFor ? new Date(body.scheduledFor) : null;
    let targetDate;
    let delayMs;

    if (rawScheduledFor && !isNaN(rawScheduledFor.getTime())) {
      targetDate = rawScheduledFor;
      delayMs = Math.max(0, targetDate.getTime() - Date.now());
    } else {
      const delayMinutes = Number(body.delayMinutes);
      if (!Number.isFinite(delayMinutes) || delayMinutes < 0) {
        return sendError(res, 400, "INVALID_BODY", "Must provide a valid scheduledFor or non-negative delayMinutes");
      }
      delayMs = Math.max(0, Math.round(delayMinutes * 60 * 1000));
      targetDate = new Date(Date.now() + delayMs);
    }

    const templateId = normalizeString(body.templateId) || null;

    try {
      const { campaign_id, tenant_id } = scheduleRecord;
      const tenantSettings = await getLeadClientN8nSettings(tenant_id || "geracao-digital");
      const sendWindowConfig = resolveSendWindowConfig(tenantSettings);
      const effectiveDate = adjustDateToSendWindow(targetDate, sendWindowConfig);
      delayMs = Math.max(0, effectiveDate.getTime() - Date.now());

      let resolvedTemplateId = templateId;
      let customMessageToUse = null;

      if (typeof body.customMessage === "string" && body.customMessage.trim().length > 0) {
        customMessageToUse = body.customMessage.trim();
      } else if (!campaign_id) {
        // Lembrete avulso sem mensagem nova no body: resgata a do último job
        const { rows: lastJobRows } = await fupQuery(
          `SELECT custom_message FROM followup_jobs WHERE schedule_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [scheduleId]
        );
        customMessageToUse = lastJobRows[0]?.custom_message || null;
      } else if (!resolvedTemplateId) {
        const { rows: tplRows } = await fupQuery(
          `SELECT id FROM followup_templates WHERE campaign_id = $1 AND is_active = true ORDER BY order_index ASC LIMIT 1`,
          [campaign_id]
        );
        if (!tplRows.length) return sendError(res, 400, "NO_TEMPLATE", "No active template found for this campaign");
        resolvedTemplateId = tplRows[0].id;
      }

      // Cancela jobs pendentes anteriores no banco para garantir que o worker ignore qualquer tentativa antiga
      await fupQuery(
        `UPDATE followup_jobs SET status = 'cancelled' WHERE schedule_id = $1 AND status = 'pending'`,
        [scheduleId]
      );

      await fupQuery(
        `UPDATE followup_schedules SET status = 'active' WHERE id = $1`,
        [scheduleId]
      );

      const { rows: jobRows } = await fupQuery(
        `INSERT INTO followup_jobs (schedule_id, template_id, custom_message, status, scheduled_for) VALUES ($1, $2, $3, 'pending', $4) RETURNING id`,
        [scheduleId, resolvedTemplateId || null, customMessageToUse, effectiveDate]
      );
      const newJobId = jobRows[0].id;

      const newBullJob = await getFollowupQueue().add(
        "send-followup",
        { jobId: newJobId, customMessage: customMessageToUse },
        { delay: delayMs, jobId: `fup-reschedule-${newJobId}-${Date.now()}` }
      );
      await fupQuery("UPDATE followup_jobs SET bull_job_id = $1 WHERE id = $2", [
        newBullJob.id,
        newJobId,
      ]);

      return res.json({ success: true, jobId: newJobId, delayMs, scheduledFor: effectiveDate.toISOString() });
    } catch (err) {
      sendError(res, 500, "RESCHEDULE_FAILED", err instanceof Error ? err.message : "Failed to reschedule");
    }
  });

  // PATCH /api/followup-queue/:scheduleId/discard — cancela schedule e jobs pendentes (mantém histórico)
  app.patch("/api/followup-queue/:scheduleId/discard", requireFirebaseAuth, async (req, res) => {
    const scheduleId = normalizeString(req.params?.scheduleId);
    if (!scheduleId) return sendError(res, 400, "INVALID_PARAM", "Missing scheduleId");

    const scheduleRecord = await ensureScheduleTenantAccess(req, res, scheduleId);
    if (!scheduleRecord) return;

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

  // DELETE /api/followup-queue/:scheduleId — exclusão permanente SOMENTE para itens nunca enviados (0 enviados)
  app.delete("/api/followup-queue/:scheduleId", requireFirebaseAuth, async (req, res) => {
    const scheduleId = normalizeString(req.params?.scheduleId);
    if (!scheduleId) return sendError(res, 400, "INVALID_PARAM", "Missing scheduleId");

    const scheduleRecord = await ensureScheduleTenantAccess(req, res, scheduleId);
    if (!scheduleRecord) return;

    try {
      const { rows: schedRows } = await fupQuery(
        `SELECT fs.id,
                COUNT(fj.id) FILTER (WHERE fj.status = 'sent') AS sent_count
           FROM followup_schedules fs
           LEFT JOIN followup_jobs fj ON fj.schedule_id = fs.id
          WHERE fs.id = $1
          GROUP BY fs.id`,
        [scheduleId]
      );
      if (!schedRows.length) return sendError(res, 404, "NOT_FOUND", "Schedule not found");

      const sentCount = Number(schedRows[0].sent_count) || 0;
      if (sentCount > 0) {
        return sendError(
          res,
          400,
          "CANNOT_DELETE_SENT_SCHEDULE",
          "Agendamentos que já enviaram mensagens não podem ser excluídos permanentemente, apenas cancelados."
        );
      }

      await fupQuery(`DELETE FROM followup_jobs WHERE schedule_id = $1`, [scheduleId]);
      await fupQuery(`DELETE FROM followup_schedules WHERE id = $1`, [scheduleId]);

      return res.json({ success: true, deletedId: scheduleId });
    } catch (err) {
      sendError(res, 500, "DELETE_FAILED", err instanceof Error ? err.message : "Failed to delete schedule");
    }
  });

  // POST /api/followup-queue/:scheduleId/convert — converte para inbound e dispara webhook
  app.post("/api/followup-queue/:scheduleId/convert", requireFirebaseAuth, async (req, res) => {
    const scheduleId = normalizeString(req.params?.scheduleId);
    if (!scheduleId) return sendError(res, 400, "INVALID_PARAM", "Missing scheduleId");

    const scheduleRecord = await ensureScheduleTenantAccess(req, res, scheduleId);
    if (!scheduleRecord) return;

    try {
      const { rows } = await fupQuery(
        `UPDATE followup_schedules SET status = 'converted' WHERE id = $1 RETURNING id`,
        [scheduleId]
      );
      if (!rows.length) return sendError(res, 404, "NOT_FOUND", "Schedule not found");

      const { rows: infoRows } = await fupQuery(
        `SELECT fs.lead_name, fs.phone, fs.origin,
                COALESCE(fc.name, 'Avulso') AS campaign_name,
                fco.name AS company_name, fco.webhook_url
           FROM followup_schedules fs
           LEFT JOIN followup_campaigns fc  ON fc.id  = fs.campaign_id
           JOIN followup_companies fco ON fco.id = fs.company_id
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

  // PATCH /api/followup-queue/jobs/:jobId/cancel — cancela apenas um passo específico mantendo o restante da cadência ativo
  app.patch("/api/followup-queue/jobs/:jobId/cancel", requireFirebaseAuth, async (req, res) => {
    const jobId = normalizeString(req.params?.jobId);
    if (!jobId) return sendError(res, 400, "INVALID_PARAM", "Missing jobId");

    try {
      const { rows: jobRows } = await fupQuery(
        `SELECT fj.id, fj.schedule_id, fj.bull_job_id, fj.status,
                fs.campaign_id, fs.company_id, fco.tenant_id
           FROM followup_jobs fj
           JOIN followup_schedules fs ON fs.id = fj.schedule_id
           JOIN followup_companies fco ON fco.id = fs.company_id
          WHERE fj.id = $1`,
        [jobId]
      );

      if (!jobRows.length || !hasTenantAccess(req, jobRows[0].tenant_id)) {
        return sendError(res, 404, "NOT_FOUND", "Job não encontrado");
      }
      const job = jobRows[0];

      if (job.status !== "pending") {
        return sendError(
          res,
          400,
          "INVALID_STATE",
          `Apenas jobs pendentes podem ser cancelados (status atual: ${job.status})`
        );
      }

      // 1. Atualizar status do job no banco para cancelled (mantém followup_schedules active!)
      await fupQuery(
        `UPDATE followup_jobs SET status = 'cancelled' WHERE id = $1`,
        [jobId]
      );

      // 2. Remover da fila do BullMQ caso ainda esteja na fila
      if (job.bull_job_id) {
        try {
          const bullJob = await getFollowupQueue().getJob(job.bull_job_id);
          if (bullJob) {
            await bullJob.remove();
          }
        } catch (qErr) {
          console.warn("[followup/queueRoutes] Aviso ao remover bull job:", qErr?.message || qErr);
        }
      }

      return res.json({ success: true, jobId, status: "cancelled" });
    } catch (err) {
      sendError(res, 500, "CANCEL_JOB_FAILED", err instanceof Error ? err.message : "Falha ao cancelar passo");
    }
  });
}

