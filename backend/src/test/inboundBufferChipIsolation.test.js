// backend/src/test/inboundBufferChipIsolation.test.js
//
// TESTES OBRIGATÓRIOS — Cruzamento de Chip e Resposta Duplicada (Blocos 1, 2 e 3)
//
// Prova, não teste verde:
//  a) Duas mensagens do mesmo lead em formatos diferentes ("34991510131" e
//     "5534991510131@s.whatsapp.net") caem na mesma chave canônica -> UMA resposta só
//  b) Mensagens do mesmo lead por instâncias diferentes -> buffers separados;
//     timer de uma NÃO cancela o da outra
//  c) Resposta do bot grava instance_name preenchido com a instância que enviou (targetInstance),
//     quando o webhook recebe uma instância reconhecida
//  d) resolvedInstanceName null -> NÃO envia; console.error com o identificador
//     recebido; a mensagem inbound É gravada normalmente
//  e) repasse de campanha (campaigns/routes.js) leva a instância no payload ->
//     o webhook resolve e a resposta sai pelo chip certo

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";

vi.mock("../chatbot-ai-engine.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    processBatch: vi.fn(async () => ({
      mensagem: "Olá! Como posso ajudar?",
      status_conversa: "em_atendimento",
      classificacao: "qualificado",
    })),
  };
});

import { bufferMessage, _messageBuffersForTest } from "../chatbot-ai-engine.js";
import { toCanonicalPhoneFromJid } from "../services/canonicalPhone.js";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";

function createFakeSupabase(onMessageInsert) {
  const createChain = (tableName) => {
    const chain = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      in: vi.fn(() => chain),
      is: vi.fn(() => chain),
      gte: vi.fn(() => chain),
      order: vi.fn(() => chain),
      limit: vi.fn(() => chain),
      maybeSingle: vi.fn(async () => ({ data: { id: "lead-1" }, error: null })),
      single: vi.fn(async () => ({ data: { id: "lead-1" }, error: null })),
      insert: vi.fn(async (payload) => {
        if (tableName === "lead_messages" && onMessageInsert) {
          onMessageInsert(payload);
        }
        return { data: null, error: null };
      }),
      update: vi.fn(() => chain),
      then: (resolve) => resolve({ data: [], error: null }),
    };
    return chain;
  };

  return {
    from: vi.fn((tableName) => createChain(tableName)),
  };
}

function createChatbotDeps({ instances = [], onMessageInsert } = {}) {
  const fakeDispatchSettings = {
    webhookUrl: "https://evo.vexo.test/message/sendText/instancia-enviadora-real",
    webhookToken: "test-token",
    source: "tenant_default",
    instanceName: "instancia-enviadora-real",
    tentativas: [],
  };

  const fakeSupabase = createFakeSupabase(onMessageInsert);

  const mockDb = {
    query: vi.fn(async (sql) => {
      const sqlStr = String(sql || "");
      if (sqlStr.includes("lead_client_n8n_settings")) {
        return { rows: [] };
      }
      return { rows: instances };
    }),
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql) => {
        const sqlStr = String(sql || "");
        if (sqlStr.includes("lead_client_n8n_settings")) {
          return { rows: [] };
        }
        return { rows: instances };
      }),
      release: vi.fn(),
    })),
  };

  return {
    classifyConversation: vi.fn(async () => ({ ignore: false })),
    ensureDb: () => true,
    ensureDbClient: vi.fn(),
    findCampaignReplyMatches: vi.fn(async () => ({ matches: [], waitForReplyMatches: [], processingWaitForReplyMatches: [] })),
    getLeadClientEvolutionInstances: vi.fn(async () => instances),
    getLeadClientN8nSettings: vi.fn(async () => ({
      chatbot_enabled: true,
      chatbot_inbound_scope: "all",
    })),
    internalErrorPayloadDetails: vi.fn(),
    isMissingSchemaError: () => false,
    leadsTableName: () => "leads",
    maskPhoneForLog: (p) => p,
    MAX_LEADS_OUTLIER_BATCH: 50,
    continueCampaignLeadFromReply: vi.fn(),
    normalizeString: (s) => (s ? String(s).trim() : ""),
    normalizeTenantKey: (k) => k || "outlier",
    pgDatabasePool: mockDb,
    requireAppViewAccess: () => (_req, _res, next) => next(),
    requireFirebaseAuth: (_req, _res, next) => next(),
    resolveAuthorizedClientId: (_req, _res, cid) => cid || "test-client",
    resolveDispatchWebhookSettings: vi.fn(async () => fakeDispatchSettings),
    resolveInboundDispatchSettings: vi.fn(async ({ instanceName }) => ({
      ...fakeDispatchSettings,
      webhookUrl: `https://evo.vexo.test/message/sendText/${instanceName || "instancia-enviadora-real"}`,
      instanceName: instanceName || "instancia-enviadora-real",
    })),
    sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
    sendError: (res, status, code, msg) => res.status(status).json({ error: code, message: msg }),
    supabase: fakeSupabase,
    validateLeadsOutlierRecord: () => true,
    validateN8nInboundBearer: vi.fn(async () => true),
  };
}

describe("CRUZAMENTO DE CHIP E RESPOSTA DUPLICADA — Blocos 1, 2 e 3", () => {
  beforeEach(() => {
    _messageBuffersForTest.clear();
  });

  afterEach(() => {
    _messageBuffersForTest.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("toCanonicalPhoneFromJid", () => {
    it("canonicaliza telefone cru sem DDI e JID com DDI para a mesma string canônica", () => {
      const rawWithoutDdi = "34991510131";
      const rawJid = "5534991510131@s.whatsapp.net";
      const rawCUs = "553491510131@c.us"; // sem o nono dígito

      expect(toCanonicalPhoneFromJid(rawWithoutDdi)).toBe("5534991510131");
      expect(toCanonicalPhoneFromJid(rawJid)).toBe("5534991510131");
      expect(toCanonicalPhoneFromJid(rawCUs)).toBe("5534991510131");
      expect(toCanonicalPhoneFromJid(rawWithoutDdi)).toBe(toCanonicalPhoneFromJid(rawJid));
    });

    it("@g.us e @lid não são tratados como telefone e preservam o identificador", () => {
      const groupJid = "120363049633060243@g.us";
      const lidJid = "100200300@lid";

      expect(toCanonicalPhoneFromJid(groupJid)).toBe(groupJid);
      expect(toCanonicalPhoneFromJid(lidJid)).toBe(lidJid);
      expect(toCanonicalPhoneFromJid(groupJid)).not.toBe("120363049633060243");
    });

    it("trata null, undefined e strings vazias sem lançar erro", () => {
      expect(toCanonicalPhoneFromJid(null)).toBe("");
      expect(toCanonicalPhoneFromJid(undefined)).toBe("");
      expect(toCanonicalPhoneFromJid("   ")).toBe("");
    });
  });

  describe("Bloco 1 — Buffer por chip e telefone canônico", () => {
    it("TESTE (a): duas mensagens do mesmo lead com formatos diferentes dentro de 3s -> UMA resposta só", () => {
      vi.useFakeTimers();
      const processSpy = vi.fn();
      const clientId = "client-spazio";
      const instance = "bia-do-spazio-slug";

      bufferMessage(clientId, "34991510131", { text: "Olá, gostaria de saber os preços" }, processSpy, instance);

      vi.advanceTimersByTime(1500);
      expect(processSpy).not.toHaveBeenCalled();

      bufferMessage(clientId, "5534991510131@s.whatsapp.net", { text: "Tem alguém disponível?" }, processSpy, instance);

      vi.advanceTimersByTime(3000);

      expect(processSpy).toHaveBeenCalledTimes(1);
      expect(processSpy).toHaveBeenCalledWith([
        { text: "Olá, gostaria de saber os preços" },
        { text: "Tem alguém disponível?" },
      ]);
    });

    it("TESTE (b): mensagens do mesmo lead chegando por instâncias diferentes -> buffers separados e timers independentes", () => {
      vi.useFakeTimers();
      const processChipA = vi.fn();
      const processChipB = vi.fn();
      const clientId = "client-spazio";
      const leadPhone = "5534991510131";

      bufferMessage(clientId, leadPhone, { text: "Msg no chip A" }, processChipA, "chip-a-slug");

      vi.advanceTimersByTime(2000);
      expect(processChipA).not.toHaveBeenCalled();
      expect(processChipB).not.toHaveBeenCalled();

      bufferMessage(clientId, leadPhone, { text: "Msg no chip B" }, processChipB, "chip-b-slug");

      vi.advanceTimersByTime(1000);

      expect(processChipA).toHaveBeenCalledTimes(1);
      expect(processChipA).toHaveBeenCalledWith([{ text: "Msg no chip A" }]);
      expect(processChipB).not.toHaveBeenCalled();

      vi.advanceTimersByTime(2000);

      expect(processChipB).toHaveBeenCalledTimes(1);
      expect(processChipB).toHaveBeenCalledWith([{ text: "Msg no chip B" }]);
    });

    it("instância ausente ou vazia usa marcador explícito 'sem-instancia'", () => {
      vi.useFakeTimers();
      const processSpy = vi.fn();
      const clientId = "client-spazio";

      bufferMessage(clientId, "34991510131", { text: "Msg sem instância" }, processSpy, null);

      const expectedKey = `${clientId}:sem-instancia:5534991510131`;
      expect(_messageBuffersForTest.has(expectedKey)).toBe(true);

      vi.advanceTimersByTime(3000);
      expect(processSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("Bloco 2 — Registro da instância que de fato enviou na resposta do bot", () => {
    it("TESTE (c): resposta do bot grava instance_name preenchido com a instância que enviou (targetInstance)", async () => {
      const app = express();
      app.use(express.json());

      const recordedMessages = [];
      const instances = [
        {
          id: "inst-1",
          name: "instancia-enviadora-real",
          dispatch_webhook_url: "https://evo.vexo.test/message/sendText/instancia-enviadora-real",
        },
      ];

      const originalFetch = global.fetch;
      global.fetch = vi.fn(async (url) => {
        if (String(url).includes("evo.vexo.test")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ key: { id: "wa-msg-123" } }),
            text: async () => JSON.stringify({ key: { id: "wa-msg-123" } }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      const deps = createChatbotDeps({
        instances,
        onMessageInsert: (payload) => recordedMessages.push(payload),
      });

      registerChatbotRoutes(app, deps);

      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      try {
        vi.useFakeTimers();

        const res = await originalFetch(`http://127.0.0.1:${port}/api/hardcoded-chat-webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: "test-client",
            phone: "5534991510131",
            message: "Olá bot com chip reconhecido",
            key: { id: "test-msg-1" },
            instance: "instancia-enviadora-real",
          }),
        });

        expect(res.status).toBe(200);

        await vi.advanceTimersByTimeAsync(3500);

        const botMessage = recordedMessages.find((m) => m.sender_type === "bot");
        expect(botMessage).toBeDefined();
        expect(botMessage.instance_name).toBe("instancia-enviadora-real");
      } finally {
        vi.useRealTimers();
        global.fetch = originalFetch;
        await new Promise((resolve) => server.close(resolve));
      }
    });
  });

  describe("Bloco 3 — Nunca responder por chip diferente do que recebeu", () => {
    it("TESTE (d): resolvedInstanceName null -> NÃO envia resposta; console.error com identificador; mensagem inbound É gravada em lead_messages", async () => {
      const app = express();
      app.use(express.json());

      const recordedMessages = [];
      const evolutionFetchCalls = [];
      const instances = [
        {
          id: "inst-1",
          name: "4343 - ATENDIMENTO",
          dispatch_webhook_url: "https://evo.vexo.test/message/sendText/4343-atendimento",
        },
      ];

      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const originalFetch = global.fetch;
      global.fetch = vi.fn(async (url, opts) => {
        if (String(url).includes("evo.vexo.test")) {
          evolutionFetchCalls.push({ url, opts });
          return {
            ok: true,
            status: 200,
            json: async () => ({ key: { id: "wa-msg-123" } }),
            text: async () => JSON.stringify({ key: { id: "wa-msg-123" } }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      const deps = createChatbotDeps({
        instances,
        onMessageInsert: (payload) => recordedMessages.push(payload),
      });

      registerChatbotRoutes(app, deps);

      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      try {
        vi.useFakeTimers();

        // Lead manda mensagem com identificador antigo/desconhecido que não casa com nenhum chip cadastrado
        const res = await originalFetch(`http://127.0.0.1:${port}/api/hardcoded-chat-webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: "test-client",
            phone: "5534991510131",
            message: "Olá, tenho uma dúvida",
            key: { id: "inbound-msg-unknown-chip" },
            instance: "bia-do-spazio-4343-eleicao",
          }),
        });

        expect(res.status).toBe(200);

        // Dispara o buffer
        await vi.advanceTimersByTimeAsync(3500);

        // 1. Mensagem INBOUND do lead É gravada normalmente em lead_messages
        const inboundMessage = recordedMessages.find((m) => m.sender_type === "lead");
        expect(inboundMessage).toBeDefined();
        expect(inboundMessage.direction).toBe("inbound");
        expect(inboundMessage.message_text).toBe("Olá, tenho uma dúvida");

        // 2. Resposta do BOT NÃO é enviada nem gravada
        const botMessage = recordedMessages.find((m) => m.sender_type === "bot");
        expect(botMessage).toBeUndefined();
        expect(evolutionFetchCalls).toHaveLength(0);

        // 3. console.error visível com [chatbot], identificador que chegou e motivo
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "[chatbot] resposta NAO enviada: instancia_nao_reconhecida",
          expect.objectContaining({
            clientId: "test-client",
            phone: "5534991510131",
            identificadorRecebido: "bia-do-spazio-4343-eleicao",
            motivo: "instancia_nao_reconhecida",
          })
        );
      } finally {
        vi.useRealTimers();
        global.fetch = originalFetch;
        consoleErrorSpy.mockRestore();
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it("TESTE (e): repasse de campanha (campaigns/routes.js) leva a instância no payload -> webhook resolve e resposta sai pelo chip certo", async () => {
      const app = express();
      app.use(express.json());

      const recordedMessages = [];
      const evolutionFetchCalls = [];
      const instances = [
        {
          id: "inst-camp-1",
          name: "chip-campanha-vendas",
          dispatch_webhook_url: "https://evo.vexo.test/message/sendText/chip-campanha-vendas",
        },
      ];

      const originalFetch = global.fetch;
      const internalForwardCalls = [];

      global.fetch = vi.fn(async (url, opts) => {
        const urlStr = String(url);
        if (urlStr.includes("api/hardcoded-chat-webhook")) {
          internalForwardCalls.push({ url: urlStr, opts, body: JSON.parse(opts.body) });
          return { ok: true, status: 200, json: async () => ({ status: "forwarded" }) };
        }
        if (urlStr.includes("evo.vexo.test")) {
          evolutionFetchCalls.push({ url: urlStr, opts, body: JSON.parse(opts.body) });
          return {
            ok: true,
            status: 200,
            json: async () => ({ key: { id: "wa-msg-campaign-reply-1" } }),
            text: async () => JSON.stringify({ key: { id: "wa-msg-campaign-reply-1" } }),
          };
        }
        return { ok: true, status: 200, json: async () => ({}) };
      });

      const chatbotDeps = createChatbotDeps({
        instances,
        onMessageInsert: (payload) => recordedMessages.push(payload),
      });

      registerChatbotRoutes(app, chatbotDeps);

      // Registra rotas de campanhas com deps mínimas para reply-webhook
      registerCampaignsRoutes(app, {
        ensureDb: () => true,
        resolveAuthorizedClientId: () => "test-client",
        requireFirebaseAuth: (_req, _res, next) => next(),
        requireCampaignDispatchAccess: (_req, _res, next) => next(),
        requireAppViewAccess: () => (_req, _res, next) => next(),
        requireInternalPageAccess: () => (_req, _res, next) => next(),
        validateN8nInboundBearer: () => true,
        findCampaignReplyMatches: async () => ({
          matches: [],
          waitForReplyMatches: [],
          processingWaitForReplyMatches: [],
        }),
        continueCampaignLeadFromReply: async () => ({ continued: false }),
        logCampaignReplyFlow: () => {},
        maskPhoneForLog: (p) => p,
        normalizeIsoDate: (d) => d,
        normalizeString: (s) => String(s || "").trim(),
        normalizeTenantKey: (s) => String(s || "").trim(),
        sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
        sendError: (res, status, code, msg) => res.status(status).json({ error: { code, msg } }),
        getLeadClientN8nSettings: async () => ({ chatbot_model: "gpt-4o-mini" }),
        supabase: chatbotDeps.supabase,
        isMissingSchemaError: () => false,
        leadsTableName: () => "leads",
      });

      const server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      const port = server.address().port;

      try {
        // 1. Inbound de campanha chega em /api/campaigns/reply-webhook com instanceName
        const campaignRes = await originalFetch(`http://127.0.0.1:${port}/api/campaigns/reply-webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientId: "test-client",
            phone: "5534991510131",
            message: "Quero agendar uma visita",
            instanceName: "chip-campanha-vendas",
            key: { id: "campaign-reply-inbound-1" },
          }),
        });

        expect(campaignRes.status).toBe(200);

        // 2. Verifica que o repasse de campanha incluiu 'instance' no payload do fetch interno
        expect(internalForwardCalls).toHaveLength(1);
        const forwardPayload = internalForwardCalls[0].body;
        expect(forwardPayload).toHaveProperty("instance", "chip-campanha-vendas");

        // 3. Encaminha o payload repassado para o webhook com fake timers ativos para controlar o buffer
        vi.useFakeTimers();

        const webhookRes = await originalFetch(`http://127.0.0.1:${port}/api/hardcoded-chat-webhook`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(forwardPayload),
        });
        expect(webhookRes.status).toBe(200);

        // Avança o buffer do chatbot (3500ms)
        await vi.advanceTimersByTimeAsync(3500);

        // O webhook do chatbot resolveu a instância repassada e enviou pelo chip correto
        expect(evolutionFetchCalls).toHaveLength(1);
        expect(evolutionFetchCalls[0].url).toContain("chip-campanha-vendas");

        const botMessage = recordedMessages.find((m) => m.sender_type === "bot");
        expect(botMessage).toBeDefined();
        expect(botMessage.instance_name).toBe("chip-campanha-vendas");
      } finally {
        vi.useRealTimers();
        global.fetch = originalFetch;
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it("TESTE (e.2): repasse de campanha nos 3 pontos de fetch inclui 'instance' no JSON", async () => {
      // Verifica os 3 locais de fetch em campaigns/routes.js (linhas 6183, 6198, 6276)
      const capturedFetches = [];
      const originalFetch = global.fetch;
      global.fetch = vi.fn(async (url, opts) => {
        capturedFetches.push({ url: String(url), body: JSON.parse(opts.body) });
        return { ok: true, status: 200, json: async () => ({}) };
      });

      const routes = {};
      const fakeApp = {
        get: () => {},
        post: (p, ...h) => { routes[`post ${p}`] = h[h.length - 1]; },
        delete: () => {},
        put: () => {},
        patch: () => {},
        use: () => {},
      };

      const makeCampaignDeps = (activeWaitCampaign = null) => ({
        ensureDb: () => true,
        resolveAuthorizedClientId: () => "test-client",
        requireFirebaseAuth: (_req, _res, next) => next(),
        requireCampaignDispatchAccess: (_req, _res, next) => next(),
        requireAppViewAccess: () => (_req, _res, next) => next(),
        requireInternalPageAccess: () => (_req, _res, next) => next(),
        validateN8nInboundBearer: () => true,
        findCampaignReplyMatches: async () => ({
          matches: activeWaitCampaign ? [activeWaitCampaign] : [],
          waitForReplyMatches: activeWaitCampaign ? [activeWaitCampaign] : [],
          processingWaitForReplyMatches: activeWaitCampaign ? [activeWaitCampaign] : [],
        }),
        continueCampaignLeadFromReply: async () => ({ continued: true }),
        logCampaignReplyFlow: () => {},
        maskPhoneForLog: (p) => p,
        normalizeIsoDate: (d) => d,
        normalizeString: (s) => String(s || "").trim(),
        normalizeTenantKey: (s) => String(s || "").trim(),
        sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
        sendError: (res, status, code, msg) => res.status(status).json({ error: { code, msg } }),
        getLeadClientN8nSettings: async () => ({ chatbot_model: "gpt-4o-mini" }),
        supabase: createFakeSupabase(),
        isMissingSchemaError: () => false,
        leadsTableName: () => "leads",
      });

      try {
        // PONTO 1: activeWaitCampaign com forwardCampaignReplyToChatbot=true e campaignRoutingEnabled=true
        process.env.CAMPAIGN_REPLY_FORWARD_TO_CHATBOT = "true";
        process.env.ENABLE_CAMPAIGN_ROUTING = "true";
        const app1 = { ...fakeApp, post: (p, ...h) => { routes["point1"] = h[h.length - 1]; } };
        registerCampaignsRoutes(app1, makeCampaignDeps({ id: "c-wait-1", name: "Camp 1", leadImportItem: { id: "item-1" } }));

        await routes["point1"](
          { body: { clientId: "test-client", phone: "5534991510131", message: "Sim", instance: "chip-ponto-1" }, params: {} },
          { statusCode: 200, json() { return this; }, status() { return this; } }
        );

        // PONTO 2: activeWaitCampaign com forwardCampaignReplyToChatbot=true e campaignRoutingEnabled=false
        process.env.CAMPAIGN_REPLY_FORWARD_TO_CHATBOT = "true";
        process.env.ENABLE_CAMPAIGN_ROUTING = "false";
        const app2 = { ...fakeApp, post: (p, ...h) => { routes["point2"] = h[h.length - 1]; } };
        registerCampaignsRoutes(app2, makeCampaignDeps({ id: "c-wait-2", name: "Camp 2", leadImportItem: { id: "item-2" } }));

        await routes["point2"](
          { body: { clientId: "test-client", phone: "5534991510131", message: "Sim 2", instanceName: "chip-ponto-2" }, params: {} },
          { statusCode: 200, json() { return this; }, status() { return this; } }
        );

        // PONTO 3: sem activeWaitCampaign (inbound direcionado ao chatbot)
        process.env.CAMPAIGN_REPLY_FORWARD_TO_CHATBOT = "false";
        process.env.ENABLE_CAMPAIGN_ROUTING = "false";
        const app3 = { ...fakeApp, post: (p, ...h) => { routes["point3"] = h[h.length - 1]; } };
        registerCampaignsRoutes(app3, makeCampaignDeps(null));

        await routes["point3"](
          { body: { clientId: "test-client", phone: "5534991510131", message: "Sim 3", instance_name: "chip-ponto-3" }, params: {} },
          { statusCode: 200, json() { return this; }, status() { return this; } }
        );

        expect(capturedFetches).toHaveLength(3);
        expect(capturedFetches[0].body).toHaveProperty("instance", "chip-ponto-1");
        expect(capturedFetches[1].body).toHaveProperty("instance", "chip-ponto-2");
        expect(capturedFetches[2].body).toHaveProperty("instance", "chip-ponto-3");
      } finally {
        delete process.env.CAMPAIGN_REPLY_FORWARD_TO_CHATBOT;
        delete process.env.ENABLE_CAMPAIGN_ROUTING;
        global.fetch = originalFetch;
      }
    });
  });
});
