// Retomada das filas adiadas (chamada pelo agendador de 30s em routes.js, runDueIndependentDispatches).
//
// Pega os adiamentos vencidos com concessão atômica e tenta iniciar o próximo lead de cada campanha. A própria
// startNextCampaignLeadInQueue limpa o marcador quando inicia e o regrava quando um freio barra de novo (janela ainda
// fechada, cota ainda esgotada), então aqui só se descarta o marcador que não tem mais o que retomar.
//
// Chip desconectado (16/11/2026, campanha 2501b93d da Nous, chip em "close"): antes virava erro no log a cada concessão
// ("falha ao retomar fila adiada") e nada na tela. Agora é adiamento espaçado (5, 10, 20, 30 min) com o motivo guardado
// em memória e mostrado no cartão da campanha. Em memória porque a coluna reason só aceita send_window e chip_quota e
// este PR não tem migration; o backend roda num contêiner só, e depois de um boot o motivo volta na próxima tentativa.

import { pgDatabasePool } from "../services/database.js";
import { startNextCampaignLeadInQueue } from "./dispatch.js";
import { clearQueueDeferral, leaseDueQueueDeferrals, postponeQueueDeferral } from "./queueDeferral.js";

// Mesmo vocabulário que o agendador de lotes usa para ignorar campanha (routes.js, runDueIndependentDispatches), mais 'sent'.
const CAMPANHA_ENCERRADA = new Set(["paused", "pausada", "cancelled", "cancelada", "archived", "arquivada", "sent"]);

const CHIP_FORA_DO_AR = new Set(["EVOLUTION_INSTANCE_NOT_OPEN", "EVOLUTION_HEALTH_CHECK_FAILED", "EVOLUTION_HEALTH_CHECK_TIMEOUT"]);
const ESPERA_MINUTOS = [5, 10, 20, 30];

// campaignId -> { reason, message, chipName, connectionState, since, retryAfter, attempts }
const bloqueios = new Map();

export function isQueueChipUnavailableError(err) {
  return Boolean(err && (CHIP_FORA_DO_AR.has(err.code) || err.isConnectionClosed === true));
}

/** Espera até a próxima tentativa: 5, 10, 20 e depois 30 minutos fixos. attempts = tentativas já feitas (>= 1). */
export function queueChipRetryDelayMs(attempts) {
  const i = Math.min(Math.max(1, Number(attempts) || 1), ESPERA_MINUTOS.length) - 1;
  return ESPERA_MINUTOS[i] * 60_000;
}

export function describeQueueChipBlock(err) {
  const chip = err?.instanceName ? `chip ${err.instanceName}` : "chip da campanha";
  if (err?.code === "EVOLUTION_INSTANCE_NOT_OPEN" || err?.isConnectionClosed === true) {
    const estado = err?.connectionState ? ` (${err.connectionState})` : "";
    return `Fila de resposta parada: ${chip} desconectado${estado}. Reconecte em Conexões; o sistema tenta de novo sozinho.`;
  }
  return `Fila de resposta parada: o ${chip} não respondeu à verificação de conexão. O sistema tenta de novo sozinho.`;
}

/** O que a tela mostra no cartão da campanha. null = fila sem bloqueio conhecido. */
export function getQueueBlock(campaignId) {
  const b = bloqueios.get(String(campaignId || ""));
  return b ? { ...b } : null;
}

export function resetQueueBlocksForTest() {
  bloqueios.clear();
}

export async function resumeDeferredQueues({ pool = pgDatabasePool, limit = 10, now = () => new Date() } = {}) {
  const concedidos = await leaseDueQueueDeferrals(pool, { limit });
  let resumed = 0;
  let postponed = 0;
  for (const adiamento of concedidos) {
    try {
      const { rows } = await pool.query(
        `SELECT id, name, client_id, import_id, limit_per_run, status, archived_at, analytics_meta
           FROM public.campaigns WHERE id = $1`,
        [adiamento.campaign_id]
      );
      const campaign = rows[0];
      const status = String(campaign?.status || "").toLowerCase().trim();
      if (!campaign || campaign.archived_at || CAMPANHA_ENCERRADA.has(status)) {
        bloqueios.delete(String(adiamento.campaign_id));
        await clearQueueDeferral(pool, adiamento.campaign_id);
        continue;
      }
      const res = await startNextCampaignLeadInQueue({ campaign, clientId: adiamento.client_id });
      // Chegou a decidir (iniciou, adiou por janela/cota ou não há próximo): o chip respondeu, o bloqueio acabou.
      bloqueios.delete(String(adiamento.campaign_id));
      if (res.started) resumed += 1;
      if (!res.started && !res.deferred) await clearQueueDeferral(pool, adiamento.campaign_id);
    } catch (err) {
      if (isQueueChipUnavailableError(err)) {
        const attempts = Number(adiamento.attempts) || 1;
        const retryAfter = new Date(now().getTime() + queueChipRetryDelayMs(attempts));
        await postponeQueueDeferral(pool, adiamento.campaign_id, retryAfter);
        const anterior = bloqueios.get(String(adiamento.campaign_id));
        const message = describeQueueChipBlock(err);
        bloqueios.set(String(adiamento.campaign_id), {
          reason: "chip_unavailable",
          message,
          chipName: err.instanceName || null,
          connectionState: err.connectionState || null,
          since: anterior?.since || now().toISOString(),
          retryAfter: retryAfter.toISOString(),
          attempts,
        });
        postponed += 1;
        console.warn("[campaign-queue] fila adiada: chip fora do ar", {
          campaignId: adiamento.campaign_id,
          chip: err.instanceName || null,
          estado: err.connectionState || err.code || null,
          tentativa: attempts,
          proximaTentativa: retryAfter.toISOString(),
        });
        continue;
      }
      // A concessão vence e a retomada é tentada de novo; uma campanha com erro não pode travar as outras.
      console.error("[campaign-queue] falha ao retomar fila adiada:", { campaignId: adiamento.campaign_id, error: err?.message || err });
    }
  }
  return { resumed, postponed, examined: concedidos.length };
}
