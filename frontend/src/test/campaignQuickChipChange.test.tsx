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
    id: "camp-123",
    name: "Campanha Black Friday",
    client_id: "cliente-teste",
    client_name: "Cliente Teste",
    status: "active",
    mode: "disparo",
    chip_name: "Chip Vexo 01",
    created_at: "2026-11-15T12:00:00Z",
    scheduled_for: null,
    is_recurring: false,
    analytics_meta: {
      dispatchOptions: {
        evolutionInstanceId: "inst-1",
        dispatchChipIds: ["inst-1"],
      },
    },
  } as any,
];

const mockInstances = [
  { id: "inst-1", name: "Chip Vexo 01", isDefault: true },
  { id: "inst-2", name: "Chip Vexo 02 (Reserva)", isDefault: false },
  { id: "inst-3", name: "Chip Vexo 03 (Vendas)", isDefault: false },
];

describe("CampaignsTable — Botão de Alterar Chip Rápido", () => {
  beforeEach(() => {
    mockToast.mockClear();
  });

  it("renderiza o botão 'Alterar Chip' para a campanha na lista", () => {
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

    // O botão de alterar chip deve estar visível
    const btnAlterarChip = screen.getByRole("button", { name: /Alterar Chip/i });
    expect(btnAlterarChip).toBeInTheDocument();
  });

  it("ao selecionar um novo chip, chama o callback onChipChange e exibe toast de confirmação", async () => {
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

    const btnAlterarChip = screen.getByRole("button", { name: /Alterar Chip/i });
    fireEvent.keyDown(btnAlterarChip, { key: "Enter" });

    // Abre o menu com as opções de chip
    await waitFor(() => {
      expect(screen.getByText("Chip Vexo 02 (Reserva)")).toBeInTheDocument();
    });

    // Clica na opção Chip Vexo 02
    fireEvent.click(screen.getByText("Chip Vexo 02 (Reserva)"));

    await waitFor(() => {
      expect(handleChipChange).toHaveBeenCalledWith(
        "camp-123",
        "inst-2",
        "Chip Vexo 02 (Reserva)"
      );
    });

    // Confirma atualização imediata e toast
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          description: expect.stringContaining("Chip da campanha atualizado para Chip Vexo 02 (Reserva) com sucesso!"),
        })
      );
    });
  });
});
