// Desligamento que espera o passo atual (SIGTERM), 21/11/2026.
//
// Todo push no main reinicia o bk-vexo, inclusive commit direto que não passa pela trava de merge. Antes, o SIGTERM
// fechava o pool Postgres com o laço do lote ainda rodando e o processo morria no meio de um lead. Agora:
//   - nenhum lead novo é reivindicado e nenhum passo novo começa; as pausas entre passos e leads acordam;
//   - o passo em voo termina e é registrado, com prazo de 5 s (em paralelo com a drenagem do agente);
//   - o pool só fecha depois disso; o /health responde "desligando" enquanto isso;
//   - estourou o prazo: sai mesmo assim, e o estado que fica (claimed com a marca) é o que a conferência do boot trata;
//   - sequência cortada no meio: log estruturado por lead e nota no run, contada no /health.
// SIGTERM de verdade num processo filho (fixtures/desligamentoFilho.mjs) com o motor e o coordenador reais; PGlite para
// o estado que fica; dublê só no HTTP da Evolution.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { dispatchCampaignSequence } from "../campaign-outbound.js";
import { executarDesligamento, PRAZO_ESPERA_ENVIO_MS, PRAZO_HTTP_MS } from "../services/shutdownCoordinator.js";
import { _resetDesligamentoParaTeste, aguardarEnviosPararem, estaDesligando, iniciarDesligamento } from "../services/shutdownSignal.js";
import { conferirClaimedDoBoot } from "../campaign/claimedConference.js";
import { RUN_SEND_MARKER, markRunSendStarted, markRunSequenceCut } from "../services/runSendMarker.js";
import { computeRestartBlockers } from "../services/restartBlockers.js";
import { registerInsightsRoutes } from "../domains/insights/routes.js";

const FILHO = resolve("src/test/fixtures/desligamentoFilho.mjs");
const LIMITE_MS = 10_000;

function rodarFilho(cenario, { sinalQuando }) {
  return new Promise((resolver) => {
    const inicio = Date.now();
    const filho = spawn(process.execPath, [FILHO, cenario], { stdio: ["ignore", "pipe", "pipe"] });
    const eventos = [];
    let buffer = "";
    let sinalEm = null;
    filho.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const linha = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        try {
          const ev = JSON.parse(linha);
          eventos.push(ev);
          if (sinalEm === null && sinalQuando(ev)) {
            sinalEm = Date.now();
            filho.kill("SIGTERM");
          }
        } catch {
          /* linha que não é evento */
        }
      }
    });
    filho.on("exit", (codigo, sinal) => resolver({ codigo, sinal, eventos, msDesdeSinal: Date.now() - (sinalEm ?? inicio) }));
  });
}
const tipos = (eventos, tipo) => eventos.filter((e) => e.tipo === tipo);

describe("SIGTERM de verdade no processo (filho)", { timeout: 30_000 }, () => {
  it("no meio de um envio: o lead atual termina e fica sent, nenhum lead novo é reivindicado, sai com código 0 dentro do limite", async () => {
    const r = await rodarFilho("em_voo", { sinalQuando: (ev) => ev.tipo === "evolution_inicio" });
    expect(r.codigo).toBe(0);
    expect(r.msDesdeSinal).toBeLessThan(LIMITE_MS);
    expect(tipos(r.eventos, "claim").map((e) => e.lead)).toEqual(["lead-1"]);
    expect(tipos(r.eventos, "sent").map((e) => e.lead)).toEqual(["lead-1"]);
    const fimDoPasso = tipos(r.eventos, "evolution_fim")[0].t;
    const poolEnd = tipos(r.eventos, "pool_end")[0].t;
    expect(poolEnd).toBeGreaterThanOrEqual(fimDoPasso); // o pool fecha DEPOIS do passo registrado
    expect(tipos(r.eventos, "desligado")[0].enviosPararam).toBe(true);
  });

  it("estourou o prazo (Evolution não responde): sai mesmo assim com código 0, e fica 'claimed' com a marca de envio iniciado", async () => {
    const r = await rodarFilho("estoura", { sinalQuando: (ev) => ev.tipo === "evolution_inicio" });
    expect(r.codigo).toBe(0);
    expect(r.msDesdeSinal).toBeLessThan(3000);
    expect(tipos(r.eventos, "desligado")[0].enviosPararam).toBe(false);
    expect(tipos(r.eventos, "claim").map((e) => e.lead)).toEqual(["lead-1"]);
    expect(tipos(r.eventos, "marca").map((e) => e.lead)).toEqual(["lead-1"]);
    expect(tipos(r.eventos, "sent")).toEqual([]); // claimed + marca, sem 'sent': o estado da condição 3 abaixo
  });

  it("sem lote rodando: sai em menos de 2 s (deploy normal não fica mais lento)", async () => {
    const r = await rodarFilho("sem_lote", { sinalQuando: (ev) => ev.tipo === "pronto" });
    expect(r.codigo).toBe(0);
    expect(r.msDesdeSinal).toBeLessThan(2000);
  });
});

describe("dentro do processo", () => {
  let fetchOriginal;
  let atrasoMs = 150;
  beforeEach(() => {
    _resetDesligamentoParaTeste();
    fetchOriginal = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url) => {
      if (/connectionState|fetchInstances|whatsappNumbers/.test(String(url))) return { ok: true, status: 200, json: async () => ({}), text: async () => "{}" };
      await new Promise((r) => setTimeout(r, atrasoMs));
      return { ok: true, status: 200, json: async () => ({ key: { id: "wa" } }), text: async () => '{"key":{"id":"wa"}}' };
    });
  });
  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    _resetDesligamentoParaTeste();
  });

  it("orçamento: espera do envio (5 s) + HTTP (1,5 s) deixam folga de pelo menos 2 s nos 10 s; SHUTDOWN_FORCE_MS continua 10 s", () => {
    expect(PRAZO_ESPERA_ENVIO_MS + PRAZO_HTTP_MS + 1000).toBeLessThanOrEqual(LIMITE_MS - 2000);
    const server = readFileSync(resolve("src/server.js"), "utf8");
    expect(server).toMatch(/SHUTDOWN_FORCE_MS = Number\.parseInt\(process\.env\.SHUTDOWN_FORCE_MS \|\| "10000", 10\)/);
  });

  it("espera do envio e drenagem do agente rodam EM PARALELO, não em soma", async () => {
    const t0 = Date.now();
    const r = await executarDesligamento({
      iniciar: () => {},
      pararAgendadores: async () => {},
      aguardarEnvios: () => new Promise((ok) => setTimeout(() => ok(true), 300)),
      drenarAgente: () => new Promise((ok) => setTimeout(() => ok(true), 300)),
      fecharHttp: async () => {},
      fecharInfra: async () => {},
      log: () => {},
    });
    expect(Date.now() - t0).toBeLessThan(550);
    expect(r.enviosPararam).toBe(true);
  });

  it("(condição 2) nenhuma consulta do motor depois do pool.end()", async () => {
    atrasoMs = 200;
    const consultas = [];
    let poolEncerradoEm = null;
    const pool = {
      query: async (sql) => { consultas.push({ t: Date.now(), sql: String(sql).slice(0, 40) }); return { rowCount: 1, rows: [] }; },
      end: async () => { poolEncerradoEm = Date.now(); },
    };
    const envio = dispatchCampaignSequence({
      webhookUrl: "https://evolution.teste/message/sendText/chip-1", webhookToken: "t", leadDelayProvider: () => 0,
      leads: [{ id: "l1", telefone: "5534999990001" }, { id: "l2", telefone: "5534999990002" }],
      analyticsMeta: { sequence: [{ id: "s1", type: "text", text: "Oi", order: 1, enabled: true, triggerMode: "immediate", delayAfterSeconds: 0 }] },
      onLeadClaim: async () => { await pool.query("INSERT claim"); return true; },
      onLeadSendStarting: async () => { await pool.query("UPDATE marca"); return true; },
      onStepDispatched: async () => { await pool.query("INSERT lead_messages"); },
      onLeadDispatched: async () => { await pool.query("UPDATE sent"); },
    });
    await new Promise((r) => setTimeout(r, 50)); // passo do l1 em voo
    await executarDesligamento({
      iniciar: iniciarDesligamento,
      pararAgendadores: async () => {},
      aguardarEnvios: (p) => aguardarEnviosPararem(p),
      drenarAgente: async () => true,
      fecharHttp: async () => {},
      fecharInfra: () => pool.end(),
      log: () => {},
    });
    await envio;
    expect(poolEncerradoEm).not.toBeNull();
    expect(consultas.filter((c) => c.t > poolEncerradoEm)).toEqual([]);
    expect(consultas.map((c) => c.sql)).toEqual(["INSERT claim", "UPDATE marca", "INSERT lead_messages", "UPDATE sent"]);
  });
});

describe("estado que fica e conferência do boot (os dois PRs encaixam)", () => {
  let db;
  let pool;
  const LOTE = "22222222-2222-4222-8222-222222222222";
  const CAMP = "11111111-1111-4111-8111-111111111111";
  const LEAD = "33333333-3333-4333-8333-333333333331";
  const TEL = "5534999990001";

  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE public.campaigns (id UUID PRIMARY KEY, client_id TEXT, name TEXT, status TEXT, is_recurring BOOLEAN DEFAULT false, archived_at TIMESTAMPTZ, recurrence_end_type TEXT, next_run_at TIMESTAMPTZ);
      CREATE TABLE public.campaign_dispatches (id UUID PRIMARY KEY, name TEXT, campaign_id UUID, client_id TEXT, target_count INT, status TEXT, error_message TEXT, finished_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, scheduled_at TIMESTAMPTZ, sent_count INT);
      CREATE TABLE public.campaign_dispatch_runs (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_id UUID, campaign_id UUID, client_id TEXT, lead_id UUID, phone TEXT, status TEXT, error_message TEXT, sent_at TIMESTAMPTZ, claimed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now());
      CREATE TABLE public.lead_messages (id BIGSERIAL PRIMARY KEY, client_id TEXT, phone TEXT, direction TEXT, campaign_id UUID, meta JSONB, message_timestamp TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now());
    `);
    pool = { query: (sql, params) => db.query(sql, params) };
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    _resetDesligamentoParaTeste();
    await db.exec("DELETE FROM public.campaign_dispatch_runs; DELETE FROM public.campaign_dispatches; DELETE FROM public.lead_messages;");
    await db.query("INSERT INTO public.campaign_dispatches (id, name, campaign_id, client_id, target_count, status, error_message) VALUES ($1, 'Lote 1', $2, 'nous', 3, 'paused', 'Pausado — servidor reiniciou durante o envio. Retome quando quiser.')", [LOTE, CAMP]);
    await db.query("INSERT INTO public.campaign_dispatch_runs (dispatch_id, campaign_id, client_id, lead_id, phone, status, claimed_at) VALUES ($1, $2, 'nous', $3, $4, 'claimed', now() - interval '1 minute')", [LOTE, CAMP, LEAD, TEL]);
  });
  afterEach(() => _resetDesligamentoParaTeste());

  it("(condição 3) passo em voo que não terminou no prazo: claimed + marca, sem eco -> a conferência deixa 'skipped' (dúvida)", async () => {
    expect(await markRunSendStarted(pool, { dispatchId: LOTE, leadId: LEAD, phone: TEL })).toBe(true);
    const r = await conferirClaimedDoBoot(pool, { dispatchIds: [LOTE], esperaMs: 0 });
    expect(r).toMatchObject({ skipped: 1, pendente: 0, sent: 0 });
  });

  it("marca + nota de corte e SEM eco: continua sendo dúvida ('skipped'), nunca volta a pendente (seria reenvio)", async () => {
    await markRunSendStarted(pool, { dispatchId: LOTE, leadId: LEAD, phone: TEL });
    await markRunSequenceCut(pool, { dispatchId: LOTE, leadId: LEAD, phone: TEL, passosEnviados: 1, totalPassos: 3 });
    const r = await conferirClaimedDoBoot(pool, { dispatchIds: [LOTE], esperaMs: 0 });
    expect(r).toMatchObject({ skipped: 1, pendente: 0 });
  });

  it("(condição 4) sequência cortada (1 de 3 passos): log estruturado sem telefone inteiro, nota no run, 'sent' na conferência e contada no /health", async () => {
    const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchOriginal = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ key: { id: "wa" } }), text: async () => "{}" }));
    try {
      const t0 = Date.now();
      const envio = dispatchCampaignSequence({
        webhookUrl: "https://evolution.teste/message/sendText/chip-1", webhookToken: "t", leadDelayProvider: () => 0,
        leads: [{ id: LEAD, telefone: TEL }],
        context: { campaign: { id: CAMP, dispatchId: LOTE } },
        analyticsMeta: { sequence: [1, 2, 3].map((n) => ({ id: `s${n}`, type: "text", text: `Passo ${n}`, order: n, enabled: true, triggerMode: "immediate", delayAfterSeconds: 30 })) },
        onLeadSendStarting: () => markRunSendStarted(pool, { dispatchId: LOTE, leadId: LEAD, phone: TEL }),
        onStepDispatched: async () => {
          await db.query("INSERT INTO public.lead_messages (client_id, phone, direction, campaign_id, meta, created_at) VALUES ('nous', $1, 'outbound', $2, $3, now())", [TEL, CAMP, JSON.stringify({ dispatchId: LOTE })]);
          setTimeout(() => iniciarDesligamento(), 20); // desliga durante a pausa de 30 s depois do passo 1
        },
        onLeadSequenceCut: ({ passosEnviados, totalPassos }) => markRunSequenceCut(pool, { dispatchId: LOTE, leadId: LEAD, phone: TEL, passosEnviados, totalPassos }),
      });
      const { summary } = await envio;
      expect(Date.now() - t0).toBeLessThan(2000); // a pausa de 30 s acordou
      expect(summary.shutdown).toBe(true);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1); // só o passo 1 saiu
      const log = aviso.mock.calls.find((c) => String(c[0]).includes("sequencia_cortada_no_desligamento"));
      expect(log[1]).toMatchObject({ campanha: CAMP, lote: LOTE, passosEnviados: 1, totalPassos: 3 });
      expect(JSON.stringify(log[1])).not.toContain(TEL);
      const run = (await db.query("SELECT status, error_message FROM public.campaign_dispatch_runs WHERE lead_id = $1", [LEAD])).rows[0];
      expect(run).toEqual({ status: "claimed", error_message: `${RUN_SEND_MARKER}[vexo:cortado:1/3]` });

      const c = await conferirClaimedDoBoot(pool, { dispatchIds: [LOTE], esperaMs: 0 });
      expect(c).toMatchObject({ sent: 1 });
      const depois = (await db.query("SELECT status, error_message FROM public.campaign_dispatch_runs WHERE lead_id = $1", [LEAD])).rows[0];
      expect(depois).toEqual({ status: "sent", error_message: "[vexo:conferido_no_boot:dispatch][vexo:cortado:1/3]" });
      const h = await computeRestartBlockers(pool);
      expect(h.informativo.sequenciasCortadas24h).toBe(1);
    } finally {
      globalThis.fetch = fetchOriginal;
      aviso.mockRestore();
    }
  });
});

describe("/health durante o desligamento", () => {
  afterEach(() => _resetDesligamentoParaTeste());

  it("responde 503 'desligando' com restartSafe false, sem consultar o banco", async () => {
    const rotas = {};
    const app = { get: (p, ...h) => { rotas[p] = h[h.length - 1]; }, post: () => {}, put: () => {}, patch: () => {}, delete: () => {}, use: () => {} };
    const consulta = vi.fn();
    // Dependências que o registro das rotas chama na hora (middlewares) viram funções neutras.
    const base = { pgDatabasePool: { query: consulta }, useDirectPostgres: true };
    const deps = new Proxy(base, { get: (t, k) => (k in t ? t[k] : () => (_req, _res, next) => next?.()) });
    registerInsightsRoutes(app, deps);
    iniciarDesligamento();
    expect(estaDesligando()).toBe(true);
    let status = 200;
    let corpo = null;
    const res = { status(s) { status = s; return this; }, json(b) { corpo = b; return this; } };
    await rotas["/health"]({}, res);
    expect(status).toBe(503);
    expect(corpo).toMatchObject({ ok: false, status: "desligando", restartBlockers: { restartSafe: false } });
    expect(consulta).not.toHaveBeenCalled();
  });

  it("o healthcheck do Docker lê /health/live (não /health): o 503 não mata o contêiner antes da espera", () => {
    expect(readFileSync(resolve("Dockerfile"), "utf8")).toMatch(/http:\/\/localhost:\$\{PORT:-3001\}\/health\/live/);
  });
});

describe("lote no desligamento fica para o boot (não retoma, sem estado novo)", () => {
  it("runCampaignDispatch sai antes de qualquer consulta pós-envio quando o motor parou pelo desligamento", () => {
    const src = readFileSync(resolve("src/domains/campaigns/routes.js"), "utf8");
    const i = src.indexOf("if (result?.summary?.shutdown) {");
    expect(i).toBeGreaterThan(-1);
    // a primeira consulta pós-envio (contagem dos runs) vem DEPOIS da saída antecipada
    expect(src.indexOf("const counts = await getDispatchRunCounts(pgDatabasePool, dispatchId);", i)).toBeGreaterThan(i);
    expect(src.slice(i, i + 600)).toContain("return;");
    // e a saída não grava status nenhum no lote (fica 'running' para o boot)
    expect(src.slice(i, i + 600)).not.toMatch(/campaign_dispatches/);
  });
});
