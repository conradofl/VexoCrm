// frontend/src/test/campaignEditSchedule.test.tsx
//
// BLOCO 3 — Agendamento volta na edição e não deixa salvar data vencida
// Testes:
// (fuso) round-trip de fuso com horário que cruza a virada do dia
// (a) editar campanha agendada traz a data e a hora certas
// (b) salvar com data passada é recusado e o formulário NÃO é limpo
// (c) salvar com data futura passa

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

describe("BLOCO 3 — Agendamento na edição e trava de data vencida", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    mockCampaignsList = [];
    mockDispatchesList = [];

    // Mock fetchCampaignAudience para preencher os leads
    mockFetchApi.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        total: 5,
        items: [
          { id: "lead-1", nome: "Ana", telefone: "11999990001" },
          { id: "lead-2", nome: "Carlos", telefone: "11999990002" },
        ],
      }),
    }));

    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes("/dispatches")) {
        return {
          ok: true,
          json: async () => ({ dispatches: mockDispatchesList, dispatch: { id: "disp-1" } }),
        };
      }
      return { ok: true, json: async () => ({}) };
    }) as any;
  });

  it("CUIDADO COM FUSO: round-trip exato cruzando a virada do dia", () => {
    // 23:45 da noite cruza a virada do dia em UTC (UTC-3 vira 02:45 do dia seguinte)
    const localInput = "2026-10-15T23:45";
    const utcIso = campaignLocalDateTimeToUtcIso(localInput);
    expect(utcIso).toBeTruthy();

    const restoredLocal = campaignUtcIsoToLocalDateTime(utcIso);
    expect(restoredLocal).toBe(localInput);

    // Também no início do dia
    const morningInput = "2026-05-01T00:15";
    const morningIso = campaignLocalDateTimeToUtcIso(morningInput);
    expect(campaignUtcIsoToLocalDateTime(morningIso)).toBe(morningInput);
  });

  it("(a) editar campanha agendada traz a data e a hora certas", async () => {
    const { campaign, dispatch, scheduledLocal } = makeScheduledCampaign();
    mockCampaignsList = [campaign];
    mockDispatchesList = [dispatch];

    renderLeadImports("enviadas");

    await waitFor(() => {
      expect(screen.getByText("Black Friday Antecipada")).toBeInTheDocument();
    });

    const expandBtn = await screen.findByRole("button", { name: /Ver detalhes de Black Friday Antecipada/i });
    fireEvent.click(expandBtn);

    const editBtn = await screen.findByRole("button", { name: /^Editar$/i });
    fireEvent.click(editBtn);

    // Deve abrir a aba de edição
    await waitFor(() => {
      expect(screen.getByDisplayValue("Black Friday Antecipada")).toBeInTheDocument();
    });

    // O input de data e hora deve estar preenchido com a data e hora certas locais
    await waitFor(() => {
      const dateInput = screen.getByLabelText(/Data e Hora do Agendamento/i) as HTMLInputElement;
      expect(dateInput).toBeInTheDocument();
      expect(dateInput.value).toBe(scheduledLocal);
    });

    // O localStorage por tenant não foi poluído com "scheduled"
    const tenantSavedTrigger = window.localStorage.getItem("vexo_triggerType_cliente-teste");
    expect(tenantSavedTrigger).not.toBe("scheduled");
  });

  it("(a) escolher o minuto corrente é ACEITO (não é recusado pelos segundos decorridos)", async () => {
    const { campaign, dispatch } = makeScheduledCampaign();
    mockCampaignsList = [campaign];
    mockDispatchesList = [dispatch];

    renderLeadImports("enviadas");

    await waitFor(() => {
      expect(screen.getByText("Black Friday Antecipada")).toBeInTheDocument();
    });

    const expandBtn = await screen.findByRole("button", { name: /Ver detalhes de Black Friday Antecipada/i });
    fireEvent.click(expandBtn);

    const editBtn = await screen.findByRole("button", { name: /^Editar$/i });
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Black Friday Antecipada")).toBeInTheDocument();
    });

    // Simula usuário escolhendo exatamente o minuto corrente. Relógio fixo no segundo 5 do minuto (só o Date; timers
    // reais): sem isso, com a máquina lenta, o minuto virava entre escolher e salvar e o teste falhava sem bug.
    const base = new Date();
    base.setSeconds(5, 0);
    vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
    vi.setSystemTime(base);
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const currentMinuteLocal = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

    const dateInput = await screen.findByLabelText(/Data e Hora do Agendamento/i);
    fireEvent.change(dateInput, { target: { value: currentMinuteLocal } });

    const saveBtn = screen.getByRole("button", { name: /Salvar Alterações de Campanha/i });
    fireEvent.click(saveBtn);

    const confirmBtn = screen.queryByRole("button", { name: /Criar mesmo assim/i });
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
    }

    await waitFor(() => {
      const pastToasts = mockToast.mock.calls.filter(c => c[0]?.title === "Data de agendamento já passou");
      expect(pastToasts.length).toBe(0);
      expect(mockUpdateCampaign).toHaveBeenCalled();
    });
  });

  it("(b) salvar com data passada é recusado e o formulário NÃO é limpo", async () => {
    const { campaign, dispatch } = makeScheduledCampaign();
    mockCampaignsList = [campaign];
    mockDispatchesList = [dispatch];

    renderLeadImports("enviadas");

    await waitFor(() => {
      expect(screen.getByText("Black Friday Antecipada")).toBeInTheDocument();
    });

    const expandBtn = await screen.findByRole("button", { name: /Ver detalhes de Black Friday Antecipada/i });
    fireEvent.click(expandBtn);

    const editBtn = await screen.findByRole("button", { name: /^Editar$/i });
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Black Friday Antecipada")).toBeInTheDocument();
    });

    // Altera o input para uma data no passado
    const dateInput = await screen.findByLabelText(/Data e Hora do Agendamento/i);
    fireEvent.change(dateInput, { target: { value: "2020-01-01T10:00" } });

    // Clica no botão de salvar
    const saveBtn = screen.getByRole("button", { name: /Salvar Alterações de Campanha/i });
    fireEvent.click(saveBtn);

    // Toast de data passada exibido imediatamente
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Data de agendamento já passou",
          variant: "destructive",
        })
      );
    });

    // O formulário NÃO foi limpo
    expect(screen.getByDisplayValue("Black Friday Antecipada")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2020-01-01T10:00")).toBeInTheDocument();
    expect(mockUpdateCampaign).not.toHaveBeenCalled();
  });

  it("(c) salvar com data futura passa", async () => {
    const { campaign, dispatch } = makeScheduledCampaign();
    mockCampaignsList = [campaign];
    mockDispatchesList = [dispatch];

    renderLeadImports("enviadas");

    await waitFor(() => {
      expect(screen.getByText("Black Friday Antecipada")).toBeInTheDocument();
    });

    const expandBtn = await screen.findByRole("button", { name: /Ver detalhes de Black Friday Antecipada/i });
    fireEvent.click(expandBtn);

    const editBtn = await screen.findByRole("button", { name: /^Editar$/i });
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByDisplayValue("Black Friday Antecipada")).toBeInTheDocument();
      expect(screen.getByText(/Público do Banco de Dados Ativo/i)).toBeInTheDocument();
    });

    // Define uma data futura
    const futureDate = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const futureLocal = `${futureDate.getFullYear()}-${pad(futureDate.getMonth() + 1)}-${pad(futureDate.getDate())}T10:00`;

    const dateInput = await screen.findByLabelText(/Data e Hora do Agendamento/i);
    fireEvent.change(dateInput, { target: { value: futureLocal } });

    // Clica para salvar
    const saveBtn = screen.getByRole("button", { name: /Salvar Alterações de Campanha/i });
    fireEvent.click(saveBtn);

    // Se abrir diálogo de aviso de duplicidade de lote pendente, confirma criação
    const confirmBtn = screen.queryByRole("button", { name: /Criar mesmo assim/i });
    if (confirmBtn) {
      fireEvent.click(confirmBtn);
    }

    // Não deve acusar data de agendamento já passou e deve salvar a campanha
    await waitFor(() => {
      const pastToasts = mockToast.mock.calls.filter(c => c[0]?.title === "Data de agendamento já passou");
      expect(pastToasts.length).toBe(0);
      expect(mockUpdateCampaign).toHaveBeenCalled();
    });
  });
});
