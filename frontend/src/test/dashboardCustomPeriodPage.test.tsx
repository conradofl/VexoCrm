// frontend/src/test/dashboardCustomPeriodPage.test.tsx
//
// Página do dashboard com período personalizado: o seletor fica SEMPRE na tela, a consulta só
// acontece depois de aplicar as datas, e "Atualizar agora" recalcula o mesmo intervalo.
// (Arquivo à parte porque aqui o cabeçalho é substituído por um stub.)

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// ── a página: seletor sempre visível, consulta só depois de aplicar ───────
const hookCalls: unknown[][] = [];
const mutate = vi.fn();
let hookResult: { data: unknown; isLoading: boolean; error: unknown } = { data: undefined, isLoading: false, error: null };

vi.mock("@/hooks/useDashboard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hooks/useDashboard")>();
  return {
    ...actual,
    useDashboard: (...args: unknown[]) => {
      hookCalls.push(args);
      return hookResult;
    },
    useRefreshDashboard: () => ({ mutate, isPending: false }),
  };
});
vi.mock("@/components/PageShell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/hooks/useCrmClient", () => ({ useOptionalCrmClient: () => null }));
vi.mock("../pages/Dashboard/DashboardHeader", () => ({
  DashboardHeader: (props: any) => (
    <div>
      <span data-testid="period">{props.period}</span>
      <button onClick={() => props.onPeriodChange("custom")}>escolher-personalizado</button>
      <button onClick={() => props.onCustomRangeApply({ from: "2026-10-01", to: "2026-10-10" })}>aplicar</button>
      <button onClick={props.onRefresh}>atualizar</button>
    </div>
  ),
}));

describe("Página do dashboard — período personalizado", () => {
  beforeEach(() => {
    hookCalls.length = 0;
    mutate.mockClear();
    hookResult = { data: undefined, isLoading: false, error: null };
  });

  it("[TESTE OBRIGATÓRIO] 'Personalizado' sem datas aplicadas não consulta, mantém o seletor e pede as datas; ao aplicar, consulta com o intervalo", async () => {
    const { default: Dashboard } = await import("../pages/Dashboard");
    render(<Dashboard fixedClientId="c1" />);
    expect(hookCalls.at(-1)).toEqual(["c1", "30d", null]);

    fireEvent.click(screen.getByText("escolher-personalizado"));
    expect(hookCalls.at(-1)).toEqual(["c1", "custom", null]); // hook recebe null → não consulta (enabled=false)
    expect(screen.getByText("Escolha a data inicial e a data final e clique em Aplicar.")).toBeInTheDocument();
    expect(screen.getByTestId("period")).toHaveTextContent("custom"); // o seletor continua na tela

    fireEvent.click(screen.getByText("aplicar"));
    expect(hookCalls.at(-1)).toEqual(["c1", "custom", { from: "2026-10-01", to: "2026-10-10" }]);
    expect(screen.queryByText("Escolha a data inicial e a data final e clique em Aplicar.")).not.toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] 'Atualizar agora' recalcula o MESMO intervalo", async () => {
    const { default: Dashboard } = await import("../pages/Dashboard");
    render(<Dashboard fixedClientId="c1" />);

    fireEvent.click(screen.getByText("escolher-personalizado"));
    fireEvent.click(screen.getByText("aplicar"));
    fireEvent.click(screen.getByText("atualizar"));

    expect(mutate).toHaveBeenCalledWith({ period: "custom", range: { from: "2026-10-01", to: "2026-10-10" } });
  });

  it("intervalo recusado pelo servidor: o erro aparece e o seletor continua na tela para escolher outro", async () => {
    hookResult = { data: undefined, isLoading: false, error: new Error("Dashboard fetch failed: 400 A data final (20/10/2026) está no futuro.") };
    const { default: Dashboard } = await import("../pages/Dashboard");
    render(<Dashboard fixedClientId="c1" />);

    expect(screen.getByText(/está no futuro/)).toBeInTheDocument();
    expect(screen.getByTestId("period")).toBeInTheDocument();
  });
});
