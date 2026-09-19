// n8n / dispatch settings por cliente (movidos de server.js — grupo F do mapa,
// Onda 3 Run D). Movimento puro: corpos idênticos aos de server.js na revisão
// anterior a esta extração.
//
// isMaskedSecretPlaceholder NÃO está aqui: foi movida para ./httpInfra.js. Motivo:
// este módulo já precisa importar de ./evolution.js (getDefaultLeadClientEvolutionInstance,
// mergeEvolutionInstanceIntoSettings, getLeadClientEvolutionInstancesMap, maskEvolutionInstance
// — getLeadClientN8nSettingsStatus/Map fazem merge com a instância Evolution default). Se
// isMaskedSecretPlaceholder (usada também por evolution.js:upsertLeadClientEvolutionInstance)
// vivesse aqui, evolution.js precisaria importar deste módulo de volta, fechando um ciclo.
// Import de httpInfra.js (folha do grafo) evita isso: a direção real do grafo nesta dupla é
// n8nSettings.js -> evolution.js (nunca o contrário).
//
// validateN8nInboundBearer: pendência do Run A (ficou em server.js porque dependia de
// getLeadClientN8nSettings, que só agora foi extraída). Movida para cá; usa
// getRequestBearerToken/sendError de ./httpInfra.js.
//
// buildDefaultSegmentationConfig/sanitizeSegmentationConfig já vivem em ../segmentation.js
// (Onda 3 Run A) — importadas daqui.

import { supabase } from "./database.js";
import { normalizeString } from "../textNormalize.js";
import { defaultGroqModel } from "./llmModels.js";
import { ensureModuleTabs } from "../access/permissionsRegistry.js";
import { normalizeHttpUrl } from "./tenant.js";
import { buildDefaultSegmentationConfig, sanitizeSegmentationConfig } from "../segmentation.js";
import { isMissingSchemaError } from "./analytics.js";
import {
  getDefaultLeadClientEvolutionInstance,
  getLeadClientEvolutionInstances,
  mergeEvolutionInstanceIntoSettings,
  getLeadClientEvolutionInstancesMap,
  maskEvolutionInstance,
} from "./evolution.js";
import { isMaskedSecretPlaceholder, getRequestBearerToken, sendError } from "./httpInfra.js";

export const N8N_SETTINGS_SELECT_FIELDS =
  "client_id, dispatch_webhook_url, dispatch_webhook_token, inbound_bearer_token, active, chatbot_enabled, chatbot_model, chatbot_llm_model, chatbot_instances, chatbot_inbound_scope, recontact_message, sdr_whatsapp_numbers, sdr_distribution, agent_name, segmentation_config, sdr_whatsapp_number, allowed_tabs, plan_tier, modulos_avulsos, chip_limit, degustacao_expira_em, send_window_start, send_window_end, send_window_days, send_window_timezone, send_window_enabled, agent_replies_outside_window, updated_at, updated_by_uid, updated_by_email";

export function resolveSingleLeadClientSettings(rawRow, instances = []) {
  const masked = rawRow ? maskN8nSettings(rawRow) : null;
  const activeInstances = Array.isArray(instances) ? instances.filter((i) => i && i.active !== false) : [];
  const defaultInstance =
    activeInstances.find((i) => i.is_default === true) ||
    activeInstances[0] ||
    null;

  const merged = mergeEvolutionInstanceIntoSettings(masked, defaultInstance);
  if (!merged && !instances.length) return null;

  return {
    ...(merged || masked || {}),
    evolution_instances: (instances || []).map(maskEvolutionInstance),
  };
}

function parseSendWindowDays(raw) {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw.map((d) => String(d).toLowerCase().slice(0, 3)).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((d) => String(d).toLowerCase().slice(0, 3)).filter(Boolean);
      }
    } catch {
      const cleaned = raw.replace(/[{}"']/g, "").split(",").map((s) => s.trim().toLowerCase().slice(0, 3)).filter(Boolean);
      if (cleaned.length > 0) return cleaned;
    }
  }
  return ["mon", "tue", "wed", "thu", "fri"];
}

export function maskN8nSettings(row) {
  if (!row) {
    return {
      dispatch_webhook_url: null,
      has_dispatch_webhook_token: false,
      has_inbound_bearer_token: false,
      active: false,
      chatbot_enabled: false,
      chatbot_model: "generico",
      chatbot_llm_model: defaultGroqModel(),
      chatbot_instances: [],
      chatbot_inbound_scope: "leads_only",
      recontact_message: null,
      sdr_whatsapp_numbers: [],
      // "todos" avisa a lista inteira (comportamento de sempre); "rodizio"
      // gira um consultor por vez, decisão fixada por lead.
      sdr_distribution: "todos",
      segmentation_config: buildDefaultSegmentationConfig("generico"),
      sdr_whatsapp_number: null,
      send_window_start: "08:00",
      send_window_end: "20:00",
      send_window_days: ["mon", "tue", "wed", "thu", "fri"],
      send_window_timezone: "America/Sao_Paulo",
      send_window_enabled: true,
      agent_replies_outside_window: true,
      updated_at: null,
    };
  }

  return {
    client_id: row.client_id,
    dispatch_webhook_url: row.dispatch_webhook_url || null,
    has_dispatch_webhook_token: !!row.dispatch_webhook_token,
    has_inbound_bearer_token: !!row.inbound_bearer_token,
    active: row.active !== false,
    chatbot_enabled: row.chatbot_enabled === true,
    chatbot_model: row.chatbot_model || "generico",
    chatbot_llm_model: row.chatbot_llm_model || null,
    // Chips que este chatbot atende. Vazio = qualquer chip sem agente inbound.
    chatbot_instances: Array.isArray(row.chatbot_instances) ? row.chatbot_instances : [],
    // Quem o chatbot atende. Default seguro: so lead conhecido. So o literal
    // "all" abre para qualquer inbound.
    chatbot_inbound_scope: row.chatbot_inbound_scope === "all" ? "all" : "leads_only",
    recontact_message: row.recontact_message || null,
    // Lista de destinos do briefing. Cai no numero antigo enquanto houver linha
    // nao migrada — durante o deploy as duas colunas convivem.
    sdr_whatsapp_numbers: Array.isArray(row.sdr_whatsapp_numbers) && row.sdr_whatsapp_numbers.length > 0
      ? row.sdr_whatsapp_numbers
      : (row.sdr_whatsapp_number ? [row.sdr_whatsapp_number] : []),
    sdr_distribution: row.sdr_distribution === "rodizio" ? "rodizio" : "todos",
    segmentation_config: sanitizeSegmentationConfig(row.segmentation_config, row.chatbot_model || "generico"),
    sdr_whatsapp_number: row.sdr_whatsapp_number || null,
    updated_at: row.updated_at || null,
    updated_by_email: row.updated_by_email || null,
    allowed_tabs: Array.isArray(row.allowed_tabs) ? row.allowed_tabs : null,
    plan_tier: row.plan_tier || "essencial",
    modulos_avulsos: Array.isArray(row.modulos_avulsos) ? row.modulos_avulsos : [],
    degustacao_expira_em: row.degustacao_expira_em || null,
    // Override do limite de chips deste tenant. NULL = usa a regra do plano.
    chip_limit: row.chip_limit === null || row.chip_limit === undefined ? null : Number(row.chip_limit),
    send_window_start: row.send_window_start || "08:00",
    send_window_end: row.send_window_end || "20:00",
    send_window_days: parseSendWindowDays(row.send_window_days),
    send_window_timezone: row.send_window_timezone || "America/Sao_Paulo",
    send_window_enabled: row.send_window_enabled !== false,
    agent_replies_outside_window: row.agent_replies_outside_window !== false,
    // Preserva a lista de instâncias já mascarada por maskEvolutionInstance (server.js:1717).
    // Sem isso a whitelist cortava o campo e a UI mostrava "0 instâncias".
    evolution_instances: Array.isArray(row.evolution_instances) ? row.evolution_instances : [],
  };
}

export function getN8nOnboardingStatus(settings) {
  if (!settings || settings.active === false) return "pendente";
  if (!settings.dispatch_webhook_url) return "sem url evolution";
  if (!settings.inbound_bearer_token) return "sem token inbound legado";
  return "evolution + inbound legado";
}

export async function getLeadClientN8nSettingsStatus(clientId) {
  if (!supabase || !clientId) {
    return {
      settings: null,
      schemaAvailable: false,
      source: "database_unavailable",
    };
  }

  const { data, error } = await supabase
    .from("lead_client_n8n_settings")
    .select(N8N_SETTINGS_SELECT_FIELDS)
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    if (isMissingSchemaError(error)) {
      // Silencioso ate 05/08/2026: uma coluna inexistente no SELECT (era
      // persona_template) derrubava a query inteira e esta funcao devolvia
      // settings: null. Como o upsert usa esse retorno como "existing", TODO
      // PATCH parcial passava a regravar os campos nao enviados com os
      // defaults (ex: chatbot_enabled=false, chatbot_model="outlier").
      // Agora ignora colunas faltantes sem destruir os campos que existem.
      return {
        settings: null,
        schemaAvailable: false,
        source: "missing_schema",
      };
    }
    throw error;
  }

  const instances = await getLeadClientEvolutionInstances(clientId);
  const resolvedSettings = resolveSingleLeadClientSettings(data, instances);

  return {
    settings: resolvedSettings,
    schemaAvailable: true,
    source: "database",
  };
}

export async function getLeadClientN8nSettings(clientId) {
  const result = await getLeadClientN8nSettingsStatus(clientId);
  return result.settings;
}

export async function getLeadClientN8nSettingsMap(clientIds) {
  if (!supabase || !Array.isArray(clientIds) || clientIds.length === 0) return {};

  const { data, error } = await supabase
    .from("lead_client_n8n_settings")
    .select(N8N_SETTINGS_SELECT_FIELDS)
    .in("client_id", clientIds);

  if (error) {
    if (isMissingSchemaError(error)) return {};
    throw error;
  }

  const rawMap = Object.fromEntries((data || []).map((row) => [row.client_id, row]));
  const evolutionInstancesMap = await getLeadClientEvolutionInstancesMap(clientIds);

  const settingsMap = {};
  for (const clientId of clientIds) {
    const rawRow = rawMap[clientId] || null;
    const instances = evolutionInstancesMap[clientId] || [];
    const resolved = resolveSingleLeadClientSettings(rawRow, instances);
    if (resolved) {
      settingsMap[clientId] = resolved;
    }
  }

  return settingsMap;
}

export function buildN8nSettingsPayload(input, authAccess, existing = null) {
  const body = input && typeof input === "object" ? input : {};
  const dispatchWebhookUrlProvided = Object.prototype.hasOwnProperty.call(body, "dispatchWebhookUrl");
  const dispatchWebhookTokenProvided = Object.prototype.hasOwnProperty.call(body, "dispatchWebhookToken");
  const inboundBearerTokenProvided = Object.prototype.hasOwnProperty.call(body, "inboundBearerToken");
  const activeProvided = Object.prototype.hasOwnProperty.call(body, "active");
  const chatbotEnabledProvided = Object.prototype.hasOwnProperty.call(body, "chatbotEnabled");
  const chatbotModelProvided = Object.prototype.hasOwnProperty.call(body, "chatbotModel");
  const chatbotLlmModelProvided = Object.prototype.hasOwnProperty.call(body, "chatbotLlmModel") || Object.prototype.hasOwnProperty.call(body, "chatbot_llm_model");
  const agentNameProvided = Object.prototype.hasOwnProperty.call(body, "agentName") || Object.prototype.hasOwnProperty.call(body, "agent_name");
  const segmentationConfigProvided = Object.prototype.hasOwnProperty.call(body, "segmentationConfig");
  const chatbotInstancesProvided =
    Object.prototype.hasOwnProperty.call(body, "chatbotInstances") ||
    Object.prototype.hasOwnProperty.call(body, "chatbot_instances");
  const chatbotInboundScopeProvided = Object.prototype.hasOwnProperty.call(body, "chatbotInboundScope") || Object.prototype.hasOwnProperty.call(body, "chatbot_inbound_scope");
  const recontactMessageProvided = Object.prototype.hasOwnProperty.call(body, "recontactMessage") || Object.prototype.hasOwnProperty.call(body, "recontact_message");
  const sdrWhatsappNumberProvided = Object.prototype.hasOwnProperty.call(body, "sdrWhatsappNumber");
  const sdrWhatsappNumbersProvided = Object.prototype.hasOwnProperty.call(body, "sdrWhatsappNumbers");
  const sdrDistributionProvided = Object.prototype.hasOwnProperty.call(body, "sdrDistribution") || Object.prototype.hasOwnProperty.call(body, "sdr_distribution");
  const allowedTabsProvided = Object.prototype.hasOwnProperty.call(body, "allowedTabs");
  const planTierProvided = Object.prototype.hasOwnProperty.call(body, "planTier") || Object.prototype.hasOwnProperty.call(body, "plan_tier");
  const modulosAvulsosProvided = Object.prototype.hasOwnProperty.call(body, "modulosAvulsos") || Object.prototype.hasOwnProperty.call(body, "modulos_avulsos");
  const degustacaoExpiraEmProvided = Object.prototype.hasOwnProperty.call(body, "degustacaoExpiraEm") || Object.prototype.hasOwnProperty.call(body, "degustacao_expira_em");
  const sendWindowStartProvided = Object.prototype.hasOwnProperty.call(body, "sendWindowStart") || Object.prototype.hasOwnProperty.call(body, "send_window_start");
  const sendWindowEndProvided = Object.prototype.hasOwnProperty.call(body, "sendWindowEnd") || Object.prototype.hasOwnProperty.call(body, "send_window_end");
  const sendWindowDaysProvided = Object.prototype.hasOwnProperty.call(body, "sendWindowDays") || Object.prototype.hasOwnProperty.call(body, "send_window_days");
  const sendWindowTimezoneProvided = Object.prototype.hasOwnProperty.call(body, "sendWindowTimezone") || Object.prototype.hasOwnProperty.call(body, "send_window_timezone");
  const sendWindowEnabledProvided = Object.prototype.hasOwnProperty.call(body, "sendWindowEnabled") || Object.prototype.hasOwnProperty.call(body, "send_window_enabled");
  const agentRepliesOutsideWindowProvided = Object.prototype.hasOwnProperty.call(body, "agentRepliesOutsideWindow") || Object.prototype.hasOwnProperty.call(body, "agent_replies_outside_window");

  const payload = {
    active: activeProvided ? body.active !== false : existing?.active ?? true,
    chatbot_enabled: chatbotEnabledProvided ? body.chatbotEnabled === true : existing?.chatbot_enabled ?? false,
    chatbot_model: chatbotModelProvided ? (body.chatbotModel || "generico") : existing?.chatbot_model ?? "generico",
    // Era "llama-3.3-70b-versatile" chumbado nos dois lados: TODO tenant salvo
    // gravava no banco um modelo que a Groq descontinuou. Agora sai da escada
    // configuravel — e resolveGroqLadder descarta o valor morto de quem ja tem.
    chatbot_llm_model: chatbotLlmModelProvided
      ? (body.chatbotLlmModel || body.chatbot_llm_model || defaultGroqModel())
      : existing?.chatbot_llm_model ?? defaultGroqModel(),
    plan_tier: planTierProvided
      ? (() => {
          const pt = String(body.planTier ?? body.plan_tier).toLowerCase().trim();
          if (pt === "avancado" || pt.includes("avancad")) return "avancado";
          if (pt === "modular" || pt.includes("modular") || pt.includes("avulso")) return "modular";
          return "essencial";
        })()
      : existing?.plan_tier ?? "essencial",
    modulos_avulsos: modulosAvulsosProvided
      ? (Array.isArray(body.modulosAvulsos ?? body.modulos_avulsos) ? (body.modulosAvulsos ?? body.modulos_avulsos) : [])
      : existing?.modulos_avulsos ?? [],
    degustacao_expira_em: degustacaoExpiraEmProvided
      ? (body.degustacaoExpiraEm ?? body.degustacao_expira_em ? new Date(body.degustacaoExpiraEm ?? body.degustacao_expira_em).toISOString() : null)
      : existing?.degustacao_expira_em ?? null,
    // Numero invalido nao entra na lista: o mesmo criterio do frontend, aqui
    // tambem, porque o backend nao pode confiar na tela.
    sdr_whatsapp_numbers: sdrWhatsappNumbersProvided
      ? [...new Set((Array.isArray(body.sdrWhatsappNumbers) ? body.sdrWhatsappNumbers : [])
          .map((v) => String(v ?? "").replace(/\D/g, ""))
          .filter((v) => /^[0-9]{10,15}$/.test(v)))]
      : existing?.sdr_whatsapp_numbers ?? [],
    // "todos" (padrão) avisa a lista inteira; qualquer outra coisa que não
    // "rodizio" cai em "todos" — nunca grava um valor fora do CHECK da coluna.
    sdr_distribution: sdrDistributionProvided
      ? ((body.sdrDistribution ?? body.sdr_distribution) === "rodizio" ? "rodizio" : "todos")
      : existing?.sdr_distribution ?? "todos",
    chatbot_instances: chatbotInstancesProvided
      ? (Array.isArray(body.chatbotInstances ?? body.chatbot_instances)
          ? [...new Set((body.chatbotInstances ?? body.chatbot_instances).map((v) => String(v ?? "").trim()).filter(Boolean))]
          : [])
      : existing?.chatbot_instances ?? [],
    chatbot_inbound_scope: chatbotInboundScopeProvided
      ? (["all", "leads_only"].includes(String(body.chatbotInboundScope || body.chatbot_inbound_scope).toLowerCase())
          ? String(body.chatbotInboundScope || body.chatbot_inbound_scope).toLowerCase()
          : "leads_only")
      : existing?.chatbot_inbound_scope ?? "leads_only",
    recontact_message: recontactMessageProvided
      ? (normalizeString(body.recontactMessage || body.recontact_message) || null)
      : existing?.recontact_message ?? null,
    agent_name: agentNameProvided ? (normalizeString(body.agentName || body.agent_name) || null) : existing?.agent_name ?? null,
    segmentation_config: segmentationConfigProvided
      ? sanitizeSegmentationConfig(body.segmentationConfig, body.chatbotModel || existing?.chatbot_model || "generico")
      : sanitizeSegmentationConfig(existing?.segmentation_config, existing?.chatbot_model || body.chatbotModel || "generico"),
    sdr_whatsapp_number: sdrWhatsappNumberProvided ? (normalizeString(body.sdrWhatsappNumber) || null) : existing?.sdr_whatsapp_number ?? null,
    send_window_start: sendWindowStartProvided
      ? (typeof (body.sendWindowStart ?? body.send_window_start) === "string" && /^\d{1,2}:\d{2}$/.test((body.sendWindowStart ?? body.send_window_start).trim())
          ? (body.sendWindowStart ?? body.send_window_start).trim().padStart(5, "0")
          : "08:00")
      : existing?.send_window_start ?? "08:00",
    send_window_end: sendWindowEndProvided
      ? (typeof (body.sendWindowEnd ?? body.send_window_end) === "string" && /^\d{1,2}:\d{2}$/.test((body.sendWindowEnd ?? body.send_window_end).trim())
          ? (body.sendWindowEnd ?? body.send_window_end).trim().padStart(5, "0")
          : "20:00")
      : existing?.send_window_end ?? "20:00",
    send_window_days: sendWindowDaysProvided
      ? parseSendWindowDays(body.sendWindowDays ?? body.send_window_days)
      : parseSendWindowDays(existing?.send_window_days),
    send_window_timezone: sendWindowTimezoneProvided
      ? (typeof (body.sendWindowTimezone ?? body.send_window_timezone) === "string" && (body.sendWindowTimezone ?? body.send_window_timezone).trim()
          ? (body.sendWindowTimezone ?? body.send_window_timezone).trim()
          : "America/Sao_Paulo")
      : existing?.send_window_timezone ?? "America/Sao_Paulo",
    send_window_enabled: sendWindowEnabledProvided
      ? (body.sendWindowEnabled ?? body.send_window_enabled) !== false && (body.sendWindowEnabled ?? body.send_window_enabled) !== "false"
      : existing?.send_window_enabled ?? true,
    agent_replies_outside_window: agentRepliesOutsideWindowProvided
      ? (body.agentRepliesOutsideWindow ?? body.agent_replies_outside_window) !== false && (body.agentRepliesOutsideWindow ?? body.agent_replies_outside_window) !== "false"
      : existing?.agent_replies_outside_window ?? true,
    // allowed_tabs so e escrita aqui; a garantia das abas dos modulos vem logo
    // abaixo, depois que plan_tier e modulos_avulsos ja estao resolvidos.
    allowed_tabs: allowedTabsProvided
      ? (Array.isArray(body.allowedTabs) ? body.allowedTabs : null)
      : existing?.allowed_tabs ?? null,
    updated_at: new Date().toISOString(),
    updated_by_uid: authAccess?.uid || null,
    updated_by_email: authAccess?.email || null,
  };

  // Contratar o modulo passa a CONCEDER a aba. Eram duas fontes de verdade que
  // nao conversavam: marcar "Follow-up & Cadencias" grava em modulos_avulsos e a
  // secao 2 da tela le allowed_tabs. O dono marcava e desmarcava sem efeito.
  //
  // ADITIVO por decisao do dono: so acrescenta. Desmarcar modulo NAO tira aba —
  // pode haver acesso legitimo por outro caminho, e tirar e decisao dele.
  // allowed_tabs null significa "sem restricao" e continua null: virar lista
  // aqui RESTRINGIRIA um tenant que hoje enxerga tudo.
  const abasGarantidas = ensureModuleTabs(payload.allowed_tabs, payload.modulos_avulsos);
  if (abasGarantidas !== payload.allowed_tabs) {
    const novas = abasGarantidas.filter((aba) => !(payload.allowed_tabs || []).includes(aba));
    console.info("[n8n-settings] abas concedidas pelos modulos contratados", {
      clientId: authAccess?.clientId ?? null,
      novas,
    });
    payload.allowed_tabs = abasGarantidas;
  }

  if (dispatchWebhookUrlProvided) {
    const url = normalizeHttpUrl(body.dispatchWebhookUrl);
    if (body.dispatchWebhookUrl !== null && normalizeString(body.dispatchWebhookUrl) && !url) {
      throw new Error("INVALID_DISPATCH_WEBHOOK_URL");
    }
    payload.dispatch_webhook_url = url;
  } else if (!existing) {
    payload.dispatch_webhook_url = null;
  }

  if (dispatchWebhookTokenProvided) {
    const token = normalizeString(body.dispatchWebhookToken);
    payload.dispatch_webhook_token =
      body.dispatchWebhookToken === null
        ? null
        : isMaskedSecretPlaceholder(token)
          ? existing?.dispatch_webhook_token || null
          : token || existing?.dispatch_webhook_token || null;
  } else if (!existing) {
    payload.dispatch_webhook_token = null;
  }

  if (inboundBearerTokenProvided) {
    const token = normalizeString(body.inboundBearerToken);
    payload.inbound_bearer_token =
      body.inboundBearerToken === null
        ? null
        : isMaskedSecretPlaceholder(token)
          ? existing?.inbound_bearer_token || null
          : token || existing?.inbound_bearer_token || null;
  } else if (!existing) {
    payload.inbound_bearer_token = null;
  }

  // Sem "existing", os campos nao enviados cairiam nos defaults e sobrescreveriam
  // o que ja estava gravado (foi assim que chatbot_model virou "outlier" e
  // chatbot_enabled virou false a cada PATCH parcial). Quando nao sabemos o
  // estado atual, o seguro e NAO tocar no que o cliente nao mandou: a coluna
  // omitida do upsert preserva o valor da linha existente.
  if (!existing) {
    const enviados = {
      active: activeProvided,
      chatbot_enabled: chatbotEnabledProvided,
      chatbot_model: chatbotModelProvided,
      chatbot_instances: chatbotInstancesProvided,
      chatbot_inbound_scope: chatbotInboundScopeProvided,
      recontact_message: recontactMessageProvided,
      chatbot_llm_model: chatbotLlmModelProvided,
      agent_name: agentNameProvided,
      segmentation_config: segmentationConfigProvided,
      sdr_whatsapp_number: sdrWhatsappNumberProvided,
      allowed_tabs: allowedTabsProvided,
      send_window_start: sendWindowStartProvided,
      send_window_end: sendWindowEndProvided,
      send_window_days: sendWindowDaysProvided,
      send_window_timezone: sendWindowTimezoneProvided,
      send_window_enabled: sendWindowEnabledProvided,
      agent_replies_outside_window: agentRepliesOutsideWindowProvided,
    };
    for (const [coluna, foiEnviado] of Object.entries(enviados)) {
      if (!foiEnviado) delete payload[coluna];
    }
  }

  return payload;
}

export async function upsertLeadClientN8nSettings(clientId, input, authAccess, existing = null) {
  const payload = {
    client_id: clientId,
    ...buildN8nSettingsPayload(input, authAccess, existing),
  };

  const { data, error } = await supabase
    .from("lead_client_n8n_settings")
    .upsert(payload, { onConflict: "client_id" })
    .select(N8N_SETTINGS_SELECT_FIELDS)
    .single();

  if (error) throw error;
  return data;
}

export async function validateN8nInboundBearer(req, res, clientId) {
  const settings = await getLeadClientN8nSettings(clientId);
  const token = getRequestBearerToken(req);

  if (!settings || settings.active === false || !settings.inbound_bearer_token) {
    sendError(res, 401, "UNAUTHORIZED", "n8n inbound token is not configured for this client");
    return null;
  }

  if (!token || token !== settings.inbound_bearer_token) {
    sendError(res, 401, "UNAUTHORIZED", "Unauthorized");
    return null;
  }

  return settings;
}
