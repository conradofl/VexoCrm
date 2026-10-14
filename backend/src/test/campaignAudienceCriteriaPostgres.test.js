// backend/src/test/campaignAudienceCriteriaPostgres.test.js
//
// BLOCO 1 — Gravar critério do público na campanha
// Prova que ao criar campanha com 2 tags + 1 estágio em analyticsMeta.audienceCriteria,
// o objeto é persistido no banco de dados Postgres e devolvido com as 2 tags intactas.

import express from "express";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";

const SLOW = 30_000;
const T = "tenant-audience-test";
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");

const BASE_SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.leads_clients (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
    nome TEXT, telefone TEXT, tipo_cliente TEXT, faixa_consumo TEXT, qualificacao TEXT, cidade TEXT, estado TEXT, status TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    import_id UUID,
    limit_per_run INT,
    webhook_url TEXT,
    webhook_token TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    scheduled_for TIMESTAMPTZ,
    last_triggered_at TIMESTAMPTZ,
    archived_at TIMESTAMPTZ,
    analytics_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    campaign_prompt_id UUID,
    mode TEXT,
    created_by_uid TEXT,
    created_by_email TEXT,
    starts_at TIMESTAMPTZ,
    ends_at TIMESTAMPTZ,
    chatbot_prompt_type TEXT NOT NULL DEFAULT 'campanha',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaign_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
    client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    steps JSONB NOT NULL DEFAULT '[]'::jsonb,
    trigger_type TEXT NOT NULL DEFAULT 'manual',
    scheduled_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'draft',
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    triggered_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error_message TEXT,
    limit_per_run INTEGER,
    "offset" INTEGER,
    campaign_prompt_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

const openDbs = [];
async function banco() {
  const db = await createPgliteDb(BASE_SCHEMA);
  openDbs.push(db);
  for (const file of [
    "20261008180000_add_recurrence_to_campaigns.sql",
    "20261012120000_campaign_recurrence_occurrences.sql",
  ]) {
    const sql = await readFile(join(MIGRATIONS, file), "utf-8");
    await db.exec(sql);
  }
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, $2)", [T, "Cliente Teste Audience"]);
  const pool = {
    query: (text, params) => db.query(text, params),
    connect: async () => ({
      query: (text, params) => db.query(text, params),
      release: () => {},
    }),
  };
  return { db, pool };
}

async function servidor(pool) {
  const app = express();
  app.use(express.json());
  const supabase = createPgSupabaseClient(pool);
  _setPgDatabasePoolForTesting(pool);

  const deps = {
    ensureDb: (res) => true,
    getCampaignDispatchAccessStatus: async () => ({ allowed: true }),
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    isProduction: false,
    logCampaignReplyFlow: () => {},
    logDirectDispatch: () => {},
    maskPhoneForLog: (p) => p,
    normalizeIsoDate: (d) => d,
    getLeadClientN8nSettings: async () => ({ send_window_enabled: false }),
    leadsTableName: "leads",
    normalizeString: (s) => String(s || "").trim(),
    normalizeTenantKey: (s) => String(s || "").trim(),
    parseOptionalUuid: (s) => ({ value: s }),
    pgDatabasePool: pool,
    requireAppViewAccess: () => (req, res, next) => next(),
    requireCampaignDispatchAccess: (req, res, next) => next(),
    requireFirebaseAuth: (req, res, next) => next(),
    requireInternalPageAccess: () => (req, res, next) => next(),
    resolveAuthorizedClientId: () => T,
    resolveCampaignDispatchSettings: async () => ({ webhookUrl: null }),
    resolveDispatchWebhookSettings: async () => ({}),
    runDueCampaignDispatches: async () => {},
    sanitizePhone: (p) => p,
    sendError: (res, status, code, message) => res.status(status).json({ error: { code, message } }),
    supabase,
    validateN8nInboundBearer: () => true,
  };

  registerCampaignsRoutes(app, deps);

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, body) => {
    const resp = await fetch(url + path, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: resp.status, json: await resp.json() };
  };
  return { call, close: () => new Promise((r) => server.close(r)) };
}

afterAll(async () => {
  for (const db of openDbs) {
    try {
      await db.close?.();
    } catch {}
  }
});

describe("BLOCO 1 — gravar critério do público na campanha (Postgres real)", () => {
  it("criar campanha com 2 tags + 1 estágio salva analytics_meta.audienceCriteria no banco com as 2 tags", async () => {
    const { db, pool } = await banco();
    const s = await servidor(pool);

    try {
      const criteriaPayload = {
        clientId: T,
        stages: ["cold"],
        tags: ["VIP", "Proposta"],
        rules: [],
        importId: null,
        importScope: "all",
        description: 'público: estágio Leads Frios, tags "VIP", "Proposta", 2 leads',
        totalCount: 2,
        savedAt: "2026-10-13T23:00:00.000Z",
      };

      const resp = await s.call("POST", "/api/campaigns", {
        name: "Campanha VIP e Proposta",
        clientId: T,
        mode: "disparo",
        importId: "__crm__",
        analyticsMeta: {
          sequence: [
            { id: "s1", type: "text", text: "Olá {{nome}}, temos uma proposta VIP.", order: 1, enabled: true, delayAfterSeconds: 0 },
          ],
          audienceCriteria: criteriaPayload,
        },
      });

      expect(resp.status).toBe(201);
      const campaignId = resp.json.item.id;
      expect(campaignId).toBeDefined();

      // Devolvido pela API
      expect(resp.json.item.analytics_meta.audienceCriteria).toBeDefined();
      expect(resp.json.item.analytics_meta.audienceCriteria.tags).toEqual(["VIP", "Proposta"]);
      expect(resp.json.item.analytics_meta.audienceCriteria.stages).toEqual(["cold"]);
      expect(resp.json.item.analytics_meta.audienceCriteria.totalCount).toBe(2);

      // Persistido diretamente no Postgres real
      const dbRes = await db.query("SELECT analytics_meta FROM campaigns WHERE id = $1", [campaignId]);
      expect(dbRes.rows).toHaveLength(1);
      const meta = dbRes.rows[0].analytics_meta;
      expect(meta.audienceCriteria).toBeDefined();
      expect(meta.audienceCriteria.tags).toEqual(["VIP", "Proposta"]);
      expect(meta.audienceCriteria.stages).toEqual(["cold"]);
      expect(meta.audienceCriteria.totalCount).toBe(2);
      expect(meta.audienceCriteria.description).toContain("VIP");
    } finally {
      await s.close();
    }
  }, SLOW);
});
