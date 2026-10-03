// src/test/viewModeToggle.test.tsx
//
// Alternar entre cartão e lista nas cinco abas (Campanhas, Fila de Envios, Planilhas Salvas, Propostas e
// Contratos). Uma implementação só: o alternador (ViewModeToggle) e a lista (RecordView) são os mesmos nas cinco.
// Nenhuma informação muda entre os modos — os mesmos registros, os mesmos campos, só a forma.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, within, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getStableColor } from "@/lib/stableColor";
import type { Campaign } from "@/hooks/useCampanhas";
import type { LeadImportItem } from "@/hooks/useLeadImports";

import campaignsSrc from "../pages/LeadImports/CampaignsTable.tsx?raw";
import trackerSrc from "../pages/LeadImports/DispatchCampaignTracker.tsx?raw";
import sheetsSrc from "../pages/LeadImports/SavedSheetsCards.tsx?raw";
import proposalsSrc from "../pages/GeracaoDigitalProposals.tsx?raw";
import contractsSrc from "../pages/GeracaoDigitalContracts/ContractsList.tsx?raw";

// O alternador e a lista são os componentes reais, embrulhados em espiões: dá para ver QUEM os renderizou.
vi.mock("@/components/ViewModeToggle", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, ViewModeToggle: vi.fn(actual.ViewModeToggle) };
});
vi.mock("@/components/records/RecordView", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, RecordView: vi.fn(actual.RecordView) };
});

import { ViewModeToggle } from "@/components/ViewModeToggle";
import { RecordView } from "@/components/records/RecordView";

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
const juridicoMutateMock = vi.fn();
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
    useSendContractToJuridico: () => ({ mutate: (...args: any[]) => juridicoMutateMock(...args), isPending: false }),
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

// ── dados: três registros por aba ────────────────────────────────────────────────────────────────
const CAMPS = [
  makeCampaignItem({ id: "camp-alpha", name: "Campanha Estética Alpha" }),
  makeCampaignItem({ id: "camp-beta", name: "Campanha Dental Beta", status: "paused", mode: "disparo" }),
  makeCampaignItem({ id: "camp-gama", name: "Campanha Gama", status: "draft" }),
];
const DISPATCHES = [
  makeDispatchItem({ campaignId: "disp-alpha", campaignName: "Fila Alpha" }),
  makeDispatchItem({ campaignId: "disp-beta", campaignName: "Fila Beta", chipName: null }),
  makeDispatchItem({ campaignId: "disp-gama", campaignName: "Fila Gama" }),
];
const SHEETS = [
  makeSheetItem({ id: "sheet-alpha", source_name: "alpha_outubro.xlsx" }),
  makeSheetItem({ id: "sheet-beta", source_name: "beta_setembro.xlsx", uploaded_by_email: null }),
  makeSheetItem({ id: "sheet-gama", source_name: "gama_agosto.xlsx" }),
];
const CONTRACTS = [
  makeContractItem({ id: "ct-alpha", dados: { razao_social: "Alpha Clínica LTDA", cnpj: "11", representante: "Ana" } }),
  makeContractItem({ id: "ct-beta", dados: { razao_social: "Beta Dental LTDA", cnpj: "22", representante: "Bia" }, proposal_id: null }),
  makeContractItem({ id: "ct-gama", dados: { razao_social: "Gama Odonto LTDA", cnpj: "33", representante: "Caio" }, signed_file_path: "x.pdf", signed_file_name: "x.pdf", signed_uploaded_at: "2026-10-02T10:00:00Z" }),
];
const PROPOSALS = [
  makeProposalItem({ id: "prop-alpha", prospect_name: "Alpha Hospital", status: "enviada" }),
  makeProposalItem({ id: "prop-beta", prospect_name: "Beta Clínica", status: "rascunho" }),
  makeProposalItem({ id: "prop-gama", prospect_name: "Gama Odonto", status: "aceita" }),
];

interface TabDef {
  name: string;
  tabKey: string; // chave da aba na preferência lembrada
  cardTestId: (id: string) => string;
  rowTestId: (id: string) => string;
  cardExpandedTestId: (id: string) => string;
  rowExpandedTestId: (id: string) => string;
  ids: string[];
  mount: () => Promise<void>;
  searchPlaceholder: RegExp;
  filterText: string;
  filterIds: string[];
  /** a cor do cartão: faixa lateral (div) ou borda esquerda (classe) */
  cardColorClass: (id: string) => string;
}

const resolveProposalsFetch = () =>
  fetchApiMock.mockImplementation((url: string) => {
    if (String(url).includes("/api/gd/proposals")) return Promise.resolve({ ok: true, json: async () => ({ success: true, data: PROPOSALS }) });
    return Promise.resolve({ ok: true, json: async () => ({ success: true, data: [] }) });
  });

const TABS: TabDef[] = [
  {
    name: "Campanhas",
    tabKey: "campanhas",
    cardTestId: (id) => `campaign-card-${id}`,
    rowTestId: (id) => `campaign-row-${id}`,
    cardExpandedTestId: (id) => `campaign-details-${id}`,
    rowExpandedTestId: (id) => `campaign-row-expanded-${id}`,
    ids: CAMPS.map((c) => c.id),
    mount: async () => {
      const { CampaignsTable } = await import("@/pages/LeadImports/CampaignsTable");
      renderWithProviders(<CampaignsTable clientId="sonhare" campaigns={CAMPS} loadingCampaigns={false} onEditCampaign={vi.fn()} onDuplicateCampaign={vi.fn()} onDeleteCampaign={vi.fn()} />);
    },
    searchPlaceholder: /Buscar por campanha ou último chip/,
    filterText: "alpha",
    filterIds: ["camp-alpha"],
    cardColorClass: (id) => getStableColor(id).borderLeft,
  },
  {
    name: "Fila de Envios",
    tabKey: "fila-de-envios",
    cardTestId: (id) => `dispatch-card-${id}`,
    rowTestId: (id) => `dispatch-row-${id}`,
    cardExpandedTestId: (id) => `dispatch-details-${id}`,
    rowExpandedTestId: (id) => `dispatch-row-expanded-${id}`,
    ids: DISPATCHES.map((c) => c.campaignId),
    mount: async () => {
      summaryMockFn.mockImplementation((scope: string) => ({
        isLoading: false,
        data: {
          campaigns: scope === "active" ? DISPATCHES : [],
          counts: { active: DISPATCHES.length, ended: 0 },
          scope,
          page: 1,
          pageSize: 5000,
          totalForScope: scope === "active" ? DISPATCHES.length : 0,
          kpis: { periodLabel: "30d", campaigns: 0, leads: 0, sent: 0, deliveryRate: 0 },
        },
      }));
      const { DispatchCampaignTracker } = await import("@/pages/LeadImports/DispatchCampaignTracker");
      renderWithProviders(<DispatchCampaignTracker clientId="sonhare" onOpenDispatch={vi.fn()} />);
    },
    searchPlaceholder: /Buscar por campanha ou último chip/,
    filterText: "beta",
    filterIds: ["disp-beta"],
    cardColorClass: (id) => getStableColor(id).borderLeft,
  },
  {
    name: "Planilhas Salvas",
    tabKey: "planilhas-salvas",
    cardTestId: (id) => `sheet-card-${id}`,
    rowTestId: (id) => `sheet-row-${id}`,
    cardExpandedTestId: (id) => `sheet-expanded-content-${id}`,
    rowExpandedTestId: (id) => `sheet-row-expanded-${id}`,
    ids: SHEETS.map((c) => c.id),
    mount: async () => {
      const { SavedSheetsCards } = await import("@/pages/LeadImports/SavedSheetsCards");
      renderWithProviders(<SavedSheetsCards imports={SHEETS} onViewImport={vi.fn()} onDeleteImport={vi.fn()} />);
    },
    searchPlaceholder: /Buscar por arquivo/,
    filterText: "gama",
    filterIds: ["sheet-gama"],
    cardColorClass: (id) => getStableColor(id).stripe,
  },
  {
    name: "Propostas",
    tabKey: "propostas",
    cardTestId: (id) => `proposal-card-${id}`,
    rowTestId: (id) => `proposal-row-${id}`,
    cardExpandedTestId: (id) => `proposal-expanded-content-${id}`,
    rowExpandedTestId: (id) => `proposal-row-expanded-${id}`,
    ids: PROPOSALS.map((c) => c.id),
    mount: async () => {
      resolveProposalsFetch();
      const { default: GeracaoDigitalProposals } = await import("@/pages/GeracaoDigitalProposals");
      renderWithProviders(<GeracaoDigitalProposals />);
      await waitFor(() => expect(screen.queryByTestId("proposal-card-prop-alpha") || screen.queryByTestId("proposal-row-prop-alpha")).toBeTruthy());
    },
    searchPlaceholder: /Buscar por empresa/,
    filterText: "beta",
    filterIds: ["prop-beta"],
    cardColorClass: (id) => getStableColor(id).stripe,
  },
  {
    name: "Contratos",
    tabKey: "contratos",
    cardTestId: (id) => `contract-card-${id}`,
    rowTestId: (id) => `contract-row-${id}`,
    cardExpandedTestId: (id) => `contract-expanded-content-${id}`,
    rowExpandedTestId: (id) => `contract-row-expanded-${id}`,
    ids: CONTRACTS.map((c) => c.id),
    mount: async () => {
      contractsMockFn.mockReturnValue({ data: CONTRACTS, isLoading: false, error: null });
      const { ContractsList } = await import("@/pages/GeracaoDigitalContracts/ContractsList");
      renderWithProviders(<ContractsList />);
    },
    searchPlaceholder: /Buscar por razão social/,
    filterText: "gama",
    filterIds: ["ct-gama"],
    cardColorClass: (id) => getStableColor(id).stripe,
  },
];

const setWidth = (w: number) => {
  Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: w });
  window.dispatchEvent(new Event("resize"));
};
const clickList = () => fireEvent.click(screen.getByRole("button", { name: "Ver em lista" }));
const clickCards = () => fireEvent.click(screen.getByRole("button", { name: "Ver em cartões" }));

/** os registros que aparecem, no modo atual (cartão ou linha) */
const shown = (t: TabDef, mode: "card" | "list") => t.ids.filter((id) => screen.queryByTestId(mode === "card" ? t.cardTestId(id) : t.rowTestId(id)));

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  try {
    window.localStorage.clear();
  } catch {
    /* sem storage */
  }
  setWidth(1280);
});
afterEach(() => setWidth(1280));

describe("as cinco telas usam o MESMO componente de alternância", () => {
  it("[TESTE OBRIGATÓRIO] o mesmo ViewModeToggle e a mesma lista (RecordView) são renderizados por cada aba — não cinco parecidos", async () => {
    for (const t of TABS) {
      cleanup();
      vi.mocked(ViewModeToggle).mockClear();
      vi.mocked(RecordView).mockClear();

      await t.mount();

      expect(vi.mocked(ViewModeToggle).mock.calls.length, `${t.name}: sem o alternador compartilhado`).toBeGreaterThan(0);
      expect(vi.mocked(RecordView).mock.calls.length, `${t.name}: sem a lista compartilhada`).toBeGreaterThan(0);
      expect(screen.getAllByTestId("view-mode-toggle"), t.name).toHaveLength(1); // um alternador por aba, e é o mesmo
    }
  });

  it("[TESTE OBRIGATÓRIO] cada arquivo importa o alternador e a lista dos mesmos módulos, e não tem alternador nem preferência próprios", () => {
    for (const [nome, src] of [
      ["CampaignsTable", campaignsSrc],
      ["DispatchCampaignTracker", trackerSrc],
      ["SavedSheetsCards", sheetsSrc],
      ["GeracaoDigitalProposals", proposalsSrc],
      ["ContractsList", contractsSrc],
    ] as const) {
      expect(src, nome).toContain('from "@/components/ViewModeToggle"');
      expect(src, nome).toContain('from "@/components/records/RecordView"');
      expect(src, nome).toContain('from "@/hooks/useViewMode"');
      expect(src, `${nome}: sem preferência de modo própria`).not.toMatch(/useLocalStorage|setViewProposta|setView\(|expandedContractId|expandedProposalId|expandedSheetId/);
      expect(src, `${nome}: sem botões de grade/lista próprios`).not.toMatch(/LayoutGrid|ListIcon|Visualizar em (cards|lista)|aria-label="Ver em lista"/);
    }
  });
});

describe("alternar não muda NADA do conteúdo, só a forma", () => {
  for (const t of TABS) {
    it(`[TESTE OBRIGATÓRIO] ${t.name}: os mesmos registros nos dois modos, sem filtro e com filtro`, async () => {
      await t.mount();

      expect(shown(t, "card")).toEqual(t.ids);
      clickList();
      expect(shown(t, "list")).toEqual(t.ids);
      expect(shown(t, "card")).toEqual([]); // em lista não sobra cartão
      clickCards();
      expect(shown(t, "card")).toEqual(t.ids);

      // com um filtro/busca ativo
      fireEvent.change(screen.getByPlaceholderText(t.searchPlaceholder), { target: { value: t.filterText } });
      expect(shown(t, "card")).toEqual(t.filterIds);
      clickList();
      expect(shown(t, "list")).toEqual(t.filterIds);
      // e o filtro continua o mesmo ao voltar
      clickCards();
      expect(shown(t, "card")).toEqual(t.filterIds);
    });

    it(`[TESTE OBRIGATÓRIO] ${t.name}: os campos do cartão fechado e os da linha são os mesmos (nomes e textos)`, async () => {
      await t.mount();
      const campos = (el: HTMLElement) =>
        [...el.querySelectorAll("[data-field]")].map((f) => [f.getAttribute("data-field")!, (f.textContent || "").replace(/\s+/g, " ").trim()] as [string, string]);

      const doCartao = new Map(t.ids.map((id) => [id, campos(screen.getByTestId(t.cardTestId(id)))]));
      clickList();
      for (const id of t.ids) {
        const daLinha = campos(screen.getByTestId(t.rowTestId(id)));
        const cartao = doCartao.get(id)!;
        expect(daLinha.map(([k]) => k).sort(), `${t.name}/${id}: campos diferentes`).toEqual(cartao.map(([k]) => k).sort());
        for (const [k, texto] of daLinha) expect(texto, `${t.name}/${id}/${k}`).toBe(cartao.find(([ck]) => ck === k)![1]);
      }
    });

    it(`[TESTE OBRIGATÓRIO] ${t.name}: a faixa de cor aparece nos dois modos, com a mesma cor para o mesmo registro`, async () => {
      await t.mount();
      for (const id of t.ids) {
        const card = screen.getByTestId(t.cardTestId(id));
        // a cor do cartão (faixa lateral ou borda esquerda) é a do registro, e a de nenhum outro
        expect(card.outerHTML, `${t.name}/${id}: cartão sem a cor`).toContain(t.cardColorClass(id).split(" ")[0]);
      }
      clickList();
      for (const id of t.ids) {
        const stripe = screen.getByTestId(`${t.rowTestId(id).replace(/-row-/, "-row-stripe-")}`);
        expect(stripe.className, `${t.name}/${id}: linha sem a faixa`).toContain(getStableColor(id).stripe.split(" ")[0]);
        for (const outro of t.ids.filter((x) => x !== id)) {
          expect(getStableColor(outro).stripe.split(" ")[0] === getStableColor(id).stripe.split(" ")[0] || !stripe.className.includes(getStableColor(outro).stripe.split(" ")[0])).toBe(true);
        }
      }
    });

    it(`[TESTE OBRIGATÓRIO] ${t.name}: em lista, expandir uma linha fecha a anterior — e abre o MESMO conteúdo do cartão aberto`, async () => {
      await t.mount();
      const [a, b] = t.ids;
      const abrir = (id: string, mode: "card" | "list") =>
        fireEvent.click(within(screen.getByTestId(mode === "card" ? t.cardTestId(id) : t.rowTestId(id))).getByRole("button", { name: /Ver detalhes/ }));
      // texto sem os botões + os rótulos dos botões: o conteúdo é o mesmo, e as ações de uso diário
      // que ficam NA linha (fora do expandido) somam-se ao expandido para dar as mesmas do cartão aberto
      const rotulo = (b: Element) => (b.getAttribute("aria-label") || b.textContent || "").replace(/\s+/g, " ").trim();
      const partes = (el: Element) => {
        const clone = el.cloneNode(true) as HTMLElement;
        const botoes = [...el.querySelectorAll("button")].map(rotulo);
        clone.querySelectorAll("button").forEach((b) => b.remove());
        return { texto: (clone.textContent || "").replace(/\s+/g, " ").trim(), botoes };
      };

      // aberto no cartão
      abrir(a, "card");
      const doCartao = partes(screen.getByTestId(t.cardExpandedTestId(a)));
      // o mesmo registro, agora em lista: continua aberto, com o mesmo conteúdo
      clickList();
      const linha = screen.getByTestId(t.rowTestId(a));
      const expandido = screen.getByTestId(t.rowExpandedTestId(a));
      const naLinha = [...linha.querySelectorAll("button")]
        .filter((b) => !expandido.contains(b))
        .map(rotulo)
        .filter((r) => !/detalhes/i.test(r) && !/^Selecion/i.test(r));
      const doExpandido = partes(expandido);
      expect(doExpandido.texto).toBe(doCartao.texto);
      expect([...doExpandido.botoes, ...naLinha].sort()).toEqual([...doCartao.botoes].sort());

      // abrir outro fecha este (um aberto por vez)
      abrir(b, "list");
      expect(screen.queryByTestId(t.rowExpandedTestId(a))).toBeNull();
      expect(screen.getByTestId(t.rowExpandedTestId(b))).toBeTruthy();
      // e fechar de novo
      fireEvent.click(within(screen.getByTestId(t.rowTestId(b))).getByRole("button", { name: /Recolher detalhes/ }));
      expect(screen.queryByTestId(t.rowExpandedTestId(b))).toBeNull();
    });
  }
});

describe("a escolha é lembrada por aba, no navegador", () => {
  it("[TESTE OBRIGATÓRIO] persiste ao sair e voltar", async () => {
    const campanhas = TABS[0];
    await campanhas.mount();
    clickList();
    expect(shown(campanhas, "list")).toEqual(campanhas.ids);

    cleanup(); // sai da aba
    await campanhas.mount(); // volta

    expect(shown(campanhas, "list")).toEqual(campanhas.ids);
    expect(screen.getByTestId("view-mode-toggle").getAttribute("data-mode")).toBe("list");
  });

  it("[TESTE OBRIGATÓRIO] é independente por aba: lista em Campanhas e cartão em Contratos convivem", async () => {
    const [campanhas, , , , contratos] = TABS;
    await campanhas.mount();
    clickList();
    cleanup();

    await contratos.mount();
    expect(screen.getByTestId("view-mode-toggle").getAttribute("data-mode")).toBe("card"); // nasce em cartão, sem herdar de Campanhas
    expect(shown(contratos, "card")).toEqual(contratos.ids);
    cleanup();

    await campanhas.mount();
    expect(screen.getByTestId("view-mode-toggle").getAttribute("data-mode")).toBe("list"); // Campanhas continua em lista

    expect(window.localStorage.getItem("vexo:view-mode:campanhas")).toBe('"list"');
    expect(window.localStorage.getItem("vexo:view-mode:contratos")).toBeNull(); // quem nunca escolheu não grava nada
  });

  it("cada aba grava sob a sua própria chave", async () => {
    for (const t of TABS) {
      cleanup();
      await t.mount();
      clickList();
      expect(window.localStorage.getItem(`vexo:view-mode:${t.tabKey}`), t.name).toBe('"list"');
    }
    const chaves = Object.keys(window.localStorage).filter((k) => k.startsWith("vexo:view-mode:"));
    expect(chaves.sort()).toEqual(TABS.map((t) => `vexo:view-mode:${t.tabKey}`).sort());
  });

  it("quem já tinha escolhido lista em Contratos ou Propostas antes do alternador único não perde a escolha", async () => {
    window.localStorage.setItem("gd_contratos_view", JSON.stringify("list"));
    window.localStorage.setItem("gd_propostas_view", JSON.stringify("list"));
    const [, , , propostas, contratos] = TABS;

    await contratos.mount();
    expect(screen.getByTestId("view-mode-toggle").getAttribute("data-mode")).toBe("list");
    cleanup();
    await propostas.mount();
    expect(screen.getByTestId("view-mode-toggle").getAttribute("data-mode")).toBe("list");
  });

  it("[TESTE OBRIGATÓRIO] é só do navegador: alternar não faz requisição ao servidor", async () => {
    const campanhas = TABS[0];
    await campanhas.mount();
    await waitFor(() => expect(true).toBe(true));
    const antes = fetchApiMock.mock.calls.length;

    clickList();
    clickCards();
    clickList();

    expect(fetchApiMock.mock.calls.length).toBe(antes);
  });

  it("sem storage (bloqueado), a tela funciona e alterna normalmente", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const getItem = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    const campanhas = TABS[0];
    await campanhas.mount();

    clickList();
    expect(shown(campanhas, "list")).toEqual(campanhas.ids);
    setItem.mockRestore();
    getItem.mockRestore();
  });
});

describe("no celular a lista vira cartão", () => {
  it("[TESTE OBRIGATÓRIO] em largura de celular, o modo é cartão e o alternador de lista está desabilitado, com a razão ao tocar", async () => {
    setWidth(375);
    for (const t of TABS) {
      cleanup();
      window.localStorage.clear();
      window.localStorage.setItem(`vexo:view-mode:${t.tabKey}`, JSON.stringify("list")); // quem prefere lista também vê cartão no celular
      await t.mount();

      expect(shown(t, "card"), `${t.name}: sem cartões no celular`).toEqual(t.ids);
      expect(shown(t, "list"), `${t.name}: lista no celular`).toEqual([]);
      const listBtn = screen.getByRole("button", { name: "Ver em lista" });
      expect(listBtn.getAttribute("aria-disabled"), t.name).toBe("true");
      expect(screen.queryByTestId("view-mode-reason")).toBeNull();

      fireEvent.click(listBtn); // tocar mostra a razão
      expect(screen.getByTestId("view-mode-reason").textContent, t.name).toContain("mais largura");
      expect(shown(t, "list")).toEqual([]); // tocar não troca de modo
      expect(window.localStorage.getItem(`vexo:view-mode:${t.tabKey}`), `${t.name}: tocar no botão desabilitado não pode mexer na escolha`).toBe('"list"');
    }
  });

  it("tocar no botão de lista desabilitado não grava escolha nenhuma", async () => {
    setWidth(375);
    const campanhas = TABS[0];
    await campanhas.mount();

    fireEvent.click(screen.getByRole("button", { name: "Ver em lista" }));

    expect(window.localStorage.getItem("vexo:view-mode:campanhas")).toBeNull();
    expect(screen.getByTestId("view-mode-toggle").getAttribute("data-mode")).toBe("card");
  });

  it("[TESTE OBRIGATÓRIO] mesmo com 'lista' lembrada, o celular mostra cartão — e a preferência volta quando a tela alarga", async () => {
    window.localStorage.setItem("vexo:view-mode:campanhas", JSON.stringify("list"));
    setWidth(375);
    const campanhas = TABS[0];
    await campanhas.mount();

    expect(shown(campanhas, "card")).toEqual(campanhas.ids);
    expect(window.localStorage.getItem("vexo:view-mode:campanhas")).toBe('"list"'); // a escolha não foi apagada

    setWidth(1280);
    await waitFor(() => expect(shown(campanhas, "list")).toEqual(campanhas.ids));
  });

  it("em tela larga o alternador diz qual modo está ativo", async () => {
    const campanhas = TABS[0];
    await campanhas.mount();

    expect(screen.getByRole("group", { name: /Modo de exibição: cartões/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver em cartões" }).getAttribute("aria-pressed")).toBe("true");
    clickList();
    expect(screen.getByRole("group", { name: /Modo de exibição: lista/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ver em lista" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Ver em lista" }).getAttribute("aria-disabled")).toBe("false");
  });
});

describe("ações de uso diário ficam na própria linha da lista", () => {
  const contratos = TABS.find((t) => t.name === "Contratos")!;
  const propostas = TABS.find((t) => t.name === "Propostas")!;
  const linha = (t: TabDef, id: string) => within(screen.getByTestId(t.rowTestId(id)));
  const noExpandido = (t: TabDef, id: string) => within(screen.getByTestId(t.rowExpandedTestId(id)));
  const PRINCIPAIS = [/Abrir \/ Baixar PDF/, /Enviar ao Jurídico/];
  const SECUNDARIAS = [/^Editar$/, /^Arquivar$/, /Subir contrato assinado/];

  it("[TESTE OBRIGATÓRIO] Contratos em lista: abrir/baixar o PDF e enviar ao jurídico estão acessíveis SEM expandir", async () => {
    await contratos.mount();
    clickList();

    for (const id of contratos.ids) {
      for (const nome of PRINCIPAIS) expect(linha(contratos, id).getByRole("button", { name: nome }), `${id}: ${nome}`).toBeTruthy();
      expect(screen.queryByTestId(contratos.rowExpandedTestId(id))).toBeNull(); // continua fechada
    }
  });

  it("[TESTE OBRIGATÓRIO] Contratos em lista: as ações secundárias NÃO estão na linha — continuam no expandido", async () => {
    await contratos.mount();
    clickList();
    const id = "ct-alpha";

    for (const nome of SECUNDARIAS) expect(linha(contratos, id).queryByRole("button", { name: nome }), `${nome} na linha`).toBeNull();

    fireEvent.click(linha(contratos, id).getByRole("button", { name: /Ver detalhes/ }));
    for (const nome of SECUNDARIAS) expect(noExpandido(contratos, id).getByRole("button", { name: nome }), `${nome} no expandido`).toBeTruthy();
    // sem duplicar: o que já está na linha não repete no expandido
    for (const nome of PRINCIPAIS) expect(noExpandido(contratos, id).queryByRole("button", { name: nome }), `${nome} repetido`).toBeNull();
  });

  it("contrato já assinado: baixar e substituir o assinado ficam no expandido (não na linha)", async () => {
    await contratos.mount();
    clickList();

    expect(linha(contratos, "ct-gama").queryByRole("button", { name: /Baixar contrato assinado/ })).toBeNull();
    fireEvent.click(linha(contratos, "ct-gama").getByRole("button", { name: /Ver detalhes/ }));
    expect(noExpandido(contratos, "ct-gama").getByRole("button", { name: /Baixar contrato assinado/ })).toBeTruthy();
    expect(noExpandido(contratos, "ct-gama").getByRole("button", { name: /Substituir assinado/ })).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] os botões da linha FAZEM a ação: o PDF abre pela rota do contrato e o envio ao jurídico pede confirmação e envia", async () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    URL.createObjectURL = vi.fn(() => "blob:x");
    URL.revokeObjectURL = vi.fn();
    await contratos.mount();
    clickList();

    fireEvent.click(linha(contratos, "ct-beta").getByRole("button", { name: /Abrir \/ Baixar PDF/ }));
    await waitFor(() => expect(fetchApiMock.mock.calls.some((c) => String(c[0]).includes("/api/gd/contracts/ct-beta/pdf"))).toBe(true));

    fireEvent.click(linha(contratos, "ct-beta").getByRole("button", { name: /Enviar ao Jurídico/ }));
    expect(window.confirm).toHaveBeenCalled();
    expect(juridicoMutateMock.mock.calls[0][0]).toBe("ct-beta");
  });

  it("no cartão aberto continuam TODAS as ações do contrato (nada some)", async () => {
    await contratos.mount();
    fireEvent.click(within(screen.getByTestId(contratos.cardTestId("ct-alpha"))).getByRole("button", { name: /Ver detalhes/ }));
    const aberto = within(screen.getByTestId(contratos.cardExpandedTestId("ct-alpha")));

    for (const nome of [...PRINCIPAIS, ...SECUNDARIAS]) expect(aberto.getByRole("button", { name: nome }), String(nome)).toBeTruthy();
  });

  it("[TESTE OBRIGATÓRIO] Propostas em lista: 'Abrir Proposta' está na linha (exceto as já fechadas) e não se repete no expandido", async () => {
    await propostas.mount();
    clickList();

    expect(linha(propostas, "prop-alpha").getByRole("button", { name: "Abrir Proposta" })).toBeTruthy(); // enviada
    expect(linha(propostas, "prop-beta").getByRole("button", { name: "Abrir Proposta" })).toBeTruthy(); // rascunho
    expect(linha(propostas, "prop-gama").queryByRole("button", { name: "Abrir Proposta" })).toBeNull(); // aceita: como no cartão, não abre

    fireEvent.click(linha(propostas, "prop-alpha").getByRole("button", { name: /Ver detalhes/ }));
    expect(noExpandido(propostas, "prop-alpha").queryByRole("button", { name: /Abrir Proposta/ })).toBeNull();
    expect(noExpandido(propostas, "prop-alpha").getByText(/Itens ofertados/)).toBeTruthy(); // o resto continua no expandido
  });

  it("Propostas: o botão da linha leva à proposta", async () => {
    await propostas.mount();
    clickList();

    fireEvent.click(linha(propostas, "prop-beta").getByRole("button", { name: "Abrir Proposta" }));

    expect(navigateMock).toHaveBeenCalledWith("/proposta/prop-beta");
  });

  it("as colunas do cabeçalho continuam alinhadas: a área de ações de Contratos tem a mesma largura no cabeçalho e na linha", async () => {
    await contratos.mount();
    clickList();

    const cabecalho = screen.getByTestId("contract-list-header");
    const espaco = [...cabecalho.children].find((c) => c.className.includes("w-[20rem]"));
    expect(espaco, "sem o espaço das ações no cabeçalho").toBeTruthy();
    expect(screen.getByTestId("contract-row-ct-alpha").innerHTML).toContain("w-[20rem]");
  });
});
