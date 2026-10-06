// backend/src/test/secondNumberRoutes.test.js
//
// As duas rotas HTTP do Bloco B (GET /api/leads/second-number/campaigns, POST /api/leads/second-number/audience) com Postgres REAL (pglite):
// o serviço do produto por trás, escopo do operador vindo do token, validação de entrada e erro sem vazar SQL.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { sanitizePhone } from "../services/leadImport.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const T = "tenant-a";
const NOW = Date.now();
const ago = (d) => new Date(NOW - d * 86_400_000).toISOString();
const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL REFERENCES leads_clients(id), telefone text NOT NULL, phone text, nome text,
    dados jsonb NOT NULL DEFAULT '{}'::jsonb, assigned_to text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (client_id, telefone));
  CREATE TABLE campaigns (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, name text NOT NULL, analytics_meta jsonb, last_triggered_at timestamptz);
  CREATE TABLE campaign_dispatches (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id uuid NOT NULL, client_id text NOT NULL);
  CREATE TABLE campaign_dispatch_runs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_id uuid NOT NULL, campaign_id uuid NOT NULL, client_id text NOT NULL, phone text NOT NULL,
    status text NOT NULL DEFAULT 'pending', sent_at timestamptz);
  CREATE TABLE lead_messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, lead_id uuid, phone text, direction text, engagement_signal text,
    message_timestamp timestamptz, delivered_at timestamptz, created_at timestamptz DEFAULT now());
`;

describe("rotas da segunda tentativa por outro número", () => {
  let server;
  let baseUrl;
  let db;
  let camp;
  const estado = { quebrar: false };
  const sendError = (res, status, code, message, details) => res.status(status).json({ error: { code, message, details } });

  beforeAll(async () => {
    db = await createPgliteDb(SCHEMA);
    await db.exec(`INSERT INTO leads_clients VALUES ('${T}', 'A')`);
    camp = (await db.query(`INSERT INTO campaigns (client_id, name) VALUES ('${T}', 'Camp') RETURNING id::text id`)).rows[0].id;
    const disp = (await db.query(`INSERT INTO campaign_dispatches (campaign_id, client_id) VALUES ($1, '${T}') RETURNING id::text id`, [camp])).rows[0].id;
    // três empresas: gabriel (elegível), priscila (elegível), gabriel (respondeu no adicional)
    const mk = async (tel, extra, dono) => {
      await db.query(`INSERT INTO leads (client_id, telefone, nome, dados, assigned_to) VALUES ($1, $2, $3, $4::jsonb, $5)`, [T, tel, `L ${tel}`, JSON.stringify({ telefones_extras: [{ telefone: extra }] }), dono]);
      await db.query(`INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, phone, status, sent_at) VALUES ($1, $2, $3, $4, 'sent', $5)`, [disp, camp, T, tel, ago(30)]);
    };
    await mk("5534991110001", "5534992220001", "gabriel");
    await mk("5534991110002", "5534992220002", "priscila");
    await mk("5534991110003", "5534992220003", "gabriel");
    await db.query(`INSERT INTO lead_messages (client_id, phone, direction, message_timestamp) VALUES ($1, '5534992220003', 'inbound', $2)`, [T, ago(20)]);

    const pool = { query: (sql, p) => (estado.quebrar ? Promise.reject(Object.assign(new Error("boom"), { stack: "STACK-SECRETA" })) : db.query(sql, p)) };
    const app = express();
    app.use(express.json());
    registerLeadsRoutes(app, {
      ensureDb: () => true,
      pgDatabasePool: pool,
      supabase: { from: () => { throw new Error("não deve ser usado"); } },
      requireFirebaseAuth: (req, _res, next) => {
        const papel = req.headers["x-test-papel"];
        req.authAccess = papel === "operador"
          ? { uid: "gabriel", email: "g@x", role: "internal", accessPreset: "operador" }
          : { uid: "u1", email: "u@x", role: "internal", clientId: T };
        next();
      },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      ensureSharedRoutePageAccess: () => true,
      resolveAuthorizedClientId: (_req, res, cid) => {
        if (cid && cid !== T) { sendError(res, 403, "FORBIDDEN", "Sem acesso a este cliente"); return null; }
        return cid || T;
      },
      sanitizePhone: (p, ddd) => sanitizePhone(p, ddd),
      sendError,
      normalizeString: (s) => (s ? String(s).trim() : ""),
    });
    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    baseUrl = `http://localhost:${server.address().port}`;
    vi.spyOn(console, "error").mockImplementation(() => {});
  }, 120_000);
  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    await db?.close();
  });

  const post = (body, headers = {}) => fetch(`${baseUrl}/api/leads/second-number/audience?clientId=${T}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });

  it("lista as campanhas que enviaram", async () => {
    const r = await (await fetch(`${baseUrl}/api/leads/second-number/campaigns?clientId=${T}`)).json();
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ id: camp, name: "Camp", sentCount: 3 });
  });

  it("público: dois elegíveis, um excluído por ter respondido em outro número; o aviso do caminho antigo vem com número", async () => {
    const r = await (await post({ campaignId: camp, waitDays: 7 })).json();
    expect(r.counts).toMatchObject({ received: 3, elegiveis: 2, respondeuOutroNumero: 1, lidNaoLigadas: 0, campanhasCaminhoAntigo: 0 });
    expect(r.items.map((i) => i.alvo).sort()).toEqual(["5534992220001", "5534992220002"]);
  });

  it("operador vê só o que é dele (gabriel: 1 elegível; a da priscila some)", async () => {
    const r = await (await post({ campaignId: camp, waitDays: 7 }, { "x-test-papel": "operador" })).json();
    expect(r.items.map((i) => i.alvo)).toEqual(["5534992220001"]);
  });

  it("clientId de OUTRA empresa é 403 nas duas rotas (nunca os dados dela)", async () => {
    const a = await fetch(`${baseUrl}/api/leads/second-number/campaigns?clientId=outra-empresa`);
    expect(a.status).toBe(403);
    const b = await fetch(`${baseUrl}/api/leads/second-number/audience?clientId=outra-empresa`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: camp, waitDays: 7 }) });
    expect(b.status).toBe(403);
  });

  it("entrada inválida é 400 com código; nunca 500", async () => {
    const a = await post({ campaignId: "nao-e-uuid" });
    expect(a.status).toBe(400);
    expect((await a.json()).error.code).toBe("INVALID_CAMPAIGN_ID");
    const b = await post({ campaignId: camp, waitDays: 0 });
    expect(b.status).toBe(400);
    expect((await b.json()).error.code).toBe("INVALID_WAIT_DAYS");
  });

  it("falha do banco: 500 com código, sem stack nem SQL no corpo", async () => {
    estado.quebrar = true;
    try {
      const r = await post({ campaignId: camp, waitDays: 7 });
      expect(r.status).toBe(500);
      const corpo = JSON.stringify(await r.json());
      expect(corpo).toContain("SECOND_NUMBER_AUDIENCE_FAILED");
      expect(corpo).not.toContain("STACK-SECRETA");
    } finally {
      estado.quebrar = false;
    }
  });
});
