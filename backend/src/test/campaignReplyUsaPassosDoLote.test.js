// backend/src/test/campaignReplyUsaPassosDoLote.test.js
//
// A resposta do lead tem de avançar a campanha pelos passos do LOTE que enviou o passo 1, não pela sequência da campanha.
//
// Sintoma em produção (Container LED, 12/11/2026, campanha Black Friday, lote 1/83): 7 leads responderam e nenhum recebeu o
// passo seguinte; num deles respondeu o agente de IA. O lote envia pela cópia dos passos gravada nele (campaign_dispatches.steps)
// e grava no lead o progresso com nextStepIndex apontando o passo "depois da resposta". Mas o webhook de entrada decidia se havia
// passo pendente contando os passos da CAMPANHA (analytics_meta.sequence). Campanha editada depois do lote (com menos passos, ou
// sem o passo "depois da resposta") fazia o webhook concluir que não havia passo a enviar: a resposta saía do CAMINHO 1 e caía no
// agente.
//
// Postgres REAL (pglite) com migrations reais, lote real (runCampaignDispatch), webhook real (/api/hardcoded-chat-webhook) e
// findCampaignReplyMatches real. Dublê só no que sai do processo: o HTTP da Evolution (fetch). O lead NÃO tem linha em public.leads
// (público de planilha, "SEM LEAD" na tela).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { buildDispatchLeads, findCampaignReplyMatches } from "../campaign/dispatch.js";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";

const SLOW = 120_000;
const T = "tenant-retomada";
const MIGRATIONS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");
const PASSO1 = { id: "s1", type: "text", text: "Oi {{nome}}, posso te mandar a oferta?", order: 1, enabled: true, delayAfterSeconds: 0 };
const PASSO2 = { id: "s2", type: "text", text: "Segue o link da Black Friday", order: 2, enabled: true, delayAfterSeconds: 0, triggerMode: "after_reply" };

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.leads_clients (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, telefone TEXT, nome TEXT, tipo_cliente TEXT,
    faixa_consumo TEXT, qualificacao TEXT, cidade TEXT, estado TEXT, status TEXT, opt_out BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb, dados JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.lead_import_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), import_id UUID, client_id TEXT NOT NULL, lead_id UUID, telefone TEXT,
    imported BOOLEAN DEFAULT true, normalized_data JSONB NOT NULL DEFAULT '{}'::jsonb, status_conversa TEXT,
    ultima_interacao_bot TIMESTAMPTZ, ultima_interacao_usuario TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.lead_optouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, phone TEXT NOT NULL, reason TEXT,
    optout_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE (client_id, phone)
  );
  CREATE TABLE public.campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, name TEXT NOT NULL, import_id UUID,
    limit_per_run INT, webhook_url TEXT, webhook_token TEXT, status TEXT NOT NULL DEFAULT 'active', scheduled_for TIMESTAMPTZ,
    last_triggered_at TIMESTAMPTZ, archived_at TIMESTAMPTZ, analytics_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
    campaign_prompt_id UUID, mode TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaign_dispatches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), campaign_id UUID NOT NULL, client_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '',
    steps JSONB NOT NULL DEFAULT '[]'::jsonb, trigger_type TEXT NOT NULL DEFAULT 'manual', scheduled_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'draft', sent_count INT NOT NULL DEFAULT 0, failed_count INT NOT NULL DEFAULT 0,
    target_count INT, triggered_at TIMESTAMPTZ, finished_at TIMESTAMPTZ, error_message TEXT, limit_per_run INT, "offset" INT,
    campaign_prompt_id UUID, evolution_instance_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.campaign_dispatch_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_id UUID NOT NULL, campaign_id UUID NOT NULL, client_id TEXT NOT NULL,
    phone TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error_message TEXT, sent_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lead_id UUID, claimed_at TIMESTAMPTZ, lead_import_item_id UUID, evolution_instance_id UUID
  );
  CREATE UNIQUE INDEX uq_campaign_dispatch_runs_dispatch_lead ON public.campaign_dispatch_runs (dispatch_id, lead_id);
`;

let intervalSpy;
beforeAll(() => {
  intervalSpy = vi.spyOn(globalThis, "setInterval").mockImplementation(() => ({ unref() {}, ref() {} }));
});
afterAll(() => {
  intervalSpy.mockRestore();
  _setPgDatabasePoolForTesting(null);
});

let fetchOriginal;
let timeoutOriginal;
let enviados;
beforeEach(() => {
  enviados = [];
  fetchOriginal = globalThis.fetch;
  timeoutOriginal = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => timeoutOriginal(fn, ms >= 1000 ? 0 : ms, ...args);
  globalThis.fetch = vi.fn(async (url, init) => {
    if (/sendText/.test(String(url))) {
      const body = JSON.parse(init?.body || "{}");
      enviados.push({ numero: String(body.number || ""), texto: String(body.text || body.textMessage?.text || "") });
      return { ok: true, status: 200, json: async () => ({ key: { id: "wa" } }), text: async () => '{"key":{"id":"wa"}}' };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  globalThis.fetch = fetchOriginal;
  globalThis.setTimeout = timeoutOriginal;
  vi.restoreAllMocks();
});

const abertos = [];
afterEach(async () => {
  while (abertos.length) await abertos.pop().close();
});

async function mundo({ sequenciaDaCampanhaDepois = null, origem = "planilha" } = {}) {
  const db = await createPgliteDb(SCHEMA);
  abertos.push(db);
  for (const f of ["20261008180000_add_recurrence_to_campaigns.sql", "20261012120000_campaign_recurrence_occurrences.sql"]) {
    await db.exec(await readFile(join(MIGRATIONS, f), "utf8"));
  }
  // Colunas que findCampaignReplyMatches lê em produção e que o esquema enxuto do teste do lote não tem.
  await db.exec(`ALTER TABLE public.campaigns ADD COLUMN phones TEXT[], ADD COLUMN starts_at TIMESTAMPTZ, ADD COLUMN ends_at TIMESTAMPTZ,
                 ADD COLUMN chatbot_prompt_type TEXT`);
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, 'Container')", [T]);
  // Tabelas que o webhook lê e que este teste não monta respondem vazio; nenhuma das do fluxo de campanha é perdoada.
  const DO_FLUXO = /campaigns|campaign_dispatch|lead_import_items/;
  const pool = {
    query: async (sql, params) => {
      try {
        return await db.query(sql, params);
      } catch (err) {
        const texto = typeof sql === "string" ? sql : sql?.text || "";
        if (DO_FLUXO.test(texto) && !/^\s*(INSERT INTO public\.lead_messages|SELECT 1 FROM public\.lead_optouts)/i.test(texto)) throw err;
        return { rows: [], rowCount: 0 };
      }
    },
  };
  _setPgDatabasePoolForTesting(pool);
  const supabase = createPgSupabaseClient(pool);

  const { registerCampaignsRoutes } = await import("../domains/campaigns/routes.js");
  const noop = () => {};
  const routes = registerCampaignsRoutes(
    { get: noop, post: noop, put: noop, patch: noop, delete: noop, use: noop },
    {
      CAMPAIGN_SCHEDULER_MAX_BATCH: 10, buildDispatchLeads, canCampaignBeDispatched: () => true,
      checkEvolutionInstanceHealth: async () => ({ state: "open" }), continueCampaignLeadFromReply: async () => {},
      ensureDb: () => true, executeCampaignDispatch: async () => {}, findCampaignReplyMatches: async () => [],
      getClientName: async () => "Container", getLeadClientEvolutionInstances: async () => [],
      getLeadClientN8nSettings: async () => ({ send_window_enabled: false }), getRequestId: () => "req",
      getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}), isMissingSchemaError: () => false,
      isProduction: false, logCampaignReplyFlow: noop, logDirectDispatch: noop, maskPhoneForLog: (p) => p,
      normalizeIsoDate: (d) => d, leadsTableName: "lead_import_items", normalizeString: (s) => String(s ?? "").trim(),
      normalizeTenantKey: (s) => String(s || "").trim(), parseOptionalUuid: (s) => ({ value: s }), pgDatabasePool: pool,
      requireAppViewAccess: () => (req, res, next) => next(), requireCampaignDispatchAccess: (req, res, next) => next(),
      requireFirebaseAuth: (req, res, next) => next(), requireInternalPageAccess: () => (req, res, next) => next(),
      resolveAuthorizedClientId: () => T,
      resolveCampaignDispatchSettings: async () => ({ webhookUrl: "https://evo.teste/message/sendText/chip-disparo", webhookToken: "t" }),
      resolveDispatchWebhookSettings: async () => ({}), runDueCampaignDispatches: async () => {}, sanitizePhone: (p) => p,
      sendError: (res, s, c, m) => res.status(s).json({ error: { code: c, message: m } }), supabase,
      validateN8nInboundBearer: () => true,
    }
  );

  const IMP = "bbbbbbbb-0000-4000-8000-000000000002";
  const crm = origem === "crm";
  const meta = { sequence: [PASSO1, PASSO2], dispatchOptions: { waitForReply: true }, ...(crm ? { importSource: "__crm__" } : {}) };
  const { rows: [camp] } = await db.query(
    "INSERT INTO campaigns (client_id, name, import_id, analytics_meta, limit_per_run) VALUES ($1, 'Black Friday', $2, $3::jsonb, 50) RETURNING *",
    [T, crm ? null : IMP, JSON.stringify(meta)]
  );
  // Base CRM: o destinatário só existe em public.leads (como os 5 telefones medidos em produção em 13/11/2026).
  const { rows: [lead] } = crm
    ? await db.query("INSERT INTO leads (client_id, telefone, nome) VALUES ($1, '5534988228667', 'Cliente') RETURNING id, telefone", [T])
    : await db.query(
      "INSERT INTO lead_import_items (client_id, import_id, telefone, normalized_data) VALUES ($1, $2, '5534988228667', '{\"nome\":\"Cliente\"}'::jsonb) RETURNING id, telefone",
      [T, IMP]
    );
  const { rows: [lote] } = await db.query(
    `INSERT INTO campaign_dispatches (campaign_id, client_id, name, steps, status, "offset", target_count, triggered_at)
     VALUES ($1, $2, 'Lote 1/83', $3::jsonb, 'running', 0, 1, now()) RETURNING *`,
    [camp.id, T, JSON.stringify([PASSO1, PASSO2])]
  );

  // 1. o lote real envia o passo 1 e grava o progresso de espera
  await routes.runCampaignDispatch({ dispatch: lote, campaign: camp, supabase });

  // 2. a campanha é editada DEPOIS do lote: a sequência dela muda, a do lote fica congelada
  if (sequenciaDaCampanhaDepois) {
    await db.query("UPDATE campaigns SET analytics_meta = $2::jsonb WHERE id = $1", [
      camp.id,
      JSON.stringify({ sequence: sequenciaDaCampanhaDepois, dispatchOptions: {} }),
    ]);
  }

  const continuar = vi.fn(async () => ({ continued: true }));
  const handlers = {};
  const guardar = (m) => (p, ...hs) => { handlers[`${m} ${p}`] = hs[hs.length - 1]; };
  const chatSupabase = createPgSupabaseClient(pool);
  registerChatbotRoutes(
    { post: guardar("POST"), get: guardar("GET"), delete: guardar("DELETE"), put: guardar("PUT"), patch: guardar("PATCH") },
    {
      ensureDb: () => true,
      getLeadClientEvolutionInstances: async () => [],
      getLeadClientN8nSettings: async (clientId) => ({ clientId, chatbot_enabled: true }),
      internalErrorPayloadDetails: () => ({}),
      isMissingSchemaError: () => false,
      leadsTableName: () => "lead_import_items",
      maskPhoneForLog: (p) => p,
      MAX_LEADS_OUTLIER_BATCH: 100,
      continueCampaignLeadFromReply: continuar,
      findCampaignReplyMatches,
      normalizeString: (s) => (s ? String(s).trim() : ""),
      normalizeTenantKey: (k) => (k ? String(k).trim() : ""),
      pgDatabasePool: pool,
      requireAppViewAccess: () => (_req, _res, next) => next(),
      requireFirebaseAuth: (_req, _res, next) => next(),
      resolveAuthorizedClientId: (_req, _res, cid) => cid,
      resolveDispatchWebhookSettings: async () => ({}),
      resolveInboundDispatchSettings: async () => ({}),
      sanitizePhone: (p) => String(p || "").replace(/@.*$/, "").replace(/\D/g, ""),
      sendError: vi.fn(),
      supabase: chatSupabase,
      validateLeadsOutlierRecord: () => true,
      validateN8nInboundBearer: () => true,
    }
  );

  const responder = async (texto) => {
    let out = null;
    await handlers["POST /api/hardcoded-chat-webhook"](
      {
        body: {
          event: "messages.upsert", clientId: T, instance: "chip-disparo",
          data: { key: { remoteJid: `${lead.telefone}@s.whatsapp.net`, fromMe: false, id: `WA-${Math.random()}` }, message: { conversation: texto }, messageTimestamp: Math.floor(Date.now() / 1000) },
        },
        query: {},
      },
      { json: (d) => { out = d; }, status() { return this; } }
    );
    return out;
  };
  return { db, camp, lead, lote, responder, continuar };
}

describe("campanha da base CRM: a resposta do lead encontra a espera gravada pelo lote", () => {
  // Causa medida em produção (Container LED, 13/11/2026): os 5 telefones existem em public.leads e em nenhuma linha de
  // lead_import_items. O lote gravava a espera procurando o lead em lead_import_items pelo id, não achava e voltava sem erro;
  // a resposta procurava a espera só em lead_import_items, não achava e o "Sim" caía no agente.
  it("[OBRIGATÓRIO] lote da base CRM grava a espera e o 'Sim' vai para o próximo passo, não para o agente", async () => {
    const w = await mundo({ origem: "crm" });
    expect(enviados.map((e) => e.texto)).toEqual(["Oi Cliente, posso te mandar a oferta?"]);

    const { rows: [lead] } = await w.db.query("SELECT dados FROM leads WHERE id = $1", [w.lead.id]);
    expect(lead.dados?.campaign_progress?.[w.camp.id]).toMatchObject({ status: "aguardando_usuario", waitForReply: true, nextStepIndex: 1, dispatchId: w.lote.id });

    const matches = await findCampaignReplyMatches({ clientId: T, phone: w.lead.telefone });
    expect(matches.processingWaitForReplyMatches.map((m) => m.id)).toEqual([w.camp.id]);

    const out = await w.responder("Sim");
    expect(out).toMatchObject({ status: "campaign_step_dispatched" });
    await vi.waitFor(() => expect(w.continuar).toHaveBeenCalledTimes(1));
    expect(w.continuar.mock.calls[0][0].campaignMatch.leadImportItem.id).toBe(w.lead.id);
  }, SLOW);

  it("a resposta chega com o telefone em outra grafia (sem o 9) e ainda encontra a espera", async () => {
    const w = await mundo({ origem: "crm" });
    const matches = await findCampaignReplyMatches({ clientId: T, phone: "553488228667" });
    expect(matches.processingWaitForReplyMatches.map((m) => m.id)).toEqual([w.camp.id]);
  }, SLOW);
});

describe("resposta do lead avança pelos passos do LOTE", () => {
  it("[OBRIGATÓRIO] campanha editada depois do lote (só com o passo 1): o 'Sim' vai para o próximo passo, não para o agente", async () => {
    const w = await mundo({ sequenciaDaCampanhaDepois: [PASSO1] });
    expect(enviados.map((e) => e.texto)).toEqual(["Oi Cliente, posso te mandar a oferta?"]); // o lote mandou só o passo 1

    const matches = await findCampaignReplyMatches({ clientId: T, phone: w.lead.telefone });
    expect(matches.processingWaitForReplyMatches.map((m) => m.id)).toEqual([w.camp.id]);

    const out = await w.responder("Sim");
    expect(out).toMatchObject({ status: "campaign_step_dispatched" });
    await vi.waitFor(() => expect(w.continuar).toHaveBeenCalledTimes(1));
    expect(w.continuar.mock.calls[0][0].campaignMatch.id).toBe(w.camp.id);
  }, SLOW);

  it("campanha editada SEM o passo 'depois da resposta' (sequência vazia): o 'Sim' ainda vai para o próximo passo do lote", async () => {
    const w = await mundo({ sequenciaDaCampanhaDepois: [] });
    const out = await w.responder("Sim");
    expect(out).toMatchObject({ status: "campaign_step_dispatched" });
    await vi.waitFor(() => expect(w.continuar).toHaveBeenCalledTimes(1));
  }, SLOW);

  it("regressão: campanha sem edição continua avançando", async () => {
    const w = await mundo({ sequenciaDaCampanhaDepois: null });
    const out = await w.responder("Sim");
    expect(out).toMatchObject({ status: "campaign_step_dispatched" });
    await vi.waitFor(() => expect(w.continuar).toHaveBeenCalledTimes(1));
  }, SLOW);

  it("regressão: o passo 2 já enviado (lead finalizado) não volta a sair", async () => {
    const w = await mundo({ sequenciaDaCampanhaDepois: null });
    await w.db.query(
      `UPDATE lead_import_items SET normalized_data = jsonb_set(normalized_data, ARRAY['campaign_progress', $2::text, 'nextStepIndex'], 'null'::jsonb)
        WHERE id = $1`,
      [w.lead.id, w.camp.id]
    );
    const out = await w.responder("obrigado");
    expect(out?.status).not.toBe("campaign_step_dispatched");
    expect(w.continuar).not.toHaveBeenCalled();
  }, SLOW);
});
