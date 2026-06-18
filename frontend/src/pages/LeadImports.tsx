import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import * as XLSX from "xlsx";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Archive,
  Building2,
  Info,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileSpreadsheet,
  Filter,
  ImagePlus,
  History,
  Megaphone,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  Zap,
  XCircle,
  Plus,
  Download,
  AlertCircle,
  Loader2,
} from "lucide-react";
import { useTheme } from "next-themes";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  useCampaignAiStatus,
  useCreateCampaign,
  useDeleteCampaign,
  useGenerateCampaignTemplateVariants,
  useTriggerCampaign,
  useUpdateCampaign,
  useCampaignDispatches,
  useCreateDispatch,
  useDeleteDispatch,
  useTriggerDispatch,
  useUpdateDispatch,
  useAllDispatches,
  type Campaign,
  type CampaignDispatch,
  type CampaignStatus,
  type CampaignDispatchOptions,
  type CampaignImageAsset,
  type CampaignSequenceStep,
} from "@/hooks/useCampanhas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { PageShell } from "@/components/PageShell";
import { cn } from "@/lib/utils";
import { useCampaignPrompts, useSaveCampaignPrompt } from "@/hooks/useCampaignPrompts";
import { toast } from "@/components/ui/use-toast";
import { API_BASE_URL } from "@/lib/api";

type SheetTab = "campanha" | "enviadas" | "agendamentos";
type CampaignTemplateStrategy = "single" | "ai_variations";

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

interface StepActionButton {
  displayText: string;
  type: "url" | "reply";
  url?: string;
}

const ALL_IMPORTS_VALUE = "__all__";
const ALL_SEGMENT_VALUE = "__all__";
const CAMPAIGN_LIMIT_MAX = 500;
const CAMPAIGN_TIME_ZONE = "America/Sao_Paulo";

const defaultSegmentation: CampaignSegmentationState = {
  gender: ALL_SEGMENT_VALUE,
  productType: ALL_SEGMENT_VALUE,
  ticket: ALL_SEGMENT_VALUE,
  ticketThreshold: "",
  interest: "",
  campaignTag: "",
};

const defaultDispatchOptions: CampaignDispatchOptions = {
  leadDelaySeconds: 2,
  stopOnStepFailure: true,
  aiAssisted: false,
  evolutionInstanceId: null,
  templateStrategy: "single",
  templateVariantCount: 0,
  waitForReply: false,
  replyTimeoutSeconds: 60,
  replyPollIntervalSeconds: 5,
};

const darkFieldClass =
  "border-slate-200/90 bg-white text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-all placeholder:text-slate-400 focus-visible:border-primary/35 focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:ring-offset-0 dark:border-white/12 dark:bg-black/45 dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_30px_rgba(0,0,0,0.18)] dark:placeholder:text-white/30 dark:focus-visible:bg-black/60 dark:focus-visible:ring-1 dark:focus-visible:ring-primary/20";
const darkSelectContentClass =
  "border-slate-200/90 bg-white text-slate-900 shadow-[0_24px_50px_rgba(15,23,42,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-[#090b17] dark:text-white dark:shadow-[0_24px_50px_rgba(0,0,0,0.45)]";
const darkSelectItemClass =
  "rounded-md text-slate-700 focus:bg-slate-100 focus:text-slate-950 data-[state=checked]:bg-primary/10 data-[state=checked]:text-primary dark:text-white/78 dark:focus:bg-white/[0.06] dark:focus:text-white dark:data-[state=checked]:bg-primary/12 dark:data-[state=checked]:text-white";

function parseSpreadsheetFile(file: File): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const result = event.target?.result;
        if (!result) return reject(new Error("Não foi possível ler o arquivo."));
        const workbook = XLSX.read(result, { type: "array", cellDates: true });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) return reject(new Error("A planilha não possui dados."));
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
  return date ? date.toLocaleString("pt-BR", { timeZone: CAMPAIGN_TIME_ZONE }) : fallback;
}

function campaignLocalDateTimeToUtcIso(value: string) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function campaignUtcIsoToLocalDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateStr;
  }
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
  return "";
}

function leadMatchesSegmentation(data: Record<string, unknown>, filters: CampaignSegmentationState) {
  if (filters.gender !== ALL_SEGMENT_VALUE) {
    const gender = normalizeLooseText(getLeadField(data, ["genero", "gênero", "sexo"]));
    if (!gender.includes(filters.gender)) return false;
  }
  if (filters.productType !== ALL_SEGMENT_VALUE) {
    const product = normalizeLooseText(getLeadField(data, ["tipo_produto", "produto", "perfil"]));
    if (!product.includes(filters.productType)) return false;
  }
  return true;
}

function toCampaignSegmentationPayload(filters: CampaignSegmentationState) {
  return {
    gender: filters.gender === ALL_SEGMENT_VALUE ? "" : filters.gender,
    productType: filters.productType === ALL_SEGMENT_VALUE ? "" : filters.productType,
    ticket: "",
    ticketThreshold: null,
    interest: "",
    campaignTag: "",
  };
}

function getLeadNormalizedData(item: { normalized_data?: Record<string, unknown> | null }) {
  return item.normalized_data && typeof item.normalized_data === "object" ? item.normalized_data : {};
}

function makeCampaignStepId() {
  return `step-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createCampaignStep(type: "text" | "image", order: number, patch: Partial<CampaignSequenceStep> = {}): CampaignSequenceStep & { buttons?: StepActionButton[] } {
  return {
    id: patch.id || makeCampaignStepId(),
    type,
    order,
    text: patch.text || "",
    textVariants: patch.textVariants || [],
    image: patch.image || null,
    enabled: patch.enabled ?? true,
    delayAfterSeconds: patch.delayAfterSeconds ?? 5,
    triggerMode: patch.triggerMode === "after_reply" ? "after_reply" : "immediate",
    buttons: (patch as any).buttons || [],
  };
}

function normalizeCampaignSequence(meta?: Campaign["analytics_meta"]): Array<CampaignSequenceStep & { buttons?: StepActionButton[] }> {
  const provided = Array.isArray(meta?.sequence) ? meta.sequence : [];
  if (provided.length > 0) {
    return [...provided]
      .sort((a, b) => a.order - b.order)
      .map((step, idx) => ({
        ...step,
        order: idx + 1,
        textVariants: Array.isArray(step.textVariants) ? step.textVariants : [],
        image: step.image || null,
        enabled: step.enabled !== false,
        delayAfterSeconds: step.delayAfterSeconds || 5,
        triggerMode: step.triggerMode || "immediate",
        buttons: step.buttons || [],
      }));
  }
  return [];
}

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <UITooltip>
        <TooltipTrigger asChild>
          <Info className="inline h-3.5 w-3.5 cursor-help text-muted-foreground opacity-60 hover:opacity-100" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs bg-slate-900 border-white/10 text-white rounded-xl">
          {text}
        </TooltipContent>
      </UITooltip>
    </TooltipProvider>
  );
}

interface ConsultantSchedule {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  scheduling_link: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

function useConsultantSchedules(clientId: string) {
  const { isAuthenticated, getIdToken } = useAuth();
  return useQuery({
    queryKey: ["consultant-schedules", clientId],
    enabled: isAuthenticated && !!clientId,
    queryFn: async (): Promise<ConsultantSchedule[]> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");
      const res = await fetch(`${API_BASE_URL}/api/campaigns/consultant-schedules?clientId=${encodeURIComponent(clientId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao buscar consultores.");
      const data = await res.json();
      return data.items || [];
    },
    staleTime: 30 * 1000,
  });
}

function useCreateConsultantSchedule() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: { clientId: string; name: string; scheduling_link: string; email?: string; phone?: string; active?: boolean }): Promise<ConsultantSchedule> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");
      const res = await fetch(`${API_BASE_URL}/api/campaigns/consultant-schedules`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || "Falha ao criar consultor.");
      }
      const data = await res.json();
      return data.item;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["consultant-schedules", variables.clientId] });
    },
  });
}

function useUpdateConsultantSchedule() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, clientId, ...payload }: { id: string; clientId: string; name?: string; scheduling_link?: string; email?: string; phone?: string; active?: boolean }): Promise<ConsultantSchedule> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");
      const res = await fetch(`${API_BASE_URL}/api/campaigns/consultant-schedules/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Falha ao atualizar consultor.");
      const data = await res.json();
      return data.item;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["consultant-schedules", variables.clientId] });
    },
  });
}

function useDeleteConsultantSchedule() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, clientId }: { id: string; clientId: string }): Promise<void> => {
      const token = await getIdToken();
      if (!token) throw new Error("Usuario nao autenticado.");
      const res = await fetch(`${API_BASE_URL}/api/campaigns/consultant-schedules/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao deletar consultor.");
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["consultant-schedules", variables.clientId] });
    },
  });
}

const CAMPAIGN_STATUS_LABELS: Record<CampaignStatus, string> = {
  active: "Ativa",
  paused: "Pausada",
  draft: "Rascunho",
  scheduled: "Agendada",
  processing: "Executando",
  sent: "Enviada",
  failed: "Falhou",
  cancelled: "Cancelada",
};

const CAMPAIGN_STATUS_COLORS: Record<CampaignStatus, string> = {
  active: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  paused: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  draft: "border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
  scheduled: "border-sky-300 bg-sky-50 text-sky-600 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-400",
  processing: "border-cyan-300 bg-cyan-50 text-cyan-600 dark:border-cyan-800 dark:bg-cyan-900/20 dark:text-cyan-400",
  sent: "border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  failed: "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400",
  cancelled: "border-slate-300 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500",
};

export default function LeadImports({
  fixedClientId,
  fixedClientName,
  title = "Envios por Planilha",
  subtitle = "Importe contatos, configure mensagens em massa e acompanhe a fila",
  headerRight,
}: LeadImportsProps) {
  const { clientId, getIdToken } = useAuth();
  const { selectedClientId } = useOptionalCrmClient();
  const activeClientId = fixedClientId || selectedClientId || "";
  const isInternalUser = useAuth().isInternalUser;
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<SheetTab>("campanha");

  // Lead spreadsheet upload states
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<Record<string, unknown>[]>([]);
  const [previewRows, setPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [selectedImportId, setSelectedImportId] = useState<string>(ALL_IMPORTS_VALUE);
  const [previewOpen, setPreviewOpen] = useState(false);

  // Campaign builder states
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [campaignLimitPerRun, setCampaignLimitPerRun] = useState("50");
  const [campaignSequence, setCampaignSequence] = useState<Array<CampaignSequenceStep & { buttons?: StepActionButton[] }>>([
    createCampaignStep("text", 1),
  ]);
  const [campaignTemplateStrategy, setCampaignTemplateStrategy] = useState<CampaignTemplateStrategy>("single");
  const [dispatchOptions, setDispatchOptions] = useState<CampaignDispatchOptions>(defaultDispatchOptions);
  const [segmentation, setSegmentation] = useState<CampaignSegmentationState>(defaultSegmentation);

  // Scheduling & parameters states
  const [multiAgendaEnabled, setMultiAgendaEnabled] = useState(false);
  const [newConsultantName, setNewConsultantName] = useState("");
  const [newConsultantLink, setNewConsultantLink] = useState("");
  const [newTriggerType, setNewTriggerType] = useState<"manual" | "scheduled">("manual");
  const [newScheduledAt, setNewScheduledAt] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const sequenceImageInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedImageStepId, setSelectedImageStepId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittingStatus, setSubmittingStatus] = useState<string | null>(null);

  // Hooks queries
  const { data: imports = [], refetch: refetchImports } = useLeadImports(activeClientId);
  const { data: campaigns = [], isLoading: loadingCampaigns, refetch: refetchCampaigns } = useCampanhas(activeClientId || undefined);
  const { data: dispatches = [], isLoading: loadingDispatches, refetch: refetchDispatches } = useAllDispatches(activeClientId || null);
  const { data: consultants = [], refetch: refetchConsultants } = useConsultantSchedules(activeClientId);
  const createConsultant = useCreateConsultantSchedule();
  const updateConsultant = useUpdateConsultantSchedule();
  const deleteConsultant = useDeleteConsultantSchedule();

  const { data: pendingData, refetch: refetchPending } = useLeadImportItems(
    activeClientId,
    selectedImportId === ALL_IMPORTS_VALUE ? undefined : selectedImportId,
    "pending"
  );

  // Mutations
  const createLeadImport = useCreateLeadImport();
  const deleteLeadImport = useDeleteLeadImport();
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();
  const triggerCampaign = useTriggerCampaign();
  const generateTemplateVariants = useGenerateCampaignTemplateVariants();
  const createDispatch = useCreateDispatch(""); // campaign-specific instances are created dynamically
  const deleteDispatch = useDeleteDispatch("");
  const triggerDispatch = useTriggerDispatch("");
  const updateDispatch = useUpdateDispatch("");

  // Resolving tenant options
  const crmClient = useOptionalCrmClient();
  const selectedClient = crmClient?.selectedClient || null;
  const selectedLeadClient = selectedClient || crmClient?.clients.find((c) => c.id === activeClientId) || null;
  const evolutionInstanceOptions = useMemo(
    () =>
      (selectedLeadClient?.n8n_settings?.evolution_instances || [])
        .filter((inst) => inst.active && inst.dispatch_webhook_url)
        .map((inst) => ({
          id: inst.id,
          name: inst.name || "Evolution",
          isDefault: inst.is_default,
        })),
    [selectedLeadClient]
  );

  const resolvedClientName = fixedClientName || selectedClient?.name || activeClientId;

  // Initialize/refresh settings
  useEffect(() => {
    const defaultInstanceId =
      evolutionInstanceOptions.find((inst) => inst.isDefault)?.id ||
      evolutionInstanceOptions[0]?.id ||
      null;

    setDispatchOptions((current) => ({
      ...current,
      evolutionInstanceId: current.evolutionInstanceId && evolutionInstanceOptions.some(i => i.id === current.evolutionInstanceId)
        ? current.evolutionInstanceId
        : defaultInstanceId,
    }));
  }, [evolutionInstanceOptions]);

  // Statistics calculation for uploaded leads
  const parsedLeadsStats = useMemo(() => {
    if (parsedRows.length === 0) return { total: 0, valid: 0, invalid: 0 };
    let valid = 0;
    parsedRows.forEach((row) => {
      const phone = getLeadField(row, ["telefone", "celular", "phone", "number", "whatsapp"]);
      if (phone && phone.replace(/\D/g, "").length >= 8) {
        valid++;
      }
    });
    return {
      total: parsedRows.length,
      valid,
      invalid: parsedRows.length - valid,
    };
  }, [parsedRows]);

  // Handle excel/csv parsed rows
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setParseError(null);
    setParsedRows([]);
    setPreviewRows([]);

    if (!file) return;
    try {
      const rows = await parseSpreadsheetFile(file);
      setParsedRows(rows);
      setPreviewRows(rows.slice(0, 5));
      setCampaignName(file.name.replace(/\.[^/.]+$/, ""));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Falha ao analisar a planilha.");
    }
  }

  // Handle sequence step modifications
  function updateCampaignStep(stepId: string, patch: Partial<CampaignSequenceStep & { buttons?: StepActionButton[] }>) {
    setCampaignSequence((current) =>
      current.map((step) => (step.id === stepId ? { ...step, ...patch } : step))
    );
  }

  function addCampaignStep(type: "text" | "image") {
    setCampaignSequence((current) => [
      ...current,
      createCampaignStep(type, current.length + 1),
    ]);
  }

  function removeCampaignStep(stepId: string) {
    setCampaignSequence((current) => {
      const filtered = current.filter((step) => step.id !== stepId);
      return filtered.length > 0
        ? filtered.map((step, idx) => ({ ...step, order: idx + 1 }))
        : [createCampaignStep("text", 1)];
    });
  }

  function moveCampaignStep(stepId: string, direction: -1 | 1) {
    setCampaignSequence((current) => {
      const index = current.findIndex((step) => step.id === stepId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;

      const next = [...current];
      const [step] = next.splice(index, 1);
      next.splice(targetIndex, 0, step);
      return next.map((s, idx) => ({ ...s, order: idx + 1 }));
    });
  }

  // Handle trigger sequence image change
  async function handleSequenceImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    const stepId = selectedImageStepId;
    if (!file || !stepId) return;

    if (!file.type.startsWith("image/")) {
      toast({ title: "Arquivo inválido", description: "Por favor, envie uma imagem.", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "Imagem muito grande", description: "O tamanho máximo é de 2MB.", variant: "destructive" });
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        updateCampaignStep(stepId, {
          image: {
            name: file.name,
            type: file.type,
            size: file.size,
            dataUrl,
          },
        });
      };
      reader.readAsDataURL(file);
    } catch {
      toast({ title: "Erro", description: "Falha ao carregar a imagem.", variant: "destructive" });
    } finally {
      event.target.value = "";
      setSelectedImageStepId(null);
    }
  }

  // Generate AI Variations inline for a step
  const handleGenerateStepVariants = async (stepId: string, baseText: string) => {
    if (!activeClientId || !baseText.trim()) {
      toast({ title: "Campo de texto vazio", description: "Digite a mensagem base antes de gerar variações.", variant: "destructive" });
      return;
    }
    try {
      updateCampaignStep(stepId, { textVariants: [] });
      toast({ title: "Gerando variações...", description: "A IA está processando variações humanizadas." });
      const result = await generateTemplateVariants.mutateAsync({
        baseText: baseText.trim(),
      });
      updateCampaignStep(stepId, { textVariants: result.variants || [] });
      toast({ title: "Sucesso!", description: "3 variações humanizadas foram geradas." });
    } catch (err) {
      toast({
        title: "Erro ao gerar variações",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    }
  };

  const handleCreateConsultant = () => {
    if (!newConsultantName.trim() || !newConsultantLink.trim()) {
      toast({ title: "Campos vazios", description: "Preencha o nome e o link de agendamento.", variant: "destructive" });
      return;
    }
    if (!newConsultantLink.trim().startsWith("http")) {
      toast({ title: "Link invalido", description: "O link de agendamento deve comecar com http:// ou https://.", variant: "destructive" });
      return;
    }
    createConsultant.mutate(
      {
        clientId: activeClientId,
        name: newConsultantName.trim(),
        scheduling_link: newConsultantLink.trim(),
      },
      {
        onSuccess: () => {
          setNewConsultantName("");
          setNewConsultantLink("");
          toast({ title: "Consultor adicionado com sucesso." });
        },
      }
    );
  };

  // Manage Action buttons inside step cards
  function handleAddStepButton(stepId: string) {
    const step = campaignSequence.find((s) => s.id === stepId);
    if (!step) return;
    const currentButtons = step.buttons || [];
    if (currentButtons.length >= 3) {
      toast({ title: "Limite atingido", description: "O limite máximo é de 3 botões por mensagem." });
      return;
    }
    const updated = [...currentButtons, { displayText: "Link de Acesso", type: "url" as const, url: "{{scheduling_link}}" }];
    updateCampaignStep(stepId, { buttons: updated });
  }

  function handleRemoveStepButton(stepId: string, btnIndex: number) {
    const step = campaignSequence.find((s) => s.id === stepId);
    if (!step) return;
    const currentButtons = step.buttons || [];
    const updated = currentButtons.filter((_, idx) => idx !== btnIndex);
    updateCampaignStep(stepId, { buttons: updated });
  }

  function handleUpdateStepButton(stepId: string, btnIndex: number, patch: Partial<StepActionButton>) {
    const step = campaignSequence.find((s) => s.id === stepId);
    if (!step) return;
    const currentButtons = step.buttons || [];
    const updated = currentButtons.map((btn, idx) => (idx === btnIndex ? { ...btn, ...patch } : btn));
    updateCampaignStep(stepId, { buttons: updated });
  }

  // Consolidated linear creation submit trigger
  async function handleCreateAndDispatch() {
    if (!activeClientId) {
      toast({ title: "Seção Inválida", description: "Selecione uma empresa no seletor.", variant: "destructive" });
      return;
    }
    if (!campaignName.trim()) {
      toast({ title: "Nome ausente", description: "Defina um nome de identificação para o envio.", variant: "destructive" });
      return;
    }
    if (!selectedFile && selectedImportId === ALL_IMPORTS_VALUE) {
      toast({ title: "Base de leads ausente", description: "Por favor, carregue uma planilha ou selecione uma base ativa.", variant: "destructive" });
      return;
    }

    const enabledSteps = campaignSequence.filter((s) => s.enabled);
    if (enabledSteps.length === 0) {
      toast({ title: "Mensagem vazia", description: "Adicione pelo menos um passo ativo na timeline de envio.", variant: "destructive" });
      return;
    }

    setIsSubmitting(true);
    setSubmittingStatus("Preparando importação de leads...");

    try {
      let finalImportId = selectedImportId;

      // 1. If upload a new file, run lead import first
      if (selectedFile && parsedRows.length > 0) {
        setSubmittingStatus("Processando planilha e aplicando round-robin...");
        const activeLinks = multiAgendaEnabled
          ? consultants.filter(c => c.active).map(c => c.scheduling_link)
          : [];

        // Apply Round-Robin directly on rows
        const finalRows = activeLinks.length > 0
          ? parsedRows.map((row, idx) => ({
              ...row,
              scheduling_link: activeLinks[idx % activeLinks.length],
            }))
          : parsedRows;

        const importRes = await createLeadImport.mutateAsync({
          clientId: activeClientId,
          sourceName: selectedFile.name,
          sourceType: selectedFile.name.split(".").pop()?.toLowerCase() || "spreadsheet",
          rows: finalRows,
        });
        finalImportId = importRes.item.id;
      }

      setSubmittingStatus("Configurando campanha e timeline...");
      const limitPerRun = Number.parseInt(campaignLimitPerRun, 10) || 50;

      // Make sure template strategy matches variants state
      const hasVariants = campaignSequence.some(s => s.textVariants && s.textVariants.length > 0);
      const templateStrategy: "single" | "ai_variations" = hasVariants ? "ai_variations" : "single";

      const campaignPayload = {
        name: campaignName.trim(),
        clientId: activeClientId,
        importId: finalImportId === ALL_IMPORTS_VALUE ? null : finalImportId,
        limitPerRun,
        mode: "disparo" as const,
        campaignPromptId: null,
        startsAt: null,
        endsAt: null,
        analyticsMeta: {
          segmentation: toCampaignSegmentationPayload(segmentation),
          message: campaignSequence.find(s => s.type === "text")?.text || "",
          image: campaignSequence.find(s => s.type === "image")?.image,
          sequence: campaignSequence,
          dispatchOptions: {
            ...dispatchOptions,
            aiAssisted: hasVariants,
            templateStrategy,
            templateVariantCount: hasVariants ? (campaignSequence.find(s => s.type === "text")?.textVariants?.length || 0) : 0,
          },
        },
      };

      let campaignId = "";
      if (editingCampaignId) {
        const updated = await updateCampaign.mutateAsync({
          id: editingCampaignId,
          ...campaignPayload,
        });
        campaignId = updated.id;
      } else {
        const created = await createCampaign.mutateAsync(campaignPayload);
        campaignId = created.id;
      }

      setSubmittingStatus("Registrando lote na fila de envios...");

      // 2. Register Dispatch Batch Execution
      const token = await getIdToken();
      const scheduledIso = newTriggerType === "scheduled" && newScheduledAt ? campaignLocalDateTimeToUtcIso(newScheduledAt) : null;
      
      const dispatchRes = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/dispatches`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${campaignName.trim()} — Lote Principal`,
          steps: campaignSequence,
          triggerType: newTriggerType,
          scheduledAt: scheduledIso,
          evolutionInstanceId: dispatchOptions.evolutionInstanceId,
        }),
      });
      if (!dispatchRes.ok) throw new Error("Erro ao registrar lote de disparo.");
      const dispatchData = await dispatchRes.json();
      const dispatchId = dispatchData.dispatch.id;

      // 3. Trigger immediate execution if manual
      if (newTriggerType === "manual") {
        setSubmittingStatus("Disparando lote de envios...");
        await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispatchId}/trigger`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
        toast({ title: "Sucesso!", description: "O lote de disparos foi iniciado com sucesso." });
      } else {
        toast({ title: "Sucesso!", description: "Lote de disparos agendado com sucesso." });
      }

      // Reset form and view queue
      setSelectedFile(null);
      setParsedRows([]);
      setPreviewRows([]);
      setCampaignName("");
      setEditingCampaignId(null);
      setCampaignSequence([createCampaignStep("text", 1)]);
      setNewConsultantName("");
      setNewConsultantLink("");
      setMultiAgendaEnabled(false);
      setNewScheduledAt("");
      setNewTriggerType("manual");

      await Promise.allSettled([refetchCampaigns(), refetchDispatches(), refetchImports(), refetchPending()]);
      setActiveTab("agendamentos");
    } catch (err) {
      toast({
        title: "Erro na operação",
        description: err instanceof Error ? err.message : "Erro desconhecido ao processar lote.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
      setSubmittingStatus(null);
    }
  }

  // Actions for existing dispatches (executions)
  const handleTriggerDispatchBatch = async (dispId: string) => {
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispId}/trigger`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Erro ao iniciar lote.");
      toast({ title: "Lote iniciado", description: "Processamento de envios em andamento." });
      refetchDispatches();
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : "Não foi possível iniciar.", variant: "destructive" });
    }
  };

  const handlePauseDispatchBatch = async (dispId: string) => {
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispId}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ status: "paused" }),
      });
      if (!res.ok) throw new Error("Erro ao pausar lote.");
      toast({ title: "Lote pausado" });
      refetchDispatches();
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : "Não foi possível pausar.", variant: "destructive" });
    }
  };

  const handleDeleteDispatchBatch = async (dispId: string) => {
    if (!confirm("Excluir lote permanentemente do histórico?")) return;
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Erro ao excluir lote.");
      toast({ title: "Lote removido" });
      refetchDispatches();
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : "Não foi possível remover.", variant: "destructive" });
    }
  };

  const handleDownloadFailedCsv = async (disp: CampaignDispatch) => {
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${disp.id}/failed?format=csv`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao gerar CSV.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `falhas-${disp.name.toLowerCase().replace(/\s+/g, "-")}-${disp.id}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "Erro de download", description: "Não foi possível obter o CSV de falhas.", variant: "destructive" });
    }
  };

  const handleEditCampaign = (c: Campaign) => {
    const meta = c.analytics_meta || {};
    const seq = normalizeCampaignSequence(c.analytics_meta);
    setEditingCampaignId(c.id);
    setCampaignName(c.name || "");
    setCampaignLimitPerRun(String(c.limit_per_run || 50));
    setCampaignSequence(seq.length > 0 ? seq : [createCampaignStep("text", 1)]);
    setSelectedImportId(c.import_id || ALL_IMPORTS_VALUE);
    setDispatchOptions(meta.dispatchOptions || defaultDispatchOptions);
    setActiveTab("campanha");
    toast({ title: "Carregado para edição", description: `Edite a campanha "${c.name}" no formulário de Novo Disparo.` });
  };

  const handleDeleteCampaign = async (c: Campaign) => {
    if (!confirm(`Excluir a campanha "${c.name}" e todas as configurações permanentemente?`)) return;
    try {
      await deleteCampaign.mutateAsync(c.id);
      toast({ title: "Campanha excluída com sucesso." });
      refetchCampaigns();
    } catch (err) {
      toast({ title: "Erro", description: err instanceof Error ? err.message : "Erro ao excluir.", variant: "destructive" });
    }
  };

  return (
    <PageShell
      title={title}
      subtitle={subtitle}
      headerRight={headerRight}
      spacing="space-y-6"
      showGlobalClientSelector={!fixedClientId}
    >
      {/* Dynamic Overlay Loader */}
      {isSubmitting && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-md">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
          <h3 className="text-lg font-bold text-white">Processando Operação</h3>
          <p className="text-sm text-slate-400 mt-1">{submittingStatus}</p>
        </div>
      )}

      {/* Tabs Navigation */}
      <div className="w-full flex justify-start rounded-xl border border-slate-200/80 bg-slate-100/50 p-1 dark:border-white/10 dark:bg-white/[0.02]">
        <button
          onClick={() => setActiveTab("campanha")}
          className={cn(
            "rounded-lg px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all",
            activeTab === "campanha" ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <Megaphone className="h-3.5 w-3.5" />
          Novo Disparo
        </button>
        <button
          onClick={() => setActiveTab("enviadas")}
          className={cn(
            "rounded-lg px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all",
            activeTab === "enviadas" ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <History className="h-3.5 w-3.5" />
          Campanhas
        </button>
        <button
          onClick={() => setActiveTab("agendamentos")}
          className={cn(
            "rounded-lg px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all",
            activeTab === "agendamentos" ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <Zap className="h-3.5 w-3.5" />
          Fila de Envios
        </button>
      </div>

      {/* 🚀 TAB 1: NOVO DISPARO (Consolidated Linear Wizard) */}
      {activeTab === "campanha" && (
        <div className="grid gap-6 lg:grid-cols-3 items-start">
          {/* Main Wizard Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* STEP 1: Leads Base configuration */}
            <Card className="border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-white/5 dark:bg-white/[0.02] rounded-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-[10px] text-white">1</span>
                  Base de Leads
                </CardTitle>
                <CardDescription>Carregue a planilha XLSX/CSV com contatos ou selecione uma existente</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-500">Selecionar Planilha</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xls,.xlsx"
                      className="sr-only"
                      onChange={handleFileChange}
                    />
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/20 px-3 hover:bg-indigo-50/50 dark:border-indigo-800/40 dark:bg-indigo-950/10 dark:hover:bg-indigo-950/20 text-xs font-semibold text-indigo-600 dark:text-indigo-400 transition-all"
                    >
                      <Upload className="h-4 w-4" />
                      {selectedFile ? selectedFile.name : "Carregar Planilha (Excel/CSV)"}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-500">Ou use uma importada</label>
                    <Select
                      value={selectedImportId}
                      onValueChange={(val) => {
                        setSelectedImportId(val);
                        setSelectedFile(null);
                        setParsedRows([]);
                        setPreviewRows([]);
                      }}
                    >
                      <SelectTrigger className="h-12 rounded-xl">
                        <SelectValue placeholder="Selecione uma base existente..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL_IMPORTS_VALUE}>Todas as bases importadas</SelectItem>
                        {imports.map((imp) => (
                          <SelectItem key={imp.id} value={imp.id}>
                            {imp.source_name} ({imp.imported_rows} leads)
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Simplified preview of uploaded leads */}
                {parsedRows.length > 0 && (
                  <div className="rounded-xl border border-slate-200/60 bg-slate-50/40 p-4 dark:border-white/5 dark:bg-slate-900/10 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex gap-4">
                        <div>
                          <p className="text-[10px] uppercase font-bold text-slate-400">Total Leads</p>
                          <p className="text-base font-bold text-slate-700 dark:text-slate-200">{parsedLeadsStats.total}</p>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase font-bold text-emerald-500">WhatsApp Válidos</p>
                          <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">{parsedLeadsStats.valid}</p>
                        </div>
                        {parsedLeadsStats.invalid > 0 && (
                          <div>
                            <p className="text-[10px] uppercase font-bold text-rose-500">Formatos Inválidos</p>
                            <p className="text-base font-bold text-rose-600 dark:text-rose-400">{parsedLeadsStats.invalid}</p>
                          </div>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPreviewOpen(!previewOpen)}
                        className="text-xs h-7 text-indigo-500 hover:text-indigo-600"
                      >
                        {previewOpen ? "Esconder Tabela" : "Ver Contatos"}
                      </Button>
                    </div>

                    {previewOpen && (
                      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-white/5 dark:bg-black/30">
                        <Table className="text-[11px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead className="h-8 py-0">Nome</TableHead>
                              <TableHead className="h-8 py-0">Telefone</TableHead>
                              <TableHead className="h-8 py-0">Outras Colunas</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {previewRows.map((row, idx) => (
                              <TableRow key={idx}>
                                <TableCell className="h-8 py-0.5 font-medium">{getLeadField(row, ["nome", "name"]) || "Sem nome"}</TableCell>
                                <TableCell className="h-8 py-0.5 font-mono">{getLeadField(row, ["telefone", "phone", "number"]) || "—"}</TableCell>
                                <TableCell className="h-8 py-0.5 text-muted-foreground truncate max-w-[120px]">
                                  {Object.keys(row).filter(k => !["nome", "name", "telefone", "phone"].includes(k.toLowerCase())).map(k => `${k}: ${row[k]}`).join(", ") || "—"}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* STEP 2: Sequence visual timeline & buttons */}
            <Card className="border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-white/5 dark:bg-white/[0.02] rounded-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-[10px] text-white">2</span>
                  Timeline de Envio
                </CardTitle>
                <CardDescription>Escreva a mensagem. Adicione mais passos de texto ou imagem para criar uma sequência</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <input ref={sequenceImageInputRef} type="file" accept="image/*" className="sr-only" onChange={handleSequenceImageChange} />

                {/* Vertical Step cards */}
                <div className="space-y-4 relative border-l border-slate-200/80 dark:border-white/10 ml-3.5 pl-5">
                  {campaignSequence.map((step, index) => (
                    <div key={step.id} className="relative space-y-3 rounded-xl border border-slate-200/80 bg-white/70 p-4 dark:border-white/5 dark:bg-black/35 shadow-sm">
                      {/* Left icon marker */}
                      <span className="absolute -left-[30px] top-4 flex h-5 w-5 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-800 font-mono text-[9px] font-bold text-slate-500">
                        {step.order}
                      </span>

                      <div className="flex items-center justify-between gap-2">
                        <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider">
                          Passo {step.order} — {step.type === "image" ? "Imagem" : "Texto"}
                        </Badge>
                        <div className="flex items-center gap-1.5">
                          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => moveCampaignStep(step.id, -1)} disabled={index === 0}>
                            <ArrowUp className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => moveCampaignStep(step.id, 1)} disabled={index === campaignSequence.length - 1}>
                            <ArrowDown className="h-3.5 w-3.5" />
                          </Button>
                          <Button type="button" variant="ghost" size="sm" className="h-7 w-7 p-0 text-rose-500" onClick={() => removeCampaignStep(step.id)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>

                      {/* Message editor */}
                      <div className="space-y-2">
                        <Textarea
                          placeholder={step.type === "image" ? "Legenda opcional para a imagem" : "Olá {{nome}}, tudo bem? Escreva a mensagem de envio..."}
                          className="min-h-[96px] text-xs font-sans"
                          value={step.text}
                          onChange={(e) => updateCampaignStep(step.id, { text: e.target.value })}
                        />

                        {/* Variables helper */}
                        <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                          <span>Variáveis:</span>
                          <button type="button" onClick={() => updateCampaignStep(step.id, { text: step.text + " {{nome}}" })} className="rounded-full bg-slate-100 hover:bg-slate-200 px-2 py-0.5 dark:bg-slate-800 dark:hover:bg-slate-700">{"{{nome}}"}</button>
                          <button type="button" onClick={() => updateCampaignStep(step.id, { text: step.text + " {{telefone}}" })} className="rounded-full bg-slate-100 hover:bg-slate-200 px-2 py-0.5 dark:bg-slate-800 dark:hover:bg-slate-700">{"{{telefone}}"}</button>
                          <button type="button" onClick={() => updateCampaignStep(step.id, { text: step.text + " {{scheduling_link}}" })} className="rounded-full bg-slate-100 hover:bg-slate-200 px-2 py-0.5 dark:bg-slate-800 dark:hover:bg-slate-700">{"{{scheduling_link}}"}</button>
                        </div>
                      </div>

                      {/* Image selector */}
                      {step.type === "image" && (
                        <div className="space-y-2">
                          {step.image ? (
                            <div className="flex items-center gap-3 rounded-lg border border-slate-200/80 bg-slate-50 p-2 dark:border-white/5 dark:bg-slate-900/40">
                              <img src={step.image.dataUrl} alt={step.image.name} className="h-12 w-12 rounded object-cover" />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{step.image.name}</p>
                                <p className="text-[10px] text-slate-500">{Math.round(step.image.size / 1024)} KB</p>
                              </div>
                              <Button type="button" variant="ghost" size="sm" onClick={() => updateCampaignStep(step.id, { image: null })} className="text-xs text-rose-500 h-8">Remover</Button>
                            </div>
                          ) : (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full justify-center gap-1.5 h-9"
                              onClick={() => {
                                setSelectedImageStepId(step.id);
                                sequenceImageInputRef.current?.click();
                              }}
                            >
                              <ImagePlus className="h-4 w-4" />
                              Carregar Imagem do Computador
                            </Button>
                          )}
                        </div>
                      )}

                      {/* AI Variations inline trigger */}
                      {step.type === "text" && (
                        <div className="border-t border-slate-100 dark:border-white/5 pt-2 space-y-2">
                          <div className="flex items-center justify-between">
                            <button
                              type="button"
                              disabled={generateTemplateVariants.isPending}
                              onClick={() => handleGenerateStepVariants(step.id, step.text)}
                              className="text-[11px] font-bold text-violet-500 hover:text-violet-600 flex items-center gap-1 bg-violet-50 dark:bg-violet-950/20 px-2 py-1 rounded-md"
                            >
                              <Sparkles className="h-3.5 w-3.5" />
                              {generateTemplateVariants.isPending ? "Processando..." : "🤖 Gerar Variações Humanizadas (Evitar Spam)"}
                            </button>
                          </div>

                          {step.textVariants && step.textVariants.length > 0 && (
                            <div className="rounded-lg border border-violet-100 bg-violet-50/20 p-2.5 dark:border-violet-900/10 dark:bg-violet-950/5 space-y-2">
                              <p className="text-[10px] font-bold text-violet-600 dark:text-violet-400">Variações Alternativas Ativas:</p>
                              <div className="grid gap-1.5">
                                {step.textVariants.map((variant, vIdx) => (
                                  <textarea
                                    key={vIdx}
                                    value={variant}
                                    onChange={(e) => {
                                      const updatedVariants = [...(step.textVariants || [])];
                                      updatedVariants[vIdx] = e.target.value;
                                      updateCampaignStep(step.id, { textVariants: updatedVariants });
                                    }}
                                    className="w-full rounded border border-slate-200 bg-white/80 p-2 text-[10px] dark:border-white/5 dark:bg-black/30 font-sans min-h-[44px] resize-y"
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* WhatsApp Actions buttons */}
                      {step.type === "text" && (
                        <div className="border-t border-slate-100 dark:border-white/5 pt-2 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-slate-500">Botões de Ação do WhatsApp (Max 3)</span>
                            <button
                              type="button"
                              onClick={() => handleAddStepButton(step.id)}
                              className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 flex items-center gap-1"
                            >
                              <Plus className="h-3 w-3" /> Adicionar Botão
                            </button>
                          </div>

                          {step.buttons && step.buttons.length > 0 && (
                            <div className="grid gap-2 pt-1">
                              {step.buttons.map((btn, btnIdx) => (
                                <div key={btnIdx} className="flex gap-2 items-center bg-slate-50 dark:bg-slate-900/40 p-2 rounded-lg border border-slate-200/60 dark:border-white/5">
                                  <Input
                                    value={btn.displayText}
                                    placeholder="Nome do Botão (Ex: Agendar)"
                                    className="h-8 text-[11px] max-w-[120px]"
                                    onChange={(e) => handleUpdateStepButton(step.id, btnIdx, { displayText: e.target.value })}
                                  />
                                  <Select
                                    value={btn.type}
                                    onValueChange={(val) => handleUpdateStepButton(step.id, btnIdx, { type: val as "url" | "reply" })}
                                  >
                                    <SelectTrigger className="h-8 text-[11px] max-w-[100px]">
                                      <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="url">Link / URL</SelectItem>
                                      <SelectItem value="reply">Resposta Rápida</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {btn.type === "url" && (
                                    <Input
                                      value={btn.url || ""}
                                      placeholder="Link (Ex: {{scheduling_link}})"
                                      className="h-8 text-[11px] flex-1 font-mono"
                                      onChange={(e) => handleUpdateStepButton(step.id, btnIdx, { url: e.target.value })}
                                    />
                                  )}
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => handleRemoveStepButton(step.id, btnIdx)}
                                    className="h-8 w-8 p-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 pt-2">
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => addCampaignStep("text")}>
                    <Plus className="h-3.5 w-3.5" /> Envio de Texto
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="h-8 text-xs gap-1" onClick={() => addCampaignStep("image")}>
                    <Plus className="h-3.5 w-3.5" /> Envio de Imagem
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* STEP 3: Dispatch & Scheduling parameters */}
            <Card className="border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-white/5 dark:bg-white/[0.02] rounded-2xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-[10px] text-white">3</span>
                  Configurações de Disparo
                </CardTitle>
                <CardDescription>Defina a instância do WhatsApp, revezamento de agendas e data de envio</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Instância WhatsApp</p>
                    <Select
                      value={dispatchOptions.evolutionInstanceId || "company-default"}
                      onValueChange={(val) => setDispatchOptions(curr => ({ ...curr, evolutionInstanceId: val === "company-default" ? null : val }))}
                    >
                      <SelectTrigger className="h-10 rounded-xl text-xs">
                        <SelectValue placeholder="Selecione a instância..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="company-default">Padrão da Empresa</SelectItem>
                        {evolutionInstanceOptions.map((inst) => (
                          <SelectItem key={inst.id} value={inst.id}>
                            {inst.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground flex items-center gap-1">
                      Atraso entre envios (segundos)
                      <InfoTip text="Tempo de espera sugerido entre contatos para evitar bans no WhatsApp." />
                    </p>
                    <Input
                      type="number"
                      min="1"
                      className="h-10 text-xs rounded-xl"
                      value={dispatchOptions.leadDelaySeconds}
                      onChange={(e) => setDispatchOptions(curr => ({ ...curr, leadDelaySeconds: Math.max(1, Number(e.target.value)) }))}
                    />
                  </div>
                </div>

                {/* Round-Robin Calendly/Agenda Integration */}
                <div className="rounded-xl border border-indigo-100 bg-indigo-50/20 p-4 dark:border-indigo-950 dark:bg-indigo-950/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                        Agendamento Integrado (Multi-Agenda)
                        <InfoTip text="Distribua leads entre links individuais dos consultores da equipe de vendas usando revezamento justo (Round-Robin)." />
                      </p>
                      <p className="text-[10px] text-muted-foreground">Substitui {"{{scheduling_link}}"} na mensagem de cada lead enviado</p>
                    </div>
                    <Switch checked={multiAgendaEnabled} onCheckedChange={setMultiAgendaEnabled} />
                  </div>

                  {multiAgendaEnabled && (
                    <div className="space-y-4 animate-fadeIn">
                      {/* List of consultants */}
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-slate-500">Equipe de Agendas Cadastradas</label>
                        {consultants.length === 0 ? (
                          <p className="text-xs text-muted-foreground italic bg-white/50 dark:bg-black/20 p-3 rounded-xl border border-slate-200/50 dark:border-white/5">Nenhum consultor cadastrado para Rotação. Adicione um abaixo.</p>
                        ) : (
                          <div className="grid gap-2 max-h-[220px] overflow-y-auto pr-1">
                            {consultants.map((c) => (
                              <div key={c.id} className="flex items-center justify-between bg-white dark:bg-black/35 p-2.5 rounded-xl border border-slate-200/80 dark:border-white/5 text-xs shadow-sm">
                                <div className="min-w-0 flex-1 pr-2">
                                  <p className="font-bold text-slate-800 dark:text-slate-200 truncate">{c.name}</p>
                                  <p className="text-[10px] text-muted-foreground truncate font-mono">{c.scheduling_link}</p>
                                </div>
                                <div className="flex items-center gap-3">
                                  <Switch
                                    checked={c.active}
                                    onCheckedChange={(checked) => {
                                      updateConsultant.mutate({ id: c.id, clientId: activeClientId, active: checked });
                                    }}
                                  />
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() => deleteConsultant.mutate({ id: c.id, clientId: activeClientId })}
                                    className="h-8 w-8 p-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-lg"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Add new consultant form */}
                      <div className="border-t border-indigo-100/50 dark:border-white/5 pt-3 space-y-3">
                        <p className="text-[10px] uppercase font-bold text-slate-500">Cadastrar Novo Consultor na Base</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Input
                            placeholder="Nome do Consultor"
                            value={newConsultantName}
                            onChange={e => setNewConsultantName(e.target.value)}
                            className="h-9 text-xs rounded-xl"
                          />
                          <Input
                            placeholder="Link da Agenda (Ex: https://calendly.com/...)"
                            value={newConsultantLink}
                            onChange={e => setNewConsultantLink(e.target.value)}
                            className="h-9 text-xs font-mono rounded-xl"
                          />
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          onClick={handleCreateConsultant}
                          disabled={createConsultant.isPending}
                          className="w-full h-9 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-sm"
                        >
                          <Plus className="h-4 w-4 mr-1" /> {createConsultant.isPending ? "Salvando..." : "Salvar na Base"}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Trigger Types */}
                <div className="space-y-3 border-t border-slate-100 dark:border-white/5 pt-4">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Momento do disparo</p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setNewTriggerType("manual")}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-semibold transition-colors",
                        newTriggerType === "manual"
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                      )}
                    >
                      <Play className="h-4 w-4" />
                      Disparar Imediatamente
                      <span className="font-normal text-[10px] opacity-70">Executar após a criação</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewTriggerType("scheduled")}
                      className={cn(
                        "flex flex-col items-center gap-1.5 rounded-xl border p-3 text-xs font-semibold transition-colors",
                        newTriggerType === "scheduled"
                          ? "border-sky-400/40 bg-sky-400/10 text-sky-300"
                          : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground"
                      )}
                    >
                      <Clock3 className="h-4 w-4" />
                      Disparo Agendado
                      <span className="font-normal text-[10px] opacity-70">Definir data e hora do lote</span>
                    </button>
                  </div>

                  {newTriggerType === "scheduled" && (
                    <div className="space-y-1.5 animate-fadeIn">
                      <label className="text-[10px] font-bold text-slate-500 uppercase">Data e Hora do Agendamento</label>
                      <Input
                        type="datetime-local"
                        value={newScheduledAt}
                        onChange={(e) => setNewScheduledAt(e.target.value)}
                        className="h-10 text-xs rounded-xl"
                      />
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <Button
                    onClick={handleCreateAndDispatch}
                    disabled={isSubmitting}
                    className="w-full h-11 text-xs font-bold gap-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow"
                  >
                    <Zap className="h-4 w-4" />
                    {editingCampaignId ? "Salvar Alterações de Campanha" : (newTriggerType === "manual" ? "Salvar e Disparar Lote Agora" : "Salvar e Agendar Disparo")}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Interactive Phone Mockup Preview Panel (Right Side) */}
          <div className="lg:col-span-1 sticky top-6">
            <Card className="border-slate-200/80 bg-slate-900 shadow-[0_20px_50px_rgba(15,23,42,0.12)] rounded-3xl overflow-hidden text-slate-100">
              <CardHeader className="bg-slate-950/70 border-b border-white/5 py-4">
                <CardTitle className="text-xs uppercase font-bold tracking-wider text-slate-400">Simulador de WhatsApp</CardTitle>
              </CardHeader>
              <CardContent className="p-4 bg-slate-900/60 min-h-[440px] flex flex-col justify-between">
                {/* Chat window mockup */}
                <div className="space-y-4 flex-1">
                  {campaignSequence.filter(s => s.enabled).map((step, idx) => {
                    const sampleText = step.text || "(Escreva a mensagem no formulário...)";
                    const resolvedText = sampleText
                      .replace(/\{\{\s*nome\s*\}\}/gi, "Maria Silva")
                      .replace(/\{\{\s*telefone\s*\}\}/gi, "5511999999999")
                      .replace(/\{\{\s*scheduling_link\s*\}\}/gi, multiAgendaEnabled ? "https://calendly.com/consultor" : "(Link da Agenda)");

                    return (
                      <div key={idx} className="flex flex-col items-start gap-1 max-w-[85%] animate-fadeIn">
                        <div className="rounded-2xl rounded-tl-none bg-slate-800 border border-white/5 p-3 text-xs shadow space-y-2 text-slate-200">
                          {/* Image preview inside simulated balloon */}
                          {step.type === "image" && (
                            <div className="rounded-lg overflow-hidden border border-white/10 bg-slate-950/40">
                              {step.image ? (
                                <img src={step.image.dataUrl} alt="Preview" className="w-full max-h-[140px] object-cover" />
                              ) : (
                                <div className="h-28 w-full flex items-center justify-center text-slate-600 bg-slate-900"><ImagePlus className="h-6 w-6" /></div>
                              )}
                            </div>
                          )}

                          <p className="whitespace-pre-wrap leading-relaxed">{resolvedText}</p>
                        </div>

                        {/* Interactive WhatsApp buttons mockup */}
                        {step.type === "text" && step.buttons && step.buttons.length > 0 && (
                          <div className="grid gap-1 w-full pl-2 mt-1">
                            {step.buttons.map((btn, bIdx) => (
                              <div
                                key={bIdx}
                                className="w-full bg-slate-800 hover:bg-slate-700/80 border border-white/5 text-center text-[10px] font-bold text-indigo-400 py-1.5 rounded-xl shadow-sm cursor-pointer"
                              >
                                🔗 {btn.displayText}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-white/5 pt-3 mt-4 text-[10px] text-slate-500 text-center">
                  * Visualização simplificada das variáveis de lead.
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* 📋 TAB 2: CAMPANHAS CRIADAS (Clean table list) */}
      {activeTab === "enviadas" && (
        <Card className="border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.04] rounded-2xl">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold">Campanhas Configuradas</CardTitle>
              <CardDescription>Clique para editar as mensagens ou excluir as réguas</CardDescription>
            </div>
            <input
              className="h-9 w-44 rounded-xl border border-slate-200 bg-white px-3 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-white/10 dark:bg-white/[0.05]"
              placeholder="Buscar campanha..."
              onChange={(e) => {
                // local filter or query triggers could go here
              }}
            />
          </CardHeader>
          <CardContent className="p-0">
            {loadingCampaigns ? (
              <div className="p-6 text-center text-xs text-muted-foreground animate-pulse">Carregando dados das campanhas...</div>
            ) : campaigns.length === 0 ? (
              <div className="p-8">
                <EmptyState title="Nenhuma campanha encontrada" description="Use o Novo Disparo para registrar a primeira campanha por planilha." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200/60 dark:border-white/5">
                      <TableHead className="px-6 py-4 text-xs font-semibold uppercase font-display">Campanha</TableHead>
                      <TableHead className="px-4 py-4 text-xs font-semibold uppercase font-display text-center">Modo</TableHead>
                      <TableHead className="px-4 py-4 text-xs font-semibold uppercase font-display text-center">Leads por Lote</TableHead>
                      <TableHead className="px-4 py-4 text-xs font-semibold uppercase font-display">Criada Em</TableHead>
                      <TableHead className="px-6 py-4 text-xs font-semibold uppercase font-display text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {campaigns.map((c) => (
                      <TableRow key={c.id} className="border-slate-200/60 hover:bg-slate-50/50 dark:border-white/5 dark:hover:bg-white/[0.01]">
                        <TableCell className="px-6 py-4">
                          <p className="text-sm font-bold text-foreground">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.client_name ?? "Empresa padrão"} · {c.import_id ? "Base importada" : "Geral"}</p>
                        </TableCell>
                        <TableCell className="px-4 py-4 text-center">
                          <span className={cn("inline-block rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase", c.mode === "agente" ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-border/50 text-slate-500")}>
                            {c.mode === "agente" ? "Agente IA" : "Disparo Direto"}
                          </span>
                        </TableCell>
                        <TableCell className="px-4 py-4 text-center text-sm font-semibold">{c.limit_per_run}</TableCell>
                        <TableCell className="px-4 py-4 text-xs text-muted-foreground">{formatDateTime(c.created_at)}</TableCell>
                        <TableCell className="px-6 py-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0" title="Editar" onClick={() => handleEditCampaign(c)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="outline" className="h-8 w-8 p-0 text-rose-500 border-rose-200/40 hover:bg-rose-50 dark:hover:bg-rose-950/20" title="Excluir" onClick={() => void handleDeleteCampaign(c)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ⚡ TAB 3: FILA DE ENVIOS (Cross-campaign dispatch executions) */}
      {activeTab === "agendamentos" && (
        <Card className="border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.04] rounded-2xl">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold">Fila de Disparos em Massa</CardTitle>
              <CardDescription>Acompanhe e gerencie lotes de disparos criados por planilha diretamente</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => {
                refetchDispatches();
                toast({ title: "Fila atualizada" });
              }}
            >
              <RefreshCw className="h-3 w-3 mr-1" /> Atualizar
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            {loadingDispatches ? (
              <div className="p-6 text-center text-xs text-muted-foreground animate-pulse">Carregando lotes de disparo...</div>
            ) : dispatches.length === 0 ? (
              <div className="p-8">
                <EmptyState title="Nenhum lote de disparo" description="Crie um disparo para enfileirar as execuções de envio em massa." />
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="border-slate-200/60 dark:border-white/5">
                      <TableHead className="px-6 py-4 text-xs font-semibold uppercase font-display">Lote / Origem</TableHead>
                      <TableHead className="px-4 py-4 text-xs font-semibold uppercase font-display text-center">Status</TableHead>
                      <TableHead className="px-4 py-4 text-xs font-semibold uppercase font-display text-center">Progresso</TableHead>
                      <TableHead className="px-4 py-4 text-xs font-semibold uppercase font-display">Criado / Agendado</TableHead>
                      <TableHead className="px-6 py-4 text-xs font-semibold uppercase font-display text-right">Ações</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dispatches.map((disp) => {
                      const total = (disp.sent_count ?? 0) + (disp.failed_count ?? 0);
                      return (
                        <TableRow key={disp.id} className="border-slate-200/60 hover:bg-slate-50/50 dark:border-white/5 dark:hover:bg-white/[0.01]">
                          <TableCell className="px-6 py-4">
                            <p className="text-sm font-bold text-foreground">{disp.name}</p>
                            <p className="text-xs text-muted-foreground">Campanha: {(disp as any).campaign_name || "Planilha"}</p>
                          </TableCell>
                          <TableCell className="px-4 py-4 text-center">
                            <Badge className={cn("border text-[10px] font-semibold rounded-xl px-2 py-0.5", CAMPAIGN_STATUS_COLORS[disp.status] || "")}>
                              {CAMPAIGN_STATUS_LABELS[disp.status] || disp.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="px-4 py-4">
                            <div className="flex flex-col items-center justify-center gap-1 w-28 mx-auto">
                              <div className="flex items-center justify-between text-[10px] font-bold w-full">
                                <span className="text-emerald-500">{disp.sent_count} ✓</span>
                                <span className="text-rose-500">{disp.failed_count} ✗</span>
                              </div>
                              {total > 0 && (
                                <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden">
                                  <div
                                    className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                                    style={{ width: `${Math.round((disp.sent_count / total) * 100)}%` }}
                                  />
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="px-4 py-4 text-xs text-muted-foreground">
                            {formatDateTime(disp.triggered_at || disp.created_at)}
                          </TableCell>
                          <TableCell className="px-6 py-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              {disp.status === "draft" && (
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => handleTriggerDispatchBatch(disp.id)}
                                  className="h-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs px-2.5 font-bold shadow-sm"
                                >
                                  <Play className="h-3.5 w-3.5 mr-1" /> Iniciar
                                </Button>
                              )}
                              {disp.status === "running" && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => handlePauseDispatchBatch(disp.id)}
                                  className="h-8 border-amber-200 text-amber-600 hover:bg-amber-50 dark:border-amber-900/40 dark:text-amber-400 rounded-xl text-xs px-2.5 font-bold"
                                >
                                  <Pause className="h-3.5 w-3.5 mr-1" /> Pausar
                                </Button>
                              )}
                              {disp.failed_count > 0 && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  title="Baixar Relatório de Falhas"
                                  onClick={() => handleDownloadFailedCsv(disp)}
                                  className="h-8 w-8 p-0 rounded-xl"
                                >
                                  <Download className="h-3.5 w-3.5 text-slate-700 dark:text-white/80" />
                                </Button>
                              )}
                              {(disp.status === "draft" || disp.status === "failed" || disp.status === "done") && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  title="Excluir Lote"
                                  onClick={() => handleDeleteDispatchBatch(disp.id)}
                                  className="h-8 w-8 p-0 text-rose-500 border-rose-200/40 hover:bg-rose-50 rounded-xl"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </PageShell>
  );
}
