import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";

describe("runCampaignDispatch - Execução de Ponta a Ponta do Laço de Disparo", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const dummyApp = {
    get: () => {},
    post: () => {},
    put: () => {},
    patch: () => {},
    delete: () => {},
    use: () => {},
  };

  const mockCampaign = {
    id: "camp-e2e-1",
    name: "Campanha E2E Teste",
    client_id: "tenant-e2e",
    mode: "campanha",
    analytics_meta: {
      sequence: [
        { id: "step-1", type: "text", text: "Olá {{nome}}, tudo bem?", order: 1, enabled: true, delayAfterSeconds: 0 },
      ],
    },
  };

  function createTestContext(mockPool, customOverrides = {}) {
    const deps = {
      CAMPAIGN_SCHEDULER_MAX_BATCH: 10,
      buildDispatchLeads: async () => [
        { id: "lead-1", nome: "Ana", telefone: "5511999990001", client_id: "tenant-e2e" },
        { id: "lead-2", nome: "Bruno", telefone: "5511999990002", client_id: "tenant-e2e" },
      ],
      canCampaignBeDispatched: () => true,
      checkEvolutionInstanceHealth: async () => ({ state: "open" }),
      continueCampaignLeadFromReply: async () => {},
      ensureDb: () => true,
      executeCampaignDispatch: async () => {},
      findCampaignReplyMatches: async () => [],
      getClientName: async () => "Tenant Teste",
      getLeadClientEvolutionInstances: async () => [
        {
          id: "chip-1",
          client_id: "tenant-e2e",
          name: "GD Gabriel",
          dispatch_webhook_url: "https://evolution.teste/message/sendText/chip-1",
          dispatch_webhook_token: "secret-token",
          active: true,
        },
      ],
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
      parseOptionalUuid: (s) => s,
      pgDatabasePool: mockPool,
      requireAppViewAccess: () => (req, res, next) => next(),
      requireCampaignDispatchAccess: () => (req, res, next) => next(),
      requireFirebaseAuth: (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      resolveAuthorizedClientId: () => "tenant-e2e",
      resolveCampaignDispatchSettings: async () => ({
        webhookUrl: "https://evolution.teste/message/sendText/chip-1",
        webhookToken: "secret-token",
        instanceName: "GD Gabriel",
      }),
      resolveDispatchWebhookSettings: async () => ({}),
      runDueCampaignDispatches: async () => {},
      sanitizePhone: (p) => p,
      sendError: () => {},
      supabase: null,
      validateN8nInboundBearer: () => true,
      ...customOverrides,
    };

    return registerCampaignsRoutes(dummyApp, deps);
  }

  function createMockSupabase(dispatchesTable, dispatchId) {
    return {
      from: (table) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: dispatchesTable[dispatchId], error: null }),
            eq: () => ({
              maybeSingle: async () => ({ data: dispatchesTable[dispatchId], error: null }),
            }),
            single: async () => ({ data: dispatchesTable[dispatchId], error: null }),
          }),
        }),
        update: (patch) => {
          const updateChain = {
            eq: (col, val) => {
              if (table === "campaign_dispatches" && val === dispatchId) {
                Object.assign(dispatchesTable[dispatchId], patch);
              }
              return updateChain;
            },
            then: (resolve) => resolve({ data: dispatchesTable[dispatchId], error: null }),
            catch: () => Promise.resolve(),
          };
          return updateChain;
        },
      }),
    };
  }

  // roda o disparo completo com um chip de id `chipId` e devolve o que o laço gravou no UPDATE de 'sent'
  async function runSuccessScenario(chipId) {
    const dispatchId = "disp-e2e-success";
    const dispatchesTable = {
      [dispatchId]: {
        id: dispatchId,
        client_id: "tenant-e2e",
        name: "Lote Sucesso",
        campaign_id: mockCampaign.id,
        status: "running",
        target_count: 2,
        sent_count: 0,
        failed_count: 0,
        dispatch_options: { leadDelaySeconds: 0 },
      },
    };

    const mockSupabase = createMockSupabase(dispatchesTable, dispatchId);

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

    const claimedLeads = [];
    const finalizedSent = [];
    const finalizedChips = [];
    const quotaReserved = [];

    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        const sqlStr = String(sql);
        if (sqlStr.includes("SELECT id, name, dispatch_webhook_url")) {
          return {
            rows: [
              {
                id: chipId,
                client_id: "tenant-e2e",
                name: "GD Gabriel",
                dispatch_webhook_url: "https://evolution.teste/message/sendText/chip-1",
                dispatch_webhook_token: "secret-token",
                active: true,
              },
            ],
          };
        }
        if (sqlStr.includes("SELECT id, client_id, name, active, daily_limit")) {
          return {
            rows: [
              {
                id: chipId,
                client_id: "tenant-e2e",
                name: "GD Gabriel",
                active: true,
                daily_limit: 500,
              },
            ],
          };
        }
        if (sqlStr.includes("lead_import_items") && sqlStr.includes("LIMIT")) {
          return {
            rows: [
              { id: "lead-1", nome: "Ana", telefone: "5511999990001", client_id: "tenant-e2e" },
              { id: "lead-2", nome: "Bruno", telefone: "5511999990002", client_id: "tenant-e2e" },
            ],
          };
        }
        if (sqlStr.includes("INSERT INTO public.evolution_instance_daily_usage")) {
          quotaReserved.push(params[2]); // mensagens reservadas (cota por mensagem)
          return { rows: [{ sent_count: quotaReserved.reduce((a, b) => a + b, 0) }] };
        }
        if (sqlStr.includes("INSERT INTO public.campaign_dispatch_runs")) {
          claimedLeads.push(params[3]);
          return { rowCount: 1, rows: [{ id: "claim-uuid" }] };
        }
        if (sqlStr.includes("UPDATE public.campaign_dispatch_runs SET status = 'sent'")) {
          finalizedSent.push(params[1]);
          finalizedChips.push(params[3]);
          return { rowCount: 1, rows: [] };
        }
        if (sqlStr.includes("COUNT(*) FILTER")) {
          return {
            rows: [{ sent: 2, failed: 0, skipped: 0 }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const routes = createTestContext(mockPool, {
      // o webhook de envio é o da instância cadastrada (é assim que resolveCampaignDispatchSettings devolve)
      resolveCampaignDispatchSettings: async () => ({
        webhookUrl: "https://evolution.teste/message/sendText/chip-1",
        webhookToken: "secret-token",
        source: "campaign_evolution_instance",
        selectedEvolutionInstanceId: chipId,
      }),
      getLeadClientEvolutionInstances: async () => [
        {
          id: chipId,
          client_id: "tenant-e2e",
          name: "GD Gabriel",
          dispatch_webhook_url: "https://evolution.teste/message/sendText/chip-1",
          dispatch_webhook_token: "secret-token",
          active: true,
        },
      ],
    });
    await routes.runCampaignDispatch({
      dispatch: dispatchesTable[dispatchId],
      campaign: mockCampaign,
      supabase: mockSupabase,
    });

    return { finalizedSent, finalizedChips, quotaReserved, dispatchesTable, dispatchId };
  }


  it("1. Executa disparo com sucesso de ponta a ponta sem ReferenceError ou falha de contagem", async () => {
    const { finalizedSent, finalizedChips, dispatchesTable, dispatchId } = await runSuccessScenario("chip-1");

    expect(finalizedSent.length).toBe(2);
    expect(dispatchesTable[dispatchId].sent_count).toBe(2);
    expect(dispatchesTable[dispatchId].status).toBe("done");
    // id que não é uuid não é "o chip": o UPDATE grava NULL (nunca o nome, nunca um chute)
    expect(finalizedChips).toEqual([null, null]);
  });

  it("1b. O UPDATE de 'sent' grava o ID do chip dono do webhook com que a rota enviou", async () => {
    const CHIP = "11111111-2222-4333-8444-555555555555";

    const { finalizedChips } = await runSuccessScenario(CHIP);

    expect(finalizedChips).toEqual([CHIP, CHIP]);
  });

  it("2. Executa disparo com falha individual e atualiza failedCount e status sem travar o motor", async () => {
    const dispatchId = "disp-e2e-failed";
    const dispatchesTable = {
      [dispatchId]: {
        id: dispatchId,
        client_id: "tenant-e2e",
        name: "Lote com Falha",
        campaign_id: mockCampaign.id,
        status: "running",
        target_count: 2,
        sent_count: 0,
        failed_count: 0,
        dispatch_options: { leadDelaySeconds: 0 },
      },
    };

    const mockSupabase = createMockSupabase(dispatchesTable, dispatchId);

    let sendCallCount = 0;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("fetchInstances") || urlStr.includes("connectionState")) {
        return { ok: true, status: 200, json: async () => ({ state: "open" }), text: async () => '{"state":"open"}' };
      }
      if (urlStr.includes("whatsappNumbers")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { number: "5511999990001", exists: true },
            { number: "5511999990002", exists: true },
          ],
          text: async () => '[{"number":"5511999990001","exists":true},{"number":"5511999990002","exists":true}]',
        };
      }
      sendCallCount++;
      if (sendCallCount === 1) {
        return { ok: true, status: 200, json: async () => ({ key: { id: "msg-1" } }), text: async () => '{"key":{"id":"msg-1"}}' };
      }
      return { ok: false, status: 400, text: async () => "Número de WhatsApp inválido" };
    });

    const finalizedSent = [];
    const finalizedFailed = [];

    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        const sqlStr = String(sql);
        if (sqlStr.includes("SELECT id, name, dispatch_webhook_url")) {
          return {
            rows: [
              {
                id: "chip-1",
                client_id: "tenant-e2e",
                name: "GD Gabriel",
                dispatch_webhook_url: "https://evolution.teste/message/sendText/chip-1",
                dispatch_webhook_token: "secret-token",
                active: true,
              },
            ],
          };
        }
        if (sqlStr.includes("SELECT id, client_id, name, active, daily_limit")) {
          return {
            rows: [{ id: "chip-1", client_id: "tenant-e2e", name: "GD Gabriel", active: true, daily_limit: 500 }],
          };
        }
        if (sqlStr.includes("lead_import_items") && sqlStr.includes("LIMIT")) {
          return {
            rows: [
              { id: "lead-1", nome: "Ana", telefone: "5511999990001", client_id: "tenant-e2e" },
              { id: "lead-2", nome: "Bruno", telefone: "5511999990002", client_id: "tenant-e2e" },
            ],
          };
        }
        if (sqlStr.includes("INSERT INTO public.campaign_dispatch_runs")) {
          return { rowCount: 1, rows: [{ id: "claim-uuid" }] };
        }
        if (sqlStr.includes("UPDATE public.campaign_dispatch_runs SET status = 'sent'")) {
          finalizedSent.push(params[1]);
          return { rowCount: 1, rows: [] };
        }
        if (sqlStr.includes("UPDATE public.campaign_dispatch_runs SET status = 'failed'") || sqlStr.includes("UPDATE public.campaign_dispatch_runs SET status = $1")) {
          if (params[0] === "sent") {
            finalizedSent.push(params[1]);
          } else {
            finalizedFailed.push(params[3] || params[2]);
          }
          return { rowCount: 1, rows: [] };
        }
        if (sqlStr.includes("COUNT(*) FILTER")) {
          return {
            rows: [{ sent: 1, failed: 1, skipped: 0 }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const routes = createTestContext(mockPool);
    await routes.runCampaignDispatch({
      dispatch: dispatchesTable[dispatchId],
      campaign: mockCampaign,
      supabase: mockSupabase,
    });

    expect(finalizedSent.length).toBe(1);
    expect(finalizedFailed.length).toBe(1);
    expect(dispatchesTable[dispatchId].sent_count).toBe(1);
    expect(dispatchesTable[dispatchId].failed_count).toBe(1);
    expect(dispatchesTable[dispatchId].status).toBe("done");
  });

  it("3. Queda de chip durante envio interrompe lote na hora, faz rollback do claim e pausa o lote", async () => {
    const dispatchId = "disp-e2e-chip-crash";
    const dispatchesTable = {
      [dispatchId]: {
        id: dispatchId,
        client_id: "tenant-e2e",
        name: "Lote Queda Chip",
        campaign_id: mockCampaign.id,
        status: "running",
        target_count: 2,
        sent_count: 0,
        failed_count: 0,
        dispatch_options: { leadDelaySeconds: 0 },
      },
    };

    const mockSupabase = createMockSupabase(dispatchesTable, dispatchId);

    global.fetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("fetchInstances") || urlStr.includes("connectionState")) {
        return { ok: true, status: 200, json: async () => ({ state: "open" }), text: async () => '{"state":"open"}' };
      }
      return { ok: false, status: 500, text: async () => "Connection Closed at websocket level" };
    });

    const deletedClaims = [];

    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        const sqlStr = String(sql);
        if (sqlStr.includes("SELECT id, name, dispatch_webhook_url")) {
          return {
            rows: [
              {
                id: "chip-1",
                client_id: "tenant-e2e",
                name: "GD Gabriel",
                dispatch_webhook_url: "https://evolution.teste/message/sendText/chip-1",
                dispatch_webhook_token: "secret-token",
                active: true,
              },
            ],
          };
        }
        if (sqlStr.includes("SELECT id, client_id, name, active, daily_limit")) {
          return {
            rows: [{ id: "chip-1", client_id: "tenant-e2e", name: "GD Gabriel", active: true, daily_limit: 500 }],
          };
        }
        if (sqlStr.includes("lead_import_items") && sqlStr.includes("LIMIT")) {
          return {
            rows: [
              { id: "lead-1", nome: "Ana", telefone: "5511999990001", client_id: "tenant-e2e" },
              { id: "lead-2", nome: "Bruno", telefone: "5511999990002", client_id: "tenant-e2e" },
            ],
          };
        }
        if (sqlStr.includes("INSERT INTO public.campaign_dispatch_runs")) {
          return { rowCount: 1, rows: [{ id: "claim-uuid" }] };
        }
        if (sqlStr.includes("DELETE FROM public.campaign_dispatch_runs") && sqlStr.includes("status = 'claimed'")) {
          deletedClaims.push(params[1]);
          return { rowCount: 1, rows: [] };
        }
        if (sqlStr.includes("COUNT(*) FILTER")) {
          return {
            rows: [{ sent: 0, failed: 0, skipped: 0 }],
          };
        }
        return { rows: [], rowCount: 0 };
      }),
    };

    const routes = createTestContext(mockPool);
    await routes.runCampaignDispatch({
      dispatch: dispatchesTable[dispatchId],
      campaign: mockCampaign,
      supabase: mockSupabase,
    });

    expect(deletedClaims).toContain("lead-1");
    expect(dispatchesTable[dispatchId].status).toBe("paused");
    expect(dispatchesTable[dispatchId].error_message).toContain("Pausado — chip desconectado");
    expect(dispatchesTable[dispatchId].sent_count).toBe(0);
    expect(dispatchesTable[dispatchId].failed_count).toBe(0);
  });
});
