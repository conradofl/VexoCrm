// Lead que já recebeu disparo de OUTRA campanha (26/11/2026, pedido do Conrado depois da Advocacia Almeida).
//
// A exclusão que existia era só dentro da mesma campanha: campanha nova com a mesma planilha mandava de novo para quem
// já tinha recebido. Agora:
//   - a tela pergunta antes de "Disparar Agora" / "Retomar": "N leads já receberam de outra campanha. Pular ou enviar de
//     novo?" e grava a resposta na campanha (analytics_meta.dispatchOptions.repeatContacted = "pular" | "enviar");
//   - o motor do lote segue a resposta: "pular" registra o lead como 'skipped' com o nome da campanha anterior;
//     "enviar" manda; sem resposta e com lead repetido no lote, o lote PARA (pausado, aguardando a decisão). Nunca manda
//     repetido sem alguém ter dito que pode.
// "Já recebeu" = run 'sent' de outra campanha da mesma empresa, em qualquer grafia do telefone (com/sem 55, com/sem 9).
import { phoneSpellingsOf, toCanonicalPhone } from "../services/canonicalPhone.js";

export const REPEAT_DECISION = Object.freeze({ PULAR: "pular", ENVIAR: "enviar" });
export const REPEAT_PAUSE_MARKER = "Aguardando sua decisão: leads que já receberam outra campanha";

/** "pular" | "enviar" | null (ninguém decidiu ainda). */
export function repeatDecisionOf(campaign) {
  const meta = campaign?.analytics_meta || campaign?.analyticsMeta || {};
  const v = String(meta?.dispatchOptions?.repeatContacted || "").trim().toLowerCase();
  return v === REPEAT_DECISION.PULAR || v === REPEAT_DECISION.ENVIAR ? v : null;
}

export function isRepeatDecisionPause(dispatch) {
  return dispatch?.status === "paused" && String(dispatch?.error_message || "").startsWith(REPEAT_PAUSE_MARKER);
}

/**
 * Telefones (de qualquer grafia) que já receberam disparo de outra campanha da empresa.
 * @returns {Promise<Map<string, { campaignId: string, campaignName: string, sentAt: string | null }>>} chave = telefone canônico
 */
export async function findLeadsReachedByOtherCampaigns(pool, { clientId, campaignId, phones }) {
  const achados = new Map();
  if (!pool?.query || !clientId || !Array.isArray(phones) || phones.length === 0) return achados;
  const grafias = new Set();
  for (const p of phones) for (const g of phoneSpellingsOf(p)) grafias.add(g);
  if (grafias.size === 0) return achados;
  const { rows } = await pool.query(
    `SELECT r.phone, r.campaign_id::text AS campaign_id, c.name AS campaign_name, COALESCE(r.sent_at, r.created_at) AS sent_at
       FROM public.campaign_dispatch_runs r
       LEFT JOIN public.campaigns c ON c.id::text = r.campaign_id::text
      WHERE r.client_id = $1
        AND r.status = 'sent'
        AND r.campaign_id IS NOT NULL
        AND r.campaign_id::text <> $2::text
        AND r.phone = ANY($3::text[])
      ORDER BY COALESCE(r.sent_at, r.created_at) DESC`,
    [String(clientId), String(campaignId || ""), [...grafias]]
  );
  for (const row of rows || []) {
    const canon = toCanonicalPhone(row.phone);
    if (!canon || achados.has(canon)) continue; // fica a mais recente
    achados.set(canon, {
      campaignId: row.campaign_id,
      campaignName: row.campaign_name || "outra campanha",
      sentAt: row.sent_at ? new Date(row.sent_at).toISOString() : null,
    });
  }
  return achados;
}

/** O lead (telefone cru) está no mapa de findLeadsReachedByOtherCampaigns? */
export function reachedEntryFor(achados, phone) {
  const canon = toCanonicalPhone(phone);
  return (canon && achados.get(canon)) || null;
}

/** Resumo por campanha anterior, para a tela: [{ campaignName, count }], maiores primeiro. */
export function summarizeReached(achados) {
  const porCampanha = new Map();
  for (const v of achados.values()) {
    const k = v.campaignId;
    const atual = porCampanha.get(k) || { campaignId: k, campaignName: v.campaignName, count: 0 };
    atual.count += 1;
    porCampanha.set(k, atual);
  }
  return [...porCampanha.values()].sort((a, b) => b.count - a.count);
}

export function describeRepeatPause(achados) {
  const resumo = summarizeReached(achados);
  const nomes = resumo.slice(0, 3).map((r) => `"${r.campaignName}" (${r.count})`).join(", ");
  return `${REPEAT_PAUSE_MARKER}: ${achados.size} lead(s) deste lote já receberam ${nomes}. Escolha pular ou enviar de novo na tela da campanha.`;
}
