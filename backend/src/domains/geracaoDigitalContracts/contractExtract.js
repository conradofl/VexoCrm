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
import { defaultGroqModel, STRICT_JSON_MODELS } from "../../services/llmModels.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = defaultGroqModel();

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

    // Extrator Heurístico de Fallback por Regex (caso a IA retorne vazio ou falhe em chaves específicas)
    const textRaw = String(texto || "");

    if (!out.cnpj) {
      const cnpjMatch = textRaw.match(/cnpj[\s:]*([0-9.\-\/]{8,20})/i) || textRaw.match(/([0-9]{2}[\.\s]?[0-9]{3}[\.\s]?[0-9]{3}[\/\s]?[0-9]{4}[\.\-\s]?[0-9]{2})/);
      if (cnpjMatch) out.cnpj = cnpjMatch[1].trim();
    }

    if (!out.telefone) {
      const tel1Match = textRaw.match(/telefone[\s:1]*([0-9\s.()\-\+]{8,20})/i) || textRaw.match(/tel[\s:]*([0-9\s.()\-\+]{8,20})/i) || textRaw.match(/celular[\s:]*([0-9\s.()\-\+]{8,20})/i) || textRaw.match(/([0-9]{2}\s?[0-9]{4,5}[\-\s]?[0-9]{4})/);
      if (tel1Match) out.telefone = tel1Match[1].trim();
    }

    if (!out.telefone2) {
      const tel2Match = textRaw.match(/telefone\s*2[\s:]*([0-9\s.()\-\+]{8,20})/i) || textRaw.match(/tel\s*2[\s:]*([0-9\s.()\-\+]{8,20})/i);
      if (tel2Match) out.telefone2 = tel2Match[1].trim();
    }

    if (!out.representante) {
      const repMatch = textRaw.match(/representante[\s:]*([^\n\r,]+)/i) || textRaw.match(/responsavel[\s:]*([^\n\r,]+)/i);
      if (repMatch) out.representante = repMatch[1].trim();
    }

    if (!out.email) {
      const emailMatch = textRaw.match(/email[\s:]*([^\s\n\r]+@[^\s\n\r]+)/i) || textRaw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emailMatch) out.email = emailMatch[1].trim();
    }

    if (!out.razao_social) {
      const rsMatch = textRaw.match(/raz[aã]o\s*social[\s:]*([^\n\r,]+)/i) || textRaw.match(/empresa[\s:]*([^\n\r,]+)/i);
      if (rsMatch) out.razao_social = rsMatch[1].trim();
    }

    res.json({ success: true, data: out });
  } catch (error) {
    console.error("[extractContractData] Error:", error);
    if (!res.headersSent) {
      sendError(res, 500, "INTERNAL_ERROR", "Erro ao extrair os dados com a IA.");
    }
  }
}
