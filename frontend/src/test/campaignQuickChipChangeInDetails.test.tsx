import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { CampaignsTable } from "@/pages/LeadImports/CampaignsTable";
import type { Campaign } from "@/hooks/useCampanhas";

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: any[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/pages/LeadImports/DispatchKpiCards", () => ({
  DispatchKpiCards: () => <div data-testid="mock-kpi-cards" />,
}));

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>{ui}</QueryClientProvider>
    </MemoryRouter>
  );
}

const mockCampaigns: Campaign[] = [
  {
    id: "camp-999",
    name: "Campanha Black Friday Pro",
    client_id: "cliente-teste",
    client_name: "Cliente Teste",
    status: "active",
    mode: "disparo",
    chip_name: "Chip Vexo 01",
    created_at: "2026-11-15T12:00:00Z",
    scheduled_for: null,
    is_recurring: false,
  } as any,
];

const mockInstances = [
  { id: "inst-1", name: "Chip Vexo 01", isDefault: true },
  { id: "inst-2", name: "Chip Vexo 02 (Reserva)", isDefault: false },
  { id: "inst-3", name: "Chip Vexo 03 (Vendas)", isDefault: false },
];

describe("CampaignsTable — Alterar Chip no Modo Tabela e nos Detalhes Expandidos", () => {
  beforeEach(() => {
    mockToast.mockClear();
    localStorage.clear();
  });

  it("renderiza o botão 'Alterar Chip' dentro de renderDetails (ao lado de Último chip e na barra de ações)", async () => {
    // Modo card (padrão)
    renderWithProviders(
      <CampaignsTable
        clientId="cliente-teste"
        campaigns={mockCampaigns}
        loadingCampaigns={false}
        evolutionInstanceOptions={mockInstances}
        onEditCampaign={vi.fn()}
        onDuplicateCampaign={vi.fn()}
        onDeleteCampaign={vi.fn()}
      />
    );

    // Clica no card para expandir detalhes
    const cardHeader = screen.getByTestId("campaign-card-header-camp-999");
    fireEvent.click(cardHeader);

    // Deve exibir os seletores de chip nos detalhes
    await waitFor(() => {
      expect(screen.getByTestId("campaign-change-chip-inline-camp-999")).toBeInTheDocument();
      expect(screen.getByTestId("campaign-change-chip-action-camp-999")).toBeInTheDocument();
    });
  });

  it("no modo lista/tabela, exibe o seletor na linha e permite alterar o chip com atualização otimista", async () => {
    localStorage.setItem("vexo:view-mode:campanhas", JSON.stringify("list"));

    const handleChipChange = vi.fn().mockResolvedValue(undefined);

    renderWithProviders(
      <CampaignsTable
        clientId="cliente-teste"
        campaigns={mockCampaigns}
        loadingCampaigns={false}
        evolutionInstanceOptions={mockInstances}
        onChipChange={handleChipChange}
        onEditCampaign={vi.fn()}
        onDuplicateCampaign={vi.fn()}
        onDeleteCampaign={vi.fn()}
      />
    );

    // Deve exibir o seletor diretamente na linha da tabela
    const btnTableRow = await screen.findByTestId("campaign-change-chip-table-camp-999");
    expect(btnTableRow).toBeInTheDocument();

    // Expande a linha da tabela
    const expandBtn = screen.getByRole("button", { name: /Ver detalhes de Campanha Black Friday Pro/i });
    fireEvent.click(expandBtn);

    // Nos detalhes expandidos da linha, o botão ao lado de 'Último chip' deve estar presente
    const btnInline = await screen.findByTestId("campaign-change-chip-inline-camp-999");
    expect(btnInline).toBeInTheDocument();

    // Clica para abrir o dropdown
    fireEvent.keyDown(btnInline, { key: "Enter" });

    await waitFor(() => {
      expect(screen.getByText("Chip Vexo 02 (Reserva)")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Chip Vexo 02 (Reserva)"));

    await waitFor(() => {
      expect(handleChipChange).toHaveBeenCalledWith(
        "camp-999",
        "inst-2",
        "Chip Vexo 02 (Reserva)"
      );
    });

    // Confirma atualização otimista na tela dentro de Último chip
    await waitFor(() => {
      const chipContainer = screen.getByTestId("campaign-last-chip-camp-999");
      expect(chipContainer).toHaveTextContent("Chip Vexo 02 (Reserva)");
    });
  });
});
