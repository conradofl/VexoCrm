// backend/src/test/tenantCreateDefaultTemplate.test.js
//
// Criação de empresa (POST /api/lead-clients): sem chatbotModel no corpo, a empresa nasce com o template de persona
// "generico" — o único caminho agora que o falso campo "Segmentacao da empresa" saiu da tela.
//
// Postgres REAL (pglite) com a rota real. As configurações do tenant (upsertLeadClientN8nSettings) são capturadas: o que
// importa aqui é o chatbot_model que a rota manda gravar.
//
// A tabela de leads é UMA só (leadsTableName devolve "leads") e vem das migrations. Até 26/11/2026 a criação de empresa
// rodava CREATE TABLE/INDEX e ALTER TABLE (colunas extras por schemaType só valiam num banco SEM a tabela, nunca em
// produção); saiu no untangle (DDL de runtime). Agora a rota só confere que a tabela existe.

import express from "express";
import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { normalizeTenantKey } from "../services/tenant.js";

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.leads_clients (id TEXT PRIMARY KEY, name TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE public.campaigns (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE public.leads (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT, telefone TEXT, nome TEXT);
`;

const abertos = [];
afterEach(async () => {
  while (abertos.length) await abertos.pop()();
});

async function servidor() {
  const db = await createPgliteDb(SCHEMA);
  const ddl = [];
  const pool = {
    query: (sql, params) => {
      if (/\b(CREATE TABLE|ALTER TABLE|CREATE (UNIQUE )?INDEX)\b/i.test(String(sql))) ddl.push(String(sql));
      return params && params.length ? db.query(sql, params) : db.exec(sql).then((r) => r[r.length - 1] || { rows: [] });
    },
  };
  const settingsGravados = [];
  const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });
  const app = express();
  app.use(express.json());
  registerLeadsRoutes(app, {
    ensureDb: () => true,
    pgDatabasePool: pool,
    supabase: createPgSupabaseClient(pool),
    requireFirebaseAuth: (req, _res, next) => {
      req.authAccess = { uid: "admin-1", isAdmin: true, role: "internal", permissions: ["tenants.manage"], approvalLevel: "admin" };
      next();
    },
    requireInternalPageAccess: () => (_req, _res, next) => next(),
    requireAppViewAccess: () => (_req, _res, next) => next(),
    ensureSharedRoutePageAccess: () => true,
    resolveAuthorizedClientId: (_req, _res, cid) => cid,
    normalizeString: (s) => (s ? String(s).trim() : ""),
    normalizeTenantKey,
    sendError,
    upsertLeadClientN8nSettings: async (clientId, payload) => {
      settingsGravados.push({ clientId, payload });
      return { client_id: clientId, chatbot_model: payload.chatbotModel };
    },
    maskN8nSettings: (s) => s,
    getN8nOnboardingStatus: () => ({}),
    isDuplicateKeyError: () => false,
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  abertos.push(async () => {
    await new Promise((r) => server.close(r));
    await db.close();
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  const criar = async (body) => {
    const resp = await fetch(`${url}/api/lead-clients`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: resp.status, json: await resp.json() };
  };
  const colunas = async (tabela = "leads") =>
    (await db.query(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY column_name",
      [tabela]
    )).rows.map((r) => r.column_name);
  return { criar, colunas, settingsGravados, ddl };
}

// pglite sobe um Postgres em WASM por banco; com a suíte inteira em paralelo, 5 s não bastam
const SLOW = 60_000;

describe("criação de empresa: template de persona padrão", () => {
  it("[OBRIGATÓRIO] sem chatbotModel no corpo: chatbot_model = 'generico'", async () => {
    const s = await servidor();
    const r = await s.criar({ name: "Condomínio Alfa", id: "condominio-alfa" });
    expect(r.status).toBe(201);
    expect(s.settingsGravados).toHaveLength(1);
    expect(s.settingsGravados[0].payload.chatbotModel).toBe("generico");
  }, SLOW);

  it("o que a tela manda agora (chatbotModel: 'generico') grava 'generico'", async () => {
    const tela = await servidor();
    const r = await tela.criar({ name: "Condomínio Beta", id: "condominio-beta", chatbotModel: "generico" });
    expect(r.status).toBe(201);
    expect(tela.settingsGravados[0].payload.chatbotModel).toBe("generico");
  }, SLOW);

  it("[untangle] criar empresa não roda DDL (a tabela de leads é das migrations) e a tabela fica como estava", async () => {
    const s = await servidor();
    const antes = await s.colunas();
    for (const modelo of ["generico", "outlier", "energia-solar"]) {
      expect((await s.criar({ name: `Empresa ${modelo}`, id: `empresa-${modelo}`, chatbotModel: modelo })).status).toBe(201);
    }
    expect(s.ddl).toEqual([]);
    expect(await s.colunas()).toEqual(antes);
  }, SLOW);
});
