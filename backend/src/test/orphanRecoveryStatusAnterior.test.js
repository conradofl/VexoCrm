// Boot-recovery diz o estado anterior do lote e quantos 'claimed' viraram 'skipped' (20/11/2026).
//
// Fato: no boot de 19/11 23:20:18Z, dois lotes da Nous foram pausados e o log não dizia se estavam ENVIANDO ('running':
// o reinício cortou um envio) ou já PARADOS com pendentes ('interrupted': só mudou de nome). Nem quantos leads ficaram
// sem confirmação (viram 'skipped' e não voltam para a fila sozinhos: a única perda real de um reinício).
//
// Postgres REAL (PGlite).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { recoverOrphanDispatches } from "../campaign/orphanRecovery.js";

let db;
let pool;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    CREATE TABLE public.campaign_dispatches (
      id TEXT PRIMARY KEY, name TEXT, campaign_id TEXT, client_id TEXT, limit_per_run INT, target_count INT,
      triggered_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT now(), status TEXT, error_message TEXT,
      sent_count INT, failed_count INT, finished_at TIMESTAMPTZ, updated_at TIMESTAMPTZ
    );
    CREATE TABLE public.campaign_dispatch_runs (
      id BIGSERIAL PRIMARY KEY, dispatch_id TEXT, status TEXT, error_message TEXT, sent_at TIMESTAMPTZ
    );
  `);
  pool = { query: (sql, params) => db.query(sql, params) };
});

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec("DELETE FROM public.campaign_dispatch_runs; DELETE FROM public.campaign_dispatches;");
});

async function lote(id, status, { alvo = 10, sent = 0, claimed = 0 } = {}) {
  await db.query(
    "INSERT INTO public.campaign_dispatches (id, name, campaign_id, client_id, target_count, status, triggered_at) VALUES ($1, $2, '936818b0', 'nous-gestao', $3, $4, now())",
    [id, `Lote ${id}`, alvo, status]
  );
  for (let i = 0; i < sent; i += 1) await db.query("INSERT INTO public.campaign_dispatch_runs (dispatch_id, status, sent_at) VALUES ($1, 'sent', now())", [id]);
  for (let i = 0; i < claimed; i += 1) await db.query("INSERT INTO public.campaign_dispatch_runs (dispatch_id, status) VALUES ($1, 'claimed')", [id]);
}

function capturarLog() {
  const linhas = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args) => linhas.push(args));
  return { linhas, restaurar: () => spy.mockRestore() };
}

describe("boot-recovery: estado anterior e 'claimed' que viraram 'skipped'", () => {
  it("lote ENVIANDO no reinício: pausa, diz statusAnterior 'running' e quantos claimed viraram skipped", async () => {
    await lote("l2", "running", { sent: 5, claimed: 2 });
    const log = capturarLog();
    const r = await recoverOrphanDispatches(pool);
    log.restaurar();
    expect(r.items[0]).toMatchObject({ statusAnterior: "running", novoStatus: "paused", leadsSent: 5, claimedViraramSkipped: 2 });
    const pausa = log.linhas.find((a) => String(a[0]).includes("lote órfão pausado"));
    expect(pausa[1]).toMatchObject({ statusAnterior: "running", claimedViraramSkipped: 2 });
    const { rows } = await db.query("SELECT count(*)::int AS n FROM public.campaign_dispatch_runs WHERE dispatch_id = 'l2' AND status = 'skipped'");
    expect(rows[0].n).toBe(2);
  });

  it("lote já PARADO com pendentes ('interrupted'): pausa e diz statusAnterior 'interrupted', 0 viraram skipped", async () => {
    await lote("l3", "interrupted", { alvo: 20, sent: 11 });
    const log = capturarLog();
    const r = await recoverOrphanDispatches(pool);
    log.restaurar();
    expect(r.items[0]).toMatchObject({ statusAnterior: "interrupted", novoStatus: "paused", claimedViraramSkipped: 0 });
    const pausa = log.linhas.find((a) => String(a[0]).includes("lote órfão pausado"));
    expect(pausa[1]).toMatchObject({ statusAnterior: "interrupted", claimedViraramSkipped: 0 });
  });

  it("lote completo fechado como 'done' também diz o anterior e os skipped", async () => {
    await lote("l4", "running", { alvo: 3, sent: 2, claimed: 1 });
    const r = await recoverOrphanDispatches(pool);
    expect(r.items[0]).toMatchObject({ statusAnterior: "running", novoStatus: "done", claimedViraramSkipped: 1 });
  });
});
