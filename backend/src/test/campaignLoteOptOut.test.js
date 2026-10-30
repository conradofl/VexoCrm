// backend/src/test/campaignLoteOptOut.test.js
//
// O LOTE respeita a lista de opt-out (lead_optouts).
//
// O `checkOptout` de routes.js EXISTIA, lia lead_optouts e NUNCA foi passado ao envio (onLeadCheckOptout): quem digitava
// "parar" entrava na tabela e continuava recebendo campanha. É a mesma família do `chipProvider` que ficou cinco semanas
// desligado em 2026: código certo, nunca conectado. O teste de contrato de chaves (dispatchCallContract.test.js) passou a
// exigir `onLeadCheckOptout` na chamada do lote justamente por isso.
//
// Postgres REAL (pglite), lote real (runCampaignDispatch).

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
const SEQ2 = [
  { id: "s1", type: "text", text: "Oi {{nome}}", order: 1, enabled: true, delayAfterSeconds: 0 },
  { id: "s2", type: "text", text: "Segue o link", order: 2, enabled: true, delayAfterSeconds: 0, triggerMode: "after_reply" },
];

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.leads_clients (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, telefone TEXT, nome TEXT, tipo_cliente TEXT,
    faixa_consumo TEXT, qualificacao TEXT, cidade TEXT, estado TEXT, status TEXT, opt_out BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb, dados JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.lead_import_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), import_id UUID, client_id TEXT NOT NULL, lead_id UUID, telefone TEXT,
    imported BOOLEAN DEFAULT true, normalized_data JSONB NOT NULL DEFAULT '{}'::jsonb, status_conversa TEXT,
    ultima_interacao_bot TIMESTAMPTZ, ultima_interacao_usuario TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.lead_optouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, phone TEXT NOT NULL, reason TEXT,
    optout_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (client_id, phone)
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

async function mundo({ falharContagem = false, falharOptOut = false, nLeads = 7 } = {}) {
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
      if (falharOptOut && texto.includes("public.lead_optouts")) throw new Error("connection terminated unexpectedly");
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

  const IMP = "bbbbbbbb-0000-4000-8000-000000000002";
  const { rows: [camp] } = await db.query(
    "INSERT INTO campaigns (client_id, name, import_id, analytics_meta, limit_per_run) VALUES ($1, 'Funil Spazio', $2, $3::jsonb, 50) RETURNING *",
    [T, IMP, JSON.stringify({ sequence: SEQ2, dispatchOptions: { waitForReply: true } })]
  );
  const leads = [];
  for (let i = 0; i < nLeads; i += 1) {
    // do mais novo para o mais antigo: o lote lê created_at DESC, então o lead 0 é o primeiro a ser enviado
    const { rows: [l] } = await db.query(
      "INSERT INTO lead_import_items (client_id, import_id, telefone, created_at) VALUES ($1, $2, $3, $4) RETURNING id, telefone",
      [T, IMP, `5511990${1000 + i}`, new Date(Date.UTC(2026, 9, 20, 12, 0, 59 - i)).toISOString()]
    );
    leads.push(l);
  }
  const { rows: [lote] } = await db.query(
    `INSERT INTO campaign_dispatches (campaign_id, client_id, name, steps, status, "offset", target_count, triggered_at)
     VALUES ($1, $2, 'Lote Principal', $3::jsonb, 'running', 0, $4, now()) RETURNING *`,
    [camp.id, T, JSON.stringify(SEQ2), nLeads]
  );
  // O que a fila grava depois de enviar (markCampaignLeadWaitingReply): é o que a trava por ciclo enxerga.
  const gravarProgressoDaFila = (lead, extra = {}) =>
    db.query(
      `UPDATE lead_import_items
          SET normalized_data = jsonb_set(normalized_data, '{campaign_progress}', jsonb_build_object($2::text, $3::jsonb), true)
        WHERE id = $1`,
      [lead.id, camp.id, JSON.stringify({
        campaignId: camp.id, waitForReply: true, status: "aguardando_usuario", currentStepIndex: 0, nextStepIndex: 1,
        totalSteps: 2, dispatchId: null, updatedAt: new Date().toISOString(), ...extra,
      })]
    );
  const rodar = async () => {
    const { rows: [campanha] } = await db.query("SELECT * FROM campaigns WHERE id = $1", [camp.id]);
    await routes.runCampaignDispatch({ dispatch: lote, campaign: campanha, supabase });
  };
  const runsDoLote = async () =>
    (await db.query("SELECT phone, status, error_message FROM campaign_dispatch_runs WHERE dispatch_id = $1 ORDER BY created_at, phone", [lote.id])).rows;
  const estado = async () => (await db.query("SELECT status, sent_count FROM campaign_dispatches WHERE id = $1", [lote.id])).rows[0];
  return { db, camp, leads, lote, rodar, runsDoLote, estado, gravarProgressoDaFila, routes };
}

// Faz o envio do lead N disparar um gancho: simula a fila gravando o progresso de OUTRO lead no meio do lote.
function aoEnviar(gancho) {
  const base = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url, init) => {
    const resposta = await base(url, init);
    if (/sendText/.test(String(url))) await gancho(String(JSON.parse(init?.body || "{}").number || ""));
    return resposta;
  });
}

describe("o lote respeita a lista de opt-out (lead_optouts)", () => {
  it("[OBRIGATÓRIO] lead em lead_optouts NÃO recebe do lote; vira 'skipped' e o lote fecha 'done'", async () => {
    const w = await mundo({ nLeads: 3 });
    const [l1, l2, l3] = w.leads;
    await w.db.query("INSERT INTO lead_optouts (client_id, phone, reason) VALUES ($1, $2, 'Opt-out via WhatsApp: parar')", [T, `+${l2.telefone}`]);
    await w.rodar();
    expect(enviados).toEqual([l1.telefone, l3.telefone]);
    const doLead2 = (await w.runsDoLote()).filter((r) => r.phone === l2.telefone);
    expect(doLead2).toHaveLength(1);
    expect(doLead2[0].status).toBe("skipped");
    expect(doLead2[0].error_message).toMatch(/opt-out/i);
    expect((await w.estado()).status).toBe("done");
  }, SLOW);

  it("regressão: sem ninguém em opt-out, o lote envia aos 3 leads", async () => {
    const w = await mundo({ nLeads: 3 });
    await w.rodar();
    expect(enviados).toEqual(w.leads.map((l) => l.telefone));
  }, SLOW);

  it("opt-out de OUTRO tenant não bloqueia este", async () => {
    const w = await mundo({ nLeads: 3 });
    await w.db.query("INSERT INTO lead_optouts (client_id, phone) VALUES ('outro-tenant', $1)", [w.leads[1].telefone]);
    await w.rodar();
    expect(enviados).toHaveLength(3);
  }, SLOW);
  it("erro ao LER o opt-out nunca libera o envio: ninguém recebe nesta rodada e nenhum lead vira 'skipped'", async () => {
    const w = await mundo({ nLeads: 3, falharOptOut: true });
    await w.rodar();
    expect(enviados).toHaveLength(0);
    expect((await w.runsDoLote()).filter((r) => r.status === "skipped")).toHaveLength(0); // sem registro: dá para retomar depois
  }, SLOW);
});
