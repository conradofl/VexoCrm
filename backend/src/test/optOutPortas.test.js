// backend/src/test/optOutPortas.test.js
//
// Quem pediu para sair não recebe de NENHUMA porta automática fora do lote e da fila (esses estão em
// campaignLoteOptOut.test.js e campaignQueueFreios.test.js; o ponto comum de envio de campanha, em optOutFonteUnica.test.js):
//   - cadência de follow-up: o worker não envia e a inscrição não cria linha;
//   - webhook de entrada: não chega no roteamento de campanha (próximo passo) nem no agente de IA;
//   - continueCampaignLeadFromReply (próximo passo por resposta): sai antes de mexer em qualquer coisa.
//
// Postgres real (pglite) com o esquema das migrations do follow-up + a migration da fonte única. Dublê só no que sai do
// processo: fila (Redis), HTTP da Evolution, configurações do tenant e lista de chips.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMPANY_A, LEAD_PHONE,
  asPool, tolerantPool, getDb, setupFollowupReplyDb, closeFollowupReplyDb,
  createCadence, enroll, statusOf,
} from "./helpers/followupReplyDb.js";

vi.mock("../followup/db.js", async () => {
  const h = await import("./helpers/followupReplyDb.js");
  return { getPool: () => h.asPool(), query: (sql, params) => h.asPool().query(sql, params), getSupabase: () => ({}) };
});

vi.mock("../followup/queue.js", () => ({
  QUEUE_NAME: "followup-messages",
  getRedisConnection: () => ({}),
  getFollowupQueue: () => ({ add: vi.fn(async () => ({ id: "bull-1" })) }),
}));

vi.mock("../services/evolution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getLeadClientEvolutionInstances: vi.fn(async () => [
      {
        id: "chip-1", name: "Chip 1", active: true, is_default: true, daily_limit_override: 500,
        dispatch_webhook_url: "https://evo.test/message/sendText/chip-1", dispatch_webhook_token: "tok-teste",
      },
    ]),
  };
});

vi.mock("../services/n8nSettings.js", () => ({
  getLeadClientN8nSettings: vi.fn(async () => ({ send_window_enabled: false })),
}));

import { processJob } from "../followup/worker.js";
import { enrollLead } from "../followup/service.js";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";
import { continueCampaignLeadFromReply } from "../campaign/dispatch.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { registerOptOut, revokeOptOut } from "../services/optOut.js";

const MIGRATION = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations", "20261112010000_lead_optouts_fonte_unica.sql");
const TENANT = "t-a"; // tenant da COMPANY_A no helper

let evolutionCalls = [];
beforeEach(async () => {
  evolutionCalls = [];
  globalThis.fetch = vi.fn(async (url, opts) => {
    evolutionCalls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  await setupFollowupReplyDb();
  // A migration lê a marca antiga em public.leads: o banco do follow-up não tem a tabela, então entra uma mínima.
  await getDb().exec(`
    CREATE TABLE public.leads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text NOT NULL, telefone text, opt_out boolean DEFAULT false,
      metadata jsonb DEFAULT '{}'::jsonb, dados jsonb DEFAULT '{}'::jsonb, updated_at timestamptz DEFAULT now()
    );
  `);
  await getDb().exec(await readFile(MIGRATION, "utf8"));
});

afterEach(async () => {
  _setPgDatabasePoolForTesting(null);
  vi.restoreAllMocks();
  await closeFollowupReplyDb();
});

const pedirSaida = (extra = {}) => registerOptOut(asPool(), { clientId: TENANT, phone: LEAD_PHONE, source: "sem_interesse", reason: "não tenho interesse", ...extra });

describe("cadência de follow-up", () => {
  it("[OBRIGATÓRIO] o worker NÃO envia passo de cadência a quem pediu para sair: job 'skipped' e nenhuma chamada à Evolution", async () => {
    const cad = await createCadence();
    const { jobs } = await enroll(cad);
    await pedirSaida();

    await processJob({ data: { jobId: jobs[0] } });

    expect(await statusOf("followup_jobs", jobs[0])).toBe("skipped");
    expect(evolutionCalls).toHaveLength(0);
    const { rows } = await getDb().query("SELECT error_log FROM followup_jobs WHERE id = $1", [jobs[0]]);
    expect(rows[0].error_log).toMatch(/opt-out/i);
  });

  it("o mesmo número com outra grafia na inscrição também é pego", async () => {
    const cad = await createCadence();
    const { jobs } = await enroll({ ...cad, phone: "3491093607" }); // sem 55 e sem o 9
    await pedirSaida();
    await processJob({ data: { jobId: jobs[0] } });
    expect(await statusOf("followup_jobs", jobs[0])).toBe("skipped");
    expect(evolutionCalls).toHaveLength(0);
  });

  it("regressão: sem pedido de saída, e com pedido REVOGADO, o passo sai", async () => {
    const cad = await createCadence({ steps: [{ trigger_type: "after_enrollment" }, { trigger_type: "after_enrollment" }] });
    const { jobs } = await enroll(cad);

    await processJob({ data: { jobId: jobs[0] } });
    expect(await statusOf("followup_jobs", jobs[0])).toBe("sent");

    await pedirSaida();
    await revokeOptOut(asPool(), { clientId: TENANT, phone: LEAD_PHONE, revokedBy: "operador" });
    await processJob({ data: { jobId: jobs[1] } });
    expect(await statusOf("followup_jobs", jobs[1])).toBe("sent");
    expect(evolutionCalls.filter((c) => /sendText/.test(c.url))).toHaveLength(2);
  });

  it("pedido de saída de OUTRA empresa não segura a cadência desta", async () => {
    const cad = await createCadence();
    const { jobs } = await enroll(cad);
    await registerOptOut(asPool(), { clientId: "t-b", phone: LEAD_PHONE, source: "palavra" });
    await processJob({ data: { jobId: jobs[0] } });
    expect(await statusOf("followup_jobs", jobs[0])).toBe("sent");
  });

  it("[OBRIGATÓRIO] a inscrição recusa quem pediu para sair e não cria linha nenhuma", async () => {
    const cad = await createCadence();
    await pedirSaida();

    const res = await enrollLead({ id: cad.campaignId, company_id: COMPANY_A }, { lead_name: "Lead", phone: "(34) 99109-3607" });

    expect(res).toMatchObject({ scheduleId: null, enqueued: 0, reason: "opt_out" });
    expect((await getDb().query("SELECT count(*)::int AS n FROM followup_schedules")).rows[0].n).toBe(0);
    expect((await getDb().query("SELECT count(*)::int AS n FROM followup_jobs")).rows[0].n).toBe(0);
  });
});

describe("webhook de entrada (/api/hardcoded-chat-webhook)", () => {
  function setupWebhook({ findCampaignReplyMatches, continuar }) {
    const routes = {};
    const register = (method) => vi.fn((p, ...handlers) => { routes[`${method} ${p}`] = handlers[handlers.length - 1]; });
    const app = { post: register("POST"), get: register("GET"), delete: register("DELETE"), put: register("PUT"), patch: register("PATCH") };
    const chain = () => {
      const c = {
        select: vi.fn(() => c), eq: vi.fn(() => c), in: vi.fn(() => c), gte: vi.fn(() => c), is: vi.fn(() => c),
        order: vi.fn(() => c), limit: vi.fn(() => c),
        maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        single: vi.fn(async () => ({ data: null, error: null })),
        then: (resolve) => resolve({ data: [], error: null }),
      };
      return c;
    };
    const supabase = {
      from: vi.fn(() => ({
        ...chain(),
        insert: vi.fn(async (payload) => ({ data: payload, error: null })),
        update: vi.fn(() => ({ eq: vi.fn(() => ({ in: vi.fn(async () => ({})), is: vi.fn(async () => ({})) })) })),
      })),
    };
    registerChatbotRoutes(app, {
      ensureDb: () => true,
      getLeadClientEvolutionInstances: async () => [],
      getLeadClientN8nSettings: async (clientId) => ({ clientId, chatbot_enabled: false }),
      internalErrorPayloadDetails: () => ({}),
      isMissingSchemaError: () => false,
      leadsTableName: (c) => `leads_${c}`,
      maskPhoneForLog: (p) => p,
      MAX_LEADS_OUTLIER_BATCH: 100,
      continueCampaignLeadFromReply: continuar,
      findCampaignReplyMatches,
      normalizeString: (s) => (s ? String(s).trim() : ""),
      normalizeTenantKey: (k) => (k ? String(k).trim() : ""),
      pgDatabasePool: tolerantPool(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      requireFirebaseAuth: (_req, _res, next) => next(),
      resolveAuthorizedClientId: (_req, _res, cid) => cid,
      resolveDispatchWebhookSettings: async () => ({}),
      resolveInboundDispatchSettings: async () => ({}),
      sanitizePhone: (p) => String(p || "").replace(/@.*$/, "").replace(/\D/g, ""),
      sendError: vi.fn(),
      supabase,
      validateLeadsOutlierRecord: () => true,
      validateN8nInboundBearer: () => true,
    });
    return routes["POST /api/hardcoded-chat-webhook"];
  }

  const inbound = (id, text = "Oi, pode me explicar melhor?") => ({
    body: {
      event: "messages.upsert", phone: LEAD_PHONE, instance: "Chip 1", clientId: TENANT,
      data: { key: { remoteJid: `${LEAD_PHONE}@s.whatsapp.net`, fromMe: false, id }, message: { conversation: text }, messageTimestamp: 1788212600 },
    },
    query: {},
  });

  async function call(handler, req) {
    let out = null;
    await handler(req, { json: vi.fn((d) => { out = d; }), status: vi.fn(function () { return this; }) });
    return out;
  }

  const semCampanha = () => vi.fn(async () => ({ matches: [], waitForReplyMatches: [], processingWaitForReplyMatches: [], activePeriodCampaign: null }));

  it("[OBRIGATÓRIO] mensagem de quem pediu para sair NÃO chega no roteamento de campanha nem no agente de IA", async () => {
    await pedirSaida();
    const findCampaignReplyMatches = semCampanha();
    const continuar = vi.fn();
    const handler = setupWebhook({ findCampaignReplyMatches, continuar });

    const out = await call(handler, inbound("WA-OPT-1"));

    expect(out).toMatchObject({ success: true, status: "skipped_opt_out" });
    expect(findCampaignReplyMatches).not.toHaveBeenCalled(); // a ETAPA 4 (e o que vem depois dela) não rodou
    expect(continuar).not.toHaveBeenCalled();
    expect(evolutionCalls).toHaveLength(0); // nenhum envio
  });

  it("regressão: sem pedido de saída o webhook segue para o roteamento de campanha", async () => {
    const findCampaignReplyMatches = semCampanha();
    const handler = setupWebhook({ findCampaignReplyMatches, continuar: vi.fn() });
    const out = await call(handler, inbound("WA-LIVRE-1"));
    expect(out?.status).not.toBe("skipped_opt_out");
    expect(findCampaignReplyMatches).toHaveBeenCalled();
  });

  it("pedido revogado: o webhook volta a seguir", async () => {
    await pedirSaida();
    await revokeOptOut(asPool(), { clientId: TENANT, phone: LEAD_PHONE });
    const findCampaignReplyMatches = semCampanha();
    const handler = setupWebhook({ findCampaignReplyMatches, continuar: vi.fn() });
    await call(handler, inbound("WA-REV-1"));
    expect(findCampaignReplyMatches).toHaveBeenCalled();
  });
});

describe("continueCampaignLeadFromReply (próximo passo de campanha por resposta)", () => {
  it("[OBRIGATÓRIO] não continua para quem pediu para sair, e não lê nem escreve a campanha", async () => {
    await pedirSaida();
    const consultas = [];
    _setPgDatabasePoolForTesting({
      query: async (sql, params) => {
        consultas.push(String(sql));
        return asPool().query(sql, params);
      },
    });

    const res = await continueCampaignLeadFromReply({
      clientId: TENANT,
      phone: `${LEAD_PHONE}@s.whatsapp.net`,
      repliedAt: new Date().toISOString(),
      campaignMatch: { id: "11111111-1111-4111-8111-111111111111" },
    });

    expect(res).toEqual({ continued: false, reason: "opt_out" });
    expect(consultas.some((sql) => /campaigns/.test(sql))).toBe(false);
    expect(evolutionCalls).toHaveLength(0);
  });

  it("erro ao ler o opt-out não continua (nunca libera)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    _setPgDatabasePoolForTesting({ query: async () => { throw new Error("connection terminated unexpectedly"); } });
    const res = await continueCampaignLeadFromReply({
      clientId: TENANT, phone: LEAD_PHONE, repliedAt: new Date().toISOString(), campaignMatch: { id: "11111111-1111-4111-8111-111111111111" },
    });
    expect(res).toEqual({ continued: false, reason: "opt_out_check_failed" });
    expect(evolutionCalls).toHaveLength(0);
    errSpy.mockRestore();
  });
});
