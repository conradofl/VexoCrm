// A marca interna do run ("[vexo:envio_iniciado]", "[vexo:conferido_no_boot:...]") nunca aparece como erro para o
// cliente (21/11/2026). Rota REAL GET /api/campaigns/:campaignId/recipients, JSON e CSV.
import { describe, expect, it, vi } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";
import { normalizeString } from "../textNormalize.js";

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
        status: "claimed",
        sent_at: null,
        error_message: "[vexo:envio_iniciado]",
      },
      {
        id: "run-2",
        dispatch_id: "disp-1",
        campaign_id: campaignId,
        lead_id: "lead-2",
        phone: "5534999990002",
        status: "sent",
        sent_at: "2026-10-15T10:05:00Z",
        error_message: "[vexo:conferido_no_boot:dispatch]",
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
      normalizeString,
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

  it("(g) JSON: marca interna não vira motivo de falha nem detalhe técnico; erro de verdade continua", async () => {
    const { deps } = makeTestSetup();
    const handler = getRouteHandler(deps, "/api/campaigns/:campaignId/recipients");
    const res = fakeRes();
    await handler({ params: { campaignId }, query: {} }, res);
    const porTel = Object.fromEntries((res.body.recipients || res.body.items || []).map((r) => [r.telefone, r]));
    expect(porTel["5534999990001"].failureReason ?? null).toBeNull();
    expect(porTel["5534999990001"].technicalDetails ?? null).toBeNull();
    expect(porTel["5534999990002"].failureReason ?? null).toBeNull();
    expect(porTel["5534999990002"].technicalDetails ?? null).toBeNull();
    expect(porTel["5534999990003"].failureReason).toBeTruthy(); // erro de verdade continua aparecendo
    expect(JSON.stringify(res.body)).not.toContain("[vexo:");
  });

  it("(g) CSV: a marca interna não sai no arquivo", async () => {
    const { deps } = makeTestSetup();
    const handler = getRouteHandler(deps, "/api/campaigns/:campaignId/recipients");
    const res = fakeRes();
    await handler({ params: { campaignId }, query: { format: "csv" } }, res);
    expect(String(res.body)).not.toContain("[vexo:");
    expect(String(res.body)).not.toContain("envio_iniciado");
  });
});

describe("(g) todo leitor do error_message do run passa pelo filtro", () => {
  it("routes.js: tradução e detalhe técnico filtram a marca; nenhum leitor cru sobrou", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve("src/domains/campaigns/routes.js"), "utf8");
    const corpo = src.slice(src.indexOf("function translateDispatchErrorMessage"));
    expect(corpo.split("\n").slice(0, 4).join("\n")).toContain("isRunInternalNote(");
    expect(src).not.toMatch(/technicalDetails:\s*run\?\.error_message/);
    expect(src).not.toMatch(/technicalDetails:\s*r\.error_message/);
  });
});
