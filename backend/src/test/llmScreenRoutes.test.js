// A tela nao mostra o que nao pode chamar, e diz quando a chave de IA quebrou.
//
// Rota testada de verdade; o motor e dublado porque o que esta sob teste aqui e
// o mapeamento da rota (o motor tem testes proprios em llmFailureSurfacing).

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../services/inboundAgent.js", () => ({
  resolveInboundAgentConfig: vi.fn(async () => null),
  buildSpinInstruction: () => "",
  fireInboundCompletionWebhook: vi.fn(),
}));

const engineMock = { processBatch: vi.fn(), status: {} };
vi.mock("../chatbot-ai-engine.js", () => ({
  processBatch: (...args) => engineMock.processBatch(...args),
  bufferMessage: vi.fn(),
  resolveMessageContent: vi.fn(),
  isFirstCampaignReply: vi.fn(),
  extractBriefingWithAI: vi.fn(),
  LLM_MODELS: [
    { id: "gemini-flash-latest", name: "Gemini Flash", provider: "gemini", providerName: "Gemini / Google" },
    { id: "openai/gpt-oss-120b", name: "GPT-OSS 120B (Groq)", provider: "groq", providerName: "Groq" },
    { id: "claude-3-5-haiku-20241022", name: "Claude 3.5 Haiku", provider: "anthropic", providerName: "Claude / Anthropic" },
  ],
  getLlmProviderStatus: vi.fn(() => engineMock.status),
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

beforeEach(() => {
  vi.clearAllMocks();
  engineMock.status = { groq: true, gemini: true, openai: false, anthropic: false };
});

describe("GET /api/chatbot-llm-models", () => {
  it("so devolve modelo de provedor com chave", async () => {
    const res = fakeRes();
    await getRouteHandler("/api/chatbot-llm-models", "get")({}, res);
    expect(res.body.models.map((m) => m.provider)).toEqual(["gemini", "groq"]);
    expect(res.body.providerStatus).toEqual(engineMock.status);
  });

  it("sem a chave do Gemini, o Gemini some da lista", async () => {
    engineMock.status = { groq: true, gemini: false, openai: false, anthropic: false };
    const res = fakeRes();
    await getRouteHandler("/api/chatbot-llm-models", "get")({}, res);
    expect(res.body.models.map((m) => m.id)).toEqual(["openai/gpt-oss-120b"]);
  });
});

describe("POST /api/chatbot-test diz a causa da falha", () => {
  const req = () => ({ body: { clientId: "sonhare", message: "oi" } });

  it("credencial quebrada: 503 com codigo proprio, nunca 'Prompt não configurado'", async () => {
    engineMock.processBatch.mockImplementation(async ({ diagnosticoIa }) => {
      Object.assign(diagnosticoIa, {
        code: "LLM_CREDENTIAL_INVALID",
        provedores: ["gemini"],
        mensagem: "Credencial invalida no provedor gemini. Troque a chave no EasyPanel.",
      });
      return null;
    });
    const res = fakeRes();
    await getRouteHandler("/api/chatbot-test")(req(), res);

    expect(res.statusCode).toBe(503);
    expect(res.body.code).toBe("LLM_CREDENTIAL_INVALID");
    expect(res.body.reason).toMatch(/credencial invalida no provedor gemini/i);
    expect(JSON.stringify(res.body)).not.toMatch(/Prompt não configurado/);
  });

  it("cota em todos os degraus: 429 LLM_QUOTA_EXCEEDED com o modelo", async () => {
    engineMock.processBatch.mockImplementation(async ({ diagnosticoIa }) => {
      Object.assign(diagnosticoIa, { code: "LLM_QUOTA_EXCEEDED", mensagem: "A cota de IA do modelo x acabou.", modelo: "x", limiteTpm: 8000 });
      return null;
    });
    const res = fakeRes();
    await getRouteHandler("/api/chatbot-test")(req(), res);

    expect(res.statusCode).toBe(429);
    expect(res.body.code).toBe("LLM_QUOTA_EXCEEDED");
    expect(res.body.quota.modelo).toBe("x");
  });

  it("sem diagnostico, o comportamento antigo fica: 502 com o motivo de sempre", async () => {
    engineMock.processBatch.mockResolvedValue(null);
    const res = fakeRes();
    await getRouteHandler("/api/chatbot-test")(req(), res);
    expect(res.statusCode).toBe(502);
    expect(res.body.code).toBe("CHATBOT_NOT_CONFIGURED");
  });

  it("resposta que veio de outro provedor ganha aviso de chave quebrada", async () => {
    engineMock.processBatch.mockResolvedValue({ mensagem: "Oi!", _credenciaisQuebradas: ["gemini"] });
    const res = fakeRes();
    await getRouteHandler("/api/chatbot-test")(req(), res);

    expect(res.body.success).toBe(true);
    expect(res.body.response).toBe("Oi!");
    expect(res.body.avisos.join(" ")).toMatch(/Credencial inválida no provedor gemini/);
  });
});
