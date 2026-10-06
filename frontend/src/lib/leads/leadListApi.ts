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
}

export interface LeadFacetsResponse {
  summary: Record<string, number>;
  baseTotal: number;
  /** contagem por cartão de origem — SEMPRE a base inteira */
  channels: Record<string, number>;
  sources: Array<{ source: string; count: number }>;
  tags: Array<{ tag: string; count: number }>;
  /** contagem EXATA por estágio (cada estágio é o seu); `other` = nulo ou desconhecido */
  stagesExact: { buyer: number; open_budget: number; inquiry: number; cold: number; lost: number; other: number };
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
  return p;
}

async function readJson<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (!res.ok) {
    let message = fallbackMessage;
    try {
      const body = await res.json();
      message = body?.error?.message || body?.message || `${fallbackMessage} (${res.status})`;
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
  };
}

export async function fetchLeadFacets(request: LeadRequest, clientId: string): Promise<LeadFacetsResponse> {
  const data = await readJson<Partial<LeadFacetsResponse>>(
    await request(`/api/leads/facets?clientId=${encodeURIComponent(clientId)}`),
    "Falha ao calcular os totais da base"
  );
  return {
    summary: data.summary ?? {},
    baseTotal: data.baseTotal ?? 0,
    channels: data.channels ?? {},
    sources: data.sources ?? [],
    tags: data.tags ?? [],
    stagesExact: data.stagesExact ?? { buyer: 0, open_budget: 0, inquiry: 0, cold: 0, lost: 0, other: 0 },
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
  args: { clientId: string; stages: string[]; tag: string; rules: AudienceRule[] }
): Promise<AudienceResponse> {
  const res = await request("/api/leads/audience", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: args.clientId, stages: args.stages, tag: args.tag, rules: args.rules }),
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
