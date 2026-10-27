// backend/src/test/campaignInterruptedResumePostgres.test.js
//
// SPEC 13 — lote 'interrupted' volta a andar, e lote completo nunca vira 'interrupted' por contagem que falhou.
// Medido em produção (campanha 5dd55144, 26/10/2026): lotes 2/5 e 3/5 em 'interrupted', "7 lead(s) pendente(s)",
// com o 3/5 tendo enviado 7 de 7. O Retomar respondia sucesso com 0 lotes afetados; o agendador não enxergava
// 'interrupted'; a contagem de runs com .catch(() => ({ rows: [] })) virava zero e fabricava "7 pendentes".
//
// Postgres REAL (pglite), rota de Retomar e agendador de verdade, envio capturado no fetch.

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

async function mundo({ falharContagem = false } = {}) {
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
    "INSERT INTO campaigns (client_id, name, analytics_meta) VALUES ($1, 'Funil Spazio', $2::jsonb) RETURNING *",
    [T, JSON.stringify({ importSource: "__crm__", sequence: SEQ })]
  );
  const leads = [];
  for (let i = 0; i < 7; i += 1) {
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
  return { db, camp, leads, lote, retomar, rodar, estado, routes, boot };
}

describe("SPEC 13 — Retomar lote 'interrupted' (Postgres real, agendador de verdade)", () => {
  it("lote 2/5 interrompido com 3 de 7 enviados: Retomar → agendador → os 4 que faltam saem e o lote termina 'done'", async () => {
    const w = await mundo();
    const d = await w.lote({ status: "interrupted", enviadosAntes: 3 });

    const out = await w.retomar();
    expect(out.status).toBe(200);
    expect(out.body.affectedDispatches).toBe(1);
    expect((await w.estado(d.id)).status).toBe("scheduled");

    await w.routes.runDueIndependentDispatches({ limit: 10 });

    const jaTinham = new Set(w.leads.slice(0, 3).map((l) => l.telefone));
    expect(enviados).toHaveLength(4);
    expect(enviados.every((t) => !jaTinham.has(t))).toBe(true); // quem já recebeu não recebe de novo
    expect((await w.estado(d.id)).status).toBe("done");
  }, SLOW);

  it("Retomar sem lote elegível responde 400 NO_DISPATCHES_RESUMED (não mais sucesso com 0 afetados)", async () => {
    const w = await mundo();
    await w.lote({ status: "done", enviadosAntes: 7 });
    const out = await w.retomar();
    expect(out.status).toBe(400);
    expect(out.body.error.code).toBe("NO_DISPATCHES_RESUMED");
  }, SLOW);
});

// Lote agendado vencido, rodado pelo agendador (o caminho dos lotes 2/5 e 3/5 do cliente).
async function rodarPeloAgendador(w, d) {
  await w.db.query("UPDATE campaign_dispatches SET status = 'scheduled', scheduled_at = now() - interval '1 minute', error_message = NULL WHERE id = $1", [d.id]);
  await w.routes.runDueIndependentDispatches({ limit: 10 });
}

describe("SPEC 13 — fechamento pelo agendador usa o alvo gravado, e só ele", () => {
  it("lote novo de 7 rodado pelo agendador: 7 enviados, 'done' (em produção fechava 'Interrompido: 7 pendentes')", async () => {
    const w = await mundo();
    const d = await w.lote({ status: "scheduled" });
    await rodarPeloAgendador(w, d);
    expect(enviados).toHaveLength(7);
    const fim = await w.estado(d.id);
    expect(fim.status).toBe("done");
    expect(fim.error_message || "").not.toMatch(/pendente/);
  }, SLOW);

  it("lote sem target_count gravado (legado) rodado pelo agendador fecha 'done', sem inventar pendência", async () => {
    const w = await mundo();
    const d = await w.lote({ status: "scheduled", targetCount: null });
    await rodarPeloAgendador(w, d);
    expect(enviados).toHaveLength(7);
    expect((await w.estado(d.id)).status).toBe("done");
  }, SLOW);

  it("alvo gravado não alcançado (7 no lote, 5 ainda na base): o agendador enxerga o alvo e NÃO fecha 'done'", async () => {
    const w = await mundo();
    const d = await w.lote({ status: "scheduled" });
    await w.db.query("DELETE FROM leads WHERE id = ANY($1::uuid[])", [w.leads.slice(5).map((l) => l.id)]);
    await rodarPeloAgendador(w, d);
    expect(enviados).toHaveLength(5);
    const fim = await w.estado(d.id);
    expect(fim.status).toBe("interrupted");
    expect(fim.error_message).toBe("Interrompido: 2 lead(s) pendente(s) de envio.");
  }, SLOW);
});

describe("SPEC 13 — fechamento do lote: 7 de 7 enviados", () => {
  it("[OBRIGATÓRIO] lote de 7 com 7 runs sent termina 'done', nunca 'interrupted'", async () => {
    const w = await mundo();
    const d = await w.lote({ status: "running", enviadosAntes: 7 });
    await w.rodar(d);
    expect(enviados).toHaveLength(0);
    const fim = await w.estado(d.id);
    expect(fim.status).toBe("done");
    expect(fim.error_message || "").not.toMatch(/pendente/);
  }, SLOW);

  it("lote de 7 que envia os 7 nesta execução termina 'done'", async () => {
    const w = await mundo();
    const d = await w.lote({ status: "running", enviadosAntes: 0 });
    await w.rodar(d);
    expect(enviados).toHaveLength(7);
    expect((await w.estado(d.id)).status).toBe("done");
  }, SLOW);

  it("contagem de runs que falha nas duas tentativas NÃO fabrica 'interrupted: 7 pendentes' e não mexe no status", async () => {
    const w = await mundo({ falharContagem: true });
    const d = await w.lote({ status: "running", enviadosAntes: 7 });
    await w.rodar(d);
    const fim = await w.estado(d.id);
    expect(fim.status).not.toBe("interrupted");
    expect(fim.status).toBe("running");
    expect(fim.error_message || "").not.toMatch(/pendente/);
  }, SLOW);
});

describe("SPEC 13 — boot (recoverOrphanDispatches): lote completo fecha 'done', incompleto fica retomável", () => {
  it("[OBRIGATÓRIO] 'interrupted' com 7 runs sent e target_count 7 sai do boot 'done', com finished_at e sem erro", async () => {
    const w = await mundo();
    const d = await w.lote({ status: "interrupted", enviadosAntes: 7 });
    await w.boot();
    const fim = await w.estado(d.id);
    expect(fim.status).toBe("done");
    expect(fim.finished_at).not.toBeNull();
    expect(fim.error_message).toBeNull();
    expect(fim.sent_count).toBe(7);
  }, SLOW);

  it("[OBRIGATÓRIO] 'interrupted' com 5 runs sent e target_count 7 sai do boot 'paused' (o lote 2/5 real do cliente)", async () => {
    const w = await mundo();
    const d = await w.lote({ status: "interrupted", enviadosAntes: 5 });
    await w.boot();
    const fim = await w.estado(d.id);
    expect(fim.status).toBe("paused");
    expect(fim.error_message).toMatch(/Retome/);
  }, SLOW);

  it("e o 'paused' do boot é retomável até o fim: Retomar → agendador → 2 que faltam → 'done'", async () => {
    const w = await mundo();
    const d = await w.lote({ status: "interrupted", enviadosAntes: 5 });
    await w.boot();
    expect((await w.retomar()).status).toBe(200);
    await w.routes.runDueIndependentDispatches({ limit: 10 });
    expect(enviados).toHaveLength(2);
    expect((await w.estado(d.id)).status).toBe("done");
  }, SLOW);

  it("lead em 'claimed' sem confirmação vira 'skipped' no boot", async () => {
    const w = await mundo();
    const d = await w.lote({ status: "running", enviadosAntes: 2 });
    await w.db.query(
      "INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, phone, status, lead_id) VALUES ($1, $2, $3, $4, 'claimed', $5)",
      [d.id, w.camp.id, T, w.leads[2].telefone, w.leads[2].id]
    );
    await w.boot();
    const { rows } = await w.db.query("SELECT status FROM campaign_dispatch_runs WHERE dispatch_id = $1 AND lead_id = $2", [d.id, w.leads[2].id]);
    expect(rows[0].status).toBe("skipped");
    expect((await w.estado(d.id)).status).toBe("paused");
  }, SLOW);
});
