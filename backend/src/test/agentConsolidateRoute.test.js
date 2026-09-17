// backend/src/test/agentConsolidateRoute.test.js
//
// POST /api/followup/companies/:id/consolidate — "Um agente, um dono para
// cada texto", Commit 2. Grava no agente o prompt efetivo de hoje e a UNIÃO
// dos campos (agente + template), marca instructions_consolidated_at.
// Ação de mão única: agente já consolidado recusa com 409.

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
    inbound_prompt: null,
    inbound_spin_fields: [{ name: "orcamento", required: true }],
    instructions_consolidated_at: null,
    ...overrides,
  };
}

describe("POST /companies/:id/consolidate", () => {
  let updateCalls;

  beforeEach(() => {
    vi.clearAllMocks();
    updateCalls = [];
    n8nSettingsMock.getLeadClientN8nSettings.mockResolvedValue({ chatbot_model: "generico" });
    engineMock.fetchDynamicPrompt.mockResolvedValue("Prompt padrão do tenant.");
    engineMock.fetchTemplate.mockResolvedValue({
      template_key: "generico",
      data_fields: [{ key: "orcamento", label: "Orçamento", description: "..." }, { key: "telefone", label: "Telefone", description: "..." }],
      required_fields: [],
    });
  });

  function mockSupabase(row) {
    supabaseMock.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }) }),
      update: (patch) => {
        updateCalls.push(patch);
        return {
          eq: (col, val) => {
            expect(col).toBe("id");
            expect(val).toBe(row.id); // nunca atualiza outra linha
            return {
              select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: row.id, ...patch }, error: null }) }),
            };
          },
        };
      },
    }));
  }

  it("[TESTE OBRIGATÓRIO] agente com prompt próprio ausente: consolida com o prompt EFETIVO (do tenant) e a UNIÃO dos campos (agente + template)", async () => {
    mockSupabase(mockAgentRow({ inbound_prompt: null }));
    const handler = getRouteHandler("/companies/:id/consolidate", "post");
    const req = { params: { id: "agente-1" }, authAccess: adminAccess() };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.consolidatedAt).toBeTruthy();

    const patch = updateCalls[0];
    expect(patch.inbound_prompt).toBe("Prompt padrão do tenant.");
    expect(patch.instructions_consolidated_at).toBeTruthy();
    const nomes = patch.inbound_spin_fields.map((f) => f.name).sort();
    expect(nomes).toEqual(["orcamento", "telefone"]); // já tinha orcamento, ganhou telefone do template
  });

  it("[TESTE OBRIGATÓRIO] prompt efetivo vazio (agente sem prompt próprio, tenant sem prompt padrão) -> recusa, nada é gravado, nada é marcado", async () => {
    engineMock.fetchDynamicPrompt.mockResolvedValue(null); // tenant também não tem prompt
    mockSupabase(mockAgentRow({ inbound_prompt: null }));
    const handler = getRouteHandler("/companies/:id/consolidate", "post");
    const req = { params: { id: "agente-1" }, authAccess: adminAccess() };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("EMPTY_EFFECTIVE_PROMPT");
    expect(res.body.error.message).toContain("Escreva o prompt deste agente antes de consolidar");
    expect(updateCalls).toHaveLength(0); // inbound_prompt continua como estava, instructions_consolidated_at continua nulo
  });

  it("agente já consolidado -> 409, nunca escreve de novo", async () => {
    mockSupabase(mockAgentRow({ instructions_consolidated_at: "2026-09-01T00:00:00Z" }));
    const handler = getRouteHandler("/companies/:id/consolidate", "post");
    const req = { params: { id: "agente-1" }, authAccess: adminAccess() };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(updateCalls).toHaveLength(0);
  });

  it("agente inexistente -> 404", async () => {
    mockSupabase(null);
    const handler = getRouteHandler("/companies/:id/consolidate", "post");
    const req = { params: { id: "fantasma" }, authAccess: adminAccess() };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
  });

  it("agente de outro tenant fora do escopo -> 404, nunca escreve", async () => {
    mockSupabase(mockAgentRow({ tenant_id: "sonhare" }));
    const handler = getRouteHandler("/companies/:id/consolidate", "post");
    const req = { params: { id: "agente-1" }, authAccess: assignedAccess(["geracao-digital"]) };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(updateCalls).toHaveLength(0);
  });
});
