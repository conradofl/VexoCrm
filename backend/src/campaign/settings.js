// Campaign dispatch settings resolvers (movidos de server.js -- grupo D do mapa Onda 3, Run E).
// Movimento puro: corpos identicos aos de server.js na revisao 0ae005a (apos runs A-D, funcoes
// renumeradas mas nao alteradas).
// Modulo folha do grafo campaign/*: nao importa de dispatch.js nem de scheduler.js (evita ciclo).

import { normalizeString } from "../textNormalize.js";
import {
  normalizeTenantKey,
  normalizeHttpUrl,
  getClientEnvSuffix,
  parseJsonEnvMap,
} from "../services/tenant.js";
import { getSafeEvolutionEndpointLog, getLeadClientEvolutionInstances } from "../services/evolution.js";
import { getLeadClientN8nSettingsStatus } from "../services/n8nSettings.js";
import { normalizeCampaignAnalyticsMeta } from "../campaign-outbound.js";

export function resolveEnvDispatchWebhookSettings(clientId) {
  const suffix = getClientEnvSuffix(clientId);
  const candidates = [];

  if (suffix) {
    candidates.push({
      source: `env:EVOLUTION_DISPATCH_WEBHOOK_URL_${suffix}`,
      url: process.env[`EVOLUTION_DISPATCH_WEBHOOK_URL_${suffix}`],
      token: process.env[`EVOLUTION_DISPATCH_WEBHOOK_TOKEN_${suffix}`],
    });
    candidates.push({
      source: `env:N8N_DISPATCH_WEBHOOK_URL_${suffix}`,
      url: process.env[`N8N_DISPATCH_WEBHOOK_URL_${suffix}`],
      token: process.env[`N8N_DISPATCH_WEBHOOK_TOKEN_${suffix}`],
    });
  }

  for (const envName of ["EVOLUTION_DISPATCH_WEBHOOKS_JSON", "N8N_DISPATCH_WEBHOOKS_JSON"]) {
    const map = parseJsonEnvMap(envName);
    if (!map) continue;

    const rawConfig =
      map[clientId] ||
      map[normalizeTenantKey(clientId)] ||
      (suffix ? map[suffix] : null);
    if (!rawConfig) continue;

    if (typeof rawConfig === "string") {
      candidates.push({ source: `env:${envName}`, url: rawConfig, token: null });
      continue;
    }

    if (rawConfig && typeof rawConfig === "object") {
      candidates.push({
        source: `env:${envName}`,
        url: rawConfig.url || rawConfig.webhookUrl || rawConfig.dispatchWebhookUrl,
        token: rawConfig.token || rawConfig.webhookToken || rawConfig.dispatchWebhookToken,
      });
    }
  }

  for (const candidate of candidates) {
    const rawUrl = normalizeString(candidate.url);
    if (!rawUrl) continue;

    const webhookUrl = normalizeHttpUrl(rawUrl);
    if (!webhookUrl) {
      return {
        source: candidate.source,
        webhookUrl: null,
        webhookToken: null,
        invalid: true,
      };
    }

    return {
      source: candidate.source,
      webhookUrl,
      webhookToken: normalizeString(candidate.token),
      invalid: false,
    };
  }

  return null;
}

export function getSafeDispatchSettingsLog(settingsResult) {
  const endpoint = getSafeEvolutionEndpointLog(settingsResult?.webhookUrl);
  return {
    source: settingsResult?.source || "missing",
    schemaAvailable: settingsResult?.schemaAvailable !== false,
    webhookConfigured: !!settingsResult?.webhookUrl,
    settingsActive: settingsResult?.settings ? settingsResult.settings.active !== false : null,
    hasWebhookToken: !!settingsResult?.webhookToken,
    ...endpoint,
  };
}

export function logDirectDispatch(level, event, details = {}) {
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  logger("[campaign-direct-dispatch]", event, details);
}

export function logCampaignReplyFlow(level, event, details = {}) {
  const logger = level === "error" ? console.error : level === "warn" ? console.warn : console.info;
  logger("[campaign-reply-flow]", event, details);
}

export function resolveEnvCampaignQualificationWebhookSettings(clientId) {
  const suffix = getClientEnvSuffix(clientId);
  const candidates = [];

  if (suffix) {
    candidates.push({
      source: `env:CAMPAIGN_QUALIFICATION_WEBHOOK_URL_${suffix}`,
      url: process.env[`CAMPAIGN_QUALIFICATION_WEBHOOK_URL_${suffix}`],
      token: process.env[`CAMPAIGN_QUALIFICATION_WEBHOOK_TOKEN_${suffix}`],
    });
    candidates.push({
      source: `env:N8N_QUALIFICATION_WEBHOOK_URL_${suffix}`,
      url: process.env[`N8N_QUALIFICATION_WEBHOOK_URL_${suffix}`],
      token: process.env[`N8N_QUALIFICATION_WEBHOOK_TOKEN_${suffix}`],
    });
  }

  for (const envName of ["CAMPAIGN_QUALIFICATION_WEBHOOKS_JSON", "N8N_QUALIFICATION_WEBHOOKS_JSON"]) {
    const map = parseJsonEnvMap(envName);
    if (!map) continue;

    const rawConfig =
      map[clientId] ||
      map[normalizeTenantKey(clientId)] ||
      (suffix ? map[suffix] : null);
    if (!rawConfig) continue;

    if (typeof rawConfig === "string") {
      candidates.push({ source: `env:${envName}`, url: rawConfig, token: null });
      continue;
    }

    if (rawConfig && typeof rawConfig === "object") {
      candidates.push({
        source: `env:${envName}`,
        url: rawConfig.url || rawConfig.webhookUrl || rawConfig.qualificationWebhookUrl,
        token: rawConfig.token || rawConfig.webhookToken || rawConfig.qualificationWebhookToken,
      });
    }
  }

  candidates.push({
    source: "env:CAMPAIGN_QUALIFICATION_WEBHOOK_URL",
    url: process.env.CAMPAIGN_QUALIFICATION_WEBHOOK_URL,
    token: process.env.CAMPAIGN_QUALIFICATION_WEBHOOK_TOKEN,
  });
  candidates.push({
    source: "env:N8N_QUALIFICATION_WEBHOOK_URL",
    url: process.env.N8N_QUALIFICATION_WEBHOOK_URL,
    token: process.env.N8N_QUALIFICATION_WEBHOOK_TOKEN,
  });

  for (const candidate of candidates) {
    const rawUrl = normalizeString(candidate.url);
    if (!rawUrl) continue;

    const webhookUrl = normalizeHttpUrl(rawUrl);
    if (!webhookUrl) {
      return {
        source: candidate.source,
        webhookUrl: null,
        webhookToken: null,
        invalid: true,
      };
    }

    return {
      source: candidate.source,
      webhookUrl,
      webhookToken: normalizeString(candidate.token),
      invalid: false,
    };
  }

  return null;
}

export async function resolveDispatchWebhookSettings(clientId) {
  const settingsStatus = await getLeadClientN8nSettingsStatus(clientId);
  const settings = settingsStatus.settings;
  const hasActiveClientSettings =
    settings && settings.active !== false && !!settings.dispatch_webhook_url;

  if (hasActiveClientSettings) {
    return {
      settings,
      webhookUrl: settings.dispatch_webhook_url,
      webhookToken: settings.dispatch_webhook_token || null,
      source: "client_settings",
      schemaAvailable: settingsStatus.schemaAvailable,
    };
  }

  const envSettings = resolveEnvDispatchWebhookSettings(clientId);
  if (envSettings?.webhookUrl) {
    return {
      settings,
      webhookUrl: envSettings.webhookUrl,
      webhookToken: envSettings.webhookToken || null,
      source: envSettings.source,
      schemaAvailable: settingsStatus.schemaAvailable,
    };
  }

  if (envSettings?.invalid) {
    return {
      settings,
      webhookUrl: null,
      webhookToken: null,
      source: "env_invalid",
      schemaAvailable: settingsStatus.schemaAvailable,
    };
  }

  const source =
    settingsStatus.source === "schema_missing"
      ? "schema_missing"
      : settings && settings.active === false
        ? "inactive"
        : settings
          ? "missing_url"
          : "missing";

  const instances = Array.isArray(settings?.evolution_instances) ? settings.evolution_instances : [];
  const activeInstances = instances.filter((i) => i.active !== false);
  const legacyHasUrl = Boolean(settings?.dispatch_webhook_url);
  console.warn("[dispatch-settings] Webhook URL nao resolvida para o tenant:", {
    clientId,
    source,
    totalInstances: instances.length,
    activeInstances: activeInstances.length,
    legacyHasUrl,
  });

  return {
    settings,
    webhookUrl: null,
    webhookToken: null,
    source,
    schemaAvailable: settingsStatus.schemaAvailable,
  };
}

const INBOUND_CHIP_LAST_GOOD_HORIZON_MS = 5 * 60 * 1000; // 5 minutos de horizonte de degradação em oscilação de banco
const inboundChipLastGoodCache = new Map();

function formatInboundChipAge(ms) {
  const seg = Math.max(0, Math.floor(ms / 1000));
  if (seg < 60) return `${seg}s`;
  const min = Math.floor(seg / 60);
  return `${min}m ${seg % 60}s`;
}

/** So para teste: zera o cache de chips entre casos. */
export function _resetInboundChipLastGoodCache() {
  inboundChipLastGoodCache.clear();
}

/**
 * URL da Evolution para a resposta do INBOUND.
 *
 * Defeito que isto corrige: o inbound usava resolveDispatchWebhookSettings(clientId),
 * que resolve o chip DEFAULT do tenant e ignora por qual numero a mensagem chegou.
 * O disparo de campanha nunca teve esse problema porque resolve pela instancia
 * escolhida na campanha (resolveCampaignDispatchSettings) — dois resolvedores, e o
 * inbound usava o que nao sabe de qual chip veio a conversa. Em producao a IA gerava
 * a resposta e o envio abortava com "No Evolution URL", com lead real em silencio.
 *
 * Ordem: o chip que RECEBEU a mensagem; sem identificar, o default do tenant.
 * Devolve `tentativas` para o log dizer o que foi consultado e o que veio vazio —
 * este caminho nao pode mais falhar sem explicar.
 *
 * Resiliência (lastGood):
 * - Em caso de oscilação transitória do banco, usa o chip previamente resolvido para
 *   aquele MESMO tenant (estritamente isolado por clientId) dentro do horizonte curto
 *   de 5 minutos. Passado esse horizonte, recusa o envio com erro explícito para evitar
 *   disparar por chips que foram desconectados ou banidos.
 */
export async function resolveInboundDispatchSettings({ clientId, instanceName = null }) {
  const agora = Date.now();
  const tentativas = [];
  const alvo = normalizeString(instanceName);
  const cacheKey = `${clientId}::${alvo || "__default__"}`;

  if (alvo) {
    let instancias;
    try {
      instancias = await getLeadClientEvolutionInstances(clientId);
    } catch (err) {
      const lastGood = inboundChipLastGoodCache.get(cacheKey);
      // Isolamento estrito por tenant: garante que o registro pertence exatamente a este clientId
      if (
        lastGood &&
        lastGood.clientId === clientId &&
        agora - lastGood.timestamp < INBOUND_CHIP_LAST_GOOD_HORIZON_MS
      ) {
        const idadeMs = agora - lastGood.timestamp;
        const idadeLegivel = formatInboundChipAge(idadeMs);
        console.warn(`[inbound-dispatch-settings] oscilação de banco: usando chip em cache de ${idadeLegivel} atrás`, {
          clientId,
          instanceName: alvo,
          idadeMs,
          idadeLegivel,
          aviso: `usando chip em cache de ${idadeLegivel} atrás`,
          erro: err?.message || err,
        });
        tentativas.push({
          fonte: "chip_do_webhook_cache",
          instanceName: alvo,
          resultado: "usado_last_good",
          idadeLegivel,
        });
        return {
          webhookUrl: lastGood.webhookUrl,
          webhookToken: lastGood.webhookToken,
          source: "inbound_chip_cache",
          instanceName: lastGood.instanceName || alvo,
          tentativas,
        };
      }

      console.error("[inbound-dispatch-settings] falha de leitura no banco ao buscar instâncias Evolution do tenant sem cache válido", {
        clientId,
        instanceName: alvo,
        error: err?.message || String(err),
      });
      tentativas.push({
        fonte: "chip_do_webhook",
        instanceName: alvo,
        resultado: "erro_de_leitura_banco",
        erro: err?.message || String(err),
      });
      // Em caminho de ENVIO de mensagem: falha de leitura no banco sem cache válido recusa o envio
      throw new Error(
        `[inbound-dispatch-settings] falha de banco ao resolver chip '${alvo}' para o tenant '${clientId}': ${err?.message || err}`
      );
    }

    // O mesmo chip tem tres nomes: o amigavel, o id, e o ultimo segmento da URL de
    // disparo. O webhook manda um deles — comparar so por `name` erra.
    const casada = instancias.find((inst) => {
      const daUrl = inst.dispatch_webhook_url
        ? inst.dispatch_webhook_url.split("/").filter(Boolean).pop()
        : null;
      return inst.name === alvo || inst.id === alvo || daUrl === alvo;
    });

    if (!casada) {
      tentativas.push({ fonte: "chip_do_webhook", instanceName: alvo, resultado: "instancia_nao_encontrada" });
    } else if (casada.active === false) {
      tentativas.push({ fonte: "chip_do_webhook", instanceName: alvo, resultado: "instancia_inativa" });
    } else if (!normalizeString(casada.dispatch_webhook_url)) {
      tentativas.push({ fonte: "chip_do_webhook", instanceName: alvo, resultado: "sem_url_de_disparo" });
    } else {
      const urlInstance = casada.dispatch_webhook_url
        ? casada.dispatch_webhook_url.split("/").filter(Boolean).pop()
        : null;
      const resolved = {
        webhookUrl: normalizeString(casada.dispatch_webhook_url),
        webhookToken: normalizeString(casada.dispatch_webhook_token) || null,
        source: "inbound_chip",
        instanceName: urlInstance || casada.name || alvo,
        rawInstanceName: casada.name || alvo,
        tentativas,
      };
      // Guarda leitura boa no cache isolado do tenant
      inboundChipLastGoodCache.set(cacheKey, {
        clientId,
        instanceName: resolved.instanceName,
        webhookUrl: resolved.webhookUrl,
        webhookToken: resolved.webhookToken,
        timestamp: agora,
      });
      return resolved;
    }
  } else {
    tentativas.push({ fonte: "chip_do_webhook", resultado: "webhook_sem_instance" });
  }

  let doTenant;
  try {
    doTenant = await resolveDispatchWebhookSettings(clientId);
  } catch (err) {
    const lastGood = inboundChipLastGoodCache.get(cacheKey);
    if (
      lastGood &&
      lastGood.clientId === clientId &&
      agora - lastGood.timestamp < INBOUND_CHIP_LAST_GOOD_HORIZON_MS
    ) {
      const idadeMs = agora - lastGood.timestamp;
      const idadeLegivel = formatInboundChipAge(idadeMs);
      console.warn(`[inbound-dispatch-settings] oscilação de banco: usando chip default em cache de ${idadeLegivel} atrás`, {
        clientId,
        idadeMs,
        idadeLegivel,
        aviso: `usando chip default em cache de ${idadeLegivel} atrás`,
        erro: err?.message || err,
      });
      tentativas.push({
        fonte: "default_do_tenant_cache",
        resultado: "usado_last_good",
        idadeLegivel,
      });
      return {
        webhookUrl: lastGood.webhookUrl,
        webhookToken: lastGood.webhookToken,
        source: "tenant_cache",
        instanceName: alvo || null,
        tentativas,
      };
    }
    throw err;
  }

  tentativas.push({ fonte: "default_do_tenant", resultado: doTenant.source, temUrl: Boolean(doTenant.webhookUrl) });

  const resolved = {
    webhookUrl: doTenant.webhookUrl,
    webhookToken: doTenant.webhookToken,
    source: doTenant.webhookUrl ? `tenant:${doTenant.source}` : doTenant.source,
    instanceName: alvo || null,
    tentativas,
  };

  if (resolved.webhookUrl) {
    inboundChipLastGoodCache.set(cacheKey, {
      clientId,
      instanceName: resolved.instanceName,
      webhookUrl: resolved.webhookUrl,
      webhookToken: resolved.webhookToken,
      timestamp: agora,
    });
  }

  return resolved;
}

export async function resolveCampaignDispatchSettings(clientId, campaign = {}) {
  const analyticsMeta = normalizeCampaignAnalyticsMeta(campaign.analytics_meta || {});
  let selectedEvolutionInstanceId = normalizeString(analyticsMeta.dispatchOptions?.evolutionInstanceId);
  const instances = await getLeadClientEvolutionInstances(clientId);
  const activeInstances = Array.isArray(instances) ? instances.filter((i) => i.active !== false) : [];

  // 1. Se o usuário selecionou uma instância específica ativa
  if (selectedEvolutionInstanceId) {
    const selectedInstance = instances.find((instance) => instance.id === selectedEvolutionInstanceId) || null;
    if (selectedInstance && selectedInstance.active !== false && selectedInstance.dispatch_webhook_url) {
      return {
        webhookUrl: normalizeString(selectedInstance.dispatch_webhook_url),
        webhookToken: normalizeString(selectedInstance.dispatch_webhook_token) || null,
        source: "campaign_evolution_instance",
        schemaAvailable: true,
        selectedEvolutionInstanceId,
        selectedEvolutionInstanceName: selectedInstance.name || "Evolution",
        usingCachedCampaignSettings: false,
        tenantSettingsSource: "campaign_evolution_instance",
      };
    }
  }

  // 2. Se há pelo menos uma instância ativa para esta empresa, usa a default ou a primeira ativa
  if (activeInstances.length > 0) {
    const primaryInstance = activeInstances.find((i) => i.is_default === true) || activeInstances[0];
    if (primaryInstance && primaryInstance.dispatch_webhook_url) {
      return {
        webhookUrl: normalizeString(primaryInstance.dispatch_webhook_url),
        webhookToken: normalizeString(primaryInstance.dispatch_webhook_token) || null,
        source: "auto_primary_evolution_instance",
        schemaAvailable: true,
        selectedEvolutionInstanceId: primaryInstance.id,
        selectedEvolutionInstanceName: primaryInstance.name || "WhatsApp Principal",
        usingCachedCampaignSettings: false,
        tenantSettingsSource: "auto_primary_evolution_instance",
      };
    }
  }

  // 3. Fallback estritamente para as configurações do próprio tenant (lead_client_n8n_settings / env do tenant)
  const tenantDispatch = await resolveDispatchWebhookSettings(clientId);
  const tenantWebhookUrl = normalizeString(tenantDispatch.webhookUrl);
  const tenantWebhookToken = normalizeString(tenantDispatch.webhookToken) || null;
  const cachedWebhookUrl = normalizeString(campaign.webhook_url);
  const cachedWebhookToken = normalizeString(campaign.webhook_token) || null;
  const webhookUrl = tenantWebhookUrl || cachedWebhookUrl || null;
  const webhookToken = tenantWebhookUrl ? tenantWebhookToken : (cachedWebhookToken || null);

  return {
    ...tenantDispatch,
    webhookUrl,
    webhookToken,
    source: tenantWebhookUrl ? tenantDispatch.source : (cachedWebhookUrl ? "campaign_cache" : "tenant_settings_missing"),
    usingCachedCampaignSettings: !tenantWebhookUrl && !!cachedWebhookUrl,
    tenantSettingsSource: tenantDispatch.source || "tenant_settings_missing",
  };
}
