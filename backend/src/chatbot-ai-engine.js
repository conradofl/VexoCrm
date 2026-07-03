import {
  normalizeLeadsOutlierDados,
  parseStoredHistorico,
  serializeHistorico,
} from "./leads-outlier-schema.js";

/**
 * Chatbot AI Engine
 * Buffer de mensagens + transcrição de mídia + IA conversacional (Groq)
 * Modelo base para todos os tenants — cada empresa tem seu próprio system prompt
 */

// ─── Buffer in-memory ──────────────────────────────────────────────────────
// Map: `${clientId}:${phone}` → { messages: [], timer, token }
const messageBuffers = new Map();
const BUFFER_DELAY_MS = 3000;

// ─── Groq config ────────────────────────────────────────────────────────────
const GROQ_BASE = "https://api.groq.com/openai/v1";
const GROQ_CHAT_MODEL = "llama-3.3-70b-versatile";
const GROQ_VISION_MODEL = "llama-3.2-11b-vision-preview";
const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";

function groqKey() {
  return process.env.GROQ_API_KEY || "";
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
    null
  );
}

export function extractMediaMimetype(evolutionBody) {
  const msg = evolutionBody?.data?.message || {};
  return (
    msg.audioMessage?.mimetype ||
    msg.pttMessage?.mimetype ||
    msg.imageMessage?.mimetype ||
    null
  );
}

// ─── Transcrição de áudio via Groq Whisper ───────────────────────────────────

export async function transcribeAudio(base64Data, mimetype = "audio/ogg") {
  if (!groqKey()) {
    console.warn("[chatbot-ai] GROQ_API_KEY not set, cannot transcribe audio");
    return null;
  }

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
    });

    if (!res.ok) {
      const err = await res.text();
      console.error("[chatbot-ai] Whisper error:", err.slice(0, 200));
      return null;
    }

    const data = await res.json();
    return data.text || null;
  } catch (err) {
    console.error("[chatbot-ai] transcribeAudio error:", err.message);
    return null;
  }
}

// ─── Descrição de imagem via Groq Vision ─────────────────────────────────────

export async function describeImage(base64Data, mimetype = "image/jpeg", caption = "") {
  if (!groqKey()) return null;

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
    });

    if (!res.ok) {
      console.error("[chatbot-ai] Vision error:", res.status);
      return null;
    }

    const data = await res.json();
    return data.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error("[chatbot-ai] describeImage error:", err.message);
    return null;
  }
}

// ─── Processamento de mensagem recebida (tipo + conteúdo) ────────────────────

export async function resolveMessageContent(evolutionBody) {
  const type = detectMessageType(evolutionBody);
  const caption = evolutionBody?.data?.message?.imageMessage?.caption || "";

  if (type === "text") {
    return { type, text: extractTextFromBody(evolutionBody) || "" };
  }

  if (type === "audio") {
    const base64 = extractMediaBase64(evolutionBody);
    const mimetype = extractMediaMimetype(evolutionBody) || "audio/ogg";
    if (base64) {
      const transcription = await transcribeAudio(base64, mimetype);
      if (transcription) {
        console.log("[chatbot-ai] Audio transcribed:", transcription.slice(0, 80));
        return { type, text: transcription, transcribed: true };
      }
    }
    return { type, text: "[áudio]", transcribed: false };
  }

  if (type === "image") {
    const base64 = extractMediaBase64(evolutionBody);
    const mimetype = extractMediaMimetype(evolutionBody) || "image/jpeg";
    if (base64) {
      const description = await describeImage(base64, mimetype, caption);
      if (description) {
        console.log("[chatbot-ai] Image described:", description.slice(0, 80));
        return { type, text: `[imagem: ${description}]${caption ? ` — legenda: "${caption}"` : ""}`, described: true };
      }
    }
    return { type, text: caption ? `[imagem] ${caption}` : "[imagem]", described: false };
  }

  if (type === "sticker") return { type, text: "[sticker]" };
  if (type === "reaction") return { type, text: "[reação]" };
  if (type === "video") return { type, text: caption ? `[vídeo] ${caption}` : "[vídeo]" };
  if (type === "document") {
    const name = evolutionBody?.data?.message?.documentMessage?.fileName || "documento";
    return { type, text: `[documento: ${name}]` };
  }

  return { type: "unknown", text: "" };
}

// ─── IA conversacional (Groq) ────────────────────────────────────────────────

function buildJsonInstruction() {
  return `

═══════════════════════════════════════════════════════════════
FORMATO DE RESPOSTA OBRIGATÓRIO — RETORNE APENAS JSON VÁLIDO
═══════════════════════════════════════════════════════════════
Sem markdown, sem texto fora do JSON. Schema obrigatório:

{
  "mensagem": "string — texto da resposta enviada ao lead no WhatsApp",
  "status_conversa": "aguardando_usuario" | "finalizado",
  "dados": { ... },   // campos coletados até agora (acumulado)
  "classificacao": "QUENTE" | "MORNO" | "FRIO",
  "spin_fase": "situacao" | "problema" | "implicacao" | "necessidade" | null,
  "finalizado": true | false
}

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

/**
 * Busca template do banco por templateKey, com fallback para builtin (client_id IS NULL).
 * Retorna { data_fields, required_fields, classification, agent_name, agent_role } ou null.
 */
async function fetchTemplate(supabase, clientId, templateKey) {
  if (!supabase || !templateKey) return null;
  try {
    const cols = "template_key, display_name, agent_name, agent_role, data_fields, required_fields, classification";

    if (clientId) {
      const { data } = await supabase
        .from("chatbot_templates")
        .select(cols)
        .eq("template_key", templateKey)
        .eq("client_id", clientId)
        .maybeSingle();
      if (data) return data;
    }

    // Fallback para builtin (client_id IS NULL)
    const { data } = await supabase
      .from("chatbot_templates")
      .select(cols)
      .eq("template_key", templateKey)
      .is("client_id", null)
      .maybeSingle();
    return data || null;
  } catch {
    return null;
  }
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
export async function extractBriefingWithAI({ supabase, clientId, phone, history, collectedData, classificacao }) {
  const extractPrompt = await fetchDynamicPrompt(supabase, clientId, "extrato");
  if (!extractPrompt) return null;

  if (!groqKey()) return null;

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
    const resp = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${groqKey()}` },
      body: JSON.stringify({
        model: GROQ_CHAT_MODEL,
        messages: [
          { role: "system", content: extractPrompt },
          { role: "user", content: userContent },
        ],
        temperature: 0.3,
        max_tokens: 800,
      }),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    return json.choices?.[0]?.message?.content?.trim() || null;
  } catch {
    return null;
  }
}

export async function runChatbotAI({ systemPrompt, history, newMessages, existingData }) {
  if (!groqKey()) throw new Error("GROQ_API_KEY não configurada");

  // Mesclar dados existentes no contexto do sistema
  const dataContext = existingData && Object.keys(existingData).length > 0
    ? `\n\nDADOS JÁ COLETADOS ATÉ AGORA:\n${JSON.stringify(existingData, null, 2)}`
    : "";

  const messages = [
    { role: "system", content: systemPrompt + dataContext + buildJsonInstruction() },
    ...history,
    { role: "user", content: newMessages.join("\n") },
  ];

  const res = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqKey()}`,
    },
    body: JSON.stringify({
      model: GROQ_CHAT_MODEL,
      messages,
      temperature: 0.4,
      max_tokens: 600,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq error ${res.status}: ${err.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data.choices?.[0]?.message?.content || "{}";

  return parseAIResponse(raw);
}

const VALID_SPIN_FASES = new Set(["situacao", "problema", "implicacao", "necessidade"]);

function parseAIResponse(raw) {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return {
      mensagem: String(parsed.mensagem || ""),
      status_conversa: parsed.status_conversa || "aguardando_usuario",
      dados: parsed.dados || {},
      classificacao: parsed.classificacao || "FRIO",
      finalizado: parsed.finalizado === true,
      spin_fase: VALID_SPIN_FASES.has(parsed.spin_fase) ? parsed.spin_fase : null,
    };
  } catch {
    const match = raw.match(/\{[\s\S]+\}/);
    if (match) {
      try {
        return parseAIResponse(match[0]);
      } catch {}
    }
    console.error("[chatbot-ai] Failed to parse AI response:", raw.slice(0, 200));
    return {
      mensagem: "Desculpe, tive um problema técnico. Pode repetir?",
      status_conversa: "aguardando_usuario",
      dados: {},
      classificacao: "FRIO",
      finalizado: false,
      spin_fase: null,
    };
  }
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

function hoursSince(isoDate) {
  if (!isoDate) return Infinity;
  return (Date.now() - new Date(isoDate).getTime()) / 3_600_000;
}

export async function processBatch({ clientId, phone, messages, supabase, model, promptType: promptTypeOverride = null, campaignPromptId = null }) {
  if (!model) {
    console.error("[chatbot-ai] model não configurado para cliente — chatbot silenciado", { clientId });
    return null;
  }
  const modelConfig = getChatbotModel(model);
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
    .select("id, dados, historico, status_conversa, finalizado, updated_at, lead_temperature")
    .eq("client_id", clientId)
    .eq("telefone", phone)
    .order("created_at", { ascending: false })
    .limit(1);

  const existing = existingArray?.[0] || null;

  // ── Cenário 1: lead já finalizado voltou a contatar ──────────────────────
  if (existing?.finalizado) {
    const dadosAntigos = existing.dados || {};
    const horario = dadosAntigos.melhor_horario || null;
    const interesse = dadosAntigos.interesse || null;

    const msgRecontato = interesse
      ? `Oi! Vi que já conversamos sobre ${interesse}. Nosso consultor vai entrar em contato com você${horario ? ` de ${horario}` : " em breve"}. Posso ajudar com mais alguma coisa?`
      : "Oi! Vi que já passamos por uma conversa antes. Nosso consultor vai entrar em contato. Posso ajudar com mais alguma coisa?";

    console.log("[chatbot-ai] Recontact from finalized lead", { phone: phone.slice(-4), clientId });

    return {
      mensagem: msgRecontato,
      status_conversa: "finalizado",
      dados: dadosAntigos,
      classificacao: existing.lead_temperature || "QUENTE",
      finalizado: true,
      _recontato: true, // sinal para o webhook notificar SDR de recontato
    };
  }

  const storedDados = normalizeLeadsOutlierDados(existing?.dados || {});
  const storedHistorico = parseStoredHistorico(existing?.historico) || parseStoredHistorico(existing?.dados?.historico);
  const storedData = { ...storedDados };

  const history = buildHistory(storedHistorico);

  // Busca prompt e template do banco em paralelo
  // promptTypeOverride vem do roteamento de campanha (campanha | padrao)
  // fallback legacy: se model começa com "campanha_" → campanha
  const promptType = promptTypeOverride || (model.startsWith("campanha_") ? "campanha" : "padrao");
  const baseModelKey = model.startsWith("campanha_") ? model.replace("campanha_", "") : model;

  const [dynamicPrompt, template] = await Promise.all([
    campaignPromptId
      ? fetchCampaignPromptById(supabase, campaignPromptId)
      : fetchDynamicPrompt(supabase, clientId, promptType),
    fetchTemplate(supabase, clientId, baseModelKey),
  ]);

  if (!dynamicPrompt) {
    console.error("[chatbot-ai] PROMPT NOT FOUND in DB — chatbot silenciado", { clientId, promptType });
    return null;
  }
  if (!template) {
    console.warn("[chatbot-ai] TEMPLATE NOT FOUND in DB", { clientId, baseModelKey });
  }

  // Garante que todas as colunas do template existam na tabela (fire-and-forget nos erros)
  await ensureTemplateColumns(supabase, leadsTable, template?.data_fields);

  const basePromptText = dynamicPrompt;

  const fieldContext = buildFieldContext(template);
  const baseSystemPrompt = fieldContext
    ? `${basePromptText}\n\n${fieldContext}`
    : basePromptText;

  // ── Cenário 2: lead abandonou no meio — reengajamento após REENGAGEMENT_HOURS ──
  let systemPromptOverride = null;
  if (existing && history.length > 0) {
    const horasInativo = hoursSince(existing.updated_at);
    if (horasInativo >= REENGAGEMENT_HOURS) {
      const ultimaPergunta = history.filter((m) => m.role === "assistant").at(-1)?.content || "";
      systemPromptOverride = `${baseSystemPrompt}

CONTEXTO ESPECIAL — REENGAJAMENTO:
Este lead ficou ${Math.round(horasInativo)}h sem responder. Retomou o contato agora.
Não reinicie a conversa do zero. Retome de forma natural e leve, sem cobrar a ausência.
Última pergunta feita: "${ultimaPergunta.slice(0, 120)}"
Dados já coletados: ${JSON.stringify(storedData)}.
Continue de onde parou, coletando apenas o que ainda falta.`;

      console.log("[chatbot-ai] Reengagement after", Math.round(horasInativo), "hours", { phone: phone.slice(-4) });
    }
  }

  // ── Cenário 3: lead novo ou em andamento — fluxo normal ──────────────────
  const aiResponse = await runChatbotAI({
    systemPrompt: systemPromptOverride || baseSystemPrompt,
    history,
    newMessages: [combinedText],
    existingData: storedData,
  });

  console.log("[chatbot-ai] AI response:", {
    table: leadsTable,
    status: aiResponse.status_conversa,
    classificacao: aiResponse.classificacao,
    finalizado: aiResponse.finalizado,
    msgPreview: aiResponse.mensagem.slice(0, 60),
    phone: phone.slice(-4),
  });

  // Atualizar histórico
  const newHistory = appendToHistory(history, combinedText, aiResponse.mensagem);

  const dadosToSave = normalizeLeadsOutlierDados({
    dados: {
      ...storedData,
      ...aiResponse.dados,
    },
  });

  const payload = {
    client_id: clientId,
    telefone: phone,
    status_conversa: aiResponse.status_conversa,
    status: aiResponse.classificacao,
    spin_fase: aiResponse.spin_fase || null,
    dados: dadosToSave,
    historico: serializeHistorico(newHistory),
    mensagem: aiResponse.mensagem,
    finalizado: aiResponse.finalizado,
    updated_at: new Date().toISOString(),
    // Colunas individuais de todos os campos do template (existência garantida por ensureTemplateColumns)
    ...extractIndividualColumns(dadosToSave, template?.data_fields),
  };

  if (existing?.id) {
    await supabase.from(leadsTable).update(payload).eq("id", existing.id);
  } else {
    await supabase.from(leadsTable).insert([{ ...payload, created_at: new Date().toISOString() }]);
  }

  // Salvar turno em lead_messages (fire-and-forget — não bloqueia resposta)
  const now = new Date().toISOString();
  // Schema real de lead_messages: phone / sender_type / direction / message_text
  // (as colunas lead_phone/role/content da migration 20260516 nunca aplicaram).
  // Convenção canônica do projeto (appendLeadMessage): lead=inbound, bot=outbound.
  const leadMsgs = [
    { client_id: clientId, phone, sender_type: "lead", direction: "inbound", message_text: combinedText, created_at: now },
    { client_id: clientId, phone, sender_type: "bot", direction: "outbound", message_text: aiResponse.mensagem, created_at: now },
  ];
  supabase.from("lead_messages").insert(leadMsgs).then(({ error }) => {
    if (error) console.warn("[chatbot-ai] lead_messages insert error:", error.message);
  });

  // Inclui histórico completo no retorno para o caller usar no briefing SDR
  // sem precisar rebuscar no banco (evita round-trip extra na finalização)
  return { ...aiResponse, _history: newHistory, _dados: dadosToSave };
}
