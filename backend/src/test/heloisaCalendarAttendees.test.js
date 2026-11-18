import { describe, it, expect, vi, beforeEach } from "vitest";
import { executarAgendarCompromisso } from "../domains/goclaw/heloisaEngine.js";
import { createBriefingCalendarEvent } from "../services/gdCalendarService.js";

describe("Google Calendar & Participantes Extras da Heloísa", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("respeita participante exclusivo ('apenas o conradofl@gmail.com') sem forçar outros e-mails", async () => {
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        if (sql.includes("public.heloisa_agendas")) {
          return {
            rows: [
              { nome: "Conrado Finzi", email: "conradofinzi@gmail.com", telefone: "5534997817660", notificar_whatsapp: true },
              { nome: "Caio Almeida", email: "caioalmeidamrk@gmail.com", telefone: "5534997719779", notificar_whatsapp: true },
            ],
          };
        }
        if (sql.includes("INSERT INTO public.events")) {
          return { rows: [{ id: "evt-123", name: "Alinhamento Estratégico", date: "2026-11-20T14:00:00-03:00" }] };
        }
        return { rows: [] };
      }),
    };

    const res = await executarAgendarCompromisso(
      {
        titulo: "Alinhamento com Moacir",
        data_hora: "2026-11-20 14:00",
        participantes_extras: "apenas o conradofl@gmail.com",
      },
      mockPool,
      "instancia-teste"
    );

    expect(res).toBeDefined();
    expect(res.sucesso).toBe(true);

    // Na chamada do Google Calendar, deve conter estritamente conradofl@gmail.com
    expect(res.attendees).toBeDefined();
    expect(res.attendees).toContain("conradofl@gmail.com");
    expect(res.attendees).not.toContain("caioalmeidamrk@gmail.com");
  });

  it("createBriefingCalendarEvent: tenta fallback para agenda 'primary' se mrkgeracaodigital retornar 403 ou 404", async () => {
    const fetchCalls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url, init) => {
        fetchCalls.push({ url, init });
        // Chamadas para agendas específicas falham com 403/404 de permissão
        if (!url.includes("/calendars/primary/events")) {
          return new Response(JSON.stringify({ error: { message: "Not Found or Forbidden", code: 404 } }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }
        // Chamada para a agenda 'primary' da service account tem sucesso
        if (url.includes("/calendars/primary/events")) {
          return new Response(
            JSON.stringify({
              id: "evt-primary-456",
              htmlLink: "https://calendar.google.com/event?eid=primary456",
              hangoutLink: "https://meet.google.com/vex-prim-ary",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("{}", { status: 200 });
      })
    );

    const event = await createBriefingCalendarEvent({
      clienteId: "gd-teste",
      clienteNome: "Cliente Teste",
      slotStart: "2026-11-20T17:00:00Z",
      slotEnd: "2026-11-20T18:00:00Z",
      attendees: ["conradofl@gmail.com"],
      strictAttendees: true,
      accessToken: "mock-google-token",
    });

    expect(event.success).toBe(true);
    expect(event.eventId).toBe("evt-primary-456");
    expect(event.meetUrl).toBe("https://meet.google.com/vex-prim-ary");
    expect(fetchCalls.length).toBeGreaterThanOrEqual(2);
    expect(fetchCalls[0].url).toContain("mrkgeracaodigital%40gmail.com");
    expect(fetchCalls[fetchCalls.length - 1].url).toContain("/calendars/primary/events");
    expect(fetchCalls[fetchCalls.length - 1].url).toContain("sendUpdates=all");
  });

  it("quando a sincronização real com o Google Calendar falha, não mascara o erro e retorna calendarError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify({ error: { message: "Calendar permission denied", code: 403 } }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        });
      })
    );

    const event = await createBriefingCalendarEvent({
      clienteId: "gd-teste",
      clienteNome: "Cliente Teste",
      slotStart: "2026-11-20T17:00:00Z",
      slotEnd: "2026-11-20T18:00:00Z",
      attendees: ["conradofl@gmail.com"],
      accessToken: "mock-google-token",
    });

    expect(event.isMock).toBe(true);
    expect(event.calendarError).toBeDefined();
    expect(event.calendarError).toContain("Google Calendar não sincronizado");
  });
});
