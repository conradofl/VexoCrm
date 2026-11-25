// Heloísa só nos chips da Geração Digital + enxurrada de mensagens antigas (19/11/2026).
//
// Fatos: "teste 2" do Conrado (usuário da Heloísa) para o chip 9171 da Container LED foi interceptado pela Heloísa,
// que respondeu PELO CHIP DO CLIENTE. E ao soltar a fila presa da Evolution (ack do <status>) chegam centenas de
// mensagens com horas de atraso: a Heloísa interceptava ANTES do portão de idade e executaria comandos velhos, e uma
// mensagem digitada no aparelho horas atrás pausaria o agente agora.
//
// SQL de verdade (PGlite) no webhook e na listagem de Conversas. Dublê só no que sai do processo: o envio da Heloísa
// (processarMensagemHeloisa) e a chave liga/desliga do Painel. A autorização do remetente é a real.
vi.mock("../domains/goclaw/heloisaEngine.js", async (importOriginal) => ({
  ...(await importOriginal()),
  processarMensagemHeloisa: vi.fn(async () => ({ ok: true })),
  isHeloisaActive: vi.fn(async () => true),
}));
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";
import { countTenantMutedToday, recordAgentMute, resolveAgentPauseExpiryDays } from "../services/agentMuteGuard.js";
import { _resetInboundGuard } from "../services/inboundGuard.js";
import {
  _resetSystemSentMessagesForTesting,
  _setDeviceReplyRecheckMsForTesting,
  registerSystemSentMessageId,
} from "../services/systemSentMessages.js";

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
      agent_muted_at TIMESTAMPTZ, agent_muted_reason TEXT, agent_muted_source TEXT, agent_mute_last_human_at TIMESTAMPTZ,
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

function setup({ pauseOnDeviceReply = false, expiryDays = 3, settingsFail = false, findCampaignReplyMatches = null, continueCampaignLeadFromReply = null, tenant = TENANT } = {}) {
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
    getLeadClientN8nSettings: async (clientId) => {
      if (settingsFail) throw new Error("settings indisponível");
      return {
        clientId,
        chatbot_enabled: true,
        chatbot_inbound_scope: "all",
        chatbot_instances: [],
        agent_pause_on_device_reply: pauseOnDeviceReply,
        agent_pause_expiry_days: expiryDays,
      };
    },
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    leadsTableName: () => "leads",
    maskPhoneForLog: (p) => p,
    MAX_LEADS_OUTLIER_BATCH: 100,
    continueCampaignLeadFromReply: continueCampaignLeadFromReply || vi.fn(),
    findCampaignReplyMatches: findCampaignReplyMatches || (async () => ({
      matches: [], waitForReplyMatches: [], processingWaitForReplyMatches: [], activePeriodCampaign: null,
    })),
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
    webhook: (body, query = {}) => call("POST /api/hardcoded-chat-webhook", { body, query }),
    mute: (phone) => call("POST /api/whatsapp/chats/mute", { body: { clientId: TENANT, phone } }),
    unmute: (phone) => call("POST /api/whatsapp/chats/unmute", { body: { clientId: TENANT, phone } }),
    listChats: (query = {}) => call("GET /api/whatsapp/chats", { query: { clientId: tenant, ...query } }),
    replyFromScreen: (text) => call("POST /api/whatsapp/messages", { body: { clientId: TENANT, chatId: LEAD, body: text } }),
  };
}

const { processarMensagemHeloisa } = await import("../domains/goclaw/heloisaEngine.js");

const DIRETOR = "5534997817660"; // autorizado da Heloísa (lista em memória do heloisaEngine)
let seq = 0;
function mensagem({ fromMe = false, text = "teste 2", id = null, phone = DIRETOR, clientId = TENANT, horaReal = new Date(), instance = "Chip CL" } = {}) {
  seq += 1;
  return {
    event: "messages.upsert",
    clientId,
    phone,
    instance,
    data: {
      key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe, id: id || `WA_HELOISA_${seq}` },
      message: { conversation: text },
      messageTimestamp: Math.floor(new Date(horaReal).getTime() / 1000),
    },
  };
}
const horasAtras = (h) => new Date(Date.now() - h * 3600 * 1000);
async function estado(clientId, phone) {
  const { rows } = await db.query("SELECT agent_muted_at, agent_muted_source FROM public.whatsapp_chat_states WHERE client_id = $1 AND phone = $2", [clientId, phone]);
  return rows[0] || null;
}

beforeEach(() => {
  processarMensagemHeloisa.mockClear();
});

describe("Heloísa só atende e responde pelos chips da Geração Digital", () => {
  it.each(["container-led", "tinge-brasil", "nous-gestao", "advocacia-almeida"])(
    "chip de %s: usuário autorizado segue o caminho normal e a Heloísa não responde",
    async (tenant) => {
      const t = setup({ tenant });
      const r = await t.webhook(mensagem({ clientId: tenant }));
      expect(processarMensagemHeloisa).not.toHaveBeenCalled();
      expect(r?.handled).not.toBe("heloisa");
    }
  );

  it("lane=heloisa na URL também não faz a Heloísa responder por chip de outra empresa", async () => {
    const t = setup({ tenant: "container-led" });
    const r = await t.webhook(mensagem({ clientId: "container-led", phone: "5534999001234", text: "oi" }), { lane: "heloisa" });
    expect(processarMensagemHeloisa).not.toHaveBeenCalled();
    expect(r?.handled).not.toBe("heloisa");
  });

  it("[OBRIGATÓRIO] 'teste 2' no chip 9171 da Container LED: vai para o agente do cliente e aparece em Conversas", async () => {
    const t = setup({ tenant: "container-led" });
    const r = await t.webhook(mensagem({ clientId: "container-led", text: "teste 2" }));
    expect(processarMensagemHeloisa).not.toHaveBeenCalled();
    expect(r).toMatchObject({ status: "buffering" });
    const lista = await t.listChats({ tab: "fila" });
    const chat = lista.items.find((c) => c.id === DIRETOR);
    expect(chat?.lastMessage?.body).toBe("teste 2");
  });

  it.each(["geracao-digital", "vexo-adm"])("chip da GD (%s): a Heloísa atende e responde pelo próprio chip", async (tenant) => {
    const t = setup({ tenant });
    const r = await t.webhook(mensagem({ clientId: tenant, text: "Heloísa, minha agenda de amanhã", instance: "vexo-adm-vexo-atende" }));
    expect(r).toMatchObject({ handled: "heloisa" });
    expect(processarMensagemHeloisa).toHaveBeenCalledTimes(1);
    expect(processarMensagemHeloisa.mock.calls[0][0]).toMatchObject({ phone: DIRETOR });
  });

  it("chip comum da GD (sem ser a instância da Heloísa): 'ola' ou 'teste' de diretor NÃO aciona a Heloísa", async () => {
    const t = setup({ tenant: "geracao-digital" });
    const r = await t.webhook(mensagem({ clientId: "geracao-digital", text: "teste", instance: "geracao-digital-chip-comercial" }));
    expect(processarMensagemHeloisa).not.toHaveBeenCalled();
    expect(r?.handled).not.toBe("heloisa");
  });

  it("chip comum da GD: com prefixo 'Heloísa' de diretor ACIONA a Heloísa normalmente", async () => {
    const t = setup({ tenant: "geracao-digital" });
    const r = await t.webhook(mensagem({ clientId: "geracao-digital", text: "Heloísa, auditar campanhas", instance: "geracao-digital-chip-comercial" }));
    expect(processarMensagemHeloisa).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ handled: "heloisa" });
  });

  it("chip novo 'Wandinha GD' (vexo-adm-wandinha-gd): Conrado e Caio (+553497719779) enviam mensagem sem prefixo e a Wandinha atende", async () => {
    const t = setup({ tenant: "vexo-adm" });
    const rConrado = await t.webhook(mensagem({ clientId: "vexo-adm", text: "marca reunião amanhã às 10h", instance: "vexo-adm-wandinha-gd" }));
    expect(processarMensagemHeloisa).toHaveBeenCalledTimes(1);
    expect(rConrado).toMatchObject({ handled: "heloisa", agent: "wandinha" });
    expect(processarMensagemHeloisa.mock.calls[0][0]).toMatchObject({
      phone: DIRETOR,
      instanceName: "vexo-adm-wandinha-gd",
    });

    const rCaio = await t.webhook(mensagem({ clientId: "vexo-adm", phone: "553497719779", text: "agenda call hoje às 16h", instance: "vexo-adm-wandinha-gd" }));
    expect(processarMensagemHeloisa).toHaveBeenCalledTimes(2);
    expect(rCaio).toMatchObject({ handled: "heloisa", agent: "wandinha" });
  });

  it("chip comum da GD: com prefixo 'Wandinha' de diretor ACIONA a Wandinha normalmente", async () => {
    const t = setup({ tenant: "geracao-digital" });
    const r = await t.webhook(mensagem({ clientId: "geracao-digital", text: "Wandinha, auditar campanhas", instance: "geracao-digital-chip-comercial" }));
    expect(processarMensagemHeloisa).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ handled: "heloisa", agent: "wandinha" });
    expect(processarMensagemHeloisa.mock.calls[0][0].texto).toBe("auditar campanhas");
  });

  it("anti-loop: eco do próprio número +553488370439 na instância Wandinha GD NÃO aciona auto-resposta", async () => {
    const t = setup({ tenant: "vexo-adm" });
    const r = await t.webhook(mensagem({ clientId: "vexo-adm", phone: "553488370439", text: "Oi!", instance: "vexo-adm-wandinha-gd" }));
    expect(processarMensagemHeloisa).not.toHaveBeenCalled();
    expect(r?.handled).not.toBe("heloisa");
  });

  it("mensagem que a Heloísa atende também fica gravada e aparece em Conversas do chip da GD", async () => {
    const t = setup({ tenant: "geracao-digital" });
    await t.webhook(mensagem({ clientId: "geracao-digital", text: "Heloísa, cadastra o cliente novo", instance: "vexo-adm-vexo-atende" }));
    const { rows } = await db.query("SELECT client_id, direction, message_text FROM public.lead_messages WHERE phone = $1", [DIRETOR]);
    expect(rows).toEqual([{ client_id: "geracao-digital", direction: "inbound", message_text: "Heloísa, cadastra o cliente novo" }]);
    const lista = await t.listChats({ tab: "todas" });
    expect(lista.items.map((c) => c.id)).toContain(DIRETOR);
  });
});

describe("Enxurrada: mensagem antiga solta pela Evolution não aciona nada agora", () => {
  it("[OBRIGATÓRIO] comando de 5 h atrás para a Heloísa no chip da GD: não executa", async () => {
    const t = setup({ tenant: "geracao-digital" });
    const r = await t.webhook(mensagem({ clientId: "geracao-digital", text: "Heloísa, marca reunião às 10h", horaReal: horasAtras(5), instance: "vexo-adm-vexo-atende" }));
    expect(processarMensagemHeloisa).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ignored: "heloisa_mensagem_atrasada" });
  });

  it("comando de 10 min atrás para a Heloísa: executa (dentro dos 30 min)", async () => {
    const t = setup({ tenant: "geracao-digital" });
    await t.webhook(mensagem({ clientId: "geracao-digital", text: "Heloísa, marca reunião às 10h", horaReal: new Date(Date.now() - 10 * 60 * 1000), instance: "vexo-adm-vexo-atende" }));
    expect(processarMensagemHeloisa).toHaveBeenCalledTimes(1);
  });

  it("[OBRIGATÓRIO] mensagem digitada no aparelho 5 h atrás NÃO pausa o agente agora", async () => {
    const t = setup({ pauseOnDeviceReply: true });
    await t.webhook(mensagem({ fromMe: true, phone: LEAD, text: "Bom dia, aqui é a Ana", id: "3EB0DIGITADO_ANTIGO", horaReal: horasAtras(5) }));
    expect((await estado(TENANT, LEAD))?.agent_muted_at ?? null).toBeNull();
  });

  it("mensagem digitada no aparelho agora pausa (controle)", async () => {
    const t = setup({ pauseOnDeviceReply: true });
    await t.webhook(mensagem({ fromMe: true, phone: LEAD, text: "Bom dia, aqui é a Ana", id: "3EB0DIGITADO_AGORA" }));
    expect((await estado(TENANT, LEAD))?.agent_muted_source).toBe("manual");
  });

  it("lead de 5 h atrás: gravado, aparece em Conversas, sem agente", async () => {
    const t = setup();
    const r = await t.webhook(mensagem({ phone: LEAD, text: "Vocês ainda têm o painel?", horaReal: horasAtras(5) }));
    expect(r).toMatchObject({ ignored: "mensagem_atrasada" });
    const lista = await t.listChats({ tab: "fila" });
    expect(lista.items.find((c) => c.id === LEAD)?.lastMessage?.body).toBe("Vocês ainda têm o painel?");
  });
});
