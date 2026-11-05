// backend/src/test/campaignDispatchAutoHealing.test.js
//
// Suíte de testes para a blindagem definitiva contra falhas em disparos:
// 1. Auto-cura de chip cujo UUID não existe mais no banco para chip ativo com mesmo nome.
// 2. Fallback para chip padrão ativo (is_default = true) quando chip antigo foi apagado sem casamento de nome.
// 3. Sincronização atômica de status mãe-filho: trigger e run-pending ativam a campanha mãe se estiver paused.
// 4. Proteção contra inanição de pool no dispatch-summary (statement_timeout = 3000ms com fallback para 0 respostas).

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";

describe("Blindagem do Motor de Disparo: Auto-Cura de Chips e Sincronização Mãe-Filho", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("fetchInstances") || urlStr.includes("connectionState")) {
        return { ok: true, status: 200, json: async () => ({ state: "open" }), text: async () => '{"state":"open"}' };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ key: { id: "wa-msg-123" } }),
        text: async () => '{"key":{"id":"wa-msg-123"}}',
      };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function createMockSupabase(dispatchesTable, campaignsTable = {}) {
    return {
      from: (table) => ({
        select: (cols) => ({
          eq: (col1, val1) => ({
            eq: (col2, val2) => ({
              maybeSingle: async () => {
                if (table === "campaign_dispatches") return { data: dispatchesTable[val1] || dispatchesTable[val2] || null, error: null };
                if (table === "campaigns") return { data: campaignsTable[val1] || campaignsTable[val2] || null, error: null };
                return { data: null, error: null };
              },
              single: async () => {
                if (table === "campaign_dispatches") return { data: dispatchesTable[val1] || dispatchesTable[val2] || null, error: null };
                if (table === "campaigns") return { data: campaignsTable[val1] || campaignsTable[val2] || null, error: null };
                return { data: null, error: null };
              },
            }),
            maybeSingle: async () => {
              if (table === "campaign_dispatches") return { data: dispatchesTable[val1] || null, error: null };
              if (table === "campaigns") return { data: campaignsTable[val1] || null, error: null };
              return { data: null, error: null };
            },
            single: async () => {
              if (table === "campaign_dispatches") return { data: dispatchesTable[val1] || null, error: null };
              if (table === "campaigns") return { data: campaignsTable[val1] || null, error: null };
              return { data: null, error: null };
            },
          }),
        }),
        update: (patch) => {
          const chain = {
            eq: (col, val) => {
              if (table === "campaign_dispatches" && dispatchesTable[val]) {
                Object.assign(dispatchesTable[val], patch);
              }
              if (table === "campaigns" && campaignsTable[val]) {
                Object.assign(campaignsTable[val], patch);
              }
              return chain;
            },
            neq: (col, val) => {
              return chain;
            },
            select: () => ({
              single: async () => ({ data: {}, error: null }),
              then: (resolve) => resolve({ data: [{}], error: null }),
            }),
            then: (resolve) => resolve({ data: [], error: null }),
            catch: () => Promise.resolve(),
          };
          return chain;
        },
      }),
    };
  }

  function createTestDeps(mockPool, overrides = {}) {
    return {
      CAMPAIGN_SCHEDULER_MAX_BATCH: 10,
      buildDispatchLeads: async () => [
        { id: "lead-1", nome: "Lead Teste", telefone: "5511999990001", client_id: "tenant-heal" },
      ],
      canCampaignBeDispatched: () => true,
      checkEvolutionInstanceHealth: async () => ({ state: "open" }),
      continueCampaignLeadFromReply: async () => {},
      ensureDb: () => true,
      executeCampaignDispatch: async () => {},
      findCampaignReplyMatches: async () => [],
      getClientName: async () => "Tenant AutoHeal",
      getLeadClientEvolutionInstances: async () => [],
      getLeadClientN8nSettings: async () => ({
        send_window_enabled: false,
        send_window_start: "00:00",
        send_window_end: "23:59",
        send_window_days: ["seg", "ter", "qua", "qui", "sex", "sab", "dom"],
      }),
      getRequestId: () => "req-1",
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
      pgDatabasePool: mockPool,
      requireAppViewAccess: () => (req, res, next) => next(),
      requireCampaignDispatchAccess: () => (req, res, next) => next(),
      requireFirebaseAuth: () => (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      resolveAuthorizedClientId: () => "tenant-heal",
      resolveCampaignDispatchSettings: async (clientId, camp) => {
        const chipId = camp?.analytics_meta?.dispatchOptions?.dispatchChipIds?.[0] || "active-chip-uuid-1";
        return {
          webhookUrl: `https://evolution.test/message/sendText/${chipId}`,
          webhookToken: "secret-token",
          instanceName: "WhatsApp Comercial",
        };
      },
      resolveDispatchWebhookSettings: async () => ({}),
      runDueCampaignDispatches: async () => {},
      sanitizePhone: (p) => p,
      sendError: vi.fn((res, status, code, message) => {
        res.statusCode = status;
        res.body = { error: { code, message } };
      }),
      supabase: null,
      validateN8nInboundBearer: () => true,
      ...overrides,
    };
  }

  it("[TESTE OBRIGATÓRIO 1] Lote com chip cujo UUID não existe mais no banco se auto-cura para o chip ativo do tenant com mesmo nome e dispara normalmente", async () => {
    const deadChipUuid = "00000000-0000-0000-0000-00000000dead";
    const activeChipUuid = "11111111-1111-4111-a111-11111111active";
    const clientId = "tenant-heal";

    // O banco só tem a nova instância ativa com o mesmo nome amigável
    const activeInstances = [
      {
        id: activeChipUuid,
        client_id: clientId,
        name: "WhatsApp Comercial",
        connection_state: "open",
        active: true,
        is_default: false,
        dispatch_webhook_url: `https://evolution.test/message/sendText/${activeChipUuid}`,
        dispatch_webhook_token: "secret-token",
        sent_count_today: 0,
      },
    ];

    const dispatchId = "disp-heal-1";
    const campaignId = "camp-heal-1";

    const dispatchesTable = {
      [dispatchId]: {
        id: dispatchId,
        campaign_id: campaignId,
        client_id: clientId,
        name: "Lote com Chip Morto",
        status: "running",
        target_count: 1,
        sent_count: 0,
        failed_count: 0,
        evolution_instance_id: deadChipUuid,
        dispatch_options: {
          dispatchChipIds: [deadChipUuid],
          chipName: "WhatsApp Comercial",
          leadDelaySeconds: 0,
        },
      },
    };

    const campaignsTable = {
      [campaignId]: {
        id: campaignId,
        name: "Campanha Reconexão",
        client_id: clientId,
        status: "active",
        mode: "campanha",
        analytics_meta: {
          sequence: [
            { id: "s1", type: "text", text: "Olá {{nome}}", order: 1, enabled: true },
          ],
          dispatchOptions: {
            dispatchChipIds: [deadChipUuid],
            chipName: "WhatsApp Comercial",
          },
        },
      },
    };

    const poolUpdates = [];
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        const sqlStr = String(sql);
        if (sqlStr.includes("UPDATE public.campaign_dispatches")) {
          poolUpdates.push({ table: "campaign_dispatches", sql: sqlStr, params });
          return { rowCount: 1, rows: [{ id: dispatchId }] };
        }
        if (sqlStr.includes("UPDATE public.campaigns")) {
          poolUpdates.push({ table: "campaigns", sql: sqlStr, params });
          return { rowCount: 1, rows: [{ id: campaignId }] };
        }
        if (sqlStr.includes("lead_import_items")) {
          return {
            rows: [{ id: "lead-1", nome: "Lead Teste", telefone: "5511999990001", client_id: clientId }],
            rowCount: 1,
          };
        }
        if (sqlStr.includes("INSERT INTO public.campaign_dispatch_runs")) {
          return { rowCount: 1, rows: [{ id: "run-1" }] };
        }
        if (sqlStr.includes("UPDATE public.campaign_dispatch_runs SET status = 'sent'")) {
          return { rowCount: 1, rows: [] };
        }
        if (sqlStr.includes("COUNT(*) FILTER")) {
          return { rows: [{ sent: 1, failed: 0, skipped: 0 }] };
        }
        if (sqlStr.includes("INSERT INTO public.evolution_instance_daily_usage")) {
          return { rows: [{ sent_count: 1 }] };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockSupabase = createMockSupabase(dispatchesTable, campaignsTable);
    const consoleLogs = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      consoleLogs.push(args.join(" "));
    });

    const dummyApp = { get() {}, post() {}, put() {}, patch() {}, delete() {}, use() {} };
    const deps = createTestDeps(mockPool, {
      supabase: mockSupabase,
      getLeadClientEvolutionInstances: async () => activeInstances,
    });

    const { runCampaignDispatch } = registerCampaignsRoutes(dummyApp, deps);

    const dispatchObj = dispatchesTable[dispatchId];
    const campaignObj = campaignsTable[campaignId];

    await runCampaignDispatch({
      dispatch: dispatchObj,
      campaign: campaignObj,
      supabase: mockSupabase,
    });

    // 1. O lote NÃO deve ter sido pausado
    expect(dispatchObj.status).not.toBe("paused");
    expect(dispatchesTable[dispatchId].status).not.toBe("paused");
    expect(dispatchObj.error_message).toBeFalsy();

    // 2. Deve ter emitido o log explícito de AUTO-HEALING
    const healLog = consoleLogs.find((l) => l.includes("[campaign-dispatch] AUTO-HEALING: Chip remapeado com sucesso"));
    expect(healLog).toBeDefined();
    expect(healLog).toContain('Chip remapeado com sucesso para "WhatsApp Comercial"');
    expect(healLog).toContain(activeChipUuid);

    // 3. Objeto do lote e da campanha foram remapeados para o novo chip
    expect(dispatchObj.evolution_instance_id).toBe(activeChipUuid);
    expect(dispatchObj.dispatch_options.dispatchChipIds).toEqual([activeChipUuid]);
    expect(campaignObj.analytics_meta.dispatchOptions.dispatchChipIds).toEqual([activeChipUuid]);

    // 4. Banco recebeu atualização assíncrona parametrizada ($1::jsonb)
    const dispatchUpdate = poolUpdates.find((u) => u.table === "campaign_dispatches");
    expect(dispatchUpdate).toBeDefined();
    expect(dispatchUpdate.sql).toContain("$2::jsonb");
    expect(dispatchUpdate.params[0]).toBe(activeChipUuid);

    const campaignUpdate = poolUpdates.find((u) => u.table === "campaigns");
    expect(campaignUpdate).toBeDefined();
    expect(campaignUpdate.sql).toContain("$1::jsonb");
    expect(campaignUpdate.params[0]).toContain(activeChipUuid);

    logSpy.mockRestore();
  });

  it("[TESTE OBRIGATÓRIO 2] Lote com chip apagado faz fallback para o chip padrão ativo (is_default = true) sem pausar", async () => {
    const deletedChipUuid = "00000000-0000-0000-0000-00000000deleted";
    const defaultChipUuid = "22222222-2222-4222-a222-22222222default";
    const secondaryChipUuid = "33333333-3333-4333-a333-33333333sec";
    const clientId = "tenant-heal";

    // 2 chips ativos, nenhum tem o nome do chip apagado; chip padrão marcado com is_default = true
    const activeInstances = [
      {
        id: secondaryChipUuid,
        client_id: clientId,
        name: "Chip Secundário Suporte",
        is_default: false,
        connection_state: "open",
        active: true,
        dispatch_webhook_url: `https://evolution.test/message/sendText/${secondaryChipUuid}`,
        dispatch_webhook_token: "tok-sec",
      },
      {
        id: defaultChipUuid,
        client_id: clientId,
        name: "WhatsApp Padrão da Empresa",
        is_default: true,
        connection_state: "open",
        active: true,
        dispatch_webhook_url: `https://evolution.test/message/sendText/${defaultChipUuid}`,
        dispatch_webhook_token: "tok-def",
      },
    ];

    const dispatchId = "disp-heal-fallback";
    const campaignId = "camp-heal-fallback";

    const dispatchesTable = {
      [dispatchId]: {
        id: dispatchId,
        campaign_id: campaignId,
        client_id: clientId,
        name: "Lote com Chip Excluído",
        status: "running",
        target_count: 1,
        sent_count: 0,
        failed_count: 0,
        evolution_instance_id: deletedChipUuid,
        dispatch_options: {
          dispatchChipIds: [deletedChipUuid],
          chipName: "Chip Que Ja Nao Existe Mais Nem Por Nome",
          leadDelaySeconds: 0,
        },
      },
    };

    const campaignsTable = {
      [campaignId]: {
        id: campaignId,
        name: "Campanha Fallback",
        client_id: clientId,
        status: "active",
        mode: "campanha",
        analytics_meta: {
          sequence: [{ id: "s1", type: "text", text: "Olá", order: 1, enabled: true }],
          dispatchOptions: {
            dispatchChipIds: [deletedChipUuid],
          },
        },
      },
    };

    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        const sqlStr = String(sql);
        if (sqlStr.includes("UPDATE public.campaign_dispatches") || sqlStr.includes("UPDATE public.campaigns")) {
          return { rowCount: 1, rows: [{ id: "ok" }] };
        }
        if (sqlStr.includes("lead_import_items")) {
          return { rows: [{ id: "l-1", nome: "Lead 1", telefone: "5511999990001", client_id: clientId }], rowCount: 1 };
        }
        if (sqlStr.includes("INSERT INTO public.campaign_dispatch_runs")) {
          return { rowCount: 1, rows: [{ id: "run-1" }] };
        }
        if (sqlStr.includes("UPDATE public.campaign_dispatch_runs SET status = 'sent'")) {
          return { rowCount: 1, rows: [] };
        }
        if (sqlStr.includes("COUNT(*) FILTER")) {
          return { rows: [{ sent: 1, failed: 0, skipped: 0 }] };
        }
        if (sqlStr.includes("INSERT INTO public.evolution_instance_daily_usage")) {
          return { rows: [{ sent_count: 1 }] };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockSupabase = createMockSupabase(dispatchesTable, campaignsTable);
    const consoleLogs = [];
    const logSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      consoleLogs.push(args.join(" "));
    });

    const dummyApp = { get() {}, post() {}, put() {}, patch() {}, delete() {}, use() {} };
    const deps = createTestDeps(mockPool, {
      supabase: mockSupabase,
      getLeadClientEvolutionInstances: async () => activeInstances,
    });

    const { runCampaignDispatch } = registerCampaignsRoutes(dummyApp, deps);

    const dispatchObj = dispatchesTable[dispatchId];
    const campaignObj = campaignsTable[campaignId];

    await runCampaignDispatch({
      dispatch: dispatchObj,
      campaign: campaignObj,
      supabase: mockSupabase,
    });

    // 1. NÃO foi pausado
    expect(dispatchObj.status).not.toBe("paused");
    expect(dispatchesTable[dispatchId].status).not.toBe("paused");

    // 2. Foi selecionado o chip padrão (is_default = true)
    expect(dispatchObj.evolution_instance_id).toBe(defaultChipUuid);
    expect(dispatchObj.dispatch_options.dispatchChipIds).toEqual([defaultChipUuid]);

    // 3. Log explícito emitido
    const log = consoleLogs.find((l) => l.includes("AUTO-HEALING: Chip remapeado com sucesso"));
    expect(log).toBeDefined();
    expect(log).toContain('WhatsApp Padrão da Empresa');
    expect(log).toContain(defaultChipUuid);

    logSpy.mockRestore();
  });

  it("[TESTE OBRIGATÓRIO 3] Disparo manual via trigger ou run-pending ativa atomicamente a campanha mãe no banco caso ela estivesse paused", async () => {
    const clientId = "tenant-heal";
    const campaignId = "camp-paused-1";
    const dispatchIdTrigger = "disp-to-trigger";
    const dispatchIdPending = "disp-to-pending";

    const campaignsTable = {
      [campaignId]: {
        id: campaignId,
        client_id: clientId,
        name: "Campanha Pausada",
        status: "paused",
        archived_at: null,
        import_id: "imp-1",
        limit_per_run: 10,
        analytics_meta: { importSource: "imp-1" },
      },
    };

    const dispatchesTable = {
      [dispatchIdTrigger]: {
        id: dispatchIdTrigger,
        campaign_id: campaignId,
        client_id: clientId,
        name: "Lote 1",
        status: "scheduled",
        trigger_type: "scheduled",
        target_count: 5,
        offset: 0,
      },
      [dispatchIdPending]: {
        id: dispatchIdPending,
        campaign_id: campaignId,
        client_id: clientId,
        name: "Lote 2",
        status: "interrupted",
        trigger_type: "manual",
        target_count: 5,
        offset: 0,
        steps: [{ id: "s1", type: "text", text: "Olá" }],
      },
    };

    const motherCampaignUpdates = [];
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        const sqlStr = String(sql);
        if (sqlStr.includes("UPDATE public.campaigns SET status = 'active'")) {
          motherCampaignUpdates.push({ sql: sqlStr, params });
          if (campaignsTable[params[0]]) {
            campaignsTable[params[0]].status = "active";
          }
          return { rowCount: 1, rows: [{ id: params[0], status: "active" }] };
        }
        if (sqlStr.includes("FROM public.campaign_dispatches")) {
          return { rows: [] };
        }
        if (sqlStr.includes("UPDATE public.campaign_dispatches")) {
          return { rowCount: 1, rows: [{ id: "disp" }] };
        }
        if (sqlStr.includes("lead_import_items")) {
          return {
            rows: [{ id: "lead-1", nome: "Lead 1", telefone: "5511999990001", client_id: clientId }],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const mockSupabase = createMockSupabase(dispatchesTable, campaignsTable);
    const routes = {};
    const dummyApp = {
      get() {},
      post(path, ...handlers) {
        routes[`POST ${path}`] = handlers[handlers.length - 1];
      },
      put() {},
      patch() {},
      delete() {},
      use() {},
    };

    const deps = createTestDeps(mockPool, {
      supabase: mockSupabase,
      buildDispatchLeads: async () => [
        { id: "lead-1", nome: "Lead 1", telefone: "5511999990001", client_id: clientId },
      ],
    });

    registerCampaignsRoutes(dummyApp, deps);

    // --- Sub-teste A: Acionamento via trigger ---
    const triggerHandler = routes["POST /api/campaigns/dispatches/:dispatchId/trigger"];
    expect(triggerHandler).toBeDefined();

    let triggerResPayload = null;
    let triggerResStatus = 200;
    const resTrigger = {
      status(code) { triggerResStatus = code; return this; },
      json(payload) { triggerResPayload = payload; return this; },
    };

    // Campanha mãe começa paused
    campaignsTable[campaignId].status = "paused";
    motherCampaignUpdates.length = 0;

    await triggerHandler(
      {
        params: { dispatchId: dispatchIdTrigger },
        authAccess: { uid: "user-1", email: "user@test.com" },
      },
      resTrigger
    );

    expect(triggerResStatus).toBe(200);
    expect(triggerResPayload?.success).toBe(true);
    expect(triggerResPayload?.status).toBe("running");

    // Prova atômica no banco: UPDATE public.campaigns SET status = 'active', archived_at = NULL, updated_at = now() WHERE id = $1 AND status != 'active'
    const atomicUpdateFromTrigger = motherCampaignUpdates.find(
      (u) => u.sql.includes("status = 'active'") && u.sql.includes("archived_at = NULL")
    );
    expect(atomicUpdateFromTrigger).toBeDefined();
    expect(atomicUpdateFromTrigger.params[0]).toBe(campaignId);
    expect(campaignsTable[campaignId].status).toBe("active");

    // --- Sub-teste B: Acionamento via run-pending ---
    const runPendingHandler = routes["POST /api/campaigns/dispatches/:dispatchId/run-pending"];
    expect(runPendingHandler).toBeDefined();

    let pendingResPayload = null;
    let pendingResStatus = 200;
    const resPending = {
      status(code) { pendingResStatus = code; return this; },
      json(payload) { pendingResPayload = payload; return this; },
    };

    // Coloca a campanha mãe em 'paused' novamente para testar run-pending
    campaignsTable[campaignId].status = "paused";
    motherCampaignUpdates.length = 0;

    await runPendingHandler(
      {
        params: { dispatchId: dispatchIdPending },
        authAccess: { uid: "user-1", email: "user@test.com" },
      },
      resPending
    );

    expect(pendingResStatus).toBe(200);
    expect(pendingResPayload?.success).toBe(true);

    const atomicUpdateFromPending = motherCampaignUpdates.find(
      (u) => u.sql.includes("status = 'active'") && u.sql.includes("archived_at = NULL")
    );
    expect(atomicUpdateFromPending).toBeDefined();
    expect(atomicUpdateFromPending.params[0]).toBe(campaignId);
    expect(campaignsTable[campaignId].status).toBe("active");
  });

  it("Pausa o lote APENAS quando não existe de fato nenhum chip ativo/conectado no tenant inteiro", async () => {
    const clientId = "tenant-no-chips";
    const dispatchId = "disp-no-chips";
    const campaignId = "camp-no-chips";

    const dispatchesTable = {
      [dispatchId]: {
        id: dispatchId,
        campaign_id: campaignId,
        client_id: clientId,
        name: "Lote Sem Chips",
        status: "running",
        target_count: 1,
        sent_count: 0,
        failed_count: 0,
        evolution_instance_id: "chip-qualquer",
        dispatch_options: {
          dispatchChipIds: ["chip-qualquer"],
          leadDelaySeconds: 0,
        },
      },
    };

    const campaignsTable = {
      [campaignId]: {
        id: campaignId,
        name: "Campanha Sem Chips",
        client_id: clientId,
        status: "active",
        mode: "campanha",
        analytics_meta: {
          sequence: [{ id: "s1", type: "text", text: "Olá", order: 1, enabled: true }],
          dispatchOptions: { dispatchChipIds: ["chip-qualquer"] },
        },
      },
    };

    const mockSupabase = createMockSupabase(dispatchesTable, campaignsTable);
    const dummyApp = { get() {}, post() {}, put() {}, patch() {}, delete() {}, use() {} };
    const deps = createTestDeps(null, {
      supabase: mockSupabase,
      getLeadClientEvolutionInstances: async () => [], // ZERO chips no tenant inteiro!
    });

    const { runCampaignDispatch } = registerCampaignsRoutes(dummyApp, deps);

    const dispatchObj = dispatchesTable[dispatchId];
    await runCampaignDispatch({
      dispatch: dispatchObj,
      campaign: campaignsTable[campaignId],
      supabase: mockSupabase,
    });

    expect(dispatchObj.status).toBe("paused");
    expect(dispatchObj.error_message).toContain("nenhum dos chips configurados para disparo está conectado");
  });

  it("Proteção contra inanição de pool no dispatch-summary: timeout em replied_count faz fallback seguro devolvendo 0 respostas sem erro 500", async () => {
    const clientId = "tenant-heal";
    const campaignId = "camp-slow-query";

    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        const sqlStr = String(sql);
        if (sqlStr.includes("GROUP BY d.campaign_id, c.name")) {
          return {
            rows: [
              {
                campaign_id: campaignId,
                campaign_name: "Campanha Lenta",
                created_at: new Date().toISOString(),
                last_updated_at: new Date().toISOString(),
                statuses: ["running"],
                total_batches: 1,
                sent_count: 100,
                failed_count: 0,
                target_count: 100,
                leads_will_run: 0,
                leads_resume_target: 0,
              },
            ],
          };
        }
        if (sqlStr.includes("campaign_dispatch_runs r") && sqlStr.includes("replied_count")) {
          // Simula erro de statement_timeout do Postgres
          const timeoutErr = new Error("canceling statement due to statement timeout");
          timeoutErr.code = "57014";
          throw timeoutErr;
        }
        if (sqlStr.includes("FROM public.campaign_dispatches") && sqlStr.includes("ORDER BY created_at ASC")) {
          return {
            rows: [
              {
                id: "disp-slow-1",
                campaign_id: campaignId,
                status: "running",
                sent_count: 100,
                failed_count: 0,
                target_count: 100,
                scheduled_at: null,
                created_at: new Date().toISOString(),
              },
            ],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const routes = {};
    const dummyApp = {
      get(path, ...handlers) {
        routes[`GET ${path}`] = handlers[handlers.length - 1];
      },
      post() {},
      put() {},
      patch() {},
      delete() {},
      use() {},
    };

    const deps = createTestDeps(mockPool);
    registerCampaignsRoutes(dummyApp, deps);

    const summaryHandler = routes["GET /api/campaigns/dispatch-summary"];
    expect(summaryHandler).toBeDefined();

    let resBody = null;
    let resStatus = 200;
    const res = {
      status(code) { resStatus = code; return this; },
      json(payload) { resBody = payload; return this; },
    };

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await summaryHandler(
      {
        query: { clientId },
        authAccess: { uid: "user-1", email: "user@test.com" },
      },
      res
    );

    // Rota respondeu com sucesso 200, sem 500, sem travar o pool
    expect(resStatus).toBe(200);
    expect(resBody?.campaigns).toBeDefined();
    expect(resBody.campaigns.length).toBe(1);
    // Métrica cosmética repliedCount fez fallback seguro para 0
    expect(resBody.campaigns[0].repliedCount).toBe(0);

    warnSpy.mockRestore();
  });
});
