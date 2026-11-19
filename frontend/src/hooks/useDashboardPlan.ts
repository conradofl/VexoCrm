// Plano de ação do Dashboard gravado no servidor (GET/PUT /api/dashboard/plan, planilha em /api/dashboard/plan/export).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage } from "@/lib/api";
import type { DashboardPeriod, DashboardRange } from "@/hooks/useDashboard";
import { buildDashboardPeriodQuery } from "@/hooks/useDashboard";
import type { DashboardPlanResponse, PlanExportList, PlanItemInput, StoredPlanItem } from "@/lib/dashboard/plan";

// "unavailable" = o servidor ainda não tem onde guardar o plano (deploy sem a tabela): a aba diz isso e não grava.
export type DashboardPlanState = { status: "ready"; plan: DashboardPlanResponse } | { status: "unavailable" };

export function dashboardPlanQueryKey(clientId: string, period: DashboardPeriod, range?: DashboardRange | null) {
  return ["dashboard-plan", clientId, period, range?.from ?? null, range?.to ?? null] as const;
}

async function errorCode(res: Response) {
  const body = await res.clone().json().catch(() => null);
  // sendError do servidor responde { error: { code, message } }; aceita também o formato antigo { error: "CÓDIGO" }.
  if (typeof body?.error === "string") return body.error;
  return typeof body?.error?.code === "string" ? body.error.code : null;
}

export function useDashboardPlan(clientId: string, period: DashboardPeriod = "30d", range?: DashboardRange | null) {
  const { isAuthenticated, getIdToken } = useAuth();
  const hasRange = period !== "custom" || !!range;
  return useQuery({
    queryKey: dashboardPlanQueryKey(clientId, period, range),
    enabled: isAuthenticated && !!clientId && hasRange,
    // O plano é editado aqui mesmo: não recarrega sozinho por cima do que a pessoa está digitando.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async (): Promise<DashboardPlanState> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");
      const res = await fetchApi(`/api/dashboard/plan?clientId=${encodeURIComponent(clientId)}&${buildDashboardPeriodQuery(period, range)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.status === 503 && (await errorCode(res)) === "PLAN_STORAGE_UNAVAILABLE") return { status: "unavailable" };
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Não foi possível carregar o plano salvo."));
      const body = await res.json();
      return { status: "ready", plan: body as DashboardPlanResponse };
    },
  });
}

export interface SavePlanVariables {
  clientId: string;
  period: DashboardPeriod;
  range?: DashboardRange | null;
  items: PlanItemInput[];
}

/** A empresa e o período vão junto de cada gravação: um plano nunca é gravado na empresa que está na tela agora. */
export function useSaveDashboardPlan() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ clientId, period, range, items }: SavePlanVariables) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");
      const res = await fetchApi("/api/dashboard/plan", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, period, from: range?.from, to: range?.to, items }),
      });
      if (!res.ok) throw new Error(await readApiErrorMessage(res, "Não foi possível salvar o plano."));
      const body = await res.json();
      return body.plan as { weekStart: string; items: StoredPlanItem[]; updatedAt: string | null };
    },
    onSuccess: (saved, { clientId, period, range }) => {
      queryClient.setQueryData<DashboardPlanState>(dashboardPlanQueryKey(clientId, period, range), (old) =>
        old?.status === "ready" ? { status: "ready", plan: { ...old.plan, current: saved } } : old
      );
    },
  });
}

/** Baixa a planilha (nome e telefone). O servidor recusa quem não acessa a tela Conversas. */
export function useDownloadPlanSheet(clientId: string) {
  const { getIdToken } = useAuth();
  return async (list: PlanExportList) => {
    const token = await getIdToken();
    if (!token) throw new Error("Usuario nao autenticado.");
    const res = await fetchApi(`/api/dashboard/plan/export?clientId=${encodeURIComponent(clientId)}&list=${list}`, {
      headers: { Authorization: `Bearer ${token}` },
      timeoutMs: 60000,
    });
    if (!res.ok) throw new Error(await readApiErrorMessage(res, "Não foi possível baixar a planilha."));
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") || "";
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] || `plano-${list}.csv`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}
