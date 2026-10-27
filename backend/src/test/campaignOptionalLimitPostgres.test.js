// backend/src/test/campaignOptionalLimitPostgres.test.js
//
// SPEC 17 — o limite de envio é do LOTE, não o "50" padrão da campanha.
// Antes: campanha sem lotes, 120 leads, campaigns.limit_per_run = 50 → o lote nascia com target_count 120 (público
// inteiro), mas o envio usava `dispatch.limit_per_run ?? campaign.limit_per_run` e mandava só 50 ("Interrompido: 70
// pendentes"). Agora lote sem fatia cobre o público inteiro; lote em fatia e o limite opcional continuam valendo.
//
// Postgres REAL (pglite), rotas reais (criação do lote, run-pending, agendador) e envio capturado no fetch.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { buildDispatchLeads } from "../campaign/dispatch.js";
import { recoverOrphanDispatches } from "../campaign/orphanRecovery.js";

const SLOW = 120_000;
const T = "tenant-retomada";
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");
const SEQ = [{ id: "s1", type: "text", text: "Oi {{nome}}", order: 1, enabled: true, delayAfterSeconds: 0 }];

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.leads_clients (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, telefone TEXT, nome TEXT, tipo_cliente TEXT,
    faixa_consumo TEXT, qualificacao TEXT, cidade TEXT, estado TEXT, status TEXT, opt_out BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb, dados JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, name TEXT NOT NULL, import_id UUID,
    limit_per_run INT, webhook_url TEXT, webhook_token TEXT, status TEXT NOT NULL DEFAULT 'active', scheduled_for TIMESTAMPTZ,
    last_triggered_at TIMESTAMPTZ, archived_at TIMESTAMPTZ, analytics_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    campaign_prompt_id UUID, mode TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaign_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id UUID NOT NULL, client_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
    steps JSONB NOT NULL DEFAULT '[]'::jsonb, trigger_type TEXT NOT NULL DEFAULT 'manual', scheduled_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'draft', sent_count INT NOT NULL DEFAULT 0, failed_count INT NOT NULL DEFAULT 0,
    target_count INT, triggered_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, error_message TEXT, limit_per_run INT, "offset" INT,
    campaign_prompt_id UUID, evolution_instance_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaign_dispatch_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_id UUID NOT NULL, campaign_id UUID NOT NULL, client_id TEXT NOT NULL,
    phone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error_message TEXT, sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lead_id UUID, claimed_at TIMESTAMPTZ, lead_import_item_id UUID, evolution_instance_id UUID
  );
  CREATE UNIQUE INDEX uq_campaign_dispatch_runs_dispatch_lead ON public.campaign_dispatch_runs (dispatch_id, lead_id);
`;

let intervalSpy;
beforeAll(() => {
  intervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(() => ({ unref() {}, ref() {} }));
});
afterAll(() => {
  intervalSpy.mockRestore();
  _setPgDatabasePoolForTesting(null);
});

let fetchOriginal;
let timeoutOriginal;
let enviados;
let logSpy;
let errorSpy;
beforeEach(() => {
  enviados = [];
  fetchOriginal = globalThis.fetch;
  timeoutOriginal = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => timeoutOriginal(fn, ms >= 1000 ? 0 : ms, ...args);
  globalThis.fetch = vi.fn(async (url, init) => {
    if (/sendText/.test(String(url))) {
      enviados.push(String(JSON.parse(init?.body || "{}").number || ""));
      return { ok: true, status: 200, json: async () => ({ key: { id: "wa" } }), text: async () => '{"key":{"id":"wa"}}' };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
  });
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  globalThis.setTimeout = timeoutOriginal;
  logSpy.mockRestore();
  errorSpy.mockRestore();
});

const abertos = [];
afterAll(async () => {
  for (const db of abertos) await db.close();
});

// A query de contagem de runs do fechamento do lote (getDispatchRunCounts).
const SQL_CONTAGEM = "COUNT(*) FILTER (WHERE status = 'invalid_number')";

async function mundo({ falharContagem = false, nLeads = 7 } = {}) {
  const db = await createPgliteDb(SCHEMA);
  abertos.push(db);
  for (const f of ["20261008180000_add_recurrence_to_campaigns.sql", "20261012120000_campaign_recurrence_occurrences.sql"]) {
    await db.exec(await readFile(join(MIGRATIONS, f), "utf8"));
  }
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, 'Spazio')", [T]);
  const pool = {
    query: async (sql, params) => {
      const texto = typeof sql === "string" ? sql : sql?.text || "";
      if (falharContagem && texto.includes(SQL_CONTAGEM)) throw new Error("connection terminated unexpectedly");
      return db.query(sql, params);
    },
  };
  _setPgDatabasePoolForTesting(pool);
  const supabase = createPgSupabaseClient(pool);

  const { registerCampaignsRoutes } = await import("../domains/campaigns/routes.js");
  const handlers = {};
  const guardar = (metodo) => (path, ...hs) => {
    handlers[`${metodo} ${path}`] = hs[hs.length - 1];
  };
  const app = { get: guardar("GET"), post: guardar("POST"), put: guardar("PUT"), patch: guardar("PATCH"), delete: guardar("DELETE"), use() {} };
  const noop = () => {};
  const routes = registerCampaignsRoutes(app, {
    CAMPAIGN_SCHEDULER_MAX_BATCH: 10, buildDispatchLeads, canCampaignBeDispatched: () => true,
    checkEvolutionInstanceHealth: async () => ({ state: "open" }), continueCampaignLeadFromReply: async () => {},
    ensureDb: () => true, executeCampaignDispatch: async () => {}, findCampaignReplyMatches: async () => [],
    getClientName: async () => "Spazio", getLeadClientEvolutionInstances: async () => [],
    getLeadClientN8nSettings: async () => ({ send_window_enabled: false }), getRequestId: () => "req",
    getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}), isMissingSchemaError: () => false,
    isProduction: false, logCampaignReplyFlow: noop, logDirectDispatch: noop, maskPhoneForLog: (p) => p,
    normalizeIsoDate: (d) => d, leadsTableName: "lead_import_items", normalizeString: (s) => String(s ?? "").trim(),
    normalizeTenantKey: (s) => String(s || "").trim(), parseOptionalUuid: (s) => ({ value: s }), pgDatabasePool: pool,
    requireAppViewAccess: () => (req, res, next) => next(), requireCampaignDispatchAccess: (req, res, next) => next(),
    requireFirebaseAuth: (req, res, next) => next(), requireInternalPageAccess: () => (req, res, next) => next(),
    resolveAuthorizedClientId: () => T,
    resolveCampaignDispatchSettings: async () => ({ webhookUrl: "https://evo.teste/message/sendText/spazio", webhookToken: "t" }),
    resolveDispatchWebhookSettings: async () => ({}), runDueCampaignDispatches: async () => {}, sanitizePhone: (p) => p,
    sendError: (res, s, c, m) => res.status(s).json({ error: { code: c, message: m } }), supabase,
    validateN8nInboundBearer: () => true,
  });

  const { rows: [camp] } = await db.query(
    "INSERT INTO campaigns (client_id, name, analytics_meta, limit_per_run) VALUES ($1, 'Funil Spazio', $2::jsonb, 50) RETURNING *",
    [T, JSON.stringify({ importSource: "__crm__", sequence: SEQ })]
  );
  const leads = [];
  for (let i = 0; i < nLeads; i += 1) {
    const { rows: [l] } = await db.query(
      "INSERT INTO leads (client_id, telefone, nome, created_at) VALUES ($1, $2, $3, $4) RETURNING id, telefone",
      [T, `5511990${1000 + i}`, `Lead ${i}`, new Date(Date.UTC(2026, 9, 20, 12, 0, i)).toISOString()]
    );
    leads.push(l);
  }
  const lote = async ({ status, enviadosAntes = 0, targetCount = 7 }) => {
    const { rows: [d] } = await db.query(
      `INSERT INTO campaign_dispatches (campaign_id, client_id, name, steps, status, "offset", limit_per_run, target_count, error_message)
       VALUES ($1, $2, 'Lote 2/5', $3::jsonb, $4, 0, 7, $6, $5) RETURNING *`,
      [camp.id, T, JSON.stringify(SEQ), status, status === "interrupted" ? "Interrompido: 7 lead(s) pendente(s) de envio." : null, targetCount]
    );
    for (const l of leads.slice(0, enviadosAntes)) {
      await db.query(
        `INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, phone, status, sent_at, lead_id)
         VALUES ($1, $2, $3, $4, 'sent', now(), $5)`,
        [d.id, camp.id, T, l.telefone, l.id]
      );
    }
    return d;
  };
  const retomar = async () => {
    const out = { status: 200, body: null };
    const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
    await handlers["POST /api/campaigns/:campaignId/dispatches/bulk-action"]({ params: { campaignId: camp.id }, body: { action: "resume" }, authAccess: { uid: "u" } }, res);
    return out;
  };
  const rodar = async (dispatch) => {
    const { rows: [campanha] } = await db.query("SELECT * FROM campaigns WHERE id = $1", [camp.id]);
    await routes.runCampaignDispatch({ dispatch, campaign: campanha, supabase });
  };
  const boot = () => recoverOrphanDispatches(pool);
  const estado = async (id) =>
    (await db.query("SELECT status, error_message, sent_count, finished_at FROM campaign_dispatches WHERE id = $1", [id])).rows[0];
  return { db, camp, leads, lote, retomar, rodar, estado, routes, boot, handlers };
}

// Lote criado pela rota REAL, como a tela cria: sem limitPerRun e sem offset no caminho "sem lotes".
async function criarLote(w, extra = {}) {
  const out = { status: 200, body: null };
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  await w.handlers["POST /api/campaigns/:id/dispatches"](
    { params: { id: w.camp.id }, body: { name: "TESTE — Lote Principal", steps: SEQ, triggerType: "manual", ...extra }, authAccess: { uid: "u" } },
    res
  );
  expect(out.status).toBe(201);
  const { rows: [lote] } = await w.db.query("SELECT * FROM campaign_dispatches WHERE id = $1", [out.body.dispatch.id]);
  return lote;
}

async function rodarComoAgendador(w, lote) {
  await w.db.query("UPDATE campaign_dispatches SET status = 'scheduled', scheduled_at = now() - interval '1 minute' WHERE id = $1", [lote.id]);
  await w.routes.runDueIndependentDispatches({ limit: 10 });
}

async function enviadosDoLote(w, id) {
  const { rows: [r] } = await w.db.query("SELECT COUNT(*)::int AS n FROM campaign_dispatch_runs WHERE dispatch_id = $1 AND status = 'sent'", [id]);
  return r.n;
}

describe("SPEC 17 — campanha sem lotes envia o público inteiro, não o 50 padrão da campanha", () => {
  it("[OBRIGATÓRIO] 120 leads, campaigns.limit_per_run 50: lote nasce com limite nulo e target 120, e SAEM 120 (agendador)", async () => {
    const w = await mundo({ nLeads: 120 });
    const lote = await criarLote(w);
    expect(lote.limit_per_run).toBeNull();
    expect(lote.target_count).toBe(120);

    await rodarComoAgendador(w, lote);

    expect(enviados).toHaveLength(120);
    expect(await enviadosDoLote(w, lote.id)).toBe(120);
    const fim = await w.estado(lote.id);
    expect(fim.status).toBe("done");
    expect(fim.sent_count).toBe(120);
  }, SLOW);

  it("mesmo cenário pelo disparo direto do lote (runCampaignDispatch): saem 120", async () => {
    const w = await mundo({ nLeads: 120 });
    const lote = await criarLote(w);
    await w.db.query("UPDATE campaign_dispatches SET status = 'running', triggered_at = now() WHERE id = $1", [lote.id]);
    await w.rodar({ ...lote, status: "running" });
    expect(enviados).toHaveLength(120);
    expect((await w.estado(lote.id)).status).toBe("done");
  }, SLOW);

  it("mesmo cenário pelo 'Executar pendentes' (run-pending): saem 120", async () => {
    const w = await mundo({ nLeads: 120 });
    const lote = await criarLote(w);
    const out = { status: 200, body: null };
    const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
    await w.handlers["POST /api/campaigns/dispatches/:dispatchId/run-pending"]({ params: { dispatchId: lote.id }, body: {}, authAccess: { uid: "u" } }, res);
    // Espera o envio em segundo plano terminar ANTES de afirmar: um teste vermelho não pode vazar envio para o próximo.
    await vi.waitFor(async () => {
      expect(["done", "interrupted"]).toContain((await w.estado(lote.id)).status);
    }, { timeout: 60_000, interval: 200 });
    expect(out.body?.pendingCount).toBe(120);
    expect(enviados).toHaveLength(120);
    expect((await w.estado(lote.id)).status).toBe("done");
  }, SLOW);

  it("lote EM FATIA continua valendo: limite 10, offset 0, público 120 → saem 10 e o lote fecha 'done'", async () => {
    const w = await mundo({ nLeads: 120 });
    const lote = await criarLote(w, { limitPerRun: 10, offset: 0 });
    expect(lote.limit_per_run).toBe(10);
    expect(lote.target_count).toBe(10);
    await rodarComoAgendador(w, lote);
    expect(enviados).toHaveLength(10);
    expect((await w.estado(lote.id)).status).toBe("done");
  }, SLOW);

  it("limite OPCIONAL escolhido ('só os primeiros 30'): saem 30, target 30 e o lote fecha 'done', não 'interrupted'", async () => {
    const w = await mundo({ nLeads: 120 });
    const lote = await criarLote(w, { limitPerRun: 30 });
    expect(lote.limit_per_run).toBe(30);
    expect(lote.target_count).toBe(30);
    await rodarComoAgendador(w, lote);
    expect(enviados).toHaveLength(30);
    const fim = await w.estado(lote.id);
    expect(fim.status).toBe("done");
    expect(fim.error_message).toBeNull();
  }, SLOW);

  it("limitPerRun inválido (0, negativo, texto) vira lote sem limite, nunca NaN", async () => {
    const w = await mundo({ nLeads: 12 });
    for (const invalido of [0, -5, "abc"]) {
      const lote = await criarLote(w, { limitPerRun: invalido });
      expect(lote.limit_per_run).toBeNull();
      expect(lote.target_count).toBe(12);
    }
  }, SLOW);
});
