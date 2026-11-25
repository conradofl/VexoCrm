// O que impede reiniciar o servidor agora (/health -> restartBlockers), 20/11/2026.
//
// Fato: o log de boot de 19/11 23:20:18Z (merge do #281) pausou 2 lotes da Nous, e o executor tinha conferido
// activeDispatchesCount: 0 antes do merge. Esse contador só vê lote 'running': não vê lote que COMEÇA entre o merge e o
// reinício (o deploy leva 3 a 5 min), nem lote agendado, nem lote pausado "fora da janela"/por cota que o agendador
// retoma sozinho (campaigns/routes.js, tick do agendador), nem campanha recorrente que vence.
//
// Regra: restartSafe = nada enviando E nada que comece nos próximos 15 min. Lotes interrupted/paused (sem retomada
// automática) e leads 'claimed' sem confirmação aparecem só como informação. Consulta que falha = restartSafe false.
//
// Postgres REAL (PGlite). Nada sai do processo.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { computeRestartBlockers, SCHEDULED_SOON_MINUTES } from "../services/restartBlockers.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
// pause_reason é coluna gerada (migration 20261125030000); o esquema de teste aplica a migration de verdade.
const MIGRATION_PAUSE_REASON = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20261125030000_add_pause_reason_to_campaign_dispatches.sql"),
  "utf8"
);


const AGORA = new Date("2026-11-20T12:00:00Z");
const daqui = (min) => new Date(AGORA.getTime() + min * 60_000).toISOString();

let db;
let pool;
let n = 0;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE public.campaigns (
      id TEXT PRIMARY KEY, client_id TEXT, name TEXT, status TEXT, is_recurring BOOLEAN DEFAULT false,
      archived_at TIMESTAMPTZ, recurrence_end_type TEXT, next_run_at TIMESTAMPTZ
    );
    CREATE TABLE public.campaign_dispatches (
      id TEXT PRIMARY KEY, campaign_id TEXT, client_id TEXT, name TEXT, status TEXT,
      scheduled_at TIMESTAMPTZ, error_message TEXT, triggered_at TIMESTAMPTZ
    );
    CREATE TABLE public.campaign_dispatch_runs (
      id BIGSERIAL PRIMARY KEY, dispatch_id TEXT, status TEXT, sent_at TIMESTAMPTZ,
      error_message TEXT, claimed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
  await db.exec(MIGRATION_PAUSE_REASON);
  pool = { query: (sql, params) => db.query(sql, params) };
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("DELETE FROM public.campaign_dispatch_runs; DELETE FROM public.campaign_dispatches; DELETE FROM public.campaigns;");
});

async function lote(status, { scheduledAt = null, erro = null, claimed = 0 } = {}) {
  n += 1;
  const id = `lote-${n}`;
  await db.query(
    "INSERT INTO public.campaign_dispatches (id, campaign_id, client_id, name, status, scheduled_at, error_message) VALUES ($1, 'c1', 'nous-gestao', $2, $3, $4, $5)",
    [id, `Lote ${n}`, status, scheduledAt, erro]
  );
  for (let i = 0; i < claimed; i += 1) await db.query("INSERT INTO public.campaign_dispatch_runs (dispatch_id, status) VALUES ($1, 'claimed')", [id]);
  return id;
}

async function recorrente({ nextRunAt, status = "active", arquivada = false, fim = "never" }) {
  n += 1;
  await db.query(
    "INSERT INTO public.campaigns (id, client_id, name, status, is_recurring, archived_at, recurrence_end_type, next_run_at) VALUES ($1, 'nous-gestao', 'Recorrente', $2, true, $3, $4, $5)",
    [`camp-${n}`, status, arquivada ? AGORA.toISOString() : null, fim, nextRunAt]
  );
}

const medir = () => computeRestartBlockers(pool, { now: AGORA });

describe("restartBlockers: o que bloqueia um reinício", () => {
  it("sem nada: restartSafe true", async () => {
    const r = await medir();
    expect(r).toMatchObject({ restartSafe: true, measured: true, running: 0, scheduledSoon: 0, windowMinutes: SCHEDULED_SOON_MINUTES });
    expect(SCHEDULED_SOON_MINUTES).toBe(15);
  });

  it("lote enviando (running): bloqueia", async () => {
    await lote("running");
    expect(await medir()).toMatchObject({ restartSafe: false, running: 1 });
  });

  it("lote agendado para daqui a 14 min: bloqueia; daqui a 16 min: não", async () => {
    await lote("scheduled", { scheduledAt: daqui(16) });
    expect(await medir()).toMatchObject({ restartSafe: true, scheduledSoon: 0 });
    await lote("scheduled", { scheduledAt: daqui(14) });
    const r = await medir();
    expect(r).toMatchObject({ restartSafe: false, scheduledSoon: 1 });
    expect(r.scheduledSoonDetail).toMatchObject({ lotesAgendados: 1, lotesQueVoltamSozinhos: 0, recorrentes: 0 });
  });

  it("lote agendado já vencido (o agendador pega no próximo tick): bloqueia", async () => {
    await lote("scheduled", { scheduledAt: daqui(-3) });
    expect(await medir()).toMatchObject({ restartSafe: false, scheduledSoon: 1 });
  });

  it("lote agendado sem hora: o agendador nunca pega, não bloqueia", async () => {
    await lote("scheduled", { scheduledAt: null });
    expect(await medir()).toMatchObject({ restartSafe: true, scheduledSoon: 0 });
  });

  it.each([
    ["Pausado: fora da janela de envio (08:00-18:00). Retoma às 08:00."],
    ["Pausado — cota diária do chip atingida. Retoma amanhã."],
  ])("lote pausado que o agendador retoma sozinho em 10 min (%s): bloqueia", async (erro) => {
    await lote("paused", { scheduledAt: daqui(10), erro });
    const r = await medir();
    expect(r).toMatchObject({ restartSafe: false, scheduledSoon: 1 });
    expect(r.scheduledSoonDetail.lotesQueVoltamSozinhos).toBe(1);
  });

  it("lote pausado por outro motivo (manual, reinício): só informativo, não bloqueia", async () => {
    await lote("paused", { scheduledAt: daqui(5), erro: "Pausado — servidor reiniciou durante o envio. Retome quando quiser." });
    await lote("paused", { scheduledAt: daqui(5), erro: "Disparo pausado manualmente." });
    const r = await medir();
    expect(r).toMatchObject({ restartSafe: true, scheduledSoon: 0 });
    expect(r.informativo.paused).toBe(2);
  });

  it("lote interrupted com pendentes: aparece, não bloqueia", async () => {
    await lote("interrupted");
    const r = await medir();
    expect(r).toMatchObject({ restartSafe: true });
    expect(r.informativo.interrupted).toBe(1);
  });

  it("campanha recorrente que vence em 10 min: bloqueia; em 20 min, arquivada ou pausada: não", async () => {
    await recorrente({ nextRunAt: daqui(20) });
    await recorrente({ nextRunAt: daqui(5), arquivada: true });
    await recorrente({ nextRunAt: daqui(5), status: "paused" });
    await recorrente({ nextRunAt: daqui(5), fim: null });
    expect(await medir()).toMatchObject({ restartSafe: true, scheduledSoon: 0 });
    await recorrente({ nextRunAt: daqui(10) });
    const r = await medir();
    expect(r).toMatchObject({ restartSafe: false, scheduledSoon: 1 });
    expect(r.scheduledSoonDetail.recorrentes).toBe(1);
  });

  it("leads 'claimed' sem confirmação em lote enviando: informativo (a única perda real num reinício)", async () => {
    await lote("running", { claimed: 3 });
    await lote("interrupted", { claimed: 2 }); // lote parado: não está enviando, não conta
    const r = await medir();
    expect(r.informativo.claimedSemConfirmacao).toBe(3);
  });

  it("caso Nous de 19/11: Lote 3 enviou há 2 min (running), Lote 4 agendado para dali a 3 min; checagem 4 min antes do boot: NÃO é seguro", async () => {
    // Medido em produção: Lote 3/4 enviou às 23:15Z, o merge do #281 foi às 23:16:39Z, o boot às 23:20:18Z, e o
    // activeDispatchesCount da checagem deu 0. Aqui a checagem é às 12:00 (4 min antes de um boot às 12:04).
    const l3 = await lote("running", { claimed: 1 });
    await db.query("INSERT INTO public.campaign_dispatch_runs (dispatch_id, status, sent_at) VALUES ($1, 'sent', $2)", [l3, daqui(-2)]);
    await lote("scheduled", { scheduledAt: daqui(3) });
    await lote("paused", { scheduledAt: daqui(-60), erro: "Pausado — servidor reiniciou durante o envio. Retome quando quiser." });
    const r = await medir();
    expect(r).toMatchObject({ restartSafe: false, running: 1, scheduledSoon: 1 });
    expect(r.informativo).toMatchObject({ paused: 1, claimedSemConfirmacao: 1 });
  });

  it("consulta que falha: restartSafe false e measured false (na dúvida, segura)", async () => {
    const r = await computeRestartBlockers({ query: async () => { throw new Error("relation does not exist"); } }, { now: AGORA });
    expect(r).toMatchObject({ restartSafe: false, measured: false });
  });

  it("sem banco: restartSafe false", async () => {
    expect(await computeRestartBlockers(null, { now: AGORA })).toMatchObject({ restartSafe: false, measured: false });
  });
});
