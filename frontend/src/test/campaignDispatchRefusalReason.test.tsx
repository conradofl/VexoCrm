import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import LeadImports from "@/pages/LeadImports";
import type { Campaign, CampaignDispatch } from "@/hooks/useCampanhas";

const mockFetchApi = vi.fn();
// readApiErrorMessage REAL: é ela que tira a frase do corpo. Dublá-la esconderia o defeito.
vi.mock("@/lib/api", async () => {
  const real = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...real, fetchApi: (...args: any[]) => mockFetchApi(...args), API_BASE_URL: "" };
});

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
let mockRecipientsResponse: any = { recipients: [], counts: { total: 0, sent: 0, pending: 0, failed: 0 } };

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
    useCampaignRecipients: () => ({ data: mockRecipientsResponse, isLoading: false }),
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


const MOTIVO_DO_SERVIDOR = "O passo 1 precisa ter texto ou imagem antes de disparar.";
let respostaDoRegistroDoLote: () => any = () => ({ ok: true, json: async () => ({ dispatch: { id: "disp-1" } }) });

function respostaJson(status: number, corpo: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "application/json" : null) },
    json: async () => corpo,
    text: async () => JSON.stringify(corpo),
  };
}

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

describe("recusa do servidor ao registrar o lote chega ao toast", () => {
  let createdDispatchesCalls: any[] = [];
  let triggeredDispatchesCalls: string[] = [];

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mockCampaignsList = [];
    mockDispatchesList = [];
    createdDispatchesCalls = [];
    triggeredDispatchesCalls = [];

    mockRecipientsResponse = {
      recipients: [
        { phone: "5511999990001", status: "sent", leadId: "lead-1" },
      ],
      counts: { total: 1, sent: 1, pending: 0, failed: 0 },
    };

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

    globalThis.fetch = vi.fn().mockImplementation(async (url: string, options?: any) => {
      if (url.includes("/dispatches") && options?.method === "POST") {
        if (url.endsWith("/trigger")) {
          triggeredDispatchesCalls.push(url);
          return { ok: true, json: async () => ({ success: true }) };
        }
        const body = options?.body ? JSON.parse(options.body) : {};
        createdDispatchesCalls.push(body);
        return respostaDoRegistroDoLote();
      }
      return { ok: true, json: async () => ({}) };
    }) as any;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const testCampaign: Campaign = {
    id: "camp-edit-1",
    name: "Campanha em Edição",
    client_id: "cliente-teste",
    client_name: "Cliente Teste",
    import_id: "imp-1",
    limit_per_run: 50,
    webhook_url: "https://evolution.example/webhook",
    webhook_token: null,
    status: "active",
    scheduled_for: null,
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
      importIds: ["imp-1"],
      audienceCriteria: {
        clientId: "cliente-teste",
        importId: "imp-1",
        tags: ["VIP"],
        totalCount: 2,
        description: "2 leads VIP",
      },
      sequence: [{ id: "step-1", type: "text", text: "Mensagem teste", order: 1, image: null, enabled: true, delayAfterSeconds: 0 }],
    },
  };


  async function dispararPelaEdicao() {
    mockCampaignsList = [testCampaign];
    renderLeadImports("enviadas");
    fireEvent.click(await screen.findByRole("button", { name: /Ver detalhes de Campanha em Edição/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Editar$/i }));
    await waitFor(() => expect(screen.getByDisplayValue("Campanha em Edição")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^Disparar agora$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar e Disparar Agora/i }));
  }

  function descricoesDosToasts(): string[] {
    return mockToast.mock.calls.map(([t]) => String(t?.description ?? ""));
  }

  it("[TESTE OBRIGATÓRIO] 400 com error.message: a frase do servidor aparece no toast, e nada é disparado", async () => {
    respostaDoRegistroDoLote = () =>
      respostaJson(400, { error: { code: "INVALID_DISPATCH_TEMPLATE", message: MOTIVO_DO_SERVIDOR } });

    await dispararPelaEdicao();

    await waitFor(() => expect(createdDispatchesCalls.length).toBe(1));
    await waitFor(() => expect(descricoesDosToasts()).toContain(MOTIVO_DO_SERVIDOR));
    expect(descricoesDosToasts().join(" | ")).not.toContain("Erro ao registrar lote de disparo");
    expect(triggeredDispatchesCalls.length).toBe(0);
  });

  it("400 sem corpo legível: frase genérica, mas com o status HTTP", async () => {
    respostaDoRegistroDoLote = () => respostaJson(400, {});

    await dispararPelaEdicao();

    await waitFor(() => expect(descricoesDosToasts()).toContain("Erro ao registrar lote de disparo: 400"));
  });
});
