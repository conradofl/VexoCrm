// Chip da resposta manual pela ROTA REAL (POST /api/whatsapp/messages e /messages/media), com
// lead_messages em Postgres em memória (PGlite). Dublê só no que sai do processo: autenticação,
// cadastro de chips, cliente Supabase (grava no mesmo banco em memória) e a Evolution (fetch).
//
// Prova, no servidor e não na tela:
//   1. a resposta sai pelo chip em que o lead escreveu, e é ESSE o chip gravado na mensagem;
//   2. chip da conversa desconectado: nada é enviado, nada é gravado, a rota devolve 409;
//   3. só com confirmação explícita a resposta sai por outro chip, e a troca fica registrada;
//   4. conversa sem chip gravado segue pelo chip padrão da empresa.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";

const TENANT = "hostery-tech";
const P = {
  noHostery: "5534990001001",
  noDesconectado: "5534990001002",
  semChip: "5534990001003",
  chipApagado: "5534990001004",
  soCampanha: "5534990001005",
  nonoDigito: "553490001006",
};

const chip = (id, name, extra = {}) => ({
  id,
  name,
  active: true,
  is_default: false,
  connection_state: "open",
  dispatch_webhook_url: `https://evolution.invalid/message/sendText/${id}`,
  dispatch_webhook_token: `token-${id}`,
  ...extra,
});

let db;
let routes;
let instances;
let liveState; // o que a Evolution responde em /instance/connectionState/<chip>
let evolutionCalls;
let sendError;

async function seed(phone, direction, minutesAgo, instanceName) {
  await db.query(
    `INSERT INTO public.lead_messages (client_id, phone, direction, sender_type, message_text, message_timestamp, instance_name)
     VALUES ($1,$2,$3,$4,'mensagem',now() - ($5 || ' minutes')::interval,$6)`,
    [TENANT, phone, direction, direction === "inbound" ? "lead" : "device", String(minutesAgo), instanceName]
  );
}

const sentRows = async (phone) =>
  (
    await db.query(
      `SELECT instance_name, message_text, meta FROM public.lead_messages
        WHERE client_id = $1 AND phone = $2 AND sender_type = 'agent' ORDER BY id`,
      [TENANT, phone]
    )
  ).rows;

async function call(path, body) {
  let status = 200;
  let payload = null;
  const res = {
    status: vi.fn((code) => {
      status = code;
      return res;
    }),
    json: vi.fn((data) => {
      payload = data;
    }),
  };
  await routes[`POST ${path}`]({ body: { clientId: TENANT, ...body }, authUser: { uid: "user-1" } }, res);
  return { status, payload };
}
const send = (phone, extra = {}) => call("/api/whatsapp/messages", { chatId: phone, body: "Olá, tudo bem?", ...extra });

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE public.lead_messages (
      id BIGSERIAL PRIMARY KEY,
      client_id TEXT, lead_id TEXT, campaign_id TEXT, phone TEXT, sender_type TEXT, direction TEXT,
      engagement_signal TEXT, message_text TEXT, delivered_at TIMESTAMPTZ, message_timestamp TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(), meta JSONB, instance_name TEXT, wa_message_id TEXT UNIQUE,
      media_path TEXT, media_url TEXT, content_type TEXT, dispatch_id TEXT, contact_name TEXT,
      is_group BOOLEAN DEFAULT false
    );
    CREATE TABLE public.whatsapp_chat_states (
      client_id TEXT NOT NULL, phone TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'ativa',
      agent_muted_at TIMESTAMPTZ, agent_muted_reason TEXT, agent_muted_source TEXT, agent_mute_last_human_at TIMESTAMPTZ,
      PRIMARY KEY (client_id, phone)
    );
  `);

  await seed(P.noHostery, "outbound", 90, "comercial-gabriel");
  await seed(P.noHostery, "inbound", 60, "comercial-hostery");
  await seed(P.noDesconectado, "inbound", 30, "chip-caido");
  await seed(P.semChip, "inbound", 30, null);
  await seed(P.chipApagado, "inbound", 30, "chip-que-saiu-do-cadastro");
  await seed(P.soCampanha, "outbound", 30, "comercial-hostery");
  // Gravado SEM o 9º dígito; a tela manda o número com o 9.
  await seed(P.nonoDigito, "inbound", 30, "comercial-hostery");

  const run = async (sql, params) => {
    try {
      return await db.query(sql, params);
    } catch (err) {
      if (err?.code === "42P01") return { rows: [], rowCount: 0 };
      throw err;
    }
  };
  const pool = { query: run, connect: async () => ({ query: run, release: () => {} }) };

  // Cliente Supabase de mentira: o insert de lead_messages cai no mesmo banco em memória.
  const builder = (table) => {
    const b = {
      select: () => b, eq: () => b, in: () => b, or: () => b, order: () => b, limit: () => b, neq: () => b, is: () => b,
      maybeSingle: async () => ({ data: null, error: null }),
      single: async () => ({ data: null, error: null }),
      then: (resolve) => resolve({ data: [], error: null }),
      update: () => b,
      insert: async (payload) => {
        if (table !== "lead_messages") return { data: null, error: null };
        const row = Array.isArray(payload) ? payload[0] : payload;
        await db.query(
          `INSERT INTO public.lead_messages (client_id, phone, sender_type, direction, message_text, delivered_at, message_timestamp, meta, instance_name, wa_message_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [row.client_id, row.phone, row.sender_type, row.direction, row.message_text, row.delivered_at || null,
            row.message_timestamp || null, row.meta ? JSON.stringify(row.meta) : null, row.instance_name || null, row.wa_message_id || null]
        );
        return { data: null, error: null };
      },
    };
    return b;
  };

  routes = {};
  const register = (method) => vi.fn((path, ...handlers) => {
    routes[`${method} ${path}`] = handlers[handlers.length - 1];
  });
  const app = { post: register("POST"), get: register("GET"), delete: register("DELETE"), put: register("PUT"), patch: register("PATCH") };

  registerChatbotRoutes(app, {
    ensureDb: () => true,
    getLeadClientEvolutionInstances: async () => instances,
    getLeadClientN8nSettings: async () => ({}),
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    leadsTableName: () => "leads",
    maskPhoneForLog: (p) => p,
    MAX_LEADS_OUTLIER_BATCH: 100,
    continueCampaignLeadFromReply: vi.fn(),
    findCampaignReplyMatches: async () => ({ matches: [], waitForReplyMatches: [], processingWaitForReplyMatches: [], activePeriodCampaign: null }),
    normalizeString: (s) => (s ? String(s).trim() : ""),
    normalizeTenantKey: (k) => k,
    pgDatabasePool: pool,
    requireAppViewAccess: () => (_req, _res, next) => next(),
    requireFirebaseAuth: (_req, _res, next) => next(),
    resolveAuthorizedClientId: (_req, _res, cid) => cid || TENANT,
    resolveDispatchWebhookSettings: async () => ({}),
    resolveInboundDispatchSettings: async () => ({}),
    sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
    sendError: (...args) => sendError(...args),
    supabase: { from: builder },
    validateLeadsOutlierRecord: () => true,
    validateN8nInboundBearer: () => true,
  });

  sendError = (res, status, code, message, details) => res.status(status).json({ error: { code, message, details } });
});

beforeEach(() => {
  instances = [
    chip("comercial-gabriel", "Comercial-Gabriel", { is_default: true }),
    chip("comercial-hostery", "Comercial-Hostery"),
    chip("chip-caido", "Chip Caído"),
  ];
  liveState = { "comercial-gabriel": "open", "comercial-hostery": "open", "chip-caido": "close" };
  evolutionCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, init = {}) => {
    const target = String(url);
    const probe = target.match(/\/instance\/connectionState\/([^/?]+)/);
    if (probe) {
      const state = liveState[decodeURIComponent(probe[1])];
      if (state === "erro") throw new Error("rede fora");
      return { ok: true, status: 200, json: async () => ({ instance: { state } }) };
    }
    evolutionCalls.push({ url: target, body: init.body ? JSON.parse(init.body) : null, apikey: init.headers?.apikey });
    return { ok: true, status: 200, text: async () => "{}", json: async () => ({ key: { id: `wa-${evolutionCalls.length}` } }) };
  }));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await db.query(`DELETE FROM public.lead_messages WHERE sender_type = 'agent'`);
});

afterAll(async () => {
  await db?.close();
});

describe("POST /api/whatsapp/messages — por qual chip a resposta sai", () => {
  it("sai pelo chip em que o lead escreveu, não pelo padrão, e é ele que fica gravado na mensagem", async () => {
    const { status, payload } = await send(P.noHostery);

    expect(status).toBe(201);
    expect(payload.item.sentByChip).toBe("Comercial-Hostery");
    expect(evolutionCalls).toHaveLength(1);
    expect(evolutionCalls[0].url).toBe("https://evolution.invalid/message/sendText/comercial-hostery");
    expect(evolutionCalls[0].apikey).toBe("token-comercial-hostery");

    const rows = await sentRows(P.noHostery);
    expect(rows).toHaveLength(1);
    expect(rows[0].instance_name).toBe("comercial-hostery");
    expect(rows[0].meta.instanceId).toBe("comercial-hostery");
    expect(rows[0].meta.replyChipReason).toBe("conversation_chip");
  });

  it("acha o chip da conversa mesmo quando o telefone está gravado sem o 9º dígito", async () => {
    const { status } = await send("5534990001006");
    expect(status).toBe(201);
    expect(evolutionCalls[0].url).toContain("/comercial-hostery");
  });

  it("conversa em que só a empresa escreveu usa o chip da última mensagem enviada", async () => {
    const { status } = await send(P.soCampanha);
    expect(status).toBe(201);
    expect(evolutionCalls[0].url).toContain("/comercial-hostery");
  });

  it("chip da conversa desconectado: não envia, não grava e devolve 409 com as alternativas", async () => {
    const { status, payload } = await send(P.noDesconectado);

    expect(status).toBe(409);
    expect(payload.error.code).toBe("REPLY_CHIP_UNAVAILABLE");
    expect(payload.error.message).toContain("Chip Caído");
    expect(payload.error.message).toContain("desconectado");
    expect(payload.error.details.reason).toBe("disconnected");
    expect(payload.error.details.alternatives.map((c) => c.name)).toEqual(["Comercial-Gabriel", "Comercial-Hostery"]);
    expect(evolutionCalls).toHaveLength(0);
    expect(await sentRows(P.noDesconectado)).toHaveLength(0);
  });

  it("o estado ao vivo da Evolution vence o cadastro: 'open' gravado mas caído agora também pede confirmação", async () => {
    liveState["comercial-hostery"] = "close";
    const { status } = await send(P.noHostery);
    expect(status).toBe(409);
    expect(evolutionCalls).toHaveLength(0);
  });

  it("sem resposta da Evolution na conferência, vale o estado gravado no cadastro", async () => {
    liveState["comercial-hostery"] = "erro";
    expect((await send(P.noHostery)).status).toBe(201);

    instances[1].connection_state = "close";
    expect((await send(P.noHostery)).status).toBe(409);
  });

  it("chip da conversa desativado no cadastro pede confirmação", async () => {
    instances[1].active = false;
    const { status, payload } = await send(P.noHostery);
    expect(status).toBe(409);
    expect(payload.error.details.reason).toBe("disconnected");
    expect(evolutionCalls).toHaveLength(0);
  });

  it("chip da conversa que saiu do cadastro pede confirmação", async () => {
    const { status, payload } = await send(P.chipApagado);
    expect(status).toBe(409);
    expect(payload.error.details.reason).toBe("not_registered");
    expect(evolutionCalls).toHaveLength(0);
    expect(await sentRows(P.chipApagado)).toHaveLength(0);
  });

  it("com confirmação explícita sai pelo chip confirmado e a troca fica gravada na mensagem", async () => {
    const { status, payload } = await send(P.noDesconectado, { confirmChipId: "comercial-gabriel" });

    expect(status).toBe(201);
    expect(payload.item.sentByChip).toBe("Comercial-Gabriel");
    expect(evolutionCalls[0].url).toContain("/comercial-gabriel");

    const [row] = await sentRows(P.noDesconectado);
    expect(row.instance_name).toBe("comercial-gabriel");
    expect(row.meta.replyChipReason).toBe("confirmed_other");
    expect(row.meta.conversationChip).toBe("chip-caido");
    expect(row.meta.chipConfirmedBy).toBe("user-1");
  });

  it("confirmação de chip que não é desta empresa, ou está desativado, é recusada sem enviar", async () => {
    expect((await send(P.noDesconectado, { confirmChipId: "chip-de-outra-empresa" })).status).toBe(409);
    instances[0].active = false;
    const { status, payload } = await send(P.noDesconectado, { confirmChipId: "comercial-gabriel" });
    expect(status).toBe(409);
    expect(payload.error.details.reason).toBe("invalid_confirmation");
    expect(evolutionCalls).toHaveLength(0);
  });

  it("conversa sem chip gravado segue pelo chip padrão da empresa", async () => {
    const { status } = await send(P.semChip);
    expect(status).toBe(201);
    expect(evolutionCalls[0].url).toContain("/comercial-gabriel");
    const [row] = await sentRows(P.semChip);
    expect(row.instance_name).toBe("comercial-gabriel");
    expect(row.meta.replyChipReason).toBe("no_conversation_chip");
  });

  it("empresa sem chip ativo continua devolvendo 400", async () => {
    instances = [chip("comercial-gabriel", "Comercial-Gabriel", { active: false })];
    const { status, payload } = await send(P.semChip);
    expect(status).toBe(400);
    expect(payload.error.code).toBe("NO_ACTIVE_WHATSAPP_CHIP");
  });
});

describe("POST /api/whatsapp/messages/media — mesma regra para áudio, imagem e arquivo", () => {
  const media = (phone, extra = {}) =>
    call("/api/whatsapp/messages/media", { chatId: phone, mediaType: "document", base64: "aGVsbG8=", mimetype: "application/pdf", fileName: "proposta.pdf", ...extra });

  it("sai pelo chip da conversa e grava esse chip", async () => {
    const { status } = await media(P.noHostery);
    expect(status).toBe(201);
    expect(evolutionCalls).toHaveLength(1);
    expect(evolutionCalls[0].url).toContain("/comercial-hostery");
    const [row] = await sentRows(P.noHostery);
    expect(row.instance_name).toBe("comercial-hostery");
  });

  it("chip da conversa desconectado: 409, nada enviado", async () => {
    const { status, payload } = await media(P.noDesconectado);
    expect(status).toBe(409);
    expect(payload.error.code).toBe("REPLY_CHIP_UNAVAILABLE");
    expect(evolutionCalls).toHaveLength(0);
    expect(await sentRows(P.noDesconectado)).toHaveLength(0);
  });
});
