import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mocks = vi.hoisted(() => ({
  supabase: null,
  pool: null,
}));

vi.mock("../services/database.js", () => {
  return {
    get supabase() {
      return mocks.supabase;
    },
    get pgDatabasePool() {
      return mocks.pool;
    },
    initDatabase: vi.fn(),
  };
});

import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";
import {
  continueCampaignLeadFromReply,
  executeCampaignChipHandoff,
  markCampaignLeadWaitingReply,
} from "../campaign/dispatch.js";

describe("Permanent Guard — Teste de Fumaça CI (Ciclo de Vida Completo de Campanha)", () => {
  let originalFetch;
  let fetchCalls = [];

  beforeEach(() => {
    originalFetch = global.fetch;
    fetchCalls = [];
    global.fetch = vi.fn(async (url, opts = {}) => {
      const urlStr = String(url || "");
      const body = opts.body ? JSON.parse(opts.body) : {};
      fetchCalls.push({ url: urlStr, method: opts.method || "GET", body, headers: opts.headers });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ key: { id: `EVO-MSG-${fetchCalls.length}` }, state: "open", instance: { state: "open" } }),
        json: async () => ({ key: { id: `EVO-MSG-${fetchCalls.length}` }, state: "open", instance: { state: "open" } }),
      };
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const tenantId = "tenant-smoke-test";
  const leadPhone = "5511999991234";
  const leadNome = "Mariana Lead";

  const chipA = {
    id: "chip-a-batedor",
    client_id: tenantId,
    name: "Chip A - Prospecção",
    dispatch_webhook_url: "https://evolution.test/message/sendText/chip-a-batedor",
    dispatch_webhook_token: "token-chip-a",
    active: true,
  };

  const chipB = {
    id: "chip-b-fechador",
    client_id: tenantId,
    name: "Chip B - Closer Oficial",
    dispatch_webhook_url: "https://evolution.test/message/sendText/chip-b-fechador",
    dispatch_webhook_token: "token-chip-b",
    active: true,
  };

  it("Executa fluxo completo: Criar campanha -> Lote -> Passo 1 -> Inbound com IA desligada -> Passo 2 -> Handoff entre chips", async () => {
    // ── 1. DEFINIÇÃO DA CAMPANHA (com waitForReply e Handoff Ativo) ──
    const campaignId = "camp-smoke-1";
    const dispatchId = "disp-smoke-1";
    const leadImportItemId = "item-smoke-1";

    const campaign = {
      id: campaignId,
      client_id: tenantId,
      name: "Campanha Smoke Test",
      mode: "campanha",
      status: "active",
      analytics_meta: {
        sequence: [
          {
            id: "step-1",
            type: "text",
            order: 1,
            text: "Olá {{nome}}, tudo bem?",
            triggerMode: "immediate",
            enabled: true,
            delayAfterSeconds: 0,
          },
          {
            id: "step-2",
            type: "text",
            order: 2,
            text: "Tenho uma condição exclusiva para você dia 20!",
            triggerMode: "after_reply",
            enabled: true,
            delayAfterSeconds: 0,
          },
        ],
        dispatchOptions: {
          leadDelaySeconds: 0,
          waitForReply: true,
          evolutionInstanceId: chipA.id,
          handoffEnabled: true,
          handoffChipId: chipB.id,
          handoffChipIds: [chipB.id],
          handoffBridgingText: "Perfeito, {{nome}}! Nosso consultor vai te chamar agora pelo WhatsApp oficial.",
          handoffOpenerText: "Olá {{nome}}, aqui é o consultor oficial! Como posso te ajudar?",
        },
      },
    };

    // Estado em memória simulando Postgres e Supabase
    const recordedMessages = [];
    let leadProgress = {};
    const dispatchRuns = [];

    const dispatchesTable = {
      [dispatchId]: {
        id: dispatchId,
        campaign_id: campaignId,
        client_id: tenantId,
        status: "running",
        limit_per_run: 10,
        offset: 0,
        sent_count: 0,
        failed_count: 0,
        target_count: 1,
        evolution_instance_id: chipA.id,
        dispatch_options: {
          ...campaign.analytics_meta.dispatchOptions,
        },
        steps: campaign.analytics_meta.sequence,
      },
    };

    const mockPool = {
      query: vi.fn(async (sql, params) => {
        const sqlStr = String(sql || "");

        if (sqlStr.includes("lead_import_items") && sqlStr.includes("WHERE")) {
          return {
            rows: [
              {
                id: leadImportItemId,
                nome: leadNome,
                telefone: leadPhone,
                client_id: tenantId,
                normalized_data: { nome: leadNome, campaign_progress: { [campaignId]: leadProgress } },
              },
            ],
          };
        }

        if (sqlStr.includes("INSERT INTO public.campaign_dispatch_runs")) {
          const run = {
            id: "run-smoke-1",
            dispatch_id: dispatchId,
            campaign_id: campaignId,
            client_id: tenantId,
            lead_id: leadImportItemId,
            lead_import_item_id: leadImportItemId,
            phone: leadPhone,
            status: "claimed",
            evolution_instance_id: chipA.id,
          };
          dispatchRuns.push(run);
          return { rowCount: 1, rows: [run] };
        }

        if (sqlStr.includes("UPDATE public.campaign_dispatch_runs") && sqlStr.includes("status = 'sent'")) {
          const run = dispatchRuns.find((r) => r.phone === leadPhone);
          if (run) run.status = "sent";
          return { rowCount: 1, rows: [] };
        }

        if (sqlStr.includes("COUNT(*) FILTER")) {
          return { rows: [{ sent: 1, failed: 0, skipped: 0 }] };
        }

        if (sqlStr.includes("SELECT r.id AS run_id") || sqlStr.includes("AS run_id")) {
          return {
            rows: [
              {
                run_id: "run-smoke-1",
                dispatch_id: dispatchId,
                campaign_id: campaignId,
                phone: leadPhone,
                lead_id: leadImportItemId,
                lead_import_item_id: leadImportItemId,
                status: "sent",
                camp_id: campaignId,
                camp_name: campaign.name,
                client_id: tenantId,
                analytics_meta: campaign.analytics_meta,
                camp_status: "active",
                camp_mode: "campanha",
              },
            ],
          };
        }

        if (sqlStr.includes("lead_client_evolution_instances")) {
          return { rows: [chipA, chipB] };
        }

        return { rows: [], rowCount: 0 };
      }),
    };

    const mockSupabase = {
      from: vi.fn((table) => {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          in: vi.fn(() => chain),
          is: vi.fn(() => chain),
          not: vi.fn(() => chain),
          gte: vi.fn(() => chain),
          lte: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          maybeSingle: vi.fn(async () => {
            if (table === "campaigns") return { data: campaign, error: null };
            if (table === "campaign_dispatches") return { data: dispatchesTable[dispatchId], error: null };
            if (table === "lead_import_items") return { data: { id: leadImportItemId, normalized_data: { campaign_progress: { [campaignId]: leadProgress } } }, error: null };
            return { data: null, error: null };
          }),
          single: vi.fn(async () => {
            if (table === "campaigns") return { data: campaign, error: null };
            if (table === "campaign_dispatches") return { data: dispatchesTable[dispatchId], error: null };
            if (table === "lead_import_items") return { data: { id: leadImportItemId, normalized_data: { campaign_progress: { [campaignId]: leadProgress } } }, error: null };
            return { data: null, error: null };
          }),
          insert: vi.fn(async (records) => {
            const arr = Array.isArray(records) ? records : [records];
            recordedMessages.push(...arr);
            return { data: records, error: null };
          }),
          update: vi.fn((patch) => {
            if (table === "campaign_dispatches" && dispatchesTable[dispatchId]) {
              Object.assign(dispatchesTable[dispatchId], patch);
            }
            if (table === "lead_import_items" && patch.normalized_data?.campaign_progress?.[campaignId]) {
              leadProgress = { ...patch.normalized_data.campaign_progress[campaignId] };
            }
            return chain;
          }),
          then: (resolve, reject) => Promise.resolve({ data: {}, error: null }).then(resolve, reject),
          catch: (reject) => Promise.resolve({ data: {}, error: null }).catch(reject),
          finally: (cb) => Promise.resolve({ data: {}, error: null }).finally(cb),
        };
        return chain;
      }),
    };

    mocks.supabase = mockSupabase;
    mocks.pool = mockPool;

    // ── 2. EXECUÇÃO DO PASSO 1 (Disparo do Lote via runCampaignDispatch) ──
    const dummyApp = { get: () => {}, post: () => {}, put: () => {}, patch: () => {}, delete: () => {}, use: () => {} };
    const campaignDeps = {
      CAMPAIGN_SCHEDULER_MAX_BATCH: 10,
      buildDispatchLeads: async () => [
        { id: leadImportItemId, nome: leadNome, telefone: leadPhone, client_id: tenantId },
      ],
      canCampaignBeDispatched: () => true,
      checkEvolutionInstanceHealth: async () => ({ state: "open" }),
      continueCampaignLeadFromReply: async () => {},
      ensureDb: () => true,
      executeCampaignDispatch: async () => {},
      findCampaignReplyMatches: async () => [],
      getClientName: async () => "Tenant Smoke",
      getLeadClientEvolutionInstances: async () => [chipA, chipB],
      getLeadClientN8nSettings: async () => ({
        send_window_enabled: false,
      }),
      getRequestId: () => "req-smoke-1",
      getSafeDispatchSettingsLog: () => ({}),
      internalErrorPayloadDetails: () => ({}),
      isMissingSchemaError: () => false,
      isProduction: false,
      logCampaignReplyFlow: () => {},
      logDirectDispatch: () => {},
      maskPhoneForLog: (p) => p,
      normalizeIsoDate: (d) => d,
      leadsTableName: (c) => "lead_import_items",
      normalizeString: (s) => String(s || "").trim(),
      normalizeTenantKey: (s) => String(s || "").trim(),
      parseOptionalUuid: (s) => s,
      pgDatabasePool: mockPool,
      requireAppViewAccess: () => (_req, _res, next) => next(),
      requireCampaignDispatchAccess: () => (_req, _res, next) => next(),
      requireFirebaseAuth: (_req, _res, next) => next(),
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      resolveAuthorizedClientId: () => tenantId,
      resolveCampaignDispatchSettings: async () => ({
        webhookUrl: chipA.dispatch_webhook_url,
        webhookToken: chipA.dispatch_webhook_token,
        instanceName: chipA.name,
        selectedEvolutionInstanceName: chipA.name,
      }),
      resolveDispatchWebhookSettings: async () => ({}),
      runDueCampaignDispatches: async () => {},
      sanitizePhone: (p) => p,
      sendError: () => {},
      supabase: mockSupabase,
      validateN8nInboundBearer: () => true,
    };

    const campaignRoutes = registerCampaignsRoutes(dummyApp, campaignDeps);

    await campaignRoutes.runCampaignDispatch({
      dispatch: dispatchesTable[dispatchId],
      campaign,
      supabase: mockSupabase,
      ignoreSendWindow: true,
    });

    // Simula marcação do lead aguardando resposta
    leadProgress = {
      campaignId,
      dispatchId,
      waitForReply: true,
      status: "aguardando_usuario",
      nextStepIndex: 1,
      totalSteps: 2,
    };

    const messageCalls = () => fetchCalls.filter((c) => c.url.includes("/message/send"));

    // Valida que o Passo 1 foi enviado pelo Chip A
    expect(messageCalls().length).toBe(1);
    expect(messageCalls()[0].url).toContain(chipA.id);
    expect(messageCalls()[0].body.text).toContain("Olá Mariana Lead, tudo bem?");
    expect(dispatchesTable[dispatchId].sent_count).toBe(1);

    // ── 3. SIMULAÇÃO DE INBOUND (Lead responde enquanto chatbot_enabled = false) ──
    const chatbotRoutes = {};
    const mockChatbotApp = {
      post: vi.fn((path, ...handlers) => {
        chatbotRoutes[`POST ${path}`] = handlers[handlers.length - 1];
      }),
      get: vi.fn((path, ...handlers) => {
        chatbotRoutes[`GET ${path}`] = handlers[handlers.length - 1];
      }),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      use: vi.fn(),
    };

    let continueReplyCalledWith = null;
    const chatbotDeps = {
      ensureDb: () => true,
      getLeadClientEvolutionInstances: async () => [chipA, chipB],
      getLeadClientN8nSettings: async () => ({
        clientId: tenantId,
        chatbot_enabled: false, // ⚠️ CHATBOT / AGENTE IA DESLIGADO!
        inbound_scope: "leads_only",
      }),
      internalErrorPayloadDetails: () => ({}),
      isMissingSchemaError: () => false,
      leadsTableName: (c) => `leads_${c}`,
      maskPhoneForLog: (p) => p,
      MAX_LEADS_OUTLIER_BATCH: 100,
      continueCampaignLeadFromReply: async (params) => {
        continueReplyCalledWith = params;
        return { continued: true, reason: "step_sent" };
      },
      findCampaignReplyMatches: async () => ({
        matches: [{ id: campaignId, name: campaign.name, analyticsMeta: campaign.analytics_meta }],
        waitForReplyMatches: [{ id: campaignId, name: campaign.name, analyticsMeta: campaign.analytics_meta }],
        processingWaitForReplyMatches: [
          {
            id: campaignId,
            name: campaign.name,
            analyticsMeta: campaign.analytics_meta,
            leadImportItem: {
              id: leadImportItemId,
              progress: leadProgress,
            },
          },
        ],
        activePeriodCampaign: null,
      }),
      normalizeString: (s) => (s ? String(s).trim() : ""),
      normalizeTenantKey: (k) => k,
      pgDatabasePool: mockPool,
      requireAppViewAccess: () => (_req, _res, next) => next(),
      requireFirebaseAuth: (_req, _res, next) => next(),
      resolveAuthorizedClientId: () => tenantId,
      resolveDispatchWebhookSettings: async () => ({}),
      resolveInboundDispatchSettings: async () => ({}),
      sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
      sendError: vi.fn(),
      supabase: mockSupabase,
      validateLeadsOutlierRecord: () => true,
      validateN8nInboundBearer: () => true,
    };

    registerChatbotRoutes(mockChatbotApp, chatbotDeps);

    const webhookHandler = chatbotRoutes["POST /api/hardcoded-chat-webhook"];
    let webhookResponse = null;
    const res = {
      json: vi.fn((data) => {
        webhookResponse = data;
      }),
    };

    const inboundReq = {
      body: {
        event: "messages.upsert",
        clientId: tenantId,
        phone: leadPhone,
        data: {
          key: {
            remoteJid: `${leadPhone}@s.whatsapp.net`,
            fromMe: false,
            id: "WA-INBOUND-SMOKE-1",
          },
          message: {
            conversation: "Oi, tudo ótimo! Me conta mais.",
          },
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      },
      query: {},
    };

    await webhookHandler(inboundReq, res);
    await new Promise((r) => setTimeout(r, 25));

    // Valida que o webhook respondeu 200 e chamou avanço mesmo com IA desligada
    expect(res.json).toHaveBeenCalled();
    expect(webhookResponse).toMatchObject({
      status: "campaign_step_dispatched",
    });
    expect(continueReplyCalledWith).not.toBeNull();
    expect(continueReplyCalledWith.campaignMatch.id).toBe(campaignId);

    // ── 4. EXECUÇÃO DO PASSO 2 (via continueCampaignLeadFromReply) ──
    // Chamamos a função real para validar que ela despacha o passo 2 pelo Chip A
    const progression = await continueCampaignLeadFromReply({
      clientId: tenantId,
      phone: leadPhone,
      repliedAt: new Date().toISOString(),
      campaignMatch: {
        id: campaignId,
        leadImportItem: {
          id: leadImportItemId,
          nome: leadNome,
          progress: leadProgress,
        },
      },
      replyPayload: {
        instance: chipA.id,
        message: "Oi, tudo ótimo! Me conta mais.",
      },
    });

    expect(progression.continued).toBe(true);
    expect(progression.finalized).toBe(true);

    // Valida que o Handoff foi acionado automaticamente pelo ciclo de vida
    expect(progression.handoff).toMatchObject({
      executed: true,
      handoffCompleted: true,
      transferredFrom: chipA.name,
      transferredTo: chipB.name,
      targetChipId: chipB.id,
      bridgingSent: true,
      openerSent: true,
    });

    // Valida que a régua gerou exatamente 4 mensagens:
    // Mensagem 1: Passo 1 pelo Chip A
    // Mensagem 2: Passo 2 pelo Chip A
    // Mensagem 3: Bridging Text pelo Chip A
    // Mensagem 4: Opener Text pelo Chip B
    expect(messageCalls().length).toBe(4);

    const step2Call = messageCalls()[1];
    expect(step2Call.url).toContain(chipA.id);
    expect(step2Call.body.text).toContain("Tenho uma condição exclusiva para você dia 20!");

    const bridgeCall = messageCalls()[2];
    expect(bridgeCall.url).toContain(chipA.id);
    expect(bridgeCall.body.text).toContain("Perfeito, Mariana Lead! Nosso consultor vai te chamar agora");

    const openerCall = messageCalls()[3];
    expect(openerCall.url).toContain(chipB.id);
    expect(openerCall.body.text).toContain("Olá Mariana Lead, aqui é o consultor oficial!");

    // ── 5. VALIDAÇÃO INTEGRADA DE TODOS OS SUBSISTEMAS ──
    expect(messageCalls()).toHaveLength(4);
    expect(messageCalls().map((c) => c.url)).toEqual([
      expect.stringContaining("chip-a-batedor"), // Passo 1
      expect.stringContaining("chip-a-batedor"), // Passo 2
      expect.stringContaining("chip-a-batedor"), // Handoff Bridge (Chip A)
      expect.stringContaining("chip-b-fechador"), // Handoff Opener (Chip B)
    ]);
  });
});
