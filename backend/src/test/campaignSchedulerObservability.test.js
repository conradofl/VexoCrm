// backend/src/test/campaignSchedulerObservability.test.js
//
// Testes obrigatórios do Bloco 1:
// a) lote vencido fora da janela: o motivo é registrado E gravado na linha
// b) lote vencido dentro da janela: é processado e o tique registra o resultado
// c) sem lotes vencidos: o tique não polui o log (no máximo 1 linha a cada 10 min)

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCampaignsRoutes, resetSchedulerHeartbeatForTest } from "../domains/campaigns/routes.js";

const TENANT = "tenant-observability";

function fakeSupabase(tables) {
  const from = (name) => {
    tables[name] ||= [];
    const st = { filters: [], patch: null, mode: "select", lim: null };
    const rows = () => {
      let r = tables[name].filter((row) => st.filters.every((f) => f(row)));
      if (st.lim) r = r.slice(0, st.lim);
      return r;
    };
    const b = {
      select() {
        if (st.mode === "update") st.mode = "update-select";
        return b;
      },
      eq(c, v) {
        st.filters.push((r) => r[c] === v);
        return b;
      },
      in(c, vs) {
        st.filters.push((r) => vs.includes(r[c]));
        return b;
      },
      lte(c, v) {
        st.filters.push((r) => String(r[c]) <= String(v));
        return b;
      },
      order() {
        return b;
      },
      limit(n) {
        st.lim = n;
        return b;
      },
      update(patch) {
        st.mode = "update";
        st.patch = patch;
        return b;
      },
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      single: async () => ({ data: rows()[0] || null, error: rows()[0] ? null : { message: "not found" } }),
      then(resolve) {
        if (st.mode === "update" || st.mode === "update-select") {
          const r = rows();
          r.forEach((row) => Object.assign(row, st.patch));
          return resolve({
            data: st.mode === "update-select" ? r.map((x) => ({ id: x.id })) : null,
            error: null,
          });
        }
        return resolve({ data: rows(), error: null });
      },
    };
    return b;
  };
  return { from };
}

describe("Agendador Observável de Campanhas (Bloco 1)", () => {
  let intervalSpy;

  beforeAll(() => {
    intervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(() => ({ unref() {}, ref() {} }));
  });

  afterAll(() => {
    intervalSpy.mockRestore();
  });

  beforeEach(() => {
    resetSchedulerHeartbeatForTest();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    intervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(() => ({ unref() {}, ref() {} }));
  });

  it("[TESTE OBRIGATÓRIO A] lote vencido fora da janela: o motivo é registrado E gravado na linha", async () => {
    const consoleLogs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      consoleLogs.push(args.join(" "));
    });

    const tables = {
      campaign_dispatches: [
        {
          id: "disp-fora-janela",
          campaign_id: "camp-1",
          client_id: TENANT,
          name: "Lote Fora da Janela",
          steps: [{ id: "s1", type: "text", text: "Olá", order: 1 }],
          trigger_type: "scheduled",
          scheduled_at: "2026-10-14T08:00:00.000Z",
          status: "scheduled",
          evolution_instance_id: null,
          limit_per_run: 5,
          offset: 0,
          error_message: null,
        },
      ],
      campaigns: [
        {
          id: "camp-1",
          name: "Campanha 1",
          client_id: TENANT,
          mode: "campanha",
          analytics_meta: {},
        },
      ],
    };

    const supabase = fakeSupabase(tables);

    // Janela configurada para um horário que certamente está fora do momento atual (ex: 03:00 - 04:00)
    const mockN8nSettings = {
      send_window_enabled: true,
      send_window_start: "03:00",
      send_window_end: "04:00",
      send_window_days: ["mon", "tue", "wed", "thu", "fri"],
      send_window_timezone: "America/Sao_Paulo",
    };

    const deps = {
      ensureDb: () => true,
      getLeadClientN8nSettings: async () => mockN8nSettings,
      materializeRecurringOccurrences: async () => ({ materialized: 0 }),
      runCampaignDispatch: vi.fn(),
      findConcurrentRunningDispatch: async () => null,
      pgDatabasePool: null,
      requireAppViewAccess: () => (req, res, next) => next(),
      requireCampaignDispatchAccess: () => (req, res, next) => next(),
      requireFirebaseAuth: (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      resolveAuthorizedClientId: () => TENANT,
      normalizeString: (s) => String(s || "").trim(),
      normalizeTenantKey: (s) => String(s || "").trim(),
      supabase,
    };

    const dummyApp = { get() {}, post() {}, put() {}, patch() {}, delete() {}, use() {} };
    const { runDueIndependentDispatches } = registerCampaignsRoutes(dummyApp, deps);

    const result = await runDueIndependentDispatches({ limit: 10 });

    // 1. Verificação do retorno
    expect(result.success).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].id).toBe("disp-fora-janela");
    expect(result.skipped[0].code).toBe("OUTSIDE_SEND_WINDOW");
    expect(result.skipped[0].reason).toContain("Fora da janela de envio: horário local");
    expect(result.skipped[0].reason).toContain("próxima abertura prevista para");

    // 2. Verificação do log no console (não foi um continue mudo!)
    const skipLog = consoleLogs.find((l) => l.includes("pulando lote disp-fora-janela"));
    expect(skipLog).toBeDefined();
    expect(skipLog).toContain("Fora da janela de envio: horário local");
    expect(skipLog).toContain("próxima abertura prevista para");

    // 3. Verificação de gravação na linha campaign_dispatches
    const updatedDispatch = tables.campaign_dispatches[0];
    expect(updatedDispatch.error_message).toBeTruthy();
    expect(updatedDispatch.error_message).toContain("Aguardando janela de envio (03:00–04:00");
  });

  it("[TESTE OBRIGATÓRIO B] lote vencido dentro da janela: é processado e o tique registra o resultado", async () => {
    const consoleLogs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      consoleLogs.push(args.join(" "));
    });

    const tables = {
      campaign_dispatches: [
        {
          id: "disp-dentro-janela",
          campaign_id: "camp-1",
          client_id: TENANT,
          name: "Lote Dentro da Janela",
          steps: [{ id: "s1", type: "text", text: "Olá", order: 1 }],
          trigger_type: "scheduled",
          scheduled_at: "2026-10-14T08:00:00.000Z",
          status: "scheduled",
          evolution_instance_id: null,
          limit_per_run: 5,
          offset: 0,
          error_message: null,
        },
      ],
      campaigns: [
        {
          id: "camp-1",
          name: "Campanha 1",
          client_id: TENANT,
          mode: "campanha",
          analytics_meta: {},
        },
      ],
    };

    const supabase = fakeSupabase(tables);

    // Janela 24h aberta todos os dias
    const mockN8nSettings = {
      send_window_enabled: true,
      send_window_start: "00:00",
      send_window_end: "23:59",
      send_window_days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      send_window_timezone: "America/Sao_Paulo",
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ key: { id: "wa-1" } }),
      text: async () => '{"key":{"id":"wa-1"}}',
    });

    const deps = {
      ensureDb: () => true,
      getLeadClientN8nSettings: async () => mockN8nSettings,
      materializeRecurringOccurrences: async () => ({ materialized: 0 }),
      resolveCampaignDispatchSettings: async () => ({
        webhookUrl: "https://evolution.test/message/sendText/inst-1",
        webhookToken: "secret",
        source: "campaign_evolution_instance",
        selectedEvolutionInstanceId: "11111111-2222-4333-8444-555555555555",
      }),
      buildDispatchLeads: async () => [{ id: "lead-1", nome: "Lead 1", telefone: "5511999991000", client_id: TENANT }],
      getClientName: async () => "Tenant Teste",
      getLeadClientEvolutionInstances: async () => [],
      canCampaignBeDispatched: () => true,
      checkEvolutionInstanceHealth: async () => ({ state: "open" }),
      findConcurrentRunningDispatch: async () => null,
      pgDatabasePool: {
        query: async (sql) => {
          const t = String(sql);
          if (t.includes("COUNT(*) FILTER")) return { rows: [{ sent: 1, failed: 0, skipped: 0 }] };
          if (t.includes("is_recurring") || t.includes("recurring")) return { rows: [], rowCount: 0 };
          if (t.includes("campaign_dispatch_occurrences")) return { rows: [], rowCount: 0 };
          if (t.includes("INSERT INTO public.campaign_dispatch_runs")) return { rows: [{ id: "run-1" }], rowCount: 1 };
          return { rows: [], rowCount: 1 };
        },
      },
      requireAppViewAccess: () => (req, res, next) => next(),
      requireCampaignDispatchAccess: () => (req, res, next) => next(),
      requireFirebaseAuth: (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      resolveAuthorizedClientId: () => TENANT,
      normalizeString: (s) => String(s || "").trim(),
      normalizeTenantKey: (s) => String(s || "").trim(),
      supabase,
    };

    const dummyApp = { get() {}, post() {}, put() {}, patch() {}, delete() {}, use() {} };
    const { runDueIndependentDispatches } = registerCampaignsRoutes(dummyApp, deps);

    const result = await runDueIndependentDispatches({ limit: 10 });

    // 1. Verificação do processamento
    expect(result.success).toBe(true);
    expect(result.processed).toBe(1);

    // 2. Verificação do log do tick
    const tickLog = consoleLogs.find((l) => l.includes("[campaign-dispatch-scheduler] tick"));
    expect(tickLog).toBeDefined();
    expect(tickLog).toContain(`pid=${process.pid}`);
    expect(tickLog).toContain("1 lote(s) vencido(s) encontrado(s)");
    expect(tickLog).toContain("processados: 1");
    expect(tickLog).toContain("pulados: 0");

    globalThis.fetch = originalFetch;
  });

  it("[TESTE OBRIGATÓRIO C] sem lotes vencidos: o tique não polui o log (no máximo 1 linha a cada 10 min)", async () => {
    const consoleLogs = [];
    vi.spyOn(console, "log").mockImplementation((...args) => {
      consoleLogs.push(args.join(" "));
    });

    const tables = {
      campaign_dispatches: [],
      campaigns: [],
    };

    const supabase = fakeSupabase(tables);

    const deps = {
      ensureDb: () => true,
      getLeadClientN8nSettings: async () => ({}),
      materializeRecurringOccurrences: async () => ({ materialized: 0 }),
      runCampaignDispatch: vi.fn(),
      findConcurrentRunningDispatch: async () => null,
      pgDatabasePool: null,
      requireAppViewAccess: () => (req, res, next) => next(),
      requireCampaignDispatchAccess: () => (req, res, next) => next(),
      requireFirebaseAuth: (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      resolveAuthorizedClientId: () => TENANT,
      normalizeString: (s) => String(s || "").trim(),
      normalizeTenantKey: (s) => String(s || "").trim(),
      supabase,
    };

    const dummyApp = { get() {}, post() {}, put() {}, patch() {}, delete() {}, use() {} };
    const { runDueIndependentDispatches } = registerCampaignsRoutes(dummyApp, deps);

    // 1º tick: deve registrar heartbeat porque _lastEmptyHeartbeatAt é 0
    await runDueIndependentDispatches({ limit: 10 });
    const heartbeats1 = consoleLogs.filter((l) => l.includes("[campaign-dispatch-scheduler] heartbeat"));
    expect(heartbeats1).toHaveLength(1);
    expect(heartbeats1[0]).toContain(`pid=${process.pid}`);
    expect(heartbeats1[0]).toContain("0 lotes vencidos");

    // 2º tick logo em seguida: NÃO deve emitir novo log
    await runDueIndependentDispatches({ limit: 10 });
    const heartbeats2 = consoleLogs.filter((l) => l.includes("[campaign-dispatch-scheduler] heartbeat"));
    expect(heartbeats2).toHaveLength(1); // Continua 1! Não poluiu o log.

    // 3º tick após 5 minutos: continua sem poluir
    const dateSpy = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 5 * 60 * 1000);
    await runDueIndependentDispatches({ limit: 10 });
    const heartbeats3 = consoleLogs.filter((l) => l.includes("[campaign-dispatch-scheduler] heartbeat"));
    expect(heartbeats3).toHaveLength(1);

    // 4º tick após 11 minutos (> 10 min): agora sim emite o próximo heartbeat
    dateSpy.mockReturnValue(Date.now() + 11 * 60 * 1000);
    await runDueIndependentDispatches({ limit: 10 });
    const heartbeats4 = consoleLogs.filter((l) => l.includes("[campaign-dispatch-scheduler] heartbeat"));
    expect(heartbeats4).toHaveLength(2);
  });

  it("[TESTE OBRIGATÓRIO D] a rota run-due devolve o motivo de cada lote pulado", async () => {
    const originalToken = process.env.CAMPAIGN_SCHEDULER_TOKEN;
    process.env.CAMPAIGN_SCHEDULER_TOKEN = "test-secret-token";

    try {
      let routeHandlers;
      const dummyApp = {
        get() {},
        put() {},
        patch() {},
        delete() {},
        use() {},
        post(path, ...handlers) {
          if (path === "/api/campaigns/run-due") {
            routeHandlers = handlers;
          }
        },
      };

      const tables = {
        campaign_dispatches: [
          {
            id: "disp-skipped-test",
            campaign_id: "camp-1",
            client_id: TENANT,
            name: "Lote Pulado por Janela",
            steps: [{ id: "s1", type: "text", text: "Olá", order: 1 }],
            trigger_type: "scheduled",
            scheduled_at: "2026-10-14T08:00:00.000Z",
            status: "scheduled",
            evolution_instance_id: null,
            limit_per_run: 5,
            offset: 0,
            error_message: null,
          },
        ],
        campaigns: [{ id: "camp-1", name: "Campanha 1", client_id: TENANT, mode: "campanha", analytics_meta: {} }],
      };

      const supabase = fakeSupabase(tables);

      const deps = {
        ensureDb: () => true,
        getLeadClientN8nSettings: async () => ({
          send_window_enabled: true,
          send_window_start: "03:00",
          send_window_end: "04:00",
          send_window_days: ["mon", "tue", "wed", "thu", "fri"],
          send_window_timezone: "America/Sao_Paulo",
        }),
        materializeRecurringOccurrences: async () => ({ materialized: 0 }),
        runCampaignDispatch: vi.fn(),
        findConcurrentRunningDispatch: async () => null,
        runDueCampaignDispatches: async () => ({ processed: 0 }),
        pgDatabasePool: null,
        requireAppViewAccess: () => (req, res, next) => next(),
        requireCampaignDispatchAccess: () => (req, res, next) => next(),
        requireFirebaseAuth: (req, res, next) => next(),
        requireInternalPageAccess: () => (req, res, next) => next(),
        resolveAuthorizedClientId: () => TENANT,
        normalizeString: (s) => String(s || "").trim(),
        normalizeTenantKey: (s) => String(s || "").trim(),
        sendError: (res, status, code, message) => {
          res.status(status).json({ error: { code, message } });
        },
        supabase,
      };

      registerCampaignsRoutes(dummyApp, deps);
      expect(routeHandlers).toBeDefined();

      const [authMiddleware, actionHandler] = routeHandlers;

      // 1. Testa autenticação
      const reqAuthFail = { headers: { authorization: "Bearer wrong-token" }, query: {} };
      let authStatus = null;
      const resAuthFail = {
        status: (code) => {
          authStatus = code;
          return resAuthFail;
        },
        json: () => {},
      };
      authMiddleware(reqAuthFail, resAuthFail, () => {});
      expect(authStatus).toBe(401);

      // 2. Testa chamada autenticada e retorno de lotes pulados
      const reqSuccess = {
        headers: { authorization: "Bearer test-secret-token" },
        body: { limit: 10 },
        query: {},
      };
      let responseData = null;
      const resSuccess = {
        json: (data) => {
          responseData = data;
        },
      };

      await actionHandler(reqSuccess, resSuccess);

      expect(responseData).toBeDefined();
      expect(responseData.skipped).toHaveLength(1);
      expect(responseData.skipped[0].id).toBe("disp-skipped-test");
      expect(responseData.skipped[0].code).toBe("OUTSIDE_SEND_WINDOW");
      expect(responseData.skipped[0].reason).toContain("Fora da janela de envio: horário local");
      expect(responseData.independentDispatches.skipped).toHaveLength(1);
    } finally {
      process.env.CAMPAIGN_SCHEDULER_TOKEN = originalToken;
    }
  });

  it("[TESTE OBRIGATÓRIO E] Head-of-Line Blocking: lotes pausados antigos não impedem a avaliação e disparo de lotes scheduled legítimos", async () => {
    // 15 lotes pausados manualmente no passado (ex: 2026-09-01)
    const pausedDispatches = Array.from({ length: 15 }, (_, i) => ({
      id: `disp-paused-old-${i + 1}`,
      campaign_id: `camp-paused-${i + 1}`,
      client_id: TENANT,
      name: `Lote Pausado Antigo ${i + 1}`,
      steps: [{ id: "s1", type: "text", text: "Olá", order: 1 }],
      trigger_type: "scheduled",
      scheduled_at: "2026-09-01T10:00:00.000Z",
      status: "paused",
      evolution_instance_id: null,
      limit_per_run: 5,
      offset: 0,
      error_message: "Pausado manualmente pelo usuário",
    }));

    // 1 lote agendado legítimo para hoje
    const scheduledDispatch = {
      id: "disp-legitimo-hoje",
      campaign_id: "camp-ativa",
      client_id: TENANT,
      name: "Lote 3 Legítimo Agendado",
      steps: [{ id: "s1", type: "text", text: "Olá", order: 1 }],
      trigger_type: "scheduled",
      scheduled_at: "2026-10-14T08:00:00.000Z",
      status: "scheduled",
      evolution_instance_id: null,
      limit_per_run: 5,
      offset: 0,
      error_message: null,
    };

    const tables = {
      campaign_dispatches: [...pausedDispatches, scheduledDispatch],
      campaigns: [
        ...Array.from({ length: 15 }, (_, i) => ({
          id: `camp-paused-${i + 1}`,
          name: `Campanha Pausada ${i + 1}`,
          client_id: TENANT,
          status: "active",
          analytics_meta: {},
        })),
        {
          id: "camp-ativa",
          name: "Campanha Ativa",
          client_id: TENANT,
          status: "active",
          analytics_meta: {},
        },
      ],
    };

    const supabase = fakeSupabase(tables);

    const mockN8nSettings = {
      send_window_enabled: true,
      send_window_start: "00:00",
      send_window_end: "23:59",
      send_window_days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      send_window_timezone: "America/Sao_Paulo",
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ key: { id: "wa-1" } }),
      text: async () => '{"key":{"id":"wa-1"}}',
    });

    const deps = {
      ensureDb: () => true,
      getLeadClientN8nSettings: async () => mockN8nSettings,
      materializeRecurringOccurrences: async () => ({ materialized: 0 }),
      resolveCampaignDispatchSettings: async () => ({
        webhookUrl: "https://evolution.test/message/sendText/inst-1",
        webhookToken: "secret",
        source: "campaign_evolution_instance",
        selectedEvolutionInstanceId: "11111111-2222-4333-8444-555555555555",
      }),
      buildDispatchLeads: async () => [{ id: "lead-1", nome: "Lead 1", telefone: "5511999991000", client_id: TENANT }],
      getClientName: async () => "Tenant Teste",
      getLeadClientEvolutionInstances: async () => [],
      canCampaignBeDispatched: () => true,
      checkEvolutionInstanceHealth: async () => ({ state: "open" }),
      findConcurrentRunningDispatch: async () => null,
      pgDatabasePool: {
        query: async (sql) => {
          const t = String(sql);
          if (t.includes("COUNT(*) FILTER")) return { rows: [{ sent: 1, failed: 0, skipped: 0 }] };
          if (t.includes("is_recurring") || t.includes("recurring")) return { rows: [], rowCount: 0 };
          if (t.includes("campaign_dispatch_occurrences")) return { rows: [], rowCount: 0 };
          if (t.includes("INSERT INTO public.campaign_dispatch_runs")) return { rows: [{ id: "run-1" }], rowCount: 1 };
          return { rows: [], rowCount: 1 };
        },
      },
      requireAppViewAccess: () => (req, res, next) => next(),
      requireCampaignDispatchAccess: () => (req, res, next) => next(),
      requireFirebaseAuth: (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      resolveAuthorizedClientId: () => TENANT,
      normalizeString: (s) => String(s || "").trim(),
      normalizeTenantKey: (s) => String(s || "").trim(),
      supabase,
    };

    const dummyApp = { get() {}, post() {}, put() {}, patch() {}, delete() {}, use() {} };
    const { runDueIndependentDispatches } = registerCampaignsRoutes(dummyApp, deps);

    // Mesmo com limit 10 ou 50, o lote scheduled deve ser priorizado e processado!
    const result = await runDueIndependentDispatches({ limit: 50 });

    expect(result.success).toBe(true);
    expect(result.processed).toBe(1);
    expect(result.items.some((i) => i.id === "disp-legitimo-hoje" && i.status === "success")).toBe(true);

    globalThis.fetch = originalFetch;
  });

  it("[TESTE OBRIGATÓRIO F] Lote fora da janela de envio tem seu scheduled_at atualizado para a próxima abertura no banco", async () => {
    const initialScheduledAt = "2026-10-14T08:00:00.000Z";
    const tables = {
      campaign_dispatches: [
        {
          id: "disp-janela-update",
          campaign_id: "camp-1",
          client_id: TENANT,
          name: "Lote com Janela Fechada",
          steps: [{ id: "s1", type: "text", text: "Olá", order: 1 }],
          trigger_type: "scheduled",
          scheduled_at: initialScheduledAt,
          status: "scheduled",
          evolution_instance_id: null,
          limit_per_run: 5,
          offset: 0,
          error_message: null,
        },
      ],
      campaigns: [
        {
          id: "camp-1",
          name: "Campanha 1",
          client_id: TENANT,
          status: "active",
          mode: "campanha",
          analytics_meta: {},
        },
      ],
    };

    const supabase = fakeSupabase(tables);

    const mockN8nSettings = {
      send_window_enabled: true,
      send_window_start: "03:00",
      send_window_end: "04:00",
      send_window_days: ["mon", "tue", "wed", "thu", "fri"],
      send_window_timezone: "America/Sao_Paulo",
    };

    const deps = {
      ensureDb: () => true,
      getLeadClientN8nSettings: async () => mockN8nSettings,
      materializeRecurringOccurrences: async () => ({ materialized: 0 }),
      runCampaignDispatch: vi.fn(),
      findConcurrentRunningDispatch: async () => null,
      pgDatabasePool: null,
      requireAppViewAccess: () => (req, res, next) => next(),
      requireCampaignDispatchAccess: () => (req, res, next) => next(),
      requireFirebaseAuth: (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      resolveAuthorizedClientId: () => TENANT,
      normalizeString: (s) => String(s || "").trim(),
      normalizeTenantKey: (s) => String(s || "").trim(),
      supabase,
    };

    const dummyApp = { get() {}, post() {}, put() {}, patch() {}, delete() {}, use() {} };
    const { runDueIndependentDispatches } = registerCampaignsRoutes(dummyApp, deps);

    const result = await runDueIndependentDispatches({ limit: 50 });

    expect(result.success).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].code).toBe("OUTSIDE_SEND_WINDOW");

    // scheduled_at deve ter sido atualizado no banco para a próxima data/hora de abertura
    const updatedDispatch = tables.campaign_dispatches[0];
    expect(updatedDispatch.scheduled_at).toBe(result.skipped[0].nextOpening);
    expect(updatedDispatch.scheduled_at).not.toBe(initialScheduledAt);
    expect(updatedDispatch.error_message).toContain("Aguardando janela de envio");
  });

  it("[TESTE OBRIGATÓRIO G] Lote de campanha mãe inativa (status='paused', 'cancelled' ou archived) é ignorado com CAMPAIGN_INACTIVE", async () => {
    const tables = {
      campaign_dispatches: [
        {
          id: "disp-camp-pausada",
          campaign_id: "camp-pausada",
          client_id: TENANT,
          name: "Lote de Campanha Pausada",
          steps: [{ id: "s1", type: "text", text: "Olá", order: 1 }],
          trigger_type: "scheduled",
          scheduled_at: "2026-10-14T08:00:00.000Z",
          status: "scheduled",
          evolution_instance_id: null,
          limit_per_run: 5,
          offset: 0,
          error_message: null,
        },
        {
          id: "disp-camp-arquivada",
          campaign_id: "camp-arquivada",
          client_id: TENANT,
          name: "Lote de Campanha Arquivada",
          steps: [{ id: "s1", type: "text", text: "Olá", order: 1 }],
          trigger_type: "scheduled",
          scheduled_at: "2026-10-14T08:00:00.000Z",
          status: "scheduled",
          evolution_instance_id: null,
          limit_per_run: 5,
          offset: 0,
          error_message: null,
        },
      ],
      campaigns: [
        {
          id: "camp-pausada",
          name: "Campanha Pausada",
          client_id: TENANT,
          status: "paused",
          analytics_meta: {},
        },
        {
          id: "camp-arquivada",
          name: "Campanha Arquivada",
          client_id: TENANT,
          status: "active",
          archived_at: "2026-10-14T09:00:00.000Z",
          analytics_meta: {},
        },
      ],
    };

    const supabase = fakeSupabase(tables);

    const mockN8nSettings = {
      send_window_enabled: false,
    };

    const mockRunCampaignDispatch = vi.fn();

    const deps = {
      ensureDb: () => true,
      getLeadClientN8nSettings: async () => mockN8nSettings,
      materializeRecurringOccurrences: async () => ({ materialized: 0 }),
      runCampaignDispatch: mockRunCampaignDispatch,
      findConcurrentRunningDispatch: async () => null,
      pgDatabasePool: null,
      requireAppViewAccess: () => (req, res, next) => next(),
      requireCampaignDispatchAccess: () => (req, res, next) => next(),
      requireFirebaseAuth: (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      resolveAuthorizedClientId: () => TENANT,
      normalizeString: (s) => String(s || "").trim(),
      normalizeTenantKey: (s) => String(s || "").trim(),
      supabase,
    };

    const dummyApp = { get() {}, post() {}, put() {}, patch() {}, delete() {}, use() {} };
    const { runDueIndependentDispatches } = registerCampaignsRoutes(dummyApp, deps);

    const result = await runDueIndependentDispatches({ limit: 50 });

    expect(result.success).toBe(true);
    expect(result.processed).toBe(0);
    expect(result.skipped).toHaveLength(2);
    expect(result.skipped[0].code).toBe("CAMPAIGN_INACTIVE");
    expect(result.skipped[0].reason).toContain("Campanha mãe está inativa");
    expect(result.skipped[1].code).toBe("CAMPAIGN_INACTIVE");
    expect(result.skipped[1].reason).toContain("Campanha mãe está inativa (arquivada)");
    expect(mockRunCampaignDispatch).not.toHaveBeenCalled();
  });
});

