// backend/src/scripts/measureDispatchDiscrepancyAllTenants.js
//
// SÓ LEITURA. Mede a discrepância entre o que o Dashboard exibe ("Enviados" / "Responderam", via
// campaign_dispatch_runs) e o que de fato aconteceu no tráfego de mensagens (lead_messages)
// em TODOS os tenants, nas janelas de 30 e 90 dias.
//
// Regra:
// - NENHUMA alteração no banco (SELECT puro, sem transação de escrita).
// - Imprime o host e banco conectados.
// - Não emite tokens de usuário.
//
// Uso (no container bk-vexo ou onde houver acesso ao Postgres):
//   node -r dotenv/config src/scripts/measureDispatchDiscrepancyAllTenants.js

import pg from "pg";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SQL_CANONICAL_PHONE } from "../services/canonicalPhone.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export function buildDiscrepancyQuery(intervalStr = "30 days") {
  return `
    WITH params AS (
      SELECT
        now() - INTERVAL '${intervalStr}' AS start_at,
        now() AS end_at
    ),
    -- 1. Runs enviados do período (critério atual do Dashboard: runs WHERE status='sent')
    runs_sent AS (
      SELECT
        r.client_id,
        r.phone,
        ${SQL_CANONICAL_PHONE("r.phone")} AS canonical_phone,
        r.sent_at
      FROM public.campaign_dispatch_runs r, params p
      WHERE r.status = 'sent'
        AND r.sent_at >= p.start_at
        AND r.sent_at < p.end_at
        AND r.phone IS NOT NULL AND r.phone <> ''
    ),
    -- 2. Respostas aos runs dentro da janela de 14 dias (critério do Dashboard)
    runs_with_replies AS (
      SELECT
        rs.client_id,
        rs.canonical_phone,
        EXISTS (
          SELECT 1
          FROM public.lead_messages lm
          WHERE lm.client_id = rs.client_id
            AND (lm.phone = rs.phone OR ${SQL_CANONICAL_PHONE("lm.phone")} = rs.canonical_phone)
            AND (lm.direction = 'inbound' OR lm.engagement_signal = 'reply')
            AND COALESCE(lm.message_timestamp, lm.delivered_at, lm.created_at) > rs.sent_at
            AND COALESCE(lm.message_timestamp, lm.delivered_at, lm.created_at) <= rs.sent_at + interval '14 days'
        ) AS replied
      FROM runs_sent rs
    ),
    runs_agg AS (
      SELECT
        client_id,
        COUNT(*)::int AS runs_total,
        COUNT(DISTINCT canonical_phone)::int AS runs_unique_leads,
        COUNT(*) FILTER (WHERE replied)::int AS runs_replied_14d,
        COUNT(DISTINCT canonical_phone) FILTER (WHERE replied)::int AS runs_leads_replied_14d
      FROM runs_with_replies
      GROUP BY client_id
    ),
    -- 3. Mensagens outbound de campanha (critério do Banco de Leads)
    msgs_sent AS (
      SELECT
        lm.client_id,
        ${SQL_CANONICAL_PHONE("lm.phone")} AS canonical_phone,
        MIN(COALESCE(lm.message_timestamp, lm.delivered_at, lm.created_at)) AS first_outbound_at,
        MAX(COALESCE(lm.message_timestamp, lm.delivered_at, lm.created_at)) AS last_outbound_at,
        COUNT(*)::int AS outbound_msg_count
      FROM public.lead_messages lm, params p
      WHERE lm.direction = 'outbound'
        AND lm.phone IS NOT NULL AND lm.phone <> ''
        AND (
          lm.campaign_id IS NOT NULL
          OR lm.dispatch_id IS NOT NULL
          OR lm.meta->>'source' IN ('campaign_dispatch', 'campaign_reply_progression')
        )
        AND COALESCE(lm.message_timestamp, lm.delivered_at, lm.created_at) >= p.start_at
        AND COALESCE(lm.message_timestamp, lm.delivered_at, lm.created_at) < p.end_at
      GROUP BY lm.client_id, ${SQL_CANONICAL_PHONE("lm.phone")}
    ),
    -- 4. Respostas aos envios de mensagens (14 dias e histórico total pós-envio)
    msgs_with_replies AS (
      SELECT
        m.client_id,
        m.canonical_phone,
        m.outbound_msg_count,
        EXISTS (
          SELECT 1
          FROM public.lead_messages inb
          WHERE inb.client_id = m.client_id
            AND ${SQL_CANONICAL_PHONE("inb.phone")} = m.canonical_phone
            AND (inb.direction = 'inbound' OR inb.engagement_signal = 'reply')
            AND COALESCE(inb.message_timestamp, inb.delivered_at, inb.created_at) > m.first_outbound_at
            AND COALESCE(inb.message_timestamp, inb.delivered_at, inb.created_at) <= m.first_outbound_at + interval '14 days'
        ) AS replied_14d,
        EXISTS (
          SELECT 1
          FROM public.lead_messages inb
          WHERE inb.client_id = m.client_id
            AND ${SQL_CANONICAL_PHONE("inb.phone")} = m.canonical_phone
            AND (inb.direction = 'inbound' OR inb.engagement_signal = 'reply')
            AND COALESCE(inb.message_timestamp, inb.delivered_at, inb.created_at) > m.first_outbound_at
        ) AS replied_ever,
        EXISTS (
          SELECT 1
          FROM runs_sent rs
          WHERE rs.client_id = m.client_id
            AND rs.canonical_phone = m.canonical_phone
        ) AS has_run_in_period
      FROM msgs_sent m
    ),
    msgs_agg AS (
      SELECT
        client_id,
        SUM(outbound_msg_count)::int AS msgs_total,
        COUNT(DISTINCT canonical_phone)::int AS msgs_unique_leads,
        COUNT(*) FILTER (WHERE replied_14d)::int AS msgs_replied_14d,
        COUNT(*) FILTER (WHERE replied_ever)::int AS msgs_replied_ever,
        COUNT(*) FILTER (WHERE NOT has_run_in_period)::int AS leads_sem_run
      FROM msgs_with_replies
      GROUP BY client_id
    ),
    all_tenants AS (
      SELECT DISTINCT client_id FROM (
        SELECT client_id FROM runs_agg
        UNION
        SELECT client_id FROM msgs_agg
      ) t
      WHERE client_id IS NOT NULL AND client_id <> ''
    )
    SELECT
      t.client_id,
      COALESCE(r.runs_total, 0) AS dash_runs_enviados,
      COALESCE(r.runs_unique_leads, 0) AS dash_runs_leads,
      COALESCE(r.runs_replied_14d, 0) AS dash_responderam_runs,
      CASE
        WHEN COALESCE(r.runs_total, 0) > 0
        THEN ROUND((COALESCE(r.runs_replied_14d, 0)::numeric / r.runs_total) * 100, 1)
        ELSE 0
      END AS dash_taxa_runs_pct,
      COALESCE(r.runs_leads_replied_14d, 0) AS dash_leads_responderam,
      CASE
        WHEN COALESCE(r.runs_unique_leads, 0) > 0
        THEN ROUND((COALESCE(r.runs_leads_replied_14d, 0)::numeric / r.runs_unique_leads) * 100, 1)
        ELSE 0
      END AS dash_taxa_leads_pct,
      COALESCE(m.msgs_total, 0) AS real_msgs_outbound,
      COALESCE(m.msgs_unique_leads, 0) AS real_leads_alcancados,
      COALESCE(m.msgs_replied_14d, 0) AS real_responderam_14d,
      CASE
        WHEN COALESCE(m.msgs_unique_leads, 0) > 0
        THEN ROUND((COALESCE(m.msgs_replied_14d, 0)::numeric / m.msgs_unique_leads) * 100, 1)
        ELSE 0
      END AS real_taxa_14d_pct,
      COALESCE(m.msgs_replied_ever, 0) AS real_responderam_ever,
      CASE
        WHEN COALESCE(m.msgs_unique_leads, 0) > 0
        THEN ROUND((COALESCE(m.msgs_replied_ever, 0)::numeric / m.msgs_unique_leads) * 100, 1)
        ELSE 0
      END AS real_taxa_ever_pct,
      COALESCE(m.leads_sem_run, 0) AS buraco_leads_sem_run,
      CASE
        WHEN COALESCE(m.msgs_unique_leads, 0) > 0
        THEN ROUND((COALESCE(m.leads_sem_run, 0)::numeric / m.msgs_unique_leads) * 100, 1)
        ELSE 0
      END AS buraco_pct
    FROM all_tenants t
    LEFT JOIN runs_agg r ON r.client_id = t.client_id
    LEFT JOIN msgs_agg m ON m.client_id = t.client_id
    ORDER BY real_leads_alcancados DESC, dash_runs_enviados DESC;
  `;
}

export function formatMarkdownTable(rows, title) {
  let md = `\n### ${title}\n\n`;
  md += `| Tenant | Dashboard Enviados (Runs) | Leads em Runs | Dashboard Resp (Runs) | Taxa Dash (Runs) | Leads em Runs Resp | Taxa Dash (Leads) | Real Leads Alcançados | Real Resp (14d) | Real Taxa (14d) | Real Resp (Ever) | Real Taxa (Ever) | Buraco (Leads sem Run) | % Buraco |\n`;
  md += `| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |\n`;

  let totDashRuns = 0;
  let totDashLeads = 0;
  let totDashRespRuns = 0;
  let totDashRespLeads = 0;
  let totRealLeads = 0;
  let totRealResp14d = 0;
  let totRealRespEver = 0;
  let totBuraco = 0;

  for (const r of rows) {
    const dRuns = Number(r.dash_runs_enviados) || 0;
    const dLeads = Number(r.dash_runs_leads) || 0;
    const dRespRuns = Number(r.dash_responderam_runs) || 0;
    const dRespLeads = Number(r.dash_leads_responderam) || 0;
    const rLeads = Number(r.real_leads_alcancados) || 0;
    const rResp14d = Number(r.real_responderam_14d) || 0;
    const rRespEver = Number(r.real_responderam_ever) || 0;
    const buraco = Number(r.buraco_leads_sem_run) || 0;

    totDashRuns += dRuns;
    totDashLeads += dLeads;
    totDashRespRuns += dRespRuns;
    totDashRespLeads += dRespLeads;
    totRealLeads += rLeads;
    totRealResp14d += rResp14d;
    totRealRespEver += rRespEver;
    totBuraco += buraco;

    md += `| **${r.client_id}** | ${dRuns} | ${dLeads} | ${dRespRuns} | ${r.dash_taxa_runs_pct}% | ${dRespLeads} | ${r.dash_taxa_leads_pct}% | **${rLeads}** | ${rResp14d} | ${r.real_taxa_14d_pct}% | ${rRespEver} | ${r.real_taxa_ever_pct}% | **${buraco}** | **${r.buraco_pct}%** |\n`;
  }

  const totDashTaxaRuns = totDashRuns > 0 ? ((totDashRespRuns / totDashRuns) * 100).toFixed(1) : "0.0";
  const totDashTaxaLeads = totDashLeads > 0 ? ((totDashRespLeads / totDashLeads) * 100).toFixed(1) : "0.0";
  const totRealTaxa14d = totRealLeads > 0 ? ((totRealResp14d / totRealLeads) * 100).toFixed(1) : "0.0";
  const totRealTaxaEver = totRealLeads > 0 ? ((totRealRespEver / totRealLeads) * 100).toFixed(1) : "0.0";
  const totPctBuraco = totRealLeads > 0 ? ((totBuraco / totRealLeads) * 100).toFixed(1) : "0.0";

  md += `| **TOTAL GERAL** | **${totDashRuns}** | **${totDashLeads}** | **${totDashRespRuns}** | **${totDashTaxaRuns}%** | **${totDashRespLeads}** | **${totDashTaxaLeads}%** | **${totRealLeads}** | **${totRealResp14d}** | **${totRealTaxa14d}%** | **${totRealRespEver}** | **${totRealTaxaEver}%** | **${totBuraco}** | **${totPctBuraco}%** |\n`;
  return md;
}

export async function measureTenantsDiscrepancy(pool, intervalStr = "30 days") {
  const query = buildDiscrepancyQuery(intervalStr);
  const { rows } = await pool.query(query);
  return rows;
}

export async function run(connectionString = process.env.DATABASE_URL, log = console.log) {
  if (!connectionString) {
    throw new Error("Defina DATABASE_URL no ambiente para rodar.");
  }
  const url = new URL(connectionString);
  log(`Conectando (SOMENTE LEITURA) a ${url.hostname}:${url.port || 5432}/${url.pathname.slice(1)}`);

  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 15000 });
  try {
    log("\nExecutando medição de discrepância para janela de 30 DIAS...");
    const rows30d = await measureTenantsDiscrepancy(pool, "30 days");
    console.table(rows30d);
    log(formatMarkdownTable(rows30d, "Medição de Discrepância por Tenant (Últimos 30 dias)"));

    log("\nExecutando medição de discrepância para janela de 90 DIAS...");
    const rows90d = await measureTenantsDiscrepancy(pool, "90 days");
    console.table(rows90d);
    log(formatMarkdownTable(rows90d, "Medição de Discrepância por Tenant (Últimos 90 dias)"));

    return { rows30d, rows90d };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((err) => {
    console.error("Falhou:", err.message);
    process.exit(1);
  });
}
