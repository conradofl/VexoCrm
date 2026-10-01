import { randomUUID } from "crypto";
import { isFilterShape, normalizeFilters } from "./segmentation.js";
import { applyMessagePlaceholders, findUnresolvedPlaceholders } from "./services/messagePlaceholders.js";
import { validateOutboundMessage } from "./services/jsonExtractor.js";

export { applyMessagePlaceholders, findUnresolvedPlaceholders };

export const DEFAULT_LEAD_DELAY_SECONDS = 2;
export const DEFAULT_STEP_DELAY_SECONDS = 5;
export const DEFAULT_REPLY_TIMEOUT_SECONDS = 60;
export const DEFAULT_REPLY_POLL_INTERVAL_SECONDS = 5;
export const DEFAULT_STEP_TRIGGER_MODE = "immediate";
const DEFAULT_STEP_FAILURE_MODE = true;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
const MAX_REPLY_TIMEOUT_SECONDS = 15 * 60;
const MAX_REPLY_POLL_INTERVAL_SECONDS = 60;
export const MAX_TEXT_VARIANTS = 30;

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
  ).slice(0, MAX_TEXT_VARIANTS);
}

function hashSeed(value) {
  let h = 2166136261;
  const str = String(value);
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates com PRNG semeado: mesma seed, mesma ordem (reproduzivel p/ debug). */
function shuffledOrder(length, seed) {
  const order = Array.from({ length }, (_, i) => i);
  const rand = mulberry32(seed);
  for (let i = length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const swap = order[i];
    order[i] = order[j];
    order[j] = swap;
  }
  return order;
}

function leadVariableIsFilled(name, lead, phone) {
  const key = normalizeString(name).toLowerCase();
  if (!key) return false;
  if (key === "nome" || key === "name" || key === "cliente" || key === "lead_name") {
    // {{nome}} tem fallback seguro para "cliente" e nunca bloqueia
    return true;
  }
  if (key === "telefone" || key === "phone" || key === "celular") {
    return Boolean(normalizeString(phone) || normalizeString(lead?.telefone || lead?.phone));
  }

  const leadDados = lead?.dados && typeof lead?.dados === "object" ? lead.dados : {};
  const customCampos = leadDados.campos && typeof leadDados.campos === "object" ? leadDados.campos : {};

  const customData = {
    ...(lead || {}),
    ...(lead?.normalized_data || {}),
    ...(lead?.normalizedData || {}),
    ...leadDados,
    ...customCampos,
  };
  for (const [dataKey, value] of Object.entries(customData)) {
    if (dataKey.toLowerCase() !== key) continue;
    if (typeof value === "number") return Number.isFinite(value);
    if (typeof value === "string") return value.trim() !== "";
  }
  return false;
}

function variantHasUnfilledVariable(text, lead, phone) {
  const raw = normalizeString(text);
  if (!raw) return false;
  const rendered = applyMessagePlaceholders(raw, lead, phone);
  const unresolved = findUnresolvedPlaceholders(rendered);
  return unresolved.length > 0;
}

/**
 * Escolhe a variacao de texto do passo para este lead.
 *
 * Round-robin embaralhado POR CHIP: a ordem vem de (campanha, chip, ciclo), o
 * indice sequencial e o `sent_count` que a reserva de cota ja devolve. Cada
 * variacao sai uma vez por ciclo (uniforme) sem a sequencia previsivel do
 * round-robin puro, e dois chips na mesma campanha andam em ordens diferentes.
 *
 * Sem chip (pool vazio ou tabela de cota indisponivel) degrada para o
 * round-robin antigo por leadIndex — disparo nao pode parar por causa disto.
 */
export function resolveStepTextForLead(step, leadIndex, chip = null, options = {}) {
  const variants = normalizeTextVariants(step?.textVariants);
  if (variants.length === 0) return normalizeString(step?.text);

  const { lead = null, phone = "", campaignId = "" } = options || {};
  const total = variants.length;
  const sequence = Number.isInteger(chip?.sequence) ? chip.sequence : null;

  let candidates;
  if (sequence === null) {
    candidates = Array.from({ length: total }, (_, i) => (leadIndex + i) % total);
  } else {
    const cycle = Math.floor(sequence / total);
    const position = ((sequence % total) + total) % total;
    const seed = hashSeed(
      `${normalizeString(campaignId)}|${normalizeString(chip?.instanceId)}|${cycle}`
    );
    const order = shuffledOrder(total, seed);
    candidates = Array.from({ length: total }, (_, i) => order[(position + i) % total]);
  }

  // Lead sem a variavel que a variacao usa pula para a proxima que nao dependa
  // dela. Sem isso, toda a base sem nome recebe o mesmo "Ola, cliente!" e a
  // variacao vira constante justamente no segmento maior.
  for (const index of candidates) {
    if (!variantHasUnfilledVariable(variants[index], lead, phone)) return variants[index];
  }
  return variants[candidates[0]];
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
      triggerMode: "immediate",
    });
  }

  return sequence;
}

function normalizeSequenceStep(step, index) {
  const type = normalizeString(step?.type).toLowerCase() === "image" ? "image" : "text";
  const rawTrigger = normalizeString(step?.triggerMode).toLowerCase();
  const triggerMode =
    rawTrigger === "after_reply"
      ? "after_reply"
      : rawTrigger === "with_previous"
      ? "with_previous"
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
    // buttons NAO estava aqui, e por isso o passo com botao saia como sendText.
    // A normalizacao roda em TODO caminho de envio (disparo inicial e
    // continuacao apos resposta), entao o botao era descartado antes de
    // buildStepButtons ter chance de olhar para ele: `step.buttons` chegava
    // undefined e a funcao devolvia null. Nao era disparo congelado nem falta de
    // montagem na continuacao — o campo morria na porta de entrada.
    buttons: normalizeStepButtons(step?.buttons),
  };
}

/**
 * Preserva os botoes do passo. Aceita os dois shapes que a tela ja gravou
 * (`url`/`href` e `label`/`displayText`) sem reescrever nenhum deles —
 * buildStepButtons e quem resolve placeholder e decide o formato final.
 */
function normalizeStepButtons(buttons) {
  if (!Array.isArray(buttons)) return [];
  return buttons
    .filter((btn) => btn && typeof btn === "object")
    .map((btn) => ({
      type: normalizeString(btn.type).toLowerCase() === "url" || btn.url || btn.href ? "url" : "reply",
      label: normalizeString(btn.label || btn.displayText),
      displayText: normalizeString(btn.displayText || btn.label),
      url: normalizeString(btn.url || btn.href),
      value: normalizeString(btn.value),
    }))
    .filter((btn) => btn.label || btn.displayText || btn.url);
}

function normalizeDispatchOptions(rawOptions = {}, sequence = []) {
  // A tela NAO tem controle para dispatchOptions.waitForReply — o default do
  // frontend e `false` fixo (LeadImports.tsx). O usuario expressa a intencao no
  // PASSO, escolhendo "Enviar após resposta do lead" (triggerMode: after_reply).
  // Enquanto isso nao era derivado aqui, a flag ficava false para sempre,
  // shouldUseReplyFlow nunca ligava e o passo 2 jamais era enviado.
  //
  // Deriva da sequencia: passo habilitado com after_reply => o disparo espera
  // resposta. Uma fonte de verdade so — a escolha do passo. Vale tambem para
  // campanhas ja salvas, porque roda na leitura e nao exige reedicao nem migracao.
  //
  // A derivacao SO vale quando a sequencia tem os dois lados: pelo menos um passo
  // imediato E pelo menos um after_reply. E a forma de uma campanha de verdade.
  //
  // Uma sequencia formada SO por after_reply nao e campanha: e a continuacao pos
  // resposta (dispatch.js passa `sequence: remainingSteps` com waitForReply: false
  // de proposito). Derivar true ali reativava o fluxo de espera, e a validacao
  // rejeitava o envio com "precisam de pelo menos um passo imediato" — o passo 2
  // nunca chegava a ser tentado. Regressao introduzida em b935ea7.
  const passos = (Array.isArray(sequence) ? sequence : []).filter((step) => step?.enabled !== false);
  const firstDoorIndex = passos.findIndex((step, index) => index > 0 && step?.triggerMode === "after_reply");
  const temPassoAposResposta = firstDoorIndex !== -1;
  const temPassoImediato = firstDoorIndex === -1 ? passos.length > 0 : firstDoorIndex > 0;
  const derivarDaSequencia = temPassoAposResposta && temPassoImediato;
  const waitForReply = derivarDaSequencia || normalizeBoolean(rawOptions.waitForReply, false);
  const replyTimeoutSeconds = Math.min(
    normalizeNonNegativeInteger(rawOptions.replyTimeoutSeconds, DEFAULT_REPLY_TIMEOUT_SECONDS),
    MAX_REPLY_TIMEOUT_SECONDS
  );
  const replyPollIntervalSeconds = Math.min(
    normalizeNonNegativeInteger(
      rawOptions.replyPollIntervalSeconds,
      DEFAULT_REPLY_POLL_INTERVAL_SECONDS
    ),
    MAX_REPLY_POLL_INTERVAL_SECONDS
  );

  const replyAgent = ["passos", "campanha", "atendimento"].includes(rawOptions.replyAgent)
    ? rawOptions.replyAgent
    : null;

  return {
    ...(replyAgent ? { replyAgent } : {}),
    leadDelaySeconds: normalizeNonNegativeInteger(
      rawOptions.leadDelaySeconds,
      DEFAULT_LEAD_DELAY_SECONDS
    ),
    stopOnStepFailure:
      rawOptions.stopOnStepFailure === undefined
        ? DEFAULT_STEP_FAILURE_MODE
        : normalizeBoolean(rawOptions.stopOnStepFailure, DEFAULT_STEP_FAILURE_MODE),
    aiAssisted: normalizeBoolean(rawOptions.aiAssisted, false),
    evolutionInstanceId: normalizeString(rawOptions.evolutionInstanceId) || null,
    templateStrategy:
      normalizeString(rawOptions.templateStrategy).toLowerCase() === "ai_variations"
        ? "ai_variations"
        : "single",
    templateVariantCount: Math.min(
      normalizeNonNegativeInteger(rawOptions.templateVariantCount, 1),
      MAX_TEXT_VARIANTS
    ),
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
    dispatchOptions: normalizeDispatchOptions(meta.dispatchOptions, sequence),
  };
}

export function getEnabledCampaignSteps(rawMeta = {}) {
  return normalizeCampaignAnalyticsMeta(rawMeta).sequence.filter((step) => step.enabled);
}

export function getCampaignStepPlan(rawMeta = {}) {
  const analyticsMeta = normalizeCampaignAnalyticsMeta(rawMeta);
  const enabledSteps = analyticsMeta.sequence.filter((step) => step.enabled);
  const firstDoorIndex = enabledSteps.findIndex(
    (step, index) => index > 0 && step.triggerMode === "after_reply"
  );
  const immediateSteps =
    firstDoorIndex === -1 ? enabledSteps : enabledSteps.slice(0, firstDoorIndex);
  const replySteps = enabledSteps
    .map((step, index) => ({ step, index }))
    .filter((entry, index) => index > 0 && entry.step.triggerMode === "after_reply");
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
    const firstDoorIndex = enabledSteps.findIndex(
      (step, index) => index > 0 && step.triggerMode === "after_reply"
    );
    const immediateSteps =
      firstDoorIndex === -1 ? enabledSteps : enabledSteps.slice(0, firstDoorIndex);
    const replySteps = enabledSteps.filter((step, index) => index > 0 && step.triggerMode === "after_reply");
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
    // sendButtons REMOVIDO. Botao interativo foi descontinuado pelo WhatsApp para
    // conexoes nao-oficiais (Baileys): a API aceita e envia, e o celular recebe uma
    // mensagem que nao sabe renderizar — chegou como "visualizacao unica" que nao
    // abre, sem texto e sem botao.
    //
    // O pior nao era perder o botao: o texto ia no MESMO payload (txt/text/message,
    // com os links ja anexados por formatStepTextWithButtons) e sumia junto. Passo
    // com botao chegava invisivel, o que por muito tempo pareceu "o passo nao envia".
    //
    // Agora tudo sai por sendText e o link vai no corpo — o WhatsApp torna URL
    // clicavel sozinho.
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

export function formatStepTextWithButtons(baseText, stepButtons, context = {}, phone = "") {
  let text = baseText || "";
  if (!Array.isArray(stepButtons) || stepButtons.length === 0) return text;

  // Caminho UNICO desde a remocao do sendButtons. Botao de URL vira link no corpo,
  // e o WhatsApp o torna clicavel sozinho.
  const urlButtons = stepButtons.filter((b) => b && (b.type === "url" || b.url) && (b.url || b.href));

  // Opcoes de resposta escritas no corpo. O valor do recurso nunca foi o toque no
  // botao: era oferecer caminhos para o lead nao ter que formular a resposta
  // sozinho. Texto entrega isso, e o agente reconhece a escolha (as opcoes entram
  // no roteiro copiado para o disparo).
  //
  // O rotulo (displayText) e o que vai escrito — e o que o dono redigiu para o
  // lead ler. replyText, quando existe, vira contexto do agente, nao texto da
  // mensagem: sao dois campos com papeis diferentes, e nenhum se perde.
  const optionButtons = stepButtons.filter((b) => b && (b.type === "reply" || (b.type !== "url" && !b.url && !b.href)));
  const optionLines = [];
  for (const btn of optionButtons) {
    const rotulo = normalizeString(
      applyMessagePlaceholders(btn.displayText || btn.label || btn.replyText || btn.value, context.lead, phone)
    );
    // Nada e inventado: opcao sem texto escrito nao vira linha.
    if (!rotulo || /\{\{.*?\}\}/.test(rotulo)) continue;
    optionLines.push(`${optionLines.length + 1}. ${rotulo}`);
  }

  if (optionLines.length === 0 && urlButtons.length === 0) return text;

  if (optionLines.length > 0) {
    text = text ? `${text}\n\n${optionLines.join("\n")}` : optionLines.join("\n");
  }

  if (urlButtons.length === 0) return text;

  const appendedLinks = [];
  for (const btn of urlButtons) {
    const rawUrl = btn.url || btn.href || "";
    const resolvedUrl = applyMessagePlaceholders(rawUrl, context.lead, phone);
    // Mesmo criterio de buildStepButtons: placeholder nao resolvido nao vira link.
    if (/\{\{.*?\}\}/.test(resolvedUrl || "")) continue;
    if (resolvedUrl && !text.includes(resolvedUrl)) {
      const label = btn.displayText || btn.label || "Acessar Link";
      appendedLinks.push(`👉 ${label}: ${resolvedUrl}`);
    }
  }

  if (appendedLinks.length > 0) {
    text = text ? `${text}\n\n${appendedLinks.join("\n")}` : appendedLinks.join("\n");
  }

  return text;
}

function buildTextPayload(phone, step, context = {}) {
  const textWithButtons = formatStepTextWithButtons(step.text, step.buttons, context, phone);

  return {
    source: "vexocrm",
    provider: "evolution",
    type: "text",
    stepType: "text",
    stepId: step.id,
    number: phone,
    txt: textWithButtons,
    text: textWithButtons,
    message: textWithButtons,
    title: textWithButtons,
    description: textWithButtons,
    options: {
      delay: 2000,
      presence: "composing",
    },
    // `buttons` NAO vai mais no payload: sem o sendButtons, a Evolution enviaria
    // por sendText e o campo seria ignorado — mandar sugeriria um recurso que nao
    // existe nesta conexao. Os links ja estao no corpo (textWithButtons).
    campaign: context.campaign || null,
    client: context.client || null,
  };
}

function buildImagePayload(phone, step, context = {}) {
  const parsedImage = parseDataUrl(step.image?.dataUrl || "");

  const textWithButtons = formatStepTextWithButtons(step.text || "", step.buttons, context, phone);

  return {
    source: "vexocrm",
    provider: "evolution",
    type: "image",
    stepType: "image",
    stepId: step.id,
    number: phone,
    txt: textWithButtons,
    caption: textWithButtons,
    // Mesmo motivo do payload de texto: sem sendButtons, o campo nao tem consumidor.
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

  const textToValidate = payload?.text || payload?.message || payload?.caption || payload?.txt || "";
  if (textToValidate) {
    const guard = validateOutboundMessage(textToValidate);
    if (!guard.valid) {
      console.error("[campaign-outbound] BLOQUEIO DE SEGURANÇA: Mensagem contém variável não substituída ou formato inválido. Envio cancelado!", {
        phone: maskOutboundPhone(payload?.number),
        motivo: guard.reason,
        stepId: payload?.stepId || null,
        endpointInfo,
        textoCompleto: textToValidate,
        origem: payload?.source || payload?.campaign?.name || "campanha",
      });
      const error = new Error(`[BLOQUEIO_GUARDA_SAIDA] Mensagem bloqueada: ${guard.reason}`);
      error.code = "OUTBOUND_GUARD_BLOCKED";
      error.reason = guard.reason;
      throw error;
    }
  }

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
        responseText.includes("Connection Closed") ||
        responseText.includes("connection closed") ||
        responseText.includes("Session Not Found") ||
        responseText.includes("is not open") ||
        response.status === 409;
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

      const error = new Error(userMessage);
      error.isConnectionClosed = isConnectionClosed;
      error.isUnauthorized = isUnauthorized;
      error.statusCode = response.status;
      error.instanceName = endpointInfo?.instance || null;
      throw error;
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

/**
 * Avalia se um lead deve ser retido preventivamente devido a variáveis ausentes
 * ou violação da guarda de saída em qualquer passo habilitado da sequência.
 *
 * @param {Array} sequence - Passos da campanha
 * @param {Object} lead - Objeto do lead
 * @param {string} [phone] - Telefone do lead
 * @param {Object} [options] - Opções de resolução (leadIndex, campaignId, etc.)
 * @returns {{ held: boolean, reason: string|null, step: Object|null, missingVar: string|null }}
 */
export function evaluateLeadSequenceRetention(sequence, lead, phone = "", options = {}) {
  const steps = Array.isArray(sequence) ? sequence : [];
  const enabledSteps = steps.filter((step) => step && step.enabled !== false && step.is_active !== false && step.active !== false);
  const leadIndex = options.leadIndex || 0;
  const rotationCampaignId = options.campaignId || "";

  for (let sIdx = 0; sIdx < enabledSteps.length; sIdx += 1) {
    const stepToCheck = enabledSteps[sIdx];
    const rawStepText = resolveStepTextForLead(stepToCheck, leadIndex, null, {
      lead,
      phone,
      campaignId: rotationCampaignId,
    });

    if (rawStepText) {
      const resolvedStepText = applyMessagePlaceholders(rawStepText, lead, phone);
      const unresolvedVars = findUnresolvedPlaceholders(resolvedStepText);

      if (unresolvedVars.length > 0) {
        const missingVar = unresolvedVars[0];
        const stepNum = stepToCheck.order || (sIdx + 1);
        return {
          held: true,
          reason: `Variável '${missingVar}' ausente no passo ${stepNum}`,
          step: stepToCheck,
          missingVar,
        };
      }

      const guard = validateOutboundMessage(resolvedStepText);
      if (!guard.valid) {
        const stepNum = stepToCheck.order || (sIdx + 1);
        return {
          held: true,
          reason: `Bloqueio de guarda no passo ${stepNum}: ${guard.reason}`,
          step: stepToCheck,
          missingVar: null,
        };
      }
    }
  }

  return {
    held: false,
    reason: null,
    step: null,
    missingVar: null,
  };
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
  onLeadClaimRollback = null,
  onLeadFailed = null,
  onLeadCheckOptout = null,
}) {
  const normalizedMeta = normalizeCampaignAnalyticsMeta(analyticsMeta);
  const enabledSteps = normalizedMeta.sequence.filter((step) => step.enabled);
  // Entra na seed do embaralhamento: campanhas diferentes no mesmo chip nao
  // repetem a mesma ordem de variacoes.
  const rotationCampaignId = normalizeString(context?.campaign?.id);
  const summary = {
    successCount: 0,
    failureCount: 0,
    successPhones: [],
    failures: [],
    warnings: [],
    completedCampaign: false,
    paused: false,
    chipDisconnected: false,
    disconnectedChipName: null,
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

    if (typeof onLeadCheckOptout === "function") {
      const isOptedOut = await onLeadCheckOptout({ lead, phone, leadIndex });
      if (isOptedOut) {
        summary.failures.push({
          phone,
          stepId: null,
          stepType: null,
          reason: "Lead está na lista de Opt-out.",
        });
        continue;
      }
    }

    // Validação atômica de todas as variáveis da sequência para este lead:
    // Antes de enviar qualquer passo para um lead, resolva os textos de todos os passos
    // da sequência e procure sobra em todos. Encontrou em qualquer um: nenhum passo é
    // enviado para aquele lead, e o motivo diz qual variável e em qual passo.
    const retention = evaluateLeadSequenceRetention(enabledSteps, lead, phone, {
      leadIndex,
      campaignId: rotationCampaignId,
    });

    if (retention.held) {
      failedPhones.add(phone);
      summary.failureCount += 1;
      summary.failures.push({
        phone,
        stepId: retention.step?.id || null,
        stepType: retention.step?.type || null,
        reason: retention.reason,
      });
      if (typeof onLeadFailed === "function") {
        try {
          await onLeadFailed({ lead, phone, reason: retention.reason });
        } catch (callbackError) {
          console.warn("[campaign-outbound] lead_failed_callback_failed", {
            phone: maskOutboundPhone(phone),
            reason: callbackError instanceof Error ? callbackError.message : String(callbackError),
          });
        }
      }
      continue;
    }

    let leadWebhookUrl = webhookUrl;
    let leadWebhookToken = webhookToken;
    let activeChip = null;
    if (typeof chipProvider === "function") {
      activeChip = await chipProvider({ leadIndex });
      if (!activeChip || activeChip.exhausted) {
        summary.allChipsExhausted = true;
        summary.exhaustedChipName = activeChip?.chipName || null;
        summary.limitQuota = activeChip?.limitQuota || null;
        summary.usedQuota = activeChip?.usedQuota || null;
        summary.exhaustedQuotaMessage = activeChip?.exhaustedQuotaMessage || null;
        summary.paused = true;
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
      const step = enabledSteps[stepIndex];

      // Se for um passo 'after_reply' e NÃO estiver em disparo pós-resposta ativo, interrompe a rajada inicial neste lead!
      if (stepIndex > 0 && step.triggerMode === "after_reply" && !context?.isReplyTrigger) {
        break;
      }

      if (
        typeof shouldContinue === "function" &&
        !(await shouldContinue({ leadIndex, stepIndex, phase: "step" }))
      ) {
        summary.paused = true;
        break;
      }

      const stepForPayload = {
        ...step,
        text: applyMessagePlaceholders(
          resolveStepTextForLead(step, leadIndex, activeChip, {
            lead,
            phone,
            campaignId: rotationCampaignId,
          }),
          lead,
          phone
        ),
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
              step: stepForPayload,
              stepIndex,
              totalSteps: enabledSteps.length,
              sentAt,
              hasNextStep: stepIndex < enabledSteps.length - 1,
              instanceName: activeChip?.instanceId || activeChip?.instanceName || context?.instanceName || null,
              activeChip,
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
        const isConnectionClosed = Boolean(
          error?.isConnectionClosed ||
          error?.code === "EVOLUTION_INSTANCE_NOT_OPEN" ||
          error?.message?.includes("Connection Closed") ||
          error?.message?.includes("connection closed") ||
          error?.message?.includes("desconectada na Evolution")
        );

        if (isConnectionClosed) {
          summary.chipDisconnected = true;
          summary.disconnectedChipName = error.instanceName || activeChip?.instanceName || activeChip?.name || null;
          summary.paused = true;
          leadFailed = true;

          console.warn("[campaign-outbound] Chip WhatsApp desconectado detectado. Abortando lote imediatamente para não queimar leads.", {
            phone: maskOutboundPhone(phone),
            chip: summary.disconnectedChipName,
            error: error.message,
          });

          // Rollback do claim para que este lead NÃO fique marcado como 'failed' e volte a 'não processado'
          if (typeof onLeadClaimRollback === "function") {
            try {
              await onLeadClaimRollback({ lead, phone, leadIndex, reason: "chip_disconnected" });
            } catch {
              /* rollback best-effort */
            }
          }
          if (activeChip && typeof activeChip.release === "function") {
            try {
              await activeChip.release();
            } catch {
              /* devolução de cota best-effort */
            }
          }
          break;
        }

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
        const nextStep = enabledSteps[stepIndex + 1];
        const isWithPrevious = nextStep?.triggerMode === "with_previous";
        const explicitDelay = normalizeNonNegativeInteger(step.delayAfterSeconds, 0);

        let stepDelaySeconds;
        if (explicitDelay > 0) {
          stepDelaySeconds = Math.max(explicitDelay, 2);
        } else if (isWithPrevious) {
          // Passos 'with_previous' (junto com a anterior): intervalo curto e natural de 2 a 5s para evitar burst e sinal de spam
          stepDelaySeconds = 2 + Math.floor(Math.random() * 4);
        } else {
          stepDelaySeconds = Math.max(
            normalizeNonNegativeInteger(DEFAULT_STEP_DELAY_SECONDS, 2),
            2
          );
        }
        await sleep(stepDelaySeconds * 1000);
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
