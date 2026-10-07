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

  global.fetch = vi.fn(async (url: string | URL | Request, init?: any) => {
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

    if (u.pathname === "/api/leads/bulk-update") {
      let body: any = {};
      try {
        body = typeof init?.body === "string" ? JSON.parse(init.body) : ((url as any)?.body ? JSON.parse((url as any).body) : {});
      } catch {}
      const affected = body.criteria ? totalCount - (body.excludedLeadIds?.length || 0) : (body.leadIds?.length || 0);
      return jsonResponse({
        success: true,
        updatedCount: affected,
      });
    }

    if (u.pathname === "/api/leads/bulk-delete") {
      let body: any = {};
      try {
        body = typeof init?.body === "string" ? JSON.parse(init.body) : ((url as any)?.body ? JSON.parse((url as any).body) : {});
      } catch {}
      const affected = body.criteria ? totalCount - (body.excludedLeadIds?.length || 0) : (body.leadIds?.length || 0);
      return jsonResponse({
        success: true,
        deletedCount: affected,
      });
    }

    if (u.pathname === "/api/followup/companies") {
      return jsonResponse({
        companies: [{ id: "comp-1", name: "Empresa Followup 1" }],
      });
    }

    if (u.pathname === "/api/followup/campaigns") {
      return jsonResponse({
        campaigns: [{ id: "camp-1", name: "Cadência Principal", status: "active" }],
      });
    }

    if (u.pathname === "/api/followup/templates") {
      return jsonResponse({
        templates: [
          {
            id: "tpl-1",
            name: "Passo 1 Boas-vindas",
            message: "Olá lead",
            trigger_type: "delay",
            trigger_value: 0,
            trigger_unit: "minutes",
            order_index: 0,
          },
        ],
      });
    }

    if (u.pathname.includes("/upcoming")) {
      return jsonResponse({
        days: [
          { dayKey: "2026-10-08", dateFormatted: "08/10", dayOfWeek: "Qui", count: 10, limit: 200 },
        ],
        chipLimit: 200,
      });
    }

    if (u.pathname.includes("/enroll")) {
      let body: any = {};
      try {
        body = typeof init?.body === "string" ? JSON.parse(init.body) : ((url as any)?.body ? JSON.parse((url as any).body) : {});
      } catch {}
      const affected = body.criteria ? totalCount - (body.excludedLeadIds?.length || 0) : (body.leads?.length || 0);
      return jsonResponse({
        success: true,
        count: affected,
        enrolled: affected,
        enqueued: affected,
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

  it("[REGRA 1.5] botões adaptados na Fase 2A/2B ficam habilitados e lembrete avulso exige lead único com motivo visível", async () => {
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

    // 3. Botão Exportar leads no header continua HABILITADO na Fase 2A
    const exportBtn = screen.getByTestId("btn-export-menu");
    expect(exportBtn).not.toBeDisabled();

    // 4. Botão "Aplicar Follow-up" no header agora está HABILITADO na Fase 2B
    const followupBtn = screen.getByRole("button", { name: /Aplicar Follow-up/i });
    expect(followupBtn).not.toBeDisabled();

    // 5. Botão "Lembrete avulso" no header fica desabilitado para seleções != 1 com tooltip explicativo
    const reminderBtn = screen.getByRole("button", { name: /Lembrete avulso/i });
    expect(reminderBtn).toBeDisabled();
    expect(reminderBtn).toHaveAttribute(
      "title",
      "O lembrete avulso é individual. Para múltiplos leads ou filtros, utilize 'Aplicar follow-up'."
    );

    // 6. Botões da barra flutuante destravados na Fase 2A: Comprador, Perdido, Estágio, Tag
    const buyerBtn = screen.getByTestId("btn-floating-buyer");
    expect(buyerBtn).not.toBeDisabled();

    const lostBtn = screen.getByTestId("btn-floating-lost");
    expect(lostBtn).not.toBeDisabled();

    const stageBtn = screen.getByTestId("btn-floating-stage");
    expect(stageBtn).not.toBeDisabled();

    const tagBtn = screen.getByTestId("btn-floating-tag");
    expect(tagBtn).not.toBeDisabled();

    // 7. O botão "Criar campanha" CONTINUA HABILITADO
    const createCampaignBtn = screen.getByTestId("btn-create-campaign");
    expect(createCampaignBtn).not.toBeDisabled();
  });

  it("[FASE 2A] ação em lote por critério dispara bulk-update com criteria, excludedLeadIds e exibe contagem dinâmica", async () => {
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

    // 2. Desmarca 1 lead como exceção (cai para 77.550)
    const checkLead1 = screen.getByTestId("lead-checkbox-lead-uuid-1");
    fireEvent.click(checkLead1);

    await waitFor(() => {
      expect(screen.getByTestId("selection-summary-badge")).toHaveTextContent("− 1 desmarcado");
    });

    // 3. Clica em Comprador na barra flutuante
    const buyerBtn = screen.getByTestId("btn-floating-buyer");
    fireEvent.click(buyerBtn);

    // 4. Modal de confirmação abre exibindo a contagem dinâmica (77.550 leads)
    expect(await screen.findByText(/Confirmar fechamento de negócio para os 77\.550 leads selecionados/)).toBeInTheDocument();

    // 5. Clica em "Confirmar Cliente 🟢"
    const confirmBtn = screen.getByRole("button", { name: /Confirmar Cliente/i });
    fireEvent.click(confirmBtn);

    // 6. Confirma que a API foi chamada com criteria e excludedLeadIds
    await waitFor(() => {
      const bulkCalls = (global.fetch as any).mock.calls.filter(([url]: [string]) => String(url).includes("/api/leads/bulk-update"));
      expect(bulkCalls.length).toBeGreaterThan(0);
      const [, init] = bulkCalls[0];
      const parsedBody = JSON.parse(init.body);
      expect(parsedBody.criteria).toBeDefined();
      expect(parsedBody.excludedLeadIds).toEqual(["lead-uuid-1"]);
      expect(parsedBody.updates).toEqual({
        stage: "buyer",
        stage_source: "manual",
        potential_contract_value: null,
      });
    });

    // 7. Toast de sucesso exibe o total dinâmico
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("77.550 leads marcados como Cliente!"));
    });
  });

  it("[FASE 2B] modal de exclusão exige a palavra 'EXCLUIR' quando a contagem dinâmica for superior a 500 e dispara bulk-delete leve", async () => {
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

    // 2. Desmarca 1 lead (77.550 leads)
    const checkLead1 = screen.getByTestId("lead-checkbox-lead-uuid-1");
    fireEvent.click(checkLead1);

    await waitFor(() => {
      expect(screen.getByTestId("selection-summary-badge")).toHaveTextContent("− 1 desmarcado");
    });

    // 3. Abre o menu Mais ações da barra flutuante
    const moreBtn = screen.getByTestId("btn-floating-more");
    fireEvent.keyDown(moreBtn, { key: "Enter" });

    // 4. Clica em "Excluir"
    const deleteMenuItem = await screen.findByTestId("btn-floating-delete");
    fireEvent.click(deleteMenuItem);

    // 5. Diálogo de exclusão deve abrir com título dinâmico "Excluir 77.550 leads"
    expect(await screen.findByText(/Excluir 77\.550 leads/i)).toBeInTheDocument();
    expect(screen.getByText(/Esta ação é permanente e irreversível/i)).toBeInTheDocument();

    // 6. Como 77.550 > 500, o botão de exclusão permanente deve estar desabilitado até digitar "EXCLUIR"
    const confirmDeleteBtn = screen.getByTestId("btn-confirm-bulk-delete");
    expect(confirmDeleteBtn).toBeDisabled();

    // Digita texto incorreto (minúsculo)
    const confirmInput = screen.getByTestId("input-delete-confirmation");
    fireEvent.change(confirmInput, { target: { value: "excluir" } });
    expect(confirmDeleteBtn).toBeDisabled();

    // Digita exatamente "EXCLUIR"
    fireEvent.change(confirmInput, { target: { value: "EXCLUIR" } });
    expect(confirmDeleteBtn).not.toBeDisabled();

    // 7. Clica para excluir permanentemente
    fireEvent.click(confirmDeleteBtn);

    // 8. Confirma que a rota POST /api/leads/bulk-delete foi chamada com criteria, excludedLeadIds e confirmation
    await waitFor(() => {
      const deleteCalls = (global.fetch as any).mock.calls.filter(([url]: [string]) =>
        String(url).includes("/api/leads/bulk-delete")
      );
      expect(deleteCalls.length).toBeGreaterThan(0);
      const [, init] = deleteCalls[0];
      const parsedBody = JSON.parse(init.body);
      expect(parsedBody.criteria).toBeDefined();
      expect(parsedBody.excludedLeadIds).toEqual(["lead-uuid-1"]);
      expect(parsedBody.confirmation).toBe("EXCLUIR");
    });

    // 9. Toast exibe confirmação dinâmica de exclusão
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("77.550 leads excluídos com sucesso!")
      );
    });
  });

  it("[FASE 2B] modal de aplicar follow-up projeta contagem dinâmica, exibe alerta anti-ban quando > cota diária e envia payload por critério", async () => {
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

    // 2. Desmarca 2 leads (77.549)
    const checkLead1 = screen.getByTestId("lead-checkbox-lead-uuid-1");
    const checkLead2 = screen.getByTestId("lead-checkbox-lead-uuid-2");
    fireEvent.click(checkLead1);
    fireEvent.click(checkLead2);

    await waitFor(() => {
      expect(screen.getByTestId("selection-summary-badge")).toHaveTextContent("− 2 desmarcados");
    });

    // 3. Abre o modal "Aplicar Follow-up" clicando no botão do header
    const followupBtn = screen.getByRole("button", { name: /Aplicar Follow-up \(77\.549\)/i });
    fireEvent.click(followupBtn);

    // 4. O modal deve abrir com a contagem projetada de 77.549 leads
    expect(await screen.findByText(/Proteção Anti-Ban do WhatsApp/i)).toBeInTheDocument();
    expect(screen.getByText("Filtro dinâmico")).toBeInTheDocument();
    expect(screen.getByText(/Inscrever 77\.549 lead\(s\)/i)).toBeInTheDocument();

    // 5. Verifica se o alerta de Proteção Anti-Ban está visível (77.549 > chipLimit de 200)
    // Math.ceil(77549 / 200) = 388 dias
    expect(screen.getByText(/este número tem um teto seguro de/i)).toBeInTheDocument();
    expect(screen.getByText(/388 dias/i)).toBeInTheDocument();

    // 6. Confirma o envio clicando no botão de submissão do modal
    const submitBtn = screen.getByRole("button", { name: /Aplicar a 77\.549 lead\(s\)/i });
    fireEvent.click(submitBtn);

    // 7. Confirma que POST /api/followup/campaigns/camp-1/enroll foi disparado com criteria e excludedLeadIds
    await waitFor(() => {
      const enrollCalls = (global.fetch as any).mock.calls.filter(([url]: [string]) =>
        String(url).includes("/enroll")
      );
      expect(enrollCalls.length).toBeGreaterThan(0);
      const [, init] = enrollCalls[0];
      const parsedBody = JSON.parse(init.body);
      expect(parsedBody.criteria).toBeDefined();
      expect(parsedBody.excludedLeadIds).toEqual(["lead-uuid-1", "lead-uuid-2"]);
      expect(parsedBody.origin).toBe("banco_dados");
    });

    // 8. Toast de sucesso confirma a inscrição dinâmica
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("77.549 leads inscritos na cadência!")
      );
    });
  });

  it("[TAG EM LOTE] remoção de tag por critério dispara bulk-update com removeTag e excludedLeadIds", async () => {
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

    // 2. Desmarca 1 lead (77.550 leads)
    const checkLead1 = screen.getByTestId("lead-checkbox-lead-uuid-1");
    fireEvent.click(checkLead1);

    await waitFor(() => {
      expect(screen.getByTestId("selection-summary-badge")).toHaveTextContent("− 1 desmarcado");
    });

    // 3. Clica no botão Tag na barra flutuante
    const tagBtn = screen.getByTestId("btn-floating-tag");
    fireEvent.click(tagBtn);

    // 4. Modal de gerenciamento de tags abre com título dinâmico
    expect(await screen.findByText(/Gerenciar Tags em Lote \(77\.550 leads\)/i)).toBeInTheDocument();

    // 5. Clica na aba "Remover Tag"
    const removeTab = screen.getByTestId("tab-remove-tag");
    fireEvent.click(removeTab);

    // Verifica que o input da aba de remoção e o aviso aparecem
    expect(await screen.findByTestId("input-bulk-tag-remove")).toBeInTheDocument();
    expect(
      screen.getByText(/apenas a tag indicada será desvinculada/i)
    ).toBeInTheDocument();

    // 6. Preenche a tag a ser removida
    const removeInput = screen.getByTestId("input-bulk-tag-remove");
    fireEvent.change(removeInput, { target: { value: "#Imp-Campanha_Teste_1_2_x" } });

    // 7. Confirma a remoção clicando no botão destrutivo
    const submitBtn = screen.getByTestId("btn-submit-bulk-tag");
    expect(submitBtn.textContent).toContain("Remover Tag de 77.550 leads");
    fireEvent.click(submitBtn);

    // 8. Confirma que a API foi chamada com updates: { removeTag: ... }, criteria e excludedLeadIds
    await waitFor(() => {
      const bulkCalls = (global.fetch as any).mock.calls.filter(([url]: [string]) =>
        String(url).includes("/api/leads/bulk-update")
      );
      expect(bulkCalls.length).toBeGreaterThan(0);
      const [, init] = bulkCalls[0];
      const parsedBody = JSON.parse(init.body);
      expect(parsedBody.criteria).toBeDefined();
      expect(parsedBody.excludedLeadIds).toEqual(["lead-uuid-1"]);
      expect(parsedBody.updates).toEqual({
        removeTag: "#Imp-Campanha_Teste_1_2_x",
      });
    });

    // 9. Toast de sucesso exibe o total dinâmico e nome da tag
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining('Tag "#Imp-Campanha_Teste_1_2_x" removida de 77.550 leads!')
      );
    });
  });
});



