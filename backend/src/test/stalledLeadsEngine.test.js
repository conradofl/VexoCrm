// backend/src/test/stalledLeadsEngine.test.js
// Testes do Pilar 1: Aviso de Lead Parado (Nenhum Lead Esquecido)
// Validação da definição canônica de lead parado compartilhada com leadReactivationEngine.js:
// 1. days_idle via COALESCE(last_message_at, last_interaction_at, updated_at, created_at)
// 2. Exclusão estrita de estágios fechados/perdidos (fechado, buyer, perdido, descartado, lost)
// 3. Respeito ao limiar do tenant (reactivation_stalled_days em lead_client_n8n_settings)
// 4. Invariante "Ver não é agir" (reactivation_enabled = false, zero mutações)
// 5. Paridade 100% com motor de reativação (runDueReactivations)
// 6. Canal B de Alertas: Notificações em public.notifications idempotentes com link direto para WhatsApp
// 7. PROVA POR MUTAÇÃO: Definições divergentes de lead parado falham o teste.

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

  beforeAll(async () => {
    db = await createPgliteDb(SCHEMA);
    pool = {
      query: (sql, params) => db.query(sql, params),
    };

    // 1. Tenants
    await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${TENANT_A}', 'Alfa Corp'), ('${TENANT_B}', 'Beta Corp')`);

    // 2. Cadência e configurações de reativação para o Tenant A (limiar: 5 dias, desativado)
    const companyRes = await db.query(
      `INSERT INTO followup_companies (tenant_id, name) VALUES ($1, 'Alfa Atendimento') RETURNING id`,
      [TENANT_A]
    );
    const companyAId = companyRes.rows[0].id;

    const campaignRes = await db.query(
      `INSERT INTO followup_campaigns (company_id, name, status) VALUES ($1, 'Cadência Resgate', 'active') RETURNING id`,
      [companyAId]
    );
    cadenceAId = campaignRes.rows[0].id;

    await saveReactivationSettings(pool, TENANT_A, {
      reactivation_enabled: false,
      reactivation_stalled_days: 5, // Limiar customizado do tenant: 5 dias
      reactivation_cadence_id: cadenceAId,
      reactivation_cooldown_days: 30,
    });

    // 3. Semeia leads de teste com diferentes graus de inatividade e estágios
    // Lead 1: 10 dias parado (Tenant A, stage open_budget)
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at, dados)
      VALUES ('${TENANT_A}', '5511999990001', 'Lead Proposta Parado', 'open_budget',
              NOW() - INTERVAL '10 days', NOW() - INTERVAL '15 days',
              '{"sdr_rotation_owner": "5511888880001"}'::jsonb);
    `);

    // Lead 2: 5 dias parado via last_message_at (Tenant A, stage inquiry)
    // updated_at é mais recente (6d), mas last_message_at é 5d (COALESCE escolhe last_message_at)
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

    // Lead 4: Recente - 1 dia parado (Tenant A, stage open_budget)
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990004', 'Lead Recente 1d', 'open_budget',
              NOW() - INTERVAL '1 day', NOW() - INTERVAL '2 days');
    `);

    // Lead 5: FECHADO (buyer) há 20 dias (Tenant A) -> Excluído
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990005', 'Lead Comprador Fechado', 'buyer',
              NOW() - INTERVAL '20 days', NOW() - INTERVAL '40 days');
    `);

    // Lead 6: PERDIDO (lost) há 30 dias (Tenant A) -> Excluído
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990006', 'Lead Perdido', 'lost',
              NOW() - INTERVAL '30 days', NOW() - INTERVAL '60 days');
    `);

    // Lead 7: DESCARTADO (stage 'descartado') há 15 dias (Tenant A) -> Excluído
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990007', 'Lead Descartado', 'descartado',
              NOW() - INTERVAL '15 days', NOW() - INTERVAL '30 days');
    `);

    // Lead 8: FECHADO (stage 'fechado') há 12 dias (Tenant A) -> Excluído
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_A}', '5511999990008', 'Lead Fechado PT', 'fechado',
              NOW() - INTERVAL '12 days', NOW() - INTERVAL '25 days');
    `);

    // Lead 9: Tenant B (15 dias parado) -> Isolado
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, updated_at, created_at)
      VALUES ('${TENANT_B}', '5511999999999', 'Lead Outro Tenant B', 'open_budget',
              NOW() - INTERVAL '15 days', NOW() - INTERVAL '20 days');
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

  it("5. Garante PARIDADE 100% com o motor de reativação canônico (runDueReactivations em dryRun)", async () => {
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

  it("6. Garante invariante: Ver não é agir (reactivation_enabled = false, zero mutações ou disparos)", async () => {
    // Verifica estado antes
    const { rows: beforeSchedules } = await pool.query(
      `SELECT count(*)::int AS count FROM followup_schedules WHERE company_id IN (SELECT id FROM followup_companies WHERE tenant_id = $1)`,
      [TENANT_A]
    );
    expect(beforeSchedules[0].count).toBe(0);

    // Consulta a lista de leads parados
    const res = await queryStalledLeadsList(pool, { clientId: TENANT_A });
    expect(res.reactivation_enabled).toBe(false);
    expect(res.leads.length).toBeGreaterThan(0);

    // Verifica que nada foi gravado ou alterado
    const { rows: afterSchedules } = await pool.query(
      `SELECT count(*)::int AS count FROM followup_schedules WHERE company_id IN (SELECT id FROM followup_companies WHERE tenant_id = $1)`,
      [TENANT_A]
    );
    expect(afterSchedules[0].count).toBe(0);

    // Nenhum lead recebeu tag de reativação automática
    const { rows: taggedLeads } = await pool.query(
      `SELECT count(*)::int AS count FROM leads WHERE client_id = $1 AND tags @> ARRAY['#Reativacao-Automatica']::text[]`,
      [TENANT_A]
    );
    expect(taggedLeads[0].count).toBe(0);
  });

  it("7. Canal B (Notificações): syncStalledLeadsNotifications insere alertas idempotentes com link direto", async () => {
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

  it("8. Rota HTTP GET /api/leads/stalled e POST /api/leads/stalled/notify", async () => {
    // GET sem minDays: utiliza o padrão do tenant (5 dias)
    const getResponse = await fetch(`${baseUrl}/api/leads/stalled?clientId=${TENANT_A}`);
    expect(getResponse.status).toBe(200);
    const getData = await getResponse.json();
    expect(getData.count).toBe(2);
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
    expect(postData.inserted).toBe(0); // Já foram inseridos no teste 7
  });

  it("9. PROVA POR MUTAÇÃO (Mutation Test): Definições divergentes de 'lead parado' quebram a paridade", async () => {
    // Consulta canônica de referência
    const canonical = await queryStalledLeadsList(pool, { clientId: TENANT_A, stalledDays: 5 });
    const canonicalIds = canonical.leads.map((l) => l.id);

    // --- Mutante 1: Omissão do estágio 'buyer' dos estágios excluídos ---
    // Simula um programador usando uma lista incompleta de exclusão que esquece 'buyer'
    const mutant1Sql = `
      SELECT l.id
      FROM leads l
      WHERE l.client_id = $1
        AND (l.stage IS NULL OR lower(l.stage) NOT IN ('fechado', 'perdido', 'descartado', 'lost')) -- Falta 'buyer'!
        AND (NOW() - COALESCE(l.last_message_at, l.last_interaction_at, l.updated_at, l.created_at)) >= '5 days'::interval
      ORDER BY l.id DESC
    `;
    const { rows: mutant1Rows } = await pool.query(mutant1Sql, [TENANT_A]);
    const mutant1Ids = mutant1Rows.map((r) => r.id);

    // O mutante 1 inclui indevidamente o Lead 5 ('buyer'), que a definição canônica proíbe
    expect(mutant1Ids).not.toEqual(canonicalIds);
    expect(mutant1Rows.length).toBeGreaterThan(canonical.leads.length);

    // --- Mutante 2: Verificação baseada apenas em updated_at (ignorando last_message_at) ---
    // Simula um código que ignora a última mensagem de WhatsApp e usa apenas updated_at
    const mutant2Sql = `
      SELECT l.id
      FROM leads l
      WHERE l.client_id = $1
        AND ${sqlStalledStageCondition("l")}
        AND (NOW() - l.updated_at) >= '5 days'::interval -- Ignorou last_message_at e last_interaction_at!
      ORDER BY l.id DESC
    `;
    const { rows: mutant2Rows } = await pool.query(mutant2Sql, [TENANT_A]);
    const mutant2Ids = mutant2Rows.map((r) => r.id);

    // Para o Lead 2, updated_at é de 6 dias atrás enquanto last_message_at é de 5 dias atrás.
    // Em outros cenários onde o lead recebeu mensagem recente mas updated_at está desatualizado,
    // o mutante geraria falso-positivo. Aqui demonstramos a divergência de ordenação/cálculo:
    const mutant2IdleQuery = await pool.query(
      `SELECT EXTRACT(DAY FROM (NOW() - l.updated_at))::int AS mutant_idle,
              ${sqlDaysIdle("l")} AS canonical_idle
       FROM leads l WHERE l.nome = 'Lead Conversa Parada'`
    );
    expect(mutant2IdleQuery.rows[0].mutant_idle).not.toBe(mutant2IdleQuery.rows[0].canonical_idle);

    // --- Mutante 3: Hardcoding de 3 dias ignorando o limiar configurado pelo tenant (5 dias) ---
    // Simula um código que usa valor fixo de 3 dias em vez da configuração do tenant
    const mutant3List = await queryStalledLeadsList(pool, { clientId: TENANT_A, stalledDays: 3 });
    const mutant3Ids = mutant3List.leads.map((l) => l.id);

    // O mutante 3 traria o Lead 3 (4 dias), violando o limiar do tenant
    expect(mutant3Ids).not.toEqual(canonicalIds);
    expect(mutant3List.count).toBe(3);
    expect(canonical.count).toBe(2);
  });

  it("10. Disparo automático em background (syncDailyStalledNotificationsForAllTenants): roda 1x por dia por empresa, sem duplicatas e com reactivation_enabled = false", async () => {
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

  it("11. Tolerância a schema pré-migration (DIRETRIZES-IA.md, seção 12): funciona mesmo se stalled_notifications_synced_at não existir", async () => {
    // Dropa a coluna temporariamente no banco de teste para simular o schema pré-migration
    await pool.query(`ALTER TABLE lead_client_n8n_settings DROP COLUMN IF EXISTS stalled_notifications_synced_at`);

    // Limpa notificações para testar o fallback
    await pool.query(`DELETE FROM notifications`);

    // O disparo deve funcionar com sucesso usando o fallback via public.notifications sem lançar erro
    const fallbackRun1 = await syncDailyStalledNotificationsForAllTenants(pool);
    expect(fallbackRun1.error).toBeUndefined();
    expect(fallbackRun1.checkedTenants).toBeGreaterThanOrEqual(1);
    expect(fallbackRun1.totalInserted).toBeGreaterThanOrEqual(1);

    // Segundo disparo imediato: como foram geradas notificações recentes (< 24h), o fallback identifica que o tenant não está pendente
    const fallbackRun2 = await syncDailyStalledNotificationsForAllTenants(pool);
    expect(fallbackRun2.checkedTenants).toBe(0);
    expect(fallbackRun2.totalInserted).toBe(0);

    // Restaura a coluna para não afetar eventuais testes futuros
    await pool.query(`ALTER TABLE lead_client_n8n_settings ADD COLUMN IF NOT EXISTS stalled_notifications_synced_at timestamptz`);
  });
});
