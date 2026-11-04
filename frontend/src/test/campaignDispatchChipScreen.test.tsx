import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import LeadImports from "@/pages/LeadImports";
import type { Campaign, CampaignDispatch } from "@/hooks/useCampanhas";

// O que a tela pinta e o que sai no POST, na tela real: o botao marcado nao prova envio.

const mockFetchApi = vi.fn();
vi.mock("@/lib/api", () => ({
  fetchApi: (...args: any[]) => mockFetchApi(...args),
  API_BASE_URL: "",
  readApiErrorMessage: async (_res: any, fallback: string) => fallback,
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

const chip = (id: string, name: string, isDefault = false) => ({
  id,
  name,
  active: true,
  is_default: isDefault,
  dispatch_webhook_url: `https://evolution.test/message/sendText/${name}`,
});
const mockClient = {
  id: "cliente-teste",
  name: "Cliente Teste",
  created_at: "",
  plan_tier: "avancado",
  modulos_avulsos: ["disparador_campanhas"],
  n8n_settings: {
    evolution_instances: [chip("chip-caio", "Pessoal - Caio", true), chip("chip-gabriel", "Comercial - Gabriel")],
  },
};
vi.mock("@/hooks/useCrmClient", () => {
  const atual = () => ({
    selectedClientId: "cliente-teste",
    selectedClient: mockClient,
    clients: [mockClient],
  });
  return { useCrmClient: atual, useOptionalCrmClient: atual };
});

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

const campanha = (dispatchOptions: Record<string, unknown>): Campaign =>
  ({
    id: "camp-edit-1",
    name: "Campanha em Edição",
    client_id: "cliente-teste",
    client_name: "Cliente Teste",
    import_id: "imp-1",
    limit_per_run: 50,
    status: "active",
    created_at: "2026-10-10T10:00:00.000Z",
    chatbot_prompt_type: "default",
    mode: "disparo",
    analytics_meta: {
      importIds: ["imp-1"],
      audienceCriteria: { clientId: "cliente-teste", importId: "imp-1", tags: ["VIP"], totalCount: 2, description: "2 leads VIP" },
      sequence: [{ id: "step-1", type: "text", text: "Mensagem teste", order: 1, image: null, enabled: true, delayAfterSeconds: 0 }],
      dispatchOptions,
    },
  }) as unknown as Campaign;

const botaoDoChip = (nome: RegExp) => screen.getByRole("button", { name: nome });
const marcado = (nome: RegExp) => {
  const botao = botaoDoChip(nome);
  return botao.getAttribute("aria-pressed") === "true" && botao.className.split(/\s+/).includes("bg-indigo-600");
};

describe("Chip marcado na tela é o chip que sai no POST", () => {
  let lotesCriados: any[] = [];

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    lotesCriados = [];
    mockDispatchesList = [];
    mockRecipientsResponse = { recipients: [], counts: { total: 0, sent: 0, pending: 0, failed: 0 } };
    mockFetchApi.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ total: 2, items: [{ id: "lead-1", nome: "Ana", telefone: "11999990001" }, { id: "lead-2", nome: "Carlos", telefone: "11999990002" }] }),
    }));
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, options?: any) => {
      if (url.includes("/dispatches") && options?.method === "POST" && !url.endsWith("/trigger")) {
        lotesCriados.push(JSON.parse(options.body));
        return { ok: true, json: async () => ({ dispatch: { id: "disp-1" } }) };
      }
      return { ok: true, json: async () => ({ success: true }) };
    }) as any;
  });

  async function abrirEdicao(dispatchOptions: Record<string, unknown>) {
    mockCampaignsList = [campanha(dispatchOptions)];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/crm/disparador?tab=enviadas"]}>
          <LeadImports fixedClientId="cliente-teste" />
        </MemoryRouter>
      </QueryClientProvider>
    );
    fireEvent.click(await screen.findByRole("button", { name: /Ver detalhes de Campanha em Edição/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Editar$/i }));
    await waitFor(() => expect(screen.getByDisplayValue("Campanha em Edição")).toBeInTheDocument());
  }

  async function dispararECapturar() {
    fireEvent.click(screen.getByRole("button", { name: /^Disparar agora$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar e Disparar Agora/i }));
    await waitFor(() => expect(lotesCriados.length).toBe(1));
    return lotesCriados[0];
  }

  it("id morto salvo, nenhum clique: a tela pinta o padrão e o POST leva o padrão", async () => {
    await abrirEdicao({ evolutionInstanceId: "id-fantasma" });

    expect(marcado(/Pessoal - Caio/)).toBe(true);
    expect(marcado(/Comercial - Gabriel/)).toBe(false);

    const body = await dispararECapturar();
    expect(body.evolutionInstanceId).toBe("chip-caio");
    expect(body.dispatch_options.dispatchChipIds).toEqual(["chip-caio"]);
    expect(JSON.stringify(body)).not.toContain("id-fantasma");
  });

  it("marcar o segundo chip: os dois ficam marcados e os dois vão no POST", async () => {
    await abrirEdicao({ evolutionInstanceId: "chip-caio", dispatchChipIds: ["chip-caio"] });

    fireEvent.click(botaoDoChip(/Comercial - Gabriel/));
    expect(marcado(/Pessoal - Caio/)).toBe(true);
    expect(marcado(/Comercial - Gabriel/)).toBe(true);

    const body = await dispararECapturar();
    expect(body.dispatch_options.dispatchChipIds).toEqual(["chip-caio", "chip-gabriel"]);
    expect(body.evolutionInstanceId).toBe("chip-caio");
  });

  it("id morto salvo, marcar outro chip: soma ao que a tela já mostrava", async () => {
    await abrirEdicao({ evolutionInstanceId: "id-fantasma" });

    fireEvent.click(botaoDoChip(/Comercial - Gabriel/));
    expect(marcado(/Pessoal - Caio/)).toBe(true);
    expect(marcado(/Comercial - Gabriel/)).toBe(true);

    const body = await dispararECapturar();
    expect(body.dispatch_options.dispatchChipIds).toEqual(["chip-caio", "chip-gabriel"]);
  });

  it("trocar o chip: desmarcar o primeiro faz só o segundo sair no POST", async () => {
    await abrirEdicao({ evolutionInstanceId: "chip-caio", dispatchChipIds: ["chip-caio", "chip-gabriel"] });

    fireEvent.click(botaoDoChip(/Pessoal - Caio/));
    expect(marcado(/Pessoal - Caio/)).toBe(false);
    expect(marcado(/Comercial - Gabriel/)).toBe(true);

    const body = await dispararECapturar();
    expect(body.evolutionInstanceId).toBe("chip-gabriel");
    expect(body.dispatch_options.dispatchChipIds).toEqual(["chip-gabriel"]);
  });
});
