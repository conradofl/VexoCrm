import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerEventosRoutes } from "../domains/eventos/routes.js";
import { registerFollowupRoutes } from "../followup/routes.js";

function createMockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json: vi.fn(function (data) {
      this.body = data;
      return this;
    }),
    send: vi.fn(function (data) {
      this.body = data;
      return this;
    }),
    setHeader(key, val) {
      this.headers[key] = val;
      return this;
    },
  };
  return res;
}

function getRouterRouteHandler(router, path, method) {
  const layer = router.stack.find(
    (l) => l.route && l.route.path === path && l.route.methods[method.toLowerCase()]
  );
  if (!layer) throw new Error(`Route ${method.toUpperCase()} ${path} not found on router`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe("Módulo de Eventos — CRUD e Integração de Calendário (Marco 5)", () => {
  let mockPool;
  let sendError;
  let router;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = {
      query: vi.fn(),
    };
    sendError = vi.fn((res, status, code, msg, details) => {
      return res.status(status).json({
        success: false,
        error: { code, message: msg, details },
      });
    });

    const routeDeps = {
      pgDatabasePool: mockPool,
      requireFirebaseAuth: (req, res, next) => next?.(),
      sendError,
    };

    router = registerEventosRoutes(routeDeps);
  });

  describe("GET /api/eventos — Listagem com isolamento de tenant", () => {
    it("lista eventos do tenant ordenados por date ASC", async () => {
      const handler = getRouterRouteHandler(router, "/", "get");
      const req = {
        query: { clientId: "tenant-festas" },
        authAccess: { role: "admin", isAdmin: true },
      };
      const res = createMockResponse();

      const mockRows = [
        {
          id: "evt-1",
          client_id: "tenant-festas",
          name: "Baile Sunset",
          date: "2026-11-15T22:00:00.000Z",
          location: "Arena Sunset",
          tickets_sold: 150,
          esteiras_status: { esteira1: "aguardando_disparo", esteira2: "processando_prompts", esteira5: "aguardando_data" },
        },
      ];
      mockPool.query.mockResolvedValueOnce({ rows: mockRows });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.json).toHaveBeenCalledWith(mockRows);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("WHERE client_id = $1"),
        ["tenant-festas"]
      );
    });
  });

  describe("POST /api/eventos — Criação segura", () => {
    it("retorna 400 se nome estiver vazio", async () => {
      const handler = getRouterRouteHandler(router, "/", "post");
      const req = {
        body: { name: "", date: "2026-11-20T20:00:00Z", clientId: "tenant-festas" },
        authAccess: { role: "admin", isAdmin: true },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(sendError).toHaveBeenCalledWith(
        res,
        400,
        "BAD_REQUEST",
        "Nome do evento é obrigatório"
      );
    });

    it("retorna 400 se data estiver ausente", async () => {
      const handler = getRouterRouteHandler(router, "/", "post");
      const req = {
        body: { name: "Congresso 2026", clientId: "tenant-festas" },
        authAccess: { role: "admin", isAdmin: true },
      };
      const res = createMockResponse();

      await handler(req, res);

      expect(sendError).toHaveBeenCalledWith(
        res,
        400,
        "BAD_REQUEST",
        "Data do evento é obrigatória"
      );
    });

    it("cria evento com status de esteiras default e client_id injetado", async () => {
      const handler = getRouterRouteHandler(router, "/", "post");
      const req = {
        body: {
          name: "Congresso de Vendas",
          date: "2026-11-20T18:00:00Z",
          location: "Centro de Convenções",
          description: "Encontro anual de executivos",
          ticketsSold: 50,
          clientId: "tenant-festas",
        },
        authAccess: { role: "admin", isAdmin: true },
      };
      const res = createMockResponse();

      const createdRow = {
        id: "evt-novo",
        client_id: "tenant-festas",
        name: "Congresso de Vendas",
        date: "2026-11-20T18:00:00Z",
        location: "Centro de Convenções",
        description: "Encontro anual de executivos",
        tickets_sold: 50,
        esteiras_status: { esteira1: "aguardando_disparo", esteira2: "processando_prompts", esteira5: "aguardando_data" },
      };
      mockPool.query.mockResolvedValueOnce({ rows: [createdRow] });

      await handler(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.json).toHaveBeenCalledWith(createdRow);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("INSERT INTO public.events"),
        expect.arrayContaining(["tenant-festas", "Congresso de Vendas"])
      );
    });
  });

  describe("PATCH /api/eventos/:id — Atualização com escopo", () => {
    it("atualiza campos e status das esteiras", async () => {
      const handler = getRouterRouteHandler(router, "/:id", "patch");
      const req = {
        params: { id: "evt-1" },
        body: {
          name: "Baile Sunset VIP",
          tickets_sold: 200,
          esteiras_status: { esteira1: "enviado", esteira2: "enviado", esteira5: "aguardando_data" },
          clientId: "tenant-festas",
        },
        authAccess: { role: "admin", isAdmin: true },
      };
      const res = createMockResponse();

      const updatedRow = {
        id: "evt-1",
        client_id: "tenant-festas",
        name: "Baile Sunset VIP",
        tickets_sold: 200,
        esteiras_status: { esteira1: "enviado", esteira2: "enviado", esteira5: "aguardando_data" },
      };
      mockPool.query.mockResolvedValueOnce({ rows: [updatedRow] });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.json).toHaveBeenCalledWith(updatedRow);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("UPDATE public.events"),
        expect.arrayContaining(["tenant-festas", "evt-1", "Baile Sunset VIP", 200])
      );
    });

    it("retorna 404 se evento não for encontrado para o tenant", async () => {
      const handler = getRouterRouteHandler(router, "/:id", "patch");
      const req = {
        params: { id: "evt-outro-tenant" },
        body: { name: "Hack", clientId: "tenant-festas" },
        authAccess: { role: "admin", isAdmin: true },
      };
      const res = createMockResponse();

      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await handler(req, res);

      expect(sendError).toHaveBeenCalledWith(
        res,
        404,
        "NOT_FOUND",
        "Evento não encontrado para este tenant"
      );
    });
  });

  describe("DELETE /api/eventos/:id — Exclusão segura", () => {
    it("exclui evento filtrando por client_id", async () => {
      const handler = getRouterRouteHandler(router, "/:id", "delete");
      const req = {
        params: { id: "evt-1" },
        query: { clientId: "tenant-festas" },
        authAccess: { role: "admin", isAdmin: true },
      };
      const res = createMockResponse();

      mockPool.query.mockResolvedValueOnce({ rows: [{ id: "evt-1" }] });

      await handler(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, id: "evt-1" });
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining("DELETE FROM public.events WHERE client_id = $1 AND id = $2"),
        ["tenant-festas", "evt-1"]
      );
    });
  });
});
