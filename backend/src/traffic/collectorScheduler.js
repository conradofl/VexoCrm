// Agendador do coletor de tráfego. Mesmo desenho dos agendadores que já existem
// (gdVigiaScheduler): tique curto, slot por horário em fuso nomeado, desligado
// por padrão e trava no Postgres contra execução dupla.
//
// Três coletas por dia, todos os dias: 07h00, 13h00 e 19h00 de São Paulo.
//
// Chaves para desligar:
//   - global: TRAFFIC_COLLECTOR_ENABLED (padrão false);
//   - por conta: traffic_accounts.status = 'paused'.
//
// Diferença para o Vigia: a trava de sessão (pg_try_advisory_lock) é pega e
// solta na MESMA conexão. Pelo pool, pegar e soltar podem cair em conexões
// diferentes, e aí a trava fica presa até a conexão morrer.

import { pgDatabasePool } from "../services/database.js";
import { runTrafficCollection } from "./collector.js";

export const TIMEZONE = "America/Sao_Paulo";
export const SCHEDULE_ENABLED_ENV = "TRAFFIC_COLLECTOR_ENABLED";
export const ADVISORY_LOCK_ID = 843355010; // exclusivo do coletor de tráfego
export const DEFAULT_TICK_INTERVAL_MS = 30_000;
export const SCHEDULED_HOURS = ["07", "13", "19"];

export function isTrafficCollectorEnabled(env = process.env) {
  return String(env?.[SCHEDULE_ENABLED_ENV] || "false").trim().toLowerCase() === "true";
}

function getZonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute") };
}

/** Slot de coleta para o instante informado, ou null fora dos horários. */
export function resolveScheduledSlot(date = new Date(), timeZone = TIMEZONE) {
  const parts = getZonedParts(date, timeZone);
  if (parts.minute !== "00" || !SCHEDULED_HOURS.includes(parts.hour)) return null;

  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
  return { slotKey: `traffic-collector:${dateKey}:${parts.hour}`, dateKey, scheduledTime: `${parts.hour}:00` };
}

/**
 * Roda `fn` segurando a trava do coletor numa conexão dedicada.
 * @returns {Promise<{ locked: boolean, result?: any }>}
 */
export async function withCollectorLock(pool, fn) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query("SELECT pg_try_advisory_lock($1) AS acquired", [ADVISORY_LOCK_ID]);
    if (rows[0]?.acquired !== true) return { locked: false };
    try {
      return { locked: true, result: await fn() };
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_ID]).catch((err) => {
        console.warn("[traffic-collector] Aviso ao soltar a trava:", err?.message || err);
      });
    }
  } finally {
    client.release();
  }
}

export function createTrafficCollectorScheduler({
  pool = pgDatabasePool,
  runner = runTrafficCollection,
  enabled,
  tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
} = {}) {
  let timer = null;
  let lastAttemptedSlotKey = null;
  let running = false;

  async function tick({ now = new Date(), enabled: callEnabled = enabled } = {}) {
    const isEnabled = callEnabled !== undefined ? callEnabled : isTrafficCollectorEnabled();
    if (!isEnabled) return { ran: false, reason: "SCHEDULE_DISABLED" };
    if (!pool) return { ran: false, reason: "NO_DATABASE" };

    const slot = resolveScheduledSlot(now);
    if (!slot) return { ran: false, reason: "NOT_SCHEDULED_TIME" };
    if (lastAttemptedSlotKey === slot.slotKey) return { ran: false, reason: "SLOT_ALREADY_ATTEMPTED", slotKey: slot.slotKey };
    if (running) return { ran: false, reason: "ALREADY_RUNNING", slotKey: slot.slotKey };

    lastAttemptedSlotKey = slot.slotKey;
    running = true;
    try {
      const outcome = await withCollectorLock(pool, () => runner({ pool, now }));
      if (!outcome.locked) return { ran: false, reason: "CONCURRENT_LOCK_HELD", slotKey: slot.slotKey };

      const meta = outcome.result?.meta;
      console.log(
        `[traffic-collector] Slot ${slot.slotKey}: Meta ${
          meta?.connected ? `${meta.ok} conta(s) ok, ${meta.failed} com falha` : "não conectada"
        }.`
      );
      return { ran: true, slotKey: slot.slotKey, summary: outcome.result };
    } catch (err) {
      console.error(`[traffic-collector] Falha no slot ${slot.slotKey}:`, err?.message || err);
      return { ran: true, slotKey: slot.slotKey, error: err?.message || String(err) };
    } finally {
      running = false;
    }
  }

  function start() {
    if (!isTrafficCollectorEnabled() && enabled !== true) {
      console.log(`[traffic-collector] Agendador DESATIVADO (${SCHEDULE_ENABLED_ENV} diferente de "true").`);
      return false;
    }
    if (timer) return true;

    console.log(
      `[traffic-collector] Agendador ATIVADO (${SCHEDULED_HOURS.map((h) => `${h}h00`).join(", ")}, fuso ${TIMEZONE}).`
    );
    timer = setInterval(() => {
      tick().catch((err) => console.error("[traffic-collector] Erro inesperado no tique:", err?.message || err));
    }, tickIntervalMs);
    if (timer.unref) timer.unref();
    return true;
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
      console.log("[traffic-collector] Agendador parado.");
    }
  }

  return { tick, start, stop };
}

let defaultScheduler = null;

export function startTrafficCollectorScheduler() {
  if (!defaultScheduler) defaultScheduler = createTrafficCollectorScheduler();
  return defaultScheduler.start();
}

export function stopTrafficCollectorScheduler() {
  if (defaultScheduler) defaultScheduler.stop();
}
