// Rotas do módulo de follow-up — adicionadas ao Express existente.
// Importar e chamar registerFollowupRoutes(app) no final de registerAllDomainRoutes.js
import { Router } from "express";
import crypto from "crypto";
import { getSupabase, query } from "./db.js";
import {
  generateSecret,
  generateWebhookUrl,
  verifyHmac,
  parseWebhookPayload,
  processInboundWebhook,
  cancelPendingJobsForCampaign,
} from "./service.js";
import { getAnalytics } from "./analyticsService.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sendErr(res, status, code, message) {
  console.error(`[followup/routes][${code}]`, message);
  return res.status(status).json({ success: false, error: { code, message } });
}

function str(v) {
  return typeof v === "string" ? v.trim() || null : null;
}

// ─── Auth helper — reutiliza requireFirebaseAuth injetado via closure ────────

/**
 * @param {import("express").Application} app
 * @param {Function} requireFirebaseAuth — middleware já existente no server.js
 */
export function registerFollowupRoutes(app, requireFirebaseAuth) {
  const router = Router();

  // ══════════════════════════════════════════════════════════════════════════
  // WEBHOOKS PÚBLICOS (sem auth Firebase)
  // ══════════════════════════════════════════════════════════════════════════

  // POST /webhooks/followup/:campaignId — Calendly ou genérico
  app.post("/webhooks/followup/:campaignId", async (req, res) => {
    const campaignId = str(req.params.campaignId);
    if (!campaignId) return sendErr(res, 400, "MISSING_CAMPAIGN_ID", "campaignId inválido");

    try {
      const supabase = getSupabase();
      const { data: campaign } = await supabase
        .from("followup_campaigns")
        .select("id, webhook_secret, status")
        .eq("id", campaignId)
        .maybeSingle();

      if (!campaign) return res.status(200).json({ ok: true });

      // Validar HMAC se secret configurado
      if (campaign.webhook_secret) {
        const sig = req.headers["x-hub-signature-256"] || req.headers["x-signature-256"] || "";
        const rawBody = JSON.stringify(req.body);
        if (!verifyHmac(campaign.webhook_secret, rawBody, String(sig))) {
          return sendErr(res, 401, "INVALID_SIGNATURE", "Assinatura HMAC inválida");
        }
      }

      const parsed = parseWebhookPayload(req.body);
      const result = await processInboundWebhook(campaignId, parsed);

      return res.json({ success: true, ...result });
    } catch (err) {
      console.error("[followup/webhook-in]", err.message);
      return res.status(200).json({ ok: true });
    }
  });

  // POST /webhooks/whatsapp/:companyId — resposta do lead (UNIDIRECIONAL)
  app.post("/webhooks/whatsapp/:companyId", async (req, res) => {
    const companyId = str(req.params.companyId);

    try {
      const supabase = getSupabase();
      const { data: company } = await supabase
        .from("followup_companies")
        .select("id, webhook_url")
        .eq("id", companyId || "")
        .maybeSingle();

      const body = req.body || {};
      const phone =
        str(body.data?.key?.remoteJid?.split("@")[0]) ||
        str(body.phone) ||
        null;

      // Identificar campanha pelo telefone
      let campaign_id = null;
      if (phone) {
        const { rows } = await query(
          `SELECT campaign_id FROM followup_schedules
            WHERE company_id = $1 AND phone LIKE $2 LIMIT 1`,
          [companyId, `%${phone.replace(/\D/g, "").slice(-8)}`]
        );
        campaign_id = rows[0]?.campaign_id || null;
      }

      await query(
        `INSERT INTO followup_replies (company_id, campaign_id, phone, payload)
         VALUES ($1,$2,$3,$4)`,
        [companyId, campaign_id, phone, JSON.stringify(body)]
      );

      // Repassar ao CRM interno se configurado
      if (company?.webhook_url) {
        fetch(company.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
      }

      return res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[followup/webhook-reply]", err.message);
      return res.status(200).json({ ok: true });
    }
  });

  // ══════════════════════════════════════════════════════════════════════════
  // APIs AUTENTICADAS
  // ══════════════════════════════════════════════════════════════════════════

  // ── Empresas ──────────────────────────────────────────────────────────────

  // GET /api/followup/companies
  router.get("/companies", requireFirebaseAuth, async (req, res) => {
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("followup_companies")
        .select("id, name, evolution_instance, webhook_url, panel_access, created_at")
        .order("name", { ascending: true });
      if (error) throw error;

      // Enriquecer com contagem de campanhas ativas
      const ids = (data || []).map((c) => c.id);
      let countMap = {};
      if (ids.length) {
        const { rows } = await query(
          `SELECT company_id, COUNT(*) FILTER (WHERE status='active')::int AS active_campaigns
             FROM followup_campaigns WHERE company_id = ANY($1::uuid[])
            GROUP BY company_id`,
          [ids]
        );
        for (const r of rows) countMap[r.company_id] = r.active_campaigns;
      }

      return res.json({
        success: true,
        companies: (data || []).map((c) => ({
          ...c,
          activeCampaigns: countMap[c.id] || 0,
        })),
      });
    } catch (err) {
      return sendErr(res, 500, "COMPANIES_FETCH_FAILED", err.message);
    }
  });

  // POST /api/followup/companies
  router.post("/companies", requireFirebaseAuth, async (req, res) => {
    const { name, evolution_instance, webhook_url, calendly_webhook_secret, panel_access } =
      req.body || {};
    if (!str(name) || !str(evolution_instance)) {
      return sendErr(res, 400, "MISSING_FIELDS", "name e evolution_instance são obrigatórios");
    }
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("followup_companies")
        .insert({
          name: str(name),
          evolution_instance: str(evolution_instance),
          webhook_url: str(webhook_url),
          calendly_webhook_secret: str(calendly_webhook_secret),
          panel_access: Boolean(panel_access),
        })
        .select()
        .maybeSingle();
      if (error) throw error;
      return res.status(201).json({ success: true, company: data });
    } catch (err) {
      return sendErr(res, 500, "COMPANY_CREATE_FAILED", err.message);
    }
  });

  // PATCH /api/followup/companies/:id
  router.patch("/companies/:id", requireFirebaseAuth, async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "MISSING_ID", "id inválido");
    const { name, evolution_instance, webhook_url, calendly_webhook_secret, panel_access } =
      req.body || {};
    try {
      const patch = { updated_at: new Date().toISOString() };
      if (str(name)) patch.name = str(name);
      if (str(evolution_instance)) patch.evolution_instance = str(evolution_instance);
      if ("webhook_url" in req.body) patch.webhook_url = str(webhook_url);
      if ("calendly_webhook_secret" in req.body)
        patch.calendly_webhook_secret = str(calendly_webhook_secret);
      if ("panel_access" in req.body) patch.panel_access = Boolean(panel_access);

      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("followup_companies")
        .update(patch)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) return sendErr(res, 404, "NOT_FOUND", "Empresa não encontrada");
      return res.json({ success: true, company: data });
    } catch (err) {
      return sendErr(res, 500, "COMPANY_UPDATE_FAILED", err.message);
    }
  });

  // ── Campanhas ─────────────────────────────────────────────────────────────

  // GET /api/followup/campaigns?companyId=
  router.get("/campaigns", requireFirebaseAuth, async (req, res) => {
    const companyId = str(req.query.companyId);
    if (!companyId) return sendErr(res, 400, "MISSING_COMPANY_ID", "companyId é obrigatório");
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("followup_campaigns")
        .select("id, company_id, name, description, status, default_origin, webhook_trigger_url, webhook_secret, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      if (error) throw error;

      // Enriquecer com métricas
      const ids = (data || []).map((c) => c.id);
      let metricsMap = {};
      if (ids.length) {
        const { rows } = await query(
          `SELECT
             fs.campaign_id,
             COUNT(DISTINCT fs.id)::int              AS total_leads,
             COUNT(DISTINCT fj.id)
               FILTER (WHERE fj.status='sent')::int  AS messages_sent
           FROM followup_schedules fs
           LEFT JOIN followup_jobs fj ON fj.schedule_id = fs.id
           WHERE fs.campaign_id = ANY($1::uuid[])
           GROUP BY fs.campaign_id`,
          [ids]
        );
        for (const r of rows)
          metricsMap[r.campaign_id] = {
            totalLeads: r.total_leads,
            messagesSent: r.messages_sent,
          };
      }

      return res.json({
        success: true,
        campaigns: (data || []).map((c) => ({
          ...c,
          totalLeads: metricsMap[c.id]?.totalLeads || 0,
          messagesSent: metricsMap[c.id]?.messagesSent || 0,
        })),
      });
    } catch (err) {
      return sendErr(res, 500, "CAMPAIGNS_FETCH_FAILED", err.message);
    }
  });

  // POST /api/followup/campaigns
  router.post("/campaigns", requireFirebaseAuth, async (req, res) => {
    const { company_id, name, description, default_origin } = req.body || {};
    if (!str(company_id) || !str(name)) {
      return sendErr(res, 400, "MISSING_FIELDS", "company_id e name são obrigatórios");
    }
    try {
      const secret = generateSecret();
      const supabase = getSupabase();

      // Inserir sem webhook_trigger_url primeiro para obter o id
      const { data, error } = await supabase
        .from("followup_campaigns")
        .insert({
          company_id: str(company_id),
          name: str(name),
          description: str(description),
          default_origin: str(default_origin),
          status: "draft",
          webhook_secret: secret,
        })
        .select()
        .maybeSingle();
      if (error) throw error;

      // Atualizar com URL gerada
      const url = generateWebhookUrl(data.id);
      const { data: updated } = await supabase
        .from("followup_campaigns")
        .update({ webhook_trigger_url: url })
        .eq("id", data.id)
        .select()
        .maybeSingle();

      return res.status(201).json({ success: true, campaign: updated || data });
    } catch (err) {
      return sendErr(res, 500, "CAMPAIGN_CREATE_FAILED", err.message);
    }
  });

  // PATCH /api/followup/campaigns/:id
  router.patch("/campaigns/:id", requireFirebaseAuth, async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "MISSING_ID", "id inválido");

    const { name, description, status, default_origin, regenerate_secret } = req.body || {};

    const validStatuses = ["draft", "active", "paused", "archived"];
    if (status && !validStatuses.includes(status)) {
      return sendErr(res, 400, "INVALID_STATUS", `status deve ser: ${validStatuses.join(", ")}`);
    }

    try {
      const patch = { updated_at: new Date().toISOString() };
      if (str(name)) patch.name = str(name);
      if ("description" in req.body) patch.description = str(description);
      if (status) patch.status = status;
      if ("default_origin" in req.body) patch.default_origin = str(default_origin);
      if (regenerate_secret) patch.webhook_secret = generateSecret();

      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("followup_campaigns")
        .update(patch)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) return sendErr(res, 404, "NOT_FOUND", "Campanha não encontrada");

      // Cancelar jobs pendentes ao arquivar
      if (status === "archived") {
        await cancelPendingJobsForCampaign(id);
      }

      return res.json({ success: true, campaign: data });
    } catch (err) {
      return sendErr(res, 500, "CAMPAIGN_UPDATE_FAILED", err.message);
    }
  });

  // DELETE /api/followup/campaigns/:id (só draft ou archived)
  router.delete("/campaigns/:id", requireFirebaseAuth, async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "MISSING_ID", "id inválido");
    try {
      const supabase = getSupabase();
      const { data: camp } = await supabase
        .from("followup_campaigns")
        .select("id, status")
        .eq("id", id)
        .maybeSingle();
      if (!camp) return sendErr(res, 404, "NOT_FOUND", "Campanha não encontrada");
      if (!["draft", "archived"].includes(camp.status)) {
        return sendErr(res, 400, "INVALID_STATE", "Só é possível excluir campanhas em rascunho ou arquivadas");
      }
      const { error } = await supabase.from("followup_campaigns").delete().eq("id", id);
      if (error) throw error;
      return res.json({ success: true });
    } catch (err) {
      return sendErr(res, 500, "CAMPAIGN_DELETE_FAILED", err.message);
    }
  });

  // ── Templates ─────────────────────────────────────────────────────────────

  // GET /api/followup/templates?campaignId=
  router.get("/templates", requireFirebaseAuth, async (req, res) => {
    const campaignId = str(req.query.campaignId);
    if (!campaignId) return sendErr(res, 400, "MISSING_CAMPAIGN_ID", "campaignId é obrigatório");
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("followup_templates")
        .select("id, campaign_id, name, message, trigger_type, trigger_value, trigger_unit, trigger_direction, is_active, order_index, created_at")
        .eq("campaign_id", campaignId)
        .order("order_index", { ascending: true });
      if (error) throw error;
      return res.json({ success: true, templates: data || [] });
    } catch (err) {
      return sendErr(res, 500, "TEMPLATES_FETCH_FAILED", err.message);
    }
  });

  // POST /api/followup/templates
  router.post("/templates", requireFirebaseAuth, async (req, res) => {
    const {
      campaign_id, name, message,
      trigger_type, trigger_value, trigger_unit, trigger_direction,
      is_active, order_index,
    } = req.body || {};
    if (!str(campaign_id) || !str(name) || !str(message) || !str(trigger_type)) {
      return sendErr(res, 400, "MISSING_FIELDS", "Campos obrigatórios faltando");
    }
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("followup_templates")
        .insert({
          campaign_id: str(campaign_id),
          name: str(name),
          message: str(message),
          trigger_type: str(trigger_type),
          trigger_value: Number(trigger_value) || 0,
          trigger_unit: str(trigger_unit) || "hours",
          trigger_direction: str(trigger_direction),
          is_active: is_active !== false,
          order_index: Number(order_index) || 0,
        })
        .select()
        .maybeSingle();
      if (error) throw error;
      return res.status(201).json({ success: true, template: data });
    } catch (err) {
      return sendErr(res, 500, "TEMPLATE_CREATE_FAILED", err.message);
    }
  });

  // PATCH /api/followup/templates/reorder — DEVE vir ANTES de /templates/:id
  // para que "reorder" não seja capturado como :id pelo Express
  router.patch("/templates/reorder", requireFirebaseAuth, async (req, res) => {
    const { items } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      return sendErr(res, 400, "MISSING_ITEMS", "items[] é obrigatório");
    }
    try {
      await Promise.all(
        items.map(({ id, order_index }) =>
          query("UPDATE followup_templates SET order_index=$1 WHERE id=$2", [
            Number(order_index),
            str(id),
          ])
        )
      );
      return res.json({ success: true });
    } catch (err) {
      return sendErr(res, 500, "REORDER_FAILED", err.message);
    }
  });

  // PATCH /api/followup/templates/:id — DEPOIS de /templates/reorder
  router.patch("/templates/:id", requireFirebaseAuth, async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "MISSING_ID", "id inválido");
    try {
      const allowed = ["name", "message", "trigger_type", "trigger_value", "trigger_unit", "trigger_direction", "is_active", "order_index"];
      const patch = { updated_at: new Date().toISOString() };
      for (const k of allowed) {
        if (k in (req.body || {})) {
          patch[k] = req.body[k] === null ? null : req.body[k];
        }
      }
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("followup_templates")
        .update(patch)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) return sendErr(res, 404, "NOT_FOUND", "Template não encontrado");
      return res.json({ success: true, template: data });
    } catch (err) {
      return sendErr(res, 500, "TEMPLATE_UPDATE_FAILED", err.message);
    }
  });

  // DELETE /api/followup/templates/:id
  router.delete("/templates/:id", requireFirebaseAuth, async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "MISSING_ID", "id inválido");
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from("followup_templates").delete().eq("id", id);
      if (error) throw error;
      return res.json({ success: true });
    } catch (err) {
      return sendErr(res, 500, "TEMPLATE_DELETE_FAILED", err.message);
    }
  });

  // ── Fila de schedules (leitura) ───────────────────────────────────────────

  // GET /api/followup/schedules?companyId=&campaignId=&status=&from=&to=&page=&limit=
  router.get("/schedules", requireFirebaseAuth, async (req, res) => {
    const companyId = str(req.query.companyId);
    const campaignId = str(req.query.campaignId);
    const status = str(req.query.status);
    const from = str(req.query.from);
    const to = str(req.query.to);
    const page = Math.max(1, parseInt(req.query.page || "1") || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || "50") || 50));

    try {
      const conds = [];
      const params = [];
      if (companyId) { params.push(companyId); conds.push(`company_id=$${params.length}::uuid`); }
      if (campaignId) { params.push(campaignId); conds.push(`campaign_id=$${params.length}::uuid`); }
      if (status) { params.push(status); conds.push(`status=$${params.length}`); }
      if (from) { params.push(from); conds.push(`created_at>=$${params.length}::timestamptz`); }
      if (to) {
        params.push(to);
        conds.push(`created_at<=($${params.length}::timestamptz+interval '1 day')`);
      }

      const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
      const offset = (page - 1) * limit;

      const { rows } = await query(
        `SELECT *, COUNT(*) OVER() AS total_count
           FROM followup_schedules
          ${where}
          ORDER BY created_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      );

      const total = rows[0] ? Number(rows[0].total_count) : 0;
      return res.json({
        success: true,
        items: rows.map(({ total_count, ...r }) => r),
        total,
      });
    } catch (err) {
      return sendErr(res, 500, "SCHEDULES_FETCH_FAILED", err.message);
    }
  });

  // ── Analytics ─────────────────────────────────────────────────────────────

  // GET /api/followup/analytics?companyId=&campaignId=&from=&to=
  router.get("/analytics", requireFirebaseAuth, async (req, res) => {
    try {
      const filters = {
        companyId: str(req.query.companyId),
        campaignId: str(req.query.campaignId),
        from: str(req.query.from),
        to: str(req.query.to),
      };
      const data = await getAnalytics(filters);
      return res.json({ success: true, ...data });
    } catch (err) {
      return sendErr(res, 500, "ANALYTICS_FAILED", err.message);
    }
  });

  // Montar router em /api/followup
  app.use("/api/followup", router);
}
