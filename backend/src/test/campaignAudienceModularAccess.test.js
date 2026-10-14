// backend/src/test/campaignAudienceModularAccess.test.js
//
// Teste obrigatório de alinhamento de permissão:
// A rota /api/leads/audience deve aceitar clientes cujo plano modular possui
// acesso a "campanhas", mesmo sem o módulo "banco-de-dados" contratado.
// Garante paridade com /api/leads/ids (requireBancoDeDadosOrCampanhas).

import express from "express";
import http from "http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { sanitizePhone } from "../services/leadImport.js";

const CLIENT_ID = "tenant-campanhas-only";

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE IF NOT EXISTS public.leads_clients (
    id TEXT PRIMARY KEY,
    name TEXT
  );
  CREATE TABLE IF NOT EXISTS public.leads (
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
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    raw_chat_summary TEXT,
    dados JSONB NOT NULL DEFAULT '{}'::jsonb,
    UNIQUE (client_id, telefone)
  );
`;

describe("alinhamento de permissão /api/leads/audience (requireBancoDeDadosOrCampanhas)", () => {
  let db;
  let pool;
  let server;
  let baseUrl;
  let currentAuthAccess = null;

  beforeAll(async () => {
    db = await createPgliteDb();
    await db.exec(SCHEMA);
    await db.query(`INSERT INTO public.leads_clients (id, name) VALUES ($1, $2)`, [CLIENT_ID, "Tenant Modular"]);
    await db.query(
      `INSERT INTO public.leads (client_id, telefone, nome, stage, tags) VALUES ($1, $2, $3, $4, $5)`,
      [CLIENT_ID, "5511999990001", "Lead Campanha", "buyer", ["promo"]]
    );

    pool = {
      async query(sql, params) {
        if (!params || (Array.isArray(params) && params.length === 0)) {
          return db.exec(sql);
        }
        return db.query(sql, params);
      },
    };

    const app = express();
    app.use(express.json());

    const sendError = (res, status, code, message, details) =>
      res.status(status).json({ error: { code, message, details } });

    registerLeadsRoutes(app, {
      ensureDb: () => true,
      pgDatabasePool: pool,
      supabase: { from: () => ({ select: () => ({}) }) },
      requireFirebaseAuth: (req, _res, next) => {
        req.authAccess = currentAuthAccess;
        next();
      },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      ensureSharedRoutePageAccess: () => true,
      resolveAuthorizedClientId: (_req, res, cid) => {
        if (cid && cid !== CLIENT_ID) {
          sendError(res, 403, "FORBIDDEN", "Sem acesso a este cliente");
          return null;
        }
        return cid || CLIENT_ID;
      },
      sanitizePhone: (p, ddd) => sanitizePhone(p, ddd),
      sendError,
      normalizeString: (s) => (s ? String(s).trim() : ""),
    });

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db?.close();
  });

  beforeEach(() => {
    currentAuthAccess = null;
  });

  it("requisição a /api/leads/audience com acesso SÓ a campanhas responde 200 e não 403", async () => {
    currentAuthAccess = {
      uid: "user-campanhas-only",
      email: "gestor@campanhas.com",
      role: "internal",
      isAdmin: false,
      clientId: CLIENT_ID,
      planTier: "modular",
      internalPages: ["campanhas"], // SÓ campanhas! Sem "banco-de-dados"
    };

    const res = await fetch(`${baseUrl}/api/leads/audience`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: CLIENT_ID,
        stages: ["buyer"],
        tags: ["promo"],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].nome).toBe("Lead Campanha");
  });

  it("requisição a /api/leads/audience com acesso SÓ a banco-de-dados também responde 200", async () => {
    currentAuthAccess = {
      uid: "user-banco-only",
      email: "gestor@banco.com",
      role: "internal",
      isAdmin: false,
      clientId: CLIENT_ID,
      planTier: "modular",
      internalPages: ["banco-de-dados"], // SÓ banco-de-dados
    };

    const res = await fetch(`${baseUrl}/api/leads/audience`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: CLIENT_ID,
        stages: ["buyer"],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(1);
  });

  it("requisição a /api/leads/audience sem banco-de-dados e sem campanhas responde 403", async () => {
    currentAuthAccess = {
      uid: "user-whatsapp-only",
      email: "operador@whatsapp.com",
      role: "internal",
      isAdmin: false,
      clientId: CLIENT_ID,
      planTier: "modular",
      internalPages: ["whatsapp"], // Sem banco-de-dados e sem campanhas
    };

    const res = await fetch(`${baseUrl}/api/leads/audience`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: CLIENT_ID,
        stages: ["buyer"],
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error?.code).toBe("FORBIDDEN");
  });
});
