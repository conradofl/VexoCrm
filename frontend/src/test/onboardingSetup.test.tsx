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
let mockIsAdminUser = true;
let mockCanAccessInternalPage = vi.fn().mockImplementation((_page: string) => true);

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isAdminUser: mockIsAdminUser,
    canAccessInternalPage: (page: string) => mockCanAccessInternalPage(page),
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
  fetchApi: vi.fn().mockImplementation(async (url: string) => {
    if (typeof url === "string" && url.includes("implementation-briefings")) {
      return {
        ok: true,
        json: async () => [
          {
            id: "briefing-1",
            empresa_nome: "Cliente Alfa",
            ramo_atuacao: "Varejo",
            status: "concluido",
            created_at: "2026-10-01T12:00:00Z",
            updated_at: "2026-10-01T12:00:00Z",
          },
        ],
      };
    }
    return {
      ok: true,
      json: async () => ({ baseTotal: mockFacetsBaseTotal }),
    };
  }),
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
    mockIsAdminUser = true;
    mockCanAccessInternalPage = vi.fn().mockImplementation(() => true);
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
    it("Aplica classes de alto contraste e fundo neutro para modo claro e modo escuro", () => {
      mockSelectedClient = {
        id: "empresa-1",
        name: "Empresa Teste",
        n8n_settings: {
          chatbot_enabled: false,
          evolution_instances: [{ name: "Chip 1", active: true }],
        } as any,
      };

      const { container } = renderWithProviders(
        <OnboardingProgressCard clientId="empresa-1" baseTotal={0} />
      );

      // Container principal com gradiente suave no modo claro
      const mainCard = container.querySelector(".rounded-xl.border");
      expect(mainCard?.className).toContain("from-white");
      expect(mainCard?.className).toContain("via-slate-50");
      expect(mainCard?.className).toContain("border-slate-200/80");

      // Badge de pronto com alto contraste no modo claro
      const prontoBadge = screen.getByText("Pronto").closest("span");
      expect(prontoBadge?.className).toContain("text-emerald-700");
      expect(prontoBadge?.className).toContain("bg-emerald-100/80");

      // Badge de pendente com alto contraste no modo claro
      const pendenteBadges = screen.getAllByText("Pendente");
      expect(pendenteBadges[0].className).toContain("text-amber-800");
      expect(pendenteBadges[0].className).toContain("bg-amber-100/80");
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

    it("Renderiza Aba 1 (🌟 Mapa de Superpoderes) com os 8 cards didáticos, explicações e atalhos", () => {
      mockSelectedClient = {
        id: "empresa-1",
        name: "Empresa Teste",
        n8n_settings: {
          chatbot_enabled: false,
          evolution_instances: [],
        } as any,
      };

      renderWithProviders(<VexoOnboardingSetup baseTotal={0} defaultTab="mapa" />);

      // Abas presentes no topo
      expect(screen.getByRole("tab", { name: /Mapa de Superpoderes/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Esteira Técnica/i })).toBeInTheDocument();

      // 8 Superpoderes
      expect(screen.getByText("Agente de Atendimento 24/7")).toBeInTheDocument();
      expect(screen.getByText("Agente Extrator de Ficha")).toBeInTheDocument();
      expect(screen.getByText("Agente de Disparo em Massa")).toBeInTheDocument();
      expect(screen.getByText("Campanhas Recorrentes")).toBeInTheDocument();
      expect(screen.getByText("Vexo Smart Links (Cliques)")).toBeInTheDocument();
      expect(screen.getByText("Aviso de Lead Parado (SLA)")).toBeInTheDocument();
      expect(screen.getByText("Reativação Automática")).toBeInTheDocument();
      expect(screen.getByText("Vexo Academy")).toBeInTheDocument();

      // Caixa didática "Por que usar:" em múltiplos cards
      expect(screen.getAllByText(/💡 Por que usar:/i).length).toBe(8);

      // Atalhos dos superpoderes
      const links = screen.getAllByRole("link");
      expect(links.some((l) => l.getAttribute("href") === "/crm/agente")).toBe(true);
      expect(links.some((l) => l.getAttribute("href") === "/crm/banco-de-dados")).toBe(true);
      expect(links.some((l) => l.getAttribute("href") === "/crm/planilhas")).toBe(true);
      expect(links.some((l) => l.getAttribute("href") === "/crm/planilhas?tab=campanhas")).toBe(true);
      expect(links.some((l) => l.getAttribute("href") === "/crm/banco-de-dados?stalled=3")).toBe(true);
      expect(links.some((l) => l.getAttribute("href") === "/crm/followup")).toBe(true);
      expect(links.some((l) => l.getAttribute("href") === "/crm/onboarding")).toBe(true);
    });

    it("Renderiza Aba 2 (🛠️ Esteira Prática de Implantação) com 3 etapas didáticas e simulador", () => {
      mockSelectedClient = {
        id: "empresa-1",
        name: "Empresa Teste",
        n8n_settings: {
          chatbot_enabled: true,
          evolution_instances: [{ name: "Chip Principal", active: true }],
        } as any,
      };

      renderWithProviders(<VexoOnboardingSetup baseTotal={0} defaultTab="esteira" />);

      // Passo 1: Identidade da Empresa & Horários
      expect(screen.getByText("Identidade da Empresa & Horários")).toBeInTheDocument();
      expect(
        screen.getByText(
          /Para o robô saber a hora certa de transferir para sua equipe ou avisar que o escritório está fechado/i
        )
      ).toBeInTheDocument();

      // Passo 2: O Cérebro do Agente (5 Pilares Simplificados)
      expect(
        screen.getByText("O Cérebro do Agente (5 Pilares Simplificados)")
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /Para blindar as respostas da IA contra promessas falsas e garantir precisão cirúrgica/i
        )
      ).toBeInTheDocument();
      expect(
        screen.getByText("5. Blindagem: O que a IA NUNCA pode prometer")
      ).toBeInTheDocument();
      expect(
        screen.getByText("Documentos & PDFs para Conhecimento do Robô (RAG)")
      ).toBeInTheDocument();

      // Passo 3: Conectar WhatsApp & Testar no Simulador ao Vivo
      expect(
        screen.getByText("Conectar WhatsApp & Testar no Simulador ao Vivo")
      ).toBeInTheDocument();
      expect(screen.getByText("Simulador Interativo ao Vivo")).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Digite uma mensagem de teste/i)).toBeInTheDocument();
    });

    it("Permite interagir com perguntas rápidas no Simulador ao Vivo", async () => {
      mockSelectedClient = {
        id: "empresa-1",
        name: "Empresa Teste",
        n8n_settings: {
          chatbot_enabled: true,
          evolution_instances: [{ name: "Chip Principal", active: true }],
        } as any,
      };

      renderWithProviders(<VexoOnboardingSetup baseTotal={0} defaultTab="esteira" />);

      // Clica em um teste rápido
      const quickButton = screen.getByText("💰 Qual o valor do serviço?");
      fireEvent.click(quickButton);

      // Mensagem do usuário deve ser exibida na tela
      expect(screen.getByText("Qual é o valor do serviço?")).toBeInTheDocument();

      // Aguarda resposta da IA simulada
      await waitFor(() => {
        expect(screen.getByText(/Nossos serviços e produtos têm investimento/i)).toBeInTheDocument();
      }, { timeout: 1500 });
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

  describe("6. Proteção e Gating de Permissões Técnicas (Esteira & Implantações Salvas)", () => {
    it("Usuário sem permissão técnica vê apenas o Mapa de Superpoderes e não vê abas técnicas", () => {
      mockIsAdminUser = false;
      mockCanAccessInternalPage = vi.fn().mockReturnValue(false);

      renderWithProviders(<VexoOnboardingSetup baseTotal={0} defaultTab="esteira" />);

      // Não exibe os seletores de abas nem títulos de abas técnicas
      expect(screen.queryByRole("tab", { name: /Esteira Técnica/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: /Implantações Salvas/i })).not.toBeInTheDocument();

      // Conteúdo do Mapa de Superpoderes deve estar visível
      expect(screen.getByText("🌟 Mapa de Superpoderes do Vexo OS")).toBeInTheDocument();
    });

    it("Usuário com permissão técnica (onboarding-agent) vê as 3 abas e pode navegar até Implantações Salvas", async () => {
      mockIsAdminUser = false;
      mockCanAccessInternalPage = vi.fn().mockImplementation((page: string) => page === "onboarding-agent");

      renderWithProviders(<VexoOnboardingSetup baseTotal={0} defaultTab="salvas" />);

      // As 3 abas devem estar presentes no TabsList
      expect(screen.getByRole("tab", { name: /Mapa de Superpoderes/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Esteira Técnica/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Implantações Salvas/i })).toBeInTheDocument();

      // Como defaultTab="salvas", o conteúdo da aba de Implantações Salvas deve ser renderizado
      expect(screen.getByPlaceholderText(/Buscar por nome da empresa/i)).toBeInTheDocument();
    });
  });
});
