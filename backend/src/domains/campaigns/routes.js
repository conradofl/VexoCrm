// backend/src/domains/campaigns/routes.js
// Movimento puro (extraido de registerAllDomainRoutes.js): 34 rotas do dominio
// campaigns -- n8n-dispatches, campaigns/ai/* (6), direct-dispatch, CRUD de campaigns,
// consultant-schedules (4), run-due, :id/trigger, dispatches (CRUD/trigger/failed),
// reports (import-audit/create-import-from-subset/delete-import-items), reply-webhook,
// leads-for-dispatch e campaign-prompts (3). Corpo dos handlers identico ao original --
// so muda de onde vem as dependencias (deps em vez de routeDeps destructure inline).
//
// appendLeadMessage e isGroupJid vem de createLeadMessaging/shared/leadMessaging.js --
// mesmo mecanismo usado em outros dominios (chatbot, integrations): este modulo invoca
// a mesma factory (sem duplicar a funcao) e usa appendLeadMessage/isGroupJid no
// reply-webhook.
//
// _evolutionDailyUsageSchemaEnsured / _dispatchRunsClaimSchemaEnsured: flags module-level
// que garantem que os ALTER TABLE de bootstrap (quota diaria de instancia Evolution e
// claim schema de dispatch_runs) rodem uma unica vez por processo -- preservadas tal como
// no original.
//
// _dueDispatchTimerStarted: guarda anti-duplicacao introduzida nesta extracao (unica
// mudanca de comportamento autorizada). O setInterval de 30s que roda
// runDueIndependentDispatches hoje era efeito colateral do corpo de registerAllDomainRoutes
// SEM guarda; ao mover para um modulo com registerCampaignsRoutes(app, deps) proprio,
// uma chamada dupla da funcao de registro duplicaria o timer -- a guarda impede isso.
// Corpo do interval em si e byte-a-byte identico ao original.

import { createLeadMessaging, isGroupJid } from "../shared/leadMessaging.js";
import {
  dispatchCampaignSequence,
  normalizeCampaignAnalyticsMeta,
  validateCampaignAnalyticsMeta,
} from "../../campaign-outbound.js";
import {
  generateCampaignCopySuggestion,
  generateCampaignTemplateVariants,
  getGroqCampaignAiStatus,
  rewriteCampaignStep,
  suggestCampaignDelays,
  suggestCampaignSequence,
} from "../../campaign-ai.js";
import { resolveRequiredAuthorizedClientId } from "../../tenantScope.js";
import {
  extractTextFromBody,
  isFirstCampaignReply,
} from "../../chatbot-ai-engine.js";

let _evolutionDailyUsageSchemaEnsured = false;
let _dispatchRunsClaimSchemaEnsured = false;
let _dueDispatchTimerStarted = false;

export function registerCampaignsRoutes(app, deps) {
  const {
    CAMPAIGN_SCHEDULER_MAX_BATCH,
    buildDispatchLeads,
    canCampaignBeDispatched,
    checkEvolutionInstanceHealth,
    continueCampaignLeadFromReply,
    ensureDb,
    executeCampaignDispatch,
    findCampaignReplyMatches,
    getClientName,
    getLeadClientEvolutionInstances,
    getLeadClientN8nSettings,
    getRequestId,
    getSafeDispatchSettingsLog,
    internalErrorPayloadDetails,
    isMissingSchemaError,
    isProduction,
    logCampaignReplyFlow,
    logDirectDispatch,
    maskPhoneForLog,
    normalizeIsoDate,
    leadsTableName,
    normalizeString,
    normalizeTenantKey,
    parseOptionalUuid,
    pgDatabasePool,
    requireAppViewAccess,
    requireFirebaseAuth,
    requireInternalPageAccess,
    resolveAuthorizedClientId,
    resolveCampaignDispatchSettings,
    resolveDispatchWebhookSettings,
    runDueCampaignDispatches,
    sanitizePhone,
    sendError,
    supabase,
    validateN8nInboundBearer,
  } = deps;

  const { appendLeadMessage } = createLeadMessaging({
    supabase,
    normalizeString,
    leadsTableName,
    isMissingSchemaError,
  });

  app.post(
    "/api/n8n-dispatches",
    requireFirebaseAuth,
    requireAppViewAccess("planilhas"),
    async (req, res) => {
    if (!ensureDb(res)) return;

    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;
    const importId = normalizeString(req.body?.importId);
    const scheduledAt = normalizeString(req.body?.scheduledAt);
    const campaignName = normalizeString(req.body?.campaignName);
    const channel = normalizeString(req.body?.channel);
    const rawLimit = Number.parseInt(String(req.body?.limit ?? ""), 10);
    const limit = Number.isNaN(rawLimit) ? null : rawLimit;
    const validation = validateCampaignAnalyticsMeta(
      req.body?.analyticsMeta ||
        {
          message: req.body?.message,
          image: req.body?.image,
          sequence: req.body?.sequence,
          dispatchOptions: req.body?.dispatchOptions,
        }
    );

    try {
      const dispatchSettings = await resolveDispatchWebhookSettings(clientId);
      const { webhookUrl, webhookToken } = dispatchSettings;
      if (!webhookUrl) {
        sendError(
          res,
          400,
          "EVOLUTION_SETTINGS_MISSING",
          "Configure uma URL ativa de disparo Evolution para esta empresa"
        );
        return;
      }
      await checkEvolutionInstanceHealth({
        webhookUrl,
        webhookToken,
        context: {
          clientId,
          mode: "legacy_manual_dispatch",
          campaignName: campaignName || null,
        },
      });

      if (!validation.valid) {
        sendError(res, 400, "INVALID_CAMPAIGN_CONTENT", validation.message);
        return;
      }

      const leads = await buildDispatchLeads({
        clientId,
        importId,
        limit,
        segmentation: validation.analyticsMeta.segmentation || null,
      });

      if (leads.length === 0) {
        sendError(res, 404, "NO_DISPATCH_LEADS", "No leads found for dispatch");
        return;
      }

      const clientName = await getClientName(clientId);
      const { summary } = await dispatchCampaignSequence({
        webhookUrl,
        webhookToken,
        leads,
        analyticsMeta: validation.analyticsMeta,
        context: {
          campaign: {
            id: null,
            name: campaignName || null,
            importId,
            scheduledAt: scheduledAt || null,
            channel: channel || null,
            requestedBy: {
              uid: req.authAccess?.uid || null,
              email: req.authAccess?.email || null,
            },
          },
          client: {
            id: clientId,
            name: clientName,
          },
        },
      });

      res.json({
        success: true,
        provider: "evolution",
        campaignName: campaignName || null,
        total: leads.length,
        successCount: summary.successCount,
        failureCount: summary.failureCount,
        successPhones: summary.successPhones,
        failures: summary.failures,
        completedCampaign: summary.completedCampaign,
      });
    } catch (error) {
      console.error("legacy manual evolution dispatch error:", error);
      sendError(
        res,
        500,
        "EVOLUTION_DISPATCH_FAILED",
        error instanceof Error ? error.message : "Failed to send leads through Evolution"
      );
    }
    }
  );
  // ─────────────────────────────────────────────────────────────
  // CAMPANHAS — CRUD + TRIGGER + LEADS-FOR-DISPATCH
  // ─────────────────────────────────────────────────────────────

  // GET /api/campaigns — lista campanhas do usuário
  app.get("/api/campaigns/ai/status", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (_req, res) => {
    res.json(getGroqCampaignAiStatus());
  });

  app.post("/api/campaigns/ai/generate-copy", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    try {
      if (!getGroqCampaignAiStatus().enabled) {
        sendError(res, 404, "GROQ_DISABLED", "Groq assistivo nao esta configurado neste ambiente");
        return;
      }

      const item = await generateCampaignCopySuggestion({
        campaignName: req.body?.campaignName,
        goal: req.body?.goal,
        style: req.body?.style,
        segmentation: req.body?.segmentation,
      });

      res.json({ item });
    } catch (error) {
      console.error("campaign ai generate copy error:", error);
      sendError(res, 502, "GROQ_REQUEST_FAILED", error instanceof Error ? error.message : "Falha ao consultar a Groq");
    }
  });

  app.post("/api/campaigns/ai/suggest-sequence", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    try {
      if (!getGroqCampaignAiStatus().enabled) {
        sendError(res, 404, "GROQ_DISABLED", "Groq assistivo nao esta configurado neste ambiente");
        return;
      }

      const suggestion = await suggestCampaignSequence({
        campaignName: req.body?.campaignName,
        goal: req.body?.goal,
        style: req.body?.style,
        segmentation: req.body?.segmentation,
        sequence: req.body?.sequence,
      });
      const analyticsMeta = normalizeCampaignAnalyticsMeta({
        sequence: suggestion.sequence,
        dispatchOptions: {
          leadDelaySeconds: suggestion.leadDelaySeconds,
          stopOnStepFailure: true,
          aiAssisted: true,
        },
      });

      res.json({
        item: {
          sequence: analyticsMeta.sequence,
          dispatchOptions: analyticsMeta.dispatchOptions,
          rationale: suggestion.rationale,
        },
      });
    } catch (error) {
      console.error("campaign ai suggest sequence error:", error);
      sendError(res, 502, "GROQ_REQUEST_FAILED", error instanceof Error ? error.message : "Falha ao consultar a Groq");
    }
  });

  app.post("/api/campaigns/ai/generate-template-variants", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    try {
      if (!getGroqCampaignAiStatus().enabled) {
        sendError(res, 404, "GROQ_DISABLED", "Groq assistivo nao esta configurado neste ambiente");
        return;
      }

      const suggestion = await generateCampaignTemplateVariants({
        campaignName: req.body?.campaignName,
        goal: req.body?.goal,
        style: req.body?.style,
        baseText: req.body?.baseText,
        count: req.body?.count,
        segmentation: req.body?.segmentation,
        sequence: req.body?.sequence,
      });

      res.json({ item: suggestion });
    } catch (error) {
      console.error("campaign ai generate template variants error:", error);
      sendError(res, 502, "GROQ_REQUEST_FAILED", error instanceof Error ? error.message : "Falha ao consultar a Groq");
    }
  });

  app.post("/api/campaigns/ai/suggest-delays", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    try {
      if (!getGroqCampaignAiStatus().enabled) {
        sendError(res, 404, "GROQ_DISABLED", "Groq assistivo nao esta configurado neste ambiente");
        return;
      }

      const normalizedMeta = normalizeCampaignAnalyticsMeta({
        sequence: req.body?.sequence,
        dispatchOptions: req.body?.dispatchOptions,
      });
      const suggestion = await suggestCampaignDelays({
        campaignName: req.body?.campaignName,
        goal: req.body?.goal,
        style: req.body?.style,
        segmentation: req.body?.segmentation,
        sequence: normalizedMeta.sequence,
      });
      const suggestedDelays = new Map(
        (suggestion.sequence || []).map((step) => [normalizeString(step.id), Number(step.delayAfterSeconds) || 0])
      );
      const analyticsMeta = normalizeCampaignAnalyticsMeta({
        ...normalizedMeta,
        sequence: normalizedMeta.sequence.map((step) => ({
          ...step,
          delayAfterSeconds: suggestedDelays.has(step.id)
            ? suggestedDelays.get(step.id)
            : step.delayAfterSeconds,
        })),
        dispatchOptions: {
          ...normalizedMeta.dispatchOptions,
          leadDelaySeconds: suggestion.leadDelaySeconds,
          aiAssisted: true,
        },
      });

      res.json({
        item: {
          sequence: analyticsMeta.sequence,
          dispatchOptions: analyticsMeta.dispatchOptions,
          rationale: suggestion.rationale,
        },
      });
    } catch (error) {
      console.error("campaign ai suggest delays error:", error);
      sendError(res, 502, "GROQ_REQUEST_FAILED", error instanceof Error ? error.message : "Falha ao consultar a Groq");
    }
  });

  app.post("/api/campaigns/ai/rewrite-step", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    try {
      if (!getGroqCampaignAiStatus().enabled) {
        sendError(res, 404, "GROQ_DISABLED", "Groq assistivo nao esta configurado neste ambiente");
        return;
      }

      const step = req.body?.step && typeof req.body.step === "object" ? req.body.step : {};
      const suggestion = await rewriteCampaignStep({
        campaignName: req.body?.campaignName,
        goal: req.body?.goal,
        style: req.body?.style,
        segmentation: req.body?.segmentation,
        step,
      });

      res.json({
        item: {
          step: {
            ...step,
            text: suggestion.text,
          },
          rationale: suggestion.rationale,
        },
      });
    } catch (error) {
      console.error("campaign ai rewrite step error:", error);
      sendError(res, 502, "GROQ_REQUEST_FAILED", error instanceof Error ? error.message : "Falha ao consultar a Groq");
    }
  });

  app.post("/api/campaigns/direct-dispatch", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;

    const requestId = getRequestId(req);
    res.setHeader("X-Request-Id", requestId);

    const requestedClientId = normalizeString(req.body?.clientId);
    const phone = sanitizePhone(req.body?.phone ?? req.body?.telefone ?? req.body?.number);
    const text = normalizeString(req.body?.text ?? req.body?.message ?? req.body?.txt);
    const imageCaption = normalizeString(req.body?.imageCaption ?? req.body?.caption);
    const imageFirst = req.body?.imageFirst === true || req.body?.imageFirst === "true";
    const image = req.body?.image && typeof req.body.image === "object" ? req.body.image : null;

    if (!requestedClientId) {
      sendError(res, 400, "INVALID_BODY", "Missing clientId", { requestId });
      return;
    }

    if (!phone) {
      sendError(res, 400, "INVALID_BODY", "Missing valid phone", { requestId });
      return;
    }

    if (!text && !image) {
      sendError(res, 400, "INVALID_BODY", "Missing message text or image", { requestId });
      return;
    }

    try {
      logDirectDispatch("info", "request_received", {
        requestId,
        requestedClientId,
        hasText: !!text,
        hasImage: !!image,
        imageFirst,
        phone: maskPhoneForLog(phone),
        userUid: req.authAccess?.uid || null,
      });

      const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
      if (!clientId) return;

      const dispatchSettings = await resolveDispatchWebhookSettings(clientId);
      const { webhookUrl, webhookToken } = dispatchSettings;

      logDirectDispatch("info", "tenant_resolved", {
        requestId,
        requestedClientId,
        resolvedClientId: clientId,
        ...getSafeDispatchSettingsLog(dispatchSettings),
      });

      if (!webhookUrl) {
        const details = {
          requestId,
          clientId,
          settingsSource: dispatchSettings.source,
          schemaAvailable: dispatchSettings.schemaAvailable !== false,
        };

        if (dispatchSettings.source === "schema_missing") {
          logDirectDispatch("error", "settings_schema_missing", details);
          sendError(
            res,
            503,
            "EVOLUTION_SETTINGS_SCHEMA_MISSING",
            "A tabela de configuracao de disparo por empresa nao esta aplicada neste ambiente.",
            details
          );
          return;
        }

        if (dispatchSettings.source === "env_invalid") {
          logDirectDispatch("error", "settings_env_invalid", details);
          sendError(
            res,
            500,
            "EVOLUTION_SETTINGS_INVALID",
            "A URL de disparo configurada para esta empresa e invalida.",
            details
          );
          return;
        }

        logDirectDispatch("warn", "settings_missing", details);
        sendError(
          res,
          400,
          "EVOLUTION_SETTINGS_MISSING",
          "Configure uma URL ativa de disparo Evolution para esta empresa",
          details
        );
        return;
      }

      const clientName = await getClientName(clientId);
      const textStep = text
        ? {
          id: "direct-text",
          type: "text",
          order: 1,
          text,
          enabled: true,
          delayAfterSeconds: image ? 1 : 0,
        }
        : null;
      const imageStep = image
        ? {
          id: "direct-image",
          type: "image",
          order: 1,
          text: imageCaption,
          image,
          enabled: true,
          delayAfterSeconds: 0,
        }
        : null;
      const sequence = imageFirst
        ? [imageStep, textStep].filter(Boolean).map((step, index) => ({ ...step, order: index + 1 }))
        : [textStep, imageStep].filter(Boolean).map((step, index) => ({ ...step, order: index + 1 }));

      await checkEvolutionInstanceHealth({
        webhookUrl,
        webhookToken,
        context: {
          requestId,
          clientId,
          mode: "direct_dispatch",
        },
      });

      logDirectDispatch("info", "dispatch_started", {
        requestId,
        clientId,
        steps: sequence.map((step) => ({ id: step.id, type: step.type, order: step.order })),
        settingsSource: dispatchSettings.source,
      });

      const { summary } = await dispatchCampaignSequence({
        webhookUrl,
        webhookToken,
        leads: [{ telefone: phone }],
        analyticsMeta: {
          sequence,
          dispatchOptions: {
            leadDelaySeconds: 0,
            stopOnStepFailure: true,
            aiAssisted: false,
          },
        },
        context: {
          campaign: {
            id: null,
            name: "Disparo direto",
            mode: "direct_dispatch",
            requestId,
            requestedAt: new Date().toISOString(),
            requestedBy: {
              uid: req.authAccess?.uid || null,
              email: req.authAccess?.email || null,
            },
          },
          client: { id: clientId, name: clientName },
        },
      });

      logDirectDispatch(summary.successCount > 0 ? "info" : "warn", "dispatch_finished", {
        requestId,
        clientId,
        successCount: summary.successCount,
        failureCount: summary.failureCount,
        completedCampaign: summary.completedCampaign,
        firstFailure: summary.failures[0]
          ? {
            stepType: summary.failures[0].stepType,
            reason: summary.failures[0].reason,
          }
          : null,
      });

      if (summary.successCount <= 0) {
        const firstReason = summary.failures[0]?.reason;
        sendError(
          res,
          502,
          "EVOLUTION_DISPATCH_NO_SUCCESS",
          firstReason ? `Falha no envio Evolution: ${firstReason}` : "Nenhuma mensagem foi aceita pelo provedor de disparo.",
          {
            requestId,
            failureCount: summary.failureCount,
            failures: summary.failures,
            settingsSource: dispatchSettings.source,
          }
        );
        return;
      }

      res.json({
        success: summary.successCount > 0,
        provider: "evolution",
        phone,
        requestId,
        settingsSource: dispatchSettings.source,
        successCount: summary.successCount,
        failureCount: summary.failureCount,
        successPhones: summary.successPhones,
        failures: summary.failures,
        completedCampaign: summary.completedCampaign,
      });
    } catch (error) {
      logDirectDispatch("error", "unexpected_error", {
        requestId,
        error: error instanceof Error ? error.message : "unknown error",
        stack: isProduction ? undefined : error?.stack,
      });
      sendError(
        res,
        500,
        "EVOLUTION_DIRECT_DISPATCH_FAILED",
        error instanceof Error ? error.message : "Falha no disparo direto",
        { requestId }
      );
    }
  });

  app.get("/api/campaigns", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveRequiredAuthorizedClientId({
      req,
      res,
      requestedClientId,
      resolveAuthorizedClientId,
      sendError,
    });
    if (!clientId) return;

    try {
      const campaignSelect =
        "id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, starts_at, ends_at, chatbot_prompt_type, mode, campaign_prompt_id, last_triggered_at, archived_at, created_by_uid, created_by_email, created_at, analytics_meta";
      const fallbackCampaignSelect =
        "id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email, created_at";
      let query = supabase
        .from("campaigns")
        .select(campaignSelect)
        .is("archived_at", null)
        .order("created_at", { ascending: false });

      if (clientId) {
        query = query.eq("client_id", clientId);
      }

      let { data, error } = await query;

      if (error) {
        let fallbackQuery = supabase
          .from("campaigns")
          .select(fallbackCampaignSelect)
          .is("archived_at", null)
          .order("created_at", { ascending: false });
        if (clientId) {
          fallbackQuery = fallbackQuery.eq("client_id", clientId);
        }
        const fallback = await fallbackQuery;
        data = fallback.data;
        error = fallback.error;
        if (error) {
          sendError(res, 500, "CAMPAIGNS_FETCH_FAILED", "Failed to fetch campaigns", error.message);
          return;
        }
      }

      // Fetch client names separately (no FK declared in schema cache)
      const clientIds = [...new Set((data || []).map((r) => r.client_id).filter(Boolean))];
      let clientNameMap = {};
      if (clientIds.length > 0) {
        const { data: clients } = await supabase
          .from("leads_clients")
          .select("id, name")
          .in("id", clientIds);
        (clients || []).forEach((c) => { clientNameMap[c.id] = c.name; });
      }

      const items = (data || []).map((row) => ({
        ...row,
        analytics_meta: normalizeCampaignAnalyticsMeta(row.analytics_meta || {}),
        client_name: clientNameMap[row.client_id] ?? null,
        webhook_token: row.webhook_token ? "***" : null,
      }));

      res.json({ items });
    } catch (error) {
      console.error("campaigns fetch error:", error);
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
    }
  });

  app.get("/api/campaigns/:id/leads", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;

    const id = normalizeString(req.params?.id);
    if (!id) {
      sendError(res, 400, "INVALID_PARAM", "Missing campaign id");
      return;
    }

    try {
      let { data: campaign, error: fetchError } = await supabase
        .from("campaigns")
        .select("id, client_id, import_id, limit_per_run, phones, analytics_meta")
        .eq("id", id)
        .single();

      if (fetchError && isMissingSchemaError(fetchError)) {
        const fallback = await supabase
          .from("campaigns")
          .select("id, client_id, import_id, limit_per_run, phones")
          .eq("id", id)
          .single();
        campaign = fallback.data;
        fetchError = fallback.error;
      }

      if (fetchError || !campaign) {
        sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        return;
      }

      const authorizedClientId = resolveAuthorizedClientId(req, res, campaign.client_id);
      if (!authorizedClientId) return;

      let items = [];
      const storedPhones = Array.isArray(campaign.phones)
        ? campaign.phones.filter((phone) => typeof phone === "string" && phone.trim())
        : [];

      if (storedPhones.length > 0) {
        const { data: leads, error: leadsError } = await supabase
          .from(leadsTableName(authorizedClientId))
          .select("*")
          .eq("client_id", authorizedClientId)
          .in("telefone", storedPhones)
          .order("data_hora", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false });

        if (leadsError) throw leadsError;
        items = leads || [];
      } else {
        items = await buildDispatchLeads({
          clientId: authorizedClientId,
          importId: campaign.import_id || null,
          limit: campaign.limit_per_run,
          segmentation: campaign.analytics_meta?.segmentation || null,
        });
      }

      res.json({ items });
    } catch (error) {
      console.error("campaign leads error:", error);
      sendError(res, 500, "CAMPAIGN_LEADS_FAILED", "Failed to load campaign leads");
    }
  });

  // POST /api/campaigns — cria campanha
  app.post("/api/campaigns", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;

    const name = normalizeString(req.body?.name);
    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveRequiredAuthorizedClientId({
      req,
      res,
      requestedClientId,
      resolveAuthorizedClientId,
      sendError,
    });
    if (!clientId) return;
    const reqImportId = normalizeString(req.body?.importId) || null;
    const isCrmSource = reqImportId === "__crm__";
    const importId = isCrmSource ? null : reqImportId;
    
    const rawLimit = Number.parseInt(String(req.body?.limitPerRun ?? "50"), 10);
    const limitPerRun = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 500);
    const scheduledFor = normalizeString(req.body?.scheduledFor) || null;
    const analyticsMeta =
      req.body?.analyticsMeta && typeof req.body.analyticsMeta === "object"
        ? req.body.analyticsMeta
        : {};
    
    if (isCrmSource) {
      analyticsMeta.importSource = "__crm__";
    }
    const campaignMessage = normalizeString(analyticsMeta.message);
    const scheduledDate = scheduledFor ? new Date(scheduledFor) : null;
    let lifecycleStatus = scheduledFor ? "scheduled" : "active";
    if (req.body?.status === "draft") {
      lifecycleStatus = "draft";
    }
    const campaignPromptId = normalizeString(req.body?.campaignPromptId) || null;
    if (!["disparo", "agente"].includes(req.body?.mode)) {
      return sendError(res, 400, "INVALID_BODY", "mode é obrigatório e deve ser 'disparo' ou 'agente'");
    }
    const campaignMode = req.body.mode;
    const analyticsMetaWithDispatch = {
      ...analyticsMeta,
      message: campaignMessage,
      dispatch: {
        ...normalizeCampaignAnalyticsMeta(analyticsMeta.dispatch),
        status: lifecycleStatus,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    };

    if (!name) {
      sendError(res, 400, "INVALID_BODY", "Missing name");
      return;
    }

    try {
      const authorizedClientId = resolveAuthorizedClientId(req, res, clientId);
      if (!authorizedClientId) return;

      const validation = validateCampaignAnalyticsMeta(analyticsMeta);
      if (!validation.valid) {
        sendError(res, 400, "INVALID_CAMPAIGN_CONTENT", validation.message);
        return;
      }

      const dispatchSettings = await resolveCampaignDispatchSettings(authorizedClientId, {
        analytics_meta: validation.analyticsMeta,
      });
      const { webhookUrl, webhookToken } = dispatchSettings;
      if (!webhookUrl) {
        sendError(
          res,
          400,
          "EVOLUTION_SETTINGS_MISSING",
          "Configure uma URL ativa de disparo Evolution para esta empresa antes de criar campanhas"
        );
        return;
      }

      await checkEvolutionInstanceHealth({
        webhookUrl,
        webhookToken,
        context: {
          clientId: authorizedClientId,
          campaignName: name,
          mode: "campaign_create",
          ...getSafeDispatchSettingsLog(dispatchSettings),
        },
      });

      let { data, error } = await supabase
        .from("campaigns")
        .insert({
          name,
          client_id: authorizedClientId,
          import_id: importId,
          limit_per_run: limitPerRun,
          scheduled_for: scheduledFor,
          webhook_url: webhookUrl,
          webhook_token: webhookToken,
          status: lifecycleStatus,
          created_by_uid: req.authAccess?.uid || null,
          created_by_email: req.authAccess?.email || null,
          analytics_meta: analyticsMetaWithDispatch,
          campaign_prompt_id: campaignPromptId,
          mode: campaignMode,
        })
        .select("id, name, client_id, import_id, limit_per_run, webhook_url, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email, created_at, analytics_meta, campaign_prompt_id, mode")
        .single();

      if (error) {
        const fallback = await supabase
          .from("campaigns")
          .insert({
            name,
            client_id: authorizedClientId,
            import_id: importId,
            limit_per_run: limitPerRun,
            scheduled_for: scheduledFor,
            webhook_url: webhookUrl,
            webhook_token: webhookToken,
            status: lifecycleStatus,
            created_by_uid: req.authAccess?.uid || null,
            created_by_email: req.authAccess?.email || null,
            mode: campaignMode,
          })
            .select("id, name, client_id, import_id, limit_per_run, webhook_url, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email, created_at, mode")
          .single();
        data = fallback.data;
        error = fallback.error;
        if (error) {
          sendError(res, 500, "CAMPAIGN_CREATE_FAILED", "Failed to create campaign", error.message);
          return;
        }
      }

      res.status(201).json({
        item: {
          ...data,
          analytics_meta: normalizeCampaignAnalyticsMeta(data.analytics_meta || analyticsMetaWithDispatch),
          webhook_token: webhookToken ? "***" : null,
        },
      });
    } catch (error) {
      console.error("[campaigns] Erro ao criar campanha:", error);
      // Erros de checkEvolutionInstanceHealth carregam statusCode e code customizados
      const httpStatus = typeof error?.statusCode === "number" && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;
      const errorCode = error?.code || "INTERNAL_ERROR";
      const errorMessage = httpStatus < 500 ? error.message : "Internal server error";
      sendError(res, httpStatus, errorCode, errorMessage, internalErrorPayloadDetails(error));
    }
  });

  // PATCH /api/campaigns/:id — atualiza campanha
  app.patch("/api/campaigns/:id", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;

    const id = normalizeString(req.params?.id);
    if (!id) { sendError(res, 400, "INVALID_PARAM", "Missing campaign id"); return; }

    const updates = {};
    if (req.body?.name) updates.name = normalizeString(req.body.name);
    if (["active", "paused", "draft", "scheduled", "processing", "sent", "failed", "cancelled"].includes(req.body?.status)) {
      updates.status = req.body.status;
    }
    if (req.body?.limitPerRun) {
      const v = Number.parseInt(String(req.body.limitPerRun), 10);
      if (!Number.isNaN(v) && v > 0) updates.limit_per_run = Math.min(v, 500);
    }
    
    let isCrmSourceUpdate = false;
    if ("importId" in req.body) {
      const reqImportId = normalizeString(req.body?.importId) || null;
      if (reqImportId === "__crm__") {
        updates.import_id = null;
        isCrmSourceUpdate = true;
      } else {
        updates.import_id = reqImportId;
      }
    }
    
    if ("scheduledFor" in req.body) updates.scheduled_for = normalizeString(req.body?.scheduledFor) || null;
    if ("startsAt" in req.body) updates.starts_at = normalizeString(req.body?.startsAt) || null;
    if ("endsAt" in req.body) updates.ends_at = normalizeString(req.body?.endsAt) || null;
    if (req.body?.chatbotPromptType) updates.chatbot_prompt_type = normalizeString(req.body.chatbotPromptType);
    if ("campaignPromptId" in req.body) updates.campaign_prompt_id = normalizeString(req.body.campaignPromptId) || null;
    if (["disparo", "agente"].includes(req.body?.mode)) updates.mode = req.body.mode;
    if (req.body?.archived === true) updates.archived_at = new Date().toISOString();
    if (req.body?.archived === false) updates.archived_at = null;
    if (req.body?.analyticsMeta && typeof req.body.analyticsMeta === "object") {
      const validation = validateCampaignAnalyticsMeta(req.body.analyticsMeta);
      if (!validation.valid) {
        sendError(res, 400, "INVALID_CAMPAIGN_CONTENT", validation.message);
        return;
      }
      updates.analytics_meta = validation.analyticsMeta;
    }

    if (Object.keys(updates).length === 0) {
      sendError(res, 400, "INVALID_BODY", "No valid fields to update");
      return;
    }

    try {
      const { data: current, error: currentError } = await supabase
        .from("campaigns")
        .select("id, client_id, analytics_meta")
        .eq("id", id)
        .single();

      if (currentError || !current) {
        sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        return;
      }

      const authorizedClientId = resolveAuthorizedClientId(req, res, current.client_id);
      if (!authorizedClientId) return;
      
      if (isCrmSourceUpdate || ("importId" in req.body && updates.import_id !== null)) {
         const currentMeta = updates.analytics_meta || current.analytics_meta || {};
         if (isCrmSourceUpdate) {
            currentMeta.importSource = "__crm__";
         } else {
            delete currentMeta.importSource;
         }
         updates.analytics_meta = currentMeta;
      }

      let { data, error } = await supabase
        .from("campaigns")
        .update(updates)
        .eq("id", id)
        .eq("client_id", authorizedClientId)
        .select("id, name, client_id, import_id, limit_per_run, webhook_url, status, scheduled_for, starts_at, ends_at, chatbot_prompt_type, mode, last_triggered_at, archived_at, created_at, analytics_meta")
        .single();

      if (error && updates.analytics_meta && isMissingSchemaError(error)) {
        const fallbackUpdates = { ...updates };
        delete fallbackUpdates.analytics_meta;
        const fallback = await supabase
          .from("campaigns")
          .update(fallbackUpdates)
          .eq("id", id)
          .eq("client_id", authorizedClientId)
          .select("id, name, client_id, import_id, limit_per_run, webhook_url, status, scheduled_for, last_triggered_at, archived_at, created_at")
          .single();
        data = fallback.data ? { ...fallback.data, analytics_meta: updates.analytics_meta } : fallback.data;
        error = fallback.error;
      }

      if (error) {
        sendError(res, 500, "CAMPAIGN_UPDATE_FAILED", "Failed to update campaign", error.message);
        return;
      }

      res.json({
        item: {
          ...data,
          analytics_meta: normalizeCampaignAnalyticsMeta(data.analytics_meta || updates.analytics_meta || {}),
          webhook_token: null,
        },
      });
    } catch (error) {
      console.error("campaign update error:", error);
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
    }
  });

  // DELETE /api/campaigns/:id — exclui campanha
  app.delete("/api/campaigns/:id", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;

    const id = normalizeString(req.params?.id);
    if (!id) { sendError(res, 400, "INVALID_PARAM", "Missing campaign id"); return; }

    try {
      const { data: campaign, error: fetchError } = await supabase
        .from("campaigns")
        .select("id, client_id")
        .eq("id", id)
        .single();

      if (fetchError || !campaign) {
        sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        return;
      }

      const authorizedClientId = resolveAuthorizedClientId(req, res, campaign.client_id);
      if (!authorizedClientId) return;

      const { error } = await supabase
        .from("campaigns")
        .delete()
        .eq("id", id)
        .eq("client_id", authorizedClientId);

      if (error) {
        sendError(res, 500, "CAMPAIGN_DELETE_FAILED", "Failed to delete campaign", error.message);
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error("campaign delete error:", error);
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
    }
  });

  // GET /api/campaigns/consultant-schedules — lista agendas/consultores
  app.get("/api/campaigns/consultant-schedules", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveRequiredAuthorizedClientId({
      req,
      res,
      requestedClientId,
      resolveAuthorizedClientId,
      sendError,
    });
    if (!clientId) return;

    try {
      const { rows } = await pgDatabasePool.query(
        "SELECT id, name, email, phone, scheduling_link, active, created_at, updated_at FROM public.crm_consultant_schedules WHERE client_id = $1 ORDER BY name ASC",
        [clientId]
      );
      res.json({ items: rows });
    } catch (error) {
      console.error("GET consultant-schedules error:", error);
      sendError(res, 500, "DATABASE_ERROR", "Erro ao listar consultores", error.message);
    }
  });

  // POST /api/campaigns/consultant-schedules — cria agenda/consultor
  app.post("/api/campaigns/consultant-schedules", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.body?.clientId || req.query?.clientId);
    const clientId = resolveRequiredAuthorizedClientId({
      req,
      res,
      requestedClientId,
      resolveAuthorizedClientId,
      sendError,
    });
    if (!clientId) return;

    const name = normalizeString(req.body?.name);
    const scheduling_link = normalizeString(req.body?.scheduling_link);
    if (!name || !scheduling_link) {
      sendError(res, 400, "MISSING_FIELDS", "Nome e link de agendamento sao obrigatorios");
      return;
    }

    const email = normalizeString(req.body?.email) || null;
    const phone = normalizeString(req.body?.phone) || null;
    const active = req.body?.active !== false;

    try {
      const { rows } = await pgDatabasePool.query(
        `INSERT INTO public.crm_consultant_schedules (client_id, name, email, phone, scheduling_link, active)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, name, email, phone, scheduling_link, active, created_at, updated_at`,
        [clientId, name, email, phone, scheduling_link, active]
      );
      res.status(201).json({ item: rows[0] });
    } catch (error) {
      console.error("POST consultant-schedules error:", error);
      sendError(res, 500, "DATABASE_ERROR", "Erro ao criar consultor", error.message);
    }
  });

  // PATCH /api/campaigns/consultant-schedules/:id — atualiza agenda/consultor
  app.patch("/api/campaigns/consultant-schedules/:id", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const id = normalizeString(req.params?.id);
    if (!id) {
      sendError(res, 400, "INVALID_PARAM", "Falta o ID do consultor");
      return;
    }

    try {
      // 1. Fetch current schedule to check client_id and authorize
      const checkRes = await pgDatabasePool.query(
        "SELECT client_id FROM public.crm_consultant_schedules WHERE id = $1",
        [id]
      );
      if (checkRes.rows.length === 0) {
        sendError(res, 404, "NOT_FOUND", "Consultor nao encontrado");
        return;
      }

      const authorizedClientId = resolveAuthorizedClientId(req, res, checkRes.rows[0].client_id);
      if (!authorizedClientId) return;

      const updates = [];
      const values = [];
      let valIdx = 1;

      if (req.body?.name !== undefined) {
        updates.push(`name = $${valIdx++}`);
        values.push(normalizeString(req.body.name));
      }
      if (req.body?.scheduling_link !== undefined) {
        updates.push(`scheduling_link = $${valIdx++}`);
        values.push(normalizeString(req.body.scheduling_link));
      }
      if (req.body?.email !== undefined) {
        updates.push(`email = $${valIdx++}`);
        values.push(normalizeString(req.body.email) || null);
      }
      if (req.body?.phone !== undefined) {
        updates.push(`phone = $${valIdx++}`);
        values.push(normalizeString(req.body.phone) || null);
      }
      if (req.body?.active !== undefined) {
        updates.push(`active = $${valIdx++}`);
        values.push(req.body.active === true);
      }

      if (updates.length === 0) {
        sendError(res, 400, "NO_UPDATES", "Nao foram passados campos para atualizacao");
        return;
      }

      values.push(id);
      const updateQuery = `
        UPDATE public.crm_consultant_schedules
        SET ${updates.join(", ")}, updated_at = now()
        WHERE id = $${valIdx}
        RETURNING id, name, email, phone, scheduling_link, active, created_at, updated_at
      `;

      const { rows } = await pgDatabasePool.query(updateQuery, values);
      res.json({ item: rows[0] });
    } catch (error) {
      console.error("PATCH consultant-schedules error:", error);
      sendError(res, 500, "DATABASE_ERROR", "Erro ao atualizar consultor", error.message);
    }
  });

  // DELETE /api/campaigns/consultant-schedules/:id — exclui agenda/consultor
  app.delete("/api/campaigns/consultant-schedules/:id", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const id = normalizeString(req.params?.id);
    if (!id) {
      sendError(res, 400, "INVALID_PARAM", "Falta o ID do consultor");
      return;
    }

    try {
      // 1. Fetch current schedule to check client_id and authorize
      const checkRes = await pgDatabasePool.query(
        "SELECT client_id FROM public.crm_consultant_schedules WHERE id = $1",
        [id]
      );
      if (checkRes.rows.length === 0) {
        sendError(res, 404, "NOT_FOUND", "Consultor nao encontrado");
        return;
      }

      const authorizedClientId = resolveAuthorizedClientId(req, res, checkRes.rows[0].client_id);
      if (!authorizedClientId) return;

      await pgDatabasePool.query(
        "DELETE FROM public.crm_consultant_schedules WHERE id = $1",
        [id]
      );
      res.json({ success: true });
    } catch (error) {
      console.error("DELETE consultant-schedules error:", error);
      sendError(res, 500, "DATABASE_ERROR", "Erro ao deletar consultor", error.message);
    }
  });

  function requireCampaignRunnerSecret(req, res, next) {
    const configuredSecret = normalizeString(process.env.CAMPAIGN_SCHEDULER_TOKEN);

    if (!configuredSecret) {
      sendError(
        res,
        500,
        "CAMPAIGN_SCHEDULER_TOKEN_MISSING",
        "Configure CAMPAIGN_SCHEDULER_TOKEN"
      );
      return;
    }

    const authorization = normalizeString(req.headers.authorization);
    const providedSecret =
      authorization.toLowerCase().startsWith("bearer ")
        ? authorization.slice(7).trim()
        : normalizeString(req.headers["x-campaign-runner-secret"] || req.query?.secret);

    if (providedSecret !== configuredSecret) {
      sendError(res, 401, "UNAUTHORIZED", "Invalid campaign runner secret");
      return;
    }

    next();
  }

  async function runDueIndependentDispatches({ limit = 10 } = {}) {
    if (!supabase) return { success: false, processed: 0, reason: "DATABASE_NOT_CONFIGURED" };
    const now = new Date().toISOString();

    try {
      const { data: dispatches, error: fetchErr } = await supabase
        .from("campaign_dispatches")
        .select("id, campaign_id, client_id, name, steps, trigger_type, scheduled_at, status, evolution_instance_id, limit_per_run, offset")
        .eq("status", "scheduled")
        .lte("scheduled_at", now)
        .order("scheduled_at", { ascending: true })
        .limit(limit);

      if (fetchErr) throw fetchErr;
      if (!dispatches || dispatches.length === 0) {
        return { success: true, processed: 0, items: [] };
      }

      const results = [];
      for (const dispatch of dispatches) {
        try {
          const { data: campaign, error: campErr } = await supabase
            .from("campaigns")
            .select("id, name, client_id, import_id, limit_per_run, analytics_meta, webhook_url, webhook_token")
            .eq("id", dispatch.campaign_id)
            .single();

          if (campErr || !campaign) {
            throw new Error(campErr?.message || "Campaign not found");
          }

          await supabase
            .from("campaign_dispatches")
            .update({
              status: "running",
              triggered_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq("id", dispatch.id);

          await runCampaignDispatch({ dispatch, campaign, supabase });

          results.push({ id: dispatch.id, campaignId: campaign.id, status: "success" });
        } catch (err) {
          console.error(`[campaign-dispatch-scheduler] failed to run dispatch ${dispatch.id}:`, err);
          await supabase
            .from("campaign_dispatches")
            .update({
              status: "failed",
              error_message: err.message,
              finished_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq("id", dispatch.id);

          results.push({ id: dispatch.id, status: "failed", error: err.message });
        }
      }

      return { success: true, processed: results.length, items: results };
    } catch (err) {
      console.error("[campaign-dispatch-scheduler] global check failed:", err);
      return { success: false, error: err.message };
    }
  }

  // Native interval scheduler for scheduled independent dispatches
  if (!_dueDispatchTimerStarted) {
    _dueDispatchTimerStarted = true;
    setInterval(async () => {
      try {
        await runDueIndependentDispatches({ limit: 10 });
      } catch (err) {
        console.error("[campaign-dispatch-scheduler] background tick failed:", err);
      }
    }, 30000); // ticks every 30 seconds
  }

  // POST /api/campaigns/run-due is used by cron/n8n to execute due scheduled campaigns.
  app.post("/api/campaigns/run-due", requireCampaignRunnerSecret, async (req, res) => {
    if (!ensureDb(res)) return;

    const rawLimit = Number.parseInt(String(req.body?.limit ?? req.query?.limit ?? ""), 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), CAMPAIGN_SCHEDULER_MAX_BATCH)
      : CAMPAIGN_SCHEDULER_MAX_BATCH;

    try {
      const result = await runDueCampaignDispatches({ limit, triggerSource: "external_runner" });
      const dispatchResult = await runDueIndependentDispatches({ limit });
      res.json({ campaigns: result, independentDispatches: dispatchResult });
    } catch (error) {
      console.error("campaign run-due error:", error);
      sendError(
        res,
        500,
        "CAMPAIGN_RUN_DUE_FAILED",
        error instanceof Error ? error.message : "Failed to run due campaigns"
      );
    }
  });

  // POST /api/campaigns/:id/trigger — dispara campanha (chama webhook n8n)
  app.post("/api/campaigns/:id/trigger", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;

    const id = normalizeString(req.params?.id);
    if (!id) { sendError(res, 400, "INVALID_PARAM", "Missing campaign id"); return; }

    try {
      let { data: campaign, error: fetchError } = await supabase
        .from("campaigns")
        .select("id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, archived_at, created_by_uid, created_by_email, analytics_meta")
        .eq("id", id)
        .single();

      if (fetchError && isMissingSchemaError(fetchError)) {
        const fallback = await supabase
          .from("campaigns")
          .select("id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, archived_at, created_by_uid, created_by_email")
          .eq("id", id)
          .single();
        campaign = fallback.data;
        fetchError = fallback.error;
      }

      if (fetchError || !campaign) {
        sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        return;
      }

      const authorizedClientId = resolveAuthorizedClientId(req, res, campaign.client_id);
      if (!authorizedClientId) return;

      if (!canCampaignBeDispatched(campaign.status)) {
        sendError(res, 400, "CAMPAIGN_NOT_DISPATCHABLE", `Campaign cannot be dispatched from status ${campaign.status}`);
        return;
      }
      if (campaign.archived_at) {
        sendError(res, 400, "CAMPAIGN_ARCHIVED", "Campaign is archived");
        return;
      }

      const result = await executeCampaignDispatch({ ...campaign, client_id: authorizedClientId }, { triggerSource: "manual" });
      res.json(result);
    } catch (error) {
      console.error("campaign trigger error:", error);
      if (error?.name === "AbortError") {
        sendError(res, 504, "N8N_TIMEOUT", "n8n webhook timed out (20s)");
        return;
      }
      sendError(
        res,
        error?.statusCode || 500,
        error?.code || "INTERNAL_ERROR",
        error instanceof Error ? error.message : "Internal server error"
      );
    }
  });

  // ── Campaign Dispatches ──────────────────────────────────────────────────────

  async function ensureCampaignDispatchPausedStatusAllowed() {
    if (!pgDatabasePool) return;

    await pgDatabasePool.query(`
      ALTER TABLE public.campaign_dispatches
      DROP CONSTRAINT IF EXISTS campaign_dispatches_status_check
    `);
    await pgDatabasePool.query(`
      ALTER TABLE public.campaign_dispatches
      ADD CONSTRAINT campaign_dispatches_status_check
      CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'done', 'failed', 'cancelled'))
    `);
  }

  async function ensureCampaignDispatchEvolutionInstanceColumn() {
    if (!pgDatabasePool) return;

    await pgDatabasePool.query(`
      ALTER TABLE public.campaign_dispatches
      ADD COLUMN IF NOT EXISTS evolution_instance_id UUID,
      ADD COLUMN IF NOT EXISTS target_count INTEGER DEFAULT 0
    `);
  }

  async function validateCampaignDispatchEvolutionInstance(clientId, instanceId, res) {
    if (!instanceId) return true;

    const instances = await getLeadClientEvolutionInstances(clientId);
    const instance = instances.find((item) => item.id === instanceId);
    if (!instance) {
      sendError(res, 400, "EVOLUTION_INSTANCE_NOT_FOUND", "Evolution instance not found for this tenant");
      return false;
    }
    if (instance.active === false) {
      sendError(res, 400, "EVOLUTION_INSTANCE_INACTIVE", "Evolution instance is inactive");
      return false;
    }

    return true;
  }

  // ── Anti-ban (Fatia 3a): cota diária por chip ───────────────────────────────
  const EVOLUTION_CHIP_DAILY_QUOTA_DEFAULTS = { cold: 100, warm: 500 };

  async function ensureEvolutionInstanceDailyUsageTable() {
    if (!pgDatabasePool) return false;
    if (_evolutionDailyUsageSchemaEnsured) return true;
    await pgDatabasePool.query(`
      CREATE TABLE IF NOT EXISTS public.evolution_instance_daily_usage (
        instance_id UUID NOT NULL REFERENCES public.lead_client_evolution_instances(id) ON DELETE CASCADE,
        date DATE NOT NULL,
        sent_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (instance_id, date)
      )
    `);
    _evolutionDailyUsageSchemaEnsured = true;
    return true;
  }

  function resolveEvolutionInstanceDailyLimit(instance) {
    const override = Number.parseInt(String(instance?.daily_limit_override ?? ""), 10);
    if (Number.isInteger(override) && override > 0) return override;
    const state = normalizeString(instance?.chip_state) === "warm" ? "warm" : "cold";
    return EVOLUTION_CHIP_DAILY_QUOTA_DEFAULTS[state];
  }

  async function reserveEvolutionInstanceDailyQuota(instanceId) {
    if (!instanceId || !(await ensureEvolutionInstanceDailyUsageTable())) return null;
    const { rows } = await pgDatabasePool.query(
      `
        INSERT INTO public.evolution_instance_daily_usage (instance_id, date, sent_count)
        VALUES ($1, CURRENT_DATE, 1)
        ON CONFLICT (instance_id, date)
        DO UPDATE SET sent_count = public.evolution_instance_daily_usage.sent_count + 1
        RETURNING sent_count
      `,
      [instanceId]
    );
    return rows[0]?.sent_count ?? null;
  }

  async function releaseEvolutionInstanceDailyQuota(instanceId) {
    if (!instanceId || !pgDatabasePool) return;
    await pgDatabasePool
      .query(
        `
          UPDATE public.evolution_instance_daily_usage
          SET sent_count = GREATEST(sent_count - 1, 0)
          WHERE instance_id = $1 AND date = CURRENT_DATE
        `,
        [instanceId]
      )
      .catch(() => {});
  }
  // ────────────────────────────────────────────────────────────────────────────

  // ── Defeito A: elegibilidade idempotente por disparo ────────────────────────
  // Estende campaign_dispatch_runs (tabela equivalente já existente) com claim por
  // lead. Memoizado: ALTER/CREATE rodam UMA vez por processo, nunca no caminho
  // quente (lição da Fatia 3a: ALTER TABLE pega ACCESS EXCLUSIVE mesmo em no-op).
  async function ensureDispatchRunsClaimSchema() {
    if (!pgDatabasePool) return false;
    if (_dispatchRunsClaimSchemaEnsured) return true;
    await pgDatabasePool.query(
      `ALTER TABLE public.campaign_dispatch_runs ADD COLUMN IF NOT EXISTS lead_id UUID`
    );
    await pgDatabasePool.query(
      `ALTER TABLE public.campaign_dispatch_runs ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMPTZ`
    );
    await pgDatabasePool.query(
      `ALTER TABLE public.campaign_dispatch_runs DROP CONSTRAINT IF EXISTS campaign_dispatch_runs_status_check`
    );
    await pgDatabasePool.query(
      `ALTER TABLE public.campaign_dispatch_runs ADD CONSTRAINT campaign_dispatch_runs_status_check CHECK (status IN ('pending','claimed','sent','failed','skipped'))`
    );
    await pgDatabasePool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_dispatch_runs_dispatch_lead ON public.campaign_dispatch_runs (dispatch_id, lead_id)`
    );
    await pgDatabasePool.query(
      `CREATE INDEX IF NOT EXISTS idx_campaign_dispatch_runs_dispatch_status ON public.campaign_dispatch_runs (dispatch_id, status)`
    );
    _dispatchRunsClaimSchemaEnsured = true;
    return true;
  }
  // ────────────────────────────────────────────────────────────────────────────

  async function runCampaignDispatch({ dispatch, campaign, supabase: db }) {
    const dispatchId = dispatch.id;
    const clientId = campaign.client_id;
    const dispatchSteps = Array.isArray(dispatch.steps) && dispatch.steps.length > 0 ? dispatch.steps : null;
    const campaignMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
    const dispatchEvolutionInstanceId = normalizeString(dispatch.evolution_instance_id);
    const dispatchCampaignMeta = dispatchEvolutionInstanceId
      ? {
          ...campaignMeta,
          dispatchOptions: {
            ...campaignMeta.dispatchOptions,
            evolutionInstanceId: dispatchEvolutionInstanceId,
          },
        }
      : campaignMeta;
    const steps = dispatchSteps ?? campaignMeta.sequence;
    const validation = validateCampaignAnalyticsMeta({
      ...campaignMeta,
      sequence: steps,
    });
    if (!validation.valid) {
      throw new Error(validation.message || "Disparo sem template valido.");
    }
    const dispatchSettings = await resolveCampaignDispatchSettings(clientId, {
      ...campaign,
      analytics_meta: dispatchCampaignMeta,
    });
    const { webhookUrl, webhookToken } = dispatchSettings;
    if (!webhookUrl) {
      throw new Error("Configure uma URL ativa de disparo Evolution para esta empresa");
    }

    // Defeito A: garante o schema de claim (idempotência por disparo) antes de montar a fila.
    await ensureDispatchRunsClaimSchema();

    // Obtém lista de leads da campanha via lead_import_items.
    // excludeDispatchId remove da fila todo lead que JÁ tem registro neste disparo
    // (claimed/sent/failed) → segunda execução do mesmo disparo traz 0 leads.
    const leads = await buildDispatchLeads({
      clientId,
      importId: campaign.import_id || null,
      limit: dispatch.limit_per_run ?? campaign.limit_per_run,
      offset: dispatch.offset ?? 0,
      segmentation: validation.analyticsMeta.segmentation || null,
      excludeDispatchId: dispatchId,
    });

    if (leads.length === 0) {
      await db.from("campaign_dispatches").update({ status: "done", finished_at: new Date().toISOString(), updated_at: new Date().toISOString(), error_message: "Nenhum lead encontrado para o disparo." }).eq("id", dispatchId);
      return;
    }

    // Apply database Round-Robin scheduling links to leads if they don't have one
    try {
      const consultantRes = await pgDatabasePool.query(
        "SELECT scheduling_link FROM public.crm_consultant_schedules WHERE client_id = $1 AND active = true ORDER BY name ASC",
        [clientId]
      );
      const activeConsultantLinks = consultantRes.rows.map(r => r.scheduling_link);
      if (activeConsultantLinks.length > 0) {
        leads.forEach((lead, idx) => {
          if (!lead.normalized_data) {
            lead.normalized_data = {};
          }
          if (!lead.normalized_data.scheduling_link) {
            lead.normalized_data.scheduling_link = activeConsultantLinks[idx % activeConsultantLinks.length];
          }
        });
      }
    } catch (dbErr) {
      console.warn("[campaign-dispatch] failed to apply consultant schedules to leads:", dbErr.message);
    }

    // Constrói analyticsMeta compatível com dispatchCampaignSequence
    const analyticsMeta = validation.analyticsMeta;

    // Anti-ban: pool de chips para rotação round-robin com cota diária.
    const tenantInstances = await getLeadClientEvolutionInstances(clientId);
    const activeInstances = tenantInstances.filter(
      (inst) => inst.active !== false && normalizeString(inst.dispatch_webhook_url)
    );
    const rotationPool = dispatchEvolutionInstanceId
      ? activeInstances.filter((inst) => inst.id === dispatchEvolutionInstanceId)
      : activeInstances;

    let rotationCursor = 0;
    const chipProvider =
      rotationPool.length > 0
        ? async () => {
            for (let attempt = 0; attempt < rotationPool.length; attempt += 1) {
              const inst = rotationPool[(rotationCursor + attempt) % rotationPool.length];
              const limit = resolveEvolutionInstanceDailyLimit(inst);
              const reserved = await reserveEvolutionInstanceDailyQuota(inst.id);

              if (reserved === null) {
                rotationCursor = (rotationCursor + attempt + 1) % rotationPool.length;
                return {
                  webhookUrl: normalizeString(inst.dispatch_webhook_url),
                  webhookToken: normalizeString(inst.dispatch_webhook_token) || null,
                  instanceId: inst.id,
                  release: null,
                };
              }

              if (reserved > limit) {
                await releaseEvolutionInstanceDailyQuota(inst.id);
                continue;
              }

              rotationCursor = (rotationCursor + attempt + 1) % rotationPool.length;
              return {
                webhookUrl: normalizeString(inst.dispatch_webhook_url),
                webhookToken: normalizeString(inst.dispatch_webhook_token) || null,
                instanceId: inst.id,
                release: () => releaseEvolutionInstanceDailyQuota(inst.id),
              };
            }
            return null;
          }
        : null;

    const checkOptout = async ({ phone }) => {
      if (!pgDatabasePool || !phone) return false;
      const { rows } = await pgDatabasePool.query(
        `SELECT id FROM public.lead_optouts WHERE client_id = $1 AND phone = $2 LIMIT 1`,
        [clientId, phone]
      );
      return rows.length > 0;
    };

    // Defeito A: claim idempotente por lead. INSERT ... ON CONFLICT DO NOTHING marca o
    // lead como 'claimed' ANTES do envio. Se a linha não foi inserida (conflito), o lead
    // já foi tocado neste disparo → pular (evita duplicidade mesmo em retomada/concorrência).
    const claimLead = async ({ lead, phone }) => {
      if (!pgDatabasePool || !lead?.id) return true; // sem lead_id não há como garantir idempotência → permite (legado)
      const { rows } = await pgDatabasePool.query(
        `
          INSERT INTO public.campaign_dispatch_runs
            (dispatch_id, campaign_id, client_id, lead_id, phone, status, claimed_at, created_at)
          VALUES ($1, $2, $3, $4, $5, 'claimed', now(), now())
          ON CONFLICT (dispatch_id, lead_id) DO NOTHING
          RETURNING id
        `,
        [dispatchId, campaign.id, clientId, lead.id, phone || ""]
      );
      return rows.length > 0;
    };

    const finalizeLeadSent = async ({ lead, sentAt }) => {
      if (!pgDatabasePool || !lead?.id) return;
      await pgDatabasePool
        .query(
          `UPDATE public.campaign_dispatch_runs SET status = 'sent', sent_at = $1 WHERE dispatch_id = $2 AND lead_id = $3`,
          [sentAt || new Date().toISOString(), dispatchId, lead.id]
        )
        .catch((err) => {
          console.warn("[campaign-dispatch] finalize_sent_failed:", err?.message || err);
        });
    };

    const finalizeLeadFailed = async ({ lead, reason }) => {
      if (!pgDatabasePool || !lead?.id) return;
      await pgDatabasePool
        .query(
          `UPDATE public.campaign_dispatch_runs SET status = 'failed', error_message = $1 WHERE dispatch_id = $2 AND lead_id = $3`,
          [reason || null, dispatchId, lead.id]
        )
        .catch((err) => {
          console.warn("[campaign-dispatch] finalize_failed_failed:", err?.message || err);
        });
    };

    let sentCount = 0;
    let lastPauseCheckAt = 0;

    const isDispatchStillRunning = async () => {
      const now = Date.now();
      if (now - lastPauseCheckAt < 1000) return true;
      lastPauseCheckAt = now;

      const { data: current, error: currentError } = await db
        .from("campaign_dispatches")
        .select("status")
        .eq("id", dispatchId)
        .maybeSingle();

      if (currentError) {
        console.warn("[campaign-dispatch] pause status check failed:", currentError.message || currentError);
        return true;
      }

      return current?.status === "running";
    };

    const result = await dispatchCampaignSequence({
      webhookUrl,
      webhookToken,
      leads,
      analyticsMeta,
      context: {
        campaign: {
          id: campaign.id,
          name: campaign.name,
          mode: "campaign_dispatch_template",
          dispatchId,
          dispatchName: dispatch.name,
        },
        client: { id: clientId, name: await getClientName(clientId) },
      },
      onLeadClaim: claimLead,
      onLeadFailed: async ({ lead, reason }) => {
        await finalizeLeadFailed({ lead, reason });
      },
      onLeadDispatched: async ({ lead, phone, sentAt }) => {
        sentCount += 1;
        // Finaliza o registro de claim deste lead como 'sent' (UPDATE da linha já reservada).
        await finalizeLeadSent({ lead, sentAt });
        const leadPatch = {
          // "aguardando_usuario": pós-disparo, esperando o lead responder. Valor permitido
          // pela CHECK lead_import_items_status_conversa_check (aguardando_usuario|
          // em_atendimento|finalizado). O sinal de fila de follow-up é followup_status,
          // não status_conversa. (Antes gravava "campanha_enviada", fora da CHECK → erro.)
          status_conversa: "aguardando_usuario",
          ultima_interacao_bot: sentAt || new Date().toISOString(),
          followup_status: "pending",
          followup_scheduled_at: null,
        };
        const leadUpdate = lead?.id
          ? db
            .from("lead_import_items")
            .update(leadPatch)
            .eq("id", lead.id)
            .eq("client_id", clientId)
          : db
            .from("lead_import_items")
            .update(leadPatch)
            .eq("client_id", clientId)
            .eq("telefone", phone);
        const { error: leadUpdateError } = await leadUpdate;
        if (leadUpdateError) {
          console.warn("[campaign-dispatch] followup queue marker failed:", leadUpdateError.message || leadUpdateError);
        }
        await db.from("campaign_dispatches").update({ sent_count: sentCount, updated_at: new Date().toISOString() }).eq("id", dispatchId).catch(() => {});
      },
      shouldContinue: isDispatchStillRunning,
      chipProvider,
      leadDelayProvider: () => 30_000 + Math.floor(Math.random() * 60_001),
    });

    // Falhas por lead já são finalizadas em tempo real via onLeadFailed (UPDATE do
    // registro de claim para status='failed'). Lead que falhou NÃO volta para a fila
    // do mesmo disparo — fica registrado para tratamento manual (endpoint /failed).
    const failedCount = result?.summary?.failureCount ?? (leads.length - sentCount);

    if (result?.summary?.allChipsExhausted) {
      await db.from("campaign_dispatches").update({
        status: "paused",
        sent_count: sentCount,
        failed_count: failedCount,
        error_message: "Cota diaria atingida em todos os chips ativos.",
        updated_at: new Date().toISOString(),
      }).eq("id", dispatchId);
      return;
    }

    if (result?.summary?.paused) {
      await db.from("campaign_dispatches").update({
        status: "paused",
        sent_count: sentCount,
        failed_count: failedCount,
        error_message: "Disparo pausado manualmente.",
        updated_at: new Date().toISOString(),
      }).eq("id", dispatchId);
      return;
    }

    await db.from("campaign_dispatches").update({
      status: "done",
      sent_count: sentCount,
      failed_count: failedCount,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", dispatchId);
  }

  // ── Campaign Dispatches CRUD ─────────────────────────────────────────────────

  // GET /api/dispatches — lista todos os disparos de um tenant (todas as campanhas)
  app.get("/api/dispatches", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.query.clientId);
    if (!requestedClientId) return sendError(res, 400, "MISSING_CLIENT_ID", "Missing clientId query param");

    const authorizedClientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!authorizedClientId) return;

    try {
      await ensureCampaignDispatchEvolutionInstanceColumn();
      if (!pgDatabasePool) return sendError(res, 503, "DB_UNAVAILABLE", "Database unavailable");
      const { rows } = await pgDatabasePool.query(
        `
          SELECT d.*, c.name as campaign_name
          FROM public.campaign_dispatches d
          LEFT JOIN public.campaigns c ON c.id = d.campaign_id
          WHERE d.client_id = $1
          ORDER BY d.created_at DESC
        `,
        [authorizedClientId]
      );
      res.json({ dispatches: rows });
    } catch (err) {
      sendError(res, 500, "DISPATCHES_FETCH_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // GET /api/campaigns/:id/dispatches — lista disparos de uma campanha
  app.get("/api/campaigns/:id/dispatches", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const campaignId = normalizeString(req.params.id);
    if (!campaignId) return sendError(res, 400, "MISSING_ID", "Missing campaign id");
    try {
      await ensureCampaignDispatchEvolutionInstanceColumn();
      const { data: campaign, error: campaignErr } = await supabase
        .from("campaigns")
        .select("id, client_id")
        .eq("id", campaignId)
        .single();
      if (campaignErr || !campaign) return sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
      const authorizedClientId = resolveAuthorizedClientId(req, res, campaign.client_id);
      if (!authorizedClientId) return;

      const { data, error } = await supabase
        .from("campaign_dispatches")
        .select("*")
        .eq("campaign_id", campaignId)
        .eq("client_id", authorizedClientId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      res.json({ dispatches: data || [] });
    } catch (err) {
      sendError(res, 500, "DISPATCHES_FETCH_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // GET /api/campaigns/dispatches/:dispatchId/preview-leads — Retorna amostra de leads que um dispatch deve atingir
  app.get("/api/campaigns/dispatches/:dispatchId/preview-leads", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const dispatchId = normalizeString(req.params.dispatchId);
    if (!dispatchId) return sendError(res, 400, "MISSING_ID", "Missing dispatch id");

    try {
      const { data: dispatch, error: dispatchErr } = await supabase
        .from("campaign_dispatches")
        .select("id, campaign_id, client_id, limit_per_run, offset, steps")
        .eq("id", dispatchId)
        .single();

      if (dispatchErr || !dispatch) return sendError(res, 404, "DISPATCH_NOT_FOUND", "Dispatch not found");

      const authorizedClientId = resolveAuthorizedClientId(req, res, dispatch.client_id);
      if (!authorizedClientId) return;

      const { data: campaign, error: campaignErr } = await supabase
        .from("campaigns")
        .select("import_id")
        .eq("id", dispatch.campaign_id)
        .single();

      if (campaignErr || !campaign) return sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");

      const previewLeads = await buildDispatchLeads({
        clientId: authorizedClientId,
        importId: campaign.import_id,
        limit: dispatch.limit_per_run,
        offset: dispatch.offset,
        segmentation: dispatch.steps?.[0]?.segmentation || null,
        excludeDispatchId: null,
      });

      // Retorna no max 100 itens p/ preview, mas informa total no targetCount (caso n estivesse na table)
      res.json({
        leads: previewLeads.slice(0, 100).map(l => ({ nome: l.nome, telefone: l.telefone })),
        total: previewLeads.length
      });
    } catch (err) {
      sendError(res, 500, "DISPATCH_PREVIEW_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // GET /api/campaigns/dispatches/:dispatchId/failed — leads falhados do disparo,
  // exportável para planilha (?format=csv). Defeito A: failed sai do reprocesso e
  // fica disponível para tratamento/exclusão manual.
  app.get("/api/campaigns/dispatches/:dispatchId/failed", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const dispatchId = normalizeString(req.params.dispatchId);
    if (!dispatchId) return sendError(res, 400, "MISSING_ID", "Missing dispatch id");
    try {
      const { data: dispatch, error: dispatchErr } = await supabase
        .from("campaign_dispatches")
        .select("id, client_id, campaign_id, name")
        .eq("id", dispatchId)
        .maybeSingle();
      if (dispatchErr || !dispatch) return sendError(res, 404, "DISPATCH_NOT_FOUND", "Dispatch not found");
      const authorizedClientId = resolveAuthorizedClientId(req, res, dispatch.client_id);
      if (!authorizedClientId) return;

      const { data, error } = await supabase
        .from("campaign_dispatch_runs")
        .select("dispatch_id, lead_id, phone, status, error_message, claimed_at, sent_at, created_at")
        .eq("dispatch_id", dispatchId)
        .eq("status", "failed")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = data || [];

      if (normalizeString(req.query.format).toLowerCase() === "csv") {
        const header = ["dispatch_id", "lead_id", "telefone", "status", "error_message", "claimed_at", "sent_at", "created_at"];
        const esc = (v) => {
          const s = v == null ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [header.join(",")];
        for (const r of rows) {
          lines.push([r.dispatch_id, r.lead_id, r.phone, r.status, r.error_message, r.claimed_at, r.sent_at, r.created_at].map(esc).join(","));
        }
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="disparo-${dispatchId}-falhados.csv"`);
        return res.send(lines.join("\n"));
      }

      res.json({ dispatchId, dispatchName: dispatch.name, failedCount: rows.length, items: rows });
    } catch (err) {
      sendError(res, 500, "DISPATCH_FAILED_EXPORT_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // GET /api/campaigns/reports/import-audit — Relatório de auditoria de leads da planilha
  app.get("/api/campaigns/reports/import-audit", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.query.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const importId = normalizeString(req.query.importId);
    if (!importId) {
      return sendError(res, 400, "MISSING_IMPORT_ID", "Missing importId query parameter");
    }

    try {
      const { data: importRec, error: importErr } = await supabase
        .from("lead_imports")
        .select("id, client_id, source_name, created_at")
        .eq("id", importId)
        .eq("client_id", clientId)
        .maybeSingle();

      if (importErr || !importRec) {
        return sendError(res, 404, "IMPORT_NOT_FOUND", "Import not found or unauthorized");
      }

      const sql = `
        SELECT
          lii.id AS lead_import_item_id,
          lii.import_id,
          lii.telefone,
          lii.normalized_data,
          lii.created_at AS imported_at,
          lii.row_number,
          lii.imported,
          lii.skip_reason,
          (
            SELECT count(*)::int
            FROM public.campaign_dispatch_runs
            WHERE lead_id = lii.id
          ) AS dispatch_count,
          (
            SELECT max(sent_at)
            FROM public.campaign_dispatch_runs
            WHERE lead_id = lii.id
          ) AS last_sent_at,
          (
            SELECT max(created_at)
            FROM public.campaign_dispatch_runs
            WHERE lead_id = lii.id
          ) AS last_attempt_at,
          (
            SELECT status
            FROM public.campaign_dispatch_runs
            WHERE lead_id = lii.id
            ORDER BY created_at DESC
            LIMIT 1
          ) AS last_status,
          (
            SELECT error_message
            FROM public.campaign_dispatch_runs
            WHERE lead_id = lii.id
            ORDER BY created_at DESC
            LIMIT 1
          ) AS last_error_message,
          EXISTS (
            SELECT 1
            FROM public.lead_messages lm
            WHERE (lm.lead_id = lii.lead_id OR lm.phone = lii.telefone)
              AND (lm.direction = 'inbound' OR lm.engagement_signal = 'reply')
              AND lm.client_id = $1
          ) AS has_replied
        FROM public.lead_import_items lii
        WHERE lii.client_id = $1
          AND lii.import_id = $2
        ORDER BY lii.row_number ASC
      `;

      const result = await pgDatabasePool.query(sql, [clientId, importId]);
      res.json({
        import: importRec,
        items: result.rows || []
      });
    } catch (err) {
      console.error("[import-audit] error:", err);
      sendError(res, 500, "IMPORT_AUDIT_FAILED", err instanceof Error ? err.message : "Failed to load audit report");
    }
  });

  // POST /api/campaigns/reports/create-import-from-subset — Cria nova base de importação a partir de um subconjunto
  app.post("/api/campaigns/reports/create-import-from-subset", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const sourceName = normalizeString(req.body?.sourceName) || "Recampanha";
    const leadImportItemIds = Array.isArray(req.body?.leadImportItemIds) ? req.body.leadImportItemIds : [];

    if (leadImportItemIds.length === 0) {
      return sendError(res, 400, "MISSING_ITEMS", "No lead items selected");
    }

    try {
      const { data: originalItems, error: itemsErr } = await supabase
        .from("lead_import_items")
        .select("id, client_id, telefone, lead_id, imported, skip_reason, raw_data, normalized_data")
        .eq("client_id", clientId)
        .in("id", leadImportItemIds);

      if (itemsErr || !originalItems || originalItems.length === 0) {
        return sendError(res, 400, "ITEMS_NOT_FOUND", "No valid original lead items found");
      }

      const validRows = originalItems.filter(item => item.imported);
      const skippedRows = originalItems.length - validRows.length;

      const { data: importRecord, error: importError } = await supabase
        .from("lead_imports")
        .insert({
          client_id: clientId,
          source_name: sourceName,
          source_type: "segmentation_campaign",
          total_rows: originalItems.length,
          imported_rows: validRows.length,
          skipped_rows: skippedRows,
          uploaded_by_uid: req.authAccess?.uid || null,
          uploaded_by_email: req.authAccess?.email || null,
        })
        .select("id, client_id, source_name, created_at")
        .single();

      if (importError) throw importError;

      const newImportItems = originalItems.map((item, index) => ({
        import_id: importRecord.id,
        client_id: clientId,
        row_number: index + 2,
        telefone: item.telefone,
        lead_id: item.lead_id || null,
        imported: item.imported,
        skip_reason: item.skip_reason,
        raw_data: item.raw_data,
        normalized_data: item.normalized_data,
      }));

      const { error: insertItemsError } = await supabase
        .from("lead_import_items").insert(newImportItems);

      if (insertItemsError) throw insertItemsError;

      res.status(201).json({
        success: true,
        item: importRecord
      });
    } catch (err) {
      console.error("[create-import-from-subset] error:", err);
      sendError(res, 500, "CREATE_SUBSET_IMPORT_FAILED", err instanceof Error ? err.message : "Failed to create follow-up base");
    }
  });

  // POST /api/campaigns/reports/delete-import-items — Deleta itens de importação
  app.post("/api/campaigns/reports/delete-import-items", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.body?.clientId);
    const clientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!clientId) return;

    const leadImportItemIds = Array.isArray(req.body?.leadImportItemIds) ? req.body.leadImportItemIds : [];
    if (leadImportItemIds.length === 0) {
      return sendError(res, 400, "MISSING_LEAD_IMPORT_ITEM_IDS", "Missing leadImportItemIds array");
    }

    try {
      // 1. Deletar os runs associados primeiro para manter a integridade referencial se houver FK
      await supabase
        .from("campaign_dispatch_runs")
        .delete()
        .in("lead_id", leadImportItemIds)
        .eq("client_id", clientId);

      // 2. Deletar os itens de importação
      const { data, error } = await supabase
        .from("lead_import_items")
        .delete()
        .in("id", leadImportItemIds)
        .eq("client_id", clientId)
        .select("id");

      if (error) throw error;

      res.json({
        success: true,
        deletedCount: data?.length ?? 0
      });
    } catch (err) {
      console.error("[delete-import-items] error:", err);
      sendError(res, 500, "DELETE_IMPORT_ITEMS_FAILED", err instanceof Error ? err.message : "Failed to delete import items");
    }
  });

  // POST /api/campaigns/:id/dispatches — cria disparo
  app.post("/api/campaigns/:id/dispatches", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const campaignId = normalizeString(req.params.id);
    if (!campaignId) return sendError(res, 400, "MISSING_ID", "Missing campaign id");

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const name = normalizeString(body.name) || "Disparo";
    const requestedSteps = Array.isArray(body.steps) ? body.steps : [];
    const triggerType = body.triggerType === "scheduled" ? "scheduled" : "manual";
    const scheduledAt = triggerType === "scheduled" ? (normalizeString(body.scheduledAt) || null) : null;
    const parsedEvolutionInstanceId = parseOptionalUuid(body.evolutionInstanceId);
    if (parsedEvolutionInstanceId.error) {
      return sendError(res, 400, "INVALID_EVOLUTION_INSTANCE_ID", parsedEvolutionInstanceId.error);
    }
    const requestedEvolutionInstanceId = parsedEvolutionInstanceId.value || null;

    try {
      await ensureCampaignDispatchEvolutionInstanceColumn();
      // Verifica que a campanha pertence ao cliente autorizado
      const { data: campaign, error: campaignErr } = await supabase
        .from("campaigns")
        .select("id, client_id, analytics_meta")
        .eq("id", campaignId)
        .single();
      if (campaignErr || !campaign) return sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");

      const authorizedClientId = resolveAuthorizedClientId(req, res, campaign.client_id);
      if (!authorizedClientId) return;
      if (!(await validateCampaignDispatchEvolutionInstance(authorizedClientId, requestedEvolutionInstanceId, res))) return;

      const campaignMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
      const steps = requestedSteps.length > 0 ? requestedSteps : campaignMeta.sequence;
      const validation = validateCampaignAnalyticsMeta({
        ...campaignMeta,
        sequence: steps,
      });
      if (!validation.valid) {
        return sendError(res, 400, "INVALID_DISPATCH_TEMPLATE", validation.message);
      }

      const limitPerRun = body.limitPerRun != null ? Number(body.limitPerRun) : null;
      const offset = body.offset != null ? Number(body.offset) : null;

      let targetCount = 0;
      try {
        const previewLeads = await buildDispatchLeads({
          clientId: authorizedClientId,
          importId: campaign.import_id,
          limit: limitPerRun,
          offset: offset,
          segmentation: validation.analyticsMeta.sequence?.[0]?.segmentation || null,
          excludeDispatchId: null
        });
        targetCount = previewLeads.length;
      } catch (err) {
        console.error("Erro ao calcular target_count:", err);
      }

      const { data, error } = await supabase
        .from("campaign_dispatches")
        .insert({
          campaign_id: campaignId,
          client_id: authorizedClientId,
          name,
          steps: validation.analyticsMeta.sequence,
          trigger_type: triggerType,
          scheduled_at: scheduledAt,
          evolution_instance_id: requestedEvolutionInstanceId,
          status: triggerType === "scheduled" && scheduledAt ? "scheduled" : "draft",
          limit_per_run: limitPerRun,
          offset: offset,
          target_count: targetCount,
        })
        .select("*")
        .single();
      if (error) throw error;
      res.status(201).json({ dispatch: data });
    } catch (err) {
      sendError(res, 500, "DISPATCH_CREATE_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // PATCH /api/campaigns/dispatches/:dispatchId — atualiza disparo
  app.patch("/api/campaigns/dispatches/:dispatchId", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const dispatchId = normalizeString(req.params.dispatchId);
    if (!dispatchId) return sendError(res, 400, "MISSING_ID", "Missing dispatch id");

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const patch = {};
    if (body.name != null) patch.name = normalizeString(body.name) || "Disparo";
    if (body.triggerType != null) patch.trigger_type = body.triggerType === "scheduled" ? "scheduled" : "manual";
    if (body.scheduledAt != null) patch.scheduled_at = normalizeString(body.scheduledAt) || null;
    if (Object.prototype.hasOwnProperty.call(body, "evolutionInstanceId")) {
      const parsedEvInstanceId = parseOptionalUuid(body.evolutionInstanceId);
      if (parsedEvInstanceId.error) {
        return sendError(res, 400, "INVALID_EVOLUTION_INSTANCE_ID", parsedEvInstanceId.error);
      }
      patch.evolution_instance_id = parsedEvInstanceId.value || null;
    }
    if (body.status != null && ["draft","scheduled","paused","cancelled"].includes(body.status)) patch.status = body.status;
    patch.updated_at = new Date().toISOString();

    try {
      await ensureCampaignDispatchEvolutionInstanceColumn();
      const { data: existing, error: existingErr } = await supabase
        .from("campaign_dispatches")
        .select("id, campaign_id, client_id, status")
        .eq("id", dispatchId)
        .single();
      if (existingErr || !existing) return sendError(res, 404, "DISPATCH_NOT_FOUND", "Dispatch not found");
      const authorizedClientId = resolveAuthorizedClientId(req, res, existing.client_id);
      if (!authorizedClientId) return;
      if (
        Object.prototype.hasOwnProperty.call(patch, "evolution_instance_id") &&
        !(await validateCampaignDispatchEvolutionInstance(authorizedClientId, patch.evolution_instance_id, res))
      ) {
        return;
      }

      const isPauseRequest = existing.status === "running" && patch.status === "paused" && Object.keys(patch).length === 2;
      if (existing.status === "running" && !isPauseRequest) {
        return sendError(res, 409, "DISPATCH_RUNNING", "Cannot update a running dispatch");
      }
      if (patch.status === "paused") {
        await ensureCampaignDispatchPausedStatusAllowed();
      }

      if (Array.isArray(body.steps)) {
        const { data: campaign, error: campaignErr } = await supabase
          .from("campaigns")
          .select("id, analytics_meta")
          .eq("id", existing.campaign_id)
          .single();
        if (campaignErr || !campaign) return sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");
        const campaignMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
        const validation = validateCampaignAnalyticsMeta({
          ...campaignMeta,
          sequence: body.steps,
        });
        if (!validation.valid) {
          return sendError(res, 400, "INVALID_DISPATCH_TEMPLATE", validation.message);
        }
        patch.steps = validation.analyticsMeta.sequence;
      }

      const { data, error } = await supabase
        .from("campaign_dispatches")
        .update(patch)
        .eq("id", dispatchId)
        .eq("client_id", authorizedClientId)
        .select("*")
        .single();
      if (error) throw error;
      if (!data) return sendError(res, 404, "DISPATCH_NOT_FOUND", "Dispatch not found");
      res.json({ dispatch: data });
    } catch (err) {
      sendError(res, 500, "DISPATCH_UPDATE_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // DELETE /api/campaigns/dispatches/:dispatchId — remove disparo (só draft)
  app.delete("/api/campaigns/dispatches/:dispatchId", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const dispatchId = normalizeString(req.params.dispatchId);
    if (!dispatchId) return sendError(res, 400, "MISSING_ID", "Missing dispatch id");
    try {
      await ensureCampaignDispatchEvolutionInstanceColumn();
      const { data: existing } = await supabase.from("campaign_dispatches").select("status, client_id").eq("id", dispatchId).single();
      if (!existing) return sendError(res, 404, "DISPATCH_NOT_FOUND", "Dispatch not found");
      const authorizedClientId = resolveAuthorizedClientId(req, res, existing.client_id);
      if (!authorizedClientId) return;
      if (existing.status === "running") return sendError(res, 409, "DISPATCH_RUNNING", "Cannot delete a running dispatch");
      const { error } = await supabase.from("campaign_dispatches").delete().eq("id", dispatchId).eq("client_id", authorizedClientId);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      sendError(res, 500, "DISPATCH_DELETE_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // POST /api/campaigns/dispatches/:dispatchId/trigger — executa disparo manualmente
  app.post("/api/campaigns/dispatches/:dispatchId/trigger", requireFirebaseAuth, requireInternalPageAccess("planilhas"), async (req, res) => {
    if (!ensureDb(res)) return;
    const dispatchId = normalizeString(req.params.dispatchId);
    if (!dispatchId) return sendError(res, 400, "MISSING_ID", "Missing dispatch id");
    try {
      await ensureCampaignDispatchEvolutionInstanceColumn();
      const { data: dispatch, error: fetchErr } = await supabase
        .from("campaign_dispatches")
        .select("*")
        .eq("id", dispatchId)
        .single();
      if (fetchErr || !dispatch) return sendError(res, 404, "DISPATCH_NOT_FOUND", "Dispatch not found");
      if (dispatch.status === "running") return sendError(res, 409, "DISPATCH_RUNNING", "Dispatch is already running");
      if (!["draft","scheduled","failed"].includes(dispatch.status)) {
        return sendError(res, 409, "DISPATCH_DONE", "Dispatch already completed");
      }

      const { data: campaign, error: campErr } = await supabase
        .from("campaigns")
        .select("id, name, client_id, import_id, limit_per_run, analytics_meta, webhook_url, webhook_token")
        .eq("id", dispatch.campaign_id)
        .single();
      if (campErr || !campaign) return sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");

      const authorizedClientId = resolveAuthorizedClientId(req, res, campaign.client_id);
      if (!authorizedClientId) return;

      // Marca como running
      await supabase.from("campaign_dispatches").update({ status: "running", triggered_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", dispatchId);

      res.json({ success: true, status: "running", dispatchId });

      // Executa o disparo em background (fire-and-forget da resposta HTTP)
      runCampaignDispatch({ dispatch, campaign, supabase }).catch((err) => {
        console.error("[campaign-dispatch] dispatch_run_failed", { dispatchId, error: err.message });
        supabase.from("campaign_dispatches").update({ status: "failed", error_message: err.message, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", dispatchId);
      });
    } catch (err) {
      sendError(res, 500, "DISPATCH_TRIGGER_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // ─────────────────────────────────────────────────────────────────────────────

  app.post("/api/campaigns/reply-webhook", async (req, res) => {
    if (!ensureDb(res)) return;

    const body = req.body && typeof req.body === "object" ? req.body : {};

    // Descarta mensagem de GRUPO/broadcast cedo (antes de qualquer gravação): resposta de
    // lead vem sempre de número individual. Responde 200 p/ a Evolution não reenviar.
    const rawRemoteJid = body.data?.key?.remoteJid ?? body.remoteJid ?? body.senderJid ?? null;
    if (isGroupJid(rawRemoteJid)) {
      res.json({ success: true, ignored: "group" });
      return;
    }

    const clientId = normalizeTenantKey(body.clientId ?? body.client_id ?? body.client?.id);
    const phone = sanitizePhone(
      body.phone ??
      body.telefone ??
      body.number ??
      body.remoteJid ??
      body.data?.key?.remoteJid
    );
    const replyText = normalizeString(extractTextFromBody(body)) || null;
    const repliedAt =
      normalizeIsoDate(body.repliedAt ?? body.timestamp ?? body.created_at ?? body.data?.messageTimestamp) ||
      new Date().toISOString();

    if (!clientId) {
      sendError(res, 400, "INVALID_BODY", "Missing clientId");
      return;
    }

    if (!phone) {
      sendError(res, 400, "INVALID_BODY", "Missing valid phone");
      return;
    }

    try {
      if (!(await validateN8nInboundBearer(req, res, clientId))) {
        return;
      }

      const campaignReplyContext = await findCampaignReplyMatches({ clientId, phone });
      const activeWaitCampaign = campaignReplyContext.processingWaitForReplyMatches[0] || null;

      logCampaignReplyFlow("info", "webhook_received", {
        clientId,
        phone: maskPhoneForLog(phone),
        hasReplyText: Boolean(replyText),
        matchedCampaignCount: campaignReplyContext.matches.length,
        waitForReplyCampaignCount: campaignReplyContext.waitForReplyMatches.length,
        processingWaitForReplyCampaignCount: campaignReplyContext.processingWaitForReplyMatches.length,
      });

      if (activeWaitCampaign) {
        const progression = await continueCampaignLeadFromReply({
          clientId,
          phone,
          repliedAt,
          campaignMatch: activeWaitCampaign,
          replyPayload: {
            ...body,
            message: replyText,
          },
        });

        // Campaign wait-for-reply already advances the sequence via Evolution (continueCampaignLeadFromReply).
        // Do NOT forward the same inbound message to hardcoded-chat-webhook by default — that produced a
        // second concurrent agent reply (e.g. qualification bot) alongside campaign media at the same timestamp.
        // Opt back in: CAMPAIGN_REPLY_FORWARD_TO_CHATBOT=true (hybrid / ENABLE_CAMPAIGN_ROUTING experiments).
        const forwardCampaignReplyToChatbot = process.env.CAMPAIGN_REPLY_FORWARD_TO_CHATBOT === "true";
        if (replyText && forwardCampaignReplyToChatbot) {
          const campaignRoutingEnabled = process.env.ENABLE_CAMPAIGN_ROUTING === "true";
          if (campaignRoutingEnabled) {
            const tenantSettingsForRouting = await getLeadClientN8nSettings(clientId).catch(() => null);
            const baseModel = tenantSettingsForRouting?.chatbot_model;
            const itemId = activeWaitCampaign.leadImportItem?.id;
            const { isFirst } = await isFirstCampaignReply({ itemId, campaignId: activeWaitCampaign.id, supabase });
            const modelOverride = isFirst && baseModel ? `campanha_${baseModel}` : undefined;
            if (isFirst) {
              await supabase
                .from(leadsTableName(clientId))
                .update({ lead_origin: "campaign", source_campaign_id: activeWaitCampaign.id, source_campaign_name: activeWaitCampaign.name || null, lead_source: "campanha" })
                .eq("client_id", clientId)
                .eq("telefone", phone);
            }
            fetch("http://localhost:3001/api/hardcoded-chat-webhook", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ clientId, phone, message: replyText, ...(modelOverride ? { modelOverride } : {}) }),
            }).catch((err) => console.warn("[reply-webhook] chatbot_route_failed:", err.message));
          } else {
            fetch("http://localhost:3001/api/hardcoded-chat-webhook", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ clientId, phone, message: replyText }),
            }).catch((err) => console.warn("[reply-webhook] chatbot_route_failed:", err.message));
          }
        }

        // Tag campaign attribution on first reply even when chatbot forwarding is off (no duplicate agent).
        if (replyText && !forwardCampaignReplyToChatbot && process.env.ENABLE_CAMPAIGN_ROUTING === "true") {
          const itemId = activeWaitCampaign.leadImportItem?.id;
          const { isFirst } = await isFirstCampaignReply({ itemId, campaignId: activeWaitCampaign.id, supabase });
          if (isFirst) {
            await supabase
              .from(leadsTableName(clientId))
              .update({
                lead_origin: "campaign",
                source_campaign_id: activeWaitCampaign.id,
                source_campaign_name: activeWaitCampaign.name || null,
                lead_source: "campanha",
              })
              .eq("client_id", clientId)
              .eq("telefone", phone);
          }
        }

        if (replyText) {
          await appendLeadMessage({
            clientId,
            phone,
            senderType: "lead",
            direction: "inbound",
            messageText: replyText,
            campaignId: activeWaitCampaign.id,
            deliveredAt: repliedAt,
            meta: {
              source: "campaign-reply-webhook",
              campaignName: activeWaitCampaign.name || null,
              mode: "wait_for_reply",
            },
          });
        }

        res.json({
          success: true,
          clientId,
          phone,
          repliedAt,
          progression,
          campaignContext: {
            isCampaignLead: true,
            matchedCampaignCount: campaignReplyContext.matches.length,
            waitForReplyCampaignCount: campaignReplyContext.waitForReplyMatches.length,
            processingWaitForReplyCampaignCount: campaignReplyContext.processingWaitForReplyMatches.length,
            shouldReturnLeadToCampaignFlow: progression.continued === true || progression.finalized === true,
            signal: progression.campaignFinalized
              ? "campaign_completed"
              : progression.finalized
                ? "campaign_last_step_sent"
                : "campaign_step_sent_waiting_next_reply",
            importIds: campaignReplyContext.importIds,
            matchedCampaigns: campaignReplyContext.matches,
          },
        });
        return;
      }

      // Rotear para chatbot — inbound (nova sessão ou sessão ativa) — fire and forget
      if (replyText) {
        fetch("http://localhost:3001/api/hardcoded-chat-webhook", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId, phone, message: replyText }),
        }).catch((err) => console.warn("[reply-webhook] chatbot_route_failed:", err.message));
      }

      const importItemsUpdatePayload = {
        status_conversa: "em_atendimento",
        ultima_interacao_usuario: repliedAt,
      };
      const leadsUpdatePayload = {
        status_conversa: "em_atendimento",
      };
      const [importItemsResult, leadsResult] = await Promise.all([
        supabase
          .from("lead_import_items")
          .update(importItemsUpdatePayload)
          .eq("client_id", clientId)
          .eq("telefone", phone)
          .select("id"),
        supabase
          .from(leadsTableName(clientId))
          .update(leadsUpdatePayload)
          .eq("client_id", clientId)
          .eq("telefone", phone)
          .select("id"),
      ]);

      if (importItemsResult.error && !isMissingSchemaError(importItemsResult.error)) throw importItemsResult.error;
      if (leadsResult.error && !isMissingSchemaError(leadsResult.error)) throw leadsResult.error;
      if (importItemsResult.error && isMissingSchemaError(importItemsResult.error)) {
        logCampaignReplyFlow("warn", "conversation_columns_missing_import_reply_update_fallback", {
          clientId,
          phone: maskPhoneForLog(phone),
          error: importItemsResult.error.message || importItemsResult.error.code || "missing_schema",
        });
      }
      if (leadsResult.error && isMissingSchemaError(leadsResult.error)) {
        logCampaignReplyFlow("warn", "conversation_columns_missing_lead_reply_update_fallback", {
          clientId,
          phone: maskPhoneForLog(phone),
          error: leadsResult.error.message || leadsResult.error.code || "missing_schema",
        });
      }

      if (replyText) {
        await appendLeadMessage({
          clientId,
          phone,
          senderType: "lead",
          direction: "inbound",
          messageText: replyText,
          campaignId: activeWaitCampaign?.id || campaignReplyContext.matches[0]?.id || null,
          deliveredAt: repliedAt,
          meta: {
            source: "campaign-reply-webhook",
            matchedCampaignCount: campaignReplyContext.matches.length,
          },
        });
      }

      res.json({
        success: true,
        clientId,
        phone,
        repliedAt,
        updatedImportItems: importItemsResult.error ? 0 : importItemsResult.data?.length || 0,
        updatedLeads: leadsResult.error ? 0 : leadsResult.data?.length || 0,
        campaignContext: {
          isCampaignLead: campaignReplyContext.matches.length > 0,
          matchedCampaignCount: campaignReplyContext.matches.length,
          waitForReplyCampaignCount: campaignReplyContext.waitForReplyMatches.length,
          processingWaitForReplyCampaignCount: campaignReplyContext.processingWaitForReplyMatches.length,
          shouldReturnLeadToCampaignFlow: false,
          signal:
            campaignReplyContext.waitForReplyMatches.length > 0
              ? "lead_in_wait_for_reply_campaign"
              : campaignReplyContext.matches.length > 0
                ? "lead_in_campaign"
                  : "lead_not_in_campaign",
          importIds: campaignReplyContext.importIds,
          matchedCampaigns: campaignReplyContext.matches,
        },
      });
    } catch (error) {
      console.error("campaign reply webhook error:", error);
      sendError(res, 500, "CAMPAIGN_REPLY_WEBHOOK_FAILED", error instanceof Error ? error.message : "Failed to register reply");
    }
  });

  // GET /api/leads-for-dispatch — n8n busca leads pendentes (autenticado por Bearer token)
  app.get("/api/leads-for-dispatch", async (req, res) => {
    if (!ensureDb(res)) return;

    const clientId = normalizeTenantKey(req.query?.clientId ?? req.query?.client_id);
    const importId = normalizeString(req.query?.importId) || null;
    const rawLimit = Number.parseInt(String(req.query?.limit ?? "50"), 10);
    const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 200);

    if (!clientId) {
      sendError(res, 400, "INVALID_QUERY", "Missing clientId");
      return;
    }

    try {
      if (!(await validateN8nInboundBearer(req, res, clientId))) {
        return;
      }

      let query = supabase
        .from(leadsTableName(clientId))
        .select("id, telefone, nome, cidade, estado, status, tipo_cliente, faixa_consumo, qualificacao, created_at")
        .eq("client_id", clientId)
        .not("telefone", "is", null)
        .neq("status", "dispatched")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (importId) {
        const { data: importItems } = await supabase
          .from("lead_import_items")
          .select("telefone")
          .eq("import_id", importId)
          .eq("client_id", clientId)
          .eq("imported", true);

        const phones = (importItems || []).map((i) => i.telefone).filter(Boolean);
        if (phones.length === 0) {
          return res.json({ success: true, total: 0, leads: [] });
        }
        query = query.in("telefone", phones);
      }

      const { data, error } = await query;

      if (error) {
        sendError(res, 500, "LEADS_FETCH_FAILED", "Failed to fetch leads", error.message);
        return;
      }

      const leads = (data || []).map((lead) => ({
        id: lead.id,
        telefone: lead.telefone,
        nome: lead.nome,
        cidade: lead.cidade,
        estado: lead.estado,
        status: lead.status,
        tipo_cliente: lead.tipo_cliente,
        faixa_consumo: lead.faixa_consumo,
        qualificacao: lead.qualificacao,
        created_at: lead.created_at,
      }));

      res.json({ success: true, total: leads.length, leads });
    } catch (error) {
      console.error("leads-for-dispatch error:", error);
      sendError(res, 500, "INTERNAL_ERROR", "Internal server error", internalErrorPayloadDetails(error));
    }
  });


  // ── Campaign Prompts ──────────────────────────────────────────────────────
  // GET /api/campaign-prompts — lista prompts de campanha do cliente
  app.get("/api/campaign-prompts", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const clientId = resolveAuthorizedClientId(req, res, normalizeString(req.query?.clientId));
    if (!clientId) return;
    try {
      const { data, error } = await supabase
        .from("campaign_prompts")
        .select("id, client_id, name, content, updated_at, updated_by_email")
        .eq("client_id", clientId)
        .order("name", { ascending: true });
      if (error) throw error;
      res.json({ prompts: data || [] });
    } catch (err) {
      sendError(res, 500, "CAMPAIGN_PROMPTS_FETCH_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // PUT /api/campaign-prompts — cria ou atualiza prompt de campanha por nome
  app.put("/api/campaign-prompts", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const clientId = resolveAuthorizedClientId(req, res, normalizeTenantKey(body.clientId ?? body.client_id));
    if (!clientId) return;
    const name = normalizeString(body.name);
    const content = typeof body.content === "string" ? body.content : "";
    if (!name) return sendError(res, 400, "INVALID_BODY", "name is required");
    try {
      const { data, error } = await supabase
        .from("campaign_prompts")
        .upsert({ client_id: clientId, name, content, updated_at: new Date().toISOString(), updated_by_email: req.authAccess?.email ?? null }, { onConflict: "client_id,name" })
        .select("id, client_id, name, content, updated_at, updated_by_email")
        .single();
      if (error) throw error;
      res.json({ prompt: data });
    } catch (err) {
      sendError(res, 500, "CAMPAIGN_PROMPT_SAVE_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // DELETE /api/campaign-prompts/:id — remove prompt de campanha
  app.delete("/api/campaign-prompts/:id", requireFirebaseAuth, async (req, res) => {
    if (!ensureDb(res)) return;
    const id = normalizeString(req.params.id);
    if (!id) return sendError(res, 400, "MISSING_ID", "Missing prompt id");
    try {
      const { error } = await supabase.from("campaign_prompts").delete().eq("id", id);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      sendError(res, 500, "CAMPAIGN_PROMPT_DELETE_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });
}
