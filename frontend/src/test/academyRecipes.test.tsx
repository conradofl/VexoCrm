// frontend/src/test/academyRecipes.test.tsx
//
// Vexo Academy — a tela lê a receita de academyRecipes.ts (dado, não
// componente), filtra por segmento/objetivo, mostra o conteúdo inteiro (sem
// truncar) e mede as três ações (abriu/copiou/instalou) distinguindo uma da
// outra.

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { ACADEMY_RECIPES } from "@/data/academyRecipes";

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

describe("Vexo Academy — biblioteca de receitas", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, headers: { get: () => "application/json" }, json: async () => ({ success: true }) }));
    global.fetch = fetchMock as any;
    Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
  });

  it("[TESTE OBRIGATÓRIO] o conteúdo da receita chega inteiro na tela, não truncado", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    const recipe = ACADEMY_RECIPES[0];
    fireEvent.click(screen.getByText(recipe.title));

    // cada mensagem da cadência aparece por inteiro, byte a byte — não um
    // resumo, não cortada com "..."
    for (const tpl of recipe.templates) {
      expect(screen.getByText(tpl.message)).toBeTruthy();
    }
    // e os passos com o nome real da tela também inteiros (um step.screen
    // pode se repetir entre passos — getAllByText tolera isso)
    for (const step of recipe.steps) {
      expect(screen.getAllByText(step.screen).length).toBeGreaterThan(0);
      expect(screen.getByText(new RegExp(step.instruction.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy();
    }
  });

  it("lista filtrável por objetivo — escolher um objetivo esconde as receitas de outro", async () => {
    const { default: OnboardingWizard } = await import("@/pages/OnboardingWizard");
    renderWithProviders(<OnboardingWizard />);

    // as duas receitas de exemplo aparecem de cara (sem filtro)
    for (const recipe of ACADEMY_RECIPES) {
      expect(screen.getByText(recipe.title)).toBeTruthy();
    }

    const recuperar = ACADEMY_RECIPES.find((r) => r.objective === "Recuperar lead frio")!;
    const outraReceita = ACADEMY_RECIPES.find((r) => r.objective !== recuperar.objective)!;

    fireEvent.click(screen.getByRole("button", { name: recuperar.objective }));

    expect(screen.getByText(recuperar.title)).toBeTruthy();
    expect(screen.queryByText(outraReceita.title)).toBeNull();
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

  it("regra do anonimato: nenhuma receita de exemplo cita nome de empresa — só segmento", () => {
    const forbiddenNames = ["geracao-digital", "geração digital", "sonhare", "vexo os", "infinie", "outlier"];
    for (const recipe of ACADEMY_RECIPES) {
      const haystack = JSON.stringify(recipe).toLowerCase();
      for (const name of forbiddenNames) {
        expect(haystack).not.toContain(name);
      }
    }
  });
});
