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
  state?: "ativa" | "automacao" | "arquivada" | "lixeira";
  stateReason?: string | null;
  stateSource?: "auto" | "manual";
  isNumberChange?: boolean;
  pinned: boolean;
  muted: boolean;
  lastMessage: {
    id: string | null;
    body: string;
    fromMe: boolean;
    senderType?: string | null;
    timestamp: number | null;
    type: string | null;
  } | null;
  leadOrigin: string | null;
  sourceCampaignId: string | null;
  /** Data/hora do último atendimento manual pontual */
  attendedAt?: string | null;
  /** Quem marcou como atendido */
  attendedBy?: string | null;
  /** Data/hora em que o agente foi pausado por conversa não-comercial */
  agentMutedAt?: string | null;
  /** Motivo da detecção de conversa não-comercial */
  agentMutedReason?: string | null;
  /** Foto do perfil do WhatsApp (URL temporária da Evolution). */
  profilePic?: string | null;
}

export interface WhatsAppCounts {
  active: number;
  awaiting: number;
  automations: number;
  groups: number;
  archived: number;
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
  mediaPath?: string | null;
  waMessageId?: string | null;
  phone?: string | null;
  direction?: string | null;
  senderType?: string | null;
  createdAt?: string | null;
  messageTimestamp?: string | null;
}

interface WhatsAppChatsPage {
  items: WhatsAppChat[];
  total: number;
  counts?: WhatsAppCounts;
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

export function useDocumentVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(() =>
    typeof document !== "undefined" ? document.visibilityState === "visible" : true
  );

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return isVisible;
}

export function useWhatsAppChats(
  clientId: string | null,
  instanceName: string | null,
  enabled: boolean,
  options?: { tab?: string; search?: string }
) {
  const { getIdToken } = useAuth();
  const isVisible = useDocumentVisibility();
  const [olderPagesEnabled, setOlderPagesEnabled] = useState(false);
  const tab = options?.tab || "ativa";
  const search = options?.search || "";

  useEffect(() => {
    if (!enabled) {
      setOlderPagesEnabled(false);
    }
  }, [enabled, tab, search]);

  const fetchChatsPage = async (offset: number): Promise<WhatsAppChatsPage> => {
    const token = await getIdToken();
    if (!token) {
      throw new Error("Usuario nao autenticado.");
    }

    const params = new URLSearchParams({
      limit: "40",
      offset: String(offset),
      tab,
    });

    if (clientId) {
      params.append("clientId", clientId);
    }
    
    if (instanceName) {
      params.append("instanceName", instanceName);
    }

    if (search.trim()) {
      params.append("search", search.trim());
    }

    const res = await fetch(`${API_BASE_URL}/api/whatsapp/chats?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    return parseApiResponse<WhatsAppChatsPage>(res);
  };

  const recentChatsQuery = useQuery({
    queryKey: ["whatsapp-chats", clientId, instanceName, tab, search, "recent"],
    enabled: enabled && !!clientId,
    queryFn: async () => fetchChatsPage(0),
    refetchInterval: isVisible && enabled && !!clientId && !search.trim() ? 12000 : false,
    refetchIntervalInBackground: false,
    staleTime: 5000,
  });

  const olderChatsQuery = useInfiniteQuery({
    queryKey: ["whatsapp-chats", clientId, instanceName, tab, search, "older"],
    enabled: enabled && olderPagesEnabled && !!clientId,
    initialPageParam: 40,
    queryFn: async ({ pageParam }) => fetchChatsPage(pageParam),
    getNextPageParam: (lastPage) => (lastPage.hasMore ? lastPage.nextOffset : undefined),
    staleTime: 30000,
  });

  const olderItems = olderChatsQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const items = useMemo(() => {
    const ordered = [...(recentChatsQuery.data?.items ?? []), ...olderItems];
    const deduped = new Map<string, WhatsAppChat>();

    for (const item of ordered) {
      if (!item.id || deduped.has(item.id)) continue;
      deduped.set(item.id, item);
    }

    const list = Array.from(deduped.values());
    // Reordenar por mensagem mais recente para que novas mensagens subam para o topo
    return list.sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
  }, [olderItems, recentChatsQuery.data?.items]);

  const total = recentChatsQuery.data?.total ?? items.length;
  const counts = recentChatsQuery.data?.counts || { active: 0, awaiting: 0, automations: 0, groups: 0, archived: 0 };
  const isLoading = recentChatsQuery.isLoading;
  const error = recentChatsQuery.error ?? olderChatsQuery.error;
  const isFetchingNextPage =
    olderChatsQuery.isFetchingNextPage || (olderPagesEnabled && olderChatsQuery.isLoading);
  const hasMore = total > items.length;

  return {
    ...recentChatsQuery,
    items,
    total,
    counts,
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

export function useUpdateChatState(clientId: string | null) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      phone,
      state,
      reason,
    }: {
      phone: string;
      state: "ativa" | "automacao" | "arquivada" | "lixeira";
      reason?: string;
    }) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/whatsapp/chats/state`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clientId, phone, state, reason }),
      });

      return parseApiResponse<{ success: boolean; phone: string; state: string }>(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
  });
}

export function useBulkUpdateChatState(clientId: string | null) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      phones,
      state,
      reason,
    }: {
      phones: string[];
      state: "ativa" | "automacao" | "arquivada" | "lixeira";
      reason?: string;
    }) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/whatsapp/chats/state/bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clientId, phones, state, reason }),
      });

      return parseApiResponse<{ success: boolean; count: number; state: string }>(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
  });
}

export function useAttendChat(clientId: string | null) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ phone }: { phone: string }) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/whatsapp/chats/attend`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clientId, phone }),
      });

      return parseApiResponse<{ success: boolean; phone: string; attended_at: string; attended_by: string }>(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
  });
}

export function useUnmuteChat(clientId: string | null) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ phone }: { phone: string }) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/whatsapp/chats/unmute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clientId, phone }),
      });

      return parseApiResponse<{ success: boolean; phone: string }>(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
  });
}

export function useCreateLeadFromChat(clientId: string | null) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      phone,
      name,
    }: {
      phone: string;
      name?: string | null;
    }) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/whatsapp/chats/create-lead`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clientId, phone, name }),
      });

      return parseApiResponse<{ success: boolean; lead: any; message: string }>(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
  });
}

export function useBulkCreateLeadsFromChats(clientId: string | null) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      items,
    }: {
      items: Array<{ phone: string; name?: string | null }>;
    }) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/whatsapp/chats/create-leads-bulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ clientId, items }),
      });

      return parseApiResponse<{ success: boolean; count: number; message: string }>(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leads"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
  });
}

export interface WhatsAppMessagesPage {
  items: WhatsAppMessage[];
  hasMore: boolean;
  oldestTimestamp: string | null;
  newestTimestamp?: string | null;
}

export function useWhatsAppMessages(
  clientId: string | null,
  instanceName: string | null,
  chatId: string | null,
  enabled: boolean
) {
  const { getIdToken } = useAuth();
  const isVisible = useDocumentVisibility();
  const queryClient = useQueryClient();

  const fetchMessagesPage = async (beforeTimestamp: string | null): Promise<WhatsAppMessagesPage> => {
    const token = await getIdToken();
    if (!token) throw new Error("Usuario nao autenticado.");

    const params = new URLSearchParams({
      chatId: chatId || "",
      limit: "40",
    });

    if (clientId) params.append("clientId", clientId);
    if (instanceName) params.append("instanceName", instanceName);
    if (beforeTimestamp) params.append("beforeTimestamp", beforeTimestamp);

    const res = await fetch(`${API_BASE_URL}/api/whatsapp/messages?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const payload = await parseApiResponse<{
      items?: WhatsAppMessage[];
      hasMore?: boolean;
      oldestTimestamp?: string | null;
      newestTimestamp?: string | null;
    }>(res);

    return {
      items: Array.isArray(payload.items) ? payload.items : [],
      hasMore: Boolean(payload.hasMore),
      oldestTimestamp: payload.oldestTimestamp ?? null,
      newestTimestamp: payload.newestTimestamp ?? null,
    };
  };

  const queryKey = useMemo(
    () => ["whatsapp-messages", clientId, instanceName, chatId],
    [clientId, instanceName, chatId]
  );

  const query = useInfiniteQuery({
    queryKey,
    enabled: enabled && !!chatId && !!clientId,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => fetchMessagesPage(pageParam),
    getNextPageParam: (lastPage) => (lastPage.hasMore && lastPage.oldestTimestamp ? lastPage.oldestTimestamp : undefined),
    refetchInterval: false, // NUNCA refaz a consulta inteira via polling
    refetchIntervalInBackground: false,
    staleTime: Infinity,
  });

  const items = useMemo(() => {
    const pages = query.data?.pages ?? [];
    const reversed = [...pages].reverse();
    const flat = reversed.flatMap((p) => p.items);
    const seenIds = new Set<string>();
    const seenWaIds = new Set<string>();
    const deduped: WhatsAppMessage[] = [];

    for (const m of flat) {
      if (m.id && seenIds.has(m.id)) continue;
      if (m.waMessageId && typeof m.waMessageId === "string" && m.waMessageId.trim()) {
        const waId = m.waMessageId.trim();
        if (seenWaIds.has(waId)) continue;
        seenWaIds.add(waId);
      }

      const mTime = m.timestamp ? m.timestamp * 1000 : 0;
      const mText = (m.body || "").trim();
      const mFromMe = Boolean(m.fromMe);

      const isFuzzyDuplicate = deduped.some((existing) => {
        if (Boolean(existing.fromMe) !== mFromMe) return false;
        if ((existing.body || "").trim() !== mText) return false;
        const existingTime = existing.timestamp ? existing.timestamp * 1000 : 0;
        return Math.abs(mTime - existingTime) <= 10000;
      });

      if (isFuzzyDuplicate) continue;

      if (m.id) seenIds.add(m.id);
      deduped.push(m);
    }
    return deduped;
  }, [query.data?.pages]);

  // ── Polling Incremental com afterTimestamp (5 segundos) ────────────────────
  useEffect(() => {
    if (!enabled || !chatId || !clientId || !isVisible) return;

    let isCancelled = false;

    const pollIncrementalMessages = async () => {
      if (isCancelled || typeof document === "undefined" || document.visibilityState !== "visible") {
        return;
      }

      try {
        const currentPages = queryClient.getQueryData<any>(queryKey)?.pages;
        if (!currentPages || currentPages.length === 0) return;

        // Encontra o timestamp mais recente entre todas as mensagens carregadas
        const allLoaded = currentPages.flatMap((p: any) => p.items || []);
        if (allLoaded.length === 0) return;

        let maxTimeMs = 0;
        for (const msg of allLoaded) {
          const t = msg.effectiveTimestamp
            ? new Date(msg.effectiveTimestamp).getTime()
            : msg.createdAt
            ? new Date(msg.createdAt).getTime()
            : msg.timestamp
            ? msg.timestamp * 1000
            : 0;
          if (t > maxTimeMs) maxTimeMs = t;
        }

        if (!maxTimeMs) return;
        const afterIso = new Date(maxTimeMs).toISOString();

        const token = await getIdToken();
        if (!token || isCancelled) return;

        const params = new URLSearchParams({
          chatId: chatId || "",
          limit: "50",
          afterTimestamp: afterIso,
        });

        if (clientId) params.append("clientId", clientId);
        if (instanceName) params.append("instanceName", instanceName);

        const res = await fetch(`${API_BASE_URL}/api/whatsapp/messages?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok || isCancelled) return;

        const payload = await res.json().catch(() => null);
        const newItems: WhatsAppMessage[] = Array.isArray(payload?.items) ? payload.items : [];

        if (newItems.length > 0 && !isCancelled) {
          queryClient.setQueryData<any>(queryKey, (oldData: any) => {
            if (!oldData || !oldData.pages || oldData.pages.length === 0) return oldData;
            const firstPage = oldData.pages[0];
            const existingIds = new Set((firstPage.items || []).map((m: any) => String(m.id)));
            const trulyNew = newItems.filter((m) => m.id && !existingIds.has(String(m.id)));

            if (trulyNew.length === 0) return oldData;

            const updatedFirstPage = {
              ...firstPage,
              items: [...(firstPage.items || []), ...trulyNew],
            };

            return {
              ...oldData,
              pages: [updatedFirstPage, ...oldData.pages.slice(1)],
            };
          });
        }
      } catch {
        // Falhas silenciosas de polling em background
      }
    };

    const intervalId = setInterval(pollIncrementalMessages, 5000);

    return () => {
      isCancelled = true;
      clearInterval(intervalId);
    };
  }, [enabled, chatId, clientId, instanceName, isVisible, queryKey, getIdToken, queryClient]);

  const lastPage = query.data?.pages?.[query.data.pages.length - 1];
  const hasMore = lastPage ? lastPage.hasMore : false;

  return {
    ...query,
    data: items,
    items,
    hasMore,
    isFetchingOlder: query.isFetchingNextPage,
    loadOlder: async () => {
      if (query.hasNextPage && !query.isFetchingNextPage) {
        await query.fetchNextPage();
      }
    },
  };
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
      queryClient.invalidateQueries({ queryKey: ["whatsapp-messages", clientId] });
    },
  });
}

export interface SendWhatsAppMediaParams {
  mediaType: "audio" | "image" | "video" | "document";
  base64: string;
  mimetype?: string;
  fileName?: string;
  caption?: string;
}

export function useSendWhatsAppMediaMessage(clientId: string | null, chatId: string | null) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: SendWhatsAppMediaParams) => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuário não autenticado.");
      }

      const res = await fetch(`${API_BASE_URL}/api/whatsapp/messages/media`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          chatId,
          ...params,
        }),
      });

      return parseApiResponse<{ success: boolean; item: WhatsAppMessage }>(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-chats", clientId] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-messages", clientId] });
    },
  });
}

export function useClearWhatsAppChats(clientId: string | null) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (instanceName: string | null) => {
      if (!clientId) throw new Error("Client ID is required");
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const params = new URLSearchParams({ clientId });
      if (instanceName) {
        params.append("instanceName", instanceName);
      }

      const res = await fetch(`${API_BASE_URL}/api/whatsapp/chats/clear?${params.toString()}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return parseApiResponse<{ success: boolean; deletedCount: number }>(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-chats", clientId] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-messages", clientId] });
    },
  });
}
