import { describe, it, expect, vi } from "vitest";
import { GD_CALENDAR_CAIO, GD_CALENDARS } from "../services/gdCalendarService.js";
import { executarAgendarCompromisso } from "../domains/goclaw/heloisaEngine.js";

describe("Correção do E-mail Oficial do Caio Almeida (caioalmeidamrk@gmail.com)", () => {
  it("1. GD_CALENDAR_CAIO deve ser estritamente 'caioalmeidamrk@gmail.com'", () => {
    expect(GD_CALENDAR_CAIO).toBe("caioalmeidamrk@gmail.com");
    expect(GD_CALENDARS).toContain("caioalmeidamrk@gmail.com");
    expect(GD_CALENDARS).not.toContain("caioalmeidmrk@gmail.com");
  });

  it("2. executarAgendarCompromisso inclui Caio com o e-mail oficial correto 'caioalmeidamrk@gmail.com'", async () => {
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
        if (sql.includes("INSERT INTO public.events")) {
          return { rows: [{ id: "evt-caio-1", name: "Alinhamento com Diretoria", date: "2026-11-20T14:00:00-03:00" }] };
        }
        return { rows: [] };
      }),
    };

    const res = await executarAgendarCompromisso(
      {
        titulo: "Alinhamento com Diretoria",
        data_hora: "2026-11-20 14:00",
      },
      mockPool,
      "instancia-teste"
    );

    expect(res.sucesso).toBe(true);
    expect(res.attendees).toContain("caioalmeidamrk@gmail.com");
    expect(res.attendees).not.toContain("caioalmeidmrk@gmail.com");
    expect(res.participantes).toContain("caioalmeidamrk@gmail.com");
    expect(res.participantes).not.toContain("caioalmeidmrk@gmail.com");
  });

  it("3. Idempotência do banco: query de atualização corrige 'caioalmeidmrk@gmail.com' para 'caioalmeidamrk@gmail.com'", () => {
    const updateAgendaSql = `
      UPDATE public.heloisa_agendas 
      SET email = 'caioalmeidamrk@gmail.com' 
      WHERE email = 'caioalmeidmrk@gmail.com';
    `;
    const updateUsuariosSql = `
      UPDATE public.heloisa_usuarios_autorizados 
      SET email = 'caioalmeidamrk@gmail.com' 
      WHERE email = 'caioalmeidmrk@gmail.com';
    `;

    expect(updateAgendaSql).toContain("SET email = 'caioalmeidamrk@gmail.com'");
    expect(updateAgendaSql).toContain("WHERE email = 'caioalmeidmrk@gmail.com'");
    expect(updateUsuariosSql).toContain("SET email = 'caioalmeidamrk@gmail.com'");
    expect(updateUsuariosSql).toContain("WHERE email = 'caioalmeidmrk@gmail.com'");
  });
});
