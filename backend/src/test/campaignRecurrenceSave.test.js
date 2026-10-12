// backend/src/test/campaignRecurrenceSave.test.js
//
// Regra única de salvar campanha recorrente (criar e editar): fim declarado, sem fim só com confirmação explícita,
// planilha sem variações recusada, CRM sem variações avisada, próximo envio no fuso do tenant e o texto da tela.

import { describe, expect, it } from "vitest";
import {
  describeOccurrenceLoad,
  describeRecurrence,
  estimateOccurrenceDuration,
  recurrenceIntervalDays,
  describeRecurrenceEnd,
  findStepsWithoutVariants,
  formatRecurrenceSlot,
  resolveRecurrenceSave,
} from "../services/campaignRecurrence.js";

const NOW = new Date("2026-10-12T15:00:00.000Z"); // 12/10 12:00 em São Paulo
const COM_VARIACOES = [{ id: "s1", type: "text", text: "Oi", textVariants: ["Oi {{nome}}", "Olá {{nome}}"], enabled: true, order: 1 }];
const SEM_VARIACOES = [{ id: "s1", type: "text", text: "Oi {{nome}}", textVariants: [], enabled: true, order: 1 }];

const base = (over = {}) => ({
  isRecurring: true,
  recurrencePattern: "monthly",
  recurrenceDayOfMonth: 15,
  recurrenceTime: "09:00",
  recurrenceEndType: "count",
  recurrenceMaxOccurrences: 12,
  ...over,
});
const salvar = (body, over = {}) =>
  resolveRecurrenceSave({ body, existing: null, isCrmSource: true, sequence: COM_VARIACOES, timezone: "America/Sao_Paulo", now: NOW, ...over });

describe("fim declarado", () => {
  it("sem tipo de fim: recusa", () => {
    const r = salvar(base({ recurrenceEndType: undefined }));
    expect(r).toMatchObject({ ok: false, code: "RECURRENCE_END_REQUIRED" });
  });

  it("sem fim SEM confirmação explícita: recusa", () => {
    const r = salvar(base({ recurrenceEndType: "never" }));
    expect(r).toMatchObject({ ok: false, code: "RECURRENCE_NO_END_NOT_CONFIRMED" });
  });

  it("sem fim COM confirmação: aceita e registra quando foi confirmado", () => {
    const r = salvar(base({ recurrenceEndType: "never", recurrenceNoEndConfirmed: true }));
    expect(r.ok).toBe(true);
    expect(r.fields.recurrence_no_end_confirmed_at).toBe(NOW.toISOString());
  });

  it("confirmação 'truthy' que não é true (ex.: string) não vale", () => {
    const r = salvar(base({ recurrenceEndType: "never", recurrenceNoEndConfirmed: "sim" }));
    expect(r.ok).toBe(false);
  });

  it("até uma data: fim às 23:59:59 daquele dia no fuso do tenant", () => {
    const r = salvar(base({ recurrenceEndType: "until_date", recurrenceEndsOn: "2027-06-30" }));
    expect(r.ok).toBe(true);
    expect(r.fields.recurrence_ends_at).toBe("2027-07-01T02:59:59.000Z");
  });

  it("data de fim antes do primeiro envio: recusa (nenhum envio aconteceria)", () => {
    const r = salvar(base({ recurrenceEndType: "until_date", recurrenceEndsOn: "2026-10-14" }));
    expect(r).toMatchObject({ ok: false, code: "INVALID_RECURRENCE" });
  });

  it("por contagem: 0 ou não inteiro recusa", () => {
    expect(salvar(base({ recurrenceMaxOccurrences: 0 })).ok).toBe(false);
    expect(salvar(base({ recurrenceMaxOccurrences: 2.5 })).ok).toBe(false);
  });
});

describe("variações", () => {
  it("[OBRIGATÓRIO] planilha + recorrente + passo sem variações: NÃO salva, e diz por quê", () => {
    const r = salvar(base(), { isCrmSource: false, sequence: SEM_VARIACOES });
    expect(r).toMatchObject({ ok: false, code: "RECURRENCE_VARIANTS_REQUIRED" });
    expect(r.message).toContain("mesmas pessoas a cada envio");
    expect(r.message).toContain("passo 1");
  });

  it("planilha com 1 variação só também recusa (1 variação = texto idêntico todo envio)", () => {
    const umaSo = [{ ...SEM_VARIACOES[0], textVariants: ["Oi {{nome}}"] }];
    expect(salvar(base(), { isCrmSource: false, sequence: umaSo }).ok).toBe(false);
  });

  it("CRM + sem variações: salva com aviso, e nada é gerado escondido", () => {
    const r = salvar(base(), { isCrmSource: true, sequence: SEM_VARIACOES });
    expect(r.ok).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toContain("Nada é gerado sem você pedir");
  });

  it("planilha com variações: salva sem aviso", () => {
    const r = salvar(base(), { isCrmSource: false, sequence: COM_VARIACOES });
    expect(r.ok).toBe(true);
    expect(r.warnings).toEqual([]);
  });

  it("passo desligado não conta", () => {
    expect(findStepsWithoutVariants([{ ...SEM_VARIACOES[0], enabled: false }, COM_VARIACOES[0]])).toEqual([]);
  });
});

describe("próximo envio e texto da tela", () => {
  it("recorrente nunca grava scheduled_for (é do agendador antigo)", () => {
    expect(salvar(base()).fields.scheduled_for).toBeNull();
  });

  it("calcula o próximo envio no fuso do tenant", () => {
    const sp = salvar(base());
    const manaus = salvar(base(), { timezone: "America/Manaus" });
    expect(sp.fields.next_run_at).toBe("2026-10-15T12:00:00.000Z");
    expect(manaus.fields.next_run_at).toBe("2026-10-15T13:00:00.000Z");
    expect(formatRecurrenceSlot(manaus.fields.next_run_at, "America/Manaus")).toBe("15/10 às 09:00");
  });

  it("diária: aceita sem dia; semanal exige dia da semana", () => {
    expect(salvar(base({ recurrencePattern: "daily", recurrenceDayOfMonth: undefined })).ok).toBe(true);
    expect(salvar(base({ recurrencePattern: "weekly", recurrenceDayOfMonth: undefined })).ok).toBe(false);
    expect(salvar(base({ recurrencePattern: "weekly", recurrenceDayOfWeek: 2 })).ok).toBe(true);
  });

  it("dia 31 escreve na tela onde cai o mês curto", () => {
    expect(describeRecurrence({ pattern: "monthly", dayOfMonth: 31, time: "09:00" })).toEqual({
      summary: "Todo mês, no dia 31, às 09:00",
      monthEndNote: "Em meses sem dia 31, o envio sai no último dia do mês (ex.: 30/11, 28/02).",
    });
    expect(describeRecurrence({ pattern: "monthly", dayOfMonth: 15, time: "09:00" }).monthEndNote).toBeNull();
  });

  it("texto do fim", () => {
    expect(describeRecurrenceEnd({ endType: "count", maxOccurrences: 12, occurrencesCount: 3 })).toBe("Termina depois de 12 envios (3 feitos)");
    expect(describeRecurrenceEnd({ endType: "never" })).toBe("Sem fim — envia até alguém desligar");
  });

  it("desligar a recorrência zera o próximo envio", () => {
    const r = resolveRecurrenceSave({ body: { isRecurring: false }, existing: { is_recurring: true }, isCrmSource: true, sequence: [], now: NOW });
    expect(r).toMatchObject({ ok: true, fields: { is_recurring: false, next_run_at: null } });
  });

  it("editar campanha que já repete herda o que não veio no corpo (ex.: só mudou o horário)", () => {
    const existing = {
      is_recurring: true, recurrence_pattern: "monthly", recurrence_day_of_month: 20, recurrence_time: "09:00",
      recurrence_end_type: "never", recurrence_no_end_confirmed_at: "2026-10-01T00:00:00Z",
    };
    const r = resolveRecurrenceSave({ body: { recurrenceTime: "10:30" }, existing, isCrmSource: true, sequence: COM_VARIACOES, now: NOW });
    expect(r.ok).toBe(true);
    expect(r.fields).toMatchObject({ recurrence_day_of_month: 20, recurrence_time: "10:30", recurrence_no_end_confirmed_at: "2026-10-01T00:00:00Z" });
    expect(r.fields.next_run_at).toBe("2026-10-20T13:30:00.000Z");
  });
});

describe("quanto cada ocorrência leva (recorrente não tem limite: a cota do chip é o freio)", () => {
  const janelaLivre = { enabled: false };

  it("cota é o freio: 1.482 leads × 1 mensagem com chip de 500/dia → 3 dias", () => {
    const e = estimateOccurrenceDuration({ audienceTotal: 1482, messagesPerLead: 1, dailyQuota: 500, sendWindow: janelaLivre });
    expect(e).toMatchObject({ days: 3, leadsPerDay: 500, limitedBy: "quota" });
  });

  it("mensagens por lead contam: 2 passos dobram o tempo", () => {
    expect(estimateOccurrenceDuration({ audienceTotal: 1482, messagesPerLead: 2, dailyQuota: 500, sendWindow: janelaLivre }).days).toBe(6);
  });

  it("janela de envio limita o ritmo e só conta os dias permitidos", () => {
    // 08:00–12:00 = 4 h = 240 leads/dia no ritmo de ~60 s; seg–sex
    const e = estimateOccurrenceDuration({
      audienceTotal: 1000, messagesPerLead: 1, dailyQuota: 500,
      sendWindow: { enabled: true, start: "08:00", end: "12:00", days: ["mon", "tue", "wed", "thu", "fri"] },
    });
    expect(e).toMatchObject({ leadsPerDay: 240, limitedBy: "pace" });
    expect(e.days).toBe(7); // 5 dias de envio = 7 dias de calendário
  });

  it("chip desconhecido: sem estimativa (não inventa número)", () => {
    expect(estimateOccurrenceDuration({ audienceTotal: 100, messagesPerLead: 1, dailyQuota: null, sendWindow: janelaLivre })).toBeNull();
  });

  it("intervalo real da repetição", () => {
    const now = new Date("2026-10-12T15:00:00Z");
    expect(recurrenceIntervalDays({ pattern: "daily", time: "09:00", now })).toBe(1);
    expect(recurrenceIntervalDays({ pattern: "weekly", dayOfWeek: 2, time: "09:00", now })).toBe(7);
    expect(recurrenceIntervalDays({ pattern: "monthly", dayOfMonth: 15, time: "09:00", now })).toBe(31); // 15/10 → 15/11
  });

  it("[OBRIGATÓRIO] passou do intervalo: o texto diz, com os números, que a repetição não vai acontecer como configurada", () => {
    const estimate = estimateOccurrenceDuration({ audienceTotal: 1482, messagesPerLead: 1, dailyQuota: 50, sendWindow: janelaLivre });
    const r = describeOccurrenceLoad({ estimate, intervalDays: 30, chipName: "Chip GD", dailyQuota: 50, messagesPerLead: 1, audienceTotal: 1482 });
    expect(r.overrun).toBe(false); // 30 dias numa repetição de 30: cabe, no limite
    expect(r.message).toContain('a cota do chip "Chip GD" (50 mensagens/dia, 1 por lead)');
    expect(r.message).toContain("leva cerca de 30 dias; sua repetição é a cada 30 dias");
    expect(r.message).not.toContain("não vai conseguir"); // 30 = 30: cabe
    const r2 = describeOccurrenceLoad({ estimate: { ...estimate, days: 31 }, intervalDays: 30, chipName: "Chip GD", dailyQuota: 50, messagesPerLead: 1, audienceTotal: 1482 });
    expect(r2.overrun).toBe(true);
    expect(r2.message).toContain("A repetição não vai conseguir acontecer como configurada");
  });
});
