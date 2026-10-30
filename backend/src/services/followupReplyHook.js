// Resposta do lead chegando ao follow-up pelo webhook principal (/api/hardcoded-chat-webhook).
//
// Por que aqui e não num webhook próprio: a Evolution guarda UMA url de webhook por
// instância. Registrar a do follow-up substituiria a do agente e derrubaria o
// atendimento. O webhook principal já recebe tudo (inclusive a resposta de campanha,
// repassada pelo disparo) e já filtra eco, grupo, fromMe e duplicado.
//
// Nunca lança: falhar aqui não pode impedir o agente de responder.

import { SQL_CANONICAL_PHONE } from "./canonicalPhone.js";
import { cancelFollowupCadenceOnReply } from "./followupExitGuard.js";
import { classifyConversation } from "./whatsappChatClassifier.js";

function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `****${digits.slice(-4)}` : "(sem telefone)";
}

/**
 * Registra a resposta do lead nas inscrições ativas do tenant e cancela as
 * cadências com exit_on_reply. Grava em followup_replies só o mínimo (sem o
 * texto da mensagem).
 */
export async function registerFollowupReply({ tenantId, phone, text, waMessageId = null, instanceName = null, queryFn }) {
  const result = { matched: 0, recorded: 0, cancelledSchedules: 0, cancelledJobs: 0 };
  if (!tenantId) return { ...result, skipped: "tenant_implicito" };
  if (!phone || !queryFn) return { ...result, skipped: "sem_telefone" };

  // Robô/URA/saudação automática do lado do lead não é o lead respondendo.
  if (classifyConversation(text || "").isAutomation) {
    return { ...result, skipped: "resposta_automatica" };
  }

  let schedules = [];
  try {
    const { rows } = await queryFn(
      `SELECT fs.id, fs.company_id, fs.campaign_id
         FROM followup_schedules fs
         JOIN followup_companies fco ON fco.id = fs.company_id
        WHERE fco.tenant_id = $1::text
          AND fs.status IN ('active', 'pending')
          AND ${SQL_CANONICAL_PHONE("fs.phone")} = ${SQL_CANONICAL_PHONE("$2::text")}`,
      [tenantId, phone]
    );
    schedules = rows || [];
  } catch (err) {
    console.error("[followup-reply-hook] falha ao buscar inscrições ativas:", {
      tenantId,
      phone: maskPhone(phone),
      code: err?.code || null,
      message: err?.message || String(err),
    });
    return { ...result, error: err?.message || String(err) };
  }

  if (schedules.length === 0) return result;
  result.matched = schedules.length;

  // Registrar e cancelar são independentes: falha num não impede o outro.
  const payload = JSON.stringify({ source: "hardcoded-chat-webhook", wa_message_id: waMessageId, instance: instanceName });
  const seen = new Set();
  for (const s of schedules) {
    const key = `${s.company_id}|${s.campaign_id || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await queryFn(
        `INSERT INTO followup_replies (company_id, campaign_id, phone, payload)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [s.company_id, s.campaign_id || null, phone, payload]
      );
      result.recorded++;
    } catch (err) {
      console.error("[followup-reply-hook] falha ao registrar resposta:", {
        tenantId,
        phone: maskPhone(phone),
        code: err?.code || null,
        message: err?.message || String(err),
      });
      result.error = err?.message || String(err);
    }
  }

  const cancel = await cancelFollowupCadenceOnReply({ tenantId, phone, queryFn });
  result.cancelledSchedules = cancel.cancelledSchedules || 0;
  result.cancelledJobs = cancel.cancelledJobs || 0;
  if (cancel.error) result.error = cancel.error;

  console.info("[followup-reply-hook] resposta do lead registrada", {
    tenantId,
    phone: maskPhone(phone),
    inscricoes: result.matched,
    registradas: result.recorded,
    canceladas: result.cancelledSchedules,
    jobsCancelados: result.cancelledJobs,
  });
  return result;
}
