const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
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

function buildChatPayload({ taskPrompt, schemaName, schema }) {
  const model = getGroqModel();
  const basePayload = {
    model,
    temperature: 0.3,
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
  };

  if (STRICT_JSON_MODELS.has(model)) {
    return {
      ...basePayload,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: schemaName,
          strict: true,
          schema,
        },
      },
    };
  }

  return {
    ...basePayload,
    response_format: {
      type: "json_object",
    },
  };
}

async function callGroqJson({ taskPrompt, schemaName, schema }) {
  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_DISABLED");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(GROQ_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify(buildChatPayload({ taskPrompt, schemaName, schema })),
      signal: controller.signal,
    });

    const rawBody = await response.text();

    if (!response.ok) {
      throw new Error(rawBody || `Groq HTTP ${response.status}`);
    }

    const payload = JSON.parse(rawBody);
    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Groq retornou uma resposta vazia.");
    }

    return JSON.parse(content);
  } finally {
    clearTimeout(timeout);
  }
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

export async function generateCampaignTemplateVariants(input = {}) {
  const count = Math.min(Math.max(Number.parseInt(String(input.count ?? "8"), 10) || 8, 2), 12);
  const baseText = normalizeString(input.baseText);
  const context = {
    campaignName: normalizeString(input.campaignName),
    goal: normalizeString(input.goal),
    style: normalizeString(input.style),
    baseText,
    count,
    segmentation: sanitizeSegmentContext(input.segmentation),
    sequence: sanitizeSequence(input.sequence)
  };

  return callGroqJson({
    schemaName: "campaign_template_variants",
    schema: {
      type: "object",
      properties: {
        variants: {
          type: "array",
          minItems: count,
          maxItems: count,
          items: { type: "string" },
        },
        rationale: { type: "string" },
      },
      required: ["variants", "rationale"],
      additionalProperties: false,
    },
    taskPrompt: `Você é um especialista em comunicação via WhatsApp (pt-BR). Sua tarefa é gerar ${count} variações humanizadas da mensagem fornecida em "baseText", com o objetivo principal de servir como rotação de texto antiban (Spinfold), mantendo 100% o sentido original.

Contexto da mensagem:
${JSON.stringify(context, null, 2)}

Regras ABSOLUTAS:
1. O sentido da mensagem, a oferta e o propósito NÃO PODEM mudar. Apenas altere sinônimos, a estrutura da frase, saudações iniciais e a pontuação, criando variações sutis e naturais.
2. A mensagem precisa ser extramente coesa e alinhada ao "baseText". Mantenha o mesmo tom de voz e nível de formalidade/informalidade da mensagem original.
3. NÃO adicione técnicas de copywriting persuasivas (AIDA, PAS), não crie falsa urgência e não invente benefícios ou dores que não estejam no texto base.
4. NÃO invente perguntas se a mensagem original não for uma pergunta. NÃO invente ganchos ou promessas que descaracterizem a mensagem original.
5. Se o "baseText" for curto e direto, as variações devem ser curtas e diretas.
6. Preservar rigorosamente as variáveis no formato {{variavel}}, como {{nome}}, {{empresa}}, etc, exatamente como aparecem no texto original.
7. Não utilize markdown (negrito, itálico), listas numeradas ou emojis excessivos. Entregue mensagens limpas e prontas para envio.`,
  });
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
