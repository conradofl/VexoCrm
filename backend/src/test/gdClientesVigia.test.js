import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import {
  GD_DONO,
  registerGdClientesRoutes,
  requireGoclawReadToken,
} from "../domains/gdClientes/routes.js";

const MIGRATION = readFileSync(
  resolve("supabase/migrations/20261102120000_create_gd_estados_clientes.sql"),
  "utf8"
);
const MIGRATION_CAMPOS = readFileSync(
  resolve("supabase/migrations/20261103120000_gd_clientes_aprovador_drive_escopo.sql"),
  "utf8"
);
const MIGRATION_TRILHA = readFileSync(
  resolve("supabase/migrations/20261103180000_gd_estados_acao_rotulo_portal.sql"),
  "utf8"
);

const TOKEN_TESTE = "goclaw-secret-token-teste-12345";

let db;
let server;
let base;

function poolDe(pg) {
  const query = async (sql, params) => pg.query(sql, params);
  const client = { query, release() {} };
  return { query, connect: async () => client };
}

async function chamarVigia(tokenHeader) {
  const headers = {};
  if (tokenHeader !== undefined) {
    headers["Authorization"] = tokenHeader;
  }
  const res = await fetch(`${base}/api/gd/clientes/vigia`, {
    method: "GET",
    headers,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

beforeAll(async () => {
  db = await createPgliteDb(`
    SET TimeZone = 'UTC';
    CREATE TABLE public.leads_clients (id text PRIMARY KEY, name text NOT NULL);
    INSERT INTO public.leads_clients VALUES ('geracao-digital', 'Geração Digital'), ('outro-tenant', 'Outro');
  `);
  await db.exec(MIGRATION);
  await db.exec(MIGRATION_CAMPOS);
  await db.exec(MIGRATION_TRILHA);

  // Inserção de dados de teste: clientes da GD e cliente de outro tenant
  await db.exec(`
    INSERT INTO public.gd_clientes (id, dono_client_id, nome, origem)
    VALUES
      ('11111111-1111-1111-1111-111111111111', 'geracao-digital', 'Empresa Alfa', 'fluxo'),
      ('22222222-2222-2222-2222-222222222222', 'geracao-digital', 'Empresa Beta', 'fluxo'),
      ('33333333-3333-3333-3333-333333333333', 'outro-tenant', 'Empresa Outro Tenant', 'fluxo');

    SELECT public.gd_registrar_evento('11111111-1111-1111-1111-111111111111', 'PROPOSTA_ENVIADA', '2026-11-01T10:00:00Z', false, 'fluxo', 'sistema', 'seed-1', 'Inicial');
    SELECT public.gd_registrar_evento('22222222-2222-2222-2222-222222222222', 'BRIEFING_AGENDADO', '2026-11-02T14:30:00Z', false, 'fluxo', 'sistema', 'seed-2', 'Inicial');
  `);

  const app = express();
  app.use(express.json());
  registerGdClientesRoutes(app, {
    getPool: () => poolDe(db),
  });
  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  base = `http://localhost:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.close();
});

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("middleware: requireGoclawReadToken", () => {
  it("chama next() quando token bate exatamente com GOCLAW_READ_TOKEN", () => {
    process.env.GOCLAW_READ_TOKEN = "token-segredo-abc";
    const req = { headers: { authorization: "Bearer token-segredo-abc" } };
    let jsonStatus = null;
    let jsonPayload = null;
    let nextChamado = false;
    const res = {
      status(s) { jsonStatus = s; return this; },
      json(p) { jsonPayload = p; return this; },
    };
    requireGoclawReadToken(req, res, () => { nextChamado = true; });

    expect(nextChamado).toBe(true);
    expect(jsonStatus).toBeNull();
    expect(jsonPayload).toBeNull();
  });

  it("responde 401 se GOCLAW_READ_TOKEN for undefined", () => {
    delete process.env.GOCLAW_READ_TOKEN;
    const req = { headers: { authorization: "Bearer token-qualquer" } };
    let jsonStatus = null;
    let jsonPayload = null;
    let nextChamado = false;
    const res = {
      status(s) { jsonStatus = s; return this; },
      json(p) { jsonPayload = p; return this; },
    };
    requireGoclawReadToken(req, res, () => { nextChamado = true; });

    expect(nextChamado).toBe(false);
    expect(jsonStatus).toBe(401);
    expect(jsonPayload).toEqual({ error: "Token de acesso do GoClaw inválido ou não configurado." });
  });

  it("responde 401 se token enviado for menor ou maior que o esperado", () => {
    process.env.GOCLAW_READ_TOKEN = "tamanho-exato-16";
    const req = { headers: { authorization: "Bearer tamanho-diferente" } };
    let jsonStatus = null;
    let jsonPayload = null;
    const res = {
      status(s) { jsonStatus = s; return this; },
      json(p) { jsonPayload = p; return this; },
    };
    requireGoclawReadToken(req, res, () => {});

    expect(jsonStatus).toBe(401);
    expect(jsonPayload).toEqual({ error: "Token de acesso do GoClaw inválido ou não configurado." });
  });
});

describe("endpoint: GET /api/gd/clientes/vigia", () => {
  it("a) requisição sem header de autorização -> devolve 401", async () => {
    process.env.GOCLAW_READ_TOKEN = TOKEN_TESTE;
    const res = await chamarVigia(undefined);
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "Token de acesso do GoClaw inválido ou não configurado." });
  });

  it("b) requisição com token incorreto -> devolve 401", async () => {
    process.env.GOCLAW_READ_TOKEN = TOKEN_TESTE;
    const res = await chamarVigia("Bearer token-totalmente-errado");
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "Token de acesso do GoClaw inválido ou não configurado." });
  });

  it("b2) requisição com header de formato inválido (sem Bearer) -> devolve 401", async () => {
    process.env.GOCLAW_READ_TOKEN = TOKEN_TESTE;
    const res = await chamarVigia(`Basic ${TOKEN_TESTE}`);
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "Token de acesso do GoClaw inválido ou não configurado." });
  });

  it("d) comportamento quando a env GOCLAW_READ_TOKEN não existe -> devolve 401 seguro sem quebrar", async () => {
    delete process.env.GOCLAW_READ_TOKEN;
    const res = await chamarVigia(`Bearer ${TOKEN_TESTE}`);
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "Token de acesso do GoClaw inválido ou não configurado." });
  });

  it("c) requisição com token correto -> devolve 200 e a estrutura esperada", async () => {
    process.env.GOCLAW_READ_TOKEN = TOKEN_TESTE;
    const res = await chamarVigia(`Bearer ${TOKEN_TESTE}`);
    expect(res.status).toBe(200);
    expect(res.json).toHaveProperty("clientes");
    expect(Array.isArray(res.json.clientes)).toBe(true);
    expect(res.json.clientes.length).toBe(2);

    // Garante que só clientes da GD (dono_client_id = geracao-digital) são retornados
    const empresas = res.json.clientes.map((c) => c.nome_empresa);
    expect(empresas).toContain("Empresa Alfa");
    expect(empresas).toContain("Empresa Beta");
    expect(empresas).not.toContain("Empresa Outro Tenant");

    // Valida formato dos campos especificados
    const clienteBeta = res.json.clientes.find((c) => c.nome_empresa === "Empresa Beta");
    expect(clienteBeta).toEqual({
      id: "22222222-2222-2222-2222-222222222222",
      nome_empresa: "Empresa Beta",
      estado_atual: "BRIEFING_AGENDADO",
      fase: "entrada",
      ordem: 80,
      entrou_em: "2026-11-02T14:30:00.000Z",
    });

    const clienteAlfa = res.json.clientes.find((c) => c.nome_empresa === "Empresa Alfa");
    expect(clienteAlfa).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      nome_empresa: "Empresa Alfa",
      estado_atual: "PROPOSTA_ENVIADA",
      fase: "comercial",
      ordem: 10,
      entrou_em: "2026-11-01T10:00:00.000Z",
    });
  });

  it("rotas regulares continuam protegidas contra acesso sem credencial Firebase", async () => {
    process.env.GOCLAW_READ_TOKEN = TOKEN_TESTE;
    // Sem Authorization
    const resSemAuth = await fetch(`${base}/api/gd/clientes`, { method: "GET" });
    expect(resSemAuth.status).toBe(401);

    // Com o token do GoClaw em vez de credencial Firebase
    const resComGoclaw = await fetch(`${base}/api/gd/clientes`, {
      method: "GET",
      headers: { Authorization: `Bearer ${TOKEN_TESTE}` },
    });
    // Não pode dar 200 de sucesso
    expect(resComGoclaw.status).not.toBe(200);
  });
});
