// Porta de leitura da Analista geral (GET /api/analyst/overview): token próprio, só agregados, nunca telefone ou
// nome de lead. Postgres real (pglite), rota real, token real.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { ANALYST_TOKEN_ENV, analystToken, lerDias, registerAnalystRoutes } from "../analyst/overview.js";

const TOKEN = "a".repeat(24) + "-token-da-analista-geral-01";
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const C3 = "33333333-3333-4333-8333-333333333333";

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE campaigns (id uuid PRIMARY KEY, client_id text NOT NULL, name text NOT NULL, status text NOT NULL DEFAULT 'active');
  CREATE TABLE campaign_dispatch_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid, client_id text NOT NULL, phone text, status text NOT NULL,
    sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE lead_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, phone text, direction text, engagement_signal text,
    message_timestamp timestamptz, delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE llm_usage (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text, origem text, phone text, provider text NOT NULL, model text NOT NULL,
    prompt_tokens integer, completion_tokens integer, total_tokens integer, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE evolution_instance_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, instance_id text, instance_name text NOT NULL, chip_name text,
    kind text NOT NULL, occurred_at timestamptz NOT NULL, reason_label text, snapshot jsonb);
  CREATE TABLE traffic_metrics_daily (
    id bigserial PRIMARY KEY, client_id text NOT NULL, platform text NOT NULL, external_account_id text NOT NULL, ad_id text NOT NULL,
    date date NOT NULL, spend numeric(14,2) NOT NULL DEFAULT 0, impressions bigint NOT NULL DEFAULT 0, clicks bigint NOT NULL DEFAULT 0,
    leads integer NOT NULL DEFAULT 0, messages_started integer NOT NULL DEFAULT 0);
  CREATE TABLE dashboard_metrics_cache (
    client_id text NOT NULL, period text NOT NULL, data jsonb, calculated_at timestamptz, status text, last_error text,
    PRIMARY KEY (client_id, period));
`;

let db;
let server;
let base;
const envAntes = { ...process.env };

const get = async (path, token = TOKEN) => {
  const r = await fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.status, json: await r.json().catch(() => null), texto: "" };
};

beforeAll(async () => {
  db = await createPgliteDb(SCHEMA);
  const pool = { query: (text, params) => db.query(text, params) };
  const app = express();
  registerAnalystRoutes(app, { pool });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
}, 60_000);

beforeEach(async () => {
  for (const k of [ANALYST_TOKEN_ENV, "GOCLAW_READ_TOKEN", "CAMPAIGN_AGENT_TOKENS", "TRAFFIC_GOCLAW_TOKENS"]) delete process.env[k];
  process.env[ANALYST_TOKEN_ENV] = TOKEN;
  for (const t of ["lead_messages", "campaign_dispatch_runs", "campaigns", "llm_usage", "evolution_instance_events", "traffic_metrics_daily", "dashboard_metrics_cache"]) {
    await db.query(`DELETE FROM ${t}`);
  }
  await db.query(
    "INSERT INTO campaigns (id, client_id, name) VALUES ($1, 'tinge', 'Abertura curta'), ($2, 'tinge', 'Só o reel'), ($3, 'nous', 'Antiga')",
    [C1, C2, C3]
  );
  // C1: 3 enviados há 2 dias (um responde com o telefone em outra grafia, um responde ANTES do envio e não conta), 1 falhou.
  // C2: 1 enviado há 2 dias, respondeu 20 dias depois (fora da janela de 14 dias: não conta).
  // C3: enviado há 40 dias: fora do período de 7 dias.
  await db.query(
    `INSERT INTO campaign_dispatch_runs (campaign_id, client_id, phone, status, sent_at, created_at) VALUES
      ($1, 'tinge', '5534999990001', 'sent', now() - interval '2 days', now() - interval '2 days'),
      ($1, 'tinge', '5534999990002', 'sent', now() - interval '2 days', now() - interval '2 days'),
      ($1, 'tinge', '5534999990003', 'sent', now() - interval '2 days', now() - interval '2 days'),
      ($1, 'tinge', '5534999990004', 'failed', NULL, now() - interval '1 day'),
      ($2, 'tinge', '5534999990005', 'sent', now() - interval '30 days', now() - interval '30 days'),
      ($3, 'nous', '5534999990006', 'sent', now() - interval '40 days', now() - interval '40 days')`,
    [C1, C2, C3]
  );
  await db.query(
    `INSERT INTO lead_messages (client_id, phone, direction, message_timestamp) VALUES
      ('tinge', '5534999990001', 'inbound', now() - interval '2 days' + interval '5 minutes'),
      ('tinge', '553499990002', 'inbound', now() - interval '1 day'),
      ('tinge', '5534999990003', 'inbound', now() - interval '3 days'),
      ('tinge', '5534999990001', 'outbound', now() - interval '1 day')`
  );
  await db.query(
    `INSERT INTO llm_usage (client_id, provider, model, prompt_tokens, completion_tokens, created_at, phone) VALUES
      ('tinge', 'gemini', 'gemini-flash-latest', 1000, 100, now() - interval '1 day', '5534999990001'),
      ('tinge', 'gemini', 'gemini-flash-latest', 500, 50, now() - interval '2 days', '5534999990002'),
      (NULL, 'groq', 'gpt-oss', 10, 5, now() - interval '1 day', NULL),
      ('nous', 'gemini', 'gemini-flash-latest', 9999, 999, now() - interval '20 days', NULL)`
  );
  await db.query(
    `INSERT INTO evolution_instance_events (client_id, instance_name, chip_name, kind, occurred_at, reason_label) VALUES
      ('nous', 'nous-chip-2', 'Chip 2', 'queda', now() - interval '3 days', 'aparelho removido'),
      ('nous', 'nous-chip-2', 'Chip 2', 'conectado', now() - interval '2 days', NULL),
      ('nous', 'nous-chip-2', 'Chip 2', 'queda', now() - interval '1 day', 'aparelho removido'),
      ('tinge', 'tinge-1', NULL, 'queda', now() - interval '60 days', 'outro')`
  );
  await db.query(
    `INSERT INTO traffic_metrics_daily (client_id, platform, external_account_id, ad_id, date, spend, impressions, clicks, leads, messages_started) VALUES
      ('udi', 'meta', 'act_1', 'ad1', current_date - 1, 10.50, 1000, 40, 2, 3),
      ('udi', 'meta', 'act_1', 'ad2', current_date - 2, 4.50, 500, 10, 0, 1),
      ('udi', 'meta', 'act_1', 'ad1', current_date - 30, 99, 9, 9, 9, 9)`
  );
  await db.query(
    `INSERT INTO dashboard_metrics_cache (client_id, period, data, calculated_at, status) VALUES
      ('tinge', '30d', $1::jsonb, now() - interval '3 hours', 'fresh'),
      ('tinge', '7d', '{"summary":{}}'::jsonb, now(), 'fresh')`,
    [JSON.stringify({
      summary: { sent: { current: 33, previous: 0, delta: null }, replied: { current: 14, reached: 33, rate: 42.4, ruleDeclaration: "pessoas que responderam em até 14 dias" } },
      overview: {
        meetings: { current: null, previous: null, hasRecords: false },
        funnel: { received: { current: 33, previous: 0 }, replied: { current: 14, previous: 0 } },
        queue: { oldest: [{ name: "Maria Lead", phone: "5534999990001" }] },
      },
      periodInfo: { key: "30d", days: 30, current: { from: "2026-10-28", to: "2026-11-27" } },
    })]
  );
});

afterAll(async () => {
  process.env = envAntes;
  if (server) await new Promise((r) => server.close(r));
  await db?.close();
});

describe("token da analista", () => {
  it("sem token, token errado ou variável ausente: 401", async () => {
    expect((await get("/api/analyst/overview", null)).status).toBe(401);
    expect((await get("/api/analyst/overview", "x".repeat(40))).status).toBe(401);
    delete process.env[ANALYST_TOKEN_ENV];
    expect((await get("/api/analyst/overview")).status).toBe(401);
  });

  it("token curto ou repetido de outro serviço não abre a porta", () => {
    expect(analystToken({ [ANALYST_TOKEN_ENV]: "curto" })).toBeNull();
    expect(analystToken({ [ANALYST_TOKEN_ENV]: TOKEN, GOCLAW_READ_TOKEN: TOKEN })).toBeNull();
    expect(analystToken({ [ANALYST_TOKEN_ENV]: TOKEN, CAMPAIGN_AGENT_TOKENS: `tinge=${TOKEN}` })).toBeNull();
    expect(analystToken({ [ANALYST_TOKEN_ENV]: TOKEN, TRAFFIC_GOCLAW_TOKENS: `udi=${TOKEN}` })).toBeNull();
    expect(analystToken({ [ANALYST_TOKEN_ENV]: TOKEN })).toBe(TOKEN);
  });

  it("dias fora de 1 a 90 é recusado com 400", async () => {
    expect(lerDias(undefined)).toBe(7);
    expect(lerDias("30")).toBe(30);
    expect(lerDias("0")).toBeNull();
    expect(lerDias("91")).toBeNull();
    expect(lerDias("7.5")).toBeNull();
    expect((await get("/api/analyst/overview?dias=abc")).status).toBe(400);
  });

  it("nenhum método além de GET existe na porta", async () => {
    const r = await fetch(base + "/api/analyst/overview", { method: "POST", headers: { authorization: `Bearer ${TOKEN}` } });
    expect(r.status).toBe(404);
  });
});

describe("retrato da operação", () => {
  it("campanhas pela régua da tela: enviados, falhas e respostas dentro da janela, só no período", async () => {
    const { status, json } = await get("/api/analyst/overview?dias=7");
    expect(status).toBe(200);
    expect(json.periodo).toEqual({ dias: 7 });
    expect(json.erros).toEqual({});
    expect(json.campanhas.porEmpresa).toEqual([{ empresa: "tinge", campanhas: 1, enviados: 3, falharam: 1, responderam: 2 }]);
    expect(json.campanhas.ranking).toEqual([
      { id: C1, empresa: "tinge", nome: "Abertura curta", status: "active", enviados: 3, falharam: 1, responderam: 2 },
    ]);
  });

  it("período maior pega a campanha antiga, mas resposta fora da janela de 14 dias não conta", async () => {
    const { json } = await get("/api/analyst/overview?dias=35");
    const c2 = json.campanhas.ranking.find((c) => c.id === C2);
    expect(c2).toMatchObject({ enviados: 1, responderam: 0 });
    expect(json.campanhas.ranking.find((c) => c.id === C3)).toBeUndefined();
  });

  it("IA, chips, tráfego e dashboard do cache, só com números", async () => {
    const { json } = await get("/api/analyst/overview?dias=7");
    expect(json.ia.porModelo).toEqual([
      { provider: "gemini", model: "gemini-flash-latest", chamadas: 2, entrada: 1500, saida: 150 },
      { provider: "groq", model: "gpt-oss", chamadas: 1, entrada: 10, saida: 5 },
    ]);
    expect(json.ia.porEmpresa.find((e) => e.empresa === "(sem empresa)")).toMatchObject({ chamadas: 1 });

    const chip2 = json.chips.find((c) => c.instancia === "nous-chip-2");
    expect(chip2).toMatchObject({ empresa: "nous", chip: "Chip 2", quedasNoPeriodo: 2, ultimoEvento: { tipo: "queda", motivo: "aparelho removido" } });
    expect(json.chips.find((c) => c.instancia === "tinge-1")).toMatchObject({ chip: "tinge-1", quedasNoPeriodo: 0 });

    expect(json.trafego).toEqual([
      expect.objectContaining({ empresa: "udi", plataforma: "meta", gasto: 15, impressoes: 1500, cliques: 50, leads: 2, conversas: 4 }),
    ]);

    expect(json.dashboard).toHaveLength(1);
    expect(json.dashboard[0]).toMatchObject({
      empresa: "tinge", estadoDoCache: "fresh",
      enviados: { current: 33, previous: 0 }, responderam: { current: 14, rate: 42.4 },
      reunioes: { hasRecords: false }, funil: { received: { current: 33, previous: 0 } },
    });
  });

  it("nunca devolve telefone, nome de lead ou texto da fila", async () => {
    const { json } = await get("/api/analyst/overview?dias=35");
    const texto = JSON.stringify(json);
    expect(texto).not.toMatch(/553499999000/);
    expect(texto).not.toMatch(/Maria Lead/);
    expect(texto).not.toMatch(/queue|oldest|phone/);
  });

  it("um bloco que falha não derruba os outros", async () => {
    await db.query("ALTER TABLE traffic_metrics_daily RENAME TO traffic_metrics_daily_x");
    try {
      const { status, json } = await get("/api/analyst/overview?dias=7");
      expect(status).toBe(200);
      expect(json.trafego).toBeNull();
      expect(json.erros).toEqual({ trafego: "falha ao ler" });
      expect(json.campanhas.porEmpresa).toHaveLength(1);
    } finally {
      await db.query("ALTER TABLE traffic_metrics_daily_x RENAME TO traffic_metrics_daily");
    }
  });
});
