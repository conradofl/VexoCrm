// src/test/proposalDetailPanel.test.tsx
//
// Propostas: o painel da direita deixou de embutir a proposta (iframe de 70vh que ninguém usava — para conferir,
// abre-se a proposta de verdade). Ao selecionar uma proposta aparece o resumo (cliente, valor, estado, data) e
// as ações. Nenhuma ação que existia foi removida.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createGdBackend } from "./helpers/gdProposalsBackend";
import proposalsSrc from "../pages/GeracaoDigitalProposals.tsx?raw";

let backend = createGdBackend();
let accessProfile: any = { role: "client" };
const navigateMock = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    getIdToken: async () => "token",
    isAuthenticated: true,
    clientId: "tenant-x",
    get accessProfile() {
      return accessProfile;
    },
  }),
}));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, useNavigate: () => navigateMock, useLocation: () => ({ pathname: "/propostas-gd", search: "" }) };
});
vi.mock("@/lib/api", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, fetchApi: (...args: any[]) => (backend.fetchApi as any)(...args) };
});

const PROPOSTAS = [
  { id: "p-rascunho", prospect_name: "Clínica Rascunho", itens: [{ descricao: "Plano", categoria: "gd", valor: 5000, periodicidade: "mensal" }], condicoes: "", status: "rascunho", created_at: "2026-10-01T10:00:00Z", owner_company: "geracao-digital" },
  { id: "p-enviada", prospect_name: "Clínica Enviada", itens: [], condicoes: "", status: "enviada", created_at: "2026-09-20T10:00:00Z", owner_company: "geracao-digital" },
  { id: "p-aceita", prospect_name: "Clínica Aceita", itens: [], condicoes: "", status: "aceita", created_at: "2026-09-10T10:00:00Z", owner_company: "geracao-digital" },
];

async function abrirPagina() {
  backend = createGdBackend({ proposals: PROPOSTAS.map((p) => ({ ...p })) });
  const { default: Page } = await import("../pages/GeracaoDigitalProposals");
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Page />
    </QueryClientProvider>
  );
  await screen.findByTestId("proposal-card-p-rascunho");
}

/** seleciona pelo botão "Selecionar" do cartão e espera o painel da direita */
async function selecionar(id: string, nome: string) {
  // (a página já abre com a primeira proposta selecionada: nesse caso o botão diz "Selecionada")
  const alvo = within(screen.getByTestId(`proposal-card-${id}`)).getByRole("button", { name: /^Selecion/ });
  if (/^Selecionar$/.test(alvo.textContent || "")) fireEvent.click(alvo);
  await screen.findByRole("heading", { name: nome });
}

const botao = (nome: string | RegExp) => screen.queryByRole("button", { name: nome });

// As ações que a tela tinha ANTES de tirar a visualização, por situação da proposta. Nenhuma pode sumir.
const ACOES_SEMPRE = ["Gerar Contrato Jurídico", "Arquivar", "Iniciar Apresentação", "Gerar Pitch com IA", "Editar Slides Visualmente", "Enviar ao Cliente"];
const ACOES_NAO_ACEITA = ["Editar Proposta", "Abrir Proposta", "Excluir Rascunho"];

beforeEach(() => {
  vi.clearAllMocks();
  accessProfile = { role: "client" };
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => cleanup());

describe("Propostas sem a visualização embutida", () => {
  it("[TESTE OBRIGATÓRIO] selecionar uma proposta mostra o resumo e as ações, SEM a proposta embutida", async () => {
    await abrirPagina();
    await selecionar("p-rascunho", "Clínica Rascunho");

    // sem a visualização: nada de iframe, nem o título dela
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByTitle("Pré-visualização da proposta")).toBeNull();
    // com o resumo: cliente, valor, estado, data
    const resumo = within(screen.getByTestId("proposal-summary"));
    expect(resumo.getByText("Clínica Rascunho")).toBeTruthy();
    expect(resumo.getByText("Rascunho")).toBeTruthy();
    expect(resumo.getByText(/^R\$ /)).toBeTruthy();
    expect(resumo.getByText("01/10/2026")).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] o resumo traz os MESMOS quatro campos do cartão da lateral (cliente, estado, valor, data)", async () => {
    await abrirPagina();
    await selecionar("p-enviada", "Clínica Enviada");

    const doCartao = [...screen.getByTestId("proposal-card-p-enviada").querySelectorAll("[data-field]")].map((f) => [f.getAttribute("data-field"), f.textContent]);
    const doResumo = [...screen.getByTestId("proposal-summary").querySelectorAll("[data-field]")].map((f) => [f.getAttribute("data-field"), f.textContent]);

    expect(doResumo.sort()).toEqual(doCartao.sort());
    expect(doResumo.map(([k]) => k).sort()).toEqual(["date", "name", "status", "value"]);
  });

  it("[TESTE OBRIGATÓRIO] proposta em rascunho/enviada mantém TODAS as ações que tinha", async () => {
    await abrirPagina();
    for (const [id, nome] of [
      ["p-rascunho", "Clínica Rascunho"],
      ["p-enviada", "Clínica Enviada"],
    ]) {
      await selecionar(id, nome);
      for (const acao of [...ACOES_SEMPRE, ...ACOES_NAO_ACEITA]) expect(botao(acao), `${nome}: ação '${acao}' sumiu`).toBeTruthy();
    }
  });

  it("[TESTE OBRIGATÓRIO] proposta aceita mantém as ações que tinha (e continua sem editar, abrir e excluir)", async () => {
    await abrirPagina();
    await selecionar("p-aceita", "Clínica Aceita");

    for (const acao of ACOES_SEMPRE) expect(botao(acao), `ação '${acao}' sumiu`).toBeTruthy();
    for (const acao of ACOES_NAO_ACEITA) expect(botao(acao), `ação '${acao}' não devia aparecer em proposta aceita`).toBeNull();
    expect(botao("Reabrir Proposta")).toBeNull(); // só gestor/admin
  });

  it("gestor vê 'Reabrir Proposta' na aceita, como antes", async () => {
    accessProfile = { role: "internal", isAdmin: true };
    await abrirPagina();
    await selecionar("p-aceita", "Clínica Aceita");

    expect(botao("Reabrir Proposta")).toBeTruthy();
  });

  it("as ações continuam FAZENDO o que faziam: abrir, apresentar e o que depende da proposta selecionada", async () => {
    await abrirPagina();
    await selecionar("p-enviada", "Clínica Enviada");

    fireEvent.click(botao("Abrir Proposta")!);
    expect(navigateMock).toHaveBeenCalledWith("/proposta/p-enviada");
    fireEvent.click(botao("Iniciar Apresentação")!);
    expect(navigateMock).toHaveBeenCalledWith("/crm/propostas-gd/p-enviada/apresentacao");
  });

  it("[TESTE OBRIGATÓRIO] editar abre o formulário (e só ele) e fechar volta ao resumo, ainda sem a proposta embutida", async () => {
    await abrirPagina();
    await selecionar("p-rascunho", "Clínica Rascunho");

    fireEvent.click(botao("Editar Proposta")!);
    await screen.findByTestId("proposal-editor");
    expect(document.querySelector("iframe")).toBeNull();

    fireEvent.click(botao("Fechar edição")!);
    expect(screen.queryByTestId("proposal-editor")).toBeNull();
    expect(screen.getByTestId("proposal-summary")).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("o texto do painel não promete mais 'exatamente o que o cliente vê' — manda abrir a proposta", async () => {
    await abrirPagina();
    await selecionar("p-rascunho", "Clínica Rascunho");

    expect(screen.queryByText(/Exatamente o que o cliente vê/)).toBeNull();
    expect(screen.getByText(/use "Abrir Proposta"/i)).toBeTruthy();
  });

  it("o código da página não embute mais a proposta (iframe, ?embed=1, recarga do preview)", () => {
    expect(proposalsSrc).not.toMatch(/<iframe|embed=1|previewNonce|Pré-visualização da proposta/);
  });
});
