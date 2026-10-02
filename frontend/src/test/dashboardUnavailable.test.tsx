// frontend/src/test/dashboardUnavailable.test.tsx
//
// O backend isola cada bloco do dashboard: bloco que não pôde ser calculado chega como `null`
// (e o nome em `unavailableBlocks`). A tela tem que dizer "indisponível" — NUNCA mostrar 0 nem
// "nenhum dado": zero é um dado, e aqui o dado não existe.

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { Block1WhatHappened } from "../pages/Dashboard/Block1WhatHappened";
import { Block2Rankings } from "../pages/Dashboard/Block2Rankings";
import { Block3ActionAlerts } from "../pages/Dashboard/Block3ActionAlerts";
import type { DashboardSummary, DashboardPayload } from "../hooks/useDashboard";

const RULE = "conversou depois do envio (janela de 14 dias)";

const fullSummary: DashboardSummary = {
  sent: { current: 1500, previous: 1200, delta: 25 },
  replied: { current: 450, previous: 300, delta: 50, rate: 30.0, previousRate: 25.0, ruleDeclaration: RULE },
  meetings: { current: 45, previous: 30, delta: 50 },
  proposals: { current: 20, previous: 15, delta: 33.3 },
  contracts: { current: 8, previous: 5, delta: 60 },
};

const fullRankings: DashboardPayload["rankings"] = {
  messages: [{ campaign_id: "c1", campaign_name: "Campanha A", message: "oi", sent_count: 100, replied_count: 40, reply_rate: 40 }],
  chips: [
    {
      instanceId: "i1",
      name: "Chip 1",
      chipState: "warm",
      sent: 100,
      replies: 20,
      sentToday: 10,
      quotaLimit: 50,
      quotaConsumedText: "10 de 50 (20%)",
      quotaPercentage: 20,
    },
  ],
  regions: [{ label: "DDD 11", ddd: "11", cidade: null, sent: 100, replies: 20, replyRate: 20 }],
  failureReasons: [{ reason: "Sem WhatsApp", count: 4, percentage: 100 }],
};

const UNAVAILABLE = "Indisponível";

function renderBlock1(summary: DashboardSummary, props: { hasGd?: boolean; unavailable?: string[] } = {}) {
  return render(
    <Block1WhatHappened
      summary={summary}
      hasProposalsAndContracts={props.hasGd ?? true}
      periodLabel="Últimos 30 dias"
      unavailableBlocks={props.unavailable}
    />
  );
}

describe("Dashboard (tela) — número indisponível não vira zero", () => {
  it("[TESTE OBRIGATÓRIO] Enviados indisponível mostra 'Indisponível' e não o número 0; os outros números continuam", () => {
    renderBlock1({ ...fullSummary, sent: null }, { unavailable: ["summary.sent"] });

    expect(screen.getAllByText(UNAVAILABLE).length).toBe(1);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    // o resto da tela segue com os números reais
    expect(screen.getByText("450")).toBeInTheDocument();
    expect(screen.getByText("45")).toBeInTheDocument();
    expect(screen.getByText("Propostas Criadas")).toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] Reuniões indisponível: 'Indisponível' no lugar do número, sem 0 e sem '0%'", () => {
    renderBlock1({ ...fullSummary, meetings: null }, { unavailable: ["summary.meetings"] });

    expect(screen.getAllByText(UNAVAILABLE).length).toBe(1);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.getByText("1.500")).toBeInTheDocument();
  });

  it("[TESTE OBRIGATÓRIO] taxa de resposta indisponível mostra traço, nunca '0%'", () => {
    renderBlock1({
      ...fullSummary,
      replied: { ...fullSummary.replied!, rate: null, previousRate: null },
    });

    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.queryByText("30%")).not.toBeInTheDocument();
    // a contagem de respostas continua aparecendo
    expect(screen.getByText("450")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("Responderam indisponível (bloco inteiro null): 'Indisponível', sem declaração de regra inventada", () => {
    renderBlock1({ ...fullSummary, replied: null }, { unavailable: ["summary.replied"] });

    expect(screen.getAllByText(UNAVAILABLE).length).toBe(1);
    expect(screen.queryByText(RULE)).not.toBeInTheDocument();
  });

  it("propostas indisponíveis (consulta caiu): a caixa aparece como 'Indisponível', não some nem zera", () => {
    renderBlock1({ ...fullSummary, proposals: null }, { unavailable: ["summary.proposals"] });

    expect(screen.getByText("Propostas Criadas")).toBeInTheDocument();
    expect(screen.getAllByText(UNAVAILABLE).length).toBe(1);
    expect(screen.getByText("Contratos Fechados")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
  });

  it("tenant sem GD continua sem as caixas de propostas e contratos (null ≠ indisponível)", () => {
    renderBlock1({ ...fullSummary, proposals: null, contracts: null }, { hasGd: false, unavailable: [] });

    expect(screen.queryByText("Propostas Criadas")).not.toBeInTheDocument();
    expect(screen.queryByText("Contratos Fechados")).not.toBeInTheDocument();
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });

  it("zero de verdade continua aparecendo como 0", () => {
    renderBlock1({ ...fullSummary, meetings: { current: 0, previous: 0, delta: 0 } });

    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
    expect(screen.queryByText(UNAVAILABLE)).not.toBeInTheDocument();
  });
});

describe("Dashboard (tela) — ranking indisponível não vira 'nenhum dado'", () => {
  it("[TESTE OBRIGATÓRIO] ranking null diz 'Indisponível'; lista vazia continua dizendo 'Nenhuma ...'", () => {
    const { unmount } = render(
      <Block2Rankings rankings={{ ...fullRankings, messages: null, chips: null, regions: null, failureReasons: null }} />
    );
    expect(screen.getAllByText(/Indisponível — não foi possível calcular agora/).length).toBe(4);
    expect(screen.queryByText(/Nenhuma mensagem/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nenhum disparo por chip/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nenhum lead com região/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Nenhuma falha de envio/)).not.toBeInTheDocument();
    unmount();

    render(<Block2Rankings rankings={{ messages: [], chips: [], regions: [], failureReasons: [] }} />);
    expect(screen.getByText(/Nenhuma mensagem com 30\+ disparos/)).toBeInTheDocument();
    expect(screen.queryByText(/Indisponível/)).not.toBeInTheDocument();
  });

  it("um ranking indisponível não derruba os outros", () => {
    render(<Block2Rankings rankings={{ ...fullRankings, chips: null }} />);

    expect(screen.getAllByText(/Indisponível — não foi possível calcular agora/).length).toBe(1);
    expect(screen.getByText("1. Campanha A")).toBeInTheDocument();
    expect(screen.getByText(/DDD 11/)).toBeInTheDocument();
    expect(screen.getByText("Sem WhatsApp")).toBeInTheDocument();
  });
});

describe("Dashboard (tela) — avisos que não puderam ser avaliados", () => {
  it("[TESTE OBRIGATÓRIO] sem avisos mas incompleto: diz que a lista pode estar incompleta (silêncio pareceria 'tudo bem')", () => {
    const { container, rerender } = render(
      <BrowserRouter>
        <Block3ActionAlerts alerts={[]} incomplete />
      </BrowserRouter>
    );
    expect(screen.getByText(/lista pode estar incompleta/)).toBeInTheDocument();

    rerender(
      <BrowserRouter>
        <Block3ActionAlerts alerts={[]} incomplete={false} />
      </BrowserRouter>
    );
    expect(container.firstChild).toBeNull();
  });

  it("com avisos e incompleto: mostra os avisos e a nota", () => {
    render(
      <BrowserRouter>
        <Block3ActionAlerts
          incomplete
          alerts={[{ id: "a1", text: "Leads esperando responsável.", actionLabel: "Distribuir", actionUrl: "/crm/banco-de-dados", severity: "urgent" }]}
        />
      </BrowserRouter>
    );

    expect(screen.getByText("Leads esperando responsável.")).toBeInTheDocument();
    expect(screen.getByText(/lista pode estar incompleta/)).toBeInTheDocument();
  });
});
