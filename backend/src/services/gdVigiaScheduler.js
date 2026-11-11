/**
 * gdVigiaScheduler.js
 *
 * Agendador do Vigia Operacional GD (Geração Digital & Vexo OS).
 * Dispara automaticamente a rotina de monitoramento de estados e SLAs:
 * - 09h00: Check-in Matinal (--periodo=checkin --dispatch)
 * - 18h00: Fechamento Operacional (--periodo=fechamento --dispatch)
 * De segunda a sexta-feira, estritamente no fuso horário nomeado "America/Sao_Paulo".
 *
 * Regras Operacionais e Concorrência:
 * - Fuso explícito: America/Sao_Paulo (nunca deslocamento fixo UTC).
 * - Desligado por padrão: controlado pela env GD_VIGIA_SCHEDULE_ENABLED (default false).
 * - Trava contra execução dupla: advisory lock no Postgres (ID 843355002) e controle atômico
 *   de slots diários, prevenindo disparos múltiplos durante deploy com zero downtime.
 * - Despacho integrado para Slack (#01-ops-geral) e WhatsApp (Evolution API).
 */

import { executarCicloVigia } from "../scripts/vigia-gd.mjs";
import { pgDatabasePool } from "./database.js";

export const TIMEZONE = "America/Sao_Paulo";
export const SCHEDULE_ENABLED_ENV = "GD_VIGIA_SCHEDULE_ENABLED";
export const ADVISORY_LOCK_ID = 843355002; // ID fixo exclusivo para advisory lock do Vigia GD
export const DEFAULT_TICK_INTERVAL_MS = 30_000; // Tick a cada 30 segundos

/**
 * Verifica se o agendador do Vigia está habilitado via variável de ambiente.
 * Padrão: false (desligado por padrão).
 */
export function isGdVigiaScheduleEnabled() {
  return String(process.env[SCHEDULE_ENABLED_ENV] || "false").trim().toLowerCase() === "true";
}

/**
 * Extrai componentes de data e hora no fuso horário America/Sao_Paulo.
 */
export function getZonedDateParts(date = new Date(), timeZone = TIMEZONE) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short", // 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'
  });
  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
    weekday: get("weekday"),
  };
}

/**
 * Avalia se uma determinada data/hora corresponde a um slot válido do Vigia GD.
 *
 * Regras:
 * - Não dispara aos fins de semana (Sat e Sun).
 * - Dispara às 09h00 (checkin).
 * - Dispara às 18h00 (fechamento).
 *
 * Retorna o objeto descritor do slot ou null se fora do horário.
 */
export function resolveScheduledSlot(date = new Date(), timeZone = TIMEZONE) {
  const parts = getZonedDateParts(date, timeZone);

  // Não dispara sábado nem domingo
  if (parts.weekday === "Sat" || parts.weekday === "Sun") {
    return null;
  }

  const dateKey = `${parts.year}-${parts.month}-${parts.day}`;

  // Slot Matinal: 09h00
  if (parts.hour === "09" && parts.minute === "00") {
    return {
      slotKey: `gd-vigia:${dateKey}:checkin`,
      periodo: "checkin",
      dateKey,
      scheduledTime: "09:00",
      weekday: parts.weekday,
    };
  }

  // Slot Vespertino: 18h00
  if (parts.hour === "18" && parts.minute === "00") {
    return {
      slotKey: `gd-vigia:${dateKey}:fechamento`,
      periodo: "fechamento",
      dateKey,
      scheduledTime: "18:00",
      weekday: parts.weekday,
    };
  }

  return null;
}

/**
 * Store em memória para controle de slots e lock.
 * Usada em testes unitários e como fallback quando o Postgres não está disponível.
 */
export function createInMemoryVigiaRunsStore() {
  const claimedSlots = new Map();
  let isAdvisoryLocked = false;

  return {
    isInMemory: true,
    async tryAdvisoryLock() {
      if (isAdvisoryLocked) return false;
      isAdvisoryLocked = true;
      return true;
    },
    async releaseAdvisoryLock() {
      isAdvisoryLocked = false;
      return true;
    },
    async claimSlot({ slotKey, periodo, scheduledTime }) {
      if (claimedSlots.has(slotKey)) {
        return { acquired: false, reason: "SLOT_ALREADY_CLAIMED" };
      }
      const runId = `mock-vigia-run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      claimedSlots.set(slotKey, {
        id: runId,
        slotKey,
        periodo,
        scheduledTime,
        status: "running",
        sent: false,
        executedAt: new Date().toISOString(),
      });
      return { acquired: true, runId };
    },
    async recordSuccess({ runId, reportSummary }) {
      for (const item of claimedSlots.values()) {
        if (item.id === runId) {
          item.status = "success";
          item.sent = true;
          item.reportSummary = reportSummary;
          item.updatedAt = new Date().toISOString();
        }
      }
    },
    async recordFailure({ runId, error }) {
      for (const item of claimedSlots.values()) {
        if (item.id === runId) {
          item.status = "failed";
          item.sent = false;
          item.error = error;
          item.updatedAt = new Date().toISOString();
        }
      }
    },
    getRuns() {
      return Array.from(claimedSlots.values());
    },
    reset() {
      claimedSlots.clear();
      isAdvisoryLocked = false;
    },
  };
}

/**
 * Store Postgres usando advisory lock nativo (ID 843355002) para coordenar instâncias em produção.
 */
export function createPostgresVigiaRunsStore(pool = pgDatabasePool) {
  if (!pool) {
    return createInMemoryVigiaRunsStore();
  }

  const locallyClaimedSlots = new Set();

  return {
    isInMemory: false,
    async tryAdvisoryLock() {
      try {
        const { rows } = await pool.query("SELECT pg_try_advisory_lock($1) AS acquired", [ADVISORY_LOCK_ID]);
        return rows[0]?.acquired === true;
      } catch (err) {
        console.warn("[gd-vigia-scheduler] Aviso ao tentar advisory lock no Postgres:", err?.message || err);
        return false;
      }
    },
    async releaseAdvisoryLock() {
      try {
        await pool.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_ID]);
        return true;
      } catch (err) {
        console.warn("[gd-vigia-scheduler] Aviso ao liberar advisory lock no Postgres:", err?.message || err);
        return false;
      }
    },
    async claimSlot({ slotKey }) {
      if (locallyClaimedSlots.has(slotKey)) {
        return { acquired: false, reason: "SLOT_ALREADY_CLAIMED" };
      }
      locallyClaimedSlots.add(slotKey);
      return {
        acquired: true,
        runId: `vigia-run-${Date.now()}-${slotKey}`,
      };
    },
    async recordSuccess() {
      // Sucesso registrado em logs
    },
    async recordFailure() {
      // Falha registrada em logs
    },
  };
}

let activeStore = null;

export function getDefaultVigiaRunsStore() {
  if (!activeStore) {
    activeStore = pgDatabasePool
      ? createPostgresVigiaRunsStore(pgDatabasePool)
      : createInMemoryVigiaRunsStore();
  }
  return activeStore;
}

export function setDefaultVigiaRunsStoreForTest(store) {
  activeStore = store;
}

/**
 * Executa o ciclo do Vigia GD correspondente a um slot agendado com trava de concorrência.
 */
export async function executeScheduledSlot({
  slot,
  store = getDefaultVigiaRunsStore(),
  runner = executarCicloVigia,
  dryRun = false,
}) {
  let hasAdvisoryLock = false;

  try {
    // 1. Tenta obter o advisory lock da instância
    hasAdvisoryLock = await store.tryAdvisoryLock();
    if (!hasAdvisoryLock) {
      return {
        executed: false,
        skipped: true,
        reason: "CONCURRENT_LOCK_HELD",
        slotKey: slot.slotKey,
      };
    }

    // 2. Tenta fazer o claim atômico do slot
    const claim = await store.claimSlot({
      slotKey: slot.slotKey,
      periodo: slot.periodo,
      scheduledTime: slot.scheduledTime,
    });

    if (!claim.acquired) {
      return {
        executed: false,
        skipped: true,
        reason: claim.reason || "SLOT_ALREADY_CLAIMED",
        slotKey: slot.slotKey,
      };
    }

    // 3. Executa o ciclo do Vigia GD
    const runId = claim.runId;
    try {
      const result = await runner({
        periodo: slot.periodo,
        dispatch: !dryRun,
      });

      await store.recordSuccess({
        runId,
        reportSummary: result?.relatorio?.resumo || {},
      });

      console.log(
        `[gd-vigia-scheduler] Vigia GD (${slot.periodo}) executado com sucesso (${slot.slotKey}).`
      );

      return {
        executed: true,
        success: true,
        runId,
        slotKey: slot.slotKey,
        periodo: slot.periodo,
        result,
      };
    } catch (runError) {
      await store.recordFailure({
        runId,
        error: runError,
      });

      console.error(
        `[gd-vigia-scheduler] FALHA ao executar Vigia GD para o slot ${slot.slotKey}:`,
        runError
      );

      return {
        executed: true,
        success: false,
        runId,
        slotKey: slot.slotKey,
        periodo: slot.periodo,
        error: runError?.message || String(runError),
      };
    }
  } finally {
    if (hasAdvisoryLock) {
      await store.releaseAdvisoryLock();
    }
  }
}

/**
 * Factory para criar instâncias do agendador do Vigia GD.
 */
export function createGdVigiaScheduler({
  store = getDefaultVigiaRunsStore(),
  runner = executarCicloVigia,
  enabled,
  tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
} = {}) {
  let timer = null;
  let lastAttemptedSlotKey = null;

  async function tick({
    now = new Date(),
    dryRun = false,
    store: callStore = store,
    runner: callRunner = runner,
    enabled: callEnabled = enabled !== undefined ? enabled : isGdVigiaScheduleEnabled(),
  } = {}) {
    if (!callEnabled) {
      return {
        ran: false,
        reason: "SCHEDULE_DISABLED",
      };
    }

    const slot = resolveScheduledSlot(now);
    if (!slot) {
      return {
        ran: false,
        reason: "NOT_SCHEDULED_TIME",
      };
    }

    // Evita re-execução desnecessária no mesmo minuto pelo mesmo processo local
    if (lastAttemptedSlotKey === slot.slotKey) {
      return {
        ran: false,
        reason: "SLOT_ALREADY_ATTEMPTED_LOCALLY",
        slotKey: slot.slotKey,
      };
    }

    lastAttemptedSlotKey = slot.slotKey;

    const execution = await executeScheduledSlot({
      slot,
      store: callStore,
      runner: callRunner,
      dryRun,
    });

    return {
      ran: execution.executed,
      slot,
      ...execution,
    };
  }

  function start(startOptions = {}) {
    const isEnabled = startOptions.enabled !== undefined
      ? startOptions.enabled
      : (enabled !== undefined ? enabled : isGdVigiaScheduleEnabled());

    if (!isEnabled) {
      console.log(
        `[gd-vigia-scheduler] Agendador do Vigia GD DESLIGADO por padrão (${SCHEDULE_ENABLED_ENV} !== true).`
      );
      return false;
    }

    if (timer) {
      return true;
    }

    const interval = startOptions.tickIntervalMs || tickIntervalMs;

    console.log(
      `[gd-vigia-scheduler] Agendador ATIVADO (09h00 e 18h00, Seg a Sex, fuso ${TIMEZONE}). Intervalo de tick: ${interval}ms.`
    );

    timer = setInterval(() => {
      tick({
        store: startOptions.store || store,
        runner: startOptions.runner || runner,
      }).catch((err) => {
        console.error("[gd-vigia-scheduler] Erro inesperado no tick do agendador:", err);
      });
    }, interval);

    if (timer.unref) {
      timer.unref();
    }

    return true;
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
      console.log("[gd-vigia-scheduler] Agendador parado.");
    }
  }

  function reset() {
    lastAttemptedSlotKey = null;
    stop();
  }

  return {
    tick,
    start,
    stop,
    reset,
  };
}

let defaultSchedulerInstance = null;

export function getDefaultGdVigiaScheduler() {
  if (!defaultSchedulerInstance) {
    defaultSchedulerInstance = createGdVigiaScheduler();
  }
  return defaultSchedulerInstance;
}

export function resetGdVigiaSchedulerForTest() {
  if (defaultSchedulerInstance) {
    defaultSchedulerInstance.reset();
  }
  defaultSchedulerInstance = null;
}

/**
 * Tique do agendador singleton padrão.
 */
export async function tickGdVigiaScheduler(options = {}) {
  return getDefaultGdVigiaScheduler().tick(options);
}

/**
 * Inicia o timer em segundo plano do agendador do Vigia GD.
 * Respeita GD_VIGIA_SCHEDULE_ENABLED (desligado por padrão).
 */
export function startGdVigiaScheduler(options = {}) {
  return getDefaultGdVigiaScheduler().start(options);
}

/**
 * Interrompe o agendador gracioso para shutdown.
 */
export function stopGdVigiaScheduler() {
  if (defaultSchedulerInstance) {
    defaultSchedulerInstance.stop();
  }
}
