// Lógica de negócio do módulo de follow-up.
// Processa webhooks, calcula scheduled_for, enfileira jobs no BullMQ.
import crypto from "crypto";
import { query, getDbClient } from "./db.js";
import { getFollowupQueue } from "./queue.js";

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
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
  if (digits.length === 11 || digits.length === 10) return `+55${digits}`;
  if (digits.length > 8) return `+${digits}`;
  return null;
}

function toMs(value, unit) {
  const v = Number(value);
  if (unit === "minutes") return v * 60 * 1000;
  if (unit === "hours") return v * 60 * 60 * 1000;
  return v * 24 * 60 * 60 * 1000;
}

function calcScheduledFor(template, triggerAt, meetingDatetime) {
  const now = triggerAt.getTime();
  const meeting = meetingDatetime ? new Date(meetingDatetime).getTime() : null;
  const delta = toMs(template.trigger_value, template.trigger_unit);

  switch (template.trigger_type) {
    case "on_schedule":
      return new Date(now);
    case "before_meeting":
      if (!meeting) return null;
      return new Date(meeting - delta);
    case "after_meeting":
      if (!meeting) return null;
      return new Date(meeting + delta);
    case "no_reply":
      return new Date(now + delta);
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

export async function processInboundWebhook(campaignId, parsedPayload) {
  const db = getDbClient();

  const { data: campaign, error: campErr } = await db
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

  const { lead_name, phone: rawPhone, meeting_datetime, calendly_event_uri, utms } =
    parsedPayload;
  const phone = normalizePhone(rawPhone);

  const utmPresent = hasUtms(utms);
  const origin_type = utmPresent ? "utm" : "default";
  const origin = utmPresent
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
      campaignId,
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
    return { scheduleId, enqueued: 0 };
  }

  // Buscar templates ativos
  const { data: templates } = await db
    .from("followup_templates")
    .select("id, trigger_type, trigger_value, trigger_unit, trigger_direction, order_index")
    .eq("campaign_id", campaignId)
    .eq("is_active", true)
    .order("order_index", { ascending: true });

  const now = new Date();
  const queue = getFollowupQueue();
  let enqueued = 0;

  for (const tpl of templates || []) {
    const scheduledFor = calcScheduledFor(tpl, now, meeting_datetime);
    if (!scheduledFor) continue;

    const delay = Math.max(0, scheduledFor.getTime() - Date.now());

    // Inserir job no banco
    const { rows: jobRows } = await query(
      `INSERT INTO followup_jobs (schedule_id, template_id, status, scheduled_for)
       VALUES ($1,$2,'pending',$3) RETURNING id`,
      [scheduleId, tpl.id, scheduledFor.toISOString()]
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

  return { scheduleId, enqueued };
}

// ─── Cancelar jobs quando campanha for arquivada ──────────────────────────────

export async function cancelPendingJobsForCampaign(campaignId) {
  await query(
    `UPDATE followup_jobs fj
        SET status = 'canceled'
       FROM followup_schedules fs
      WHERE fj.schedule_id = fs.id
        AND fs.campaign_id = $1
        AND fj.status = 'pending'`,
    [campaignId]
  );
}
