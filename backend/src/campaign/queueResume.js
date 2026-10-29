// Retomada das filas adiadas (chamada pelo agendador de 30s em routes.js, runDueIndependentDispatches).
//
// Pega os adiamentos vencidos com concessão atômica e tenta iniciar o próximo lead de cada campanha. A própria
// startNextCampaignLeadInQueue limpa o marcador quando inicia e o regrava quando um freio barra de novo (janela ainda
// fechada, cota ainda esgotada), então aqui só se descarta o marcador que não tem mais o que retomar.

import { pgDatabasePool } from "../services/database.js";
import { startNextCampaignLeadInQueue } from "./dispatch.js";
import { clearQueueDeferral, leaseDueQueueDeferrals } from "./queueDeferral.js";

// Mesmo vocabulário que o agendador de lotes usa para ignorar campanha (routes.js, runDueIndependentDispatches), mais 'sent'.
const CAMPANHA_ENCERRADA = new Set(["paused", "pausada", "cancelled", "cancelada", "archived", "arquivada", "sent"]);

export async function resumeDeferredQueues({ pool = pgDatabasePool, limit = 10 } = {}) {
  const concedidos = await leaseDueQueueDeferrals(pool, { limit });
  let resumed = 0;
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
        await clearQueueDeferral(pool, adiamento.campaign_id);
        continue;
      }
      const res = await startNextCampaignLeadInQueue({ campaign, clientId: adiamento.client_id });
      if (res.started) resumed += 1;
      if (!res.started && !res.deferred) await clearQueueDeferral(pool, adiamento.campaign_id);
    } catch (err) {
      // A concessão vence e a retomada é tentada de novo; uma campanha com erro não pode travar as outras.
      console.error("[campaign-queue] falha ao retomar fila adiada:", { campaignId: adiamento.campaign_id, error: err?.message || err });
    }
  }
  return { resumed, examined: concedidos.length };
}
