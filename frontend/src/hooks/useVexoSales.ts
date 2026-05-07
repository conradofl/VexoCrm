import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";

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

export function useVexoSalesOpportunities(filters: VexoSalesFilters = {}) {
  const { isAuthenticated, isAdminUser, getIdToken } = useAuth();

  return useQuery({
    queryKey: ["vexo-sales-opportunities", filters],
    enabled: isAuthenticated && isAdminUser,
    queryFn: async (): Promise<{ items: VexoSalesOpportunity[]; summary: VexoSalesSummary }> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/vexo-sales/opportunities${buildVexoSalesQuery(filters)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(`Erro ao buscar Vendas Vexo: ${res.status} ${await readApiError(res)}`);
      }

      const payload = await res.json();
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

      const res = await fetch(`${API_BASE_URL}/api/vexo-sales/opportunities`, {
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

      const data = await res.json();
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

      const res = await fetch(`${API_BASE_URL}/api/vexo-sales/opportunities/${id}`, {
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

      const data = await res.json();
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

      const res = await fetch(`${API_BASE_URL}/api/vexo-sales/opportunities/${id}`, {
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

      const res = await fetch(`${API_BASE_URL}/api/vexo-sales/opportunities/${opportunityId}/interactions`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        throw new Error(`Erro ao buscar interacoes: ${res.status} ${await readApiError(res)}`);
      }

      const payload = await res.json();
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

      const res = await fetch(`${API_BASE_URL}/api/vexo-sales/opportunities/${opportunityId}/interactions`, {
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

      const data = await res.json();
      return data.item;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["vexo-sales-interactions", variables.opportunityId] });
      queryClient.invalidateQueries({ queryKey: ["vexo-sales-opportunities"] });
    },
  });
}
