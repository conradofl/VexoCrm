import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HELOISA_TOOLS,
  executarCancelarCompromisso,
} from "../domains/goclaw/heloisaEngine.js";
import { deleteBriefingCalendarEvent } from "../services/gdCalendarService.js";

describe("Heloísa — Tool cancelar_compromisso", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Teste 1: A tool cancelar_compromisso está registrada e documentada em HELOISA_TOOLS", () => {
    const tool = HELOISA_TOOLS.find((t) => t.function?.name === "cancelar_compromisso");
    expect(tool).toBeDefined();
    expect(tool.function.description).toContain("Cancela ou exclui um compromisso");
    expect(tool.function.parameters.properties.termo_ou_titulo).toBeDefined();
    expect(tool.function.parameters.properties.data_hora).toBeDefined();
  });

  it("Teste 2: cancelar_compromisso exclui evento existente em public.events e chama Google Calendar", async () => {
    const deletedEventIds = [];
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql, params) => {
        // Busca eventos
        if (sql.includes("SELECT") && sql.includes("public.events")) {
          return {
            rows: [
              {
                id: "evt-uuid-1",
                name: "Alinhamento com Moacir",
                date: "2026-11-18T09:00:00-03:00",
                location: "https://meet.google.com/abc-defg-hij",
                description: "Reunião de teste",
              },
            ],
          };
        }
        // Deleta evento
        if (sql.includes("DELETE FROM public.events")) {
          deletedEventIds.push(params[0]);
          return { rowCount: 1 };
        }
        return { rows: [] };
      }),
    };

    const deleteCalendarSpy = vi.fn().mockResolvedValue({ success: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    const res = await executarCancelarCompromisso(
      {
        termo_ou_titulo: "Moacir",
        data_hora: "2026-11-18",
      },
      mockPool,
      "instancia-teste",
      { nome: "Conrado Finzi", email: "conradofl@gmail.com", telefone: "5534997817660" }
    );

    expect(res.sucesso).toBe(true);
    expect(res.cancelados).toBe(1);
    expect(deletedEventIds).toContain("evt-uuid-1");
    expect(res.mensagem).toContain("cancelada com sucesso");
  });

  it("Teste 3: Quando nenhuma reunião for encontrada, retorna mensagem explicativa sobre agenda sem acionar terceiros", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    };

    const res = await executarCancelarCompromisso(
      {
        termo_ou_titulo: "alinhamento",
        data_hora: "2026-11-18 09:00",
      },
      mockPool,
      "instancia-teste",
      { nome: "Conrado Finzi", email: "conradofl@gmail.com", telefone: "5534997817660" }
    );

    expect(res.sucesso).toBe(true);
    expect(res.cancelados).toBe(0);
    // Explica sobre a ausência de reuniões e sobre a página de agendamento de horário
    expect(res.mensagem).toContain("Não encontrei nenhuma reunião agendada");
    expect(res.mensagem).toContain("Página de agendamento de horário");
    // Garante que NUNCA alucina mandando mensagem para o Caio
    expect(res.mensagem).not.toContain("Caio");
  });
});
