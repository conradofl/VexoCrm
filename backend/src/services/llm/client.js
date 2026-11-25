// Cliente de LLM (escada Groq/Gemini/GoClaw, modo JSON, timeout e registro em llm_usage).
// Saiu de chatbot-ai-engine.js no PR 5 do untangle (24/11/2026): campanha, insight de conversa,
// extração de campos, briefing da GD e criador de campanha usavam o cliente geral importando o
// motor do agente inteiro. Movimento puro: mesmo código, outro arquivo.
import {
  resolveLlmLadder,
  defaultLlmModel,
  classifyLlmHttpError,
  mensagemDeCotaEstourada,
  mensagemDePedidoMaiorQueOTeto,
  dropOnRequestTooLarge,
} from "../llmModels.js";
import { gravarUsoLlm } from "../llmUsage.js";
import { providerOfModelId } from "../llmModels.js";

export const LLM_MODELS = [
  // Gemini / Google — o padrao desde 30/10/2026. So APELIDOS (-latest): apelido
  // nao morre por rotacao de versao. gemini-2.0-flash, 1.5-flash e 1.5-pro
  // estavam aqui como versao fixa, morreram, e o primeiro derrubou o agente.
  { id: "gemini-flash-latest", name: "Gemini Flash", provider: "gemini", providerName: "Gemini / Google" },
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

export function detectLlmProvider(modelId) {
  const found = LLM_MODELS.find((m) => m.id === modelId);
  if (found) return found.provider;
  return providerOfModelId(modelId);
}

export const GROQ_BASE = "https://api.groq.com/openai/v1";
export const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";

export function groqKey() {
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

    if (diagnostico.tipo === "SALDO_ESGOTADO") {
      credenciaisQuebradas.add(provider);
      console.error(
        `[chatbot-ai-engine] SALDO ESGOTADO no provedor "${provider}" (HTTP ${r.status}, modelo "${m}"). ` +
          "Os créditos pré-pagos da conta acabaram. Recarregue no AI Studio/Google Cloud ou use outra chave."
      );
      modelsToTry = [
        ...modelsToTry.slice(0, cursor),
        ...modelsToTry.slice(cursor).filter((x) => detectLlmProvider(x) !== provider),
      ];
      lastError = new Error(
        diagnostico.motivo ||
        `Os créditos pré-pagos da conta do ${adaptador.nome} acabaram (HTTP ${r.status}). Recarregue em https://ai.studio/projects.`
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
