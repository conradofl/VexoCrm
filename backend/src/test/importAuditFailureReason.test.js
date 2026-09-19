// backend/src/test/importAuditFailureReason.test.js
//
// GET /api/campaigns/reports/import-audit — cada item volta com um
// failure_reason só, pronto pra agrupar na tela nova de Relatório &
// Auditoria: quem nunca foi importado usa o skip_reason da planilha; quem
// foi disparado e falhou usa o MESMO tradutor de erro que os outros
// relatórios já usam (não duplica invalid_number/timeout/etc em dois
// lugares); quem foi enviado ou está pendente não tem motivo nenhum.

import { describe, expect, it, vi } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";

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

function makeDeps({ rows = [], clientId = "tenant-1", overrides = {} } = {}) {
  const query = vi.fn(async () => ({ rows }));
  return {
    CAMPAIGN_SCHEDULER_MAX_BATCH: 10,
    buildDispatchLeads: async () => [],
    canCampaignBeDispatched: () => true,
    checkEvolutionInstanceHealth: async () => ({ state: "open" }),
    continueCampaignLeadFromReply: async () => {},
    ensureDb: () => true,
    executeCampaignDispatch: async () => {},
    findCampaignReplyMatches: async () => [],
    getClientName: async () => "Tenant Teste",
    getLeadClientEvolutionInstances: async () => [],
    getLeadClientN8nSettings: async () => ({}),
    getRequestId: () => "req-1",
    getSafeDispatchSettingsLog: () => ({}),
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    isProduction: false,
    logCampaignReplyFlow: () => {},
    logDirectDispatch: () => {},
    maskPhoneForLog: (p) => p,
    normalizeIsoDate: (d) => d,
    leadsTableName: "lead_import_items",
    normalizeString: (s) => String(s || "").trim(),
    normalizeTenantKey: (s) => String(s || "").trim(),
    parseOptionalUuid: (s) => ({ value: s || null, error: null }),
    pgDatabasePool: { query },
    requireAppViewAccess: () => (req, res, next) => next(),
    requireCampaignDispatchAccess: (req, res, next) => next(),
    requireFirebaseAuth: (req, res, next) => next(),
    requireInternalPageAccess: () => (req, res, next) => next(),
    resolveAuthorizedClientId: (req, res) => clientId,
    resolveCampaignDispatchSettings: async () => ({}),
    resolveDispatchWebhookSettings: async () => ({}),
    runDueCampaignDispatches: async () => {},
    sanitizePhone: (p) => p,
    sendError: vi.fn((res, status, code, message) => {
      res.statusCode = status;
      res.body = { error: { code, message } };
    }),
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: "import-1", client_id: clientId, source_name: "Planilha", created_at: "2026-09-01T00:00:00Z" }, error: null }),
            }),
          }),
        }),
      }),
    },
    validateN8nInboundBearer: () => true,
    ...overrides,
  };
}

describe("GET /api/campaigns/reports/import-audit — failure_reason", () => {
  it("[TESTE OBRIGATÓRIO] nunca importado: usa o skip_reason da planilha, não o erro de disparo", async () => {
    const deps = makeDeps({
      rows: [
        { lead_import_item_id: "i1", imported: false, skip_reason: "Telefone ausente ou invalido", last_status: null, last_error_message: null },
      ],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/import-audit");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1", importId: "import-1" } }, res);

    expect(res.body.items[0].failure_reason).toBe("Telefone ausente ou invalido");
  });

  it("[TESTE OBRIGATÓRIO] invalid_number vira 'Número inválido', não o enum cru", async () => {
    const deps = makeDeps({
      rows: [
        { lead_import_item_id: "i1", imported: true, skip_reason: null, last_status: "invalid_number", last_error_message: "Número não existe no WhatsApp" },
      ],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/import-audit");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1", importId: "import-1" } }, res);

    expect(res.body.items[0].failure_reason).toBe("Número inválido");
  });

  it("[TESTE OBRIGATÓRIO] failed genérico passa pelo MESMO tradutor de erro dos outros relatórios", async () => {
    const deps = makeDeps({
      rows: [
        { lead_import_item_id: "i1", imported: true, skip_reason: null, last_status: "failed", last_error_message: "AbortError: timeout ao chamar a Evolution" },
      ],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/import-audit");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1", importId: "import-1" } }, res);

    expect(res.body.items[0].failure_reason).toBe("Tempo limite excedido ao chamar a Evolution");
  });

  it("enviado ou pendente: sem motivo nenhum — não é falha", async () => {
    const deps = makeDeps({
      rows: [
        { lead_import_item_id: "i1", imported: true, skip_reason: null, last_status: "sent", last_error_message: null },
        { lead_import_item_id: "i2", imported: true, skip_reason: null, last_status: "pending", last_error_message: null },
        { lead_import_item_id: "i3", imported: true, skip_reason: null, last_status: null, last_error_message: null },
      ],
    });
    const handler = getRouteHandler(deps, "/api/campaigns/reports/import-audit");
    const res = fakeRes();
    await handler({ query: { clientId: "tenant-1", importId: "import-1" } }, res);

    expect(res.body.items.map((i) => i.failure_reason)).toEqual([null, null, null]);
  });
});
