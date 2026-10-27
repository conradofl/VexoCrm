// backend/src/test/backfillDispatchLimitPostgres.test.js
//
// SPEC 17 — backfill de limite nos lotes que já existem, rodado ANTES do deploy do código novo.
// O código novo trata limit_per_run NULO do lote como "público inteiro". Sem o backfill, os lotes que já existem
// (pausados, agendados...) passariam a enviar o público inteiro em silêncio. O backfill grava neles o limite efetivo
// de hoje (o da campanha), então o volume deles não muda; lote criado depois do deploy envia o público inteiro.
//
// Postgres REAL (pglite), agendador real, envio capturado no fetch.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { buildDispatchLeads } from "../campaign/dispatch.js";
import { recoverOrphanDispatches } from "../campaign/orphanRecovery.js";
import { backfillDispatchLimit } from "../scripts/backfillDispatchLimit.js";

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

async function criarLote(w, extra = {}) {
  const out = { status: 200, body: null };
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  await w.handlers["POST /api/campaigns/:id/dispatches"](
    { params: { id: w.camp.id }, body: { name: "Lote Principal", steps: SEQ, triggerType: "manual", ...extra }, authAccess: { uid: "u" } },
    res
  );
  expect(out.status).toBe(201);
  const { rows: [lote] } = await w.db.query("SELECT * FROM campaign_dispatches WHERE id = $1", [out.body.dispatch.id]);
  return lote;
}

// Lote que JÁ EXISTIA antes do deploy: criado pelo código velho, sem limite próprio, com target = público inteiro.
async function loteAntigo(w, { status, error = null }) {
  const { rows: [d] } = await w.db.query(
    `INSERT INTO campaign_dispatches (campaign_id, client_id, name, steps, status, "offset", limit_per_run, target_count, error_message, scheduled_at, updated_at)
     VALUES ($1, $2, 'Lote antigo', $3::jsonb, $4, NULL, NULL, 120, $5, now() - interval '1 hour', '2026-10-20T00:00:00Z') RETURNING *`,
    [w.camp.id, T, JSON.stringify(SEQ), status, error]
  );
  return d;
}

const aplicar = (w) => backfillDispatchLimit({ query: (sql, p) => w.db.query(sql, p) }, { apply: true, log: () => {} });

describe("SPEC 17 — backfill antes do deploy: lote que já existe mantém o volume, lote novo envia o público inteiro", () => {
  it("[OBRIGATÓRIO] lote PAUSADO com alvo 120 e limite herdado 50 continua enviando 50 depois do deploy", async () => {
    const w = await mundo({ nLeads: 120 });
    const antigo = await loteAntigo(w, { status: "paused", error: "Pausado — fora da janela de envio (08:00–20:00). Retomará na próxima janela." });

    await aplicar(w);

    // o agendador retoma o lote pausado (janela aberta): sai o que saía antes do deploy, não o público inteiro
    await w.routes.runDueIndependentDispatches({ limit: 10 });
    expect(enviados).toHaveLength(50);
    const fim = await w.estado(antigo.id);
    expect(fim.sent_count).toBe(50);
    expect(fim.status).toBe("interrupted");
    expect(fim.error_message).toMatch(/70/);

    const { rows: [depois] } = await w.db.query("SELECT limit_per_run, target_count FROM campaign_dispatches WHERE id = $1", [antigo.id]);
    expect(depois.limit_per_run).toBe(50);
    expect(depois.target_count).toBe(120);
  }, SLOW);

  it("[OBRIGATÓRIO] lote NOVO, criado depois do deploy, com os mesmos 120 leads: envia 120", async () => {
    const w = await mundo({ nLeads: 120 });
    await aplicar(w); // o backfill rodou antes; o lote abaixo nasce depois
    const novo = await criarLote(w);
    expect(novo.limit_per_run).toBeNull();
    expect(novo.target_count).toBe(120);

    await w.db.query("UPDATE campaign_dispatches SET status = 'scheduled', scheduled_at = now() - interval '1 minute' WHERE id = $1", [novo.id]);
    await w.routes.runDueIndependentDispatches({ limit: 10 });
    expect(enviados).toHaveLength(120);
    expect((await w.estado(novo.id)).status).toBe("done");
  }, SLOW);

  it("o backfill só grava limit_per_run: status, error_message, target_count e updated_at ficam idênticos, em qualquer status", async () => {
    const w = await mundo({ nLeads: 3 });
    const statuses = ["draft", "scheduled", "paused", "interrupted", "done", "failed", "cancelled"];
    for (const status of statuses) await loteAntigo(w, { status, error: `msg-${status}` });
    const foto = async () => (await w.db.query("SELECT id, status, error_message, target_count, updated_at, finished_at, sent_count FROM campaign_dispatches ORDER BY id")).rows;
    const antes = await foto();
    const r = await aplicar(w);
    expect(r.atualizados).toBe(statuses.length);
    expect(await foto()).toEqual(antes);
    const { rows } = await w.db.query("SELECT DISTINCT limit_per_run FROM campaign_dispatches");
    expect(rows).toEqual([{ limit_per_run: 50 }]);
  }, SLOW);

  it("não mexe em lote com limite próprio (fatia), em ocorrência de campanha recorrente nem quando a campanha não tem limite", async () => {
    const w = await mundo({ nLeads: 3 });
    const { rows: [fatia] } = await w.db.query(
      `INSERT INTO campaign_dispatches (campaign_id, client_id, name, steps, status, "offset", limit_per_run, target_count)
       VALUES ($1, $2, 'Lote 2/3', $3::jsonb, 'scheduled', 10, 10, 10) RETURNING id`, [w.camp.id, T, JSON.stringify(SEQ)]);
    const { rows: [ocorrencia] } = await w.db.query(
      `INSERT INTO campaign_dispatches (campaign_id, client_id, name, steps, status, limit_per_run, target_count, recurrence_occurrence_at)
       VALUES ($1, $2, 'Ocorrência', $3::jsonb, 'scheduled', NULL, 3, now()) RETURNING id`, [w.camp.id, T, JSON.stringify(SEQ)]);
    const { rows: [campSemLimite] } = await w.db.query("INSERT INTO campaigns (client_id, name, limit_per_run) VALUES ($1, 'Sem limite', NULL) RETURNING id", [T]);
    const { rows: [semLimite] } = await w.db.query(
      `INSERT INTO campaign_dispatches (campaign_id, client_id, name, steps, status, limit_per_run, target_count)
       VALUES ($1, $2, 'Lote sem limite', $3::jsonb, 'scheduled', NULL, 3) RETURNING id`, [campSemLimite.id, T, JSON.stringify(SEQ)]);

    const r = await aplicar(w);
    expect(r.atualizados).toBe(0);
    const lim = async (id) => (await w.db.query("SELECT limit_per_run FROM campaign_dispatches WHERE id = $1", [id])).rows[0].limit_per_run;
    expect(await lim(fatia.id)).toBe(10);
    expect(await lim(ocorrencia.id)).toBeNull();
    expect(await lim(semLimite.id)).toBeNull();
  }, SLOW);

  it("é idempotente e o dry-run (padrão) não escreve nada", async () => {
    const w = await mundo({ nLeads: 3 });
    const antigo = await loteAntigo(w, { status: "scheduled" });
    const pool = { query: (sql, p) => w.db.query(sql, p) };

    const seco = await backfillDispatchLimit(pool, { log: () => {} });
    expect(seco).toMatchObject({ applied: false, candidatos: 1 });
    expect((await w.db.query("SELECT limit_per_run FROM campaign_dispatches WHERE id = $1", [antigo.id])).rows[0].limit_per_run).toBeNull();

    expect((await aplicar(w)).atualizados).toBe(1);
    const segunda = await aplicar(w);
    expect(segunda.atualizados).toBe(0);
    expect(segunda.restantes).toBe(0);
  }, SLOW);
});
