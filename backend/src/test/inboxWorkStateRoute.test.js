// Coluna de Conversas pela ROTA REAL (GET /api/whatsapp/chats), com o SQL rodando em
// Postgres em memória (PGlite). Dublê só no que sai do processo: autenticação, a leitura
// de chips/configuração do tenant e o cliente Supabase (que esta rota não usa).
//
// Prova quatro coisas:
//   1. as abas novas (esperam, com_lead, robo, esfriaram) chegam à tela com contador
//      igual à quantidade de itens;
//   2. nenhum filtro antigo sumiu: Grupos, Automações, Arquivadas, Pausadas, Todas e o
//      escopo de chip continuam alcançáveis e cada um continua filtrando;
//   3. as abas antigas não pagam nada pelas novas (nenhuma consulta de estado de trabalho);
//   4. consulta de estado que falha ou estoura o teto de tempo vira ERRO na resposta,
//      nunca lista vazia com 200.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";

const TENANT = "geracao-digital";
const ago = ({ minutes = 0, hours = 0, days = 0 }) =>
  new Date(Date.now() - (minutes + hours * 60 + days * 24 * 60) * 60_000).toISOString();

const P = {
  espera: "5534990000001",
  esperaNoChipB: "5534990000002",
  esfriou: "5534990000003",
  comLead: "5534990000004",
  robo: "5534990000005",
  pausada: "5534990000006",
  arquivada: "5534990000007",
  automacao: "5534990000008",
  semChip: "5534990000009",
  grupo: "120363000000000000@g.us",
};

let db;
let listChats;
let sendError;
// O que o "banco" viu, para provar o que cada aba consulta. E uma falha encomendada
// para a consulta de estados (o banco é o que sai do processo; a rota é a real).
const seen = { connects: 0, sql: [] };
let workQueryFailure = null;

async function msg(phone, direction, when, { chip = "chip-a", text = "mensagem", isGroup = false } = {}) {
  await db.query(
    `INSERT INTO public.lead_messages (client_id, phone, direction, sender_type, message_text, message_timestamp, instance_name, is_group)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [TENANT, phone, direction, direction === "inbound" ? "lead" : "device", text, when, chip, isGroup]
  );
}

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

  await msg(P.espera, "outbound", ago({ hours: 30 }));
  await msg(P.espera, "inbound", ago({ hours: 26 }));
  await msg(P.esperaNoChipB, "inbound", ago({ hours: 2 }), { chip: "chip-b" });
  await msg(P.esfriou, "inbound", ago({ days: 20 }));
  await msg(P.comLead, "inbound", ago({ hours: 5 }));
  await msg(P.comLead, "outbound", ago({ hours: 4 }));
  await msg(P.robo, "inbound", ago({ minutes: 3 }), { chip: "chip-robo" });
  await msg(P.pausada, "inbound", ago({ minutes: 50 }), { chip: "chip-robo" });
  await msg(P.arquivada, "inbound", ago({ hours: 1 }));
  await msg(P.automacao, "inbound", ago({ hours: 1 }), { text: "Digite 1 para falar com o financeiro" });
  await msg(P.semChip, "outbound", ago({ hours: 3 }), { chip: null });
  await msg(P.grupo, "inbound", ago({ hours: 1 }), { isGroup: true });

  await db.query(
    `INSERT INTO public.whatsapp_chat_states (client_id, phone, state, agent_muted_at, agent_muted_source) VALUES
       ($1, $2, 'ativa', now() - interval '10 minutes', 'manual'),
       ($1, $3, 'arquivada', NULL, NULL)`,
    [TENANT, P.pausada, P.arquivada]
  );

  const run = async (sql, params) => {
    seen.sql.push(String(sql));
    if (workQueryFailure && /work_conv/.test(String(sql))) throw workQueryFailure;
    try {
      return await db.query(sql, params);
    } catch (err) {
      if (err?.code === "42P01") return { rows: [], rowCount: 0 };
      throw err;
    }
  };
  const pool = {
    query: run,
    connect: async () => {
      seen.connects += 1;
      return { query: run, release: () => {} };
    },
  };

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
    sendError: (...args) => sendError(...args),
    supabase: { from: () => ({}) },
    validateLeadsOutlierRecord: () => true,
    validateN8nInboundBearer: () => true,
  });

  sendError = vi.fn((res, status, code, message) => res.json({ success: false, status, code, message }));

  listChats = async (query = {}) => {
    let payload = null;
    const res = { json: vi.fn((data) => { payload = data; }), status: vi.fn(() => res) };
    await routes["GET /api/whatsapp/chats"]({ query: { clientId: TENANT, limit: "200", ...query } }, res);
    return payload;
  };
});

afterAll(async () => {
  await db?.close();
});

const ids = (payload) => payload.items.map((c) => c.id).sort();

describe("GET /api/whatsapp/chats — abas de estado de trabalho", () => {
  it("cada aba nova devolve as conversas do seu estado", async () => {
    expect(ids(await listChats({ tab: "esperam" }))).toEqual([P.espera, P.esperaNoChipB, P.pausada].sort());
    expect(ids(await listChats({ tab: "com_lead" }))).toEqual([P.comLead, P.semChip].sort());
    expect(ids(await listChats({ tab: "robo" }))).toEqual([P.robo]);
    expect(ids(await listChats({ tab: "esfriaram" }))).toEqual([P.esfriou]);
  });

  it("o contador de cada aba bate com o total e com a quantidade de itens da aba", async () => {
    for (const tab of ["esperam", "com_lead", "robo", "esfriaram"]) {
      const payload = await listChats({ tab });
      expect(payload.items.length, `itens da aba ${tab}`).toBe(payload.counts.work[tab]);
      expect(payload.total, `total da aba ${tab}`).toBe(payload.counts.work[tab]);
      expect(payload.hasMore).toBe(false);
    }
  });

  it("'Esperam você' vem com mais parado primeiro e com o início da espera em cada item", async () => {
    const payload = await listChats({ tab: "esperam" });
    expect(payload.items.map((c) => c.id)).toEqual([P.espera, P.esperaNoChipB, P.pausada]);
    for (const item of payload.items) {
      expect(item.workState).toBe("esperam");
      expect(Math.floor(Date.parse(item.waitingSince) / 1000)).toBe(item.timestamp);
    }
  });

  it("diz quem responde em cada chip, pela regra do portão", async () => {
    const payload = await listChats({ tab: "esperam" });
    expect(payload.chipAgents["chip-robo"]).toMatchObject({ kind: "empresa" });
    expect(payload.chipAgents["chip-a"]).toMatchObject({ kind: "nenhum", reason: "chip_fora_do_robo_da_empresa" });
  });
});

describe("GET /api/whatsapp/chats — nenhum filtro antigo sumiu", () => {
  it("Grupos continua trazendo só grupos", async () => {
    const payload = await listChats({ tab: "grupos" });
    expect(ids(payload)).toEqual([P.grupo]);
    expect(payload.counts.groups).toBe(1);
  });

  it("Automações continua trazendo só conversa de robô de terceiro", async () => {
    const payload = await listChats({ tab: "automacoes" });
    expect(ids(payload)).toEqual([P.automacao]);
    expect(payload.counts.automations).toBe(1);
  });

  it("Arquivadas continua trazendo só as arquivadas", async () => {
    const payload = await listChats({ tab: "arquivadas" });
    expect(ids(payload)).toEqual([P.arquivada]);
    expect(payload.counts.archived).toBe(1);
  });

  it("Pausadas continua trazendo só conversa com agente pausado", async () => {
    const payload = await listChats({ tab: "pausadas" });
    expect(ids(payload)).toEqual([P.pausada]);
    expect(payload.counts.paused).toBe(1);
  });

  it("Todas continua trazendo tudo, e nenhuma aba de estado mostra grupo, arquivada ou automação", async () => {
    expect((await listChats({ tab: "todas" })).items).toHaveLength(Object.keys(P).length);
    const deTrabalho = (
      await Promise.all(["esperam", "com_lead", "robo", "esfriaram"].map((tab) => listChats({ tab })))
    ).flatMap((p) => p.items.map((c) => c.id));
    expect(deTrabalho).not.toContain(P.grupo);
    expect(deTrabalho).not.toContain(P.arquivada);
    expect(deTrabalho).not.toContain(P.automacao);
  });
});

describe("GET /api/whatsapp/chats — escopo de chip", () => {
  it("um chip mostra menos conversas que todos, nas abas novas e nas antigas", async () => {
    expect((await listChats({ tab: "esperam" })).items).toHaveLength(3);
    expect(ids(await listChats({ tab: "esperam", instanceName: "chip-b" }))).toEqual([P.esperaNoChipB]);

    const todas = (await listChats({ tab: "todas" })).items.length;
    const todasNoChipB = ids(await listChats({ tab: "todas", instanceName: "chip-b" }));
    expect(todasNoChipB).toContain(P.esperaNoChipB);
    expect(todasNoChipB.length).toBeLessThan(todas);
  });

  it("nas abas novas, conversa sem chip gravado aparece em 'todos' e não aparece dentro de chip nenhum", async () => {
    expect(ids(await listChats({ tab: "com_lead" }))).toContain(P.semChip);
    for (const instanceName of ["chip-a", "chip-b", "chip-robo"]) {
      expect(ids(await listChats({ tab: "com_lead", instanceName })), instanceName).not.toContain(P.semChip);
    }
  });

  it("nas abas antigas, mensagem sem chip gravado aparece em 'todos' e não entra dentro de chip nenhum", async () => {
    // Antes ela entrava em TODOS os chips (OR instance_name IS NULL): escolher um chip
    // mostrava conversa que não é dele, na lista e nos contadores.
    expect(ids(await listChats({ tab: "todas" }))).toContain(P.semChip);
    for (const instanceName of ["chip-a", "chip-b", "chip-robo"]) {
      expect(ids(await listChats({ tab: "todas", instanceName })), instanceName).not.toContain(P.semChip);
    }
  });

  it("as abas novas devolvem também os contadores do rodapé (grupos, automações, arquivadas, pausadas)", async () => {
    const body = await listChats({ tab: "esperam" });
    for (const key of ["groups", "automations", "archived", "paused"]) {
      expect(Number.isInteger(body.counts[key]), key).toBe(true);
    }
    const antigas = await listChats({ tab: "todas" });
    expect(body.counts.groups).toBe(antigas.counts.groups);
    expect(body.counts.automations).toBe(antigas.counts.automations);
    expect(body.counts.archived).toBe(antigas.counts.archived);
    expect(body.counts.paused).toBe(antigas.counts.paused);
  });

  it("o contador acompanha o escopo de chip", async () => {
    const payload = await listChats({ tab: "esperam", instanceName: "chip-robo" });
    expect(payload.counts.work).toEqual({ esperam: 1, com_lead: 0, robo: 1, esfriaram: 0 });
    expect(payload.items.map((c) => c.id)).toEqual([P.pausada]);
  });
});

describe("GET /api/whatsapp/chats — a tela de hoje não paga pelas abas novas", () => {
  it("aba antiga não roda consulta de estado de trabalho, não abre conexão dedicada e não lê agentes", async () => {
    for (const tab of ["ativa", "todas", "grupos", "aguardando", "arquivadas"]) {
      seen.connects = 0;
      seen.sql = [];
      const payload = await listChats({ tab });
      expect(seen.connects, `conexões na aba ${tab}`).toBe(0);
      expect(seen.sql.some((q) => /work_conv/.test(q)), `work_conv na aba ${tab}`).toBe(false);
      expect(seen.sql.some((q) => /followup_companies/.test(q)), `followup_companies na aba ${tab}`).toBe(false);
      expect(payload.counts.work, `counts.work na aba ${tab}`).toBeUndefined();
    }
  });

  it("busca digitada numa aba nova continua buscando em tudo, pelo caminho antigo", async () => {
    seen.connects = 0;
    seen.sql = [];
    const payload = await listChats({ tab: "esperam", search: P.comLead });
    expect(seen.connects).toBe(0);
    expect(ids(payload)).toEqual([P.comLead]);
  });

  it("aba nova usa UMA conexão, com teto de tempo valendo só nela", async () => {
    seen.connects = 0;
    seen.sql = [];
    await listChats({ tab: "esperam" });
    expect(seen.connects).toBe(1);
    const i = seen.sql.findIndex((q) => /SET LOCAL statement_timeout = 8000/.test(q));
    expect(i, "SET LOCAL statement_timeout").toBeGreaterThan(-1);
    expect(seen.sql[i - 1]).toMatch(/BEGIN READ ONLY/);
    expect(seen.sql.slice(i + 1).filter((q) => /work_conv/.test(q))).toHaveLength(2);
    expect(seen.sql.at(-1)).toMatch(/COMMIT/);
  });
});

describe("GET /api/whatsapp/chats — falha na consulta de estados vira erro, não lista vazia", () => {
  it("teto de tempo estourado responde 503 INBOX_QUERY_TIMEOUT e desfaz a transação", async () => {
    workQueryFailure = Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    seen.sql = [];
    try {
      const payload = await listChats({ tab: "esperam" });
      expect(payload).toMatchObject({ success: false, status: 503, code: "INBOX_QUERY_TIMEOUT" });
      expect(payload.items).toBeUndefined();
      expect(seen.sql.at(-1)).toMatch(/ROLLBACK/);
    } finally {
      workQueryFailure = null;
    }
  });

  it("qualquer outra falha responde 500 INBOX_QUERY_FAILED", async () => {
    workQueryFailure = Object.assign(new Error("relation does not exist"), { code: "XX000" });
    try {
      const payload = await listChats({ tab: "com_lead" });
      expect(payload).toMatchObject({ success: false, status: 500, code: "INBOX_QUERY_FAILED" });
    } finally {
      workQueryFailure = null;
    }
  });

  it("depois da falha a rota volta a responder", async () => {
    expect((await listChats({ tab: "esperam" })).items).toHaveLength(3);
  });
});
