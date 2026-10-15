// backend/src/test/campaignRecipientsRoute.test.js
import { describe, expect, it, vi } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";

function fakeRes() {
  const headers = {};
  return {
    statusCode: 200,
    body: null,
    headers,
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; this.statusCode = this.statusCode || 200; return this; },
    send(b) { this.body = b; return this; },
    setHeader(k, v) { headers[k] = v; },
  };
}

function getRouteHandler(deps, path, method = "get") {
  const routes = {};
  const fakeApp = {
    get: (p, ...handlers) => { routes[`get ${p}`] = handlers[handlers.length - 1]; },
    post: (p, ...handlers) => { routes[`post ${p}`] = handlers[handlers.length - 1]; },
    put: (p, ...handlers) => { routes[`put ${p}`] = handlers[handlers.length - 1]; },
    patch: (p, ...handlers) => { routes[`patch ${p}`] = handlers[handlers.length - 1]; },
    delete: (p, ...handlers) => { routes[`delete ${p}`] = handlers[handlers.length - 1]; },
    use: () => {},
  };
  registerCampaignsRoutes(fakeApp, deps);
  const handler = routes[`${method} ${path}`];
  expect(handler, `rota ${method.toUpperCase()} ${path} não encontrada`).toBeDefined();
  return handler;
}

describe("GET /api/campaigns/:campaignId/recipients", () => {
  const campaignId = "camp-uuid-1";
  const clientId = "tenant-alpha";

  function makeTestSetup({ replyRows = [], buildLeads = null } = {}) {
    const defaultLeads = [
      {
        id: "lead-1",
        nome: "João Silva",
        telefone: "5534999990001",
      },
      {
        id: "lead-2",
        nome: "Maria Santos",
        telefone: "5534999990002",
      },
      {
        id: "lead-3",
        nome: "Carlos Falha",
        telefone: "5534999990003",
      },
    ];

    const pool = {
      query: vi.fn(async (sql, params) => {
        if (sql.includes("JOIN public.lead_messages lm")) {
          return { rows: replyRows };
        }
        return { rows: [] };
      }),
    };

    const dispatches = [
      {
        id: "disp-1",
        client_id: clientId,
        campaign_id: campaignId,
        name: "Lote 1",
        limit_per_run: 50,
        offset: 0,
        status: "done",
        steps: [],
      },
    ];

    const runs = [
      {
        id: "run-1",
        dispatch_id: "disp-1",
        campaign_id: campaignId,
        lead_id: "lead-1",
        phone: "5534999990001",
        status: "sent",
        sent_at: "2026-10-15T10:00:00Z",
        error_message: null,
      },
      {
        id: "run-2",
        dispatch_id: "disp-1",
        campaign_id: campaignId,
        lead_id: "lead-2",
        phone: "5534999990002",
        status: "sent",
        sent_at: "2026-10-15T10:05:00Z",
        error_message: null,
      },
      {
        id: "run-3",
        dispatch_id: "disp-1",
        campaign_id: campaignId,
        lead_id: "lead-3",
        phone: "5534999990003",
        status: "failed",
        sent_at: null,
        error_message: "ERR_INVALID_JID",
      },
    ];

    const supabase = {
      from: (table) => {
        if (table === "campaigns") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: campaignId, name: "Bia do Spazio", client_id: clientId },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "campaign_dispatches") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    order: async () => ({ data: dispatches, error: null }),
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "campaign_dispatch_runs") {
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({ data: runs, error: null }),
              }),
            }),
          };
        }
        return {
          select: () => ({ eq: () => ({ data: [], error: null }) }),
        };
      },
    };

    const deps = {
      ensureDb: () => true,
      normalizeString: (s) => String(s || "").trim(),
      resolveAuthorizedClientId: () => clientId,
      supabase,
      pgDatabasePool: pool,
      buildDispatchLeads: buildLeads || (async () => defaultLeads),
      resolveCampaignImportSelection: () => "__crm__",
      sendError: vi.fn(),
      requireFirebaseAuth: (req, res, next) => next(),
      requireAppViewAccess: () => (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      requireCampaignDispatchAccess: (req, res, next) => next(),
    };

    return { deps, pool };
  }

  it("retorna lista completa com contagens e resposta causal de 14 dias para replied", async () => {
    const replyRows = [
      {
        run_id: "run-1",
        run_phone: "5534999990001",
        replied_at: "2026-10-15T10:30:00Z",
        last_inbound_text: "Tenho interesse sim!",
      },
    ];

    const { deps, pool } = makeTestSetup({ replyRows });
    const handler = getRouteHandler(deps, "/api/campaigns/:campaignId/recipients");

    const req = {
      params: { campaignId },
      query: {},
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.campaignId).toBe(campaignId);
    expect(res.body.campaignName).toBe("Bia do Spazio");
    expect(res.body.total).toBe(3);
    expect(res.body.counts).toEqual({
      all: 3,
      sent: 2,
      replied: 1,
      failed: 1,
      pending: 0,
    });

    const r1 = res.body.recipients.find((r) => r.leadId === "lead-1");
    expect(r1.replied).toBe(true);
    expect(r1.repliedAt).toBe("2026-10-15T10:30:00Z");
    expect(r1.lastInboundText).toBe("Tenho interesse sim!");
    expect(r1.status).toBe("sent");
    expect(r1.statusLabel).toBe("Enviado");
    expect(r1.dispatchName).toBe("Lote 1");

    const r2 = res.body.recipients.find((r) => r.leadId === "lead-2");
    expect(r2.replied).toBe(false);
    expect(r2.repliedAt).toBeNull();
    expect(r2.lastInboundText).toBeNull();

    const r3 = res.body.recipients.find((r) => r.leadId === "lead-3");
    expect(r3.status).toBe("failed");
    expect(r3.failureReason).toBeTruthy();

    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("interval '14 days'"),
      [clientId, campaignId]
    );
  });

  it("filtra por status=replied retornando apenas quem respondeu", async () => {
    const replyRows = [
      {
        run_id: "run-1",
        run_phone: "5534999990001",
        replied_at: "2026-10-15T10:30:00Z",
        last_inbound_text: "Olá",
      },
    ];

    const { deps } = makeTestSetup({ replyRows });
    const handler = getRouteHandler(deps, "/api/campaigns/:campaignId/recipients");

    const req = {
      params: { campaignId },
      query: { status: "replied" },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.body.counts.all).toBe(3);
    expect(res.body.counts.replied).toBe(1);
    expect(res.body.recipients).toHaveLength(1);
    expect(res.body.recipients[0].leadId).toBe("lead-1");
  });

  it("filtra por busca de texto (nome ou telefone)", async () => {
    const { deps } = makeTestSetup();
    const handler = getRouteHandler(deps, "/api/campaigns/:campaignId/recipients");

    const req = {
      params: { campaignId },
      query: { search: "maria" },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.body.recipients).toHaveLength(1);
    expect(res.body.recipients[0].nome).toBe("Maria Santos");
  });

  it("gera CSV formatado quando format=csv é solicitado", async () => {
    const replyRows = [
      {
        run_id: "run-1",
        run_phone: "5534999990001",
        replied_at: "2026-10-15T10:30:00Z",
        last_inbound_text: "Com certeza, me liga!",
      },
    ];

    const { deps } = makeTestSetup({ replyRows });
    const handler = getRouteHandler(deps, "/api/campaigns/:campaignId/recipients");

    const req = {
      params: { campaignId },
      query: { format: "csv" },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.headers["Content-Type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["Content-Disposition"]).toContain("destinatarios-Bia_do_Spazio.csv");

    const lines = res.body.split("\n");
    expect(lines[0]).toBe("Nome,Telefone,Status,Data de Envio,Respondeu,Data da Resposta,Última Mensagem,Motivo Falha,Lote");
    expect(lines[1]).toContain("João Silva,5534999990001,Enviado");
    expect(lines[1]).toContain("Sim");
    expect(lines[1]).toContain("Com certeza, me liga!");
    expect(lines[1]).toContain("Lote 1");
  });
});
