import { describe, expect, it, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";

import BancoDeDados from "@/pages/BancoDeDados";
import ApplyFollowupModal, { type LeadForFollowup } from "@/components/followup/ApplyFollowupModal";

const mockTenant = {
  id: "sonhare",
  name: "Sonhare",
  plan_tier: "avancado",
  ticket_medio: 1000,
  modulos_avulsos: [],
  n8n_settings: {
    chatbot_enabled: true,
    chatbot_model: "generico",
    chatbot_llm_model: "openai/gpt-oss-120b",
    evolution_instances: [{ name: "Instancia-1", active: true, id: "inst-1" }],
  },
};

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    clientId: "sonhare",
    isInternalUser: true,
    isAuthenticated: true,
    isAdminUser: true,
    canAccessInternalPage: () => true,
    canAccessView: () => true,
    getIdToken: async () => "mock-token",
  }),
}));

const mockCrmClient = {
  selectedClientId: "sonhare",
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

const mockLeads = [
  {
    id: "lead-1",
    client_id: "sonhare",
    nome: "Lead Nunca Abordado",
    stage: "lead",
    telefone: "5511999990001",
    phone: "5511999990001",
    raw_chat_summary: null,
    created_at: new Date().toISOString(),
    dados: {},
  },
  {
    id: "lead-2",
    client_id: "sonhare",
    nome: "Lead Em Conversa",
    stage: "lead",
    telefone: "5511999990002",
    phone: "5511999990002",
    raw_chat_summary: "Cliente interessado em automação",
    created_at: new Date().toISOString(),
    dados: {},
  },
  {
    id: "lead-3",
    client_id: "sonhare",
    nome: "Lead Em Negociacao",
    stage: "open_budget",
    status: "orcamento",
    telefone: null,
    phone: null,
    raw_chat_summary: null,
    created_at: new Date().toISOString(),
    dados: {},
  },
];

const mockSummary = {
  totalLeads: 3,
  buyersCount: 0,
  lostCount: 0,
  neverContactedCount: 1,
  inConversationCount: 1,
  inNegotiationCount: 1,
  activeLeadsCount: 3,
};

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MemoryRouter initialEntries={["/crm/banco-de-dados"]}>
          {ui}
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const leadListUrls: string[] = [];

describe("Banco de Dados — Filtro de Faixas do Potencial da Base", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    leadListUrls.length = 0;

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = String(url);
      // O servidor é quem filtra (SQL): o mock devolve o que o servidor devolveria para cada pedido e registra as URLs
      if (urlStr.includes("/api/leads/facets")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            summary: mockSummary,
            baseTotal: 3,
            channels: { nao_identificada: 3 },
            sources: [{ source: "Não informado", count: 3 }],
            tags: [],
            stagesExact: { buyer: 0, open_budget: 1, inquiry: 0, cold: 0, lost: 0, other: 2 },
          }),
          text: async () => "",
        } as any;
      }
      if (urlStr.includes("/api/leads/ids")) {
        const onlyNever = new URL(urlStr, "http://x").searchParams.get("segment") === "never_contacted";
        const picked = onlyNever ? [mockLeads[0]] : mockLeads;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ids: picked.map((l) => l.id),
            total: picked.length,
            truncated: false,
            contacts: picked.map((l) => ({ id: l.id, nome: l.nome, telefone: l.telefone, phone: l.phone })),
          }),
          text: async () => "",
        } as any;
      }
      if (urlStr.includes("/api/leads?")) {
        leadListUrls.push(urlStr);
        const onlyNever = new URL(urlStr, "http://x").searchParams.get("segment") === "never_contacted";
        const picked = onlyNever ? [mockLeads[0]] : mockLeads;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            items: picked,
            total: picked.length,
            page: 1,
            limit: 50,
            totalPages: 1,
            tabs: { all: picked.length, buyer: 0, open_budget: 1, cold: 2, lost: 0 },
            degraded: false,
          }),
          text: async () => "",
        } as any;
      }
      if (urlStr.includes("/evolution-instances")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ items: [] }),
          text: async () => "",
        } as any;
      }
      if (urlStr.includes("/api/followup/companies")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ companies: [{ id: "comp-1", name: "Empresa Teste", activeCampaigns: 1 }] }),
          text: async () => "",
        } as any;
      }
      if (urlStr.includes("/api/followup/campaigns")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ campaigns: [{ id: "cad-1", name: "Cadência Reativação", status: "active" }] }),
          text: async () => "",
        } as any;
      }
      if (urlStr.includes("/api/followup/templates")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ templates: [] }),
          text: async () => "",
        } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ items: [] }),
        text: async () => "",
      } as any;
    });
  });

  it("renderiza os leads nas 3 faixas, filtra ao clicar em 'Nunca abordados', seleciona em massa e remove o filtro", async () => {
    renderWithProviders(<BancoDeDados />);

    // 1. Aguarda carregamento inicial e verifica que os 3 leads estão presentes
    expect(await screen.findByText("Lead Nunca Abordado")).toBeInTheDocument();
    expect(screen.getByText("Lead Em Conversa")).toBeInTheDocument();
    expect(screen.getByText("Lead Em Negociacao")).toBeInTheDocument();

    // Verifica que o card 'Nunca abordados' na legenda está presente
    const neverContactedLegendText = screen.getByText(/Nunca abordados · 1/i);
    expect(neverContactedLegendText).toBeInTheDocument();

    // 2. Clica no card 'Nunca abordados' para ativar o filtro de faixa
    const neverContactedCard = neverContactedLegendText.closest("div.cursor-pointer");
    expect(neverContactedCard).not.toBeNull();
    fireEvent.click(neverContactedCard!);

    // Valida que o card agora possui o badge 'Ativo'
    await waitFor(() => {
      expect(screen.getByText("Ativo")).toBeInTheDocument();
    });

    // A faixa é filtro do SERVIDOR: a tela pediu a página com segment=never_contacted e mostra só o que veio
    await waitFor(() => {
      expect(leadListUrls.some((u) => u.includes("segment=never_contacted"))).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByText("Lead Em Conversa")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Lead Nunca Abordado")).toBeInTheDocument();
    expect(screen.queryByText("Lead Em Negociacao")).not.toBeInTheDocument();

    // Valida o chip de filtro ativo com o nome da faixa
    expect(screen.getByText("Nunca abordados")).toBeInTheDocument();

    // Valida o botão de ação rápida 'Selecionar todos desta faixa (1)'
    const selectAllButton = screen.getByRole("button", {
      name: /Selecionar todos desta faixa \(1\)/i,
    });
    expect(selectAllButton).toBeInTheDocument();

    // 3. Clica no botão 'Selecionar todos desta faixa'
    fireEvent.click(selectAllButton);

    // Valida que a ação em massa 'Aplicar Follow-up (1)' é exibida
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Aplicar Follow-up \(1\)/i })).toBeInTheDocument();
    });

    // 4. Remove o filtro clicando no botão X do chip de faixa
    const removeSegmentButton = screen.getByTitle("Remover filtro de faixa");
    expect(removeSegmentButton).toBeInTheDocument();
    fireEvent.click(removeSegmentButton);

    // Valida que o filtro foi desativado e todos os 3 leads voltam a ser exibidos
    await waitFor(() => {
      expect(screen.queryByTitle("Remover filtro de faixa")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Lead Nunca Abordado")).toBeInTheDocument();
    expect(screen.getByText("Lead Em Conversa")).toBeInTheDocument();
    expect(screen.getByText("Lead Em Negociacao")).toBeInTheDocument();
  });

  it("ApplyFollowupModal exibe prévia correta de WhatsApp válido vs sem telefone", () => {
    const leadsForModal: LeadForFollowup[] = [
      { id: "lead-1", nome: "Lead Com WhatsApp 1", phone: "5511999990001" },
      { id: "lead-2", nome: "Lead Com WhatsApp 2", telefone: "5511999990002" },
      { id: "lead-3", nome: "Lead Sem Telefone", phone: null, telefone: null },
    ];

    render(
      <ApplyFollowupModal
        open={true}
        onOpenChange={vi.fn()}
        clientId="sonhare"
        leads={leadsForModal}
        apiBase="http://localhost:3000"
        getToken={async () => "mock-token"}
      />
    );

    // Valida contagem no banner informativo
    expect(
      screen.getByText((_, el) => el?.tagName.toLowerCase() === "span" && el?.textContent?.includes("2 de 3 leads com WhatsApp válido") || false)
    ).toBeInTheDocument();
    expect(screen.getByText(/1 sem telefone \(serão pulados\)/i)).toBeInTheDocument();
  });

  it("ApplyFollowupModal não exibe badge de aviso quando todos os leads têm telefone válido", () => {
    const leadsAllValid: LeadForFollowup[] = [
      { id: "lead-1", nome: "Lead 1", phone: "5511999990001" },
      { id: "lead-2", nome: "Lead 2", telefone: "5511999990002" },
    ];

    render(
      <ApplyFollowupModal
        open={true}
        onOpenChange={vi.fn()}
        clientId="sonhare"
        leads={leadsAllValid}
        apiBase="http://localhost:3000"
        getToken={async () => "mock-token"}
      />
    );

    expect(
      screen.getByText((_, el) => el?.tagName.toLowerCase() === "span" && el?.textContent?.includes("2 de 2 leads com WhatsApp válido") || false)
    ).toBeInTheDocument();
    expect(screen.queryByText(/sem telefone/i)).not.toBeInTheDocument();
  });
});
