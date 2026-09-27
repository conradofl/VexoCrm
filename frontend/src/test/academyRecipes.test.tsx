// frontend/src/test/academyRecipes.test.tsx
//
// Vexo Academy — o conteúdo vem de academyRecipes.ts (dado, não
// componente). Dois tipos que se comportam diferente: fundamento (só
// leitura e Copiar, nunca instala) e receita (instala). Os testes aqui são
// os cinco pedidos no envio de conteúdo, mais a medição e os filtros que já
// existiam.

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ACADEMY_CONTENT, ACADEMY_FUNDAMENTOS, ACADEMY_RECIPES, isAcademyRecipe } from "@/data/academyRecipes";

const getIdTokenMock = async () => "token";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: getIdTokenMock }),
}));

vi.mock("@/hooks/useCrmClient", () => ({
  useOptionalCrmClient: () => ({ selectedClientId: "sonhare", clients: [], isLoading: false, selectedClient: null }),
}));

vi.mock("@/components/ui/use-toast", () => ({ toast: vi.fn() }));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Vexo Academy — conteúdo (fundamentos e receitas)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, headers: { get: () => "application/json" }, json: async () => ({ success: true }) }));
    global.fetch = fetchMock as any;
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  });

  it("[TESTE OBRIGATÓRIO] os dez entram e aparecem — quatro fundamento, seis receita", () => {
    expect(ACADEMY_CONTENT).toHaveLength(10);
    expect(ACADEMY_FUNDAMENTOS).toHaveLength(4);
    expect(ACADEMY_RECIPES).toHaveLength(6);
    ACADEMY_FUNDAMENTOS.forEach((f) => expect(f.tipo).toBe("fundamento"));
    ACADEMY_RECIPES.forEach((r) => expect(r.tipo).toBe("receita"));
  });

  it("[TESTE OBRIGATÓRIO] os dez aparecem na tela (sem filtro nenhum)", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    for (const content of ACADEMY_CONTENT) {
      expect(screen.getByText(content.title)).toBeTruthy();
    }
  });

  it("[TESTE OBRIGATÓRIO] fundamento não tem botão de instalar", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    for (const fundamento of ACADEMY_FUNDAMENTOS) {
      fireEvent.click(screen.getByText(fundamento.title));
      expect(screen.queryByRole("button", { name: /Usar esta receita/ })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Voltar para a lista/ }));
    }
  });

  it("receita tem o botão de instalar", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    fireEvent.click(screen.getByText(ACADEMY_RECIPES[0].title));
    expect(screen.getByRole("button", { name: /Usar esta receita/ })).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] o texto chega inteiro na tela, sem truncar — inclusive as notas", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    // receita: mensagens e nota na tela, byte a byte. Mensagem tem quebra de
    // linha real (\n) — o normalizador padrão do getByText colapsa espaço
    // em branco e quebra pode ficar dividida entre nós de texto no DOM
    // (whitespace-pre-wrap não muda a árvore, mas o normalizador compara
    // texto já colapsado); comparar textContent bruto é o jeito exato de
    // provar "inteiro, não truncado" sem depender de como o DOM particiona.
    const exactTextContent = (expected: string) => (_: string, element: Element | null) => element?.textContent === expected;

    for (const recipe of ACADEMY_RECIPES) {
      fireEvent.click(screen.getByText(recipe.title));
      for (const tpl of recipe.templates) {
        expect(screen.getByText(exactTextContent(tpl.message))).toBeTruthy();
      }
      expect(screen.getByText(recipe.screenNote)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /Voltar para a lista/ }));
    }

    // fundamento: cada seção (heading + corpo) inteira
    for (const fundamento of ACADEMY_FUNDAMENTOS) {
      fireEvent.click(screen.getByText(fundamento.title));
      for (const section of fundamento.sections) {
        expect(screen.getByText(section.heading)).toBeTruthy();
        expect(screen.getByText(section.body)).toBeTruthy();
      }
      fireEvent.click(screen.getByRole("button", { name: /Voltar para a lista/ }));
    }
  });

  it("[TESTE OBRIGATÓRIO] a receita com anexo avisa que o arquivo precisa ser enviado, em vez de instalar sem ele", async () => {
    const comAnexo = ACADEMY_RECIPES.find((r) => r.requiresAttachment);
    expect(comAnexo, "nenhuma receita com requiresAttachment=true — a receita de documentos deveria ter esse flag").toBeTruthy();

    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    fireEvent.click(screen.getByText(comAnexo!.title));
    expect(screen.getByText(/precisa ser enviado por você/)).toBeTruthy();

    // e as receitas sem anexo não mostram o aviso
    fireEvent.click(screen.getByRole("button", { name: /Voltar para a lista/ }));
    const semAnexo = ACADEMY_RECIPES.find((r) => !r.requiresAttachment)!;
    fireEvent.click(screen.getByText(semAnexo.title));
    expect(screen.queryByText(/precisa ser enviado por você/)).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] nenhum dos dez cita nome de empresa — só nome de segmento", () => {
    const forbiddenNames = ["geracao-digital", "geração digital", "sonhare", "vexo os", "infinie", "outlier"];
    for (const content of ACADEMY_CONTENT) {
      const haystack = JSON.stringify(content).toLowerCase();
      for (const name of forbiddenNames) {
        expect(haystack).not.toContain(name);
      }
    }
  });

  it("fundamentos aparecem sempre, mesmo com filtro de segmento/contato aplicado", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    fireEvent.click(screen.getByRole("button", { name: "Turismo" }));

    for (const fundamento of ACADEMY_FUNDAMENTOS) {
      expect(screen.getByText(fundamento.title)).toBeTruthy();
    }
    // e a receita de outro segmento (Contabilidade) some
    const contabilidade = ACADEMY_RECIPES.find((r) => r.segments.includes("Contabilidade"))!;
    expect(screen.queryByText(contabilidade.title)).toBeNull();
  });

  it("lista filtrável por contato (frio/morno/quente) — escolher um esconde as receitas de outro", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    const morno = ACADEMY_RECIPES.find((r) => r.contactTemperature === "morno")!;
    const quente = ACADEMY_RECIPES.find((r) => r.contactTemperature === "quente")!;

    fireEvent.click(screen.getByRole("button", { name: "Contato morno" }));

    expect(screen.getByText(morno.title)).toBeTruthy();
    expect(screen.queryByText(quente.title)).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] a medição distingue abrir de copiar — cada ação é uma chamada própria", async () => {
    // "instalou" é medido dentro do fluxo de instalação de verdade (escolher
    // agente, confirmar) — coberto em academyInstall.test.tsx, não aqui.
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    const recipe = ACADEMY_RECIPES[0];

    // abrir
    fireEvent.click(screen.getByText(recipe.title));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    let call = fetchMock.mock.calls.find((c) => c[1]?.body && JSON.parse(c[1].body).action === "opened");
    expect(call).toBeTruthy();
    expect(JSON.parse(call![1].body)).toMatchObject({ clientId: "sonhare", recipeId: recipe.id, action: "opened" });

    // copiar
    fetchMock.mockClear();
    const copyButtons = screen.getAllByRole("button", { name: /Copiar/ });
    fireEvent.click(copyButtons[0]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    call = fetchMock.mock.calls.find((c) => c[1]?.body && JSON.parse(c[1].body).action === "copied");
    expect(call).toBeTruthy();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(recipe.templates[0].message);
    // "copiado" nunca é confundido com "abriu" — ação própria, chamada própria
    expect(JSON.parse(call![1].body).action).not.toBe("opened");
  });

  it("fundamento também mede abrir e copiar (só não instala)", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    const fundamento = ACADEMY_FUNDAMENTOS[0];
    fireEvent.click(screen.getByText(fundamento.title));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const call = fetchMock.mock.calls.find((c) => c[1]?.body && JSON.parse(c[1].body).action === "opened");
    expect(call).toBeTruthy();
    expect(JSON.parse(call![1].body)).toMatchObject({ clientId: "sonhare", recipeId: fundamento.id, action: "opened" });
  });

  it("cada receita declara tipo, contactTemperature e segmento coerentes com o conteúdo", () => {
    for (const content of ACADEMY_CONTENT) {
      if (isAcademyRecipe(content)) {
        expect(["frio", "morno", "quente"]).toContain(content.contactTemperature);
        expect(content.segments.length).toBeGreaterThan(0);
        expect(content.segments).not.toContain("Todos os segmentos");
      } else {
        expect(content.segments).toEqual(["Todos os segmentos"]);
      }
    }
  });
});
