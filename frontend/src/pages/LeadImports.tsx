import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  Archive,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Columns3,
  Clock3,
  FileSpreadsheet,
  Filter,
  ImagePlus,
  LayoutGrid,
  List,
  History,
  Megaphone,
  Pause,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Zap,
  XCircle,
} from "lucide-react";
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
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import {
  useCreateLeadImport,
  useDeleteLeadImport,
  useLeadImports,
  useLeadImportItems,
  type LeadImportPreviewItem,
} from "@/hooks/useLeadImports";
import {
  useCampanhas,
  useCreateCampaign,
  useDeleteCampaign,
  useTriggerCampaign,
  useUpdateCampaign,
  type Campaign,
} from "@/hooks/useCampanhas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { PageShell } from "@/components/PageShell";
import { SectionHeader } from "@/components/SectionHeader";
import { cn } from "@/lib/utils";

type SheetTab = "dados" | "campanha" | "pendentes" | "enviadas" | "agendamentos";
type LeadsViewMode = "lista" | "cards" | "funil" | "kanban";

interface CampaignSegmentationState {
  gender: string;
  productType: string;
  ticket: string;
  ticketThreshold: string;
  interest: string;
  campaignTag: string;
}

interface LeadImportsProps {
  fixedClientId?: string;
  fixedClientName?: string;
  title?: string;
  subtitle?: string;
  headerRight?: ReactNode;
}

type CampaignActionDialogState =
  | {
      action: "delete" | "archive";
      campaign: Campaign;
    }
  | null;

const INTERNAL_TABS: Array<{ id: SheetTab; label: string }> = [
  { id: "dados", label: "Dados Gerais" },
  { id: "pendentes", label: "Leads Pendentes" },
  { id: "campanha", label: "Nova Campanha" },
  { id: "enviadas", label: "Campanhas Enviadas" },
  { id: "agendamentos", label: "Agendamentos" },
];

const CLIENT_TABS: Array<{ id: SheetTab; label: string }> = [
  { id: "dados", label: "Dados Gerais" },
  { id: "pendentes", label: "Leads Pendentes" },
];

const CAMPAIGNS = [
  ["Black Friday Preview", "10/03/2026 · 09:15 · 1.240 contatos", "CLIENTES VIP", "E-MAIL", "87%", "42%", "18%"],
  ["Newsletter Fev/2026", "01/02/2026 · 08:00 · 2.418 contatos", "TODOS", "E-MAIL", "94%", "38%", "14%"],
  ["Reativacao Inativos", "15/01/2026 · 10:30 · 340 contatos", "INATIVOS", "WHATSAPP", "99%", "61%", "22%"],
  ["Boas-vindas Leads", "05/01/2026 · 14:00 · 180 contatos", "LEADS NOVOS", "E-MAIL", "96%", "55%", "31%"],
  ["Promo Natal 2025", "20/12/2025 · 09:00 · 2.300 contatos", "TODOS", "SMS", "98%", "72%", "12%"],
] as const;

const SCHEDULED = [
  ["20", "MAR", "Black Friday 2026 - Aviso Previo", "E-mail Marketing", "1.240 contatos", "09:00 BRT", "AGENDADA"],
  ["25", "MAR", "Newsletter Marco 2026", "E-mail Marketing", "2.418 contatos", "08:00 BRT", "CONFIRMADA"],
  ["01", "ABR", "Reativacao Q2 - Leads Frios", "WhatsApp", "420 contatos", "10:30 BRT", "RECORRENTE"],
] as const;

const IMPORTS_PAGE_SIZE = 10;
const ALL_IMPORTS_VALUE = "__all__";
const ALL_SEGMENT_VALUE = "__all__";
const DEFAULT_N8N_CAMPAIGN_WEBHOOK_URL =
  "https://geracaodigital.app.n8n.cloud/webhook/c1a774a2-2172-4b4f-b557-a75d9561b720";
const darkFieldClass =
  "border-slate-200/90 bg-white text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-all placeholder:text-slate-400 focus-visible:border-primary/35 focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:ring-offset-0 dark:border-white/12 dark:bg-black/45 dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_30px_rgba(0,0,0,0.18)] dark:placeholder:text-white/30 dark:focus-visible:bg-black/60 dark:focus-visible:ring-1 dark:focus-visible:ring-primary/20";
const darkSelectContentClass =
  "border-slate-200/90 bg-white text-slate-900 shadow-[0_24px_50px_rgba(15,23,42,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-[#090b17]/98 dark:text-white dark:shadow-[0_24px_50px_rgba(0,0,0,0.45)]";
const darkSelectItemClass =
  "rounded-md text-slate-700 focus:bg-slate-100 focus:text-slate-950 data-[state=checked]:bg-primary/10 data-[state=checked]:text-primary dark:text-white/78 dark:focus:bg-white/[0.06] dark:focus:text-white dark:data-[state=checked]:bg-primary/12 dark:data-[state=checked]:text-white";

const defaultSegmentation: CampaignSegmentationState = {
  gender: ALL_SEGMENT_VALUE,
  productType: ALL_SEGMENT_VALUE,
  ticket: ALL_SEGMENT_VALUE,
  ticketThreshold: "",
  interest: "",
  campaignTag: "",
};

const leadViewOptions: Array<{ id: LeadsViewMode; label: string; icon: typeof List }> = [
  { id: "lista", label: "Lista", icon: List },
  { id: "cards", label: "Cards", icon: LayoutGrid },
  { id: "funil", label: "Funil", icon: Filter },
  { id: "kanban", label: "Kanban", icon: Columns3 },
];

function parseSpreadsheetFile(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const result = event.target?.result;
        if (!result) return reject(new Error("Nao foi possivel ler o arquivo."));
        const workbook = XLSX.read(result, { type: "array", cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) return reject(new Error("A planilha nao possui abas com dados."));
        const worksheet = workbook.Sheets[firstSheetName];
        resolve(XLSX.utils.sheet_to_json<Record<string, unknown>>(worksheet, { defval: "", raw: false }));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Falha ao processar a planilha."));
      }
    };
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo selecionado."));
    reader.readAsArrayBuffer(file);
  });
}

function getValidDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value: unknown, fallback = "Sem data") {
  const date = getValidDate(value);
  return date ? date.toLocaleString("pt-BR") : fallback;
}

function getScheduleDateParts(campaign: Campaign) {
  const date = getValidDate(campaign.scheduled_for) || getValidDate(campaign.created_at);
  if (!date) {
    return {
      day: "--",
      month: "sem data",
      label: "sem data definida",
    };
  }

  return {
    day: date.toLocaleDateString("pt-BR", { day: "2-digit" }),
    month: date.toLocaleDateString("pt-BR", { month: "short" }),
    label: campaign.scheduled_for ? formatDate(campaign.scheduled_for) : "sem data definida",
  };
}

function formatDateInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function buildPaginationItems(currentPage: number, totalPages: number): Array<number | string> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }

  const items: Array<number | string> = [1];
  const start = Math.max(2, currentPage - 1);
  const end = Math.min(totalPages - 1, currentPage + 1);

  if (start > 2) items.push("start-ellipsis");
  for (let page = start; page <= end; page += 1) items.push(page);
  if (end < totalPages - 1) items.push("end-ellipsis");

  items.push(totalPages);
  return items;
}

function normalizeLooseText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function getLeadField(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }

  const entries = Object.entries(data);
  for (const [key, value] of entries) {
    const normalizedKey = normalizeLooseText(key).replace(/[^a-z0-9]/g, "");
    if (keys.some((candidate) => normalizeLooseText(candidate).replace(/[^a-z0-9]/g, "") === normalizedKey)) {
      return String(value ?? "");
    }
  }

  return "";
}

function parseMoneyValue(value: string) {
  const cleaned = value
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(?:\D|$))/g, "")
    .replace(",", ".");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function leadMatchesSegmentation(data: Record<string, unknown>, filters: CampaignSegmentationState) {
  if (filters.gender !== ALL_SEGMENT_VALUE) {
    const gender = normalizeLooseText(getLeadField(data, ["genero", "gênero", "sexo"]));
    if (!gender.includes(filters.gender)) return false;
  }

  if (filters.productType !== ALL_SEGMENT_VALUE) {
    const product = normalizeLooseText(
      getLeadField(data, ["tipo_produto", "tipo de produto", "produto", "tipo_cliente", "perfil"])
    );
    if (!product.includes(filters.productType)) return false;
  }

  if (filters.ticket !== ALL_SEGMENT_VALUE) {
    const rawValue = getLeadField(data, ["valor", "ticket", "valor_contrato", "contrato", "renda", "faixa_consumo", "consumo"]);
    const parsedValue = parseMoneyValue(rawValue);
    const threshold = Number(filters.ticketThreshold || 0);
    const textValue = normalizeLooseText(rawValue);

    if (parsedValue !== null && threshold > 0) {
      if (filters.ticket === "alto" && parsedValue < threshold) return false;
      if (filters.ticket === "baixo" && parsedValue >= threshold) return false;
    } else if (!textValue.includes(filters.ticket)) {
      return false;
    }
  }

  if (filters.interest.trim()) {
    const interestSource = normalizeLooseText(
      [
        getLeadField(data, ["interesse", "categoria", "segmento", "produto", "tipo_cliente"]),
        getLeadField(data, ["observacao", "observações", "descricao", "descrição"]),
      ].join(" ")
    );
    if (!interestSource.includes(normalizeLooseText(filters.interest))) return false;
  }

  if (filters.campaignTag.trim()) {
    const campaignSource = normalizeLooseText(
      getLeadField(data, ["campanha", "origem", "source", "utm_campaign"])
    );
    if (!campaignSource.includes(normalizeLooseText(filters.campaignTag))) return false;
  }

  return true;
}

function toCampaignSegmentationPayload(filters: CampaignSegmentationState) {
  return {
    gender: filters.gender === ALL_SEGMENT_VALUE ? "" : filters.gender,
    productType: filters.productType === ALL_SEGMENT_VALUE ? "" : filters.productType,
    ticket: filters.ticket === ALL_SEGMENT_VALUE ? "" : filters.ticket,
    ticketThreshold: filters.ticketThreshold.trim() ? Number(filters.ticketThreshold) : null,
    interest: filters.interest.trim(),
    campaignTag: filters.campaignTag.trim(),
  };
}

function getLeadNormalizedData(item: { normalized_data?: Record<string, unknown> | null }) {
  return item.normalized_data && typeof item.normalized_data === "object" ? item.normalized_data : {};
}

function readImageAsCampaignAsset(file: File): Promise<{ name: string; type: string; size: number; dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Nao foi possivel carregar a imagem."));
        return;
      }
      resolve({
        name: file.name,
        type: file.type,
        size: file.size,
        dataUrl: result,
      });
    };
    reader.onerror = () => reject(new Error("Falha ao ler a imagem."));
    reader.readAsDataURL(file);
  });
}

function PaginationControls({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
}: {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (page: number) => void;
}) {
  if (totalItems === 0) return null;

  const startItem = (currentPage - 1) * pageSize + 1;
  const endItem = Math.min(currentPage * pageSize, totalItems);

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-xs text-muted-foreground">
        Mostrando {startItem}-{endItem} de {totalItems} registros
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => onPageChange(currentPage - 1)} disabled={currentPage === 1}>
          <ChevronLeft className="h-4 w-4" />
          Anterior
        </Button>

        {buildPaginationItems(currentPage, totalPages).map((item, index) =>
          typeof item === "string" ? (
            <span key={`${item}-${index}`} className="flex h-9 min-w-9 items-center justify-center px-2 text-sm text-muted-foreground">
              ...
            </span>
          ) : (
            <Button key={item} type="button" variant={item === currentPage ? "secondary" : "outline"} size="sm" className="min-w-9 px-3" onClick={() => onPageChange(item)}>
              {item}
            </Button>
          ),
        )}

        <Button type="button" variant="outline" size="sm" onClick={() => onPageChange(currentPage + 1)} disabled={currentPage === totalPages}>
          Proxima
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function Metric({
  value,
  label,
  barClassName,
  textClassName,
}: {
  value: string;
  label: string;
  barClassName: string;
  textClassName: string;
}) {
  return (
    <div>
      <p className={cn("font-mono text-[12px] font-bold", textClassName)}>{value}</p>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <div className="mt-2 h-1 rounded-full bg-secondary/90">
        <div className={cn("h-1 rounded-full", barClassName)} style={{ width: value }} />
      </div>
    </div>
  );
}

export default function LeadImports({
  fixedClientId,
  fixedClientName,
  title = "Campanhas",
  subtitle = "Importe bases, crie campanhas e acompanhe o que ja foi disparado no CRM.",
  headerRight,
}: LeadImportsProps) {
  const { isInternalUser } = useAuth();
  const crmClient = useOptionalCrmClient();
  const selectedClientId = fixedClientId || crmClient?.selectedClientId || "";
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<Record<string, unknown>[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [importPreview, setImportPreview] = useState<LeadImportPreviewItem[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SheetTab>("dados");
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [pendingFilter, setPendingFilter] = useState<string>("false");
  const [dispatchStatus, setDispatchStatus] = useState<string | null>(null);
  const [isDispatching, setIsDispatching] = useState(false);
  const [campaignName, setCampaignName] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [dispatchLimit, setDispatchLimit] = useState("");
  const [campaignMessage, setCampaignMessage] = useState("");
  const [campaignImage, setCampaignImage] = useState<{ name: string; type: string; size: number; dataUrl: string } | null>(null);
  const [campaignImageError, setCampaignImageError] = useState<string | null>(null);
  const [segmentation, setSegmentation] = useState<CampaignSegmentationState>(defaultSegmentation);
  const [leadViewMode, setLeadViewMode] = useState<LeadsViewMode>("lista");
  const [campaignSearch, setCampaignSearch] = useState("");
  const [selectedImportId, setSelectedImportId] = useState(ALL_IMPORTS_VALUE);
  const [importsPage, setImportsPage] = useState(1);
  const [campaignActionDialog, setCampaignActionDialog] = useState<CampaignActionDialogState>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const campaignImageInputRef = useRef<HTMLInputElement | null>(null);

  const { data: imports = [], isLoading: importsLoading, error: importsError, refetch } = useLeadImports(selectedClientId);
  const createLeadImport = useCreateLeadImport();
  const deleteLeadImport = useDeleteLeadImport();
  const { data: campaigns = [], isLoading: campaignsLoading, error: campaignsError, refetch: refetchCampaigns } = useCampanhas(selectedClientId || undefined);
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();
  const triggerCampaign = useTriggerCampaign();
  const { data: pendingData, isLoading: pendingLoading, error: pendingError, refetch: refetchPending } = useLeadImportItems(
    selectedClientId,
    selectedImportId === ALL_IMPORTS_VALUE ? undefined : selectedImportId,
    pendingFilter,
  );

  useEffect(() => {
    if (!isInternalUser && !["dados", "pendentes"].includes(activeTab)) {
      setActiveTab("dados");
    }
  }, [activeTab, isInternalUser]);

  useEffect(() => {
    setImportsPage(1);
  }, [selectedClientId, pendingFilter, selectedImportId]);

  const selectedClient = crmClient?.selectedClient || null;
  const resolvedClientName = fixedClientName || selectedClient?.name || selectedClientId;
  const tabs = isInternalUser ? INTERNAL_TABS : CLIENT_TABS;

  const totalImportsPages = Math.max(1, Math.ceil(imports.length / IMPORTS_PAGE_SIZE));
  const safeImportsPage = Math.min(importsPage, totalImportsPages);
  const paginatedImports = useMemo(
    () => imports.slice((safeImportsPage - 1) * IMPORTS_PAGE_SIZE, safeImportsPage * IMPORTS_PAGE_SIZE),
    [imports, safeImportsPage],
  );
  const pendingItems = useMemo(() => pendingData?.items ?? [], [pendingData?.items]);
  const segmentedPendingItems = useMemo(
    () =>
      pendingItems.filter((item) => {
        const normalizedData = getLeadNormalizedData(item);
        return leadMatchesSegmentation(normalizedData, segmentation);
      }),
    [pendingItems, segmentation],
  );
  const segmentMatchedCount = segmentedPendingItems.length;
  const segmentRejectedCount = Math.max(0, pendingItems.length - segmentMatchedCount);
  const funnelGroups = useMemo(() => {
    const groups = [
      {
        id: "entrada",
        title: "Entrada",
        items: segmentedPendingItems,
      },
      {
        id: "segmentados",
        title: "Segmentados",
        items: segmentedPendingItems.filter((item) => {
          const data = getLeadNormalizedData(item);
          return Boolean(getLeadField(data, ["genero", "sexo"]) || getLeadField(data, ["interesse", "produto", "tipo_cliente"]));
        }),
      },
      {
        id: "prontos",
        title: "Prontos para disparo",
        items: segmentedPendingItems.filter((item) => !item.dispatched),
      },
    ];
    return groups;
  }, [segmentedPendingItems]);
  const filteredCampaigns = useMemo(() => {
    const term = campaignSearch.trim().toLowerCase();
    const scoped = selectedClientId
      ? campaigns.filter((campaign) => campaign.client_id === selectedClientId)
      : campaigns;
    const visible = scoped.filter((campaign) => !campaign.archived_at);

    return visible.filter((campaign) => {
      if (!term) return true;
      return [campaign.name, campaign.client_name, campaign.client_id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(term);
    });
  }, [campaignSearch, campaigns, selectedClientId]);
  const queuedCampaigns = useMemo(
    () =>
      [...filteredCampaigns.filter((campaign) => !campaign.last_triggered_at)].sort((a, b) => {
        const left = getValidDate(a.scheduled_for) || getValidDate(a.created_at) || new Date(0);
        const right = getValidDate(b.scheduled_for) || getValidDate(b.created_at) || new Date(0);
        return left.getTime() - right.getTime();
      }),
    [filteredCampaigns],
  );
  const sentCampaigns = useMemo(
    () =>
      [...filteredCampaigns.filter((campaign) => Boolean(campaign.last_triggered_at))].sort(
        (a, b) => {
          const left = getValidDate(b.last_triggered_at) || getValidDate(b.created_at) || new Date(0);
          const right = getValidDate(a.last_triggered_at) || getValidDate(a.created_at) || new Date(0);
          return left.getTime() - right.getTime();
        },
      ),
    [filteredCampaigns],
  );

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setImportPreview([]);
    setParseError(null);
    setParsedRows([]);
    setPreviewRows([]);

    if (!file) return;

    try {
      const rows = await parseSpreadsheetFile(file);
      setParsedRows(rows);
      setPreviewRows(rows.slice(0, 8));
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Falha ao processar a planilha.");
    }
  }

  async function handleCampaignImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setCampaignImageError(null);
    setCampaignImage(null);

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setCampaignImageError("Selecione uma imagem valida para a campanha.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setCampaignImageError("Use uma imagem de ate 2MB para manter o disparo leve.");
      return;
    }

    try {
      const asset = await readImageAsCampaignAsset(file);
      setCampaignImage(asset);
    } catch (error) {
      setCampaignImageError(error instanceof Error ? error.message : "Falha ao carregar imagem.");
    }
  }

  async function handleImport() {
    if (!selectedClientId) {
      setParseError("Selecione um cliente antes de importar.");
      return;
    }

    if (!selectedFile || parsedRows.length === 0) {
      setParseError("Selecione uma planilha valida para importar.");
      return;
    }

    setParseError(null);

    try {
      const response = await createLeadImport.mutateAsync({
        clientId: selectedClientId,
        sourceName: selectedFile.name,
        sourceType: selectedFile.name.split(".").pop()?.toLowerCase() || "spreadsheet",
        rows: parsedRows,
      });
      setImportPreview(response.preview);
      setSelectedImportId(response.item.id);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Falha ao importar planilha.");
    }
  }

  async function handleDelete(importId: string) {
    try {
      await deleteLeadImport.mutateAsync(importId);
      setDeleteConfirmId(null);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "Falha ao deletar planilha.");
    }
  }

  async function handleCreateCampaign() {
    if (!selectedClientId) {
      setDispatchStatus("Selecione uma empresa antes de criar a campanha.");
      return;
    }

    if (!campaignName.trim()) {
      setDispatchStatus("Defina um nome para a campanha.");
      return;
    }

    const parsedLimit = dispatchLimit.trim() ? Number(dispatchLimit) : undefined;
    if (parsedLimit !== undefined && (!Number.isFinite(parsedLimit) || parsedLimit <= 0 || !Number.isInteger(parsedLimit))) {
      setDispatchStatus("Informe uma quantidade valida por lote usando apenas numeros inteiros.");
      return;
    }

    setIsDispatching(true);
    setDispatchStatus(null);

    try {
      await createCampaign.mutateAsync({
        name: campaignName.trim(),
        clientId: selectedClientId,
        importId: selectedImportId === ALL_IMPORTS_VALUE ? null : selectedImportId || null,
        limitPerRun: parsedLimit ?? 50,
        scheduledFor: getValidDate(scheduledFor)?.toISOString() ?? null,
        webhookUrl: DEFAULT_N8N_CAMPAIGN_WEBHOOK_URL,
        webhookToken: null,
        analyticsMeta: {
          segmentation: toCampaignSegmentationPayload(segmentation),
          message: campaignMessage.trim(),
          image: campaignImage,
        },
      });

      setDispatchStatus(`Campanha ${campaignName.trim()} criada com sucesso.`);
      setCampaignName("");
      setScheduledFor("");
      setDispatchLimit("");
      setCampaignMessage("");
      setCampaignImage(null);
      setCampaignImageError(null);
      setSegmentation(defaultSegmentation);
      setSelectedImportId(ALL_IMPORTS_VALUE);
      setActiveTab("agendamentos");
      void refetchCampaigns();
    } catch (error) {
      setDispatchStatus(error instanceof Error ? error.message : "Falha ao criar campanha.");
    } finally {
      setIsDispatching(false);
    }
  }

  async function handleTriggerCampaign(campaign: Campaign) {
    try {
      const result = await triggerCampaign.mutateAsync(campaign.id);
      setDispatchStatus(`Campanha ${campaign.name} disparada com sucesso. ${result.n8nResponse ?? ""}`.trim());
      void refetchCampaigns();
      void refetchPending();
    } catch (error) {
      setDispatchStatus(error instanceof Error ? error.message : "Falha ao disparar campanha.");
    }
  }

  async function handleToggleCampaignStatus(campaign: Campaign) {
    try {
      await updateCampaign.mutateAsync({
        id: campaign.id,
        status: campaign.status === "active" ? "paused" : "active",
      });
      setDispatchStatus(
        campaign.status === "active"
          ? `Campanha ${campaign.name} pausada.`
          : `Campanha ${campaign.name} reativada.`
      );
      void refetchCampaigns();
    } catch (error) {
      setDispatchStatus(error instanceof Error ? error.message : "Falha ao atualizar campanha.");
    }
  }

  async function handleDeleteCampaign(campaign: Campaign) {
    try {
      await deleteCampaign.mutateAsync(campaign.id);
      setCampaignActionDialog(null);
      setDispatchStatus(`Campanha ${campaign.name} apagada com sucesso.`);
      void refetchCampaigns();
    } catch (error) {
      setDispatchStatus(error instanceof Error ? error.message : "Falha ao apagar campanha.");
    }
  }

  async function handleArchiveCampaign(campaign: Campaign) {
    try {
      await updateCampaign.mutateAsync({
        id: campaign.id,
        archived: true,
      });
      setCampaignActionDialog(null);
      setDispatchStatus(`Campanha ${campaign.name} arquivada com sucesso.`);
      void refetchCampaigns();
    } catch (error) {
      setDispatchStatus(error instanceof Error ? error.message : "Falha ao arquivar campanha.");
    }
  }

  const handleDispatch = handleCreateCampaign;

  return (
    <PageShell title={title} subtitle={subtitle} headerRight={headerRight} spacing="space-y-6" showGlobalClientSelector={!fixedClientId}>
      <AlertDialog open={Boolean(campaignActionDialog)} onOpenChange={(open) => (!open ? setCampaignActionDialog(null) : null)}>
        <AlertDialogContent className="max-w-md rounded-3xl border-border/80 bg-background/95">
          <AlertDialogHeader className="space-y-3 text-left">
            <AlertDialogTitle>
              {campaignActionDialog?.action === "archive" ? "Arquivar campanha" : "Apagar campanha"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-6 text-muted-foreground">
              {campaignActionDialog?.action === "archive"
                ? `A campanha ${campaignActionDialog?.campaign.name} sera removida da listagem ativa e ficara fora das tabs de operacao.`
                : campaignActionDialog?.campaign.last_triggered_at
                  ? `A campanha ${campaignActionDialog?.campaign.name} ja foi enviada e sera apagada em definitivo. Essa acao nao pode ser desfeita.`
                  : `A campanha agendada ${campaignActionDialog?.campaign.name} sera removida da fila em definitivo. Essa acao nao pode ser desfeita.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className={campaignActionDialog?.action === "archive" ? "" : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}
              onClick={() =>
                campaignActionDialog?.action === "archive"
                  ? void handleArchiveCampaign(campaignActionDialog.campaign)
                  : void handleDeleteCampaign(campaignActionDialog!.campaign)
              }
            >
              {campaignActionDialog?.action === "archive" ? "Arquivar" : "Apagar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <section className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 border-b border-border/70">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative -mb-px px-4 py-3 text-sm font-semibold transition-colors",
                activeTab === tab.id ? "text-primary" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {tab.id === "pendentes" && pendingData && (
                <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                  {pendingData.pendingCount}
                </span>
              )}
              {activeTab === tab.id && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary shadow-[0_0_10px_rgba(0,212,255,0.9)]" />
              )}
            </button>
          ))}
        </div>

        {activeTab === "dados" && (
          <div className="space-y-6">
            <section>
              <SectionHeader
                title="Nova importacao"
                subtitle="Aceita CSV, XLS e XLSX. O backend normaliza os campos e popula a tabela leads."
                icon={Upload}
              />
              <Card className="rounded-2xl border-border/80 bg-card/95 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <FileSpreadsheet className="h-4 w-4" />
                    {resolvedClientName || "Selecione um cliente"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <ErrorMessage message={parseError} variant="banner" />
                  <div className="space-y-3">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xls,.xlsx"
                      onChange={handleFileChange}
                      className="sr-only"
                    />
                    <div className="rounded-2xl border border-slate-200/90 bg-slate-50/90 p-3 shadow-[0_10px_24px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-black/35 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">Anexar planilha</p>
                          <p className="mt-1 text-sm text-slate-500 dark:text-white/55">Clique no botao abaixo para enviar um arquivo CSV, XLS ou XLSX.</p>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                          className="h-11 rounded-xl border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50 hover:text-slate-900 dark:border-white/12 dark:bg-white/[0.03] dark:text-white dark:hover:bg-white/[0.06] dark:hover:text-white"
                        >
                          <Upload className="h-4 w-4" />
                          {selectedFile ? "Trocar arquivo" : "Clique para anexar"}
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                      <div className={cn("flex min-h-[48px] items-center rounded-xl px-4 text-sm", darkFieldClass)}>
                        <span className={selectedFile ? "text-slate-900 dark:text-white" : "text-slate-400 dark:text-white/40"}>
                          {selectedFile ? selectedFile.name : "Nenhum arquivo selecionado"}
                        </span>
                      </div>
                      <Button onClick={handleImport} disabled={!selectedFile || createLeadImport.isPending} className="h-12 rounded-xl">
                        <Upload className="mr-2 h-4 w-4" />
                        {createLeadImport.isPending ? "Importando..." : "Importar planilha"}
                      </Button>
                    </div>
                  </div>

                  {selectedFile && (
                    <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 p-4 text-sm text-slate-600 shadow-[0_10px_24px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.03] dark:text-white/78 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      <p>Arquivo: {selectedFile.name}</p>
                      <p>Linhas lidas: {parsedRows.length}</p>
                    </div>
                  )}

                  {previewRows.length > 0 && (
                    <div className="overflow-x-auto rounded-xl border border-border/70">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            {Object.keys(previewRows[0]).map((column) => (
                              <TableHead key={column}>{column}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {previewRows.map((row, index) => (
                            <TableRow key={`${index}-${Object.values(row).join("-")}`}>
                              {Object.keys(previewRows[0]).map((column) => (
                                <TableCell key={column} className="max-w-[220px] truncate">
                                  {String(row[column] ?? "")}
                                </TableCell>
                              ))}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}

                  {importPreview.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">Resumo do processamento</p>
                      <div className="overflow-x-auto rounded-xl border border-border/70">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Linha</TableHead>
                              <TableHead>Telefone</TableHead>
                              <TableHead>Nome</TableHead>
                              <TableHead>Cidade</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Resultado</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {importPreview.map((item) => (
                              <TableRow key={`${item.rowNumber}-${item.telefone || "skip"}`}>
                                <TableCell>{item.rowNumber}</TableCell>
                                <TableCell>{item.telefone || "-"}</TableCell>
                                <TableCell>{item.nome || "-"}</TableCell>
                                <TableCell>{item.cidade || "-"}</TableCell>
                                <TableCell>{item.status || "-"}</TableCell>
                                <TableCell>{item.imported ? "Importado" : item.skipReason || "Ignorado"}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            <section>
              <SectionHeader
                title="Historico"
                subtitle="Ultimas cargas registradas para consulta operacional e uso em nos de disparo."
                icon={History}
              />
              <Card className="rounded-2xl border-border/80 bg-card/95 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Importacoes recentes</CardTitle>
                    <Button variant="outline" size="sm" onClick={() => refetch()} disabled={importsLoading}>
                      <RefreshCw className={cn("mr-1 h-4 w-4", importsLoading && "animate-spin")} />
                      Atualizar
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <ErrorMessage message={importsError ? (importsError as Error).message : null} variant="banner" />
                  {importsLoading && <EmptyState message="Carregando historico..." />}
                  {!importsLoading && !importsError && imports.length === 0 && (
                    <EmptyState
                      title="Nenhuma importacao encontrada"
                      description="Assim que uma planilha for processada, o historico fica disponivel aqui."
                    />
                  )}
                  {!importsLoading && !importsError && imports.length > 0 && (
                    <div className="space-y-4">
                      <div className="overflow-x-auto rounded-xl border border-border/70">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Arquivo</TableHead>
                              <TableHead>Tipo</TableHead>
                              <TableHead>Total</TableHead>
                              <TableHead>Importadas</TableHead>
                              <TableHead>Ignoradas</TableHead>
                              <TableHead>Usuario</TableHead>
                              <TableHead>Data</TableHead>
                              <TableHead className="w-[80px]">Acoes</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {paginatedImports.map((item) => (
                              <TableRow key={item.id}>
                                <TableCell>{item.source_name}</TableCell>
                                <TableCell>{item.source_type}</TableCell>
                                <TableCell>{item.total_rows}</TableCell>
                                <TableCell>{item.imported_rows}</TableCell>
                                <TableCell>{item.skipped_rows}</TableCell>
                                <TableCell>{item.uploaded_by_email || "-"}</TableCell>
                                <TableCell>{formatDate(item.created_at)}</TableCell>
                                <TableCell>
                                  {deleteConfirmId === item.id ? (
                                    <div className="flex items-center gap-1">
                                      <Button variant="destructive" size="sm" className="h-7 px-2 text-xs" onClick={() => void handleDelete(item.id)} disabled={deleteLeadImport.isPending}>
                                        {deleteLeadImport.isPending ? "..." : "Sim"}
                                      </Button>
                                      <Button variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={() => setDeleteConfirmId(null)}>
                                        Nao
                                      </Button>
                                    </div>
                                  ) : (
                                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive" onClick={() => setDeleteConfirmId(item.id)}>
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>

                      <PaginationControls currentPage={safeImportsPage} totalPages={totalImportsPages} pageSize={IMPORTS_PAGE_SIZE} totalItems={imports.length} onPageChange={setImportsPage} />
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </div>
        )}

        {activeTab === "pendentes" && (
          <div className="space-y-5">
            <div className="space-y-4">
              <div>
                <h2 className="text-2xl font-extrabold tracking-tight text-foreground">Leads Pendentes de Disparo</h2>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  {pendingData ? `${pendingData.pendingCount} pendentes de ${pendingData.total} total` : "Carregando..."}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Card className="rounded-2xl border-border/80 bg-card/95">
                  <CardContent className="flex items-center gap-4 p-5">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-amber-400/20 bg-amber-400/10">
                      <AlertTriangle className="h-5 w-5 text-amber-400" />
                    </div>
                    <div>
                      <p className="text-2xl font-extrabold text-foreground">{pendingData?.pendingCount ?? 0}</p>
                      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Aguardando disparo</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="rounded-2xl border-border/80 bg-card/95">
                  <CardContent className="flex items-center gap-4 p-5">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
                      <CheckCircle2 className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-2xl font-extrabold text-foreground">
                        {pendingData ? pendingData.total - pendingData.pendingCount : 0}
                      </p>
                      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Ja disparados</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="rounded-2xl border-border/80 bg-card/95">
                  <CardContent className="flex items-center gap-4 p-5">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5">
                      <FileSpreadsheet className="h-5 w-5 text-white/60" />
                    </div>
                    <div>
                      <p className="text-2xl font-extrabold text-foreground">{pendingData?.total ?? 0}</p>
                      <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Total importados</p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Select value={selectedImportId} onValueChange={setSelectedImportId}>
                    <SelectTrigger className={cn("w-[220px] rounded-xl", darkFieldClass)}>
                      <SelectValue placeholder="Todas as importacoes" />
                    </SelectTrigger>
                    <SelectContent className={darkSelectContentClass}>
                      <SelectItem value={ALL_IMPORTS_VALUE} className={darkSelectItemClass}>Todas as importacoes</SelectItem>
                      {imports.map((imp) => (
                        <SelectItem key={imp.id} value={imp.id} className={darkSelectItemClass}>
                          {imp.source_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={pendingFilter} onValueChange={setPendingFilter}>
                    <SelectTrigger className={cn("w-[180px] rounded-xl", darkFieldClass)}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className={darkSelectContentClass}>
                      <SelectItem value="false" className={darkSelectItemClass}>Nao disparados</SelectItem>
                      <SelectItem value="true" className={darkSelectItemClass}>Ja disparados</SelectItem>
                      <SelectItem value="all" className={darkSelectItemClass}>Todos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex rounded-xl border border-slate-200/90 bg-white/80 p-1 dark:border-white/10 dark:bg-white/[0.04]">
                    {leadViewOptions.map((option) => {
                      const Icon = option.icon;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          onClick={() => setLeadViewMode(option.id)}
                          className={cn(
                            "inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors",
                            leadViewMode === option.id
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:bg-slate-100 hover:text-foreground dark:hover:bg-white/[0.06]",
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                          {option.label}
                        </button>
                      );
                    })}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => refetchPending()} disabled={pendingLoading}>
                    <RefreshCw className={cn("mr-1 h-4 w-4", pendingLoading && "animate-spin")} />
                    Atualizar
                  </Button>
                </div>
              </div>
            </div>

            <Card className="rounded-2xl border-border/80 bg-card/95 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
              <CardContent className="p-4">
                <ErrorMessage message={pendingError ? (pendingError as Error).message : null} variant="banner" />
                {pendingLoading && <EmptyState message="Carregando leads..." />}
                {!pendingLoading && pendingData && segmentedPendingItems.length === 0 && (
                  <EmptyState
                    title={pendingFilter === "false" ? "Todos os leads ja foram disparados" : "Nenhum lead encontrado"}
                    description="Altere o filtro para ver leads em outro estado."
                  />
                )}
                {!pendingLoading && pendingData && segmentedPendingItems.length > 0 && (
                  <div className="space-y-4">
                    {leadViewMode === "lista" && (
                    <div className="overflow-x-auto rounded-xl border border-border/70">
                      <div className="max-h-[560px] overflow-y-auto">
                        <Table>
                          <TableHeader>
                            <TableRow className="bg-[rgba(12,15,28,0.98)]">
                              <TableHead>#</TableHead>
                              <TableHead>Telefone</TableHead>
                              <TableHead>Nome</TableHead>
                              <TableHead>Cidade</TableHead>
                              <TableHead>Estado</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Disparo</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {segmentedPendingItems.map((item) => {
                              const normalizedData =
                                item.normalized_data && typeof item.normalized_data === "object"
                                  ? (item.normalized_data as Record<string, unknown>)
                                  : {};

                              return (
                                <TableRow key={item.id}>
                                  <TableCell className="font-mono text-xs text-muted-foreground">{item.row_number}</TableCell>
                                  <TableCell className="font-mono text-sm">{item.telefone || "-"}</TableCell>
                                  <TableCell>{String(normalizedData.nome || "-")}</TableCell>
                                  <TableCell>{String(normalizedData.cidade || "-")}</TableCell>
                                  <TableCell>{String(normalizedData.estado || "-")}</TableCell>
                                  <TableCell>{String(normalizedData.status || "-")}</TableCell>
                                  <TableCell>
                                    {item.dispatched ? (
                                      <span className="inline-flex items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                                        <CheckCircle2 className="h-3 w-3" /> Enviado
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 font-mono text-[10px] text-amber-400">
                                        <XCircle className="h-3 w-3" /> Pendente
                                      </span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                    )}

                    {leadViewMode === "cards" && (
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {segmentedPendingItems.map((item) => {
                          const data = getLeadNormalizedData(item);
                          return (
                            <div key={item.id} className="rounded-2xl border border-slate-200/90 bg-white/85 p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.04]">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-semibold text-foreground">{String(data.nome || "Lead sem nome")}</p>
                                  <p className="mt-1 font-mono text-xs text-muted-foreground">{item.telefone || "-"}</p>
                                </div>
                                <span className={cn("rounded-md px-2 py-1 font-mono text-[10px]", item.dispatched ? "bg-primary/10 text-primary" : "bg-amber-400/10 text-amber-500")}>
                                  {item.dispatched ? "Enviado" : "Pendente"}
                                </span>
                              </div>
                              <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                                <span>Cidade: {String(data.cidade || "-")}</span>
                                <span>Estado: {String(data.estado || "-")}</span>
                                <span>Perfil: {String(data.perfil || data.tipo_cliente || "-")}</span>
                                <span>Interesse: {String(data.interesse || data.produto || "-")}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {leadViewMode === "funil" && (
                      <div className="grid gap-3 lg:grid-cols-3">
                        {funnelGroups.map((group) => (
                          <div key={group.id} className="rounded-2xl border border-slate-200/90 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                            <div className="mb-3 flex items-center justify-between">
                              <p className="font-semibold text-foreground">{group.title}</p>
                              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">{group.items.length}</span>
                            </div>
                            <div className="space-y-2">
                              {group.items.slice(0, 8).map((item) => {
                                const data = getLeadNormalizedData(item);
                                return (
                                  <div key={`${group.id}-${item.id}`} className="rounded-xl border border-slate-200/80 bg-slate-50/90 p-3 text-sm dark:border-white/10 dark:bg-black/25">
                                    <p className="font-medium text-foreground">{String(data.nome || item.telefone || "Lead")}</p>
                                    <p className="mt-1 text-xs text-muted-foreground">{String(data.cidade || "-")} · {String(data.status || "sem status")}</p>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {leadViewMode === "kanban" && (
                      <div className="grid gap-3 md:grid-cols-3">
                        {["novo", "em contato", "qualificado"].map((statusGroup) => {
                          const items = segmentedPendingItems.filter((item) => {
                            const status = normalizeLooseText(getLeadNormalizedData(item).status);
                            if (statusGroup === "novo") return !status || status.includes("novo");
                            if (statusGroup === "em contato") return status.includes("contato") || status.includes("morno");
                            return status.includes("qualificado") || status.includes("quente");
                          });
                          return (
                            <div key={statusGroup} className="min-h-[260px] rounded-2xl border border-slate-200/90 bg-white/80 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                              <div className="mb-3 flex items-center justify-between">
                                <p className="capitalize font-semibold text-foreground">{statusGroup}</p>
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-muted-foreground dark:bg-white/[0.08]">{items.length}</span>
                              </div>
                              <div className="space-y-2">
                                {items.slice(0, 10).map((item) => {
                                  const data = getLeadNormalizedData(item);
                                  return (
                                    <div key={`${statusGroup}-${item.id}`} className="rounded-xl border border-slate-200/80 bg-slate-50/90 p-3 dark:border-white/10 dark:bg-black/25">
                                      <p className="text-sm font-medium text-foreground">{String(data.nome || item.telefone || "Lead")}</p>
                                      <p className="mt-1 text-xs text-muted-foreground">{String(data.interesse || data.produto || data.cidade || "-")}</p>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "campanha" && isInternalUser && (
          <Card className="rounded-2xl border-border/80 bg-card/95 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <CardContent className="space-y-6 p-6">
              <div>
                <h2 className="text-2xl font-extrabold tracking-tight text-foreground">Criar Nova Campanha</h2>
                <p className="mt-1 text-sm text-muted-foreground">Crie um registro real na base de campanhas usando uma empresa e uma importacao existente.</p>
              </div>

              {dispatchStatus && (
                <div
                  className={cn(
                    "rounded-xl border p-4 text-sm font-medium",
                    dispatchStatus.includes("sucesso") || dispatchStatus.includes("agendada")
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-destructive/30 bg-destructive/10 text-destructive",
                  )}
                >
                  {dispatchStatus}
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Nome da Campanha *</p>
                  <Input placeholder="Ex: Newsletter Marco 2026" className={darkFieldClass} value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Base de Leads (importacao)</p>
                  <Select value={selectedImportId} onValueChange={setSelectedImportId}>
                    <SelectTrigger className={darkFieldClass}>
                      <SelectValue placeholder="Todas as importacoes" />
                    </SelectTrigger>
                    <SelectContent className={darkSelectContentClass}>
                      <SelectItem value={ALL_IMPORTS_VALUE} className={darkSelectItemClass}>Todas as importacoes</SelectItem>
                      {imports.map((imp) => (
                        <SelectItem key={imp.id} value={imp.id} className={darkSelectItemClass}>
                          {imp.source_name} ({imp.imported_rows} leads)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Data e hora da campanha</p>
                  <Input type="datetime-local" className={darkFieldClass} value={scheduledFor} onChange={(e) => setScheduledFor(e.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    Deixe em branco para manter a campanha na fila sem data definida.
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Leads pendentes</p>
                  <div className={cn("flex h-10 items-center rounded-md px-3 font-mono text-sm text-slate-500 dark:text-white/62", darkFieldClass)}>
                    {pendingData ? `${pendingData.pendingCount} aguardando disparo` : "Carregando..."}
                  </div>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Limite por lote</p>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    inputMode="numeric"
                    placeholder="Ex: 100"
                    className={darkFieldClass}
                    value={dispatchLimit}
                    onChange={(e) => setDispatchLimit(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Em branco, a campanha sera criada com o lote padrao de 50 leads por execucao.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 rounded-2xl border border-slate-200/90 bg-slate-50/80 p-4 dark:border-white/10 dark:bg-white/[0.03] lg:grid-cols-[1fr_0.9fr]">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Segmentacao da base</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {segmentMatchedCount} leads entram nesta campanha
                        {segmentRejectedCount > 0 ? ` · ${segmentRejectedCount} fora do filtro` : ""}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSegmentation(defaultSegmentation)}
                    >
                      Limpar filtros
                    </Button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <div className="space-y-2">
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Genero</p>
                      <Select value={segmentation.gender} onValueChange={(value) => setSegmentation((current) => ({ ...current, gender: value }))}>
                        <SelectTrigger className={darkFieldClass}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className={darkSelectContentClass}>
                          <SelectItem value={ALL_SEGMENT_VALUE} className={darkSelectItemClass}>Todos</SelectItem>
                          <SelectItem value="homem" className={darkSelectItemClass}>Homem</SelectItem>
                          <SelectItem value="mulher" className={darkSelectItemClass}>Mulher</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Produto</p>
                      <Select value={segmentation.productType} onValueChange={(value) => setSegmentation((current) => ({ ...current, productType: value }))}>
                        <SelectTrigger className={darkFieldClass}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className={darkSelectContentClass}>
                          <SelectItem value={ALL_SEGMENT_VALUE} className={darkSelectItemClass}>Todos</SelectItem>
                          <SelectItem value="imovel" className={darkSelectItemClass}>Imovel</SelectItem>
                          <SelectItem value="veiculo" className={darkSelectItemClass}>Veiculo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Valor</p>
                      <Select value={segmentation.ticket} onValueChange={(value) => setSegmentation((current) => ({ ...current, ticket: value }))}>
                        <SelectTrigger className={darkFieldClass}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className={darkSelectContentClass}>
                          <SelectItem value={ALL_SEGMENT_VALUE} className={darkSelectItemClass}>Todos</SelectItem>
                          <SelectItem value="alto" className={darkSelectItemClass}>Ticket alto</SelectItem>
                          <SelectItem value="baixo" className={darkSelectItemClass}>Ticket baixo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Corte de ticket</p>
                      <Input
                        inputMode="decimal"
                        placeholder="Ex: 50000"
                        className={darkFieldClass}
                        value={segmentation.ticketThreshold}
                        onChange={(event) => setSegmentation((current) => ({ ...current, ticketThreshold: event.target.value }))}
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Interesse</p>
                      <Input
                        placeholder="Investimento, automotivo..."
                        className={darkFieldClass}
                        value={segmentation.interest}
                        onChange={(event) => setSegmentation((current) => ({ ...current, interest: event.target.value }))}
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Campanha especifica</p>
                      <Input
                        placeholder="Dia das Maes, Black Friday..."
                        className={darkFieldClass}
                        value={segmentation.campaignTag}
                        onChange={(event) => setSegmentation((current) => ({ ...current, campaignTag: event.target.value }))}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Texto de envio</p>
                    <Textarea
                      placeholder="Digite a mensagem que o agente usara nesta campanha..."
                      className={cn("min-h-[142px]", darkFieldClass)}
                      value={campaignMessage}
                      onChange={(event) => setCampaignMessage(event.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <input ref={campaignImageInputRef} type="file" accept="image/*" className="sr-only" onChange={handleCampaignImageChange} />
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-center"
                      onClick={() => campaignImageInputRef.current?.click()}
                    >
                      <ImagePlus className="h-4 w-4" />
                      {campaignImage ? "Trocar imagem da campanha" : "Anexar imagem da campanha"}
                    </Button>
                    {campaignImage ? (
                      <div className="flex items-center gap-3 rounded-xl border border-slate-200/90 bg-white/80 p-3 text-sm dark:border-white/10 dark:bg-black/30">
                        <img src={campaignImage.dataUrl} alt={campaignImage.name} className="h-14 w-14 rounded-lg object-cover" />
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{campaignImage.name}</p>
                          <p className="text-xs text-muted-foreground">{Math.round(campaignImage.size / 1024)} KB</p>
                        </div>
                      </div>
                    ) : null}
                    <ErrorMessage message={campaignImageError} variant="banner" />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
                  <Megaphone className="h-4 w-4" />
                  Fluxo real
                </div>
                <p className="text-sm text-muted-foreground">
                  Esta aba cria uma campanha real na tabela <code>campaigns</code>. Depois disso, a operacao continua nas tabs <strong>Agendamentos</strong> e <strong>Campanhas Enviadas</strong>.
                </p>
              </div>

              <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
                <Button onClick={() => void handleDispatch()} disabled={isDispatching || !selectedClientId}>
                  <Megaphone className="mr-2 h-4 w-4" />
                  {isDispatching ? "Criando..." : "Criar campanha"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === "enviadas" && isInternalUser && (
          <div className="space-y-5">
            <div className="flex flex-wrap gap-3">
              <div className="relative w-full max-w-xs">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={campaignSearch} onChange={(e) => setCampaignSearch(e.target.value)} placeholder="Buscar campanha..." className={cn("pl-9", darkFieldClass)} />
              </div>
              <Button variant="outline" onClick={() => refetchCampaigns()} disabled={campaignsLoading}>
                <RefreshCw className={cn("mr-1 h-4 w-4", campaignsLoading && "animate-spin")} />
                Atualizar
              </Button>
            </div>
            <ErrorMessage message={campaignsError ? (campaignsError as Error).message : null} variant="banner" />
            {!campaignsLoading && sentCampaigns.length === 0 ? (
              <EmptyState
                title="Nenhuma campanha enviada"
                description="As campanhas com disparo realizado aparecem aqui."
              />
            ) : null}
            <div className="grid gap-4 xl:grid-cols-3">
              {sentCampaigns.map((campaign) => (
                <Card key={campaign.id} className="rounded-2xl border-border/80 bg-card/95 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
                  <CardContent className="space-y-5 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-xl font-extrabold tracking-tight text-foreground">{campaign.name}</p>
                        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                          {campaign.last_triggered_at ? formatDate(campaign.last_triggered_at) : "Sem disparo"} · {campaign.client_name ?? campaign.client_id}
                        </p>
                      </div>
                      <span className={cn("rounded-md border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em]", campaign.status === "active" ? "border-primary/20 bg-primary/10 text-primary" : "border-amber-500/20 bg-amber-500/10 text-amber-300")}>
                        {campaign.status === "active" ? "ATIVA" : "PAUSADA"}
                      </span>
                    </div>
                    <div className="border-t border-border/70 pt-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                        Base: {campaign.import_id || "todas as importacoes"} · Lote: {campaign.limit_per_run}
                      </p>
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                        {campaign.scheduled_for ? `Agendada para ${formatDate(campaign.scheduled_for)}` : "Sem data agendada"}
                      </p>
                    </div>
                    {(campaign.analytics_meta?.message || campaign.analytics_meta?.image) ? (
                      <div className="rounded-xl border border-slate-200/90 bg-white/80 p-3 dark:border-white/10 dark:bg-black/30">
                        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Conteudo da campanha</p>
                        {campaign.analytics_meta?.message ? (
                          <p className="mt-2 line-clamp-3 text-sm text-foreground">{campaign.analytics_meta.message}</p>
                        ) : null}
                        {campaign.analytics_meta?.image ? (
                          <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                            <img src={campaign.analytics_meta.image.dataUrl} alt={campaign.analytics_meta.image.name} className="h-12 w-12 rounded-lg object-cover" />
                            <span className="truncate">{campaign.analytics_meta.image.name}</span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <p className="font-mono text-[12px] font-bold text-primary">{campaign.client_name ?? campaign.client_id}</p>
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Empresa</p>
                      </div>
                      <div>
                        <p className="font-mono text-[12px] font-bold text-sky-300">{campaign.import_id || "todas"}</p>
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Base</p>
                      </div>
                      <div>
                        <p className="font-mono text-[12px] font-bold text-amber-300">{campaign.limit_per_run} leads</p>
                        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-muted-foreground">Lote</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
                      <Button variant="outline" size="sm" onClick={() => setCampaignActionDialog({ action: "archive", campaign })}>
                        <Archive className="mr-2 h-4 w-4" />
                        Arquivar
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => setCampaignActionDialog({ action: "delete", campaign })}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Apagar
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {activeTab === "agendamentos" && isInternalUser && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-2xl font-extrabold tracking-tight text-foreground">Fila de Campanhas</h2>
                <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{queuedCampaigns.length} aguardando disparo</p>
              </div>
              <Button onClick={() => setActiveTab("campanha")}>+ Nova Campanha</Button>
            </div>
            <ErrorMessage message={campaignsError ? (campaignsError as Error).message : null} variant="banner" />
            {!campaignsLoading && queuedCampaigns.length === 0 && (
              <EmptyState
                title="Nenhuma campanha na fila"
                description="As campanhas criadas e ainda nao disparadas aparecem aqui."
              />
            )}
            <div className="space-y-4">
              {queuedCampaigns.map((campaign) => {
                const scheduleDateParts = getScheduleDateParts(campaign);

                return (
                  <Card key={campaign.id} className="rounded-2xl border-border/80 bg-card/95 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
                    <CardContent className="flex flex-wrap items-center gap-5 p-5">
                      <div className="flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border border-primary/20 bg-primary/5">
                        <span className="font-mono text-3xl font-bold text-primary">{scheduleDateParts.day}</span>
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">{scheduleDateParts.month}</span>
                      </div>
                      <div className="min-w-[220px] flex-1">
                        <p className="text-xl font-extrabold tracking-tight text-foreground">{campaign.name}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-4 font-mono text-[11px] text-muted-foreground">
                          <span className="inline-flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5" />{campaign.client_name ?? campaign.client_id}</span>
                          <span className="inline-flex items-center gap-1.5"><FileSpreadsheet className="h-3.5 w-3.5" />{campaign.import_id || "todas as bases"}</span>
                          <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />lote {campaign.limit_per_run}</span>
                          <span className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" />{scheduleDateParts.label}</span>
                        </div>
                        {(campaign.analytics_meta?.message || campaign.analytics_meta?.image) ? (
                          <div className="mt-4 rounded-xl border border-slate-200/90 bg-white/80 p-3 dark:border-white/10 dark:bg-black/30">
                            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Conteudo do disparo</p>
                            {campaign.analytics_meta?.message ? (
                              <p className="mt-2 line-clamp-2 text-sm text-foreground">{campaign.analytics_meta.message}</p>
                            ) : null}
                            {campaign.analytics_meta?.image ? (
                              <div className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
                                <img src={campaign.analytics_meta.image.dataUrl} alt={campaign.analytics_meta.image.name} className="h-12 w-12 rounded-lg object-cover" />
                                <span className="truncate">{campaign.analytics_meta.image.name}</span>
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      <span className={cn("rounded-md border px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em]", campaign.status === "active" ? "border-amber-400/20 bg-amber-400/10 text-amber-300" : "border-white/10 bg-white/5 text-muted-foreground")}>
                        {campaign.status === "active" ? "PRONTA" : "PAUSADA"}
                      </span>
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => void handleTriggerCampaign(campaign)} className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-black/40 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:bg-white/[0.05] hover:text-primary">
                          <Zap className="h-4 w-4" />
                        </button>
                        <button type="button" onClick={() => void handleToggleCampaignStatus(campaign)} className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-black/40 text-amber-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:bg-white/[0.05] hover:text-amber-200">
                          {campaign.status === "active" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                        </button>
                        <button type="button" onClick={() => setCampaignActionDialog({ action: "delete", campaign })} className="flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-black/40 text-[0px] text-pink-400 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-colors hover:bg-white/[0.05] hover:text-pink-300">
                          <Trash2 className="h-4 w-4 text-pink-400" />
                          ×
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </div>
        )}
      </section>
    </PageShell>
  );
}
