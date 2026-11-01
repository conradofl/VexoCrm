import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";

export type DeliverableStatus =
  | "publicado"
  | "em_producao"
  | "aguardando_aprovacao"
  | "roteiro_pronto"
  | "ajuste_solicitado";

export type FunnelStageId = "atrair" | "apresentar" | "provar" | "converter";

export interface FunnelStage {
  id: FunnelStageId;
  number: string;
  name: string;
  subtitle: string;
  totalVideos: number;
  completedVideos: number;
}

export interface DeliverableItem {
  id: string;
  code: string;
  title: string;
  stage: FunnelStageId;
  date: string;
  dayOfWeek: string;
  format: string;
  channel: string;
  status: DeliverableStatus;
  hook: string;
  script: string;
  cta: string;
  technicalNotes?: string;
  videoUrl?: string;
  feedback?: string;
}

export interface ClientPortalData {
  slug: string;
  companyName: string;
  logoUrl?: string;
  tagline: string;
  partnershipBadge: string;
  period: string;
  commercialGoal: string;
  whatsappSupportNumber: string;
  trafficStatus: {
    status: string;
    budget: string;
    activeCampaigns: number;
  };
  weeklyPacing: {
    delivered: number;
    target: number;
  };
  funnelStages: FunnelStage[];
  deliverables: DeliverableItem[];
}

const LOCAL_STORAGE_KEY_PREFIX = "vexo_client_portal_";

// Sem backend do portal (Fase 3), produção não tem de onde tirar dado: devolve null e a página mostra
// "ainda não configurado". O protótipo (dados inventados) e o estado no localStorage só existem em DEV,
// e o import dinâmico atrás de import.meta.env.DEV some do build de produção.
async function loadPrototypeData(slug: string): Promise<ClientPortalData | null> {
  if (!import.meta.env.DEV) return null;
  const stored = localStorage.getItem(`${LOCAL_STORAGE_KEY_PREFIX}${slug}`);
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      // ignore
    }
  }
  const { CLIENT_PORTAL_PROTOTYPE_DATA } = await import("@/data/clientPortalPrototype");
  return CLIENT_PORTAL_PROTOTYPE_DATA;
}

export function useClientPortal(slug: string) {
  return useQuery({
    queryKey: ["client-portal", slug],
    queryFn: async (): Promise<ClientPortalData | null> => {
      try {
        const res = await fetchApi(`/api/geracao-digital/portal/${slug}`);
        if (res.ok) {
          const json = await res.json();
          if (json && json.data) {
            return json.data;
          }
        }
      } catch (e) {
        // sem backend do portal: cai no protótipo (só DEV) ou em null
      }
      return loadPrototypeData(slug);
    },
    staleTime: 1000 * 60 * 5,
  });
}

export function useApproveDeliverable(slug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId }: { itemId: string }) => {
      try {
        await fetchApi(`/api/geracao-digital/portal/${slug}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId }),
        });
      } catch (e) {
        // Fallback offline/local
      }

      // Atualiza o estado em cache e no localStorage
      const current = queryClient.getQueryData<ClientPortalData | null>(["client-portal", slug]);
      if (!current) return { success: false, itemId };

      const updatedDeliverables = current.deliverables.map((item) =>
        item.id === itemId ? { ...item, status: "publicado" as DeliverableStatus } : item
      );

      const completedCount = updatedDeliverables.filter((d) => d.status === "publicado").length;
      const updatedStages = current.funnelStages.map((stage) => {
        const stageItems = updatedDeliverables.filter((d) => d.stage === stage.id);
        const stageDone = stageItems.filter((d) => d.status === "publicado").length;
        return {
          ...stage,
          completedVideos: stageDone,
        };
      });

      const updatedData: ClientPortalData = {
        ...current,
        weeklyPacing: {
          ...current.weeklyPacing,
          delivered: Math.min(current.weeklyPacing.delivered + 1, current.weeklyPacing.target),
        },
        funnelStages: updatedStages,
        deliverables: updatedDeliverables,
      };

      localStorage.setItem(
        `${LOCAL_STORAGE_KEY_PREFIX}${slug}`,
        JSON.stringify(updatedData)
      );

      queryClient.setQueryData(["client-portal", slug], updatedData);
      return { success: true, itemId };
    },
  });
}

export function useRequestRevision(slug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ itemId, feedback }: { itemId: string; feedback: string }) => {
      try {
        await fetchApi(`/api/geracao-digital/portal/${slug}/revision`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ itemId, feedback }),
        });
      } catch (e) {
        // Fallback offline/local
      }

      const current = queryClient.getQueryData<ClientPortalData | null>(["client-portal", slug]);
      if (!current) return { success: false, itemId };

      const updatedDeliverables = current.deliverables.map((item) =>
        item.id === itemId
          ? {
              ...item,
              status: "ajuste_solicitado" as DeliverableStatus,
              feedback,
            }
          : item
      );

      const updatedData: ClientPortalData = {
        ...current,
        deliverables: updatedDeliverables,
      };

      localStorage.setItem(
        `${LOCAL_STORAGE_KEY_PREFIX}${slug}`,
        JSON.stringify(updatedData)
      );

      queryClient.setQueryData(["client-portal", slug], updatedData);
      return { success: true, itemId, feedback };
    },
  });
}
