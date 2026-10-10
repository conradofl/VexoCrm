import { describe, expect, it, vi } from "vitest";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";

describe("Precedência Inbound: Regras de Ativação do Robô por Chip vs Tenant", () => {
  function setupTestEnvironment({
    chatbotEnabled = false,
    chatbotInstances = [],
    inboundAgent = null,
    hasActiveCampaign = false,
    evolutionInstances = [
      { id: "chip-1", name: "Vexo Atende", active: true },
      { id: "chip-2", name: "Vexo Disparo", active: true },
      { id: "chip-3", name: "Outro Chip", active: true },
    ],
  } = {}) {
    const recordedMessages = [];

    const createQueryChain = (tableName) => {
      const getResult = () => {
        if (tableName === "followup_companies") {
          return { data: inboundAgent ? [inboundAgent] : [], error: null };
        }
        return {
          data: {
            id: "lead-test-1",
            normalized_data: { campaign_progress: {} },
          },
          error: null,
        };
      };

      const chain = {
        select: vi.fn(() => chain),
        eq: vi.fn(() => chain),
        in: vi.fn(() => chain),
        gte: vi.fn(() => chain),
        is: vi.fn(() => chain),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        maybeSingle: vi.fn(async () => {
          if (tableName === "followup_companies") {
            return { data: inboundAgent, error: null };
          }
          return {
            data: {
              id: "lead-test-1",
              normalized_data: { campaign_progress: {} },
            },
            error: null,
          };
        }),
        single: vi.fn(async () => {
          if (tableName === "followup_companies") {
            return { data: inboundAgent, error: null };
          }
          return {
            data: {
              id: "lead-test-1",
              normalized_data: { campaign_progress: {} },
            },
            error: null,
          };
        }),
        then: (resolve) => resolve(getResult()),
      };
      return chain;
    };

    const mockSupabase = {
      from: vi.fn((tableName) => {
        const queryChain = createQueryChain(tableName);
        return {
          ...queryChain,
          insert: vi.fn(async (payload) => {
            if (tableName === "lead_messages") {
              recordedMessages.push(payload);
            }
            return { data: payload, error: null };
          }),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(async () => ({ data: {}, error: null })),
              is: vi.fn(async () => ({ data: {}, error: null })),
            })),
          })),
        };
      }),
    };

    const mockFindCampaignReplyMatches = vi.fn(async () => {
      if (!hasActiveCampaign) {
        return {
          matches: [],
          waitForReplyMatches: [],
          processingWaitForReplyMatches: [],
          activePeriodCampaign: null,
        };
      }
      return {
        matches: [{ id: "camp-1", name: "Campanha Ativa" }],
        waitForReplyMatches: [],
        processingWaitForReplyMatches: [],
        activePeriodCampaign: { id: "camp-1", name: "Campanha Ativa", mode: "disparo" },
      };
    });

    const mockGetLeadClientN8nSettings = vi.fn(async (clientId) => {
      return {
        clientId,
        chatbot_enabled: chatbotEnabled,
        chatbot_inbound_scope: "all",
        chatbot_instances: chatbotInstances,
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

    const deps = {
      ensureDb: () => true,
      getLeadClientEvolutionInstances: async () => evolutionInstances,
      getLeadClientN8nSettings: mockGetLeadClientN8nSettings,
      internalErrorPayloadDetails: () => ({}),
      isMissingSchemaError: () => false,
      leadsTableName: (c) => `leads_${c}`,
      maskPhoneForLog: (p) => p,
      MAX_LEADS_OUTLIER_BATCH: 100,
      continueCampaignLeadFromReply: vi.fn(),
      findCampaignReplyMatches: mockFindCampaignReplyMatches,
      normalizeString: (s) => (s ? String(s).trim() : ""),
      normalizeTenantKey: (k) => k,
      pgDatabasePool: { query: async () => ({ rows: [] }) },
      requireAppViewAccess: () => (_req, _res, next) => next(),
      requireFirebaseAuth: (_req, _res, next) => next(),
      resolveAuthorizedClientId: (_req, _res, cid) => cid || "vexo-adm",
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
      mockSupabase,
    };
  }

  it("[REGRA 1] chip com agente ligado responde mesmo com chatbot_enabled = false no tenant", async () => {
    const { webhookHandler } = setupTestEnvironment({
      chatbotEnabled: false, // tenant com robô global desligado
      inboundAgent: {
        id: "agent-jhon",
        name: "Jhon",
        evolution_instance: "Vexo Atende",
        evolution_instances: ["Vexo Atende"],
        inbound_enabled: true, // agente próprio LIGADO
        agent_kind: "atendimento",
        inbound_role: "atendimento",
      },
    });

    const req = {
      body: {
        event: "messages.upsert",
        clientId: "vexo-adm",
        phone: "5511999998888",
        instance: "Vexo Atende",
        data: {
          key: {
            remoteJid: "5511999998888@s.whatsapp.net",
            fromMe: false,
            id: "WA_MSG_PREFERENCE_1",
          },
          message: {
            conversation: "Olá, gostaria de conhecer a plataforma.",
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

    // NÃO pode ser descartado por chatbot_disabled nem inbound_disabled
    expect(responseData?.ignored).not.toBe("chatbot_disabled");
    expect(responseData?.ignored).not.toBe("inbound_disabled");
    // Mensagem é aceita e colocada em buffering para o motor IA
    expect(responseData).toMatchObject({
      success: true,
      status: "buffering",
    });
  });

  it("[REGRA 2] chip sem agente continua obedecendo o tenant (descarta se chatbot_enabled = false)", async () => {
    const { webhookHandler } = setupTestEnvironment({
      chatbotEnabled: false, // tenant com robô global desligado
      inboundAgent: null, // SEM agente próprio para o chip
    });

    const req = {
      body: {
        event: "messages.upsert",
        clientId: "vexo-adm",
        phone: "5511999998888",
        instance: "Chip Sem Agente",
        data: {
          key: {
            remoteJid: "5511999998888@s.whatsapp.net",
            fromMe: false,
            id: "WA_MSG_NO_AGENT",
          },
          message: {
            conversation: "Oi, alguém aí?",
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

    // Descarta pois o chip não tem agente e o chatbot global está desligado
    expect(responseData).toMatchObject({
      success: true,
      ignored: "chatbot_disabled",
    });
  });

  it("[REGRA 3] chip com agente desligado é descartado com inbound_disabled mesmo se chatbot_enabled = true", async () => {
    const { webhookHandler } = setupTestEnvironment({
      chatbotEnabled: true, // tenant com robô global ligado
      inboundAgent: {
        id: "agent-jhon",
        name: "Jhon",
        evolution_instance: "Vexo Atende",
        evolution_instances: ["Vexo Atende"],
        inbound_enabled: false, // agente próprio DESLIGADO
        agent_kind: "atendimento",
        inbound_role: "atendimento",
      },
    });

    const req = {
      body: {
        event: "messages.upsert",
        clientId: "vexo-adm",
        phone: "5511999998888",
        instance: "Vexo Atende",
        data: {
          key: {
            remoteJid: "5511999998888@s.whatsapp.net",
            fromMe: false,
            id: "WA_MSG_AGENT_OFF",
          },
          message: {
            conversation: "Olá!",
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

    expect(responseData).toMatchObject({
      success: true,
      ignored: "inbound_disabled",
    });
  });

  it("[REGRA 4] chip com função campanha sem campanha ativa não faz atendimento espontâneo", async () => {
    const { webhookHandler } = setupTestEnvironment({
      chatbotEnabled: true,
      hasActiveCampaign: false, // sem campanha ativa casada
      inboundAgent: {
        id: "agent-disparo",
        name: "Disparo Vexo",
        evolution_instance: "Vexo Disparo",
        evolution_instances: ["Vexo Disparo"],
        inbound_enabled: true,
        agent_kind: "campanha", // chip de disparo
        inbound_role: "qualificador",
      },
    });

    const req = {
      body: {
        event: "messages.upsert",
        clientId: "vexo-adm",
        phone: "5511999998888",
        instance: "Vexo Disparo",
        data: {
          key: {
            remoteJid: "5511999998888@s.whatsapp.net",
            fromMe: false,
            id: "WA_MSG_CAMP_KIND",
          },
          message: {
            conversation: "Oi, vi o anúncio e chamei você",
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

    expect(responseData).toMatchObject({
      success: true,
      ignored: "chip_campanha_sem_atendimento",
    });
  });

  it("[REGRA 5] chip sem agente próprio e não listado em chatbot_instances do tenant é descartado com chip_nao_vinculado", async () => {
    const { webhookHandler } = setupTestEnvironment({
      chatbotEnabled: true, // chatbot global ligado
      chatbotInstances: ["chip-1"], // apenas chip-1 está autorizado no chatbot global
      inboundAgent: null, // sem agente próprio
    });

    const req = {
      body: {
        event: "messages.upsert",
        clientId: "vexo-adm",
        phone: "5511999998888",
        instance: "Outro Chip", // chip-3 / Outro Chip não está em chatbot_instances
        data: {
          key: {
            remoteJid: "5511999998888@s.whatsapp.net",
            fromMe: false,
            id: "WA_MSG_UNLINKED",
          },
          message: {
            conversation: "Oi",
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

    expect(responseData).toMatchObject({
      success: true,
      ignored: "chip_nao_vinculado",
    });
  });
});
