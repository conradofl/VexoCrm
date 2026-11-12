import { describe, expect, it } from "vitest";
import {
  findAvailableBriefingSlots,
  createBriefingCalendarEvent,
  formatBriefingOfferMessage,
  formatarDataHoraAmigavel,
  calculateReminderTimes,
  isBusinessDay,
  addBusinessDays,
  getTargetBusinessDays,
  GD_CALENDAR_AGENCIA,
  GD_CALENDAR_CAIO,
} from "../services/gdCalendarService.js";

describe("GD Calendar Service · Agendador Autônomo de Briefing", () => {
  describe("Cálculo de Dias Úteis e Feriados (24h / 48h / 72h)", () => {
    it("identifica corretamente dias úteis, finais de semana e feriados nacionais fixos", () => {
      // Segunda-feira normal
      const segunda = new Date("2026-11-09T12:00:00-03:00");
      expect(isBusinessDay(segunda)).toBe(true);

      // Sábado
      const sabado = new Date("2026-11-07T12:00:00-03:00");
      expect(isBusinessDay(sabado)).toBe(false);

      // Domingo
      const domingo = new Date("2026-11-08T12:00:00-03:00");
      expect(isBusinessDay(domingo)).toBe(false);

      // Feriado Finados (02/11/2026)
      const finados = new Date("2026-11-02T12:00:00-03:00");
      expect(isBusinessDay(finados)).toBe(false);

      // Feriado Tiradentes (21/04/2026)
      const tiradentes = new Date("2026-04-21T12:00:00-03:00");
      expect(isBusinessDay(tiradentes)).toBe(false);

      // Feriado Natal (25/12/2026)
      const natal = new Date("2026-12-25T12:00:00-03:00");
      expect(isBusinessDay(natal)).toBe(false);
    });

    it("calcula target days de 24h, 48h e 72h pulando fins de semana a partir de uma sexta-feira", () => {
      // Sexta-feira, 06/11/2026
      const sexta = new Date("2026-11-06T15:00:00-03:00");
      const targetDays = getTargetBusinessDays(sexta, [1, 2, 3]);

      expect(targetDays).toHaveLength(3);
      // D+1 (24h úteis): Segunda-feira 09/11
      expect(targetDays[0].offset).toBe(1);
      expect(targetDays[0].date.toISOString().slice(0, 10)).toBe("2026-11-09");

      // D+2 (48h úteis): Terça-feira 10/11
      expect(targetDays[1].offset).toBe(2);
      expect(targetDays[1].date.toISOString().slice(0, 10)).toBe("2026-11-10");

      // D+3 (72h úteis): Quarta-feira 11/11
      expect(targetDays[2].offset).toBe(3);
      expect(targetDays[2].date.toISOString().slice(0, 10)).toBe("2026-11-11");
    });

    it("adiciona dias úteis sequencialmente com addBusinessDays", () => {
      const quinta = new Date("2026-11-05T10:00:00-03:00");
      const d1 = addBusinessDays(quinta, 1); // Sexta 06/11
      const d2 = addBusinessDays(quinta, 2); // Segunda 09/11
      expect(d1.toISOString().slice(0, 10)).toBe("2026-11-06");
      expect(d2.toISOString().slice(0, 10)).toBe("2026-11-09");
    });
  });

  describe("findAvailableBriefingSlots · Busca de Horários Comerciais", () => {
    it("retorna 3 opções comerciais válidas (manhã 09h-11h, tarde 14h-17h) em dias úteis", async () => {
      // Segunda-feira 09/11/2026 às 10h00
      const ref = new Date("2026-11-09T13:00:00.000Z"); // 10h00 BRT
      const res = await findAvailableBriefingSlots({
        fromDate: ref,
        targetDays: [1, 2, 3],
        mockBusyRanges: [], // Nenhuma ocupação
      });

      expect(res.options).toHaveLength(3);

      // Opção 1: Terça-feira 10/11 (D+1, 24h)
      expect(res.options[0].opcao).toBe(1);
      expect(res.options[0].diaOffset).toBe(1);
      expect(res.options[0].formattedDate).toContain("Terça-feira");
      expect(res.options[0].periodo).toBe("manha");
      expect(res.options[0].inicio).toContain("2026-11-10");

      // Opção 2: Quarta-feira 11/11 (D+2, 48h)
      expect(res.options[1].opcao).toBe(2);
      expect(res.options[1].diaOffset).toBe(2);
      expect(res.options[1].formattedDate).toContain("Quarta-feira");
      expect(res.options[1].periodo).toBe("tarde");
      expect(res.options[1].inicio).toContain("2026-11-11");

      // Opção 3: Quinta-feira 12/11 (D+3, 72h)
      expect(res.options[2].opcao).toBe(3);
      expect(res.options[2].diaOffset).toBe(3);
      expect(res.options[2].formattedDate).toContain("Quinta-feira");
      expect(res.options[2].periodo).toBe("manha");
      expect(res.options[2].inicio).toContain("2026-11-12");
    });

    it("respeita ocupação em mrkgeracaodigital@gmail.com ou caioalmeidmrk@gmail.com e desvia de horários ocupados", async () => {
      const ref = new Date("2026-11-09T13:00:00.000Z"); // 10h00 BRT

      // Simula que na Terça-feira (10/11) a manhã inteira (09h às 12h) está ocupada na agenda do Caio
      const mockBusyRanges = [
        {
          calendar: GD_CALENDAR_CAIO,
          start: new Date("2026-11-10T12:00:00.000Z"), // 09h00 BRT
          end: new Date("2026-11-10T15:00:00.000Z"), // 12h00 BRT
        },
      ];

      const res = await findAvailableBriefingSlots({
        fromDate: ref,
        targetDays: [1, 2, 3],
        mockBusyRanges,
      });

      expect(res.options).toHaveLength(3);

      // Como a manhã da Terça (10/11) estava ocupada para o Caio, o sistema desviou automaticamente para a Tarde
      expect(res.options[0].diaOffset).toBe(1);
      expect(res.options[0].periodo).toBe("tarde");
      expect(res.options[0].formattedTime).toMatch(/14h00|15h00|16h00/);
    });

    it("nunca oferece horário durante o almoço (12h00 - 13h00)", async () => {
      const ref = new Date("2026-11-09T13:00:00.000Z");
      const res = await findAvailableBriefingSlots({
        fromDate: ref,
        targetDays: [1, 2, 3],
        mockBusyRanges: [],
      });

      for (const opt of res.options) {
        expect(opt.formattedTime).not.toBe("12h00");
        expect(opt.formattedTime).not.toBe("13h00");
      }
    });

    it("gera de forma determinística as 3 opções comerciais (10h, 15h, 10h) em caso de falha ou agenda cheia", async () => {
      const ref = new Date("2026-11-09T13:00:00.000Z"); // Segunda-feira
      // Simula ocupação em todos os horários para forçar o fallback determinístico de resiliência
      const mockBusyRanges = [
        {
          calendar: GD_CALENDAR_CAIO,
          start: new Date("2026-11-01T00:00:00.000Z"),
          end: new Date("2026-11-30T23:59:59.000Z"),
        },
      ];

      const res = await findAvailableBriefingSlots({
        fromDate: ref,
        targetDays: [1, 2, 3],
        mockBusyRanges,
      });

      expect(res.options).toHaveLength(3);
      expect(res.fallback).toBe(true);

      // Opção 1: 24h úteis às 10h00
      expect(res.options[0].opcao).toBe(1);
      expect(res.options[0].diaOffset).toBe(1);
      expect(res.options[0].periodo).toBe("manha");
      expect(res.options[0].formattedTime).toBe("10h00");

      // Opção 2: 48h úteis às 15h00
      expect(res.options[1].opcao).toBe(2);
      expect(res.options[1].diaOffset).toBe(2);
      expect(res.options[1].periodo).toBe("tarde");
      expect(res.options[1].formattedTime).toBe("15h00");

      // Opção 3: 72h úteis às 10h00
      expect(res.options[2].opcao).toBe(3);
      expect(res.options[2].diaOffset).toBe(3);
      expect(res.options[2].periodo).toBe("manha");
      expect(res.options[2].formattedTime).toBe("10h00");
    });
  });

  describe("createBriefingCalendarEvent · Criação de Evento com Google Meet", () => {
    it("cria evento de briefing incluindo agência, Caio e cliente com link Google Meet", async () => {
      const start = "2026-11-10T13:00:00.000Z";
      const end = "2026-11-10T14:00:00.000Z";

      const res = await createBriefingCalendarEvent({
        clienteId: "11111111-2222-3333-4444-555555555555",
        clienteNome: "Clínica Sorriso Aberto",
        slotStart: start,
        slotEnd: end,
        attendees: ["agenda@clinicasorriso.com.br"],
      });

      expect(res.success).toBe(true);
      expect(res.meetUrl).toMatch(/^https:\/\/meet\.google\.com\//);
      expect(res.eventId).toBeDefined();
      expect(res.attendees).toContain(GD_CALENDAR_AGENCIA);
      expect(res.attendees).toContain(GD_CALENDAR_CAIO);
      expect(res.attendees).toContain("agenda@clinicasorriso.com.br");
    });
  });

  describe("formatBriefingOfferMessage · Formatação para WhatsApp", () => {
    it("formata a mensagem marcando o telefone do cliente com opções 1, 2 e 3", () => {
      const slots = [
        {
          opcao: 1,
          formattedDate: "Terça-feira, 10/11",
          formattedTime: "10h00",
          periodo: "manha",
        },
        {
          opcao: 2,
          formattedDate: "Quarta-feira, 11/11",
          formattedTime: "15h00",
          periodo: "tarde",
        },
        {
          opcao: 3,
          formattedDate: "Quinta-feira, 12/11",
          formattedTime: "10h00",
          periodo: "manha",
        },
      ];

      const msg = formatBriefingOfferMessage({
        clienteNome: "Clínica Alpha",
        aprovadorNome: "Dra. Ana",
        aprovadorTelefone: "5534991112233",
        slots,
      });

      expect(msg).toContain("@5534991112233");
      expect(msg).toContain("Dra. Ana");
      expect(msg).toContain("1️⃣ *Opção 1:* Terça-feira, 10/11 às 10h00 (Manhã)");
      expect(msg).toContain("2️⃣ *Opção 2:* Quarta-feira, 11/11 às 15h00 (Tarde)");
      expect(msg).toContain("3️⃣ *Opção 3:* Quinta-feira, 12/11 às 10h00 (Manhã)");
      expect(msg).toContain("responda aqui neste grupo com o número da opção (*1*, *2* ou *3*)");
    });
  });

  describe("calculateReminderTimes · Régua de Lembretes Automáticos", () => {
    it("calcula exatamente 19h00 da véspera no fuso oficial e 1h antes do início", () => {
      // Reunião: Terça-feira 10/11/2026 às 10h00 BRT (13h00 UTC)
      const slotStart = "2026-11-10T13:00:00.000Z";
      const { vesperaReminderAt, umaHoraReminderAt } = calculateReminderTimes({ slotStart });

      // Lembrete 1: Véspera (Segunda 09/11/2026) às 19h00 BRT (22h00 UTC)
      expect(vesperaReminderAt).toBe("2026-11-09T22:00:00.000Z");

      // Lembrete 2: 1h antes do início (Terça 10/11/2026 às 09h00 BRT / 12h00 UTC)
      expect(umaHoraReminderAt).toBe("2026-11-10T12:00:00.000Z");
    });

    it("formata data e hora amigável para exibição no WhatsApp", () => {
      const slotStart = "2026-11-10T13:00:00.000Z"; // 10h00 BRT
      const texto = formatarDataHoraAmigavel(slotStart);
      expect(texto).toContain("Terça-feira");
      expect(texto).toContain("10/11/2026");
      expect(texto).toContain("10h00");
    });
  });
});
