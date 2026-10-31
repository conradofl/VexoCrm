// Fase 0 do redesenho do Dashboard (31/10/2026): a tela nunca afirma o que não mediu.
// 1) Card de leads parados: falha da API mostra travessão e motivo, nunca "SLA 100% em dia" verde.
// 2) Selo de variação: período anterior zerado mostra "sem base de comparação", nunca um percentual.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Block1WhatHappened } from "@/pages/Dashboard/Block1WhatHappened";
import { StalledLeadsAlertCard } from "@/components/dashboard/StalledLeadsAlertCard";
import { formatDelta } from "@/lib/dashboard/formatters";

const stalledState: { data: unknown; isLoading: boolean; error: unknown } = { data: undefined, isLoading: false, error: null };
vi.mock("@/hooks/useStalledLeads", () => ({
  useStalledLeads: () => stalledState,
}));

const renderCard = () =>
  render(
    <MemoryRouter>
      <StalledLeadsAlertCard clientId="tenant-1" />
    </MemoryRouter>
  );

describe("StalledLeadsAlertCard — falha não vira 'em dia'", () => {
  beforeEach(() => {
    stalledState.data = undefined;
    stalledState.isLoading = false;
    stalledState.error = null;
  });

  it("[TESTE OBRIGATÓRIO] API falhou: travessão e motivo, nenhum aviso tranquilizador", () => {
    stalledState.error = new Error("Falha ao consultar leads parados.");
    renderCard();

    expect(screen.getByTestId("stalled-leads-alert-card-unavailable")).toBeInTheDocument();
    expect(screen.getByText("Leads parados: —")).toBeInTheDocument();
    expect(screen.getByText("Falha ao consultar leads parados.")).toBeInTheDocument();
    expect(screen.queryByText(/SLA 100% em dia/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nenhum lead esquecido/)).not.toBeInTheDocument();
  });

  it("consulta que não rodou (sem dado e sem erro) também é desconhecido, não zero", () => {
    renderCard();

    expect(screen.getByText("Leads parados: —")).toBeInTheDocument();
    expect(screen.queryByText(/SLA 100% em dia/)).not.toBeInTheDocument();
  });

  it("zero medido pelo servidor continua sendo 'em dia'", () => {
    stalledState.data = { stalled_count: 0, never_approached_count: 0, minDays: 7 };
    renderCard();

    expect(screen.getAllByText(/SLA 100% em dia/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Leads parados: —")).not.toBeInTheDocument();
  });

  it("com parados medidos, mostra a contagem", () => {
    stalledState.data = { stalled_count: 4, never_approached_count: 0, minDays: 7 };
    renderCard();

    expect(screen.getByText(/4 Leads Parados/)).toBeInTheDocument();
  });
});

describe("Selo de variação — sem base de comparação", () => {
  const base = {
    sent: { current: 50, previous: 0, delta: null },
    replied: { current: 10, previous: 0, delta: null, rate: 20, previousRate: 0, ruleDeclaration: "pessoas que responderam em até 14 dias" },
    meetings: { current: 3, previous: 2, delta: 50 },
    closings: null,
    proposals: null,
    contracts: null,
  };

  it("[TESTE OBRIGATÓRIO] anterior zerado mostra 'sem base de comparação', nunca +100% nem 0%", () => {
    render(<Block1WhatHappened summary={base as never} hasProposalsAndContracts={false} periodLabel="30 dias" unavailableBlocks={[]} />);

    expect(screen.getAllByText("sem base de comparação")).toHaveLength(2);
    expect(screen.queryByText("+100%")).not.toBeInTheDocument();
    expect(screen.getByText("+50%")).toBeInTheDocument();
  });

  it("formatDelta separa 'sem delta' de 0%", () => {
    expect(formatDelta(null)).toMatchObject({ isMissing: true, isZero: false });
    expect(formatDelta(0)).toMatchObject({ isMissing: false, isZero: true, text: "0%" });
  });
});
