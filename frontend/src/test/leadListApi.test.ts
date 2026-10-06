// A fronteira da tela com a lista paginada no servidor: URL montada, formato validado, exportação sem teto, regra recusada com motivo.
import { describe, expect, it, vi } from "vitest";
import {
  AudienceRulesError,
  EXPORT_PAGE_SIZE,
  fetchAllLeadsForExport,
  fetchCampaignAudience,
  fetchLeadFacets,
  fetchLeadIds,
  fetchLeadLookup,
  fetchImportOrigin,
  fetchImportSources,
  fetchLeadPage,
  filterParams,
  groupTagsByKind,
  type LeadRequest,
} from "@/lib/leads/leadListApi";

const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

describe("filterParams", () => {
  it("omite vazios, 'all' e a aba que não é de leads; mantém o resto", () => {
    expect(filterParams({}).toString()).toBe("");
    expect(filterParams({ stage: "all", channel: "all", search: "  ", tag: "", source: "", segment: null }).toString()).toBe("");
    expect(filterParams({ stage: "contacts_without_channel" }).toString()).toBe("");
    const p = filterParams({ stage: "cold", tag: "vip", search: " ana ", source: "Google Ads", channel: "google", segment: "in_conversation" });
    expect(Object.fromEntries(p)).toEqual({ stage: "cold", tag: "vip", search: "ana", source: "Google Ads", channel: "google", segment: "in_conversation" });
  });
  it("faixa desconhecida não vai ao servidor", () => {
    expect(filterParams({ segment: "inventada" }).toString()).toBe("");
  });
});

describe("fetchLeadPage", () => {
  it("pede UMA página com filtros, ordem e tamanho, e devolve total e abas do servidor", async () => {
    const request = vi.fn<LeadRequest>(async () =>
      ok({ items: [{ id: "a" }], total: 25_000, page: 3, limit: 50, totalPages: 500, tabs: { all: 25_000, buyer: 1, open_budget: 2, cold: 3, lost: 4 }, degraded: false })
    );
    const r = await fetchLeadPage(request, { clientId: "c1", filters: { tag: "vip", stage: "buyer" }, sort: "contato", dir: "desc", page: 3, limit: 50 });
    const url = new URL(request.mock.calls[0][0], "http://x");
    expect(url.pathname).toBe("/api/leads");
    expect(Object.fromEntries(url.searchParams)).toEqual({ clientId: "c1", tag: "vip", stage: "buyer", page: "3", limit: "50", sort: "contato", dir: "desc" });
    expect(r.total).toBe(25_000);
    expect(r.totalPages).toBe(500);
    expect(r.tabs?.cold).toBe(3);
  });
  it("sem ordenação não manda sort/dir", async () => {
    const request = vi.fn<LeadRequest>(async () => ok({ items: [], total: 0 }));
    await fetchLeadPage(request, { clientId: "c1", filters: {}, sort: null, dir: "asc", page: 1, limit: 50 });
    const url = new URL(request.mock.calls[0][0], "http://x");
    expect(url.searchParams.has("sort")).toBe(false);
    expect(url.searchParams.has("dir")).toBe(false);
  });
  it("resposta degradada chega marcada, com abas nulas", async () => {
    const r = await fetchLeadPage(async () => ok({ items: [{ id: "a" }], total: 9, degraded: true, degradedReason: "FILTERS_UNAVAILABLE", tabs: null }), {
      clientId: "c1", filters: { tag: "vip" }, sort: null, dir: "asc", page: 1, limit: 50,
    });
    expect(r.degraded).toBe(true);
    expect(r.degradedReason).toBe("FILTERS_UNAVAILABLE");
    expect(r.tabs).toBeNull();
  });
  it("500 com causa: a mensagem do erro inclui a causa do banco e o código", async () => {
    await expect(
      fetchLeadFacets(async () => ok({ error: { code: "LEADS_FACETS_FAILED", message: "Falha ao calcular os totais da base.", details: { cause: { message: 'column "x" does not exist', code: "42703" } } } }, 500), "c1")
    ).rejects.toThrow('Falha ao calcular os totais da base. — column "x" does not exist [42703]');
  });
  it("resposta degradada leva a causa", async () => {
    const r = await fetchLeadPage(async () => ok({ items: [], total: 0, degraded: true, degradedCause: { message: "boom", code: "XX" } }), { clientId: "c1", filters: {}, sort: null, dir: "asc", page: 1, limit: 50 });
    expect(r.degradedCause).toEqual({ message: "boom", code: "XX" });
  });
  it("erro HTTP vira exceção com a mensagem do servidor", async () => {
    await expect(
      fetchLeadPage(async () => ok({ error: { code: "X", message: "Canal inválido: zz" } }, 400), { clientId: "c1", filters: {}, sort: null, dir: "asc", page: 1, limit: 50 })
    ).rejects.toThrow("Canal inválido: zz");
  });
});

describe("facets, ids, lookup", () => {
  it("facets: parte que o servidor não calculou continua NULL (não vira 0 nem lista vazia) e a causa vem em failedParts", async () => {
    const f = await fetchLeadFacets(async () => ok({ baseTotal: 7, summary: { totalLeads: 7 }, channels: null, sources: [], tags: null, stagesExact: null, failedParts: { channels: { message: "boom", code: "42703" }, tags: { message: "x" } } }), "c1");
    expect(f.baseTotal).toBe(7);
    expect(f.channels).toBeNull();
    expect(f.tags).toBeNull();
    expect(f.sources).toEqual([]); // vazio de verdade (calculou e não há nada) é diferente de falha
    expect(f.stagesExact).toBeNull();
    expect(Object.keys(f.failedParts)).toEqual(["channels", "tags"]);
  });
  it("facets sem failedParts (resposta antiga): nenhuma parte falhou", async () => {
    const f = await fetchLeadFacets(async () => ok({ baseTotal: 7 }), "c1");
    expect(f.failedParts).toEqual({});
  });
  it("ids: contacts só quando pedido", async () => {
    const request = vi.fn<LeadRequest>(async () => ok({ ids: ["a", "b"], total: 2, truncated: false, contacts: [{ id: "a" }, { id: "b" }] }));
    const r = await fetchLeadIds(request, { clientId: "c1", filters: { channel: "google" }, contacts: true });
    expect(new URL(request.mock.calls[0][0], "http://x").searchParams.get("contacts")).toBe("1");
    expect(r.ids).toEqual(["a", "b"]);
    await fetchLeadIds(request, { clientId: "c1", filters: {} });
    expect(new URL(request.mock.calls[1][0], "http://x").searchParams.has("contacts")).toBe(false);
  });
  it("lookup: item ou null", async () => {
    expect(await fetchLeadLookup(async () => ok({ item: { id: "x" } }), { clientId: "c1", leadId: "x" })).toEqual({ id: "x" });
    expect(await fetchLeadLookup(async () => ok({ item: null }), { clientId: "c1", phone: "5511" })).toBeNull();
  });
});

describe("fetchCampaignAudience", () => {
  it("regra em campo não suportado vira AudienceRulesError com o motivo do servidor", async () => {
    const problems = [{ index: 0, column: "dados", reason: "COLUMN_NOT_SUPPORTED", message: 'A coluna "dados" não pode ser usada como regra' }];
    const p = fetchCampaignAudience(async () => ok({ error: { code: "UNSUPPORTED_RULES", message: problems[0].message }, problems }, 400), {
      clientId: "c1", stages: ["all"], tag: "", rules: [{ column: "dados", operator: "contains", value: "x" }],
    });
    await expect(p).rejects.toBeInstanceOf(AudienceRulesError);
    await expect(p).rejects.toMatchObject({ problems });
  });
  it("manda estágios, tag e regras no corpo", async () => {
    const request = vi.fn<LeadRequest>(async () => ok({ items: [{ id: "a" }], total: 1, truncated: false }));
    const r = await fetchCampaignAudience(request, { clientId: "c1", stages: ["buyer"], tag: "vip", rules: [] });
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ clientId: "c1", stages: ["buyer"], tag: "vip", rules: [] });
    expect(r.total).toBe(1);
  });
});

describe("fetchAllLeadsForExport", () => {
  it("percorre TODAS as páginas (sem teto) e avisa o progresso", async () => {
    const total = EXPORT_PAGE_SIZE * 3 + 7;
    const request = vi.fn<LeadRequest>(async (path) => {
      const page = Number(new URL(path, "http://x").searchParams.get("page"));
      const start = (page - 1) * EXPORT_PAGE_SIZE;
      const n = Math.max(0, Math.min(EXPORT_PAGE_SIZE, total - start));
      return ok({ items: Array.from({ length: n }, (_, i) => ({ id: `l${start + i}` })), total, page, limit: EXPORT_PAGE_SIZE, totalPages: Math.ceil(total / EXPORT_PAGE_SIZE) });
    });
    const progress: number[] = [];
    const all = await fetchAllLeadsForExport(request, { clientId: "c1", filters: { tag: "vip" }, onProgress: (done) => progress.push(done) });
    expect(all).toHaveLength(total);
    expect(new Set(all.map((l: any) => l.id)).size).toBe(total);
    expect(request).toHaveBeenCalledTimes(4);
    expect(progress).toEqual([500, 1000, 1500, 1507]);
  });
});

describe("groupTagsByKind (seletor de tags por tipo)", () => {
  it("ordem fixa Planilhas → Grupos e origem → Rótulos da IA → Minhas; grupos vazios não aparecem", () => {
    const g = groupTagsByKind([
      { tag: "vip", kind: "minhas" }, { tag: "#Imp-a", kind: "planilha" }, { tag: "VP Ofertas", kind: "origem" }, { tag: "Follow-up", kind: "ia" }, { tag: "#Imp-b", kind: "planilha" },
    ]);
    expect(g.map((x) => x.label)).toEqual(["Planilhas", "Grupos e origem", "Rótulos da IA", "Minhas"]);
    expect(g[0].tags).toEqual(["#Imp-a", "#Imp-b"]);
    expect(groupTagsByKind([{ tag: "x", kind: "minhas" }]).map((x) => x.kind)).toEqual(["minhas"]);
    expect(groupTagsByKind([])).toEqual([]);
  });
  it("[TESTE OBRIGATÓRIO] nenhuma tag se perde: tipo ausente ou desconhecido cai em Minhas e a união dos grupos é a lista recebida", () => {
    const entrada = [{ tag: "a" }, { tag: "b", kind: "inventado" }, { tag: "#Imp-x", kind: "planilha" }, { tag: "c", kind: "ia" }];
    const g = groupTagsByKind(entrada);
    expect(g.flatMap((x) => x.tags).sort()).toEqual(entrada.map((t) => t.tag).sort());
    expect(g.find((x) => x.kind === "minhas")?.tags).toEqual(["a", "b"]);
  });
});

describe("campanha por planilha (API)", () => {
  it("fetchImportOrigin devolve os dois números; fetchImportSources lista as planilhas", async () => {
    const request = vi.fn<LeadRequest>(async () => ok({ found: true, importId: "i1", sourceName: "x.xlsx", born: 1200, existed: 300, total: 1500 }));
    const o = await fetchImportOrigin(request, { clientId: "c1", importId: "i1" });
    expect(new URL(request.mock.calls[0][0], "http://x").searchParams.get("importId")).toBe("i1");
    expect([o.born, o.existed, o.total]).toEqual([1200, 300, 1500]);
    expect(await fetchImportSources(async () => ok({ items: [{ id: "i1", source_name: "x.xlsx" }] }), "c1")).toHaveLength(1);
    expect(await fetchImportSources(async () => ok({}), "c1")).toEqual([]);
  });
  it("audience leva importId e importScope só quando há planilha (sem planilha o corpo é o de sempre)", async () => {
    const request = vi.fn<LeadRequest>(async () => ok({ items: [], total: 0, truncated: false }));
    await fetchCampaignAudience(request, { clientId: "c1", stages: ["all"], tag: "", rules: [] });
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ clientId: "c1", stages: ["all"], tag: "", rules: [] });
    await fetchCampaignAudience(request, { clientId: "c1", stages: ["all"], tag: "", rules: [], importId: "i1", importScope: "born" });
    expect(JSON.parse(String(request.mock.calls[1][1]?.body))).toMatchObject({ importId: "i1", importScope: "born" });
    await fetchCampaignAudience(request, { clientId: "c1", stages: ["all"], tag: "", rules: [], importId: "i1" });
    expect(JSON.parse(String(request.mock.calls[2][1]?.body)).importScope).toBe("all");
  });
});
