import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

export interface BriefingExtractPayload {
  transcricao: string;
}

export interface BriefingSavePayload {
  draft?: boolean;
  prospectName: string;
  whatsappNumber: string;
  agencyName: string;
  themePreset: string;
  briefingData: Record<string, any>;
  sendToProspectWhatsapp?: boolean;
  sendToProspectEmail?: boolean;
  prospectEmail?: string;
  sendToSectors?: boolean;
  sectorsWhatsapp?: string;
  sectorsEmail?: string;
  createWhatsappGroup?: boolean;
  whatsappGroupName?: string;
  whatsappGroupMembers?: string;
  slackChannelName?: string;
  slackExtraChannels?: string[];
  slackMembers?: string[];
}

export function useExtractBriefing() {
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({ transcricao }: BriefingExtractPayload) => {
      const token = (await user?.getIdToken()) || "";
      const res = await fetchApi("/api/geracao-digital/briefing/extract", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ transcricao }),
      });

      if (!res.ok) {
        throw new Error("Erro na extração com IA");
      }
      return (await res.json()) as { success: boolean; data: Record<string, string> };
    },
  });
}

export function useSaveBriefing() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: BriefingSavePayload) => {
      const token = (await user?.getIdToken()) || "";
      const res = await fetchApi("/api/geracao-digital/briefing", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(errorData?.error || `Erro ao salvar briefing (HTTP ${res.status})`);
      }
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["geracao-digital-briefings"] });
    },
  });
}
