// Marca "envio iniciado" no run do lote e notas internas do run (21/11/2026).
//
// O run de campaign_dispatch_runs nasce 'claimed' logo antes do envio. Se o servidor reinicia no meio, o boot não
// tinha como saber se a chamada à Evolution aconteceu. Agora o lote grava RUN_SEND_MARKER no error_message do run
// ANTES da primeira chamada (sem coluna nova: a coluna send_started_at ficou como dívida, pede migration).
//
// Tudo que começa com "[vexo:" no error_message do run é NOTA INTERNA, nunca erro: a marca de envio e o critério que
// a conferência do boot usou ("[vexo:conferido_no_boot:dispatch|campanha|telefone]"). Quem mostra error_message ao
// cliente passa por runErrorForDisplay / isRunInternalNote.

export const RUN_INTERNAL_PREFIX = "[vexo:";
export const RUN_SEND_MARKER = "[vexo:envio_iniciado]";
export const runConferenceNote = (criterio) => `[vexo:conferido_no_boot:${criterio}]`;
// Texto do 'skipped' por dúvida no boot (igual ao de antes, que telas e relatórios já conhecem).
export const RUN_BOOT_SKIP_TEXT = "Interrompido antes da confirmação de envio (envio não confirmado no restart do servidor)";

// Sequência cortada pelo desligamento (SIGTERM, 21/11/2026): o lead recebeu passosEnviados de totalPassos.
export const runSequenceCutNote = (passosEnviados, totalPassos) => `[vexo:cortado:${passosEnviados}/${totalPassos}]`;
export const RUN_SEQUENCE_CUT_RE = /\[vexo:cortado:\d+\/\d+\]/;

/** O run tem a marca de envio iniciado (pode vir seguida de outra nota interna, como a de sequência cortada). */
export function isRunSendStarted(msg) {
  return typeof msg === "string" && msg.startsWith(RUN_SEND_MARKER);
}

export function isRunInternalNote(msg) {
  return typeof msg === "string" && msg.startsWith(RUN_INTERNAL_PREFIX);
}

/** error_message do run para mostrar ao cliente: nota interna vira null. */
export function runErrorForDisplay(msg) {
  if (msg === null || msg === undefined) return null;
  return isRunInternalNote(msg) ? null : msg;
}

export const SQL_MARK_RUN_SEND_STARTED_BY_LEAD = `UPDATE public.campaign_dispatch_runs
   SET error_message = $3
 WHERE dispatch_id = $1 AND lead_id = $2 AND status = 'claimed'`;

export const SQL_MARK_RUN_SEND_STARTED_BY_PHONE = `UPDATE public.campaign_dispatch_runs
   SET error_message = $3
 WHERE dispatch_id = $1 AND regexp_replace(phone, '\\D', '', 'g') = $2 AND status = 'claimed'`;

/**
 * Grava a marca no run 'claimed' do lead. Devolve true só se gravou em pelo menos uma linha: sem a marca, o motor NÃO
 * envia (no reinício, "sem marca" precisa provar que a chamada não aconteceu).
 */
export async function markRunSendStarted(pool, { dispatchId, leadId = null, phone = null }) {
  if (!pool || !dispatchId) return false;
  let result = { rowCount: 0 };
  if (leadId) result = await pool.query(SQL_MARK_RUN_SEND_STARTED_BY_LEAD, [dispatchId, leadId, RUN_SEND_MARKER]);
  const digits = String(phone || "").replace(/\D/g, "");
  if ((!result || !result.rowCount) && digits) {
    result = await pool.query(SQL_MARK_RUN_SEND_STARTED_BY_PHONE, [dispatchId, digits, RUN_SEND_MARKER]);
  }
  return Number(result?.rowCount || 0) > 0;
}

export const SQL_MARK_RUN_SEQUENCE_CUT_BY_LEAD = `UPDATE public.campaign_dispatch_runs
   SET error_message = COALESCE(error_message, '') || $3
 WHERE dispatch_id = $1 AND lead_id = $2 AND status = 'claimed'`;

export const SQL_MARK_RUN_SEQUENCE_CUT_BY_PHONE = `UPDATE public.campaign_dispatch_runs
   SET error_message = COALESCE(error_message, '') || $3
 WHERE dispatch_id = $1 AND regexp_replace(phone, '\\D', '', 'g') = $2 AND status = 'claimed'`;

/** Acrescenta a nota de sequência cortada ao run 'claimed' do lead (mantém a marca de envio iniciado na frente). */
export async function markRunSequenceCut(pool, { dispatchId, leadId = null, phone = null, passosEnviados, totalPassos }) {
  if (!pool || !dispatchId) return false;
  const nota = runSequenceCutNote(passosEnviados, totalPassos);
  let result = { rowCount: 0 };
  if (leadId) result = await pool.query(SQL_MARK_RUN_SEQUENCE_CUT_BY_LEAD, [dispatchId, leadId, nota]);
  const digits = String(phone || "").replace(/\D/g, "");
  if ((!result || !result.rowCount) && digits) {
    result = await pool.query(SQL_MARK_RUN_SEQUENCE_CUT_BY_PHONE, [dispatchId, digits, nota]);
  }
  return Number(result?.rowCount || 0) > 0;
}
