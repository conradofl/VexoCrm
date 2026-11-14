// frontend/src/test/dashboardPage.test.tsx
//
// Página do Dashboard: abre na Visão geral, com as abas de detalhe; o "Painel anterior" não existe mais.
// Os blocos da Visão geral têm teste próprio; aqui ela é um marcador.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import Dashboard from "../pages/Dashboard";

let hookResult: { data: unknown; isLoading: boolean; error: unknown } = { data: undefined, isLoading: false, error: null };
const onboardingProps: Array<{ baseTotal?: number }> = [];

vi.mock("@/hooks/useDashboard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useDashboard")>();
  return { ...actual, useDashboard: () => hookResult, useRefreshDashboard: () => ({ mutate: vi.fn(), isPending: false }) };
});
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useCrmClient", () => ({ useOptionalCrmClient: () => null }));
vi.mock("@/components/dashboard/OnboardingProgressCard", () => ({
  OnboardingProgressCard: (props: { baseTotal?: number }) => {
    onboardingProps.push(props);
    return null;
  },
}));
vi.mock("../pages/Dashboard/DashboardHeader", () => ({ DashboardHeader: () => null }));
vi.mock("../pages/Dashboard/OverviewTab", () => ({ OverviewTab: () => <div data-testid="visao-geral" /> }));
vi.mock("../pages/Dashboard/PlanTab", () => ({ PlanTab: () => <div data-testid="aba-plano" /> }));
vi.mock("../pages/Dashboard/DetailTabs", () => ({
  AttendanceTab: () => <div data-testid="aba-atendimento" />,
  CampaignsTab: () => <div data-testid="aba-campanhas" />,
  BaseTab: () => <div data-testid="aba-base" />,
  ChipsTab: () => <div data-testid="aba-chips" />,
}));

const base = {
  client: { id: "c1", name: "Empresa" },
  period: "30d",
  lastUpdatedAt: "2026-11-11T12:00:00.000Z",
  cacheStatus: "fresh",
  hasProposalsAndContracts: false,
  unavailableBlocks: [],
  summary: {},
  rankings: {},
};

describe("Página do Dashboard — só a Visão geral", () => {
  beforeEach(() => {
    hookResult = { data: undefined, isLoading: false, error: null };
    onboardingProps.length = 0;
  });

  it("abre na Visão geral, com as abas de detalhe e sem o painel anterior", () => {
    hookResult = { data: { ...base, overview: { base: { total: 80320 } } }, isLoading: false, error: null };
    render(<Dashboard fixedClientId="c1" />);

    expect(screen.getByTestId("visao-geral")).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Seções do dashboard" });
    expect(within(nav).getAllByRole("button").map((b) => b.textContent)).toEqual(["Visão geral", "Campanhas", "Atendimento", "Base de leads", "Chips", "Plano de ação"]);
    expect(within(nav).getByRole("button", { name: "Visão geral" })).toHaveAttribute("aria-current", "page");
    expect(screen.queryByRole("button", { name: "Painel anterior" })).not.toBeInTheDocument();
    expect(screen.queryByText(/regra antiga/)).not.toBeInTheDocument();
    // O card de implantação lê o tamanho da base da Visão geral.
    expect(onboardingProps.at(-1)?.baseTotal).toBe(80320);
  });

  it("cada aba mostra só o seu conteúdo", () => {
    hookResult = { data: { ...base, overview: { base: { total: 1 } } }, isLoading: false, error: null };
    render(<Dashboard fixedClientId="c1" />);

    for (const [label, testId] of [["Campanhas", "aba-campanhas"], ["Atendimento", "aba-atendimento"], ["Base de leads", "aba-base"], ["Chips", "aba-chips"], ["Plano de ação", "aba-plano"], ["Visão geral", "visao-geral"]] as const) {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(screen.getByTestId(testId)).toBeInTheDocument();
      expect(screen.getAllByTestId(/^(aba-|visao-geral)/)).toHaveLength(1);
      expect(screen.getByRole("button", { name: label })).toHaveAttribute("aria-current", "page");
    }
  });

  it("payload de cálculo antigo, sem overview: pede para atualizar em vez de mostrar tela vazia", () => {
    hookResult = { data: base, isLoading: false, error: null };
    render(<Dashboard fixedClientId="c1" />);

    expect(screen.queryByTestId("visao-geral")).not.toBeInTheDocument();
    expect(screen.getByText("Os números desta empresa ainda são de um cálculo antigo.")).toBeInTheDocument();
    expect(screen.getByText(/Atualizar agora/)).toBeInTheDocument();
  });
});
