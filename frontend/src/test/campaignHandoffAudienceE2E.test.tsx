import React from "react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import LeadImports from "@/pages/LeadImports";
import { filterParams } from "@/lib/leads/leadListApi";
import { toast } from "@/components/ui/use-toast";
import { buildCampaignCriteria } from "@/pages/BancoDeDados";
import bancoSrc from "@/pages/BancoDeDados.tsx?raw";

// Espião do Toast
vi.mock("@/components/ui/use-toast", () => ({
  toast: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

// Mock do fetchApi
const mockFetchApi = vi.fn();
vi.mock("@/lib/api", () => ({
  fetchApi: (...args: any[]) => mockFetchApi(...args),
}));

// Mocks de autenticação e contexto
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
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <LeadImports fixedClientId="cliente-teste" />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Handoff de Público do Banco para Campanhas (Resolução do Público Real)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Teste (a) - PONTA A PONTA (o teste que faltava)
  it("a) PONTA A PONTA: critério gravado no Banco com DUAS tags e um estágio; LeadImports resolve e carrega EXATAMENTE os leads da união daquele estágio", async () => {
    const audienceRequests: any[] = [];
    const idsRequests: any[] = [];

    mockFetchApi.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/leads/audience") {
        const body = JSON.parse(String(init?.body || "{}"));
        audienceRequests.push({ path, init, body });
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
      if (path.startsWith("/api/leads/ids")) {
        idsRequests.push(path);
        // Se a chamada antiga de fetchLeadIds acontecer, ela retorna a base inteira sem filtro
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ids: ["lead-1", "lead-2", "lead-outro-1", "lead-outro-2", "lead-outro-3"],
            total: 5,
            contacts: [
              { id: "lead-1", nome: "Lead Tag VIP", telefone: "551199990001" },
              { id: "lead-2", nome: "Lead Tag Proposta", telefone: "551199990002" },
              { id: "lead-outro-1", nome: "Outro 1", telefone: "551199990003" },
              { id: "lead-outro-2", nome: "Outro 2", telefone: "551199990004" },
              { id: "lead-outro-3", nome: "Outro 3", telefone: "551199990005" },
            ],
            truncated: false,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    // Simula o payload gravado no localStorage pelo BancoDeDados ao avançar para campanhas
    const handoffPayload = {
      criteria: {
        clientId: "cliente-teste",
        stages: ["cold"],
        tags: ["VIP", "Proposta"],
        rules: [],
      },
      totalCount: 2,
      campaignName: "Campanha Funil Duas Tags",
      description: 'público: estágio Leads Frios, tags "VIP", "Proposta", 2 leads',
    };
    window.localStorage.setItem("vexo_pending_campaign_audience", JSON.stringify(handoffPayload));

    renderLeadImports();

    // Aguarda a resolução do público pelo endpoint /api/leads/audience
    await waitFor(() => {
      expect(audienceRequests).toHaveLength(1);
    });

    // PROVA DO ENDPOINT E DOS PARÂMETROS ENVIADOS:
    // A rota chamada DEVE ser /api/leads/audience e NÃO /api/leads/ids
    expect(idsRequests).toHaveLength(0);
    const sentBody = audienceRequests[0].body;
    expect(sentBody.stages).toEqual(["cold"]);
    expect(sentBody.tags).toEqual(["VIP", "Proposta"]);
    expect(sentBody.rules).toEqual([]);

    // O banner de público reflete os 2 leads carregados
    await waitFor(() => {
      expect(screen.getByText(/Público do Banco de Dados Ativo/i)).toBeInTheDocument();
      expect(screen.getByText(/2 leads/i)).toBeInTheDocument();
    });
  });

  // Teste (b) - Critério com 1 tag carrega os mesmos leads que a prévia mostrou (141, não 366)
  it("b) o critério com 1 tag carrega os mesmos leads que a prévia mostrou (o caso medido hoje: 141, não 366)", async () => {
    let capturedPath = "";
    mockFetchApi.mockImplementation(async (path: string, init?: RequestInit) => {
      capturedPath = path;
      if (path === "/api/leads/audience") {
        // Prévia e audience devolvem exatamente os 141 leads filtrados pela tag
        const items = Array.from({ length: 141 }, (_, i) => ({
          id: `lead-${i}`,
          nome: `Lead VIP ${i}`,
          phone: `55119999${String(i).padStart(4, "0")}`,
        }));
        return {
          ok: true,
          status: 200,
          json: async () => ({ items, total: 141, truncated: false }),
        };
      }
      if (path.startsWith("/api/leads/ids")) {
        // Se caísse no fetchLeadIds antigo, devolveria os 366 da base inteira
        const items = Array.from({ length: 366 }, (_, i) => ({
          id: `lead-${i}`,
          nome: `Lead Base ${i}`,
          phone: `55119000${String(i).padStart(4, "0")}`,
        }));
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ids: items.map((i) => i.id),
            total: 366,
            contacts: items,
            truncated: false,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    // Simula a tag de 141 leads
    window.localStorage.setItem(
      "vexo_pending_campaign_audience",
      JSON.stringify({
        criteria: {
          clientId: "cliente-teste",
          stages: ["all"],
          tags: ["Tag141"],
          rules: [],
        },
        totalCount: 141,
        campaignName: "Campanha Tag 141",
        description: 'público: tag "Tag141", 141 leads',
      })
    );

    renderLeadImports();

    await waitFor(() => {
      expect(capturedPath).toBe("/api/leads/audience");
    });

    // O público carregado é estritamente 141 leads, e NUNCA 366
    await waitFor(() => {
      expect(screen.getByText(/141 leads/i)).toBeInTheDocument();
      expect(screen.queryByText(/366 leads/i)).toBeNull();
    });
  });

  // Teste (c) - rules do filtro dinâmico chegam ao público carregado
  it("c) rules do filtro dinâmico chegam ao público carregado", async () => {
    // 1. Prova estática: BancoDeDados.tsx DEVE incluir rules: campaignFunnelFilterRules no objeto criteria
    expect(bancoSrc).toMatch(/rules:\s*campaignFunnelFilterRules/);

    // 2. Prova de execução: LeadImports repassa as rules para /api/leads/audience
    let receivedRules: any = null;
    mockFetchApi.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/leads/audience") {
        const body = JSON.parse(String(init?.body || "{}"));
        receivedRules = body.rules;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [{ id: "l1", nome: "Lead Regra SP", phone: "551199990001" }],
            total: 1,
            truncated: false,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    const customRules = [{ id: "rule-1", column: "cidade", operator: "equals" as const, value: "São Paulo" }];
    const criteria = buildCampaignCriteria({
      clientId: "cliente-teste",
      stageFilters: ["all"],
      tagFilters: ["VIP"],
      filterRules: customRules,
    });
    expect(criteria.rules).toEqual(customRules);

    window.localStorage.setItem(
      "vexo_pending_campaign_audience",
      JSON.stringify({
        criteria,
        totalCount: 1,
      })
    );

    renderLeadImports();

    await waitFor(() => {
      expect(receivedRules).toEqual(customRules);
    });
  });

  // Teste (d) - excludedLeadIds continua removendo os leads excluídos
  it("d) excludedLeadIds continua removendo os leads excluídos", async () => {
    mockFetchApi.mockImplementation(async (path: string) => {
      if (path === "/api/leads/audience") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [
              { id: "lead-manter-1", nome: "Lead 1", phone: "551199990001" },
              { id: "lead-excluido-2", nome: "Lead 2", phone: "551199990002" },
              { id: "lead-manter-3", nome: "Lead 3", phone: "551199990003" },
            ],
            total: 3,
            truncated: false,
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    window.localStorage.setItem(
      "vexo_pending_campaign_audience",
      JSON.stringify({
        criteria: {
          clientId: "cliente-teste",
          stages: ["cold"],
          tags: ["VIP"],
          rules: [],
        },
        excludedLeadIds: ["lead-excluido-2"],
        totalCount: 2,
      })
    );

    renderLeadImports();

    // Deve carregar 2 leads (lead-1 e lead-3), com lead-2 excluído
    await waitFor(() => {
      expect(screen.getByText(/2 leads/i)).toBeInTheDocument();
    });
  });

  // Teste (e) - truncated, importNotFound e scopeUnavailable aparecem na tela
  it("e) truncated, importNotFound e scopeUnavailable aparecem na tela", async () => {
    // 1. Caso truncated: true
    mockFetchApi.mockImplementation(async (path: string) => {
      if (path === "/api/leads/audience") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], total: 100000, truncated: true }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    window.localStorage.setItem(
      "vexo_pending_campaign_audience",
      JSON.stringify({
        criteria: { clientId: "cliente-teste", stages: ["all"], tags: [] },
      })
    );

    renderLeadImports();

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Público limitado ao teto",
        })
      );
    });

    // 2. Caso importNotFound: true
    vi.clearAllMocks();
    mockFetchApi.mockImplementation(async (path: string) => {
      if (path === "/api/leads/audience") {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [], total: 0, truncated: false, importNotFound: true }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    window.localStorage.setItem(
      "vexo_pending_campaign_audience",
      JSON.stringify({
        criteria: { clientId: "cliente-teste", stages: ["all"], tags: [], importId: "imp-inexistente" },
      })
    );

    renderLeadImports();

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          title: "Planilha não encontrada",
        })
      );
    });

    // 3. Caso scopeUnavailable: true
    vi.clearAllMocks();
    mockFetchApi.mockImplementation(async (path: string) => {
      if (path === "/api/leads/audience") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: [],
            total: 0,
            truncated: false,
            scopeUnavailable: true,
            reason: "Importação reconstruída sem hora de abertura",
          }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    window.localStorage.setItem(
      "vexo_pending_campaign_audience",
      JSON.stringify({
        criteria: { clientId: "cliente-teste", stages: ["all"], tags: [], importId: "imp-rec", importScope: "born" },
      })
    );

    renderLeadImports();

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "destructive",
          title: "Recorte indisponível",
          description: "Importação reconstruída sem hora de abertura",
        })
      );
    });
  });

  // Teste (f) - filterParams registra erro ao receber stages/rules (tags agora é suportado oficialmente)
  it("f) filterParams registra erro ao receber stages/rules", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // 1. Recebendo stages
    filterParams({ stages: ["cold", "in_conversation"] } as any);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"stages"'));

    // 2. Recebendo rules
    errorSpy.mockClear();
    filterParams({ rules: [{ column: "cidade", operator: "equals", value: "SP" }] } as any);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('"rules"'));

    errorSpy.mockRestore();
  });
});
