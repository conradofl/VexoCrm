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
export function sanitizePhone(value, defaultDdd = null) {
  const normalized = normalizeString(value);
  if (!normalized) return null;

  // 0. Barrar IDs e JIDs de grupo do WhatsApp (@g.us, @broadcast, -group)
  const low = normalized.toLowerCase();
  if (low.includes("@g.us") || low.includes("@broadcast") || low.includes("-group")) {
    return null;
  }

  let digits = normalized.replace(/\D/g, "");
  if (!digits) return null;

  // Identificador de grupo: números com 15 ou mais dígitos (ex: IDs de grupo de 18 dígitos: 120363049633060243)
  if (digits.length >= 15) {
    return null;
  }

  // Remove common Brazilian long-distance prefix if present.
  if (digits.startsWith("0")) {
    digits = digits.replace(/^0+/, "");
  }
  if (!digits) return null;

  const cleanDdd = defaultDdd ? String(defaultDdd).replace(/\D/g, "").slice(0, 2) : null;
  const hasValidDefaultDdd = cleanDdd && cleanDdd.length === 2;

  // 1. Números curtos de 8 ou 9 dígitos (sem DDD e sem DDI)
  if (digits.length === 8 || digits.length === 9) {
    if (hasValidDefaultDdd) {
      const local = digits;
      if (digits.length === 8) {
        const firstDigit = local[0];
        // Celular que perdeu o 9: primeiro dígito é 6, 7, 8 ou 9 -> adiciona o 9 (13 dígitos com DDI 55)
        if (["6", "7", "8", "9"].includes(firstDigit)) {
          return `55${cleanDdd}9${local}`;
        }
        // Fixo: primeiro dígito é 2, 3, 4 ou 5 -> mantém fixo de 8 dígitos (12 dígitos com DDI 55)
        return `55${cleanDdd}${local}`;
      }
      if (digits.length === 9) {
        // Celular de 9 dígitos -> adiciona DDI 55 + DDD -> 13 dígitos
        return `55${cleanDdd}${local}`;
      }
    }
    // Sem DDD informado, NÃO tenta adivinhar. Retorna null para marcar como incompleto
    return null;
  }

  // 2. Número local de 10 dígitos (DDD [2] + 8 dígitos)
  if (digits.length === 10) {
    const ddd = digits.slice(0, 2);
    const local = digits.slice(2);
    const firstDigit = local[0];
    // Celular que perdeu o 9: primeiro dígito é 6, 7, 8 ou 9 -> adiciona o 9 (13 dígitos)
    if (["6", "7", "8", "9"].includes(firstDigit)) {
      return `55${ddd}9${local}`;
    }
    // Fixo: primeiro dígito é 2, 3, 4 ou 5 -> mantém fixo de 8 dígitos (12 dígitos com DDI 55)
    return `55${digits}`;
  }

  // 3. Número local de 11 dígitos (DDD [2] + 9 dígitos)
  if (digits.length === 11) {
    // Se o 3º dígito for 9 (celular BR padrão), prefixa 55 -> 13 dígitos
    if (digits[2] === "9") {
      return `55${digits}`;
    }
    // Caso seja internacional de 11 dígitos (ex: EUA 1...) ou formato atípico
    return digits;
  }

  // 4. Número de 12 dígitos começando com 55 (55 + DDD [2] + 8 dígitos)
  if (digits.length === 12 && digits.startsWith("55")) {
    const ddd = digits.slice(2, 4);
    const local = digits.slice(4);
    const firstDigit = local[0];
    // Celular que perdeu o 9: primeiro dígito local é 6, 7, 8 ou 9 -> adiciona o 9 (13 dígitos)
    if (["6", "7", "8", "9"].includes(firstDigit)) {
      return `55${ddd}9${local}`;
    }
    // Fixo (começa com 2, 3, 4, 5) -> não mexe, mantém 12 dígitos
    return digits;
  }

  // 5. Número de 13 dígitos começando com 55 (55 + DDD [2] + 9 dígitos)
  if (digits.length === 13 && digits.startsWith("55")) {
    return digits;
  }

  // 6. Formatos internacionais válidos (10 a 14 dígitos) -> passa intacto
  if (digits.length >= 10 && digits.length < 15) {
    return digits;
  }

  return null;
}

export function buildPhoneLookupVariants(value) {
  if (!value) return [];
  const rawStr = String(value).trim();
  const digits = rawStr.replace(/\D/g, "");
  if (!digits) return [];

  const variants = new Set();
  variants.add(digits);
  if (rawStr.startsWith("+")) variants.add(`+${digits}`);

  const canonical = sanitizePhone(digits);
  if (canonical) {
    variants.add(canonical);
    variants.add(`+${canonical}`);
    // Se canonical é 13 dígitos BR (55 + DDD + 9 + 8 dígitos)
    if (canonical.length === 13 && canonical.startsWith("55")) {
      const ddd = canonical.slice(2, 4);
      const nineAndRest = canonical.slice(4); // 9 + 8 dígitos
      const rest = canonical.slice(5); // 8 dígitos sem o 9
      const without9 = `55${ddd}${rest}`; // 12 dígitos
      variants.add(without9);
      variants.add(`+${without9}`);
      variants.add(`${ddd}${nineAndRest}`); // 11 dígitos local
      variants.add(`${ddd}${rest}`); // 10 dígitos local
      variants.add(nineAndRest); // 9 dígitos
      variants.add(rest); // 8 dígitos
    } else if (canonical.length === 12 && canonical.startsWith("55")) {
      // Fixo BR (55 + DDD + 8 dígitos)
      const ddd = canonical.slice(2, 4);
      const rest = canonical.slice(4);
      variants.add(`${ddd}${rest}`);
      variants.add(rest);
    }
  }

  return Array.from(variants);
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

export function parseNumberValue(val) {
  if (typeof val === "number") return Number.isFinite(val) ? val : NaN;
  if (val === null || val === undefined) return NaN;
  const s = String(val).trim().replace(/^R\$\s*/i, "").trim();
  if (!s) return NaN;

  // Se contiver espaços no meio, não é um número válido (ex: "10 20")
  if (/\s/.test(s)) return NaN;

  if (s.includes(".") && s.includes(",")) {
    if (s.indexOf(".") < s.indexOf(",")) {
      // Formato brasileiro: 1.500,50
      const normalized = s.replace(/\./g, "").replace(",", ".");
      if ((normalized.match(/\./g) || []).length > 1) return NaN;
      if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return NaN;
      return parseFloat(normalized);
    } else {
      // Formato americano: 1,500.50
      const normalized = s.replace(/,/g, "");
      if ((normalized.match(/\./g) || []).length > 1) return NaN;
      if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return NaN;
      return parseFloat(normalized);
    }
  }

  // Dois ou mais pontos sem vírgula (ex: "1.2.3") -> inválido (dois pontos decimais)
  if ((s.match(/\./g) || []).length > 1) {
    return NaN;
  }

  // Duas ou mais vírgulas sem ponto (ex: "1,2,3") -> inválido
  if ((s.match(/,/g) || []).length > 1) {
    return NaN;
  }

  if (s.includes(",")) {
    const normalized = s.replace(",", ".");
    if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) return NaN;
    return parseFloat(normalized);
  }

  if (!/^-?\d+(?:\.\d+)?$/.test(s)) {
    return NaN;
  }

  return parseFloat(s);
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

export const PHONE_TARGET = "telefone";
export const EXTRA_PHONE_TARGET = "telefone_adicional";

/** Telefone da importação: sanitizado e NUNCA o 5500… que este sistema já fabricou. Devolve só os dígitos (sem "+"), ou null. */
function validImportPhone(raw, defaultDdd) {
  const sanitized = sanitizePhone(raw, defaultDdd);
  if (!sanitized) return null;
  const digits = String(sanitized).replace(/^\+/, "");
  return digits.startsWith("5500") ? null : digits;
}

/**
 * Os telefones de UMA linha quando a planilha tem mais de uma coluna de telefone. Regra (a mesma que a prévia da tela aplica; fixture
 * compartilhada shared/multiPhoneCases.json confere as duas pontas):
 *  - candidatas, na ordem em que foram mapeadas: a coluna Telefone (principal) primeiro, depois as de "Telefone adicional" na ordem do arquivo;
 *  - vazia ou inválida é descartada (nenhum número fabricado, nunca 5500…);
 *  - o PRIMEIRO telefone válido identifica o lead: principal vazio com adicional preenchido → o adicional vira o principal (a linha não se perde pela ordem);
 *  - dois telefones da mesma linha iguais depois de normalizar → guarda um só (o primeiro);
 *  - os demais válidos são os extras, cada um com a coluna de origem.
 * `brutoPrincipal` é o texto original da coluna que virou principal (ou, sem nenhum válido, o da primeira coluna preenchida: serve ao motivo da linha pulada).
 */
export function resolveRowPhones(row, mappingItems, defaultDdd = null) {
  const items = Array.isArray(mappingItems) ? mappingItems : [];
  const principal = items.find((m) => m && m.target === PHONE_TARGET);
  const adicionais = items.filter((m) => m && m.target === EXTRA_PHONE_TARGET);
  const colunas = [principal, ...adicionais].filter(Boolean);
  const candidatas = colunas.map((m) => ({
    coluna: m.column,
    bruto: row?.[m.column] !== undefined && row?.[m.column] !== null ? String(row[m.column]).trim() : "",
  }));
  const validos = [];
  const vistos = new Set();
  for (const c of candidatas) {
    if (!c.bruto) continue;
    const telefone = validImportPhone(c.bruto, defaultDdd);
    if (!telefone || vistos.has(telefone)) continue;
    vistos.add(telefone);
    validos.push({ telefone, coluna: c.coluna, bruto: c.bruto });
  }
  const [primeiro, ...resto] = validos;
  return {
    telefone: primeiro ? primeiro.telefone : null,
    colunaPrincipal: primeiro ? primeiro.coluna : null,
    brutoPrincipal: primeiro ? primeiro.bruto : (candidatas.find((c) => c.bruto)?.bruto ?? null),
    extras: resto.map((v) => ({ telefone: v.telefone, coluna: v.coluna, bruto: v.bruto })),
    candidatas,
  };
}

export function normalizeImportedLead(row, clientId, defaultDdd = null, customMapping = null) {
  let rawTelefone = null;
  let telefone = null;
  let nome = null;
  let telefonesExtras = [];
  const customCampos = {};

  const mappingItems = Array.isArray(customMapping)
    ? customMapping
    : Array.isArray(customMapping?.mapping)
    ? customMapping.mapping
    : null;

  if (mappingItems && mappingItems.length > 0) {
    const phoneMapping = mappingItems.find((m) => m.target === "telefone");
    const nameMapping = mappingItems.find((m) => m.target === "nome");
    const customItems = mappingItems.filter((m) => m.target === "custom");

    if (mappingItems.some((m) => m && m.target === EXTRA_PHONE_TARGET)) {
      // mais de uma coluna de telefone: UMA linha = UM lead; o primeiro válido identifica, os demais ficam em dados.telefones_extras
      const resolved = resolveRowPhones(row, mappingItems, defaultDdd);
      rawTelefone = resolved.brutoPrincipal;
      telefone = resolved.telefone;
      telefonesExtras = resolved.extras;
    } else {
      rawTelefone = phoneMapping ? row[phoneMapping.column] : null;
      telefone = sanitizePhone(rawTelefone, defaultDdd);
    }

    const rawNome = nameMapping ? row[nameMapping.column] : null;
    const cleanNome = normalizeString(rawNome);
    nome = cleanNome || telefone;

    for (const m of customItems) {
      const normKey = m.key || normalizeHeaderKey(m.label || m.column);
      if (!normKey) continue;

      const rawVal = row[m.column] !== undefined && row[m.column] !== null
        ? row[m.column]
        : (row.dados && typeof row.dados === "object" && row.dados.campos ? row.dados.campos[normKey] : undefined);
      if (rawVal === undefined || rawVal === null) continue;
      const str = String(rawVal).trim();
      if (str === "") continue;

      if (m.type === "number") {
        const parsed = parseNumberValue(rawVal);
        customCampos[normKey] = !Number.isNaN(parsed) ? parsed : str;
      } else {
        customCampos[normKey] = str;
      }
    }
  } else {
    rawTelefone = pickRowValue(row, [
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
    ]);

    telefone = sanitizePhone(rawTelefone, defaultDdd);

    nome = normalizeString(
      pickRowValue(row, ["nome", "name", "cliente", "contato", "lead", "responsavel"])
    );

    // Se a linha já possuir dados.campos pré-montados
    if (row.dados && typeof row.dados.campos === "object" && row.dados.campos) {
      for (const [k, v] of Object.entries(row.dados.campos)) {
        if (v !== undefined && v !== null && String(v).trim() !== "") {
          customCampos[k] = v;
        }
      }
    }
  }

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

  const dadosObj = {
    telefone_bruto: rawTelefone !== null && rawTelefone !== undefined ? String(rawTelefone).trim() : null,
  };
  if (Object.keys(customCampos).length > 0) {
    dadosObj.campos = customCampos;
  }
  if (telefonesExtras.length > 0) {
    dadosObj.telefones_extras = telefonesExtras;
  }

  return {
    client_id: clientId,
    telefone,
    nome: nome || telefone,
    tipo_cliente: tipoCliente,
    faixa_consumo: faixaConsumo,
    cidade,
    estado,
    status,
    data_hora: dataHora,
    qualificacao,
    dados: dadosObj,
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
