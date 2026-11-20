// Mesmo messageId em empresas diferentes são duas mensagens (19/11/2026).
//
// Fato (log do bk-vexo, ~23:28Z): o Conrado mandou "Teste 3" de um número que é chip do Vexo (vexo-adm, final 1267,
// em duas instâncias) para o 9499 da Container LED. O mesmo messageId A54A4ED2... chegou 3 vezes: fromMe:true na
// vexo-adm (gravado), fromMe:true de novo na outra instância da vexo-adm ("duplicado", certo) e fromMe:false na
// Container LED, que é a CHEGADA da mensagem, também "duplicado": jogada fora. A deduplicação em memória do webhook
// (services/inboundGuard.js) usava só o messageId.
//
// Regra nova: a chave é empresa + direção + messageId. O banco já separa por empresa (índice único
// (client_id, wa_message_id), migration 20260825170000), igual a este teste.
//
// SQL de verdade (PGlite) no webhook. Dublê só no que sai do processo.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";
import { sanitizePhone } from "../services/leadImport.js";
import { variantesDeBuscaPorTelefone } from "../services/canonicalPhone.js";
import { mapaDeLidTemTelefone } from "../services/lidMap.js";
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
      created_at TIMESTAMPTZ DEFAULT now(), meta JSONB, instance_name TEXT, wa_message_id TEXT,
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
    CREATE TABLE public.whatsapp_lid_map (lid TEXT PRIMARY KEY, phone TEXT, contact_name TEXT, profile_pic TEXT, updated_at TIMESTAMPTZ DEFAULT now());
    CREATE UNIQUE INDEX idx_lead_messages_wa_message_id ON public.lead_messages (client_id, wa_message_id) WHERE wa_message_id IS NOT NULL;
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
  await db.exec("DELETE FROM public.lead_messages; DELETE FROM public.whatsapp_chat_states; DELETE FROM public.whatsapp_lid_map;");
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
    sanitizePhone,
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
    chipAlerts: (query = {}) => call("GET /api/whatsapp/chip-alerts", { query: { clientId: tenant, ...query } }),
    replyFromScreen: (text) => call("POST /api/whatsapp/messages", { body: { clientId: TENANT, chatId: LEAD, body: text } }),
  };
}



import { shouldIgnoreInboundEvent } from "../services/inboundGuard.js";

const ID = "A54A4ED29F47041C2CD15FF16BE15D90";
const CHIP_VEXO = "5534999991267"; // remetente: número que é chip da vexo-adm
const CHIP_CL = "5534999999499"; // destinatário: chip 9499 da Container LED
function evento({ clientId, instance, fromMe, remoteJid, id = ID, text = "Teste 3" }) {
  return {
    event: "messages.upsert",
    clientId,
    instance,
    data: { key: { remoteJid: `${remoteJid}@s.whatsapp.net`, fromMe, id }, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) },
  };
}
const linhas = async () => (await db.query("SELECT client_id, phone, direction FROM public.lead_messages ORDER BY id")).rows;

describe("Webhook: mesmo messageId saindo de um chip do Vexo e chegando em outro", () => {
  it("caso do Teste 3: vexo-adm grava a saída, e a Container LED grava a CHEGADA (não é duplicado)", async () => {
    const t = setup({ tenant: "container-led" });
    const a = await t.webhook(evento({ clientId: "vexo-adm", instance: "Vexo ADM Atende", fromMe: true, remoteJid: CHIP_CL }));
    const b = await t.webhook(evento({ clientId: "vexo-adm", instance: "GD Teste Vexo", fromMe: true, remoteJid: CHIP_CL }));
    const c = await t.webhook(evento({ clientId: "container-led", instance: "Chip CL", fromMe: false, remoteJid: CHIP_VEXO }));
    expect(a?.ignored).not.toBe("duplicado");
    expect(b?.ignored).toBe("duplicado"); // mesma empresa, mesma direção: o mesmo número em dois aparelhos
    expect(c?.ignored).not.toBe("duplicado");
    const r = await linhas();
    expect(r.filter((x) => x.client_id === "container-led")).toEqual([{ client_id: "container-led", phone: CHIP_VEXO, direction: "inbound" }]);
    expect(r.filter((x) => x.client_id === "vexo-adm")).toHaveLength(1);
  });

  it("a chegada na Container LED aparece em Conversas da Container LED", async () => {
    const t = setup({ tenant: "container-led" });
    await t.webhook(evento({ clientId: "vexo-adm", instance: "Vexo ADM Atende", fromMe: true, remoteJid: CHIP_CL }));
    await t.webhook(evento({ clientId: "container-led", instance: "Chip CL", fromMe: false, remoteJid: CHIP_VEXO }));
    const lista = await t.listChats({ tab: "todas" });
    expect((lista.items || []).map((c) => c.id)).toContain(CHIP_VEXO);
  });

  it("o 1267 está em DUAS empresas (geracao-digital e vexo-adm): a mesma saída grava nas duas, cada uma vê a sua", async () => {
    const t = setup({ tenant: "container-led" });
    const gd = await t.webhook(evento({ clientId: "geracao-digital", instance: "geracao-digital-teste-vexo", fromMe: true, remoteJid: CHIP_CL, id: "DUAS-EMPRESAS-1" }));
    const adm = await t.webhook(evento({ clientId: "vexo-adm", instance: "vexo-adm-vexo-atende", fromMe: true, remoteJid: CHIP_CL, id: "DUAS-EMPRESAS-1" }));
    expect(gd?.ignored).not.toBe("duplicado");
    expect(adm?.ignored).not.toBe("duplicado");
    const r = await linhas();
    expect(r.map((x) => x.client_id).sort()).toEqual(["geracao-digital", "vexo-adm"]);
  });

  it("reentrega do MESMO evento na mesma empresa continua 'duplicado'", async () => {
    const t = setup({ tenant: "container-led" });
    const ev = evento({ clientId: "container-led", instance: "Chip CL", fromMe: false, remoteJid: CHIP_VEXO, id: "REENTREGA-1" });
    const primeira = await t.webhook(ev);
    const segunda = await t.webhook(ev);
    expect(primeira?.ignored).not.toBe("duplicado");
    expect(segunda?.ignored).toBe("duplicado");
    expect((await linhas()).filter((x) => x.client_id === "container-led")).toHaveLength(1);
  });
});

describe("shouldIgnoreInboundEvent: chave = empresa + direção + messageId", () => {
  const corpo = (fromMe) => ({ event: "messages.upsert", data: { key: { id: "X1", fromMe, remoteJid: "5534999990001@s.whatsapp.net" } } });

  it("mesma empresa, mesma direção, mesmo id: duplicado", () => {
    expect(shouldIgnoreInboundEvent(corpo(false), 1000, { clientId: "a" }).ignore).toBe(false);
    expect(shouldIgnoreInboundEvent(corpo(false), 2000, { clientId: "a" })).toEqual({ ignore: true, reason: "duplicado" });
  });

  it("outra empresa, mesmo id: passa", () => {
    expect(shouldIgnoreInboundEvent(corpo(false), 1000, { clientId: "a" }).ignore).toBe(false);
    expect(shouldIgnoreInboundEvent(corpo(false), 2000, { clientId: "b" }).ignore).toBe(false);
  });

  it("mesma empresa, direção diferente, mesmo id: passa", () => {
    expect(shouldIgnoreInboundEvent(corpo(true), 1000, { clientId: "a" }).ignore).toBe(false);
    expect(shouldIgnoreInboundEvent(corpo(false), 2000, { clientId: "a" }).ignore).toBe(false);
  });

  it("sem empresa informada (chamada antiga): continua deduplicando pelo id", () => {
    expect(shouldIgnoreInboundEvent(corpo(false), 1000).ignore).toBe(false);
    expect(shouldIgnoreInboundEvent(corpo(false), 2000).ignore).toBe(true);
  });

  it("depois de 10 min o mesmo id volta a passar (TTL inalterado)", () => {
    expect(shouldIgnoreInboundEvent(corpo(false), 0, { clientId: "a" }).ignore).toBe(false);
    expect(shouldIgnoreInboundEvent(corpo(false), 10 * 60 * 1000 + 1, { clientId: "a" }).ignore).toBe(false);
  });
});
