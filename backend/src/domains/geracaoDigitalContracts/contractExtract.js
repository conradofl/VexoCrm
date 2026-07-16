// Extração assistida por IA dos dados do cliente para o contrato.
//
// O vendedor cola o texto cru que o cliente mandou (WhatsApp, e-mail, cartão
// CNPJ copiado...) e a IA devolve os campos estruturados. Nada é gravado
// automaticamente: o resultado apenas preenche o formulário para revisão humana
// antes de gerar o contrato.
//
// Reusa a mesma infra de IA já usada nas campanhas (Groq / API compatível com
// OpenAI) — sem dependência nem chave nova.
import { resolveTenantUuid } from "./tenantResolver.js";
import { sendError } from "../../services/httpInfra.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = "openai/gpt-oss-20b";
const STRICT_JSON_MODELS = new Set(["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);

function getModel() {
  return process.env.GROQ_CAMPAIGN_AI_MODEL || DEFAULT_GROQ_MODEL;
}

// Campos que a IA deve tentar identificar no texto colado.
const CONTRACT_SCHEMA = {
  type: "object",
  properties: {
    razao_social: { type: "string", description: "Razão social / nome da empresa contratante" },
    cnpj: { type: "string", description: "CNPJ formatado 00.000.000/0000-00" },
    representante: { type: "string", description: "Nome do responsável legal que assina" },
    telefone: { type: "string", description: "Telefone principal" },
    telefone2: { type: "string", description: "Telefone secundário, se houver" },
    email: { type: "string", description: "E-mail de contato" },
    endereco: { type: "string", description: "Endereço completo: rua, nº, bairro, cidade/UF" },
  },
  required: ["razao_social", "cnpj", "representante", "telefone", "telefone2", "email", "endereco"],
  additionalProperties: false,
};

const SYSTEM_PROMPT =
  "Você extrai dados cadastrais de empresas a partir de texto solto em português do Brasil " +
  "(mensagens de WhatsApp, e-mails, cartão CNPJ). Responda APENAS com JSON válido, sem markdown. " +
  "Regras: NUNCA invente dados — se um campo não estiver claramente presente no texto, retorne string vazia. " +
  "Formate CNPJ como 00.000.000/0000-00 e telefones como (00) 00000-0000. " +
  "Não confunda o nome da pessoa (representante) com a razão social da empresa.";

export async function extractContractData(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;

    const { texto } = req.body || {};
    if (!texto || String(texto).trim().length < 10) {
      return sendError(res, 400, "BAD_REQUEST", "Cole o texto com os dados do cliente para a IA extrair.");
    }

    if (!process.env.GROQ_API_KEY) {
      return sendError(res, 503, "AI_DISABLED", "IA indisponível: GROQ_API_KEY não configurada no servidor.");
    }

    const model = getModel();
    const payload = {
      model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Extraia os dados cadastrais do texto abaixo:\n\n"""\n${String(texto).slice(0, 8000)}\n"""` },
      ],
      response_format: STRICT_JSON_MODELS.has(model)
        ? { type: "json_schema", json_schema: { name: "contract_data", strict: true, schema: CONTRACT_SCHEMA } }
        : { type: "json_object" },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let parsed;
    try {
      const response = await fetch(GROQ_BASE_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const rawBody = await response.text();
      if (!response.ok) throw new Error(rawBody || `Groq HTTP ${response.status}`);
      const data = JSON.parse(rawBody);
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error("A IA retornou uma resposta vazia.");
      parsed = JSON.parse(content);
    } finally {
      clearTimeout(timeout);
    }

    // Devolve só as chaves conhecidas, como string — o front decide o que aplicar.
    const out = {};
    for (const key of Object.keys(CONTRACT_SCHEMA.properties)) {
      out[key] = typeof parsed?.[key] === "string" ? parsed[key].trim() : "";
    }

    res.json({ success: true, data: out });
  } catch (error) {
    console.error("[extractContractData] Error:", error);
    if (!res.headersSent) {
      sendError(res, 500, "INTERNAL_ERROR", "Erro ao extrair os dados com a IA.");
    }
  }
}
