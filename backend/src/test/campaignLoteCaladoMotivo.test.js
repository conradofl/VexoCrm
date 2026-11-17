// backend/src/test/campaignLoteCaladoMotivo.test.js
//
// Lote que para calado (Nous, 16/11/2026, "Evento Mesa de Negocios 2 - Planilha 1", Chip 2-NOUS, lote 1/50 com 10 alvos):
// "Disparar Lote 1 Agora" marcou 2 números inválidos e parou com 8 "Pendente na fila", 0 enviados, 0 falhas. Depois
// "Disparar não processados (8)" e "Disparar Lote 1 Agora" não mandavam nada e a tela não dizia por quê.
//
// Regra que fecha a classe: nenhum botão de disparo responde sucesso e o lote deixa de enviar sem gravar o motivo em
// error_message (que a tela mostra no cartão do lote e no diálogo de destinatários). Um caso por caminho de saída.
//
// Postgres REAL (pglite), rotas reais, motor real. Só o que sai do processo é dublado: o HTTP da Evolution (fetch) e a
// configuração do tenant/chips (deps que em produção leem lead_client_n8n_settings e evolution_instances). A checagem de
// conexão do chip é a REAL (services/evolution.js), com o fetch respondendo o estado.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { buildDispatchLeads } from "../campaign/dispatch.js";
import { checkEvolutionInstanceHealth } from "../services/evolution.js";
import {
  describeDispatchCrash,
  describeInterruptedPending,
  evaluateManualSendWindow,
} from "../domains/campaigns/routes.js";

const SLOW = 120_000;
const T = "tenant-calado";
const SEQ = [{ id: "s1", type: "text", text: "Oi {{nome}}", order: 1, enabled: true, delayAfterSeconds: 0 }];
const SEQ_AGENDA = [{ id: "s1", type: "text", text: "Agende: {{scheduling_link}}", order: 1, enabled: true, delayAfterSeconds: 0 }];
const CHIP_ID = "cccccccc-0000-4000-8000-0000000000c2";
const CHIP = {
  id: CHIP_ID,
  name: "Chip 2-NOUS",
  active: true,
  dispatch_webhook_url: "https://evo.teste/message/sendText/chip-2-nous",
  dispatch_webhook_token: "t",
};

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.leads_clients (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, telefone TEXT, nome TEXT, tipo_cliente TEXT,
    faixa_consumo TEXT, qualificacao TEXT, cidade TEXT, estado TEXT, status TEXT, opt_out BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb, dados JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
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
  CREATE TABLE public.crm_consultant_schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), client_id TEXT NOT NULL, name TEXT, scheduling_link TEXT, active BOOLEAN DEFAULT true
  );
`;

// Janela padrão do sistema (a da Nous em 16/11 é a confirmar pela leitura): seg-sex 08:00-20:00, São Paulo.
const JANELA = {
  send_window_enabled: true,
  send_window_start: "08:00",
  send_window_end: "20:00",
  send_window_days: ["mon", "tue", "wed", "thu", "fri"],
  send_window_timezone: "America/Sao_Paulo",
};
const SEGUNDA_15H_SP = "2026-11-16T18:00:00Z";
const SEGUNDA_20H22_SP = "2026-11-16T23:22:00Z"; // o clique da Nous
const TERCA_08H_SP = "2026-11-17T11:00:00.000Z";

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
let estadoDoChip;
let spies;
beforeEach(() => {
  enviados = [];
  estadoDoChip = "open";
  fetchOriginal = globalThis.fetch;
  timeoutOriginal = globalThis.setTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => timeoutOriginal(fn, ms >= 1000 ? 0 : ms, ...args);
  globalThis.fetch = vi.fn(async (url, init) => {
    const u = String(url);
    if (/sendText/.test(u)) {
      enviados.push(String(JSON.parse(init?.body || "{}").number || ""));
      return { ok: true, status: 200, json: async () => ({ key: { id: "wa" } }), text: async () => '{"key":{"id":"wa"}}' };
    }
    if (/connectionState/.test(u)) {
      const body = JSON.stringify({ instance: { state: estadoDoChip } });
      return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
    }
    return { ok: true, status: 200, json: async () => [], text: async () => "[]" };
  });
  spies = ["log", "info", "warn", "error"].map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
  vi.useFakeTimers({ toFake: ["Date"] });
});

let mundoAtual = null;
afterEach(async () => {
  if (mundoAtual) await mundoAtual.esperarFim().catch(() => {});
  mundoAtual = null;
  vi.useRealTimers();
  globalThis.fetch = fetchOriginal;
  globalThis.setTimeout = timeoutOriginal;
  spies.forEach((s) => s.mockRestore());
});

const abertos = [];
afterAll(async () => {
  for (const db of abertos) await db.close();
});

async function mundo({
  janela = JANELA,
  nLeads = 3,
  targetCount = nLeads,
  seq = SEQ,
  status = "scheduled",
  instancias = () => [],
  chipDoLote = null,
  falharContagem = false,
} = {}) {
  const db = await createPgliteDb(SCHEMA);
  abertos.push(db);
  await db.query("INSERT INTO leads_clients (id, name) VALUES ($1, 'Tenant Calado')", [T]);
  const contagem = { falhar: falharContagem };
  const pool = {
    query: (sql, params) => {
      // Falha de infraestrutura só na contagem de runs do lote (o resto do banco segue de pé).
      if (contagem.falhar && /COUNT\(\*\) FILTER \(WHERE status = 'sent'\)/.test(String(sql))) {
        return Promise.reject(new Error("connection terminated unexpectedly"));
      }
      return db.query(sql, params);
    },
  };
  _setPgDatabasePoolForTesting(pool);
  const supabase = createPgSupabaseClient(pool);

  const { registerCampaignsRoutes } = await import("../domains/campaigns/routes.js");
  const handlers = {};
  const guardar = (metodo) => (path, ...hs) => {
    handlers[`${metodo} ${path}`] = hs[hs.length - 1];
  };
  const app = { get: guardar("GET"), post: guardar("POST"), put: guardar("PUT"), patch: guardar("PATCH"), delete: guardar("DELETE"), use() {} };
  const noop = () => {};
  registerCampaignsRoutes(app, {
    CAMPAIGN_SCHEDULER_MAX_BATCH: 10, buildDispatchLeads, canCampaignBeDispatched: () => true,
    checkEvolutionInstanceHealth, continueCampaignLeadFromReply: async () => {},
    ensureDb: () => true, executeCampaignDispatch: async () => {}, findCampaignReplyMatches: async () => [],
    getClientName: async () => "Tenant Calado", getLeadClientEvolutionInstances: async () => instancias(),
    getLeadClientN8nSettings: async () => janela, getRequestId: () => "req",
    getSafeDispatchSettingsLog: () => ({}), internalErrorPayloadDetails: () => ({}), isMissingSchemaError: () => false,
    isProduction: false, logCampaignReplyFlow: noop, logDirectDispatch: noop, maskPhoneForLog: (p) => p,
    normalizeIsoDate: (d) => d, leadsTableName: "lead_import_items", normalizeString: (s) => String(s ?? "").trim(),
    normalizeTenantKey: (s) => String(s || "").trim(), parseOptionalUuid: (s) => ({ value: s }), pgDatabasePool: pool,
    requireAppViewAccess: () => (req, res, next) => next(), requireCampaignDispatchAccess: (req, res, next) => next(),
    requireFirebaseAuth: (req, res, next) => next(), requireInternalPageAccess: () => (req, res, next) => next(),
    resolveAuthorizedClientId: () => T,
    resolveCampaignDispatchSettings: async () => ({ webhookUrl: CHIP.dispatch_webhook_url, webhookToken: "t" }),
    resolveDispatchWebhookSettings: async () => ({}), runDueCampaignDispatches: async () => {}, sanitizePhone: (p) => p,
    sendError: (res, s, c, m, d) => res.status(s).json({ error: { code: c, message: m, ...(d ? { details: d } : {}) } }),
    supabase, validateN8nInboundBearer: () => true,
  });

  const { rows: [camp] } = await db.query(
    "INSERT INTO campaigns (client_id, name, analytics_meta, limit_per_run) VALUES ($1, 'Evento Mesa de Negocios 2 - Planilha 1', $2::jsonb, 50) RETURNING *",
    [T, JSON.stringify({ importSource: "__crm__", sequence: seq })]
  );
  for (let i = 0; i < nLeads; i += 1) {
    await db.query(
      "INSERT INTO leads (client_id, telefone, nome, created_at) VALUES ($1, $2, $3, $4)",
      [T, `5534990${1000 + i}`, `Lead ${i}`, new Date(Date.UTC(2026, 10, 10, 12, 0, i)).toISOString()]
    );
  }
  const { rows: [lote] } = await db.query(
    `INSERT INTO campaign_dispatches (campaign_id, client_id, name, steps, status, trigger_type, scheduled_at, "offset", limit_per_run, target_count, evolution_instance_id)
     VALUES ($1, $2, 'Lote 1/50', $3::jsonb, $4, 'scheduled', '2026-11-16T11:00:00Z', 0, $5, $6, $7) RETURNING *`,
    [camp.id, T, JSON.stringify(seq), status, Math.max(nLeads, targetCount), targetCount, chipDoLote]
  );

  const estado = async () =>
    (await db.query("SELECT status, error_message, sent_count, failed_count FROM campaign_dispatches WHERE id = $1", [lote.id])).rows[0];
  const runs = async () => (await db.query("SELECT status, lead_id FROM campaign_dispatch_runs WHERE dispatch_id = $1", [lote.id])).rows;
  const chamar = async (rota, body = {}) => {
    const out = { status: 200, body: null };
    const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
    await handlers[rota]({ params: { dispatchId: lote.id }, body, query: {}, authAccess: { uid: "uid-nous", email: "nous@teste" } }, res);
    return out;
  };
  const disparar = (body) => chamar("POST /api/campaigns/dispatches/:dispatchId/trigger", body);
  const runPending = (body) => chamar("POST /api/campaigns/dispatches/:dispatchId/run-pending", body);
  const destinatarios = () => chamar("GET /api/campaigns/dispatches/:dispatchId/recipients");
  const resumo = async () => {
    const out = { status: 200, body: null };
    const res = { status(c) { out.status = c; return res; }, json(b) { out.body = b; return res; } };
    await handlers["GET /api/campaigns/dispatch-summary"]({ query: { clientId: T }, authAccess: {} }, res);
    return out;
  };
  // O motor roda em segundo plano depois da resposta HTTP: espera o lote sair de 'running' (timers reais).
  const esperarFim = async () => {
    for (let i = 0; i < 600; i += 1) {
      const e = await estado();
      if (e.status !== "running") return e;
      await new Promise((r) => timeoutOriginal(r, 50));
    }
    throw new Error("lote não terminou: ficou 'running'");
  };
  mundoAtual = { esperarFim };
  return { db, camp, lote, estado, runs, disparar, runPending, destinatarios, resumo, esperarFim, contagem };
}

describe("textos (funções puras)", () => {
  it("janela manual: dentro, fora sem force, fora com force e só o booleano true força", () => {
    const dentro = evaluateManualSendWindow({ now: new Date(SEGUNDA_15H_SP), settings: JANELA });
    expect(dentro).toMatchObject({ allowed: true, forced: false });
    const fora = evaluateManualSendWindow({ now: new Date(SEGUNDA_20H22_SP), settings: JANELA });
    expect(fora.allowed).toBe(false);
    expect(fora.refusal.message).toContain("horário local 20:22");
    expect(fora.refusal.details.nextOpening).toBe(TERCA_08H_SP);
    expect(evaluateManualSendWindow({ now: new Date(SEGUNDA_20H22_SP), settings: JANELA, forceOutsideWindow: "true" }).allowed).toBe(false);
    expect(evaluateManualSendWindow({ now: new Date(SEGUNDA_20H22_SP), settings: JANELA, forceOutsideWindow: true })).toMatchObject({
      allowed: true,
      forced: true,
    });
  });

  it("motivo de queda: mensagem do motor vira 'Falhou: ...'; 'Disparo interrompido' fica como está; vazio não fica vazio", () => {
    expect(describeDispatchCrash(new Error("banco caiu"))).toBe("Falhou: banco caiu");
    expect(describeDispatchCrash(new Error("Disparo interrompido: sem link"))).toBe("Disparo interrompido: sem link");
    expect(describeDispatchCrash(null)).toMatch(/^Falhou: .+/);
  });

  it("interrompido diz quantos estão reservados sem confirmação e quantos não entraram na fila", () => {
    expect(describeInterruptedPending({ pendingCount: 8, claimedCount: 0 })).toBe(
      "Interrompido: 8 lead(s) pendente(s) de envio. 8 não entrou(aram) na fila desta rodada (saiu do público da planilha ou já tem a sequência em andamento)."
    );
    expect(describeInterruptedPending({ pendingCount: 3, claimedCount: 1 })).toContain("1 reservado(s) por uma execução que não terminou");
    expect(describeInterruptedPending({ pendingCount: 3, claimedCount: 1 })).toContain("2 não entrou(aram)");
  });
});

describe("item 1: 'Disparar não processados' (run-pending) obedece a janela como o 'Disparar Agora'", () => {
  it("[OBRIGATÓRIO] fora da janela: 422 OUTSIDE_SEND_WINDOW com o motivo, o lote não vira 'running' e nada sai", async () => {
    vi.setSystemTime(new Date(SEGUNDA_20H22_SP));
    const w = await mundo({ status: "interrupted" });
    const out = await w.runPending();
    expect(out.status).toBe(422);
    expect(out.body.error.code).toBe("OUTSIDE_SEND_WINDOW");
    expect(out.body.error.message).toContain("horário local 20:22");
    expect(out.body.error.details).toMatchObject({ end: "20:00", nextOpening: TERCA_08H_SP });
    for (const forceOutsideWindow of ["true", 1, {}]) {
      expect((await w.runPending({ forceOutsideWindow })).status).toBe(422);
    }
    await new Promise((r) => timeoutOriginal(r, 200));
    expect(enviados).toHaveLength(0);
    expect((await w.estado()).status).toBe("interrupted");
  }, SLOW);

  it("[OBRIGATÓRIO] fora da janela com forceOutsideWindow: true: envia (o motor não pausa no primeiro lead) e o log registra", async () => {
    vi.setSystemTime(new Date(SEGUNDA_20H22_SP));
    const w = await mundo({ status: "interrupted" });
    const out = await w.runPending({ forceOutsideWindow: true });
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ success: true, pendingCount: 3, forcedOutsideWindow: true });
    const fim = await w.esperarFim();
    expect(fim.status).toBe("done");
    expect(enviados).toHaveLength(3);
    const registro = spies[2].mock.calls.find((c) => c[0] === "[campaign-dispatch] disparo_forcado_fora_da_janela");
    expect(registro?.[1]).toMatchObject({ route: "run-pending", dispatchId: w.lote.id, uid: "uid-nous", localTime: "20:22" });
  }, SLOW);

  it("dentro da janela: envia sem pedir confirmação", async () => {
    vi.setSystemTime(new Date(SEGUNDA_15H_SP));
    const w = await mundo({ status: "interrupted" });
    const out = await w.runPending();
    expect(out.status).toBe(200);
    expect(out.body.forcedOutsideWindow).toBeUndefined();
    expect((await w.esperarFim()).status).toBe("done");
    expect(enviados).toHaveLength(3);
  }, SLOW);
});

describe("item 2: exceção no meio do lote termina 'failed' com a mensagem (antes ficava 'running' até o boot)", () => {
  for (const [rota, chamar] of [
    ["trigger", (w) => w.disparar()],
    ["run-pending", (w) => w.runPending()],
  ]) {
    it(`[OBRIGATÓRIO] ${rota}: o motor lança depois da pré-validação → 'failed' + "Falhou: <mensagem>", e o botão volta a funcionar`, async () => {
      vi.setSystemTime(new Date(SEGUNDA_15H_SP));
      let lancar = true;
      const w = await mundo({
        status: rota === "trigger" ? "scheduled" : "interrupted",
        instancias: () => {
          if (lancar) throw new Error("leitura de chips falhou: connection reset");
          return [];
        },
      });
      const out = await chamar(w);
      expect(out.status).toBe(200);
      const fim = await w.esperarFim();
      expect(fim.status).toBe("failed");
      expect(fim.error_message).toBe("Falhou: leitura de chips falhou: connection reset");
      expect(enviados).toHaveLength(0);
      // Sem o lote preso em 'running', o próximo clique é aceito (antes: 409 "já está em execução").
      lancar = false;
      const deNovo = await chamar(w);
      expect(deNovo.status).toBe(200);
      expect((await w.esperarFim()).status).toBe("done");
      expect(enviados).toHaveLength(3);
    }, SLOW);
  }
});

describe("item 4: todo caminho de saída sem envio grava o motivo (um caso por caminho)", () => {
  it("[OBRIGATÓRIO] chip desconectado (o caso Nous): 2 inválidos na pré-validação, chip 'close' → 'paused' com o nome do chip", async () => {
    vi.setSystemTime(new Date(SEGUNDA_15H_SP));
    estadoDoChip = "close";
    const w = await mundo({ nLeads: 10, instancias: () => [CHIP], chipDoLote: CHIP_ID });
    // Pré-validação devolve 2 números inexistentes, como no lote da Nous.
    const fetchBase = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => {
      if (/whatsappNumbers/.test(String(url))) {
        const numeros = JSON.parse(init?.body || "{}").numbers || [];
        const body = JSON.stringify(numeros.map((n, i) => ({ number: n, exists: i >= 2, jid: `${n}@s.whatsapp.net` })));
        return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
      }
      return fetchBase(url, init);
    });
    const out = await w.disparar();
    expect(out.status).toBe(200);
    const fim = await w.esperarFim();
    expect(fim.status).toBe("paused");
    expect(fim.error_message).toBe("Pausado — chip desconectado (Chip 2-NOUS). Reconecte o chip em Conexões para retomar.");
    expect(enviados).toHaveLength(0);
    // A tela recebe o motivo nos dois lugares: destinatários e cartão do lote.
    const dest = await w.destinatarios();
    expect(dest.body).toMatchObject({ dispatchStatus: "paused", dispatchErrorMessage: fim.error_message, invalidCount: 2, pendingCount: 8 });
    const resumo = await w.resumo();
    const lote = resumo.body.campaigns?.flatMap((c) => c.batches) ?? resumo.body.active?.flatMap((c) => c.batches);
    expect(lote.find((b) => b.id === w.lote.id).errorMessage).toBe(fim.error_message);
  }, SLOW);

  it("chip do lote não encontrado e nenhum chip ativo → 'paused' com motivo", async () => {
    vi.setSystemTime(new Date(SEGUNDA_15H_SP));
    const w = await mundo({ instancias: () => [], chipDoLote: CHIP_ID });
    await w.disparar();
    const fim = await w.esperarFim();
    expect(fim.status).toBe("paused");
    expect(fim.error_message).toBe("Pausado — nenhum chip conectado para este cliente. Conecte um chip em Conexões para retomar.");
    expect(enviados).toHaveLength(0);
  }, SLOW);

  it("janela fecha depois do clique (motor checa a cada lead) → 'paused' com a janela", async () => {
    vi.setSystemTime(new Date("2026-11-16T22:59:59Z")); // 19:59:59 em São Paulo
    const w = await mundo();
    const out = await w.disparar();
    expect(out.status).toBe(200);
    vi.setSystemTime(new Date(SEGUNDA_20H22_SP));
    const fim = await w.esperarFim();
    expect(fim.status).toBe("paused");
    expect(fim.error_message).toBe("Pausado — fora da janela de envio (08:00–20:00). Retomará automaticamente na próxima janela.");
    expect(enviados).toHaveLength(0);
  }, SLOW);

  it("sem link de agenda para {{scheduling_link}} → 'failed' com o motivo do motor (antes: preso em 'running')", async () => {
    vi.setSystemTime(new Date(SEGUNDA_15H_SP));
    const w = await mundo({ seq: SEQ_AGENDA });
    await w.disparar();
    const fim = await w.esperarFim();
    expect(fim.status).toBe("failed");
    expect(fim.error_message).toBe(
      "Disparo interrompido: Nenhum consultor ativo com link de agendamento cadastrado para preencher {{scheduling_link}}."
    );
    expect(enviados).toHaveLength(0);
  }, SLOW);

  it("alvo maior que a fila (lead saiu do público) → 'interrupted' dizendo quantos não entraram na fila", async () => {
    vi.setSystemTime(new Date(SEGUNDA_15H_SP));
    const w = await mundo({ nLeads: 3, targetCount: 5 });
    await w.disparar();
    const fim = await w.esperarFim();
    expect(enviados).toHaveLength(3);
    expect(fim.status).toBe("interrupted");
    expect(fim.error_message).toBe(describeInterruptedPending({ pendingCount: 2, claimedCount: 0 }));
    // Segunda rodada: lista vazia. Antes repetia "Interrompido: 2 pendentes" sem dizer por quê.
    const de2 = await w.disparar();
    expect(de2.status).toBe(200);
    const fim2 = await w.esperarFim();
    expect(fim2.status).toBe("interrupted");
    expect(fim2.error_message).toContain("2 não entrou(aram) na fila desta rodada");
    expect(enviados).toHaveLength(3);
  }, SLOW);

  it("run 'claimed' órfão (execução que caiu no meio) → o motivo diz que está reservado sem confirmação", async () => {
    vi.setSystemTime(new Date(SEGUNDA_15H_SP));
    const w = await mundo({ nLeads: 3 });
    const { rows: [lead] } = await w.db.query("SELECT id, telefone FROM leads ORDER BY created_at DESC LIMIT 1");
    await w.db.query(
      "INSERT INTO campaign_dispatch_runs (dispatch_id, campaign_id, client_id, lead_id, phone, status, claimed_at) VALUES ($1, $2, $3, $4, $5, 'claimed', now())",
      [w.lote.id, w.camp.id, T, lead.id, lead.telefone]
    );
    await w.disparar();
    const fim = await w.esperarFim();
    expect(enviados).toHaveLength(2);
    expect(fim.status).toBe("interrupted");
    expect(fim.error_message).toBe(describeInterruptedPending({ pendingCount: 1, claimedCount: 1 }));
  }, SLOW);

  it("contagem de runs indisponível → 'failed' com motivo (antes: 'running' até o boot, todo botão 409)", async () => {
    vi.setSystemTime(new Date(SEGUNDA_15H_SP));
    const w = await mundo({ falharContagem: true });
    await w.disparar();
    const fim = await w.esperarFim();
    expect(fim.status).toBe("failed");
    expect(fim.error_message).toContain("não foi possível contar no banco o que este lote já enviou");
  }, SLOW);

  it("regressão: lote que envia tudo fecha 'done' sem motivo", async () => {
    vi.setSystemTime(new Date(SEGUNDA_15H_SP));
    const w = await mundo();
    await w.disparar();
    const fim = await w.esperarFim();
    expect(fim).toMatchObject({ status: "done", error_message: null, sent_count: 3 });
    const dest = await w.destinatarios();
    expect(dest.body).toMatchObject({ dispatchStatus: "done", dispatchErrorMessage: null, pendingCount: 0 });
  }, SLOW);
});
