// "Nova conversa" pela ROTA REAL (POST /api/whatsapp/messages com newConversation), com
// lead_messages em Postgres em memória (PGlite). Dublê só no que sai do processo: autenticação,
// cadastro de chips, cliente Supabase (grava no mesmo banco em memória) e a Evolution (fetch).
//
// Prova, no servidor:
//   1. envia pelo chip escolhido e grava UMA mensagem, sender_type 'agent', telefone canônico;
//   2. se a conversa já existe (em qualquer grafia do número), nada é enviado e nada é gravado:
//      a resposta diz qual conversa abrir. Não nasce conversa duplicada;
//   3. número inválido, chip desconectado e número com opt-out: erro, nada enviado, nada gravado.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";

const TENANT = "hostery-tech";
const JA_EXISTE = "553490001006"; // gravado SEM o 9º dígito
const OPTOUT_TABELA = "5534977770001";
const OPTOUT_FLAG = "5534977770002";

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
const start = (phone, extra = {}) =>
  call("/api/whatsapp/messages", { chatId: phone, body: "Olá! Aqui é da Hostery.", newConversation: true, ...extra });
const allRows = async () => (await db.query(`SELECT phone, sender_type, direction, instance_name, meta FROM public.lead_messages ORDER BY id`)).rows;

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

  await db.exec(`
    CREATE TABLE public.lead_optouts (client_id TEXT, phone TEXT);
    CREATE TABLE public.leads (id TEXT, client_id TEXT, telefone TEXT, opt_out BOOLEAN, metadata JSONB, dados JSONB);
  `);
  await seed(JA_EXISTE, "inbound", 30, "comercial-hostery");
  // Opt-out gravado SEM o 9º dígito, do jeito que veio do webhook.
  await db.query(`INSERT INTO public.lead_optouts VALUES ($1, '553477770001')`, [TENANT]);
  await db.query(`INSERT INTO public.leads VALUES ('l1', $1, $2, true, '{}', '{}')`, [TENANT, OPTOUT_FLAG]);

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

describe("POST /api/whatsapp/messages com newConversation — Nova conversa", () => {
  it("envia pelo chip escolhido e grava uma mensagem de atendente, com o telefone na forma canônica", async () => {
    const { status, payload } = await start("(34) 9911-2233", { chipId: "comercial-hostery" });

    expect(status).toBe(201);
    expect(payload.chatId).toBe("5534999112233");
    expect(payload.item.sentByChip).toBe("Comercial-Hostery");
    expect(evolutionCalls).toHaveLength(1);
    expect(evolutionCalls[0].url).toBe("https://evolution.invalid/message/sendText/comercial-hostery");
    expect(evolutionCalls[0].body.number).toBe("5534999112233");
    expect(evolutionCalls[0].body.text).toBe("Olá! Aqui é da Hostery.");

    const rows = (await allRows()).filter((r) => r.phone === "5534999112233");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ sender_type: "agent", direction: "outbound", instance_name: "comercial-hostery" });
    expect(rows[0].meta.source).toBe("manual-inbox-reply"); // o mesmo registro da resposta manual
    expect(rows[0].meta.replyChipReason).toBe("new_conversation");
  });

  it("sem chip escolhido usa o chip padrão da empresa", async () => {
    const { status } = await start("34 99911-2244");
    expect(status).toBe(201);
    expect(evolutionCalls[0].url).toContain("/comercial-gabriel");
  });

  it("conversa que já existe: nada enviado, nada gravado, e a resposta diz qual conversa abrir", async () => {
    const before = (await allRows()).length;
    // A conversa está gravada sem o 9; a pessoa digita com o 9 e com máscara.
    const { status, payload } = await start("(34) 99000-1006", { chipId: "comercial-hostery" });

    expect(status).toBe(200);
    expect(payload).toEqual({ existing: true, chatId: "5534990001006" });
    expect(evolutionCalls).toHaveLength(0);
    expect((await allRows()).length).toBe(before);
  });

  it("mandar duas vezes para o mesmo número novo não cria duas conversas: a segunda só abre a primeira", async () => {
    expect((await start("34 99911-2255")).status).toBe(201);
    const second = await start("5534999112255");
    expect(second.status).toBe(200);
    expect(second.payload).toEqual({ existing: true, chatId: "5534999112255" });
    expect(evolutionCalls).toHaveLength(1);
    expect((await allRows()).filter((r) => r.phone === "5534999112255")).toHaveLength(1);
  });

  it.each([
    ["sem DDD", "99911-2233"],
    ["letras", "maria da silva"],
    ["dígitos de menos", "3499"],
    ["grupo", "120363000000000000@g.us"],
    ["DDD com zero", "(04) 99911-2233"],
  ])("número inválido (%s): erro, nada enviado", async (_name, phone) => {
    const before = (await allRows()).length;
    const { status, payload } = await start(phone);
    expect(status).toBe(422);
    expect(payload.error.code).toBe("INVALID_PHONE");
    expect(evolutionCalls).toHaveLength(0);
    expect((await allRows()).length).toBe(before);
  });

  it("chip escolhido desconectado: erro, nada enviado, e NÃO troca para outro chip", async () => {
    const { status, payload } = await start("34 99911-2266", { chipId: "chip-caido" });
    expect(status).toBe(409);
    expect(payload.error.code).toBe("CHIP_NOT_CONNECTED");
    expect(payload.error.message).toContain("Chip Caído");
    expect(evolutionCalls).toHaveLength(0);
    expect((await allRows()).filter((r) => r.phone === "5534999112266")).toHaveLength(0);
  });

  it("chip que consta conectado no cadastro mas caiu agora também é recusado", async () => {
    liveState["comercial-hostery"] = "close";
    expect((await start("34 99911-2277", { chipId: "comercial-hostery" })).status).toBe(409);
    expect(evolutionCalls).toHaveLength(0);
  });

  it("chip de outra empresa ou desativado: erro, nada enviado", async () => {
    const other = await start("34 99911-2288", { chipId: "chip-de-outra-empresa" });
    expect(other.status).toBe(409);
    expect(other.payload.error.code).toBe("CHIP_NOT_FOUND");
    expect(evolutionCalls).toHaveLength(0);
  });

  it("número com opt-out (na tabela, gravado sem o 9): aviso, nada enviado", async () => {
    const { status, payload } = await start(OPTOUT_TABELA, { chipId: "comercial-hostery" });
    expect(status).toBe(409);
    expect(payload.error.code).toBe("CONTACT_OPTED_OUT");
    expect(evolutionCalls).toHaveLength(0);
    expect((await allRows()).filter((r) => r.phone === OPTOUT_TABELA)).toHaveLength(0);
  });

  it("número com opt-out marcado no lead: aviso, nada enviado", async () => {
    const { status, payload } = await start(OPTOUT_FLAG);
    expect(status).toBe(409);
    expect(payload.error.code).toBe("CONTACT_OPTED_OUT");
    expect(evolutionCalls).toHaveLength(0);
  });

  it("a resposta manual comum continua igual: sem newConversation a rota não confere nada disso", async () => {
    const { status } = await call("/api/whatsapp/messages", { chatId: JA_EXISTE, body: "Oi de novo" });
    expect(status).toBe(201);
    expect(evolutionCalls[0].url).toContain("/comercial-hostery");
  });
});
