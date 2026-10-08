// frontend/src/test/leadReactivationCard.test.tsx
// Testes de renderização do Pilar 2: Reativação Automática de Leads Parados (Cadência de Resgate Automático)
// Validação do Card de Configuração Inteligente, controles de ativação, seletor de cadência,
// campo numérico de dias, botão de execução e contador de impacto.

import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { LeadReactivationCard } from "@/components/followup/LeadReactivationCard";

// Mock das mutações
const mockMutateUpdate = vi.fn();
const mockMutateRun = vi.fn();

let mockSettingsData: any = {
  client_id: "tenant-teste",
  reactivation_enabled: true,
  reactivation_stalled_days: 7,
  reactivation_cadence_id: "cad-123",
  reactivation_cooldown_days: 30,
  eligible_count: 5,
  reactivated_last_30_days: 12,
  cadences: [
    { id: "cad-123", name: "Cadência Resgate 7d", status: "active" },
    { id: "cad-456", name: "Follow-up VIP", status: "active" },
  ],
};

let mockIsLoading = false;

vi.mock("@/hooks/useLeadReactivation", () => ({
  useLeadReactivationSettings: () => ({
    data: mockSettingsData,
    isLoading: mockIsLoading,
    refetch: vi.fn(),
  }),
  useUpdateLeadReactivationSettings: () => ({
    mutateAsync: mockMutateUpdate,
    isPending: false,
  }),
  useRunLeadReactivation: () => ({
    mutateAsync: mockMutateRun,
    isPending: false,
  }),
}));

function renderCard(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Pilar 2: LeadReactivationCard Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsData = {
      client_id: "tenant-teste",
      reactivation_enabled: true,
      reactivation_stalled_days: 7,
      reactivation_cadence_id: "cad-123",
      reactivation_cooldown_days: 30,
      eligible_count: 5,
      reactivated_last_30_days: 12,
      cadences: [
        { id: "cad-123", name: "Cadência Resgate 7d", status: "active" },
        { id: "cad-456", name: "Follow-up VIP", status: "active" },
      ],
    };
    mockIsLoading = false;
  });

  it("1. Renderiza o título, badge de status, switch e contador de impacto", () => {
    renderCard(<LeadReactivationCard clientId="tenant-teste" />);

    // Título da promessa comercial
    expect(
      screen.getByText("Reativação Automática de Leads Parados (Regra de Resgate)")
    ).toBeInTheDocument();

    // Badge de status ativo
    expect(screen.getByText("Ativa")).toBeInTheDocument();

    // Switch de ativação
    expect(screen.getByRole("switch")).toBeInTheDocument();

    // Contador de impacto (12 leads nos últimos 30 dias)
    expect(
      screen.getByText("12 leads reativados automaticamente nos últimos 30 dias")
    ).toBeInTheDocument();

    // Badge com contagem de elegíveis no botão de ação
    expect(screen.getByText("5 elegíveis")).toBeInTheDocument();
  });

  it("2. Renderiza os campos de configuração com os valores carregados", () => {
    renderCard(<LeadReactivationCard clientId="tenant-teste" />);

    // Input numérico com 7 dias
    const inputDays = screen.getByLabelText("Disparar após X dias sem resposta") as HTMLInputElement;
    expect(inputDays).toBeInTheDocument();
    expect(inputDays.value).toBe("7");

    // Cooldown informativo
    expect(screen.getByText(/cooldown de 30 dias/i)).toBeInTheDocument();
  });

  it("3. Permite alternar o switch e chama a mutação de salvamento", async () => {
    mockMutateUpdate.mockResolvedValueOnce({
      ...mockSettingsData,
      reactivation_enabled: false,
    });

    renderCard(<LeadReactivationCard clientId="tenant-teste" />);

    const switchEl = screen.getByRole("switch");
    fireEvent.click(switchEl);

    await waitFor(() => {
      expect(mockMutateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "tenant-teste",
          reactivation_enabled: false,
        })
      );
    });
  });

  it("4. Permite editar os dias de inatividade e dispara salvamento no blur", async () => {
    mockMutateUpdate.mockResolvedValueOnce({
      ...mockSettingsData,
      reactivation_stalled_days: 10,
    });

    renderCard(<LeadReactivationCard clientId="tenant-teste" />);

    const inputDays = screen.getByLabelText("Disparar após X dias sem resposta") as HTMLInputElement;
    fireEvent.change(inputDays, { target: { value: "10" } });
    fireEvent.blur(inputDays);

    await waitFor(() => {
      expect(mockMutateUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: "tenant-teste",
          reactivation_stalled_days: 10,
        })
      );
    });
  });

  it("5. Executa a reativação imediata ao clicar em 'Testar / Executar Reativação Agora'", async () => {
    mockMutateRun.mockResolvedValueOnce({
      success: true,
      reactivated_count: 5,
      total_eligible: 5,
    });

    renderCard(<LeadReactivationCard clientId="tenant-teste" />);

    const runBtn = screen.getByRole("button", {
      name: /testar \/ executar reativação agora/i,
    });
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(mockMutateRun).toHaveBeenCalledWith({ clientId: "tenant-teste" });
    });

    // Feedback de sucesso
    await waitFor(() => {
      expect(
        screen.getByText(/Reativação executada! 5 lead\(s\) inscrito\(s\)/i)
      ).toBeInTheDocument();
    });
  });

  it("6. Exibe aviso amigável quando o tenant não tem cadências ativas cadastradas", () => {
    mockSettingsData.cadences = [];
    mockSettingsData.reactivation_cadence_id = null;

    renderCard(<LeadReactivationCard clientId="tenant-teste" />);

    expect(
      screen.getByText("Nenhuma cadência ativa encontrada. Crie uma cadência no Passo 2 acima.")
    ).toBeInTheDocument();
  });
});
