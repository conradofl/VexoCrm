// frontend/src/test/bancoCriterionSelection.test.tsx
//
// Testes do Bloco 1 — Seleção por Critério nas Planilhas Salvas e Banco de Dados:
// 1. "selecionar todos" com filtro ativo seleciona o total do filtro (ex: 77.551), não a página (50).
// 2. Desmarcar leads individuais depois de "selecionar todos" reduz o total exatamente no número desmarcado.
// 3. Trocar o filtro limpa a seleção por critério, e a tela avisa (toast).
// 4. Repasse leve (< 1 KB) do critério + exceções para Campanhas, sem serializar 77k IDs.

import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { toast } from "sonner";
import BancoDeDados from "@/pages/BancoDeDados";
import {
  buildFilterCriterionSummary,
  formatSelectionBarLabel,
} from "@/lib/leads/audienceDescription";

const TOTAL_FILTER = 77_551;
const PAGE_SIZE = 50;

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

const generatePageLeads = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `lead-uuid-${i + 1}`,
    client_id: "tenant-test",
    nome: `Lead Empresa ${i + 1}`,
    stage: "cold",
    telefone: `55119999000${i}`,
    phone: null,
    temperature: "cold",
    raw_chat_summary: null,
    created_at: "2026-01-01T00:00:00.000Z",
    last_interaction_at: null,
    dados: {},
  }));

const jsonResponse = (data: unknown, status = 200) =>
  ({
    ok: status < 400,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  } as any);

function setupFetchMock(totalCount = TOTAL_FILTER) {
  const pageItems = generatePageLeads(PAGE_SIZE);

  global.fetch = vi.fn(async (url: string | URL | Request) => {
    const u = new URL(String(url), "http://localhost");

    if (u.pathname === "/api/leads/facets") {
      return jsonResponse({
        summary: {
          totalLeads: totalCount,
          buyersCount: 0,
          lostCount: 0,
          openBudgetsCount: 0,
          inNegotiationCount: 0,
          inConversationCount: 0,
          neverContactedCount: totalCount,
          activeLeadsCount: totalCount,
          estimatedRevenue: 0,
        },
        channels: {},
        sources: [],
        tags: [],
        baseTotal: totalCount,
        stagesExact: { buyer: 0, open_budget: 0, inquiry: 0, cold: totalCount, lost: 0, other: 0 },
        failedParts: {},
      });
    }

    if (u.pathname === "/api/leads") {
      return jsonResponse({
        items: pageItems,
        total: totalCount,
        page: 1,
        limit: PAGE_SIZE,
        totalPages: Math.ceil(totalCount / PAGE_SIZE),
        tabs: {
          all: totalCount,
          buyer: 0,
          open_budget: 0,
          cold: totalCount,
          lost: 0,
        },
      });
    }

    if (u.pathname === "/api/leads/import-sources") {
      return jsonResponse({
        items: [
          {
            id: "sheet-udia-5",
            source_name: "UDIA 5.xlsx",
            created_at: "2026-06-01T12:00:00.000Z",
            total_rows: totalCount,
            status: "completed",
          },
        ],
      });
    }

    if (u.pathname === "/api/leads/ids") {
      return jsonResponse({
        ids: pageItems.map((p) => p.id),
        total: pageItems.length,
        truncated: false,
        contacts: pageItems.map((p) => ({ id: p.id, nome: p.nome, telefone: p.telefone })),
      });
    }

    if (u.pathname === "/api/leads/audience") {
      return jsonResponse({
        items: pageItems,
        total: totalCount,
        truncated: false,
      });
    }

    return jsonResponse({});
  });
}

function renderBanco() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <TooltipProvider>
          <BancoDeDados />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("Bloco 1 — Seleção por Critério", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
    setupFetchMock();
  });

  it("[REGRA 1.1] selecionar todos com filtro ativo seleciona o total do filtro (77.551), não a página (50)", async () => {
    renderBanco();

    // 1. Aguarda carregamento da tabela com a página de 50 leads
    await waitFor(() => {
      expect(screen.getByText("Lead Empresa 1")).toBeInTheDocument();
    });

    const headerCheckbox = screen.getByTestId("header-select-all-checkbox") as HTMLInputElement;
    expect(headerCheckbox.checked).toBe(false);

    // 2. Marca a caixa do cabeçalho: seleciona a página (50 leads)
    fireEvent.click(headerCheckbox);
    expect(headerCheckbox.checked).toBe(true);

    // 3. Logo abaixo aparece o banner contextual
    const banner = await screen.findByTestId("selection-criterion-banner");
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain("Todos os 50 leads desta página estão selecionados");
    expect(banner.textContent).toContain("Selecionar todos os 77.551 que batem com este filtro");

    // 4. Clica em "Selecionar todos os 77.551 que batem com este filtro"
    const btnSelectAllCriterion = screen.getByTestId("btn-select-all-criterion");
    fireEvent.click(btnSelectAllCriterion);

    // 5. A seleção vira o critério ativo: 77.551 leads selecionados
    await waitFor(() => {
      const summaryBadge = screen.getByTestId("selection-summary-badge");
      expect(summaryBadge).toBeInTheDocument();
      expect(summaryBadge.textContent).toContain("77.551 leads");
    });

    // 6. O banner atualiza para refletir que todos os 77.551 do filtro estão selecionados
    expect(banner.textContent).toContain("Todos os 77.551 leads que batem com este filtro estão selecionados");
  });

  it("[REGRA 1.2] desmarcar leads individuais depois de selecionar todos reduz o total exatamente nesse número", async () => {
    renderBanco();

    await waitFor(() => {
      expect(screen.getByText("Lead Empresa 1")).toBeInTheDocument();
    });

    // Marca página e depois "Selecionar todos os 77.551"
    const headerCheckbox = screen.getByTestId("header-select-all-checkbox");
    fireEvent.click(headerCheckbox);

    const btnSelectAllCriterion = await screen.findByTestId("btn-select-all-criterion");
    fireEvent.click(btnSelectAllCriterion);

    await waitFor(() => {
      expect(screen.getByTestId("selection-summary-badge")).toBeInTheDocument();
    });

    // Desmarca 3 leads individuais
    const checkLead1 = screen.getByTestId("lead-checkbox-lead-uuid-1");
    const checkLead2 = screen.getByTestId("lead-checkbox-lead-uuid-2");
    const checkLead3 = screen.getByTestId("lead-checkbox-lead-uuid-3");

    fireEvent.click(checkLead1);
    fireEvent.click(checkLead2);
    fireEvent.click(checkLead3);

    // O total é reduzido exatamente de 3: 77.551 - 3 = 77.548
    await waitFor(() => {
      const summaryBadge = screen.getByTestId("selection-summary-badge");
      expect(summaryBadge.textContent).toContain("77.551 leads");
      expect(summaryBadge.textContent).toContain("− 3 desmarcados");
    });

    // O banner também aponta os 3 desmarcados
    const banner = screen.getByTestId("selection-criterion-banner");
    expect(banner.textContent).toContain("(−3 desmarcados)");
    expect(screen.getByText("77.548 selecionados")).toBeInTheDocument();
  });

  it("[REGRA 1.2.1] remarcar um lead previamente desmarcado remove a exceção e restaura o total selecionado", async () => {
    renderBanco();

    await waitFor(() => {
      expect(screen.getByText("Lead Empresa 1")).toBeInTheDocument();
    });

    // 1. Ativa seleção por critério (77.551)
    const headerCheckbox = screen.getByTestId("header-select-all-checkbox");
    fireEvent.click(headerCheckbox);

    const btnSelectAllCriterion = await screen.findByTestId("btn-select-all-criterion");
    fireEvent.click(btnSelectAllCriterion);

    await waitFor(() => {
      expect(screen.getByTestId("selection-summary-badge")).toBeInTheDocument();
    });

    // 2. Desmarca o lead 1 (total cai para 77.550)
    const checkLead1 = screen.getByTestId("lead-checkbox-lead-uuid-1");
    fireEvent.click(checkLead1);

    await waitFor(() => {
      const summaryBadge = screen.getByTestId("selection-summary-badge");
      expect(summaryBadge.textContent).toContain("− 1 desmarcado");
      expect(screen.getByText("77.550 selecionados")).toBeInTheDocument();
    });

    // 3. Remarca o lead 1: a exceção DEVE ser removida e o total sobe de volta para 77.551
    fireEvent.click(checkLead1);

    await waitFor(() => {
      const summaryBadge = screen.getByTestId("selection-summary-badge");
      expect(summaryBadge.textContent).not.toContain("desmarcado");
      expect(summaryBadge.textContent).toContain("77.551 leads");
      expect(screen.getByText("77.551 selecionados")).toBeInTheDocument();
    });
  });

  it("[REGRA 1.3] trocar o filtro limpa a seleção por critério e emite aviso em tela", async () => {
    renderBanco();

    await waitFor(() => {
      expect(screen.getByText("Lead Empresa 1")).toBeInTheDocument();
    });

    // Ativa seleção por critério
    const headerCheckbox = screen.getByTestId("header-select-all-checkbox");
    fireEvent.click(headerCheckbox);

    const btnSelectAllCriterion = await screen.findByTestId("btn-select-all-criterion");
    fireEvent.click(btnSelectAllCriterion);

    await waitFor(() => {
      expect(screen.getByTestId("selection-summary-badge")).toBeInTheDocument();
    });

    // Muda o filtro digitando na busca
    const searchInput = screen.getByPlaceholderText(/Buscar por nome/i);
    fireEvent.change(searchInput, { target: { value: "odontologia" } });

    // A seleção por critério anterior DEVE ser limpa e avisada por toast.info
    await waitFor(() => {
      expect(toast.info).toHaveBeenCalledWith(
        expect.stringContaining("Filtro alterado: a seleção por critério anterior foi limpa")
      );
    });

    // O badge de seleção por critério não deve mais existir
    expect(screen.queryByTestId("selection-summary-badge")).toBeNull();
  });

  it("[REGRA 1.4] handoff repassa critério leve (< 1 KB) e exceções sem serializar array de 77.551 IDs", async () => {
    renderBanco();

    await waitFor(() => {
      expect(screen.getByText("Lead Empresa 1")).toBeInTheDocument();
    });

    // Ativa seleção por critério
    const headerCheckbox = screen.getByTestId("header-select-all-checkbox");
    fireEvent.click(headerCheckbox);

    const btnSelectAllCriterion = await screen.findByTestId("btn-select-all-criterion");
    fireEvent.click(btnSelectAllCriterion);

    // Desmarca 2 leads
    const checkLead1 = screen.getByTestId("lead-checkbox-lead-uuid-1");
    const checkLead2 = screen.getByTestId("lead-checkbox-lead-uuid-2");
    fireEvent.click(checkLead1);
    fireEvent.click(checkLead2);

    await waitFor(() => {
      expect(screen.getByTestId("selection-summary-badge")).toHaveTextContent("− 2 desmarcados");
    });

    // Clica em "Criar campanha" na barra de ações (abre o modal de opções de campanha)
    const btnCreateCampaign = screen.getByTestId("btn-create-campaign");
    fireEvent.click(btnCreateCampaign);

    // Aguarda o assistente calcular o público da campanha (debounce 250ms + fetch)
    await waitFor(() => {
      expect(screen.getByText(/Lista de Leads Selecionados \(\d+ de \d+\)/i)).not.toHaveTextContent("Lista de Leads Selecionados (0 de 0)");
    }, { timeout: 3000 });

    // No modal aberto, clica em "Avançar para Disparos ➔"
    const btnProceed = await screen.findByTestId("btn-proceed-to-campaign");
    fireEvent.click(btnProceed);

    // Verifica o item salvo no localStorage
    const savedRaw = window.localStorage.getItem("vexo_pending_campaign_audience");
    expect(savedRaw).not.toBeNull();

    const parsed = JSON.parse(savedRaw!);
    expect(parsed.selectionMode).toBe("criterion");
    expect(parsed.totalCount).toBe(TOTAL_FILTER - 2);
    expect(parsed.excludedLeadIds).toEqual(["lead-uuid-1", "lead-uuid-2"]);
    expect(parsed.criteria).toBeDefined();

    // O tamanho do payload deve ser minúsculo (< 1.000 bytes), NUNCA uma lista de 77 mil IDs (> 2 MB)
    expect(savedRaw!.length).toBeLessThan(1000);
  });

  it("[REGRA 1.5] botões não adaptados ficam desabilitados enquanto a seleção for por critério, com motivo visível", async () => {
    renderBanco();

    await waitFor(() => {
      expect(screen.getByText("Lead Empresa 1")).toBeInTheDocument();
    });

    // 1. No estado inicial (sem seleção por critério), botão de exportar está habilitado
    const exportBtnInitial = screen.getByTestId("btn-export-menu");
    expect(exportBtnInitial).not.toBeDisabled();

    // 2. Ativa seleção por critério (77.551)
    const headerCheckbox = screen.getByTestId("header-select-all-checkbox");
    fireEvent.click(headerCheckbox);

    const btnSelectAllCriterion = await screen.findByTestId("btn-select-all-criterion");
    fireEvent.click(btnSelectAllCriterion);

    await waitFor(() => {
      expect(screen.getByTestId("selection-summary-badge")).toBeInTheDocument();
    });

    const expectedReason = "Disponível na próxima versão para seleção por filtro";

    // 3. Botão Exportar leads no header deve estar desabilitado com o motivo
    const exportBtn = screen.getByTestId("btn-export-menu");
    expect(exportBtn).toBeDisabled();
    expect(exportBtn).toHaveAttribute("title", expectedReason);

    // 4. Botão "Aplicar Follow-up" no header deve estar desabilitado com o motivo
    const followupBtn = screen.getByRole("button", { name: /Aplicar Follow-up/i });
    expect(followupBtn).toBeDisabled();
    expect(followupBtn).toHaveAttribute("title", expectedReason);

    // 5. Botão "Lembrete avulso" no header deve estar desabilitado com o motivo
    const reminderBtn = screen.getByRole("button", { name: /Lembrete avulso/i });
    expect(reminderBtn).toBeDisabled();
    expect(reminderBtn).toHaveAttribute("title", expectedReason);

    // 6. Botões da barra flutuante de ações em lote: Comprador, Perdido, Estágio, Tag
    const buyerBtn = screen.getByTestId("btn-floating-buyer");
    expect(buyerBtn).toBeDisabled();
    expect(buyerBtn).toHaveAttribute("title", expectedReason);

    const lostBtn = screen.getByTestId("btn-floating-lost");
    expect(lostBtn).toBeDisabled();
    expect(lostBtn).toHaveAttribute("title", expectedReason);

    const stageBtn = screen.getByTestId("btn-floating-stage");
    expect(stageBtn).toBeDisabled();
    expect(stageBtn).toHaveAttribute("title", expectedReason);

    const tagBtn = screen.getByTestId("btn-floating-tag");
    expect(tagBtn).toBeDisabled();
    expect(tagBtn).toHaveAttribute("title", expectedReason);

    // 7. O botão "Criar campanha" CONTINUA HABILITADO (foi o único adaptado no Bloco 1)
    const createCampaignBtn = screen.getByTestId("btn-create-campaign");
    expect(createCampaignBtn).not.toBeDisabled();
  });
});
