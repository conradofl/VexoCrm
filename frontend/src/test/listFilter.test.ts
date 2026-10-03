// src/test/listFilter.test.ts
//
// A regra única de busca/filtro (lib/listFilter.ts) que Campanhas, Fila de Envios e Planilhas Salvas
// compartilham. As três abas, montadas de verdade, são testadas em listFilterTabs.test.tsx.

import { describe, it, expect } from "vitest";
import {
  EMPTY_FILTER_STATE,
  filterList,
  hasActiveFilter,
  matchesSearch,
  normalizeSearchText,
  resolveFacetOptions,
  type ListFilterConfig,
  type ListFilterState,
} from "../lib/listFilter";
import { CAMPAIGNS_FILTER, DISPATCH_QUEUE_FILTER, SAVED_SHEETS_FILTER, campaignStateKey } from "../lib/leadImportsListFilters";
import { CAMPAIGN_STATUS_LABELS } from "../hooks/useCampanhas";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const state = (over: Partial<ListFilterState> = {}): ListFilterState => ({ ...EMPTY_FILTER_STATE, ...over });

describe("normalizeSearchText / matchesSearch", () => {
  it("[TESTE OBRIGATÓRIO] sem acento acha com acento, e o contrário", () => {
    expect(matchesSearch(["Clínica Sorriso"], "clinica")).toBe(true);
    expect(matchesSearch(["Clinica Sorriso"], "CLÍNICA")).toBe(true);
    expect(matchesSearch(["Ação & Coração"], "acao")).toBe(true);
    expect(matchesSearch(["Acao"], "ação")).toBe(true);
  });

  it("não diferencia maiúscula de minúscula", () => {
    expect(matchesSearch(["BLACK FRIDAY"], "black friday")).toBe(true);
    expect(matchesSearch(["black friday"], "BLACK")).toBe(true);
  });

  it("[TESTE OBRIGATÓRIO] parte do nome basta, no começo, no meio ou no fim", () => {
    expect(matchesSearch(["Campanha Black Friday 2026"], "camp")).toBe(true);
    expect(matchesSearch(["Campanha Black Friday 2026"], "k fri")).toBe(true);
    expect(matchesSearch(["Campanha Black Friday 2026"], "2026")).toBe(true);
    expect(matchesSearch(["Campanha Black Friday 2026"], "natal")).toBe(false);
  });

  it("espaços sobrando no texto digitado ou no registro não atrapalham", () => {
    expect(matchesSearch(["Clínica   Sorriso"], "  clinica sorriso ")).toBe(true);
    expect(normalizeSearchText("  CLÍNICA  Sorriso ")).toBe("clinica sorriso");
  });

  it("procura em todos os campos informados e ignora campo vazio", () => {
    expect(matchesSearch(["Campanha A", "GD Gabriel"], "gabriel")).toBe(true);
    expect(matchesSearch(["Campanha A", null, undefined], "gabriel")).toBe(false);
  });

  it("[TESTE OBRIGATÓRIO] texto vazio (ou só espaços) casa com tudo", () => {
    expect(matchesSearch(["qualquer"], "")).toBe(true);
    expect(matchesSearch([null], "   ")).toBe(true);
  });
});

interface Row {
  name: string;
  chip: string | null;
  status: string;
  at: string;
}
const rows: Row[] = [
  { name: "Clínica Sorriso", chip: "GD Gabriel", status: "active", at: "2026-09-02T15:00:00" },
  { name: "Black Friday", chip: "GD Priscila", status: "paused", at: "2026-09-15T15:00:00" },
  { name: "Clínica Vida", chip: null, status: "draft", at: "2026-10-01T15:00:00" },
  { name: "Natal", chip: "GD Gabriel", status: "active", at: "2026-10-02T15:00:00" },
];
const cfg: ListFilterConfig<Row> = {
  searchFields: (r) => [r.name, r.chip],
  facets: [
    { id: "status", label: "Estado", getValue: (r) => r.status },
    { id: "chip", label: "Chip", getValue: (r) => r.chip, emptyLabel: "Sem chip" },
  ],
  ranges: [{ id: "period", label: "Período", getDate: (r) => r.at }],
};

describe("filterList", () => {
  it("[TESTE OBRIGATÓRIO] sem filtro nenhum, a lista é a completa — e na mesma ordem", () => {
    expect(filterList(rows, EMPTY_FILTER_STATE, cfg)).toEqual(rows);
  });

  it("[TESTE OBRIGATÓRIO] filtro vazio não esconde nada: seleção vazia e período vazio equivalem a nenhum filtro", () => {
    const vazio = state({ facets: { status: [], chip: [] }, ranges: { period: { from: "", to: "" } } });
    expect(filterList(rows, vazio, cfg)).toEqual(rows);
    expect(hasActiveFilter(vazio)).toBe(false);
  });

  it("[TESTE OBRIGATÓRIO] estado combina com a busca — os dois ao mesmo tempo", () => {
    const soBusca = filterList(rows, state({ search: "clinica" }), cfg).map((r) => r.name);
    const soEstado = filterList(rows, state({ facets: { status: ["active"] } }), cfg).map((r) => r.name);
    const ambos = filterList(rows, state({ search: "clinica", facets: { status: ["active"] } }), cfg).map((r) => r.name);

    expect(soBusca).toEqual(["Clínica Sorriso", "Clínica Vida"]);
    expect(soEstado).toEqual(["Clínica Sorriso", "Natal"]);
    expect(ambos).toEqual(["Clínica Sorriso"]); // interseção, não união
  });

  it("dentro de um filtro vale 'ou' (ativa OU pausada); entre filtros vale 'e'", () => {
    expect(filterList(rows, state({ facets: { status: ["active", "paused"] } }), cfg).map((r) => r.name)).toEqual([
      "Clínica Sorriso",
      "Black Friday",
      "Natal",
    ]);
    expect(filterList(rows, state({ facets: { status: ["active", "paused"], chip: ["GD Gabriel"] } }), cfg).map((r) => r.name)).toEqual([
      "Clínica Sorriso",
      "Natal",
    ]);
  });

  it("quem não tem valor entra pelo filtro 'Sem …' (valor vazio)", () => {
    expect(filterList(rows, state({ facets: { chip: [""] } }), cfg).map((r) => r.name)).toEqual(["Clínica Vida"]);
  });

  it("período: dias locais inclusivos nas duas pontas, de só um lado também vale", () => {
    const names = (range: { from: string; to: string }) => filterList(rows, state({ ranges: { period: range } }), cfg).map((r) => r.name);

    expect(names({ from: "2026-09-15", to: "2026-10-01" })).toEqual(["Black Friday", "Clínica Vida"]); // pontas incluídas
    expect(names({ from: "2026-10-01", to: "" })).toEqual(["Clínica Vida", "Natal"]);
    expect(names({ from: "", to: "2026-09-02" })).toEqual(["Clínica Sorriso"]);
  });

  it("período: meia-noite do dia inicial e o último instante do dia final entram", () => {
    const limites = [
      { ...rows[0], name: "meia-noite", at: "2026-09-10T00:00:00" },
      { ...rows[0], name: "último instante", at: "2026-09-12T23:59:59.999" },
      { ...rows[0], name: "um instante antes", at: "2026-09-09T23:59:59.999" },
      { ...rows[0], name: "um instante depois", at: "2026-09-13T00:00:00" },
    ];
    const dentro = filterList(limites, state({ ranges: { period: { from: "2026-09-10", to: "2026-09-12" } } }), cfg).map((r) => r.name);

    expect(dentro).toEqual(["meia-noite", "último instante"]);
  });

  it("período ativo esconde o registro sem data (não há como provar que está dentro)", () => {
    const semData = [{ ...rows[0], at: "" }];
    expect(filterList(semData, state({ ranges: { period: { from: "2026-01-01", to: "" } } }), cfg)).toEqual([]);
  });

  it("não altera a lista de entrada", () => {
    const copia = [...rows];
    filterList(rows, state({ search: "natal" }), cfg);
    expect(rows).toEqual(copia);
  });
});

describe("resolveFacetOptions", () => {
  it("tira as opções dos próprios itens, sem repetir, em ordem alfabética, com 'Sem …' por último", () => {
    const options = resolveFacetOptions(cfg.facets![1], rows);
    expect(options).toEqual([
      { value: "GD Gabriel", label: "GD Gabriel" },
      { value: "GD Priscila", label: "GD Priscila" },
      { value: "", label: "Sem chip" },
    ]);
  });

  it("usa as opções declaradas quando existem", () => {
    expect(resolveFacetOptions({ ...cfg.facets![0], options: [{ value: "x", label: "X" }] }, rows)).toEqual([{ value: "x", label: "X" }]);
  });
});

describe("o que cada aba procura (configs)", () => {
  const campaign = { name: "Black Friday", chip_name: "GD Gabriel", status: "active", mode: "agente" } as any;
  const dispatch = { campaignName: "Black Friday", chipName: "GD Gabriel" } as any;
  const sheet = { source_name: "base_clinicas.xlsx", uploaded_by_email: "ana@vexo.com", created_at: "2026-10-01T12:00:00" } as any;

  it("[TESTE OBRIGATÓRIO] Campanhas: nome da campanha e nome do chip", () => {
    expect(CAMPAIGNS_FILTER.searchFields(campaign)).toEqual(["Black Friday", "GD Gabriel"]);
  });

  it("[TESTE OBRIGATÓRIO] Fila de Envios: nome da campanha e nome do chip", () => {
    expect(DISPATCH_QUEUE_FILTER.searchFields(dispatch)).toEqual(["Black Friday", "GD Gabriel"]);
  });

  it("[TESTE OBRIGATÓRIO] Planilhas Salvas: nome do arquivo e quem importou", () => {
    expect(SAVED_SHEETS_FILTER.searchFields(sheet)).toEqual(["base_clinicas.xlsx", "ana@vexo.com"]);
  });

  it("Campanhas: filtro de estado com TODOS os estados, e filtro de modo (agente, disparo direto)", () => {
    const [state, mode] = CAMPAIGNS_FILTER.facets!;
    expect(resolveFacetOptions(state, []).map((o) => o.label)).toEqual([
      "Ativa",
      "Pausada",
      "Rascunho",
      "Agendada",
      "Executando",
      "Enviada",
      "Falhou",
      "Cancelada",
      "Interrompido",
    ]);
    expect(resolveFacetOptions(mode, []).map((o) => o.label)).toEqual(["Agente IA", "Disparo direto"]);
  });

  it("campanha sem estado conta como Rascunho; cada estado conhecido é ele mesmo", () => {
    expect(campaignStateKey({ status: "" } as any)).toBe("draft");
    expect(campaignStateKey({ status: undefined } as any)).toBe("draft");
    for (const status of Object.keys(CAMPAIGN_STATUS_LABELS)) expect(campaignStateKey({ status } as any)).toBe(status);
  });

  it("modo: o que não é agente conta como disparo direto, como o cartão mostra", () => {
    const mode = CAMPAIGNS_FILTER.facets![1];
    expect(mode.getValue({ mode: "agente" } as any)).toBe("agente");
    expect(mode.getValue({ mode: "disparo" } as any)).toBe("disparo");
    expect(mode.getValue({ mode: undefined } as any)).toBe("disparo");
  });

  it("Fila de Envios: filtro por último chip; Planilhas Salvas: período de importação e quem importou", () => {
    expect(DISPATCH_QUEUE_FILTER.facets!.map((f) => f.id)).toEqual(["chip"]);
    expect(SAVED_SHEETS_FILTER.facets!.map((f) => f.id)).toEqual(["uploader"]);
    expect(SAVED_SHEETS_FILTER.ranges!.map((r) => r.id)).toEqual(["period"]);
  });
});

// ── nenhum registro fica fora do alcance dos filtros ─────────────────────────────────────────────
describe("alcançabilidade: para cada valor que existe, há um filtro que o encontra", () => {
  const campaignWith = (status: string | null | undefined, id = status ?? "sem-estado") => ({ id, name: `c-${id}`, status, mode: "disparo", chip_name: null }) as any;

  // os estados que o BANCO aceita, lidos da restrição da tabela (não copiados à mão)
  const migration = readFileSync(resolve(process.cwd(), "../backend/supabase/migrations/20260503000012_campaign_dispatch_runner.sql"), "utf8");
  const dbStatuses = [...(/campaigns_status_check\s+CHECK \(status IN \(([^)]*)\)\)/.exec(migration)?.[1] ?? "").matchAll(/'([^']+)'/g)].map((m) => m[1]);

  it("a restrição do banco foi lida (não é uma lista vazia)", () => {
    expect(dbStatuses).toEqual(expect.arrayContaining(["active", "paused", "draft", "scheduled", "processing", "sent", "failed", "cancelled"]));
  });

  it("[TESTE OBRIGATÓRIO] cada estado que existe no banco tem uma opção de filtro que encontra a campanha", () => {
    const stateFacet = CAMPAIGNS_FILTER.facets![0];
    for (const status of dbStatuses) {
      const item = campaignWith(status);
      const options = resolveFacetOptions(stateFacet, [item]);
      const achados = options.filter((o) => filterList([item], state({ facets: { state: [o.value] } }), CAMPAIGNS_FILTER).length === 1);

      expect(achados.length, `estado '${status}' sem filtro que o encontre`).toBeGreaterThan(0);
      expect(achados[0].label).toBe(CAMPAIGN_STATUS_LABELS[status as keyof typeof CAMPAIGN_STATUS_LABELS]);
    }
  });

  it("[TESTE OBRIGATÓRIO] cada estado do tipo CampaignStatus (inclui 'interrompido') também tem filtro", () => {
    for (const status of Object.keys(CAMPAIGN_STATUS_LABELS)) {
      const item = campaignWith(status);
      expect(filterList([item], state({ facets: { state: [campaignStateKey(item)] } }), CAMPAIGNS_FILTER), status).toHaveLength(1);
      expect(resolveFacetOptions(CAMPAIGNS_FILTER.facets![0], [item]).some((o) => o.value === campaignStateKey(item)), status).toBe(true);
    }
  });

  it("[TESTE OBRIGATÓRIO] estado desconhecido (legado ou futuro) cai em 'Outros', que só aparece quando existe — e o encontra", () => {
    const stateFacet = CAMPAIGNS_FILTER.facets![0];
    const estranho = campaignWith("arquivada-por-engano", "x");

    expect(resolveFacetOptions(stateFacet, [campaignWith("active")]).some((o) => o.label === "Outros")).toBe(false);
    const options = resolveFacetOptions(stateFacet, [estranho]);
    const outros = options.find((o) => o.label === "Outros")!;
    expect(outros).toBeDefined();
    expect(filterList([estranho], state({ facets: { state: [outros.value] } }), CAMPAIGNS_FILTER)).toHaveLength(1);
  });

  it("campanha sem estado é encontrada por Rascunho", () => {
    const semEstado = campaignWith("", "vazio");
    expect(filterList([semEstado], state({ facets: { state: ["draft"] } }), CAMPAIGNS_FILTER)).toHaveLength(1);
  });

  it("[TESTE OBRIGATÓRIO] selecionar TODAS as opções de qualquer filtro devolve a lista inteira (união cobre tudo), nas três abas", () => {
    const campaigns = [...dbStatuses, "interrupted", "", "coisa-nova"].map((s, i) => campaignWith(s, `k${i}`));
    const queue = [
      { campaignName: "a", chipName: "GD Gabriel" },
      { campaignName: "b", chipName: null },
      { campaignName: "c", chipName: "GD Priscila" },
    ] as any[];
    const sheets = [
      { source_name: "a", uploaded_by_email: "ana@vexo.com", created_at: "2026-10-01T12:00:00" },
      { source_name: "b", uploaded_by_email: null, created_at: "2026-10-01T12:00:00" },
    ] as any[];

    for (const [config, items] of [
      [CAMPAIGNS_FILTER, campaigns],
      [DISPATCH_QUEUE_FILTER, queue],
      [SAVED_SHEETS_FILTER, sheets],
    ] as const) {
      for (const facet of (config as any).facets) {
        const todas = resolveFacetOptions(facet, items as any).map((o) => o.value);
        const achados = filterList(items as any, state({ facets: { [facet.id]: todas } }), config as any);
        expect(achados, `filtro '${facet.label}' deixa registro inalcançável`).toHaveLength((items as any).length);
      }
    }
  });
});
