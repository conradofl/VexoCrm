// backend/src/test/agentInstructionAuditRoute.test.js
//
// GET /api/followup/companies/:id/instruction-audit — Commit 1 de
// "Um agente, um dono para cada texto". Só lê e descreve; não grava nada.
// Cobre autenticação/escopo de tenant (404, não 403 — convenção do módulo
// follow-up) e a composição real com fetchDynamicPrompt/fetchTemplate.

import { describe, expect, it, vi, beforeEach } from "vitest";

const supabaseMock = { from: vi.fn() };
vi.mock("../followup/db.js", () => ({
  query: vi.fn(),
  getSupabase: () => supabaseMock,
}));

const n8nSettingsMock = { getLeadClientN8nSettings: vi.fn() };
vi.mock("../services/n8nSettings.js", () => ({
  getLeadClientN8nSettings: (...args) => n8nSettingsMock.getLeadClientN8nSettings(...args),
}));

const engineMock = { fetchDynamicPrompt: vi.fn(), fetchTemplate: vi.fn() };
vi.mock("../chatbot-ai-engine.js", () => ({
  fetchDynamicPrompt: (...args) => engineMock.fetchDynamicPrompt(...args),
  fetchTemplate: (...args) => engineMock.fetchTemplate(...args),
}));

const { registerFollowupRoutes } = await import("../followup/routes.js");

function getRouteHandler(routePath, method) {
  let followupRouter = null;
  const fakeApp = {
    use: (path, router) => {
      if (path === "/api/followup") followupRouter = router;
    },
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  const noop = (req, res, next) => next?.();
  registerFollowupRoutes(fakeApp, noop, () => noop, noop);
  const layer = followupRouter.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  expect(layer, `rota ${method.toUpperCase()} ${routePath} não encontrada`).toBeDefined();
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; return this; },
  };
}

function adminAccess() {
  return { role: "internal", isAdmin: true, scopeMode: "all_clients", clientIds: [] };
}

function assignedAccess(clientIds) {
  return { role: "internal", isAdmin: false, scopeMode: "assigned_clients", clientIds };
}

function mockAgentRow(overrides = {}) {
  return {
    id: "agente-1",
    tenant_id: "geracao-digital",
    name: "Agente Atendimento",
    inbound_prompt: null,
    inbound_spin_fields: [{ name: "interesse", required: true }],
    inbound_model: null,
    ...overrides,
  };
}

describe("GET /companies/:id/instruction-audit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    n8nSettingsMock.getLeadClientN8nSettings.mockResolvedValue({ chatbot_model: "generico" });
    engineMock.fetchDynamicPrompt.mockResolvedValue("Prompt padrão do tenant.");
    engineMock.fetchTemplate.mockResolvedValue({
      template_key: "generico",
      data_fields: [{ key: "interesse", label: "Interesse", description: "..." }, { key: "telefone", label: "Telefone", description: "..." }],
      required_fields: ["interesse"],
    });
  });

  function mockSupabaseReturning(row) {
    supabaseMock.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }) }),
    });
  }

  it("agente existente, dentro do escopo: devolve o diagnóstico com o conflito real (telefone pedido pelo template, ausente na coleta)", async () => {
    mockSupabaseReturning(mockAgentRow());
    const handler = getRouteHandler("/companies/:id/instruction-audit", "get");
    const req = { params: { id: "agente-1" }, authAccess: adminAccess() };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.templateKeyEmUso).toBe("generico");
    expect(res.body.consolidated).toBe(false);
    expect(res.body.consolidatedAt).toBeNull();
    expect(res.body.audit.prompt.source).toBe("tenant"); // agente sem inbound_prompt próprio
    const conflito = res.body.audit.collection.conflicts.find((c) => c.field === "telefone");
    expect(conflito).toMatchObject({ emAgente: false, emTemplate: true });
  });

  it("agente já consolidado: a resposta expõe consolidated=true e o timestamp", async () => {
    mockSupabaseReturning(mockAgentRow({ instructions_consolidated_at: "2026-09-17T00:00:00Z" }));
    const handler = getRouteHandler("/companies/:id/instruction-audit", "get");
    const req = { params: { id: "agente-1" }, authAccess: adminAccess() };
    const res = fakeRes();

    await handler(req, res);

    expect(res.body.consolidated).toBe(true);
    expect(res.body.consolidatedAt).toBe("2026-09-17T00:00:00Z");
  });

  it("usa fetchDynamicPrompt/fetchTemplate com o tenant_id do AGENTE, não um valor solto", async () => {
    mockSupabaseReturning(mockAgentRow({ tenant_id: "sonhare" }));
    const handler = getRouteHandler("/companies/:id/instruction-audit", "get");
    const req = { params: { id: "agente-1" }, authAccess: adminAccess() };
    const res = fakeRes();

    await handler(req, res);

    expect(engineMock.fetchDynamicPrompt).toHaveBeenCalledWith(supabaseMock, "sonhare", "padrao");
    expect(engineMock.fetchTemplate).toHaveBeenCalledWith(supabaseMock, "sonhare", "generico");
    expect(n8nSettingsMock.getLeadClientN8nSettings).toHaveBeenCalledWith("sonhare");
  });

  it("agente inexistente -> 404", async () => {
    mockSupabaseReturning(null);
    const handler = getRouteHandler("/companies/:id/instruction-audit", "get");
    const req = { params: { id: "agente-fantasma" }, authAccess: adminAccess() };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
  });

  it("agente de outro tenant fora do escopo do usuário -> 404 (não 403 — convenção do módulo follow-up)", async () => {
    mockSupabaseReturning(mockAgentRow({ tenant_id: "sonhare" }));
    const handler = getRouteHandler("/companies/:id/instruction-audit", "get");
    const req = { params: { id: "agente-1" }, authAccess: assignedAccess(["geracao-digital"]) };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(engineMock.fetchDynamicPrompt).not.toHaveBeenCalled();
  });

  it("dentro do escopo (tenant do usuário bate com o do agente) -> passa normalmente", async () => {
    mockSupabaseReturning(mockAgentRow({ tenant_id: "geracao-digital" }));
    const handler = getRouteHandler("/companies/:id/instruction-audit", "get");
    const req = { params: { id: "agente-1" }, authAccess: assignedAccess(["geracao-digital"]) };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
  });
});

describe("POST /companies/:id/consolidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    n8nSettingsMock.getLeadClientN8nSettings.mockResolvedValue({ chatbot_model: "generico" });
    engineMock.fetchDynamicPrompt.mockResolvedValue("Prompt padrão longo e detalhado do tenant para atendimento geral.");
    engineMock.fetchTemplate.mockResolvedValue({
      template_key: "generico",
      data_fields: [{ key: "interesse", label: "Interesse", description: "..." }],
      required_fields: ["interesse"],
    });
  });

  it("[TESTE OBRIGATÓRIO] prompt vazio ou inválido: recusado com 400 e erros detalhados item por item, nada é gravado", async () => {
    const updateSpy = vi.fn();
    supabaseMock.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockAgentRow({ inbound_prompt: "curto" }), error: null }) }) }),
      update: updateSpy,
    });
    engineMock.fetchDynamicPrompt.mockResolvedValue(""); // tenant sem prompt também

    const handler = getRouteHandler("/companies/:id/consolidate", "post");
    const req = { params: { id: "agente-1" }, authAccess: adminAccess() };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("INVALID_AUTONOMOUS_PROMPT");
    expect(res.body.error.message).toContain("muito curto");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("[TESTE OBRIGATÓRIO] agente com prompt válido: consolida com sucesso e grava instructions_consolidated_at", async () => {
    const updatedRow = {
      id: "agente-1",
      inbound_prompt: "Você é o consultor de vendas oficial da empresa. Seu objetivo é qualificar leads com excelência.",
      inbound_spin_fields: [{ name: "interesse", required: true }],
      instructions_consolidated_at: "2026-10-10T14:00:00.000Z",
    };

    const updateSpy = vi.fn().mockReturnValue({
      eq: () => ({
        select: () => ({
          maybeSingle: () => Promise.resolve({ data: updatedRow, error: null }),
        }),
      }),
    });

    supabaseMock.from.mockImplementation((table) => {
      if (table === "followup_companies") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: mockAgentRow({
                    inbound_prompt: "Você é o consultor de vendas oficial da empresa. Seu objetivo é qualificar leads com excelência.",
                    instructions_consolidated_at: null,
                  }),
                  error: null,
                }),
            }),
          }),
          update: updateSpy,
        };
      }
      return {};
    });

    const handler = getRouteHandler("/companies/:id/consolidate", "post");
    const req = { params: { id: "agente-1" }, authAccess: adminAccess() };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.consolidated).toBe(true);
    expect(res.body.consolidatedAt).toBe("2026-10-10T14:00:00.000Z");
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions_consolidated_at: expect.any(String),
      })
    );
  });

  it("agente já consolidado -> 409", async () => {
    supabaseMock.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockAgentRow({ instructions_consolidated_at: "2026-10-10T10:00:00Z" }), error: null }) }) }),
    });

    const handler = getRouteHandler("/companies/:id/consolidate", "post");
    const req = { params: { id: "agente-1" }, authAccess: adminAccess() };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe("ALREADY_CONSOLIDATED");
  });
});

describe("POST /companies/:id/unconsolidate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("[TESTE OBRIGATÓRIO] 'Voltar ao template': limpa instructions_consolidated_at e devolve consolidated=false", async () => {
    const updateSpy = vi.fn().mockReturnValue({
      eq: () => ({
        select: () => ({
          maybeSingle: () => Promise.resolve({ data: { id: "agente-1", instructions_consolidated_at: null }, error: null }),
        }),
      }),
    });

    supabaseMock.from.mockImplementation((table) => {
      if (table === "followup_companies") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: mockAgentRow({ instructions_consolidated_at: "2026-10-10T14:00:00.000Z" }),
                  error: null,
                }),
            }),
          }),
          update: updateSpy,
        };
      }
      return {};
    });

    const handler = getRouteHandler("/companies/:id/unconsolidate", "post");
    const req = { params: { id: "agente-1" }, authAccess: adminAccess() };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.consolidated).toBe(false);
    expect(res.body.consolidatedAt).toBeNull();
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions_consolidated_at: null,
      })
    );
  });

  it("tentar desconsolidar agente que não está consolidado -> 400", async () => {
    supabaseMock.from.mockReturnValue({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: mockAgentRow({ instructions_consolidated_at: null }), error: null }) }) }),
    });

    const handler = getRouteHandler("/companies/:id/unconsolidate", "post");
    const req = { params: { id: "agente-1" }, authAccess: adminAccess() };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("NOT_CONSOLIDATED");
  });
});

