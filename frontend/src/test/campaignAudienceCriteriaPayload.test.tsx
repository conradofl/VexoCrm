// frontend/src/test/campaignAudienceCriteriaPayload.test.tsx
//
// BLOCO 1 — Gravar critério do público na campanha (Frontend)
// Prova que LeadImports inclui analyticsMeta.audienceCriteria no campaignPayload
// enviado para saveCampaignWithSelfHeal quando o público veio do Banco.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import LeadImports from "@/pages/LeadImports";
import { saveCampaignWithSelfHeal } from "@/hooks/useCampanhas";

const mockFetchApi = vi.fn();
vi.mock("@/lib/api", () => ({
  fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

const mockToast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  toast: (...args: any[]) => mockToast(...args),
  useToast: () => ({ toast: mockToast }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    clientId: "cliente-teste",
    isInternalUser: true,
    isAuthenticated: true,
    isAdminUser: true,
    canAccessInternalPage: () => true,
    approvalLevel: "admin",
    getIdToken: async () => "mock-token",
    user: { uid: "user-1", email: "admin@vexo.com" },
    userProfile: { role: "admin" },
  }),
}));

const mockClient = { id: "cliente-teste", name: "Cliente Teste", created_at: "" };
vi.mock("@/hooks/useClients", () => ({
  useClients: () => ({ data: [mockClient], isLoading: false }),
  useOptionalCrmClient: () => ({
    selectedClientId: "cliente-teste",
    selectedClient: mockClient,
    clients: [mockClient],
  }),
}));

vi.mock("@/hooks/useLeadImports", () => ({
  ALL_IMPORTS_VALUE: "__all__",
  CRM_BASE_VALUE: "__crm__",
  useCreateLeadImport: () => ({
    mutateAsync: vi.fn().mockResolvedValue({ item: { id: "import-banco-1" } }),
    isPending: false,
  }),
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
  useCampaignRecipients: () => ({ data: null, isLoading: false }),
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
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LeadImports fixedClientId="cliente-teste" />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("BLOCO 1 — Gravação de audienceCriteria no frontend", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ao salvar campanha montada a partir do Banco, campaignPayload.analyticsMeta.audienceCriteria contém as 2 tags e 1 estágio", async () => {
    mockFetchApi.mockImplementation(async (path: string) => {
      if (path === "/api/leads/audience") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: "lead-1", nome: "Lead VIP", phone: "551199990001" },
              { id: "lead-2", nome: "Lead Proposta", phone: "551199990002" },
            ],
            total: 2,
            truncated: false,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const handoffPayload = {
      criteria: {
        clientId: "cliente-teste",
        stages: ["cold"],
        tags: ["VIP", "Proposta"],
        rules: [],
      },
      totalCount: 2,
      campaignName: "Campanha VIP e Proposta",
      description: 'público: estágio Leads Frios, tags "VIP", "Proposta", 2 leads',
    };
    window.localStorage.setItem("vexo_pending_campaign_audience", JSON.stringify(handoffPayload));

    const mockSavedCampaign = { id: "camp-nova-1", name: "Campanha VIP e Proposta" };
    vi.mocked(saveCampaignWithSelfHeal).mockResolvedValue(mockSavedCampaign as any);

    renderLeadImports();

    // Aguarda carregar o público
    await waitFor(() => {
      expect(screen.getByText(/Público do Banco de Dados Ativo/i)).toBeInTheDocument();
      expect(screen.getByText(/2 leads/i)).toBeInTheDocument();
    });

    // Preenche o texto da mensagem no passo 1
    const textarea = screen.getByPlaceholderText(/Olá \{\{nome\}\}, tudo bem\? Escreva a mensagem de envio\.\.\./i);
    fireEvent.change(textarea, { target: { value: "Olá {{nome}}, temos uma proposta especial!" } });

    // Clica no botão de salvar/disparar
    const salvarBtn = screen.getByRole("button", { name: /Salvar e Disparar Lote Agora/i });
    fireEvent.click(salvarBtn);

    await waitFor(() => {
      expect(saveCampaignWithSelfHeal).toHaveBeenCalled();
    });

    const callArgs = vi.mocked(saveCampaignWithSelfHeal).mock.calls[0][0];
    const payload = callArgs.payload;

    expect(payload.analyticsMeta).toBeDefined();
    expect(payload.analyticsMeta.audienceCriteria).toBeDefined();
    expect(payload.analyticsMeta.audienceCriteria.tags).toEqual(["VIP", "Proposta"]);
    expect(payload.analyticsMeta.audienceCriteria.stages).toEqual(["cold"]);
    expect(payload.analyticsMeta.audienceCriteria.totalCount).toBe(2);
    expect(payload.analyticsMeta.audienceCriteria.description).toContain("VIP");
    expect(payload.analyticsMeta.audienceCriteria.savedAt).toBeDefined();
  });
});
