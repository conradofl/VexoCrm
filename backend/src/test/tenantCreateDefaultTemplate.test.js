// backend/src/test/tenantCreateDefaultTemplate.test.js
//
// Criação de empresa (POST /api/lead-clients): sem chatbotModel no corpo, a empresa nasce com o template de persona
// "generico" — o único caminho agora que o falso campo "Segmentacao da empresa" saiu da tela.
//
// Postgres REAL (pglite) para a DDL da tabela de leads (ensureLeadClientTable de verdade). As configurações do tenant
// (upsertLeadClientN8nSettings) são capturadas: o que importa aqui é o chatbot_model que a rota manda gravar.
//
// Também trava o motivo de a troca ser segura: a tabela de leads é UMA só (leadsTableName devolve "leads") e nasce com
// CREATE TABLE IF NOT EXISTS; o schemaType só escolhe colunas extras se ela ainda não existir, e lead-client-tables.js
// só distingue outlier, infinie e generico — o antigo padrão "energia-solar" já caía no genérico.
// Cada teste usa um banco novo: a primeira empresa criada é a que cria a tabela.

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
`;

const abertos = [];
afterEach(async () => {
  while (abertos.length) await abertos.pop()();
});

async function servidor() {
  const db = await createPgliteDb(SCHEMA);
  const pool = { query: (sql, params) => (params && params.length ? db.query(sql, params) : db.exec(sql).then((r) => r[r.length - 1] || { rows: [] })) };
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
  return { criar, colunas, settingsGravados };
}

// pglite sobe um Postgres em WASM por banco; com a suíte inteira em paralelo, 5 s não bastam
const SLOW = 60_000;

const COLUNAS_GENERICO = ["interesse", "objetivo", "prazo", "melhor_horario"];
const COLUNAS_SO_DE_OUTROS_SCHEMAS = ["credito", "parcela", "lance_entrada_fgts", "tipo_instalacao", "conta_luz_faixa"];

describe("criação de empresa: template de persona padrão", () => {
  it("[OBRIGATÓRIO] sem chatbotModel no corpo: chatbot_model = 'generico' e tabela de leads com o schema genérico", async () => {
    const s = await servidor();

    const r = await s.criar({ name: "Condomínio Alfa", id: "condominio-alfa" });

    expect(r.status).toBe(201);
    expect(s.settingsGravados).toHaveLength(1);
    expect(s.settingsGravados[0].payload.chatbotModel).toBe("generico");
    const cols = await s.colunas();
    expect(cols.length).toBeGreaterThan(10); // a tabela existe de fato
    for (const c of COLUNAS_GENERICO) expect(cols).toContain(c);
    for (const c of COLUNAS_SO_DE_OUTROS_SCHEMAS) expect(cols).not.toContain(c);
  }, SLOW);

  it("o que a tela manda agora (chatbotModel: 'generico') grava 'generico' e dá a mesma tabela", async () => {
    const tela = await servidor();
    const semCampo = await servidor();

    const r = await tela.criar({ name: "Condomínio Beta", id: "condominio-beta", chatbotModel: "generico" });
    await semCampo.criar({ name: "Condomínio Gama", id: "condominio-gama" });

    expect(r.status).toBe(201);
    expect(tela.settingsGravados[0].payload.chatbotModel).toBe("generico");
    const cols = await tela.colunas();
    expect(cols.length).toBeGreaterThan(10);
    expect(cols).toEqual(await semCampo.colunas());
  }, SLOW);

  it("prova de segurança: o antigo padrão 'energia-solar' (template inexistente) já criava a MESMA tabela genérica", async () => {
    const antiga = await servidor();
    const nova = await servidor();

    await antiga.criar({ name: "Solar Antiga", id: "solar-antiga", chatbotModel: "energia-solar" });
    await nova.criar({ name: "Nova Generica", id: "nova-generica", chatbotModel: "generico" });

    const cols = await antiga.colunas();
    expect(cols.length).toBeGreaterThan(10);
    expect(cols).toEqual(await nova.colunas());
  }, SLOW);

  it("controle: um schema que existe de verdade (outlier) cria colunas diferentes — a comparação acima não é vazia", async () => {
    const outlier = await servidor();
    const generico = await servidor();
    await outlier.criar({ name: "Outlier Teste", id: "outlier-teste", chatbotModel: "outlier" });
    await generico.criar({ name: "Generico Teste", id: "generico-teste" });

    expect(await outlier.colunas()).toContain("credito");
    expect(await outlier.colunas()).not.toEqual(await generico.colunas());
  }, SLOW);
});
