// backend/src/test/dispatchTargetMatchesAudience.test.js
//
// A cerca que substitui o limite herdado da campanha (SPEC 17): o target_count de um lote NUNCA pode nascer maior que o
// público da origem da campanha, e tem que ser o mesmo número que o envio realmente processa.
//
// Por que existe: o lote 3edb7b73 (bia-do-spazio, 22/10/2026) nasceu com target_count 504 numa campanha de 2 leads. O
// select da criação do lote não trazia a coluna import_id, então a origem caía em NULL e a contagem era feita sobre a base
// inteira de planilhas do tenant (505 na data). O que segurou o envio foi o limite herdado da campanha (2); a SPEC 17 removeu
// essa cerca. Antes só havia teste de RECUSA (campaignWithoutSourceGuard, com mocks) e de alvo em base só-CRM.
//
// Aqui: Postgres REAL, rota REAL de criação de lote, agendador e envio REAIS, e SEMPRE uma segunda planilha de 40 leads
// no mesmo tenant ao lado da origem de 2 leads. Cada forma de apontar a origem (import_id, importIds, todas, CRM, Banco)
// precisa dar o público certo, e alvo === enviados.

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

const IMP_A = "aaaaaaaa-1111-1111-1111-111111111111"; // a origem da campanha: 2 leads
const IMP_B = "bbbbbbbb-2222-2222-2222-222222222222"; // outra planilha do mesmo tenant: 40 leads

async function planilhas(w) {
  await w.db.exec(`
    CREATE TABLE public.lead_import_items (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), import_id UUID, client_id TEXT, lead_id UUID,
      telefone TEXT, normalized_data JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT now(), imported BOOLEAN DEFAULT true);`);
  await w.db.query("INSERT INTO lead_import_items (import_id, client_id, telefone) SELECT $1, $2, '55119910' || (1000 + g)::text FROM generate_series(0, 1) g", [IMP_A, T]);
  await w.db.query("INSERT INTO lead_import_items (import_id, client_id, telefone) SELECT $1, $2, '55118820' || lpad(g::text, 4, '0') FROM generate_series(1, 40) g", [IMP_B, T]);
}

async function campanha(w, { importId = null, meta = {} }) {
  const { rows: [c] } = await w.db.query(
    "INSERT INTO campaigns (client_id, name, import_id, analytics_meta) VALUES ($1, 'Campanha de teste', $2, $3::jsonb) RETURNING id",
    [T, importId, JSON.stringify({ sequence: SEQ, ...meta })]
  );
  return c.id;
}

async function criarLoteDe(w, campaignId) {
  const out = { status: 200, body: null };
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  await w.handlers["POST /api/campaigns/:id/dispatches"](
    { params: { id: campaignId }, body: { name: "Lote Principal", steps: SEQ, triggerType: "manual" }, authAccess: { uid: "u" } },
    res
  );
  expect(out.status).toBe(201);
  const { rows: [lote] } = await w.db.query("SELECT * FROM campaign_dispatches WHERE id = $1", [out.body.dispatch.id]);
  return lote;
}

// Cria o lote pela rota, roda pelo agendador e confere a invariante: alvo === o esperado === o que saiu.
async function alvoIgualAoEnvio(w, campaignId, esperado) {
  const lote = await criarLoteDe(w, campaignId);
  expect(lote.target_count).toBe(esperado);
  await w.db.query("UPDATE campaign_dispatches SET status = 'scheduled', scheduled_at = now() - interval '1 minute' WHERE id = $1", [lote.id]);
  await w.routes.runDueIndependentDispatches({ limit: 10 });
  expect(enviados).toHaveLength(esperado);
  expect(enviados).toHaveLength(lote.target_count);
  return lote;
}

describe("a cerca do alvo: o target_count do lote é o público da origem, e é o que o envio processa", () => {
  it("[OBRIGATÓRIO] campanha de UMA planilha (só import_id, importIds vazio): alvo 2, não os 42 do tenant (o caso do 504)", async () => {
    const w = await mundo({ nLeads: 7 });
    await planilhas(w);
    const id = await campanha(w, { importId: IMP_A, meta: { importIds: [] } });
    await alvoIgualAoEnvio(w, id, 2);
    // saiu para a planilha certa (o envio normaliza o número: 5511999101000), e nenhum número da outra planilha
    expect(enviados.every((t) => t.includes("99101"))).toBe(true);
    expect(enviados.some((t) => t.includes("8820"))).toBe(false);
  }, SLOW);

  it("campanha de público do Banco já reparada (origem = a planilha do Banco, com audienceCriteria): alvo 2", async () => {
    const w = await mundo({ nLeads: 7 });
    await planilhas(w);
    const id = await campanha(w, { importId: IMP_A, meta: { importIds: [IMP_A], audienceCriteria: { clientId: T, tags: ["TESTE DO BASTÃO"], totalCount: 2 } } });
    await alvoIgualAoEnvio(w, id, 2);
  }, SLOW);

  it("origem em importIds (lista de uma): alvo 2", async () => {
    const w = await mundo({ nLeads: 7 });
    await planilhas(w);
    const id = await campanha(w, { importId: IMP_A, meta: { importIds: [IMP_A] } });
    await alvoIgualAoEnvio(w, id, 2);
  }, SLOW);

  it("duas planilhas escolhidas (importIds com A e B, import_id = a primeira): alvo 42, que é o que a pessoa escolheu", async () => {
    const w = await mundo({ nLeads: 7 });
    await planilhas(w);
    const id = await campanha(w, { importId: IMP_A, meta: { importIds: [IMP_A, IMP_B] } });
    await alvoIgualAoEnvio(w, id, 42);
  }, SLOW);

  it("'todas as planilhas' escolhido de propósito (importSource __all__): alvo 42", async () => {
    const w = await mundo({ nLeads: 7 });
    await planilhas(w);
    const id = await campanha(w, { importId: null, meta: { importSource: "__all__" } });
    await alvoIgualAoEnvio(w, id, 42);
  }, SLOW);

  it("origem CRM (__crm__): alvo é a tabela de leads do CRM (7), não as planilhas", async () => {
    const w = await mundo({ nLeads: 7 });
    await planilhas(w);
    const id = await campanha(w, { importId: null, meta: { importSource: "__crm__" } });
    await alvoIgualAoEnvio(w, id, 7);
  }, SLOW);

  it("[OBRIGATÓRIO] 'Executar pendentes' (run-pending, que tem o próprio select da campanha): conta 2 e envia 2", async () => {
    const w = await mundo({ nLeads: 7 });
    await planilhas(w);
    const id = await campanha(w, { importId: IMP_A, meta: { importIds: [] } });
    const lote = await criarLoteDe(w, id);
    expect(lote.target_count).toBe(2);
    const out = { status: 200, body: null };
    const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
    await w.handlers["POST /api/campaigns/dispatches/:dispatchId/run-pending"]({ params: { dispatchId: lote.id }, body: {}, authAccess: { uid: "u" } }, res);
    await vi.waitFor(async () => {
      expect(["done", "interrupted"]).toContain((await w.estado(lote.id)).status);
    }, { timeout: 60_000, interval: 200 });
    expect(out.body?.pendingCount).toBe(2);
    expect(enviados).toHaveLength(2);
    expect(enviados.some((t) => t.includes("8820"))).toBe(false);
  }, SLOW);

  it("[OBRIGATÓRIO] 'Disparar lote agora' (trigger manual, que tem o próprio select da campanha): envia 2", async () => {
    const w = await mundo({ nLeads: 7 });
    await planilhas(w);
    const id = await campanha(w, { importId: IMP_A, meta: { importIds: [] } });
    const lote = await criarLoteDe(w, id);
    expect(lote.target_count).toBe(2);
    const out = { status: 200, body: null };
    const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
    await w.handlers["POST /api/campaigns/dispatches/:dispatchId/trigger"]({ params: { dispatchId: lote.id }, body: {}, authAccess: { uid: "u" } }, res);
    await vi.waitFor(async () => {
      expect(["done", "interrupted"]).toContain((await w.estado(lote.id)).status);
    }, { timeout: 60_000, interval: 200 });
    expect(enviados).toHaveLength(2);
    expect(enviados.some((t) => t.includes("8820"))).toBe(false);
  }, SLOW);

  it("[OBRIGATÓRIO] ocorrência de campanha recorrente (outro caminho que cria lote): alvo 2, não 42", async () => {
    const w = await mundo({ nLeads: 7 });
    await planilhas(w);
    const { rows: [c] } = await w.db.query(
      `INSERT INTO campaigns (client_id, name, status, import_id, analytics_meta, is_recurring, recurrence_pattern,
         recurrence_day_of_month, recurrence_time, next_run_at, recurrence_end_type)
       VALUES ($1, 'Recorrente', 'active', $2, $3::jsonb, true, 'monthly', 15, '09:00', now() - interval '1 hour', 'never') RETURNING id`,
      [T, IMP_A, JSON.stringify({ importIds: [], sequence: SEQ })]
    );
    await w.routes.runDueIndependentDispatches({ limit: 10 });
    const { rows } = await w.db.query("SELECT target_count, recurrence_occurrence_at FROM campaign_dispatches WHERE campaign_id = $1", [c.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].recurrence_occurrence_at).not.toBeNull();
    expect(rows[0].target_count).toBe(2);
    expect(enviados).toHaveLength(2);
  }, SLOW);
});
