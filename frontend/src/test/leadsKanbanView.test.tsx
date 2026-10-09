import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { LeadsKanbanView } from "@/components/leads/LeadsKanbanView";
import type { LeadIntelligenceItem } from "@/pages/BancoDeDados";

const mockLeads: LeadIntelligenceItem[] = [
  {
    id: "lead-1",
    client_id: "client-test",
    nome: "Carlos Silva",
    phone: "11987654321",
    telefone: "11987654321",
    stage: "cold",
    stage_source: "manual",
    temperature: "hot",
    tags: ["vip", "campanha-sp"],
    origem: "Google Ads",
    created_at: new Date().toISOString(),
  } as unknown as LeadIntelligenceItem,
  {
    id: "lead-2",
    client_id: "client-test",
    nome: "Maria Oliveira",
    phone: "21998765432",
    telefone: "21998765432",
    stage: "inquiry",
    stage_source: "auto",
    temperature: "warm",
    tags: ["novo"],
    campaign_name: "Lancamento Outono",
    created_at: new Date(Date.now() - 4 * 86400000).toISOString(),
    last_interaction_at: new Date(Date.now() - 4 * 86400000).toISOString(),
  } as unknown as LeadIntelligenceItem,
  {
    id: "lead-3",
    client_id: "client-test",
    nome: "João Santos",
    phone: "31988887777",
    telefone: "31988887777",
    stage: "open_budget",
    temperature: "cold",
    tags: ["orcamento"],
    created_at: new Date().toISOString(),
  } as unknown as LeadIntelligenceItem,
  {
    id: "lead-4",
    client_id: "client-test",
    nome: "Ana Souza",
    phone: "41977776666",
    telefone: "41977776666",
    stage: "buyer",
    temperature: "hot",
    tags: ["fechado"],
    created_at: new Date().toISOString(),
  } as unknown as LeadIntelligenceItem,
  {
    id: "lead-5",
    client_id: "client-test",
    nome: "Pedro Rocha",
    phone: "51966665555",
    telefone: "51966665555",
    stage: "lost",
    temperature: "cold",
    lost_reason: "preco",
    created_at: new Date().toISOString(),
  } as unknown as LeadIntelligenceItem,
];

describe("LeadsKanbanView Component", () => {
  it("renderiza as 5 colunas canônicas do funil comercial com seus títulos", () => {
    render(
      <LeadsKanbanView
        leads={mockLeads}
        ticketMedio={1500}
        onUpdateStage={vi.fn()}
        onOpenWhatsapp={vi.fn()}
      />
    );

    expect(screen.getByTestId("kanban-column-cold")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-inquiry")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-open_budget")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-buyer")).toBeInTheDocument();
    expect(screen.getByTestId("kanban-column-lost")).toBeInTheDocument();

    expect(screen.getByText("Primeiro Contato")).toBeInTheDocument();
    expect(screen.getByText("Em Atendimento")).toBeInTheDocument();
    expect(screen.getByText("Proposta / Orçamento")).toBeInTheDocument();
    expect(screen.getByText("Venda Fechada")).toBeInTheDocument();
    expect(screen.getByText("Não Convertido")).toBeInTheDocument();
  });

  it("calcula corretamente a contagem e o volume financeiro estimado por coluna com base no ticket médio", () => {
    // 2 leads no cold com ticket 2000 => subtotal 4000
    const customLeads = [
      ...mockLeads,
      {
        id: "lead-extra-cold",
        client_id: "client-test",
        nome: "Extra Cold",
        phone: "11911112222",
        telefone: "11911112222",
        stage: "cold",
        created_at: new Date().toISOString(),
      } as unknown as LeadIntelligenceItem,
    ];

    render(
      <LeadsKanbanView
        leads={customLeads}
        ticketMedio={2000}
        onUpdateStage={vi.fn()}
        onOpenWhatsapp={vi.fn()}
      />
    );

    // cold tem 2 leads
    expect(screen.getByTestId("column-count-cold")).toHaveTextContent("2");
    expect(screen.getByTestId("column-subtotal-cold")).toHaveTextContent("R$ 4.000");

    // inquiry tem 1 lead
    expect(screen.getByTestId("column-count-inquiry")).toHaveTextContent("1");
    expect(screen.getByTestId("column-subtotal-inquiry")).toHaveTextContent("R$ 2.000");
  });

  it("exibe cards de leads com nome, telefone formatado, badges de temperatura e tags", () => {
    render(
      <LeadsKanbanView
        leads={mockLeads}
        ticketMedio={1000}
        onUpdateStage={vi.fn()}
        onOpenWhatsapp={vi.fn()}
      />
    );

    // Card do Carlos Silva
    expect(screen.getByText("Carlos Silva")).toBeInTheDocument();
    expect(screen.getByText("(11) 98765-4321")).toBeInTheDocument();
    expect(screen.getByTestId("badge-temp-lead-1")).toHaveTextContent("Quente");
    expect(screen.getByText("#vip")).toBeInTheDocument();
    expect(screen.getByText("#campanha-sp")).toBeInTheDocument();

    // Card da Maria Oliveira
    expect(screen.getByText("Maria Oliveira")).toBeInTheDocument();
    expect(screen.getByText("(21) 99876-5432")).toBeInTheDocument();
    expect(screen.getByTestId("badge-temp-lead-2")).toHaveTextContent("Morno");
    expect(screen.getByText("Lancamento Outono")).toBeInTheDocument();
  });

  it("exibe badges de origem do estágio (IA Automático vs Manual)", () => {
    render(
      <LeadsKanbanView
        leads={mockLeads}
        ticketMedio={1000}
        onUpdateStage={vi.fn()}
        onOpenWhatsapp={vi.fn()}
      />
    );

    // lead-1 tem stage_source: 'manual'
    const manualBadge = screen.getByTestId("badge-stage-source-lead-1");
    expect(manualBadge).toBeInTheDocument();
    expect(manualBadge).toHaveTextContent("Manual");

    // lead-2 tem stage_source: 'auto'
    const autoBadge = screen.getByTestId("badge-stage-source-lead-2");
    expect(autoBadge).toBeInTheDocument();
    expect(autoBadge).toHaveTextContent("IA Automático");
  });

  it("dispara onOpenWhatsapp ao clicar no botão de WhatsApp do card", () => {
    const handleOpenWhatsapp = vi.fn();
    render(
      <LeadsKanbanView
        leads={mockLeads}
        ticketMedio={1000}
        onUpdateStage={vi.fn()}
        onOpenWhatsapp={handleOpenWhatsapp}
      />
    );

    const whatsappButtons = screen.getAllByRole("button", { name: /WhatsApp/i });
    expect(whatsappButtons.length).toBeGreaterThan(0);

    fireEvent.click(whatsappButtons[0]);
    expect(handleOpenWhatsapp).toHaveBeenCalledWith("11987654321");
  });

  it("dispara transição lógica de avanço (cold -> inquiry) ao clicar em Avançar", async () => {
    const handleUpdateStage = vi.fn().mockResolvedValue(undefined);
    render(
      <LeadsKanbanView
        leads={mockLeads}
        ticketMedio={1000}
        onUpdateStage={handleUpdateStage}
        onOpenWhatsapp={vi.fn()}
      />
    );

    // O lead Carlos Silva está em cold. Seu botão avançar deve chamar onUpdateStage com 'inquiry'
    const advanceButtons = screen.getAllByRole("button", { name: /Avançar/i });
    fireEvent.click(advanceButtons[0]);

    await waitFor(() => {
      expect(handleUpdateStage).toHaveBeenCalledWith("lead-1", "inquiry");
    });
  });

  it("dispara fechamento direto de venda (Ganho -> buyer) ao clicar em 🏆 Ganho", async () => {
    const handleUpdateStage = vi.fn().mockResolvedValue(undefined);
    render(
      <LeadsKanbanView
        leads={mockLeads}
        ticketMedio={1000}
        onUpdateStage={handleUpdateStage}
        onOpenWhatsapp={vi.fn()}
      />
    );

    const wonButtons = screen.getAllByRole("button", { name: /🏆 Ganho/i });
    fireEvent.click(wonButtons[0]);

    await waitFor(() => {
      expect(handleUpdateStage).toHaveBeenCalledWith("lead-1", "buyer");
    });
  });

  it("abre modal de motivo da perda e dispara transição para lost ao confirmar", async () => {
    const handleUpdateStage = vi.fn().mockResolvedValue(undefined);
    render(
      <LeadsKanbanView
        leads={mockLeads}
        ticketMedio={1000}
        onUpdateStage={handleUpdateStage}
        onOpenWhatsapp={vi.fn()}
      />
    );

    // Clica no botão 'Perda' do primeiro card
    const lostButtons = screen.getAllByRole("button", { name: /^Perda$/i });
    fireEvent.click(lostButtons[0]);

    // O modal deve ser exibido
    expect(screen.getByText("Motivo da Perda")).toBeInTheDocument();
    expect(screen.getByText("Preço elevado / fora do orçamento")).toBeInTheDocument();

    // Seleciona motivo Concorrente
    fireEvent.click(screen.getByLabelText(/Fechou com concorrente/i));

    // Clica em confirmar
    const confirmBtn = screen.getByRole("button", { name: /Confirmar Não Conversão/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(handleUpdateStage).toHaveBeenCalledWith("lead-1", "lost", "concorrente");
    });
  });
});
