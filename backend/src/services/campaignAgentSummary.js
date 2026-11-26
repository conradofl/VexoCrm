// Resumo de desempenho por campanha para o agente que monta campanha (só leitura).
//
// Mesma régua da tela de campanhas (domains/campaigns/routes.js, dispatch-summary): "respondeu" = telefone que recebeu
// envio ('sent') e mandou mensagem de volta depois dele, dentro da janela de efetividade. Assim o analista do agente lê
// o mesmo número que o dono vê na tela. Só campanhas da empresa pedida; nada aqui escreve.
import { SQL_CANONICAL_PHONE } from "./canonicalPhone.js";
import { MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS } from "./messageEffectiveness.js";

export const MAX_CAMPANHAS_POR_RESUMO = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ids válidos e sem repetição, no máximo MAX_CAMPANHAS_POR_RESUMO. */
export function lerIdsDeCampanha(bruto) {
  const lista = Array.isArray(bruto) ? bruto : String(bruto ?? "").split(",");
  return [...new Set(lista.map((s) => String(s).trim()).filter((s) => UUID.test(s)))].slice(0, MAX_CAMPANHAS_POR_RESUMO);
}

/**
 * { [campaignId]: { name, status, sent, failed, replied } } das campanhas da empresa. Campanha de outra empresa ou
 * inexistente simplesmente não aparece.
 */
export async function resumoDeCampanhas(pool, { clientId, campaignIds }) {
  if (!pool || !clientId || !campaignIds?.length) return {};
  const casa = `(lm.phone = r.phone OR ${SQL_CANONICAL_PHONE("lm.phone")} = ${SQL_CANONICAL_PHONE("r.phone")})`;
  const quando = "COALESCE(lm.message_timestamp, lm.delivered_at, lm.created_at)";
  const { rows } = await pool.query(
    `SELECT c.id, c.name, c.status,
            COUNT(DISTINCT r.phone) FILTER (WHERE r.status = 'sent')::int AS sent,
            COUNT(DISTINCT r.phone) FILTER (WHERE r.status = 'failed')::int AS failed,
            COUNT(DISTINCT r.phone) FILTER (
              WHERE r.status = 'sent' AND r.sent_at IS NOT NULL AND r.phone <> '' AND EXISTS (
                SELECT 1 FROM public.lead_messages lm
                 WHERE lm.client_id = r.client_id AND ${casa}
                   AND (lm.direction = 'inbound' OR lm.engagement_signal = 'reply')
                   AND ${quando} > r.sent_at
                   AND ${quando} <= r.sent_at + interval '${MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS} days')
            )::int AS replied
       FROM public.campaigns c
       LEFT JOIN public.campaign_dispatch_runs r ON r.campaign_id = c.id AND r.client_id = c.client_id
      WHERE c.client_id = $1 AND c.id = ANY($2::uuid[])
      GROUP BY c.id, c.name, c.status`,
    [clientId, campaignIds]
  );
  return Object.fromEntries(rows.map((r) => [r.id, { name: r.name, status: r.status, sent: r.sent, failed: r.failed, replied: r.replied }]));
}
