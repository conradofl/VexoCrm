import { useEffect, useMemo, useState, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Database,
  Upload,
  Download,
  RefreshCw,
  Search,
  MessageCircle,
  Clock,
  Sparkles,
  UserCheck,
  AlertCircle,
  Plus,
  FileSpreadsheet,
  Flame,
  Sun,
  Snowflake,
  Settings,
  Rocket,
  CalendarClock,
  Trash2,
  Tag as TagIcon,
  X,
  FileText,
  Filter,
  CheckCircle2,
  XCircle,
  ChevronDown,
  Lock,
  Target,
  Puzzle,
  Bot,
  RotateCcw,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { useUpdateLeadClientTicketMedio } from "@/hooks/useLeadClients";
import { calculateBasePotential } from "@/lib/leads/basePotential";
import { API_BASE_URL, fetchApi, readApiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { resolveTenantPlan, hasFeatureUnlocked } from "@/lib/planTier";
import { sanitizePhone } from "@/lib/phone";
import ApplyFollowupModal from "@/components/followup/ApplyFollowupModal";
import { SingleFollowupReminderModal } from "@/components/followup/SingleFollowupReminderModal";
import { PageShell } from "@/components/PageShell";
import { UpsellCard } from "@/components/UpsellCard";
import { SectionHeader } from "@/components/SectionHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { parseSpreadsheetFile, detectSpreadsheetColumns } from "@/lib/leadImports/spreadsheet";
import { toast } from "sonner";

export interface LeadIntelligenceItem {
  id: string;
  client_id: string;
  telefone: string;
  phone?: string | null;
  nome: string | null;
  stage?: "buyer" | "open_budget" | "inquiry" | "cold" | "lost" | null;
  stage_source?: "manual" | "auto" | "integration" | null;
  lost_reason?: string | null;
  potential_contract_value?: number | null;
  temperature?: "hot" | "warm" | "cold" | null;
  tags?: string[] | null;
  assigned_to?: string | null;
  last_interaction_at?: string | null;
  extracted_from_wa?: boolean | null;
  raw_chat_summary?: string | null;
  created_at: string;
  updated_at?: string;
  [key: string]: any;
}

export const LOST_REASONS = [
  { id: "preco", label: "Preço elevado / fora do orçamento" },
  { id: "prazo", label: "Prazo de entrega / atendimento" },
  { id: "comprou_outro", label: "Comprou de outro fornecedor" },
  { id: "sumiu", label: "Sumiu / Não respondeu mais" },
  { id: "perfil", label: "Não era o perfil do produto" },
  { id: "outro", label: "Outro motivo" },
];

export interface SummaryStats {
  totalLeads: number;
  buyersCount: number;
  lostCount?: number;
  openBudgetsCount: number;
  inNegotiationCount?: number;
  inConversationCount?: number;
  neverContactedCount?: number;
  activeLeadsCount?: number;
  estimatedRevenue: number;
}

export interface EvolutionInstanceItem {
  id: string;
  name: string;
  active: boolean;
  is_default: boolean;
}

export interface DynamicFilterRule {
  id: string;
  column: string;
  operator: "equals" | "contains" | "gt" | "lt";
  value: string;
}

// Definições de Canais de Marketing para Atribuição e Disparos
export const MARKETING_CHANNELS = [
  {
    id: "instagram",
    name: "Instagram",
    icon: "📸",
    activeBorder: "border-pink-500 ring-2 ring-pink-500/30 bg-pink-500/10 shadow-sm",
    badgeClass: "bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/30",
  },
  {
    id: "google",
    name: "Google Ads",
    icon: "🔍",
    activeBorder: "border-blue-500 ring-2 ring-blue-500/30 bg-blue-500/10 shadow-sm",
    badgeClass: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  },
  {
    id: "facebook",
    name: "Facebook Ads",
    icon: "📘",
    activeBorder: "border-indigo-500 ring-2 ring-indigo-500/30 bg-indigo-500/10 shadow-sm",
    badgeClass: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
  },
  {
    id: "tiktok",
    name: "TikTok",
    icon: "🎵",
    activeBorder: "border-zinc-500 ring-2 ring-zinc-500/30 bg-zinc-500/10 shadow-sm",
    badgeClass: "bg-zinc-500/15 text-zinc-800 dark:text-zinc-200 border-zinc-500/30",
  },
  {
    id: "indicacao",
    name: "Indicação",
    icon: "🤝",
    activeBorder: "border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-500/10 shadow-sm",
    badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  },
  {
    id: "whatsapp_outros",
    name: "WhatsApp / Outros",
    icon: "💬",
    activeBorder: "border-purple-500 ring-2 ring-purple-500/30 bg-purple-500/10 shadow-sm",
    badgeClass: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
  },
];

export const CANONICAL_LEAD_SOURCES: Record<string, { label: string; badgeClass: string; icon: string }> = {
  campanha: { label: "Campanha", badgeClass: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30", icon: "📢" },
  organico: { label: "Orgânico", badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", icon: "🌱" },
  trafego_pago: { label: "Tráfego Pago", badgeClass: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30", icon: "🎯" },
  whatsapp_ads: { label: "WhatsApp Ads", badgeClass: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30", icon: "📱" },
  indicacao: { label: "Indicação", badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", icon: "🤝" },
  extracao_whatsapp: { label: "Extração WhatsApp", badgeClass: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30", icon: "💬" },
  outro: { label: "Outro", badgeClass: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30", icon: "🌐" },
  instagram: { label: "Instagram", badgeClass: "bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/30", icon: "📸" },
  "google ads": { label: "Google Ads", badgeClass: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30", icon: "🔍" },
  "facebook ads": { label: "Facebook Ads", badgeClass: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30", icon: "📘" },
  tiktok: { label: "TikTok", badgeClass: "bg-zinc-500/15 text-zinc-900 dark:text-zinc-100 border-zinc-500/30", icon: "🎵" },
};

export function getLeadSource(lead?: LeadIntelligenceItem | null): string {
  if (!lead) return "Não informado";
  if (Array.isArray(lead.tags)) {
    if (lead.tags.some((t) => /instagram/i.test(t))) return "Instagram Direct";
    if (lead.tags.some((t) => /facebook|messenger/i.test(t))) return "Facebook Messenger";
    if (lead.tags.some((t) => /tiktok/i.test(t))) return "TikTok";
    if (lead.tags.some((t) => /linkedin/i.test(t))) return "LinkedIn";
  }
  return lead.lead_source || lead.dados?.origem_marketing || lead.dados?.origem || lead.origem || "Não informado";
}

export function getLeadMarketingChannelId(lead?: LeadIntelligenceItem | null): string {
  const s = (getLeadSource(lead) || "").toLowerCase().trim();
  if (s === "instagram" || s.startsWith("insta")) return "instagram";
  if (s === "google ads" || s.includes("google") || s.includes("gads") || s.includes("pesquisa")) return "google";
  if (s === "facebook ads" || s.includes("facebook") || s.includes("face") || s.includes("messenger")) return "facebook";
  if (s === "tiktok" || s.includes("tiktok") || s.startsWith("tt")) return "tiktok";
  if (s === "indicacao" || s.includes("indica") || s.includes("amigo") || s.includes("referral")) return "indicacao";
  return "whatsapp_outros";
}

export function renderSourceBadge(sourceKey?: string | null) {
  const key = String(sourceKey || "").trim().toLowerCase();
  if (!key || key === "não informado" || key === "nao informado") {
    return (
      <Badge variant="outline" className="text-slate-500 dark:text-slate-400 text-[11px]">
        Origem desconhecida
      </Badge>
    );
  }
  const config = CANONICAL_LEAD_SOURCES[key];
  if (config) {
    return (
      <Badge className={config.badgeClass}>
        {config.icon} {config.label}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-slate-500 dark:text-slate-400 text-[11px]">
      {sourceKey}
    </Badge>
  );
}

export default function BancoDeDados() {
  const navigate = useNavigate();
  const { isAuthenticated, getIdToken, isAdminUser, canAccessInternalPage } = useAuth();
  const canManageUsers = isAdminUser || canAccessInternalPage("usuarios");
  const crmClient = useOptionalCrmClient();
  // Usa selectedClientId (string, sempre setado pelo seletor de tenant do topo).
  // Antes usava selectedClient?.id, que fica null quando o objeto ainda não
  // resolveu na lista, caindo no fallback "infinie" (cliente removido) — o que
  // fazia instâncias e leads virem vazios nesta página.
  const clientId = crmClient?.selectedClientId || crmClient?.selectedClient?.id || "geracao-digital";

  const adminUsersQuery = useAdminUsers();
  const operatorOptions = useMemo(() => {
    if (!adminUsersQuery.data) return [];
    return adminUsersQuery.data.filter(
      (u) =>
        u.access?.role === "internal" &&
        (!clientId || u.access.clientId === clientId || u.access.clientIds?.includes(clientId))
    );
  }, [adminUsersQuery.data, clientId]);
  const isAdvancedOriginsUnlocked =
    hasFeatureUnlocked(crmClient?.selectedClient, "origem_leads") ||
    resolveTenantPlan(crmClient?.selectedClient) === "avancado";
  const isAdvancedPlan =
    resolveTenantPlan(crmClient?.selectedClient) === "avancado" ||
    hasFeatureUnlocked(crmClient?.selectedClient, "extracao_ilimitada");

  // Main Data States
  const [leads, setLeads] = useState<LeadIntelligenceItem[]>([]);
  const [summary, setSummary] = useState<SummaryStats>({
    totalLeads: 0,
    buyersCount: 0,
    lostCount: 0,
    openBudgetsCount: 0,
    inNegotiationCount: 0,
    inConversationCount: 0,
    neverContactedCount: 0,
    activeLeadsCount: 0,
    estimatedRevenue: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Ticket Médio Config (fonte de verdade: banco de dados via selectedClient)
  const selectedClient = crmClient?.selectedClient;
  const updateTicketMedioMutation = useUpdateLeadClientTicketMedio();
  const ticketMedio = selectedClient?.ticket_medio != null ? Number(selectedClient.ticket_medio) : null;
  const [isTicketModalOpen, setIsTicketModalOpen] = useState(false);
  const [tempTicketInput, setTempTicketInput] = useState("");
  const [isOriginUpsellModalOpen, setIsOriginUpsellModalOpen] = useState(false);
  const [upsellWhatsappNumber, setUpsellWhatsappNumber] = useState("5511999999999");

  // Evolution Instances for WA Extractor
  const [evolutionInstances, setEvolutionInstances] = useState<EvolutionInstanceItem[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string>("");

  const [searchParams, setSearchParams] = useSearchParams();

  // Mapeia apelidos de abas vindos da URL para os estágios reais do banco
  const normalizeStageTab = (rawTab: string | null): string => {
    if (!rawTab) return "all";
    const t = rawTab.toLowerCase().trim();
    if (["open_budget", "orcamentos", "orcamento", "qualificados", "qualificado", "proposta"].includes(t)) {
      return "open_budget";
    }
    if (["buyer", "clientes", "cliente", "fechados", "fechado", "vendas"].includes(t)) {
      return "buyer";
    }
    if (["cold", "frios", "frio"].includes(t)) {
      return "cold";
    }
    if (["lost", "perdidos", "perdido"].includes(t)) {
      return "lost";
    }
    return "all";
  };

  // Filters & Tabs
  const [activeTab, setActiveTab] = useState<string>(() => normalizeStageTab(searchParams.get("tab")));
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string>("");
  const [selectedSource, setSelectedSource] = useState<string>("");
  const [selectedChannel, setSelectedChannel] = useState<string>("all");
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [knownSources, setKnownSources] = useState<string[]>([]);

  // Sincroniza activeTab quando o parâmetro da URL mudar
  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab) {
      const normalized = normalizeStageTab(urlTab);
      setActiveTab(normalized);
    }
  }, [searchParams]);

  // Acumula tags e origens conhecidas da base para não sumirem ao filtrar
  useEffect(() => {
    if (leads.length > 0) {
      setKnownTags((prev) => {
        const set = new Set(prev);
        leads.forEach((l) => {
          if (Array.isArray(l.tags)) l.tags.forEach((t) => set.add(t));
        });
        return Array.from(set).sort();
      });
      setKnownSources((prev) => {
        const set = new Set(prev);
        leads.forEach((l) => {
          const src = getLeadSource(l);
          if (src && src !== "Não informado") set.add(src);
        });
        return Array.from(set).sort();
      });
    }
  }, [leads]);

  // Pagination State
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // WhatsApp Extraction Modal State
  const [isWAModalOpen, setIsWAModalOpen] = useState(false);
  const [waChatLimit, setWaChatLimit] = useState<number | "all">(100);
  const [isExtractingWA, setIsExtractingWA] = useState(false);
  const [waExtractStep, setWaExtractStep] = useState<string>("");

  // Import Modal State (Excel .xlsx/.xls + CSV)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDefaultDdd, setImportDefaultDdd] = useState<string>("34");
  const [importRawRows, setImportRawRows] = useState<Record<string, unknown>[]>([]);
  const [importMapping, setImportMapping] = useState<{ telefone: string | null; nome: string | null }>({ telefone: null, nome: null });
  const [showImportAuditModal, setShowImportAuditModal] = useState(false);
  const [importTagInput, setImportTagInput] = useState<string>("");
  const [importParsedRows, setImportParsedRows] = useState<Record<string, unknown>[]>([]);
  const [importSanitizePreview, setImportSanitizePreview] = useState<{ validCount: number; invalidCount: number }>({
    validCount: 0,
    invalidCount: 0,
  });
  const [importAuditStats, setImportAuditStats] = useState<{
    total: number;
    valid: number;
    intactCount: number;
    completedCount: number;
    incompleteCount: number;
    completedList: Array<{ original: string; result: string }>;
    incompleteList: Array<{ original: string; reason: string }>;
  }>({
    total: 0,
    valid: 0,
    intactCount: 0,
    completedCount: 0,
    incompleteCount: 0,
    completedList: [],
    incompleteList: [],
  });
  const [isUploadingImport, setIsUploadingImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // AI Importer State (Instagram Direct / Chat / Texto)
  const [isAIImportModalOpen, setIsAIImportModalOpen] = useState(false);
  const [aiRawText, setAiRawText] = useState("");
  const [aiDefaultOrigin, setAiDefaultOrigin] = useState("Instagram Direct");
  const [aiStep, setAiStep] = useState<1 | 2>(1);
  const [aiExtractedLeads, setAiExtractedLeads] = useState<{
    nome: string;
    telefone: string | null;
    email: string | null;
    origem: string;
    interesse: string;
    temperatura: "Quente" | "Morno" | "Frio";
    valor_estimado: number | null;
  }[]>([]);
  const [isAiAnalyzing, setIsAiAnalyzing] = useState(false);
  const [isAiSaving, setIsAiSaving] = useState(false);

  // Create Manual Lead State
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isFollowupModalOpen, setIsFollowupModalOpen] = useState(false);
  const [isSingleReminderModalOpen, setIsSingleReminderModalOpen] = useState(false);
  const [newLeadName, setNewLeadName] = useState("");
  const [newLeadPhone, setNewLeadPhone] = useState("");
  const [newLeadStage, setNewLeadStage] = useState<"buyer" | "open_budget" | "inquiry" | "cold" | "lost">("cold");
  const [newLeadTemp, setNewLeadTemp] = useState<"hot" | "warm" | "cold">("warm");
  const [newLeadTags, setNewLeadTags] = useState("");

  // Lead Detail Sheet (Slide-Over Drawer)
  const [selectedLead, setSelectedLead] = useState<LeadIntelligenceItem | null>(null);
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);
  const [newTagInput, setNewTagInput] = useState("");

  // Bulk Selection (Ações em Lote)
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [isBulkStageModalOpen, setIsBulkStageModalOpen] = useState(false);
  const [bulkStageValue, setBulkStageValue] = useState<"buyer" | "open_budget" | "inquiry" | "cold" | "lost">("cold");
  const [bulkContractValue, setBulkContractValue] = useState("");
  const [bulkLostReason, setBulkLostReason] = useState("preco");
  const [isBulkTagModalOpen, setIsBulkTagModalOpen] = useState(false);
  const [bulkTagValue, setBulkTagValue] = useState("");
  const [isBulkAssignModalOpen, setIsBulkAssignModalOpen] = useState(false);
  const [bulkAssignValue, setBulkAssignValue] = useState<string>("none");

  // Modais dedicados: Marcar como Cliente e Marcar como Perdido
  const [isMarkAsClientModalOpen, setIsMarkAsClientModalOpen] = useState(false);
  const [markAsClientTarget, setMarkAsClientTarget] = useState<{ type: "single"; leadId: string } | { type: "bulk"; leadIds: string[] } | null>(null);
  const [markAsClientValue, setMarkAsClientValue] = useState("");

  const [isMarkAsLostModalOpen, setIsMarkAsLostModalOpen] = useState(false);
  const [markAsLostTarget, setMarkAsLostTarget] = useState<{ type: "single"; leadId: string } | { type: "bulk"; leadIds: string[] } | null>(null);
  const [markAsLostReason, setMarkAsLostReason] = useState("preco");

  // Campaign Creation Wizard Modal State
  const [isCampaignWizardOpen, setIsCampaignWizardOpen] = useState(false);
  const [campaignSourceType, setCampaignSourceType] = useState<"funnel" | "spreadsheet">("funnel");
  
  // Funnel Audience Selection State
  const [campaignStageFilters, setCampaignStageFilters] = useState<string[]>(["all"]);
  const [campaignTagFilter, setCampaignTagFilter] = useState<string>("");
  const [campaignSelectedLeadIds, setCampaignSelectedLeadIds] = useState<string[]>([]);
  const [campaignFunnelFilterRules, setCampaignFunnelFilterRules] = useState<DynamicFilterRule[]>([]);

  // Spreadsheet Audience Selection State
  const [campaignFile, setCampaignFile] = useState<File | null>(null);
  const [campaignSpreadsheetRows, setCampaignSpreadsheetRows] = useState<Record<string, unknown>[]>([]);
  const [campaignSpreadsheetColumns, setCampaignSpreadsheetColumns] = useState<string[]>([]);
  const [campaignSpreadsheetRules, setCampaignSpreadsheetRules] = useState<DynamicFilterRule[]>([]);
  const campaignFileInputRef = useRef<HTMLInputElement>(null);

  // Fetch Leads List & Aggregations
  const fetchLeads = async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getIdToken();
      if (!token) throw new Error("Usuário não autenticado.");

      const params = new URLSearchParams({ clientId });
      if (activeTab !== "all") params.append("stage", activeTab);
      if (searchQuery.trim()) params.append("search", searchQuery.trim());
      if (selectedTag) params.append("tag", selectedTag);

      const res = await fetch(`${API_BASE_URL}/api/leads?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Erro na API (${res.status}): ${text}`);
      }

      const data = await res.json();
      const fetchedItems = Array.isArray(data.items) ? data.items : [];
      setLeads(fetchedItems);
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (err: any) {
      console.error("[BancoDeDados] Erro ao carregar base:", err);
      setError(err.message || "Falha ao carregar leads.");
    } finally {
      setLoading(false);
    }
  };

  // Fetch Available Evolution Instances for Tenant
  const fetchEvolutionInstances = async () => {
    if (!isAuthenticated) return;
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/lead-clients/${clientId}/evolution-instances`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        const items = Array.isArray(data.items) ? data.items : [];
        setEvolutionInstances(items);
        const defaultInst = items.find((i: any) => i.is_default) || items[0];
        if (defaultInst) {
          setSelectedInstanceId(defaultInst.id);
        }
      }
    } catch (e) {
      console.warn("[BancoDeDados] Instâncias Evolution não carregadas:", e);
    }
  };

  useEffect(() => {
    fetchLeads();
  }, [clientId, activeTab, selectedTag]);

  // Auto-localiza e abre o Drawer do lead quando navegado a partir de Ações Rápidas (Conversas)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetLeadId = params.get("leadId");
    const targetPhone = params.get("phone");
    const targetCanonical = targetPhone ? sanitizePhone(targetPhone) : null;

    if (!targetLeadId && !targetCanonical) return;

    if (
      selectedLead &&
      (selectedLead.id === targetLeadId ||
        (targetCanonical && sanitizePhone(selectedLead.telefone || selectedLead.phone) === targetCanonical))
    ) {
      return;
    }

    if (leads.length > 0) {
      const match = leads.find((l) => {
        if (targetLeadId && l.id === targetLeadId) return true;
        if (targetCanonical) {
          const lCanonical = sanitizePhone(l.telefone || l.phone);
          return Boolean(lCanonical && lCanonical === targetCanonical);
        }
        return false;
      });

      if (match) {
        setSelectedLead(match);
        setIsDetailSheetOpen(true);
      }
    }
  }, [leads, selectedLead]);

  // Reseta seleções, drawer de detalhes e modais ao alternar de empresa (tenant)
  useEffect(() => {
    setSelectedLeadIds([]);
    setSelectedLead(null);
    setIsDetailSheetOpen(false);
    setCampaignSelectedLeadIds([]);
    setAiExtractedLeads([]);
    setIsAIImportModalOpen(false);
    setIsCreateModalOpen(false);
    setIsFollowupModalOpen(false);
  }, [clientId]);

  useEffect(() => {
    fetchEvolutionInstances();
  }, [clientId]);

  useEffect(() => {
    async function loadUpsellSettings() {
      try {
        const token = await getIdToken();
        if (!token) return;
        const res = await fetch(`${API_BASE_URL}/api/system/settings`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.upsellWhatsappNumber) {
            setUpsellWhatsappNumber(data.upsellWhatsappNumber);
          }
        }
      } catch (e) {
        // Fallback default
      }
    }
    loadUpsellSettings();
  }, [getIdToken]);

  const cleanUpsellPhone = (upsellWhatsappNumber || "5511999999999").replace(/\D/g, "");
  const whatsappUrlUpgrade = `https://wa.me/${cleanUpsellPhone}?text=${encodeURIComponent(
    "Olá! Gostaria de fazer o upgrade para o Plano Avançado para desbloquear a Atribuição de Origens de Marketing no Banco de Dados."
  )}`;
  const whatsappUrlAvulso = `https://wa.me/${cleanUpsellPhone}?text=${encodeURIComponent(
    "Olá! Gostaria de adquirir o módulo avulso de Origem de Leads no Banco de Dados."
  )}`;

  // Handle WhatsApp Extraction Execution
  const handleExtractWA = async () => {
    if (waChatLimit === "all" && !isAdvancedPlan) {
      toast.info("A extração ilimitada de contatos é exclusiva do Plano Avançado. No Plano Essencial o limite é de até 500 contatos.");
      setWaChatLimit(500);
      return;
    }

    setIsExtractingWA(true);
    setWaExtractStep("Conectando à Evolution API...");

    try {
      const token = await getIdToken();
      
      setTimeout(() => {
        setWaExtractStep("Buscando mensagens recentes e minerando contatos...");
      }, 1500);

      setTimeout(() => {
        setWaExtractStep("Classificando conversas com IA semântica...");
      }, 3500);

      const res = await fetch(`${API_BASE_URL}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          instanceId: selectedInstanceId || undefined,
          chatLimit: waChatLimit,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || data.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      toast.success(`Extração Semântica Concluída! 🎉`, {
        description: `${data.extractedCount || 0} contatos minerados e enriquecidos com IA.`,
      });

      setIsWAModalOpen(false);
      fetchLeads();
    } catch (err: any) {
      console.error("[BancoDeDados] Erro na extração WA:", err);
      toast.error("Falha ao extrair contatos do WhatsApp", {
        description: err.message || "Verifique se a instância da Evolution API está conectada.",
      });
    } finally {
      setIsExtractingWA(false);
      setWaExtractStep("");
    }
  };

  const recalculateImportStats = (rows: Record<string, unknown>[], mapping: { telefone: string | null; nome: string | null }, ddd: string) => {
    const cleanDdd = ddd ? ddd.replace(/\D/g, "").slice(0, 2) : null;
    let intactCount = 0;
    let completedCount = 0;
    let incompleteCount = 0;
    const completedList: Array<{ original: string; result: string }> = [];
    const incompleteList: Array<{ original: string; reason: string }> = [];

    const normalizedRows = rows.map((row) => {
      const newRow: Record<string, unknown> = { ...row };
      const rawPhone = String(row[mapping.telefone || "telefone"] || row.phone || row.celular || row.whatsapp || "").trim();
      const rawDigits = rawPhone.replace(/\D/g, "");
      const sanitized = sanitizePhone(rawPhone, cleanDdd);

      if (sanitized) {
        newRow.telefone = sanitized.startsWith("+") ? sanitized : `+${sanitized}`;
        const isAlreadyComplete =
          (rawDigits.length === 12 && rawDigits.startsWith("55") && sanitized === rawDigits) ||
          (rawDigits.length === 13 && rawDigits.startsWith("55") && sanitized === rawDigits) ||
          (rawDigits.length >= 10 && rawDigits.length < 15 && !rawDigits.startsWith("55") && sanitized === rawDigits);

        if (isAlreadyComplete) {
          intactCount++;
        } else {
          completedCount++;
          if (completedList.length < 500) {
            completedList.push({ original: rawPhone, result: newRow.telefone as string });
          }
        }
      } else {
        incompleteCount++;
        let reason = "Formato inválido";
        if (rawDigits.length === 8 || rawDigits.length === 9) {
          reason = cleanDdd ? "Telefone incompleto" : "Faltou informar o DDD padrão";
        } else if (rawDigits.length >= 15 || rawPhone.includes("@g.us")) {
          reason = "Identificador de grupo do WhatsApp bloqueado";
        } else if (!rawDigits) {
          reason = "Sem telefone";
        }
        if (incompleteList.length < 500) {
          incompleteList.push({ original: rawPhone || "(vazio)", reason });
        }
      }

      if (mapping.nome && row[mapping.nome]) {
        newRow.nome = String(row[mapping.nome]).trim();
      }
      return newRow;
    });

    setImportParsedRows(normalizedRows.filter((r) => !!r.telefone));
    setImportSanitizePreview({ validCount: intactCount + completedCount, invalidCount: incompleteCount });
    setImportAuditStats({
      total: rows.length,
      valid: intactCount + completedCount,
      intactCount,
      completedCount,
      incompleteCount,
      completedList,
      incompleteList,
    });
  };

  const handleDefaultDddChange = (newDdd: string) => {
    const clean = newDdd.replace(/\D/g, "").slice(0, 2);
    setImportDefaultDdd(clean);
    if (importRawRows.length > 0) {
      recalculateImportStats(importRawRows, importMapping, clean);
    }
  };

  // Parse Excel (.xlsx, .xls) or CSV File for Import
  const handleImportFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);

    const cleanFileName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    const autoTag = `#Imp-${cleanFileName}`;
    setImportTagInput(autoTag);

    try {
      const rows = await parseSpreadsheetFile(file);
      const mapping = detectSpreadsheetColumns(rows);
      setImportRawRows(rows);
      setImportMapping(mapping);
      recalculateImportStats(rows, mapping, importDefaultDdd);
    } catch (err: any) {
      toast.error("Erro ao ler arquivo da planilha", { description: err.message || "Formato não suportado." });
    }
  };

  // Submit Import (CSV / Excel)
  const handleImportSubmit = async () => {
    if (!importParsedRows || importParsedRows.length === 0) {
      toast.error("Nenhum contato válido encontrado na planilha.");
      return;
    }

    setIsUploadingImport(true);
    try {
      const token = await getIdToken();
      const importTags = importTagInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await fetch(`${API_BASE_URL}/api/leads/import-csv`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          rows: importParsedRows,
          importTags,
          defaultDdd: importDefaultDdd || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Falha ao importar planilha.");
      }

      const data = await res.json();
      toast.success("Planilha higienizada e importada com sucesso! 🎉", {
        description: `${data.importedCount || 0} leads inseridos com a tag "${importTagInput}".`,
      });

      setIsImportModalOpen(false);
      setImportFile(null);
      setImportParsedRows([]);
      setImportRawRows([]);
      fetchLeads();
    } catch (err: any) {
      toast.error("Erro na importação da planilha", { description: err.message });
    } finally {
      setIsUploadingImport(false);
    }
  };

  // Extração e Análise Semântica de Conversas com IA
  const handleAnalyzeWithAI = async () => {
    if (!aiRawText.trim()) {
      toast.error("Por favor, cole o texto ou conversa para análise.");
      return;
    }

    setIsAiAnalyzing(true);
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/leads/ai-extract`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          rawText: aiRawText.trim(),
          defaultOrigin: aiDefaultOrigin,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data?.error?.message || data?.message || "Falha na análise com IA.");
      }

      if (!Array.isArray(data.leads) || data.leads.length === 0) {
        toast.warning("Nenhum contato identificado no texto. Verifique se o texto contém nomes e contatos.");
        return;
      }

      setAiExtractedLeads(data.leads);
      setAiStep(2);
      toast.success(`${data.leads.length} contato(s) identificado(s) pela IA!`);
    } catch (err: any) {
      toast.error("Erro ao analisar texto com IA", { description: err.message });
    } finally {
      setIsAiAnalyzing(false);
    }
  };

  const handleSaveAiLeads = async () => {
    if (aiExtractedLeads.length === 0) {
      toast.error("Nenhum contato para salvar.");
      return;
    }

    setIsAiSaving(true);
    try {
      const token = await getIdToken();
      const rowsToSave = aiExtractedLeads.map((lead) => ({
        nome: lead.nome,
        telefone: lead.telefone || "",
        phone: lead.telefone || "",
        email: lead.email || "",
        stage: lead.temperatura === "Quente" ? "open_budget" : lead.temperatura === "Frio" ? "cold" : "inquiry",
        temperature: lead.temperatura === "Quente" ? "hot" : lead.temperatura === "Frio" ? "cold" : "warm",
        tags: [lead.origem, lead.interesse ? `Interesse: ${lead.interesse}` : ""].filter(Boolean),
      }));

      const res = await fetch(`${API_BASE_URL}/api/leads/import-csv`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          rows: rowsToSave,
          importTags: ["IA Direct/Chat"],
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message || "Erro ao salvar contatos.");
      }

      toast.success(`${rowsToSave.length} contato(s) salvos no Banco de Dados com sucesso!`);
      setIsAIImportModalOpen(false);
      setAiRawText("");
      setAiExtractedLeads([]);
      setAiStep(1);
      fetchLeads();
    } catch (err: any) {
      toast.error("Falha ao salvar contatos", { description: err.message });
    } finally {
      setIsAiSaving(false);
    }
  };

  // Save Ticket Médio no banco de dados (public.leads_clients)
  const handleSaveTicketMedio = async () => {
    const rawDigits = tempTicketInput.trim().replace(/\D/g, "");
    if (!rawDigits) {
      toast.error("Informe um valor válido para o ticket médio.");
      return;
    }
    const val = Number(rawDigits);
    if (val <= 0) {
      toast.error("O ticket médio deve ser maior que zero.");
      return;
    }

    try {
      await updateTicketMedioMutation.mutateAsync({
        tenantId: clientId,
        ticketMedio: val,
      });
      try {
        localStorage.removeItem(`vexo_ticket_medio_${clientId}`);
      } catch {
        // noop
      }
      toast.success("Ticket Médio atualizado com sucesso!", {
        description: `Novo valor: ${val.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
      });
      setIsTicketModalOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "Erro ao salvar ticket médio no banco.");
    }
  };

  // Export Leads (Excel .xlsx)
  const handleExportXLSX = () => {
    try {
      const exportData = filteredLeads.map((l) => ({
        "ID": l.id,
        "Nome": l.nome || "",
        "Telefone (E.164)": l.phone || l.telefone || "",
        "Estágio": l.stage || "cold",
        "Temperatura": l.temperature || "warm",
        "Tags": Array.isArray(l.tags) ? l.tags.join(", ") : "",
        "Resumo IA": l.raw_chat_summary || "",
        "Última Interação": l.last_interaction_at ? new Date(l.last_interaction_at).toLocaleString("pt-BR") : "",
        "Data de Cadastro": new Date(l.created_at).toLocaleString("pt-BR"),
      }));

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Leads");
      XLSX.writeFile(wb, `leads_${clientId}_${Date.now()}.xlsx`);

      toast.success("Planilha Excel (.xlsx) baixada com sucesso!");
    } catch (err: any) {
      toast.error("Erro ao exportar arquivo Excel", { description: err.message });
    }
  };

  // Export Leads (CSV)
  const handleExportCSV = async () => {
    try {
      const token = await getIdToken();
      const params = new URLSearchParams({ clientId });
      if (activeTab !== "all") params.append("stage", activeTab);

      const res = await fetch(`${API_BASE_URL}/api/leads/export?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Falha ao gerar arquivo de exportação.");

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `leads_export_${clientId}_${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast.success("Arquivo CSV exportado com sucesso!");
    } catch (err: any) {
      toast.error("Erro ao exportar base", { description: err.message });
    }
  };

  // Open Campaign Wizard
  const handleOpenCampaignWizard = () => {
    setIsCampaignWizardOpen(true);
    setCampaignSelectedLeadIds(filteredLeads.map((l) => l.id));
  };

  // Handle Campaign Wizard File Select
  const handleCampaignFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCampaignFile(file);

    try {
      const rows = await parseSpreadsheetFile(file);
      setCampaignSpreadsheetRows(rows);
      if (rows.length > 0) {
        setCampaignSpreadsheetColumns(Object.keys(rows[0]));
      }
      toast.success("Planilha carregada para a campanha!", {
        description: `${rows.length} registros e ${Object.keys(rows[0] || {}).length} colunas identificadas.`,
      });
    } catch (err: any) {
      toast.error("Erro ao ler planilha", { description: err.message });
    }
  };

  // Dynamic Rule Helper for Filtering Rows
  const applyDynamicRules = (rows: Record<string, any>[], rules: DynamicFilterRule[]) => {
    if (rules.length === 0) return rows;
    return rows.filter((row) => {
      return rules.every((rule) => {
        if (!rule.column) return true;
        const rawVal = row[rule.column];
        const valStr = String(rawVal ?? "").trim().toLowerCase();
        const ruleVal = rule.value.trim().toLowerCase();

        switch (rule.operator) {
          case "equals":
            return valStr === ruleVal;
          case "contains":
            return valStr.includes(ruleVal);
          case "gt": {
            const num = parseFloat(valStr.replace(/[^\d\.,-]/g, "").replace(",", "."));
            const ruleNum = parseFloat(ruleVal);
            return !isNaN(num) && !isNaN(ruleNum) && num > ruleNum;
          }
          case "lt": {
            const num = parseFloat(valStr.replace(/[^\d\.,-]/g, "").replace(",", "."));
            const ruleNum = parseFloat(ruleVal);
            return !isNaN(num) && !isNaN(ruleNum) && num < ruleNum;
          }
          default:
            return true;
        }
      });
    });
  };

  // Computed Target Audience for Campaign Wizard
  const campaignFunnelFilteredLeads = useMemo(() => {
    const base = leads.filter((l) => {
      const isAll = campaignStageFilters.length === 0 || campaignStageFilters.includes("all");
      const stageOk = isAll || (l.stage && campaignStageFilters.includes(l.stage));
      const tagOk = !campaignTagFilter || (Array.isArray(l.tags) && l.tags.includes(campaignTagFilter));
      return stageOk && tagOk;
    });
    return applyDynamicRules(base, campaignFunnelFilterRules);
  }, [leads, campaignStageFilters, campaignTagFilter, campaignFunnelFilterRules]);

  const campaignSpreadsheetFilteredRows = useMemo(() => {
    return applyDynamicRules(campaignSpreadsheetRows, campaignSpreadsheetRules);
  }, [campaignSpreadsheetRows, campaignSpreadsheetRules]);

  // Submit Campaign Audience and Redirect to Planilhas
  const handleProceedToCampaign = () => {
    let finalRows: Record<string, any>[] = [];
    let campaignTitleName = "";

    if (campaignSourceType === "funnel") {
      const selected = campaignFunnelFilteredLeads.filter((l) => campaignSelectedLeadIds.includes(l.id));
      if (selected.length === 0) {
        toast.error("Selecione pelo menos 1 lead para a campanha.");
        return;
      }
      finalRows = selected.map((l) => ({
        telefone: l.phone || l.telefone,
        nome: l.nome || "",
        stage: l.stage || "cold",
        temperature: l.temperature || "warm",
        tags: Array.isArray(l.tags) ? l.tags.join(", ") : "",
        resumo_ia: l.raw_chat_summary || "",
      }));
      const stageLabel = campaignStageFilters.includes("all") || campaignStageFilters.length === 0
        ? "TODOS OS ESTÁGIOS"
        : campaignStageFilters.map(s => s.toUpperCase()).join("+");
      campaignTitleName = `Campanha Funil [${stageLabel}] (${selected.length} leads)`;
    } else {
      if (campaignSpreadsheetFilteredRows.length === 0) {
        toast.error("Nenhum contato encontrado na planilha com os filtros aplicados.");
        return;
      }
      finalRows = campaignSpreadsheetFilteredRows;
      campaignTitleName = `Campanha Planilha ${campaignFile?.name || "Importada"} (${finalRows.length} contatos)`;
    }

    localStorage.setItem(
      "vexo_pending_campaign_audience",
      JSON.stringify({
        campaignName: campaignTitleName,
        rows: finalRows,
      })
    );

    setIsCampaignWizardOpen(false);
    toast.success("Público-Alvo Configurado! 🎯", {
      description: "Redirecionando para a central de campanhas e disparos...",
    });

    navigate("/crm/planilhas");
  };

  // Create Manual Lead Submit
  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newLeadPhone.trim()) {
      toast.error("O número de telefone é obrigatório.");
      return;
    }

    try {
      const token = await getIdToken();
      const tagsArray = newLeadTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const res = await fetch(`${API_BASE_URL}/api/leads/create`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          nome: newLeadName.trim() || undefined,
          telefone: newLeadPhone.trim(),
          stage: newLeadStage,
          temperature: newLeadTemp,
          tags: tagsArray,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Erro ao salvar lead.");
      }

      toast.success("Lead cadastrado com sucesso!");
      setIsCreateModalOpen(false);
      setNewLeadName("");
      setNewLeadPhone("");
      setNewLeadTags("");
      fetchLeads();
    } catch (err: any) {
      toast.error("Falha ao salvar lead", { description: err.message });
    }
  };

  // Ação de WhatsApp: abre conversa interna no Vexo se já houver histórico ou WhatsApp Web se nunca conversou
  const handleSendWhatsApp = (phone: string, name?: string | null, rawChatSummary?: string | null) => {
    const rawStr = String(phone || "").trim();
    if (!rawStr) return;
    const canonical = sanitizePhone(rawStr);
    const digits = rawStr.replace(/\D/g, "");
    const cleanPhone = canonical || (digits.startsWith("55") ? digits : `55${digits}`);
    if (!cleanPhone) return;

    const hasChat = Boolean(rawChatSummary && String(rawChatSummary).trim().length > 0);
    if (hasChat) {
      navigate(`/crm/whatsapp?phone=${cleanPhone}`);
    } else {
      const text = encodeURIComponent(`Olá ${name || ""}! Como podemos te ajudar hoje?`);
      window.open(`https://web.whatsapp.com/send?phone=${cleanPhone}&text=${text}`, "_blank");
    }
  };

  // Lead Detail Sheet Actions
  const handleUpdateLeadStage = async (leadId: string, newStage: string) => {
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/leads/${leadId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ stage: newStage }),
      });

      if (!res.ok) throw new Error("Falha ao atualizar estágio.");

      toast.success("Estágio do lead atualizado!");
      if (selectedLead && selectedLead.id === leadId) {
        setSelectedLead({ ...selectedLead, stage: newStage as any });
      }
      fetchLeads();
    } catch (err: any) {
      toast.error("Erro ao atualizar estágio", { description: err.message });
    }
  };

  const handleAddTagToLead = async (leadId: string) => {
    if (!newTagInput.trim() || !selectedLead) return;
    const tagToAdd = newTagInput.trim();
    const currentTags = Array.isArray(selectedLead.tags) ? selectedLead.tags : [];
    if (currentTags.includes(tagToAdd)) {
      setNewTagInput("");
      return;
    }

    const updatedTags = [...currentTags, tagToAdd];
    try {
      const token = await getIdToken();
      const res = await fetchApi(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tags: updatedTags }),
      });

      if (!res.ok) {
        const errorMsg = await readApiErrorMessage(res, "Falha ao adicionar tag.");
        throw new Error(errorMsg);
      }

      setSelectedLead({ ...selectedLead, tags: updatedTags });
      setKnownTags((prev) => Array.from(new Set([...prev, tagToAdd])).sort());
      setNewTagInput("");
      await fetchLeads();
      toast.success(`Tag "${tagToAdd}" adicionada!`);
    } catch (err: any) {
      toast.error("Erro ao adicionar tag", { description: err.message });
    }
  };

  const handleRemoveTagFromLead = async (leadId: string, tagToRemove: string) => {
    if (!selectedLead) return;
    const currentTags = Array.isArray(selectedLead.tags) ? selectedLead.tags : [];
    const updatedTags = currentTags.filter((t) => t !== tagToRemove);

    try {
      const token = await getIdToken();
      const res = await fetchApi(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tags: updatedTags }),
      });

      if (!res.ok) {
        const errorMsg = await readApiErrorMessage(res, "Falha ao remover tag.");
        throw new Error(errorMsg);
      }

      setSelectedLead({ ...selectedLead, tags: updatedTags });
      await fetchLeads();
      toast.success(`Tag "${tagToRemove}" removida!`);
    } catch (err: any) {
      toast.error("Erro ao remover tag", { description: err.message });
    }
  };

  const handleDeleteSingleLead = async (leadId: string) => {
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/leads/${leadId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Falha ao deletar lead.");

      toast.success("Lead removido com sucesso.");
      setIsDetailSheetOpen(false);
      setSelectedLead(null);
      fetchLeads();
    } catch (err: any) {
      toast.error("Erro ao deletar lead", { description: err.message });
    }
  };

  const handleUpdateLeadAssignedTo = async (leadId: string, newAssignedTo: string | null) => {
    try {
      const token = await getIdToken();
      const res = await fetchApi(`/api/leads/${leadId}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ assigned_to: newAssignedTo }),
      });

      if (!res.ok) {
        const errorMsg = await readApiErrorMessage(res, "Falha ao reatribuir responsável.");
        throw new Error(errorMsg);
      }

      toast.success("Responsável do lead atualizado!");
      if (selectedLead && selectedLead.id === leadId) {
        setSelectedLead({ ...selectedLead, assigned_to: newAssignedTo });
      }
      fetchLeads();
    } catch (err: any) {
      toast.error("Erro ao reatribuir responsável", { description: err.message });
    }
  };

  // Bulk Selection Actions
  const handleToggleSelectAll = () => {
    const pageIds = paginatedLeads.map((l) => l.id);
    const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedLeadIds.includes(id));
    if (allPageSelected) {
      setSelectedLeadIds((prev) => prev.filter((id) => !pageIds.includes(id)));
    } else {
      setSelectedLeadIds((prev) => Array.from(new Set([...prev, ...pageIds])));
    }
  };

  const handleToggleSelectOne = (id: string) => {
    setSelectedLeadIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const openMarkAsClientModal = (target: { type: "single"; leadId: string } | { type: "bulk"; leadIds: string[] }) => {
    setMarkAsClientTarget(target);
    if (target.type === "single" && selectedLead?.id === target.leadId) {
      setMarkAsClientValue(selectedLead.potential_contract_value ? String(selectedLead.potential_contract_value) : "");
    } else {
      setMarkAsClientValue("");
    }
    setIsMarkAsClientModalOpen(true);
  };

  const handleConfirmMarkAsClient = async () => {
    if (!markAsClientTarget) return;
    try {
      const token = await getIdToken();
      const parsedValue = markAsClientValue.trim() ? parseFloat(markAsClientValue.replace(",", ".")) : null;

      if (markAsClientTarget.type === "single") {
        const res = await fetch(`${API_BASE_URL}/api/leads/${markAsClientTarget.leadId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            stage: "buyer",
            stage_source: "manual",
            potential_contract_value: parsedValue,
          }),
        });
        if (!res.ok) throw new Error("Falha ao marcar como cliente.");
        toast.success("Lead marcado como Cliente!");
        if (selectedLead && selectedLead.id === markAsClientTarget.leadId) {
          setSelectedLead({
            ...selectedLead,
            stage: "buyer",
            stage_source: "manual",
            potential_contract_value: parsedValue,
          });
        }
      } else {
        const res = await fetch(`${API_BASE_URL}/api/leads/bulk-update`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            clientId,
            leadIds: markAsClientTarget.leadIds,
            updates: {
              stage: "buyer",
              stage_source: "manual",
              potential_contract_value: parsedValue,
            },
          }),
        });
        if (!res.ok) throw new Error("Falha ao atualizar leads em lote.");
        toast.success(`${markAsClientTarget.leadIds.length} leads marcados como Cliente!`);
        setSelectedLeadIds([]);
      }
      setIsMarkAsClientModalOpen(false);
      fetchLeads();
    } catch (err: any) {
      toast.error("Erro ao marcar como cliente", { description: err.message });
    }
  };

  const openMarkAsLostModal = (target: { type: "single"; leadId: string } | { type: "bulk"; leadIds: string[] }) => {
    setMarkAsLostTarget(target);
    if (target.type === "single" && selectedLead?.id === target.leadId) {
      setMarkAsLostReason(selectedLead.lost_reason || "preco");
    } else {
      setMarkAsLostReason("preco");
    }
    setIsMarkAsLostModalOpen(true);
  };

  const handleConfirmMarkAsLost = async () => {
    if (!markAsLostTarget) return;
    try {
      const token = await getIdToken();
      if (markAsLostTarget.type === "single") {
        const res = await fetch(`${API_BASE_URL}/api/leads/${markAsLostTarget.leadId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            stage: "lost",
            stage_source: "manual",
            lost_reason: markAsLostReason,
          }),
        });
        if (!res.ok) throw new Error("Falha ao marcar como perdido.");
        toast.success("Lead marcado como Perdido!");
        if (selectedLead && selectedLead.id === markAsLostTarget.leadId) {
          setSelectedLead({
            ...selectedLead,
            stage: "lost",
            stage_source: "manual",
            lost_reason: markAsLostReason,
          });
        }
      } else {
        const res = await fetch(`${API_BASE_URL}/api/leads/bulk-update`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            clientId,
            leadIds: markAsLostTarget.leadIds,
            updates: {
              stage: "lost",
              stage_source: "manual",
              lost_reason: markAsLostReason,
            },
          }),
        });
        if (!res.ok) throw new Error("Falha ao atualizar leads em lote.");
        toast.success(`${markAsLostTarget.leadIds.length} leads marcados como Perdido!`);
        setSelectedLeadIds([]);
      }
      setIsMarkAsLostModalOpen(false);
      fetchLeads();
    } catch (err: any) {
      toast.error("Erro ao marcar como perdido", { description: err.message });
    }
  };

  const handleBulkStageSubmit = async () => {
    if (selectedLeadIds.length === 0) return;
    try {
      const token = await getIdToken();
      const updates: any = {
        stage: bulkStageValue,
        stage_source: "manual",
      };
      if (bulkStageValue === "buyer") {
        updates.potential_contract_value = bulkContractValue.trim()
          ? parseFloat(bulkContractValue.replace(",", "."))
          : null;
      } else if (bulkStageValue === "lost") {
        updates.lost_reason = bulkLostReason || "preco";
      }

      const res = await fetch(`${API_BASE_URL}/api/leads/bulk-update`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          leadIds: selectedLeadIds,
          updates,
        }),
      });

      if (!res.ok) throw new Error("Falha ao atualizar em lote.");

      toast.success(`Estágio alterado para ${selectedLeadIds.length} leads!`);
      setIsBulkStageModalOpen(false);
      setBulkContractValue("");
      setSelectedLeadIds([]);
      fetchLeads();
    } catch (err: any) {
      toast.error("Erro na atualização em lote", { description: err.message });
    }
  };

  const handleBulkTagSubmit = async () => {
    if (selectedLeadIds.length === 0 || !bulkTagValue.trim()) return;
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/leads/bulk-update`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          leadIds: selectedLeadIds,
          updates: { addTag: bulkTagValue.trim() },
        }),
      });

      if (!res.ok) throw new Error("Falha ao adicionar tag em lote.");

      toast.success(`Tag "${bulkTagValue.trim()}" adicionada a ${selectedLeadIds.length} leads!`);
      setIsBulkTagModalOpen(false);
      setBulkTagValue("");
      setSelectedLeadIds([]);
      fetchLeads();
    } catch (err: any) {
      toast.error("Erro na tag em lote", { description: err.message });
    }
  };

  const handleBulkAssignSubmit = async () => {
    if (selectedLeadIds.length === 0) return;
    try {
      const token = await getIdToken();
      const targetUid = bulkAssignValue === "none" ? null : bulkAssignValue;
      const res = await fetchApi(`/api/leads/bulk-update`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          leadIds: selectedLeadIds,
          updates: { assigned_to: targetUid },
        }),
      });

      if (!res.ok) {
        const errorMsg = await readApiErrorMessage(res, "Falha ao reatribuir leads em massa.");
        throw new Error(errorMsg);
      }

      toast.success(`Responsável atualizado para ${selectedLeadIds.length} leads!`);
      setIsBulkAssignModalOpen(false);
      setSelectedLeadIds([]);
      fetchLeads();
    } catch (err: any) {
      toast.error("Erro na reatribuição em lote", { description: err.message });
    }
  };

  const handleBulkDeleteSubmit = async () => {
    if (selectedLeadIds.length === 0) return;
    if (!confirm(`Tem certeza que deseja excluir os ${selectedLeadIds.length} leads selecionados?`)) {
      return;
    }

    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/leads/bulk-delete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId,
          leadIds: selectedLeadIds,
        }),
      });

      if (!res.ok) throw new Error("Falha ao excluir em lote.");

      toast.success(`${selectedLeadIds.length} leads excluídos com sucesso!`);
      setSelectedLeadIds([]);
      fetchLeads();
    } catch (err: any) {
      toast.error("Erro ao excluir leads", { description: err.message });
    }
  };

  const marketingMetrics = useMemo(() => {
    const total = leads.length;
    const counts: Record<string, number> = {
      instagram: 0,
      google: 0,
      facebook: 0,
      tiktok: 0,
      indicacao: 0,
      whatsapp_outros: 0,
    };

    leads.forEach((lead) => {
      const chId = getLeadMarketingChannelId(lead);
      counts[chId] = (counts[chId] || 0) + 1;
    });

    return {
      total,
      counts,
      percentages: {
        instagram: total > 0 ? Math.round((counts.instagram / total) * 100) : 0,
        google: total > 0 ? Math.round((counts.google / total) * 100) : 0,
        facebook: total > 0 ? Math.round((counts.facebook / total) * 100) : 0,
        tiktok: total > 0 ? Math.round((counts.tiktok / total) * 100) : 0,
        indicacao: total > 0 ? Math.round((counts.indicacao / total) * 100) : 0,
        whatsapp_outros: total > 0 ? Math.round((counts.whatsapp_outros / total) * 100) : 0,
      },
    };
  }, [leads]);

  const handleOpenCampaignForChannel = (chDef: { id: string; name: string; icon: string }) => {
    const leadsForChannel = leads.filter((l) => getLeadMarketingChannelId(l) === chDef.id);
    if (leadsForChannel.length === 0) {
      toast.error(`Nenhum lead encontrado para a origem ${chDef.name}.`);
      return;
    }
    setCampaignSourceType("funnel");
    setCampaignSelectedLeadIds(leadsForChannel.map((l) => l.id));
    setIsCampaignWizardOpen(true);
    toast.success(`Disparo Segmentado: ${chDef.icon} ${chDef.name}`, {
      description: `${leadsForChannel.length} contatos selecionados para a campanha.`,
    });
  };

  const availableSources = useMemo(() => {
    const set = new Set<string>(knownSources);
    leads.forEach((l) => {
      const src = getLeadSource(l);
      if (src && src !== "Não informado") set.add(src);
    });
    if (selectedSource) set.add(selectedSource);
    return Array.from(set).sort();
  }, [leads, knownSources, selectedSource]);

  const topSourceRanking = useMemo(() => {
    const map = new Map<string, number>();
    leads.forEach((l) => {
      const src = getLeadSource(l);
      map.set(src, (map.get(src) || 0) + 1);
    });
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, [leads]);

  // Local filtered search list
  const filteredLeads = useMemo(() => {
    return leads.filter((item) => {
      const phoneMatch = (item.telefone || item.phone || "").toLowerCase().includes(searchQuery.toLowerCase());
      const nameMatch = (item.nome || "").toLowerCase().includes(searchQuery.toLowerCase());
      const summaryMatch = (item.raw_chat_summary || "").toLowerCase().includes(searchQuery.toLowerCase());
      const searchOk = !searchQuery.trim() || phoneMatch || nameMatch || summaryMatch;

      const stageOk = activeTab === "all" || item.stage === activeTab;
      const tagOk = !selectedTag || (Array.isArray(item.tags) && item.tags.includes(selectedTag));
      const sourceStr = getLeadSource(item);
      const sourceOk = !selectedSource || sourceStr === selectedSource;
      const channelOk = selectedChannel === "all" || getLeadMarketingChannelId(item) === selectedChannel;

      return searchOk && stageOk && tagOk && sourceOk && channelOk;
    });
  }, [leads, searchQuery, activeTab, selectedTag, selectedSource, selectedChannel]);

  // Reset pagination when filters or search change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, activeTab, selectedTag, selectedSource, selectedChannel, pageSize]);

  const totalFilteredLeads = filteredLeads.length;
  const totalPages = Math.max(1, Math.ceil(totalFilteredLeads / pageSize));

  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredLeads.slice(start, start + pageSize);
  }, [filteredLeads, currentPage, pageSize]);

  // Dynamic calculation for Potencial da Base (funil de 3 faixas)
  const basePotential = useMemo(() => {
    return calculateBasePotential(summary, ticketMedio);
  }, [summary, ticketMedio]);

  const potentialSegments = useMemo(
    () => [
      {
        id: "never_contacted",
        title: "Nunca abordados",
        count: basePotential.neverContactedCount,
        value: basePotential.neverContactedValue,
        explanation:
          "Contatos na base que nunca trocaram mensagem com você. Vieram da agenda do WhatsApp, de planilha ou de formulário. É o volume ainda intocado.",
        barColor: "bg-sky-500 hover:bg-sky-600 dark:bg-sky-600 dark:hover:bg-sky-500",
        indicatorColor: "bg-sky-500",
      },
      {
        id: "in_conversation",
        title: "Em conversa",
        count: basePotential.inConversationCount,
        value: basePotential.inConversationValue,
        explanation:
          "Já trocaram mensagem com você, mas ainda não têm orçamento aberto.",
        barColor: "bg-amber-500 hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-500",
        indicatorColor: "bg-amber-500",
      },
      {
        id: "in_negotiation",
        title: "Em negociação",
        count: basePotential.inNegotiationCount,
        value: basePotential.inNegotiationValue,
        explanation:
          "Têm orçamento aberto no funil. É o que está na mesa agora.",
        barColor: "bg-emerald-600 hover:bg-emerald-700 dark:bg-emerald-500 dark:hover:bg-emerald-400",
        indicatorColor: "bg-emerald-600",
      },
    ],
    [basePotential]
  );

  // Unique tags across base (preserva tags conhecidas para o dropdown nunca sumir)
  const availableTags = useMemo(() => {
    const set = new Set<string>(knownTags);
    leads.forEach((l) => {
      if (Array.isArray(l.tags)) {
        l.tags.forEach((t) => set.add(t));
      }
    });
    if (selectedTag) set.add(selectedTag);
    return Array.from(set).sort();
  }, [leads, knownTags, selectedTag]);

  // Checagem de filtros ativos e limpador global
  const hasActiveFilters = Boolean(
    selectedTag ||
    selectedSource ||
    selectedChannel !== "all" ||
    searchQuery.trim() ||
    activeTab !== "all"
  );

  const handleClearAllFilters = () => {
    setSelectedTag("");
    setSelectedSource("");
    setSelectedChannel("all");
    setSearchQuery("");
    setActiveTab("all");
  };

  // Badges & Temperature Helpers
  const getStageBadge = (stage?: string | null, lostReason?: string | null, stageSource?: string | null) => {
    switch (stage) {
      case "buyer":
        return (
          <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 gap-1">
            Comprador 🟢
            {stageSource === "manual" && <span className="text-[10px] opacity-75 font-normal">(Manual)</span>}
            {stageSource === "integration" && <span className="text-[10px] opacity-75 font-normal">(Webhook)</span>}
          </Badge>
        );
      case "open_budget":
        return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30">Orçamento Aberto 🟡</Badge>;
      case "inquiry":
        return <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30">Em Dúvida 🔵</Badge>;
      case "lost":
        const reasonObj = LOST_REASONS.find((r) => r.id === lostReason);
        return (
          <Badge className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 gap-1" title={reasonObj?.label || lostReason || undefined}>
            Perdido 🔴
            {lostReason && <span className="text-[10px] opacity-75 font-normal">({reasonObj?.id || lostReason})</span>}
          </Badge>
        );
      case "cold":
      default:
        return <Badge className="bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30">Lead Frio ⚪</Badge>;
    }
  };

  const getTemperatureBadge = (temp?: string | null) => {
    switch (temp) {
      case "hot":
        return <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-500"><Flame className="w-3.5 h-3.5 fill-rose-500" /> Quente</span>;
      case "warm":
        return <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-500"><Sun className="w-3.5 h-3.5" /> Morno</span>;
      case "cold":
      default:
        return <span className="inline-flex items-center gap-1 text-xs font-normal text-slate-400"><Snowflake className="w-3.5 h-3.5" /> Frio</span>;
    }
  };

  // Gate DEPOIS de todos os hooks — nunca antes. Gate acima dos hooks foi o que
  // deixou /crm/relatorios em tela branca com React error #300 (ver
  // src/test/upsellHookOrder.test.tsx).
  const isBancoUnlocked = hasFeatureUnlocked(crmClient?.selectedClient, "banco-de-dados");
  if (!isBancoUnlocked) {
    return (
      <PageShell title="Banco de Dados" subtitle="Sua base de leads própria, organizada por procedência e relacionamento">
        <div className="max-w-2xl mx-auto py-8">
          <UpsellCard
            title="Banco de Dados Inteligente"
            subtitle="Módulo Não Contratado no Plano Modular"
            description="Centralize sua base de leads: importe planilhas, extraia contatos do WhatsApp e trabalhe a carteira inteira em um lugar só."
            moduleName="Banco de Dados Inteligente"
            benefits={[
              "Importação de planilhas com detecção automática de colunas",
              "Extração de contatos direto das conversas do WhatsApp",
              "Separação por procedência e estado de relacionamento",
              "Edição em massa, etiquetas e exportação completa",
            ]}
          />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Banco de Dados Inteligente"
      subtitle="Vexo Lead Intelligence & Extrator de Contatos com Inteligência Semântica via WhatsApp"
    >
      <div className="space-y-6 pb-20">
        {/* Header Superior */}
        <SectionHeader
          title="Banco de Dados Inteligente"
          subtitle="Vexo Lead Intelligence & Extrator de Contatos com Inteligência Semântica via WhatsApp"
        >
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchLeads()}
              disabled={loading}
              className="gap-2 text-xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>

            <Button
              variant="default"
              size="sm"
              onClick={() => setIsWAModalOpen(true)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 text-xs"
            >
              <MessageCircle className="w-3.5 h-3.5" />
              Extrair do WhatsApp (QR Code)
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setAiStep(1);
                setIsAIImportModalOpen(true);
              }}
              className="gap-1.5 text-xs rounded-xl border-purple-500/30 bg-purple-500/5 text-purple-700 dark:text-purple-300 hover:bg-purple-500/15 font-semibold"
            >
              <Bot className="w-3.5 h-3.5 text-purple-500" />
              Importar com IA (Instagram / Chat / Texto)
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsImportModalOpen(true)}
              className="gap-2 text-xs"
            >
              <Upload className="w-3.5 h-3.5" />
              Importar Planilha (.xlsx/.csv)
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsTicketModalOpen(true)}
              className="gap-2 text-xs"
            >
              <Settings className="w-3.5 h-3.5" />
              Ticket Médio
            </Button>

            {/* Dropdown com opções de exportação XLSX e CSV */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-2 text-xs">
                  <Download className="w-3.5 h-3.5" />
                  Exportar Leads
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleExportXLSX} className="cursor-pointer text-xs gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-emerald-600" />
                  Exportar Excel (.xlsx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportCSV} className="cursor-pointer text-xs gap-2">
                  <FileText className="w-4 h-4 text-blue-600" />
                  Exportar CSV (.csv)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              variant="default"
              size="sm"
              onClick={handleOpenCampaignWizard}
              className="bg-amber-600 hover:bg-amber-700 text-white gap-2 text-xs"
            >
              <Rocket className="w-3.5 h-3.5" />
              Criar Campanha
            </Button>

            {selectedLeadIds.length > 0 && (
              <>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setIsFollowupModalOpen(true)}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 text-xs"
                >
                  <CalendarClock className="w-3.5 h-3.5" />
                  Aplicar Follow-up ({selectedLeadIds.length})
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsSingleReminderModalOpen(true)}
                  className="border-emerald-600/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 gap-1.5 text-xs font-semibold"
                >
                  <Clock className="w-3.5 h-3.5 text-emerald-500" />
                  Lembrete avulso
                </Button>
              </>
            )}

            <Button
              variant="default"
              size="sm"
              onClick={() => setIsCreateModalOpen(true)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2 text-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              Novo Lead
            </Button>
          </div>
        </SectionHeader>

        {/* Painel de Atribuição & Origem de Marketing */}
        <div
          className={cn(
            isAdvancedOriginsUnlocked
              ? "space-y-3 p-4 rounded-2xl bg-gradient-to-b from-card/80 via-card/50 to-card/30 border border-border dark:border-zinc-800 shadow-sm"
              : "relative group cursor-pointer select-none rounded-xl border border-dashed border-purple-500/30 p-3 bg-muted/20 hover:bg-muted/30 transition-all space-y-3"
          )}
          onClick={() => {
            if (!isAdvancedOriginsUnlocked) {
              setIsOriginUpsellModalOpen(true);
            }
          }}
        >
          {!isAdvancedOriginsUnlocked && (
            <div 
              onClick={() => setIsOriginUpsellModalOpen(true)}
              className="absolute inset-0 flex items-center justify-center bg-background/20 backdrop-blur-[1px] rounded-xl z-10"
            >
              <Badge className="bg-zinc-900/90 text-white dark:bg-zinc-100 dark:text-zinc-900 border border-purple-500/40 text-xs font-bold px-3 py-1.5 shadow-lg gap-1.5 group-hover:scale-105 transition-transform">
                <Lock className="w-3.5 h-3.5 text-purple-400 dark:text-purple-600" />
                Rastreamento de Origens · Clique para saber mais ⚡
              </Badge>
            </div>
          )}

          <div className={cn("flex flex-wrap items-center justify-between gap-2", !isAdvancedOriginsUnlocked && "opacity-40 blur-[0.5px] pointer-events-none")}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                Atribuição & Origem de Marketing
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:inline">
                (Clique no canal para filtrar contatos em tempo real e disparar campanhas)
              </span>
            </div>
            {isAdvancedOriginsUnlocked && selectedChannel !== "all" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedChannel("all")}
                className="h-6 text-xs text-rose-500 hover:text-rose-600 hover:bg-rose-500/10 gap-1 px-2"
              >
                <X className="w-3 h-3" />
                Limpar Filtro
              </Button>
            )}
          </div>

          <div className={cn("grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5", !isAdvancedOriginsUnlocked && "opacity-40 blur-[0.5px] pointer-events-none")}>
            {MARKETING_CHANNELS.map((ch) => {
              const count = isAdvancedOriginsUnlocked ? (marketingMetrics.counts[ch.id] || 0) : 124;
              const pct = isAdvancedOriginsUnlocked ? (marketingMetrics.percentages[ch.id as keyof typeof marketingMetrics.percentages] || 0) : 18;
              const isSelected = isAdvancedOriginsUnlocked && selectedChannel === ch.id;

              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => isAdvancedOriginsUnlocked && setSelectedChannel((prev) => (prev === ch.id ? "all" : ch.id))}
                  title={isAdvancedOriginsUnlocked ? `${ch.name}: ${count} leads (${pct}%)` : ch.name}
                  className={cn(
                    "p-3 rounded-xl border text-left transition-all relative flex flex-col justify-between cursor-pointer group bg-card min-w-0 h-[88px]",
                    isSelected
                      ? ch.activeBorder
                      : "border-border dark:border-zinc-800/80 hover:border-primary/50 dark:hover:border-zinc-700 hover:shadow-sm"
                  )}
                >
                  <div className="flex items-center justify-between gap-1 w-full min-w-0">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 min-w-0 truncate">
                      <span className="text-base leading-none shrink-0">{ch.icon}</span>
                      <span className="truncate">{ch.name}</span>
                    </span>
                    {isSelected && (
                      <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
                    )}
                  </div>
                  
                  <div className="flex items-baseline justify-between pt-1">
                    <span className="text-lg font-black text-foreground">
                      {count.toLocaleString("pt-BR")}
                    </span>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 font-bold shrink-0", ch.badgeClass)}>
                      {pct}%
                    </Badge>
                  </div>

                  <div className="w-full bg-slate-100 dark:bg-zinc-800 rounded-full h-1 overflow-hidden">
                    <div
                      className="bg-primary h-full rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>

          {/* Barra de Ação Rápida do Filtro de Canal Selecionado */}
          {isAdvancedOriginsUnlocked && selectedChannel !== "all" && (() => {
            const activeCh = MARKETING_CHANNELS.find((c) => c.id === selectedChannel);
            if (!activeCh) return null;
            const count = marketingMetrics.counts[activeCh.id] || 0;

            return (
              <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl bg-gradient-to-r from-primary/10 via-purple-500/5 to-transparent border border-primary/30 animate-in fade-in">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{activeCh.icon}</span>
                  <div>
                    <span className="text-xs font-bold text-foreground block">
                      Filtro Ativo: {activeCh.name}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {count} {count === 1 ? "lead encontrado" : "leads encontrados"} ({marketingMetrics.percentages[activeCh.id as keyof typeof marketingMetrics.percentages]}% da base total)
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleOpenCampaignForChannel(activeCh)}
                    className="bg-amber-600 hover:bg-amber-700 text-white text-xs gap-1.5 h-8 font-bold shadow-sm"
                  >
                    <Rocket className="w-3.5 h-3.5" />
                    Disparar Campanha para {activeCh.name} ({count})
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedChannel("all")}
                    className="text-xs h-8 gap-1"
                  >
                    <X className="w-3 h-3" />
                    Remover Filtro
                  </Button>
                </div>
              </div>
            );
          })()}
        </div>

        {/* Header Métrico (Cards KPIs Compactos) */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 items-start">
          <Card
            onClick={() => setActiveTab("all")}
            className={cn(
              "bg-card text-card-foreground border-border shadow-sm dark:bg-zinc-900/60 dark:border-zinc-800 cursor-pointer hover:border-blue-500/50 hover:shadow-md transition-all p-3",
              activeTab === "all" && "border-blue-500/60 bg-blue-500/[0.04]"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground">
                Total de Leads na Base
              </span>
              <Database className="h-4 w-4 text-blue-500" />
            </div>
            <div className="text-[20px] font-bold text-foreground mt-1">
              {summary.totalLeads.toLocaleString("pt-BR")}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Leads cadastrados e minerados</p>
          </Card>

          <Card
            onClick={() => setActiveTab("buyer")}
            className={cn(
              "bg-card text-card-foreground border-border shadow-sm dark:bg-zinc-900/60 dark:border-zinc-800 cursor-pointer hover:border-emerald-500/50 hover:shadow-md transition-all p-3",
              activeTab === "buyer" && "border-emerald-500/60 bg-emerald-500/[0.04]"
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground">
                Compradores (Clientes 🟢)
              </span>
              <UserCheck className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="text-[20px] font-bold text-emerald-600 dark:text-emerald-400 mt-1">
              {summary.buyersCount.toLocaleString("pt-BR")}
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">Clientes ativos e confirmados</p>
          </Card>

          {/* Card Resumido de Origem / Ranking de Canais */}
          <Card className="bg-card text-card-foreground border-border shadow-sm dark:bg-zinc-900/60 dark:border-zinc-800 p-3">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground">
                Ranking de Origem 📊
              </span>
              <Sparkles className="h-4 w-4 text-purple-500" />
            </div>
            {topSourceRanking.length === 0 ? (
              <p className="text-[11px] text-muted-foreground mt-1">Sem origens registradas</p>
            ) : (
              <div className="space-y-1 mt-1">
                {topSourceRanking.map(([src, cnt]) => (
                  <div key={src} className="flex items-center justify-between text-xs">
                    <span className="truncate max-w-[120px] font-medium text-muted-foreground">{src}</span>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 border-indigo-500/20 font-bold">
                      {cnt}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Faixa Potencial da Base (Largura Total) */}
        <Card className="bg-card text-card-foreground border-border shadow-sm dark:bg-zinc-900/60 dark:border-zinc-800 p-3.5 sm:p-4 space-y-3">
          {/* Cabeçalho */}
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground">
                Potencial da base
              </p>
              <p className="text-2xl sm:text-[26px] font-bold text-foreground leading-tight mt-0.5">
                {basePotential.isConfigured && basePotential.totalActiveValue != null
                  ? basePotential.totalActiveValue.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })
                  : `${basePotential.activeLeadsCount.toLocaleString("pt-BR")} contatos ativos`}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTempTicketInput(ticketMedio != null ? String(ticketMedio) : "");
                setIsTicketModalOpen(true);
              }}
              className="h-8 gap-1.5 text-xs font-medium border-border/80 hover:bg-accent shrink-0"
            >
              <span>
                {basePotential.isConfigured && ticketMedio != null
                  ? `Ticket ${ticketMedio.toLocaleString("pt-BR", {
                      style: "currency",
                      currency: "BRL",
                      maximumFractionDigits: 0,
                    })}`
                  : "Configurar ticket"}
              </span>
              <Settings className="w-3.5 h-3.5 text-muted-foreground" />
            </Button>
          </div>

          {/* Barra empilhada proporcional */}
          <div
            role="group"
            aria-label={`Divisão do potencial da base: ${basePotential.neverContactedCount.toLocaleString("pt-BR")} nunca abordados, ${basePotential.inConversationCount.toLocaleString("pt-BR")} em conversa, ${basePotential.inNegotiationCount.toLocaleString("pt-BR")} em negociação de ${basePotential.activeLeadsCount.toLocaleString("pt-BR")} contatos ativos`}
            className="flex w-full h-[30px] rounded-lg overflow-hidden bg-muted/20 border border-border/40"
          >
            {basePotential.activeLeadsCount === 0 ? (
              <div className="w-full h-full bg-muted/30" />
            ) : (
              potentialSegments.map((segment) => {
                if (segment.count <= 0) return null;
                const percentage = (segment.count / basePotential.activeLeadsCount) * 100;
                return (
                  <Popover key={segment.id}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={cn(
                          "h-full transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer shrink",
                          segment.barColor
                        )}
                        style={{
                          width: `${percentage}%`,
                          minWidth: "4px",
                        }}
                        title={`${segment.title}: ${segment.count.toLocaleString("pt-BR")}`}
                        aria-label={`${segment.title}: ${segment.count.toLocaleString("pt-BR")}`}
                      />
                    </PopoverTrigger>
                    <PopoverContent className="w-80 text-xs p-3 space-y-1.5" side="bottom" align="center">
                      <div className="flex items-center gap-1.5 font-semibold text-foreground text-sm">
                        <div className={cn("w-2 h-2 rounded-full shrink-0", segment.indicatorColor)} />
                        <span>{segment.title}</span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">{segment.explanation}</p>
                    </PopoverContent>
                  </Popover>
                );
              })
            )}
          </div>

          {/* Legenda em 3 colunas (empilha em 1 no mobile) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 pt-1">
            {potentialSegments.map((segment) => (
              <Popover key={segment.id}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex items-start gap-2.5 text-left p-1.5 -m-1.5 rounded-md hover:bg-muted/40 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer group"
                  >
                    <div className={cn("w-1 self-stretch rounded-full shrink-0 my-0.5", segment.indicatorColor)} />
                    <div className="flex flex-col min-w-0">
                      <span className="text-[11px] text-muted-foreground font-medium truncate">
                        {segment.title} · {segment.count.toLocaleString("pt-BR")}
                      </span>
                      {basePotential.isConfigured && segment.value != null && (
                        <span className="text-[17px] font-bold text-foreground leading-tight mt-0.5">
                          {segment.value.toLocaleString("pt-BR", {
                            style: "currency",
                            currency: "BRL",
                            maximumFractionDigits: 0,
                          })}
                        </span>
                      )}
                    </div>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-80 text-xs p-3 space-y-1.5" side="bottom" align="start">
                  <div className="flex items-center gap-1.5 font-semibold text-foreground text-sm">
                    <div className={cn("w-2 h-2 rounded-full shrink-0", segment.indicatorColor)} />
                    <span>{segment.title}</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">{segment.explanation}</p>
                </PopoverContent>
              </Popover>
            ))}
          </div>
        </Card>

        {/* Barra de Abas e Busca */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border dark:border-zinc-800 pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab("all")}
              className={cn("rounded-full text-xs", activeTab === "all" && "border border-primary/60 bg-primary/5 font-semibold hover:bg-primary/10")}
            >
              Todas ({summary.totalLeads})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab("buyer")}
              className={cn("rounded-full text-xs text-emerald-600 dark:text-emerald-400", activeTab === "buyer" && "border border-emerald-500/60 bg-emerald-500/5 font-semibold hover:bg-emerald-500/10")}
            >
              Clientes 🟢 ({summary.buyersCount})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab("open_budget")}
              className={cn("rounded-full text-xs text-amber-600 dark:text-amber-400", activeTab === "open_budget" && "border border-amber-500/60 bg-amber-500/5 font-semibold hover:bg-amber-500/10")}
            >
              Orçamentos Abertos 🟡 ({summary.openBudgetsCount})
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab("cold")}
              className={cn("rounded-full text-xs text-blue-600 dark:text-blue-400", activeTab === "cold" && "border border-blue-500/60 bg-blue-500/5 font-semibold hover:bg-blue-500/10")}
            >
              Leads Frios 🔵
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab("lost")}
              className={cn("rounded-full text-xs text-rose-600 dark:text-rose-400", activeTab === "lost" && "border border-rose-500/60 bg-rose-500/5 font-semibold hover:bg-rose-500/10")}
            >
              Perdidos 🔴
            </Button>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nome, fone, tag..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 text-xs h-9"
              />
            </div>

            {/* Filtro Origem de Marketing */}
            <select
              value={selectedSource}
              onChange={(e) => setSelectedSource(e.target.value)}
              className="h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:ring-1 focus:ring-ring"
            >
              <option value="">Todas as Origens</option>
              {availableSources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>

            {(availableTags.length > 0 || selectedTag) && (
              <select
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                className="h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:ring-1 focus:ring-ring"
              >
                <option value="">Todas as Tags</option>
                {availableTags.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            )}

            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearAllFilters}
                className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1 border-border"
                title="Limpar todos os filtros"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Limpar</span>
              </Button>
            )}
          </div>
        </div>

        {/* Indicadores de Filtros Ativos */}
        {hasActiveFilters && (
          <div className="flex flex-wrap items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 flex items-center gap-1">
              <Filter className="w-3 h-3 text-indigo-500" />
              Filtros:
            </span>
            {activeTab !== "all" && (
              <Badge variant="secondary" className="gap-1 text-[11px] pr-1 bg-muted/80">
                Estágio: {activeTab}
                <button
                  type="button"
                  onClick={() => setActiveTab("all")}
                  className="hover:text-rose-500 p-0.5 rounded"
                  title="Remover filtro de estágio"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            )}
            {selectedTag && (
              <Badge variant="secondary" className="gap-1 text-[11px] pr-1 bg-muted/80">
                Tag: {selectedTag}
                <button
                  type="button"
                  onClick={() => setSelectedTag("")}
                  className="hover:text-rose-500 p-0.5 rounded"
                  title="Remover filtro de tag"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            )}
            {selectedSource && (
              <Badge variant="secondary" className="gap-1 text-[11px] pr-1 bg-muted/80">
                Origem: {selectedSource}
                <button
                  type="button"
                  onClick={() => setSelectedSource("")}
                  className="hover:text-rose-500 p-0.5 rounded"
                  title="Remover filtro de origem"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            )}
            {searchQuery && (
              <Badge variant="secondary" className="gap-1 text-[11px] pr-1 bg-muted/80">
                Busca: "{searchQuery}"
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="hover:text-rose-500 p-0.5 rounded"
                  title="Limpar busca"
                >
                  <X className="w-3 h-3" />
                </button>
              </Badge>
            )}
            <Button
              variant="link"
              size="sm"
              onClick={handleClearAllFilters}
              className="h-auto p-0 text-xs text-indigo-500 hover:text-indigo-600 underline font-medium"
            >
              Limpar todos
            </Button>
          </div>
        )}

        {/* Tabela Principal */}
        <Card className="bg-card text-card-foreground border-border shadow-sm dark:bg-zinc-900/60 dark:border-zinc-800">
          <CardContent className="p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground gap-2">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Carregando inteligência de base...</span>
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-rose-500 gap-2">
                <AlertCircle className="w-6 h-6" />
                <span className="font-semibold">{error}</span>
                <Button variant="outline" size="sm" onClick={fetchLeads} className="mt-2">
                  Tentar Novamente
                </Button>
              </div>
            ) : filteredLeads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground gap-3">
                <Database className="w-8 h-8 opacity-40" />
                <p className="font-medium text-sm">Nenhum lead encontrado com os filtros atuais.</p>
                {hasActiveFilters && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleClearAllFilters}
                    className="text-xs gap-1.5 border-border hover:bg-muted"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Limpar todos os filtros
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-border dark:border-zinc-800 bg-muted/40">
                      <TableHead className="w-[40px] px-3">
                        <input
                          type="checkbox"
                          checked={paginatedLeads.length > 0 && paginatedLeads.every((l) => selectedLeadIds.includes(l.id))}
                          onChange={handleToggleSelectAll}
                          className="rounded border-input text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </TableHead>
                      <TableHead className="w-[220px]">Contato / Nome</TableHead>
                      <TableHead className="w-[130px]">Responsável</TableHead>
                      <TableHead className="w-[140px]">Origem</TableHead>
                      <TableHead className="w-[150px]">Telefone</TableHead>
                      <TableHead className="w-[140px]">Estágio</TableHead>
                      <TableHead className="w-[120px]">Temperatura</TableHead>
                      <TableHead>Tags & Interesses</TableHead>
                      <TableHead className="w-[150px]">Última Conversa</TableHead>
                      <TableHead className="text-right w-[210px]">Ação</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedLeads.map((lead) => {
                      const displayPhone = lead.phone || lead.telefone || "";
                      const displayName = lead.nome || "Sem Nome";
                      const isSelected = selectedLeadIds.includes(lead.id);
                      const lastInteraction = lead.last_interaction_at
                        ? new Date(lead.last_interaction_at).toLocaleString("pt-BR", {
                            dateStyle: "short",
                            timeStyle: "short",
                          })
                        : lead.created_at
                        ? new Date(lead.created_at).toLocaleDateString("pt-BR")
                        : "-";

                      return (
                        <TableRow
                          key={lead.id}
                          className={`border-b border-border dark:border-zinc-800/60 hover:bg-muted/30 cursor-pointer ${
                            isSelected ? "bg-indigo-500/5 dark:bg-indigo-500/10" : ""
                          }`}
                          onClick={() => {
                            setSelectedLead(lead);
                            setIsDetailSheetOpen(true);
                          }}
                        >
                          <TableCell className="px-3" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleSelectOne(lead.id)}
                              className="rounded border-input text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
                          </TableCell>

                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-xs">
                                {displayName.substring(0, 2).toUpperCase()}
                              </div>
                              <div className="flex flex-col">
                                <span className="text-sm font-semibold text-foreground line-clamp-1">
                                  {displayName}
                                </span>
                                {lead.extracted_from_wa && (
                                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                                    <Sparkles className="w-2.5 h-2.5" /> Extraído via WA
                                  </span>
                                )}
                              </div>
                            </div>
                          </TableCell>

                          <TableCell className="text-xs">
                            {lead.assigned_to ? (
                              <Badge variant="outline" className="text-[10px] font-normal py-0.5 border-sky-500/30 bg-sky-500/5 text-sky-700 dark:text-sky-300">
                                {operatorOptions.find((op) => op.uid === lead.assigned_to)?.displayName ||
                                  operatorOptions.find((op) => op.uid === lead.assigned_to)?.email ||
                                  "Atribuído"}
                              </Badge>
                            ) : (
                              <span className="text-[11px] text-muted-foreground italic">Compartilhado</span>
                            )}
                          </TableCell>

                          <TableCell>
                            {renderSourceBadge(getLeadSource(lead))}
                          </TableCell>

                          <TableCell className="text-xs font-mono text-muted-foreground">
                            {displayPhone}
                          </TableCell>

                          <TableCell>{getStageBadge(lead.stage, lead.lost_reason, lead.stage_source)}</TableCell>

                          <TableCell>{getTemperatureBadge(lead.temperature)}</TableCell>

                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {Array.isArray(lead.tags) && lead.tags.length > 0 ? (
                                lead.tags.map((tag, idx) => (
                                  <Badge
                                    key={idx}
                                    variant="secondary"
                                    className="text-[10px] px-1.5 py-0 bg-secondary/60 text-secondary-foreground"
                                  >
                                    {tag}
                                  </Badge>
                                ))
                              ) : (
                                <span className="text-xs text-muted-foreground italic">-</span>
                              )}
                            </div>
                          </TableCell>

                          <TableCell className="text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {lastInteraction}
                            </div>
                          </TableCell>

                          <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                title="Marcar como Cliente"
                                onClick={() => openMarkAsClientModal({ type: "single", leadId: lead.id })}
                                className="h-8 w-8 p-0 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10 dark:text-emerald-400"
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                title="Marcar como Perdido"
                                onClick={() => openMarkAsLostModal({ type: "single", leadId: lead.id })}
                                className="h-8 w-8 p-0 text-rose-600 border-rose-500/30 hover:bg-rose-500/10 dark:text-rose-400"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                title={Boolean(lead.raw_chat_summary && String(lead.raw_chat_summary).trim().length > 0) ? "Abrir conversa" : "Iniciar conversa"}
                                onClick={() => handleSendWhatsApp(displayPhone, displayName, lead.raw_chat_summary)}
                                className="h-8 text-xs gap-1.5 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10 dark:text-emerald-400 font-medium px-2.5 whitespace-nowrap"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                                {Boolean(lead.raw_chat_summary && String(lead.raw_chat_summary).trim().length > 0) ? "Abrir conversa" : "Iniciar conversa"}
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}

            {/* Rodapé de Paginação */}
            {filteredLeads.length > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-border dark:border-zinc-800 bg-muted/20 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-muted-foreground">
                    Exibindo <span className="font-semibold text-foreground">{Math.min(filteredLeads.length, (currentPage - 1) * pageSize + 1)}</span>–<span className="font-semibold text-foreground">{Math.min(currentPage * pageSize, filteredLeads.length)}</span> de <span className="font-semibold text-foreground">{filteredLeads.length.toLocaleString("pt-BR")}</span> leads
                  </span>

                  <div className="flex items-center gap-1.5">
                    <span className="text-muted-foreground text-[11px]">Por página:</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setCurrentPage(1);
                      }}
                      className="h-7 px-2 rounded-md border border-input bg-background text-xs font-semibold text-foreground focus:ring-1 focus:ring-ring cursor-pointer"
                    >
                      <option value={50}>50 leads</option>
                      <option value={100}>100 leads</option>
                      <option value={25}>25 leads</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                    className="h-7 px-2 text-xs"
                  >
                    Primeira
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                    className="h-7 px-2.5 text-xs"
                  >
                    Anterior
                  </Button>

                  <div className="px-2 text-xs font-medium text-foreground">
                    Página <span className="font-bold">{currentPage}</span> de <span className="font-bold">{totalPages}</span>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage >= totalPages}
                    className="h-7 px-2.5 text-xs"
                  >
                    Próxima
                  </Button>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage >= totalPages}
                    className="h-7 px-2 text-xs"
                  >
                    Última
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Barra Flutuante de Ações em Lote (Bulk Actions) */}
        {selectedLeadIds.length > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-3 border border-zinc-700 animate-in fade-in slide-in-from-bottom-4">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-indigo-500 text-white">
              {selectedLeadIds.length} selecionados
            </span>

            <div className="h-4 w-px bg-zinc-700 dark:bg-zinc-300" />

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsFollowupModalOpen(true)}
              className="text-xs h-8 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-indigo-400 hover:text-indigo-300 font-semibold gap-1.5"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Aplicar Follow-up
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsSingleReminderModalOpen(true)}
              className="text-xs h-8 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-emerald-400 hover:text-emerald-300 font-semibold gap-1.5"
            >
              <Clock className="w-3.5 h-3.5" />
              Lembrete avulso
            </Button>

            {canManageUsers && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setIsBulkAssignModalOpen(true)}
                className="text-xs h-8 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-sky-400 hover:text-sky-300 font-semibold gap-1.5"
              >
                <UserCheck className="w-3.5 h-3.5" />
                Reatribuir Responsável
              </Button>
            )}

            <Button
              size="sm"
              variant="ghost"
              onClick={() => openMarkAsClientModal({ type: "bulk", leadIds: selectedLeadIds })}
              className="text-xs h-8 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-emerald-400 hover:text-emerald-300 font-semibold gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Marcar Cliente ({selectedLeadIds.length})
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => openMarkAsLostModal({ type: "bulk", leadIds: selectedLeadIds })}
              className="text-xs h-8 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-rose-400 hover:text-rose-300 font-semibold gap-1.5"
            >
              <XCircle className="w-3.5 h-3.5" />
              Marcar Perdido ({selectedLeadIds.length})
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsBulkStageModalOpen(true)}
              className="text-xs h-8 hover:bg-zinc-800 dark:hover:bg-zinc-200"
            >
              Alterar Estágio
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsBulkTagModalOpen(true)}
              className="text-xs h-8 hover:bg-zinc-800 dark:hover:bg-zinc-200"
            >
              Adicionar Tag
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={handleExportXLSX}
              className="text-xs h-8 hover:bg-zinc-800 dark:hover:bg-zinc-200"
            >
              Exportar
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={handleBulkDeleteSubmit}
              className="text-xs h-8 text-rose-400 hover:text-rose-300 hover:bg-rose-900/30"
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              Excluir
            </Button>

            <Button
              size="icon"
              variant="ghost"
              onClick={() => setSelectedLeadIds([])}
              className="h-7 w-7 text-zinc-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Modal A) Mineração Semântica via WhatsApp */}
      <Dialog open={isWAModalOpen} onOpenChange={setIsWAModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="w-5 h-5 text-emerald-500" />
              Mineração Semântica via WhatsApp
            </DialogTitle>

            <DialogDescription>
              Conecte-se à Evolution API para extrair automaticamente contatos e enriquecer leads com inteligência semântica.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div>
              <label className="text-xs font-semibold text-foreground">Instância Conectada</label>
              <select
                value={selectedInstanceId}
                onChange={(e) => setSelectedInstanceId(e.target.value)}
                className="w-full h-9 px-3 mt-1 rounded-md border border-input bg-background text-xs"
              >
                {evolutionInstances.length === 0 ? (
                  <option value="">Buscar instâncias ativas do tenant...</option>
                ) : (
                  evolutionInstances.map((inst) => (
                    <option key={inst.id} value={inst.id}>
                      {inst.name} {inst.is_default ? "(Padrão)" : ""} ({inst.active !== false ? "Conectado" : "Desconectado"})
                    </option>
                  ))
                )}
              </select>
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground">Limite de Conversas para Analisar</label>
              <div className="grid grid-cols-4 gap-1.5 mt-1.5">
                {[
                  { value: 50, label: "50" },
                  { value: 100, label: "100" },
                  { value: 500, label: "500" },
                  { value: "all", label: "Ilimitado" },
                ].map((opt) => {
                  const isLocked = opt.value === "all" && !isAdvancedPlan;
                  return (
                    <Button
                      key={String(opt.value)}
                      type="button"
                      variant={waChatLimit === (opt.value as any) ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        if (isLocked) {
                          toast.info("A extração ilimitada de contatos é exclusiva do Plano Avançado. No Plano Essencial o limite é de até 500 contatos.");
                          return;
                        }
                        setWaChatLimit(opt.value as any);
                      }}
                      className={cn(
                        "text-xs gap-1",
                        isLocked && "opacity-75 border-dashed"
                      )}
                    >
                      {opt.label} {opt.value !== "all" ? "chats" : ""}
                      {isLocked && <Lock className="w-3 h-3 text-amber-500 shrink-0" />}
                    </Button>
                  );
                })}
              </div>
            </div>

            {isExtractingWA && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-center space-y-2">
                <RefreshCw className="w-5 h-5 text-emerald-600 animate-spin mx-auto" />
                <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  {waExtractStep || "Minerando contatos..."}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsWAModalOpen(false)} disabled={isExtractingWA}>
              Cancelar
            </Button>
            <Button
              onClick={handleExtractWA}
              disabled={isExtractingWA}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isExtractingWA ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
              Iniciar Extração
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal B) Importar Planilha (Excel .xlsx / .xls + CSV) */}
      <Dialog open={isImportModalOpen} onOpenChange={setIsImportModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="w-5 h-5 text-indigo-500" />
              Importar Planilha de Leads (.xlsx / .csv)
            </DialogTitle>

            <DialogDescription>
              Selecione o arquivo Excel ou CSV. O sistema realiza higienização automática no padrão E.164 (+55...).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border dark:border-zinc-800 rounded-lg p-6 text-center cursor-pointer hover:border-indigo-500 transition-colors"
            >
              <Upload className="w-8 h-8 text-muted-foreground mx-auto mb-2 opacity-60" />
              <p className="text-sm font-medium text-foreground">
                {importFile ? importFile.name : "Clique para selecionar a planilha (.xlsx, .xls, .csv)"}
              </p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv, .xlsx, .xls, .ods"
                className="hidden"
                onChange={handleImportFileSelect}
              />
            </div>

            {importFile && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg border border-indigo-100 bg-indigo-50/40 dark:border-indigo-900/30 dark:bg-indigo-950/20 text-xs">
                  <div>
                    <label className="font-semibold text-foreground">DDD padrão para números sem DDD:</label>
                    <p className="text-[10px] text-muted-foreground">Números com 8 ou 9 dígitos serão completados com este DDD e DDI 55.</p>
                  </div>
                  <Input
                    placeholder="34"
                    maxLength={2}
                    value={importDefaultDdd}
                    onChange={(e) => handleDefaultDddChange(e.target.value)}
                    className="h-8 w-16 text-xs text-center font-mono font-bold border-indigo-200 bg-white dark:bg-slate-900"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                    <TagIcon className="w-3.5 h-3.5 text-indigo-500" /> Tag de Origem / Tags Personalizadas
                  </label>
                  <Input
                    placeholder="Ex: #Imp-Lista_Clinica, Vendas_Junho"
                    value={importTagInput}
                    onChange={(e) => setImportTagInput(e.target.value)}
                    className="text-xs mt-1"
                  />
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    Esta tag será vinculada a todos os contatos desta importação para permitir filtros rápidos.
                  </p>
                </div>

                <div className="bg-muted/40 border border-border rounded-md p-3 text-xs space-y-2">
                  <div className="space-y-1">
                    {importAuditStats.completedCount > 0 ? (
                      <p className="font-medium text-emerald-600 dark:text-emerald-400">
                        ⚡ {importAuditStats.completedCount} números serão completados com {importDefaultDdd ? `DDD ${importDefaultDdd} e ` : ""}DDI 55.
                      </p>
                    ) : (
                      <p className="font-medium text-emerald-600 dark:text-emerald-400">
                        ✓ {importAuditStats.valid} contatos válidos no padrão +55...
                      </p>
                    )}
                    {importAuditStats.incompleteCount > 0 && (
                      <p className="text-amber-600 dark:text-amber-400">
                        ⚠ {importAuditStats.incompleteCount} números ficaram incompletos e não serão importados.
                      </p>
                    )}
                  </div>

                  {(importAuditStats.completedCount > 0 || importAuditStats.incompleteCount > 0) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowImportAuditModal(true)}
                      className="h-6 px-0 text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline"
                    >
                      🔍 Ver lista dos completados (original → resultado) e incompletos
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsImportModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleImportSubmit}
              disabled={!importFile || isUploadingImport || importSanitizePreview.validCount === 0}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {isUploadingImport ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
              Processar e Importar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Detalhes da Auditoria de Números na Importação */}
      <Dialog open={showImportAuditModal} onOpenChange={setShowImportAuditModal}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-indigo-500" />
              Auditoria de Telefones da Planilha
            </DialogTitle>
            <DialogDescription className="text-xs">
              Veja exatamente como cada número será tratado antes de salvar no Banco de Dados.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 flex-1 overflow-y-auto min-h-0 text-xs">
            {importAuditStats.completedCount > 0 && (
              <div className="space-y-2">
                <p className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Números Completados com Sucesso ({importAuditStats.completedList.length}):
                </p>
                <div className="rounded-lg border border-border bg-background overflow-hidden max-h-48 overflow-y-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-muted/50 font-semibold border-b border-border sticky top-0">
                      <tr>
                        <th className="p-2">Original na Planilha</th>
                        <th className="p-2">Resultado Higienizado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-mono">
                      {importAuditStats.completedList.map((item, i) => (
                        <tr key={i} className="hover:bg-muted/20">
                          <td className="p-2 text-muted-foreground">{item.original}</td>
                          <td className="p-2 text-emerald-600 dark:text-emerald-400 font-bold">{item.result}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {importAuditStats.incompleteCount > 0 && (
              <div className="space-y-2">
                <p className="font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Números Incompletos / Descartados ({importAuditStats.incompleteList.length}):
                </p>
                <div className="rounded-lg border border-border bg-background overflow-hidden max-h-48 overflow-y-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-muted/50 font-semibold border-b border-border sticky top-0">
                      <tr>
                        <th className="p-2">Original na Planilha</th>
                        <th className="p-2">Motivo</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border font-mono">
                      {importAuditStats.incompleteList.map((item, i) => (
                        <tr key={i} className="hover:bg-muted/20">
                          <td className="p-2 text-rose-500 font-medium">{item.original}</td>
                          <td className="p-2 text-muted-foreground font-sans">{item.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button size="sm" onClick={() => setShowImportAuditModal(false)} className="text-xs">
              Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Importador Inteligente de Conversas por I.A. */}
      <Dialog open={isAIImportModalOpen} onOpenChange={setIsAIImportModalOpen}>
        <DialogContent className={cn("transition-all", aiStep === 1 ? "sm:max-w-xl" : "sm:max-w-3xl max-h-[90vh] flex flex-col")}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-foreground">
              <Bot className="w-5 h-5 text-purple-600 dark:text-purple-400" />
              Importador Inteligente com IA
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              {aiStep === 1
                ? "Cole conversas do Direct, WhatsApp, E-mail ou LinkedIn. A IA extrai nomes, telefones, interesses e qualificação automaticamente."
                : "Revise e edite os contatos encontrados antes de salvar no Banco de Dados."}
            </DialogDescription>
          </DialogHeader>

          {aiStep === 1 ? (
            <div className="space-y-4 py-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Origem Padrão dos Contatos</Label>
                <Select value={aiDefaultOrigin} onValueChange={setAiDefaultOrigin}>
                  <SelectTrigger className="h-9 text-xs rounded-xl">
                    <SelectValue placeholder="Selecione a origem..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Instagram Direct">📸 Instagram Direct</SelectItem>
                    <SelectItem value="LinkedIn">💼 LinkedIn</SelectItem>
                    <SelectItem value="Facebook Messenger">💬 Facebook Messenger</SelectItem>
                    <SelectItem value="TikTok">🎵 TikTok</SelectItem>
                    <SelectItem value="E-mail">✉️ E-mail</SelectItem>
                    <SelectItem value="WhatsApp Export">📱 WhatsApp Export</SelectItem>
                    <SelectItem value="Outro Canal">🌐 Outro Canal</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">Texto ou Diálogo do Chat</Label>
                <Textarea
                  value={aiRawText}
                  onChange={(e) => setAiRawText(e.target.value)}
                  placeholder={"Cole aqui o texto ou conversa do Direct/E-mail... Ex:\nJoão Silva: vi o anúncio no Insta, meu zap é (34) 99999-9999, quanto custa o serviço?"}
                  rows={8}
                  className="text-xs resize-none rounded-xl bg-background font-mono leading-relaxed"
                />
              </div>

              <DialogFooter className="pt-2">
                <Button variant="outline" size="sm" onClick={() => setIsAIImportModalOpen(false)}>
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={handleAnalyzeWithAI}
                  disabled={!aiRawText.trim() || isAiAnalyzing}
                  className="bg-purple-600 hover:bg-purple-700 text-white gap-2 text-xs font-semibold shadow-xs"
                >
                  {isAiAnalyzing ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Analisando com IA...
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-3.5 h-3.5" />
                      Analisar com IA
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <div className="space-y-4 py-2 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Badge variant="outline" className="bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/30">
                    {aiExtractedLeads.length} contato(s) encontrado(s)
                  </Badge>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAiStep(1)}
                  className="text-xs text-muted-foreground hover:text-foreground h-7"
                >
                  ← Voltar / Novo Texto
                </Button>
              </div>

              <div className="flex-1 overflow-y-auto border border-border/80 rounded-xl max-h-[380px]">
                <Table>
                  <TableHeader className="bg-muted/40 sticky top-0 z-10">
                    <TableRow>
                      <TableHead className="text-[11px] font-bold">Nome</TableHead>
                      <TableHead className="text-[11px] font-bold">Telefone</TableHead>
                      <TableHead className="text-[11px] font-bold">Origem</TableHead>
                      <TableHead className="text-[11px] font-bold">Interesse</TableHead>
                      <TableHead className="text-[11px] font-bold">Temperatura</TableHead>
                      <TableHead className="w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {aiExtractedLeads.map((lead, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="p-2">
                          <Input
                            value={lead.nome}
                            onChange={(e) => {
                              const updated = [...aiExtractedLeads];
                              updated[idx].nome = e.target.value;
                              setAiExtractedLeads(updated);
                            }}
                            className="h-7 text-xs"
                          />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input
                            value={lead.telefone || ""}
                            onChange={(e) => {
                              const updated = [...aiExtractedLeads];
                              updated[idx].telefone = e.target.value;
                              setAiExtractedLeads(updated);
                            }}
                            placeholder="DDD + Número"
                            className="h-7 text-xs font-mono"
                          />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input
                            value={lead.origem}
                            onChange={(e) => {
                              const updated = [...aiExtractedLeads];
                              updated[idx].origem = e.target.value;
                              setAiExtractedLeads(updated);
                            }}
                            className="h-7 text-xs"
                          />
                        </TableCell>
                        <TableCell className="p-2">
                          <Input
                            value={lead.interesse}
                            onChange={(e) => {
                              const updated = [...aiExtractedLeads];
                              updated[idx].interesse = e.target.value;
                              setAiExtractedLeads(updated);
                            }}
                            className="h-7 text-xs"
                          />
                        </TableCell>
                        <TableCell className="p-2">
                          <Select
                            value={lead.temperatura}
                            onValueChange={(val: "Quente" | "Morno" | "Frio") => {
                              const updated = [...aiExtractedLeads];
                              updated[idx].temperatura = val;
                              setAiExtractedLeads(updated);
                            }}
                          >
                            <SelectTrigger className="h-7 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="Quente">🔥 Quente</SelectItem>
                              <SelectItem value="Morno">☀️ Morno</SelectItem>
                              <SelectItem value="Frio">❄️ Frio</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell className="p-2 text-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              setAiExtractedLeads((prev) => prev.filter((_, i) => i !== idx));
                            }}
                            className="h-7 w-7 text-muted-foreground hover:text-red-500"
                            title="Remover este contato"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <DialogFooter className="pt-2">
                <Button variant="outline" size="sm" onClick={() => setAiStep(1)}>
                  Voltar
                </Button>
                <Button
                  size="sm"
                  onClick={handleSaveAiLeads}
                  disabled={aiExtractedLeads.length === 0 || isAiSaving}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2 text-xs font-semibold shadow-xs"
                >
                  {isAiSaving ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      Salvando Contatos...
                    </>
                  ) : (
                    <>
                      <Rocket className="w-3.5 h-3.5" />
                      Salvar Contatos no Banco de Dados
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Modal Wizard: Criar Nova Campanha & Seleção de Público Alvo */}
      <Dialog open={isCampaignWizardOpen} onOpenChange={setIsCampaignWizardOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg">
              <Rocket className="w-5 h-5 text-amber-500" />
              Criar Nova Campanha — Configuração do Público-Alvo
            </DialogTitle>
            <DialogDescription>
              Escolha a origem dos contatos e aplique filtros dinâmicos por variáveis antes de enviar a campanha.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 py-2">
            {/* Escolha da Origem */}
            <div>
              <label className="text-xs font-bold text-foreground uppercase tracking-wider block mb-2">
                1. Origem dos Leads
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div
                  onClick={() => setCampaignSourceType("funnel")}
                  className={`border rounded-lg p-3.5 cursor-pointer transition-all flex items-start gap-3 ${
                    campaignSourceType === "funnel"
                      ? "border-amber-500 bg-amber-500/10 dark:bg-amber-500/20"
                      : "border-border hover:border-amber-500/40"
                  }`}
                >
                  <Database className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-foreground">Leads do Banco Inteligente</h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Filtrar por estágio do funil, tags, temperatura ou variáveis salvas.
                    </p>
                  </div>
                </div>

                <div
                  onClick={() => setCampaignSourceType("spreadsheet")}
                  className={`border rounded-lg p-3.5 cursor-pointer transition-all flex items-start gap-3 ${
                    campaignSourceType === "spreadsheet"
                      ? "border-amber-500 bg-amber-500/10 dark:bg-amber-500/20"
                      : "border-border hover:border-amber-500/40"
                  }`}
                >
                  <FileSpreadsheet className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-foreground">Planilha Externa (.xlsx / .csv)</h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Carregar ou importar planilha com mapeamento de colunas dinâmicas.
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Opção A: Filtros e Seleção do Funil */}
            {campaignSourceType === "funnel" ? (
              <div className="space-y-4 border-t border-border pt-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-foreground">Estágios do Funil (Múltipla Seleção)</label>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full h-9 justify-between text-xs px-3 font-normal mt-1 border-input bg-background"
                        >
                          <span className="truncate">
                            {campaignStageFilters.includes("all") || campaignStageFilters.length === 0
                              ? `Todos os Estágios (${leads.length})`
                              : `${campaignStageFilters.length} Estágios: ${campaignStageFilters
                                  .map((s) =>
                                    s === "buyer"
                                      ? "Compradores 🟢"
                                      : s === "open_budget"
                                      ? "Orçamentos 🟡"
                                      : s === "inquiry"
                                      ? "Em Dúvida 🔵"
                                      : s === "cold"
                                      ? "Frios ⚪"
                                      : "Perdidos 🔴"
                                  )
                                  .join(", ")}`}
                          </span>
                          <ChevronDown className="w-4 h-4 ml-1 opacity-50 shrink-0" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-64 p-2 space-y-1 z-[100]">
                        <div
                          onClick={() => setCampaignStageFilters(["all"])}
                          className={`flex items-center gap-2 px-2.5 py-1.5 rounded text-xs cursor-pointer hover:bg-muted font-medium ${
                            campaignStageFilters.includes("all") || campaignStageFilters.length === 0 ? "bg-amber-500/10 text-amber-600 font-semibold" : ""
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={campaignStageFilters.includes("all") || campaignStageFilters.length === 0}
                            onChange={() => {}}
                            className="rounded text-amber-600 cursor-pointer"
                          />
                          <span>Todos os Estágios ({leads.length})</span>
                        </div>

                        <div className="h-px bg-border my-1" />

                        {[
                          { id: "buyer", label: "Compradores 🟢", count: summary.buyersCount },
                          { id: "open_budget", label: "Orçamentos Abertos 🟡", count: summary.openBudgetsCount },
                          { id: "inquiry", label: "Em Dúvida 🔵", count: leads.filter((l) => l.stage === "inquiry").length },
                          { id: "cold", label: "Leads Frios ⚪", count: leads.filter((l) => l.stage === "cold").length },
                          { id: "lost", label: "Perdidos 🔴", count: leads.filter((l) => l.stage === "lost").length },
                        ].map((stageItem) => {
                          const isChecked = !campaignStageFilters.includes("all") && campaignStageFilters.includes(stageItem.id);
                          return (
                            <div
                              key={stageItem.id}
                              onClick={() => {
                                let next: string[] = [];
                                if (campaignStageFilters.includes("all")) {
                                  next = [stageItem.id];
                                } else if (isChecked) {
                                  next = campaignStageFilters.filter((s) => s !== stageItem.id);
                                  if (next.length === 0) next = ["all"];
                                } else {
                                  next = [...campaignStageFilters, stageItem.id];
                                }
                                setCampaignStageFilters(next);
                              }}
                              className={`flex items-center justify-between px-2.5 py-1.5 rounded text-xs cursor-pointer hover:bg-muted ${
                                isChecked ? "bg-amber-500/10 text-amber-600 font-semibold" : ""
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => {}}
                                  className="rounded text-amber-600 cursor-pointer"
                                />
                                <span>{stageItem.label}</span>
                              </div>
                              <span className="text-[10px] text-muted-foreground">({stageItem.count})</span>
                            </div>
                          );
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-foreground">Filtrar por Tag</label>
                    <select
                      value={campaignTagFilter}
                      onChange={(e) => setCampaignTagFilter(e.target.value)}
                      className="w-full h-9 px-3 mt-1 rounded-md border border-input bg-background text-xs"
                    >
                      <option value="">Todas as Tags</option>
                      {availableTags.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Seleção Manual com Tabela */}
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="bg-muted/50 px-3 py-2 border-b border-border flex items-center justify-between text-xs font-semibold">
                    <span>Lista de Leads Selecionados ({campaignSelectedLeadIds.length} de {campaignFunnelFilteredLeads.length})</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[11px] px-2"
                      onClick={() => {
                        if (campaignSelectedLeadIds.length === campaignFunnelFilteredLeads.length) {
                          setCampaignSelectedLeadIds([]);
                        } else {
                          setCampaignSelectedLeadIds(campaignFunnelFilteredLeads.map((l) => l.id));
                        }
                      }}
                    >
                      {campaignSelectedLeadIds.length === campaignFunnelFilteredLeads.length ? "Desmarcar Todos" : "Selecionar Todos"}
                    </Button>
                  </div>

                  <div className="max-h-48 overflow-y-auto">
                    <Table>
                      <TableBody>
                        {campaignFunnelFilteredLeads.map((l) => {
                          const isSel = campaignSelectedLeadIds.includes(l.id);
                          return (
                            <TableRow
                              key={l.id}
                              className="cursor-pointer hover:bg-muted/40"
                              onClick={() => {
                                setCampaignSelectedLeadIds((prev) =>
                                  prev.includes(l.id) ? prev.filter((id) => id !== l.id) : [...prev, l.id]
                                );
                              }}
                            >
                              <TableCell className="w-[30px] px-3">
                                <input type="checkbox" checked={isSel} onChange={() => {}} className="rounded" />
                              </TableCell>
                              <TableCell className="text-xs font-medium">{l.nome || "Sem Nome"}</TableCell>
                              <TableCell className="text-xs font-mono text-muted-foreground">{l.phone || l.telefone}</TableCell>
                              <TableCell className="text-xs">{getStageBadge(l.stage)}</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>
            ) : (
              /* Opção B: Upload e Filtro por Variáveis da Planilha */
              <div className="space-y-4 border-t border-border pt-4">
                <div
                  onClick={() => campaignFileInputRef.current?.click()}
                  className="border-2 border-dashed border-border rounded-lg p-5 text-center cursor-pointer hover:border-amber-500 transition-colors"
                >
                  <FileSpreadsheet className="w-7 h-7 text-amber-500 mx-auto mb-1" />
                  <p className="text-xs font-semibold text-foreground">
                    {campaignFile ? campaignFile.name : "Clique para carregar planilha (.xlsx, .xls, .csv)"}
                  </p>
                  <input
                    ref={campaignFileInputRef}
                    type="file"
                    accept=".csv, .xlsx, .xls, .ods"
                    className="hidden"
                    onChange={handleCampaignFileSelect}
                  />
                </div>

                {/* Filtros por Variáveis Dinâmicas da Planilha */}
                {campaignSpreadsheetColumns.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-bold text-foreground flex items-center gap-1">
                        <Filter className="w-3.5 h-3.5 text-amber-500" />
                        Filtros por Coluna / Variáveis Identificadas na Planilha
                      </label>

                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setCampaignSpreadsheetRules((prev) => [
                            ...prev,
                            { id: String(Date.now()), column: campaignSpreadsheetColumns[0] || "", operator: "equals", value: "" },
                          ])
                        }
                        className="h-7 text-[11px] gap-1"
                      >
                        <Plus className="w-3 h-3" /> Adicionar Filtro por Variável
                      </Button>
                    </div>

                    {campaignSpreadsheetRules.map((rule, idx) => (
                      <div key={rule.id} className="flex items-center gap-2 bg-muted/30 p-2 rounded-md border border-border">
                        <select
                          value={rule.column}
                          onChange={(e) => {
                            const newCol = e.target.value;
                            setCampaignSpreadsheetRules((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, column: newCol } : r))
                            );
                          }}
                          className="h-8 px-2 text-xs rounded border border-input bg-background flex-1"
                        >
                          {campaignSpreadsheetColumns.map((col) => (
                            <option key={col} value={col}>
                              {col}
                            </option>
                          ))}
                        </select>

                        <select
                          value={rule.operator}
                          onChange={(e) => {
                            const newOp = e.target.value as any;
                            setCampaignSpreadsheetRules((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, operator: newOp } : r))
                            );
                          }}
                          className="h-8 px-2 text-xs rounded border border-input bg-background w-32"
                        >
                          <option value="equals">Igual a (=)</option>
                          <option value="contains">Contém</option>
                          <option value="gt">Maior que (&gt;)</option>
                          <option value="lt">Menor que (&lt;)</option>
                        </select>

                        <Input
                          placeholder="Valor (ex: Masculino, 5000...)"
                          value={rule.value}
                          onChange={(e) => {
                            const newVal = e.target.value;
                            setCampaignSpreadsheetRules((prev) =>
                              prev.map((r, i) => (i === idx ? { ...r, value: newVal } : r))
                            );
                          }}
                          className="h-8 text-xs flex-1"
                        />

                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setCampaignSpreadsheetRules((prev) => prev.filter((_, i) => i !== idx))}
                          className="h-8 w-8 text-rose-500 hover:bg-rose-500/10"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}

                    <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-2.5 text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between">
                      <span>Contatos Selecionados pela Regra:</span>
                      <span className="font-bold">{campaignSpreadsheetFilteredRows.length} de {campaignSpreadsheetRows.length}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCampaignWizardOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleProceedToCampaign}
              className="bg-amber-600 hover:bg-amber-700 text-white gap-2"
            >
              <Rocket className="w-4 h-4" />
              Avançar para Disparos ➔
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal C) Ticket Médio Config */}
      <Dialog open={isTicketModalOpen} onOpenChange={setIsTicketModalOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5 text-emerald-500" />
              Configurar Ticket Médio
            </DialogTitle>
            <DialogDescription>Defina o valor médio estimado por contrato no seu segmento.</DialogDescription>
          </DialogHeader>

          <div className="py-3">
            <label className="text-xs font-semibold text-foreground">Valor do Ticket Médio (R$)</label>
            <Input
              type="number"
              value={tempTicketInput}
              onChange={(e) => setTempTicketInput(e.target.value)}
              className="text-sm mt-1"
              placeholder="Ex: 2500"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsTicketModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              onClick={handleSaveTicketMedio}
              disabled={updateTicketMedioMutation.isPending}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {updateTicketMedioMutation.isPending ? "Salvando..." : "Salvar Valor"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Aplicar Follow-up nos leads selecionados */}
      <ApplyFollowupModal
        open={isFollowupModalOpen}
        onOpenChange={setIsFollowupModalOpen}
        clientId={clientId}
        apiBase={API_BASE_URL}
        getToken={getIdToken}
        leads={leads
          .filter((l) => selectedLeadIds.includes(l.id))
          .map((l) => ({ id: l.id, nome: l.nome, phone: l.phone, telefone: l.telefone }))}
      />

      {/* Modal Lembrete Avulso para Lead */}
      <SingleFollowupReminderModal
        open={isSingleReminderModalOpen}
        onOpenChange={setIsSingleReminderModalOpen}
        lead={
          selectedLeadIds.length > 0
            ? leads.find((l) => l.id === selectedLeadIds[0]) || null
            : null
        }
        tenantId={clientId}
      />

      {/* Modal Cadastro Manual */}
      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={handleCreateLead}>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Plus className="w-5 h-5 text-indigo-500" />
                Cadastrar Novo Lead Manual
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-3 py-4">
              <div>
                <label className="text-xs font-medium text-foreground">Nome Completo</label>
                <Input
                  placeholder="Ex: João da Silva"
                  value={newLeadName}
                  onChange={(e) => setNewLeadName(e.target.value)}
                  className="text-xs mt-1"
                />
              </div>

              <div>
                <label className="text-xs font-medium text-foreground">Telefone / WhatsApp (E.164)</label>
                <Input
                  placeholder="Ex: +5511999999999"
                  value={newLeadPhone}
                  onChange={(e) => setNewLeadPhone(e.target.value)}
                  className="text-xs mt-1"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium text-foreground">Estágio Inicial</label>
                  <select
                    value={newLeadStage}
                    onChange={(e: any) => setNewLeadStage(e.target.value)}
                    className="w-full h-9 px-3 mt-1 rounded-md border border-input bg-background text-xs"
                  >
                    <option value="cold">Lead Frio ⚪</option>
                    <option value="inquiry">Em Dúvida 🔵</option>
                    <option value="open_budget">Orçamento Aberto 🟡</option>
                    <option value="buyer">Comprador 🟢</option>
                    <option value="lost">Perdido 🔴</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-medium text-foreground">Temperatura</label>
                  <select
                    value={newLeadTemp}
                    onChange={(e: any) => setNewLeadTemp(e.target.value)}
                    className="w-full h-9 px-3 mt-1 rounded-md border border-input bg-background text-xs"
                  >
                    <option value="warm">Morno 🌤️</option>
                    <option value="hot">Quente 🔥</option>
                    <option value="cold">Frio ❄️</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-foreground">Tags (separadas por vírgula)</label>
                <Input
                  placeholder="Ex: Óculos de Sol, Prótese, WhatsApp"
                  value={newLeadTags}
                  onChange={(e) => setNewLeadTags(e.target.value)}
                  className="text-xs mt-1"
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsCreateModalOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 text-white">
                Salvar Lead
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Drawer Lateral (Sheet) de Detalhes do Lead */}
      <Sheet open={isDetailSheetOpen} onOpenChange={setIsDetailSheetOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selectedLead && (
            <div className="space-y-6 pt-4">
              <SheetHeader>
                <SheetTitle className="text-lg font-bold flex items-center justify-between">
                  <span>{selectedLead.nome || "Lead Sem Nome"}</span>
                </SheetTitle>
                <SheetDescription className="text-xs font-mono">
                  {selectedLead.phone || selectedLead.telefone}
                </SheetDescription>
              </SheetHeader>

              <div className="flex items-center gap-2">
                {getStageBadge(selectedLead.stage)}
                {getTemperatureBadge(selectedLead.temperature)}
              </div>

              {/* Resumo da IA */}
              {selectedLead.raw_chat_summary?.startsWith("🚫") ? (
                <div className="bg-muted/30 border border-border/70 rounded-lg p-3 space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <span className="text-sm">🚫</span>
                    <span>Conversa pessoal — sem oportunidade comercial</span>
                  </div>
                  <p className="text-xs text-muted-foreground/80 italic leading-relaxed whitespace-pre-line">
                    {selectedLead.raw_chat_summary.replace(/^🚫\uFE0F?\s*/u, "") || "Nenhuma intenção comercial detectada."}
                  </p>
                  {selectedLead.stage !== "lost" && (
                    <div className="pt-1.5 border-t border-border/40">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setMarkAsLostTarget({ type: "single", leadId: selectedLead.id });
                          setMarkAsLostReason("perfil");
                          setIsMarkAsLostModalOpen(true);
                        }}
                        className="h-7 text-xs gap-1.5 text-rose-600 border-rose-500/30 hover:bg-rose-500/10 dark:text-rose-400"
                      >
                        <XCircle className="w-3.5 h-3.5" />
                        Marcar como Perdido (Não era o perfil)
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-muted/40 border border-border rounded-lg p-3 space-y-1">
                  <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                    <Sparkles className="w-3.5 h-3.5" /> Resumo Semântico da IA
                  </span>
                  {/* O resumo vem em linhas (pontos-chave / diagnóstico / próxima
                      ação). whitespace-pre-line preserva a quebra; sem itálico e
                      sem aspas, porque não é mais citação da conversa. */}
                  <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-line">
                    {selectedLead.raw_chat_summary || "Sem histórico recente analisado."}
                  </p>
                </div>
              )}

              {/* Tags Management */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-foreground flex items-center gap-1">
                  <TagIcon className="w-3.5 h-3.5" /> Tags do Lead
                </label>
                <div className="flex flex-wrap gap-1">
                  {Array.isArray(selectedLead.tags) && selectedLead.tags.length > 0 ? (
                    selectedLead.tags.map((t) => (
                      <Badge
                        key={t}
                        variant="secondary"
                        className="text-xs gap-1 py-0.5 bg-secondary text-secondary-foreground"
                      >
                        {t}
                        <X
                          className="w-3 h-3 cursor-pointer hover:text-rose-500"
                          onClick={() => handleRemoveTagFromLead(selectedLead.id, t)}
                        />
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground italic">Nenhuma tag atribuída.</span>
                  )}
                </div>

                <div className="flex gap-2 mt-2">
                  <Input
                    placeholder="Adicionar nova tag..."
                    value={newTagInput}
                    onChange={(e) => setNewTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleAddTagToLead(selectedLead.id);
                      }
                    }}
                    className="text-xs h-8"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleAddTagToLead(selectedLead.id)}
                    className="h-8 text-xs"
                  >
                    Adicionar
                  </Button>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="space-y-3 pt-4 border-t border-border">
                <Button
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs gap-2"
                  onClick={() => handleSendWhatsApp(selectedLead.phone || selectedLead.telefone, selectedLead.nome, selectedLead.raw_chat_summary)}
                >
                  <MessageCircle className="w-4 h-4" />
                  {Boolean(selectedLead.raw_chat_summary && String(selectedLead.raw_chat_summary).trim().length > 0) ? "Abrir conversa" : "Iniciar conversa"}
                </Button>

                {/* Atribuição de Lead: Operador Responsável */}
                <div className="space-y-1.5 pt-1">
                  <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <UserCheck className="w-3.5 h-3.5 text-sky-500" /> Operador Responsável
                  </label>
                  {canManageUsers ? (
                    <Select
                      value={selectedLead.assigned_to || "none"}
                      onValueChange={(val) => handleUpdateLeadAssignedTo(selectedLead.id, val === "none" ? null : val)}
                    >
                      <SelectTrigger className="h-8 text-xs bg-background">
                        <SelectValue placeholder="Selecione o responsável" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Nenhum (compartilhado)</SelectItem>
                        {operatorOptions.map((op) => (
                          <SelectItem key={op.uid} value={op.uid}>
                            {op.displayName || op.email}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline" className="text-xs py-1 px-2.5 font-normal">
                      {selectedLead.assigned_to
                        ? operatorOptions.find((op) => op.uid === selectedLead.assigned_to)?.displayName ||
                          operatorOptions.find((op) => op.uid === selectedLead.assigned_to)?.email ||
                          selectedLead.assigned_to
                        : "Nenhum (compartilhado)"}
                    </Badge>
                  )}
                </div>

                {/* Indicador de Status especial (Buyer ou Lost) */}
                {selectedLead.stage === "buyer" && (
                  <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2.5 flex items-center justify-between text-xs">
                    <div>
                      <span className="font-semibold text-emerald-600 dark:text-emerald-400 block">Cliente Confirmado</span>
                      <span className="text-muted-foreground text-[11px]">
                        Origem: {selectedLead.stage_source === "integration" ? "Integração / Webhook" : "Manual"}
                      </span>
                    </div>
                    {selectedLead.potential_contract_value ? (
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">
                        R$ {Number(selectedLead.potential_contract_value).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                      </span>
                    ) : null}
                  </div>
                )}
                {selectedLead.stage === "lost" && (
                  <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-2.5 text-xs">
                    <span className="font-semibold text-rose-600 dark:text-rose-400 block">Negócio Perdido</span>
                    <span className="text-muted-foreground text-[11px]">
                      Motivo: {LOST_REASONS.find((r) => r.id === selectedLead.lost_reason)?.label || selectedLead.lost_reason || "Não informado"}
                    </span>
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-foreground block mb-1">Alterar Estágio</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <Button
                      size="sm"
                      variant={selectedLead.stage === "buyer" ? "default" : "outline"}
                      onClick={() => openMarkAsClientModal({ type: "single", leadId: selectedLead.id })}
                      className="text-xs"
                    >
                      Comprador 🟢
                    </Button>
                    <Button
                      size="sm"
                      variant={selectedLead.stage === "open_budget" ? "default" : "outline"}
                      onClick={() => handleUpdateLeadStage(selectedLead.id, "open_budget")}
                      className="text-xs"
                    >
                      Orçamento Aberto 🟡
                    </Button>
                    <Button
                      size="sm"
                      variant={selectedLead.stage === "cold" ? "default" : "outline"}
                      onClick={() => handleUpdateLeadStage(selectedLead.id, "cold")}
                      className="text-xs"
                    >
                      Lead Frio ⚪
                    </Button>
                    <Button
                      size="sm"
                      variant={selectedLead.stage === "lost" ? "default" : "outline"}
                      onClick={() => openMarkAsLostModal({ type: "single", leadId: selectedLead.id })}
                      className="text-xs"
                    >
                      Perdido 🔴
                    </Button>
                  </div>
                </div>

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleDeleteSingleLead(selectedLead.id)}
                  className="w-full text-xs gap-2 mt-4"
                >
                  <Trash2 className="w-4 h-4" />
                  Excluir Lead
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Modal Bulk Change Stage */}
      <Dialog open={isBulkStageModalOpen} onOpenChange={setIsBulkStageModalOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold">Alterar Estágio em Lote</DialogTitle>
          </DialogHeader>
          <div className="py-3 space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">Novo Estágio</label>
              <select
                value={bulkStageValue}
                onChange={(e: any) => setBulkStageValue(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-xs"
              >
                <option value="cold">Lead Frio ⚪</option>
                <option value="inquiry">Em Dúvida 🔵</option>
                <option value="open_budget">Orçamento Aberto 🟡</option>
                <option value="buyer">Comprador 🟢</option>
                <option value="lost">Perdido 🔴</option>
              </select>
            </div>

            {bulkStageValue === "buyer" && (
              <div>
                <label className="text-xs font-medium text-foreground block mb-1">
                  Valor do Contrato Fechado (R$, opcional)
                </label>
                <Input
                  type="number"
                  placeholder="Ex: 5000"
                  value={bulkContractValue}
                  onChange={(e) => setBulkContractValue(e.target.value)}
                  className="text-xs h-9"
                />
              </div>
            )}

            {bulkStageValue === "lost" && (
              <div>
                <label className="text-xs font-medium text-foreground block mb-1">
                  Motivo da Perda
                </label>
                <select
                  value={bulkLostReason}
                  onChange={(e) => setBulkLostReason(e.target.value)}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-xs"
                >
                  {LOST_REASONS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsBulkStageModalOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleBulkStageSubmit} className="bg-indigo-600 text-white">
              Aplicar a {selectedLeadIds.length} leads
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Marcar como Cliente */}
      <Dialog open={isMarkAsClientModalOpen} onOpenChange={setIsMarkAsClientModalOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="w-4 h-4" />
              Marcar como Cliente
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {markAsClientTarget?.type === "bulk"
                ? `Confirmar fechamento de negócio para os ${markAsClientTarget.leadIds.length} leads selecionados. Este status é manual e protegido contra inteligência automática.`
                : "Confirmar que o lead fechou negócio. Este status é manual e protegido contra inteligência automática."}
            </p>
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1">
                Valor do Contrato Fechado (R$, opcional)
              </label>
              <Input
                type="number"
                placeholder="Ex: 5000"
                value={markAsClientValue}
                onChange={(e) => setMarkAsClientValue(e.target.value)}
                className="text-xs h-9"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsMarkAsClientModalOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleConfirmMarkAsClient} className="bg-emerald-600 hover:bg-emerald-700 text-white">
              Confirmar Cliente 🟢
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Marcar como Perdido */}
      <Dialog open={isMarkAsLostModalOpen} onOpenChange={setIsMarkAsLostModalOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
              <XCircle className="w-4 h-4" />
              Marcar como Perdido
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {markAsLostTarget?.type === "bulk"
                ? `Indique o motivo pelo qual estes ${markAsLostTarget.leadIds.length} leads não avançaram:`
                : "Indique o motivo pelo qual este lead não avançou:"}
            </p>
            <div>
              <label className="text-xs font-semibold text-foreground block mb-1">
                Motivo da Perda
              </label>
              <select
                value={markAsLostReason}
                onChange={(e) => setMarkAsLostReason(e.target.value)}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-xs"
              >
                {LOST_REASONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsMarkAsLostModalOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleConfirmMarkAsLost} className="bg-rose-600 hover:bg-rose-700 text-white">
              Confirmar Perdido 🔴
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Bulk Add Tag */}
      <Dialog open={isBulkTagModalOpen} onOpenChange={setIsBulkTagModalOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold">Adicionar Tag em Lote</DialogTitle>
          </DialogHeader>
          <div className="py-3">
            <Input
              placeholder="Digite a nova tag..."
              value={bulkTagValue}
              onChange={(e) => setBulkTagValue(e.target.value)}
              className="text-xs"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsBulkTagModalOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleBulkTagSubmit} className="bg-indigo-600 text-white">
              Adicionar Tag
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Bulk Reassign */}
      <Dialog open={isBulkAssignModalOpen} onOpenChange={setIsBulkAssignModalOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-sky-500" />
              Reatribuir Responsável em Lote
            </DialogTitle>
          </DialogHeader>
          <div className="py-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Selecione o operador responsável para os {selectedLeadIds.length} leads selecionados:
            </p>
            <Select
              value={bulkAssignValue}
              onValueChange={setBulkAssignValue}
            >
              <SelectTrigger className="h-9 text-xs bg-background">
                <SelectValue placeholder="Selecione um operador" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Nenhum (desatribuir / compartilhado)</SelectItem>
                {operatorOptions.map((op) => (
                  <SelectItem key={op.uid} value={op.uid}>
                    {op.displayName || op.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setIsBulkAssignModalOpen(false)}>
              Cancelar
            </Button>
            <Button size="sm" onClick={handleBulkAssignSubmit} className="bg-sky-600 hover:bg-sky-700 text-white">
              Reatribuir {selectedLeadIds.length} leads
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Compacto de Upsell de Origens */}
      <Dialog open={isOriginUpsellModalOpen} onOpenChange={setIsOriginUpsellModalOpen}>
        <DialogContent className="sm:max-w-md bg-card border-border shadow-2xl">
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-500 to-purple-600 text-white flex items-center justify-center shadow-md shadow-purple-500/20">
                <Target className="w-4 h-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-bold flex items-center gap-1.5">
                  🎯 Rastreamento & Atribuição de Origens
                </DialogTitle>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <Badge className="bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30 text-[10px] px-1.5 py-0 font-bold">
                    Exclusivo do Plano Avançado
                  </Badge>
                </div>
              </div>
            </div>
            <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
              Descubra exatamente de onde vem cada lead (Instagram, Google, TikTok, Indicação) e meça a conversão real de cada canal de aquisição.
            </DialogDescription>
          </DialogHeader>

          <div className="bg-muted/40 dark:bg-zinc-900/60 border border-border/80 dark:border-zinc-800/80 rounded-xl p-3 text-left space-y-2 my-1">
            <span className="text-[10px] font-bold text-foreground uppercase tracking-wider block">
              O que você ganha com este recurso:
            </span>
            <ul className="space-y-1.5 text-xs text-muted-foreground">
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span>Identificação automática da origem de cada contato e lead</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span>Filtros rápidos e segmentação de campanhas em 1 clique por canal</span>
              </li>
              <li className="flex items-start gap-2">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                <span>Métricas comparativas de conversão por fonte de tráfego</span>
              </li>
            </ul>
          </div>

          <DialogFooter className="flex flex-col sm:flex-col gap-2 pt-2">
            <Button
              className="w-full bg-gradient-to-r from-amber-500 to-purple-600 hover:from-amber-600 hover:to-purple-700 text-white font-bold text-xs gap-2 shadow-md shadow-purple-500/20"
              onClick={() => window.open(whatsappUrlUpgrade, "_blank")}
            >
              <Rocket className="w-3.5 h-3.5" />
              🚀 Fazer Upgrade para o Plano Avançado
            </Button>
            <Button
              variant="outline"
              className="w-full border-purple-500/40 text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 font-bold text-xs gap-2"
              onClick={() => window.open(whatsappUrlAvulso, "_blank")}
            >
              <Puzzle className="w-3.5 h-3.5" />
              🧩 Contratar Módulo Avulso
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setIsOriginUpsellModalOpen(false)}
            >
              Cancelar / Fechar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
