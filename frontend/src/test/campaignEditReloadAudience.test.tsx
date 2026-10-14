// frontend/src/test/campaignEditReloadAudience.test.tsx
//
// BLOCO 2 — Editar recarrega o público
// Testes:
// (a) campanha com audienceCriteria recarrega o público e as tags
// (b) campanha antiga sem o campo mostra o aviso e não quebra
// (c) divergência de contagem aparece na tela e no toast mostrando os dois números

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import LeadImports from "@/pages/LeadImports";
import type { Campaign } from "@/hooks/useCampanhas";

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
  useCreateLeadImport: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLeadImports: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useLeadImportItems: () => ({ data: { items: [], total: 0 }, isLoading: false }),
  useLeadCustomFields: () => ({ data: [], isLoading: false }),
}));

let mockCampaignsList: Campaign[] = [];

vi.mock("@/hooks/useCampanhas", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    saveCampaignWithSelfHeal: vi.fn(),
    useCampanhas: () => ({ data: mockCampaignsList, isLoading: false, refetch: vi.fn() }),
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
  };
});

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

function renderLeadImports(initialTab = "enviadas") {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/crm/disparador?tab=${initialTab}`]}>
        <LeadImports fixedClientId="cliente-teste" />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("BLOCO 2 — Editar recarrega o público", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mockCampaignsList = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("(a) campanha com audienceCriteria recarrega o público e as tags", async () => {
    const audienceRequests: any[] = [];
    mockFetchApi.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/leads/audience") {
        const body = JSON.parse(String(init?.body || "{}"));
        audienceRequests.push(body);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: "lead-1", nome: "Lead Tag VIP", phone: "551199990001", stage: "cold", tags: ["VIP"] },
              { id: "lead-2", nome: "Lead Tag Proposta", phone: "551199990002", stage: "cold", tags: ["Proposta"] },
            ],
            total: 2,
            truncated: false,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const campaignWithCriteria: Campaign = {
      id: "camp-com-criterio-1",
      client_id: "cliente-teste",
      client_name: "Cliente Teste",
      name: "Campanha VIP com Tags",
      status: "active",
      mode: "disparo",
      limit_per_run: 50,
      import_id: null,
      webhook_url: "",
      webhook_token: null,
      scheduled_for: null,
      last_triggered_at: null,
      archived_at: null,
      created_by_uid: "user-1",
      created_by_email: "admin@vexo.com",
      created_at: new Date().toISOString(),
      starts_at: null,
      ends_at: null,
      chatbot_prompt_type: "campanha",
      campaign_prompt_id: null,
      analytics_meta: {
        sequence: [{ id: "s1", type: "text", text: "Mensagem VIP", order: 1, enabled: true, delayAfterSeconds: 0, image: null }],
        audienceCriteria: {
          clientId: "cliente-teste",
          stages: ["cold"],
          tags: ["VIP", "Proposta"],
          rules: [],
          description: 'público: estágio Leads Frios, tags "VIP", "Proposta", 2 leads',
          totalCount: 2,
          savedAt: "2026-10-13T20:00:00.000Z",
        },
      },
    };

    mockCampaignsList = [campaignWithCriteria];

    renderLeadImports("enviadas");

    // Expande o cartão da campanha na lista
    const expandBtn = await screen.findByRole("button", { name: /Ver detalhes de Campanha VIP com Tags/i });
    fireEvent.click(expandBtn);

    // Clica no botão "Editar"
    const editBtn = await screen.findByRole("button", { name: /^Editar$/i });
    fireEvent.click(editBtn);

    // Verifica que a requisição de público foi disparada com as tags e estágio gravados
    await waitFor(() => {
      expect(audienceRequests).toHaveLength(1);
    });
    expect(audienceRequests[0].stages).toEqual(["cold"]);
    expect(audienceRequests[0].tags).toEqual(["VIP", "Proposta"]);

    // Verifica que a tela mudou para o formulário e exibiu o banner de público ativo
    await waitFor(() => {
      expect(screen.getByText(/Público do Banco de Dados Ativo/i)).toBeInTheDocument();
      expect(screen.getByText(/2 leads/i)).toBeInTheDocument();
    });
  });

  it("(b) campanha antiga sem o campo mostra o aviso e não quebra", async () => {
    const legacyCampaign: Campaign = {
      id: "camp-legada-1",
      client_id: "cliente-teste",
      client_name: "Cliente Teste",
      name: "Campanha Criada Antes do Registro",
      status: "active",
      mode: "disparo",
      limit_per_run: 50,
      import_id: null,
      webhook_url: "",
      webhook_token: null,
      scheduled_for: null,
      last_triggered_at: null,
      archived_at: null,
      created_by_uid: "user-1",
      created_by_email: "admin@vexo.com",
      created_at: new Date().toISOString(),
      starts_at: null,
      ends_at: null,
      chatbot_prompt_type: "campanha",
      campaign_prompt_id: null,
      analytics_meta: {
        sequence: [{ id: "s1", type: "text", text: "Mensagem antiga", order: 1, enabled: true, delayAfterSeconds: 0, image: null }],
        // SEM audienceCriteria
      },
    };

    mockCampaignsList = [legacyCampaign];

    renderLeadImports("enviadas");

    // Expande o cartão da campanha legada
    const expandBtn = await screen.findByRole("button", { name: /Ver detalhes de Campanha Criada Antes do Registro/i });
    fireEvent.click(expandBtn);

    // Clica em "Editar"
    const editBtn = await screen.findByRole("button", { name: /^Editar$/i });
    fireEvent.click(editBtn);

    // Verifica que a mensagem de aviso de campanha legada aparece em uma linha
    await waitFor(() => {
      expect(
        screen.getByText(/Esta campanha foi criada antes do registro de público e o público precisa ser remontado/i)
      ).toBeInTheDocument();
    });

    // O banner de público do banco NÃO aparece
    expect(screen.queryByText(/Público do Banco de Dados Ativo/i)).not.toBeInTheDocument();
  });

  it("(c) divergência de contagem aparece", async () => {
    mockFetchApi.mockImplementation(async (path: string) => {
      if (path === "/api/leads/audience") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: "lead-1", nome: "Lead 1", phone: "551199990001" },
              { id: "lead-2", nome: "Lead 2", phone: "551199990002" },
              { id: "lead-3", nome: "Lead 3", phone: "551199990003" },
            ],
            total: 3,
            truncated: false,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const campaignWithDrift: Campaign = {
      id: "camp-drift-1",
      client_id: "cliente-teste",
      client_name: "Cliente Teste",
      name: "Campanha com Divergência de Leads",
      status: "active",
      mode: "disparo",
      limit_per_run: 50,
      import_id: null,
      webhook_url: "",
      webhook_token: null,
      scheduled_for: null,
      last_triggered_at: null,
      archived_at: null,
      created_by_uid: "user-1",
      created_by_email: "admin@vexo.com",
      created_at: new Date().toISOString(),
      starts_at: null,
      ends_at: null,
      chatbot_prompt_type: "campanha",
      campaign_prompt_id: null,
      analytics_meta: {
        sequence: [{ id: "s1", type: "text", text: "Mensagem", order: 1, enabled: true, delayAfterSeconds: 0, image: null }],
        audienceCriteria: {
          clientId: "cliente-teste",
          stages: ["cold"],
          tags: ["VIP"],
          rules: [],
          description: "público VIP original",
          totalCount: 5, // Haviam sido gravados 5 leads na montagem original!
          savedAt: "2026-10-10T12:00:00.000Z",
        },
      },
    };

    mockCampaignsList = [campaignWithDrift];

    renderLeadImports("enviadas");

    // Expande e clica em "Editar"
    const expandBtn = await screen.findByRole("button", { name: /Ver detalhes de Campanha com Divergência de Leads/i });
    fireEvent.click(expandBtn);
    const editBtn = await screen.findByRole("button", { name: /^Editar$/i });
    fireEvent.click(editBtn);

    // Aguarda a resolução e verifica que o aviso mostra os dois números: 3 e 5
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Público mudou desde a montagem",
          description: expect.stringMatching(/3.*5|5.*3/),
        })
      );
    });

    // O banner na tela também mostra a contagem real e a divergência
    expect(screen.getByText(/carregados 3 leads/i)).toBeInTheDocument();
    expect(screen.getByText(/eram 5/i)).toBeInTheDocument();
  });
});
