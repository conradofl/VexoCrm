import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";

export type MediaType = "audio" | "image" | "video" | "document" | "sticker";

export interface MediaMessage {
  messageId?: string;
  waMessageId?: string;
  mediaType: MediaType;
  mimeType: string | null;
  dataUrl: string | null;
  url: string | null;
  transcription: string | null;
  description: string | null;
  fileName: string | null;
  expired?: boolean;
  source?: string;
}

export function useMediaMessage(messageId: string | null, hasMedia: boolean, clientId?: string | null) {
  const { getIdToken } = useAuth();

  return useQuery({
    queryKey: ["media-message", messageId, clientId],
    enabled: hasMedia && !!messageId,
    queryFn: async (): Promise<MediaMessage | null> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const params = new URLSearchParams({ format: "json" });
      if (clientId) {
        params.set("clientId", clientId);
      }

      const res = await fetch(`${API_BASE_URL}/api/whatsapp/media/${encodeURIComponent(messageId!)}?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.status === 404) return null;

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Erro ao carregar mídia (${res.status}): ${text.slice(0, 120)}`);
      }

      const data = await res.json() as { item?: MediaMessage };
      return data.item ?? null;
    },
    retry: false,
    staleTime: 10 * 60 * 1000,
  });
}
