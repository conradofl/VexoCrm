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

function getGroqModel() {
  return process.env.GROQ_CAMPAIGN_AI_MODEL || DEFAULT_GROQ_MODEL;
}

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function sanitizeSegmentContext(segmentation = {}) {
  if (!segmentation || typeof segmentation !== "object") return {};

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

export async function suggestCampaignSequence(input = {}) {
  const context = {
    campaignName: normalizeString(input.campaignName),
    goal: normalizeString(input.goal),
    style: normalizeString(input.style),
    segmentation: sanitizeSegmentContext(input.segmentation),
    existingSequence: sanitizeSequence(input.sequence),
    technique: buildTechniqueContext(input.style),
  };

  return callGroqJson({
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
              delayAfterSeconds: { type: "integer", minimum: 0 },
              enabled: { type: "boolean" },
            },
            required: ["type", "text", "delayAfterSeconds", "enabled"],
            additionalProperties: false,
          },
        },
        leadDelaySeconds: { type: "integer", minimum: 0 },
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
- Delays devem ser inteiros em segundos.
- Nao use markdown.
- Inclua pelo menos um passo de recuperacao com {{nome}} e curiosidade se a campanha permitir follow-up.
- Nao inclua nenhuma informacao pessoal real.`,
  });
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

  return callGroqJson({
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
              delayAfterSeconds: { type: "integer", minimum: 0 },
            },
            required: ["id", "delayAfterSeconds"],
            additionalProperties: false,
          },
        },
        leadDelaySeconds: { type: "integer", minimum: 0 },
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
- Nao inclua markdown.`,
  });
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
