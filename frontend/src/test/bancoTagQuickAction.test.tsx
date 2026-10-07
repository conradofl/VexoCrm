// frontend/src/test/bancoTagQuickAction.test.tsx
//
// Testes da Frente 2: Botão de Ação Rápida de Tags no Banco de Dados
// & Frente 1: Card de Decisão de Duplicados

import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import BancoDeDados from "@/pages/BancoDeDados";
import { BancoActionsBar } from "@/components/leads/BancoActionsBar";
import { DuplicateDecisionCard, type DuplicateStrategy } from "@/components/leads/DuplicateDecisionCard";

const mockTenant = {
  id: "tenant-test",
  name: "Tenant Teste",
  plan_tier: "avancado",
  ticket_medio: 1000,
  modulos_avulsos: [],
  n8n_settings: {
    chatbot_enabled: true,
    evolution_instances: [{ name: "Instancia-1", active: true, id: "inst-1" }],
  },
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    clientId: "tenant-test",
    isInternalUser: true,
    isAuthenticated: true,
    isAdminUser: true,
    canAccessInternalPage: () => true,
    canAccessView: () => true,
    getIdToken: async () => "mock-token",
  }),
}));

const mockCrmClient = {
  selectedClientId: "tenant-test",
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

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
}));

const jsonResponse = (data: unknown, status = 200) =>
  ({
    ok: status < 400,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as any);

function setupFetchMock() {
  global.fetch = vi.fn(async (url: string | URL | Request, init?: any) => {
    const u = new URL(String(url), "http://localhost");

    if (u.pathname === "/api/leads/facets") {
      return jsonResponse({
        summary: {
          totalLeads: 150,
          buyersCount: 0,
          lostCount: 0,
          openBudgetsCount: 0,
          inNegotiationCount: 0,
          inConversationCount: 0,
          neverContactedCount: 150,
          activeLeadsCount: 150,
        },
        tags: [
          { tag: "#Imp-Campanha_Teste", count: 120 },
          { tag: "#Outra_Tag", count: 30 },
        ],
        channels: [],
        sources: [],
        campaigns: [],
        segments: [],
        baseTotal: 150,
        filteredTotal: 150,
      });
    }

    if (u.pathname === "/api/leads") {
      return jsonResponse({
        leads: [
          {
            id: "lead-1",
            client_id: "tenant-test",
            nome: "Lead Teste 1",
            stage: "cold",
            telefone: "551199990001",
            phone: null,
            temperature: "cold",
            tags: ["#Imp-Campanha_Teste"],
            created_at: "2026-01-01T00:00:00.000Z",
            dados: {},
          },
        ],
        total: 150,
        page: 1,
        pageSize: 50,
        totalPages: 3,
      });
    }

    if (u.pathname === "/api/leads/bulk-update") {
      return jsonResponse({ success: true, updatedCount: 150 });
    }

    return jsonResponse({});
  });
}

function renderBanco() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
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

describe("Frente 2: Botão de Ação Rápida de Tags no Banco de Dados", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renderiza o botão 'Gerenciar Tags' na BancoActionsBar quando há leads filtrados", () => {
    const onManageTags = vi.fn();
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BancoActionsBar
            loading={false}
            onRefresh={vi.fn()}
            onExtractWhatsApp={vi.fn()}
            onImportInstagram={vi.fn()}
            onPasteText={vi.fn()}
            onImportSpreadsheet={vi.fn()}
            onExportXLSX={vi.fn()}
            onExportCSV={vi.fn()}
            onCreateCampaign={vi.fn()}
            onNewLead={vi.fn()}
            onManageTags={onManageTags}
            hasFilteredLeads={true}
            selectedCount={0}
            onApplyFollowup={vi.fn()}
            onSingleReminder={vi.fn()}
            clientId="tenant-test"
            canManageBulk={true}
          />
        </TooltipProvider>
      </QueryClientProvider>
    );

    const btn = screen.getByTestId("btn-manage-tags-bar");
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveTextContent("Gerenciar Tags");

    fireEvent.click(btn);
    expect(onManageTags).toHaveBeenCalledTimes(1);
  });

  it("não renderiza o botão 'Gerenciar Tags' quando hasFilteredLeads for false", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <BancoActionsBar
            loading={false}
            onRefresh={vi.fn()}
            onExtractWhatsApp={vi.fn()}
            onImportInstagram={vi.fn()}
            onPasteText={vi.fn()}
            onImportSpreadsheet={vi.fn()}
            onExportXLSX={vi.fn()}
            onExportCSV={vi.fn()}
            onCreateCampaign={vi.fn()}
            onNewLead={vi.fn()}
            onManageTags={vi.fn()}
            hasFilteredLeads={false}
            selectedCount={0}
            onApplyFollowup={vi.fn()}
            onSingleReminder={vi.fn()}
            clientId="tenant-test"
            canManageBulk={true}
          />
        </TooltipProvider>
      </QueryClientProvider>
    );

    expect(screen.queryByTestId("btn-manage-tags-bar")).not.toBeInTheDocument();
  });

  it("abre modal em modo critério e pré-preenche a aba 'Remover Tag' quando filtro de tag estiver ativo", async () => {
    setupFetchMock();
    renderBanco();

    // Espera os dados carregarem
    await waitFor(() => {
      expect(screen.getByTestId("btn-manage-tags-bar")).toBeInTheDocument();
    });

    // Clica em 'Gerenciar Tags'
    const manageBtn = screen.getByTestId("btn-manage-tags-bar");
    fireEvent.click(manageBtn);

    // O modal deve abrir com as abas de Adicionar/Remover
    await waitFor(() => {
      expect(screen.getByTestId("tab-add-tag")).toBeInTheDocument();
      expect(screen.getByTestId("tab-remove-tag")).toBeInTheDocument();
    });

    // Troca para remover tag
    fireEvent.click(screen.getByTestId("tab-remove-tag"));
    const inputRemove = screen.getByTestId("input-bulk-tag-remove") as HTMLInputElement;
    expect(inputRemove).toBeInTheDocument();

    // Digita a tag indesejada
    fireEvent.change(inputRemove, { target: { value: "#Imp-Campanha_Teste" } });
    expect(inputRemove.value).toBe("#Imp-Campanha_Teste");

    // O botão exibe 'Remover "#Imp-Campanha_Teste" dos 120 leads'
    const submitBtn = screen.getByTestId("btn-submit-bulk-tag");
    expect(submitBtn).toHaveTextContent('Remover "#Imp-Campanha_Teste" dos 120 leads');

    // Clica para submeter
    fireEvent.click(submitBtn);

    await waitFor(() => {
      // Verifica se a chamada enviou criterion e removeTag focando na tag selecionada
      const bulkCalls = (global.fetch as any).mock.calls.filter((c: any[]) =>
        String(c[0]).includes("/api/leads/bulk-update")
      );
      expect(bulkCalls.length).toBeGreaterThan(0);
      const reqBody = JSON.parse(bulkCalls[0][1].body);
      expect(reqBody.updates).toEqual({ removeTag: "#Imp-Campanha_Teste" });
      expect(reqBody.criteria).toBeDefined();
      expect(reqBody.criteria.tag).toBe("#Imp-Campanha_Teste");
    });
  });

  it("permite clicar em 'Ver leads na tabela' fechando o modal e filtrando a tabela pela tag", async () => {
    setupFetchMock();
    renderBanco();

    await waitFor(() => {
      expect(screen.getByTestId("btn-manage-tags-bar")).toBeInTheDocument();
    });

    // Abre o modal
    fireEvent.click(screen.getByTestId("btn-manage-tags-bar"));
    await waitFor(() => {
      expect(screen.getByTestId("tab-remove-tag")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("tab-remove-tag"));
    const inputRemove = screen.getByTestId("input-bulk-tag-remove") as HTMLInputElement;

    // Digita a tag
    fireEvent.change(inputRemove, { target: { value: "#Imp-Campanha_Teste" } });

    // O botão de inspeção na tabela fica habilitado
    const inspectBtn = screen.getByTestId("btn-inspect-tag-table");
    expect(inspectBtn).toBeEnabled();

    // Clica para inspecionar
    fireEvent.click(inspectBtn);

    // O modal deve fechar e a busca de leads com a tag deve ocorrer
    await waitFor(() => {
      expect(screen.queryByTestId("input-bulk-tag-remove")).not.toBeInTheDocument();
      const leadCalls = (global.fetch as any).mock.calls.filter((c: any[]) =>
        String(c[0]).includes("tag=%23Imp-Campanha_Teste") || String(c[0]).includes("tag=#Imp-Campanha_Teste")
      );
      expect(leadCalls.length).toBeGreaterThan(0);
    });
  });
});

describe("TagSelect com Contadores", () => {
  it("renderiza opções com as contagens formatadas", async () => {
    const { TagSelect } = await import("@/components/leads/TagSelect");
    render(
      <TagSelect
        value=""
        onChange={vi.fn()}
        tags={[
          { tag: "VIP", count: 42, kind: "minhas" },
          { tag: "#Imp-Planilha1", count: 1500, kind: "planilha" },
        ]}
      />
    );
    expect(screen.getByText("VIP (42)")).toBeInTheDocument();
    expect(screen.getByText("#Imp-Planilha1 (1.500)")).toBeInTheDocument();
  });
});

describe("Frente 1: DuplicateDecisionCard", () => {
  it("renderiza badges de leads novos e duplicados e opções de estratégia", () => {
    const analysis = {
      totalRows: 100,
      newCount: 80,
      duplicateCount: 20,
      duplicatesByPhone: 18,
      duplicatesByName: 2,
      sampleDuplicates: [
        { nome: "Contato 1", telefone: "5534999990001", existingTags: ["#Tag1"] },
      ],
    };

    const onStrategyChange = vi.fn();

    render(
      <DuplicateDecisionCard
        analysis={analysis}
        strategy="merge"
        onStrategyChange={onStrategyChange}
      />
    );

    expect(screen.getByTestId("duplicate-decision-card")).toBeInTheDocument();
    expect(screen.getByTestId("badge-new-leads")).toHaveTextContent("80 leads novos");
    expect(screen.getByTestId("badge-duplicate-leads")).toHaveTextContent("20 já existem no Banco de Dados");
    expect(screen.getByText("Contato 1")).toBeInTheDocument();

    // As 3 opções de radio
    expect(screen.getByTestId("radio-strategy-merge")).toBeInTheDocument();
    expect(screen.getByTestId("radio-strategy-skip")).toBeInTheDocument();
    expect(screen.getByTestId("radio-strategy-overwrite")).toBeInTheDocument();

    // Troca para skip
    fireEvent.click(screen.getByTestId("radio-strategy-skip"));
    expect(onStrategyChange).toHaveBeenCalledWith("skip");
  });

  it("não renderiza nada quando duplicateCount === 0", () => {
    const analysis = {
      totalRows: 50,
      newCount: 50,
      duplicateCount: 0,
      duplicatesByPhone: 0,
      duplicatesByName: 0,
      sampleDuplicates: [],
    };

    const { container } = render(
      <DuplicateDecisionCard
        analysis={analysis}
        strategy="merge"
        onStrategyChange={vi.fn()}
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
