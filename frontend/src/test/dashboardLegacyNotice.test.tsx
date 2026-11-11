// frontend/src/test/dashboardLegacyNotice.test.tsx
//
// Página do Dashboard com as duas abas: a troca de aba e o aviso do Painel anterior. O painel anterior conta
// pela regra antiga (ex.: quem espera resposta), então não pode aparecer ao lado da Visão geral sem dizer isso.
// Os blocos de cada aba têm teste próprio; aqui eles são marcadores.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import Dashboard from "../pages/Dashboard";

let hookResult: { data: unknown; isLoading: boolean; error: unknown } = { data: undefined, isLoading: false, error: null };

vi.mock("@/hooks/useDashboard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useDashboard")>();
  return { ...actual, useDashboard: () => hookResult, useRefreshDashboard: () => ({ mutate: vi.fn(), isPending: false }) };
});
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useCrmClient", () => ({ useOptionalCrmClient: () => null }));
vi.mock("@/components/dashboard/OnboardingProgressCard", () => ({ OnboardingProgressCard: () => null }));
vi.mock("@/components/dashboard/SmartLinkEngagementCard", () => ({ SmartLinkEngagementCard: () => null }));
vi.mock("@/components/dashboard/StalledLeadsAlertCard", () => ({ StalledLeadsAlertCard: () => null }));
vi.mock("../pages/Dashboard/DashboardHeader", () => ({ DashboardHeader: () => null }));
vi.mock("../pages/Dashboard/OverviewTab", () => ({ OverviewTab: () => <div data-testid="aba-visao-geral" /> }));
vi.mock("../pages/Dashboard/Block1WhatHappened", () => ({ Block1WhatHappened: () => <div data-testid="painel-anterior" /> }));
vi.mock("../pages/Dashboard/Block2Rankings", () => ({ Block2Rankings: () => null }));
vi.mock("../pages/Dashboard/Block3ActionAlerts", () => ({ Block3ActionAlerts: () => null }));
vi.mock("../pages/Dashboard/Block4Analysis", () => ({ Block4Analysis: () => null }));

const base = {
  client: { id: "c1", name: "Empresa" },
  period: "30d",
  periodInfo: { key: "30d", isCustom: false, days: 30, current: { from: "2026-10-12", to: "2026-11-10" }, previous: { from: "2026-09-12", to: "2026-10-11" } },
  lastUpdatedAt: "2026-11-11T12:00:00.000Z",
  cacheStatus: "fresh",
  hasProposalsAndContracts: false,
  unavailableBlocks: [],
  summary: {},
  rankings: {},
  alerts: [],
};
const AVISO = "Números pela regra antiga. A Visão geral é a referência.";

describe("Página do Dashboard — abas e aviso do Painel anterior", () => {
  beforeEach(() => {
    hookResult = { data: undefined, isLoading: false, error: null };
  });

  it("com a Visão geral disponível: abre nela, sem aviso; o Painel anterior traz o aviso no topo", () => {
    hookResult = { data: { ...base, overview: {} }, isLoading: false, error: null };
    render(<Dashboard fixedClientId="c1" />);

    expect(screen.getByTestId("aba-visao-geral")).toBeInTheDocument();
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Painel anterior" }));
    expect(screen.queryByTestId("aba-visao-geral")).not.toBeInTheDocument();
    const aviso = screen.getByText(AVISO);
    const painel = screen.getByTestId("painel-anterior");
    // O aviso vem ANTES do primeiro bloco de números.
    expect(aviso.compareDocumentPosition(painel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Visão geral" }));
    expect(screen.getByTestId("aba-visao-geral")).toBeInTheDocument();
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
  });

  it("payload antigo, sem overview: painel de sempre, sem abas e sem aviso (não há outra referência na tela)", () => {
    hookResult = { data: base, isLoading: false, error: null };
    render(<Dashboard fixedClientId="c1" />);

    expect(screen.getByTestId("painel-anterior")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Painel anterior" })).not.toBeInTheDocument();
    expect(screen.queryByText(AVISO)).not.toBeInTheDocument();
  });
});
