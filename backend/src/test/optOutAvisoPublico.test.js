// backend/src/test/optOutAvisoPublico.test.js
//
// Aviso de opt-out na contagem de público: a lista e o total NÃO mudam (a lista estável é o que mantém a janela e o
// fechamento dos lotes); a resposta só ganha, à parte, quantos dali pediram para sair e serão pulados no envio.
//
// Postgres real (pglite). Dublê só nas claims do token. O aviso do lote (destinatários não processados) está em
// campaignLoteOptOut.test.js, com o lote de verdade.

import express from "express";
import http from "http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { sanitizePhone } from "../services/leadImport.js";
import { countOptedOutPhones, registerOptOut, revokeOptOut } from "../services/optOut.js";

const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations", "20261112010000_lead_optouts_fonte_unica.sql");
const T = "empresa-a";
const OUTRA = "empresa-b";

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.leads_clients (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
    nome TEXT,
    telefone TEXT NOT NULL,
    phone TEXT,
    tags TEXT[] DEFAULT ARRAY[]::text[],
    stage TEXT DEFAULT 'cold',
    temperature TEXT DEFAULT 'warm',
    status TEXT,
    lead_source TEXT,
    opt_out BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    raw_chat_summary TEXT,
    dados JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (client_id, telefone)
  );
  CREATE TABLE public.lead_optouts (id uuid, client_id text, phone text, optout_at timestamptz, reason text);
`;

const abertos = [];
afterAll(async () => {
  for (const db of abertos) await db.close();
});

async function banco({ migrar = true } = {}) {
  const db = await createPgliteDb(SCHEMA);
  abertos.push(db);
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, 'A'), ($2, 'B')", [T, OUTRA]);
  if (migrar) await db.exec(await readFile(MIGRATION, "utf8"));
  const pool = {
    async query(sql, params) {
      if (!params || (Array.isArray(params) && params.length === 0)) return db.exec(sql).then((r) => r[r.length - 1] || { rows: [] });
      return db.query(sql, params);
    },
  };
  return { db, pool };
}

describe("countOptedOutPhones", () => {
  it("[OBRIGATÓRIO] conta só pedido ATIVO, da empresa, por telefone canônico, sem contar o mesmo número duas vezes", async () => {
    const { pool } = await banco();
    await registerOptOut(pool, { clientId: T, phone: "5534991093607", source: "palavra" });
    await registerOptOut(pool, { clientId: T, phone: "5534988880001", source: "sem_interesse" });
    await registerOptOut(pool, { clientId: T, phone: "5534977770002", source: "manual" });
    await revokeOptOut(pool, { clientId: T, phone: "5534977770002" }); // revogado não conta
    await registerOptOut(pool, { clientId: OUTRA, phone: "5534966660003", source: "palavra" }); // outra empresa não conta

    const n = await countOptedOutPhones(pool, {
      clientId: T,
      phones: ["34991093607", "(34) 99109-3607", "553488880001", "5534977770002", "5534966660003", "5534955550004", null, ""],
    });
    expect(n).toBe(2);
    expect(await countOptedOutPhones(pool, { clientId: T, phones: [] })).toBe(0);
    expect(await countOptedOutPhones(pool, { clientId: T, phones: ["5534955550004"] })).toBe(0);
  });

  it("não sabe = null, nunca zero: schema velho e erro de leitura", async () => {
    const velho = await banco({ migrar: false });
    expect(await countOptedOutPhones(velho.pool, { clientId: T, phones: ["5534991093607"] })).toBeNull();

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const quebrado = { query: async () => { throw new Error("connection terminated unexpectedly"); } };
    expect(await countOptedOutPhones(quebrado, { clientId: T, phones: ["5534991093607"] })).toBeNull();
    errSpy.mockRestore();
  });
});

describe("POST /api/leads/audience: total e lista iguais, aviso à parte", () => {
  let server;
  let baseUrl;
  let w;

  async function subir({ migrar = true } = {}) {
    w = await banco({ migrar });
    for (const [fone, nome] of [["5534991093607", "Ana"], ["34988880001", "Bia"], ["5534977770002", "Caio"]]) {
      await w.db.query("INSERT INTO leads (client_id, telefone, nome, stage, tags) VALUES ($1, $2, $3, 'buyer', ARRAY['promo'])", [T, fone, nome]);
    }
    const app = express();
    app.use(express.json());
    const sendError = (res, status, code, message, details) => res.status(status).json({ error: { code, message, details } });
    registerLeadsRoutes(app, {
      ensureDb: () => true,
      pgDatabasePool: w.pool,
      supabase: { from: () => ({ select: () => ({}) }) },
      requireFirebaseAuth: (req, _res, next) => {
        req.authAccess = { uid: "u", role: "internal", isAdmin: true, clientId: T };
        next();
      },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      ensureSharedRoutePageAccess: () => true,
      resolveAuthorizedClientId: (_req, _res, cid) => cid || T,
      sanitizePhone: (p, ddd) => sanitizePhone(p, ddd),
      sendError,
      normalizeString: (s) => (s ? String(s).trim() : ""),
    });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;
  }
  const publico = async () => {
    const res = await fetch(`${baseUrl}/api/leads/audience`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: T, stages: ["buyer"], tags: ["promo"] }),
    });
    expect(res.status).toBe(200);
    return res.json();
  };
  beforeEach(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    server = null;
  });
  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  it("[OBRIGATÓRIO] com 2 dos 3 em opt-out: total continua 3, os 3 seguem na lista, e optedOut = 2", async () => {
    await subir();
    const antes = await publico();
    expect(antes).toMatchObject({ total: 3, optedOut: 0 });

    await registerOptOut(w.pool, { clientId: T, phone: "5534991093607", source: "palavra" });
    await registerOptOut(w.pool, { clientId: T, phone: "5534988880001", source: "sem_interesse" }); // lead gravado sem 55

    const depois = await publico();
    expect(depois.total).toBe(3);
    expect(depois.items.map((i) => i.nome).sort()).toEqual(["Ana", "Bia", "Caio"]);
    expect(depois.optedOut).toBe(2);
  });

  it("schema velho: o público responde igual e o aviso vem null (a tela não mostra número que não sabe)", async () => {
    await subir({ migrar: false });
    const body = await publico();
    expect(body.total).toBe(3);
    expect(body.optedOut).toBeNull();
  });
});
