import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";

export interface WhatsAppChat {
  id: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
  timestamp: number | null;
  archived: boolean;
  pinned: boolean;
  muted: boolean;
  lastMessage: {
    id: string | null;
    body: string;
    fromMe: boolean;
    timestamp: number | null;
    type: string | null;
  } | null;
  leadOrigin: string | null;
  sourceCampaignId: string | null;
}

export interface WhatsAppMessage {
  id: string | null;
  body: string;
  from: string | null;
  to: string | null;
  author: string | null;
  fromMe: boolean;
  timestamp: number | null;
  type: string | null;
  hasMedia: boolean;
}

interface WhatsAppChatsPage {
  items: WhatsAppChat[];
  total: number;
  nextOffset: number;
  hasMore: boolean;
}

async function parseApiResponse<T>(res: Response): Promise<T> {
  if (res.ok) {
    return res.json();
  }

  let message = `WhatsApp request failed: ${res.status}`;

  try {
    const payload = await res.json();
    message = payload?.error?.message || payload?.message || message;
  } catch {
    const text = await res.text();
    if (text) {
      message = text;
    }
  }

  throw new Error(message);
}

export function useWhatsAppChats(clientId: string | null, enabled: boolean) {
  const { getIdToken } = useAuth();
  const [olderPagesEnabled, setOlderPagesEnabled] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setOlderPagesEnabled(false);
    }
  }, [enabled]);

  const fetchChatsPage = async (offset: number): Promise<WhatsAppChatsPage> => {
    const token = await getIdToken();
    if (!token) {
      throw new Error("Usuario nao autenticado.");
    }

    const params = new URLSearchParams({
      limit: "20",
      offset: String(offset),
    });

    if (clientId) {
      params.append("clientId", clientId);
    }

    const res = await fetch(`${API_BASE_URL}/api/whatsapp/chats?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return parseApiResponse<WhatsAppChatsPage>(res);
  };

  const recentChatsQuery = useQuery({
    queryKey: ["whatsapp-chats", clientId, "recent"],
    enabled: enabled && !!clientId,
    queryFn: async () => fetchChatsPage(0),
    refetchInterval: enabled && !!clientId ? 5000 : false,
    staleTime: 0,
  });

  const olderChatsQuery = useInfiniteQuery({
    queryKey: ["whatsapp-chats", clientId, "older"],
    enabled: enabled && olderPagesEnabled && !!clientId,
    initialPageParam: 20,
    queryFn: async ({ pageParam }) => fetchChatsPage(pageParam),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextOffset : undefined),
    staleTime: 0,
  });

  const olderItems = olderChatsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const items = useMemo(() => {
    const ordered = [...(recentChatsQuery.data?.items ?? []), ...olderItems];
    const deduped = new Map<string, WhatsAppChat>();

    for (const item of ordered) {
      if (!item.id || deduped.has(item.id)) continue;
      deduped.set(item.id, item);
    }

    return Array.from(deduped.values());
  }, [olderItems, recentChatsQuery.data?.items]);

  const total = recentChatsQuery.data?.total ?? items.length;
  const isLoading = recentChatsQuery.isLoading;
  const error = recentChatsQuery.error ?? olderChatsQuery.error;
  const isFetchingNextPage =
    olderChatsQuery.isFetchingNextPage || (olderPagesEnabled && olderChatsQuery.isLoading);
  const hasMore = total > items.length;

  return {
    ...recentChatsQuery,
    items,
    total,
    hasMore,
    isLoading,
    error,
    isFetchingNextPage,
    loadMore: async () => {
      if (!olderPagesEnabled) {
        setOlderPagesEnabled(true);
        return;
      }

      if (olderChatsQuery.hasNextPage) {
        await olderChatsQuery.fetchNextPage();
      }
    },
  };
}

export function useWhatsAppMessages(clientId: string | null, chatId: string | null, enabled: boolean) {
  const { getIdToken } = useAuth();

  return useQuery({
    queryKey: ["whatsapp-messages", clientId, chatId],
    enabled: enabled && !!chatId && !!clientId,
    queryFn: async (): Promise<WhatsAppMessage[]> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const params = new URLSearchParams({
        chatId: chatId || "",
        limit: "20",
      });

      if (clientId) {
        params.append("clientId", clientId);
      }

      const res = await fetch(
        `${API_BASE_URL}/api/whatsapp/messages?${params.toString()}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      const payload = await parseApiResponse<{ items?: WhatsAppMessage[] }>(res);
      return Array.isArray(payload.items) ? payload.items : [];
    },
    refetchInterval: enabled && !!chatId && !!clientId ? 4000 : false,
    staleTime: 0,
  });
}

export function useSendWhatsAppMessage(clientId: string | null, chatId: string | null) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (body: string) => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetch(`${API_BASE_URL}/api/whatsapp/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          chatId,
          body,
        }),
      });

      return parseApiResponse<{ item: WhatsAppMessage }>(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-chats", clientId] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-messages", clientId, chatId] });
    },
  });
}
