// Untangle (25/11/2026): o agendador dos lotes saiu de domains/campaigns/routes.js para campaign/dueDispatchScheduler.js.
// Movimento puro. O que o teste amarra: o registro de rotas não liga mais o tick; o server.js liga explicitamente; o
// tick liga uma vez só; parar limpa; e as rotas continuam devolvendo runDueIndependentDispatches.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDueDispatchSchedulerStatus, startDueDispatchScheduler, stopDueDispatchScheduler } from "../campaign/dueDispatchScheduler.js";
import * as rotas from "../domains/campaigns/routes.js";

afterEach(() => {
  stopDueDispatchScheduler();
  vi.restoreAllMocks();
});

describe("agendador dos lotes fora do routes.js", () => {
  it("startDueDispatchScheduler liga o tick de 30 s uma vez só; stop limpa e deixa ligar de novo", () => {
    const timer = { unref: vi.fn() };
    const setI = vi.spyOn(globalThis, "setInterval").mockImplementation(() => timer);
    const clearI = vi.spyOn(globalThis, "clearInterval").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const run = vi.fn(async () => ({}));
    startDueDispatchScheduler({ runDueIndependentDispatches: run, pgDatabasePool: null });
    startDueDispatchScheduler({ runDueIndependentDispatches: run, pgDatabasePool: null });
    expect(setI).toHaveBeenCalledTimes(1);
    expect(setI.mock.calls[0][1]).toBe(30000);
    expect(timer.unref).toHaveBeenCalled();
    stopDueDispatchScheduler();
    expect(clearI).toHaveBeenCalledWith(timer);
    startDueDispatchScheduler({ runDueIndependentDispatches: run, pgDatabasePool: null });
    expect(setI).toHaveBeenCalledTimes(2);
  });

  it("o tick chama o runDueIndependentDispatches que o server.js passou", async () => {
    let tick;
    vi.spyOn(globalThis, "setInterval").mockImplementation((fn) => { tick = fn; return { unref() {} }; });
    vi.spyOn(console, "log").mockImplementation(() => {});
    const run = vi.fn(async () => ({}));
    startDueDispatchScheduler({ runDueIndependentDispatches: run, pgDatabasePool: null });
    expect(getDueDispatchSchedulerStatus()).toMatchObject({ ligado: true, ultimoTickEm: null, ticks: 0 });
    await tick();
    expect(run).toHaveBeenCalledWith({ limit: 50 });
    const st = getDueDispatchSchedulerStatus();
    expect(st.ticks).toBe(1);
    expect(st.ultimoTickEm).toBeTruthy();
    stopDueDispatchScheduler();
    expect(getDueDispatchSchedulerStatus().ligado).toBe(false);
  });

  it("[OBRIGATÓRIO] registrar as rotas de campanha NÃO liga mais o tick", () => {
    const setI = vi.spyOn(globalThis, "setInterval");
    const app = { get() {}, post() {}, put() {}, patch() {}, delete() {}, use() {} };
    const out = rotas.registerCampaignsRoutes(app, {
      CAMPAIGN_SCHEDULER_MAX_BATCH: 10, buildDispatchLeads: async () => [], canCampaignBeDispatched: () => true,
      checkEvolutionInstanceHealth: async () => ({}), continueCampaignLeadFromReply: async () => {}, ensureDb: () => true,
      executeCampaignDispatch: async () => {}, findCampaignReplyMatches: async () => [], getClientName: async () => "",
      getLeadClientEvolutionInstances: async () => [], getLeadClientN8nSettings: async () => ({}), getRequestId: () => "r",
      getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}), isMissingSchemaError: () => false,
      isProduction: false, logCampaignReplyFlow: () => {}, logDirectDispatch: () => {}, maskPhoneForLog: (p) => p,
      normalizeIsoDate: (d) => d, leadsTableName: "leads", normalizeString: (s) => String(s ?? "").trim(),
      normalizeTenantKey: (s) => String(s ?? ""), parseOptionalUuid: (s) => ({ value: s }), pgDatabasePool: null,
      requireAppViewAccess: () => (q, r, n) => n(), requireCampaignDispatchAccess: (q, r, n) => n(), requireFirebaseAuth: (q, r, n) => n(),
      requireInternalPageAccess: () => (q, r, n) => n(), resolveAuthorizedClientId: () => "t", resolveCampaignDispatchSettings: async () => ({}),
      resolveDispatchWebhookSettings: async () => ({}), runDueCampaignDispatches: async () => {}, sanitizePhone: (p) => p,
      sendError: () => {}, supabase: null, validateN8nInboundBearer: () => true,
    });
    expect(setI.mock.calls.filter((c) => c[1] === 30000)).toHaveLength(0);
    expect(typeof out.runDueIndependentDispatches).toBe("function");
    expect(rotas.stopDueDispatchScheduler).toBe(stopDueDispatchScheduler);
  });

  it("server.js liga o agendador depois do listen (startBackgroundServices) e importa do módulo novo", () => {
    const server = readFileSync(resolve("src/server.js"), "utf8");
    expect(server).toMatch(/import \{ startDueDispatchScheduler, stopDueDispatchScheduler \} from "\.\/campaign\/dueDispatchScheduler\.js";/);
    const ini = server.indexOf("function startBackgroundServices() {");
    expect(server.indexOf("startDueDispatchScheduler({", ini)).toBeGreaterThan(ini);
    expect(server).toContain("runDueIndependentDispatches: domainRoutes.campaigns.runDueIndependentDispatches");
    const rotasSrc = readFileSync(resolve("src/domains/campaigns/routes.js"), "utf8");
    expect(rotasSrc).not.toMatch(/setInterval\(async \(\) => \{\n\s+try \{\n\s+await runDueIndependentDispatches/);
  });
});
