// Resumo de campanha para o agente (GET /api/campaign-agent/campaigns/summary): o analista do agente compara formatos
// de campanha pelo mesmo número da tela ("Enviados" e "Responderam"). Postgres real (pglite), rota real, token real.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express from "express";
import http from "node:http";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { CAMPAIGN_AGENT_TOKENS_ENV, registerCampaignAgentLeadBatchRoutes } from "../campaign/agentDraft.js";

const T = "vexo-adm-teste";
const OUTRA = "outra-teste";
const TOKEN_T = "t".repeat(20) + "-token-do-agente-da-vexo-teste-01";
const TOKEN_O = "o".repeat(20) + "-token-do-agente-da-outra-teste-02";
const C1 = "11111111-1111-4111-8111-111111111111";
const C2 = "22222222-2222-4222-8222-222222222222";
const C_OUTRA = "33333333-3333-4333-8333-333333333333";

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE campaigns (id uuid PRIMARY KEY, client_id text NOT NULL, name text NOT NULL, status text NOT NULL DEFAULT 'active');
  CREATE TABLE campaign_dispatch_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid, client_id text NOT NULL, phone text, status text NOT NULL,
    sent_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
  CREATE TABLE lead_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, phone text, direction text, engagement_signal text,
    message_timestamp timestamptz, delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
`;

let db;
let server;
let base;
const envAntes = process.env[CAMPAIGN_AGENT_TOKENS_ENV];

const get = async (path, token) => {
  const r = await fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.status, json: await r.json().catch(() => null) };
};

beforeAll(async () => {
  db = await createPgliteDb(SCHEMA);
  const pool = { query: (text, params) => db.query(text, params) };
  const app = express();
  registerCampaignAgentLeadBatchRoutes(app, { pgDatabasePool: pool });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
}, 60_000);

beforeEach(async () => {
  process.env[CAMPAIGN_AGENT_TOKENS_ENV] = `${T}=${TOKEN_T},${OUTRA}=${TOKEN_O}`;
  for (const t of ["lead_messages", "campaign_dispatch_runs", "campaigns"]) await db.query(`DELETE FROM ${t}`);
  await db.query(
    "INSERT INTO campaigns (id, client_id, name) VALUES ($1, $4, 'Abertura curta'), ($2, $4, 'Só o reel'), ($3, $5, 'Da outra')",
    [C1, C2, C_OUTRA, T, OUTRA]
  );
  const envio = "2026-11-26T15:00:00Z";
  // C1: 3 enviados (um com o telefone em outra grafia na resposta), 1 falhou; 2 responderam depois do envio, 1 respondeu ANTES (não conta).
  await db.query(
    `INSERT INTO campaign_dispatch_runs (campaign_id, client_id, phone, status, sent_at) VALUES
      ($1, $2, '5534999990001', 'sent', $3), ($1, $2, '5534999990002', 'sent', $3), ($1, $2, '5534999990003', 'sent', $3),
      ($1, $2, '5534999990004', 'failed', NULL), ($4, $2, '5534999990005', 'sent', $3)`,
    [C1, T, envio, C2]
  );
  await db.query(
    `INSERT INTO lead_messages (client_id, phone, direction, message_timestamp) VALUES
      ($1, '5534999990001', 'inbound', '2026-11-26T15:05:00Z'),
      ($1, '553499990002', 'inbound', '2026-11-26T16:00:00Z'),
      ($1, '5534999990003', 'inbound', '2026-11-26T14:00:00Z'),
      ($1, '5534999990001', 'outbound', '2026-11-26T15:06:00Z')`,
    [T]
  );
});

afterAll(async () => {
  if (envAntes === undefined) delete process.env[CAMPAIGN_AGENT_TOKENS_ENV];
  else process.env[CAMPAIGN_AGENT_TOKENS_ENV] = envAntes;
  if (server) await new Promise((r) => server.close(r));
  await db?.close();
});

describe("resumo de campanha para o agente", () => {
  it("[OBRIGATÓRIO] enviados, falharam e responderam com a régua da tela (resposta depois do envio, telefone canônico)", async () => {
    const r = await get(`/api/campaign-agent/campaigns/summary?ids=${C1},${C2}`, TOKEN_T);
    expect(r.status).toBe(200);
    expect(r.json.campanhas[C1]).toEqual({ name: "Abertura curta", status: "active", sent: 3, failed: 1, replied: 2 });
    expect(r.json.campanhas[C2]).toEqual({ name: "Só o reel", status: "active", sent: 1, failed: 0, replied: 0 });
  });

  it("[OBRIGATÓRIO] token de uma empresa não lê campanha de outra", async () => {
    const r = await get(`/api/campaign-agent/campaigns/summary?ids=${C1},${C_OUTRA}`, TOKEN_T);
    expect(r.status).toBe(200);
    expect(Object.keys(r.json.campanhas)).toEqual([C1]);
    const o = await get(`/api/campaign-agent/campaigns/summary?ids=${C1}`, TOKEN_O);
    expect(o.json.campanhas).toEqual({});
  });

  it("sem token, sem ids ou com id inválido é recusado", async () => {
    expect((await get(`/api/campaign-agent/campaigns/summary?ids=${C1}`)).status).toBe(401);
    expect((await get("/api/campaign-agent/campaigns/summary", TOKEN_T)).status).toBe(400);
    expect((await get("/api/campaign-agent/campaigns/summary?ids=nao-e-uuid';drop", TOKEN_T)).status).toBe(400);
  });
});
