// backend/src/test/campaignAmontoadoPosJanela.test.js
//
// Risco anotado em 17/11/2026 sobre a campanha da Nous "Evento Mesa de Negocios 2 - Planilha 1", provado em teste na
// madrugada e ACONTECIDO em produção às 09:27 SP do mesmo dia (lotes 5, 6, 7 e 8 intercalados no Chip 2 entre 09:27 e
// 09:29; log "Lote 8/50 e 11/50: já reivindicado por outro ciclo"). Conserto: trava por chip no agendador e nos botões.
// 50 lotes de 10, um por hora, todos no Chip 2. Os lotes que vencem depois que a janela fecha (21:00) são empurrados
// pelo agendador para a próxima abertura (08:00). Pergunta: às 08:00, eles rodam um depois do outro, ou ao mesmo tempo
// no mesmo chip? Regra desde a trava por chip: um depois do outro.
//
// O que se usa de verdade: Postgres (pglite), rotas reais, motor real (runCampaignDispatch), checagem de conexão real e
// o PRÓPRIO callback do setInterval de 30 s que o agendador arma em produção. Só o HTTP da Evolution é dublado. O
// envio fica preso num portão, como um lote que ainda está enviando (lead a lead, com espera entre eles).
//
// pglite tem conexão única: "ao mesmo tempo" aqui é intercalação de awaits entre dois ticks, que é exatamente o que
// acontece num processo Node só (o backend é um contêiner).

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { buildDispatchLeads } from "../campaign/dispatch.js";
import { checkEvolutionInstanceHealth } from "../services/evolution.js";

const SLOW = 120_000;
const T = "tenant-amontoado";
const SEQ = [{ id: "s1", type: "text", text: "Oi {{nome}}", order: 1, enabled: true, delayAfterSeconds: 0 }];
const CHIP_ID = "cccccccc-0000-4000-8000-0000000000c2";
const CHIP = {
  id: CHIP_ID,
  name: "Chip 2 - NOUS",
  active: true,
  dispatch_webhook_url: "https://evo.teste/message/sendText/chip-2-nous",
  dispatch_webhook_token: "t",
};
// Janela da Nous medida em produção em 17/11 03:32Z: 08:00–21:00, seg-sex, São Paulo.
const JANELA_NOUS = {
  send_window_enabled: true,
  send_window_start: "08:00",
  send_window_end: "21:00",
  send_window_days: ["mon", "tue", "wed", "thu", "fri"],
  send_window_timezone: "America/Sao_Paulo",
};
const TERCA_08H_SP = "2026-11-17T11:00:00.000Z";
const LOTES = [
  // agendados um por hora, como os lotes 2, 3 e 4 da Nous (vencem depois das 21:00 de segunda)
  { nome: "Lote 2/50", offset: 3, agendado: "2026-11-17T00:23:23Z" },
  { nome: "Lote 3/50", offset: 6, agendado: "2026-11-17T01:23:23Z" },
  { nome: "Lote 4/50", offset: 9, agendado: "2026-11-17T02:23:23Z" },
];
const POR_LOTE = 3;

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
    campaign_prompt_id UUID, evolution_instance_id UUID, recurrence_occurrence_at TIMESTAMPTZ,
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

const ate = async (cond, ms = 10_000) => {
  const t0 = performance.now(); // Date é falso neste arquivo
  while (!(await cond())) {
    if (performance.now() - t0 > ms) throw new Error("timeout esperando condição");
    await new Promise((r) => timeoutOriginal(r, 20));
  }
};

let timeoutOriginal;
let fetchOriginal;
let callbackDoIntervalo = null;
let intervalSpy;
let spies;
let db;
let campanhaId;
let tentativas; // { url, number } no momento em que o envio CHEGA à Evolution
let emVoo = 0; // envios esperando resposta da Evolution agora
let maxEmVoo = 0;
let abrirPortao;
let portao;

beforeAll(async () => {
  // O agendador arma setInterval(callback, 30000) quando ligado (startDueDispatchScheduler, como o server.js). Guarda o callback para chamá-lo como o relógio
  // chamaria, sem esperar 30 s de verdade.
  intervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation((fn, ms) => {
    if (ms === 30000 && !callbackDoIntervalo) callbackDoIntervalo = fn;
    return { unref() {}, ref() {} };
  });
  spies = ["log", "info", "warn", "error"].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));

  tentativas = [];
  portao = new Promise((r) => { abrirPortao = r; });
  fetchOriginal = globalThis.fetch;
  timeoutOriginal = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => timeoutOriginal(fn, ms >= 1000 ? 0 : ms, ...args);
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url);
    if (/sendText/.test(u)) {
      tentativas.push({ url: u, number: String(JSON.parse(init?.body || "{}").number || "") });
      emVoo += 1;
      maxEmVoo = Math.max(maxEmVoo, emVoo);
      await portao; // o lote "ainda está enviando"
      emVoo -= 1;
      return { ok: true, status: 200, json: async () => ({ key: { id: "wa" } }), text: async () => '{"key":{"id":"wa"}}' };
    }
    if (/connectionState/.test(u)) {
      const body = JSON.stringify({ instance: { state: "open" } });
      return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
  });
  vi.useFakeTimers({ toFake: ["Date"] });

  db = await createPgliteDb(SCHEMA);
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, 'Nous (teste)')", [T]);
  const pool = { query: (sql, params) => db.query(sql, params) };
  _setPgDatabasePoolForTesting(pool);
  const supabase = createPgSupabaseClient(pool);

  const { registerCampaignsRoutes } = await import("../domains/campaigns/routes.js");
  const noop = () => {};
  const rotas = registerCampaignsRoutes({ get: noop, post: noop, put: noop, patch: noop, delete: noop, use: noop }, {
    CAMPAIGN_SCHEDULER_MAX_BATCH: 10, buildDispatchLeads, canCampaignBeDispatched: () => true,
    checkEvolutionInstanceHealth, continueCampaignLeadFromReply: async () => {},
    ensureDb: () => true, executeCampaignDispatch: async () => {}, findCampaignReplyMatches: async () => [],
    getClientName: async () => "Nous (teste)", getLeadClientEvolutionInstances: async () => [CHIP],
    getLeadClientN8nSettings: async () => JANELA_NOUS, getRequestId: () => "req",
    getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}), isMissingSchemaError: () => false,
    isProduction: false, logCampaignReplyFlow: noop, logDirectDispatch: noop, maskPhoneForLog: (p) => p,
    normalizeIsoDate: (d) => d, leadsTableName: "lead_import_items", normalizeString: (s) => String(s ?? "").trim(),
    normalizeTenantKey: (s) => String(s || "").trim(), parseOptionalUuid: (s) => ({ value: s }), pgDatabasePool: pool,
    requireAppViewAccess: () => (req, res, next) => next(), requireCampaignDispatchAccess: (req, res, next) => next(),
    requireFirebaseAuth: (req, res, next) => next(), requireInternalPageAccess: () => (req, res, next) => next(),
    resolveAuthorizedClientId: () => T,
    resolveCampaignDispatchSettings: async () => ({ webhookUrl: CHIP.dispatch_webhook_url, webhookToken: "t" }),
    resolveDispatchWebhookSettings: async () => ({}), runDueCampaignDispatches: async () => {}, sanitizePhone: (p) => p,
    sendError: (res, s, c, m) => res.status(s).json({ error: { code: c, message: m } }),
    supabase, validateN8nInboundBearer: () => true,
  });
  // Desde 25/11/2026 o tick não nasce no registro das rotas: o server.js liga, com o runDueIndependentDispatches das rotas.
  const { startDueDispatchScheduler } = await import("../campaign/dueDispatchScheduler.js");
  startDueDispatchScheduler({ runDueIndependentDispatches: rotas.runDueIndependentDispatches, pgDatabasePool: pool });

  const { rows: [camp] } = await db.query(
    "INSERT INTO campaigns (client_id, name, analytics_meta, limit_per_run) VALUES ($1, 'Evento Mesa de Negocios 2 - Planilha 1', $2::jsonb, 50) RETURNING id",
    [T, JSON.stringify({ importSource: "__crm__", sequence: SEQ })]
  );
  campanhaId = camp.id;
  const nLeads = POR_LOTE * (LOTES.length + 1);
  for (let i = 0; i < nLeads; i += 1) {
    await db.query("INSERT INTO leads (client_id, telefone, nome, created_at) VALUES ($1, $2, $3, $4)", [
      T, `553499990${1000 + i}`, `Lead ${i}`, new Date(Date.UTC(2026, 10, 10, 12, 0, i)).toISOString(),
    ]);
  }
  for (const l of LOTES) {
    await db.query(
      `INSERT INTO campaign_dispatches (campaign_id, client_id, name, steps, status, trigger_type, scheduled_at, "offset", limit_per_run, target_count, evolution_instance_id)
       VALUES ($1, $2, $3, $4::jsonb, 'scheduled', 'scheduled', $5, $6, $7, $7, $8)`,
      [campanhaId, T, l.nome, JSON.stringify(SEQ), l.agendado, l.offset, POR_LOTE, CHIP_ID]
    );
  }
}, SLOW);

afterAll(async () => {
  (await import("../campaign/dueDispatchScheduler.js")).stopDueDispatchScheduler();
  abrirPortao?.();
  vi.useRealTimers();
  globalThis.fetch = fetchOriginal;
  globalThis.setTimeout = timeoutOriginal;
  intervalSpy?.mockRestore();
  spies?.forEach((s) => s.mockRestore());
  _setPgDatabasePoolForTesting(null);
  await db?.close();
});

const lotes = async () =>
  (await db.query(
    "SELECT id, name, status, scheduled_at, evolution_instance_id, sent_count FROM campaign_dispatches WHERE campaign_id = $1 ORDER BY name",
    [campanhaId]
  )).rows;
const loteDoNumero = async (numero) =>
  (await db.query("SELECT dispatch_id FROM campaign_dispatch_runs WHERE phone = $1 LIMIT 1", [numero])).rows[0]?.dispatch_id || null;

describe("[OBRIGATÓRIO] trava por chip: lotes adiados pela janela vencem juntos às 08:00 e rodam UM DE CADA VEZ no chip", () => {
  it("o agendador armou o intervalo de 30 s (o callback testado abaixo é o de produção)", () => {
    expect(typeof callbackDoIntervalo).toBe("function");
  });

  it("noite de segunda: cada lote que vence depois das 21:00 é empurrado para a MESMA hora, terça 08:00", async () => {
    for (const l of LOTES) {
      vi.setSystemTime(new Date(new Date(l.agendado).getTime() + 7 * 60_000)); // o tick de ~7 min depois do vencimento
      await callbackDoIntervalo();
    }
    const l = await lotes();
    expect(l.map((x) => x.status)).toEqual(["scheduled", "scheduled", "scheduled"]);
    expect(l.map((x) => new Date(x.scheduled_at).toISOString())).toEqual([TERCA_08H_SP, TERCA_08H_SP, TERCA_08H_SP]);
    expect(tentativas).toHaveLength(0);
  }, SLOW);

  it("terça 08:00: o 1º tick prende num lote que ainda está enviando; o 2º e o 3º tick NÃO começam outro lote no mesmo chip", async () => {
    vi.setSystemTime(new Date("2026-11-17T11:00:10Z"));
    const tick1 = callbackDoIntervalo(); // não termina enquanto o lote dele estiver enviando
    await ate(() => tentativas.length === 1);
    const loteA = await loteDoNumero(tentativas[0].number);
    expect(loteA).toBeTruthy();

    // 30 s e 60 s depois: os ticks seguintes terminam sem começar nada (antes: cada um começava outro lote no Chip 2).
    vi.setSystemTime(new Date("2026-11-17T11:00:40Z"));
    await callbackDoIntervalo();
    vi.setSystemTime(new Date("2026-11-17T11:01:10Z"));
    await callbackDoIntervalo();
    expect(tentativas).toHaveLength(1);
    const agora = await lotes();
    expect(agora.filter((x) => x.status === "running").map((x) => x.id)).toEqual([loteA]);
    const esperando = agora.filter((x) => x.id !== loteA);
    expect(esperando.map((x) => x.status)).toEqual(["scheduled", "scheduled"]);
    const motivos = (await db.query("SELECT error_message FROM campaign_dispatches WHERE id = ANY($1::uuid[])", [esperando.map((x) => x.id)])).rows;
    for (const m of motivos) expect(m.error_message).toMatch(/^Aguardando o chip terminar outro lote \(".+"\)\. Começa logo em seguida, sem precisar clicar\.$/);

    // Solta o chip: o tick 1 segue a fila dele e roda os outros dois, um depois do outro.
    abrirPortao();
    await tick1;
    await ate(async () => (await lotes()).every((x) => x.status !== "running"));
    const fim = await lotes();
    expect(fim.map((x) => x.status)).toEqual(["done", "done", "done"]);
    expect(tentativas).toHaveLength(POR_LOTE * LOTES.length);
    expect(new Set(tentativas.map((t) => t.number)).size).toBe(POR_LOTE * LOTES.length);
    expect(maxEmVoo).toBe(1); // nunca dois envios do mesmo chip esperando a Evolution ao mesmo tempo
  }, SLOW);
});
