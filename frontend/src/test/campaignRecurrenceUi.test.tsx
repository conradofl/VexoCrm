import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SchedulingStep } from "@/pages/LeadImports/SchedulingStep";
import { CampaignsTable } from "@/pages/LeadImports/CampaignsTable";
import { formatRecurrenceBadge, formatNextRunDate } from "@/lib/campaignRecurrence";
import type { Campaign } from "@/hooks/useCampanhas";

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    getIdToken: async () => "token",
    isAuthenticated: true,
    clientId: "sonhare",
    accessProfile: { role: "client" },
  }),
}));

vi.mock("@/hooks/useCrmClient", () => ({
  useOptionalCrmClient: () => ({
    selectedClient: { id: "sonhare", name: "Sonhare Odonto", n8n_settings: {} },
    selectedClientId: "sonhare",
  }),
}));

vi.mock("@/pages/LeadImports/DispatchKpiCards", () => ({
  DispatchKpiCards: () => <div data-testid="mock-kpi-cards" />,
}));

describe("Pilar 3: UI de Campanhas Recorrentes", () => {
  describe("Helpers de formatação", () => {
    it("formatRecurrenceBadge formata mensal, semanal e quinzenal", () => {
      expect(
        formatRecurrenceBadge({
          is_recurring: true,
          recurrence_pattern: "monthly",
          recurrence_day_of_month: 15,
        })
      ).toBe("Mensal (Dia 15)");

      expect(
        formatRecurrenceBadge({
          is_recurring: true,
          recurrence_pattern: "weekly",
          recurrence_day_of_week: 2,
        })
      ).toBe("Semanal (Terça)");

      expect(
        formatRecurrenceBadge({
          is_recurring: true,
          recurrence_pattern: "biweekly",
          recurrence_day_of_week: 4,
        })
      ).toBe("Quinzenal (Quinta)");

      expect(
        formatRecurrenceBadge({
          is_recurring: false,
        })
      ).toBe("");
    });

    it("formatNextRunDate formata data para DD/MM às HH:mm", () => {
      // 2026-11-15T09:00:00 (ajustando para horário local)
      const d = new Date(2026, 10, 15, 9, 30);
      expect(formatNextRunDate(d.toISOString())).toBe("15/11 às 09:30");
      expect(formatNextRunDate(null)).toBe("");
    });
  });

  describe("SchedulingStep — Seletor de Recorrência", () => {
    function SchedulingStepWrapper({
      initialIsRecurring = false,
      initialPattern = "monthly",
      initialDayOfMonth = 15,
      initialDayOfWeek = 2,
      initialTime = "09:00",
    }: {
      initialIsRecurring?: boolean;
      initialPattern?: "monthly" | "weekly" | "biweekly";
      initialDayOfMonth?: number;
      initialDayOfWeek?: number;
      initialTime?: string;
    }) {
      const [isRecurring, setIsRecurring] = useState(initialIsRecurring);
      const [recurrencePattern, setRecurrencePattern] = useState(initialPattern);
      const [recurrenceDayOfMonth, setRecurrenceDayOfMonth] = useState(initialDayOfMonth);
      const [recurrenceDayOfWeek, setRecurrenceDayOfWeek] = useState(initialDayOfWeek);
      const [recurrenceTime, setRecurrenceTime] = useState(initialTime);
      const [newTriggerType, setNewTriggerType] = useState<"manual" | "scheduled" | "draft">("scheduled");
      const [newScheduledAt, setNewScheduledAt] = useState("2026-10-15T09:00");

      return (
        <SchedulingStep
          dispatchOptions={
            {
              leadDelaySeconds: 5,
              stopOnStepFailure: false,
              aiAssisted: false,
            } as any
          }
          setDispatchOptions={vi.fn()}
          evolutionInstanceOptions={[{ id: "inst-1", name: "WhatsApp Principal", isDefault: true }]}
          totalLeads={100}
          batchingEnabled={false}
          setBatchingEnabled={vi.fn()}
          batchSize="100"
          setBatchSize={vi.fn()}
          batchIntervalHours="1"
          setBatchIntervalHours={vi.fn()}
          replyAgent="passos"
          setReplyAgent={vi.fn()}
          campaignAgentPrompt=""
          setCampaignAgentPrompt={vi.fn()}
          passosAposResposta={0}
          multiAgendaEnabled={false}
          setMultiAgendaEnabled={vi.fn()}
          consultants={[]}
          updateConsultant={{} as any}
          deleteConsultant={{} as any}
          createConsultant={{} as any}
          activeClientId="ademicon"
          newConsultantName=""
          setNewConsultantName={vi.fn()}
          newConsultantLink=""
          setNewConsultantLink={vi.fn()}
          onCreateConsultant={vi.fn()}
          newTriggerType={newTriggerType}
          setNewTriggerType={setNewTriggerType}
          newScheduledAt={newScheduledAt}
          setNewScheduledAt={setNewScheduledAt}
          isRecurring={isRecurring}
          setIsRecurring={setIsRecurring}
          recurrencePattern={recurrencePattern}
          setRecurrencePattern={setRecurrencePattern}
          recurrenceDayOfMonth={recurrenceDayOfMonth}
          setRecurrenceDayOfMonth={setRecurrenceDayOfMonth}
          recurrenceDayOfWeek={recurrenceDayOfWeek}
          setRecurrenceDayOfWeek={setRecurrenceDayOfWeek}
          recurrenceTime={recurrenceTime}
          setRecurrenceTime={setRecurrenceTime}
          onSubmit={vi.fn()}
          isSubmitting={false}
          editingCampaignId={null}
          onCancelEdit={vi.fn()}
          onNovaCampanha={vi.fn()}
        />
      );
    }

    it("renderiza o switch de recorrência e opções quando ativado", () => {
      renderWithProviders(<SchedulingStepWrapper initialIsRecurring={false} />);

      // Verifica presença do switch de recorrência
      expect(screen.getByText(/Repetir esta campanha periodicamente/i)).toBeTruthy();
      const switchEl = screen.getByTestId("recurrence-switch");
      expect(switchEl).toBeTruthy();
      expect(screen.queryByTestId("recurrence-options")).toBeNull();

      // Ativa o switch
      fireEvent.click(switchEl);

      // Opções passam a ser visíveis
      expect(screen.getByTestId("recurrence-options")).toBeTruthy();
      expect(screen.getByTestId("recurrence-pattern-select")).toBeTruthy();
      expect(screen.getByTestId("recurrence-day-of-month-input")).toBeTruthy();
      expect(screen.getByTestId("recurrence-time-input")).toBeTruthy();
    });

    it("permite alterar dia do mês e horário para campanha mensal (Aviso de Assembleia)", () => {
      renderWithProviders(
        <SchedulingStepWrapper
          initialIsRecurring={true}
          initialPattern="monthly"
          initialDayOfMonth={15}
          initialTime="09:00"
        />
      );

      const dayInput = screen.getByTestId("recurrence-day-of-month-input") as HTMLInputElement;
      expect(dayInput.value).toBe("15");

      fireEvent.change(dayInput, { target: { value: "20" } });
      expect(dayInput.value).toBe("20");

      const timeInput = screen.getByTestId("recurrence-time-input") as HTMLInputElement;
      expect(timeInput.value).toBe("09:00");

      fireEvent.change(timeInput, { target: { value: "10:30" } });
      expect(timeInput.value).toBe("10:30");
    });
  });

  describe("CampaignsTable — Visualização de Recorrência na Lista de Campanhas", () => {
    it("exibe badge de ciclo e próxima execução para campanha mensal da Ademicon", () => {
      const mockCampaign: Campaign = {
        id: "camp-ademicon",
        name: "Aviso de Assembleia Mensal",
        client_id: "ademicon",
        client_name: "Ademicon Consórcios",
        import_id: null,
        limit_per_run: 200,
        webhook_url: "https://wa.teste",
        webhook_token: null,
        status: "active",
        scheduled_for: "2026-11-15T12:00:00.000Z",
        next_run_at: "2026-11-15T12:00:00.000Z",
        last_triggered_at: null,
        archived_at: null,
        created_by_uid: "uid-1",
        created_by_email: "caio@ademicon.com",
        created_at: "2026-10-01T10:00:00Z",
        starts_at: null,
        ends_at: null,
        chatbot_prompt_type: "padrao",
        campaign_prompt_id: null,
        mode: "disparo",
        is_recurring: true,
        recurrence_pattern: "monthly",
        recurrence_day_of_month: 15,
        recurrence_time: "09:00",
      };

      renderWithProviders(
        <CampaignsTable
          clientId="ademicon"
          campaigns={[mockCampaign]}
          loadingCampaigns={false}
          onEditCampaign={vi.fn()}
          onDuplicateCampaign={vi.fn()}
          onDeleteCampaign={vi.fn()}
        />
      );

      const card = screen.getByTestId("campaign-card-camp-ademicon");

      // Badge de recorrência
      const recurrenceBadge = within(card).getByTestId("campaign-recurrence-camp-ademicon");
      expect(recurrenceBadge.textContent).toContain("🔄 Mensal (Dia 15)");

      // Próxima Execução
      const nextRunEl = within(card).getByTestId("campaign-next-run-camp-ademicon");
      expect(nextRunEl.textContent).toContain("Próxima Execução:");
    });

    it("exibe badge semanal para campanha da Via Permuta", () => {
      const mockCampaign: Campaign = {
        id: "camp-via-permuta",
        name: "Calendário de Ações Semanais",
        client_id: "viapermuta",
        client_name: "Via Permuta",
        import_id: null,
        limit_per_run: 50,
        webhook_url: "https://wa.teste",
        webhook_token: null,
        status: "active",
        scheduled_for: "2026-10-13T13:00:00.000Z",
        next_run_at: "2026-10-13T13:00:00.000Z",
        last_triggered_at: null,
        archived_at: null,
        created_by_uid: "uid-2",
        created_by_email: "vendas@viapermuta.com",
        created_at: "2026-10-01T10:00:00Z",
        starts_at: null,
        ends_at: null,
        chatbot_prompt_type: "padrao",
        campaign_prompt_id: null,
        mode: "disparo",
        is_recurring: true,
        recurrence_pattern: "weekly",
        recurrence_day_of_week: 2, // Terça-feira
        recurrence_time: "10:00",
      };

      renderWithProviders(
        <CampaignsTable
          clientId="viapermuta"
          campaigns={[mockCampaign]}
          loadingCampaigns={false}
          onEditCampaign={vi.fn()}
          onDuplicateCampaign={vi.fn()}
          onDeleteCampaign={vi.fn()}
        />
      );

      const card = screen.getByTestId("campaign-card-camp-via-permuta");

      // Badge de recorrência semanal
      const recurrenceBadge = within(card).getByTestId("campaign-recurrence-camp-via-permuta");
      expect(recurrenceBadge.textContent).toContain("🔄 Semanal (Terça)");
    });

    it("campanha não-recorrente não exibe badge de recorrência", () => {
      const mockCampaign: Campaign = {
        id: "camp-pontual",
        name: "Disparo Pontual Black Friday",
        client_id: "loja-1",
        client_name: "Loja 1",
        import_id: null,
        limit_per_run: 50,
        webhook_url: "https://wa.teste",
        webhook_token: null,
        status: "active",
        scheduled_for: null,
        next_run_at: null,
        last_triggered_at: null,
        archived_at: null,
        created_by_uid: "uid-3",
        created_by_email: "loja@teste.com",
        created_at: "2026-10-01T10:00:00Z",
        starts_at: null,
        ends_at: null,
        chatbot_prompt_type: "padrao",
        campaign_prompt_id: null,
        mode: "disparo",
        is_recurring: false,
      };

      renderWithProviders(
        <CampaignsTable
          clientId="loja-1"
          campaigns={[mockCampaign]}
          loadingCampaigns={false}
          onEditCampaign={vi.fn()}
          onDuplicateCampaign={vi.fn()}
          onDeleteCampaign={vi.fn()}
        />
      );

      const card = screen.getByTestId("campaign-card-camp-pontual");
      expect(within(card).queryByTestId("campaign-recurrence-camp-pontual")).toBeNull();
      expect(within(card).queryByTestId("campaign-next-run-camp-pontual")).toBeNull();
    });
  });
});
