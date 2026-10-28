// backend/src/test/runDueLegacyRunnerDisarmed.test.js
//
// SPEC 17 — POST /api/campaigns/run-due não aciona mais o runner LEGADO (runDueCampaignDispatches → executeCampaignDispatch).
// O legado cortava em campaign.limit_per_run, não grava runs e não passa por claim, cota nem janela. Era a única porta
// que sobrava (scheduler desligado, /:id/trigger responde 410). Os lotes (runDueIndependentDispatches) seguem rodando.

import { describe, expect, it, vi } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";

function montar() {
  const runDueCampaignDispatches = vi.fn(async () => ({ success: true, processed: 3, sent: 3, failed: 0, items: [] }));
  const postRoutes = {};
  const fakeApp = {
    get: vi.fn(),
    post: vi.fn((path, ...handlers) => {
      postRoutes[path] = handlers[handlers.length - 1];
    }),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  const dummyDeps = {
    CAMPAIGN_SCHEDULER_MAX_BATCH: 5,
      buildDispatchLeads: vi.fn(),
      canCampaignBeDispatched: () => true,
      checkEvolutionInstanceHealth: async () => true,
      continueCampaignLeadFromReply: async () => {},
      ensureDb: () => true,
      executeCampaignDispatch: vi.fn(),
      findCampaignReplyMatches: async () => [],
      getClientName: async () => "Cliente Teste",
      getLeadClientEvolutionInstances: async () => [],
      getLeadClientN8nSettings: async () => ({}),
      getRequestId: () => "req-test",
      getSafeDispatchSettingsLog: () => ({}),
      internalErrorPayloadDetails: () => ({}),
      isMissingSchemaError: () => false,
      isProduction: false,
      logCampaignReplyFlow: () => {},
      logDirectDispatch: () => {},
      maskPhoneForLog: (p) => p,
      normalizeIsoDate: (d) => d,
      leadsTableName: "leads",
      normalizeString: (s) => (s ? String(s).trim() : ""),
      normalizeTenantKey: (s) => (s ? String(s).trim() : ""),
      parseOptionalUuid: (id) => id,
      pgDatabasePool: null,
      requireAppViewAccess: () => (req, res, next) => next(),
      requireCampaignDispatchAccess: () => (req, res, next) => next(),
      requireFirebaseAuth: (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      resolveAuthorizedClientId: () => "tenant-test",
      resolveCampaignDispatchSettings: async () => ({
        webhookUrl: "https://evo.vexo.com/message/sendText/inst-test",
        webhookToken: "tok",
      }),
      resolveDispatchWebhookSettings: async () => ({
        webhookUrl: "https://evo.vexo.com/message/sendText/inst-test",
        webhookToken: "tok",
      }),
      runDueCampaignDispatches,
      sanitizePhone: (p) => p,
      sendError: vi.fn((res, status, code, message) => {
        res.status(status).json({ error: { code, message } });
      }),
      supabase: null,
      validateN8nInboundBearer: () => true,
    };
  registerCampaignsRoutes(fakeApp, dummyDeps);
  return { handler: postRoutes["/api/campaigns/run-due"], runDueCampaignDispatches };
}

function resposta() {
  const out = { status: 200, body: null };
  const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
  return { res, out };
}

describe("SPEC 17 — run-due com o runner legado desarmado", () => {
  it("[OBRIGATÓRIO] não chama runDueCampaignDispatches e devolve o legado como desarmado; os lotes seguem no resultado", async () => {
    const { handler, runDueCampaignDispatches } = montar();
    expect(handler).toBeDefined();
    const { res, out } = resposta();

    await handler({ body: {}, query: {} }, res);

    expect(runDueCampaignDispatches).not.toHaveBeenCalled();
    expect(out.status).toBe(200);
    expect(out.body.campaigns).toMatchObject({ success: true, processed: 0, disarmed: true, reason: "LEGACY_RUNNER_DISARMED" });
    // a fila de lotes FOI chamada (sem banco ela responde DATABASE_NOT_CONFIGURED): o desarme não leva os lotes junto
    expect(out.body.independentDispatches).toMatchObject({ success: false, reason: "DATABASE_NOT_CONFIGURED" });
  });
});
