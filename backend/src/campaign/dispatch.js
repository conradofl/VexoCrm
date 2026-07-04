// Campaign dispatch + reply engine (movidos de server.js -- grupo D do mapa Onda 3, Run E).
// Movimento puro: corpos identicos aos de server.js na revisao 0ae005a (apos runs A-D; funcoes
// renumeradas mas nao alteradas). Ordem de declaracao segue o agrupamento funcional (dispatch,
// depois reply), nao a ordem fisica original -- declaracoes de funcao top-level sao hoisted,
// entao a reordenacao dentro do mesmo modulo nao muda semantica.
//
// NOTA DE TOPOLOGIA: o mapa original previa dispatch.js e reply.js como modulos separados, mas
// ha ciclo real de chamadas entre os dois grupos:
//   - executeCampaignDispatch (dispatch) chama markCampaignLeadWaitingReply,
//     updateLeadConversationState e updateLeadImportItemCampaignProgress (reply).
//   - startNextCampaignLeadInQueue e continueCampaignLeadFromReply (reply) chamam
//     buildDispatchLeads e getClientName (dispatch).
// Por isso os dois grupos foram fundidos neste unico arquivo, conforme a regra do run
// ("se a divisao em 4 criar ciclo interno, mescle os modulos conflitantes").

import { normalizeString } from "../textNormalize.js";
import { supabase } from "../services/database.js";
import { normalizeIsoDate } from "../services/httpInfra.js";
import {
  isMissingSchemaError,
  leadMatchesCampaignSegmentation,
} from "../services/analytics.js";
import {
  sanitizePhone,
  buildPhoneLookupVariants,
} from "../services/leadImport.js";
import { logCampaignDispatch, checkEvolutionInstanceHealth, DEFAULT_REQUEST_TIMEOUT_MS } from "../services/evolution.js";
import {
  getSegmentationCatalog,
  isFilterShape,
  normalizeFilters,
  leadMatchesSegmentation,
} from "../segmentation.js";
import {
  dispatchCampaignSequence,
  getCampaignStepPlan,
  normalizeCampaignAnalyticsMeta,
} from "../campaign-outbound.js";
import { maskPhoneForLog, leadsTableName } from "../services/tenant.js";
import {
  resolveCampaignDispatchSettings,
  getSafeDispatchSettingsLog,
  logCampaignReplyFlow,
  resolveEnvCampaignQualificationWebhookSettings,
} from "./settings.js";

// ---- dispatch ----

export async function getClientName(clientId) {
  if (!supabase) return clientId;

  const { data, error } = await supabase
    .from("leads_clients")
    .select("id, name")
    .eq("id", clientId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return data?.name || clientId;
}

// Catálogo de segmentação (fields[] + featuredKpis) do tenant. Leitura leve.
export async function getSegmentationCatalogForClient(clientId) {
  const empty = { version: 2, fields: [], featuredKpis: [] };
  if (!supabase || !clientId) return empty;
  const { data, error } = await supabase
    .from("lead_client_n8n_settings")
    .select("segmentation_config")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) {
    if (isMissingSchemaError(error)) return empty;
    throw error;
  }
  return getSegmentationCatalog(data?.segmentation_config);
}

export async function buildDispatchLeads({ clientId, importId = null, limit = null, offset = null, segmentation = null, excludeDispatchId = null }) {
  if (!supabase) return [];

  // Roteamento de segmentação unificada:
  //  - shape novo { filters:[...] } → catálogo do tenant + matcher genérico.
  //  - shape legado { gender, productType, ... } → matcher hardcoded (compat, não muda campanha antiga).
  let segMatcher;
  if (isFilterShape(segmentation)) {
    const catalog = await getSegmentationCatalogForClient(clientId);
    const filters = normalizeFilters(segmentation, catalog);
    segMatcher = (item) => leadMatchesSegmentation(item, catalog.fields, filters);
  } else {
    segMatcher = (item) => leadMatchesCampaignSegmentation(item, segmentation);
  }

  let query;
  if (importId === "__crm__") {
    query = supabase
      .from("leads")
      .select("id, client_id, telefone, created_at, nome, tipo_cliente, faixa_consumo, qualificacao, cidade, estado, status")
      .eq("client_id", clientId)
      .not("telefone", "is", null)
      .order("created_at", { ascending: false });
  } else {
    query = supabase
      .from("lead_import_items")
      .select("id, import_id, client_id, lead_id, telefone, normalized_data, created_at")
      .eq("client_id", clientId)
      .eq("imported", true)
      .not("telefone", "is", null)
      .order("created_at", { ascending: false });

    if (importId) {
      query = query.eq("import_id", importId);
    }
  }

  if (limit && Number.isInteger(limit) && limit > 0 && !segmentation && !excludeDispatchId && (!offset || offset === 0)) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) {
    throw error;
  }

  const leads = Array.from(
    new Map(
      (data || [])
        .map((item) => {
          const isCrm = importId === "__crm__";
          const normalizedData = isCrm
            ? item
            : (item.normalized_data && typeof item.normalized_data === "object" ? item.normalized_data : {});

          return {
            id: item.id,
            import_id: isCrm ? "__crm__" : item.import_id,
            client_id: item.client_id,
            lead_id: isCrm ? item.id : (item.lead_id || null),
            telefone: sanitizePhone(item.telefone),
            normalized_data: normalizedData,
            nome: normalizeString(isCrm ? item.nome : normalizedData.nome),
            tipo_cliente: normalizeString(isCrm ? item.tipo_cliente : normalizedData.tipo_cliente),
            faixa_consumo: normalizeString(isCrm ? item.faixa_consumo : normalizedData.faixa_consumo),
            cidade: normalizeString(isCrm ? item.cidade : normalizedData.cidade),
            estado: normalizeString(isCrm ? item.estado : normalizedData.estado),
            status: normalizeString(isCrm ? item.status : normalizedData.status),
            data_hora: normalizeIsoDate(isCrm ? item.created_at : normalizedData.data_hora),
            qualificacao: normalizeString(isCrm ? item.qualificacao : normalizedData.qualificacao),
            created_at: item.created_at,
          };
        })
        .filter((item) => !!item.telefone)
        .filter((item) => segMatcher(item))
        .map((item) => [item.telefone, item])
    ).values()
  );

  // Defeito A: elegibilidade por disparo. Remove da fila todo lead que JÁ tem registro
  // neste disparo (qualquer status: claimed/sent/failed) → já tocado = fora.
  // Escopo é POR DISPARO (excludeDispatchId), não histórico global do lead.
  let eligibleLeads = leads;
  if (excludeDispatchId) {
    const { data: touchedRows, error: touchedError } = await supabase
      .from("campaign_dispatch_runs")
      .select("lead_id")
      .eq("dispatch_id", excludeDispatchId);
    if (touchedError) {
      throw touchedError;
    }
    const touchedLeadIds = new Set(
      (touchedRows || [])
        .map((row) => row.lead_id)
        .filter((id) => id != null)
    );
    if (touchedLeadIds.size > 0) {
      eligibleLeads = leads.filter((lead) => !touchedLeadIds.has(lead.id));
    }
  }

  if (limit && Number.isInteger(limit) && limit > 0) {
    const start = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    return eligibleLeads.slice(start, start + limit);
  }

  return eligibleLeads;
}

/**
 * Monta a lista de telefones a gravar em `campaigns.phones` (os usados no disparo Evolution).
 * Prioriza o resumo do dispatch (mesmos valores do payload HTTP) para manter `campaigns.phones`
 * alinhado mesmo que os objetos lead usem nomes de campo alternativos ou normalização diferente.
 */
export function resolveCampaignPhonesForRow(leads, dispatchSummary) {
  const fromSummary = Array.isArray(dispatchSummary?.successPhones)
    ? dispatchSummary.successPhones.filter((p) => typeof p === "string" && p.trim())
    : [];
  const fromLeads = Array.isArray(leads)
    ? leads
      .map((lead) => lead?.telefone || lead?.phone || lead?.number)
      .filter((p) => typeof p === "string" && p.trim())
    : [];

  return [...new Set(
    [...fromLeads, ...fromSummary]
      .map(String)
      .filter((p) => /^\+?\d{8,15}$/.test(p.replace(/[\s\-().]/g, "")))
  )];
}

export function buildCampaignWebhookPayload({ campaign, clientName, leads, triggerSource = "manual" }) {
  const analyticsMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta);
  const message = normalizeString(analyticsMeta.message);
  const image = analyticsMeta.image && typeof analyticsMeta.image === "object" ? analyticsMeta.image : null;

  return {
    source: "vexocrm",
    action: "campaign_dispatch",
    triggerSource,
    campaignId: campaign.id,
    campaignName: campaign.name,
    userId: campaign.created_by_uid || null,
    requestedBy: {
      uid: campaign.created_by_uid || null,
      email: campaign.created_by_email || null,
    },
    requestedAt: new Date().toISOString(),
    scheduledFor: campaign.scheduled_for || null,
    client: { id: campaign.client_id, name: clientName },
    importId: campaign.import_id || null,
    limit: campaign.limit_per_run,
    segmentation: analyticsMeta.segmentation || null,
    message,
    image,
    media: image
      ? {
          kind: "image",
          name: image.name || "campanha",
          mimeType: image.type || "image/jpeg",
          size: image.size || null,
          dataUrl: image.dataUrl || null,
        }
      : null,
    total: leads.length,
    phones: leads.map((lead) => lead.telefone),
    leads: leads.map((lead) => ({
      id: lead.id,
      telefone: lead.telefone,
      nome: lead.nome,
      cidade: lead.cidade,
      estado: lead.estado,
      status: lead.status,
      tipo_cliente: lead.tipo_cliente,
      faixa_consumo: lead.faixa_consumo,
      qualificacao: lead.qualificacao,
      data_hora: lead.data_hora,
      created_at: lead.created_at,
    })),
  };
}

export async function insertCampaignDispatchLog({
  campaign,
  status,
  triggerSource,
  message = null,
  payload = null,
  n8nResponse = null,
  error = null,
  totalLeads = null,
  webhookStatus = null,
}) {
  if (!supabase || !campaign?.id) return;

  const { error: insertError } = await supabase.from("campaign_dispatch_logs").insert({
    campaign_id: campaign.id,
    client_id: campaign.client_id,
    status,
    trigger_source: triggerSource,
    message,
    total_leads: totalLeads,
    webhook_status: webhookStatus,
    payload,
    n8n_response: n8nResponse,
    error_message: error,
  });

  if (insertError && !isMissingSchemaError(insertError)) {
    console.error("campaign dispatch log insert error:", insertError);
  }
}

export function canCampaignBeDispatched(status) {
  return ["active", "draft", "scheduled", "failed"].includes(normalizeString(status));
}

export async function claimCampaignForDispatch(campaign, triggerSource) {
  const now = new Date().toISOString();
  const analyticsMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta);
  const processingMeta = {
    ...analyticsMeta,
    dispatch: {
      ...normalizeCampaignAnalyticsMeta(analyticsMeta.dispatch),
      status: "processing",
      triggerSource,
      startedAt: now,
      updatedAt: now,
      error: null,
    },
  };

  let { data, error } = await supabase
    .from("campaigns")
    .update({
      status: "processing",
      analytics_meta: processingMeta,
    })
    .eq("id", campaign.id)
    .is("last_triggered_at", null)
    .in("status", ["active", "draft", "scheduled", "failed"])
    .select("id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email, analytics_meta")
    .maybeSingle();

  if (error && isMissingSchemaError(error)) {
    const fallback = await supabase
      .from("campaigns")
      .update({ status: "processing" })
      .eq("id", campaign.id)
      .is("last_triggered_at", null)
      .in("status", ["active", "draft", "scheduled", "failed"])
      .select("id, name, client_id, import_id, limit_per_run, webhook_url, webhook_token, status, scheduled_for, last_triggered_at, archived_at, created_by_uid, created_by_email")
      .maybeSingle();
    data = fallback.data ? { ...fallback.data, analytics_meta: processingMeta } : fallback.data;
    error = fallback.error;
  }

  if (error) {
    throw error;
  }

  if (!data) {
    const lockError = new Error("Campaign is already processing or already sent");
    lockError.statusCode = 409;
    lockError.code = "CAMPAIGN_ALREADY_LOCKED";
    throw lockError;
  }

  await insertCampaignDispatchLog({
    campaign: data,
    status: "processing",
    triggerSource,
    message: "Campanha entrou em processamento.",
  });

  return data;
}

export async function markCampaignDispatchFailed(campaign, { triggerSource, error, webhookStatus = null }) {
  const now = new Date().toISOString();
  const analyticsMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta);
  const errorMessage = error instanceof Error ? error.message : String(error);
  const nextMeta = {
    ...analyticsMeta,
    dispatch: {
      ...normalizeCampaignAnalyticsMeta(analyticsMeta.dispatch),
      status: "failed",
      triggerSource,
      error: errorMessage,
      failedAt: now,
      updatedAt: now,
      webhookStatus,
    },
  };

  let { error: updateError } = await supabase
    .from("campaigns")
    .update({
      status: "failed",
      analytics_meta: nextMeta,
    })
    .eq("id", campaign.id);

  if (updateError && isMissingSchemaError(updateError)) {
    const fallback = await supabase
      .from("campaigns")
      .update({ status: "failed" })
      .eq("id", campaign.id);
    updateError = fallback.error;
  }

  if (updateError) {
    console.error("campaign failed state update error:", updateError);
  }

  await insertCampaignDispatchLog({
    campaign,
    status: "failed",
    triggerSource,
    message: "Falha ao disparar campanha.",
    error: errorMessage,
    webhookStatus,
  });
}

export async function executeCampaignDispatch(campaign, { triggerSource = "manual" } = {}) {
  if (!supabase) {
    throw new Error("Database is not configured");
  }

  if (!campaign) {
    const error = new Error("Campaign not found");
    error.statusCode = 404;
    error.code = "CAMPAIGN_NOT_FOUND";
    throw error;
  }

  if (!canCampaignBeDispatched(campaign.status)) {
    const error = new Error(`Campaign cannot be dispatched from status ${campaign.status}`);
    error.statusCode = 400;
    error.code = "CAMPAIGN_NOT_DISPATCHABLE";
    throw error;
  }

  if (campaign.archived_at) {
    const error = new Error("Campaign is archived");
    error.statusCode = 400;
    error.code = "CAMPAIGN_ARCHIVED";
    throw error;
  }

  const claimedCampaign = await claimCampaignForDispatch(campaign, triggerSource);
  const analyticsMeta = normalizeCampaignAnalyticsMeta(claimedCampaign.analytics_meta);
  const leads = await buildDispatchLeads({
    clientId: claimedCampaign.client_id,
    importId: claimedCampaign.import_id || null,
    limit: claimedCampaign.limit_per_run,
    segmentation: analyticsMeta.segmentation || null,
  });

  if (leads.length === 0) {
    const error = new Error("No leads found for this campaign");
    error.statusCode = 404;
    error.code = "NO_DISPATCH_LEADS";
    await markCampaignDispatchFailed(claimedCampaign, { triggerSource, error });
    throw error;
  }

  const clientName = await getClientName(claimedCampaign.client_id);

  // Campaign dispatch uses the same Evolution pipeline as POST /api/campaigns/direct-dispatch:
  // - URL/token from tenant settings (resolveDispatchWebhookSettings), optionally cached on the row.
  // - Per-lead execution via dispatchCampaignSequence: step order, delayAfterSeconds between steps,
  //   leadDelaySeconds between leads, waitForReply / reply timeouts from analytics_meta.dispatchOptions.
  // Always use the same Evolution endpoint as direct dispatch (tenant settings), not the global n8n webhook env.
  const dispatchSettings = await resolveCampaignDispatchSettings(claimedCampaign.client_id, claimedCampaign);
  const { webhookUrl, webhookToken } = dispatchSettings;
  logCampaignDispatch("info", "settings_resolved", {
    clientId: claimedCampaign.client_id,
    campaignId: claimedCampaign.id,
    campaignName: claimedCampaign.name,
    triggerSource,
    mode: "campaign_dispatch",
    ...getSafeDispatchSettingsLog(dispatchSettings),
    usingCachedCampaignSettings: dispatchSettings.usingCachedCampaignSettings,
    tenantSettingsSource: dispatchSettings.tenantSettingsSource,
  });
  if (!webhookUrl) {
    const error = new Error("Configure uma URL ativa de disparo Evolution para esta empresa");
    error.statusCode = 400;
    error.code = "EVOLUTION_SETTINGS_MISSING";
    await markCampaignDispatchFailed(claimedCampaign, { triggerSource, error });
    throw error;
  }

  try {
    await checkEvolutionInstanceHealth({
      webhookUrl,
      webhookToken,
      context: {
        clientId: claimedCampaign.client_id,
        campaignId: claimedCampaign.id,
        campaignName: claimedCampaign.name,
        triggerSource,
        mode: "campaign_dispatch",
      },
    });
  } catch (error) {
    await markCampaignDispatchFailed(claimedCampaign, {
      triggerSource,
      error,
      webhookStatus: error?.statusCode || 502,
    });
    throw error;
  }

  const stepPlan = getCampaignStepPlan(claimedCampaign.analytics_meta);
  const meta = stepPlan.analyticsMeta;
  const waitForReply = stepPlan.shouldUseReplyFlow;
  const keepCampaignProcessing = waitForReply;
  const leadsToDispatch = leads;
  const immediateSteps = waitForReply ? stepPlan.immediateSteps : stepPlan.enabledSteps;
  const firstReplyStepIndex = waitForReply ? (stepPlan.replySteps[0]?.index ?? null) : null;

  if (waitForReply && immediateSteps.length === 0) {
    const error = new Error("Campanhas com resposta avancada precisam de pelo menos um passo imediato antes da resposta.");
    error.statusCode = 400;
    error.code = "CAMPAIGN_REPLY_FLOW_INVALID";
    await markCampaignDispatchFailed(claimedCampaign, { triggerSource, error });
    throw error;
  }

  let dispatchSummary = null;
  let webhookStatus = null;
  try {
    const { summary } = await dispatchCampaignSequence({
      webhookUrl,
      webhookToken,
      leads: leadsToDispatch,
      analyticsMeta: {
        ...meta,
        sequence: immediateSteps,
      },
      context: {
        campaign: {
          id: claimedCampaign.id,
          name: claimedCampaign.name,
          mode: "campaign_dispatch",
          triggerSource,
        },
        client: { id: claimedCampaign.client_id, name: clientName },
      },
      onLeadDispatched: async ({ lead, phone, sentAt, lastStep, lastStepIndex }) => {
        if (waitForReply) {
          await markCampaignLeadWaitingReply({
            clientId: claimedCampaign.client_id,
            lead,
            phone,
            campaign: claimedCampaign,
            step: lastStep,
            stepIndex: Number.isInteger(lastStepIndex) ? lastStepIndex : immediateSteps.length - 1,
            totalSteps: stepPlan.enabledSteps.length,
            dispatchedAt: sentAt || new Date().toISOString(),
            nextStepIndex: firstReplyStepIndex,
            status: "aguardando_usuario",
          });
        } else {
          // Campanha sem resposta: marcar como "em_atendimento" e depois "finalizado"
          await updateLeadConversationState({
            clientId: claimedCampaign.client_id,
            phone,
            statusConversa: "finalizado",
            ultimaInteracaoBot: sentAt || new Date().toISOString(),
          });
          if (lead?.id) {
            const progressPatch = {
              campaignId: claimedCampaign.id,
              campaignName: claimedCampaign.name || null,
              leadName: normalizeString(lead?.nome) || null,
              status: "finalizado",
              leadStatus: "sequencia_concluida",
              currentStepIndex: Number.isInteger(lastStepIndex) ? lastStepIndex : immediateSteps.length - 1,
              nextStepIndex: null,
              totalSteps: stepPlan.enabledSteps.length,
              updatedAt: sentAt || new Date().toISOString(),
              completedAt: sentAt || new Date().toISOString(),
            };
            await updateLeadImportItemCampaignProgress({
              clientId: claimedCampaign.client_id,
              leadImportItemId: lead.id,
              campaignId: claimedCampaign.id,
              progressPatch,
              statusConversa: "finalizado",
              ultimaInteracaoBot: sentAt || new Date().toISOString(),
            });
          }
        }
      },
    });
    dispatchSummary = summary;

    if (summary.successCount <= 0) {
      const firstReason = summary.failures[0]?.reason || "Evolution dispatch returned no successful sends";
      const error = new Error(firstReason);
      error.statusCode = 502;
      error.code = "EVOLUTION_TRIGGER_FAILED";
      await markCampaignDispatchFailed(claimedCampaign, { triggerSource, error, webhookStatus: 502 });
      throw error;
    }
    webhookStatus = 200;
  } catch (error) {
    if (error?.code !== "EVOLUTION_TRIGGER_FAILED") {
      await markCampaignDispatchFailed(claimedCampaign, { triggerSource, error, webhookStatus });
    }
    throw error;
  }

  const auditPayload = buildCampaignWebhookPayload({
    campaign: claimedCampaign,
    clientName,
    leads: leadsToDispatch,
    triggerSource,
  });
  const completedAt = new Date().toISOString();
  const nextAnalyticsMeta = {
    ...analyticsMeta,
    dispatch: {
      ...normalizeCampaignAnalyticsMeta(analyticsMeta.dispatch),
      status: keepCampaignProcessing ? "processing" : "sent",
      triggerSource,
      total: leadsToDispatch.length,
      successCount: dispatchSummary?.successCount ?? null,
      failureCount: dispatchSummary?.failureCount ?? null,
      webhookStatus,
      provider: "evolution",
      evolutionSummary: null,
      n8nResponse: null,
      sentAt: completedAt,
      updatedAt: completedAt,
    },
  };

  const phonesForRow = resolveCampaignPhonesForRow(leadsToDispatch, dispatchSummary);

  let { error: updateError } = await supabase
    .from("campaigns")
    .update({
      status: keepCampaignProcessing ? "processing" : "sent",
      last_triggered_at: completedAt,
      scheduled_for: null,
      phones: phonesForRow,
      analytics_meta: nextAnalyticsMeta,
    })
    .eq("id", campaign.id);

  if (updateError && isMissingSchemaError(updateError)) {
    const fallback = await supabase
      .from("campaigns")
      .update({
        status: keepCampaignProcessing ? "processing" : "sent",
        last_triggered_at: completedAt,
        scheduled_for: null,
        phones: phonesForRow,
      })
      .eq("id", campaign.id);
    updateError = fallback.error;
  }

  if (updateError) {
    throw updateError;
  }

  await insertCampaignDispatchLog({
    campaign: claimedCampaign,
    status: keepCampaignProcessing ? "processing" : "sent",
    triggerSource,
    message: keepCampaignProcessing
      ? "Campanha iniciou o fluxo com espera por resposta do lead."
      : "Campanha enviada via Evolution com sucesso.",
    payload: auditPayload,
    n8nResponse: dispatchSummary && typeof dispatchSummary === "object"
      ? JSON.stringify(dispatchSummary).slice(0, 8000)
      : null,
    totalLeads: leadsToDispatch.length,
    webhookStatus,
  });

  return {
    success: true,
    campaignId: claimedCampaign.id,
    campaignName: claimedCampaign.name,
    webhookUrl,
    total: leadsToDispatch.length,
    phones: auditPayload.phones,
    payload: auditPayload,
    n8nResponse: null,
  };
}

// ---- reply (fundido por ciclo dispatch<->reply, ver nota acima) ----

export async function startNextCampaignLeadInQueue({ campaign, clientId, repliedAt = null }) {
  if (!supabase || !campaign?.id || !clientId) {
    return { started: false, reason: "missing_context" };
  }

  const analyticsMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
  const steps = analyticsMeta.sequence.filter((step) => step.enabled);
  if (analyticsMeta.dispatchOptions?.waitForReply !== true || steps.length === 0) {
    return { started: false, reason: "campaign_not_wait_for_reply" };
  }

  const allLeads = await buildDispatchLeads({
    clientId,
    importId: campaign.import_id || null,
    limit: campaign.limit_per_run,
    segmentation: analyticsMeta.segmentation || null,
  });

  const { data: importItems, error: importItemsError } = await supabase
    .from("lead_import_items")
    .select("id, telefone, normalized_data")
    .eq("client_id", clientId)
    .eq("import_id", campaign.import_id || null);

  if (importItemsError) throw importItemsError;
  const itemByPhone = new Map(
    (importItems || [])
      .map((item) => [sanitizePhone(item.telefone), item])
      .filter(([phone]) => Boolean(phone))
  );

  const nextLead = allLeads.find((lead) => {
    const phone = sanitizePhone(lead.telefone);
    const item = itemByPhone.get(phone);
    const progress = extractCampaignProgress(item?.normalized_data || {}, campaign.id);
    return Object.keys(progress).length === 0;
  });

  if (!nextLead) {
    logCampaignReplyFlow("info", "queue_no_next_lead", {
      clientId,
      campaignId: campaign.id,
    });
    return { started: false, reason: "no_next_lead" };
  }

  const dispatchSettings = await resolveCampaignDispatchSettings(clientId, campaign);
  const { webhookUrl, webhookToken } = dispatchSettings;
  logCampaignDispatch("info", "settings_resolved", {
    clientId,
    campaignId: campaign.id,
    mode: "campaign_queue_progression",
    ...getSafeDispatchSettingsLog(dispatchSettings),
    usingCachedCampaignSettings: dispatchSettings.usingCachedCampaignSettings,
    tenantSettingsSource: dispatchSettings.tenantSettingsSource,
  });
  if (!webhookUrl) throw new Error("Configure uma URL ativa de disparo Evolution para esta empresa");
  await checkEvolutionInstanceHealth({
    webhookUrl,
    webhookToken,
    context: {
      clientId,
      campaignId: campaign.id,
      mode: "campaign_queue_progression",
    },
  });

  const firstStep = steps[0];
  const targetItem = itemByPhone.get(sanitizePhone(nextLead.telefone)) || null;
  const clientName = await getClientName(clientId);

  const { summary } = await dispatchCampaignSequence({
    webhookUrl,
    webhookToken,
    leads: [nextLead],
    analyticsMeta: {
      ...analyticsMeta,
      sequence: [firstStep],
      dispatchOptions: {
        ...analyticsMeta.dispatchOptions,
        waitForReply: false,
        leadDelaySeconds: 0,
      },
    },
    context: {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        mode: "campaign_queue_progression",
      },
      client: { id: clientId, name: clientName },
    },
    waitForReplyMode: "block_next_lead",
  });

  if (summary.successCount > 0 && targetItem?.id) {
    logCampaignReplyFlow("info", "queue_next_lead_started", {
      clientId,
      campaignId: campaign.id,
      phone: maskPhoneForLog(nextLead.telefone),
      stepId: firstStep?.id || null,
      stepType: firstStep?.type || null,
    });
    await markCampaignLeadWaitingReply({
      clientId,
      lead: { id: targetItem.id, nome: nextLead.nome },
      phone: sanitizePhone(nextLead.telefone),
      campaign,
      step: firstStep,
      stepIndex: 0,
      totalSteps: steps.length,
      dispatchedAt: new Date().toISOString(),
      userRepliedAt: repliedAt || undefined,
    });
  }

  return {
    started: summary.successCount > 0,
    phone: sanitizePhone(nextLead.telefone),
    summary,
  };
}

export function extractCampaignProgress(rawNormalizedData = {}, campaignId = null) {
  const data = rawNormalizedData && typeof rawNormalizedData === "object" ? rawNormalizedData : {};
  const state = data.campaign_progress && typeof data.campaign_progress === "object"
    ? data.campaign_progress
    : {};

  if (!campaignId) return state;
  return state[campaignId] && typeof state[campaignId] === "object" ? state[campaignId] : {};
}

export function mergeCampaignProgress(rawNormalizedData = {}, campaignId, progressPatch = {}) {
  const data = rawNormalizedData && typeof rawNormalizedData === "object" ? rawNormalizedData : {};
  const campaignProgress =
    data.campaign_progress && typeof data.campaign_progress === "object"
      ? { ...data.campaign_progress }
      : {};
  const current =
    campaignProgress[campaignId] && typeof campaignProgress[campaignId] === "object"
      ? campaignProgress[campaignId]
      : {};

  campaignProgress[campaignId] = {
    ...current,
    ...progressPatch,
  };

  return {
    ...data,
    campaign_progress: campaignProgress,
  };
}

export async function updateLeadImportItemCampaignProgress({
  clientId,
  leadImportItemId,
  campaignId,
  progressPatch = {},
  statusConversa = undefined,
  ultimaInteracaoBot = undefined,
  ultimaInteracaoUsuario = undefined,
}) {
  if (!supabase || !clientId || !leadImportItemId || !campaignId) return null;

  const { data: item, error: fetchError } = await supabase
    .from("lead_import_items")
    .select("id, normalized_data")
    .eq("client_id", clientId)
    .eq("id", leadImportItemId)
    .maybeSingle();

  if (fetchError) throw fetchError;
  if (!item) return null;

  const updatePayload = {
    normalized_data: mergeCampaignProgress(item.normalized_data || {}, campaignId, progressPatch),
  };
  if (statusConversa !== undefined) updatePayload.status_conversa = statusConversa;
  if (ultimaInteracaoBot !== undefined) updatePayload.ultima_interacao_bot = ultimaInteracaoBot;
  if (ultimaInteracaoUsuario !== undefined) updatePayload.ultima_interacao_usuario = ultimaInteracaoUsuario;

  const { data: updated, error: updateError } = await supabase
    .from("lead_import_items")
    .update(updatePayload)
    .eq("client_id", clientId)
    .eq("id", leadImportItemId)
    .select("id, normalized_data, status_conversa, ultima_interacao_bot, ultima_interacao_usuario")
    .maybeSingle();

  if (updateError && isMissingSchemaError(updateError)) {
    logCampaignReplyFlow("warn", "conversation_columns_missing_import_item_fallback", {
      clientId,
      leadImportItemId,
      campaignId,
      error: updateError.message || updateError.code || "missing_schema",
    });
    const fallback = await supabase
      .from("lead_import_items")
      .update({ normalized_data: updatePayload.normalized_data })
      .eq("client_id", clientId)
      .eq("id", leadImportItemId)
      .select("id, normalized_data")
      .maybeSingle();

    if (fallback.error) throw fallback.error;
    return fallback.data
      ? {
          ...fallback.data,
          status_conversa: null,
          ultima_interacao_bot: null,
          ultima_interacao_usuario: null,
        }
      : null;
  }

  if (updateError) throw updateError;
  return updated;
}

export async function updateLeadConversationState({
  clientId,
  phone,
  statusConversa,
  ultimaInteracaoBot = undefined,
  ultimaInteracaoUsuario = undefined,
}) {
  if (!supabase || !clientId || !phone || !statusConversa) return;

  const leadUpdatePayload = { status_conversa: statusConversa };
  if (ultimaInteracaoBot !== undefined) leadUpdatePayload.ultima_interacao_bot = ultimaInteracaoBot;
  if (ultimaInteracaoUsuario !== undefined) leadUpdatePayload.ultima_interacao_usuario = ultimaInteracaoUsuario;

  const { error } = await supabase
    .from(leadsTableName(clientId))
    .update(leadUpdatePayload)
    .eq("client_id", clientId)
    .eq("telefone", phone);

  if (error && isMissingSchemaError(error)) {
    logCampaignReplyFlow("warn", "conversation_columns_missing_leads_fallback", {
      clientId,
      phone: maskPhoneForLog(phone),
      statusConversa,
      error: error.message || error.code || "missing_schema",
    });
    return;
  }

  if (error) throw error;
}

/**
 * Coerce campaign timestamps from Postgres (Date) or JSON/API (string) into a stable string
 * for localeCompare-based sorting. Plain Date objects do not implement localeCompare.
 */
export function toComparableCampaignTimestamp(value) {
  if (value == null || value === "") return "";
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? "" : value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string") return value;
  return String(value);
}

/**
 * JSON/Postgres may yield step indexes as strings; Number.isInteger("2") is false and would skip reply continuation.
 */
export function normalizeCampaignPendingStepIndex(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number.parseInt(String(value), 10);
  if (!Number.isFinite(n) || Number.isNaN(n)) return null;
  const intVal = Math.trunc(n);
  return intVal >= 0 ? intVal : null;
}

export function resolveMatchedImportItemForCampaign(importItems, campaign) {
  if (!Array.isArray(importItems) || importItems.length === 0) return null;
  const importIdNorm = normalizeString(campaign.import_id);

  if (importIdNorm) {
    const byImport = importItems.filter((item) => normalizeString(item.import_id) === importIdNorm);
    if (byImport.length === 1) return byImport[0];
    if (byImport.length > 1) {
      // Prefer the row that already holds progress for this campaign (multi-row same phone / reimports).
      const withProgress = byImport.find((item) => {
        const p = extractCampaignProgress(item.normalized_data || {}, campaign.id);
        return p && Object.keys(p).length > 0;
      });
      return withProgress || byImport[0];
    }
    return null;
  }

  const withReplyProgress = importItems.find((item) => {
    const p = extractCampaignProgress(item.normalized_data || {}, campaign.id);
    return (
      p &&
      p.waitForReply === true &&
      p.status === "aguardando_usuario"
    );
  });
  return withReplyProgress || importItems[0] || null;
}

export async function findCampaignReplyMatches({ clientId, phone }) {
  if (!supabase || !clientId || !phone) {
    return {
      phone,
      importIds: [],
      matches: [],
      waitForReplyMatches: [],
      processingWaitForReplyMatches: [],
      activePeriodCampaign: null,
    };
  }

  const phoneVariants = buildPhoneLookupVariants(phone);
  if (phoneVariants.length === 0) {
    return {
      phone,
      importIds: [],
      matches: [],
      waitForReplyMatches: [],
      processingWaitForReplyMatches: [],
      activePeriodCampaign: null,
    };
  }

  const now = new Date().toISOString();

  let [importItemsResult, campaignsResult] = await Promise.all([
    supabase
      .from("lead_import_items")
      .select("id, import_id, normalized_data, status_conversa, ultima_interacao_bot, ultima_interacao_usuario, created_at")
      .eq("client_id", clientId)
      .in("telefone", phoneVariants)
      .order("created_at", { ascending: false }),
    supabase
      .from("campaigns")
      .select("id, name, client_id, import_id, status, scheduled_for, last_triggered_at, archived_at, phones, analytics_meta, starts_at, ends_at, chatbot_prompt_type, mode, campaign_prompt_id")
      .eq("client_id", clientId)
      .is("archived_at", null),
  ]);

  if (importItemsResult.error && isMissingSchemaError(importItemsResult.error)) {
    logCampaignReplyFlow("warn", "conversation_columns_missing_reply_match_fallback", {
      clientId,
      phone: maskPhoneForLog(phone),
      error: importItemsResult.error.message || importItemsResult.error.code || "missing_schema",
    });
    const fallback = await supabase
      .from("lead_import_items")
      .select("id, import_id, normalized_data, created_at")
      .eq("client_id", clientId)
      .in("telefone", phoneVariants)
      .order("created_at", { ascending: false });

    importItemsResult = {
      ...fallback,
      data: (fallback.data || []).map((item) => ({
        ...item,
        status_conversa: null,
        ultima_interacao_bot: null,
        ultima_interacao_usuario: null,
      })),
    };
  }

  if (importItemsResult.error) throw importItemsResult.error;
  if (campaignsResult.error) throw campaignsResult.error;

  const importIds = Array.from(
    new Set(
      (importItemsResult.data || [])
        .map((item) => normalizeString(item.import_id))
        .filter(Boolean)
    )
  );
  const importItems = importItemsResult.data || [];

  const matches = (campaignsResult.data || [])
    .map((campaign) => {
      const analyticsMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
      const storedPhones = Array.isArray(campaign.phones)
        ? campaign.phones.map((value) => sanitizePhone(value)).filter(Boolean)
        : [];
      const phoneSet = new Set(storedPhones);
      const matchedByStoredPhones = phoneVariants.some((variant) => phoneSet.has(variant));
      const matchedByImportId =
        Boolean(campaign.import_id) && importIds.includes(normalizeString(campaign.import_id));
      const matchedImportItem = resolveMatchedImportItemForCampaign(importItems, campaign);

      if (!matchedByStoredPhones && !matchedByImportId) {
        return null;
      }

      const progress = extractCampaignProgress(matchedImportItem?.normalized_data || {}, campaign.id);
      const hasPendingProgress =
        progress &&
        progress.waitForReply === true &&
        progress.status === "aguardando_usuario";

      // Verifica se a campanha está no período ativo (starts_at <= now <= ends_at)
      const startsAt = campaign.starts_at ? new Date(campaign.starts_at) : null;
      const endsAt = campaign.ends_at ? new Date(campaign.ends_at) : null;
      const nowDate = new Date(now);
      const isInActivePeriod =
        (!startsAt || nowDate >= startsAt) &&
        (!endsAt || nowDate <= endsAt);

      return {
        id: campaign.id,
        name: campaign.name,
        clientId: campaign.client_id,
        importId: campaign.import_id || null,
        status: campaign.status || null,
        scheduledFor: campaign.scheduled_for || null,
        lastTriggeredAt: campaign.last_triggered_at || null,
        waitForReply: analyticsMeta.dispatchOptions?.waitForReply === true,
        hasPendingProgress,
        analyticsMeta,
        isInActivePeriod,
        mode: campaign.mode || null,
        campaignPromptId: campaign.campaign_prompt_id || null,
        chatbotPromptType: campaign.chatbot_prompt_type || null,
        startsAt: campaign.starts_at || null,
        endsAt: campaign.ends_at || null,
        matchSource: matchedByStoredPhones && matchedByImportId ? "phones_and_import" : matchedByStoredPhones ? "phones" : "import",
        leadImportItem: matchedImportItem
          ? {
            id: matchedImportItem.id,
            importId: matchedImportItem.import_id || null,
            nome: normalizeString(matchedImportItem.normalized_data?.nome) || null,
            statusConversa: matchedImportItem.status_conversa || null,
            ultimaInteracaoBot: matchedImportItem.ultima_interacao_bot || null,
            ultimaInteracaoUsuario: matchedImportItem.ultima_interacao_usuario || null,
            progress,
          }
          : null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      // Campanhas em período ativo têm prioridade
      if (left.isInActivePeriod !== right.isInActivePeriod) return left.isInActivePeriod ? -1 : 1;
      const leftPending = left.hasPendingProgress ? 0 : 1;
      const rightPending = right.hasPendingProgress ? 0 : 1;
      if (leftPending !== rightPending) return leftPending - rightPending;
      const leftScore = left.status === "processing" ? 0 : left.waitForReply ? 1 : 2;
      const rightScore = right.status === "processing" ? 0 : right.waitForReply ? 1 : 2;
      if (leftScore !== rightScore) return leftScore - rightScore;
      const leftDate = toComparableCampaignTimestamp(left.lastTriggeredAt || left.scheduledFor);
      const rightDate = toComparableCampaignTimestamp(right.lastTriggeredAt || right.scheduledFor);
      return rightDate.localeCompare(leftDate);
    });

  const waitForReplyMatches = matches.filter((campaign) => campaign.waitForReply);
  const processingWaitForReplyMatches = waitForReplyMatches.filter((campaign) => campaign.hasPendingProgress === true);

  // Campanha com período ativo que contém este telefone — define qual prompt usar
  const activePeriodCampaign = matches.find((c) => c.isInActivePeriod) || null;

  return {
    phone,
    importIds,
    matches,
    waitForReplyMatches,
    processingWaitForReplyMatches,
    activePeriodCampaign,
  };
}

export async function markCampaignLeadWaitingReply({
  clientId,
  lead,
  phone,
  campaign,
  step,
  stepIndex,
  totalSteps,
  dispatchedAt,
  nextStepIndex = undefined,
  status = undefined,
  userRepliedAt = undefined,
}) {
  if (!supabase || !clientId || !phone) return;

  const hasNextStep =
    nextStepIndex !== undefined
      ? Number.isInteger(nextStepIndex) && nextStepIndex >= 0
      : Number.isInteger(stepIndex) && Number.isInteger(totalSteps) && stepIndex < totalSteps - 1;
  const normalizedStatus = status || (hasNextStep ? "aguardando_usuario" : "finalizado");
  const statusConversa = normalizedStatus === "finalizado" ? "finalizado" : "aguardando_usuario";
  const storedUserTimestamp = userRepliedAt || undefined;
  const progressPatch = campaign?.id
    ? {
      campaignId: campaign.id,
      campaignName: campaign.name || null,
      leadName: normalizeString(lead?.nome) || null,
      waitForReply: true,
      currentStepIndex: stepIndex,
      currentStepOrder: step?.order ?? stepIndex + 1,
      currentStepId: step?.id || null,
      nextStepIndex: hasNextStep ? (nextStepIndex ?? stepIndex + 1) : null,
      totalSteps,
      status: normalizedStatus,
      leadStatus:
        normalizedStatus === "finalizado"
          ? "sequencia_concluida"
          : "aguardando_resposta",
      updatedAt: dispatchedAt,
      completedAt: normalizedStatus === "finalizado" ? dispatchedAt : null,
      lastReplyAt: userRepliedAt || null,
    }
    : null;

  if (lead?.id && campaign?.id && progressPatch) {
    await updateLeadImportItemCampaignProgress({
      clientId,
      leadImportItemId: lead.id,
      campaignId: campaign.id,
      progressPatch,
      statusConversa,
      ultimaInteracaoBot: dispatchedAt,
      ultimaInteracaoUsuario: storedUserTimestamp,
    });
  } else {
    const updatePayload = {
      status_conversa: statusConversa,
      ultima_interacao_bot: dispatchedAt,
    };
    if (storedUserTimestamp !== undefined) {
      updatePayload.ultima_interacao_usuario = storedUserTimestamp;
    }
    const { error } = await supabase
      .from("lead_import_items")
      .update(updatePayload)
      .eq("client_id", clientId)
      .eq("telefone", phone);
    if (error) throw error;
  }

  await updateLeadConversationState({
    clientId,
    phone,
    statusConversa,
    ultimaInteracaoBot: dispatchedAt,
    ultimaInteracaoUsuario: storedUserTimestamp,
  });
}

export function buildCampaignAutomationHeaders(token) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.apikey = token;
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export async function callCampaignQualificationWebhook({
  clientId,
  campaign,
  lead,
  phone,
  repliedAt,
  replyPayload = {},
  summary = null,
}) {
  const settings = resolveEnvCampaignQualificationWebhookSettings(clientId);
  if (!settings?.webhookUrl || settings.invalid) {
    logCampaignReplyFlow(settings?.invalid ? "warn" : "info", "n8n_qualification_skipped", {
      clientId,
      campaignId: campaign?.id || null,
      phone: maskPhoneForLog(phone),
      reason: settings?.invalid ? "invalid_webhook_url" : "missing_webhook_url",
      source: settings?.source || "missing",
    });
    return {
      called: false,
      ok: false,
      skipped: true,
      reason: settings?.invalid ? "invalid_webhook_url" : "missing_webhook_url",
      source: settings?.source || "missing",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
  const payload = {
    action: "campaign_sequence_completed",
    source: "vexocrm",
    clientId,
    campaign: {
      id: campaign?.id || null,
      name: campaign?.name || null,
      importId: campaign?.import_id || null,
    },
    lead: {
      id: lead?.id || null,
      name: normalizeString(lead?.nome || lead?.name) || null,
      phone,
    },
    reply: {
      repliedAt,
      text:
        normalizeString(replyPayload?.message || replyPayload?.text || replyPayload?.body || replyPayload?.data?.message?.conversation) ||
        null,
      raw: replyPayload || null,
    },
    sequence: {
      status: "sequencia_concluida",
      summary,
    },
  };

  try {
    logCampaignReplyFlow("info", "n8n_qualification_started", {
      clientId,
      campaignId: campaign?.id || null,
      phone: maskPhoneForLog(phone),
      source: settings.source,
    });

    const response = await fetch(settings.webhookUrl, {
      method: "POST",
      headers: buildCampaignAutomationHeaders(settings.webhookToken),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(body ? `HTTP ${response.status}: ${body.slice(0, 500)}` : `HTTP ${response.status}`);
    }

    logCampaignReplyFlow("info", "n8n_qualification_finished", {
      clientId,
      campaignId: campaign?.id || null,
      phone: maskPhoneForLog(phone),
      status: response.status,
    });

    return {
      called: true,
      ok: true,
      skipped: false,
      status: response.status,
      body: body || null,
      source: settings.source,
    };
  } catch (error) {
    const reason =
      error?.name === "AbortError"
        ? "Timeout ao chamar webhook de qualificacao n8n."
        : error instanceof Error
          ? error.message
          : "Falha ao chamar webhook de qualificacao n8n.";
    logCampaignReplyFlow("warn", "n8n_qualification_failed", {
      clientId,
      campaignId: campaign?.id || null,
      phone: maskPhoneForLog(phone),
      reason,
    });
    return {
      called: true,
      ok: false,
      skipped: false,
      reason,
      source: settings.source,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function continueCampaignLeadFromReply({ clientId, phone, repliedAt, campaignMatch, replyPayload = {} }) {
  if (!supabase || !clientId || !phone || !campaignMatch?.id) {
    return { continued: false, reason: "missing_context" };
  }

  let { data: campaign, error: fetchError } = await supabase
    .from("campaigns")
    .select("id, name, client_id, import_id, webhook_url, webhook_token, status, analytics_meta")
    .eq("id", campaignMatch.id)
    .maybeSingle();

  if (fetchError && isMissingSchemaError(fetchError)) {
    const fallback = await supabase
      .from("campaigns")
      .select("id, name, client_id, import_id, webhook_url, webhook_token, status")
      .eq("id", campaignMatch.id)
      .maybeSingle();
    campaign = fallback.data ? { ...fallback.data, analytics_meta: campaignMatch.analyticsMeta || {} } : fallback.data;
    fetchError = fallback.error;
  }

  if (fetchError) throw fetchError;
  if (!campaign) return { continued: false, reason: "campaign_not_found" };

  const stepPlan = getCampaignStepPlan(campaign.analytics_meta || {});
  const analyticsMeta = stepPlan.analyticsMeta;
  const steps = stepPlan.enabledSteps;
  if (!stepPlan.shouldUseReplyFlow) {
    return { continued: false, reason: "campaign_not_waiting_reply" };
  }
  const leadImportItem = campaignMatch.leadImportItem || null;
  const progress = leadImportItem?.progress || {};
  const nextIdxBase = normalizeCampaignPendingStepIndex(progress.nextStepIndex);
  const hasPendingProgress =
    progress &&
    progress.waitForReply === true &&
    progress.status === "aguardando_usuario" &&
    nextIdxBase !== null;

  if (!hasPendingProgress) {
    return { continued: false, reason: "lead_not_waiting_reply" };
  }

  const nextStepIndex = nextIdxBase;

  if (nextStepIndex >= steps.length) {
    if (leadImportItem?.id) {
      await updateLeadImportItemCampaignProgress({
        clientId,
        leadImportItemId: leadImportItem.id,
        campaignId: campaign.id,
        progressPatch: {
          ...progress,
          status: "finalizado",
          nextStepIndex: null,
          updatedAt: repliedAt,
          lastReplyAt: repliedAt,
        },
        statusConversa: "finalizado",
        ultimaInteracaoUsuario: repliedAt,
      });
    }
    await updateLeadConversationState({
      clientId,
      phone,
      statusConversa: "finalizado",
      ultimaInteracaoUsuario: repliedAt,
    });
    return { continued: false, reason: "campaign_already_complete", finalized: true, campaignId: campaign.id };
  }

  const dispatchSettings = await resolveCampaignDispatchSettings(clientId, campaign);
  const { webhookUrl, webhookToken } = dispatchSettings;
  logCampaignDispatch("info", "settings_resolved", {
    clientId,
    campaignId: campaign.id,
    campaignName: campaign.name,
    mode: "campaign_reply_continuation",
    ...getSafeDispatchSettingsLog(dispatchSettings),
    usingCachedCampaignSettings: dispatchSettings.usingCachedCampaignSettings,
    tenantSettingsSource: dispatchSettings.tenantSettingsSource,
  });
  if (!webhookUrl) {
    throw new Error("Configure uma URL ativa de disparo Evolution para esta empresa");
  }
  await checkEvolutionInstanceHealth({
    webhookUrl,
    webhookToken,
    context: {
      clientId,
      campaignId: campaign.id,
      campaignName: campaign.name,
      mode: "campaign_reply_continuation",
    },
  });

  const lead = {
    id: leadImportItem?.id || null,
    telefone: phone,
    nome: normalizeString(progress.leadName) || normalizeString(leadImportItem?.nome) || "cliente",
  };

  const remainingReplyEntries = steps
    .map((step, index) => ({ step, index }))
    .filter((entry) => entry.index >= nextStepIndex);
  const remainingSteps = remainingReplyEntries.map((entry) => entry.step);
  const finalStepEntry = remainingReplyEntries[remainingReplyEntries.length - 1] || null;
  const finalStep = finalStepEntry?.step || null;
  const finalStepIndex = finalStepEntry?.index ?? nextStepIndex;

  if (remainingSteps.length === 0) {
    if (leadImportItem?.id) {
      await updateLeadImportItemCampaignProgress({
        clientId,
        leadImportItemId: leadImportItem.id,
        campaignId: campaign.id,
        progressPatch: {
          ...progress,
          status: "finalizado",
          nextStepIndex: null,
          updatedAt: repliedAt,
          lastReplyAt: repliedAt,
          completedAt: repliedAt,
        },
        statusConversa: "finalizado",
        ultimaInteracaoUsuario: repliedAt,
      });
    }
    await updateLeadConversationState({
      clientId,
      phone,
      statusConversa: "finalizado",
      ultimaInteracaoUsuario: repliedAt,
    });
    const campaignFinalization = await maybeFinalizeCampaignAfterReply({ campaignId: campaign.id, clientId });
    return {
      continued: false,
      finalized: true,
      campaignFinalized: campaignFinalization.finalized === true,
      campaignId: campaign.id,
      campaignName: campaign.name,
      sentStepIndex: null,
      remainingSteps: 0,
      summary: { successCount: 0, failureCount: 0, successPhones: [], failures: [], warnings: [], completedCampaign: true },
    };
  }

  logCampaignReplyFlow("info", "reply_received_advancing_sequence", {
    clientId,
    campaignId: campaign.id,
    phone: maskPhoneForLog(phone),
    nextStepIndex,
    remainingSteps: remainingSteps.map((step) => ({
      id: step.id,
      order: step.order,
      type: step.type,
      triggerMode: step.triggerMode || "immediate",
    })),
  });

  if (leadImportItem?.id) {
    await updateLeadImportItemCampaignProgress({
      clientId,
      leadImportItemId: leadImportItem.id,
      campaignId: campaign.id,
      progressPatch: {
        ...progress,
        status: "enviando_proximas_etapas",
        leadStatus: "enviando_proximas_etapas",
        nextStepIndex,
        updatedAt: repliedAt,
        lastReplyAt: repliedAt,
      },
      statusConversa: "em_atendimento",
      ultimaInteracaoUsuario: repliedAt,
    });
  }

  const { summary } = await dispatchCampaignSequence({
    webhookUrl,
    webhookToken,
    leads: [lead],
    analyticsMeta: {
      ...analyticsMeta,
      sequence: remainingSteps,
      dispatchOptions: {
        ...analyticsMeta.dispatchOptions,
        leadDelaySeconds: 0,
        waitForReply: false,
      },
    },
    context: {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        mode: "campaign_reply_progression",
      },
      client: { id: clientId, name: await getClientName(clientId) },
    },
    onStepDispatched: async ({ step, stepIndex, sentAt }) => {
      const originalStepIndex = nextStepIndex + stepIndex;
      logCampaignReplyFlow("info", "reply_step_sent", {
        clientId,
        campaignId: campaign.id,
        phone: maskPhoneForLog(phone),
        stepId: step.id,
        stepType: step.type,
        originalStepIndex,
      });
      if (leadImportItem?.id) {
        await updateLeadImportItemCampaignProgress({
          clientId,
          leadImportItemId: leadImportItem.id,
          campaignId: campaign.id,
          progressPatch: {
            ...progress,
            status: "enviando_proximas_etapas",
            leadStatus: "enviando_proximas_etapas",
            currentStepIndex: originalStepIndex,
            currentStepOrder: step.order ?? originalStepIndex + 1,
            currentStepId: step.id || null,
            nextStepIndex: originalStepIndex < steps.length - 1 ? originalStepIndex + 1 : null,
            updatedAt: sentAt,
            lastReplyAt: repliedAt,
          },
          statusConversa: "em_atendimento",
          ultimaInteracaoBot: sentAt,
          ultimaInteracaoUsuario: repliedAt,
        });
      }
    },
  });

  let finalizationWarning = null;
  let nextLeadStart = { started: false, reason: "not_attempted" };

  if (summary.failureCount > 0 || summary.successCount <= 0) {
    const firstFailure = summary.failures?.[0] || null;
    const failedStepEntry = firstFailure?.stepId
      ? remainingReplyEntries.find((entry) => entry.step.id === firstFailure.stepId)
      : remainingReplyEntries[0];
    const failedStepIndex = failedStepEntry?.index ?? nextStepIndex;
    const failureReason = firstFailure?.reason || "Falha ao enviar proximas etapas da campanha.";

    logCampaignReplyFlow("warn", "reply_sequence_failed_for_lead", {
      clientId,
      campaignId: campaign.id,
      phone: maskPhoneForLog(phone),
      failedStepIndex,
      reason: failureReason,
    });

    if (leadImportItem?.id) {
      await updateLeadImportItemCampaignProgress({
        clientId,
        leadImportItemId: leadImportItem.id,
        campaignId: campaign.id,
        progressPatch: {
          ...progress,
          status: "erro",
          leadStatus: "erro",
          nextStepIndex: null,
          failedStepIndex,
          updatedAt: new Date().toISOString(),
          lastReplyAt: repliedAt,
          errorMessage: failureReason,
        },
        statusConversa: "em_atendimento",
        ultimaInteracaoUsuario: repliedAt,
      });
    }

    let campaignFinalizationAfterError = { finalized: false };
    try {
      nextLeadStart = await startNextCampaignLeadInQueue({ campaign, clientId, repliedAt });
      if (!nextLeadStart.started) {
        campaignFinalizationAfterError = await maybeFinalizeCampaignAfterReply({ campaignId: campaign.id, clientId });
      }
    } catch (error) {
      finalizationWarning =
        error instanceof Error
          ? error.message
          : "Falha ao iniciar o proximo lead apos erro na sequencia atual.";
    }

    return {
      continued: false,
      finalized: false,
      campaignFinalized: campaignFinalizationAfterError.finalized === true,
      campaignId: campaign.id,
      campaignName: campaign.name,
      sentStepIndex: nextStepIndex,
      remainingSteps: remainingSteps.length,
      nextLeadStart,
      summary: {
        ...summary,
        warnings: finalizationWarning
          ? [
              ...(summary.warnings || []),
              { phone, stepId: failedStepEntry?.step?.id || null, stepType: failedStepEntry?.step?.type || null, reason: finalizationWarning },
            ]
          : summary.warnings,
      },
    };
  }

  if (summary.successCount > 0 && leadImportItem?.id) {
    try {
      await markCampaignLeadWaitingReply({
        clientId,
        lead: { id: leadImportItem.id, nome: lead.nome },
        phone,
        campaign,
        step: finalStep,
        stepIndex: finalStepIndex,
        totalSteps: steps.length,
        dispatchedAt: new Date().toISOString(),
        nextStepIndex: null,
        status: "finalizado",
        userRepliedAt: repliedAt,
      });
    } catch (error) {
      finalizationWarning =
        error instanceof Error
          ? error.message
          : "Falha ao salvar a finalizacao interna da campanha apos envio bem-sucedido.";
    }
  }

  const finalizedCurrentLead = summary.successCount > 0;
  let n8nQualification = { called: false, skipped: true, reason: "lead_not_finalized" };
  if (finalizedCurrentLead) {
    n8nQualification = await callCampaignQualificationWebhook({
      clientId,
      campaign,
      lead,
      phone,
      repliedAt,
      replyPayload,
      summary,
    });

    if (leadImportItem?.id) {
      await updateLeadImportItemCampaignProgress({
        clientId,
        leadImportItemId: leadImportItem.id,
        campaignId: campaign.id,
        progressPatch: {
          status: "finalizado",
          leadStatus: n8nQualification.ok ? "qualificado_em_n8n" : "sequencia_concluida",
          nextStepIndex: null,
          updatedAt: new Date().toISOString(),
          n8nQualification,
        },
        statusConversa: "finalizado",
      });
    }
  }

  let campaignFinalization = { finalized: false };
  if (finalizedCurrentLead) {
    try {
      nextLeadStart = await startNextCampaignLeadInQueue({ campaign, clientId, repliedAt });
      if (!nextLeadStart.started) {
        campaignFinalization = await maybeFinalizeCampaignAfterReply({ campaignId: campaign.id, clientId });
      }
    } catch (error) {
      finalizationWarning =
        error instanceof Error
          ? error.message
          : "Falha ao iniciar o proximo lead ou finalizar a campanha apos envio bem-sucedido.";
    }
  }

  if (finalizationWarning) {
    summary.warnings.push({
      phone,
      stepId: finalStep?.id || null,
      stepType: finalStep?.type || null,
      reason: finalizationWarning,
    });
  }

  return {
    continued: summary.successCount > 0,
    finalized: finalizedCurrentLead,
    campaignFinalized: campaignFinalization.finalized === true,
    campaignId: campaign.id,
    campaignName: campaign.name,
    sentStepIndex: nextStepIndex,
    remainingSteps: Math.max(steps.length - (nextStepIndex + 1), 0),
    nextLeadStart,
    n8nQualification,
    summary,
  };
}

export async function maybeFinalizeCampaignAfterReply({ campaignId, clientId, triggerSource = "reply_webhook" }) {
  if (!supabase || !campaignId || !clientId) return { finalized: false, reason: "missing_context" };

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .select("id, name, client_id, import_id, status, phones, analytics_meta")
    .eq("id", campaignId)
    .eq("client_id", clientId)
    .maybeSingle();

  if (campaignError) throw campaignError;
  if (!campaign) return { finalized: false, reason: "campaign_not_found" };
  if (campaign.status !== "processing") return { finalized: false, reason: "campaign_not_processing" };

  let query = supabase
    .from("lead_import_items")
    .select("id, telefone, normalized_data")
    .eq("client_id", clientId)
    .not("telefone", "is", null);

  if (campaign.import_id) {
    query = query.eq("import_id", campaign.import_id);
  } else {
    const phones = Array.isArray(campaign.phones)
      ? campaign.phones.map((value) => sanitizePhone(value)).filter(Boolean)
      : [];
    if (phones.length === 0) return { finalized: false, reason: "campaign_without_target_phones" };
    query = query.in("telefone", phones);
  }

  const { data: items, error: itemsError } = await query;
  if (itemsError) throw itemsError;

  const relevantItems = (items || []).filter((item) => {
    const progress = extractCampaignProgress(item.normalized_data || {}, campaign.id);
    return progress && typeof progress === "object" && progress.waitForReply === true;
  });

  if (relevantItems.length === 0) {
    return { finalized: false, reason: "campaign_without_progress_items" };
  }

  const hasPendingItems = relevantItems.some((item) => {
    const progress = extractCampaignProgress(item.normalized_data || {}, campaign.id);
    if (Object.keys(progress).length === 0) return true;
    const terminalStatus = progress.status === "finalizado" || progress.status === "erro";
    return !terminalStatus || progress.nextStepIndex !== null;
  });

  if (hasPendingItems) {
    return { finalized: false, reason: "campaign_has_pending_leads" };
  }

  const completedAt = new Date().toISOString();
  const analyticsMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
  const nextAnalyticsMeta = {
    ...analyticsMeta,
    dispatch: {
      ...normalizeCampaignAnalyticsMeta(analyticsMeta.dispatch),
      status: "sent",
      triggerSource,
      sentAt: completedAt,
      updatedAt: completedAt,
    },
  };

  let { error: updateError } = await supabase
    .from("campaigns")
    .update({
      status: "sent",
      last_triggered_at: completedAt,
      scheduled_for: null,
      analytics_meta: nextAnalyticsMeta,
    })
    .eq("id", campaign.id)
    .eq("client_id", clientId);

  if (updateError && isMissingSchemaError(updateError)) {
    const fallback = await supabase
      .from("campaigns")
      .update({
        status: "sent",
        last_triggered_at: completedAt,
        scheduled_for: null,
      })
      .eq("id", campaign.id)
      .eq("client_id", clientId);
    updateError = fallback.error;
  }

  if (updateError) throw updateError;

  await insertCampaignDispatchLog({
    campaign,
    status: "sent",
    triggerSource,
    message: "Campanha finalizada apos ultima resposta do lead.",
    totalLeads: relevantItems.length,
  });

  return { finalized: true, campaignId: campaign.id, completedAt };
}

export async function hasCampaignLeadReplied({ clientId, lead, phone, dispatchedAt }) {
  if (!supabase || !clientId || !phone) return false;

  const dispatchedDate = new Date(dispatchedAt);
  const repliedStatuses = ["em_atendimento", "finalizado"];
  const queries = [
    supabase
      .from("lead_import_items")
      .select("id, status_conversa, ultima_interacao_usuario")
      .eq("client_id", clientId)
      .eq("telefone", phone)
      .limit(1),
    supabase
      .from(leadsTableName(clientId))
      .select("id, status_conversa, ultima_interacao_usuario")
      .eq("client_id", clientId)
      .eq("telefone", phone)
      .limit(1),
  ];

  if (lead?.id) {
    queries.push(
      supabase
        .from("lead_import_items")
        .select("id, status_conversa, ultima_interacao_usuario")
        .eq("id", lead.id)
        .eq("client_id", clientId)
        .limit(1)
    );
  }

  const results = await Promise.all(queries);
  const error = results.find((result) => result.error)?.error;
  if (error && isMissingSchemaError(error)) {
    logCampaignReplyFlow("warn", "conversation_columns_missing_lead_reply_check_fallback", {
      clientId,
      phone: maskPhoneForLog(phone),
      error: error.message || error.code || "missing_schema",
    });
    return false;
  }
  if (error) throw error;

  const rows = results.flatMap((result) => result.data || []);

  return rows.some((row) => {
    if (repliedStatuses.includes(row.status_conversa)) return true;
    if (!row.ultima_interacao_usuario) return false;

    const userDate = new Date(row.ultima_interacao_usuario);
    return !Number.isNaN(userDate.getTime()) && userDate >= dispatchedDate;
  });
}
