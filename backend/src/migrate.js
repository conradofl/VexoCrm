/**
 * Migration runner para Postgres direto — chamado na subida do server.js.
 * Usa a mesma tabela `app_schema_migrations` do conditional-migrate.mjs.
 * Tem bootstrap automático: se o banco já existe sem histórico, detecta e marca como aplicadas.
 */

import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "supabase", "migrations");
const MIGRATIONS_TABLE = "public.app_schema_migrations";

async function ensureMigrationsTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(pool) {
  const { rows } = await pool.query(`SELECT name FROM ${MIGRATIONS_TABLE}`);
  return new Set(rows.map((r) => r.name));
}

async function hasExistingSchema(pool) {
  const { rows } = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('leads', 'campaigns', 'leads_clients')
    ) AS has_schema
  `);
  return rows[0]?.has_schema === true;
}

// Verifica se o efeito de cada migration antiga já existe no banco
async function isAlreadyApplied(pool, filename) {
  const checks = {
    "20260221031218_fc81ff5b-64c3-45e7-bba5-06ab383a6d75.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='n8n_error_logs') AS ok`,
    "20260304000001_create_leads_tables.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='leads') AS ok`,
    "20260304000002_seed_leads_infinie.sql": `SELECT EXISTS (SELECT 1 FROM public.leads_clients WHERE id='infinie') AS ok`,
    "20260309000003_create_lead_conversations.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='lead_conversations') AS ok`,
    "20260315000004_create_lead_import_tables.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='lead_import_items') AS ok`,
    "20260315000005_normalize_brazilian_phones.sql": `SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname='normalize_brazilian_phone') AS ok`,
    "20260409000006_drop_legacy_assistant_tables.sql": `SELECT TRUE AS ok`,
    "20260412000007_create_access_profiles.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='access_profiles') AS ok`,
    "20260414000008_alter_campaigns_schedule_and_archive.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='campaigns' AND column_name='archived_at') AS ok`,
    "20260420000009_create_revenue_ops_tables.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='lead_conversions') AS ok`,
    "20260420000010_add_commercial_intelligence_settings.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads_clients' AND column_name='commercial_intelligence_settings') AS ok`,
    "20260430000011_add_campaign_segmentation_meta.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='campaigns' AND column_name='analytics_meta') AS ok`,
    "20260503000012_campaign_dispatch_runner.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='campaign_dispatch_logs') AS ok`,
    "20260505000012_add_conversation_status_to_leads.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_import_items' AND column_name='status_conversa') AS ok`,
    "20260505000013_create_lead_client_n8n_settings.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='lead_client_n8n_settings') AS ok`,
    "20260506000001_create_vexo_sales_tables.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='lead_messages') AS ok`,
    "20260507100000_create_leads_outlier.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='leads_outlier') AS ok`,
    "20260507103000_adjust_leads_outlier_like_leads.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads_outlier' AND column_name='source_campaign_id') AS ok`,
    "20260508000001_drop_conta_energia_from_leads_outlier.sql": `SELECT TRUE AS ok`,
    "20260508120000_add_campaigns_phones_column.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='campaigns' AND column_name='phones') AS ok`,
    // Novas migrations — verificam se coluna já existe
    "20260512100000_add_chatbot_enabled_to_n8n_settings.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='chatbot_enabled') AS ok`,
    "20260512110000_add_chatbot_model_to_n8n_settings.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='chatbot_model') AS ok`,
  };

  const query = checks[filename];
  if (!query) return false;
  try {
    const { rows } = await pool.query(query);
    return rows[0]?.ok === true;
  } catch {
    return false;
  }
}

async function markAsApplied(pool, filename) {
  await pool.query(
    `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
    [filename]
  );
}

async function runMigration(pool, filename) {
  const sql = await readFile(join(MIGRATIONS_DIR, filename), "utf8");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
      [filename]
    );
    await client.query("COMMIT");
    console.info(`[migrate] ✅ Applied: ${filename}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw new Error(`[migrate] ❌ Failed: ${filename} — ${err.message}`);
  } finally {
    client.release();
  }
}

export async function runMigrations(pool) {
  if (!pool) {
    console.warn("[migrate] No Postgres pool — skipping");
    return;
  }

  try {
    await ensureMigrationsTable(pool);

    let files;
    try {
      files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    } catch {
      console.warn("[migrate] Migrations dir not found:", MIGRATIONS_DIR);
      return;
    }

    const applied = await getAppliedMigrations(pool);

    // Bootstrap: banco já existe mas sem histórico → detectar e marcar migrations já aplicadas
    if (applied.size === 0 && (await hasExistingSchema(pool))) {
      console.info("[migrate] Existing schema detected — bootstrapping migration history...");
      for (const file of files) {
        if (await isAlreadyApplied(pool, file)) {
          await markAsApplied(pool, file);
          console.info(`[migrate] Baselined: ${file}`);
        }
      }
      // Re-checar o que ainda está pendente após bootstrap
      const afterBootstrap = await getAppliedMigrations(pool);
      const pending = files.filter((f) => !afterBootstrap.has(f));
      if (pending.length === 0) {
        console.info("[migrate] All migrations already applied");
        return;
      }
      for (const file of pending) {
        await runMigration(pool, file);
      }
      return;
    }

    const pending = files.filter((f) => !applied.has(f));
    if (pending.length === 0) {
      console.info("[migrate] No pending migrations");
      return;
    }

    console.info(`[migrate] Running ${pending.length} migration(s)...`);
    for (const file of pending) {
      await runMigration(pool, file);
    }
    console.info("[migrate] All migrations applied");
  } catch (err) {
    console.error("[migrate] Error:", err.message);
  }
}
