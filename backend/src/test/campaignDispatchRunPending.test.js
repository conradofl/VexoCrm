// backend/src/test/campaignDispatchRunPending.test.js
//
// Testes obrigatórios da correção de contagem de "não processados" e proteção contra duplicata:
// a) lote com 10 alvos e 4 já enviados: run-pending devolve pendingCount = 6 e a mensagem diz 6
// b) os 4 já enviados NÃO recebem de novo (prova direta contra duplicata)
// c) lote sem pendentes: mensagem de "todos já processados", nada é disparado

import { afterEach, describe, expect, it } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";
import { buildDispatchLeads } from "../campaign/dispatch.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";

const TENANT = "tenant-pending-test";

function createMockPool(tables) {
  return {
    query: async (sqlQuery, params) => {
      const sql = typeof sqlQuery === "string" ? sqlQuery : sqlQuery?.text || "";

      if (sql.includes("lead_import_items")) {
        return { rows: tables.lead_import_items || [], rowCount: (tables.lead_import_items || []).length };
      }

      if (sql.includes("campaign_dispatch_runs")) {
        let rows = tables.campaign_dispatch_runs || [];
        // Se houver filtro por dispatch_id
        if (sql.includes("dispatch_id = $") && params && params[0]) {
          rows = rows.filter((r) => r.dispatch_id === params[0]);
        }
        return { rows, rowCount: rows.length };
      }

      if (sql.includes("campaign_dispatches")) {
        if (sql.includes("UPDATE") || sql.includes("update")) {
          return { rows: [{ id: params?.[0] || "disp-1" }], rowCount: 1 };
        }
        let rows = tables.campaign_dispatches || [];
        if (params && params[0]) {
          rows = rows.filter((d) => d.id === params[0]);
        }
        return { rows, rowCount: rows.length };
      }

      if (sql.includes("campaigns")) {
        let rows = tables.campaigns || [];
        if (params && params[0]) {
          rows = rows.filter((c) => c.id === params[0]);
        }
        return { rows, rowCount: rows.length };
      }

      return { rows: [], rowCount: 0 };
    },
  };
}

describe("Correção: contagem de não processados no disparo manual (run-pending)", () => {
  afterEach(() => {
    _setPgDatabasePoolForTesting(null);
  });

  it("[TESTE OBRIGATÓRIO A] lote com 10 alvos e 4 já enviados: run-pending devolve pendingCount = 6 e a mensagem diz 6", async () => {
    // Campanha com 20 leads no total dividida em 2 lotes de 10
    // Lote 1: offset = 0, limit_per_run = 10 (alvos: leads 1 a 10)
    // 4 já enviados: leads 1 a 4
    const tables = {
      campaign_dispatches: [
        {
          id: "disp-batch-1",
          campaign_id: "camp-1",
          client_id: TENANT,
          name: "Lote 1",
          status: "interrupted",
          limit_per_run: 10,
          offset: 0,
          steps: [{ id: "s1", type: "text", text: "Olá" }],
        },
      ],
      campaigns: [
        {
          id: "camp-1",
          name: "Campanha Dois Lotes",
          client_id: TENANT,
          import_id: "imp-1",
          limit_per_run: 10,
          analytics_meta: {},
        },
      ],
      lead_import_items: Array.from({ length: 20 }, (_, i) => ({
        id: `lead-uuid-${i + 1}`,
        import_id: "imp-1",
        client_id: TENANT,
        lead_id: `lead-uuid-${i + 1}`,
        telefone: `55119999900${String(i + 1).padStart(2, "0")}`,
        imported: true,
        normalized_data: { nome: `Lead ${i + 1}` },
        created_at: new Date(Date.now() - (20 - i) * 60000).toISOString(),
      })),
      campaign_dispatch_runs: [
        { dispatch_id: "disp-batch-1", lead_id: "lead-uuid-1", phone: "5511999990001", status: "sent" },
        { dispatch_id: "disp-batch-1", lead_id: "lead-uuid-2", phone: "5511999990002", status: "sent" },
        { dispatch_id: "disp-batch-1", lead_id: "lead-uuid-3", phone: "5511999990003", status: "sent" },
        { dispatch_id: "disp-batch-1", lead_id: "lead-uuid-4", phone: "5511999990004", status: "sent" },
      ],
    };

    const mockPool = createMockPool(tables);
    _setPgDatabasePoolForTesting(mockPool);

    let capturedResponse = null;
    let capturedStatus = 200;
    const dummyRes = {
      json(payload) {
        capturedResponse = payload;
        return payload;
      },
      status(code) {
        capturedStatus = code;
        return dummyRes;
      },
    };

    const dummyReq = {
      params: { dispatchId: "disp-batch-1" },
      authAccess: { uid: "test-user", email: "test@example.com" },
    };

    const routes = {};
    const dummyApp = {
      post(path, ...handlers) {
        routes[`POST ${path}`] = handlers[handlers.length - 1];
      },
      get() {},
      put() {},
      patch() {},
      delete() {},
      use() {},
    };

    const { supabase } = await import("../services/database.js");

    registerCampaignsRoutes(dummyApp, {
      supabase,
      buildDispatchLeads,
      resolveAuthorizedClientId: () => TENANT,
      resolveCampaignDispatchSettings: async () => ({ webhookUrl: null }),
      ensureDb: () => true,
      sendError: (res, status, code, msg) => res.status(status).json({ error: { code, message: msg } }),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      requireFirebaseAuth: (_req, _res, next) => next(),
      requireCampaignDispatchAccess: (_req, _res, next) => next(),
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      normalizeString: (s) => String(s || "").trim(),
      pgDatabasePool: mockPool,
    });

    const runPendingHandler = routes["POST /api/campaigns/dispatches/:dispatchId/run-pending"];
    expect(runPendingHandler).toBeDefined();

    await runPendingHandler(dummyReq, dummyRes);

    expect(capturedResponse).toBeDefined();
    expect(capturedResponse.success).toBe(true);
    // Verificações exatas do Teste Obrigatório A:
    expect(capturedResponse.pendingCount).toBe(6);
    expect(capturedResponse.message).toContain("6 lead(s) pendente(s) em execução");
  });

  it("[TESTE OBRIGATÓRIO B] os 4 já enviados NÃO recebem de novo (prova direta contra duplicata)", async () => {
    // 20 leads na base, Lote 1 mira leads 1 a 10.
    // Leads 1, 2, 3 e 4 já foram enviados ('sent').
    const tables = {
      lead_import_items: Array.from({ length: 20 }, (_, i) => ({
        id: `lead-uuid-${i + 1}`,
        import_id: "imp-1",
        client_id: TENANT,
        lead_id: `lead-uuid-${i + 1}`,
        telefone: `55119999900${String(i + 1).padStart(2, "0")}`,
        imported: true,
        normalized_data: { nome: `Lead ${i + 1}` },
        created_at: new Date(Date.now() - (20 - i) * 60000).toISOString(),
      })),
      campaign_dispatch_runs: [
        { dispatch_id: "disp-batch-1", lead_id: "lead-uuid-1", phone: "5511999990001", status: "sent" },
        { dispatch_id: "disp-batch-1", lead_id: "lead-uuid-2", phone: "5511999990002", status: "sent" },
        { dispatch_id: "disp-batch-1", lead_id: "lead-uuid-3", phone: "5511999990003", status: "sent" },
        { dispatch_id: "disp-batch-1", lead_id: "lead-uuid-4", phone: "5511999990004", status: "sent" },
      ],
    };

    const mockPool = createMockPool(tables);
    _setPgDatabasePoolForTesting(mockPool);

    // 1. buildDispatchLeads chamado para o Lote 1 com excludeDispatchId
    const pendingLeads = await buildDispatchLeads({
      clientId: TENANT,
      importId: "imp-1",
      limit: 10,
      offset: 0,
      excludeDispatchId: "disp-batch-1",
    });

    // Prova direta: os 4 leads já enviados ('lead-uuid-1' a 'lead-uuid-4') NÃO constam na lista
    const returnedIds = pendingLeads.map((l) => l.id);
    const returnedPhones = pendingLeads.map((l) => l.telefone);

    expect(returnedIds).not.toContain("lead-uuid-1");
    expect(returnedIds).not.toContain("lead-uuid-2");
    expect(returnedIds).not.toContain("lead-uuid-3");
    expect(returnedIds).not.toContain("lead-uuid-4");

    expect(returnedPhones).not.toContain("5511999990001");
    expect(returnedPhones).not.toContain("5511999990002");
    expect(returnedPhones).not.toContain("5511999990003");
    expect(returnedPhones).not.toContain("5511999990004");

    // E a lista contém exatamente os 6 leads restantes do Lote 1 (e nenhum do Lote 2)
    expect(pendingLeads).toHaveLength(6);
    expect(returnedIds).toEqual([
      "lead-uuid-5",
      "lead-uuid-6",
      "lead-uuid-7",
      "lead-uuid-8",
      "lead-uuid-9",
      "lead-uuid-10",
    ]);
  });

  it("[TESTE OBRIGATÓRIO C] lote sem pendentes: mensagem de 'todos já processados', nada é disparado", async () => {
    // Lote de 10 leads onde todos os 10 já constam em campaign_dispatch_runs
    let dispatchStatus = "interrupted";
    const tables = {
      campaign_dispatches: [
        {
          id: "disp-batch-complete",
          campaign_id: "camp-complete",
          client_id: TENANT,
          name: "Lote Completo",
          status: dispatchStatus,
          limit_per_run: 10,
          offset: 0,
          steps: [{ id: "s1", type: "text", text: "Olá" }],
        },
      ],
      campaigns: [
        {
          id: "camp-complete",
          name: "Campanha Completa",
          client_id: TENANT,
          import_id: "imp-complete",
          limit_per_run: 10,
          analytics_meta: {},
        },
      ],
      lead_import_items: Array.from({ length: 10 }, (_, i) => ({
        id: `lead-complete-${i + 1}`,
        import_id: "imp-complete",
        client_id: TENANT,
        lead_id: `lead-complete-${i + 1}`,
        telefone: `55118888800${String(i + 1).padStart(2, "0")}`,
        imported: true,
        normalized_data: { nome: `Lead Completo ${i + 1}` },
        created_at: new Date(Date.now() - (10 - i) * 60000).toISOString(),
      })),
      campaign_dispatch_runs: Array.from({ length: 10 }, (_, i) => ({
        dispatch_id: "disp-batch-complete",
        lead_id: `lead-complete-${i + 1}`,
        phone: `55118888800${String(i + 1).padStart(2, "0")}`,
        status: "sent",
      })),
    };

    const mockPool = createMockPool(tables);
    _setPgDatabasePoolForTesting(mockPool);

    let capturedResponse = null;
    const dummyRes = {
      json(payload) {
        capturedResponse = payload;
        return payload;
      },
      status() {
        return dummyRes;
      },
    };

    const dummyReq = {
      params: { dispatchId: "disp-batch-complete" },
      authAccess: { uid: "test-user", email: "test@example.com" },
    };

    const routes = {};
    const dummyApp = {
      post(path, ...handlers) {
        routes[`POST ${path}`] = handlers[handlers.length - 1];
      },
      get() {},
      put() {},
      patch() {},
      delete() {},
      use() {},
    };

    const { supabase } = await import("../services/database.js");

    registerCampaignsRoutes(dummyApp, {
      supabase,
      buildDispatchLeads,
      resolveAuthorizedClientId: () => TENANT,
      ensureDb: () => true,
      sendError: (res, status, code, msg) => res.status(status).json({ error: { code, message: msg } }),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      requireFirebaseAuth: (_req, _res, next) => next(),
      requireCampaignDispatchAccess: (_req, _res, next) => next(),
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      normalizeString: (s) => String(s || "").trim(),
      pgDatabasePool: mockPool,
    });

    const runPendingHandler = routes["POST /api/campaigns/dispatches/:dispatchId/run-pending"];
    await runPendingHandler(dummyReq, dummyRes);

    expect(capturedResponse).toBeDefined();
    expect(capturedResponse.success).toBe(true);
    expect(capturedResponse.pendingCount).toBe(0);
    expect(capturedResponse.message).toBe("Todos os destinatários deste lote já foram processados. Nenhum lead pendente.");
  });
});
