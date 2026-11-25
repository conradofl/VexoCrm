// Motivo de pausa do lote (PR 6b do untangle, 25/11/2026). Uma regra só para "este lote pausado volta sozinho?".
//
// campaign_dispatches.pause_reason é coluna GERADA de error_message (migration 20261125030000), então ler a
// coluna ou o texto dá o mesmo resultado. pauseReasonOf prefere a coluna; quando a linha não a traz (select
// antigo, fixture de teste), aplica a MESMA regra da migration ao texto (sem diferenciar maiúscula, como o ILIKE).
import { QUOTA_PAUSE_MARKER } from "./campaignQuotaGate.js";

export const WINDOW_PAUSE_MARKER = "fora da janela de envio";

export const PAUSE_REASON = Object.freeze({
  FORA_DA_JANELA: "fora_da_janela",
  COTA_CHIP: "cota_chip",
});

/** Motivos em que o agendador retoma o lote sozinho quando scheduled_at vence. */
export const AUTO_RESUME_PAUSE_REASONS = Object.freeze([PAUSE_REASON.FORA_DA_JANELA, PAUSE_REASON.COTA_CHIP]);

export function pauseReasonFromText(errorMessage) {
  const texto = String(errorMessage || "").toLowerCase();
  if (texto.includes(WINDOW_PAUSE_MARKER)) return PAUSE_REASON.FORA_DA_JANELA;
  if (texto.includes(QUOTA_PAUSE_MARKER.toLowerCase())) return PAUSE_REASON.COTA_CHIP;
  return null;
}

export function pauseReasonOf(dispatch) {
  if (!dispatch) return null;
  if (Object.prototype.hasOwnProperty.call(dispatch, "pause_reason") && dispatch.pause_reason !== undefined) {
    return dispatch.pause_reason || null;
  }
  return pauseReasonFromText(dispatch.error_message);
}

export function isAutoResumablePause(dispatch) {
  return AUTO_RESUME_PAUSE_REASONS.includes(pauseReasonOf(dispatch));
}
