import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import LeadImports from "@/pages/LeadImports";
import type { Campaign, CampaignDispatch } from "@/hooks/useCampanhas";

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

describe("Frente A — Botão 'Disparar agora' separado de 'Salvar Alterações' na edição", () => {
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
        return {
          ok: true,
          json: async () => ({ dispatch: { id: "disp-deliberate-1" } }),
        };
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

  it("ao salvar edição pelo botão 'Salvar Alterações de Campanha', cria 0 lotes de disparo", async () => {
    mockCampaignsList = [testCampaign];
    renderLeadImports("enviadas");

    await waitFor(() => {
      expect(screen.getByText("Campanha em Edição")).toBeInTheDocument();
    });

    // Clica no card para expandir e clica em Editar
    const expandBtn = await screen.findByRole("button", { name: /Ver detalhes de Campanha em Edição/i });
    fireEvent.click(expandBtn);

    const editBtn = await screen.findByRole("button", { name: /^Editar$/i });
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Campanha em Edição")).toBeInTheDocument();
    });

    const saveChangesBtn = screen.getByRole("button", { name: /Salvar Alterações de Campanha/i });
    fireEvent.click(saveChangesBtn);

    await waitFor(() => {
      expect(mockUpdateCampaign).toHaveBeenCalled();
    });

    // NENHUM lote criado nem disparado
    expect(createdDispatchesCalls.length).toBe(0);
    expect(triggeredDispatchesCalls.length).toBe(0);
  });

  it("ao clicar em 'Disparar agora', abre o modal com total exato e quantos já receberam; ao confirmar, cria 1 lote e dispara", async () => {
    mockCampaignsList = [testCampaign];
    renderLeadImports("enviadas");

    await waitFor(() => {
      expect(screen.getByText("Campanha em Edição")).toBeInTheDocument();
    });

    // Clica no card para expandir e clica em Editar
    const expandBtn = await screen.findByRole("button", { name: /Ver detalhes de Campanha em Edição/i });
    fireEvent.click(expandBtn);

    const editBtn = await screen.findByRole("button", { name: /^Editar$/i });
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Campanha em Edição")).toBeInTheDocument();
    });

    const dispatchNowBtn = screen.getByRole("button", { name: /^Disparar agora$/i });
    fireEvent.click(dispatchNowBtn);

    // Modal de confirmação deve aparecer
    await waitFor(() => {
      expect(screen.getByText("Confirmar Disparo de Campanha")).toBeInTheDocument();
      expect(screen.getByText("Total de Destinatários")).toBeInTheDocument();
      expect(screen.getByText("Já Receberam")).toBeInTheDocument();
      // O mock tem 1 lead já recebido e 1 novo previsto
      expect(screen.getByText(/1 lead\(s\) desta seleção já receberam/i)).toBeInTheDocument();
      expect(screen.getByText(/Novos envios previstos: 1 lead\(s\)/i)).toBeInTheDocument();
    });

    // Clica no botão de confirmar dentro do modal
    const confirmBtn = screen.getByRole("button", { name: /Confirmar e Disparar Agora/i });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(createdDispatchesCalls.length).toBe(1);
      expect(triggeredDispatchesCalls.length).toBe(1);
    });

    // O lote deve ter sido criado com triggerType manual e disparado
    expect(createdDispatchesCalls[0].triggerType).toBe("manual");
    expect(triggeredDispatchesCalls[0]).toContain("/api/campaigns/dispatches/disp-deliberate-1/trigger");
    // SPEC 17: ninguém digitou limite, então o lote NÃO leva limitPerRun (público inteiro, não o 50 padrão).
    expect(createdDispatchesCalls[0]).not.toHaveProperty("limitPerRun");
  });

  it("SPEC 17: com 'só os primeiros N' digitado, o lote criado leva limitPerRun = N", async () => {
    mockCampaignsList = [testCampaign];
    renderLeadImports("enviadas");

    fireEvent.click(await screen.findByRole("button", { name: /Ver detalhes de Campanha em Edição/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Editar$/i }));
    await waitFor(() => {
      expect(screen.getByDisplayValue("Campanha em Edição")).toBeInTheDocument();
    });

    fireEvent.change(await screen.findByTestId("dispatch-cap-input"), { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: /^Disparar agora$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar e Disparar Agora/i }));

    await waitFor(() => {
      expect(createdDispatchesCalls.length).toBe(1);
    });
    expect(createdDispatchesCalls[0].limitPerRun).toBe(1);
  });

  it("se a campanha não tem planilha/origem definida, o botão 'Disparar agora' fica travado", async () => {
    const campaignWithoutSource: Campaign = {
      ...testCampaign,
      id: "camp-no-src",
      name: "Campanha Sem Origem",
      import_id: null,
      analytics_meta: {
        audienceCriteria: {
          clientId: "cliente-teste",
          tags: ["VIP"],
          totalCount: 2,
        },
        importIds: [],
        sequence: [{ id: "step-1", type: "text", text: "Olá", order: 1, image: null, enabled: true, delayAfterSeconds: 0 }],
      },
    };
    mockCampaignsList = [campaignWithoutSource];
    renderLeadImports("enviadas");

    await waitFor(() => {
      expect(screen.getByText("Campanha Sem Origem")).toBeInTheDocument();
    });

    const expandBtn = await screen.findByRole("button", { name: /Ver detalhes de Campanha Sem Origem/i });
    fireEvent.click(expandBtn);

    const editBtn = await screen.findByRole("button", { name: /^Editar$/i });
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Campanha Sem Origem")).toBeInTheDocument();
    });

    const dispatchNowBtn = screen.getByRole("button", { name: /^Disparar agora$/i });
    expect(dispatchNowBtn).toBeDisabled();
    expect(
      screen.getByText(/Esta campanha não tem planilha de origem definida/i)
    ).toBeInTheDocument();
  });

  // Desde 30/10/2026 a rota recusa o "Agora" fora da janela de envio (422 OUTSIDE_SEND_WINDOW). Antes este fluxo nem
  // conferia a resposta do trigger: com a recusa, diria "O lote de disparos foi iniciado com sucesso" sem nada sair.
  const JANELA_422 = {
    ok: false,
    status: 422,
    json: async () => ({
      error: {
        code: "OUTSIDE_SEND_WINDOW",
        message: "Fora da janela de envio: horário local 18:38, janela 08:00–18:30 [mon,tue,wed,thu,fri] (America/Sao_Paulo), próxima abertura prevista para 08:00 (2/11)",
        details: {
          localTime: "18:38", start: "08:00", end: "18:30", days: ["mon", "tue", "wed", "thu", "fri"],
          timezone: "America/Sao_Paulo", sendWindow: "08:00–18:30 [mon,tue,wed,thu,fri] (America/Sao_Paulo)",
          nextOpening: "2026-11-02T11:00:00.000Z", nextOpeningLocal: "08:00 (2/11)",
        },
      },
    }),
  };
  const triggerBodies: any[] = [];
  function triggerFora422() {
    triggerBodies.length = 0;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, options?: any) => {
      if (url.includes("/dispatches") && options?.method === "POST") {
        if (url.endsWith("/trigger")) {
          const body = options?.body ? JSON.parse(options.body) : {};
          triggeredDispatchesCalls.push(url);
          triggerBodies.push(body);
          if (body.forceOutsideWindow === true) return { ok: true, status: 200, json: async () => ({ success: true }) };
          return { ...JANELA_422, clone: () => JANELA_422 };
        }
        createdDispatchesCalls.push(options?.body ? JSON.parse(options.body) : {});
        return { ok: true, json: async () => ({ dispatch: { id: "disp-deliberate-1" } }) };
      }
      return { ok: true, json: async () => ({}) };
    }) as any;
  }
  async function confirmarDisparoAgora() {
    mockCampaignsList = [testCampaign];
    renderLeadImports("enviadas");
    fireEvent.click(await screen.findByRole("button", { name: /Ver detalhes de Campanha em Edição/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Editar$/i }));
    await waitFor(() => {
      expect(screen.getByDisplayValue("Campanha em Edição")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Disparar agora$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar e Disparar Agora/i }));
  }

  it("fora da janela: mostra a janela e a hora atual; 'Não disparar' não envia e não diz 'Sucesso!'", async () => {
    triggerFora422();
    await confirmarDisparoAgora();

    const texto = await screen.findByTestId("outside-send-window-text");
    expect(texto.textContent).toContain("Agora são 18:38 (America/Sao_Paulo)");
    expect(texto.textContent).toContain("das 08:00 às 18:30, em seg, ter, qua, qui, sex");
    expect(texto.textContent).toContain("A próxima abertura é 08:00 (2/11)");

    fireEvent.click(screen.getByTestId("outside-send-window-cancel"));
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Campanha salva, lote não disparado" }));
    });
    expect(triggerBodies).toEqual([{}]);
    expect(mockToast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Sucesso!" }));
  });

  it("fora da janela: 'Disparar fora da janela' repete o trigger com forceOutsideWindow: true", async () => {
    triggerFora422();
    await confirmarDisparoAgora();

    fireEvent.click(await screen.findByTestId("outside-send-window-force"));
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Sucesso!" }));
    });
    expect(triggerBodies).toEqual([{}, { forceOutsideWindow: true }]);
  });
});
