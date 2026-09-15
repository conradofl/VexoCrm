// Lógica de negócio do módulo de follow-up.
// Processa webhooks, calcula scheduled_for, enfileira jobs no BullMQ.
import crypto from "crypto";
import { query, getSupabase } from "./db.js";
import { getFollowupQueue } from "./queue.js";
import { sanitizePhone } from "../services/leadImport.js";
import {
  adjustDateToSendWindow,
  createDateInTimezone,
  getPartsInTimezone,
  resolveSendWindowConfig,
} from "../services/sendWindow.js";
import { getLeadClientN8nSettings } from "../services/n8nSettings.js";
import { SQL_CANONICAL_PHONE } from "../services/canonicalPhone.js";
import { leadsTableName } from "../services/tenant.js";

// Whitelist de âncoras suportadas no follow-up
export const ANCHOR_FIELDS = {
  meeting_datetime: { source: "schedule", recurring: false },
  data_nascimento: { source: "lead", recurring: true },
};

export const ANCHOR_FIELD_METADATA = {
  meeting_datetime: {
    label: "Data da reunião",
    description: "Data e horário agendados para a reunião",
  },
  data_nascimento: {
    label: "Aniversário",
    description: "Data de nascimento buscada automaticamente no cadastro do lead",
  },
};

export function getAnchorFieldsMetadata() {
  return Object.entries(ANCHOR_FIELDS).map(([key, config]) => ({
    key,
    label: ANCHOR_FIELD_METADATA[key]?.label || key,
    source: config.source,
    recurring: config.recurring,
    description: ANCHOR_FIELD_METADATA[key]?.description || "",
  }));
}

export function isValidAnchorField(field) {
  return typeof field === "string" && Object.prototype.hasOwnProperty.call(ANCHOR_FIELDS, field);
}

export function validateTemplatePayload(payload = {}) {
  const triggerType = payload.trigger_type;
  const anchorField = payload.anchor_field;

  if (triggerType === "before_anchor" || triggerType === "after_anchor") {
    if (!anchorField || !isValidAnchorField(anchorField)) {
      return {
        valid: false,
        code: "INVALID_ANCHOR_FIELD",
        message: `Gatilho '${triggerType}' exige um campo âncora válido (${Object.keys(ANCHOR_FIELDS).join(", ")}).`,
      };
    }
  }

  if (anchorField && !isValidAnchorField(anchorField)) {
    return {
      valid: false,
      code: "INVALID_ANCHOR_FIELD",
      message: `Campo âncora '${anchorField}' é inválido. Válidos: ${Object.keys(ANCHOR_FIELDS).join(", ")}.`,
    };
  }

  if (triggerType === "fixed_date") {
    const scheduledDate = payload.scheduled_date;
    if (!scheduledDate || typeof scheduledDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate.trim())) {
      return {
        valid: false,
        code: "INVALID_SCHEDULED_DATE",
        message: "Gatilho 'fixed_date' exige uma data agendada no formato YYYY-MM-DD.",
      };
    }
  }

  return { valid: true };
}

export function parseTimeString(timeStr) {
  if (!timeStr || typeof timeStr !== "string") return null;
  const match = timeStr.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;
  const hour = parseInt(match[1], 10);
  const minute = parseInt(match[2], 10);
  const second = match[3] ? parseInt(match[3], 10) : 0;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return null;
  return { hour, minute, second };
}

export function projectNextRecurringDate(dateInput, refDate = new Date(), timeZone = "America/Sao_Paulo") {
  if (!dateInput) return null;
  let birthYear, birthMonth, birthDay;
  if (dateInput instanceof Date && !isNaN(dateInput.getTime())) {
    const p = getPartsInTimezone(dateInput, timeZone);
    birthYear = p.year;
    birthMonth = p.month;
    birthDay = p.day;
  } else if (typeof dateInput === "string") {
    const trimmed = dateInput.trim();
    const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (isoMatch) {
      birthYear = parseInt(isoMatch[1], 10);
      birthMonth = parseInt(isoMatch[2], 10);
      birthDay = parseInt(isoMatch[3], 10);
    } else {
      const brMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
      if (brMatch) {
        birthDay = parseInt(brMatch[1], 10);
        birthMonth = parseInt(brMatch[2], 10);
        birthYear = parseInt(brMatch[3], 10);
      } else {
        const d = new Date(trimmed);
        if (isNaN(d.getTime())) return null;
        const p = getPartsInTimezone(d, timeZone);
        birthYear = p.year;
        birthMonth = p.month;
        birthDay = p.day;
      }
    }
  } else {
    return null;
  }

  const nowParts = getPartsInTimezone(refDate, timeZone);
  let targetYear = nowParts.year;

  if (
    birthMonth < nowParts.month ||
    (birthMonth === nowParts.month && birthDay < nowParts.day)
  ) {
    targetYear += 1;
  }

  let targetDay = birthDay;
  if (birthMonth === 2 && birthDay === 29) {
    const isLeap = (targetYear % 4 === 0 && targetYear % 100 !== 0) || targetYear % 400 === 0;
    if (!isLeap) targetDay = 28;
  }

  return createDateInTimezone(targetYear, birthMonth, targetDay, 0, 0, 0, timeZone);
}

export function resolveAnchorDate(anchorField, context = {}, refDate = new Date(), timeZone = "America/Sao_Paulo") {
  if (!anchorField || !isValidAnchorField(anchorField)) return null;
  const config = ANCHOR_FIELDS[anchorField];
  if (!config) return null;

  const rawValue = context[anchorField] || (anchorField === "data_nascimento" ? context.nascimento || context.birth_date : null);
  if (!rawValue) return null;

  if (config.recurring) {
    return projectNextRecurringDate(rawValue, refDate, timeZone);
  }

  const date = new Date(rawValue);
  return isNaN(date.getTime()) ? null : date;
}

// ─── Utilitários ─────────────────────────────────────────────────────────────

export function generateSecret() {
  return crypto.randomBytes(24).toString("hex");
}

export function generateWebhookUrl(campaignId) {
  const base =
    process.env.WEBHOOK_BASE_URL ||
    process.env.FRONTEND_ORIGIN?.replace(/\/$/, "") ||
    "";
  return `${base}/webhooks/followup/${campaignId}`;
}

export function verifyHmac(secret, rawBody, sigHeader) {
  if (!secret || !sigHeader) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(`sha256=${expected}`),
      Buffer.from(sigHeader)
    );
  } catch {
    return false;
  }
}

function normalizePhone(raw) {
  const sanitized = sanitizePhone(raw);
  if (!sanitized) return null;
  return sanitized.startsWith("+") ? sanitized : `+${sanitized}`;
}

function toMs(value, unit) {
  const v = Number(value);
  if (unit === "minutes") return v * 60 * 1000;
  if (unit === "hours") return v * 60 * 60 * 1000;
  return v * 24 * 60 * 60 * 1000;
}

export function calcScheduledFor(template, triggerAt, meetingDatetime, leadData = {}, options = {}) {
  const now = triggerAt.getTime();
  const meeting = meetingDatetime ? new Date(meetingDatetime).getTime() : null;
  const delta = toMs(template.trigger_value, template.trigger_unit);

  switch (template.trigger_type) {
    case "on_schedule":
      return new Date(now);
    case "after_enrollment":
      return new Date(now + delta);
    case "before_meeting":
      if (!meeting) return null;
      return new Date(meeting - delta);
    case "after_meeting":
      if (!meeting) return null;
      return new Date(meeting + delta);
    case "no_reply":
      return new Date(now + delta);
    case "before_anchor": {
      const anchorDate = resolveAnchorDate(template.anchor_field, { meeting_datetime: meetingDatetime, ...leadData }, triggerAt);
      if (!anchorDate) return null;
      return new Date(anchorDate.getTime() - delta);
    }
    case "after_anchor": {
      const anchorDate = resolveAnchorDate(template.anchor_field, { meeting_datetime: meetingDatetime, ...leadData }, triggerAt);
      if (!anchorDate) return null;
      return new Date(anchorDate.getTime() + delta);
    }
    case "fixed_date": {
      if (!template.scheduled_date) return null;
      let year, month, day;
      if (typeof template.scheduled_date === "string") {
        const match = template.scheduled_date.trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (!match) return null;
        year = parseInt(match[1], 10);
        month = parseInt(match[2], 10);
        day = parseInt(match[3], 10);
      } else if (template.scheduled_date instanceof Date && !isNaN(template.scheduled_date.getTime())) {
        // node-postgres devolve coluna DATE como Date à meia-noite UTC (sem setTypeParser
        // no projeto) — ler em getPartsInTimezone("America/Sao_Paulo") joga pro dia anterior
        // (meia-noite UTC = 21h do dia anterior em SP). Usar os getters UTC preserva o dia
        // de calendário gravado no banco, independente do timezone do processo.
        year = template.scheduled_date.getUTCFullYear();
        month = template.scheduled_date.getUTCMonth() + 1;
        day = template.scheduled_date.getUTCDate();
      } else {
        return null;
      }

      let hour = 8;
      let minute = 0;
      let second = 0;

      if (template.scheduled_time) {
        const parsedTime = parseTimeString(template.scheduled_time);
        if (parsedTime) {
          hour = parsedTime.hour;
          minute = parsedTime.minute;
          second = parsedTime.second;
        }
      } else {
        const windowConfig = options.sendWindowConfig || resolveSendWindowConfig(options.tenantSettings);
        if (windowConfig?.start) {
          const parsedStart = parseTimeString(windowConfig.start);
          if (parsedStart) {
            hour = parsedStart.hour;
            minute = parsedStart.minute;
            second = parsedStart.second || 0;
          }
        }
      }

      return createDateInTimezone(year, month, day, hour, minute, second, "America/Sao_Paulo");
    }
    default:
      return null;
  }
}

// ─── Parsing de webhooks ──────────────────────────────────────────────────────

function extractUtms(obj) {
  return {
    utm_source: obj.utm_source || null,
    utm_medium: obj.utm_medium || null,
    utm_campaign: obj.utm_campaign || null,
    utm_content: obj.utm_content || null,
    utm_term: obj.utm_term || null,
  };
}

function hasUtms(utms) {
  return Object.values(utms).some(Boolean);
}

export function parseWebhookPayload(body) {
  // Formato Calendly: event = "invitee.created"
  if (body.event === "invitee.created") {
    const inv = body.payload?.invitee || body.payload || {};
    const questions = body.payload?.questions_and_answers || [];

    let phone = inv.text_reminder_number || null;
    if (!phone) {
      const phoneQ = questions.find(
        (q) =>
          /telefone|phone|whatsapp|cel|fone/i.test(q.question || "")
      );
      if (phoneQ) phone = phoneQ.answer;
    }

    const utmObj = {};
    for (const q of questions) {
      const key = String(q.question || "").toLowerCase().replace(/[^a-z_]/g, "_");
      if (/utm_/.test(key)) utmObj[key] = q.answer;
    }
    const utms = extractUtms({ ...utmObj, ...extractUtms(inv) });

    return {
      lead_name: inv.name || "Lead",
      phone,
      meeting_datetime: body.payload?.event?.start_time || null,
      calendly_event_uri: body.payload?.event?.uri || null,
      utms,
    };
  }

  // Formato genérico
  const utms = extractUtms(body);
  return {
    lead_name: body.lead_name || body.name || "Lead",
    phone: body.phone || body.telefone || null,
    meeting_datetime: body.meeting_datetime || null,
    calendly_event_uri: null,
    utms,
  };
}

// ─── Processamento principal do webhook de entrada ───────────────────────────

const EMPTY_UTMS = {
  utm_source: null,
  utm_medium: null,
  utm_campaign: null,
  utm_content: null,
  utm_term: null,
};

// Enrola UM lead numa cadência: cria o followup_schedule e enfileira os followup_jobs
// conforme os templates (passos) ativos da campanha. Reutilizado pelo webhook de entrada
// e pelo enrolamento manual a partir do Banco de Dados. `campaign` é a linha já carregada
// de followup_campaigns; `originOverride` marca a origem (ex.: "banco_dados") no manual.
export async function enrollLead(
  campaign,
  {
    lead_name,
    phone: rawPhone,
    meeting_datetime = null,
    calendly_event_uri = null,
    utms = EMPTY_UTMS,
    originOverride = null,
    data_nascimento = null,
    lead = null,
  }
) {
  const phone = normalizePhone(rawPhone);

  const utmPresent = hasUtms(utms);
  const origin_type = originOverride ? "manual" : utmPresent ? "utm" : "default";
  const origin = originOverride
    ? originOverride
    : utmPresent
      ? utms.utm_source || "utm"
      : campaign.default_origin || null;

  // Inserir schedule
  const { rows: schedRows } = await query(
    `INSERT INTO followup_schedules
       (campaign_id, company_id, lead_name, phone, meeting_datetime,
        calendly_event_uri, status,
        origin, origin_source, origin_medium, origin_campaign,
        origin_content, origin_term, origin_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING id`,
    [
      campaign.id,
      campaign.company_id,
      lead_name,
      phone,
      meeting_datetime || null,
      calendly_event_uri,
      phone ? "active" : "missing_phone",
      origin,
      utms.utm_source,
      utms.utm_medium,
      utms.utm_campaign,
      utms.utm_content,
      utms.utm_term,
      origin_type,
    ]
  );

  const scheduleId = schedRows[0].id;

  if (!phone) {
    return {
      scheduleId,
      enqueued: 0,
      reason: "missing_phone",
      message: "Lead sem telefone válido.",
      skippedSteps: [],
    };
  }

  // Buscar templates ativos (os passos da cadência)
  const supabase = getSupabase();
  const { data: templates } = await supabase
    .from("followup_templates")
    .select("id, name, message, trigger_type, trigger_value, trigger_unit, trigger_direction, order_index, scheduled_time, scheduled_date, anchor_field")
    .eq("campaign_id", campaign.id)
    .eq("is_active", true)
    .order("order_index", { ascending: true });

  let tenantId = "geracao-digital";
  if (campaign.company_id) {
    const { rows: compRows } = await query(
      `SELECT tenant_id FROM followup_companies WHERE id = $1 LIMIT 1`,
      [campaign.company_id]
    );
    if (compRows.length && compRows[0].tenant_id) {
      tenantId = compRows[0].tenant_id;
    }
  }
  const tenantSettings = await getLeadClientN8nSettings(tenantId);
  const sendWindowConfig = resolveSendWindowConfig(tenantSettings);

  let leadBirthDate = data_nascimento || lead?.data_nascimento || null;
  if (!leadBirthDate && phone && tenantId) {
    const hasBirthdayStep = (templates || []).some(
      (t) => (t.trigger_type === "before_anchor" || t.trigger_type === "after_anchor") && t.anchor_field === "data_nascimento"
    );
    if (hasBirthdayStep) {
      leadBirthDate = await resolveLeadBirthDate({ phone, tenantId });
    }
  }

  const now = new Date();
  const queue = getFollowupQueue();
  let enqueued = 0;
  let skippedNoDate = 0;
  let skippedPastDate = 0;
  const skippedSteps = [];

  for (const tpl of templates || []) {
    // 1. calcScheduledFor (calcula a data com base em delay/dias úteis)
    let scheduledFor = calcScheduledFor(tpl, now, meeting_datetime, { ...lead, data_nascimento: leadBirthDate }, { sendWindowConfig, tenantSettings });
    if (!scheduledFor) {
      // Passo depende de data-alvo (ex.: antes/depois da reunião ou âncora) e ela não foi informada.
      skippedNoDate++;
      skippedSteps.push({
        stepId: tpl.id,
        stepName: tpl.name || `Passo ${tpl.order_index + 1}`,
        triggerType: tpl.trigger_type,
        reason: "no_date",
        message: `O passo "${tpl.name || 'Passo ' + (tpl.order_index + 1)}" exige data-alvo, e nenhuma foi informada.`,
      });
      continue;
    }

    // 2. Se scheduled_time estiver preenchido: fixa o horário nesta hora/minuto em America/Sao_Paulo (fixed_date já define hora em calcScheduledFor)
    if (tpl.scheduled_time && tpl.trigger_type !== "fixed_date") {
      const parsedTime = parseTimeString(tpl.scheduled_time);
      if (parsedTime) {
        const parts = getPartsInTimezone(scheduledFor, "America/Sao_Paulo");
        scheduledFor = createDateInTimezone(
          parts.year,
          parts.month,
          parts.day,
          parsedTime.hour,
          parsedTime.minute,
          parsedTime.second,
          "America/Sao_Paulo"
        );
        // Quando scheduled_time empurra a data para trás do agora (ex.: inscrito às 15h para 09:00),
        // soma um dia antes da janela para não disparar imediatamente com delay 0.
        if (
          scheduledFor.getTime() <= now.getTime() &&
          (tpl.trigger_type === "after_enrollment" || tpl.trigger_type === "on_schedule")
        ) {
          scheduledFor = new Date(scheduledFor.getTime() + 24 * 60 * 60 * 1000);
        }
      }
    }

    // Passo com horário que já caiu no passado (apenas para gatilhos baseados em evento passado, ex: before_meeting, before_anchor)
    if (scheduledFor.getTime() <= now.getTime() && tpl.trigger_type !== "on_schedule" && tpl.trigger_type !== "after_enrollment") {
      skippedPastDate++;
      const timeStr = scheduledFor.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const dateStr = scheduledFor.toLocaleDateString("pt-BR");
      skippedSteps.push({
        stepId: tpl.id,
        stepName: tpl.name || `Passo ${tpl.order_index + 1}`,
        triggerType: tpl.trigger_type,
        scheduledFor: scheduledFor.toISOString(),
        reason: "past_date",
        message: `O lembrete "${tpl.name || 'Passo ' + (tpl.order_index + 1)}" cairia em ${dateStr} às ${timeStr}, que já passou. Nenhuma mensagem foi agendada.`,
      });
      continue;
    }

    // 3. adjustDateToSendWindow: roda POR ÚLTIMO.
    const effectiveScheduledFor = adjustDateToSendWindow(scheduledFor, sendWindowConfig);

    const delay = Math.max(0, effectiveScheduledFor.getTime() - Date.now());

    // Inserir job no banco
    const { rows: jobRows } = await query(
      `INSERT INTO followup_jobs (schedule_id, template_id, status, scheduled_for)
       VALUES ($1,$2,'pending',$3) RETURNING id`,
      [scheduleId, tpl.id, effectiveScheduledFor.toISOString()]
    );
    const jobDbId = jobRows[0].id;

    // Enfileirar no BullMQ
    const bullJob = await queue.add(
      "send-followup",
      { jobId: jobDbId },
      { delay, jobId: `fup-${jobDbId}` }
    );

    // Salvar bull_job_id
    await query("UPDATE followup_jobs SET bull_job_id=$1 WHERE id=$2", [
      bullJob.id,
      jobDbId,
    ]);

    enqueued++;
  }

  return { scheduleId, enqueued, skippedNoDate, skippedPastDate, skippedSteps };
}

export async function processInboundWebhook(campaignId, parsedPayload) {
  const supabase = getSupabase();

  const { data: campaign, error: campErr } = await supabase
    .from("followup_campaigns")
    .select(
      "id, company_id, status, default_origin, webhook_secret"
    )
    .eq("id", campaignId)
    .maybeSingle();

  if (campErr || !campaign) throw new Error("Campanha não encontrada.");
  if (campaign.status !== "active") {
    return { skipped: true, reason: "campaign_not_active" };
  }

  const { lead_name, phone, meeting_datetime, calendly_event_uri, utms } = parsedPayload;

  return enrollLead(campaign, {
    lead_name,
    phone,
    meeting_datetime,
    calendly_event_uri,
    utms,
  });
}

// ─── Cancelar jobs quando campanha for arquivada ──────────────────────────────

export async function cancelPendingJobsForCampaign(campaignId) {
  await query(
    `UPDATE followup_jobs fj
        SET status = 'cancelled'
       FROM followup_schedules fs
      WHERE fj.schedule_id = fs.id
        AND fs.campaign_id = $1
        AND fj.status = 'pending'`,
    [campaignId]
  );
}

// ─── Resolução Compartilhada de Aniversário (Âncora) ──────────────────────────

export async function resolveLeadBirthDate({ phone, tenantId, initialBirthDate = null }) {
  if (initialBirthDate) return initialBirthDate;
  if (!phone || !tenantId) return null;
  try {
    const table = leadsTableName(tenantId);
    const { rows: leadRows } = await query(
      `SELECT data_nascimento FROM public."${table}"
        WHERE client_id = $1
          AND ${SQL_CANONICAL_PHONE("telefone")} = ${SQL_CANONICAL_PHONE("$2::text")}
          AND data_nascimento IS NOT NULL
        LIMIT 1`,
      [tenantId, phone]
    );
    if (leadRows.length && leadRows[0].data_nascimento) {
      return leadRows[0].data_nascimento;
    }
  } catch (err) {
    console.warn("[followup/service] Falha ao buscar data_nascimento na tabela de leads:", err?.message || err);
  }
  return null;
}

// ─── Reagendamento de Jobs Pendentes para um Template ─────────────────────────

export async function reschedulePendingJobsForTemplate(templateId) {
  const supabase = getSupabase();
  const { data: template, error: tplErr } = await supabase
    .from("followup_templates")
    .select("*")
    .eq("id", templateId)
    .maybeSingle();

  if (tplErr || !template) {
    const err = new Error("Template não encontrado.");
    err.code = "NOT_FOUND";
    throw err;
  }

  // Buscar todos os jobs pendentes com dados do schedule e company
  const { rows: jobs } = await query(
    `SELECT fj.id, fj.schedule_id, fj.bull_job_id, fj.scheduled_for, fj.custom_message,
            fs.lead_name, fs.phone, fs.meeting_datetime, fs.created_at as schedule_created_at,
            fs.company_id, fco.tenant_id
       FROM followup_jobs fj
       JOIN followup_schedules fs ON fs.id = fj.schedule_id
       JOIN followup_companies fco ON fco.id = fs.company_id
      WHERE fj.template_id = $1 AND fj.status = 'pending'`,
    [templateId]
  );

  if (jobs.length === 0) {
    return { success: true, rescheduledCount: 0, sampleScheduledFor: null };
  }

  const queue = getFollowupQueue();
  let rescheduledCount = 0;
  let sampleScheduledFor = null;

  for (const job of jobs) {
    const triggerAt = job.schedule_created_at ? new Date(job.schedule_created_at) : new Date();
    const tenantId = job.tenant_id || "geracao-digital";
    const tenantSettings = await getLeadClientN8nSettings(tenantId);
    const sendWindowConfig = resolveSendWindowConfig(tenantSettings);

    // Resolução de aniversário caso seja passo de âncora
    let leadBirthDate = null;
    const isBirthdayStep =
      (template.trigger_type === "before_anchor" || template.trigger_type === "after_anchor") &&
      template.anchor_field === "data_nascimento";
    if (isBirthdayStep) {
      leadBirthDate = await resolveLeadBirthDate({
        phone: job.phone,
        tenantId,
      });
    }

    let scheduledFor = calcScheduledFor(template, triggerAt, job.meeting_datetime, {
      lead_name: job.lead_name,
      phone: job.phone,
      data_nascimento: leadBirthDate,
    }, { sendWindowConfig, tenantSettings });

    if (!scheduledFor) {
      // Sem data-alvo disponível para recalcular
      continue;
    }

    if (template.scheduled_time && template.trigger_type !== "fixed_date") {
      const parsedTime = parseTimeString(template.scheduled_time);
      if (parsedTime) {
        const parts = getPartsInTimezone(scheduledFor, "America/Sao_Paulo");
        scheduledFor = createDateInTimezone(
          parts.year,
          parts.month,
          parts.day,
          parsedTime.hour,
          parsedTime.minute,
          parsedTime.second,
          "America/Sao_Paulo"
        );
        if (
          scheduledFor.getTime() <= triggerAt.getTime() &&
          (template.trigger_type === "after_enrollment" || template.trigger_type === "on_schedule")
        ) {
          scheduledFor = new Date(scheduledFor.getTime() + 24 * 60 * 60 * 1000);
        }
      }
    }

    const effectiveScheduledFor = adjustDateToSendWindow(scheduledFor, sendWindowConfig);
    const delay = Math.max(0, effectiveScheduledFor.getTime() - Date.now());

    // Remove job antigo da fila do BullMQ
    if (job.bull_job_id) {
      try {
        const existingBull = await queue.getJob(job.bull_job_id);
        if (existingBull) {
          await existingBull.remove();
        }
      } catch (remErr) {
        console.warn("[followup/service] Aviso ao remover bull job antigo:", remErr.message);
      }
    }

    // Re-enfileira no BullMQ
    const newBullJob = await queue.add(
      "send-followup",
      { jobId: job.id, customMessage: job.custom_message },
      { delay, jobId: `fup-resched-${job.id}-${Date.now()}` }
    );

    // Atualiza scheduled_for e bull_job_id no banco!
    await query(
      "UPDATE followup_jobs SET scheduled_for=$1, bull_job_id=$2 WHERE id=$3",
      [effectiveScheduledFor.toISOString(), newBullJob.id, job.id]
    );

    rescheduledCount++;
    if (!sampleScheduledFor) {
      sampleScheduledFor = effectiveScheduledFor.toISOString();
    }
  }

  return { success: true, rescheduledCount, sampleScheduledFor };
}

