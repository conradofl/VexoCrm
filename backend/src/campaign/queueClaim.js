// Claim do "próximo da fila" (startNextCampaignLeadInQueue, dívida DT-001).
//
// A fila escolhia "o primeiro lead sem progresso" e só gravava o progresso DEPOIS do envio: duas execuções
// concorrentes escolhiam o mesmo lead e as duas enviavam (campanha a1df2aa2, 29/10/2026: mesmo stepId, mesmo
// telefone, duas respostas 201). O claim grava um progresso provisório ("iniciando") ANTES de enviar, num único
// UPDATE condicional: só uma execução ganha. O mesmo UPDATE recusa o lead que o lote já reivindicou (run da campanha),
// porque o lote só grava o progresso depois de enviar.

const CLAIM_STATUS = "iniciando";

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
        AND coalesce(i.normalized_data->'campaign_progress'->$3::text, '{}'::jsonb) = '{}'::jsonb
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
