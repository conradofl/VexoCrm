import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TIMEZONE,
  SCHEDULE_ENABLED_ENV,
  ADVISORY_LOCK_ID,
  isGdVigiaScheduleEnabled,
  getZonedDateParts,
  resolveScheduledSlot,
  createInMemoryVigiaRunsStore,
  createGdVigiaScheduler,
  executeScheduledSlot,
  tickGdVigiaScheduler,
  startGdVigiaScheduler,
  stopGdVigiaScheduler,
  resetGdVigiaSchedulerForTest,
  setDefaultVigiaRunsStoreForTest,
} from "../services/gdVigiaScheduler.js";

describe("GD Vigia Scheduler - Agendador e Trava de Concorrência", () => {
  const originalEnv = process.env[SCHEDULE_ENABLED_ENV];

  beforeEach(() => {
    resetGdVigiaSchedulerForTest();
    stopGdVigiaScheduler();
    process.env[SCHEDULE_ENABLED_ENV] = "true";
  });

  afterEach(() => {
    stopGdVigiaScheduler();
    if (originalEnv === undefined) {
      delete process.env[SCHEDULE_ENABLED_ENV];
    } else {
      process.env[SCHEDULE_ENABLED_ENV] = originalEnv;
    }
  });

  describe("1. Fuso Horário e Resolução de Slots (America/Sao_Paulo)", () => {
    it("deve disparar o Check-in Matinal às 09h00 de segunda a sexta", () => {
      // 2026-11-09 é uma Segunda-feira
      // 09h00 em America/Sao_Paulo (UTC-3) = 12h00 UTC
      const segunda0900SP = new Date("2026-11-09T12:00:00Z");

      const parts = getZonedDateParts(segunda0900SP, TIMEZONE);
      expect(parts.weekday).toBe("Mon");
      expect(parts.hour).toBe("09");
      expect(parts.minute).toBe("00");

      const slot = resolveScheduledSlot(segunda0900SP, TIMEZONE);
      expect(slot).not.toBeNull();
      expect(slot?.periodo).toBe("checkin");
      expect(slot?.scheduledTime).toBe("09:00");
      expect(slot?.slotKey).toBe("gd-vigia:2026-11-09:checkin");
    });

    it("deve disparar o Fechamento Operacional às 18h00 de segunda a sexta", () => {
      // 2026-11-13 é uma Sexta-feira
      // 18h00 em America/Sao_Paulo (UTC-3) = 21h00 UTC
      const sexta1800SP = new Date("2026-11-13T21:00:00Z");

      const parts = getZonedDateParts(sexta1800SP, TIMEZONE);
      expect(parts.weekday).toBe("Fri");
      expect(parts.hour).toBe("18");
      expect(parts.minute).toBe("00");

      const slot = resolveScheduledSlot(sexta1800SP, TIMEZONE);
      expect(slot).not.toBeNull();
      expect(slot?.periodo).toBe("fechamento");
      expect(slot?.scheduledTime).toBe("18:00");
      expect(slot?.slotKey).toBe("gd-vigia:2026-11-13:fechamento");
    });

    it("NÃO deve disparar aos fins de semana", () => {
      // Sábado 09h00
      const sabado0900 = new Date("2026-11-07T12:00:00Z");
      expect(resolveScheduledSlot(sabado0900, TIMEZONE)).toBeNull();

      // Domingo 18h00
      const domingo1800 = new Date("2026-11-08T21:00:00Z");
      expect(resolveScheduledSlot(domingo1800, TIMEZONE)).toBeNull();
    });

    it("NÃO deve disparar fora do minuto 00 (ex: 09h01 ou 18h30)", () => {
      const segunda0901 = new Date("2026-11-09T12:01:00Z");
      expect(resolveScheduledSlot(segunda0901, TIMEZONE)).toBeNull();

      const quarta1830 = new Date("2026-11-11T21:30:00Z");
      expect(resolveScheduledSlot(quarta1830, TIMEZONE)).toBeNull();
    });
  });

  describe("2. Desligado por Padrão (GD_VIGIA_SCHEDULE_ENABLED)", () => {
    it("com GD_VIGIA_SCHEDULE_ENABLED ausente, isGdVigiaScheduleEnabled() deve ser false", () => {
      delete process.env[SCHEDULE_ENABLED_ENV];
      expect(isGdVigiaScheduleEnabled()).toBe(false);
    });

    it("com GD_VIGIA_SCHEDULE_ENABLED='false', isGdVigiaScheduleEnabled() deve ser false", () => {
      process.env[SCHEDULE_ENABLED_ENV] = "false";
      expect(isGdVigiaScheduleEnabled()).toBe(false);
    });

    it("com GD_VIGIA_SCHEDULE_ENABLED='true', isGdVigiaScheduleEnabled() deve ser true", () => {
      process.env[SCHEDULE_ENABLED_ENV] = "true";
      expect(isGdVigiaScheduleEnabled()).toBe(true);
    });

    it("startGdVigiaScheduler não inicia timer quando disabled", () => {
      process.env[SCHEDULE_ENABLED_ENV] = "false";
      const started = startGdVigiaScheduler();
      expect(started).toBe(false);
    });

    it("tick recusa execução quando schedule estiver desabilitado", async () => {
      process.env[SCHEDULE_ENABLED_ENV] = "false";
      const scheduler = createGdVigiaScheduler();
      const res = await scheduler.tick({
        now: new Date("2026-11-09T12:00:00Z"),
      });
      expect(res.ran).toBe(false);
      expect(res.reason).toBe("SCHEDULE_DISABLED");
    });
  });

  describe("3. Execução de Slots e Trava de Concorrência", () => {
    it("executa o ciclo com o período correto e repassa dispatch=true", async () => {
      const runnerMock = vi.fn().mockResolvedValue({
        periodo: "checkin",
        relatorio: { resumo: { ativos: 22 } },
        despacho: { slack: { enviado: true }, whatsapp: { enviado: true } },
      });

      const store = createInMemoryVigiaRunsStore();
      const scheduler = createGdVigiaScheduler({
        store,
        runner: runnerMock,
        enabled: true,
      });

      const res = await scheduler.tick({
        now: new Date("2026-11-09T12:00:00Z"), // Seg 09h00 SP
        dryRun: false,
      });

      expect(res.ran).toBe(true);
      expect(res.success).toBe(true);
      expect(runnerMock).toHaveBeenCalledTimes(1);
      expect(runnerMock).toHaveBeenCalledWith({
        periodo: "checkin",
        dispatch: true,
      });
    });

    it("impede re-execução no mesmo minuto pelo mesmo processo local", async () => {
      const runnerMock = vi.fn().mockResolvedValue({
        periodo: "checkin",
        relatorio: { resumo: {} },
      });

      const store = createInMemoryVigiaRunsStore();
      const scheduler = createGdVigiaScheduler({
        store,
        runner: runnerMock,
        enabled: true,
      });

      const dataSlot = new Date("2026-11-09T12:00:00Z");

      // Primeiro tick
      const r1 = await scheduler.tick({ now: dataSlot });
      expect(r1.ran).toBe(true);
      expect(runnerMock).toHaveBeenCalledTimes(1);

      // Segundo tick no mesmo minuto
      const r2 = await scheduler.tick({ now: dataSlot });
      expect(r2.ran).toBe(false);
      expect(r2.reason).toBe("SLOT_ALREADY_ATTEMPTED_LOCALLY");
      expect(runnerMock).toHaveBeenCalledTimes(1);
    });

    it("se advisory lock estiver retido por outra instância, ignora graciosamente", async () => {
      const runnerMock = vi.fn();
      const store = createInMemoryVigiaRunsStore();

      // Simula outra instância segurando o advisory lock
      await store.tryAdvisoryLock();

      const scheduler = createGdVigiaScheduler({
        store,
        runner: runnerMock,
        enabled: true,
      });

      const res = await scheduler.tick({
        now: new Date("2026-11-09T12:00:00Z"),
      });

      expect(res.ran).toBe(false);
      expect(res.reason).toBe("CONCURRENT_LOCK_HELD");
      expect(runnerMock).not.toHaveBeenCalled();
    });

    it("se o slot já tiver sido executado por outra instância, registra como já executado", async () => {
      const runnerMock = vi.fn();
      const store = createInMemoryVigiaRunsStore();

      // Simula claim prévio feito por outra instância
      await store.claimSlot({
        slotKey: "gd-vigia:2026-11-09:checkin",
        periodo: "checkin",
        scheduledTime: "09:00",
      });

      const scheduler = createGdVigiaScheduler({
        store,
        runner: runnerMock,
        enabled: true,
      });

      const res = await scheduler.tick({
        now: new Date("2026-11-09T12:00:00Z"),
      });

      expect(res.ran).toBe(false);
      expect(res.reason).toBe("SLOT_ALREADY_CLAIMED");
      expect(runnerMock).not.toHaveBeenCalled();
    });

    it("registra falha caso o runner lance exceção sem quebrar o agendador", async () => {
      const runnerMock = vi.fn().mockRejectedValue(new Error("Falha na API externa"));
      const store = createInMemoryVigiaRunsStore();

      const scheduler = createGdVigiaScheduler({
        store,
        runner: runnerMock,
        enabled: true,
      });

      const res = await scheduler.tick({
        now: new Date("2026-11-09T12:00:00Z"),
      });

      expect(res.ran).toBe(true);
      expect(res.success).toBe(false);
      expect(res.error).toBe("Falha na API externa");

      const runs = store.getRuns();
      expect(runs).toHaveLength(1);
      expect(runs[0].status).toBe("failed");
    });
  });

  describe("4. Inicialização e Parada do Agendador (Lifecycle)", () => {
    it("inicia o agendador e para via stopGdVigiaScheduler", () => {
      process.env[SCHEDULE_ENABLED_ENV] = "true";
      const started = startGdVigiaScheduler({ tickIntervalMs: 60000 });
      expect(started).toBe(true);

      // Invocação repetida retorna true sem criar segundo timer
      expect(startGdVigiaScheduler()).toBe(true);

      // Parada
      stopGdVigiaScheduler();
    });
  });
});
