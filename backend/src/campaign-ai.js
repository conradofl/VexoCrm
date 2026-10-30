import { Groq } from "groq-sdk";
import { callLlmChatCompletion } from "./chatbot-ai-engine.js";
import { defaultGroqModel } from "./services/llmModels.js";
import { normalizeSentenceNewlines } from "./services/messagePlaceholders.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
// Modelo instruct, nao de raciocinio. Medido 06/08/2026: gerar 25 variacoes e
// seguir especificacao de formatacao, nao deduzir — e o gpt-oss-20b queimava
// ~3.4k tokens "pensando" antes de escrever, estourando o teto e devolvendo
// 400 json_validate_failed com failed_generation vazio. Baixar o esforco de
// raciocinio consertava o orcamento e quebrava a saida (loop de repeticao,
// contagem errada). O llama nao tem esse overhead: 0 token de raciocinio, e o
// limite da camada gratuita e maior — 12000 TPM contra 8000 do gpt-oss-20b
// (header x-ratelimit-limit-tokens da propria API, mesma chave).
// Escada em services/llmModels.js: llama-3.3-70b-versatile foi descontinuado.
const DEFAULT_GROQ_MODEL = defaultGroqModel();
const STRICT_JSON_MODELS = new Set(["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);
const CURIOSITY_NAME_TECHNIQUE = {
  name: "name_curiosity_recovery",
  label: "Name + curiosity recovery",
  summary:
    "When a lead is about to stop, think, or postpone, call them by name and open a useful curiosity gap instead of applying pressure.",
  useCases: [
    "WhatsApp sales follow-up",
    "Objection recovery for 'vou pensar'",
    "Reactivation of indecisive leads",
  ],
  example:
    "Oi, {{nome}}, rapidinho... antes de voce decidir, deixa eu te mostrar um ponto que talvez mude sua visao.",
};

export const VIP_SALES_TECHNIQUE = {
  name: "vip_high_ticket",
  label: "Venda VIP / High-ticket",
  summary:
    "Foque em exclusividade, benefícios premium e status. Evite parecer desesperado por vendas. Demonstre escassez real e atendimento personalizado.",
  useCases: [
    "Vendas High-ticket",
    "Lançamentos VIP",
    "Produtos de Luxo e Exclusivos",
  ],
  example:
    "Olá, {{nome}}. Como você está no nosso grupo seleto, reservei uma oportunidade exclusiva para você.",
};

// Groq was returning unrealistic gaps (e.g. 172800s = 48h) for WhatsApp steps; AI assist stays within chat-like ranges.
const MAX_AI_STEP_DELAY_SECONDS = 3600;
const MAX_AI_LEAD_DELAY_SECONDS = 3600;

function clampAiDelaySeconds(value, maxSeconds) {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, maxSeconds);
}

/** Normalize delay fields after Groq (defense in depth vs schema drift or json_object mode). */
function clampCampaignAiDelaySuggestion(parsed) {
  if (!parsed || typeof parsed !== "object") return parsed;
  const seq = Array.isArray(parsed.sequence) ? parsed.sequence : [];
  return {
    ...parsed,
    sequence: seq.map((step) => ({
      ...step,
      delayAfterSeconds: clampAiDelaySeconds(step.delayAfterSeconds, MAX_AI_STEP_DELAY_SECONDS),
    })),
    leadDelaySeconds: clampAiDelaySeconds(parsed.leadDelaySeconds, MAX_AI_LEAD_DELAY_SECONDS),
  };
}

function getGroqModel() {
  return process.env.GROQ_CAMPAIGN_AI_MODEL || DEFAULT_GROQ_MODEL;
}

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

const SEGMENT_OPERATOR_LABELS = {
  equals: "igual a",
  contains: "contém",
  gt: "maior que",
  lt: "menor que",
};

function sanitizeSegmentContext(segmentation = {}) {
  if (!segmentation || typeof segmentation !== "object") return {};

  // Shape novo unificado: { filters:[{field,operator,value}] }.
  if (Array.isArray(segmentation.filters)) {
    const filters = segmentation.filters
      .filter((f) => f && f.field && (f.value ?? "") !== "")
      .map((f) => ({
        campo: normalizeString(f.field),
        condicao: SEGMENT_OPERATOR_LABELS[f.operator] || normalizeString(f.operator) || "igual a",
        valor: normalizeString(f.value),
      }));
    return { filtros: filters };
  }

  // Shape legado (campanhas antigas) — mantido p/ compat.
  return {
    gender: normalizeString(segmentation.gender),
    productType: normalizeString(segmentation.productType),
    ticket: normalizeString(segmentation.ticket),
    ticketThreshold:
      segmentation.ticketThreshold === null || segmentation.ticketThreshold === undefined
        ? null
        : Number(segmentation.ticketThreshold),
    interest: normalizeString(segmentation.interest),
    campaignTag: normalizeString(segmentation.campaignTag),
  };
}

function sanitizeSequence(sequence = []) {
  if (!Array.isArray(sequence)) return [];

  return sequence.map((step, index) => ({
    id: normalizeString(step?.id) || `step-${index + 1}`,
    type: normalizeString(step?.type).toLowerCase() === "image" ? "image" : "text",
    order: Number(step?.order) || index + 1,
    text: normalizeString(step?.text),
    hasImage: Boolean(step?.image?.dataUrl || step?.image),
    enabled: step?.enabled !== false,
    delayAfterSeconds: Number(step?.delayAfterSeconds) || 0,
  }));
}

function buildTechniqueContext(style = "") {
  const normalizedStyle = normalizeString(style).toLowerCase();
  
  if (normalizedStyle.includes("vip") || normalizedStyle.includes("high") || normalizedStyle.includes("premium")) {
    return {
      activeTechnique: VIP_SALES_TECHNIQUE,
      priority: "high",
    };
  }

  const shouldPrioritizeTechnique =
    !normalizedStyle ||
    normalizedStyle.includes("curios") ||
    normalizedStyle.includes("nome") ||
    normalizedStyle.includes("obje") ||
    normalizedStyle.includes("pensar") ||
    normalizedStyle.includes("indecis") ||
    normalizedStyle.includes("whatsapp");

  return {
    activeTechnique: CURIOSITY_NAME_TECHNIQUE,
    priority: shouldPrioritizeTechnique ? "high" : "supporting",
  };
}

export { extractJsonFromLlmText } from "./services/jsonExtractor.js";
import { extractJsonFromLlmText } from "./services/jsonExtractor.js";

// O tenant vem em input.clientId quando a rota passa. Hoje as rotas de campanha
// nao passam, e a linha de llm_usage sai com dono nulo — visivel no relatorio.
function contextoDeCampanha(input) {
  return { clientId: normalizeString(input?.clientId) || null, origem: "campanha" };
}

async function callGroqJson({ taskPrompt, contexto = null }) {
  if (!process.env.GROQ_API_KEY && !process.env.GROQ_KEY) {
    throw new Error("GROQ_DISABLED");
  }

  const rawContent = await callLlmChatCompletion({
    model: getGroqModel(),
    temperature: 0.3,
    max_tokens: 1200,
    contexto,
    messages: [
      {
        role: "system",
        content:
          "Voce eh um estrategista de outbound B2B/B2C em portugues do Brasil. Responda apenas com JSON valido, sem markdown. Nao invente dados pessoais e nao solicite envio automatico.",
      },
      {
        role: "user",
        content: taskPrompt,
      },
    ],
  });

  console.log("[campaign-ai] Resposta crua da IA (callGroqJson):", rawContent);
  return extractJsonFromLlmText(rawContent);
}

export function getGroqCampaignAiStatus() {
  return {
    enabled: Boolean(process.env.GROQ_API_KEY),
    provider: "groq",
    model: getGroqModel(),
  };
}

export async function generateCampaignCopySuggestion(input = {}) {
  const context = {
    campaignName: normalizeString(input.campaignName),
    goal: normalizeString(input.goal),
    style: normalizeString(input.style),
    segmentation: sanitizeSegmentContext(input.segmentation),
    technique: buildTechniqueContext(input.style),
  };

  return callGroqJson({
    contexto: contextoDeCampanha(input),
    schemaName: "campaign_copy_suggestion",
    schema: {
      type: "object",
      properties: {
        copy: { type: "string" },
        rationale: { type: "string" },
      },
      required: ["copy", "rationale"],
      additionalProperties: false,
    },
    taskPrompt: `Gere uma copy inicial em pt-BR para uma campanha outbound.
Contexto:
${JSON.stringify(context, null, 2)}

Regras:
- Nao use markdown.
- A copy deve ser objetiva, natural e pronta para WhatsApp.
- Use {{nome}} quando fizer sentido chamar o lead pelo nome, sem inventar nomes reais.
- Crie curiosidade util, principalmente para leads indecisos ou que responderiam "vou pensar".
- Nao cite telefones, nomes reais de leads ou listas.
- Evite pressao, urgencia falsa e promessas exageradas.
- Rationale curta, no maximo 2 frases.`,
  });
}

// A validacao por json_schema so vale para os modelos em STRICT_JSON_MODELS. Com
// qualquer outro (ex.: llama-3.3-70b-versatile) o payload cai em json_object, que
// nao impoe minItems/maxItems nem o nome das chaves — o modelo devolvia menos
// variacoes que o pedido, e as vezes num formato que o front nao sabia ler
// (a tela ficava vazia). Estas duas funcoes tornam a leitura tolerante e
// completam o que faltar.
function extractVariantList(parsed) {
  const pools = [
    parsed?.variants,
    parsed?.variacoes,
    parsed?.variations,
    parsed?.mensagens,
    parsed?.messages,
    parsed?.items,
    Array.isArray(parsed) ? parsed : null,
  ];

  for (const pool of pools) {
    if (!Array.isArray(pool) || pool.length === 0) continue;
    const texts = pool
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (entry && typeof entry === "object") {
          return normalizeString(entry.text || entry.variant || entry.mensagem || entry.message);
        }
        return "";
      })
      .filter(Boolean);
    if (texts.length > 0) return texts;
  }

  return [];
}

function dedupeVariants(list) {
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const key = item.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item.trim());
  }
  return out;
}

// Teto de variacoes. Tem que bater com MAX_TEXT_VARIANTS de campaign-outbound.js:
// se este for maior, o envio corta o excedente em silencio.
const MAX_TEMPLATE_VARIANTS = 30;

// Buckets estruturais. Pedir "N variacoes diferentes" devolve N parafrases com o
// mesmo esqueleto; pedir quantidade POR BUCKET impoe a diversidade em vez de
// esperar por ela.
//
// SEM frase-exemplo aqui de proposito. Exemplo e o sinal mais forte de um
// prompt: as frases que estavam nestas regras eram todas de disponibilidade
// ("pode falar agora?"), entao uma base de cobranca ou lembrete era puxada
// para o registro do exemplo em vez de variar a mensagem do cliente. A
// ancoragem tem que vir do baseText, nunca do codigo.
// ATENCAO: nao existe bucket de comprimento extremo. Havia um ("no maximo 6
// palavras") e ele era IMPOSSIVEL de cumprir sem jogar fora o pedido da
// mensagem — numa base real com oferta composta + CTA, o modelo devolveu
// "Estrategias de vendas para voce": manchete, nao mensagem. Variedade de
// comprimento continua, mas com piso derivado do baseText em runtime.
const VARIANT_BUCKETS = [
  { key: "direta", share: 0.15, rule: "começa direto no ponto, SEM saudação. Mensagem completa, com o pedido." },
  { key: "saudacao_pergunta", share: 0.2, rule: "começa com saudação e termina fazendo o pedido em forma de pergunta." },
  // {{nome}} NAO e bucket: virou regra global aplicada dentro de cada lote.
  // Como bucket, so ~20% das variacoes usariam nome, abaixo do piso de 30% que
  // o antiban precisa — e leads sem nome dependem das que nao usam.
  // needsSubject: so entra quando o baseText declara o assunto. Sem assunto o
  // modelo inventa marcador ("falar sobre X") e o "X" chega literal no lead.
  { key: "com_motivo", share: 0.15, rule: "diz por que você está entrando em contato, usando SOMENTE o assunto que já aparece no baseText. Não invente assunto novo.", needsSubject: true },
  { key: "duas_frases", share: 0.15, rule: "duas ou três frases, a variação mais longa do conjunto." },
  // needsNoQuestion: se a base PERGUNTA, toda variacao tem que perguntar
  // (invariante do pedido). Um bucket que proibe interrogacao seria
  // incompativel — some do plano nesse caso, em vez de brigar com o invariante.
  { key: "afirmacao", share: 0.15, rule: "faz o pedido em forma de afirmação, sem ponto de interrogação.", needsNoQuestion: true },
];

function contarPalavras(texto) {
  return normalizeString(texto).split(/\s+/).filter(Boolean).length;
}

function semAcentoMinusculo(texto) {
  return normalizeString(texto)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Classe fechada do portugues: artigos, preposicoes, contracoes e possessivos.
// Nao e heuristica morfologica — e lista finita. O invariante de "mensalidade
// da sua matricula" e {mensalidade, matricula}; exigir "da" e "sua" reprovava
// parafrase correta por causa de palavra que nao carrega informacao nenhuma.
const PALAVRAS_FUNCIONAIS = new Set([
  "de", "da", "do", "das", "dos", "a", "o", "as", "os", "em", "na", "no", "nas", "nos",
  "um", "uma", "uns", "umas", "e", "com", "para", "pra", "ao", "aos",
  "seu", "sua", "seus", "suas", "meu", "minha", "nosso", "nossa",
]);

function palavrasDeConteudo(elemento) {
  return semAcentoMinusculo(elemento)
    .split(/\s+/)
    .filter(Boolean)
    .filter((palavra) => !PALAVRAS_FUNCIONAIS.has(palavra));
}

function contemPalavra(alvo, palavra) {
  const escapado = palavra.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escapado}([^\\p{L}\\p{N}]|$)`, "u").test(alvo);
}

/**
 * O elemento concreto sobreviveu na variacao?
 *
 * Cada palavra e buscada por limite de palavra, NAO por substring: elemento
 * curto como "IA" casaria dentro de "estrategias" e daria por preservado o que
 * sumiu.
 *
 * Elemento de varias palavras casa FROUXO — todas as palavras presentes, em
 * qualquer posicao, nao a frase contigua. Rede de seguranca para quando a
 * extracao escorregar e devolver frase em vez de substantivo: "vaga na oficina"
 * estava reprovando "na oficina esta semana, temos vaga", que preserva tudo.
 */
function variacaoPreservaElemento(variacao, elemento) {
  const alvo = semAcentoMinusculo(variacao);
  const palavras = palavrasDeConteudo(elemento);
  if (palavras.length === 0) return true;
  return palavras.every((palavra) => contemPalavra(alvo, palavra));
}

function sanitizeElementos(lista) {
  if (!Array.isArray(lista)) return [];
  return Array.from(
    new Set(
      lista
        .map((item) => normalizeString(typeof item === "string" ? item : item?.texto || item?.valor))
        .filter((item) => item.length >= 2 && item.length <= 40)
        // Elemento so de palavra funcional nao e invariante de coisa nenhuma:
        // some da lista em vez de reprovar variacao.
        .filter((item) => palavrasDeConteudo(item).length > 0)
    )
    // Teto de 4: o prompt ja pede no maximo 4, isto e so a rede. Lista longa de
    // invariantes reprova parafrase legitima e o gerador entrega menos.
  ).slice(0, 4);
}

function sanitizeAvailableVariables(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .map((item) => normalizeString(item).replace(/[{}]/g, "").trim().toLowerCase())
        .filter((item) => /^[\p{L}0-9_]+$/u.test(item))
    )
  );
}

// Ruido de abordagem: saudacao, disponibilidade e conectivos. O que sobra
// depois de tirar isto e o assunto do contato — se sobrar algo.
const SUBJECT_STOPWORDS = new Set([
  "ola", "oi", "opa", "fala", "bom", "boa", "dia", "tarde", "noite", "tudo", "bem", "certo",
  "voce", "vc", "tu", "eu", "me", "te", "se", "a", "o", "as", "os", "um", "uma", "e", "de",
  "do", "da", "dos", "das", "em", "no", "na", "para", "pra", "por", "com", "que", "esta",
  "estou", "sera", "pode", "podendo", "poderia", "consegue", "conseguiria", "tem", "teria",
  "ter", "falar", "conversar", "atender", "responder", "agora", "hoje", "momento", "minuto",
  "minutinho", "segundo", "tempo", "disponivel", "disponibilidade", "rapidinho", "aqui",
  "sobre", "assunto", "tema", "coisa", "algo", "nome", "telefone", "por_favor", "favor",
]);

/**
 * O baseText declara o assunto do contato?
 *
 * "Ola, bom dia! Voce esta podendo falar agora?" -> nao (so disponibilidade).
 * "Vi que voce tem interesse em energia solar, consegue falar?" -> sim.
 *
 * Importa porque o bucket com_motivo exige dizer o motivo: sem assunto na base
 * o modelo preenche com marcador ("falar sobre X") e o "X" vai literal pro lead.
 */
function baseTextDeclaresSubject(baseText) {
  const limpo = normalizeString(baseText)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\{\{[^}]*\}\}/g, " ")
    .replace(/[^a-z0-9\s]/g, " ");

  const restantes = limpo
    .split(/\s+/)
    .filter(Boolean)
    .filter((palavra) => palavra.length >= 3 && !SUBJECT_STOPWORDS.has(palavra));

  return restantes.length > 0;
}

/**
 * Distribui `count` entre os buckets por maior-resto, com piso de 1 em cada.
 * Bucket sem pre-requisito atendido ({{nome}} ausente, assunto ausente) sai da
 * lista e sua cota e redistribuida entre os demais pelo peso relativo.
 */
function buildVariantBucketPlan(count, hasNameVariable, hasSubject, baseTemPergunta) {
  const buckets = VARIANT_BUCKETS.filter(
    (bucket) =>
      (hasNameVariable || !bucket.needsName) &&
      (hasSubject || !bucket.needsSubject) &&
      (!baseTemPergunta || !bucket.needsNoQuestion)
  );
  if (count < buckets.length) return [];

  const totalShare = buckets.reduce((acc, bucket) => acc + bucket.share, 0);
  const raw = buckets.map((bucket) => ({ bucket, exact: (bucket.share / totalShare) * count }));
  const plan = raw.map((entry) => ({ ...entry, size: Math.max(1, Math.floor(entry.exact)) }));

  let assigned = plan.reduce((acc, entry) => acc + entry.size, 0);
  const byRemainder = [...plan].sort(
    (a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact))
  );
  let cursor = 0;
  while (assigned < count) {
    byRemainder[cursor % byRemainder.length].size += 1;
    assigned += 1;
    cursor += 1;
  }
  const bySize = [...plan].sort((a, b) => b.size - a.size);
  cursor = 0;
  while (assigned > count) {
    const entry = bySize[cursor % bySize.length];
    if (entry.size > 1) {
      entry.size -= 1;
      assigned -= 1;
    }
    cursor += 1;
  }

  return plan.map((entry) => ({ key: entry.bucket.key, rule: entry.bucket.rule, size: entry.size }));
}

export function getVariableCounts(text) {
  const matches = (text || "").match(/\{\{[a-zA-Z0-9_]+\}\}/g) || [];
  const counts = {};
  for (const m of matches) {
    counts[m] = (counts[m] || 0) + 1;
  }
  return counts;
}

export function hasSameVariableCounts(baseText, variantText) {
  const baseCounts = getVariableCounts(baseText);
  const variantCounts = getVariableCounts(variantText);
  const allVars = new Set([...Object.keys(baseCounts), ...Object.keys(variantCounts)]);
  for (const v of allVars) {
    if ((baseCounts[v] || 0) !== (variantCounts[v] || 0)) return false;
  }
  return true;
}

export async function generateCampaignTemplateVariants(input = {}) {
  const count = Math.min(
    Math.max(Number.parseInt(String(input.count ?? "6"), 10) || 6, 2),
    25
  );
  const baseText = normalizeString(input.baseText);
  if (!baseText) {
    return {
      variants: [],
      requested: count,
      rationale: "Nenhum texto base fornecido.",
      invariants: { pedido: "", elementos: [] },
    };
  }

  const apiKey = process.env.GROQ_API_KEY || process.env.GROQ_KEY;
  if (!apiKey) {
    const error = new Error("Chave da Groq (GROQ_API_KEY) não está configurada no servidor.");
    error.statusCode = 503;
    error.code = "GROQ_KEY_MISSING";
    throw error;
  }

  const varCounts = getVariableCounts(baseText);
  const varKeys = Object.keys(varCounts);
  const varRules = varKeys.length > 0
    ? `As seguintes variáveis estão na mensagem base e DEVEM aparecer em CADA variação EXATAMENTE com a mesma contagem:\n${varKeys.map((k) => `- ${k}: exatamente ${varCounts[k]} vez(es)`).join("\n")}\nPROIBIDO duplicar ou omitir qualquer uma dessas variáveis.`
    : `A mensagem base NÃO contém variáveis. Não adicione {{nome}} ou qualquer outra variável.`;

  const prompt = `Você é um copywriter especialista em mensagens de WhatsApp no Brasil.
Sua missão é REESCREVER a mensagem base abaixo gerando exatamente ${count} variações HUMANIZADAS, COMPLETAS e NATURAIS para rotação antiban.

MENSAGEM BASE DO CLIENTE:
"""${baseText}"""

REGRAS OBRIGATÓRIAS DE REESCRITA:
1. REESCRITA INTEGRAL: Reescreva a mensagem por completo usando sinônimos e estruturas de frases diferentes. PROIBIDO apenas colar cumprimentos na frente da mensagem base.
2. MESMA INTENÇÃO E OBJETIVO: Todas as variações devem transmitir rigorosamente a mesma mensagem, pedido ou proposta da original.
3. COMPRIMENTO SIMILAR: Mantenha tamanho e tom próximos ao original.
4. PRESERVAÇÃO EXATA DE VARIÁVEIS:
${varRules}
5. UMA ÚNICA SAUDAÇÃO NATURAL: Proibido juntar cumprimentos como "Oi! Olá". Use uma única saudação ou vá direto ao assunto.
6. SAUDAÇÕES ATEMPORAIS: Proibido "bom dia", "boa tarde", "boa noite". Use "Olá", "Oi", "Tudo bem?", ou inicie direto.
7. SEM DUPLICATAS: Nenhuma variação pode ser idêntica à mensagem base nem a outra variação.
8. Português do Brasil coloquial, educado e fluido.
9. FLUXO CONTÍNUO DE FRASES: NUNCA quebre linhas no meio de uma mesma frase (ex.: quebras artificiais de ~60 caracteres). Mantenha cada frase em linha contínua. Use quebra dupla (\n\n) exclusivamente para separar parágrafos distintos.

Retorne EXCLUSIVAMENTE um objeto JSON no formato:
{
  "variants": [
    "variação 1 completa...",
    "variação 2 completa..."
  ],
  "rationale": "Explicação breve das variações geradas"
}`;

  console.log("[campaign-ai] Solicitando variações de template para Groq (modelo:", defaultGroqModel(), ")");

  const rawContent = await callLlmChatCompletion({
    model: defaultGroqModel(),
    temperature: 0.7,
    max_tokens: 2500,
    contexto: contextoDeCampanha(input),
    messages: [
      {
        role: "system",
        content: "Você é um gerador de variações naturais de WhatsApp. Responda estritamente em JSON válido.",
      },
      { role: "user", content: prompt },
    ],
  });

  console.log("[campaign-ai] Resposta crua da IA (tamanho:", (rawContent || "").length, "):", rawContent);

  const parsed = extractJsonFromLlmText(rawContent);

  const rawVariants = Array.isArray(parsed?.variants) ? parsed.variants : [];
  const normalizedBase = normalizeString(baseText);
  const cleanVariants = [];
  const seen = new Set([normalizedBase.toLowerCase()]);

  for (const raw of rawVariants) {
    let v = normalizeSentenceNewlines(normalizeString(raw));
    if (!v || v.length < 4) continue;
    for (const k of varKeys) {
      const singleBrace = k.replace(/^\{\{/, "{").replace(/\}\}$/, "}");
      if (!v.includes(k) && v.includes(singleBrace)) {
        v = v.replaceAll(singleBrace, k);
      }
    }
    const lower = v.toLowerCase();
    if (seen.has(lower)) continue;
    if (!hasSameVariableCounts(baseText, v)) continue;

    seen.add(lower);
    cleanVariants.push(v);
  }

  if (cleanVariants.length === 0) {
    const error = new Error("A IA não gerou variações válidas que preservem o texto original e suas variáveis.");
    error.statusCode = 502;
    error.code = "GROQ_NO_VALID_VARIANTS";
    throw error;
  }

  return {
    variants: cleanVariants.slice(0, count),
    requested: count,
    rationale: parsed?.rationale || `${cleanVariants.length} variações humanizadas geradas com sucesso.`,
    invariants: { pedido: "Base", elementos: [] },
  };
}

export async function suggestCampaignSequence(input = {}) {
  const context = {
    campaignName: normalizeString(input.campaignName),
    goal: normalizeString(input.goal),
    style: normalizeString(input.style),
    segmentation: sanitizeSegmentContext(input.segmentation),
    existingSequence: sanitizeSequence(input.sequence),
    technique: buildTechniqueContext(input.style),
  };

  const parsed = await callGroqJson({
    contexto: contextoDeCampanha(input),
    schemaName: "campaign_sequence_suggestion",
    schema: {
      type: "object",
      properties: {
        sequence: {
          type: "array",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["text", "image"] },
              text: { type: "string" },
              delayAfterSeconds: { type: "integer", minimum: 0, maximum: MAX_AI_STEP_DELAY_SECONDS },
              enabled: { type: "boolean" },
            },
            required: ["type", "text", "delayAfterSeconds", "enabled"],
            additionalProperties: false,
          },
        },
        leadDelaySeconds: { type: "integer", minimum: 0, maximum: MAX_AI_LEAD_DELAY_SECONDS },
        rationale: { type: "string" },
      },
      required: ["sequence", "leadDelaySeconds", "rationale"],
      additionalProperties: false,
    },
    taskPrompt: `Sugira uma sequencia ordenada de campanha outbound em pt-BR.
Contexto:
${JSON.stringify(context, null, 2)}

Regras:
- Entregue entre 1 e 5 passos.
- Use type=image apenas quando fizer sentido indicar um passo com imagem.
- Quando type=image, o campo text deve ser a legenda/caption sugerida ou string vazia.
- Delays em segundos: entre passos na mesma conversa prefira 60 a 900; raramente ate 1800; nunca acima de ${MAX_AI_STEP_DELAY_SECONDS} (teto do schema).
- leadDelaySeconds entre leads diferentes: prefira 30 a 180; nunca acima de ${MAX_AI_LEAD_DELAY_SECONDS}.
- Nao use markdown.
- Inclua pelo menos um passo de recuperacao com {{nome}} e curiosidade se a campanha permitir follow-up.
- Nao inclua nenhuma informacao pessoal real.`,
  });
  return clampCampaignAiDelaySuggestion(parsed);
}

export async function suggestCampaignDelays(input = {}) {
  const context = {
    campaignName: normalizeString(input.campaignName),
    goal: normalizeString(input.goal),
    style: normalizeString(input.style),
    segmentation: sanitizeSegmentContext(input.segmentation),
    sequence: sanitizeSequence(input.sequence),
    technique: buildTechniqueContext(input.style),
  };

  const parsed = await callGroqJson({
    contexto: contextoDeCampanha(input),
    schemaName: "campaign_delay_suggestion",
    schema: {
      type: "object",
      properties: {
        sequence: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              delayAfterSeconds: { type: "integer", minimum: 0, maximum: MAX_AI_STEP_DELAY_SECONDS },
            },
            required: ["id", "delayAfterSeconds"],
            additionalProperties: false,
          },
        },
        leadDelaySeconds: { type: "integer", minimum: 0, maximum: MAX_AI_LEAD_DELAY_SECONDS },
        rationale: { type: "string" },
      },
      required: ["sequence", "leadDelaySeconds", "rationale"],
      additionalProperties: false,
    },
    taskPrompt: `Sugira ordem temporal e delays para esta sequencia outbound em pt-BR.
Contexto:
${JSON.stringify(context, null, 2)}

Regras:
- Nao altere ids.
- Responda apenas com novos delays.
- Valores em segundos inteiros.
- Entre passos na mesma conversa prefira 60 a 900 segundos; raramente ate 1800; nunca acima de ${MAX_AI_STEP_DELAY_SECONDS}.
- leadDelaySeconds entre leads: prefira 30 a 180; nunca acima de ${MAX_AI_LEAD_DELAY_SECONDS}.
- Nao sugira intervalos de dias ou dezenas de horas; isso nao eh adequado para assistente de atraso entre mensagens.
- Nao inclua markdown.`,
  });
  return clampCampaignAiDelaySuggestion(parsed);
}

export async function rewriteCampaignStep(input = {}) {
  const context = {
    campaignName: normalizeString(input.campaignName),
    goal: normalizeString(input.goal),
    style: normalizeString(input.style),
    segmentation: sanitizeSegmentContext(input.segmentation),
    technique: buildTechniqueContext(input.style),
    step: {
      id: normalizeString(input.step?.id) || "step",
      type: normalizeString(input.step?.type).toLowerCase() === "image" ? "image" : "text",
      text: normalizeString(input.step?.text),
      enabled: input.step?.enabled !== false,
      hasImage: Boolean(input.step?.image?.dataUrl || input.step?.image),
      delayAfterSeconds: Number(input.step?.delayAfterSeconds) || 0,
    },
  };

  return callGroqJson({
    contexto: contextoDeCampanha(input),
    schemaName: "campaign_step_rewrite",
    schema: {
      type: "object",
      properties: {
        text: { type: "string" },
        rationale: { type: "string" },
      },
      required: ["text", "rationale"],
      additionalProperties: false,
    },
    taskPrompt: `Reescreva um unico passo de campanha outbound em pt-BR.
Contexto:
${JSON.stringify(context, null, 2)}

Regras:
- Nao altere o tipo do passo.
- Se for passo image, gere apenas a legenda/caption no campo text.
- Nao use markdown.
- Mantenha a copy pronta para WhatsApp.
- Quando o contexto indicar indecisao, use {{nome}} e abra uma curiosidade util sem pressionar.`,
  });
}
