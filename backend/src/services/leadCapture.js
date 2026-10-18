// backend/src/services/leadCapture.js
// Serviço de Captura de Leads e Diagnóstico Comercial Público do Vexo OS
// Multi-tenant: grava no tenant especificado (default: vexo-adm), dispara pelo chip do tenant,
// notifica o dono/SDR do tenant e aplica trava de honeypot + rate limit por IP.

import { toCanonicalPhone } from "./canonicalPhone.js";
import { upsertLeadByPhone } from "./leadUpsert.js";
import { sendTextMessageViaEvolution } from "./evolution.js";
import { maskPhoneForLog, normalizeTenantKey } from "./tenant.js";

/** Memória em processo para rate limit de IP (5 envios por hora). */
const ipSubmissionWindow = new Map();
const RATE_LIMIT_MAX_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/**
 * Limpa ou consulta o rate limit por IP.
 * @param {string} ip
 * @param {number} [maxAllowed=5]
 * @param {number} [windowMs=3600000]
 * @returns {boolean} true se permitido, false se excedeu
 */
export function checkCaptureRateLimit(ip, maxAllowed = RATE_LIMIT_MAX_PER_HOUR, windowMs = RATE_LIMIT_WINDOW_MS) {
  const cleanIp = String(ip || "unknown").trim();
  const now = Date.now();
  const history = ipSubmissionWindow.get(cleanIp) || [];
  
  // Filtra apenas registros na janela de tempo
  const recent = history.filter((t) => now - t < windowMs);
  
  if (recent.length >= maxAllowed) {
    ipSubmissionWindow.set(cleanIp, recent);
    return false;
  }

  recent.push(now);
  ipSubmissionWindow.set(cleanIp, recent);
  return true;
}

/** Limpa o histórico de rate limit (útil para testes unitários). */
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
 * Monta o texto que o visitante recebe no WhatsApp (conforme especificação oficial).
 * @param {object} params
 * @param {string} params.fullName
 * @param {string} [params.baseSize]
 * @param {string} [params.responseTime]
 * @returns {string}
 */
export function formatVisitorDiagnosticMessage({ fullName, baseSize, responseTime }) {
  const firstName = String(fullName || "amigo").trim().split(/\s+/)[0];
  const baseText = baseSize || "vários";
  const timeText = responseTime || "algum tempo";

  return [
    `Oi ${firstName}! Aqui é a Vexo 👋`,
    "",
    "Recebi seu pedido de diagnóstico. Estou montando com os números que você passou — chega aqui em alguns minutos.",
    "",
    `Enquanto isso: você respondeu que tem ${baseText} contatos e que o time responde em ${timeText}. Já te adianto que esse é o ponto onde a maioria das empresas perde venda sem perceber.`,
    "",
    "Até já!",
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
export const MAX_CAPTURE_DISPATCH_PER_PHONE_24H = 2;

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

  await ensureLeadCaptureDispatchesTable(pool);

  // 1. Verifica telefone nas últimas 24h
  try {
    const { rows: phoneRows } = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM public.lead_capture_dispatches
       WHERE client_id = $1 AND phone = $2 AND created_at >= now() - INTERVAL '24 hours'`,
      [clientId, phone]
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
  // 1. Trava de segurança no BANCO (proteção do chip contra spam / relé público)
  if (pool) {
    const quotaCheck = await checkCaptureDispatchQuota(pool, {
      clientId,
      phone,
      dailyLimit,
      phoneLimit,
    });

    if (!quotaCheck.allowed) {
      const blockedReason = quotaCheck.reason || "cota_excedida";
      console.warn(
        `[leadCapture] Disparo de WhatsApp BLOQUEADO para ${maskPhoneForLog(phone)} no tenant "${clientId}": ${quotaCheck.message} (${blockedReason})`
      );

      // Registra no lead que o disparo foi contido para proteção do chip (o lead continua salvo!)
      await pool.query(
        `UPDATE public.leads
         SET dados = jsonb_set(COALESCE(dados, '{}'::jsonb), '{whatsapp_dispatch_blocked_reason}', to_jsonb($1::text))
         WHERE client_id = $2 AND (telefone = $3 OR phone = $3)`,
        [blockedReason, clientId, phone]
      ).catch(() => {});

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
        `SELECT name, dispatch_webhook_token
         FROM public.lead_client_evolution_instances
         WHERE client_id = $1 AND active = true
         ORDER BY is_default DESC, created_at ASC
         LIMIT 1`,
        [clientId]
      );
      if (rows?.[0]?.name) {
        targetInstanceName = rows[0].name;
        targetToken = rows[0].dispatch_webhook_token;
      }
    } catch (err) {
      console.warn("[leadCapture] Erro ao consultar chip do tenant:", err?.message || err);
    }
  }

  // Fallback padrão para vexo-adm caso ainda não haja chip registrado no banco
  if (!targetInstanceName) {
    targetInstanceName = clientId === "vexo-adm" ? "vexo-adm-vexo-atende" : `${clientId}-atende`;
  }

  try {
    const result = await sendTextMessageViaEvolution({
      instanceName: targetInstanceName,
      number: phone,
      text: messageText,
      webhookToken: targetToken,
    });

    // Registra o disparo autorizado e realizado com sucesso no banco para contabilizar no teto
    if (pool) {
      await pool.query(
        `INSERT INTO public.lead_capture_dispatches (client_id, phone, status, instance_name)
         VALUES ($1, $2, 'sent', $3)`,
        [clientId, phone, targetInstanceName]
      ).catch((err) => {
        console.warn("[leadCapture] Aviso ao registrar disparo em lead_capture_dispatches:", err?.message || err);
      });
    }

    return { sent: true, instanceUsed: targetInstanceName, raw: result };
  } catch (sendErr) {
    console.warn(`[leadCapture] Falha no disparo automático WhatsApp para ${maskPhoneForLog(phone)}:`, sendErr?.message || sendErr);
    
    // Registra a falha no lead para que a equipe saiba e tente recontato
    if (pool) {
      await pool.query(
        `UPDATE public.leads
         SET dados = jsonb_set(COALESCE(dados, '{}'::jsonb), '{whatsapp_dispatch_error}', to_jsonb($1::text))
         WHERE client_id = $2 AND (telefone = $3 OR phone = $3)`,
        [sendErr?.message || "Falha de envio", clientId, phone]
      ).catch(() => {});
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

    // Dispara alerta para cada SDR / dono
    let sentCount = 0;
    for (const phone of validPhones) {
      await sendTextMessageViaEvolution({
        instanceName: chipInstance || "vexo-adm-vexo-atende",
        number: phone,
        text: alertText,
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

