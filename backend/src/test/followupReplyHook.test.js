// Bloco 1 do follow-up, parte 2: a resposta do lead chega pelo webhook principal
// (/api/hardcoded-chat-webhook) e para a cadência.
//
// Postgres real (pglite) com o esquema das migrations do follow-up. Dublê só no que
// sai do processo. Nada aqui dubla registerFollowupReply nem o handler do webhook.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  COMPANY_A, COMPANY_A2, COMPANY_B, LEAD_PHONE,
  asPool, tolerantPool, getDb, setupFollowupReplyDb, closeFollowupReplyDb,
  createCadence, enroll, statusOf, addReply,
} from "./helpers/followupReplyDb.js";

vi.mock("../followup/db.js", async () => {
  const h = await import("./helpers/followupReplyDb.js");
  return { getPool: () => h.asPool(), query: (sql, params) => h.asPool().query(sql, params), getSupabase: () => ({}) };
});

const queueAdds = [];
vi.mock("../followup/queue.js", () => ({
  QUEUE_NAME: "followup-messages",
  getRedisConnection: () => ({}),
  getFollowupQueue: () => ({
    add: vi.fn(async (name, data, opts) => {
      queueAdds.push({ name, data, opts });
      return { id: `bull-${queueAdds.length}` };
    }),
  }),
}));

vi.mock("../services/evolution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getLeadClientEvolutionInstances: vi.fn(async () => [
      {
        id: "chip-1",
        name: "Chip 1",
        active: true,
        is_default: true,
        daily_limit_override: 500,
        dispatch_webhook_url: "https://evo.test/message/sendText/chip-1",
        dispatch_webhook_token: "tok-teste",
      },
    ]),
  };
});

vi.mock("../services/n8nSettings.js", () => ({
  getLeadClientN8nSettings: vi.fn(async () => ({ send_window_enabled: false })),
}));

import { registerFollowupReply } from "../services/followupReplyHook.js";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";
import { _resetInboundGuard } from "../services/inboundGuard.js";

let evolutionCalls = [];
beforeEach(async () => {
  queueAdds.length = 0;
  evolutionCalls = [];
  _resetInboundGuard();
  globalThis.fetch = vi.fn(async (url, opts) => {
    evolutionCalls.push({ url: String(url), body: opts?.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => ({}), text: async () => "" };
  });
  await setupFollowupReplyDb();
});

afterEach(async () => {
  await closeFollowupReplyDb();
});

describe("registerFollowupReply — o gancho", () => {
  it("registra a resposta sem o texto e cancela a cadência", async () => {
    const cad = await createCadence();
    const { scheduleId } = await enroll(cad);

    const res = await registerFollowupReply({
      tenantId: "t-a",
      phone: LEAD_PHONE,
      text: "Oi, pode me mandar o preço?",
      waMessageId: "WA-1",
      instanceName: "Chip 1",
      queryFn: asPool().query,
    });

    expect(res).toMatchObject({ matched: 1, recorded: 1, cancelledSchedules: 1 });
    const { rows } = await getDb().query(`SELECT company_id, campaign_id, phone, payload FROM followup_replies`);
    expect(rows).toHaveLength(1);
    expect(rows[0].campaign_id).toBe(cad.campaignId);
    expect(rows[0].payload).toEqual({ source: "hardcoded-chat-webhook", wa_message_id: "WA-1", instance: "Chip 1" });
    expect(JSON.stringify(rows[0].payload)).not.toContain("preço");
    expect(await statusOf("followup_schedules", scheduleId)).toBe("cancelled");
  });

  it("sem inscrição ativa não escreve nada", async () => {
    const res = await registerFollowupReply({ tenantId: "t-a", phone: LEAD_PHONE, text: "oi", queryFn: asPool().query });
    expect(res).toMatchObject({ matched: 0, recorded: 0 });
    const { rows } = await getDb().query(`SELECT count(*)::int AS n FROM followup_replies`);
    expect(rows[0].n).toBe(0);
  });

  it("exit_on_reply = false: registra a resposta mas não cancela", async () => {
    const cad = await createCadence({ exitOnReply: false });
    const { scheduleId } = await enroll(cad);

    const res = await registerFollowupReply({ tenantId: "t-a", phone: LEAD_PHONE, text: "oi", queryFn: asPool().query });

    expect(res).toMatchObject({ recorded: 1, cancelledSchedules: 0 });
    expect(await statusOf("followup_schedules", scheduleId)).toBe("active");
  });

  it("D1: resposta automática (URA/robô do lead) não conta", async () => {
    const cad = await createCadence();
    const { scheduleId } = await enroll(cad);

    const res = await registerFollowupReply({
      tenantId: "t-a",
      phone: LEAD_PHONE,
      text: "Olá! Este é um atendimento automático. Digite o número da opção desejada.",
      queryFn: asPool().query,
    });

    expect(res.skipped).toBe("resposta_automatica");
    expect(await statusOf("followup_schedules", scheduleId)).toBe("active");
  });

  it("sem tenant explícito não age", async () => {
    const cad = await createCadence();
    const { scheduleId } = await enroll(cad);
    const res = await registerFollowupReply({ tenantId: "", phone: LEAD_PHONE, text: "oi", queryFn: asPool().query });
    expect(res.skipped).toBe("tenant_implicito");
    expect(await statusOf("followup_schedules", scheduleId)).toBe("active");
  });
});

describe("webhook /api/hardcoded-chat-webhook → follow-up", () => {
  function setupWebhook(pool = tolerantPool()) {
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
      continueCampaignLeadFromReply: vi.fn(),
      findCampaignReplyMatches: vi.fn(async () => ({ matches: [], waitForReplyMatches: [], processingWaitForReplyMatches: [], activePeriodCampaign: null })),
      normalizeString: (s) => (s ? String(s).trim() : ""),
      normalizeTenantKey: (k) => (k ? String(k).trim() : ""),
      pgDatabasePool: pool,
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

  function inbound({ fromMe = false, clientId = "t-a", id = "WA-IN-1", event = "messages.upsert", remoteJid = `${LEAD_PHONE}@s.whatsapp.net`, text = "Tenho interesse, me conta mais" } = {}) {
    const body = {
      event,
      phone: LEAD_PHONE,
      instance: "Chip 1",
      data: { key: { remoteJid, fromMe, id }, message: { conversation: text }, messageTimestamp: 1788212600 },
    };
    if (clientId) body.clientId = clientId;
    return { body, query: {} };
  }

  async function call(handler, req) {
    let out = null;
    await handler(req, { json: vi.fn((d) => { out = d; }), status: vi.fn(function () { return this; }) });
    return out;
  }

  async function repliesCount() {
    const { rows } = await getDb().query(`SELECT count(*)::int AS n FROM followup_replies`);
    return rows[0].n;
  }

  it("T5: mensagem do lead cancela a cadência e grava a resposta sem texto", async () => {
    const cad = await createCadence();
    const { scheduleId, jobs } = await enroll(cad);
    const handler = setupWebhook();

    const out = await call(handler, inbound());

    expect(out?.success).not.toBe(false);
    expect(await statusOf("followup_schedules", scheduleId)).toBe("cancelled");
    expect(await statusOf("followup_jobs", jobs[0])).toBe("cancelled");
    const { rows } = await getDb().query(`SELECT payload FROM followup_replies`);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0].payload)).not.toContain("interesse");
  });

  it("T6: fromMe (o nosso próprio envio) não cancela nem grava", async () => {
    const cad = await createCadence();
    const { scheduleId } = await enroll(cad);
    const handler = setupWebhook();

    await call(handler, inbound({ fromMe: true, id: "WA-OUT-1" }));

    expect(await statusOf("followup_schedules", scheduleId)).toBe("active");
    expect(await repliesCount()).toBe(0);
  });

  it("T7: eco send.message, grupo e duplicado não contam", async () => {
    const cad = await createCadence();
    const { scheduleId } = await enroll(cad);
    const handler = setupWebhook();

    await call(handler, inbound({ event: "send.message", id: "WA-ECO" }));
    await call(handler, inbound({ remoteJid: "120363028374829@g.us", id: "WA-GRP" }));
    expect(await statusOf("followup_schedules", scheduleId)).toBe("active");

    await call(handler, inbound({ id: "WA-DUP" }));
    expect(await repliesCount()).toBe(1);
    // reenvio do mesmo id pela Evolution: não grava de novo
    await getDb().query(`UPDATE followup_schedules SET status = 'active' WHERE id = $1`, [scheduleId]);
    await call(handler, inbound({ id: "WA-DUP" }));
    expect(await repliesCount()).toBe(1);
  });

  it("T8: sem clientId explícito (cairia no fallback 'outlier') não age", async () => {
    const cad = await createCadence();
    const { scheduleId } = await enroll(cad);
    await getDb().query(`UPDATE followup_companies SET tenant_id = 'outlier' WHERE id = $1`, [COMPANY_A]);
    const handler = setupWebhook();

    await call(handler, inbound({ clientId: null }));

    expect(await statusOf("followup_schedules", scheduleId)).toBe("active");
    expect(await repliesCount()).toBe(0);
  });

  it("T9: falha do follow-up não derruba o webhook e cancela mesmo sem conseguir gravar", async () => {
    const cad = await createCadence();
    const { scheduleId } = await enroll(cad);
    await getDb().exec(`DROP TABLE followup_replies CASCADE`);
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = setupWebhook();

    const out = await call(handler, inbound());

    expect(out).not.toBeNull();
    expect(await statusOf("followup_schedules", scheduleId)).toBe("cancelled");
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes("[followup-reply-hook] falha ao registrar resposta"))).toBe(true);
    errSpy.mockRestore();
  });
});
