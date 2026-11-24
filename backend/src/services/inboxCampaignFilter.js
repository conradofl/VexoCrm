// Filtro "Campanha" da coluna de Conversas (24/11/2026).
//
// Pedido do Conrado: no meio de centenas de conversas do WhatsApp não dava para achar as de cada
// campanha. Conversa "da campanha" = telefone que RECEBEU um envio dela:
//   - campaign_dispatch_runs com status 'sent' (o recibo de envio de cada lead do lote);
//   - lead_messages marcadas com o campaign_id (mensagens de passo e de bastão gravadas na conversa).
// As duas fontes passam pela mesma SQL_CANONICAL_PHONE da lista: "5534...", "34..." e o número sem o
// nono dígito caem na mesma conversa.
//
// O filtro só restringe QUAIS conversas aparecem. O estado (esperam, com o lead, robô) continua sendo
// calculado sobre a conversa inteira, igual ao escopo de chip.
import { SQL_CANONICAL_PHONE } from "./canonicalPhone.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lê o id de campanha vindo da tela. Vazio = sem filtro (null). Texto que não é uuid = inválido
 * (undefined): a rota responde 400 em vez de mostrar tudo como se tivesse filtrado.
 * @returns {string|null|undefined}
 */
export function parseCampaignFilter(value) {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  return UUID_RE.test(raw) ? raw.toLowerCase() : undefined;
}

/**
 * Subconsulta com os telefones canônicos que receberam a campanha. $1 = empresa (client_id).
 * Compara como texto: em produção campaign_id é uuid; no Postgres de teste é text.
 */
export function campaignPhonesSql(campaignIdx) {
  return `(
      SELECT ${SQL_CANONICAL_PHONE("r.phone")}
      FROM public.campaign_dispatch_runs r
      WHERE r.client_id = $1 AND r.campaign_id::text = $${campaignIdx}::text AND r.status = 'sent'
      UNION
      SELECT ${SQL_CANONICAL_PHONE("x.phone")}
      FROM public.lead_messages x
      WHERE x.client_id = $1 AND x.campaign_id::text = $${campaignIdx}::text
    )`;
}

/**
 * Campanhas da empresa que já mandaram alguma coisa, para o seletor da tela.
 * Mais recente primeiro. `sent` = quantos números receberam.
 * @param {(sql: string, params: any[]) => Promise<{rows: any[]}>} query
 */
export async function listInboxCampaigns(query, clientId) {
  const { rows } = await query(
    `
    WITH envios AS (
      SELECT r.campaign_id::text AS campaign_id, ${SQL_CANONICAL_PHONE("r.phone")} AS phone,
             COALESCE(r.sent_at, r.created_at) AS sent_at
      FROM public.campaign_dispatch_runs r
      WHERE r.client_id = $1 AND r.status = 'sent' AND r.campaign_id IS NOT NULL
      UNION ALL
      SELECT x.campaign_id::text, ${SQL_CANONICAL_PHONE("x.phone")}, COALESCE(x.message_timestamp, x.delivered_at, x.created_at)
      FROM public.lead_messages x
      WHERE x.client_id = $1 AND x.campaign_id IS NOT NULL AND x.direction = 'outbound'
    )
    SELECT c.id::text AS id, c.name, count(DISTINCT e.phone)::integer AS sent, max(e.sent_at) AS last_sent_at
    FROM envios e
    JOIN public.campaigns c ON c.id::text = e.campaign_id AND c.client_id = $1
    GROUP BY c.id, c.name
    ORDER BY max(e.sent_at) DESC NULLS LAST, c.name ASC
    LIMIT 200`,
    [clientId]
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name || "Campanha sem nome",
    sent: Number(row.sent) || 0,
    lastSentAt: row.last_sent_at ? new Date(row.last_sent_at).toISOString() : null,
  }));
}
