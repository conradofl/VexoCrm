// Padrões da Empresa → aba Teste: a memória da conversa mora na tela, não num
// lead do banco. Antes a aba mandava o telefone fixo 5511999999999 e o motor
// gravava esse lead em public.leads — fantasma no Banco, elegível em
// "selecionar todos". E o "Limpar conversa" só limpava a tela: o agente
// continuava lembrando.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TabTeste } from "@/pages/ChatbotSettings/TabTeste";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: async () => "token-de-teste" }),
}));

let pendentes: Array<(texto: string) => void>;
let falhas: Array<{ http: (status: number) => void; rede: () => void }>;
let corpos: any[];
const fetchApiMock = vi.fn();
vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...real, fetchApi: (...args: unknown[]) => fetchApiMock(...args) };
});

beforeEach(() => {
  pendentes = [];
  falhas = [];
  corpos = [];
  fetchApiMock.mockReset();
  // Cada envio fica pendurado até o teste responder; a memória devolvida é o
  // histórico recebido mais o turno novo, como o motor faz.
  fetchApiMock.mockImplementation((_url: string, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    corpos.push(body);
    return new Promise((resolve, reject) => {
      falhas.push({
        http: (status: number) =>
          resolve({
            ok: false,
            status,
            headers: { get: () => "application/json" },
            json: async () => ({ error: { message: "ERRO ANTIGO" } }),
            text: async () => JSON.stringify({ error: { message: "ERRO ANTIGO" } }),
          }),
        rede: () => reject(new TypeError("Failed to fetch")),
      });
      pendentes.push((texto: string) => {
        const corpo = {
          response: texto,
          simulacao: {
            historico: [
              ...(body.simulacao?.historico || []),
              { role: "user", content: body.message },
              { role: "assistant", content: texto },
            ],
            dados: {},
          },
        };
        resolve({
          ok: true,
          status: 200,
          headers: { get: () => "application/json" },
          json: async () => corpo,
          text: async () => JSON.stringify(corpo),
        });
      });
    });
  });
});

async function enviar(texto: string) {
  fireEvent.change(screen.getByPlaceholderText(/mensagem/i), { target: { value: texto } });
  fireEvent.click(screen.getByRole("button", { name: /enviar/i }));
  await screen.findByText(texto);
}

async function responder(texto: string) {
  pendentes.shift()!(texto);
  await screen.findByText(texto);
}

describe("aba Teste — memória na tela", () => {
  it("[TESTE OBRIGATÓRIO] T1 primeiro envio vai em simulação, sem memória e sem o telefone fixo 5511999999999", async () => {
    render(<TabTeste clientId="container-led" />);
    await enviar("oi");
    expect(corpos[0].simulacao).toEqual({ historico: [], dados: {} });
    expect(corpos[0].phone).toBeUndefined();
  });

  it("[TESTE OBRIGATÓRIO] T2 o segundo envio leva a memória que o servidor devolveu", async () => {
    render(<TabTeste clientId="container-led" />);
    await enviar("oi, sou a Ana");
    await responder("Olá Ana");
    await enviar("quero sofá");
    expect(corpos[1].simulacao.historico).toEqual([
      { role: "user", content: "oi, sou a Ana" },
      { role: "assistant", content: "Olá Ana" },
    ]);
  });

  it("[TESTE OBRIGATÓRIO] T3 'Limpar conversa' zera a tela E a memória", async () => {
    render(<TabTeste clientId="container-led" />);
    await enviar("oi, sou a Ana");
    await responder("Olá Ana");
    fireEvent.click(screen.getByRole("button", { name: /Limpar conversa/ }));
    expect(screen.queryByText("Olá Ana")).toBeNull();
    await enviar("assunto novo");
    expect(corpos.at(-1).simulacao).toEqual({ historico: [], dados: {} });
  });

  it("[TESTE OBRIGATÓRIO] T4 resposta em voo na hora da limpeza é descartada e não entra na memória nova", async () => {
    render(<TabTeste clientId="container-led" />);
    await enviar("pergunta antiga");
    fireEvent.click(screen.getByRole("button", { name: /Limpar conversa/ }));

    // Dá para enviar de novo na hora, sem esperar a resposta antiga.
    await enviar("pergunta nova");
    pendentes.shift()!("RESPOSTA ANTIGA");
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => expect(screen.queryByText("RESPOSTA ANTIGA")).toBeNull());

    await responder("resposta nova");
    await enviar("e mais?");
    expect(corpos.at(-1).simulacao.historico.map((h: any) => h.content)).toEqual(["pergunta nova", "resposta nova"]);
  });

  it("T5 resposta antiga que cai depois da limpeza não destrava o envio da conversa nova", async () => {
    render(<TabTeste clientId="container-led" />);
    await enviar("pergunta antiga");
    fireEvent.click(screen.getByRole("button", { name: /Limpar conversa/ }));
    await enviar("pergunta nova");
    pendentes.shift()!("RESPOSTA ANTIGA");
    await new Promise((r) => setTimeout(r, 0));
    // "pergunta nova" ainda espera resposta: o campo segue travado.
    expect(screen.getByPlaceholderText(/mensagem/i)).toBeDisabled();
  });

  it("[TESTE OBRIGATÓRIO] T6 erro HTTP da conversa antiga que chega depois da limpeza não aparece na nova", async () => {
    render(<TabTeste clientId="container-led" />);
    await enviar("pergunta antiga");
    fireEvent.click(screen.getByRole("button", { name: /Limpar conversa/ }));
    await enviar("pergunta nova");
    falhas.shift()!.http(500);
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => expect(screen.queryByText(/ERRO ANTIGO/)).toBeNull());
    expect(screen.queryByText(/^Erro:/)).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] T7 falha de rede da conversa antiga que chega depois da limpeza não aparece na nova", async () => {
    render(<TabTeste clientId="container-led" />);
    await enviar("pergunta antiga");
    fireEvent.click(screen.getByRole("button", { name: /Limpar conversa/ }));
    await enviar("pergunta nova");
    falhas.shift()!.rede();
    await new Promise((r) => setTimeout(r, 0));
    await waitFor(() => expect(screen.queryByText(/^Falha:/)).toBeNull());
  });
});
