// Lead 'claimed' no reinício não vira 'skipped' sem conferir (21/11/2026).
//
// Antes: no boot, todo run 'claimed' virava 'skipped' ("Interrompido antes da confirmação de envio") e o lead nunca
// mais voltava para a fila, tivesse ou não recebido. Agora o boot só pausa o lote (como antes) e, DEPOIS de subir o
// servidor, a conferência espera 10 s e decide cada claimed:
//   - há saída em lead_messages para o telefone, na mesma empresa, depois do claimed_at -> 'sent' (sem reenvio);
//     critério preferido: a linha da campanha (meta.dispatchId, depois campaign_id); senão telefone + empresa;
//   - não há saída e o run NÃO tem a marca de envio iniciado -> a chamada não aconteceu: o run é apagado e o lead
//     volta a pendente (a retomada envia uma vez);
//   - não há saída e o run TEM a marca -> dúvida: 'skipped' (melhor um lead sem receber que um recebendo duas vezes);
//   - erro na conferência -> todos os claimed pendentes ficam 'skipped', sem derrubar o processo.
// Lote pausado pelo boot continua pausado: a conferência só fecha 'done' quando o alvo completou. Nunca retoma.
//
// Postgres REAL (PGlite). Nada sai do processo.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { buildDispatchLeads } from "../campaign/dispatch.js";
import { recoverOrphanDispatches } from "../campaign/orphanRecovery.js";
import { conferirClaimedDoBoot, iniciarConferenciaDeClaimed } from "../campaign/claimedConference.js";
import { RUN_BOOT_SKIP_TEXT, RUN_SEND_MARKER, runErrorForDisplay } from "../services/runSendMarker.js";
import { computeRestartBlockers } from "../services/restartBlockers.js";
import { finalizeRunSent } from "../services/dispatchRunChip.js";

const T = "tenant-conferencia";
const CAMP = "11111111-1111-4111-8111-111111111111";
const LOTE = "22222222-2222-4222-8222-222222222222";
const L1 = "33333333-3333-4333-8333-333333333331";
const L2 = "33333333-3333-4333-8333-333333333332";
const TEL1 = "5534999990001";
const TEL2 = "5534999990002";

let db;
let pool;
let falhar = null;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    SET TimeZone = 'UTC';
    CREATE TABLE public.leads (
      id UUID PRIMARY KEY, client_id TEXT NOT NULL, telefone TEXT, nome TEXT, tipo_cliente TEXT, faixa_consumo TEXT,
      qualificacao TEXT, cidade TEXT, estado TEXT, status TEXT, opt_out BOOLEAN DEFAULT false,
      metadata JSONB DEFAULT '{}'::jsonb, dados JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE public.campaigns (
      id UUID PRIMARY KEY, client_id TEXT, name TEXT, status TEXT, is_recurring BOOLEAN DEFAULT false,
      archived_at TIMESTAMPTZ, recurrence_end_type TEXT, next_run_at TIMESTAMPTZ
    );
    CREATE TABLE public.campaign_dispatches (
      id UUID PRIMARY KEY, name TEXT, campaign_id UUID, client_id TEXT, limit_per_run INT, target_count INT,
      triggered_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), status TEXT, error_message TEXT,
      sent_count INT, failed_count INT, finished_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, scheduled_at TIMESTAMPTZ
    );
    CREATE TABLE public.campaign_dispatch_runs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(), dispatch_id UUID, campaign_id UUID, client_id TEXT, lead_id UUID,
      phone TEXT, status TEXT, error_message TEXT, sent_at TIMESTAMPTZ, claimed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT now(), evolution_instance_id UUID, lead_import_item_id UUID,
      UNIQUE (dispatch_id, lead_id)
    );
    CREATE TABLE public.lead_messages (
      id BIGSERIAL PRIMARY KEY, client_id TEXT, phone TEXT, direction TEXT, campaign_id UUID, meta JSONB,
      message_timestamp TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  pool = {
    query: async (sql, params) => {
      if (falhar && falhar.test(String(sql))) throw new Error("connection terminated unexpectedly");
      return db.query(sql, params);
    },
  };
  _setPgDatabasePoolForTesting(pool);
});

afterAll(async () => {
  _setPgDatabasePoolForTesting(null);
  await db?.close();
});

beforeEach(async () => {
  falhar = null;
  await db.exec("DELETE FROM public.campaign_dispatch_runs; DELETE FROM public.campaign_dispatches; DELETE FROM public.lead_messages; DELETE FROM public.leads;");
  await db.query("INSERT INTO public.leads (id, client_id, telefone, nome) VALUES ($1, $3, $4, 'Ana'), ($2, $3, $5, 'Bia')", [L1, L2, T, TEL1, TEL2]);
});

const minAtras = (m) => new Date(Date.now() - m * 60_000).toISOString();

async function lote({ status = "paused", alvo = 5, erro = "Pausado — servidor reiniciou durante o envio. Retome quando quiser." } = {}) {
  await db.query(
    "INSERT INTO public.campaign_dispatches (id, name, campaign_id, client_id, target_count, status, error_message, triggered_at) VALUES ($1, 'Lote 2/4', $2, $3, $4, $5, $6, now())",
    [LOTE, CAMP, T, alvo, status, erro]
  );
}

async function run(leadId, tel, { status = "claimed", marca = false, claimedHa = 2 } = {}) {
  await db.query(
    "INSERT INTO public.campaign_dispatch_runs (dispatch_id, campaign_id, client_id, lead_id, phone, status, error_message, claimed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [LOTE, CAMP, T, leadId, tel, status, marca ? RUN_SEND_MARKER : null, minAtras(claimedHa)]
  );
}

async function saida(tel, { haMin = 1, dispatch = false, campanha = false, empresa = T } = {}) {
  await db.query(
    "INSERT INTO public.lead_messages (client_id, phone, direction, campaign_id, meta, message_timestamp, created_at) VALUES ($1, $2, 'outbound', $3, $4, $5, $5)",
    [empresa, tel, campanha || dispatch ? CAMP : null, JSON.stringify(dispatch ? { source: "campaign_dispatch", dispatchId: LOTE } : { source: "device-whatsapp-webhook" }), minAtras(haMin)]
  );
}

const runDe = async (leadId) => (await db.query("SELECT status, error_message, sent_at FROM public.campaign_dispatch_runs WHERE lead_id = $1", [leadId])).rows[0] || null;
const elegiveis = async () => (await buildDispatchLeads({ clientId: T, importId: "__crm__", excludeDispatchId: LOTE })).map((l) => l.id).sort();
const conferir = (opts = {}) => conferirClaimedDoBoot(pool, { dispatchIds: [LOTE], esperaMs: 0, ...opts });

describe("conferência dos claimed depois do boot", () => {
  it("(a) caiu no meio do envio COM a saída da campanha gravada: vira 'sent', critério dispatch, e não é enviado de novo", async () => {
    await lote();
    await run(L1, TEL1, { marca: true });
    await saida(TEL1, { dispatch: true });
    const r = await conferir();
    expect(r).toMatchObject({ sent: 1, pendente: 0, skipped: 0 });
    const x = await runDe(L1);
    expect(x.status).toBe("sent");
    expect(x.sent_at).not.toBeNull();
    expect(x.error_message).toBe("[vexo:conferido_no_boot:dispatch]");
    expect(await elegiveis()).toEqual([L2]); // L1 fica fora da retomada: sem segundo envio
  });

  it("saída com o campaign_id, sem dispatchId: 'sent', critério campanha", async () => {
    await lote();
    await run(L1, TEL1, { marca: true });
    await saida(TEL1, { campanha: true });
    await conferir();
    expect((await runDe(L1)).error_message).toBe("[vexo:conferido_no_boot:campanha]");
  });

  it("só o eco do aparelho (sem marca de campanha): 'sent' pelo segundo critério, telefone + empresa", async () => {
    await lote();
    await run(L1, TEL1, { marca: true });
    await saida(TEL1);
    await conferir();
    expect(await runDe(L1)).toMatchObject({ status: "sent", error_message: "[vexo:conferido_no_boot:telefone]" });
  });

  it("eco do aparelho ANTES e linha da campanha DEPOIS: o critério é o da campanha (dispatch), não o telefone", async () => {
    await lote();
    await run(L1, TEL1, { marca: true, claimedHa: 3 });
    await saida(TEL1, { haMin: 2 }); // eco do aparelho, sem marca de campanha
    await saida(TEL1, { haMin: 1, dispatch: true });
    await conferir();
    expect((await runDe(L1)).error_message).toBe("[vexo:conferido_no_boot:dispatch]");
  });

  it("saída ANTES do claimed_at, ou de outra empresa, não conta", async () => {
    await lote();
    await run(L1, TEL1, { marca: true, claimedHa: 2 });
    await saida(TEL1, { haMin: 10, dispatch: true });
    await saida(TEL1, { haMin: 1, empresa: "outra-empresa" });
    await conferir();
    expect(await runDe(L1)).toMatchObject({ status: "skipped", error_message: RUN_BOOT_SKIP_TEXT });
  });

  it("(b) sem saída e SEM a marca (a chamada não aconteceu): o run some e o lead volta a pendente, elegível uma vez só", async () => {
    await lote();
    await run(L1, TEL1, { marca: false });
    await run(L2, TEL2, { status: "sent" });
    const r = await conferir();
    expect(r).toMatchObject({ sent: 0, pendente: 1, skipped: 0 });
    expect(await runDe(L1)).toBeNull();
    expect(await elegiveis()).toEqual([L1]);
  });

  it("(c) sem saída e COM a marca (chamada feita, sem eco): fica 'skipped' e o /health conta em skippedSemConfirmacao24h", async () => {
    await lote();
    await run(L1, TEL1, { marca: true });
    const r = await conferir();
    expect(r).toMatchObject({ sent: 0, pendente: 0, skipped: 1 });
    expect(await runDe(L1)).toMatchObject({ status: "skipped", error_message: RUN_BOOT_SKIP_TEXT });
    expect(await elegiveis()).toEqual([L2]);
    const h = await computeRestartBlockers(pool);
    expect(h.informativo.skippedSemConfirmacao24h).toBe(1);
  });

  it("a espera vale: eco que chega DURANTE a espera fecha como 'sent'", async () => {
    await lote();
    await run(L1, TEL1, { marca: true });
    const pronto = conferir({ esperaMs: 300 });
    await new Promise((r) => setTimeout(r, 30));
    await saida(TEL1, { haMin: 0, dispatch: true });
    await pronto;
    expect((await runDe(L1)).status).toBe("sent");
  });

  it("(4) erro na conferência: todos os claimed ficam 'skipped' e nada é lançado", async () => {
    await lote();
    await run(L1, TEL1, { marca: false });
    await run(L2, TEL2, { marca: true });
    falhar = /FROM public\.lead_messages/;
    await expect(conferir()).resolves.toMatchObject({ erro: true });
    falhar = null;
    expect((await runDe(L1)).status).toBe("skipped");
    expect((await runDe(L2)).status).toBe("skipped");
  });

  it("(3) lote que completou o alvo fecha 'done'; lote incompleto continua 'paused' (nunca retoma)", async () => {
    await lote({ alvo: 2 });
    await run(L1, TEL1, { marca: true });
    await run(L2, TEL2, { status: "sent" });
    await saida(TEL1, { dispatch: true });
    await conferir();
    expect((await db.query("SELECT status FROM public.campaign_dispatches WHERE id = $1", [LOTE])).rows[0].status).toBe("done");

    await db.exec("DELETE FROM public.campaign_dispatch_runs; DELETE FROM public.campaign_dispatches; DELETE FROM public.lead_messages;");
    await lote({ alvo: 5 });
    await run(L1, TEL1, { marca: true });
    await saida(TEL1, { dispatch: true });
    await conferir();
    expect((await db.query("SELECT status FROM public.campaign_dispatches WHERE id = $1", [LOTE])).rows[0].status).toBe("paused");
  });

  it("lote pausado pelo CLIENTE (não pelo boot) não fecha 'done' nem muda", async () => {
    await lote({ alvo: 1, erro: "Disparo pausado manualmente." });
    await run(L1, TEL1, { marca: true });
    await saida(TEL1, { dispatch: true });
    await conferir();
    expect((await db.query("SELECT status FROM public.campaign_dispatches WHERE id = $1", [LOTE])).rows[0].status).toBe("paused");
  });
});

describe("boot e /health", () => {
  it("o boot pausa o lote SEM transformar o claimed em skipped e devolve o lote para conferir", async () => {
    await lote({ status: "running" });
    await run(L1, TEL1, { marca: true });
    const r = await recoverOrphanDispatches(pool);
    expect(r.items[0]).toMatchObject({ statusAnterior: "running", novoStatus: "paused", claimedEmConferencia: 1 });
    expect(r.claimedParaConferir).toEqual([LOTE]);
    expect((await runDe(L1)).status).toBe("claimed");
  });

  it("(e) a conferência começa e o /health responde ANTES da espera acabar (não segura o boot)", async () => {
    await lote();
    await run(L1, TEL1, { marca: true });
    let soltar;
    const espera = vi.fn(() => new Promise((r) => { soltar = r; }));
    const inicio = Date.now();
    const tarefa = iniciarConferenciaDeClaimed(pool, [LOTE], { esperar: espera });
    expect(Date.now() - inicio).toBeLessThan(50);
    const h = await computeRestartBlockers(pool);
    expect(h.measured).toBe(true);
    expect((await runDe(L1)).status).toBe("claimed"); // ainda esperando
    soltar();
    await tarefa;
    expect((await runDe(L1)).status).toBe("skipped");
  });

  it("(e) no server.js a conferência é disparada DEPOIS do listen, sem await", () => {
    const src = readFileSync(resolve("src/server.js"), "utf8");
    const bloco = src.slice(src.indexOf("runMigrations(pgDatabasePool)"));
    expect(bloco.indexOf("listenWithRetry();")).toBeGreaterThan(-1);
    expect(bloco.indexOf("iniciarConferenciaDeClaimed(")).toBeGreaterThan(bloco.indexOf("listenWithRetry();"));
    expect(bloco).not.toMatch(/await\s+iniciarConferenciaDeClaimed/);
  });

  it("iniciarConferenciaDeClaimed nunca derruba o processo, mesmo com o banco fora", async () => {
    const quebrado = { query: async () => { throw new Error("ECONNREFUSED"); } };
    await expect(iniciarConferenciaDeClaimed(quebrado, [LOTE], { esperar: async () => {} })).resolves.toBeDefined();
  });
});

describe("marca nunca aparece como erro", () => {
  it("finalizeRunSent limpa a marca de envio iniciado", async () => {
    await lote();
    await run(L1, TEL1, { marca: true });
    await finalizeRunSent(pool, { clientId: T, dispatchId: LOTE, leadId: L1, phone: TEL1, sentAt: new Date().toISOString() });
    expect(await runDe(L1)).toMatchObject({ status: "sent", error_message: null });
  });

  it("finalizeRunSent não apaga erro de verdade", async () => {
    await lote();
    await db.query(
      "INSERT INTO public.campaign_dispatch_runs (dispatch_id, campaign_id, client_id, lead_id, phone, status, error_message) VALUES ($1, $2, $3, $4, $5, 'claimed', 'erro real')",
      [LOTE, CAMP, T, L1, TEL1]
    );
    await finalizeRunSent(pool, { clientId: T, dispatchId: LOTE, leadId: L1, phone: TEL1, sentAt: new Date().toISOString() });
    expect((await runDe(L1)).error_message).toBe("erro real");
  });

  it.each([
    [RUN_SEND_MARKER, null],
    ["[vexo:conferido_no_boot:dispatch]", null],
    ["ERR_INVALID_JID", "ERR_INVALID_JID"],
    [null, null],
  ])("runErrorForDisplay(%s) -> %s", (entrada, saida) => {
    expect(runErrorForDisplay(entrada)).toBe(saida);
  });
});
