// backend/src/test/agenteOrfas.test.js
//
// Agente de IA: mensagem do lead que fica sem resposta (Container LED, 17/11/2026) e a revisão independente do #269.
//
// Postgres REAL (pglite) com as migrations do produto (concessão, estados da conversa, pausa, opt-out). Handler REAL do
// webhook, varredura REAL, processBatch REAL. As dependências que decidem os portões são as REAIS, lendo o banco:
// getLeadClientN8nSettings, findCampaignReplyMatches, continueCampaignLeadFromReply, resolveInboundDispatchSettings,
// resolveInboundAgentConfig (agente do chip em followup_companies). Dublado só o que sai do processo: o HTTP da
// Evolution (envio) e o HTTP do modelo de IA.

import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi, onTestFinished } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";

let db = null;
let supa = null;
vi.mock("../services/database.js", async (importOriginal) => {
  const actual = await importOriginal();
  const mocked = { ...actual };
  Object.defineProperty(mocked, "pgDatabasePool", { enumerable: true, get: () => (db ? poolDoTeste(db) : null) });
  Object.defineProperty(mocked, "supabase", { enumerable: true, get: () => supa });
  return mocked;
});

const { registerChatbotRoutes } = await import("../domains/chatbot/routes.js");
const { _messageBuffersForTest, drenarBuffersDoAgente, bufferMessage } = await import("../chatbot-ai-engine.js");
const recovery = await import("../services/agentInboundRecovery.js");
const { registerOptOut } = await import("../services/optOut.js");
const { _resetInboundGuard } = await import("../services/inboundGuard.js");
const { createPgSupabaseClient } = await import("../pgSupabaseCompat.js");
const { getLeadClientN8nSettings } = await import("../services/n8nSettings.js");
const { findCampaignReplyMatches, continueCampaignLeadFromReply } = await import("../campaign/dispatch.js");
const { resolveInboundDispatchSettings } = await import("../campaign/settings.js");
const { getLeadClientEvolutionInstances } = await import("../services/evolution.js");
const { fetchWorkStatePage, fetchWorkStateCounts } = await import("../services/inboxWorkState.js");

const SLOW = 60_000;
const MIG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");
const migracao = (nome) => readFileSync(join(MIG, nome), "utf8");
const TENANT = "container-led";
const INSTANCIA = "container-led-chip-de-disparo-atendimento";
const EVO = "https://evo.teste";
const LEAD = "5534999001001";
const AGENTE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CAMPANHA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// Pool real; tabela/coluna que este teste não montou (o handler toca tabelas de outras frentes) responde vazio.
// A concessão PRECISA ver o erro de tabela ausente: é ele que liga o modo em memória, como em produção.
function poolDoTeste(base) {
  return {
    query: async (sql, params) => {
      try {
        return await base.query(sql, params);
      } catch (err) {
        if (/agent_inbound_claims/.test(String(sql))) throw err;
        if (err?.code === "42P01" || err?.code === "42703") return { rows: [], rowCount: 0 };
        throw err;
      }
    },
    connect: async () => ({ query: (sql, params) => base.query(sql, params), release() {} }),
  };
}

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.leads_clients (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, telefone TEXT, nome TEXT, opt_out BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb, dados JSONB DEFAULT '{}'::jsonb, historico JSONB DEFAULT '[]'::jsonb, status TEXT,
    status_conversa TEXT, finalizado BOOLEAN DEFAULT false, lead_origin TEXT, source_campaign_id UUID, source_campaign_name TEXT,
    lead_source TEXT, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE public.lead_client_n8n_settings (
    client_id TEXT PRIMARY KEY, dispatch_webhook_url TEXT, dispatch_webhook_token TEXT, inbound_bearer_token TEXT, active BOOLEAN DEFAULT true,
    chatbot_enabled BOOLEAN DEFAULT false, chatbot_model TEXT, chatbot_llm_model TEXT, chatbot_instances JSONB DEFAULT '[]'::jsonb,
    chatbot_inbound_scope TEXT, recontact_message TEXT, sdr_whatsapp_numbers JSONB DEFAULT '[]'::jsonb, sdr_distribution TEXT,
    agent_name TEXT, segmentation_config JSONB, sdr_whatsapp_number TEXT, allowed_tabs JSONB, plan_tier TEXT, modulos_avulsos JSONB,
    chip_limit INT, degustacao_expira_em TIMESTAMPTZ, send_window_start TEXT, send_window_end TEXT, send_window_days JSONB,
    send_window_timezone TEXT, send_window_enabled BOOLEAN DEFAULT false, agent_replies_outside_window BOOLEAN DEFAULT true,
    chatbot_voice_mode TEXT, chatbot_voice_id TEXT, chatbot_voice_speed NUMERIC, updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by_uid TEXT, updated_by_email TEXT
  );
  CREATE TABLE public.lead_client_evolution_instances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, name TEXT, dispatch_webhook_url TEXT,
    dispatch_webhook_token TEXT, inbound_bearer_token TEXT, active BOOLEAN DEFAULT true, is_default BOOLEAN DEFAULT false,
    chip_state TEXT, connection_state TEXT, daily_limit_override INT, owner_uid TEXT, webhook_enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now(), updated_by_email TEXT
  );
  CREATE TABLE public.evolution_instance_daily_usage (instance_id UUID, date DATE, sent_count INT, PRIMARY KEY (instance_id, date));
  CREATE TABLE public.followup_companies (
    id UUID PRIMARY KEY, tenant_id TEXT, name TEXT, archived_at TIMESTAMPTZ, evolution_instance TEXT, evolution_instances JSONB,
    inbound_role TEXT, inbound_enabled BOOLEAN DEFAULT false, inbound_model TEXT, inbound_prompt TEXT, inbound_spin_fields JSONB,
    inbound_webhook_url TEXT, sdr_whatsapp_number TEXT, sdr_transfer_enabled BOOLEAN, instructions_consolidated_at TIMESTAMPTZ,
    agent_kind TEXT, inbound_extraction_prompt TEXT, inbound_extraction_enabled BOOLEAN
  );
  CREATE TABLE public.campaigns (
    id UUID PRIMARY KEY, client_id TEXT NOT NULL, name TEXT, import_id UUID, status TEXT DEFAULT 'ativa', scheduled_for TIMESTAMPTZ,
    last_triggered_at TIMESTAMPTZ, archived_at TIMESTAMPTZ, phones JSONB DEFAULT '[]'::jsonb, analytics_meta JSONB DEFAULT '{}'::jsonb,
    starts_at TIMESTAMPTZ, ends_at TIMESTAMPTZ, chatbot_prompt_type TEXT, mode TEXT, campaign_prompt_id UUID, webhook_url TEXT,
    webhook_token TEXT, created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE public.lead_import_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT, import_id UUID, telefone TEXT, normalized_data JSONB DEFAULT '{}'::jsonb,
    status_conversa TEXT, ultima_interacao_bot TIMESTAMPTZ, ultima_interacao_usuario TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
  );
  CREATE TABLE public.lead_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, phone TEXT, sender_type TEXT NOT NULL DEFAULT 'agent',
    direction TEXT NOT NULL DEFAULT 'outbound', engagement_signal TEXT, message_text TEXT, campaign_id UUID, dispatch_id UUID,
    lead_id UUID, delivered_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    instance_name TEXT, wa_message_id TEXT, message_timestamp TIMESTAMPTZ, media_path TEXT, media_url TEXT, content_type TEXT,
    identifier TEXT, contact_name TEXT, is_group BOOLEAN DEFAULT false
  );
  CREATE UNIQUE INDEX idx_lead_messages_wa_message_id ON public.lead_messages (wa_message_id) WHERE wa_message_id IS NOT NULL;
  CREATE TABLE public.whatsapp_lid_map (lid TEXT PRIMARY KEY, phone TEXT, profile_pic TEXT, contact_name TEXT);
`;

let envios; // números que receberam texto pela Evolution
let envioPendurado; // quando definido, o envio fica preso até o teste soltar (simula o processo morrendo no meio)
let envioLanca;
let modeloFalha;
let respostaDoModelo;
let spies;
let webhook;
let fetchOriginal;

async function montarBanco({ comConcessao = true, comEnviando = true } = {}) {
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
  await db.exec("ALTER TABLE public.whatsapp_chat_states ADD COLUMN IF NOT EXISTS attended_at TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS attended_by TEXT");
  if (comConcessao) await db.exec(migracao("20261117220000_create_agent_inbound_claims.sql"));
  if (comConcessao && comEnviando) await db.exec(migracao("20261118090000_agent_inbound_claims_enviando.sql"));
  supa = createPgSupabaseClient(poolDoTeste(db));
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, 'Container LED')", [TENANT]);
  await db.query(
    "INSERT INTO lead_client_n8n_settings (client_id, chatbot_enabled, chatbot_inbound_scope, send_window_enabled, sdr_whatsapp_numbers) VALUES ($1, true, 'all', false, '[]'::jsonb)",
    [TENANT]
  );
  await db.query(
    "INSERT INTO lead_client_evolution_instances (client_id, name, dispatch_webhook_url, dispatch_webhook_token, is_default) VALUES ($1, 'Atendimento', $2, 'evo-token', true)",
    [TENANT, `${EVO}/message/sendText/${INSTANCIA}`]
  );
  await db.query(
    `INSERT INTO followup_companies (id, tenant_id, name, evolution_instance, evolution_instances, inbound_enabled, inbound_prompt, inbound_spin_fields, agent_kind, instructions_consolidated_at)
     VALUES ($1, $2, 'Atendente', $3, $4::jsonb, true, 'Você é a atendente da Container LED.', '[]'::jsonb, 'atendimento', '2026-10-10T17:00:00Z')`,
    [AGENTE, TENANT, INSTANCIA, JSON.stringify([INSTANCIA])]
  );
}

// "Boot": registra as rotas (e com elas o handler que a varredura usa), como o servidor faz ao subir.
function boot() {
  const routes = {};
  const reg = (method) => vi.fn((path, ...handlers) => { routes[`${method} ${path}`] = handlers[handlers.length - 1]; });
  const app = { post: reg("POST"), get: reg("GET"), delete: reg("DELETE"), put: reg("PUT"), patch: reg("PATCH") };
  registerChatbotRoutes(app, {
    ensureDb: () => true,
    getLeadClientEvolutionInstances,
    getLeadClientN8nSettings,
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    leadsTableName: () => "leads",
    maskPhoneForLog: (p) => p,
    MAX_LEADS_OUTLIER_BATCH: 100,
    continueCampaignLeadFromReply,
    findCampaignReplyMatches,
    normalizeString: (s) => (s ? String(s).trim() : ""),
    normalizeTenantKey: (k) => (k ? String(k).trim() : ""),
    pgDatabasePool: poolDoTeste(db),
    requireAppViewAccess: () => (_req, _res, next) => next(),
    requireFirebaseAuth: (_req, _res, next) => next(),
    resolveAuthorizedClientId: (_req, _res, cid) => cid,
    resolveDispatchWebhookSettings: async () => ({}),
    resolveInboundDispatchSettings,
    sanitizePhone: (p) => String(p || "").replace(/@.*$/, "").replace(/\D/g, ""),
    sendError: vi.fn(),
    supabase: supa,
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
  _resetInboundGuard(); // a memória de deduplicação também morre com o processo
  boot();
}

let seq = 0;
function mensagem(texto, { id = null, phone = LEAD, horaReal = new Date() } = {}) {
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
      messageTimestamp: Math.floor(new Date(horaReal).getTime() / 1000),
    },
  };
}
const chamar = async (body) => {
  const res = { json: vi.fn(), status: vi.fn(function () { return this; }) };
  await webhook({ body, query: { clientId: TENANT } }, res);
  return res.json.mock.calls[0]?.[0];
};

// Órfã gravada direto (sincronização ou webhook que morreu depois de gravar): mensagem do lead de `idadeS` segundos.
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
const metaDaMensagem = async (id) => (await db.query("SELECT meta FROM lead_messages WHERE wa_message_id = $1", [id])).rows[0]?.meta || {};
const varrer = (extra = {}) => recovery.varrerOrfas({ pool: poolDoTeste(db), espacoMs: 0, ...extra });
const esperar = async (cond, ms = 12_000) => {
  const t0 = Date.now();
  while (!(await cond())) {
    if (Date.now() - t0 > ms) throw new Error("timeout esperando condição");
    await new Promise((r) => setTimeout(r, 50));
  }
};
const assentar = () => new Promise((r) => setTimeout(r, 4500)); // buffer de 3 s + IA + envio
const estadoDaConversa = async () => {
  const query = (sql, params) => db.query(sql, params);
  const counts = await fetchWorkStateCounts(query, { clientId: TENANT, now: new Date(), robotChips: [INSTANCIA] });
  const esperam = await fetchWorkStatePage(query, { clientId: TENANT, state: "esperam", now: new Date(), robotChips: [INSTANCIA] });
  return { counts, esperam };
};

beforeEach(() => {
  spies = ["log", "info", "warn", "error"].map((m) => (process.env.ORFAS_DEBUG ? vi.spyOn(console, m) : vi.spyOn(console, m).mockImplementation(() => {})));
  process.env.EVOLUTION_API_URL = EVO;
  process.env.EVOLUTION_API_KEY = "mock-evo-key";
  process.env.GROQ_API_KEY = "mock-groq-key";
  process.env.GEMINI_API_KEY = "mock-gemini-key";
  envios = [];
  envioPendurado = null;
  envioLanca = false;
  modeloFalha = false;
  respostaDoModelo = { mensagem: "Temos sim! Qual o tamanho da fachada?", status_conversa: "aguardando_usuario", dados: {}, classificacao: "MORNO", finalizado: false, nao_comercial: false };
  fetchOriginal = globalThis.fetch;
  globalThis.fetch = vi.fn(async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/message/sendText")) {
      envios.push(JSON.parse(opts.body || "{}").number);
      if (envioLanca) throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      if (envioPendurado) await envioPendurado.promessa;
      return { ok: true, status: 201, json: async () => ({ key: { id: `wa-bot-${envios.length}` } }), text: async () => "{}" };
    }
    if (u.startsWith(EVO)) return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" }; // outras rotas da Evolution
    if (modeloFalha) return { ok: false, status: 500, json: async () => ({ error: "boom" }), text: async () => "boom" };
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(respostaDoModelo) } }], usage: { total_tokens: 50 } }),
      text: async () => "",
    };
  });
  recovery._resetAgentRecoveryForTest();
  _resetInboundGuard();
});

afterEach(async () => {
  envioPendurado?.soltar?.();
  for (const [, b] of _messageBuffersForTest) if (b?.timer) clearTimeout(b.timer);
  _messageBuffersForTest.clear();
  await drenarBuffersDoAgente({ timeoutMs: 3000 }).catch(() => {});
  globalThis.fetch = fetchOriginal;
  spies.forEach((s) => s.mockRestore());
  if (db) await db.close();
  db = null;
  supa = null;
});

// ── 1. Portão de idade ───────────────────────────────────────────────────────────────────────────────────────────────
describe("[OBRIGATÓRIO] portão de idade: mensagem que a Evolution entregou horas depois não é respondida como nova", () => {
  it("hora real de 5 h atrás, chegando agora: não responde, 'descartada mensagem_atrasada', e a conversa vai para Esperam você com o motivo mesmo em chip com robô", async () => {
    await montarBanco();
    boot();
    const out = await chamar(mensagem("Oi, quero orçamento", { id: "WA-ATRASADA-1", horaReal: new Date(Date.now() - 5 * 3600_000) }));
    expect(out).toMatchObject({ success: true, ignored: "mensagem_atrasada" });
    await assentar();
    expect(envios).toHaveLength(0);
    expect(await concessao("WA-ATRASADA-1")).toMatchObject({ status: "descartada", motivo: "mensagem_atrasada" });
    expect((await metaDaMensagem("WA-ATRASADA-1")).agente_barrado).toBe("mensagem_atrasada");
    const gravada = (await db.query("SELECT message_timestamp, created_at FROM lead_messages WHERE wa_message_id = 'WA-ATRASADA-1'")).rows[0];
    expect(new Date(gravada.created_at).getTime() - new Date(gravada.message_timestamp).getTime()).toBeGreaterThan(4.9 * 3600_000);
    // Tela: chip com robô (robotChips = a instância), e mesmo assim a conversa está em "Esperam você", com o motivo no meta.
    const { counts, esperam } = await estadoDaConversa();
    expect(counts).toMatchObject({ esperam: 1, robo: 0 });
    expect(esperam[0].meta.agente_barrado).toBe("mensagem_atrasada");
    expect((await varrer()).candidatas).toBe(0);
  }, SLOW);

  // Tinge Brasil, 18/11/2026: robô desligado e mesmo assim a conversa ganhava o selo "Chegou atrasada / o robô não
  // respondeu". O selo só vale onde o robô (ou o passo de campanha) teria respondido; nos outros casos vale o motivo real.
  for (const [nome, preparar, motivoReal] of [
    ["agente desligado", async () => {
      await db.query("UPDATE lead_client_n8n_settings SET chatbot_enabled = false WHERE client_id = $1", [TENANT]);
      await db.query("UPDATE followup_companies SET inbound_enabled = false WHERE id = $1", [AGENTE]);
    }, /disabled/],
    ["número de SDR", async () => db.query("UPDATE lead_client_n8n_settings SET sdr_whatsapp_numbers = $2::jsonb WHERE client_id = $1", [TENANT, JSON.stringify([LEAD])]), /sdr/i],
  ]) {
    it(`${nome} + mensagem de 5 h: desfecho é o motivo real, sem selo de atrasada e fora de Esperam você por isso`, async () => {
      await montarBanco();
      boot();
      await preparar();
      const out = await chamar(mensagem("Oi, quero orçamento", { id: "WA-ATRASADA-SEM-ROBO", horaReal: new Date(Date.now() - 5 * 3600_000) }));
      expect(out.ignored).toMatch(motivoReal);
      await assentar();
      expect(envios).toHaveLength(0);
      const c = await concessao("WA-ATRASADA-SEM-ROBO");
      expect(c.status).toBe("descartada");
      expect(c.motivo).toMatch(motivoReal);
      expect((await metaDaMensagem("WA-ATRASADA-SEM-ROBO"))?.agente_barrado ?? null).toBeNull();
    }, SLOW);
  }

  it("robô desligado MAS campanha esperando resposta (desvio do chatbot_disabled) + mensagem de 5 h: barra como atrasada, com selo, e não anda o passo", async () => {
    await montarBanco();
    boot();
    // Chip sem agente próprio + chatbot do tenant desligado: só o desvio da campanha (envio 'sent' em campaign_dispatch_runs) agiria.
    await db.query("UPDATE followup_companies SET archived_at = now() WHERE id = $1", [AGENTE]);
    await db.query("UPDATE lead_client_n8n_settings SET chatbot_enabled = false WHERE client_id = $1", [TENANT]);
    await db.query(`CREATE TABLE IF NOT EXISTS public.campaign_dispatch_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_id UUID, campaign_id UUID, client_id TEXT, phone TEXT, lead_id UUID,
      lead_import_item_id UUID, status TEXT, sent_at TIMESTAMPTZ)`);
    const seq = [
      { id: "s1", type: "text", text: "Oi", order: 1, enabled: true, triggerMode: "immediate" },
      { id: "s2", type: "text", text: "Segue o catálogo", order: 2, enabled: true, triggerMode: "after_reply" },
    ];
    await db.query("INSERT INTO campaigns (id, client_id, name, analytics_meta, status, mode) VALUES ($1, $2, 'Feirão', $3::jsonb, 'ativa', 'disparo')", [
      CAMPANHA, TENANT, JSON.stringify({ sequence: seq, dispatchOptions: { waitForReply: true } }),
    ]);
    await db.query("INSERT INTO campaign_dispatch_runs (campaign_id, client_id, phone, status, sent_at) VALUES ($1, $2, $3, 'sent', now() - interval '1 day')", [CAMPANHA, TENANT, LEAD]);

    const out = await chamar(mensagem("Pode mandar", { id: "WA-DESVIO-ATRASADA", horaReal: new Date(Date.now() - 5 * 3600_000) }));
    expect(out).toMatchObject({ success: true, ignored: "mensagem_atrasada" });
    await assentar();
    expect(envios).toHaveLength(0);
    expect(await concessao("WA-DESVIO-ATRASADA")).toMatchObject({ status: "descartada", motivo: "mensagem_atrasada" });
    expect((await metaDaMensagem("WA-DESVIO-ATRASADA")).agente_barrado).toBe("mensagem_atrasada");

    // Mesma situação com mensagem nova: o desvio age (prova de que o cenário chega ao desvio).
    const nova = await chamar(mensagem("Pode mandar", { id: "WA-DESVIO-NOVA" }));
    expect(nova).toMatchObject({ status: "campaign_step_dispatched" });
  }, SLOW);

  it("o agente segue ATIVO: a próxima mensagem do lead (nova) é respondida, e a conversa sai de Esperam você", async () => {
    await montarBanco();
    boot();
    await chamar(mensagem("Oi", { id: "WA-ATRASADA-2", horaReal: new Date(Date.now() - 3 * 3600_000) }));
    await chamar(mensagem("Ainda tem horário hoje?", { id: "WA-NOVA-2" }));
    await esperar(async () => (await concessao("WA-NOVA-2"))?.status === "respondida");
    expect(envios).toEqual([LEAD]);
    expect((await estadoDaConversa()).counts.esperam).toBe(0);
    const pausa = (await db.query("SELECT agent_muted_at FROM whatsapp_chat_states WHERE client_id = $1", [TENANT])).rows[0];
    expect(pausa?.agent_muted_at || null).toBeNull();
  }, SLOW);

  it("barra também o passo de campanha: progresso pendente não anda com mensagem atrasada; com mensagem nova, anda", async () => {
    await montarBanco();
    boot();
    const seqCampanha = [
      { id: "s1", type: "text", text: "Oi {{nome}}, tudo bem?", order: 1, enabled: true, triggerMode: "immediate" },
      { id: "s2", type: "text", text: "Posso te mandar o catálogo?", order: 2, enabled: true, triggerMode: "after_reply" },
    ];
    await db.query(
      "INSERT INTO campaigns (id, client_id, name, phones, analytics_meta, status) VALUES ($1, $2, 'Feirão', $3::jsonb, $4::jsonb, 'ativa')",
      [CAMPANHA, TENANT, JSON.stringify([LEAD]), JSON.stringify({ importSource: "__crm__", sequence: seqCampanha, dispatchOptions: { waitForReply: true } })]
    );
    const progresso = { campaign_progress: { [CAMPANHA]: { nextStepIndex: 1, status: "aguardando_usuario", waitForReply: true, updatedAt: new Date().toISOString() } } };
    await db.query("INSERT INTO leads (client_id, telefone, nome, dados) VALUES ($1, $2, 'Lead', $3::jsonb)", [TENANT, LEAD, JSON.stringify(progresso)]);

    const out = await chamar(mensagem("Pode mandar", { id: "WA-CAMP-ATRASADA", horaReal: new Date(Date.now() - 2 * 3600_000) }));
    expect(out).toMatchObject({ ignored: "mensagem_atrasada" });
    await assentar();
    expect(envios).toHaveLength(0);
    const dados = (await db.query("SELECT dados FROM leads WHERE telefone = $1", [LEAD])).rows[0].dados;
    expect(dados.campaign_progress[CAMPANHA].nextStepIndex).toBe(1);

    const out2 = await chamar(mensagem("Pode mandar sim", { id: "WA-CAMP-NOVA" }));
    expect(out2).toMatchObject({ status: "campaign_step_dispatched" });
    await esperar(async () => ["respondida", "descartada", "falhou"].includes((await concessao("WA-CAMP-NOVA"))?.status));
    expect(await concessao("WA-CAMP-NOVA")).toMatchObject({ status: "respondida", motivo: "passo_de_campanha" });
    expect(envios).toEqual([LEAD]);
  }, SLOW);

  it("timestamp ausente: passa (não dá para saber a idade)", async () => {
    await montarBanco();
    boot();
    const body = mensagem("Oi, sem hora", { id: "WA-SEM-HORA" });
    delete body.data.messageTimestamp;
    expect(await chamar(body)).toMatchObject({ status: "buffering" });
    await esperar(async () => (await concessao("WA-SEM-HORA"))?.status === "respondida");
    expect(envios).toEqual([LEAD]);
  }, SLOW);
});

describe("[OBRIGATÓRIO] portão de idade no reply-webhook de campanhas (avança o passo direto, sem passar pelo chatbot)", () => {
  async function rotaReply() {
    const { registerCampaignsRoutes } = await import("../domains/campaigns/routes.js");
    const { buildDispatchLeads } = await import("../campaign/dispatch.js");
    const { checkEvolutionInstanceHealth } = await import("../services/evolution.js");
    const handlers = {};
    const guardar = (path, ...hs) => { handlers[path] = hs[hs.length - 1]; };
    const noop = () => {};
    const intervalo = vi.spyOn(globalThis, "setInterval").mockImplementation(() => ({ unref() {}, ref() {} }));
    registerCampaignsRoutes({ get: noop, post: guardar, put: noop, patch: noop, delete: noop, use: noop }, {
      CAMPAIGN_SCHEDULER_MAX_BATCH: 10, buildDispatchLeads, canCampaignBeDispatched: () => true, checkEvolutionInstanceHealth,
      continueCampaignLeadFromReply, ensureDb: () => true, executeCampaignDispatch: async () => {}, findCampaignReplyMatches,
      getClientName: async () => "Container LED", getLeadClientEvolutionInstances, getLeadClientN8nSettings, getRequestId: () => "req",
      getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}), isMissingSchemaError: () => false,
      isProduction: false, logCampaignReplyFlow: noop, logDirectDispatch: noop, maskPhoneForLog: (p) => p,
      normalizeIsoDate: (d) => d, leadsTableName: "lead_import_items", normalizeString: (v) => String(v ?? "").trim(),
      normalizeTenantKey: (v) => String(v || "").trim(), parseOptionalUuid: (v) => ({ value: v }), pgDatabasePool: poolDoTeste(db),
      requireAppViewAccess: () => (req, res, next) => next(), requireCampaignDispatchAccess: (req, res, next) => next(),
      requireFirebaseAuth: (req, res, next) => next(), requireInternalPageAccess: () => (req, res, next) => next(),
      resolveAuthorizedClientId: () => TENANT, resolveCampaignDispatchSettings: async () => ({}), resolveDispatchWebhookSettings: async () => ({}),
      runDueCampaignDispatches: async () => {}, sanitizePhone: (v) => String(v || "").replace(/@.*$/, "").replace(/\D/g, ""),
      sendError: (res, st, c, m) => res.status(st).json({ error: { code: c, message: m } }), supabase: supa, validateN8nInboundBearer: () => true,
    });
    intervalo.mockRestore();
    return async (body) => {
      const out = { status: 200, body: null };
      const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
      await handlers["/api/campaigns/reply-webhook"]({ body, query: {}, params: {}, headers: {} }, res);
      return out;
    };
  }

  it("resposta de 2 h atrás não anda a campanha; resposta nova anda", async () => {
    // O passo respeita a janela de envio do tenant: relógio fixo às 14h de Brasília para o teste não depender da hora em que roda.
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-18T17:00:00Z"));
    onTestFinished(() => vi.useRealTimers());
    await montarBanco();
    const seqCampanha = [
      { id: "s1", type: "text", text: "Oi", order: 1, enabled: true, triggerMode: "immediate" },
      { id: "s2", type: "text", text: "Segue o catálogo", order: 2, enabled: true, triggerMode: "after_reply" },
    ];
    await db.query(
      "INSERT INTO campaigns (id, client_id, name, phones, analytics_meta, status) VALUES ($1, $2, 'Feirão', $3::jsonb, $4::jsonb, 'ativa')",
      [CAMPANHA, TENANT, JSON.stringify([LEAD]), JSON.stringify({ importSource: "__crm__", sequence: seqCampanha, dispatchOptions: { waitForReply: true } })]
    );
    await db.query("INSERT INTO leads (client_id, telefone, nome, dados) VALUES ($1, $2, 'Lead', $3::jsonb)", [
      TENANT, LEAD, JSON.stringify({ campaign_progress: { [CAMPANHA]: { nextStepIndex: 1, status: "aguardando_usuario", waitForReply: true } } }),
    ]);
    const reply = await rotaReply();
    const atrasada = await reply({ ...mensagem("Pode mandar", { horaReal: new Date(Date.now() - 2 * 3600_000) }), clientId: TENANT, phone: LEAD });
    expect(atrasada.body).toMatchObject({ success: true, ignored: "mensagem_atrasada", idadeMin: 120 });
    await assentar();
    expect(envios).toHaveLength(0);
    const dados = (await db.query("SELECT dados FROM leads WHERE telefone = $1", [LEAD])).rows[0].dados;
    expect(dados.campaign_progress[CAMPANHA].nextStepIndex).toBe(1);

    const nova = await reply({ ...mensagem("Pode mandar"), clientId: TENANT, phone: LEAD });
    expect(nova.body?.ignored).toBeUndefined();
    await esperar(() => envios.length === 1);
  }, SLOW);
});

// ── 2. Resposta dobrada no deploy ────────────────────────────────────────────────────────────────────────────────────
describe("[OBRIGATÓRIO] SIGTERM ou exceção no meio do envio: o lead recebe UMA resposta só", () => {
  it("o processo cai durante o fetch do envio: concessão fica 'enviando'; a varredura do processo novo NÃO reenvia e manda para Esperam você", async () => {
    await montarBanco();
    boot();
    let soltar;
    envioPendurado = { promessa: new Promise((r) => { soltar = r; }), soltar: () => soltar?.() };
    await chamar(mensagem("Oi, quero orçamento", { id: "WA-SIGTERM-1" }));
    await esperar(() => envios.length === 1);
    expect(await concessao("WA-SIGTERM-1")).toMatchObject({ status: "enviando" });

    restart();
    await db.query("UPDATE agent_inbound_claims SET updated_at = now() - interval '10 minutes' WHERE msg_key = 'WA-SIGTERM-1'");
    const r = await varrer({ agora: new Date(Date.now() + 90_000) });
    expect(r.enviosParados).toBe(1);
    expect(r.reprocessadas).toBe(0);
    await assentar();
    expect(envios).toHaveLength(1);
    expect(await concessao("WA-SIGTERM-1")).toMatchObject({ status: "descartada", motivo: "envio_sem_confirmacao" });
    expect((await metaDaMensagem("WA-SIGTERM-1")).agente_barrado).toBe("envio_sem_confirmacao");
    expect((await estadoDaConversa()).counts.esperam).toBe(1);
  }, SLOW);

  it("ANTES da migration do 'enviando' (CHECK antigo): mesmo efeito, gravado como processando + motivo 'enviando', e não reenvia", async () => {
    await montarBanco({ comEnviando: false });
    boot();
    let soltar;
    envioPendurado = { promessa: new Promise((r) => { soltar = r; }), soltar: () => soltar?.() };
    await chamar(mensagem("Oi, quero orçamento", { id: "WA-SIGTERM-ANTIGO" }));
    await esperar(() => envios.length === 1);
    const c = await concessao("WA-SIGTERM-ANTIGO");
    expect(c).toMatchObject({ status: "processando", motivo: "enviando" });
    expect(new Date(c.lease_until).getUTCFullYear()).toBe(9999); // ninguém toma
    restart();
    await db.query("UPDATE agent_inbound_claims SET updated_at = now() - interval '10 minutes' WHERE msg_key = 'WA-SIGTERM-ANTIGO'");
    const r = await varrer({ agora: new Date(Date.now() + 90_000) });
    expect(r).toMatchObject({ enviosParados: 1, reprocessadas: 0 });
    expect(envios).toHaveLength(1);
    expect(await concessao("WA-SIGTERM-ANTIGO")).toMatchObject({ status: "descartada", motivo: "envio_sem_confirmacao" });
  }, SLOW);

  it("exceção no envio (tempo limite): não vira 'falhou' (que seria reenviado), fica envio sem confirmação e a varredura não reenvia", async () => {
    await montarBanco();
    boot();
    envioLanca = true;
    await chamar(mensagem("Oi", { id: "WA-TIMEOUT-1" }));
    await esperar(async () => (await concessao("WA-TIMEOUT-1"))?.status === "descartada");
    expect(await concessao("WA-TIMEOUT-1")).toMatchObject({ status: "descartada", motivo: "envio_sem_confirmacao" });
    expect((await metaDaMensagem("WA-TIMEOUT-1")).agente_barrado).toBe("envio_sem_confirmacao");
    envioLanca = false;
    await db.query("UPDATE lead_messages SET created_at = now() - interval '2 minutes', message_timestamp = now() - interval '2 minutes' WHERE wa_message_id = 'WA-TIMEOUT-1'");
    expect((await varrer()).reprocessadas).toBe(0);
    expect(envios).toHaveLength(1);
  }, SLOW);

  it("o envio pela Evolution tem tempo limite (AbortSignal)", async () => {
    await montarBanco();
    boot();
    await chamar(mensagem("Oi", { id: "WA-SINAL-1" }));
    await esperar(() => envios.length === 1);
    const chamadaDeEnvio = globalThis.fetch.mock.calls.find((c) => String(c[0]).includes("/message/sendText"));
    expect(chamadaDeEnvio[1].signal).toBeInstanceOf(AbortSignal);
  }, SLOW);
});

// ── 3 e 4. Concessão consultada e tomada por prazo ───────────────────────────────────────────────────────────────────
describe("[OBRIGATÓRIO] caminho normal consulta a concessão; tomada só por prazo vencido; teto de tentativas", () => {
  it("webhook tardio DEPOIS da varredura: a varredura respondeu, o webhook chega com o mesmo id e é descartado como já respondida", async () => {
    await montarBanco();
    boot();
    const id = await orfa({ idadeS: 120 });
    await varrer();
    await esperar(async () => (await concessao(id))?.status === "respondida");
    expect(envios).toEqual([LEAD]);
    const corpo = mensagem("Vocês têm painel de LED para fachada?", { id, horaReal: new Date(Date.now() - 125_000) });
    expect(await chamar(corpo)).toMatchObject({ ignored: "ja_respondida" });
    await assentar();
    expect(envios).toEqual([LEAD]);
    expect(await concessao(id)).toMatchObject({ status: "respondida" });
  }, SLOW);

  it("reentrega da Evolution enquanto a primeira ainda processa: descartada 'em_processamento'", async () => {
    await montarBanco();
    boot();
    const corpo = mensagem("Oi", { id: "WA-DUP-1" });
    await chamar(corpo);
    restart();
    expect(await chamar(corpo)).toMatchObject({ ignored: "em_processamento" });
  }, SLOW);

  it("dono vivo (prazo valendo) não é tomado por outro processo, mesmo parado há mais de 60 s", async () => {
    await montarBanco();
    const pool = poolDoTeste(db);
    await recovery.registrarEntrada({ pool, clientId: TENANT, phone: LEAD, msgKey: "VIVO-1", owner: "processo-a" });
    await db.query("UPDATE agent_inbound_claims SET updated_at = now() - interval '2 minutes' WHERE msg_key = 'VIVO-1'");
    expect(await recovery.reservarParaVarredura({ pool, clientId: TENANT, phone: LEAD, msgKey: "VIVO-1", owner: "processo-b" })).toBe(false);
    await db.query("UPDATE agent_inbound_claims SET lease_until = now() - interval '1 second' WHERE msg_key = 'VIVO-1'");
    expect(await recovery.reservarParaVarredura({ pool, clientId: TENANT, phone: LEAD, msgKey: "VIVO-1", owner: "processo-b" })).toBe(true);
  }, SLOW);

  it("cinco processos com donos DIFERENTES disputando a mesma mensagem: só um ganha", async () => {
    await montarBanco();
    const pool = poolDoTeste(db);
    const donos = ["boot-a", "boot-b", "boot-c", "boot-d", "boot-e"];
    const tentativas = await Promise.all(donos.map((owner) => recovery.reservarParaVarredura({ pool, clientId: TENANT, phone: LEAD, msgKey: "DISPUTA-1", owner })));
    expect(tentativas.filter(Boolean)).toHaveLength(1);
    expect((await concessao("DISPUTA-1")).owner).toBe(donos[tentativas.indexOf(true)]);
  }, SLOW);

  it("teto de 3 tentativas: nem a varredura nem uma reentrega do webhook processam a 4ª vez", async () => {
    await montarBanco();
    boot();
    const id = await orfa({ idadeS: 120 });
    await db.query(
      "INSERT INTO agent_inbound_claims (client_id, msg_key, phone, status, origem, attempts, owner) VALUES ($1, $2, $3, 'falhou', 'varredura', 3, 'boot-antigo')",
      [TENANT, id, LEAD]
    );
    const r = await varrer();
    expect(r.reprocessadas).toBe(0);
    expect(r.puladas.map((p) => p.motivo)).toEqual(["ja_concedida"]);
    expect(await chamar(mensagem("Vocês têm painel?", { id, horaReal: new Date(Date.now() - 120_000) }))).toMatchObject({ ignored: "teto_de_tentativas" });
    await assentar();
    expect(envios).toHaveLength(0);
  }, SLOW);

  it("passo de campanha grava desfecho (não fica 'processando' para ser andado de novo)", async () => {
    // Passo respeita a janela de envio: relógio fixo às 16h de Brasília (outro instante que o do teste do reply-webhook,
    // senão a trava em memória de continueCampaignLeadFromReply, por lead e campanha, ainda vale).
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(new Date("2026-11-18T19:00:00Z"));
    onTestFinished(() => vi.useRealTimers());
    await montarBanco();
    boot();
    const seqCampanha = [
      { id: "s1", type: "text", text: "Oi", order: 1, enabled: true, triggerMode: "immediate" },
      { id: "s2", type: "text", text: "Segue o catálogo", order: 2, enabled: true, triggerMode: "after_reply" },
    ];
    await db.query(
      "INSERT INTO campaigns (id, client_id, name, phones, analytics_meta, status) VALUES ($1, $2, 'Feirão', $3::jsonb, $4::jsonb, 'ativa')",
      [CAMPANHA, TENANT, JSON.stringify([LEAD]), JSON.stringify({ importSource: "__crm__", sequence: seqCampanha, dispatchOptions: { waitForReply: true } })]
    );
    await db.query("INSERT INTO leads (client_id, telefone, nome, dados) VALUES ($1, $2, 'Lead', $3::jsonb)", [
      TENANT, LEAD, JSON.stringify({ campaign_progress: { [CAMPANHA]: { nextStepIndex: 1, status: "aguardando_usuario", waitForReply: true } } }),
    ]);
    const corpo = mensagem("Quero", { id: "WA-CAMP-1" });
    await chamar(corpo);
    await esperar(async () => (await concessao("WA-CAMP-1"))?.status === "respondida");
    expect(envios).toHaveLength(1);
    await db.query("UPDATE agent_inbound_claims SET lease_until = now() - interval '1 minute' WHERE msg_key = 'WA-CAMP-1'");
    restart();
    expect(await chamar(corpo)).toMatchObject({ ignored: "ja_respondida" });
    await assentar();
    expect(envios).toHaveLength(1);
  }, SLOW);
});

// ── Restart no meio do buffer (o caso do #269) ───────────────────────────────────────────────────────────────────────
describe("[OBRIGATÓRIO] restart no meio do buffer: a mensagem é respondida depois, uma vez", () => {
  it("com a tabela: o processo novo (prazo vencido) reprocessa e responde", async () => {
    await montarBanco();
    boot();
    const out = await chamar(mensagem("Oi, quero orçamento de painel de LED", { id: "WA-RESTART-1" }));
    expect(out).toMatchObject({ success: true, status: "buffering" });
    expect(await concessao("WA-RESTART-1")).toMatchObject({ status: "processando", origem: "webhook" });
    restart();
    await db.query("UPDATE agent_inbound_claims SET owner = 'boot-antigo', lease_until = now() - interval '1 second' WHERE msg_key = 'WA-RESTART-1'");
    await assentar();
    expect(envios).toHaveLength(0);
    const r = await varrer({ agora: new Date(Date.now() + 90_000) });
    expect(r).toMatchObject({ candidatas: 1, reprocessadas: 1 });
    await esperar(async () => (await concessao("WA-RESTART-1"))?.status === "respondida");
    expect(envios).toEqual([LEAD]);
    expect(await concessao("WA-RESTART-1")).toMatchObject({ status: "respondida", origem: "varredura", attempts: 2 });
    expect((await varrer({ agora: new Date(Date.now() + 120_000) })).candidatas).toBe(0);
  }, SLOW);

  it("SEM a tabela: a varredura não roda (sem saber se houve envio, reprocessar podia dobrar a resposta)", async () => {
    await montarBanco({ comConcessao: false });
    boot();
    await chamar(mensagem("Oi", { id: "WA-SEMTABELA-1" }));
    restart();
    await assentar();
    const r = await varrer({ agora: new Date(Date.now() + 90_000) });
    expect(r.motivo).toBe("sem_tabela");
    expect(envios).toHaveLength(0);
  }, SLOW);

  it("conversa ainda no buffer deste processo não é pega pela varredura", async () => {
    await montarBanco();
    boot();
    await chamar(mensagem("Oi", { id: "WA-ANDAMENTO-1" }));
    const r = await varrer({ agora: new Date(Date.now() + 90_000) });
    expect(r.reprocessadas).toBe(0);
    expect(r.puladas.map((p) => p.motivo)).toEqual(["em_andamento"]);
    await esperar(() => envios.length === 1);
    await assentar();
    expect(envios).toHaveLength(1);
  }, SLOW);
});

// ── Portões pelo dado real ───────────────────────────────────────────────────────────────────────────────────────────
describe("[OBRIGATÓRIO] cada portão barra a varredura, acionado pelo dado real do banco", () => {
  const casos = [
    ["opt-out", async () => registerOptOut(poolDoTeste(db), { clientId: TENANT, phone: LEAD, source: "palavra", reason: "sair" }), /opt_out/],
    ["pausa humana", async () => db.query(
      "INSERT INTO whatsapp_chat_states (client_id, phone, state, agent_muted_at, agent_muted_source, agent_muted_reason) VALUES ($1, $2, 'ativa', now(), 'manual', 'atendimento humano')",
      [TENANT, LEAD]
    ), /muted|pausa|human/i],
    ["número de SDR", async () => db.query("UPDATE lead_client_n8n_settings SET sdr_whatsapp_numbers = $2::jsonb WHERE client_id = $1", [TENANT, JSON.stringify([LEAD])]), /sdr/i],
    ["campanha Sem IA", async () => db.query(
      "INSERT INTO campaigns (id, client_id, name, phones, analytics_meta, status) VALUES ($1, $2, 'Feirão', $3::jsonb, $4::jsonb, 'ativa')",
      [CAMPANHA, TENANT, JSON.stringify([LEAD]), JSON.stringify({ dispatchOptions: { replyAgent: "passos" } })]
    ), /campanha_sem_ia/],
    ["agente desligado", async () => {
      await db.query("UPDATE lead_client_n8n_settings SET chatbot_enabled = false WHERE client_id = $1", [TENANT]);
      await db.query("UPDATE followup_companies SET inbound_enabled = false WHERE id = $1", [AGENTE]);
    }, /disabled/],
  ];
  for (const [nome, preparar, motivo] of casos) {
    it(`${nome}: nenhuma resposta, 'descartada' com o motivo, e a varredura seguinte não insiste`, async () => {
      await montarBanco();
      boot();
      await preparar();
      const id = await orfa();
      // "agente desligado" tira a empresa da lista da varredura; para exercitar o portão, a lista vem explícita.
      const r = await varrer({ empresas: [TENANT] });
      expect(r.reprocessadas).toBe(1);
      await esperar(async () => ["descartada", "respondida", "falhou"].includes((await concessao(id))?.status));
      await assentar();
      expect(envios).toHaveLength(0);
      const c = await concessao(id);
      expect(c.status).toBe("descartada");
      expect(String(c.motivo)).toMatch(motivo);
      expect((await varrer({ empresas: [TENANT], agora: new Date(Date.now() + 60_000) })).reprocessadas).toBe(0);
    }, SLOW);
  }

  it("\"sair\" pela varredura: a captura de opt-out roda no reprocessamento e o agente NÃO responde", async () => {
    await montarBanco();
    boot();
    const id = await orfa({ texto: "sair" });
    await varrer();
    await esperar(async () => (await concessao(id))?.status === "descartada");
    await assentar();
    expect(envios).toHaveLength(0);
    expect((await concessao(id)).motivo).toMatch(/opt_out/);
    const optout = (await db.query("SELECT count(*)::int AS n FROM lead_optouts WHERE client_id = $1 AND revoked_at IS NULL", [TENANT])).rows[0].n;
    expect(optout).toBe(1);
  }, SLOW);

  it("freio diário: a IA marca 'não comercial' e o agente é silenciado; a varredura não insiste", async () => {
    await montarBanco();
    boot();
    respostaDoModelo = { ...respostaDoModelo, nao_comercial: true, motivo_nao_comercial: "Número errado" };
    const id = await orfa();
    await varrer();
    await esperar(async () => ["descartada", "respondida"].includes((await concessao(id))?.status));
    expect(await concessao(id)).toMatchObject({ status: "descartada", motivo: "nao_comercial" });
    expect(envios).toHaveLength(0);
    expect((await varrer({ agora: new Date(Date.now() + 60_000) })).reprocessadas).toBe(0);
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

// ── Teto, falha da IA, medição, miúdos ───────────────────────────────────────────────────────────────────────────────
describe("[OBRIGATÓRIO] teto de 30 min, falha da IA, medição e varredura espaçada", () => {
  it("mensagem com mais de 30 min não é candidata; menos de 60 s também não; conversa já respondida não", async () => {
    await montarBanco();
    boot();
    await orfa({ idadeS: 31 * 60 });
    await orfa({ idadeS: 20, phone: "5534999002002" });
    await orfa({ idadeS: 120, phone: "5534999003003" });
    await db.query(
      "INSERT INTO lead_messages (client_id, phone, sender_type, direction, message_text, message_timestamp, created_at) VALUES ($1, '5534999003003', 'device', 'outbound', 'já te atendo', now() - interval '100 seconds', now() - interval '100 seconds')",
      [TENANT]
    );
    expect((await varrer()).candidatas).toBe(0);
  }, SLOW);

  it("IA falha em todas as tentativas: 'falhou'; a varredura tenta de novo e responde quando a IA volta", async () => {
    await montarBanco();
    boot();
    modeloFalha = true;
    const id = await orfa({ idadeS: 120 });
    await varrer();
    await esperar(async () => (await concessao(id))?.status === "falhou");
    expect(String((await concessao(id)).motivo)).toMatch(/falha_ia|resposta_vazia/);
    modeloFalha = false;
    expect((await varrer()).reprocessadas).toBe(1);
    await esperar(async () => (await concessao(id))?.status === "respondida");
    expect(envios).toEqual([LEAD]);
  }, SLOW);

  it("tempo_resposta e total_ms contam da HORA REAL; atraso_entrega sai separado, por instância", async () => {
    await montarBanco();
    boot();
    await chamar(mensagem("Oi", { id: "WA-MEDIR-1", horaReal: new Date(Date.now() - 10 * 60_000) }));
    await esperar(async () => (await concessao("WA-MEDIR-1"))?.status === "respondida");
    const log = spies[0].mock.calls;
    const tempo = log.find((c) => c[0] === "[chatbot-webhook] tempo_resposta")?.[1];
    const atraso = log.find((c) => c[0] === "[chatbot-webhook] atraso_entrega")?.[1];
    expect(tempo.ms).toBeGreaterThanOrEqual(10 * 60_000);
    expect((await concessao("WA-MEDIR-1")).total_ms).toBeGreaterThanOrEqual(10 * 60_000);
    expect(atraso).toMatchObject({ clientId: TENANT, instancia: INSTANCIA });
    expect(atraso.ms).toBeGreaterThanOrEqual(10 * 60_000 - 1000);
  }, SLOW);

  it("envios da varredura saem espaçados", async () => {
    await montarBanco();
    boot();
    await orfa({ phone: "5534999004004" });
    await orfa({ phone: "5534999005005" });
    const t0 = Date.now();
    const r = await recovery.varrerOrfas({ pool: poolDoTeste(db), espacoMs: 800 });
    expect(r.reprocessadas).toBe(2);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(800);
  }, SLOW);

  it("limpeza: concessões com mais de 7 dias somem, as recentes ficam", async () => {
    await montarBanco();
    const pool = poolDoTeste(db);
    await db.query(
      `INSERT INTO agent_inbound_claims (client_id, msg_key, status, updated_at) VALUES
         ($1, 'VELHA', 'respondida', now() - interval '8 days'), ($1, 'NOVA', 'respondida', now() - interval '1 day')`,
      [TENANT]
    );
    expect(await recovery.limparConcessoesAntigas({ pool })).toBe(1);
    expect((await db.query("SELECT msg_key FROM agent_inbound_claims")).rows.map((r) => r.msg_key)).toEqual(["NOVA"]);
  }, SLOW);
});

describe("[OBRIGATÓRIO] desligamento limpo: o buffer é processado antes de sair", () => {
  it("drenarBuffersDoAgente processa na hora o que está esperando e espera terminar", async () => {
    const processados = [];
    bufferMessage(TENANT, LEAD, { text: "msg 1" }, async (msgs) => {
      await new Promise((r) => setTimeout(r, 200));
      processados.push(msgs.map((m) => m.text));
    }, INSTANCIA);
    bufferMessage(TENANT, LEAD, { text: "msg 2" }, async (msgs) => {
      await new Promise((r) => setTimeout(r, 200));
      processados.push(msgs.map((m) => m.text));
    }, INSTANCIA);
    const t0 = Date.now();
    const r = await drenarBuffersDoAgente({ timeoutMs: 2000 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(r).toMatchObject({ buffers: 1, emAndamento: 1, terminou: true });
    expect(processados).toEqual([["msg 1", "msg 2"]]);
  });

  it("resposta que passa do prazo: devolve terminou false sem travar o desligamento", async () => {
    bufferMessage(TENANT, LEAD, { text: "lenta" }, () => new Promise((r) => setTimeout(r, 3000)), INSTANCIA);
    const r = await drenarBuffersDoAgente({ timeoutMs: 200 });
    expect(r.terminou).toBe(false);
  });
});
