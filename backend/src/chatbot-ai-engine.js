import {
  resolveLlmLadder,
  defaultLlmModel,
  providerOfModelId,
  classifyLlmHttpError,
  mensagemDeCotaEstourada,
  mensagemDePedidoMaiorQueOTeto,
  dropOnRequestTooLarge,
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
import { findRagContextForQuestion, buildRagContextBlock, DEFAULT_RAG_TRANSFER_MESSAGE } from "./rag/chatSearch.js";
import { toCanonicalPhoneFromJid } from "./services/canonicalPhone.js";
import { gravarUsoLlm } from "./services/llmUsage.js";

/**
 * Chatbot AI Engine
 * Buffer de mensagens + transcrição de mídia + IA conversacional (Groq)
 * Modelo base para todos os tenants — cada empresa tem seu próprio system prompt
 */

// ─── Buffer in-memory ──────────────────────────────────────────────────────
// Map: `${clientId}:${instanceKey}:${canonicalPhone}` → { messages: [], timer, token }
const messageBuffers = new Map();
export { messageBuffers as _messageBuffersForTest };
const BUFFER_DELAY_MS = 3000;

// ─── Configuração de Provedores e Modelos de LLM ────────────────────────────
export const LLM_MODELS = [
  // Gemini / Google — o padrao desde 30/10/2026. So APELIDOS (-latest): apelido
  // nao morre por rotacao de versao. gemini-2.0-flash, 1.5-flash e 1.5-pro
  // estavam aqui como versao fixa, morreram, e o primeiro derrubou o agente.
  { id: "gemini-flash-latest", name: "Gemini Flash (padrão)", provider: "gemini", providerName: "Gemini / Google" },
  { id: "gemini-flash-lite-latest", name: "Gemini Flash Lite", provider: "gemini", providerName: "Gemini / Google" },
  { id: "gemini-pro-latest", name: "Gemini Pro", provider: "gemini", providerName: "Gemini / Google" },

  // Groq — alternativa, nao padrao. Lista real da conta, conferida em
  // /openai/v1/models em 30/10/2026: nenhum modelo de conversa passa de 8.000
  // TPM, e prompt de tenant com RAG estoura esse teto sozinho (HTTP 413).
  // Em agosto os dois Llama ficavam selecionaveis na tela do tenant e derrubavam
  // o agente em producao; groq/compound e qwen3.6 sairam pelo mesmo motivo.
  { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B (Groq)", provider: "groq", providerName: "Groq" },
  { id: "openai/gpt-oss-20b", name: "GPT-OSS 20B (Groq)", provider: "groq", providerName: "Groq" },
  { id: "qwen/qwen3.8-27b", name: "Qwen 3.8 27B (Groq)", provider: "groq", providerName: "Groq" },

  // OpenAI saiu: nao ha chave no servidor (medido em 30/10/2026).

  // Claude / Anthropic
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", provider: "anthropic", providerName: "Claude / Anthropic" },
  { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", provider: "anthropic", providerName: "Claude / Anthropic" },
  { id: "claude-3-opus-20240229", name: "Claude 3 Opus", provider: "anthropic", providerName: "Claude / Anthropic" },
];

export function getLlmProviderStatus() {
  return {
    groq: Boolean(process.env.GROQ_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
  };
}

// Vem da escada configuravel, nao de um nome fixo que o provedor pode aposentar.
export const DEFAULT_LLM_MODEL = defaultLlmModel();

// Modelo salvo pode ter sido descontinuado pelo provedor depois de escolhido.
// Sem isso a chamada seguia com um id morto e falhava no provedor, sem pista.
export function resolveLlmModel(modelId) {
  const normalized = typeof modelId === "string" ? modelId.trim() : "";
  const defaultModel = defaultLlmModel();
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
  return providerOfModelId(modelId);
}

const GROQ_BASE = "https://api.groq.com/openai/v1";
const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";

function groqKey() {
  return process.env.GROQ_API_KEY || "";
}

// Sem timeout, um provedor travado segurava a escada inteira: o proximo degrau
// nunca era tentado.
export const LLM_CALL_TIMEOUT_MS = Number(process.env.LLM_CALL_TIMEOUT_MS || 20000);

// Um adaptador por provedor: so o fetch e a leitura da resposta. Escada, cota e
// diagnostico ficam no laco de callLlmChatCompletion, iguais para todos.
async function postOpenAiCompat(url, apiKey, body, timeoutMs = LLM_CALL_TIMEOUT_MS) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return { ok: false, status: res.status, corpo: await res.text() };
  const data = await res.json();
  return {
    ok: true,
    content: data.choices?.[0]?.message?.content || "",
    finishReason: data.choices?.[0]?.finish_reason ?? null,
    // total_tokens vem da API e NAO e redundante com entrada + saida: no Gemini
    // com thinking, os tokens de raciocinio sao cobrados e ficam fora dos dois.
    // Medido em 30/10/2026 no gemini-flash-latest: prompt 13 + completion 5 = 18,
    // total 129. Somar os dois esconderia 111 tokens faturaveis. Nao "simplificar".
    usage: {
      promptTokens: data.usage?.prompt_tokens ?? null,
      completionTokens: data.usage?.completion_tokens ?? null,
      totalTokens: data.usage?.total_tokens ?? null,
    },
  };
}

// reasoning_effort do Gemini: politica por env, aprendizado por modelo.
//
// Por que "none": LATENCIA, nao custo. Medido em 30/10/2026 no gemini-flash-latest
// respondendo "oi": 3027ms com raciocinio contra 1693ms sem — quase um segundo e
// meio por resposta, e isso o cliente sente no WhatsApp. O total de tokens caiu de
// 129 para 18 ("7x"), mas e ARTEFATO do prompt de 13 tokens: o raciocinio custa uns
// cem tokens fixos, e num prompt real de tenant com RAG a entrada tem milhares —
// la a economia e pequena, talvez desprezivel. Nao decidir nada por esse "7x".
// Se o flash sem raciocinio conversa tao bem quanto com ele e a DT-012.
//
// GEMINI_REASONING_EFFORT: padrao "none"; vazio = nunca manda o parametro.
// Nao ha lista de modelos: quem recusa o parametro (gemini-flash-lite-latest
// devolveu 400 INVALID_ARGUMENT em 30/10/2026) e aprendido no primeiro 400 e
// lembrado pelo resto do processo.
const geminiSemReasoning = new Set();
export function _resetGeminiSemReasoningForTest() {
  geminiSemReasoning.clear();
}

function politicaDeReasoningGemini() {
  return String(process.env.GEMINI_REASONING_EFFORT ?? "none").trim();
}

async function chamarGemini({ apiKey, model, messages, temperature, max_tokens, response_format, timeoutMs }) {
  const url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  const body = { model, messages, temperature, max_tokens };
  if (response_format) body.response_format = response_format;

  const politica = politicaDeReasoningGemini();
  if (!politica || geminiSemReasoning.has(model)) return postOpenAiCompat(url, apiKey, body, timeoutMs);

  const r = await postOpenAiCompat(url, apiKey, { ...body, reasoning_effort: politica }, timeoutMs);
  // Chave invalida tambem volta 400 INVALID_ARGUMENT no Gemini (medido em
  // 30/10/2026): essa vai para CREDENCIAL, nunca vira "modelo recusou o parametro".
  const recusouParametro =
    !r.ok &&
    r.status === 400 &&
    /INVALID_ARGUMENT/.test(String(r.corpo)) &&
    classifyLlmHttpError(r.status, r.corpo).tipo !== "CREDENCIAL";
  if (!recusouParametro) return r;

  const semParametro = await postOpenAiCompat(url, apiKey, body, timeoutMs);
  // So aprende quando a repeticao SEM o parametro da certo: isso prova que ele era
  // a causa. Se falhar de novo, o problema e outro e nada fica lembrado.
  if (semParametro.ok) {
    geminiSemReasoning.add(model);
    console.warn(
      `[chatbot-ai-engine] modelo "${model}" recusou reasoning_effort="${politica}"; seguindo sem ele neste processo.`
    );
  }
  return semParametro;
}

const LLM_PROVIDERS = {
  groq: {
    nome: "Groq",
    chave: () => process.env.GROQ_API_KEY || "",
    chamar: ({ apiKey, model, messages, temperature, max_tokens, response_format, timeoutMs }) => {
      const body = { model, messages, temperature, max_tokens };
      if (response_format) body.response_format = response_format;
      return postOpenAiCompat(`${GROQ_BASE}/chat/completions`, apiKey, body, timeoutMs);
    },
  },
  gemini: {
    nome: "Gemini",
    chave: () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "",
    chamar: chamarGemini,
  },
  openai: {
    nome: "OpenAI",
    chave: () => process.env.OPENAI_API_KEY || "",
    chamar: ({ apiKey, model, messages, temperature, max_tokens, response_format, timeoutMs }) => {
      const body = { model, messages, temperature, max_tokens };
      if (response_format) body.response_format = response_format;
      return postOpenAiCompat("https://api.openai.com/v1/chat/completions", apiKey, body, timeoutMs);
    },
  },
  anthropic: {
    nome: "Anthropic",
    chave: () => process.env.ANTHROPIC_API_KEY || "",
    chamar: async ({ apiKey, model, messages, temperature, max_tokens, timeoutMs = LLM_CALL_TIMEOUT_MS }) => {
      const systemMsg = messages.find((m) => m.role === "system")?.content || "";
      const anthropicMessages = messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model, system: systemMsg, messages: anthropicMessages, max_tokens, temperature }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { ok: false, status: res.status, corpo: await res.text() };
      const data = await res.json();
      const entrada = data.usage?.input_tokens ?? null;
      const saida = data.usage?.output_tokens ?? null;
      return {
        ok: true,
        content: data.content?.[0]?.text || "",
        finishReason: data.stop_reason ?? null,
        usage: {
          promptTokens: entrada,
          completionTokens: saida,
          totalTokens: entrada !== null && saida !== null ? entrada + saida : null,
        },
      };
    },
  },
};

const provedoresSemChaveAvisados = new Set();

/**
 * Tira da escada os ids cujo provedor nao tem chave no servidor. Avisa uma vez
 * por processo e provedor: sem o aviso, faltar a chave do Gemini viraria
 * "o agente roda na Groq" sem ninguem saber.
 */
export function filterLadderByProviderKey(ladder) {
  return ladder.filter((m) => {
    const provider = detectLlmProvider(m);
    if (LLM_PROVIDERS[provider]?.chave()) return true;
    if (!provedoresSemChaveAvisados.has(provider)) {
      provedoresSemChaveAvisados.add(provider);
      console.error(
        `[chatbot-ai-engine] PROVEDOR SEM CHAVE: "${provider}" nao tem chave no servidor; ` +
          `os modelos dele saem da escada (ex.: "${m}").`
      );
    }
    return false;
  });
}

function erroDeCredencial(provedores, ultimoErro) {
  const nomes = [...provedores].join(", ");
  const erro = new Error(
    `Credencial invalida no provedor ${nomes}. A escada de IA seguiu sem ele` +
      `${ultimoErro ? ` e o ultimo degrau tambem falhou (${ultimoErro.message})` : ""}. Troque a chave no EasyPanel.`
  );
  erro.code = "LLM_CREDENTIAL_INVALID";
  erro.provedores = [...provedores];
  return erro;
}

/**
 * Custo de IA por cliente (public.llm_usage). Fire-and-forget: nao espera o
 * banco e NUNCA derruba a resposta — sem a tabela, ou com o banco fora, o
 * agente continua respondendo e so a medicao se perde, com aviso.
 */
function registrarUsoLlm(uso) {
  try {
    gravarUsoLlm(uso).catch((err) => {
      console.warn("[llm-usage] falha ao gravar uso de IA — resposta segue sem medicao:", err?.message || err);
    });
  } catch (err) {
    console.warn("[llm-usage] falha ao gravar uso de IA — resposta segue sem medicao:", err?.message || err);
  }
}

/**
 * contexto (opcional): { clientId, origem, phone } — quem pagou a chamada, para
 * public.llm_usage. Rotulos de origem em services/llmUsage.js. Sem contexto a
 * linha e gravada com dono nulo. tentativasAnteriores e uso interno: chamadas ja
 * feitas por uma escada de fora (runChatbotAI) antes desta.
 */
export async function callLlmChatCompletion({
  model = defaultLlmModel(),
  messages = [],
  temperature = 0.4,
  max_tokens = 600,
  response_format = null,
  singleModelOnly = false,
  contexto = null,
  // Teto de espera por chamada. A visao usa o seu (IMAGE_DESCRIPTION_TIMEOUT_MS).
  timeoutMs = LLM_CALL_TIMEOUT_MS,
}) {
  const chosenModel = model || defaultLlmModel();

  // Escada vinda de services/llmModels.js — configuravel por LLM_MODEL_LADDER,
  // com os modelos descontinuados descartados antes de gastar uma chamada neles
  // e cada degrau roteado pelo provedor do proprio id.
  const escadaConfigurada = singleModelOnly ? [chosenModel] : resolveLlmLadder(chosenModel);
  let modelsToTry = filterLadderByProviderKey(escadaConfigurada);
  let lastError = null;
  let ultimaCota = null;
  const credenciaisQuebradas = new Set();

  // Escada vazia significa que nenhum modelo configurado esta vivo E tem chave.
  // Sem esta guarda o laco nao roda, lastError fica null e a funcao devolveria
  // undefined — silencio, que e o pior desfecho possivel aqui.
  if (modelsToTry.length === 0) {
    throw new Error(
      "Nenhum modelo utilizavel: os configurados foram descontinuados ou o provedor deles nao tem chave. " +
        `Ajuste LLM_MODEL_LADDER (pedido: "${escadaConfigurada.join(", ")}").`
    );
  }

  let cursor = 0;
  while (cursor < modelsToTry.length) {
    const m = modelsToTry[cursor];
    cursor++;
    const provider = detectLlmProvider(m);
    const adaptador = LLM_PROVIDERS[provider];

    let r;
    const inicioMs = Date.now();
    try {
      r = await adaptador.chamar({
        apiKey: adaptador.chave(),
        model: m,
        messages,
        temperature,
        max_tokens,
        response_format,
        timeoutMs,
      });
    } catch (err) {
      // Timeout ou rede: o provedor nao respondeu. O proximo degrau pode estar de pe.
      const motivo = err?.name === "TimeoutError" || err?.name === "AbortError"
        ? `timeout de ${timeoutMs}ms`
        : err?.message || String(err);
      lastError = new Error(`${adaptador.nome} sem resposta no modelo "${m}": ${motivo}`);
      console.warn(`[chatbot-ai-engine] PROVEDOR INDISPONIVEL: ${lastError.message}. Tentando o proximo.`);
      continue;
    }

    if (r.ok) {
      // So a tentativa que deu certo consome token faturavel; as queimadas antes
      // dela entram em "tentativas", que mede o desperdicio da escada.
      registrarUsoLlm({
        clientId: contexto?.clientId ?? null,
        origem: contexto?.origem ?? null,
        phone: contexto?.phone ?? null,
        provider,
        model: m,
        promptTokens: r.usage?.promptTokens,
        completionTokens: r.usage?.completionTokens,
        totalTokens: r.usage?.totalTokens,
        finishReason: r.finishReason,
        latencyMs: Date.now() - inicioMs,
        tentativas: (contexto?.tentativasAnteriores || 0) + cursor,
      });
      return r.content;
    }

    lastError = new Error(`${adaptador.nome} HTTP ${r.status}: ${String(r.corpo).slice(0, 200)}`);

    // 404 (modelo morto) e 429 (cota estourada) sao problemas diferentes e sairam
    // do mesmo jeito no log durante toda a investigacao: "indisponivel ou limite
    // de taxa". Um se resolve trocando a lista, o outro pagando plano ou
    // espalhando a carga. Agora cada um diz o que e.
    const diagnostico = classifyLlmHttpError(r.status, r.corpo);

    if (diagnostico.tipo === "PEDIDO_GRANDE_DEMAIS") {
      ultimaCota = { modelo: m, ...diagnostico };
      console.warn(
        `[chatbot-ai-engine] PEDIDO MAIOR QUE O TETO do modelo "${m}" (HTTP 413` +
          `${diagnostico.limiteTpm ? `, limite ${diagnostico.limiteTpm} TPM` : ""}). ` +
          "Pulando os modelos do mesmo provedor com teto igual ou menor."
      );
      modelsToTry = [...modelsToTry.slice(0, cursor), ...dropOnRequestTooLarge(m, modelsToTry.slice(cursor))];
      continue;
    }

    if (diagnostico.tipo === "COTA_ESTOURADA") {
      ultimaCota = { modelo: m, ...diagnostico };
      console.warn(
        `[chatbot-ai-engine] COTA ESTOURADA no modelo "${m}" (HTTP ${r.status})` +
          `${diagnostico.limiteTpm ? ` — teto ${diagnostico.limiteTpm} TPM, usados ${diagnostico.usadoTpm ?? "?"}` : ""}` +
          `${diagnostico.esperarSegundos ? `, libera em ~${diagnostico.esperarSegundos}s` : ""}. Tentando o proximo.`
      );
      continue;
    }

    if (diagnostico.tipo === "MODELO_INEXISTENTE") {
      console.error(
        `[chatbot-ai-engine] MODELO INEXISTENTE: "${m}" (HTTP ${r.status}). ` +
          `O provedor descontinuou este modelo. Atualize LLM_MODEL_LADDER ou o modelo do tenant — ` +
          `enquanto ele estiver na lista, toda chamada perde uma ida de rede aqui.`
      );
      continue;
    }

    if (diagnostico.tipo === "CREDENCIAL") {
      // Troca de modelo nao resolve, mas outro provedor resolve. O que nao pode
      // e virar silencio: a chave quebrada precisa aparecer no log e no erro final.
      credenciaisQuebradas.add(provider);
      console.error(
        `[chatbot-ai-engine] CREDENCIAL INVALIDA no provedor "${provider}" (HTTP ${r.status}, modelo "${m}"). ` +
          "Todos os modelos dele saem desta escada. Troque a chave no EasyPanel."
      );
      modelsToTry = [
        ...modelsToTry.slice(0, cursor),
        ...modelsToTry.slice(cursor).filter((x) => detectLlmProvider(x) !== provider),
      ];
      continue;
    }

    if (diagnostico.tipo === "CONTRATO_JSON" && response_format) {
      console.warn(`[chatbot-ai-engine] ${adaptador.nome} recusou response_format estrito no modelo "${m}". Reexecutando em modo de texto com extração de JSON resiliente...`);
      try {
        return await callLlmChatCompletion({
          model: m,
          messages,
          temperature,
          max_tokens,
          response_format: null,
          singleModelOnly: true,
          timeoutMs,
          contexto: { ...contexto, tentativasAnteriores: (contexto?.tentativasAnteriores || 0) + cursor },
        });
      } catch (err) {
        lastError = err;
        continue;
      }
    }

    if (diagnostico.tentarProximo) {
      console.warn(`[chatbot-ai-engine] ${adaptador.nome} recusou o modelo "${m}" (HTTP ${r.status}, ${diagnostico.tipo}). Tentando o proximo.`);
      continue;
    }

    throw lastError;
  }

  // Credencial quebrada vence qualquer outra explicacao: e a unica causa que o
  // dono resolve sozinho, e esconde-la atras de "cota" faria ele subir plano
  // de um provedor que nem estava sendo chamado.
  if (credenciaisQuebradas.size > 0) {
    throw erroDeCredencial(credenciaisQuebradas, lastError);
  }

  // Todos os modelos da escada estouraram a cota: o erro final precisa dizer
  // "sua cota de IA acabou", nao um generico. E informacao de negocio — o dono
  // decide se esta na hora de subir o plano.
  if (ultimaCota) {
    // O 413 nao e cota acabando: e o pedido maior que o teto do modelo. A frase
    // errada ja fez cacar cota por tres camadas quando o problema era o tamanho
    // do prompt. O code fica o mesmo para a tela continuar funcionando.
    const erroDeCota = new Error(
      ultimaCota.tipo === "PEDIDO_GRANDE_DEMAIS"
        ? mensagemDePedidoMaiorQueOTeto(ultimaCota)
        : mensagemDeCotaEstourada(ultimaCota)
    );
    erroDeCota.code = "LLM_QUOTA_EXCEEDED";
    erroDeCota.modelo = ultimaCota.modelo;
    erroDeCota.limiteTpm = ultimaCota.limiteTpm ?? null;
    erroDeCota.usadoTpm = ultimaCota.usadoTpm ?? null;
    erroDeCota.esperarSegundos = ultimaCota.esperarSegundos ?? null;
    throw erroDeCota;
  }

  throw lastError || new Error("Falha ao consultar os modelos de IA disponíveis");
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
 *
 * Chave de buffer isolada por chip e telefone canônico:
 * `${clientId}:${instancia}:${telefoneCanonico}`
 * - O telefone é canonicalizado via toCanonicalPhoneFromJid (remove @s.whatsapp.net/@c.us
 *   e normaliza formato brasileiro; @g.us e @lid são preservados).
 * - A instância é o nome técnico resolvido (canonicalName) ou marcador explícito "sem-instancia".
 */
export function bufferMessage(clientId, phone, messageData, onProcess, instanceName = null) {
  const canonicalPhone = toCanonicalPhoneFromJid(phone);
  const rawInstance = (
    instanceName ||
    messageData?.instanceName ||
    messageData?.instance ||
    ""
  );
  const normalizedInstance = typeof rawInstance === "string" ? rawInstance.trim() : "";
  const instanceKey = normalizedInstance || "sem-instancia";
  const key = `${clientId}:${instanceKey}:${canonicalPhone}`;
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
  if (msg.documentMessage || msg.documentWithCaptionMessage) return "document";
  if (msg.stickerMessage) return "sticker";
  if (msg.reactionMessage) return "reaction";
  if (
    msg.buttonsResponseMessage ||
    msg.templateButtonReplyMessage ||
    msg.listResponseMessage ||
    msg.interactiveResponseMessage
  ) {
    return "interactive";
  }
  if (msg.conversation || msg.extendedTextMessage) return "text";

  // fallback: se tem texto no body diretamente
  const directText = evolutionBody?.message || evolutionBody?.text || evolutionBody?.body;
  if (directText && typeof directText === "string" && directText.trim().toLowerCase() !== "unknown") return "text";

  return "text";
}

export function extractTextFromBody(evolutionBody) {
  const msg = evolutionBody?.data?.message || evolutionBody?.message || {};

  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text;
  if (msg.conversation) return msg.conversation;

  // Interações e botões
  if (msg.buttonsResponseMessage?.selectedDisplayText) return msg.buttonsResponseMessage.selectedDisplayText;
  if (msg.buttonsResponseMessage?.selectedButtonId) return msg.buttonsResponseMessage.selectedButtonId;
  if (msg.templateButtonReplyMessage?.selectedDisplayText) return msg.templateButtonReplyMessage.selectedDisplayText;
  if (msg.listResponseMessage?.title) {
    return msg.listResponseMessage.description
      ? `${msg.listResponseMessage.title} - ${msg.listResponseMessage.description}`
      : msg.listResponseMessage.title;
  }
  if (msg.listResponseMessage?.description) return msg.listResponseMessage.description;
  if (msg.listResponseMessage?.singleSelectReply?.selectedRowId) {
    return msg.listResponseMessage.singleSelectReply.selectedRowId;
  }
  if (msg.interactiveResponseMessage?.body?.text) return msg.interactiveResponseMessage.body.text;

  // Mídias
  if (msg.imageMessage) {
    return msg.imageMessage.caption || "[Imagem]";
  }
  if (msg.videoMessage) {
    return msg.videoMessage.caption || "[Vídeo]";
  }
  if (msg.audioMessage || msg.pttMessage) {
    return "[Áudio]";
  }
  if (msg.documentMessage || msg.documentWithCaptionMessage) {
    const doc = msg.documentMessage || msg.documentWithCaptionMessage?.message?.documentMessage;
    return doc?.fileName || doc?.caption || "[Documento]";
  }
  if (msg.stickerMessage) {
    return "[Sticker]";
  }
  if (msg.reactionMessage) {
    return msg.reactionMessage.text || "[Reação]";
  }

  const directText = evolutionBody?.message || evolutionBody?.text || evolutionBody?.body;
  if (typeof directText === "string" && directText.trim() && directText.trim().toLowerCase() !== "unknown") {
    return directText.trim();
  }

  return "[Mensagem]";
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

// ─── Descrição de imagem (visão) ─────────────────────────────────────────────

export const IMAGE_DESCRIPTION_TIMEOUT_MS = Number(process.env.IMAGE_DESCRIPTION_TIMEOUT_MS || 10000);

// A visao passa pela mesma escada do motor: roteamento por provedor, credencial
// com log proprio, timeout e medicao em llm_usage. Antes ela postava direto na
// Groq com meta-llama/llama-4-scout-17b-16e-instruct como padrao — modelo morto,
// e GROQ_VISION_MODEL nunca foi setada (medido em 30/10/2026): a leitura de imagem
// estava quebrada desde 22/10. Apelido do Gemini, como a conversa: nao morre por
// rotacao de versao.
function llmVisionModel() {
  return String(process.env.LLM_VISION_MODEL || "").trim() || "gemini-flash-latest";
}

export async function describeImage(base64Data, mimetype = "image/jpeg", caption = "", contexto = null) {
  const modelo = llmVisionModel();
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

    const content = await callLlmChatCompletion({
      model: modelo,
      messages: [{ role: "user", content: userContent }],
      max_tokens: 200,
      // Um modelo so: o resto da escada de conversa (Groq gpt-oss) nao le imagem.
      singleModelOnly: true,
      timeoutMs: IMAGE_DESCRIPTION_TIMEOUT_MS,
      contexto: { ...contexto, origem: "visao" },
    });

    const durationMs = Date.now() - startMs;
    if (content) {
      console.log(`[chatbot-ai] Image described in ${durationMs}ms:`, content.slice(0, 80));
    }
    return content || null;
  } catch (err) {
    // Falha na leitura nao derruba a mensagem: o caller cai para legenda/[imagem].
    console.error(
      `[chatbot-ai] describeImage falhou (${Date.now() - startMs}ms, modelo "${modelo}"):`,
      err?.message || err
    );
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

  const rawMsg = evolutionBody?.data?.message || evolutionBody?.message || {};
  const imageMsg = rawMsg.imageMessage;
  const mediaUrl = imageMsg?.url || evolutionBody?.data?.mediaUrl || evolutionBody?.mediaUrl || null;

  if (type === "interactive") {
    const text = extractTextFromBody(evolutionBody) || "[Interação]";
    return { type, text, waMessageId, messageTimestamp, mediaPath: null };
  }

  if (type === "text") {
    const rawText = extractTextFromBody(evolutionBody) || "";
    const text = (!rawText || rawText.trim().toLowerCase() === "unknown") ? "[Mensagem]" : rawText;
    return { type, text, waMessageId, messageTimestamp };
  }

  // Se for grupo ou outbound (fromMe), descarta antes de puxar: evita custos e banda desnecessários
  const rawRemoteJid = evolutionBody?.data?.key?.remoteJid ?? evolutionBody?.remoteJid ?? evolutionBody?.senderJid ?? evolutionBody?.data?.key?.participant ?? null;
  const isGroup = forcedIsGroup !== null ? Boolean(forcedIsGroup) : isGroupJid(rawRemoteJid);
  const fromMe = forcedFromMe !== null ? Boolean(forcedFromMe) : isFromMe(evolutionBody);

  // Decisão de produto (Conrado): figurinha fica fora do storage por decisão explícita de produto, e não por esquecimento (mediaPath: null intencional).
  if (type === "sticker") return { type, text: "[sticker]", waMessageId, messageTimestamp, mediaPath: null };
  if (type === "reaction") return { type, text: "[reação]", waMessageId, messageTimestamp };
  if (type === "video") {
    const text = rawMsg.videoMessage?.caption || caption ? `[vídeo] ${rawMsg.videoMessage?.caption || caption}` : "[vídeo]";
    return { type, text, contentType: "video", content_type: "video", waMessageId, messageTimestamp };
  }
  if (type === "document") {
    const doc = rawMsg.documentMessage || rawMsg.documentWithCaptionMessage?.message?.documentMessage;
    const name = doc?.fileName || doc?.caption || "documento";
    return { type, text: name.startsWith("[") ? name : `[documento: ${name}]`, contentType: "document", content_type: "document", waMessageId, messageTimestamp };
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
        return {
          type,
          text: transcription,
          displayLabel: transcription,
          contentType: "audio",
          content_type: "audio",
          transcribed: true,
          transcriptionFailed: false,
          waMessageId,
          messageTimestamp,
          mediaPath,
        };
      }
    }
    return {
      type,
      text: "[áudio]",
      displayLabel: "[áudio]",
      contentType: "audio",
      content_type: "audio",
      transcribed: false,
      transcriptionFailed: true,
      waMessageId,
      messageTimestamp,
      mediaPath,
    };
  }

  if (type === "image") {
    const effectiveMime = mimetype || "image/jpeg";
    if (mediaBase64 && !isGroup && !fromMe) {
      const description = await describeImage(mediaBase64, effectiveMime, caption, { clientId });
      if (description) {
        return {
          type,
          text: `[imagem: ${description}]${caption ? ` — legenda: "${caption}"` : ""}`,
          contentType: "image",
          content_type: "image",
          mediaUrl,
          media_url: mediaUrl,
          described: true,
          waMessageId,
          messageTimestamp,
          mediaPath,
        };
      }
    }
    const text = caption || "[Imagem]";
    return {
      type,
      text,
      contentType: "image",
      content_type: "image",
      mediaUrl,
      media_url: mediaUrl,
      described: false,
      waMessageId,
      messageTimestamp,
      mediaPath,
    };
  }

  const fallbackText = extractTextFromBody(evolutionBody);
  const safeText = (!fallbackText || fallbackText.trim().toLowerCase() === "unknown")
    ? (type ? `[${type}]` : "[Mensagem]")
    : fallbackText;
  return {
    type: type && type !== "unknown" ? type : "text",
    text: safeText,
    waMessageId,
    messageTimestamp,
    mediaPath,
  };
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
  "motivo_nao_comercial": "string curta — motivo quando nao_comercial for true (ex: 'pedido de comida', 'conversa pessoal', 'engano'), ou null",
  "precisa_humano": true | false,
  "objecao_detectada": "string curta com a objeção nas palavras do lead, ou null"
}

COMO RESPONDER QUANDO APARECE OBJEÇÃO:
• Objeção aqui é quando a pessoa sinaliza recuo sem dizer não: "vou pensar", "tá caro", "vou ver com meu sócio", "depois eu te chamo", "só queria saber o preço".
• O agente deve fazer o seguinte, nesta ordem:
  1. Primeiro, uma pergunta de volta, uma só, curta, sem julgamento, para descobrir o que está por trás. "Vou pensar" vira "claro — o que ficou faltando pra você decidir?". "Tá caro" vira "entendi — caro em relação a quê?". A pergunta é sobre a informação que falta, nunca sobre o compromisso da pessoa.
  2. Depois, com a resposta dela, responder usando as palavras que ela mesma usou, não um argumento genérico do produto.
• TRAVA OBRIGATÓRIA: se a pessoa repetir a objeção ou não responder à pergunta, o agente para de perguntar. Marca precisa_humano: true e encerra com naturalidade. Sem segunda tentativa, sem reformular a pergunta, sem insistir. Robô que insiste em desconhecido no WhatsApp é bloqueado e denunciado.
• Regra literal da trava: uma pergunta por objeção, nunca duas.
• Se houver objeção detectada, preencha o campo "objecao_detectada" com uma string curta com a objeção nas palavras do lead (ex: "vou pensar", "tá caro"). Se não houver objeção, preencha com null.

VOCABULÁRIO PROIBIDO:
• O agente nunca escreve nenhuma destas, nem variação delas:
  - "Faz sentido?"
  - "Você acredita que isso serve pra você?"
  - "Você vê valor nisso?"
  - "Acha que vale a pena?"
  - "Concorda comigo?"
  - "Isso é interessante pra você?"
• Todas pedem permissão e convidam ao não. No lugar, use verificação de clareza, que confirma entendimento sem pedir aprovação: "ficou claro como isso resolve o que você falou do X?", "consegui explicar como a gente chega nesse resultado?".

PREÇO PERGUNTADO LOGO DE CARA:
• A regra é mandar o preço e perguntar junto para quando a pessoa está pensando em resolver. Não segure preço para forçar conversa — no WhatsApp isso faz a pessoa sumir, ao contrário de uma reunião marcada.
• Se o prompt da empresa orientar a não informar preço, a instrução da empresa vence. Nesse caso o agente não inventa desculpa: diz que quem passa o valor é um consultor, pergunta para quando a pessoa está pensando em resolver, e marca precisa_humano: true.

BASE DE CONHECIMENTO (QUANDO HOUVER UM BLOCO "BASE DE CONHECIMENTO" ANEXADO ABAIXO NESTE PROMPT):
• Responda a pergunta do lead SOMENTE com o que estiver naquele bloco. Não complete com conhecimento geral, não invente, não "ache que sabe".
• Se a resposta não estiver lá, marque "precisa_humano": true e escreva em "mensagem" uma frase curta e natural avisando que vai chamar um especialista (ex.: "${DEFAULT_RAG_TRANSFER_MESSAGE}") — no seu tom de voz, sem citar "documento" ou "trecho".
• Saudação, agradecimento ou mensagem sem pergunta factual NÃO aciona esta regra, com ou sem bloco anexado — continue a conversa normalmente.
• Fora desse cenário (sem bloco de Base de Conhecimento anexado — não achou trecho relevante para esta mensagem, ou o tenant não tem base configurada), "precisa_humano" fica false — isso não muda em nada como você atende hoje.

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

export async function fetchDynamicPrompt(supabase, clientId, type) {
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
export async function extractBriefingWithAI({
  supabase,
  clientId,
  phone,
  history,
  collectedData,
  classificacao,
  llmModel = defaultLlmModel(),
  agentConfig = null,
  customPrompt = null,
  extractionEnabled = true,
}) {
  // Se a extração estiver desligada pelo agente (ou parâmetro), não chama a IA
  if (extractionEnabled === false || agentConfig?.extractionEnabled === false) {
    return null;
  }

  // Prioridade: prompt customizado do agente -> prompt "extrato" configurado no tenant
  const extractPrompt =
    customPrompt ||
    agentConfig?.extractionPrompt ||
    (await fetchDynamicPrompt(supabase, clientId, "extrato"));
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

export async function runChatbotAI({
  systemPrompt,
  history,
  newMessages,
  existingData,
  llmModel = defaultLlmModel(),
  contexto = null,
}) {
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

  let modelsToTry = filterLadderByProviderKey(resolveLlmLadder(llmModel));
  if (!modelsToTry || modelsToTry.length === 0) {
    modelsToTry = [defaultLlmModel()];
  }

  let finalResposta = null;
  let lastError = null;
  const credenciaisQuebradas = new Set();
  let chamadasFeitas = 0;

  for (let i = 0; i < modelsToTry.length; i++) {
    const currentModel = modelsToTry[i];
    if (credenciaisQuebradas.has(detectLlmProvider(currentModel))) continue;
    try {
      const tentativasAnteriores = chamadasFeitas;
      chamadasFeitas++;
      const raw = await callLlmChatCompletion({
        model: currentModel,
        messages,
        temperature: 0.4,
        max_tokens: 600,
        singleModelOnly: true,
        contexto: { ...contexto, tentativasAnteriores },
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
      if (err?.code === "LLM_CREDENTIAL_INVALID") {
        for (const p of err.provedores || []) credenciaisQuebradas.add(p);
      }
      lastError = err;
    }
  }

  if (!finalResposta || !String(finalResposta.mensagem || "").trim()) {
    console.error("[chatbot-ai] TODOS OS MODELOS DA ESCADA FALHARAM EM PRODUZIR JSON VÁLIDO. Resposta silenciada para proteger o lead.", {
      modelosTentados: modelsToTry,
      // Chave quebrada e a causa que o dono resolve sozinho: nomeada aqui mesmo
      // quando o ultimo degrau falhou por outro motivo.
      ...(credenciaisQuebradas.size > 0
        ? { credencialInvalida: `credencial invalida no provedor ${[...credenciaisQuebradas].join(", ")}` }
        : {}),
      lastError: lastError?.message,
    });
    return {
      mensagem: "",
      mensagemAusente: true,
      contratoQuebrado: true,
      falhaIa: diagnosticarFalhaDaEscada(credenciaisQuebradas, lastError),
      status_conversa: "aguardando_usuario",
      dados: {},
      classificacao: null,
      finalizado: false,
      spin_fase: null,
      objecao_detectada: null,
    };
  }

  // A resposta saiu, mas de outro provedor: a chave quebrada nao pode ficar
  // escondida atras de uma conversa que parece saudavel.
  if (credenciaisQuebradas.size > 0) {
    finalResposta._credenciaisQuebradas = [...credenciaisQuebradas];
  }
  return finalResposta;
}

/**
 * Por que a escada inteira falhou, em forma que a tela entende. Credencial vence
 * cota pelo mesmo motivo do erro final de callLlmChatCompletion: e a causa que o
 * dono resolve sozinho. Sem diagnostico, null — a tela fica com o texto que ja tem.
 */
function diagnosticarFalhaDaEscada(credenciaisQuebradas, lastError) {
  if (credenciaisQuebradas.size > 0) {
    const provedores = [...credenciaisQuebradas];
    return {
      code: "LLM_CREDENTIAL_INVALID",
      provedores,
      mensagem:
        `Credencial invalida no provedor ${provedores.join(", ")}. ` +
        "A escada seguiu sem ele e os outros degraus tambem falharam. Troque a chave no EasyPanel.",
    };
  }
  if (lastError?.code === "LLM_QUOTA_EXCEEDED") {
    return {
      code: "LLM_QUOTA_EXCEEDED",
      mensagem: lastError.message,
      modelo: lastError.modelo ?? null,
      limiteTpm: lastError.limiteTpm ?? null,
      usadoTpm: lastError.usadoTpm ?? null,
      esperarSegundos: lastError.esperarSegundos ?? null,
    };
  }
  return null;
}

const VALID_SPIN_FASES = new Set(["situacao", "problema", "implicacao", "necessidade"]);

function extractValidClassificacao(val) {
  if (!val) return null;
  const s = String(val).toUpperCase().trim();
  return LEADS_OUTLIER_TEMPERATURE.has(s) ? s : null;
}

export function normalizeObjecaoDetectada(val) {
  if (typeof val !== "string") return null;
  const trimmed = val.trim();
  return trimmed.length > 0 ? trimmed : null;
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
      objecao_detectada: null,
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
        precisa_humano: raw.precisa_humano === true,
        objecao_detectada: normalizeObjecaoDetectada(raw.objecao_detectada),
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
      precisa_humano: raw.precisa_humano === true,
      objecao_detectada: normalizeObjecaoDetectada(raw.objecao_detectada),
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
          precisa_humano: parsed.precisa_humano === true,
          objecao_detectada: normalizeObjecaoDetectada(parsed.objecao_detectada),
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
        precisa_humano: parsed.precisa_humano === true,
        motivo_nao_comercial:
          parsed.nao_comercial === true && typeof parsed.motivo_nao_comercial === "string"
            ? parsed.motivo_nao_comercial.trim().slice(0, 150)
            : null,
        objecao_detectada: normalizeObjecaoDetectada(parsed.objecao_detectada),
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
      precisa_humano: false,
      objecao_detectada: null,
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
    precisa_humano: false,
    objecao_detectada: null,
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

export function isSystemPlaceholderOrMediaMarker(text) {
  if (!text || typeof text !== "string") return false;
  const t = text.trim().toLowerCase();
  return /^\[(áudio|audio|imagem|image|vídeo|video|sticker|figurinha|documento|document|reação|reaction|contato|contact|localização|location).*\]$/i.test(t);
}

/**
 * Freio contra loop com menus/bots automáticos:
 * Se as últimas `threshold` mensagens recebidas de um mesmo contato forem idênticas,
 * detecta loop para parar o ciclo infinito sem gastar chamadas de IA.
 * Ignora estritamente marcadores de sistema e placeholders de mídia ([áudio], [imagem], etc.).
 */
export function checkBotLoop(storedHistorico = [], currentIncomingText = "", threshold = 3) {
  if (!currentIncomingText || !currentIncomingText.trim()) {
    return { isLoop: false, count: 0, reason: null };
  }

  // Placeholders de mídia/sistema nunca contam como repetição de menu de bot
  if (isSystemPlaceholderOrMediaMarker(currentIncomingText)) {
    return { isLoop: false, count: 0, reason: null };
  }

  const normalizedIncoming = currentIncomingText.trim().toLowerCase();

  const userHistory = (storedHistorico || [])
    .filter((h) => h && h.role === "user" && typeof h.content === "string")
    .map((h) => h.content.trim().toLowerCase())
    .filter((content) => !isSystemPlaceholderOrMediaMarker(content));

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
  companyId = null,
  instructionsConsolidated = false,
  isSimulation = false,
  noPersist = false,
  simulationState = null,
  // Opcional. Quando a IA falha no turno, processBatch devolve null (contrato de
  // sempre); quem quer saber POR QUE passa este objeto e recebe aqui a causa.
  diagnosticoIa = null,
}) {
  // Simulador ("Testar antes de soltar"): a memória da conversa vem do
  // chamador ({ historico, dados }) e nada é lido nem gravado na tabela leads.
  // Antes o teste vivia no lead de telefone fixo 5500000000000 (fantasma no
  // Banco, igual para todos os agentes e usuários do tenant).
  const memoriaDaTela = simulationState && Array.isArray(simulationState.historico) ? simulationState : null;
  if (memoriaDaTela) {
    isSimulation = true;
    noPersist = true;
  }

  const tenantSettings = await getLeadClientN8nSettings(clientId).catch(() => null);
  const effectivePersonaModel = model || tenantSettings?.chatbot_model || "generico";
  let activeLlmModel = resolveLlmModel(llmModel || tenantSettings?.chatbot_llm_model);

  const modelConfig = getChatbotModel(effectivePersonaModel);
  const leadsTable = chatbotLeadsTable(clientId);

  // Carregar estado atual do banco (ou da tela, no simulador). updated_at = agora
  // porque o teste é ao vivo: sem ele a conversa cairia no "reengajamento".
  const { data: existingArray } = memoriaDaTela
    ? { data: [{ historico: memoriaDaTela.historico, dados: memoriaDaTela.dados || {}, updated_at: new Date().toISOString() }] }
    : await supabase
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

  // Combinar textos válidos do batch (excluindo marcadores de áudio não transcrito)
  const validTexts = (messages || [])
    .filter((m) => {
      if (!m?.text) return false;
      // Se for áudio não transcrito / com falha, NÃO alimenta a LLM como texto digitado
      if (m.type === "audio" && (m.transcribed === false || m.transcriptionFailed === true || m.text === "[áudio]")) {
        return false;
      }
      return true;
    })
    .map((m) => (typeof m.text === "string" ? m.text.trim() : ""))
    .filter(Boolean);

  const combinedText = validTexts.join("\n").trim();
  const hasFailedAudioOnly = (messages || []).some((m) => m.type === "audio" && (m.transcribed === false || m.transcriptionFailed === true || m.text === "[áudio]")) && !combinedText;

  // Se o lead enviou apenas áudio que não pôde ser transcrito (falha de download ou áudio inaudível):
  if (hasFailedAudioOnly) {
    const dadosAntigos = existing?.dados || {};
    const audioWarnedAt = dadosAntigos.audio_unclear_warned_at || null;
    const storedHistorico = parseStoredHistorico(existing?.historico) || parseStoredHistorico(existing?.dados?.historico);
    const history = buildHistory(storedHistorico);

    // Se já avisou uma vez nesta conversa sobre áudio incompreendido, o robô NÃO responde de novo
    // para evitar parecer robô quebrado e queimar cota do chip.
    // Apenas registra [áudio não compreendido] no histórico para o operador ver na tela.
    if (audioWarnedAt) {
      console.log("[chatbot-ai] Áudio inaudível recebido, mas lead já foi avisado anteriormente nesta conversa. Silenciando resposta automática.", {
        clientId,
        phone: maskPhoneForLog(phone),
      });

      if (existing?.id && !isSimulation && !noPersist) {
        const newHistory = [...history, { role: "user", content: "[áudio não compreendido]" }];
        const audioFailCount = (dadosAntigos.audio_fail_count || 1) + 1;
        await supabase
          .from(leadsTable)
          .update({
            historico: serializeHistorico(newHistory),
            dados: {
              ...dadosAntigos,
              audio_fail_count: audioFailCount,
              audio_last_failed_at: new Date().toISOString(),
            },
            status_conversa: "em_atendimento",
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .eq("client_id", clientId);
      }

      return {
        mensagem: null,
        status_conversa: "em_atendimento",
        dados: existing?.dados || {},
        lead_source: existing?.lead_source || null,
        classificacao: existing?.status || null,
        finalizado: false,
        audioTranscriptionFailed: true,
        silencedRepeatedAudioWarning: true,
      };
    }

    // Primeira vez: envia o aviso explicativo e grava audio_unclear_warned_at em dados
    console.warn("[chatbot-ai] Áudio recebido não pôde ser transcrito. Enviando resposta explicativa ao lead.", {
      clientId,
      phone: maskPhoneForLog(phone),
    });

    const audioUnclearMsg = "Recebi seu áudio, mas infelizmente não consegui ouvi-lo com clareza. Poderia me enviar por texto ou tentar mandar novamente?";

    if (existing?.id && !isSimulation && !noPersist) {
      const newHistory = appendToHistory(history, "[áudio não compreendido]", audioUnclearMsg);
      await supabase
        .from(leadsTable)
        .update({
          historico: serializeHistorico(newHistory),
          dados: {
            ...dadosAntigos,
            audio_unclear_warned_at: new Date().toISOString(),
            audio_fail_count: 1,
            audio_last_failed_at: new Date().toISOString(),
          },
          status_conversa: "em_atendimento",
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("client_id", clientId);
    }

    return {
      mensagem: audioUnclearMsg,
      status_conversa: "em_atendimento",
      dados: {
        ...dadosAntigos,
        audio_unclear_warned_at: new Date().toISOString(),
      },
      lead_source: existing?.lead_source || null,
      classificacao: existing?.status || null,
      finalizado: false,
      audioTranscriptionFailed: true,
    };
  }

  if (!combinedText) {
    console.log("[chatbot-ai] Empty batch, skipping");
    return null;
  }

  // ── Cenário 1: lead já finalizado voltou a contatar ──────────────────────
  //
  // O aviso de recontato sai UMA vez. Da segunda mensagem em diante a conversa
  // REABRE e o lead volta ao atendimento normal.
  let isPrimeiroRecontato = false;
  if (existing?.finalizado && !isSimulation && !noPersist) {
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

    if (existing?.id && !isSimulation && !noPersist) {
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

  // Agente consolidado ("Um agente, um dono para cada texto", Commit 2): ignora
  // template e prompt padrão do tenant — nem busca. O roteiro de campanha
  // continua sendo buscado normalmente: é um eixo diferente (a oferta DESTE
  // disparo), não "o que instrui a conversa por padrão", e continua entrando
  // como camada sobre o agente mesmo depois de consolidado.
  const [dynamicPrompt, campaignPrompt, template] = await Promise.all([
    instructionsConsolidated ? Promise.resolve(null) : fetchDynamicPrompt(supabase, clientId, promptType),
    campaignPromptId ? fetchCampaignPromptById(supabase, campaignPromptId) : Promise.resolve(null),
    instructionsConsolidated ? Promise.resolve(null) : fetchTemplate(supabase, clientId, baseModelKey),
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
  if (!template && !instructionsConsolidated) {
    console.warn("[chatbot-ai] TEMPLATE NOT FOUND in DB", { clientId, baseModelKey });
  }

  // Garante que todas as colunas do template existam na tabela (fire-and-forget nos erros)
  if (!isSimulation && !noPersist) {
    await ensureTemplateColumns(supabase, leadsTable, template?.data_fields);
  }

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

  // ── Base de Conhecimento RAG (Etapa 5, Leva 2, Commit 3) ──────────────────
  // Roda ANTES de montar o prompt final. Tenant/agente sem nenhum documento
  // pronto: applies=false — zero mudança de comportamento, nem embedding é
  // gerado (checagem de contagem é a única query extra). Falha na busca
  // (rede/banco) não pode travar o atendimento: cai pro fluxo de hoje, sem
  // RAG neste turno.
  //
  // AUSÊNCIA DE TRECHO NÃO É "NÃO SEI" — é só "esta mensagem não bateu com
  // nada da base". "Bom dia", "obrigado", "oi" nunca batem com nada, e não são
  // perguntas sobre o negócio: transferir esses turnos sem chamar o modelo
  // quebraria o agente assim que qualquer PDF fosse indexado. A regra dura
  // ("responda só com o que está aqui, senão marque precisa_humano") só se
  // aplica quando HÁ trecho — aí sim entra o bloco de contexto e o prompt
  // (buildJsonInstruction) já instrui o modelo a marcar precisa_humano quando
  // a pergunta é factual e o contexto não cobre. Sem trecho, segue pro modelo
  // sem bloco nenhum — conversa, saudação e qualificação normais, como hoje.
  const ragResult = await findRagContextForQuestion({
    clientId,
    companyId,
    question: combinedText,
  }).catch((err) => {
    console.error("[chatbot-ai] RAG: falha ao buscar contexto — seguindo sem RAG neste turno", {
      clientId,
      phone: phone.slice(-4),
      error: err?.message || String(err),
    });
    return { applies: false, chunks: [], needsReindexDocumentIds: [] };
  });

  if (ragResult.applies && ragResult.chunks.length > 0) {
    systemPromptOverride = `${systemPromptOverride || effectiveSystemPrompt}${buildRagContextBlock(ragResult.chunks)}`;
  }

  let aiResponse;
  try {
    aiResponse = await runChatbotAI({
      systemPrompt: systemPromptOverride || effectiveSystemPrompt,
      history,
      newMessages: [combinedText],
      existingData: storedData,
      llmModel: activeLlmModel,
      contexto: { clientId, phone, origem: isSimulation ? "simulador" : "chatbot" },
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
    if (diagnosticoIa && aiResponse?.falhaIa) Object.assign(diagnosticoIa, aiResponse.falhaIa);
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
    objecao_detectada: aiResponse.objecao_detectada,
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
  if (aiResponse.objecao_detectada) {
    dadosBase.objecao_detectada = aiResponse.objecao_detectada;
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
  if (!isSimulation && !noPersist) {
    try {
      const resultado = existing?.id
        ? await supabase.from(leadsTable).update(payload).eq("id", existing.id)
        : await supabase.from(leadsTable).insert([{ ...payload, created_at: new Date().toISOString() }]);
      persistErro = resultado?.error || null;
    } catch (err) {
      persistErro = err;
    }
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
