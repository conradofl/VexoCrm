// Agendador do coletor de tráfego.
// Banco real (pglite com a migration de produção) e fetch da Meta dublado.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/database.js", () => ({ pgDatabasePool: null }));

const {
  ADVISORY_LOCK_ID,
  createTrafficCollectorScheduler,
  isTrafficCollectorEnabled,
  resolveScheduledSlot,
  withCollectorLock,
} = await import("../traffic/collectorScheduler.js");
const { runTrafficCollection } = await import("../traffic/collector.js");
const { createMetaFetch, createTrafficDb, insertAccount, insightRow, metaHandlerFor, poolFor } = await import(
  "./helpers/trafficHarness.js"
);

// 07h00 em São Paulo = 10h00 UTC.
const SLOT_07 = new Date("2026-11-15T10:00:10.000Z");
const SLOT_13 = new Date("2026-11-15T16:00:00.000Z");
const FORA = new Date("2026-11-15T11:00:00.000Z");

describe("agendador do coletor de tráfego", () => {
  let db;
  let pool;

  beforeEach(async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    db = await createTrafficDb();
    pool = poolFor(db);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  const locksHeld = async () =>
    (await db.query("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND objid = $1", [ADVISORY_LOCK_ID])).rows[0].n;

  it("três slots por dia, no fuso de São Paulo, inclusive no fim de semana", () => {
    // 15/11/2026 é domingo.
    expect(resolveScheduledSlot(SLOT_07)).toEqual({ slotKey: "traffic-collector:2026-11-15:07", dateKey: "2026-11-15", scheduledTime: "07:00" });
    expect(resolveScheduledSlot(SLOT_13).slotKey).toBe("traffic-collector:2026-11-15:13");
    expect(resolveScheduledSlot(new Date("2026-11-15T22:00:00.000Z")).slotKey).toBe("traffic-collector:2026-11-15:19");
    expect(resolveScheduledSlot(FORA)).toBeNull();
    expect(resolveScheduledSlot(new Date("2026-11-15T10:01:00.000Z"))).toBeNull();
    // 07h UTC não é 07h de São Paulo.
    expect(resolveScheduledSlot(new Date("2026-11-15T07:00:00.000Z"))).toBeNull();
  });

  it("desligado por padrão; só liga com a variável em true", () => {
    expect(isTrafficCollectorEnabled({})).toBe(false);
    expect(isTrafficCollectorEnabled({ TRAFFIC_COLLECTOR_ENABLED: "1" })).toBe(false);
    expect(isTrafficCollectorEnabled({ TRAFFIC_COLLECTOR_ENABLED: " TRUE " })).toBe(true);
  });

  it("desligado, o tique não lê nem grava nada", async () => {
    const runner = vi.fn();
    const scheduler = createTrafficCollectorScheduler({ pool, runner, enabled: false });
    expect(await scheduler.tick({ now: SLOT_07 })).toEqual({ ran: false, reason: "SCHEDULE_DISABLED" });
    expect(runner).not.toHaveBeenCalled();
    expect(pool.stats.connects).toBe(0);
  });

  it("no slot, coleta de verdade uma vez; o segundo tique do mesmo slot não repete", async () => {
    await insertAccount(db, { clientId: "teste-trafego-ag", externalAccountId: "111" });
    const meta = createMetaFetch(metaHandlerFor({ 111: { insights: [insightRow({ adId: "ad1", date: "2026-11-14", spend: "42.00" })] } }));
    const runner = ({ pool: p, now }) =>
      runTrafficCollection({ pool: p, now, env: { META_ADS_ACCESS_TOKEN: "t" }, fetchImpl: meta.fetchImpl, sleep: async () => {} });
    const scheduler = createTrafficCollectorScheduler({ pool, runner, enabled: true });

    const first = await scheduler.tick({ now: SLOT_07 });
    expect(first.ran).toBe(true);
    expect(first.summary.meta).toMatchObject({ connected: true, ok: 1, failed: 0 });
    const { rows } = await db.query("SELECT spend::text AS spend FROM traffic_metrics_daily");
    expect(rows).toEqual([{ spend: "42.00" }]);

    const callsAfterFirst = meta.calls.length;
    const second = await scheduler.tick({ now: new Date(SLOT_07.getTime() + 30_000) });
    expect(second).toMatchObject({ ran: false, reason: "SLOT_ALREADY_ATTEMPTED" });
    expect(meta.calls.length).toBe(callsAfterFirst);

    // Slot seguinte roda de novo.
    expect((await scheduler.tick({ now: SLOT_13 })).ran).toBe(true);
  });

  it("fora do horário não roda", async () => {
    const runner = vi.fn();
    const scheduler = createTrafficCollectorScheduler({ pool, runner, enabled: true });
    expect(await scheduler.tick({ now: FORA })).toEqual({ ran: false, reason: "NOT_SCHEDULED_TIME" });
    expect(runner).not.toHaveBeenCalled();
  });

  it("a trava é pega e solta na mesma conexão, e fica solta mesmo quando a coleta lança", async () => {
    let heldDuringRun = null;
    const ok = await withCollectorLock(pool, async () => {
      heldDuringRun = await locksHeld();
      return "feito";
    });
    expect(ok).toEqual({ locked: true, result: "feito" });
    expect(heldDuringRun).toBe(1);
    expect(await locksHeld()).toBe(0);
    expect(pool.stats).toEqual({ connects: 1, releases: 1 });

    await expect(
      withCollectorLock(pool, async () => {
        throw new Error("coleta quebrou");
      })
    ).rejects.toThrow("coleta quebrou");
    expect(await locksHeld()).toBe(0);
    expect(pool.stats).toEqual({ connects: 2, releases: 2 });
  });

  it("erro da coleta não derruba o tique", async () => {
    const scheduler = createTrafficCollectorScheduler({
      pool,
      enabled: true,
      runner: async () => {
        throw new Error("banco fora");
      },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await scheduler.tick({ now: SLOT_07 })).toMatchObject({ ran: true, error: "banco fora" });
    expect(await locksHeld()).toBe(0);
  });

  // Limite do pglite, não do produto: ele tem uma sessão só, e trava de sessão
  // é reentrante na mesma sessão, então não dá para disputar a trava de verdade
  // aqui. Este caso usa uma conexão que responde "não adquirida" só para provar
  // o que o agendador faz com essa resposta: não coleta e devolve a conexão.
  it("com a trava em outra instância, não coleta", async () => {
    const released = vi.fn();
    const busyPool = {
      connect: async () => ({ query: async () => ({ rows: [{ acquired: false }] }), release: released }),
    };
    const runner = vi.fn();
    const scheduler = createTrafficCollectorScheduler({ pool: busyPool, runner, enabled: true });
    expect(await scheduler.tick({ now: SLOT_07 })).toMatchObject({ ran: false, reason: "CONCURRENT_LOCK_HELD" });
    expect(runner).not.toHaveBeenCalled();
    expect(released).toHaveBeenCalledTimes(1);
  });
});
