// O simulador precisa dizer o que houve, não "Failed to fetch".
//
// O caminho do simulador (/api/chatbot-test) usa o MESMO fetchApi já corrigido —
// então o retry cross-origin em 502 não acontece mais. O que sobrava eram dois
// buracos do lado da tela: o timeout padrão de 15s, curto demais para um turno
// de LLM com rotação de modelos, e o catch imprimindo a exceção crua.

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TabTeste } from "@/pages/ChatbotSettings/TabTeste";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: async () => "token-de-teste" }),
}));

const fetchApiMock = vi.fn();
vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...real, fetchApi: (...args: unknown[]) => fetchApiMock(...args) };
});

function respostaJson(status: number, corpo: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => corpo,
    text: async () => JSON.stringify(corpo),
  };
}

async function enviar(texto = "oi") {
  render(<TabTeste clientId="sonhare" />);
  fireEvent.change(screen.getByPlaceholderText(/mensagem/i), { target: { value: texto } });
  fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
}

beforeEach(() => fetchApiMock.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("erro do chatbot-test chega legível na tela", () => {
  it("mostra o reason do backend, não um genérico", async () => {
    fetchApiMock.mockResolvedValue(
      respostaJson(502, {
        success: false,
        error: "Não foi possível gerar a resposta.",
        reason: "O modelo respondeu, mas sem texto na chave \"mensagem\".",
        code: "MODEL_EMPTY_MESSAGE",
      })
    );

    await enviar();
    await waitFor(() => {
      expect(screen.getByText(/sem texto na chave/i)).toBeTruthy();
    });
  });

  it("timeout vira explicação, não 'Failed to fetch'", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    fetchApiMock.mockRejectedValue(abort);

    await enviar();
    await waitFor(() => {
      expect(screen.getByText(/demorou demais para responder/i)).toBeTruthy();
    });
  });

  it("falha de rede diz o que verificar", async () => {
    fetchApiMock.mockRejectedValue(new TypeError("Failed to fetch"));

    await enviar();
    await waitFor(() => {
      expect(screen.getByText(/Backend fora do ar, ou a origem/i)).toBeTruthy();
    });
  });
});

describe("resposta boa com problema por trás não passa calada", () => {
  it("avisa quando a resposta saiu mas NÃO foi salva", async () => {
    fetchApiMock.mockResolvedValue(
      respostaJson(200, {
        success: true,
        response: "Oi! Para onde você quer viajar?",
        avisos: ["A resposta foi gerada mas NÃO foi salva (column nao existe). O histórico se perdeu: o próximo turno vai começar sem memória."],
      })
    );

    await enviar();
    await waitFor(() => {
      expect(screen.getByText(/Oi! Para onde você quer viajar\?/)).toBeTruthy();
      expect(screen.getByText(/NÃO foi salva/)).toBeTruthy();
    });
  });

  it("avisa quando a resposta repete a anterior", async () => {
    fetchApiMock.mockResolvedValue(
      respostaJson(200, {
        success: true,
        response: "Você já tem alguma praia em mente?",
        avisos: ["Esta resposta é idêntica à anterior — sinal de que o histórico não chegou ao modelo."],
      })
    );

    await enviar();
    await waitFor(() => {
      expect(screen.getByText(/idêntica à anterior/)).toBeTruthy();
    });
  });
});

describe("cota de IA esgotada aparece como tal", () => {
  it("429 vira aviso de cota, com o modelo e o teto — não 'erro técnico'", async () => {
    fetchApiMock.mockResolvedValue(
      respostaJson(429, {
        success: false,
        error: "Cota de IA esgotada",
        reason: "A cota de IA do modelo openai/gpt-oss-20b acabou. Teto de 8.000 tokens por minuto, 6.592 já usados.",
        code: "LLM_QUOTA_EXCEEDED",
        quota: { modelo: "openai/gpt-oss-20b", limiteTpm: 8000, usadoTpm: 6592 },
      })
    );

    await enviar();
    await waitFor(() => {
      // O marcador 🚫 só existe no ramo específico de 429. Sem ele o teste
      // passaria mesmo com o ramo removido, porque readApiErrorMessage também
      // devolve o texto "Cota de IA esgotada" vindo do corpo.
      expect(screen.getByText(/^🚫 Cota de IA esgotada/)).toBeTruthy();
      expect(screen.getByText(/openai\/gpt-oss-20b/)).toBeTruthy();
      expect(screen.getByText(/8\.000 tokens por minuto/)).toBeTruthy();
      expect(screen.queryByText(/^Erro:/)).toBeNull();
    });
  });

  it("não confunde cota com prompt mal configurado", async () => {
    fetchApiMock.mockResolvedValue(
      respostaJson(429, { success: false, error: "Cota de IA esgotada", reason: "teto atingido", code: "LLM_QUOTA_EXCEEDED" })
    );
    await enviar();
    await waitFor(() => expect(screen.getByText(/^🚫 Cota de IA esgotada/)).toBeTruthy());
    expect(screen.queryByText(/Prompt não configurado/i)).toBeNull();
  });
});

describe("chave de IA quebrada aparece como tal", () => {
  it("503 LLM_CREDENTIAL_INVALID vira aviso de credencial, com o provedor — não 'Prompt não configurado'", async () => {
    fetchApiMock.mockResolvedValue(
      respostaJson(503, {
        success: false,
        error: "Credencial de IA inválida",
        reason: "Credencial invalida no provedor gemini. Troque a chave no EasyPanel.",
        code: "LLM_CREDENTIAL_INVALID",
        provedores: ["gemini"],
      })
    );

    await enviar();
    await waitFor(() => {
      expect(screen.getByText(/^🔑 Credencial de IA inválida/)).toBeTruthy();
      expect(screen.getByText(/provedor gemini/)).toBeTruthy();
    });
    expect(screen.queryByText(/Prompt não configurado/i)).toBeNull();
    expect(screen.queryByText(/Cota de IA esgotada/i)).toBeNull();
  });

  it("resposta que veio de outro provedor mostra o aviso da chave quebrada junto", async () => {
    fetchApiMock.mockResolvedValue(
      respostaJson(200, {
        success: true,
        response: "Oi! Como posso ajudar?",
        avisos: ["Credencial inválida no provedor gemini: esta resposta veio de outro provedor da escada. Troque a chave no EasyPanel."],
      })
    );

    await enviar();
    await waitFor(() => {
      expect(screen.getByText("Oi! Como posso ajudar?")).toBeTruthy();
      expect(screen.getByText(/Credencial inválida no provedor gemini/)).toBeTruthy();
    });
  });
});

describe("o turno da LLM ganha tempo suficiente", () => {
  it("a chamada pede timeout maior que o padrão de 15s", async () => {
    fetchApiMock.mockResolvedValue(respostaJson(200, { success: true, response: "oi" }));
    await enviar();
    await waitFor(() => expect(fetchApiMock).toHaveBeenCalled());
    const [, init] = fetchApiMock.mock.calls[0] as [string, { timeoutMs?: number }];
    expect(init.timeoutMs).toBeGreaterThan(15000);
  });
});
