// backend/src/test/followupCompanyTenantScope.test.js
//
// PATCH/DELETE /api/followup/companies/:id não checavam tenant_id — qualquer
// usuário autenticado (mesmo de outro tenant, não-admin) conseguia editar ou
// arquivar a empresa de followup de OUTRO tenant só sabendo o id. Sibling
// routes no mesmo arquivo (ex.: /campaigns/:id/upcoming) já seguem a
// convenção do módulo: 404, não 403 — nunca confirma que o recurso existe
// fora do escopo do usuário.

import { describe, expect, it, vi, beforeEach } from "vitest";

const supabaseMock = { from: vi.fn() };
vi.mock("../followup/db.js", () => ({
  query: vi.fn(),
  getSupabase: () => supabaseMock,
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
  const layer = followupRouter.stack.find(
    (l) => l.route && l.route.path === routePath && l.route.methods[method]
  );
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

function assignedAccess(clientIds) {
  return { role: "internal", isAdmin: false, scopeMode: "assigned_clients", clientIds };
}

// Simula os dois supabase.from() em sequência: 1º = SELECT de checagem de
// tenant, 2º = UPDATE de verdade. updateSpy prova se a escrita chegou a
// acontecer.
function mockFetchThenUpdate(fetchRow, updateSpy) {
  const fetchBuilder = {
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: fetchRow, error: null }) }) }),
  };
  const updateBuilder = {
    update: (patch) => {
      updateSpy(patch);
      return {
        eq: () => ({
          select: () => ({
            maybeSingle: () => Promise.resolve({ data: { id: fetchRow?.id, ...patch }, error: null }),
          }),
          is: () => ({
            select: () => ({
              maybeSingle: () => Promise.resolve({ data: { id: fetchRow?.id }, error: null }),
            }),
          }),
        }),
      };
    },
  };
  supabaseMock.from.mockReturnValueOnce(fetchBuilder).mockReturnValueOnce(updateBuilder);
}

describe("Escopo de tenant — PATCH/DELETE /companies/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks não esvazia a fila de mockReturnValueOnce — sem isso, um
    // retorno não consumido (ex.: teste anterior que parou no 404 antes do
    // 2º supabase.from()) vaza pro próximo teste e embaralha qual builder
    // cada chamada recebe.
    supabaseMock.from.mockReset();
  });

  it("PATCH em empresa de outro tenant -> 404 (não 403), e não atualiza a linha", async () => {
    const updateSpy = vi.fn();
    mockFetchThenUpdate({ id: "empresa-b", tenant_id: "tenant-b" }, updateSpy);
    const handler = getRouteHandler("/companies/:id", "patch");
    const req = {
      params: { id: "empresa-b" },
      body: { name: "Hackeada" },
      authAccess: assignedAccess(["tenant-a"]),
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("DELETE em empresa de outro tenant -> 404 (não 403), e não arquiva a linha", async () => {
    const updateSpy = vi.fn();
    mockFetchThenUpdate({ id: "empresa-b", tenant_id: "tenant-b", archived_at: null }, updateSpy);
    const handler = getRouteHandler("/companies/:id", "delete");
    const req = {
      params: { id: "empresa-b" },
      authAccess: assignedAccess(["tenant-a"]),
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ success: false, error: { code: "NOT_FOUND" } });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("PATCH em empresa do próprio tenant -> passa e atualiza normalmente", async () => {
    const updateSpy = vi.fn();
    mockFetchThenUpdate({ id: "empresa-a", tenant_id: "tenant-a" }, updateSpy);
    const handler = getRouteHandler("/companies/:id", "patch");
    const req = {
      params: { id: "empresa-a" },
      body: { name: "Nome Novo" },
      authAccess: assignedAccess(["tenant-a"]),
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ name: "Nome Novo" }));
  });

  it("DELETE em empresa do próprio tenant -> passa e arquiva normalmente", async () => {
    const updateSpy = vi.fn();
    mockFetchThenUpdate({ id: "empresa-a", tenant_id: "tenant-a", archived_at: null }, updateSpy);
    const handler = getRouteHandler("/companies/:id", "delete");
    const req = {
      params: { id: "empresa-a" },
      authAccess: assignedAccess(["tenant-a"]),
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ archived_at: expect.any(String) }));
  });
});
