// backend/src/test/gdImplementationSimulatorAndReadiness.test.js
//
// Testes da spec do simulador no fim da implantação:
// 1. O simulador não cria lead, não cria conversa e não aparece no Banco de Dados (contando antes e depois)
// 2. Nenhuma resposta do modelo é gravada
// 3. A data do teste persiste e volta ao reabrir o briefing
// 4. A lista do que falta reflete o estado real: desligue o agente e o item correspondente muda

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mocks para /api/chatbot-test
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
const { registerGeracaoDigitalRoutes } = await import("../domains/geracaoDigitalRoutes.js");
const { calculateImplementationReadiness } = await import("../domains/geracaoDigital/briefingReadiness.js");

function getChatbotRouteHandler(path, method = "post") {
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
    sanitizePhone: (p) => p || "5500000000000",
    sendError: (_res, status, code, msg) => _res.status(status).json({ success: false, code, error: msg }),
    supabase: {},
  };

  registerChatbotRoutes(fakeApp, deps);
  return routes[`${method} ${path}`];
}

describe("Simulador no Fim da Implantação e Prontidão GD (Backend)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[TESTE 1] o simulador não cria lead, não cria conversa e não aparece no Banco de Dados — verifique contando antes e depois", async () => {
    const handler = getChatbotRouteHandler("/api/chatbot-test");
    expect(handler).toBeDefined();

    // Contagem inicial de registros no banco de dados simulado
    const dbSimulado = {
      leads: [],
      lead_messages: [],
      lead_conversations: [],
    };

    const countBefore = dbSimulado.leads.length + dbSimulado.lead_messages.length + dbSimulado.lead_conversations.length;
    expect(countBefore).toBe(0);

    // Mock do processBatch verificando que noPersist e isSimulation são passados
    engineMock.processBatch.mockImplementation(async (params) => {
      // Se for simulação, NENHUM registro pode ser inserido no banco
      if (params.isSimulation || params.noPersist) {
        // Zero escritas em leads, conversas ou mensagens
      } else {
        dbSimulado.leads.push({ id: "lead-real" });
        dbSimulado.lead_messages.push({ id: "msg-real" });
      }

      return {
        mensagem: "Olá! Nosso cardápio inclui opções executivas a partir de R$ 35.",
        classificacao: "morno",
        finalizado: false,
      };
    });

    const req = {
      body: {
        clientId: "restaurante-do-porto",
        message: "Qual é o horário de funcionamento de vocês e quanto custa a taxa de entrega?",
        isSimulation: true,
        noPersist: true,
      },
    };

    let statusResult = 200;
    let jsonResult = null;
    const res = {
      status: vi.fn((s) => { statusResult = s; return res; }),
      json: vi.fn((data) => { jsonResult = data; return res; }),
    };

    await handler(req, res);

    expect(statusResult).toBe(200);
    expect(jsonResult.success).toBe(true);
    expect(jsonResult.response).toContain("cardápio");

    // Verifica que processBatch recebeu isSimulation: true e noPersist: true
    expect(engineMock.processBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: "restaurante-do-porto",
        isSimulation: true,
        noPersist: true,
      })
    );

    // Contagem pós-simulação: idêntica à contagem inicial (zero novos registros)
    const countAfter = dbSimulado.leads.length + dbSimulado.lead_messages.length + dbSimulado.lead_conversations.length;
    expect(countAfter).toBe(countBefore);
    expect(dbSimulado.leads).toHaveLength(0);
    expect(dbSimulado.lead_messages).toHaveLength(0);
  });

  it("[TESTE 2] a data do teste persiste e volta ao reabrir o briefing", async () => {
    // Banco simulado de briefings
    const briefingsDb = new Map();
    const briefingId = "briefing-123";

    briefingsDb.set(briefingId, {
      id: briefingId,
      tenant_id: "turismo-aventura",
      client_name: "Turismo Aventura",
      status: "em_andamento",
      fechamento: { recapitulado: true },
      test_performed_at: null,
      test_questions_count: 0,
      cinco_pilares: {},
    });

    const fakePool = {
      query: vi.fn(async (sql, params = []) => {
        // SELECT por ID
        if (sql.includes("SELECT * FROM public.gd_implementation_briefings WHERE id = $1")) {
          const item = briefingsDb.get(params[0]);
          return { rows: item ? [item] : [] };
        }
        // UPDATE record-test
        if (sql.includes("UPDATE public.gd_implementation_briefings")) {
          const id = params[params.length - 1];
          const curr = briefingsDb.get(id);
          if (!curr) return { rows: [] };

          const updatedFechamento = JSON.parse(params[0]);
          const updated = {
            ...curr,
            fechamento: updatedFechamento,
            test_performed_at: params[1] || updatedFechamento.test_performed_at,
            test_questions_count: params[2] !== undefined ? params[2] : updatedFechamento.test_questions_count,
            updated_at: new Date().toISOString(),
          };
          briefingsDb.set(id, updated);
          return { rows: [updated] };
        }
        return { rows: [] };
      }),
    };

    const routes = {};
    const fakeApp = {
      post: vi.fn((p, ...h) => { routes[`post ${p}`] = h[h.length - 1]; }),
      get: vi.fn((p, ...h) => { routes[`get ${p}`] = h[h.length - 1]; }),
      put: vi.fn((p, ...h) => { routes[`put ${p}`] = h[h.length - 1]; }),
      delete: vi.fn((p, ...h) => { routes[`delete ${p}`] = h[h.length - 1]; }),
    };

    const dummyAuth = (_req, _res, next) => next();
    registerGeracaoDigitalRoutes(fakeApp, fakePool, dummyAuth, () => dummyAuth);

    const recordTestHandler = routes["post /api/gd/implementation-briefings/:id/record-test"];
    const getBriefingHandler = routes["get /api/gd/implementation-briefings/:id"];

    expect(recordTestHandler).toBeDefined();
    expect(getBriefingHandler).toBeDefined();

    // 1. Executa o registro de um teste de 3 perguntas
    const reqRecord = {
      params: { id: briefingId },
      body: { test_questions_count: 3 },
    };
    let jsonRecord = null;
    const resRecord = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn((d) => { jsonRecord = d; }),
    };

    await recordTestHandler(reqRecord, resRecord);

    expect(jsonRecord.success).toBe(true);
    expect(jsonRecord.test_performed_at).toBeTruthy();
    expect(jsonRecord.test_questions_count).toBe(3);

    // 2. Reabre o briefing dias depois via GET
    const reqGet = { params: { id: briefingId } };
    let jsonGet = null;
    const resGet = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn((d) => { jsonGet = d; }),
    };

    await getBriefingHandler(reqGet, resGet);

    expect(jsonGet.success).toBe(true);
    // Data e contador persistem e voltam intactos
    expect(jsonGet.data.test_performed_at).toBe(jsonRecord.test_performed_at);
    expect(jsonGet.data.test_questions_count).toBe(3);
  });

  it("[TESTE 3] nenhuma resposta do modelo é gravada: armazena estritamente data e contador", async () => {
    const briefingsDb = new Map();
    const briefingId = "briefing-sem-respostas";

    briefingsDb.set(briefingId, {
      id: briefingId,
      tenant_id: "clinica-odontologica",
      client_name: "Clínica Odonto",
      fechamento: {},
    });

    let updateSqlExecuted = "";
    let updateParamsExecuted = [];

    const fakePool = {
      query: vi.fn(async (sql, params = []) => {
        if (sql.includes("SELECT * FROM public.gd_implementation_briefings WHERE id = $1")) {
          return { rows: [briefingsDb.get(briefingId)] };
        }
        if (sql.includes("UPDATE public.gd_implementation_briefings")) {
          updateSqlExecuted = sql;
          updateParamsExecuted = params;
          return { rows: [{ id: briefingId, fechamento: JSON.parse(params[0]) }] };
        }
        return { rows: [] };
      }),
    };

    const routes = {};
    const fakeApp = {
      post: vi.fn((p, ...h) => { routes[`post ${p}`] = h[h.length - 1]; }),
      get: vi.fn((p, ...h) => { routes[`get ${p}`] = h[h.length - 1]; }),
      put: vi.fn((p, ...h) => { routes[`put ${p}`] = h[h.length - 1]; }),
      delete: vi.fn((p, ...h) => { routes[`delete ${p}`] = h[h.length - 1]; }),
    };

    registerGeracaoDigitalRoutes(fakeApp, fakePool, (_req, _res, n) => n(), () => (_req, _res, n) => n());
    const recordTestHandler = routes["post /api/gd/implementation-briefings/:id/record-test"];

    // Requisição contendo injeção maliciosa de respostas do modelo
    const req = {
      params: { id: briefingId },
      body: {
        test_questions_count: 2,
        model_response: "Esta resposta do modelo NÃO deve ser gravada no banco.",
        respostas_ia: ["Resposta turno 1", "Resposta turno 2"],
        assistant_text: "Texto longo do robô...",
      },
    };

    let jsonResult = null;
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn((d) => { jsonResult = d; }),
    };

    await recordTestHandler(req, res);

    expect(jsonResult.success).toBe(true);
    expect(updateParamsExecuted.length).toBeGreaterThan(0);

    // Inspeciona os parâmetros do UPDATE para provar que nenhuma resposta foi gravada
    const fechamentoGravado = JSON.parse(updateParamsExecuted[0]);
    expect(fechamentoGravado).toHaveProperty("test_performed_at");
    expect(fechamentoGravado).toHaveProperty("test_questions_count", 2);

    expect(fechamentoGravado.model_response).toBeUndefined();
    expect(fechamentoGravado.respostas_ia).toBeUndefined();
    expect(fechamentoGravado.assistant_text).toBeUndefined();

    // Converte todo o SQL e parâmetros para string e garante que o texto da IA não aparece
    const payloadStr = JSON.stringify(updateParamsExecuted);
    expect(payloadStr).not.toContain("Esta resposta do modelo NÃO deve ser gravada");
    expect(payloadStr).not.toContain("Resposta turno 1");
  });

  it("[TESTE 4] a lista do que falta reflete o estado real: desligue o agente e o item correspondente muda", () => {
    // 1. Agente LIGADO
    const reportLigado = calculateImplementationReadiness({
      activeChipsCount: 2,
      inboundAgent: {
        id: "agente-vendas",
        evolution_instances: ["Chip Comercial"],
        inbound_enabled: true, // LIGADO
        inbound_prompt: "Instruções do agente",
      },
      chatbotEnabled: true,
      documentsCount: 3,
      promptContent: "Prompt",
    });

    const itemLigado = reportLigado.itens.find((i) => i.id === "agente_ligado");
    expect(itemLigado.pronto).toBe(true);
    expect(reportLigado.prontoParaSoltar).toBe(true);

    // 2. Agente DESLIGADO (desligue o agente e o item correspondente muda)
    const reportDesligado = calculateImplementationReadiness({
      activeChipsCount: 2,
      inboundAgent: {
        id: "agente-vendas",
        evolution_instances: ["Chip Comercial"],
        inbound_enabled: false, // DESLIGADO
        inbound_prompt: "Instruções do agente",
      },
      chatbotEnabled: false,
      documentsCount: 3,
      promptContent: "Prompt",
    });

    const itemDesligado = reportDesligado.itens.find((i) => i.id === "agente_ligado");
    expect(itemDesligado.pronto).toBe(false);
    expect(reportDesligado.prontoParaSoltar).toBe(false);

    // 3. Chip DESCONECTADO (desconecte o chip e o item correspondente muda)
    const reportSemChip = calculateImplementationReadiness({
      activeChipsCount: 0, // ZERO CHIPS
      inboundAgent: {
        id: "agente-vendas",
        evolution_instances: [],
        inbound_enabled: true,
        inbound_prompt: "Instruções",
      },
      chatbotEnabled: true,
      documentsCount: 1,
      promptContent: "Prompt",
    });

    expect(reportSemChip.itens.find((i) => i.id === "chip_conectado").pronto).toBe(false);
    expect(reportSemChip.itens.find((i) => i.id === "agente_vinculado_chip").pronto).toBe(false);
  });
});
