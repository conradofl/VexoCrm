// backend/src/scripts/measureCaptureDispatches24h.js
//
// SÓ LEITURA. Mede envios em public.lead_capture_dispatches para o tenant vexo-adm nas últimas 24h.
//
// Uso:
//   node backend/src/scripts/measureCaptureDispatches24h.js

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
    const query = `
      SELECT phone, count(*) AS envios_24h, max(created_at) AS ultimo
        FROM public.lead_capture_dispatches
       WHERE client_id = 'vexo-adm' AND created_at >= now() - INTERVAL '24 hours'
       GROUP BY phone ORDER BY envios_24h DESC;
    `;
    const { rows } = await pool.query(query);

    log("\n=== MEDIÇÃO LEAD_CAPTURE_DISPATCHES (vexo-adm, últimas 24h) ===");
    if (rows.length === 0) {
      log("Nenhum registro encontrado para vexo-adm nas últimas 24 horas.");
    } else {
      console.table(rows);
    }

    // Consulta complementar para verificar registros totais / recentes
    const { rows: allRecent } = await pool.query(`
      SELECT id, client_id, phone, status, reason, created_at
        FROM public.lead_capture_dispatches
       WHERE client_id = 'vexo-adm'
       ORDER BY created_at DESC
       LIMIT 10;
    `);

    log("\n=== ÚLTIMOS 10 REGISTROS (vexo-adm) ===");
    if (allRecent.length === 0) {
      log("Nenhum registro encontrado na tabela lead_capture_dispatches para vexo-adm.");
    } else {
      console.table(allRecent);
    }

    // Consulta complementar em leads para ver como o lead foi salvo
    const { rows: recentLeads } = await pool.query(`
      SELECT id, client_id, nome, telefone, email, created_at,
             whatsapp_dispatch_blocked_reason, whatsapp_dispatch_reason
        FROM public.leads
       WHERE client_id = 'vexo-adm'
       ORDER BY created_at DESC
       LIMIT 5;
    `);

    log("\n=== ÚLTIMOS 5 LEADS SALVOS (vexo-adm) ===");
    console.table(recentLeads);

    return { rows, allRecent, recentLeads };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch((err) => {
    console.error("Falha ao medir:", err.message);
    process.exit(1);
  });
}
