import { describe, it, expect } from "vitest";
import {
  isScheduledDateInPast,
  getStartOfMinute,
  BACKEND_SCHEDULE_GRACE_MS,
} from "../../../backend/src/services/campaignScheduleValidation.js";

describe("Validação de Data de Agendamento Compartilhada (backend/src/services/campaignScheduleValidation.js)", () => {
  it("a) escolher o minuto corrente é ACEITO (hoje é recusado) — este é o caso real", () => {
    // Simula 23:27:45 (45 segundos após o início do minuto)
    const now = new Date("2026-10-14T23:27:45.000Z").getTime();
    // O input datetime-local devolve '2026-10-14T23:27:00.000Z' (granularidade de minuto)
    const scheduledAt = "2026-10-14T23:27:00.000Z";

    // No frontend (graceMs: 0), não pode ser considerado passado!
    const frontendPast = isScheduledDateInPast(scheduledAt, { now, graceMs: 0 });
    expect(frontendPast).toBe(false);

    // No backend (graceMs: 120s), também não pode ser considerado passado!
    const backendPast = isScheduledDateInPast(scheduledAt, { now, graceMs: BACKEND_SCHEDULE_GRACE_MS });
    expect(backendPast).toBe(false);
  });

  it("b) escolher 1 minuto no futuro é aceito no frontend E no backend", () => {
    const now = new Date("2026-10-14T23:27:45.000Z").getTime();
    const scheduledAt = "2026-10-14T23:28:00.000Z";

    expect(isScheduledDateInPast(scheduledAt, { now, graceMs: 0 })).toBe(false);
    expect(isScheduledDateInPast(scheduledAt, { now, graceMs: BACKEND_SCHEDULE_GRACE_MS })).toBe(false);
  });

  it("c) ontem é recusado nos dois", () => {
    const now = new Date("2026-10-14T23:27:45.000Z").getTime();
    const scheduledAt = "2026-10-13T23:27:00.000Z"; // ontem

    expect(isScheduledDateInPast(scheduledAt, { now, graceMs: 0 })).toBe(true);
    expect(isScheduledDateInPast(scheduledAt, { now, graceMs: BACKEND_SCHEDULE_GRACE_MS })).toBe(true);
  });

  it("d) data aceita pelo frontend nunca é recusada pelo backend: provar com um horário na fronteira, simulando atraso de requisição dentro da folga", () => {
    // Usuário no frontend escolhe exatamente o minuto corrente (ex: 23:27:00) às 23:27:58 (a 2s de virar o minuto)
    const clientNow = new Date("2026-10-14T23:27:58.000Z").getTime();
    const scheduledAt = "2026-10-14T23:27:00.000Z";

    // Frontend valida e APROVA na fronteira do minuto:
    const frontendPast = isScheduledDateInPast(scheduledAt, { now: clientNow, graceMs: 0 });
    expect(frontendPast).toBe(false);

    // A requisição viaja pela rede, o servidor processa lotes, relógio tem ligeiro desvio:
    // Servidor recebe a requisição 60 segundos depois, já em 23:28:58 (minuto seguinte):
    const serverNow = clientNow + 60 * 1000;
    const backendPast = isScheduledDateInPast(scheduledAt, { now: serverNow, graceMs: BACKEND_SCHEDULE_GRACE_MS });
    expect(backendPast).toBe(false);

    // Mesmo com atraso severo de 119 segundos:
    const serverNowLate = clientNow + 119 * 1000;
    expect(isScheduledDateInPast(scheduledAt, { now: serverNowLate, graceMs: BACKEND_SCHEDULE_GRACE_MS })).toBe(false);

    // Mas se o atraso ultrapassar a folga de 120s em relação à fronteira anterior, aí sim o backend recusa:
    const serverNowTooLate = clientNow + 180 * 1000;
    expect(isScheduledDateInPast(scheduledAt, { now: serverNowTooLate, graceMs: BACKEND_SCHEDULE_GRACE_MS })).toBe(true);
  });

  it("minuto anterior ao corrente é recusado no frontend", () => {
    const now = new Date("2026-10-14T23:27:45.000Z").getTime();
    const scheduledAt = "2026-10-14T23:26:00.000Z"; // 1 minuto antes

    expect(isScheduledDateInPast(scheduledAt, { now, graceMs: 0 })).toBe(true);
  });
});
