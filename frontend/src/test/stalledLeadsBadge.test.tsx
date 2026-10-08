// frontend/src/test/stalledLeadsBadge.test.tsx
// Testes de renderização do Pilar 1: Aviso de Lead Parado (Nenhum Lead Esquecido)
// Validação do badge visual de inatividade, cálculo de dias e card de alerta no Dashboard

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
let mockStalledData: any = { count: 14, minDays: 3, leads: [] };
let mockIsLoading = false;

vi.mock("@/hooks/useStalledLeads", () => ({
  useStalledLeads: () => ({
    data: mockStalledData,
    isLoading: mockIsLoading,
    error: null,
  }),
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

    it("calcula inatividade a partir de datas passadas (last_message_at, updated_at)", () => {
      const now = Date.now();
      const fiveDaysAgo = new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString();

      const leadWithMsg = {
        id: "2",
        last_message_at: fiveDaysAgo,
        stage: "open_budget",
      };
      expect(computeLeadDaysIdle(leadWithMsg)).toBeGreaterThanOrEqual(5);
      expect(isLeadStalled(leadWithMsg, 3)).toBe(true);

      const oneDayAgo = new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString();
      const leadRecent = {
        id: "3",
        updated_at: oneDayAgo,
        stage: "cold",
      };
      expect(computeLeadDaysIdle(leadRecent)).toBeLessThan(3);
      expect(isLeadStalled(leadRecent, 3)).toBe(false);
    });

    it("retorna 0 dias de inatividade para leads fechados ou perdidos", () => {
      const leadBuyer = { id: "4", days_idle: 20, stage: "buyer" };
      expect(computeLeadDaysIdle(leadBuyer)).toBe(0);
      expect(isLeadStalled(leadBuyer, 3)).toBe(false);

      const leadLost = { id: "5", days_idle: 15, stage: "perdido" };
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

      // Confere as classes de estilo âmbar exigidas na especificação
      expect(badge.className).toContain("bg-amber-500/10");
      expect(badge.className).toContain("text-amber-700");
      expect(badge.className).toContain("border-amber-500/30");
      expect(badge.className).toContain("text-[10.5px]");
      expect(badge.className).toContain("rounded");
    });

    it("não renderiza o badge quando o lead tem menos de 3 dias de inatividade", () => {
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
    it("exibe o número correto de leads parados, subtítulo e botão de ação", () => {
      mockStalledData = { count: 8, minDays: 3, leads: [] };

      renderWithProviders(<StalledLeadsAlertCard clientId="tenant-teste" minDays={3} />);

      const card = screen.getByTestId("stalled-leads-alert-card");
      expect(card).toBeInTheDocument();

      // Indicador visual: ⚠️ 8 Leads Parados (> 3 dias)
      expect(screen.getByText(/⚠️ 8 Leads Parados/)).toBeInTheDocument();
      expect(screen.getByText(/Nenhum lead esquecido/)).toBeInTheDocument();

      // Botão de navegação para o Banco de Dados
      const button = screen.getByTestId("view-stalled-leads-button");
      expect(button).toBeInTheDocument();
      expect(button.textContent).toContain("Visualizar no Banco de Dados");

      // Clicar redireciona para /crm/banco-de-dados?stalled=3
      fireEvent.click(button);
      expect(mockNavigate).toHaveBeenCalledWith("/crm/banco-de-dados?stalled=3");
    });

    it("renderiza estado positivo quando nenhum lead está parado", () => {
      mockStalledData = { count: 0, minDays: 3, leads: [] };

      renderWithProviders(<StalledLeadsAlertCard clientId="tenant-teste" minDays={3} />);

      expect(screen.getByText(/⚠️ 0 Leads Parados/)).toBeInTheDocument();
      expect(screen.getByText(/SLA 100% em dia/)).toBeInTheDocument();
    });
  });
});
