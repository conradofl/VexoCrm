import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DashboardHeader } from "../pages/Dashboard/DashboardHeader";

describe("Dashboard — cabeçalho", () => {
  it("DashboardHeader: displays last update time and shows warning if update failed", () => {
    const onRefresh = vi.fn();
    const onPeriodChange = vi.fn();

    const { rerender } = render(
      <DashboardHeader
        period="30d"
        onPeriodChange={onPeriodChange}
        lastUpdatedAt="2026-10-02T10:30:00Z"
        cacheStatus="ready"
        onRefresh={onRefresh}
        isRefreshing={false}
      />
    );

    expect(screen.getByText(/Atualizado às/)).toBeInTheDocument();

    // Quando falha, diz claramente que a última atualização falhou e mostra a hora do dado salvo
    rerender(
      <DashboardHeader
        period="30d"
        onPeriodChange={onPeriodChange}
        lastUpdatedAt="2026-10-02T08:15:00Z"
        cacheStatus="failed"
        onRefresh={onRefresh}
        isRefreshing={false}
      />
    );

    expect(screen.getByText(/Última atualização falhou · Dados de/)).toBeInTheDocument();
  });
});
