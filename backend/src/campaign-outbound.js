import { randomUUID } from "crypto";

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

/**
 * Replace per-lead placeholders in outbound copy (Evolution text/caption).
 * Supports {{nome}} and {{telefone}} with optional spaces inside braces (case-insensitive tokens).
 */
function applyMessagePlaceholders(text, lead, phone) {
  const raw = normalizeString(text);
  if (!raw) return raw;
  const nome = normalizeString(lead?.nome) || "cliente";
  const tel = normalizeString(phone) || normalizeString(lead?.telefone || lead?.phone);
  return raw
    .replace(/\{\{\s*nome\s*\}\}/gi, nome)
    .replace(/\{\{\s*telefone\s*\}\}/gi, tel || "");
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
    waitForReply,
    replyTimeoutSeconds,
    replyPollIntervalSeconds,
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

  return {
    ...meta,
    segmentation:
      meta.segmentation && typeof meta.segmentation === "object" ? meta.segmentation : {},
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
    if (step.type === "text" && !step.text) {
      return {
        valid: false,
        analyticsMeta,
        message: `O passo ${step.order} precisa de texto para envio.`,
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

function resolveStepWebhookUrl(webhookUrl, payload) {
  if (payload?.type === "image" && typeof webhookUrl === "string") {
    return webhookUrl.replace("/message/sendText/", "/message/sendMedia/");
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
    campaign: context.campaign || null,
    client: context.client || null,
  };
}

function buildImagePayload(phone, step, context = {}) {
  const parsedImage = parseDataUrl(step.image?.dataUrl || "");

  return {
    source: "vexocrm",
    provider: "evolution",
    type: "image",
    stepType: "image",
    stepId: step.id,
    number: phone,
    txt: step.text || "",
    caption: step.text || "",
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

  try {
    console.info("[campaign-outbound] whatsapp_step_request", {
      type: payload?.type || null,
      stepId: payload?.stepId || null,
      phone: maskOutboundPhone(payload?.number),
      endpointMode: payload?.type === "image" ? "media" : "text",
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
  };
  const failedPhones = new Set();

  for (let leadIndex = 0; leadIndex < leads.length; leadIndex += 1) {
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

    let leadFailed = false;
    let lastSuccessfulStep = null;
    let lastSuccessfulStepIndex = null;
    let lastSentAt = null;

    for (let stepIndex = 0; stepIndex < enabledSteps.length; stepIndex += 1) {
      const step = enabledSteps[stepIndex];
      const stepForPayload = {
        ...step,
        text: applyMessagePlaceholders(step.text, lead, phone),
      };
      const extendedContext = {
        ...context,
        lead: {
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
        await postEvolutionPayload(webhookUrl, webhookToken, payload);
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
        summary.failures.push({
          phone,
          stepId: step.id,
          stepType: step.type,
          reason:
            error?.name === "AbortError"
              ? "Timeout ao chamar a integracao Evolution."
              : error instanceof Error
                ? error.message
                : "Falha ao chamar a integracao Evolution.",
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

    if (!leadFailed) {
      summary.successCount += 1;
      summary.successPhones.push(phone);

      if (typeof onLeadDispatched === "function") {
        await onLeadDispatched({
          lead,
          phone,
          sentAt: lastSentAt,
          lastStep: lastSuccessfulStep,
          lastStepIndex: lastSuccessfulStepIndex,
          totalSteps: enabledSteps.length,
        });
      }
    }

    const hasNextLead = leadIndex < leads.length - 1;
    if (hasNextLead) {
      await sleep(normalizedMeta.dispatchOptions.leadDelaySeconds * 1000);
    }
  }

  summary.failureCount = failedPhones.size;
  summary.completedCampaign = summary.successCount > 0;

  return {
    analyticsMeta: normalizedMeta,
    summary,
  };
}
