// frontend/src/test/stalledLeadsBadge.test.tsx
// Testes de renderização do Pilar 1: Aviso de Lead Parado (Nenhum Lead Esquecido)
// Validação do badge visual de inatividade, cálculo de dias, limiar dinâmico do tenant e card de alerta no Dashboard

import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { StalledLeadBadge } from "@/components/leads/StalledLeadBadge";
import { StalledLeadsAlertCard } from "@/components/dashboard/StalledLeadsAlertCard";
import {
  computeLeadDaysIdle,
  isLeadStalled,
  isLeadStageClosed,
} from "@/lib/leads/stalledLeads";

// Mock do useNavigate
const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock do contexto de autenticação
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    clientId: "tenant-teste",
    isAuthenticated: true,
    getIdToken: async () => "mock-token",
  }),
}));

// Mock do hook useStalledLeads para o Card
let mockStalledData: any = { count: 8, stalled_count: 8, never_approached_count: 5, minDays: 7, leads: [] };
let mockIsLoading = false;
let lastPassedMinDays: number | null | undefined = undefined;

vi.mock("@/hooks/useStalledLeads", () => ({
  useStalledLeads: (_clientId: string, minDays: number | null = null) => {
    lastPassedMinDays = minDays;
    return {
      data: mockStalledData,
      isLoading: mockIsLoading,
      error: null,
    };
  },
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Pilar 1: StalledLeadBadge & Funções Puras", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    lastPassedMinDays = undefined;
    mockIsLoading = false;
    mockStalledData = { count: 8, stalled_count: 8, never_approached_count: 5, minDays: 7, leads: [] };
  });

  describe("1. Funções puras de cálculo de inatividade (stalledLeads.ts)", () => {
    it("reconhece estágios fechados e perdidos", () => {
      expect(isLeadStageClosed("buyer")).toBe(true);
      expect(isLeadStageClosed("fechado")).toBe(true);
      expect(isLeadStageClosed("perdido")).toBe(true);
      expect(isLeadStageClosed("descartado")).toBe(true);
      expect(isLeadStageClosed("lost")).toBe(true);

      expect(isLeadStageClosed("open_budget")).toBe(false);
      expect(isLeadStageClosed("cold")).toBe(false);
      expect(isLeadStageClosed("inquiry")).toBe(false);
      expect(isLeadStageClosed(null)).toBe(false);
      expect(isLeadStageClosed(undefined)).toBe(false);
    });

    it("utiliza days_idle pré-computado quando disponível", () => {
      const lead = { id: "1", days_idle: 5, stage: "open_budget" };
      expect(computeLeadDaysIdle(lead)).toBe(5);
      expect(isLeadStalled(lead, 3)).toBe(true);
    });

    it("calcula inatividade a partir de last_message_at e last_interaction_at (sem fallback para created_at/updated_at)", () => {
      const now = Date.now();
      const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();

      // Lead com conversa há 5 dias: parado
      const leadWithMsg = {
        id: "2",
        last_message_at: fiveDaysAgo,
        stage: "open_budget",
      };
      expect(computeLeadDaysIdle(leadWithMsg)).toBeGreaterThanOrEqual(5);
      expect(isLeadStalled(leadWithMsg, 3)).toBe(true);

      // Lead importado de planilha há 30 dias mas SEM mensagem: NÃO é parado (nunca abordado)
      const leadPlanilhaFria = {
        id: "3",
        created_at: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
        updated_at: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
        stage: "open_budget",
      };
      expect(computeLeadDaysIdle(leadPlanilhaFria)).toBe(0);
      expect(isLeadStalled(leadPlanilhaFria, 3)).toBe(false);

      // Lead com mensagem recente (1 dia atrás)
      const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();
      const leadRecent = {
        id: "4",
        last_message_at: oneDayAgo,
        stage: "cold",
      };
      expect(computeLeadDaysIdle(leadRecent)).toBeLessThan(3);
      expect(isLeadStalled(leadRecent, 3)).toBe(false);
    });

    it("retorna 0 dias de inatividade para leads fechados ou perdidos", () => {
      const leadBuyer = { id: "5", days_idle: 20, stage: "buyer" };
      expect(computeLeadDaysIdle(leadBuyer)).toBe(0);
      expect(isLeadStalled(leadBuyer, 3)).toBe(false);

      const leadLost = { id: "6", days_idle: 15, stage: "perdido" };
      expect(computeLeadDaysIdle(leadLost)).toBe(0);
      expect(isLeadStalled(leadLost, 3)).toBe(false);
    });
  });

  describe("2. Renderização do componente StalledLeadBadge", () => {
    it("renderiza o badge quando o lead está parado há 3 ou mais dias", () => {
      const lead = {
        id: "lead-123",
        nome: "Carlos Silva",
        days_idle: 7,
        stage: "open_budget",
      };

      render(<StalledLeadBadge lead={lead} minDays={3} />);

      const badge = screen.getByTestId("lead-stalled-badge-lead-123");
      expect(badge).toBeInTheDocument();
      expect(badge.textContent).toContain("⚠️");
      expect(badge.textContent).toContain("7d sem resposta");
      expect(badge.className).toContain("bg-amber-500/10");
      expect(badge.className).toContain("text-amber-700");
    });

    it("não renderiza o badge quando o lead tem menos dias que o limiar", () => {
      const lead = {
        id: "lead-recent",
        days_idle: 1,
        stage: "open_budget",
      };

      const { container } = render(<StalledLeadBadge lead={lead} minDays={3} />);
      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId("lead-stalled-badge-lead-recent")).not.toBeInTheDocument();
    });

    it("não renderiza o badge quando o lead está em etapa fechada (buyer / lost)", () => {
      const leadClosed = {
        id: "lead-closed",
        days_idle: 10,
        stage: "buyer",
      };

      const { container } = render(<StalledLeadBadge lead={leadClosed} minDays={3} />);
      expect(container.firstChild).toBeNull();
      expect(screen.queryByTestId("lead-stalled-badge-lead-closed")).not.toBeInTheDocument();
    });
  });

  describe("3. Renderização do Card de Alerta no Dashboard (StalledLeadsAlertCard)", () => {
    it("chama useStalledLeads com null para respeitar o limiar dinâmico do tenant e exibe limiar retornado pela API", () => {
      mockStalledData = { count: 12, stalled_count: 12, never_approached_count: 77, minDays: 7, leads: [] };

      // Chamada padrão do Dashboard (sem passar minDays fixo):
      renderWithProviders(<StalledLeadsAlertCard clientId="tenant-teste" />);

      // Garante que o hook foi chamado com null (fazendo o backend aplicar o reactivation_stalled_days do tenant)
      expect(lastPassedMinDays).toBeNull();

      const card = screen.getByTestId("stalled-leads-alert-card");
      expect(card).toBeInTheDocument();

      // Indicador visual com o limiar real do tenant (7 dias): ⚠️ 12 Leads Parados (> 7 dias)
      expect(screen.getByText(/⚠️ 12 Leads Parados \(> 7 dias\)/)).toBeInTheDocument();

      // Subtítulo operacional dinâmico (não exibe 'Nenhum lead esquecido' quando há alerta ativo!)
      expect(screen.getByText(/Contatos em conversa sem resposta há mais de 7 dias/)).toBeInTheDocument();

      // Exibe também a contagem separada de 'Nunca Abordados'
      expect(screen.getByText(/77 nunca abordados/)).toBeInTheDocument();

      // Botão de navegação para a tela de Leads Parados
      const button = screen.getByTestId("view-stalled-leads-button");
      expect(button).toBeInTheDocument();
      fireEvent.click(button);
      expect(mockNavigate).toHaveBeenCalledWith("/crm/leads-parados");
    });

    it("renderiza skeleton limpo sem dados fabricados enquanto está carregando", () => {
      mockIsLoading = true;
      mockStalledData = null;

      renderWithProviders(<StalledLeadsAlertCard clientId="tenant-teste" />);

      expect(screen.getByTestId("stalled-leads-alert-card-skeleton")).toBeInTheDocument();
      expect(screen.queryByText(/Leads Parados/)).not.toBeInTheDocument();
    });

    it("renderiza estado positivo e 'Nenhum lead esquecido · SLA em dia' apenas quando count === 0", () => {
      mockStalledData = { count: 0, stalled_count: 0, never_approached_count: 0, minDays: 7, leads: [] };

      renderWithProviders(<StalledLeadsAlertCard clientId="tenant-teste" />);

      expect(screen.getAllByText(/SLA 100% em dia/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Nenhum lead esquecido · SLA em dia/)).toBeInTheDocument();
      expect(screen.queryByText(/⚠️/)).not.toBeInTheDocument();
    });

    it("PROVA POR MUTAÇÃO: Garante que forçar minDays = 3 fixo quebra a paridade com o tenant (7 dias)", () => {
      // Simula um tenant com regra de 7 dias
      mockStalledData = { count: 5, stalled_count: 5, never_approached_count: 0, minDays: 7, leads: [] };

      // Se um desenvolvedor passar minDays={3} forçado no Dashboard:
      renderWithProviders(<StalledLeadsAlertCard clientId="tenant-teste" minDays={3} />);

      // lastPassedMinDays seria 3 em vez de null
      expect(lastPassedMinDays).toBe(3);
      // Se forçado a 3, não respeitaria a chamada dinâmica do tenant
      expect(lastPassedMinDays).not.toBeNull();
    });
  });
});
