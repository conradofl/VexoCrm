// backend/src/test/stalledLeadsEngine.test.js
// Testes do Pilar 1: Aviso de Lead Parado (Nenhum Lead Esquecido)
// Validação do cálculo de dias de inatividade (days_idle), exclusão de fechados/perdidos,
// isolamento multi-tenant, filtro por minDays customizável e integração da rota HTTP.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { queryStalledLeads, queryBaseFacets, queryLeadsPage, parseLeadListFilters } from "../services/leadListQuery.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const TENANT_A = "tenant-alfa";
const TENANT_B = "tenant-beta";

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE leads_clients (id text PRIMARY KEY, name text);
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
    assigned_to text,
    lead_source text,
    potential_contract_value numeric(14,2),
    raw_chat_summary text,
    UNIQUE (client_id, telefone)
  );
`;

describe("Pilar 1: Engine de Leads Parados (stalledLeadsEngine)", () => {
  let db;
  let pool;
  let server;
  let baseUrl;

  beforeAll(async () => {
    db = await createPgliteDb(SCHEMA);
    pool = {
      query: (sql, params) => db.query(sql, params),
    };

    // Tenants
    await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${TENANT_A}', 'Alfa Corp'), ('${TENANT_B}', 'Beta Corp')`);

    // Semeia leads de teste com diferentes graus de inatividade e estágios
    // 1. Lead Ativo 10 dias parado (Tenant A, stage open_budget) -> Deve ser retornado
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at, dados)
      VALUES ('${TENANT_A}', '5511999990001', 'Lead Proposta Parado', 'open_budget',
              NOW() - INTERVAL '10 days', NOW() - INTERVAL '15 days',
              '{"sdr_rotation_owner": "5511888880001"}'::jsonb);
    `);

    // 2. Lead Ativo 5 dias parado via last_message_at (Tenant A, stage inquiry) -> Deve ser retornado
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, last_message_at, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990002', 'Lead Conversa Parada', 'inquiry',
              NOW() - INTERVAL '5 days', NOW() - INTERVAL '6 days', NOW() - INTERVAL '20 days');
    `);

    // 3. Lead Ativo 4 dias parado via last_interaction_at (Tenant A, stage cold) -> Deve ser retornado
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, last_interaction_at, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990003', 'Lead Frio 4d', 'cold',
              NOW() - INTERVAL '4 days', NOW() - INTERVAL '10 days', NOW() - INTERVAL '30 days');
    `);

    // 4. Lead Recente: apenas 1 dia parado (Tenant A, stage open_budget) -> NÃO deve retornar com minDays >= 3
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990004', 'Lead Recente 1d', 'open_budget',
              NOW() - INTERVAL '1 day', NOW() - INTERVAL '2 days');
    `);

    // 5. Lead FECHADO (buyer) há 20 dias (Tenant A) -> NÃO deve retornar (venda concluída)
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990005', 'Lead Comprador Fechado', 'buyer',
              NOW() - INTERVAL '20 days', NOW() - INTERVAL '40 days');
    `);

    // 6. Lead PERDIDO (lost) há 30 dias (Tenant A) -> NÃO deve retornar (descartado/perdido)
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990006', 'Lead Perdido', 'lost',
              NOW() - INTERVAL '30 days', NOW() - INTERVAL '60 days');
    `);

    // 7. Lead DESCARTADO (stage 'descartado') há 15 dias (Tenant A) -> NÃO deve retornar
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990007', 'Lead Descartado', 'descartado',
              NOW() - INTERVAL '15 days', NOW() - INTERVAL '30 days');
    `);

    // 8. Lead FECHADO (stage 'fechado') há 12 dias (Tenant A) -> NÃO deve retornar
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990008', 'Lead Fechado PT', 'fechado',
              NOW() - INTERVAL '12 days', NOW() - INTERVAL '25 days');
    `);

    // 9. Lead Tenant B (15 dias parado) -> NÃO deve aparecer para o Tenant A (Isolamento Multi-tenant)
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_B}', '5511999999999', 'Lead Outro Tenant B', 'open_budget',
              NOW() - INTERVAL '15 days', NOW() - INTERVAL '20 days');
    `);

    // Configura servidor Express de teste com rotas de leads
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
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("1. Calcula days_idle corretamente e ordena por maior inatividade", async () => {
    const scope = { clientId: TENANT_A };
    const res = await queryStalledLeads(pool, { scope, minDays: 3 });

    expect(res.count).toBe(3); // Leads 1 (10d), 2 (5d), 3 (4d)
    expect(res.leads).toHaveLength(3);

    // O primeiro lead deve ser o mais antigo sem contato (10 dias)
    expect(res.leads[0].nome).toBe("Lead Proposta Parado");
    expect(res.leads[0].days_idle).toBeGreaterThanOrEqual(10);
    expect(res.leads[0].sdr_rotation_owner).toBe("5511888880001");

    // Segundo lead: 5 dias
    expect(res.leads[1].nome).toBe("Lead Conversa Parada");
    expect(res.leads[1].days_idle).toBeGreaterThanOrEqual(5);

    // Terceiro lead: 4 dias
    expect(res.leads[2].nome).toBe("Lead Frio 4d");
    expect(res.leads[2].days_idle).toBeGreaterThanOrEqual(4);
  });

  it("2. Exclui leads encerrados (buyer, fechado, perdido, descartado, lost)", async () => {
    const scope = { clientId: TENANT_A };
    const res = await queryStalledLeads(pool, { scope, minDays: 3 });

    const nomes = res.leads.map((l) => l.nome);
    expect(nomes).not.toContain("Lead Comprador Fechado");
    expect(nomes).not.toContain("Lead Perdido");
    expect(nomes).not.toContain("Lead Descartado");
    expect(nomes).not.toContain("Lead Fechado PT");
    expect(nomes).not.toContain("Lead Recente 1d");
  });

  it("3. Garante isolamento multi-tenant estrito (Tenant A não vê Tenant B)", async () => {
    const scopeA = { clientId: TENANT_A };
    const resA = await queryStalledLeads(pool, { scope: scopeA, minDays: 3 });
    expect(resA.leads.some((l) => l.nome === "Lead Outro Tenant B")).toBe(false);

    const scopeB = { clientId: TENANT_B };
    const resB = await queryStalledLeads(pool, { scope: scopeB, minDays: 3 });
    expect(resB.count).toBe(1);
    expect(resB.leads[0].nome).toBe("Lead Outro Tenant B");
    expect(resB.leads[0].days_idle).toBeGreaterThanOrEqual(15);
  });

  it("4. Suporta filtro por minDays customizável", async () => {
    const scope = { clientId: TENANT_A };

    // minDays = 6: deve trazer apenas o de 10 dias
    const res6 = await queryStalledLeads(pool, { scope, minDays: 6 });
    expect(res6.count).toBe(1);
    expect(res6.leads[0].nome).toBe("Lead Proposta Parado");

    // minDays = 4: deve trazer o de 10d, 5d e 4d
    const res4 = await queryStalledLeads(pool, { scope, minDays: 4 });
    expect(res4.count).toBe(3);

    // minDays = 15: nenhum lead de Tenant A
    const res15 = await queryStalledLeads(pool, { scope, minDays: 15 });
    expect(res15.count).toBe(0);
    expect(res15.leads).toHaveLength(0);
  });

  it("5. Suporta filtro opcional por stage", async () => {
    const scope = { clientId: TENANT_A };
    const res = await queryStalledLeads(pool, { scope, minDays: 3, stage: "open_budget" });
    expect(res.count).toBe(1);
    expect(res.leads[0].nome).toBe("Lead Proposta Parado");
    expect(res.leads[0].stage).toBe("open_budget");
  });

  it("6. Retorna stalledCount correto em queryBaseFacets", async () => {
    const scope = { clientId: TENANT_A };
    const facets = await queryBaseFacets(pool, scope);
    expect(facets.summary).toBeDefined();
    expect(facets.summary.stalledCount).toBe(3);
    expect(facets.stalledCount).toBe(3);
  });

  it("7. Filtro stalledDays no queryLeadsPage e parseLeadListFilters", async () => {
    const parsed = parseLeadListFilters({ stalledDays: "3" });
    expect(parsed.filters.stalledDays).toBe(3);

    const scope = { clientId: TENANT_A };
    const paged = await queryLeadsPage(pool, {
      scope,
      filters: { stalledDays: 3 },
      limit: 10,
    });

    expect(paged.total).toBe(3);
    expect(paged.items).toHaveLength(3);
    // Cada item possui days_idle computado
    expect(paged.items[0].days_idle).toBeGreaterThanOrEqual(10);
    expect(paged.items[1].days_idle).toBeGreaterThanOrEqual(5);
    expect(paged.items[2].days_idle).toBeGreaterThanOrEqual(4);
  });

  it("8. Rota HTTP GET /api/leads/stalled responde conforme a especificação", async () => {
    const response = await fetch(`${baseUrl}/api/leads/stalled?clientId=${TENANT_A}&minDays=3&limit=10`);
    expect(response.status).toBe(200);

    const data = await response.json();
    expect(data.count).toBe(3);
    expect(data.minDays).toBe(3);
    expect(Array.isArray(data.leads)).toBe(true);
    expect(data.leads).toHaveLength(3);

    const first = data.leads[0];
    expect(first.nome).toBe("Lead Proposta Parado");
    expect(first.telefone).toBe("5511999990001");
    expect(first.stage).toBe("open_budget");
    expect(first.days_idle).toBeGreaterThanOrEqual(10);
    expect(first.sdr_rotation_owner).toBe("5511888880001");
  });
});
