// src/test/listFilterTabs.test.tsx
//
// Campanhas, Fila de Envios e Planilhas Salvas, montadas de verdade, com a MESMA barra de busca e
// filtros (components/ListFilterBar). Aqui: o comportamento visto pelo usuário em cada aba, e a prova
// de que o componente é um só.

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, within, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import campaignsSrc from "../pages/LeadImports/CampaignsTable.tsx?raw";
import trackerSrc from "../pages/LeadImports/DispatchCampaignTracker.tsx?raw";
import sheetsSrc from "../pages/LeadImports/SavedSheetsCards.tsx?raw";

// ── a barra é o componente real, embrulhado num espião: dá para ver QUEM a renderizou ─────────────
vi.mock("@/components/ListFilterBar", async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, ListFilterBar: vi.fn(actual.ListFilterBar) };
});

const summaryMock = vi.fn();
vi.mock("@/hooks/useCampanhas", async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    useDispatchSummary: (clientId: any, scope: string, page: number, pageSize: number) => summaryMock(clientId, scope, page, pageSize),
    useCampaignDispatchBulkAction: () => ({ mutate: vi.fn(), isPending: false }),
  };
});
vi.mock("../pages/LeadImports/DispatchKpiCards", () => ({
  DispatchKpiCards: () => null,
  DispatchKpiCardsView: () => null,
}));

import { ListFilterBar } from "@/components/ListFilterBar";
import { CampaignsTable } from "../pages/LeadImports/CampaignsTable";
import { DispatchCampaignTracker } from "../pages/LeadImports/DispatchCampaignTracker";
import { SavedSheetsCards } from "../pages/LeadImports/SavedSheetsCards";

const fetchSpy = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  fetchSpy.mockReset();
  vi.stubGlobal("fetch", fetchSpy);
  try {
    localStorage.clear();
  } catch {
    /* sem storage: tudo bem */
  }
});

const noop = () => {};

// ── dados ────────────────────────────────────────────────────────────────────────────────────────
const campaign = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  name,
  client_id: "A",
  client_name: "Empresa",
  chip_name: null,
  import_id: null,
  limit_per_run: 50,
  status: "active",
  mode: "disparo",
  created_at: "2026-10-01T12:00:00Z",
  ...over,
});
const CAMPAIGNS = [
  campaign("c1", "Clínica Sorriso", { chip_name: "GD Gabriel", status: "active", mode: "agente" }),
  campaign("c2", "Black Friday", { chip_name: "GD Priscila", status: "paused", mode: "disparo" }),
  campaign("c3", "Clínica Vida", { chip_name: null, status: "draft", mode: "disparo" }),
  campaign("c4", "Natal", { chip_name: "GD Gabriel", status: "active", mode: "disparo" }),
] as any[];

const dispatchCampaign = (id: string, name: string, chip: string | null) => ({
  campaignId: id,
  campaignName: name,
  chipName: chip,
  loteCount: 1,
  leadsTotal: 100,
  leadsPending: 10,
  sentTotal: 80,
  failedTotal: 10,
  repliedCount: 5,
  status: "agendada",
  statusLabel: "Agendada",
  nextScheduledAt: null,
  eta: null,
  leadsActionable: { pause: 0, resume: 0, cancel: 0 },
  batches: [],
});
const QUEUE_ACTIVE = [
  dispatchCampaign("d1", "Clínica Sorriso", "GD Gabriel"),
  dispatchCampaign("d2", "Black Friday", "GD Priscila"),
  dispatchCampaign("d3", "Natal", "GD Gabriel"),
  dispatchCampaign("d4", "Páscoa", null),
];
const QUEUE_ENDED = [dispatchCampaign("e1", "Dia das Mães", "GD Priscila")];

function setupQueue(active = QUEUE_ACTIVE, ended = QUEUE_ENDED, totalForScope?: Partial<Record<"active" | "ended", number>>) {
  summaryMock.mockImplementation((_c: any, scope: "active" | "ended") => {
    const list = scope === "active" ? active : ended;
    return {
      isLoading: false,
      data: {
        campaigns: list,
        counts: { active: active.length, ended: ended.length },
        scope,
        page: 1,
        pageSize: scope === "active" ? 100 : 20,
        totalForScope: totalForScope?.[scope] ?? list.length,
        kpis: { periodLabel: "30d", campaigns: 0, leads: 0, sent: 0, deliveryRate: null },
      },
    };
  });
}

const sheet = (id: string, name: string, email: string | null, createdAt: string) => ({
  id,
  client_id: "A",
  source_name: name,
  source_type: "spreadsheet",
  total_rows: 100,
  imported_rows: 90,
  skipped_rows: 10,
  uploaded_by_uid: null,
  uploaded_by_email: email,
  created_at: createdAt,
});
const SHEETS = [
  sheet("s1", "base_clinicas.xlsx", "ana@vexo.com", "2026-09-02T15:00:00"),
  sheet("s2", "Leads Setembro.csv", "bia@vexo.com", "2026-09-15T15:00:00"),
  sheet("s3", "Clínicas Zona Sul.xlsx", "ana@vexo.com", "2026-10-01T15:00:00"),
  sheet("s4", "Antigos.xlsx", null, "2026-10-02T15:00:00"),
] as any[];

const renderCampaigns = () =>
  render(<CampaignsTable clientId="A" campaigns={CAMPAIGNS} loadingCampaigns={false} onEditCampaign={noop} onDuplicateCampaign={noop} onDeleteCampaign={noop} />);
const renderQueue = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DispatchCampaignTracker clientId="A" onOpenDispatch={noop} />
    </QueryClientProvider>
  );
const renderSheets = () => render(<SavedSheetsCards imports={SHEETS} onViewImport={noop} onDeleteImport={noop} />);

const type = (placeholder: RegExp, text: string) => fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: text } });
const cards = (prefix: string) => screen.queryAllByTestId(new RegExp(`^${prefix}`));
const pick = (group: string, label: string) =>
  fireEvent.click(within(screen.getByRole("group", { name: group })).getByRole("button", { name: label }));

// ── a prova de que é UM componente ───────────────────────────────────────────────────────────────
describe("as três abas usam o MESMO componente de busca", () => {
  it("[TESTE OBRIGATÓRIO] a mesma função ListFilterBar é a que cada aba renderiza (não três parecidas)", () => {
    const spy = vi.mocked(ListFilterBar);

    renderCampaigns();
    cleanup();
    setupQueue();
    renderQueue();
    cleanup();
    renderSheets();

    const testIds = spy.mock.calls.map(([props]) => (props as any).testId);
    expect(new Set(testIds)).toEqual(new Set(["campaigns-filter", "queue-filter", "sheets-filter"]));
    // as três vieram do mesmo módulo e da mesma função: o espião é um só
    expect(spy).toBeDefined();
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("[TESTE OBRIGATÓRIO] cada arquivo de aba importa a barra do mesmo módulo e não tem busca própria", () => {
    for (const [nome, src] of [
      ["CampaignsTable", campaignsSrc],
      ["DispatchCampaignTracker", trackerSrc],
      ["SavedSheetsCards", sheetsSrc],
    ] as const) {
      expect(src, nome).toContain('from "@/components/ListFilterBar"');
      expect(src, nome).toContain('from "@/hooks/useListFilter"');
      expect(src, `${nome}: sem campo de busca próprio`).not.toMatch(/searchTerm|setSearch\b|placeholder="Buscar|type="search"/);
      expect(src, `${nome}: sem comparação de texto própria`).not.toMatch(/toLowerCase\(\)\.includes|\.normalize\(/);
    }
  });

  it("as três montam as barras com a mesma estrutura (campo de busca + a mesma regra de contador)", () => {
    renderCampaigns();
    const campaignsBar = screen.getByTestId("campaigns-filter");
    expect(within(campaignsBar).getByRole("searchbox")).toBeTruthy();
    cleanup();
    setupQueue();
    renderQueue();
    expect(within(screen.getByTestId("queue-filter")).getByRole("searchbox")).toBeTruthy();
    cleanup();
    renderSheets();
    expect(within(screen.getByTestId("sheets-filter")).getByRole("searchbox")).toBeTruthy();
  });
});

// ── Campanhas ────────────────────────────────────────────────────────────────────────────────────
describe("Campanhas", () => {
  it("[TESTE OBRIGATÓRIO] sem filtro nenhum, mostra todas, sem contador e sem 'limpar'", () => {
    renderCampaigns();

    expect(cards("campaign-card-")).toHaveLength(4);
    expect(screen.queryByTestId("campaigns-filter-count")).toBeNull();
    expect(screen.queryByRole("button", { name: /Limpar filtros/ })).toBeNull();
    for (const b of within(screen.getByRole("group", { name: "Estado" })).getAllByRole("button")) expect(b.getAttribute("aria-pressed")).toBe("false");
  });

  it("[TESTE OBRIGATÓRIO] filtra enquanto digita, sem acento e sem diferenciar maiúscula: 'clinica' acha 'Clínica'", () => {
    renderCampaigns();

    type(/Buscar/, "clinica");

    expect(cards("campaign-card-").map((c) => c.getAttribute("data-testid"))).toEqual(["campaign-card-c1", "campaign-card-c3"]);
    expect(screen.queryByRole("button", { name: /^Buscar$/ })).toBeNull(); // sem botão de buscar
    type(/Buscar/, "CLÍNICA");
    expect(cards("campaign-card-")).toHaveLength(2);
  });

  it("[TESTE OBRIGATÓRIO] parte do nome acha", () => {
    renderCampaigns();
    type(/Buscar/, "k frid");
    expect(cards("campaign-card-").map((c) => c.getAttribute("data-testid"))).toEqual(["campaign-card-c2"]);
  });

  it("busca também pelo NOME DO CHIP", () => {
    renderCampaigns();
    type(/Buscar/, "priscila");
    expect(cards("campaign-card-").map((c) => c.getAttribute("data-testid"))).toEqual(["campaign-card-c2"]);
  });

  it("[TESTE OBRIGATÓRIO] estado combina com a busca — os dois ao mesmo tempo", () => {
    renderCampaigns();

    type(/Buscar/, "gabriel"); // c1 (ativa) e c4 (ativa)
    pick("Estado", "Ativa");
    expect(cards("campaign-card-")).toHaveLength(2);
    pick("Modo", "Agente IA"); // só c1 é agente
    expect(cards("campaign-card-").map((c) => c.getAttribute("data-testid"))).toEqual(["campaign-card-c1"]);
    expect(screen.getByTestId("campaigns-filter-count").textContent).toBe("Mostrando 1 de 4");
  });

  it("filtros de estado: ativa, pausada e rascunho — dentro do mesmo filtro vale 'ou'", () => {
    renderCampaigns();
    pick("Estado", "Pausada");
    expect(cards("campaign-card-")).toHaveLength(1);
    pick("Estado", "Rascunho");
    expect(cards("campaign-card-").map((c) => c.getAttribute("data-testid"))).toEqual(["campaign-card-c2", "campaign-card-c3"]);
  });

  it("filtro de modo: agente x disparo direto", () => {
    renderCampaigns();
    pick("Modo", "Disparo direto");
    expect(cards("campaign-card-")).toHaveLength(3);
  });

  it("[TESTE OBRIGATÓRIO] o contador mostra filtrados de total e some quando não há filtro", () => {
    renderCampaigns();
    expect(screen.queryByTestId("campaigns-filter-count")).toBeNull();

    type(/Buscar/, "natal");
    expect(screen.getByTestId("campaigns-filter-count").textContent).toBe("Mostrando 1 de 4");

    type(/Buscar/, "");
    expect(screen.queryByTestId("campaigns-filter-count")).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] limpar devolve a lista inteira e o 'limpar' some", () => {
    renderCampaigns();
    type(/Buscar/, "natal");
    pick("Estado", "Ativa");
    expect(cards("campaign-card-")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: /Limpar filtros/ }));

    expect(cards("campaign-card-")).toHaveLength(4);
    expect((screen.getByPlaceholderText(/Buscar/) as HTMLInputElement).value).toBe("");
    expect(screen.queryByRole("button", { name: /Limpar filtros/ })).toBeNull();
    expect(screen.queryByTestId("campaigns-filter-count")).toBeNull();
  });

  it("sem resultado: avisa que há filtro e oferece limpar (não parece que sumiu tudo)", () => {
    renderCampaigns();
    type(/Buscar/, "zzzz");

    expect(screen.getByText(/corresponde à busca ou aos filtros/)).toBeTruthy();
    expect(screen.getByTestId("campaigns-filter-count").textContent).toBe("Mostrando 0 de 4");
    expect(screen.getByRole("button", { name: /Limpar filtros/ })).toBeTruthy();
  });
});

describe("Campanhas — estados e último chip", () => {
  const todos = ["active", "paused", "draft", "scheduled", "processing", "sent", "failed", "cancelled"].map((status, i) =>
    campaign(`e${i}`, `Campanha ${status}`, { status, chip_name: i === 3 ? "GD Priscila" : null })
  ) as any[];
  const renderTodos = () =>
    render(<CampaignsTable clientId="A" campaigns={todos} loadingCampaigns={false} onEditCampaign={noop} onDuplicateCampaign={noop} onDeleteCampaign={noop} />);

  it("[TESTE OBRIGATÓRIO] quem filtra por 'Ativa' não perde a campanha agendada: ela tem o próprio filtro, e cada estado acha a sua", () => {
    renderTodos();

    for (const [label, status] of [
      ["Ativa", "active"],
      ["Pausada", "paused"],
      ["Rascunho", "draft"],
      ["Agendada", "scheduled"],
      ["Executando", "processing"],
      ["Enviada", "sent"],
      ["Falhou", "failed"],
      ["Cancelada", "cancelled"],
    ]) {
      pick("Estado", label);
      expect(cards("campaign-card-").map((c) => within(c).getByTestId(/^campaign-name-/).textContent), label).toEqual([`Campanha ${status}`]);
      pick("Estado", label); // desliga
    }
    expect(cards("campaign-card-")).toHaveLength(8);
  });

  it("o selo do cartão usa o mesmo nome do filtro, em português (não o valor cru do banco)", () => {
    renderTodos();
    expect(within(screen.getByTestId("campaign-card-e3")).getByTestId("campaign-status-e3").textContent).toBe("Agendada");
    expect(within(screen.getByTestId("campaign-card-e7")).getByTestId("campaign-status-e7").textContent).toBe("Cancelada");
  });

  it("[TESTE OBRIGATÓRIO] o chip aparece rotulado como 'Último chip' (não como 'o chip da campanha')", () => {
    renderTodos();
    expect(screen.getByPlaceholderText(/último chip/)).toBeTruthy();

    fireEvent.click(within(screen.getByTestId("campaign-card-e3")).getByRole("button", { name: /Ver detalhes/ }));

    expect(screen.getByTestId("campaign-last-chip-e3").textContent).toContain("Último chip: GD Priscila");
  });

  it("campanha que ainda não tem lote diz isso, em vez de mostrar um chip vazio", () => {
    renderTodos();
    fireEvent.click(within(screen.getByTestId("campaign-card-e0")).getByRole("button", { name: /Ver detalhes/ }));
    expect(screen.getByTestId("campaign-last-chip-e0").textContent).toContain("Nenhum lote enviado ainda");
  });
});

// ── Fila de Envios ───────────────────────────────────────────────────────────────────────────────
describe("Fila de Envios", () => {
  it("[TESTE OBRIGATÓRIO] sem filtro, mostra todas as ativas; as abas Ativas e Encerradas continuam", () => {
    setupQueue();
    renderQueue();

    expect(cards("dispatch-card-")).toHaveLength(4);
    expect(screen.getByText("Ativas (4)")).toBeTruthy();
    expect(screen.getByText("Encerradas (1)")).toBeTruthy();
    expect(screen.queryByTestId("queue-filter-count")).toBeNull();
  });

  it("busca por nome da campanha e por nome do chip, sem acento", () => {
    setupQueue();
    renderQueue();

    type(/Buscar/, "pascoa");
    expect(cards("dispatch-card-").map((c) => c.getAttribute("data-testid"))).toEqual(["dispatch-card-d4"]);
    type(/Buscar/, "priscila");
    expect(cards("dispatch-card-").map((c) => c.getAttribute("data-testid"))).toEqual(["dispatch-card-d2"]);
  });

  it("[TESTE OBRIGATÓRIO] filtro por chip (inclui 'Sem chip') combina com a busca", () => {
    setupQueue();
    renderQueue();

    pick("Último chip", "GD Gabriel");
    expect(cards("dispatch-card-")).toHaveLength(2);
    type(/Buscar/, "natal");
    expect(cards("dispatch-card-").map((c) => c.getAttribute("data-testid"))).toEqual(["dispatch-card-d3"]);
    expect(screen.getByTestId("queue-filter-count").textContent).toBe("Mostrando 1 de 4");

    fireEvent.click(screen.getByRole("button", { name: /Limpar filtros/ }));
    pick("Último chip", "Sem chip");
    expect(cards("dispatch-card-").map((c) => c.getAttribute("data-testid"))).toEqual(["dispatch-card-d4"]);
  });

  it("trocar de aba (Ativas → Encerradas) limpa o filtro: as opções de chip são outras", () => {
    setupQueue();
    renderQueue();
    pick("Último chip", "GD Gabriel");
    expect(cards("dispatch-card-")).toHaveLength(2);

    fireEvent.click(screen.getByText("Encerradas (1)"));

    expect(cards("dispatch-card-")).toHaveLength(1);
    expect(screen.queryByTestId("queue-filter-count")).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] com mais campanhas no servidor do que carregadas, avisa que o filtro vale só para as carregadas", () => {
    setupQueue(QUEUE_ACTIVE, QUEUE_ENDED, { active: 250 });
    renderQueue();

    expect(screen.queryByText(/O filtro vale só para/)).toBeNull(); // sem filtro, sem aviso
    type(/Buscar/, "natal");
    expect(screen.getByText(/O filtro vale só para as 4 carregadas; há 250 no total/)).toBeTruthy();
  });
});

// ── Planilhas Salvas ─────────────────────────────────────────────────────────────────────────────
describe("Planilhas Salvas", () => {
  it("[TESTE OBRIGATÓRIO] sem filtro, todas aparecem, sem contador", () => {
    renderSheets();
    expect(cards("sheet-card-(?!stripe-)")).toHaveLength(4);
    expect(screen.queryByTestId("sheets-filter-count")).toBeNull();
  });

  it("busca por nome do arquivo (sem acento) e por quem importou", () => {
    renderSheets();

    type(/Buscar/, "clinicas");
    expect(cards("sheet-card-(?!stripe-)").map((c) => c.getAttribute("data-testid"))).toEqual(["sheet-card-s1", "sheet-card-s3"]);
    type(/Buscar/, "bia@");
    expect(cards("sheet-card-(?!stripe-)").map((c) => c.getAttribute("data-testid"))).toEqual(["sheet-card-s2"]);
  });

  it("filtro por quem importou, com 'Não informado' para os sem usuário", () => {
    renderSheets();

    pick("Importado por", "ana@vexo.com");
    expect(cards("sheet-card-(?!stripe-)")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Limpar filtros/ }));
    pick("Importado por", "Não informado");
    expect(cards("sheet-card-(?!stripe-)").map((c) => c.getAttribute("data-testid"))).toEqual(["sheet-card-s4"]);
  });

  it("[TESTE OBRIGATÓRIO] período de importação combina com a busca e com quem importou", () => {
    renderSheets();

    fireEvent.change(screen.getByLabelText("Período de importação — de"), { target: { value: "2026-09-10" } });
    fireEvent.change(screen.getByLabelText("Período de importação — até"), { target: { value: "2026-10-01" } });
    expect(cards("sheet-card-(?!stripe-)").map((c) => c.getAttribute("data-testid"))).toEqual(["sheet-card-s2", "sheet-card-s3"]);

    type(/Buscar/, "clinicas");
    expect(cards("sheet-card-(?!stripe-)").map((c) => c.getAttribute("data-testid"))).toEqual(["sheet-card-s3"]);
    expect(screen.getByTestId("sheets-filter-count").textContent).toBe("Mostrando 1 de 4");
  });

  it("[TESTE OBRIGATÓRIO] limpar devolve todas, inclusive zerando o período", () => {
    renderSheets();
    fireEvent.change(screen.getByLabelText("Período de importação — de"), { target: { value: "2026-10-01" } });
    expect(cards("sheet-card-(?!stripe-)")).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: /Limpar filtros/ }));

    expect(cards("sheet-card-(?!stripe-)")).toHaveLength(4);
    expect((screen.getByLabelText("Período de importação — de") as HTMLInputElement).value).toBe("");
  });
});

// ── sem servidor, sem memória ────────────────────────────────────────────────────────────────────
describe("o filtro é só do navegador", () => {
  it("[TESTE OBRIGATÓRIO] digitar e filtrar não faz nenhuma requisição ao servidor, em nenhuma das três abas", () => {
    // Campanhas e Planilhas recebem a lista pronta: não há requisição alguma
    renderCampaigns();
    type(/Buscar/, "clinica");
    pick("Estado", "Ativa");
    cleanup();
    renderSheets();
    type(/Buscar/, "clinicas");
    pick("Importado por", "ana@vexo.com");
    cleanup();
    expect(fetchSpy).not.toHaveBeenCalled();

    // A Fila consulta o resumo: digitar não pode trocar os argumentos da consulta (outra chamada ao servidor)
    setupQueue();
    renderQueue();
    const antes = new Set(summaryMock.mock.calls.map((c) => JSON.stringify(c)));
    type(/Buscar/, "natal");
    pick("Último chip", "GD Gabriel");
    const depois = new Set(summaryMock.mock.calls.map((c) => JSON.stringify(c)));
    expect(depois).toEqual(antes);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("[TESTE OBRIGATÓRIO] a escolha não é lembrada: nada vai ao storage e uma nova visita começa limpa", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    renderCampaigns();
    type(/Buscar/, "natal");
    pick("Estado", "Ativa");
    expect(cards("campaign-card-")).toHaveLength(1);
    expect(setItem).not.toHaveBeenCalled();

    cleanup(); // sai da aba e volta
    renderCampaigns();

    expect(cards("campaign-card-")).toHaveLength(4);
    expect((screen.getByPlaceholderText(/Buscar/) as HTMLInputElement).value).toBe("");
    expect(screen.queryByTestId("campaigns-filter-count")).toBeNull();
    setItem.mockRestore();
  });
});
