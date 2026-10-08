import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, renderHook } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { computeOnboardingProgress } from "@/lib/onboarding/progress";
import { useOnboardingProgress } from "@/hooks/useOnboardingProgress";
import { OnboardingProgressCard } from "@/components/dashboard/OnboardingProgressCard";
import VexoOnboardingSetup from "@/pages/VexoOnboardingSetup";
import type { LeadClient } from "@/hooks/useLeadClients";

// Mocks
let mockSelectedClient: Partial<LeadClient> | null = null;
let mockFacetsBaseTotal: number | null = 0;

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    getIdToken: async () => "mock-token",
  }),
}));

vi.mock("@/hooks/useCrmClient", () => ({
  useOptionalCrmClient: () => ({
    selectedClientId: mockSelectedClient?.id || "tenant-test",
    selectedClient: mockSelectedClient,
    clients: mockSelectedClient ? [mockSelectedClient] : [],
    isLoading: false,
    setSelectedClientId: vi.fn(),
  }),
}));

vi.mock("@/lib/api", () => ({
  fetchApi: vi.fn().mockImplementation(async () => ({
    ok: true,
    json: async () => ({ baseTotal: mockFacetsBaseTotal }),
  })),
  readApiJson: vi.fn().mockImplementation(async () => ({ baseTotal: mockFacetsBaseTotal })),
}));

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Nova Experiência de Onboarding & Implantação Vexo (3 Passos)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectedClient = {
      id: "empresa-1",
      name: "Empresa Teste",
      n8n_settings: {
        active: true,
        dispatch_webhook_url: null,
        has_dispatch_webhook_token: false,
        has_inbound_bearer_token: false,
        chatbot_enabled: false,
        chatbot_model: "openai/gpt-oss-120b",
        evolution_instances: [],
      } as any,
    };
    mockFacetsBaseTotal = 0;
  });

  describe("1. Cálculo de Progresso (computeOnboardingProgress)", () => {
    it("0/3 concluídos: sem chip, sem agente, sem contatos na base", () => {
      const client: any = {
        n8n_settings: {
          chatbot_enabled: false,
          evolution_instances: [],
        },
      };
      const result = computeOnboardingProgress(client, 0);

      expect(result.completedCount).toBe(0);
      expect(result.totalSteps).toBe(3);
      expect(result.percent).toBe(0);
      expect(result.isFullyReady).toBe(false);

      expect(result.steps[0].id).toBe("chip");
      expect(result.steps[0].done).toBe(false);
      expect(result.steps[1].id).toBe("agente");
      expect(result.steps[1].done).toBe(false);
      expect(result.steps[2].id).toBe("leads");
      expect(result.steps[2].done).toBe(false);
    });

    it("1/3 concluídos: 1 chip conectado, agente desligado, sem contatos", () => {
      const client: any = {
        n8n_settings: {
          chatbot_enabled: false,
          evolution_instances: [{ name: "Instancia-1", active: true }],
        },
      };
      const result = computeOnboardingProgress(client, 0);

      expect(result.completedCount).toBe(1);
      expect(result.percent).toBe(33);
      expect(result.isFullyReady).toBe(false);

      expect(result.steps[0].done).toBe(true);
      expect(result.steps[1].done).toBe(false);
      expect(result.steps[2].done).toBe(false);
    });

    it("2/3 concluídos: chip conectado e agente de IA ativado, sem contatos", () => {
      const client: any = {
        n8n_settings: {
          chatbot_enabled: true,
          evolution_instances: [{ name: "Instancia-1", active: true }],
        },
      };
      const result = computeOnboardingProgress(client, 0);

      expect(result.completedCount).toBe(2);
      expect(result.percent).toBe(67);
      expect(result.isFullyReady).toBe(false);

      expect(result.steps[0].done).toBe(true);
      expect(result.steps[1].done).toBe(true);
      expect(result.steps[2].done).toBe(false);
    });

    it("3/3 concluídos: chip conectado, agente ativado e contatos importados", () => {
      const client: any = {
        n8n_settings: {
          chatbot_enabled: true,
          evolution_instances: [{ name: "Instancia-1", active: true }],
        },
      };
      const result = computeOnboardingProgress(client, 1500);

      expect(result.completedCount).toBe(3);
      expect(result.percent).toBe(100);
      expect(result.isFullyReady).toBe(true);

      expect(result.steps[0].done).toBe(true);
      expect(result.steps[1].done).toBe(true);
      expect(result.steps[2].done).toBe(true);
    });
  });

  describe("2. OnboardingProgressCard no Dashboard", () => {
    it("Renderiza card incompleto com percentual, 3 passos e links corretos", () => {
      mockSelectedClient = {
        id: "empresa-1",
        name: "Empresa Teste",
        n8n_settings: {
          chatbot_enabled: false,
          evolution_instances: [{ name: "Chip 1", active: true }],
        } as any,
      };

      renderWithProviders(<OnboardingProgressCard clientId="empresa-1" baseTotal={0} />);

      // Verifica cabeçalho e progresso (1 de 3 passos = 33%)
      expect(screen.getByText("Implantação & Boas-Vindas Vexo OS")).toBeInTheDocument();
      expect(screen.getByText("1/3 passos (33%)")).toBeInTheDocument();

      // Verifica os 3 passos
      expect(screen.getByText("Conectar WhatsApp")).toBeInTheDocument();
      expect(screen.getByText("Configurar Agente IA")).toBeInTheDocument();
      expect(screen.getByText("Importar Base de Leads")).toBeInTheDocument();

      // Verifica links de navegação para os passos
      const chipStepDone = screen.getByText("Pronto");
      expect(chipStepDone).toBeInTheDocument();

      const links = screen.getAllByRole("link");
      const agentLink = links.find((l) => l.getAttribute("href") === "/crm/agente");
      expect(agentLink).toBeDefined();

      const leadsLink = links.find((l) => l.getAttribute("href") === "/crm/planilhas");
      expect(leadsLink).toBeDefined();

      // Botão principal para o guia completo
      const guideLink = links.find((l) => l.getAttribute("href") === "/crm/implantacao");
      expect(guideLink).toBeDefined();
      expect(guideLink).toHaveTextContent("Abrir Guia de Implantação Completo");
    });

    it("Permite recolher e expandir o card de progresso", () => {
      mockSelectedClient = {
        id: "empresa-1",
        name: "Empresa Teste",
        n8n_settings: {
          chatbot_enabled: false,
          evolution_instances: [],
        } as any,
      };

      renderWithProviders(<OnboardingProgressCard clientId="empresa-1" baseTotal={0} />);

      const collapseButton = screen.getByRole("button", { name: /Recolher/i });
      fireEvent.click(collapseButton);

      // Deve estar minimizado com o botão Expandir
      expect(screen.getByRole("button", { name: /Expandir/i })).toBeInTheDocument();
      expect(screen.getByText(/0 de 3 passos concluídos/i)).toBeInTheDocument();

      // Clica em Expandir
      fireEvent.click(screen.getByRole("button", { name: /Expandir/i }));
      expect(screen.getByText("Implantação & Boas-Vindas Vexo OS")).toBeInTheDocument();
    });

    it("Exibe badge sutil de 100% ativo quando todos os marcos estão prontos", () => {
      mockSelectedClient = {
        id: "empresa-1",
        name: "Empresa Teste",
        n8n_settings: {
          chatbot_enabled: true,
          evolution_instances: [{ name: "Chip 1", active: true }],
        } as any,
      };

      renderWithProviders(<OnboardingProgressCard clientId="empresa-1" baseTotal={500} />);

      expect(screen.getByText("✅ Operação 100% Ativa")).toBeInTheDocument();
      expect(screen.getByText(/Ver Guia de Implantação/i)).toBeInTheDocument();
    });
  });

  describe("3. Tela Dedicada VexoOnboardingSetup (/crm/implantacao)", () => {
    it("Exibe os 3 grandes cards com os respectivos estados e CTAs", () => {
      mockSelectedClient = {
        id: "empresa-1",
        name: "Empresa Teste",
        n8n_settings: {
          chatbot_enabled: false,
          chatbot_model: "openai/gpt-4o",
          evolution_instances: [{ id: "chip-1", name: "WhatsApp Vendas", active: true, chip_state: "warm" }],
        } as any,
      };
      mockFacetsBaseTotal = 0;

      renderWithProviders(<VexoOnboardingSetup baseTotal={0} />);

      // Título e progresso no Hero
      expect(screen.getAllByText("Implantação Vexo OS").length).toBeGreaterThan(0);
      expect(screen.getByText(/Passos para Colocar sua Operação no Ar/i)).toBeInTheDocument();
      expect(screen.getByText("33%")).toBeInTheDocument();

      // Card 1: WhatsApp Conectado (pronto)
      expect(screen.getByText("WhatsApp Conectado")).toBeInTheDocument();
      expect(screen.getByText("Passo 1")).toBeInTheDocument();
      expect(screen.getByText("Conectado")).toBeInTheDocument();
      expect(screen.getByText(/WhatsApp Vendas/)).toBeInTheDocument();
      expect(screen.getByText("Gerenciar Chips & Instâncias")).toBeInTheDocument();

      // Card 2: Agente de IA Comercial (pendente)
      expect(screen.getByText("Agente de IA Comercial")).toBeInTheDocument();
      expect(screen.getByText("Passo 2")).toBeInTheDocument();
      expect(screen.getAllByText("Desligado").length).toBeGreaterThan(0);
      expect(screen.getByText("Ajustar Tom de Voz / Configurar")).toBeInTheDocument();

      // Card 3: Base de Leads & Disparos (pendente)
      expect(screen.getByText("Base de Leads & Disparos")).toBeInTheDocument();
      expect(screen.getByText("Passo 3")).toBeInTheDocument();
      expect(screen.getByText("Base Vazia")).toBeInTheDocument();
      expect(screen.getByText("Subir Planilha / Importar")).toBeInTheDocument();
    });

    it("Exibe painel comemorativo quando isFullyReady === true com atalhos rápidos", () => {
      mockSelectedClient = {
        id: "empresa-1",
        name: "Empresa Teste",
        n8n_settings: {
          chatbot_enabled: true,
          chatbot_model: "openai/gpt-4o",
          evolution_instances: [{ id: "chip-1", name: "WhatsApp Vendas", active: true, chip_state: "warm" }],
        } as any,
      };
      mockFacetsBaseTotal = 1250;

      renderWithProviders(<VexoOnboardingSetup baseTotal={1250} />);

      // Hero 100%
      expect(screen.getByText("100%")).toBeInTheDocument();
      expect(screen.getByText("Operação 100% Configurada e Ativa")).toBeInTheDocument();

      // Painel comemorativo
      expect(screen.getByText("🎉 Sua Operação Vexo OS está 100% Pronta!")).toBeInTheDocument();

      // Atalhos rápidos
      expect(screen.getByText("Disparar Primeira Campanha")).toBeInTheDocument();
      expect(screen.getByText("Acompanhar no WhatsApp")).toBeInTheDocument();
      expect(screen.getByText("Ver Central de Comando")).toBeInTheDocument();
    });
  });

  describe("4. Hook useOnboardingProgress", () => {
    it("Calcula progresso reativo baseado no client e opções", () => {
      const clientMock: any = {
        id: "tenant-hook",
        n8n_settings: {
          chatbot_enabled: true,
          evolution_instances: [{ name: "Chip 1", active: true }],
        },
      };

      const queryClient = new QueryClient();
      const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );

      const { result } = renderHook(
        () => useOnboardingProgress("tenant-hook", { client: clientMock, baseTotal: 250 }),
        { wrapper }
      );

      expect(result.current.completedCount).toBe(3);
      expect(result.current.percent).toBe(100);
      expect(result.current.isFullyReady).toBe(true);
      expect(result.current.steps.every((s) => s.done)).toBe(true);
    });
  });

  describe("5. Rotas e Sidebar (AJUDA_ITEMS)", () => {
    it("AJUDA_ITEMS contém Implantação (Setup) apontando para /crm/implantacao e mantém Treinamento", async () => {
      const { AJUDA_ITEMS } = await import("@/lib/appSidebar/constants");
      const implantacaoItem = AJUDA_ITEMS.find((item) => item.key === "implantacao");
      const onboardingItem = AJUDA_ITEMS.find((item) => item.key === "onboarding");

      expect(implantacaoItem).toBeDefined();
      expect(implantacaoItem?.url).toBe("/crm/implantacao");
      expect(implantacaoItem?.label).toBe("Implantação (Setup)");
      expect(implantacaoItem?.page).toBe("onboarding-wizard");

      expect(onboardingItem).toBeDefined();
      expect(onboardingItem?.url).toBe("/crm/onboarding");
      expect(onboardingItem?.label).toBe("Treinamento Vexo");
      expect(onboardingItem?.page).toBe("onboarding-wizard");
    });

    it("isPathAllowedForClient libera /crm/implantacao e /crm/setup para abas com permissão de onboarding", async () => {
      const { isPathAllowedForClient } = await import("@/lib/access");

      expect(isPathAllowedForClient("/crm/implantacao", ["onboarding"])).toBe(true);
      expect(isPathAllowedForClient("/crm/setup", ["onboarding"])).toBe(true);
      expect(isPathAllowedForClient("/crm/implantacao", ["dashboard"])).toBe(false);
    });
  });
});
