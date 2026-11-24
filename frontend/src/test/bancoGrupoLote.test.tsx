// Grupo e lote direto do Banco (24/11/2026): com um filtro na tela, "Etiquetar os N" põe a tag em todos do filtro de uma vez
// e "Separar lote deste filtro" abre o Separar lotes com o filtro como origem. Pedido do Conrado: montar grupo e lote sem
// exportar para o Excel. Mocks iguais aos de bancoTagQuickAction.test.tsx.

import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import BancoDeDados from "@/pages/BancoDeDados";

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

// getIdToken estável, como no AuthContext de verdade: uma função nova a cada render faria o Separar lotes recarregar sem parar.
const authFixo = vi.hoisted(() => ({ getIdToken: async () => "mock-token" }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    clientId: "tenant-test",
    isInternalUser: true,
    isAuthenticated: true,
    isAdminUser: true,
    canAccessInternalPage: () => true,
    canAccessView: () => true,
    getIdToken: authFixo.getIdToken,
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

function setupFetchMock(customLeads?: any[]) {
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
      const mockLeadList = customLeads || [
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
      ];
      return jsonResponse({
        items: mockLeadList,
        leads: mockLeadList,
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


async function filtrarPorBusca(texto: string) {
  const busca = await screen.findByPlaceholderText("Buscar por nome, fone, tag...");
  fireEvent.change(busca, { target: { value: texto } });
  return screen.findByTestId("btn-etiquetar-filtro", {}, { timeout: 3000 });
}

const chamadas = (trecho: string) =>
  (global.fetch as any).mock.calls.filter((c: any[]) => String(c[0]).includes(trecho));

describe("grupo e lote direto do filtro do Banco", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sem filtro, os botões não aparecem", async () => {
    setupFetchMock();
    renderBanco();
    await screen.findByText("Lead Teste 1");
    expect(screen.queryByTestId("btn-etiquetar-filtro")).not.toBeInTheDocument();
    expect(screen.queryByTestId("btn-lote-do-filtro")).not.toBeInTheDocument();
  });

  it("'Etiquetar os N' põe a tag em todos do filtro de uma vez, pelo critério (sem lista de ids)", async () => {
    setupFetchMock();
    renderBanco();
    const botao = await filtrarPorBusca("Cliente");
    expect(botao).toHaveTextContent("Etiquetar os 150");
    fireEvent.click(botao);
    const input = await screen.findByTestId("input-bulk-tag");
    fireEvent.change(input, { target: { value: "Clientes CL" } });
    fireEvent.click(screen.getByTestId("btn-submit-bulk-tag"));
    await waitFor(() => expect(chamadas("/api/leads/bulk-update").length).toBe(1));
    const corpo = JSON.parse(chamadas("/api/leads/bulk-update")[0][1].body);
    expect(corpo.updates).toEqual({ addTag: "Clientes CL" });
    expect(corpo.criteria).toMatchObject({ search: "Cliente" });
    expect(corpo.leadIds).toBeUndefined();
  });

  it("'Separar lote deste filtro' abre o Separar lotes com o filtro da tela como origem", async () => {
    setupFetchMock();
    renderBanco();
    await filtrarPorBusca("Cliente");
    fireEvent.click(screen.getByTestId("btn-lote-do-filtro"));
    await waitFor(() => expect(chamadas("/api/leads/lotes/previa").length).toBeGreaterThan(0));
    const url = new URL(String(chamadas("/api/leads/lotes/previa").at(-1)[0]), "http://localhost");
    const origem = JSON.parse(url.searchParams.get("origem") || "null");
    expect(origem).toMatchObject({ tipo: "filtro", filtro: { search: "Cliente" } });
  });
});
