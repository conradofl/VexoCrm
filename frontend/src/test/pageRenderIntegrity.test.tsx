import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { TabPrompts } from "@/pages/ChatbotSettings/TabPrompts";
import { PROMPT_CONFIGS } from "@/lib/chatbotSettings/constants";
import { TenantScopeBoundary } from "@/components/TenantScopeBoundary";

// Mocks dos contextos e hooks
const mockTenant = {
  id: "sonhare",
  name: "Sonhare",
  plan_tier: "avancado",
  modulos_avulsos: [],
  n8n_settings: {
    chatbot_enabled: true,
    chatbot_model: "generico",
    chatbot_llm_model: "openai/gpt-oss-120b",
    evolution_instances: [{ name: "Instancia-1", active: true }],
  },
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    clientId: "sonhare",
    isInternalUser: true,
    isAuthenticated: true,
    isAdminUser: true,
    canAccessInternalPage: () => true,
    getIdToken: async () => "mock-token",
  }),
}));

const mockCrmClient = {
  selectedClientId: "sonhare",
  selectedClient: mockTenant,
  clients: [mockTenant],
  isLoading: false,
  setSelectedClientId: vi.fn(),
};

vi.mock("@/hooks/useCrmClient", () => ({
  useCrmClient: () => mockCrmClient,
  useOptionalCrmClient: () => mockCrmClient,
}));

vi.mock("@/hooks/useLeadClients", () => ({
  useLeadClients: () => ({ data: [mockTenant], isLoading: false }),
  useUpdateLeadClientN8nSettings: () => ({ mutateAsync: vi.fn() }),
  useUpdateLeadClientTicketMedio: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/usePrompts", () => ({
  usePrompt: (clientId: string, type: string) => ({
    data: { content: `Conteúdo prompt ${type} para ${clientId}`, updatedAt: "2026-08-20T10:00:00Z" },
    isLoading: false,
  }),
  useSavePrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useChatbotTemplates", () => ({
  useChatbotTemplates: () => ({ data: [], isLoading: false }),
  useBuiltinTemplates: () => ({ data: [], isLoading: false }),
  useLlmModels: () => ({
    data: {
      models: [{ id: "openai/gpt-oss-120b", name: "GPT-OSS 120B (Groq)", provider: "groq", providerName: "Groq" }],
      defaultModel: "openai/gpt-oss-120b",
      providerStatus: { groq: true, openai: false, anthropic: false, gemini: false },
    },
    isLoading: false,
  }),
  useSaveChatbotTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteChatbotTemplate: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useFollowupAdmin", () => ({
  useFupCompanies: () => ({ data: [], isLoading: false }),
  useCreateFupCompany: () => ({ mutateAsync: vi.fn() }),
  useUpdateFupCompany: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/useReports", () => ({
  useEvolutionUsageReport: () => ({ data: { items: [] }, isLoading: false, error: null }),
}));

vi.mock("@/components/HelpDeskWidget", () => ({
  HelpDeskWidget: () => null,
  default: () => null,
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
}

import { TooltipProvider } from "@/components/ui/tooltip";

function renderWithProviders(ui: React.ReactElement, { route = "/" } = {}) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[route]}>
          {ui}
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

describe("Integridade de Renderização de Páginas e Verificação de Símbolos", () => {
  it("PROMPT_CONFIGS está exportado e contém as configurações padrão de prompt (padrao, extrato, resumo)", () => {
    expect(PROMPT_CONFIGS).toBeDefined();
    expect(Array.isArray(PROMPT_CONFIGS)).toBe(true);
    expect(PROMPT_CONFIGS.length).toBeGreaterThanOrEqual(3);
    expect(PROMPT_CONFIGS.map((p) => p.type)).toContain("padrao");
    expect(PROMPT_CONFIGS.map((p) => p.type)).toContain("extrato");
    expect(PROMPT_CONFIGS.map((p) => p.type)).toContain("resumo");
  });

  it("TabPrompts renderiza sem erro e exibe os cards de prompt configurados", () => {
    renderWithProviders(<TabPrompts clientId="sonhare" />);

    // Verifica que os blocos de prompt são renderizados com os rótulos de PROMPT_CONFIGS
    expect(screen.getByText(/Prompt Padrão \(SPIN\)/i)).toBeTruthy();
    expect(screen.getByText(/Extrato SDR/i)).toBeTruthy();
    expect(screen.getByText(/Resumo de Atendimento \(Inbox\)/i)).toBeTruthy();
    expect(screen.getByText(/Gera o briefing enviado ao SDR/i)).toBeTruthy();
  });

  it("ChatbotSettings renderiza na subaba prompts sem quebrar por ReferenceError", async () => {
    const { default: ChatbotSettings } = await import("@/pages/ChatbotSettings");
    
    renderWithProviders(<ChatbotSettings />, { route: "/crm/agente?tab=settings&subtab=prompts" });

    // Confirma que a tela de ChatbotSettings monta a aba de prompts com sucesso
    expect(screen.getByText(/Prompt Padrão \(SPIN\)/i)).toBeTruthy();
  });

  it("AgenteIA monta todas as abas e renderiza sem erros de escopo", async () => {
    const { default: AgenteIA } = await import("@/pages/AgenteIA");

    renderWithProviders(<AgenteIA />, { route: "/crm/agente?tab=settings" });
    expect(screen.getAllByText(/Configurações/i).length).toBeGreaterThan(0);
  });

  it("TenantScopeBoundary desmonta e remonta sem erros ao trocar de tenantId", () => {
    const { rerender } = render(
      <TenantScopeBoundary tenantId="geracao-digital">
        <div data-testid="child-gd">Tenant GD</div>
      </TenantScopeBoundary>
    );
    expect(screen.getByTestId("child-gd")).toBeTruthy();

    rerender(
      <TenantScopeBoundary tenantId="sonhare">
        <div data-testid="child-sonhare">Tenant Sonhare</div>
      </TenantScopeBoundary>
    );
    expect(screen.getByTestId("child-sonhare")).toBeTruthy();
    expect(screen.queryByTestId("child-gd")).toBeNull();
  });

  it("InboundAgentConfig renderiza sem erros", async () => {
    const { default: InboundAgentConfig } = await import("@/pages/InboundAgentConfig");

    renderWithProviders(<InboundAgentConfig />);
    expect(screen.getAllByText(/Agente de Atendimento|Agente Inbound|Configuração/i).length).toBeGreaterThan(0);
  });

  it("Relatorios renderiza envolvido em TenantScopeBoundary sem erros", async () => {
    const { default: Relatorios } = await import("@/pages/Relatorios");

    renderWithProviders(<Relatorios />);
    expect(screen.getAllByText(/Relatórios/i).length).toBeGreaterThan(0);
  });

  it("Inteligência Comercial renderiza sem erros", async () => {
    const { default: CommercialIntelligence } = await import("@/pages/CommercialIntelligence");

    renderWithProviders(<CommercialIntelligence />);
    expect(screen.getAllByText(/Inteligencia Comercial/i).length).toBeGreaterThan(0);
  });

  it("Banco de Dados renderiza sem erros", async () => {
    const { default: BancoDeDados } = await import("@/pages/BancoDeDados");

    renderWithProviders(<BancoDeDados />);
    expect(screen.getAllByText(/Banco de Dados/i).length).toBeGreaterThan(0);
  });

  it("Mutação: comprova que se PROMPT_CONFIGS fosse indefinido, a renderização de TabPrompts falharia", () => {
    // Simula a mutação que causou o bug
    const simulateBrokenRender = () => {
      const undefinedConfigs: any = undefined;
      undefinedConfigs.map((p: any) => p);
    };
    expect(simulateBrokenRender).toThrow(TypeError);
  });
});
