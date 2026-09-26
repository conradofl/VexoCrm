// backend/src/test/academyDiagnostics.test.js
//
// GET /api/academy/diagnostics — "o que falta neste tenant", lido do estado
// real. No máximo três linhas, cada uma levando à receita que resolve. Sem
// nada a apontar, a lista vem vazia — é o que deixa a faixa sumir na tela.

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

function getRouteHandler(deps, path, method = "get") {
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

function makeDeps({ staleLeadsCount = 0, clientId = "sonhare", overrides = {} } = {}) {
  const query = vi.fn(async (sql) => {
    if (sql.includes("FROM public.lead_import_items")) {
      return { rows: [{ n: staleLeadsCount }] };
    }
    return { rows: [] };
  });
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

describe("GET /api/academy/diagnostics", () => {
  it("[TESTE OBRIGATÓRIO] some quando não há o que apontar — abaixo do limiar, lista vazia", async () => {
    const deps = makeDeps({ staleLeadsCount: 2 });
    const handler = getRouteHandler(deps, "/api/academy/diagnostics");
    const res = fakeRes();
    await handler({ query: { clientId: "sonhare" } }, res);

    expect(res.body.lines).toEqual([]);
  });

  it("leads parados sem cadência acima do limiar leva à receita que resolve", async () => {
    const deps = makeDeps({ staleLeadsCount: 12 });
    const handler = getRouteHandler(deps, "/api/academy/diagnostics");
    const res = fakeRes();
    await handler({ query: { clientId: "sonhare" } }, res);

    expect(res.body.lines).toHaveLength(1);
    expect(res.body.lines[0].recipeId).toBe("recipe-recuperar-lead-frio");
    expect(res.body.lines[0].text).toContain("12");
  });

  it("no máximo três linhas", async () => {
    const deps = makeDeps({ staleLeadsCount: 999 });
    const handler = getRouteHandler(deps, "/api/academy/diagnostics");
    const res = fakeRes();
    await handler({ query: { clientId: "sonhare" } }, res);

    expect(res.body.lines.length).toBeLessThanOrEqual(3);
  });

  it("tenant não autorizado: nada é consultado", async () => {
    const deps = makeDeps({
      overrides: {
        resolveAuthorizedClientId: (req, res) => {
          res.statusCode = 403;
          res.body = { error: { code: "NO_CLIENT_ACCESS" } };
          return null;
        },
      },
    });
    const handler = getRouteHandler(deps, "/api/academy/diagnostics");
    const res = fakeRes();
    await handler({ query: { clientId: "outro-tenant" } }, res);

    expect(res.statusCode).toBe(403);
    expect(deps.pgDatabasePool.query).not.toHaveBeenCalled();
  });
});
