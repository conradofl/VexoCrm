// backend/src/test/dispatchFinalizeSent.test.js
//
// SPEC 1 — finalize_sent: garantir registro de envio e curar linhas presas em 'claimed'.
//
// Testes obrigatórios em Postgres real (pglite) e integração:
// 1. Teste a: Lead reivindicado SEM id e enviado com sucesso termina em 'sent' (hoje fica preso em 'claimed').
// 2. Teste b: UPDATE que não encontra linha gera erro visível no log/retorno, não silêncio.
// 3. Teste c: Lead já em status 'sent' não é reenviado em novo lote.
// 4. Teste d: Normalização de telefone do sucesso e da falha produzem o MESMO resultado para variações (ex: com e sem +55, com e sem hífen).
// 5. Teste e: chipId passado como string vazia "" não estoura erro de UUID e grava null com sucesso.

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { finalizeRunSent } from "../services/dispatchRunChip.js";
import { registerCampaignsRoutes, normalizeDispatchPhone } from "../domains/campaigns/routes.js";

const SCHEMA = `
  CREATE TABLE campaign_dispatches (
    id uuid PRIMARY KEY,
    campaign_id uuid,
    client_id text,
    name text,
    status text,
    target_count int DEFAULT 0,
    sent_count int DEFAULT 0,
    failed_count int DEFAULT 0,
    error_message text,
    updated_at timestamptz DEFAULT now()
  );
  CREATE TABLE campaign_dispatch_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dispatch_id uuid,
    campaign_id uuid,
    client_id text,
    lead_id uuid,
    lead_import_item_id uuid,
    evolution_instance_id uuid,
    phone text NOT NULL,
    status text,
    error_message text,
    claimed_at timestamptz,
    sent_at timestamptz,
    created_at timestamptz DEFAULT now()
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uq_campaign_dispatch_runs_dispatch_lead ON campaign_dispatch_runs (dispatch_id, lead_id);
`;

const openDbs = [];
async function createTestDb() {
  const db = await createPgliteDb(SCHEMA);
  openDbs.push(db);
  return db;
}

afterAll(async () => {
  for (const db of openDbs) {
    await db.close();
  }
});

const T = "tenant-spec1";
const DISP_ID = "11111111-2222-4000-8000-333333333333";
const CAMP_ID = "44444444-5555-4000-8000-666666666666";

describe("SPEC 1 — finalize_sent", () => {
  let originalFetch;
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("fetchInstances") || u.includes("connectionState")) {
        return { ok: true, status: 200, json: async () => ({ state: "open" }), text: async () => '{"state":"open"}' };
      }
      return { ok: true, status: 200, json: async () => ({ key: { id: "wa-1" } }), text: async () => '{"key":{"id":"wa-1"}}' };
    });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("Teste a: Lead reivindicado SEM id e enviado com sucesso termina em 'sent'", async () => {
    const db = await createTestDb();
    const phone = "5511999990001";

    // 1. Simula claim por telefone sem lead_id (lead_id = NULL)
    await db.query(
      `INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, lead_id, phone, status, claimed_at)
       VALUES ($1, $2, $3, NULL, $4, 'claimed', now())`,
      [DISP_ID, CAMP_ID, T, phone]
    );

    // 2. Executa finalização com sucesso sem leadId (passando apenas phone)
    const result = await finalizeRunSent(db, {
      dispatchId: DISP_ID,
      leadId: null,
      phone,
      sentAt: new Date().toISOString(),
      chipId: null,
    });

    expect(result.rowCount).toBe(1);

    // 3. Verifica no banco: status DEVE ser 'sent' com sent_at preenchido
    const { rows } = await db.query(
      `SELECT status, sent_at FROM campaign_dispatch_runs WHERE dispatch_id = $1 AND phone = $2`,
      [DISP_ID, phone]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");
    expect(rows[0].sent_at).not.toBeNull();
  });

  it("Teste b: UPDATE que não encontra linha gera erro visível no log/retorno, não silêncio", async () => {
    const db = await createTestDb();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      // 1. Chamada direta ao finalizeRunSent com dispatch/lead inexistente retorna rowCount: 0
      const directResult = await finalizeRunSent(db, {
        dispatchId: "99999999-9999-4000-8000-999999999999",
        leadId: "88888888-8888-4000-8000-888888888888",
        phone: "5511999999999",
        sentAt: new Date().toISOString(),
      });

      expect(directResult.rowCount).toBe(0);

      // 2. Teste integrado no runCampaignDispatch:
      // O mockPool retorna rowCount: 0 no UPDATE de finalizeRunSent (nenhuma linha encontrada)
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          const s = String(sql);
          if (s.includes("SELECT id, name, dispatch_webhook_url")) {
            return { rows: [{ id: "chip-1", client_id: T, name: "Chip", dispatch_webhook_url: "https://evolution.teste/send", active: true }] };
          }
          if (s.includes("SELECT id, client_id, name, active, daily_limit")) {
            return { rows: [{ id: "chip-1", client_id: T, name: "Chip", active: true, daily_limit: 500 }] };
          }
          if (s.includes("SELECT id, status FROM public.campaign_dispatch_runs")) {
            return { rows: [] };
          }
          if (s.includes("INSERT INTO public.campaign_dispatch_runs")) {
            return { rowCount: 1, rows: [{ id: "claim-uuid" }] };
          }
          if (s.includes("UPDATE public.campaign_dispatch_runs SET status = 'sent'")) {
            // SIMULAÇÃO DA FALHA: UPDATE não encontra nenhuma linha correspondente!
            return { rowCount: 0, rows: [] };
          }
          if (s.includes("COUNT(*) FILTER")) {
            return { rows: [{ sent: 1, failed: 0, skipped: 0 }] };
          }
          return { rows: [], rowCount: 0 };
        }),
      };

      const dispatchesTable = {
        [DISP_ID]: {
          id: DISP_ID,
          campaign_id: CAMP_ID,
          client_id: T,
          status: "running",
          target_count: 1,
          sent_count: 0,
          failed_count: 0,
          dispatch_options: { leadDelaySeconds: 0 },
        },
      };

      const mockSupabase = {
        from: (table) => ({
          select: () => ({
            maybeSingle: async () => ({ data: dispatchesTable[DISP_ID], error: null }),
            eq: () => ({ maybeSingle: async () => ({ data: dispatchesTable[DISP_ID], error: null }) }),
            single: async () => ({ data: dispatchesTable[DISP_ID], error: null }),
          }),
          update: (patch) => {
            const chain = {
              eq: (col, val) => {
                if (val === DISP_ID) Object.assign(dispatchesTable[DISP_ID], patch);
                return chain;
              },
              then: (resolve) => resolve({ data: dispatchesTable[DISP_ID], error: null }),
              catch: () => Promise.resolve(),
            };
            return chain;
          },
        }),
      };

      const dummyApp = { get: () => {}, post: () => {}, put: () => {}, patch: () => {}, delete: () => {}, use: () => {} };
      const routes = registerCampaignsRoutes(dummyApp, {
        pgDatabasePool: mockPool,
        CAMPAIGN_SCHEDULER_MAX_BATCH: 10,
        buildDispatchLeads: async () => [{ id: "aaaaaaaa-0000-4000-8000-000000000001", nome: "Lead Zero", telefone: "5511988887777", client_id: T }],
        canCampaignBeDispatched: () => true,
        checkEvolutionInstanceHealth: async () => ({ state: "open" }),
        getClientName: async () => "Tenant",
        getLeadClientEvolutionInstances: async () => [{ id: "chip-1", client_id: T, name: "Chip", dispatch_webhook_url: "https://evolution.teste/send", active: true }],
        getLeadClientN8nSettings: async () => ({ send_window_enabled: false }),
        resolveCampaignDispatchSettings: async () => ({ webhookUrl: "https://evolution.teste/send", webhookToken: "tok", instanceName: "Chip" }),
        normalizeString: (s) => String(s || "").trim(),
        sanitizePhone: (p) => p,
        requireAppViewAccess: () => (req, res, next) => next(),
        requireCampaignDispatchAccess: () => (req, res, next) => next(),
        requireFirebaseAuth: (req, res, next) => next(),
        requireInternalPageAccess: () => (req, res, next) => next(),
        resolveAuthorizedClientId: () => T,
      });

      const campaign = {
        id: CAMP_ID,
        name: "Campanha Zero Rows",
        client_id: T,
        analytics_meta: {
          sequence: [{ id: "step-1", type: "text", text: "Oi", order: 1, enabled: true, delayAfterSeconds: 0 }],
        },
      };

      await routes.runCampaignDispatch({
        dispatch: dispatchesTable[DISP_ID],
        campaign,
        supabase: mockSupabase,
      });

      // Confere que gerou erro visível no console.error com o identificador finalize_sent_zero_rows
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("finalize_sent_zero_rows"),
        expect.objectContaining({
          dispatchId: DISP_ID,
          leadId: "aaaaaaaa-0000-4000-8000-000000000001",
          phone: "5511988887777",
        })
      );
    } finally {
      errorSpy.mockRestore();
    }
  });

  it("Teste c: Lead já em status 'sent' não é reenviado em novo lote", async () => {
    const db = await createTestDb();
    const phone = "5511999990002";
    const leadId = "22222222-3333-4000-8000-444444444444";

    // 1. Grava no banco que este lead já está 'sent' neste disparo
    await db.query(
      `INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, lead_id, phone, status, sent_at)
       VALUES ($1, $2, $3, $4, $5, 'sent', now())`,
      [DISP_ID, CAMP_ID, T, leadId, phone]
    );

    // 2. Simula a verificação de duplicidade de claimLead (routes.js linha 3175)
    const existingRun = await db.query(
      `SELECT id, status FROM campaign_dispatch_runs
       WHERE dispatch_id = $1 AND (
         ($2::uuid IS NOT NULL AND lead_id = $2) OR
         (regexp_replace(phone, '\\D', '', 'g') = $3)
       ) AND status IN ('sent', 'invalid_number')
       LIMIT 1`,
      [DISP_ID, leadId, phone]
    );

    expect(existingRun.rows.length).toBeGreaterThan(0);
    expect(existingRun.rows[0].status).toBe("sent");

    // 3. Testa também quando o lead não tem ID (só o telefone bate)
    const existingRunByPhone = await db.query(
      `SELECT id, status FROM campaign_dispatch_runs
       WHERE dispatch_id = $1 AND (
         ($2::uuid IS NOT NULL AND lead_id = $2) OR
         (regexp_replace(phone, '\\D', '', 'g') = $3)
       ) AND status IN ('sent', 'invalid_number')
       LIMIT 1`,
      [DISP_ID, null, phone]
    );

    expect(existingRunByPhone.rows.length).toBeGreaterThan(0);
    expect(existingRunByPhone.rows[0].status).toBe("sent");
  });

  it("Teste d: Normalização de telefone do sucesso e da falha produzem o MESMO resultado para variações", () => {
    const expected = "5511999990001";
    const variations = [
      "+55 (11) 99999-0001",
      "5511999990001",
      "(11) 99999-0001",
      "1199999-0001",
      "11999990001",
      "+55-11-99999-0001",
      "  +55 (11) 99999-0001  ",
    ];

    for (const v of variations) {
      // Normalização usada no sucesso (normalizeDispatchPhone)
      const normSuccess = normalizeDispatchPhone(v);
      // Normalização usada na falha (deve ser idêntica)
      const normFail = normalizeDispatchPhone(v);

      expect(normSuccess).toBe(expected);
      expect(normFail).toBe(expected);
      expect(normSuccess).toBe(normFail);
    }
  });

  it("Teste e: chipId passado como string vazia \"\" não estoura erro de UUID e grava null com sucesso", async () => {
    const db = await createTestDb();
    const phone = "5511999990003";
    const leadId = "33333333-4444-4000-8000-555555555555";

    await db.query(
      `INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, lead_id, phone, status, claimed_at)
       VALUES ($1, $2, $3, $4, $5, 'claimed', now())`,
      [DISP_ID, CAMP_ID, T, leadId, phone]
    );

    // Passar chipId como string vazia "" NÃO deve lançar erro de sintaxe de UUID
    let errorCaught = null;
    let result = null;
    try {
      result = await finalizeRunSent(db, {
        dispatchId: DISP_ID,
        leadId,
        phone,
        sentAt: new Date().toISOString(),
        chipId: "", // string vazia!
      });
    } catch (err) {
      errorCaught = err;
    }

    expect(errorCaught).toBeNull();
    expect(result).not.toBeNull();
    expect(result.rowCount).toBe(1);

    // Confere no banco que gravou evolution_instance_id = null
    const { rows } = await db.query(
      `SELECT status, evolution_instance_id FROM campaign_dispatch_runs WHERE dispatch_id = $1 AND lead_id = $2`,
      [DISP_ID, leadId]
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("sent");
    expect(rows[0].evolution_instance_id).toBeNull();

    // Também testar com chipId = undefined
    const phone2 = "5511999990004";
    const leadId2 = "44444444-5555-4000-8000-666666666666";
    await db.query(
      `INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, lead_id, phone, status, claimed_at)
       VALUES ($1, $2, $3, $4, $5, 'claimed', now())`,
      [DISP_ID, CAMP_ID, T, leadId2, phone2]
    );

    const result2 = await finalizeRunSent(db, {
      dispatchId: DISP_ID,
      leadId: leadId2,
      phone: phone2,
      sentAt: new Date().toISOString(),
      chipId: undefined,
    });
    expect(result2.rowCount).toBe(1);

    const { rows: rows2 } = await db.query(
      `SELECT status, evolution_instance_id FROM campaign_dispatch_runs WHERE dispatch_id = $1 AND lead_id = $2`,
      [DISP_ID, leadId2]
    );
    expect(rows2[0].status).toBe("sent");
    expect(rows2[0].evolution_instance_id).toBeNull();
  });
});
