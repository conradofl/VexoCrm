// backend/src/test/sdrRotationNextRoute.test.js
//
// GET /api/lead-clients/:tenantId/sdr-rotation-next — "escolhido o rodízio,
// a lista mostra quem é o próximo". Pura leitura: nunca avança o cursor.

import { describe, expect, it, vi } from "vitest";
import { registerIntegrationsRoutes } from "../domains/integrations/routes.js";

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
  registerIntegrationsRoutes(fakeApp, deps);
  const handler = routes[`${method} ${path}`];
  expect(handler, `rota ${method.toUpperCase()} ${path} não encontrada`).toBeDefined();
  return handler;
}

function makeDeps({ n8nSettings, poolRows = [], clientId = "sonhare", overrides = {} } = {}) {
  const query = vi.fn(async (sql) => {
    if (sql.includes("SELECT cursor FROM public.sdr_rotation_state")) {
      return { rows: poolRows };
    }
    return { rows: [] };
  });
  return {
    deleteLeadClientEvolutionInstance: vi.fn(),
    ensureDb: () => true,
    getLeadClientEvolutionInstances: vi.fn(async () => []),
    getLeadClientN8nSettings: vi.fn(async () => n8nSettings),
    isMaskedSecretPlaceholder: () => false,
    isMissingSchemaError: () => false,
    leadsTableName: () => "leads",
    maskEvolutionInstance: (i) => i,
    maskN8nSettings: (s) => s,
    normalizeHttpUrl: (u) => u,
    normalizeString: (s) => String(s || "").trim(),
    normalizeTenantKey: (k) => String(k || "").trim(),
    parseEvolutionWebhookEndpoint: () => ({}),
    parseOptionalUuid: (s) => ({ value: s || null, error: null }),
    pgDatabasePool: { query },
    provisionLeadClientEvolutionInstance: vi.fn(),
    requireAdminAccess: () => (req, res, next) => next(),
    requireAnyInternalPageAccess: () => (req, res, next) => next(),
    requireAppViewAccess: () => (req, res, next) => next(),
    requireFirebaseAuth: (req, res, next) => next(),
    resolveAuthorizedClientId: (req, res) => clientId,
    sendError: vi.fn((res, status, code, message) => {
      res.statusCode = status;
      res.body = { error: { code, message } };
    }),
    supabase: {},
    upsertLeadClientEvolutionInstance: vi.fn(),
    upsertLeadClientN8nSettings: vi.fn(),
    ...overrides,
  };
}

describe("GET /api/lead-clients/:tenantId/sdr-rotation-next", () => {
  it("[TESTE OBRIGATÓRIO] sem linha de rodízio ainda (rodízio nunca usado): o próximo é o primeiro da lista", async () => {
    const deps = makeDeps({
      n8nSettings: { sdr_whatsapp_numbers: ["5534910000001", "5534910000002"] },
      poolRows: [],
    });
    const handler = getRouteHandler(deps, "/api/lead-clients/:tenantId/sdr-rotation-next");
    const res = fakeRes();
    await handler({ params: { tenantId: "sonhare" } }, res);

    expect(res.body.next).toBe("5534910000001");
  });

  it("[TESTE OBRIGATÓRIO] com cursor gravado, o próximo é o SEGUINTE — leitura nunca avança o cursor", async () => {
    const deps = makeDeps({
      n8nSettings: { sdr_whatsapp_numbers: ["5534910000001", "5534910000002", "5534910000003"] },
      poolRows: [{ cursor: 0 }], // último usado foi o índice 0
    });
    const handler = getRouteHandler(deps, "/api/lead-clients/:tenantId/sdr-rotation-next");
    const res = fakeRes();
    await handler({ params: { tenantId: "sonhare" } }, res);

    expect(res.body.next).toBe("5534910000002");

    // chamar de novo devolve o MESMO número — prova que a leitura não escreveu nada
    const res2 = fakeRes();
    await handler({ params: { tenantId: "sonhare" } }, res2);
    expect(res2.body.next).toBe("5534910000002");
  });

  it("lista vazia: próximo é null, sem consultar o cursor", async () => {
    const deps = makeDeps({ n8nSettings: { sdr_whatsapp_numbers: [] }, poolRows: [] });
    const handler = getRouteHandler(deps, "/api/lead-clients/:tenantId/sdr-rotation-next");
    const res = fakeRes();
    await handler({ params: { tenantId: "sonhare" } }, res);

    expect(res.body.next).toBeNull();
  });

  it("escopo de tenant: sem autorização, nada é devolvido", async () => {
    const deps = makeDeps({
      n8nSettings: { sdr_whatsapp_numbers: ["5534910000001"] },
      overrides: {
        resolveAuthorizedClientId: (req, res) => {
          res.statusCode = 403;
          res.body = { error: { code: "NO_CLIENT_ACCESS" } };
          return null;
        },
      },
    });
    const handler = getRouteHandler(deps, "/api/lead-clients/:tenantId/sdr-rotation-next");
    const res = fakeRes();
    await handler({ params: { tenantId: "outro-tenant" } }, res);

    expect(res.statusCode).toBe(403);
    expect(deps.getLeadClientN8nSettings).not.toHaveBeenCalled();
  });
});
