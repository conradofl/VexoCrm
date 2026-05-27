// Analytics do módulo de follow-up — todas as queries via SQL agregado no banco.
import { query } from "./db.js";

function dateFilter(from, to, alias = "fs") {
  const clauses = [];
  const params = [];
  if (from) {
    params.push(from);
    clauses.push(`${alias}.created_at >= $${params.length}::timestamptz`);
  }
  if (to) {
    params.push(to);
    clauses.push(`${alias}.created_at <= ($${params.length}::timestamptz + interval '1 day')`);
  }
  return { clauses, params };
}

/**
 * Retorna todos os dados de analytics em uma única chamada ao banco.
 * @param {{ companyId?: string, campaignId?: string, from?: string, to?: string }} filters
 */
export async function getAnalytics({ companyId, campaignId, from, to }) {
  const conditions = [];
  const baseParams = [];

  if (companyId) {
    baseParams.push(companyId);
    conditions.push(`fs.company_id = $${baseParams.length}::uuid`);
  }
  if (campaignId) {
    baseParams.push(campaignId);
    conditions.push(`fs.campaign_id = $${baseParams.length}::uuid`);
  }
  if (from) {
    baseParams.push(from);
    conditions.push(`fs.created_at >= $${baseParams.length}::timestamptz`);
  }
  if (to) {
    baseParams.push(to);
    conditions.push(`fs.created_at <= ($${baseParams.length}::timestamptz + interval '1 day')`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const p = baseParams;

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const kpiSql = `
    SELECT
      COUNT(*)::int                                         AS total_leads,
      COUNT(*) FILTER (WHERE fs.phone IS NOT NULL)::int     AS valid_phone,
      COALESCE(SUM(j.sent_count),0)::int                    AS messages_sent,
      COALESCE(SUM(j.failed_count),0)::int                  AS messages_failed,
      COALESCE(SUM(r.reply_count),0)::int                   AS reply_count
    FROM followup_schedules fs
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*) FILTER (WHERE fj.status='sent')   AS sent_count,
        COUNT(*) FILTER (WHERE fj.status='failed') AS failed_count
        FROM followup_jobs fj WHERE fj.schedule_id = fs.id
    ) j ON TRUE
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS reply_count
        FROM followup_replies fr WHERE fr.company_id = fs.company_id AND fr.phone = fs.phone
    ) r ON TRUE
    ${where}
  `;
  const { rows: kpiRows } = await query(kpiSql, p);
  const k = kpiRows[0] || {};
  const kpis = {
    totalLeads: k.total_leads || 0,
    validPhone: k.valid_phone || 0,
    messagesSent: k.messages_sent || 0,
    replyRate:
      k.valid_phone > 0
        ? Math.round((k.reply_count / k.valid_phone) * 10000) / 100
        : 0,
    failureRate:
      k.messages_sent + k.messages_failed > 0
        ? Math.round(
            (k.messages_failed / (k.messages_sent + k.messages_failed)) * 10000
          ) / 100
        : 0,
  };

  // ── Por Origem ────────────────────────────────────────────────────────────
  const originSql = `
    SELECT
      COALESCE(fs.origin, 'Sem origem') AS origin,
      COUNT(*)::int                     AS total
    FROM followup_schedules fs
    ${where}
    GROUP BY 1 ORDER BY 2 DESC
  `;
  const { rows: originRows } = await query(originSql, p);
  const totalForPct = originRows.reduce((s, r) => s + r.total, 0) || 1;
  const byOrigin = originRows.map((r) => ({
    origin: r.origin,
    total: r.total,
    percentage: Math.round((r.total / totalForPct) * 10000) / 100,
  }));

  // ── Por Dia ───────────────────────────────────────────────────────────────
  const byDaySql = `
    SELECT
      DATE(fs.created_at AT TIME ZONE 'America/Sao_Paulo') AS day,
      fc.name                                               AS campaign_name,
      fc.id                                                 AS campaign_id,
      COUNT(*)::int                                         AS total
    FROM followup_schedules fs
    JOIN followup_campaigns fc ON fc.id = fs.campaign_id
    ${where}
    GROUP BY 1,2,3 ORDER BY 1
  `;
  const { rows: dayRows } = await query(byDaySql, p);
  const dayMap = {};
  for (const r of dayRows) {
    const d = String(r.day);
    if (!dayMap[d]) dayMap[d] = { date: d, total: 0, byCampaign: {} };
    dayMap[d].total += r.total;
    dayMap[d].byCampaign[r.campaign_id] = (dayMap[d].byCampaign[r.campaign_id] || 0) + r.total;
  }
  const byDay = Object.values(dayMap);

  // ── Conversão por Campanha ────────────────────────────────────────────────
  const convSql = `
    SELECT
      fc.id                                                    AS campaign_id,
      fc.name,
      COUNT(DISTINCT fs.id)::int                               AS leads,
      COUNT(DISTINCT fs.id) FILTER (WHERE fs.phone IS NOT NULL)::int AS converted
    FROM followup_schedules fs
    JOIN followup_campaigns fc ON fc.id = fs.campaign_id
    ${where}
    GROUP BY fc.id, fc.name
    ORDER BY COUNT(DISTINCT fs.id) FILTER (WHERE fs.phone IS NOT NULL) DESC
  `;
  const { rows: convRows } = await query(convSql, p);
  const conversionByCampaign = convRows.map((r) => ({
    campaignId: r.campaign_id,
    name: r.name,
    leads: r.leads,
    converted: r.converted,
    rate: r.leads > 0 ? Math.round((r.converted / r.leads) * 10000) / 100 : 0,
  }));

  // ── Mensagens por Dia ─────────────────────────────────────────────────────
  const msgDaySql = `
    SELECT
      DATE(fj.scheduled_for AT TIME ZONE 'America/Sao_Paulo') AS day,
      COUNT(*) FILTER (WHERE fj.status='sent')::int   AS sent,
      COUNT(*) FILTER (WHERE fj.status='failed')::int AS failed
    FROM followup_jobs fj
    JOIN followup_schedules fs ON fs.id = fj.schedule_id
    ${where}
    GROUP BY 1 ORDER BY 1
  `;
  const { rows: msgDayRows } = await query(msgDaySql, p);
  const messagesByDay = msgDayRows.map((r) => ({
    date: String(r.day),
    sent: r.sent,
    failed: r.failed,
  }));

  // ── Top Campanhas ─────────────────────────────────────────────────────────
  const topSql = `
    SELECT
      fc.id                                                    AS campaign_id,
      fc.name,
      fc.default_origin                                        AS origin,
      fc.status,
      COUNT(DISTINCT fs.id)::int                               AS leads,
      COUNT(DISTINCT fj.id) FILTER (WHERE fj.status='sent')::int AS sent,
      COUNT(DISTINCT rep.id)::int                              AS replies,
      COUNT(DISTINCT fs.id) FILTER (WHERE fs.phone IS NOT NULL)::int AS with_phone
    FROM followup_campaigns fc
    LEFT JOIN followup_schedules fs  ON fs.campaign_id = fc.id ${companyId ? `AND fs.company_id = $1::uuid` : ""}
    LEFT JOIN followup_jobs      fj  ON fj.schedule_id = fs.id
    LEFT JOIN followup_replies   rep ON rep.campaign_id = fc.id
    ${companyId ? "WHERE fc.company_id = $1::uuid" : ""}
    GROUP BY fc.id, fc.name, fc.default_origin, fc.status
    ORDER BY leads DESC NULLS LAST
    LIMIT 20
  `;
  const topParams = companyId ? [companyId] : [];
  const { rows: topRows } = await query(topSql, topParams);
  const topCampaigns = topRows.map((r, i) => ({
    rank: i + 1,
    campaignId: r.campaign_id,
    name: r.name,
    origin: r.origin || "—",
    leads: r.leads,
    sent: r.sent,
    replyRate:
      r.with_phone > 0
        ? Math.round((r.replies / r.with_phone) * 10000) / 100
        : 0,
    status: r.status,
  }));

  return { kpis, byOrigin, byDay, conversionByCampaign, messagesByDay, topCampaigns };
}
