// Faixa "Chegaram agora" no topo da coluna de Conversas (19/11/2026).
//
// Fato: o "Teste 4" chegou na Container LED com atraso zero e o Conrado não achou em Conversas. A conversa estava em
// "Esperam você", mas a ordem dessa aba é "mais parado primeiro": a mensagem de agora caiu na 42ª posição e a tela
// carrega 40. É a queixa do cliente: "a mensagem não aparece em tempo real".
//
// Regra da faixa: a mesma de "esperam" (última mensagem é de entrada, sem atendimento depois, robô ausente ou pausado,
// fora de lixeira/arquivada/automação) com a hora REAL da mensagem nos últimos 60 min. Mais recente primeiro, até 10,
// com o total. Só na primeira página e sem busca.
//
// Rota REAL (GET /api/whatsapp/chats), SQL rodando em Postgres em memória (PGlite). Dublê só no que sai do processo:
// autenticação, cadastro de chips e configuração da empresa.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";

const TENANT = "container-led";
const ago = ({ minutes = 0, hours = 0, days = 0 }) =>
  new Date(Date.now() - (minutes + hours * 60 + days * 24 * 60) * 60_000).toISOString();

let db;
let listChats;
let seq = 0;

async function msg(phone, direction, when, { chip = "chip-a", text = "oi", meta = null, gravadaEm = null } = {}) {
  seq += 1;
  await db.query(
    `INSERT INTO public.lead_messages (client_id, phone, direction, sender_type, message_text, message_timestamp, instance_name, meta, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz, now()))`,
    [TENANT, phone, direction, direction === "inbound" ? "lead" : "device", text, when, chip, meta ? JSON.stringify(meta) : null, gravadaEm]
  );
}
const tel = (n) => `55349${String(n).padStart(8, "0")}`;

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
      assigned_to TEXT, assigned_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
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
    CREATE TABLE public.followup_companies (
      id TEXT, tenant_id TEXT, name TEXT, evolution_instance TEXT, evolution_instances JSONB,
      inbound_enabled BOOLEAN, agent_kind TEXT, archived_at TIMESTAMPTZ
    );
  `);

  const run = async (sql, params) => {
    try {
      return await db.query(sql, params);
    } catch (err) {
      if (err?.code === "42P01") return { rows: [], rowCount: 0 };
      throw err;
    }
  };
  const pool = { query: run, connect: async () => ({ query: run, release: () => {} }) };
  const routes = {};
  const register = (method) => vi.fn((path, ...handlers) => {
    routes[`${method} ${path}`] = handlers[handlers.length - 1];
  });
  const app = { post: register("POST"), get: register("GET"), delete: register("DELETE"), put: register("PUT"), patch: register("PATCH") };
  const chip = (id, name) => ({ id, name, active: true, dispatch_webhook_url: `https://evolution.invalid/message/sendText/${id}` });

  registerChatbotRoutes(app, {
    ensureDb: () => true,
    getLeadClientEvolutionInstances: async () => [chip("chip-a", "Chip A"), chip("chip-b", "Chip B"), chip("chip-robo", "Chip Robô")],
    // Robô da empresa ligado só no chip-robo.
    getLeadClientN8nSettings: async () => ({ chatbot_enabled: true, chatbot_instances: ["chip-robo"], agent_pause_expiry_days: 0 }),
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
    sendError: vi.fn((res, status, code, message) => res.json({ success: false, status, code, message })),
    supabase: { from: () => ({}) },
    validateLeadsOutlierRecord: () => true,
    validateN8nInboundBearer: () => true,
  });

  listChats = async (query = {}) => {
    let payload = null;
    const res = { json: vi.fn((data) => { payload = data; }), status: vi.fn(() => res) };
    await routes["GET /api/whatsapp/chats"]({ query: { clientId: TENANT, limit: "40", ...query } }, res);
    return payload;
  };
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("DELETE FROM public.lead_messages; DELETE FROM public.whatsapp_chat_states;");
});

const faixa = (r) => (r.arrivedNow?.items || []).map((c) => c.id);

/** 41 conversas paradas há 1 a 6 dias, como a Container LED tinha em "Esperam você". */
async function quarentaEUmaParadas() {
  for (let i = 1; i <= 41; i += 1) await msg(tel(1000 + i), "inbound", ago({ hours: 24 + i * 3 }));
}

describe("Faixa 'Chegaram agora'", () => {
  it("o caso do Teste 4: a nova é a 42ª em 'Esperam você', fora da primeira página, e está na faixa", async () => {
    await quarentaEUmaParadas();
    await msg(tel(7660), "inbound", ago({ minutes: 1 }));
    const r = await listChats({ tab: "esperam" });
    expect(r.counts.work.esperam).toBe(42);
    expect(r.items).toHaveLength(40);
    expect(r.items.map((c) => c.id)).not.toContain(tel(7660)); // o defeito: fora da página que a tela carrega
    expect(faixa(r)).toEqual([tel(7660)]);
    expect(r.arrivedNow.total).toBe(1);
    expect(r.arrivedNow.minutes).toBe(60);
    expect(r.arrivedNow.items[0].lastMessage.body).toBe("oi");
  });

  it("atendida depois da mensagem: sai da faixa", async () => {
    await msg(tel(1), "inbound", ago({ minutes: 5 }));
    await db.query("INSERT INTO public.whatsapp_chat_states (client_id, phone, state, attended_at) VALUES ($1, $2, 'ativa', now())", [TENANT, tel(1)]);
    expect(faixa(await listChats({ tab: "esperam" }))).toEqual([]);
  });

  it("chegou atrasada (hora real de 5 h, gravada agora): fica fora da faixa e no topo de 'mais parado' com o selo", async () => {
    await msg(tel(2), "inbound", ago({ hours: 5 }), { meta: { agente_barrado: "mensagem_atrasada" }, gravadaEm: ago({ minutes: 1 }) });
    await msg(tel(3), "inbound", ago({ hours: 1, minutes: 30 }));
    const r = await listChats({ tab: "esperam" });
    expect(faixa(r)).toEqual([]);
    expect(r.items[0].id).toBe(tel(2));
    expect(r.items[0].lastMessage.meta).toMatchObject({ agente_barrado: "mensagem_atrasada" });
  });

  it("chip com robô ativo: não entra (é do robô)", async () => {
    await msg(tel(4), "inbound", ago({ minutes: 2 }), { chip: "chip-robo" });
    const r = await listChats({ tab: "esperam" });
    expect(faixa(r)).toEqual([]);
    expect(r.counts.work.robo).toBe(1);
  });

  it("chip com robô PAUSADO: entra (cai em 'esperam')", async () => {
    await msg(tel(5), "inbound", ago({ minutes: 2 }), { chip: "chip-robo" });
    await db.query("INSERT INTO public.whatsapp_chat_states (client_id, phone, state, agent_muted_at, agent_muted_source) VALUES ($1, $2, 'ativa', now(), 'manual')", [TENANT, tel(5)]);
    expect(faixa(await listChats({ tab: "esperam" }))).toEqual([tel(5)]);
  });

  it("59 min entra, 61 min não", async () => {
    await msg(tel(6), "inbound", ago({ minutes: 59 }));
    await msg(tel(7), "inbound", ago({ minutes: 61 }));
    expect(faixa(await listChats({ tab: "esperam" }))).toEqual([tel(6)]);
  });

  it.each(["arquivada", "lixeira", "automacao"])("conversa %s não entra", async (estado) => {
    await msg(tel(8), "inbound", ago({ minutes: 3 }));
    await db.query("INSERT INTO public.whatsapp_chat_states (client_id, phone, state) VALUES ($1, $2, $3)", [TENANT, tel(8), estado]);
    expect(faixa(await listChats({ tab: "esperam" }))).toEqual([]);
  });

  it("última mensagem nossa (já respondida): não entra", async () => {
    await msg(tel(9), "inbound", ago({ minutes: 10 }));
    await msg(tel(9), "outbound", ago({ minutes: 5 }));
    expect(faixa(await listChats({ tab: "esperam" }))).toEqual([]);
  });

  it("12 novas: todas vêm, mais recente primeiro, com o total (a tela mostra 10 e abre o resto)", async () => {
    for (let i = 1; i <= 12; i += 1) await msg(tel(100 + i), "inbound", ago({ minutes: i * 3 }));
    const r = await listChats({ tab: "esperam" });
    expect(r.arrivedNow.total).toBe(12);
    expect(faixa(r)).toEqual(Array.from({ length: 12 }, (_, k) => tel(101 + k)));
  });

  it("mais de 50: o servidor corta em 50 e conta todas", async () => {
    for (let i = 1; i <= 52; i += 1) await msg(tel(300 + i), "inbound", ago({ minutes: 1 + i }));
    const r = await listChats({ tab: "esperam" });
    expect(r.arrivedNow.total).toBe(52);
    expect(faixa(r)).toHaveLength(50);
    expect(faixa(r)[0]).toBe(tel(301));
  });

  it("vale nas outras abas de trabalho (Com o lead, Robô cuida)", async () => {
    await msg(tel(10), "inbound", ago({ minutes: 4 }));
    expect(faixa(await listChats({ tab: "com_lead" }))).toEqual([tel(10)]);
    expect(faixa(await listChats({ tab: "robo" }))).toEqual([tel(10)]);
  });

  it("filtro de chip: só as do chip escolhido", async () => {
    await msg(tel(11), "inbound", ago({ minutes: 4 }), { chip: "chip-a" });
    await msg(tel(12), "inbound", ago({ minutes: 6 }), { chip: "chip-b" });
    expect(faixa(await listChats({ tab: "esperam", instanceName: "chip-b" }))).toEqual([tel(12)]);
  });

  it("com busca digitada ou em página seguinte, não vem", async () => {
    await msg(tel(13), "inbound", ago({ minutes: 4 }));
    expect((await listChats({ tab: "esperam", search: "oi" })).arrivedNow).toBeUndefined();
    expect((await listChats({ tab: "esperam", offset: "40" })).arrivedNow).toBeUndefined();
  });

  it("o contador da aba continua contando a conversa da faixa (bate com o total real)", async () => {
    await quarentaEUmaParadas();
    await msg(tel(7660), "inbound", ago({ minutes: 1 }));
    const p1 = await listChats({ tab: "esperam" });
    const p2 = await listChats({ tab: "esperam", offset: "40" });
    const todas = [...p1.items, ...p2.items].map((c) => c.id);
    expect(new Set(todas).size).toBe(42);
    expect(p1.counts.work.esperam).toBe(42);
    expect(todas).toContain(tel(7660)); // continua na lista de baixo, na posição dela; a tela esconde a repetida
  });
});
