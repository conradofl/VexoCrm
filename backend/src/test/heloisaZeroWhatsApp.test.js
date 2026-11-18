import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enviarMensagemWhatsAppComFallback,
  executarAgendarCompromisso,
  executarCobrarColaborador,
  executarEnviarMensagemWhatsApp,
} from "../domains/goclaw/heloisaEngine.js";
import { sendTextMessageViaEvolution } from "../services/evolution.js";

describe("Blindagem Heloísa: Zero WhatsApp em Testes e Título Preciso de Reuniões", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Espiona fetch para garantir que NENHUMA chamada caia na Evolution real
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("evolution") || urlStr.includes("message/sendText") || urlStr.includes("/group/")) {
        throw new Error(`[VIOLAÇÃO DE BLINDAGEM] Chamada de rede externa não permitida em testes: ${urlStr}`);
      }
      return originalFetch(url);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("1. enviarMensagemWhatsAppComFallback suprime envio real e retorna mock com segurança", async () => {
    const res = await enviarMensagemWhatsAppComFallback({
      numero: "5534997817660",
      texto: "Teste de segurança sem WhatsApp real",
    });

    expect(res).toBeDefined();
    expect(res.sucesso).toBe(true);
    expect(res.mock).toBe(true);
    expect(res.waMessageId).toBe("mock-wa-test-id");
    expect(res.mensagem).toContain("Sucesso simulado em teste.");
  });

  it("2. sendTextMessageViaEvolution suprime disparo em ambiente de teste sem chamar endpoint externo", async () => {
    const res = await sendTextMessageViaEvolution({
      instanceName: "vexo-adm-vexo-atende",
      number: "5534997817660",
      text: "Mensagem direta",
    });

    expect(res).toBeDefined();
    expect(res.mock).toBe(true);
    expect(res.waMessageId).toBe("mock-wa-test-id");
  });

  it("3. executarAgendarCompromisso preserva nomes de participantes e clientes (ex: Moacir)", async () => {
    const mockPool = {
      query: vi.fn().mockImplementation(async (sql) => {
        const sqlLower = sql.toLowerCase();
        if (sqlLower.includes("heloisa_agendas")) {
          return {
            rows: [
              { nome: "Conrado Finzi", email: "conradofinzi@gmail.com", telefone: "5534997817660", notificar_whatsapp: true },
              { nome: "Caio Almeida", email: "caioalmeidamrk@gmail.com", telefone: "5534997719779", notificar_whatsapp: true },
            ],
          };
        }
        if (sqlLower.includes("events")) {
          return { rows: [{ id: "evt-test-1", name: "Reunião de Alinhamento com Moacir" }] };
        }
        return { rows: [] };
      }),
    };

    const res = await executarAgendarCompromisso(
      {
        titulo: "Reunião de Alinhamento com Moacir",
        data_hora: "2026-11-20T15:00:00Z",
      },
      mockPool
    );

    expect(res.sucesso).toBe(true);
    expect(res.titulo).toBe("Reunião de Alinhamento com Moacir");
    expect(res.titulo).toContain("Moacir");
  });

  it("4. executarAgendarCompromisso com título genérico ou vago adota 'Reunião de Alinhamento' sem injetar Caio", async () => {
    const mockPool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: "evt-test-2", name: "Reunião de Alinhamento" }] }),
    };

    const res = await executarAgendarCompromisso(
      {
        titulo: "Compromisso Agendado",
        data_hora: "2026-11-20T16:00:00Z",
      },
      mockPool
    );

    expect(res.sucesso).toBe(true);
    expect(res.titulo).toBe("Reunião de Alinhamento");
    expect(res.titulo).not.toContain("Caio");
  });
});
