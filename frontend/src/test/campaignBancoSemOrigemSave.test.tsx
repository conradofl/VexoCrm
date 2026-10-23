// frontend/src/test/campaignBancoSemOrigemSave.test.tsx
//
// Bloco 2 — a campanha já quebrada (público do Banco, import_id NULL, como a 0d3e7b15) sai do estado quebrado pelo
// próprio Salvar: a tela registra o público do Banco como planilha e manda esse id como importId. Do lado do backend,
// o PATCH com importIds: [] + importId passa a gravar a origem (antes zerava) e a trava deixa passar.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import LeadImports from "@/pages/LeadImports";
import type { Campaign, CampaignDispatch } from "@/hooks/useCampanhas";
import {
  campaignLocalDateTimeToUtcIso,
  campaignUtcIsoToLocalDateTime,
} from "@/lib/leadImports/spreadsheet";

const mockFetchApi = vi.fn();
vi.mock("@/lib/api", () => ({
  fetchApi: (...args: any[]) => mockFetchApi(...args),
  API_BASE_URL: "",
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

const mockCreateLeadImport = vi.fn().mockResolvedValue({ item: { id: "imp-1" } });
vi.mock("@/hooks/useLeadImports", () => ({
  ALL_IMPORTS_VALUE: "__all__",
  CRM_BASE_VALUE: "__crm__",
  useCreateLeadImport: () => ({ mutateAsync: mockCreateLeadImport, isPending: false }),
  useLeadImports: () => ({ data: [], isLoading: false, refetch: vi.fn() }),
  useLeadImportItems: () => ({ data: { items: [], total: 0 }, isLoading: false }),
  useLeadCustomFields: () => ({ data: [], isLoading: false }),
}));

let mockCampaignsList: Campaign[] = [];
let mockDispatchesList: CampaignDispatch[] = [];
const mockCreateCampaign = vi.fn().mockImplementation(async (payload) => ({
  id: "camp-created-1",
  ...payload,
}));
const mockUpdateCampaign = vi.fn().mockImplementation(async (payload) => ({
  id: payload.id || "camp-updated-1",
  ...payload,
}));

vi.mock("@/hooks/useCampanhas", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    saveCampaignWithSelfHeal: vi.fn().mockImplementation(async ({ editingCampaignId, payload, updateCampaign, createCampaign }) => {
      if (editingCampaignId) {
        return updateCampaign({ id: editingCampaignId, ...payload });
      }
      return createCampaign(payload);
    }),
    useCampanhas: () => ({ data: mockCampaignsList, isLoading: false, refetch: vi.fn() }),
    useCampaignAiStatus: () => ({ data: null, isLoading: false }),
    useCreateCampaign: () => ({ mutateAsync: mockCreateCampaign, isPending: false }),
    useDeleteCampaign: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useGenerateCampaignTemplateVariants: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateCampaign: () => ({ mutateAsync: mockUpdateCampaign, isPending: false }),
    useCampaignDispatches: () => ({ data: mockDispatchesList, isLoading: false }),
    useCreateDispatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useDeleteDispatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useTriggerDispatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useUpdateDispatch: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useAllDispatches: () => ({ data: mockDispatchesList, isLoading: false, refetch: vi.fn() }),
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

function makeScheduledCampaign(): { campaign: Campaign; dispatch: CampaignDispatch; scheduledLocal: string; scheduledUtcIso: string } {
  const scheduledLocal = "2026-11-20T14:30";
  const scheduledUtcIso = campaignLocalDateTimeToUtcIso(scheduledLocal)!;

  const campaign: Campaign = {
    id: "camp-sched-1",
    name: "Black Friday Antecipada",
    client_id: "cliente-teste",
    client_name: "Cliente Teste",
    import_id: null,
    limit_per_run: 50,
    webhook_url: "https://evolution.example/webhook",
    webhook_token: null,
    status: "scheduled",
    scheduled_for: scheduledUtcIso,
    last_triggered_at: null,
    archived_at: null,
    created_by_uid: "user-1",
    created_by_email: "admin@vexo.com",
    created_at: "2026-10-10T10:00:00.000Z",
    chatbot_prompt_type: "default",
    campaign_prompt_id: null,
    mode: "disparo",
    starts_at: null,
    ends_at: null,
    analytics_meta: {
      audienceCriteria: {
        clientId: "cliente-teste",
        tags: ["VIP"],
        stages: ["Negociação"],
        totalCount: 5,
        description: "5 leads VIP",
      },
      sequence: [{ id: "step-1", type: "text", text: "Olá", order: 1, image: null, enabled: true, delayAfterSeconds: 0 }],
    },
  };

  const dispatch: CampaignDispatch = {
    id: "disp-sched-1",
    campaign_id: "camp-sched-1",
    client_id: "cliente-teste",
    name: "Black Friday Antecipada — Lote Principal",
    steps: [{ id: "step-1", type: "text", text: "Olá", order: 1, image: null, enabled: true, delayAfterSeconds: 0 }],
    trigger_type: "scheduled",
    scheduled_at: scheduledUtcIso,
    status: "scheduled",
    sent_count: 0,
    failed_count: 0,
    triggered_at: null,
    finished_at: null,
    error_message: null,
    created_at: "2026-10-10T10:00:00.000Z",
    updated_at: "2026-10-10T10:00:00.000Z",
  };

  return { campaign, dispatch, scheduledLocal, scheduledUtcIso };
}

describe("Bloco 2 — Salvar conserta campanha do Banco sem origem", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mockDispatchesList = [];
    mockFetchApi.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        total: 2,
        items: [
          { id: "lead-1", nome: "Ana", telefone: "11999990001" },
          { id: "lead-2", nome: "Carlos", telefone: "11999990002" },
        ],
      }),
    }));
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/dispatches")) {
        return { ok: true, json: async () => ({ dispatches: [], dispatch: { id: "disp-1" } }) };
      }
      return { ok: true, json: async () => ({}) };
    }) as any;
  });

  it("editar e salvar a campanha quebrada registra o público como planilha e manda esse id como origem", async () => {
    const { campaign } = makeScheduledCampaign();
    // Formato da 0d3e7b15: público do Banco, sem import_id e sem importIds.
    mockCampaignsList = [{ ...campaign, status: "active", scheduled_for: null, analytics_meta: { ...campaign.analytics_meta, importIds: [] } } as Campaign];

    renderLeadImports("enviadas");
    fireEvent.click(await screen.findByRole("button", { name: /Ver detalhes de Black Friday Antecipada/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Editar$/i }));
    await waitFor(() => {
      expect(screen.getByText(/Público do Banco de Dados Ativo/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Salvar Alterações de Campanha/i }));
    const confirmBtn = screen.queryByRole("button", { name: /Criar mesmo assim/i });
    if (confirmBtn) fireEvent.click(confirmBtn);

    await waitFor(() => expect(mockUpdateCampaign).toHaveBeenCalled());
    expect(mockCreateLeadImport).toHaveBeenCalledWith(expect.objectContaining({ sourceType: "banco" }));
    const payload = mockUpdateCampaign.mock.calls[0][0];
    expect(payload.importId).toBe("imp-1");
    expect(payload.importIds).toEqual([]);
    // Público do Banco não é "todas as planilhas".
    expect(payload.importSource).toBeUndefined();
  });
});
