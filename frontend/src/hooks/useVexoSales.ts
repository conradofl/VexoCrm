import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";

const VEXO_SALES_REQUEST_TIMEOUT_MS = 15000;

export const VEXO_SALES_STAGES = [
  "Novo lead",
  "Primeiro contato",
  "Qualificação",
  "Diagnóstico",
  "Proposta enviada",
  "Negociação",
  "Fechado ganho",
  "Fechado perdido",
] as const;

export const VEXO_SALES_STATUSES = ["ativo", "pausado", "ganho", "perdido"] as const;
export const VEXO_SALES_PRIORITIES = ["baixa", "media", "alta"] as const;
export const VEXO_SALES_INTERACTION_TYPES = ["ligacao", "whatsapp", "reuniao", "email", "observacao"] as const;

export type VexoSalesStage = (typeof VEXO_SALES_STAGES)[number];
export type VexoSalesStatus = (typeof VEXO_SALES_STATUSES)[number];
export type VexoSalesPriority = (typeof VEXO_SALES_PRIORITIES)[number];
export type VexoSalesInteractionType = (typeof VEXO_SALES_INTERACTION_TYPES)[number];

export interface VexoSalesOpportunity {
  id: string;
  created_at: string;
  updated_at: string;
  company_name: string;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  source: string | null;
  segment: string | null;
  estimated_value: number;
  stage: VexoSalesStage;
  status: VexoSalesStatus;
  priority: VexoSalesPriority;
  assigned_to: string | null;
  expected_close_date: string | null;
  notes: string | null;
  created_by: string | null;
  created_by_uid: string | null;
}

export interface VexoSalesSummary {
  total: number;
  open: number;
  estimatedNegotiationValue: number;
  wonThisMonth: number;
  conversionRate: number;
}

export interface VexoSalesInteraction {
  id: string;
  opportunity_id: string;
  created_at: string;
  interaction_at: string;
  type: VexoSalesInteractionType;
  description: string;
  responsible_user: string | null;
  created_by: string | null;
  created_by_uid: string | null;
}

export interface VexoSalesFilters {
  stage?: string;
  status?: string;
  assignedTo?: string;
  source?: string;
  priority?: string;
}

export type VexoSalesOpportunityPayload = Partial<
  Pick<
    VexoSalesOpportunity,
    | "company_name"
    | "contact_name"
    | "contact_phone"
    | "contact_email"
    | "source"
    | "segment"
    | "stage"
    | "status"
    | "priority"
    | "assigned_to"
    | "expected_close_date"
    | "notes"
  >
> & {
  estimated_value?: number;
};

export interface VexoSalesInteractionPayload {
  type: VexoSalesInteractionType;
  description: string;
  interaction_at?: string;
  responsible_user?: string | null;
}

function buildVexoSalesQuery(filters: VexoSalesFilters) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value && value !== "all") params.set(key, value);
  });
  const query = params.toString();
  return query ? `?${query}` : "";
}

async function readApiError(res: Response) {
  const text = await res.text();
  try {
    const payload = JSON.parse(text);
    return payload?.error?.message || text;
  } catch {
    return text;
  }
}

async function readVexoSalesJson<T>(res: Response, context: string): Promise<T> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    console.error("[vexo-sales-api] invalid_response", {
      context,
      status: res.status,
      contentType,
    });
    throw new Error("Resposta invalida da API Vendas Vexo.");
  }

  return res.json() as Promise<T>;
}

function getVexoSalesApiCandidates(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return Array.from(new Set([`${API_BASE_URL}${normalizedPath}`, normalizedPath]));
}

async function fetchVexoSales(path: string, init: RequestInit) {
  let networkError: unknown = null;
  const candidates = getVexoSalesApiCandidates(path);

  for (const [index, url] of candidates.entries()) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), VEXO_SALES_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        ...init,
        signal: controller.signal,
      });
      if (index > 0) {
        console.info("[vexo-sales-api] fallback_success", { path, status: response.status });
      }
      return response;
    } catch (error) {
      networkError = error;
      const eventName = error instanceof DOMException && error.name === "AbortError" ? "request_timeout" : "network_error";
      console.warn("[vexo-sales-api]", eventName, {
        path,
        attempt: index + 1,
        fallbackAvailable: index < candidates.length - 1,
      });
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  console.error("[vexo-sales-api] request_failed", { path });
  throw networkError instanceof Error ? networkError : new Error("Falha de conexao com a API Vendas Vexo.");
}

export function useVexoSalesOpportunities(filters: VexoSalesFilters = {}) {
  const { isAuthenticated, isAdminUser, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["vexo-sales-opportunities", filters],
    enabled: isAuthenticated && isAdminUser,
    queryFn: async (): Promise<{ items: VexoSalesOpportunity[]; summary: VexoSalesSummary }> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchVexoSales(`/api/vexo-sales/opportunities${buildVexoSalesQuery(filters)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(`Erro ao buscar Vendas Vexo: ${res.status} ${await readApiError(res)}`);
      }

      const payload = await readVexoSalesJson<{
        items?: VexoSalesOpportunity[];
        summary?: VexoSalesSummary;
      }>(res, "list_opportunities");
      return {
        items: Array.isArray(payload.items) ? payload.items : [],
        summary: payload.summary || {
          total: 0,
          open: 0,
          estimatedNegotiationValue: 0,
          wonThisMonth: 0,
          conversionRate: 0,
        },
      };
    },
    staleTime: 30 * 1000,
  });
}

export function useCreateVexoSalesOpportunity() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: VexoSalesOpportunityPayload): Promise<VexoSalesOpportunity> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchVexoSales("/api/vexo-sales/opportunities", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Erro ao criar oportunidade: ${res.status} ${await readApiError(res)}`);
      }

      const data = await readVexoSalesJson<{ item: VexoSalesOpportunity }>(res, "create_opportunity");
      return data.item;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vexo-sales-opportunities"] }),
  });
}

export function useUpdateVexoSalesOpportunity() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, payload }: { id: string; payload: VexoSalesOpportunityPayload }): Promise<VexoSalesOpportunity> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchVexoSales(`/api/vexo-sales/opportunities/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Erro ao atualizar oportunidade: ${res.status} ${await readApiError(res)}`);
      }

      const data = await readVexoSalesJson<{ item: VexoSalesOpportunity }>(res, "update_opportunity");
      return data.item;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vexo-sales-opportunities"] }),
  });
}

export function useDeleteVexoSalesOpportunity() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchVexoSales(`/api/vexo-sales/opportunities/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(`Erro ao excluir oportunidade: ${res.status} ${await readApiError(res)}`);
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vexo-sales-opportunities"] }),
  });
}

export function useVexoSalesInteractions(opportunityId?: string) {
  const { isAuthenticated, isAdminUser, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["vexo-sales-interactions", opportunityId],
    enabled: isAuthenticated && isAdminUser && !!opportunityId,
    queryFn: async (): Promise<VexoSalesInteraction[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchVexoSales(`/api/vexo-sales/opportunities/${opportunityId}/interactions`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(`Erro ao buscar interacoes: ${res.status} ${await readApiError(res)}`);
      }

      const payload = await readVexoSalesJson<{ items?: VexoSalesInteraction[] }>(res, "list_interactions");
      return Array.isArray(payload.items) ? payload.items : [];
    },
    staleTime: 30 * 1000,
  });
}

export function useCreateVexoSalesInteraction() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ opportunityId, payload }: { opportunityId: string; payload: VexoSalesInteractionPayload }): Promise<VexoSalesInteraction> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetchVexoSales(`/api/vexo-sales/opportunities/${opportunityId}/interactions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(`Erro ao registrar interacao: ${res.status} ${await readApiError(res)}`);
      }

      const data = await readVexoSalesJson<{ item: VexoSalesInteraction }>(res, "create_interaction");
      return data.item;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["vexo-sales-interactions", variables.opportunityId] });
      queryClient.invalidateQueries({ queryKey: ["vexo-sales-opportunities"] });
    },
  });
}
