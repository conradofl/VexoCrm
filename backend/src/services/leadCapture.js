// backend/src/services/leadCapture.js
// Serviço de Captura de Leads e Diagnóstico Comercial Público do Vexo OS
// Multi-tenant: grava no tenant especificado (default: vexo-adm), dispara pelo chip do tenant,
// notifica o dono/SDR do tenant e aplica trava de honeypot + rate limit por IP.

import { toCanonicalPhone } from "./canonicalPhone.js";
import { upsertLeadByPhone, normalizeLeadPhoneKey } from "./leadUpsert.js";
import {
  parseEvolutionWebhookEndpoint,
  sendTextMessageViaEvolution,
} from "./evolution.js";
import { maskPhoneForLog, normalizeTenantKey } from "./tenant.js";

/** Memória em processo para rate limit de IP (captura e telemetria). */
const ipSubmissionWindow = new Map();
export const RATE_LIMIT_MAX_PER_HOUR = 5;
export const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Limite calibrado para telemetria de navegação (60 eventos por IP a cada 10 minutos). */
export const TELEMETRY_RATE_LIMIT_MAX = 60;
export const TELEMETRY_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

/**
 * Limpa ou consulta o rate limit por IP, reusando o mecanismo de janela deslizante em memória.
 * Suporta namespaces para isolar a cota de envio de formulários da cota de telemetria de navegação.
 * @param {string} ip
 * @param {number} [maxAllowed=5]
 * @param {number} [windowMs=3600000]
 * @param {string} [namespace="capture"]
 * @returns {boolean} true se permitido, false se excedeu
 */
export function checkCaptureRateLimit(
  ip,
  maxAllowed = RATE_LIMIT_MAX_PER_HOUR,
  windowMs = RATE_LIMIT_WINDOW_MS,
  namespace = "capture"
) {
  const cleanIp = String(ip || "unknown").trim();
  const key = `${namespace}:${cleanIp}`;
  const now = Date.now();
  const history = ipSubmissionWindow.get(key) || [];

  // Filtra apenas registros na janela de tempo
  const recent = history.filter((t) => now - t < windowMs);

  if (recent.length >= maxAllowed) {
    ipSubmissionWindow.set(key, recent);
    return false;
  }

  recent.push(now);
  ipSubmissionWindow.set(key, recent);
  return true;
}

/** Limpa o histórico de rate limit de todos os namespaces (útil para testes unitários). */
export function resetCaptureRateLimit() {
  ipSubmissionWindow.clear();
}

/**
 * Mascara o telefone para exibição amigável na tela de confirmação (ex: (34) *****-1267).
 * @param {string} phone
 * @returns {string}
 */
export function maskPhoneForDisplay(phone) {
  if (!phone) return "";
  const digits = String(phone).replace(/\D/g, "");
  if (digits.length >= 10) {
    const ddd = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2, 4) : digits.slice(0, 2);
    const last4 = digits.slice(-4);
    return `(${ddd}) *****-${last4}`;
  }
  return maskPhoneForLog(phone) || phone;
}

/**
 * Valida o payload de entrada da captura.
 * @param {Record<string, unknown>} body
 * @returns {{ valid: boolean, isBot?: boolean, error?: string, message?: string, data?: object }}
 */
export function validateCapturePayload(body = {}) {
  // 1. Armadilha Honeypot: campos ocultos que robôs preenchem
  const honeypot = body.website_url || body._hp || body.empresa_hp;
  if (honeypot && String(honeypot).trim().length > 0) {
    return { valid: false, isBot: true };
  }

  // 2. Validação do Nome
  const rawName = String(body.fullName || body.nome || "").trim();
  if (!rawName || rawName.length < 2) {
    return {
      valid: false,
      error: "NOME_OBRIGATORIO",
      message: "Por favor, informe seu nome completo.",
    };
  }

  // 3. Validação do Telefone / WhatsApp
  const rawPhone = String(body.phone || body.telefone || body.whatsapp || "").trim();
  const canonicalPhone = toCanonicalPhone(rawPhone);

  // Exige formato válido (celular brasileiro de 13 dígitos 55+DDD+9+8d ou internacional E.164 10-15 dígitos)
  const isBrMobile = /^55[1-9]{2}9[0-9]{8}$/.test(canonicalPhone);
  const isValidE164 = /^[1-9][0-9]{9,14}$/.test(canonicalPhone);

  if (!canonicalPhone || (!isBrMobile && !isValidE164)) {
    return {
      valid: false,
      error: "TELEFONE_INVALIDO",
      message: "Por favor, informe um número de WhatsApp comercial válido com DDD.",
    };
  }

  // 4. Validação de E-mail (se fornecido)
  const rawEmail = String(body.email || "").trim().toLowerCase();
  if (rawEmail) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(rawEmail)) {
      return {
        valid: false,
        error: "EMAIL_INVALIDO",
        message: "O formato do e-mail informado é inválido.",
      };
    }
  }

  // 5. Tenant multi-tenant: default 'vexo-adm'
  const rawTenant = body.client_id || body.tenant_id || "vexo-adm";
  const clientId = normalizeTenantKey(rawTenant) || "vexo-adm";

  return {
    valid: true,
    data: {
      clientId,
      fullName: rawName,
      phone: canonicalPhone,
      email: rawEmail || null,
      company: String(body.company || body.empresa || "").trim() || null,
      segment: String(body.segment || body.segmento || "").trim() || null,
      teamSize: String(body.teamSize || body.equipe || "").trim() || null,
      baseSize: String(body.baseSize || body.tamanhoBase || "").trim() || null,
      ticketMedio: String(body.ticketMedio || "").trim() || null,
      stalledLeadsPct: String(body.stalledLeadsPct || body.leadsParados || "").trim() || null,
      responseTime: String(body.responseTime || body.tempoResposta || "").trim() || null,
      followupProcess: String(body.followupProcess || body.processoFollowup || "").trim() || null,
      mainPain: String(body.mainPain || body.dorPrincipal || "").trim() || null,
      instanceName: String(body.instance_name || body.instanceName || "").trim() || null,
    },
  };
}

/**
 * Normaliza string para comparação de opções do formulário.
 * @param {string} [str]
 * @returns {string}
 */
export function normalizeOptionString(str) {
  return String(str || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Tabela canônica de opções e tetos da base de contatos.
 * O valor usado NUNCA pode passar do teto declarado pelo prospect.
 */
export const BASE_SIZE_CEILINGS = {
  "ate 2.000 contatos": 2000,
  "2.000 a 10.000 contatos": 10000,
  "10.000 a 50.000 contatos": 50000,
  "mais de 50.000 contatos": 50000,
};

/**
 * Extrai quantidade de contatos a partir do texto informado, casando a opção completa.
 * O valor resultante respeita estritamente o teto declarado na opção.
 * @param {string} [baseSize]
 * @returns {number}
 */
export function parseBaseCount(baseSize) {
  if (!baseSize) return 2000;
  const norm = normalizeOptionString(baseSize);

  // 1. Casamento com a opção completa oficial do formulário
  if (norm === "ate 2.000 contatos" || norm === "ate 2000 contatos") return 2000;
  if (norm === "2.000 a 10.000 contatos" || norm === "2000 a 10000 contatos") return 10000;
  if (norm === "10.000 a 50.000 contatos" || norm === "10000 a 50000 contatos") return 50000;
  if (norm === "mais de 50.000 contatos" || norm === "mais de 50000 contatos") return 50000;

  // 2. Fallback para faixas genéricas "X a Y": extrai o teto (Y)
  const rangeMatch = norm.match(/(\d[\d.]*)\s+a\s+(\d[\d.]*)/);
  if (rangeMatch) {
    const ceilStr = rangeMatch[2].replace(/\./g, "");
    const ceilNum = parseInt(ceilStr, 10);
    if (!isNaN(ceilNum) && ceilNum > 0) return ceilNum;
  }

  // 3. Fallback para "ate X"
  const ateMatch = norm.match(/ate\s+(\d[\d.]*)/);
  if (ateMatch) {
    const ateNum = parseInt(ateMatch[1].replace(/\./g, ""), 10);
    if (!isNaN(ateNum) && ateNum > 0) return ateNum;
  }

  // 4. Fallback para número direto único
  const cleanDigits = norm.replace(/[^\d]/g, "");
  const directNum = parseInt(cleanDigits, 10);
  if (!isNaN(directNum) && directNum > 0) return directNum;

  return 2000;
}

/**
 * Tabela canônica de opções e tetos do ticket médio.
 * O valor usado NUNCA pode passar do teto declarado pelo prospect.
 */
export const TICKET_MEDIO_CEILINGS = {
  "ate r$ 500": 500,
  "r$ 500 a r$ 2.000": 2000,
  "r$ 2.000 a r$ 5.000": 5000,
  "r$ 5.000 a r$ 20.000": 20000,
  "acima de r$ 20.000": 20000,
};

/**
 * Extrai ticket médio em reais a partir do texto informado, casando a opção completa.
 * O valor resultante respeita estritamente o teto declarado na opção.
 * @param {string} [ticket]
 * @returns {number}
 */
export function parseTicketMedio(ticket) {
  if (!ticket) return 1500;
  const norm = normalizeOptionString(ticket);

  // 1. Casamento com a opção completa oficial do formulário
  if (norm === "ate r$ 500" || norm === "ate 500") return 500;
  if (norm === "r$ 500 a r$ 2.000" || norm === "r$ 500 a r$ 2000" || norm === "500 a 2000") return 2000;
  if (norm === "r$ 2.000 a r$ 5.000" || norm === "r$ 2000 a r$ 5000" || norm === "2000 a 5000") return 5000;
  if (norm === "r$ 5.000 a r$ 20.000" || norm === "r$ 5000 a r$ 20000" || norm === "5000 a 20000") return 20000;
  if (norm === "acima de r$ 20.000" || norm === "acima de 20000") return 20000;

  // 2. Fallback para faixas genéricas "X a Y": extrai o teto (Y)
  const rangeMatch = norm.match(/(\d[\d.]*)\s+a\s+(?:r\$\s*)?(\d[\d.]*)/);
  if (rangeMatch) {
    const ceilStr = rangeMatch[2].replace(/\./g, "");
    const ceilNum = parseFloat(ceilStr);
    if (!isNaN(ceilNum) && ceilNum > 0) return ceilNum;
  }

  // 3. Fallback para "ate X"
  const ateMatch = norm.match(/ate\s+(?:r\$\s*)?(\d[\d.]*)/);
  if (ateMatch) {
    const ateNum = parseFloat(ateMatch[1].replace(/\./g, ""));
    if (!isNaN(ateNum) && ateNum > 0) return ateNum;
  }

  // 4. Fallback para número direto único
  const clean = norm.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  const num = parseFloat(clean);
  if (!isNaN(num) && num > 0) return num;

  return 1500;
}

/**
 * Tabela canônica de percentual de leads parados.
 */
export const STALLED_LEADS_PCT_OPTIONS = {
  "menos de 30% da base": 0.30,
  "30% a 50% da base": 0.40,
  "mais de 50% da base": 0.50,
  "não sei dizer (a maioria parada)": 0.50,
};

/**
 * Extrai percentual de leads parados a partir da opção selecionada.
 * @param {string} [stalled]
 * @returns {number}
 */
export function parseStalledPct(stalled) {
  if (!stalled) return 0.40;
  const norm = normalizeOptionString(stalled);

  if (norm === "menos de 30% da base" || norm === "menos de 30%") return 0.30;
  if (norm === "30% a 50% da base" || norm === "30% a 50%") return 0.40;
  if (norm === "mais de 50% da base" || norm === "mais de 50%") return 0.50;
  if (norm.includes("nao sei") || norm.includes("maioria")) return 0.50;

  const match = norm.match(/(\d+)%/);
  if (match) {
    const pct = parseInt(match[1], 10);
    if (!isNaN(pct) && pct > 0) return Math.min(pct / 100, 1.0);
  }

  return 0.40;
}

/**
 * Premissas adotadas para cálculo do diagnóstico comercial.
 */
export const DIAGNOSTIC_REPLY_RATE_PREMISE = 0.15; // 15% de resposta
export const DIAGNOSTIC_CLOSE_RATE_PREMISE = 0.05; // 5% de fechamento

/**
 * Calcula o dinheiro parado na base com premissas transparentes de mercado:
 * 15% taxa de resposta e 5% de fechamento sobre os que responderem.
 * O valor da base e do ticket NUNCA excede o teto declarado pelo prospect.
 * @param {object} params
 * @param {string} [params.baseSize]
 * @param {string} [params.ticketMedio]
 * @param {string} [params.stalledLeadsPct]
 * @returns {{ baseCount: number, ticketVal: number, pct: number, leadsParados: number, receitaPotencial: number }}
 */
export function calculateStalledRevenue({ baseSize, ticketMedio, stalledLeadsPct }) {
  const baseCount = parseBaseCount(baseSize);
  const ticketVal = parseTicketMedio(ticketMedio);
  const pct = parseStalledPct(stalledLeadsPct);

  const leadsParados = Math.round(baseCount * pct);
  // Conta honesta: 15% de resposta x 5% de fechamento
  const receitaPotencial = Math.round(
    leadsParados * DIAGNOSTIC_REPLY_RATE_PREMISE * DIAGNOSTIC_CLOSE_RATE_PREMISE * ticketVal
  );

  return {
    baseCount,
    ticketVal,
    pct,
    leadsParados,
    receitaPotencial,
  };
}

/**
 * Monta o texto que o visitante recebe no WhatsApp (conforme especificação oficial).
 * Entrega o diagnóstico do dinheiro parado no corpo da mensagem sem depender de PDF.
 * @param {object} params
 * @param {string} params.fullName
 * @param {string} [params.baseSize]
 * @param {string} [params.responseTime]
 * @param {string} [params.ticketMedio]
 * @param {string} [params.stalledLeadsPct]
 * @param {string} [params.callTime]
 * @returns {string}
 */
export function formatVisitorDiagnosticMessage({
  fullName,
  baseSize,
  responseTime,
  ticketMedio,
  stalledLeadsPct,
  callTime = "amanhã de manhã",
}) {
  const firstName = String(fullName || "amigo").trim().split(/\s+/)[0];
  const rawBase = String(baseSize || "2.000 a 10.000").trim();
  const baseText = rawBase.toLowerCase().includes("contato") ? rawBase : `${rawBase} contatos`;
  const timeText = responseTime || "30 min a 2 horas";
  const ticketText = ticketMedio || "R$ 1.000 a R$ 5.000";

  const { leadsParados, receitaPotencial } = calculateStalledRevenue({
    baseSize,
    ticketMedio,
    stalledLeadsPct,
  });

  const formattedLeads = leadsParados.toLocaleString("pt-BR");
  const formattedRevenue = receitaPotencial.toLocaleString("pt-BR");

  return [
    `Oi ${firstName}! Aqui é a Vexo 👋`,
    "Olhei os números que você passou:",
    `📊 ${baseText} na base`,
    `⏱️ time responde em ${timeText}`,
    `💰 ticket médio de ${ticketText}`,
    `Com ${formattedLeads} leads parados nesse ticket, há cerca de R$ ${formattedRevenue} esperando na sua base. Estimando 15% de resposta e 5% de fechamento.`,
    `Te ligo ${callTime} pra te mostrar como destravar isso em 3 dias. Pode ser?`,
  ].join("\n");
}

/**
 * Monta o texto de notificação imediata para o dono / SDRs do tenant.
 * @param {object} params
 * @returns {string}
 */
export function formatOwnerAlertMessage({ fullName, phone, email, answers, clientId }) {
  return [
    "🔔 *Novo Diagnóstico Comercial no Site!*",
    "",
    `👤 *Lead:* ${fullName}`,
    `📱 *WhatsApp:* ${phone}`,
    `✉️ *E-mail:* ${email || "Não informado"}`,
    `🏢 *Empresa:* ${answers.company || "Não informada"} (${answers.segment || "Geral"})`,
    `👥 *Equipe:* ${answers.teamSize || "Não informada"}`,
    `📊 *Base de Contatos:* ${answers.baseSize || "Não informada"}`,
    `💰 *Ticket Médio:* ${answers.ticketMedio || "Não informado"}`,
    `⏳ *Leads Parados:* ${answers.stalledLeadsPct || "Não informado"}`,
    `⚡ *Tempo de Resposta:* ${answers.responseTime || "Não informado"}`,
    `🔄 *Processo Follow-up:* ${answers.followupProcess || "Não informado"}`,
    `🎯 *Maior Gargalo:* ${answers.mainPain || "Não informado"}`,
    `🏢 *Tenant Destino:* ${clientId}`,
    "",
    "👉 _Lead gravado no banco com tag 'diagnostico-site'._",
  ].join("\n");
}

/**
 * Salva o lead no banco do tenant especificado com a tag 'diagnostico-site'.
 * @param {import("pg").Pool} pool
 * @param {object} params
 * @returns {Promise<{ leadId?: string, action: "inserted"|"updated" }>}
 */
export async function saveCaptureLead(pool, { clientId, phone, fullName, email, answers }) {
  if (!pool) throw new Error("Pool de banco indisponível");

  const fields = {
    nome: fullName,
    tags: ["diagnostico-site"],
    lead_origin: "diagnostico-site",
    lead_source: "organico",
    status: "NOVO",
    dados: {
      ...answers,
      email: email || null,
      captura_origem: "landing-page-diagnostico",
      submitted_at: new Date().toISOString(),
    },
  };

  const action = await upsertLeadByPhone(pool, clientId, phone, fields);

  // Insere notificação in-app para o tenant no CRM
  try {
    await pool.query(
      `INSERT INTO public.notifications (client_id, type, title, description, link)
       VALUES ($1, 'lead_capture', $2, $3, '/crm/leads')`,
      [
        clientId,
        `Novo Lead: ${fullName}`,
        `Solicitação de diagnóstico recebida pelo site (${answers.company || "Empresa"}).`,
      ]
    );
  } catch (notifErr) {
    console.warn("[leadCapture] Aviso ao gravar notificação in-app:", notifErr?.message || notifErr);
  }

  return { action };
}

/** Constantes de segurança e proteção do chip WhatsApp. */
export const DAILY_CAPTURE_DISPATCH_LIMIT_PER_TENANT = 50;
export const MAX_CAPTURE_DISPATCH_PER_PHONE_24H = 5;

export const CREATE_LEAD_CAPTURE_DISPATCHES_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS public.lead_capture_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'sent',
    instance_name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_lead_capture_dispatches_client_time 
    ON public.lead_capture_dispatches (client_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_lead_capture_dispatches_phone_time 
    ON public.lead_capture_dispatches (client_id, phone, created_at DESC);
`;

let _leadCaptureDispatchesTableEnsured = false;

/**
 * Garante que a tabela de auditoria de disparos de captura exista no banco.
 * @param {import("pg").Pool} pool
 * @returns {Promise<boolean>}
 */
export async function ensureLeadCaptureDispatchesTable(pool) {
  if (!pool) return false;
  if (_leadCaptureDispatchesTableEnsured) return true;
  try {
    await pool.query(CREATE_LEAD_CAPTURE_DISPATCHES_TABLE_SQL);
    _leadCaptureDispatchesTableEnsured = true;
    return true;
  } catch (err) {
    console.warn("[leadCapture] Erro ao garantir tabela lead_capture_dispatches:", err?.message || err);
    return false;
  }
}

/** Reseta a flag de criação da tabela (útil para testes unitários). */
export function resetLeadCaptureDispatchesTableEnsured() {
  _leadCaptureDispatchesTableEnsured = false;
}

/**
 * Verifica no banco se o envio de WhatsApp para este lead está liberado.
 * Proteção do chip contra spam / relé público:
 * 1. Mesmo telefone em 24h: máx 2 disparos. No 3º+, bloqueia.
 * 2. Teto diário global por tenant: máx 50 disparos em 24h. No 51º+, bloqueia.
 *
 * @param {import("pg").Pool} pool
 * @param {object} params
 * @param {string} params.clientId
 * @param {string} params.phone
 * @param {number} [params.dailyLimit]
 * @param {number} [params.phoneLimit]
 * @returns {Promise<{ allowed: boolean, reason?: string, message?: string, currentCount?: number }>}
 */
export async function checkCaptureDispatchQuota(
  pool,
  {
    clientId,
    phone,
    dailyLimit = DAILY_CAPTURE_DISPATCH_LIMIT_PER_TENANT,
    phoneLimit = MAX_CAPTURE_DISPATCH_PER_PHONE_24H,
  }
) {
  if (!pool) return { allowed: true };

  const cleanPhone = normalizeLeadPhoneKey(phone) || String(phone || "").trim();

  await ensureLeadCaptureDispatchesTable(pool);

  // 1. Verifica telefone nas últimas 24h
  try {
    const { rows: phoneRows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM public.lead_capture_dispatches
       WHERE client_id = $1 AND (phone = $2 OR phone = $3) AND created_at >= now() - INTERVAL '24 hours'`,
      [clientId, cleanPhone, `+${cleanPhone}`]
    );
    const phoneCount = Number(phoneRows?.[0]?.count || 0);
    if (phoneCount >= phoneLimit) {
      return {
        allowed: false,
        reason: "limite_telefone_24h",
        message: `Limite de ${phoneLimit} disparos em 24h excedido para este número.`,
        currentCount: phoneCount,
      };
    }
  } catch (err) {
    console.warn("[leadCapture] Erro ao consultar cota por telefone:", err?.message || err);
  }

  // 2. Verifica teto global do tenant nas últimas 24h
  try {
    const { rows: tenantRows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM public.lead_capture_dispatches
       WHERE client_id = $1 AND created_at >= now() - INTERVAL '24 hours'`,
      [clientId]
    );
    const tenantCount = Number(tenantRows?.[0]?.count || 0);
    if (tenantCount >= dailyLimit) {
      return {
        allowed: false,
        reason: "teto_diario_tenant_atingido",
        message: `Teto diário global de ${dailyLimit} disparos do tenant atingido.`,
        currentCount: tenantCount,
      };
    }
  } catch (err) {
    console.warn("[leadCapture] Erro ao consultar teto diário do tenant:", err?.message || err);
  }

  return { allowed: true };
}

/**
 * Dispara mensagem avulsa pelo chip do tenant via sendTextMessageViaEvolution.
 * Falha no WhatsApp NÃO perde o lead.
 * Se o teto diário ou por telefone for atingido, o disparo é bloqueado e o motivo é registrado no lead.
 *
 * @param {import("pg").Pool} pool
 * @param {object} params
 * @returns {Promise<{ sent: boolean, blocked?: boolean, reason?: string, error?: string, instanceUsed?: string }>}
 */
export async function dispatchCaptureAutoReply(
  pool,
  { clientId, phone, messageText, instanceName = null, dailyLimit, phoneLimit }
) {
  const cleanPhone = normalizeLeadPhoneKey(phone) || String(phone || "").trim();

  // 1. Trava de segurança no BANCO (proteção do chip contra spam / relé público)
  if (pool) {
    const quotaCheck = await checkCaptureDispatchQuota(pool, {
      clientId,
      phone: cleanPhone,
      dailyLimit,
      phoneLimit,
    });

    if (!quotaCheck.allowed) {
      const blockedReason = quotaCheck.reason || "cota_excedida";
      console.error(
        `[leadCapture] Disparo de WhatsApp BLOQUEADO para ${maskPhoneForLog(cleanPhone)} no tenant "${clientId}": ${quotaCheck.message} (${blockedReason})`
      );

      // Registra no lead que o disparo foi contido para proteção do chip (o lead continua salvo!)
      try {
        const updateRes = await pool.query(
          `UPDATE public.leads
           SET dados = jsonb_set(COALESCE(dados, '{}'::jsonb), '{whatsapp_dispatch_blocked_reason}', to_jsonb($1::text))
           WHERE client_id = $2 AND (telefone = $3 OR phone = $3 OR telefone = $4 OR phone = $4)`,
          [blockedReason, clientId, cleanPhone, `+${cleanPhone}`]
        );
        if (updateRes && updateRes.rowCount === 0) {
          console.warn(
            `[leadCapture] Nenhum lead encontrado para registrar whatsapp_dispatch_blocked_reason="${blockedReason}" (telefone: ${cleanPhone}, tenant: ${clientId})`
          );
        }
      } catch (updateErr) {
        console.warn(
          `[leadCapture] Falha ao registrar whatsapp_dispatch_blocked_reason no lead:`,
          updateErr?.message || updateErr
        );
      }

      return {
        sent: false,
        blocked: true,
        reason: blockedReason,
        message: quotaCheck.message,
      };
    }
  }

  let targetInstanceName = instanceName;
  let targetToken = null;

  // 2. Se não especificou instância, busca a instância padrão/ativa do tenant
  if (!targetInstanceName && pool) {
    try {
      const { rows } = await pool.query(
        `SELECT id, name, dispatch_webhook_url, dispatch_webhook_token
         FROM public.lead_client_evolution_instances
         WHERE client_id = $1 AND active = true
         ORDER BY is_default DESC, created_at ASC
         LIMIT 1`,
        [clientId]
      );
      if (rows?.[0]) {
        targetInstanceName = parseEvolutionWebhookEndpoint(rows[0].dispatch_webhook_url)?.instance || null;
        targetToken = rows[0].dispatch_webhook_token;
      }
    } catch (err) {
      console.warn("[leadCapture] Erro ao consultar chip do tenant:", err?.message || err);
    }
  }

  // Fallback de chip do tenant quando a instância técnica não for encontrada
  if (!targetInstanceName) {
    console.error(
      `[leadCapture] Nome técnico da instância Evolution não encontrado para tenant "${clientId}". URL ausente ou malformada em lead_client_evolution_instances.`
    );
    if (clientId === "vexo-adm") {
      targetInstanceName = "vexo-adm-vexo-atende";
    } else {
      console.warn(
        `[leadCapture] Tenant "${clientId}" sem chip configurado em lead_client_evolution_instances. Mensagem automática não enviada.`
      );
      if (pool) {
        try {
          const updateRes = await pool.query(
            `UPDATE public.leads
             SET dados = jsonb_set(COALESCE(dados, '{}'::jsonb), '{whatsapp_dispatch_reason}', to_jsonb('sem_chip_configurado'::text))
             WHERE client_id = $1 AND (telefone = $2 OR phone = $2 OR telefone = $3 OR phone = $3)`,
            [clientId, cleanPhone, `+${cleanPhone}`]
          );
          if (updateRes && updateRes.rowCount === 0) {
            console.warn(
              `[leadCapture] Nenhum lead encontrado para registrar whatsapp_dispatch_reason="sem_chip_configurado" (telefone: ${cleanPhone}, tenant: ${clientId})`
            );
          }
        } catch (updateErr) {
          console.warn(
            `[leadCapture] Falha ao registrar whatsapp_dispatch_reason no lead:`,
            updateErr?.message || updateErr
          );
        }
      }
      return {
        sent: false,
        reason: "SEM_CHIP_CONFIGURADO",
        error: "Tenant sem chip configurado",
        instanceUsed: null,
      };
    }
  }

  try {
    const result = await sendTextMessageViaEvolution({
      instanceName: targetInstanceName,
      number: cleanPhone,
      text: messageText,
      webhookToken: targetToken,
    });

    // Registra o disparo autorizado e realizado com sucesso no banco para contabilizar no teto
    if (pool) {
      await pool.query(
        `INSERT INTO public.lead_capture_dispatches (client_id, phone, status, instance_name)
         VALUES ($1, $2, 'sent', $3)`,
        [clientId, cleanPhone, targetInstanceName]
      ).catch((err) => {
        console.warn("[leadCapture] Aviso ao registrar disparo em lead_capture_dispatches:", err?.message || err);
      });
    }

    return { sent: true, instanceUsed: targetInstanceName, raw: result };
  } catch (sendErr) {
    console.error(
      `[leadCapture] Falha no disparo automático WhatsApp para ${maskPhoneForLog(cleanPhone)} via instância "${targetInstanceName}": ${sendErr?.message || sendErr}`
    );
    
    // Registra a falha no lead para que a equipe saiba e tente recontato
    if (pool) {
      try {
        const updateRes = await pool.query(
          `UPDATE public.leads
           SET dados = jsonb_set(COALESCE(dados, '{}'::jsonb), '{whatsapp_dispatch_error}', to_jsonb($1::text))
           WHERE client_id = $2 AND (telefone = $3 OR phone = $3 OR telefone = $4 OR phone = $4)`,
          [sendErr?.message || "Falha de envio", clientId, cleanPhone, `+${cleanPhone}`]
        );
        if (updateRes && updateRes.rowCount === 0) {
          console.warn(
            `[leadCapture] Nenhum lead encontrado para registrar whatsapp_dispatch_error (telefone: ${cleanPhone}, tenant: ${clientId}):`,
            sendErr?.message || sendErr
          );
        }
      } catch (updateErr) {
        console.warn(
          `[leadCapture] Falha ao registrar whatsapp_dispatch_error no lead:`,
          updateErr?.message || updateErr
        );
      }
    }

    return { sent: false, error: sendErr?.message || "Falha no envio da mensagem", instanceUsed: targetInstanceName };
  }
}

/**
 * Notifica o dono / equipe de SDRs cadastrada no tenant via WhatsApp.
 * Se a lista de SDRs estiver vazia, registra expressamente no log que não havia destino para o alerta.
 * @param {import("pg").Pool} pool
 * @param {object} params
 * @returns {Promise<{ alerted: boolean, reason?: string, phoneCount?: number, error?: string }>}
 */
export async function notifyOwnerOnCapture(pool, { clientId, alertText, chipInstance = null }) {
  if (!pool) return { alerted: false, reason: "SEM_POOL" };

  try {
    // 1. Busca números de SDR configurados no tenant
    const { rows: n8nRows } = await pool.query(
      `SELECT sdr_whatsapp_number, sdr_whatsapp_numbers
       FROM public.lead_client_n8n_settings
       WHERE client_id = $1
       LIMIT 1`,
      [clientId]
    ).catch(() => ({ rows: [] }));

    let sdrList = [];
    const n8n = n8nRows?.[0];
    if (n8n) {
      if (Array.isArray(n8n.sdr_whatsapp_numbers) && n8n.sdr_whatsapp_numbers.length > 0) {
        sdrList = n8n.sdr_whatsapp_numbers;
      } else if (n8n.sdr_whatsapp_number) {
        sdrList = [n8n.sdr_whatsapp_number];
      }
    }

    // Fallback para variável de ambiente se não houver SDR no tenant
    if (sdrList.length === 0 && process.env.ADMIN_ALERT_PHONE) {
      sdrList = [process.env.ADMIN_ALERT_PHONE];
    }

    const validPhones = Array.from(
      new Set(
        sdrList
          .map((n) => toCanonicalPhone(n))
          .filter((n) => n.length >= 10 && n.length <= 15)
      )
    );

    if (validPhones.length === 0) {
      console.warn(
        `[leadCapture] Alerta ao dono NÃO enviado para o tenant "${clientId}": nenhum número de SDR/Closer cadastrado em /crm/padroes-da-empresa ou ADMIN_ALERT_PHONE.`
      );
      return { alerted: false, reason: "SEM_DESTINO", phoneCount: 0 };
    }

    // 2. Descobre a instância técnica da Evolution para o disparo do alerta
    let targetInstance = null;
    let targetToken = null;

    if (chipInstance) {
      targetInstance = typeof chipInstance === "object"
        ? (parseEvolutionWebhookEndpoint(chipInstance.dispatch_webhook_url)?.instance || null)
        : (parseEvolutionWebhookEndpoint(chipInstance)?.instance || chipInstance);
    }

    if (!targetInstance && pool) {
      try {
        const { rows } = await pool.query(
          `SELECT id, name, dispatch_webhook_url, dispatch_webhook_token
           FROM public.lead_client_evolution_instances
           WHERE client_id = $1 AND active = true
           ORDER BY is_default DESC, created_at ASC
           LIMIT 1`,
          [clientId]
        );
        if (rows?.[0]) {
          targetInstance = parseEvolutionWebhookEndpoint(rows[0].dispatch_webhook_url)?.instance || null;
          targetToken = rows[0].dispatch_webhook_token;
        }
      } catch (err) {
        console.warn("[leadCapture] Erro ao consultar chip do tenant para alerta ao dono:", err?.message || err);
      }
    }

    if (!targetInstance) {
      console.error(
        `[leadCapture] Nome técnico da instância Evolution não encontrado para alerta ao dono (tenant "${clientId}"). URL ausente ou malformada em lead_client_evolution_instances.`
      );
      if (clientId === "vexo-adm") {
        targetInstance = "vexo-adm-vexo-atende";
      } else {
        console.warn(
          `[leadCapture] Tenant "${clientId}" sem chip configurado para alertar dono. Alerta não enviado.`
        );
        return { alerted: false, reason: "SEM_CHIP_CONFIGURADO", phoneCount: 0 };
      }
    }

    // Dispara alerta para cada SDR / dono
    let sentCount = 0;
    for (const phone of validPhones) {
      await sendTextMessageViaEvolution({
        instanceName: targetInstance,
        number: phone,
        text: alertText,
        webhookToken: targetToken,
      }).catch((e) => {
        console.warn(`[leadCapture] Aviso ao alertar dono/SDR ${maskPhoneForLog(phone)}:`, e?.message);
      });
      sentCount++;
    }

    return { alerted: true, phoneCount: sentCount };
  } catch (err) {
    console.warn("[leadCapture] Erro geral ao notificar dono:", err?.message || err);
    return { alerted: false, error: err?.message || err };
  }
}

