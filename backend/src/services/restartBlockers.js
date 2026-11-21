// O que impede reiniciar o servidor agora (/health -> restartBlockers), 20/11/2026.
//
// O log de boot de 19/11 23:20:18Z (merge do #281) pausou 2 lotes da Nous com o /health dizendo activeDispatchesCount 0.
// Esse contador só vê lote 'running'. Um merge reinicia o bk-vexo de 3 a 5 min depois, e nesse meio tempo começa:
// - lote 'scheduled' cujo scheduled_at vence (o agendador pega no próximo tick);
// - lote 'paused' "fora da janela de envio" ou "cota diária do chip atingida", que o agendador RETOMA sozinho quando o
//   scheduled_at vence (campaigns/routes.js, tick do agendador);
// - campanha recorrente cujo next_run_at vence (services/campaignRecurrenceOccurrences.js).
// restartSafe = nada enviando E nada disso nos próximos 15 min. Lote interrupted/paused sem retomada automática e lead
// 'claimed' sem confirmação aparecem só como informação. Consulta que falha = restartSafe false (na dúvida, segura).
// Só leitura.

import { QUOTA_PAUSE_MARKER } from "./campaignQuotaGate.js";
import { RUN_BOOT_SKIP_TEXT } from "./runSendMarker.js";

export const SCHEDULED_SOON_MINUTES = 15;
const WINDOW_PAUSE_MARKER = "fora da janela de envio";

export const SQL_RESTART_BLOCKERS = `
  SELECT
    (SELECT count(*)::int FROM public.campaign_dispatches WHERE status = 'running') AS running,
    (SELECT count(*)::int FROM public.campaign_dispatches
      WHERE status = 'scheduled' AND scheduled_at IS NOT NULL
        AND scheduled_at <= $1::timestamptz + make_interval(mins => $2)) AS lotes_agendados,
    (SELECT count(*)::int FROM public.campaign_dispatches
      WHERE status = 'paused' AND scheduled_at IS NOT NULL
        AND scheduled_at <= $1::timestamptz + make_interval(mins => $2)
        AND (error_message ILIKE '%' || $3 || '%' OR error_message ILIKE '%' || $4 || '%')) AS lotes_que_voltam_sozinhos,
    (SELECT count(*)::int FROM public.campaigns
      WHERE is_recurring = true AND archived_at IS NULL AND status IN ('active', 'scheduled')
        AND recurrence_end_type IS NOT NULL AND next_run_at IS NOT NULL
        AND next_run_at <= $1::timestamptz + make_interval(mins => $2)) AS recorrentes,
    (SELECT count(*)::int FROM public.campaign_dispatches WHERE status = 'interrupted') AS interrupted,
    (SELECT count(*)::int FROM public.campaign_dispatches WHERE status = 'paused') AS paused,
    (SELECT count(*)::int FROM public.campaign_dispatch_runs r
      JOIN public.campaign_dispatches d ON d.id = r.dispatch_id
      WHERE r.status = 'claimed' AND d.status = 'running') AS claimed_sem_confirmacao,
    (SELECT count(*)::int FROM public.campaign_dispatch_runs
      WHERE status = 'skipped' AND error_message = $5
        AND COALESCE(claimed_at, created_at) >= $1::timestamptz - interval '24 hours') AS skipped_sem_confirmacao_24h,
    (SELECT count(*)::int FROM public.campaign_dispatch_runs
      WHERE error_message LIKE '%[vexo:cortado:%'
        AND COALESCE(claimed_at, created_at) >= $1::timestamptz - interval '24 hours') AS sequencias_cortadas_24h
`;

function naoMedido(checkedAt, motivo) {
  return {
    restartSafe: false,
    measured: false,
    reason: motivo,
    running: null,
    scheduledSoon: null,
    scheduledSoonDetail: null,
    windowMinutes: SCHEDULED_SOON_MINUTES,
    informativo: null,
    checkedAt,
  };
}

export async function computeRestartBlockers(pool, { now = new Date() } = {}) {
  const checkedAt = now.toISOString();
  if (!pool) return naoMedido(checkedAt, "sem_banco");
  let row;
  try {
    const { rows } = await pool.query(SQL_RESTART_BLOCKERS, [checkedAt, SCHEDULED_SOON_MINUTES, WINDOW_PAUSE_MARKER, QUOTA_PAUSE_MARKER, RUN_BOOT_SKIP_TEXT]);
    row = rows[0] || {};
  } catch (err) {
    return naoMedido(checkedAt, `consulta_falhou: ${String(err?.code || err?.message || err).slice(0, 80)}`);
  }
  const int = (v) => Number(v) || 0;
  const running = int(row.running);
  const detalhe = {
    lotesAgendados: int(row.lotes_agendados),
    lotesQueVoltamSozinhos: int(row.lotes_que_voltam_sozinhos),
    recorrentes: int(row.recorrentes),
  };
  const scheduledSoon = detalhe.lotesAgendados + detalhe.lotesQueVoltamSozinhos + detalhe.recorrentes;
  return {
    restartSafe: running === 0 && scheduledSoon === 0,
    measured: true,
    running,
    scheduledSoon,
    scheduledSoonDetail: detalhe,
    windowMinutes: SCHEDULED_SOON_MINUTES,
    informativo: {
      interrupted: int(row.interrupted),
      paused: int(row.paused),
      claimedSemConfirmacao: int(row.claimed_sem_confirmacao),
      // Runs que a conferência do boot deixou 'skipped' por dúvida (chamada feita, sem eco) nas últimas 24 h.
      skippedSemConfirmacao24h: int(row.skipped_sem_confirmacao_24h),
      // Leads que receberam só parte da sequência porque o servidor desligou no meio (log
      // "sequencia_cortada_no_desligamento"), nas últimas 24 h. Não são completados depois.
      sequenciasCortadas24h: int(row.sequencias_cortadas_24h),
    },
    checkedAt,
  };
}
