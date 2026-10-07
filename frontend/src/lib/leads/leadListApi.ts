// Lista do Banco de Dados: filtro, ordenação, contagem e paginação acontecem NO SERVIDOR (SQL). A tela pede UMA página e recebe
// as linhas dela mais os totais (total da combinação de filtros, abas, base inteira). Este módulo é só a fronteira com a API:
// monta a URL, chama, e valida o formato. Não conhece React nem o `fetch` global — recebe um `request` (assim é testado sem rede).
//
// Antes: a tela baixava até 2.000 leads e refazia aqui no navegador filtro, abas, contagens, origens e paginação, sobre essa lista só.

export interface LeadListFilters {
  /** "all" | "buyer" | "open_budget" | "cold" (Leads Frios = o complemento) | "lost" */
  stage?: string;
  tag?: string;
  search?: string;
  source?: string;
  /** id do cartão de origem; "all" = sem filtro */
  channel?: string;
  /** "never_contacted" | "in_conversation" | "in_negotiation" */
  segment?: string | null;
  importId?: string;
}

export type LeadSortColumn = "contato" | "ultima_conversa";

export interface LeadTabCounts {
  all: number;
  buyer: number;
  open_budget: number;
  cold: number;
  lost: number;
}

export interface LeadPageResponse<TLead = Record<string, unknown>> {
  items: TLead[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** null quando o servidor devolveu a página degradada (sem filtros) */
  tabs: LeadTabCounts | null;
  degraded: boolean;
  degradedReason?: string;
  /** Por que o servidor degradou (erro do banco): a tela mostra no aviso. */
  degradedCause?: { message: string; code?: string } | null;
}

/** Tipo de uma tag: o servidor separa procedência, rótulo da IA e marcação da pessoa NA TELA (nenhum dado muda). */
export type TagKind = "planilha" | "origem" | "ia" | "minhas";
export interface FacetTag {
  tag: string;
  count: number;
  /** ausente (servidor antigo) = "minhas" */
  kind?: TagKind;
}

export const TAG_KIND_ORDER: TagKind[] = ["planilha", "origem", "ia", "minhas"];
export const TAG_KIND_LABELS: Record<TagKind, string> = {
  planilha: "Planilhas",
  origem: "Grupos e origem",
  ia: "Rótulos da IA",
  minhas: "Minhas",
};

/**
 * Agrupa as tags por tipo, na ordem fixa Planilhas → Grupos e origem → Rótulos da IA → Minhas. Nenhuma tag some: tipo desconhecido ou ausente
 * cai em "Minhas", e a união dos grupos é exatamente a lista recebida.
 */
export function groupTagsByKind<T extends { tag: string; kind?: string } = { tag: string; kind?: string }>(
  tags: ReadonlyArray<T>
): Array<{ kind: TagKind; label: string; tags: string[]; items: T[] }> {
  const buckets: Record<TagKind, { tags: string[]; items: T[] }> = {
    planilha: { tags: [], items: [] },
    origem: { tags: [], items: [] },
    ia: { tags: [], items: [] },
    minhas: { tags: [], items: [] },
  };
  for (const t of tags) {
    const kind = (TAG_KIND_ORDER as string[]).includes(t.kind ?? "") ? (t.kind as TagKind) : "minhas";
    buckets[kind].tags.push(t.tag);
    buckets[kind].items.push(t);
  }
  return TAG_KIND_ORDER.filter((k) => buckets[k].tags.length > 0).map((k) => ({
    kind: k,
    label: TAG_KIND_LABELS[k],
    tags: buckets[k].tags,
    items: buckets[k].items,
  }));
}

export type FacetPartName = "summary" | "channels" | "sources" | "tags";

/**
 * Totais da base, em quatro partes INDEPENDENTES. Cada parte que o servidor não conseguiu calcular vem `null` e aparece em
 * `failedParts` com a causa: a tela usa o que chegou e avisa só sobre o que falhou (a lista de tags, por exemplo, é o que permite
 * montar o público de uma campanha e não pode sumir por causa de outra conta).
 */
export interface LeadFacetsResponse {
  summary: Record<string, number> | null;
  baseTotal: number | null;
  /** contagem por cartão de origem — SEMPRE a base inteira */
  channels: Record<string, number> | null;
  sources: Array<{ source: string; count: number }> | null;
  tags: FacetTag[] | null;
  /** contagem EXATA por estágio (cada estágio é o seu); `other` = nulo ou desconhecido */
  stagesExact: { buyer: number; open_budget: number; inquiry: number; cold: number; lost: number; other: number } | null;
  failedParts: Partial<Record<FacetPartName, { message: string; code?: string }>>;
}

export interface LeadContact {
  id: string;
  nome?: string | null;
  telefone?: string | null;
  phone?: string | null;
}

export interface LeadIdsResponse {
  ids: string[];
  total: number;
  truncated: boolean;
  contacts?: LeadContact[];
}

export interface AudienceRule {
  column: string;
  operator: "equals" | "contains" | "gt" | "lt";
  value: string;
}

export interface AudienceLead {
  id: string;
  telefone?: string | null;
  phone?: string | null;
  nome?: string | null;
  stage?: string | null;
  temperature?: string | null;
  tags?: string[] | null;
  raw_chat_summary?: string | null;
}

/** Os dois números da campanha por planilha: nasceram na importação × já existiam e foram tocados por ela. */
export interface ImportOrigin {
  found: boolean;
  importId: string;
  sourceName: string;
  totalRows: number;
  createdAt: string;
  /** null nas reconstruídas: não existe hora de abertura para separar os dois grupos */
  born: number | null;
  existed: number | null;
  total: number;
  reconstructed?: boolean;
  totalIsFloor?: boolean;
  approximateDate?: boolean;
  reason?: string;
}
export type ImportScope = "all" | "born" | "existed";

export interface AudienceResponse {
  items: AudienceLead[];
  total: number;
  truncated: boolean;
}

export type LeadRequest = (path: string, init?: RequestInit) => Promise<Response>;

/** Regra do assistente de campanha num campo que não tem comparação de texto (tags, dados…): a tela diz qual, nunca mostra "0 leads". */
export class AudienceRulesError extends Error {
  problems: Array<{ index: number; column: string; reason: string; message: string }>;
  constructor(message: string, problems: AudienceRulesError["problems"]) {
    super(message);
    this.name = "AudienceRulesError";
    this.problems = problems;
  }
}

const SEGMENTS = ["never_contacted", "in_conversation", "in_negotiation"];

/** Parâmetros de filtro, sem os vazios e sem o "todos" (o servidor lê ausência como "sem filtro"). */
export function filterParams(filters: LeadListFilters): URLSearchParams {
  const p = new URLSearchParams();
  const stage = (filters.stage || "").trim();
  if (stage && stage !== "all" && stage !== "contacts_without_channel") p.set("stage", stage);
  const tag = (filters.tag || "").trim();
  if (tag) p.set("tag", tag);
  const search = (filters.search || "").trim();
  if (search) p.set("search", search);
  const source = (filters.source || "").trim();
  if (source) p.set("source", source);
  const channel = (filters.channel || "").trim();
  if (channel && channel !== "all") p.set("channel", channel);
  if (filters.segment && SEGMENTS.includes(filters.segment)) p.set("segment", filters.segment);
  const importId = (filters.importId || "").trim();
  if (importId) p.set("importId", importId);
  return p;
}

async function readJson<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (!res.ok) {
    let message = fallbackMessage;
    try {
      const body = await res.json();
      message = body?.error?.message || body?.message || `${fallbackMessage} (${res.status})`;
      // o servidor devolve a CAUSA do 500 (ex.: coluna inexistente): a tela mostra, em vez de só "falhou"
      const cause = body?.error?.details?.cause;
      if (cause?.message) message += ` — ${cause.message}${cause.code ? ` [${cause.code}]` : ""}`;
    } catch {
      message = `${fallbackMessage} (${res.status})`;
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export async function fetchLeadPage<TLead = Record<string, unknown>>(
  request: LeadRequest,
  args: { clientId: string; filters: LeadListFilters; sort: LeadSortColumn | null; dir: "asc" | "desc"; page: number; limit: number }
): Promise<LeadPageResponse<TLead>> {
  const p = filterParams(args.filters);
  p.set("clientId", args.clientId);
  p.set("page", String(args.page));
  p.set("limit", String(args.limit));
  if (args.sort) {
    p.set("sort", args.sort);
    p.set("dir", args.dir);
  }
  const data = await readJson<Partial<LeadPageResponse<TLead>>>(await request(`/api/leads?${p.toString()}`), "Erro na API de leads");
  const items = Array.isArray(data.items) ? data.items : [];
  const total = typeof data.total === "number" ? data.total : items.length;
  return {
    items,
    total,
    page: data.page ?? args.page,
    limit: data.limit ?? args.limit,
    totalPages: data.totalPages ?? Math.max(1, Math.ceil(total / args.limit)),
    tabs: data.tabs ?? null,
    degraded: Boolean(data.degraded),
    degradedReason: data.degradedReason,
    degradedCause: data.degradedCause ?? null,
  };
}

export async function fetchLeadFacets(request: LeadRequest, clientId: string): Promise<LeadFacetsResponse> {
  const data = await readJson<Partial<LeadFacetsResponse>>(
    await request(`/api/leads/facets?clientId=${encodeURIComponent(clientId)}`),
    "Falha ao calcular os totais da base"
  );
  // null continua null: "não calculou" é diferente de "zero" (o cartão mostra "—", não 0)
  return {
    summary: data.summary ?? null,
    baseTotal: data.baseTotal ?? null,
    channels: data.channels ?? null,
    sources: data.sources ?? null,
    tags: data.tags ?? null,
    stagesExact: data.stagesExact ?? null,
    failedParts: data.failedParts ?? {},
  };
}

/** Todos os ids da combinação de filtros (selecionar todos da faixa, disparo por origem). `contacts` traz nome e telefone junto. */
export async function fetchLeadIds(
  request: LeadRequest,
  args: { clientId: string; filters: LeadListFilters; contacts?: boolean }
): Promise<LeadIdsResponse> {
  const p = filterParams(args.filters);
  p.set("clientId", args.clientId);
  if (args.contacts) p.set("contacts", "1");
  const data = await readJson<Partial<LeadIdsResponse>>(await request(`/api/leads/ids?${p.toString()}`), "Falha ao listar os leads do filtro");
  return { ids: data.ids ?? [], total: data.total ?? data.ids?.length ?? 0, truncated: Boolean(data.truncated), contacts: data.contacts };
}

export async function fetchCampaignAudience(
  request: LeadRequest,
  args: { clientId: string; stages: string[]; tag: string; rules: AudienceRule[]; importId?: string | null; importScope?: ImportScope }
): Promise<AudienceResponse> {
  const res = await request("/api/leads/audience", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: args.clientId,
      stages: args.stages,
      tag: args.tag,
      rules: args.rules,
      ...(args.importId ? { importId: args.importId, importScope: args.importScope ?? "all" } : {}),
    }),
  });
  if (res.status === 400) {
    const body = await res.json().catch(() => null);
    if (body?.error?.code === "UNSUPPORTED_RULES") {
      throw new AudienceRulesError(body.error.message, Array.isArray(body.problems) ? body.problems : []);
    }
    throw new Error(body?.error?.message || "Filtro inválido");
  }
  const data = await readJson<Partial<AudienceResponse>>(res, "Falha ao montar o público da campanha");
  return { items: data.items ?? [], total: data.total ?? data.items?.length ?? 0, truncated: Boolean(data.truncated) };
}

export interface ImportSource {
  id: string;
  source_name: string;
  created_at: string;
  total_rows: number;
  status: "completed" | "incomplete";
  /** Reconstruída depois do fato: o total é PISO e a data é aproximada; não há "nasceram / já existiam". */
  reconstructed?: boolean;
  /** Quantas importações da empresa têm exatamente este nome de arquivo (>1 = o mesmo arquivo importado mais de uma vez). */
  same_name_count?: number;
}

/** As planilhas registradas, para o seletor da campanha (rota do Banco: não exige acesso à tela de Planilhas). */
export async function fetchImportSources(request: LeadRequest, clientId: string): Promise<ImportSource[]> {
  const data = await readJson<{ items?: ImportSource[] }>(await request(`/api/leads/import-sources?clientId=${encodeURIComponent(clientId)}`), "Falha ao listar as planilhas");
  return Array.isArray(data.items) ? data.items : [];
}

/** Os dois números da planilha (nasceram / já existiam), para o dono ver ANTES de confirmar a campanha. */
export async function fetchImportOrigin(request: LeadRequest, args: { clientId: string; importId: string }): Promise<ImportOrigin> {
  const p = new URLSearchParams({ clientId: args.clientId, importId: args.importId });
  return readJson<ImportOrigin>(await request(`/api/leads/import-origin?${p.toString()}`), "Falha ao contar os leads da planilha");
}

/** Um lead pelo id ou telefone (abrir pela URL, mesmo fora da página carregada). */
export async function fetchLeadLookup<TLead = Record<string, unknown>>(
  request: LeadRequest,
  args: { clientId: string; leadId?: string | null; phone?: string | null }
): Promise<TLead | null> {
  const p = new URLSearchParams({ clientId: args.clientId });
  if (args.leadId) p.set("leadId", args.leadId);
  if (args.phone) p.set("phone", args.phone);
  const data = await readJson<{ item: TLead | null }>(await request(`/api/leads/lookup?${p.toString()}`), "Falha ao localizar o lead");
  return data.item ?? null;
}

export const EXPORT_PAGE_SIZE = 500;

/** Exportação para planilha: percorre a combinação de filtros página a página (sem teto), com progresso. */
export async function fetchAllLeadsForExport<TLead = Record<string, unknown>>(
  request: LeadRequest,
  args: { clientId: string; filters: LeadListFilters; onProgress?: (done: number, total: number) => void }
): Promise<TLead[]> {
  const all: TLead[] = [];
  let page = 1;
  for (;;) {
    const res = await fetchLeadPage<TLead>(request, { clientId: args.clientId, filters: args.filters, sort: null, dir: "asc", page, limit: EXPORT_PAGE_SIZE });
    all.push(...res.items);
    args.onProgress?.(all.length, res.total);
    if (page >= res.totalPages || res.items.length === 0) break;
    page += 1;
  }
  return all;
}

// ── Segunda tentativa por OUTRO número (Bloco B) ───────────────────────────────────────────────────────────────────────────────────────
export interface SecondNumberCampaign {
  id: string;
  name: string;
  sentCount: number;
  lastSentAt: string | null;
}

export interface SecondNumberCounts {
  received: number;
  semAdicional: number;
  respondeuMesmoNumero: number;
  respondeuOutroNumero: number;
  dentroDoPrazo: number;
  elegiveis: number;
  /** respostas @lid do período: sem telefone recuperável, não ligam a nenhum envio */
  lidNaoLigadas: number;
  /** campanhas disparadas pelo caminho antigo (não gravam envio): o cruzamento não as enxerga. null = não deu para medir */
  campanhasCaminhoAntigo: number | null;
  periodoDesde: string | null;
  waitDays: number;
}

export interface SecondNumberItem {
  leadId: string;
  nome: string;
  principal: string;
  alvo: string;
  alvoColuna: string | null;
}

export interface SecondNumberAudienceResponse {
  counts: SecondNumberCounts;
  items: SecondNumberItem[];
}

export async function fetchSecondNumberCampaigns(request: LeadRequest, clientId: string): Promise<SecondNumberCampaign[]> {
  const data = await readJson<{ items?: SecondNumberCampaign[] }>(
    await request(`/api/leads/second-number/campaigns?clientId=${encodeURIComponent(clientId)}`),
    "Falha ao listar as campanhas"
  );
  return data.items ?? [];
}

export async function fetchSecondNumberAudience(
  request: LeadRequest,
  args: { clientId: string; campaignId: string; waitDays: number }
): Promise<SecondNumberAudienceResponse> {
  const data = await readJson<Partial<SecondNumberAudienceResponse>>(
    await request("/api/leads/second-number/audience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    }),
    "Falha ao montar o público da segunda tentativa"
  );
  if (!data.counts) throw new Error("Resposta inválida do servidor (sem os números do público).");
  return { counts: data.counts, items: data.items ?? [] };
}

const nf = (n: number) => n.toLocaleString("pt-BR");

/**
 * Os avisos que a prévia mostra SEMPRE, com os números reais da empresa, na tela (não em tooltip): quem foi excluído, o que "não respondeu"
 * quer dizer de verdade e o ponto cego do caminho antigo. Texto numa função só para o teste travar a frase.
 */
export function secondNumberNotices(c: SecondNumberCounts): { excluded: string; unlinked: string; legacy: string } {
  return {
    excluded: `${nf(c.respondeuOutroNumero)} ${c.respondeuOutroNumero === 1 ? "excluído" : "excluídos"} por já ${c.respondeuOutroNumero === 1 ? "ter respondido" : "terem respondido"} em outro número`,
    unlinked: `${nf(c.lidNaoLigadas)} ${c.lidNaoLigadas === 1 ? "resposta deste período não pôde" : "respostas deste período não puderam"} ser ${c.lidNaoLigadas === 1 ? "ligada" : "ligadas"} a um envio (o WhatsApp não informa o telefone delas). "Não respondeu" aqui quer dizer "não achamos resposta", não "ignorou".`,
    legacy:
      c.campanhasCaminhoAntigo === null
        ? "Não foi possível conferir as campanhas do caminho antigo de disparo. Elas não gravam o registro de envio e não aparecem nesta lista."
        : `${nf(c.campanhasCaminhoAntigo)} ${c.campanhasCaminhoAntigo === 1 ? "campanha disparada" : "campanhas disparadas"} pelo caminho antigo não ${c.campanhasCaminhoAntigo === 1 ? "aparece" : "aparecem"} aqui: elas não gravam o registro de envio e o cruzamento não as enxerga.`,
  };
}

/**
 * As linhas que seguem para a central de campanhas. O telefone da linha é o NÚMERO ADICIONAL; o principal só vai junto, como segunda linha da
 * mesma empresa, quando a pessoa marcou de propósito "mandar também para o número que já recebeu".
 */
export function secondNumberHandoffRows(
  items: ReadonlyArray<SecondNumberItem>,
  campaignName: string,
  includePrincipal: boolean
): Array<Record<string, string>> {
  return items.flatMap((i) => {
    const base = { nome: i.nome, telefone_principal: i.principal, segunda_tentativa_de: campaignName };
    return includePrincipal ? [{ telefone: i.alvo, ...base }, { telefone: i.principal, ...base }] : [{ telefone: i.alvo, ...base }];
  });
}
