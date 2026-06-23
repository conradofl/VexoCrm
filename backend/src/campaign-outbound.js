import { randomUUID } from "crypto";
import { isFilterShape, normalizeFilters } from "./segmentation.js";

export const DEFAULT_LEAD_DELAY_SECONDS = 2;
export const DEFAULT_STEP_DELAY_SECONDS = 5;
export const DEFAULT_REPLY_TIMEOUT_SECONDS = 60;
export const DEFAULT_REPLY_POLL_INTERVAL_SECONDS = 5;
export const DEFAULT_STEP_TRIGGER_MODE = "immediate";
const DEFAULT_STEP_FAILURE_MODE = true;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const MAX_REPLY_TIMEOUT_SECONDS = 15 * 60;
const MAX_REPLY_POLL_INTERVAL_SECONDS = 60;

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "sim"].includes(normalized)) return true;
    if (["false", "0", "no", "nao", "não"].includes(normalized)) return false;
  }
  return fallback;
}

function normalizeNonNegativeInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed) || parsed < 0) return fallback;
  return parsed;
}

function normalizeTextVariants(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(value.map(normalizeString).filter(Boolean))
  ).slice(0, 20);
}

/**
 * Replace per-lead placeholders in outbound copy (Evolution text/caption).
 * Supports {{nome}} and {{telefone}} with optional spaces inside braces (case-insensitive tokens).
 */
function applyMessagePlaceholders(text, lead, phone) {
  let raw = normalizeString(text);
  if (!raw) return raw;
  const nome = normalizeString(lead?.nome) || "cliente";
  const tel = normalizeString(phone) || normalizeString(lead?.telefone || lead?.phone);
  
  raw = raw
    .replace(/\{\{\s*nome\s*\}\}/gi, nome)
    .replace(/\{\{\s*telefone\s*\}\}/gi, tel || "");

  // Dynamic placeholders from spreadsheet columns (normalized_data)
  const customData = {
    ...(lead || {}),
    ...(lead?.normalized_data || {}),
    ...(lead?.normalizedData || {}),
  };

  for (const [key, value] of Object.entries(customData)) {
    if (typeof value === "string" || typeof value === "number") {
      const regex = new RegExp(`\\{\\{\\s*${key}\\s*\\\}\\}`, "gi");
      raw = raw.replace(regex, String(value));
    }
  }

  return raw;
}

function resolveStepTextForLead(step, leadIndex) {
  const variants = normalizeTextVariants(step?.textVariants);
  if (variants.length === 0) return normalizeString(step?.text);
  return variants[leadIndex % variants.length];
}

function clampPositiveSize(value) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (Number.isNaN(parsed) || parsed < 0) return 0;
  return parsed;
}

function normalizeImageAsset(asset) {
  if (!asset || typeof asset !== "object") return null;

  const dataUrl = normalizeString(asset.dataUrl);
  if (!dataUrl.startsWith("data:")) return null;

  return {
    name: normalizeString(asset.name) || `imagem-${randomUUID().slice(0, 8)}.png`,
    type: normalizeString(asset.type) || "image/png",
    size: clampPositiveSize(asset.size),
    dataUrl,
  };
}

function getLegacySequence(rawMeta = {}) {
  const sequence = [];
  const message = normalizeString(rawMeta.message);
  const image = normalizeImageAsset(rawMeta.image);

  if (message) {
    sequence.push({
      id: `legacy-text-${randomUUID().slice(0, 8)}`,
      type: "text",
      order: 1,
      text: message,
      image: null,
      enabled: true,
      delayAfterSeconds: DEFAULT_STEP_DELAY_SECONDS,
    });
  }

  if (image) {
    sequence.push({
      id: `legacy-image-${randomUUID().slice(0, 8)}`,
      type: "image",
      order: sequence.length + 1,
      text: "",
      image,
      enabled: true,
      delayAfterSeconds: DEFAULT_STEP_DELAY_SECONDS,
    });
  }

  return sequence;
}

function normalizeSequenceStep(step, index) {
  const type = normalizeString(step?.type).toLowerCase() === "image" ? "image" : "text";
  const triggerMode =
    normalizeString(step?.triggerMode).toLowerCase() === "after_reply"
      ? "after_reply"
      : DEFAULT_STEP_TRIGGER_MODE;

  return {
    id: normalizeString(step?.id) || randomUUID(),
    type,
    order: normalizeNonNegativeInteger(step?.order, index + 1) || index + 1,
    text: normalizeString(step?.text),
    textVariants: normalizeTextVariants(step?.textVariants),
    image: normalizeImageAsset(step?.image),
    enabled: step?.enabled === undefined ? true : normalizeBoolean(step.enabled, true),
    delayAfterSeconds: normalizeNonNegativeInteger(
      step?.delayAfterSeconds,
      DEFAULT_STEP_DELAY_SECONDS
    ),
    triggerMode,
  };
}

function normalizeDispatchOptions(rawOptions = {}) {
  const waitForReply = normalizeBoolean(rawOptions.waitForReply, false);
  const replyTimeoutSeconds = Math.min(
    normalizeNonNegativeInteger(rawOptions.replyTimeoutSeconds, DEFAULT_REPLY_TIMEOUT_SECONDS),
    MAX_REPLY_TIMEOUT_SECONDS
  );
  const replyPollIntervalSeconds = Math.min(
    Math.max(
      normalizeNonNegativeInteger(rawOptions.replyPollIntervalSeconds, DEFAULT_REPLY_POLL_INTERVAL_SECONDS),
      1
    ),
    MAX_REPLY_POLL_INTERVAL_SECONDS
  );

  return {
    leadDelaySeconds: normalizeNonNegativeInteger(
      rawOptions.leadDelaySeconds,
      DEFAULT_LEAD_DELAY_SECONDS
    ),
    stopOnStepFailure:
      rawOptions.stopOnStepFailure === undefined
        ? DEFAULT_STEP_FAILURE_MODE
        : normalizeBoolean(rawOptions.stopOnStepFailure, DEFAULT_STEP_FAILURE_MODE),
    aiAssisted: normalizeBoolean(rawOptions.aiAssisted, false),
    templateStrategy:
      normalizeString(rawOptions.templateStrategy) === "ai_variations" ? "ai_variations" : "single",
    templateVariantCount: Math.min(
      Math.max(normalizeNonNegativeInteger(rawOptions.templateVariantCount, 0), 0),
      20
    ),
    waitForReply,
    replyTimeoutSeconds,
    replyPollIntervalSeconds,
    evolutionInstanceId: normalizeString(rawOptions.evolutionInstanceId) || null,
  };
}

export function normalizeCampaignAnalyticsMeta(rawMeta = {}) {
  const meta = rawMeta && typeof rawMeta === "object" ? rawMeta : {};
  const providedSequence = Array.isArray(meta.sequence) ? meta.sequence : [];
  const normalizedSequence =
    providedSequence.length > 0
      ? providedSequence.map(normalizeSequenceStep)
      : getLegacySequence(meta);
  const sequence = normalizedSequence
    .sort((left, right) => left.order - right.order)
    .map((step, index) => ({
      ...step,
      order: index + 1,
    }));

  const firstTextStep = sequence.find((step) => step.enabled && step.type === "text" && step.text);
  const firstImageStep = sequence.find((step) => step.enabled && step.type === "image" && step.image);

  // Segmentação: shape novo { filters:[...] } é limpo aqui (sem catálogo — a validação
  // por campo do tenant ocorre no disparo). Shape legado passa intacto p/ compat.
  let segmentation = {};
  if (isFilterShape(meta.segmentation)) {
    segmentation = { filters: normalizeFilters(meta.segmentation) };
  } else if (meta.segmentation && typeof meta.segmentation === "object") {
    segmentation = meta.segmentation;
  }

  return {
    ...meta,
    segmentation,
    message: normalizeString(meta.message) || firstTextStep?.text || "",
    image: normalizeImageAsset(meta.image) || firstImageStep?.image || null,
    sequence,
    dispatchOptions: normalizeDispatchOptions(meta.dispatchOptions),
  };
}

export function getEnabledCampaignSteps(rawMeta = {}) {
  return normalizeCampaignAnalyticsMeta(rawMeta).sequence.filter((step) => step.enabled);
}

export function getCampaignStepPlan(rawMeta = {}) {
  const analyticsMeta = normalizeCampaignAnalyticsMeta(rawMeta);
  const enabledSteps = analyticsMeta.sequence.filter((step) => step.enabled);
  const immediateSteps = enabledSteps.filter((step) => step.triggerMode !== "after_reply");
  const replySteps = enabledSteps
    .map((step, index) => ({ step, index }))
    .filter((entry) => entry.step.triggerMode === "after_reply");
  const shouldUseReplyFlow =
    analyticsMeta.dispatchOptions.waitForReply === true && replySteps.length > 0;

  return {
    analyticsMeta,
    enabledSteps,
    immediateSteps,
    replySteps,
    shouldUseReplyFlow,
  };
}

export function validateCampaignAnalyticsMeta(rawMeta = {}) {
  const analyticsMeta = normalizeCampaignAnalyticsMeta(rawMeta);
  const enabledSteps = analyticsMeta.sequence.filter((step) => step.enabled);

  if (enabledSteps.length === 0) {
    return {
      valid: false,
      analyticsMeta,
      message: "Adicione pelo menos um passo ativo na sequencia da campanha.",
    };
  }

  for (const step of enabledSteps) {
    if (step.type === "text" && !step.text && step.textVariants.length === 0) {
      return {
        valid: false,
        analyticsMeta,
        message: `O passo ${step.order} precisa de texto ou variacoes para envio.`,
      };
    }

    if (step.type === "image" && !step.image) {
      return {
        valid: false,
        analyticsMeta,
        message: `O passo ${step.order} precisa de uma imagem valida para envio.`,
      };
    }
  }

  if (analyticsMeta.dispatchOptions.waitForReply === true) {
    const immediateSteps = enabledSteps.filter((step) => step.triggerMode !== "after_reply");
    const replySteps = enabledSteps.filter((step) => step.triggerMode === "after_reply");
    if (replySteps.length > 0 && immediateSteps.length === 0) {
      return {
        valid: false,
        analyticsMeta,
        message:
          "Campanhas com resposta avancada precisam de pelo menos um passo imediato antes dos passos apos resposta.",
      };
    }
  }

  return { valid: true, analyticsMeta, message: null };
}

function sleep(ms) {
  if (!ms || ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRequestHeaders(token) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.apikey = token;
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function maskOutboundPhone(value) {
  const normalized = normalizeString(value).replace(/\D/g, "");
  if (!normalized) return null;
  return `${"*".repeat(Math.max(normalized.length - 4, 0))}${normalized.slice(-4)}`;
}

function getSafeEndpointInfo(webhookUrl) {
  const rawUrl = normalizeString(webhookUrl);
  if (!rawUrl) {
    return {
      endpointOrigin: null,
      endpointPath: null,
      instance: null,
    };
  }

  try {
    const url = new URL(rawUrl);
    const pathParts = url.pathname.split("/").filter(Boolean);
    const messageIndex = pathParts.findIndex((part) => part === "message");
    return {
      endpointOrigin: url.origin,
      endpointPath: url.pathname,
      instance: messageIndex >= 0 ? decodeURIComponent(pathParts[messageIndex + 2] || "") || null : null,
    };
  } catch {
    return {
      endpointOrigin: null,
      endpointPath: null,
      instance: null,
    };
  }
}

function resolveStepWebhookUrl(webhookUrl, payload) {
  if (typeof webhookUrl === "string") {
    if (payload?.type === "image") {
      return webhookUrl.replace("/message/sendText/", "/message/sendMedia/");
    }
    if (Array.isArray(payload?.buttons) && payload.buttons.length > 0) {
      return webhookUrl.replace("/message/sendText/", "/message/sendButtons/");
    }
  }
  return webhookUrl;
}

function parseDataUrl(dataUrl) {
  const match = /^data:(.+?);base64,(.+)$/.exec(dataUrl || "");
  if (!match) return null;

  return {
    mimeType: match[1],
    base64: match[2],
  };
}

function buildTextPayload(phone, step, context = {}) {
  const formattedButtons = Array.isArray(step.buttons) && step.buttons.length > 0
    ? step.buttons.map((btn, idx) => ({
        type: btn.type === "url" ? "url" : "reply",
        displayText: btn.displayText || btn.label || `Botao ${idx + 1}`,
        id: `btn-${step.id}-${idx}`,
        url: btn.type === "url" && btn.url ? applyMessagePlaceholders(btn.url, context.lead, phone) : undefined,
      }))
    : null;

  return {
    source: "vexocrm",
    provider: "evolution",
    type: "text",
    stepType: "text",
    stepId: step.id,
    number: phone,
    txt: step.text,
    text: step.text,
    message: step.text,
    title: step.text,
    description: step.text,
    buttons: formattedButtons,
    campaign: context.campaign || null,
    client: context.client || null,
  };
}

function buildImagePayload(phone, step, context = {}) {
  const parsedImage = parseDataUrl(step.image?.dataUrl || "");
  const formattedButtons = Array.isArray(step.buttons) && step.buttons.length > 0
    ? step.buttons.map((btn, idx) => ({
        type: btn.type === "url" ? "url" : "reply",
        displayText: btn.displayText || btn.label || `Botao ${idx + 1}`,
        id: `btn-${step.id}-${idx}`,
        url: btn.type === "url" && btn.url ? applyMessagePlaceholders(btn.url, context.lead, phone) : undefined,
      }))
    : null;

  return {
    source: "vexocrm",
    provider: "evolution",
    type: "image",
    stepType: "image",
    stepId: step.id,
    number: phone,
    txt: step.text || "",
    caption: step.text || "",
    buttons: formattedButtons,
    fileName: step.image?.name || null,
    filename: step.image?.name || null,
    mimeType: parsedImage?.mimeType || step.image?.type || null,
    mimetype: parsedImage?.mimeType || step.image?.type || null,
    mediatype: "image",
    base64: parsedImage?.base64 || null,
    mediaBase64: parsedImage?.base64 || null,
    media: parsedImage?.base64 || null,
    dataUrl: step.image?.dataUrl || null,
    image: step.image || null,
    mediaObject: step.image
      ? {
          fileName: step.image.name,
          mimeType: parsedImage?.mimeType || step.image.type,
          base64: parsedImage?.base64 || null,
          dataUrl: step.image.dataUrl,
          size: step.image.size,
        }
      : null,
    campaign: context.campaign || null,
    client: context.client || null,
  };
}

async function postEvolutionPayload(webhookUrl, webhookToken, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
  const stepWebhookUrl = resolveStepWebhookUrl(webhookUrl, payload);
  const endpointInfo = getSafeEndpointInfo(stepWebhookUrl);

  try {
    console.info("[campaign-outbound] whatsapp_step_request", {
      type: payload?.type || null,
      stepId: payload?.stepId || null,
      phone: maskOutboundPhone(payload?.number),
      endpointMode: payload?.type === "image" ? "media" : "text",
      ...endpointInfo,
      hasMedia: Boolean(payload?.base64 || payload?.mediaBase64 || payload?.dataUrl),
      hasCaption: Boolean(payload?.caption),
    });
    const response = await fetch(stepWebhookUrl, {
      method: "POST",
      headers: buildRequestHeaders(webhookToken),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const responseText = await response.text();

    if (!response.ok) {
      const isConnectionClosed =
        responseText.includes("Connection Closed") || responseText.includes("connection closed");
      const isUnauthorized = response.status === 401 || response.status === 403;

      console.warn("[campaign-outbound] whatsapp_step_failed", {
        type: payload?.type || null,
        stepId: payload?.stepId || null,
        phone: maskOutboundPhone(payload?.number),
        ...endpointInfo,
        status: response.status,
        isConnectionClosed,
        isUnauthorized,
        webhookUrl: stepWebhookUrl ? stepWebhookUrl.replace(/\/[^/]+$/, "/***") : null,
        responsePreview: responseText.slice(0, 300),
      });

      let userMessage;
      if (isConnectionClosed) {
        userMessage = `Sessao WhatsApp desconectada na Evolution API (HTTP ${response.status}). Verifique se a instancia esta conectada e reinicie se necessario.`;
      } else if (isUnauthorized) {
        userMessage = `Token de autenticacao invalido para a Evolution API (HTTP ${response.status}). Verifique o dispatch_webhook_token nas configuracoes da empresa.`;
      } else {
        userMessage = responseText
          ? `HTTP ${response.status}: ${responseText.slice(0, 500)}`
          : `HTTP ${response.status}`;
      }

      throw new Error(userMessage);
    }

    console.info("[campaign-outbound] whatsapp_step_success", {
      type: payload?.type || null,
      stepId: payload?.stepId || null,
      phone: maskOutboundPhone(payload?.number),
      ...endpointInfo,
      status: response.status,
    });

    return {
      ok: true,
      status: response.status,
      body: responseText || null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function dispatchCampaignSequence({
  webhookUrl,
  webhookToken = null,
  leads = [],
  analyticsMeta = {},
  context = {},
  onLeadDispatched = null,
  onStepDispatched = null,
  shouldContinue = null,
  chipProvider = null,
  leadDelayProvider = null,
  onLeadClaim = null,
  onLeadFailed = null,
}) {
  const normalizedMeta = normalizeCampaignAnalyticsMeta(analyticsMeta);
  const enabledSteps = normalizedMeta.sequence.filter((step) => step.enabled);
  const summary = {
    successCount: 0,
    failureCount: 0,
    successPhones: [],
    failures: [],
    warnings: [],
    completedCampaign: false,
    paused: false,
    allChipsExhausted: false,
  };
  const failedPhones = new Set();

  for (let leadIndex = 0; leadIndex < leads.length; leadIndex += 1) {
    if (typeof shouldContinue === "function" && !(await shouldContinue({ leadIndex, phase: "lead" }))) {
      summary.paused = true;
      break;
    }

    const lead = leads[leadIndex];
    const phone = normalizeString(lead?.telefone || lead?.phone || lead?.number);

    if (!phone) {
      failedPhones.add(`missing-phone-${leadIndex}`);
      summary.failures.push({
        phone: null,
        stepId: null,
        stepType: null,
        reason: "Lead sem telefone valido para disparo.",
      });
      continue;
    }

    let leadWebhookUrl = webhookUrl;
    let leadWebhookToken = webhookToken;
    let activeChip = null;
    if (typeof chipProvider === "function") {
      activeChip = await chipProvider({ leadIndex });
      if (!activeChip) {
        summary.allChipsExhausted = true;
        break;
      }
      leadWebhookUrl = activeChip.webhookUrl;
      leadWebhookToken = activeChip.webhookToken ?? null;
    }

    // Defeito A: claim idempotente imediatamente ANTES do envio (chip já reservado).
    // Se o lead já foi tocado neste disparo, pula — e devolve a cota reservada do chip.
    if (typeof onLeadClaim === "function") {
      const claimed = await onLeadClaim({ lead, phone, leadIndex });
      if (!claimed) {
        if (activeChip && typeof activeChip.release === "function") {
          try {
            await activeChip.release();
          } catch {
            /* devolução de cota é best-effort */
          }
        }
        continue;
      }
    }

    let leadFailed = false;
    let leadFailReason = null;
    let leadSentAnything = false;
    let lastSuccessfulStep = null;
    let lastSuccessfulStepIndex = null;
    let lastSentAt = null;

    for (let stepIndex = 0; stepIndex < enabledSteps.length; stepIndex += 1) {
      if (
        typeof shouldContinue === "function" &&
        !(await shouldContinue({ leadIndex, stepIndex, phase: "step" }))
      ) {
        summary.paused = true;
        break;
      }

      const step = enabledSteps[stepIndex];
      const stepForPayload = {
        ...step,
        text: applyMessagePlaceholders(resolveStepTextForLead(step, leadIndex), lead, phone),
      };
      const extendedContext = {
        ...context,
        lead: {
          ...lead,
          id: lead?.id || null,
          nome: normalizeString(lead?.nome) || null,
          telefone: phone,
        },
      };
      const payload =
        step.type === "image"
          ? buildImagePayload(phone, stepForPayload, extendedContext)
          : buildTextPayload(phone, stepForPayload, extendedContext);

      try {
        const sentAt = new Date().toISOString();
        await postEvolutionPayload(leadWebhookUrl, leadWebhookToken, payload);
        leadSentAnything = true;
        lastSuccessfulStep = step;
        lastSuccessfulStepIndex = stepIndex;
        lastSentAt = sentAt;
        if (typeof onStepDispatched === "function") {
          try {
            await onStepDispatched({
              lead,
              phone,
              step,
              stepIndex,
              totalSteps: enabledSteps.length,
              sentAt,
              hasNextStep: stepIndex < enabledSteps.length - 1,
            });
          } catch (callbackError) {
            summary.warnings.push({
              phone,
              stepId: step.id,
              stepType: step.type,
              reason:
                callbackError instanceof Error
                  ? callbackError.message
                  : "Falha ao salvar o estado interno da campanha apos envio bem-sucedido.",
            });
          }
        }
      } catch (error) {
        leadFailed = true;
        failedPhones.add(phone);
        const failureReason =
          error?.name === "AbortError"
            ? "Timeout ao chamar a integracao Evolution."
            : error instanceof Error
              ? error.message
              : "Falha ao chamar a integracao Evolution.";
        if (!leadFailReason) leadFailReason = failureReason;
        summary.failures.push({
          phone,
          stepId: step.id,
          stepType: step.type,
          reason: failureReason,
        });

        if (normalizedMeta.dispatchOptions.stopOnStepFailure) {
          break;
        }
      }

      const hasNextStep = stepIndex < enabledSteps.length - 1;
      if (hasNextStep) {
        await sleep(step.delayAfterSeconds * 1000);
      }
    }

    if (summary.paused) break;

    if (activeChip && typeof activeChip.release === "function" && !leadSentAnything) {
      try {
        await activeChip.release();
      } catch {
        /* devolução de cota é best-effort */
      }
    }

    if (!leadFailed) {
      summary.successCount += 1;
      summary.successPhones.push(phone);

      if (typeof onLeadDispatched === "function") {
        try {
          await onLeadDispatched({
            lead,
            phone,
            sentAt: lastSentAt,
            lastStep: lastSuccessfulStep,
            lastStepIndex: lastSuccessfulStepIndex,
            totalSteps: enabledSteps.length,
          });
        } catch (callbackError) {
          const reason =
            callbackError instanceof Error
              ? callbackError.message
              : "Falha ao salvar o estado interno do lead apos envio bem-sucedido.";
          summary.warnings.push({
            phone,
            stepId: lastSuccessfulStep?.id || null,
            stepType: lastSuccessfulStep?.type || null,
            reason,
          });
          console.warn("[campaign-outbound] lead_callback_failed", {
            phone: maskOutboundPhone(phone),
            stepId: lastSuccessfulStep?.id || null,
            stepType: lastSuccessfulStep?.type || null,
            reason,
          });
        }
      }
    } else if (typeof onLeadFailed === "function") {
      // Defeito A: finaliza o registro de claim deste lead como 'failed' (não volta à fila).
      try {
        await onLeadFailed({ lead, phone, reason: leadFailReason });
      } catch (callbackError) {
        console.warn("[campaign-outbound] lead_failed_callback_failed", {
          phone: maskOutboundPhone(phone),
          reason: callbackError instanceof Error ? callbackError.message : String(callbackError),
        });
      }
    }

    const hasNextLead = leadIndex < leads.length - 1;
    if (hasNextLead) {
      if (typeof shouldContinue === "function" && !(await shouldContinue({ leadIndex, phase: "lead_delay" }))) {
        summary.paused = true;
        break;
      }
      const leadDelayMs =
        typeof leadDelayProvider === "function"
          ? leadDelayProvider({ leadIndex })
          : normalizedMeta.dispatchOptions.leadDelaySeconds * 1000;
      await sleep(leadDelayMs);
    }
  }

  summary.failureCount = failedPhones.size;
  summary.completedCampaign = summary.successCount > 0;

  return {
    analyticsMeta: normalizedMeta,
    summary,
  };
}
