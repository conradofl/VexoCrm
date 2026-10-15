// frontend/src/test/cardHeaderExpand.test.tsx
//
// Testes do BLOCO 4 — Cabeçalho do cartão expansível ao clicar ou via teclado

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Campaign } from "@/hooks/useCampanhas";

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const getIdTokenMock = async () => "token";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    getIdToken: getIdTokenMock,
    isAuthenticated: true,
    clientId: "sonhare",
    accessProfile: { role: "client" },
  }),
}));

const navigateMock = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useNavigate: () => navigateMock,
    useLocation: () => ({ pathname: "/campanhas", search: "" }),
  };
});

const defaultFetchRes = {
  ok: true,
  status: 200,
  json: async () => ({ success: true, data: [] }),
  blob: async () => new Blob(),
};

const fetchApiMock = vi.fn().mockImplementation(() => Promise.resolve(defaultFetchRes));
vi.mock("@/lib/api", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    fetchApi: (...args: any[]) => fetchApiMock(...args),
  };
});

const defaultSummaryData = {
  isLoading: false,
  data: {
    campaigns: [],
    counts: { active: 0, ended: 0 },
    scope: "active",
    page: 1,
    pageSize: 10,
    totalForScope: 0,
    kpis: { periodLabel: "30d", campaigns: 0, leads: 0, sent: 0, deliveryRate: 0 },
  },
};
const bulkActionMutate = vi.fn();
const summaryMockFn = vi.fn().mockImplementation(() => defaultSummaryData);

vi.mock("@/hooks/useCampanhas", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useDispatchSummary: (clientId: string | null, scope: string = "active") => summaryMockFn(scope),
    useCampaignDispatchBulkAction: () => ({
      mutate: bulkActionMutate,
      isPending: false,
    }),
  };
});

vi.mock("@/hooks/useEvolutionInstances", () => ({
  useEvolutionInstances: () => ({ data: [], isLoading: false }),
}));

function makeCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "camp-header-1",
    name: "Campanha Header Expand",
    client_id: "sonhare",
    client_name: "Cliente Teste",
    import_id: "imp-1",
    limit_per_run: 50,
    webhook_url: "",
    webhook_token: null,
    status: "active",
    scheduled_for: null,
    last_triggered_at: null,
    archived_at: null,
    created_by_uid: null,
    created_by_email: null,
    created_at: "2026-09-15T10:00:00Z",
    mode: "agente",
    starts_at: null,
    ends_at: null,
    chatbot_prompt_type: "default",
    campaign_prompt_id: null,
    ...overrides,
  };
}

function makeDispatch(overrides: any = {}) {
  return {
    campaignId: "disp-header-1",
    campaignName: "Fila Header Expand",
    chipName: "Chip Principal",
    loteCount: 2,
    leadsTotal: 100,
    leadsPending: 20,
    sentTotal: 70,
    failedTotal: 10,
    repliedCount: 15,
    status: "em_andamento",
    statusLabel: "Em andamento",
    nextScheduledAt: null,
    dispatches: [],
    batches: [],
    leadsActionable: { pause: 10, resume: 0, cancel: 0 },
    ...overrides,
  };
}

describe("BLOCO 4 — Clicar no card abre (cardHeaderExpand)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a) Clique no corpo/texto do cabeçalho do card de campanha alterna isExpanded", async () => {
    const { CampaignsTable } = await import("@/pages/LeadImports/CampaignsTable");
    const camp = makeCampaign({ id: "camp-expand-a", name: "Campanha Clique" });

    renderWithProviders(
      <CampaignsTable
        clientId="sonhare"
        campaigns={[camp]}
        loadingCampaigns={false}
        onEditCampaign={vi.fn()}
        onDuplicateCampaign={vi.fn()}
        onDeleteCampaign={vi.fn()}
      />
    );

    const header = screen.getByTestId("campaign-card-header-camp-expand-a");
    const nameText = screen.getByTestId("campaign-name-camp-expand-a");

    // Inicialmente fechado
    expect(screen.queryByTestId("campaign-details-camp-expand-a")).not.toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "false");

    // Clique no texto do cabeçalho abre
    fireEvent.click(nameText);
    expect(screen.getByTestId("campaign-details-camp-expand-a")).toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "true");

    // Clique novamente no cabeçalho fecha
    fireEvent.click(header);
    expect(screen.queryByTestId("campaign-details-camp-expand-a")).not.toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("b) Clique no cabeçalho do card da Fila de Envios alterna isExpanded", async () => {
    const d = makeDispatch({ campaignId: "disp-expand-b", campaignName: "Fila Clique" });
    summaryMockFn.mockReturnValue({
      isLoading: false,
      data: {
        campaigns: [d],
        counts: { active: 1, ended: 0 },
        scope: "active",
        page: 1,
        pageSize: 10,
        totalForScope: 1,
        kpis: { periodLabel: "30d", campaigns: 1, leads: 100, sent: 70, deliveryRate: 70 },
      },
    });

    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);

    const header = screen.getByTestId("dispatch-card-header-disp-expand-b");
    const nameText = screen.getByTestId("dispatch-name-disp-expand-b");

    // Inicialmente fechado
    expect(screen.queryByTestId("dispatch-details-disp-expand-b")).not.toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "false");

    // Clique no texto do cabeçalho abre
    fireEvent.click(nameText);
    expect(screen.getByTestId("dispatch-details-disp-expand-b")).toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "true");

    // Clique novamente no cabeçalho fecha
    fireEvent.click(header);
    expect(screen.queryByTestId("dispatch-details-disp-expand-b")).not.toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("c) Clique em botão de ação interno (ex: Excluir em Campanhas ou Pausar na Fila) NÃO dispara toggle do cabeçalho", async () => {
    // 1. Em CampaignsTable:
    const onDelete = vi.fn();
    const { CampaignsTable } = await import("@/pages/LeadImports/CampaignsTable");
    const camp = makeCampaign({ id: "camp-btn-c", name: "Campanha Ação" });

    const { unmount } = renderWithProviders(
      <CampaignsTable
        clientId="sonhare"
        campaigns={[camp]}
        loadingCampaigns={false}
        onEditCampaign={vi.fn()}
        onDuplicateCampaign={vi.fn()}
        onDeleteCampaign={onDelete}
      />
    );

    const campHeader = screen.getByTestId("campaign-card-header-camp-btn-c");
    // Abre clicando no cabeçalho
    fireEvent.click(campHeader);
    expect(screen.getByTestId("campaign-details-camp-btn-c")).toBeInTheDocument();

    // Localiza botão Excluir e clica
    const deleteBtn = screen.getByTitle("Excluir");
    fireEvent.click(deleteBtn);
    expect(onDelete).toHaveBeenCalledWith(camp);
    // Card permanece ABERTO (não fechou com o clique no botão)
    expect(screen.getByTestId("campaign-details-camp-btn-c")).toBeInTheDocument();

    unmount();

    // 2. Na Fila de Envios:
    const d = makeDispatch({
      campaignId: "disp-btn-c",
      campaignName: "Fila Ação",
      leadsActionable: { pause: 5, resume: 0, cancel: 0 },
    });
    summaryMockFn.mockReturnValue({
      isLoading: false,
      data: {
        campaigns: [d],
        counts: { active: 1, ended: 0 },
        scope: "active",
        page: 1,
        pageSize: 10,
        totalForScope: 1,
        kpis: { periodLabel: "30d", campaigns: 1, leads: 100, sent: 70, deliveryRate: 70 },
      },
    });

    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);

    const dispHeader = screen.getByTestId("dispatch-card-header-disp-btn-c");
    // Abre clicando no cabeçalho
    fireEvent.click(dispHeader);
    expect(screen.getByTestId("dispatch-details-disp-btn-c")).toBeInTheDocument();

    // Clica no botão "Pausar"
    const pauseBtn = screen.getByRole("button", { name: /pausar/i });
    fireEvent.click(pauseBtn);
    // Card permanece ABERTO
    expect(screen.getByTestId("dispatch-details-disp-btn-c")).toBeInTheDocument();
  });

  it("d) Navegação por teclado: focar o cabeçalho e disparar keyDown { key: 'Enter' } ou { key: ' ' } alterna aria-expanded", async () => {
    const { CampaignsTable } = await import("@/pages/LeadImports/CampaignsTable");
    const camp = makeCampaign({ id: "camp-kbd-d", name: "Campanha Teclado" });

    renderWithProviders(
      <CampaignsTable
        clientId="sonhare"
        campaigns={[camp]}
        loadingCampaigns={false}
        onEditCampaign={vi.fn()}
        onDuplicateCampaign={vi.fn()}
        onDeleteCampaign={vi.fn()}
      />
    );

    const header = screen.getByTestId("campaign-card-header-camp-kbd-d");
    expect(header).toHaveAttribute("aria-expanded", "false");

    // Enter abre
    fireEvent.keyDown(header, { key: "Enter" });
    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("campaign-details-camp-kbd-d")).toBeInTheDocument();

    // Espaço fecha
    fireEvent.keyDown(header, { key: " " });
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("campaign-details-camp-kbd-d")).not.toBeInTheDocument();
  });

  it("e) Clique na setinha continua funcionando normalmente sem duplicar evento", async () => {
    const { CampaignsTable } = await import("@/pages/LeadImports/CampaignsTable");
    const camp = makeCampaign({ id: "camp-chevron-e", name: "Campanha Chevron" });

    renderWithProviders(
      <CampaignsTable
        clientId="sonhare"
        campaigns={[camp]}
        loadingCampaigns={false}
        onEditCampaign={vi.fn()}
        onDuplicateCampaign={vi.fn()}
        onDeleteCampaign={vi.fn()}
      />
    );

    const chevronBtn = screen.getByTitle("Ver detalhes");
    expect(screen.queryByTestId("campaign-details-camp-chevron-e")).not.toBeInTheDocument();

    // 1 clique na setinha abre
    fireEvent.click(chevronBtn);
    expect(screen.getByTestId("campaign-details-camp-chevron-e")).toBeInTheDocument();

    // 1 clique na setinha fecha
    fireEvent.click(chevronBtn);
    expect(screen.queryByTestId("campaign-details-camp-chevron-e")).not.toBeInTheDocument();
  });
});
