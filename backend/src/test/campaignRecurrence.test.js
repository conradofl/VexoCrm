import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  computeNextRecurrenceDate,
  parseRecurrenceTime,
  RECURRENCE_PATTERNS,
  WEEKDAY_NAMES,
} from "../services/campaignRecurrence.js";
import { getPartsInTimezone, createDateInTimezone } from "../services/sendWindow.js";

describe("Pilar 3: Campanhas Recorrentes — campaignRecurrence.js", () => {
  it("valida constantes e parsing de horário de recorrência", () => {
    expect(RECURRENCE_PATTERNS).toEqual(["monthly", "weekly", "biweekly"]);
    expect(WEEKDAY_NAMES[2]).toBe("Terça-feira");

    expect(parseRecurrenceTime("09:00")).toEqual({ hour: 9, minute: 0 });
    expect(parseRecurrenceTime("14:30")).toEqual({ hour: 14, minute: 30 });
    expect(parseRecurrenceTime(null)).toEqual({ hour: 9, minute: 0 });
    expect(parseRecurrenceTime("")).toEqual({ hour: 9, minute: 0 });
  });

  describe("Recorrência Mensal (ex: Aviso de Assembleia Ademicon - Todo dia 15)", () => {
    it("calcula exatamente o próximo mês: 15 de Outubro → 15 de Novembro", () => {
      // 15 de Outubro de 2026 às 09:00 em São Paulo
      const baseDate = createDateInTimezone(2026, 10, 15, 9, 0, 0, "America/Sao_Paulo");

      const nextDate = computeNextRecurrenceDate({
        pattern: "monthly",
        dayOfMonth: 15,
        timeStr: "09:00",
        fromDate: baseDate,
        timezone: "America/Sao_Paulo",
        forceNextCycle: true,
      });

      const parts = getPartsInTimezone(nextDate, "America/Sao_Paulo");
      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(11); // Novembro
      expect(parts.day).toBe(15);
      expect(parts.hour).toBe(9);
      expect(parts.minute).toBe(0);
    });

    it("avança de Dezembro para Janeiro do ano seguinte com segurança", () => {
      // 15 de Dezembro de 2026 às 09:00
      const baseDate = createDateInTimezone(2026, 12, 15, 9, 0, 0, "America/Sao_Paulo");

      const nextDate = computeNextRecurrenceDate({
        pattern: "monthly",
        dayOfMonth: 15,
        timeStr: "09:00",
        fromDate: baseDate,
        timezone: "America/Sao_Paulo",
        forceNextCycle: true,
      });

      const parts = getPartsInTimezone(nextDate, "America/Sao_Paulo");
      expect(parts.year).toBe(2027);
      expect(parts.month).toBe(1); // Janeiro
      expect(parts.day).toBe(15);
      expect(parts.hour).toBe(9);
    });

    it("trata meses mais curtos de forma segura (ex: dia 31 em Fevereiro → dia 28)", () => {
      // 31 de Janeiro de 2026 às 09:00 (2026 não é bissexto -> Fevereiro tem 28 dias)
      const baseDate = createDateInTimezone(2026, 1, 31, 9, 0, 0, "America/Sao_Paulo");

      const nextDate = computeNextRecurrenceDate({
        pattern: "monthly",
        dayOfMonth: 31,
        timeStr: "09:00",
        fromDate: baseDate,
        timezone: "America/Sao_Paulo",
        forceNextCycle: true,
      });

      const parts = getPartsInTimezone(nextDate, "America/Sao_Paulo");
      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(2); // Fevereiro
      expect(parts.day).toBe(28); // Limitado a 28 dias com segurança
      expect(parts.hour).toBe(9);
    });

    it("trata dia 31 em meses com 30 dias (ex: 31 de Outubro → 30 de Novembro)", () => {
      const baseDate = createDateInTimezone(2026, 10, 31, 10, 0, 0, "America/Sao_Paulo");

      const nextDate = computeNextRecurrenceDate({
        pattern: "monthly",
        dayOfMonth: 31,
        timeStr: "10:00",
        fromDate: baseDate,
        timezone: "America/Sao_Paulo",
        forceNextCycle: true,
      });

      const parts = getPartsInTimezone(nextDate, "America/Sao_Paulo");
      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(11); // Novembro
      expect(parts.day).toBe(30); // Novembro tem 30 dias
      expect(parts.hour).toBe(10);
    });

    it("agenda para o próprio mês se o dia ainda for futuro e não forçar próximo ciclo", () => {
      // 5 de Outubro às 08:00, alvo é dia 15 às 09:00
      const baseDate = createDateInTimezone(2026, 10, 5, 8, 0, 0, "America/Sao_Paulo");

      const nextDate = computeNextRecurrenceDate({
        pattern: "monthly",
        dayOfMonth: 15,
        timeStr: "09:00",
        fromDate: baseDate,
        timezone: "America/Sao_Paulo",
        forceNextCycle: false,
      });

      const parts = getPartsInTimezone(nextDate, "America/Sao_Paulo");
      expect(parts.month).toBe(10); // Próprio mês de Outubro
      expect(parts.day).toBe(15);
      expect(parts.hour).toBe(9);
    });
  });

  describe("Recorrência Semanal e Quinzenal (ex: Calendário Semanal da Via Permuta)", () => {
    it("semanal: se disparado na terça-feira às 10h, agenda a próxima terça-feira (+7 dias)", () => {
      // 06 de Outubro de 2026 é Terça-feira (weekday = 2)
      const terca = createDateInTimezone(2026, 10, 6, 10, 0, 0, "America/Sao_Paulo");

      const nextDate = computeNextRecurrenceDate({
        pattern: "weekly",
        dayOfWeek: 2, // Terça-feira
        timeStr: "10:00",
        fromDate: terca,
        timezone: "America/Sao_Paulo",
        forceNextCycle: true,
      });

      const parts = getPartsInTimezone(nextDate, "America/Sao_Paulo");
      expect(parts.year).toBe(2026);
      expect(parts.month).toBe(10);
      expect(parts.day).toBe(13); // 6 + 7 = 13 de Outubro (Terça-feira)
      expect(parts.weekday).toBe("tue");
      expect(parts.hour).toBe(10);
      expect(parts.minute).toBe(0);
    });

    it("quinzenal: se disparado na terça-feira às 10h, agenda para 14 dias depois", () => {
      const terca = createDateInTimezone(2026, 10, 6, 10, 0, 0, "America/Sao_Paulo");

      const nextDate = computeNextRecurrenceDate({
        pattern: "biweekly",
        dayOfWeek: 2, // Terça-feira
        timeStr: "10:00",
        fromDate: terca,
        timezone: "America/Sao_Paulo",
        forceNextCycle: true,
      });

      const parts = getPartsInTimezone(nextDate, "America/Sao_Paulo");
      expect(parts.day).toBe(20); // 6 + 14 = 20 de Outubro
      expect(parts.weekday).toBe("tue");
      expect(parts.hour).toBe(10);
    });

    it("se configurado em um domingo, encontra a próxima terça-feira", () => {
      // 04 de Outubro de 2026 é Domingo (weekday = 0)
      const domingo = createDateInTimezone(2026, 10, 4, 18, 0, 0, "America/Sao_Paulo");

      const nextDate = computeNextRecurrenceDate({
        pattern: "weekly",
        dayOfWeek: 2, // Terça-feira
        timeStr: "10:00",
        fromDate: domingo,
        timezone: "America/Sao_Paulo",
      });

      const parts = getPartsInTimezone(nextDate, "America/Sao_Paulo");
      expect(parts.day).toBe(6); // 6 de Outubro é a próxima Terça
      expect(parts.weekday).toBe("tue");
      expect(parts.hour).toBe(10);
    });
  });
});

describe("Pilar 3: Scheduler e Reagendamento Automático de Campanhas Recorrentes", () => {
  it("ao concluir disparo no scheduler, campanha recorrente é atualizada com scheduled_for e last_triggered_at = null", async () => {
    const { runDueCampaignDispatches } = await import("../campaign/scheduler.js");

    const executedCampaigns = [];
    const updatedCampaigns = [];

    // Mock do Supabase
    const mockSupabase = {
      from: vi.fn((table) => {
        if (table === "campaigns") {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            lte: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockImplementation(() =>
              Promise.resolve({
                data: [
                  {
                    id: "camp-recorrente-1",
                    name: "Assembleia Ademicon",
                    client_id: "ademicon-tenant",
                    status: "active",
                    scheduled_for: "2026-10-15T12:00:00.000Z",
                    last_triggered_at: null,
                    is_recurring: true,
                    recurrence_pattern: "monthly",
                    recurrence_day_of_month: 15,
                    recurrence_time: "09:00",
                  },
                ],
                error: null,
              })
            ),
            update: vi.fn((updates) => {
              updatedCampaigns.push(updates);
              return {
                eq: vi.fn().mockResolvedValue({ data: null, error: null }),
              };
            }),
          };
        }
        return { select: vi.fn().mockReturnThis() };
      }),
    };

    // Temporariamente substitui supabase
    const dbModule = await import("../services/database.js");
    const originalSupabase = dbModule.supabase;
    Object.defineProperty(dbModule, "supabase", { value: mockSupabase, configurable: true });

    // Mock de executeCampaignDispatch
    const dispatchModule = await import("../campaign/dispatch.js");
    const spyDispatch = vi.spyOn(dispatchModule, "executeCampaignDispatch").mockImplementation(async (c) => {
      executedCampaigns.push(c.id);
      return { total: 10, sent: 10, failed: 0 };
    });

    try {
      const result = await runDueCampaignDispatches({ limit: 10, triggerSource: "test_scheduler" });

      expect(result.success).toBe(true);
      expect(result.processed).toBe(1);
      expect(result.sent).toBe(1);
      expect(executedCampaigns).toContain("camp-recorrente-1");

      // Verifica se o update de reagendamento foi acionado para a campanha recorrente
      expect(updatedCampaigns.length).toBeGreaterThan(0);
      const recurrenceUpdate = updatedCampaigns.find((u) => u.last_triggered_at === null && u.status === "active");
      expect(recurrenceUpdate).toBeDefined();
      expect(recurrenceUpdate.scheduled_for).toBeTruthy();
      expect(recurrenceUpdate.next_run_at).toBeTruthy();
      expect(recurrenceUpdate.status).toBe("active");
      expect(recurrenceUpdate.last_triggered_at).toBeNull();
    } finally {
      spyDispatch.mockRestore();
      Object.defineProperty(dbModule, "supabase", { value: originalSupabase, configurable: true });
    }
  });
});
