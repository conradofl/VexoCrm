import { describe, it, expect, vi, beforeEach } from "vitest";
import { executarAgendarCompromisso } from "../domains/goclaw/heloisaEngine.js";
import { createBriefingCalendarEvent } from "../services/gdCalendarService.js";

describe("Heloísa — Prevenção de Mensagem Dupla e Agenda Compartilhada no Google Calendar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Teste 1: Ao executar executarAgendarCompromisso passando o solicitante, o solicitante NÃO recebe notificação de broadcast", async () => {
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql) => {
        if (sql.includes("public.heloisa_agendas")) {
          return {
            rows: [
              { nome: "Conrado Finzi", email: "conradofl@gmail.com", telefone: "5534997817660", notificar_whatsapp: true },
              { nome: "Caio Almeida", email: "caioalmeidmrk@gmail.com", telefone: "5534997719779", notificar_whatsapp: true },
            ],
          };
        }
        if (sql.includes("INSERT INTO public.events")) {
          return { rows: [{ id: "evt-test-1", name: "Reunião de Diretoria", date: "2026-11-20T14:00:00-03:00" }] };
        }
        return { rows: [] };
      }),
    };

    const diretorSolicitante = {
      nome: "Conrado Finzi",
      telefone: "5534997817660",
      papel: "Diretor Executivo / Sócio",
    };

    const res = await executarAgendarCompromisso(
      {
        titulo: "Reunião Geral de Planejamento",
        data_hora: "2026-11-20 14:00",
      },
      mockPool,
      "instancia-teste",
      diretorSolicitante
    );

    expect(res.sucesso).toBe(true);
    expect(res.notificacoes_whatsapp).toBeDefined();

    // Conrado (solicitante) NÃO deve estar na lista de notificações de broadcast (ele recebe a resposta executiva final)
    const telefonesNotificados = res.notificacoes_whatsapp.map((n) => n.telefone);
    expect(telefonesNotificados).not.toContain("5534997817660");

    // Caio (outro participante ativo) deve ser notificado normalmente
    expect(telefonesNotificados).toContain("5534997719779");
  });

  it("Teste 2: Reunião exclusiva ('apenas conradofl@gmail.com') não deve disparar broadcast para outros diretores", async () => {
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql) => {
        if (sql.includes("public.heloisa_agendas")) {
          return {
            rows: [
              { nome: "Conrado Finzi", email: "conradofl@gmail.com", telefone: "5534997817660", notificar_whatsapp: true },
              { nome: "Caio Almeida", email: "caioalmeidmrk@gmail.com", telefone: "5534997719779", notificar_whatsapp: true },
            ],
          };
        }
        if (sql.includes("INSERT INTO public.events")) {
          return { rows: [{ id: "evt-test-2", name: "Consulta Médica", date: "2026-11-20T10:00:00-03:00" }] };
        }
        return { rows: [] };
      }),
    };

    const diretorSolicitante = {
      nome: "Conrado Finzi",
      telefone: "5534997817660",
    };

    const res = await executarAgendarCompromisso(
      {
        titulo: "Alinhamento Pessoal Conrado",
        data_hora: "2026-11-20 10:00",
        participantes_extras: "apenas conradofl@gmail.com",
      },
      mockPool,
      "instancia-teste",
      diretorSolicitante
    );

    expect(res.sucesso).toBe(true);
    // Como a reunião é exclusiva para Conrado e ele é o próprio solicitante, nenhum broadcast deve ser disparado
    expect(res.notificacoes_whatsapp).toEqual([]);
  });

  it("Teste 3: O template de notificação msgNotif lista estritamente os participantes reais de listaParticipantesFinal", async () => {
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql) => {
        if (sql.includes("public.heloisa_agendas")) {
          return {
            rows: [
              { nome: "Conrado Finzi", email: "conradofl@gmail.com", telefone: "5534997817660", notificar_whatsapp: true },
              { nome: "Caio Almeida", email: "caioalmeidmrk@gmail.com", telefone: "5534997719779", notificar_whatsapp: true },
              { nome: "Geração Digital", email: "mrkgeracaodigital@gmail.com", telefone: null, notificar_whatsapp: false },
            ],
          };
        }
        if (sql.includes("INSERT INTO public.events")) {
          return { rows: [{ id: "evt-test-3", name: "Alinhamento com Cliente", date: "2026-11-20T16:00:00-03:00" }] };
        }
        return { rows: [] };
      }),
    };

    const res = await executarAgendarCompromisso(
      {
        titulo: "Reunião de Parceria",
        data_hora: "2026-11-20 16:00",
        participantes_extras: "apenas caioalmeidmrk@gmail.com",
      },
      mockPool,
      "instancia-teste",
      { telefone: "5534997817660" }
    );

    expect(res.sucesso).toBe(true);
    expect(res.mensagem_notificacao_broadcast).toBeDefined();
    // A notificação deve conter Caio, mas NÃO Conrado nem mrkgeracaodigital
    expect(res.mensagem_notificacao_broadcast).toContain("caioalmeidmrk@gmail.com");
    expect(res.mensagem_notificacao_broadcast).not.toContain("mrkgeracaodigital@gmail.com");
  });

  it("Teste 4: createBriefingCalendarEvent tenta a agenda autorizada conradofl@gmail.com quando mrkgeracaodigital retorna 403/404", async () => {
    const endpointsChamados = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url) => {
        const urlStr = String(url);
        endpointsChamados.push(urlStr);

        // Agenda mrkgeracaodigital falha com 404 (permissão ausente para a service account)
        if (urlStr.includes("mrkgeracaodigital%40gmail.com")) {
          return new Response(JSON.stringify({ error: { message: "Calendar not found or permission denied", code: 404 } }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Agenda autorizada do Conrado (conradofl@gmail.com) tem sucesso
        if (urlStr.includes("conradofl%40gmail.com")) {
          return new Response(
            JSON.stringify({
              id: "evt-conrado-789",
              htmlLink: "https://calendar.google.com/event?eid=conrado789",
              hangoutLink: "https://meet.google.com/con-rado-meet",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }

        return new Response("{}", { status: 404 });
      })
    );

    const event = await createBriefingCalendarEvent({
      clienteId: "gd-conrado",
      clienteNome: "Conrado Finzi",
      slotStart: "2026-11-20T17:00:00Z",
      slotEnd: "2026-11-20T18:00:00Z",
      attendees: ["conradofl@gmail.com"],
      strictAttendees: true,
      accessToken: "mock-valid-google-token",
    });

    expect(event.success).toBe(true);
    expect(event.isMock).toBe(false);
    expect(event.eventId).toBe("evt-conrado-789");
    expect(event.meetUrl).toBe("https://meet.google.com/con-rado-meet");
    expect(event.calendarError).toBeUndefined();

    // Confirma que a API tentou gravar na agenda autorizada do Conrado
    const tentouConrado = endpointsChamados.some((ep) => ep.includes("conradofl%40gmail.com"));
    expect(tentouConrado).toBe(true);
  });
});
