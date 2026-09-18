// backend/src/test/chatbotTestAgentId.test.js
//
// POST /api/chatbot-test — "Testar antes de soltar" agora aceita agentId,
// não só instanceName. O fluxo que o Conrado quer: criar o agente, escrever
// o prompt, testar, e SÓ ENTÃO amarrar ao chip — testar não pode exigir
// número. Com agentId, resolveInboundAgentConfig busca a linha diretamente
// pelo id (escopada por tenant_id); sem casar (agente de outro tenant, ou
// inexistente), a rota recusa com 404 e processBatch NUNCA roda — ao
// contrário de instanceName, que sem casar cai pro chatbot do tenant em
// silêncio (comportamento antigo, intacto quando nem agentId nem
// instanceName vêm no corpo).

import { describe, expect, it, vi, beforeEach } from "vitest";

const inboundAgentMock = { resolveInboundAgentConfig: vi.fn() };
vi.mock("../services/inboundAgent.js", () => ({
  resolveInboundAgentConfig: (...args) => inboundAgentMock.resolveInboundAgentConfig(...args),
  buildSpinInstruction: () => "",
  fireInboundCompletionWebhook: vi.fn(),
}));

const engineMock = { processBatch: vi.fn() };
vi.mock("../chatbot-ai-engine.js", () => ({
  processBatch: (...args) => engineMock.processBatch(...args),
  bufferMessage: vi.fn(),
  resolveMessageContent: vi.fn(),
  isFirstCampaignReply: vi.fn(),
  extractBriefingWithAI: vi.fn(),
  LLM_MODELS: {},
  getLlmProviderStatus: vi.fn(() => ({})),
}));

const { registerChatbotRoutes } = await import("../domains/chatbot/routes.js");

function getRouteHandler(path, method = "post") {
  const routes = {};
  const fakeApp = {
    post: vi.fn((p, ...handlers) => { routes[`post ${p}`] = handlers[handlers.length - 1]; }),
    get: vi.fn((p, ...handlers) => { routes[`get ${p}`] = handlers[handlers.length - 1]; }),
    put: vi.fn((p, ...handlers) => { routes[`put ${p}`] = handlers[handlers.length - 1]; }),
    delete: vi.fn((p, ...handlers) => { routes[`delete ${p}`] = handlers[handlers.length - 1]; }),
  };
  const deps = {
    ensureDb: () => true,
    getLeadClientEvolutionInstances: async () => [],
    getLeadClientN8nSettings: async () => ({ chatbot_model: "generico" }),
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    leadsTableName: (c) => `leads_${c}`,
    maskPhoneForLog: (p) => p,
    MAX_LEADS_OUTLIER_BATCH: 100,
    continueCampaignLeadFromReply: vi.fn(),
    findCampaignReplyMatches: vi.fn(),
    normalizeString: (s) => (s ? String(s).trim() : ""),
    normalizeTenantKey: (k) => (k ? String(k).trim() : ""),
    pgDatabasePool: { query: async () => ({ rows: [] }) },
    requireAppViewAccess: () => (_req, _res, next) => next(),
    requireFirebaseAuth: (_req, _res, next) => next(),
    resolveAuthorizedClientId: (_req, _res, cid) => cid || "sonhare",
    resolveDispatchWebhookSettings: async () => ({}),
    resolveInboundDispatchSettings: async () => ({}),
    sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
    sendError: (res, status, code, message, details) => {
      res.statusCode = status;
      res.body = { error: { code, message, ...(details ? { details } : {}) } };
      return res;
    },
    supabase: {},
    validateLeadsOutlierRecord: () => true,
    validateN8nInboundBearer: () => true,
  };
  registerChatbotRoutes(fakeApp, deps);
  const handler = routes[`${method} ${path}`];
  expect(handler, `rota ${method.toUpperCase()} ${path} não encontrada`).toBeDefined();
  return handler;
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; this.statusCode = this.statusCode || 200; return this; },
  };
}

describe("POST /api/chatbot-test com agentId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[TESTE OBRIGATÓRIO] agente sem chip, com prompt próprio: processBatch roda com o prompt do AGENTE, não o do tenant", async () => {
    inboundAgentMock.resolveInboundAgentConfig.mockResolvedValue({
      companyId: "agente-1",
      instanceName: null,
      enabled: true,
      model: "openai/gpt-oss-120b",
      prompt: "Prompt exclusivo deste agente — nunca o padrão do tenant.",
      spinFields: [],
      webhookUrl: null,
      sdrPhone: null,
      sdrTransferEnabled: false,
      instructionsConsolidated: false,
      agentKind: "atendimento",
    });
    engineMock.processBatch.mockResolvedValue({ mensagem: "Oi! Tudo bem?" });

    const handler = getRouteHandler("/api/chatbot-test");
    const req = { body: { clientId: "sonhare", message: "oi", agentId: "agente-1" } };
    const res = fakeRes();

    await handler(req, res);

    expect(inboundAgentMock.resolveInboundAgentConfig).toHaveBeenCalledWith({ supabase: {}, clientId: "sonhare", agentId: "agente-1" });
    expect(engineMock.processBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        inboundPrompt: "Prompt exclusivo deste agente — nunca o padrão do tenant.",
        companyId: "agente-1",
        llmModel: "openai/gpt-oss-120b",
      })
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.response).toBe("Oi! Tudo bem?");
    expect(res.body.meta.agente).toBe("inbound");
  });

  it("[TESTE OBRIGATÓRIO] agente com base própria: companyId do agente chega ao processBatch (é o que escopa a busca RAG)", async () => {
    inboundAgentMock.resolveInboundAgentConfig.mockResolvedValue({
      companyId: "agente-com-base",
      instanceName: null,
      enabled: true,
      model: null,
      prompt: "Responda só com o que está na base.",
      spinFields: [],
      webhookUrl: null,
      sdrPhone: null,
      sdrTransferEnabled: false,
      instructionsConsolidated: false,
      agentKind: "atendimento",
    });
    engineMock.processBatch.mockResolvedValue({ mensagem: "Segundo o catálogo, o valor é R$ 500." });

    const handler = getRouteHandler("/api/chatbot-test");
    const req = { body: { clientId: "sonhare", message: "qual o preço?", agentId: "agente-com-base" } };
    const res = fakeRes();

    await handler(req, res);

    expect(engineMock.processBatch).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: "agente-com-base" })
    );
    expect(res.body.response).toContain("R$ 500");
  });

  it("[TESTE OBRIGATÓRIO] agentId de outro tenant (ou inexistente): 404, processBatch nunca roda", async () => {
    inboundAgentMock.resolveInboundAgentConfig.mockResolvedValue(null);

    const handler = getRouteHandler("/api/chatbot-test");
    const req = { body: { clientId: "sonhare", message: "oi", agentId: "agente-de-outro-tenant" } };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe("AGENT_NOT_FOUND");
    expect(engineMock.processBatch).not.toHaveBeenCalled();
  });

  it("sem agentId e sem instanceName: idêntico a hoje — resolveInboundAgentConfig nem é chamado, processBatch roda com o chatbot do tenant", async () => {
    engineMock.processBatch.mockResolvedValue({ mensagem: "Resposta do chatbot do tenant." });

    const handler = getRouteHandler("/api/chatbot-test");
    const req = { body: { clientId: "sonhare", message: "oi" } };
    const res = fakeRes();

    await handler(req, res);

    expect(inboundAgentMock.resolveInboundAgentConfig).not.toHaveBeenCalled();
    expect(engineMock.processBatch).toHaveBeenCalledWith(
      expect.objectContaining({ inboundPrompt: null, companyId: null })
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.meta.agente).toBe("tenant");
  });

  it("com instanceName (sem agentId): comportamento antigo intacto — busca por número, não por id", async () => {
    inboundAgentMock.resolveInboundAgentConfig.mockResolvedValue({
      companyId: "agente-por-numero",
      instanceName: "Chip 1",
      enabled: true,
      model: null,
      prompt: "Prompt deste número.",
      spinFields: [],
      webhookUrl: null,
      sdrPhone: null,
      sdrTransferEnabled: false,
      instructionsConsolidated: false,
      agentKind: "atendimento",
    });
    engineMock.processBatch.mockResolvedValue({ mensagem: "oi" });

    const handler = getRouteHandler("/api/chatbot-test");
    const req = { body: { clientId: "sonhare", message: "oi", instanceName: "Chip 1" } };
    const res = fakeRes();

    await handler(req, res);

    expect(inboundAgentMock.resolveInboundAgentConfig).toHaveBeenCalledWith({ supabase: {}, clientId: "sonhare", instanceName: "Chip 1" });
    expect(res.statusCode).toBe(200);
  });
});
