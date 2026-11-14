import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";
import { orderChatsForTab } from "@/lib/inbox/chatOrder";

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
    meta?: any;
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
  /** Estado de trabalho calculado no servidor. Só vem nas abas de estado. */
  workState?: WorkState | null;
  /** Instante (ISO) da última mensagem do lead. É dele que sai o tempo de espera. */
  waitingSince?: string | null;
  /** O lead nunca escreveu: só há mensagem nossa (disparo sem resposta). */
  leadNeverSpoke?: boolean;
  /** Chip em que o lead escreveu por último. Só vem nas abas de estado. */
  leadChip?: string | null;
}

export type WorkState = "esperam" | "com_lead" | "robo" | "esfriaram";

export interface WorkStateCounts {
  esperam: number;
  com_lead: number;
  robo: number;
  esfriaram: number;
}

/** Quem responde sozinho em cada chip, pela mesma regra do portão do webhook. */
export interface ChipAgentInfo {
  kind: "agente" | "empresa" | "nenhum";
  agentName: string | null;
  reason: string;
}

export interface WhatsAppCounts {
  active: number;
  awaiting: number;
  automations: number;
  groups: number;
  archived: number;
  paused?: number;
  myUnopened?: number;
  work?: WorkStateCounts;
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
  mediaUrl?: string | null;
  media_url?: string | null;
  contentType?: string | null;
  content_type?: string | null;
  meta?: any;
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
  chipAgents?: Record<string, ChipAgentInfo>;
  nextOffset: number;
  hasMore: boolean;
}

export interface ReplyChipAlternative {
  id: string;
  name: string;
  isDefault?: boolean;
}

// O chip em que o lead escreveu não pode enviar (desconectado ou fora do cadastro). O servidor não
// enviou nada: a tela precisa de uma confirmação explícita para mandar por outro chip.
export class ReplyChipUnavailableError extends Error {
  reason: string;
  conversationChip: string | null;
  alternatives: ReplyChipAlternative[];

  constructor(message: string, details: { reason?: string; conversationChip?: string | null; alternatives?: ReplyChipAlternative[] } = {}) {
    super(message);
    this.name = "ReplyChipUnavailableError";
    this.reason = details.reason || "disconnected";
    this.conversationChip = details.conversationChip ?? null;
    this.alternatives = Array.isArray(details.alternatives) ? details.alternatives : [];
  }
}

async function parseApiResponse<T>(res: Response): Promise<T> {
  if (res.ok) {
    return res.json();
  }

  let message = `WhatsApp request failed: ${res.status}`;

  try {
    const payload = await res.json();
    message = payload?.error?.message || payload?.message || message;
    if (payload?.error?.code === "REPLY_CHIP_UNAVAILABLE") {
      throw new ReplyChipUnavailableError(message, payload.error.details || {});
    }
  } catch (err) {
    if (err instanceof ReplyChipUnavailableError) throw err;
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

// Teto de espera da lista de conversas no navegador. Sem isso um pedido que nunca volta deixa a
// coluna em "Carregando conversas..." para sempre. Fica acima do teto do servidor (8 s).
export const CHATS_REQUEST_TIMEOUT_MS = 15000;

export class ChatsRequestTimeoutError extends Error {
  constructor() {
    super("A lista de conversas demorou demais para responder.");
    this.name = "ChatsRequestTimeoutError";
  }
}

/**
 * fetch com dois motivos de cancelamento: o sinal de quem chamou (a tela pediu outra coisa ou
 * saiu) e o teto de tempo. Só o teto vira erro visível; cancelamento de quem chamou é silencioso.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  { signal, timeoutMs = CHATS_REQUEST_TIMEOUT_MS }: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) throw new ChatsRequestTimeoutError();
    throw err;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
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

  const fetchChatsPage = async (offset: number, signal?: AbortSignal): Promise<WhatsAppChatsPage> => {
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

    // O sinal vem do React Query: trocar de aba, de chip ou de empresa, ou sair da tela, CANCELA
    // o pedido anterior em vez de deixá-lo rodando atrás do novo.
    const res = await fetchWithTimeout(
      `${API_BASE_URL}/api/whatsapp/chats?${params.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
      { signal }
    );

    return parseApiResponse<WhatsAppChatsPage>(res);
  };

  // Estourou o teto: não insiste (cada tentativa são mais 15 s de "Carregando"). O próximo
  // ciclo de 12 s tenta de novo sozinho. Outras falhas: uma nova tentativa.
  const retryChats = (failureCount: number, err: unknown) =>
    !(err instanceof ChatsRequestTimeoutError) && failureCount < 1;

  const recentChatsQuery = useQuery({
    queryKey: ["whatsapp-chats", clientId, instanceName, tab, search, "recent"],
    enabled: enabled && !!clientId,
    queryFn: async ({ signal }) => fetchChatsPage(0, signal),
    retry: retryChats,
    refetchInterval: isVisible && enabled && !!clientId && !search.trim() ? 12000 : false,
    refetchIntervalInBackground: false,
    staleTime: 5000,
  });

  const olderChatsQuery = useInfiniteQuery({
    queryKey: ["whatsapp-chats", clientId, instanceName, tab, search, "older"],
    enabled: enabled && olderPagesEnabled && !!clientId,
    initialPageParam: 40,
    queryFn: async ({ pageParam, signal }) => fetchChatsPage(pageParam, signal),
    retry: retryChats,
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

    return orderChatsForTab(Array.from(deduped.values()), tab);
  }, [olderItems, recentChatsQuery.data?.items, tab]);

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
    chipAgents: recentChatsQuery.data?.chipAgents ?? {},
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

export function useMuteChat(clientId: string | null) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ phone }: { phone: string }) => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const res = await fetch(`${API_BASE_URL}/api/whatsapp/chats/mute`, {
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
    // confirmChipId só vai quando o operador confirmou, na tela, o envio por outro chip.
    mutationFn: async (input: string | { body: string; confirmChipId?: string }) => {
      const body = typeof input === "string" ? input : input.body;
      const confirmChipId = typeof input === "string" ? undefined : input.confirmChipId;
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
          ...(confirmChipId ? { confirmChipId } : {}),
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

// "Nova conversa": a empresa escreve primeiro. Mesma rota da resposta manual, com newConversation.
// Devolve o id da conversa para a tela abrir. `existing` = a conversa já existia e nada foi enviado.
export function useStartWhatsAppConversation(clientId: string | null) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { phone: string; chipId: string; body: string }): Promise<{ chatId: string; existing: boolean }> => {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }
      const res = await fetch(`${API_BASE_URL}/api/whatsapp/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, chatId: input.phone, body: input.body, chipId: input.chipId, newConversation: true }),
      });
      const payload = await parseApiResponse<{ chatId?: string; existing?: boolean }>(res);
      if (!payload?.chatId) throw new Error("O servidor não devolveu a conversa. Confira na lista antes de enviar de novo.");
      return { chatId: payload.chatId, existing: payload.existing === true };
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
  /** Só quando o operador confirmou, na tela, o envio por outro chip. */
  confirmChipId?: string;
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

/**
 * Apaga mensagem (para mim ou para todos via Evolution)
 */
export function useDeleteWhatsAppMessage(clientId: string | null) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      messageId,
      mode = "me",
    }: {
      messageId: string;
      mode?: "me" | "everyone";
    }) => {
      if (!clientId) throw new Error("Client ID é obrigatório");
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado");

      const params = new URLSearchParams({ clientId, mode });
      const res = await fetch(`${API_BASE_URL}/api/whatsapp/messages/${encodeURIComponent(messageId)}?${params.toString()}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return parseApiResponse<{ success: boolean; mode: string; messageId: string }>(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-messages"] });
    },
  });
}

/**
 * Limpa o histórico de uma conversa da tela do operador logado
 */
export function useClearSingleChat(clientId: string | null) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ phone }: { phone: string }) => {
      if (!clientId) throw new Error("Client ID é obrigatório");
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado");

      const params = new URLSearchParams({ clientId });
      const res = await fetch(`${API_BASE_URL}/api/whatsapp/chats/${encodeURIComponent(phone)}/clear?${params.toString()}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      return parseApiResponse<{ success: boolean; phone: string; clearedAt: string }>(res);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["whatsapp-messages"] });
      queryClient.invalidateQueries({ queryKey: ["whatsapp-chats"] });
    },
  });
}

/**
 * Busca foto de perfil do contato via Evolution API
 */
export function useWhatsAppProfilePic(phone: string | null | undefined, clientId: string | null) {
  const { getIdToken } = useAuth();

  return useQuery({
    queryKey: ["whatsapp-profile-pic", clientId, phone],
    queryFn: async () => {
      if (!phone || !clientId) return null;
      const token = await getIdToken();
      if (!token) return null;

      const params = new URLSearchParams({ clientId, phone });
      const res = await fetch(`${API_BASE_URL}/api/whatsapp/contact-profile-pic?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!res.ok) return null;
      const data = await res.json();
      return data?.profilePictureUrl || null;
    },
    enabled: Boolean(phone && clientId),
    staleTime: 1000 * 60 * 60 * 24, // Cache de 24 horas
  });
}
