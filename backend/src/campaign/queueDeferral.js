// Marcador de "fila adiada" (tabela campaign_queue_deferrals, migration 20261029200000).
//
// Freio que bloqueia (janela fechada, cota do chip esgotada) NÃO pode significar lead perdido nem campanha parada em
// silêncio: o bloqueio grava aqui até quando a fila deve tentar de novo, o agendador de 30s retoma, e o fechamento da
// campanha (maybeFinalizeCampaignAfterReply) não encerra enquanto houver linha aqui.
//
// Tabela ausente (código novo + schema velho): NÃO derruba nada. Registra o erro, devolve ok:false e a fila segue bloqueada
// sem marcador (volta quando outra resposta chegar, como antes dos freios). Quem lê o marcador trata ausência como "sem adiamento".

export const DEFERRAL_REASON = { WINDOW: "send_window", QUOTA: "chip_quota" };

const TABLE_MISSING = "42P01";
let avisouTabelaAusente = false;

function relatarFalha(err, contexto) {
  if (err?.code === TABLE_MISSING) {
    if (!avisouTabelaAusente) {
      avisouTabelaAusente = true;
      console.error(
        "[queue-deferral] tabela campaign_queue_deferrals ausente (migration 20261029200000 não aplicada): a fila fica bloqueada SEM marcador e só volta quando outra resposta chegar.",
        { contexto }
      );
    }
    return;
  }
  console.error(`[queue-deferral] falha em ${contexto}:`, err?.message || err);
}

export async function deferQueue(pool, { campaignId, clientId, reason, retryAfter }) {
  if (!pool || !campaignId) return { ok: false };
  try {
    await pool.query(
      `INSERT INTO public.campaign_queue_deferrals (campaign_id, client_id, reason, retry_after)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (campaign_id)
       DO UPDATE SET reason = EXCLUDED.reason, retry_after = EXCLUDED.retry_after, updated_at = now()`,
      [campaignId, clientId, reason, retryAfter instanceof Date ? retryAfter.toISOString() : retryAfter]
    );
    return { ok: true };
  } catch (err) {
    relatarFalha(err, "deferQueue");
    return { ok: false, missingTable: err?.code === TABLE_MISSING };
  }
}

export async function clearQueueDeferral(pool, campaignId) {
  if (!pool || !campaignId) return;
  try {
    await pool.query(`DELETE FROM public.campaign_queue_deferrals WHERE campaign_id = $1`, [campaignId]);
  } catch (err) {
    relatarFalha(err, "clearQueueDeferral");
  }
}

/**
 * A campanha tem fila adiada? Tabela ausente = não. Erro de leitura = SIM: errar para o lado de não encerrar a campanha.
 */
export async function hasQueueDeferral(pool, campaignId) {
  if (!pool || !campaignId) return false;
  try {
    const { rows } = await pool.query(`SELECT 1 FROM public.campaign_queue_deferrals WHERE campaign_id = $1 LIMIT 1`, [campaignId]);
    return rows.length > 0;
  } catch (err) {
    if (err?.code === TABLE_MISSING) return false;
    relatarFalha(err, "hasQueueDeferral");
    return true;
  }
}

/**
 * Pega, de forma atômica, os adiamentos vencidos: empurra retry_after para frente (concessão) para que dois agendadores
 * no mesmo instante não retomem a mesma campanha. Quem retoma e consegue iniciar limpa a linha; quem é barrado de novo a
 * regrava; se o processo morrer no meio, a concessão vence e a retomada é tentada outra vez.
 */
export async function leaseDueQueueDeferrals(pool, { limit = 10, leaseSeconds = 120 } = {}) {
  if (!pool) return [];
  try {
    const { rows } = await pool.query(
      `UPDATE public.campaign_queue_deferrals d
          SET retry_after = now() + make_interval(secs => $2::double precision), attempts = d.attempts + 1, updated_at = now()
        WHERE d.campaign_id IN (
          SELECT campaign_id FROM public.campaign_queue_deferrals
           WHERE retry_after <= now()
           ORDER BY retry_after
           LIMIT $1
           FOR UPDATE SKIP LOCKED
        )
        RETURNING d.campaign_id, d.client_id, d.reason`,
      [limit, leaseSeconds]
    );
    return rows;
  } catch (err) {
    relatarFalha(err, "leaseDueQueueDeferrals");
    return [];
  }
}
