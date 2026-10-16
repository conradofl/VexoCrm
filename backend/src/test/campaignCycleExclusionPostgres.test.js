// backend/src/test/campaignCycleExclusionPostgres.test.js
//
// Exclusão por CICLO entre lotes da mesma campanha (findLeadsAlreadyReachedInCycle + runCampaignDispatch real).
//
// O lote é fatia por posição (created_at DESC, id). Um lead importado entre o lote 0 e o lote 1 entra na posição 0 e
// empurra todos uma casa: o lead da fronteira escorrega para o lote 1 — e, como a exclusão por dispatch_id só enxerga
// o próprio lote, recebia de novo. Agora quem já recebeu em OUTRO lote do mesmo ciclo é pulado (com motivo).
// Ciclo = ocorrência (recurrence_occurrence_at) na recorrente; lotes avulsos da campanha no caso avulso.
//
// Postgres REAL (pglite), envio capturado no fetch, esperas entre leads encurtadas.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { buildDispatchLeads } from "../campaign/dispatch.js";

const SLOW = 120_000;
const T = "tenant-ciclo";
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");
const MESMO_INSTANTE = "2026-10-14T12:00:00.000Z";
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
    campaign_prompt_id UUID, mode TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaign_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id UUID NOT NULL, client_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
    steps JSONB NOT NULL DEFAULT '[]'::jsonb, trigger_type TEXT NOT NULL DEFAULT 'manual', scheduled_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'draft', sent_count INT NOT NULL DEFAULT 0, failed_count INT NOT NULL DEFAULT 0,
    triggered_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, error_message TEXT, limit_per_run INT, "offset" INT,
    campaign_prompt_id UUID, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaign_dispatch_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_id UUID NOT NULL, campaign_id UUID NOT NULL, client_id TEXT NOT NULL,
    phone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error_message TEXT, sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- colunas que ensureDispatchRunsClaimSchema cria UMA vez por processo (flag de módulo): cada teste tem banco novo
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
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  globalThis.setTimeout = timeoutOriginal;
  logSpy.mockRestore();
});

const abertos = [];
afterAll(async () => {
  for (const db of abertos) await db.close();
});

async function mundo() {
  const db = await createPgliteDb(SCHEMA);
  abertos.push(db);
  for (const f of ["20261008180000_add_recurrence_to_campaigns.sql", "20261012120000_campaign_recurrence_occurrences.sql"]) {
    await db.exec(await readFile(join(MIGRATIONS, f), "utf8"));
  }
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, 'Spazio')", [T]);
  const pool = { query: (sql, params) => db.query(sql, params) };
  _setPgDatabasePoolForTesting(pool);
  const supabase = createPgSupabaseClient(pool);

  const { registerCampaignsRoutes } = await import("../domains/campaigns/routes.js");
  const noop = () => {};
  const routes = registerCampaignsRoutes({ get: noop, post: noop, put: noop, patch: noop, delete: noop, use: noop }, {
    CAMPAIGN_SCHEDULER_MAX_BATCH: 10, buildDispatchLeads, canCampaignBeDispatched: () => true,
    checkEvolutionInstanceHealth: async () => ({ state: "open" }), continueCampaignLeadFromReply: async () => {},
    ensureDb: () => true, executeCampaignDispatch: async () => {}, findCampaignReplyMatches: async () => [],
    getClientName: async () => "Spazio", getLeadClientEvolutionInstances: async () => [],
    getLeadClientN8nSettings: async () => ({ send_window_enabled: false }), getRequestId: () => "req",
    getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}), isMissingSchemaError: () => false,
    isProduction: false, logCampaignReplyFlow: noop, logDirectDispatch: noop, maskPhoneForLog: (p) => p,
    normalizeIsoDate: (d) => d, leadsTableName: "lead_import_items", normalizeString: (s) => String(s || "").trim(),
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
    "INSERT INTO campaigns (client_id, name, analytics_meta) VALUES ($1, 'Spazio', $2::jsonb) RETURNING *",
    [T, JSON.stringify({ importSource: "__crm__", sequence: SEQ })]
  );
  const inserirLeads = async (n, prefixo, createdAt = MESMO_INSTANTE) => {
    for (let i = 0; i < n; i += 1) {
      await db.query("INSERT INTO leads (client_id, telefone, nome, created_at) VALUES ($1, $2, $3, $4)", [T, `${prefixo}${String(1000 + i)}`, `Lead ${i}`, createdAt]);
    }
  };
  const lote = async ({ offset = null, limit = null, occurrenceAt = null }) => {
    const { rows: [d] } = await db.query(
      `INSERT INTO campaign_dispatches (campaign_id, client_id, name, steps, status, "offset", limit_per_run, recurrence_occurrence_at)
       VALUES ($1, $2, 'Lote', $3::jsonb, 'running', $4, $5, $6) RETURNING *`,
      [camp.id, T, JSON.stringify(SEQ), offset, limit, occurrenceAt]
    );
    return d;
  };
  const rodar = async (dispatch) => {
    const { rows: [campanha] } = await db.query("SELECT * FROM campaigns WHERE id = $1", [camp.id]);
    await routes.runCampaignDispatch({ dispatch, campaign: campanha, supabase });
  };
  return { db, camp, inserirLeads, lote, rodar };
}

const contagem = (lista) => lista.reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map());

describe("[OBRIGATÓRIO] exclusão por ciclo entre lotes da mesma campanha", () => {
  it("(a) lead importado entre o lote 0 e o lote 1: ninguém recebe duas vezes", async () => {
    const w = await mundo();
    await w.inserirLeads(30, "5511990");
    const lotes = [await w.lote({ offset: 0, limit: 10 }), await w.lote({ offset: 10, limit: 10 }), await w.lote({ offset: 20, limit: 10 })];

    await w.rodar(lotes[0]);
    await w.inserirLeads(1, "5521980", "2026-10-15T09:00:00.000Z"); // importado depois: entra na posição 0
    await w.rodar(lotes[1]);
    await w.rodar(lotes[2]);

    const repetidos = [...contagem(enviados)].filter(([, n]) => n > 1);
    expect(repetidos).toEqual([]);
    // o pulado fica registrado, com motivo, no lote em que teria se repetido
    const { rows } = await w.db.query("SELECT count(*)::int AS n FROM campaign_dispatch_runs WHERE status = 'skipped' AND error_message LIKE 'Já recebeu em outro lote%'");
    expect(rows[0].n).toBeGreaterThan(0);
  }, SLOW);

  it("(b) campanha recorrente com 2 ocorrências: o MESMO lead recebe nas duas", async () => {
    const w = await mundo();
    await w.inserirLeads(5, "5511990");
    await w.rodar(await w.lote({ occurrenceAt: "2026-11-15T12:00:00Z" }));
    await w.rodar(await w.lote({ occurrenceAt: "2026-12-15T12:00:00Z" }));

    expect(enviados).toHaveLength(10);
    expect([...contagem(enviados).values()]).toEqual([2, 2, 2, 2, 2]);
  }, SLOW);

  it("(c) quem não recebeu nada continua entrando normalmente", async () => {
    const w = await mundo();
    await w.inserirLeads(20, "5511990");
    await w.rodar(await w.lote({ offset: 0, limit: 10 }));
    const primeiros = new Set(enviados);
    await w.rodar(await w.lote({ offset: 10, limit: 10 }));

    expect(enviados).toHaveLength(20);
    expect(enviados.slice(10).every((t) => !primeiros.has(t))).toBe(true);
  }, SLOW);

  it("(d) MEDIÇÃO: quem escorrega para fora de todos os lotes continua sem receber — fica para o caminho 1", async () => {
    const w = await mundo();
    await w.inserirLeads(30, "5511990");
    const lotes = [await w.lote({ offset: 0, limit: 10 }), await w.lote({ offset: 10, limit: 10 }), await w.lote({ offset: 20, limit: 10 })];
    const ordemAntes = (await buildDispatchLeads({ clientId: T, importId: "__crm__" })).map((l) => l.telefone);

    await w.rodar(lotes[0]);
    await w.inserirLeads(1, "5521980", "2026-10-15T09:00:00.000Z");
    await w.rodar(lotes[1]);
    await w.rodar(lotes[2]);

    // Medido: 31 na base (30 + o novo), 29 recebem, cada um uma vez. Ficam de fora exatamente dois:
    //  - o último da base original: a janela deslizou uma casa e ele saiu de todos os lotes;
    //  - o próprio lead novo: entrou na posição 0, depois de o lote 0 já ter rodado.
    // A exclusão por ciclo impede o 2º envio; não devolve ao lote quem saiu da janela. Isso é o caminho 1
    // (congelar os membros do lote na criação) — pendência registrada, não resolvida aqui.
    const recebeu = new Set(enviados);
    expect(enviados).toHaveLength(29);
    expect(recebeu.size).toBe(29);
    const todos = [...ordemAntes, "55219801000"];
    expect(todos.filter((t) => !recebeu.has(t)).sort()).toEqual([ordemAntes[29], "55219801000"].sort());
  }, SLOW);
});
