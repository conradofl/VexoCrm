// backend/src/scripts/updateChatbotInboundScopeToAll.js
//
// Atualiza o default da coluna chatbot_inbound_scope para 'all' e
// define chatbot_inbound_scope = 'all' para todos os tenants em public.lead_client_n8n_settings.
//
// Uso:
//   node backend/src/scripts/updateChatbotInboundScopeToAll.js

import pg from "pg";
import { pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", "..", ".env") });

export async function run(connectionString, log = console.log) {
  const url = new URL(connectionString);
  log(`Conectando a ${url.hostname}:${url.port || 5432}/${url.pathname.slice(1)}`);
  
  const explicitSsl = String(process.env.DATABASE_SSL || process.env.PGSSLMODE || "").toLowerCase();
  const ssl = ["1", "true", "require"].includes(explicitSsl) ? { rejectUnauthorized: false } : false;

  const pool = new pg.Pool({ connectionString, ssl, connectionTimeoutMillis: 8000 });
  try {
    log("Alterando default da coluna chatbot_inbound_scope para 'all'...");
    await pool.query(`
      ALTER TABLE public.lead_client_n8n_settings
        ALTER COLUMN chatbot_inbound_scope SET DEFAULT 'all';
    `);

    log("Atualizando tenants existentes para chatbot_inbound_scope = 'all'...");
    const updateResult = await pool.query(`
      UPDATE public.lead_client_n8n_settings
      SET chatbot_inbound_scope = 'all'
      WHERE chatbot_inbound_scope IS NULL OR chatbot_inbound_scope != 'all'
      RETURNING client_id, chatbot_inbound_scope;
    `);

    log(`Total de tenants atualizados: ${updateResult.rowCount}`);
    for (const row of updateResult.rows) {
      log(` - Tenant: ${row.client_id} -> chatbot_inbound_scope = '${row.chatbot_inbound_scope}'`);
    }

    const currentRows = await pool.query(`
      SELECT client_id, chatbot_inbound_scope
      FROM public.lead_client_n8n_settings
      ORDER BY client_id;
    `);
    log("\nEstado atual de todos os tenants em lead_client_n8n_settings:");
    for (const row of currentRows.rows) {
      log(` - ${row.client_id}: ${row.chatbot_inbound_scope}`);
    }

    return { updated: updateResult.rowCount, total: currentRows.rowCount };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    console.error("Defina DATABASE_URL ou SUPABASE_DB_URL em backend/.env para rodar.");
    process.exit(1);
  }
  run(connectionString).catch((err) => {
    console.error("Falhou:", err.message);
    process.exit(1);
  });
}
