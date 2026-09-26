// backend/src/test/academyRecipeUsage.test.js
//
// POST /api/academy/recipe-usage — "sem isso não há como saber qual receita
// serve". Cada chamada é uma linha nova (histórico, não contador), e as três
// ações (abriu/copiou/instalou) precisam ficar distinguíveis.

import { describe, expect, it, vi } from "vitest";
import { registerAcademyRoutes } from "../domains/academy/routes.js";

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; this.statusCode = this.statusCode || 200; return this; },
  };
}

function getRouteHandler(deps, path, method = "post") {
  const routes = {};
  const fakeApp = {
    get: (p, ...handlers) => { routes[`get ${p}`] = handlers[handlers.length - 1]; },
    post: (p, ...handlers) => { routes[`post ${p}`] = handlers[handlers.length - 1]; },
    patch: (p, ...handlers) => { routes[`patch ${p}`] = handlers[handlers.length - 1]; },
    delete: (p, ...handlers) => { routes[`delete ${p}`] = handlers[handlers.length - 1]; },
    put: (p, ...handlers) => { routes[`put ${p}`] = handlers[handlers.length - 1]; },
  };
  registerAcademyRoutes(fakeApp, deps);
  const handler = routes[`${method} ${path}`];
  expect(handler, `rota ${method.toUpperCase()} ${path} não encontrada`).toBeDefined();
  return handler;
}

function makeDeps({ clientId = "sonhare", overrides = {} } = {}) {
  const query = vi.fn(async () => ({ rows: [] }));
  return {
    ensureDb: () => true,
    normalizeString: (s) => String(s || "").trim(),
    pgDatabasePool: { query },
    requireFirebaseAuth: (req, res, next) => next(),
    resolveAuthorizedClientId: (req, res) => clientId,
    sendError: vi.fn((res, status, code, message) => {
      res.statusCode = status;
      res.body = { error: { code, message } };
    }),
    ...overrides,
  };
}

describe("POST /api/academy/recipe-usage", () => {
  it("[TESTE OBRIGATÓRIO] registra as três ações, cada uma sua própria linha — abriu não é a mesma coisa que instalou", async () => {
    const deps = makeDeps();
    const handler = getRouteHandler(deps, "/api/academy/recipe-usage");

    for (const action of ["opened", "copied", "installed"]) {
      const res = fakeRes();
      await handler({ body: { clientId: "sonhare", recipeId: "recipe-recuperar-lead-frio", action } }, res);
      expect(res.statusCode).toBe(201);
    }

    expect(deps.pgDatabasePool.query).toHaveBeenCalledTimes(3);
    const actionsLogged = deps.pgDatabasePool.query.mock.calls.map((c) => c[1][2]);
    expect(actionsLogged).toEqual(["opened", "copied", "installed"]);

    // toda chamada usa INSERT — nunca UPDATE/UPSERT. Uma linha por ação, não
    // um contador que a segunda chamada sobrescreve.
    for (const call of deps.pgDatabasePool.query.mock.calls) {
      expect(call[0]).toMatch(/^\s*INSERT INTO public\.academy_recipe_usage/);
    }
  });

  it("action fora do enum é recusada antes de tocar o banco", async () => {
    const deps = makeDeps();
    const handler = getRouteHandler(deps, "/api/academy/recipe-usage");
    const res = fakeRes();
    await handler({ body: { clientId: "sonhare", recipeId: "recipe-x", action: "excluiu" } }, res);

    expect(res.statusCode).toBe(400);
    expect(deps.pgDatabasePool.query).not.toHaveBeenCalled();
  });

  it("recipeId ausente é recusado antes de tocar o banco", async () => {
    const deps = makeDeps();
    const handler = getRouteHandler(deps, "/api/academy/recipe-usage");
    const res = fakeRes();
    await handler({ body: { clientId: "sonhare", action: "opened" } }, res);

    expect(res.statusCode).toBe(400);
    expect(deps.pgDatabasePool.query).not.toHaveBeenCalled();
  });

  it("tenant não autorizado: nada é gravado", async () => {
    const deps = makeDeps({
      overrides: {
        resolveAuthorizedClientId: (req, res) => {
          res.statusCode = 403;
          res.body = { error: { code: "NO_CLIENT_ACCESS" } };
          return null;
        },
      },
    });
    const handler = getRouteHandler(deps, "/api/academy/recipe-usage");
    const res = fakeRes();
    await handler({ body: { clientId: "outro-tenant", recipeId: "recipe-x", action: "opened" } }, res);

    expect(res.statusCode).toBe(403);
    expect(deps.pgDatabasePool.query).not.toHaveBeenCalled();
  });
});
