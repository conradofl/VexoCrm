// backend/src/test/campaignRepeatContact.test.js
//
// Lead que já recebeu OUTRA campanha (26/11/2026, Advocacia Almeida: campanha nova com a mesma planilha mandou de novo
// para quem já tinha recebido). Postgres real (pglite), rotas reais, motor real; só o HTTP da Evolution é dublado.
// Mundo copiado de campaignTravaPorChip.test.js, com lote em offset escolhido e chamada por campanha.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { buildDispatchLeads } from "../campaign/dispatch.js";
import { checkEvolutionInstanceHealth } from "../services/evolution.js";

const SLOW = 120_000;
// PR 10d: a trava por chip também mora no banco. Todos os casos rodam com a tabela (migration real).
const MIGRATION_LEASES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations", "20261125150000_campaign_chip_leases.sql");
const T = "tenant-trava";
const SEQ = [{ id: "s1", type: "text", text: "Oi {{nome}}", order: 1, enabled: true, delayAfterSeconds: 0 }];
const SEQ_AGENDA = [{ id: "s-agenda", type: "text", text: "Agende: {{scheduling_link}}", order: 1, enabled: true, delayAfterSeconds: 0 }];
const chip = (n, id) => ({
  id,
  name: `Chip ${n}`,
  active: true,
  dispatch_webhook_url: `https://evo.teste/message/sendText/chip-${n}`,
  dispatch_webhook_token: `t${n}`,
});
const CHIP_2 = chip(2, "cccccccc-0000-4000-8000-0000000000c2");
const CHIP_3 = chip(3, "cccccccc-0000-4000-8000-0000000000c3");
const PASSADO = "2026-01-01T00:00:00Z";

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
  CREATE TABLE public.crm_consultant_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, name TEXT, scheduling_link TEXT, active BOOLEAN DEFAULT true
  );
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
let envios; // { url, number }
let emVoo; // por URL de chip: envios esperando a Evolution agora
let maxEmVoo; // por URL de chip
let segurar;
let abrirPortao;
let portao;
let spies;
beforeEach(() => {
  envios = [];
  emVoo = {};
  maxEmVoo = {};
  segurar = false;
  portao = new Promise((r) => { abrirPortao = r; });
  fetchOriginal = globalThis.fetch;
  timeoutOriginal = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => timeoutOriginal(fn, ms >= 1000 ? 0 : ms, ...args);
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url);
    if (/sendText/.test(u)) {
      envios.push({ url: u, number: String(JSON.parse(init?.body || "{}").number || "") });
      emVoo[u] = (emVoo[u] || 0) + 1;
      maxEmVoo[u] = Math.max(maxEmVoo[u] || 0, emVoo[u]);
      if (segurar) await portao;
      emVoo[u] -= 1;
      return { ok: true, status: 200, json: async () => ({ key: { id: "wa" } }), text: async () => '{"key":{"id":"wa"}}' };
    }
    if (/connectionState/.test(u)) {
      const body = JSON.stringify({ instance: { state: "open" } });
      return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
  });
  spies = ["log", "info", "warn", "error"].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});

const abertos = [];
let mundoAtual = null;
afterEach(async () => {
  abrirPortao?.();
  if (mundoAtual) await mundoAtual.esperarNenhumRodando().catch(() => {});
  mundoAtual = null;
  globalThis.fetch = fetchOriginal;
  globalThis.setTimeout = timeoutOriginal;
  spies.forEach((s) => s.mockRestore());
});
afterAll(async () => {
  for (const db of abertos) await db.close();
});

const ate = async (cond, ms = 10_000) => {
  const t0 = performance.now();
  while (!(await cond())) {
    if (performance.now() - t0 > ms) throw new Error("timeout esperando condição");
    await new Promise((r) => timeoutOriginal(r, 20));
  }
};

async function mundo({ instancias = [CHIP_2, CHIP_3] } = {}) {
  const db = await createPgliteDb(SCHEMA);
  abertos.push(db);
  await db.exec(await readFile(MIGRATION_LEASES, "utf8"));
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, 'Empresa da trava')", [T]);
  for (let i = 0; i < 20; i += 1) {
    await db.query("INSERT INTO leads (client_id, telefone, nome, created_at) VALUES ($1, $2, $3, $4)", [
      T, `553499991${1000 + i}`, `Lead ${i}`, new Date(Date.UTC(2026, 0, 10, 12, 0, i)).toISOString(),
    ]);
  }
  const pool = { query: (sql, params) => db.query(sql, params) };
  _setPgDatabasePoolForTesting(pool);
  const supabase = createPgSupabaseClient(pool);

  // Cada chamada é um "processo" (registro de rotas com a sua trava em memória); o banco é o mesmo.
  const registrar = async () => {
    const { registerCampaignsRoutes } = await import("../domains/campaigns/routes.js");
    const handlers = {};
    const guardar = (metodo) => (path, ...hs) => { handlers[`${metodo} ${path}`] = hs[hs.length - 1]; };
    const app = { get: guardar("GET"), post: guardar("POST"), put: guardar("PUT"), patch: guardar("PATCH"), delete: guardar("DELETE"), use() {} };
    const noop = () => {};
    const routes = registerCampaignsRoutes(app, {
      CAMPAIGN_SCHEDULER_MAX_BATCH: 10, buildDispatchLeads, canCampaignBeDispatched: () => true,
      checkEvolutionInstanceHealth, continueCampaignLeadFromReply: async () => {},
      ensureDb: () => true, executeCampaignDispatch: async () => {}, findCampaignReplyMatches: async () => [],
      getClientName: async () => "Empresa da trava", getLeadClientEvolutionInstances: async () => instancias,
      getLeadClientN8nSettings: async () => ({ send_window_enabled: false }), getRequestId: () => "req",
      getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}), isMissingSchemaError: () => false,
      isProduction: false, logCampaignReplyFlow: noop, logDirectDispatch: noop, maskPhoneForLog: (p) => p,
      normalizeIsoDate: (d) => d, leadsTableName: "lead_import_items", normalizeString: (s) => String(s ?? "").trim(),
      normalizeTenantKey: (s) => String(s || "").trim(), parseOptionalUuid: (s) => ({ value: s }), pgDatabasePool: pool,
      requireAppViewAccess: () => (req, res, next) => next(), requireCampaignDispatchAccess: (req, res, next) => next(),
      requireFirebaseAuth: (req, res, next) => next(), requireInternalPageAccess: () => (req, res, next) => next(),
      resolveAuthorizedClientId: () => T,
      // O webhook de envio é o do chip do lote (como em produção, source 'campaign_evolution_instance').
      resolveCampaignDispatchSettings: async (clientId, campaign, opts = {}) => {
        const id = opts?.dispatchOptions?.evolutionInstanceId || campaign?.analytics_meta?.dispatchOptions?.evolutionInstanceId;
        const c = instancias.find((i) => i.id === id) || instancias[0];
        return { webhookUrl: c.dispatch_webhook_url, webhookToken: c.dispatch_webhook_token };
      },
      resolveDispatchWebhookSettings: async () => ({}), runDueCampaignDispatches: async () => {}, sanitizePhone: (p) => p,
      sendError: (res, s, c, m, d) => res.status(s).json({ error: { code: c, message: m, ...(d ? { details: d } : {}) } }),
      supabase, validateN8nInboundBearer: () => true,
    });
    return { handlers, routes };
  };
  const { handlers, routes } = await registrar();

  let offsetLivre = 0;
  const campanha = async (nome) => {
    const { rows: [c] } = await db.query(
      "INSERT INTO campaigns (client_id, name, analytics_meta, limit_per_run) VALUES ($1, $2, $3::jsonb, 50) RETURNING id",
      [T, nome, JSON.stringify({ importSource: "__crm__", sequence: SEQ })]
    );
    return c.id;
  };
  const lote = async ({ campanhaId, nome, chipId, status = "scheduled", n = 2, seq = SEQ, errorMessage = null, scheduledAt = PASSADO, offset: offsetFixo = null }) => {
    const offset = offsetFixo ?? offsetLivre;
    offsetLivre += n;
    const { rows: [l] } = await db.query(
      `INSERT INTO campaign_dispatches (campaign_id, client_id, name, steps, status, trigger_type, scheduled_at, "offset", limit_per_run, target_count, evolution_instance_id, error_message)
       VALUES ($1, $2, $3, $4::jsonb, $5, 'scheduled', $6, $7, $8, $8, $9, $10) RETURNING id`,
      [campanhaId, T, nome, JSON.stringify(seq), status, scheduledAt, offset, n, chipId, errorMessage]
    );
    return l.id;
  };
  const estado = async (id) =>
    (await db.query("SELECT status, error_message, sent_count FROM campaign_dispatches WHERE id = $1", [id])).rows[0];
  const chamar = async (rota, dispatchId, body = {}, h = handlers) => {
    const out = { status: 200, body: null };
    const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
    await h[rota]({ params: { dispatchId }, body, query: {}, authAccess: { uid: "uid", email: "e@teste" } }, res);
    return out;
  };
  const disparar = (id) => chamar("POST /api/campaigns/dispatches/:dispatchId/trigger", id);
  const naoProcessados = (id) => chamar("POST /api/campaigns/dispatches/:dispatchId/run-pending", id);
  const tick = () => routes.runDueIndependentDispatches({ limit: 10 });
  const esperarNenhumRodando = () =>
    ate(async () => (await db.query("SELECT count(*)::int AS n FROM campaign_dispatches WHERE status = 'running'")).rows[0].n === 0);
  mundoAtual = { esperarNenhumRodando };
  const outroProcesso = async () => {
    const r = await registrar();
    return { disparar: (id) => chamar("POST /api/campaigns/dispatches/:dispatchId/trigger", id, {}, r.handlers) };
  };
  const porCampanha = async (metodo, rota, campaignId, body = {}) => {
    const out = { status: 200, body: null };
    const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
    await handlers[`${metodo} ${rota}`]({ params: { campaignId }, body, query: {}, authAccess: { uid: "uid", email: "e@teste" } }, res);
    return out;
  };
  const repetidos = (campaignId) => porCampanha("GET", "/api/campaigns/:campaignId/repeat-contacts", campaignId);
  const decidir = (campaignId, decisao, extra = {}) => porCampanha("PUT", "/api/campaigns/:campaignId/repeat-contacts-decision", campaignId, { decisao, ...extra });
  const runs = async (id) => (await db.query("SELECT phone, status, error_message FROM campaign_dispatch_runs WHERE dispatch_id = $1 ORDER BY phone", [id])).rows;
  return { db, campanha, lote, estado, disparar, naoProcessados, tick, esperarNenhumRodando, outroProcesso, repetidos, decidir, runs };
}

const enviosDe = (c) => envios.filter((e) => e.url === c.dispatch_webhook_url);


describe("[OBRIGATÓRIO] lead que já recebeu outra campanha: pergunta antes de mandar de novo", () => {
  // Campanha A manda para os leads 0 e 1. Campanha B tem um lote com os leads 0, 1, 2 e 3 (mesma base).
  async function cenario() {
    const w = await mundo();
    const a = await w.campanha("Campanha A");
    const loteA = await w.lote({ campanhaId: a, nome: "A lote 1", chipId: CHIP_2.id, n: 2, offset: 0 });
    expect((await w.disparar(loteA)).status).toBe(200);
    await w.esperarNenhumRodando();
    expect((await w.estado(loteA)).status).toBe("done");
    const b = await w.campanha("Campanha B");
    const loteB = await w.lote({ campanhaId: b, nome: "B lote 1", chipId: CHIP_2.id, n: 4, offset: 0 });
    envios.length = 0;
    return { w, a, b, loteB };
  }

  it("sem decisão: o lote PARA antes de mandar qualquer coisa e diz quantos já receberam e de qual campanha", async () => {
    const { w, loteB } = await cenario();
    await w.disparar(loteB);
    await w.esperarNenhumRodando();
    const e = await w.estado(loteB);
    expect(e.status).toBe("paused");
    expect(e.error_message).toMatch(/^Aguardando sua decisão/);
    expect(e.error_message).toContain('"Campanha A" (2)');
    expect(envios).toHaveLength(0);
  }, SLOW);

  it("a tela conta os repetidos da campanha antes de disparar", async () => {
    const { w, b } = await cenario();
    const r = await w.repetidos(b);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ jaReceberam: 2, decisao: null });
    expect(r.body.campanhas[0]).toMatchObject({ campaignName: "Campanha A", count: 2 });
  }, SLOW);

  it("decisão 'pular': libera o lote parado; os 2 repetidos ficam 'skipped' com o nome da campanha e só os 2 novos recebem", async () => {
    const { w, b, loteB } = await cenario();
    await w.disparar(loteB);
    await w.esperarNenhumRodando();
    const d = await w.decidir(b, "pular");
    expect(d.body).toMatchObject({ ok: true, decisao: "pular", lotesLiberados: 1 });
    expect((await w.estado(loteB)).status).toBe("scheduled");
    await w.disparar(loteB);
    await w.esperarNenhumRodando();
    const rs = await w.runs(loteB);
    expect(rs.filter((r) => r.status === "skipped")).toHaveLength(2);
    expect(rs.find((r) => r.status === "skipped").error_message).toContain("Campanha A");
    expect(rs.filter((r) => r.status === "sent")).toHaveLength(2);
    expect(new Set(envios.map((e) => e.number)).size).toBe(2);
    expect((await w.estado(loteB)).status).toBe("done");
  }, SLOW);

  it("decisão 'enviar': manda para os 4, inclusive quem já recebeu", async () => {
    const { w, b, loteB } = await cenario();
    await w.decidir(b, "enviar");
    await w.disparar(loteB);
    await w.esperarNenhumRodando();
    expect(new Set(envios.map((e) => e.number)).size).toBe(4);
    expect((await w.estado(loteB)).status).toBe("done");
  }, SLOW);

  it("'Retomar' depois da pergunta: grava sem liberar (liberarLotes=false); o lote parado continua parado para a própria ação retomar", async () => {
    const { w, b, loteB } = await cenario();
    await w.disparar(loteB);
    await w.esperarNenhumRodando();
    const d = await w.decidir(b, "enviar", { liberarLotes: false });
    expect(d.body).toMatchObject({ ok: true, decisao: "enviar", lotesLiberados: 0 });
    expect((await w.estado(loteB)).status).toBe("paused");
    await w.disparar(loteB); // a ação que a pessoa clicou
    await w.esperarNenhumRodando();
    expect(new Set(envios.map((e) => e.number)).size).toBe(4);
  }, SLOW);

  it("decisão inválida é recusada", async () => {
    const { w, b } = await cenario();
    expect((await w.decidir(b, "talvez")).status).toBe(400);
  }, SLOW);

  it("sem nenhum repetido o lote sai normal, sem perguntar", async () => {
    const w = await mundo();
    const c = await w.campanha("Campanha C");
    const l = await w.lote({ campanhaId: c, nome: "C lote 1", chipId: CHIP_2.id, n: 2, offset: 10 });
    await w.disparar(l);
    await w.esperarNenhumRodando();
    expect((await w.estado(l)).status).toBe("done");
  }, SLOW);
});
