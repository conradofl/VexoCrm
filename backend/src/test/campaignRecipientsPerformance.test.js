import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";

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
    get: (p, ...handlers) => {
      routes[`get ${p}`] = handlers[handlers.length - 1];
    },
    post: (p, ...handlers) => {
      routes[`post ${p}`] = handlers[handlers.length - 1];
    },
    put: (p, ...handlers) => {
      routes[`put ${p}`] = handlers[handlers.length - 1];
    },
    patch: (p, ...handlers) => {
      routes[`patch ${p}`] = handlers[handlers.length - 1];
    },
    delete: (p, ...handlers) => {
      routes[`delete ${p}`] = handlers[handlers.length - 1];
    },
    use: () => {},
  };
  registerCampaignsRoutes(fakeApp, deps);
  return routes[`${method} ${path}`];
}

describe("Performance & Otimização de Destinatários de Campanha", () => {
  let mockQuery;
  let handler;

  beforeEach(() => {
    mockQuery = vi.fn();

    const fakeDeps = {
      ensureDb: () => true,
      requireFirebaseAuth: (req, res, next) => next(),
      requireAppViewAccess: () => (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      requireCampaignDispatchAccess: (req, res, next) => next(),
      resolveAuthorizedClientId: () => "cliente-teste",
      normalizeString: (s) => (s ? String(s).trim() : ""),
      buildDispatchLeads: async () => [],
      sendError: (res, status, code, message) => res.status(status).json({ error: { code, message } }),
      pgDatabasePool: { query: mockQuery },
      supabase: null,
    };

    handler = getRouteHandler(fakeDeps, "/api/campaigns/:campaignId/recipients", "get");
  });

  it("não executa LEFT JOIN LATERAL com regexp_replace linha a linha ao buscar recipients", async () => {
    mockQuery.mockImplementation(async (sql, params) => {
      const sqlStr = String(sql);
      if (sqlStr.includes("FROM public.campaigns")) {
        return {
          rows: [
            {
              id: "camp-123",
              name: "Campanha Otimizada",
              client_id: "cliente-teste",
              import_id: "imp-1",
              analytics_meta: {},
            },
          ],
        };
      }
      if (sqlStr.includes("dispatch_name") && sqlStr.includes("FROM public.campaign_dispatch_runs")) {
        // Assegura que o SQL NÃO contenha LEFT JOIN LATERAL com regexp_replace
        expect(sqlStr).not.toMatch(/LEFT\s+JOIN\s+LATERAL/i);
        expect(sqlStr).not.toMatch(/regexp_replace\s*\(\s*l\.telefone/i);

        // Deve conter JOIN indexado direto (l.id = r.lead_id)
        expect(sqlStr).toMatch(/l\.id\s*=\s*r\.lead_id/i);

        return {
          rows: [
            {
              id: "run-1",
              dispatch_id: "disp-1",
              lead_id: "lead-1",
              phone: "5534999990001",
              status: "sent",
              sent_at: new Date().toISOString(),
              error_message: null,
              created_at: new Date().toISOString(),
              dispatch_name: "Lote 1",
              lead_nome: "Maria Silva",
            },
          ],
        };
      }
      return { rows: [] };
    });

    const req = {
      params: { campaignId: "camp-123" },
      query: {},
      user: { uid: "user-1" },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("recipients");
    expect(res.body.recipients.length).toBeGreaterThan(0);
    expect(res.body.recipients[0].nome).toBe("Maria Silva");
  });
});
