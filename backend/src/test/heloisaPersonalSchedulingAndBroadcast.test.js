import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executarAgendarCompromisso,
  gerarLinkGoogleCalendarTemplate,
  identificarUsuarioAutorizado,
  HELOISA_TOOLS,
} from "../domains/goclaw/heloisaEngine.js";
import * as gdCalendarService from "../services/gdCalendarService.js";

describe("Protocolo Ralph Loop: Agendamentos Pessoais, Supressão de Broadcast, Link Google Calendar e Unificação", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Reconhecimento de 'Minha Agenda' & Reunião Individual", () => {
    it("Carlos pedindo 'agendar na minha agenda Carlos' inclui apenas Carlos e suprime broadcast para Conrado e Caio", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql, params) => {
          if (sql.includes("public.heloisa_agendas")) {
            return {
              rows: [
                { nome: "Conrado Finzi", email: "conradofl@gmail.com", telefone: "5534997817660", notificar_whatsapp: true },
                { nome: "Caio Almeida", email: "caioalmeidamrk@gmail.com", telefone: "5534997719779", notificar_whatsapp: true },
                { nome: "Carlos Eduardo", email: "carlos@geracaodigital.com", telefone: "5534991234567", notificar_whatsapp: true },
                { nome: "Geração Digital", email: "mrkgeracaodigital@gmail.com", telefone: null, notificar_whatsapp: false },
              ],
            };
          }
          if (sql.includes("public.events")) {
            return {
              rows: [
                {
                  id: "evt-carlos-1",
                  name: "Alinhamento de Tráfego",
                  date: "2026-11-20T15:00:00-03:00",
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const carlosSolicitante = {
        nome: "Carlos Eduardo",
        telefone: "5534991234567",
        email: "carlos@geracaodigital.com",
        papel: "Gestor de Tráfego",
      };

      const res = await executarAgendarCompromisso(
        {
          titulo: "Alinhamento de Tráfego",
          data_hora: "2026-11-20 15:00",
          participantes_extras: "agendar na minha agenda Carlos",
        },
        mockPool,
        "vexo-adm-vexo-atende",
        carlosSolicitante
      );

      expect(res.sucesso).toBe(true);

      // Participante ÚNICO: Estritamente Carlos
      expect(res.attendees).toBeDefined();
      expect(res.attendees).toContain("carlos@geracaodigital.com");
      expect(res.attendees).not.toContain("conradofl@gmail.com");
      expect(res.attendees).not.toContain("caioalmeidamrk@gmail.com");
      expect(res.attendees).not.toContain("mrkgeracaodigital@gmail.com");

      // Supressão total de Broadcast para Conrado e Caio
      const telefonesNotificados = (res.notificacoes_whatsapp || []).map((n) => n.telefone);
      expect(telefonesNotificados).not.toContain("5534997817660"); // Conrado
      expect(telefonesNotificados).not.toContain("5534997719779"); // Caio

      // Link do Google Calendar presente no retorno e na mensagem
      expect(res.googleCalendarLink).toBeDefined();
      expect(res.googleCalendarLink).toContain("calendar.google.com/calendar/render");
      expect(res.mensagem).toContain("📅 *Adicionar ao Google Agenda:*");
      expect(res.mensagem).toContain(res.googleCalendarLink);
    });

    it("Reconhece variações de comandos de reunião pessoal e 'minha agenda'", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("public.heloisa_agendas")) {
            return {
              rows: [
                { nome: "Conrado Finzi", email: "conradofl@gmail.com", telefone: "5534997817660", notificar_whatsapp: true },
                { nome: "Caio Almeida", email: "caioalmeidamrk@gmail.com", telefone: "5534997719779", notificar_whatsapp: true },
              ],
            };
          }
          if (sql.includes("public.events")) {
            return { rows: [{ id: "evt-pessoal-1" }] };
          }
          return { rows: [] };
        }),
      };

      const res = await executarAgendarCompromisso(
        {
          titulo: "Dentista - Pessoal",
          data_hora: "amanhã às 10h",
          participantes_extras: "na minha agenda",
        },
        mockPool,
        "vexo-adm-vexo-atende",
        { nome: "Conrado Finzi", email: "conradofl@gmail.com", telefone: "5534997817660" }
      );

      expect(res.sucesso).toBe(true);
      expect(res.attendees).toEqual(["conradofl@gmail.com"]);
      expect(res.attendees).not.toContain("caioalmeidamrk@gmail.com");
      expect(res.notificacoes_whatsapp.length).toBe(0);
    });
  });

  describe("2. Link Instantâneo do Google Calendar (1 Toque)", () => {
    it("gerarLinkGoogleCalendarTemplate monta URL no padrão oficial do Google Calendar", () => {
      const url = gerarLinkGoogleCalendarTemplate({
        titulo: "Reunião de Alinhamento Carlos",
        dataIso: "2026-11-20T14:00:00-03:00",
        duracaoMinutos: 60,
        meetUrl: "https://meet.google.com/abc-defg-hij",
        descricao: "Alinhamento com a Heloísa",
      });

      expect(url).toBeDefined();
      expect(url).toContain("https://calendar.google.com/calendar/render?action=TEMPLATE");
      expect(url).toContain("text=Reuni%C3%A3o%20de%20Alinhamento%20Carlos");
      expect(url).toContain("dates=");
      expect(url).toContain("location=https%3A%2F%2Fmeet.google.com%2Fabc-defg-hij");
      expect(url).toContain("details=");
    });
  });

  describe("3. Unificação da Autorização da Heloísa (identificarUsuarioAutorizado)", () => {
    it("reconhece usuário cadastrado em heloisa_agendas sem precisar de heloisa_usuarios_autorizados", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("public.heloisa_usuarios_autorizados")) {
            return { rows: [] };
          }
          if (sql.includes("public.heloisa_agendas")) {
            return {
              rows: [
                {
                  id: "agenda-carlos-id",
                  nome: "Carlos Eduardo",
                  email: "carlos@geracaodigital.com",
                  telefone: "5534991234567",
                  papel: "Gestor de Tráfego",
                  ativo: true,
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const user = await identificarUsuarioAutorizado("5534991234567", mockPool);

      expect(user).toBeDefined();
      expect(user.nome).toBe("Carlos Eduardo");
      expect(user.email).toBe("carlos@geracaodigital.com");
      expect(user.origem).toBe("heloisa_agendas");
    });

    it("reconhece colaborador cadastrado em gd_colaboradores se não estiver nas tabelas anteriores", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("public.heloisa_usuarios_autorizados")) {
            return { rows: [] };
          }
          if (sql.includes("public.heloisa_agendas")) {
            return { rows: [] };
          }
          if (sql.includes("public.gd_colaboradores")) {
            return {
              rows: [
                {
                  id: "colab-santana-id",
                  nome: "Santana",
                  funcao: "Diretor de Arte",
                  telefone: "5516982447360",
                  trello_username: "felipesantanamoraes",
                  ativo: true,
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const user = await identificarUsuarioAutorizado("5516982447360", mockPool);

      expect(user).toBeDefined();
      expect(user.nome).toBe("Santana");
      expect(user.papel).toBe("Diretor de Arte");
      expect(user.origem).toBe("gd_colaboradores");
    });
  });

  describe("4. Correção Cirúrgica de primaryCalendarId e Supressão de E-mails da Diretoria", () => {
    it("Schema da tool agendar_compromisso não menciona '(Conrado, Caio, GD)' e possui parâmetro 'agenda_alvo'", () => {
      const tool = HELOISA_TOOLS.find((t) => t.function?.name === "agendar_compromisso");
      expect(tool).toBeDefined();
      expect(tool.function.description).not.toContain("(Conrado, Caio, GD)");
      expect(tool.function.parameters.properties.agenda_alvo).toBeDefined();
      expect(tool.function.parameters.properties.participantes_extras.description).not.toContain("além da diretoria");
    });

    it("passa primaryCalendarId: carlosarantes524@gmail.com diretamente para createBriefingCalendarEvent", async () => {
      const calSpy = vi.spyOn(gdCalendarService, "createBriefingCalendarEvent").mockResolvedValue({
        success: true,
        eventId: "cal-carlos-123",
        meetUrl: "https://meet.google.com/abc-carlos",
      });

      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("public.heloisa_agendas")) {
            return {
              rows: [
                { nome: "Carlos", email: "carlosarantes524@gmail.com", telefone: "5534991234567", notificar_whatsapp: true },
                { nome: "Conrado Finzi", email: "conradofl@gmail.com", telefone: "5534997817660", notificar_whatsapp: true },
                { nome: "Caio Almeida", email: "caioalmeidamrk@gmail.com", telefone: "5534997719779", notificar_whatsapp: true },
              ],
            };
          }
          if (sql.includes("public.events")) {
            return { rows: [{ id: "evt-carlos-direct" }] };
          }
          return { rows: [] };
        }),
      };

      const res = await executarAgendarCompromisso(
        {
          titulo: "Alinhamento Carlos",
          data_hora: "2026-11-20 14:00",
          agenda_alvo: "carlosarantes524@gmail.com",
        },
        mockPool,
        "vexo-adm-vexo-atende",
        { nome: "Carlos", email: "carlosarantes524@gmail.com", telefone: "5534991234567" }
      );

      expect(res.sucesso).toBe(true);
      expect(calSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryCalendarId: "carlosarantes524@gmail.com",
          strictAttendees: true,
        })
      );
      expect(res.attendees).toEqual(["carlosarantes524@gmail.com"]);
      expect(res.attendees).not.toContain("conradofl@gmail.com");
      expect(res.attendees).not.toContain("caioalmeidamrk@gmail.com");

      // Zero broadcast para Conrado
      const tels = (res.notificacoes_whatsapp || []).map((n) => n.telefone);
      expect(tels).not.toContain("5534997817660");
    });

    it("resolve 'agenda_alvo: Carlos' para o e-mail cadastrado em heloisa_agendas e grava direto na agenda dele", async () => {
      const calSpy = vi.spyOn(gdCalendarService, "createBriefingCalendarEvent").mockResolvedValue({
        success: true,
        eventId: "cal-carlos-name-123",
        meetUrl: "https://meet.google.com/abc-carlos",
      });

      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("public.heloisa_agendas")) {
            return {
              rows: [
                { nome: "Carlos Arantes", email: "carlosarantes524@gmail.com", telefone: "5534991234567", notificar_whatsapp: true },
                { nome: "Conrado Finzi", email: "conradofl@gmail.com", telefone: "5534997817660", notificar_whatsapp: true },
              ],
            };
          }
          if (sql.includes("public.events")) {
            return { rows: [{ id: "evt-1" }] };
          }
          return { rows: [] };
        }),
      };

      const res = await executarAgendarCompromisso(
        {
          titulo: "Reunião de Tráfego",
          data_hora: "2026-11-20 16:00",
          agenda_alvo: "Carlos",
        },
        mockPool,
        "vexo-adm-vexo-atende",
        { nome: "Carlos Arantes", telefone: "5534991234567" }
      );

      expect(res.sucesso).toBe(true);
      expect(calSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryCalendarId: "carlosarantes524@gmail.com",
          strictAttendees: true,
        })
      );
      expect(res.attendees).toEqual(["carlosarantes524@gmail.com"]);
    });

    it("quando o usuário diz 'no meu e-mail Carlos', não injeta a diretoria e grava na agenda do Carlos", async () => {
      const calSpy = vi.spyOn(gdCalendarService, "createBriefingCalendarEvent").mockResolvedValue({
        success: true,
        eventId: "cal-email-carlos",
        meetUrl: "https://meet.google.com/abc-carlos",
      });

      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("public.heloisa_agendas")) {
            return {
              rows: [
                { nome: "Carlos Arantes", email: "carlosarantes524@gmail.com", telefone: "5534991234567", notificar_whatsapp: true },
                { nome: "Conrado Finzi", email: "conradofl@gmail.com", telefone: "5534997817660", notificar_whatsapp: true },
                { nome: "Caio Almeida", email: "caioalmeidamrk@gmail.com", telefone: "5534997719779", notificar_whatsapp: true },
              ],
            };
          }
          if (sql.includes("public.events")) {
            return { rows: [{ id: "evt-email-carlos" }] };
          }
          return { rows: [] };
        }),
      };

      const res = await executarAgendarCompromisso(
        {
          titulo: "Alinhamento de Tráfego",
          data_hora: "2026-11-20 17:00",
          participantes_extras: "no meu e-mail Carlos",
        },
        mockPool,
        "vexo-adm-vexo-atende",
        { nome: "Carlos Arantes", telefone: "5534991234567" }
      );

      expect(res.sucesso).toBe(true);
      expect(calSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryCalendarId: "carlosarantes524@gmail.com",
          strictAttendees: true,
        })
      );
      expect(res.attendees).toEqual(["carlosarantes524@gmail.com"]);
      expect(res.attendees).not.toContain("conradofl@gmail.com");
      expect(res.attendees).not.toContain("caioalmeidamrk@gmail.com");
    });
  });
});
