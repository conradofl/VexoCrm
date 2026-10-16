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

describe("Campanhas: Soft-Delete (Lixeira 15 dias) e Restauração", () => {
  it("DELETE /api/campaigns/:id arquiva campanha e cancela lotes pendentes sem hard delete", async () => {
    let updatedCampaign = null;
    let dispatchesQuery = null;

    const fakeSupabase = {
      from: (table) => {
        if (table === "campaigns") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: { id: "camp-123", client_id: "tenant-1", archived_at: null },
                  error: null,
                }),
              }),
            }),
            update: (payload) => ({
              eq: (col1, val1) => ({
                eq: (col2, val2) => {
                  updatedCampaign = { payload, [col1]: val1, [col2]: val2 };
                  return { error: null };
                },
              }),
            }),
          };
        }
        return {};
      },
    };

    const fakePool = {
      query: vi.fn(async (sql, params) => {
        dispatchesQuery = { sql, params };
        return { rows: [] };
      }),
    };

    const routes = {};
    const fakeApp = {
      get: (p, ...h) => { routes[`get ${p}`] = h[h.length - 1]; },
      post: (p, ...h) => { routes[`post ${p}`] = h[h.length - 1]; },
      delete: (p, ...h) => { routes[`delete ${p}`] = h[h.length - 1]; },
      put: () => {},
      patch: () => {},
      use: () => {},
    };

    registerCampaignsRoutes(fakeApp, {
      ensureDb: () => true,
      resolveAuthorizedClientId: () => "tenant-1",
      requireFirebaseAuth: (req, res, next) => next(),
      requireCampaignDispatchAccess: (req, res, next) => next(),
      requireAppViewAccess: () => (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      supabase: fakeSupabase,
      pgDatabasePool: fakePool,
      sendError: (res, status, code, msg) => {
        res.status(status).json({ error: { code, msg } });
      },
      normalizeString: (s) => String(s || "").trim(),
      internalErrorPayloadDetails: () => ({}),
    });

    const handler = routes["delete /api/campaigns/:id"];
    expect(handler).toBeDefined();

    const req = { params: { id: "camp-123" } };
    const res = fakeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, archived: true });

    // Verifica que fez UPDATE (soft-delete) e não DELETE
    expect(updatedCampaign).toBeDefined();
    expect(updatedCampaign.payload.status).toBe("archived");
    expect(updatedCampaign.payload.archived_at).toBeTruthy();

    // Verifica que cancelou os lotes pendentes no pool
    expect(dispatchesQuery).toBeDefined();
    expect(dispatchesQuery.sql).toContain("UPDATE public.campaign_dispatches");
    expect(dispatchesQuery.sql).toContain("SET status = 'cancelled'");
    expect(dispatchesQuery.params).toEqual(["camp-123", "tenant-1"]);
  });

  it("POST /api/campaigns/:id/restore restaura campanha arquivada nos últimos 15 dias e reativa lotes", async () => {
    let restoredCampaign = null;
    let dispatchesQuery = null;
    const fiveDaysAgoIso = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();

    const fakeSupabase = {
      from: (table) => {
        if (table === "campaigns") {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: "camp-restore-1",
                    client_id: "tenant-1",
                    archived_at: fiveDaysAgoIso,
                    status: "archived",
                  },
                  error: null,
                }),
              }),
            }),
            update: (payload) => ({
              eq: (col1, val1) => ({
                eq: (col2, val2) => {
                  restoredCampaign = { payload, [col1]: val1, [col2]: val2 };
                  return { error: null };
                },
              }),
            }),
          };
        }
        return {};
      },
    };

    const fakePool = {
      query: vi.fn(async (sql, params) => {
        dispatchesQuery = { sql, params };
        return { rows: [] };
      }),
    };

    const routes = {};
    const fakeApp = {
      get: (p, ...h) => { routes[`get ${p}`] = h[h.length - 1]; },
      post: (p, ...h) => { routes[`post ${p}`] = h[h.length - 1]; },
      delete: () => {},
      put: () => {},
      patch: () => {},
      use: () => {},
    };

    registerCampaignsRoutes(fakeApp, {
      ensureDb: () => true,
      resolveAuthorizedClientId: () => "tenant-1",
      requireFirebaseAuth: (req, res, next) => next(),
      requireCampaignDispatchAccess: (req, res, next) => next(),
      requireAppViewAccess: () => (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      supabase: fakeSupabase,
      pgDatabasePool: fakePool,
      sendError: (res, status, code, msg) => {
        res.status(status).json({ error: { code, msg } });
      },
      normalizeString: (s) => String(s || "").trim(),
      internalErrorPayloadDetails: () => ({}),
    });

    const handler = routes["post /api/campaigns/:id/restore"];
    expect(handler).toBeDefined();

    const req = { params: { id: "camp-restore-1" } };
    const res = fakeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ success: true, restored: true });

    // Verifica que limpou archived_at e marcou como paused
    expect(restoredCampaign).toBeDefined();
    expect(restoredCampaign.payload.archived_at).toBeNull();
    expect(restoredCampaign.payload.status).toBe("paused");

    // Verifica que reativou os lotes cancelados para paused
    expect(dispatchesQuery).toBeDefined();
    expect(dispatchesQuery.sql).toContain("SET status = 'paused'");
    expect(dispatchesQuery.sql).toContain("status = 'cancelled'");
    expect(dispatchesQuery.params).toEqual(["camp-restore-1", "tenant-1"]);
  });

  it("POST /api/campaigns/:id/restore recusa restaurar campanha arquivada há mais de 15 dias", async () => {
    const twentyDaysAgoIso = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString();

    const fakeSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: {
                id: "camp-expired",
                client_id: "tenant-1",
                archived_at: twentyDaysAgoIso,
                status: "archived",
              },
              error: null,
            }),
          }),
        }),
      }),
    };

    const routes = {};
    const fakeApp = {
      get: () => {},
      post: (p, ...h) => { routes[`post ${p}`] = h[h.length - 1]; },
      delete: () => {},
      put: () => {},
      patch: () => {},
      use: () => {},
    };

    registerCampaignsRoutes(fakeApp, {
      ensureDb: () => true,
      resolveAuthorizedClientId: () => "tenant-1",
      requireFirebaseAuth: (req, res, next) => next(),
      requireCampaignDispatchAccess: (req, res, next) => next(),
      requireAppViewAccess: () => (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      supabase: fakeSupabase,
      sendError: (res, status, code, msg) => {
        res.status(status).json({ error: { code, msg } });
      },
      normalizeString: (s) => String(s || "").trim(),
      internalErrorPayloadDetails: () => ({}),
    });

    const handler = routes["post /api/campaigns/:id/restore"];
    const req = { params: { id: "camp-expired" } };
    const res = fakeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("RETENTION_EXPIRED");
  });

  it("GET /api/campaigns/dispatch-summary com scope=trashed agrupa e retorna campanhas na lixeira", async () => {
    const twoDaysAgoIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const groupedRows = [
      {
        campaign_id: "c-active",
        campaign_name: "Campanha Ativa",
        archived_at: null,
        lote_count: 1,
        sent_total: 10,
        failed_total: 0,
        leads_total: 10,
        leads_pending: 0,
        leads_pause_target: 0,
        leads_resume_target: 0,
        leads_cancel_target: 0,
        statuses: ["running"],
        evolution_instance_id: "chip-1",
        next_scheduled_at: null,
        last_updated_at: new Date().toISOString(),
      },
      {
        campaign_id: "c-trashed",
        campaign_name: "Campanha Lixeira",
        archived_at: twoDaysAgoIso,
        lote_count: 2,
        sent_total: 5,
        failed_total: 1,
        leads_total: 20,
        leads_pending: 0,
        leads_pause_target: 0,
        leads_resume_target: 0,
        leads_cancel_target: 0,
        statuses: ["cancelled", "cancelled"],
        evolution_instance_id: "chip-1",
        next_scheduled_at: null,
        last_updated_at: twoDaysAgoIso,
      },
    ];

    const fakePool = {
      query: vi.fn(async (sql) => {
        if (sql.includes("GROUP BY d.campaign_id, c.name")) return { rows: groupedRows };
        return { rows: [] };
      }),
    };

    const routes = {};
    const fakeApp = {
      get: (p, ...h) => { routes[`get ${p}`] = h[h.length - 1]; },
      post: () => {},
      delete: () => {},
      put: () => {},
      patch: () => {},
      use: () => {},
    };

    registerCampaignsRoutes(fakeApp, {
      ensureDb: () => true,
      resolveAuthorizedClientId: () => "tenant-1",
      requireFirebaseAuth: (req, res, next) => next(),
      requireCampaignDispatchAccess: (req, res, next) => next(),
      requireAppViewAccess: () => (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      pgDatabasePool: fakePool,
      getLeadClientEvolutionInstances: async () => [{ id: "chip-1", name: "Chip 1" }],
      getLeadClientN8nSettings: async () => ({}),
      normalizeString: (s) => String(s || "").trim(),
      sendError: (res, status, code, msg) => {
        res.status(status).json({ error: { code, msg } });
      },
    });

    const handler = routes["get /api/campaigns/dispatch-summary"];
    const req = { query: { clientId: "tenant-1", scope: "trashed" } };
    const res = fakeRes();
    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.counts).toEqual({ active: 1, ended: 0, trashed: 1 });
    expect(res.body.scope).toBe("trashed");
    expect(res.body.campaigns).toHaveLength(1);
    expect(res.body.campaigns[0].campaignId).toBe("c-trashed");
    expect(res.body.campaigns[0].status).toBe("arquivada");
    expect(res.body.campaigns[0].statusLabel).toBe("Na Lixeira");
  });
});

describe("Continuação de Resposta com Roteamento Estrito por Chip", () => {
  it("reply-webhook repassa instance/instanceName no replyPayload", async () => {
    let capturedPayload = null;

    const routes = {};
    const fakeApp = {
      get: () => {},
      post: (p, ...h) => { routes[`post ${p}`] = h[h.length - 1]; },
      delete: () => {},
      put: () => {},
      patch: () => {},
      use: () => {},
    };

    registerCampaignsRoutes(fakeApp, {
      ensureDb: () => true,
      resolveAuthorizedClientId: () => "tenant-1",
      requireFirebaseAuth: (req, res, next) => next(),
      requireCampaignDispatchAccess: (req, res, next) => next(),
      requireAppViewAccess: () => (req, res, next) => next(),
      requireInternalPageAccess: () => (req, res, next) => next(),
      validateN8nInboundBearer: () => true,
      findCampaignReplyMatches: async () => ({
        matches: [{ id: "c-1" }],
        waitForReplyMatches: [{ id: "c-1" }],
        processingWaitForReplyMatches: [{ id: "c-1", leadImportItem: { id: "item-1" } }],
      }),
      continueCampaignLeadFromReply: async ({ replyPayload }) => {
        capturedPayload = replyPayload;
        return { continued: true };
      },
      logCampaignReplyFlow: () => {},
      maskPhoneForLog: (p) => p,
      normalizeIsoDate: (d) => d,
      normalizeString: (s) => String(s || "").trim(),
      normalizeTenantKey: (s) => String(s || "").trim(),
      sanitizePhone: (p) => p,
      sendError: (res, status, code, msg) => {
        res.status(status).json({ error: { code, msg } });
      },
    });

    const handler = routes["post /api/campaigns/reply-webhook"];
    expect(handler).toBeDefined();

    const req = {
      body: {
        clientId: "tenant-1",
        phone: "5511999998888",
        message: "Quero saber mais",
        instanceName: "JULIANI - EVENTO NOUS",
      },
      params: {},
    };
    const res = fakeRes();
    await handler(req, res);

    expect(capturedPayload).toBeDefined();
    expect(capturedPayload.instance).toBe("JULIANI - EVENTO NOUS");
    expect(capturedPayload.message).toBe("Quero saber mais");
  });

  it("garante no dispatch.js a resolução em 3 fontes e a injeção de sendingEvolutionInstanceId no dispatchOptions", async () => {
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const dispatchSource = readFileSync(resolve("src/campaign/dispatch.js"), "utf8");

    // Fonte 1: webhook receptora (replyPayload.instance / instanceName)
    expect(dispatchSource).toContain("replyPayload.instance || replyPayload.instanceName || replyPayload.instance_name");
    expect(dispatchSource).toContain("getLeadClientEvolutionInstances(clientId)");

    // Fonte 2: progress.dispatchId -> campaign_dispatches.evolution_instance_id
    expect(dispatchSource).toContain("progress?.dispatchId");
    expect(dispatchSource).toContain(".from(\"campaign_dispatches\")");
    expect(dispatchSource).toContain(".select(\"evolution_instance_id\")");

    // Fonte 3: campaign_dispatch_runs
    expect(dispatchSource).toContain("SELECT evolution_instance_id FROM public.campaign_dispatch_runs");

    // Injeção do sendingEvolutionInstanceId em analytics_meta.dispatchOptions.evolutionInstanceId
    expect(dispatchSource).toContain("evolutionInstanceId: sendingEvolutionInstanceId");
    expect(dispatchSource).toContain("resolveCampaignDispatchSettings(clientId, campaignWithChip)");
  });
});

