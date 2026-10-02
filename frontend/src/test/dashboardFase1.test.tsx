import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { Block1WhatHappened } from "../pages/Dashboard/Block1WhatHappened";
import { Block2Rankings } from "../pages/Dashboard/Block2Rankings";
import { Block3ActionAlerts } from "../pages/Dashboard/Block3ActionAlerts";
import { DashboardHeader } from "../pages/Dashboard/DashboardHeader";
import type { DashboardSummary, DashboardPayload } from "../hooks/useDashboard";

const mockSummaryWithAll: DashboardSummary = {
  sent: { current: 1500, previous: 1200, delta: 25 },
  replied: {
    current: 450,
    previous: 300,
    delta: 50,
    rate: 30.0,
    previousRate: 25.0,
    ruleDeclaration: "conversou depois do envio (janela de 14 dias)",
  },
  meetings: { current: 45, previous: 30, delta: 50 },
  proposals: { current: 20, previous: 15, delta: 33.3 },
  contracts: { current: 8, previous: 5, delta: 60 },
};

const mockSummaryWithoutGd: DashboardSummary = {
  sent: { current: 1000, previous: 800, delta: 25 },
  replied: {
    current: 250,
    previous: 200,
    delta: 25,
    rate: 25.0,
    previousRate: 25.0,
    ruleDeclaration: "conversou depois do envio (janela de 14 dias)",
  },
  meetings: { current: 20, previous: 15, delta: 33.3 },
  proposals: null,
  contracts: null,
};

const mockRankings: DashboardPayload["rankings"] = {
  messages: [
    {
      campaign_id: "c1",
      campaign_name: "Campanha A",
      message: "Oi, tudo bem?",
      sent_count: 100,
      replied_count: 40,
      reply_rate: 40.0,
    },
    {
      campaign_id: "c2",
      campaign_name: "Campanha B",
      message: "Segunda mensagem",
      sent_count: 50,
      replied_count: 10,
      reply_rate: 20.0,
    },
    {
      campaign_id: "c3",
      campaign_name: "Campanha C",
      message: "Terceira mensagem",
      sent_count: 80,
      replied_count: 8,
      reply_rate: 10.0,
    },
    {
      campaign_id: "c4",
      campaign_name: "Campanha D que deve ser ignorada no slice(0, 3)",
      message: "Quarta mensagem",
      sent_count: 90,
      replied_count: 5,
      reply_rate: 5.5,
    },
  ],
  chips: [
    {
      instanceId: "chip-1",
      name: "Chip Comercial 1",
      chipState: "warm",
      sent: 500,
      replies: 120,
      sentToday: 45,
      quotaLimit: 200,
      quotaConsumedText: "45 de 200 (23%)",
      quotaPercentage: 23,
    },
    {
      instanceId: "chip-2",
      name: "Chip Comercial 2",
      chipState: "cold",
      sent: 200,
      replies: 30,
      sentToday: 42,
      quotaLimit: 50,
      quotaConsumedText: "42 de 50 (84%)",
      quotaPercentage: 84,
    },
  ],
  regions: [
    {
      label: "São Paulo (DDD 11)",
      ddd: "11",
      cidade: "São Paulo",
      sent: 600,
      replies: 150,
      replyRate: 25.0,
    },
    {
      label: "DDD 21",
      ddd: "21",
      cidade: null,
      sent: 300,
      replies: 60,
      replyRate: 20.0,
    },
  ],
  failureReasons: [
    { reason: "Número inexistente", count: 40, percentage: 50 },
    { reason: "Sem WhatsApp", count: 24, percentage: 30 },
    { reason: "Chip fora do ar", count: 16, percentage: 20 },
  ],
};

describe("Dashboard Fase 1 Frontend UI and Rules", () => {
  it("Block 1: Tenant without proposals and contracts only sees 3 numbers, not 5", () => {
    render(
      <Block1WhatHappened
        summary={mockSummaryWithoutGd}
        hasProposalsAndContracts={false}
        periodLabel="Últimos 30 dias"
      />
    );

    expect(screen.getByText("Enviados")).toBeInTheDocument();
    expect(screen.getByText("Responderam")).toBeInTheDocument();
    expect(screen.getByText("Agendaram Reunião")).toBeInTheDocument();

    // Não deve conter propostas nem contratos
    expect(screen.queryByText("Propostas Criadas")).not.toBeInTheDocument();
    expect(screen.queryByText("Contratos Fechados")).not.toBeInTheDocument();
  });

  it("Block 1: Tenant with proposals and contracts sees all 5 numbers", () => {
    render(
      <Block1WhatHappened
        summary={mockSummaryWithAll}
        hasProposalsAndContracts={true}
        periodLabel="Últimos 30 dias"
      />
    );

    expect(screen.getByText("Enviados")).toBeInTheDocument();
    expect(screen.getByText("Responderam")).toBeInTheDocument();
    expect(screen.getByText("Agendaram Reunião")).toBeInTheDocument();
    expect(screen.getByText("Propostas Criadas")).toBeInTheDocument();
    expect(screen.getByText("Contratos Fechados")).toBeInTheDocument();
  });

  it("Block 1: Reply rate rule is declared explicitly beside the number, not in a footnote", () => {
    render(
      <Block1WhatHappened
        summary={mockSummaryWithAll}
        hasProposalsAndContracts={true}
        periodLabel="Últimos 30 dias"
      />
    );

    const ruleBadge = screen.getByText("conversou depois do envio (janela de 14 dias)");
    expect(ruleBadge).toBeInTheDocument();
    expect(ruleBadge.tagName.toLowerCase()).toBe("span");
  });

  it("Block 2: Rankings render at most 3 rows each and show required fields", () => {
    render(<Block2Rankings rankings={mockRankings} />);

    expect(screen.getByText("1. Campanha A")).toBeInTheDocument();
    expect(screen.getByText("2. Campanha B")).toBeInTheDocument();
    expect(screen.getByText("3. Campanha C")).toBeInTheDocument();
    // 4ª campanha deve ser cortada pelo limite de 3 linhas
    expect(screen.queryByText(/Campanha D/)).not.toBeInTheDocument();

    // Chips
    expect(screen.getByText("1. Chip Comercial 1")).toBeInTheDocument();
    expect(screen.getByText(/cota de hoje: 45 de 200/)).toBeInTheDocument();

    // Regiões
    expect(screen.getByText(/São Paulo \(DDD 11\)/)).toBeInTheDocument();

    // Motivos de falha
    expect(screen.getByText("Número inexistente")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("Block 2: Failure reasons sum to 100%", () => {
    render(<Block2Rankings rankings={mockRankings} />);
    const sum = mockRankings.failureReasons.reduce((acc, f) => acc + f.percentage, 0);
    expect(sum).toBe(100);
  });

  it("Block 3: Alerts only appear when condition is true; disappears when no alerts", () => {
    const { container, rerender } = render(
      <BrowserRouter>
        <Block3ActionAlerts
          alerts={[
            {
              id: "alert1",
              text: "Chip com percentual de inválidos acima do normal — limpe a lista antes do próximo disparo.",
              actionLabel: "Limpar lista",
              actionUrl: "/crm/campanhas",
              severity: "warning",
            },
          ]}
        />
      </BrowserRouter>
    );

    expect(screen.getByText(/limpe a lista antes do próximo disparo/)).toBeInTheDocument();
    expect(screen.getByText("Limpar lista")).toBeInTheDocument();

    // Re-render sem alertas -> não deve renderizar nada (sem decoração fixa)
    rerender(
      <BrowserRouter>
        <Block3ActionAlerts alerts={[]} />
      </BrowserRouter>
    );

    expect(container.firstChild).toBeNull();
  });

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
