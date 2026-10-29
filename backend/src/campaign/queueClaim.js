// Claim do "próximo da fila" (startNextCampaignLeadInQueue, dívida DT-001).
//
// A fila escolhia "o primeiro lead sem progresso" e só gravava o progresso DEPOIS do envio: duas execuções
// concorrentes escolhiam o mesmo lead e as duas enviavam (campanha a1df2aa2, 29/10/2026: mesmo stepId, mesmo
// telefone, duas respostas 201). O claim grava um progresso provisório ("iniciando") ANTES de enviar, num único
// UPDATE condicional: só uma execução ganha. O mesmo UPDATE recusa o lead que o lote já reivindicou (run da campanha),
// porque o lote só grava o progresso depois de enviar.

const CLAIM_STATUS = "iniciando";

// DT-004: claim de um processo que morreu entre o claim e a devolução (deploy, queda) não pode prender o lead para sempre.
// 10 minutos é muito mais que um envio (segundos); passado isso o claim é tratado como livre.
export const CLAIM_TTL_MINUTES = 10;

/** O progresso é um claim provisório da fila, velho demais para ser de um envio ainda em andamento? */
export function isStaleQueueClaim(progress, now = Date.now()) {
  if (!progress || progress.status !== CLAIM_STATUS) return false;
  const claimedAt = Date.parse(progress.claimedAt);
  if (!Number.isFinite(claimedAt)) return true; // claim sem carimbo legível: não há como saber que está vivo
  return now - claimedAt > CLAIM_TTL_MINUTES * 60_000;
}

/**
 * Tenta reivindicar o lead para a fila. Devolve true se esta execução ganhou o claim.
 * Sem pool (ambiente sem Postgres direto) devolve true: não há como arbitrar, e o comportamento é o de antes.
 */
export async function claimQueueLead(pool, { clientId, campaignId, leadImportItemId, phone }) {
  if (!pool || !leadImportItemId || !campaignId) return true;
  const digits = String(phone || "").replace(/\D/g, "");
  const { rowCount } = await pool.query(
    `UPDATE public.lead_import_items i
        SET normalized_data = jsonb_set(
              coalesce(i.normalized_data, '{}'::jsonb),
              '{campaign_progress}',
              coalesce(i.normalized_data->'campaign_progress', '{}'::jsonb)
                || jsonb_build_object($3::text, jsonb_build_object('status', $5::text, 'claimedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
      WHERE i.id = $1
        AND i.client_id = $2
        AND (
          coalesce(i.normalized_data->'campaign_progress'->$3::text, '{}'::jsonb) = '{}'::jsonb
          OR (
            i.normalized_data->'campaign_progress'->$3::text->>'status' = $5::text
            AND coalesce((i.normalized_data->'campaign_progress'->$3::text->>'claimedAt')::timestamptz, '-infinity'::timestamptz)
                < now() - make_interval(mins => ${CLAIM_TTL_MINUTES})
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.campaign_dispatch_runs r
           WHERE r.campaign_id::text = $4
             AND r.client_id = $2
             AND (r.lead_import_item_id = i.id OR ($6 <> '' AND regexp_replace(r.phone, '\\D', '', 'g') = $6))
        )`,
    [leadImportItemId, clientId, campaignId, campaignId, CLAIM_STATUS, digits]
  );
  return rowCount > 0;
}

/**
 * Devolve o claim quando nada foi entregue: apaga só o progresso provisório (nunca um progresso já gravado).
 */
export async function releaseQueueLead(pool, { clientId, campaignId, leadImportItemId }) {
  if (!pool || !leadImportItemId || !campaignId) return;
  await pool.query(
    `UPDATE public.lead_import_items
        SET normalized_data = normalized_data #- ARRAY['campaign_progress', $3::text]
      WHERE id = $1
        AND client_id = $2
        AND normalized_data->'campaign_progress'->$3::text->>'status' = $4::text`,
    [leadImportItemId, clientId, campaignId, CLAIM_STATUS]
  );
}
