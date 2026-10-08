// backend/src/test/leadReactivationEngine.test.js
// Testes do Pilar 2: Reativação Automática de Leads Parados (Cadência de Resgate Automático)
// Validação de elegibilidade (dias de inatividade, etapas ativas), proteção de cooldown,
// marcação da tag #Reativacao-Automatica, isolamento multi-tenant e endpoints HTTP.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import {
  getReactivationSettings,
  saveReactivationSettings,
  getCadenceOptions,
  countEligibleReactivations,
  countReactivatedLast30Days,
  runDueReactivations,
  REACTIVATION_TAG,
} from "../services/leadReactivationEngine.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const TENANT_A = "tenant-alfa";
const TENANT_B = "tenant-beta";

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE lead_client_n8n_settings (
    client_id text PRIMARY KEY,
    reactivation_enabled boolean DEFAULT false,
    reactivation_stalled_days int DEFAULT 7,
    reactivation_cadence_id uuid,
    reactivation_cooldown_days int DEFAULT 30,
    updated_at timestamptz DEFAULT now()
  );

  CREATE TABLE followup_companies (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id text NOT NULL,
    name text
  );

  CREATE TABLE followup_campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id uuid NOT NULL REFERENCES followup_companies(id),
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    default_origin text,
    dispatch_jitter_minutes int DEFAULT 0
  );

  CREATE TABLE followup_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id uuid,
    company_id uuid NOT NULL,
    lead_name text,
    phone text,
    origin text,
    origin_type text,
    status text DEFAULT 'active',
    created_at timestamptz DEFAULT now()
  );

  CREATE TABLE leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    telefone text NOT NULL,
    phone text,
    nome text,
    status text,
    stage text DEFAULT 'cold',
    temperature text DEFAULT 'warm',
    tags text[] DEFAULT ARRAY[]::text[],
    dados jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_interaction_at timestamptz,
    last_message_at timestamptz,
    data_nascimento date,
    assigned_to text,
    UNIQUE (client_id, telefone)
  );
`;

describe("Pilar 2: Motor de Reativação Automática (leadReactivationEngine)", () => {
  let db;
  let pool;
  let server;
  let baseUrl;

  let companyAId;
  let cadenceAId;
  let companyBId;
  let cadenceBId;

  let mockEnrollLead;

  beforeAll(async () => {
    db = await createPgliteDb(SCHEMA);
    pool = {
      query: (sql, params) => db.query(sql, params),
    };

    // Tenants
    await db.exec(`
      INSERT INTO leads_clients (id, name) VALUES ('${TENANT_A}', 'Alfa Corp'), ('${TENANT_B}', 'Beta Corp');
    `);

    // Empresas de follow-up e cadências
    const { rows: compARows } = await db.query(`
      INSERT INTO followup_companies (tenant_id, name) VALUES ('${TENANT_A}', 'Empresa Alfa') RETURNING id;
    `);
    companyAId = compARows[0].id;

    const { rows: campARows } = await db.query(`
      INSERT INTO followup_campaigns (company_id, name, status)
      VALUES ('${companyAId}', 'Cadência Resgate Alfa 7d', 'active') RETURNING id;
    `);
    cadenceAId = campARows[0].id;

    const { rows: compBRows } = await db.query(`
      INSERT INTO followup_companies (tenant_id, name) VALUES ('${TENANT_B}', 'Empresa Beta') RETURNING id;
    `);
    companyBId = compBRows[0].id;

    const { rows: campBRows } = await db.query(`
      INSERT INTO followup_campaigns (company_id, name, status)
      VALUES ('${companyBId}', 'Cadência Beta 7d', 'active') RETURNING id;
    `);
    cadenceBId = campBRows[0].id;

    // Configuração inicial de reativação para o Tenant A
    await db.query(`
      INSERT INTO lead_client_n8n_settings (client_id, reactivation_enabled, reactivation_stalled_days, reactivation_cadence_id, reactivation_cooldown_days)
      VALUES ('${TENANT_A}', true, 7, '${cadenceAId}', 30);
    `);

    // Semeia leads de teste:
    // Lead 1: Parado há 10 dias (Tenant A, stage inquiry) -> ELEGÍVEL
    await db.query(`
      INSERT INTO leads (client_id, telefone, nome, stage, last_message_at, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999991001', 'Lead Alfa Elegível 10d', 'inquiry',
              NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days', NOW() - INTERVAL '30 days');
    `);

    // Lead 2: Parado há 8 dias (Tenant A, stage cold) -> ELEGÍVEL
    await db.query(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999991002', 'Lead Alfa Elegível 8d', 'cold',
              NOW() - INTERVAL '8 days', NOW() - INTERVAL '20 days');
    `);

    // Lead 3: Parado há apenas 3 dias (Tenant A, stage open_budget) -> NÃO ELEGÍVEL (< 7 dias)
    await db.query(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999991003', 'Lead Alfa Recente 3d', 'open_budget',
              NOW() - INTERVAL '3 days', NOW() - INTERVAL '10 days');
    `);

    // Lead 4: FECHADO/BUYER parado há 15 dias (Tenant A) -> NÃO ELEGÍVEL (estágio fechado)
    await db.query(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999991004', 'Lead Alfa Comprador', 'buyer',
              NOW() - INTERVAL '15 days', NOW() - INTERVAL '30 days');
    `);

    // Lead 5: PERDIDO/LOST parado há 20 dias (Tenant A) -> NÃO ELEGÍVEL (estágio perdido)
    await db.query(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999991005', 'Lead Alfa Perdido', 'lost',
              NOW() - INTERVAL '20 days', NOW() - INTERVAL '40 days');
    `);

    // Lead 6: Parado há 12 dias mas inscrito em reativação há 5 dias (Tenant A) -> NÃO ELEGÍVEL (em COOLDOWN)
    await db.query(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999991006', 'Lead Alfa em Cooldown', 'inquiry',
              NOW() - INTERVAL '12 days', NOW() - INTERVAL '20 days');
    `);
    await db.query(`
      INSERT INTO followup_schedules (campaign_id, company_id, lead_name, phone, origin, created_at)
      VALUES ('${cadenceAId}', '${companyAId}', 'Lead Alfa em Cooldown', '5511999991006', 'reativacao_automatica', NOW() - INTERVAL '5 days');
    `);

    // Lead 7: Parado há 14 dias no TENANT B -> NÃO deve ser tocado pelo Tenant A
    await db.query(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_B}', '5511999992001', 'Lead Beta 14d', 'inquiry',
              NOW() - INTERVAL '14 days', NOW() - INTERVAL '30 days');
    `);

    // Mock do motor de enrollLead para teste
    mockEnrollLead = vi.fn().mockImplementation(async (campaign, leadData) => {
      const { rows } = await pool.query(
        `INSERT INTO followup_schedules (campaign_id, company_id, lead_name, phone, origin, created_at)
         VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id`,
        [campaign.id, campaign.company_id, leadData.lead_name, leadData.phone, leadData.originOverride || "manual"]
      );
      return { scheduleId: rows[0].id, enqueued: 1 };
    });

    // Configura servidor Express de teste com as rotas
    const app = express();
    app.use(express.json());

    const sendError = (res, status, code, message, details) =>
      res.status(status).json({ error: { code, message, details } });

    registerLeadsRoutes(app, {
      ensureDb: () => true,
      pgDatabasePool: pool,
      supabase: null,
      requireFirebaseAuth: (req, _res, next) => {
        req.authAccess = { uid: "test-user", role: "internal", clientId: TENANT_A };
        next();
      },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      ensureSharedRoutePageAccess: () => true,
      resolveAuthorizedClientId: (_req, _res, cid) => cid || TENANT_A,
      sanitizePhone: (p) => p,
      sendError,
      normalizeString: (s) => (s ? String(s).trim() : ""),
      enrollLead: (...args) => mockEnrollLead(...args),
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("1. Salva e recupera configurações de reativação com validação e defaults", async () => {
    const settings = await getReactivationSettings(pool, TENANT_A);
    expect(settings.client_id).toBe(TENANT_A);
    expect(settings.reactivation_enabled).toBe(true);
    expect(settings.reactivation_stalled_days).toBe(7);
    expect(settings.reactivation_cadence_id).toBe(cadenceAId);
    expect(settings.reactivation_cooldown_days).toBe(30);

    // Tenant sem configuração prévia recebe defaults seguros
    const defaultSettings = await getReactivationSettings(pool, "tenant-novo");
    expect(defaultSettings.reactivation_enabled).toBe(false);
    expect(defaultSettings.reactivation_stalled_days).toBe(7);
    expect(defaultSettings.reactivation_cadence_id).toBeNull();
    expect(defaultSettings.reactivation_cooldown_days).toBe(30);
  });

  it("2. Lista cadências ativas escopadas ao tenant", async () => {
    const cadencesAlfa = await getCadenceOptions(pool, TENANT_A);
    expect(cadencesAlfa).toHaveLength(1);
    expect(cadencesAlfa[0].id).toBe(cadenceAId);
    expect(cadencesAlfa[0].name).toBe("Cadência Resgate Alfa 7d");

    const cadencesBeta = await getCadenceOptions(pool, TENANT_B);
    expect(cadencesBeta).toHaveLength(1);
    expect(cadencesBeta[0].id).toBe(cadenceBId);
  });

  it("3. Identifica exatamente os leads elegíveis (inativos >= 7d, ativos, fora de cooldown)", async () => {
    const count = await countEligibleReactivations(pool, {
      clientId: TENANT_A,
      stalledDays: 7,
      cadenceId: cadenceAId,
      cooldownDays: 30,
    });

    // Devem ser exatamente 2 leads: Lead 1 (10d) e Lead 2 (8d)
    // Lead 3 (3d) -> inativo insuficiente
    // Lead 4 (buyer) -> concluído
    // Lead 5 (lost) -> perdido
    // Lead 6 -> em cooldown (inscrito há 5 dias)
    // Lead 7 -> pertence ao Tenant B
    expect(count).toBe(2);
  });

  it("4. Executa a reativação, inscreve via enrollLead e aplica a tag #Reativacao-Automatica", async () => {
    mockEnrollLead.mockClear();

    const result = await runDueReactivations(pool, {
      clientId: TENANT_A,
      manual: true,
      enrollLeadFn: mockEnrollLead,
    });

    expect(result.success).toBe(true);
    expect(result.reactivated_count).toBe(2);
    expect(mockEnrollLead).toHaveBeenCalledTimes(2);

    // Verifica que cada chamada para enrollLead usou originOverride "reativacao_automatica"
    expect(mockEnrollLead).toHaveBeenCalledWith(
      expect.objectContaining({ id: cadenceAId }),
      expect.objectContaining({
        originOverride: "reativacao_automatica",
        phone: expect.stringMatching(/551199999100[12]/),
      })
    );

    // Verifica que os leads no banco receberam a tag #Reativacao-Automatica
    const { rows: taggedRows } = await pool.query(
      `SELECT telefone, tags FROM leads WHERE client_id = $1 AND tags @> ARRAY[$2]::text[]`,
      [TENANT_A, REACTIVATION_TAG]
    );

    expect(taggedRows).toHaveLength(2);
    const phones = taggedRows.map((r) => r.telefone);
    expect(phones).toContain("5511999991001");
    expect(phones).toContain("5511999991002");
  });

  it("5. Proteção de Cooldown impede reativação em loop na mesma janela de 30 dias", async () => {
    // Imediatamente após a reativação acima, os 2 leads agora possuem registro recente em followup_schedules
    const countAfter = await countEligibleReactivations(pool, {
      clientId: TENANT_A,
      stalledDays: 7,
      cadenceId: cadenceAId,
      cooldownDays: 30,
    });

    expect(countAfter).toBe(0);

    // Se tentarmos rodar novamente a reativação, zero leads devem ser inscritos
    mockEnrollLead.mockClear();
    const secondRun = await runDueReactivations(pool, {
      clientId: TENANT_A,
      manual: true,
      enrollLeadFn: mockEnrollLead,
    });

    expect(secondRun.reactivated_count).toBe(0);
    expect(mockEnrollLead).not.toHaveBeenCalled();
  });

  it("6. Garante isolamento multi-tenant estrito (Tenant A nunca reativa Tenant B)", async () => {
    // Lead do Tenant B permaneceu intacto e sem a tag
    const { rows: leadBRows } = await pool.query(
      `SELECT tags FROM leads WHERE client_id = $1 AND telefone = '5511999992001'`,
      [TENANT_B]
    );

    expect(leadBRows[0].tags || []).not.toContain(REACTIVATION_TAG);

    // Tentativa de usar a cadência do Tenant B para reativar o Tenant A é rejeitada
    await saveReactivationSettings(pool, TENANT_A, {
      reactivation_enabled: true,
      reactivation_stalled_days: 7,
      reactivation_cadence_id: cadenceBId, // Cadência de outro tenant!
      reactivation_cooldown_days: 30,
    });

    const crossResult = await runDueReactivations(pool, {
      clientId: TENANT_A,
      manual: true,
      enrollLeadFn: mockEnrollLead,
    });

    expect(crossResult.success).toBe(false);
    expect(crossResult.reason).toBe("cadence_not_found");
  });

  it("7. Rota HTTP GET /api/leads/reactivation-settings retorna configurações e métricas", async () => {
    // Restaura cadência correta do Tenant A
    await saveReactivationSettings(pool, TENANT_A, {
      reactivation_enabled: true,
      reactivation_stalled_days: 7,
      reactivation_cadence_id: cadenceAId,
      reactivation_cooldown_days: 30,
    });

    const res = await fetch(`${baseUrl}/api/leads/reactivation-settings?clientId=${TENANT_A}`);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.client_id).toBe(TENANT_A);
    expect(body.reactivation_enabled).toBe(true);
    expect(body.reactivation_stalled_days).toBe(7);
    expect(body.reactivation_cadence_id).toBe(cadenceAId);
    expect(body.reactivated_last_30_days).toBeGreaterThanOrEqual(2);
    expect(body.cadences).toHaveLength(1);
    expect(body.cadences[0].name).toBe("Cadência Resgate Alfa 7d");
  });

  it("8. Rota HTTP POST /api/leads/reactivation-settings atualiza opções com persistência", async () => {
    const updatePayload = {
      clientId: TENANT_A,
      reactivation_enabled: false,
      reactivation_stalled_days: 10,
      reactivation_cadence_id: cadenceAId,
      reactivation_cooldown_days: 45,
    };

    const res = await fetch(`${baseUrl}/api/leads/reactivation-settings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updatePayload),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.reactivation_enabled).toBe(false);
    expect(body.reactivation_stalled_days).toBe(10);
    expect(body.reactivation_cooldown_days).toBe(45);

    // Confirma persistência lendo direto do banco
    const saved = await getReactivationSettings(pool, TENANT_A);
    expect(saved.reactivation_enabled).toBe(false);
    expect(saved.reactivation_stalled_days).toBe(10);
    expect(saved.reactivation_cooldown_days).toBe(45);
  });

  it("9. Rota HTTP POST /api/leads/reactivation-run dispara reativação sob demanda", async () => {
    // Insere novo lead parado há 12 dias para testar o endpoint de trigger
    await db.query(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999991099', 'Lead Teste Trigger Manual', 'cold',
              NOW() - INTERVAL '12 days', NOW() - INTERVAL '20 days');
    `);

    // Reativação habilitada com cadência A
    await saveReactivationSettings(pool, TENANT_A, {
      reactivation_enabled: true,
      reactivation_stalled_days: 7,
      reactivation_cadence_id: cadenceAId,
      reactivation_cooldown_days: 30,
    });

    const res = await fetch(`${baseUrl}/api/leads/reactivation-run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: TENANT_A }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.reactivated_count).toBeGreaterThanOrEqual(1);

    // O lead novo foi reativado
    const reactivatedPhones = (body.leads || []).map((l) => l.telefone);
    expect(reactivatedPhones).toContain("5511999991099");
  });
});
