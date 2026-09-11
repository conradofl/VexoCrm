import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Clock3,
  LoaderCircle,
  MessageCircle,
  QrCode,
  RefreshCw,
  RotateCcw,
  Send,
  Smartphone,
  Wifi,
  WifiOff,
  Search,
  Lock,
  FileText,
  Flame,
  Sparkles,
  UserCheck,
  Phone,
  MapPin,
  Target,
  DollarSign,
  Calendar,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ShieldAlert,
  Inbox,
  User,
  Activity,
  Zap,
  Archive,
  ArchiveRestore,
  Bot,
  BotOff,
  Users,
  MoreVertical,
  CheckSquare,
  Square,
  Undo2,
  UserPlus,
  CheckCheck,
} from "lucide-react";
import { useCampanhas } from "@/hooks/useCampanhas";
import { useCrmClient } from "@/hooks/useCrmClient";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { PageShell } from "@/components/PageShell";
import { SectionHeader } from "@/components/SectionHeader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { cn } from "@/lib/utils";
import { useLeadClients } from "@/hooks/useLeadClients";
import { useLeads, type LeadRow } from "@/hooks/useLeads";
import {
  useSendWhatsAppMessage,
  useWhatsAppChats,
  useWhatsAppMessages,
  useClearWhatsAppChats,
  useUpdateChatState,
  useBulkUpdateChatState,
  useAttendChat,
  useUnmuteChat,
  useCreateLeadFromChat,
  useBulkCreateLeadsFromChats,
  type WhatsAppChat,
  type WhatsAppMessage,
} from "@/hooks/useWhatsAppInbox";
import { SingleFollowupReminderModal } from "@/components/followup/SingleFollowupReminderModal";
import ApplyFollowupModal from "@/components/followup/ApplyFollowupModal";
import { MediaMessage } from "@/components/MediaMessage";
import { API_BASE_URL } from "@/lib/api";
import { sanitizePhone } from "@/lib/phone";
import { formatHeaderCount } from "@/lib/messageFormatting";

interface InternalNote {
  id: string;
  chatId: string;
  body: string;
  author: string;
  timestamp: number;
}

type TimelineItem =
  | (WhatsAppMessage & { isInternalNote?: false })
  | {
      id: string;
      body: string;
      from: null;
      to: null;
      author: string;
      fromMe: true;
      timestamp: number;
      type: "internal_note";
      hasMedia: false;
      isInternalNote: true;
      senderType?: string | null;
    };

function formatTimestamp(timestamp: number | null, withDate = false) {
  if (!timestamp) return "";

  return new Date(timestamp * 1000).toLocaleString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    ...(withDate
      ? {
          day: "2-digit",
          month: "2-digit",
        }
      : {}),
  });
}

function formatChatDate(timestamp: number | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  const now = new Date();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);
  const startOfWeekAgo = new Date(startOfToday.getTime() - 6 * 24 * 60 * 60 * 1000);

  if (date >= startOfToday) {
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }
  if (date >= startOfYesterday) {
    return "Ontem";
  }
  if (date >= startOfWeekAgo) {
    const weekday = date.toLocaleDateString("pt-BR", { weekday: "short" });
    const clean = weekday.replace(".", "").trim();
    return clean.charAt(0).toUpperCase() + clean.slice(1);
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  }
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function formatDaySeparator(timestamp: number | null): string {
  if (!timestamp) return "";
  const date = new Date(timestamp * 1000);
  const now = new Date();

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

  if (date >= startOfToday) {
    return "Hoje";
  }
  if (date >= startOfYesterday) {
    return "Ontem";
  }

  const raw = date.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function getPreview(chat: WhatsAppChat) {
  const body = chat.lastMessage?.body?.trim();
  if (!body) return "Sem mensagens recentes.";
  return body.length > 60 ? `${body.slice(0, 60)}...` : body;
}

function ChatAvatar({
  label,
  picture,
  size = "md",
}: {
  label?: string;
  picture?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const [failed, setFailed] = useState(false);
  const clean = (label || "").trim();
  const initial = clean ? clean.replace(/[^\p{L}\p{N}]/gu, "").charAt(0).toUpperCase() || "#" : "#";
  const dim =
    size === "sm"
      ? "h-8 w-8 text-xs"
      : size === "lg"
      ? "h-14 w-14 text-lg font-bold"
      : "h-10 w-10 text-sm font-semibold";

  if (picture && !failed) {
    return (
      <img
        src={picture}
        alt={clean || "Contato"}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn("shrink-0 rounded-full object-cover border border-border/60", dim)}
      />
    );
  }

  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-emerald-500/15 font-semibold text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300 border border-emerald-500/30",
        dim
      )}
    >
      {initial}
    </div>
  );
}

function OriginBadge({
  origin,
  campaignId,
  campaignNames,
}: {
  origin: string | null;
  campaignId: string | null;
  campaignNames: Map<string, string>;
}) {
  if (!origin) return null;

  if (origin === "campaign") {
    const name = campaignId ? campaignNames.get(campaignId) : undefined;
    return (
      <span className="rounded-full border border-emerald-300/40 bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300">
        {name ? `Campanha: ${name}` : "Campanha"}
      </span>
    );
  }

  if (origin === "inbound") {
    return (
      <span className="rounded-full border border-border/50 bg-muted/50 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
        Inbound
      </span>
    );
  }

  return null;
}

interface WhatsAppInboxProps {
  title?: string;
  subtitle?: string;
  headerRight?: ReactNode;
  allowSessionControls?: boolean;
  clientId?: string;
}

export default function WhatsAppInbox({
  title = "WhatsApp Inbox",
  subtitle = "Central de atendimento omnichannel em 3 colunas com dossiê do cliente em tempo real.",
  headerRight,
  allowSessionControls = true,
  clientId: propClientId,
}: WhatsAppInboxProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialPhone = searchParams.get("phone") ?? null;

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [selectedInstanceNames, setSelectedInstanceNames] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [compositionMode, setCompositionMode] = useState<"whatsapp" | "internal_note">("whatsapp");
  const [inboxTab, setInboxTab] = useState<"fila" | "aguardando" | "minhas" | "automacao" | "arquivadas" | "grupos" | "todas">("fila");
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [hasNewUnseenMessage, setHasNewUnseenMessage] = useState(false);
  const [showDossier, setShowDossier] = useState(true);
  const [isReminderModalOpen, setIsReminderModalOpen] = useState(false);
  const [isApplyFollowupModalOpen, setIsApplyFollowupModalOpen] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const chatsContainerRef = useRef<HTMLDivElement | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const prevScrollHeightRef = useRef<number>(0);
  const prevScrollTopRef = useRef<number>(0);
  const isNearBottomRef = useRef<boolean>(true);
  const lastChatIdRef = useRef<string | null>(null);
  const lastRenderedMessageIdRef = useRef<string | null>(null);
  const lastMessageCountRef = useRef<number>(0);
  const isFetchingOlderRef = useRef<boolean>(false);

  const { selectedClientId } = useCrmClient();
  const clientId = propClientId || selectedClientId;

  const { user } = useAuth();
  const { data: tenants = [], isLoading: tenantsLoading } = useLeadClients();
  const activeTenant = tenants.find((t) => t.id === clientId) ?? null;
  const evolutionInstances = activeTenant?.n8n_settings?.evolution_instances ?? [];
  const hasConnectedInstances = evolutionInstances.some((inst) => inst.active);

  const campaignsQuery = useCampanhas(clientId ?? undefined);
  const campaignNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of campaignsQuery.data ?? []) {
      map.set(c.id, c.name);
    }
    return map;
  }, [campaignsQuery.data]);

  const canLoadInbox = Boolean(clientId);
  const instanceFilter = selectedInstanceNames.length > 0 ? selectedInstanceNames.join(",") : null;
  const chatsQuery = useWhatsAppChats(clientId, instanceFilter, canLoadInbox, {
    tab: inboxTab,
    search: debouncedSearch,
  });
  const updateChatState = useUpdateChatState(clientId);
  const bulkUpdateChatState = useBulkUpdateChatState(clientId);
  const attendChat = useAttendChat(clientId);
  const unmuteChat = useUnmuteChat(clientId);
  const createLeadMutation = useCreateLeadFromChat(clientId);
  const bulkCreateLeadsMutation = useBulkCreateLeadsFromChats(clientId);
  const messagesQuery = useWhatsAppMessages(clientId, instanceFilter, selectedChatId, canLoadInbox);
  const sendMessage = useSendWhatsAppMessage(clientId, selectedChatId);
  const clearChats = useClearWhatsAppChats(clientId);

  // ── Seleção Múltipla e Ações em Massa ─────────────────────────────────────────
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkConfirmCount, setBulkConfirmCount] = useState(0);
  const [bulkConfirmPhones, setBulkConfirmPhones] = useState<string[]>([]);
  const [bulkLeadConfirmOpen, setBulkLeadConfirmOpen] = useState(false);
  const [showOlderAwaiting, setShowOlderAwaiting] = useState(false);
  const [undoArchiveState, setUndoArchiveState] = useState<{ count: number; phones: string[] } | null>(null);
  const undoTimeoutRef = useRef<any>(null);

  // Limpa seleção sempre que mudar de aba ou de termo de busca (garante isolamento estrito)
  useEffect(() => {
    setSelectedChatIds(new Set());
  }, [inboxTab, debouncedSearch]);

  const toggleSelectChat = (chatId: string) => {
    setSelectedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      return next;
    });
  };

  const handleSelectAllVisible = () => {
    const visibleIds = (chatsQuery.items ?? []).map((c) => c.id);
    setSelectedChatIds(new Set(visibleIds));
  };

  const handleRequestBulkArchive = (phonesToArchive: string[]) => {
    if (phonesToArchive.length === 0) return;
    setBulkConfirmPhones(phonesToArchive);
    setBulkConfirmCount(phonesToArchive.length);
    setBulkConfirmOpen(true);
  };

  const handleConfirmBulkArchive = async () => {
    if (bulkConfirmPhones.length === 0) return;
    const count = bulkConfirmPhones.length;
    const phones = [...bulkConfirmPhones];
    setBulkConfirmOpen(false);

    try {
      await bulkUpdateChatState.mutateAsync({
        phones,
        state: "arquivada",
        reason: "Arquivamento em lote pelo usuário",
      });

      setSelectedChatIds(new Set());
      setUndoArchiveState({ count, phones });

      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = setTimeout(() => {
        setUndoArchiveState(null);
      }, 7000);

      toast.success(`${count} conversa${count > 1 ? "s" : ""} arquivada${count > 1 ? "s" : ""} com sucesso.`);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao arquivar conversas em lote.");
    }
  };

  const handleUndoBulkArchive = async () => {
    if (!undoArchiveState || undoArchiveState.phones.length === 0) return;
    const phones = undoArchiveState.phones;
    const count = undoArchiveState.count;
    setUndoArchiveState(null);
    if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);

    try {
      await bulkUpdateChatState.mutateAsync({
        phones,
        state: "ativa",
        reason: "Arquivamento desfeito pelo usuário",
      });
      toast.success(`${count} conversa${count > 1 ? "s" : ""} restaurada${count > 1 ? "s" : ""} para a Fila.`);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao desfazer arquivamento.");
    }
  };

  const { data: leads = [], refetch: refetchLeads } = useLeads(clientId || undefined);

  // ── Resumos de Chat IA em LocalStorage ─────────────────────────────────────────
  const summariesStorageKey = `vexo_inbox_chat_summaries_${clientId || "global"}`;
  const [chatSummaries, setChatSummaries] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem(summariesStorageKey);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const saveChatSummary = (chatId: string, summary: string) => {
    setChatSummaries((prev) => {
      const next = { ...prev, [chatId]: summary };
      try {
        localStorage.setItem(summariesStorageKey, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  // ── Notas Internas Privadas em LocalStorage ──────────────────────────────────
  const notesStorageKey = `vexo_inbox_notes_${clientId || "global"}`;
  const [internalNotes, setInternalNotes] = useState<InternalNote[]>(() => {
    try {
      const saved = localStorage.getItem(notesStorageKey);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const saveInternalNotes = (notes: InternalNote[]) => {
    setInternalNotes(notes);
    try {
      localStorage.setItem(notesStorageKey, JSON.stringify(notes));
    } catch {
      // ignore
    }
  };

  const chats = useMemo(() => chatsQuery.items ?? [], [chatsQuery.items]);
  const rawMessages = useMemo(() => messagesQuery.data ?? [], [messagesQuery.data]);

  // Combina mensagens de WhatsApp com notas internas ordenadas por timestamp
  const combinedTimeline = useMemo<TimelineItem[]>(() => {
    if (!selectedChatId) return [];
    const notesForChat = internalNotes
      .filter((n) => n.chatId === selectedChatId)
      .map(
        (n): TimelineItem => ({
          id: n.id,
          body: n.body,
          from: null,
          to: null,
          author: n.author,
          fromMe: true,
          timestamp: n.timestamp,
          type: "internal_note",
          hasMedia: false,
          isInternalNote: true,
        })
      );

    const normalMessages = rawMessages.map((m): TimelineItem => ({ ...m, isInternalNote: false }));
    return [...normalMessages, ...notesForChat].sort(
      (a, b) => Number(a.timestamp || 0) - Number(b.timestamp || 0)
    );
  }, [rawMessages, internalNotes, selectedChatId]);

  const { getIdToken, isAdminUser, canAccessInternalPage } = useAuth();
  const canManageUsers = isAdminUser || canAccessInternalPage("usuarios");
  const adminUsersQuery = useAdminUsers();
  const operatorOptions = useMemo(() => {
    if (!adminUsersQuery.data) return [];
    return adminUsersQuery.data.filter(
      (u) =>
        u.access?.role === "internal" &&
        (!clientId || u.access.clientId === clientId || u.access.clientIds?.includes(clientId))
    );
  }, [adminUsersQuery.data, clientId]);
  const [reabrirPending, setReabrirPending] = useState(false);

  const selectedChat = useMemo<WhatsAppChat | null>(() => {
    if (!selectedChatId) return null;
    const found = chats.find((chat) => chat.id === selectedChatId);
    if (found) return found;

    const chatCanonical = sanitizePhone(selectedChatId);
    const matchingLead = leads.find((l) => sanitizePhone(l.telefone || (l as any).phone) === chatCanonical);

    return {
      id: selectedChatId,
      name: matchingLead?.nome || (matchingLead as any)?.name || selectedChatId,
      profilePic: null,
      isGroup: false,
      unreadCount: 0,
      timestamp: 0,
      archived: false,
      pinned: false,
      muted: false,
      lastMessage: null,
      leadOrigin: null,
      sourceCampaignId: null,
    };
  }, [chats, selectedChatId, leads]);

  // Mapa de Leads indexado por telefone canônico para busca rápida em O(1)
  const leadsByPhone = useMemo(() => {
    const map = new Map<string, LeadRow>();
    for (const lead of leads) {
      const canonical = sanitizePhone(lead.telefone || (lead as any).phone);
      if (canonical) {
        map.set(canonical, lead);
      }
    }
    return map;
  }, [leads]);

  // Lead correspondente do banco de dados (Dossiê)
  const matchedLead = useMemo<LeadRow | null>(() => {
    if (!selectedChat) return null;
    const chatCanonical = sanitizePhone(selectedChat.id);
    if (!chatCanonical) return null;
    return leadsByPhone.get(chatCanonical) || null;
  }, [selectedChat, leadsByPhone]);

  // Contagem de conversas em espera vinda do servidor ou fallback local
  const awaitingReplyCount = chatsQuery.counts?.awaiting ?? 0;

  // Lista de conversas já filtradas pelo servidor conforme aba e busca
  const filteredChats = useMemo(() => chats, [chats]);
  const totalChatsCount = chatsQuery.total ?? chats.length;

  const handleReabrirAtendimento = async () => {
    if (!selectedChat || !clientId) return;
    const rawId = String(selectedChat.id || "");
    const phone = rawId.replace(/\D/g, "");
    if (!phone) {
      toast.error("Número de telefone não disponível para esta conversa.");
      return;
    }

    setReabrirPending(true);
    try {
      const token = await getIdToken();
      const res = await fetchApi("/api/chatbot-leads/reabrir", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          clientId,
          phone,
        }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        const msg = data?.error?.message || data?.message || "Falha ao reabrir atendimento.";
        toast.error(msg);
        return;
      }

      toast.success("Atendimento do chatbot reaberto com sucesso");
      chatsQuery.refetch();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao reabrir atendimento.");
    } finally {
      setReabrirPending(false);
    }
  };

  const handleToggleArchive = async () => {
    if (!selectedChat) return;
    const isCurrentlyArchived = selectedChat.archived || selectedChat.state === "arquivada";
    try {
      await updateChatState.mutateAsync({
        phone: selectedChat.id,
        state: isCurrentlyArchived ? "ativa" : "arquivada",
        reason: isCurrentlyArchived ? "Desarquivado manualmente" : "Arquivado manualmente",
      });
      toast.success(isCurrentlyArchived ? "Conversa desarquivada com sucesso!" : "Conversa arquivada com sucesso!");
    } catch (err: any) {
      toast.error(err?.message || "Erro ao alterar arquivamento.");
    }
  };

  const handleMarkNotAutomation = async () => {
    if (!selectedChat) return;
    try {
      await updateChatState.mutateAsync({
        phone: selectedChat.id,
        state: "ativa",
        reason: "Marcado manualmente como não automação",
      });
      toast.success("Conversa movida para a Fila principal!");
    } catch (err: any) {
      toast.error(err?.message || "Erro ao atualizar estado.");
    }
  };

  const handleMarkAsAutomation = async () => {
    if (!selectedChat) return;
    try {
      await updateChatState.mutateAsync({
        phone: selectedChat.id,
        state: "automacao",
        reason: "Marcado manualmente como automação pelo usuário",
      });
      toast.success("Conversa movida para a aba Automações!");
    } catch (err: any) {
      toast.error(err?.message || "Erro ao atualizar estado.");
    }
  };

  const handleMarkAsAttended = async () => {
    if (!selectedChat) return;
    try {
      await attendChat.mutateAsync({
        phone: selectedChat.id,
      });
      toast.success("Conversa marcada como atendida!");
    } catch (err: any) {
      toast.error(err?.message || "Erro ao marcar como atendida.");
    }
  };

  const handleUnmuteAgent = async () => {
    if (!selectedChat) return;
    try {
      await unmuteChat.mutateAsync({
        phone: selectedChat.id,
      });
      toast.success("Agente de IA reativado para esta conversa!");
      chatsQuery.refetch?.();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao reativar agente.");
    }
  };

  const handleCreateLeadFromCurrentChat = async () => {
    if (!selectedChat) return;
    try {
      const res = await createLeadMutation.mutateAsync({
        phone: selectedChat.id,
        name: selectedChat.name,
      });
      toast.success(res.message || "Lead cadastrado com sucesso!");
      refetchLeads();
      chatsQuery.refetch?.();
      setShowDossier(true);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao cadastrar lead.");
    }
  };

  const handleRequestBulkCreateLeads = () => {
    if (selectedChatIds.size === 0) return;
    setBulkLeadConfirmOpen(true);
  };

  const handleConfirmBulkCreateLeads = async () => {
    if (selectedChatIds.size === 0) return;
    const items = (chatsQuery.items ?? [])
      .filter((c) => selectedChatIds.has(c.id))
      .map((c) => ({ phone: c.id, name: c.name }));

    setBulkLeadConfirmOpen(false);
    try {
      const res = await bulkCreateLeadsMutation.mutateAsync({ items });
      toast.success(res.message || `${res.count} leads cadastrados com sucesso!`);
      setSelectedChatIds(new Set());
      refetchLeads();
      chatsQuery.refetch?.();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao cadastrar leads em lote.");
    }
  };

  const [isSummarizing, setIsSummarizing] = useState(false);
  const [liveSummary, setLiveSummary] = useState<string | null>(null);

  useEffect(() => {
    setLiveSummary(null);
  }, [selectedChatId]);

  useEffect(() => {
    if (selectedChatId && matchedLead) {
      const dbSummary = (matchedLead as any)?.raw_chat_summary || (matchedLead.dados as any)?.resumo_chat;
      if (dbSummary && typeof dbSummary === "string" && !chatSummaries[selectedChatId]) {
        saveChatSummary(selectedChatId, dbSummary);
      }
    }
  }, [selectedChatId, matchedLead, chatSummaries]);

  const currentChatSummary = useMemo(() => {
    if (liveSummary) return liveSummary;
    if (selectedChatId && chatSummaries[selectedChatId]) return chatSummaries[selectedChatId];
    if ((matchedLead as any)?.raw_chat_summary) return (matchedLead as any).raw_chat_summary;
    if ((matchedLead?.dados as any)?.resumo_chat) return String((matchedLead?.dados as any).resumo_chat);
    return null;
  }, [liveSummary, selectedChatId, chatSummaries, matchedLead]);

  const handleSummarizeWithAI = async () => {
    if (!selectedChatId || combinedTimeline.length === 0) {
      toast.info("Não há mensagens suficientes para resumir.");
      return;
    }
    try {
      setIsSummarizing(true);
      const token = await getIdToken();
      const messagesPayload = combinedTimeline
        .map((m) => {
          const sender = m.isInternalNote
            ? `[Nota Interna - ${m.author || "Equipe"}]`
            : m.fromMe
            ? "Empresa/Consultor"
            : selectedChat?.name || matchedLead?.nome || "Lead";
          const body = (m.body || "").trim();
          if (!body) return null;
          return `${sender}: ${body}`;
        })
        .filter(Boolean);

      const res = await fetchApi(`/api/whatsapp/chats/${encodeURIComponent(selectedChatId)}/summarize`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          messages: messagesPayload,
          contactName: selectedChat?.name || matchedLead?.nome || "Contato",
          clientId,
        }),
      });

      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data?.summary) {
        setLiveSummary(data.summary);
        if (selectedChatId) {
          saveChatSummary(selectedChatId, data.summary);
        }
        if (typeof refetchLeads === "function") {
          refetchLeads();
        }
        chatsQuery.refetch();
        toast.success("Resumo gerado e salvo com sucesso!");
      } else if (data?.code === "LLM_QUOTA_EXCEEDED") {
        // Cota esgotada é informação de negócio, não falha técnica: o dono
        // precisa saber que a IA parou por limite de plano.
        throw new Error(`🚫 Cota de IA esgotada — ${data?.reason || "o resumo não foi gerado."}`);
      } else {
        const errorDetail = data?.reason ? `${data.error || "Falha ao gerar resumo"}: ${data.reason}` : (data?.error || "Falha ao gerar resumo.");
        throw new Error(errorDetail);
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro ao processar resumo com IA.");
    } finally {
      setIsSummarizing(false);
    }
  };

  useEffect(() => {
    if (!canLoadInbox) {
      setSelectedChatId(null);
      return;
    }

    if (initialPhone) {
      const targetCanonical = sanitizePhone(initialPhone);
      if (targetCanonical) {
        const match = chats.find((chat) => sanitizePhone(chat.id) === targetCanonical);
        if (match) {
          setSelectedChatId(match.id);
        } else {
          // Se o chat não estiver entre os recentes paginados (ex: lead finalizado / conversa antiga),
          // seleciona o targetCanonical diretamente para disparar o carregamento das mensagens e dossiê
          setSelectedChatId(targetCanonical);
        }
        setSearchParams({}, { replace: true });
        return;
      } else {
        setSearchParams({}, { replace: true });
      }
    }

    if (!selectedChatId && chats.length > 0) {
      setSelectedChatId(chats[0].id);
    }
  }, [canLoadInbox, chats, selectedChatId, initialPhone, setSearchParams]);

  const scrollToBottom = (behavior: ScrollBehavior = "smooth") => {
    const container = messagesContainerRef.current;
    if (!container) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior,
    });
    isNearBottomRef.current = true;
    setShowScrollBottomBtn(false);
    setHasNewUnseenMessage(false);
  };

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isNearBottom = distanceFromBottom < 100;
    isNearBottomRef.current = isNearBottom;

    if (isNearBottom) {
      setShowScrollBottomBtn(false);
      setHasNewUnseenMessage(false);
    } else if (distanceFromBottom > 160) {
      setShowScrollBottomBtn(true);
    }

    // Rolagem para cima: carregar lote anterior quando estiver a menos de 80px do topo
    if (
      container.scrollTop < 80 &&
      messagesQuery.hasMore &&
      !messagesQuery.isFetchingOlder &&
      !isFetchingOlderRef.current
    ) {
      isFetchingOlderRef.current = true;
      prevScrollHeightRef.current = container.scrollHeight;
      prevScrollTopRef.current = container.scrollTop;

      void messagesQuery.loadOlder().finally(() => {
        setTimeout(() => {
          isFetchingOlderRef.current = false;
        }, 150);
      });
    }
  };

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const currentChatId = selectedChatId;
    const chatChanged = currentChatId !== lastChatIdRef.current;

    // 1. Ao abrir ou trocar de conversa: rolar direto para a mensagem mais recente no fim
    if (chatChanged) {
      lastChatIdRef.current = currentChatId;
      isNearBottomRef.current = true;
      setShowScrollBottomBtn(false);
      setHasNewUnseenMessage(false);
      prevScrollHeightRef.current = 0;
      prevScrollTopRef.current = 0;
      lastMessageCountRef.current = combinedTimeline.length;
      lastRenderedMessageIdRef.current = combinedTimeline[combinedTimeline.length - 1]?.id || null;

      requestAnimationFrame(() => {
        if (container) {
          container.scrollTop = container.scrollHeight;
        }
      });
      return;
    }

    // 2. Ao carregar histórico anterior no topo: preservar a posição de scroll sem saltar a tela
    if (prevScrollHeightRef.current > 0) {
      const heightDiff = container.scrollHeight - prevScrollHeightRef.current;
      container.scrollTop = prevScrollTopRef.current + heightDiff;
      prevScrollHeightRef.current = 0;
      prevScrollTopRef.current = 0;
      lastMessageCountRef.current = combinedTimeline.length;
      return;
    }

    // 3. Ao chegar nova mensagem
    const latestMessage = combinedTimeline[combinedTimeline.length - 1];
    const latestId = latestMessage?.id || null;
    const isNewBottomMessage = latestId && latestId !== lastRenderedMessageIdRef.current;

    if (isNewBottomMessage || combinedTimeline.length > lastMessageCountRef.current) {
      lastRenderedMessageIdRef.current = latestId;
      lastMessageCountRef.current = combinedTimeline.length;

      // Se o usuário já estava no fim ou acabou de enviar a mensagem: rolar suavemente para o fim
      if (isNearBottomRef.current || latestMessage?.fromMe) {
        requestAnimationFrame(() => {
          if (container) {
            container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
          }
        });
      } else {
        // Se o usuário estiver lendo o histórico acima: NÃO puxar a tela, mostrar indicador discreto
        setHasNewUnseenMessage(true);
        setShowScrollBottomBtn(true);
      }
    }
  }, [combinedTimeline, selectedChatId]);

  const handleChatsScroll = () => {
    const container = chatsContainerRef.current;
    if (!container || !chatsQuery.hasMore || chatsQuery.isFetchingNextPage) {
      return;
    }

    const remainingScroll = container.scrollHeight - container.scrollTop - container.clientHeight;
    if (remainingScroll < 160) {
      void chatsQuery.loadMore();
    }
  };

  const handleSendMessage = async () => {
    const trimmedDraft = draft.trim();
    if (!selectedChatId || !trimmedDraft) return;

    if (compositionMode === "internal_note") {
      const authorName = user?.displayName || user?.email || "Consultor";
      const newNote: InternalNote = {
        id: `note-${Date.now()}`,
        chatId: selectedChatId,
        body: trimmedDraft,
        author: authorName,
        timestamp: Math.floor(Date.now() / 1000),
      };
      saveInternalNotes([...internalNotes, newNote]);
      setDraft("");
      toast.success("Nota interna salva com sucesso");
      scrollToBottom("smooth");
      return;
    }

    try {
      await sendMessage.mutateAsync(trimmedDraft);
      setDraft("");
      scrollToBottom("smooth");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao enviar mensagem.");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleCopyPhone = (phoneText: string) => {
    navigator.clipboard.writeText(phoneText);
    setCopiedPhone(true);
    toast.success("Telefone copiado para a área de transferência!");
    setTimeout(() => setCopiedPhone(false), 2000);
  };

  const rawPhone = selectedChat ? String(selectedChat.id || "").replace(/\D/g, "") : "";
  const displayPhone = rawPhone
    ? `+${rawPhone.slice(0, 2)} (${rawPhone.slice(2, 4)}) ${rawPhone.slice(4, 9)}-${rawPhone.slice(9)}`
    : "Número indisponível";

  return (
    <PageShell title={title} subtitle={subtitle} headerRight={headerRight} compactHero spacing="space-y-4">
      {tenantsLoading ? (
        <div className="flex flex-col items-center justify-center gap-4 py-20 text-sm text-muted-foreground">
          <LoaderCircle className="h-7 w-7 animate-spin text-emerald-500" />
          Carregando central de atendimento...
        </div>
      ) : !hasConnectedInstances ? (
        <EmptyState
          icon={WifiOff}
          title="Nenhum chip de WhatsApp conectado"
          description="Conecte pelo menos um chip de WhatsApp ativo em 'Chips WhatsApp' para visualizar e enviar mensagens."
        />
      ) : (
        /* ── LAYOUT PRINCIPAL: LISTA FIXA (300px), CHAT RESPONSIVO (flex-1), DOSSIÊ COLAPSÁVEL (320px) ── */
        <div className="flex h-[calc(100vh-220px)] min-h-[650px] gap-3">
          {/* ══════════════════════════════════════════════════════════════════════════
              COLUNA 1: Lista de Conversas, Filtros & Busca (Largura Fixa 300px)
          ══════════════════════════════════════════════════════════════════════════ */}
          <div className="w-[300px] shrink-0 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card/60 shadow-xs">
            {/* Header com Abas de Navegação */}
            <div className="flex flex-col gap-2.5 border-b border-border/60 p-3 bg-muted/20">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                  Conversas
                </span>
                <span
                  className="text-[11px] font-semibold text-muted-foreground font-mono"
                  title={`Total no banco: ${totalChatsCount} | Carregadas na tela: ${filteredChats.length}`}
                >
                  {formatHeaderCount(filteredChats.length, totalChatsCount)}
                </span>
              </div>

              {/* Abas de Navegação do Inbox */}
              <div className="flex flex-col gap-1 rounded-xl bg-background p-1 border border-border/70 text-[11px]">
                {/* Linha 1: Fila | Espera | Minhas | Todas */}
                <div className="grid grid-cols-4 gap-1">
                  <button
                    type="button"
                    onClick={() => setInboxTab("fila")}
                    className={cn(
                      "rounded-lg py-1 font-semibold transition-all text-center",
                      inboxTab === "fila"
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title="Fila de trabalho limpa (sem grupos e sem automações)"
                  >
                    Fila
                  </button>
                  <button
                    type="button"
                    onClick={() => setInboxTab("aguardando")}
                    className={cn(
                      "rounded-lg py-1 font-semibold transition-all text-center flex items-center justify-center gap-0.5",
                      inboxTab === "aguardando"
                        ? "bg-amber-600 text-white shadow-xs"
                        : "text-amber-700 dark:text-amber-400 hover:text-foreground"
                    )}
                    title="Leads que responderam e estão aguardando nossa resposta"
                  >
                    <span>Espera</span>
                    {(chatsQuery.counts?.awaiting ?? 0) > 0 && (
                      <span
                        className={cn(
                          "rounded-full px-1 text-[9px] font-bold leading-tight",
                          inboxTab === "aguardando"
                            ? "bg-white text-amber-800"
                            : "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                        )}
                      >
                        {chatsQuery.counts?.awaiting}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInboxTab("minhas")}
                    className={cn(
                      "rounded-lg py-1 font-semibold transition-all text-center",
                      inboxTab === "minhas"
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title="Conversas com mensagens enviadas"
                  >
                    Minhas
                  </button>
                  <button
                    type="button"
                    onClick={() => setInboxTab("todas")}
                    className={cn(
                      "rounded-lg py-1 font-semibold transition-all text-center",
                      inboxTab === "todas"
                        ? "bg-primary text-primary-foreground shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title="Todas as conversas (incluindo grupos e arquivadas)"
                  >
                    Todas
                  </button>
                </div>

                {/* Linha 2: Automações | Arquivadas | Grupos */}
                <div className="grid grid-cols-3 gap-1 border-t border-border/40 pt-1">
                  <button
                    type="button"
                    onClick={() => setInboxTab("automacao")}
                    className={cn(
                      "rounded-lg py-1 font-semibold transition-all text-center flex items-center justify-center gap-1 text-[10px]",
                      inboxTab === "automacao"
                        ? "bg-purple-600 text-white shadow-xs"
                        : "text-purple-700 dark:text-purple-400 hover:text-foreground"
                    )}
                    title="Robôs e autoatendimentos detectados"
                  >
                    <span>Automações</span>
                    {(chatsQuery.counts?.automations ?? 0) > 0 && (
                      <span
                        className={cn(
                          "rounded-full px-1 text-[9px] font-bold leading-tight",
                          inboxTab === "automacao"
                            ? "bg-white text-purple-800"
                            : "bg-purple-500/20 text-purple-700 dark:text-purple-300"
                        )}
                      >
                        {chatsQuery.counts?.automations}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInboxTab("arquivadas")}
                    className={cn(
                      "rounded-lg py-1 font-semibold transition-all text-center flex items-center justify-center gap-1 text-[10px]",
                      inboxTab === "arquivadas"
                        ? "bg-slate-700 text-white shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    title="Conversas arquivadas manualmente"
                  >
                    <span>Arquivadas</span>
                    {(chatsQuery.counts?.archived ?? 0) > 0 && (
                      <span
                        className={cn(
                          "rounded-full px-1 text-[9px] font-bold leading-tight",
                          inboxTab === "arquivadas"
                            ? "bg-white text-slate-800"
                            : "bg-slate-500/20 text-slate-700 dark:text-slate-300"
                        )}
                      >
                        {chatsQuery.counts?.archived}
                      </span>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setInboxTab("grupos")}
                    className={cn(
                      "rounded-lg py-1 font-semibold transition-all text-center flex items-center justify-center gap-1 text-[10px]",
                      inboxTab === "grupos"
                        ? "bg-blue-600 text-white shadow-xs"
                        : "text-blue-700 dark:text-blue-400 hover:text-foreground"
                    )}
                    title="Grupos de WhatsApp"
                  >
                    <span>Grupos</span>
                    {(chatsQuery.counts?.groups ?? 0) > 0 && (
                      <span
                        className={cn(
                          "rounded-full px-1 text-[9px] font-bold leading-tight",
                          inboxTab === "grupos"
                            ? "bg-white text-blue-800"
                            : "bg-blue-500/20 text-blue-700 dark:text-blue-300"
                        )}
                      >
                        {chatsQuery.counts?.groups}
                      </span>
                    )}
                  </button>
                </div>
              </div>

              {/* Barra de Busca em Tempo Real */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Buscar por nome ou número..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8.5 pl-8 text-xs rounded-xl bg-background border-border/80"
                />
              </div>

              {/* Seletor Dropdown de Chips */}
              <div className="flex items-center gap-2 pt-1 pb-1">
                <Smartphone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Select
                  value={selectedInstanceNames[0] || "all"}
                  onValueChange={(val) => setSelectedInstanceNames(val === "all" ? [] : [val])}
                >
                  <SelectTrigger className="h-7 text-xs rounded-lg border-border/80 bg-background w-full">
                    <SelectValue placeholder="Todos os chips conectados" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">📱 Todos os chips conectados</SelectItem>
                    {evolutionInstances.map((inst) => {
                      const urlName = inst.dispatch_webhook_url
                        ? inst.dispatch_webhook_url.split("/").filter(Boolean).pop() ?? inst.name
                        : inst.name;
                      return (
                        <SelectItem key={urlName} value={urlName}>
                          🟢 {inst.name}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Barra de Seleção em Massa ou Cabeçalho de Itens */}
            {selectedChatIds.size > 0 ? (
              <div className="sticky top-0 z-20 flex flex-col gap-1.5 p-2 bg-primary/10 dark:bg-primary/20 border-b border-primary/30 shadow-xs">
                <div className="flex items-center justify-between gap-1 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-primary">
                    <CheckSquare className="h-3.5 w-3.5" />
                    <span>{selectedChatIds.size} selecionada{selectedChatIds.size > 1 ? "s" : ""}</span>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <Button
                      variant="default"
                      size="sm"
                      className="h-6.5 px-2 text-[11px] font-semibold gap-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-xs cursor-pointer"
                      onClick={handleRequestBulkCreateLeads}
                      disabled={bulkCreateLeadsMutation.isPending}
                      title="Cadastrar contatos selecionados como leads no CRM"
                    >
                      <UserPlus className="h-3 w-3" />
                      Cadastrar Leads ({selectedChatIds.size})
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="h-6.5 px-2 text-[11px] font-semibold gap-1 bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 text-white rounded-lg shadow-xs cursor-pointer"
                      onClick={() => handleRequestBulkArchive(Array.from(selectedChatIds))}
                      title="Arquivar conversas selecionadas"
                    >
                      <Archive className="h-3 w-3" />
                      Arquivar ({selectedChatIds.size})
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6.5 px-1.5 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer"
                      onClick={() => setSelectedChatIds(new Set())}
                      title="Limpar seleção"
                    >
                      Limpar
                    </Button>
                  </div>
                </div>

                {/* Opção para selecionar todas as conversas visíveis */}
                {filteredChats.length > selectedChatIds.size && (
                  <button
                    type="button"
                    onClick={handleSelectAllVisible}
                    className="text-left text-[10px] text-primary hover:underline font-medium cursor-pointer"
                  >
                    Selecionar todas as {filteredChats.length} conversas desta lista
                  </button>
                )}
              </div>
            ) : filteredChats.length > 0 ? (
              <div className="flex items-center justify-between px-3 py-1.5 bg-muted/30 border-b border-border/40 text-[10px] text-muted-foreground">
                <span>{filteredChats.length} conversa{filteredChats.length > 1 ? "s" : ""}</span>
                <button
                  type="button"
                  onClick={handleSelectAllVisible}
                  className="text-primary hover:underline font-medium flex items-center gap-1 cursor-pointer"
                  title="Selecionar todas as conversas visíveis"
                >
                  <Square className="h-3 w-3" />
                  Selecionar todas
                </button>
              </div>
            ) : null}

            {/* Lista Scrollável de Chats */}
            <div
              ref={chatsContainerRef}
              onScroll={handleChatsScroll}
              className="flex-1 overflow-y-auto divide-y divide-border/40"
            >
              {chatsQuery.isLoading ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Carregando conversas...
                </div>
              ) : filteredChats.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground">
                  Nenhuma conversa encontrada.
                </div>
              ) : (() => {
                const renderChatCard = (chat: WhatsAppChat) => {
                  const isSelected = selectedChatId === chat.id;
                  const rawId = String(chat.id || "");
                  const isJid = rawId.includes("@");
                  const phoneLabel = isJid
                    ? rawId.includes("@g.us")
                      ? "Grupo WhatsApp"
                      : "Número não disponível"
                    : `+${rawId}`;
                  const cPhone = sanitizePhone(chat.id);
                  const lead = cPhone ? leadsByPhone.get(cPhone) : null;
                  const precisaAtencao = Boolean(
                    lead?.dados?.precisa_atencao_humana || (lead as any)?.precisa_atencao_humana
                  );
                  const motivoAtencao = String(
                    lead?.dados?.motivo_atencao_humana ||
                      (lead as any)?.motivo_atencao_humana ||
                      "Atenção humana solicitada"
                  );
                  const isAttended = Boolean(
                    chat.attendedAt &&
                    (!chat.timestamp || new Date(chat.attendedAt).getTime() >= chat.timestamp * 1000)
                  );
                  const isAwaitingReply = Boolean(
                    !chat.isGroup &&
                    !rawId.includes("@g.us") &&
                    chat.state !== "automacao" &&
                    chat.state !== "arquivada" &&
                    !chat.archived &&
                    chat.lastMessage &&
                    !chat.lastMessage.fromMe &&
                    !precisaAtencao &&
                    !isAttended
                  );

                  return (
                    <button
                      key={chat.id}
                      type="button"
                      onClick={() => setSelectedChatId(chat.id)}
                      className={cn(
                        "flex w-full items-start gap-2.5 p-2.5 text-left transition-all hover:bg-muted/50 cursor-pointer",
                        isSelected && "bg-emerald-500/10 border-l-4 border-l-emerald-500 pl-2",
                        precisaAtencao && !isSelected && "bg-rose-500/5 border-l-2 border-l-rose-500 pl-2"
                      )}
                    >
                      {/* Checkbox de Seleção Individual */}
                      <div
                        className="flex items-center self-center shrink-0 pr-0.5"
                        onClick={(e) => {
                          e.stopPropagation();
                        }}
                      >
                        <Checkbox
                          checked={selectedChatIds.has(chat.id)}
                          onCheckedChange={() => toggleSelectChat(chat.id)}
                          className="h-4 w-4 rounded-sm border-border/80 data-[state=checked]:bg-primary"
                          aria-label={`Selecionar ${chat.name || phoneLabel}`}
                        />
                      </div>

                      <ChatAvatar label={chat.name || phoneLabel} picture={chat.profilePic} size="md" />

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-1 mb-0.5">
                          <p
                            className={cn(
                              "truncate text-xs font-bold",
                              isSelected
                                ? "text-emerald-700 dark:text-emerald-300"
                                : precisaAtencao
                                ? "text-rose-700 dark:text-rose-300"
                                : "text-foreground"
                            )}
                          >
                            {chat.name || phoneLabel}
                          </p>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatChatDate(chat.timestamp)}
                          </span>
                        </div>

                        <p className="truncate text-[11px] text-muted-foreground leading-snug">
                          {getPreview(chat)}
                        </p>

                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {chat.unreadCount > 0 && (
                            <span className="rounded-full bg-emerald-500 px-1.5 py-0.2 text-[9px] font-extrabold text-white">
                              {chat.unreadCount}
                            </span>
                          )}
                          {chat.isNumberChange && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 px-1.5 py-0.5 text-[9px] font-bold text-indigo-700 dark:text-indigo-300"
                              title="Contato informou novo número / mudança de telefone"
                            >
                              <Phone className="h-2.5 w-2.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
                              <span>Novo Número</span>
                            </span>
                          )}
                          {chat.agentMutedAt && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-slate-500/15 border border-slate-500/30 px-1.5 py-0.5 text-[9px] font-semibold text-slate-700 dark:text-slate-300"
                              title={chat.agentMutedReason ? `Agente pausado: ${chat.agentMutedReason}` : "Agente pausado · conversa pessoal"}
                            >
                              <BotOff className="h-2.5 w-2.5 text-slate-600 dark:text-slate-400 shrink-0" />
                              <span>Agente pausado · {chat.agentMutedReason || "conversa pessoal"}</span>
                            </span>
                          )}
                          {chat.state === "automacao" && !chat.isNumberChange && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-purple-500/15 border border-purple-500/30 px-1.5 py-0.5 text-[9px] font-bold text-purple-700 dark:text-purple-300"
                              title={chat.stateReason || "Robô / Autoatendimento detectado"}
                            >
                              <Bot className="h-2.5 w-2.5 text-purple-600 dark:text-purple-400 shrink-0" />
                              <span>Automação</span>
                            </span>
                          )}
                          {(chat.state === "arquivada" || chat.archived) && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-slate-500/15 border border-slate-500/30 px-1.5 py-0.5 text-[9px] font-bold text-slate-700 dark:text-slate-300"
                            >
                              <Archive className="h-2.5 w-2.5 shrink-0" />
                              <span>Arquivada</span>
                            </span>
                          )}
                          {chat.isGroup && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 border border-blue-500/30 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 dark:text-blue-300"
                            >
                              <Users className="h-2.5 w-2.5 shrink-0" />
                              <span>Grupo</span>
                            </span>
                          )}
                          {precisaAtencao && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 border border-rose-500/30 px-1.5 py-0.5 text-[9px] font-bold text-rose-700 dark:text-rose-300"
                              title={`Atenção humana necessária: ${motivoAtencao}`}
                            >
                              <ShieldAlert className="h-2.5 w-2.5 text-rose-600 dark:text-rose-400 shrink-0" />
                              <span>Atenção Humana</span>
                            </span>
                          )}
                          {isAwaitingReply && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-300">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                              Aguardando resposta
                            </span>
                          )}
                          {isAttended && !isAwaitingReply && chat.state !== "automacao" && chat.state !== "arquivada" && !chat.archived && !chat.isGroup && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 dark:text-emerald-300"
                              title={chat.attendedBy ? `Atendido por ${chat.attendedBy}` : "Atendimento registrado"}
                            >
                              <CheckCheck className="h-2.5 w-2.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                              <span>Atendido</span>
                            </span>
                          )}
                          {!chat.isGroup && !rawId.includes("@g.us") && !lead && (
                            <span
                              className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 text-[9px] font-semibold text-amber-700 dark:text-amber-300"
                              title="Contato ainda não cadastrado na base de Leads do CRM"
                            >
                              <UserPlus className="h-2.5 w-2.5 shrink-0" />
                              <span>Sem Lead</span>
                            </span>
                          )}
                          <OriginBadge
                            origin={chat.leadOrigin ?? null}
                            campaignId={chat.sourceCampaignId ?? null}
                            campaignNames={campaignNames}
                          />
                        </div>
                      </div>
                    </button>
                  );
                };

                if (inboxTab === "aguardando") {
                  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
                  const recentAwaitingChats = filteredChats.filter(
                    (c) => Boolean(c.timestamp && c.timestamp * 1000 >= sevenDaysAgoMs)
                  );
                  const olderAwaitingChats = filteredChats.filter(
                    (c) => !c.timestamp || c.timestamp * 1000 < sevenDaysAgoMs
                  );

                  return (
                    <div className="flex flex-col divide-y divide-border/30">
                      {/* Seção 1: Últimos 7 dias */}
                      <div className="px-3 py-1.5 bg-muted/40 text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                        <span>Últimos 7 dias ({recentAwaitingChats.length})</span>
                      </div>
                      <div className="divide-y divide-border/40">
                        {recentAwaitingChats.length === 0 ? (
                          <div className="p-4 text-center text-xs text-muted-foreground">
                            Nenhuma conversa recente nos últimos 7 dias.
                          </div>
                        ) : (
                          recentAwaitingChats.map(renderChatCard)
                        )}
                      </div>

                      {/* Seção 2: Mais antigas (Recolhidas por padrão) */}
                      {olderAwaitingChats.length > 0 && (
                        <div className="border-t border-border/60">
                          <button
                            type="button"
                            onClick={() => setShowOlderAwaiting((v) => !v)}
                            className="w-full px-3 py-2 bg-muted/20 hover:bg-muted/40 text-[11px] font-semibold text-muted-foreground flex items-center justify-between transition-colors cursor-pointer"
                          >
                            <div className="flex items-center gap-1.5">
                              <Clock3 className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                              <span>Mais antigas ({olderAwaitingChats.length})</span>
                            </div>
                            <span className="text-[10px] text-primary flex items-center gap-0.5">
                              {showOlderAwaiting ? "Recolher" : "Expandir"}
                              {showOlderAwaiting ? (
                                <ChevronUp className="h-3.5 w-3.5" />
                              ) : (
                                <ChevronDown className="h-3.5 w-3.5" />
                              )}
                            </span>
                          </button>
                          {showOlderAwaiting && (
                            <div className="divide-y divide-border/40 bg-muted/5">
                              {olderAwaitingChats.map(renderChatCard)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                }

                return filteredChats.map(renderChatCard);
              })()}
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════════════════
              COLUNA 2: Chat Central & Linha do Tempo (Ocupa Todo o Espaço Restante)
          ══════════════════════════════════════════════════════════════════════════ */}
          <div className="flex-1 min-w-0 flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/80 bg-card/60 shadow-xs">
            {/* Header da Conversa Ativa */}
            {(() => {
              const isSelectedChatAttended = Boolean(
                selectedChat?.attendedAt &&
                (!selectedChat?.timestamp || new Date(selectedChat.attendedAt).getTime() >= selectedChat.timestamp * 1000)
              );
              const isSelectedChatAwaiting = Boolean(
                selectedChat &&
                !selectedChat.isGroup &&
                selectedChat.state !== "automacao" &&
                selectedChat.state !== "arquivada" &&
                !selectedChat.archived &&
                selectedChat.lastMessage &&
                !selectedChat.lastMessage.fromMe &&
                !isSelectedChatAttended
              );

              return (
                <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5 border-b border-border/60 p-3 bg-muted/20 min-h-[58px]">
                  {/* Faixa 1: Identidade do Contato */}
                  <div className="flex items-center gap-2.5 min-w-0 flex-1">
                    {selectedChat && (
                      <ChatAvatar
                        label={selectedChat.name || String(selectedChat.id)}
                        picture={selectedChat.profilePic}
                        size="sm"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p
                          className="truncate text-sm font-bold text-foreground max-w-[200px] sm:max-w-[260px]"
                          title={selectedChat?.name || "Selecione uma conversa"}
                        >
                          {selectedChat?.name || "Selecione uma conversa"}
                        </p>
                        {selectedChat && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1.5 text-[9px] font-bold border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 gap-1 shrink-0"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Online
                          </Badge>
                        )}
                        {isSelectedChatAttended && !isSelectedChatAwaiting && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1.5 text-[9px] font-bold border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 gap-1 shrink-0"
                            title={selectedChat?.attendedBy ? `Atendido por ${selectedChat.attendedBy}` : "Atendimento registrado"}
                          >
                            <CheckCheck className="h-2.5 w-2.5 text-emerald-600" />
                            Atendido
                          </Badge>
                        )}
                        {isSelectedChatAwaiting && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1.5 text-[9px] font-bold border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 gap-1 shrink-0"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                            Aguardando resposta
                          </Badge>
                        )}
                        {selectedChat && !matchedLead && !selectedChat.isGroup && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1.5 text-[9px] font-bold border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300 gap-1 shrink-0"
                            title="Contato não cadastrado como Lead no CRM"
                          >
                            <UserPlus className="h-2.5 w-2.5 text-amber-600" />
                            Sem Lead
                          </Badge>
                        )}
                        {selectedChat?.isNumberChange && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1.5 text-[9px] font-bold border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 gap-1 shrink-0"
                            title="Contato informou novo número"
                          >
                            <Phone className="h-2.5 w-2.5 text-indigo-600" />
                            Novo Número
                          </Badge>
                        )}
                        {selectedChat?.state === "automacao" && !selectedChat?.isNumberChange && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1.5 text-[9px] font-bold border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300 gap-1 max-w-[180px] sm:max-w-[220px] truncate shrink-0 cursor-help"
                            title={selectedChat.stateReason || "Robô / Autoatendimento detectado"}
                          >
                            <Bot className="h-2.5 w-2.5 text-purple-600 shrink-0" />
                            <span className="truncate">Automação: {selectedChat.stateReason || "URA / Robô"}</span>
                          </Badge>
                        )}
                        {(selectedChat?.state === "arquivada" || selectedChat?.archived) && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1.5 text-[9px] font-bold border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300 gap-1 shrink-0"
                          >
                            <Archive className="h-2.5 w-2.5" />
                            Arquivada
                          </Badge>
                        )}
                        {selectedChat?.isGroup && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1.5 text-[9px] font-bold border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300 gap-1 shrink-0"
                          >
                            <Users className="h-2.5 w-2.5" />
                            Grupo
                          </Badge>
                        )}
                        {selectedChat?.agentMutedAt && (
                          <Badge
                            variant="outline"
                            className="h-4 px-1.5 text-[9px] font-bold border-slate-500/30 bg-slate-500/10 text-slate-700 dark:text-slate-300 gap-1 shrink-0 cursor-help"
                            title={selectedChat.agentMutedReason ? `Agente pausado: ${selectedChat.agentMutedReason}` : "Agente pausado · conversa pessoal"}
                          >
                            <BotOff className="h-2.5 w-2.5 text-slate-600 dark:text-slate-400 shrink-0" />
                            <span className="truncate">Agente pausado · {selectedChat.agentMutedReason || "conversa pessoal"}</span>
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">{displayPhone}</p>
                    </div>
                  </div>

                  {/* Faixa 2: Ações (Máximo 2 visíveis + Menu "⋯") */}
                  {selectedChat && (
                    <div className="flex items-center gap-1.5 shrink-0">
                      {/* Botão Primário Contextual */}
                      {selectedChat.agentMutedAt ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 text-xs rounded-xl border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 cursor-pointer shadow-xs"
                          onClick={handleUnmuteAgent}
                          disabled={unmuteChat.isPending}
                          title="Reativar agente de IA nesta conversa"
                        >
                          <Bot className="h-3.5 w-3.5 text-emerald-600" />
                          <span>{unmuteChat.isPending ? "Reativando..." : "Reativar agente"}</span>
                        </Button>
                      ) : !matchedLead && !selectedChat.isGroup ? (
                        <Button
                          variant="default"
                          size="sm"
                          className="h-8 gap-1 text-xs rounded-xl bg-amber-600 hover:bg-amber-700 text-white cursor-pointer shadow-xs"
                          onClick={handleCreateLeadFromCurrentChat}
                          disabled={createLeadMutation.isPending}
                          title="Cadastrar este contato como lead no CRM"
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                          <span>{createLeadMutation.isPending ? "Cadastrando..." : "Cadastrar Lead"}</span>
                        </Button>
                      ) : selectedChat.state === "automacao" && !selectedChat.isNumberChange ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 text-xs text-purple-600 hover:text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-900/50 rounded-xl"
                          onClick={handleMarkNotAutomation}
                          title="Reclassificar esta conversa como atendimento humano normal e mover para a Fila"
                        >
                          <Bot className="h-3.5 w-3.5" />
                          <span>Não é automação</span>
                        </Button>
                      ) : isSelectedChatAwaiting ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 text-xs rounded-xl border-emerald-500/40 text-emerald-700 dark:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20"
                          onClick={handleMarkAsAttended}
                          title="Marcar atendimento concluído e remover da Espera sem arquivar"
                        >
                          <CheckCheck className="h-3.5 w-3.5 text-emerald-600" />
                          <span>Marcar Atendido</span>
                        </Button>
                      ) : selectedChat.archived || selectedChat.state === "arquivada" ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 text-xs rounded-xl border-border/80 text-muted-foreground hover:text-foreground"
                          onClick={handleToggleArchive}
                          title="Desarquivar conversa e mover para a Fila"
                        >
                          <ArchiveRestore className="h-3.5 w-3.5" />
                          <span>Desarquivar</span>
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1 text-xs rounded-xl border-border/80 text-muted-foreground hover:text-foreground"
                          onClick={handleToggleArchive}
                          title="Arquivar conversa"
                        >
                          <Archive className="h-3.5 w-3.5" />
                          <span>Arquivar</span>
                        </Button>
                      )}

                      {/* Botão Secundário: Dossiê do Lead */}
                      <Button
                        variant="outline"
                        size="sm"
                        className={cn(
                          "h-8 gap-1.5 text-xs rounded-xl border-border/80 transition-colors",
                          showDossier
                            ? "bg-muted/80 text-foreground font-semibold"
                            : "text-muted-foreground hover:text-foreground"
                        )}
                        onClick={() => setShowDossier((v) => !v)}
                        title={showDossier ? "Ocultar painel lateral do Dossiê do Lead" : "Exibir painel lateral do Dossiê do Lead"}
                      >
                        <User className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">Dossiê do Lead</span>
                      </Button>

                      {/* Menu "⋯" para Outras Ações */}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 rounded-xl text-muted-foreground hover:text-foreground cursor-pointer"
                            title="Mais opções da conversa"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-56 text-xs">
                          {/* Cadastrar como Lead se ainda não existir */}
                          {!matchedLead && !selectedChat.isGroup && (
                            <DropdownMenuItem
                              onClick={handleCreateLeadFromCurrentChat}
                              disabled={createLeadMutation.isPending}
                              className="gap-2 cursor-pointer text-amber-700 dark:text-amber-300 font-semibold"
                            >
                              <UserPlus className="h-3.5 w-3.5 text-amber-600" />
                              <span>{createLeadMutation.isPending ? "Cadastrando..." : "Cadastrar como Lead"}</span>
                            </DropdownMenuItem>
                          )}

                          {/* Marcar como Atendido (se não estiver já como botão primário) */}
                          {selectedChat.state !== "arquivada" && !selectedChat.archived && !isSelectedChatAwaiting && (
                            <DropdownMenuItem
                              onClick={handleMarkAsAttended}
                              className="gap-2 cursor-pointer text-emerald-700 dark:text-emerald-300 font-semibold"
                            >
                              <CheckCheck className="h-3.5 w-3.5 text-emerald-600" />
                              <span>Marcar como Atendido</span>
                            </DropdownMenuItem>
                          )}

                          {/* Reativar agente se estiver pausado */}
                          {selectedChat.agentMutedAt && (
                            <DropdownMenuItem
                              onClick={handleUnmuteAgent}
                              disabled={unmuteChat.isPending}
                              className="gap-2 cursor-pointer text-emerald-700 dark:text-emerald-300 font-semibold"
                            >
                              <Bot className="h-3.5 w-3.5 text-emerald-600" />
                              <span>Reativar Agente IA</span>
                            </DropdownMenuItem>
                          )}

                          {selectedChat.state === "automacao" && (
                            <DropdownMenuItem onClick={handleToggleArchive} className="gap-2 cursor-pointer">
                              <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                              <span>Arquivar conversa</span>
                            </DropdownMenuItem>
                          )}
                          {selectedChat.state !== "automacao" &&
                            selectedChat.state !== "arquivada" &&
                            !selectedChat.archived && (
                              <DropdownMenuItem onClick={handleMarkAsAutomation} className="gap-2 cursor-pointer">
                                <Bot className="h-3.5 w-3.5 text-purple-600" />
                                <span>Mover para Automações</span>
                              </DropdownMenuItem>
                            )}
                          <DropdownMenuItem
                            onClick={handleReabrirAtendimento}
                            disabled={reabrirPending}
                            className="gap-2 cursor-pointer text-indigo-600 dark:text-indigo-400"
                          >
                            <RotateCcw className={cn("h-3.5 w-3.5", reabrirPending && "animate-spin")} />
                            <span>Reabrir Atendimento IA</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Linha do Tempo das Mensagens */}
            <div className="relative flex-1 min-h-0 flex flex-col">
              <div
                ref={messagesContainerRef}
                onScroll={handleMessagesScroll}
                className="flex-1 overflow-y-auto p-3 sm:p-4 bg-slate-50/70 dark:bg-slate-950/40"
              >
                {messagesQuery.isLoading ? (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin text-emerald-500" />
                    Carregando mensagens...
                  </div>
                ) : !selectedChat ? (
                  <EmptyState
                    title="Escolha uma conversa"
                    description="Selecione um contato na coluna da esquerda para visualizar o histórico de mensagens."
                  />
                ) : combinedTimeline.length === 0 ? (
                  <EmptyState
                    title="Sem mensagens"
                    description="Nenhuma mensagem registrada no banco de dados para esta conversa."
                  />
                ) : (
                  <>
                    {/* Indicador de carregamento de mensagens anteriores */}
                    {messagesQuery.isFetchingOlder && (
                      <div className="flex items-center justify-center py-2 text-xs text-muted-foreground gap-2">
                        <LoaderCircle className="h-3.5 w-3.5 animate-spin text-emerald-500" />
                        <span>Carregando mensagens anteriores...</span>
                      </div>
                    )}
                    {!messagesQuery.hasMore && combinedTimeline.length >= 20 && (
                      <div className="flex items-center justify-center py-2 text-[10px] text-muted-foreground/60">
                        <span>Início do histórico da conversa</span>
                      </div>
                    )}

                    {combinedTimeline.map((item, idx) => {
                      const prevItem = combinedTimeline[idx - 1];
                      const currentDayStr = item.timestamp ? new Date(item.timestamp * 1000).toDateString() : null;
                      const prevDayStr = prevItem?.timestamp ? new Date(prevItem.timestamp * 1000).toDateString() : null;
                      const showDayDivider = Boolean(currentDayStr && currentDayStr !== prevDayStr);
                      const isSameAuthor = Boolean(
                        prevItem &&
                        !showDayDivider &&
                        !prevItem.isInternalNote &&
                        !item.isInternalNote &&
                        prevItem.fromMe === item.fromMe
                      );
                      const marginTopClass = idx === 0 ? "mt-0" : showDayDivider ? "mt-2" : isSameAuthor ? "mt-[2px]" : "mt-[8px]";

                      return (
                        <div key={item.id || `${item.timestamp}-${item.body}-${idx}`} className={marginTopClass}>
                          {showDayDivider && (
                            <div className="my-3 flex items-center justify-center relative z-0 py-1 clear-both">
                              <span className="rounded-full border border-border/70 bg-muted px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shadow-xs">
                                {formatDaySeparator(item.timestamp)}
                              </span>
                            </div>
                          )}
                          {item.isInternalNote ? (
                            <div
                              className="mx-auto max-w-[min(80%,900px)] rounded-xl border border-amber-400/40 bg-amber-500/10 p-2.5 text-xs text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-200 shadow-xs"
                            >
                              <div className="flex items-center justify-between gap-2 mb-1 text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                                <span className="flex items-center gap-1.5">
                                  <Lock className="h-3 w-3" />
                                  Nota Interna Privada · {item.author || "Equipe"}
                                </span>
                                <span className="text-[10px] font-normal text-amber-700/80 dark:text-amber-400">
                                  {formatTimestamp(item.timestamp, true)}
                                </span>
                              </div>
                              <p
                                className="whitespace-pre-wrap text-xs font-normal leading-relaxed"
                                style={{ fontFamily: '-apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif' }}
                              >
                                {item.body}
                              </p>
                            </div>
                          ) : (
                            <div
                              className={cn(
                                "relative rounded-lg shadow-xs transition-colors",
                                "max-w-[min(80%,900px)]",
                                item.fromMe
                                  ? "ml-auto rounded-tr-none bg-emerald-600 text-white"
                                  : "mr-auto rounded-tl-none border border-border/80 bg-background text-foreground"
                              )}
                              style={{
                                maxWidth: "min(80%, 900px)",
                                padding: "6px 9px 8px",
                              }}
                            >
                              <MediaMessage
                                messageId={item.id}
                                hasMedia={item.hasMedia}
                                fallbackBody={item.body}
                                fromMe={item.fromMe}
                                className="font-normal select-text"
                              />
                              <div
                                className={cn(
                                  "mt-0.5 flex items-center justify-end gap-1.5 text-[11px] font-normal leading-none select-none",
                                  item.fromMe ? "text-emerald-100/85" : "text-muted-foreground/75"
                                )}
                                style={{
                                  fontFamily: '-apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif',
                                  fontSize: "11px",
                                }}
                              >
                                {item.fromMe && item.senderType === "device" && (
                                  <span className="text-[10px] text-emerald-100/90 flex items-center gap-0.5" title="Enviado pelo aparelho móvel (celular)">
                                    📱 <span className="hidden sm:inline text-[9px] opacity-90">Aparelho</span>
                                  </span>
                                )}
                                {item.fromMe && (item.senderType === "bot" || item.senderType === "campaign") && (
                                  <span className="text-[10px] text-emerald-100/90 flex items-center gap-0.5" title="Enviado automaticamente pelo robô/campanha">
                                    🤖 <span className="hidden sm:inline text-[9px] opacity-90">Robô</span>
                                  </span>
                                )}
                                {item.fromMe && (item.senderType === "agent" || item.senderType === "user") && (
                                  <span className="text-[10px] text-emerald-100/90 flex items-center gap-0.5" title="Enviado pelo CRM (Conversas)">
                                    💻 <span className="hidden sm:inline text-[9px] opacity-90">CRM</span>
                                  </span>
                                )}
                                <span>{formatTimestamp(item.timestamp)}</span>
                                {item.fromMe && <span className="tracking-tighter text-[11px]">✓✓</span>}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}
              </div>

              {/* Botão flutuante para rolar ao final / novas mensagens */}
              {showScrollBottomBtn && (
                <div className="absolute bottom-3 right-4 z-20">
                  <Button
                    size="sm"
                    variant={hasNewUnseenMessage ? "default" : "secondary"}
                    onClick={() => scrollToBottom("smooth")}
                    className={cn(
                      "h-8 gap-1.5 rounded-full px-3 text-xs font-semibold shadow-md transition-all",
                      hasNewUnseenMessage
                        ? "bg-emerald-600 hover:bg-emerald-700 text-white animate-bounce"
                        : "bg-background/95 hover:bg-background text-foreground border border-border/80 backdrop-blur-md"
                    )}
                  >
                    {hasNewUnseenMessage ? (
                      <>
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>Novas mensagens</span>
                        <ChevronDown className="h-3.5 w-3.5" />
                      </>
                    ) : (
                      <>
                        <span>Mais recentes</span>
                        <ChevronDown className="h-3.5 w-3.5" />
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>

            {/* Caixa de Composição & Alternância de Modo */}
            <div className="border-t border-border/70 p-3 bg-card space-y-2.5">
              <div className="flex items-center justify-between">
                {/* Abas: Responder WhatsApp vs Nota Interna */}
                <div className="flex items-center gap-1 rounded-xl bg-muted/60 p-1 border border-border/60 text-xs">
                  <button
                    type="button"
                    onClick={() => setCompositionMode("whatsapp")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold transition-all",
                      compositionMode === "whatsapp"
                        ? "bg-emerald-600 text-white shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Send className="h-3 w-3" />
                    Responder (WhatsApp)
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompositionMode("internal_note")}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1 rounded-lg font-semibold transition-all",
                      compositionMode === "internal_note"
                        ? "bg-amber-600 text-white shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <Lock className="h-3 w-3" />
                    Nota Interna Privada 📝
                  </button>
                </div>

                <span className="text-[10px] text-muted-foreground hidden sm:inline">
                  Pressione <kbd className="rounded bg-muted px-1 py-0.5 font-mono">Enter</kbd> para enviar
                </span>
              </div>

              <div className="relative">
                <Textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    compositionMode === "whatsapp"
                      ? "Digite uma mensagem para o cliente no WhatsApp..."
                      : "Escreva uma nota interna visível apenas para a sua equipe..."
                  }
                  rows={3}
                  disabled={!selectedChat || sendMessage.isPending}
                  className={cn(
                    "text-xs rounded-xl pr-20 resize-none font-sans",
                    compositionMode === "internal_note" &&
                      "border-amber-400/50 bg-amber-500/[0.04] focus-visible:ring-amber-500"
                  )}
                />
                <Button
                  size="sm"
                  onClick={handleSendMessage}
                  disabled={!selectedChat || !draft.trim() || sendMessage.isPending}
                  className={cn(
                    "absolute right-2 bottom-2 h-7 px-3 text-xs font-semibold rounded-lg gap-1.5 shadow-xs",
                    compositionMode === "whatsapp"
                      ? "bg-emerald-600 hover:bg-emerald-700 text-white"
                      : "bg-amber-600 hover:bg-amber-700 text-white"
                  )}
                >
                  {sendMessage.isPending ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                  {compositionMode === "whatsapp" ? "Enviar" : "Salvar"}
                </Button>
              </div>
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════════════════════
              COLUNA 3: Dossiê Lateral do Lead & Copiloto (Largura Fixa 320px, Colapsável)
          ══════════════════════════════════════════════════════════════════════════ */}
          {showDossier && (
            <div className="w-[320px] shrink-0 flex min-h-0 flex-col overflow-y-auto rounded-2xl border border-border/80 bg-card/60 p-4 shadow-xs space-y-4 animate-in fade-in slide-in-from-right-2 duration-150">
              {/* Header do Dossiê com botão de fechar */}
              <div className="flex items-center justify-between pb-1 border-b border-border/40">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5 text-emerald-500" />
                  Dossiê do Lead
                </span>
                <button
                  type="button"
                  onClick={() => setShowDossier(false)}
                  className="p-1 text-muted-foreground hover:text-foreground transition-colors rounded-md hover:bg-muted/60"
                  title="Recolher painel do lead"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Card do Contato */}
              <div className="flex flex-col items-center text-center p-3 rounded-2xl bg-muted/20 border border-border/60">
                <ChatAvatar
                  label={matchedLead?.nome || selectedChat?.name || displayPhone}
                  picture={selectedChat?.profilePic}
                  size="lg"
                />
                <h3 className="mt-2 text-sm font-extrabold text-foreground truncate w-full">
                  {matchedLead?.nome || selectedChat?.name || "Lead sem nome"}
                </h3>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground font-mono">
                  <Phone className="h-3 w-3" />
                  <span>{displayPhone}</span>
                  {rawPhone && (
                    <button
                      type="button"
                      onClick={() => handleCopyPhone(rawPhone)}
                      className="p-1 hover:text-foreground text-muted-foreground transition-colors"
                      title="Copiar número"
                    >
                      {copiedPhone ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
                    </button>
                  )}
                </div>

                {/* Origem */}
                <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
                  <OriginBadge
                    origin={(selectedChat as any)?.leadOrigin ?? (matchedLead ? "inbound" : null)}
                    campaignId={(selectedChat as any)?.sourceCampaignId ?? null}
                    campaignNames={campaignNames}
                  />
                  {matchedLead?.qualificacao && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] font-bold uppercase",
                        matchedLead.qualificacao === "QUENTE"
                          ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                          : matchedLead.qualificacao === "MORNO"
                          ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
                      )}
                    >
                      {matchedLead.qualificacao === "QUENTE" ? "🔥 Quente" : matchedLead.qualificacao === "MORNO" ? "☀️ Morno" : "❄️ Frio"}
                    </Badge>
                  )}
                </div>

                {/* Operador Responsável do Lead */}
                {matchedLead && (
                  <div className="w-full mt-2 pt-2 border-t border-border/40 flex items-center justify-between gap-2 text-left">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <UserCheck className="h-3 w-3 text-sky-500" />
                      Responsável:
                    </span>
                    {canManageUsers ? (
                      <select
                        value={matchedLead.assigned_to || "none"}
                        onChange={async (e) => {
                          const val = e.target.value;
                          const targetUid = val === "none" ? null : val;
                          try {
                            const token = await getIdToken();
                            const res = await fetchApi(`/api/leads/${matchedLead.id}`, {
                              method: "PATCH",
                              headers: {
                                Authorization: `Bearer ${token}`,
                                "Content-Type": "application/json",
                              },
                              body: JSON.stringify({ assigned_to: targetUid }),
                            });
                            if (!res.ok) {
                              const err = await readApiErrorMessage(res, "Falha ao reatribuir lead.");
                              throw new Error(err);
                            }
                            toast.success("Responsável atualizado!");
                            refetchLeads();
                          } catch (err: any) {
                            toast.error("Erro ao reatribuir", { description: err.message });
                          }
                        }}
                        className="h-6 text-[11px] px-1.5 py-0 rounded-md border border-input bg-background text-foreground"
                      >
                        <option value="none">Compartilhado</option>
                        {operatorOptions.map((op) => (
                          <option key={op.uid} value={op.uid}>
                            {op.displayName || op.email}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <Badge variant="outline" className="text-[10px] py-0.5 px-2 font-normal border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300">
                        {matchedLead.assigned_to
                          ? operatorOptions.find((op) => op.uid === matchedLead.assigned_to)?.displayName ||
                            operatorOptions.find((op) => op.uid === matchedLead.assigned_to)?.email ||
                            matchedLead.assigned_to
                          : "Compartilhado"}
                      </Badge>
                    )}
                  </div>
                )}

                {Boolean(matchedLead?.dados?.precisa_atencao_humana || (matchedLead as any)?.precisa_atencao_humana) && (
                  <div className="w-full mt-2.5 p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-left flex items-start gap-2">
                    <ShieldAlert className="h-4 w-4 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold text-rose-700 dark:text-rose-300">
                        Atenção Humana Necessária (IA Pausada)
                      </p>
                      <p className="text-[10px] text-rose-600/90 dark:text-rose-300/90 leading-tight mt-0.5">
                        {String(
                          matchedLead?.dados?.motivo_atencao_humana ||
                            (matchedLead as any)?.motivo_atencao_humana ||
                            "Mensagens idênticas repetidas detectadas (loop com bot/menu automático)"
                        )}
                      </p>
                    </div>
                  </div>
                )}

                {/* Aviso e Ação de Cadastro de Lead se Contato não existe no CRM */}
                {!matchedLead && !selectedChat?.isGroup && (
                  <div className="w-full mt-3 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-left">
                    <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-200 font-semibold text-xs">
                      <UserPlus className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                      <span>Lead não cadastrado</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 leading-snug">
                      Este contato do WhatsApp ainda não está na sua base de leads do CRM.
                    </p>
                    <Button
                      variant="default"
                      size="sm"
                      className="w-full mt-2.5 h-7 text-xs font-semibold gap-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg shadow-xs cursor-pointer"
                      onClick={handleCreateLeadFromCurrentChat}
                      disabled={createLeadMutation.isPending}
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      <span>{createLeadMutation.isPending ? "Cadastrando..." : "Cadastrar como Lead no CRM"}</span>
                    </Button>
                  </div>
                )}
              </div>

              {/* Estágio do Funil Comercial */}
              <div className="space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Target className="h-3.5 w-3.5 text-indigo-500" />
                  Estágio no Funil
                </span>
                <div className="grid grid-cols-2 gap-1.5 text-xs">
                  {[
                    { step: "1. Novo", active: !matchedLead || matchedLead.status === "novo" },
                    { step: "2. Atendimento", active: matchedLead?.status === "em_atendimento" || !matchedLead?.finalizado },
                    { step: "3. Qualificado", active: matchedLead?.qualificacao === "QUENTE" || matchedLead?.status === "qualificado" },
                    { step: "4. Fechado", active: matchedLead?.status === "fechado" || matchedLead?.status === "ganho" },
                  ].map((s) => (
                    <div
                      key={s.step}
                      className={cn(
                        "flex items-center justify-between rounded-xl border p-2 text-[11px] font-semibold transition-colors",
                        s.active
                          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 shadow-xs"
                          : "border-border/60 bg-muted/20 text-muted-foreground opacity-60"
                      )}
                    >
                      <span>{s.step}</span>
                      {s.active && <Check className="h-3 w-3 text-emerald-500" />}
                    </div>
                  ))}
                </div>
              </div>

              {/* Resumo Coletado pela IA */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                    Resumo Coletado pela IA
                  </span>
                  <button
                    type="button"
                    disabled={isSummarizing || !selectedChatId}
                    onClick={handleSummarizeWithAI}
                    className="text-[10px] font-semibold text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1 disabled:opacity-50 cursor-pointer"
                  >
                    {isSummarizing ? (
                      <>
                        <LoaderCircle className="h-3 w-3 animate-spin" />
                        Analisando...
                      </>
                    ) : (
                      <>
                        <RefreshCw className="h-3 w-3" />
                        Atualizar com IA
                      </>
                    )}
                  </button>
                </div>
                <div className="rounded-2xl border border-border/70 bg-muted/20 p-3 space-y-2 text-xs">
                  {currentChatSummary ? (
                    currentChatSummary.startsWith("🚫") ? (
                      <div className="space-y-1.5 text-[11px] text-muted-foreground bg-muted/40 p-2.5 rounded-xl border border-border/60">
                        <div className="font-semibold flex items-center gap-1.5 text-foreground/80">
                          <span>🚫</span>
                          <span>Conversa pessoal — sem oportunidade comercial</span>
                        </div>
                        <p className="italic text-muted-foreground/90 whitespace-pre-line leading-relaxed">
                          {currentChatSummary.replace(/^🚫\uFE0F?\s*/u, "") || "Nenhuma intenção comercial detectada."}
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-1.5 whitespace-pre-line text-foreground leading-relaxed text-[11px]">
                        {currentChatSummary}
                      </div>
                    )
                  ) : matchedLead && (matchedLead.interesse || matchedLead.objetivo || matchedLead.cidade || matchedLead.credito) ? (
                    <div className="space-y-1.5">
                      {matchedLead.interesse && (
                        <div className="flex items-start justify-between gap-2 text-[11px]">
                          <span className="text-muted-foreground">Interesse:</span>
                          <span className="font-semibold text-foreground text-right">{matchedLead.interesse}</span>
                        </div>
                      )}
                      {matchedLead.objetivo && (
                        <div className="flex items-start justify-between gap-2 text-[11px]">
                          <span className="text-muted-foreground">Objetivo:</span>
                          <span className="font-semibold text-foreground text-right">{matchedLead.objetivo}</span>
                        </div>
                      )}
                      {(matchedLead.cidade || matchedLead.estado) && (
                        <div className="flex items-start justify-between gap-2 text-[11px]">
                          <span className="text-muted-foreground">Localização:</span>
                          <span className="font-semibold text-foreground text-right">
                            {[matchedLead.cidade, matchedLead.estado].filter(Boolean).join(" - ")}
                          </span>
                        </div>
                      )}
                      {(matchedLead.credito || matchedLead.parcela || matchedLead.lance_entrada_fgts) && (
                        <div className="flex items-start justify-between gap-2 text-[11px]">
                          <span className="text-muted-foreground">Orçamento / Entrada:</span>
                          <span className="font-semibold text-foreground text-right">
                            {[matchedLead.credito, matchedLead.parcela, matchedLead.lance_entrada_fgts]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-2 space-y-2">
                      <p className="text-muted-foreground text-[11px]">
                        Nenhum resumo gerado para esta conversa ainda.
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={isSummarizing || !selectedChatId}
                        onClick={handleSummarizeWithAI}
                        className="h-7 text-[11px] rounded-lg border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300 hover:bg-purple-500/20 cursor-pointer"
                      >
                        <Sparkles className="mr-1.5 h-3 w-3 text-purple-500" />
                        {isSummarizing ? "Gerando resumo..." : "Gerar Resumo com IA"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Ações Rápidas do Consultor */}
              <div className="space-y-2 pt-1">
                <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  Ações Rápidas
                </span>
                <div className="flex flex-col gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const rawPhone = selectedChat?.id ? String(selectedChat.id).replace(/\D/g, "") : "";
                      const prospectName = matchedLead?.nome || selectedChat?.name || "";
                      const params = new URLSearchParams();
                      if (rawPhone) params.set("phone", rawPhone);
                      if (prospectName) params.set("nome", prospectName);
                      navigate(`/crm/propostas-gd?${params.toString()}`);
                    }}
                    className="w-full justify-start h-8 text-xs font-semibold rounded-xl border-indigo-500/30 bg-indigo-500/5 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/15"
                  >
                    <FileText className="mr-2 h-3.5 w-3.5 text-indigo-500" />
                    Gerar Proposta Comercial
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsReminderModalOpen(true)}
                    className="w-full justify-start h-8 text-xs font-semibold rounded-xl border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15"
                  >
                    <Clock3 className="mr-2 h-3.5 w-3.5 text-emerald-500" />
                    Lembrar deste lead
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsApplyFollowupModalOpen(true)}
                    className="w-full justify-start h-8 text-xs font-semibold rounded-xl border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15"
                  >
                    <RefreshCw className="mr-2 h-3.5 w-3.5 text-amber-500" />
                    Adicionar a uma cadência
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const rawPhone = selectedChat?.id ? String(selectedChat.id).replace(/\D/g, "") : "";
                      const params = new URLSearchParams();
                      if (matchedLead?.id) params.set("leadId", matchedLead.id);
                      if (rawPhone) params.set("phone", rawPhone);
                      navigate(`/crm/banco-de-dados?${params.toString()}`);
                    }}
                    className="w-full justify-start h-8 text-xs font-semibold rounded-xl border-border/80 bg-background hover:bg-muted"
                  >
                    <Inbox className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    Ver no Banco de Dados
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      <SingleFollowupReminderModal
        open={isReminderModalOpen}
        onOpenChange={setIsReminderModalOpen}
        lead={{
          id: matchedLead?.id,
          nome: matchedLead?.nome || selectedChat?.name || "Lead",
          phone: rawPhone,
        }}
        tenantId={clientId}
      />

      <ApplyFollowupModal
        open={isApplyFollowupModalOpen}
        onOpenChange={setIsApplyFollowupModalOpen}
        clientId={clientId || ""}
        leads={[
          {
            id: matchedLead?.id || "",
            nome: matchedLead?.nome || selectedChat?.name || "Lead",
            phone: rawPhone,
            telefone: rawPhone,
          },
        ]}
        apiBase={API_BASE_URL}
        getToken={getIdToken}
      />

      {/* Modal de Confirmação para Arquivamento em Massa */}
      <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-base">
              <Archive className="h-5 w-5 text-slate-700 dark:text-slate-300" />
              Arquivar {bulkConfirmCount} conversa{bulkConfirmCount > 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed">
              As conversas selecionadas serão movidas para a aba <strong>Arquivadas</strong> e sairão da fila de atendimento.
              <br />
              <span className="text-foreground font-medium mt-1.5 block">
                Esta ação é reversível: você poderá desarquivá-las a qualquer momento na aba Arquivadas ou pelo botão Desfazer.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-8 text-xs rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmBulkArchive}
              className="h-8 text-xs rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:hover:bg-white dark:text-slate-900 cursor-pointer"
            >
              Sim, Arquivar {bulkConfirmCount}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal de Confirmação para Cadastro de Leads em Massa */}
      <AlertDialog open={bulkLeadConfirmOpen} onOpenChange={setBulkLeadConfirmOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-base">
              <UserPlus className="h-5 w-5 text-amber-600" />
              Cadastrar {selectedChatIds.size} contato{selectedChatIds.size > 1 ? "s" : ""} como Lead{selectedChatIds.size > 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed">
              Serão criados leads no CRM para as conversas selecionadas que ainda não possuem cadastro (ou atualizados os existentes).
              <br />
              <span className="text-foreground font-medium mt-1.5 block">
                Os novos leads serão vinculados aos seus respectivos telefones e histórico de conversas.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="h-8 text-xs rounded-xl">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmBulkCreateLeads}
              disabled={bulkCreateLeadsMutation.isPending}
              className="h-8 text-xs rounded-xl bg-amber-600 hover:bg-amber-700 text-white cursor-pointer"
            >
              {bulkCreateLeadsMutation.isPending ? "Cadastrando..." : `Sim, Cadastrar (${selectedChatIds.size})`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Banner de Desfazer Arquivamento em Massa */}
      {undoArchiveState && (
        <div className="fixed bottom-4 left-4 z-50 flex items-center justify-between gap-3 p-3 bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 rounded-xl shadow-lg border border-slate-700 dark:border-slate-300 text-xs animate-in fade-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center gap-2">
            <Archive className="h-4 w-4 text-emerald-400 dark:text-emerald-600 shrink-0" />
            <span>
              <strong>{undoArchiveState.count}</strong> conversa{undoArchiveState.count > 1 ? "s" : ""} arquivada{undoArchiveState.count > 1 ? "s" : ""}.
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2.5 text-xs font-semibold gap-1 bg-transparent border-slate-600 dark:border-slate-300 text-white dark:text-slate-900 hover:bg-slate-800 dark:hover:bg-slate-200 rounded-lg cursor-pointer"
            onClick={handleUndoBulkArchive}
          >
            <Undo2 className="h-3.5 w-3.5" />
            Desfazer
          </Button>
        </div>
      )}
    </PageShell>
  );
}
