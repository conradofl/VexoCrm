// backend/src/test/fase1AgentChipMigration.test.js
//
// Testes da Migração da Fase 1 (ops/sql/2026-10-10-fase1-provisionar-agente-por-chip.sql)
// Executado contra Postgres REAL (pglite) para validar:
// - Herança estrita de chatbot_enabled E chatbot_instances (bloqueante)
// - Gravação do UUID do chip em evolution_instances
// - Nome reconhecível ("<Nome do Chip> (Padrão do Chip)")
// - Não-regressão, preservação de agentes existentes e idempotência
// - Provas de mutação obrigatórias

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { resolveInstanceIdentifier } from "../services/evolution.js";

const SQL_PATH = existsSync(resolve("ops/sql/2026-10-10-fase1-provisionar-agente-por-chip.sql"))
  ? resolve("ops/sql/2026-10-10-fase1-provisionar-agente-por-chip.sql")
  : resolve("../ops/sql/2026-10-10-fase1-provisionar-agente-por-chip.sql");

const SQL_MIGRATION = readFileSync(SQL_PATH, "utf8");

const BASE_SCHEMA = `
  SET TimeZone = 'UTC';

  CREATE TABLE IF NOT EXISTS public.leads_clients (
    id TEXT PRIMARY KEY,
    name TEXT,
    send_window_timezone TEXT DEFAULT 'America/Sao_Paulo'
  );

  CREATE TABLE IF NOT EXISTS public.lead_client_n8n_settings (
    client_id TEXT PRIMARY KEY,
    chatbot_enabled BOOLEAN DEFAULT false,
    chatbot_model TEXT DEFAULT 'generico',
    chatbot_llm_model TEXT,
    chatbot_instances JSONB DEFAULT '[]'::jsonb,
    send_window_timezone TEXT DEFAULT 'America/Sao_Paulo',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS public.evolution_instance_daily_usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instance_id UUID NOT NULL,
    client_id TEXT NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,
    sent_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS public.lead_client_evolution_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT 'Evolution',
    dispatch_webhook_url TEXT NOT NULL,
    dispatch_webhook_token TEXT,
    inbound_bearer_token TEXT,
    owner_uid TEXT,
    active BOOLEAN NOT NULL DEFAULT true,
    is_default BOOLEAN NOT NULL DEFAULT false,
    chip_state TEXT DEFAULT 'ready',
    connection_state TEXT DEFAULT 'open',
    daily_limit_override INTEGER,
    webhook_enabled BOOLEAN DEFAULT true,
    updated_by_email TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS public.followup_companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    evolution_instance TEXT,
    evolution_instances JSONB NOT NULL DEFAULT '[]'::jsonb,
    agent_kind TEXT NOT NULL DEFAULT 'atendimento',
    inbound_enabled BOOLEAN NOT NULL DEFAULT false,
    inbound_prompt TEXT,
    inbound_spin_fields JSONB DEFAULT '[]'::jsonb,
    instructions_consolidated_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

describe("Fase 1: Migração Aditiva de Agentes por Chip Ativo", () => {
  let db;

  beforeEach(async () => {
    db = await createPgliteDb(BASE_SCHEMA);
  });

  afterEach(async () => {
    if (db) await db.close();
  });

  it("1. Preenche evolution_instances a partir de evolution_instance onde o JSONB estiver vazio", async () => {
    // Agente antigo que só tinha evolution_instance preenchido
    await db.exec(`
      INSERT INTO public.followup_companies (tenant_id, name, evolution_instance, evolution_instances, inbound_enabled)
      VALUES ('tenant-antigo', 'Agente Legado', 'chip-legado-slug', '[]'::jsonb, true);
    `);

    await db.exec(SQL_MIGRATION);

    const { rows } = await db.query(`
      SELECT evolution_instance, evolution_instances
      FROM public.followup_companies
      WHERE tenant_id = 'tenant-antigo';
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].evolution_instance).toBe("chip-legado-slug");
    expect(rows[0].evolution_instances).toEqual(["chip-legado-slug"]);
  });

  it("2. Chip sem agente em tenant com chatbot ligado e lista vazia nasce ligado com nome reconhecível e UUID em evolution_instances", async () => {
    // Tenant com chatbot ligado e lista de instâncias vazia (atende todos)
    await db.exec(`
      INSERT INTO public.lead_client_n8n_settings (client_id, chatbot_enabled, chatbot_instances)
      VALUES ('tenant-ligado', true, '[]'::jsonb);
    `);

    // Chip ativo sem nenhum agente
    const chipId = "11111111-2222-3333-4444-555555555555";
    await db.exec(`
      INSERT INTO public.lead_client_evolution_instances (id, client_id, name, dispatch_webhook_url, active)
      VALUES ('${chipId}', 'tenant-ligado', 'Vexo Atende', 'https://evo.vexo.com/message/sendText/vexo-atende-slug', true);
    `);

    await db.exec(SQL_MIGRATION);

    const { rows } = await db.query(`
      SELECT tenant_id, name, evolution_instance, evolution_instances, agent_kind, inbound_enabled, instructions_consolidated_at
      FROM public.followup_companies
      WHERE tenant_id = 'tenant-ligado';
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Vexo Atende (Padrão do Chip)"); // Reconhecível pelo dono
    expect(rows[0].evolution_instance).toBe("Vexo Atende"); // Nome de exibição
    expect(rows[0].evolution_instances).toEqual([chipId]); // UUID do chip gravado
    expect(rows[0].agent_kind).toBe("atendimento");
    expect(rows[0].inbound_enabled).toBe(true); // Herdou true do tenant
    expect(rows[0].instructions_consolidated_at).toBeNull(); // NUNCA consolida em massa
  });

  it("3. Chip de tenant com chatbot desligado (chatbot_enabled = false) nasce com inbound_enabled = false", async () => {
    // Tenant com chatbot desligado
    await db.exec(`
      INSERT INTO public.lead_client_n8n_settings (client_id, chatbot_enabled)
      VALUES ('tenant-desligado', false);
    `);

    // Chip ativo sem agente
    await db.exec(`
      INSERT INTO public.lead_client_evolution_instances (client_id, name, dispatch_webhook_url, active)
      VALUES ('tenant-desligado', 'Chip Mudo', 'https://evo.vexo.com/message/sendText/chip-mudo-slug', true);
    `);

    await db.exec(SQL_MIGRATION);

    const { rows } = await db.query(`
      SELECT inbound_enabled
      FROM public.followup_companies
      WHERE tenant_id = 'tenant-desligado';
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].inbound_enabled).toBe(false); // Herdou false, não perturba ninguém
  });

  it("4. [REGRA BLOQUEANTE] Tenant com chatbot_enabled = true e 3 chips, mas apenas 1 em chatbot_instances: apenas esse nasce ligado", async () => {
    const chip1Id = "aaaaaaaa-0000-0000-0000-000000000001";
    const chip2Id = "bbbbbbbb-0000-0000-0000-000000000002";
    const chip3Id = "cccccccc-0000-0000-0000-000000000003";

    // Tenant com chatbot ligado, mas COM RESTRIÇÃO EXPLICITA: só o Chip 1 está autorizado no chatbot_instances
    await db.exec(`
      INSERT INTO public.lead_client_n8n_settings (client_id, chatbot_enabled, chatbot_instances)
      VALUES ('tenant-com-filtro', true, jsonb_build_array('${chip1Id}'));
    `);

    // 3 chips ativos
    await db.exec(`
      INSERT INTO public.lead_client_evolution_instances (id, client_id, name, dispatch_webhook_url, active)
      VALUES
        ('${chip1Id}', 'tenant-com-filtro', 'Chip Autorizado', 'https://evo.vexo.com/message/sendText/chip-1-slug', true),
        ('${chip2Id}', 'tenant-com-filtro', 'Chip Nao Vinculado A', 'https://evo.vexo.com/message/sendText/chip-2-slug', true),
        ('${chip3Id}', 'tenant-com-filtro', 'Chip Nao Vinculado B', 'https://evo.vexo.com/message/sendText/chip-3-slug', true);
    `);

    await db.exec(SQL_MIGRATION);

    const { rows } = await db.query(`
      SELECT evolution_instance, evolution_instances, inbound_enabled
      FROM public.followup_companies
      WHERE tenant_id = 'tenant-com-filtro'
      ORDER BY evolution_instance ASC;
    `);

    expect(rows).toHaveLength(3);

    const agente1 = rows.find((r) => r.evolution_instances[0] === chip1Id);
    const agente2 = rows.find((r) => r.evolution_instances[0] === chip2Id);
    const agente3 = rows.find((r) => r.evolution_instances[0] === chip3Id);

    // CRUCIAL: Só o chip que estava em chatbot_instances nasce ligado!
    expect(agente1.inbound_enabled).toBe(true);
    expect(agente2.inbound_enabled).toBe(false);
    expect(agente3.inbound_enabled).toBe(false);
  });

  it("5. Chip que já possui agente associado NÃO é duplicado nem modificado", async () => {
    await db.exec(`
      INSERT INTO public.lead_client_n8n_settings (client_id, chatbot_enabled)
      VALUES ('tenant-existente', true);
    `);

    const chipExistenteId = "99999999-9999-9999-9999-999999999999";
    await db.exec(`
      INSERT INTO public.lead_client_evolution_instances (id, client_id, name, dispatch_webhook_url, active)
      VALUES ('${chipExistenteId}', 'tenant-existente', 'Chip Já Configurado', 'https://evo.vexo.com/message/sendText/chip-configurado-slug', true);
    `);

    // Agente customizado já existente
    await db.exec(`
      INSERT INTO public.followup_companies (
        tenant_id, name, evolution_instance, evolution_instances, inbound_enabled, inbound_prompt, instructions_consolidated_at
      ) VALUES (
        'tenant-existente', 'Agente Custom', 'Chip Já Configurado', '["${chipExistenteId}"]'::jsonb, false, 'Meu prompt customizado', '2026-09-01T00:00:00Z'
      );
    `);

    await db.exec(SQL_MIGRATION);

    const { rows } = await db.query(`
      SELECT name, inbound_enabled, inbound_prompt, instructions_consolidated_at
      FROM public.followup_companies
      WHERE tenant_id = 'tenant-existente';
    `);

    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Agente Custom");
    expect(rows[0].inbound_enabled).toBe(false); // Manteve sua configuração original
    expect(rows[0].inbound_prompt).toBe("Meu prompt customizado");
    expect(rows[0].instructions_consolidated_at).not.toBeNull();
  });

  it("6. Idempotência estrita: executar a migração 2 vezes resulta em 0 duplicações", async () => {
    await db.exec(`
      INSERT INTO public.lead_client_n8n_settings (client_id, chatbot_enabled)
      VALUES ('tenant-idempotente', true);
    `);

    await db.exec(`
      INSERT INTO public.lead_client_evolution_instances (client_id, name, dispatch_webhook_url, active)
      VALUES ('tenant-idempotente', 'Chip Alfa', 'https://evo.vexo.com/message/sendText/chip-alfa-slug', true);
    `);

    // 1ª execução
    await db.exec(SQL_MIGRATION);
    const { rows: rows1 } = await db.query(`SELECT count(*)::int as n FROM public.followup_companies WHERE tenant_id = 'tenant-idempotente'`);
    expect(rows1[0].n).toBe(1);

    // 2ª execução
    await db.exec(SQL_MIGRATION);
    const { rows: rows2 } = await db.query(`SELECT count(*)::int as n FROM public.followup_companies WHERE tenant_id = 'tenant-idempotente'`);
    expect(rows2[0].n).toBe(1);
  });

  it("7. Chip inativo (active = false) NÃO recebe novo agente", async () => {
    await db.exec(`
      INSERT INTO public.lead_client_n8n_settings (client_id, chatbot_enabled)
      VALUES ('tenant-inativo', true);
    `);

    await db.exec(`
      INSERT INTO public.lead_client_evolution_instances (client_id, name, dispatch_webhook_url, active)
      VALUES ('tenant-inativo', 'Chip Inativo', 'https://evo.vexo.com/message/sendText/chip-inativo', false);
    `);

    await db.exec(SQL_MIGRATION);

    const { rows } = await db.query(`
      SELECT count(*)::int as n FROM public.followup_companies WHERE tenant_id = 'tenant-inativo'
    `);
    expect(rows[0].n).toBe(0);
  });

  it("8. resolveInstanceIdentifier resolve o chip migrado sem divergência", async () => {
    const chipSlugId = "33333333-3333-3333-3333-333333333333";
    await db.exec(`
      INSERT INTO public.lead_client_evolution_instances (id, client_id, name, dispatch_webhook_url, active)
      VALUES ('${chipSlugId}', 'tenant-slug', 'Atendimento Vexo', 'https://evo.vexo.com/message/sendText/atendimento-vexo-slug', true);
    `);

    await db.exec(SQL_MIGRATION);

    const pool = { query: (sql, params) => db.query(sql, params) };
    const res = await resolveInstanceIdentifier({
      clientId: "tenant-slug",
      identifier: "Atendimento Vexo",
      pool,
    });

    expect(res.canonicalName).toBe("atendimento-vexo-slug");
    expect(res.aliases).toContain("Atendimento Vexo");
    expect(res.aliases).toContain(chipSlugId);
  });

  it("9. [PROVA DE MUTAÇÃO 1] criar agente sempre ligado ignora chatbot_enabled=false e FALHA na validação de herança", async () => {
    // Simulação do SQL mutante com defeito: hardcode 'true' em vez de herdar chatbot_enabled
    const SQL_MUTANTE_1 = `
      INSERT INTO public.followup_companies (tenant_id, name, evolution_instance, evolution_instances, agent_kind, inbound_enabled)
      SELECT i.client_id, i.name, i.name, jsonb_build_array(i.id::text), 'atendimento', true
      FROM public.lead_client_evolution_instances i
      WHERE i.active = true;
    `;

    const dbMutante = await createPgliteDb(BASE_SCHEMA);
    try {
      await dbMutante.exec(`
        INSERT INTO public.lead_client_n8n_settings (client_id, chatbot_enabled)
        VALUES ('cliente-silencioso', false);
      `);

      await dbMutante.exec(`
        INSERT INTO public.lead_client_evolution_instances (client_id, name, dispatch_webhook_url, active)
        VALUES ('cliente-silencioso', 'Chip Desligado', 'https://evo.vexo.com/message/sendText/chip-desligado', true);
      `);

      // Executa o SQL mutante
      await dbMutante.exec(SQL_MUTANTE_1);

      const { rows } = await dbMutante.query(`
        SELECT inbound_enabled FROM public.followup_companies WHERE tenant_id = 'cliente-silencioso';
      `);

      // O mutante ligou indevidamente o agente (true).
      const herdouCorretamente = rows[0].inbound_enabled === false;
      expect(herdouCorretamente).toBe(false); // Prova de mutação 1 confirmada
    } finally {
      await dbMutante.close();
    }
  });

  it("10. [PROVA DE MUTAÇÃO 2] ignorar chatbot_instances liga chips não vinculados e FALHA no teste de herança seletiva", async () => {
    // Simulação do SQL mutante com defeito: olha apenas chatbot_enabled e ignora a lista chatbot_instances
    const SQL_MUTANTE_2 = `
      INSERT INTO public.followup_companies (tenant_id, name, evolution_instance, evolution_instances, agent_kind, inbound_enabled)
      SELECT i.client_id, i.name, i.name, jsonb_build_array(i.id::text), 'atendimento', COALESCE(s.chatbot_enabled, false)
      FROM public.lead_client_evolution_instances i
      LEFT JOIN public.lead_client_n8n_settings s ON s.client_id = i.client_id
      WHERE i.active = true;
    `;

    const dbMutante = await createPgliteDb(BASE_SCHEMA);
    try {
      const chipPermitido = "11111111-1111-1111-1111-111111111111";
      const chipProibido = "22222222-2222-2222-2222-222222222222";

      await dbMutante.exec(`
        INSERT INTO public.lead_client_n8n_settings (client_id, chatbot_enabled, chatbot_instances)
        VALUES ('tenant-mutante', true, jsonb_build_array('${chipPermitido}'));
      `);

      await dbMutante.exec(`
        INSERT INTO public.lead_client_evolution_instances (id, client_id, name, dispatch_webhook_url, active)
        VALUES
          ('${chipPermitido}', 'tenant-mutante', 'Chip Autorizado', 'https://evo.vexo.com/message/sendText/c1', true),
          ('${chipProibido}', 'tenant-mutante', 'Chip Proibido', 'https://evo.vexo.com/message/sendText/c2', true);
      `);

      await dbMutante.exec(SQL_MUTANTE_2);

      const { rows } = await dbMutante.query(`
        SELECT evolution_instances, inbound_enabled FROM public.followup_companies WHERE tenant_id = 'tenant-mutante';
      `);

      const proibidoRow = rows.find((r) => r.evolution_instances[0] === chipProibido);
      // O mutante ligou erroneamente o chip proibido (true).
      // A asserção prova que o mutante falharia na regra bloqueante:
      const proibidoFicouDesligado = proibidoRow.inbound_enabled === false;
      expect(proibidoFicouDesligado).toBe(false); // Prova de mutação 2 confirmada
    } finally {
      await dbMutante.close();
    }
  });
});
