// backend/src/scripts/listStuckCampaignLeads.js
//
// SÓ LEITURA. Lista todos os leads com campanha pendente em status 'aguardando_usuario'
// no bia-do-spazio e no sonhare (e demais tenants).
// Mostra a data da última interação, tempo estagnado e identifica leads com múltiplas
// campanhas pendentes simultâneas.
//
// Uso (no ambiente que alcança o banco de PRODUÇÃO):
//   DATABASE_URL=postgres://... node backend/src/scripts/listStuckCampaignLeads.js
//
// O script imprime o host e o banco a que se conectou, e NUNCA faz UPDATE ou DELETE.

import pg from "pg";
import { pathToFileURL } from "node:url";

export async function run(connectionString, log = console.log) {
  const url = new URL(connectionString);
  log(`Conectando (SOMENTE LEITURA) a ${url.hostname}:${url.port || 5432}/${url.pathname.slice(1)}`);
  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 8000 });

  try {
    // 1. Resumo por tenant e por campanha de leads em aguardando_usuario
    const { rows: summaryRows } = await pool.query(`
      SELECT
        lii.client_id,
        key AS campaign_id,
        COALESCE(c.name, 'Campanha não encontrada / removida') AS campaign_name,
        c.status AS campaign_status,
        c.archived_at IS NOT NULL AS is_archived,
        COUNT(*)::int AS leads_aguardando
      FROM public.lead_import_items lii
      CROSS JOIN LATERAL jsonb_each(lii.normalized_data->'campaign_progress') AS p(key, val)
      LEFT JOIN public.campaigns c ON c.id::text = key AND c.client_id = lii.client_id
      WHERE val->>'status' = 'aguardando_usuario'
      GROUP BY lii.client_id, key, c.name, c.status, c.archived_at
      ORDER BY lii.client_id, leads_aguardando DESC
    `);

    log("\n===============================================================================");
    log("RESUMO DE LEADS EM 'aguardando_usuario' POR TENANT E CAMPANHA");
    log("===============================================================================");
    log("tenant | campaign_id | campaign_name | status | leads_aguardando");
    for (const r of summaryRows) {
      log(`${r.client_id} | ${r.campaign_id} | ${r.campaign_name.slice(0, 30)} | ${r.is_archived ? "archived" : r.campaign_status || "n/a"} | ${r.leads_aguardando}`);
    }

    // 2. Leads com DUAS OU MAIS campanhas pendentes ao mesmo tempo
    const { rows: multiPendingRows } = await pool.query(`
      WITH pending_per_phone AS (
        SELECT
          lii.client_id,
          regexp_replace(lii.telefone, '\\D', '', 'g') AS phone,
          COUNT(DISTINCT key)::int AS pending_campaign_count,
          array_agg(DISTINCT key) AS campaign_ids
        FROM public.lead_import_items lii
        CROSS JOIN LATERAL jsonb_each(lii.normalized_data->'campaign_progress') AS p(key, val)
        WHERE val->>'status' = 'aguardando_usuario'
        GROUP BY lii.client_id, regexp_replace(lii.telefone, '\\D', '', 'g')
        HAVING COUNT(DISTINCT key) > 1
      )
      SELECT client_id, phone, pending_campaign_count, campaign_ids
      FROM pending_per_phone
      ORDER BY client_id, pending_campaign_count DESC
    `);

    log("\n===============================================================================");
    log("LEADS COM MÚLTIPLAS CAMPANHAS PENDENTES SIMULTÂNEAS (EM RISCO DE SEQUESTRO)");
    log("===============================================================================");
    log(`Total de leads em risco: ${multiPendingRows.length}`);
    for (const r of multiPendingRows) {
      log(`${r.client_id} | phone: ${r.phone} | ${r.pending_campaign_count} campanhas pendentes: ${r.campaign_ids.join(", ")}`);
    }

    // 3. Detalhamento dos leads pendentes com timestamps
    const { rows: detailRows } = await pool.query(`
      SELECT
        lii.client_id,
        lii.id AS import_item_id,
        lii.telefone,
        key AS campaign_id,
        COALESCE(c.name, 'N/A') AS campaign_name,
        COALESCE(
          NULLIF(val->>'updatedAt', '')::timestamptz,
          NULLIF(val->>'updated_at', '')::timestamptz,
          NULLIF(val->>'lastReplyAt', '')::timestamptz,
          NULLIF(val->>'dispatchedAt', '')::timestamptz,
          lii.ultima_interacao_bot,
          lii.created_at
        ) AS last_interaction,
        ROUND(EXTRACT(EPOCH FROM (NOW() - COALESCE(
          NULLIF(val->>'updatedAt', '')::timestamptz,
          NULLIF(val->>'updated_at', '')::timestamptz,
          NULLIF(val->>'lastReplyAt', '')::timestamptz,
          NULLIF(val->>'dispatchedAt', '')::timestamptz,
          lii.ultima_interacao_bot,
          lii.created_at
        ))) / 86400.0, 1) AS days_stuck
      FROM public.lead_import_items lii
      CROSS JOIN LATERAL jsonb_each(lii.normalized_data->'campaign_progress') AS p(key, val)
      LEFT JOIN public.campaigns c ON c.id::text = key AND c.client_id = lii.client_id
      WHERE val->>'status' = 'aguardando_usuario'
        AND lii.client_id IN ('bia-do-spazio', 'sonhare')
      ORDER BY lii.client_id, days_stuck DESC
      LIMIT 200
    `);

    log("\n===============================================================================");
    log("AMOSTRA DE LEADS PENDENTES (bia-do-spazio & sonhare) COM DIAS ESTAGNADOS");
    log("===============================================================================");
    log("tenant | telefone | campaign_name | last_interaction | days_stuck");
    for (const d of detailRows.slice(0, 30)) {
      log(`${d.client_id} | ${d.telefone} | ${d.campaign_name.slice(0, 25)} | ${d.last_interaction ? new Date(d.last_interaction).toISOString() : "n/a"} | ${d.days_stuck}d`);
    }
    if (detailRows.length > 30) {
      log(`... e mais ${detailRows.length - 30} leads listados.`);
    }

    return {
      summary: summaryRows,
      multiPending: multiPendingRows,
      detailsCount: detailRows.length,
    };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Defina DATABASE_URL para rodar a medição somente-leitura.");
    process.exit(1);
  }
  run(connectionString).catch((err) => {
    console.error("Falhou:", err.message);
    process.exit(1);
  });
}
