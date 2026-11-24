// Horário dos lotes do "Enviar em lotes" (lib/batchSchedule.ts): janela de envio e máximo por dia.
// Caso real (Tinge, 23/11/2026): 100 leads, 5 por hora, no máximo 50 por dia, janela 08:00–20:00 de segunda a sexta.
import { describe, expect, it } from "vitest";
import { diasDoPlano, lotesPorDia, planBatchTimes } from "@/lib/batchSchedule";
import { getPartsInTimezone } from "@/lib/sendWindow";

const JANELA = { send_window_enabled: true, send_window_start: "08:00", send_window_end: "20:00", send_window_days: ["mon", "tue", "wed", "thu", "fri"], send_window_timezone: "America/Sao_Paulo" };
const sp = (iso: string) => new Date(iso + "-03:00");
const hora = (d: Date) => {
  const p = getPartsInTimezone(d, "America/Sao_Paulo");
  return `${p.weekday} ${String(p.hour).padStart(2, "0")}:${String(p.minute).padStart(2, "0")}`;
};

describe("planBatchTimes", () => {
  it("5 por hora até 50 por dia: 10 lotes num dia, 10 no seguinte, nenhum de noite", () => {
    // terça 24/11/2026 às 09:00
    const h = planBatchTimes({ start: sp("2026-11-24T09:00:00"), count: 20, intervalHours: 1, size: 5, maxPerDay: 50, sendWindow: JANELA });
    expect(h).toHaveLength(20);
    expect(h.slice(0, 10).map(hora)).toEqual(["tue 09:00", "tue 10:00", "tue 11:00", "tue 12:00", "tue 13:00", "tue 14:00", "tue 15:00", "tue 16:00", "tue 17:00", "tue 18:00"]);
    expect(hora(h[10])).toBe("wed 08:00");
    expect(hora(h[19])).toBe("wed 17:00");
    expect(diasDoPlano(h, JANELA)).toBe(2);
  });

  it("sem máximo por dia, a noite é pulada em vez de amontoar na abertura", () => {
    const h = planBatchTimes({ start: sp("2026-11-24T18:00:00"), count: 4, intervalHours: 1, size: 5, sendWindow: JANELA });
    expect(h.map(hora)).toEqual(["tue 18:00", "tue 19:00", "wed 08:00", "wed 09:00"]);
    // nunca dois lotes no mesmo minuto
    expect(new Set(h.map((d) => d.getTime())).size).toBe(4);
  });

  it("começar fora da janela leva o primeiro lote para a abertura, e o fim de semana é pulado", () => {
    // sexta 27/11 às 19:30 → 19:30 ainda cabe; o seguinte vai para segunda 08:00
    const h = planBatchTimes({ start: sp("2026-11-27T19:30:00"), count: 2, intervalHours: 1, size: 5, sendWindow: JANELA });
    expect(h.map(hora)).toEqual(["fri 19:30", "mon 08:00"]);
    const madrugada = planBatchTimes({ start: sp("2026-11-24T03:00:00"), count: 1, intervalHours: 1, size: 5, sendWindow: JANELA });
    expect(hora(madrugada[0])).toBe("tue 08:00");
  });

  it("máximo menor que um lote ainda deixa um lote por dia", () => {
    expect(lotesPorDia(100, 50)).toBe(1);
    expect(lotesPorDia(5, 50)).toBe(10);
    expect(lotesPorDia(5, null)).toBeNull();
    expect(lotesPorDia(5, 0)).toBeNull();
  });

  it("janela desligada: intervalo puro, e o máximo por dia ainda vale (o dia vira à meia-noite)", () => {
    const desligada = { ...JANELA, send_window_enabled: false };
    const h = planBatchTimes({ start: sp("2026-11-24T21:00:00"), count: 4, intervalHours: 1, size: 25, maxPerDay: 50, sendWindow: desligada });
    // 2 lotes de 25 = 50 na terça; o terceiro (23:00) passaria do máximo e vai para quarta
    expect(h.map(hora)).toEqual(["tue 21:00", "tue 22:00", "wed 08:00", "wed 09:00"]);
  });
});
