// Na edição da campanha, com "Agendado" escolhido, o botão verde agenda em vez de disparar na hora.
// Caso real (Tinge, 23/11/2026): agendado para 24/11 08:30, o botão dizia "Salvar e Disparar Agora" e a confirmação
// "Confirmar e Disparar Agora"; "Salvar Alterações" guardava sem agendar. Não havia como agendar na edição.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SchedulingStep } from "../pages/LeadImports/SchedulingStep";

function props(over: Record<string, unknown> = {}) {
  const nada = vi.fn();
  return {
    selectedLeadClient: { id: "tinge-brasil", name: "Tinge", n8n_settings: { send_window_enabled: false } },
    evolutionInstances: [{ id: "chip-1", name: "Chip disparo - Fixo", connection_state: "open", active: true }],
    evolutionInstanceOptions: [{ id: "chip-1", name: "Chip disparo - Fixo", connection_state: "open", active: true }],
    campaignSequence: [{ id: "s1", type: "text", order: 1, text: "Olá!" }],
    dispatchOptions: { evolutionInstanceId: "chip-1", dispatchChipIds: ["chip-1"] },
    setDispatchOptions: nada, newTriggerType: "scheduled", setNewTriggerType: nada, newScheduledAt: "2026-11-24T08:30",
    setNewScheduledAt: nada, batchingEnabled: false, setBatchingEnabled: nada, batchSize: "5", setBatchSize: nada,
    batchIntervalHours: "1", setBatchIntervalHours: nada, dispatchCapText: "", setDispatchCapText: nada,
    isRecurring: false, setIsRecurring: nada, recurrencePattern: "monthly", setRecurrencePattern: nada,
    recurrenceDayOfMonth: 15, setRecurrenceDayOfMonth: nada, recurrenceDayOfWeek: 2, setRecurrenceDayOfWeek: nada,
    recurrenceTime: "09:00", setRecurrenceTime: nada, recurrenceEndType: null, setRecurrenceEndType: nada,
    recurrenceEndsOn: "", setRecurrenceEndsOn: nada, recurrenceMaxOccurrences: 12, setRecurrenceMaxOccurrences: nada,
    recurrenceNoEndConfirmed: false, setRecurrenceNoEndConfirmed: nada, recurrenceOverrunConfirmed: false,
    setRecurrenceOverrunConfirmed: nada, recurrencePreviewInput: null, replyAgent: "passos", setReplyAgent: nada,
    campaignAgentPrompt: "", setCampaignAgentPrompt: nada, onSubmit: vi.fn(), onDispatchNow: vi.fn(),
    onSaveAndDispatchNow: vi.fn(), alreadyReceivedCount: 0, isWithoutSource: false, isSubmitting: false,
    editingCampaignId: "camp-tinge", onCancelEdit: nada, onNovaCampanha: nada, totalLeads: 100,
    ...over,
  } as any;
}

describe("edição com Agendado: o botão verde agenda", () => {
  it("mostra 'Salvar e Agendar Disparo' e a data, e a confirmação fala em agendamento", async () => {
    const p = props();
    render(<SchedulingStep {...p} />);
    expect(screen.queryByRole("button", { name: /Salvar e Disparar Agora/i })).toBeNull();
    const botao = screen.getByRole("button", { name: /Salvar e Agendar Disparo/i });
    expect(screen.getByTestId("edit-schedule-hint").textContent).toMatch(/Os envios começam .*24\/11.*08:30/);
    fireEvent.click(botao);
    await waitFor(() => expect(screen.getByRole("heading", { name: /Confirmar Agendamento/i })).toBeDefined());
    expect(screen.queryByRole("button", { name: /Confirmar e Disparar Agora/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^Confirmar Agendamento$/i }));
    await waitFor(() => expect(p.onDispatchNow).toHaveBeenCalledTimes(1));
  });

  it("sem data escolhida, o botão de agendar fica desligado", () => {
    render(<SchedulingStep {...props({ newScheduledAt: "" })} />);
    expect((screen.getByRole("button", { name: /Salvar e Agendar Disparo/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("edit-schedule-hint").textContent).toMatch(/Escolha a data/);
  });

  it("com 'Disparar Agora' escolhido continua disparando na hora", async () => {
    const p = props({ newTriggerType: "manual" });
    render(<SchedulingStep {...p} />);
    fireEvent.click(screen.getByRole("button", { name: /Salvar e Disparar Agora/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Confirmar e Disparar Agora/i })).toBeDefined());
  });
});
