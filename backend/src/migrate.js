/**
 * Migration runner para Postgres direto — chamado na subida do server.js.
 * Usa a mesma tabela `app_schema_migrations` do conditional-migrate.mjs.
 * Tem bootstrap automático: se o banco já existe sem histórico, detecta e marca como aplicadas.
 */

import { readdir, readFile } from "fs/promises";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { GROQ_MODELOS_MORTOS } from "./services/llmModels.js";

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
      WHERE table_schema = 'public' AND table_name IN ('leads', 'leads_infinie', 'campaigns', 'leads_clients')
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
    "20260831180000_add_whatsapp_number_validation_and_invalid_status.sql": `SELECT (
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='whatsapp_number_validations')
      AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_dispatch_runs_status_check' AND pg_get_constraintdef(oid) LIKE '%invalid_number%')
    ) AS ok`,
    "20260829160000_add_extracao_whatsapp_to_lead_source_check.sql": `SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_lead_source_check' AND pg_get_constraintdef(oid) LIKE '%extracao_whatsapp%') AS ok`,
    "20260805060000_n8n_settings_chatbot_instances.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='chatbot_instances') AS ok`,
    // Sentinela cobre o efeito COMPLETO (coluna E indice). Uma sentinela que testa
    // menos do que a migration faz pode marca-la como aplicada sem ter rodado —
    // foi o que aconteceu com 20260730000000, cujas constraints nunca existiram
    // porque a coluna que ela checava era criada por outro caminho.
    // Sentinela checa AS COLUNAS QUE ESTA MIGRATION CRIA — as oito, nas tres
    // tabelas. Sentinela que testa uma coluna ja existente deixa o baseline de
    // migrate.js:143-149 marcar a migration como aplicada SEM executar: foi o que
    // aconteceu com 20260730000000, cuja sentinela olhava extracted_from_wa (criada
    // por outro caminho) e as constraints dela nunca existiram.
    "20260813100000_gd_commercial_columns.sql": `SELECT (
      (SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND table_name='gd_proposals' AND column_name IN ('owner_company','condicoes_especiais','desconto_setup_pct','desconto_mensal_pct','vexi_plan','vexi_price','vexo_plan','vexo_price')) = 8
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gd_contracts' AND column_name='owner_company')
      AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gd_implementation_briefings' AND column_name='owner_company')
    ) AS ok`,
    "20260811090000_campaign_dispatches_prompt_copy.sql": `SELECT (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='campaign_dispatches' AND column_name='campaign_prompt_id') AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_campaign_dispatches_prompt')) AS ok`,
    "20260805040000_followup_companies_inbound_role.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='followup_companies' AND column_name='inbound_role') AS ok`,
    "20260804180000_followup_companies_evolution_instances.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='followup_companies' AND column_name='evolution_instances') AS ok`,
    "20260512100000_add_chatbot_enabled_to_n8n_settings.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='chatbot_enabled') AS ok`,
    "20260512110000_add_chatbot_model_to_n8n_settings.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='chatbot_model') AS ok`,
    "20260512120000_add_sdr_whatsapp_number_to_n8n_settings.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='sdr_whatsapp_number') AS ok`,
    "20260613190000_add_segmentation_config_to_n8n_settings.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='segmentation_config') AS ok`,
    "20260512130000_rename_leads_to_leads_infinie_and_create_leads_teste.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='leads_infinie') AS ok`,
    "20260514100443_add_missing_columns_to_leads_outlier.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads_outlier' AND column_name='interesse') AS ok`,
    "20260514160916_add_missing_columns_to_leads_infinie.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads_infinie' AND column_name='interesse') AS ok`,
    "20260515120000_add_chatbot_prompts.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='chatbot_prompts') AS ok`,
    "20260515140000_add_chatbot_templates.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='chatbot_templates') AS ok`,
    "20260516021000_add_campaign_source_columns_to_dynamic_tables.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads_outlier' AND column_name='lead_origin') AS ok`,
    "20260516100000_normalize_leads_individual_columns.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads_outlier' AND column_name='credito') AS ok`,
    "20260516200000_fix_chatbot_template_outlier_credito_field.sql": `SELECT NOT EXISTS (SELECT 1 FROM chatbot_templates, jsonb_array_elements(data_fields) AS f WHERE template_key='outlier' AND client_id IS NULL AND f->>'key' = 'credito_faixa') AS ok`,
    "20260516210000_seed_chatbot_prompts_outlier_infinie.sql": `SELECT EXISTS (SELECT 1 FROM chatbot_prompts WHERE client_id='outlier' AND type='padrao') AS ok`,
    "20260516220000_spin_fase_and_prompt_updates.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads_infinie' AND column_name='spin_fase') AS ok`,
    "20260516230000_add_tenant_nexus_demo.sql": `SELECT EXISTS (SELECT 1 FROM public.leads_clients WHERE id='nexus') AS ok`,
    "20260516240000_force_upsert_chatbot_prompts.sql": `SELECT EXISTS (SELECT 1 FROM chatbot_prompts WHERE client_id='outlier' AND type='padrao' AND length(content) > 100) AS ok`,
    "20260618000000_create_crm_consultant_schedules.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='crm_consultant_schedules') AS ok`,
    "20260730000000_create_vexo_lead_intelligence.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='leads' AND column_name='extracted_from_wa') AS ok`,
    "20260730150000_add_chatbot_llm_model_to_n8n_settings.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='chatbot_llm_model') AS ok`,
    "20260812160000_add_recontact_message_to_n8n_settings.sql": `SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='recontact_message') AS ok`,
    // Sentinela checa a coluna QUE ESTA MIGRATION CRIA (chip_limit) e a tabela que
    // ela garante (system_settings) — nao uma coluna vizinha. Sentinela que testa
    // menos do que a migration faz deixa o baseline de migrate.js:143-149 marca-la
    // como aplicada SEM executar; foi assim que a 20260730000000 nunca rodou.
    "20260817160000_add_chip_limit_to_n8n_settings.sql": `SELECT (
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='chip_limit')
      AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='system_settings')
    ) AS ok`,
    "20260824000000_add_resumo_prompt_type.sql": `SELECT (
      NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='chatbot_prompts')
      OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chatbot_prompts_type_check' AND pg_get_constraintdef(oid) LIKE '%resumo%')
    ) AS ok`,
    "20260824110000_separate_evolution_chip_connection_state.sql": `SELECT (
      NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='lead_client_evolution_instances')
      OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_evolution_instances' AND column_name='connection_state')
    ) AS ok`,
    "20260825170000_add_lead_messages_wa_message_id.sql": `SELECT (
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_messages' AND column_name='wa_message_id')
      AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_lead_messages_wa_message_id')
    ) AS ok`,
    "20260825180000_migrate_dead_llama_models_to_gpt_oss.sql": (() => {
      const mortosIn = Array.from(GROQ_MODELOS_MORTOS).map((m) => `'${m}'`).join(", ");
      return `SELECT (
        NOT EXISTS (SELECT 1 FROM public.followup_companies WHERE inbound_model IN (${mortosIn}))
        AND NOT EXISTS (SELECT 1 FROM public.lead_client_n8n_settings WHERE chatbot_llm_model IN (${mortosIn}))
      ) AS ok`;
    })(),
    "20260827000000_add_lead_messages_message_timestamp.sql": `SELECT (
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_messages' AND column_name='message_timestamp')
      AND EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='idx_lead_messages_message_timestamp')
    ) AS ok`,
    "20260827150000_add_after_enrollment_trigger_type.sql": `SELECT (
      NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='followup_templates')
      OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'followup_templates_trigger_type_check' AND pg_get_constraintdef(oid) LIKE '%after_enrollment%')
    ) AS ok`,
    "20260827163000_fix_followup_schedules_origin_type_check.sql": `SELECT (
      NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='followup_schedules')
      OR (
        EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'followup_schedules_origin_type_check' AND pg_get_constraintdef(oid) LIKE '%manual%')
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'followup_schedules_status_check' AND pg_get_constraintdef(oid) LIKE '%cancelled%')
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'followup_jobs_status_check' AND pg_get_constraintdef(oid) LIKE '%cancelled%')
      )
    ) AS ok`,
    "20260827180000_add_followup_jobs_custom_message.sql": `SELECT (
      NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='followup_jobs')
      OR (
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='followup_jobs' AND column_name='custom_message')
        AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'followup_jobs_content_check')
      )
    ) AS ok`,
    "20260831160000_add_send_window_settings.sql": `SELECT (
      NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='lead_client_n8n_settings')
      OR (
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='send_window_start')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='send_window_end')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='send_window_days')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='send_window_timezone')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='send_window_enabled')
        AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='lead_client_n8n_settings' AND column_name='agent_replies_outside_window')
      )
    ) AS ok`,
    "20260831170000_fix_send_window_days_jsonb.sql": `SELECT (
      NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='lead_client_n8n_settings')
      OR EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema='public' 
          AND table_name='lead_client_n8n_settings' 
          AND column_name='send_window_days' 
          AND data_type = 'jsonb'
      )
    ) AS ok`,
    "20260831200000_add_auto_resume_to_campaign_dispatches_trigger_type.sql": `SELECT (
      NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='campaign_dispatches')
      OR EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'campaign_dispatches_trigger_type_check' AND pg_get_constraintdef(oid) LIKE '%auto_resume%')
    ) AS ok`,
    "20260831190000_seed_generico_chatbot_template.sql": `SELECT (
      NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='chatbot_templates')
      OR EXISTS (SELECT 1 FROM public.chatbot_templates WHERE template_key = 'generico' AND client_id IS NULL)
    ) AS ok`,
    "20260831210000_archive_outlier_and_infinie_templates.sql": `SELECT (
      NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='chatbot_templates')
      OR NOT EXISTS (SELECT 1 FROM public.chatbot_templates WHERE template_key IN ('outlier', 'infinie') AND is_builtin = true AND client_id IS NULL)
    ) AS ok`,
    "20260901190000_create_whatsapp_chat_states.sql": `SELECT (
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='whatsapp_chat_states')
      AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_chat_states_state_check')
    ) AS ok`,
    "20260908180000_add_ticket_medio_to_leads_clients.sql": `SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'leads_clients'
        AND column_name = 'ticket_medio'
    ) AS ok`,
    "20260911120000_add_agent_muted_to_whatsapp_chat_states.sql": `SELECT (
      NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='whatsapp_chat_states')
      OR EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'whatsapp_chat_states'
          AND column_name = 'agent_muted_at'
      )
    ) AS ok`,
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

let migrationStatus = {
  status: "idle", // "idle" | "running" | "completed" | "failed" | "skipped"
  lastRunAt: null,
  totalFiles: 0,
  appliedCount: 0,
  pendingCount: 0,
  failedMigration: null,
  error: null,
};

export function getMigrationStatus() {
  return { ...migrationStatus };
}

export async function runMigrations(pool) {
  if (!pool) {
    console.warn("[migrate] No Postgres pool — skipping");
    migrationStatus = {
      status: "skipped",
      lastRunAt: new Date().toISOString(),
      totalFiles: 0,
      appliedCount: 0,
      pendingCount: 0,
      failedMigration: null,
      error: "No Postgres pool configured",
    };
    return;
  }

  migrationStatus.status = "running";
  migrationStatus.lastRunAt = new Date().toISOString();

  try {
    await ensureMigrationsTable(pool);

    let files;
    try {
      files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith(".sql")).sort();
    } catch {
      console.warn("[migrate] Migrations dir not found:", MIGRATIONS_DIR);
      migrationStatus.status = "failed";
      migrationStatus.error = `Migrations dir not found: ${MIGRATIONS_DIR}`;
      return;
    }

    const applied = await getAppliedMigrations(pool);
    migrationStatus.totalFiles = files.length;
    migrationStatus.appliedCount = applied.size;

    // Validação estrita: impede colisões de timestamp em migrations pendentes/novas.
    // Colisões antigas onde ambos os arquivos já estão aplicados no banco são toleradas para não travar o boot.
    const seenTimestamps = new Map();
    for (const file of files) {
      const match = file.match(/^(\d{14})_/);
      if (match) {
        const prefix = match[1];
        if (seenTimestamps.has(prefix)) {
          const prior = seenTimestamps.get(prefix);
          if (!applied.has(file) || !applied.has(prior)) {
            const errMsg = `DUPLICATE MIGRATION TIMESTAMP: "${file}" tem o mesmo prefixo (${prefix}) que "${prior}". Toda migration pendente exige timestamp único.`;
            console.error(`🚨 [migrate] ${errMsg}`);
            throw new Error(errMsg);
          }
        }
        seenTimestamps.set(prefix, file);
      }
    }

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
      migrationStatus.appliedCount = afterBootstrap.size;
      const pending = files.filter((f) => !afterBootstrap.has(f));
      migrationStatus.pendingCount = pending.length;
      if (pending.length === 0) {
        console.info("[migrate] All migrations already applied");
        migrationStatus.status = "completed";
        migrationStatus.failedMigration = null;
        migrationStatus.error = null;
        return;
      }
      for (const file of pending) {
        try {
          await runMigration(pool, file);
          migrationStatus.appliedCount++;
          migrationStatus.pendingCount--;
        } catch (mErr) {
          migrationStatus.status = "failed";
          migrationStatus.failedMigration = file;
          migrationStatus.error = mErr.message;
          console.error("══════════════════════════════════════════════════════════════════════════════");
          console.error(`🚨 [migrate] ERRO CRÍTICO NA MIGRATION: ${file}`);
          console.error(`🚨 [migrate] Motivo: ${mErr.message}`);
          console.error(`🚨 [migrate] A cadeia de migrations parou! As migrations seguintes NÃO rodaram.`);
          console.error("══════════════════════════════════════════════════════════════════════════════");
          return;
        }
      }
      migrationStatus.status = "completed";
      migrationStatus.failedMigration = null;
      migrationStatus.error = null;
      return;
    }

    const pending = files.filter((f) => !applied.has(f));
    migrationStatus.pendingCount = pending.length;
    if (pending.length === 0) {
      console.info("[migrate] No pending migrations");
      migrationStatus.status = "completed";
      migrationStatus.failedMigration = null;
      migrationStatus.error = null;
      return;
    }

    console.info(`[migrate] Running ${pending.length} migration(s)...`);
    for (const file of pending) {
      try {
        await runMigration(pool, file);
        migrationStatus.appliedCount++;
        migrationStatus.pendingCount--;
      } catch (mErr) {
        migrationStatus.status = "failed";
        migrationStatus.failedMigration = file;
        migrationStatus.error = mErr.message;
        console.error("══════════════════════════════════════════════════════════════════════════════");
        console.error(`🚨 [migrate] ERRO CRÍTICO NA MIGRATION: ${file}`);
        console.error(`🚨 [migrate] Motivo: ${mErr.message}`);
        console.error(`🚨 [migrate] A cadeia de migrations parou! As ${migrationStatus.pendingCount} migration(s) restante(s) NÃO rodaram.`);
        console.error("══════════════════════════════════════════════════════════════════════════════");
        return;
      }
    }
    console.info("[migrate] All migrations applied");
    migrationStatus.status = "completed";
    migrationStatus.failedMigration = null;
    migrationStatus.error = null;
  } catch (err) {
    migrationStatus.status = "failed";
    migrationStatus.error = err.message;
    console.error("══════════════════════════════════════════════════════════════════════════════");
    console.error(`🚨 [migrate] ERRO GERAL NO RUNNER DE MIGRATIONS: ${err.message}`);
    console.error("══════════════════════════════════════════════════════════════════════════════");
  }
}

