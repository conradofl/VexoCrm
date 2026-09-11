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
import { buildPhoneLookupVariants } from "../../services/leadImport.js";
import {
  isEvolutionOpenState,
  checkWhatsappNumbers,
  validateWhatsappNumbersWithCache,
  resolveInstanceIdentifier,
} from "../../services/evolution.js";
import {
  dispatchCampaignSequence,
  getCampaignStepPlan,
  normalizeCampaignAnalyticsMeta,
  validateCampaignAnalyticsMeta,
} from "../../campaign-outbound.js";
import { markCampaignLeadWaitingReply } from "../../campaign/dispatch.js";
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
import { resolveMessageId } from "../../services/inboundGuard.js";
import {
  isWithinSendWindow,
  getNextSendWindowOpening,
  resolveSendWindowConfig,
} from "../../services/sendWindow.js";
import { getDateKey } from "../../services/analytics.js";

let _evolutionDailyUsageSchemaEnsured = false;
let _dispatchRunsClaimSchemaEnsured = false;
let _dueDispatchTimerStarted = false;
let _dueDispatchInterval = null;

export function stopDueDispatchScheduler() {
  if (_dueDispatchInterval) {
    clearInterval(_dueDispatchInterval);
    _dueDispatchInterval = null;
    _dueDispatchTimerStarted = false;
    console.log("[campaign-dispatch-scheduler] scheduler de disparos avulsos parado.");
  }
}

// Origem dos leads de uma campanha. Uma campanha pode apontar para varias
// planilhas importadas: a lista fica em analytics_meta.importIds (jsonb), e a
// coluna import_id guarda a primeira, para nao quebrar quem le so a coluna.
function resolveCampaignImportSelection(campaign) {
  if (campaign?.analytics_meta?.importSource === "__crm__") return "__crm__";
  const many = campaign?.analytics_meta?.importIds;
  if (Array.isArray(many) && many.length > 0) return many;
  return campaign?.import_id || null;
}

/**
 * Bloco de contexto com as opcoes de resposta que o lead recebeu escritas na
 * mensagem. Vai anexado ao roteiro copiado para o disparo.
 *
 * O rotulo (displayText) e o que o lead LEU; replyText, quando existe, e a
 * intencao que o dono associou aquela opcao — os dois entram, porque o lead pode
 * responder pelo numero, pelo texto do rotulo ou por algo parecido.
 *
 * Nada e inventado: sem opcao escrita, devolve string vazia e o roteiro fica como
 * estava.
 */
export function buildStepOptionsContext(sequence) {
  const linhas = [];
  for (const step of Array.isArray(sequence) ? sequence : []) {
    const opcoes = (Array.isArray(step?.buttons) ? step.buttons : []).filter(
      (b) => b && b.type !== "url" && !b.url && !b.href
    );
    if (opcoes.length === 0) continue;

    const doPasso = [];
    for (const btn of opcoes) {
      const rotulo = String(btn.displayText || btn.label || btn.replyText || btn.value || "").trim();
      if (!rotulo || /\{\{.*?\}\}/.test(rotulo)) continue;
      const intencao = String(btn.replyText || btn.value || "").trim();
      const numero = doPasso.length + 1;
      doPasso.push(intencao && intencao !== rotulo ? `${numero}. ${rotulo} (significa: ${intencao})` : `${numero}. ${rotulo}`);
    }
    if (doPasso.length > 0) linhas.push(...doPasso);
  }

  if (linhas.length === 0) return "";

  return [
    "OPCOES OFERECIDAS AO LEAD NESTA CAMPANHA:",
    "A mensagem enviada listou as opcoes abaixo, numeradas. O lead pode responder com o",
    "numero, com o texto da opcao ou com algo equivalente — trate como a mesma escolha e",
    "siga o roteiro a partir dela, sem recomecar a conversa.",
    ...linhas,
  ].join("\n");
}

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
    requireCampaignDispatchAccess,
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
  app.get("/api/campaigns/ai/status", requireFirebaseAuth, requireCampaignDispatchAccess, async (_req, res) => {
    res.json(getGroqCampaignAiStatus());
  });

  app.post("/api/campaigns/ai/generate-copy", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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

  app.post("/api/campaigns/ai/suggest-sequence", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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

  app.post("/api/campaigns/ai/generate-template-variants", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
    try {
      const suggestion = await generateCampaignTemplateVariants({
        campaignName: req.body?.campaignName,
        goal: req.body?.goal,
        style: req.body?.style,
        baseText: req.body?.baseText,
        count: req.body?.count,
        availableVariables: req.body?.availableVariables,
        segmentation: req.body?.segmentation,
        sequence: req.body?.sequence,
      });
      res.json({ item: suggestion });
    } catch (error) {
      console.error("campaign ai generate template variants error:", error);
      const status = error.statusCode || 502;
      const code = error.code || "GROQ_REQUEST_FAILED";
      sendError(res, status, code, error instanceof Error ? error.message : "Falha ao gerar variações com a IA");
    }
  });

  app.post("/api/campaigns/ai/suggest-delays", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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

  app.post("/api/campaigns/ai/rewrite-step", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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

  app.post("/api/campaigns/direct-dispatch", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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

  app.get("/api/campaigns", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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

      const isInternalOperator =
        req.authAccess?.role === "internal" &&
        req.authAccess?.accessPreset === "operador";

      let campaignOrClause = null;
      if (isInternalOperator) {
        const uid = req.authAccess?.uid || req.authUser?.uid;
        const email = req.authAccess?.email || req.authUser?.email;
        const operatorIdentifiers = [uid, email].filter(Boolean);
        if (operatorIdentifiers.length > 0) {
          campaignOrClause = operatorIdentifiers
            .map((id) => `created_by_uid.eq.${id}`)
            .concat("created_by_uid.is.null")
            .join(",");
        }
      }

      if (clientId) {
        query = query.eq("client_id", clientId);
      }

      if (campaignOrClause) {
        query = query.or(campaignOrClause);
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
        if (campaignOrClause) {
          fallbackQuery = fallbackQuery.or(campaignOrClause);
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

  app.get("/api/campaigns/:id/leads", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
          importId: resolveCampaignImportSelection(campaign),
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
  app.post("/api/campaigns", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
    // importIds (varias planilhas). A coluna import_id recebe a primeira; a
    // lista completa vai para analytics_meta.importIds mais abaixo.
    const reqImportIds = Array.isArray(req.body?.importIds)
      ? req.body.importIds.map((v) => normalizeString(v)).filter(Boolean)
      : [];
    const importId = isCrmSource ? null : (reqImportIds[0] || reqImportId);
    
    const rawLimit = Number.parseInt(String(req.body?.limitPerRun ?? "50"), 10);
    const limitPerRun = Number.isNaN(rawLimit) || rawLimit < 1 ? 50 : Math.min(rawLimit, 5000);
    const scheduledFor = normalizeString(req.body?.scheduledFor) || null;
    const analyticsMeta =
      req.body?.analyticsMeta && typeof req.body.analyticsMeta === "object"
        ? req.body.analyticsMeta
        : {};
    
    if (isCrmSource) {
      analyticsMeta.importSource = "__crm__";
    } else if (reqImportIds.length > 0) {
      analyticsMeta.importIds = reqImportIds;
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
      const webhookUrl = dispatchSettings.webhookUrl || null;
      const webhookToken = dispatchSettings.webhookToken || null;

      // Só checar saúde de conexão se o status da campanha for ativação imediata
      if (lifecycleStatus === "active" && webhookUrl && !webhookUrl.includes("example")) {
        try {
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
        } catch (e) {
          console.warn("[campaign-create] Aviso de conexão do WhatsApp:", e.message);
        }
      }

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
  app.patch("/api/campaigns/:id", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
    let updatedImportIds = null;
    if ("importIds" in req.body) {
      updatedImportIds = Array.isArray(req.body?.importIds)
        ? req.body.importIds.map((v) => normalizeString(v)).filter(Boolean)
        : [];
      updates.import_id = updatedImportIds[0] || null;
    }
    if ("importId" in req.body) {
      const reqImportId = normalizeString(req.body?.importId) || null;
      if (reqImportId === "__crm__") {
        updates.import_id = null;
        isCrmSourceUpdate = true;
      } else if (updatedImportIds === null) {
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
      
      if (isCrmSourceUpdate || updatedImportIds !== null || ("importId" in req.body && updates.import_id !== null)) {
         const currentMeta = updates.analytics_meta || current.analytics_meta || {};
         if (isCrmSourceUpdate) {
            currentMeta.importSource = "__crm__";
            delete currentMeta.importIds;
         } else {
            delete currentMeta.importSource;
            if (updatedImportIds !== null) {
              if (updatedImportIds.length > 0) currentMeta.importIds = updatedImportIds;
              else delete currentMeta.importIds;
            }
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
  app.delete("/api/campaigns/:id", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
  app.get("/api/campaigns/consultant-schedules", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
  app.post("/api/campaigns/consultant-schedules", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
  app.patch("/api/campaigns/consultant-schedules/:id", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
  app.delete("/api/campaigns/consultant-schedules/:id", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
        .select("id, campaign_id, client_id, name, steps, trigger_type, scheduled_at, status, evolution_instance_id, limit_per_run, offset, error_message")
        .in("status", ["scheduled", "paused"])
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
          if (dispatch.status === "paused") {
            const errMsg = String(dispatch.error_message || "");
            const isSendWindowPause = errMsg.includes("fora da janela de envio");
            const isQuotaPause = errMsg.includes("cota diária do chip atingida");

            if (!isSendWindowPause && !isQuotaPause) {
              continue;
            }

            const tenantSettings = await getLeadClientN8nSettings(dispatch.client_id);
            const sendWindowConfig = resolveSendWindowConfig(tenantSettings);

            // Verifica se está dentro da janela de envio permitida do tenant
            if (!isWithinSendWindow(new Date(), sendWindowConfig)) {
              continue;
            }

            // Se estava pausado por cota, verifica se o chip já tem cota disponível hoje no timezone do tenant
            if (isQuotaPause) {
              const tenantTimezone = sendWindowConfig.timezone || "America/Sao_Paulo";
              const todayDateKey = getDateKey(new Date(), tenantTimezone);
              const tenantInstances = await getLeadClientEvolutionInstances(dispatch.client_id);
              const targetInst = (tenantInstances || []).find((i) => i.id === dispatch.evolution_instance_id) || tenantInstances?.[0];
              if (targetInst) {
                const limit = resolveEvolutionInstanceDailyLimit(targetInst);
                const currentUsage = await getEvolutionInstanceDailyUsage(targetInst.id, todayDateKey);
                if (currentUsage >= limit) {
                  // Cota de hoje ainda está esgotada, continua aguardando o dia seguinte
                  continue;
                }
              }
            }
          } else {
            const tenantSettings = await getLeadClientN8nSettings(dispatch.client_id);
            const sendWindowConfig = resolveSendWindowConfig(tenantSettings);

            // Verifica se está dentro da janela de envio permitida do tenant
            if (!isWithinSendWindow(new Date(), sendWindowConfig)) {
              // Permanece aguardando abertura da janela
              continue;
            }
          }

          const { data: campaign, error: campErr } = await supabase
            .from("campaigns")
            .select("id, name, client_id, import_id, limit_per_run, analytics_meta, webhook_url, webhook_token")
            .eq("id", dispatch.campaign_id)
            .single();

          if (campErr || !campaign) {
            throw new Error(campErr?.message || "Campaign not found");
          }

          // CLAIM ATOMICO DO DISPARO
          const { data: claimed, error: claimErr } = await supabase
            .from("campaign_dispatches")
            .update({
              status: "running",
              error_message: null,
              triggered_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .eq("id", dispatch.id)
            .in("status", ["scheduled", "paused"])
            .select("id");

          if (claimErr) throw claimErr;
          if (!claimed || claimed.length === 0) {
            console.log("[campaign-dispatch-scheduler] disparo ja reivindicado por outro ciclo, pulando", {
              dispatchId: dispatch.id,
              campaignId: dispatch.campaign_id,
            });
            results.push({ id: dispatch.id, campaignId: dispatch.campaign_id, status: "already_claimed" });
            continue;
          }

          await runCampaignDispatch({ dispatch, campaign, supabase });

          results.push({ id: dispatch.id, campaignId: campaign.id, status: "success" });
        } catch (err) {
          console.error(`[campaign-dispatch-scheduler] failed to run dispatch ${dispatch.id}:`, err);
          const isDisconnected = Boolean(err?.isConnectionClosed || err?.code === "EVOLUTION_INSTANCE_NOT_OPEN");
          const targetStatus = isDisconnected ? "paused" : "failed";
          const userFriendlyError = isDisconnected
            ? `Pausado — chip desconectado (${err.instanceName || "WhatsApp"}). Reconecte em Conexões para retomar.`
            : (err?.userMessage || err?.message || "Falha técnica no processamento do lote.");

          await supabase
            .from("campaign_dispatches")
            .update({
              status: targetStatus,
              error_message: userFriendlyError,
              finished_at: targetStatus === "failed" ? new Date().toISOString() : null,
              updated_at: new Date().toISOString()
            })
            .eq("id", dispatch.id);

          results.push({ id: dispatch.id, status: targetStatus, error: userFriendlyError });
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
    _dueDispatchInterval = setInterval(async () => {
      try {
        await runDueIndependentDispatches({ limit: 10 });
      } catch (err) {
        console.error("[campaign-dispatch-scheduler] background tick failed:", err);
      }
    }, 30000); // ticks every 30 seconds
    if (_dueDispatchInterval?.unref) _dueDispatchInterval.unref();
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

  // POST /api/campaigns/:id/trigger — legado desativado (disparos ocorrem via fila /api/campaigns/dispatches/:id/trigger)
  app.post("/api/campaigns/:id/trigger", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
    if (!ensureDb(res)) return;

    sendError(
      res,
      410,
      "CAMPAIGN_TRIGGER_DEPRECATED",
      "Endpoint legado de disparo direto desativado. Utilize a fila de envios via POST /api/campaigns/dispatches/:id/trigger."
    );
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
      CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'done', 'failed', 'cancelled', 'interrupted'))
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
  const EVOLUTION_CHIP_DAILY_QUOTA_DEFAULTS = { cold: 50, warm: 500 };

  async function ensureEvolutionInstanceDailyUsageTable() {
    if (!pgDatabasePool) return false;
    if (_evolutionDailyUsageSchemaEnsured) return true;
    await pgDatabasePool.query(`
      CREATE TABLE IF NOT EXISTS public.evolution_instance_daily_usage (
        instance_id TEXT NOT NULL,
        date DATE NOT NULL,
        sent_count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (instance_id, date)
      )
    `);
    await pgDatabasePool.query(`
      ALTER TABLE public.evolution_instance_daily_usage ALTER COLUMN instance_id TYPE TEXT
    `).catch(() => {});
    _evolutionDailyUsageSchemaEnsured = true;
    return true;
  }

  function resolveEvolutionInstanceDailyLimit(instance) {
    const override = Number.parseInt(String(instance?.daily_limit_override ?? ""), 10);
    if (Number.isInteger(override) && override > 0) return override;
    const state = normalizeString(instance?.chip_state) === "warm" ? "warm" : "cold";
    return EVOLUTION_CHIP_DAILY_QUOTA_DEFAULTS[state];
  }

  async function reserveEvolutionInstanceDailyQuota(instanceId, dateStr = null) {
    if (!instanceId || !(await ensureEvolutionInstanceDailyUsageTable())) return null;
    const targetDate = dateStr || new Date().toISOString().slice(0, 10);
    const { rows } = await pgDatabasePool.query(
      `
        INSERT INTO public.evolution_instance_daily_usage (instance_id, date, sent_count)
        VALUES ($1::text, $2::date, 1)
        ON CONFLICT (instance_id, date)
        DO UPDATE SET sent_count = public.evolution_instance_daily_usage.sent_count + 1
        RETURNING sent_count
      `,
      [String(instanceId), targetDate]
    );
    return rows[0]?.sent_count ?? null;
  }

  async function getEvolutionInstanceDailyUsage(instanceId, dateStr = null) {
    if (!instanceId || !(await ensureEvolutionInstanceDailyUsageTable())) return 0;
    const targetDate = dateStr || new Date().toISOString().slice(0, 10);
    const { rows } = await pgDatabasePool.query(
      `SELECT sent_count FROM public.evolution_instance_daily_usage WHERE instance_id = $1::text AND date = $2::date`,
      [String(instanceId), targetDate]
    );
    return Number(rows[0]?.sent_count ?? 0);
  }

  async function releaseEvolutionInstanceDailyQuota(instanceId, dateStr = null) {
    if (!instanceId || !pgDatabasePool) return;
    const targetDate = dateStr || new Date().toISOString().slice(0, 10);
    await pgDatabasePool
      .query(
        `
          UPDATE public.evolution_instance_daily_usage
          SET sent_count = GREATEST(sent_count - 1, 0)
          WHERE instance_id = $1::text AND date = $2::date
        `,
        [String(instanceId), targetDate]
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
      `ALTER TABLE public.campaign_dispatch_runs ADD CONSTRAINT campaign_dispatch_runs_status_check CHECK (status IN ('pending','claimed','sent','failed','skipped','invalid_number'))`
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

    // Este e o caminho de envio REALMENTE em uso (fila de campaign_dispatches, acionada
    // pelo scheduler) — e ele NAO passa por getCampaignStepPlan, entao nunca produziu
    // step_plan nem gravou progresso via markCampaignLeadWaitingReply. Foi por isso que
    // a instrumentacao do runCampaignDispatch de campaign/dispatch.js nunca apareceu no
    // log: o codigo estava no ar, o caminho e que era outro.
    // Fluxo de resposta no caminho da fila. Ate aqui este runCampaignDispatch mandava
    // TODOS os passos de uma vez, inclusive os after_reply, e nunca gravava progresso
    // pendente — por isso o passo 2 saia na rajada inicial (ou nao saia) e
    // continueCampaignLeadFromReply nunca era alcancado.
    //
    // Reaproveita getCampaignStepPlan e markCampaignLeadWaitingReply, as mesmas do
    // outro caminho. Nao existe segunda implementacao da regra: ter duas foi o que
    // custou as ultimas rodadas.
    const stepPlan = getCampaignStepPlan({ ...campaignMeta, sequence: steps });
    const usaFluxoDeResposta = stepPlan.shouldUseReplyFlow && stepPlan.immediateSteps.length > 0;
    const passosDoEnvio = usaFluxoDeResposta ? stepPlan.immediateSteps : stepPlan.enabledSteps;
    const primeiroPassoAposResposta = usaFluxoDeResposta
      ? (stepPlan.replySteps[0]?.index ?? null)
      : null;

    console.info("[campaign-dispatch] plano", {
      dispatchId,
      campaignId: campaign.id,
      clientId,
      origemDosPassos: dispatchSteps ? "dispatch.steps" : "campaign.analytics_meta.sequence",
      totalPassos: Array.isArray(steps) ? steps.length : 0,
      passosAposResposta: stepPlan.replySteps.length,
      waitForReplyDoMeta: stepPlan.analyticsMeta.dispatchOptions?.waitForReply ?? null,
      usaFluxoDeResposta,
      passosNesteEnvio: passosDoEnvio.length,
      primeiroPassoAposResposta,
    });

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
      importId: resolveCampaignImportSelection(campaign),
      limit: dispatch.limit_per_run ?? campaign.limit_per_run,
      offset: dispatch.offset ?? 0,
      segmentation: validation.analyticsMeta.segmentation || null,
      excludeDispatchId: dispatchId,
    });

    if (leads.length === 0) {
      let totalSent = 0;
      let totalFailed = 0;
      let totalInvalid = 0;
      let totalSkipped = 0;
      if (pgDatabasePool) {
        const countsRes = await pgDatabasePool.query(
          `SELECT 
             COUNT(*) FILTER (WHERE status = 'sent')::int as sent,
             COUNT(*) FILTER (WHERE status = 'failed')::int as failed,
             COUNT(*) FILTER (WHERE status = 'invalid_number')::int as invalid,
             COUNT(*) FILTER (WHERE status = 'skipped')::int as skipped
           FROM public.campaign_dispatch_runs
           WHERE dispatch_id = $1`,
          [dispatchId]
        ).catch(() => ({ rows: [] }));
        totalSent = Number(countsRes?.rows?.[0]?.sent || 0);
        totalFailed = Number(countsRes?.rows?.[0]?.failed || 0);
        totalInvalid = Number(countsRes?.rows?.[0]?.invalid || 0);
        totalSkipped = Number(countsRes?.rows?.[0]?.skipped || 0);
      }
      const totalProcessed = totalSent + totalFailed + totalInvalid + totalSkipped;
      const targetCount = Number(dispatch.target_count || 0) || totalProcessed;

      if (targetCount > 0 && totalProcessed < targetCount) {
        const pendingCount = targetCount - totalProcessed;
        const finalMsg = `Interrompido: ${pendingCount} lead(s) pendente(s) de envio.`;
        await db.from("campaign_dispatches").update({
          status: "interrupted",
          sent_count: totalSent,
          failed_count: totalFailed,
          error_message: finalMsg,
          updated_at: new Date().toISOString(),
        }).eq("id", dispatchId);
      } else {
        await db.from("campaign_dispatches").update({
          status: "done",
          sent_count: totalSent,
          failed_count: totalFailed,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error_message: null,
        }).eq("id", dispatchId);
      }
      return;
    }

    // ── Item 2: Validação prévia de números via Evolution API com cache ─────────
    let validLeads = leads;
    if (leads.length > 0) {
      try {
        const candidatePhones = leads
          .map((l) => normalizeString(l.telefone).replace(/\D/g, ""))
          .filter(Boolean);

        const validationMap = await validateWhatsappNumbersWithCache({
          pool: pgDatabasePool,
          webhookUrl,
          webhookToken,
          phones: candidatePhones,
        });

        const invalidLeads = [];
        validLeads = [];

        for (const l of leads) {
          const cleanPhone = normalizeString(l.telefone).replace(/\D/g, "");
          const validation = cleanPhone ? validationMap.get(cleanPhone) : null;

          if (validation && validation.exists === false) {
            invalidLeads.push(l);
          } else {
            validLeads.push(l);
          }
        }

        if (invalidLeads.length > 0) {
          console.warn(
            `[campaign-dispatch] ${invalidLeads.length} número(s) INEXISTENTE(S) no WhatsApp detectado(s) na pré-validação — envio cancelado para eles:`,
            {
              dispatchId,
              campaignId: campaign.id,
              invalidCount: invalidLeads.length,
            }
          );

          if (pgDatabasePool) {
            for (const invLead of invalidLeads) {
              const cleanPhone = normalizeString(invLead.telefone).replace(/\D/g, "");
              if (invLead.id) {
                await pgDatabasePool.query(
                  `INSERT INTO public.campaign_dispatch_runs
                     (dispatch_id, campaign_id, client_id, lead_id, phone, status, error_message, created_at)
                   VALUES ($1, $2, $3, $4, $5, 'invalid_number', 'Número não existe no WhatsApp', now())
                   ON CONFLICT (dispatch_id, lead_id) DO UPDATE
                     SET status = 'invalid_number',
                         error_message = 'Número não existe no WhatsApp'`,
                  [dispatchId, campaign.id, clientId, invLead.id, cleanPhone]
                ).catch((err) => {
                  console.warn("[campaign-dispatch] falha ao registrar lead inválido:", err?.message || err);
                });
              } else if (cleanPhone) {
                await pgDatabasePool.query(
                  `INSERT INTO public.campaign_dispatch_runs
                     (dispatch_id, campaign_id, client_id, lead_id, phone, status, error_message, created_at)
                   VALUES ($1, $2, $3, NULL, $4, 'invalid_number', 'Número não existe no WhatsApp', now())`,
                  [dispatchId, campaign.id, clientId, cleanPhone]
                ).catch((err) => {
                  console.warn("[campaign-dispatch] falha ao registrar lead inválido por fone:", err?.message || err);
                });
              }
            }
          }
        }
      } catch (valErr) {
        console.warn("[campaign-dispatch] erro na pré-validação de números (disparo continuará sem travar):", valErr?.message || valErr);
        validLeads = leads;
      }
    }

    if (validLeads.length === 0) {
      let totalSent = 0;
      let totalFailed = 0;
      let totalInvalid = 0;
      let totalSkipped = 0;
      if (pgDatabasePool) {
        const countsRes = await pgDatabasePool.query(
          `SELECT 
             COUNT(*) FILTER (WHERE status = 'sent')::int as sent,
             COUNT(*) FILTER (WHERE status = 'failed')::int as failed,
             COUNT(*) FILTER (WHERE status = 'invalid_number')::int as invalid,
             COUNT(*) FILTER (WHERE status = 'skipped')::int as skipped
           FROM public.campaign_dispatch_runs
           WHERE dispatch_id = $1`,
          [dispatchId]
        ).catch(() => ({ rows: [] }));
        totalSent = Number(countsRes?.rows?.[0]?.sent || 0);
        totalFailed = Number(countsRes?.rows?.[0]?.failed || 0);
        totalInvalid = Number(countsRes?.rows?.[0]?.invalid || 0);
        totalSkipped = Number(countsRes?.rows?.[0]?.skipped || 0);
      }
      const totalProcessed = totalSent + totalFailed + totalInvalid + totalSkipped;
      const targetCount = Number(dispatch.target_count || 0) || totalProcessed;

      if (targetCount > 0 && totalProcessed < targetCount) {
        const pendingCount = targetCount - totalProcessed;
        await db.from("campaign_dispatches").update({
          status: "interrupted",
          sent_count: totalSent,
          failed_count: totalFailed,
          error_message: `Interrompido: ${pendingCount} lead(s) pendente(s) de envio.`,
          updated_at: new Date().toISOString(),
        }).eq("id", dispatchId);
      } else {
        await db.from("campaign_dispatches").update({
          status: "done",
          sent_count: totalSent,
          failed_count: totalFailed,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          error_message: null,
        }).eq("id", dispatchId);
      }
      return;
    }

    // Apply database Round-Robin scheduling links to leads if they don't have one
    const sequenceRequiresSchedulingLink = (steps || []).some((s) => {
      const texts = [s.text, ...(Array.isArray(s.textVariants) ? s.textVariants : [])].filter(Boolean);
      return texts.some((t) => /\{\{\s*scheduling_link\s*\}\}/i.test(t));
    });

    let activeConsultantLinks = [];
    try {
      if (pgDatabasePool) {
        const consultantRes = await pgDatabasePool.query(
          "SELECT scheduling_link FROM public.crm_consultant_schedules WHERE client_id = $1 AND active = true ORDER BY name ASC",
          [clientId]
        );
        activeConsultantLinks = (consultantRes?.rows || [])
          .map((r) => r.scheduling_link)
          .filter((link) => Boolean(normalizeString(link)));
      }

      if (activeConsultantLinks.length > 0) {
        validLeads.forEach((lead, idx) => {
          if (!lead.normalized_data) {
            lead.normalized_data = {};
          }
          if (!lead.normalized_data.scheduling_link) {
            lead.normalized_data.scheduling_link = activeConsultantLinks[idx % activeConsultantLinks.length];
          }
        });
      }
    } catch (dbErr) {
      console.error("[campaign-dispatch] failed to apply consultant schedules to leads:", {
        clientId,
        error: dbErr?.message || dbErr,
      });
      if (sequenceRequiresSchedulingLink) {
        throw new Error(
          `Disparo interrompido: falha no banco de dados ao buscar agenda de consultores ({{scheduling_link}}): ${dbErr?.message || dbErr}`
        );
      }
    }

    // Se a campanha usa {{scheduling_link}}, nenhum lead pode ser disparado com a variável crua
    if (sequenceRequiresSchedulingLink) {
      const leadsSemLink = validLeads.filter((lead) => !normalizeString(lead.normalized_data?.scheduling_link));
      if (leadsSemLink.length > 0) {
        const motivo = activeConsultantLinks.length === 0
          ? "Nenhum consultor ativo com link de agendamento cadastrado para preencher {{scheduling_link}}."
          : `Link de agendamento ausente para ${leadsSemLink.length} de ${validLeads.length} lead(s).`;
        console.error("[campaign-dispatch] Disparo bloqueado por link de agendamento ausente:", {
          clientId,
          leadsSemLink: leadsSemLink.length,
          totalLeads: validLeads.length,
          motivo,
        });
        throw new Error(`Disparo interrompido: ${motivo}`);
      }
    }

    // Constrói analyticsMeta compatível com dispatchCampaignSequence
    const analyticsMeta = validation.analyticsMeta;

    // Anti-ban: pool de chips para rotação round-robin com cota diária.
    const tenantInstances = await getLeadClientEvolutionInstances(clientId);
    const activeInstances = tenantInstances.filter(
      (inst) => inst.active !== false && normalizeString(inst.dispatch_webhook_url)
    );
    let targetInstances = [];
    let chipMismatchWarning = null;

    if (dispatchEvolutionInstanceId) {
      const matched = activeInstances.filter(
        (inst) =>
          inst.id === dispatchEvolutionInstanceId ||
          inst.name === dispatchEvolutionInstanceId ||
          normalizeString(inst.dispatch_webhook_url) === normalizeString(dispatchEvolutionInstanceId)
      );

      if (matched.length > 0) {
        targetInstances = matched;
      } else {
        // ID configurado não encontrado nas instâncias ativas do tenant
        if (activeInstances.length === 0) {
          const pauseMsg = "Pausado — nenhum chip conectado para este cliente. Conecte um chip em Conexões para retomar.";
          console.warn("[campaign-dispatch] Nenhum chip conectado para este cliente:", {
            clientId,
            dispatchId,
            configuredInstanceId: dispatchEvolutionInstanceId,
          });
          await db.from("campaign_dispatches").update({
            status: "paused",
            error_message: pauseMsg,
            updated_at: new Date().toISOString(),
          }).eq("id", dispatchId);
          return;
        }

        if (activeInstances.length > 1) {
          // Mais de um chip ativo: NÃO escolhe sozinho! Pausa o lote e pede a escolha ao usuário.
          const pauseMsg = `Pausado — chip configurado não encontrado e existem múltiplos chips ativos (${activeInstances.length}). Selecione o chip desejado na campanha para retomar.`;
          console.warn("[campaign-dispatch] AVISO: Chip configurado não encontrado e existem múltiplos chips ativos. Pausando lote:", {
            clientId,
            dispatchId,
            configuredInstanceId: dispatchEvolutionInstanceId,
            activeChips: activeInstances.map((i) => ({ id: i.id, name: i.name })),
          });
          await db.from("campaign_dispatches").update({
            status: "paused",
            error_message: pauseMsg,
            updated_at: new Date().toISOString(),
          }).eq("id", dispatchId);
          return;
        }

        // Exatamente 1 chip ativo: fallback com log explícito e aviso visível na tela
        const singleChip = activeInstances[0];
        const singleChipName = singleChip.name || singleChip.id;
        chipMismatchWarning = `Chip configurado não encontrado. Enviando por ${singleChipName}.`;
        console.warn("[campaign-dispatch] AVISO: Chip configurado não encontrado, utilizando o único chip ativo do tenant:", {
          clientId,
          dispatchId,
          configuredInstanceId: dispatchEvolutionInstanceId,
          usedInstanceId: singleChip.id,
          usedInstanceName: singleChipName,
        });
        targetInstances = [singleChip];
      }
    } else {
      targetInstances = activeInstances;
    }

    const rotationPool = targetInstances;

    if (rotationPool.length > 0) {
      let anyOpen = false;
      let lastClosedName = null;
      for (const inst of rotationPool) {
        try {
          const health = await checkEvolutionInstanceHealth({
            webhookUrl: inst.dispatch_webhook_url,
            webhookToken: inst.dispatch_webhook_token,
            context: { clientId, dispatchId, campaignId: campaign.id },
          });
          if (health?.state && isEvolutionOpenState(health.state)) {
            anyOpen = true;
          } else {
            lastClosedName = inst.name || inst.id;
          }
        } catch (healthErr) {
          lastClosedName = inst.name || inst.id;
          console.warn("[campaign-dispatch] chip health check falhou:", {
            chip: inst.name,
            error: healthErr?.message || healthErr,
          });
        }
      }

      if (!anyOpen) {
        const errorMsg = `Pausado — chip desconectado (${lastClosedName || "WhatsApp"}). Reconecte o chip em Conexões para retomar.`;
        console.warn("[campaign-dispatch] Nenhum chip conectado para este disparo. Pausando lote imediatamente:", {
          dispatchId,
          campaignId: campaign.id,
          errorMsg,
        });
        await db.from("campaign_dispatches").update({
          status: "paused",
          error_message: errorMsg,
          updated_at: new Date().toISOString(),
        }).eq("id", dispatchId);
        return;
      }
    }

    const tenantSettings = await getLeadClientN8nSettings(clientId);
    const sendWindowConfig = resolveSendWindowConfig(tenantSettings);
    const tenantTimezone = sendWindowConfig.timezone || "America/Sao_Paulo";
    const todayDateKey = getDateKey(new Date(), tenantTimezone);

    let rotationCursor = 0;
    const chipProvider =
      rotationPool.length > 0
        ? async () => {
            let lastExhausted = null;
            for (let attempt = 0; attempt < rotationPool.length; attempt += 1) {
              const inst = rotationPool[(rotationCursor + attempt) % rotationPool.length];
              const limit = resolveEvolutionInstanceDailyLimit(inst);
              const reserved = await reserveEvolutionInstanceDailyQuota(inst.id, todayDateKey);

              if (reserved === null) {
                rotationCursor = (rotationCursor + attempt + 1) % rotationPool.length;
                return {
                  webhookUrl: normalizeString(inst.dispatch_webhook_url),
                  webhookToken: normalizeString(inst.dispatch_webhook_token) || null,
                  instanceId: inst.id,
                  instanceName: inst.name || inst.id,
                  sequence: null,
                  release: null,
                };
              }

              if (reserved > limit) {
                await releaseEvolutionInstanceDailyQuota(inst.id, todayDateKey);
                lastExhausted = {
                  exhausted: true,
                  chipName: inst.name || inst.id,
                  limitQuota: limit,
                  usedQuota: limit,
                  exhaustedQuotaMessage: `Pausado — cota diária do chip atingida (${limit}/${limit}). Retoma amanhã.`,
                };
                continue;
              }

              rotationCursor = (rotationCursor + attempt + 1) % rotationPool.length;
              return {
                webhookUrl: normalizeString(inst.dispatch_webhook_url),
                webhookToken: normalizeString(inst.dispatch_webhook_token) || null,
                instanceId: inst.id,
                instanceName: inst.name || inst.id,
                sequence: reserved,
                release: () => releaseEvolutionInstanceDailyQuota(inst.id, todayDateKey),
                limitQuota: limit,
                usedQuota: reserved,
              };
            }
            return lastExhausted || {
              exhausted: true,
              chipName: rotationPool[0]?.name || "WhatsApp",
              limitQuota: resolveEvolutionInstanceDailyLimit(rotationPool[0]),
              usedQuota: resolveEvolutionInstanceDailyLimit(rotationPool[0]),
              exhaustedQuotaMessage: `Pausado — cota diária do chip atingida (${resolveEvolutionInstanceDailyLimit(rotationPool[0])}/${resolveEvolutionInstanceDailyLimit(rotationPool[0])}). Retoma amanhã.`,
            };
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

    // ── GARANTIA DURA INEGOCIÁVEL (Item 1a): ──────────────────────────────────
    // Nenhum caminho pode enviar para um destinatário que já está 'sent' ou 'invalid_number' neste lote.
    const claimLead = async ({ lead, phone }) => {
      if (!pgDatabasePool) return true;

      const cleanPhone = normalizeString(phone || lead?.telefone).replace(/\D/g, "");

      // 1. Checagem dura incondicional no banco de dados
      try {
        const existingRun = await pgDatabasePool.query(
          `SELECT id, status FROM public.campaign_dispatch_runs
           WHERE dispatch_id = $1 AND (
             ($2::uuid IS NOT NULL AND lead_id = $2) OR
             (regexp_replace(phone, '\\D', '', 'g') = $3)
           ) AND status IN ('sent', 'invalid_number')
           LIMIT 1`,
          [dispatchId, lead?.id || null, cleanPhone]
        );
        if (existingRun.rows.length > 0) {
          console.warn(
            `[campaign-dispatch] 🚨 BLOQUEIO DURO DE SEGURANÇA: Destinatário (${cleanPhone}) já possui status '${existingRun.rows[0].status}' neste lote. Envio abortado imediatamente!`,
            { dispatchId, leadId: lead?.id, phone: cleanPhone }
          );
          return false;
        }
      } catch (checkErr) {
        console.warn("[campaign-dispatch] aviso ao checar duplicidade de envio:", checkErr?.message || checkErr);
      }

      if (!lead?.id) {
        const alvo = cleanPhone || normalizeString(phone);
        if (!alvo) return true;
        const { rows } = await pgDatabasePool.query(
          `SELECT 1 FROM public.campaign_dispatch_runs
             WHERE dispatch_id = $1 AND phone = $2 LIMIT 1`,
          [dispatchId, alvo]
        );
        if (rows.length > 0) {
          console.warn("[campaign-dispatch] reenvio bloqueado: telefone ja tocado neste disparo", {
            dispatchId,
            campaignId: campaign.id,
          });
          return false;
        }
        await pgDatabasePool
          .query(
            `INSERT INTO public.campaign_dispatch_runs
               (dispatch_id, campaign_id, client_id, lead_id, phone, status, claimed_at, created_at)
             VALUES ($1, $2, $3, NULL, $4, 'claimed', now(), now())`,
            [dispatchId, campaign.id, clientId, alvo]
          )
          .catch((err) => {
            console.warn("[campaign-dispatch] claim por telefone falhou:", err?.message || err);
          });
        return true;
      }

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
      if (rows.length === 0) {
        console.warn("[campaign-dispatch] reenvio bloqueado: lead ja tocado neste disparo", {
          dispatchId,
          campaignId: campaign.id,
          leadId: lead.id,
        });
      }
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

    const finalizeLeadFailed = async ({ lead, phone, reason }) => {
      if (!pgDatabasePool) return;
      const isInvalidNumber = Boolean(
        reason && (
          /não existe no whatsapp/i.test(reason) ||
          /invalid_number/i.test(reason) ||
          /number does not exist/i.test(reason) ||
          /não está no whatsapp/i.test(reason) ||
          /not on whatsapp/i.test(reason)
        )
      );
      const newStatus = isInvalidNumber ? "invalid_number" : "failed";
      const cleanPhone = normalizeString(phone || lead?.telefone).replace(/\D/g, "");

      if (lead?.id) {
        await pgDatabasePool
          .query(
            `UPDATE public.campaign_dispatch_runs SET status = $1, error_message = $2 WHERE dispatch_id = $3 AND lead_id = $4`,
            [newStatus, reason || null, dispatchId, lead.id]
          )
          .catch((err) => {
            console.warn("[campaign-dispatch] finalize_failed_failed:", err?.message || err);
          });
      } else if (cleanPhone) {
        await pgDatabasePool
          .query(
            `UPDATE public.campaign_dispatch_runs SET status = $1, error_message = $2 WHERE dispatch_id = $3 AND regexp_replace(phone, '\\D', '', 'g') = $4`,
            [newStatus, reason || null, dispatchId, cleanPhone]
          )
          .catch((err) => {
            console.warn("[campaign-dispatch] finalize_failed_failed by phone:", err?.message || err);
          });
      }

      if (isInvalidNumber && cleanPhone) {
        await pgDatabasePool.query(
          `INSERT INTO public.whatsapp_number_validations (phone, exists_whatsapp, validated_at)
           VALUES ($1, false, now())
           ON CONFLICT (phone) DO UPDATE SET exists_whatsapp = false, validated_at = now()`,
          [cleanPhone]
        ).catch(() => {});
      }
    };

    const rollbackClaimLead = async ({ lead, phone }) => {
      if (!pgDatabasePool) return;
      if (lead?.id) {
        await pgDatabasePool.query(
          `DELETE FROM public.campaign_dispatch_runs WHERE dispatch_id = $1 AND lead_id = $2 AND status = 'claimed'`,
          [dispatchId, lead.id]
        ).catch(() => {});
      } else if (phone) {
        await pgDatabasePool.query(
          `DELETE FROM public.campaign_dispatch_runs WHERE dispatch_id = $1 AND phone = $2 AND status = 'claimed'`,
          [dispatchId, normalizeString(phone)]
        ).catch(() => {});
      }
    };

    let sentCount = 0;
    let failedCount = 0;
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

      if (current?.status !== "running") {
        return false;
      }

      // Checa se a janela de envio permitida do tenant fechou durante o processamento do lote
      try {
        const tenantSettings = await getLeadClientN8nSettings(clientId);
        const sendWindowConfig = resolveSendWindowConfig(tenantSettings);
        if (!isWithinSendWindow(new Date(), sendWindowConfig)) {
          const pauseMsg = `Pausado — fora da janela de envio (${sendWindowConfig.start}–${sendWindowConfig.end}). Retomará automaticamente na próxima janela.`;
          console.info("[campaign-dispatch] Janela de envio fechou durante a execução do lote. Pausando lote:", {
            dispatchId,
            campaignId: campaign.id,
            clientId,
            pauseMsg,
          });
          await db
            .from("campaign_dispatches")
            .update({
              status: "paused",
              error_message: pauseMsg,
              updated_at: new Date().toISOString(),
            })
            .eq("id", dispatchId);
          return false;
        }
      } catch (err) {
        console.warn("[campaign-dispatch] erro ao verificar janela de envio durante lote:", err?.message || err);
      }

      return true;
    };

    const result = await dispatchCampaignSequence({
      webhookUrl,
      webhookToken,
      leads: validLeads,
      analyticsMeta: usaFluxoDeResposta
        ? {
            ...analyticsMeta,
            sequence: passosDoEnvio,
            dispatchOptions: { ...analyticsMeta.dispatchOptions, waitForReply: false },
          }
        : analyticsMeta,
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
      onLeadClaimRollback: rollbackClaimLead,
      onStepDispatched: async ({ lead, phone, step, sentAt, instanceName, activeChip }) => {
        try {
          const rawChip = activeChip?.instanceId || activeChip?.instanceName || instanceName || null;
          const { canonicalName } = await resolveInstanceIdentifier({ clientId, identifier: rawChip });
          const chipName = canonicalName || rawChip;
          await appendLeadMessage({
            clientId,
            campaignId: campaign.id,
            leadId: null,
            phone,
            senderType: "bot",
            direction: "outbound",
            messageText: step.text || (step.type === "image" ? `[Imagem: ${step.image?.name || "anexo"}]` : ""),
            deliveredAt: sentAt || new Date().toISOString(),
            messageTimestamp: sentAt || new Date().toISOString(),
            instanceName: chipName,
            meta: {
              source: "campaign_dispatch",
              dispatchId,
              stepId: step.id,
              stepType: step.type,
              stepOrder: step.order,
            },
          });
        } catch (err) {
          console.warn("[campaign-dispatch] falha ao gravar lead_messages do passo:", err?.message || err);
        }
      },
      onLeadFailed: async ({ lead, phone, reason }) => {
        failedCount += 1;
        await finalizeLeadFailed({ lead, phone, reason });
      },
      onLeadDispatched: async ({ lead, phone, sentAt, lastStep, lastStepIndex }) => {
        sentCount += 1;
        await finalizeLeadSent({ lead, sentAt });

        if (usaFluxoDeResposta) {
          await markCampaignLeadWaitingReply({
            clientId,
            lead,
            phone,
            campaign,
            step: lastStep,
            stepIndex: Number.isInteger(lastStepIndex) ? lastStepIndex : passosDoEnvio.length - 1,
            totalSteps: stepPlan.enabledSteps.length,
            dispatchedAt: sentAt || new Date().toISOString(),
            nextStepIndex: primeiroPassoAposResposta,
            status: "aguardando_usuario",
          }).catch((err) => {
            console.warn("[campaign-dispatch] falha ao gravar progresso de espera", {
              dispatchId,
              campaignId: campaign.id,
              error: err?.message || err,
            });
          });
        }
        const leadPatch = {
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
      },
      shouldContinue: isDispatchStillRunning,
      leadDelayProvider: Number.isFinite(dispatch.dispatch_options?.leadDelaySeconds)
        ? () => Math.max(Number(dispatch.dispatch_options.leadDelaySeconds), 0) * 1000
        : () => 30_000 + Math.floor(Math.random() * 60_001),
    });

    let totalSent = sentCount;
    let totalFailed = failedCount;
    let totalInvalid = 0;
    let totalSkipped = 0;
    if (pgDatabasePool) {
      const countsRes = await pgDatabasePool.query(
        `SELECT 
           COUNT(*) FILTER (WHERE status = 'sent')::int as sent,
           COUNT(*) FILTER (WHERE status = 'failed')::int as failed,
           COUNT(*) FILTER (WHERE status = 'invalid_number')::int as invalid,
           COUNT(*) FILTER (WHERE status = 'skipped')::int as skipped
         FROM public.campaign_dispatch_runs
         WHERE dispatch_id = $1`,
        [dispatchId]
      ).catch(() => ({ rows: [] }));
      totalSent = Number(countsRes?.rows?.[0]?.sent ?? sentCount);
      totalFailed = Number(countsRes?.rows?.[0]?.failed ?? failedCount);
      totalInvalid = Number(countsRes?.rows?.[0]?.invalid ?? 0);
      totalSkipped = Number(countsRes?.rows?.[0]?.skipped ?? 0);
    }
    const totalProcessed = totalSent + totalFailed + totalInvalid + totalSkipped;
    const targetCount = Number(dispatch.target_count || 0) || (leads.length + totalProcessed);

    if (result?.summary?.chipDisconnected) {
      const chipDesc = result.summary.disconnectedChipName || "WhatsApp";
      await db.from("campaign_dispatches").update({
        status: "paused",
        sent_count: totalSent,
        failed_count: totalFailed,
        error_message: `Pausado — chip desconectado (${chipDesc}). Reconecte o chip em Conexões para retomar.`,
        updated_at: new Date().toISOString(),
      }).eq("id", dispatchId);
      return;
    }

    if (result?.summary?.allChipsExhausted) {
      const quotaMsg = result.summary.exhaustedQuotaMessage || "Pausado — cota diária do chip atingida. Retoma amanhã.";
      await db.from("campaign_dispatches").update({
        status: "paused",
        sent_count: totalSent,
        failed_count: totalFailed,
        error_message: quotaMsg,
        updated_at: new Date().toISOString(),
      }).eq("id", dispatchId);
      return;
    }

    if (result?.summary?.paused) {
      await db.from("campaign_dispatches").update({
        status: "paused",
        sent_count: totalSent,
        failed_count: totalFailed,
        error_message: "Disparo pausado manualmente.",
        updated_at: new Date().toISOString(),
      }).eq("id", dispatchId);
      return;
    }

    // REGRA RÍGIDA: Lote só pode ser 'done' quando TODO lead tiver um desfecho registrado
    if (targetCount > 0 && totalProcessed < targetCount) {
      const pendingCount = targetCount - totalProcessed;
      const finalMsg = `Interrompido: ${pendingCount} lead(s) pendente(s) de envio.`;
      await db.from("campaign_dispatches").update({
        status: "interrupted",
        sent_count: totalSent,
        failed_count: totalFailed,
        error_message: finalMsg,
        updated_at: new Date().toISOString(),
      }).eq("id", dispatchId);
      return;
    }

    await db.from("campaign_dispatches").update({
      status: "done",
      sent_count: totalSent,
      failed_count: totalFailed,
      finished_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      error_message: chipMismatchWarning || null,
    }).eq("id", dispatchId);
  }

  // ── Campaign Dispatches CRUD ─────────────────────────────────────────────────

  // GET /api/dispatches — lista todos os disparos de um tenant (todas as campanhas)
  app.get("/api/dispatches", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
          SELECT 
            d.*,
            c.name as campaign_name,
            COALESCE(r.sent_cnt, d.sent_count, 0)::int as sent_count,
            COALESCE(r.failed_cnt, d.failed_count, 0)::int as failed_count,
            COALESCE(r.invalid_cnt, 0)::int as invalid_count,
            COALESCE(r.skipped_cnt, 0)::int as skipped_count
          FROM public.campaign_dispatches d
          LEFT JOIN public.campaigns c ON c.id = d.campaign_id
          LEFT JOIN (
            SELECT 
              dispatch_id,
              COUNT(*) FILTER (WHERE status = 'sent') as sent_cnt,
              COUNT(*) FILTER (WHERE status = 'failed') as failed_cnt,
              COUNT(*) FILTER (WHERE status = 'invalid_number') as invalid_cnt,
              COUNT(*) FILTER (WHERE status = 'skipped') as skipped_cnt
            FROM public.campaign_dispatch_runs
            GROUP BY dispatch_id
          ) r ON r.dispatch_id = d.id
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
  app.get("/api/campaigns/:id/dispatches", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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

      if (!pgDatabasePool) {
        const { data, error } = await supabase
          .from("campaign_dispatches")
          .select("*")
          .eq("campaign_id", campaignId)
          .eq("client_id", authorizedClientId)
          .order("created_at", { ascending: true });
        if (error) throw error;
        return res.json({ dispatches: data || [] });
      }

      const { rows } = await pgDatabasePool.query(
        `
          SELECT 
            d.*,
            COALESCE(r.sent_cnt, d.sent_count, 0)::int as sent_count,
            COALESCE(r.failed_cnt, d.failed_count, 0)::int as failed_count,
            COALESCE(r.invalid_cnt, 0)::int as invalid_count,
            COALESCE(r.skipped_cnt, 0)::int as skipped_count
          FROM public.campaign_dispatches d
          LEFT JOIN (
            SELECT 
              dispatch_id,
              COUNT(*) FILTER (WHERE status = 'sent') as sent_cnt,
              COUNT(*) FILTER (WHERE status = 'failed') as failed_cnt,
              COUNT(*) FILTER (WHERE status = 'invalid_number') as invalid_cnt,
              COUNT(*) FILTER (WHERE status = 'skipped') as skipped_cnt
            FROM public.campaign_dispatch_runs
            GROUP BY dispatch_id
          ) r ON r.dispatch_id = d.id
          WHERE d.campaign_id = $1 AND d.client_id = $2
          ORDER BY d.created_at ASC
        `,
        [campaignId, authorizedClientId]
      );
      res.json({ dispatches: rows });
    } catch (err) {
      sendError(res, 500, "DISPATCHES_FETCH_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // GET /api/campaigns/dispatches/:dispatchId/preview-leads — Retorna amostra de leads que um dispatch deve atingir
  app.get("/api/campaigns/dispatches/:dispatchId/preview-leads", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
        .select("import_id, analytics_meta")
        .eq("id", dispatch.campaign_id)
        .single();

      if (campaignErr || !campaign) return sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");

      const previewLeads = await buildDispatchLeads({
        clientId: authorizedClientId,
        importId: resolveCampaignImportSelection(campaign),
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

  function translateDispatchErrorMessage(rawError) {
    if (!rawError) return null;
    const s = String(rawError).trim();
    if (s.includes('"exists":false') || s.includes('"exists": false') || s.includes('"exists":false')) {
      return "Número não existe no WhatsApp";
    }
    if (s.includes("HTTP 400") || s.includes("Bad Request")) {
      return "Número inválido ou rejeitado pelo WhatsApp";
    }
    if (s.includes("HTTP 404") || s.includes("Instance not found") || s.includes("desconectad")) {
      return "Chip desconectado ou não encontrado na Evolution";
    }
    if (s.includes("AbortError") || s.includes("timeout") || s.includes("Timeout")) {
      return "Tempo limite excedido ao chamar a Evolution";
    }
    if (s.includes("Opt-out") || s.includes("opt-out")) {
      return "Lead solicitou não receber mensagens (Opt-out)";
    }
    if (s.includes("reinício do servidor") || s.includes("interrompido") || s.includes("Interrompido")) {
      return "Envio interrompido antes da confirmação";
    }
    if (s.includes("HTTP 500") || s.includes("HTTP 502") || s.includes("HTTP 503")) {
      return "Instabilidade temporária no servidor Evolution";
    }
    return s.length > 80 ? `${s.slice(0, 77)}...` : s;
  }

  // GET /api/campaigns/dispatches/:dispatchId/recipients — Lista completa de destinatários com status, motivo e exportação
  app.get("/api/campaigns/dispatches/:dispatchId/recipients", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
    if (!ensureDb(res)) return;
    const dispatchId = normalizeString(req.params.dispatchId);
    if (!dispatchId) return sendError(res, 400, "MISSING_ID", "Missing dispatch id");

    try {
      const { data: dispatch, error: dispatchErr } = await supabase
        .from("campaign_dispatches")
        .select("id, client_id, campaign_id, name, limit_per_run, offset, steps, status, target_count")
        .eq("id", dispatchId)
        .maybeSingle();

      if (dispatchErr || !dispatch) return sendError(res, 404, "DISPATCH_NOT_FOUND", "Dispatch not found");
      const authorizedClientId = resolveAuthorizedClientId(req, res, dispatch.client_id);
      if (!authorizedClientId) return;

      const { data: campaign, error: campErr } = await supabase
        .from("campaigns")
        .select("id, name, import_id, analytics_meta")
        .eq("id", dispatch.campaign_id)
        .single();

      if (campErr || !campaign) return sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");

      // 1. Busca todos os leads candidatos do lote
      const allCandidateLeads = await buildDispatchLeads({
        clientId: authorizedClientId,
        importId: resolveCampaignImportSelection(campaign),
        limit: dispatch.limit_per_run,
        offset: dispatch.offset,
        segmentation: dispatch.steps?.[0]?.segmentation || null,
        excludeDispatchId: null,
      });

      // 2. Busca todas as execuções registradas deste disparo em campaign_dispatch_runs
      const { data: runsData, error: runsErr } = await supabase
        .from("campaign_dispatch_runs")
        .select("dispatch_id, lead_id, phone, status, error_message, claimed_at, sent_at, created_at")
        .eq("dispatch_id", dispatchId)
        .order("created_at", { ascending: true });

      if (runsErr) throw runsErr;
      const runs = runsData || [];

      const runByLeadId = new Map();
      const runByPhone = new Map();
      for (const r of runs) {
        if (r.lead_id) runByLeadId.set(r.lead_id, r);
        if (r.phone) {
          const clean = normalizeString(r.phone).replace(/\D/g, "");
          if (clean) runByPhone.set(clean, r);
        }
      }

      // 3. Monta lista detalhada de destinatários
      const recipients = allCandidateLeads.map((lead, idx) => {
        const cleanPhone = normalizeString(lead.telefone).replace(/\D/g, "");
        const run = (lead.id ? runByLeadId.get(lead.id) : null) || (cleanPhone ? runByPhone.get(cleanPhone) : null);
        const rawStatus = run ? run.status : "pending";
        const statusLabel =
          rawStatus === "sent"
            ? "Enviado"
            : rawStatus === "invalid_number"
            ? "Número inválido"
            : rawStatus === "failed"
            ? "Falhou"
            : rawStatus === "skipped"
            ? "Pulado"
            : "Não processado";

        const failureReason = run?.error_message ? translateDispatchErrorMessage(run.error_message) : null;
        const sentAt = run?.sent_at || null;
        const createdAt = run?.created_at || null;

        return {
          index: idx + 1,
          leadId: lead.id || null,
          nome: lead.nome || "Sem nome",
          telefone: lead.telefone,
          status: rawStatus,
          statusLabel,
          sentAt,
          attemptedAt: createdAt,
          failureReason,
          technicalDetails: run?.error_message || null,
          campaignName: campaign.name,
          dispatchName: dispatch.name,
        };
      });

      // Filtro opcional por status na query (?status=sent, ?status=failed, ?status=invalid_number, etc)
      const filterStatus = normalizeString(req.query.status);
      const filteredRecipients = filterStatus
        ? recipients.filter((r) => r.status.toLowerCase() === filterStatus.toLowerCase())
        : recipients;

      const rawFormat = normalizeString(req.query.format);
      if (rawFormat && rawFormat.toLowerCase() === "csv") {
        const header = [
          "Nome",
          "Telefone",
          "Status",
          "Data e hora do envio",
          "Motivo da falha",
          "Campanha",
          "Lote",
          "Detalhe tecnico",
        ];
        const esc = (v) => {
          const s = v == null ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [header.join(",")];
        for (const r of filteredRecipients) {
          const sentDateStr = r.sentAt ? new Date(r.sentAt).toLocaleString("pt-BR") : (r.attemptedAt ? new Date(r.attemptedAt).toLocaleString("pt-BR") : "");
          lines.push(
            [
              r.nome,
              r.telefone,
              r.statusLabel,
              sentDateStr,
              r.failureReason || "",
              r.campaignName,
              r.dispatchName,
              r.technicalDetails || "",
            ]
              .map(esc)
              .join(",")
          );
        }
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="destinatarios-${dispatch.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.csv"`);
        return res.send(lines.join("\n"));
      }

      const sentCount = recipients.filter((r) => r.status === "sent").length;
      const failedCount = recipients.filter((r) => r.status === "failed").length;
      const invalidCount = recipients.filter((r) => r.status === "invalid_number").length;
      const skippedCount = recipients.filter((r) => r.status === "skipped").length;
      const pendingCount = recipients.filter((r) => r.status === "pending").length;

      res.json({
        dispatchId: dispatch.id,
        dispatchName: dispatch.name,
        campaignName: campaign.name,
        total: recipients.length,
        sentCount,
        failedCount,
        invalidCount,
        skippedCount,
        pendingCount,
        items: filteredRecipients,
      });
    } catch (err) {
      console.error("[dispatch-recipients] error:", err);
      sendError(res, 500, "DISPATCH_RECIPIENTS_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // POST /api/campaigns/dispatches/:dispatchId/retry-failed — Reenvia apenas os destinatários que falharam (EXCLUI números inválidos)
  app.post("/api/campaigns/dispatches/:dispatchId/retry-failed", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
    if (!ensureDb(res)) return;
    const dispatchId = normalizeString(req.params.dispatchId);
    if (!dispatchId) return sendError(res, 400, "MISSING_ID", "Missing dispatch id");

    try {
      const { data: dispatch, error: dispatchErr } = await supabase
        .from("campaign_dispatches")
        .select("id, client_id, campaign_id, name, status")
        .eq("id", dispatchId)
        .maybeSingle();

      if (dispatchErr || !dispatch) return sendError(res, 404, "DISPATCH_NOT_FOUND", "Dispatch not found");
      const authorizedClientId = resolveAuthorizedClientId(req, res, dispatch.client_id);
      if (!authorizedClientId) return;

      if (dispatch.status === "running") {
        return sendError(res, 409, "DISPATCH_RUNNING", "O lote já está em execução");
      }

      // 1. Remove os registros 'failed' de campaign_dispatch_runs para liberar reenvio
      // EXCLUI números inválidos (status='invalid_number' ou mensagens de 'não existe no WhatsApp')
      let retriedCount = 0;
      if (pgDatabasePool) {
        const deleteRes = await pgDatabasePool.query(
          `DELETE FROM public.campaign_dispatch_runs
           WHERE dispatch_id = $1
             AND status = 'failed'
             AND (error_message IS NULL OR (
               error_message NOT ILIKE '%não existe no whatsapp%' AND
               error_message NOT ILIKE '%invalid_number%' AND
               error_message NOT ILIKE '%não está no whatsapp%' AND
               error_message NOT ILIKE '%number does not exist%'
             ))
           RETURNING id`,
          [dispatchId]
        );
        retriedCount = deleteRes.rowCount || 0;
      } else {
        const { data: deletedRuns, error: deleteErr } = await supabase
          .from("campaign_dispatch_runs")
          .delete()
          .eq("dispatch_id", dispatchId)
          .eq("status", "failed")
          .select("id");
        if (deleteErr) throw deleteErr;
        retriedCount = deletedRuns?.length || 0;
      }

      if (retriedCount === 0) {
        return res.json({ success: true, message: "Nenhum lead com falha elegível para reenvio (números inválidos são preservados).", retriedCount: 0 });
      }

      // 2. Coloca o lote em 'scheduled' para o scheduler/motor pegar ou aciona imediatamente
      await supabase
        .from("campaign_dispatches")
        .update({
          status: "scheduled",
          scheduled_at: new Date().toISOString(),
          trigger_type: "manual",
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", dispatchId);

      res.json({
        success: true,
        message: `${retriedCount} lead(s) com falha liberado(s) para reenvio.`,
        retriedCount,
        dispatchId,
      });
    } catch (err) {
      console.error("[retry-failed] error:", err);
      sendError(res, 500, "RETRY_FAILED_ERROR", err instanceof Error ? err.message : "Failed to retry failed leads");
    }
  });

  // POST /api/campaigns/dispatches/backfill-interrupted-batches — Regulariza status de lotes concluídos
  app.post("/api/campaigns/dispatches/backfill-interrupted-batches", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
    if (!ensureDb(res)) return;
    const requestedClientId = normalizeString(req.query.clientId || req.body?.clientId);
    const authorizedClientId = resolveAuthorizedClientId(req, res, requestedClientId);
    if (!authorizedClientId) return;

    const campaignId = normalizeString(req.body?.campaignId);
    const dispatchIds = Array.isArray(req.body?.dispatchIds) ? req.body.dispatchIds.map(normalizeString).filter(Boolean) : [];

    if (!campaignId || dispatchIds.length === 0) {
      return sendError(res, 400, "INVALID_PAYLOAD", "campaignId e dispatchIds são obrigatórios");
    }

    try {
      if (!pgDatabasePool) return sendError(res, 503, "DB_UNAVAILABLE", "Database unavailable");
      const { rows, rowCount } = await pgDatabasePool.query(
        `
          UPDATE public.campaign_dispatches
          SET 
            status = 'done',
            error_message = NULL,
            finished_at = COALESCE(finished_at, updated_at, NOW()),
            updated_at = NOW()
          WHERE campaign_id = $1
            AND client_id = $2
            AND status = 'interrupted'
            AND id = ANY($3::uuid[])
          RETURNING id, name, status, sent_count, failed_count, updated_at
        `,
        [campaignId, authorizedClientId, dispatchIds]
      );
      res.json({ success: true, updatedCount: rowCount, batches: rows });
    } catch (err) {
      sendError(res, 500, "BACKFILL_FAILED", err instanceof Error ? err.message : "Backfill failed");
    }
  });

  // POST /api/campaigns/dispatches/:dispatchId/run-pending — Dispara apenas os destinatários não processados do lote
  app.post("/api/campaigns/dispatches/:dispatchId/run-pending", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
    if (!ensureDb(res)) return;
    const dispatchId = normalizeString(req.params.dispatchId);
    if (!dispatchId) return sendError(res, 400, "MISSING_ID", "Missing dispatch id");

    try {
      const { data: dispatch, error: dispatchErr } = await supabase
        .from("campaign_dispatches")
        .select("id, client_id, campaign_id, name, status, limit_per_run, offset, steps, evolution_instance_id")
        .eq("id", dispatchId)
        .maybeSingle();

      if (dispatchErr || !dispatch) return sendError(res, 404, "DISPATCH_NOT_FOUND", "Dispatch not found");
      const authorizedClientId = resolveAuthorizedClientId(req, res, dispatch.client_id);
      if (!authorizedClientId) return;

      if (dispatch.status === "running") {
        return sendError(res, 409, "DISPATCH_RUNNING", "O lote já está em execução");
      }

      const { data: campaign, error: campErr } = await supabase
        .from("campaigns")
        .select("id, name, client_id, import_id, limit_per_run, analytics_meta, webhook_url, webhook_token")
        .eq("id", dispatch.campaign_id)
        .single();
      if (campErr || !campaign) return sendError(res, 404, "CAMPAIGN_NOT_FOUND", "Campaign not found");

      // 1. Calcula quantos leads pendentes restam
      const pendingLeads = await buildDispatchLeads({
        clientId: authorizedClientId,
        importId: resolveCampaignImportSelection(campaign),
        limit: dispatch.limit_per_run ?? campaign.limit_per_run,
        offset: dispatch.offset ?? 0,
        excludeDispatchId: dispatchId,
      });

      if (pendingLeads.length === 0) {
        return res.json({
          success: true,
          message: "Todos os destinatários deste lote já foram processados. Nenhum lead pendente.",
          pendingCount: 0,
          dispatchId,
        });
      }

      // 2. Coloca o lote em 'running' e dispara em background
      const { data: claimed, error: claimErr } = await supabase
        .from("campaign_dispatches")
        .update({
          status: "running",
          triggered_at: new Date().toISOString(),
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", dispatchId)
        .neq("status", "running")
        .select("id");

      if (claimErr || !claimed || claimed.length === 0) {
        return sendError(res, 409, "DISPATCH_ALREADY_RUNNING", "Este disparo já está em execução");
      }

      res.json({
        success: true,
        message: `${pendingLeads.length} lead(s) pendente(s) em execução.`,
        pendingCount: pendingLeads.length,
        dispatchId,
      });

      runCampaignDispatch({ dispatch, campaign, supabase }).catch((err) => {
        console.error("[campaign-dispatch] run_pending_failed", { dispatchId, error: err.message });
        supabase.from("campaign_dispatches").update({
          status: "failed",
          error_message: err.message,
          finished_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", dispatchId);
      });
    } catch (err) {
      console.error("[run-pending] error:", err);
      sendError(res, 500, "RUN_PENDING_ERROR", err instanceof Error ? err.message : "Failed to run pending leads");
    }
  });

  // GET /api/campaigns/dispatches/:dispatchId/failed — leads falhados do disparo com motivo traduzido
  app.get("/api/campaigns/dispatches/:dispatchId/failed", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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

      const { data: campaign } = await supabase
        .from("campaigns")
        .select("id, name, import_id, analytics_meta")
        .eq("id", dispatch.campaign_id)
        .single();

      const { data, error } = await supabase
        .from("campaign_dispatch_runs")
        .select("dispatch_id, lead_id, phone, status, error_message, claimed_at, sent_at, created_at")
        .eq("dispatch_id", dispatchId)
        .eq("status", "failed")
        .order("created_at", { ascending: true });
      if (error) throw error;
      const rows = data || [];

      // Mapear nomes de contatos a partir da importação se disponível
      let nameMap = new Map();
      if (campaign) {
        try {
          const leads = await buildDispatchLeads({
            clientId: authorizedClientId,
            importId: resolveCampaignImportSelection(campaign),
            excludeDispatchId: null,
          });
          for (const l of leads) {
            if (l.telefone) {
              const clean = normalizeString(l.telefone).replace(/\D/g, "");
              if (clean) nameMap.set(clean, l.nome || "Sem nome");
            }
          }
        } catch {}
      }

      const formattedRows = rows.map((r) => {
        const cleanPhone = normalizeString(r.phone).replace(/\D/g, "");
        const nome = nameMap.get(cleanPhone) || "Sem nome";
        const failureReason = translateDispatchErrorMessage(r.error_message);
        return {
          ...r,
          nome,
          failureReason,
          campaignName: campaign?.name || "Campanha",
          dispatchName: dispatch.name,
        };
      });

      const rawFormat = normalizeString(req.query.format);
      if (rawFormat && rawFormat.toLowerCase() === "csv") {
        const header = ["Nome", "Telefone", "Status", "Data e hora do envio", "Motivo da falha", "Campanha", "Lote", "Detalhe tecnico"];
        const esc = (v) => {
          const s = v == null ? "" : String(v);
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [header.join(",")];
        for (const r of formattedRows) {
          const sentDateStr = r.sent_at ? new Date(r.sent_at).toLocaleString("pt-BR") : (r.created_at ? new Date(r.created_at).toLocaleString("pt-BR") : "");
          lines.push([
            r.nome,
            r.phone,
            "Falhou",
            sentDateStr,
            r.failureReason || "",
            r.campaignName,
            r.dispatchName,
            r.error_message || "",
          ].map(esc).join(","));
        }
        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="falhas-${dispatch.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.csv"`);
        return res.send(lines.join("\n"));
      }

      res.json({ dispatchId, dispatchName: dispatch.name, failedCount: formattedRows.length, items: formattedRows });
    } catch (err) {
      sendError(res, 500, "DISPATCH_FAILED_EXPORT_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  // GET /api/campaigns/reports/import-audit — Relatório de auditoria de leads da planilha
  app.get("/api/campaigns/reports/import-audit", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
  app.post("/api/campaigns/reports/create-import-from-subset", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
  app.post("/api/campaigns/reports/delete-import-items", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
  app.post("/api/campaigns/:id/dispatches", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
        .select("id, client_id, analytics_meta, campaign_prompt_id")
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
          importId: resolveCampaignImportSelection(campaign),
          limit: limitPerRun,
          offset: offset,
          segmentation: validation.analyticsMeta.sequence?.[0]?.segmentation || null,
          excludeDispatchId: null
        });
        targetCount = previewLeads.length;
      } catch (err) {
        console.error("Erro ao calcular target_count:", err);
      }

      // Roteiro do agente ISOLADO por disparo: o disparo nasce com uma COPIA da linha
      // de campaign_prompts da campanha, nao com um ponteiro para ela. Assim, editar o
      // roteiro da campanha nao muda disparo em andamento, e corrigir o roteiro de um
      // disparo nao afeta a campanha nem os outros disparos.
      //
      // Copia, e nao congelamento: o roteiro do disparo continua editavel. Roteiro
      // imutavel prenderia o dono numa campanha defeituosa — se a IA responde errado,
      // a unica saida seria cancelar, e quem ja recebeu nao abre a mensagem de novo.
      //
      // Falha na copia nao impede o disparo: fica NULL e o caminho antigo (roteiro da
      // campanha) assume, que e o comportamento de hoje.
      let dispatchPromptId = null;
      if (campaign.campaign_prompt_id) {
        try {
          const { data: promptOrigem } = await supabase
            .from("campaign_prompts")
            .select("name, content")
            .eq("id", campaign.campaign_prompt_id)
            .eq("client_id", authorizedClientId)
            .maybeSingle();

          if (promptOrigem?.content) {
            // As opcoes de resposta dos passos entram no roteiro DESTE disparo. Sem
            // isso o lead le "1. Quero agendar", responde "1", e o agente nao faz
            // ideia do que e — o recurso viraria texto decorativo. Como a copia e
            // por disparo, o agente sabe exatamente as opcoes que aquele lead viu.
            const contextoDasOpcoes = buildStepOptionsContext(validation.analyticsMeta.sequence);
            const conteudoFinal = contextoDasOpcoes
              ? `${promptOrigem.content}\n\n${contextoDasOpcoes}`
              : promptOrigem.content;

            const { data: copia, error: copiaErr } = await supabase
              .from("campaign_prompts")
              .insert({
                client_id: authorizedClientId,
                name: `${promptOrigem.name || "Roteiro"} — disparo ${name}`.slice(0, 200),
                content: conteudoFinal,
              })
              .select("id")
              .single();
            if (copiaErr) throw copiaErr;
            dispatchPromptId = copia?.id || null;
          }
        } catch (err) {
          console.warn("[campaign-dispatch] falha ao copiar roteiro do agente; usando o da campanha", {
            campaignId,
            error: err?.message || err,
          });
        }
      }

      const { data, error } = await supabase
        .from("campaign_dispatches")
        .insert({
          campaign_id: campaignId,
          client_id: authorizedClientId,
          name,
          steps: validation.analyticsMeta.sequence,
          campaign_prompt_id: dispatchPromptId,
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
  app.patch("/api/campaigns/dispatches/:dispatchId", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
  app.delete("/api/campaigns/dispatches/:dispatchId", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
  app.post("/api/campaigns/dispatches/:dispatchId/trigger", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
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
      if (!["draft", "scheduled", "failed", "paused", "interrupted"].includes(dispatch.status)) {
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

      // Claim atomico tambem no gatilho manual: `.neq("status","running")` impede que
      // dois cliques no botao — ou um clique concorrente com o ciclo do scheduler —
      // iniciem duas execucoes do mesmo disparo. Sem isso o mesmo passo sai duas vezes.
      const { data: claimedManual, error: claimManualErr } = await supabase
        .from("campaign_dispatches")
        .update({ status: "running", triggered_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq("id", dispatchId)
        .neq("status", "running")
        .select("id");

      if (claimManualErr) {
        return sendError(res, 500, "DISPATCH_CLAIM_FAILED", "Falha ao reivindicar o disparo", claimManualErr.message);
      }
      if (!claimedManual || claimedManual.length === 0) {
        return sendError(res, 409, "DISPATCH_ALREADY_RUNNING", "Este disparo já está em execução");
      }

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

    const rawMessageId = resolveMessageId(body) || null;

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
                .in("telefone", buildPhoneLookupVariants(phone));
            }
            fetch("http://localhost:3001/api/hardcoded-chat-webhook", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clientId,
                phone,
                message: replyText,
                waMessageId: rawMessageId,
                isInternalForward: true,
                source: "campaign-reply-webhook",
                ...(modelOverride ? { modelOverride } : {}),
              }),
            }).catch((err) => console.warn("[reply-webhook] chatbot_route_failed:", err.message));
          } else {
            fetch("http://localhost:3001/api/hardcoded-chat-webhook", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                clientId,
                phone,
                message: replyText,
                waMessageId: rawMessageId,
                isInternalForward: true,
                source: "campaign-reply-webhook",
              }),
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
              .in("telefone", buildPhoneLookupVariants(phone));
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
            messageTimestamp: repliedAt || new Date().toISOString(),
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
          body: JSON.stringify({
            clientId,
            phone,
            message: replyText,
            waMessageId: rawMessageId,
            isInternalForward: true,
            source: "campaign-reply-webhook",
          }),
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
          .in("telefone", buildPhoneLookupVariants(phone))
          .select("id"),
        supabase
          .from(leadsTableName(clientId))
          .update(leadsUpdatePayload)
          .eq("client_id", clientId)
          .in("telefone", buildPhoneLookupVariants(phone))
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
          messageTimestamp: repliedAt || new Date().toISOString(),
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

  // Roteiro do agente DAQUELE disparo. Endpoint proprio, por dispatchId, porque o
  // PUT /api/campaign-prompts faz upsert por (client_id, name) — editar por nome
  // colidiria entre copias de disparos diferentes, que e justamente o que o
  // isolamento evita.
  app.get("/api/campaigns/dispatches/:dispatchId/prompt", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
    if (!ensureDb(res)) return;
    const dispatchId = normalizeString(req.params.dispatchId);
    if (!dispatchId) return sendError(res, 400, "MISSING_ID", "Missing dispatch id");
    try {
      const { data: dispatch, error: dispatchErr } = await supabase
        .from("campaign_dispatches")
        .select("id, client_id, name, campaign_prompt_id")
        .eq("id", dispatchId)
        .single();
      if (dispatchErr || !dispatch) return sendError(res, 404, "DISPATCH_NOT_FOUND", "Dispatch not found");

      const authorizedClientId = resolveAuthorizedClientId(req, res, dispatch.client_id);
      if (!authorizedClientId) return;

      if (!dispatch.campaign_prompt_id) {
        // Disparo antigo, ou campanha sem roteiro: nao ha copia para editar.
        return res.json({ prompt: null, dispatchName: dispatch.name });
      }

      const { data: prompt } = await supabase
        .from("campaign_prompts")
        .select("id, name, content, updated_at")
        .eq("id", dispatch.campaign_prompt_id)
        .eq("client_id", authorizedClientId)
        .maybeSingle();

      res.json({ prompt: prompt || null, dispatchName: dispatch.name });
    } catch (err) {
      sendError(res, 500, "DISPATCH_PROMPT_FETCH_FAILED", err instanceof Error ? err.message : "Failed");
    }
  });

  app.patch("/api/campaigns/dispatches/:dispatchId/prompt", requireFirebaseAuth, requireCampaignDispatchAccess, async (req, res) => {
    if (!ensureDb(res)) return;
    const dispatchId = normalizeString(req.params.dispatchId);
    const content = typeof req.body?.content === "string" ? req.body.content : null;
    if (!dispatchId) return sendError(res, 400, "MISSING_ID", "Missing dispatch id");
    if (content === null) return sendError(res, 400, "INVALID_BODY", "content is required");

    try {
      const { data: dispatch, error: dispatchErr } = await supabase
        .from("campaign_dispatches")
        .select("id, client_id, campaign_prompt_id")
        .eq("id", dispatchId)
        .single();
      if (dispatchErr || !dispatch) return sendError(res, 404, "DISPATCH_NOT_FOUND", "Dispatch not found");

      const authorizedClientId = resolveAuthorizedClientId(req, res, dispatch.client_id);
      if (!authorizedClientId) return;
      if (!dispatch.campaign_prompt_id) {
        return sendError(res, 409, "DISPATCH_WITHOUT_PROMPT", "Este disparo não tem roteiro próprio para editar");
      }

      // Escopo por tenant no proprio UPDATE: o roteiro de um tenant nao pode ser
      // reescrito a partir do disparo de outro.
      const { data, error } = await supabase
        .from("campaign_prompts")
        .update({
          content,
          updated_at: new Date().toISOString(),
          updated_by_email: req.authAccess?.email ?? null,
        })
        .eq("id", dispatch.campaign_prompt_id)
        .eq("client_id", authorizedClientId)
        .select("id, name, content, updated_at")
        .single();
      if (error) throw error;

      res.json({ prompt: data });
    } catch (err) {
      sendError(res, 500, "DISPATCH_PROMPT_SAVE_FAILED", err instanceof Error ? err.message : "Failed");
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

  return {
    runCampaignDispatch,
    buildStepOptionsContext,
  };
}
