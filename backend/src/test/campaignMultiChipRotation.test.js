// backend/src/test/campaignMultiChipRotation.test.js
//
// SPEC 10 — Rodízio de chips no disparo (Multi-Chip Round-Robin Anti-Ban).
//
// Provas por mutação obrigatórias:
// 1. Remove chipProvider da chamada em routes.js -> 9 leads saem todos pelo mesmo chip de fallback (vermelha);
//    restaurado -> 3-3-3 (verde).
// 2. Remove respeito à cota (if reserved > limit em routes.js) -> chip estourado continua recebendo (vermelha);
//    restaurado -> 3 chips, cota 2 cada, 9 leads -> 6 enviados (2 por chip) e 3 barrados com motivo registrado
//    medido em evolution_instance_daily_usage real via PGlite.

import { resolve } from "path";
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { ensureEvolutionInstanceDailyUsageTable, getChipDailyUsage, resetChipQuotaStateForTest } from "../services/chipQuota.js";
import { getDateKey } from "../services/analytics.js";

const TENANT = "tenant-spec10";
const CHIP_A = "11111111-0000-0000-0000-000000000001";
const CHIP_B = "22222222-0000-0000-0000-000000000002";
const CHIP_C = "33333333-0000-0000-0000-000000000003";
const CHIP_ANTIGO = "99999999-0000-0000-0000-000000000099";

const HOJE = new Date("2026-10-26T15:00:00.000Z");
const DIA_HOJE = getDateKey(HOJE, "America/Sao_Paulo");

const SCHEMA = `
  CREATE TABLE lead_client_evolution_instances (
    id uuid PRIMARY KEY,
    client_id text,
    name text,
    dispatch_webhook_url text,
    dispatch_webhook_token text,
    active boolean DEFAULT true,
    chip_state text DEFAULT 'warm',
    daily_limit_override int,
    created_at timestamptz DEFAULT now()
  );
  CREATE TABLE lead_client_n8n_settings (
    client_id text PRIMARY KEY,
    send_window_enabled boolean DEFAULT false,
    send_window_start text DEFAULT '00:00',
    send_window_end text DEFAULT '23:59',
    send_window_timezone text DEFAULT 'America/Sao_Paulo'
  );
`;

const openDbs = [];
async function criarBancoReal() {
  const db = await createPgliteDb("SET TimeZone = 'UTC';\n" + SCHEMA);
  openDbs.push(db);
  await ensureEvolutionInstanceDailyUsageTable(db);
  return db;
}

afterAll(async () => {
  for (const db of openDbs) {
    try { await db.close(); } catch {}
  }
});

let originalFetch;
let intervalSpy;

beforeAll(() => {
  intervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(() => ({ unref() {}, ref() {} }));
});

afterAll(() => {
  intervalSpy.mockRestore();
});

beforeEach(() => {
  resetChipQuotaStateForTest();
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ key: { id: "msg-1" } }),
    text: async () => '{"key":{"id":"msg-1"}}',
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(HOJE);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
  intervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(() => ({ unref() {}, ref() {} }));
});

function fakeSupabase(tables) {
  const from = (tableName) => {
    const st = { filters: [], patch: null, mode: "read" };
    const getRows = () => {
      let r = [...(tables[tableName] || [])];
      for (const f of st.filters) r = r.filter(f);
      return r;
    };
    const builder = {
      select() {
        if (st.mode === "update") st.mode = "update-select";
        return builder;
      },
      eq(col, val) {
        st.filters.push((row) => row[col] === val);
        return builder;
      },
      in(col, vals) {
        st.filters.push((row) => vals.includes(row[col]));
        return builder;
      },
      single: async () => ({ data: getRows()[0] || null, error: getRows()[0] ? null : { message: "not found" } }),
      maybeSingle: async () => ({ data: getRows()[0] || null, error: null }),
      update(patch) {
        st.mode = "update";
        st.patch = patch;
        return builder;
      },
      insert(payload) {
        const item = { id: `id-${Date.now()}`, ...payload };
        if (!tables[tableName]) tables[tableName] = [];
        tables[tableName].push(item);
        return {
          select: () => ({
            single: async () => ({ data: item, error: null }),
          }),
        };
      },
      then(resolve) {
        if (st.mode === "update" || st.mode === "update-select") {
          const r = getRows();
          r.forEach((row) => Object.assign(row, st.patch));
          return resolve({ data: st.mode === "update-select" ? r.map((x) => ({ id: x.id })) : null, error: null });
        }
        return resolve({ data: getRows(), error: null });
      },
    };
    return builder;
  };
  return { from };
}

function montarInstancias({ limitA = null, limitB = null, limitC = null, limitAntigo = null } = {}) {
  return [
    {
      id: CHIP_A,
      client_id: TENANT,
      name: "Chip A",
      dispatch_webhook_url: "http://evo.test/message/sendText/chip-a",
      dispatch_webhook_token: "token-a",
      active: true,
      chip_state: "warm",
      daily_limit_override: limitA,
    },
    {
      id: CHIP_B,
      client_id: TENANT,
      name: "Chip B",
      dispatch_webhook_url: "http://evo.test/message/sendText/chip-b",
      dispatch_webhook_token: "token-b",
      active: true,
      chip_state: "warm",
      daily_limit_override: limitB,
    },
    {
      id: CHIP_C,
      client_id: TENANT,
      name: "Chip C",
      dispatch_webhook_url: "http://evo.test/message/sendText/chip-c",
      dispatch_webhook_token: "token-c",
      active: true,
      chip_state: "warm",
      daily_limit_override: limitC,
    },
    {
      id: CHIP_ANTIGO,
      client_id: TENANT,
      name: "Chip Antigo",
      dispatch_webhook_url: "http://evo.test/message/sendText/chip-antigo",
      dispatch_webhook_token: "token-antigo",
      active: true,
      chip_state: "warm",
      daily_limit_override: limitAntigo,
    },
  ];
}

async function montarMundoMultiChip({
  qdb,
  nLeads = 9,
  dispatchChipIds = [CHIP_A, CHIP_B, CHIP_C],
  evolutionInstanceId = null,
  limitA = null,
  limitB = null,
  limitC = null,
  steps = [{ id: "step-1", type: "text", text: "Mensagem para {{nome}}", order: 1, enabled: true, delayAfterSeconds: 0 }],
  quotaIndisponivel = false,
  resolveAuthorizedClientId = (_req, _res, id) => id || TENANT,
} = {}) {
  const instances = montarInstancias({ limitA, limitB, limitC });
  const estado = { claimed: [], sent: [], sentLeadIds: new Set() };
  const leads = Array.from({ length: nLeads }, (_, i) => ({
    id: `lead-${i + 1}`,
    nome: `Lead ${i + 1}`,
    telefone: `551199999${String(1000 + i)}`,
    client_id: TENANT,
  }));

  const campaign = {
    id: "camp-multi-1",
    name: "Campanha SPEC 10",
    client_id: TENANT,
    mode: "campanha",
    evolution_instance_id: evolutionInstanceId,
    analytics_meta: {
      sequence: steps,
      dispatchOptions: {
        leadDelaySeconds: 0,
        dispatchChipIds,
      },
    },
  };

  const dispatch = {
    id: "disp-multi-1",
    campaign_id: campaign.id,
    client_id: TENANT,
    name: "Lote Multi-Chip",
    status: "running",
    target_count: nLeads,
    sent_count: 0,
    failed_count: 0,
    evolution_instance_id: evolutionInstanceId,
    dispatch_options: {
      leadDelaySeconds: 0,
      dispatchChipIds,
    },
    scheduled_at: "2026-10-26T00:00:00.000Z",
    error_message: null,
  };

  const tables = {
    campaign_dispatches: [dispatch],
    campaigns: [campaign],
    lead_client_evolution_instances: instances,
  };
  const supabase = fakeSupabase(tables);

  const pool = {
    query: vi.fn(async (sql, params) => {
      const t = String(sql);
      if (t.includes("evolution_instance_daily_usage")) {
        if (quotaIndisponivel) throw new Error("connection terminated unexpectedly");
        return qdb.query(sql, params);
      }
      if (t.includes("INSERT INTO public.campaign_dispatch_runs")) {
        estado.claimed.push(params[3]);
        return { rowCount: 1, rows: [{ id: "claim" }] };
      }
      if (t.includes("UPDATE public.campaign_dispatch_runs SET status = 'sent'")) {
        estado.sent.push({ leadId: params[2], chipId: params[3] });
        estado.sentLeadIds.add(params[2]);
        return { rowCount: 1, rows: [] };
      }
      if (t.includes("COUNT(*) FILTER")) {
        return { rows: [{ sent: estado.sent.length, failed: 0, skipped: 0 }] };
      }
      return { rows: [], rowCount: 0 };
    }),
  };

  const sendError = vi.fn((res, status, code, message, details) => {
    res.statusCode = status;
    res.body = { error: { code, message, details } };
    return res;
  });

  const deps = {
    CAMPAIGN_SCHEDULER_MAX_BATCH: 50,
    buildDispatchLeads: async () => leads.filter((l) => !estado.sentLeadIds.has(l.id)),
    canCampaignBeDispatched: () => true,
    checkEvolutionInstanceHealth: async () => ({ state: "open" }),
    continueCampaignLeadFromReply: async () => {},
    ensureDb: () => true,
    ensureCampaignDispatchEvolutionInstanceColumn: async () => {},
    executeCampaignDispatch: async () => {},
    findCampaignReplyMatches: async () => [],
    getClientName: async () => "Tenant Teste",
    getLeadClientEvolutionInstances: async () => instances,
    getLeadClientN8nSettings: async () => ({
      send_window_enabled: false,
      send_window_start: "00:00",
      send_window_end: "23:59",
      send_window_days: ["seg", "ter", "qua", "qui", "sex", "sab", "dom"],
      send_window_timezone: "America/Sao_Paulo",
    }),
    getRequestId: () => "req-spec10",
    getSafeDispatchSettingsLog: () => ({}),
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    isProduction: false,
    logCampaignReplyFlow: () => {},
    logDirectDispatch: () => {},
    maskPhoneForLog: (p) => p,
    normalizeIsoDate: (d) => d,
    leadsTableName: "lead_import_items",
    normalizeString: (s) => String(s || "").trim(),
    normalizeTenantKey: (s) => String(s || "").trim(),
    parseOptionalUuid: (s) => ({ value: s || null, error: null }),
    pgDatabasePool: pool,
    requireAppViewAccess: () => (_req, _res, next) => next(),
    requireCampaignDispatchAccess: () => (_req, _res, next) => next(),
    requireFirebaseAuth: (_req, _res, next) => next(),
    requireInternalPageAccess: () => (_req, _res, next) => next(),
    resolveAuthorizedClientId,
    resolveCampaignDispatchSettings: async () => ({
      webhookUrl: "http://evo.test/message/sendText/chip-antigo",
      webhookToken: "token-antigo",
      source: "campaign_evolution_instance",
      selectedEvolutionInstanceId: CHIP_ANTIGO,
    }),
    resolveDispatchWebhookSettings: async () => ({}),
    runDueCampaignDispatches: async () => {},
    sanitizePhone: (p) => p,
    sendError,
    supabase,
    validateCampaignDispatchEvolutionInstance: async () => true,
    validateCampaignAnalyticsMeta: (m) => ({ valid: true, analyticsMeta: m }),
    validateN8nInboundBearer: () => true,
  };

  const routesMap = {};
  const dummyApp = {
    get: (p, ...h) => { routesMap[`get ${p}`] = h[h.length - 1]; },
    post: (p, ...h) => { routesMap[`post ${p}`] = h[h.length - 1]; },
    put: (p, ...h) => { routesMap[`put ${p}`] = h[h.length - 1]; },
    patch: (p, ...h) => { routesMap[`patch ${p}`] = h[h.length - 1]; },
    delete: (p, ...h) => { routesMap[`delete ${p}`] = h[h.length - 1]; },
    use: () => {},
  };

  const routes = registerCampaignsRoutes(dummyApp, deps);
  return {
    routes,
    routesMap,
    estado,
    tables,
    supabase,
    campaign,
    dispatch,
    pool,
    deps,
    qdb,
    instances,
  };
}

describe("SPEC 10 — Rodízio Multi-Chip de Disparo", () => {
  describe("Trava de validação na criação e atualização do lote (Item 4 / Ajustes a e b)", () => {
    it("POST /api/campaigns/:id/dispatches: recusa lote com chip inexistente devolvendo 422 DISPATCH_CHIP_NOT_FOUND", async () => {
      const qdb = await criarBancoReal();
      const mundo = await montarMundoMultiChip({ qdb });
      const handler = mundo.routesMap["post /api/campaigns/:id/dispatches"];

      const invalidUuid = "00000000-0000-4000-8000-000000000099";
      const req = {
        params: { id: mundo.campaign.id },
        body: {
          name: "Lote com chip fantasma",
          triggerType: "manual",
          dispatch_options: {
            dispatchChipIds: [CHIP_A, invalidUuid],
          },
        },
      };
      const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(d) { this.body = d; return this; } };

      await handler(req, res);

      expect(mundo.deps.sendError).toHaveBeenCalledWith(
        res,
        422,
        "DISPATCH_CHIP_NOT_FOUND",
        expect.stringContaining(invalidUuid),
        { invalidChipIds: [invalidUuid] }
      );
    });

    it("POST /api/campaigns/:id/dispatches: aceita lote com chips válidos do tenant", async () => {
      const qdb = await criarBancoReal();
      const mundo = await montarMundoMultiChip({ qdb });
      const handler = mundo.routesMap["post /api/campaigns/:id/dispatches"];

      const req = {
        params: { id: mundo.campaign.id },
        body: {
          name: "Lote com chips válidos",
          triggerType: "manual",
          dispatch_options: {
            dispatchChipIds: [CHIP_A, CHIP_B],
          },
        },
      };
      const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(d) { this.body = d; return this; } };

      await handler(req, res);

      expect(mundo.deps.sendError).not.toHaveBeenCalled();
      expect(res.body.dispatch).toBeDefined();
    });

    it("PATCH /api/campaigns/dispatches/:dispatchId: lote rodando devolve 409 DISPATCH_RUNNING antes de validar chips (Ajuste b)", async () => {
      const qdb = await criarBancoReal();
      const mundo = await montarMundoMultiChip({ qdb });
      mundo.dispatch.status = "running";
      const handler = mundo.routesMap["patch /api/campaigns/dispatches/:dispatchId"];

      const req = {
        params: { dispatchId: mundo.dispatch.id },
        body: {
          name: "Tentativa de editar em andamento",
          dispatch_options: { dispatchChipIds: ["00000000-0000-4000-8000-000000000099"] },
        },
      };
      const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(d) { this.body = d; return this; } };

      await handler(req, res);

      expect(mundo.deps.sendError).toHaveBeenCalledWith(
        res,
        409,
        "DISPATCH_RUNNING",
        "Cannot update a running dispatch"
      );
    });

    it("PATCH /api/campaigns/dispatches/:dispatchId: erro de banco na validação de chips devolve 500 (Ajuste a)", async () => {
      const qdb = await criarBancoReal();
      const mundo = await montarMundoMultiChip({ qdb });
      mundo.dispatch.status = "draft";
      const handler = mundo.routesMap["patch /api/campaigns/dispatches/:dispatchId"];

      // Mock da consulta de instâncias falhando com erro de banco
      const origFrom = mundo.supabase.from;
      mundo.supabase.from = (table) => {
        if (table === "lead_client_evolution_instances") {
          return {
            select: () => ({
              eq: () => ({
                in: async () => ({ data: null, error: new Error("DB connection timeout") }),
              }),
            }),
          };
        }
        return origFrom(table);
      };

      const req = {
        params: { dispatchId: mundo.dispatch.id },
        body: {
          dispatch_options: { dispatchChipIds: [CHIP_A] },
        },
      };
      const res = { statusCode: 200, status(s) { this.statusCode = s; return this; }, json(d) { this.body = d; return this; } };

      await handler(req, res);

      expect(mundo.deps.sendError).toHaveBeenCalledWith(
        res,
        500,
        "DATABASE_ERROR",
        "Falha ao validar instâncias de envio."
      );
    });
  });

    it("PATCH /api/campaigns/dispatches/:dispatchId: sem acesso ao tenant responde só o 403 e não segue (nem valida chip, nem grava)", async () => {
      const qdb = await criarBancoReal();
      const negar = vi.fn((_req, res) => {
        res.statusCode = 403;
        res.body = { error: { code: "NO_CLIENT_ACCESS" } };
        return null;
      });
      const mundo = await montarMundoMultiChip({ qdb, resolveAuthorizedClientId: negar });
      mundo.dispatch.status = "draft";
      const tabelasTocadas = [];
      const origFrom = mundo.supabase.from;
      mundo.supabase.from = (table) => {
        tabelasTocadas.push(table);
        return origFrom(table);
      };
      const handler = mundo.routesMap["patch /api/campaigns/dispatches/:dispatchId"];
      const res = { statusCode: 200, status(st) { this.statusCode = st; return this; }, json(d) { this.body = d; return this; } };

      await handler({ params: { dispatchId: mundo.dispatch.id }, body: { name: "Outro tenant", dispatch_options: { dispatchChipIds: [CHIP_A] } } }, res);

      expect(negar).toHaveBeenCalledTimes(1);
      expect(res.statusCode).toBe(403);
      expect(mundo.deps.sendError).not.toHaveBeenCalled();
      expect(tabelasTocadas).not.toContain("lead_client_evolution_instances");
      expect(mundo.dispatch.name).toBe("Lote Multi-Chip");
    });

  describe("Contador de cota fora do ar no rodízio (Ajuste d)", () => {
    it("loga UMA vez por lote, não uma por lead, e o envio segue", async () => {
      const qdb = await criarBancoReal();
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const mundo = await montarMundoMultiChip({ qdb, nLeads: 9, quotaIndisponivel: true });

      await mundo.routes.runCampaignDispatch({ dispatch: mundo.dispatch, campaign: mundo.campaign, supabase: mundo.supabase });

      const avisos = errorSpy.mock.calls.filter((c) => String(c[0]).includes("[campaign-quota] cota indisponível no rodízio"));
      expect(avisos).toHaveLength(1);
      const calls = globalThis.fetch.mock.calls.filter((c) => String(c[0]).includes("/message/sendText/"));
      expect(calls).toHaveLength(9);
    });
  });

  describe("Rodízio ligado: chipProvider chega ao envio (Regra d1)", () => {
    it("3 chips e 9 leads -> distribuição uniforme 3-3-3", async () => {
      const qdb = await criarBancoReal();
      const mundo = await montarMundoMultiChip({ qdb, nLeads: 9 });

      await mundo.routes.runCampaignDispatch({
        dispatch: mundo.dispatch,
        campaign: mundo.campaign,
        supabase: mundo.supabase,
      });

      // Captura apenas os envios de mensagens reais (ignora health/whatsappNumbers)
      const calls = globalThis.fetch.mock.calls.filter((c) => String(c[0]).includes("/message/sendText/"));
      expect(calls).toHaveLength(9);

      const endpoints = calls.map((c) => String(c[0]));
      const countA = endpoints.filter((u) => u.includes("chip-a")).length;
      const countB = endpoints.filter((u) => u.includes("chip-b")).length;
      const countC = endpoints.filter((u) => u.includes("chip-c")).length;

      expect(countA).toBe(3);
      expect(countB).toBe(3);
      expect(countC).toBe(3);

      // Ordem round-robin exata: A, B, C, A, B, C, A, B, C
      expect(endpoints[0]).toContain("chip-a");
      expect(endpoints[1]).toContain("chip-b");
      expect(endpoints[2]).toContain("chip-c");
      expect(endpoints[3]).toContain("chip-a");
      expect(endpoints[4]).toContain("chip-b");
      expect(endpoints[5]).toContain("chip-c");
      expect(endpoints[6]).toContain("chip-a");
      expect(endpoints[7]).toContain("chip-b");
      expect(endpoints[8]).toContain("chip-c");

      // Verificação no banco Postgres real
      expect(await getChipDailyUsage(CHIP_A, DIA_HOJE, qdb)).toBe(3);
      expect(await getChipDailyUsage(CHIP_B, DIA_HOJE, qdb)).toBe(3);
      expect(await getChipDailyUsage(CHIP_C, DIA_HOJE, qdb)).toBe(3);

      expect(mundo.dispatch.status).toBe("done");
    });

  });

  describe("Cota respeitada no rodízio (Regra d2)", () => {
    it("CASO OBRIGATÓRIO (Regra d2): 3 chips, cota 2 cada, 9 leads -> 6 enviados (2 por chip em evolution_instance_daily_usage real) e 3 barrados", async () => {
      const qdb = await criarBancoReal();
      const mundo = await montarMundoMultiChip({
        qdb,
        nLeads: 9,
        limitA: 2,
        limitB: 2,
        limitC: 2,
      });

      await mundo.routes.runCampaignDispatch({
        dispatch: mundo.dispatch,
        campaign: mundo.campaign,
        supabase: mundo.supabase,
      });

      // 6 enviados no total (2 por chip)
      const calls = globalThis.fetch.mock.calls.filter((c) => String(c[0]).includes("/message/sendText/"));
      expect(calls).toHaveLength(6);

      const endpoints = calls.map((c) => String(c[0]));
      expect(endpoints.filter((u) => u.includes("chip-a"))).toHaveLength(2);
      expect(endpoints.filter((u) => u.includes("chip-b"))).toHaveLength(2);
      expect(endpoints.filter((u) => u.includes("chip-c"))).toHaveLength(2);

      // Medição direta no Postgres REAL (tabela evolution_instance_daily_usage)
      expect(await getChipDailyUsage(CHIP_A, DIA_HOJE, qdb)).toBe(2);
      expect(await getChipDailyUsage(CHIP_B, DIA_HOJE, qdb)).toBe(2);
      expect(await getChipDailyUsage(CHIP_C, DIA_HOJE, qdb)).toBe(2);

      // 3 barrados com motivo de pausa registrado no lote
      expect(mundo.dispatch.status).toBe("paused");
      expect(mundo.dispatch.error_message).toContain("cota diária do chip atingida (2/2)");
      expect(mundo.estado.sent).toHaveLength(6);
    });

    it("Chip que estoura cota sai do rodízio no meio do lote sem derrubar os outros chips", async () => {
      const qdb = await criarBancoReal();
      // Chip A tem cota 1, Chip B tem cota 5, Chip C tem cota 5
      const mundo = await montarMundoMultiChip({
        qdb,
        nLeads: 5,
        limitA: 1,
        limitB: 5,
        limitC: 5,
      });

      await mundo.routes.runCampaignDispatch({
        dispatch: mundo.dispatch,
        campaign: mundo.campaign,
        supabase: mundo.supabase,
      });

      // Lead 1 -> Chip A (reserva 1/1 - OK)
      // Lead 2 -> Chip B (reserva 1/5 - OK)
      // Lead 3 -> Chip C (reserva 1/5 - OK)
      // Lead 4 -> Tenta Chip A (reserva 2/1 > 1 -> esgotado, devolve e pula para Chip B!) -> Chip B envia!
      // Lead 5 -> Tenta Chip C -> Chip C envia!
      const calls = globalThis.fetch.mock.calls.filter((c) => String(c[0]).includes("/message/sendText/"));
      expect(calls).toHaveLength(5);

      const endpoints = calls.map((c) => String(c[0]));
      expect(endpoints.filter((u) => u.includes("chip-a"))).toHaveLength(1);
      expect(endpoints.filter((u) => u.includes("chip-b"))).toHaveLength(2);
      expect(endpoints.filter((u) => u.includes("chip-c"))).toHaveLength(2);

      expect(await getChipDailyUsage(CHIP_A, DIA_HOJE, qdb)).toBe(1);
      expect(await getChipDailyUsage(CHIP_B, DIA_HOJE, qdb)).toBe(2);
      expect(await getChipDailyUsage(CHIP_C, DIA_HOJE, qdb)).toBe(2);
      expect(mundo.dispatch.status).toBe("done");
    });
  });

  describe("Devolução de cota parcial no caminho multi-chip (Ajuste c)", () => {
    it("Lead com 3 passos onde o 2º passo falha devolve as mensagens não enviadas ao chip ativo", async () => {
      const qdb = await criarBancoReal();
      let msgCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url) => {
        if (String(url).includes("/message/sendText/")) {
          msgCount += 1;
          if (msgCount === 2) {
            throw new Error("Falha temporária no passo 2");
          }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ key: { id: `msg-${msgCount}` } }),
          text: async () => `{"key":{"id":"msg-${msgCount}"}}`,
        };
      });

      const steps3 = [
        { id: "s1", type: "text", text: "Passo 1", order: 1, enabled: true, delayAfterSeconds: 2 },
        { id: "s2", type: "text", text: "Passo 2", order: 2, enabled: true, delayAfterSeconds: 2 },
        { id: "s3", type: "text", text: "Passo 3", order: 3, enabled: true, delayAfterSeconds: 2 },
      ];

      const mundo = await montarMundoMultiChip({
        qdb,
        nLeads: 1,
        steps: steps3,
        dispatchChipIds: [CHIP_A],
      });
      mundo.dispatch.dispatch_options.stopOnStepFailure = true;
      mundo.campaign.analytics_meta.dispatchOptions.stopOnStepFailure = true;

      await mundo.routes.runCampaignDispatch({
        dispatch: mundo.dispatch,
        campaign: mundo.campaign,
        supabase: mundo.supabase,
      });

      // Reservou 3 no início do lead, enviou 1 e parou no erro do passo 2.
      // O releaseUnusedQuota deve devolver as 2 mensagens não enviadas ao banco real!
      expect(await getChipDailyUsage(CHIP_A, DIA_HOJE, qdb)).toBe(1);
    }, 15_000);
  });

  describe("Compatibilidade obrigatória (Regra c)", () => {
    it("Lote criado com evolutionInstanceId único e dispatchChipIds ausente envia tudo pelo chip antigo", async () => {
      const qdb = await criarBancoReal();
      const mundo = await montarMundoMultiChip({
        qdb,
        nLeads: 5,
        dispatchChipIds: [], // ausente / vazio
        evolutionInstanceId: CHIP_ANTIGO,
      });

      await mundo.routes.runCampaignDispatch({
        dispatch: mundo.dispatch,
        campaign: mundo.campaign,
        supabase: mundo.supabase,
      });

      const calls = globalThis.fetch.mock.calls.filter((c) => String(c[0]).includes("/message/sendText/"));
      expect(calls).toHaveLength(5);

      const endpoints = calls.map((c) => String(c[0]));
      // Todos os 5 saem pelo chip antigo configurado
      expect(endpoints.filter((u) => u.endsWith("chip-antigo"))).toHaveLength(5);
      expect(endpoints.filter((u) => u.endsWith("chip-a"))).toHaveLength(0);
      expect(endpoints.filter((u) => u.endsWith("chip-b"))).toHaveLength(0);
      expect(endpoints.filter((u) => u.endsWith("chip-c"))).toHaveLength(0);
    });
  });
});
