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
  // a rota faz 3 consultas: garantir a coluna, a auditoria (linhas) e as campanhas legadas (nenhuma aqui)
  const query = vi.fn(async (sql) => {
    const text = String(sql);
    if (text.includes("ADD COLUMN IF NOT EXISTS")) return { rows: [] };
    if (text.includes("NOT EXISTS (") && text.includes("campaign_dispatches")) return { rows: [] };
    return { rows };
  });
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

async function motivos(rows) {
  const handler = getRouteHandler(makeDeps({ rows }), "/api/campaigns/reports/import-audit");
  const res = fakeRes();
  await handler({ query: { clientId: "tenant-1", importId: "import-1" } }, res);
  return res.body.items.map((i) => i.failure_reason);
}

describe("GET /api/campaigns/reports/import-audit — failure_reason", () => {
  it("[TESTE OBRIGATÓRIO] nunca importado: usa o skip_reason da planilha, não o erro de disparo", async () => {
    expect(await motivos([{ lead_import_item_id: "i1", imported: false, skip_reason: "Telefone ausente ou invalido", delivery_state: "sem_telefone_valido", last_status: null }])).toEqual(["Telefone ausente ou invalido"]);
  });

  it("linha descartada sem skip_reason registrado: diz 'Motivo não registrado' (nunca fica sem explicação)", async () => {
    expect(await motivos([{ lead_import_item_id: "i1", imported: false, skip_reason: null, delivery_state: "sem_telefone_valido", last_status: null }])).toEqual(["Motivo não registrado"]);
  });

  it("[TESTE OBRIGATÓRIO] invalid_number vira 'Número inválido', não o enum cru", async () => {
    expect(await motivos([{ lead_import_item_id: "i1", imported: true, delivery_state: "falhou", last_status: "invalid_number", last_error_message: "Número não existe no WhatsApp" }])).toEqual(["Número inválido"]);
  });

  it("[TESTE OBRIGATÓRIO] failed genérico passa pelo MESMO tradutor de erro dos outros relatórios", async () => {
    expect(await motivos([{ lead_import_item_id: "i1", imported: true, delivery_state: "falhou", last_status: "failed", last_error_message: "AbortError: timeout ao chamar a Evolution" }])).toEqual(["Tempo limite excedido ao chamar a Evolution"]);
  });

  it("[TESTE OBRIGATÓRIO] enviado (por esta planilha ou por outra campanha) e pendente: sem motivo — não é falha", async () => {
    expect(
      await motivos([
        { lead_import_item_id: "i1", imported: true, delivery_state: "enviado_por_esta_planilha", last_status: "sent" },
        { lead_import_item_id: "i2", imported: true, delivery_state: "enviado_por_outra_campanha", last_status: "sent" },
        { lead_import_item_id: "i3", imported: true, delivery_state: "pendente", last_status: null },
      ])
    ).toEqual([null, null, null]);
  });

  it("telefone repetido na planilha não é falha: a linha repetida segue o estado do telefone, sem motivo", async () => {
    expect(await motivos([{ lead_import_item_id: "i1", imported: true, delivery_state: "enviado_por_esta_planilha", last_status: "sent", duplicate_of_row: 1 }])).toEqual([null]);
  });

  it("[TESTE OBRIGATÓRIO] linha importada mas sem telefone utilizável tem motivo próprio — nunca fica como 'pendente' sem explicação", async () => {
    expect(await motivos([{ lead_import_item_id: "i1", imported: true, skip_reason: null, delivery_state: "sem_telefone_valido", last_status: null }])).toEqual(["Telefone ausente ou inválido"]);
  });
});
