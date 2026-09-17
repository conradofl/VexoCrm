// backend/src/test/chipExclusivityRoute.test.js
//
// "Um chip pertence a um agente só" — Commit 3, ponta a ponta em POST/PATCH
// /api/followup/companies. Hoje evolution_instances é lista solta e nada
// impede dois agentes reivindicarem o mesmo chip. A partir daqui, salvar
// recusa nomeando quem já usa aquele chip.

import { describe, expect, it, vi, beforeEach } from "vitest";

const supabaseMock = { from: vi.fn() };
vi.mock("../followup/db.js", () => ({
  query: vi.fn(),
  getSupabase: () => supabaseMock,
}));

const evolutionMock = { getLeadClientEvolutionInstances: vi.fn() };
vi.mock("../services/evolution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    // expandChipAliases fica REAL — é a lógica de identidade de chip que o
    // teste quer exercitar de verdade, não uma simulação dela.
    getLeadClientEvolutionInstances: (...args) => evolutionMock.getLeadClientEvolutionInstances(...args),
  };
});

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

describe("POST /companies — exclusividade de chip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.from.mockReset();
    evolutionMock.getLeadClientEvolutionInstances.mockResolvedValue([]);
  });

  it("[TESTE OBRIGATÓRIO] dois agentes disputando o mesmo chip: o segundo é recusado, com o nome do primeiro na mensagem", async () => {
    const insertSpy = vi.fn();
    supabaseMock.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          is: () =>
            Promise.resolve({
              data: [{ id: "agente-1", name: "Atendimento Principal", evolution_instance: "Chip Vendas", evolution_instances: ["Chip Vendas"] }],
              error: null,
            }),
        }),
      }),
      insert: (payload) => {
        insertSpy(payload);
        return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "agente-2", ...payload }, error: null }) }) };
      },
    }));

    const handler = getRouteHandler("/companies", "post");
    const req = {
      body: { name: "Segundo Agente", evolution_instance: "Chip Vendas", tenant_id: "geracao-digital" },
      authAccess: adminAccess(),
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe("CHIP_ALREADY_OWNED");
    expect(res.body.error.message).toContain("Atendimento Principal");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("chip livre: cria normalmente", async () => {
    const insertSpy = vi.fn();
    supabaseMock.from.mockImplementation(() => ({
      select: () => ({ eq: () => ({ is: () => Promise.resolve({ data: [], error: null }) }) }),
      insert: (payload) => {
        insertSpy(payload);
        return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "agente-novo", ...payload }, error: null }) }) };
      },
    }));

    const handler = getRouteHandler("/companies", "post");
    const req = {
      body: { name: "Agente Livre", evolution_instance: "Chip Novo", tenant_id: "geracao-digital" },
      authAccess: adminAccess(),
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(201);
    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});

describe("PATCH /companies/:id — exclusividade de chip", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.from.mockReset();
    evolutionMock.getLeadClientEvolutionInstances.mockResolvedValue([]);
  });

  it("trocar pro chip de outro agente do mesmo tenant -> 409, não atualiza", async () => {
    const updateSpy = vi.fn();
    let chamada = 0;
    supabaseMock.from.mockImplementation(() => {
      chamada += 1;
      if (chamada === 1) {
        // fetch de existing (id, tenant_id) dentro do próprio handler PATCH
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "agente-2", tenant_id: "geracao-digital" }, error: null }) }) }) };
      }
      // checkChipExclusivity: lista de outros agentes do tenant
      return {
        select: () => ({
          eq: () => ({
            is: () =>
              Promise.resolve({
                data: [{ id: "agente-1", name: "Atendimento Principal", evolution_instance: "Chip Vendas", evolution_instances: ["Chip Vendas"] }],
                error: null,
              }),
          }),
        }),
        update: (patch) => {
          updateSpy(patch);
          return { eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "agente-2", ...patch }, error: null }) }) }) };
        },
      };
    });

    const handler = getRouteHandler("/companies/:id", "patch");
    const req = {
      params: { id: "agente-2" },
      body: { evolution_instance: "Chip Vendas" },
      authAccess: adminAccess(),
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe("CHIP_ALREADY_OWNED");
    expect(res.body.error.message).toContain("Atendimento Principal");
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("PATCH que não mexe em evolution_instances: exclusividade nem é checada, atualiza normal", async () => {
    const updateSpy = vi.fn();
    let chamada = 0;
    supabaseMock.from.mockImplementation(() => {
      chamada += 1;
      if (chamada === 1) {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "agente-2", tenant_id: "geracao-digital" }, error: null }) }) }) };
      }
      return {
        update: (patch) => {
          updateSpy(patch);
          return { eq: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "agente-2", ...patch }, error: null }) }) }) };
        },
      };
    });

    const handler = getRouteHandler("/companies/:id", "patch");
    const req = { params: { id: "agente-2" }, body: { name: "Nome Novo" }, authAccess: adminAccess() };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "Nome Novo" }));
    expect(evolutionMock.getLeadClientEvolutionInstances).not.toHaveBeenCalled();
  });
});
