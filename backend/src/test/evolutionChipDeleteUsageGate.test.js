import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { deleteLeadClientEvolutionInstance } from "../services/evolution.js";

const SCHEMA = `
  CREATE TABLE public.lead_client_evolution_instances (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL,
    name text NOT NULL,
    dispatch_webhook_url text,
    is_default boolean DEFAULT false,
    active boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
  );

  CREATE TABLE public.campaign_dispatches (
    id text PRIMARY KEY,
    client_id text NOT NULL,
    name text NOT NULL,
    status text NOT NULL,
    dispatch_options jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz DEFAULT now()
  );

  CREATE TABLE public.followup_companies (
    id text PRIMARY KEY,
    tenant_id text NOT NULL,
    name text NOT NULL,
    evolution_instance text,
    evolution_instances jsonb DEFAULT '[]'::jsonb,
    updated_at timestamptz DEFAULT now()
  );
`;

describe("SPEC 3: Trava de Exclusão de Chip em Uso por Lote Ativo", () => {
  let db;
  const originalFetch = global.fetch;
  let fetchCalls = [];

  beforeEach(async () => {
    db = await createPgliteDb(SCHEMA);
    fetchCalls = [];
    global.fetch = vi.fn(async (url, opts) => {
      fetchCalls.push({ url, opts });
      return { ok: true, status: 200, text: async () => "{}" };
    });
  });

  afterEach(async () => {
    global.fetch = originalFetch;
    if (db) await db.close();
  });

  it.each(["draft", "scheduled", "running", "paused"])(
    "Recusa a exclusão de chip em uso por lote ativo com status '%s' (409 CHIP_IN_USE_BY_DISPATCH)",
    async (activeStatus) => {
      const chipId = "f7d66677-71e4-4a32-8644-857eb8d95d53";
      const clientId = "bia-do-spazio";

      // 1. Cadastra o chip
      await db.query(`
        INSERT INTO public.lead_client_evolution_instances (id, client_id, name, dispatch_webhook_url)
        VALUES ($1, $2, 'chip-bia-4343', 'https://evo.vexo.com/instance/chip-bia-4343')
      `, [chipId, clientId]);

      // 2. Cria lote ativo com o chip em handoffChipIds
      await db.query(`
        INSERT INTO public.campaign_dispatches (id, client_id, name, status, dispatch_options)
        VALUES ($1, $2, 'Campanha Funil Ativa', $3, jsonb_build_object('handoffChipIds', jsonb_build_array($4::text)))
      `, [`disp-${activeStatus}`, clientId, activeStatus, chipId]);

      // 3. Tenta excluir o chip -> Deve ser recusado com 409
      await expect(deleteLeadClientEvolutionInstance(clientId, chipId, db)).rejects.toMatchObject({
        code: "CHIP_IN_USE_BY_DISPATCH",
        statusCode: 409,
        dispatches: expect.arrayContaining([
          expect.objectContaining({ id: `disp-${activeStatus}`, name: "Campanha Funil Ativa", status: activeStatus }),
        ]),
      });

      // 4. Confere que o chip NÃO foi excluído do banco (rollback preservou a linha)
      const checkChip = await db.query(
        `SELECT id FROM public.lead_client_evolution_instances WHERE id = $1`,
        [chipId]
      );
      expect(checkChip.rows).toHaveLength(1);

      // 5. Confere que o DELETE na Evolution API NÃO foi chamado
      expect(fetchCalls).toHaveLength(0);
    }
  );

  it("Permite exclusão de chip se usado apenas por lote finalizado ('done'), limpando referências em agentes", async () => {
    const chipId = "c983602b-81f1-4f12-a1b2-c3d4e5f6a7b8";
    const clientId = "bia-do-spazio";

    // 1. Cadastra chip
    await db.query(`
      INSERT INTO public.lead_client_evolution_instances (id, client_id, name, dispatch_webhook_url)
      VALUES ($1, $2, 'chip-historico', 'https://evo.vexo.com/instance/chip-historico')
    `, [chipId, clientId]);

    // 2. Lote já finalizado no passado (histórico preservado)
    await db.query(`
      INSERT INTO public.campaign_dispatches (id, client_id, name, status, dispatch_options)
      VALUES ('disp-done-1', $1, 'Lote Antigo Finalizado', 'done', jsonb_build_object('handoffChipIds', jsonb_build_array($2::text)))
    `, [clientId, chipId]);

    // 3. Agente associado ao chip em followup_companies
    await db.query(`
      INSERT INTO public.followup_companies (id, tenant_id, name, evolution_instance, evolution_instances)
      VALUES ('agent-1', $1, 'Atendente Bia', $2, jsonb_build_array($2::text, 'outro-chip-uuid'))
    `, [clientId, chipId]);

    // 4. Exclui o chip
    const result = await deleteLeadClientEvolutionInstance(clientId, chipId, db);

    expect(result).toBeDefined();
    expect(result.id).toBe(chipId);
    expect(result.affectedAgentsCount).toBe(1);
    expect(result.affectedDispatchesCount).toBe(1);

    // 5. Confere que o chip foi removido da lista do agente
    const agentCheck = await db.query(
      `SELECT evolution_instance, evolution_instances FROM public.followup_companies WHERE id = 'agent-1'`
    );
    expect(agentCheck.rows[0]?.evolution_instance).toBeNull();
    expect(agentCheck.rows[0]?.evolution_instances).toEqual(["outro-chip-uuid"]);

    // 6. Confere que o histórico do lote finalizado permaneceu intocado
    const dispatchCheck = await db.query(
      `SELECT id, status, dispatch_options FROM public.campaign_dispatches WHERE id = 'disp-done-1'`
    );
    expect(dispatchCheck.rows[0]?.status).toBe("done");
    expect(dispatchCheck.rows[0]?.dispatch_options.handoffChipIds).toEqual([chipId]);
  });

  it("Endpoint HTTP DELETE responde 409 CHIP_IN_USE_BY_DISPATCH quando o chip está em lote ativo", async () => {
    const chipId = "e8d47b59-450b-49ef-a9d2-570ea5bf1534";
    const clientId = "bia-do-spazio";

    const { registerIntegrationsRoutes } = await import("../domains/integrations/routes.js");
    const { sendError } = await import("../services/httpInfra.js");

    const app = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    };

    let deleteHandler = null;
    app.delete.mockImplementation((path, ...handlers) => {
      if (path === "/api/lead-clients/:tenantId/evolution-instances/:instanceId") {
        deleteHandler = handlers[handlers.length - 1];
      }
    });

    const mockDelete = vi.fn().mockRejectedValue({
      code: "CHIP_IN_USE_BY_DISPATCH",
      statusCode: 409,
      message: "Chip em uso por lote de disparo ativo",
      dispatches: [{ id: "disp-1", name: "Lote Rodando", status: "running" }],
    });

    registerIntegrationsRoutes(app, {
      deleteLeadClientEvolutionInstance: mockDelete,
      ensureDb: () => true,
      getLeadClientEvolutionInstances: vi.fn(),
      getLeadClientN8nSettings: vi.fn(),
      isMaskedSecretPlaceholder: () => false,
      isMissingSchemaError: () => false,
      leadsTableName: () => "leads",
      maskEvolutionInstance: (i) => i,
      maskN8nSettings: (s) => s,
      normalizeHttpUrl: (u) => u,
      normalizeString: (s) => String(s || "").trim(),
      normalizeTenantKey: (s) => String(s || "").trim().toLowerCase(),
      parseEvolutionWebhookEndpoint: () => null,
      parseOptionalUuid: (id) => id,
      pgDatabasePool: db,
      provisionLeadClientEvolutionInstance: vi.fn(),
      requireAdminAccess: (_req, _res, next) => next && next(),
      requireAnyInternalPageAccess: () => (_req, _res, next) => next && next(),
      requireAppViewAccess: (_req, _res, next) => next && next(),
      requireFirebaseAuth: (_req, _res, next) => next && next(),
      resolveAuthorizedClientId: () => clientId,
      sendError,
      supabase: null,
      upsertLeadClientEvolutionInstance: vi.fn(),
      upsertLeadClientN8nSettings: vi.fn(),
    });

    expect(deleteHandler).toBeDefined();

    const req = {
      params: { tenantId: clientId, instanceId: chipId },
    };
    let responseStatus = 200;
    let responseBody = null;
    const res = {
      status: vi.fn((code) => {
        responseStatus = code;
        return res;
      }),
      json: vi.fn((data) => {
        responseBody = data;
        return res;
      }),
      req: { headers: {} },
      setHeader: vi.fn(),
      getHeader: vi.fn(() => null),
    };

    await deleteHandler(req, res);

    expect(responseStatus).toBe(409);
    expect(responseBody?.error?.code).toBe("CHIP_IN_USE_BY_DISPATCH");
    expect(responseBody?.error?.details?.dispatches).toEqual([
      { id: "disp-1", name: "Lote Rodando", status: "running" },
    ]);
  });
});
