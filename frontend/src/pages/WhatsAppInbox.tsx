import { describeMessageLabel } from "@/lib/inbox/messageLabel";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIsMobile, useKeyboardOpen, useVisibleArea } from "@/hooks/useMobileViewport";
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
  CalendarClock,
  Bell,
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
  Paperclip,
  Trash2,
  Pencil,
  Ban,
  X,
  Video,
  PhoneCall,
  ArrowLeft,
  Pause,
  Pin,
  PinOff,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { EmojiPicker } from "@/pages/LeadImports/EmojiPicker";
import { useCampanhas } from "@/hooks/useCampanhas";
import { useCrmClient } from "@/hooks/useCrmClient";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi, readApiErrorMessage } from "@/lib/api";
import { toast } from "sonner";
import { useFunnelVocabulary, detectStageSuggestion, canonicalizeStageKey, StageSuggestion } from "@/hooks/useFunnelVocabulary";
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
  useSendWhatsAppMediaMessage,
  ReplyChipUnavailableError,
  type ReplyChipAlternative,
  type SendWhatsAppMediaParams,
  useWhatsAppChats,
  useWhatsAppMessages,
  useClearWhatsAppChats,
  useUpdateChatState,
  useBulkUpdateChatState,
  useAttendChat,
  useUnmuteChat,
  useMuteChat,
  useCreateLeadFromChat,
  useBulkCreateLeadsFromChats,
  useDeleteWhatsAppMessage,
  useClearSingleChat,
  useWhatsAppProfilePic,
  type WhatsAppChat,
  type WhatsAppMessage,
} from "@/hooks/useWhatsAppInbox";
import { SingleFollowupReminderModal } from "@/components/followup/SingleFollowupReminderModal";
import { EditFollowupScheduleModal } from "@/components/followup/EditFollowupScheduleModal";
import { CreateLeadReminderModal } from "@/components/inbox/CreateLeadReminderModal";
import { ScheduleMeetingModal } from "@/components/inbox/ScheduleMeetingModal";
import { RegisterCallModal } from "@/components/inbox/RegisterCallModal";
import { MeetingPostCallCheckinCard } from "@/components/inbox/MeetingPostCallCheckinCard";
import {
  useInboxRemindersSummary,
  useCompleteLeadReminder,
  useDeleteLeadReminder,
  useUpdateLeadReminder,
  useLeadReminders,
  type LeadReminder,
} from "@/hooks/useLeadReminders";
import ApplyFollowupModal from "@/components/followup/ApplyFollowupModal";
import { MediaMessage } from "@/components/MediaMessage";
import { MediaAttachmentModal } from "@/components/inbox/MediaAttachmentModal";
import { VoiceRecorderButton } from "@/components/inbox/VoiceRecorderButton";
import { API_BASE_URL } from "@/lib/api";
import { sanitizePhone } from "@/lib/phone";
import { formatHeaderCount, parseDossierSummary } from "@/lib/messageFormatting";
import { isLeadStalled, computeLeadDaysIdle } from "@/lib/leads/stalledLeads";
import { useLeadReactivationSettings } from "@/hooks/useLeadReactivation";
import {
  ConversationListItem,
  InboxFooterFilters,
  InboxOrderRow,
  InboxSearchRow,
  InboxStateTabs,
  type ChipOption,
  type FooterFilter,
  type InboxTab,
} from "@/components/inbox/InboxColumn";

function formatScheduleDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${day}/${month} às ${hours}:${minutes}`;
}

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
      createdAt?: string | null;
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
  // Mensagem sem texto mostra o nome do tipo ("Figurinha"), nunca o colchete cru nem "[Mensagem]".
  const body = describeMessageLabel(chat.lastMessage?.body);
  if (!body) return "Sem mensagens recentes.";
  return body.length > 60 ? `${body.slice(0, 60)}...` : body;
}

const FUNNEL_STAGES = [
  { label: "Novo", value: "cold", key: "cold" },
  { label: "Atendimento", value: "inquiry", key: "inquiry" },
  { label: "Qualificado", value: "open_budget", key: "open_budget" },
  { label: "Fechado", value: "buyer", key: "buyer" },
] as const;


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

const DOSSIER_PINNED_KEY = "vexo_inbox_dossie_fixado";
const WIDE_SCREEN_QUERY = "(min-width: 1280px)";

const EMPTY_TAB_TEXT: Partial<Record<InboxTab, string>> = {
  esperam: "Ninguém esperando você nos últimos 7 dias.",
  com_lead: "Nenhuma conversa aguardando o lead.",
  robo: "Nenhuma conversa com o robô respondendo.",
  esfriaram: "Nenhuma conversa esfriou sem resposta.",
};

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
  const initialPhone = searchParams.get("phone") || searchParams.get("chatId") || null;

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [selectedInstanceNames, setSelectedInstanceNames] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [compositionMode, setCompositionMode] = useState<"whatsapp" | "internal_note">("whatsapp");
  const [inboxTab, setInboxTab] = useState<InboxTab>("esperam");
  // Relógio da lista: o tempo de espera anda sozinho, sem depender de nova busca.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [copiedPhone, setCopiedPhone] = useState(false);
  const [showScrollBottomBtn, setShowScrollBottomBtn] = useState(false);
  const [hasNewUnseenMessage, setHasNewUnseenMessage] = useState(false);
  // A gaveta do dossiê abre fechada. Quem atende o dia inteiro pode fixar: a escolha fica
  // salva neste navegador.
  const [showDossier, setShowDossier] = useState(false);
  const [dossierPinned, setDossierPinned] = useState(() => {
    try {
      return window.localStorage.getItem(DOSSIER_PINNED_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleDossierPinned = () => {
    setDossierPinned((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(DOSSIER_PINNED_KEY, next ? "1" : "0");
      } catch {
        /* sem armazenamento: vale só nesta visita */
      }
      if (next) setShowDossier(true);
      return next;
    });
  };
  const [isWideScreen, setIsWideScreen] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(WIDE_SCREEN_QUERY).matches : true
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(WIDE_SCREEN_QUERY);
    const onChange = () => setIsWideScreen(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  // No celular a tela mostra a fila OU a conversa, sempre em tela cheia.
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const isMobile = useIsMobile();
  // Área realmente visível (sem o teclado virtual): o campo de resposta fica sempre acima do teclado.
  const visibleArea = useVisibleArea(isMobile);
  // Com o teclado aberto sobra pouca tela: a faixa de contexto sai para a conversa aparecer.
  const keyboardOpen = useKeyboardOpen(isMobile, visibleArea);
  // Onde a fila começa no celular: logo abaixo da barra do sistema (medido, não chutado).
  // O marcador entra na tela depois do primeiro desenho; por isso é estado, não ref.
  const [layoutAnchor, setLayoutAnchor] = useState<HTMLDivElement | null>(null);
  const [mobileListTop, setMobileListTop] = useState(0);
  useLayoutEffect(() => {
    if (!isMobile || !layoutAnchor) return;
    const measure = () => {
      const anchor = layoutAnchor;
      const padding = anchor.parentElement ? parseFloat(getComputedStyle(anchor.parentElement).paddingTop) || 0 : 0;
      setMobileListTop(Math.max(0, Math.round(anchor.getBoundingClientRect().top - padding)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isMobile, layoutAnchor]);
  // Posição da fila quando a conversa foi aberta, para "voltar" devolver a fila no mesmo lugar.
  const listScrollTopRef = useRef(0);
  const openChatOnMobile = () => {
    listScrollTopRef.current = chatsContainerRef.current?.scrollTop ?? 0;
    setMobileView("chat");
  };
  useLayoutEffect(() => {
    if (!isMobile || mobileView !== "list") return;
    const list = chatsContainerRef.current;
    if (list) list.scrollTop = listScrollTopRef.current;
  }, [isMobile, mobileView]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [isReminderModalOpen, setIsReminderModalOpen] = useState(false);
  const [isApplyFollowupModalOpen, setIsApplyFollowupModalOpen] = useState(false);
  const [isCreateReminderModalOpen, setIsCreateReminderModalOpen] = useState(false);
  const [isEditScheduleModalOpen, setIsEditScheduleModalOpen] = useState(false);
  const [isScheduleMeetingModalOpen, setIsScheduleMeetingModalOpen] = useState(false);
  const [isRegisterCallModalOpen, setIsRegisterCallModalOpen] = useState(false);
  const [activeMeetingToEdit, setActiveMeetingToEdit] = useState<LeadReminder | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const chatsContainerRef = useRef<HTMLDivElement | null>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement | null>(null);
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

  const { user, getIdToken } = useAuth();
  const { data: tenants = [], isLoading: tenantsLoading } = useLeadClients();
  const activeTenant = tenants.find((t) => t.id === clientId) ?? null;
  const podeGerarProposta = useMemo(() => {
    const activeClientId = clientId;
    const tenantSettings = (activeTenant as any)?.settings || activeTenant;
    return (
      activeClientId === "geracao-digital" ||
      Boolean(
        tenantSettings?.modulos_adicionais?.includes("propostas_comerciais") ||
        (activeTenant as any)?.modulos_adicionais?.includes("propostas_comerciais")
      )
    );
  }, [clientId, activeTenant]);
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
  const muteChat = useMuteChat(clientId);
  const createLeadMutation = useCreateLeadFromChat(clientId);
  const bulkCreateLeadsMutation = useBulkCreateLeadsFromChats(clientId);
  const messagesQuery = useWhatsAppMessages(clientId, instanceFilter, selectedChatId, canLoadInbox);
  const sendMessage = useSendWhatsAppMessage(clientId, selectedChatId);
  const sendMediaMessage = useSendWhatsAppMediaMessage(clientId, selectedChatId);
  const [attachmentModalOpen, setAttachmentModalOpen] = useState(false);
  const clearChats = useClearWhatsAppChats(clientId);
  const { data: reactivationSettings } = useLeadReactivationSettings(clientId || undefined);
  const reactivationStalledDays = reactivationSettings?.reactivation_stalled_days ?? 7;

  const remindersSummaryQuery = useInboxRemindersSummary(clientId);
  const completeLeadReminder = useCompleteLeadReminder(clientId);
  const deleteLeadReminder = useDeleteLeadReminder(clientId);
  // Envio parado pelo servidor porque o chip da conversa não pode enviar: guarda o que ia ser
  // enviado até o operador confirmar outro chip ou desistir.
  const [chipConfirm, setChipConfirm] = useState<{
    chatId: string;
    message: string;
    alternatives: ReplyChipAlternative[];
    pending: { kind: "text"; body: string } | { kind: "media"; params: SendWhatsAppMediaParams };
  } | null>(null);
  const updateLeadReminder = useUpdateLeadReminder(clientId);
  const [editingReminder, setEditingReminder] = useState<LeadReminder | null>(null);
  const [showCompletedReminders, setShowCompletedReminders] = useState(false);
  const alertedOverdueReminderIds = useRef<Set<string>>(new Set());
  const overdueSeeded = useRef(false);

  // Reseta semente de alertas se o tenant for trocado
  useEffect(() => {
    alertedOverdueReminderIds.current = new Set();
    overdueSeeded.current = false;
  }, [clientId]);

  // Toast único por lembrete ao virar vencido (quando cruza de pendente para vencido com a aba aberta)
  useEffect(() => {
    if (!remindersSummaryQuery.data?.itemsByPhone) return;
    const items = remindersSummaryQuery.data.itemsByPhone;

    // 1ª carga: semeia os IDs já vencidos sem disparar toast
    if (!overdueSeeded.current) {
      for (const contact of Object.values(items)) {
        for (const rem of contact.activeReminders || []) {
          if (rem.status === "pending" && rem.isOverdue) {
            alertedOverdueReminderIds.current.add(rem.id);
          }
        }
      }
      overdueSeeded.current = true;
      return;
    }

    // Da 2ª carga em diante: avisa apenas sobre lembretes do usuário atual que viraram vencidos agora
    for (const contact of Object.values(items)) {
      for (const rem of contact.activeReminders || []) {
        if (
          rem.isForCurrentUser &&
          rem.status === "pending" &&
          rem.isOverdue &&
          !alertedOverdueReminderIds.current.has(rem.id)
        ) {
          alertedOverdueReminderIds.current.add(rem.id);
          toast.error(`⏰ Lembrete vencido: ${rem.title}`, {
            description: `Para ${rem.leadName || rem.phone} · Marcado para ${formatScheduleDate(rem.remindAt)}`,
          });
        }
      }
    }
  }, [remindersSummaryQuery.data]);

  const itemsByPhone = remindersSummaryQuery.data?.itemsByPhone || {};
  const hojeBadgeCount = remindersSummaryQuery.data?.todayCount || 0;

  // ── Seleção Múltipla e Ações em Massa ─────────────────────────────────────────
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
  const [bulkConfirmCount, setBulkConfirmCount] = useState(0);
  const [bulkConfirmPhones, setBulkConfirmPhones] = useState<string[]>([]);
  const [bulkLeadConfirmOpen, setBulkLeadConfirmOpen] = useState(false);
  const [undoArchiveState, setUndoArchiveState] = useState<{ count: number; phones: string[] } | null>(null);
  const undoTimeoutRef = useRef<any>(null);

  // Limpa seleção sempre que mudar de aba ou de termo de busca (garante isolamento estrito)
  useEffect(() => {
    setSelectedChatIds(new Set());
    setSelectMode(false);
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
  const { getStageLabel } = useFunnelVocabulary(clientId || undefined);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Record<string, boolean>>({});

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
    return [...normalMessages, ...notesForChat].sort((a, b) => {
      const timeDiff = Number(a.timestamp || 0) - Number(b.timestamp || 0);
      if (timeDiff !== 0) return timeDiff;
      // Desempate 1: messageTimestamp com milissegundos (se disponível)
      const aMsgTime = "messageTimestamp" in a && a.messageTimestamp ? new Date(a.messageTimestamp).getTime() : 0;
      const bMsgTime = "messageTimestamp" in b && b.messageTimestamp ? new Date(b.messageTimestamp).getTime() : 0;
      if (aMsgTime !== bMsgTime) return aMsgTime - bMsgTime;
      // Desempate 2: createdAt com milissegundos
      const aCreated = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bCreated = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      if (aCreated !== bCreated) return aCreated - bCreated;
      // Desempate final por ID numérico (ou ordenação natural para IDs string)
      const numA = Number(a.id);
      const numB = Number(b.id);
      if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
      return String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
    });
  }, [rawMessages, internalNotes, selectedChatId]);

  const { isAdminUser, canAccessInternalPage } = useAuth();
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
  const deleteMessageMutation = useDeleteWhatsAppMessage(clientId);
  const clearChatMutation = useClearSingleChat(clientId);
  const [messageToDeleteForEveryone, setMessageToDeleteForEveryone] = useState<string | null>(null);
  const [chatToClear, setChatToClear] = useState<string | null>(null);

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

  const handleToggleOptOut = async (leadId: string, checked: boolean) => {
    try {
      const token = await getIdToken();
      const res = await fetchApi(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          opt_out: checked,
          metadata: {
            ...((matchedLead as any)?.metadata || {}),
            opt_out: checked ? "true" : "false",
          },
        }),
      });
      if (!res.ok) {
        const err = await readApiErrorMessage(res, "Falha ao atualizar opt-out do lead.");
        throw new Error(err);
      }
      toast.success(checked ? "Disparos em massa bloqueados (Opt-out ativo)." : "Bloqueio de disparos removido.");
      refetchLeads();
    } catch (err: any) {
      toast.error("Erro ao atualizar opt-out", { description: err.message });
    }
  };

  const selectedCanonicalPhone = useMemo(() => {
    if (!selectedChat?.id) return null;
    return sanitizePhone(selectedChat.id);
  }, [selectedChat?.id]);

  const selectedSummary = selectedCanonicalPhone ? itemsByPhone[selectedCanonicalPhone] : null;
  const activeSchedule = selectedSummary?.activeSchedule || null;
  const activeReminders = selectedSummary?.activeReminders || [];
  const pendingReminder = activeReminders.find((r) => r.status === "pending") || null;
  const activeMeeting = activeReminders.find((r) => r.activityType === "meeting" && r.status === "pending") || null;
  const regularPendingReminder = activeReminders.find((r) => (r.activityType === "reminder" || !r.activityType) && r.status === "pending") || null;

  const completedRemindersQuery = useLeadReminders(
    clientId,
    selectedCanonicalPhone,
    "completed"
  );
  const completedReminders = showCompletedReminders ? completedRemindersQuery.data || [] : [];

  // Contagem de conversas em espera vinda do servidor ou fallback local
  const awaitingReplyCount = chatsQuery.counts?.awaiting ?? 0;

  // Lista de conversas já filtradas pelo servidor conforme aba e busca
  const filteredChats = useMemo(() => {
    if (inboxTab === "hoje") {
      return chats.filter((c) => {
        const cPhone = sanitizePhone(c.id);
        const item = cPhone ? itemsByPhone[cPhone] : null;
        return Boolean(item?.todayDue?.hasScheduledToday || item?.todayDue?.hasReminderToday);
      });
    }
    return chats;
  }, [chats, inboxTab, itemsByPhone]);
  const totalChatsCount = chatsQuery.total ?? chats.length;

  const chipOptions = useMemo<ChipOption[]>(
    () =>
      evolutionInstances.map((inst) => ({
        value: inst.dispatch_webhook_url
          ? inst.dispatch_webhook_url.split("/").filter(Boolean).pop() ?? inst.name
          : inst.name,
        name: inst.name,
        // Sem estado informado, não afirmar que está desconectado.
        connected: !inst.connection_state || inst.connection_state === "open",
      })),
    [evolutionInstances]
  );

  // As listas que saíram das abas. Nenhuma deixou de existir: estas ficam no botão de filtros...
  const otherLists: FooterFilter[] = [
    {
      key: "esfriaram",
      label: "Esfriaram",
      title: "O lead falou por último há mais de 7 dias e ninguém respondeu. Mais parado primeiro.",
      count: chatsQuery.counts?.work?.esfriaram,
    },
    { key: "minhas", label: "Minhas", title: "Conversas atribuídas a você", count: chatsQuery.counts?.myUnopened },
    {
      key: "hoje",
      label: "Hoje",
      title: "Pendências para hoje ou atrasadas (mensagens agendadas e lembretes pessoais)",
      count: hojeBadgeCount,
    },
    {
      key: "pausadas",
      label: "Pausadas",
      title: "Conversas com o robô pausado. Na lista elas levam a etiqueta 'você atende'.",
      count: chatsQuery.counts?.paused,
    },
    { key: "todas", label: "Todas", title: "Todas as conversas (incluindo grupos e arquivadas)" },
  ];
  // ...e estas no rodapé da coluna.
  const footerFilters: FooterFilter[] = [
    { key: "grupos", label: "Grupos", title: "Grupos de WhatsApp", count: chatsQuery.counts?.groups },
    {
      key: "automacao",
      label: "Automações",
      title: "Robôs e autoatendimentos detectados do outro lado",
      count: chatsQuery.counts?.automations,
    },
    { key: "arquivadas", label: "Arquivadas", title: "Conversas arquivadas manualmente" },
  ];

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

  const handleMuteAgent = async () => {
    if (!selectedChat) return;
    try {
      await muteChat.mutateAsync({
        phone: selectedChat.id,
      });
      toast.success("Agente pausado nesta conversa. Ele só volta pelo \"Reativar agente\".");
      chatsQuery.refetch?.();
    } catch (err: any) {
      toast.error(err?.message || "Erro ao pausar agente.");
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
    if (selectedChatId) {
      setTimeout(() => chatTextareaRef.current?.focus(), 100);
    }
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

  // No celular a conversa fica escondida enquanto a fila está na tela: ao abrir, vai para o fim.
  useEffect(() => {
    if (mobileView !== "chat") return;
    const frame = requestAnimationFrame(() => {
      const container = messagesContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
    return () => cancelAnimationFrame(frame);
  }, [mobileView, selectedChatId]);

  // Celular: quando o teclado abre, a área visível encolhe. Quem estava no fim da conversa
  // continua vendo a última mensagem, em vez de ela ficar escondida atrás do campo.
  useLayoutEffect(() => {
    if (!isMobile || mobileView !== "chat") return;
    const container = messagesContainerRef.current;
    if (container && isNearBottomRef.current) container.scrollTop = container.scrollHeight;
  }, [isMobile, mobileView, visibleArea.height]);

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
      setTimeout(() => chatTextareaRef.current?.focus(), 10);
      return;
    }

    try {
      // Limpa o draft e re-foca IMEDIATAMENTE antes do await para o operador não perder o cursor
      setDraft("");
      setTimeout(() => chatTextareaRef.current?.focus(), 10);

      await sendMessage.mutateAsync(trimmedDraft);
      scrollToBottom("smooth");
    } catch (error) {
      if (error instanceof ReplyChipUnavailableError) {
        // Nada foi enviado. O texto fica guardado até a confirmação.
        setChipConfirm({
          chatId: selectedChatId,
          message: error.message,
          alternatives: error.alternatives,
          pending: { kind: "text", body: trimmedDraft },
        });
        return;
      }
      toast.error(error instanceof Error ? error.message : "Falha ao enviar mensagem.");
    } finally {
      // Garante que mesmo após retorno da rede o foco continua na caixa
      setTimeout(() => chatTextareaRef.current?.focus(), 50);
    }
  };

  // Áudio, imagem e arquivo: mesma regra de chip do texto.
  const sendMediaGuarded = async (params: SendWhatsAppMediaParams) => {
    try {
      await sendMediaMessage.mutateAsync(params);
    } catch (error) {
      if (error instanceof ReplyChipUnavailableError && selectedChatId) {
        setChipConfirm({
          chatId: selectedChatId,
          message: error.message,
          alternatives: error.alternatives,
          pending: { kind: "media", params },
        });
        return;
      }
      throw error;
    }
  };

  const handleConfirmChip = async (chipId: string) => {
    if (!chipConfirm) return;
    const { pending } = chipConfirm;
    try {
      if (pending.kind === "text") {
        await sendMessage.mutateAsync({ body: pending.body, confirmChipId: chipId });
      } else {
        await sendMediaMessage.mutateAsync({ ...pending.params, confirmChipId: chipId });
      }
      setChipConfirm(null);
      scrollToBottom("smooth");
    } catch (error) {
      if (error instanceof ReplyChipUnavailableError) {
        setChipConfirm({ ...chipConfirm, message: error.message, alternatives: error.alternatives });
        return;
      }
      toast.error(error instanceof Error ? error.message : "Falha ao enviar mensagem.");
    }
  };

  // Desistir devolve o texto ao campo: nada se perde e nada foi enviado.
  const handleCancelChipConfirm = () => {
    if (chipConfirm?.pending.kind === "text") setDraft(chipConfirm.pending.body);
    setChipConfirm(null);
    setTimeout(() => chatTextareaRef.current?.focus(), 10);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleInsertEmoji = (emoji: string) => {
    const textarea = chatTextareaRef.current;
    if (!textarea) {
      setDraft((prev) => prev + emoji);
      return;
    }

    const start = textarea.selectionStart ?? draft.length;
    const end = textarea.selectionEnd ?? draft.length;
    const nextValue = draft.slice(0, start) + emoji + draft.slice(end);
    setDraft(nextValue);

    requestAnimationFrame(() => {
      textarea.focus();
      const newCursor = start + emoji.length;
      textarea.setSelectionRange(newCursor, newCursor);
    });
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

  const { data: contactProfilePic } = useWhatsAppProfilePic(rawPhone || selectedChatId, clientId);

  const dossierSummary = useMemo(() => {
    return parseDossierSummary(currentChatSummary, matchedLead);
  }, [currentChatSummary, matchedLead]);

  const currentStageIndex = useMemo(() => {
    if (!matchedLead) return 0;
    const s = canonicalizeStageKey(matchedLead.stage || matchedLead.status || "");
    if (s === "buyer") return 3;
    if (s === "open_budget") return 2;
    if (s === "inquiry") return 1;
    return 0; // "cold"
  }, [matchedLead]);

  const stageSuggestion = useMemo(() => {
    if (!selectedChatId || !rawMessages || rawMessages.length === 0) return null;
    return detectStageSuggestion(rawMessages, matchedLead?.stage || matchedLead?.status);
  }, [selectedChatId, rawMessages, matchedLead?.stage, matchedLead?.status]);

  const activeSuggestion = selectedChatId && dismissedSuggestions[selectedChatId] ? null : stageSuggestion;

  const handleUpdateFunnelStage = async (newStageValue: string, lostReason?: string | null) => {
    if (!matchedLead?.id) {
      toast.error("Cadastre o lead no CRM antes de alterar o estágio do funil.");
      return;
    }
    try {
      const token = await getIdToken();
      const canonical = canonicalizeStageKey(newStageValue);
      const res = await fetchApi(`/api/leads/${matchedLead.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stage: canonical,
          status: newStageValue,
          stage_source: "manual",
          lost_reason: canonical === "lost" ? (lostReason || "desinteresse") : null,
        }),
      });
      if (!res.ok) {
        const err = await readApiErrorMessage(res, "Falha ao atualizar estágio.");
        throw new Error(err);
      }
      toast.success("Estágio do funil atualizado!");
      refetchLeads();
    } catch (err: any) {
      toast.error("Erro ao atualizar estágio", { description: err.message });
    }
  };

  const handleApplyStageSuggestion = (suggestion: StageSuggestion) => {
    handleUpdateFunnelStage(suggestion.suggestedStage, suggestion.lostReason);
    if (selectedChatId) {
      setDismissedSuggestions((prev) => ({ ...prev, [selectedChatId]: true }));
    }
  };

  const handleDismissStageSuggestion = () => {
    if (selectedChatId) {
      setDismissedSuggestions((prev) => ({ ...prev, [selectedChatId]: true }));
    }
  };

  const relationshipContextLine = useMemo(() => {
    const conversaNum = (matchedLead?.dados as any)?.numero_conversa || (matchedLead as any)?.total_conversas || 1;
    const conversaStr = `${conversaNum}ª conversa`;

    let marcoStr = "";
    const propostaEm = (matchedLead?.dados as any)?.proposta_enviada_em || (matchedLead as any)?.proposta_data;
    if (propostaEm) {
      const d = new Date(propostaEm);
      if (!isNaN(d.getTime())) {
        marcoStr = `proposta enviada em ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
      }
    } else if (matchedLead?.created_at) {
      const d = new Date(matchedLead.created_at);
      if (!isNaN(d.getTime())) {
        marcoStr = `lead desde ${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;
      }
    }

    return marcoStr ? `${conversaStr} · ${marcoStr}` : conversaStr;
  }, [matchedLead]);

  const handleDeleteMessage = async (messageId: string, mode: "me" | "everyone") => {
    try {
      await deleteMessageMutation.mutateAsync({ messageId, mode });
      if (mode === "everyone") {
        toast.success("Mensagem apagada para todos.");
      } else {
        toast.success("Mensagem apagada da sua tela.");
      }
    } catch (err: any) {
      toast.error(mode === "everyone" ? "Não foi possível apagar para todos" : "Erro ao apagar mensagem", {
        description: err.message,
      });
    }
  };

  const handleConfirmClearChat = async () => {
    if (!chatToClear) return;
    try {
      await clearChatMutation.mutateAsync({ phone: chatToClear });
      toast.success("Conversa limpa com sucesso da sua tela.");
      setChatToClear(null);
    } catch (err: any) {
      toast.error("Erro ao limpar conversa", { description: err.message });
    }
  };

  // ── Tela nova: o que o cabeçalho, o campo de resposta e a gaveta precisam saber ──
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
  const isSelectedChatArchived = Boolean(selectedChat && (selectedChat.state === "arquivada" || selectedChat.archived));

  const chipAliasesOf = (inst: { id?: string | null; name?: string | null; dispatch_webhook_url?: string | null }): string[] =>
    [inst.id, inst.name, String(inst.dispatch_webhook_url || "").split("/").filter(Boolean).pop()].filter(Boolean).map(String);
  // Chip padrão ativo da empresa: só é usado quando a conversa não tem chip gravado.
  const defaultChip = evolutionInstances.find((inst) => inst.active && inst.is_default) || evolutionInstances.find((inst) => inst.active) || null;
  const leadChipAlias = selectedChat?.leadChip || null;
  const leadChipInstance = leadChipAlias ? evolutionInstances.find((inst) => chipAliasesOf(inst).includes(leadChipAlias)) : null;
  const leadChipName = leadChipInstance?.name || leadChipAlias;
  const leadChipAgent = leadChipAlias ? chatsQuery.chipAgents?.[leadChipAlias] ?? null : null;
  const robotAnswersOnLeadChip = Boolean(leadChipAgent && leadChipAgent.kind !== "nenhum");
  // A resposta sai pelo chip em que o lead escreveu (regra do servidor, POST /api/whatsapp/messages).
  // O estado abaixo é o do cadastro; quem decide de verdade é o servidor, que confere na hora do envio.
  const leadChipDown = Boolean(
    leadChipAlias &&
      (!leadChipInstance ||
        leadChipInstance.active === false ||
        ["close", "closed", "connecting", "disconnected"].includes(String(leadChipInstance.connection_state || "").toLowerCase()))
  );
  // Só as abas de estado devolvem o chip da conversa. Nas outras listas a tela não sabe qual é.
  const chipKnownForTab = ["esperam", "com_lead", "robo", "esfriaram"].includes(inboxTab);

  const headerName = matchedLead?.nome || selectedChat?.name || "Selecione uma conversa";
  const currentStageLabel = getStageLabel(FUNNEL_STAGES[currentStageIndex].key);
  const assignedOperator = matchedLead?.assigned_to ? operatorOptions.find((op) => op.uid === matchedLead.assigned_to) : null;
  const responsibleLabel = matchedLead?.assigned_to
    ? assignedOperator?.displayName || assignedOperator?.email || matchedLead.assigned_to
    : "Compartilhado";
  const selectedOrigin = selectedChat?.leadOrigin ?? null;
  const selectedCampaignName = selectedChat?.sourceCampaignId ? campaignNames.get(selectedChat.sourceCampaignId) : undefined;
  const needsHumanAttention = Boolean(matchedLead?.dados?.precisa_atencao_humana || (matchedLead as any)?.precisa_atencao_humana);

  const handleAssignLead = async (targetUid: string | null) => {
    if (!matchedLead) return;
    try {
      const token = await getIdToken();
      const res = await fetchApi(`/api/leads/${matchedLead.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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
  };

  const isNoteMode = compositionMode === "internal_note";
  const isSending = sendMessage.isPending || sendMediaMessage.isPending;
  const showBulkBar = selectMode || selectedChatIds.size > 0;
  const waitOrderedTab = inboxTab === "esperam" || inboxTab === "esfriaram";
  const activeListName = [...otherLists, ...footerFilters].find((f) => f.key === inboxTab)?.label;
  const orderLabel = debouncedSearch
    ? `Resultado da busca · ${formatHeaderCount(filteredChats.length, totalChatsCount)}`
    : waitOrderedTab
    ? `${activeListName ? `${activeListName} · ` : ""}Mais parado primeiro`
    : activeListName
    ? `${activeListName} · ${formatHeaderCount(filteredChats.length, totalChatsCount)}`
    : "Mais recente primeiro";
  const chipScopeLabel = selectedInstanceNames[0]
    ? chipOptions.find((opt) => opt.value === selectedInstanceNames[0])?.name || selectedInstanceNames[0]
    : "Todos os chips";

  // Fechar a gaveta também desafixa: senão o X não fecharia nada em tela larga.
  const closeDossier = () => {
    setShowDossier(false);
    if (dossierPinned) toggleDossierPinned();
  };
  const mountInboxLayout = (node: ReactNode) =>
    isMobile && typeof document !== "undefined" ? createPortal(node, document.body) : node;

  const mobileLayoutStyle: CSSProperties | undefined = !isMobile
    ? undefined
    : mobileView === "chat"
    ? { top: visibleArea.offsetTop, height: visibleArea.height }
    : { top: mobileListTop + visibleArea.offsetTop, height: Math.max(0, visibleArea.height - mobileListTop) };

  const dossierVisible = (showDossier || (dossierPinned && isWideScreen)) && Boolean(selectedChat);
  const dossierAsColumn = dossierPinned && isWideScreen;

  // Conteúdo do dossiê: o mesmo na gaveta e na coluna fixada.
  const dossierPanel = (
    <div
      className="flex h-full min-h-0 flex-col bg-card"
      data-testid="dossier-panel"
      role="complementary"
      aria-label="Dossiê do lead"
      onKeyDown={(e) => {
        if (e.key === "Escape" && !dossierAsColumn) closeDossier();
      }}
    >
      <div className="flex items-center gap-2 border-b border-border/60 px-3.5 py-[11px]">
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-bold text-foreground">Dossiê do lead</span>
        <button
          type="button"
          onClick={toggleDossierPinned}
          aria-pressed={dossierPinned}
          aria-label={dossierPinned ? "Desafixar dossiê" : "Manter o dossiê fixo ao lado da conversa"}
          title={dossierPinned ? "Desafixar: o dossiê volta a abrir só quando você pedir" : "Fixar: o dossiê fica sempre aberto ao lado da conversa"}
          data-testid="dossier-pin"
          className={cn(
            "h-[26px] w-[26px] cursor-pointer place-items-center rounded-[7px] border", isWideScreen ? "grid" : "hidden",
            dossierPinned
              ? "border-indigo-300 bg-indigo-50 text-indigo-600 dark:border-indigo-500/50 dark:bg-indigo-500/15 dark:text-indigo-300"
              : "border-border bg-muted/40 text-foreground/70 hover:bg-muted"
          )}
        >
          {dossierPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          onClick={closeDossier}
          aria-label="Fechar gaveta"
          title="Fechar"
          data-testid="dossier-close"
          className="grid h-[26px] w-[26px] cursor-pointer place-items-center rounded-[7px] border border-border bg-muted/40 text-foreground/70 hover:bg-muted"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-[13px]">
        {/* Identidade */}
        <div className="flex items-center gap-2.5">
          <ChatAvatar label={headerName} picture={contactProfilePic || selectedChat?.profilePic} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold text-foreground">{matchedLead?.nome || selectedChat?.name || "Lead sem nome"}</div>
            <div className="truncate text-[10.5px] text-muted-foreground">{relationshipContextLine}</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Phone className="h-3 w-3" />
          <span className="font-mono">{displayPhone}</span>
          {rawPhone && (
            <button
              type="button"
              onClick={() => handleCopyPhone(rawPhone)}
              className="cursor-pointer p-1 text-muted-foreground transition-colors hover:text-foreground"
              title="Copiar número"
              aria-label="Copiar número"
            >
              {copiedPhone ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
            </button>
          )}
          {matchedLead?.qualificacao && (
            <Badge
              variant="outline"
              className={cn(
                "ml-auto text-[10px] font-bold uppercase",
                matchedLead.qualificacao === "QUENTE"
                  ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                  : matchedLead.qualificacao === "MORNO"
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                  : "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300"
              )}
            >
              {matchedLead.qualificacao === "QUENTE" ? "Quente" : matchedLead.qualificacao === "MORNO" ? "Morno" : "Frio"}
            </Badge>
          )}
        </div>

                {Boolean(matchedLead?.dados?.precisa_atencao_humana || (matchedLead as any)?.precisa_atencao_humana) && (
                  <div className="w-full p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-left flex items-start gap-2">
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

                {!matchedLead && !selectedChat?.isGroup && (
                  <div className="w-full p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-left">
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

        {/* Leitura do robô */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                    <Sparkles className="h-3.5 w-3.5 text-purple-500" />
                    Leitura do robô
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
                        Atualizar
                      </>
                    )}
                  </button>
                </div>

                <div className="rounded-2xl border border-purple-500/30 bg-purple-500/10 dark:bg-purple-950/40 p-4 space-y-3 text-xs shadow-xs">
                  {dossierSummary.isPersonal ? (
                    <div className="space-y-1 text-[11px] text-muted-foreground">
                      <div className="font-semibold flex items-center gap-1.5 text-foreground/80">
                        <span>🚫</span>
                        <span>Conversa pessoal</span>
                      </div>
                      <p className="italic text-muted-foreground/90 whitespace-pre-line leading-relaxed">
                        {dossierSummary.personalText || "Nenhuma intenção comercial detectada."}
                      </p>
                    </div>
                  ) : currentChatSummary || matchedLead ? (
                    <div className="space-y-2 text-[11px]">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-muted-foreground shrink-0 flex items-center gap-1.5">
                          <span>🎯</span> Objetivo:
                        </span>
                        <span className="text-foreground text-right font-medium">{dossierSummary.objetivo || "—"}</span>
                      </div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-muted-foreground shrink-0 flex items-center gap-1.5">
                          <span>📋</span> Situação:
                        </span>
                        <span className="text-foreground text-right font-medium">{dossierSummary.situacao || "—"}</span>
                      </div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-muted-foreground shrink-0 flex items-center gap-1.5">
                          <span>🤝</span> Combinado:
                        </span>
                        <span className="text-foreground text-right font-medium">{dossierSummary.combinado || "—"}</span>
                      </div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-muted-foreground shrink-0 flex items-center gap-1.5">
                          <span>⏭</span> Próximo passo:
                        </span>
                        <span className="text-foreground text-right font-medium">{dossierSummary.proximoPasso || "—"}</span>
                      </div>

                      {/* Rodapé com pendências de descoberta */}
                      {dossierSummary.missing.length > 0 && (
                        <div className="pt-2 mt-2 border-t border-purple-500/20 text-[10px] text-muted-foreground/80 italic">
                          Falta descobrir: {dossierSummary.missing.join(", ")}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-2 space-y-2">
                      <p className="text-muted-foreground text-[11px]">
                        Nenhum resumo gerado ainda.
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

              {activeSuggestion && matchedLead && (
                <div className="rounded-lg border border-purple-500/30 bg-purple-500/10 p-2.5 space-y-2 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-1.5">
                      <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-purple-900 dark:text-purple-200">
                          Sugestão da IA
                        </p>
                        <p className="text-[11px] text-purple-800/90 dark:text-purple-300 leading-snug">
                          {activeSuggestion.reason}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleDismissStageSuggestion}
                      className="text-purple-500 hover:text-purple-700 dark:hover:text-purple-300 p-0.5 cursor-pointer"
                      title="Dispensar sugestão"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="flex items-center gap-2 pt-0.5">
                    <Button
                      size="sm"
                      onClick={() => handleApplyStageSuggestion(activeSuggestion)}
                      className="h-6 text-[11px] px-2.5 bg-purple-600 hover:bg-purple-700 text-white font-medium rounded cursor-pointer"
                    >
                      Avançar para {getStageLabel(activeSuggestion.suggestedStage)}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleDismissStageSuggestion}
                      className="h-6 text-[11px] px-2 text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      Dispensar
                    </Button>
                  </div>
                </div>
              )}

        {/* Registrar: os cinco registros com o mesmo peso */}
        <div>
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[.05em] text-muted-foreground">Registrar</div>
          <div className="grid grid-cols-2 gap-[5px]">
            <button
              type="button"
              onClick={() => setIsRegisterCallModalOpen(true)}
              title="Registrar ligação telefônica (atendeu, ocupado etc.)"
              className="min-h-9 cursor-pointer rounded-[7px] border border-border bg-card px-1 text-[11px] font-semibold text-foreground/80 hover:bg-muted"
            >
              Ligação
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveMeetingToEdit(activeMeeting);
                setIsScheduleMeetingModalOpen(true);
              }}
              data-testid="register-meeting"
              title={
                activeMeeting
                  ? "Reunião já marcada para este lead. Clique para remarcar; o cancelamento fica no cartão da reunião, abaixo."
                  : "Marcar reunião com o lead. Entra na conta de reuniões do Dashboard."
              }
              className={cn(
                "min-h-9 cursor-pointer rounded-[7px] border px-1 text-[11px] font-semibold",
                activeMeeting
                  ? "border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200"
                  : "border-border bg-card text-foreground/80 hover:bg-muted"
              )}
            >
              {activeMeeting ? "Reunião marcada" : "Reunião"}
            </button>
            <button
              type="button"
              onClick={() => setIsCreateReminderModalOpen(true)}
              title="Criar lembrete pessoal interno (não envia nada ao cliente)"
              className="min-h-9 cursor-pointer rounded-[7px] border border-border bg-card px-1 text-[11px] font-semibold text-foreground/80 hover:bg-muted"
            >
              Lembrete
            </button>
            <button
              type="button"
              onClick={() => setIsApplyFollowupModalOpen(true)}
              className="min-h-9 cursor-pointer rounded-[7px] border border-border bg-card px-1 text-[11px] font-semibold text-foreground/80 hover:bg-muted"
            >
              Cadência
            </button>
            {activeSchedule ? (
              <button
                type="button"
                onClick={() => setIsEditScheduleModalOpen(true)}
                title="Mensagem agendada ativa para este lead. Clique para editar ou cancelar."
                className="col-span-2 flex min-h-9 cursor-pointer items-center justify-center gap-1.5 rounded-[7px] border border-indigo-300 bg-indigo-50 px-2 text-[11px] font-semibold text-indigo-700 hover:bg-indigo-100 dark:border-indigo-500/40 dark:bg-indigo-500/10 dark:text-indigo-200"
              >
                <Clock3 className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">
                  Mensagem agendada
                  {activeSchedule.totalActiveCount && activeSchedule.totalActiveCount > 1 ? ` (+${activeSchedule.totalActiveCount - 1})` : ""} ·{" "}
                  {formatScheduleDate(activeSchedule.nextScheduledFor)}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setIsReminderModalOpen(true)}
                title="Agendar mensagem que dispara para o cliente na data e hora marcadas"
                className="col-span-2 min-h-9 cursor-pointer rounded-[7px] border border-border bg-card px-1 text-[11px] font-semibold text-foreground/80 hover:bg-muted"
              >
                Agendar mensagem
              </button>
            )}
          </div>
        </div>

        {podeGerarProposta && (
          <button
            type="button"
            onClick={() => {
              const rawP = selectedChat?.id ? String(selectedChat.id).replace(/\D/g, "") : "";
              const prospectName = matchedLead?.nome || selectedChat?.name || "";
              const params = new URLSearchParams();
              if (rawP) params.set("phone", rawP);
              if (prospectName) params.set("nome", prospectName);
              navigate(`/crm/propostas-gd?${params.toString()}`);
            }}
            className="w-full cursor-pointer rounded-[9px] bg-indigo-500 px-2.5 py-2.5 text-xs font-bold text-white hover:bg-indigo-600"
          >
            Gerar proposta comercial
          </button>
        )}

        <div className="flex flex-col gap-2">
                  {activeMeeting && (
                    <MeetingPostCallCheckinCard
                      meeting={activeMeeting}
                      clientId={clientId}
                      onReschedule={() => {
                        setActiveMeetingToEdit(activeMeeting);
                        setIsScheduleMeetingModalOpen(true);
                      }}
                      onStageChange={(newStage) => handleUpdateFunnelStage(newStage)}
                      onCancel={async () => {
                        try {
                          await deleteLeadReminder.mutateAsync(activeMeeting.id);
                          toast.success("Reunião cancelada");
                        } catch (err) {
                          toast.error(err instanceof Error ? err.message : "Não foi possível cancelar a reunião.");
                          throw err;
                        }
                      }}
                    />
                  )}

                  {regularPendingReminder && (
                    <div
                      className={cn(
                        "rounded-xl border p-2.5 text-xs flex items-start justify-between gap-2 shadow-2xs",
                        regularPendingReminder.isOverdue
                          ? "border-rose-500/40 bg-rose-500/10 text-rose-900 dark:text-rose-200"
                          : "border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200"
                      )}
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div
                          className={cn(
                            "flex items-center gap-1.5 font-bold",
                            regularPendingReminder.isOverdue
                              ? "text-rose-800 dark:text-rose-300"
                              : "text-amber-800 dark:text-amber-300"
                          )}
                        >
                          <Bell
                            className={cn(
                              "h-3.5 w-3.5 shrink-0",
                              regularPendingReminder.isOverdue
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-amber-600 dark:text-amber-400"
                            )}
                          />
                          {regularPendingReminder.isOverdue && (
                            <span className="rounded bg-rose-600 px-1 py-0.5 text-[9px] font-extrabold uppercase text-white tracking-wider shrink-0">
                              Venceu
                            </span>
                          )}
                          <span className="truncate">{regularPendingReminder.title}</span>
                        </div>
                        {regularPendingReminder.notes && (
                          <p
                            className={cn(
                              "text-[11px] line-clamp-2",
                              regularPendingReminder.isOverdue
                                ? "text-rose-700/80 dark:text-rose-300/80"
                                : "text-amber-700/80 dark:text-amber-300/80"
                            )}
                          >
                            {regularPendingReminder.notes}
                          </p>
                        )}
                        <div
                          className={cn(
                            "flex items-center gap-2 text-[10px] pt-0.5 font-mono",
                            regularPendingReminder.isOverdue
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-amber-600 dark:text-amber-400"
                          )}
                        >
                          <span>📅 {formatScheduleDate(regularPendingReminder.remindAt)}</span>
                          {regularPendingReminder.assignedToName && (
                            <span>· 👤 {regularPendingReminder.assignedToName}</span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={async () => {
                            try {
                              await completeLeadReminder.mutateAsync(regularPendingReminder.id);
                              toast.success("Lembrete concluído!");
                            } catch (err: any) {
                              toast.error(err?.message || "Erro ao concluir lembrete.");
                            }
                          }}
                          disabled={completeLeadReminder.isPending}
                          className="h-7 px-2 text-[11px] font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white border-none shrink-0 cursor-pointer gap-1 shadow-2xs"
                          title="Concluir lembrete em 1 clique"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Concluir
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 rounded-lg text-muted-foreground hover:text-foreground cursor-pointer"
                              title="Opções do lembrete"
                            >
                              <MoreVertical className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-32">
                            <DropdownMenuItem
                              onClick={() => {
                                setEditingReminder(regularPendingReminder);
                                setIsCreateReminderModalOpen(true);
                              }}
                              className="cursor-pointer text-xs flex items-center gap-2"
                            >
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                              <span>Editar</span>
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={async () => {
                                if (window.confirm("Deseja realmente excluir este lembrete?")) {
                                  try {
                                    await deleteLeadReminder.mutateAsync(regularPendingReminder.id);
                                    toast.success("Lembrete excluído!");
                                  } catch (err: any) {
                                    toast.error(err?.message || "Erro ao excluir lembrete.");
                                  }
                                }
                              }}
                              className="cursor-pointer text-xs flex items-center gap-2 text-rose-600 focus:text-rose-600"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              <span>Excluir</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  )}
        </div>

        {matchedLead && (
          <div className="flex items-center gap-2.5 rounded-[9px] border border-border/60 bg-muted/30 px-[11px] py-[9px]">
            <div className="min-w-0 flex-1">
              <div className="text-[11.5px] font-semibold text-foreground">Bloquear disparos em massa</div>
              <div className="text-[10px] text-muted-foreground">opt-out deste lead</div>
            </div>
            <Switch
              aria-label="Bloquear disparos em massa para este lead"
              checked={Boolean((matchedLead as any)?.opt_out || (matchedLead?.dados as any)?.opt_out || (matchedLead as any)?.metadata?.opt_out === "true")}
              onCheckedChange={(checked) => handleToggleOptOut(matchedLead.id, checked)}
            />
          </div>
        )}

        <div>
          <button
            type="button"
            onClick={() => {
              const p = new URLSearchParams();
              if (matchedLead?.id) p.set("leadId", matchedLead.id);
              if (rawPhone) p.set("phone", rawPhone);
              navigate(`/crm/banco-de-dados?${p.toString()}`);
            }}
            className="cursor-pointer py-1 text-[11px] font-semibold text-indigo-600 hover:underline dark:text-indigo-300"
          >
            Histórico completo
          </button>
                  <div className="pt-0.5">
                    <button
                      type="button"
                      onClick={() => setShowCompletedReminders((prev) => !prev)}
                      className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer py-1"
                    >
                      {showCompletedReminders ? (
                        <ChevronDown className="h-3 w-3" />
                      ) : (
                        <ChevronRight className="h-3 w-3" />
                      )}
                      <span>Lembretes concluídos</span>
                    </button>

                    {showCompletedReminders && (
                      <div className="mt-1 space-y-1.5 pl-1">
                        {completedRemindersQuery.isLoading ? (
                          <div className="text-[10px] text-muted-foreground p-1">Carregando concluídos...</div>
                        ) : completedReminders.length === 0 ? (
                          <div className="text-[10px] text-muted-foreground italic p-1">
                            Nenhum lembrete concluído para este contato.
                          </div>
                        ) : (
                          completedReminders.map((r) => (
                            <div
                              key={r.id}
                              className="rounded-lg border border-border/40 bg-muted/20 p-2 text-xs flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0 flex-1 space-y-0.5 opacity-80">
                                <div className="flex items-center gap-1.5 font-medium line-through text-muted-foreground text-[11px]">
                                  <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                                  <span className="truncate">{r.title}</span>
                                </div>
                                <div className="text-[10px] text-muted-foreground font-mono">
                                  Concluído {r.completedAt ? formatScheduleDate(r.completedAt) : ""}
                                </div>
                              </div>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                  try {
                                    await updateLeadReminder.mutateAsync({
                                      id: r.id,
                                      status: "pending",
                                    });
                                    toast.success("Lembrete reaberto com sucesso!");
                                  } catch (err: any) {
                                    toast.error(err?.message || "Erro ao reabrir lembrete.");
                                  }
                                }}
                                disabled={updateLeadReminder.isPending}
                                className="h-6 px-2 text-[10px] font-semibold text-muted-foreground hover:text-foreground rounded cursor-pointer gap-1"
                                title="Desfazer conclusão e mover de volta para pendente"
                              >
                                <RotateCcw className="h-3 w-3" />
                                Desfazer
                              </Button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
        </div>
      </div>
    </div>
  );

  return (
    <PageShell title={title} subtitle={subtitle} headerRight={headerRight} hideHero spacing="space-y-4">
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
        /* ── PAINEL DE PLANTÃO: fila à esquerda, conversa no resto, dossiê em gaveta ── */
        <div ref={setLayoutAnchor} data-testid="inbox-layout-anchor">
        {/* No celular a tela vai direto para o <body>: dentro da página há elementos com efeito
            visual (transform/blur) que prendem o "position: fixed" e deslocavam a tela em 16 px. */}
        {mountInboxLayout(
        <div
          data-testid="inbox-layout"
          data-mobile-view={isMobile ? mobileView : undefined}
          // Celular: tela cheia. A fila começa abaixo da barra do sistema; a conversa cobre a tela
          // toda e acompanha a área visível, então o campo de resposta nunca fica atrás do teclado.
          style={mobileLayoutStyle}
          className={cn(
            "inbox-touch flex overflow-hidden bg-card",
            isMobile
              ? "fixed inset-x-0 z-40"
              : "h-[calc(100dvh-100px)] min-h-[480px] rounded-2xl border border-border/80 shadow-xs"
          )}
        >
          {/* ═══════════ COLUNA 1 — A FILA ═══════════ */}
          <aside
            data-testid="inbox-column"
            className={cn(
              "min-h-0 w-full flex-col border-border/80 md:w-[340px] md:shrink-0 md:border-r xl:w-[380px]",
              mobileView === "chat" ? "hidden md:flex" : "flex"
            )}
          >
            <InboxSearchRow
              search={searchQuery}
              onSearchChange={setSearchQuery}
              filtersOpen={filtersOpen}
              onFiltersOpenChange={setFiltersOpen}
              chipValue={selectedInstanceNames[0] || null}
              chipOptions={chipOptions}
              chipAgents={chatsQuery.chipAgents}
              onChipChange={(val) => setSelectedInstanceNames(val ? [val] : [])}
              otherLists={otherLists}
              activeTab={inboxTab}
              onTabChange={setInboxTab}
              selectMode={selectMode}
              onToggleSelectMode={() => {
                setSelectMode((v) => !v);
                setSelectedChatIds(new Set());
              }}
            />

            <div className="px-4 pt-3">
              <InboxStateTabs active={inboxTab} counts={chatsQuery.counts?.work} onChange={setInboxTab} />
            </div>

            <InboxOrderRow label={orderLabel} chipLabel={chipScopeLabel} onChipClick={() => setFiltersOpen(true)} />

            {showBulkBar && (
              <div className="flex flex-col gap-1.5 border-y border-indigo-200 bg-indigo-50 px-3 py-2 dark:border-indigo-500/30 dark:bg-indigo-500/10" data-testid="inbox-bulk-bar">
                <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
                  <div className="flex items-center gap-1.5 font-semibold text-indigo-700 dark:text-indigo-200">
                    <CheckSquare className="h-3.5 w-3.5" />
                    <span>
                      {selectedChatIds.size} selecionada{selectedChatIds.size === 1 ? "" : "s"}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      variant="default"
                      size="sm"
                      className="h-7 cursor-pointer gap-1 rounded-lg bg-amber-600 px-2 text-[11px] font-semibold text-white shadow-xs hover:bg-amber-700"
                      onClick={handleRequestBulkCreateLeads}
                      disabled={bulkCreateLeadsMutation.isPending || selectedChatIds.size === 0}
                      title="Cadastrar contatos selecionados como leads no CRM"
                    >
                      <UserPlus className="h-3 w-3" />
                      Cadastrar leads
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      className="h-7 cursor-pointer gap-1 rounded-lg bg-slate-900 px-2 text-[11px] font-semibold text-white shadow-xs hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
                      onClick={() => handleRequestBulkArchive(Array.from(selectedChatIds))}
                      disabled={selectedChatIds.size === 0}
                      title="Arquivar conversas selecionadas"
                    >
                      <Archive className="h-3 w-3" />
                      Arquivar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 cursor-pointer px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setSelectedChatIds(new Set());
                        setSelectMode(false);
                      }}
                      title="Sair da seleção"
                    >
                      Sair
                    </Button>
                  </div>
                </div>
                {filteredChats.length > selectedChatIds.size && (
                  <button
                    type="button"
                    onClick={handleSelectAllVisible}
                    className="cursor-pointer text-left text-[11px] font-medium text-indigo-700 hover:underline dark:text-indigo-200"
                  >
                    Selecionar todas as {filteredChats.length} conversas desta lista
                  </button>
                )}
              </div>
            )}

            {/* Lista */}
            <div ref={chatsContainerRef} onScroll={handleChatsScroll} className="min-h-0 flex-1 overflow-y-auto" data-testid="inbox-list">
              {chatsQuery.isLoading ? (
                <div className="p-6 text-center text-xs text-muted-foreground">Carregando conversas...</div>
              ) : chatsQuery.error && filteredChats.length === 0 ? (
                <div role="alert" data-testid="chats-error" className="space-y-2 p-6 text-center text-xs text-destructive">
                  <p className="font-medium">Não foi possível carregar as conversas.</p>
                  <p className="text-muted-foreground">
                    {chatsQuery.error instanceof Error ? chatsQuery.error.message : "Erro desconhecido."}
                  </p>
                  <button
                    type="button"
                    onClick={() => chatsQuery.refetch()}
                    className="text-foreground underline underline-offset-2 hover:text-primary"
                  >
                    Tentar de novo
                  </button>
                </div>
              ) : filteredChats.length === 0 ? (
                <div className="p-6 text-center text-xs text-muted-foreground" data-testid="inbox-empty">
                  {(!debouncedSearch && EMPTY_TAB_TEXT[inboxTab]) || "Nenhuma conversa encontrada."}
                </div>
              ) : (
                filteredChats.map((chat) => {
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
                  const cardSummary = cPhone ? itemsByPhone[cPhone] : null;
                  const cardHasActiveSchedule = Boolean(cardSummary?.activeSchedule);
                  const cardPendingReminders = cardSummary?.activeReminders || [];
                  const precisaAtencao = Boolean(lead?.dados?.precisa_atencao_humana || (lead as any)?.precisa_atencao_humana);
                  const motivoAtencao = String(
                    lead?.dados?.motivo_atencao_humana || (lead as any)?.motivo_atencao_humana || "Atenção humana solicitada"
                  );
                  const isAttended = Boolean(
                    chat.attendedAt && (!chat.timestamp || new Date(chat.attendedAt).getTime() >= chat.timestamp * 1000)
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
                  const reminder = cardPendingReminders[0];
                  const lastSender = chat.lastMessage?.senderType;
                  const lastFromRobot = Boolean(chat.lastMessage?.fromMe && (lastSender === "bot" || lastSender === "campaign"));
                  const previewBody = getPreview(chat);
                  const preview = chat.leadNeverSpoke
                    ? `Sem resposta · ${previewBody}`
                    : !chat.lastMessage?.fromMe
                    ? previewBody
                    : lastFromRobot
                    ? `Robô: ${previewBody}`
                    : `Você: ${previewBody}`;

                  return (
                    <ConversationListItem
                      key={chat.id}
                      id={chat.id}
                      label={chat.name || phoneLabel}
                      preview={preview}
                      selected={isSelected}
                      selectMode={showBulkBar}
                      checked={selectedChatIds.has(chat.id)}
                      onSelect={() => {
                        setSelectedChatId(chat.id);
                        openChatOnMobile();
                      }}
                      onToggleCheck={() => toggleSelectChat(chat.id)}
                      waitingSince={chat.waitingSince}
                      showWait={waitOrderedTab}
                      fallbackTime={formatChatDate(chat.timestamp)}
                      now={nowTick}
                      flags={{
                        unreadCount: chat.unreadCount,
                        attentionReason: precisaAtencao ? motivoAtencao : null,
                        isNumberChange: chat.isNumberChange,
                        isAgentMuted: Boolean(chat.agentMutedAt),
                        agentMutedReason: chat.agentMutedReason,
                        isAutomation: chat.state === "automacao",
                        automationReason: chat.stateReason,
                        isArchived: chat.state === "arquivada" || chat.archived,
                        isGroup: chat.isGroup,
                        isTransferred: Boolean(chat.lastMessage?.meta?.is_handoff_bridge),
                        transferredTo: chat.lastMessage?.meta?.transferred_to_chip || null,
                        isAttended:
                          isAttended &&
                          !isAwaitingReply &&
                          chat.state !== "automacao" &&
                          chat.state !== "arquivada" &&
                          !chat.archived &&
                          !chat.isGroup,
                        attendedBy: chat.attendedBy,
                        noLead: !chat.isGroup && !rawId.includes("@g.us") && !lead,
                        scheduleText: cardHasActiveSchedule ? formatScheduleDate(cardSummary?.activeSchedule?.nextScheduledFor) : null,
                        reminder: reminder
                          ? { title: reminder.title, overdue: Boolean(reminder.isOverdue), when: formatScheduleDate(reminder.remindAt) }
                          : null,
                        stalledDays: lead && isLeadStalled(lead, reactivationStalledDays) ? computeLeadDaysIdle(lead) : null,
                        fromCampaign: chat.leadOrigin === "campaign",
                        campaignName: chat.sourceCampaignId ? campaignNames.get(chat.sourceCampaignId) ?? null : null,
                        leadNeverSpoke: chat.leadNeverSpoke,
                        lastFromRobot,
                      }}
                    >
                      {inboxTab === "hoje" && cardSummary?.todayDue?.hasScheduledToday && (
                        <div className="mt-1 flex items-center gap-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-2 py-1 text-[10px] text-indigo-800 dark:text-indigo-300">
                          <Clock3 className="h-3 w-3 shrink-0 text-indigo-600 dark:text-indigo-400" />
                          <span className="font-bold">Vai ser enviado ao cliente:</span>
                          <span className="truncate">mensagem agendada para {formatScheduleDate(cardSummary.todayDue.scheduledAt)}</span>
                        </div>
                      )}
                      {inboxTab === "hoje" && cardSummary?.todayDue?.hasReminderToday && (
                        <div
                          className={cn(
                            "mt-1 flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[10px]",
                            cardSummary.todayDue.isReminderOverdue
                              ? "border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300"
                              : "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300"
                          )}
                        >
                          <Bell
                            className={cn(
                              "h-3 w-3 shrink-0",
                              cardSummary.todayDue.isReminderOverdue ? "text-rose-600 dark:text-rose-400" : "text-amber-600 dark:text-amber-400"
                            )}
                          />
                          <span className="font-bold">{cardSummary.todayDue.isReminderOverdue ? "Venceu:" : "Só para você:"}</span>
                          <span className="truncate">{cardSummary.todayDue.reminderTitle}</span>
                        </div>
                      )}
                    </ConversationListItem>
                  );
                })
              )}
            </div>

            {/* Rodapé: Grupos, Automações e Arquivadas. As outras listas estão no botão de filtros. */}
            <InboxFooterFilters active={inboxTab} filters={footerFilters} onChange={setInboxTab} />
          </aside>

          {/* ═══════════ COLUNA 2 — A CONVERSA ═══════════ */}
          <section
            data-testid="inbox-conversation"
            className={cn("relative min-h-0 min-w-0 flex-1 flex-col", mobileView === "chat" ? "flex" : "hidden md:flex")}
          >
            {/* Cabeçalho: uma linha de identidade */}
            <header className="flex flex-wrap items-center gap-3 border-b border-border/60 px-3 py-3 sm:px-5" data-testid="chat-header">
              <button
                type="button"
                onClick={() => setMobileView("list")}
                aria-label="Voltar para a lista de conversas"
                data-testid="chat-back"
                className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-[9px] border border-border bg-card text-foreground/70 md:hidden"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              {selectedChat && <ChatAvatar label={headerName} picture={contactProfilePic || selectedChat.profilePic} size="sm" />}
              <div className="min-w-0 flex-1 basis-[140px]">
                <div className="truncate text-[15px] font-semibold text-foreground" title={headerName} data-testid="chat-header-name">
                  {headerName}
                </div>
                {selectedChat && (
                  <div className="mt-px truncate text-xs text-muted-foreground" data-testid="chat-header-sub">
                    {selectedChat.isGroup ? "Grupo de WhatsApp" : displayPhone}
                    {leadChipName ? ` · chip ${leadChipName}` : ""}
                  </div>
                )}
              </div>

              {selectedChat && selectedChat.agentMutedAt ? (
                <div
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-100 py-[5px] pl-2 pr-2.5 dark:border-amber-500/40 dark:bg-amber-500/15"
                  title={selectedChat.agentMutedReason ? `Robô pausado: ${selectedChat.agentMutedReason}` : "Robô pausado nesta conversa"}
                  data-testid="robot-pill"
                >
                  <Pause className="h-[13px] w-[13px] text-amber-800 dark:text-amber-200" aria-hidden="true" />
                  <span className="text-xs font-semibold text-amber-900 dark:text-amber-100">Robô pausado</span>
                  <button
                    type="button"
                    onClick={handleUnmuteAgent}
                    disabled={unmuteChat.isPending}
                    className="cursor-pointer pl-1 text-xs font-bold text-indigo-600 underline disabled:opacity-60 dark:text-indigo-300"
                  >
                    {unmuteChat.isPending ? "reativando..." : "reativar"}
                  </button>
                </div>
              ) : selectedChat && robotAnswersOnLeadChip && !selectedChat.isGroup ? (
                <div
                  className="flex shrink-0 items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 py-[5px] pl-2 pr-2.5 dark:border-indigo-500/40 dark:bg-indigo-500/15"
                  title={leadChipAgent?.agentName ? `Quem responde sozinho neste chip: ${leadChipAgent.agentName}` : "O robô da empresa responde sozinho neste chip"}
                  data-testid="robot-pill"
                >
                  <Bot className="h-[13px] w-[13px] text-indigo-600 dark:text-indigo-300" aria-hidden="true" />
                  <span className="text-xs font-semibold text-indigo-800 dark:text-indigo-100">Robô cuida</span>
                  <button
                    type="button"
                    onClick={handleMuteAgent}
                    disabled={muteChat.isPending}
                    className="cursor-pointer pl-1 text-xs font-bold text-indigo-600 underline disabled:opacity-60 dark:text-indigo-300"
                  >
                    {muteChat.isPending ? "pausando..." : "pausar"}
                  </button>
                </div>
              ) : null}

              {selectedChat && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label="Mais ações desta conversa"
                      title="Mais ações desta conversa"
                      data-testid="chat-menu"
                      className="grid h-[34px] w-[34px] shrink-0 cursor-pointer place-items-center rounded-[9px] border border-border bg-card text-foreground/70 hover:bg-muted"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </button>
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
                          {selectedChat.state !== "arquivada" && !selectedChat.archived && (
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

                          {/* Pausar agente na mão (atendimento humano) */}
                          {!selectedChat.agentMutedAt && !selectedChat.isGroup && (
                            <DropdownMenuItem
                              onClick={handleMuteAgent}
                              disabled={muteChat.isPending}
                              className="gap-2 cursor-pointer text-amber-700 dark:text-amber-300 font-semibold"
                            >
                              <Bot className="h-3.5 w-3.5 text-amber-600" />
                              <span>{muteChat.isPending ? "Pausando..." : "Pausar Agente IA"}</span>
                            </DropdownMenuItem>
                          )}

                          {selectedChat.state !== "automacao" && (
                            <DropdownMenuItem onClick={handleToggleArchive} className="gap-2 cursor-pointer">
                              {isSelectedChatArchived ? (
                                <ArchiveRestore className="h-3.5 w-3.5 text-muted-foreground" />
                              ) : (
                                <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                              <span>{isSelectedChatArchived ? "Desarquivar conversa" : "Arquivar conversa"}</span>
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

                          {/* Ver no Banco de Dados (movido do painel lateral) */}
                          <DropdownMenuItem
                            onClick={() => {
                              const p = new URLSearchParams();
                              if (matchedLead?.id) p.set("leadId", matchedLead.id);
                              if (rawPhone) p.set("phone", rawPhone);
                              navigate(`/crm/banco-de-dados?${p.toString()}`);
                            }}
                            className="gap-2 cursor-pointer text-muted-foreground hover:text-foreground"
                          >
                            <Inbox className="h-3.5 w-3.5 text-muted-foreground" />
                            <span>Ver no Banco de Dados</span>
                          </DropdownMenuItem>

                          {/* Limpar histórico da conversa da tela do consultor */}
                          <DropdownMenuItem
                            onClick={() => setChatToClear(rawPhone || String(selectedChat.id).replace(/\D/g, ""))}
                            className="gap-2 cursor-pointer text-destructive focus:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            <span>Limpar conversa</span>
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                </DropdownMenu>
              )}
            </header>

            {/* Faixa de contexto: por que esse lead está aqui */}
            {selectedChat && !keyboardOpen && (
              <div
                className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-border/60 bg-muted/30 px-3 py-[9px] sm:px-5"
                data-testid="chat-context"
              >
                {!selectedChat.isGroup && (
                  <>
                    <span className="text-[11.5px] text-muted-foreground">Veio de</span>
                    {selectedOrigin === "campaign" ? (
                      <span className="max-w-[220px] truncate rounded-[7px] border border-indigo-200 bg-indigo-50 px-[9px] py-[3px] text-xs font-semibold text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-200">
                        {selectedCampaignName ? `Campanha: ${selectedCampaignName}` : "Campanha"}
                      </span>
                    ) : selectedOrigin === "inbound" ? (
                      <span className="rounded-[7px] border border-border bg-card px-[9px] py-[3px] text-xs font-semibold text-foreground/80">
                        Entrada direta
                      </span>
                    ) : (
                      <span className="text-xs italic text-muted-foreground" title="A origem deste contato não está gravada">
                        sem registro
                      </span>
                    )}
                    <span className="text-border" aria-hidden="true">
                      ·
                    </span>
                  </>
                )}

                {selectedChat.isGroup ? (
                  <span className="inline-flex items-center gap-1 rounded-[7px] border border-border bg-card px-[9px] py-[3px] text-xs font-semibold text-foreground/80">
                    <Users className="h-3 w-3" /> Grupo
                  </span>
                ) : matchedLead ? (
                  <>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          title="Estágio no funil. Clique para mudar."
                          data-testid="chat-stage"
                          className="inline-flex cursor-pointer items-center gap-1 rounded-[7px] border border-border bg-card px-[9px] py-[3px] text-xs font-semibold text-foreground/80 hover:bg-muted"
                        >
                          {currentStageLabel}
                          <ChevronDown className="h-3 w-3" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-48 text-xs">
                        {FUNNEL_STAGES.map((s, idx) => (
                          <DropdownMenuItem
                            key={s.value}
                            onClick={() => handleUpdateFunnelStage(s.value)}
                            className={cn("cursor-pointer gap-2", idx === currentStageIndex && "font-bold")}
                          >
                            {idx === currentStageIndex ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />}
                            {getStageLabel(s.key)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <span className="text-border" aria-hidden="true">
                      ·
                    </span>
                    {canManageUsers ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            title="Responsável pelo lead. Clique para mudar."
                            data-testid="chat-responsible"
                            className="inline-flex max-w-[200px] cursor-pointer items-center gap-1 rounded-[7px] border border-border bg-card px-[9px] py-[3px] text-xs font-semibold text-foreground/80 hover:bg-muted"
                          >
                            <span className="truncate">{responsibleLabel}</span>
                            <ChevronDown className="h-3 w-3 shrink-0" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="max-h-72 w-56 overflow-y-auto text-xs">
                          <DropdownMenuItem onClick={() => handleAssignLead(null)} className="cursor-pointer gap-2">
                            {!matchedLead.assigned_to ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />}
                            Compartilhado
                          </DropdownMenuItem>
                          {operatorOptions.map((op) => (
                            <DropdownMenuItem key={op.uid} onClick={() => handleAssignLead(op.uid)} className="cursor-pointer gap-2">
                              {matchedLead.assigned_to === op.uid ? <Check className="h-3.5 w-3.5" /> : <span className="w-3.5" />}
                              <span className="truncate">{op.displayName || op.email}</span>
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <span
                        className="max-w-[200px] truncate rounded-[7px] border border-border bg-card px-[9px] py-[3px] text-xs font-semibold text-foreground/80"
                        title="Responsável pelo lead"
                      >
                        {responsibleLabel}
                      </span>
                    )}
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={handleCreateLeadFromCurrentChat}
                    disabled={createLeadMutation.isPending}
                    title="Este contato ainda não está na base de leads. Clique para cadastrar."
                    data-testid="chat-create-lead"
                    className="inline-flex cursor-pointer items-center gap-1 rounded-[7px] border border-amber-300 bg-amber-100 px-[9px] py-[3px] text-xs font-semibold text-amber-900 hover:bg-amber-200 disabled:opacity-60 dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-100"
                  >
                    <UserPlus className="h-3 w-3" />
                    {createLeadMutation.isPending ? "Cadastrando..." : "Sem lead · cadastrar"}
                  </button>
                )}

                {needsHumanAttention && (
                  <span
                    className="inline-flex items-center gap-1 rounded-[7px] border border-red-300 bg-red-50 px-[9px] py-[3px] text-xs font-semibold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200"
                    title={String(matchedLead?.dados?.motivo_atencao_humana || (matchedLead as any)?.motivo_atencao_humana || "Atenção humana solicitada")}
                  >
                    <ShieldAlert className="h-3 w-3" /> Pede atenção
                  </span>
                )}
                {selectedChat.isNumberChange && (
                  <span className="inline-flex items-center gap-1 rounded-[7px] border border-indigo-200 bg-indigo-50 px-[9px] py-[3px] text-xs font-semibold text-indigo-700 dark:border-indigo-500/40 dark:bg-indigo-500/15 dark:text-indigo-200" title="Contato informou novo número">
                    <Phone className="h-3 w-3" /> Novo número
                  </span>
                )}
                {selectedChat.state === "automacao" && !selectedChat.isNumberChange && (
                  <button
                    type="button"
                    onClick={handleMarkNotAutomation}
                    title={`${selectedChat.stateReason || "Robô ou autoatendimento detectado do outro lado"}. Clique se for uma pessoa: a conversa volta para a fila.`}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-[7px] border border-purple-300 bg-purple-50 px-[9px] py-[3px] text-xs font-semibold text-purple-700 hover:bg-purple-100 dark:border-purple-500/40 dark:bg-purple-500/10 dark:text-purple-200"
                  >
                    <Bot className="h-3 w-3" /> Automação · não é
                  </button>
                )}
                {isSelectedChatArchived && (
                  <button
                    type="button"
                    onClick={handleToggleArchive}
                    title="Conversa arquivada. Clique para desarquivar."
                    className="inline-flex cursor-pointer items-center gap-1 rounded-[7px] border border-border bg-card px-[9px] py-[3px] text-xs font-semibold text-foreground/80 hover:bg-muted"
                  >
                    <ArchiveRestore className="h-3 w-3" /> Arquivada · desarquivar
                  </button>
                )}
                {isSelectedChatAwaiting && (
                  <button
                    type="button"
                    onClick={handleMarkAsAttended}
                    title="Marcar atendimento concluído: a conversa sai de 'Esperam você' sem arquivar"
                    data-testid="chat-mark-attended"
                    className="inline-flex cursor-pointer items-center gap-1 rounded-[7px] border border-green-300 bg-green-50 px-[9px] py-[3px] text-xs font-semibold text-green-800 hover:bg-green-100 dark:border-green-500/40 dark:bg-green-500/10 dark:text-green-200"
                  >
                    <CheckCheck className="h-3 w-3" /> Marcar atendido
                  </button>
                )}
                {isSelectedChatAttended && !isSelectedChatAwaiting && (
                  <span
                    className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 dark:text-green-300"
                    title={selectedChat.attendedBy ? `Atendido por ${selectedChat.attendedBy}` : "Atendimento registrado"}
                  >
                    <CheckCheck className="h-3 w-3" /> Atendido
                  </span>
                )}

                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => setShowDossier((v) => !v)}
                  aria-expanded={dossierVisible}
                  data-testid="dossier-open"
                  className="inline-flex min-h-7 cursor-pointer items-center gap-1 text-xs font-bold text-indigo-600 hover:underline dark:text-indigo-300"
                >
                  Dossiê do lead
                  <ChevronRight className={cn("h-[13px] w-[13px] transition-transform", dossierVisible && "rotate-180")} />
                </button>
              </div>
            )}

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
                                "group relative rounded-lg shadow-xs transition-colors",
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
                              {/* Menu de Opções da Mensagem */}
                              {item.id && (
                                <div
                                  className={cn(
                                    "absolute top-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity",
                                    item.fromMe ? "right-1" : "right-1"
                                  )}
                                >
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        type="button"
                                        className={cn(
                                          "h-5 w-5 rounded-md flex items-center justify-center transition-colors cursor-pointer",
                                          item.fromMe
                                            ? "bg-emerald-700/80 hover:bg-emerald-700 text-white shadow-xs"
                                            : "bg-muted/80 hover:bg-muted text-muted-foreground hover:text-foreground shadow-xs"
                                        )}
                                        title="Opções da mensagem"
                                      >
                                        <ChevronDown className="h-3 w-3" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-44 text-xs">
                                      <DropdownMenuItem
                                        onClick={() => handleDeleteMessage(item.id, "me")}
                                        className="gap-2 cursor-pointer text-destructive focus:text-destructive"
                                      >
                                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                        <span>Apagar para mim</span>
                                      </DropdownMenuItem>
                                      {item.fromMe && (
                                        <DropdownMenuItem
                                          onClick={() => setMessageToDeleteForEveryone(item.id)}
                                          className="gap-2 cursor-pointer text-destructive focus:text-destructive"
                                        >
                                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                          <span>Apagar para todos</span>
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                </div>
                              )}
                              <MediaMessage
                                messageId={"waMessageId" in item && item.waMessageId ? item.waMessageId : item.id}
                                hasMedia={item.hasMedia || Boolean((item as any).media_url || (item as any).mediaUrl)}
                                fallbackBody={item.hasMedia ? item.body : describeMessageLabel(item.body)}
                                fromMe={item.fromMe}
                                clientId={clientId}
                                mediaUrl={(item as any).media_url || (item as any).mediaUrl || null}
                                contentType={(item as any).content_type || (item as any).contentType || null}
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
                                {Boolean((item as any).meta?.is_handoff_bridge) && (
                                  <span
                                    className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/30 text-indigo-100 flex items-center gap-0.5 font-semibold"
                                    title={
                                      (item as any).meta?.transferred_to_chip
                                        ? `Transferência para ${(item as any).meta.transferred_to_chip}`
                                        : "Transferência de chip iniciada"
                                    }
                                  >
                                    🤝 <span className="hidden sm:inline">Transferido</span>
                                  </span>
                                )}
                                {Boolean((item as any).meta?.is_handoff_opener) && (
                                  <span
                                    className="text-[9px] px-1.5 py-0.5 rounded-full bg-indigo-500/30 text-indigo-100 flex items-center gap-0.5 font-semibold"
                                    title={
                                      (item as any).meta?.transferred_from_chip
                                        ? `Atendimento assumido de ${(item as any).meta.transferred_from_chip}`
                                        : "Abertura pós-transferência"
                                    }
                                  >
                                    🤝 <span className="hidden sm:inline">Chip Fechador</span>
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
                <div className="absolute bottom-2 right-4 z-10">
                  <Button
                    size="sm"
                    variant={hasNewUnseenMessage ? "default" : "secondary"}
                    onClick={() => scrollToBottom("smooth")}
                    className={cn(
                      "h-8 gap-1.5 rounded-full text-xs font-semibold shadow-md transition-all",
                      hasNewUnseenMessage ? "px-3" : "w-8 px-0",
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
                        <span className="sr-only">Ir para as mensagens mais recentes</span>
                        <ChevronDown className="h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              )}
            </div>

            {/* Rodapé: um campo só, com o modo dentro dele */}
            <div className="border-t border-border/60 bg-card px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-5 md:pb-4 md:pt-3" data-testid="composer">
              <div
                data-mode={isNoteMode ? "note" : "whatsapp"}
                data-testid="composer-box"
                className={cn(
                  "overflow-hidden rounded-[14px] border shadow-xs transition-colors",
                  isNoteMode
                    ? "border-amber-300 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10"
                    : "border-indigo-200 bg-card dark:border-indigo-500/40"
                )}
              >
                <div className="flex flex-wrap items-center gap-1 px-2 pt-[7px]">
                  <button
                    type="button"
                    onClick={() => setCompositionMode("whatsapp")}
                    aria-pressed={!isNoteMode}
                    data-testid="composer-mode-whatsapp"
                    className={cn(
                      "flex min-h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-[11px] text-xs transition-colors",
                      !isNoteMode
                        ? "border-green-700 bg-green-600 font-bold text-white"
                        : "border-transparent font-semibold text-amber-900 hover:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-500/20"
                    )}
                  >
                    <MessageCircle className="h-[13px] w-[13px]" aria-hidden="true" />
                    WhatsApp
                  </button>
                  <button
                    type="button"
                    onClick={() => setCompositionMode("internal_note")}
                    aria-pressed={isNoteMode}
                    data-testid="composer-mode-note"
                    className={cn(
                      "flex min-h-7 cursor-pointer items-center gap-1.5 rounded-lg border px-[11px] text-xs transition-colors",
                      isNoteMode
                        ? "border-amber-800 bg-amber-700 font-bold text-white"
                        : "border-transparent font-semibold text-muted-foreground hover:bg-muted"
                    )}
                  >
                    <Lock className="h-[13px] w-[13px]" aria-hidden="true" />
                    Nota interna
                  </button>
                  <span className="flex-1" />
                  {isNoteMode ? (
                    <span className="pr-1 text-[11px] font-semibold text-amber-800 dark:text-amber-200" data-testid="composer-hint">
                      o cliente NÃO vê
                    </span>
                  ) : leadChipAlias && leadChipDown ? (
                    <span
                      className="pr-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
                      data-testid="composer-hint"
                      title="O chip em que o lead escreveu não está conectado. Ao enviar, você escolhe por qual chip a resposta sai. Nada é enviado sem a sua confirmação."
                    >
                      chip {leadChipName} desconectado · vai pedir confirmação
                    </span>
                  ) : leadChipAlias ? (
                    <span
                      className="pr-1 text-[11px] text-muted-foreground"
                      data-testid="composer-hint"
                      title="A resposta sai pelo mesmo chip em que o lead escreveu."
                    >
                      sai do chip <strong className="text-foreground/80">{leadChipName}</strong>
                    </span>
                  ) : chipKnownForTab && defaultChip ? (
                    <span
                      className="pr-1 text-[11px] text-muted-foreground"
                      data-testid="composer-hint"
                      title="Esta conversa não tem chip gravado. A resposta sai pelo chip padrão da empresa."
                    >
                      sai do chip <strong className="text-foreground/80">{defaultChip.name}</strong>
                    </span>
                  ) : (
                    <span
                      className="pr-1 text-[11px] text-muted-foreground"
                      data-testid="composer-hint"
                      title="A resposta sai pelo mesmo chip em que o lead escreveu. Se ele estiver desconectado, a tela pede confirmação antes de enviar por outro."
                    >
                      sai pelo chip da conversa
                    </span>
                  )}
                </div>

                {chipConfirm && chipConfirm.chatId === selectedChatId && (
                  <div
                    role="alertdialog"
                    aria-label="Confirmar o chip de envio"
                    data-testid="chip-confirm"
                    className="mx-2 mt-2 rounded-[10px] border border-amber-400 bg-amber-50 p-3 text-[12.5px] text-amber-950 dark:border-amber-500/50 dark:bg-amber-500/10 dark:text-amber-50"
                  >
                    <p className="font-bold">Mensagem não enviada</p>
                    <p className="mt-0.5">{chipConfirm.message}</p>
                    <p className="mt-1.5 truncate text-[12px] italic opacity-80" data-testid="chip-confirm-pending">
                      {chipConfirm.pending.kind === "text"
                        ? `“${chipConfirm.pending.body}”`
                        : `Anexo: ${chipConfirm.pending.params.fileName || chipConfirm.pending.params.mediaType}`}
                    </p>
                    {chipConfirm.alternatives.length === 0 && (
                      <p className="mt-1.5 font-semibold">Nenhum outro chip conectado. Reconecte o chip em Integrações para responder.</p>
                    )}
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {chipConfirm.alternatives.map((alt) => (
                        <button
                          key={alt.id}
                          type="button"
                          onClick={() => void handleConfirmChip(alt.id)}
                          disabled={isSending}
                          data-testid="chip-confirm-option"
                          className="min-h-11 cursor-pointer rounded-lg bg-amber-700 px-3 text-[12.5px] font-bold text-white hover:bg-amber-800 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Enviar pelo chip {alt.name}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={handleCancelChipConfirm}
                        disabled={isSending}
                        data-testid="chip-confirm-cancel"
                        className="min-h-11 cursor-pointer rounded-lg border border-amber-700/40 bg-transparent px-3 text-[12.5px] font-semibold hover:bg-amber-500/15"
                      >
                        Não enviar
                      </button>
                    </div>
                  </div>
                )}

                <label htmlFor="inbox-composer-text" className="sr-only">
                  {isNoteMode ? "Nota interna para a equipe" : "Mensagem para o cliente"}
                </label>
                <textarea
                  id="inbox-composer-text"
                  ref={chatTextareaRef}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={isMobile ? 1 : 2}
                  disabled={!selectedChat} // NÃO desabilita no isPending para nunca perder o foco!
                  placeholder={
                    isMobile
                      ? isNoteMode
                        ? "Anotação só para a equipe…"
                        : "Escreva para o cliente…"
                      : isNoteMode
                      ? "Anotação só para a equipe…  Enter salva"
                      : "Escreva para o cliente…  Enter envia, Shift+Enter quebra linha"
                  }
                  className={cn(
                    "block w-full resize-none border-0 bg-transparent px-3.5 pb-1 pt-2.5 font-sans text-base leading-normal outline-none disabled:cursor-not-allowed disabled:opacity-60 md:text-sm",
                    isNoteMode
                      ? "text-amber-950 placeholder:text-amber-800/80 dark:text-amber-50 dark:placeholder:text-amber-200/70"
                      : "text-foreground placeholder:text-muted-foreground"
                  )}
                />

                <div className="flex items-center gap-1 px-2 pb-2 pt-1">
                  {!isNoteMode && (
                    <>
                      <EmojiPicker
                        onSelect={handleInsertEmoji}
                        disabled={!selectedChat}
                        className="h-8 w-8 rounded-lg p-0 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        iconClassName="h-[17px] w-[17px]"
                      />
                      <button
                        type="button"
                        onClick={() => setAttachmentModalOpen(true)}
                        disabled={!selectedChat || isSending}
                        aria-label="Anexar arquivo"
                        title="Anexar mídia ou documento"
                        className="grid h-8 w-8 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Paperclip className="h-[17px] w-[17px]" />
                      </button>
                      <VoiceRecorderButton
                        onSendAudio={sendMediaGuarded}
                        disabled={!selectedChat || isSending}
                      />
                    </>
                  )}
                  <span className="flex-1" />
                  <button
                    type="button"
                    onClick={handleSendMessage}
                    disabled={!selectedChat || !draft.trim() || isSending}
                    data-testid="composer-send"
                    className={cn(
                      "flex min-h-9 cursor-pointer items-center gap-[7px] rounded-[10px] px-[18px] text-[13.5px] font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      isNoteMode ? "bg-amber-700 hover:bg-amber-800" : "bg-green-600 hover:bg-green-700"
                    )}
                  >
                    {isNoteMode ? "Salvar nota" : "Enviar"}
                    {isSending ? (
                      <LoaderCircle className="h-[15px] w-[15px] animate-spin" />
                    ) : !isNoteMode ? (
                      <Send className="h-[15px] w-[15px]" />
                    ) : null}
                  </button>
                </div>
              </div>
            </div>

            <MediaAttachmentModal
              open={attachmentModalOpen}
              onOpenChange={setAttachmentModalOpen}
              onSendMedia={sendMediaGuarded}
              disabled={!selectedChat || sendMediaMessage.isPending}
            />

            {/* Gaveta do dossiê: por cima da conversa, fechada por padrão */}
            {dossierVisible && !dossierAsColumn && (
              <>
                <button
                  type="button"
                  aria-label="Fechar o dossiê"
                  tabIndex={-1}
                  onClick={closeDossier}
                  data-testid="dossier-backdrop"
                  className="absolute inset-0 z-20 cursor-default bg-slate-900/10"
                />
                <div
                  data-testid="dossier-drawer"
                  className="absolute inset-y-0 right-0 z-30 w-full border-indigo-200 shadow-2xl animate-in slide-in-from-right-4 duration-150 dark:border-indigo-500/40 md:max-w-[340px] md:border-l"
                >
                  {dossierPanel}
                </div>
              </>
            )}
          </section>

          {/* Dossiê fixado: terceira coluna, só em tela larga e só porque a pessoa pediu */}
          {dossierVisible && dossierAsColumn && (
            <aside data-testid="dossier-pinned" className="min-h-0 w-[320px] shrink-0 border-l border-border/80">
              {dossierPanel}
            </aside>
          )}
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

      <EditFollowupScheduleModal
        open={isEditScheduleModalOpen}
        onOpenChange={setIsEditScheduleModalOpen}
        item={activeSchedule}
      />

      <CreateLeadReminderModal
        open={isCreateReminderModalOpen}
        onOpenChange={(open) => {
          setIsCreateReminderModalOpen(open);
          if (!open) setEditingReminder(null);
        }}
        lead={{
          id: matchedLead?.id,
          nome: matchedLead?.nome || selectedChat?.name || "Lead",
          phone: rawPhone,
        }}
        clientId={clientId}
        operatorOptions={operatorOptions}
        initialReminder={editingReminder}
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

      {/* Modal de Agendamento de Call / Google Meet */}
      <ScheduleMeetingModal
        open={isScheduleMeetingModalOpen}
        onOpenChange={(open) => {
          setIsScheduleMeetingModalOpen(open);
          if (!open) setActiveMeetingToEdit(null);
        }}
        lead={{
          id: matchedLead?.id,
          nome: matchedLead?.nome || selectedChat?.name || "Lead",
          phone: rawPhone,
        }}
        clientId={clientId}
        onSendWhatsappInvite={(text) => {
          setDraft(text);
        }}
        initialMeeting={activeMeetingToEdit}
      />

      {/* Modal de Registro de Ligação Telefônica */}
      <RegisterCallModal
        open={isRegisterCallModalOpen}
        onOpenChange={setIsRegisterCallModalOpen}
        lead={{
          id: matchedLead?.id,
          nome: matchedLead?.nome || selectedChat?.name || "Lead",
          phone: rawPhone,
        }}
        clientId={clientId}
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

      {/* Modal de Confirmação para Apagar Mensagem para Todos */}
      <AlertDialog
        open={Boolean(messageToDeleteForEveryone)}
        onOpenChange={(open) => !open && setMessageToDeleteForEveryone(null)}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-base">
              <Trash2 className="h-5 w-5 text-destructive" />
              Apagar mensagem para todos?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed">
              Esta mensagem será apagada para todos os participantes da conversa no WhatsApp e removida do histórico do Vexo OS.
              <br />
              <span className="text-foreground font-medium mt-1.5 block">
                Esta ação não pode ser desfeita. A Evolution API só permite apagar mensagens enviadas recentemente (janela padrão de 48h).
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel
              disabled={deleteMessageMutation.isPending}
              className="h-8 text-xs rounded-xl"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMessageMutation.isPending}
              onClick={async (e) => {
                e.preventDefault();
                if (!messageToDeleteForEveryone) return;
                const id = messageToDeleteForEveryone;
                setMessageToDeleteForEveryone(null);
                await handleDeleteMessage(id, "everyone");
              }}
              className="h-8 text-xs rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground cursor-pointer"
            >
              {deleteMessageMutation.isPending ? "Apagando..." : "Apagar para todos"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal de Confirmação para Limpar Conversa */}
      <AlertDialog
        open={Boolean(chatToClear)}
        onOpenChange={(open) => !open && setChatToClear(null)}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-base">
              <Trash2 className="h-5 w-5 text-destructive" />
              Limpar histórico da conversa?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs text-muted-foreground leading-relaxed">
              As mensagens anteriores serão ocultadas apenas da sua tela de atendimento no Vexo OS.
              <br />
              <span className="text-foreground font-medium mt-1.5 block">
                O histórico continua intacto no banco de dados e no celular do cliente. Novas mensagens continuarão chegando normalmente.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel
              disabled={clearChatMutation.isPending}
              className="h-8 text-xs rounded-xl"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={clearChatMutation.isPending}
              onClick={async (e) => {
                e.preventDefault();
                await handleConfirmClearChat();
              }}
              className="h-8 text-xs rounded-xl bg-destructive hover:bg-destructive/90 text-destructive-foreground cursor-pointer"
            >
              {clearChatMutation.isPending ? "Limpando..." : "Sim, Limpar Conversa"}
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
