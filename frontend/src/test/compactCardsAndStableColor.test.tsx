// frontend/src/test/compactCardsAndStableColor.test.tsx
//
// Testes para a padronização de cartões compactos e cor estável:
// Entrega 1: Campanhas (CampaignsTable) e Fila de Envios (DispatchCampaignTracker)
// Entrega 2: Planilhas salvas (SavedSheetsCards), Contratos (ContractsList) e Propostas (GeracaoDigitalProposals)

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getStableColor } from "@/lib/stableColor";
import { DISPATCH_SQUARE_STYLES } from "@/hooks/useCampanhas";
import type { Campaign } from "@/hooks/useCampanhas";
import type { LeadImportItem } from "@/hooks/useLeadImports";

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
    useLocation: () => ({ pathname: "/propostas-gd", search: "" }),
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

// Mock para ContractsList hooks
const contractsMockFn = vi.fn().mockReturnValue({
  data: [],
  isLoading: false,
  error: null,
});

vi.mock("@/hooks/useGdContracts", () => ({
  useGdContracts: (...args: any[]) => contractsMockFn(...args),
  useUpdateGdContract: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadSignedContract: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useJuridico", async (importOriginal) => {
  const actual: any = await importOriginal().catch(() => ({}));
  return {
    ...actual,
    useSendContractToJuridico: () => ({ mutate: vi.fn(), isPending: false }),
    useJuridicoSettings: () => ({ data: { slackChannel: "", whatsappPhone: "" }, isLoading: false }),
    useSaveJuridicoSettings: () => ({ mutate: vi.fn(), isPending: false }),
  };
});

vi.mock("@/hooks/useEvolutionInstances", () => ({
  useEvolutionInstances: () => ({ data: [], isLoading: false }),
}));

vi.mock("@/pages/GeracaoDigitalContracts/JuridicoSettingsCard", () => ({
  JuridicoSettingsCard: () => <div data-testid="juridico-settings-mock" />,
}));

vi.mock("@/pages/GeracaoDigitalContracts/GenerateContractDialog", () => ({
  GenerateContractDialog: () => null,
}));

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

function makeSheetItem(overrides: Partial<LeadImportItem> = {}): LeadImportItem {
  return {
    id: "imp-sheet-001",
    client_id: "sonhare",
    source_name: "leads_outubro_2026.xlsx",
    source_type: "xlsx",
    total_rows: 150,
    imported_rows: 150,
    skipped_rows: 12,
    created_at: "2026-10-01T10:00:00Z",
    uploaded_by_email: "vendedor@sonhare.com.br",
    uploaded_by_uid: "user-123",
    column_mapping: null,
    ...overrides,
  };
}

function makeContractItem(overrides: any = {}) {
  return {
    id: "ct-contract-001",
    client_id: "sonhare",
    proposal_id: "prop-12345678",
    status: "gerado",
    created_at: "2026-10-01T14:30:00Z",
    updated_at: "2026-10-01T14:30:00Z",
    dados: {
      razao_social: "Clínica Bem Estar LTDA",
      cnpj: "12.345.678/0001-90",
      representante: "Carlos Souza",
    },
    signed_file_path: null,
    signed_file_name: null,
    signed_uploaded_at: null,
    signed_uploaded_by: null,
    arquivado: false,
    ...overrides,
  };
}

function makeProposalItem(overrides: any = {}) {
  return {
    id: "prop-001",
    prospect_name: "Hospital Santa Maria",
    itens: [
      { descricao: "Plano Anual", categoria: "gd", valor: 5000, periodicidade: "mensal" },
    ],
    valor_total: 5000,
    valor_setup: 1000,
    valor_recorrente: 5000,
    condicoes: "À vista",
    status: "enviada",
    created_at: "2026-09-20T12:00:00Z",
    ...overrides,
  };
}

describe("Regras Globais de Cor e Cartão (Entrega 1 e 2)", () => {
  it("[REGRA CONJUNTO 1] renderiza e confirma que a cor aplicada aos elementos é exatamente a que getStableColor devolve para aquele identificador", async () => {
    const { CampaignsTable } = await import("@/pages/LeadImports/CampaignsTable");
    const { SavedSheetsCards } = await import("@/pages/LeadImports/SavedSheetsCards");
    const { ContractsList } = await import("@/pages/GeracaoDigitalContracts/ContractsList");

    // 1. CampanhasTable: confirma que o stripe e o dot aplicados correspondem ao getStableColor da campanha
    const testCamp = makeCampaignItem({ id: "camp-unique-test-color-42" });
    const campColor = getStableColor(testCamp.id);
    const { container: campContainer } = renderWithProviders(
      <CampaignsTable
        clientId="sonhare"
        campaigns={[testCamp]}
        loadingCampaigns={false}
        onEditCampaign={() => {}}
        onDuplicateCampaign={() => {}}
        onDeleteCampaign={() => {}}
      />
    );
    const campCard = campContainer.querySelector(`[data-testid="campaign-card-${testCamp.id}"]`);
    const campDot = campContainer.querySelector(`[data-testid="campaign-line-1-${testCamp.id}"] span`);
    expect(campCard?.className).toContain(campColor.borderLeft);
    expect(campDot?.className).toContain(campColor.dot);

    // 2. SavedSheetsCards: confirma que o stripe e o dot aplicados correspondem ao getStableColor da planilha
    const testSheet = makeSheetItem({ id: "sheet-unique-test-color-88" });
    const sheetColor = getStableColor(testSheet.id);
    const { container: sheetContainer } = renderWithProviders(
      <SavedSheetsCards
        imports={[testSheet]}
        onViewImport={() => {}}
        onDeleteImport={() => {}}
      />
    );
    const sheetStripe = sheetContainer.querySelector(`[data-testid="sheet-card-stripe-${testSheet.id}"]`);
    const sheetDot = sheetContainer.querySelector(`[data-testid="sheet-color-dot-${testSheet.id}"]`);
    expect(sheetStripe?.className).toContain(sheetColor.stripe);
    expect(sheetDot?.className).toContain(sheetColor.dot);

    // 3. ContractsList: confirma que o stripe e o dot aplicados correspondem ao getStableColor do contrato
    const testContract = makeContractItem({ id: "contract-unique-test-color-99" });
    const contractColor = getStableColor(testContract.id);
    contractsMockFn.mockReturnValue({
      data: [testContract],
      isLoading: false,
      error: null,
    });
    const { container: contractContainer } = renderWithProviders(<ContractsList />);
    const contractStripe = contractContainer.querySelector(`[data-testid="contract-card-stripe-${testContract.id}"]`);
    const contractDot = contractContainer.querySelector(`[data-testid="contract-color-dot-${testContract.id}"]`);
    expect(contractStripe?.className).toContain(contractColor.stripe);
    expect(contractDot?.className).toContain(contractColor.dot);
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

describe("Planilhas Salvas — SavedSheetsCards.tsx", () => {
  it("cartão fechado renderiza exatamente as 3 linhas na ordem especificada", async () => {
    const { SavedSheetsCards } = await import("@/pages/LeadImports/SavedSheetsCards");
    const sheet = makeSheetItem({
      id: "sheet-3lines-test",
      source_name: "base_clientes_vip.xlsx",
      imported_rows: 250,
      created_at: "2026-10-01T12:00:00Z",
      uploaded_by_email: "gestor@sonhare.com.br",
    });

    renderWithProviders(
      <SavedSheetsCards
        imports={[sheet]}
        onViewImport={vi.fn()}
        onDeleteImport={vi.fn()}
      />
    );

    // Linha 1: ponto de cor, nome do arquivo, seta encostada à direita
    const line1 = screen.getByTestId("sheet-line-1-sheet-3lines-test");
    expect(within(line1).getByTestId("sheet-color-dot-sheet-3lines-test")).toBeTruthy();
    expect(within(line1).getByTestId("sheet-name-sheet-3lines-test").textContent).toBe("base_clientes_vip.xlsx");
    expect(within(line1).getByRole("button", { name: /Ver detalhes/i })).toBeTruthy();

    // Linha 2: total de leads e data de upload
    const line2 = screen.getByTestId("sheet-line-2-sheet-3lines-test");
    expect(within(line2).getByTestId("sheet-leads-sheet-3lines-test").textContent).toContain("250 linhas importadas");
    expect(within(line2).getByTestId("sheet-date-sheet-3lines-test").textContent).toBe("01/10/2026");

    // Linha 3: quem subiu
    const line3 = screen.getByTestId("sheet-line-3-sheet-3lines-test");
    expect(within(line3).getByTestId("sheet-uploader-sheet-3lines-test").textContent).toBe("gestor@sonhare.com.br");

    // Detalhes expandidos não estão visíveis enquanto o cartão estiver fechado
    expect(screen.queryByTestId("sheet-expanded-content-sheet-3lines-test")).toBeNull();
  });

  it("o primeiro campo não é espremido na linha 1", async () => {
    const { SavedSheetsCards } = await import("@/pages/LeadImports/SavedSheetsCards");
    const sheet = makeSheetItem({
      id: "sheet-long-name",
      source_name: "planilha_com_nome_extremamente_longo_para_testar_se_trunca_sem_espremer.xlsx",
    });

    renderWithProviders(
      <SavedSheetsCards
        imports={[sheet]}
        onViewImport={vi.fn()}
        onDeleteImport={vi.fn()}
      />
    );

    const line1 = screen.getByTestId("sheet-line-1-sheet-long-name");
    // Linha 1 tem apenas 2 filhos: [ponto de cor + nome flex-1] e [botão chevron shrink-0]
    expect(line1.children.length).toBe(2);

    const nameBlock = line1.children[0];
    expect(nameBlock.className).toContain("flex-1");
    expect(nameBlock.className).toContain("min-w-0");

    const nameText = screen.getByTestId("sheet-name-sheet-long-name");
    expect(nameText.className).toContain("truncate");

    const chevronBtn = line1.children[1];
    expect(chevronBtn.className).toContain("shrink-0");
  });

  it("o resto abre dentro do próprio cartão e apenas um cartão aberto por vez", async () => {
    const { SavedSheetsCards } = await import("@/pages/LeadImports/SavedSheetsCards");
    const sheet1 = makeSheetItem({ id: "sheet-a", source_name: "base_a.xlsx", skipped_rows: 5 });
    const sheet2 = makeSheetItem({ id: "sheet-b", source_name: "base_b.xlsx", skipped_rows: 8 });

    const onViewImport = vi.fn();
    const onDeleteImport = vi.fn();

    renderWithProviders(
      <SavedSheetsCards
        imports={[sheet1, sheet2]}
        onViewImport={onViewImport}
        onDeleteImport={onDeleteImport}
      />
    );

    const card1 = screen.getByTestId("sheet-card-sheet-a");
    const card2 = screen.getByTestId("sheet-card-sheet-b");

    // Abre o cartão 1
    fireEvent.click(within(card1).getByRole("button", { name: /Ver detalhes/i }));

    expect(screen.getByTestId("sheet-expanded-content-sheet-a")).toBeTruthy();
    expect(screen.queryByTestId("sheet-expanded-content-sheet-b")).toBeNull();
    expect(within(card1).getByText("5")).toBeTruthy(); // skipped rows

    // Testa ação Ver Leads
    fireEvent.click(within(card1).getByRole("button", { name: /Ver leads/i }));
    expect(onViewImport).toHaveBeenCalledWith(sheet1);

    // Testa ação de remover o REGISTRO (o nome diz o que faz; não há botão "Excluir" solto)
    expect(within(card1).queryByRole("button", { name: /^Excluir$/i })).toBeNull();
    fireEvent.click(within(card1).getByRole("button", { name: /Remover registro da planilha/i }));
    expect(onDeleteImport).toHaveBeenCalledWith("sheet-a", "base_a.xlsx");

    // Abre o cartão 2: confirma que o cartão 1 fecha automaticamente (um por vez)
    fireEvent.click(within(card2).getByRole("button", { name: /Ver detalhes/i }));

    expect(screen.queryByTestId("sheet-expanded-content-sheet-a")).toBeNull();
    expect(screen.getByTestId("sheet-expanded-content-sheet-b")).toBeTruthy();
    expect(within(card2).getByText("8")).toBeTruthy();
  });
});

describe("Contratos — ContractsList.tsx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cartão fechado renderiza as 3 linhas com ponto de cor, cliente, status e data", async () => {
    const { ContractsList } = await import("@/pages/GeracaoDigitalContracts/ContractsList");
    const contract = makeContractItem({
      id: "contract-test-closed",
      dados: { razao_social: "Laboratório Santa Clara", cnpj: "99.888.777/0001-66" },
      created_at: "2026-10-01T15:00:00Z",
      status: "gerado",
      proposal_id: "prop-xyz-123",
    });

    contractsMockFn.mockReturnValue({
      data: [contract],
      isLoading: false,
      error: null,
    });

    renderWithProviders(<ContractsList />);

    // Linha 1: ponto de cor, cliente, seta de abrir
    const line1 = screen.getByTestId("contract-line-1-contract-test-closed");
    expect(within(line1).getByTestId("contract-color-dot-contract-test-closed")).toBeTruthy();
    expect(within(line1).getByTestId("contract-name-contract-test-closed").textContent).toBe("Laboratório Santa Clara");
    expect(within(line1).getByRole("button", { name: /Ver detalhes/i })).toBeTruthy();

    // Linha 2: status badge e origem/proposta
    const line2 = screen.getByTestId("contract-line-2-contract-test-closed");
    expect(within(line2).getByTestId("contract-status-contract-test-closed").textContent).toContain("Gerado");
    expect(within(line2).getByTestId("contract-value-or-origin-contract-test-closed").textContent).toContain("Proposta #prop-xyz");

    // Linha 3: data de criação
    const line3 = screen.getByTestId("contract-line-3-contract-test-closed");
    expect(within(line3).getByTestId("contract-date-contract-test-closed").textContent).toContain("Gerado em 01/10/2026");

    // Conteúdo expandido não está visível
    expect(screen.queryByTestId("contract-expanded-content-contract-test-closed")).toBeNull();
  });

  it("o primeiro campo não é espremido na linha 1", async () => {
    const { ContractsList } = await import("@/pages/GeracaoDigitalContracts/ContractsList");
    const contract = makeContractItem({
      id: "contract-long-name",
      dados: { razao_social: "Empresa Multinacional de Saúde com Nome Extremamente Longo e Extenso" },
    });

    contractsMockFn.mockReturnValue({
      data: [contract],
      isLoading: false,
      error: null,
    });

    renderWithProviders(<ContractsList />);

    const line1 = screen.getByTestId("contract-line-1-contract-long-name");
    expect(line1.children.length).toBe(2);

    const nameBlock = line1.children[0];
    expect(nameBlock.className).toContain("flex-1");
    expect(nameBlock.className).toContain("min-w-0");

    const nameText = screen.getByTestId("contract-name-contract-long-name");
    expect(nameText.className).toContain("truncate");

    const chevronBtn = line1.children[1];
    expect(chevronBtn.className).toContain("shrink-0");
  });

  it("o resto abre dentro do próprio cartão e apenas um cartão aberto por vez", async () => {
    const { ContractsList } = await import("@/pages/GeracaoDigitalContracts/ContractsList");
    const ct1 = makeContractItem({ id: "ct-1", dados: { razao_social: "Empresa 1", cnpj: "11.111.111/0001-11", representante: "Ana" } });
    const ct2 = makeContractItem({ id: "ct-2", dados: { razao_social: "Empresa 2", cnpj: "22.222.222/0001-22", representante: "Bruno" } });

    contractsMockFn.mockReturnValue({
      data: [ct1, ct2],
      isLoading: false,
      error: null,
    });

    renderWithProviders(<ContractsList />);

    const card1 = screen.getByTestId("contract-card-ct-1");
    const card2 = screen.getByTestId("contract-card-ct-2");

    // Abre o contrato 1
    fireEvent.click(within(card1).getByRole("button", { name: /Ver detalhes/i }));

    expect(screen.getByTestId("contract-expanded-content-ct-1")).toBeTruthy();
    expect(screen.queryByTestId("contract-expanded-content-ct-2")).toBeNull();

    // Detalhes completos visíveis no cartão 1
    expect(within(card1).getByText("11.111.111/0001-11")).toBeTruthy();
    expect(within(card1).getByText("Ana")).toBeTruthy();
    expect(within(card1).getByRole("button", { name: /Enviar ao Jurídico/i })).toBeTruthy();
    expect(within(card1).getByRole("button", { name: /Abrir \/ Baixar PDF/i })).toBeTruthy();

    // Abre o contrato 2: o contrato 1 fecha automaticamente
    fireEvent.click(within(card2).getByRole("button", { name: /Ver detalhes/i }));

    expect(screen.queryByTestId("contract-expanded-content-ct-1")).toBeNull();
    expect(screen.getByTestId("contract-expanded-content-ct-2")).toBeTruthy();
    expect(within(card2).getByText("22.222.222/0001-22")).toBeTruthy();
    expect(within(card2).getByText("Bruno")).toBeTruthy();
  });
});

describe("Propostas — GeracaoDigitalProposals.tsx", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("cartão fechado de proposta renderiza as 3 linhas com ponto de cor, cliente, valor, status e data", async () => {
    const prop = makeProposalItem({
      id: "prop-card-test",
      prospect_name: "Hospital Santa Maria",
      status: "enviada",
      valor_total: 7500,
      created_at: "2026-10-01T10:00:00Z",
    });

    fetchApiMock.mockImplementation((url: string) => {
      if (url.includes("/api/gd/proposals")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: [prop] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });
    });

    const { default: GeracaoDigitalProposals } = await import("@/pages/GeracaoDigitalProposals");
    renderWithProviders(<GeracaoDigitalProposals />);

    const card = await screen.findByTestId("proposal-card-prop-card-test");
    expect(card).toBeTruthy();

    // Linha 1: ponto de cor, cliente, seta de abrir
    const line1 = screen.getByTestId("proposal-line-1-prop-card-test");
    expect(within(line1).getByTestId("proposal-color-dot-prop-card-test")).toBeTruthy();
    expect(within(line1).getByTestId("proposal-name-prop-card-test").textContent).toBe("Hospital Santa Maria");
    expect(within(line1).getByRole("button", { name: /Ver detalhes/i })).toBeTruthy();

    // Linha 2: status e valor
    const line2 = screen.getByTestId("proposal-line-2-prop-card-test");
    expect(within(line2).getByTestId("proposal-status-prop-card-test").textContent).toContain("Enviada");
    expect(within(line2).getByTestId("proposal-value-prop-card-test").textContent).toContain("R$");

    // Linha 3: data
    const line3 = screen.getByTestId("proposal-line-3-prop-card-test");
    expect(within(line3).getByTestId("proposal-date-prop-card-test").textContent).toBe("01/10/2026");

    // Expandido fechado inicialmente
    expect(screen.queryByTestId("proposal-expanded-content-prop-card-test")).toBeNull();
  });

  it("o primeiro campo não é espremido na linha 1", async () => {
    const prop = makeProposalItem({
      id: "prop-long-name",
      prospect_name: "Rede Hospitalar e Ambulatorial Integrada de Tratamento Avançado",
    });

    fetchApiMock.mockImplementation((url: string) => {
      if (url.includes("/api/gd/proposals")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: [prop] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });
    });

    const { default: GeracaoDigitalProposals } = await import("@/pages/GeracaoDigitalProposals");
    renderWithProviders(<GeracaoDigitalProposals />);

    await screen.findByTestId("proposal-card-prop-long-name");
    const line1 = screen.getByTestId("proposal-line-1-prop-long-name");

    expect(line1.children.length).toBe(2);
    const nameBlock = line1.children[0];
    expect(nameBlock.className).toContain("flex-1");
    expect(nameBlock.className).toContain("min-w-0");

    const nameText = screen.getByTestId("proposal-name-prop-long-name");
    expect(nameText.className).toContain("truncate");

    const chevronBtn = line1.children[1];
    expect(chevronBtn.className).toContain("shrink-0");
  });

  it("o resto abre dentro do próprio cartão e apenas um cartão aberto por vez", async () => {
    const p1 = makeProposalItem({ id: "prop-1", prospect_name: "Cliente A", status: "rascunho" });
    const p2 = makeProposalItem({ id: "prop-2", prospect_name: "Cliente B", status: "enviada" });

    fetchApiMock.mockImplementation((url: string) => {
      if (url.includes("/api/gd/proposals")) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, data: [p1, p2] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ success: true, data: [] }),
      });
    });

    const { default: GeracaoDigitalProposals } = await import("@/pages/GeracaoDigitalProposals");
    renderWithProviders(<GeracaoDigitalProposals />);

    const card1 = await screen.findByTestId("proposal-card-prop-1");
    const card2 = await screen.findByTestId("proposal-card-prop-2");

    // Abre proposta 1
    fireEvent.click(within(card1).getByRole("button", { name: /Ver detalhes/i }));

    expect(screen.getByTestId("proposal-expanded-content-prop-1")).toBeTruthy();
    expect(screen.queryByTestId("proposal-expanded-content-prop-2")).toBeNull();
    expect(within(card1).getByRole("button", { name: /Abrir Proposta/i })).toBeTruthy();

    // Abre proposta 2: proposta 1 fecha
    fireEvent.click(within(card2).getByRole("button", { name: /Ver detalhes/i }));

    expect(screen.queryByTestId("proposal-expanded-content-prop-1")).toBeNull();
    expect(screen.getByTestId("proposal-expanded-content-prop-2")).toBeTruthy();
    expect(within(card2).getByRole("button", { name: /Abrir Proposta/i })).toBeTruthy();
  });
});
