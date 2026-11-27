// backend/src/test/chipDiary.test.js
//
// Diário do chip (services/chipDiary.js + migration 20261117190000). Caso real: Nous, 17/11/2026. Leitura de produção
// às 14:14Z de /instance/fetchInstances: os quatro chips caídos tinham disconnectionReasonCode 401 e
// disconnectionObject "conflict / device_removed"; o Chip 2 caiu às 12:38:21Z, 7 s depois do último envio do sistema
// (12:38:14Z), com 46 envios de lote desde 12:27:54Z e a cota do dia em 50/50. O Vexo não sabia de nada disso.
//
// Postgres REAL (pglite) com a migration DO PRODUTO aplicada; serviço real, rota real, motor de disparo real. Só o que
// sai do processo é dublado: o HTTP da Evolution, com o corpo no formato medido.

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { buildDispatchLeads } from "../campaign/dispatch.js";
import { checkEvolutionInstanceHealth } from "../services/evolution.js";
import { describeChipDisconnect, listChipDiary, sampleChipConnections } from "../services/chipDiary.js";

const SLOW = 120_000;
const MIGRATION = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations", "20261117190000_create_evolution_instance_events.sql"),
  "utf8"
);
const NOUS = "nous-gestao";
const EVO = "https://evo.teste";
const CONFIG = { baseUrl: EVO, apiKey: "chave-de-teste", configured: true };
const chip = (n, id, extra = {}) => ({
  id,
  name: n === "moacir" ? "Pessoal - Moacir" : `Chip ${n} - NOUS`,
  instancia: n === "moacir" ? "nous-gestao-pessoal-moacir" : `nous-gestao-chip-${n}-nous`,
  ...extra,
});
const C1 = chip(1, "0d6d0c10-0000-4000-8000-000000000001");
const C2 = chip(2, "84e785c6-9978-4ddd-89c6-71e69d77e948");
const C3 = chip(3, "45f1ee34-0000-4000-8000-000000000003");
const C4 = chip(4, "e5a51d87-0000-4000-8000-000000000004");
const CM = chip("moacir", "9f31f504-0000-4000-8000-000000000005");
const NOUS_CHIPS = [C1, C2, C3, C4, CM];

// disconnectionObject exatamente como a Evolution devolveu em produção (17/11 14:14Z).
const objetoDeviceRemoved = (date) => ({
  error: {
    data: { tag: "conflict", attrs: { type: "device_removed" } },
    isBoom: true,
    isServer: false,
    output: { statusCode: 401, payload: { statusCode: 401, error: "Unauthorized", message: "Stream Errored (conflict)" }, headers: {} },
  },
  date,
});
const instanciaEvolution = (c, { status = "close", at = null, code = 401, updatedAt = null, objeto } = {}) => ({
  id: `evo-${c.id.slice(0, 4)}`,
  name: c.instancia,
  connectionStatus: status,
  ownerJid: "5500000000000@s.whatsapp.net",
  integration: "WHATSAPP-BAILEYS",
  token: "TOKEN-QUE-NUNCA-PODE-SER-GRAVADO",
  disconnectionReasonCode: at ? code : null,
  disconnectionObject: at ? (objeto === undefined ? objetoDeviceRemoved(at) : objeto) : null,
  disconnectionAt: at,
  updatedAt: updatedAt || at || "2026-11-17T03:19:32.101Z",
  createdAt: "2026-11-10T17:54:39.391Z",
});
// A Evolution de produção às 14:14Z de 17/11, mais uma instância de outro cliente que o Vexo não conhece.
const EVOLUTION_17_11 = () => [
  instanciaEvolution(C1, { at: "2026-11-13T17:02:21.536Z" }),
  instanciaEvolution(C2, { at: "2026-11-17T12:38:21.100Z" }),
  instanciaEvolution(C3, { status: "open" }),
  instanciaEvolution(C4, { at: "2026-11-13T20:48:24.853Z" }),
  instanciaEvolution(CM, { at: "2026-11-17T01:18:53.111Z" }),
  { name: "instancia-de-fora", connectionStatus: "close", disconnectionReasonCode: 403, disconnectionAt: "2026-11-17T10:00:00Z" },
];

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.leads_clients (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE public.lead_client_evolution_instances (
    id UUID PRIMARY KEY, client_id TEXT NOT NULL, name TEXT, dispatch_webhook_url TEXT, dispatch_webhook_token TEXT,
    active BOOLEAN DEFAULT true, is_default BOOLEAN DEFAULT false, chip_state TEXT, connection_state TEXT,
    daily_limit_override INT, updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE public.evolution_instance_daily_usage (instance_id UUID, date DATE, sent_count INT, PRIMARY KEY (instance_id, date));
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
  CREATE TABLE public.crm_consultant_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, name TEXT, scheduling_link TEXT, active BOOLEAN DEFAULT true
  );
`;

const abertos = [];
afterAll(async () => {
  _setPgDatabasePoolForTesting(null);
  for (const db of abertos) await db.close();
});

let spies;
beforeEach(() => {
  spies = ["log", "info", "warn", "error"].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => spies.forEach((s) => s.mockRestore()));

async function banco({ comMigration = true } = {}) {
  const db = await createPgliteDb(SCHEMA);
  abertos.push(db);
  if (comMigration) await db.exec(MIGRATION);
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, 'Nous Gestao'), ('outra-empresa', 'Outra')", [NOUS]);
  for (const c of NOUS_CHIPS) {
    await db.query(
      "INSERT INTO lead_client_evolution_instances (id, client_id, name, dispatch_webhook_url, dispatch_webhook_token, chip_state) VALUES ($1, $2, $3, $4, 'tk', 'cold')",
      [c.id, NOUS, c.name, `${EVO}/message/sendText/${c.instancia}`]
    );
  }
  const pool = { query: (sql, params) => db.query(sql, params) };
  return { db, pool };
}

const evolutionQueResponde = (lista) =>
  vi.fn(async (url) => {
    expect(String(url)).toBe(`${EVO}/instance/fetchInstances`);
    return { ok: true, status: 200, json: async () => (typeof lista === "function" ? lista() : lista) };
  });
const ciclo = (pool, lista, now = new Date("2026-11-17T14:20:00Z")) =>
  sampleChipConnections({ pool, fetchImpl: evolutionQueResponde(lista), config: CONFIG, now });
const eventos = async (db) =>
  (await db.query("SELECT * FROM evolution_instance_events ORDER BY occurred_at, kind")).rows;

describe("motivo da queda (o que a Evolution guarda, traduzido)", () => {
  it("o objeto medido em produção (401, conflict/device_removed) vira 'aparelho removido'", () => {
    const m = describeChipDisconnect({ code: 401, object: objetoDeviceRemoved("2026-11-17T12:38:21.095Z") });
    expect(m).toMatchObject({ code: 401, kind: "aparelho_removido", tag: "conflict", type: "device_removed", message: "Stream Errored (conflict)" });
    expect(m.label).toBe(
      "Aparelho removido do WhatsApp: a conexão do Vexo saiu de \"Aparelhos conectados\". Alguém removeu pelo celular, ou o próprio WhatsApp desconectou. (código 401)"
    );
  });

  it("cada código conhecido tem o seu tipo; desconhecido diz o código", () => {
    const tipo = (code, object = null) => describeChipDisconnect({ code, object }).kind;
    expect(tipo(401)).toBe("sessao_encerrada");
    expect(tipo(403)).toBe("bloqueio");
    expect(tipo(440)).toBe("substituida");
    expect(tipo(408)).toBe("rede");
    expect(tipo(428)).toBe("rede");
    expect(tipo(515)).toBe("reinicio");
    expect(tipo(500)).toBe("sessao_corrompida");
    expect(describeChipDisconnect({ code: 499 }).label).toBe("Queda com código 499.");
    expect(describeChipDisconnect({}).label).toBe("Queda sem código informado pela Evolution.");
  });
});

describe("[OBRIGATÓRIO] o diário grava as quedas que a Evolution informa (Nous, 17/11)", () => {
  it("1º ciclo: grava as 4 quedas com hora e motivo exatos; o Chip 3 (aberto) e a instância desconhecida ficam de fora", async () => {
    const { db, pool } = await banco();
    const r = await ciclo(pool, EVOLUTION_17_11());
    expect(r).toMatchObject({ ok: true, instancias: 5, quedas: 4, voltas: 0 });

    const ev = await eventos(db);
    expect(ev.map((e) => [e.chip_name, e.kind, new Date(e.occurred_at).toISOString(), e.reason_code, e.reason_kind])).toEqual([
      ["Chip 1 - NOUS", "queda", "2026-11-13T17:02:21.536Z", 401, "aparelho_removido"],
      ["Chip 4 - NOUS", "queda", "2026-11-13T20:48:24.853Z", 401, "aparelho_removido"],
      ["Pessoal - Moacir", "queda", "2026-11-17T01:18:53.111Z", 401, "aparelho_removido"],
      ["Chip 2 - NOUS", "queda", "2026-11-17T12:38:21.100Z", 401, "aparelho_removido"],
    ]);
    expect(ev.every((e) => e.client_id === NOUS && e.source === "evolution_fetch")).toBe(true);
    expect(ev[0].reason_detail).toEqual({ tag: "conflict", type: "device_removed", message: "Stream Errored (conflict)" });
    // O token da instância nunca vai para o banco.
    expect(JSON.stringify(ev)).not.toContain("TOKEN-QUE-NUNCA-PODE-SER-GRAVADO");
  }, SLOW);

  it("ciclos seguintes com a mesma resposta não repetem nada", async () => {
    const { db, pool } = await banco();
    await ciclo(pool, EVOLUTION_17_11());
    const r2 = await ciclo(pool, EVOLUTION_17_11(), new Date("2026-11-17T14:25:00Z"));
    const r3 = await ciclo(pool, EVOLUTION_17_11(), new Date("2026-11-17T14:30:00Z"));
    expect([r2.quedas, r3.quedas, r2.voltas, r3.voltas]).toEqual([0, 0, 0, 0]);
    expect(await eventos(db)).toHaveLength(4);
  }, SLOW);

  it("foto da queda do Chip 2 com os números de produção: 46 envios na última hora, último 7 s antes, cota 50 de 50, 37 inválidos", async () => {
    const { db, pool } = await banco();
    const disp = "11111111-1111-4111-8111-111111111111";
    const camp = "22222222-2222-4222-8222-222222222222";
    // 46 envios de lote entre 12:27:54Z e 12:38:14Z (horário SP 09:27:54 a 09:38:14), como na leitura de 14:07Z.
    const inicio = new Date("2026-11-17T12:27:54Z").getTime();
    const fim = new Date("2026-11-17T12:38:14Z").getTime();
    for (let i = 0; i < 46; i += 1) {
      const t = new Date(inicio + Math.round(((fim - inicio) * i) / 45)).toISOString();
      await db.query(
        "INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, phone, status, sent_at, lead_id, evolution_instance_id) VALUES ($1, $2, $3, $4, 'sent', $5, gen_random_uuid(), $6)",
        [disp, camp, NOUS, `55349900${1000 + i}`, t, C2.id]
      );
    }
    for (let i = 0; i < 37; i += 1) {
      await db.query(
        "INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, phone, status, created_at, lead_id, evolution_instance_id) VALUES ($1, $2, $3, $4, 'invalid_number', '2026-11-17T12:30:00Z', gen_random_uuid(), $5)",
        [disp, camp, NOUS, `55349911${1000 + i}`, C2.id]
      );
    }
    // Envio de outro chip e envio do Chip 2 DEPOIS da queda: não entram na foto.
    await db.query("INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, phone, status, sent_at, lead_id, evolution_instance_id) VALUES ($1, $2, $3, '1', 'sent', '2026-11-17T12:30:00Z', gen_random_uuid(), $4)", [disp, camp, NOUS, C3.id]);
    await db.query("INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, phone, status, sent_at, lead_id, evolution_instance_id) VALUES ($1, $2, $3, '2', 'sent', '2026-11-17T12:40:00Z', gen_random_uuid(), $4)", [disp, camp, NOUS, C2.id]);
    await db.query("INSERT INTO evolution_instance_daily_usage (instance_id, date, sent_count) VALUES ($1, '2026-11-17', 50), ($1, '2026-11-16', 9)", [C2.id]);

    await ciclo(pool, EVOLUTION_17_11());
    const chip2 = (await eventos(db)).find((e) => e.chip_name === "Chip 2 - NOUS");
    expect(chip2.snapshot).toEqual({
      limite_diario: 50,
      envios_1h: 46,
      envios_24h: 46,
      ultimo_envio: "2026-11-17T12:38:14.000Z",
      segundos_do_ultimo_envio_ate_a_queda: 7,
      invalidos_24h: 37,
      cota_usada_no_dia: 50,
    });
    // Chip 1 (13/11): o sistema não tinha enviado nada por ele.
    const chip1 = (await eventos(db)).find((e) => e.chip_name === "Chip 1 - NOUS");
    expect(chip1.snapshot).toMatchObject({ envios_1h: 0, envios_24h: 0, ultimo_envio: null, cota_usada_no_dia: null });
  }, SLOW);

  it("chip que volta: grava 'conectado' na hora em que a Evolution atualizou; nova queda depois grava de novo", async () => {
    const { db, pool } = await banco();
    await ciclo(pool, EVOLUTION_17_11());
    const voltou = () => EVOLUTION_17_11().map((i) =>
      i.name === C2.instancia ? { ...i, connectionStatus: "open", updatedAt: "2026-11-17T15:02:00.000Z" } : i
    );
    const r = await ciclo(pool, voltou(), new Date("2026-11-17T15:05:00Z"));
    expect(r.voltas).toBe(1);
    expect((await ciclo(pool, voltou(), new Date("2026-11-17T15:10:00Z"))).voltas).toBe(0);
    let doChip2 = (await eventos(db)).filter((e) => e.instance_name === C2.instancia);
    expect(doChip2.map((e) => [e.kind, new Date(e.occurred_at).toISOString(), e.occurred_at_approx])).toEqual([
      ["queda", "2026-11-17T12:38:21.100Z", false],
      ["conectado", "2026-11-17T15:02:00.000Z", false],
    ]);

    const caiuDeNovo = () => EVOLUTION_17_11().map((i) =>
      i.name === C2.instancia ? instanciaEvolution(C2, { at: "2026-11-18T11:00:00.000Z", code: 403, objeto: null }) : i
    );
    const r2 = await ciclo(pool, caiuDeNovo(), new Date("2026-11-18T11:03:00Z"));
    expect(r2.quedas).toBe(1);
    doChip2 = (await eventos(db)).filter((e) => e.instance_name === C2.instancia);
    expect(doChip2.map((e) => [e.kind, e.reason_kind])).toEqual([["queda", "aparelho_removido"], ["conectado", null], ["queda", "bloqueio"]]);
  }, SLOW);

  it("volta sem hora confiável da Evolution: grava a hora da leitura, marcada como aproximada", async () => {
    const { db, pool } = await banco();
    await ciclo(pool, EVOLUTION_17_11());
    const voltouSemHora = EVOLUTION_17_11().map((i) =>
      i.name === CM.instancia ? { ...i, connectionStatus: "open", updatedAt: "2026-11-10T00:00:00Z" } : i
    );
    await ciclo(pool, voltouSemHora, new Date("2026-11-17T16:00:00Z"));
    const volta = (await eventos(db)).find((e) => e.instance_name === CM.instancia && e.kind === "conectado");
    expect(new Date(volta.occurred_at).toISOString()).toBe("2026-11-17T16:00:00.000Z");
    expect(volta.occurred_at_approx).toBe(true);
  }, SLOW);
});

describe("falhas não derrubam nada e não gravam meia informação", () => {
  it("Evolution com HTTP 500: ok false com o motivo, nada gravado", async () => {
    const { db, pool } = await banco();
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    const r = await sampleChipConnections({ pool, fetchImpl, config: CONFIG });
    expect(r).toEqual({ ok: false, motivo: "evolution: fetchInstances HTTP 500" });
    expect(await eventos(db)).toHaveLength(0);
  }, SLOW);

  it("Evolution fora do ar (erro de rede): ok false, sem lançar", async () => {
    const { pool } = await banco();
    const fetchImpl = vi.fn(async () => { throw new TypeError("fetch failed"); });
    const r = await sampleChipConnections({ pool, fetchImpl, config: CONFIG });
    expect(r).toEqual({ ok: false, motivo: "evolution: fetch failed" });
  }, SLOW);

  it("antes da migration (tabela ausente): o ciclo diz 'tabela_ausente' e a leitura devolve available false", async () => {
    const { pool } = await banco({ comMigration: false });
    expect(await ciclo(pool, EVOLUTION_17_11())).toEqual({ ok: false, motivo: "tabela_ausente" });
    expect(await listChipDiary(pool, NOUS)).toEqual({ available: false, items: [] });
  }, SLOW);
});

describe("[OBRIGATÓRIO] rota GET /api/reports/chip-diary", () => {
  async function rota(pool) {
    const { registerInsightsRoutes } = await import("../domains/insights/routes.js");
    const handlers = {};
    const guards = {};
    const app = {
      get: (path, ...hs) => { handlers[path] = hs[hs.length - 1]; guards[path] = hs; },
      post() {}, put() {}, patch() {}, delete() {}, use() {},
    };
    const paginasPedidas = [];
    registerInsightsRoutes(app, {
      ensureDb: () => true,
      normalizeString: (s) => String(s ?? "").trim(),
      pgDatabasePool: pool,
      requireFirebaseAuth: (req, res, next) => next(),
      requireInternalPageAccess: (paginas) => { paginasPedidas.push(paginas); return (req, res, next) => next(); },
      // Igual ao de produção no que importa aqui: só devolve a empresa que a pessoa pode ver.
      resolveAuthorizedClientId: (req, res, pedido) => {
        if (req.authAccess?.clientId === pedido) return pedido;
        res.status(403).json({ error: { code: "FORBIDDEN" } });
        return null;
      },
      sendError: (res, s, c, m) => res.status(s).json({ error: { code: c, message: m } }),
    });
    const chamar = async (query, authAccess) => {
      const out = { status: 200, body: null };
      const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
      await handlers["/api/reports/chip-diary"]({ query, authAccess }, res);
      return out;
    };
    return { chamar, paginasPedidas };
  }

  it("devolve as quedas da empresa, da mais recente para a mais antiga, com motivo e foto", async () => {
    const { pool } = await banco();
    await ciclo(pool, EVOLUTION_17_11());
    await pool.query(
      "INSERT INTO evolution_instance_events (client_id, instance_name, chip_name, kind, occurred_at) VALUES ('outra-empresa', 'x', 'Chip de outra empresa', 'queda', now())"
    );
    const { chamar, paginasPedidas } = await rota(pool);
    expect(paginasPedidas).toContainEqual(["conexoes"]);
    const r = await chamar({ clientId: NOUS }, { clientId: NOUS });
    expect(r.status).toBe(200);
    expect(r.body.available).toBe(true);
    expect(r.body.items.map((e) => e.chip_name)).toEqual(["Chip 2 - NOUS", "Pessoal - Moacir", "Chip 4 - NOUS", "Chip 1 - NOUS"]);
    expect(r.body.items[0]).toMatchObject({ kind: "queda", reason_code: 401, reason_kind: "aparelho_removido" });
    expect(r.body.items[0].snapshot).toHaveProperty("envios_1h");
  }, SLOW);

  it("sem clientId: 400; empresa que a pessoa não pode ver: 403 e nada vaza", async () => {
    const { pool } = await banco();
    await ciclo(pool, EVOLUTION_17_11());
    const { chamar } = await rota(pool);
    expect((await chamar({}, { clientId: NOUS })).status).toBe(400);
    const r = await chamar({ clientId: NOUS }, { clientId: "outra-empresa" });
    expect(r.status).toBe(403);
    expect(JSON.stringify(r.body)).not.toContain("Chip 2");
  }, SLOW);
});

describe("[OBRIGATÓRIO] número inválido da pré-validação grava o chip que validou (motor real)", () => {
  let intervalSpy;
  let fetchOriginal;
  let timeoutOriginal;
  beforeAll(() => {
    intervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(() => ({ unref() {}, ref() {} }));
  });
  afterAll(() => intervalSpy.mockRestore());
  beforeEach(() => {
    fetchOriginal = globalThis.fetch;
    timeoutOriginal = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms, ...args) => timeoutOriginal(fn, ms >= 1000 ? 0 : ms, ...args);
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    globalThis.setTimeout = timeoutOriginal;
  });

  it("lote do Chip 2 com 2 números inexistentes: os runs 'invalid_number' saem com o id do Chip 2, e a foto da queda os conta", async () => {
    const { db, pool } = await banco();
    _setPgDatabasePoolForTesting(pool);
    const supabase = createPgSupabaseClient(pool);
    const url = `${EVO}/message/sendText/${C2.instancia}`;
    globalThis.fetch = vi.fn(async (u, init) => {
      const s = String(u);
      // Sem pré-validação desde o antibloqueio (27/11/2026): a Evolution recusa no envio os 2 primeiros (exists:false).
      if (/sendText/.test(s) && /200[01]$/.test(JSON.parse(init?.body || "{}").number || "")) {
        const body = '{"status":400,"response":{"message":[{"exists":false}]}}';
        return { ok: false, status: 400, json: async () => JSON.parse(body), text: async () => body };
      }
      if (/connectionState/.test(s)) {
        const body = JSON.stringify({ instance: { state: "open" } });
        return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
      }
      if (/sendText/.test(s)) return { ok: true, status: 201, json: async () => ({ key: { id: "wa" } }), text: async () => '{"key":{"id":"wa"}}' };
      return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
    });

    const instanciaChip2 = { id: C2.id, name: C2.name, active: true, dispatch_webhook_url: url, dispatch_webhook_token: "tk", chip_state: "cold" };
    const { registerCampaignsRoutes } = await import("../domains/campaigns/routes.js");
    const handlers = {};
    const guardar = (path, ...hs) => { handlers[path] = hs[hs.length - 1]; };
    const noop = () => {};
    registerCampaignsRoutes({ get: noop, post: guardar, put: noop, patch: noop, delete: noop, use: noop }, {
      CAMPAIGN_SCHEDULER_MAX_BATCH: 10, buildDispatchLeads, canCampaignBeDispatched: () => true,
      checkEvolutionInstanceHealth, continueCampaignLeadFromReply: async () => {},
      ensureDb: () => true, executeCampaignDispatch: async () => {}, findCampaignReplyMatches: async () => [],
      getClientName: async () => "Nous Gestao", getLeadClientEvolutionInstances: async () => [instanciaChip2],
      getLeadClientN8nSettings: async () => ({ send_window_enabled: false }), getRequestId: () => "req",
      getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}), isMissingSchemaError: () => false,
      isProduction: false, logCampaignReplyFlow: noop, logDirectDispatch: noop, maskPhoneForLog: (p) => p,
      normalizeIsoDate: (d) => d, leadsTableName: "lead_import_items", normalizeString: (s) => String(s ?? "").trim(),
      normalizeTenantKey: (s) => String(s || "").trim(), parseOptionalUuid: (s) => ({ value: s }), pgDatabasePool: pool,
      requireAppViewAccess: () => (req, res, next) => next(), requireCampaignDispatchAccess: (req, res, next) => next(),
      requireFirebaseAuth: (req, res, next) => next(), requireInternalPageAccess: () => (req, res, next) => next(),
      resolveAuthorizedClientId: () => NOUS,
      // Como em produção (log de 17/11: source 'campaign_evolution_instance'): o webhook é o do chip escolhido.
      resolveCampaignDispatchSettings: async () => ({ webhookUrl: url, webhookToken: "tk", source: "campaign_evolution_instance", selectedEvolutionInstanceId: C2.id }),
      resolveDispatchWebhookSettings: async () => ({}), runDueCampaignDispatches: async () => {}, sanitizePhone: (p) => p,
      sendError: (res, s, c, m) => res.status(s).json({ error: { code: c, message: m } }),
      supabase, validateN8nInboundBearer: () => true,
    });

    const seq = [{ id: "s1", type: "text", text: "Oi {{nome}}", order: 1, enabled: true, delayAfterSeconds: 0 }];
    const { rows: [camp] } = await db.query(
      "INSERT INTO campaigns (client_id, name, analytics_meta, limit_per_run) VALUES ($1, 'Evento', $2::jsonb, 50) RETURNING id",
      [NOUS, JSON.stringify({ importSource: "__crm__", sequence: seq })]
    );
    for (let i = 0; i < 5; i += 1) {
      await db.query("INSERT INTO leads (client_id, telefone, nome) VALUES ($1, $2, $3)", [NOUS, `553499990${2000 + i}`, `Lead ${i}`]);
    }
    const { rows: [lote] } = await db.query(
      `INSERT INTO campaign_dispatches (campaign_id, client_id, name, steps, status, trigger_type, "offset", limit_per_run, target_count, evolution_instance_id)
       VALUES ($1, $2, 'Lote 1/1', $3::jsonb, 'draft', 'manual', 0, 5, 5, $4) RETURNING id`,
      [camp.id, NOUS, JSON.stringify(seq), C2.id]
    );
    const out = { status: 200 };
    const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
    await handlers["/api/campaigns/dispatches/:dispatchId/trigger"]({ params: { dispatchId: lote.id }, body: {}, query: {}, authAccess: {} }, res);
    expect(out.status).toBe(200);
    for (let i = 0; i < 300; i += 1) {
      const { rows } = await db.query("SELECT status FROM campaign_dispatches WHERE id = $1", [lote.id]);
      if (rows[0].status !== "running") break;
      await new Promise((r) => timeoutOriginal(r, 20));
    }

    const runs = (await db.query("SELECT status, evolution_instance_id::text AS chip FROM campaign_dispatch_runs WHERE dispatch_id = $1 ORDER BY status", [lote.id])).rows;
    expect(runs.filter((r) => r.status === "invalid_number")).toEqual([
      { status: "invalid_number", chip: C2.id },
      { status: "invalid_number", chip: C2.id },
    ]);
    expect(runs.filter((r) => r.status === "sent")).toHaveLength(3);

    // O chip cai logo depois: a foto da queda conta os 3 envios e os 2 inexistentes deste lote.
    const queda = new Date(Date.now() + 7000).toISOString();
    await ciclo(pool, [instanciaEvolution(C2, { at: queda })], new Date(Date.now() + 60_000));
    const ev = (await eventos(db)).find((e) => e.instance_name === C2.instancia);
    expect(ev.snapshot).toMatchObject({ envios_1h: 3, invalidos_24h: 2 });
    _setPgDatabasePoolForTesting(null);
  }, SLOW);
});
