// Porta do agente que monta campanha (campaign/agentDraft.js).
//
// Express de verdade, Postgres real em memória (pglite), rotas de campanha de produção, resolveAuthorizedClientId de
// produção e requireFirebaseAuth de produção. Nada do código sob teste é dublado: o token vem do ambiente, a
// empresa vem do token, e o rascunho é gravado pelo mesmo handler que a tela usa.
//
// O que tem de ficar provado:
//   1. sem token válido, ninguém entra; token de outro serviço não abre;
//   2. o que o agente cria nasce como rascunho, na empresa do token, e sem nenhum lote;
//   3. agendar, repetir ou pedir outro status é recusado;
//   4. o token do agente NÃO alcança lote, disparo nem agendamento;
//   5. o agente só edita rascunho da própria empresa, e para de editar quando o dono cria um lote.

import express from "express";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";
import { resolveAuthorizedClientId } from "../services/tenant.js";
import { requireCampaignDispatchAccess, requireFirebaseAuth } from "../access/middlewares.js";
import {
  CAMPAIGN_AGENT_TOKENS_ENV,
  parseCampaignAgentTokens,
  registerCampaignAgentLeadImportRoute,
  resolveCampaignAgentTenant,
} from "../campaign/agentDraft.js";

const SLOW = 30_000;
const A = "teste-agente-a";
const B = "teste-agente-b";
const TOKEN_A = "a".repeat(20) + "-token-do-agente-da-empresa-a-0001";
const TOKEN_B = "b".repeat(20) + "-token-do-agente-da-empresa-b-0002";
const TOKEN_RUNNER = "r".repeat(20) + "-segredo-do-agendador-de-lotes-0003";
const TOKEN_TRAFEGO = "t".repeat(20) + "-token-de-leitura-do-trafego-0004";
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");

const BASE_SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.leads_clients (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE public.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    import_id UUID,
    limit_per_run INT,
    webhook_url TEXT,
    webhook_token TEXT,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'paused', 'draft', 'scheduled', 'processing', 'sent', 'failed', 'cancelled', 'archived')),
    scheduled_for TIMESTAMPTZ,
    last_triggered_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    analytics_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    mode TEXT,
    created_by_uid TEXT,
    created_by_email TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    chatbot_prompt_type TEXT NOT NULL DEFAULT 'campanha',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaign_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    scheduled_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'draft',
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    triggered_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });
const normalizeString = (s) => String(s ?? "").trim();

let db = null;
let server = null;
let url = "";
let leadImportBodies = [];
const savedEnv = {};
const ENV_KEYS = [CAMPAIGN_AGENT_TOKENS_ENV, "CAMPAIGN_SCHEDULER_TOKEN", "TRAFFIC_GOCLAW_TOKENS", "GOCLAW_READ_TOKEN", "GOCLAW_GATEWAY_TOKEN"];

function textStep(text = "Olá {{primeiro_nome}}, tudo bem?") {
  return { id: "s1", type: "text", text, order: 1, enabled: true, delayAfterSeconds: 0 };
}

function draftBody(extra = {}) {
  return {
    name: "Campanha montada pelo agente",
    mode: "disparo",
    importId: "__crm__",
    analyticsMeta: {
      sequence: [textStep()],
      dispatchOptions: { minWaitSeconds: 20, maxWaitSeconds: 60 },
    },
    ...extra,
  };
}

async function call(method, path, { token, body } = {}) {
  const resp = await fetch(url + path, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try {
    json = await resp.json();
  } catch {
    json = null;
  }
  return { status: resp.status, json };
}

async function countRows(table) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM ${table}`);
  return rows[0].n;
}

beforeAll(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];

  db = await createPgliteDb(BASE_SCHEMA);
  for (const file of [
    "20260517100000_campaign_prompts.sql",
    "20261008180000_add_recurrence_to_campaigns.sql",
    "20261012120000_campaign_recurrence_occurrences.sql",
  ]) {
    await db.exec(await readFile(join(MIGRATIONS, file), "utf-8"));
  }
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, 'Empresa A'), ($2, 'Empresa B')", [A, B]);

  const pool = {
    query: (text, params) => db.query(text, params),
    connect: async () => ({ query: (text, params) => db.query(text, params), release: () => {} }),
  };
  _setPgDatabasePoolForTesting(pool);
  const supabase = createPgSupabaseClient(pool);

  const app = express();
  app.use(express.json({ limit: "15mb" }));
  registerCampaignsRoutes(app, {
    ensureDb: () => true,
    getCampaignDispatchAccessStatus: async () => ({ allowed: true }),
    getLeadClientEvolutionInstances: async () => [],
    getLeadClientN8nSettings: async () => ({ send_window_enabled: false }),
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    isProduction: false,
    leadsTableName: "leads",
    logCampaignReplyFlow: () => {},
    logDirectDispatch: () => {},
    maskPhoneForLog: (p) => p,
    normalizeIsoDate: (d) => d,
    normalizeString,
    normalizeTenantKey: normalizeString,
    parseOptionalUuid: (s) => ({ value: s }),
    pgDatabasePool: pool,
    requireAppViewAccess: () => (req, res, next) => next(),
    // Autenticação e escopo DE PRODUÇÃO: é contra eles que o token do agente tem de falhar nas rotas de disparo.
    requireCampaignDispatchAccess,
    requireFirebaseAuth,
    requireInternalPageAccess: () => (req, res, next) => next(),
    resolveAuthorizedClientId,
    resolveCampaignDispatchSettings: async () => ({ webhookUrl: null }),
    resolveDispatchWebhookSettings: async () => ({}),
    runDueCampaignDispatches: async () => {},
    sanitizePhone: (p) => p,
    sendError,
    supabase,
    validateN8nInboundBearer: () => true,
  });
  // A importação tem o handler da tela (domains/leads/routes.js); aqui o que se prova é a guarda: o corpo chega ao
  // handler com a empresa do token, qualquer que seja o clientId pedido.
  registerCampaignAgentLeadImportRoute(app, {
    handleCreateLeadImport: (req, res) => {
      leadImportBodies.push(req.body);
      res.status(201).json({ item: { id: "imp-1", client_id: req.body.clientId } });
    },
  });

  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  url = `http://127.0.0.1:${server.address().port}`;
  server.appForTest = app;
}, SLOW);

beforeEach(() => {
  process.env[CAMPAIGN_AGENT_TOKENS_ENV] = `${A}=${TOKEN_A},${B}=${TOKEN_B}`;
  process.env.CAMPAIGN_SCHEDULER_TOKEN = TOKEN_RUNNER;
  process.env.TRAFFIC_GOCLAW_TOKENS = `${A}=${TOKEN_TRAFEGO}`;
  leadImportBodies = [];
});

afterEach(async () => {
  await db.query("DELETE FROM campaign_dispatches");
  await db.query("DELETE FROM campaigns");
  await db.query("DELETE FROM campaign_prompts");
});

afterAll(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  if (server) await new Promise((r) => server.close(r));
  try {
    await db?.close?.();
  } catch {}
});

describe("token do agente de campanha", () => {
  it("lê um token por empresa e ignora token curto ou repetido de outro serviço", () => {
    const env = {
      [CAMPAIGN_AGENT_TOKENS_ENV]: `${A}=${TOKEN_A}, ${B}=curto, outra=${TOKEN_RUNNER}, mais=${TOKEN_TRAFEGO}, =semempresa`,
      CAMPAIGN_SCHEDULER_TOKEN: TOKEN_RUNNER,
      TRAFFIC_GOCLAW_TOKENS: `${A}=${TOKEN_TRAFEGO}`,
    };
    expect(parseCampaignAgentTokens(env)).toEqual([{ clientId: A, token: TOKEN_A }]);
    expect(resolveCampaignAgentTenant(`Bearer ${TOKEN_A}`, env)).toBe(A);
    expect(resolveCampaignAgentTenant(`Bearer ${TOKEN_RUNNER}`, env)).toBeNull();
    expect(resolveCampaignAgentTenant(TOKEN_A, env)).toBeNull();
    expect(resolveCampaignAgentTenant("Bearer ", env)).toBeNull();
  });

  it("sem a variável de ambiente a porta fica fechada", async () => {
    delete process.env[CAMPAIGN_AGENT_TOKENS_ENV];
    const resp = await call("POST", "/api/campaign-agent/drafts", { token: TOKEN_A, body: draftBody() });
    expect(resp.status).toBe(401);
    expect(await countRows("campaigns")).toBe(0);
  }, SLOW);

  it("sem token, com token errado ou com token de outro serviço: 401 e nada gravado", async () => {
    for (const token of [null, "x".repeat(40), TOKEN_RUNNER, TOKEN_TRAFEGO]) {
      const resp = await call("POST", "/api/campaign-agent/drafts", { token, body: draftBody() });
      expect(resp.status).toBe(401);
      expect(resp.json.error.code).toBe("CAMPAIGN_AGENT_TOKEN_INVALID");
    }
    expect(await countRows("campaigns")).toBe(0);
  }, SLOW);
});

describe("o agente cria rascunho, e só rascunho", () => {
  it("campanha nasce como rascunho na empresa do token, sem chip e sem nenhum lote", async () => {
    const resp = await call("POST", "/api/campaign-agent/drafts", { token: TOKEN_A, body: draftBody() });
    expect(resp.status).toBe(201);
    expect(resp.json.item.status).toBe("draft");
    expect(resp.json.item.client_id).toBe(A);

    const { rows } = await db.query("SELECT client_id, status, scheduled_for, is_recurring, created_by_email, analytics_meta FROM campaigns");
    expect(rows).toHaveLength(1);
    expect(rows[0].client_id).toBe(A);
    expect(rows[0].status).toBe("draft");
    expect(rows[0].scheduled_for).toBeNull();
    expect(rows[0].is_recurring).toBe(false);
    expect(rows[0].created_by_email).toBe("agente-campanha");
    expect(rows[0].analytics_meta.sequence[0].text).toContain("{{primeiro_nome}}");
    expect(rows[0].analytics_meta.dispatchOptions.minWaitSeconds).toBe(20);
    expect(rows[0].analytics_meta.createdByAgent.actor).toBe("agente-campanha");
    expect(await countRows("campaign_dispatches")).toBe(0);
  }, SLOW);

  it("imagem, variações do texto, passo após resposta e textos da passagem de bastão ficam gravados", async () => {
    const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const resp = await call("POST", "/api/campaign-agent/drafts", {
      token: TOKEN_A,
      body: draftBody({
        analyticsMeta: {
          sequence: [
            { id: "s1", type: "text", text: "Oi {{nome}}", textVariants: ["Olá {{nome}}", "E aí {{nome}}"], order: 1, enabled: true },
            { id: "s2", type: "image", image: { name: "oferta.png", type: "image/png", size: 68, dataUrl: pixel }, order: 2, enabled: true },
            { id: "s3", type: "text", text: "Posso te mandar os valores?", triggerMode: "after_reply", order: 3, enabled: true },
          ],
          dispatchOptions: {
            replyAgent: "passos",
            handoffEnabled: false,
            handoffOpenerText: "Vou te passar para o especialista.",
            handoffBridgingText: "Oi, sou o especialista.",
          },
        },
      }),
    });
    expect(resp.status).toBe(201);
    const { rows } = await db.query("SELECT analytics_meta FROM campaigns");
    const meta = rows[0].analytics_meta;
    expect(meta.sequence).toHaveLength(3);
    expect(meta.sequence[0].textVariants).toEqual(["Olá {{nome}}", "E aí {{nome}}"]);
    expect(meta.sequence[1].image.dataUrl).toBe(pixel);
    expect(meta.sequence[2].triggerMode).toBe("after_reply");
    expect(meta.dispatchOptions.handoffOpenerText).toBe("Vou te passar para o especialista.");
    expect(meta.dispatchOptions.handoffBridgingText).toBe("Oi, sou o especialista.");
  }, SLOW);

  it("pedir outra empresa no corpo é recusado; a empresa é sempre a do token", async () => {
    const resp = await call("POST", "/api/campaign-agent/drafts", { token: TOKEN_A, body: draftBody({ clientId: B }) });
    expect(resp.status).toBe(403);
    expect(resp.json.error.code).toBe("CAMPAIGN_AGENT_OTHER_TENANT");
    expect(await countRows("campaigns")).toBe(0);
  }, SLOW);

  it("agendar, repetir ou pedir status ativo é recusado, e nada é gravado", async () => {
    const amanha = new Date(Date.now() + 86_400_000).toISOString();
    const tentativas = [
      { scheduledFor: amanha },
      { scheduled_for: amanha },
      { isRecurring: true, recurrencePattern: "weekly", recurrenceDayOfWeek: 1, recurrenceTime: "09:00" },
      { recurrencePattern: "daily" },
      { status: "active" },
      { status: "scheduled" },
      { startsAt: amanha },
      { triggerType: "manual" },
    ];
    for (const extra of tentativas) {
      const resp = await call("POST", "/api/campaign-agent/drafts", { token: TOKEN_A, body: draftBody(extra) });
      expect(resp.status, JSON.stringify(extra)).toBe(400);
      expect(resp.json.error.code).toBe("CAMPAIGN_AGENT_DRAFT_ONLY");
    }
    expect(await countRows("campaigns")).toBe(0);
  }, SLOW);

  it("rascunho sem passo válido é recusado pela mesma validação da tela", async () => {
    const resp = await call("POST", "/api/campaign-agent/drafts", {
      token: TOKEN_A,
      body: draftBody({ analyticsMeta: { sequence: [] } }),
    });
    expect(resp.status).toBe(400);
    expect(resp.json.error.code).toBe("INVALID_CAMPAIGN_CONTENT");
  }, SLOW);

  it("roteiro da campanha é salvo na empresa do token", async () => {
    const outra = await call("PUT", "/api/campaign-agent/prompts", { token: TOKEN_A, body: { clientId: B, name: "Roteiro", content: "x" } });
    expect(outra.status).toBe(403);

    const resp = await call("PUT", "/api/campaign-agent/prompts", { token: TOKEN_A, body: { name: "Roteiro — Oferta", content: "Você é a Bia." } });
    expect(resp.status).toBe(200);
    const { rows } = await db.query("SELECT client_id, name, content, updated_by_email FROM campaign_prompts");
    expect(rows).toEqual([{ client_id: A, name: "Roteiro — Oferta", content: "Você é a Bia.", updated_by_email: "agente-campanha" }]);
  }, SLOW);

  it("base de leads é importada na empresa do token, qualquer que seja o corpo", async () => {
    const outra = await call("POST", "/api/campaign-agent/lead-imports", { token: TOKEN_A, body: { clientId: B, rows: [{ nome: "X" }] } });
    expect(outra.status).toBe(403);
    expect(leadImportBodies).toHaveLength(0);

    const resp = await call("POST", "/api/campaign-agent/lead-imports", {
      token: TOKEN_B,
      body: { client_id: B, sourceName: "base.csv", rows: [{ nome: "Ana", telefone: "34999990000" }] },
    });
    expect(resp.status).toBe(201);
    expect(leadImportBodies).toHaveLength(1);
    expect(leadImportBodies[0].clientId).toBe(B);
    expect(leadImportBodies[0]).not.toHaveProperty("client_id");

    const semToken = await call("POST", "/api/campaign-agent/lead-imports", { body: { rows: [{ nome: "X" }] } });
    expect(semToken.status).toBe(401);
  }, SLOW);
});

describe("o token do agente não alcança disparo", () => {
  it("as únicas rotas que aceitam o token são as cinco de rascunho", () => {
    const rotas = server.appForTest._router.stack
      .filter((layer) => layer.route && String(layer.route.path).startsWith("/api/campaign-agent"))
      .map((layer) => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`)
      .sort();
    expect(rotas).toEqual([
      "GET /api/campaign-agent/drafts/:id",
      "PATCH /api/campaign-agent/drafts/:id",
      "POST /api/campaign-agent/drafts",
      "POST /api/campaign-agent/lead-imports",
      "PUT /api/campaign-agent/prompts",
    ]);
  });

  it("criar lote, disparar lote, disparo direto e as rotas da tela recusam o token do agente", async () => {
    const criada = await call("POST", "/api/campaign-agent/drafts", { token: TOKEN_A, body: draftBody() });
    const id = criada.json.item.id;
    const { rows } = await db.query(
      "INSERT INTO campaign_dispatches (campaign_id, client_id, name, status) VALUES ($1, $2, 'Lote do dono', 'draft') RETURNING id",
      [id, A]
    );
    const loteDoDono = rows[0].id;

    const tentativas = [
      ["POST", `/api/campaigns/${id}/dispatches`, { name: "Lote", triggerType: "manual" }],
      ["POST", `/api/campaigns/${id}/dispatches`, { name: "Lote", triggerType: "scheduled", scheduledAt: new Date(Date.now() + 3_600_000).toISOString() }],
      ["POST", `/api/campaigns/dispatches/${loteDoDono}/trigger`, {}],
      ["POST", `/api/campaigns/dispatches/${loteDoDono}/run-pending`, {}],
      ["POST", `/api/campaigns/dispatches/${loteDoDono}/retry-failed`, {}],
      ["PATCH", `/api/campaigns/dispatches/${loteDoDono}`, { status: "scheduled" }],
      ["POST", `/api/campaigns/${id}/trigger`, {}],
      ["POST", "/api/campaigns/direct-dispatch", { clientId: A }],
      ["POST", "/api/campaigns/run-due", {}],
      ["POST", "/api/campaigns", draftBody({ clientId: A })],
      ["PATCH", `/api/campaigns/${id}`, { status: "active" }],
    ];
    for (const [method, path, body] of tentativas) {
      const resp = await call(method, path, { token: TOKEN_A, body });
      expect(resp.status, `${method} ${path}`).toBeGreaterThanOrEqual(400);
    }

    const depois = await db.query("SELECT status, triggered_at FROM campaign_dispatches");
    expect(depois.rows).toEqual([{ status: "draft", triggered_at: null }]);
    const campanha = await db.query("SELECT status FROM campaigns WHERE id = $1", [id]);
    expect(campanha.rows[0].status).toBe("draft");
  }, SLOW);
});

describe("o agente só edita rascunho", () => {
  it("edita o próprio rascunho e ele continua rascunho", async () => {
    const criada = await call("POST", "/api/campaign-agent/drafts", { token: TOKEN_A, body: draftBody() });
    const id = criada.json.item.id;

    const resp = await call("PATCH", `/api/campaign-agent/drafts/${id}`, {
      token: TOKEN_A,
      body: { name: "Campanha revisada", analyticsMeta: { sequence: [textStep("Texto novo {{nome}}")] } },
    });
    expect(resp.status).toBe(200);

    const { rows } = await db.query("SELECT name, status, analytics_meta FROM campaigns WHERE id = $1", [id]);
    expect(rows[0].name).toBe("Campanha revisada");
    expect(rows[0].status).toBe("draft");
    expect(rows[0].analytics_meta.sequence[0].text).toBe("Texto novo {{nome}}");
    // A edição é um PATCH sobre o salvo: a proteção gravada na criação não some.
    expect(rows[0].analytics_meta.dispatchOptions.minWaitSeconds).toBe(20);

    const lida = await call("GET", `/api/campaign-agent/drafts/${id}`, { token: TOKEN_A });
    expect(lida.status).toBe(200);
    expect(lida.json.item.name).toBe("Campanha revisada");
    expect(lida.json.item).not.toHaveProperty("webhook_token");
  }, SLOW);

  it("editar não aceita agenda, repetição nem troca de status", async () => {
    const criada = await call("POST", "/api/campaign-agent/drafts", { token: TOKEN_A, body: draftBody() });
    const id = criada.json.item.id;
    for (const body of [
      { status: "active" },
      { scheduledFor: new Date(Date.now() + 86_400_000).toISOString() },
      { isRecurring: true, recurrencePattern: "daily", recurrenceTime: "09:00" },
      { archived: true },
    ]) {
      const resp = await call("PATCH", `/api/campaign-agent/drafts/${id}`, { token: TOKEN_A, body });
      expect(resp.status, JSON.stringify(body)).toBe(400);
    }
    const { rows } = await db.query("SELECT status, scheduled_for, is_recurring, archived_at FROM campaigns WHERE id = $1", [id]);
    expect(rows[0]).toEqual({ status: "draft", scheduled_for: null, is_recurring: false, archived_at: null });
  }, SLOW);

  it("rascunho de outra empresa responde 404, igual a campanha que não existe", async () => {
    const criada = await call("POST", "/api/campaign-agent/drafts", { token: TOKEN_A, body: draftBody() });
    const id = criada.json.item.id;
    for (const [method, body] of [["PATCH", { name: "Invadida" }], ["GET", undefined]]) {
      const resp = await call(method, `/api/campaign-agent/drafts/${id}`, { token: TOKEN_B, body });
      expect(resp.status).toBe(404);
    }
    const inexistente = await call("GET", "/api/campaign-agent/drafts/00000000-0000-4000-8000-000000000000", { token: TOKEN_A });
    expect(inexistente.status).toBe(404);
    const { rows } = await db.query("SELECT name FROM campaigns WHERE id = $1", [id]);
    expect(rows[0].name).toBe("Campanha montada pelo agente");
  }, SLOW);

  it("campanha feita na tela (ativa) não é editável pelo agente", async () => {
    const { rows } = await db.query(
      "INSERT INTO campaigns (client_id, name, status, analytics_meta) VALUES ($1, 'Da tela', 'active', $2::jsonb) RETURNING id",
      [A, JSON.stringify({ importSource: "__crm__", sequence: [textStep()] })]
    );
    const resp = await call("PATCH", `/api/campaign-agent/drafts/${rows[0].id}`, { token: TOKEN_A, body: { name: "Mexida" } });
    expect(resp.status).toBe(409);
    expect(resp.json.error.code).toBe("CAMPAIGN_AGENT_NOT_A_DRAFT");
  }, SLOW);

  it("depois que o dono cria um lote, o agente não edita mais", async () => {
    const criada = await call("POST", "/api/campaign-agent/drafts", { token: TOKEN_A, body: draftBody() });
    const id = criada.json.item.id;
    await db.query("INSERT INTO campaign_dispatches (campaign_id, client_id, name, status) VALUES ($1, $2, 'Lote do dono', 'scheduled')", [id, A]);

    const resp = await call("PATCH", `/api/campaign-agent/drafts/${id}`, { token: TOKEN_A, body: { name: "Tarde demais" } });
    expect(resp.status).toBe(409);
    expect(resp.json.error.code).toBe("CAMPAIGN_AGENT_HAS_DISPATCHES");
    const { rows } = await db.query("SELECT name FROM campaigns WHERE id = $1", [id]);
    expect(rows[0].name).toBe("Campanha montada pelo agente");
  }, SLOW);
});
