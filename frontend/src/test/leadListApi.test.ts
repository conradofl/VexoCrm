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
  fetchLeadPage,
  filterParams,
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
  it("erro HTTP vira exceção com a mensagem do servidor", async () => {
    await expect(
      fetchLeadPage(async () => ok({ error: { code: "X", message: "Canal inválido: zz" } }, 400), { clientId: "c1", filters: {}, sort: null, dir: "asc", page: 1, limit: 50 })
    ).rejects.toThrow("Canal inválido: zz");
  });
});

describe("facets, ids, lookup", () => {
  it("facets: preenche o que faltar com vazio (nunca undefined na tela)", async () => {
    const f = await fetchLeadFacets(async () => ok({ baseTotal: 7 }), "c1");
    expect(f.baseTotal).toBe(7);
    expect(f.channels).toEqual({});
    expect(f.tags).toEqual([]);
    expect(f.stagesExact.other).toBe(0);
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
