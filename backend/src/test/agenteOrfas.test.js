// backend/src/test/agenteOrfas.test.js
//
// Container LED, 17/11/2026: conversas das 11:00, 11:55, 12:38, 12:58 e 13:07 com a mensagem do lead por último e sem
// resposta do agente. Causa lida no código: o webhook responde 200 "buffering" e processa depois, em memória (buffer
// de 3 s + IA). Restart do contêiner no meio perdia a mensagem; a Evolution não reenvia.
//
// Postgres REAL (pglite) com as migrations do produto (concessão, estados da conversa, pausa, opt-out). Handler REAL do
// webhook, varredura REAL, processBatch REAL. Dublado só o que sai do processo: o HTTP da Evolution (envio) e o HTTP do
// modelo de IA; e a config que vem do Supabase (agente do chip), no mesmo molde de audioLibraryAgentChat.test.js.

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";

let db = null;
vi.mock("../services/database.js", async (importOriginal) => {
  const actual = await importOriginal();
  const mocked = { ...actual };
  Object.defineProperty(mocked, "pgDatabasePool", {
    enumerable: true,
    get: () => (db ? toleranteSilencioso(db) : null),
  });
  return mocked;
});

const { registerChatbotRoutes } = await import("../domains/chatbot/routes.js");
const { _messageBuffersForTest, drenarBuffersDoAgente, bufferMessage } = await import("../chatbot-ai-engine.js");
const recovery = await import("../services/agentInboundRecovery.js");
const { registerOptOut } = await import("../services/optOut.js");
const { createPgSupabaseClient } = await import("../pgSupabaseCompat.js");

const SLOW = 60_000;
const MIG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");
const migracao = (nome) => readFileSync(join(MIG, nome), "utf8");
const TENANT = "container-led";
const INSTANCIA = "container-led-atendimento";
const EVO = "https://evo.teste";
const LEAD = "5534999001001";
const AGENTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// Pool que responde vazio para tabela/coluna que o teste não montou (o handler toca muitas tabelas de outras frentes).
function toleranteSilencioso(base) {
  return {
    query: async (sql, params) => {
      try {
        return await base.query(sql, params);
      } catch (err) {
        // A concessão PRECISA ver o erro de tabela ausente: é ele que liga o modo em memória (como em produção).
        if (/agent_inbound_claims/.test(String(sql))) throw err;
        if (err?.code === "42P01" || err?.code === "42703") return { rows: [], rowCount: 0 };
        throw err;
      }
    },
  };
}

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.leads_clients (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, telefone TEXT, opt_out BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb, dados JSONB DEFAULT '{}'::jsonb, updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE public.lead_client_n8n_settings (client_id TEXT PRIMARY KEY, chatbot_enabled BOOLEAN DEFAULT false);
  CREATE TABLE public.lead_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, phone TEXT, sender_type TEXT NOT NULL DEFAULT 'agent',
    direction TEXT NOT NULL DEFAULT 'outbound', engagement_signal TEXT, message_text TEXT, campaign_id UUID, dispatch_id UUID,
    lead_id UUID, delivered_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    instance_name TEXT, wa_message_id TEXT, message_timestamp TIMESTAMPTZ, media_path TEXT, media_url TEXT, content_type TEXT,
    identifier TEXT
  );
  CREATE TABLE public.lead_client_evolution_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, name TEXT, dispatch_webhook_url TEXT,
    dispatch_webhook_token TEXT, inbound_bearer_token TEXT, active BOOLEAN DEFAULT true, is_default BOOLEAN DEFAULT false,
    chip_state TEXT, connection_state TEXT, daily_limit_override INT, owner_uid TEXT, webhook_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), updated_by_email TEXT
  );
  CREATE TABLE public.evolution_instance_daily_usage (instance_id UUID, date DATE, sent_count INT, PRIMARY KEY (instance_id, date));
  CREATE UNIQUE INDEX idx_lead_messages_wa_message_id ON public.lead_messages (wa_message_id) WHERE wa_message_id IS NOT NULL;
`;

let envios; // números que receberam texto pela Evolution
let promptsDoModelo;
let respostaDoModelo;
let modeloFalha;
let settings;
let agenteInboundLigado;
let campanhaAtiva;
let spies;
let webhook;
let fetchOriginal;

async function montarBanco({ comConcessao = true } = {}) {
  db = await createPgliteDb(SCHEMA);
  for (const m of [
    "20260901190000_create_whatsapp_chat_states.sql",
    "20260911120000_add_agent_muted_to_whatsapp_chat_states.sql",
    "20261030160000_add_human_takeover_agent_pause.sql",
    "20261031000000_agent_pause_expiry.sql",
    "20261112010000_lead_optouts_fonte_unica.sql",
  ]) {
    await db.exec(migracao(m));
  }
  if (comConcessao) await db.exec(migracao("20261117220000_create_agent_inbound_claims.sql"));
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, 'Container LED')", [TENANT]);
  await db.query("INSERT INTO lead_client_n8n_settings (client_id, chatbot_enabled) VALUES ($1, true)", [TENANT]);
  await db.query(
    "INSERT INTO lead_client_evolution_instances (client_id, name, dispatch_webhook_url, dispatch_webhook_token, is_default) VALUES ($1, 'Atendimento', $2, 'evo-token', true)",
    [TENANT, `${EVO}/message/sendText/${INSTANCIA}`]
  );
}

// "Boot": registra as rotas (e com elas o handler que a varredura usa), como o servidor faz ao subir.
function boot() {
  const routes = {};
  const reg = (method) => vi.fn((path, ...handlers) => { routes[`${method} ${path}`] = handlers[handlers.length - 1]; });
  const app = { post: reg("POST"), get: reg("GET"), delete: reg("DELETE"), put: reg("PUT"), patch: reg("PATCH") };
  const pool = toleranteSilencioso(db);
  const real = createPgSupabaseClient(pool);
  const agentRows = () => [{
    id: AGENTE, tenant_id: TENANT, name: "Atendente", agent_kind: "atendimento", inbound_enabled: agenteInboundLigado,
    evolution_instance: INSTANCIA, evolution_instances: [INSTANCIA], inbound_prompt: "Você é a atendente da Container LED.",
    inbound_spin_fields: [], instructions_consolidated_at: "2026-10-10T17:00:00.000Z",
  }];
  const leadRows = [{ id: "11111111-2222-4333-8444-555555555555", client_id: TENANT, telefone: LEAD, phone: LEAD, historico: [], dados: {}, status_conversa: "aberto", finalizado: false }];
  const chain = (table) => {
    const rows = table === "followup_companies" ? agentRows() : leadRows;
    const c = {
      select: vi.fn(() => c), eq: vi.fn(() => c), in: vi.fn(() => c), is: vi.fn(() => c), gte: vi.fn(() => c),
      order: vi.fn(() => c), limit: vi.fn(() => c),
      maybeSingle: vi.fn(async () => ({ data: rows[0], error: null })), single: vi.fn(async () => ({ data: rows[0], error: null })),
      insert: vi.fn(() => c), update: vi.fn(() => c), upsert: vi.fn(() => c),
      then: (resolve) => resolve({ data: rows, error: null }),
    };
    return c;
  };
  const chip = {
    id: "chip-1", client_id: TENANT, name: "Atendimento", active: true, is_default: true,
    dispatch_webhook_url: `${EVO}/message/sendText/${INSTANCIA}`, dispatch_webhook_token: "evo-token",
  };
  registerChatbotRoutes(app, {
    ensureDb: () => true,
    getLeadClientEvolutionInstances: async () => [chip],
    getLeadClientN8nSettings: vi.fn(async () => settings),
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    leadsTableName: () => "leads",
    maskPhoneForLog: (p) => p,
    MAX_LEADS_OUTLIER_BATCH: 100,
    continueCampaignLeadFromReply: async () => ({ continued: false }),
    findCampaignReplyMatches: async () => ({
      matches: campanhaAtiva ? [campanhaAtiva] : [], waitForReplyMatches: [], processingWaitForReplyMatches: [],
      activePeriodCampaign: campanhaAtiva,
    }),
    normalizeString: (s) => (s ? String(s).trim() : ""),
    normalizeTenantKey: (k) => (k ? String(k).trim() : ""),
    pgDatabasePool: pool,
    requireAppViewAccess: () => (_req, _res, next) => next(),
    requireFirebaseAuth: (_req, _res, next) => next(),
    resolveAuthorizedClientId: (_req, _res, cid) => cid,
    resolveDispatchWebhookSettings: async () => ({ webhookUrl: chip.dispatch_webhook_url, webhookToken: chip.dispatch_webhook_token }),
    resolveInboundDispatchSettings: async () => ({ webhookUrl: chip.dispatch_webhook_url, webhookToken: chip.dispatch_webhook_token, instanceName: INSTANCIA }),
    sanitizePhone: (p) => String(p || "").replace(/@.*$/, "").replace(/\D/g, ""),
    sendError: vi.fn(),
    // lead_messages é banco de verdade; o resto (agente do chip, lead) vem do dublê de configuração.
    supabase: { from: vi.fn((table) => (table === "lead_messages" ? real.from(table) : chain(table))) },
    validateLeadsOutlierRecord: () => true,
    validateN8nInboundBearer: () => true,
  });
  webhook = routes["POST /api/hardcoded-chat-webhook"];
  return webhook;
}

// Simula o restart do contêiner: o que estava no buffer e na memória do processo some; as rotas sobem de novo.
function restart() {
  for (const [, b] of _messageBuffersForTest) if (b?.timer) clearTimeout(b.timer);
  _messageBuffersForTest.clear();
  recovery._resetAgentRecoveryForTest();
  boot();
}

let seq = 0;
function mensagem(texto, { id = null, phone = LEAD } = {}) {
  seq += 1;
  return {
    event: "messages.upsert",
    instance: INSTANCIA,
    clientId: TENANT,
    data: {
      key: { remoteJid: `${phone}@s.whatsapp.net`, fromMe: false, id: id || `3EB0LED${String(seq).padStart(8, "0")}` },
      pushName: "Lead",
      message: { conversation: texto },
      messageType: "conversation",
    },
  };
}
const chamar = async (body) => {
  const res = { json: vi.fn(), status: vi.fn(function () { return this; }) };
  await webhook({ body, query: { clientId: TENANT } }, res);
  return res.json.mock.calls[0]?.[0];
};

// Órfã gravada direto: mensagem do lead de `idadeS` segundos atrás, sem resposta (como o webhook teria gravado).
async function orfa({ idadeS = 90, id = `ORFA-${++seq}`, texto = "Vocês têm painel de LED para fachada?", phone = LEAD } = {}) {
  const t = new Date(Date.now() - idadeS * 1000).toISOString();
  await db.query(
    `INSERT INTO lead_messages (client_id, phone, sender_type, direction, message_text, instance_name, wa_message_id, message_timestamp, created_at)
     VALUES ($1, $2, 'lead', 'inbound', $3, $4, $5, $6, $6)`,
    [TENANT, phone, texto, INSTANCIA, id, t]
  );
  return id;
}
const concessao = async (id) => (await db.query("SELECT * FROM agent_inbound_claims WHERE msg_key = $1", [id])).rows[0];
const respostasDoBot = async () =>
  (await db.query("SELECT phone, message_text FROM lead_messages WHERE sender_type = 'bot' AND direction = 'outbound'")).rows;
const varrer = (extra = {}) => recovery.varrerOrfas({ pool: toleranteSilencioso(db), ...extra });
const esperar = async (cond, ms = 12_000) => {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error("timeout esperando condição");
    await new Promise((r) => setTimeout(r, 50));
  }
};
const assentar = () => new Promise((r) => setTimeout(r, 4500)); // buffer de 3 s + IA + envio

beforeEach(() => {
  spies = ["log", "info", "warn", "error"].map((m) => (process.env.ORFAS_DEBUG ? vi.spyOn(console, m) : vi.spyOn(console, m).mockImplementation(() => {})));
  process.env.EVOLUTION_API_URL = EVO;
  process.env.EVOLUTION_API_KEY = "mock-evo-key";
  process.env.GROQ_API_KEY = "mock-groq-key";
  process.env.GEMINI_API_KEY = "mock-gemini-key";
  envios = [];
  promptsDoModelo = [];
  modeloFalha = false;
  agenteInboundLigado = true;
  campanhaAtiva = null;
  settings = { client_id: TENANT, chatbot_enabled: true, inbound_scope: "all", send_window_enabled: false, sdr_whatsapp_numbers: [] };
  respostaDoModelo = { mensagem: "Temos sim! Qual o tamanho da fachada?", status_conversa: "aguardando_usuario", dados: {}, classificacao: "MORNO", finalizado: false, nao_comercial: false };
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/message/sendText")) {
      envios.push(JSON.parse(opts.body || "{}").number);
      return { ok: true, status: 201, json: async () => ({ key: { id: `wa-bot-${envios.length}` } }), text: async () => "{}" };
    }
    if (u.includes("/chat/sendPresence")) return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
    // Qualquer outra chamada é o provedor de IA.
    const body = JSON.parse(opts.body || "{}");
    if (Array.isArray(body.messages)) promptsDoModelo.push(body.messages[body.messages.length - 1]?.content || "");
    if (modeloFalha) return { ok: false, status: 500, json: async () => ({ error: "boom" }), text: async () => "boom" };
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(respostaDoModelo) } }], usage: { total_tokens: 50 } }),
      text: async () => "",
    };
  });
  recovery._resetAgentRecoveryForTest();
});

afterEach(async () => {
  for (const [, b] of _messageBuffersForTest) if (b?.timer) clearTimeout(b.timer);
  _messageBuffersForTest.clear();
  await drenarBuffersDoAgente({ timeoutMs: 3000 }).catch(() => {});
  globalThis.fetch = fetchOriginal;
  spies.forEach((s) => s.mockRestore());
  if (db) await db.close();
  db = null;
});

describe("[OBRIGATÓRIO] restart no meio do buffer: a mensagem é respondida depois", () => {
  it("com a tabela de concessão: webhook responde 'buffering', o contêiner reinicia, a varredura do novo processo responde uma vez", async () => {
    await montarBanco();
    boot();
    const out = await chamar(mensagem("Oi, quero orçamento de painel de LED", { id: "WA-RESTART-1" }));
    expect(out).toMatchObject({ success: true, status: "buffering" });
    expect(await concessao("WA-RESTART-1")).toMatchObject({ status: "processando", origem: "webhook" });

    restart(); // o buffer morreu com o processo antigo
    // A linha ficou com o dono antigo, parada: é o que o processo novo encontra.
    await db.query("UPDATE agent_inbound_claims SET owner = 'boot-antigo', updated_at = now() - interval '2 minutes' WHERE msg_key = 'WA-RESTART-1'");
    await assentar();
    expect(envios).toHaveLength(0); // ninguém respondeu: era exatamente o caso da Container LED

    const r = await varrer({ agora: new Date(Date.now() + 90_000) });
    expect(r).toMatchObject({ candidatas: 1, reprocessadas: 1 });
    await esperar(async () => (await concessao("WA-RESTART-1"))?.status === "respondida");
    expect(envios).toEqual([LEAD]);
    const c = await concessao("WA-RESTART-1");
    expect(c).toMatchObject({ status: "respondida", origem: "varredura", attempts: 2 });
    expect(c.total_ms).toBeGreaterThan(0);
    expect(await respostasDoBot()).toEqual([{ phone: LEAD, message_text: "Temos sim! Qual o tamanho da fachada?" }]);
    // Respondida: a próxima varredura não acha mais nada.
    expect((await varrer({ agora: new Date(Date.now() + 120_000) })).candidatas).toBe(0);
    // A mensagem do lead não foi gravada duas vezes.
    const doLead = (await db.query("SELECT count(*)::int AS n FROM lead_messages WHERE wa_message_id = 'WA-RESTART-1'")).rows[0].n;
    expect(doLead).toBe(1);
  }, SLOW);

  it("sem a tabela (runner de migration travado): concessão em memória, mesma resposta", async () => {
    await montarBanco({ comConcessao: false });
    boot();
    await chamar(mensagem("Oi, quero orçamento", { id: "WA-RESTART-2" }));
    restart();
    await assentar();
    expect(envios).toHaveLength(0);
    const r = await varrer({ agora: new Date(Date.now() + 90_000) });
    expect(r.reprocessadas).toBe(1);
    await esperar(async () => envios.length === 1);
    await assentar();
    expect(envios).toEqual([LEAD]);
    expect((await varrer({ agora: new Date(Date.now() + 120_000) })).candidatas).toBe(0);
  }, SLOW);

  it("a resposta normal (sem restart) grava 'respondida' com o tempo total, e a varredura não toca", async () => {
    await montarBanco();
    boot();
    await chamar(mensagem("Bom dia", { id: "WA-NORMAL-1" }));
    await esperar(async () => (await concessao("WA-NORMAL-1"))?.status === "respondida");
    expect(await concessao("WA-NORMAL-1")).toMatchObject({ status: "respondida", origem: "webhook", attempts: 1 });
    expect(envios).toEqual([LEAD]);
    const linhaDeTempo = spies[0].mock.calls.find((c) => c[0] === "[chatbot-webhook] tempo_resposta");
    expect(linhaDeTempo?.[1]).toMatchObject({ origem: "webhook", entregue: true });
    expect(linhaDeTempo[1].ms).toBeGreaterThanOrEqual(3000); // inclui o buffer de 3 s
    expect((await varrer({ agora: new Date(Date.now() + 90_000) })).candidatas).toBe(0);
  }, SLOW);

  it("conversa ainda no buffer deste processo não é pega pela varredura (sem resposta dobrada)", async () => {
    await montarBanco();
    boot();
    await chamar(mensagem("Oi", { id: "WA-ANDAMENTO-1" }));
    const r = await varrer({ agora: new Date(Date.now() + 90_000) });
    expect(r.reprocessadas).toBe(0);
    expect(r.puladas.map((p) => p.motivo)).toEqual(["em_andamento"]);
    await esperar(async () => envios.length === 1);
    await assentar();
    expect(envios).toHaveLength(1);
  }, SLOW);
});

describe("[OBRIGATÓRIO] cada portão barra a varredura (e ela não insiste)", () => {
  const casos = [
    ["opt-out", async () => registerOptOut(toleranteSilencioso(db), { clientId: TENANT, phone: LEAD, source: "palavra", reason: "sair" }), /opt_out/],
    ["pausa humana", async () => db.query(
      "INSERT INTO whatsapp_chat_states (client_id, phone, state, agent_muted_at, agent_muted_source, agent_muted_reason) VALUES ($1, $2, 'ativa', now(), 'manual', 'atendimento humano')",
      [TENANT, LEAD]
    ), /muted|pausa|human/i],
    ["número de SDR", async () => { settings.sdr_whatsapp_numbers = [LEAD]; }, /sdr/i],
    ["campanha Sem IA", async () => { campanhaAtiva = { id: "c-1", name: "Feirão", status: "ativa", analyticsMeta: { dispatchOptions: { replyAgent: "passos" } } }; }, /campanha_sem_ia/],
    ["agente desligado", async () => { settings.chatbot_enabled = false; agenteInboundLigado = false; }, /disabled/],
  ];
  for (const [nome, preparar, motivo] of casos) {
    it(`${nome}: nenhuma resposta, desfecho 'descartada' com o motivo, e a varredura seguinte não reprocessa`, async () => {
      await montarBanco();
      boot();
      await preparar();
      const id = await orfa();
      const r = await varrer();
      expect(r.reprocessadas).toBe(1); // entrou pelo handler...
      await esperar(async () => ["descartada", "respondida", "falhou"].includes((await concessao(id))?.status));
      await assentar();
      expect(envios).toHaveLength(0); // ...e o portão barrou
      const c = await concessao(id);
      expect(c.status).toBe("descartada");
      expect(String(c.motivo)).toMatch(motivo);
      const r2 = await varrer({ agora: new Date(Date.now() + 60_000) });
      expect(r2.reprocessadas).toBe(0);
      expect(r2.puladas.map((p) => p.motivo)).toEqual(["ja_concedida"]);
    }, SLOW);
  }

  it("freio diário: a IA marca 'não comercial' e o agente é silenciado; a varredura não insiste", async () => {
    await montarBanco();
    boot();
    respostaDoModelo = { ...respostaDoModelo, nao_comercial: true, motivo_nao_comercial: "Número errado" };
    const id = await orfa();
    await varrer();
    await esperar(async () => ["descartada", "respondida"].includes((await concessao(id))?.status));
    const c = await concessao(id);
    expect(c).toMatchObject({ status: "descartada", motivo: "nao_comercial" });
    expect(envios).toHaveLength(0);
    // E o silêncio ficou gravado na conversa (é ele que conta no freio de 20 por dia).
    const silenciada = (await db.query("SELECT agent_muted_at FROM whatsapp_chat_states WHERE client_id = $1", [TENANT])).rows[0];
    expect(silenciada?.agent_muted_at).toBeTruthy();
    expect((await varrer({ agora: new Date(Date.now() + 60_000) })).reprocessadas).toBe(0);
  }, SLOW);

  it("freio diário esgotado (20 silenciadas hoje): a trava segura o silêncio e a órfã é respondida, uma vez", async () => {
    await montarBanco();
    boot();
    for (let i = 0; i < 20; i += 1) {
      await db.query(
        "INSERT INTO whatsapp_chat_states (client_id, phone, state, agent_muted_at, agent_muted_source, agent_muted_reason) VALUES ($1, $2, 'ativa', now(), 'classificador', 'engano')",
        [TENANT, `55349880${String(1000 + i)}`]
      );
    }
    respostaDoModelo = { ...respostaDoModelo, nao_comercial: true, motivo_nao_comercial: "Número errado" };
    const id = await orfa();
    await varrer();
    await esperar(async () => (await concessao(id))?.status === "respondida");
    expect(envios).toEqual([LEAD]);
  }, SLOW);

  it("regressão: sem portão nenhum, a órfã é respondida", async () => {
    await montarBanco();
    boot();
    const id = await orfa();
    await varrer();
    await esperar(async () => (await concessao(id))?.status === "respondida");
    expect(envios).toEqual([LEAD]);
  }, SLOW);
});

describe("[OBRIGATÓRIO] duas varreduras ao mesmo tempo mandam UMA resposta", () => {
  it("com a tabela: a concessão atômica deixa uma só reprocessar", async () => {
    await montarBanco();
    boot();
    const id = await orfa();
    const [a, b] = await Promise.all([varrer(), varrer()]);
    expect(a.reprocessadas + b.reprocessadas).toBe(1);
    await esperar(async () => (await concessao(id))?.status === "respondida");
    await assentar();
    expect(envios).toEqual([LEAD]);
  }, SLOW);

  it("dois processos (donos diferentes) disputando a mesma mensagem no banco: só um ganha", async () => {
    await montarBanco();
    const pool = toleranteSilencioso(db);
    const tentativas = await Promise.all(
      Array.from({ length: 5 }, () => recovery.reservarParaVarredura({ pool, clientId: TENANT, phone: LEAD, msgKey: "DISPUTA-1" }))
    );
    expect(tentativas.filter(Boolean)).toHaveLength(1);
  }, SLOW);

  it("sem a tabela: a concessão em memória também deixa uma só", async () => {
    await montarBanco({ comConcessao: false });
    boot();
    await orfa();
    const [a, b] = await Promise.all([varrer(), varrer()]);
    expect(a.reprocessadas + b.reprocessadas).toBe(1);
    await esperar(async () => envios.length >= 1);
    await assentar();
    expect(envios).toEqual([LEAD]);
  }, SLOW);
});

describe("[OBRIGATÓRIO] teto de 30 minutos", () => {
  it("mensagem com mais de 30 min não é respondida e a conversa continua esperando resposta", async () => {
    await montarBanco();
    boot();
    const id = await orfa({ idadeS: 31 * 60 });
    const r = await varrer();
    expect(r.candidatas).toBe(0);
    await assentar();
    expect(envios).toHaveLength(0);
    expect(await concessao(id)).toBeUndefined();
    // A última mensagem da conversa segue sendo a do lead: é isso que a tela mostra como "esperam você".
    const ultima = (await db.query("SELECT direction FROM lead_messages ORDER BY coalesce(message_timestamp, created_at) DESC LIMIT 1")).rows[0];
    expect(ultima.direction).toBe("inbound");
  }, SLOW);

  it("menos de 60 s também não (o webhook ainda pode estar respondendo)", async () => {
    await montarBanco();
    boot();
    await orfa({ idadeS: 20 });
    expect((await varrer()).candidatas).toBe(0);
  }, SLOW);

  it("conversa já respondida (mensagem nossa depois da do lead) não é candidata", async () => {
    await montarBanco();
    boot();
    await orfa({ idadeS: 120 });
    await db.query(
      "INSERT INTO lead_messages (client_id, phone, sender_type, direction, message_text, message_timestamp, created_at) VALUES ($1, $2, 'device', 'outbound', 'oi, já te atendo', now() - interval '100 seconds', now() - interval '100 seconds')",
      [TENANT, LEAD]
    );
    expect((await varrer()).candidatas).toBe(0);
  }, SLOW);
});

describe("[OBRIGATÓRIO] falha da IA não some", () => {
  it("IA falha em todas as tentativas: 'falhou' gravado; a varredura tenta de novo até 3 vezes e responde quando a IA volta", async () => {
    await montarBanco();
    boot();
    modeloFalha = true;
    const id = await orfa({ idadeS: 120 });
    await varrer();
    await esperar(async () => (await concessao(id))?.status === "falhou");
    expect(await concessao(id)).toMatchObject({ status: "falhou", attempts: 1 });
    expect(String((await concessao(id)).motivo)).toMatch(/falha_ia|resposta_vazia/);
    expect(envios).toHaveLength(0);

    modeloFalha = false; // a IA voltou
    const r = await varrer({ agora: new Date(Date.now() + 60_000) });
    expect(r.reprocessadas).toBe(1);
    await esperar(async () => (await concessao(id))?.status === "respondida");
    expect(await concessao(id)).toMatchObject({ status: "respondida", attempts: 2 });
    expect(envios).toEqual([LEAD]);
  }, SLOW);

  it("depois de 3 tentativas com falha, para de tentar", async () => {
    await montarBanco();
    boot();
    modeloFalha = true;
    const id = await orfa({ idadeS: 120 });
    for (let i = 1; i <= 3; i += 1) {
      await varrer({ agora: new Date(Date.now() + i * 1000) });
      await esperar(async () => (await concessao(id))?.status === "falhou" && (await concessao(id)).attempts === i);
    }
    const r = await varrer({ agora: new Date(Date.now() + 5000) });
    expect(r.reprocessadas).toBe(0);
    expect(envios).toHaveLength(0);
  }, SLOW);
});

describe("[OBRIGATÓRIO] desligamento limpo: o buffer é processado antes de sair", () => {
  it("drenarBuffersDoAgente processa na hora o que está esperando e espera terminar", async () => {
    const processados = [];
    bufferMessage(TENANT, LEAD, { text: "msg 1" }, async (msgs) => {
      await new Promise((r) => setTimeout(r, 200)); // IA em andamento
      processados.push(msgs.map((m) => m.text));
    }, INSTANCIA);
    bufferMessage(TENANT, LEAD, { text: "msg 2" }, async (msgs) => {
      await new Promise((r) => setTimeout(r, 200));
      processados.push(msgs.map((m) => m.text));
    }, INSTANCIA);
    const t0 = Date.now();
    const r = await drenarBuffersDoAgente({ timeoutMs: 2000 });
    expect(Date.now() - t0).toBeLessThan(2000); // não esperou os 3 s do buffer
    expect(r).toMatchObject({ buffers: 1, emAndamento: 1, terminou: true });
    expect(processados).toEqual([["msg 1", "msg 2"]]); // um lote só, com as duas
  });

  it("resposta que passa do prazo: devolve terminou false sem travar o desligamento", async () => {
    bufferMessage(TENANT, LEAD, { text: "lenta" }, () => new Promise((r) => setTimeout(r, 3000)), INSTANCIA);
    const r = await drenarBuffersDoAgente({ timeoutMs: 200 });
    expect(r.terminou).toBe(false);
  });
});
