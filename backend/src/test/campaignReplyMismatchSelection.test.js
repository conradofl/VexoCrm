import { describe, expect, it, vi } from "vitest";
import {
  resolveActiveWaitCampaign,
  findConflictingPendingCampaignLeads,
  expireStaleCampaignProgress,
} from "../services/campaignReplySelection.js";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";

describe("SPEC 8: Resolução de Campanha na Resposta e Prevenção de Réguas Conflitantes", () => {
  const clientId = "bia-do-spazio";
  const phone = "5534991093607";

  const camp1Old = {
    id: "35fe6a75-12c6-4b68-9348-3b696d007552",
    name: "TESTE BASTÃO (24/10)",
    waitForReply: true,
    hasPendingProgress: true,
    analyticsMeta: {
      sequence: [
        { id: "s1", type: "text", order: 1, text: "Oi 24/10", triggerMode: "immediate", enabled: true },
        { id: "s2", type: "text", order: 2, text: "Passo 2 de 24/10", triggerMode: "after_reply", enabled: true },
      ],
      dispatchOptions: { waitForReply: true },
    },
    leadImportItem: {
      id: "item-1",
      progress: {
        waitForReply: true,
        status: "aguardando_usuario",
        updatedAt: "2026-10-24T15:29:00.000Z",
      },
    },
  };

  const camp2Recent = {
    id: "de658391-1721-4954-9061-b69a087f32ea",
    name: "TESTE 25/10 — não enviar para cliente",
    waitForReply: true,
    hasPendingProgress: true,
    analyticsMeta: {
      sequence: [
        { id: "s1", type: "text", order: 1, text: "Oi 25/10", triggerMode: "immediate", enabled: true },
        { id: "s2", type: "text", order: 2, text: "Passo 2 de 25/10", triggerMode: "after_reply", enabled: true },
      ],
      dispatchOptions: { waitForReply: true },
    },
    leadImportItem: {
      id: "item-1",
      progress: {
        waitForReply: true,
        status: "aguardando_usuario",
        nextStepIndex: 1,
        updatedAt: "2026-10-25T20:45:32.000Z",
      },
    },
  };

  describe("Item 1: resolveActiveWaitCampaign escolhe a campanha da ÚLTIMA mensagem outbound enviada", () => {
    it("com pool Postgres: seleciona a campanha cuja mensagem outbound é a mais recente em lead_messages (não a [0])", async () => {
      // camp1Old é o índice [0], camp2Recent é o índice [1]
      const processingMatches = [camp1Old, camp2Recent];

      const mockPool = {
        query: vi.fn(async (sql, params) => {
          // Consulta da candidata com outbound mais recente
          if (sql.includes("campaign_id = ANY($3)")) {
            return {
              rows: [
                {
                  campaign_id: camp2Recent.id,
                  last_sent_at: "2026-10-25T20:45:32.000Z",
                },
              ],
            };
          }
          // Consulta geral do último outbound para observabilidade
          if (sql.includes("campaign_id IS NOT NULL")) {
            return {
              rows: [
                {
                  campaign_id: camp2Recent.id,
                  last_sent_at: "2026-10-25T20:45:32.000Z",
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const chosen = await resolveActiveWaitCampaign({
        pool: mockPool,
        clientId,
        phone,
        processingWaitForReplyMatches: processingMatches,
      });

      expect(chosen).not.toBeNull();
      expect(chosen.id).toBe(camp2Recent.id);
      expect(chosen.id).not.toBe(camp1Old.id);
    });

    it("com Supabase: seleciona a campanha cuja mensagem outbound é a mais recente em lead_messages", async () => {
      const processingMatches = [camp1Old, camp2Recent];

      const mockSupabase = {
        from: vi.fn((table) => {
          if (table === "lead_messages") {
            const chain = {
              select: vi.fn(() => chain),
              eq: vi.fn(() => chain),
              in: vi.fn((col, val) => {
                if (col === "campaign_id") {
                  return {
                    order: vi.fn(() => ({
                      limit: vi.fn(async () => ({
                        data: [{ campaign_id: camp2Recent.id, created_at: "2026-10-25T20:45:32.000Z" }],
                        error: null,
                      })),
                    })),
                  };
                }
                return chain;
              }),
              not: vi.fn(() => chain),
              order: vi.fn(() => ({
                limit: vi.fn(async () => ({
                  data: [{ campaign_id: camp2Recent.id, created_at: "2026-10-25T20:45:32.000Z" }],
                  error: null,
                })),
              })),
            };
            return chain;
          }
          return {};
        }),
      };

      const chosen = await resolveActiveWaitCampaign({
        supabase: mockSupabase,
        clientId,
        phone,
        processingWaitForReplyMatches: processingMatches,
      });

      expect(chosen).not.toBeNull();
      expect(chosen.id).toBe(camp2Recent.id);
    });

    it("fallback sem mensagens no banco: seleciona a candidata com progresso mais recente", async () => {
      const processingMatches = [camp1Old, camp2Recent];

      const chosen = await resolveActiveWaitCampaign({
        pool: null,
        supabase: null,
        clientId,
        phone,
        processingWaitForReplyMatches: processingMatches,
      });

      expect(chosen).not.toBeNull();
      expect(chosen.id).toBe(camp2Recent.id);
    });

    it("Item 4: registra observabilidade campaign_reply_mismatch quando a campanha avançada for diferente da última enviada", async () => {
      const processingMatches = [camp1Old]; // só a velha está esperando
      const loggedEvents = [];

      const mockPool = {
        query: vi.fn(async (sql) => {
          if (sql.includes("campaign_id = ANY($3)")) {
            return { rows: [{ campaign_id: camp1Old.id, last_sent_at: "2026-10-24T15:29:00.000Z" }] };
          }
          if (sql.includes("campaign_id IS NOT NULL")) {
            // Última enviada geral foi uma terceira campanha (ou camp2Recent)
            return { rows: [{ campaign_id: camp2Recent.id, last_sent_at: "2026-10-25T20:45:32.000Z" }] };
          }
          return { rows: [] };
        }),
      };

      const logFn = vi.fn((level, event, payload) => {
        loggedEvents.push({ level, event, payload });
      });

      const chosen = await resolveActiveWaitCampaign({
        pool: mockPool,
        clientId,
        phone,
        processingWaitForReplyMatches: processingMatches,
        logFn,
      });

      expect(chosen.id).toBe(camp1Old.id);
      expect(logFn).toHaveBeenCalledWith(
        "warn",
        "campaign_reply_mismatch",
        expect.objectContaining({
          advancedCampaignId: camp1Old.id,
          latestOutboundCampaignId: camp2Recent.id,
        })
      );
    });
  });

  describe("Item 1 via Webhook Chatbot (Rotas Reais): avança a campanha da última mensagem", () => {
    it("webhook /api/hardcoded-chat-webhook avança camp2Recent (última mensagem enviada), e NÃO camp1Old (índice 0)", async () => {
      const routes = {};
      const mockApp = {
        post: vi.fn((path, ...handlers) => {
          routes[`POST ${path}`] = handlers[handlers.length - 1];
        }),
        get: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        use: vi.fn(),
      };

      let continueCampaignCalledWith = null;
      const mockContinueCampaignLeadFromReply = vi.fn(async (args) => {
        continueCampaignCalledWith = args;
        return { success: true, status: "campaign_step_dispatched" };
      });

      const mockPool = {
        query: vi.fn(async (sql) => {
          if (sql.includes("campaign_id = ANY($3)")) {
            return { rows: [{ campaign_id: camp2Recent.id, last_sent_at: "2026-10-25T20:45:32.000Z" }] };
          }
          if (sql.includes("campaign_id IS NOT NULL")) {
            return { rows: [{ campaign_id: camp2Recent.id, last_sent_at: "2026-10-25T20:45:32.000Z" }] };
          }
          return { rows: [] };
        }),
      };

      const createQueryChain = () => {
        const chain = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          in: vi.fn(() => chain),
          gte: vi.fn(() => chain),
          order: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          not: vi.fn(() => chain),
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
          single: vi.fn(async () => ({ data: null, error: null })),
          insert: vi.fn(async (data) => ({ data, error: null })),
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              in: vi.fn(async () => ({ data: {}, error: null })),
            })),
          })),
        };
        return chain;
      };

      const mockSupabase = {
        from: vi.fn(() => createQueryChain()),
      };

      const mockFindCampaignReplyMatches = vi.fn(async () => ({
        matches: [camp1Old, camp2Recent],
        waitForReplyMatches: [camp1Old, camp2Recent],
        processingWaitForReplyMatches: [camp1Old, camp2Recent], // camp1Old é [0], camp2Recent é [1]
        activePeriodCampaign: null,
      }));

      const deps = {
        ensureDb: () => true,
        getLeadClientEvolutionInstances: async () => [],
        getLeadClientN8nSettings: async () => ({}),
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
        resolveAuthorizedClientId: (_req, _res, cid) => cid || clientId,
        resolveDispatchWebhookSettings: async () => ({}),
        resolveInboundDispatchSettings: async () => ({}),
        sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
        sendError: vi.fn(),
        supabase: mockSupabase,
        validateLeadsOutlierRecord: () => true,
        validateN8nInboundBearer: () => true,
      };

      registerChatbotRoutes(mockApp, deps);
      const handler = routes["POST /api/hardcoded-chat-webhook"];
      expect(handler).toBeDefined();

      const req = {
        body: {
          event: "messages.upsert",
          clientId,
          phone,
          data: {
            key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: "WAMSG_TEST" },
            message: { conversation: "ola. pode mandar" },
            messageTimestamp: 1788212600,
          },
        },
        query: {},
      };

      let jsonResponse = null;
      const res = {
        json: vi.fn((data) => {
          jsonResponse = data;
        }),
      };

      await handler(req, res);
      await new Promise((r) => setTimeout(r, 20));

      expect(mockContinueCampaignLeadFromReply).toHaveBeenCalled();
      // ✅ NÃO PEGOU camp1Old ([0])! Pegou camp2Recent (a campanha da última mensagem outbound)
      expect(continueCampaignCalledWith.campaignMatch.id).toBe(camp2Recent.id);
      expect(continueCampaignCalledWith.campaignMatch.id).not.toBe(camp1Old.id);
    });
  });

  describe("Item 2: Trava de réguas simultâneas ao criar lote (POST /api/campaigns/:id/dispatches)", () => {
    it("recusa a criação do lote com 422 CONFLICTING_CAMPAIGN_PROGRESS se algum lead já tiver progresso em 'aguardando_usuario' de outra campanha", async () => {
      const routes = {};
      const mockApp = {
        post: vi.fn((path, ...handlers) => {
          routes[`POST ${path}`] = handlers[handlers.length - 1];
        }),
        get: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        use: vi.fn(),
      };

      let sentStatusCode = null;
      let sentErrorCode = null;
      let sentErrorMessage = null;

      const mockSendError = vi.fn((res, status, code, msg) => {
        sentStatusCode = status;
        sentErrorCode = code;
        sentErrorMessage = msg;
        res.status(status).json({ code, message: msg });
      });

      const conflictingCampaignId = "0d3e7b15-9999-4444-8888-abcdef123456";
      const conflictingCampaignName = "Campanha Funil [Tag: TESTE DO BASTÃO]";

      const mockPreviewLeads = [
        {
          id: "lead-item-1",
          telefone: "5534991093607",
          nome: "Lead Teste",
          normalized_data: {
            campaign_progress: {
              [conflictingCampaignId]: {
                status: "aguardando_usuario",
                waitForReply: true,
                campaignName: conflictingCampaignName,
              },
            },
          },
        },
      ];

      const mockSupabase = {
        from: vi.fn((table) => {
          if (table === "campaigns") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: {
                      id: camp2Recent.id,
                      client_id: clientId,
                      import_id: "import-1",
                      analytics_meta: {
                        sequence: [
                          { id: "s1", type: "text", order: 1, text: "Mensagem 1", enabled: true },
                        ],
                      },
                    },
                    error: null,
                  })),
                })),
              })),
            };
          }
          return {};
        }),
      };

      const deps = {
        ensureDb: () => true,
        buildDispatchLeads: async () => mockPreviewLeads,
        canCampaignBeDispatched: () => true,
        checkEvolutionInstanceHealth: async () => ({ ok: true }),
        continueCampaignLeadFromReply: async () => ({}),
        executeCampaignDispatch: async () => ({}),
        findCampaignReplyMatches: async () => ({ matches: [], waitForReplyMatches: [], processingWaitForReplyMatches: [] }),
        getClientName: async () => "Bia do Spazio",
        getLeadClientEvolutionInstances: async () => [],
        getLeadClientN8nSettings: async () => ({}),
        getRequestId: () => "req-1",
        getSafeDispatchSettingsLog: () => ({}),
        internalErrorPayloadDetails: () => ({}),
        isMissingSchemaError: () => false,
        isProduction: false,
        logCampaignReplyFlow: () => {},
        logDirectDispatch: () => {},
        maskPhoneForLog: (p) => p,
        normalizeIsoDate: (d) => d,
        leadsTableName: (c) => `leads_${c}`,
        normalizeString: (s) => (s ? String(s).trim() : ""),
        parseOptionalUuid: (v) => ({ value: v || null, error: null }),
        pgDatabasePool: null, // testa em memória
        requireAppViewAccess: () => (_req, _res, next) => next(),
        requireCampaignDispatchAccess: (_req, _res, next) => next(),
        requireFirebaseAuth: (_req, _res, next) => next(),
        resolveAuthorizedClientId: (_req, _res, cid) => cid || clientId,
        resolveCampaignDispatchSettings: async () => ({ webhookUrl: "https://mock", webhookToken: "tok" }),
        sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
        sendError: mockSendError,
        supabase: mockSupabase,
      };

      registerCampaignsRoutes(mockApp, deps);
      const handler = routes["POST /api/campaigns/:id/dispatches"];
      expect(handler).toBeDefined();

      const req = {
        params: { id: camp2Recent.id },
        body: { name: "Novo Lote" },
      };

      const res = {
        status: vi.fn(() => res),
        json: vi.fn(),
      };

      await handler(req, res);

      // ✅ A criação foi RECUSADA
      expect(mockSendError).toHaveBeenCalled();
      expect(sentStatusCode).toBe(422);
      expect(sentErrorCode).toBe("CONFLICTING_CAMPAIGN_PROGRESS");
      // ✅ Nomeia a campanha conflitante no aviso
      expect(sentErrorMessage).toContain(conflictingCampaignName);
    });

    it("permite a criação do lote se os leads NÃO tiverem outra campanha em 'aguardando_usuario'", async () => {
      const routes = {};
      const mockApp = {
        post: vi.fn((path, ...handlers) => {
          routes[`POST ${path}`] = handlers[handlers.length - 1];
        }),
        get: vi.fn(),
        put: vi.fn(),
        patch: vi.fn(),
        delete: vi.fn(),
        use: vi.fn(),
      };

      const mockSendError = vi.fn();
      let createdDispatch = null;

      const mockPreviewLeads = [
        {
          id: "lead-livre-1",
          telefone: "5534991093607",
          normalized_data: {
            campaign_progress: {
              "outra-campanha-finalizada": {
                status: "finalizado", // já finalizou, não conflita!
              },
            },
          },
        },
      ];

      const mockSupabase = {
        from: vi.fn((table) => {
          if (table === "campaigns") {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  single: vi.fn(async () => ({
                    data: {
                      id: camp2Recent.id,
                      client_id: clientId,
                      import_id: "import-1",
                      analytics_meta: {
                        sequence: [{ id: "s1", type: "text", order: 1, text: "Oi", enabled: true }],
                      },
                    },
                    error: null,
                  })),
                })),
              })),
            };
          }
          if (table === "campaign_dispatches") {
            return {
              insert: vi.fn((payload) => ({
                select: vi.fn(() => ({
                  single: vi.fn(async () => {
                    createdDispatch = { id: "disp-101", ...payload };
                    return { data: createdDispatch, error: null };
                  }),
                })),
              })),
            };
          }
          return {};
        }),
      };

      const deps = {
        ensureDb: () => true,
        buildDispatchLeads: async () => mockPreviewLeads,
        canCampaignBeDispatched: () => true,
        checkEvolutionInstanceHealth: async () => ({ ok: true }),
        continueCampaignLeadFromReply: async () => ({}),
        executeCampaignDispatch: async () => ({}),
        findCampaignReplyMatches: async () => ({ matches: [], waitForReplyMatches: [], processingWaitForReplyMatches: [] }),
        getClientName: async () => "Bia do Spazio",
        getLeadClientEvolutionInstances: async () => [],
        getLeadClientN8nSettings: async () => ({}),
        getRequestId: () => "req-1",
        getSafeDispatchSettingsLog: () => ({}),
        internalErrorPayloadDetails: () => ({}),
        isMissingSchemaError: () => false,
        isProduction: false,
        logCampaignReplyFlow: () => {},
        logDirectDispatch: () => {},
        maskPhoneForLog: (p) => p,
        normalizeIsoDate: (d) => d,
        leadsTableName: (c) => `leads_${c}`,
        normalizeString: (s) => (s ? String(s).trim() : ""),
        parseOptionalUuid: (v) => ({ value: v || null, error: null }),
        pgDatabasePool: null,
        requireAppViewAccess: () => (_req, _res, next) => next(),
        requireCampaignDispatchAccess: (_req, _res, next) => next(),
        requireFirebaseAuth: (_req, _res, next) => next(),
        resolveAuthorizedClientId: (_req, _res, cid) => cid || clientId,
        resolveCampaignDispatchSettings: async () => ({ webhookUrl: "https://mock", webhookToken: "tok" }),
        sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
        sendError: mockSendError,
        supabase: mockSupabase,
      };

      registerCampaignsRoutes(mockApp, deps);
      const handler = routes["POST /api/campaigns/:id/dispatches"];

      const req = {
        params: { id: camp2Recent.id },
        body: { name: "Lote Sem Conflito" },
      };

      const res = {
        status: vi.fn(() => res),
        json: vi.fn(),
      };

      await handler(req, res);

      // Não houve erro
      expect(mockSendError).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(201);
      expect(createdDispatch).not.toBeNull();
    });
  });

  describe("Item 3: Prazo de validade do progresso (7 dias TTL)", () => {
    it("finaliza progressos em 'aguardando_usuario' com inatividade superior a 7 dias", async () => {
      const tenDaysAgo = new Date(Date.now() - 10 * 86400000).toISOString();
      const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();

      let updatedData = null;

      const mockPool = {
        query: vi.fn(async (sql, params) => {
          if (sql.includes("SELECT lii.id, lii.client_id, lii.telefone, lii.normalized_data")) {
            return {
              rows: [
                {
                  id: "item-stale",
                  client_id: clientId,
                  telefone: phone,
                  normalized_data: {
                    campaign_progress: {
                      [camp1Old.id]: {
                        status: "aguardando_usuario",
                        updatedAt: tenDaysAgo,
                      },
                      [camp2Recent.id]: {
                        status: "aguardando_usuario",
                        updatedAt: twoDaysAgo, // recente, não deve expirar
                      },
                    },
                  },
                },
              ],
            };
          }
          if (sql.includes("UPDATE public.lead_import_items")) {
            updatedData = params[0];
            return { rowCount: 1 };
          }
          return { rows: [] };
        }),
      };

      const result = await expireStaleCampaignProgress(mockPool, { ttlDays: 7 });

      expect(result.expiredCount).toBe(1);
      expect(updatedData).not.toBeNull();
      // O progresso de 10 dias atrás virou finalizado
      expect(updatedData.campaign_progress[camp1Old.id].status).toBe("finalizado");
      expect(updatedData.campaign_progress[camp1Old.id].expiredReason).toBe("timeout_7d");
      // O progresso de 2 dias atrás PERMANECE aguardando_usuario
      expect(updatedData.campaign_progress[camp2Recent.id].status).toBe("aguardando_usuario");
    });
  });
});
