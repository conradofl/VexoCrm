// backend/src/services/messageEffectiveness.js
//
// Lógica canônica de eficácia de mensagens e cruzamento de respostas de campanhas.
// Extraída para a camada de serviços para permitir consumo compartilhado
// entre os domínios campaigns e insights sem violar a regra de importação acíclica.

import {
  SQL_LEAD_TEMPERATURE_BUCKET,
  SQL_LEAD_TEMPERATURE_ONLY,
} from "./leadTemperature.js";
import { SQL_CANONICAL_PHONE } from "./canonicalPhone.js";

export const MESSAGE_EFFECTIVENESS_MIN_SENT = 30;
export const MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS = 14;

/**
 * A definição de "respondeu" do sistema, em DOIS pedaços que todo cruzamento reutiliza (relatório de efetividade, público da segunda tentativa
 * por outro número): o que conta como mensagem de resposta e o instante efetivo dela. Ter outra cópia é o que faz o dono ver dois números
 * diferentes para a mesma pergunta. O telefone é sempre comparado pelo canônico (SQL_CANONICAL_PHONE, ou a variante JID) nos DOIS lados.
 */
export const REPLY_MESSAGE_FILTER_SQL = "(lm.direction = 'inbound' OR lm.engagement_signal = 'reply')";
export const MESSAGE_TIMESTAMP_SQL = "COALESCE(lm.message_timestamp, lm.delivered_at, lm.created_at)";

export function buildMessageEffectivenessSql(includeTemperatureColumn, includeIsGroupColumn) {
  const canonicalLeadPhone = SQL_CANONICAL_PHONE("COALESCE(l.telefone, l.phone)");
  const lmTimestamp = MESSAGE_TIMESTAMP_SQL;

  const repliedExists = ({ phoneCondition, extra = "" }) => `EXISTS (
            SELECT 1
            FROM public.lead_messages lm
            WHERE lm.client_id = r.client_id
              AND (${phoneCondition})
              AND ${REPLY_MESSAGE_FILTER_SQL}
              AND ${lmTimestamp} > r.sent_at
              AND ${lmTimestamp} <= r.sent_at + interval '${MESSAGE_EFFECTIVENESS_REPLY_WINDOW_DAYS} days'
              ${extra}
          )`;

  const rawOrCanonicalPhone = `lm.phone = r.phone OR ${SQL_CANONICAL_PHONE("lm.phone")} = ${SQL_CANONICAL_PHONE("r.phone")}`;

  return `
    WITH runs AS (
      SELECT
        r.campaign_id,
        r.phone,
        r.lead_id,
        (r.sent_at IS NULL) AS sent_at_missing,
        CASE WHEN r.sent_at IS NULL THEN false ELSE ${repliedExists({ phoneCondition: rawOrCanonicalPhone })} END AS replied,
        CASE WHEN r.sent_at IS NULL THEN false ELSE ${repliedExists({ phoneCondition: "lm.phone = r.phone" })} END AS replied_raw_only,
        ${includeIsGroupColumn
          ? `CASE WHEN r.sent_at IS NULL THEN false ELSE ${repliedExists({ phoneCondition: rawOrCanonicalPhone, extra: "AND (lm.is_group IS NOT TRUE)" })} END`
          : "NULL::boolean"} AS replied_without_group
      FROM public.campaign_dispatch_runs r
      WHERE r.client_id = $1 AND r.status = 'sent' AND r.phone <> ''
    ),
    lead_by_phone AS (
      SELECT DISTINCT ON (${canonicalLeadPhone})
        ${canonicalLeadPhone} AS canonical_phone,
        ${includeTemperatureColumn ? SQL_LEAD_TEMPERATURE_BUCKET("l") : SQL_LEAD_TEMPERATURE_ONLY("l")} AS temp,
        l.updated_at
      FROM public.leads l
      WHERE l.client_id = $1
      ORDER BY ${canonicalLeadPhone}, l.updated_at DESC NULLS LAST
    ),
    replied_temperature AS (
      SELECT
        runs.campaign_id,
        runs.phone,
        runs.lead_id,
        lb.temp,
        (lb.canonical_phone IS NOT NULL) AS lead_found
      FROM runs
      LEFT JOIN lead_by_phone lb ON lb.canonical_phone = ${SQL_CANONICAL_PHONE("runs.phone")}
      WHERE runs.replied
    ),
    temperature_agg AS (
      SELECT
        campaign_id,
        COUNT(*) FILTER (WHERE temp = 'QUENTE')::int AS quente,
        COUNT(*) FILTER (WHERE temp = 'MORNO')::int AS morno,
        COUNT(*) FILTER (WHERE temp = 'FRIO')::int AS frio,
        COUNT(*) FILTER (WHERE lead_found AND temp IS NULL)::int AS sem_classificacao,
        COUNT(*) FILTER (WHERE NOT lead_found)::int AS lead_nao_encontrado
      FROM replied_temperature
      GROUP BY campaign_id
    ),
    lead_not_found_reason AS (
      SELECT
        rt.campaign_id,
        CASE
          WHEN rt.phone LIKE '%@%' THEN 'telefoneLid'
          WHEN rt.lead_id IS NULL THEN 'semLeadId'
          WHEN NOT EXISTS (SELECT 1 FROM public.leads ll WHERE ll.id = rt.lead_id) THEN 'leadIdApagado'
          WHEN NOT EXISTS (SELECT 1 FROM public.leads ll WHERE ll.id = rt.lead_id AND ll.client_id = $1) THEN 'leadIdDeOutroTenant'
          ELSE 'telefoneDivergente'
        END AS reason
      FROM replied_temperature rt
      WHERE NOT rt.lead_found
    ),
    lead_not_found_agg AS (
      SELECT
        campaign_id,
        COUNT(*) FILTER (WHERE reason = 'telefoneLid')::int AS telefone_lid,
        COUNT(*) FILTER (WHERE reason = 'semLeadId')::int AS sem_lead_id,
        COUNT(*) FILTER (WHERE reason = 'leadIdApagado')::int AS lead_id_apagado,
        COUNT(*) FILTER (WHERE reason = 'leadIdDeOutroTenant')::int AS lead_id_de_outro_tenant,
        COUNT(*) FILTER (WHERE reason = 'telefoneDivergente')::int AS telefone_divergente
      FROM lead_not_found_reason
      GROUP BY campaign_id
    )
    SELECT
      c.id AS campaign_id,
      c.name AS campaign_name,
      c.analytics_meta->>'message' AS message,
      COUNT(*)::int AS sent_count,
      COUNT(*) FILTER (WHERE runs.replied)::int AS replied_count,
      COUNT(*) FILTER (WHERE runs.sent_at_missing)::int AS sent_without_timestamp,
      COUNT(*) FILTER (WHERE runs.replied AND NOT runs.replied_raw_only)::int AS casou_so_no_canonico,
      ${includeIsGroupColumn
        ? "COUNT(*) FILTER (WHERE runs.replied AND runs.replied_without_group IS NOT TRUE)::int"
        : "NULL::int"} AS respostas_de_grupo,
      COALESCE(t.quente, 0) AS quente,
      COALESCE(t.morno, 0) AS morno,
      COALESCE(t.frio, 0) AS frio,
      COALESCE(t.sem_classificacao, 0) AS sem_classificacao,
      COALESCE(t.lead_nao_encontrado, 0) AS lead_nao_encontrado,
      COALESCE(n.telefone_lid, 0) AS telefone_lid,
      COALESCE(n.sem_lead_id, 0) AS sem_lead_id,
      COALESCE(n.lead_id_apagado, 0) AS lead_id_apagado,
      COALESCE(n.lead_id_de_outro_tenant, 0) AS lead_id_de_outro_tenant,
      COALESCE(n.telefone_divergente, 0) AS telefone_divergente
    FROM runs
    JOIN public.campaigns c ON c.id = runs.campaign_id
    LEFT JOIN temperature_agg t ON t.campaign_id = c.id
    LEFT JOIN lead_not_found_agg n ON n.campaign_id = c.id
    WHERE c.client_id = $1
    GROUP BY c.id, c.name, c.analytics_meta, t.quente, t.morno, t.frio, t.sem_classificacao, t.lead_nao_encontrado, n.telefone_lid, n.sem_lead_id, n.lead_id_apagado, n.lead_id_de_outro_tenant, n.telefone_divergente
    HAVING COUNT(*) >= $2
    ORDER BY (COUNT(*) FILTER (WHERE runs.replied))::float / COUNT(*) DESC
  `;
}
