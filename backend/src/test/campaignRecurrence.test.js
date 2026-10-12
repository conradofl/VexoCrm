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
    expect(RECURRENCE_PATTERNS).toEqual(["daily", "monthly", "weekly", "biweekly"]);
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

describe("agendador antigo (runDueCampaignDispatches) não dispara campanha recorrente", () => {
  // A recorrência mora na fila (campaign_dispatches): cada ocorrência vira um lote. Se o caminho antigo também
  // disparasse, a mesma campanha sairia duas vezes para o mesmo público.
  it("[OBRIGATÓRIO] recorrente vencida com scheduled_for preenchido (dado antigo ou banco mexido à mão) NÃO é disparada nem reagendada", async () => {
    const { createPgliteDb } = await import("./helpers/pgliteDb.js");
    const { _setPgDatabasePoolForTesting } = await import("../services/database.js");
    const db = await createPgliteDb(`
      SET TimeZone = 'UTC';
      CREATE TABLE public.campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, client_id TEXT, import_id UUID, limit_per_run INT,
        webhook_url TEXT, webhook_token TEXT, status TEXT, scheduled_for TIMESTAMPTZ, last_triggered_at TIMESTAMPTZ,
        archived_at TIMESTAMPTZ, created_by_uid TEXT, created_by_email TEXT, analytics_meta JSONB DEFAULT '{}'::jsonb,
        is_recurring BOOLEAN DEFAULT false, recurrence_pattern TEXT, recurrence_day_of_month INT, recurrence_day_of_week INT,
        recurrence_time TEXT, next_run_at TIMESTAMPTZ
      );
      INSERT INTO public.campaigns (name, client_id, status, scheduled_for, is_recurring, recurrence_pattern, recurrence_day_of_month, recurrence_time)
      VALUES ('Assembleia', 't', 'active', now() - interval '1 hour', true, 'monthly', 15, '09:00');
    `);
    _setPgDatabasePoolForTesting({ query: (sql, params) => db.query(sql, params) });
    const dispatchModule = await import("../campaign/dispatch.js");
    const spy = vi.spyOn(dispatchModule, "executeCampaignDispatch").mockResolvedValue({ total: 1 });
    try {
      const { runDueCampaignDispatches } = await import("../campaign/scheduler.js");
      const result = await runDueCampaignDispatches({ limit: 10, triggerSource: "teste" });
      expect(result.processed).toBe(0);
      expect(spy).not.toHaveBeenCalled();
      const { rows } = await db.query("SELECT scheduled_for IS NOT NULL AS ainda_agendada, next_run_at FROM public.campaigns");
      expect(rows[0]).toEqual({ ainda_agendada: true, next_run_at: null }); // intocada: nada reagendado por aqui
    } finally {
      spy.mockRestore();
      _setPgDatabasePoolForTesting(null);
      await db.close();
    }
  });

  it("campanha NÃO recorrente vencida continua sendo disparada pelo caminho antigo, como hoje", async () => {
    const { createPgliteDb } = await import("./helpers/pgliteDb.js");
    const { _setPgDatabasePoolForTesting } = await import("../services/database.js");
    const db = await createPgliteDb(`
      SET TimeZone = 'UTC';
      CREATE TABLE public.campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT, client_id TEXT, import_id UUID, limit_per_run INT,
        webhook_url TEXT, webhook_token TEXT, status TEXT, scheduled_for TIMESTAMPTZ, last_triggered_at TIMESTAMPTZ,
        archived_at TIMESTAMPTZ, created_by_uid TEXT, created_by_email TEXT, analytics_meta JSONB DEFAULT '{}'::jsonb,
        is_recurring BOOLEAN DEFAULT false
      );
      INSERT INTO public.campaigns (name, client_id, status, scheduled_for, is_recurring) VALUES ('Pontual', 't', 'active', now() - interval '1 hour', false);
      INSERT INTO public.campaigns (name, client_id, status, scheduled_for, is_recurring) VALUES ('Pontual antiga', 't', 'active', now() - interval '1 hour', NULL);
    `);
    _setPgDatabasePoolForTesting({ query: (sql, params) => db.query(sql, params) });
    const dispatchModule = await import("../campaign/dispatch.js");
    const spy = vi.spyOn(dispatchModule, "executeCampaignDispatch").mockResolvedValue({ total: 1 });
    try {
      const { runDueCampaignDispatches } = await import("../campaign/scheduler.js");
      const result = await runDueCampaignDispatches({ limit: 10, triggerSource: "teste" });
      expect(result.processed).toBe(2);
    } finally {
      spy.mockRestore();
      _setPgDatabasePoolForTesting(null);
      await db.close();
    }
  });
});
