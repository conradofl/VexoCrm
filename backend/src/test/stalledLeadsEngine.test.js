// backend/src/test/stalledLeadsEngine.test.js
// Testes do Pilar 1: Aviso de Lead Parado (Nenhum Lead Esquecido)
// Validação da definição canônica de lead parado compartilhada com leadReactivationEngine.js:
// 1. days_idle estritamente via COALESCE(last_message_at, last_interaction_at)
// 2. Separação canônica: "Parados" (em conversa) vs "Nunca Abordados" (base fria sem mensagem)
// 3. Exclusão estrita de estágios fechados/perdidos (fechado, buyer, perdido, descartado, lost)
// 4. Respeito ao limiar do tenant (reactivation_stalled_days em lead_client_n8n_settings)
// 5. Invariante "Ver não é agir" (reactivation_enabled = false, zero mutações)
// 6. Paridade 100% com motor de reativação (runDueReactivations)
// 7. Canal B de Alertas: Notificações em public.notifications idempotentes com link direto para WhatsApp
// 8. PROVAS POR MUTAÇÃO OBRIGATÓRIAS:
//    - Omissão dos parênteses no grupo OR de sqlIsStalled falha o teste.
//    - Reinserção de created_at ou updated_at no cálculo de lead parado falha o teste.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { registerNotificationsRoutes } from "../domains/notifications/routes.js";
import {
  queryStalledLeads,
  queryBaseFacets,
  queryLeadsPage,
  parseLeadListFilters,
} from "../services/leadListQuery.js";
import {
  queryStalledLeadsList,
  syncStalledLeadsNotifications,
  syncDailyStalledNotificationsForAllTenants,
  runDueReactivations,
  saveReactivationSettings,
  STALLED_EXCLUDED_STAGES,
  sqlStalledStageCondition,
  sqlIdleTimestamp,
  sqlDaysIdle,
  sqlIsStalled,
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
    stalled_notifications_synced_at timestamptz,
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

  CREATE TABLE notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL,
    user_id text,
    type text NOT NULL,
    title text NOT NULL,
    description text,
    link text,
    read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
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
  let cadenceAId;
  let cadenceBId;

  beforeAll(async () => {
    db = await createPgliteDb(SCHEMA);
    pool = {
      query: (sql, params) => db.query(sql, params),
    };

    // 1. Tenants
    await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${TENANT_A}', 'Alfa Corp'), ('${TENANT_B}', 'Beta Corp')`);

    // 2. Cadência e configurações de reativação para o Tenant A (limiar: 5 dias, desativado)
    const companyResA = await db.query(
      `INSERT INTO followup_companies (tenant_id, name) VALUES ($1, 'Alfa Atendimento') RETURNING id`,
      [TENANT_A]
    );
    const companyAId = companyResA.rows[0].id;

    const campaignResA = await db.query(
      `INSERT INTO followup_campaigns (company_id, name, status) VALUES ($1, 'Cadência Resgate Alfa', 'active') RETURNING id`,
      [companyAId]
    );
    cadenceAId = campaignResA.rows[0].id;

    await saveReactivationSettings(pool, TENANT_A, {
      reactivation_enabled: false,
      reactivation_stalled_days: 5, // Limiar customizado do tenant: 5 dias
      reactivation_cadence_id: cadenceAId,
      reactivation_cooldown_days: 30,
    });

    // Cadência para Tenant B
    const companyResB = await db.query(
      `INSERT INTO followup_companies (tenant_id, name) VALUES ($1, 'Beta Atendimento') RETURNING id`,
      [TENANT_B]
    );
    const companyBId = companyResB.rows[0].id;
    const campaignResB = await db.query(
      `INSERT INTO followup_campaigns (company_id, name, status) VALUES ($1, 'Cadência Resgate Beta', 'active') RETURNING id`,
      [companyBId]
    );
    cadenceBId = campaignResB.rows[0].id;

    await saveReactivationSettings(pool, TENANT_B, {
      reactivation_enabled: false,
      reactivation_stalled_days: 7,
      reactivation_cadence_id: cadenceBId,
      reactivation_cooldown_days: 30,
    });

    // 3. Semeia leads de teste com cenários canônicos rigorosos
    // Lead 1: 10 dias parado com conversa real (Tenant A, stage open_budget)
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, last_message_at, updated_at, created_at, dados)
      VALUES ('${TENANT_A}', '5511999990001', 'Lead Proposta Parado', 'open_budget',
              NOW() - INTERVAL '10 days', NOW() - INTERVAL '10 days', NOW() - INTERVAL '15 days',
              '{"sdr_rotation_owner": "5511888880001"}'::jsonb);
    `);

    // Lead 2: 5 dias parado via last_message_at (Tenant A, stage inquiry)
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, last_message_at, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990002', 'Lead Conversa Parada', 'inquiry',
              NOW() - INTERVAL '5 days', NOW() - INTERVAL '6 days', NOW() - INTERVAL '20 days');
    `);

    // Lead 3: 4 dias parado via last_interaction_at (Tenant A, stage cold)
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, last_interaction_at, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990003', 'Lead Frio 4d', 'cold',
              NOW() - INTERVAL '4 days', NOW() - INTERVAL '10 days', NOW() - INTERVAL '30 days');
    `);

    // Lead 4: Conversa recente de ONTEM (1 dia atrás) (Tenant A, stage open_budget)
    // CRÍTICO para prova de parênteses: last_message_at IS NOT NULL, mas inativo há apenas 1 dia!
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, last_message_at, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990004', 'Lead Recente Ontem', 'open_budget',
              NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day', NOW() - INTERVAL '5 days');
    `);

    // Lead 5: Importado de planilha há 30 dias SEM last_message_at e SEM last_interaction_at
    // CRÍTICO para separação canônica: NUNCA ABORDADO (base fria), NÃO parado!
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, created_at, updated_at)
      VALUES ('${TENANT_A}', '5511999990005', 'Lead Planilha Nunca Abordado', 'open_budget',
              NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days');
    `);

    // Lead 6: FECHADO (buyer) há 20 dias (Tenant A) -> Excluído por estágio
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, last_message_at, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990006', 'Lead Comprador Fechado', 'buyer',
              NOW() - INTERVAL '20 days', NOW() - INTERVAL '20 days', NOW() - INTERVAL '40 days');
    `);

    // Lead 7: PERDIDO (lost) há 30 dias (Tenant A) -> Excluído por estágio
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, last_message_at, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990007', 'Lead Perdido', 'lost',
              NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days', NOW() - INTERVAL '60 days');
    `);

    // Lead 8: DESCARTADO (stage 'descartado') há 15 dias (Tenant A) -> Excluído por estágio
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, last_message_at, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990008', 'Lead Descartado', 'descartado',
              NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days', NOW() - INTERVAL '30 days');
    `);

    // Lead 9: FECHADO (stage 'fechado') há 12 dias (Tenant A) -> Excluído por estágio
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, last_message_at, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990009', 'Lead Fechado PT', 'fechado',
              NOW() - INTERVAL '12 days', NOW() - INTERVAL '12 days', NOW() - INTERVAL '25 days');
    `);

    // Lead 10: Tenant B (15 dias parado com conversa real) -> Isolado
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, last_message_at, updated_at, created_at)
      VALUES ('${TENANT_B}', '5511999999999', 'Lead Outro Tenant B', 'open_budget',
              NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days', NOW() - INTERVAL '20 days');
    `);

    // 4. Servidor Express de teste
    const app = express();
    app.use(express.json());

    const sendError = (res, status, code, message, details) =>
      res.status(status).json({ error: { code, message, details } });

    const sharedDeps = {
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
    };

    registerLeadsRoutes(app, sharedDeps);
    registerNotificationsRoutes(app, sharedDeps);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("1. Calcula days_idle corretamente e ordena por maior inatividade (apenas quem tem conversa)", async () => {
    const scope = { clientId: TENANT_A };
    const res = await queryStalledLeads(pool, { scope, minDays: 3 });

    // Leads 1 (10d), 2 (5d), 3 (4d). Lead 4 (1d) e Lead 5 (sem conversa) ficam de fora!
    expect(res.count).toBe(3);
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

  it("2. Exclui leads encerrados (buyer, fechado, perdido, descartado, lost) e recentes", async () => {
    const scope = { clientId: TENANT_A };
    const res = await queryStalledLeads(pool, { scope, minDays: 3 });

    const nomes = res.leads.map((l) => l.nome);
    expect(nomes).not.toContain("Lead Comprador Fechado");
    expect(nomes).not.toContain("Lead Perdido");
    expect(nomes).not.toContain("Lead Descartado");
    expect(nomes).not.toContain("Lead Fechado PT");
    expect(nomes).not.toContain("Lead Recente Ontem");
    expect(nomes).not.toContain("Lead Planilha Nunca Abordado");
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

  it("4. Respeita threshold configurado no tenant (reactivation_stalled_days = 5) quando minDays é omitido", async () => {
    const scope = { clientId: TENANT_A };

    // Sem passar minDays: deve adotar os 5 dias configurados no lead_client_n8n_settings do Tenant A
    const resDefault = await queryStalledLeads(pool, { scope });
    expect(resDefault.minDays).toBe(5);
    expect(resDefault.count).toBe(2); // Lead 1 (10d) e Lead 2 (5d). Lead 3 (4d) fica de fora!
    expect(resDefault.leads.map((l) => l.nome)).toEqual([
      "Lead Proposta Parado",
      "Lead Conversa Parada",
    ]);

    // Com minDays explícito = 4: inclui também o Lead 3 (4d)
    const resExplicit = await queryStalledLeads(pool, { scope, minDays: 4 });
    expect(resExplicit.minDays).toBe(4);
    expect(resExplicit.count).toBe(3);
  });

  it("5. Teste 1 (Regra Canônica): Lead importado de planilha há 30 dias SEM last_message_at e SEM last_interaction_at NÃO aparece como parado e é contabilizado em never_approached_count", async () => {
    const res = await queryStalledLeadsList(pool, { clientId: TENANT_A, stalledDays: 5 });

    // Lead 5 NÃO pode estar em leads parados
    const nomesParados = res.leads.map((l) => l.nome);
    expect(nomesParados).not.toContain("Lead Planilha Nunca Abordado");

    // Deve estar registrado em never_approached_count
    expect(res.never_approached_count).toBe(1);
    expect(res.stalled_count).toBe(2); // Lead 1 (10d) e Lead 2 (5d)
    expect(res.count).toBe(2);
  });

  it("6. Teste 2 (Regra Canônica): Lead com last_message_at há 10 dias aparece como parado", async () => {
    const res = await queryStalledLeadsList(pool, { clientId: TENANT_A, stalledDays: 7 });

    expect(res.count).toBe(1);
    expect(res.leads[0].nome).toBe("Lead Proposta Parado");
    expect(res.leads[0].days_idle).toBeGreaterThanOrEqual(10);
  });

  it("7. Teste 3 (Regra Canônica): A soma de stalled_count + never_approached_count bate com a base ativa aberta", async () => {
    // No Tenant A, estágios abertos ativos (não fechados/perdidos) são:
    // Lead 1 (10d), Lead 2 (5d), Lead 3 (4d), Lead 4 (1d) e Lead 5 (sem mensagem). Total = 5 leads abertos.
    const { rows: openBaseRows } = await pool.query(`
      SELECT count(*)::int AS count
      FROM leads l
      WHERE l.client_id = $1
        AND ${sqlStalledStageCondition("l")}
    `, [TENANT_A]);
    const totalOpenBase = openBaseRows[0].count;
    expect(totalOpenBase).toBe(5);

    // Quando minDays = 0 (ou seja, qualquer lead com mensagem >= 0 dias é considerado parado):
    const resAllInteracted = await queryStalledLeadsList(pool, { clientId: TENANT_A, stalledDays: 0 });
    expect(resAllInteracted.stalled_count).toBe(4); // Leads 1, 2, 3 e 4
    expect(resAllInteracted.never_approached_count).toBe(1); // Lead 5

    // Invariante canônica: stalled_count + never_approached_count == totalOpenBase
    expect(resAllInteracted.stalled_count + resAllInteracted.never_approached_count).toBe(totalOpenBase);
  });

  it("8. Teste de Precedência SQL (Parênteses no OR): Lead com last_message_at de ONTEM não pode aparecer como parado com limiar de 5 dias", async () => {
    const res = await queryStalledLeadsList(pool, { clientId: TENANT_A, stalledDays: 5 });

    // Lead 4 tem last_message_at de ontem (1 dia)
    const nomes = res.leads.map((l) => l.nome);
    expect(nomes).not.toContain("Lead Recente Ontem");
  });

  it("9. PROVA POR MUTAÇÃO 1 (Omissão dos Parênteses no Grupo OR): Tirar os parênteses derruba o teste incluindo lead recente", async () => {
    // Consulta canônica com parênteses estritos
    const canonical = await queryStalledLeadsList(pool, { clientId: TENANT_A, stalledDays: 5 });
    const canonicalNomes = canonical.leads.map((l) => l.nome);

    // MUTANTE SEM PARÊNTESES:
    // l.last_message_at IS NOT NULL OR l.last_interaction_at IS NOT NULL AND (NOW() - ...) >= ...
    // Pela precedência de operadores SQL (AND > OR), a condição se torna:
    // (l.last_message_at IS NOT NULL) OR (l.last_interaction_at IS NOT NULL AND ...)
    // Logo, QUALQUER lead com last_message_at vira parado, ignorando o limiar de dias!
    const mutantWithoutParensSql = `
      SELECT l.nome
      FROM leads l
      WHERE l.client_id = $1
        AND ${sqlStalledStageCondition("l")}
        AND l.last_message_at IS NOT NULL OR l.last_interaction_at IS NOT NULL AND (NOW() - COALESCE(l.last_message_at, l.last_interaction_at)) >= '5 days'::interval
      ORDER BY l.id DESC
    `;
    const { rows: mutantRows } = await pool.query(mutantWithoutParensSql, [TENANT_A]);
    const mutantNomes = mutantRows.map((r) => r.nome);

    // O mutante inclui indevidamente o 'Lead Recente Ontem' (1d de inatividade)
    expect(mutantNomes).toContain("Lead Recente Ontem");
    expect(canonicalNomes).not.toContain("Lead Recente Ontem");
    expect(mutantNomes.length).toBeGreaterThan(canonicalNomes.length);
  });

  it("10. PROVA POR MUTAÇÃO 2 (Fallback para created_at ou updated_at): Reinserir created_at/updated_at derruba o teste incluindo lead nunca abordado", async () => {
    // Consulta canônica
    const canonical = await queryStalledLeadsList(pool, { clientId: TENANT_A, stalledDays: 5 });
    const canonicalNomes = canonical.leads.map((l) => l.nome);

    // MUTANTE COM FALLBACK (A regra antiga que gerou o bug dos 77k leads):
    // COALESCE(l.last_message_at, l.last_interaction_at, l.updated_at, l.created_at)
    const mutantWithFallbackSql = `
      SELECT l.nome
      FROM leads l
      WHERE l.client_id = $1
        AND ${sqlStalledStageCondition("l")}
        AND (NOW() - COALESCE(l.last_message_at, l.last_interaction_at, l.updated_at, l.created_at)) >= '5 days'::interval
      ORDER BY l.id DESC
    `;
    const { rows: mutantRows } = await pool.query(mutantWithFallbackSql, [TENANT_A]);
    const mutantNomes = mutantRows.map((r) => r.nome);

    // O mutante inclui indevidamente o 'Lead Planilha Nunca Abordado' (criado há 30 dias sem mensagem)
    expect(mutantNomes).toContain("Lead Planilha Nunca Abordado");
    expect(canonicalNomes).not.toContain("Lead Planilha Nunca Abordado");
    expect(mutantNomes.length).toBeGreaterThan(canonicalNomes.length);
  });

  it("11. PROVA POR MUTAÇÃO 3: Omissão de 'buyer' dos estágios excluídos inclui lead fechado", async () => {
    const canonical = await queryStalledLeadsList(pool, { clientId: TENANT_A, stalledDays: 5 });

    const mutantBuyerSql = `
      SELECT l.nome
      FROM leads l
      WHERE l.client_id = $1
        AND (l.stage IS NULL OR lower(l.stage) NOT IN ('fechado', 'perdido', 'descartado', 'lost')) -- Falta 'buyer'!
        AND ${sqlIsStalled("l", "'5'")}
    `;
    const { rows: mutantRows } = await pool.query(mutantBuyerSql, [TENANT_A]);
    const mutantNomes = mutantRows.map((r) => r.nome);

    expect(mutantNomes).toContain("Lead Comprador Fechado");
    expect(canonical.leads.map((l) => l.nome)).not.toContain("Lead Comprador Fechado");
  });

  it("12. Garante PARIDADE 100% com o motor de reativação canônico (runDueReactivations em dryRun)", async () => {
    // Consulta da tela de leads parados usando o limiar do tenant (5 dias)
    const stalledList = await queryStalledLeadsList(pool, { clientId: TENANT_A });

    // Consulta de candidatos do motor de reativação
    const reactivationDryRun = await runDueReactivations(pool, {
      clientId: TENANT_A,
      manual: true,
      dryRun: true,
    });

    expect(stalledList.count).toBe(reactivationDryRun.eligible_count);
    expect(stalledList.leads.length).toBe(reactivationDryRun.leads.length);

    // Ambas as consultas devem retornar EXATAMENTE os mesmos IDs na mesma ordem
    const listIds = stalledList.leads.map((l) => l.id);
    const candidateIds = reactivationDryRun.leads.map((l) => l.id);
    expect(listIds).toEqual(candidateIds);
  });

  it("13. Garante invariante: Ver não é agir (reactivation_enabled = false, zero mutações ou disparos)", async () => {
    const { rows: beforeSchedules } = await pool.query(
      `SELECT count(*)::int AS count FROM followup_schedules WHERE company_id IN (SELECT id FROM followup_companies WHERE tenant_id = $1)`,
      [TENANT_A]
    );
    expect(beforeSchedules[0].count).toBe(0);

    const res = await queryStalledLeadsList(pool, { clientId: TENANT_A });
    expect(res.reactivation_enabled).toBe(false);
    expect(res.leads.length).toBeGreaterThan(0);

    const { rows: afterSchedules } = await pool.query(
      `SELECT count(*)::int AS count FROM followup_schedules WHERE company_id IN (SELECT id FROM followup_companies WHERE tenant_id = $1)`,
      [TENANT_A]
    );
    expect(afterSchedules[0].count).toBe(0);

    const { rows: taggedLeads } = await pool.query(
      `SELECT count(*)::int AS count FROM leads WHERE client_id = $1 AND tags @> ARRAY['#Reativacao-Automatica']::text[]`,
      [TENANT_A]
    );
    expect(taggedLeads[0].count).toBe(0);
  });

  it("14. Canal B (Notificações): syncStalledLeadsNotifications insere alertas idempotentes com link direto", async () => {
    // 1. Primeira sincronização: insere notificações para os 2 leads elegíveis (10d e 5d)
    const syncRes1 = await syncStalledLeadsNotifications(pool, { clientId: TENANT_A });
    expect(syncRes1.inserted).toBe(2);

    const { rows: notifs } = await pool.query(
      `SELECT title, description, link, read FROM public.notifications WHERE client_id = $1 ORDER BY created_at ASC`,
      [TENANT_A]
    );
    expect(notifs).toHaveLength(2);
    expect(notifs[0].title).toContain("Lead Proposta Parado");
    expect(notifs[0].link).toBe("/crm/whatsapp?phone=5511999990001");
    expect(notifs[0].read).toBe(false);

    // 2. Segunda sincronização imediata: IDEMPOTENTE (não duplica alertas não lidos)
    const syncRes2 = await syncStalledLeadsNotifications(pool, { clientId: TENANT_A });
    expect(syncRes2.inserted).toBe(0);

    // 3. Rota de notificações lista os itens com unreadCount
    const getRes = await fetch(`${baseUrl}/api/notifications?clientId=${TENANT_A}`);
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.unreadCount).toBe(2);
    expect(getData.items).toHaveLength(2);
  });

  it("15. Rota HTTP GET /api/leads/stalled e POST /api/leads/stalled/notify", async () => {
    // GET sem minDays: utiliza o padrão do tenant (5 dias) e retorna stalled_count e never_approached_count
    const getResponse = await fetch(`${baseUrl}/api/leads/stalled?clientId=${TENANT_A}`);
    expect(getResponse.status).toBe(200);
    const getData = await getResponse.json();
    expect(getData.count).toBe(2);
    expect(getData.stalled_count).toBe(2);
    expect(getData.never_approached_count).toBe(1);
    expect(getData.minDays).toBe(5);
    expect(getData.leads[0].nome).toBe("Lead Proposta Parado");

    // POST /api/leads/stalled/notify: sincronização via endpoint
    const postResponse = await fetch(`${baseUrl}/api/leads/stalled/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: TENANT_A }),
    });
    expect(postResponse.status).toBe(200);
    const postData = await postResponse.json();
    expect(postData.success).toBe(true);
    expect(postData.inserted).toBe(0); // Já foram inseridos no teste anterior
  });

  it("16. Disparo automático em background (syncDailyStalledNotificationsForAllTenants): roda 1x por dia por empresa, sem duplicatas e com reactivation_enabled = false", async () => {
    // Reseta timestamps de sincronização para simular novo ciclo de início de dia
    await pool.query(`UPDATE lead_client_n8n_settings SET stalled_notifications_synced_at = NULL`);

    // Limpa notificações para teste isolado da varredura global
    await pool.query(`DELETE FROM notifications`);

    // 1. Primeiro disparo automático (simula o tick que encontra empresas pendentes):
    const run1 = await syncDailyStalledNotificationsForAllTenants(pool);
    expect(run1.checkedTenants).toBeGreaterThanOrEqual(1);
    expect(run1.totalInserted).toBeGreaterThanOrEqual(1);

    // Confirma que gravou stalled_notifications_synced_at para o Tenant A
    const { rows: settingsRows } = await pool.query(
      `SELECT stalled_notifications_synced_at FROM lead_client_n8n_settings WHERE client_id = $1`,
      [TENANT_A]
    );
    expect(settingsRows[0]?.stalled_notifications_synced_at).toBeTruthy();

    // 2. Segundo disparo automático IMEDIATO (simula o próximo tick de 30s do setInterval):
    // Como os tenants já foram sincronizados nas últimas 24h, NÃO deve reprocessar nenhum tenant
    const run2 = await syncDailyStalledNotificationsForAllTenants(pool);
    expect(run2.checkedTenants).toBe(0);
    expect(run2.totalInserted).toBe(0);

    // 3. Simula que passaram mais de 24 horas para o Tenant A
    await pool.query(
      `UPDATE lead_client_n8n_settings SET stalled_notifications_synced_at = NOW() - INTERVAL '25 hours' WHERE client_id = $1`,
      [TENANT_A]
    );

    // 4. Terceiro disparo (novo dia para Tenant A):
    // Processa o Tenant A, mas graças à idempotência, não insere notificações duplicadas não lidas
    const run3 = await syncDailyStalledNotificationsForAllTenants(pool);
    expect(run3.checkedTenants).toBe(1);
    expect(run3.totalInserted).toBe(0); // Idempotência: alertas não lidos já existem
  });

  it("17. Tolerância a schema pré-migration (DIRETRIZES-IA.md, seção 12): funciona mesmo se stalled_notifications_synced_at não existir", async () => {
    // Dropa a coluna temporariamente no banco de teste para simular o schema pré-migration
    await pool.query(`ALTER TABLE lead_client_n8n_settings DROP COLUMN IF EXISTS stalled_notifications_synced_at`);

    // Limpa notificações para testar o fallback
    await pool.query(`DELETE FROM notifications`);

    // O disparo deve funcionar com sucesso usando o fallback via public.notifications sem lançar erro
    const fallbackRun1 = await syncDailyStalledNotificationsForAllTenants(pool);
    expect(fallbackRun1.error).toBeUndefined();
    expect(fallbackRun1.checkedTenants).toBeGreaterThanOrEqual(1);
    expect(fallbackRun1.totalInserted).toBeGreaterThanOrEqual(1);

    // Segundo disparo imediato: como ambos os tenants geraram notificações recentes (< 24h), o fallback identifica que nenhum tenant está pendente
    const fallbackRun2 = await syncDailyStalledNotificationsForAllTenants(pool);
    expect(fallbackRun2.checkedTenants).toBe(0);
    expect(fallbackRun2.totalInserted).toBe(0);

    // Restaura a coluna para não afetar eventuais testes futuros
    await pool.query(`ALTER TABLE lead_client_n8n_settings ADD COLUMN IF NOT EXISTS stalled_notifications_synced_at timestamptz`);
  });
});
