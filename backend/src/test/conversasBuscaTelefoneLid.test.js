// Busca de Conversas sem o nono dígito e por LID (19/11/2026).
//
// Fatos: a busca comparava o texto digitado com o telefone salvo, sem normalizar: "(34) 98410-6585" ou "3484106585"
// não achavam a conversa salva como 5534984106585. E conversa salva pelo LID (identificador do WhatsApp que não é
// telefone; caso Container LED final 84106585, 19/11 06:10) não aparecia buscando pelo número. No webhook, LID de
// 15 dígitos era descartado como "missing_phone" mesmo quando a Evolution mandava o telefone real em remoteJidAlt.
//
// SQL de verdade (PGlite) no webhook e na listagem de Conversas, com o sanitizePhone de produção. Dublê só no que sai
// do processo (Supabase grava no mesmo PGlite; Evolution e LLM não são chamados).
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
    CREATE TABLE public.whatsapp_lid_map (lid TEXT PRIMARY KEY, phone TEXT, contact_name TEXT, profile_pic TEXT, updated_at TIMESTAMPTZ DEFAULT now());
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


const NUM = "5534984106585"; // canônico, com o nono dígito
const LID = "185621455499360@lid"; // LID de 15 dígitos
let seq = 0;
async function conversa({ phone, text = "Oi, quero orçamento", instance = "Chip CL", horaReal = new Date() } = {}) {
  seq += 1;
  await db.query(
    `INSERT INTO public.lead_messages (client_id, phone, sender_type, direction, message_text, message_timestamp, meta, instance_name, wa_message_id)
     VALUES ($1,$2,'lead','inbound',$3,$4,'{"source":"hardcoded-chat-webhook"}'::jsonb,$5,$6)`,
    [TENANT, phone, text, horaReal, instance, `WA_BUSCA_${seq}`]
  );
}
const telefones = (r) => (r?.items || r?.chats || r?.data || []).map((c) => c.phone_number || c.phone || c.id);

describe("variantesDeBuscaPorTelefone", () => {
  it.each([
    ["3484106585", ["3484106585", "34984106585"]],
    ["34984106585", ["34984106585", "3484106585"]],
    ["(34) 98410-6585", ["34984106585", "3484106585"]],
    ["+55 34 98410-6585", ["34984106585", "3484106585"]],
    ["553484106585", ["3484106585", "34984106585"]],
    ["84106585", ["84106585", "984106585"]],
    ["984106585", ["984106585", "84106585"]],
    ["3432345678", ["3432345678"]],
  ])("%s", (digitado, esperado) => {
    expect(variantesDeBuscaPorTelefone(digitado)).toEqual(esperado);
  });

  it.each(["João", "orçamento 34", "1234567", "", null])("não é telefone: %s", (digitado) => {
    expect(variantesDeBuscaPorTelefone(digitado)).toEqual([]);
  });
});

describe("Busca de Conversas pelo número, com ou sem o nono dígito", () => {
  it.each(["3484106585", "34984106585", "(34) 98410-6585", "553484106585", "84106585", "+55 34 98410-6585"])(
    "conversa salva com o nono dígito aparece buscando %s",
    async (digitado) => {
      await conversa({ phone: NUM });
      await conversa({ phone: "5534999990002", text: "outro" });
      const t = setup();
      const r = await t.listChats({ search: digitado });
      expect(telefones(r)).toEqual([NUM]);
    }
  );

  it("conversa salva SEM o nono dígito aparece buscando com o nono dígito", async () => {
    await conversa({ phone: "553484106585" });
    const t = setup();
    const r = await t.listChats({ search: "(34) 98410-6585" });
    expect(telefones(r)).toHaveLength(1);
  });

  it("número diferente não aparece", async () => {
    await conversa({ phone: NUM });
    const t = setup();
    const r = await t.listChats({ search: "34984106586" });
    expect(telefones(r)).toEqual([]);
  });

  it("busca por nome continua funcionando", async () => {
    await conversa({ phone: NUM, text: "sou a Mariana da obra" });
    const t = setup();
    const r = await t.listChats({ search: "mariana" });
    expect(telefones(r)).toEqual([NUM]);
  });
});

describe("Busca de Conversas acha conversa salva pelo LID", () => {
  it.each(["84106585", "3484106585", "(34) 98410-6585"])(
    "LID com telefone conhecido aparece buscando %s",
    async (digitado) => {
      await conversa({ phone: LID });
      await db.query("INSERT INTO public.whatsapp_lid_map (lid, phone) VALUES ($1, $2)", [LID, NUM]);
      const t = setup();
      const r = await t.listChats({ search: digitado });
      expect(telefones(r)).toEqual([LID]);
    }
  );

  it("LID gravado só com dígitos (sem @lid) também é achado pelo mapa", async () => {
    await conversa({ phone: "18562145549936" });
    await db.query("INSERT INTO public.whatsapp_lid_map (lid, phone) VALUES ($1, $2)", ["18562145549936@lid", NUM]);
    const t = setup();
    const r = await t.listChats({ search: "34984106585" });
    expect(telefones(r)).toEqual(["18562145549936"]);
  });

  it("LID de outro telefone não aparece", async () => {
    await conversa({ phone: LID });
    await db.query("INSERT INTO public.whatsapp_lid_map (lid, phone) VALUES ($1, $2)", [LID, "5534999990002"]);
    const t = setup();
    const r = await t.listChats({ search: "84106585" });
    expect(telefones(r)).toEqual([]);
  });
});

function mensagemLid({ alt = `${NUM}@s.whatsapp.net`, campo = "remoteJidAlt", fromMe = false, text = "Oi, vi o anúncio" } = {}) {
  seq += 1;
  const key = { remoteJid: LID, fromMe, id: `WA_LID_${seq}` };
  if (alt) key[campo] = alt;
  return {
    event: "messages.upsert",
    clientId: TENANT,
    instance: "Chip CL",
    data: { key, message: { conversation: text }, messageTimestamp: Math.floor(Date.now() / 1000) },
  };
}

describe("Webhook com LID: usa o telefone real que a Evolution manda", () => {
  it.each(["remoteJidAlt", "senderPn"])("LID + %s: grava a conversa no telefone real e guarda o par LID -> telefone", async (campo) => {
    const t = setup();
    const r = await t.webhook(mensagemLid({ campo }));
    expect(r?.error).not.toBe("Missing phone");
    const { rows } = await db.query("SELECT phone FROM public.lead_messages WHERE client_id = $1", [TENANT]);
    expect(rows.map((x) => x.phone)).toEqual([NUM]);
    const mapa = await db.query("SELECT lid, phone FROM public.whatsapp_lid_map");
    expect(mapa.rows).toEqual([{ lid: LID, phone: NUM }]);
  });

  it("depois do webhook, a busca pelo número sem o nono dígito acha a conversa", async () => {
    const t = setup();
    await t.webhook(mensagemLid());
    const r = await t.listChats({ search: "3484106585" });
    expect(telefones(r)).toEqual([NUM]);
  });

  it("LID sem telefone real: nada é inventado e o mapa não ganha linha", async () => {
    const t = setup();
    await t.webhook(mensagemLid({ alt: null }));
    const mapa = await db.query("SELECT count(*)::int AS n FROM public.whatsapp_lid_map");
    expect(mapa.rows[0].n).toBe(0);
    const { rows } = await db.query("SELECT phone FROM public.lead_messages WHERE phone = $1", [NUM]);
    expect(rows).toEqual([]);
  });

  it("remoteJidAlt de grupo ou lixo não vira telefone", async () => {
    const t = setup();
    await t.webhook(mensagemLid({ alt: "120363049633060243@g.us" }));
    const mapa = await db.query("SELECT count(*)::int AS n FROM public.whatsapp_lid_map");
    expect(mapa.rows[0].n).toBe(0);
  });

  it("mensagem normal (sem LID) segue igual e não mexe no mapa", async () => {
    const t = setup();
    seq += 1;
    await t.webhook({
      event: "messages.upsert", clientId: TENANT, instance: "Chip CL",
      data: { key: { remoteJid: `${NUM}@s.whatsapp.net`, fromMe: false, id: `WA_N_${seq}` }, message: { conversation: "oi" }, messageTimestamp: Math.floor(Date.now() / 1000) },
    });
    const { rows } = await db.query("SELECT phone FROM public.lead_messages");
    expect(rows.map((x) => x.phone)).toEqual([NUM]);
    const mapa = await db.query("SELECT count(*)::int AS n FROM public.whatsapp_lid_map");
    expect(mapa.rows[0].n).toBe(0);
  });
});

describe("Rota de alertas de chip (GET /api/whatsapp/chip-alerts)", () => {
  it("chip da empresa com mensagem que chegou 3 h depois: alerta atrasado", async () => {
    await conversa({ phone: NUM, horaReal: new Date(Date.now() - 3 * 3600 * 1000) });
    const t = setup();
    const r = await t.chipAlerts();
    expect(r.alertas.map((a) => [a.instancia, a.tipo])).toEqual([["Chip CL", "atrasado"]]);
    expect(r.alertas[0].maiorAtrasoMin).toBeGreaterThanOrEqual(179);
  });

  it("mensagem em dia: sem alerta", async () => {
    await conversa({ phone: NUM });
    const t = setup();
    const r = await t.chipAlerts();
    expect(r.alertas).toEqual([]);
  });

  it("escopo de empresa: alerta é só dos chips da empresa pedida", async () => {
    await db.query(
      `INSERT INTO public.lead_messages (client_id, phone, direction, message_text, message_timestamp, meta, instance_name, wa_message_id)
       VALUES ('tinge-brasil', $1, 'inbound', 'oi', now() - interval '3 hours', '{"source":"hardcoded-chat-webhook"}'::jsonb, 'Chip CL', 'WA_OUTRA')`,
      [NUM]
    );
    const t = setup();
    const r = await t.chipAlerts();
    expect(r.alertas).toEqual([]);
  });
});

describe("mapaDeLidTemTelefone (information_schema antes de usar o mapa na busca)", () => {
  const poolFalso = (resposta) => {
    const chamadas = [];
    return {
      chamadas,
      query: async (sql) => {
        chamadas.push(sql);
        if (resposta instanceof Error) throw resposta;
        return { rows: resposta };
      },
    };
  };

  it("coluna existe: true, e não pergunta de novo", async () => {
    const p = poolFalso([{ "?column?": 1 }]);
    expect(await mapaDeLidTemTelefone(p, 0)).toBe(true);
    expect(await mapaDeLidTemTelefone(p, 999_999_999)).toBe(true);
    expect(p.chamadas).toHaveLength(1);
    expect(p.chamadas[0]).toContain("information_schema.columns");
  });

  it("coluna não existe: false, e confere de novo só depois de 10 min", async () => {
    const p = poolFalso([]);
    expect(await mapaDeLidTemTelefone(p, 0)).toBe(false);
    expect(await mapaDeLidTemTelefone(p, 9 * 60 * 1000)).toBe(false);
    expect(p.chamadas).toHaveLength(1);
    expect(await mapaDeLidTemTelefone(p, 11 * 60 * 1000)).toBe(false);
    expect(p.chamadas).toHaveLength(2);
  });

  it("erro do banco: false, sem derrubar", async () => {
    expect(await mapaDeLidTemTelefone(poolFalso(new Error("sem permissão")), 0)).toBe(false);
  });
});
