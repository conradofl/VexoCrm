// frontend/src/test/leadImportsLocalStorageTabs.test.tsx
//
// Regra 2.3: Usuários com 'planilhas', 'salvas' ou 'planilhas-salvas' no localStorage
// (chave vexo_activeTab_${clientId}) abrem obrigatoriamente na aba 'campanha',
// com a interface renderizada (wizard / público & disparo), evitando tela em branco.

import React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LeadImports, { normalizeSheetTab } from "@/pages/LeadImports";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    clientId: "cliente-teste",
    isInternalUser: true,
    isAuthenticated: true,
    isAdminUser: true,
    canAccessInternalPage: () => true,
    approvalLevel: "admin",
    getIdToken: async () => "mock-token",
  }),
}));

const mockClient = {
  id: "cliente-teste",
  name: "Cliente Teste",
  plan_tier: "avancado",
  modulos_avulsos: ["disparador_campanhas"],
};

vi.mock("@/hooks/useCrmClient", () => ({
  useCrmClient: () => ({
    selectedClientId: "cliente-teste",
    selectedClient: mockClient,
    clients: [mockClient],
  }),
  useOptionalCrmClient: () => ({
    selectedClientId: "cliente-teste",
    selectedClient: mockClient,
    clients: [mockClient],
  }),
}));

vi.mock("@/hooks/useLeadImports", () => ({
  ALL_IMPORTS_VALUE: "__all__",
  CRM_BASE_VALUE: "__crm__",
  useCreateLeadImport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLeadImports: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useLeadImportItems: () => ({ data: { items: [], total: 0 }, isLoading: false }),
  useLeadCustomFields: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/hooks/useCampanhas", () => ({
  saveCampaignWithSelfHeal: vi.fn(),
  useCampanhas: () => ({ data: [], isLoading: false }),
  useCampaignAiStatus: () => ({ data: null, isLoading: false }),
  useCreateCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGenerateCampaignTemplateVariants: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCampaignDispatches: () => ({ data: [], isLoading: false }),
  useCreateDispatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteDispatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useTriggerDispatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateDispatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAllDispatches: () => ({ data: [], isLoading: false }),
  useDispatchRecipients: () => ({ data: { items: [], summary: {} }, isLoading: false, refetch: vi.fn() }),
  useRetryFailedDispatchLeads: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRunPendingDispatchLeads: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useConsultantSchedules", () => ({
  useConsultantSchedules: () => ({ data: [], isLoading: false }),
  useCreateConsultantSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateConsultantSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteConsultantSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useCampaignPrompts", () => ({
  useCampaignPrompts: () => ({ data: [], isLoading: false }),
  useSaveCampaignPrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteCampaignPrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDispatchPrompt: () => ({ data: null, isLoading: false }),
  useSaveDispatchPrompt: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

function renderLeadImports() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LeadImports fixedClientId="cliente-teste" />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Regra 2.3 — Normalização de Abas Residuais do localStorage e Prevenção de Tela em Branco", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("função pura normalizeSheetTab mapeia abas legadas/removidas estritamente para 'campanha'", () => {
    expect(normalizeSheetTab("planilhas")).toBe("campanha");
    expect(normalizeSheetTab("salvas")).toBe("campanha");
    expect(normalizeSheetTab("planilhas-salvas")).toBe("campanha");
    expect(normalizeSheetTab("PLANILHAS")).toBe("campanha");
    expect(normalizeSheetTab("  salvas  ")).toBe("campanha");
    expect(normalizeSheetTab(null)).toBe("campanha");
    expect(normalizeSheetTab(undefined)).toBe("campanha");
    expect(normalizeSheetTab("valor-invalido-qualquer")).toBe("campanha");

    // Preserva abas válidas
    expect(normalizeSheetTab("campanha")).toBe("campanha");
    expect(normalizeSheetTab("enviadas")).toBe("enviadas");
    expect(normalizeSheetTab("agendamentos")).toBe("agendamentos");
    expect(normalizeSheetTab("relatorios")).toBe("relatorios");
  });

  const legacyTabs = ["planilhas", "salvas", "planilhas-salvas"];

  for (const tab of legacyTabs) {
    it(`localStorage gravado com "${tab}" abre a tela em "campanha", renderizada e sem tela em branco`, () => {
      // Simula o estado gravado antes da leva
      window.localStorage.setItem("vexo_activeTab_cliente-teste", JSON.stringify(tab));

      renderLeadImports();

      // 1. O botão da aba "Novo Disparo" está presente e ativo
      const novoDisparoBtn = screen.getByRole("button", { name: /Novo Disparo/i });
      expect(novoDisparoBtn).toBeInTheDocument();
      expect(novoDisparoBtn.className).toContain("bg-white text-slate-900 shadow");

      // 2. O conteúdo da campanha é renderizado (não há tela em branco)
      expect(screen.getByText("Base de Leads")).toBeInTheDocument();
      expect(screen.getByText(/Selecione uma base salva ou use o público segmentado do Banco de Dados/i)).toBeInTheDocument();
      expect(screen.getByText(/Nome da Campanha \/ Disparo/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/Ex: Oferta Black Friday/i)).toBeInTheDocument();

      // 3. O link curto para o Banco de Dados está presente
      const linkBanco = screen.getByTestId("link-importar-banco");
      expect(linkBanco).toBeInTheDocument();
      expect(linkBanco.textContent).toContain("Importar planilha no Banco de Dados");
    });
  }
});
