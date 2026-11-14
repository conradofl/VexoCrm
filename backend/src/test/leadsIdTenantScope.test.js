// backend/src/test/leadsIdTenantScope.test.js
//
// PATCH e DELETE em /api/leads/:id conferem a empresa do lead.
//
// Até 11/11/2026 as duas rotas só exigiam login e filtravam por id: um usuário da empresa A que soubesse o id de um lead da
// empresa B conseguia alterar (inclusive ligar o opt-out) e apagar. A empresa agora vem do próprio lead, lida no banco, e passa
// pelo mesmo resolveAuthorizedClientId das rotas vizinhas.
//
// O resolveAuthorizedClientId aqui é o REAL (services/tenant.js). Dublê só no que vem de fora do processo: as claims do token.

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { sendError } from "../services/httpInfra.js";
import { resolveAuthorizedClientId } from "../services/tenant.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");

const A = "empresa-a";
const B = "empresa-b";
const ID_INEXISTENTE = "00000000-0000-4000-8000-000000000999";

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
    metadata jsonb DEFAULT '{}'::jsonb,
    opt_out boolean DEFAULT false,
    assigned_to text,
    assigned_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (client_id, telefone)
  );
`;

const CLAIMS = {
  usuarioA: { uid: "u-a", role: "client", scopeMode: "assigned_clients", clientId: A, clientIds: [A] },
  internoSoA: { uid: "i-a", role: "internal", scopeMode: "assigned_clients", clientId: A, clientIds: [A] },
  admin: { uid: "adm", role: "internal", isAdmin: true, scopeMode: "all_clients", clientId: A, clientIds: [] },
};

describe("PATCH e DELETE /api/leads/:id conferem a empresa do lead", () => {
  let server;
  let baseUrl;
  let db;
  let claims = CLAIMS.usuarioA;
  let leadA;
  let leadB;

  const call = (method, id, body) =>
    fetch(`${baseUrl}/api/leads/${id}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });

  const lerLead = async (id) => (await db.query("SELECT * FROM leads WHERE id = $1", [id])).rows[0] || null;

  beforeAll(async () => {
    db = await createPgliteDb(SCHEMA);
    // O interruptor de opt-out grava na fonte única (lead_optouts), criada por esta migration.
    await db.exec(await readFile(join(MIGRATIONS, "20261112010000_lead_optouts_fonte_unica.sql"), "utf8"));
    await db.exec(`INSERT INTO leads_clients (id, name) VALUES ('${A}', 'Empresa A'), ('${B}', 'Empresa B')`);
    const pool = { query: (sql, params) => db.query(sql, params) };

    const app = express();
    app.use(express.json());
    registerLeadsRoutes(app, {
      ensureDb: () => true,
      pgDatabasePool: pool,
      supabase: createPgSupabaseClient(pool),
      requireFirebaseAuth: (req, _res, next) => {
        req.authAccess = claims;
        next();
      },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      ensureSharedRoutePageAccess: () => true,
      resolveAuthorizedClientId,
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
    claims = CLAIMS.usuarioA;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    await db.exec("DELETE FROM leads; DELETE FROM lead_optouts;");
    const ins = (cid, fone, nome) =>
      db.query("INSERT INTO leads (client_id, telefone, nome, tags) VALUES ($1, $2, $3, ARRAY['original']) RETURNING id", [cid, fone, nome]);
    leadA = (await ins(A, "5534990000001", "Lead da A")).rows[0].id;
    leadB = (await ins(B, "5534990000002", "Lead da B")).rows[0].id;
  });

  it("[OBRIGATÓRIO] usuário da empresa A NÃO altera lead da empresa B: 403 e nenhum campo muda", async () => {
    const res = await call("PATCH", leadB, {
      nome: "Invadido",
      opt_out: true,
      tags: ["invadido"],
      campos: { x: "1" },
      metadata: { opt_out: "true" },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error?.code).toBe("FORBIDDEN_CLIENT_SCOPE");

    const depois = await lerLead(leadB);
    expect(depois.nome).toBe("Lead da B");
    expect(depois.opt_out).toBe(false);
    expect(depois.metadata).toEqual({});
    expect(depois.tags).toEqual(["original"]);
    expect(depois.dados).toEqual({});
    expect((await db.query("SELECT count(*)::int AS n FROM lead_optouts")).rows[0].n).toBe(0);
  });

  it("[OBRIGATÓRIO] usuário da empresa A NÃO apaga lead da empresa B: 403 e o lead continua lá", async () => {
    const res = await call("DELETE", leadB);
    expect(res.status).toBe(403);
    expect((await res.json()).error?.code).toBe("FORBIDDEN_CLIENT_SCOPE");
    expect(await lerLead(leadB)).not.toBeNull();
  });

  it("interno com acesso só à empresa A também é barrado na empresa B (PATCH e DELETE)", async () => {
    claims = CLAIMS.internoSoA;
    expect((await call("PATCH", leadB, { nome: "Invadido" })).status).toBe(403);
    expect((await call("DELETE", leadB)).status).toBe(403);
    expect((await lerLead(leadB)).nome).toBe("Lead da B");
  });

  it("usuário da empresa A altera o próprio lead, inclusive opt-out, tags e campos", async () => {
    const res = await call("PATCH", leadA, { nome: "Novo nome", opt_out: true, tags: ["vip"], campos: { cor: "azul" } });
    expect(res.status).toBe(200);
    const depois = await lerLead(leadA);
    expect(depois.nome).toBe("Novo nome");
    expect(depois.opt_out).toBe(true);
    expect(depois.metadata.opt_out).toBe("true");
    expect(depois.tags).toEqual(["vip"]);
    expect(depois.dados.campos).toEqual({ cor: "azul" });
  });

  it("usuário da empresa A apaga o próprio lead", async () => {
    const res = await call("DELETE", leadA);
    expect(res.status).toBe(200);
    expect(await lerLead(leadA)).toBeNull();
    expect(await lerLead(leadB)).not.toBeNull();
  });

  it("admin continua alterando e apagando lead de qualquer empresa", async () => {
    claims = CLAIMS.admin;
    expect((await call("PATCH", leadB, { nome: "Pelo admin" })).status).toBe(200);
    expect((await lerLead(leadB)).nome).toBe("Pelo admin");
    expect((await call("DELETE", leadB)).status).toBe(200);
    expect(await lerLead(leadB)).toBeNull();
  });

  it("id que não existe responde 404 nas duas rotas, e id malformado não vira 500", async () => {
    expect((await call("PATCH", ID_INEXISTENTE, { nome: "x" })).status).toBe(404);
    expect((await call("DELETE", ID_INEXISTENTE)).status).toBe(404);
    expect((await call("PATCH", "nao-e-uuid", { nome: "x" })).status).toBe(404);
    expect((await call("DELETE", "nao-e-uuid")).status).toBe(404);
  });
});
