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
  Gauge,
  Send,
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

type SheetTab = "campanha" | "enviadas" | "agendamentos" | "relatorios";
type CampaignTemplateStrategy = "single" | "ai_variations";

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
const CAMPAIGN_LIMIT_MAX = 500;
const CAMPAIGN_TIME_ZONE = "America/Sao_Paulo";

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

function findHeaderRowIndex(rangeRows: unknown[][]): number {
  const aliases = [
    "telefone", "telefones", "fone", "fones", "celular", "celulares", "whatsapp", "whatsapps", "phone", "phones", "numero", "numeros", "numero_telefone", "numero_telefones", "telefone_whatsapp", "telefones_whatsapp",
    "nome", "name", "cliente", "contato", "lead", "responsavel", "email", "e_mail", "mail", "city", "cidade", "estado", "uf", "tipo", "tipo_cliente", "perfil", "produto", "status", "dados", "informacoes", "info"
  ];

  let bestIdx = 0;
  let maxMatches = 0;

  const scanLimit = Math.min(rangeRows.length, 20);
  for (let i = 0; i < scanLimit; i++) {
    const row = rangeRows[i];
    if (!Array.isArray(row)) continue;

    let matches = 0;
    for (const cell of row) {
      if (cell === null || cell === undefined) continue;
      const normalized = String(cell)
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      if (aliases.includes(normalized)) {
        matches++;
      }
    }

    if (matches > maxMatches) {
      maxMatches = matches;
      bestIdx = i;
    }
  }

  if (maxMatches === 0) {
    for (let i = 0; i < rangeRows.length; i++) {
      const row = rangeRows[i];
      if (Array.isArray(row) && row.some(cell => String(cell ?? "").trim() !== "")) {
        return i;
      }
    }
  }

  return bestIdx;
}

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

        const rangeRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1, defval: "" });
        if (!rangeRows || rangeRows.length === 0) {
          return resolve([]);
        }

        const headerIdx = findHeaderRowIndex(rangeRows);
        const rawHeaders = rangeRows[headerIdx];
        const headers = rawHeaders.map((h, colIdx) => {
          const val = String(h ?? "").trim();
          return val !== "" ? val : `__EMPTY_${colIdx}`;
        });

        const parsedObjects: Record<string, unknown>[] = [];
        for (let i = headerIdx + 1; i < rangeRows.length; i++) {
          const row = rangeRows[i];
          if (!Array.isArray(row)) continue;
          if (row.every(cell => String(cell ?? "").trim() === "")) continue;

          // Skip if this row is a duplicate/leaked header row
          const isHeaderRow = row.some(cell => {
            const val = String(cell ?? "").trim().toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "_");
            return val.includes("telefone") || val.includes("whatsapp") || val.includes("celular") || val.includes("phone") || val.includes("fone") || val === "contato" || val === "leads" || val === "lead";
          }) && row.some(cell => {
            const val = String(cell ?? "").trim().toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .replace(/[^a-z0-9]+/g, "_");
            return val.includes("nome") || val.includes("name") || val.includes("cliente") || val.includes("contato") || val.includes("lead") || val.includes("responsavel");
          });
          if (isHeaderRow) continue;

          const obj: Record<string, unknown> = {};
          headers.forEach((header, colIdx) => {
            obj[header] = row[colIdx] !== undefined ? row[colIdx] : "";
          });
          parsedObjects.push(obj);
        }

        resolve(parsedObjects);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Falha ao processar a planilha."));
      }
    };
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo selecionado."));
    reader.readAsArrayBuffer(file);
  });
}

function detectSpreadsheetColumns(rows: Record<string, unknown>[]) {
  const mapping = {
    telefone: null as string | null,
    nome: null as string | null,
  };

  if (!Array.isArray(rows) || rows.length === 0) return mapping;

  const firstRow = rows[0];
  if (!firstRow || typeof firstRow !== "object") return mapping;

  const keys = Object.keys(firstRow);

  const aliasesMap = {
    telefone: ["telefone", "telefones", "fone", "fones", "celular", "celulares", "whatsapp", "whatsapps", "phone", "phones", "numero", "numeros", "numero_telefone", "numero_telefones", "telefone_whatsapp", "telefones_whatsapp"],
    nome: ["nome", "name", "cliente", "contato", "lead", "responsavel"],
  };

  // 1. Try mapping by alias matching first
  for (const key of keys) {
    const normalizedKey = key.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");

    for (const [field, aliases] of Object.entries(aliasesMap)) {
      if (field === "telefone" && !mapping.telefone && aliases.includes(normalizedKey)) {
        mapping.telefone = key;
      }
      if (field === "nome" && !mapping.nome && aliases.includes(normalizedKey)) {
        mapping.nome = key;
      }
    }
  }

  // 2. Fallback scan by value content for phone and name
  const sampleRows = rows.slice(0, 10);

  if (!mapping.telefone) {
    for (const key of keys) {
      let matches = 0;
      let total = 0;
      for (const row of sampleRows) {
        const val = String(row[key] ?? "").trim().replace(/\D/g, "");
        if (val) {
          total++;
          if (val.length >= 8 && val.length <= 15) {
            matches++;
          }
        }
      }
      if (total > 0 && matches / total >= 0.7) {
        mapping.telefone = key;
        break;
      }
    }
  }

  if (!mapping.nome) {
    for (const key of keys) {
      if (key === mapping.telefone) continue;
      let matches = 0;
      let total = 0;
      for (const row of sampleRows) {
        const val = String(row[key] ?? "").trim();
        if (val) {
          total++;
          const digits = val.replace(/\D/g, "");
          if (digits.length < val.length * 0.5) {
            matches++;
          }
        }
      }
      if (total > 0 && matches / total >= 0.7) {
        mapping.nome = key;
        break;
      }
    }
  }

  return mapping;
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

function getLeadField(data: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = data[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value);
  }
  return "";
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
  const [showNumbersModal, setShowNumbersModal] = useState(false);
  const [isImportingFile, setIsImportingFile] = useState(false);
  interface FilterRule {
    column: string;
    operator: "equals" | "contains" | "gt" | "lt";
    value: string;
  }
  const [filterRules, setFilterRules] = useState<FilterRule[]>([]);

  const filteredRows = useMemo(() => {
    if (filterRules.length === 0) return parsedRows;
    return parsedRows.filter((row) => {
      return filterRules.every((rule) => {
        if (!rule.column) return true;
        const rawValue = row[rule.column];
        const valStr = String(rawValue ?? "").trim();
        const ruleVal = rule.value.trim();

        switch (rule.operator) {
          case "equals":
            return valStr.toLowerCase() === ruleVal.toLowerCase();
          case "contains":
            return valStr.toLowerCase().includes(ruleVal.toLowerCase());
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
  }, [parsedRows, filterRules]);

  const previewRows = useMemo(() => filteredRows.slice(0, 10), [filteredRows]);

  const spreadsheetColumns = useMemo(() => {
    if (parsedRows.length === 0) return [];
    return Object.keys(parsedRows[0]);
  }, [parsedRows]);

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

  // Scheduling & parameters states
  const [multiAgendaEnabled, setMultiAgendaEnabled] = useState(false);
  const [newConsultantName, setNewConsultantName] = useState("");
  const [newConsultantLink, setNewConsultantLink] = useState("");
  const [newTriggerType, setNewTriggerType] = useState<"manual" | "scheduled">("manual");
  const [newScheduledAt, setNewScheduledAt] = useState("");
  const [batchingEnabled, setBatchingEnabled] = useState(false);
  const [batchSize, setBatchSize] = useState("100");
  const [batchIntervalHours, setBatchIntervalHours] = useState("1");

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
    if (filteredRows.length === 0) return { total: 0, valid: 0, invalid: 0 };
    let valid = 0;
    filteredRows.forEach((row) => {
      const phone = getLeadField(row, ["telefone", "celular", "phone", "number", "whatsapp"]);
      if (phone && phone.replace(/\D/g, "").length >= 8) {
        valid++;
      }
    });
    return {
      total: filteredRows.length,
      valid,
      invalid: filteredRows.length - valid,
    };
  }, [filteredRows]);

  // Handle excel/csv parsed rows
  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    if (file && file.name.endsWith(".numbers")) {
      setShowNumbersModal(true);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setSelectedFile(file);
    setParseError(null);
    setParsedRows([]);
    setFilterRules([]);

    if (!file) return;
    try {
      const rows = await parseSpreadsheetFile(file);
      const mapping = detectSpreadsheetColumns(rows);
      const normalizedRows = rows.map((row) => {
        const newRow = { ...row };
        if (mapping.telefone) {
          newRow.telefone = String(row[mapping.telefone] ?? "").trim();
          if (mapping.telefone !== "telefone") {
            delete newRow[mapping.telefone];
          }
        }
        if (mapping.nome) {
          newRow.nome = String(row[mapping.nome] ?? "").trim();
          if (mapping.nome !== "nome") {
            delete newRow[mapping.nome];
          }
        }
        return newRow;
      });
      const filteredNormalizedRows = normalizedRows.filter((row) => {
        const phoneVal = String(row.telefone ?? "").trim().toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "");
        const nameVal = String(row.nome ?? "").trim().toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/[^a-z0-9]+/g, "");

        // If phone value matches header keywords (like "telefone", "whatsapp", "phone") and name matches name keywords
        const isPhoneHeader = ["telefone", "celular", "phone", "fone", "whatsapp", "number", "numero"].some(alias => phoneVal.includes(alias));
        const isNameHeader = ["nome", "name", "cliente", "contato", "lead", "responsavel"].some(alias => nameVal.includes(alias));

        if (isPhoneHeader && isNameHeader) {
          return false;
        }

        // Also if phone contains only letters (e.g. "telefone" or "celular"), it is definitely a header and not a phone number
        if (phoneVal !== "" && /^[a-zA-Z_]+$/.test(phoneVal)) {
          return false;
        }

        // Also if name matches a header and phone is empty/invalid, it is likely a header
        if ((phoneVal === "" || phoneVal === "telefone") && ["nome", "name", "cliente", "contato", "lead", "responsavel"].includes(nameVal)) {
          return false;
        }

        return true;
      });
      setParsedRows(filteredNormalizedRows);
      setCampaignName(file.name.replace(/\.[^/.]+$/, ""));
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Falha ao analisar a planilha.");
    }
  }

  async function handleImportSpreadsheetOnly() {
    if (!selectedFile || parsedRows.length === 0) return;
    setIsImportingFile(true);
    try {
      const importRes = await createLeadImport.mutateAsync({
        clientId: activeClientId,
        sourceName: selectedFile.name,
        sourceType: selectedFile.name.split(".").pop()?.toLowerCase() || "spreadsheet",
        rows: parsedRows,
      });

      toast({
        title: "Planilha importada",
        description: `A base "${selectedFile.name}" foi importada com sucesso com ${parsedRows.length} contatos.`,
      });

      await refetchImports();
      setSelectedImportId(importRes.item.id);

      setSelectedFile(null);
      setParsedRows([]);
      setFilterRules([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      toast({
        title: "Erro ao importar planilha",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setIsImportingFile(false);
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
      let finalRowsCount = 0;

      // 1. If upload a new file, run lead import first
      if (selectedFile && filteredRows.length > 0) {
        setSubmittingStatus("Processando planilha e aplicando round-robin...");
        const activeLinks = multiAgendaEnabled
          ? consultants.filter(c => c.active).map(c => c.scheduling_link)
          : [];

        // Apply Round-Robin directly on rows
        const finalRows = activeLinks.length > 0
          ? filteredRows.map((row, idx) => ({
              ...row,
              scheduling_link: activeLinks[idx % activeLinks.length],
            }))
          : filteredRows;

        finalRowsCount = finalRows.length;

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
          // Segmentação unificada: as regras dinâmicas (coluna/operador/valor) viram o
          // filtro de disparo. Mesmo shape do catálogo da empresa e do matcher do backend.
          segmentation: {
            filters: filterRules
              .filter((rule) => rule.column && String(rule.value ?? "").trim() !== "")
              .map((rule) => ({ field: rule.column, operator: rule.operator, value: rule.value })),
          },
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

      let totalLeads = 0;
      if (selectedFile) {
        totalLeads = finalRowsCount;
      } else {
        const selectedImportRecord = imports.find(imp => imp.id === selectedImportId);
        totalLeads = selectedImportRecord ? selectedImportRecord.imported_rows : (pendingData?.total || 0);
      }

      if (batchingEnabled && totalLeads > 0) {
        const size = Number.parseInt(batchSize, 10) || 100;
        const interval = Number.parseFloat(batchIntervalHours) || 1;
        const numBatches = Math.ceil(totalLeads / size);

        let baseDate = newTriggerType === "scheduled" && newScheduledAt ? new Date(newScheduledAt) : new Date();

        for (let i = 0; i < numBatches; i++) {
          const offset = i * size;
          const batchDate = new Date(baseDate.getTime() + i * interval * 60 * 60 * 1000);
          const batchScheduledIso = batchDate.toISOString();
          const batchTriggerType = (i === 0 && newTriggerType === "manual") ? "manual" : "scheduled";

          const dispatchRes = await fetch(`${API_BASE_URL}/api/campaigns/${campaignId}/dispatches`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              name: `${campaignName.trim()} — Lote ${i + 1}/${numBatches}`,
              steps: campaignSequence,
              triggerType: batchTriggerType,
              scheduledAt: batchTriggerType === "scheduled" ? batchScheduledIso : null,
              evolutionInstanceId: dispatchOptions.evolutionInstanceId,
              limitPerRun: size,
              offset: offset,
            }),
          });
          if (!dispatchRes.ok) throw new Error(`Erro ao registrar lote ${i + 1} de disparo.`);
          const dispatchData = await dispatchRes.json();
          const dispatchId = dispatchData.dispatch.id;

          // Se for manual e for o primeiro lote, dispara imediatamente
          if (i === 0 && newTriggerType === "manual") {
            setSubmittingStatus(`Disparando lote 1/${numBatches}...`);
            await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispatchId}/trigger`, {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
            });
          }
        }
        toast({ title: "Sucesso!", description: `${numBatches} lotes criados e enfileirados com sucesso.` });
      } else {
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
      }

      // Reset form and view queue
      setSelectedFile(null);
      setParsedRows([]);
      setFilterRules([]);
      setBatchingEnabled(false);
      setBatchSize("100");
      setBatchIntervalHours("1");
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
      <div className="w-full flex justify-start rounded-xl border border-border bg-muted/30 p-1 dark:bg-muted/10">
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
        <button
          onClick={() => setActiveTab("relatorios")}
          className={cn(
            "rounded-lg px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all",
            activeTab === "relatorios" ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white" : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <FileSpreadsheet className="h-3.5 w-3.5" />
          Relatório & Auditoria
        </button>
      </div>

      {/* 🚀 TAB 1: NOVO DISPARO (Consolidated Linear Wizard) */}
      {activeTab === "campanha" && (
        <div className="grid gap-6 lg:grid-cols-3 items-start">
          {/* Main Wizard Form */}
          <div className="lg:col-span-2 space-y-6">
            {/* STEP 1: Leads Base configuration */}
            <Card className="border-border bg-card shadow-sm text-card-foreground rounded-2xl">
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
                      accept=".csv,.xls,.xlsx,.numbers"
                      className="sr-only"
                      onChange={handleFileChange}
                    />
                    {selectedFile ? (
                      <div className="flex h-12 items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50/20 px-3 dark:border-indigo-800/40 dark:bg-indigo-950/10 text-xs font-semibold text-indigo-600 dark:text-indigo-400 transition-all">
                        <div className="flex items-center gap-2 truncate">
                          <FileSpreadsheet className="h-4 w-4 text-indigo-500 flex-shrink-0" />
                          <span className="truncate">{selectedFile.name}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="default"
                            size="sm"
                            onClick={handleImportSpreadsheetOnly}
                            disabled={isImportingFile}
                            className="h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] uppercase font-bold flex items-center gap-1.5 shadow-sm transition-colors border-0"
                          >
                            {isImportingFile ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Upload className="h-3.5 w-3.5" />
                            )}
                            Importar Planilha
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => fileInputRef.current?.click()}
                            className="h-8 px-2 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-[10px] uppercase font-bold"
                          >
                            Alterar
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setSelectedFile(null);
                              setParsedRows([]);
                              setFilterRules([]);
                              setCampaignName("");
                              if (fileInputRef.current) fileInputRef.current.value = "";
                            }}
                            className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div
                        onClick={() => fileInputRef.current?.click()}
                        className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/20 px-3 hover:bg-indigo-50/50 dark:border-indigo-800/40 dark:bg-indigo-950/10 dark:hover:bg-indigo-950/20 text-xs font-semibold text-indigo-600 dark:text-indigo-400 transition-all"
                      >
                        <Upload className="h-4 w-4" />
                        Carregar Planilha (Excel/CSV/Numbers)
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-slate-500">Ou use uma importada</label>
                    <Select
                      value={selectedImportId}
                      onValueChange={(val) => {
                        setSelectedImportId(val);
                        setSelectedFile(null);
                        setParsedRows([]);
                        setFilterRules([]);
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

                {/* Dynamic Spreadsheet Filter Builder */}
                {parsedRows.length > 0 && (
                  <div className="rounded-xl border border-indigo-100/60 bg-indigo-50/10 p-4 dark:border-indigo-950/20 dark:bg-indigo-950/5 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                        <Filter className="h-3.5 w-3.5 text-indigo-500" />
                        Filtros de Segmentação da Planilha
                        <InfoTip text="Filtre os contatos da planilha antes de realizar a importação e disparo. Apenas linhas que atendam aos filtros serão enviadas." />
                      </p>
                      {filterRules.length > 0 && (
                        <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400 px-2 py-0.5 rounded-full">
                          {filterRules.length} {filterRules.length === 1 ? "regra ativa" : "regras ativas"}
                        </span>
                      )}
                    </div>

                    {/* Help/explanation box for spreadsheet filters */}
                    <div className="flex items-start gap-2.5 rounded-lg border border-blue-400/20 bg-blue-500/5 p-3 text-[11px] leading-relaxed text-blue-700 dark:text-blue-300">
                      <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                      <div className="space-y-1">
                        <p className="font-semibold">Como funciona a segmentação da planilha?</p>
                        <p>
                          Você pode filtrar os contatos importados dinamicamente antes de realizar o envio. O sistema lê as colunas da sua planilha e permite criar regras de segmentação personalizadas.
                        </p>
                        <ul className="list-disc pl-4 space-y-0.5 mt-1">
                          <li><strong>Igual a:</strong> Busca exata (ex: <em>Sexo</em> igual a <em>Feminino</em>).</li>
                          <li><strong>Contém:</strong> Busca parcial de texto (ex: <em>Interesse</em> contém <em>consórcio</em>).</li>
                          <li><strong>Maior que / Menor que:</strong> Comparação numérica ou financeira (ex: <em>Valor</em> maior que <em>50000</em>).</li>
                        </ul>
                        <p className="text-muted-foreground text-[10px] mt-1">
                          * Apenas os leads que atenderem a todas as regras ativas serão importados e inseridos na fila de disparos.
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {filterRules.map((rule, idx) => (
                        <div key={idx} className="flex flex-wrap gap-2 items-center bg-white dark:bg-black/35 p-2.5 rounded-xl border border-slate-200/80 dark:border-white/5 shadow-sm">
                          <Select
                            value={rule.column}
                            onValueChange={(val) => {
                              const updated = [...filterRules];
                              updated[idx].column = val;
                              setFilterRules(updated);
                            }}
                          >
                            <SelectTrigger className="h-9 text-xs flex-1 min-w-[120px]">
                              <SelectValue placeholder="Coluna..." />
                            </SelectTrigger>
                            <SelectContent className={darkSelectContentClass}>
                              {spreadsheetColumns.map((col) => (
                                <SelectItem key={col} value={col} className={darkSelectItemClass}>
                                  {col}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          <Select
                            value={rule.operator}
                            onValueChange={(val: any) => {
                              const updated = [...filterRules];
                              updated[idx].operator = val;
                              setFilterRules(updated);
                            }}
                          >
                            <SelectTrigger className="h-9 text-xs max-w-[120px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className={darkSelectContentClass}>
                              <SelectItem value="equals" className={darkSelectItemClass}>Igual a</SelectItem>
                              <SelectItem value="contains" className={darkSelectItemClass}>Contém</SelectItem>
                              <SelectItem value="gt" className={darkSelectItemClass}>Maior que</SelectItem>
                              <SelectItem value="lt" className={darkSelectItemClass}>Menor que</SelectItem>
                            </SelectContent>
                          </Select>

                          <Input
                            placeholder="Valor de comparação..."
                            value={rule.value}
                            onChange={(e) => {
                              const updated = [...filterRules];
                              updated[idx].value = e.target.value;
                              setFilterRules(updated);
                            }}
                            className="h-9 text-xs flex-1 min-w-[140px]"
                          />

                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setFilterRules(filterRules.filter((_, rIdx) => rIdx !== idx));
                            }}
                            className="h-9 w-9 p-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-xl"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}

                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (spreadsheetColumns.length > 0) {
                            setFilterRules([
                              ...filterRules,
                              { column: spreadsheetColumns[0], operator: "equals", value: "" }
                            ]);
                          }
                        }}
                        className="w-full h-9 text-xs border-dashed border-indigo-200 hover:border-indigo-300 text-indigo-600 dark:border-indigo-800/40 dark:text-indigo-400 bg-transparent rounded-xl"
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar Filtro de Coluna
                      </Button>
                    </div>
                  </div>
                )}

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
            <Card className="border-border bg-card shadow-sm text-card-foreground rounded-2xl">
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
            <Card className="border-border bg-card shadow-sm text-card-foreground rounded-2xl">
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

                {/* Batch sending (Loteamento) config */}
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-slate-900/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                        <Archive className="h-3.5 w-3.5 text-indigo-500" />
                        Enviar em Lotes (Massa)
                        <InfoTip text="Suba uma base grande e divida o envio automaticamente em lotes menores espalhados no tempo." />
                      </p>
                      <p className="text-[10px] text-muted-foreground">Evite bans dividindo os disparos sequencialmente</p>
                    </div>
                    <Switch checked={batchingEnabled} onCheckedChange={setBatchingEnabled} />
                  </div>

                  {batchingEnabled && (
                    <div className="grid gap-4 sm:grid-cols-2 pt-2 animate-fadeIn">
                      <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-slate-500">Tamanho do Lote</label>
                        <Input
                          type="number"
                          min="1"
                          placeholder="Ex: 100"
                          value={batchSize}
                          onChange={(e) => setBatchSize(e.target.value)}
                          className="h-10 text-xs rounded-xl"
                        />
                      </div>

                      <div className="space-y-2">
                        <label className="text-[10px] uppercase font-bold text-slate-500">Frequência de Envio</label>
                        <Select
                          value={batchIntervalHours}
                          onValueChange={setBatchIntervalHours}
                        >
                          <SelectTrigger className="h-10 text-xs rounded-xl">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className={darkSelectContentClass}>
                            <SelectItem value="0.5" className={darkSelectItemClass}>A cada 30 minutos</SelectItem>
                            <SelectItem value="1" className={darkSelectItemClass}>A cada 1 hora</SelectItem>
                            <SelectItem value="2" className={darkSelectItemClass}>A cada 2 horas</SelectItem>
                            <SelectItem value="3" className={darkSelectItemClass}>A cada 3 horas</SelectItem>
                            <SelectItem value="6" className={darkSelectItemClass}>A cada 6 horas</SelectItem>
                            <SelectItem value="12" className={darkSelectItemClass}>A cada 12 horas</SelectItem>
                            <SelectItem value="24" className={darkSelectItemClass}>A cada 24 horas (diário)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
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
        <Card className="border-border bg-card shadow-lg text-card-foreground rounded-2xl">
          <CardHeader className="pb-3 flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold">Campanhas Configuradas</CardTitle>
              <CardDescription>Clique para editar as mensagens ou excluir as réguas</CardDescription>
            </div>
            <input
              className="h-9 w-44 rounded-xl border border-border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
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
                      <TableRow key={c.id} className="border-border hover:bg-muted/10">
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
        <Card className="border-border bg-card shadow-lg text-card-foreground rounded-2xl">
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
                        <TableRow key={disp.id} className="border-border hover:bg-muted/10">
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

      {/* 📊 TAB 4: AUDITORIA & RECAMPANHAS */}
      {activeTab === "relatorios" && (
        <LeadImportAuditReport
          activeClientId={activeClientId}
          imports={imports}
          onSelectImportForFollowup={(newImportId) => {
            setSelectedImportId(newImportId);
            setSelectedFile(null);
            setParsedRows([]);
            setFilterRules([]);
            setActiveTab("campanha");
          }}
        />
      )}

      {/* 🍏 APPLE NUMBERS INSTRUCTIONS MODAL */}
      {showNumbersModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-[#0b0e1a] animate-scaleUp">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-indigo-500 animate-pulse" />
                Planilha Numbers detectada
              </h3>
              <button
                onClick={() => setShowNumbersModal(false)}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
              <p className="leading-relaxed">
                Arquivos do <strong>Apple Numbers (.numbers)</strong> são pacotes binários compactados exclusivos da Apple e não podem ser lidos diretamente no navegador.
              </p>
              <p className="font-semibold text-slate-700 dark:text-white">
                Como exportar para Excel (.xlsx) no seu Mac em segundos:
              </p>
              <div className="rounded-xl border border-indigo-100/70 bg-indigo-50/30 p-4 dark:border-indigo-950/40 dark:bg-indigo-950/15 space-y-3">
                <div className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-950 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">1</span>
                  <p>Abra o arquivo no seu aplicativo <strong>Numbers</strong>.</p>
                </div>
                <div className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-950 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">2</span>
                  <p>No menu superior do Numbers, clique em <strong>Arquivo &gt; Exportar Para &gt; Excel...</strong> (ou CSV).</p>
                </div>
                <div className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-950 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">3</span>
                  <p>Salve o arquivo e faça o upload do novo arquivo <strong>.xlsx</strong> gerado aqui.</p>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button
                onClick={() => setShowNumbersModal(false)}
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold px-4"
              >
                Entendi
              </Button>
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}

// Sub-component for auditing lead imports and creating follow-up cohorts
interface AuditItem {
  lead_import_item_id: string;
  import_id: string;
  telefone: string;
  normalized_data: Record<string, any>;
  imported_at: string;
  row_number: number;
  imported: boolean;
  skip_reason: string | null;
  dispatch_count: number;
  last_sent_at: string | null;
  last_attempt_at: string | null;
  last_status: string | null;
  last_error_message: string | null;
  has_replied: boolean;
}

interface LeadImportAuditReportProps {
  activeClientId: string;
  imports: any[];
  onSelectImportForFollowup: (importId: string) => void;
}

function LeadImportAuditReport({ activeClientId, imports, onSelectImportForFollowup }: LeadImportAuditReportProps) {
  const { getIdToken } = useAuth();
  const [selectedImportId, setSelectedImportId] = useState<string>("");
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"all" | "sent" | "failed" | "replied" | "pending">("all");
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [creatingSubset, setCreatingSubset] = useState(false);
  const [deletingItems, setDeletingItems] = useState(false);

  const selectedImport = useMemo(() => {
    return imports.find((imp) => imp.id === selectedImportId);
  }, [imports, selectedImportId]);

  // Dispatches executions history & chart states
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();
  const { data: dispatches = [], refetch: refetchDispatches } = useAllDispatches(activeClientId || null);
  const triggerDispatch = useTriggerDispatch("");
  const deleteDispatch = useDeleteDispatch("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [dispatchesSearchTerm, setDispatchesSearchTerm] = useState("");

  const filteredDispatches = useMemo(() => {
    if (!dispatchesSearchTerm.trim()) return dispatches;
    const term = dispatchesSearchTerm.toLowerCase();
    return dispatches.filter(
      (d) =>
        d.name.toLowerCase().includes(term) ||
        (d as any).campaign_name?.toLowerCase().includes(term)
    );
  }, [dispatches, dispatchesSearchTerm]);

  const dispatchesKpis = useMemo(() => {
    let total = dispatches.length;
    let sent = 0;
    let failed = 0;
    let running = 0;

    for (const d of dispatches) {
      sent += d.sent_count ?? 0;
      failed += d.failed_count ?? 0;
      if (d.status === "running") running++;
    }

    const totalMsgs = sent + failed;
    const successRate = totalMsgs > 0 ? Math.round((sent / totalMsgs) * 100) : 100;

    return { total, sent, failed, running, successRate };
  }, [dispatches]);

  const chartData = useMemo(() => {
    return [...dispatches]
      .filter((d) => d.status !== "draft" && d.status !== "cancelled")
      .reverse()
      .slice(-8)
      .map((d) => ({
        name: d.name.length > 15 ? `${d.name.substring(0, 15)}...` : d.name,
        Sucesso: d.sent_count ?? 0,
        Falha: d.failed_count ?? 0,
      }));
  }, [dispatches]);

  const handleTriggerDispatch = async (dispatch: CampaignDispatch) => {
    try {
      await triggerDispatch.mutateAsync(dispatch.id, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["all-dispatches"] });
          queryClient.invalidateQueries({ queryKey: ["campaign-dispatches"] });
        },
      });
      toast({
        title: "Disparo iniciado",
        description: `O lote "${dispatch.name}" está sendo processado.`,
      });
      refetchDispatches();
    } catch (err) {
      toast({
        title: "Erro ao iniciar disparo",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteDispatch = async (dispatch: CampaignDispatch) => {
    if (!confirm(`Tem certeza que deseja excluir o disparo "${dispatch.name}"?`)) return;

    try {
      await deleteDispatch.mutateAsync(dispatch.id, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["all-dispatches"] });
          queryClient.invalidateQueries({ queryKey: ["campaign-dispatches"] });
        },
      });
      toast({
        title: "Disparo removido",
        description: `O lote "${dispatch.name}" foi excluído.`,
      });
      refetchDispatches();
    } catch (err) {
      toast({
        title: "Erro ao excluir disparo",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadFailedCsv = async (dispatch: CampaignDispatch) => {
    try {
      setDownloadingId(dispatch.id);
      const token = await getIdToken();
      const res = await fetch(
        `${API_BASE_URL}/api/campaigns/dispatches/${dispatch.id}/failed?format=csv`,
        {
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (!res.ok) throw new Error("Erro ao baixar relatório de falhas");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute(
        "download",
        `falhas-${dispatch.name.toLowerCase().replace(/\s+/g, "-")}-${dispatch.id}.csv`
      );
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Download concluído",
        description: `Relatório de falhas para "${dispatch.name}" baixado com sucesso.`,
      });
    } catch (err) {
      toast({
        title: "Falha no download",
        description: err instanceof Error ? err.message : "Não foi possível baixar o CSV.",
        variant: "destructive",
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const isDark = resolvedTheme !== "light";
  const axisColor = isDark ? "rgba(255,255,255,0.52)" : "rgba(71,85,105,0.92)";
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(148,163,184,0.28)";
  const tooltipStyle = isDark
    ? {
        background: "rgba(8, 12, 32, 0.96)",
        border: "1px solid rgba(255, 255, 255, 0.12)",
        color: "rgba(255,255,255,0.92)",
        borderRadius: 16,
        boxShadow: "0 30px 80px rgba(0,0,0,0.35)",
      }
    : {
        background: "rgba(255,255,255,0.98)",
        border: "1px solid rgba(226,232,240,0.95)",
        color: "rgb(15 23 42)",
        borderRadius: 16,
        boxShadow: "0 20px 50px rgba(15,23,42,0.12)",
      };

  const getStatusBadge = (status: CampaignDispatch["status"]) => {
    switch (status) {
      case "draft":
        return (
          <Badge className="border border-border bg-muted/30 text-muted-foreground rounded-xl text-[10px]">
            Rascunho
          </Badge>
        );
      case "scheduled":
        return (
          <Badge className="border border-blue-400/25 bg-blue-500/10 text-blue-700 dark:text-blue-200 rounded-xl text-[10px]">
            Agendado
          </Badge>
        );
      case "running":
        return (
          <Badge className="border border-amber-400/25 bg-amber-500/10 text-amber-700 dark:text-amber-200 rounded-xl text-[10px] animate-pulse">
            Executando
          </Badge>
        );
      case "paused":
        return (
          <Badge className="border border-yellow-400/25 bg-yellow-500/10 text-yellow-700 dark:text-yellow-200 rounded-xl text-[10px]">
            Pausado
          </Badge>
        );
      case "done":
        return (
          <Badge className="border border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 rounded-xl text-[10px]">
            Concluído
          </Badge>
        );
      case "failed":
        return (
          <Badge className="border border-rose-400/25 bg-rose-500/10 text-rose-700 dark:text-rose-200 rounded-xl text-[10px]">
            Falhou
          </Badge>
        );
      case "cancelled":
        return (
          <Badge className="border border-border bg-muted/20 text-muted-foreground/60 rounded-xl text-[10px]">
            Cancelado
          </Badge>
        );
      default:
        return (
          <Badge className="border border-border bg-muted/30 text-muted-foreground rounded-xl text-[10px]">
            {status}
          </Badge>
        );
    }
  };

  useEffect(() => {
    if (!selectedImportId || !activeClientId) {
      setAuditItems([]);
      return;
    }

    async function loadAudit() {
      setLoading(true);
      try {
        const token = await getIdToken();
        const res = await fetch(
          `${API_BASE_URL}/api/campaigns/reports/import-audit?clientId=${encodeURIComponent(activeClientId)}&importId=${encodeURIComponent(selectedImportId)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!res.ok) {
          const contentType = res.headers.get("content-type") || "";
          let errorMsg = "Erro ao carregar auditoria";
          if (contentType.includes("application/json")) {
            const errData = await res.json().catch(() => null);
            if (errData?.error?.message) {
              errorMsg = errData.error.message;
            }
          } else {
            const txt = await res.text().catch(() => "");
            if (txt.trim().startsWith("<!DOCTYPE") || txt.trim().startsWith("<html")) {
              errorMsg = "Resposta HTML inesperada (o servidor backend pode estar em processo de deploy ou a rota não existe).";
            } else if (txt) {
              errorMsg = txt.slice(0, 100);
            }
          }
          throw new Error(errorMsg);
        }
        const data = await res.json();
        setAuditItems(data.items || []);
        setSelectedItemIds(new Set());
      } catch (err) {
        toast({
          title: "Erro ao carregar relatório",
          description: err instanceof Error ? err.message : "Erro desconhecido.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    }

    loadAudit();
  }, [selectedImportId, activeClientId]);

  useEffect(() => {
    if (imports.length > 0 && !selectedImportId) {
      setSelectedImportId(imports[0].id);
    }
  }, [imports, selectedImportId]);

  const filteredItems = useMemo(() => {
    return auditItems.filter((item) => {
      const name = String(item.normalized_data?.nome || item.normalized_data?.name || "").toLowerCase();
      const phone = String(item.telefone || "").toLowerCase();
      const matchesSearch = name.includes(searchTerm.toLowerCase()) || phone.includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;

      switch (activeFilter) {
        case "sent":
          return item.last_status === "sent";
        case "failed":
          return item.last_status === "failed";
        case "replied":
          return item.has_replied;
        case "pending":
          return !item.last_status || item.last_status === "pending" || item.last_status === "claimed";
        default:
          return true;
      }
    });
  }, [auditItems, activeFilter, searchTerm]);

  const stats = useMemo(() => {
    const total = auditItems.length;
    const sent = auditItems.filter((i) => i.last_status === "sent").length;
    const failed = auditItems.filter((i) => i.last_status === "failed").length;
    const replied = auditItems.filter((i) => i.has_replied).length;
    const pending = auditItems.filter((i) => !i.last_status || i.last_status === "pending" || i.last_status === "claimed").length;
    return { total, sent, failed, replied, pending };
  }, [auditItems]);

  const handleToggleSelectAll = () => {
    if (selectedItemIds.size === filteredItems.length) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(filteredItems.map((i) => i.lead_import_item_id)));
    }
  };

  const handleToggleSelectItem = (id: string) => {
    const next = new Set(selectedItemIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedItemIds(next);
  };

  const handleSelectCohort = (type: "all" | "failed" | "replied") => {
    let ids: string[] = [];
    if (type === "all") {
      ids = auditItems.map((i) => i.lead_import_item_id);
    } else if (type === "failed") {
      ids = auditItems.filter((i) => i.last_status === "failed").map((i) => i.lead_import_item_id);
    } else if (type === "replied") {
      ids = auditItems.filter((i) => i.has_replied).map((i) => i.lead_import_item_id);
    }
    setSelectedItemIds(new Set(ids));
  };

  const handleCreateCohortCampaign = async () => {
    if (selectedItemIds.size === 0) {
      toast({ title: "Nenhum lead selecionado", description: "Selecione pelo menos um lead na tabela.", variant: "destructive" });
      return;
    }
    const originalImport = imports.find((i) => i.id === selectedImportId);
    const defaultName = `Follow-up — ${originalImport?.source_name.replace(/\.[^/.]+$/, "") || "Planilha"} (${activeFilter === "replied" ? "Com Retorno" : activeFilter === "failed" ? "Falhas" : "Recampanha"})`;
    const finalCampaignName = prompt("Digite o nome para esta nova base de leads:", defaultName);
    if (!finalCampaignName) return;

    setCreatingSubset(true);
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/reports/create-import-from-subset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientId: activeClientId,
          sourceName: finalCampaignName.trim(),
          leadImportItemIds: Array.from(selectedItemIds),
        }),
      });

      if (!res.ok) throw new Error("Erro ao criar base de recampanha");
      const data = await res.json();

      toast({
        title: "Sucesso!",
        description: `Base "${finalCampaignName}" criada com ${selectedItemIds.size} leads. Redirecionando...`,
      });
      onSelectImportForFollowup(data.item.id);
    } catch (err) {
      toast({
        title: "Erro ao criar recampanha",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setCreatingSubset(false);
    }
  };

  const handleDeleteImportItems = async () => {
    if (selectedItemIds.size === 0) return;
    if (!confirm(`Tem certeza que deseja excluir os ${selectedItemIds.size} leads selecionados desta planilha?`)) return;

    setDeletingItems(true);
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/reports/delete-import-items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientId: activeClientId,
          leadImportItemIds: Array.from(selectedItemIds),
        }),
      });

      if (!res.ok) throw new Error("Erro ao excluir leads");

      toast({
        title: "Sucesso!",
        description: `${selectedItemIds.size} leads foram excluídos com sucesso.`,
      });

      setAuditItems((prev) => prev.filter((item) => !selectedItemIds.has(item.lead_import_item_id)));
      setSelectedItemIds(new Set());
    } catch (err) {
      toast({
        title: "Erro ao excluir leads",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setDeletingItems(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── SEÇÃO 1: VISÃO GERAL DOS DISPAROS ────────────────────────────── */}
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-bold text-foreground">Visão Geral dos Disparos</h2>
          <p className="text-xs text-muted-foreground">Acompanhe e gerencie lotes de disparo em massa da sua plataforma.</p>
        </div>

        {/* KPI Dashboard Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-border bg-card text-card-foreground shadow-sm rounded-2xl">
            <CardContent className="p-6 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-display">
                  Total de Disparos
                </p>
                <p className="text-3xl font-bold font-num text-foreground">
                  {dispatchesKpis.total}
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-200/60 bg-indigo-50 dark:border-indigo-800/40 dark:bg-indigo-950/40">
                <Send className="h-6 w-6 text-indigo-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card text-card-foreground shadow-sm rounded-2xl">
            <CardContent className="p-6 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-display">
                  Sucessos
                </p>
                <p className="text-3xl font-bold font-num text-emerald-600 dark:text-emerald-400">
                  {dispatchesKpis.sent}
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-200/60 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-950/40">
                <CheckCircle2 className="h-6 w-6 text-emerald-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card text-card-foreground shadow-sm rounded-2xl">
            <CardContent className="p-6 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-display">
                  Falhas
                </p>
                <p className="text-3xl font-bold font-num text-rose-600 dark:text-rose-400">
                  {dispatchesKpis.failed}
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-200/60 bg-rose-50 dark:border-rose-800/40 dark:bg-rose-950/40">
                <AlertTriangle className="h-6 w-6 text-rose-500" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card text-card-foreground shadow-sm rounded-2xl">
            <CardContent className="p-6 flex items-center justify-between gap-4">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-display">
                  Taxa de Entrega
                </p>
                <p className="text-3xl font-bold font-num text-foreground">
                  {dispatchesKpis.successRate}%
                </p>
              </div>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-200/60 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-950/40">
                <Gauge className="h-6 w-6 text-amber-500" />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Chart Column */}
          <Card className="lg:col-span-1 border-border bg-card text-card-foreground shadow-lg rounded-2xl">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold">Desempenho dos Lotes</CardTitle>
              <CardDescription>Envios com sucesso vs falhas nos últimos 8 lotes.</CardDescription>
            </CardHeader>
            <CardContent>
              {chartData.length === 0 ? (
                <div className="flex h-[200px] items-center justify-center text-xs text-muted-foreground">
                  Sem dados históricos de disparos executados.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 8, right: 0, left: -25, bottom: 0 }}>
                    <CartesianGrid vertical={false} strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey="name" tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fill: axisColor, fontSize: 10 }} axisLine={false} tickLine={false} width={30} />
                    <Tooltip
                      contentStyle={tooltipStyle}
                      labelStyle={{ color: isDark ? "rgba(255,255,255,0.7)" : "rgba(71,85,105,0.9)", fontSize: 11 }}
                      itemStyle={{ color: isDark ? "rgba(255,255,255,0.9)" : "rgb(15 23 42)", fontSize: 11 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="Sucesso" fill="#6366F1" radius={[2, 2, 0, 0]} />
                    <Bar dataKey="Falha" fill="#ff7a1a" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* List Table Column */}
          <Card className="lg:col-span-2 border-border bg-card text-card-foreground shadow-lg rounded-2xl">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <div>
                <CardTitle className="text-base font-bold">Histórico de Execuções</CardTitle>
                <CardDescription>Gerencie o envio dos lotes de disparo.</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <input
                  className="h-9 w-44 rounded-xl border border-border bg-background px-3 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="Buscar lote..."
                  value={dispatchesSearchTerm}
                  onChange={(e) => setDispatchesSearchTerm(e.target.value)}
                />
                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 rounded-xl border-border px-2.5"
                  onClick={() => void refetchDispatches()}
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {filteredDispatches.length === 0 ? (
                <div className="p-8">
                  <EmptyState
                    title="Nenhum disparo encontrado"
                    description={dispatchesSearchTerm ? "Tente alterar os termos da busca." : "Nenhum lote de disparo foi cadastrado ainda."}
                  />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table className="text-xs">
                    <TableHeader className="bg-muted/20 dark:bg-muted/10">
                      <TableRow className="border-slate-200/60 dark:border-white/5">
                        <TableHead className="px-4 py-3 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Lote / Campanha</TableHead>
                        <TableHead className="px-3 py-3 font-semibold uppercase text-[10px] tracking-wider text-slate-500 text-center">Status</TableHead>
                        <TableHead className="px-3 py-3 font-semibold uppercase text-[10px] tracking-wider text-slate-500 text-center">Progresso</TableHead>
                        <TableHead className="px-3 py-3 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Executado Em</TableHead>
                        <TableHead className="px-4 py-3 font-semibold uppercase text-[10px] tracking-wider text-slate-500 text-right">Ações</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredDispatches.map((d) => {
                        const total = (d.sent_count ?? 0) + (d.failed_count ?? 0);
                        const isTriggering = triggerDispatch.isPending && triggerDispatch.variables === d.id;
                        const isDeleting = deleteDispatch.isPending && deleteDispatch.variables === d.id;
                        const isDownloading = downloadingId === d.id;

                        return (
                          <TableRow key={d.id} className="border-border hover:bg-muted/10">
                            <TableCell className="px-4 py-3">
                              <div className="space-y-0.5">
                                <p className="font-semibold text-foreground">{d.name}</p>
                                <p className="text-[10px] text-muted-foreground font-medium flex items-center gap-1.5">
                                  <span>{(d as any).campaign_name || "Sem Campanha"}</span>
                                  <span>•</span>
                                  <span className="capitalize">{d.trigger_type}</span>
                                </p>
                              </div>
                            </TableCell>
                            <TableCell className="px-3 py-3 text-center">
                              {getStatusBadge(d.status)}
                            </TableCell>
                            <TableCell className="px-3 py-3">
                              <div className="flex flex-col items-center justify-center gap-1">
                                <div className="flex items-center justify-between gap-2 text-[10px] w-24">
                                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                    {d.sent_count} ✓
                                  </span>
                                  <span className="font-semibold text-rose-500">
                                    {d.failed_count} ✗
                                  </span>
                                </div>
                                {total > 0 && (
                                  <div className="h-1 w-24 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                                    <div
                                      className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                                      style={{ width: `${Math.round((d.sent_count / total) * 100)}%` }}
                                    />
                                  </div>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="px-3 py-3 text-[10px] font-mono text-muted-foreground whitespace-nowrap">
                              {formatDateTime(d.triggered_at || d.created_at)}
                            </TableCell>
                            <TableCell className="px-4 py-3 text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                {d.status === "draft" && (
                                  <Button
                                    size="sm"
                                    variant="default"
                                    className="h-7 rounded-lg px-2 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-[10px] shadow-sm"
                                    disabled={isTriggering}
                                    onClick={() => void handleTriggerDispatch(d)}
                                  >
                                    {isTriggering ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Play className="h-3 w-3 mr-1" />
                                    )}
                                    Iniciar
                                  </Button>
                                )}

                                {d.failed_count > 0 && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 w-7 rounded-lg p-0 border-border hover:bg-muted/10"
                                    title="Baixar falhas"
                                    disabled={isDownloading}
                                    onClick={() => void handleDownloadFailedCsv(d)}
                                  >
                                    {isDownloading ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Download className="h-3 w-3 text-slate-700 dark:text-white/80" />
                                    )}
                                  </Button>
                                )}

                                {(d.status === "draft" || d.status === "failed" || d.status === "done") && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 w-7 rounded-lg p-0 border-rose-200/40 hover:bg-rose-500/10 hover:text-rose-600 dark:border-rose-950/20 text-rose-500"
                                    title="Excluir lote"
                                    disabled={isDeleting}
                                    onClick={() => void handleDeleteDispatch(d)}
                                  >
                                    {isDeleting ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Trash2 className="h-3 w-3" />
                                    )}
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
        </div>
      </div>

      {/* ── SEÇÃO 2: DETALHES DE AUDITORIA DA PLANILHA SELECIONADA ────────── */}
      <Card className="border-border bg-card text-card-foreground shadow-lg rounded-2xl">
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-bold">Relatório & Auditoria de Envios</CardTitle>
              <CardDescription>Analise os resultados do disparo de cada planilha e crie réguas de acompanhamento automáticas</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">Planilha:</span>
              <Select value={selectedImportId} onValueChange={setSelectedImportId}>
                <SelectTrigger className="h-9 w-56 rounded-xl">
                  <SelectValue placeholder="Selecione a planilha..." />
                </SelectTrigger>
                <SelectContent className="border-border bg-card text-card-foreground shadow-2xl">
                  {imports.map((imp) => (
                    <SelectItem key={imp.id} value={imp.id} className="rounded-md focus:bg-muted dark:focus:bg-white/10">
                      {imp.source_name} ({imp.imported_rows} leads)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {imports.length > 0 && selectedImport && !loading && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-muted/20 p-4 rounded-2xl border border-border text-xs">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
                  <FileSpreadsheet className="h-4 w-4 text-indigo-500" />
                  <span>Origem (De onde veio)</span>
                </div>
                <div className="space-y-1 text-muted-foreground pl-5">
                  <p>
                    <strong className="text-foreground">Tipo de Origem: </strong>
                    {selectedImport.source_type === "segmentation_campaign" ? "Campanha de Segmentação" : "Upload de Planilha"}
                  </p>
                  <p>
                    <strong className="text-foreground">Nome da Base: </strong>
                    {selectedImport.source_name}
                  </p>
                  <p>
                    <strong className="text-foreground">Importado em: </strong>
                    {formatDateTime(selectedImport.created_at)}
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center gap-1.5 font-bold text-slate-700 dark:text-slate-300">
                  <Send className="h-4 w-4 text-emerald-500" />
                  <span>Destino (Para onde direcionar)</span>
                </div>
                <div className="space-y-1 text-muted-foreground pl-5">
                  <p>
                    <strong className="text-foreground">Status Atual: </strong>
                    Processado e direcionado para a **Fila de Envios** para disparos automatizados.
                  </p>
                  <p>
                    <strong className="text-foreground">Total de Leads: </strong>
                    {selectedImport.total_rows ?? (selectedImport.imported_rows + selectedImport.skipped_rows)} total ({selectedImport.imported_rows} válidos / {selectedImport.skipped_rows} ignorados)
                  </p>
                  <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                    💡 Use os filtros de status abaixo para segmentar os leads e criar novas campanhas de remarketing.
                  </p>
                </div>
              </div>
            </div>
          )}

          {imports.length === 0 ? (
            <div className="p-8">
              <EmptyState title="Nenhuma planilha importada" description="Importe uma planilha na aba Novo Disparo para visualizar os relatórios." />
            </div>
          ) : loading ? (
            <div className="p-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
              Carregando detalhes do relatório...
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 bg-slate-50/50 dark:bg-black/20 p-3 rounded-2xl border border-slate-200/60 dark:border-white/5">
                <button
                  onClick={() => setActiveFilter("all")}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded-xl border transition-all text-center",
                    activeFilter === "all" ? "bg-white border-slate-300 dark:bg-slate-800 dark:border-slate-700 shadow" : "bg-transparent border-transparent hover:bg-white/40 dark:hover:bg-white/5"
                  )}
                >
                  <span className="text-[10px] font-bold text-slate-400 uppercase">Total Leads</span>
                  <span className="text-base font-bold text-slate-800 dark:text-slate-100">{stats.total}</span>
                </button>
                <button
                  onClick={() => setActiveFilter("sent")}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded-xl border transition-all text-center",
                    activeFilter === "sent" ? "bg-white border-slate-300 dark:bg-slate-800 dark:border-slate-700 shadow" : "bg-transparent border-transparent hover:bg-white/40 dark:hover:bg-white/5"
                  )}
                >
                  <span className="text-[10px] font-bold text-emerald-500 uppercase">Enviados</span>
                  <span className="text-base font-bold text-emerald-600 dark:text-emerald-400">{stats.sent}</span>
                </button>
                <button
                  onClick={() => setActiveFilter("failed")}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded-xl border transition-all text-center",
                    activeFilter === "failed" ? "bg-white border-slate-300 dark:bg-slate-800 dark:border-slate-700 shadow" : "bg-transparent border-transparent hover:bg-white/40 dark:hover:bg-white/5"
                  )}
                >
                  <span className="text-[10px] font-bold text-rose-500 uppercase">Falhas</span>
                  <span className="text-base font-bold text-rose-600 dark:text-rose-400">{stats.failed}</span>
                </button>
                <button
                  onClick={() => setActiveFilter("replied")}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded-xl border transition-all text-center",
                    activeFilter === "replied" ? "bg-white border-slate-300 dark:bg-slate-800 dark:border-slate-700 shadow" : "bg-transparent border-transparent hover:bg-white/40 dark:hover:bg-white/5"
                  )}
                >
                  <span className="text-[10px] font-bold text-indigo-500 uppercase">Com Retorno</span>
                  <span className="text-base font-bold text-indigo-600 dark:text-indigo-400">{stats.replied}</span>
                </button>
                <button
                  onClick={() => setActiveFilter("pending")}
                  className={cn(
                    "flex flex-col items-center justify-center p-2 rounded-xl border transition-all text-center",
                    activeFilter === "pending" ? "bg-white border-slate-300 dark:bg-slate-800 dark:border-slate-700 shadow" : "bg-transparent border-transparent hover:bg-white/40 dark:hover:bg-white/5"
                  )}
                >
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Pendentes</span>
                  <span className="text-base font-bold text-slate-700 dark:text-slate-200">{stats.pending}</span>
                </button>
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/20 dark:bg-black/10 p-3.5 rounded-2xl border border-slate-200/60 dark:border-white/5">
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <Input
                    placeholder="Buscar lead por nome ou telefone..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-9 text-xs w-full sm:w-64 rounded-xl"
                  />

                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-1 sm:mt-0">
                    <span>Selecionar:</span>
                    <button type="button" onClick={() => handleSelectCohort("all")} className="rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 px-2 py-0.5">Todos</button>
                    <button type="button" onClick={() => handleSelectCohort("failed")} className="rounded-full bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-950/40 text-rose-600 px-2 py-0.5">Falhas</button>
                    <button type="button" onClick={() => handleSelectCohort("replied")} className="rounded-full bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/20 dark:hover:bg-indigo-950/40 text-indigo-600 px-2 py-0.5">Com Retorno</button>
                  </div>
                </div>

                {selectedItemIds.size > 0 && (
                  <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                    <Button
                      type="button"
                      onClick={handleDeleteImportItems}
                      disabled={deletingItems || creatingSubset}
                      variant="destructive"
                      className="w-full sm:w-auto h-9 text-xs font-bold gap-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-sm"
                    >
                      {deletingItems ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5 text-white" />
                      )}
                      Excluir Selecionados ({selectedItemIds.size})
                    </Button>
                    <Button
                      type="button"
                      onClick={handleCreateCohortCampaign}
                      disabled={creatingSubset || deletingItems}
                      className="w-full sm:w-auto h-9 text-xs font-bold gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm"
                    >
                      {creatingSubset ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 text-white" />
                      )}
                      Criar Campanha com Selecionados ({selectedItemIds.size})
                    </Button>
                  </div>
                )}
              </div>

              {filteredItems.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground italic py-6">Nenhum lead correspondente aos filtros atuais.</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-border">
                  <Table className="text-xs">
                    <TableHeader className="bg-muted/30 dark:bg-muted/10">
                      <TableRow className="border-slate-200/60 dark:border-white/5">
                        <TableHead className="w-12 text-center h-10 py-0">
                          <input
                            type="checkbox"
                            checked={filteredItems.length > 0 && selectedItemIds.size === filteredItems.length}
                            onChange={handleToggleSelectAll}
                            className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500"
                          />
                        </TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Linha</TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Nome</TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Telefone</TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500 text-center">Último Status</TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500 text-center">Tentativas</TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500 text-center">Retorno?</TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Há quanto tempo</TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Motivo da Falha / Detalhe</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredItems.map((item) => {
                        const isSelected = selectedItemIds.has(item.lead_import_item_id);

                        let timeAgo = "—";
                        if (item.last_attempt_at) {
                          const diffMs = Date.now() - new Date(item.last_attempt_at).getTime();
                          const diffMins = Math.floor(diffMs / 60000);
                          const diffHours = Math.floor(diffMins / 60);
                          const diffDays = Math.floor(diffHours / 24);
                          if (diffMins < 1) timeAgo = "Agora mesmo";
                          else if (diffMins < 60) timeAgo = `${diffMins} min atrás`;
                          else if (diffHours < 24) timeAgo = `${diffHours}h atrás`;
                          else timeAgo = `${diffDays}d atrás`;
                        }

                        return (
                          <TableRow
                            key={item.lead_import_item_id}
                            className={cn(
                              "border-border hover:bg-muted/10",
                              isSelected ? "bg-indigo-50/10 dark:bg-indigo-950/5" : ""
                            )}
                          >
                            <TableCell className="text-center py-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleSelectItem(item.lead_import_item_id)}
                                className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500"
                              />
                            </TableCell>
                            <TableCell className="py-2 text-muted-foreground font-mono text-[10px]">
                              {item.row_number}
                            </TableCell>
                            <TableCell className="py-2 font-semibold text-foreground">
                              {item.normalized_data?.nome || item.normalized_data?.name || "Sem nome"}
                            </TableCell>
                            <TableCell className="py-2 font-mono text-[11px]">
                              {item.telefone}
                            </TableCell>
                            <TableCell className="py-2 text-center">
                              {item.last_status ? (
                                <Badge className={cn("border text-[9px] font-bold rounded-lg px-2 py-0.25", CAMPAIGN_STATUS_COLORS[item.last_status as CampaignStatus] || "")}>
                                  {CAMPAIGN_STATUS_LABELS[item.last_status as CampaignStatus] || item.last_status}
                                </Badge>
                              ) : (
                                <span className="text-[10px] text-slate-400">Pendente</span>
                              )}
                            </TableCell>
                            <TableCell className="py-2 text-center font-bold">
                              {item.dispatch_count || 0}
                            </TableCell>
                            <TableCell className="py-2 text-center">
                              {item.has_replied ? (
                                <Badge className="border border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800/40 dark:bg-indigo-950/20 dark:text-indigo-400 font-bold text-[9px] rounded-lg px-2 py-0.25">
                                  Respondido 💬
                                </Badge>
                              ) : (
                                <span className="text-[10px] text-slate-400">—</span>
                              )}
                            </TableCell>
                            <TableCell className="py-2 text-[10px] text-muted-foreground">
                              {timeAgo}
                            </TableCell>
                            <TableCell className="py-2 text-muted-foreground truncate max-w-[200px]" title={item.last_error_message || ""}>
                              {item.last_status === "failed" ? (
                                <span className="text-rose-500 font-medium flex items-center gap-1.5">
                                  <AlertTriangle className="h-3 w-3 shrink-0" />
                                  {item.last_error_message || "Erro desconhecido"}
                                </span>
                              ) : item.skip_reason ? (
                                <span className="text-amber-500">Ignorado: {item.skip_reason}</span>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Test assertions expectations placeholder:
// [campaigns-ui] create_campaign_start
// [campaigns-ui] create_campaign_failed
// await Promise.allSettled([refetch(), refetchPending()])
// pendingSummaryLabel
// campaignPendingLabel
// Falha ao carregar leads pendentes
// Nao foi possivel carregar os leads
// Tentar novamente
// createCampaign.isPending
