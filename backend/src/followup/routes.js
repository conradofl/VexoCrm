// Rotas do módulo de follow-up — adicionadas ao Express existente.
// Importar e chamar registerFollowupRoutes(app) no final de registerAllDomainRoutes.js
import express, { Router } from "express";
import crypto from "crypto";
import { getSupabase, query } from "./db.js";
import {
  generateSecret,
  generateWebhookUrl,
  verifyHmac,
  parseWebhookPayload,
  processInboundWebhook,
  enrollLead,
  cancelPendingJobsForCampaign,
  validateTemplatePayload,
  getAnchorFieldsMetadata,
  reschedulePendingJobsForTemplate,
  buildUpcomingDayKeys,
  groupPendingJobsByDay,
  projectLeadsOntoDays,
  dayKeyInTimezone,
} from "./service.js";
import { saveFollowupMediaBuffer, FOLLOWUP_MEDIA_MAX_SIZES } from "../services/storage.js";
import { resolveAuthorizedClientId } from "../services/tenant.js";
import { getAnalytics } from "./analyticsService.js";
import { getFollowupQueue } from "./queue.js";
import { triggerAutomationRun } from "./automationEngine.js";
import { defaultGroqModel } from "../services/llmModels.js";
import { adjustDateToSendWindow, resolveSendWindowConfig, createDateInTimezone } from "../services/sendWindow.js";
import { getLeadClientN8nSettings } from "../services/n8nSettings.js";
import { isFromMe, isGroupJid } from "../services/inboundGuard.js";
import { sanitizePhone } from "../services/leadImport.js";
import { SQL_CANONICAL_PHONE } from "../services/canonicalPhone.js";
import { cancelFollowupCadenceOnReply } from "../services/followupExitGuard.js";
import { hasTenantAccess } from "./queueRoutes.js";
import { resolveEvolutionInstanceForFollowup } from "./worker.js";
import { getLeadClientEvolutionInstances } from "../services/evolution.js";
import { resolveChipDailyLimit } from "../services/chipQuota.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sendErr(res, status, code, message) {
  console.error(`[followup/routes][${code}]`, message);
  return res.status(status).json({ success: false, error: { code, message } });
}

function str(v) {
  return typeof v === "string" ? v.trim() || null : null;
}

// Escopo de tenant do usuário logado. NUNCA confiar no tenantId da query para decidir o
// que mostrar — o filtro é derivado do req.authAccess. Corrige o vazamento de empresas de
// outros tenants aparecendo no seletor.
function isAdminAccess(req) {
  return Boolean(req.authAccess?.isAdmin) || req.authAccess?.role === "superadmin";
}

function authorizedTenantIds(req) {
  const a = req.authAccess || {};
  return Array.from(
    new Set(
      [a.clientId, a.tenantId, ...(a.clientIds || []), ...(a.tenantIds || [])].filter(Boolean)
    )
  );
}

// ─── Auth helper — reutiliza requireFirebaseAuth injetado via closure ────────

/**
 * @param {import("express").Application} app
 * @param {Function} requireFirebaseAuth — middleware já existente no server.js
 */
export function registerFollowupRoutes(app, requireFirebaseAuth, requireInternalPageAccess, requireAdminAccess) {
  const router = Router();
  // requireInternalPageAccess lê req.authAccess, que só existe depois do
  // requireFirebaseAuth — sem ele na frente o guard nega tudo com 403.
  router.use(requireFirebaseAuth, requireInternalPageAccess("planilhas"));

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
      const rawJid = body.data?.key?.remoteJid || body.key?.remoteJid || body.remoteJid || "";

      // Guarda de fromMe: eventos de mensagens enviadas por nós mesmos NUNCA devem ser interpretados
      // como resposta de lead nem cancelar jobs futuros.
      if (isFromMe(body)) {
        console.log(`[followup/webhook-reply][company:${companyId}] Mensagem de saída ignorada (fromMe: true)`);
        return res.status(200).json({ ok: true, ignored: "fromMe" });
      }

      // Guarda de grupo / broadcast: resposta legítima de lead nunca vem de grupo
      if (isGroupJid(rawJid)) {
        console.log(`[followup/webhook-reply][company:${companyId}] Mensagem de grupo/broadcast ignorada`);
        return res.status(200).json({ ok: true, ignored: "group_or_broadcast" });
      }

      const rawPhone =
        str(rawJid.split("@")[0]) ||
        str(body.phone) ||
        null;
      const phone = sanitizePhone(rawPhone) || rawPhone;

      // Identificar campanha pelo telefone usando casamento canônico
      let campaign_id = null;
      if (phone) {
        const { rows } = await query(
          `SELECT campaign_id FROM followup_schedules
            WHERE company_id = $1
              AND ${SQL_CANONICAL_PHONE("phone")} = ${SQL_CANONICAL_PHONE("$2::text")}
            ORDER BY created_at DESC LIMIT 1`,
          [companyId, phone]
        );
        campaign_id = rows[0]?.campaign_id || null;
      }

      // Cancelar cadência em andamento quando o lead responde (exit_on_reply)
      if (phone) {
        await cancelFollowupCadenceOnReply({
          companyId,
          phone,
          queryFn: query,
        }).catch((err) => {
          console.error("[followup/webhook-reply] erro ao cancelar cadência on reply:", err?.message || err);
        });
      }

      // Opt-out detection
      const messageText = str(
        body.data?.message?.conversation ||
        body.data?.message?.extendedTextMessage?.text ||
        ""
      ).toLowerCase().trim();

      if (phone && messageText.match(/^(sair|parar|cancelar|stop)$/i)) {
        await query(
          `INSERT INTO public.lead_optouts (client_id, phone, reason)
           VALUES ($1, $2, $3)
           ON CONFLICT (client_id, phone) DO NOTHING`,
          [companyId, phone, `Opt-out via WhatsApp: ${messageText}`]
        ).catch((err) => {
          console.error("[opt-out insertion error]", err);
        });
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

  // ── Mídia de Follow-up (Upload binário cru, limite 25 MB) ───────────────────

  // POST /api/followup/media/upload
  router.post(
    "/media/upload",
    express.raw({ type: () => true, limit: "25mb" }),
    async (req, res) => {
      try {
        const requestedClientId = req.query.clientId || req.headers["x-client-id"];
        const tenantId = resolveAuthorizedClientId(req, res, requestedClientId);
        if (!tenantId) return;

        let buffer = null;
        if (Buffer.isBuffer(req.body)) {
          buffer = req.body;
        } else if (req.body && typeof req.body === "object" && typeof req.body.base64 === "string") {
          buffer = Buffer.from(req.body.base64, "base64");
        }

        if (!buffer || buffer.length === 0) {
          return sendErr(res, 400, "EMPTY_BUFFER", "Arquivo vazio ou buffer inválido.");
        }

        const rawFileName = req.headers["x-file-name"] || req.headers["x-filename"] || req.query.filename || "anexo";
        let declaredFilename = "anexo";
        try {
          declaredFilename = decodeURIComponent(String(rawFileName)).trim() || "anexo";
        } catch {
          declaredFilename = String(rawFileName).trim() || "anexo";
        }

        const declaredMime = String(
          req.headers["x-mime-type"] || req.headers["content-type"] || req.query.mimeType || ""
        ).trim();

        const saveResult = await saveFollowupMediaBuffer({
          clientId: tenantId,
          buffer,
          declaredFilename,
          declaredMimeType: declaredMime,
        });

        return res.status(201).json({
          success: true,
          media_path: saveResult.storageKey,
          media_type: saveResult.mediaType,
          media_mime: saveResult.mimeType,
          media_filename: saveResult.filename,
          size_bytes: saveResult.sizeBytes,
        });
      } catch (err) {
        const code = err.code || "UPLOAD_FAILED";
        const status =
          code === "INVALID_FILE_TYPE" || code === "FILE_TOO_LARGE" || code === "EMPTY_BUFFER"
            ? 400
            : 500;
        return sendErr(res, status, code, err.message);
      }
    }
  );

  // ── Empresas ──────────────────────────────────────────────────────────────

  // GET /api/followup/companies
  router.get("/companies", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    try {
      const requestedTenantId = str(req.query.tenantId);
      const supabase = getSupabase();

      let sbQuery = supabase
        .from("followup_companies")
        .select("id, name, evolution_instance, evolution_instances, inbound_role, webhook_url, panel_access, inbound_enabled, inbound_model, inbound_prompt, inbound_spin_fields, inbound_webhook_url, sdr_whatsapp_number, sdr_transfer_enabled, created_at, tenant_id, engine_scan_interval_hours, never_contacted_delay_hours, no_reply_delay_hours, livpub_inactive_delay_months, last_engine_run_at")
        .is("archived_at", null)
        .order("name", { ascending: true });

      // Escopo obrigatório por tenant (anti-vazamento): não-admin só enxerga as empresas
      // dos próprios tenants; admin pode ver tudo ou filtrar pelo tenant pedido.
      if (isAdminAccess(req)) {
        if (requestedTenantId) sbQuery = sbQuery.eq("tenant_id", requestedTenantId);
      } else {
        const tenantIds = authorizedTenantIds(req);
        if (tenantIds.length === 0) {
          return res.json({ success: true, companies: [] });
        }
        sbQuery = sbQuery.in("tenant_id", tenantIds);
      }

      const { data, error } = await sbQuery;
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
// Lista de instancias Evolution de um agente. A coluna antiga (evolution_instance)
// guarda a primeira, para nao quebrar quem le so ela.
function normalizeInstanceList(list, fallback) {
  const arr = Array.isArray(list) ? list : [];
  const clean = arr.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
  const unique = [...new Set(clean)];
  if (unique.length > 0) return unique;
  const single = typeof fallback === "string" ? fallback.trim() : "";
  return single ? [single] : [];
}

  router.post("/companies", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const {
      name,
      evolution_instance,
      evolution_instances,
      inbound_role,
      webhook_url,
      calendly_webhook_secret,
      panel_access,
      inbound_enabled,
      inbound_model,
      inbound_prompt,
      inbound_spin_fields,
      inbound_webhook_url,
      sdr_whatsapp_number,
      sdr_transfer_enabled,
      tenant_id,
      engine_scan_interval_hours,
      never_contacted_delay_hours,
      no_reply_delay_hours,
      livpub_inactive_delay_months,
    } = req.body || {};

    const instanceList = normalizeInstanceList(evolution_instances, evolution_instance);
    if (!str(name) || instanceList.length === 0) {
      return sendErr(res, 400, "MISSING_FIELDS", "name e ao menos um número (evolution_instance) são obrigatórios");
    }
    try {
      const supabase = getSupabase();
      // Empresa de follow-up pertence sempre ao tenant de quem cria. Admin pode informar o
      // tenant; demais usuários ficam presos ao próprio (não dá para criar para outro tenant).
      const boundTenantId = isAdminAccess(req)
        ? str(tenant_id) || authorizedTenantIds(req)[0] || null
        : authorizedTenantIds(req)[0] || null;

      const { data, error } = await supabase
        .from("followup_companies")
        .insert({
          tenant_id: boundTenantId,
          name: str(name),
          evolution_instance: instanceList[0],
          evolution_instances: instanceList,
          inbound_role: inbound_role === "qualificador" ? "qualificador" : "atendimento",
          webhook_url: str(webhook_url),
          calendly_webhook_secret: str(calendly_webhook_secret),
          panel_access: Boolean(panel_access),
          inbound_enabled: Boolean(inbound_enabled),
          inbound_model: str(inbound_model) || defaultGroqModel(),
          inbound_prompt: str(inbound_prompt),
          inbound_spin_fields: Array.isArray(inbound_spin_fields) ? inbound_spin_fields : [],
          inbound_webhook_url: str(inbound_webhook_url),
          sdr_whatsapp_number: str(sdr_whatsapp_number),
          sdr_transfer_enabled: Boolean(sdr_transfer_enabled),
          engine_scan_interval_hours: typeof engine_scan_interval_hours === "number" ? engine_scan_interval_hours : 6,
          never_contacted_delay_hours: typeof never_contacted_delay_hours === "number" ? never_contacted_delay_hours : 2,
          no_reply_delay_hours: typeof no_reply_delay_hours === "number" ? no_reply_delay_hours : 48,
          livpub_inactive_delay_months: typeof livpub_inactive_delay_months === "number" ? livpub_inactive_delay_months : 6,
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
  router.patch("/companies/:id", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "MISSING_ID", "id inválido");
    const {
      name,
      evolution_instance,
      evolution_instances,
      inbound_role,
      webhook_url,
      calendly_webhook_secret,
      panel_access,
      inbound_enabled,
      inbound_model,
      inbound_prompt,
      inbound_spin_fields,
      inbound_webhook_url,
      sdr_whatsapp_number,
      sdr_transfer_enabled,
      livpub_aniversario_prompt,
      livpub_inativo_prompt,
      engine_scan_interval_hours,
      never_contacted_delay_hours,
      no_reply_delay_hours,
      livpub_inactive_delay_months,
    } = req.body || {};

    try {
      const patch = { updated_at: new Date().toISOString() };
      if (str(name)) patch.name = str(name);
      if ("inbound_role" in req.body) {
        patch.inbound_role = inbound_role === "qualificador" ? "qualificador" : "atendimento";
      }
      if ("evolution_instances" in req.body) {
        const lista = normalizeInstanceList(evolution_instances, evolution_instance);
        if (lista.length > 0) {
          patch.evolution_instances = lista;
          patch.evolution_instance = lista[0]; // coluna antiga = primeiro da lista
        }
      } else if (str(evolution_instance)) {
        patch.evolution_instance = str(evolution_instance);
        patch.evolution_instances = [str(evolution_instance)];
      }
      if ("webhook_url" in req.body) patch.webhook_url = str(webhook_url);
      if ("calendly_webhook_secret" in req.body)
        patch.calendly_webhook_secret = str(calendly_webhook_secret);
      if ("panel_access" in req.body) patch.panel_access = Boolean(panel_access);
      if ("inbound_enabled" in req.body) patch.inbound_enabled = Boolean(inbound_enabled);
      if ("inbound_model" in req.body) patch.inbound_model = str(inbound_model);
      if ("inbound_prompt" in req.body) patch.inbound_prompt = str(inbound_prompt);
      if ("inbound_spin_fields" in req.body) patch.inbound_spin_fields = Array.isArray(inbound_spin_fields) ? inbound_spin_fields : [];
      if ("inbound_webhook_url" in req.body) patch.inbound_webhook_url = str(inbound_webhook_url);
      if ("sdr_whatsapp_number" in req.body) patch.sdr_whatsapp_number = str(sdr_whatsapp_number);
      if ("sdr_transfer_enabled" in req.body) patch.sdr_transfer_enabled = Boolean(sdr_transfer_enabled);
      if ("livpub_aniversario_prompt" in req.body) patch.livpub_aniversario_prompt = str(livpub_aniversario_prompt);
      if ("livpub_inativo_prompt" in req.body) patch.livpub_inativo_prompt = str(livpub_inativo_prompt);
      if ("engine_scan_interval_hours" in req.body) patch.engine_scan_interval_hours = Number(engine_scan_interval_hours);
      if ("never_contacted_delay_hours" in req.body) patch.never_contacted_delay_hours = Number(never_contacted_delay_hours);
      if ("no_reply_delay_hours" in req.body) patch.no_reply_delay_hours = Number(no_reply_delay_hours);
      if ("livpub_inactive_delay_months" in req.body) patch.livpub_inactive_delay_months = Number(livpub_inactive_delay_months);

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

  // DELETE /api/followup/companies/:id — soft-delete (archived_at)
  router.delete("/companies/:id", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "MISSING_ID", "id inválido");
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("followup_companies")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", id)
        .is("archived_at", null) // só arquiva se ainda não estiver arquivada
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) return sendErr(res, 404, "NOT_FOUND", "Empresa não encontrada ou já arquivada");
      return res.json({ success: true });
    } catch (err) {
      return sendErr(res, 500, "COMPANY_ARCHIVE_FAILED", err.message);
    }
  });

  // ── Campanhas ─────────────────────────────────────────────────────────────

  // GET /api/followup/campaigns?companyId=
  router.get("/campaigns", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const companyId = str(req.query.companyId);
    if (!companyId) return sendErr(res, 400, "MISSING_COMPANY_ID", "companyId é obrigatório");
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("followup_campaigns")
        .select("id, company_id, name, description, status, default_origin, webhook_trigger_url, webhook_secret, dispatch_jitter_minutes, created_at")
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
  router.post("/campaigns", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const { company_id, name, description, default_origin } = req.body || {};
    if (!str(company_id) || !str(name)) {
      return sendErr(res, 400, "MISSING_FIELDS", "company_id e name são obrigatórios");
    }
    try {
      const secret = generateSecret();
      const supabase = getSupabase();

      // Inserir sem webhook_trigger_url primeiro para obter o id
      const insertPayload = {
        company_id: str(company_id),
        name: str(name),
        description: str(description),
        default_origin: str(default_origin),
        status: "draft",
        webhook_secret: secret,
      };
      if ("exit_on_reply" in req.body) insertPayload.exit_on_reply = Boolean(req.body.exit_on_reply);
      if ("exit_on_won" in req.body) insertPayload.exit_on_won = Boolean(req.body.exit_on_won);
      if ("exit_on_lost" in req.body) insertPayload.exit_on_lost = Boolean(req.body.exit_on_lost);
      if ("exit_on_human_takeover" in req.body) insertPayload.exit_on_human_takeover = Boolean(req.body.exit_on_human_takeover);

      const { data, error } = await supabase
        .from("followup_campaigns")
        .insert(insertPayload)
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
  router.patch("/campaigns/:id", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "MISSING_ID", "id inválido");

    const { name, description, status, default_origin, regenerate_secret, dispatch_jitter_minutes } = req.body || {};

    const validStatuses = ["draft", "active", "paused", "archived"];
    if (status && !validStatuses.includes(status)) {
      return sendErr(res, 400, "INVALID_STATUS", `status deve ser: ${validStatuses.join(", ")}`);
    }
    if ("dispatch_jitter_minutes" in (req.body || {})) {
      const jitter = Number(dispatch_jitter_minutes);
      if (!Number.isFinite(jitter) || jitter < 0 || jitter > 120) {
        return sendErr(res, 400, "INVALID_JITTER", "dispatch_jitter_minutes deve ser um número entre 0 e 120.");
      }
    }

    try {
      const patch = { updated_at: new Date().toISOString() };
      if (str(name)) patch.name = str(name);
      if ("description" in req.body) patch.description = str(description);
      if (status) patch.status = status;
      if ("default_origin" in req.body) patch.default_origin = str(default_origin);
      if (regenerate_secret) patch.webhook_secret = generateSecret();
      if ("dispatch_jitter_minutes" in req.body) patch.dispatch_jitter_minutes = Math.round(Number(dispatch_jitter_minutes));
      if ("exit_on_reply" in req.body) patch.exit_on_reply = Boolean(req.body.exit_on_reply);
      if ("exit_on_won" in req.body) patch.exit_on_won = Boolean(req.body.exit_on_won);
      if ("exit_on_lost" in req.body) patch.exit_on_lost = Boolean(req.body.exit_on_lost);
      if ("exit_on_human_takeover" in req.body) patch.exit_on_human_takeover = Boolean(req.body.exit_on_human_takeover);

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
  router.delete("/campaigns/:id", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
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

  // POST /api/followup/campaigns/:id/clone — duplica a cadência e todos os seus passos
  router.post("/campaigns/:id/clone", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "MISSING_ID", "id da campanha é obrigatório");

    try {
      const supabase = getSupabase();
      const { data: original, error: origErr } = await supabase
        .from("followup_campaigns")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (origErr || !original) {
        return sendErr(res, 404, "NOT_FOUND", "Campanha original não encontrada");
      }

      const cloneName = (req.body?.name && str(req.body.name)) || `${original.name} (Cópia)`;
      const secret = generateSecret();

      const insertCampaign = {
        company_id: original.company_id,
        name: cloneName,
        description: original.description,
        default_origin: original.default_origin,
        status: "draft", // Status draft estrito e válido na constraint
        webhook_secret: secret,
        exit_on_reply: original.exit_on_reply ?? true,
        exit_on_won: original.exit_on_won ?? true,
        exit_on_lost: original.exit_on_lost ?? true,
        exit_on_human_takeover: original.exit_on_human_takeover ?? true,
      };

      const { data: newCampaign, error: createErr } = await supabase
        .from("followup_campaigns")
        .insert(insertCampaign)
        .select()
        .maybeSingle();

      if (createErr) throw createErr;

      // Atualiza com URL de webhook gerada
      const webhookUrl = generateWebhookUrl(newCampaign.id);
      await supabase
        .from("followup_campaigns")
        .update({ webhook_trigger_url: webhookUrl })
        .eq("id", newCampaign.id);

      // Buscar todos os templates da campanha original
      const { data: templates, error: tplErr } = await supabase
        .from("followup_templates")
        .select("*")
        .eq("campaign_id", original.id)
        .order("order_index", { ascending: true });

      if (tplErr) throw tplErr;

      let clonedTemplatesCount = 0;
      if (templates && templates.length > 0) {
        const templatesToInsert = templates.map((tpl) => ({
          campaign_id: newCampaign.id,
          name: tpl.name,
          message: tpl.message,
          trigger_type: tpl.trigger_type,
          trigger_value: tpl.trigger_value,
          trigger_unit: tpl.trigger_unit,
          trigger_direction: tpl.trigger_direction,
          scheduled_time: tpl.scheduled_time,
          scheduled_date: tpl.scheduled_date,
          anchor_field: tpl.anchor_field,
          media_path: tpl.media_path,
          media_type: tpl.media_type,
          media_mime: tpl.media_mime,
          media_filename: tpl.media_filename,
          is_active: tpl.is_active,
          order_index: tpl.order_index,
        }));

        const { error: insTplErr } = await supabase
          .from("followup_templates")
          .insert(templatesToInsert);

        if (insTplErr) throw insTplErr;
        clonedTemplatesCount = templatesToInsert.length;
      }

      return res.status(201).json({
        success: true,
        campaign: { ...newCampaign, webhook_trigger_url: webhookUrl },
        templatesCount: clonedTemplatesCount,
      });
    } catch (err) {
      return sendErr(res, 500, "CLONE_CAMPAIGN_FAILED", err.message);
    }
  });

  // POST /api/followup/campaigns/:id/enroll — enrola leads selecionados (ex.: vindos do
  // Banco de Dados) na cadência, reusando a mesma engine do webhook. Body:
  //   { leads: [{ name, phone, meeting_datetime? }], meeting_datetime?, origin? }
  // meeting_datetime global (a "data-alvo": reunião/evento/pagamento) vale para os leads
  // que não trouxerem a própria; dirige os lembretes "antes/depois" da cadência.
  router.post("/campaigns/:id/enroll", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "MISSING_ID", "id inválido");

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const leads = Array.isArray(body.leads) ? body.leads : [];
    if (leads.length === 0) {
      return sendErr(res, 400, "NO_LEADS", "Envie ao menos um lead para enrolar.");
    }
    const globalMeeting = str(body.meeting_datetime);
    const origin = str(body.origin) || "banco_dados";

    try {
      const supabase = getSupabase();
      const { data: campaign, error: campErr } = await supabase
        .from("followup_campaigns")
        .select("id, name, company_id, status, default_origin, dispatch_jitter_minutes")
        .eq("id", id)
        .maybeSingle();
      if (campErr || !campaign) return sendErr(res, 404, "NOT_FOUND", "Cadência não encontrada.");
      if (campaign.status !== "active") {
        const campaignName = campaign.name || "selecionada";
        return sendErr(
          res,
          400,
          "CAMPAIGN_NOT_ACTIVE",
          `A cadência "${campaignName}" está em rascunho ou pausada. Ative-a antes de aplicar aos leads.`
        );
      }

      let enrolled = 0;
      let enqueued = 0;
      let missingPhone = 0;
      let totalSkippedNoDate = 0;
      let totalSkippedPastDate = 0;
      const allSkippedSteps = [];
      const errors = [];

      for (const raw of leads) {
        const lead_name = str(raw?.name) || str(raw?.lead_name) || "Lead";
        const phone = str(raw?.phone) || str(raw?.telefone) || null;
        const meeting_datetime = str(raw?.meeting_datetime) || globalMeeting || null;
        const data_nascimento = str(raw?.data_nascimento) || null;
        try {
          const result = await enrollLead(campaign, {
            lead_name,
            phone,
            meeting_datetime,
            data_nascimento,
            lead: raw,
            originOverride: origin,
          });
          if (result.reason === "missing_phone") {
            missingPhone++;
            errors.push({ lead: lead_name, code: "MISSING_PHONE", message: "Lead sem telefone válido." });
          } else {
            enrolled++;
            enqueued += result.enqueued || 0;
            totalSkippedNoDate += result.skippedNoDate || 0;
            totalSkippedPastDate += result.skippedPastDate || 0;
            if (result.skippedSteps?.length) {
              allSkippedSteps.push(...result.skippedSteps.map((s) => ({ lead: lead_name, ...s })));
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          let userMsg = msg;
          if (msg.includes("Redis") || msg.includes("ECONNREFUSED") || msg.includes("connect")) {
            userMsg = "Falha de conexão com a fila de agendamento (Redis). Tente novamente.";
          }
          errors.push({ lead: lead_name, code: "ENROLL_ERROR", message: userMsg });
        }
      }

      // Se nenhuma mensagem pôde ser agendada (seja por falhas, telefone ou passos no passado)
      if (enqueued === 0) {
        const primaryError = errors.length > 0
          ? errors[0].message
          : allSkippedSteps.length > 0
            ? allSkippedSteps[0].message
            : "Nenhuma mensagem pôde ser agendada para os leads selecionados.";

        return res.status(422).json({
          success: false,
          enrolled,
          enqueued: 0,
          missingPhone,
          failed: errors.length,
          errors,
          skippedNoDate: totalSkippedNoDate,
          skippedPastDate: totalSkippedPastDate,
          skippedSteps: allSkippedSteps,
          error: {
            code: errors.length > 0 ? "ENROLLMENT_FAILED" : "ALL_STEPS_SKIPPED",
            message: primaryError,
          },
        });
      }

      return res.status(201).json({
        success: true,
        enrolled,
        enqueued,
        missingPhone,
        failed: errors.length,
        errors,
        skippedNoDate: totalSkippedNoDate,
        skippedPastDate: totalSkippedPastDate,
        skippedSteps: allSkippedSteps,
      });
    } catch (err) {
      return sendErr(res, 500, "ENROLL_FAILED", err.message);
    }
  });

  // GET /api/followup/campaigns/:id/upcoming?days=7&projectLeads=N — faixa "Próximos N dias".
  //
  // O teto de envio é do CHIP (número de WhatsApp), compartilhado entre TODAS as
  // cadências/empresas do tenant que despacham por ele — não só a cadência aberta.
  // Por isso este endpoint calcula dois números por dia:
  //   cadencePending — só os jobs pendentes DESTA cadência (a fração)
  //   chipPending    — jobs pendentes de TODAS as cadências que compartilham o
  //                    mesmo chip resolvido (o total real que vai sair daquele número)
  // O vermelho na UI deve vir de chipPending > chipLimit, nunca de cadencePending.
  //
  // Tenant SEMPRE resolvido a partir da linha (campaign -> company -> tenant_id),
  // nunca de um clientId no payload — e fora do escopo responde 404, não 403 (não
  // confirma nem nega a existência da cadência pra quem não tem acesso a ela).
  router.get("/campaigns/:id/upcoming", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "MISSING_ID", "id inválido");

    const rawDays = Number.parseInt(String(req.query.days || "7"), 10);
    const days = Number.isFinite(rawDays) && rawDays > 0 ? Math.min(rawDays, 30) : 7;
    const rawProject = Number.parseInt(String(req.query.projectLeads || "0"), 10);
    const projectLeads = Number.isFinite(rawProject) && rawProject > 0 ? rawProject : 0;

    try {
      const { rows: campRows } = await query(
        `SELECT fc.id, fc.company_id, fco.tenant_id, fco.evolution_instance
           FROM followup_campaigns fc
           JOIN followup_companies fco ON fco.id = fc.company_id
          WHERE fc.id = $1`,
        [id]
      );
      if (!campRows.length) return sendErr(res, 404, "NOT_FOUND", "Cadência não encontrada.");
      const campaignRow = campRows[0];

      // Fora do escopo do usuário: 404, não 403 — nunca confirma que a cadência existe.
      if (!hasTenantAccess(req, campaignRow.tenant_id)) {
        return sendErr(res, 404, "NOT_FOUND", "Cadência não encontrada.");
      }

      const tenantSettings = await getLeadClientN8nSettings(campaignRow.tenant_id);
      const sendWindowConfig = resolveSendWindowConfig(tenantSettings);
      const now = new Date();
      const dayKeys = buildUpcomingDayKeys(now, days, sendWindowConfig.timezone);
      const horizonEnd = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

      // Resolve o chip desta campanha e, a partir dele, TODAS as outras empresas do
      // tenant que despacham pelo mesmo chip — é o conjunto cujos jobs pendentes
      // formam o total real (chipPending). Falha graciosamente: chip desconectado
      // não derruba a faixa, só limita a leitura à própria cadência.
      let chipInstanceId = null;
      let chipLimit = null;
      let chipCompanyIds = [campaignRow.company_id];
      try {
        const instances = await getLeadClientEvolutionInstances(campaignRow.tenant_id);
        const evoConfig = await resolveEvolutionInstanceForFollowup(
          campaignRow.tenant_id,
          campaignRow.evolution_instance,
          instances
        );
        chipInstanceId = evoConfig.instanceId;
        chipLimit = resolveChipDailyLimit(evoConfig.rawInstance);

        const { rows: companies } = await query(
          `SELECT id, evolution_instance FROM followup_companies WHERE tenant_id = $1`,
          [campaignRow.tenant_id]
        );
        chipCompanyIds = [];
        for (const comp of companies) {
          try {
            const compEvo = await resolveEvolutionInstanceForFollowup(
              campaignRow.tenant_id,
              comp.evolution_instance,
              instances
            );
            if (compEvo.instanceId === chipInstanceId) chipCompanyIds.push(comp.id);
          } catch {
            // Empresa sem chip ativo/conectado: não participa da soma do chip.
          }
        }
      } catch (chipErr) {
        console.warn("[followup/upcoming] chip não resolvido:", chipErr?.message || chipErr);
      }

      const { rows: cadenceJobs } = await query(
        `SELECT fj.status, fj.scheduled_for
           FROM followup_jobs fj
           JOIN followup_schedules fs ON fs.id = fj.schedule_id
          WHERE fs.campaign_id = $1 AND fj.status = 'pending'
            AND fj.scheduled_for >= $2 AND fj.scheduled_for < $3`,
        [id, now.toISOString(), horizonEnd.toISOString()]
      );

      let chipJobs = cadenceJobs;
      if (chipCompanyIds.length > 0) {
        const { rows } = await query(
          `SELECT fj.status, fj.scheduled_for
             FROM followup_jobs fj
             JOIN followup_schedules fs ON fs.id = fj.schedule_id
            WHERE fs.company_id = ANY($1::uuid[]) AND fj.status = 'pending'
              AND fj.scheduled_for >= $2 AND fj.scheduled_for < $3`,
          [chipCompanyIds, now.toISOString(), horizonEnd.toISOString()]
        );
        chipJobs = rows;
      }

      const cadenceCounts = groupPendingJobsByDay(cadenceJobs, { timezone: sendWindowConfig.timezone });
      const chipCounts = groupPendingJobsByDay(chipJobs, { timezone: sendWindowConfig.timezone });

      let projectedAdditions = new Map();
      if (projectLeads > 0) {
        const supabase = getSupabase();
        const { data: templates } = await supabase
          .from("followup_templates")
          .select("*")
          .eq("campaign_id", id)
          .eq("is_active", true);
        projectedAdditions = projectLeadsOntoDays(templates || [], projectLeads, now, sendWindowConfig);
      }

      const dayResults = dayKeys.map((date) => {
        const projected = projectedAdditions.get(date) || 0;
        const cadencePending = (cadenceCounts.get(date) || 0) + projected;
        const chipPending = (chipCounts.get(date) || 0) + projected;
        return {
          date,
          cadencePending,
          chipPending,
          chipLimit,
          overLimit: chipLimit != null && chipPending > chipLimit,
          projected,
        };
      });

      return res.json({
        success: true,
        campaignId: id,
        days: dayResults,
        chipInstanceId,
        chipLimit,
      });
    } catch (err) {
      return sendErr(res, 500, "UPCOMING_FETCH_FAILED", err.message);
    }
  });

  // ── Calendário (Etapa 5 Commit 3) ───────────────────────────────────────────
  // Lente, não superfície de criação: nada se cria nem se arrasta aqui. Ações
  // permitidas no dia: abrir a conversa e cancelar um passo (rota já existente,
  // PATCH /api/followup-queue/jobs/:jobId/cancel).
  //
  // Agrega o TENANT INTEIRO (todas as empresas/cadências), não uma cadência só —
  // é por isso que precisa do clientId como escopo explícito na query, diferente de
  // /campaigns/:id/upcoming (que deriva o tenant da própria cadência). O clientId da
  // query NUNCA é usado direto: sempre passa por hasTenantAccess antes de virar
  // filtro — fora do escopo responde 404, não 403, e sem essa guarda a tela vira
  // listagem de leads e horários de outra empresa.

  function resolveCalendarTenant(req, res) {
    const clientId = str(req.query.clientId);
    if (!clientId) {
      sendErr(res, 400, "MISSING_CLIENT_ID", "clientId é obrigatório.");
      return null;
    }
    if (!hasTenantAccess(req, clientId)) {
      sendErr(res, 404, "NOT_FOUND", "Tenant não encontrado.");
      return null;
    }
    return clientId;
  }

  // GET /api/followup/calendar?clientId=X&month=YYYY-MM
  router.get("/calendar", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const clientId = resolveCalendarTenant(req, res);
    if (!clientId) return;

    const monthStr = str(req.query.month);
    if (!monthStr || !/^\d{4}-\d{2}$/.test(monthStr)) {
      return sendErr(res, 400, "INVALID_MONTH", "month deve ser YYYY-MM.");
    }
    const [year, month] = monthStr.split("-").map(Number);
    if (month < 1 || month > 12) return sendErr(res, 400, "INVALID_MONTH", "month deve ser YYYY-MM.");

    try {
      const tenantSettings = await getLeadClientN8nSettings(clientId);
      const timezone = resolveSendWindowConfig(tenantSettings).timezone;

      const monthStart = createDateInTimezone(year, month, 1, 0, 0, 0, timezone);
      const nextMonth = month === 12 ? { y: year + 1, m: 1 } : { y: year, m: month + 1 };
      const monthEnd = createDateInTimezone(nextMonth.y, nextMonth.m, 1, 0, 0, 0, timezone);
      const daysInMonth = new Date(year, month, 0).getDate();

      const { rows: jobs } = await query(
        `SELECT fj.status, fj.scheduled_for
           FROM followup_jobs fj
           JOIN followup_schedules fs ON fs.id = fj.schedule_id
           JOIN followup_companies fco ON fco.id = fs.company_id
          WHERE fco.tenant_id = $1 AND fj.status = 'pending'
            AND fj.scheduled_for >= $2 AND fj.scheduled_for < $3`,
        [clientId, monthStart.toISOString(), monthEnd.toISOString()]
      );
      const counts = groupPendingJobsByDay(jobs, { timezone });

      const dayCounts = {};
      for (let d = 1; d <= daysInMonth; d++) {
        const key = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
        dayCounts[key] = counts.get(key) || 0;
      }

      return res.json({ success: true, tenantId: clientId, month: monthStr, dayCounts });
    } catch (err) {
      return sendErr(res, 500, "CALENDAR_FETCH_FAILED", err.message);
    }
  });

  // GET /api/followup/calendar/day?clientId=X&date=YYYY-MM-DD
  router.get("/calendar/day", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const clientId = resolveCalendarTenant(req, res);
    if (!clientId) return;

    const dateStr = str(req.query.date);
    if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return sendErr(res, 400, "INVALID_DATE", "date deve ser YYYY-MM-DD.");
    }
    const [year, month, day] = dateStr.split("-").map(Number);

    try {
      const tenantSettings = await getLeadClientN8nSettings(clientId);
      const timezone = resolveSendWindowConfig(tenantSettings).timezone;

      const dayStart = createDateInTimezone(year, month, day, 0, 0, 0, timezone);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

      const { rows: items } = await query(
        `SELECT fj.id AS job_id, fj.scheduled_for, fj.status,
                fs.id AS schedule_id, fs.lead_name, fs.phone, fs.campaign_id,
                COALESCE(fc.name, 'Avulso') AS campaign_name,
                ft.name AS template_name
           FROM followup_jobs fj
           JOIN followup_schedules fs  ON fs.id = fj.schedule_id
           JOIN followup_companies fco ON fco.id = fs.company_id
           LEFT JOIN followup_campaigns fc ON fc.id = fs.campaign_id
           LEFT JOIN followup_templates ft ON ft.id = fj.template_id
          WHERE fco.tenant_id = $1 AND fj.status = 'pending'
            AND fj.scheduled_for >= $2 AND fj.scheduled_for < $3
          ORDER BY fj.scheduled_for ASC`,
        [clientId, dayStart.toISOString(), dayEnd.toISOString()]
      );

      return res.json({
        success: true,
        tenantId: clientId,
        date: dateStr,
        items: items.map((it) => ({
          jobId: it.job_id,
          scheduleId: it.schedule_id,
          campaignId: it.campaign_id,
          campaignName: it.campaign_name,
          templateName: it.template_name,
          leadName: it.lead_name,
          phone: it.phone,
          scheduledFor: it.scheduled_for,
          status: it.status,
        })),
      });
    } catch (err) {
      return sendErr(res, 500, "CALENDAR_DAY_FETCH_FAILED", err.message);
    }
  });

  // POST /api/followup/reminders — cria um lembrete avulso para 1 lead
  // Body: { leadName, phone, scheduledFor, message, companyId?, tenantId? }
  router.post("/reminders", async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const leadName = str(body.leadName) || str(body.nome) || "Lead";
    const rawPhone = str(body.phone) || str(body.telefone) || "";
    const phoneDigits = rawPhone.replace(/\D/g, "");

    // 1. Validação de telefone
    if (!phoneDigits || phoneDigits.length < 10) {
      return sendErr(res, 400, "MISSING_PHONE", "Lead sem telefone válido. Forneça um número com DDD.");
    }
    const cleanPhone = phoneDigits.startsWith("55") ? phoneDigits : `55${phoneDigits}`;

    // 2. Validação de mensagem
    const message = str(body.message);
    if (!message) {
      return sendErr(res, 400, "MISSING_MESSAGE", "A mensagem do lembrete não pode ficar em branco.");
    }

    // 3. Validação de horário no futuro
    const scheduledFor = str(body.scheduledFor);
    if (!scheduledFor) {
      return sendErr(res, 400, "MISSING_DATETIME", "Defina a data e hora do lembrete.");
    }
    const targetDate = new Date(scheduledFor);
    if (isNaN(targetDate.getTime())) {
      return sendErr(res, 400, "INVALID_DATETIME", "Data e hora de agendamento inválidas.");
    }
    const now = Date.now();
    if (targetDate.getTime() <= now) {
      return sendErr(res, 400, "PAST_DATETIME", "Esse horário já passou. Escolha um momento futuro.");
    }

    try {
      // 4. Resolver company do tenant
      const authTenants = authorizedTenantIds(req);
      const requestedTenantId = str(body.tenantId);
      const tenantId = (authTenants.length > 0 && !isAdminAccess(req))
        ? (authTenants.includes(requestedTenantId) ? requestedTenantId : authTenants[0])
        : (requestedTenantId || "geracao-digital");

      let resolvedCompanyId = str(body.companyId);
      if (!resolvedCompanyId) {
        const { rows: compRows } = await query(
          `SELECT id FROM followup_companies WHERE tenant_id = $1 ORDER BY created_at ASC LIMIT 1`,
          [tenantId]
        );
        if (compRows.length) {
          resolvedCompanyId = compRows[0].id;
        } else {
          // Criar company padrão para o tenant se não existir
          const { rows: newComp } = await query(
            `INSERT INTO followup_companies (tenant_id, name) VALUES ($1, $2) RETURNING id`,
            [tenantId, tenantId === "geracao-digital" ? "Geração Digital" : tenantId]
          );
          resolvedCompanyId = newComp[0].id;
        }
      }

      // 5. Ajustar data de acordo com a janela de envio permitida do tenant
      const tenantSettings = await getLeadClientN8nSettings(tenantId);
      const sendWindowConfig = resolveSendWindowConfig(tenantSettings);
      const effectiveDate = adjustDateToSendWindow(targetDate, sendWindowConfig);

      // 6. Inserir followup_schedule avulso (campaign_id = NULL)
      const { rows: schedRows } = await query(
        `INSERT INTO followup_schedules (campaign_id, company_id, lead_name, phone, status, origin, origin_type)
         VALUES (NULL, $1, $2, $3, 'active', 'manual', 'manual')
         RETURNING id`,
        [resolvedCompanyId, leadName, cleanPhone]
      );
      const scheduleId = schedRows[0].id;

      // 7. Inserir followup_job com custom_message e template_id = NULL
      const { rows: jobRows } = await query(
        `INSERT INTO followup_jobs (schedule_id, template_id, custom_message, status, scheduled_for)
         VALUES ($1, NULL, $2, 'pending', $3)
         RETURNING id`,
        [scheduleId, message, effectiveDate.toISOString()]
      );
      const jobId = jobRows[0].id;

      // 8. Enfileirar no BullMQ com delay em milissegundos
      const delayMs = Math.max(0, effectiveDate.getTime() - now);
      await getFollowupQueue().add(
        "send-followup",
        { jobId, customMessage: message },
        { delay: delayMs, jobId: `fup-reminder-${jobId}` }
      );

      return res.status(201).json({
        success: true,
        scheduleId,
        jobId,
        scheduledFor: effectiveDate.toISOString(),
        delayMs,
        leadName,
        phone: cleanPhone,
      });
    } catch (err) {
      console.error("[followup/reminders] Erro ao criar lembrete avulso:", err);
      return sendErr(res, 500, "REMINDER_CREATE_FAILED", err.message);
    }
  });

  // ── Âncoras ──────────────────────────────────────────────────────────────

  // GET /api/followup/anchor-fields
  router.get("/anchor-fields", requireFirebaseAuth, requireInternalPageAccess("planilhas"), (req, res) => {
    return res.json({
      success: true,
      fields: getAnchorFieldsMetadata(),
    });
  });

  // ── Templates ─────────────────────────────────────────────────────────────

  // GET /api/followup/templates?campaignId=
  router.get("/templates", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const campaignId = str(req.query.campaignId);
    if (!campaignId) return sendErr(res, 400, "MISSING_CAMPAIGN_ID", "campaignId é obrigatório");
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from("followup_templates")
        .select("id, campaign_id, name, message, trigger_type, trigger_value, trigger_unit, trigger_direction, is_active, order_index, scheduled_time, scheduled_date, anchor_field, media_path, media_type, media_mime, media_filename, created_at")
        .eq("campaign_id", campaignId)
        .order("order_index", { ascending: true });
      if (error) throw error;
      return res.json({ success: true, templates: data || [] });
    } catch (err) {
      return sendErr(res, 500, "TEMPLATES_FETCH_FAILED", err.message);
    }
  });

  // POST /api/followup/templates
  router.post("/templates", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const {
      campaign_id, name, message,
      trigger_type, trigger_value, trigger_unit, trigger_direction,
      is_active, order_index,
      scheduled_time, scheduled_date, anchor_field,
      media_path, media_type, media_mime, media_filename,
    } = req.body || {};
    if (!str(campaign_id) || !str(name) || !str(message) || !str(trigger_type)) {
      return sendErr(res, 400, "MISSING_FIELDS", "Campos obrigatórios faltando");
    }
    const validation = validateTemplatePayload({ trigger_type, anchor_field, scheduled_time, scheduled_date });
    if (!validation.valid) {
      return sendErr(res, 400, validation.code, validation.message);
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
          scheduled_time: scheduled_time ? str(scheduled_time) : null,
          scheduled_date: scheduled_date ? str(scheduled_date) : null,
          anchor_field: anchor_field ? str(anchor_field) : null,
          media_path: media_path ? str(media_path) : null,
          media_type: media_type ? str(media_type) : null,
          media_mime: media_mime ? str(media_mime) : null,
          media_filename: media_filename ? str(media_filename) : null,
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
  router.patch("/templates/reorder", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
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
  router.patch("/templates/:id", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "MISSING_ID", "id inválido");
    try {
      const supabase = getSupabase();
      const { data: existing, error: fetchErr } = await supabase
        .from("followup_templates")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!existing) return sendErr(res, 404, "NOT_FOUND", "Template não encontrado");

      const merged = {
        ...existing,
        ...(req.body || {}),
      };
      const validation = validateTemplatePayload(merged);
      if (!validation.valid) {
        return sendErr(res, 400, validation.code, validation.message);
      }

      const allowed = [
        "name", "message", "trigger_type", "trigger_value",
        "trigger_unit", "trigger_direction", "is_active", "order_index",
        "scheduled_time", "scheduled_date", "anchor_field",
        "media_path", "media_type", "media_mime", "media_filename",
      ];
      const patch = { updated_at: new Date().toISOString() };
      for (const k of allowed) {
        if (k in (req.body || {})) {
          patch[k] = req.body[k] === null ? null : req.body[k];
        }
      }
      const { data, error } = await supabase
        .from("followup_templates")
        .update(patch)
        .eq("id", id)
        .select()
        .maybeSingle();
      if (error) throw error;

      const timingFields = [
        "trigger_value",
        "trigger_unit",
        "trigger_direction",
        "scheduled_time",
        "scheduled_date",
        "anchor_field",
        "trigger_type",
      ];
      const timingChanged = timingFields.some(
        (f) => f in (req.body || {}) && String(existing[f] ?? "") !== String(patch[f] ?? "")
      );

      const { rows: countRows } = await query(
        "SELECT COUNT(*)::int as count FROM followup_jobs WHERE template_id = $1 AND status = 'pending'",
        [id]
      );
      const pendingJobsCount = countRows[0]?.count || 0;

      return res.json({
        success: true,
        template: data,
        pendingJobsCount,
        timingChanged,
      });
    } catch (err) {
      return sendErr(res, 500, "TEMPLATE_UPDATE_FAILED", err.message);
    }
  });

  // POST /api/followup/templates/:id/reschedule-pending — recalcula e reenfileira jobs pendentes do template
  router.post("/templates/:id/reschedule-pending", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "MISSING_ID", "id inválido");

    try {
      const result = await reschedulePendingJobsForTemplate(id);
      return res.json(result);
    } catch (err) {
      const status = err.code === "NOT_FOUND" ? 404 : 500;
      return sendErr(res, status, err.code || "RESCHEDULE_PENDING_FAILED", err.message);
    }
  });

  // DELETE /api/followup/templates/:id
  router.delete("/templates/:id", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
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
  router.get("/schedules", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
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
  router.get("/analytics", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
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

  // ── Suggestions (motor proativo) ─────────────────────────────────────────────

  // POST /api/followup/engine/run — disparo manual do motor proativo
  // (botão "Ativar Esteira 4"). Responde 202 e processa em background.
  router.post("/engine/run", requireFirebaseAuth, requireInternalPageAccess("planilhas"), (req, res) => {
    const result = triggerAutomationRun();
    if (!result.started) {
      return sendErr(res, 409, "ENGINE_ALREADY_RUNNING", "O motor de automação já está em execução. Aguarde a varredura atual terminar.");
    }
    return res.status(202).json({ success: true, started: true });
  });

  // GET /api/followup/suggestions?companyId=&status=pending
  router.get("/suggestions", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const companyId = str(req.query.companyId);
    const status    = str(req.query.status) ?? "pending";

    const validStatuses = ["pending", "approved", "rejected"];
    if (!validStatuses.includes(status)) {
      return sendErr(res, 400, "INVALID_QUERY", `status must be one of: ${validStatuses.join(", ")}`);
    }

    try {
      const params = [status];
      let companyFilter = "";
      if (companyId) {
        params.push(companyId);
        companyFilter = `AND s.company_id = $${params.length}`;
      }

      const { rows } = await query(
        `SELECT
           s.id, s.company_id, s.campaign_id, s.lead_name, s.phone,
           s.lead_source, s.reason, s.suggested_message, s.status,
           s.approved_by, s.approved_at, s.executed_at, s.created_at,
           fc.name   AS campaign_name,
           fco.name  AS company_name,
           ft.id     AS template_id,
           ft.name   AS template_name,
           ft.message AS template_message
         FROM followup_suggestions s
         LEFT JOIN followup_campaigns  fc  ON fc.id  = s.campaign_id
         LEFT JOIN followup_companies  fco ON fco.id = s.company_id
         LEFT JOIN followup_templates  ft  ON ft.id  = s.suggested_template_id
         WHERE s.status = $1 ${companyFilter}
         ORDER BY s.created_at DESC
         LIMIT 200`,
        params
      );

      return res.json({ success: true, suggestions: rows, total: rows.length });
    } catch (err) {
      return sendErr(res, 500, "SUGGESTIONS_FETCH_FAILED", err.message);
    }
  });

  // GET /api/followup/suggestions/count — contagem de pendentes (para badge)
  router.get("/suggestions/count", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const companyId = str(req.query.companyId);
    try {
      const params = [];
      let companyFilter = "";
      if (companyId) {
        params.push(companyId);
        companyFilter = `AND company_id = $${params.length}`;
      }
      const { rows } = await query(
        `SELECT COUNT(*) AS cnt FROM followup_suggestions WHERE status = 'pending' ${companyFilter}`,
        params
      );
      return res.json({ success: true, count: Number(rows[0]?.cnt || 0) });
    } catch (err) {
      console.warn("[followup/routes][COUNT_FALLBACK]", err?.message || err);
      return res.json({ success: true, count: 0 });
    }
  });

  // PATCH /api/followup/suggestions/:id/approve — cria schedule + job BullMQ
  router.patch("/suggestions/:id/approve", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "INVALID_PARAM", "Missing id");

    const body             = req.body && typeof req.body === "object" ? req.body : {};
    const customMessage    = str(body.message);   // mensagem editada pelo operador (opcional)

    try {
      const { rows: suggRows } = await query(
        `SELECT * FROM followup_suggestions WHERE id = $1 AND status = 'pending'`,
        [id]
      );
      if (!suggRows.length) return sendErr(res, 404, "NOT_FOUND", "Suggestion not found or already processed");

      const sugg = suggRows[0];

      // Criar followup_schedule
      const { rows: schedRows } = await query(
        `INSERT INTO followup_schedules (campaign_id, company_id, lead_name, phone, origin, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING id`,
        [sugg.campaign_id, sugg.company_id, sugg.lead_name, sugg.phone, sugg.lead_source]
      );
      const scheduleId = schedRows[0].id;

      // Resolver template
      let templateId = sugg.suggested_template_id;
      if (!templateId && sugg.campaign_id) {
        const { rows: tplRows } = await query(
          `SELECT id FROM followup_templates WHERE campaign_id = $1 AND is_active = true ORDER BY order_index ASC LIMIT 1`,
          [sugg.campaign_id]
        );
        if (tplRows.length) templateId = tplRows[0].id;
      }

      // We always create a job now, even if templateId is null, because LivPub suggestions have custom generated text without a template
      const finalMessage = customMessage || sugg.suggested_message || null;
      let jobId = null;
      if (templateId || finalMessage) {
        const { rows: jobRows } = await query(
          `INSERT INTO followup_jobs (schedule_id, template_id, status, scheduled_for)
           VALUES ($1, $2, 'pending', NOW() + interval '5 minutes')
           RETURNING id`,
          [scheduleId, templateId || null]
        );
        jobId = jobRows[0].id;

        await getFollowupQueue().add(
          "send-followup",
          { jobId, customMessage: finalMessage },
          { delay: 5 * 60 * 1000, jobId: `fup-suggestion-${jobId}` }
        );
      }

      const approvedBy = req.user?.uid || "operator";
      await query(
        `UPDATE followup_suggestions
            SET status = 'approved', approved_by = $2, approved_at = NOW(), executed_at = NOW(), job_id = $3
          WHERE id = $1`,
        [id, approvedBy, jobId]
      );

      return res.json({ success: true, id, scheduleId, jobId });
    } catch (err) {
      return sendErr(res, 500, "APPROVE_FAILED", err.message);
    }
  });

  // PATCH /api/followup/suggestions/:id/reject
  router.patch("/suggestions/:id/reject", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "INVALID_PARAM", "Missing id");

    try {
      const { rows } = await query(
        `UPDATE followup_suggestions SET status = 'rejected' WHERE id = $1 AND status = 'pending' RETURNING id`,
        [id]
      );
      if (!rows.length) return sendErr(res, 404, "NOT_FOUND", "Suggestion not found or already processed");
      return res.json({ success: true, id });
    } catch (err) {
      return sendErr(res, 500, "REJECT_FAILED", err.message);
    }
  });

  

  // GET /api/followup/suggestions/history
  router.get("/suggestions/history", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const companyId = str(req.query.companyId);
    try {
      const conds = ["s.status IN ('approved', 'rejected')"];
      const params = [];
      if (companyId) {
        params.push(companyId);
        conds.push(`s.company_id = $${params.length}::uuid`);
      }
      const { rows } = await query(
        `SELECT
           s.id, s.company_id, s.campaign_id, s.lead_name, s.phone,
           s.lead_source, s.reason, s.suggested_message, s.status AS suggestion_status,
           s.approved_by, s.approved_at, s.job_id,
           j.status AS job_status, j.error_log AS error_message
         FROM followup_suggestions s
         LEFT JOIN followup_jobs j ON j.id = s.job_id
         WHERE ${conds.join(" AND ")}
         ORDER BY s.approved_at DESC NULLS LAST, s.created_at DESC
         LIMIT 100`,
        params
      );
      return res.json({ success: true, items: rows });
    } catch (err) {
      return sendErr(res, 500, "HISTORY_FETCH_FAILED", err.message);
    }
  });

  // POST /api/followup/suggestions/:id/play
  router.post("/suggestions/:id/play", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "INVALID_PARAM", "Missing id");
    try {
      const { rows } = await query(`SELECT job_id FROM followup_suggestions WHERE id = $1`, [id]);
      if (!rows.length || !rows[0].job_id) return sendErr(res, 404, "NOT_FOUND", "Suggestion or job not found");
      const job = await getFollowupQueue().getJob(`fup-suggestion-${rows[0].job_id}`);
      if (job) {
        await job.promote();
      }
      return res.json({ success: true, message: "Job promoted successfully" });
    } catch (err) {
      return sendErr(res, 500, "PLAY_FAILED", err.message);
    }
  });

  // POST /api/followup/suggestions/:id/cancel
  router.post("/suggestions/:id/cancel", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const id = str(req.params.id);
    if (!id) return sendErr(res, 400, "INVALID_PARAM", "Missing id");
    try {
      const { rows } = await query(`SELECT job_id FROM followup_suggestions WHERE id = $1`, [id]);
      if (!rows.length || !rows[0].job_id) return sendErr(res, 404, "NOT_FOUND", "Suggestion or job not found");
      const job = await getFollowupQueue().getJob(`fup-suggestion-${rows[0].job_id}`);
      if (job) {
        await job.remove();
      }
      await query(`UPDATE followup_jobs SET status = 'cancelled' WHERE id = $1`, [rows[0].job_id]);
      return res.json({ success: true, message: "Job cancelled successfully" });
    } catch (err) {
      return sendErr(res, 500, "CANCEL_FAILED", err.message);
    }
  });

  // POST /api/followup/suggestions/approve-batch
  router.post("/suggestions/approve-batch", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const ids  = Array.isArray(body.ids) ? body.ids.filter((i) => typeof i === "string") : [];
    if (!ids.length) return sendErr(res, 400, "INVALID_BODY", "ids must be a non-empty array of strings");

    const results = { approved: [], failed: [] };

    for (const id of ids) {
      try {
        const { rows: suggRows } = await query(
          `SELECT * FROM followup_suggestions WHERE id = $1 AND status = 'pending'`,
          [id]
        );
        if (!suggRows.length) { results.failed.push({ id, reason: "not_found_or_processed" }); continue; }

        const sugg = suggRows[0];

        const { rows: schedRows } = await query(
          `INSERT INTO followup_schedules (campaign_id, company_id, lead_name, phone, origin, status)
           VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
          [sugg.campaign_id, sugg.company_id, sugg.lead_name, sugg.phone, sugg.lead_source]
        );
        const scheduleId = schedRows[0].id;

        let templateId = sugg.suggested_template_id;
        if (!templateId) {
          const { rows: tplRows } = await query(
            `SELECT id FROM followup_templates WHERE campaign_id = $1 AND is_active = true ORDER BY order_index ASC LIMIT 1`,
            [sugg.campaign_id]
          );
          if (tplRows.length) templateId = tplRows[0].id;
        }

        if (templateId) {
          const { rows: jobRows } = await query(
            `INSERT INTO followup_jobs (schedule_id, template_id, status, scheduled_for)
             VALUES ($1, $2, 'pending', NOW()) RETURNING id`,
            [scheduleId, templateId]
          );
          await getFollowupQueue().add(
            "send-followup",
            { jobId: jobRows[0].id, customMessage: sugg.suggested_message || null },
            { delay: 0, jobId: `fup-batch-${jobRows[0].id}` }
          );
        }

        const approvedBy = req.user?.uid || "operator";
        await query(
          `UPDATE followup_suggestions SET status = 'approved', approved_by = $2, approved_at = NOW(), executed_at = NOW() WHERE id = $1`,
          [id, approvedBy]
        );
        results.approved.push(id);
      } catch (err) {
        console.error(`[followup/suggestions] batch approve error for ${id}:`, err.message);
        results.failed.push({ id, reason: err.message });
      }
    }

    return res.json({ success: true, ...results });
  });

  // Montar router em /api/followup
  app.use("/api/followup", router);
}
