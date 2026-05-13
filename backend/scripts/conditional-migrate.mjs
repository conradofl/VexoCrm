import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backendRoot = join(__dirname, "..");
const migrationsDir = join(backendRoot, "supabase", "migrations");

dotenv.config({ path: join(backendRoot, ".env") });

if (process.env.SKIP_DB_MIGRATE === "1") {
  console.log("[migrate] Skipping because SKIP_DB_MIGRATE=1");
  process.exit(0);
}

const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.warn("[migrate] Skipping: set DATABASE_URL or SUPABASE_DB_URL in backend/.env.");
  process.exit(0);
}

function resolveSslConfig() {
  const explicit = String(process.env.DATABASE_SSL || process.env.PGSSLMODE || "").toLowerCase();
  if (["1", "true", "require"].includes(explicit)) {
    return { rejectUnauthorized: false };
  }
  return false;
}

async function ensureMigrationTable(client) {
  await client.query(`
    create table if not exists public.app_schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);
}

async function getAppliedMigrations(client) {
  const result = await client.query("select name from public.app_schema_migrations");
  return new Set(result.rows.map((row) => row.name));
}

async function hasLegacySchema(client) {
  const result = await client.query(`
    select exists (
      select 1
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('leads', 'lead_import_items', 'campaigns')
    ) as has_schema
  `);
  return result.rows[0]?.has_schema === true;
}

async function migrationAlreadyRepresented(client, fileName) {
  const checks = {
    "20260221031218_fc81ff5b-64c3-45e7-bba5-06ab383a6d75.sql": `
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'n8n_error_logs'
      ) as ok
    `,
    "20260304000001_create_leads_tables.sql": `
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'leads'
      ) as ok
    `,
    "20260304000002_seed_leads_infinie.sql": `
      select exists (
        select 1 from public.leads_clients where id = 'infinie'
      ) as ok
    `,
    "20260309000003_create_lead_conversations.sql": `
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'lead_conversations'
      ) as ok
    `,
    "20260315000004_create_lead_import_tables.sql": `
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'lead_import_items'
      ) as ok
    `,
    "20260315000005_normalize_brazilian_phones.sql": `
      select exists (
        select 1 from pg_proc
        where proname = 'normalize_brazilian_phone'
      ) as ok
    `,
    "20260409000006_drop_legacy_assistant_tables.sql": "select true as ok",
    "20260412000007_create_access_profiles.sql": `
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'access_profiles'
      ) as ok
    `,
    "20260414000008_alter_campaigns_schedule_and_archive.sql": `
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'campaigns' and column_name = 'archived_at'
      ) as ok
    `,
    "20260420000009_create_revenue_ops_tables.sql": `
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'lead_conversions'
      ) as ok
    `,
    "20260420000010_add_commercial_intelligence_settings.sql": `
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'leads_clients' and column_name = 'commercial_intelligence_settings'
      ) as ok
    `,
    "20260430000011_add_campaign_segmentation_meta.sql": `
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'campaigns' and column_name = 'analytics_meta'
      ) as ok
    `,
    "20260503000012_campaign_dispatch_runner.sql": `
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'campaign_dispatch_logs'
      ) as ok
    `,
    "20260505000012_add_conversation_status_to_leads.sql": `
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'lead_import_items' and column_name = 'status_conversa'
      ) as ok
    `,
    "20260505000013_create_lead_client_n8n_settings.sql": `
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'lead_client_n8n_settings'
      ) as ok
    `,
    "20260506000001_create_vexo_sales_tables.sql": `
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'lead_messages'
      ) as ok
    `,
    "20260507100000_create_leads_outlier.sql": `
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = 'leads_outlier'
      ) as ok
    `,
    "20260507103000_adjust_leads_outlier_like_leads.sql": `
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'leads_outlier' and column_name = 'source_campaign_id'
      ) as ok
    `,
    // Coluna criada manualmente em VPS / ou aplicada antes do ficheiro existir no repo: marca como já aplicada no bootstrap.
    "20260508120000_add_campaigns_phones_column.sql": `
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'campaigns' and column_name = 'phones'
      ) as ok
    `,
    "20260512100000_add_chatbot_enabled_to_n8n_settings.sql": `
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'lead_client_n8n_settings' and column_name = 'chatbot_enabled'
      ) as ok
    `,
    "20260512110000_add_chatbot_model_to_n8n_settings.sql": `
      select exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'lead_client_n8n_settings' and column_name = 'chatbot_model'
      ) as ok
    `,
  };

  const query = checks[fileName];
  if (!query) return false;
  const result = await client.query(query);
  return result.rows[0]?.ok === true;
}

async function bootstrapAppliedMigrations(client, files) {
  for (const fileName of files) {
    if (!(await migrationAlreadyRepresented(client, fileName))) {
      console.log(`[migrate] Leaving ${fileName} pending because its schema is not present yet.`);
      continue;
    }
    await client.query(
      "insert into public.app_schema_migrations (name) values ($1) on conflict (name) do nothing",
      [fileName]
    );
  }
}

async function applyMigration(client, fileName, sql) {
  await client.query("begin");
  try {
    await client.query(sql);
    await client.query(
      "insert into public.app_schema_migrations (name) values ($1) on conflict (name) do nothing",
      [fileName]
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  }
}

async function main() {
  console.log("[migrate] Applying SQL migrations directly via pg...");

  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: resolveSslConfig(),
  });

  await client.connect();

  try {
    await ensureMigrationTable(client);
    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort((left, right) => left.localeCompare(right));
    let applied = await getAppliedMigrations(client);

    if (applied.size === 0 && (await hasLegacySchema(client))) {
      console.log("[migrate] Existing schema detected without migration history. Bootstrapping file history.");
      await bootstrapAppliedMigrations(client, files);
      applied = await getAppliedMigrations(client);
    }

    for (const fileName of files) {
      if (applied.has(fileName)) {
        console.log(`[migrate] Skipping already applied ${fileName}`);
        continue;
      }

      const fullPath = join(migrationsDir, fileName);
      const sql = await readFile(fullPath, "utf8");
      console.log(`[migrate] Applying ${fileName}`);
      await applyMigration(client, fileName, sql);
    }
  } finally {
    await client.end();
  }

  console.log("[migrate] Done.");
}

main().catch((error) => {
  console.error("[migrate] Failed:", error);
  process.exit(1);
});
