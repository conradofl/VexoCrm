import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_FILE = path.resolve(
  __dirname,
  "../../supabase/migrations/20261026160000_drop_dead_model_defaults_and_migrate.sql"
);

const BASE_SCHEMA = `
  CREATE TABLE public.lead_client_n8n_settings (
    client_id text PRIMARY KEY,
    chatbot_llm_model text DEFAULT 'llama-3.3-70b-versatile'
  );

  CREATE TABLE public.followup_companies (
    id text PRIMARY KEY DEFAULT 'comp-' || substr(md5(random()::text), 1, 8),
    tenant_id text,
    inbound_model text DEFAULT 'gpt-4o'
  );

  -- Simula dados nascidos em produção antes da nova migration:
  INSERT INTO public.lead_client_n8n_settings (client_id) VALUES ('bia-do-spazio'), ('container-led'), ('iluminus');
  INSERT INTO public.lead_client_n8n_settings (client_id, chatbot_llm_model) VALUES ('tenant-llama-morto', 'llama-3.1-8b-instant');

  INSERT INTO public.followup_companies (tenant_id) VALUES ('bia-do-spazio'), ('gesthor-empresarial');
  INSERT INTO public.followup_companies (tenant_id, inbound_model) VALUES ('tenant-followup-morto', 'qwen-2.5-32b');
`;

describe("SPEC 2: Migration de Remoção de Defaults de Modelos Mortos", () => {
  it("Aplica a migration real no Postgres (pglite), remove column_default e migra linhas mortas", async () => {
    const db = await createPgliteDb(BASE_SCHEMA);

    // 1. Confere que antes da migration os defaults e modelos mortos existiam
    const beforeN8n = await db.query(
      `SELECT column_default FROM information_schema.columns WHERE table_name = 'lead_client_n8n_settings' AND column_name = 'chatbot_llm_model'`
    );
    expect(beforeN8n.rows[0]?.column_default).toContain("llama-3.3-70b-versatile");

    const beforeFollowup = await db.query(
      `SELECT column_default FROM information_schema.columns WHERE table_name = 'followup_companies' AND column_name = 'inbound_model'`
    );
    expect(beforeFollowup.rows[0]?.column_default).toContain("gpt-4o");

    // 2. Lê e executa o arquivo de migration DE PRODUÇÃO
    const migrationSql = fs.readFileSync(MIGRATION_FILE, "utf-8");
    await db.exec(migrationSql);

    // 3. Valida que column_default é estritamente NULL em ambas as colunas
    const afterN8n = await db.query(
      `SELECT column_default FROM information_schema.columns WHERE table_name = 'lead_client_n8n_settings' AND column_name = 'chatbot_llm_model'`
    );
    expect(afterN8n.rows[0]?.column_default).toBeNull();

    const afterFollowup = await db.query(
      `SELECT column_default FROM information_schema.columns WHERE table_name = 'followup_companies' AND column_name = 'inbound_model'`
    );
    expect(afterFollowup.rows[0]?.column_default).toBeNull();

    // 4. Valida que novos registros inseridos sem o campo não herdam nenhum modelo morto
    await db.query(`INSERT INTO public.lead_client_n8n_settings (client_id) VALUES ('novo-tenant-sem-default')`);
    const newRowN8n = await db.query(
      `SELECT chatbot_llm_model FROM public.lead_client_n8n_settings WHERE client_id = 'novo-tenant-sem-default'`
    );
    expect(newRowN8n.rows[0]?.chatbot_llm_model).toBeNull();

    await db.query(`INSERT INTO public.followup_companies (tenant_id) VALUES ('novo-tenant-sem-default')`);
    const newRowFollowup = await db.query(
      `SELECT inbound_model FROM public.followup_companies WHERE tenant_id = 'novo-tenant-sem-default'`
    );
    expect(newRowFollowup.rows[0]?.inbound_model).toBeNull();

    // 5. Valida que todas as linhas antigas com modelos mortos foram migradas para openai/gpt-oss-120b
    const deadN8n = await db.query(`
      SELECT count(*)::int as count FROM public.lead_client_n8n_settings
      WHERE chatbot_llm_model IN (
        'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'llama3-70b-8192',
        'llama3-8b-8192', 'mixtral-8x7b-32768', 'gemma2-9b-it',
        'gemma-7b-it', 'deepseek-r1-distill-llama-70b', 'qwen-2.5-32b'
      )
    `);
    expect(deadN8n.rows[0]?.count).toBe(0);

    const migratedN8n = await db.query(
      `SELECT chatbot_llm_model FROM public.lead_client_n8n_settings WHERE client_id = 'bia-do-spazio'`
    );
    expect(migratedN8n.rows[0]?.chatbot_llm_model).toBe("openai/gpt-oss-120b");

    await db.close();
  });
});
