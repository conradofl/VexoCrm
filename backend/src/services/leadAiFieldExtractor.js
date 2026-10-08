// backend/src/services/leadAiFieldExtractor.js
// Pilar 4: Agente que Preenche a Ficha do Lead (Extração Semântica da Conversa para Campos Customizados)
//
// Analisa conversas de WhatsApp, extrai perfil comercial (interesse, faixa_valor, tipo_negocio, cidade_regiao, urgencia)
// e realiza merge atômico em leads.dados.campos e registro em lead_custom_fields sem sobrescrever edições manuais.

import { callLlmChatCompletion } from "../chatbot-ai-engine.js";
import { defaultGroqModel, resolveGroqLadder, classifyLlmHttpError } from "./llmModels.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";

export const COMMERCIAL_FIELD_LABELS = {
  interesse: "Interesse",
  faixa_valor: "Faixa de Valor",
  tipo_negocio: "Tipo de Negócio",
  cidade_regiao: "Cidade / Região",
  urgencia: "Urgência",
};

export const COMMERCIAL_EXTRACTION_PROMPT = `Você é um analista de inteligência comercial do CRM Vexo OS.
Sua função é analisar o histórico de mensagens trocadas no WhatsApp entre um lead e a equipe/robô comercial e extrair entidades comerciais confirmadas.

EXTRAIA EXCLUSIVAMENTE OS SEGUINTES CAMPOS EM FORMATO JSON ESTRITO:
{
  "interesse": string ou null,
  "faixa_valor": string ou null,
  "tipo_negocio": string ou null,
  "cidade_regiao": string ou null,
  "urgencia": "alta" | "media" | "baixa" | "futuro" ou null
}

DEFINIÇÃO E REGRAS DE CADA CAMPO:
1. "interesse": O que a pessoa procura comprar, contratar ou cotar (ex: "Consórcio Imobiliário", "Capital de Giro", "Permuta de Mídia", "Veículo Pesado", "Energia Solar"). Se não houver interesse claro, null.
2. "faixa_valor": Orçamento, capacidade de investimento, valor de parcela ou limite financeiro mencionado pelo próprio cliente (ex: "R$ 500k a 1M", "R$ 5.000 mensais", "R$ 200.000").
   REGRA CRÍTICA INVIOLÁVEL: NUNCA ESTIME NEM INVENTE. Se o cliente não falou explicitamente de dinheiro/valores, este campo DEVE ser null. Não deduza de profissão ou do produto.
3. "tipo_negocio": Segmento, ramo de atividade ou tipo de empresa do lead (ex: "Clínica Odontológica", "Transportadora", "Advocacia", "Comércio de Roupas", "Restaurante"). Se não informado, null.
4. "cidade_regiao": Cidade ou região onde o lead mora ou atua comercialmente (ex: "Uberlândia - MG", "São Paulo - SP", "Sul de Minas"). Se não dito, null.
5. "urgencia": Nível de urgência na contratação ("alta", "media", "baixa" ou "futuro"). Se incerto, null.

REGRAS GERAIS:
- Retorne APENAS o bloco JSON válido. Sem explicações, sem texto introdutório, sem markdown adicional além do bloco se necessário.
- O que não foi dito na conversa NÃO EXISTE. Jamais alucine dados.`;

/**
 * Normaliza mensagens de formatos diversos para uma lista de linhas de texto legíveis.
 * @param {Array<string|object>} messages
 * @returns {string[]}
 */
export function normalizeChatMessages(messages) {
  if (!Array.isArray(messages)) return [];
  return messages
    .map((m) => {
      if (!m) return "";
      if (typeof m === "string") return m.trim();
      if (typeof m.content === "string") {
        const role = m.role === "assistant" ? "Consultor" : "Lead";
        return `${role}: ${m.content.trim()}`;
      }
      if (typeof m.text === "string") {
        const sender = m.sender || m.direction || "Lead";
        return `${sender}: ${m.text.trim()}`;
      }
      if (typeof m.mensagem === "string") return m.mensagem.trim();
      if (typeof m.body === "string") return m.body.trim();
      return "";
    })
    .filter(Boolean);
}

/**
 * Sanitiza o JSON retornado pela IA, mantendo apenas valores válidos e não vazios.
 * @param {object} raw
 * @returns {Record<string, string>}
 */
export function sanitizeExtractedCommercialProfile(raw) {
  if (!raw || typeof raw !== "object") return {};
  const allowedKeys = ["interesse", "faixa_valor", "tipo_negocio", "cidade_regiao", "urgencia"];
  const invalidLiterals = new Set([
    "null",
    "none",
    "undefined",
    "não informado",
    "nao informado",
    "não falou",
    "nao falou",
    "nada ainda",
    "n/a",
    "—",
  ]);

  const result = {};
  for (const key of allowedKeys) {
    const val = raw[key];
    if (val === null || val === undefined) continue;
    const str = String(val).trim();
    if (!str) continue;
    if (invalidLiterals.has(str.toLowerCase())) continue;

    if (key === "urgencia") {
      const lower = str.toLowerCase();
      if (["alta", "media", "média", "baixa", "futuro"].includes(lower)) {
        result[key] = lower === "média" ? "media" : lower;
      }
      continue;
    }

    // Limita tamanho para evitar payloads gigantes
    result[key] = str.slice(0, 150);
  }

  return result;
}

/**
 * Tenta parsear JSON a partir do texto retornado pelo modelo (mesmo com markdown em volta).
 * @param {string} text
 * @returns {object|null}
 */
export function parseJsonSafely(text) {
  if (!text || typeof text !== "string") return null;
  const clean = text.trim();

  // 1. Parse direto
  try {
    return JSON.parse(clean);
  } catch (_) {}

  // 2. Procura bloco markdown ```json ... ```
  const codeBlockMatch = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch && codeBlockMatch[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (_) {}
  }

  // 3. Procura primeiro '{' e último '}'
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(clean.substring(start, end + 1));
    } catch (_) {}
  }

  return null;
}

/**
 * Extrai perfil comercial estruturado do histórico da conversa usando LLM.
 * @param {object} params
 * @param {Array} params.messages
 * @param {string} [params.leadName]
 * @param {object} [params.mockLlmResponse] Objeto para injeção direta em testes unitários
 * @returns {Promise<Record<string, string>>}
 */
export async function extractCommercialProfileFromChat({ messages, leadName, mockLlmResponse } = {}) {
  // Em testes unitários com mock explícito
  if (mockLlmResponse !== undefined) {
    return sanitizeExtractedCommercialProfile(mockLlmResponse);
  }

  const normalized = normalizeChatMessages(messages);
  if (normalized.length === 0) {
    return {};
  }

  const conversaTexto = normalized.slice(-100).join("\n").slice(0, 12000);
  const promptUser = `Lead: ${leadName || "Cliente"}\n\nHistórico da Conversa:\n${conversaTexto}`;

  // 1. Tenta via callLlmChatCompletion
  try {
    const rawResult = await callLlmChatCompletion({
      model: defaultGroqModel(),
      temperature: 0.1,
      max_tokens: 300,
      messages: [
        { role: "system", content: COMMERCIAL_EXTRACTION_PROMPT },
        { role: "user", content: promptUser },
      ],
    });

    if (rawResult) {
      const parsed = parseJsonSafely(rawResult);
      if (parsed) {
        return sanitizeExtractedCommercialProfile(parsed);
      }
    }
  } catch (err) {
    console.warn("[leadAiFieldExtractor] callLlmChatCompletion falhou, tentando fallback direto:", err?.message || err);
  }

  // 2. Fallback direto para Groq API
  if (process.env.GROQ_API_KEY) {
    const ladder = resolveGroqLadder(defaultGroqModel());
    for (const model of Array.from(new Set(ladder))) {
      try {
        const response = await fetch(GROQ_BASE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.1,
            max_tokens: 300,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: COMMERCIAL_EXTRACTION_PROMPT },
              { role: "user", content: promptUser },
            ],
          }),
        });

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          const diag = classifyLlmHttpError(response.status, body);
          console.warn(`[leadAiFieldExtractor] Groq ${model} falhou: ${diag.tipo}`);
          continue;
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        const parsed = parseJsonSafely(content);
        if (parsed) {
          return sanitizeExtractedCommercialProfile(parsed);
        }
      } catch (e) {
        console.warn(`[leadAiFieldExtractor] Erro na requisição direta Groq (${model}):`, e?.message || e);
      }
    }
  }

  return {};
}

/**
 * Realiza o merge atômico dos campos extraídos na ficha do lead (leads.dados.campos),
 * respeita campos editados manualmente por operadores humanos e auto-registra os
 * campos novos no catálogo lead_custom_fields do tenant.
 *
 * @param {object} pool Conexão pool com Postgres / pglite
 * @param {object} params
 * @param {string} [params.leadId] ID do lead
 * @param {string} [params.phone] Telefone alternativo do lead
 * @param {string} params.clientId Tenant ID
 * @param {Record<string, string>} params.extractedFields Campos extraídos pela IA
 * @returns {Promise<{ success: boolean, updated: boolean, reason?: string, campos?: object, aiExtractedFields?: string[], manualFields?: string[] }>}
 */
export async function syncExtractedFieldsToLead(pool, { leadId, phone, clientId, extractedFields } = {}) {
  if (!pool || !clientId || (!leadId && !phone)) {
    return { success: false, updated: false, reason: "MISSING_REQUIRED_PARAMS" };
  }

  const sanitized = sanitizeExtractedCommercialProfile(extractedFields);
  if (Object.keys(sanitized).length === 0) {
    return { success: true, updated: false, reason: "NO_EXTRACTED_FIELDS" };
  }

  // 1. Localiza o lead com isolamento estrito de client_id (Multi-Tenant)
  let querySql = "";
  let queryParams = [];

  if (leadId) {
    querySql = `SELECT id, client_id, dados FROM public.leads WHERE id = $1 AND client_id = $2 LIMIT 1`;
    queryParams = [leadId, clientId];
  } else {
    const clean = String(phone).replace(/\D/g, "");
    const last8 = clean.slice(-8);
    querySql = `
      SELECT id, client_id, dados FROM public.leads 
      WHERE client_id = $1 AND (
        phone = $2 OR telefone = $2 OR 
        phone = $3 OR telefone = $3 OR 
        phone LIKE $4 OR telefone LIKE $4
      ) LIMIT 1
    `;
    queryParams = [clientId, clean, `55${clean}`, `%${last8}`];
  }

  const { rows } = await pool.query(querySql, queryParams);
  if (!rows || rows.length === 0) {
    return { success: false, updated: false, reason: "LEAD_NOT_FOUND" };
  }

  const leadRow = rows[0];
  const actualLeadId = leadRow.id;

  // 2. Lê dados estruturados existentes
  const currentDados = leadRow.dados && typeof leadRow.dados === "object" ? { ...leadRow.dados } : {};
  const currentCampos = currentDados.campos && typeof currentDados.campos === "object" ? { ...currentDados.campos } : {};
  const manualFields = Array.isArray(currentDados.manual_fields) ? currentDados.manual_fields : [];
  const currentAiExtracted = Array.isArray(currentDados.ai_extracted_fields) ? currentDados.ai_extracted_fields : [];

  // 3. Merge: campos manuais têm prioridade absoluta (nunca são sobrescritos pela IA)
  const appliedAiKeys = [];
  for (const [key, val] of Object.entries(sanitized)) {
    if (manualFields.includes(key)) {
      // Ignora chave que foi editada manualmente por operador humano
      continue;
    }
    currentCampos[key] = val;
    appliedAiKeys.push(key);
  }

  if (appliedAiKeys.length === 0) {
    return {
      success: true,
      updated: false,
      reason: "ALL_FIELDS_PROTECTED_BY_MANUAL_EDITS",
      campos: currentCampos,
      aiExtractedFields: currentAiExtracted,
      manualFields,
    };
  }

  // 4. Auto-registra chaves novas no catálogo lead_custom_fields do tenant
  for (const key of appliedAiKeys) {
    const label = COMMERCIAL_FIELD_LABELS[key] || (key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, " "));
    try {
      await pool.query(
        `INSERT INTO public.lead_custom_fields (client_id, key, label, type)
         VALUES ($1, $2, $3, 'text')
         ON CONFLICT (client_id, key) DO NOTHING`,
        [clientId, key, label]
      );
    } catch (catErr) {
      console.warn(`[syncExtractedFields] Falha ao registrar lead_custom_field ${key}:`, catErr?.message || catErr);
    }
  }

  // 5. Atualiza dados do lead com metadados de procedência
  const updatedAiList = Array.from(new Set([...currentAiExtracted, ...appliedAiKeys]));
  currentDados.campos = currentCampos;
  currentDados.ai_extracted_fields = updatedAiList;
  currentDados.ai_last_extracted_at = new Date().toISOString();

  await pool.query(
    `UPDATE public.leads 
     SET dados = $1, updated_at = NOW() 
     WHERE id = $2 AND client_id = $3`,
    [JSON.stringify(currentDados), actualLeadId, clientId]
  );

  return {
    success: true,
    updated: true,
    leadId: actualLeadId,
    appliedFields: appliedAiKeys,
    campos: currentCampos,
    aiExtractedFields: updatedAiList,
    manualFields,
  };
}
