import {
  resolveGroqLadder,
  groqModelLadder,
  defaultGroqModel,
  classifyLlmHttpError,
  mensagemDeCotaEstourada,
  filterLadderOnQuotaExceeded,
  isHighQuotaModel,
} from "./services/llmModels.js";
import {
  normalizeLeadsOutlierDados,
  parseStoredHistorico,
  serializeHistorico,
} from "./leads-outlier-schema.js";
import { getLeadClientN8nSettings } from "./services/n8nSettings.js";
import { qualifyLead } from "./hardcoded-chatbot-persistence.js";
import { LEADS_OUTLIER_TEMPERATURE } from "./services/leadImport.js";
import { resolveMessageId, isGroupJid, isFromMe } from "./services/inboundGuard.js";
import { extractJsonFromLlmText, validateOutboundMessage, stripReasoningBlocks } from "./services/jsonExtractor.js";
import { maskPhoneForLog } from "./services/tenant.js";
import { resolveEvolutionInstanceOwner, fetchMediaBase64FromEvolution } from "./services/evolution.js";
import { saveMediaBuffer } from "./services/storage.js";

/**
 * Chatbot AI Engine
 * Buffer de mensagens + transcrição de mídia + IA conversacional (Groq)
 * Modelo base para todos os tenants — cada empresa tem seu próprio system prompt
 */

// ─── Buffer in-memory ──────────────────────────────────────────────────────
// Map: `${clientId}:${phone}` → { messages: [], timer, token }
const messageBuffers = new Map();
const BUFFER_DELAY_MS = 3000;

// ─── Configuração de Provedores e Modelos de LLM ────────────────────────────
export const LLM_MODELS = [
  // Groq — lista real da conta, conferida em /openai/v1/models em 24/08/2026.
  // Os dois Llama sairam: a Groq descontinuou os dois e as chamadas voltavam 404.
  // Ficavam selecionaveis na tela do tenant e derrubavam o agente em producao.
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B (Groq)", provider: "groq", providerName: "Groq" },
  { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B (Groq)", provider: "groq", providerName: "Groq" },
  { id: "qwen/qwen3.6-27b", name: "Qwen 3.6 27B", provider: "groq", providerName: "Groq" },
  // 70.000 TPM contra 8.000 dos de cima — a folga real quando a cota aperta.
  { id: "groq/compound", name: "Groq Compound (cota alta)", provider: "groq", providerName: "Groq" },
  { id: "groq/compound-mini", name: "Groq Compound Mini (cota alta)", provider: "groq", providerName: "Groq" },

  // ChatGPT / OpenAI
  { id: "gpt-4o", name: "GPT-4o (Omni)", provider: "openai", providerName: "ChatGPT / OpenAI" },
  { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai", providerName: "ChatGPT / OpenAI" },
  { id: "gpt-4-turbo", name: "GPT-4 Turbo", provider: "openai", providerName: "ChatGPT / OpenAI" },
  { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", provider: "openai", providerName: "ChatGPT / OpenAI" },

  // Claude / Anthropic
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", provider: "anthropic", providerName: "Claude / Anthropic" },
  { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", provider: "anthropic", providerName: "Claude / Anthropic" },
  { id: "claude-3-opus-20240229", name: "Claude 3 Opus", provider: "anthropic", providerName: "Claude / Anthropic" },

  // Gemini / Google
  { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "gemini", providerName: "Gemini / Google" },
  { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", provider: "gemini", providerName: "Gemini / Google" },
  { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", provider: "gemini", providerName: "Gemini / Google" },
];

export function getLlmProviderStatus() {
  return {
    groq: Boolean(process.env.GROQ_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
  };
}

// Vem da escada configuravel, nao de um nome fixo que a Groq pode aposentar.
export const DEFAULT_LLM_MODEL = defaultGroqModel();

// Modelo salvo pode ter sido descontinuado pelo provedor depois de escolhido.
// Sem isso a chamada seguia com um id morto e falhava no provedor, sem pista.
export function resolveLlmModel(modelId) {
  const normalized = typeof modelId === "string" ? modelId.trim() : "";
  const defaultModel = defaultGroqModel();
  if (normalized && LLM_MODELS.some((m) => m.id === normalized)) return normalized;
  if (normalized) {
    console.warn(`[chatbot-ai] modelo "${normalized}" nao esta disponivel; usando ${defaultModel}.`);
  } else {
    console.log(`[chatbot-ai] tenant sem modelo LLM configurado — usando modelo padrão da escada: ${defaultModel}`);
  }
  return defaultModel;
}

export function detectLlmProvider(modelId) {
  const found = LLM_MODELS.find((m) => m.id === modelId);
  if (found) return found.provider;
  if (modelId?.startsWith("gpt-")) return "openai";
  if (modelId?.startsWith("claude-")) return "anthropic";
  if (modelId?.startsWith("gemini-")) return "gemini";
  return "groq";
}

const GROQ_BASE = "https://api.groq.com/openai/v1";
// Modelo de visao (leitura de imagem recebida no WhatsApp). Configuravel por env
// porque a Groq troca esses modelos com frequencia: llama-3.2-11b-vision-preview,
// que estava fixo aqui, foi descontinuado e o caminho de imagem falhava sem
// nenhum aviso ao usuario.
const GROQ_VISION_MODEL =
  process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";

function groqKey() {
  return process.env.GROQ_API_KEY || "";
}

export async function callLlmChatCompletion({
  model = defaultGroqModel(),
  messages = [],
  temperature = 0.4,
  max_tokens = 600,
  response_format = null,
  singleModelOnly = false,
}) {
  const chosenModel = model || defaultGroqModel();
  const provider = detectLlmProvider(chosenModel);

  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY não configurada no servidor (Easypanel)");
    const body = { model: chosenModel, messages, temperature, max_tokens };
    if (response_format) body.response_format = response_format;
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI HTTP ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY não configurada no servidor (Easypanel)");
    const systemMsg = messages.find((m) => m.role === "system")?.content || "";
    const anthropicMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
    const body = {
      model: chosenModel,
      system: systemMsg,
      messages: anthropicMessages,
      max_tokens,
      temperature,
    };
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Anthropic HTTP ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.content?.[0]?.text || "";
  }

  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY não configurada no servidor (Easypanel)");
    const body = { model: chosenModel, messages, temperature, max_tokens };
    if (response_format) body.response_format = response_format;
    const res = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini HTTP ${res.status}: ${err.slice(0, 200)}`);
    }
    const data = await res.json();
    return data.choices?.[0]?.message?.content || "";
  }

  // Default: Groq
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    // Se não tiver chave da Groq, tenta OpenAI ou Gemini se existirem
    if (process.env.OPENAI_API_KEY) {
      return callLlmChatCompletion({ model: "gpt-4o-mini", messages, temperature, max_tokens, response_format });
    }
    if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
      return callLlmChatCompletion({ model: "gemini-2.0-flash", messages, temperature, max_tokens, response_format });
    }
    throw new Error("GROQ_API_KEY não configurada no servidor (Easypanel)");
  }

  // Escada vinda de services/llmModels.js — configuravel por GROQ_MODEL_LADDER e
  // com os modelos descontinuados descartados antes de gastar uma chamada neles.
  let modelsToTry = singleModelOnly ? [chosenModel] : resolveGroqLadder(model);
  let lastError = null;
  let ultimaCota = null;

  // Escada vazia significa que TODOS os modelos configurados estao na lista de
  // descontinuados. Sem esta guarda o laco nao roda, lastError fica null e a
  // funcao devolveria undefined — silencio, que e o pior desfecho possivel aqui.
  if (modelsToTry.length === 0) {
    throw new Error(
      "Nenhum modelo Groq utilizavel: todos os configurados foram descontinuados. " +
        `Ajuste GROQ_MODEL_LADDER (atual: "${groqModelLadder().join(", ")}").`
    );
  }

  let cursor = 0;
  while (cursor < modelsToTry.length) {
    const m = modelsToTry[cursor];
    cursor++;

    const body = { model: m, messages, temperature, max_tokens };
    if (response_format) body.response_format = response_format;
    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });

    if (res.ok) {
      const data = await res.json();
      return data.choices?.[0]?.message?.content || "";
    }

    const err = await res.text();
    lastError = new Error(`Groq HTTP ${res.status}: ${err.slice(0, 200)}`);

    // 404 (modelo morto) e 429 (cota estourada) sao problemas diferentes e sairam
    // do mesmo jeito no log durante toda a investigacao: "indisponivel ou limite
    // de taxa". Um se resolve trocando a lista, o outro pagando plano ou
    // espalhando a carga. Agora cada um diz o que e.
    const diagnostico = classifyLlmHttpError(res.status, err);

    if (diagnostico.tipo === "COTA_ESTOURADA") {
      ultimaCota = { modelo: m, ...diagnostico };
      console.warn(
        `[chatbot-ai-engine] COTA ESTOURADA no modelo "${m}" (HTTP ${res.status})` +
          `${diagnostico.limiteTpm ? ` — teto ${diagnostico.limiteTpm} TPM, usados ${diagnostico.usadoTpm ?? "?"}` : ""}` +
          `${diagnostico.esperarSegundos ? `, libera em ~${diagnostico.esperarSegundos}s` : ""}.` +
          (!isHighQuotaModel(m)
            ? " Pulando modelos do mesmo pool (8.000 TPM) e escalando direto para modelo de alta cota."
            : " Tentando próximo modelo de alta cota.")
      );

      // Quando a cota de 8.000 TPM estoura, descarta os demais modelos de 8.000 TPM
      // e pula direto para modelos de alta cota (>= 70.000 TPM)
      if (!isHighQuotaModel(m)) {
        const remaining = filterLadderOnQuotaExceeded(m, modelsToTry.slice(cursor));
        modelsToTry = [...modelsToTry.slice(0, cursor), ...remaining];
      }
      continue;
    }

    if (diagnostico.tipo === "MODELO_INEXISTENTE") {
      console.error(
        `[chatbot-ai-engine] MODELO INEXISTENTE: "${m}" (HTTP ${res.status}). ` +
          `A Groq descontinuou este modelo. Atualize GROQ_MODEL_LADDER ou o modelo do tenant — ` +
          `enquanto ele estiver na lista, toda chamada perde uma ida de rede aqui.`
      );
      continue;
    }

    if (diagnostico.tipo === "CONTRATO_JSON" && response_format) {
      console.warn(`[chatbot-ai-engine] Groq recusou response_format estrito no modelo "${m}". Reexecutando em modo de texto com extração de JSON resiliente...`);
      return callLlmChatCompletion({
        model: m,
        messages,
        temperature,
        max_tokens,
        response_format: null,
      });
    }

    if (diagnostico.tentarProximo) {
      console.warn(`[chatbot-ai-engine] Groq recusou o modelo "${m}" (HTTP ${res.status}, ${diagnostico.tipo}). Tentando o proximo.`);
      continue;
    }

    // Credencial invalida, etc: trocar de modelo nao resolve.
    throw lastError;
  }

  // Todos os modelos da escada estouraram a cota: o erro final precisa dizer
  // "sua cota de IA acabou", nao um generico. E informacao de negocio — o dono
  // decide se esta na hora de subir o plano.
  if (ultimaCota) {
    const erroDeCota = new Error(mensagemDeCotaEstourada(ultimaCota));
    erroDeCota.code = "LLM_QUOTA_EXCEEDED";
    erroDeCota.modelo = ultimaCota.modelo;
    erroDeCota.limiteTpm = ultimaCota.limiteTpm ?? null;
    erroDeCota.usadoTpm = ultimaCota.usadoTpm ?? null;
    erroDeCota.esperarSegundos = ultimaCota.esperarSegundos ?? null;
    lastError = erroDeCota;
  }

  // Fallback cruzado se todos os modelos da Groq falharem
  if (process.env.OPENAI_API_KEY) {
    console.warn("[chatbot-ai-engine] Tentando fallback para OpenAI (gpt-4o-mini)...");
    return callLlmChatCompletion({ model: "gpt-4o-mini", messages, temperature, max_tokens, response_format });
  }
  if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    console.warn("[chatbot-ai-engine] Tentando fallback para Gemini (gemini-2.0-flash)...");
    return callLlmChatCompletion({ model: "gemini-2.0-flash", messages, temperature, max_tokens, response_format });
  }

  throw lastError || new Error("Falha ao consultar a Groq com os modelos disponíveis");
}


// ─── Campos individuais — fallback quando não há template ───────────────────
const COMMON_INDIVIDUAL_FIELDS = ["interesse", "objetivo", "prazo", "melhor_horario", "nome", "cidade", "estado"];
// Campos individuais conhecidos — usados como fallback quando template não está disponível.
// Novos clientes devem configurar data_fields no template para ter colunas próprias.
const TYPE_SPECIFIC_FIELDS = {};
const KNOWN_DB_COLUMNS = new Set([
  ...COMMON_INDIVIDUAL_FIELDS,
  ...Object.values(TYPE_SPECIFIC_FIELDS).flat(),
]);

// Regex para validar nomes de colunas antes de qualquer SQL dinâmico
const SAFE_IDENT = /^[a-z_][a-z0-9_]{0,62}$/;

// ─── Cache de colunas por tabela (vive enquanto o processo está ativo) ───────
const templateColumnCache = new Map();

/**
 * Garante que todas as colunas do template existam na tabela de leads.
 * Usa ALTER TABLE ... ADD COLUMN IF NOT EXISTS para cada campo ausente.
 * Cacheia o resultado em memória para não repetir queries a cada mensagem.
 */
async function ensureTemplateColumns(supabase, leadsTable, templateFields) {
  if (!supabase?.query || !leadsTable || !Array.isArray(templateFields) || !templateFields.length) return;

  const fields = templateFields.map((f) => f.key).filter((k) => k && SAFE_IDENT.test(k));
  if (!fields.length) return;

  // Carrega colunas existentes na primeira vez para esta tabela
  if (!templateColumnCache.has(leadsTable)) {
    const { rows } = await supabase.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
      [leadsTable]
    );
    templateColumnCache.set(leadsTable, new Set(rows.map((r) => r.column_name)));
  }

  const existing = templateColumnCache.get(leadsTable);
  const missing = fields.filter((f) => !existing.has(f));
  if (!missing.length) return;

  for (const col of missing) {
    const { error } = await supabase.query(
      `ALTER TABLE public."${leadsTable}" ADD COLUMN IF NOT EXISTS "${col}" TEXT`
    );
    if (error) {
      console.warn(`[chatbot-ai] Failed to add column ${col} to ${leadsTable}:`, error.message);
    } else {
      existing.add(col);
      console.log(`[chatbot-ai] Added column "${col}" to ${leadsTable}`);
    }
  }
}

/**
 * Extrai campos de `dados` para colunas individuais.
 * Se templateFields fornecido (e colunas garantidas por ensureTemplateColumns),
 * usa todos os campos do template. Caso contrário usa KNOWN_DB_COLUMNS como fallback.
 */
function extractIndividualColumns(dados, templateFields = null) {
  const result = {};

  const fields =
    templateFields && templateFields.length > 0
      ? templateFields.map((f) => f.key).filter((k) => k && SAFE_IDENT.test(k))
      : [...KNOWN_DB_COLUMNS];

  for (const field of fields) {
    if (dados[field] != null && dados[field] !== "") {
      result[field] = dados[field];
    }
  }
  return result;
}

// ─── Modelos registrados ─────────────────────────────────────────────────────
// systemPrompts removidos — carregados exclusivamente via fetchDynamicPrompt (tabela chatbot_prompts).
export function getChatbotModel(modelKey) {
  return modelKey ? { name: modelKey } : null;
}

// ─── Buffer de mensagens ─────────────────────────────────────────────────────

// ─── Roteamento de campanha ──────────────────────────────────────────────────

/**
 * Verifica se esta é a primeira reply de campanha do lead e marca atomicamente.
 * Lê normalized_data, checa campaign_progress[campaignId].first_campaign_reply_handled,
 * e faz UPDATE se ainda não marcado. Janela de corrida mínima na prática.
 * Retorna { isFirst: true } na primeira execução, { isFirst: false } nas seguintes.
 */
export async function isFirstCampaignReply({ itemId, campaignId, supabase }) {
  if (!itemId || !campaignId || !supabase) return { isFirst: false };

  const { data: item, error } = await supabase
    .from("lead_import_items")
    .select("id, normalized_data")
    .eq("id", itemId)
    .maybeSingle();

  if (error || !item) {
    console.warn("[campaign-routing] isFirstCampaignReply fetch failed", { itemId, error: error?.message });
    return { isFirst: false };
  }

  const normalizedData =
    item.normalized_data && typeof item.normalized_data === "object" ? item.normalized_data : {};
  const campaignProgress =
    normalizedData.campaign_progress && typeof normalizedData.campaign_progress === "object"
      ? normalizedData.campaign_progress
      : {};
  const progress =
    campaignProgress[campaignId] && typeof campaignProgress[campaignId] === "object"
      ? campaignProgress[campaignId]
      : {};

  if (progress.first_campaign_reply_handled === true) {
    return { isFirst: false };
  }

  const updatedProgress = {
    ...campaignProgress,
    [campaignId]: { ...progress, first_campaign_reply_handled: true },
  };
  const updatedNormalizedData = { ...normalizedData, campaign_progress: updatedProgress };

  const { error: updateError } = await supabase
    .from("lead_import_items")
    .update({ normalized_data: updatedNormalizedData })
    .eq("id", itemId);

  if (updateError) {
    console.warn("[campaign-routing] isFirstCampaignReply update failed", {
      itemId,
      error: updateError.message,
    });
    return { isFirst: false };
  }

  return { isFirst: true };
}

/**
 * Adiciona mensagem ao buffer e agenda processamento após BUFFER_DELAY_MS.
 * Se chegar nova mensagem antes do timer, o timer anterior é cancelado.
 * Retorna uma Promise que resolve quando o buffer for processado (ou null se descartado).
 */
export function bufferMessage(clientId, phone, messageData, onProcess) {
  const key = `${clientId}:${phone}`;
  const existing = messageBuffers.get(key) || { messages: [], timer: null, token: 0 };

  if (existing.timer) clearTimeout(existing.timer);

  existing.messages.push(messageData);
  existing.token++;
  const currentToken = existing.token;

  existing.timer = setTimeout(async () => {
    const current = messageBuffers.get(key);
    if (!current || current.token !== currentToken) return; // mensagem mais nova chegou

    const messages = [...current.messages];
    messageBuffers.delete(key);

    try {
      await onProcess(messages);
    } catch (err) {
      console.error("[chatbot-buffer] Process error:", err.message);
    }
  }, BUFFER_DELAY_MS);

  messageBuffers.set(key, existing);
}

// ─── Detecção e extração de mídia ────────────────────────────────────────────

export function detectMessageType(evolutionBody) {
  const msg = evolutionBody?.data?.message || evolutionBody?.message || {};

  if (msg.audioMessage || msg.pttMessage) return "audio";
  if (msg.imageMessage) return "image";
  if (msg.videoMessage) return "video";
  if (msg.documentMessage) return "document";
  if (msg.stickerMessage) return "sticker";
  if (msg.reactionMessage) return "reaction";
  if (msg.conversation || msg.extendedTextMessage) return "text";

  // fallback: se tem texto no body diretamente
  const directText = evolutionBody?.message || evolutionBody?.text || evolutionBody?.body;
  if (directText) return "text";

  return "unknown";
}

export function extractTextFromBody(evolutionBody) {
  const msg = evolutionBody?.data?.message || evolutionBody?.message || {};
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    evolutionBody?.message ||
    evolutionBody?.text ||
    evolutionBody?.body ||
    null
  );
}

export function extractMediaBase64(evolutionBody) {
  const msg = evolutionBody?.data?.message || {};
  return (
    msg.audioMessage?.base64 ||
    msg.pttMessage?.base64 ||
    msg.imageMessage?.base64 ||
    msg.stickerMessage?.base64 ||
    null
  );
}

export function extractMediaMimetype(evolutionBody) {
  const msg = evolutionBody?.data?.message || {};
  return (
    msg.audioMessage?.mimetype ||
    msg.pttMessage?.mimetype ||
    msg.imageMessage?.mimetype ||
    msg.stickerMessage?.mimetype ||
    (msg.stickerMessage ? "image/webp" : null) ||
    null
  );
}

// ─── Transcrição de áudio via Groq Whisper ───────────────────────────────────

export const AUDIO_TRANSCRIPTION_TIMEOUT_MS = Number(process.env.AUDIO_TRANSCRIPTION_TIMEOUT_MS || 8000);

export async function transcribeAudio(base64Data, mimetype = "audio/ogg") {
  if (!groqKey()) {
    console.warn("[chatbot-ai] GROQ_API_KEY not set, cannot transcribe audio");
    return null;
  }

  const startMs = Date.now();
  try {
    const ext = mimetype.includes("ogg") ? "ogg" : mimetype.includes("mp4") ? "mp4" : mimetype.includes("mpeg") ? "mp3" : "ogg";
    const buffer = Buffer.from(base64Data, "base64");
    const blob = new Blob([buffer], { type: mimetype });

    const formData = new FormData();
    formData.append("file", blob, `audio.${ext}`);
    formData.append("model", GROQ_WHISPER_MODEL);
    formData.append("language", "pt");
    formData.append("response_format", "json");

    const res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey()}` },
      body: formData,
      signal: AbortSignal.timeout(AUDIO_TRANSCRIPTION_TIMEOUT_MS),
    });

    const durationMs = Date.now() - startMs;

    if (!res.ok) {
      const err = await res.text();
      console.error(`[chatbot-ai] Whisper error (${durationMs}ms):`, err.slice(0, 200));
      return null;
    }

    const data = await res.json();
    const text = data.text || null;
    if (text) {
      console.log(`[chatbot-ai] Audio transcribed in ${durationMs}ms:`, text.slice(0, 80));
    }
    return text;
  } catch (err) {
    const durationMs = Date.now() - startMs;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      console.warn(
        `[chatbot-ai] Transcrição de áudio atingiu timeout (${durationMs}ms > ${AUDIO_TRANSCRIPTION_TIMEOUT_MS}ms) — fallback para [áudio]`
      );
    } else {
      console.error(`[chatbot-ai] transcribeAudio error (${durationMs}ms):`, err.message);
    }
    return null;
  }
}

// ─── Descrição de imagem via Groq Vision ─────────────────────────────────────

export const IMAGE_DESCRIPTION_TIMEOUT_MS = Number(process.env.IMAGE_DESCRIPTION_TIMEOUT_MS || 10000);

export async function describeImage(base64Data, mimetype = "image/jpeg", caption = "") {
  if (!groqKey()) return null;

  const startMs = Date.now();
  try {
    const dataUrl = `data:${mimetype};base64,${base64Data}`;
    const userContent = [
      {
        type: "image_url",
        image_url: { url: dataUrl },
      },
      {
        type: "text",
        text: caption
          ? `O lead enviou esta imagem com a legenda: "${caption}". Descreva brevemente o que está na imagem para contexto de uma conversa de vendas.`
          : "O lead enviou esta imagem. Descreva brevemente o que está na imagem para contexto de uma conversa de vendas.",
      },
    ];

    const res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey()}`,
      },
      body: JSON.stringify({
        model: GROQ_VISION_MODEL,
        messages: [{ role: "user", content: userContent }],
        max_tokens: 200,
      }),
      signal: AbortSignal.timeout(IMAGE_DESCRIPTION_TIMEOUT_MS),
    });

    const durationMs = Date.now() - startMs;

    if (!res.ok) {
      const detalhe = await res.text().catch(() => "");
      console.error(
        `[chatbot-ai] Vision error ${res.status} (${durationMs}ms, modelo "${GROQ_VISION_MODEL}"):`,
        detalhe.slice(0, 300)
      );
      return null;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || null;
    if (content) {
      console.log(`[chatbot-ai] Image described in ${durationMs}ms:`, content.slice(0, 80));
    }
    return content;
  } catch (err) {
    const durationMs = Date.now() - startMs;
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      console.warn(
        `[chatbot-ai] Descrição de imagem atingiu timeout (${durationMs}ms > ${IMAGE_DESCRIPTION_TIMEOUT_MS}ms) — fallback para legenda/imagem`
      );
    } else {
      console.error(`[chatbot-ai] describeImage error (${durationMs}ms):`, err.message);
    }
    return null;
  }
}

// ─── Processamento de mensagem recebida (tipo + conteúdo) ────────────────────

export async function resolveMessageContent(evolutionBody, options = {}) {
  const {
    clientId = null,
    instanceName = null,
    pgDatabasePool = null,
    fromMe: forcedFromMe = null,
    isGroup: forcedIsGroup = null,
  } = options;

  const type = detectMessageType(evolutionBody);
  const caption = evolutionBody?.data?.message?.imageMessage?.caption || "";
  const waMessageId = resolveMessageId(evolutionBody) || null;

  const rawTs = evolutionBody?.data?.messageTimestamp ?? evolutionBody?.messageTimestamp ?? null;
  let messageTimestamp = null;
  if (rawTs) {
    const num = Number(rawTs);
    if (!Number.isNaN(num) && num > 0) {
      const ms = num < 10000000000 ? num * 1000 : num;
      messageTimestamp = new Date(ms).toISOString();
    } else if (typeof rawTs === "string") {
      const parsed = new Date(rawTs);
      if (!Number.isNaN(parsed.getTime())) {
        messageTimestamp = parsed.toISOString();
      }
    }
  }

  if (type === "text") {
    return { type, text: extractTextFromBody(evolutionBody) || "", waMessageId, messageTimestamp };
  }

  // Se for grupo ou outbound (fromMe), descarta antes de puxar: evita custos e banda desnecessários
  const rawRemoteJid = evolutionBody?.data?.key?.remoteJid ?? evolutionBody?.remoteJid ?? evolutionBody?.senderJid ?? evolutionBody?.data?.key?.participant ?? null;
  const isGroup = forcedIsGroup !== null ? Boolean(forcedIsGroup) : isGroupJid(rawRemoteJid);
  const fromMe = forcedFromMe !== null ? Boolean(forcedFromMe) : isFromMe(evolutionBody);

  // Decisão de produto (Conrado): figurinha fica fora do storage por decisão explícita de produto, e não por esquecimento (mediaPath: null intencional).
  if (type === "sticker") return { type, text: "[sticker]", waMessageId, messageTimestamp, mediaPath: null };
  if (type === "reaction") return { type, text: "[reação]", waMessageId, messageTimestamp };
  if (type === "video") return { type, text: caption ? `[vídeo] ${caption}` : "[vídeo]", waMessageId, messageTimestamp };
  if (type === "document") {
    const name = evolutionBody?.data?.message?.documentMessage?.fileName || "documento";
    return { type, text: `[documento: ${name}]`, waMessageId, messageTimestamp };
  }

  // Mídia elegível para transcrição/descrição: áudio e imagem
  const isEligibleForPull = (type === "audio" || type === "image") && !isGroup && !fromMe;

  let mediaBase64 = extractMediaBase64(evolutionBody);
  let mimetype = extractMediaMimetype(evolutionBody);

  // Pull sob demanda na Evolution API SOMENTE após todos os filtros passarem
  if (!mediaBase64 && instanceName && isEligibleForPull) {
    const rawData = evolutionBody?.data || evolutionBody?.message || evolutionBody;
    try {
      const pulled = await fetchMediaBase64FromEvolution(instanceName, rawData);
      if (pulled?.base64) {
        mediaBase64 = pulled.base64;
        if (!mimetype) mimetype = pulled.mimetype;
      }
    } catch (pullErr) {
      console.warn(`[chatbot-ai] Falha ao puxar mídia sob demanda da Evolution (${instanceName}):`, pullErr?.message || pullErr);
    }
  }

  let mediaPath = null;
  // Upload ao Cloudflare R2 de forma assíncrona (não-bloqueante) apenas para inbound válido
  if (mediaBase64 && clientId && waMessageId && isEligibleForPull) {
    const buffer = Buffer.from(mediaBase64, "base64");
    saveMediaBuffer({ clientId, waMessageId, buffer, mimetype, mediaType: type, messageTimestamp })
      .then((saveRes) => {
        if (saveRes?.mediaPath) {
          mediaPath = saveRes.mediaPath;
          if (pgDatabasePool) {
            pgDatabasePool.query(
              "UPDATE public.lead_messages SET media_path = $1 WHERE client_id = $2 AND wa_message_id = $3",
              [saveRes.mediaPath, clientId, waMessageId]
            ).catch(() => {});
          }
        }
      })
      .catch((err) => {
        console.warn("[chatbot-ai] Falha assíncrona ao salvar mídia no R2:", err?.message || err);
      });
  }

  if (type === "audio") {
    const effectiveMime = mimetype || "audio/ogg";
    if (mediaBase64 && !isGroup && !fromMe) {
      const transcription = await transcribeAudio(mediaBase64, effectiveMime);
      if (transcription) {
        return { type, text: transcription, transcribed: true, waMessageId, messageTimestamp, mediaPath };
      }
    }
    return { type, text: "[áudio]", transcribed: false, waMessageId, messageTimestamp, mediaPath };
  }

  if (type === "image") {
    const effectiveMime = mimetype || "image/jpeg";
    if (mediaBase64 && !isGroup && !fromMe) {
      const description = await describeImage(mediaBase64, effectiveMime, caption);
      if (description) {
        return {
          type,
          text: `[imagem: ${description}]${caption ? ` — legenda: "${caption}"` : ""}`,
          described: true,
          waMessageId,
          messageTimestamp,
          mediaPath,
        };
      }
    }
    return { type, text: caption ? `[imagem] ${caption}` : "[imagem]", described: false, waMessageId, messageTimestamp, mediaPath };
  }

  return { type, text: `[${type}]`, waMessageId, messageTimestamp, mediaPath };

  return { type: "unknown", text: "", waMessageId, messageTimestamp };
}

// ─── Normalização de Origem de Marketing ──────────────────────────────────────

export const CANONICAL_LEAD_SOURCES = new Set([
  "campanha",
  "indicacao",
  "trafego_pago",
  "whatsapp_ads",
  "organico",
  "outro",
]);

export function normalizeLeadSource(source) {
  if (!source || typeof source !== "string") return null;
  const raw = source.trim();
  if (!raw) return null;

  // 1. Normalizar entrada: minúsculas, sem acento, espaços múltiplos aparados
  const s = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!s) return null;

  // Já é um dos 6 valores canônicos oficiais?
  if (CANONICAL_LEAD_SOURCES.has(s)) return s;

  // 2. Mapeamento para o vocabulário canônico:

  // whatsapp_ads <- whatsapp ads, click to whatsapp, ctwa, zap ads
  if (
    s.includes("whatsapp ads") ||
    s.includes("zap ads") ||
    s.includes("click to whatsapp") ||
    s.includes("ctwa")
  ) {
    return "whatsapp_ads";
  }

  // trafego_pago <- google ads, facebook ads, meta ads, instagram ads, tiktok ads, anuncio, ads, gads, fb ads
  if (
    s.includes("google ads") ||
    s.includes("facebook ads") ||
    s.includes("meta ads") ||
    s.includes("instagram ads") ||
    s.includes("tiktok ads") ||
    s.includes("anuncio") ||
    s.includes("gads") ||
    s.includes("fb ads") ||
    s.includes("trafego pago") ||
    s.includes("trafego_pago") ||
    s.endsWith(" ads") ||
    s.startsWith("ads ") ||
    s === "ads"
  ) {
    return "trafego_pago";
  }

  // campanha <- campanha
  if (s.includes("campanh")) {
    return "campanha";
  }

  // indicacao <- indicacao, amigo, recomenda, referral
  if (
    s.includes("indic") ||
    s.includes("amig") ||
    s.includes("recomenda") ||
    s.includes("referral")
  ) {
    return "indicacao";
  }

  // extracao_whatsapp <- extracao_whatsapp, extracao, extraido
  if (
    s === "extracao_whatsapp" ||
    s.includes("extracao") ||
    s.includes("extraido") ||
    s.includes("extração") ||
    s.includes("extraído")
  ) {
    return "extracao_whatsapp";
  }

  // organico <- whatsapp, instagram, tiktok, facebook, formulario, site, busca organica
  if (
    s.includes("whatsapp") ||
    s.includes("zap") ||
    s.includes("instagram") ||
    s.includes("insta") ||
    s.includes("tiktok") ||
    s.includes("facebook") ||
    s.includes("face") ||
    s.includes("formulario") ||
    s.includes("form") ||
    s.includes("site") ||
    s.includes("landing") ||
    s.includes("busca organica") ||
    s.includes("organico")
  ) {
    return "organico";
  }

  // 3. REGRA DURA: valor desconhecido resolve para 'outro' e loga em warn com o valor cru
  console.warn(`[chatbot-ai] lead_source desconhecido '${raw}', normalizado para 'outro'.`);
  return "outro";
}

// ─── IA conversacional (Groq / Providers) ────────────────────────────────────

/**
 * Remove blocos legados de instrução JSON do texto do usuário para não duplicar
 * nem conflitar com o contrato oficial anexado pelo sistema.
 */
export function stripLegacyJsonSection(text) {
  if (!text || typeof text !== "string") return "";

  const marcador = /(?:\r?\n)+\s*(?:={3,}|-{3,}|═{3,})?\s*FORMATO DE RESPOSTA[\s\S]*$/i;
  const achado = text.match(marcador);
  if (!achado) return text.trim();

  // So corta se o trecho for MESMO um schema JSON legado. Sem esta guarda, um
  // prompt que apenas mencione "formato de resposta" no meio do texto perderia
  // tudo o que vem depois — e a regra e que prompt antigo saia com comportamento
  // identico ao de hoje.
  const trecho = achado[0];
  const pareceSchema = trecho.includes("{") && /"?(mensagem|status_conversa|classificacao)"?\s*:/i.test(trecho);
  if (!pareceSchema) return text.trim();

  return text.replace(marcador, "").trim();
}

export function buildJsonInstruction() {
  return `

═══════════════════════════════════════════════════════════════
FORMATO DE RESPOSTA OBRIGATÓRIO — RETORNE EXCLUSIVAMENTE JSON
═══════════════════════════════════════════════════════════════
Sua resposta DEVE ser um único objeto JSON válido, sem texto antes ou depois, sem blocos markdown.
Toda a sua resposta ao usuário DEVE estar dentro da chave "mensagem".

Schema JSON obrigatório:
{
  "mensagem": "string — texto da sua resposta enviada ao lead no WhatsApp",
  "status_conversa": "aguardando_usuario" | "finalizado",
  "dados": { ... },   // campos coletados até agora (acumulado)
  "lead_source": "Instagram" | "Google Ads" | "Facebook Ads" | "TikTok" | "Indicação" | "Formulário" | "WhatsApp" | "Outro" | null,
  "classificacao": "QUENTE" | "MORNO" | "FRIO",
  "spin_fase": "situacao" | "problema" | "implicacao" | "necessidade" | null,
  "finalizado": true | false,
  "nao_comercial": true | false,
  "motivo_nao_comercial": "string curta — motivo quando nao_comercial for true (ex: 'pedido de comida', 'conversa pessoal', 'engano'), ou null"
}

RASTREAMENTO DE ORIGEM DO LEAD:
• Se a origem do lead (lead_source ou origem_marketing nos dados) ainda não estiver definida, faça uma pergunta leve e natural durante a conversa para saber como ele conheceu a empresa (ex.: "Por sinal, como nos conheceu? Instagram, indicação, Google?").
• Sempre preencha o campo "lead_source" (ou "origem_marketing" dentro de "dados") assim que identificar o canal de origem (ex.: Instagram, Google Ads, Facebook Ads, TikTok, Indicação, Formulário, WhatsApp, etc.).

DETECÇÃO DE CONVERSA NÃO-COMERCIAL (SILENCIAMENTO DO AGENTE):
• Marque "nao_comercial": true e informe "motivo_nao_comercial" com um texto curto (ex.: "pedido de comida", "conversa pessoal", "engano") caso a mensagem seja claramente:
  - Conversa pessoal (amigos, familiares, pedidos de comida/lanche, assuntos domésticos).
  - Engano ou número errado (a pessoa procurava outra pessoa ou serviço alheio ao negócio).
  - Reação a status ou mensagem isolada sem nenhum contexto comercial.
• REGRA EXPLÍCITA: Na dúvida, marque "nao_comercial": false e "motivo_nao_comercial": null. É melhor responder uma mensagem a mais do que calar um cliente real.

REGRA CRÍTICA — quando setar "finalizado": true:
• Sempre que você emitir a mensagem final de encerramento (ex.: "Fechado. Vou passar pro consultor...", "Vou repassar pro nosso time", ou qualquer despedida que sinalize que o consultor humano vai assumir).
• Quando todos os dados obrigatórios já foram coletados E a conversa foi encerrada.
• Se "finalizado": true, então "status_conversa" DEVE ser "finalizado".

Se "finalizado" não for true, o briefing NÃO é enviado ao SDR. Não esqueça desse campo no encerramento.`;
}

async function fetchDynamicPrompt(supabase, clientId, type) {
  if (!supabase || !clientId) return null;
  try {
    const { data } = await supabase
      .from("chatbot_prompts")
      .select("content")
      .eq("client_id", clientId)
      .eq("type", type)
      .maybeSingle();
    return data?.content || null;
  } catch {
    return null;
  }
}

async function fetchCampaignPromptById(supabase, id) {
  if (!supabase || !id) return null;
  try {
    const { data } = await supabase
      .from("campaign_prompts")
      .select("content")
      .eq("id", id)
      .maybeSingle();
    return data?.content || null;
  } catch {
    return null;
  }
}

export const DEFAULT_BUILTIN_TEMPLATES = {
  generico: {
    template_key: "generico",
    display_name: "Atendimento Geral / Vendas",
    agent_name: "Consultor",
    agent_role: "Consultor de Atendimento e Qualificação Comercial",
    data_fields: [
      { key: "interesse", label: "Interesse", description: "Produto ou serviço de interesse", required: true },
      { key: "objetivo", label: "Objetivo", description: "Objetivo principal do lead", required: false },
      { key: "cidade", label: "Cidade", description: "Cidade do lead", required: false },
      { key: "estado", label: "Estado", description: "Estado (UF)", required: false },
      { key: "prazo", label: "Prazo", description: "Quando deseja começar ou comprar", required: false },
      { key: "melhor_horario", label: "Melhor Horário", description: "Melhor momento para contato", required: false },
    ],
    required_fields: ["interesse"],
    classification: {
      quente: "Interesse claro com prazo definido",
      morno: "Interesse demonstrado mas tirando dúvidas",
      frio: "Sem interesse ou curioso sem prazo",
    },
    is_builtin: true,
  },
};

/**
 * Busca template do banco por templateKey, com fallback para builtin (client_id IS NULL)
 * e fallback final em memória para DEFAULT_BUILTIN_TEMPLATES.
 * Retorna { data_fields, required_fields, classification, agent_name, agent_role } garantido.
 */
export async function fetchTemplate(supabase, clientId, templateKey) {
  const normalizedKey = String(templateKey || "generico").trim().toLowerCase();
  const cols = "template_key, display_name, agent_name, agent_role, data_fields, required_fields, classification";

  if (supabase) {
    try {
      if (clientId) {
        const { data } = await supabase
          .from("chatbot_templates")
          .select(cols)
          .eq("template_key", normalizedKey)
          .eq("client_id", clientId)
          .maybeSingle();
        if (data) return data;
      }

      // Fallback para builtin no banco (client_id IS NULL)
      const { data } = await supabase
        .from("chatbot_templates")
        .select(cols)
        .eq("template_key", normalizedKey)
        .is("client_id", null)
        .maybeSingle();
      if (data) return data;
    } catch (err) {
      console.warn("[chatbot-ai] Falha ao consultar chatbot_templates no banco:", err?.message || err);
    }
  }

  // Fallback para catálogo embutido
  if (DEFAULT_BUILTIN_TEMPLATES[normalizedKey]) {
    return DEFAULT_BUILTIN_TEMPLATES[normalizedKey];
  }

  console.warn("[chatbot-ai] TEMPLATE NOT FOUND in DB or catalog, applying fallback to 'generico'", {
    clientId,
    requestedTemplateKey: templateKey,
  });

  return DEFAULT_BUILTIN_TEMPLATES.generico;
}

/**
 * Constrói bloco de contexto de campos a ser injetado no system prompt.
 * Inclui lista de dados a coletar e critérios de classificação de temperatura.
 */
function buildFieldContext(template) {
  if (!template) return null;

  const fields = Array.isArray(template.data_fields) ? template.data_fields : [];
  const required = Array.isArray(template.required_fields) ? template.required_fields : [];
  const classification = template.classification && typeof template.classification === "object"
    ? template.classification
    : {};

  if (!fields.length) return null;

  const fieldLines = fields
    .map((f) => {
      const req = required.includes(f.key) ? " (obrigatório)" : " (opcional)";
      return `- ${f.key}: ${f.label} — ${f.description}${req}`;
    })
    .join("\n");

  const classLines = Object.entries(classification)
    .filter(([, v]) => v)
    .map(([k, v]) => `- ${k.toUpperCase()}: ${v}`)
    .join("\n");

  return [
    "DADOS A COLETAR (retorne dentro de \"dados\" no JSON de resposta):",
    fieldLines,
    classLines ? `\nCRITÉRIOS DE CLASSIFICAÇÃO DE TEMPERATURA:\n${classLines}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Gera briefing SDR usando o prompt "extrato" do banco (configurável por empresa).
 * Recebe o histórico da conversa e os dados coletados, retorna texto formatado.
 * Se não houver prompt extrato no banco, retorna null (caller usa fallback determinístico).
 */
export async function extractBriefingWithAI({ supabase, clientId, phone, history, collectedData, classificacao, llmModel = defaultGroqModel() }) {
  const extractPrompt = await fetchDynamicPrompt(supabase, clientId, "extrato");
  if (!extractPrompt) return null;

  const dadosJson = JSON.stringify(collectedData || {}, null, 2);
  const historicText = Array.isArray(history)
    ? history.map((m) => `${m.role === "user" ? "Lead" : "Bot"}: ${m.content}`).join("\n")
    : "";

  const userContent = [
    `=== DADOS COLETADOS ===`,
    dadosJson,
    ``,
    `=== TEMPERATURA ===`,
    classificacao || "Não informado",
    ``,
    `=== HISTÓRICO DA CONVERSA ===`,
    historicText,
    ``,
    `=== CONTATO ===`,
    phone,
  ].join("\n");

  try {
    const content = await callLlmChatCompletion({
      model: llmModel,
      messages: [
        { role: "system", content: extractPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.3,
      max_tokens: 800,
    });
    return content?.trim() || null;
  } catch {
    return null;
  }
}

export async function runChatbotAI({ systemPrompt, history, newMessages, existingData, llmModel = defaultGroqModel() }) {
  // Mesclar dados existentes no contexto do sistema
  const dataContext = existingData && Object.keys(existingData).length > 0
    ? `\n\nDADOS JÁ COLETADOS ATÉ AGORA:\n${JSON.stringify(existingData, null, 2)}`
    : "";

  const cleanSystemPrompt = stripLegacyJsonSection(systemPrompt);
  const finalSystemPrompt = `${cleanSystemPrompt}${dataContext}${buildJsonInstruction()}`;

  const messages = [
    { role: "system", content: finalSystemPrompt },
    ...history,
    { role: "user", content: newMessages.join("\n") },
  ];

  let modelsToTry = resolveGroqLadder(llmModel);
  if (!modelsToTry || modelsToTry.length === 0) {
    modelsToTry = [defaultGroqModel()];
  }

  let finalResposta = null;
  let lastError = null;

  for (let i = 0; i < modelsToTry.length; i++) {
    const currentModel = modelsToTry[i];
    try {
      const raw = await callLlmChatCompletion({
        model: currentModel,
        messages,
        temperature: 0.4,
        max_tokens: 600,
        singleModelOnly: true,
      });

      const resposta = parseAIResponse(raw, finalSystemPrompt);

      // Validação estrita: a mensagem NÃO pode ser vazia e DEVE passar pela guarda de saída
      const guard = validateOutboundMessage(resposta.mensagem);
      if (!guard.valid || !String(resposta.mensagem || "").trim()) {
        console.warn(
          `[chatbot-ai] Modelo "${currentModel}" gerou resposta inválida ou vazia ` +
            `(motivo: ${guard.reason}). ` +
            (i < modelsToTry.length - 1 ? `Tentando próximo modelo da escada: "${modelsToTry[i + 1]}"...` : "Fim da escada.")
        );
        continue;
      }

      // Sucesso: modelo gerou mensagem segura para o lead
      finalResposta = resposta;
      break;
    } catch (err) {
      console.warn(`[chatbot-ai] Modelo "${currentModel}" falhou na execução: ${err.message}.`);
      lastError = err;
    }
  }

  if (!finalResposta || !String(finalResposta.mensagem || "").trim()) {
    console.error("[chatbot-ai] TODOS OS MODELOS DA ESCADA FALHARAM EM PRODUZIR JSON VÁLIDO. Resposta silenciada para proteger o lead.", {
      modelosTentados: modelsToTry,
      lastError: lastError?.message,
    });
    return {
      mensagem: "",
      mensagemAusente: true,
      contratoQuebrado: true,
      status_conversa: "aguardando_usuario",
      dados: {},
      classificacao: null,
      finalizado: false,
      spin_fase: null,
    };
  }

  return finalResposta;
}

const VALID_SPIN_FASES = new Set(["situacao", "problema", "implicacao", "necessidade"]);

function extractValidClassificacao(val) {
  if (!val) return null;
  const s = String(val).toUpperCase().trim();
  return LEADS_OUTLIER_TEMPERATURE.has(s) ? s : null;
}

export function parseAIResponse(raw, fullSystemPrompt = null) {
  if (raw === null || raw === undefined) {
    console.error("[chatbot-ai] CONTRATO QUEBRADO: modelo nao devolveu conteudo algum.");
    return {
      mensagem: "Desculpe, tive um problema técnico. Pode repetir?",
      status_conversa: "aguardando_usuario",
      dados: {},
      lead_source: null,
      classificacao: null,
      finalizado: false,
      spin_fase: null,
      contratoQuebrado: true,
    };
  }

  // Se já for objeto parseado
  if (typeof raw === "object") {
    const rawMsg = stripReasoningBlocks(raw.mensagem || raw.message || raw.resposta || "");
    const guard = validateOutboundMessage(rawMsg);
    if (!guard.valid) {
      console.error("[chatbot-ai] CONTRATO QUEBRADO: campo mensagem contém formato/chaves internas vazadas.", {
        motivo: guard.reason,
        preview: rawMsg.slice(0, 200),
      });
      return {
        mensagem: "",
        status_conversa: raw.status_conversa || "aguardando_usuario",
        dados: raw.dados || {},
        lead_source: normalizeLeadSource(raw.lead_source || raw.dados?.origem_marketing) || null,
        classificacao: extractValidClassificacao(raw.classificacao),
        finalizado: raw.finalizado === true,
        spin_fase: VALID_SPIN_FASES.has(raw.spin_fase) ? raw.spin_fase : null,
        nao_comercial: raw.nao_comercial === true,
        motivo_nao_comercial:
          raw.nao_comercial === true && typeof raw.motivo_nao_comercial === "string"
            ? raw.motivo_nao_comercial.trim().slice(0, 150)
            : null,
        contratoQuebrado: true,
      };
    }
    return {
      mensagem: rawMsg,
      status_conversa: raw.status_conversa || "aguardando_usuario",
      dados: raw.dados || {},
      lead_source: normalizeLeadSource(raw.lead_source || raw.dados?.origem_marketing) || null,
      classificacao: extractValidClassificacao(raw.classificacao),
      finalizado: raw.finalizado === true,
      spin_fase: VALID_SPIN_FASES.has(raw.spin_fase) ? raw.spin_fase : null,
      nao_comercial: raw.nao_comercial === true,
      motivo_nao_comercial:
        raw.nao_comercial === true && typeof raw.motivo_nao_comercial === "string"
          ? raw.motivo_nao_comercial.trim().slice(0, 150)
          : null,
    };
  }

  const rawStr = String(raw).trim();

  // Tenta extrair JSON estruturado usando o extrator resiliente compartilhado
  try {
    const parsed = extractJsonFromLlmText(rawStr);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const rawMsg = stripReasoningBlocks(parsed.mensagem || parsed.message || parsed.resposta || "");
      const guard = validateOutboundMessage(rawMsg);
      if (!guard.valid) {
        console.error("[chatbot-ai] CONTRATO QUEBRADO: campo mensagem no JSON extraído contém formato/chaves internas vazadas.", {
          motivo: guard.reason,
          preview: rawMsg.slice(0, 200),
        });
        return {
          mensagem: "",
          status_conversa: parsed.status_conversa || "aguardando_usuario",
          dados: parsed.dados || {},
          lead_source: normalizeLeadSource(parsed.lead_source || parsed.dados?.origem_marketing) || null,
          classificacao: extractValidClassificacao(parsed.classificacao),
          finalizado: parsed.finalizado === true,
          spin_fase: VALID_SPIN_FASES.has(parsed.spin_fase) ? parsed.spin_fase : null,
          nao_comercial: parsed.nao_comercial === true,
          motivo_nao_comercial:
            parsed.nao_comercial === true && typeof parsed.motivo_nao_comercial === "string"
              ? parsed.motivo_nao_comercial.trim().slice(0, 150)
              : null,
          contratoQuebrado: true,
        };
      }

      return {
        mensagem: rawMsg,
        status_conversa: parsed.status_conversa || "aguardando_usuario",
        dados: parsed.dados || {},
        lead_source: normalizeLeadSource(parsed.lead_source || parsed.dados?.origem_marketing) || null,
        classificacao: extractValidClassificacao(parsed.classificacao),
        finalizado: parsed.finalizado === true,
        spin_fase: VALID_SPIN_FASES.has(parsed.spin_fase) ? parsed.spin_fase : null,
        nao_comercial: parsed.nao_comercial === true,
        motivo_nao_comercial:
          parsed.nao_comercial === true && typeof parsed.motivo_nao_comercial === "string"
            ? parsed.motivo_nao_comercial.trim().slice(0, 150)
            : null,
      };
    }
  } catch (_) {}

  // Se o extrator falhou (resposta não é JSON), limpa blocos de raciocínio primeiro e valida o texto limpo
  const cleanedPlainText = stripReasoningBlocks(rawStr);
  const plainTextGuard = validateOutboundMessage(cleanedPlainText);
  if (plainTextGuard.valid) {
    console.warn("[chatbot-ai] CONTRATO QUEBRADO: resposta da LLM não é JSON mas é texto puro limpo. Mensagem aproveitada, qualificação perdida.", {
      rawLength: cleanedPlainText.length,
      rawCompleta: cleanedPlainText.slice(0, 500),
    });
    return {
      mensagem: cleanedPlainText,
      status_conversa: "aguardando_usuario",
      dados: {},
      lead_source: null,
      classificacao: null,
      finalizado: false,
      spin_fase: null,
      nao_comercial: false,
      motivo_nao_comercial: null,
      contratoQuebrado: true,
    };
  }

  // Texto cru contém JSON quebrado, chaves de contrato ou brackets: RECUSA CATEGÓRICA
  console.error("[chatbot-ai] CONTRATO QUEBRADO: resposta da LLM é JSON malformado e vaza contrato. Mensagem descartada para proteger o lead.", {
    rawLength: rawStr.length,
    motivoBloqueio: plainTextGuard.reason,
    rawPreview: rawStr.slice(0, 500),
  });

  return {
    mensagem: "",
    status_conversa: "aguardando_usuario",
    dados: {},
    lead_source: null,
    classificacao: null,
    finalizado: false,
    spin_fase: null,
    nao_comercial: false,
    motivo_nao_comercial: null,
    contratoQuebrado: true,
  };
}

// ─── Histórico de conversa ───────────────────────────────────────────────────

export function buildHistory(storedHistorico = []) {
  if (!Array.isArray(storedHistorico)) return [];
  return storedHistorico
    .filter((h) => h && h.role && h.content)
    .map((h) => ({ role: h.role, content: String(h.content) }));
}

export function appendToHistory(history, userText, assistantText) {
  return [
    ...history,
    { role: "user", content: userText },
    { role: "assistant", content: assistantText },
  ];
}

/**
 * Freio contra loop com menus/bots automáticos:
 * Se as últimas `threshold` mensagens recebidas de um mesmo contato forem idênticas,
 * detecta loop para parar o ciclo infinito sem gastar chamadas de IA.
 */
export function checkBotLoop(storedHistorico = [], currentIncomingText = "", threshold = 3) {
  if (!currentIncomingText || !currentIncomingText.trim()) {
    return { isLoop: false, count: 0, reason: null };
  }
  const normalizedIncoming = currentIncomingText.trim().toLowerCase();

  const userHistory = (storedHistorico || [])
    .filter((h) => h && h.role === "user" && typeof h.content === "string")
    .map((h) => h.content.trim().toLowerCase());

  userHistory.push(normalizedIncoming);

  // Conta quantas mensagens consecutivas no final são idênticas à mensagem atual
  let consecutiveCount = 0;
  for (let i = userHistory.length - 1; i >= 0; i--) {
    if (userHistory[i] === normalizedIncoming) {
      consecutiveCount++;
    } else {
      break;
    }
  }

  const isLoop = consecutiveCount >= threshold;
  return {
    isLoop,
    count: consecutiveCount,
    reason: isLoop ? `${consecutiveCount} mensagens idênticas consecutivas detectadas (loop com bot/menu)` : null,
  };
}

// ─── Engine completo: processar batch de mensagens ───────────────────────────

/**
 * Processa um batch de mensagens do buffer para um phone+clientId.
 * Carrega histórico do banco, chama IA, salva resultado, retorna mensagem.
 */
function chatbotLeadsTable(clientId) {
  return "leads";
}

// Horas de inatividade para considerar lead "abandonado" e reengajar
const REENGAGEMENT_HOURS = 4;

/**
 * Reclassifica a temperatura do lead no recontato, do zero, a partir dos dados ja
 * coletados. Sem fallback: se nao der para classificar, devolve null.
 *
 * Antes daqui saia `existing.lead_temperature || "QUENTE"`. Como lead_temperature
 * esta vazia em toda a base (medido em producao 07/08/2026), o `||` sempre disparava
 * e TODO recontato virava QUENTE — priorizacao inflada e alerta de SDR sem significado.
 *
 * Usa qualifyLead (deterministico, sem LLM) — nao adiciona custo de modelo.
 */
function classifyRecontactTemperature(dados, { clientId, phone }) {
  try {
    const classificacao = qualifyLead(dados);
    if (!LEADS_OUTLIER_TEMPERATURE.has(classificacao)) {
      console.warn("[chatbot-ai] recontato: classificacao fora do dominio, gravando null", {
        clientId,
        phone: phone.slice(-4),
        classificacao,
      });
      return null;
    }
    return classificacao;
  } catch (err) {
    // Null honesto e melhor que QUENTE falso — foi exatamente esse o defeito.
    console.error("[chatbot-ai] recontato: falha ao classificar, seguindo com null", {
      clientId,
      phone: phone.slice(-4),
      error: err?.message || err,
    });
    return null;
  }
}

function hoursSince(isoDate) {
  if (!isoDate) return Infinity;
  return (Date.now() - new Date(isoDate).getTime()) / 3_600_000;
}

/**
 * Primeiro recontato de um lead finalizado quando o tenant configurou recontact_message.
 * Usa o texto literal do tenant (escolha explícita dele).
 * A heurística local qualifyLead roda APENAS aqui (quando não há IA) e nunca sobrescreve
 * classificação prévia vinda da IA ou do banco.
 */
async function responderRecontatoComTextoLiteral({
  supabase,
  leadsTable,
  clientId,
  phone,
  existing,
  dadosAntigos,
  customMessage,
  instanceName = null,
}) {
  const classificacaoPrevia = existing?.status || existing?.lead_temperature || null;
  const classificacaoHeuristica = classifyRecontactTemperature(dadosAntigos, { clientId, phone });
  const classificacao = classificacaoPrevia || classificacaoHeuristica || null;

  console.log("[chatbot-ai] Recontact with tenant literal message", {
    phone: phone.slice(-4),
    clientId,
    classificacaoPrevia,
    classificacao,
  });

  const patch = {
    dados: { ...dadosAntigos, recontato_avisado_em: new Date().toISOString() },
  };
  if (!classificacaoPrevia && classificacao) {
    patch.lead_temperature = classificacao;
  }

  const { error: patchError } = await supabase
    .from(leadsTable)
    .update(patch)
    .eq("id", existing.id)
    .eq("client_id", clientId);

  if (patchError) {
    console.error("[chatbot-ai] recontato: falha ao gravar marca/temperatura", {
      clientId,
      phone: phone.slice(-4),
      error: patchError.message,
    });
  }

  // Salvar resposta de recontato em lead_messages (com delivered_at e instance_name para o Inbox)
  const now = new Date().toISOString();
  try {
    const tableRef = supabase?.from ? supabase.from("lead_messages") : null;
    if (tableRef && typeof tableRef.insert === "function") {
      tableRef.insert([{
        client_id: clientId,
        phone,
        // lead_id: o Dashboard casa lead com mensagem por lead_id OU telefone.
        // Este insert cru era o unico caminho que gravava sem o vinculo — as
        // demais vias ja passam por appendLeadMessage, que resolve o lead por
        // telefone canonico. Aqui o lead ja esta em maos (`existing`), entao nao
        // ha lookup: se nao houver lead, fica null. Nao se inventa vinculo.
        lead_id: existing?.id ?? null,
        sender_type: "bot",
        direction: "outbound",
        message_text: customMessage,
        delivered_at: now,
        message_timestamp: now,
        created_at: now,
        instance_name: instanceName || null,
      }]).then(({ error }) => {
        if (error) console.warn("[chatbot-ai] lead_messages recontact insert error:", error.message);
      }).catch((err) => {
        console.warn("[chatbot-ai] lead_messages recontact insert error:", err?.message || err);
      });
    }
  } catch (err) {
    console.warn("[chatbot-ai] lead_messages recontact insert error:", err?.message || err);
  }

  return {
    mensagem: customMessage,
    status_conversa: "finalizado",
    dados: dadosAntigos,
    classificacao,
    finalizado: true,
    _recontato: true, // sinal para o webhook notificar SDR de recontato
  };
}

export function buildRecontactInstruction({ lead = null, storedData = {}, historyText = "" } = {}) {
  const dados = Object.keys(storedData || {}).length > 0 ? storedData : (lead?.dados || {});
  const temp = lead?.lead_temperature || dados?.lead_temperature || "não informada";
  const dadosResumo = JSON.stringify(dados);
  return `
==================================================
CONTEXTO ESPECIAL — RECONTATO DE LEAD JÁ FINALIZADO (CONTEXTO DE RECONTATO):
Este lead já foi qualificado e finalizado em um atendimento anterior. Ele está retomando o contato agora.
Temperatura anterior do lead: ${temp}.
Dados já coletados no atendimento anterior: ${dadosResumo}.
${historyText ? `Histórico resumido:\n${historyText}\n` : ""}
DIRETRIZES OBRIGATÓRIAS PARA ESTE RECONTATO:
1. RECONHEÇA O HISTÓRICO: Responda de forma acolhedora, natural e personalizada, demonstrando que você se lembra do contato anterior (sem frases robóticas ou clichês engessados).
2. NÃO RECOMECE A QUALIFICAÇÃO DO ZERO: Não refaça perguntas sobre dados que já foram informados acima.
3. CONDUZA COM OBJETIVIDADE: Responda à nova mensagem/dúvida do lead e informe com naturalidade que a equipe/consultor dará continuidade ao atendimento se necessário.
==================================================`;
}

export async function processBatch({
  clientId,
  phone,
  messages,
  supabase,
  model,
  promptType: promptTypeOverride = null,
  campaignPromptId = null,
  llmModel = null,
  inboundPrompt = null,
  inboundSpinInstruction = "",
  instanceName = null,
}) {
  const tenantSettings = await getLeadClientN8nSettings(clientId).catch(() => null);
  const effectivePersonaModel = model || tenantSettings?.chatbot_model || "generico";
  let activeLlmModel = resolveLlmModel(llmModel || tenantSettings?.chatbot_llm_model);

  const modelConfig = getChatbotModel(effectivePersonaModel);
  const leadsTable = chatbotLeadsTable(clientId);

  // Combinar textos do batch
  const combinedText = messages
    .map((m) => m.text)
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!combinedText) {
    console.log("[chatbot-ai] Empty batch, skipping");
    return null;
  }

  // Carregar estado atual do banco
  const { data: existingArray } = await supabase
    .from(leadsTable)
    // status e lead_source ENTRAM aqui porque o payload os preserva quando o
    // modelo nao classifica no turno. Sem estar no SELECT, existing.status era
    // sempre undefined e a "preservacao" gravava null — a classificacao anterior
    // era apagada justamente no turno em que se queria protege-la.
    .select("id, dados, historico, status, lead_source, status_conversa, finalizado, updated_at, lead_temperature, stage, stage_source, raw_chat_summary")
    .eq("client_id", clientId)
    .eq("telefone", phone)
    .order("created_at", { ascending: false })
    .limit(1);

  const existing = existingArray?.[0] || null;

  // ── Cenário 1: lead já finalizado voltou a contatar ──────────────────────
  //
  // O aviso de recontato sai UMA vez. Da segunda mensagem em diante a conversa
  // REABRE e o lead volta ao atendimento normal.
  let isPrimeiroRecontato = false;
  if (existing?.finalizado) {
    const dadosAntigos = existing.dados || {};
    const jaAvisadoEm = String(dadosAntigos.recontato_avisado_em ?? "").trim();

    if (jaAvisadoEm) {
      // Segunda mensagem: reabre e SEGUE para o fluxo normal (nao retorna aqui).
      const dadosReabertos = {
        ...dadosAntigos,
        recontato_avisado_em: null,
        recontato_reaberto_em: new Date().toISOString(),
      };
      const { error: reopenError } = await supabase
        .from(leadsTable)
        .update({ finalizado: false, status_conversa: "em_atendimento", dados: dadosReabertos })
        .eq("id", existing.id)
        .eq("client_id", clientId);

      if (reopenError) {
        console.error("[chatbot-ai] recontato: falha ao reabrir conversa", {
          clientId,
          phone: phone.slice(-4),
          error: reopenError.message,
        });
      } else {
        console.log("[chatbot-ai] recontato: conversa reaberta", {
          clientId,
          phone: phone.slice(-4),
        });
      }

      existing.finalizado = false;
      existing.dados = dadosReabertos;
    } else {
      const customMessage = tenantSettings?.recontact_message?.trim();
      if (customMessage) {
        // Tenant configurou texto literal explícito: envia sem chamar LLM
        return await responderRecontatoComTextoLiteral({
          supabase,
          leadsTable,
          clientId,
          phone,
          existing,
          dadosAntigos,
          customMessage,
          instanceName,
        });
      }

      // Tenant NÃO configurou mensagem customizada: o AGENTE GERA via LLM
      isPrimeiroRecontato = true;
    }
  }


  const storedDados = normalizeLeadsOutlierDados(existing?.dados || {});
  const storedHistorico = parseStoredHistorico(existing?.historico) || parseStoredHistorico(existing?.dados?.historico);
  const storedData = { ...storedDados };

  const history = buildHistory(storedHistorico);

  // ── Cenário 0: Freio contra Loop de Robô / Mensagens Idênticas Repetidas ──
  const loopCheck = checkBotLoop(storedHistorico, combinedText, 3);
  if (loopCheck.isLoop) {
    console.warn("[chatbot-ai] FREIO DE LOOP ATIVADO: contato enviou 3 mensagens idênticas consecutivas (possível menu/bot automático). IA silenciada para atenção humana.", {
      clientId,
      phone: maskPhoneForLog(phone),
      textPreview: combinedText.slice(0, 100),
    });

    const updatedDados = {
      ...(existing?.dados || {}),
      precisa_atencao_humana: true,
      motivo_atencao_humana: "Mensagens idênticas repetidas (loop com bot/menu automático)",
      bot_loop_detected_at: new Date().toISOString(),
    };

    if (existing?.id) {
      await supabase
        .from(leadsTable)
        .update({
          dados: updatedDados,
          status_conversa: "em_atendimento",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("client_id", clientId);

      const newHistory = appendToHistory(history, combinedText, "[Freio de Loop: Atendimento pausado por mensagens repetidas. Aguardando atenção humana.]");
      await supabase
        .from(leadsTable)
        .update({ historico: serializeHistorico(newHistory) })
        .eq("id", existing.id)
        .eq("client_id", clientId);
    }

    return {
      mensagem: "",
      status_conversa: "em_atendimento",
      dados: updatedDados,
      lead_source: existing?.lead_source || null,
      classificacao: existing?.status || null,
      finalizado: false,
      loopDetected: true,
    };
  }

  // Busca prompt padrão do tenant, prompt da campanha (se houver) e template em paralelo
  const promptType = promptTypeOverride || (effectivePersonaModel.startsWith("campanha_") ? "campanha" : "padrao");
  const baseModelKey = effectivePersonaModel.startsWith("campanha_") ? effectivePersonaModel.replace("campanha_", "") : effectivePersonaModel;

  const [dynamicPrompt, campaignPrompt, template] = await Promise.all([
    fetchDynamicPrompt(supabase, clientId, promptType),
    campaignPromptId ? fetchCampaignPromptById(supabase, campaignPromptId) : Promise.resolve(null),
    fetchTemplate(supabase, clientId, baseModelKey),
  ]);

  // Se houver inboundPrompt (customizado por chip), ele é a base. Senão, dynamicPrompt.
  // Se nenhum dos dois existir mas houver campaignPrompt, usa campaignPrompt como fallback.
  let basePromptText = inboundPrompt
    ? `${inboundPrompt}${inboundSpinInstruction}`
    : dynamicPrompt || campaignPrompt;

  // REGRA DE SEGURANÇA OBRIGATÓRIA: se o roteiro de campanha não for encontrado, NUNCA silencia o lead.
  // Faz fallback imediato para o prompt padrão do tenant.
  if (!basePromptText && (promptType === "campanha" || campaignPromptId)) {
    console.warn("[chatbot-ai] ROTEIRO DE CAMPANHA NÃO ENCONTRADO — utilizando fallback para prompt padrão de atendimento (lead não será silenciado)", {
      clientId,
      promptType,
      campaignPromptId,
      phone: maskPhoneForLog(phone),
    });
    const defaultPrompt = await fetchDynamicPrompt(supabase, clientId, "padrao");
    if (defaultPrompt) {
      basePromptText = defaultPrompt;
    }
  }

  if (!basePromptText) {
    console.error("[chatbot-ai] PROMPT NOT FOUND in DB — chatbot silenciado", { clientId, promptType, isRecontact: isPrimeiroRecontato });
    return null;
  }
  if (!template) {
    console.warn("[chatbot-ai] TEMPLATE NOT FOUND in DB", { clientId, baseModelKey });
  }

  // Garante que todas as colunas do template existam na tabela (fire-and-forget nos erros)
  await ensureTemplateColumns(supabase, leadsTable, template?.data_fields);

  const fieldContext = buildFieldContext(template);
  const baseSystemPrompt = fieldContext
    ? `${basePromptText}\n\n${fieldContext}`
    : basePromptText;

  // Se houver prompt específico de campanha e ele não for o único prompt base:
  // Anexa a CAMADA DA CAMPANHA no final do prompt do sistema, como camada aditiva que prevalece em detalhes da oferta.
  let effectiveSystemPrompt = baseSystemPrompt;
  if (campaignPrompt && basePromptText !== campaignPrompt) {
    const campaignHeader = [
      "",
      "==================================================",
      "CAMADA DA CAMPANHA (OFERTA ESPECÍFICA DESTE DISPARO):",
      "As instruções abaixo são específicas para a campanha e oferta deste lead.",
      "Mantenha sua identidade, tom de voz, método de qualificação (SPIN), critérios de finalização e regras de classificação definidos acima.",
      "",
      "DIRETRIZES DE CONDUÇÃO DA OFERTA COM QUALIFICAÇÃO:",
      "1. A OFERTA É O ASSUNTO CENTRAL: A conversa é sempre sobre a oferta deste disparo do início ao fim. A qualificação é subproduto natural da conversa sobre ela, nunca uma agenda paralela ou questionário separado.",
      "2. NENHUMA PERGUNTA NASCE DO NADA: Toda pergunta deve se conectar e derivar diretamente da resposta anterior do lead e do contexto da oferta. Nunca troque de assunto repentinamente.",
      "3. UMA PERGUNTA POR VEZ E COM ENTREGA DE VALOR: Primeiro acolha e entregue contexto ou valor sobre a oferta, depois faça UMA única pergunta relevante. Nunca faça perguntas secas ou interrogatórios.",
      "",
      "EXEMPLO CONCRETO DE COMPORTAMENTO:",
      "  Cenário: Disparo enviou uma pergunta sobre a oferta (ex: 'Você gostou? 1. Sim 2. Não') e o lead respondeu '1' ou 'Sim'.",
      "  - ERRADO: \"Qual é o seu segmento de atuação?\" (pergunta solta, genérica, troca de assunto que quebra o tom da conversa).",
      "  - CERTO: \"Que bom! Essa condição exclusiva foi pensada exatamente para acelerar os seus resultados. Hoje como você tem estruturado isso no seu dia a dia?\" (reconhece o Sim, fala da oferta E colhe o contexto na mesma frase).",
      "",
      "DETALHES E REGRAS DA OFERTA DESTE DISPARO:",
      campaignPrompt.trim(),
      "",
      "Em caso de conflito direto sobre detalhes específicos desta oferta, as instruções desta camada prevalecem.",
      "==================================================",
    ].join("\n");

    effectiveSystemPrompt = `${baseSystemPrompt}\n${campaignHeader}`;
  }

  // ── Contexto de Prompt Especial ──
  let systemPromptOverride = null;
  if (isPrimeiroRecontato) {
    // ── Cenário 1 (geração com IA): primeiro recontato de lead finalizado ──
    const recontactBlock = buildRecontactInstruction({
      lead: existing,
      storedData,
      historyText: history.map((h) => `${h.role === "user" ? "Lead" : "Bot"}: ${h.content}`).slice(-6).join("\n"),
    });
    systemPromptOverride = `${effectiveSystemPrompt}\n${recontactBlock}`;

    console.log("[chatbot-ai] Recontact generation with AI for finalized lead", {
      clientId,
      phone: phone.slice(-4),
      llmModel: activeLlmModel,
    });
  } else if (existing && history.length > 0) {
    // ── Cenário 2: lead abandonou no meio — reengajamento após REENGAGEMENT_HOURS ──
    const horasInativo = hoursSince(existing.updated_at);
    if (horasInativo >= REENGAGEMENT_HOURS) {
      const ultimaPergunta = history.filter((m) => m.role === "assistant").at(-1)?.content || "";
      systemPromptOverride = `${effectiveSystemPrompt}

CONTEXTO ESPECIAL — REENGAJAMENTO:
Este lead ficou ${Math.round(horasInativo)}h sem responder. Retomou o contato agora.
Não reinicie a conversa do zero. Retome de forma natural e leve, sem cobrar a ausência.
Última pergunta feita: "${ultimaPergunta.slice(0, 120)}"
Dados já coletados: ${JSON.stringify(storedData)}.
Continue de onde parou, coletando apenas o que ainda falta.`;

      console.log("[chatbot-ai] Reengagement after", Math.round(horasInativo), "hours", { phone: phone.slice(-4) });
    }
  }

  // ── Execução da IA ──────────────────
  let aiResponse;
  try {
    aiResponse = await runChatbotAI({
      systemPrompt: systemPromptOverride || effectiveSystemPrompt,
      history,
      newMessages: [combinedText],
      existingData: storedData,
      llmModel: activeLlmModel,
    });
  } catch (err) {
    console.error("[chatbot-ai] FALHA AO EXECUTAR IA NO TURNO — silenciando resposta automática", {
      clientId,
      phone: phone.slice(-4),
      isRecontact: isPrimeiroRecontato,
      error: err?.message || String(err),
    });
    return null;
  }

  if (!aiResponse || !aiResponse.mensagem || !String(aiResponse.mensagem).trim()) {
    console.error("[chatbot-ai] RESPOSTA VAZIA DA IA — silenciando resposta automática", {
      clientId,
      phone: phone.slice(-4),
      isRecontact: isPrimeiroRecontato,
      contratoQuebrado: aiResponse?.contratoQuebrado,
    });
    return null;
  }

  if (aiResponse.contratoQuebrado) {
    console.error("[chatbot-ai] CONTRATO QUEBRADO neste turno — lead segue sem qualificacao nova", {
      clientId,
      phone: phone.slice(-4),
      table: leadsTable,
    });
  }

  console.log("[chatbot-ai] AI response:", {
    table: leadsTable,
    status: isPrimeiroRecontato ? "finalizado" : aiResponse.status_conversa,
    classificacao: aiResponse.classificacao,
    contratoQuebrado: aiResponse.contratoQuebrado === true,
    finalizado: isPrimeiroRecontato ? true : aiResponse.finalizado,
    isRecontact: isPrimeiroRecontato,
    msgPreview: aiResponse.mensagem.slice(0, 60),
    phone: phone.slice(-4),
  });

  // Repetir a ultima fala palavra por palavra quase sempre significa que o modelo
  // nao recebeu o historico. Nao se corrige a resposta aqui — inventar texto seria
  // o defeito que este repositorio ja pagou quatro vezes —, mas o log passa a dizer
  // o que esta acontecendo em vez de deixar o dono adivinhando.
  const ultimaFalaDoAgente = history.filter((m) => m.role === "assistant").at(-1)?.content || "";
  const repetiuUltimaFala =
    Boolean(ultimaFalaDoAgente) && ultimaFalaDoAgente.trim() === String(aiResponse.mensagem || "").trim();
  if (repetiuUltimaFala) {
    console.error("[chatbot-ai] RESPOSTA IDENTICA A ANTERIOR — sinal de que o historico nao chegou ao modelo", {
      clientId,
      phone: phone.slice(-4),
      turnosNoHistorico: history.length,
      trecho: ultimaFalaDoAgente.slice(0, 80),
    });
  }

  // Atualizar histórico
  const newHistory = appendToHistory(history, combinedText, aiResponse.mensagem);

  const rawLeadSource = aiResponse.lead_source || storedData?.origem_marketing || storedData?.lead_source_bruto || null;
  const dadosBase = {
    ...storedData,
    ...aiResponse.dados,
  };
  if (rawLeadSource) {
    dadosBase.lead_source_bruto = String(rawLeadSource).trim();
  }
  if (isPrimeiroRecontato) {
    dadosBase.recontato_avisado_em = new Date().toISOString();
  }

  const dadosToSave = normalizeLeadsOutlierDados({
    dados: dadosBase,
  });

  const payload = {
    client_id: clientId,
    telefone: phone,
    status_conversa: isPrimeiroRecontato ? "finalizado" : aiResponse.status_conversa,
    // classificacao null = o modelo quebrou o contrato e NAO classificou nesta
    // rodada. Preserva a classificacao anterior em vez de sobrescrever com um
    // palpite; nunca inventa valor. Ver parseAIResponse.
    status: aiResponse.classificacao ?? existing?.status ?? existing?.lead_temperature ?? null,
    lead_source: normalizeLeadSource(rawLeadSource) || existing?.lead_source || null,
    spin_fase: aiResponse.spin_fase || null,
    dados: dadosToSave,
    historico: serializeHistorico(newHistory),
    mensagem: aiResponse.mensagem,
    finalizado: isPrimeiroRecontato ? true : aiResponse.finalizado,
    updated_at: new Date().toISOString(),
    // Colunas individuais de todos os campos do template (existência garantida por ensureTemplateColumns)
    ...extractIndividualColumns(dadosToSave, template?.data_fields),
  };

  if (isPrimeiroRecontato && (aiResponse.classificacao || existing?.lead_temperature)) {
    payload.lead_temperature = aiResponse.classificacao || existing.lead_temperature;
  }

  // Bloco 3: Atribuição de Lead por Chip
  // Se for novo lead (!existing?.id), resolve o owner_uid do chip que recebeu a mensagem
  if (!existing?.id) {
    const chipOwnerUid = await resolveEvolutionInstanceOwner({ clientId, instanceName }).catch(() => null);
    payload.assigned_to = chipOwnerUid || null;
  } else {
    // Lead existente: NUNCA altera assigned_to (preserva 2.126 históricos e atribuições existentes)
    delete payload.assigned_to;
  }

  // Gravacao do lead. O erro E VERIFICADO: este cliente nao lanca excecao, devolve
  // { error }. Sem conferir, uma falha de escrita some — e com ela o historico,
  // que e o unico lugar de onde a conversa e relida no turno seguinte.
  let persistErro = null;
  try {
    const resultado = existing?.id
      ? await supabase.from(leadsTable).update(payload).eq("id", existing.id)
      : await supabase.from(leadsTable).insert([{ ...payload, created_at: new Date().toISOString() }]);
    persistErro = resultado?.error || null;
  } catch (err) {
    persistErro = err;
  }

  if (persistErro) {
    console.error("[chatbot-ai] FALHA AO GRAVAR O LEAD — o historico NAO foi salvo. O proximo turno vai comecar sem memoria e o agente tende a repetir a ultima pergunta.", {
      clientId,
      table: leadsTable,
      phone: phone.slice(-4),
      operacao: existing?.id ? "update" : "insert",
      erro: persistErro?.message || String(persistErro),
      colunasDoPayload: Object.keys(payload),
    });
  }

  // Inclui histórico completo no retorno para o caller usar no briefing SDR
  // sem precisar rebuscar no banco (evita round-trip extra na finalização)
  return {
    ...aiResponse,
    status_conversa: payload.status_conversa,
    finalizado: payload.finalizado,
    classificacao: payload.status,
    _recontato: isPrimeiroRecontato,
    _history: newHistory,
    _dados: dadosToSave,
    _existingLead: existing,
    _persistErro: persistErro ? persistErro.message || String(persistErro) : null,
    _repetiuUltimaFala: repetiuUltimaFala,
  };
}
