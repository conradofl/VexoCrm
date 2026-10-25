import { describe, expect, it, vi } from "vitest";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";

describe("Cenário Sonhare: Campanha com passo após resposta e Agente IA desligado (chatbot_enabled = false)", () => {
  function setupTestEnvironment({ chatbotEnabled = false, hasWaitCampaign = true, hasPendingRun = false } = {}) {
    const recordedMessages = [];
    const updatedLeads = [];
    let continueCampaignCalledWith = null;

    const createQueryChain = () => {
      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        in: vi.fn(() => chain),
        gte: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => ({
          data: {
            id: "lead-sonhare-1",
            normalized_data: { campaign_progress: {} },
          },
          error: null,
        })),
        single: vi.fn(async () => ({
          data: {
            id: "lead-sonhare-1",
            normalized_data: { campaign_progress: {} },
          },
          error: null,
        })),
      };
      return chain;
    };

    const mockSupabase = {
      from: vi.fn((tableName) => {
        const queryChain = createQueryChain();
        return {
          ...queryChain,
          insert: vi.fn(async (payload) => {
            if (tableName === "lead_messages") {
              recordedMessages.push(payload);
            }
            return { data: payload, error: null };
          }),
          update: vi.fn((updateData) => ({
            eq: vi.fn(() => ({
              in: vi.fn(async (col, values) => {
                updatedLeads.push({ table: tableName, updateData, col, values });
                return { data: {}, error: null };
              }),
            })),
          })),
        };
      }),
    };

    const mockFindCampaignReplyMatches = vi.fn(async () => {
      if (!hasWaitCampaign) {
        return {
          matches: [],
          waitForReplyMatches: [],
          processingWaitForReplyMatches: [],
          activePeriodCampaign: null,
        };
      }

      return {
        matches: [{ id: "camp-sonhare-1", name: "Ativação Sonhare" }],
        waitForReplyMatches: [{ id: "camp-sonhare-1", name: "Ativação Sonhare" }],
        processingWaitForReplyMatches: [
          {
            id: "camp-sonhare-1",
            name: "Ativação Sonhare",
            analyticsMeta: {
              sequence: [
                { id: "s1", type: "text", order: 1, text: "Olá! Tudo bem?", triggerMode: "immediate", enabled: true },
                { id: "s2", type: "text", order: 2, text: "Temos pacotes especiais!", triggerMode: "after_reply", enabled: true },
              ],
              dispatchOptions: { waitForReply: true },
            },
            leadImportItem: {
              id: "item-101",
              progress: {
                waitForReply: true,
                status: "aguardando_usuario",
                nextStepIndex: 1,
              },
            },
          },
        ],
        activePeriodCampaign: {
          id: "camp-sonhare-1",
          name: "Ativação Sonhare",
          mode: "disparo",
        },
      };
    });

    const mockContinueCampaignLeadFromReply = vi.fn(async (params) => {
      continueCampaignCalledWith = params;
      return {
        continued: true,
        finalized: false,
        campaignFinalized: false,
        reason: "step_sent",
      };
    });

    const mockGetLeadClientN8nSettings = vi.fn(async (clientId) => {
      return {
        clientId,
        chatbot_enabled: chatbotEnabled,
        inbound_scope: "leads_only",
      };
    });

    const routes = {};
    const mockApp = {
      post: vi.fn((path, ...handlers) => {
        routes[`POST ${path}`] = handlers[handlers.length - 1];
      }),
      get: vi.fn((path, ...handlers) => {
        routes[`GET ${path}`] = handlers[handlers.length - 1];
      }),
      delete: vi.fn((path, ...handlers) => {
        routes[`DELETE ${path}`] = handlers[handlers.length - 1];
      }),
      put: vi.fn((path, ...handlers) => {
        routes[`PUT ${path}`] = handlers[handlers.length - 1];
      }),
    };

    const mockPool = {
      query: vi.fn(async (sql, params) => {
        const sqlStr = String(sql || "");
        if (sqlStr.includes("campaign_dispatch_runs") && hasPendingRun) {
          return {
            rows: [
              {
                run_id: "run-bypass-1",
                dispatch_id: "disp-bypass-1",
                campaign_id: "camp-bypass-1",
                phone: "5534996895453",
                lead_id: "lead-bypass-1",
                lead_import_item_id: "item-bypass-1",
                status: "sent",
                camp_id: "camp-bypass-1",
                camp_name: "Campanha com Bypass",
                client_id: "sonhare",
                camp_mode: "disparo",
                analytics_meta: {
                  sequence: [
                    { id: "s1", type: "text", order: 1, text: "Oi!", triggerMode: "immediate", enabled: true },
                    { id: "s2", type: "text", order: 2, text: "Segunda mensagem!", triggerMode: "after_reply", enabled: true },
                  ],
                  dispatchOptions: { waitForReply: true },
                },
              },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const deps = {
      ensureDb: () => true,
      getLeadClientEvolutionInstances: async () => [],
      getLeadClientN8nSettings: mockGetLeadClientN8nSettings,
      internalErrorPayloadDetails: () => ({}),
      isMissingSchemaError: () => false,
      leadsTableName: (c) => `leads_${c}`,
      maskPhoneForLog: (p) => p,
      MAX_LEADS_OUTLIER_BATCH: 100,
      continueCampaignLeadFromReply: mockContinueCampaignLeadFromReply,
      findCampaignReplyMatches: mockFindCampaignReplyMatches,
      normalizeString: (s) => (s ? String(s).trim() : ""),
      normalizeTenantKey: (k) => k,
      pgDatabasePool: mockPool,
      requireAppViewAccess: () => (_req, _res, next) => next(),
      requireFirebaseAuth: (_req, _res, next) => next(),
      resolveAuthorizedClientId: (_req, _res, cid) => cid || "sonhare",
      resolveDispatchWebhookSettings: async () => ({}),
      resolveInboundDispatchSettings: async () => ({}),
      sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
      sendError: vi.fn(),
      supabase: mockSupabase,
      validateLeadsOutlierRecord: () => true,
      validateN8nInboundBearer: () => true,
    };

    registerChatbotRoutes(mockApp, deps);

    const webhookHandler = routes["POST /api/hardcoded-chat-webhook"];

    return {
      webhookHandler,
      recordedMessages,
      updatedLeads,
      getContinueCampaignCalledWith: () => continueCampaignCalledWith,
      mockContinueCampaignLeadFromReply,
    };
  }

  it("com chatbot_enabled = false e campanha com passo após resposta: grava mensagem inbound e avança passo 2 sem acionar IA", async () => {
    const { webhookHandler, recordedMessages, mockContinueCampaignLeadFromReply } = setupTestEnvironment({
      chatbotEnabled: false,
      hasWaitCampaign: true,
    });

    const req = {
      body: {
        event: "messages.upsert",
        clientId: "sonhare",
        phone: "5534996895453",
        data: {
          key: {
            remoteJid: "5534996895453@s.whatsapp.net",
            fromMe: false,
            id: "WA_MSG_ID_TEST_123",
          },
          message: {
            conversation: "Oi, tenho interesse sim! Como funciona?",
          },
          messageTimestamp: 1788212600,
        },
      },
      query: {},
    };

    let responseData = null;
    const res = {
      json: vi.fn((data) => {
        responseData = data;
      }),
    };

    await webhookHandler(req, res);
    await new Promise((r) => setTimeout(r, 20));

    // 1. Respondeu HTTP 200 com avanço de campanha
    expect(res.json).toHaveBeenCalled();
    expect(responseData).toMatchObject({
      success: true,
      status: "campaign_step_dispatched",
    });

    // 2. ✅ A mensagem do lead foi gravada em lead_messages (inbound)
    expect(recordedMessages.length).toBeGreaterThanOrEqual(1);
    const inboundMsg = recordedMessages.find((m) => m.direction === "inbound");
    expect(inboundMsg).toBeDefined();
    expect(inboundMsg.phone).toBe("5534996895453");
    expect(inboundMsg.message_text).toBe("Oi, tenho interesse sim! Como funciona?");
    expect(inboundMsg.wa_message_id).toBe("WA_MSG_ID_TEST_123");
    expect(inboundMsg.sender_type).toBe("lead");

    // 3. ✅ O passo 2 da campanha foi acionado via continueCampaignLeadFromReply
    expect(mockContinueCampaignLeadFromReply).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "sonhare",
        phone: "5534996895453",
        campaignMatch: expect.objectContaining({ id: "camp-sonhare-1" }),
      })
    );
  });

  it("com chatbot_enabled = false e SEM campanha ativa: grava mensagem inbound para atendimento humano e encerra sem IA", async () => {
    const { webhookHandler, recordedMessages, mockContinueCampaignLeadFromReply } = setupTestEnvironment({
      chatbotEnabled: false,
      hasWaitCampaign: false,
    });

    const req = {
      body: {
        event: "messages.upsert",
        clientId: "sonhare",
        phone: "5534996895453",
        data: {
          key: {
            remoteJid: "5534996895453@s.whatsapp.net",
            fromMe: false,
            id: "WA_MSG_ID_HUMAN_ONLY_456",
          },
          message: {
            conversation: "Gostaria de falar com um atendente humano por favor.",
          },
          messageTimestamp: 1788212700,
        },
      },
      query: {},
    };

    let responseData = null;
    const res = {
      json: vi.fn((data) => {
        responseData = data;
      }),
    };

    await webhookHandler(req, res);

    // 1. Respondeu HTTP 200 indicando que o robô de IA está desativado
    expect(responseData).toMatchObject({
      success: true,
      ignored: "chatbot_disabled",
    });

    // 2. ✅ A mensagem do lead FOI GRAVADA para visualização no Inbox / Conversas
    const inboundMsg = recordedMessages.find((m) => m.wa_message_id === "WA_MSG_ID_HUMAN_ONLY_456");
    expect(inboundMsg).toBeDefined();
    expect(inboundMsg.message_text).toBe("Gostaria de falar com um atendente humano por favor.");
    expect(inboundMsg.direction).toBe("inbound");

    // 3. ❌ Nenhuma campanha foi acionada
    expect(mockContinueCampaignLeadFromReply).not.toHaveBeenCalled();
  });

  it("com chatbot_enabled = false e match primário ausente (hasWaitCampaign = false), mas com run em campaign_dispatch_runs: faz bypass de chatbot_disabled e avança passo 2", async () => {
    const { webhookHandler, recordedMessages, mockContinueCampaignLeadFromReply } = setupTestEnvironment({
      chatbotEnabled: false,
      hasWaitCampaign: false,
      hasPendingRun: true,
    });

    const req = {
      body: {
        event: "messages.upsert",
        clientId: "sonhare",
        phone: "5534996895453",
        data: {
          key: {
            remoteJid: "5534996895453@s.whatsapp.net",
            fromMe: false,
            id: "WA_MSG_ID_BYPASS_RUN_789",
          },
          message: {
            conversation: "Quero saber o valor!",
          },
          messageTimestamp: 1788212800,
        },
      },
      query: {},
    };

    let responseData = null;
    const res = {
      json: vi.fn((data) => {
        responseData = data;
      }),
    };

    await webhookHandler(req, res);
    await new Promise((r) => setTimeout(r, 20));

    // 1. Respondeu HTTP 200 com avanço de campanha (bypass de chatbot_disabled)
    expect(res.json).toHaveBeenCalled();
    expect(responseData).toMatchObject({
      ok: true,
      status: "campaign_step_dispatched",
      matched_campaign: expect.objectContaining({
        id: "camp-bypass-1",
        reason: "campaign_run_waiting_reply_bypass",
      }),
    });

    // 2. ✅ A mensagem do lead foi gravada em lead_messages
    expect(recordedMessages.length).toBeGreaterThanOrEqual(1);
    const inboundMsg = recordedMessages.find((m) => m.wa_message_id === "WA_MSG_ID_BYPASS_RUN_789");
    expect(inboundMsg).toBeDefined();
    expect(inboundMsg.phone).toBe("5534996895453");
    expect(inboundMsg.message_text).toBe("Quero saber o valor!");

    // 3. ✅ O passo 2 da campanha foi acionado via continueCampaignLeadFromReply
    expect(mockContinueCampaignLeadFromReply).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "sonhare",
        phone: "5534996895453",
        campaignMatch: expect.objectContaining({ id: "camp-bypass-1" }),
      })
    );
  });
});
