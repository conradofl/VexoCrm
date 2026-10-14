import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { CampaignsTable } from "@/pages/LeadImports/CampaignsTable";
import { getCampaignNextRunLabel } from "@/lib/campaignRecurrence";
import type { Campaign, CampaignDispatch } from "@/hooks/useCampanhas";

const clickList = () => fireEvent.click(screen.getByRole("button", { name: /Ver em lista/i }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    getIdToken: async () => "token",
    isAuthenticated: true,
    clientId: "cliente-teste",
    accessProfile: { role: "client" },
  }),
}));

vi.mock("@/pages/LeadImports/DispatchKpiCards", () => ({
  DispatchKpiCards: () => <div data-testid="mock-kpi-cards" />,
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>{ui}</BrowserRouter>
    </QueryClientProvider>
  );
}

const baseCampaign: Campaign = {
  id: "camp-test-1",
  name: "Campanha Base de Teste",
  client_id: "cliente-teste",
  client_name: "Cliente Teste",
  import_id: null,
  limit_per_run: 50,
  webhook_url: "https://wa.teste",
  webhook_token: null,
  status: "active",
  scheduled_for: null,
  last_triggered_at: null,
  archived_at: null,
  created_by_uid: "uid-1",
  created_by_email: "teste@teste.com",
  created_at: "2026-10-10T10:00:00.000Z",
  starts_at: null,
  ends_at: null,
  chatbot_prompt_type: "padrao",
  campaign_prompt_id: null,
  mode: "disparo",
  is_recurring: false,
};

describe("BLOCO 4 — Coluna PRÓXIMO DISPARO na lista de campanhas", () => {
  beforeEach(() => {
    localStorage.clear();
    // Forçar modo "list" para visualizar a tabela de colunas
    localStorage.setItem("vexo_view_mode:campanhas", "list");
  });

  describe("Função pura getCampaignNextRunLabel", () => {
    it("recorrente: usa next_run_label quando disponível", () => {
      const camp: Partial<Campaign> = {
        is_recurring: true,
        next_run_label: "15/11 às 09:00",
      };
      expect(getCampaignNextRunLabel(camp)).toBe("15/11 às 09:00");
    });

    it("recorrente sem next_run_label (encerrada/parada): devolve traço", () => {
      const camp: Partial<Campaign> = {
        is_recurring: true,
        next_run_label: null,
      };
      expect(getCampaignNextRunLabel(camp)).toBe("—");
    });

    it("avulsa agendada: usa o disparo pendente mais próximo", () => {
      const camp: Partial<Campaign> = {
        id: "camp-123",
        status: "scheduled",
        is_recurring: false,
      };
      const dispatches: Array<{ campaign_id: string; status: string; scheduled_at: string | null }> = [
        { campaign_id: "camp-123", status: "scheduled", scheduled_at: "2026-11-25T14:00:00.000Z" },
        { campaign_id: "camp-123", status: "scheduled", scheduled_at: "2026-11-20T17:30:00.000Z" },
        { campaign_id: "outro", status: "scheduled", scheduled_at: "2026-11-10T10:00:00.000Z" },
      ];
      const result = getCampaignNextRunLabel(camp, dispatches);
      // Deve pegar o mais próximo (20/11)
      expect(result).toContain("20/11");
    });

    it("avulsa agendada: quando não há lista de disparos, usa scheduled_for da campanha", () => {
      const camp: Partial<Campaign> = {
        status: "scheduled",
        scheduled_for: "2026-11-20T17:30:00.000Z",
        is_recurring: false,
      };
      const result = getCampaignNextRunLabel(camp);
      expect(result).toContain("20/11");
    });

    it("sem agendamento: devolve traço", () => {
      const camp: Partial<Campaign> = {
        status: "active",
        scheduled_for: null,
        is_recurring: false,
      };
      expect(getCampaignNextRunLabel(camp)).toBe("—");
    });
  });

  describe("Tabela de Campanhas Configuradas (RecordView em modo lista)", () => {
    it("(a) campanha agendada mostra a data na coluna", () => {
      const scheduledCampaign: Campaign = {
        ...baseCampaign,
        id: "camp-sched",
        name: "Campanha Agendada Black Friday",
        status: "scheduled",
        scheduled_for: "2026-11-20T17:30:00.000Z",
      };

      const dispatch: CampaignDispatch = {
        id: "disp-1",
        campaign_id: "camp-sched",
        client_id: "cliente-teste",
        name: "Disparo Agendado",
        steps: [],
        trigger_type: "scheduled",
        scheduled_at: "2026-11-20T17:30:00.000Z",
        status: "scheduled",
        sent_count: 0,
        failed_count: 0,
        triggered_at: null,
        finished_at: null,
        error_message: null,
        created_at: "2026-10-10T10:00:00.000Z",
        updated_at: "2026-10-10T10:00:00.000Z",
      };

      renderWithProviders(
        <CampaignsTable
          clientId="cliente-teste"
          campaigns={[scheduledCampaign]}
          loadingCampaigns={false}
          dispatches={[dispatch]}
          onEditCampaign={vi.fn()}
          onDuplicateCampaign={vi.fn()}
          onDeleteCampaign={vi.fn()}
        />
      );

      clickList();

      // Cabeçalho da coluna "Próximo disparo"
      const header = screen.getByRole("columnheader", { name: /Próximo disparo/i });
      expect(header).toBeDefined();

      // Célula na linha da campanha
      const row = screen.getByTestId("campaign-row-camp-sched");
      const nextDispatchCell = within(row).getByText(/20\/11/i);
      expect(nextDispatchCell).toBeDefined();
    });

    it("(b) campanha sem agendamento mostra traço", () => {
      const unscheduledCampaign: Campaign = {
        ...baseCampaign,
        id: "camp-unsched",
        name: "Campanha Manual Sem Agendamento",
        status: "active",
        scheduled_for: null,
      };

      renderWithProviders(
        <CampaignsTable
          clientId="cliente-teste"
          campaigns={[unscheduledCampaign]}
          loadingCampaigns={false}
          dispatches={[]}
          onEditCampaign={vi.fn()}
          onDuplicateCampaign={vi.fn()}
          onDeleteCampaign={vi.fn()}
        />
      );

      clickList();

      const row = screen.getByTestId("campaign-row-camp-unsched");
      const nextDispatchSpan = row.querySelector('[data-field="next_dispatch"]');
      expect(nextDispatchSpan?.textContent).toBe("—");
    });

    it("(c) recorrente mostra o rótulo da próxima ocorrência", () => {
      const recurringCampaign: Campaign = {
        ...baseCampaign,
        id: "camp-rec",
        name: "Campanha Mensal VIP",
        is_recurring: true,
        recurrence_pattern: "monthly",
        recurrence_day_of_month: 15,
        recurrence_end_type: "never",
        next_run_label: "15/11 às 09:00",
      };

      renderWithProviders(
        <CampaignsTable
          clientId="cliente-teste"
          campaigns={[recurringCampaign]}
          loadingCampaigns={false}
          dispatches={[]}
          onEditCampaign={vi.fn()}
          onDuplicateCampaign={vi.fn()}
          onDeleteCampaign={vi.fn()}
        />
      );

      clickList();

      const row = screen.getByTestId("campaign-row-camp-rec");
      const nextDispatchSpan = row.querySelector('[data-field="next_dispatch"]');
      expect(nextDispatchSpan?.textContent).toBe("15/11 às 09:00");
    });
  });
});
