import { describe, expect, it } from "vitest";
import { formatWaitLabel, formatWaitTime, waitUrgency } from "@/lib/inbox/waitTime";

// Todos os instantes em UTC explícito. São Paulo = UTC-3 o ano inteiro.
const at = (iso: string) => new Date(iso);

describe("formatWaitTime", () => {
  const now = at("2026-11-10T18:00:00Z"); // 15:00 em São Paulo

  it("mostra minutos abaixo de uma hora", () => {
    expect(formatWaitTime(at("2026-11-10T17:22:00Z"), now)).toBe("38min");
  });

  it("mostra horas e minutos abaixo de três horas", () => {
    expect(formatWaitTime(at("2026-11-10T16:48:00Z"), now)).toBe("1h12");
    expect(formatWaitTime(at("2026-11-10T16:55:00Z"), now)).toBe("1h05");
    expect(formatWaitTime(at("2026-11-10T16:00:00Z"), now)).toBe("2h");
  });

  it("mostra só horas de três a doze horas", () => {
    expect(formatWaitTime(at("2026-11-10T13:30:00Z"), now)).toBe("4h");
  });

  it("mostra 'agora' abaixo de um minuto e quando o horário está no futuro", () => {
    expect(formatWaitTime(at("2026-11-10T17:59:30Z"), now)).toBe("agora");
    expect(formatWaitTime(at("2026-11-10T18:05:00Z"), now)).toBe("agora");
  });

  it("devolve vazio para horário ausente ou inválido", () => {
    expect(formatWaitTime(null, now)).toBe("");
    expect(formatWaitTime("não é data", now)).toBe("");
  });

  describe("virada de dia", () => {
    it("não chama de 'ontem' quem escreveu há 20 minutos, do outro lado da meia-noite", () => {
      // 23:50 de 09/11 em São Paulo -> 00:10 de 10/11 em São Paulo
      expect(formatWaitTime(at("2026-11-10T02:50:00Z"), at("2026-11-10T03:10:00Z"))).toBe("20min");
    });

    it("mantém horas quando passa de doze horas dentro do mesmo dia", () => {
      // 08:00 -> 21:00 de 10/11 em São Paulo
      expect(formatWaitTime(at("2026-11-10T11:00:00Z"), at("2026-11-11T00:00:00Z"))).toBe("13h");
    });

    it("chama de 'ontem' o dia de calendário anterior com doze horas ou mais", () => {
      // 20:00 de 09/11 -> 09:00 de 10/11 em São Paulo (13 horas)
      expect(formatWaitTime(at("2026-11-09T23:00:00Z"), at("2026-11-10T12:00:00Z"))).toBe("ontem");
    });

    it("conta dias de calendário, não blocos de 24 horas", () => {
      // 23:00 de 07/11 -> 09:00 de 10/11 em São Paulo: 58 horas, mas três dias de calendário
      expect(formatWaitTime(at("2026-11-08T02:00:00Z"), at("2026-11-10T12:00:00Z"))).toBe("3 dias");
    });
  });

  describe("fuso", () => {
    // 22:00 de 09/11 em São Paulo = 01:00 UTC de 10/11.
    // Agora: 10:00 de 10/11 em São Paulo = 13:00 UTC de 10/11. Doze horas depois.
    const since = at("2026-11-10T01:00:00Z");
    const later = at("2026-11-10T13:00:00Z");

    it("usa o dia de São Paulo, não o dia UTC", () => {
      // Em UTC os dois instantes caem em 10/11 (seria "12h"). Em São Paulo é ontem.
      expect(formatWaitTime(since, later)).toBe("ontem");
      expect(formatWaitTime(since, later, "UTC")).toBe("12h");
    });

    it("dá o mesmo resultado qualquer que seja o fuso da máquina que roda o teste", () => {
      const original = process.env.TZ;
      try {
        for (const tz of ["UTC", "Asia/Tokyo", "America/Los_Angeles"]) {
          process.env.TZ = tz;
          expect(formatWaitTime(since, later)).toBe("ontem");
        }
      } finally {
        process.env.TZ = original;
      }
    });

    it("aceita segundos epoch convertidos, ISO e Date como entrada", () => {
      expect(formatWaitTime(since.getTime(), later.getTime())).toBe("ontem");
      expect(formatWaitTime(since.toISOString(), later.toISOString())).toBe("ontem");
    });
  });
});

describe("formatWaitLabel", () => {
  const now = at("2026-11-10T18:00:00Z");

  it("diz há quanto tempo a conversa está parada", () => {
    expect(formatWaitLabel(at("2026-11-10T13:30:00Z"), now)).toBe("4h parada");
    expect(formatWaitLabel(at("2026-11-10T17:22:00Z"), now)).toBe("38min parada");
    expect(formatWaitLabel(at("2026-11-07T18:00:00Z"), now)).toBe("3 dias parada");
  });

  it("não escreve 'ontem parada' nem 'agora parada'", () => {
    expect(formatWaitLabel(at("2026-11-09T15:00:00Z"), now)).toBe("desde ontem");
    expect(formatWaitLabel(at("2026-11-10T17:59:40Z"), now)).toBe("agora");
    expect(formatWaitLabel(null, now)).toBe("");
  });
});

describe("waitUrgency", () => {
  const now = at("2026-11-10T18:00:00Z");

  it("separa em menos de 1h, menos de 24h e 24h ou mais", () => {
    expect(waitUrgency(at("2026-11-10T17:30:00Z"), now)).toBe("fresh");
    expect(waitUrgency(at("2026-11-10T17:00:00Z"), now)).toBe("warm");
    expect(waitUrgency(at("2026-11-09T18:00:01Z"), now)).toBe("warm");
    expect(waitUrgency(at("2026-11-09T18:00:00Z"), now)).toBe("late");
    expect(waitUrgency(null, now)).toBeNull();
  });
});
