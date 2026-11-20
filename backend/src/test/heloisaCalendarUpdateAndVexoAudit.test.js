import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  executarAgendarCompromisso,
  executarAtualizarCompromisso,
  resolveTenantOuEmpresa,
  executarConsultarCampanhasVexo,
  executarConsultarDashboardVexo,
  executarConsultarChipsWhatsapp,
  HELOISA_TOOLS,
} from "../domains/goclaw/heloisaEngine.js";
import * as gdCalendarService from "../services/gdCalendarService.js";

describe("Heloísa — Agenda Caio (Horários & Edição) e Consultas Vexo OS (Campanhas, Dashboard, Chips)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("1. Duração Real e Horário de Término em agendar_compromisso", () => {
    it("detecta automaticamente intervalo 'das 9 às 12' no texto/título gerando evento de 180 min (09:00 às 12:00)", async () => {
      let createdEventPayload = null;
      vi.spyOn(gdCalendarService, "createBriefingCalendarEvent").mockImplementation(async (payload) => {
        createdEventPayload = payload;
        return { success: true, eventId: "evt-aula-caio-1", meetUrl: "https://meet.google.com/abc-def-ghi" };
      });

      const mockPool = {
        query: vi.fn().mockImplementation(async (sql) => {
          if (sql.includes("heloisa_agendas")) {
            return {
              rows: [
                { nome: "Caio Almeida", email: "caioalmeidamrk@gmail.com", telefone: "5534997719779", ativo: true, notificar_whatsapp: true },
              ],
            };
          }
          if (sql.includes("INSERT INTO public.events")) {
            return { rows: [{ id: "evt-db-1" }] };
          }
          return { rows: [] };
        }),
      };

      const res = await executarAgendarCompromisso(
        {
          titulo: "Aula pós-graduação das 9 às 12",
          data_hora: "2026-11-21 09:00",
          agenda_alvo: "Caio",
        },
        mockPool,
        "instancia-teste",
        { nome: "Caio Almeida", email: "caioalmeidamrk@gmail.com", telefone: "5534997719779" }
      );

      expect(res.sucesso).toBe(true);
      expect(createdEventPayload).toBeDefined();

      const start = new Date(createdEventPayload.start);
      const end = new Date(createdEventPayload.end);
      const diffMinutes = Math.round((end.getTime() - start.getTime()) / (60 * 1000));

      // Duração de 3 horas (180 minutos)
      expect(diffMinutes).toBe(180);
      expect(res.duracaoMinutos).toBe(180);
      expect(res.googleCalendarLink).toContain("/render?action=TEMPLATE");
      expect(res.googleCalendarLink).toMatch(/dates=\d{8}T\d{6}Z%2F\d{8}T\d{6}Z/);
    });

    it("respeita parâmetros explícitos hora_fim / duracao_minutos quando fornecidos", async () => {
      let createdEventPayload = null;
      vi.spyOn(gdCalendarService, "createBriefingCalendarEvent").mockImplementation(async (payload) => {
        createdEventPayload = payload;
        return { success: true, eventId: "evt-reuniao-2" };
      });

      const mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };

      const res = await executarAgendarCompromisso(
        {
          titulo: "Alinhamento Estratégico",
          data_hora: "2026-11-20 19:00",
          hora_fim: "22:00",
          agenda_alvo: "Caio",
        },
        mockPool
      );

      expect(res.sucesso).toBe(true);
      const start = new Date(createdEventPayload.start);
      const end = new Date(createdEventPayload.end);
      const diffMinutes = Math.round((end.getTime() - start.getTime()) / (60 * 1000));
      expect(diffMinutes).toBe(180);
      expect(res.duracaoMinutos).toBe(180);
    });
  });

  describe("2. Tool atualizar_compromisso e updateBriefingCalendarEvent", () => {
    it("updateBriefingCalendarEvent em gdCalendarService executa PATCH no Google Calendar API", async () => {
      let patchUrl = null;
      let patchBody = null;
      let patchMethod = null;

      vi.stubGlobal(
        "fetch",
        vi.fn().mockImplementation(async (url, opts) => {
          patchUrl = String(url);
          patchMethod = opts?.method;
          patchBody = JSON.parse(opts?.body || "{}");
          return new Response(JSON.stringify({ id: "evt-patch-123", summary: patchBody.summary }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        })
      );

      vi.spyOn(gdCalendarService, "getGoogleCalendarAccessToken").mockResolvedValue("mock-google-token");

      const updateRes = await gdCalendarService.updateBriefingCalendarEvent({
        eventId: "evt-patch-123",
        calendarId: "caioalmeidamrk@gmail.com",
        startIso: "2026-11-21T09:00:00-03:00",
        endIso: "2026-11-21T12:00:00-03:00",
        title: "Aula pós-graduação Caio",
      });

      expect(updateRes.success).toBe(true);
      expect(patchMethod).toBe("PATCH");
      expect(patchUrl).toContain("/calendars/caioalmeidamrk%40gmail.com/events/evt-patch-123");
      expect(patchBody.start.dateTime).toBe("2026-11-21T09:00:00-03:00");
      expect(patchBody.end.dateTime).toBe("2026-11-21T12:00:00-03:00");
    });

    it("executarAtualizarCompromisso localiza eventos do Caio e ajusta o horário com sucesso", async () => {
      let calendarUpdateCalled = false;
      vi.spyOn(gdCalendarService, "updateBriefingCalendarEvent").mockImplementation(async (opts) => {
        calendarUpdateCalled = true;
        return { success: true, eventId: opts.eventId };
      });

      const updatedEventRows = [];
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql, params) => {
          if (sql.includes("SELECT") && sql.includes("public.events")) {
            return {
              rows: [
                {
                  id: "evt-caio-sabado",
                  name: "Aula pós-graduação Caio",
                  date: "2026-11-21T09:00:00-03:00",
                  description: "Aula no sábado",
                },
              ],
            };
          }
          if (sql.includes("UPDATE public.events")) {
            updatedEventRows.push(params);
            return { rowCount: 1 };
          }
          if (sql.includes("heloisa_agendas")) {
            return {
              rows: [{ nome: "Caio Almeida", email: "caioalmeidamrk@gmail.com", ativo: true }],
            };
          }
          return { rows: [] };
        }),
      };

      const res = await executarAtualizarCompromisso(
        {
          termo_busca: "Aula",
          data: "2026-11-21",
          nova_hora_inicio: "09:00",
          nova_hora_fim: "12:00",
          agenda_alvo: "Caio",
        },
        mockPool
      );

      expect(res.sucesso).toBe(true);
      expect(res.atualizados).toBe(1);
      expect(calendarUpdateCalled).toBe(true);
      expect(res.mensagem).toContain("horário ajustado com sucesso");
    });
  });

  describe("3. Resolvedor Universal de Tenant/Empresa (resolveTenantOuEmpresa)", () => {
    it("resolve 'NUS' com sucesso para 'nous-gestao' buscando por similaridade na base", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql, params) => {
          if (sql.includes("leads_clients")) {
            return {
              rows: [
                { id: "nous-gestao", name: "Nous Gestão Financeira" },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const res = await resolveTenantOuEmpresa("NUS", mockPool);
      expect(res).toBeDefined();
      expect(res.clientId).toBe("nous-gestao");
      expect(res.clientName).toContain("Nous Gestão");
    });

    it("resolve 'Nous' ou 'Nous Gestão' direto para o tenant correto", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql, params) => {
          if (sql.includes("leads_clients")) {
            return {
              rows: [{ id: "nous-gestao", name: "Nous Gestão" }],
            };
          }
          return { rows: [] };
        }),
      };

      const res = await resolveTenantOuEmpresa("Nous Gestão", mockPool);
      expect(res.clientId).toBe("nous-gestao");
    });
  });

  describe("4. Tool consultar_campanhas_vexo", () => {
    it("retorna campanhas pausadas com enviados (30), respostas (13) e motivo da pausa (reinício do servidor)", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql, params) => {
          if (sql.includes("leads_clients")) {
            return { rows: [{ id: "nous-gestao", name: "Nous Gestão" }] };
          }
          if (sql.includes("FROM public.campaigns") || sql.includes("FROM public.campaign_dispatches")) {
            return {
              rows: [
                {
                  campaign_id: "c-mesa-2",
                  campaign_name: "Evento Mesa de Negocios 2 - Planilha Moacir",
                  status: "paused",
                  target_count: 50,
                  sent_count: 30,
                  replied_count: 13,
                  chip_name: "Chip-6048",
                  chip_phone: "+554699006048",
                  error_message: "Lote 2: Pausado - servidor reiniciou durante o envio. Retome quando quiser",
                  failed_count: 0,
                  pending_count: 20,
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const res = await executarConsultarCampanhasVexo(
        { empresa_nome: "Nous Gestão", status: "pausada" },
        mockPool
      );

      expect(res.sucesso).toBe(true);
      expect(res.campanhas).toBeDefined();
      expect(res.campanhas.length).toBe(1);

      const c = res.campanhas[0];
      expect(c.nome).toContain("Evento Mesa de Negocios 2");
      expect(c.statusFormatado).toMatch(/Pausad[ao]/i);
      expect(c.enviados).toBe(30);
      expect(c.respostas).toBe(13);
      expect(c.chip).toContain("Chip-6048");
      expect(c.motivoPausa).toContain("servidor reiniciou");
      expect(res.mensagem).toContain("Evento Mesa de Negocios 2");
      expect(res.mensagem).toContain("servidor reiniciou");
    });
  });

  describe("5. Tool consultar_dashboard_vexo", () => {
    it("retorna pessoas aguardando resposta (e quantas há mais de 3h), nunca abordados e funil", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql, params) => {
          if (sql.includes("leads_clients")) {
            return { rows: [{ id: "nous-gestao", name: "Nous Gestão" }] };
          }
          // Overview métricas
          if (sql.includes("leads") && sql.includes("COUNT")) {
            return {
              rows: [
                {
                  waiting_count: 42,
                  waiting_over_3h: 15,
                  never_approached_count: 340,
                  total_base: 1900,
                  reached_count: 1200,
                  replied_count: 240,
                  scheduled_meetings_count: 18,
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const res = await executarConsultarDashboardVexo(
        { empresa_nome: "Nous Gestão" },
        mockPool
      );

      expect(res.sucesso).toBe(true);
      expect(res.metricas).toBeDefined();
      expect(res.metricas.aguardandoResposta).toBe(42);
      expect(res.metricas.aguardandoMaisDe3h).toBe(15);
      expect(res.metricas.nuncaAbordados).toBe(340);
      expect(res.metricas.funil.receberam).toBe(1200);
      expect(res.metricas.funil.responderam).toBe(240);
      expect(res.metricas.funil.taxaConversaoRespostaPct).toBeCloseTo(20.0, 1);
      expect(res.metricas.funil.agendaramReuniao).toBe(18);
      expect(res.mensagem).toContain("42 pessoas aguardando resposta");
      expect(res.mensagem).toContain("15 há mais de 3 horas");
      expect(res.mensagem).toContain("340 contatos nunca abordados");
    });
  });

  describe("6. Tool consultar_chips_whatsapp e Auditoria Baseada em connection_state", () => {
    it("identifica chips desconectados baseado em connection_state diferente de 'open'", async () => {
      const mockPool = {
        query: vi.fn().mockImplementation(async (sql, params) => {
          if (sql.includes("lead_client_evolution_instances")) {
            return {
              rows: [
                {
                  id: "chip-1",
                  name: "Chip 1 - Atendimento",
                  phone: "5534991110001",
                  active: true,
                  connection_state: "open",
                },
                {
                  id: "chip-2",
                  name: "Chip 2 - 7410",
                  phone: "5546933007410",
                  active: true, // active é true mas caiu na Evolution!
                  connection_state: "close",
                },
                {
                  id: "chip-3",
                  name: "Chip 3 - 6048",
                  phone: "554699006048",
                  active: true,
                  connection_state: "disconnected",
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const res = await executarConsultarChipsWhatsapp(
        { empresa_nome: "Nous Gestão" },
        mockPool
      );

      expect(res.sucesso).toBe(true);
      expect(res.totalChips).toBe(3);
      expect(res.chipsConectados).toBe(1);
      expect(res.chipsDesconectados).toBe(2);
      expect(res.listaCaidos).toBeDefined();
      expect(res.listaCaidos.length).toBe(2);

      const caido1 = res.listaCaidos.find((c) => c.nome.includes("Chip 2 - 7410"));
      expect(caido1).toBeDefined();
      expect(caido1.telefone).toBe("5546933007410");
      expect(caido1.statusConexao).toBe("Desconectado");

      expect(res.mensagem).toContain("2 chip(s) desconectado(s)");
      expect(res.mensagem).toContain("Chip 2 - 7410");
    });
  });

  describe("7. Registro e Validação em HELOISA_TOOLS", () => {
    it("HELOISA_TOOLS registra as novas ferramentas operacionais", () => {
      const toolNames = HELOISA_TOOLS.map((t) => t.function?.name);
      expect(toolNames).toContain("agendar_compromisso");
      expect(toolNames).toContain("atualizar_compromisso");
      expect(toolNames).toContain("consultar_campanhas_vexo");
      expect(toolNames).toContain("consultar_dashboard_vexo");
      expect(toolNames).toContain("consultar_chips_whatsapp");
    });
  });
});
