// Escada de modelos de LLM — CONFIGURACAO, nao constante chumbada, e de
// QUALQUER provedor: cada degrau e roteado pelo provedor do proprio id.
//
// Em 24/08/2026 o boot cbcd317e6d503485 mostrou a lista antiga inteira morta:
//   llama-3.3-70b-versatile       404  (descontinuado)
//   llama-3.1-8b-instant          404  (descontinuado)
//   gemma2-9b-it                  400
//   deepseek-r1-distill-llama-70b 400
//   qwen-2.5-32b                  400
//   openai/gpt-oss-20b            429  (unico vivo, e com a cota estourada)
//
// Em 30/10/2026 o agente da Container Led emudeceu: os tres modelos vivos da
// Groq tomaram 413 (o prompt com RAG passa do teto de 8.000 TPM da conta) e o
// fallback para o Gemini apontava para gemini-2.0-flash, ja descontinuado. A
// escada era "da Groq": o Gemini so entrava como uma chamada avulsa no fim, sem
// rede propria. Agora a conversa roda no Gemini e a Groq fica na cauda.
//
// O dono troca a escada por variavel de ambiente sem deploy de codigo:
//
//   LLM_MODEL_LADDER="gemini-flash-latest,openai/gpt-oss-120b"
//
// GROQ_MODEL_LADDER, a variavel antiga, e IGNORADA: duas variaveis mandando na
// mesma decisao ja custaram caro neste projeto.
//
// Gemini por APELIDO (-latest): apelido nao morre por rotacao de versao, que e
// exatamente o que derrubou o agente tres vezes.

export const LLM_MODEL_LADDER_PADRAO = [
  "gemini-flash-latest",
  "gemini-flash-lite-latest",
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.8-27b",
];

// Teto de TPM medido na conta, por id. Lista real da Groq em 30/10/2026: nenhum
// modelo de conversa acima de 8.000 TPM. Modelo fora desta tabela tem teto
// desconhecido e nunca e descartado por causa do 413 de outro.
export const MODEL_LIMITS = {
  "openai/gpt-oss-120b": { tpm: 8000, rpm: 1000 },
  "openai/gpt-oss-20b": { tpm: 8000, rpm: 1000 },
  "qwen/qwen3.8-27b": { tpm: 8000, rpm: 1000 },
};

/** Provedor de um id pelo prefixo. O que nao e de outro provedor e da Groq. */
export function providerOfModelId(modelId) {
  const id = String(modelId || "").trim();
  if (id.startsWith("gemini-")) return "gemini";
  if (id.startsWith("gpt-")) return "openai";
  if (id.startsWith("claude-")) return "anthropic";
  return "groq";
}

/**
 * 413 = o pedido e maior que o teto de TPM do modelo. E deterministico: o mesmo
 * prompt toma 413 em qualquer modelo do mesmo provedor com teto igual ou menor.
 * Esses saem da escada; os de outro provedor, ou de teto desconhecido, ficam.
 */
export function dropOnRequestTooLarge(exhaustedModel, remainingLadder) {
  const exhausted = String(exhaustedModel || "").trim();
  const provider = providerOfModelId(exhausted);
  const teto = MODEL_LIMITS[exhausted]?.tpm;
  return remainingLadder.filter((m) => {
    if (m === exhausted) return false;
    if (!teto || providerOfModelId(m) !== provider) return true;
    const tetoDoOutro = MODEL_LIMITS[m]?.tpm;
    return !tetoDoOutro || tetoDoOutro > teto;
  });
}

/** Modelos que a conta NAO tem mais. Usados so para avisar, nunca para chamar. */
export const GROQ_MODELOS_MORTOS = new Set([
  "llama-3.3-70b-versatile",
  "llama-3.1-8b-instant",
  "llama3-70b-8192",
  "llama3-8b-8192",
  "mixtral-8x7b-32768",
  "gemma2-9b-it",
  "gemma-7b-it",
  "deepseek-r1-distill-llama-70b",
  "qwen-2.5-32b",
]);

let avisoLadderAntigaEmitido = false;

function lerLadderDoAmbiente() {
  if (!avisoLadderAntigaEmitido && String(process.env.GROQ_MODEL_LADDER || "").trim()) {
    avisoLadderAntigaEmitido = true;
    console.error(
      "[llm-models] VARIAVEL OBSOLETA: GROQ_MODEL_LADDER esta setada e foi IGNORADA. " +
        "A escada agora e LLM_MODEL_LADDER (qualquer provedor). Pode apagar GROQ_MODEL_LADDER do EasyPanel."
    );
  }
  const bruto = String(process.env.LLM_MODEL_LADDER || "").trim();
  if (!bruto) return null;
  const lista = bruto.split(",").map((m) => m.trim()).filter(Boolean);
  return lista.length > 0 ? lista : null;
}

export function llmModelLadder() {
  return lerLadderDoAmbiente() || LLM_MODEL_LADDER_PADRAO;
}

/** Primeiro degrau da escada: o padrao de quem nao escolheu modelo. */
export function defaultLlmModel() {
  return llmModelLadder()[0];
}

/**
 * Primeiro modelo da GROQ na escada. So para quem posta direto em api.groq.com
 * (helpdesk, extracao de contrato/briefing, fallbacks diretos): um id do Gemini
 * ali voltaria 404.
 */
export function defaultGroqModel() {
  const daEscada = llmModelLadder().find((m) => providerOfModelId(m) === "groq");
  return daEscada || LLM_MODEL_LADDER_PADRAO.find((m) => providerOfModelId(m) === "groq");
}

/**
 * Escada efetiva para uma chamada: o modelo pedido primeiro (se vivo), depois o
 * resto. Modelo morto e DESCARTADO com aviso — tentar um 404 so queima tempo.
 */
export function resolveLlmLadder(modeloPedido) {
  const escada = [];
  const preferidos = [modeloPedido, process.env.GROQ_CAMPAIGN_AI_MODEL].filter(Boolean);

  for (const m of preferidos) {
    const nome = String(m).trim();
    if (!nome) continue;
    if (GROQ_MODELOS_MORTOS.has(nome)) {
      console.warn(
        `[llm-models] modelo "${nome}" foi descontinuado pelo provedor e esta sendo ignorado. ` +
          `Atualize a configuracao (LLM_MODEL_LADDER) ou o modelo do tenant.`
      );
      continue;
    }
    escada.push(nome);
  }

  for (const m of llmModelLadder()) {
    if (!GROQ_MODELOS_MORTOS.has(m)) escada.push(m);
  }

  return Array.from(new Set(escada));
}

/** A mesma escada, so com ids da Groq — para quem chama api.groq.com direto. */
export function resolveGroqLadder(modeloPedido) {
  return resolveLlmLadder(modeloPedido).filter((m) => providerOfModelId(m) === "groq");
}

/**
 * 404 (modelo morto) e 429 (cota estourada) sao problemas COMPLETAMENTE
 * diferentes, e sairam do mesmo jeito no log — "indisponivel ou limite de taxa"
 * — durante toda a investigacao. Um se resolve trocando a lista, o outro
 * pagando plano ou espalhando a carga. Aqui viram tipos distintos.
 */
export function classifyLlmHttpError(status, corpo = "") {
  const texto = String(corpo || "");

  // Antes do 429: o corpo do 413 da Groq tambem fala em "tokens per minute",
  // mas o pedido nao cabe no teto — esperar o minuto virar nao resolve.
  if (status === 413) {
    return { tipo: "PEDIDO_GRANDE_DEMAIS", tentarProximo: true, ...parseRateLimit(texto) };
  }
  if (status === 429 || /rate.?limit|Too Many Requests|tokens per minute|\bTPM\b/i.test(texto)) {
    return { tipo: "COTA_ESTOURADA", tentarProximo: true, ...parseRateLimit(texto) };
  }
  if (status === 404 || /model_not_found|does not exist|decommissioned|deprecated/i.test(texto)) {
    return { tipo: "MODELO_INEXISTENTE", tentarProximo: true };
  }
  // O Gemini responde chave invalida com 400, nao 401.
  if (status === 401 || status === 403 || (status === 400 && /API_KEY_INVALID|valid API key/i.test(texto))) {
    return { tipo: "CREDENCIAL", tentarProximo: false };
  }
  if (status === 400 && /json_validate_failed|Failed to validate JSON/i.test(texto)) {
    return { tipo: "CONTRATO_JSON", tentarProximo: false };
  }
  if (status === 400) {
    return { tipo: "PEDIDO_INVALIDO", tentarProximo: true };
  }
  // Provedor fora do ar ou sobrecarregado: o proximo degrau pode estar de pe.
  if (status >= 500) {
    return { tipo: "INDISPONIVEL", tentarProximo: true };
  }
  return { tipo: "DESCONHECIDO", tentarProximo: false };
}

/** Extrai os numeros do corpo de 429 para a mensagem poder ser especifica. */
export function parseRateLimit(texto) {
  const limite = texto.match(/Limit\s+(\d+)/i);
  const usado = texto.match(/Used\s+(\d+)/i);
  const espera = texto.match(/try again in ([0-9.]+)s/i);
  return {
    limiteTpm: limite ? Number(limite[1]) : null,
    usadoTpm: usado ? Number(usado[1]) : null,
    esperarSegundos: espera ? Number(espera[1]) : null,
  };
}

/**
 * Frase do 413: o pedido nao cabe no teto do modelo. Esperar ou subir plano de
 * cota nao resolve; o que resolve e prompt menor ou modelo de teto maior.
 */
export function mensagemDePedidoMaiorQueOTeto({ modelo, limiteTpm }) {
  return (
    `O pedido e maior que o teto do modelo ${modelo}` +
    `${limiteTpm ? ` (limite ${limiteTpm.toLocaleString("pt-BR")} tokens)` : ""}. ` +
    "Nao e cota acabando: o prompt precisa caber no teto, ou o pedido precisa ir para um modelo de teto maior."
  );
}

/** Frase que o dono le na tela quando a cota acaba. E informacao de negocio. */
export function mensagemDeCotaEstourada({ modelo, limiteTpm, usadoTpm, esperarSegundos }) {
  const partes = [`A cota de IA do modelo ${modelo} acabou.`];
  if (limiteTpm) {
    partes.push(`Teto de ${limiteTpm.toLocaleString("pt-BR")} tokens por minuto${usadoTpm ? `, ${usadoTpm.toLocaleString("pt-BR")} já usados` : ""}.`);
  }
  if (esperarSegundos) partes.push(`Libera em ~${Math.ceil(esperarSegundos)}s.`);
  partes.push("Se acontece com frequência, é hora de subir o plano do provedor ou reduzir o volume de resumos em lote.");
  return partes.join(" ");
}
