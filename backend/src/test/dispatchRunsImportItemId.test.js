// backend/src/test/dispatchRunsImportItemId.test.js
//
// Daqui para frente, todo envio grava em campaign_dispatch_runs.lead_import_item_id o id do ITEM da planilha que o
// originou (ou null quando saiu de um lead do CRM). lead_id continua como era (polimórfico: item numa campanha de
// planilha, lead numa do CRM); a coluna nova não é polimórfica e separa "esta planilha" de "mesmo telefone em outra".
// O Relatório & Auditoria cruza por telefone; esta coluna devolve a precisão de dizer de QUAL planilha veio o envio.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { registerCampaignsRoutes, importItemIdOf } from "../domains/campaigns/routes.js";

describe("importItemIdOf", () => {
  it("[TESTE OBRIGATÓRIO] campanha de planilha: o id do destinatário É o id do item", () => {
    expect(importItemIdOf({ id: "item-1", import_id: "imp-1" })).toBe("item-1");
  });

  it("[TESTE OBRIGATÓRIO] campanha do CRM: o id é de lead, não de item — nunca vai para a coluna do item", () => {
    expect(importItemIdOf({ id: "lead-1", import_id: "__crm__", lead_id: "lead-1" })).toBeNull();
  });

  it("sem id ou sem origem conhecida: null (nunca inventa)", () => {
    expect(importItemIdOf({ import_id: "imp-1" })).toBeNull();
    expect(importItemIdOf({ id: "x" })).toBeNull();
    expect(importItemIdOf(null)).toBeNull();
    expect(importItemIdOf(undefined)).toBeNull();
  });
});

describe("runCampaignDispatch — grava o item da planilha em cada envio", () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const dummyApp = {
    get: () => {},
    post: () => {},
    put: () => {},
    patch: () => {},
    delete: () => {},
    use: () => {},
  };

  const mockCampaign = {
    id: "camp-e2e-1",
    name: "Campanha E2E Teste",
    client_id: "tenant-e2e",
    mode: "campanha",
    analytics_meta: {
      sequence: [
        { id: "step-1", type: "text", text: "Olá {{nome}}, tudo bem?", order: 1, enabled: true, delayAfterSeconds: 0 },
      ],
    },
  };

  function createTestContext(mockPool, customOverrides = {}) {
    const deps = {
      CAMPAIGN_SCHEDULER_MAX_BATCH: 10,
      buildDispatchLeads: async () => [
        { id: "lead-1", nome: "Ana", telefone: "5511999990001", client_id: "tenant-e2e" },
        { id: "lead-2", nome: "Bruno", telefone: "5511999990002", client_id: "tenant-e2e" },
      ],
      canCampaignBeDispatched: () => true,
      checkEvolutionInstanceHealth: async () => ({ state: "open" }),
      continueCampaignLeadFromReply: async () => {},
      ensureDb: () => true,
      executeCampaignDispatch: async () => {},
      findCampaignReplyMatches: async () => [],
      getClientName: async () => "Tenant Teste",
      getLeadClientEvolutionInstances: async () => [
        {
          id: "chip-1",
          client_id: "tenant-e2e",
          name: "GD Gabriel",
          dispatch_webhook_url: "https://evolution.teste/message/sendText/chip-1",
          dispatch_webhook_token: "secret-token",
          active: true,
        },
      ],
      getLeadClientN8nSettings: async () => ({
        send_window_enabled: false,
        send_window_start: "00:00",
        send_window_end: "23:59",
        send_window_days: ["seg", "ter", "qua", "qui", "sex", "sab", "dom"],
      }),
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
      parseOptionalUuid: (s) => s,
      pgDatabasePool: mockPool,
      requireAppViewAccess: () => (req, res, next) => next(),
      requireCampaignDispatchAccess: () => (req, res, next) => next(),
      requireFirebaseAuth: (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      resolveAuthorizedClientId: () => "tenant-e2e",
      resolveCampaignDispatchSettings: async () => ({
        webhookUrl: "https://evolution.teste/message/sendText/chip-1",
        webhookToken: "secret-token",
        instanceName: "GD Gabriel",
      }),
      resolveDispatchWebhookSettings: async () => ({}),
      runDueCampaignDispatches: async () => {},
      sanitizePhone: (p) => p,
      sendError: () => {},
      supabase: null,
      validateN8nInboundBearer: () => true,
      ...customOverrides,
    };

    return registerCampaignsRoutes(dummyApp, deps);
  }

  function createMockSupabase(dispatchesTable, dispatchId) {
    return {
      from: (table) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: dispatchesTable[dispatchId], error: null }),
            eq: () => ({
              maybeSingle: async () => ({ data: dispatchesTable[dispatchId], error: null }),
            }),
            single: async () => ({ data: dispatchesTable[dispatchId], error: null }),
          }),
        }),
        update: (patch) => {
          const updateChain = {
            eq: (col, val) => {
              if (table === "campaign_dispatches" && val === dispatchId) {
                Object.assign(dispatchesTable[dispatchId], patch);
              }
              return updateChain;
            },
            then: (resolve) => resolve({ data: dispatchesTable[dispatchId], error: null }),
            catch: () => Promise.resolve(),
          };
          return updateChain;
        },
      }),
    };
  }


  async function executarDisparo(leads) {
    const dispatchId = "disp-item-id";
    const dispatchesTable = {
      [dispatchId]: { id: dispatchId, client_id: "tenant-e2e", name: "Lote", campaign_id: mockCampaign.id, status: "running", target_count: leads.length, sent_count: 0, failed_count: 0, dispatch_options: { leadDelaySeconds: 0 } },
    };
    global.fetch = vi.fn().mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("fetchInstances") || u.includes("connectionState")) return { ok: true, status: 200, json: async () => ({ state: "open" }), text: async () => '{"state":"open"}' };
      return { ok: true, status: 200, json: async () => ({ key: { id: "wa-1" } }), text: async () => '{"key":{"id":"wa-1"}}' };
    });
    const claims = [];
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        const s = String(sql);
        if (s.includes("SELECT id, name, dispatch_webhook_url")) return { rows: [{ id: "chip-1", client_id: "tenant-e2e", name: "GD", dispatch_webhook_url: "https://evolution.teste/message/sendText/chip-1", dispatch_webhook_token: "t", active: true }] };
        if (s.includes("SELECT id, client_id, name, active, daily_limit")) return { rows: [{ id: "chip-1", client_id: "tenant-e2e", name: "GD", active: true, daily_limit: 500 }] };
        if (s.includes("INSERT INTO public.campaign_dispatch_runs")) {
          claims.push({ sql: s, params });
          return { rowCount: 1, rows: [{ id: "claim-uuid" }] };
        }
        if (s.includes("COUNT(*) FILTER")) return { rows: [{ sent: leads.length, failed: 0, skipped: 0 }] };
        return { rows: [], rowCount: 0 };
      }),
    };
    const routes = createTestContext(mockPool, { buildDispatchLeads: async () => leads });
    await routes.runCampaignDispatch({ dispatch: dispatchesTable[dispatchId], campaign: mockCampaign, supabase: createMockSupabase(dispatchesTable, dispatchId) });
    return claims;
  }

  it("[TESTE OBRIGATÓRIO] campanha de PLANILHA: o envio grava lead_id = item E lead_import_item_id = item", async () => {
    const claims = await executarDisparo([
      { id: "item-1", import_id: "imp-1", nome: "Ana", telefone: "5511999990001", client_id: "tenant-e2e" },
      { id: "item-2", import_id: "imp-1", nome: "Bruno", telefone: "5511999990002", client_id: "tenant-e2e" },
    ]);

    expect(claims).toHaveLength(2);
    for (const c of claims) {
      expect(c.sql).toContain("lead_import_item_id");
      expect(c.params[3]).toBe(c.params[5]); // lead_id e lead_import_item_id: o mesmo item
    }
    expect(claims.map((c) => c.params[5])).toEqual(["item-1", "item-2"]);
  });

  it("[TESTE OBRIGATÓRIO] campanha do CRM: o envio grava lead_id = lead e lead_import_item_id = null", async () => {
    const claims = await executarDisparo([
      { id: "lead-1", import_id: "__crm__", lead_id: "lead-1", nome: "Ana", telefone: "5511999990001", client_id: "tenant-e2e" },
      { id: "lead-2", import_id: "__crm__", lead_id: "lead-2", nome: "Bruno", telefone: "5511999990002", client_id: "tenant-e2e" },
    ]);

    expect(claims).toHaveLength(2);
    expect(claims.map((c) => c.params[3])).toEqual(["lead-1", "lead-2"]); // lead_id continua como era
    expect(claims.every((c) => c.params[5] === null)).toBe(true); // e NÃO é um id de item
  });

  it("a coluna entra no fim da lista do INSERT: os parâmetros que já existiam não mudam de posição", async () => {
    const [claim] = await executarDisparo([{ id: "item-1", import_id: "imp-1", nome: "Ana", telefone: "5511999990001", client_id: "tenant-e2e" }]);
    expect(claim.params.slice(0, 3)).toEqual(["disp-item-id", "camp-e2e-1", "tenant-e2e"]);
    expect(claim.sql).toMatch(/\(dispatch_id, campaign_id, client_id, lead_id, phone, status, claimed_at, created_at, lead_import_item_id\)/);
  });
});
