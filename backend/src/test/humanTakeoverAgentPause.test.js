// Etiqueta de atendimento humano (pedido da Container Led, 30/10/2026).
//
// O SQL roda de verdade num Postgres em memória (PGlite): o portão, o contador do
// freio diário, a limpeza por fromMe e a listagem de Conversas. Dublê só no que sai
// do processo: o cliente Supabase (grava em lead_messages do mesmo PGlite) e a
// Evolution/LLM, que este caminho nem chega a chamar.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";
import { countTenantMutedToday, recordAgentMute } from "../services/agentMuteGuard.js";
import { _resetInboundGuard } from "../services/inboundGuard.js";

const TENANT = "container-led";
const LEAD = "5534999990001";

let db;
let pool;

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
    CREATE TABLE public.leads (
      id TEXT, client_id TEXT, telefone TEXT, nome TEXT, lead_origin TEXT, source_campaign_id TEXT,
      assigned_to TEXT, assigned_at TIMESTAMPTZ
    );
    CREATE TABLE public.whatsapp_chat_states (
      client_id TEXT NOT NULL, phone TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'ativa', reason TEXT,
      source TEXT NOT NULL DEFAULT 'auto', changed_by TEXT, attended_at TIMESTAMPTZ, attended_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      agent_muted_at TIMESTAMPTZ, agent_muted_reason TEXT, agent_muted_source TEXT,
      PRIMARY KEY (client_id, phone)
    );
    CREATE TABLE public.whatsapp_lid_map (lid TEXT, profile_pic TEXT, contact_name TEXT);
    CREATE TABLE public.whatsapp_user_chat_states (client_id TEXT, phone TEXT, user_id TEXT, last_opened_at TIMESTAMPTZ);
  `);
  // Tabela que este teste não criou (campanha, follow-up, chips...) responde vazio.
  // Erro em tabela que ele criou (coluna errada, SQL quebrado) sobe e derruba o teste.
  pool = {
    query: async (sql, params) => {
      try {
        return await db.query(sql, params);
      } catch (err) {
        if (err?.code === "42P01") return { rows: [], rowCount: 0 };
        throw err;
      }
    },
  };
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  _resetInboundGuard();
  await db.exec("DELETE FROM public.lead_messages; DELETE FROM public.whatsapp_chat_states;");
});

function buildSupabase() {
  const chain = (table) => {
    const c = {
      select: () => c, eq: () => c, in: () => c, gte: () => c, is: () => c, order: () => c, limit: () => c,
      maybeSingle: async () => ({ data: table === "followup_companies" ? AGENTE : null, error: null }),
      single: async () => ({ data: table === "followup_companies" ? AGENTE : null, error: null }),
      then: (resolve) => resolve({ data: table === "followup_companies" ? [AGENTE] : [], error: null }),
      insert: async (payload) => {
        if (table !== "lead_messages") return { data: payload, error: null };
        try {
          await db.query(
            `INSERT INTO public.lead_messages (client_id, phone, sender_type, direction, message_text, delivered_at,
               message_timestamp, meta, instance_name, wa_message_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [payload.client_id, payload.phone, payload.sender_type, payload.direction, payload.message_text,
              payload.delivered_at, payload.message_timestamp, payload.meta, payload.instance_name, payload.wa_message_id]
          );
          return { data: payload, error: null };
        } catch (err) {
          return { data: null, error: { code: err.code, message: err.message } };
        }
      },
      update: () => ({ eq: () => ({ in: async () => ({ data: {}, error: null }), is: async () => ({ data: {}, error: null }) }) }),
    };
    return c;
  };
  return { from: vi.fn((table) => chain(table)) };
}

const AGENTE = {
  id: "agente-1",
  name: "Atendente",
  evolution_instance: "Chip CL",
  evolution_instances: ["Chip CL"],
  inbound_enabled: true,
  agent_kind: "atendimento",
  inbound_role: "atendimento",
};

function setup({ pauseOnDeviceReply = false } = {}) {
  const routes = {};
  const register = (method) => vi.fn((path, ...handlers) => {
    routes[`${method} ${path}`] = handlers[handlers.length - 1];
  });
  const app = { post: register("POST"), get: register("GET"), delete: register("DELETE"), put: register("PUT"), patch: register("PATCH") };

  registerChatbotRoutes(app, {
    ensureDb: () => true,
    getLeadClientEvolutionInstances: async () => [{
      id: "chip-cl",
      name: "Chip CL",
      active: true,
      is_default: true,
      dispatch_webhook_url: "https://evolution.invalid/message/sendText/ChipCL",
      dispatch_webhook_token: "token-de-teste",
    }],
    getLeadClientN8nSettings: async (clientId) => ({
      clientId,
      chatbot_enabled: true,
      chatbot_inbound_scope: "all",
      chatbot_instances: [],
      agent_pause_on_device_reply: pauseOnDeviceReply,
    }),
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    leadsTableName: () => "leads",
    maskPhoneForLog: (p) => p,
    MAX_LEADS_OUTLIER_BATCH: 100,
    continueCampaignLeadFromReply: vi.fn(),
    findCampaignReplyMatches: async () => ({
      matches: [], waitForReplyMatches: [], processingWaitForReplyMatches: [], activePeriodCampaign: null,
    }),
    normalizeString: (s) => (s ? String(s).trim() : ""),
    normalizeTenantKey: (k) => k,
    pgDatabasePool: pool,
    requireAppViewAccess: () => (_req, _res, next) => next(),
    requireFirebaseAuth: (_req, _res, next) => next(),
    resolveAuthorizedClientId: (_req, _res, cid) => cid || TENANT,
    resolveDispatchWebhookSettings: async () => ({}),
    resolveInboundDispatchSettings: async () => ({}),
    sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
    sendError: vi.fn((res, status, code) => res.json({ success: false, status, code })),
    supabase: buildSupabase(),
    validateLeadsOutlierRecord: () => true,
    validateN8nInboundBearer: () => true,
  });

  const call = async (key, req) => {
    let payload = null;
    const res = { json: vi.fn((data) => { payload = data; }), status: vi.fn(() => res) };
    await routes[key]({ query: {}, ...req }, res);
    return payload;
  };

  return {
    webhook: (body) => call("POST /api/hardcoded-chat-webhook", { body }),
    mute: (phone) => call("POST /api/whatsapp/chats/mute", { body: { clientId: TENANT, phone } }),
    unmute: (phone) => call("POST /api/whatsapp/chats/unmute", { body: { clientId: TENANT, phone } }),
    listChats: (query = {}) => call("GET /api/whatsapp/chats", { query: { clientId: TENANT, ...query } }),
    replyFromScreen: (text) => call("POST /api/whatsapp/messages", { body: { clientId: TENANT, chatId: LEAD, body: text } }),
  };
}

let seq = 0;
function mensagem({ fromMe = false, text = "Oi, quero um orçamento" } = {}) {
  seq += 1;
  return {
    event: "messages.upsert",
    clientId: TENANT,
    phone: LEAD,
    instance: "Chip CL",
    data: {
      key: { remoteJid: `${LEAD}@s.whatsapp.net`, fromMe, id: `WA_TAKEOVER_${seq}` },
      message: { conversation: text },
      messageTimestamp: Math.floor(Date.now() / 1000),
    },
  };
}

async function estadoDaConversa() {
  const { rows } = await db.query(
    "SELECT state, agent_muted_at, agent_muted_reason, agent_muted_source FROM public.whatsapp_chat_states WHERE client_id = $1 AND phone = $2",
    [TENANT, LEAD]
  );
  return rows[0] || null;
}

describe("Pausa manual do agente (botão na tela de Conversas)", () => {
  it("pausa manual liga a etiqueta e o portão passa a descartar a mensagem do lead", async () => {
    const t = setup();

    // Antes de pausar o agente atende (prova de que o descarte abaixo vem da pausa).
    expect(await t.webhook(mensagem())).toMatchObject({ status: "buffering" });

    expect(await t.mute(LEAD)).toEqual({ success: true, phone: LEAD });
    const estado = await estadoDaConversa();
    expect(estado.agent_muted_at).toBeTruthy();
    expect(estado.agent_muted_source).toBe("manual");
    expect(estado.agent_muted_reason).toBe("Atendimento humano");
    expect(estado.state).toBe("ativa");

    expect(await t.webhook(mensagem())).toMatchObject({ ignored: "conversa_nao_comercial" });
  });

  it("reativar limpa a etiqueta e o agente volta a atender", async () => {
    const t = setup();
    await t.mute(LEAD);
    expect(await t.unmute(LEAD)).toEqual({ success: true, phone: LEAD });

    const estado = await estadoDaConversa();
    expect(estado.agent_muted_at).toBeNull();
    expect(estado.agent_muted_source).toBeNull();
    expect(await t.webhook(mensagem())).toMatchObject({ status: "buffering" });
  });

  it("mensagem do lead com o agente pausado continua gravada e aparecendo na lista de Conversas", async () => {
    const t = setup();
    await t.mute(LEAD);
    await t.webhook(mensagem({ text: "Alguém aí? Preciso do preço" }));

    const { rows } = await db.query(
      "SELECT direction, sender_type, message_text FROM public.lead_messages WHERE client_id = $1 AND phone = $2",
      [TENANT, LEAD]
    );
    expect(rows).toEqual([{ direction: "inbound", sender_type: "lead", message_text: "Alguém aí? Preciso do preço" }]);

    const lista = await t.listChats({ tab: "fila" });
    const chat = lista.items.find((c) => c.id === LEAD);
    expect(chat).toBeTruthy();
    expect(chat.lastMessage.body).toBe("Alguém aí? Preciso do preço");
    expect(chat.agentMutedAt).toBeTruthy();
    expect(chat.state).toBe("ativa");
  });

  it("pausa manual não incrementa o contador diário do freio do classificador", async () => {
    const t = setup();
    await recordAgentMute(pool, { clientId: TENANT, phone: "5534999990002", reason: "Conversa pessoal" });
    expect(await countTenantMutedToday(pool, TENANT)).toBe(1);

    await t.mute(LEAD);
    await t.mute("5534999990003");
    expect(await countTenantMutedToday(pool, TENANT)).toBe(1);
  });

  it("linha antiga (agent_muted_source NULL) continua contando como classificador no freio", async () => {
    await db.query(
      `INSERT INTO public.whatsapp_chat_states (client_id, phone, agent_muted_at, agent_muted_reason)
       VALUES ($1, $2, now(), $3)`,
      [TENANT, "5534999990004", "Engano"]
    );
    expect(await countTenantMutedToday(pool, TENANT)).toBe(1);
  });
});

describe("Resposta fromMe (celular/Desktop) e a pausa", () => {
  it("D3 desligado: fromMe continua limpando a pausa do classificador, como hoje", async () => {
    const t = setup({ pauseOnDeviceReply: false });
    await recordAgentMute(pool, { clientId: TENANT, phone: LEAD, reason: "Conversa pessoal" });

    expect(await t.webhook(mensagem({ fromMe: true, text: "Oi, aqui é o Lucas" }))).toMatchObject({ saved: "outbound_from_me" });
    expect((await estadoDaConversa()).agent_muted_at).toBeNull();
  });

  it("linha antiga (agent_muted_source NULL) também se desfaz com fromMe, como hoje", async () => {
    const t = setup({ pauseOnDeviceReply: false });
    await db.query(
      `INSERT INTO public.whatsapp_chat_states (client_id, phone, agent_muted_at, agent_muted_reason)
       VALUES ($1, $2, now(), $3)`,
      [TENANT, LEAD, "Conversa pessoal"]
    );
    await t.webhook(mensagem({ fromMe: true, text: "Oi" }));
    expect((await estadoDaConversa()).agent_muted_at).toBeNull();
  });

  it("fromMe NÃO desfaz pausa manual: só o Reativar desfaz", async () => {
    const t = setup({ pauseOnDeviceReply: false });
    await t.mute(LEAD);

    await t.webhook(mensagem({ fromMe: true, text: "Oi, já te atendo pelo Desktop" }));
    const estado = await estadoDaConversa();
    expect(estado.agent_muted_at).toBeTruthy();
    expect(estado.agent_muted_source).toBe("manual");
    expect(await t.webhook(mensagem())).toMatchObject({ ignored: "conversa_nao_comercial" });
  });
});

describe("Resposta pela tela de Conversas (D3)", () => {
  let enviosEvolution;

  beforeEach(() => {
    enviosEvolution = [];
    // Evolution é HTTP saindo do processo: único dublê deste bloco.
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      enviosEvolution.push({ url: String(url), body: JSON.parse(init?.body || "{}") });
      return new Response(JSON.stringify({ key: { id: "3EB0TESTE" } }), { status: 201 });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("D3 ligado: responder pela tela pausa o agente na conversa (origem manual)", async () => {
    const t = setup({ pauseOnDeviceReply: true });
    await t.replyFromScreen("Oi, aqui é o Lucas, vou te atender");

    expect(enviosEvolution).toHaveLength(1);
    const estado = await estadoDaConversa();
    expect(estado.agent_muted_at).toBeTruthy();
    expect(estado.agent_muted_source).toBe("manual");
    expect(await t.webhook(mensagem())).toMatchObject({ ignored: "conversa_nao_comercial" });
  });

  it("D3 desligado: responder pela tela não pausa o agente", async () => {
    const t = setup({ pauseOnDeviceReply: false });
    await t.replyFromScreen("Oi, aqui é o Lucas");

    expect(enviosEvolution).toHaveLength(1);
    expect((await estadoDaConversa())?.agent_muted_at ?? null).toBeNull();
    expect(await t.webhook(mensagem())).toMatchObject({ status: "buffering" });
  });

  it("D3 ligado: o eco fromMe da própria resposta pela tela não desfaz a pausa", async () => {
    const t = setup({ pauseOnDeviceReply: true });
    await t.replyFromScreen("Oi, aqui é o Lucas");
    await t.webhook(mensagem({ fromMe: true, text: "Oi, aqui é o Lucas" }));

    expect((await estadoDaConversa()).agent_muted_source).toBe("manual");
  });

  it("pausa pela tela não incrementa o contador diário do freio", async () => {
    const t = setup({ pauseOnDeviceReply: true });
    await t.replyFromScreen("Oi");
    expect(await countTenantMutedToday(pool, TENANT)).toBe(0);
  });
});
