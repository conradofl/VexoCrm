// Escada de modelos da Groq — CONFIGURACAO, nao constante chumbada.
//
// Em 24/08/2026 o boot cbcd317e6d503485 mostrou a lista antiga inteira morta:
//   llama-3.3-70b-versatile       404  (descontinuado)
//   llama-3.1-8b-instant          404  (descontinuado)
//   gemma2-9b-it                  400
//   deepseek-r1-distill-llama-70b 400
//   qwen-2.5-32b                  400
//   openai/gpt-oss-20b            429  (unico vivo, e com a cota estourada)
//
// Os nomes estavam repetidos em nove arquivos. Aqui ficam em um lugar so, e o
// dono troca por variavel de ambiente sem deploy de codigo:
//
//   GROQ_MODEL_LADDER="openai/gpt-oss-120b,groq/compound"
//
// Lista real da conta em 24/08/2026, consultada em /openai/v1/models, com os
// tetos lidos dos cabecalhos x-ratelimit-* de uma chamada real:
//
//   modelo                 contexto   saida    TPM      RPM
//   openai/gpt-oss-120b     131072    65536    8.000    1000
//   openai/gpt-oss-20b      131072    65536    8.000    1000
//   qwen/qwen3.6-27b        131072    16384    8.000    1000
//   groq/compound           131072     8192   70.000     250
//   groq/compound-mini      131072     8192   70.000     250
//   allam-2-7b                4096     4096    6.000    7000   (fora: contexto curto)
//
// Ordem: capacidade primeiro, teto de TPM como desempate — que e o pedido do
// dono. groq/compound entra depois dos modelos de chat puro porque e um sistema
// agentico com ferramentas embutidas, menos previsivel para saida em JSON; mas
// entra, porque os 70.000 TPM sao a unica folga real quando o pool de 8.000 do
// gpt-oss acaba.

export const GROQ_MODEL_LADDER_PADRAO = [
  "openai/gpt-oss-120b",
  "openai/gpt-oss-20b",
  "qwen/qwen3.6-27b",
  "groq/compound",
  "groq/compound-mini",
];

export const GROQ_MODEL_LIMITS = {
  "openai/gpt-oss-120b": { tpm: 8000, rpm: 1000 },
  "openai/gpt-oss-20b": { tpm: 8000, rpm: 1000 },
  "qwen/qwen3.6-27b": { tpm: 8000, rpm: 1000 },
  "qwen/qwen3.8-27b": { tpm: 8000, rpm: 1000 },
  "groq/compound": { tpm: 70000, rpm: 250 },
  "groq/compound-mini": { tpm: 70000, rpm: 250 },
};

export function isHighQuotaModel(modelName) {
  const name = String(modelName || "").trim().toLowerCase();
  return name.includes("compound") || (GROQ_MODEL_LIMITS[name]?.tpm ?? 0) >= 50000;
}

/**
 * Depois de um 429 (cota estourada), o que ainda vale tentar.
 *
 * Escalar para modelo de alta cota (>= 50.000 TPM) é PREFERÊNCIA, não condição: se houver algum na escada, vai
 * direto para ele (os de 8.000 TPM tendem a estourar juntos). Se não houver nenhum, segue a escada normal com os
 * modelos restantes — cada um tem pool próprio e pode responder.
 *
 * Nunca devolve lista vazia enquanto houver modelo não tentado. Já devolveu: em 12/10/2026 a Groq descontinuou
 * groq/compound e groq/compound-mini, a escada ficou só com modelos de 8.000 TPM, e o filtro antigo ("só alta
 * cota") passou a devolver [] — o primeiro 429 truncava a escada e o robô silenciava a resposta ao lead. Não
 * "conserte" isto de volta para condição: uma ida de rede desperdiçada é muito melhor que silêncio.
 */
export function filterLadderOnQuotaExceeded(exhaustedModel, remainingLadder) {
  const exhausted = String(exhaustedModel || "").trim().toLowerCase();
  const rest = remainingLadder.filter((m) => String(m || "").trim().toLowerCase() !== exhausted);
  const high = rest.filter((m) => isHighQuotaModel(m));
  return high.length > 0 ? high : rest;
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

function lerLadderDoAmbiente() {
  const bruto = String(process.env.GROQ_MODEL_LADDER || "").trim();
  if (!bruto) return null;
  const lista = bruto.split(",").map((m) => m.trim()).filter(Boolean);
  return lista.length > 0 ? lista : null;
}

export function groqModelLadder() {
  return lerLadderDoAmbiente() || GROQ_MODEL_LADDER_PADRAO;
}

/** Primeiro degrau da escada: o padrao de quem nao escolheu modelo. */
export function defaultGroqModel() {
  return groqModelLadder()[0];
}

/**
 * Escada efetiva para uma chamada: o modelo pedido primeiro (se vivo), depois o
 * resto. Modelo morto e DESCARTADO com aviso — tentar um 404 so queima tempo.
 */
export function resolveGroqLadder(modeloPedido) {
  const escada = [];
  const preferidos = [modeloPedido, process.env.GROQ_CAMPAIGN_AI_MODEL].filter(Boolean);

  for (const m of preferidos) {
    const nome = String(m).trim();
    if (!nome) continue;
    if (GROQ_MODELOS_MORTOS.has(nome)) {
      console.warn(
        `[llm-models] modelo "${nome}" foi descontinuado pela Groq e esta sendo ignorado. ` +
          `Atualize a configuracao (GROQ_MODEL_LADDER) ou o modelo do tenant.`
      );
      continue;
    }
    escada.push(nome);
  }

  for (const m of groqModelLadder()) {
    if (!GROQ_MODELOS_MORTOS.has(m)) escada.push(m);
  }

  return Array.from(new Set(escada));
}

/**
 * 404 (modelo morto) e 429 (cota estourada) sao problemas COMPLETAMENTE
 * diferentes, e sairam do mesmo jeito no log — "indisponivel ou limite de taxa"
 * — durante toda a investigacao. Um se resolve trocando a lista, o outro
 * pagando plano ou espalhando a carga. Aqui viram tipos distintos.
 */
export function classifyLlmHttpError(status, corpo = "") {
  const texto = String(corpo || "");

  if (status === 429 || /rate.?limit|Too Many Requests|tokens per minute|\bTPM\b/i.test(texto)) {
    return { tipo: "COTA_ESTOURADA", tentarProximo: true, ...parseRateLimit(texto) };
  }
  if (status === 404 || /model_not_found|does not exist|decommissioned|deprecated/i.test(texto)) {
    return { tipo: "MODELO_INEXISTENTE", tentarProximo: true };
  }
  if (status === 401 || status === 403) {
    return { tipo: "CREDENCIAL", tentarProximo: false };
  }
  if (status === 400 && /json_validate_failed|Failed to validate JSON/i.test(texto)) {
    return { tipo: "CONTRATO_JSON", tentarProximo: false };
  }
  if (status === 400) {
    return { tipo: "PEDIDO_INVALIDO", tentarProximo: true };
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

/** Frase que o dono le na tela quando a cota acaba. E informacao de negocio. */
export function mensagemDeCotaEstourada({ modelo, limiteTpm, usadoTpm, esperarSegundos }) {
  const partes = [`A cota de IA do modelo ${modelo} acabou.`];
  if (limiteTpm) {
    partes.push(`Teto de ${limiteTpm.toLocaleString("pt-BR")} tokens por minuto${usadoTpm ? `, ${usadoTpm.toLocaleString("pt-BR")} já usados` : ""}.`);
  }
  if (esperarSegundos) partes.push(`Libera em ~${Math.ceil(esperarSegundos)}s.`);
  partes.push("Se acontece com frequência, é hora de subir o plano da Groq ou reduzir o volume de resumos em lote.");
  return partes.join(" ");
}
