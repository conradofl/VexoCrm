// backend/src/test/followupCompanyExtractionPatch.test.js
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

describe("PATCH /api/followup/companies/:id — campos de extração", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.from.mockReset();
    evolutionMock.getLeadClientEvolutionInstances.mockResolvedValue([]);
  });

  it("PATCH com inbound_extraction_prompt e inbound_extraction_enabled grava no banco e retorna 200", async () => {
    let capturedUpdate = null;

    supabaseMock.from.mockImplementation((table) => {
      if (table === "followup_companies") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: { id: "agente-1", name: "Agente Closer", tenant_id: "tenant-a" },
                error: null,
              }),
            }),
          }),
          update: (payload) => {
            capturedUpdate = payload;
            return {
              eq: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({
                    data: { id: "agente-1", ...payload },
                    error: null,
                  }),
                }),
              }),
            };
          },
        };
      }
      return {};
    });

    const handler = getRouteHandler("/companies/:id", "patch");
    const req = {
      params: { id: "agente-1" },
      body: {
        inbound_extraction_enabled: true,
        inbound_extraction_prompt: "Ao qualificar, extrair faturamento e dor principal para o closer.",
      },
      authAccess: adminAccess(),
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(capturedUpdate).not.toBeNull();
    expect(capturedUpdate.inbound_extraction_enabled).toBe(true);
    expect(capturedUpdate.inbound_extraction_prompt).toBe(
      "Ao qualificar, extrair faturamento e dor principal para o closer."
    );
  });

  it("PATCH com apenas inbound_extraction_prompt atualiza o prompt sem afetar outros campos", async () => {
    let capturedUpdate = null;

    supabaseMock.from.mockImplementation((table) => {
      if (table === "followup_companies") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: { id: "agente-2", name: "Agente SDR", tenant_id: "tenant-b" },
                error: null,
              }),
            }),
          }),
          update: (payload) => {
            capturedUpdate = payload;
            return {
              eq: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({
                    data: { id: "agente-2", ...payload },
                    error: null,
                  }),
                }),
              }),
            };
          },
        };
      }
      return {};
    });

    const handler = getRouteHandler("/companies/:id", "patch");
    const req = {
      params: { id: "agente-2" },
      body: {
        inbound_extraction_prompt: "Novo prompt atualizado de extração",
      },
      authAccess: adminAccess(),
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(capturedUpdate).not.toBeNull();
    expect(capturedUpdate.inbound_extraction_prompt).toBe("Novo prompt atualizado de extração");
    expect("inbound_extraction_enabled" in capturedUpdate).toBe(false);
  });

  it("PATCH com apenas inbound_extraction_enabled atualiza a flag booleana", async () => {
    let capturedUpdate = null;

    supabaseMock.from.mockImplementation((table) => {
      if (table === "followup_companies") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => Promise.resolve({
                data: { id: "agente-3", name: "Agente Sem Extracao", tenant_id: "tenant-c" },
                error: null,
              }),
            }),
          }),
          update: (payload) => {
            capturedUpdate = payload;
            return {
              eq: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({
                    data: { id: "agente-3", ...payload },
                    error: null,
                  }),
                }),
              }),
            };
          },
        };
      }
      return {};
    });

    const handler = getRouteHandler("/companies/:id", "patch");
    const req = {
      params: { id: "agente-3" },
      body: {
        inbound_extraction_enabled: false,
      },
      authAccess: adminAccess(),
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(capturedUpdate).not.toBeNull();
    expect(capturedUpdate.inbound_extraction_enabled).toBe(false);
    expect("inbound_extraction_prompt" in capturedUpdate).toBe(false);
  });
});
