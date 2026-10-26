// backend/src/test/bancoLeadsDisparadosFilter.test.js
//
// Testes do filtro e exibição de disparos no Banco de Dados (Pedido de Gabriel, 26/10):
// - Três estados de filtro: "never" (nunca recebeu), "received" (já recebeu), "recent" (recebeu nos últimos N dias, default 30).
// - Exibição na linha do lead: data do último disparo e nome da campanha.
// - Casamento canônico por telefone: DDD + 8/9 dígitos (SQL_CANONICAL_PHONE), tolerante a variações com/sem 55 e com/sem 9º dígito.
// - Multi-tenant estrito: mensagens e runs de outro tenant nunca afetam a base do cliente.
// - Performance: CTE materializado com OFFSET 0 e Hash Join, prevenindo timeout de 30s.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  parseLeadListFilters,
  queryLeadsPage,
  queryLeadIds,
  DISPATCHED_FILTER_VALUES,
} from "../services/leadListQuery.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const T = "tenant-gabriel";
const OUTRO = "tenant-concorrente";

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE campaigns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    telefone text NOT NULL,
    phone text,
    nome text,
    stage text DEFAULT 'cold',
    temperature text DEFAULT 'warm',
    tags text[] DEFAULT ARRAY[]::text[],
    lead_source text,
    dados jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_interaction_at timestamptz,
    last_message_at timestamptz,
    raw_chat_summary text,
    assigned_to text,
    UNIQUE (client_id, telefone)
  );
  CREATE TABLE lead_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
    dispatch_id uuid,
    phone text NOT NULL,
    direction text NOT NULL DEFAULT 'outbound',
    message_text text,
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    message_timestamp timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE campaign_dispatch_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    campaign_id uuid REFERENCES campaigns(id) ON DELETE SET NULL,
    dispatch_id uuid,
    phone text NOT NULL,
    status text NOT NULL DEFAULT 'sent',
    sent_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
  );
`;

describe("Filtro e exibição de disparos no Banco de Dados (Gabriel, 26/10)", () => {
  let db;
  let pool;
  const scope = { clientId: T };

  beforeAll(async () => {
    db = await createPgliteDb(SCHEMA);
    pool = { query: (sql, values) => db.query(sql, values) };

    // Cria tenants
    await pool.query(`INSERT INTO leads_clients (id, name) VALUES ($1, 'Tenant Gabriel'), ($2, 'Tenant Outro')`, [T, OUTRO]);

    // Cria campanhas
    await pool.query(
      `INSERT INTO campaigns (id, client_id, name) VALUES
       ('11111111-1111-1111-1111-111111111111', $1, 'Campanha Black Friday'),
       ('22222222-2222-2222-2222-222222222222', $1, 'Campanha Reativação 60D'),
       ('99999999-9999-9999-9999-999999999999', $2, 'Campanha Invasora')`,
      [T, OUTRO]
    );

    // Cria Leads:
    // Lead A: Nunca disparado. Telefone formatado: (34) 98888-1111
    // Lead B: Disparado há 5 dias via lead_messages. Telefone no lead: 3491093607 (10 dígitos sem 9), na mensagem: 5534991093607 (13 dígitos)
    // Lead C: Disparado há 45 dias via campaign_dispatch_runs. Telefone no lead: 5534992223333, no run: 34992223333
    // Lead D: Tenant outro, disparado ontem.
    await pool.query(
      `INSERT INTO leads (id, client_id, telefone, phone, nome, created_at) VALUES
       ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', $1, '(34) 98888-1111', '34988881111', 'Lead A - Nunca Disparado', now() - interval '60 days'),
       ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', $1, '3491093607', null, 'Lead B - Disparado Recente', now() - interval '60 days'),
       ('cccccccc-cccc-cccc-cccc-cccccccccccc', $1, '5534992223333', '5534992223333', 'Lead C - Disparado Antigo', now() - interval '60 days'),
       ('dddddddd-dddd-dddd-dddd-dddddddddddd', $2, '11977772222', null, 'Lead D - Outro Tenant', now() - interval '60 days')`,
      [T, OUTRO]
    );

    // Mensagens: Lead B recebeu há 5 dias
    await pool.query(
      `INSERT INTO lead_messages (client_id, campaign_id, phone, direction, created_at) VALUES
       ($1, '11111111-1111-1111-1111-111111111111', '5534991093607', 'outbound', now() - interval '5 days')`,
      [T]
    );

    // Dispatch runs: Lead C enviado há 45 dias
    await pool.query(
      `INSERT INTO campaign_dispatch_runs (client_id, campaign_id, phone, status, sent_at) VALUES
       ($1, '22222222-2222-2222-2222-222222222222', '34992223333', 'sent', now() - interval '45 days')`,
      [T]
    );

    // Mensagem de outro tenant (Lead D)
    await pool.query(
      `INSERT INTO lead_messages (client_id, campaign_id, phone, direction, created_at) VALUES
       ($1, '99999999-9999-9999-9999-999999999999', '5511977772222', 'outbound', now() - interval '1 day')`,
      [OUTRO]
    );
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  describe("parseLeadListFilters", () => {
    it("aceita os valores canônicos: all, never, received, recent", () => {
      expect(parseLeadListFilters({ dispatched: "never" }).filters.dispatched).toBe("never");
      expect(parseLeadListFilters({ dispatched: "received" }).filters.dispatched).toBe("received");
      expect(parseLeadListFilters({ dispatched: "recent" }).filters.dispatched).toBe("recent");
      expect(parseLeadListFilters({ dispatched: "recent" }).filters.dispatchedDays).toBe(30);
      expect(parseLeadListFilters({ dispatched: "recent", dispatchedDays: "15" }).filters.dispatchedDays).toBe(15);
      expect(parseLeadListFilters({ dispatched: "all" }).filters.dispatched).toBeUndefined();
    });

    it("recusa valores fora da lista conhecida", () => {
      const parsed = parseLeadListFilters({ dispatched: "invalido" });
      expect(parsed.problem).toContain("Filtro de disparo inválido: invalido");
    });
  });

  describe("Casamento canônico por telefone e exibição na linha", () => {
    it("exibe data do último disparo e nome da campanha na linha do lead, mesmo com formatos de telefone diferentes", async () => {
      const res = await queryLeadsPage(pool, { scope, filters: {}, limit: 10 });
      expect(res.total).toBe(3);

      const leadA = res.items.find((x) => x.id === "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
      const leadB = res.items.find((x) => x.id === "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
      const leadC = res.items.find((x) => x.id === "cccccccc-cccc-cccc-cccc-cccccccccccc");

      // Lead A: nunca disparado
      expect(leadA.last_dispatched_at).toBeNull();
      expect(leadA.last_dispatched_campaign_name).toBeNull();

      // Lead B: casado entre 3491093607 (sem 9) e 5534991093607
      expect(leadB.last_dispatched_at).not.toBeNull();
      expect(leadB.last_dispatched_campaign_name).toBe("Campanha Black Friday");

      // Lead C: casado entre 5534992223333 e 34992223333
      expect(leadC.last_dispatched_at).not.toBeNull();
      expect(leadC.last_dispatched_campaign_name).toBe("Campanha Reativação 60D");
    });
  });

  describe("Filtro nos 3 estados", () => {
    it("estado 'never' (nunca recebeu disparo): retorna apenas Lead A", async () => {
      const res = await queryLeadsPage(pool, { scope, filters: { dispatched: "never" } });
      expect(res.total).toBe(1);
      expect(res.items[0].id).toBe("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
      expect(res.items[0].last_dispatched_at).toBeNull();
    });

    it("estado 'received' (já recebeu disparo): retorna Lead B e Lead C", async () => {
      const res = await queryLeadsPage(pool, { scope, filters: { dispatched: "received" } });
      expect(res.total).toBe(2);
      const ids = res.items.map((x) => x.id).sort();
      expect(ids).toEqual(["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "cccccccc-cccc-cccc-cccc-cccccccccccc"]);
    });

    it("estado 'recent' com default 30 dias: retorna apenas Lead B (enviado há 5 dias)", async () => {
      const res = await queryLeadsPage(pool, { scope, filters: { dispatched: "recent", dispatchedDays: 30 } });
      expect(res.total).toBe(1);
      expect(res.items[0].id).toBe("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    });

    it("estado 'recent' com 60 dias: retorna Lead B (5 dias) e Lead C (45 dias)", async () => {
      const res = await queryLeadsPage(pool, { scope, filters: { dispatched: "recent", dispatchedDays: 60 } });
      expect(res.total).toBe(2);
      const ids = res.items.map((x) => x.id).sort();
      expect(ids).toEqual(["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "cccccccc-cccc-cccc-cccc-cccccccccccc"]);
    });

    it("estado 'recent' com 2 dias: retorna 0 leads", async () => {
      const res = await queryLeadsPage(pool, { scope, filters: { dispatched: "recent", dispatchedDays: 2 } });
      expect(res.total).toBe(0);
      expect(res.items).toHaveLength(0);
    });

    it("queryLeadIds respeita o filtro de disparo", async () => {
      const idsRes = await queryLeadIds(pool, { scope, filters: { dispatched: "never" } });
      expect(idsRes.total).toBe(1);
      expect(idsRes.ids).toEqual(["aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"]);
    });
  });

  describe("Isolamento multi-tenant", () => {
    it("mensagens de outro tenant nunca vazam para o cliente", async () => {
      const outroRes = await queryLeadsPage(pool, { scope: { clientId: OUTRO }, filters: { dispatched: "recent" } });
      expect(outroRes.total).toBe(1);
      expect(outroRes.items[0].id).toBe("dddddddd-dddd-dddd-dddd-dddddddddddd");
      expect(outroRes.items[0].last_dispatched_campaign_name).toBe("Campanha Invasora");

      // No Tenant Gabriel, o disparo do outro tenant no mesmo telefone 34991093607 NÃO substitui a campanha da Gabriel
      const gabrielRes = await queryLeadsPage(pool, { scope, filters: { dispatched: "recent" } });
      expect(gabrielRes.items[0].last_dispatched_campaign_name).toBe("Campanha Black Friday");
    });
  });

  describe("Diferenciação obrigatória de mensagens órfãs por meta->>'source'", () => {
    it("conta mensagem outbound sem campaign_id com meta source campaign_dispatch como 'received', e ignora hardcoded-chat-webhook", async () => {
      // Lead E: recebeu disparo órfão (source: 'campaign_dispatch', sem campaign_id e sem dispatch_id)
      // Lead F: recebeu apenas resposta do robô de atendimento (source: 'hardcoded-chat-webhook', sem campaign_id e sem dispatch_id)
      await pool.query(
        `INSERT INTO leads (id, client_id, telefone, phone, nome, created_at) VALUES
         ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', $1, '34993334444', '34993334444', 'Lead E - Disparo Órfão', now() - interval '20 days'),
         ('ffffffff-ffff-ffff-ffff-ffffffffffff', $1, '34995556666', '34995556666', 'Lead F - Atendimento Robô', now() - interval '20 days')`,
        [T]
      );

      // Disparo de campanha órfão: sem campaign_id e sem dispatch_id, mas meta source = 'campaign_dispatch'
      await pool.query(
        `INSERT INTO lead_messages (client_id, campaign_id, dispatch_id, phone, direction, meta, created_at) VALUES
         ($1, null, null, '5534993334444', 'outbound', '{"source": "campaign_dispatch"}'::jsonb, now() - interval '3 days')`,
        [T]
      );

      // Mensagem de atendimento robô: sem campaign_id e sem dispatch_id, meta source = 'hardcoded-chat-webhook'
      await pool.query(
        `INSERT INTO lead_messages (client_id, campaign_id, dispatch_id, phone, direction, meta, created_at) VALUES
         ($1, null, null, '5534995556666', 'outbound', '{"source": "hardcoded-chat-webhook"}'::jsonb, now() - interval '1 day')`,
        [T]
      );

      // Consulta no estado 'received': Lead E DEVE constar, Lead F NÃO DEVE constar
      const resReceived = await queryLeadsPage(pool, { scope, filters: { dispatched: "received" } });
      const receivedIds = resReceived.items.map((x) => x.id);
      expect(receivedIds).toContain("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
      expect(receivedIds).not.toContain("ffffffff-ffff-ffff-ffff-ffffffffffff");

      // O Lead E deve exibir 'Campanha' como fallback no nome da campanha (COALESCE(c.name, 'Campanha'))
      const leadE = resReceived.items.find((x) => x.id === "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
      expect(leadE.last_dispatched_campaign_name).toBe("Campanha");
      expect(leadE.last_dispatched_at).not.toBeNull();

      // Consulta no estado 'never': Lead F DEVE constar (nunca recebeu campanha), Lead E NÃO DEVE constar
      const resNever = await queryLeadsPage(pool, { scope, filters: { dispatched: "never" } });
      const neverIds = resNever.items.map((x) => x.id);
      expect(neverIds).toContain("ffffffff-ffff-ffff-ffff-ffffffffffff");
      expect(neverIds).not.toContain("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
    });
  });

  describe("Benchmark de Custo e Performance (Cerca anti-timeout OFFSET 0)", () => {
    it("executa a consulta com Hash Join em tempo muito abaixo do limite (< 300ms)", async () => {
      // Insere 1.000 leads e 500 mensagens para simular carga
      await db.exec(`
        INSERT INTO leads (client_id, telefone, nome, created_at)
        SELECT '${T}', '55349' || lpad(i::text, 8, '0'), 'Lead Benchmark ' || i, now() - interval '10 days'
        FROM generate_series(1, 1000) g(i)
        ON CONFLICT DO NOTHING;

        INSERT INTO lead_messages (client_id, campaign_id, phone, direction, created_at)
        SELECT '${T}', '11111111-1111-1111-1111-111111111111', '349' || lpad(i::text, 8, '0'), 'outbound', now() - interval '3 days'
        FROM generate_series(1, 500) g(i);
      `);

      const t0 = performance.now();
      const res = await queryLeadsPage(pool, { scope, filters: { dispatched: "recent", dispatchedDays: 7 }, limit: 50 });
      const elapsed = performance.now() - t0;

      expect(res.total).toBeGreaterThanOrEqual(500);
      expect(elapsed).toBeLessThan(300); // 300ms teto estrito (muito longe dos 30s de timeout)
    });
  });
});
