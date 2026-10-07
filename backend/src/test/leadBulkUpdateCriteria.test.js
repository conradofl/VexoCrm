// backend/src/test/leadBulkUpdateCriteria.test.js
//
// Testes de POST /api/leads/bulk-update com critérios dinâmicos, exclusão de exceções (excludedLeadIds)
// e operações em lote (estágio, tags com addTag e removeTag).

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { sendError } from "../services/httpInfra.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const TENANT = "tenant-bulk-test";
const OUTRO_TENANT = "tenant-outro";

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
    lost_reason text,
    potential_contract_value numeric(14,2),
    temperature text DEFAULT 'warm',
    tags text[] DEFAULT ARRAY[]::text[],
    dados jsonb NOT NULL DEFAULT '{}'::jsonb,
    lead_source text,
    raw_chat_summary text,
    assigned_to text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (client_id, telefone)
  );
`;

describe("POST /api/leads/bulk-update com seleção por critério", () => {
  let server;
  let baseUrl;
  let db;
  let pool;

  beforeAll(async () => {
    db = await createPgliteDb(SCHEMA);
    await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${TENANT}', 'Tenant Bulk'), ('${OUTRO_TENANT}', 'Outro')`);

    pool = {
      query: (sql, params) => db.query(sql, params),
    };
    const supabase = createPgSupabaseClient(pool);

    const app = express();
    app.use(express.json({ limit: "10mb" }));

    registerLeadsRoutes(app, {
      ensureDb: () => true,
      pgDatabasePool: pool,
      supabase,
      requireFirebaseAuth: (req, _res, next) => {
        req.authAccess = { uid: "admin-uid", email: "admin@vexo.com", role: "internal", isAdmin: true, clientId: TENANT };
        next();
      },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      ensureSharedRoutePageAccess: () => true,
      resolveAuthorizedClientId: (_req, res, requested) => {
        const wanted = requested || TENANT;
        if (wanted !== TENANT) {
          sendError(res, 403, "FORBIDDEN", "Sem acesso ao tenant");
          return null;
        }
        return wanted;
      },
      sanitizePhone: (p) => p,
      sendError,
      normalizeString: (s) => (s ? String(s).trim() : ""),
    });

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
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  const post = (path, body) =>
    fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("atualiza dinamicamente por criteria sem passar leadIds", async () => {
    // Insere 5 leads com tag 'campanha-outubro' e 2 sem a tag
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, tags)
      VALUES 
        ('${TENANT}', '5511999990001', 'Lead 1', 'cold', ARRAY['campanha-outubro']),
        ('${TENANT}', '5511999990002', 'Lead 2', 'cold', ARRAY['campanha-outubro']),
        ('${TENANT}', '5511999990003', 'Lead 3', 'cold', ARRAY['campanha-outubro']),
        ('${TENANT}', '5511999990004', 'Lead 4', 'cold', ARRAY['campanha-outubro']),
        ('${TENANT}', '5511999990005', 'Lead 5', 'cold', ARRAY['campanha-outubro']),
        ('${TENANT}', '5511999990006', 'Lead 6', 'cold', ARRAY['outra-tag']),
        ('${TENANT}', '5511999990007', 'Lead 7', 'cold', ARRAY[]::text[]);
    `);

    const res = await post("/api/leads/bulk-update", {
      clientId: TENANT,
      criteria: { tag: "campanha-outubro" },
      updates: { stage: "buyer" },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.updatedCount).toBe(5);

    // Confere no Postgres: exatamente os 5 com a tag viraram buyer
    const { rows: buyers } = await db.query(`SELECT count(*)::int as n FROM leads WHERE client_id = '${TENANT}' AND stage = 'buyer'`);
    expect(buyers[0].n).toBe(5);

    // Os outros 2 continuam cold
    const { rows: cold } = await db.query(`SELECT count(*)::int as n FROM leads WHERE client_id = '${TENANT}' AND stage = 'cold'`);
    expect(cold[0].n).toBe(2);
  });

  it("respeita excludedLeadIds: lead desmarcado como exceção não é alterado", async () => {
    // Insere 4 leads
    const { rows: inserted } = await db.query(`
      INSERT INTO leads (client_id, telefone, nome, stage, tags)
      VALUES 
        ('${TENANT}', '5511999990011', 'Lead A', 'cold', ARRAY['vip']),
        ('${TENANT}', '5511999990012', 'Lead B', 'cold', ARRAY['vip']),
        ('${TENANT}', '5511999990013', 'Lead C', 'cold', ARRAY['vip']),
        ('${TENANT}', '5511999990014', 'Lead D', 'cold', ARRAY['vip'])
      RETURNING id, nome;
    `);

    const excecaoId = inserted.find((r) => r.nome === "Lead C").id;

    // Atualiza com criteria: tag vip, mas excluindo Lead C
    const res = await post("/api/leads/bulk-update", {
      clientId: TENANT,
      criteria: { tag: "vip" },
      excludedLeadIds: [excecaoId],
      updates: { stage: "lost", lost_reason: "preco" },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.updatedCount).toBe(3);

    // Lead C continua 'cold' e sem lost_reason
    const { rows: [leadC] } = await db.query(`SELECT stage, lost_reason FROM leads WHERE id = '${excecaoId}'`);
    expect(leadC.stage).toBe("cold");
    expect(leadC.lost_reason).toBeNull();

    // Os outros 3 viraram 'lost'
    const { rows: lostLeads } = await db.query(`SELECT count(*)::int as n FROM leads WHERE client_id = '${TENANT}' AND stage = 'lost' AND lost_reason = 'preco'`);
    expect(lostLeads[0].n).toBe(3);
  });

  it("remove tag em lote com removeTag preservando as demais tags", async () => {
    await db.exec(`
      INSERT INTO leads (client_id, telefone, nome, stage, tags)
      VALUES 
        ('${TENANT}', '5511999990021', 'Lead T1', 'cold', ARRAY['remover-esta', 'manter-esta']),
        ('${TENANT}', '5511999990022', 'Lead T2', 'cold', ARRAY['remover-esta', 'outra-tag']),
        ('${TENANT}', '5511999990023', 'Lead T3', 'cold', ARRAY['remover-esta']);
    `);

    const res = await post("/api/leads/bulk-update", {
      clientId: TENANT,
      criteria: { tag: "remover-esta" },
      updates: { removeTag: "remover-esta" },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.updatedCount).toBe(3);

    // Nenhum lead tem mais 'remover-esta'
    const { rows: comTagRemover } = await db.query(`SELECT count(*)::int as n FROM leads WHERE client_id = '${TENANT}' AND 'remover-esta' = ANY(tags)`);
    expect(comTagRemover[0].n).toBe(0);

    // Lead T1 ainda tem 'manter-esta'
    const { rows: [t1] } = await db.query(`SELECT tags FROM leads WHERE telefone = '5511999990021'`);
    expect(t1.tags).toEqual(["manter-esta"]);

    // Lead T2 ainda tem 'outra-tag'
    const { rows: [t2] } = await db.query(`SELECT tags FROM leads WHERE telefone = '5511999990022'`);
    expect(t2.tags).toEqual(["outra-tag"]);

    // Lead T3 ficou com array vazio
    const { rows: [t3] } = await db.query(`SELECT tags FROM leads WHERE telefone = '5511999990023'`);
    expect(t3.tags).toEqual([]);
  });

  it("seleção manual com leadIds continua funcionando intacta", async () => {
    const { rows: inserted } = await db.query(`
      INSERT INTO leads (client_id, telefone, nome, stage, tags)
      VALUES 
        ('${TENANT}', '5511999990031', 'Manual 1', 'cold', ARRAY[]::text[]),
        ('${TENANT}', '5511999990032', 'Manual 2', 'cold', ARRAY[]::text[])
      RETURNING id;
    `);

    const res = await post("/api/leads/bulk-update", {
      clientId: TENANT,
      leadIds: [inserted[0].id],
      updates: { stage: "inquiry", addTag: "manual-tag" },
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.updatedCount).toBe(1);

    const { rows: [l1] } = await db.query(`SELECT stage, tags FROM leads WHERE id = '${inserted[0].id}'`);
    expect(l1.stage).toBe("inquiry");
    expect(l1.tags).toContain("manual-tag");

    const { rows: [l2] } = await db.query(`SELECT stage FROM leads WHERE id = '${inserted[1].id}'`);
    expect(l2.stage).toBe("cold");
  });
});
