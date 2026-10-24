/**
 * trelloSlackScheduler.js
 * 
 * Agendador da auditoria operacional Trello → Slack para a Geração Digital & Vexo OS.
 * Dispara runTrelloDailyAudit nos horários 09h00 (morning) e 18h00 (evening),
 * de segunda a sexta-feira, estritamente no fuso horário nomeado "America/Sao_Paulo".
 * 
 * Regras Operacionais e Concorrência:
 * - Fuso explícito: America/Sao_Paulo (nunca deslocamento fixo em relação a UTC).
 * - Desligado por padrão: controlado pela env TRELLO_SLACK_SCHEDULE_ENABLED (default false).
 * - Trava contra execução dupla: advisory lock no Postgres + constraint UNIQUE em slot_key
 *   na tabela trello_slack_audit_runs, impedindo múltiplos envios durante zero-downtime deploy.
 * - Registro de cada execução: grava horário, modo (morning/evening), se enviou e histórico
 *   de erros detalhados em caso de falhas externas (Groq, Slack, Trello).
 */

import { runTrelloDailyAudit } from "./trelloSlackReporter.js";
import { pgDatabasePool } from "./database.js";

export const TIMEZONE = "America/Sao_Paulo";
export const SCHEDULE_ENABLED_ENV = "TRELLO_SLACK_SCHEDULE_ENABLED";
export const ADVISORY_LOCK_ID = 843355001; // ID fixo único para advisory lock do Trello Slack Scheduler
export const DEFAULT_TICK_INTERVAL_MS = 30_000; // Tick a cada 30 segundos

/**
 * Verifica se o agendador está habilitado via variável de ambiente.
 * Padrão rigoroso: false (desligado por padrão).
 */
export function isTrelloSlackScheduleEnabled() {
  return String(process.env[SCHEDULE_ENABLED_ENV] || "false").trim().toLowerCase() === "true";
}

/**
 * Extrai componentes de data e hora no fuso horário America/Sao_Paulo.
 * Garante compatibilidade independente do fuso da máquina/contêiner (ex: UTC).
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
 * Avalia se uma determinada data/hora corresponde a um slot de auditoria válido.
 * 
 * Regras:
 * - Não dispara aos fins de semana (Sat e Sun).
 * - Dispara às 09h00 (morning).
 * - Dispara às 18h00 (evening).
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
      slotKey: `${dateKey}:morning`,
      mode: "morning",
      dateKey,
      scheduledTime: "09:00",
      weekday: parts.weekday,
    };
  }

  // Slot Vespertino: 18h00
  if (parts.hour === "18" && parts.minute === "00") {
    return {
      slotKey: `${dateKey}:evening`,
      mode: "evening",
      dateKey,
      scheduledTime: "18:00",
      weekday: parts.weekday,
    };
  }

  return null;
}

/**
 * Implementação em memória da store de auditoria e controle de concorrência.
 * Usada em testes unitários e como fallback em ambientes sem banco configurado.
 */
export function createInMemoryAuditRunsStore() {
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
    async claimSlot({ slotKey, mode, scheduledTime }) {
      if (claimedSlots.has(slotKey)) {
        return { acquired: false, reason: "SLOT_ALREADY_CLAIMED" };
      }
      const runId = `mock-run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      claimedSlots.set(slotKey, {
        id: runId,
        slotKey,
        mode,
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
 * Store oficial Postgres para persistência e locking.
 * Grava na tabela public.trello_slack_audit_runs e adquire pg_try_advisory_lock.
 */
export function createPostgresAuditRunsStore(pool = pgDatabasePool) {
  if (!pool) {
    return createInMemoryAuditRunsStore();
  }

  return {
    isInMemory: false,
    async tryAdvisoryLock() {
      try {
        const { rows } = await pool.query("SELECT pg_try_advisory_lock($1) AS acquired", [ADVISORY_LOCK_ID]);
        return rows[0]?.acquired === true;
      } catch (err) {
        console.warn("[trello-slack-scheduler] Aviso ao tentar advisory lock no Postgres:", err?.message || err);
        return false;
      }
    },
    async releaseAdvisoryLock() {
      try {
        await pool.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_ID]);
        return true;
      } catch (err) {
        console.warn("[trello-slack-scheduler] Aviso ao liberar advisory lock no Postgres:", err?.message || err);
        return false;
      }
    },
    async claimSlot({ slotKey, mode, scheduledTime }) {
      try {
        const sql = `
          INSERT INTO public.trello_slack_audit_runs (slot_key, mode, scheduled_for, status, executed_at)
          VALUES ($1, $2, $3, 'running', NOW())
          ON CONFLICT (slot_key) DO NOTHING
          RETURNING id;
        `;
        const { rows } = await pool.query(sql, [slotKey, mode, scheduledTime]);
        if (rows && rows.length > 0) {
          return { acquired: true, runId: rows[0].id };
        }
        return { acquired: false, reason: "SLOT_ALREADY_CLAIMED" };
      } catch (err) {
        console.error("[trello-slack-scheduler] Erro ao registrar claim de slot no Postgres:", err);
        return { acquired: false, reason: "DATABASE_ERROR", error: err?.message };
      }
    },
    async recordSuccess({ runId, reportSummary }) {
      try {
        await pool.query(
          `UPDATE public.trello_slack_audit_runs
           SET status = 'success', sent = true, report_summary = $1, updated_at = NOW()
           WHERE id = $2`,
          [JSON.stringify(reportSummary || {}), runId]
        );
      } catch (err) {
        console.error("[trello-slack-scheduler] Erro ao atualizar status de sucesso no Postgres:", err);
      }
    },
    async recordFailure({ runId, error }) {
      try {
        const errorMsg = error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error);
        await pool.query(
          `UPDATE public.trello_slack_audit_runs
           SET status = 'failed', sent = false, error = $1, updated_at = NOW()
           WHERE id = $2`,
          [errorMsg, runId]
        );
      } catch (err) {
        console.error("[trello-slack-scheduler] Erro ao atualizar status de falha no Postgres:", err);
      }
    },
  };
}

let activeStore = null;

export function getDefaultAuditRunsStore() {
  if (!activeStore) {
    activeStore = pgDatabasePool
      ? createPostgresAuditRunsStore(pgDatabasePool)
      : createInMemoryAuditRunsStore();
  }
  return activeStore;
}

export function setDefaultAuditRunsStoreForTest(store) {
  activeStore = store;
}

/**
 * Executa a auditoria de um slot com trava de concorrência e registro de auditoria.
 */
export async function executeScheduledSlot({
  slot,
  store = getDefaultAuditRunsStore(),
  auditRunner = runTrelloDailyAudit,
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

    // 2. Tenta fazer o claim atômico do slot no banco
    const claim = await store.claimSlot({
      slotKey: slot.slotKey,
      mode: slot.mode,
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

    // 3. Executa a auditoria chamando diretamente o serviço em memória
    const runId = claim.runId;
    try {
      const result = await auditRunner({
        mode: slot.mode,
        dryRun,
      });

      await store.recordSuccess({
        runId,
        reportSummary: result?.summary || {},
      });

      console.log(
        `[trello-slack-scheduler] Boletim ${slot.mode} executado e enviado com sucesso ao Slack (${slot.slotKey}).`
      );

      return {
        executed: true,
        success: true,
        runId,
        slotKey: slot.slotKey,
        mode: slot.mode,
        result,
      };
    } catch (auditError) {
      await store.recordFailure({
        runId,
        error: auditError,
      });

      console.error(
        `[trello-slack-scheduler] FALHA ao executar auditoria Trello -> Slack para o slot ${slot.slotKey}:`,
        auditError
      );

      return {
        executed: true,
        success: false,
        runId,
        slotKey: slot.slotKey,
        mode: slot.mode,
        error: auditError?.message || String(auditError),
      };
    }
  } finally {
    if (hasAdvisoryLock) {
      await store.releaseAdvisoryLock();
    }
  }
}

/**
 * Factory para criar instâncias do agendador.
 * Permite desacoplar estado local entre contêineres/instâncias em testes de concorrência.
 */
export function createTrelloSlackScheduler({
  store = getDefaultAuditRunsStore(),
  auditRunner = runTrelloDailyAudit,
  enabled,
  tickIntervalMs = DEFAULT_TICK_INTERVAL_MS,
} = {}) {
  let timer = null;
  let lastAttemptedSlotKey = null;

  async function tick({
    now = new Date(),
    dryRun = false,
    store: callStore = store,
    auditRunner: callAuditRunner = auditRunner,
    enabled: callEnabled = enabled !== undefined ? enabled : isTrelloSlackScheduleEnabled(),
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
      auditRunner: callAuditRunner,
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
      : (enabled !== undefined ? enabled : isTrelloSlackScheduleEnabled());

    if (!isEnabled) {
      console.log(
        `[trello-slack-scheduler] Agendador Trello -> Slack DESLIGADO por padrão (${SCHEDULE_ENABLED_ENV} !== true).`
      );
      return false;
    }

    if (timer) {
      return true;
    }

    const interval = startOptions.tickIntervalMs || tickIntervalMs;

    console.log(
      `[trello-slack-scheduler] Agendador ATIVADO (09h00 e 18h00, Seg a Sex, fuso ${TIMEZONE}). Intervalo de tick: ${interval}ms.`
    );

    timer = setInterval(() => {
      tick({
        store: startOptions.store || store,
        auditRunner: startOptions.auditRunner || auditRunner,
      }).catch((err) => {
        console.error("[trello-slack-scheduler] Erro inesperado no tick do agendador:", err);
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
      console.log("[trello-slack-scheduler] Agendador parado.");
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

export function getDefaultTrelloSlackScheduler() {
  if (!defaultSchedulerInstance) {
    defaultSchedulerInstance = createTrelloSlackScheduler();
  }
  return defaultSchedulerInstance;
}

export function resetSchedulerMemoryForTest() {
  if (defaultSchedulerInstance) {
    defaultSchedulerInstance.reset();
  }
  defaultSchedulerInstance = null;
}

/**
 * Tique do agendador singleton padrão: chamado periodicamente.
 */
export async function tickTrelloSlackScheduler(options = {}) {
  return getDefaultTrelloSlackScheduler().tick(options);
}

/**
 * Inicia o timer em segundo plano do agendador Trello → Slack.
 * Respeita TRELLO_SLACK_SCHEDULE_ENABLED (desligado por padrão).
 */
export function startTrelloSlackScheduler(options = {}) {
  return getDefaultTrelloSlackScheduler().start(options);
}

/**
 * Interrompe o agendador gracioso para shutdown.
 */
export function stopTrelloSlackScheduler() {
  if (defaultSchedulerInstance) {
    defaultSchedulerInstance.stop();
  }
}
