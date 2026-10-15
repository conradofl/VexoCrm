import { describe, expect, it, vi } from "vitest";
import { registerIntegrationsRoutes } from "../domains/integrations/routes.js";
import { resolveAuthorizedClientId } from "../services/tenant.js";

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) {
      this.statusCode = s;
      return this;
    },
    json(b) {
      this.body = b;
      this.statusCode = this.statusCode || 200;
      return this;
    },
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

function makeDeps({ upsertResult = {}, existingSettings = {} } = {}) {
  const upsertLeadClientN8nSettings = vi.fn(async () => upsertResult);
  const getLeadClientN8nSettings = vi.fn(async () => existingSettings);

  const supabase = {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "nous-gestao" }, error: null }),
      insert: vi.fn().mockReturnThis(),
      catch: vi.fn().mockResolvedValue({}),
    })),
  };

  return {
    ensureDb: () => true,
    getLeadClientEvolutionInstances: vi.fn(async () => []),
    getLeadClientN8nSettings,
    upsertLeadClientN8nSettings,
    maskN8nSettings: (s) => s,
    normalizeString: (s) => String(s || "").trim(),
    normalizeTenantKey: (k) => String(k || "").trim().toLowerCase(),
    parseOptionalUuid: (s) => ({ value: s || null, error: null }),
    pgDatabasePool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
    requireAdminAccess: () => (req, res, next) => next(),
    requireAnyInternalPageAccess: () => (req, res, next) => next(),
    requireAppViewAccess: () => (req, res, next) => next(),
    requireFirebaseAuth: (req, res, next) => next(),
    resolveAuthorizedClientId,
    sendError: (res, status, code, message) => {
      res.status(status).json({ code, error: { code, message } });
    },
    supabase,
  };
}

describe("autonomia do gestor para n8n-settings (chips, agente IA e horários)", () => {
  it("permite que o gestor do tenant salve as configurações do agente e chips", async () => {
    const deps = makeDeps({ upsertResult: { chatbot_instances: ["chip-1"] } });
    const patchHandler = getRouteHandler(deps, "/api/lead-clients/:tenantId/n8n-settings", "patch");

    const req = {
      params: { tenantId: "nous-gestao" },
      body: { chatbot_instances: ["chip-1"], chatbot_enabled: true },
      authAccess: {
        role: "internal",
        isAdmin: false,
        accessPreset: "gestor",
        scopeMode: "assigned_clients",
        clientIds: ["nous-gestao"],
        permissions: ["dashboard.view", "users.manage"],
      },
    };
    const res = fakeRes();

    await patchHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(deps.upsertLeadClientN8nSettings).toHaveBeenCalledWith(
      "nous-gestao",
      req.body,
      req.authAccess,
      expect.anything()
    );
  });

  it("bloqueia operador do mesmo tenant que não tem perfil de gestor ou admin", async () => {
    const deps = makeDeps();
    const patchHandler = getRouteHandler(deps, "/api/lead-clients/:tenantId/n8n-settings", "patch");

    const req = {
      params: { tenantId: "nous-gestao" },
      body: { chatbot_enabled: true },
      authAccess: {
        role: "internal",
        isAdmin: false,
        accessPreset: "operador",
        scopeMode: "assigned_clients",
        clientIds: ["nous-gestao"],
        permissions: ["whatsapp.view", "whatsapp.reply"],
      },
    };
    const res = fakeRes();

    await patchHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.code || res.body.error?.code).toBe("FORBIDDEN");
    expect(deps.upsertLeadClientN8nSettings).not.toHaveBeenCalled();
  });

  it("bloqueia gestor de outro tenant tentando alterar tenant alheio (cross-tenant)", async () => {
    const deps = makeDeps();
    const patchHandler = getRouteHandler(deps, "/api/lead-clients/:tenantId/n8n-settings", "patch");

    const req = {
      params: { tenantId: "spazio-design" },
      body: { chatbot_enabled: true },
      authAccess: {
        role: "internal",
        isAdmin: false,
        accessPreset: "gestor",
        scopeMode: "assigned_clients",
        clientIds: ["nous-gestao"],
        permissions: ["dashboard.view", "users.manage"],
      },
    };
    const res = fakeRes();

    await patchHandler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.code || res.body.error?.code).toBe("FORBIDDEN_CLIENT_SCOPE");
    expect(deps.upsertLeadClientN8nSettings).not.toHaveBeenCalled();
  });

  it("permite que o Admin Global Vexo altere qualquer tenant", async () => {
    const deps = makeDeps({ upsertResult: { chatbot_enabled: true } });
    const patchHandler = getRouteHandler(deps, "/api/lead-clients/:tenantId/n8n-settings", "patch");

    const req = {
      params: { tenantId: "nous-gestao" },
      body: { chatbot_enabled: true },
      authAccess: {
        role: "internal",
        isAdmin: true,
        accessPreset: "admin_vexo",
        clientIds: [],
        permissions: ["*"],
      },
    };
    const res = fakeRes();

    await patchHandler(req, res);

    expect(res.statusCode).toBe(200);
    expect(deps.upsertLeadClientN8nSettings).toHaveBeenCalled();
  });
});
