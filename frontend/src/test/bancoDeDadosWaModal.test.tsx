import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import BancoDeDados from "@/pages/BancoDeDados";

let currentPlanTier = "essencial";

const mockTenant = {
  id: "tenant-essencial",
  name: "Tenant Teste",
  get plan_tier() {
    return currentPlanTier;
  },
  ticket_medio: 1000,
  modulos_avulsos: ["banco-de-dados"],
  n8n_settings: {
    chatbot_enabled: true,
    evolution_instances: [
      { name: "Chip 1", active: true, id: "inst-1" },
      { name: "Chip 2", active: true, id: "inst-2" },
    ],
  },
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    clientId: "tenant-essencial",
    isInternalUser: true,
    isAuthenticated: true,
    isAdminUser: true,
    canAccessInternalPage: () => true,
    canAccessView: () => true,
    getIdToken: async () => "mock-token",
  }),
}));

const mockCrmClient = {
  selectedClientId: "tenant-essencial",
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
  useSdrRotationNext: () => ({ data: { next: null }, isLoading: false }),
}));

vi.mock("@/hooks/useAdminUsers", () => ({
  useAdminUsers: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/useContactsWithoutChannel", () => ({
  useContactsWithoutChannel: () => ({ count: 0, isLoading: false }),
  useImportInstagram: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "dark" }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter>
          <BancoDeDados />
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

// "Extrair" é um menu com as três formas de trazer contato de fora; aqui abrimos a do WhatsApp
async function openExtractOption(testId: string) {
  fireEvent.keyDown(await screen.findByTestId("btn-extract-menu"), { key: "Enter" });
  fireEvent.click(await screen.findByTestId(testId));
}

describe("BancoDeDados WhatsApp Modal (Limite e Paywall)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    currentPlanTier = "essencial";
    fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/api/leads/summary")) {
        return {
          ok: true,
          json: async () => ({
            totalLeads: 0,
            buyersCount: 0,
            lostCount: 0,
            neverContactedCount: 0,
            inConversationCount: 0,
            inNegotiationCount: 0,
            activeLeadsCount: 0,
          }),
        };
      }
      if (String(url).includes("/api/leads?")) {
        return {
          ok: true,
          json: async () => ({ leads: [], totalCount: 0 }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    global.fetch = fetchMock as any;
  });

  it("[TESTE OBRIGATÓRIO] o seletor de limite não existe mais no modal", async () => {
    renderPage();

    // Abre o modal de mineração WA
    await openExtractOption("extract-whatsapp");

    // Modal está aberto
    await screen.findByText("Mineração Semântica via WhatsApp");

    // O seletor de botões de limite (50, 100, 500, Ilimitado) NÃO deve existir
    expect(screen.queryByText("Limite de Conversas para Analisar")).toBeNull();
    expect(screen.queryByRole("button", { name: /^50 chats$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^100 chats$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^500 chats$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Ilimitado$/i })).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] plano sem ilimitado continua limitado — trava visível na tela com aviso", async () => {
    currentPlanTier = "essencial";
    renderPage();

    await openExtractOption("extract-whatsapp");

    // Texto explícito informando o limite do plano essencial
    const notice = await screen.findByTestId("wa-plan-limit-notice");
    expect(notice).toBeTruthy();
    expect(notice.textContent).toContain("No Plano Essencial, a extração analisa até 500 conversas recentes (ilimitado no Plano Avançado)");
  });

  it("[TESTE OBRIGATÓRIO] plano avançado não exibe trava de 500 conversas", async () => {
    currentPlanTier = "avancado";
    renderPage();

    await openExtractOption("extract-whatsapp");

    await screen.findByText("Mineração Semântica via WhatsApp");
    // Trava do essencial NÃO aparece para plano avançado
    expect(screen.queryByTestId("wa-plan-limit-notice")).toBeNull();
  });
});
