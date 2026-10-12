// backend/src/scripts/inspectStalledNotifications.js
//
// SÓ LEITURA. Mede, em todos os tenants, quantas notificações de lead_stalled existem hoje
// em public.notifications, e quantas estão não lidas.
//
// Uso:
//   node backend/src/scripts/inspectStalledNotifications.js

import pg from "pg";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export async function run(connectionString = process.env.DATABASE_URL, log = console.log) {
  if (!connectionString) {
    throw new Error("DATABASE_URL não configurada no ambiente ou no .env.");
  }

  const url = new URL(connectionString);
  log(`Conectando (SOMENTE LEITURA) a ${url.hostname}:${url.port || 5432}/${url.pathname.slice(1)}`);

  const pool = new pg.Pool({ connectionString, connectionTimeoutMillis: 10000 });
  try {
    // 1. Contagem específica de 'lead_stalled' por tenant
    const { rows: stalledRows } = await pool.query(`
      SELECT 
        n.client_id,
        count(*)::int AS total,
        count(*) FILTER (WHERE n.read = false)::int AS unread,
        count(*) FILTER (WHERE n.read = true)::int AS read,
        min(n.created_at) AS oldest,
        max(n.created_at) AS newest
      FROM public.notifications n
      WHERE n.type = 'lead_stalled'
      GROUP BY n.client_id
      ORDER BY total DESC;
    `);

    // 2. Contagem global de notificações por tipo
    const { rows: allTypeRows } = await pool.query(`
      SELECT 
        n.type,
        count(*)::int AS total,
        count(*) FILTER (WHERE n.read = false)::int AS unread
      FROM public.notifications n
      GROUP BY n.type
      ORDER BY total DESC;
    `);

    // 3. Status da coluna stalled_notifications_synced_at em lead_client_n8n_settings
    let syncStatusRows = [];
    try {
      const { rows } = await pool.query(`
        SELECT client_id, stalled_notifications_synced_at
        FROM public.lead_client_n8n_settings
        WHERE stalled_notifications_synced_at IS NOT NULL
        ORDER BY stalled_notifications_synced_at DESC;
      `);
      syncStatusRows = rows;
    } catch (e) {
      log(`Aviso: lead_client_n8n_settings.stalled_notifications_synced_at indisponível: ${e.message}`);
    }

    log("\n=== NOTIFICAÇÕES GLOBAIS POR TIPO ===");
    if (allTypeRows.length === 0) {
      log("Nenhuma notificação registrada na tabela public.notifications.");
    } else {
      for (const row of allTypeRows) {
        log(`tipo: ${row.type} | total: ${row.total} | não lidas: ${row.unread}`);
      }
    }

    log("\n=== NOTIFICAÇÕES 'lead_stalled' POR TENANT ===");
    if (stalledRows.length === 0) {
      log("Nenhuma notificação de 'lead_stalled' encontrada.");
    } else {
      let sumTotal = 0;
      let sumUnread = 0;
      for (const row of stalledRows) {
        sumTotal += row.total;
        sumUnread += row.unread;
        log(`tenant: ${row.client_id} | total: ${row.total} | não lidas: ${row.unread} | lidas: ${row.read} | mais antiga: ${row.oldest?.toISOString()} | mais recente: ${row.newest?.toISOString()}`);
      }
      log(`\nTOTAL GERAL 'lead_stalled': ${sumTotal} (não lidas: ${sumUnread})`);
    }

    log("\n=== ÚLTIMO SYNC DIÁRIO REGISTRADO (lead_client_n8n_settings) ===");
    if (syncStatusRows.length === 0) {
      log("Nenhum tenant possui stalled_notifications_synced_at registrado.");
    } else {
      for (const row of syncStatusRows) {
        log(`tenant: ${row.client_id} | synced_at: ${row.stalled_notifications_synced_at?.toISOString()}`);
      }
    }

    return { stalledRows, allTypeRows, syncStatusRows };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((err) => {
    console.error("Falha ao inspecionar notificações:", err.message);
    process.exit(1);
  });
}
