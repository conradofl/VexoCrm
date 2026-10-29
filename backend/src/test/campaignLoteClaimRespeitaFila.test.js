// backend/src/test/campaignLoteClaimRespeitaFila.test.js
//
// PR 1b — o claim do LOTE respeita o progresso que a FILA gravou depois da montagem da lista.
//
// Caso original (29/10/2026, campanha 0423a574): o lote montou a lista às 14:28:02, com o lead 4 limpo. Às 14:28:59 o lead 1
// concluiu por resposta e a fila (startNextCampaignLeadInQueue) escolheu o lead 4 e enviou. Às 14:29:06 o lote chegou nele:
// o claimLead só olhava campaign_dispatch_runs, nunca o progresso, e enviou de novo (outra variação de texto). A trava por
// ciclo (isLeadBlockedByActiveCycleProgress) já existia, mas rodava UMA vez, na montagem da lista.
//
// Postgres REAL (pglite), lote real (runCampaignDispatch). A fila é simulada gravando o progresso do lead 2 DURANTE o envio
// do lead 1, que é exatamente a ordem do caso original: lista montada limpa, progresso gravado depois.

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

async function mundo({ falharContagem = false, falharRegistroDoPulo = false, nLeads = 7 } = {}) {
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
      if (falharRegistroDoPulo && texto.includes("Sequência já em andamento")) throw new Error("connection terminated unexpectedly");
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
  return { db, camp, leads, lote, rodar, runsDoLote, estado, gravarProgressoDaFila };
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

describe("PR 1b — claim do lote respeita o progresso gravado pela fila", () => {
  it("[OBRIGATÓRIO] a fila grava o progresso do lead 2 durante o envio do lead 1: o lote NÃO envia ao lead 2 e registra 'skipped'", async () => {
    const w = await mundo({ nLeads: 3 });
    const [l1, l2, l3] = w.leads;
    aoEnviar(async (numero) => {
      if (numero === l1.telefone) await w.gravarProgressoDaFila(l2); // a fila enviou ao lead 2 e gravou o progresso
    });

    await w.rodar();

    expect(enviados).toEqual([l1.telefone, l3.telefone]); // o lead 2 não recebeu uma segunda vez do lote
    const runs = await w.runsDoLote();
    const doLead2 = runs.filter((r) => r.phone === l2.telefone);
    expect(doLead2).toHaveLength(1);
    expect(doLead2[0].status).toBe("skipped"); // conta como processado: o lote fecha, não fica "interrompido com pendentes"
    expect(doLead2[0].error_message).toMatch(/em andamento/i);
    expect((await w.estado()).status).toBe("done");
  }, SLOW);

  it("regressão: sem progresso da fila, o lote envia aos 3 leads", async () => {
    const w = await mundo({ nLeads: 3 });
    await w.rodar();
    expect(enviados).toEqual(w.leads.map((l) => l.telefone));
    expect((await w.runsDoLote()).filter((r) => r.status === "sent")).toHaveLength(3);
    expect((await w.estado()).status).toBe("done");
  }, SLOW);

  it("progresso de sequência já concluída NÃO bloqueia o claim (mesma regra da trava por ciclo na montagem da lista)", async () => {
    const w = await mundo({ nLeads: 3 });
    const [l1, l2] = w.leads;
    aoEnviar(async (numero) => {
      if (numero === l1.telefone) await w.gravarProgressoDaFila(l2, { status: "finalizado", nextStepIndex: null });
    });
    await w.rodar();
    expect(enviados).toContain(l2.telefone);
    expect(enviados).toHaveLength(3);
  }, SLOW);
  it("se o registro do 'skipped' falhar, o lote AINDA assim não envia ao lead (o return do claim é a defesa, não o índice único)", async () => {
    const w = await mundo({ nLeads: 3, falharRegistroDoPulo: true });
    const [l1, l2, l3] = w.leads;
    aoEnviar(async (numero) => {
      if (numero === l1.telefone) await w.gravarProgressoDaFila(l2);
    });
    await w.rodar();
    expect(enviados).toEqual([l1.telefone, l3.telefone]);
    expect((await w.runsDoLote()).filter((r) => r.phone === l2.telefone)).toHaveLength(0); // nem 'claimed': nada foi reivindicado
  }, SLOW);
});
