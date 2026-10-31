// backend/src/test/campaignTriggerSendWindow.test.js
//
// "⚡ Disparar Lote N Agora" (POST /api/campaigns/dispatches/:dispatchId/trigger) obedece a janela de envio do tenant.
// Até 30/10/2026 a rota passava ignoreSendWindow: true ao motor sem perguntar: o lote do geracao-digital saiu 18:38 com
// janela até 18:30, enquanto a tela prometia "Término: hoje, por volta das 18h". Agora fora da janela a rota recusa com
// 422 OUTSIDE_SEND_WINDOW e só envia quando a tela repete a chamada com forceOutsideWindow: true (e isso vai pro log).
//
// Postgres REAL (pglite), rotas reais, motor real. Só o que sai do processo é dublado: o envio HTTP (fetch) e a
// configuração do tenant (deps.getLeadClientN8nSettings, que em produção lê lead_client_n8n_settings). O relógio é
// fixado com vi.setSystemTime (só Date; os timers seguem reais).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { buildDispatchLeads } from "../campaign/dispatch.js";

const SLOW = 120_000;
const T = "tenant-janela";
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

// Janela do teste do Gabriel (geracao-digital, 30/10/2026): seg-sex até 18:30, horário de Brasília.
const JANELA_SP = {
  send_window_enabled: true,
  send_window_start: "08:00",
  send_window_end: "18:30",
  send_window_days: ["mon", "tue", "wed", "thu", "fri"],
  send_window_timezone: "America/Sao_Paulo",
};

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
let warnSpy;
let infoSpy;
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
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ["Date"] });
});
// Quando um teste falha com o lote ainda rodando em segundo plano, o motor seguiria gravando no pool do teste
// seguinte (o pool é global) e derrubaria um teste que não tem nada com isso. Espera o lote do teste terminar.
let mundoAtual = null;
afterEach(async () => {
  if (mundoAtual) await mundoAtual.esperarFim().catch(() => {});
  mundoAtual = null;
  vi.useRealTimers();
  globalThis.fetch = fetchOriginal;
  globalThis.setTimeout = timeoutOriginal;
  logSpy.mockRestore();
  errorSpy.mockRestore();
  warnSpy.mockRestore();
  infoSpy.mockRestore();
});

const abertos = [];
afterAll(async () => {
  for (const db of abertos) await db.close();
});

async function mundo({ janela, nLeads = 3 }) {
  const db = await createPgliteDb(SCHEMA);
  abertos.push(db);
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, 'Tenant Janela')", [T]);
  const pool = { query: (sql, params) => db.query(sql, params) };
  _setPgDatabasePoolForTesting(pool);
  const supabase = createPgSupabaseClient(pool);

  const { registerCampaignsRoutes } = await import("../domains/campaigns/routes.js");
  const handlers = {};
  const guardar = (metodo) => (path, ...hs) => {
    handlers[`${metodo} ${path}`] = hs[hs.length - 1];
  };
  const app = { get: guardar("GET"), post: guardar("POST"), put: guardar("PUT"), patch: guardar("PATCH"), delete: guardar("DELETE"), use() {} };
  const noop = () => {};
  registerCampaignsRoutes(app, {
    CAMPAIGN_SCHEDULER_MAX_BATCH: 10, buildDispatchLeads, canCampaignBeDispatched: () => true,
    checkEvolutionInstanceHealth: async () => ({ state: "open" }), continueCampaignLeadFromReply: async () => {},
    ensureDb: () => true, executeCampaignDispatch: async () => {}, findCampaignReplyMatches: async () => [],
    getClientName: async () => "Tenant Janela", getLeadClientEvolutionInstances: async () => [],
    getLeadClientN8nSettings: async () => janela, getRequestId: () => "req",
    getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}), isMissingSchemaError: () => false,
    isProduction: false, logCampaignReplyFlow: noop, logDirectDispatch: noop, maskPhoneForLog: (p) => p,
    normalizeIsoDate: (d) => d, leadsTableName: "lead_import_items", normalizeString: (s) => String(s ?? "").trim(),
    normalizeTenantKey: (s) => String(s || "").trim(), parseOptionalUuid: (s) => ({ value: s }), pgDatabasePool: pool,
    requireAppViewAccess: () => (req, res, next) => next(), requireCampaignDispatchAccess: (req, res, next) => next(),
    requireFirebaseAuth: (req, res, next) => next(), requireInternalPageAccess: () => (req, res, next) => next(),
    resolveAuthorizedClientId: () => T,
    resolveCampaignDispatchSettings: async () => ({ webhookUrl: "https://evo.teste/message/sendText/janela", webhookToken: "t" }),
    resolveDispatchWebhookSettings: async () => ({}), runDueCampaignDispatches: async () => {}, sanitizePhone: (p) => p,
    // Mesmo corpo do sendError de produção (services/httpInfra.js), sem o cabeçalho de CORS.
    sendError: (res, s, c, m, d) => res.status(s).json({ error: { code: c, message: m, ...(d ? { details: d } : {}) } }),
    supabase, validateN8nInboundBearer: () => true,
  });

  const { rows: [camp] } = await db.query(
    "INSERT INTO campaigns (client_id, name, analytics_meta, limit_per_run) VALUES ($1, 'Funil Janela', $2::jsonb, 50) RETURNING *",
    [T, JSON.stringify({ importSource: "__crm__", sequence: SEQ })]
  );
  for (let i = 0; i < nLeads; i += 1) {
    await db.query(
      "INSERT INTO leads (client_id, telefone, nome, created_at) VALUES ($1, $2, $3, $4)",
      [T, `5511990${1000 + i}`, `Lead ${i}`, new Date(Date.UTC(2026, 9, 20, 12, 0, i)).toISOString()]
    );
  }
  const { rows: [lote] } = await db.query(
    `INSERT INTO campaign_dispatches (campaign_id, client_id, name, steps, status, trigger_type, scheduled_at, "offset", limit_per_run, target_count)
     VALUES ($1, $2, 'Lote 1/1', $3::jsonb, 'scheduled', 'scheduled', '2026-11-02T11:00:00Z', 0, $4, $4) RETURNING *`,
    [camp.id, T, JSON.stringify(SEQ), nLeads]
  );

  const estado = async () => (await db.query("SELECT status, sent_count FROM campaign_dispatches WHERE id = $1", [lote.id])).rows[0];
  const runs = async () => (await db.query("SELECT status FROM campaign_dispatch_runs WHERE dispatch_id = $1", [lote.id])).rows;
  const disparar = async (body = {}) => {
    const out = { status: 200, body: null };
    const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
    await handlers["POST /api/campaigns/dispatches/:dispatchId/trigger"](
      { params: { dispatchId: lote.id }, body, authAccess: { uid: "uid-gabriel", email: "gabriel@teste" } },
      res
    );
    return out;
  };
  // O motor roda em segundo plano depois da resposta HTTP: espera o lote sair de 'running' (timers reais).
  const esperarFim = async () => {
    for (let i = 0; i < 600; i += 1) {
      const e = await estado();
      if (e.status !== "running") return e;
      await new Promise((r) => timeoutOriginal(r, 50));
    }
    throw new Error("lote não terminou");
  };
  mundoAtual = { esperarFim };
  return { db, lote, estado, runs, disparar, esperarFim };
}

const SEXTA_15H_SP = "2026-10-30T18:00:00Z"; // sexta 15:00 em São Paulo (UTC-3)
const SEXTA_18H38_SP = "2026-10-30T21:38:00Z"; // sexta 18:38 em São Paulo — o clique do Gabriel
const SABADO_10H_SP = "2026-10-31T13:00:00Z"; // sábado 10:00 em São Paulo
const SEGUNDA_08H_SP = "2026-11-02T11:00:00.000Z"; // próxima abertura depois de sexta 18:38

describe("Disparar Agora respeita a janela de envio (POST /api/campaigns/dispatches/:dispatchId/trigger)", () => {
  it("1. dentro da janela: dispara normal", async () => {
    vi.setSystemTime(new Date(SEXTA_15H_SP));
    const w = await mundo({ janela: JANELA_SP });
    const out = await w.disparar();
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ success: true, status: "running", dispatchId: w.lote.id });
    expect((await w.esperarFim()).status).toBe("done");
    expect(enviados).toHaveLength(3);
  }, SLOW);

  it("2. fora da janela sem force: 422 OUTSIDE_SEND_WINDOW com a janela e a próxima abertura, e nada é enviado", async () => {
    vi.setSystemTime(new Date(SEXTA_18H38_SP));
    const w = await mundo({ janela: JANELA_SP });
    const out = await w.disparar();
    expect(out.status).toBe(422);
    expect(out.body.error.code).toBe("OUTSIDE_SEND_WINDOW");
    expect(out.body.error.message).toContain("horário local 18:38");
    expect(out.body.error.details).toMatchObject({
      localTime: "18:38",
      start: "08:00",
      end: "18:30",
      timezone: "America/Sao_Paulo",
      nextOpening: SEGUNDA_08H_SP,
    });
    // Valor que não é o booleano true não força: a confirmação tem que ser explícita.
    for (const forceOutsideWindow of ["true", 1, "1", {}]) {
      const tentativa = await w.disparar({ forceOutsideWindow });
      expect(tentativa.status).toBe(422);
    }
    await new Promise((r) => timeoutOriginal(r, 200));
    expect(enviados).toHaveLength(0);
    expect(await w.runs()).toHaveLength(0);
    expect((await w.estado()).status).toBe("scheduled");
  }, SLOW);

  it("3. fora da janela com forceOutsideWindow: true: dispara e o log registra o forçamento", async () => {
    vi.setSystemTime(new Date(SEXTA_18H38_SP));
    const w = await mundo({ janela: JANELA_SP });
    const out = await w.disparar({ forceOutsideWindow: true });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ success: true, status: "running", dispatchId: w.lote.id, forcedOutsideWindow: true });
    expect((await w.esperarFim()).status).toBe("done");
    expect(enviados).toHaveLength(3);
    const registro = warnSpy.mock.calls.find((c) => c[0] === "[campaign-dispatch] disparo_forcado_fora_da_janela");
    expect(registro).toBeDefined();
    expect(registro[1]).toMatchObject({
      clientId: T,
      dispatchId: w.lote.id,
      uid: "uid-gabriel",
      email: "gabriel@teste",
      localTime: "18:38",
      sendWindow: "08:00–18:30 [mon,tue,wed,thu,fri] (America/Sao_Paulo)",
      nextOpening: SEGUNDA_08H_SP,
    });
  }, SLOW);

  it("4. janela desligada no tenant: dispara sempre, até domingo de madrugada, sem forçamento no log", async () => {
    vi.setSystemTime(new Date("2026-11-01T06:00:00Z")); // domingo 03:00 em São Paulo
    const w = await mundo({ janela: { ...JANELA_SP, send_window_enabled: false } });
    const out = await w.disparar();
    expect(out.status).toBe(200);
    expect((await w.esperarFim()).status).toBe("done");
    expect(enviados).toHaveLength(3);
    expect(warnSpy.mock.calls.some((c) => c[0] === "[campaign-dispatch] disparo_forcado_fora_da_janela")).toBe(false);
  }, SLOW);

  it("5. sábado com dias = seg-sex, em horário que seria permitido: recusa", async () => {
    vi.setSystemTime(new Date(SABADO_10H_SP));
    const w = await mundo({ janela: JANELA_SP });
    const out = await w.disparar();
    expect(out.status).toBe(422);
    expect(out.body.error.code).toBe("OUTSIDE_SEND_WINDOW");
    expect(out.body.error.details.nextOpening).toBe(SEGUNDA_08H_SP);
    expect(enviados).toHaveLength(0);
  }, SLOW);

  it("6. fuso: tenant em Tóquio decide pelo horário de Tóquio, não pelo de São Paulo", async () => {
    const JANELA_TOQUIO = { ...JANELA_SP, send_window_end: "18:00", send_window_timezone: "Asia/Tokyo" };

    // sexta 12:00 em São Paulo (dentro do horário de lá) = sábado 00:00 em Tóquio → fora da janela do tenant
    vi.setSystemTime(new Date("2026-10-30T15:00:00Z"));
    const fora = await mundo({ janela: JANELA_TOQUIO });
    const recusa = await fora.disparar();
    expect(recusa.status).toBe(422);
    expect(recusa.body.error.details).toMatchObject({ localTime: "00:00", timezone: "Asia/Tokyo" });
    expect(enviados).toHaveLength(0);

    // quinta 22:00 em São Paulo (fora do horário de lá) = sexta 10:00 em Tóquio → dentro da janela do tenant
    vi.setSystemTime(new Date("2026-10-30T01:00:00Z"));
    const dentro = await mundo({ janela: JANELA_TOQUIO });
    const ok = await dentro.disparar();
    expect(ok.status).toBe(200);
    expect((await dentro.esperarFim()).status).toBe("done");
    expect(enviados).toHaveLength(3);
  }, SLOW);
});
