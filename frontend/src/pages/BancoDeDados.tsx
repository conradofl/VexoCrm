import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import * as XLSX from "xlsx";
import {
  Database,
  Phone,
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
  MoreHorizontal,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Instagram,
  HelpCircle,
  CheckSquare,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { InstagramImportModal } from "@/components/leads/InstagramImportModal";
import { ContactsWithoutChannelSection } from "@/components/leads/ContactsWithoutChannelSection";
import { useContactsWithoutChannel } from "@/hooks/useContactsWithoutChannel";
import { useAuth } from "@/contexts/AuthContext";
import { useAdminUsers } from "@/hooks/useAdminUsers";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { useUpdateLeadClientTicketMedio } from "@/hooks/useLeadClients";
import { calculateBasePotential, type BasePotentialSegmentId } from "@/lib/leads/basePotential";
import {
  AudienceRulesError,
  fetchAllLeadsForExport,
  fetchImportOrigin,
  fetchImportSources,
  fetchCampaignAudience,
  fetchLeadFacets,
  fetchLeadIds,
  fetchLeadLookup,
  fetchLeadPage,
  type AudienceLead,
  type LeadContact,
  type LeadFacetsResponse,
  type LeadListFilters,
  type ImportOrigin,
  type ImportSource,
  type ImportScope,
  type LeadRequest,
  type LeadTabCounts,
  secondNumberHandoffRows,
} from "@/lib/leads/leadListApi";
import { API_BASE_URL, fetchApi, readApiErrorMessage } from "@/lib/api";
import { cn } from "@/lib/utils";
import { resolveTenantPlan, hasFeatureUnlocked } from "@/lib/planTier";
import { sanitizePhone } from "@/lib/phone";
import ApplyFollowupModal from "@/components/followup/ApplyFollowupModal";
import { WaGroupExtractionSection, type WaGroupPreviewItem } from "@/components/leads/WaGroupExtractionSection";
import {
  resolveEffectiveChatLimit,
  runWaExtractionPipeline,
  type WaExtractionProgress,
} from "@/lib/leads/waExtractionRunner";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { BancoActionsBar } from "@/components/leads/BancoActionsBar";
import { TagSelect } from "@/components/leads/TagSelect";
import { SecondNumberPanel, type SecondNumberSelection } from "@/components/leads/SecondNumberPanel";
import { MARKETING_CHANNELS, computeMarketingMetricsFromCounts, getLeadSource } from "@/lib/leadChannels";
import { canMassDeleteLeads } from "@/lib/leadMassDelete";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
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
  DropdownMenuSeparator,
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
import {
  parseSpreadsheetFile,
  detectSpreadsheetColumns,
  proposeColumnMappings,
  validateColumnMappings,
  findMatchingRememberedMapping,
  applyColumnMappingsToRow,
  type ColumnMappingItem,
} from "@/lib/leadImports/spreadsheet";
import { ColumnMappingStep } from "@/pages/LeadImports/ColumnMappingStep";
import {
  useCreateBancoImport,
  useAnalyzeLeadImport,
  useLeadCustomFields,
  useLeadImports,
  useDeleteLeadImport,
  useResumeLeadImport,
  type LeadImportItem,
  type LeadImportAnalysisResult,
} from "@/hooks/useLeadImports";
import { DuplicateDecisionCard, type DuplicateStrategy } from "@/components/leads/DuplicateDecisionCard";
import { SavedSheetsCards } from "@/pages/LeadImports/SavedSheetsCards";
import { ImportViewerDialog } from "@/pages/LeadImports/ImportViewerDialog";
import { ImportProgressBanner } from "@/pages/LeadImports/ImportProgressBanner";
import {
  buildFilterAudienceDescription,
  buildFilterCriterionSummary,
  formatSelectionBarLabel,
} from "@/lib/leads/audienceDescription";
import { MassDeleteDialog } from "@/components/leads/MassDeleteDialog";
import { ImportBatchError, type ImportProgress } from "@/lib/leadImports/batchedImport";
import { resolveRowPhones, summarizePhonePreview, type PhonePreviewSummary } from "@/lib/leadImports/multiPhone";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export function toggleStageFilter(current: string[], stageToToggle: string): string[] {
  if (stageToToggle === "all") {
    return ["all"];
  }
  const cleanCurrent = current.filter((s) => s !== "all");
  let next: string[];
  if (cleanCurrent.includes(stageToToggle)) {
    next = cleanCurrent.filter((s) => s !== stageToToggle);
  } else {
    next = [...cleanCurrent, stageToToggle];
  }
  if (next.length === 0) {
    return ["all"];
  }
  return next;
}

export function buildCampaignTitle(stageFilters: string[], tagFilter?: string, count: number = 0, importLabel?: string): string {
  const isAllStages = stageFilters.length === 0 || stageFilters.includes("all");
  const stageLabel = isAllStages
    ? "TODOS OS ESTÁGIOS"
    : stageFilters.map((s) => s.toUpperCase()).join("+");

  let descriptor = stageLabel;
  if (tagFilter && tagFilter.trim()) {
    descriptor = isAllStages
      ? `Tag: ${tagFilter.trim()}`
      : `${stageLabel} | Tag: ${tagFilter.trim()}`;
  }

  if (importLabel && importLabel.trim()) {
    descriptor = isAllStages && !(tagFilter && tagFilter.trim()) ? `Planilha: ${importLabel.trim()}` : `${descriptor} | Planilha: ${importLabel.trim()}`;
  }

  return `Campanha Funil [${descriptor}] (${count} leads)`;
}

export function calculateEffectiveSelectedCount(
  filteredLeadIds: string[],
  selectedLeadIds: string[]
): number {
  const validFilteredIds = new Set(filteredLeadIds);
  return selectedLeadIds.filter((id) => validFilteredIds.has(id)).length;
}

export function serializeCampaignFiltersKey(
  stageFilters: string[],
  tagFilter?: string,
  filterRules?: any[],
  importFilter?: { importId: string; scope: string } | null
): string {
  return JSON.stringify({
    ...(importFilter ? { import: importFilter } : {}),
    stages: stageFilters,
    tag: tagFilter || "",
    rules: filterRules || [],
  });
}

export function reconcileCampaignSelection(params: {
  prevFiltersKey: string;
  currentFiltersKey: string;
  currentFilteredLeads: Array<Record<string, any>>;
  currentSelection: string[];
}): {
  newSelection: string[];
  filtersChanged: boolean;
} {
  if (params.prevFiltersKey !== params.currentFiltersKey) {
    // Filtros em si mudaram (tag, estágios ou regras): redefine a seleção para os novos leads filtrados
    return {
      newSelection: params.currentFilteredLeads.map((l) => String(l.id || "")).filter(Boolean),
      filtersChanged: true,
    };
  }
  // Filtros não mudaram (ex: recarga da lista de leads): preserva a seleção manual do usuário
  return {
    newSelection: params.currentSelection,
    filtersChanged: false,
  };
}

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

// Canais de atribuição (cartões "Atribuição & Origem de Marketing"): definição e regra em lib/leadChannels.ts.
export { MARKETING_CHANNELS, getLeadSource, getLeadMarketingChannelId } from "@/lib/leadChannels";

export const CANONICAL_LEAD_SOURCES: Record<string, { label: string; badgeClass: string; icon: string }> = {
  campanha: { label: "Campanha", badgeClass: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30", icon: "📢" },
  organico: { label: "Orgânico", badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", icon: "🌱" },
  trafego_pago: { label: "Tráfego Pago", badgeClass: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30", icon: "🎯" },
  whatsapp_ads: { label: "WhatsApp Ads", badgeClass: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30", icon: "📱" },
  indicacao: { label: "Indicação", badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30", icon: "🤝" },
  extracao_whatsapp: { label: "Extração WhatsApp", badgeClass: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30", icon: "💬" },
  importacao_planilha: { label: "Importação de planilha", badgeClass: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30", icon: "📥" },
  vendas_fechadas: { label: "Vendas fechadas", badgeClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30", icon: "🏆" },
  inbound: { label: "WhatsApp (inbound)", badgeClass: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30", icon: "💬" },
  outro: { label: "Outro", badgeClass: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30", icon: "🌐" },
  instagram: { label: "Instagram", badgeClass: "bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/30", icon: "📸" },
  "google ads": { label: "Google Ads", badgeClass: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30", icon: "🔍" },
  "facebook ads": { label: "Facebook Ads", badgeClass: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30", icon: "📘" },
  tiktok: { label: "TikTok", badgeClass: "bg-zinc-500/15 text-zinc-900 dark:text-zinc-100 border-zinc-500/30", icon: "🎵" },
};

export interface WaExtractionSources {
  conversas: boolean;
  agenda: boolean;
  grupos: boolean;
}

/**
 * Corpo de POST /api/leads/extract-wa-contacts. Duas regras:
 *   - conversas+agenda marcadas e grupos não é o estado de sempre — `sources`
 *     nem entra no corpo, pra chamada continuar idêntica à de hoje.
 *   - qualquer outra combinação manda `sources` com só o que está marcado.
 * `groupIds` só entra junto de `grupos: true`.
 */
export function buildWaExtractionPayload(
  base: { clientId: string; instanceId?: string; chatLimit: number | "all" },
  sourcesSelected: WaExtractionSources,
  waSelectedGroupIds: string[]
): Record<string, unknown> {
  const isDefaultCombo = sourcesSelected.conversas && sourcesSelected.agenda && !sourcesSelected.grupos;
  if (isDefaultCombo) {
    return { ...base };
  }

  const sources: string[] = [];
  if (sourcesSelected.conversas) sources.push("conversas");
  if (sourcesSelected.agenda) sources.push("agenda");
  if (sourcesSelected.grupos) sources.push("grupos");

  return {
    ...base,
    sources,
    ...(sourcesSelected.grupos ? { groupIds: waSelectedGroupIds } : {}),
  };
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
  const { isAuthenticated, getIdToken, isAdminUser, canAccessInternalPage, approvalLevel } = useAuth();
  const canManageUsers = isAdminUser || canAccessInternalPage("usuarios");
  // Mesma regra do servidor (isManagerOrAdmin): excluir leads em massa é decisão de gestor/admin.
  const canMassDelete = canMassDeleteLeads({ isAdminUser, approvalLevel, canAccessUsersPage: canManageUsers });
  const crmClient = useOptionalCrmClient();
  // Usa selectedClientId (string, sempre setado pelo seletor de tenant do topo).
  // Antes usava selectedClient?.id, que fica null quando o objeto ainda não
  // resolveu na lista, caindo no fallback "infinie" (cliente removido) — o que
  // fazia instâncias e leads virem vazios nesta página.
  const clientId = crmClient?.selectedClientId || crmClient?.selectedClient?.id || "geracao-digital";
  const queryClient = useQueryClient();
  const { data: knownCustomFields = [] } = useLeadCustomFields(clientId);
  const { data: pastImports = [], refetch: refetchImports } = useLeadImports(clientId);
  const createBancoImport = useCreateBancoImport();
  const deleteLeadImport = useDeleteLeadImport();
  const resumeLeadImport = useResumeLeadImport();
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [resumingImportId, setResumingImportId] = useState<string | null>(null);
  const [isSavedSheetsOpen, setIsSavedSheetsOpen] = useState(false);
  const [viewingImport, setViewingImport] = useState<LeadImportItem | null>(null);
  const [isMassDeleteOpen, setIsMassDeleteOpen] = useState(false);
  const [selectedImportId, setSelectedImportId] = useState<string>("");

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
  // A lista é paginada no SERVIDOR: `leads` são as linhas da PÁGINA atual; os totais vêm do banco (nunca contados aqui).
  const [listTotal, setListTotal] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(1);
  const [tabCounts, setTabCounts] = useState<LeadTabCounts | null>(null);
  const [facets, setFacets] = useState<LeadFacetsResponse | null>(null);
  const [facetsError, setFacetsError] = useState<string | null>(null);
  // O servidor avisa quando não conseguiu aplicar os filtros (lista simples, sem filtro): a tela diz, em vez de fingir que filtrou.
  const [listDegraded, setListDegraded] = useState(false);
  const [listDegradedCause, setListDegradedCause] = useState<string | null>(null);
  // Quem foi selecionado em outra página não está em `leads`: guardamos nome/telefone para os modais que precisam deles.
  const [selectedContacts, setSelectedContacts] = useState<Record<string, LeadContact>>({});

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
    if (["contacts_without_channel", "instagram", "instagram_direct", "sem_whatsapp", "direct"].includes(t)) {
      return "contacts_without_channel";
    }
    return "all";
  };

  // Filters & Tabs
  const [activeTab, setActiveTab] = useState<string>(() => normalizeStageTab(searchParams.get("tab")));
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState<string>("");
  const [selectedSource, setSelectedSource] = useState<string>("");
  const [selectedChannel, setSelectedChannel] = useState<string>("all");
  const [selectedSegment, setSelectedSegment] = useState<BasePotentialSegmentId | null>(null);
  const [isInstagramImportModalOpen, setIsInstagramImportModalOpen] = useState(false);
  const { data: contactsWithoutChannel = [] } = useContactsWithoutChannel(clientId);

  // Sincroniza activeTab quando o parâmetro da URL mudar
  useEffect(() => {
    const urlTab = searchParams.get("tab");
    if (urlTab) {
      const normalized = normalizeStageTab(urlTab);
      setActiveTab(normalized);
    }
  }, [searchParams]);

  // Tags e origens do seletor: vêm do banco, da base inteira (não somem ao filtrar e não dependem da página carregada)
  // Partes dos totais que o servidor não conseguiu calcular (cada uma degrada sozinha): a tela usa o que chegou e avisa só sobre estas
  const FACET_PART_LABELS: Record<string, string> = {
    summary: "faixas do Potencial e totais por estágio",
    channels: "cartões de origem",
    sources: "lista de origens",
    tags: "lista de tags",
  };
  const facetsFailedParts = useMemo(() => Object.entries(facets?.failedParts ?? {}), [facets]);
  const channelsUnavailable = Boolean(facets?.failedParts?.channels);
  const knownTags = useMemo(() => (facets?.tags ?? []).map((t) => t.tag), [facets]);
  const knownSources = useMemo(
    () => (facets?.sources ?? []).map((x) => x.source).filter((src) => src && src !== "Não informado").sort(),
    [facets]
  );

  // Pagination State
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);

  // Sorting State (a ordem é do banco: o servidor ordena a base inteira e devolve a página pedida)
  const [sortColumn, setSortColumn] = useState<"contato" | "ultima_conversa" | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");

  // A busca vai ao servidor: espera o usuário parar de digitar
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchQuery.trim()), 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // WhatsApp Extraction Modal State
  const [isWAModalOpen, setIsWAModalOpen] = useState(false);
  const effectiveChatLimit = resolveEffectiveChatLimit(isAdvancedPlan);
  const [waChatLimit, setWaChatLimit] = useState<number | "all">(effectiveChatLimit);
  const [isExtractingWA, setIsExtractingWA] = useState(false);
  const [waExtractStep, setWaExtractStep] = useState<string>("");
  // Três procedências, cada uma marcável — conversas e agenda ligadas por
  // padrão (comportamento de sempre), grupos desligada. Independentes: ligar
  // grupos não arrasta as outras duas junto.
  const [waIncludeConversas, setWaIncludeConversas] = useState(true);
  const [waIncludeAgenda, setWaIncludeAgenda] = useState(true);
  const [waIncludeGroups, setWaIncludeGroups] = useState(false);
  // hasConfirmedGroupsWarning vive aqui (não dentro do componente da seção)
  // porque o Dialog desmonta o conteúdo ao fechar — "uma vez por sessão"
  // precisa sobreviver a fechar e reabrir o modal, só reseta em reload de
  // página.
  const [hasConfirmedGroupsWarning, setHasConfirmedGroupsWarning] = useState(false);
  const [waSelectedGroupIds, setWaSelectedGroupIds] = useState<string[]>([]);
  const [waSelectedGroups, setWaSelectedGroups] = useState<WaGroupPreviewItem[]>([]);
  const [waGroupsInstanceId, setWaGroupsInstanceId] = useState<string>("");
  const [waExtractProgress, setWaExtractProgress] = useState<WaExtractionProgress | null>(null);
  const abortExtractionRef = useRef(false);

  // Import Modal State (Excel .xlsx/.xls + CSV)
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importDefaultDdd, setImportDefaultDdd] = useState<string>("34");
  const [importRawRows, setImportRawRows] = useState<Record<string, unknown>[]>([]);
  const [importColumns, setImportColumns] = useState<string[]>([]);
  const [importColumnMappings, setImportColumnMappings] = useState<ColumnMappingItem[]>([]);
  const [importMapping, setImportMapping] = useState<{ telefone: string | null; nome: string | null }>({ telefone: null, nome: null });
  const isImportMappingValid = useMemo(() => {
    if (importColumns.length === 0) return true;
    if (importColumnMappings.length === 0) return false;
    return validateColumnMappings(importColumnMappings, importColumns, importRawRows).isValid;
  }, [importColumns, importColumnMappings, importRawRows]);
  const [showImportAuditModal, setShowImportAuditModal] = useState(false);
  const [importTagInput, setImportTagInput] = useState<string>("");
  const [importAsClosedSales, setImportAsClosedSales] = useState<boolean>(false);
  const [importParsedRows, setImportParsedRows] = useState<Record<string, unknown>[]>([]);
  // Prévia antes de confirmar (planilha com mais de uma coluna de telefone): só principal / com adicional / puladas (nenhum telefone válido)
  const [importPhonePreview, setImportPhonePreview] = useState<PhonePreviewSummary | null>(null);
  const [importSanitizePreview, setImportSanitizePreview] = useState<{ validCount: number; invalidCount: number }>({
    validCount: 0,
    invalidCount: 0,
  });
  const analyzeLeadImport = useAnalyzeLeadImport();
  const [importAnalysis, setImportAnalysis] = useState<LeadImportAnalysisResult | null>(null);
  const [importDuplicateStrategy, setImportDuplicateStrategy] = useState<DuplicateStrategy>("merge");
  const [isAnalyzingImport, setIsAnalyzingImport] = useState(false);
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

  // Bulk Selection (Ações em Lote & Seleção por Critério)
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState<"manual" | "criterion">("manual");
  const [criterionTotal, setCriterionTotal] = useState<number>(0);
  const [excludedLeadIds, setExcludedLeadIds] = useState<string[]>([]);
  const [isBulkStageModalOpen, setIsBulkStageModalOpen] = useState(false);
  const [bulkStageValue, setBulkStageValue] = useState<"buyer" | "open_budget" | "inquiry" | "cold" | "lost">("cold");
  const [bulkContractValue, setBulkContractValue] = useState("");
  const [bulkLostReason, setBulkLostReason] = useState("preco");
  const [isBulkTagModalOpen, setIsBulkTagModalOpen] = useState(false);
  const [bulkTagValue, setBulkTagValue] = useState("");
  const [bulkTagMode, setBulkTagMode] = useState<"add" | "remove">("add");
  const [isBulkAssignModalOpen, setIsBulkAssignModalOpen] = useState(false);
  const [bulkAssignValue, setBulkAssignValue] = useState<string>("none");
  const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
  const [deleteConfirmationInput, setDeleteConfirmationInput] = useState("");
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);

  // Modais dedicados: Marcar como Cliente e Marcar como Perdido
  const [isMarkAsClientModalOpen, setIsMarkAsClientModalOpen] = useState(false);
  const [markAsClientTarget, setMarkAsClientTarget] = useState<{ type: "single"; leadId: string } | { type: "bulk"; leadIds: string[] } | null>(null);
  const [markAsClientValue, setMarkAsClientValue] = useState("");

  const [isMarkAsLostModalOpen, setIsMarkAsLostModalOpen] = useState(false);
  const [markAsLostTarget, setMarkAsLostTarget] = useState<{ type: "single"; leadId: string } | { type: "bulk"; leadIds: string[] } | null>(null);
  const [markAsLostReason, setMarkAsLostReason] = useState("preco");

  // Campaign Creation Wizard Modal State
  const [isCampaignWizardOpen, setIsCampaignWizardOpen] = useState(false);
  const [campaignSourceType, setCampaignSourceType] = useState<"funnel" | "spreadsheet" | "second_number">("funnel");
  // Segunda tentativa por outro número: a seleção vive no painel; aqui só o que o botão "Avançar" precisa
  const [secondNumberSelection, setSecondNumberSelection] = useState<SecondNumberSelection | null>(null);
  
  // Funnel Audience Selection State
  const [campaignStageFilters, setCampaignStageFilters] = useState<string[]>(["all"]);
  const [campaignTagFilter, setCampaignTagFilter] = useState<string>("");
  const [campaignSelectedLeadIds, setCampaignSelectedLeadIds] = useState<string[]>([]);
  const [campaignFunnelFilterRules, setCampaignFunnelFilterRules] = useState<DynamicFilterRule[]>([]);
  // Campanha por PLANILHA registrada (lead_imports), não por rótulo: o público sai de dados.import_ids (procedência verdadeira)
  const [campaignImportId, setCampaignImportId] = useState<string>("");
  const [campaignImportScope, setCampaignImportScope] = useState<ImportScope>("all");
  const [campaignImportSources, setCampaignImportSources] = useState<ImportSource[]>([]);
  const [campaignImportOrigin, setCampaignImportOrigin] = useState<ImportOrigin | null>(null);
  const [campaignImportOriginError, setCampaignImportOriginError] = useState<string | null>(null);

  // Spreadsheet Audience Selection State
  const [campaignFile, setCampaignFile] = useState<File | null>(null);
  const [campaignSpreadsheetRows, setCampaignSpreadsheetRows] = useState<Record<string, unknown>[]>([]);
  const [campaignSpreadsheetColumns, setCampaignSpreadsheetColumns] = useState<string[]>([]);
  const [campaignSpreadsheetRules, setCampaignSpreadsheetRules] = useState<DynamicFilterRule[]>([]);
  const campaignFileInputRef = useRef<HTMLInputElement>(null);

  // Chamada autenticada à API (mesmo token do restante da tela)
  const leadRequest: LeadRequest = async (path, init = {}) => {
    const token = await getIdToken();
    if (!token) throw new Error("Usuário não autenticado.");
    return fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), Authorization: `Bearer ${token}` },
    });
  };

  // Filtros da lista, exatamente como a tela os mostra (o servidor aplica todos no SQL)
  const listFilters: LeadListFilters = {
    stage: activeTab,
    tag: selectedTag,
    search: debouncedSearch,
    source: selectedSource,
    channel: selectedChannel,
    segment: selectedSegment,
    importId: selectedImportId || undefined,
  };

  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Uma página: linhas + total da combinação de filtros + contagem das abas. Respostas fora de ordem são descartadas.
  const listRequestSeq = useRef(0);
  const loadPage = async () => {
    if (!isAuthenticated) return;
    const seq = ++listRequestSeq.current;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchLeadPage<LeadIntelligenceItem>(leadRequest, {
        clientId,
        filters: listFilters,
        sort: sortColumn,
        dir: sortDirection,
        page: currentPage,
        limit: pageSize,
      });
      if (!isMountedRef.current || seq !== listRequestSeq.current) return;
      setLeads(page.items);
      setListTotal(page.total);
      setServerTotalPages(page.totalPages);
      setTabCounts(page.tabs);
      setListDegraded(page.degraded);
      setListDegradedCause(page.degradedCause?.message ? `${page.degradedCause.message}${page.degradedCause.code ? ` [${page.degradedCause.code}]` : ""}` : null);
    } catch (err: any) {
      if (!isMountedRef.current || seq !== listRequestSeq.current) return;
      console.error("[BancoDeDados] Erro ao carregar base:", err);
      setError(err.message || "Falha ao carregar leads.");
    } finally {
      if (isMountedRef.current && seq === listRequestSeq.current) setLoading(false);
    }
  };

  // Totais da BASE inteira (cartões de origem, faixas do Potencial, tags, origens): agregados no banco
  const facetsRequestSeq = useRef(0);
  const loadFacets = async () => {
    if (!isAuthenticated) return;
    const seq = ++facetsRequestSeq.current;
    try {
      const data = await fetchLeadFacets(leadRequest, clientId);
      if (!isMountedRef.current || seq !== facetsRequestSeq.current) return;
      setFacets(data);
      setFacetsError(null);
      if (data.summary && Object.keys(data.summary).length > 0) setSummary(data.summary as unknown as SummaryStats);
    } catch (err: any) {
      if (!isMountedRef.current || seq !== facetsRequestSeq.current) return;
      console.error("[BancoDeDados] Erro ao carregar totais da base:", err);
      setFacetsError(err.message || "Falha ao calcular os totais da base.");
    }
  };

  // Recarrega tudo (depois de importar, editar, excluir…)
  const fetchLeads = () => {
    loadPage();
    loadFacets();
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

  // Mudou filtro, busca, ordem ou tamanho de página → volta à página 1 e pede ao servidor (uma só chamada, sem a página velha)
  const listFilterKey = JSON.stringify([clientId, activeTab, selectedTag, debouncedSearch, selectedSource, selectedChannel, selectedSegment, selectedImportId, sortColumn, sortDirection, pageSize]);
  const prevListFilterKeyRef = useRef(listFilterKey);
  useEffect(() => {
    if (prevListFilterKeyRef.current !== listFilterKey) {
      prevListFilterKeyRef.current = listFilterKey;
      if (currentPage !== 1) {
        setCurrentPage(1);
        return;
      }
    }
    loadPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listFilterKey, currentPage, isAuthenticated]);

  useEffect(() => {
    loadFacets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, isAuthenticated]);

  // Auto-localiza e abre o Drawer do lead quando navegado a partir de Ações Rápidas (Conversas).
  // O lead pode estar em QUALQUER página da base: se não está na página carregada, o servidor o localiza pelo id ou telefone.
  const lookedUpKeyRef = useRef<string | null>(null);
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
      return;
    }

    // Não está na página carregada: pergunta ao servidor (uma vez por link, depois que a primeira página chegou)
    if (loading || !isAuthenticated) return;
    const lookupKey = `${clientId}|${targetLeadId || ""}|${targetCanonical || ""}`;
    if (lookedUpKeyRef.current === lookupKey) return;
    lookedUpKeyRef.current = lookupKey;
    fetchLeadLookup<LeadIntelligenceItem>(leadRequest, { clientId, leadId: targetLeadId, phone: targetPhone })
      .then((found) => {
        if (found) {
          setSelectedLead(found);
          setIsDetailSheetOpen(true);
        }
      })
      .catch((err) => console.warn("[BancoDeDados] Lead da URL não localizado:", err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, selectedLead, loading, isAuthenticated, clientId]);

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

  // Volta a origem pro estado de sempre (conversas+agenda ligadas, grupos
  // desligada) — usado ao fechar o modal por qualquer caminho (cancelar, X,
  // extração concluída), pra próxima abertura não herdar escolha antiga.
  const resetWaSourceSelection = () => {
    setWaIncludeConversas(true);
    setWaIncludeAgenda(true);
    setWaIncludeGroups(false);
    setWaSelectedGroupIds([]);
    setWaSelectedGroups([]);
    setWaGroupsInstanceId("");
    setWaExtractProgress(null);
  };

  // Handle WhatsApp Extraction Execution
  const handleExtractWA = async () => {
    if (waIncludeGroups && waSelectedGroupIds.length > 0) {
      if (waGroupsInstanceId && waGroupsInstanceId !== selectedInstanceId) {
        toast.error("Instância selecionada foi alterada. Recarregue os grupos antes de iniciar a extração.");
        return;
      }
    }

    setIsExtractingWA(true);
    abortExtractionRef.current = false;
    setWaExtractStep("Iniciando extração do WhatsApp...");

    try {
      const groupsToExtract = waSelectedGroups.length > 0
        ? waSelectedGroups.map((g) => ({ id: g.id, name: g.name }))
        : waSelectedGroupIds.map((id) => ({ id, name: id }));

      const result = await runWaExtractionPipeline(
        {
          clientId,
          instanceId: selectedInstanceId || undefined,
          groupsInstanceId: waGroupsInstanceId,
          isAdvancedPlan,
          sources: {
            conversas: waIncludeConversas,
            agenda: waIncludeAgenda,
            grupos: waIncludeGroups,
          },
          selectedGroups: groupsToExtract,
        },
        {
          getIdToken,
          onProgress: (p) => {
            setWaExtractProgress(p);
            setWaExtractStep(p.statusMessage);
          },
          isCancelled: () => abortExtractionRef.current,
        }
      );

      if (result.cancelled) {
        toast.info("Extração interrompida", {
          description: `${result.totalExtracted} contatos minerados até o momento.`,
        });
        setIsWAModalOpen(false);
        resetWaSourceSelection();
        fetchLeads();
        return;
      }

      const allFailures = result.failures && result.failures.length > 0
        ? result.failures
        : result.failedGroups.map((f) => ({ phase: "grupos" as const, label: f.groupName, error: f.error }));

      if (allFailures.length > 0) {
        const failNames = allFailures.map((f) => `${f.label} (${f.error})`).join(", ");
        if (result.totalExtracted > 0) {
          toast.warning(`Extração parcial concluída: ${result.totalExtracted} contatos minerados.`, {
            description: `${allFailures.length} etapa(s)/grupo(s) falharam: ${failNames}`,
          });
        } else {
          toast.error("Falha na extração de contatos", {
            description: `${allFailures.length} etapa(s)/grupo(s) falharam: ${failNames}`,
          });
        }
        setIsWAModalOpen(false);
        resetWaSourceSelection();
        fetchLeads();
        return;
      }

      const groupsNote = result.fromGroups > 0 ? ` (${result.fromGroups} de grupos)` : "";
      toast.success("Extração Semântica Concluída! 🎉", {
        description: `${result.totalExtracted} contatos minerados e enriquecidos com IA${groupsNote}.`,
      });

      setIsWAModalOpen(false);
      resetWaSourceSelection();
      fetchLeads();
    } catch (err: any) {
      console.error("[BancoDeDados] Erro na extração WA:", err);
      toast.error("Falha ao extrair contatos do WhatsApp", {
        description: err.message || "Verifique se a instância da Evolution API está conectada.",
      });
    } finally {
      setIsExtractingWA(false);
      setWaExtractStep("");
      setWaExtractProgress(null);
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

  const recalculateImportStatsWithMappings = (
    rows: Record<string, unknown>[],
    mappings: ColumnMappingItem[],
    ddd: string
  ) => {
    const cleanDdd = ddd ? ddd.replace(/\D/g, "").slice(0, 2) : null;
    let intactCount = 0;
    let completedCount = 0;
    let incompleteCount = 0;
    const completedList: Array<{ original: string; result: string }> = [];
    const incompleteList: Array<{ original: string; reason: string }> = [];

    const phoneMapping = mappings.find((m) => m.target === "telefone");
    const nameMapping = mappings.find((m) => m.target === "nome");
    const phoneCol = phoneMapping?.column;
    const nameCol = nameMapping?.column;
    const hasExtraPhones = mappings.some((m) => m.target === "telefone_adicional");
    setImportPhonePreview(summarizePhonePreview(rows, mappings, cleanDdd));

    const normalizedRows = rows.map((row) => {
      // com colunas de "Telefone adicional": o telefone que identifica o lead é o primeiro válido na ordem mapeada (a mesma regra do servidor)
      const resolved = hasExtraPhones ? resolveRowPhones(row, mappings, cleanDdd) : null;
      const rawPhone = resolved
        ? String(resolved.brutoPrincipal ?? "").trim()
        : phoneCol
          ? String(row[phoneCol] ?? "").trim()
          : String(row.telefone || row.phone || row.celular || row.whatsapp || row.numero || "").trim();
      const rawDigits = rawPhone.replace(/\D/g, "");
      const sanitized = sanitizePhone(rawPhone, cleanDdd);

      let finalPhone: string | null = null;
      if (sanitized && !sanitized.replace(/^\+/, "").startsWith("5500")) {
        finalPhone = sanitized.startsWith("+") ? sanitized : `+${sanitized}`;
        const isAlreadyComplete =
          (rawDigits.length === 12 && rawDigits.startsWith("55") && sanitized === rawDigits) ||
          (rawDigits.length === 13 && rawDigits.startsWith("55") && sanitized === rawDigits) ||
          (rawDigits.length >= 10 && rawDigits.length < 15 && !rawDigits.startsWith("55") && sanitized === rawDigits);

        if (isAlreadyComplete) {
          intactCount++;
        } else {
          completedCount++;
          if (completedList.length < 500) {
            completedList.push({ original: rawPhone, result: finalPhone });
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
        } else if (rawDigits.startsWith("5500") || (sanitized && sanitized.startsWith("5500"))) {
          reason = "Telefone inválido (5500)";
        }
        if (incompleteList.length < 500) {
          incompleteList.push({ original: rawPhone || "(vazio)", reason });
        }
      }

      const mapped = applyColumnMappingsToRow(row, mappings, cleanDdd);
      return {
        ...row,
        telefone: finalPhone,
        nome: nameCol && row[nameCol] ? String(row[nameCol]).trim() : mapped.nome,
        dados: mapped.dados,
      };
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

  const handleMappingChange = (newMappings: ColumnMappingItem[]) => {
    setImportColumnMappings(newMappings);
    setImportAnalysis(null);
    if (importRawRows.length > 0) {
      recalculateImportStatsWithMappings(importRawRows, newMappings, importDefaultDdd);
    }
  };

  const handleDefaultDddChange = (newDdd: string) => {
    const clean = newDdd.replace(/\D/g, "").slice(0, 2);
    setImportDefaultDdd(clean);
    setImportAnalysis(null);
    if (importRawRows.length > 0) {
      if (importColumnMappings.length > 0) {
        recalculateImportStatsWithMappings(importRawRows, importColumnMappings, clean);
      } else {
        recalculateImportStats(importRawRows, importMapping, clean);
      }
    }
  };

  // Parse Excel (.xlsx, .xls) or CSV File for Import
  const handleImportFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportAnalysis(null);
    setImportDuplicateStrategy("merge");

    const cleanFileName = file.name.replace(/\.[^/.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
    const autoTag = `#Imp-${cleanFileName}`;
    setImportTagInput(autoTag);

    try {
      const rows = await parseSpreadsheetFile(file);
      const cols = rows.length > 0 ? Object.keys(rows[0]) : [];
      setImportRawRows(rows);
      setImportColumns(cols);

      const remembered = findMatchingRememberedMapping(cols, pastImports);
      const initialMappings = proposeColumnMappings({
        columns: cols,
        sampleRows: rows.slice(0, 10),
        rememberedMapping: remembered,
        knownCustomFields,
      });

      setImportColumnMappings(initialMappings);

      const legacyMapping = detectSpreadsheetColumns(rows);
      setImportMapping(legacyMapping);

      recalculateImportStatsWithMappings(rows, initialMappings, importDefaultDdd);
    } catch (err: any) {
      toast.error("Erro ao ler arquivo da planilha", { description: err.message || "Formato não suportado." });
    }
  };

  // Submit Import (CSV / Excel)
  const handleImportSubmit = async () => {
    if (importColumns.length > 0) {
      const validation = validateColumnMappings(importColumnMappings, importColumns, importRawRows);
      if (!validation.isValid) {
        toast.error("Mapeamento inválido", {
          description: validation.errorMessage || "Verifique as colunas mapeadas.",
        });
        return;
      }
    }

    if (!importParsedRows || importParsedRows.length === 0) {
      toast.error("Nenhum contato válido encontrado na planilha.");
      return;
    }

    const rows = importColumnMappings.length > 0 ? importRawRows : importParsedRows;

    // Se ainda não foi realizada a análise de duplicados, faz a checagem prévia
    if (!importAnalysis) {
      setIsAnalyzingImport(true);
      try {
        const analysis = await analyzeLeadImport.mutateAsync({
          clientId,
          rows,
          columnMapping: importColumnMappings.length > 0 ? importColumnMappings : undefined,
          defaultDdd: importDefaultDdd || undefined,
        });
        setImportAnalysis(analysis);

        if (analysis.duplicateCount > 0) {
          toast.info("Contatos duplicados detectados", {
            description: `${analysis.duplicateCount} contatos já constam no banco. Escolha a estratégia antes de prosseguir.`,
          });
          setIsAnalyzingImport(false);
          return;
        }
      } catch (err: any) {
        console.warn("[BancoDeDados] Erro na análise prévia de duplicados, prosseguindo com importação:", err);
      } finally {
        setIsAnalyzingImport(false);
      }
    }

    setIsUploadingImport(true);
    setImportProgress(null);
    try {
      const importTags = importTagInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      // Em LOTES de 500 linhas (sem o corpo único que estourava o limite do servidor com milhares de linhas). O registro da importação
      // nasce com o NOME do arquivo e fica no mesmo lugar da tela de Planilhas; os leads são criados a cada lote.
      const result = await createBancoImport.mutateAsync({
        clientId,
        sourceName: importFile?.name || "",
        sourceType: (importFile?.name.split(".").pop() || "spreadsheet").toLowerCase(),
        rows,
        defaultDdd: importDefaultDdd || undefined,
        columnMapping: importColumnMappings.length > 0 ? importColumnMappings : undefined,
        importTags,
        asClosedSales: importAsClosedSales,
        duplicateStrategy: importDuplicateStrategy,
        onProgress: setImportProgress,
      });
      toast.success(
        importAsClosedSales
          ? "Vendas fechadas importadas com sucesso como Compradores! 🏆"
          : "Planilha higienizada e importada com sucesso! 🎉",
        {
          description: `${result.totals.uniquePhones.toLocaleString("pt-BR")} leads com telefone válido de ${result.totals.total.toLocaleString("pt-BR")} linhas${importTags.length ? `, com a tag "${importTagInput}"` : ""}.`,
        }
      );

      setIsImportModalOpen(false);
      setImportFile(null);
      setImportColumns([]);
      setImportColumnMappings([]);
      setImportAsClosedSales(false);
      setImportParsedRows([]);
      setImportRawRows([]);
      setImportAnalysis(null);
      setImportDuplicateStrategy("merge");
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      fetchLeads();
      queryClient.invalidateQueries({ queryKey: ["leads", clientId] });
      queryClient.invalidateQueries({ queryKey: ["lead-custom-fields", clientId] });
      queryClient.invalidateQueries({ queryKey: ["lead-imports", clientId] });
    } catch (err: any) {
      if (err instanceof ImportBatchError && err.importId) {
        // ficou registrada como INCOMPLETA no servidor, com o que já entrou; reenviar o mesmo arquivo não duplica leads
        fetchLeads();
        toast.error("Importação incompleta", {
          description: `Entraram ${(err.receivedOffset ?? 0).toLocaleString("pt-BR")} de ${err.totalRows.toLocaleString("pt-BR")} linhas (${err.message}). Envie a mesma planilha de novo: os leads já criados não são duplicados.`,
        });
      } else {
        toast.error("Erro na importação da planilha", { description: err.message });
      }
    } finally {
      setIsUploadingImport(false);
      setImportProgress(null);
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

  // Export Leads (Excel .xlsx): a combinação de filtros INTEIRA, buscada do servidor página a página (sem teto)
  const handleExportXLSX = async () => {
    const progressToast = toast.loading("Preparando planilha Excel…");
    try {
      const allLeadsRaw = await fetchAllLeadsForExport<LeadIntelligenceItem>(leadRequest, {
        clientId,
        filters: listFilters,
        onProgress: (done, total) => toast.loading(`Preparando planilha Excel… ${done.toLocaleString("pt-BR")} de ${total.toLocaleString("pt-BR")}`, { id: progressToast }),
      });
      const excludedSet = new Set(excludedLeadIds);
      const allLeads = excludedSet.size > 0 ? allLeadsRaw.filter((l) => !excludedSet.has(l.id)) : allLeadsRaw;
      // Coleta todas as chaves customizadas presentes nos leads filtrados
      const allCustomKeys = new Set<string>();
      allLeads.forEach((l) => {
        const campos = (l.dados as any)?.campos;
        if (campos && typeof campos === "object") {
          Object.keys(campos).forEach((k) => allCustomKeys.add(k));
        }
      });
      const customKeyList = Array.from(allCustomKeys).sort();

      const exportData = allLeads.map((l) => {
        const row: Record<string, unknown> = {
          "ID": l.id,
          "Nome": l.nome || "",
          "Telefone (E.164)": l.phone || l.telefone || "",
          "Estágio": l.stage || "cold",
          "Temperatura": l.temperature || "warm",
          "Tags": Array.isArray(l.tags) ? l.tags.join(", ") : "",
          "Resumo IA": l.raw_chat_summary || "",
          "Última Interação": l.last_interaction_at ? new Date(l.last_interaction_at).toLocaleString("pt-BR") : "",
          "Data de Cadastro": new Date(l.created_at).toLocaleString("pt-BR"),
        };
        const campos = (l.dados as any)?.campos;
        customKeyList.forEach((key) => {
          row[key] = campos && campos[key] !== undefined && campos[key] !== null ? campos[key] : "";
        });
        return row;
      });

      const ws = XLSX.utils.json_to_sheet(exportData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Leads");
      XLSX.writeFile(wb, `leads_${clientId}_${Date.now()}.xlsx`);

      toast.success(`Planilha Excel (.xlsx) baixada com ${allLeads.length.toLocaleString("pt-BR")} leads!`, { id: progressToast });
    } catch (err: any) {
      toast.error("Erro ao exportar arquivo Excel", { id: progressToast, description: err.message });
    }
  };

  // Export Leads (CSV): o servidor monta o arquivo da combinação de filtros da tela (sem teto de linhas)
  const handleExportCSV = async () => {
    try {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries({ stage: activeTab, tag: selectedTag, search: debouncedSearch, source: selectedSource, channel: selectedChannel, segment: selectedSegment, importId: selectedImportId })) {
        if (v && v !== "all" && v !== "contacts_without_channel") params.append(k, String(v));
      }
      params.append("clientId", clientId);

      const res = await leadRequest(`/api/leads/export?${params.toString()}`);

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
  const handleOpenCampaignWizard = async () => {
    setIsCampaignWizardOpen(true);
    setCampaignSourceType("funnel");
    const initialTag = selectedTag || "";
    setCampaignTagFilter(initialTag);
    const initialStages = activeTab && activeTab !== "all" ? [activeTab] : ["all"];
    setCampaignStageFilters(initialStages);
    const initialImportId = selectedImportId || "";
    setCampaignImportId(initialImportId);
    setCampaignImportScope("all");
    const initialImportFilter = initialImportId ? { importId: initialImportId, scope: "all" } : null;
    prevFiltersKeyRef.current = serializeCampaignFiltersKey(
      initialStages,
      initialTag,
      campaignFunnelFilterRules,
      initialImportFilter
    );
    // A seleção inicial é a lista filtrada da tela (a base inteira da combinação, não só a página carregada)
    try {
      const found = await fetchLeadIds(leadRequest, { clientId, filters: listFilters });
      setCampaignSelectedLeadIds(found.ids);
    } catch (err: any) {
      setCampaignSelectedLeadIds([]);
      toast.error("Não foi possível carregar os leads do filtro", { description: err.message });
    }
  };

  // Handoff por critério para Campanhas (leve, sem enviar 77k ids)
  const handleCreateCampaignFromBanco = () => {
    const totalToUse = bancoEffectiveSelectedCount > 0 ? bancoEffectiveSelectedCount : listTotal;
    if (totalToUse === 0) {
      toast.error("Nenhum lead encontrado com os filtros aplicados.");
      return;
    }
    const sheetName = pastImports.find((i) => i.id === selectedImportId)?.source_name;
    const channelDef = MARKETING_CHANNELS.find((c) => c.id === selectedChannel);
    const description = selectionSummary || buildFilterAudienceDescription(listFilters, totalToUse, {
      sheetName,
      channelName: channelDef?.name,
    });
    const campaignName = `Campanha ${description}`;

    try {
      localStorage.setItem(
        "vexo_pending_campaign_audience",
        JSON.stringify({
          criteria: listFilters,
          excludedLeadIds: selectionMode === "criterion" && excludedLeadIds.length > 0 ? excludedLeadIds : undefined,
          selectionMode,
          description,
          totalCount: totalToUse,
          campaignName,
        })
      );
      toast.success("Público-Alvo Configurado! 🎯", {
        description,
      });
      navigate("/crm/planilhas");
    } catch (err: any) {
      toast.error("Não foi possível transferir os critérios da campanha", { description: err.message });
    }
  };

  // Bloco 2: Gestão de planilhas salvas no Banco
  const handleDeleteImport = async (importId: string, sourceName: string) => {
    if (
      !confirm(
        `Remover o registro da planilha "${sourceName}"?\n\nOs leads dela continuam no Banco de Dados — para apagá-los, use "Excluir leads por tag".\nCampanhas que usam esta base ficarão sem leads. Esta ação não pode ser desfeita.`
      )
    )
      return;
    try {
      await deleteLeadImport.mutateAsync(importId);
      if (selectedImportId === importId) setSelectedImportId("");
      toast.success("Registro da planilha removido", {
        description: `${sourceName} — os leads continuam no Banco.`,
      });
      refetchImports();
      loadPage();
      loadFacets();
    } catch (err: any) {
      toast.error("Erro ao excluir", {
        description: err?.message || "Não foi possível excluir a planilha.",
      });
    }
  };

  const handleResumeImport = async (imp: LeadImportItem, file: File) => {
    setResumingImportId(imp.id);
    setImportProgress({
      phase: "opening",
      sentRows: imp.received_offset ?? 0,
      totalRows: imp.expected_rows ?? 0,
      batch: 0,
      batches: 0,
    });
    try {
      const rows = await parseSpreadsheetFile(file);
      const result = await resumeLeadImport.mutateAsync({
        clientId,
        importId: imp.id,
        rows,
        onProgress: setImportProgress,
      });
      toast.success("Importação concluída", {
        description: `"${imp.source_name}" foi completada: ${result.totals.total.toLocaleString("pt-BR")} linhas, ${result.totals.valid.toLocaleString("pt-BR")} com telefone válido.`,
      });
      refetchImports();
      loadPage();
      loadFacets();
    } catch (err: any) {
      toast.error("Não foi possível retomar a importação", {
        description: err?.message || "Erro desconhecido.",
      });
      refetchImports();
    } finally {
      setImportProgress(null);
      setResumingImportId(null);
    }
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

  // Público da campanha: o servidor filtra no banco (estágios, tag e regras de campos simples) e devolve linhas enxutas + o total.
  // Regra num campo que não é simples (tags, dados…) é recusada pelo servidor e a tela MOSTRA o motivo, em vez de um "0 leads".
  const campaignImportFilter = campaignImportId ? { importId: campaignImportId, scope: campaignImportScope } : null;
  const campaignFiltersKey = serializeCampaignFiltersKey(campaignStageFilters, campaignTagFilter, campaignFunnelFilterRules, campaignImportFilter);

  // As planilhas registradas para o seletor (rota do Banco: não depende de acesso à tela de Planilhas)
  useEffect(() => {
    if (!isCampaignWizardOpen || !isAuthenticated) return;
    let cancelled = false;
    fetchImportSources(leadRequest, clientId)
      .then((items) => { if (!cancelled) setCampaignImportSources(items); })
      .catch((err) => { if (!cancelled) { setCampaignImportSources([]); console.warn("[BancoDeDados] planilhas não carregadas:", err); } });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCampaignWizardOpen, clientId, isAuthenticated]);

  // Os dois números da planilha escolhida, ANTES de confirmar: quantos leads nasceram nela e quantos já existiam e foram tocados por ela
  useEffect(() => {
    setCampaignImportOrigin(null);
    setCampaignImportOriginError(null);
    if (!isCampaignWizardOpen || !campaignImportId || !isAuthenticated) return;
    let cancelled = false;
    fetchImportOrigin(leadRequest, { clientId, importId: campaignImportId })
      .then((o) => { if (!cancelled) setCampaignImportOrigin(o); })
      .catch((err) => { if (!cancelled) setCampaignImportOriginError(err?.message || "Falha ao contar os leads da planilha."); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCampaignWizardOpen, campaignImportId, clientId, isAuthenticated]);
  const [campaignAudience, setCampaignAudience] = useState<{ key: string; items: AudienceLead[]; total: number; truncated: boolean } | null>(null);
  const [campaignAudienceLoading, setCampaignAudienceLoading] = useState(false);
  const [campaignAudienceError, setCampaignAudienceError] = useState<string | null>(null);

  useEffect(() => {
    if (!isCampaignWizardOpen || campaignSourceType !== "funnel" || !isAuthenticated) return;
    let cancelled = false;
    setCampaignAudienceLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetchCampaignAudience(leadRequest, {
          clientId,
          stages: campaignStageFilters,
          tag: campaignTagFilter,
          rules: campaignFunnelFilterRules as any,
          importId: campaignImportId || null,
          importScope: campaignImportScope,
        });
        if (cancelled) return;
        setCampaignAudience({ key: campaignFiltersKey, items: res.items, total: res.total, truncated: res.truncated });
        setCampaignAudienceError(null);
      } catch (err: any) {
        if (cancelled) return;
        setCampaignAudience(null);
        setCampaignAudienceError(err instanceof AudienceRulesError ? err.message : err?.message || "Falha ao montar o público da campanha.");
      } finally {
        if (!cancelled) setCampaignAudienceLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCampaignWizardOpen, campaignSourceType, campaignFiltersKey, clientId, isAuthenticated]);

  const campaignFunnelFilteredLeads = useMemo<AudienceLead[]>(() => campaignAudience?.items ?? [], [campaignAudience]);

  // Atualiza seleção automaticamente APENAS quando os filtros da campanha mudam (tag, estágios, regras).
  // Recarga da lista de leads não altera os filtros e preserva a seleção manual do usuário.
  const prevFiltersKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const currentKey = campaignFiltersKey;

    // O público só vale para a chave com que foi carregado: enquanto o servidor responde, não reconcilia com lista velha
    if (campaignAudience && campaignAudience.key !== currentKey) return;
    if (!campaignAudience) return;

    if (prevFiltersKeyRef.current === null) {
      prevFiltersKeyRef.current = currentKey;
      return;
    }

    const { newSelection, filtersChanged } = reconcileCampaignSelection({
      prevFiltersKey: prevFiltersKeyRef.current,
      currentFiltersKey: currentKey,
      currentFilteredLeads: campaignFunnelFilteredLeads,
      currentSelection: campaignSelectedLeadIds,
    });

    if (filtersChanged) {
      prevFiltersKeyRef.current = currentKey;
      setCampaignSelectedLeadIds(newSelection);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignFiltersKey, campaignAudience]);

  const effectiveSelectedCount = useMemo(() => {
    return calculateEffectiveSelectedCount(
      campaignFunnelFilteredLeads.map((l) => l.id),
      campaignSelectedLeadIds
    );
  }, [campaignFunnelFilteredLeads, campaignSelectedLeadIds]);

  const campaignSpreadsheetFilteredRows = useMemo(() => {
    return applyDynamicRules(campaignSpreadsheetRows, campaignSpreadsheetRules);
  }, [campaignSpreadsheetRows, campaignSpreadsheetRules]);

  // Submit Campaign Audience and Redirect to Planilhas
  const handleProceedToCampaign = () => {
    let finalRows: Record<string, any>[] = [];
    let campaignTitleName = "";

    if (campaignSourceType === "funnel") {
      if (!campaignAudience || campaignAudience.key !== campaignFiltersKey) {
        toast.error("Aguarde: o público da campanha ainda está sendo calculado.");
        return;
      }
      const validFilteredIds = new Set(campaignFunnelFilteredLeads.map((l) => l.id));
      const selected = campaignFunnelFilteredLeads.filter(
        (l) => campaignSelectedLeadIds.includes(l.id) && validFilteredIds.has(l.id)
      );
      if (selected.length === 0 && (selectionMode !== "criterion" || bancoEffectiveSelectedCount === 0)) {
        toast.error("Nenhum lead selecionado para a campanha.");
        return;
      }

      const effectiveTotalCount = selectionMode === "criterion" && bancoEffectiveSelectedCount > 0
        ? bancoEffectiveSelectedCount
        : selected.length;

      campaignTitleName = buildCampaignTitle(
        campaignStageFilters,
        campaignTagFilter,
        effectiveTotalCount,
        campaignImportOrigin?.sourceName
      );

      // Bloco 3: "Criar campanha" passa o OBJETO DE CRITÉRIOS do filtro (< 500 bytes), nunca a lista bruta (> 15 MB)
      const stageCriteria = campaignStageFilters.includes("all") ? [] : campaignStageFilters;
      const tagCriteria = campaignTagFilter ? [campaignTagFilter] : [];
      const criteria: Record<string, any> = {
        clientId,
        stages: stageCriteria,
        tags: tagCriteria,
        importId: campaignImportId || undefined,
        importScope: campaignImportScope || "all",
      };
      const sheetName = campaignImportOrigin?.sourceName || pastImports.find((i) => i.id === campaignImportId)?.source_name;
      const description = selectionSummary || buildFilterAudienceDescription(criteria, effectiveTotalCount, {
        sheetName,
      });

      try {
        localStorage.setItem(
          "vexo_pending_campaign_audience",
          JSON.stringify({
            criteria,
            excludedLeadIds: selectionMode === "criterion" && excludedLeadIds.length > 0 ? excludedLeadIds : undefined,
            selectionMode,
            description,
            totalCount: effectiveTotalCount,
            campaignName: campaignTitleName,
          })
        );
      } catch (err: any) {
        toast.error("Não foi possível transferir os critérios da campanha", { description: err.message });
        return;
      }
    } else if (campaignSourceType === "second_number") {
      const aud = secondNumberSelection?.audience;
      if (!secondNumberSelection?.campaignId || !aud) {
        toast.error("Escolha a campanha e aguarde o público ser calculado.");
        return;
      }
      if (aud.items.length === 0) {
        toast.error("Nenhuma empresa elegível para a segunda tentativa.");
        return;
      }
      // O disparo vai para o NÚMERO ADICIONAL (telefone da linha). Os dois números só com a opção marcada de propósito.
      finalRows = secondNumberHandoffRows(aud.items, secondNumberSelection.campaignName, secondNumberSelection.includePrincipal);
      campaignTitleName = `Segunda tentativa: ${secondNumberSelection.campaignName} (${aud.items.length} empresas)`;
    } else {
      if (campaignSpreadsheetFilteredRows.length === 0) {
        toast.error("Nenhum contato encontrado na planilha com os filtros aplicados.");
        return;
      }
      finalRows = campaignSpreadsheetFilteredRows;
      campaignTitleName = `Campanha Planilha ${campaignFile?.name || "Importada"} (${finalRows.length} contatos)`;
    }

    if (campaignSourceType !== "funnel") {
      const buildPending = (rows: Record<string, any>[]) =>
        JSON.stringify({
          campaignName: campaignTitleName,
          rows,
          sourceDescription: campaignTagFilter
            ? `${rows.length} contatos vindos do Banco de Dados, filtrados por tag "${campaignTagFilter}"`
            : `${rows.length} contatos vindos do Banco de Dados`,
        });
      try {
        localStorage.setItem("vexo_pending_campaign_audience", buildPending(finalRows));
      } catch {
        try {
          localStorage.setItem(
            "vexo_pending_campaign_audience",
            buildPending(finalRows.map(({ resumo_ia: _omit, ...rest }) => rest))
          );
          toast.warning("Público grande: o resumo da IA não acompanhou os contatos para a campanha.");
        } catch {
          toast.error(`Público grande demais para enviar à central de campanhas (${finalRows.length.toLocaleString("pt-BR")} contatos).`, {
            description: "Restrinja o filtro (estágio, tag) e tente de novo.",
          });
          return;
        }
      }
    }

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

  // Guarda nome e telefone de quem foi selecionado (inclusive em outra página, ou por "selecionar todos"): os modais de follow-up precisam
  const rememberSelectedContacts = (contacts?: LeadContact[]) => {
    if (!contacts || contacts.length === 0) return;
    setSelectedContacts((prev) => {
      const next = { ...prev };
      for (const c of contacts) next[c.id] = c;
      return next;
    });
  };
  useEffect(() => {
    const missing = leads.filter((l) => selectedLeadIds.includes(l.id) && !selectedContacts[l.id]);
    if (missing.length > 0) {
      rememberSelectedContacts(missing.map((l) => ({ id: l.id, nome: l.nome, telefone: l.telefone, phone: l.phone })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads, selectedLeadIds]);

  // "Selecionar todos desta faixa": TODOS os leads da combinação de filtros (o servidor lista os ids), não só a página carregada
  const handleSelectAllFiltered = async () => {
    try {
      const found = await fetchLeadIds(leadRequest, { clientId, filters: listFilters, contacts: true });
      rememberSelectedContacts(found.contacts);
      setSelectedLeadIds(found.ids);
      if (found.truncated) toast.warning(`Seleção limitada a ${found.ids.length.toLocaleString("pt-BR")} leads.`);
    } catch (err: any) {
      toast.error("Não foi possível selecionar os leads do filtro", { description: err.message });
    }
  };

  // As linhas da página já vêm filtradas e ordenadas pelo servidor (SQL); a tela não refaz nenhuma conta.
  const paginatedLeads = leads;

  // Bloco 1: Seleção por Critério vs Seleção Manual
  const isLeadSelected = useCallback(
    (id: string) => {
      if (selectionMode === "criterion") {
        return !excludedLeadIds.includes(id);
      }
      return selectedLeadIds.includes(id);
    },
    [selectionMode, excludedLeadIds, selectedLeadIds]
  );

  const pageIds = useMemo(() => paginatedLeads.map((l) => l.id), [paginatedLeads]);
  const isAllPageSelected = pageIds.length > 0 && pageIds.every((id) => isLeadSelected(id));

  const effectiveBaseTotal = selectionMode === "criterion" ? (criterionTotal || listTotal) : 0;
  const bancoEffectiveSelectedCount = useMemo(() => {
    if (selectionMode === "criterion") {
      return Math.max(0, effectiveBaseTotal - excludedLeadIds.length);
    }
    return selectedLeadIds.length;
  }, [selectionMode, effectiveBaseTotal, excludedLeadIds.length, selectedLeadIds.length]);

  const handleSelectAllByCriterion = () => {
    setSelectionMode("criterion");
    setCriterionTotal(listTotal);
    setExcludedLeadIds([]);
    setSelectedLeadIds([]);
  };

  const handleOpenManageTagsQuickAction = () => {
    setSelectionMode("criterion");
    setCriterionTotal(listTotal);
    setExcludedLeadIds([]);
    setSelectedLeadIds([]);
    if (selectedTag && selectedTag.trim()) {
      setBulkTagMode("remove");
      setBulkTagValue(selectedTag.trim());
    } else {
      setBulkTagMode("add");
      setBulkTagValue("");
    }
    setIsBulkTagModalOpen(true);
  };

  const handleClearSelection = useCallback(() => {
    setSelectionMode("manual");
    setSelectedLeadIds([]);
    setExcludedLeadIds([]);
    setCriterionTotal(0);
  }, []);

  const handleToggleSelectAll = () => {
    if (selectionMode === "criterion") {
      if (isAllPageSelected) {
        // Desmarcar todos da página atual: adiciona à lista de exceções
        setExcludedLeadIds((prev) => Array.from(new Set([...prev, ...pageIds])));
      } else {
        // Remarcar todos da página atual: remove da lista de exceções
        setExcludedLeadIds((prev) => prev.filter((id) => !pageIds.includes(id)));
      }
    } else {
      if (isAllPageSelected) {
        setSelectedLeadIds((prev) => prev.filter((id) => !pageIds.includes(id)));
      } else {
        setSelectedLeadIds((prev) => Array.from(new Set([...prev, ...pageIds])));
      }
    }
  };

  const handleToggleSelectOne = (id: string) => {
    if (selectionMode === "criterion") {
      setExcludedLeadIds((prev) =>
        prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
      );
    } else {
      setSelectedLeadIds((prev) =>
        prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
      );
    }
  };

  // Trocar o filtro limpa a seleção por critério, com aviso. Nunca carregar seleção velha para filtro novo.
  const filtersKey = useMemo(() => JSON.stringify(listFilters), [listFilters]);
  const prevBancoFiltersKeyRef = useRef(filtersKey);

  useEffect(() => {
    if (prevBancoFiltersKeyRef.current !== filtersKey) {
      prevBancoFiltersKeyRef.current = filtersKey;
      if (selectionMode === "criterion") {
        setSelectionMode("manual");
        setExcludedLeadIds([]);
        setSelectedLeadIds([]);
        setCriterionTotal(0);
        toast.info("Filtro alterado: a seleção por critério anterior foi limpa.");
      }
    }
  }, [filtersKey, selectionMode]);

  const filterCriterionSummary = useMemo(() => {
    const sheetName = pastImports.find((i) => i.id === selectedImportId)?.source_name;
    const channelDef = MARKETING_CHANNELS.find((c) => c.id === selectedChannel);
    return buildFilterCriterionSummary(listFilters, {
      sheetName,
      channelName: channelDef?.name,
    });
  }, [pastImports, selectedImportId, selectedChannel, listFilters]);

  const selectionSummary = useMemo(() => {
    if (bancoEffectiveSelectedCount === 0) return null;
    if (selectionMode === "criterion") {
      return formatSelectionBarLabel({
        totalCount: effectiveBaseTotal,
        filterSummary: filterCriterionSummary,
        excludedCount: excludedLeadIds.length,
      });
    }
    return `${bancoEffectiveSelectedCount.toLocaleString("pt-BR")} lead${bancoEffectiveSelectedCount === 1 ? "" : "s"} selecionado${bancoEffectiveSelectedCount === 1 ? "" : "s"}`;
  }, [bancoEffectiveSelectedCount, selectionMode, effectiveBaseTotal, filterCriterionSummary, excludedLeadIds.length]);

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
        const isCriterion = selectionMode === "criterion";
        const payload: any = {
          clientId,
          updates: {
            stage: "buyer",
            stage_source: "manual",
            potential_contract_value: parsedValue,
          },
        };
        if (isCriterion) {
          payload.criteria = listFilters;
          if (excludedLeadIds.length > 0) payload.excludedLeadIds = excludedLeadIds;
        } else {
          payload.leadIds = markAsClientTarget.leadIds;
        }

        const res = await fetch(`${API_BASE_URL}/api/leads/bulk-update`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Falha ao atualizar leads em lote.");
        const data = await res.json().catch(() => ({}));
        const count = typeof data.updatedCount === "number"
          ? data.updatedCount
          : (isCriterion ? bancoEffectiveSelectedCount : markAsClientTarget.leadIds.length);
        toast.success(`${count.toLocaleString("pt-BR")} leads marcados como Cliente!`);
        handleClearSelection();
      }
      setIsMarkAsClientModalOpen(false);
      fetchLeads();
      loadFacets();
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
        const isCriterion = selectionMode === "criterion";
        const payload: any = {
          clientId,
          updates: {
            stage: "lost",
            stage_source: "manual",
            lost_reason: markAsLostReason,
          },
        };
        if (isCriterion) {
          payload.criteria = listFilters;
          if (excludedLeadIds.length > 0) payload.excludedLeadIds = excludedLeadIds;
        } else {
          payload.leadIds = markAsLostTarget.leadIds;
        }

        const res = await fetch(`${API_BASE_URL}/api/leads/bulk-update`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("Falha ao atualizar leads em lote.");
        const data = await res.json().catch(() => ({}));
        const count = typeof data.updatedCount === "number"
          ? data.updatedCount
          : (isCriterion ? bancoEffectiveSelectedCount : markAsLostTarget.leadIds.length);
        toast.success(`${count.toLocaleString("pt-BR")} leads marcados como Perdido!`);
        handleClearSelection();
      }
      setIsMarkAsLostModalOpen(false);
      fetchLeads();
      loadFacets();
    } catch (err: any) {
      toast.error("Erro ao marcar como perdido", { description: err.message });
    }
  };

  const handleBulkStageSubmit = async () => {
    if (bancoEffectiveSelectedCount === 0) return;
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

      const isCriterion = selectionMode === "criterion";
      const payload: any = {
        clientId,
        updates,
      };
      if (isCriterion) {
        payload.criteria = listFilters;
        if (excludedLeadIds.length > 0) payload.excludedLeadIds = excludedLeadIds;
      } else {
        payload.leadIds = selectedLeadIds;
      }

      const res = await fetch(`${API_BASE_URL}/api/leads/bulk-update`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Falha ao atualizar em lote.");
      const data = await res.json().catch(() => ({}));
      const count = typeof data.updatedCount === "number"
        ? data.updatedCount
        : (isCriterion ? bancoEffectiveSelectedCount : selectedLeadIds.length);

      toast.success(`Estágio alterado para ${count.toLocaleString("pt-BR")} leads!`);
      setIsBulkStageModalOpen(false);
      setBulkContractValue("");
      handleClearSelection();
      fetchLeads();
      loadFacets();
    } catch (err: any) {
      toast.error("Erro na atualização em lote", { description: err.message });
    }
  };

  const handleBulkTagSubmit = async () => {
    if (bancoEffectiveSelectedCount === 0 || !bulkTagValue.trim()) return;
    try {
      const token = await getIdToken();
      const isCriterion = selectionMode === "criterion";
      const isRemove = bulkTagMode === "remove";
      const payload: any = {
        clientId,
        updates: isRemove
          ? { removeTag: bulkTagValue.trim() }
          : { addTag: bulkTagValue.trim() },
      };
      if (isCriterion) {
        payload.criteria = listFilters;
        if (excludedLeadIds.length > 0) payload.excludedLeadIds = excludedLeadIds;
      } else {
        payload.leadIds = selectedLeadIds;
      }

      const res = await fetch(`${API_BASE_URL}/api/leads/bulk-update`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error(`Falha ao ${isRemove ? "remover" : "adicionar"} tag em lote.`);
      const data = await res.json().catch(() => ({}));
      const count = typeof data.updatedCount === "number"
        ? data.updatedCount
        : (isCriterion ? bancoEffectiveSelectedCount : selectedLeadIds.length);

      toast.success(`Tag "${bulkTagValue.trim()}" ${isRemove ? "removida de" : "adicionada a"} ${count.toLocaleString("pt-BR")} leads!`);
      setIsBulkTagModalOpen(false);
      setBulkTagValue("");
      handleClearSelection();
      fetchLeads();
      loadFacets();
    } catch (err: any) {
      toast.error("Erro na tag em lote", { description: err.message });
    }
  };

  const handleBulkAssignSubmit = async () => {
    if (bancoEffectiveSelectedCount === 0) return;
    try {
      const token = await getIdToken();
      const targetUid = bulkAssignValue === "none" ? null : bulkAssignValue;
      const isCriterion = selectionMode === "criterion";
      const payload: any = {
        clientId,
        updates: { assigned_to: targetUid },
      };
      if (isCriterion) {
        payload.criteria = listFilters;
        if (excludedLeadIds.length > 0) payload.excludedLeadIds = excludedLeadIds;
      } else {
        payload.leadIds = selectedLeadIds;
      }

      const res = await fetchApi(`/api/leads/bulk-update`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorMsg = await readApiErrorMessage(res, "Falha ao reatribuir leads em massa.");
        throw new Error(errorMsg);
      }
      const data = await res.json().catch(() => ({}));
      const count = typeof data.updatedCount === "number"
        ? data.updatedCount
        : (isCriterion ? bancoEffectiveSelectedCount : selectedLeadIds.length);

      toast.success(`Responsável atualizado para ${count.toLocaleString("pt-BR")} leads!`);
      setIsBulkAssignModalOpen(false);
      handleClearSelection();
      fetchLeads();
      loadFacets();
    } catch (err: any) {
      toast.error("Erro na reatribuição em lote", { description: err.message });
    }
  };

  const handleBulkDeleteSubmit = async () => {
    if (bancoEffectiveSelectedCount === 0) return;
    if (bancoEffectiveSelectedCount > 500 && deleteConfirmationInput !== "EXCLUIR") {
      toast.error("Para excluir mais de 500 leads, digite a palavra EXCLUIR.");
      return;
    }

    setIsDeletingBulk(true);
    try {
      const token = await getIdToken();
      const isCriterion = selectionMode === "criterion";
      const payload: any = {
        clientId,
        confirmation: bancoEffectiveSelectedCount > 500 ? "EXCLUIR" : undefined,
      };

      if (isCriterion) {
        payload.criteria = listFilters;
        if (excludedLeadIds.length > 0) {
          payload.excludedLeadIds = excludedLeadIds;
        }
      } else {
        payload.leadIds = selectedLeadIds;
      }

      const res = await fetch(`${API_BASE_URL}/api/leads/bulk-delete`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || data?.success === false) {
        throw new Error(data?.error?.message || data?.message || "Falha ao excluir em lote.");
      }

      const count = data.deletedCount ?? bancoEffectiveSelectedCount;
      toast.success(`${count.toLocaleString("pt-BR")} leads excluídos com sucesso!`);
      setIsBulkDeleteModalOpen(false);
      setDeleteConfirmationInput("");
      handleClearSelection();
      fetchLeads();
      loadFacets();
    } catch (err: any) {
      toast.error("Erro ao excluir leads", { description: err.message });
    } finally {
      setIsDeletingBulk(false);
    }
  };

  // Cartões de origem: SEMPRE a base inteira (painel de atribuição), agregada no banco — não dependem da página, da aba nem dos filtros
  const marketingMetrics = useMemo(
    () => computeMarketingMetricsFromCounts(facets?.channels, facets?.baseTotal ?? 0),
    [facets]
  );

  const handleOpenCampaignForChannel = async (chDef: { id: string; name: string; icon: string }) => {
    try {
      // Todos os leads da origem (a base inteira, não só os da página carregada), com nome e telefone para os modais
      const found = await fetchLeadIds(leadRequest, { clientId, filters: { channel: chDef.id }, contacts: true });
      if (found.ids.length === 0) {
        toast.error(`Nenhum lead encontrado para a origem ${chDef.name}.`);
        return;
      }
      rememberSelectedContacts(found.contacts);
      setCampaignSourceType("funnel");
      setCampaignSelectedLeadIds(found.ids);
      prevFiltersKeyRef.current = serializeCampaignFiltersKey(
        campaignStageFilters,
        campaignTagFilter,
        campaignFunnelFilterRules
      );
      setIsCampaignWizardOpen(true);
      toast.success(`Disparo Segmentado: ${chDef.icon} ${chDef.name}`, {
        description: `${found.ids.length.toLocaleString("pt-BR")} contatos selecionados para a campanha.`,
      });
    } catch (err: any) {
      toast.error("Não foi possível carregar os leads da origem", { description: err.message });
    }
  };

  const availableSources = useMemo(() => {
    const set = new Set<string>(knownSources);
    if (selectedSource) set.add(selectedSource);
    return Array.from(set).sort();
  }, [knownSources, selectedSource]);

  // Origens mais frequentes da base inteira (o servidor já devolve ordenado por contagem)
  const topSourceRanking = useMemo<Array<[string, number]>>(
    () => (facets?.sources ?? []).slice(0, 3).map((x) => [x.source, x.count]),
    [facets]
  );

  const handleToggleSort = (column: "contato" | "ultima_conversa") => {
    if (sortColumn === column) {
      if (sortDirection === "asc") {
        setSortDirection("desc");
      } else {
        setSortColumn(null);
        setSortDirection("asc");
      }
    } else {
      setSortColumn(column);
      setSortDirection("asc");
    }
  };

  // Abas: contagem do banco DENTRO do filtro ativo de tag e busca (sem filtro coincide com a base inteira).
  // Se o servidor degradou (sem abas), mostra o que sabe da base em vez de inventar.
  const stageCounts = useMemo<LeadTabCounts>(() => {
    if (tabCounts) return tabCounts;
    const base = facets?.stagesExact;
    return {
      all: facets?.baseTotal ?? listTotal,
      buyer: base?.buyer ?? 0,
      open_budget: base?.open_budget ?? 0,
      cold: base ? base.inquiry + base.cold + base.other : 0,
      lost: base?.lost ?? 0,
    };
  }, [tabCounts, facets, listTotal]);

  const getTemperatureDot = (temp?: string | null) => {
    switch (temp) {
      case "hot":
        return { color: "#D85A30", label: "Quente" };
      case "warm":
        return { color: "#EF9F27", label: "Morno" };
      case "cold":
      default:
        return { color: "#378ADD", label: "Frio" };
    }
  };

  const formatShortDate = (dateStr?: string | null): string => {
    if (!dateStr) return "-";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "-";
    const day = String(d.getDate()).padStart(2, "0");
    const month = String(d.getMonth() + 1).padStart(2, "0");
    return `${day}/${month}`;
  };

  // Total e páginas vêm do servidor (a página volta a 1 quando muda filtro, busca, ordem ou tamanho: ver o efeito de carga)
  const totalFilteredLeads = listTotal;
  const totalPages = serverTotalPages;

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

  // Tags da base inteira (vêm do banco; o seletor nunca perde uma tag por causa do filtro ou da página)
  const availableTags = useMemo(() => {
    const set = new Set<string>(knownTags);
    if (selectedTag) set.add(selectedTag);
    return Array.from(set).sort();
  }, [knownTags, selectedTag]);
  // as mesmas tags, com o tipo (planilha, origem, IA, minhas) para o seletor agrupado; a tag selecionada que não está na lista entra como "minhas"
  const availableTagItems = useMemo(() => {
    const items = (facets?.tags ?? []).map((t) => ({ tag: t.tag, kind: t.kind }));
    if (selectedTag && !items.some((i) => i.tag === selectedTag)) items.push({ tag: selectedTag, kind: "minhas" as const });
    return items;
  }, [facets, selectedTag]);

  // Checagem de filtros ativos e limpador global
  const hasActiveFilters = Boolean(
    selectedTag ||
    selectedSource ||
    selectedChannel !== "all" ||
    searchQuery.trim() ||
    activeTab !== "all" ||
    selectedSegment !== null ||
    selectedImportId
  );

  const handleClearAllFilters = () => {
    setSelectedTag("");
    setSelectedSource("");
    setSelectedChannel("all");
    setSearchQuery("");
    setActiveTab("all");
    setSelectedSegment(null);
    setSelectedImportId("");
  };

  const activeSegmentTitle = useMemo(() => {
    if (!selectedSegment) return null;
    const seg = potentialSegments.find((s) => s.id === selectedSegment);
    return seg?.title || selectedSegment;
  }, [selectedSegment, potentialSegments]);

  // Badges & Temperature Helpers
  const getStageBadge = (stage?: string | null, lostReason?: string | null, stageSource?: string | null) => {
    switch (stage) {
      case "buyer":
        return (
          <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 gap-1 text-[11px] py-[2px] px-[8px] font-medium">
            Comprador 🟢
            {stageSource === "manual" && <span className="text-[10px] opacity-75 font-normal">(Manual)</span>}
            {stageSource === "integration" && <span className="text-[10px] opacity-75 font-normal">(Webhook)</span>}
          </Badge>
        );
      case "open_budget":
        return <Badge className="bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 text-[11px] py-[2px] px-[8px] font-medium">Orçamento Aberto 🟡</Badge>;
      case "inquiry":
        return <Badge className="bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30 text-[11px] py-[2px] px-[8px] font-medium">Em Dúvida 🔵</Badge>;
      case "lost":
        const reasonObj = LOST_REASONS.find((r) => r.id === lostReason);
        return (
          <Badge className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 gap-1 text-[11px] py-[2px] px-[8px] font-medium" title={reasonObj?.label || lostReason || undefined}>
            Perdido 🔴
            {lostReason && <span className="text-[10px] opacity-75 font-normal">({reasonObj?.id || lostReason})</span>}
          </Badge>
        );
      case "cold":
      default:
        return <Badge className="bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30 text-[11px] py-[2px] px-[8px] font-medium">Lead Frio ⚪</Badge>;
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
          <BancoActionsBar
            loading={loading}
            onRefresh={() => fetchLeads()}
            onExtractWhatsApp={() => setIsWAModalOpen(true)}
            onImportInstagram={() => setIsInstagramImportModalOpen(true)}
            onPasteText={() => {
              setAiStep(1);
              setIsAIImportModalOpen(true);
            }}
            onImportSpreadsheet={() => setIsImportModalOpen(true)}
            onManageSpreadsheets={() => setIsSavedSheetsOpen(true)}
            onExportXLSX={handleExportXLSX}
            onExportCSV={handleExportCSV}
            onCreateCampaign={handleOpenCampaignWizard}
            onNewLead={() => setIsCreateModalOpen(true)}
            onManageTags={handleOpenManageTagsQuickAction}
            hasFilteredLeads={listTotal > 0 || (facets?.baseTotal ?? 0) > 0}
            selectedCount={bancoEffectiveSelectedCount}
            selectionSummary={selectionSummary}
            onClearSelection={handleClearSelection}
            onApplyFollowup={() => setIsFollowupModalOpen(true)}
            onSingleReminder={() => setIsSingleReminderModalOpen(true)}
            clientId={clientId}
            canManageBulk={canMassDelete}
            isCriterionSelection={selectionMode === "criterion"}
          />
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

          <div className={cn("grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-7 gap-2.5", !isAdvancedOriginsUnlocked && "opacity-40 blur-[0.5px] pointer-events-none")}>
            {MARKETING_CHANNELS.map((ch) => {
              const count = isAdvancedOriginsUnlocked ? (marketingMetrics.counts[ch.id] || 0) : 124;
              const pct = isAdvancedOriginsUnlocked ? (marketingMetrics.percentages[ch.id] || 0) : 18;
              const isSelected = isAdvancedOriginsUnlocked && selectedChannel === ch.id;

              return (
                <button
                  key={ch.id}
                  type="button"
                  onClick={() => isAdvancedOriginsUnlocked && setSelectedChannel((prev) => (prev === ch.id ? "all" : ch.id))}
                  title={isAdvancedOriginsUnlocked && !channelsUnavailable ? `${ch.name}: ${count} leads (${pct}%)` : ch.name}
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
                      {isAdvancedOriginsUnlocked && channelsUnavailable ? "—" : count.toLocaleString("pt-BR")}
                    </span>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0 font-bold shrink-0", ch.badgeClass)}>
                      {isAdvancedOriginsUnlocked && channelsUnavailable ? "—" : `${pct}%`}
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
                      {count} {count === 1 ? "lead encontrado" : "leads encontrados"} ({marketingMetrics.percentages[activeCh.id]}% da base total)
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
                    Criar Campanha no WhatsApp ({activeCh.name}) ({count})
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
                const isSelected = selectedSegment === segment.id;
                return (
                  <button
                    key={segment.id}
                    type="button"
                    onClick={() =>
                      setSelectedSegment(isSelected ? null : (segment.id as BasePotentialSegmentId))
                    }
                    className={cn(
                      "h-full transition-all hover:opacity-90 focus:outline-none cursor-pointer shrink relative",
                      segment.barColor,
                      isSelected && "ring-2 ring-primary ring-inset brightness-110 z-10"
                    )}
                    style={{
                      width: `${percentage}%`,
                      minWidth: "4px",
                    }}
                    title={`${segment.title}: ${segment.count.toLocaleString("pt-BR")} (clique para filtrar)`}
                    aria-label={`${segment.title}: ${segment.count.toLocaleString("pt-BR")}`}
                  />
                );
              })
            )}
          </div>

          {/* Legenda em 3 colunas (empilha em 1 no mobile) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 pt-1">
            {potentialSegments.map((segment) => {
              const isSelected = selectedSegment === segment.id;
              return (
                <div
                  key={segment.id}
                  onClick={() =>
                    setSelectedSegment(isSelected ? null : (segment.id as BasePotentialSegmentId))
                  }
                  className={cn(
                    "flex items-start justify-between p-2.5 rounded-lg border transition-all cursor-pointer group",
                    isSelected
                      ? "ring-2 ring-primary border-primary bg-primary/5 dark:bg-primary/10 shadow-sm"
                      : "border-border/60 bg-card hover:bg-muted/40 hover:border-border"
                  )}
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className={cn("w-1.5 self-stretch rounded-full shrink-0 my-0.5", segment.indicatorColor)} />
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground font-medium truncate">
                          {segment.title} · {segment.count.toLocaleString("pt-BR")}
                        </span>
                        {isSelected && (
                          <Badge variant="secondary" className="text-[10px] ml-1.5 h-4 px-1.5 font-normal">
                            Ativo
                          </Badge>
                        )}
                      </div>
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
                  </div>

                  {/* Botão de Info com Popover explicativo */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground/60 hover:text-foreground p-1 rounded-full hover:bg-muted shrink-0 transition-colors"
                        title="Ver explicação desta faixa"
                        aria-label={`Explicação sobre ${segment.title}`}
                      >
                        <HelpCircle className="w-3.5 h-3.5" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 text-xs p-3 space-y-1.5" side="bottom" align="end">
                      <div className="flex items-center gap-1.5 font-semibold text-foreground text-sm">
                        <div className={cn("w-2 h-2 rounded-full shrink-0", segment.indicatorColor)} />
                        <span>{segment.title}</span>
                      </div>
                      <p className="text-muted-foreground leading-relaxed">{segment.explanation}</p>
                    </PopoverContent>
                  </Popover>
                </div>
              );
            })}
          </div>
        </Card>

        {/* Barra de Abas e Busca */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border dark:border-zinc-800 pb-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab("all")}
              className={cn(
                "rounded-full text-xs text-muted-foreground hover:text-foreground",
                activeTab === "all" && "bg-muted font-medium text-foreground shadow-sm"
              )}
            >
              Todas <span className="ml-1 text-foreground/80 font-normal">({stageCounts.all})</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab("buyer")}
              className={cn(
                "rounded-full text-xs text-muted-foreground hover:text-foreground",
                activeTab === "buyer" && "bg-muted font-medium text-foreground shadow-sm"
              )}
            >
              Compradores <span className="ml-1 text-emerald-600 dark:text-emerald-400 font-semibold">({stageCounts.buyer})</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab("open_budget")}
              className={cn(
                "rounded-full text-xs text-muted-foreground hover:text-foreground",
                activeTab === "open_budget" && "bg-muted font-medium text-foreground shadow-sm"
              )}
            >
              Orçamentos Abertos <span className="ml-1 text-amber-600 dark:text-amber-400 font-semibold">({stageCounts.open_budget})</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab("cold")}
              className={cn(
                "rounded-full text-xs text-muted-foreground hover:text-foreground",
                activeTab === "cold" && "bg-muted font-medium text-foreground shadow-sm"
              )}
            >
              Leads Frios <span className="ml-1 text-blue-600 dark:text-blue-400 font-semibold">({stageCounts.cold})</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setActiveTab("lost")}
              className={cn(
                "rounded-full text-xs text-muted-foreground hover:text-foreground",
                activeTab === "lost" && "bg-muted font-medium text-foreground shadow-sm"
              )}
            >
              Perdidos <span className="ml-1 text-rose-600 dark:text-rose-400 font-semibold">({stageCounts.lost})</span>
            </Button>

            <Button
              variant="ghost"
              size="sm"
              data-testid="tab-contacts-without-channel"
              onClick={() => setActiveTab("contacts_without_channel")}
              className={cn(
                "rounded-full text-xs text-muted-foreground hover:text-foreground gap-1.5",
                activeTab === "contacts_without_channel" && "bg-muted font-medium text-foreground shadow-sm"
              )}
            >
              <Instagram className="w-3 h-3 text-pink-500" />
              Instagram Direct / Sem WhatsApp
              {contactsWithoutChannel.length > 0 && (
                <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30">
                  {contactsWithoutChannel.length}
                </span>
              )}
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

            {(availableTags.length > 0 || selectedTag) && (
              <TagSelect
                value={selectedTag}
                onChange={setSelectedTag}
                tags={availableTagItems}
                data-testid="tag-select"
                className="h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:ring-1 focus:ring-ring"
              />
            )}

            {pastImports.length > 0 && (
              <select
                value={selectedImportId}
                onChange={(e) => setSelectedImportId(e.target.value)}
                data-testid="spreadsheet-filter-select"
                aria-label="Filtrar por planilha"
                className="h-9 px-3 rounded-md border border-input bg-background text-xs text-foreground focus:ring-1 focus:ring-ring max-w-[200px] truncate"
              >
                <option value="">Todas as planilhas</option>
                {pastImports.map((imp) => (
                  <option key={imp.id} value={imp.id}>
                    {imp.source_name} ({imp.imported_rows})
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
            {selectedImportId && (
              <Badge variant="secondary" className="gap-1 text-[11px] pr-1 bg-muted/80">
                Planilha: {pastImports.find((i) => i.id === selectedImportId)?.source_name || "Selecionada"}
                <button
                  type="button"
                  onClick={() => setSelectedImportId("")}
                  className="hover:text-rose-500 p-0.5 rounded"
                  title="Remover filtro de planilha"
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
            {selectedSegment && (
              <>
                <Badge variant="outline" className="gap-1.5 py-1 px-2.5 bg-background">
                  <span>Faixa: <strong>{activeSegmentTitle}</strong></span>
                  <button
                    type="button"
                    onClick={() => setSelectedSegment(null)}
                    className="hover:text-destructive p-0.5 rounded"
                    title="Remover filtro de faixa"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSelectAllFiltered}
                  className="text-xs h-7 gap-1.5"
                >
                  <CheckSquare className="w-3.5 h-3.5" />
                  Selecionar todos desta faixa ({listTotal.toLocaleString("pt-BR")})
                </Button>
              </>
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

        {/* Tabela Principal ou Trabalho Manual do Instagram */}
        {activeTab === "contacts_without_channel" ? (
          <ContactsWithoutChannelSection
            clientId={clientId}
            onLeadConverted={fetchLeads}
          />
        ) : (
          <Card className="bg-card text-card-foreground border-border shadow-sm dark:bg-zinc-900/60 dark:border-zinc-800">
          <CardContent className="p-0">
            {listDegraded && (
              <div
                role="alert"
                data-testid="leads-degraded-banner"
                className="flex items-start gap-2 px-4 py-3 border-b border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200 text-xs"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Os filtros não puderam ser aplicados agora: esta é a lista simples da base, sem busca, aba, origem nem ordenação. Os números das abas
                  ficam indisponíveis até o servidor responder normalmente.
                  {listDegradedCause && (
                    <span data-testid="leads-degraded-cause" className="block mt-1 font-mono text-[11px] opacity-80">
                      Causa: {listDegradedCause}
                    </span>
                  )}
                  <Button variant="link" size="sm" onClick={fetchLeads} className="h-auto p-0 ml-2 text-xs underline">
                    Tentar novamente
                  </Button>
                </span>
              </div>
            )}
            {facetsFailedParts.length > 0 && (
              <div
                role="alert"
                data-testid="leads-facets-partial"
                className="flex items-start gap-2 px-4 py-3 border-b border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200 text-xs"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>
                  Não foi possível calcular agora: {facetsFailedParts.map(([part]) => FACET_PART_LABELS[part] || part).join("; ")}. O restante da tela
                  funciona normalmente.
                  <span className="block mt-1 font-mono text-[11px] opacity-80">
                    {facetsFailedParts.map(([part, cause]) => `${part}: ${cause.message}${cause.code ? ` [${cause.code}]` : ""}`).join(" | ")}
                  </span>
                  <Button variant="link" size="sm" onClick={loadFacets} className="h-auto p-0 mt-1 text-xs underline">
                    Tentar novamente
                  </Button>
                </span>
              </div>
            )}
            {facetsError && (
              <div
                role="alert"
                data-testid="leads-facets-error"
                className="flex items-start gap-2 px-4 py-3 border-b border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300 text-xs"
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>Não foi possível calcular os totais da base ({facetsError}). Cartões de origem e faixas podem estar desatualizados.</span>
              </div>
            )}
            {loading && leads.length === 0 ? (
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
            ) : leads.length === 0 ? (
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
                    <TableRow className="border-b border-border dark:border-zinc-800 bg-muted/40 text-[10px] uppercase tracking-wider font-semibold">
                      <TableHead className="w-[40px] px-3 py-[10px]">
                        <input
                          type="checkbox"
                          data-testid="header-select-all-checkbox"
                          checked={isAllPageSelected}
                          onChange={handleToggleSelectAll}
                          className="rounded border-input text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                        />
                      </TableHead>
                      <TableHead className="w-[280px] py-[10px]">
                        <button
                          type="button"
                          onClick={() => handleToggleSort("contato")}
                          className={cn(
                            "inline-flex items-center gap-1 hover:text-foreground font-semibold uppercase tracking-wider text-[10px] transition-colors",
                            sortColumn === "contato" ? "text-indigo-600 dark:text-indigo-400 font-bold" : "text-muted-foreground"
                          )}
                          title="Ordenar por Contato"
                        >
                          <span>Contato</span>
                          {sortColumn === "contato" ? (
                            sortDirection === "asc" ? (
                              <ArrowUp className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                            ) : (
                              <ArrowDown className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-40 hover:opacity-80" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead className="w-[160px] py-[10px]">
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            "text-[10px] uppercase tracking-wider font-semibold",
                            selectedSource ? "text-indigo-600 dark:text-indigo-400 font-bold" : "text-muted-foreground"
                          )}>
                            Origem
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className={cn(
                                  "p-1 rounded hover:bg-muted transition-colors",
                                  selectedSource ? "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50" : "text-muted-foreground/60 hover:text-foreground"
                                )}
                                title={selectedSource ? `Origem filtrada: ${selectedSource}` : "Filtrar por Origem"}
                              >
                                <Filter className={cn("w-3 h-3", selectedSource && "fill-indigo-600 dark:fill-indigo-400")} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-48 max-h-64 overflow-y-auto">
                              <DropdownMenuItem
                                onClick={() => setSelectedSource("")}
                                className={cn("text-xs cursor-pointer", !selectedSource && "font-semibold text-indigo-600 dark:text-indigo-400")}
                              >
                                Todas as Origens
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              {availableSources.map((s) => (
                                <DropdownMenuItem
                                  key={s}
                                  onClick={() => setSelectedSource(s)}
                                  className={cn("text-xs cursor-pointer truncate", selectedSource === s && "font-semibold text-indigo-600 dark:text-indigo-400")}
                                >
                                  {s}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableHead>
                      <TableHead className="w-[160px] py-[10px]">
                        <div className="flex items-center gap-1.5">
                          <span className={cn(
                            "text-[10px] uppercase tracking-wider font-semibold",
                            activeTab !== "all" ? "text-indigo-600 dark:text-indigo-400 font-bold" : "text-muted-foreground"
                          )}>
                            Estágio
                          </span>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                type="button"
                                className={cn(
                                  "p-1 rounded hover:bg-muted transition-colors",
                                  activeTab !== "all" ? "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/50" : "text-muted-foreground/60 hover:text-foreground"
                                )}
                                title={activeTab !== "all" ? `Estágio filtrado: ${activeTab}` : "Filtrar por Estágio"}
                              >
                                <Filter className={cn("w-3 h-3", activeTab !== "all" && "fill-indigo-600 dark:fill-indigo-400")} />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-48">
                              <DropdownMenuItem
                                onClick={() => setActiveTab("all")}
                                className={cn("text-xs cursor-pointer", activeTab === "all" && "font-semibold text-indigo-600 dark:text-indigo-400")}
                              >
                                Todos ({stageCounts.all})
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setActiveTab("buyer")}
                                className={cn("text-xs cursor-pointer text-emerald-600 dark:text-emerald-400", activeTab === "buyer" && "font-semibold bg-emerald-50 dark:bg-emerald-950/40")}
                              >
                                Comprador 🟢 ({stageCounts.buyer})
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setActiveTab("open_budget")}
                                className={cn("text-xs cursor-pointer text-amber-600 dark:text-amber-400", activeTab === "open_budget" && "font-semibold bg-amber-50 dark:bg-amber-950/40")}
                              >
                                Orçamento Aberto 🟡 ({stageCounts.open_budget})
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setActiveTab("cold")}
                                className={cn("text-xs cursor-pointer text-blue-600 dark:text-blue-400", activeTab === "cold" && "font-semibold bg-blue-50 dark:bg-blue-950/40")}
                              >
                                Lead Frio 🔵 ({stageCounts.cold})
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => setActiveTab("lost")}
                                className={cn("text-xs cursor-pointer text-rose-600 dark:text-rose-400", activeTab === "lost" && "font-semibold bg-rose-50 dark:bg-rose-950/40")}
                              >
                                Perdido 🔴 ({stageCounts.lost})
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </TableHead>
                      <TableHead className="w-[150px] py-[10px]">
                        <button
                          type="button"
                          onClick={() => handleToggleSort("ultima_conversa")}
                          className={cn(
                            "inline-flex items-center gap-1 hover:text-foreground font-semibold uppercase tracking-wider text-[10px] transition-colors",
                            sortColumn === "ultima_conversa" ? "text-indigo-600 dark:text-indigo-400 font-bold" : "text-muted-foreground"
                          )}
                          title="Ordenar por Última conversa"
                        >
                          <span>Última conversa</span>
                          {sortColumn === "ultima_conversa" ? (
                            sortDirection === "asc" ? (
                              <ArrowUp className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                            ) : (
                              <ArrowDown className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3 h-3 opacity-40 hover:opacity-80" />
                          )}
                        </button>
                      </TableHead>
                      <TableHead className="text-right w-[170px] py-[10px] text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                        Ação
                      </TableHead>
                    </TableRow>
                    {((isAllPageSelected && listTotal > paginatedLeads.length) || selectionMode === "criterion") && (
                      <TableRow
                        data-testid="selection-criterion-banner"
                        className="bg-indigo-50/90 dark:bg-indigo-950/60 border-b border-indigo-200/80 dark:border-indigo-900/50 hover:bg-indigo-50/90 dark:hover:bg-indigo-950/60 transition-colors"
                      >
                        <TableCell colSpan={8} className="py-2.5 px-4 text-center text-xs font-medium text-indigo-950 dark:text-indigo-200">
                          {selectionMode === "criterion" ? (
                            <span>
                              Todos os <strong>{effectiveBaseTotal.toLocaleString("pt-BR")}</strong> leads que batem com este filtro estão selecionados
                              {excludedLeadIds.length > 0 && (
                                <span className="font-normal opacity-90">
                                  {" "}
                                  (−{excludedLeadIds.length.toLocaleString("pt-BR")}{" "}
                                  {excludedLeadIds.length === 1 ? "desmarcado" : "desmarcados"})
                                </span>
                              )}
                              .{" "}
                              <button
                                type="button"
                                onClick={handleClearSelection}
                                data-testid="btn-clear-criterion-selection"
                                className="font-semibold text-indigo-700 dark:text-indigo-300 underline hover:text-indigo-950 dark:hover:text-indigo-100 cursor-pointer ml-1"
                              >
                                Limpar seleção
                              </button>
                            </span>
                          ) : (
                            <span>
                              Todos os <strong>{paginatedLeads.length}</strong> leads desta página estão selecionados.{" "}
                              <button
                                type="button"
                                onClick={handleSelectAllByCriterion}
                                data-testid="btn-select-all-criterion"
                                className="font-bold text-indigo-700 dark:text-indigo-300 underline hover:text-indigo-950 dark:hover:text-indigo-100 cursor-pointer ml-1"
                              >
                                Selecionar todos os {listTotal.toLocaleString("pt-BR")} que batem com este filtro
                              </button>
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    )}
                  </TableHeader>
                  <TableBody>
                    {paginatedLeads.map((lead) => {
                      const displayPhone = lead.phone || lead.telefone || "";
                      const displayName = lead.nome || "Sem Nome";
                      const isSelected = isLeadSelected(lead.id);
                      const tempDot = getTemperatureDot(lead.temperature);
                      const shortDate = formatShortDate(lead.last_interaction_at || lead.created_at);
                      const fullDate = lead.last_interaction_at
                        ? new Date(lead.last_interaction_at).toLocaleString("pt-BR")
                        : lead.created_at
                        ? new Date(lead.created_at).toLocaleString("pt-BR")
                        : undefined;

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
                          <TableCell className="px-3 py-[10px]" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              data-testid={`lead-checkbox-${lead.id}`}
                              checked={isSelected}
                              onChange={() => handleToggleSelectOne(lead.id)}
                              className="rounded border-input text-indigo-600 focus:ring-indigo-500 cursor-pointer"
                            />
                          </TableCell>

                          {/* Coluna 1: Contato */}
                          <TableCell className="text-[12.5px] py-[10px] font-medium max-w-[280px]">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="inline-block w-[7px] h-[7px] rounded-full shrink-0"
                                style={{ backgroundColor: tempDot.color }}
                                title={`Temperatura: ${tempDot.label}`}
                              />
                              <div className="w-7 h-7 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold text-[11px] shrink-0">
                                {displayName.substring(0, 2).toUpperCase()}
                              </div>
                              <div className="flex flex-col min-w-0 flex-1">
                                <span className="text-[12.5px] font-semibold text-foreground truncate block" title={displayName}>
                                  {displayName}
                                </span>
                                {lead.extracted_from_wa && (
                                  <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1 shrink-0">
                                    <Sparkles className="w-2.5 h-2.5" /> Extraído via WA
                                  </span>
                                )}
                              </div>
                            </div>
                          </TableCell>

                          {/* Coluna 2: Origem */}
                          <TableCell className="text-[11.5px] py-[10px]">
                            {renderSourceBadge(getLeadSource(lead))}
                          </TableCell>

                          {/* Coluna 3: Estágio */}
                          <TableCell className="text-[12.5px] py-[10px]">
                            {getStageBadge(lead.stage, lead.lost_reason, lead.stage_source)}
                          </TableCell>

                          {/* Coluna 4: Última conversa */}
                          <TableCell className="text-[11.5px] py-[10px] text-muted-foreground">
                            <div className="flex items-center gap-1.5 tabular-nums font-mono text-[11.5px]" title={fullDate}>
                              <Clock className="w-3 h-3 shrink-0 text-muted-foreground/70" />
                              <span>{shortDate}</span>
                            </div>
                          </TableCell>

                          {/* Coluna 5: Ação */}
                          <TableCell className="text-right py-[10px]" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5">
                              <Button
                                size="sm"
                                variant="outline"
                                title={Boolean(lead.raw_chat_summary && String(lead.raw_chat_summary).trim().length > 0) ? "Abrir conversa" : "Iniciar conversa"}
                                onClick={() => handleSendWhatsApp(displayPhone, displayName, lead.raw_chat_summary)}
                                className="h-7 text-xs gap-1.5 text-emerald-600 border-emerald-500/30 hover:bg-emerald-500/10 dark:text-emerald-400 font-medium px-2.5 whitespace-nowrap"
                              >
                                <MessageCircle className="w-3.5 h-3.5" />
                                {Boolean(lead.raw_chat_summary && String(lead.raw_chat_summary).trim().length > 0) ? "Abrir conversa" : "Iniciar conversa"}
                              </Button>

                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                    title="Mais ações"
                                  >
                                    <MoreHorizontal className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                  <DropdownMenuItem
                                    onClick={() => openMarkAsClientModal({ type: "single", leadId: lead.id })}
                                    className="text-xs gap-2 cursor-pointer text-emerald-600 dark:text-emerald-400 focus:text-emerald-600 focus:bg-emerald-50 dark:focus:bg-emerald-950/40"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Marcar como Comprador
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => openMarkAsLostModal({ type: "single", leadId: lead.id })}
                                    className="text-xs gap-2 cursor-pointer text-rose-600 dark:text-rose-400 focus:text-rose-600 focus:bg-rose-50 dark:focus:bg-rose-950/40"
                                  >
                                    <XCircle className="w-3.5 h-3.5" />
                                    Marcar como Perdido
                                  </DropdownMenuItem>
                                  <DropdownMenuSeparator />
                                  <DropdownMenuItem
                                    onClick={() => {
                                      setSelectedLead(lead);
                                      setIsDetailSheetOpen(true);
                                    }}
                                    className="text-xs gap-2 cursor-pointer"
                                  >
                                    <FileText className="w-3.5 h-3.5 text-muted-foreground" />
                                    Ver detalhes
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {/* Legenda de Temperatura */}
                <div className="flex items-center gap-4 text-[11px] text-muted-foreground px-4 py-2 border-t border-border/60 bg-muted/10">
                  <span className="font-medium text-muted-foreground/80">Temperatura:</span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-[7px] h-[7px] rounded-full" style={{ backgroundColor: "#D85A30" }} /> Quente
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-[7px] h-[7px] rounded-full" style={{ backgroundColor: "#EF9F27" }} /> Morno
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="inline-block w-[7px] h-[7px] rounded-full" style={{ backgroundColor: "#378ADD" }} /> Frio
                  </span>
                </div>
              </div>
            )}

            {/* Rodapé de Paginação */}
            {listTotal > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-border dark:border-zinc-800 bg-muted/20 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-muted-foreground">
                    Exibindo <span className="font-semibold text-foreground">{Math.min(listTotal, (currentPage - 1) * pageSize + 1)}</span>–<span className="font-semibold text-foreground">{Math.min(currentPage * pageSize, listTotal)}</span> de <span className="font-semibold text-foreground">{listTotal.toLocaleString("pt-BR")}</span> leads
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
        )}

        {/* Barra Flutuante de Ações em Lote (Bulk Actions) */}
        {bancoEffectiveSelectedCount > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-4 py-3 rounded-xl shadow-2xl flex items-center gap-2.5 border border-zinc-700 dark:border-zinc-300 animate-in fade-in slide-in-from-bottom-4">
            <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-indigo-500 text-white shrink-0">
              {bancoEffectiveSelectedCount.toLocaleString("pt-BR")} selecionados
            </span>

            <div className="h-4 w-px bg-zinc-700 dark:bg-zinc-300 shrink-0" />

            {/* Ação 1: Comprador */}
            <Button
              size="sm"
              variant="ghost"
              data-testid="btn-floating-buyer"
              onClick={() => openMarkAsClientModal({ type: "bulk", leadIds: selectedLeadIds })}
              className="text-xs h-8 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-emerald-400 hover:text-emerald-300 dark:text-emerald-600 dark:hover:text-emerald-700 font-semibold gap-1.5"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Comprador ({bancoEffectiveSelectedCount.toLocaleString("pt-BR")})
            </Button>

            {/* Ação 2: Perdido */}
            <Button
              size="sm"
              variant="ghost"
              data-testid="btn-floating-lost"
              onClick={() => openMarkAsLostModal({ type: "bulk", leadIds: selectedLeadIds })}
              className="text-xs h-8 hover:bg-zinc-800 dark:hover:bg-zinc-200 text-rose-400 hover:text-rose-300 dark:text-rose-600 dark:hover:text-rose-700 font-semibold gap-1.5"
            >
              <XCircle className="w-3.5 h-3.5" />
              Perdido ({bancoEffectiveSelectedCount.toLocaleString("pt-BR")})
            </Button>

            {/* Ação 3: Estágio ▾ */}
            <Button
              size="sm"
              variant="ghost"
              data-testid="btn-floating-stage"
              onClick={() => setIsBulkStageModalOpen(true)}
              className="text-xs h-8 hover:bg-zinc-800 dark:hover:bg-zinc-200 gap-1"
            >
              Estágio <ChevronDown className="w-3 h-3 opacity-70" />
            </Button>

            {/* Ação 4: Tag */}
            <Button
              size="sm"
              variant="ghost"
              data-testid="btn-floating-tag"
              onClick={() => {
                setBulkTagMode("add");
                setBulkTagValue("");
                setIsBulkTagModalOpen(true);
              }}
              className="text-xs h-8 hover:bg-zinc-800 dark:hover:bg-zinc-200 gap-1.5"
            >
              <TagIcon className="w-3.5 h-3.5" />
              Tag
            </Button>

            {/* Menu ⋯ (Mais Ações) */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="btn-floating-more"
                  className="text-xs h-8 w-8 p-0 hover:bg-zinc-800 dark:hover:bg-zinc-200"
                  title="Mais ações"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem
                  onClick={() => setIsFollowupModalOpen(true)}
                  className="text-xs gap-2 cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                  Aplicar follow-up
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={bancoEffectiveSelectedCount !== 1}
                  title={bancoEffectiveSelectedCount !== 1 ? "O lembrete avulso é individual. Para múltiplos leads ou filtros, utilize 'Aplicar follow-up'." : undefined}
                  onClick={() => setIsSingleReminderModalOpen(true)}
                  className="text-xs gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Clock className="w-3.5 h-3.5 text-emerald-500" />
                  Lembrete avulso
                </DropdownMenuItem>
                {canManageUsers && (
                  <DropdownMenuItem
                    onClick={() => setIsBulkAssignModalOpen(true)}
                    className="text-xs gap-2 cursor-pointer"
                  >
                    <UserCheck className="w-3.5 h-3.5 text-sky-500" />
                    Reatribuir responsável
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  onClick={handleExportXLSX}
                  className="text-xs gap-2 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5 text-muted-foreground" />
                  Exportar seleção
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid="btn-floating-delete"
                  disabled={!canMassDelete}
                  title={!canMassDelete ? "Apenas gestor ou administrador pode excluir leads" : undefined}
                  onClick={() => {
                    setDeleteConfirmationInput("");
                    setIsBulkDeleteModalOpen(true);
                  }}
                  className="text-xs gap-2 text-rose-600 focus:text-rose-600 focus:bg-rose-50 dark:focus:bg-rose-950/40 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              size="icon"
              variant="ghost"
              onClick={handleClearSelection}
              className="h-7 w-7 text-zinc-400 hover:text-white dark:hover:text-zinc-900"
              title="Limpar seleção"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Modal A) Mineração Semântica via WhatsApp */}
      <Dialog
        open={isWAModalOpen}
        onOpenChange={(open) => {
          setIsWAModalOpen(open);
          // Fechar sem extrair não pode deixar origem marcada "fantasma" —
          // o Dialog desmonta a seção de grupos e ela reabre sem seleção;
          // o estado do pai tem que acompanhar, senão a próxima extração
          // herda uma escolha que a tela já não mostra mais.
          if (!open) resetWaSourceSelection();
        }}
      >
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
                onChange={(e) => {
                  const newInst = e.target.value;
                  setSelectedInstanceId(newInst);
                  setWaSelectedGroupIds([]);
                  setWaSelectedGroups([]);
                  setWaGroupsInstanceId(newInst);
                }}
                disabled={isExtractingWA}
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

            {!isAdvancedPlan && (
              <div data-testid="wa-plan-limit-notice" className="text-[11px] text-muted-foreground flex items-center gap-1.5 bg-muted/40 p-2 rounded-md border border-border/50">
                <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                <span>
                  No Plano Essencial, a extração analisa até <strong>500 conversas</strong> recentes (ilimitado no Plano Avançado).
                </span>
              </div>
            )}

            <div className="border-t border-border pt-3">
              <p className="text-xs font-semibold text-foreground mb-1.5">Origem dos contatos</p>
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <Checkbox
                    checked={waIncludeConversas}
                    onCheckedChange={(v) => setWaIncludeConversas(v === true)}
                    disabled={isExtractingWA}
                    aria-label="Conversas"
                  />
                  Conversas
                </label>
                <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                  <Checkbox
                    checked={waIncludeAgenda}
                    onCheckedChange={(v) => setWaIncludeAgenda(v === true)}
                    disabled={isExtractingWA}
                    aria-label="Agenda"
                  />
                  Agenda
                </label>
                <WaGroupExtractionSection
                  clientId={clientId}
                  instanceId={selectedInstanceId}
                  getIdToken={getIdToken}
                  confirmed={hasConfirmedGroupsWarning}
                  onConfirmedChange={setHasConfirmedGroupsWarning}
                  onSelectionChange={(groupIds, selectedList) => {
                    setWaSelectedGroupIds(groupIds);
                    setWaSelectedGroups(selectedList || []);
                    setWaGroupsInstanceId(selectedInstanceId);
                  }}
                  onEnabledChange={setWaIncludeGroups}
                  disabled={isExtractingWA}
                />
              </div>
            </div>

            {isExtractingWA && (
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-3 text-center space-y-2">
                <RefreshCw className="w-5 h-5 text-emerald-600 animate-spin mx-auto" />
                <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  {waExtractStep || "Minerando contatos..."}
                </p>
                {waExtractProgress && (
                  <div className="text-[11px] text-muted-foreground space-y-0.5">
                    {waExtractProgress.totalGroups > 0 && waExtractProgress.phase === "grupos" && (
                      <p>
                        Grupo {waExtractProgress.currentGroupIndex} de {waExtractProgress.totalGroups}
                        {waExtractProgress.remainingGroups > 0 ? ` · Restam ${waExtractProgress.remainingGroups}` : ""}
                      </p>
                    )}
                    <p className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      {waExtractProgress.totalExtracted} contato{waExtractProgress.totalExtracted === 1 ? "" : "s"} já minerado{waExtractProgress.totalExtracted === 1 ? "" : "s"}
                    </p>
                  </div>
                )}
                {waExtractProgress && ((waExtractProgress.failures && waExtractProgress.failures.length > 0) || waExtractProgress.failedGroups.length > 0) && (
                  <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 rounded p-1.5 text-left space-y-0.5">
                    <p className="font-semibold">Itens com erro ({(waExtractProgress.failures || waExtractProgress.failedGroups).length}):</p>
                    {(waExtractProgress.failures || waExtractProgress.failedGroups.map((f) => ({ label: f.groupName, error: f.error }))).map((f, idx) => (
                      <p key={idx} className="truncate">
                        • {f.label}: {f.error}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                if (isExtractingWA) {
                  abortExtractionRef.current = true;
                  setWaExtractStep("Interrompendo extração...");
                } else {
                  setIsWAModalOpen(false);
                  resetWaSourceSelection();
                }
              }}
            >
              {isExtractingWA ? "Parar" : "Cancelar"}
            </Button>
            <Button
              onClick={handleExtractWA}
              disabled={isExtractingWA || (!waIncludeConversas && !waIncludeAgenda && !waIncludeGroups) || (waIncludeGroups && waSelectedGroupIds.length === 0 && !waIncludeConversas && !waIncludeAgenda)}
              className="bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {isExtractingWA ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
              {isExtractingWA ? "Extraindo..." : "Iniciar Extração"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal B) Importar Planilha (Excel .xlsx / .xls + CSV) */}
      <Dialog
        open={isImportModalOpen}
        onOpenChange={(open) => {
          setIsImportModalOpen(open);
          if (!open) {
            setImportFile(null);
            setImportColumns([]);
            setImportColumnMappings([]);
            setImportRawRows([]);
            setImportParsedRows([]);
            setImportAnalysis(null);
            setImportDuplicateStrategy("merge");
            if (fileInputRef.current) {
              fileInputRef.current.value = "";
            }
          }
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
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

            {importFile && importColumns.length > 0 && (
              <ColumnMappingStep
                columns={importColumns}
                sampleRows={importRawRows}
                mappings={importColumnMappings}
                onMappingChange={handleMappingChange}
                knownCustomFields={knownCustomFields}
                isImporting={isUploadingImport}
                hideActions={true}
                totalRowsCount={importRawRows.length}
                fileName={importFile.name}
              />
            )}

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

                <div className="flex items-start space-x-2.5 p-2.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-950/20 text-xs">
                  <Checkbox
                    id="import-as-closed-sales"
                    checked={importAsClosedSales}
                    onCheckedChange={(checked) => setImportAsClosedSales(Boolean(checked))}
                    className="mt-0.5 border-emerald-500 data-[state=checked]:bg-emerald-600 data-[state=checked]:border-emerald-600"
                  />
                  <div className="grid gap-0.5 leading-none">
                    <label
                      htmlFor="import-as-closed-sales"
                      className="text-xs font-semibold text-foreground cursor-pointer flex items-center gap-1.5"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                      Importar como Vendas Fechadas (Clientes Históricos / Já Compraram)
                    </label>
                    <p className="text-[11px] text-muted-foreground">
                      Define automaticamente estágio "Fechado" protegido contra automações, temperatura Quente e tag "Venda Fechada".
                    </p>
                  </div>
                </div>

                <div className="bg-muted/40 border border-border rounded-md p-3 text-xs space-y-2">
                  {importPhonePreview && importColumnMappings.length > 0 && (
                    <div data-testid="import-phone-preview" className="rounded border border-border bg-background/60 p-2 space-y-0.5">
                      <p className="font-semibold text-foreground">Prévia — {importPhonePreview.total.toLocaleString("pt-BR")} linhas:</p>
                      <p data-testid="import-preview-only-principal">
                        <strong>{importPhonePreview.onlyPrincipal.toLocaleString("pt-BR")}</strong> só com telefone principal
                      </p>
                      <p data-testid="import-preview-with-extras">
                        <strong>{importPhonePreview.withExtras.toLocaleString("pt-BR")}</strong> com telefone adicional (um lead só; o adicional fica guardado no lead)
                      </p>
                      <p data-testid="import-preview-skipped" className={importPhonePreview.skipped > 0 ? "text-amber-600 dark:text-amber-400" : ""}>
                        <strong>{importPhonePreview.skipped.toLocaleString("pt-BR")}</strong> serão puladas por não ter nenhum telefone válido
                      </p>
                    </div>
                  )}
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

                {importAnalysis && importAnalysis.duplicateCount > 0 && (
                  <DuplicateDecisionCard
                    analysis={importAnalysis}
                    strategy={importDuplicateStrategy}
                    onStrategyChange={setImportDuplicateStrategy}
                  />
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setIsImportModalOpen(false);
                setImportFile(null);
                setImportColumns([]);
                setImportColumnMappings([]);
                setImportRawRows([]);
                setImportParsedRows([]);
                setImportAnalysis(null);
                setImportDuplicateStrategy("merge");
                if (fileInputRef.current) {
                  fileInputRef.current.value = "";
                }
              }}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleImportSubmit}
              disabled={!importFile || isUploadingImport || isAnalyzingImport || !isImportMappingValid || importSanitizePreview.validCount === 0}
              className="bg-indigo-600 hover:bg-indigo-700 text-white"
            >
              {isUploadingImport || isAnalyzingImport ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : null}
              {isAnalyzingImport
                ? "Analisando duplicados..."
                : isUploadingImport && importProgress && importProgress.phase === "sending"
                  ? `Enviando ${importProgress.sentRows.toLocaleString("pt-BR")} de ${importProgress.totalRows.toLocaleString("pt-BR")}…`
                  : isUploadingImport && importProgress?.phase === "closing"
                    ? "Concluindo…"
                    : importAnalysis && importAnalysis.duplicateCount > 0
                      ? "Confirmar e Importar"
                      : "Processar e Importar"}
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
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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

                <div
                  onClick={() => setCampaignSourceType("second_number")}
                  data-testid="campaign-source-second-number"
                  className={`border rounded-lg p-3.5 cursor-pointer transition-all flex items-start gap-3 ${
                    campaignSourceType === "second_number"
                      ? "border-amber-500 bg-amber-500/10 dark:bg-amber-500/20"
                      : "border-border hover:border-amber-500/40"
                  }`}
                >
                  <Phone className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5" />
                  <div>
                    <h4 className="text-xs font-bold text-foreground">Tentar outro número</h4>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Quem não respondeu a uma campanha e tem um telefone adicional ainda não usado.
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
                              ? `Todos os Estágios (${(facets?.baseTotal ?? 0).toLocaleString("pt-BR")})`
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
                          onClick={() => setCampaignStageFilters(toggleStageFilter(campaignStageFilters, "all"))}
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
                          <span>Todos os Estágios ({(facets?.baseTotal ?? 0).toLocaleString("pt-BR")})</span>
                        </div>

                        <div className="h-px bg-border my-1" />

                        {[
                          { id: "buyer", label: "Compradores 🟢", count: facets?.stagesExact?.buyer ?? 0 },
                          { id: "open_budget", label: "Orçamentos Abertos 🟡", count: facets?.stagesExact?.open_budget ?? 0 },
                          { id: "inquiry", label: "Em Dúvida 🔵", count: facets?.stagesExact?.inquiry ?? 0 },
                          { id: "cold", label: "Leads Frios ⚪", count: facets?.stagesExact?.cold ?? 0 },
                          { id: "lost", label: "Perdidos 🔴", count: facets?.stagesExact?.lost ?? 0 },
                        ].map((stageItem) => {
                          const isChecked = !campaignStageFilters.includes("all") && campaignStageFilters.includes(stageItem.id);
                          return (
                            <div
                              key={stageItem.id}
                              onClick={() => {
                                setCampaignStageFilters(toggleStageFilter(campaignStageFilters, stageItem.id));
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
                    <TagSelect
                      value={campaignTagFilter}
                      onChange={setCampaignTagFilter}
                      tags={availableTagItems}
                      data-testid="campaign-tag-select"
                      className="w-full h-9 px-3 mt-1 rounded-md border border-input bg-background text-xs"
                    />
                  </div>

                  <div className="sm:col-span-2" data-testid="campaign-import-picker">
                    <label className="text-xs font-semibold text-foreground">Filtrar por Planilha importada</label>
                    <select
                      value={campaignImportId}
                      onChange={(e) => { setCampaignImportId(e.target.value); setCampaignImportScope("all"); }}
                      data-testid="campaign-import-select"
                      className="w-full h-9 px-3 mt-1 rounded-md border border-input bg-background text-xs"
                    >
                      <option value="">Qualquer origem (sem filtrar por planilha)</option>
                      {campaignImportSources.map((imp) => (
                        <option key={imp.id} value={imp.id}>
                          {imp.reconstructed
                            ? `${imp.source_name} — no mínimo ${Number(imp.total_rows).toLocaleString("pt-BR")} leads (total é piso, data aproximada)`
                            : `${imp.source_name} — ${new Date(imp.created_at).toLocaleDateString("pt-BR")} — ${Number(imp.total_rows).toLocaleString("pt-BR")} linhas${imp.status === "incomplete" ? " (incompleta)" : ""}${(imp.same_name_count ?? 1) > 1 ? ` — importada ${imp.same_name_count} vezes` : ""}`}
                        </option>
                      ))}
                    </select>
                    {campaignImportId && (campaignImportSources.find((i) => i.id === campaignImportId)?.same_name_count ?? 1) > 1 && (
                      <p
                        role="alert"
                        data-testid="campaign-import-duplicate-warning"
                        className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200"
                      >
                        ⚠ Esta planilha foi importada mais de uma vez ({campaignImportSources.find((i) => i.id === campaignImportId)?.same_name_count} importações com o mesmo nome).
                        Disparar em todas pode mandar mais de uma mensagem para a mesma empresa.
                      </p>
                    )}
                    {campaignImportId && (
                      <div className="mt-2 rounded-md border border-border bg-muted/30 p-2.5 text-xs space-y-1.5">
                        {campaignImportOriginError ? (
                          <p data-testid="campaign-import-error" className="text-rose-600">{campaignImportOriginError}</p>
                        ) : !campaignImportOrigin ? (
                          <p className="text-muted-foreground">Contando os leads da planilha…</p>
                        ) : (
                          <>
                            {campaignImportOrigin.reconstructed ? (
                              <p data-testid="campaign-import-numbers" className="text-foreground">
                                <strong>No mínimo {campaignImportOrigin.total.toLocaleString("pt-BR")}</strong> leads encontrados nesta importação (reconstruída: o total é piso e a data é
                                aproximada). <span data-testid="campaign-import-reason" className="text-muted-foreground">{campaignImportOrigin.reason}</span>
                              </p>
                            ) : (
                              <p data-testid="campaign-import-numbers" className="text-foreground">
                                <strong>{(campaignImportOrigin.born ?? 0).toLocaleString("pt-BR")}</strong> leads nasceram nesta importação ·{" "}
                                <strong>{(campaignImportOrigin.existed ?? 0).toLocaleString("pt-BR")}</strong> já existiam e foram atualizados por ela
                              </p>
                            )}
                            {([
                              ["all", `Todos (${campaignImportOrigin.total.toLocaleString("pt-BR")})`],
                              ...(campaignImportOrigin.reconstructed
                                ? []
                                : [
                                    ["born", `Só os que nasceram (${(campaignImportOrigin.born ?? 0).toLocaleString("pt-BR")})`],
                                    ["existed", `Só os que já existiam (${(campaignImportOrigin.existed ?? 0).toLocaleString("pt-BR")})`],
                                  ]),
                            ] as Array<[ImportScope, string]>).map(([value, label]) => (
                              <label key={value} className="flex items-center gap-2 cursor-pointer">
                                <input type="radio" name="campaign-import-scope" checked={campaignImportScope === value} onChange={() => setCampaignImportScope(value)} data-testid={`campaign-import-scope-${value}`} />
                                <span>{label}</span>
                              </label>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Seleção Manual com Tabela */}
                <div className="border border-border rounded-lg overflow-hidden">
                  <div className="bg-muted/50 px-3 py-2 border-b border-border flex items-center justify-between text-xs font-semibold">
                    <span>Lista de Leads Selecionados ({effectiveSelectedCount} de {campaignFunnelFilteredLeads.length})</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-[11px] px-2"
                      onClick={() => {
                        if (effectiveSelectedCount === campaignFunnelFilteredLeads.length) {
                          setCampaignSelectedLeadIds([]);
                        } else {
                          setCampaignSelectedLeadIds(campaignFunnelFilteredLeads.map((l) => l.id));
                        }
                      }}
                    >
                      {effectiveSelectedCount === campaignFunnelFilteredLeads.length && campaignFunnelFilteredLeads.length > 0 ? "Desmarcar Todos" : "Selecionar Todos"}
                    </Button>
                  </div>

                  {campaignAudienceError && (
                    <div role="alert" data-testid="campaign-audience-error" className="px-3 py-2 text-xs text-rose-600 border-b border-border bg-rose-500/5">
                      {campaignAudienceError}
                    </div>
                  )}
                  {campaignAudience?.truncated && (
                    <div className="px-3 py-2 text-xs text-amber-700 border-b border-border bg-amber-500/5">
                      O público passou do limite de {campaignFunnelFilteredLeads.length.toLocaleString("pt-BR")} leads: restrinja o filtro.
                    </div>
                  )}
                  <div className="max-h-48 overflow-y-auto">
                    <Table>
                      <TableBody>
                        {campaignFunnelFilteredLeads.slice(0, 200).map((l) => {
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
                    {campaignFunnelFilteredLeads.length > 200 && (
                      <p className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border">
                        Mostrando 200 de {campaignFunnelFilteredLeads.length.toLocaleString("pt-BR")}. "Selecionar Todos" vale para os{" "}
                        {campaignFunnelFilteredLeads.length.toLocaleString("pt-BR")} leads do filtro.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ) : campaignSourceType === "spreadsheet" ? (
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
            ) : (
              /* Opção C: segunda tentativa por OUTRO número da mesma empresa */
              <SecondNumberPanel request={leadRequest} clientId={clientId} onChange={setSecondNumberSelection} />
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsCampaignWizardOpen(false)}>
              Cancelar
            </Button>
            <Button
              data-testid="btn-proceed-to-campaign"
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
        selectionMode={selectionMode}
        criteria={selectionMode === "criterion" ? listFilters : undefined}
        excludedLeadIds={selectionMode === "criterion" ? excludedLeadIds : undefined}
        effectiveTotalCount={bancoEffectiveSelectedCount}
        leads={selectedLeadIds.map((id) => {
          const c = selectedContacts[id];
          return { id, nome: c?.nome ?? null, phone: c?.phone, telefone: c?.telefone };
        })}
        onSuccess={() => {
          handleClearSelection();
          fetchLeads();
          loadFacets();
        }}
      />

      {/* Modal Lembrete Avulso para Lead */}
      <SingleFollowupReminderModal
        open={isSingleReminderModalOpen}
        onOpenChange={setIsSingleReminderModalOpen}
        lead={
          selectedLeadIds.length > 0
            ? leads.find((l) => l.id === selectedLeadIds[0]) || (selectedContacts[selectedLeadIds[0]] as any) || null
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

                {/* Seção Campos do Lead */}
                {Boolean(
                  (selectedLead.dados as any)?.campos &&
                  typeof (selectedLead.dados as any).campos === "object" &&
                  Object.keys((selectedLead.dados as any).campos).length > 0
                ) && (
                  <div className="space-y-2 pt-3 border-t border-border">
                    <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      <FileSpreadsheet className="w-3.5 h-3.5 text-indigo-500" /> Campos do Lead
                    </label>
                    <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-1.5 text-xs">
                      {Object.entries((selectedLead.dados as any).campos).map(([key, val]) => (
                        <div key={key} className="flex justify-between items-center gap-2">
                          <span className="text-muted-foreground font-medium truncate max-w-[130px]">{key}:</span>
                          <span className="font-semibold text-foreground truncate max-w-[200px]" title={String(val ?? "")}>
                            {val !== null && val !== undefined && String(val).trim() !== "" ? String(val) : "—"}
                          </span>
                        </div>
                      ))}
                    </div>
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
              Aplicar a {bancoEffectiveSelectedCount.toLocaleString("pt-BR")} leads
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
                ? `Confirmar fechamento de negócio para os ${bancoEffectiveSelectedCount.toLocaleString("pt-BR")} leads selecionados. Este status é manual e protegido contra inteligência automática.`
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
                ? `Indique o motivo pelo qual estes ${bancoEffectiveSelectedCount.toLocaleString("pt-BR")} leads não avançaram:`
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

      {/* Modal Bulk Tag (Adicionar ou Remover) */}
      <Dialog
        open={isBulkTagModalOpen}
        onOpenChange={(open) => {
          setIsBulkTagModalOpen(open);
          if (!open) {
            setBulkTagValue("");
            setBulkTagMode("add");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-1.5">
              <TagIcon className="w-4 h-4 text-indigo-500" />
              Gerenciar Tags em Lote ({bancoEffectiveSelectedCount.toLocaleString("pt-BR")} leads)
            </DialogTitle>
          </DialogHeader>

          <Tabs
            value={bulkTagMode}
            onValueChange={(val) => {
              setBulkTagMode(val as "add" | "remove");
              setBulkTagValue("");
            }}
            className="w-full"
          >
            <TabsList className="grid w-full grid-cols-2 mb-3">
              <TabsTrigger
                value="add"
                data-testid="tab-add-tag"
                className="text-xs"
                onClick={() => {
                  setBulkTagMode("add");
                  setBulkTagValue("");
                }}
              >
                Adicionar Tag
              </TabsTrigger>
              <TabsTrigger
                value="remove"
                data-testid="tab-remove-tag"
                className="text-xs text-rose-600 dark:text-rose-400 data-[state=active]:text-rose-600"
                onClick={() => {
                  setBulkTagMode("remove");
                  setBulkTagValue("");
                }}
              >
                Remover Tag
              </TabsTrigger>
            </TabsList>

            <TabsContent value="add" className="space-y-3 mt-0">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Adicione uma tag aos <strong>{bancoEffectiveSelectedCount.toLocaleString("pt-BR")}</strong> leads selecionados.
              </p>
              <div className="space-y-1.5">
                <Input
                  placeholder="Digite a nova tag (ex: #qualificado)..."
                  value={bulkTagValue}
                  onChange={(e) => setBulkTagValue(e.target.value)}
                  className="text-xs"
                  data-testid="input-bulk-tag"
                />
              </div>
              {knownTags.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[11px] font-medium text-muted-foreground block">
                    Ou selecione uma tag existente:
                  </span>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1 bg-muted/30 rounded border">
                    {knownTags.slice(0, 20).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setBulkTagValue(t)}
                        className={cn(
                          "px-2 py-0.5 rounded text-[11px] font-medium border transition-colors",
                          bulkTagValue === t
                            ? "bg-indigo-600 text-white border-indigo-600"
                            : "bg-background hover:bg-muted text-foreground border-border"
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>

            <TabsContent value="remove" className="space-y-3 mt-0">
              <Alert className="py-2.5 border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-300">
                <AlertCircle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                <AlertDescription className="text-xs leading-relaxed">
                  Remova uma tag de todos os <strong>{bancoEffectiveSelectedCount.toLocaleString("pt-BR")}</strong> leads selecionados.
                  O lead <strong>não</strong> será excluído, apenas a tag indicada será desvinculada.
                </AlertDescription>
              </Alert>
              <div className="space-y-1.5">
                <Input
                  placeholder="Nome exato da tag a remover..."
                  value={bulkTagValue}
                  onChange={(e) => setBulkTagValue(e.target.value)}
                  className="text-xs border-rose-500/40 focus-visible:ring-rose-500"
                  data-testid="input-bulk-tag-remove"
                />
              </div>
              {knownTags.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <span className="text-[11px] font-medium text-muted-foreground block">
                    Tags existentes na base (clique para preencher):
                  </span>
                  <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1 bg-muted/30 rounded border">
                    {knownTags.slice(0, 30).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setBulkTagValue(t)}
                        className={cn(
                          "px-2 py-0.5 rounded text-[11px] font-medium border transition-colors",
                          bulkTagValue === t
                            ? "bg-rose-600 text-white border-rose-600"
                            : "bg-background hover:bg-rose-50 dark:hover:bg-rose-950/30 text-foreground border-border"
                        )}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="pt-2">
            <Button variant="outline" size="sm" onClick={() => setIsBulkTagModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleBulkTagSubmit}
              disabled={!bulkTagValue.trim()}
              data-testid="btn-submit-bulk-tag"
              className={
                bulkTagMode === "remove"
                  ? "bg-rose-600 hover:bg-rose-700 text-white"
                  : "bg-indigo-600 hover:bg-indigo-700 text-white"
              }
            >
              {bulkTagMode === "remove"
                ? `Remover Tag de ${bancoEffectiveSelectedCount.toLocaleString("pt-BR")} leads`
                : `Adicionar Tag`}
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
              Selecione o operador responsável para os {bancoEffectiveSelectedCount.toLocaleString("pt-BR")} leads selecionados:
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
              Reatribuir {bancoEffectiveSelectedCount.toLocaleString("pt-BR")} leads
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal Exclusão Segura em Lote */}
      <Dialog open={isBulkDeleteModalOpen} onOpenChange={setIsBulkDeleteModalOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
              <Trash2 className="w-4 h-4" />
              Excluir {bancoEffectiveSelectedCount.toLocaleString("pt-BR")} leads
            </DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <Alert variant="destructive" className="py-2.5">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle className="text-xs font-bold">Ação Permanente e Irreversível</AlertTitle>
              <AlertDescription className="text-xs mt-1 leading-relaxed">
                Esta ação é permanente e irreversível. Todos os dados cadastrais dos leads selecionados serão apagados.
              </AlertDescription>
            </Alert>

            {bancoEffectiveSelectedCount > 500 && (
              <div className="space-y-1.5 pt-1">
                <label className="text-xs font-medium text-foreground block">
                  Para confirmar a exclusão de mais de 500 leads, digite <strong>EXCLUIR</strong>:
                </label>
                <Input
                  placeholder="Digite EXCLUIR"
                  value={deleteConfirmationInput}
                  onChange={(e) => setDeleteConfirmationInput(e.target.value)}
                  className="text-xs h-9"
                  data-testid="input-delete-confirmation"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsBulkDeleteModalOpen(false);
                setDeleteConfirmationInput("");
              }}
              disabled={isDeletingBulk}
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              data-testid="btn-confirm-bulk-delete"
              onClick={handleBulkDeleteSubmit}
              disabled={isDeletingBulk || (bancoEffectiveSelectedCount > 500 && deleteConfirmationInput !== "EXCLUIR")}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {isDeletingBulk ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5 mr-1.5" />}
              Excluir permanentemente
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

      {/* Modal de Importação do Instagram */}
      <InstagramImportModal
        open={isInstagramImportModalOpen}
        onOpenChange={setIsInstagramImportModalOpen}
        clientId={clientId}
        onSuccess={() => {
          fetchLeads();
        }}
      />

      {/* Modal Gerenciar Planilhas Salvas (Bloco 2) */}
      <Dialog open={isSavedSheetsOpen} onOpenChange={setIsSavedSheetsOpen}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Database className="w-5 h-5 text-indigo-500" />
              Planilhas Salvas & Bases de Importação
            </DialogTitle>
            <DialogDescription>
              Gerencie as planilhas importadas deste cliente, exclua registros ou apague leads vinculados por tag.
            </DialogDescription>
          </DialogHeader>

          <ImportProgressBanner progress={importProgress} />

          <SavedSheetsCards
            imports={pastImports}
            onResumeImport={handleResumeImport}
            resumingImportId={resumingImportId}
            isDeleting={deleteLeadImport.isPending}
            onViewImport={(imp) => setViewingImport(imp)}
            onDeleteImport={(id, name) => handleDeleteImport(id, name)}
            onDeleteLeads={canMassDelete ? () => setIsMassDeleteOpen(true) : undefined}
          />
        </DialogContent>
      </Dialog>

      <ImportViewerDialog
        open={Boolean(viewingImport)}
        onOpenChange={(open) => !open && setViewingImport(null)}
        clientId={clientId}
        importRecord={viewingImport}
      />

      {canMassDelete && (
        <MassDeleteDialog open={isMassDeleteOpen} onOpenChange={setIsMassDeleteOpen} clientId={clientId} />
      )}
    </PageShell>
  );
}
