// backend/src/test/leadBulkDeleteCriteria.test.js
//
// Testes de POST /api/leads/bulk-delete com critérios dinâmicos, respeito a exceções (excludedLeadIds),
// guarda de confirmação digitada (> 500 leads) e controle de acesso (isManagerOrAdmin).

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { sendError } from "../services/httpInfra.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

const TENANT = "tenant-bulk-del-test";
const OUTRO_TENANT = "tenant-del-outro";

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

describe("POST /api/leads/bulk-delete com seleção por critério e travas de segurança", () => {
  let server;
  let baseUrl;
  let db;
  let pool;
  let currentUserRole = "admin"; // pode ser "admin" ou "agent"

  beforeAll(async () => {
    db = await createPgliteDb(SCHEMA);
    await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${TENANT}', 'Tenant Bulk Del'), ('${OUTRO_TENANT}', 'Outro')`);

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
        if (currentUserRole === "admin") {
          req.authAccess = { uid: "admin-uid", email: "admin@vexo.com", role: "internal", isAdmin: true, clientId: TENANT };
        } else {
          // usuário comum (não gestor/admin)
          req.authAccess = { uid: "agent-uid", email: "agent@vexo.com", role: "operator", isAdmin: false, clientId: TENANT };
        }
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
    currentUserRole = "admin";
    await db.exec("DELETE FROM leads");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("bloqueia com 403 se o usuário não for gestor ou admin", async () => {
    currentUserRole = "agent"; // não-admin
    const res = await fetch(`${baseUrl}/api/leads/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: TENANT,
        leadIds: ["00000000-0000-0000-0000-000000000001"],
      }),
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error?.code).toBe("FORBIDDEN");
  });

  it("exclui dinamicamente por criteria sem passar leadIds", async () => {
    // Inserir 3 leads com tag 'descartar' e 2 com tag 'manter'
    await db.query(
      `INSERT INTO leads (client_id, telefone, nome, tags) VALUES
        ($1, '11999990001', 'Lead Descarte 1', ARRAY['descartar']),
        ($1, '11999990002', 'Lead Descarte 2', ARRAY['descartar']),
        ($1, '11999990003', 'Lead Descarte 3', ARRAY['descartar']),
        ($1, '11999990004', 'Lead Manter 1', ARRAY['manter']),
        ($1, '11999990005', 'Lead Manter 2', ARRAY['manter'])`,
      [TENANT]
    );

    const res = await fetch(`${baseUrl}/api/leads/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: TENANT,
        criteria: { tag: "descartar" },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deletedCount).toBe(3);

    // Conferir que sobraram apenas os 2 de tag 'manter'
    const { rows } = await db.query(`SELECT count(*)::int as total FROM leads WHERE client_id = $1`, [TENANT]);
    expect(rows[0].total).toBe(2);
  });

  it("respeita excludedLeadIds: lead desmarcado como exceção NÃO é excluído", async () => {
    await db.query(
      `INSERT INTO leads (client_id, telefone, nome, tags) VALUES
        ($1, '11999990011', 'Lead A', ARRAY['alvo']),
        ($1, '11999990012', 'Lead B (Excecao)', ARRAY['alvo']),
        ($1, '11999990013', 'Lead C', ARRAY['alvo'])`,
      [TENANT]
    );

    const { rows: initial } = await db.query(
      `SELECT id, nome FROM leads WHERE client_id = $1 ORDER BY telefone`,
      [TENANT]
    );
    const excecaoId = initial[1].id; // Lead B

    const res = await fetch(`${baseUrl}/api/leads/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: TENANT,
        criteria: { tag: "alvo" },
        excludedLeadIds: [excecaoId],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.deletedCount).toBe(2);

    // O Lead B deve continuar no banco
    const { rows: remaining } = await db.query(
      `SELECT nome FROM leads WHERE client_id = $1`,
      [TENANT]
    );
    expect(remaining.length).toBe(1);
    expect(remaining[0].nome).toBe("Lead B (Excecao)");
  });

  it("rejeita com 400 se seleção ultrapassar 500 leads e a palavra EXCLUIR estiver ausente ou incorreta", async () => {
    // Gerar 501 leads
    const values = [];
    for (let i = 1; i <= 505; i++) {
      values.push(`('${TENANT}', '1198000${String(i).padStart(4, "0")}', 'Lead ${i}', ARRAY['lote_grande'])`);
    }
    await db.query(`INSERT INTO leads (client_id, telefone, nome, tags) VALUES ${values.join(", ")}`);

    // Tentativa 1: sem confirmation
    const res1 = await fetch(`${baseUrl}/api/leads/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: TENANT,
        criteria: { tag: "lote_grande" },
      }),
    });
    expect(res1.status).toBe(400);
    const body1 = await res1.json();
    expect(body1.error?.code).toBe("CONFIRMATION_REQUIRED");

    // Tentativa 2: confirmation incorreta
    const res2 = await fetch(`${baseUrl}/api/leads/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: TENANT,
        criteria: { tag: "lote_grande" },
        confirmation: "sim",
      }),
    });
    expect(res2.status).toBe(400);
    const body2 = await res2.json();
    expect(body2.error?.code).toBe("CONFIRMATION_REQUIRED");

    // Nenhum foi apagado ainda
    const { rows: countRows } = await db.query(`SELECT count(*)::int as total FROM leads WHERE client_id = $1`, [TENANT]);
    expect(countRows[0].total).toBe(505);

    // Tentativa 3: confirmation correta "EXCLUIR"
    const res3 = await fetch(`${baseUrl}/api/leads/bulk-delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: TENANT,
        criteria: { tag: "lote_grande" },
        confirmation: "EXCLUIR",
      }),
    });
    expect(res3.status).toBe(200);
    const body3 = await res3.json();
    expect(body3.success).toBe(true);
    expect(body3.deletedCount).toBe(505);

    // Todos foram excluídos
    const { rows: afterRows } = await db.query(`SELECT count(*)::int as total FROM leads WHERE client_id = $1`, [TENANT]);
    expect(afterRows[0].total).toBe(0);
  });
});
