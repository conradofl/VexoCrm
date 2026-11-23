import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import { SchedulingStep } from "../pages/LeadImports/SchedulingStep";
import type { SchedulingStepProps } from "../pages/LeadImports/SchedulingStep";

describe("SchedulingStep — Disparo Imediato na Edição (Fim do Fluxo Duplo)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const defaultProps: SchedulingStepProps = {
    selectedLeadClient: {
      id: "client-1",
      name: "Cliente 1",
      n8n_settings: {
        send_window_enabled: false,
      },
    } as any,
    evolutionInstances: [
      { id: "chip-1", name: "Chip 1", connection_state: "open", active: true },
    ] as any,
    evolutionInstanceOptions: [
      { id: "chip-1", name: "Chip 1", connection_state: "open", active: true },
    ] as any,
    campaignSequence: [
      { id: "step-1", type: "text", order: 1, text: "Olá {{nome}}!" },
    ] as any,
    dispatchOptions: {
      evolutionInstanceId: "chip-1",
      dispatchChipIds: ["chip-1"],
      sendWindow: { enabled: false },
    } as any,
    setDispatchOptions: vi.fn(),
    newTriggerType: "manual",
    setNewTriggerType: vi.fn(),
    newScheduledAt: "",
    setNewScheduledAt: vi.fn(),
    batchingEnabled: false,
    setBatchingEnabled: vi.fn(),
    batchSize: "50",
    setBatchSize: vi.fn(),
    batchIntervalHours: "1",
    setBatchIntervalHours: vi.fn(),
    dispatchCapText: "",
    setDispatchCapText: vi.fn(),
    isRecurring: false,
    setIsRecurring: vi.fn(),
    recurrencePattern: "monthly",
    setRecurrencePattern: vi.fn(),
    recurrenceDayOfMonth: 15,
    setRecurrenceDayOfMonth: vi.fn(),
    recurrenceDayOfWeek: 2,
    setRecurrenceDayOfWeek: vi.fn(),
    recurrenceTime: "09:00",
    setRecurrenceTime: vi.fn(),
    recurrenceEndType: null,
    setRecurrenceEndType: vi.fn(),
    recurrenceEndsOn: "",
    setRecurrenceEndsOn: vi.fn(),
    recurrenceMaxOccurrences: 12,
    setRecurrenceMaxOccurrences: vi.fn(),
    recurrenceNoEndConfirmed: false,
    setRecurrenceNoEndConfirmed: vi.fn(),
    recurrenceOverrunConfirmed: false,
    setRecurrenceOverrunConfirmed: vi.fn(),
    recurrencePreviewInput: null,
    onSubmit: vi.fn(),
    onDispatchNow: vi.fn(),
    onSaveAndDispatchNow: vi.fn(),
    alreadyReceivedCount: 36,
    isWithoutSource: false,
    isSubmitting: false,
    editingCampaignId: "camp-53",
    onCancelEdit: vi.fn(),
    onNovaCampanha: vi.fn(),
    totalLeads: 53,
  };

  it("exibe o botão primário 'Salvar e Disparar Agora' na barra de ações ao editar uma campanha", () => {
    render(<SchedulingStep {...defaultProps} />);

    // Deve exibir o botão primário "Salvar e Disparar Agora"
    const btnSalvarEDisparar = screen.getByRole("button", { name: /Salvar e Disparar Agora/i });
    expect(btnSalvarEDisparar).toBeDefined();

    // Também deve manter o botão secundário "Salvar Alterações de Campanha" e "Cancelar Edição"
    expect(screen.getByRole("button", { name: /Salvar Alterações de Campanha/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /Cancelar Edição/i })).toBeDefined();
  });

  it("ao clicar em 'Salvar e Disparar Agora', aciona o salvamento e abre o modal de confirmação com os números corretos", async () => {
    const onSaveAndDispatchNow = vi.fn();
    render(<SchedulingStep {...defaultProps} onSaveAndDispatchNow={onSaveAndDispatchNow} />);

    const btnSalvarEDisparar = screen.getByRole("button", { name: /Salvar e Disparar Agora/i });
    fireEvent.click(btnSalvarEDisparar);

    // Deve chamar onSaveAndDispatchNow (ou abrir o modal diretamente salvando as alterações)
    await waitFor(() => {
      expect(screen.getByText(/Confirmar Disparo de Campanha/i)).toBeDefined();
    });

    // Modal deve exibir:
    // Total: 53 leads
    // Já receberam: 36 leads
    // Novos envios a realizar: 17 contatos
    expect(screen.getByText("53")).toBeDefined();
    expect(screen.getByText("36")).toBeDefined();
    expect(screen.getByText("17")).toBeDefined();

    // Clicar em 'Confirmar e Disparar Agora' dispara
    const btnConfirmar = screen.getByRole("button", { name: /Confirmar e Disparar Agora/i });
    fireEvent.click(btnConfirmar);

    await waitFor(() => {
      expect(defaultProps.onDispatchNow).toHaveBeenCalled();
    });
  });
});
