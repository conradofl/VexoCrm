// Helpers puros de import/normalização de leads + phone/whatsapp (movidos de server.js —
// grupo H do mapa, Onda 3 Run C). Movimento puro: corpos idênticos aos de server.js na
// revisão 0ae005a.
//
// sanitizePhone é consumida também pelo grupo D (campaign engine) e pelo G (analytics.js),
// que importam daqui.

import { gunzipSync } from "zlib";
import { normalizeString } from "../textNormalize.js";
import { sendError, ensureDb, getRequestBearerToken, normalizeBool, normalizeIsoDate, isValidBase64 } from "./httpInfra.js";
import { supabase } from "./database.js";
import { leadsTableName } from "./tenant.js";

// ---------------------------------------------------------------------------
// Webhook estilo Edge `lead-webhook` + validação de import do chat outlier
// ---------------------------------------------------------------------------
// - sanitizePhoneLeadWebhookStyle / Bearer: paridade com a Edge (telefone só dígitos; sem expandir +55).
// - validateLeadsOutlierRecord: monta uma linha para INSERT em `public.leads_outlier` a partir do JSON do outro chat.
// ---------------------------------------------------------------------------

/** Telefone só com dígitos — alinhado à Edge `lead-webhook` (sem normalização BR tipo +55). */
export function sanitizePhoneLeadWebhookStyle(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;
  const digits = normalized.replace(/\D/g, "");
  return digits || null;
}

/** Segredo Bearer do POST /api/lead-webhook (paridade Edge). Em produção, sobrescrever com LEAD_WEBHOOK_BEARER_TOKEN. */
export function getLeadWebhookBearerSecret() {
  return normalizeString(process.env.LEAD_WEBHOOK_BEARER_TOKEN) || "@Vexo2026";
}

/** Resposta JSON no mesmo estilo da Edge (sem cache no browser/proxy). */
export function sendLeadWebhookEdgeStyle(res, status, payload) {
  res.set("Cache-Control", "no-store");
  res.status(status).json(payload);
}

/** Confere Authorization: Bearer contra o segredo fixo do lead-webhook. */
export function validateLeadWebhookBearer(req, res) {
  const token = getRequestBearerToken(req);
  const expected = getLeadWebhookBearerSecret();
  if (!token || token !== expected) {
    sendLeadWebhookEdgeStyle(res, 401, { success: false, error: "Unauthorized" });
    return false;
  }
  return true;
}

/** Valores permitidos de `status_conversa` para `leads_outlier` (import do chat outlier). */
export const LEADS_OUTLIER_STATUS_CONVERSA = new Set(["aguardando_usuario", "em_atendimento", "finalizado"]);
/** Temperatura do lead (nullable). O JSON pode enviar em `status` ou `lead_temperature`. */
export const LEADS_OUTLIER_TEMPERATURE = new Set(["QUENTE", "MORNO", "FRIO"]);
/** Fases SPIN permitidas (nullable). */
export const LEADS_OUTLIER_SPIN_FASE = new Set(["situacao", "problema", "implicacao", "necessidade"]);
/** Chaves opcionais conhecidas em `dados` (string, number ou null). */
export const LEADS_OUTLIER_DADOS_KEYS = new Set([
  "nome",
  "cidade",
  "estado",
  "interesse",
  "objetivo",
  "credito",
  "parcela",
  "prazo",
  "lance_entrada_fgts",
  "experiencia_consorcio",
  "motivacao",
  "decisor",
  "melhor_horario",
]);

/** Limite máximo de registos por pedido nos endpoints de import outlier. */
export const MAX_LEADS_OUTLIER_BATCH = 2000;

/** Garante que `dados` é um objeto só com chaves permitidas e valores string | number | null. */
export function sanitizeLeadsOutlierDados(raw) {
  if (raw === undefined || raw === null) {
    return { value: {} };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "dados tem de ser um objeto simples" };
  }
  const out = {};
  for (const key of Object.keys(raw)) {
    if (!LEADS_OUTLIER_DADOS_KEYS.has(key)) {
      return { error: `dados tem chave desconhecida: ${key}` };
    }
    const v = raw[key];
    if (v === null || v === undefined) {
      out[key] = null;
      continue;
    }
    if (typeof v === "string") {
      out[key] = v;
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      out[key] = v;
      continue;
    }
    return { error: `dados.${key} tem de ser string, número ou null` };
  }
  return { value: out };
}

/** Metadados opcionais de comportamento do bot (objeto livre, sem validação de chaves). */
export function sanitizeLeadsOutlierBehaviorMeta(raw) {
  if (raw === undefined || raw === null) {
    return { value: undefined };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "behavior_meta tem de ser um objeto simples" };
  }
  return { value: raw };
}

/** Número finito opcional; vazio vira null. `fieldLabel` entra na mensagem de erro. */
export function parseOptionalFiniteNumber(value, fieldLabel) {
  if (value === undefined || value === null || value === "") {
    return { value: null };
  }
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  if (!Number.isFinite(n)) {
    return { error: `${fieldLabel} tem de ser um número finito` };
  }
  return { value: n };
}

/** UUID em string opcional; vazio vira null. */
export function parseOptionalUuid(value, fieldLabel) {
  if (value === undefined || value === null || value === "") {
    return { value: null };
  }
  const s = normalizeString(value);
  if (!s || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) {
    return { error: `${fieldLabel} tem de ser uma string UUID válida` };
  }
  return { value: s.toLowerCase() };
}

/**
 * Valida um item do payload do chat outlier. Devolve `{ row }` para insert na BD ou `{ error }`.
 * Espelha colunas de `public.leads` quando aplicável; estado do pipeline em `pipeline_status` → coluna `status`.
 * Temperatura do bot: JSON `status` ou `lead_temperature` → coluna `lead_temperature`.
 * @param {unknown} record objeto de um lead (outlier)
 * @param {string} indexLabel rótulo para erros, ex.: `items[3]`
 */
export function validateLeadsOutlierRecord(record, indexLabel = "") {
  const prefix = indexLabel ? `${indexLabel}: ` : "";
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return { error: `${prefix}cada item tem de ser um objeto simples` };
  }

  const telefone = sanitizePhone(record.telefone ?? record.Telefone);
  if (!telefone) {
    return { error: `${prefix}telefone é obrigatório e tem de ser um número de telefone válido` };
  }

  if (typeof record.mensagem !== "string") {
    return { error: `${prefix}mensagem tem de ser uma string` };
  }
  if (typeof record.finalizado !== "boolean") {
    return { error: `${prefix}finalizado tem de ser um booleano` };
  }
  if (
    typeof record.status_conversa !== "string" ||
    !LEADS_OUTLIER_STATUS_CONVERSA.has(record.status_conversa)
  ) {
    return {
      error: `${prefix}status_conversa tem de ser aguardando_usuario, em_atendimento ou finalizado`,
    };
  }

  let leadTemperature = null;
  const legacyTemp = record.status;
  if (Object.prototype.hasOwnProperty.call(record, "lead_temperature")) {
    const explicitTemp = record.lead_temperature;
    if (explicitTemp === null || explicitTemp === undefined) {
      leadTemperature = null;
    } else if (typeof explicitTemp === "string" && LEADS_OUTLIER_TEMPERATURE.has(explicitTemp)) {
      leadTemperature = explicitTemp;
    } else {
      return { error: `${prefix}lead_temperature tem de ser null, QUENTE, MORNO ou FRIO` };
    }
  } else if (legacyTemp !== undefined && legacyTemp !== null) {
    if (typeof legacyTemp !== "string" || !LEADS_OUTLIER_TEMPERATURE.has(legacyTemp)) {
      return {
        error: `${prefix}status tem de ser null, QUENTE, MORNO ou FRIO (temperatura do lead), ou use pipeline_status para o estado do pipeline no CRM`,
      };
    }
    leadTemperature = legacyTemp;
  }

  if (record.spin_fase !== undefined && record.spin_fase !== null) {
    if (typeof record.spin_fase !== "string" || !LEADS_OUTLIER_SPIN_FASE.has(record.spin_fase)) {
      return {
        error: `${prefix}spin_fase tem de ser null ou situacao, problema, implicacao, necessidade`,
      };
    }
  }

  const dadosResult = sanitizeLeadsOutlierDados(record.dados);
  if (dadosResult.error) {
    return { error: `${prefix}${dadosResult.error}` };
  }

  const behaviorResult = sanitizeLeadsOutlierBehaviorMeta(record.behavior_meta);
  if (behaviorResult.error) {
    return { error: `${prefix}${behaviorResult.error}` };
  }

  const nomeFromRecord = normalizeString(record.nome ?? record.Nome);
  const nomeFromDados =
    dadosResult.value && typeof dadosResult.value.nome === "string"
      ? normalizeString(dadosResult.value.nome)
      : null;
  const nome = nomeFromRecord ?? nomeFromDados;

  const pipelineStatus = normalizeString(
    record.pipeline_status ?? record.pipelineStatus ?? record.lead_status
  );

  const leadScoreParsed = parseOptionalFiniteNumber(record.lead_score, `${prefix}lead_score`);
  if (leadScoreParsed.error) {
    return { error: leadScoreParsed.error };
  }
  const potentialParsed = parseOptionalFiniteNumber(
    record.potential_contract_value,
    `${prefix}potential_contract_value`
  );
  if (potentialParsed.error) {
    return { error: potentialParsed.error };
  }

  const uuidResult = parseOptionalUuid(record.source_campaign_id, `${prefix}source_campaign_id`);
  if (uuidResult.error) {
    return { error: uuidResult.error };
  }

  // Linha normalizada para INSERT em `leads_outlier` (campos alinhados à tabela).
  /** @type {Record<string, unknown>} */
  const row = {
    telefone,
    mensagem: record.mensagem,
    finalizado: record.finalizado,
    status_conversa: record.status_conversa,
    lead_temperature: leadTemperature,
    status: pipelineStatus,
    spin_fase:
      record.spin_fase === undefined || record.spin_fase === null ? null : record.spin_fase,
    dados: dadosResult.value,
    nome,
    bot_ativo: record.bot_ativo !== undefined ? normalizeBool(record.bot_ativo) : false,
    historico: normalizeString(record.historico),
    data_hora: normalizeIsoDate(record.data_hora ?? record["Data e Hora"]),
    qualificacao: normalizeString(
      record.qualificacao ?? record.Qualificacao ?? record.resumo ?? record.Resumo
    ),
    ultima_interacao_bot: normalizeIsoDate(record.ultima_interacao_bot),
    ultima_interacao_usuario: normalizeIsoDate(record.ultima_interacao_usuario),
    lead_score: leadScoreParsed.value,
    potential_contract_value: potentialParsed.value,
    first_contact_at: normalizeIsoDate(record.first_contact_at),
    qualified_at: normalizeIsoDate(record.qualified_at),
    closed_at: normalizeIsoDate(record.closed_at),
    lead_origin: normalizeString(record.lead_origin),
    source_campaign_id: uuidResult.value,
  };

  if (behaviorResult.value !== undefined) {
    row.behavior_meta = behaviorResult.value;
  }

  return { row };
}
export function sanitizePhone(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  let digits = normalized.replace(/\D/g, "");
  if (!digits) return null;

  // Remove common Brazilian long-distance prefix if present.
  if (digits.startsWith("0")) {
    digits = digits.replace(/^0+/, "");
  }

  // Local/national BR numbers from spreadsheets usually arrive with 10 or 11 digits.
  // Persist them in E.164-like format using country code 55.
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("55")) {
    const national = digits.slice(2);
    if (national.length === 10) {
      return `55${national}`;
    }
  }

  if (digits.length === 13 && digits.startsWith("55")) {
    return digits;
  }

  return digits;
}

export function buildPhoneLookupVariants(value) {
  const phone = sanitizePhone(value);
  if (!phone) return [];

  const variants = new Set([phone]);

  if (phone.startsWith("55")) {
    const national = phone.slice(2);
    if (national.length === 10) {
      variants.add(`55${national.slice(0, 2)}9${national.slice(2)}`);
    }
    if (national.length === 11 && national[2] === "9") {
      variants.add(`55${national.slice(0, 2)}${national.slice(3)}`);
    }
  }

  return [...variants];
}

export function normalizePhoneToWhatsAppChatId(value) {
  const phone = sanitizePhone(value);
  return phone ? `${phone}@c.us` : null;
}

export function normalizeWhatsAppChatId(value) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  if (normalized.includes("@")) {
    const [base] = normalized.split("@");
    const digits = base.replace(/\D/g, "");
    return digits ? `${digits}@c.us` : normalized;
  }

  return normalizePhoneToWhatsAppChatId(normalized);
}

export async function getAuthorizedClientWhatsAppChatIds(clientIds = []) {
  if (!supabase) {
    throw new Error("Database is not configured");
  }

  if (!clientIds.length) {
    return new Set();
  }

  const results = await Promise.all(
    clientIds.map(async (id) => {
      try {
        const { data } = await supabase.from(leadsTableName(id)).select("telefone");
        return data || [];
      } catch {
        return [];
      }
    })
  );

  return new Set(
    results.flat()
      .map((item) => normalizePhoneToWhatsAppChatId(item.telefone))
      .filter(Boolean)
  );
}

export async function getAuthorizedWhatsAppChatIdsForRequest(req, res) {
  if (req.authAccess?.role !== "client") {
    return null;
  }

  if (!ensureDb(res)) {
    return null;
  }

  try {
    return await getAuthorizedClientWhatsAppChatIds(req.authAccess.clientIds || []);
  } catch (error) {
    console.error("authorized whatsapp chats query error:", error);
    sendError(
      res,
      500,
      "WHATSAPP_SCOPE_QUERY_FAILED",
      error instanceof Error ? error.message : "Failed to resolve WhatsApp scope"
    );
    return null;
  }
}

export async function ensureAuthorizedWhatsAppChat(req, res, chatId) {
  if (req.authAccess?.role !== "client") {
    return true;
  }

  const authorizedChatIds = await getAuthorizedWhatsAppChatIdsForRequest(req, res);
  if (!authorizedChatIds) {
    return false;
  }

  const normalizedChatId = normalizeWhatsAppChatId(chatId);
  if (normalizedChatId && authorizedChatIds.has(normalizedChatId)) {
    return true;
  }

  sendError(res, 403, "FORBIDDEN_CLIENT_SCOPE", "You do not have access to this WhatsApp chat");
  return false;
}

export async function ensureAuthorizedWhatsAppPhone(req, res, phone) {
  if (req.authAccess?.role !== "client") {
    return true;
  }

  const authorizedChatIds = await getAuthorizedWhatsAppChatIdsForRequest(req, res);
  if (!authorizedChatIds) {
    return false;
  }

  const normalizedChatId = normalizePhoneToWhatsAppChatId(phone);
  if (normalizedChatId && authorizedChatIds.has(normalizedChatId)) {
    return true;
  }

  sendError(res, 403, "FORBIDDEN_CLIENT_SCOPE", "You do not have access to this WhatsApp contact");
  return false;
}
export function parseCsvLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      const isEscapedQuote = inQuotes && line[i + 1] === '"';
      if (isEscapedQuote) {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (!inQuotes && c === ",") {
      result.push(current.trim());
      current = "";
    } else {
      current += c;
    }
  }

  result.push(current.trim());
  return result;
}

export function parseCsvToRows(csv) {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]);
  const rows = [];

  for (let i = 1; i < lines.length; i += 1) {
    const values = parseCsvLine(lines[i]);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    rows.push(row);
  }

  return rows;
}

export function normalizeHeaderKey(value) {
  const normalized = normalizeString(value);
  if (!normalized) return "";

  return normalized
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function pickRowValue(row, aliases) {
  if (!row || typeof row !== "object") return null;

  const entries = Object.entries(row);
  for (const [key, value] of entries) {
    const normalizedKey = normalizeHeaderKey(key);
    if (aliases.includes(normalizedKey)) {
      return value;
    }
  }

  return null;
}

export function normalizeImportedLead(row, clientId) {
  const telefone = sanitizePhone(
    pickRowValue(row, [
      "telefone",
      "telefones",
      "fone",
      "fones",
      "celular",
      "celulares",
      "whatsapp",
      "whatsapps",
      "phone",
      "phones",
      "numero",
      "numeros",
      "numero_telefone",
      "numero_telefones",
      "telefone_whatsapp",
      "telefones_whatsapp",
    ])
  );

  const nome = normalizeString(
    pickRowValue(row, ["nome", "name", "cliente", "contato", "lead", "responsavel"])
  );
  const tipoCliente = normalizeString(
    pickRowValue(row, ["tipo_cliente", "tipo", "perfil", "segmento", "classificacao"])
  );
  const faixaConsumo = normalizeString(
    pickRowValue(row, [
      "faixa_consumo",
      "consumo",
      "consumo_mensal",
      "valor_conta",
      "conta_de_energia",
      "ticket",
    ])
  );
  const cidade = normalizeString(pickRowValue(row, ["cidade", "city", "municipio"]));
  const estado = normalizeString(pickRowValue(row, ["estado", "uf", "state"]));
  const status = normalizeString(
    pickRowValue(row, ["status", "etapa", "situacao", "pipeline_status"])
  );
  const dataHora = normalizeIsoDate(
    pickRowValue(row, ["data_hora", "data", "created_at", "data_de_cadastro", "timestamp"])
  );
  const qualificacao = normalizeString(
    pickRowValue(row, [
      "qualificacao",
      "observacoes",
      "observacao",
      "resumo",
      "anotacoes",
      "notas",
      "descricao",
    ])
  );

  return {
    client_id: clientId,
    telefone,
    nome,
    tipo_cliente: tipoCliente,
    faixa_consumo: faixaConsumo,
    cidade,
    estado,
    status,
    data_hora: dataHora,
    qualificacao,
  };
}

export function isImportedLeadEmpty(lead) {
  return !lead.telefone && !lead.nome && !lead.cidade && !lead.qualificacao;
}

export function buildImportPreview(items) {
  return items.slice(0, 10).map((item) => ({
    rowNumber: item.rowNumber,
    telefone: item.normalized.telefone,
    nome: item.normalized.nome,
    cidade: item.normalized.cidade,
    status: item.normalized.status,
    imported: item.imported,
    skipReason: item.skipReason,
  }));
}

// ---------------------------------------------------------------------------
// Payload de memória de conversa (POST /api/conversation-memory)
// ---------------------------------------------------------------------------

/** Max decompressed conversation size for POST /api/conversation-memory (after gzip decode). */
export const MAX_CONVERSATION_BYTES = 5 * 1024 * 1024;

export function validateConversationMemoryPayload(req, res, next) {
  const body = req.body || {};
  const telefone = sanitizePhone(body.telefone);
  const conversationCompressed = normalizeString(body.conversation_compressed);
  const tamanhoOriginal = body.tamanho_original;
  const timestamp = normalizeString(body.timestamp);

  if (!telefone || !conversationCompressed || tamanhoOriginal === undefined || !timestamp) {
    sendError(
      res,
      400,
      "INVALID_BODY",
      "Missing required fields: telefone, conversation_compressed, tamanho_original, timestamp"
    );
    return;
  }

  if (!Number.isInteger(tamanhoOriginal) || tamanhoOriginal <= 0) {
    sendError(res, 400, "INVALID_BODY", "tamanho_original must be a positive integer");
    return;
  }

  if (!isValidBase64(conversationCompressed)) {
    sendError(res, 400, "INVALID_BODY", "conversation_compressed must be valid base64");
    return;
  }

  const parsedTimestamp = new Date(timestamp);
  if (Number.isNaN(parsedTimestamp.getTime())) {
    sendError(res, 400, "INVALID_BODY", "timestamp must be a valid ISO date");
    return;
  }

  let compressedBuffer;
  let decompressedBuffer;

  try {
    compressedBuffer = Buffer.from(conversationCompressed, "base64");
    if (compressedBuffer.length === 0) {
      sendError(res, 400, "INVALID_BODY", "conversation_compressed must decode to non-empty bytes");
      return;
    }
    decompressedBuffer = gunzipSync(compressedBuffer);
  } catch (error) {
    console.error("conversation memory validation failed:", {
      event: "conversation_memory_validation_failed",
      reason: "invalid_gzip_or_base64",
      message: error instanceof Error ? error.message : String(error),
    });
    sendError(res, 400, "INVALID_BODY", "conversation_compressed must be valid gzip+base64");
    return;
  }

  if (decompressedBuffer.length > MAX_CONVERSATION_BYTES) {
    sendError(
      res,
      413,
      "PAYLOAD_TOO_LARGE",
      "Decompressed conversation exceeds 5MB limit"
    );
    return;
  }

  if (decompressedBuffer.length !== tamanhoOriginal) {
    sendError(
      res,
      400,
      "INVALID_BODY",
      "tamanho_original does not match decompressed conversation size"
    );
    return;
  }

  req.conversationMemory = {
    telefone,
    conversationCompressed,
    tamanhoOriginal,
    timestamp: parsedTimestamp.toISOString(),
  };

  next();
}
