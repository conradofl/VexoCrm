// frontend/src/test/compactCardsAndStableColor.test.tsx
//
// Testes para a padronização de cartões compactos e cor estável:
// Entrega 1: Campanhas (CampaignsTable) e Fila de Envios (DispatchCampaignTracker)

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import fs from "fs";
import path from "path";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getStableColor } from "@/lib/stableColor";
import { DISPATCH_SQUARE_STYLES } from "@/hooks/useCampanhas";
import type { Campaign } from "@/hooks/useCampanhas";

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const getIdTokenMock = async () => "token";
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ getIdToken: getIdTokenMock }),
}));

// Mock para DispatchCampaignTracker hooks
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

const summaryMockFn = vi.fn().mockReturnValue(defaultSummaryData);
const bulkActionMutate = vi.fn();

vi.mock("@/hooks/useCampanhas", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useDispatchSummary: (clientId: string | null, scope: string = "active") => summaryMockFn(scope),
    useCampaignBulkAction: () => ({
      mutate: bulkActionMutate,
      isPending: false,
    }),
  };
});

function makeCampaignItem(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "camp-alpha",
    name: "Campanha Estética Alpha",
    client_id: "sonhare",
    client_name: "Clínica Alpha",
    import_id: "imp-123",
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

function makeDispatchItem(overrides: any = {}) {
  return {
    campaignId: "dispatch-alpha",
    campaignName: "Campanha Fila Alpha",
    chipName: "Chip 01 - Comercial",
    loteCount: 3,
    leadsTotal: 150,
    leadsPending: 30,
    sentTotal: 100,
    failedTotal: 20,
    repliedCount: 25,
    status: "agendada",
    statusLabel: "Agendada",
    nextScheduledAt: null,
    eta: { isToday: false, weekday: "sex", label: "sexta-feira, por volta das 18h" },
    leadsActionable: { pause: 0, resume: 0, cancel: 30 },
    batches: [
      { id: "b1", status: "done", targetCount: 50, sentCount: 50, failedCount: 0, scheduledFor: null, sentAt: null, errorMessage: null },
      { id: "b2", status: "failed", targetCount: 50, sentCount: 30, failedCount: 20, scheduledFor: null, sentAt: null, errorMessage: null },
      { id: "b3", status: "scheduled", targetCount: 50, sentCount: 0, failedCount: 0, scheduledFor: null, sentAt: null, errorMessage: null },
    ],
    ...overrides,
  };
}

describe("Regras Globais de Cor e Cartão (Entrega 1: Campanhas e Fila)", () => {
  it("[REGRA CONJUNTO 1] nenhuma das telas define paleta própria — todas importam getStableColor", () => {
    const campaignsCode = fs.readFileSync(
      path.resolve(__dirname, "../pages/LeadImports/CampaignsTable.tsx"),
      "utf-8"
    );
    const dispatchCode = fs.readFileSync(
      path.resolve(__dirname, "../pages/LeadImports/DispatchCampaignTracker.tsx"),
      "utf-8"
    );

    // Ambas devem importar getStableColor
    expect(campaignsCode).toContain("getStableColor");
    expect(campaignsCode).toMatch(/from\s+["']@\/lib\/stableColor["']/);

    expect(dispatchCode).toContain("getStableColor");
    expect(dispatchCode).toMatch(/from\s+["']@\/lib\/stableColor["']/);

    // Nenhuma pode ter arrays de paleta hardcoded ou funções locais de hash
    expect(campaignsCode).not.toContain("const PALETTE");
    expect(campaignsCode).not.toContain("const COLORS");
    expect(dispatchCode).not.toContain("const PALETTE");
    expect(dispatchCode).not.toContain("const COLORS");
  });

  it("[REGRA CONJUNTO 2] na Fila de Envios, as cores de estado dos quadrados continuam exatamente como estão hoje", () => {
    expect(DISPATCH_SQUARE_STYLES.enviado).toContain("emerald");
    expect(DISPATCH_SQUARE_STYLES.falha).toContain("rose");
    expect(DISPATCH_SQUARE_STYLES.saindo).toContain("blue-500");
    expect(DISPATCH_SQUARE_STYLES.fila).toContain("slate");
    expect(DISPATCH_SQUARE_STYLES.cancelado).toContain("slate");

    // Cancelado é visualmente distinto de fila
    expect(DISPATCH_SQUARE_STYLES.cancelado).not.toBe(DISPATCH_SQUARE_STYLES.fila);
  });
});

describe("Campanhas — CampaignsTable.tsx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mesmo identificador recebe a mesma cor em duas renderizações e com a lista reordenada", async () => {
    const { CampaignsTable } = await import("@/pages/LeadImports/CampaignsTable");

    const camp1 = makeCampaignItem({ id: "camp-001", name: "Campanha Um" });
    const camp2 = makeCampaignItem({ id: "camp-002", name: "Campanha Dois" });
    const camp3 = makeCampaignItem({ id: "camp-003", name: "Campanha Três" });

    // Render 1: ordem 1, 2, 3
    const { unmount } = renderWithProviders(
      <CampaignsTable
        clientId="sonhare"
        campaigns={[camp1, camp2, camp3]}
        loadingCampaigns={false}
        onEditCampaign={vi.fn()}
        onDuplicateCampaign={vi.fn()}
        onDeleteCampaign={vi.fn()}
      />
    );

    const card1_r1 = screen.getByTestId("campaign-card-camp-001");
    const card2_r1 = screen.getByTestId("campaign-card-camp-002");
    const card3_r1 = screen.getByTestId("campaign-card-camp-003");

    const color1 = getStableColor("camp-001");
    const color2 = getStableColor("camp-002");
    const color3 = getStableColor("camp-003");

    expect(card1_r1.className).toContain(color1.borderLeft);
    expect(card2_r1.className).toContain(color2.borderLeft);
    expect(card3_r1.className).toContain(color3.borderLeft);

    unmount();

    // Render 2: ordem invertida 3, 1, 2
    renderWithProviders(
      <CampaignsTable
        clientId="sonhare"
        campaigns={[camp3, camp1, camp2]}
        loadingCampaigns={false}
        onEditCampaign={vi.fn()}
        onDuplicateCampaign={vi.fn()}
        onDeleteCampaign={vi.fn()}
      />
    );

    const card1_r2 = screen.getByTestId("campaign-card-camp-001");
    const card2_r2 = screen.getByTestId("campaign-card-camp-002");
    const card3_r2 = screen.getByTestId("campaign-card-camp-003");

    // Cores permanecem idênticas
    expect(card1_r2.className).toContain(color1.borderLeft);
    expect(card2_r2.className).toContain(color2.borderLeft);
    expect(card3_r2.className).toContain(color3.borderLeft);
  });

  it("o cartão fechado mostra exatamente os quatro campos definidos (nome, estado, quantos leads, data)", async () => {
    const { CampaignsTable } = await import("@/pages/LeadImports/CampaignsTable");

    const camp = makeCampaignItem({
      id: "camp-001",
      name: "Campanha Odonto Promo",
      status: "active",
      mode: "agente",
      limit_per_run: 85,
      client_name: "Odonto MegaClin",
      import_id: "imp-excel",
      created_at: "2026-08-20T14:30:00Z",
    });

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

    const card = screen.getByTestId("campaign-card-camp-001");

    // 1. Nome
    expect(within(card).getByTestId("campaign-name-camp-001").textContent).toBe("Campanha Odonto Promo");
    // 2. Estado
    expect(within(card).getByTestId("campaign-status-camp-001").textContent).toBe("Ativa");
    // 3. Quantos leads
    expect(within(card).getByTestId("campaign-leads-camp-001").textContent).toContain("85");
    // 4. Data
    expect(within(card).getByTestId("campaign-date-camp-001")).toBeTruthy();

    // Detalhes extras NÃO aparecem quando fechado
    expect(within(card).queryByText("Odonto MegaClin")).toBeNull();
    expect(within(card).queryByText("Base importada")).toBeNull();
    expect(within(card).queryByRole("button", { name: "Editar" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Duplicar" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Excluir" })).toBeNull();
  });

  it("abrir um cartão fecha o que estava aberto", async () => {
    const { CampaignsTable } = await import("@/pages/LeadImports/CampaignsTable");

    const camp1 = makeCampaignItem({ id: "camp-001", name: "Campanha A", client_name: "Empresa A" });
    const camp2 = makeCampaignItem({ id: "camp-002", name: "Campanha B", client_name: "Empresa B" });

    renderWithProviders(
      <CampaignsTable
        clientId="sonhare"
        campaigns={[camp1, camp2]}
        loadingCampaigns={false}
        onEditCampaign={vi.fn()}
        onDuplicateCampaign={vi.fn()}
        onDeleteCampaign={vi.fn()}
      />
    );

    const toggle1 = screen.getByRole("button", { name: /Ver detalhes de Campanha A/i });
    const toggle2 = screen.getByRole("button", { name: /Ver detalhes de Campanha B/i });

    // Abre o cartão 1
    fireEvent.click(toggle1);
    expect(screen.getByText(/Empresa A/)).toBeTruthy();
    expect(screen.queryByText(/Empresa B/)).toBeNull();

    // Abre o cartão 2 -> cartão 1 fecha automaticamente
    fireEvent.click(toggle2);
    expect(screen.queryByText(/Empresa A/)).toBeNull();
    expect(screen.getByText(/Empresa B/)).toBeTruthy();

    // Clica novamente no cartão 2 -> fecha ele também
    const toggle2Recolher = screen.getByRole("button", { name: /Recolher detalhes de Campanha B/i });
    fireEvent.click(toggle2Recolher);
    expect(screen.queryByText(/Empresa A/)).toBeNull();
    expect(screen.queryByText(/Empresa B/)).toBeNull();
  });

  it("nenhuma informação que existe hoje desapareceu — dados abrem ao expandir", async () => {
    const { CampaignsTable } = await import("@/pages/LeadImports/CampaignsTable");

    const onEdit = vi.fn();
    const onDuplicate = vi.fn();
    const onDelete = vi.fn();

    const camp = makeCampaignItem({
      id: "camp-full",
      name: "Campanha Completa",
      client_name: "Empresa Exemplo SA",
      import_id: "imp-origem",
    });

    renderWithProviders(
      <CampaignsTable
        clientId="sonhare"
        campaigns={[camp]}
        loadingCampaigns={false}
        onEditCampaign={onEdit}
        onDuplicateCampaign={onDuplicate}
        onDeleteCampaign={onDelete}
      />
    );

    // Abre o cartão
    fireEvent.click(screen.getByRole("button", { name: /Ver detalhes de Campanha Completa/i }));

    // Informações presentes
    expect(screen.getByText(/Empresa Exemplo SA/)).toBeTruthy();
    expect(screen.getByText(/Base importada/)).toBeTruthy();

    // Botões de ação funcionam
    const editBtn = screen.getByRole("button", { name: "Editar" });
    const dupBtn = screen.getByRole("button", { name: "Duplicar" });
    const delBtn = screen.getByRole("button", { name: "Excluir" });

    fireEvent.click(editBtn);
    expect(onEdit).toHaveBeenCalledWith(camp);

    fireEvent.click(dupBtn);
    expect(onDuplicate).toHaveBeenCalledWith(camp);

    fireEvent.click(delBtn);
    expect(onDelete).toHaveBeenCalledWith(camp);
  });

  it("o primeiro campo não é espremido por nada na mesma linha", async () => {
    const { CampaignsTable } = await import("@/pages/LeadImports/CampaignsTable");

    const camp = makeCampaignItem({ id: "camp-line1", name: "Campanha Nome Super Longo Que Não Pode Ser Espremido" });

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

    const line1 = screen.getByTestId("campaign-line-1-camp-line1");

    // Na linha 1 só existem o bloco com [ponto de cor + nome] e o botão chevron
    expect(line1.children.length).toBe(2);

    const nameBlock = line1.children[0];
    expect(nameBlock.className).toContain("flex-1");
    expect(nameBlock.className).toContain("min-w-0");

    const nameElem = screen.getByTestId("campaign-name-camp-line1");
    expect(nameElem.className).toContain("truncate");

    const chevronBtn = line1.children[1];
    expect(chevronBtn.className).toContain("shrink-0");
    expect(chevronBtn.className).toContain("ml-auto");
  });
});

describe("Fila de Envios — DispatchCampaignTracker.tsx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mesmo identificador recebe a mesma cor em duas renderizações e com a lista reordenada", async () => {
    const d1 = makeDispatchItem({ campaignId: "disp-1", campaignName: "Fila Um" });
    const d2 = makeDispatchItem({ campaignId: "disp-2", campaignName: "Fila Dois" });
    const d3 = makeDispatchItem({ campaignId: "disp-3", campaignName: "Fila Três" });

    summaryMockFn.mockImplementation(() => ({
      isLoading: false,
      data: {
        campaigns: [d1, d2, d3],
        counts: { active: 3, ended: 0 },
        scope: "active",
        page: 1,
        pageSize: 10,
        totalForScope: 3,
        kpis: { periodLabel: "30d", campaigns: 3, leads: 450, sent: 300, deliveryRate: 90 },
      },
    }));

    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    const { unmount } = renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);

    const card1_r1 = screen.getByTestId("dispatch-card-disp-1");
    const card2_r1 = screen.getByTestId("dispatch-card-disp-2");
    const card3_r1 = screen.getByTestId("dispatch-card-disp-3");

    const color1 = getStableColor("disp-1");
    const color2 = getStableColor("disp-2");
    const color3 = getStableColor("disp-3");

    expect(card1_r1.className).toContain(color1.borderLeft);
    expect(card2_r1.className).toContain(color2.borderLeft);
    expect(card3_r1.className).toContain(color3.borderLeft);

    unmount();

    // Render 2: reordenada
    summaryMockFn.mockImplementation(() => ({
      isLoading: false,
      data: {
        campaigns: [d3, d1, d2],
        counts: { active: 3, ended: 0 },
        scope: "active",
        page: 1,
        pageSize: 10,
        totalForScope: 3,
        kpis: { periodLabel: "30d", campaigns: 3, leads: 450, sent: 300, deliveryRate: 90 },
      },
    }));

    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);

    const card1_r2 = screen.getByTestId("dispatch-card-disp-1");
    const card2_r2 = screen.getByTestId("dispatch-card-disp-2");
    const card3_r2 = screen.getByTestId("dispatch-card-disp-3");

    expect(card1_r2.className).toContain(color1.borderLeft);
    expect(card2_r2.className).toContain(color2.borderLeft);
    expect(card3_r2.className).toContain(color3.borderLeft);
  });

  it("o cartão fechado mostra exatamente os quatro campos definidos (nome, estado, quantos leads, data)", async () => {
    const d = makeDispatchItem({
      campaignId: "disp-fechado",
      campaignName: "Campanha Fila Teste",
      status: "agendada",
      statusLabel: "Agendada",
      leadsTotal: 340,
      loteCount: 7,
      eta: { isToday: false, weekday: "ter", label: "terça-feira, por volta das 10h" },
    });

    summaryMockFn.mockImplementation(() => ({
      isLoading: false,
      data: {
        campaigns: [d],
        counts: { active: 1, ended: 0 },
        scope: "active",
        page: 1,
        pageSize: 10,
        totalForScope: 1,
        kpis: { periodLabel: "30d", campaigns: 1, leads: 340, sent: 0, deliveryRate: 0 },
      },
    }));

    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);

    const card = screen.getByTestId("dispatch-card-disp-fechado");

    // 1. Nome
    expect(within(card).getByTestId("dispatch-name-disp-fechado").textContent).toBe("Campanha Fila Teste");
    // 2. Estado
    expect(within(card).getByTestId("dispatch-status-disp-fechado").textContent).toBe("Agendada");
    // 3. Quantos leads
    expect(within(card).getByTestId("dispatch-leads-disp-fechado").textContent).toContain("340 leads");
    // 4. Data
    expect(within(card).getByTestId("dispatch-date-disp-fechado").textContent).toBe("terça-feira, por volta das 10h");

    // Elementos abertos NÃO devem estar no documento
    expect(within(card).queryByText("lotes — clique em um para ver os leads dele")).toBeNull();
    expect(within(card).queryByText("Responderam")).toBeNull();
    expect(within(card).queryByText("Falharam")).toBeNull();
    expect(within(card).queryByRole("button", { name: "Cancelar o que falta" })).toBeNull();
  });

  it("abrir um cartão fecha o que estava aberto", async () => {
    const d1 = makeDispatchItem({ campaignId: "disp-a", campaignName: "Fila Alpha" });
    const d2 = makeDispatchItem({ campaignId: "disp-b", campaignName: "Fila Beta" });

    summaryMockFn.mockImplementation(() => ({
      isLoading: false,
      data: {
        campaigns: [d1, d2],
        counts: { active: 2, ended: 0 },
        scope: "active",
        page: 1,
        pageSize: 10,
        totalForScope: 2,
        kpis: { periodLabel: "30d", campaigns: 2, leads: 300, sent: 200, deliveryRate: 90 },
      },
    }));

    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);

    const toggleA = screen.getByRole("button", { name: /Ver detalhes de Fila Alpha/i });
    const toggleB = screen.getByRole("button", { name: /Ver detalhes de Fila Beta/i });

    // Abre o cartão A
    fireEvent.click(toggleA);
    expect(screen.getByRole("button", { name: /Recolher detalhes de Fila Alpha/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Ver detalhes de Fila Beta/i })).toBeTruthy();

    // Abre o cartão B -> cartão A fecha
    fireEvent.click(toggleB);
    expect(screen.getByRole("button", { name: /Ver detalhes de Fila Alpha/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Recolher detalhes de Fila Beta/i })).toBeTruthy();
  });

  it("nenhuma informação que existe hoje desapareceu — lotes, kpis e ações abrem ao expandir", async () => {
    const onOpenDispatch = vi.fn();
    const d = makeDispatchItem({
      campaignId: "disp-full",
      campaignName: "Fila Completa",
      sentTotal: 80,
      repliedCount: 22,
      failedTotal: 5,
      leadsPending: 43,
      leadsActionable: { pause: 0, resume: 0, cancel: 43 },
    });

    summaryMockFn.mockImplementation(() => ({
      isLoading: false,
      data: {
        campaigns: [d],
        counts: { active: 1, ended: 0 },
        scope: "active",
        page: 1,
        pageSize: 10,
        totalForScope: 1,
        kpis: { periodLabel: "30d", campaigns: 1, leads: 150, sent: 80, deliveryRate: 90 },
      },
    }));

    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={onOpenDispatch} />);

    // Abre o cartão
    const card = screen.getByTestId("dispatch-card-disp-full");
    fireEvent.click(within(card).getByRole("button", { name: /Ver detalhes de Fila Completa/i }));

    // Estatísticas dos 4 números
    expect(within(card).getByText("80")).toBeTruthy(); // enviados
    expect(within(card).getByText("22")).toBeTruthy(); // responderam
    expect(within(card).getByText("5")).toBeTruthy(); // falharam
    expect(within(card).getByText("43")).toBeTruthy(); // na fila

    // Ações
    expect(within(card).getByRole("button", { name: /Cancelar o que falta/i })).toBeTruthy();

    // Lotes clicáveis
    const lote1 = within(card).getByTitle(/Lote 1 — enviado/);
    fireEvent.click(lote1);
    expect(onOpenDispatch).toHaveBeenCalledWith("b1");
  });

  it("o primeiro campo não é espremido por nada na mesma linha", async () => {
    const d = makeDispatchItem({
      campaignId: "disp-name-check",
      campaignName: "Campanha Com Nome Bem Comprido Que Deve Ter A Linha Só Para Si",
    });

    summaryMockFn.mockImplementation(() => ({
      isLoading: false,
      data: {
        campaigns: [d],
        counts: { active: 1, ended: 0 },
        scope: "active",
        page: 1,
        pageSize: 10,
        totalForScope: 1,
        kpis: { periodLabel: "30d", campaigns: 1, leads: 150, sent: 80, deliveryRate: 90 },
      },
    }));

    const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
    renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);

    const line1 = screen.getByTestId("dispatch-line-1-disp-name-check");

    // Na linha 1 só existem o bloco com [ponto de cor + nome] e o botão chevron
    expect(line1.children.length).toBe(2);

    const nameBlock = line1.children[0];
    expect(nameBlock.className).toContain("flex-1");
    expect(nameBlock.className).toContain("min-w-0");

    const nameElem = screen.getByTestId("dispatch-name-disp-name-check");
    expect(nameElem.className).toContain("truncate");

    const chevronBtn = line1.children[1];
    expect(chevronBtn.className).toContain("shrink-0");
    expect(chevronBtn.className).toContain("ml-auto");
  });
});
