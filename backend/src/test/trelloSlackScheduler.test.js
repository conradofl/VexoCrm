import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  TIMEZONE,
  SCHEDULE_ENABLED_ENV,
  isTrelloSlackScheduleEnabled,
  getZonedDateParts,
  resolveScheduledSlot,
  createInMemoryAuditRunsStore,
  createTrelloSlackScheduler,
  executeScheduledSlot,
  tickTrelloSlackScheduler,
  startTrelloSlackScheduler,
  stopTrelloSlackScheduler,
  resetSchedulerMemoryForTest,
  setDefaultAuditRunsStoreForTest,
} from "../services/trelloSlackScheduler.js";

describe("Trello Slack Scheduler - Agendador e Trava de Concorrência", () => {
  const originalEnv = process.env[SCHEDULE_ENABLED_ENV];

  beforeEach(() => {
    resetSchedulerMemoryForTest();
    stopTrelloSlackScheduler();
    process.env[SCHEDULE_ENABLED_ENV] = "true";
  });

  afterEach(() => {
    stopTrelloSlackScheduler();
    if (originalEnv === undefined) {
      delete process.env[SCHEDULE_ENABLED_ENV];
    } else {
      process.env[SCHEDULE_ENABLED_ENV] = originalEnv;
    }
  });

  describe("1. Relógio Falso em America/Sao_Paulo (Fuso Explícito)", () => {
    it("deve disparar o boletim matinal (morning) exatamente às 09h00 de segunda a sexta", async () => {
      // 2026-10-26 é uma Segunda-feira
      // 09h00 em America/Sao_Paulo (UTC-3) = 12h00 UTC
      const monday0900SP = new Date("2026-10-26T12:00:00Z");

      const parts = getZonedDateParts(monday0900SP, TIMEZONE);
      expect(parts.weekday).toBe("Mon");
      expect(parts.hour).toBe("09");
      expect(parts.minute).toBe("00");

      const slot = resolveScheduledSlot(monday0900SP, TIMEZONE);
      expect(slot).not.toBeNull();
      expect(slot?.mode).toBe("morning");
      expect(slot?.scheduledTime).toBe("09:00");
      expect(slot?.slotKey).toBe("2026-10-26:morning");

      const store = createInMemoryAuditRunsStore();
      const mockAuditRunner = vi.fn().mockResolvedValue({
        success: true,
        dryRun: false,
        summary: { totalOpen: 5 },
      });

      const res = await tickTrelloSlackScheduler({
        now: monday0900SP,
        store,
        auditRunner: mockAuditRunner,
        enabled: true,
      });

      expect(res.ran).toBe(true);
      expect(res.success).toBe(true);
      expect(res.mode).toBe("morning");
      expect(mockAuditRunner).toHaveBeenCalledTimes(1);
      expect(mockAuditRunner).toHaveBeenCalledWith({ mode: "morning", dryRun: false });

      // Verifica o registro estruturado na store
      const runs = store.getRuns();
      expect(runs.length).toBe(1);
      expect(runs[0].status).toBe("success");
      expect(runs[0].sent).toBe(true);
      expect(runs[0].mode).toBe("morning");
    });

    it("deve disparar o boletim vespertino (evening) exatamente às 18h00 de segunda a sexta", async () => {
      // 2026-10-27 é uma Terça-feira
      // 18h00 em America/Sao_Paulo (UTC-3) = 21h00 UTC
      const tuesday1800SP = new Date("2026-10-27T21:00:00Z");

      const parts = getZonedDateParts(tuesday1800SP, TIMEZONE);
      expect(parts.weekday).toBe("Tue");
      expect(parts.hour).toBe("18");
      expect(parts.minute).toBe("00");

      const slot = resolveScheduledSlot(tuesday1800SP, TIMEZONE);
      expect(slot).not.toBeNull();
      expect(slot?.mode).toBe("evening");
      expect(slot?.scheduledTime).toBe("18:00");
      expect(slot?.slotKey).toBe("2026-10-27:evening");

      const store = createInMemoryAuditRunsStore();
      const mockAuditRunner = vi.fn().mockResolvedValue({
        success: true,
        dryRun: false,
        summary: { completed: 8 },
      });

      const res = await tickTrelloSlackScheduler({
        now: tuesday1800SP,
        store,
        auditRunner: mockAuditRunner,
        enabled: true,
      });

      expect(res.ran).toBe(true);
      expect(res.success).toBe(true);
      expect(res.mode).toBe("evening");
      expect(mockAuditRunner).toHaveBeenCalledTimes(1);
      expect(mockAuditRunner).toHaveBeenCalledWith({ mode: "evening", dryRun: false });
    });

    it("não deve disparar em horários fora de 09h00 ou 18h00", async () => {
      const store = createInMemoryAuditRunsStore();
      const mockAuditRunner = vi.fn();

      const invalidTimes = [
        new Date("2026-10-26T11:59:00Z"), // 08h59 SP
        new Date("2026-10-26T12:01:00Z"), // 09h01 SP
        new Date("2026-10-26T17:30:00Z"), // 14h30 SP
        new Date("2026-10-26T20:59:00Z"), // 17h59 SP
        new Date("2026-10-26T21:01:00Z"), // 18h01 SP
      ];

      for (const time of invalidTimes) {
        const slot = resolveScheduledSlot(time, TIMEZONE);
        expect(slot).toBeNull();

        const res = await tickTrelloSlackScheduler({
          now: time,
          store,
          auditRunner: mockAuditRunner,
          enabled: true,
        });

        expect(res.ran).toBe(false);
        expect(res.reason).toBe("NOT_SCHEDULED_TIME");
      }

      expect(mockAuditRunner).not.toHaveBeenCalled();
    });
  });

  describe("2. Fim de Semana (Não Dispara Sábado nem Domingo)", () => {
    it("não deve disparar no sábado nem às 09h00 nem às 18h00", async () => {
      // 2026-10-24 é Sábado
      const saturday0900 = new Date("2026-10-24T12:00:00Z"); // 09h00 SP
      const saturday1800 = new Date("2026-10-24T21:00:00Z"); // 18h00 SP

      expect(getZonedDateParts(saturday0900).weekday).toBe("Sat");
      expect(getZonedDateParts(saturday1800).weekday).toBe("Sat");

      expect(resolveScheduledSlot(saturday0900)).toBeNull();
      expect(resolveScheduledSlot(saturday1800)).toBeNull();

      const store = createInMemoryAuditRunsStore();
      const mockAuditRunner = vi.fn();

      const res09 = await tickTrelloSlackScheduler({
        now: saturday0900,
        store,
        auditRunner: mockAuditRunner,
        enabled: true,
      });

      const res18 = await tickTrelloSlackScheduler({
        now: saturday1800,
        store,
        auditRunner: mockAuditRunner,
        enabled: true,
      });

      expect(res09.ran).toBe(false);
      expect(res18.ran).toBe(false);
      expect(mockAuditRunner).not.toHaveBeenCalled();
    });

    it("não deve disparar no domingo nem às 09h00 nem às 18h00", async () => {
      // 2026-10-25 é Domingo
      const sunday0900 = new Date("2026-10-25T12:00:00Z"); // 09h00 SP
      const sunday1800 = new Date("2026-10-25T21:00:00Z"); // 18h00 SP

      expect(getZonedDateParts(sunday0900).weekday).toBe("Sun");
      expect(getZonedDateParts(sunday1800).weekday).toBe("Sun");

      expect(resolveScheduledSlot(sunday0900)).toBeNull();
      expect(resolveScheduledSlot(sunday1800)).toBeNull();

      const store = createInMemoryAuditRunsStore();
      const mockAuditRunner = vi.fn();

      const res09 = await tickTrelloSlackScheduler({
        now: sunday0900,
        store,
        auditRunner: mockAuditRunner,
        enabled: true,
      });

      const res18 = await tickTrelloSlackScheduler({
        now: sunday1800,
        store,
        auditRunner: mockAuditRunner,
        enabled: true,
      });

      expect(res09.ran).toBe(false);
      expect(res18.ran).toBe(false);
      expect(mockAuditRunner).not.toHaveBeenCalled();
    });
  });

  describe("3. Desligado por Padrão (TRELLO_SLACK_SCHEDULE_ENABLED)", () => {
    it("com TRELLO_SLACK_SCHEDULE_ENABLED ausente, não deve agendar nem rodar nada", async () => {
      delete process.env[SCHEDULE_ENABLED_ENV];

      expect(isTrelloSlackScheduleEnabled()).toBe(false);

      const started = startTrelloSlackScheduler();
      expect(started).toBe(false);

      const store = createInMemoryAuditRunsStore();
      const mockAuditRunner = vi.fn();
      const monday0900 = new Date("2026-10-26T12:00:00Z");

      const res = await tickTrelloSlackScheduler({
        now: monday0900,
        store,
        auditRunner: mockAuditRunner,
        // sem forçar enabled, ele lê isTrelloSlackScheduleEnabled()
      });

      expect(res.ran).toBe(false);
      expect(res.reason).toBe("SCHEDULE_DISABLED");
      expect(mockAuditRunner).not.toHaveBeenCalled();
    });

    it("com TRELLO_SLACK_SCHEDULE_ENABLED='false', não deve agendar nem rodar nada", async () => {
      process.env[SCHEDULE_ENABLED_ENV] = "false";

      expect(isTrelloSlackScheduleEnabled()).toBe(false);

      const started = startTrelloSlackScheduler();
      expect(started).toBe(false);

      const store = createInMemoryAuditRunsStore();
      const mockAuditRunner = vi.fn();
      const monday0900 = new Date("2026-10-26T12:00:00Z");

      const res = await tickTrelloSlackScheduler({
        now: monday0900,
        store,
        auditRunner: mockAuditRunner,
      });

      expect(res.ran).toBe(false);
      expect(res.reason).toBe("SCHEDULE_DISABLED");
      expect(mockAuditRunner).not.toHaveBeenCalled();
    });
  });

  describe("4. Trava Contra Execução Dupla (Zero-Downtime Deploy)", () => {
    it("duas instâncias do agendador na mesma janela de tempo devem resultar em exatamente 1 execução, não 2", async () => {
      // Compartilham a mesma store (simulando dois contêineres conectados ao mesmo Postgres)
      const sharedStore = createInMemoryAuditRunsStore();
      const mockAuditRunner = vi.fn().mockImplementation(async () => {
        // Simula pequeno delay de rede/processamento
        await new Promise((r) => setTimeout(r, 10));
        return {
          success: true,
          dryRun: false,
          summary: { totalOpen: 12 },
        };
      });

      const slotTime = new Date("2026-10-26T12:00:00Z"); // 09h00 SP

      // Instâncias independentes representando dois contêineres distintos no deploy
      const instanceA = createTrelloSlackScheduler({
        store: sharedStore,
        auditRunner: mockAuditRunner,
        enabled: true,
      });
      const instanceB = createTrelloSlackScheduler({
        store: sharedStore,
        auditRunner: mockAuditRunner,
        enabled: true,
      });

      // Dispara simultaneamente pelas duas instâncias de contêineres sem passar qualquer flag
      const [resInstanciaA, resInstanciaB] = await Promise.all([
        instanceA.tick({ now: slotTime }),
        instanceB.tick({ now: slotTime }),
      ]);

      // Exatamente 1 executou, a outra foi ignorada pela trava
      const executadas = [resInstanciaA, resInstanciaB].filter((r) => r.ran === true);
      const ignoradas = [resInstanciaA, resInstanciaB].filter((r) => r.ran === false);

      expect(executadas.length).toBe(1);
      expect(ignoradas.length).toBe(1);

      expect(executadas[0].success).toBe(true);
      expect(ignoradas[0].reason).toMatch(/SLOT_ALREADY_CLAIMED|CONCURRENT_LOCK_HELD/);

      // O serviço de auditoria foi invocado rigorosamente UMA ÚNICA VEZ
      expect(mockAuditRunner).toHaveBeenCalledTimes(1);

      // Apenas um registro persistido na base
      const runs = sharedStore.getRuns();
      expect(runs.length).toBe(1);
      expect(runs[0].status).toBe("success");
      expect(runs[0].sent).toBe(true);
    });

    it("duas instâncias disparadas sequencialmente no mesmo slot devem resultar em 1 execução e a segunda barrada por SLOT_ALREADY_CLAIMED", async () => {
      const sharedStore = createInMemoryAuditRunsStore();
      const mockAuditRunner = vi.fn().mockResolvedValue({
        success: true,
        summary: { total: 1 },
      });

      const slotTime = new Date("2026-10-26T12:00:15Z"); // 09h00 SP

      const instanceA = createTrelloSlackScheduler({
        store: sharedStore,
        auditRunner: mockAuditRunner,
        enabled: true,
      });
      const instanceB = createTrelloSlackScheduler({
        store: sharedStore,
        auditRunner: mockAuditRunner,
        enabled: true,
      });

      const resA = await instanceA.tick({ now: slotTime });
      const resB = await instanceB.tick({ now: slotTime });

      expect(resA.ran).toBe(true);
      expect(resB.ran).toBe(false);
      expect(resB.reason).toBe("SLOT_ALREADY_CLAIMED");
      expect(mockAuditRunner).toHaveBeenCalledTimes(1);
    });

    it("o caminho de produção usado pelo server.js aplica a trava de concorrência sem receber nenhuma bandeira", async () => {
      const sharedStore = createInMemoryAuditRunsStore();
      setDefaultAuditRunsStoreForTest(sharedStore);

      const mockAuditRunner = vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return {
          success: true,
          dryRun: false,
          summary: { totalOpen: 5 },
        };
      });

      const slotTime = new Date("2026-10-26T12:00:00Z"); // 09h00 SP

      // Ponto de entrada padrão tickTrelloSlackScheduler (sem nenhuma flag de lock, como no server.js)
      // Simula uma segunda instância em paralelo tentando executar o mesmo slot no mesmo store compartilhado
      const externalNode = createTrelloSlackScheduler({
        store: sharedStore,
        auditRunner: mockAuditRunner,
        enabled: true,
      });

      const [resServerJs, resExternalNode] = await Promise.all([
        tickTrelloSlackScheduler({
          now: slotTime,
          auditRunner: mockAuditRunner,
          enabled: true,
        }),
        externalNode.tick({
          now: slotTime,
        }),
      ]);

      const executadas = [resServerJs, resExternalNode].filter((r) => r.ran === true);
      const ignoradas = [resServerJs, resExternalNode].filter((r) => r.ran === false);

      expect(executadas.length).toBe(1);
      expect(ignoradas.length).toBe(1);
      expect(executadas[0].success).toBe(true);
      expect(ignoradas[0].reason).toMatch(/SLOT_ALREADY_CLAIMED|CONCURRENT_LOCK_HELD/);
      expect(mockAuditRunner).toHaveBeenCalledTimes(1);
    });

    it("se a execução falhar (ex: queda da Groq ou Slack), deve registrar o erro com status 'failed'", async () => {
      const store = createInMemoryAuditRunsStore();
      const mockFailingAuditRunner = vi.fn().mockRejectedValue(new Error("Groq API 503 Service Unavailable"));

      const slotTime = new Date("2026-10-26T12:00:00Z"); // 09h00 SP

      const res = await tickTrelloSlackScheduler({
        now: slotTime,
        store,
        auditRunner: mockFailingAuditRunner,
        enabled: true,
      });

      expect(res.ran).toBe(true);
      expect(res.success).toBe(false);
      expect(res.error).toContain("Groq API 503");

      const runs = store.getRuns();
      expect(runs.length).toBe(1);
      expect(runs[0].status).toBe("failed");
      expect(runs[0].sent).toBe(false);
      expect(runs[0].error.message).toContain("Groq API 503");
    });
  });
});
