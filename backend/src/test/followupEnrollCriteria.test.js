// backend/src/test/followupEnrollCriteria.test.js
//
// Testes de POST /api/followup/campaigns/:id/enroll com critérios dinâmicos (criteria)
// e respeito a exceções desmarcadas (excludedLeadIds).

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPoolForTesting } from "../followup/db.js";

// Mock do enrollLead para não depender da fila Redis nos testes de rota
const mockEnrollLead = vi.fn();
vi.mock("../followup/service.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    enrollLead: (...args) => mockEnrollLead(...args),
  };
});

// Import após o mock
const { registerFollowupRoutes } = await import("../followup/routes.js");

const TENANT = "tenant-fup-enroll";
const CAMPAIGN_ID = "camp-fup-001";
const COMPANY_ID = "comp-fup-001";

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
    stage_source text DEFAULT 'manual',
    tags text[] DEFAULT ARRAY[]::text[],
    data_nascimento date,
    dados jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (client_id, telefone)
  );
  CREATE TABLE followup_companies (
    id text PRIMARY KEY,
    tenant_id text NOT NULL,
    name text NOT NULL
  );
  CREATE TABLE followup_campaigns (
    id text PRIMARY KEY,
    company_id text NOT NULL REFERENCES followup_companies(id),
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    default_origin text,
    dispatch_jitter_minutes integer DEFAULT 0
  );
`;

describe("POST /api/followup/campaigns/:id/enroll com seleção por critério", () => {
  let server;
  let baseUrl;
  let db;

  beforeAll(async () => {
    db = await createPgliteDb(SCHEMA);
    await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${TENANT}', 'Tenant Fup')`);
    await db.exec(`INSERT INTO followup_companies (id, tenant_id, name) VALUES ('${COMPANY_ID}', '${TENANT}', 'Empresa Fup')`);
    await db.exec(`INSERT INTO followup_campaigns (id, company_id, name, status) VALUES ('${CAMPAIGN_ID}', '${COMPANY_ID}', 'Cadência Ativa', 'active')`);

    const pool = {
      query: (sql, params) => db.query(sql, params),
      connect: async () => {
        return {
          query: (sql, params) => db.query(sql, params),
          release: () => {},
        };
      },
    };
    _setPoolForTesting(pool);

    const app = express();
    app.use(express.json());

    const noopAuth = (req, _res, next) => {
      req.authAccess = { uid: "user-test", role: "internal", isAdmin: true, clientId: TENANT };
      next();
    };
    const noopPage = () => (_req, _res, next) => next();

    registerFollowupRoutes(app, noopAuth, noopPage, noopPage);

    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    await db?.close();
  });

  beforeEach(async () => {
    await db.exec("DELETE FROM leads");
    mockEnrollLead.mockReset();
    mockEnrollLead.mockResolvedValue({ enqueued: 1, reason: null });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("inscreve leads em lote dinamicamente por critério (sem body.leads)", async () => {
    // Inserir 3 leads com tag 'interessado' e 1 com tag 'outro'
    await db.query(
      `INSERT INTO leads (client_id, telefone, nome, tags) VALUES
        ($1, '11911110001', 'Lead Fup 1', ARRAY['interessado']),
        ($1, '11911110002', 'Lead Fup 2', ARRAY['interessado']),
        ($1, '11911110003', 'Lead Fup 3', ARRAY['interessado']),
        ($1, '11911110004', 'Lead Outro', ARRAY['outro'])`,
      [TENANT]
    );

    const res = await fetch(`${baseUrl}/api/followup/campaigns/${CAMPAIGN_ID}/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        criteria: { tag: "interessado" },
        origin: "banco_dados",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(3);
    expect(body.enrolled).toBe(3);
    expect(body.enqueued).toBe(3);
    expect(mockEnrollLead).toHaveBeenCalledTimes(3);
  });

  it("respeita excludedLeadIds: lead desmarcado como exceção NÃO é inscrito", async () => {
    await db.query(
      `INSERT INTO leads (client_id, telefone, nome, tags) VALUES
        ($1, '11922220001', 'Lead A', ARRAY['alvo_fup']),
        ($1, '11922220002', 'Lead B (Excecao)', ARRAY['alvo_fup']),
        ($1, '11922220003', 'Lead C', ARRAY['alvo_fup'])`,
      [TENANT]
    );

    const { rows } = await db.query(
      `SELECT id, nome FROM leads WHERE client_id = $1 ORDER BY telefone`,
      [TENANT]
    );
    const excecaoId = rows[1].id; // Lead B

    const res = await fetch(`${baseUrl}/api/followup/campaigns/${CAMPAIGN_ID}/enroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        criteria: { tag: "alvo_fup" },
        excludedLeadIds: [excecaoId],
        origin: "banco_dados",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.count).toBe(2);
    expect(body.enrolled).toBe(2);
    expect(mockEnrollLead).toHaveBeenCalledTimes(2);

    // Conferir que Lead B não foi passado para enrollLead
    const enrolledPhones = mockEnrollLead.mock.calls.map((call) => call[1].phone);
    expect(enrolledPhones).not.toContain("11922220002");
    expect(enrolledPhones).toContain("11922220001");
    expect(enrolledPhones).toContain("11922220003");
  });
});
