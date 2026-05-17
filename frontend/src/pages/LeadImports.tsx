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
  Sparkles,
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
  useCampaignAiStatus,
  useCreateCampaign,
  useDeleteCampaign,
  useDirectDispatch,
  useGenerateCampaignCopy,
  useRewriteCampaignStep,
  useSuggestCampaignDelays,
  useSuggestCampaignSequence,
  useTriggerCampaign,
  useUpdateCampaign,
  useCampaignDispatches,
  useCreateDispatch,
  useUpdateDispatch,
  useDeleteDispatch,
  useTriggerDispatch,
  type Campaign,
  type CampaignDispatch,
  type CampaignStatus,
  type CampaignDispatchOptions,
  type CampaignImageAsset,
  type CampaignSequenceStep,
} from "@/hooks/useCampanhas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { PageShell } from "@/components/PageShell";
import { SectionHeader } from "@/components/SectionHeader";
import { cn } from "@/lib/utils";
import { useChatbotTemplates } from "@/hooks/useChatbotTemplates";
import { useCampaignPrompts, useSaveCampaignPrompt } from "@/hooks/useCampaignPrompts";

type SheetTab = "dados" | "campanha" | "disparo-direto" | "pendentes" | "enviadas" | "agendamentos";
type LeadsViewMode = "lista" | "cards" | "funil" | "kanban";
type CampaignComposerMode = "simple" | "advanced";

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

type TriggerConfirmState = {
  campaign: Campaign;
  leadCount: number | null;
} | null;

const INTERNAL_TABS: Array<{ id: SheetTab; label: string }> = [
  { id: "dados", label: "Dados Gerais" },
  { id: "pendentes", label: "Leads Pendentes" },
  { id: "campanha", label: "Nova Campanha" },
  { id: "disparo-direto", label: "Disparo Direto" },
  { id: "enviadas", label: "Campanhas" },
  { id: "agendamentos", label: "Disparos" },
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
const AI_STYLE_PRESETS = [
  {
    label: "Nome + curiosidade",
    value: "Curiosidade com nome para WhatsApp, objecao vou pensar e recuperacao de leads indecisos",
  },
  {
    label: "Consultivo direto",
    value: "Consultivo, direto e sem pressao",
  },
  {
    label: "Reativacao leve",
    value: "Reativacao leve para leads frios",
  },
] as const;
const darkFieldClass =
  "border-slate-200/90 bg-white text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-all placeholder:text-slate-400 focus-visible:border-primary/35 focus-visible:ring-2 focus-visible:ring-primary/15 focus-visible:ring-offset-0 dark:border-white/12 dark:bg-black/45 dark:text-white dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_10px_30px_rgba(0,0,0,0.18)] dark:placeholder:text-white/30 dark:focus-visible:bg-black/60 dark:focus-visible:ring-1 dark:focus-visible:ring-primary/20";
const darkSelectContentClass =
  "border-slate-200/90 bg-white text-slate-900 shadow-[0_24px_50px_rgba(15,23,42,0.12)] backdrop-blur-xl dark:border-white/10 dark:bg-[#090b17]/98 dark:text-white dark:shadow-[0_24px_50px_rgba(0,0,0,0.45)]";
const darkSelectItemClass =
  "rounded-md text-slate-700 focus:bg-slate-100 focus:text-slate-950 data-[state=checked]:bg-primary/10 data-[state=checked]:text-primary dark:text-white/78 dark:focus:bg-white/[0.06] dark:focus:text-white dark:data-[state=checked]:bg-primary/12 dark:data-[state=checked]:text-white";
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
  waitForReply: false,
  replyTimeoutSeconds: 60,
  replyPollIntervalSeconds: 5,
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
  return date ? date.toLocaleString("pt-BR", { timeZone: CAMPAIGN_TIME_ZONE }) : fallback;
}

function getTimeZoneOffsetMs(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const zonedTime = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );

  return zonedTime - date.getTime();
}

function campaignLocalDateTimeToUtcIso(value: string) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  const localAsUtc = new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  ));
  const utcDate = new Date(localAsUtc.getTime() - getTimeZoneOffsetMs(localAsUtc, CAMPAIGN_TIME_ZONE));

  return Number.isNaN(utcDate.getTime()) ? null : utcDate.toISOString();
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
    day: date.toLocaleDateString("pt-BR", { day: "2-digit", timeZone: CAMPAIGN_TIME_ZONE }),
    month: date.toLocaleDateString("pt-BR", { month: "short", timeZone: CAMPAIGN_TIME_ZONE }),
    label: campaign.scheduled_for ? formatDate(campaign.scheduled_for) : "sem data definida",
  };
}

const campaignStatusView: Record<CampaignStatus, { label: string; className: string }> = {
  active: {
    label: "PRONTA",
    className: "border-primary/20 bg-primary/10 text-primary",
  },
  paused: {
    label: "PAUSADA",
    className: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  },
  draft: {
    label: "RASCUNHO",
    className: "border-slate-400/20 bg-slate-400/10 text-slate-500 dark:text-slate-300",
  },
  scheduled: {
    label: "AGENDADA",
    className: "border-sky-400/25 bg-sky-400/10 text-sky-600 dark:text-sky-300",
  },
  processing: {
    label: "PROCESSANDO",
    className: "border-cyan-400/25 bg-cyan-400/10 text-cyan-600 dark:text-cyan-300",
  },
  sent: {
    label: "ENVIADA",
    className: "border-emerald-400/25 bg-emerald-400/10 text-emerald-600 dark:text-emerald-300",
  },
  failed: {
    label: "FALHOU",
    className: "border-red-400/25 bg-red-400/10 text-red-600 dark:text-red-300",
  },
  cancelled: {
    label: "CANCELADA",
    className: "border-slate-400/20 bg-slate-400/10 text-slate-500 dark:text-slate-300",
  },
};

function getCampaignStatusView(status: CampaignStatus) {
  return campaignStatusView[status] || campaignStatusView.draft;
}

function canPauseCampaign(status: CampaignStatus) {
  return ["active", "draft", "scheduled", "failed"].includes(status);
}

function canResumeCampaign(status: CampaignStatus) {
  return status === "paused";
}

function canCampaignBeDispatched(status: CampaignStatus) {
  return ["active", "draft", "scheduled", "failed"].includes(status);
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

function makeCampaignStepId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `step-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createCampaignStep(type: "text" | "image", order: number, patch: Partial<CampaignSequenceStep> = {}): CampaignSequenceStep {
  return {
    id: patch.id || makeCampaignStepId(),
    type,
    order,
    text: patch.text || "",
    image: patch.image || null,
    enabled: patch.enabled ?? true,
    delayAfterSeconds: patch.delayAfterSeconds ?? 5,
    triggerMode: patch.triggerMode === "after_reply" ? "after_reply" : "immediate",
  };
}

function normalizeCampaignSequence(meta?: Campaign["analytics_meta"]): CampaignSequenceStep[] {
  const provided = Array.isArray(meta?.sequence) ? meta.sequence : [];
  const legacySteps: CampaignSequenceStep[] = [];

  if (provided.length > 0) {
    return [...provided]
      .sort((left, right) => left.order - right.order)
      .map((step, index) => ({
        ...step,
        order: index + 1,
        image: step.image || null,
        enabled: step.enabled !== false,
        delayAfterSeconds: Number.isFinite(step.delayAfterSeconds) ? step.delayAfterSeconds : 5,
        triggerMode: step.triggerMode === "after_reply" ? "after_reply" : "immediate",
      }));
  }

  if (meta?.message?.trim()) {
    legacySteps.push(createCampaignStep("text", 1, { text: meta.message.trim() }));
  }

  if (meta?.image) {
    legacySteps.push(createCampaignStep("image", legacySteps.length + 1, { image: meta.image }));
  }

  return legacySteps;
}

function buildSimpleCampaignSequence(
  message: string,
  image: CampaignImageAsset | null,
  imageCaption: string,
  imageFirst: boolean,
) {
  const textStep = message.trim()
    ? createCampaignStep("text", 1, { text: message.trim() })
    : null;
  const imageStep = image
    ? createCampaignStep("image", 1, { text: imageCaption.trim(), image })
    : null;
  const orderedSteps = imageFirst ? [imageStep, textStep] : [textStep, imageStep];
  return normalizeStepOrder(orderedSteps.filter(Boolean) as CampaignSequenceStep[]);
}

function buildLegacySimpleCampaignSequence(message: string, image: CampaignImageAsset | null) {
  const sequence: CampaignSequenceStep[] = [];
  const trimmedMessage = message.trim();
  if (trimmedMessage) {
    sequence.push(createCampaignStep("text", 1, { text: trimmedMessage }));
  }
  if (image) {
    sequence.push(createCampaignStep("image", sequence.length + 1, { image }));
  }
  return sequence;
}

function normalizeStepOrder(steps: CampaignSequenceStep[]) {
  return steps.map((step, index) => ({
    ...step,
    order: index + 1,
  }));
}

function getCampaignPreviewSteps(campaign: Campaign) {
  return normalizeCampaignSequence(campaign.analytics_meta).filter((step) => step.enabled);
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

function InfoTip({ text }: { text: string }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info className="inline h-3 w-3 cursor-help text-muted-foreground opacity-60 hover:opacity-100" />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

const DISPATCH_STATUS_LABELS: Record<CampaignDispatch["status"], string> = {
  draft: "Rascunho",
  scheduled: "Agendado",
  running: "Executando",
  done: "Concluído",
  failed: "Falhou",
  cancelled: "Cancelado",
};

function CampaignDispatchPanel({ campaignId }: { campaignId: string }) {
  const { data: dispatches = [], isLoading, refetch } = useCampaignDispatches(campaignId);
  const createDispatch = useCreateDispatch(campaignId);
  const deleteDispatch = useDeleteDispatch(campaignId);
  const triggerDispatch = useTriggerDispatch(campaignId);
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);

  async function handleCreate() {
    if (!newName.trim()) return;
    await createDispatch.mutateAsync({ name: newName.trim(), steps: [] });
    setNewName("");
    setCreating(false);
  }

  return (
    <div className="mt-3 rounded-xl border border-border/60 bg-black/20 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground flex items-center gap-1.5">
          Disparos
          <InfoTip text="Cada disparo envia os passos configurados (textos/imagens) para os leads da campanha. Você pode criar vários disparos com conteúdos diferentes e acioná-los manualmente quando quiser." />
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isLoading}>
            <RefreshCw className={cn("h-3 w-3", isLoading && "animate-spin")} />
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>+ Novo</Button>
        </div>
      </div>
      {creating && (
        <div className="flex gap-2">
          <Input placeholder="Nome do disparo" value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8 text-sm" autoFocus />
          <Button size="sm" onClick={handleCreate} disabled={createDispatch.isPending}>Criar</Button>
          <Button size="sm" variant="ghost" onClick={() => { setCreating(false); setNewName(""); }}>Cancelar</Button>
        </div>
      )}
      {dispatches.length === 0 && !isLoading && (
        <p className="font-mono text-xs text-muted-foreground">Nenhum disparo criado.</p>
      )}
      <div className="space-y-2">
        {dispatches.map((d) => (
          <div key={d.id} className="flex items-center justify-between rounded-lg border border-border/50 bg-card/60 px-3 py-2">
            <div>
              <p className="text-sm font-medium">{d.name}</p>
              <p className="font-mono text-[10px] text-muted-foreground">
                {DISPATCH_STATUS_LABELS[d.status]} · {d.sent_count} enviados · {d.failed_count} falhas
              </p>
            </div>
            <div className="flex gap-1">
              {(d.status === "draft" || d.status === "scheduled") && (
                <Button size="sm" variant="outline" onClick={() => triggerDispatch.mutate(d.id)} disabled={triggerDispatch.isPending}>
                  Disparar
                </Button>
              )}
              {d.status !== "running" && (
                <Button size="sm" variant="ghost" onClick={() => deleteDispatch.mutate(d.id)} disabled={deleteDispatch.isPending}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const DISPATCH_STATUS_COLORS: Record<CampaignDispatch["status"], string> = {
  draft: "border-slate-400/20 bg-slate-400/10 text-slate-400",
  scheduled: "border-sky-400/25 bg-sky-400/10 text-sky-300",
  running: "border-cyan-400/25 bg-cyan-400/10 text-cyan-300",
  done: "border-emerald-400/25 bg-emerald-400/10 text-emerald-400",
  failed: "border-red-400/25 bg-red-400/10 text-red-400",
  cancelled: "border-slate-400/20 bg-slate-400/10 text-slate-500",
};

function DispatchManagerTab({
  campaigns,
  campaignsLoading,
  selectedClientId,
  onNavigateToCampaign,
}: {
  campaigns: Campaign[];
  campaignsLoading: boolean;
  selectedClientId: string;
  onNavigateToCampaign: () => void;
}) {
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [newName, setNewName] = useState("");
  const [newTriggerType, setNewTriggerType] = useState<"manual" | "scheduled">("manual");
  const [newScheduledAt, setNewScheduledAt] = useState("");
  const [confirmDispatch, setConfirmDispatch] = useState<CampaignDispatch | null>(null);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const visibleCampaigns = selectedClientId
    ? campaigns.filter((c) => c.client_id === selectedClientId && !c.archived_at)
    : campaigns.filter((c) => !c.archived_at);

  const selectedCampaign = visibleCampaigns.find((c) => c.id === selectedCampaignId) || null;

  const { data: dispatches = [], isLoading: dispatchesLoading, refetch: refetchDispatches } = useCampaignDispatches(selectedCampaignId || undefined);
  const createDispatch = useCreateDispatch(selectedCampaignId);
  const deleteDispatch = useDeleteDispatch(selectedCampaignId);
  const triggerDispatch = useTriggerDispatch(selectedCampaignId);

  async function handleCreate() {
    if (!newName.trim()) { setStatusMsg({ type: "error", text: "Informe um nome para o disparo." }); return; }
    if (newTriggerType === "scheduled" && !newScheduledAt) { setStatusMsg({ type: "error", text: "Selecione a data e hora do agendamento." }); return; }
    try {
      const scheduledIso = newTriggerType === "scheduled" && newScheduledAt ? campaignLocalDateTimeToUtcIso(newScheduledAt) : null;
      await createDispatch.mutateAsync({ name: newName.trim(), steps: [], triggerType: newTriggerType, scheduledAt: scheduledIso });
      setNewName("");
      setNewTriggerType("manual");
      setNewScheduledAt("");
      setStatusMsg({ type: "success", text: "Disparo criado com sucesso." });
    } catch (err) {
      setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Falha ao criar disparo." });
    }
  }

  async function handleTrigger(dispatch: CampaignDispatch) {
    setConfirmDispatch(null);
    try {
      await triggerDispatch.mutateAsync(dispatch.id);
      setStatusMsg({ type: "success", text: `Disparo "${dispatch.name}" iniciado.` });
      void refetchDispatches();
    } catch (err) {
      setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Falha ao disparar." });
    }
  }

  async function handleDelete(dispatch: CampaignDispatch) {
    try {
      await deleteDispatch.mutateAsync(dispatch.id);
      setStatusMsg({ type: "success", text: `Disparo "${dispatch.name}" removido.` });
    } catch (err) {
      setStatusMsg({ type: "error", text: err instanceof Error ? err.message : "Falha ao remover." });
    }
  }

  return (
    <>
      <AlertDialog open={Boolean(confirmDispatch)} onOpenChange={(open) => (!open ? setConfirmDispatch(null) : null)}>
        <AlertDialogContent className="max-w-md rounded-3xl border-border/80 bg-background/95">
          <AlertDialogHeader className="space-y-3 text-left">
            <AlertDialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Confirmar disparo
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-sm leading-6 text-muted-foreground">
              <span className="block font-semibold text-foreground">{confirmDispatch?.name}</span>
              <span className="block">Campanha: <strong className="text-foreground">{selectedCampaign?.name}</strong></span>
              <span className="block text-amber-400">As mensagens serão enviadas imediatamente para os leads desta campanha. Esta ação não pode ser desfeita.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirmDispatch && void handleTrigger(confirmDispatch)} disabled={triggerDispatch.isPending}>
              <Zap className="mr-2 h-4 w-4" />
              {triggerDispatch.isPending ? "Disparando..." : "Confirmar disparo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-extrabold tracking-tight text-foreground">Gerenciar Disparos</h2>
            <p className="mt-1 text-sm text-muted-foreground">Selecione uma campanha para criar, agendar e acompanhar os disparos.</p>
          </div>
          <Button variant="outline" onClick={onNavigateToCampaign}>
            <Megaphone className="mr-2 h-4 w-4" />
            Nova Campanha
          </Button>
        </div>

        {statusMsg && (
          <div className={cn("flex items-center gap-3 rounded-xl border p-4 text-sm font-medium", statusMsg.type === "success" ? "border-primary/25 bg-primary/8 text-primary" : "border-destructive/30 bg-destructive/10 text-destructive")}>
            {statusMsg.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
            {statusMsg.text}
            <button type="button" className="ml-auto opacity-60 hover:opacity-100" onClick={() => setStatusMsg(null)}>×</button>
          </div>
        )}

        {/* Seletor de Campanha */}
        <Card className="rounded-2xl border-border/80 bg-card/95 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
          <CardContent className="p-5 space-y-4">
            <div className="space-y-2">
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Campanha</p>
              {campaignsLoading ? (
                <div className={cn("flex h-12 items-center rounded-xl px-4 text-sm text-muted-foreground", darkFieldClass)}>Carregando campanhas...</div>
              ) : visibleCampaigns.length === 0 ? (
                <div className={cn("flex h-12 items-center rounded-xl px-4 text-sm text-muted-foreground", darkFieldClass)}>
                  Nenhuma campanha encontrada.{" "}
                  <button type="button" className="ml-1 text-primary underline" onClick={onNavigateToCampaign}>Criar campanha</button>
                </div>
              ) : (
                <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                  <SelectTrigger className={cn("h-12 rounded-xl", darkFieldClass)}>
                    <SelectValue placeholder="Selecione uma campanha..." />
                  </SelectTrigger>
                  <SelectContent className={darkSelectContentClass}>
                    {visibleCampaigns.map((c) => (
                      <SelectItem key={c.id} value={c.id} className={darkSelectItemClass}>
                        <span className="flex items-center gap-2">
                          <span>{c.name}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">· {c.client_name ?? c.client_id} · {getCampaignStatusView(c.status).label}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {selectedCampaign && (
              <div className="grid gap-3 rounded-xl border border-border/60 bg-black/20 p-4 sm:grid-cols-3">
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Status</p>
                  <span className={cn("mt-1 inline-block rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em]", getCampaignStatusView(selectedCampaign.status).className)}>
                    {getCampaignStatusView(selectedCampaign.status).label}
                  </span>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Modo</p>
                  <span className={cn("mt-1 inline-block rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em]", selectedCampaign.mode === "agente" ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-border/50 text-muted-foreground")}>
                    {selectedCampaign.mode === "agente" ? "Com Agente IA" : "Só Disparo"}
                  </span>
                </div>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-muted-foreground">Empresa</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{selectedCampaign.client_name ?? selectedCampaign.client_id}</p>
                </div>
                {(selectedCampaign.starts_at || selectedCampaign.ends_at) && (
                  <div className="col-span-full rounded-lg border border-sky-500/30 bg-sky-500/5 px-3 py-2">
                    <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-sky-400">Período ativo do chatbot</p>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      {selectedCampaign.starts_at ? formatDate(selectedCampaign.starts_at) : "Sem início"} → {selectedCampaign.ends_at ? formatDate(selectedCampaign.ends_at) : "Sem fim"}
                    </p>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {selectedCampaignId && (
          <>
            {/* Novo Disparo */}
            <Card className="rounded-2xl border-border/80 bg-card/95 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Zap className="h-4 w-4 text-primary" />
                  Novo Disparo
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 p-5 pt-0">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Nome do disparo</p>
                    <Input
                      className={darkFieldClass}
                      placeholder="Ex: Disparo Semana 1 — Oferta Principal"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Tipo de acionamento</p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setNewTriggerType("manual")}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-semibold transition-colors",
                          newTriggerType === "manual"
                            ? "border-primary/40 bg-primary/10 text-primary"
                            : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
                        )}
                      >
                        <Zap className="h-4 w-4" />
                        Manual
                        <span className="font-normal opacity-70">Você aciona</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setNewTriggerType("scheduled")}
                        className={cn(
                          "flex flex-col items-center gap-1 rounded-xl border p-3 text-xs font-semibold transition-colors",
                          newTriggerType === "scheduled"
                            ? "border-sky-400/40 bg-sky-400/10 text-sky-300"
                            : "border-border/60 text-muted-foreground hover:border-border hover:text-foreground",
                        )}
                      >
                        <Clock3 className="h-4 w-4" />
                        Agendado
                        <span className="font-normal opacity-70">Data e hora</span>
                      </button>
                    </div>
                  </div>
                </div>

                {newTriggerType === "scheduled" && (
                  <div className="space-y-2">
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                      Data e hora do disparo <span className="text-muted-foreground/60">(horário de Brasília)</span>
                    </p>
                    <Input
                      type="datetime-local"
                      className={darkFieldClass}
                      value={newScheduledAt}
                      onChange={(e) => setNewScheduledAt(e.target.value)}
                      min={new Date().toISOString().slice(0, 16)}
                    />
                  </div>
                )}

                <div className="flex gap-2 border-t border-border/70 pt-4">
                  <Button onClick={() => void handleCreate()} disabled={createDispatch.isPending || !newName.trim()}>
                    <Zap className="mr-2 h-4 w-4" />
                    {createDispatch.isPending ? "Criando..." : newTriggerType === "scheduled" ? "Agendar disparo" : "Criar disparo"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Lista de Disparos */}
            <Card className="rounded-2xl border-border/80 bg-card/95 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <History className="h-4 w-4" />
                    Disparos da campanha
                    <span className="ml-1 rounded-full bg-primary/20 px-2 py-0.5 font-mono text-[10px] text-primary">{dispatches.length}</span>
                  </CardTitle>
                  <Button variant="outline" size="sm" onClick={() => void refetchDispatches()} disabled={dispatchesLoading}>
                    <RefreshCw className={cn("h-3 w-3", dispatchesLoading && "animate-spin")} />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-5 pt-0">
                {dispatchesLoading && <EmptyState message="Carregando disparos..." />}
                {!dispatchesLoading && dispatches.length === 0 && (
                  <EmptyState
                    title="Nenhum disparo criado"
                    description="Crie o primeiro disparo acima para começar a enviar mensagens desta campanha."
                  />
                )}
                {!dispatchesLoading && dispatches.length > 0 && (
                  <div className="space-y-3">
                    {dispatches.map((d) => (
                      <div
                        key={d.id}
                        className="flex flex-wrap items-center gap-4 rounded-xl border border-border/60 bg-black/20 p-4"
                      >
                        {/* Status badge */}
                        <span className={cn("shrink-0 rounded-md border px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em]", DISPATCH_STATUS_COLORS[d.status])}>
                          {DISPATCH_STATUS_LABELS[d.status]}
                        </span>

                        {/* Info */}
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-foreground truncate">{d.name}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-3 font-mono text-[10px] text-muted-foreground">
                            {d.trigger_type === "scheduled" && d.scheduled_at && (
                              <span className="flex items-center gap-1 text-sky-300">
                                <Clock3 className="h-3 w-3" />
                                {formatDate(d.scheduled_at)}
                              </span>
                            )}
                            {d.trigger_type === "manual" && (
                              <span className="flex items-center gap-1">
                                <Zap className="h-3 w-3" />
                                Manual
                              </span>
                            )}
                            {d.triggered_at && (
                              <span>Iniciado {formatDate(d.triggered_at)}</span>
                            )}
                            {(d.status === "done" || d.status === "running") && (
                              <>
                                <span className="text-emerald-400">{d.sent_count} enviados</span>
                                {d.failed_count > 0 && <span className="text-red-400">{d.failed_count} falhas</span>}
                              </>
                            )}
                            {d.finished_at && <span>Concluído {formatDate(d.finished_at)}</span>}
                            {d.error_message && (
                              <span className="text-red-400 truncate max-w-[240px]">{d.error_message}</span>
                            )}
                          </div>
                        </div>

                        {/* Ações */}
                        <div className="flex shrink-0 items-center gap-2">
                          {(d.status === "draft" || d.status === "scheduled") && (
                            <Button
                              size="sm"
                              onClick={() => setConfirmDispatch(d)}
                              disabled={triggerDispatch.isPending}
                            >
                              <Zap className="mr-1.5 h-3 w-3" />
                              Disparar
                            </Button>
                          )}
                          {d.status === "running" && (
                            <span className="flex items-center gap-1.5 rounded-md border border-cyan-400/25 bg-cyan-400/10 px-3 py-1.5 font-mono text-[10px] text-cyan-300">
                              <RefreshCw className="h-3 w-3 animate-spin" />
                              Executando...
                            </span>
                          )}
                          {d.status !== "running" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => void handleDelete(d)}
                              disabled={deleteDispatch.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </>
  );
}

interface CampaignPromptFieldProps {
  clientId: string;
  campaignPrompts: Array<{ id: string; name: string; content: string }>;
  campaignPromptId: string;
  setCampaignPromptId: (id: string) => void;
  darkFieldClass: string;
  darkSelectContentClass: string;
  darkSelectItemClass: string;
}

function CampaignPromptField({
  clientId,
  campaignPrompts,
  campaignPromptId,
  setCampaignPromptId,
  darkFieldClass,
  darkSelectContentClass,
  darkSelectItemClass,
}: CampaignPromptFieldProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newContent, setNewContent] = useState("");
  const savePrompt = useSaveCampaignPrompt();

  const handleSave = async () => {
    if (!newName.trim() || !newContent.trim() || !clientId) return;
    const saved = await savePrompt.mutateAsync({ clientId, name: newName.trim(), content: newContent.trim() });
    if (saved?.id) setCampaignPromptId(saved.id);
    setNewName("");
    setNewContent("");
    setCreating(false);
  };

  return (
    <div className="space-y-2">
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground flex items-center gap-1.5">
        Prompt de campanha (IA)
        <InfoTip text="Prompt usado pelo chatbot quando o lead responder durante o período ativo desta campanha." />
      </p>
      <Select value={campaignPromptId || "none"} onValueChange={(v) => setCampaignPromptId(v === "none" ? "" : v)}>
        <SelectTrigger className={darkFieldClass}>
          <SelectValue placeholder="Prompt padrão de campanha" />
        </SelectTrigger>
        <SelectContent className={darkSelectContentClass}>
          <SelectItem value="none" className={darkSelectItemClass}>Prompt padrão de campanha</SelectItem>
          {campaignPrompts.map((p) => (
            <SelectItem key={p.id} value={p.id} className={darkSelectItemClass}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!creating ? (
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="text-xs text-cyan-600 hover:underline dark:text-cyan-400"
        >
          + Criar novo prompt
        </button>
      ) : (
        <div className="space-y-2 rounded-xl border border-slate-200/80 bg-white/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
          <Input
            placeholder="Nome do prompt (ex: Black Friday)"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className={darkFieldClass}
          />
          <Textarea
            placeholder="Conteúdo do prompt de campanha..."
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            rows={5}
            className={darkFieldClass}
          />
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={savePrompt.isPending || !newName.trim() || !newContent.trim()}>
              {savePrompt.isPending ? "Salvando..." : "Salvar"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setCreating(false)}>Cancelar</Button>
          </div>
        </div>
      )}
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
  const { data: chatbotTemplates = [] } = useChatbotTemplates(selectedClientId || null);
  const { data: campaignPrompts = [] } = useCampaignPrompts(selectedClientId || null);

  // Colunas dinâmicas para a tabela de Leads Pendentes
  const pendingTableColumns = useMemo(() => {
    const clientTemplate = chatbotTemplates.find((t) => t.client_id === selectedClientId);
    const template = clientTemplate ?? chatbotTemplates.find((t) => t.is_builtin) ?? null;
    const dynamicCols = template
      ? template.data_fields
          .filter((f) => !["nome", "telefone"].includes(f.key))
          .map((f) => ({ key: f.key, label: f.label }))
      : [
          { key: "cidade", label: "Cidade" },
          { key: "estado", label: "Estado" },
          { key: "status", label: "Status" },
        ];
    return dynamicCols;
  }, [chatbotTemplates, selectedClientId]);
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
  const [directPhone, setDirectPhone] = useState("");
  const [directMessage, setDirectMessage] = useState("");
  const [directImageCaption, setDirectImageCaption] = useState("");
  const [directImageFirst, setDirectImageFirst] = useState(false);
  const [directImage, setDirectImage] = useState<CampaignImageAsset | null>(null);
  const [directImageError, setDirectImageError] = useState<string | null>(null);
  const [directDispatchStatus, setDirectDispatchStatus] = useState<string | null>(null);
  const [campaignName, setCampaignName] = useState("");
  const [campaignMode, setCampaignMode] = useState<"disparo" | "agente">("disparo");
  const [campaignPromptId, setCampaignPromptId] = useState("");
  const [campaignStartsAt, setCampaignStartsAt] = useState("");
  const [campaignEndsAt, setCampaignEndsAt] = useState("");
  const [campaignMessage, setCampaignMessage] = useState("");
  const [campaignImage, setCampaignImage] = useState<CampaignImageAsset | null>(null);
  const [campaignImageCaption, setCampaignImageCaption] = useState("");
  const [campaignImageFirst, setCampaignImageFirst] = useState(false);
  const [campaignImageError, setCampaignImageError] = useState<string | null>(null);
  const [campaignComposerMode, setCampaignComposerMode] = useState<CampaignComposerMode>("simple");
  const [campaignSequence, setCampaignSequence] = useState<CampaignSequenceStep[]>([
    createCampaignStep("text", 1),
  ]);
  const [dispatchOptions, setDispatchOptions] = useState<CampaignDispatchOptions>(defaultDispatchOptions);
  const [aiGoal, setAiGoal] = useState("");
  const [aiStyle, setAiStyle] = useState("");
  const [selectedImageStepId, setSelectedImageStepId] = useState<string | null>(null);
  const [segmentation, setSegmentation] = useState<CampaignSegmentationState>(defaultSegmentation);
  const [leadViewMode, setLeadViewMode] = useState<LeadsViewMode>("lista");
  const [campaignSearch, setCampaignSearch] = useState("");
  const [selectedImportId, setSelectedImportId] = useState(ALL_IMPORTS_VALUE);
  const [importsPage, setImportsPage] = useState(1);
  const [campaignActionDialog, setCampaignActionDialog] = useState<CampaignActionDialogState>(null);
  const [triggerConfirm, setTriggerConfirm] = useState<TriggerConfirmState>(null);
  const [expandedDispatchCampaignId, setExpandedDispatchCampaignId] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<{ imported: number; skipped: number; errors: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const campaignImageInputRef = useRef<HTMLInputElement | null>(null);
  const sequenceImageInputRef = useRef<HTMLInputElement | null>(null);
  const directImageInputRef = useRef<HTMLInputElement | null>(null);

  const { data: imports = [], isLoading: importsLoading, error: importsError, refetch } = useLeadImports(selectedClientId);
  const createLeadImport = useCreateLeadImport();
  const deleteLeadImport = useDeleteLeadImport();
  const { data: campaigns = [], isLoading: campaignsLoading, error: campaignsError, refetch: refetchCampaigns } = useCampanhas(selectedClientId || undefined);
  const createCampaign = useCreateCampaign();
  const updateCampaign = useUpdateCampaign();
  const deleteCampaign = useDeleteCampaign();
  const triggerCampaign = useTriggerCampaign();
  const directDispatch = useDirectDispatch();
  const { data: campaignAiStatus } = useCampaignAiStatus();
  const generateCampaignCopy = useGenerateCampaignCopy();
  const suggestCampaignSequence = useSuggestCampaignSequence();
  const suggestCampaignDelays = useSuggestCampaignDelays();
  const rewriteCampaignStep = useRewriteCampaignStep();
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
  const pendingSummaryLabel = pendingLoading
    ? "Carregando..."
    : pendingError
      ? "Falha ao carregar leads pendentes"
      : pendingData
        ? `${pendingData.pendingCount} pendentes de ${pendingData.total} total`
        : selectedClientId
          ? "Nenhum lead encontrado"
          : "Selecione uma empresa";
  const campaignPendingLabel = pendingLoading
    ? "Carregando..."
    : pendingError
      ? "Falha ao carregar leads"
      : pendingData
        ? `${pendingData.pendingCount} aguardando disparo`
        : selectedClientId
          ? "Nenhum lead pendente"
          : "Selecione uma empresa";
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
      [...filteredCampaigns].sort((a, b) => {
        const left = getValidDate(b.last_triggered_at) || getValidDate(b.created_at) || new Date(0);
        const right = getValidDate(a.last_triggered_at) || getValidDate(a.created_at) || new Date(0);
        return left.getTime() - right.getTime();
      }),
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

  async function handleSequenceImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    const stepId = selectedImageStepId;
    setCampaignImageError(null);

    if (!file || !stepId) return;

    if (!file.type.startsWith("image/")) {
      setCampaignImageError("Selecione uma imagem valida para a sequencia.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setCampaignImageError("Use uma imagem de ate 2MB para manter o disparo leve.");
      return;
    }

    try {
      const asset = await readImageAsCampaignAsset(file);
      setCampaignSequence((current) =>
        current.map((step) => (step.id === stepId ? { ...step, image: asset } : step)),
      );
    } catch (error) {
      setCampaignImageError(error instanceof Error ? error.message : "Falha ao carregar imagem.");
    } finally {
      event.target.value = "";
      setSelectedImageStepId(null);
    }
  }

  async function handleDirectImageChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setDirectImageError(null);
    setDirectImage(null);

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setDirectImageError("Selecione uma imagem valida para o disparo direto.");
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setDirectImageError("Use uma imagem de ate 2MB para manter o disparo leve.");
      return;
    }

    try {
      const asset = await readImageAsCampaignAsset(file);
      setDirectImage(asset);
    } catch (error) {
      setDirectImageError(error instanceof Error ? error.message : "Falha ao carregar imagem.");
    } finally {
      event.target.value = "";
    }
  }

  function updateCampaignStep(stepId: string, patch: Partial<CampaignSequenceStep>) {
    setCampaignSequence((current) => {
      const updated = current.map((step) => (step.id === stepId ? { ...step, ...patch } : step));

      // Se triggerMode foi alterado para "after_reply", marcar todos os próximos passos também
      if (patch.triggerMode === "after_reply") {
        const stepIndex = updated.findIndex((s) => s.id === stepId);
        if (stepIndex >= 0) {
          for (let i = stepIndex + 1; i < updated.length; i++) {
            updated[i] = { ...updated[i], triggerMode: "after_reply" };
          }
        }
        // Ativar automaticamente waitForReply
        setDispatchOptions((current) => ({ ...current, waitForReply: true }));
      }

      return normalizeStepOrder(updated);
    });
  }

  function addCampaignStep(type: "text" | "image") {
    setCampaignSequence((current) => normalizeStepOrder([...current, createCampaignStep(type, current.length + 1)]));
  }

  function removeCampaignStep(stepId: string) {
    setCampaignSequence((current) => {
      const next = current.filter((step) => step.id !== stepId);
      return normalizeStepOrder(next.length > 0 ? next : [createCampaignStep("text", 1)]);
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
      return normalizeStepOrder(next);
    });
  }

  function getCurrentSequenceForSubmit() {
    return campaignComposerMode === "simple"
      ? buildSimpleCampaignSequence(campaignMessage, campaignImage, campaignImageCaption, campaignImageFirst)
      : normalizeStepOrder(campaignSequence);
  }

  function validateSequenceForSubmit(sequence: CampaignSequenceStep[]) {
    const enabledSteps = sequence.filter((step) => step.enabled);
    if (enabledSteps.length === 0) return "Adicione pelo menos um passo ativo na sequencia.";

    if (dispatchOptions.waitForReply) {
      const immediateSteps = enabledSteps.filter((step) => step.triggerMode !== "after_reply");
      const replySteps = enabledSteps.filter((step) => step.triggerMode === "after_reply");
      if (replySteps.length > 0 && immediateSteps.length === 0) {
        return "Campanhas com resposta avancada precisam de pelo menos um passo imediato antes dos passos apos resposta.";
      }
    }

    const invalidStep = enabledSteps.find((step) =>
      step.type === "text" ? !step.text.trim() : !step.image,
    );

    if (invalidStep) {
      return invalidStep.type === "text"
        ? `O passo ${invalidStep.order} precisa de texto.`
        : `O passo ${invalidStep.order} precisa de imagem.`;
    }

    return null;
  }

  async function handleGenerateCampaignCopy() {
    try {
      const result = await generateCampaignCopy.mutateAsync({
        campaignName,
        goal: aiGoal,
        style: aiStyle,
        segmentation: toCampaignSegmentationPayload(segmentation),
      });

      if (campaignComposerMode === "simple") {
        setCampaignMessage(result.copy);
      } else {
        setCampaignSequence((current) => {
          const firstText = current.find((step) => step.type === "text");
          if (!firstText) return normalizeStepOrder([createCampaignStep("text", 1, { text: result.copy }), ...current]);
          return current.map((step) => (step.id === firstText.id ? { ...step, text: result.copy } : step));
        });
      }
      setDispatchStatus(result.rationale || "Copy sugerida pela IA.");
    } catch (error) {
      setDispatchStatus(error instanceof Error ? error.message : "Falha ao gerar copy com IA.");
    }
  }

  async function handleSuggestCampaignSequence() {
    try {
      const result = await suggestCampaignSequence.mutateAsync({
        campaignName,
        goal: aiGoal,
        style: aiStyle,
        segmentation: toCampaignSegmentationPayload(segmentation),
        sequence: getCurrentSequenceForSubmit(),
      });

      setCampaignComposerMode("advanced");
      setCampaignSequence(normalizeStepOrder(result.sequence));
      setDispatchOptions(result.dispatchOptions);
      setDispatchStatus(result.rationale || "Sequencia sugerida pela IA.");
    } catch (error) {
      setDispatchStatus(error instanceof Error ? error.message : "Falha ao sugerir sequencia com IA.");
    }
  }

  async function handleSuggestCampaignDelays() {
    try {
      const result = await suggestCampaignDelays.mutateAsync({
        campaignName,
        goal: aiGoal,
        style: aiStyle,
        segmentation: toCampaignSegmentationPayload(segmentation),
        sequence: getCurrentSequenceForSubmit(),
        dispatchOptions,
      });

      setCampaignSequence(normalizeStepOrder(result.sequence));
      setDispatchOptions(result.dispatchOptions);
      setDispatchStatus(result.rationale || "Atrasos sugeridos pela IA.");
    } catch (error) {
      setDispatchStatus(error instanceof Error ? error.message : "Falha ao sugerir atrasos com IA.");
    }
  }

  async function handleRewriteCampaignStep(step: CampaignSequenceStep) {
    try {
      const result = await rewriteCampaignStep.mutateAsync({
        campaignName,
        goal: aiGoal,
        style: aiStyle,
        segmentation: toCampaignSegmentationPayload(segmentation),
        step,
      });

      updateCampaignStep(step.id, { text: result.step.text });
      setDispatchStatus(result.rationale || "Passo reescrito pela IA.");
    } catch (error) {
      setDispatchStatus(error instanceof Error ? error.message : "Falha ao reescrever passo com IA.");
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
      const imported = response.preview.filter((r) => r.imported).length;
      const skipped = response.preview.filter((r) => !r.imported && !r.skipReason?.toLowerCase().includes("erro")).length;
      const errors = response.preview.filter((r) => !r.imported && r.skipReason?.toLowerCase().includes("erro")).length;
      setImportSummary({ imported, skipped, errors });
      await Promise.allSettled([refetch(), refetchPending()]);
    } catch (error) {
      console.error("[lead-imports-ui] import_failed", {
        clientId: selectedClientId,
        fileName: selectedFile.name,
        rowCount: parsedRows.length,
      });
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

    // Text content is validated via validateSequenceForSubmit (simple + advanced).
    // Advanced mode uses step texts only; backend fills legacy message from the first text step.

    const sequence = getCurrentSequenceForSubmit();
    const sequenceError = validateSequenceForSubmit(sequence);
    if (sequenceError) {
      setDispatchStatus(sequenceError);
      return;
    }

    setIsDispatching(true);
    setDispatchStatus(null);

    const campaignPayload = {
      name: campaignName.trim(),
      clientId: selectedClientId,
      importId: selectedImportId === ALL_IMPORTS_VALUE ? null : selectedImportId || null,
      mode: campaignMode,
      campaignPromptId: campaignPromptId || null,
      startsAt: campaignStartsAt ? campaignLocalDateTimeToUtcIso(campaignStartsAt) : null,
      endsAt: campaignEndsAt ? campaignLocalDateTimeToUtcIso(campaignEndsAt) : null,
      analyticsMeta: {
        segmentation: toCampaignSegmentationPayload(segmentation),
        message: campaignMessage.trim(),
        image: campaignImage,
        sequence,
        dispatchOptions,
      },
    };

    console.info("[campaigns-ui] create_campaign_start", {
      clientId: campaignPayload.clientId,
      importId: campaignPayload.importId,
      sequenceSteps: sequence.length,
      hasImage: Boolean(campaignImage),
    });

    try {
      const createdCampaign = await createCampaign.mutateAsync(campaignPayload);

      setCampaignName("");
      setCampaignMessage("");
      setCampaignImage(null);
      setCampaignImageCaption("");
      setCampaignImageFirst(false);
      setCampaignImageError(null);
      setCampaignComposerMode("simple");
      setCampaignSequence([createCampaignStep("text", 1)]);
      setDispatchOptions(defaultDispatchOptions);
      setAiGoal("");
      setAiStyle("");
      setSegmentation(defaultSegmentation);
      setSelectedImportId(ALL_IMPORTS_VALUE);
      await refetchCampaigns();
      setExpandedDispatchCampaignId(createdCampaign.id);
      setActiveTab("enviadas");
      setDispatchStatus(`Campanha "${campaignName.trim()}" criada. Agora crie um Disparo abaixo para enviar.`);
      console.info("[campaigns-ui] create_campaign_success", {
        campaignId: createdCampaign.id,
        clientId: createdCampaign.client_id,
        status: createdCampaign.status,
      });
    } catch (error) {
      console.error("[campaigns-ui] create_campaign_failed", {
        clientId: campaignPayload.clientId,
        importId: campaignPayload.importId,
        message: error instanceof Error ? error.message : String(error),
      });
      setDispatchStatus(error instanceof Error ? error.message : "Falha ao criar campanha.");
    } finally {
      setIsDispatching(false);
    }
  }

  async function executeTriggerCampaign(campaign: Campaign) {
    setTriggerConfirm(null);
    try {
      const result = await triggerCampaign.mutateAsync(campaign.id);
      if (result.failureCount > 0 && result.successCount > 0) {
        setDispatchStatus(
          `Campanha "${campaign.name}": ${result.successCount} enviado(s) com sucesso, ${result.failureCount} falha(s). Verifique os leads com erro.`
        );
      } else if (result.failureCount > 0) {
        const firstReason = result.failures?.[0]?.reason || "Erro desconhecido";
        setDispatchStatus(
          `Campanha "${campaign.name}" falhou: ${firstReason}`
        );
      } else {
        setDispatchStatus(
          `Campanha "${campaign.name}": ${result.successCount} mensagem(ns) enviada(s) com sucesso!`
        );
      }
      void refetchCampaigns();
      void refetchPending();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao disparar campanha.";
      setDispatchStatus(`Erro na campanha "${campaign.name}": ${message}`);
    }
  }

  async function handleDirectDispatch() {
    if (!selectedClientId) {
      setDirectDispatchStatus("Selecione uma empresa antes de disparar.");
      return;
    }

    if (!directPhone.trim()) {
      setDirectDispatchStatus("Informe um telefone para disparo.");
      return;
    }

    if (!directMessage.trim() && !directImage) {
      setDirectDispatchStatus("Digite uma mensagem ou selecione uma imagem para envio.");
      return;
    }

    setDirectDispatchStatus(null);

    try {
      const result = await directDispatch.mutateAsync({
        clientId: selectedClientId,
        phone: directPhone.trim(),
        text: directMessage.trim(),
        imageCaption: directImageCaption.trim(),
        imageFirst: directImageFirst,
        image: directImage,
      });

      if (result.success) {
        setDirectDispatchStatus(`Disparo enviado para ${result.phone}.`);
        setDirectPhone("");
        setDirectMessage("");
        setDirectImageCaption("");
        setDirectImageFirst(false);
        setDirectImage(null);
        return;
      }

      setDirectDispatchStatus(result.failures[0]?.reason || "Falha no disparo direto.");
    } catch (error) {
      setDirectDispatchStatus(error instanceof Error ? error.message : "Falha no disparo direto.");
    }
  }

  function handleTriggerCampaign(campaign: Campaign) {
    const leadCount = pendingData?.pendingCount ?? null;
    setTriggerConfirm({ campaign, leadCount });
  }

  async function handleToggleCampaignStatus(campaign: Campaign) {
    try {
      const nextStatus = canPauseCampaign(campaign.status) ? "paused" : "scheduled";
      await updateCampaign.mutateAsync({
        id: campaign.id,
        status: nextStatus,
      });
      setDispatchStatus(
        nextStatus === "paused"
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

      <AlertDialog open={Boolean(triggerConfirm)} onOpenChange={(open) => (!open ? setTriggerConfirm(null) : null)}>
        <AlertDialogContent className="max-w-md rounded-3xl border-border/80 bg-background/95">
          <AlertDialogHeader className="space-y-3 text-left">
            <AlertDialogTitle className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              Confirmar disparo
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-sm leading-6 text-muted-foreground">
              <span className="block font-semibold text-foreground">{triggerConfirm?.campaign.name}</span>
              {triggerConfirm?.leadCount != null && triggerConfirm.leadCount > 0 ? (
                <span className="block">
                  Esta ação enviará mensagens para <strong className="text-foreground">{triggerConfirm.leadCount} lead{triggerConfirm.leadCount !== 1 ? "s" : ""} pendente{triggerConfirm.leadCount !== 1 ? "s" : ""}</strong> desta campanha.
                </span>
              ) : (
                <span className="block">Esta ação enviará mensagens para os leads pendentes desta campanha.</span>
              )}
              <span className="block">
                Modo: <strong className="text-foreground">{triggerConfirm?.campaign.mode === "agente" ? "Com Agente IA" : "Só Disparo"}</strong>
              </span>
              <span className="block text-amber-400">Esta ação não pode ser desfeita.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => triggerConfirm && void executeTriggerCampaign(triggerConfirm.campaign)}
              disabled={triggerCampaign.isPending}
            >
              <Zap className="mr-2 h-4 w-4" />
              {triggerCampaign.isPending ? "Disparando..." : "Confirmar disparo"}
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

                  {importSummary && (
                    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-primary/8 p-4">
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
                      <div className="flex flex-wrap gap-4 font-mono text-sm">
                        <span className="font-bold text-primary">{importSummary.imported} importados</span>
                        {importSummary.skipped > 0 && (
                          <span className="text-amber-400">{importSummary.skipped} duplicados ignorados</span>
                        )}
                        {importSummary.errors > 0 && (
                          <span className="text-destructive">{importSummary.errors} erros</span>
                        )}
                      </div>
                    </div>
                  )}

                  {selectedFile && !importSummary && (
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
                  {pendingSummaryLabel}
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
                {!pendingLoading && pendingError && (
                  <div className="space-y-3">
                    <EmptyState
                      title="Nao foi possivel carregar os leads"
                      description="A tentativa de buscar os leads pendentes falhou. Verifique a conexao com a API e tente atualizar."
                    />
                    <div className="flex justify-center">
                      <Button variant="outline" size="sm" onClick={() => refetchPending()}>
                        <RefreshCw className="h-4 w-4" />
                        Tentar novamente
                      </Button>
                    </div>
                  </div>
                )}
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
                              {pendingTableColumns.map((col) => (
                                <TableHead key={col.key}>{col.label}</TableHead>
                              ))}
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
                                  {pendingTableColumns.map((col) => (
                                    <TableCell key={col.key}>{String(normalizedData[col.key] ?? "-")}</TableCell>
                                  ))}
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
                <p className="mt-1 text-sm text-muted-foreground">
                  Configure a campanha aqui. Após criada, vá até <strong>Campanhas Enviadas</strong> → card da campanha → botão <strong>Disparos</strong> para criar e acionar os envios.
                </p>
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

                {/* Seletor de modo — ocupa linha inteira */}
                <div className="space-y-2 md:col-span-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground flex items-center gap-1.5">
                    Modo da Campanha
                    <InfoTip text="Define o comportamento do chatbot quando o lead responder ao disparo. O disparo em si é configurado depois, no painel 'Disparos' do card da campanha." />
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setCampaignMode("disparo")}
                      className={cn(
                        "rounded-xl border-2 p-4 text-left transition-all",
                        campaignMode === "disparo"
                          ? "border-primary bg-primary/10"
                          : "border-border/50 bg-card/40 hover:border-border"
                      )}
                    >
                      <p className="font-semibold text-sm">Só Disparo</p>
                      <p className="mt-1 text-xs text-muted-foreground">Envia as mensagens. Lead responde → chatbot padrão de qualificação.</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setCampaignMode("agente")}
                      className={cn(
                        "rounded-xl border-2 p-4 text-left transition-all",
                        campaignMode === "agente"
                          ? "border-sky-500 bg-sky-500/10"
                          : "border-border/50 bg-card/40 hover:border-border"
                      )}
                    >
                      <p className="font-semibold text-sm">Com Agente IA</p>
                      <p className="mt-1 text-xs text-muted-foreground">Lead responde durante o período → chatbot usa prompt de campanha.</p>
                    </button>
                  </div>
                </div>

                {/* Período ativo e prompt — só aparecem no modo agente */}
                {campaignMode === "agente" && (
                  <>
                    <div className="space-y-2">
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground flex items-center gap-1.5">
                        Início do período ativo
                        <InfoTip text="A partir desta data/hora, leads que responderem terão o chatbot respondendo com o prompt de campanha em vez do padrão." />
                      </p>
                      <Input type="datetime-local" className={darkFieldClass} value={campaignStartsAt} onChange={(e) => setCampaignStartsAt(e.target.value)} />
                      <p className="text-xs text-muted-foreground">Chatbot usa prompt de campanha a partir desta data.</p>
                    </div>
                    <div className="space-y-2">
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground flex items-center gap-1.5">
                        Fim do período ativo
                        <InfoTip text="Após esta data o lead volta automaticamente ao fluxo padrão de qualificação, sem precisar de nenhuma ação manual." />
                      </p>
                      <Input type="datetime-local" className={darkFieldClass} value={campaignEndsAt} onChange={(e) => setCampaignEndsAt(e.target.value)} />
                      <p className="text-xs text-muted-foreground">Após esta data o lead volta ao fluxo padrão.</p>
                    </div>
                    <CampaignPromptField
                      clientId={selectedClientId}
                      campaignPrompts={campaignPrompts}
                      campaignPromptId={campaignPromptId}
                      setCampaignPromptId={setCampaignPromptId}
                      darkFieldClass={darkFieldClass}
                      darkSelectContentClass={darkSelectContentClass}
                      darkSelectItemClass={darkSelectItemClass}
                    />
                  </>
                )}
                <div className="space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Leads pendentes</p>
                  <div className={cn("flex h-10 items-center rounded-md px-3 font-mono text-sm text-slate-500 dark:text-white/62", darkFieldClass)}>
                    {campaignPendingLabel}
                  </div>
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
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">Conteudo do disparo</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {campaignComposerMode === "simple" ? "Modo simples" : `${campaignSequence.length} passos na sequencia`}
                      </p>
                    </div>
                    <div className="flex rounded-lg border border-slate-200/90 bg-white p-1 dark:border-white/10 dark:bg-black/30">
                      <Button
                        type="button"
                        size="sm"
                        variant={campaignComposerMode === "simple" ? "secondary" : "ghost"}
                        onClick={() => setCampaignComposerMode("simple")}
                      >
                        Simples
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={campaignComposerMode === "advanced" ? "secondary" : "ghost"}
                        onClick={() => setCampaignComposerMode("advanced")}
                      >
                        Avancado
                      </Button>
                    </div>
                  </div>

                  {campaignAiStatus?.enabled ? (
                    <div className="space-y-2 rounded-xl border border-cyan-400/20 bg-cyan-500/5 p-3">
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Input
                          placeholder="Objetivo da campanha"
                          className={darkFieldClass}
                          value={aiGoal}
                          onChange={(event) => setAiGoal(event.target.value)}
                        />
                        <Input
                          placeholder="Estilo da copy"
                          className={darkFieldClass}
                          value={aiStyle}
                          onChange={(event) => setAiStyle(event.target.value)}
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {AI_STYLE_PRESETS.map((preset) => (
                          <Button
                            key={preset.label}
                            type="button"
                            variant={aiStyle === preset.value ? "secondary" : "outline"}
                            size="sm"
                            onClick={() => setAiStyle(preset.value)}
                          >
                            {preset.label}
                          </Button>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => void handleGenerateCampaignCopy()} disabled={generateCampaignCopy.isPending}>
                          <Sparkles className="h-4 w-4" />
                          Gerar copy
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => void handleSuggestCampaignSequence()} disabled={suggestCampaignSequence.isPending}>
                          <Sparkles className="h-4 w-4" />
                          Sugerir sequencia
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => void handleSuggestCampaignDelays()} disabled={suggestCampaignDelays.isPending}>
                          <Clock3 className="h-4 w-4" />
                          Sugerir atrasos
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {campaignComposerMode === "simple" ? (
                    <>
                      <div className="space-y-2">
                        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Texto de envio</p>
                        <Textarea
                          placeholder="Digite a mensagem que sera enviada nesta campanha..."
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
                          <div className="space-y-3 rounded-xl border border-slate-200/90 bg-white/80 p-3 text-sm dark:border-white/10 dark:bg-black/30">
                            <div className="flex items-center gap-3">
                              <img src={campaignImage.dataUrl} alt={campaignImage.name} className="h-14 w-14 rounded-lg object-cover" />
                              <div className="min-w-0">
                                <p className="truncate font-medium text-foreground">{campaignImage.name}</p>
                                <p className="text-xs text-muted-foreground">{Math.round(campaignImage.size / 1024)} KB</p>
                              </div>
                            </div>
                            <Input
                              className={darkFieldClass}
                              placeholder="Legenda da imagem opcional"
                              value={campaignImageCaption}
                              onChange={(event) => setCampaignImageCaption(event.target.value)}
                            />
                            <div className="grid gap-2 sm:grid-cols-2">
                              <Button
                                type="button"
                                variant={!campaignImageFirst ? "secondary" : "outline"}
                                onClick={() => setCampaignImageFirst(false)}
                              >
                                Texto primeiro
                              </Button>
                              <Button
                                type="button"
                                variant={campaignImageFirst ? "secondary" : "outline"}
                                onClick={() => setCampaignImageFirst(true)}
                              >
                                Imagem primeiro
                              </Button>
                            </div>
                          </div>
                        ) : null}
                        <ErrorMessage message={campaignImageError} variant="banner" />
                      </div>
                    </>
                  ) : (
                    <div className="space-y-3">
                      <input ref={sequenceImageInputRef} type="file" accept="image/*" className="sr-only" onChange={handleSequenceImageChange} />
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => addCampaignStep("text")}>
                          <Megaphone className="h-4 w-4" />
                          Texto
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={() => addCampaignStep("image")}>
                          <ImagePlus className="h-4 w-4" />
                          Imagem
                        </Button>
                      </div>

                      {campaignSequence.map((step, index) => (
                        <div key={step.id} className="space-y-3 rounded-xl border border-slate-200/90 bg-white/80 p-3 dark:border-white/10 dark:bg-black/30">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <label className="inline-flex items-center gap-2 text-xs font-medium text-muted-foreground">
                              <input
                                type="checkbox"
                                checked={step.enabled}
                                onChange={(event) => updateCampaignStep(step.id, { enabled: event.target.checked })}
                              />
                              passo {step.order} ativo
                            </label>
                            <div className="flex gap-1">
                              <Button type="button" variant="ghost" size="sm" onClick={() => moveCampaignStep(step.id, -1)} disabled={index === 0}>
                                <ArrowUp className="h-4 w-4" />
                              </Button>
                              <Button type="button" variant="ghost" size="sm" onClick={() => moveCampaignStep(step.id, 1)} disabled={index === campaignSequence.length - 1}>
                                <ArrowDown className="h-4 w-4" />
                              </Button>
                              {campaignAiStatus?.enabled ? (
                                <Button type="button" variant="ghost" size="sm" onClick={() => void handleRewriteCampaignStep(step)} disabled={rewriteCampaignStep.isPending}>
                                  <Sparkles className="h-4 w-4" />
                                </Button>
                              ) : null}
                              <Button type="button" variant="ghost" size="sm" onClick={() => removeCampaignStep(step.id)}>
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>

                          <Select value={step.type} onValueChange={(value) => updateCampaignStep(step.id, { type: value as "text" | "image" })}>
                            <SelectTrigger className={darkFieldClass}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className={darkSelectContentClass}>
                              <SelectItem value="text" className={darkSelectItemClass}>Texto</SelectItem>
                              <SelectItem value="image" className={darkSelectItemClass}>Imagem</SelectItem>
                            </SelectContent>
                          </Select>

                          <Textarea
                            placeholder={step.type === "image" ? "Legenda opcional da imagem" : "Texto do passo"}
                            className={cn("min-h-[90px]", darkFieldClass)}
                            value={step.text}
                            onChange={(event) => updateCampaignStep(step.id, { text: event.target.value })}
                          />

                          {step.type === "image" ? (
                            <div className="space-y-2">
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setSelectedImageStepId(step.id);
                                  sequenceImageInputRef.current?.click();
                                }}
                              >
                                <ImagePlus className="h-4 w-4" />
                                {step.image ? "Trocar imagem" : "Selecionar imagem"}
                              </Button>
                              {step.image ? (
                                <div className="flex items-center gap-3 rounded-lg border border-slate-200/90 bg-white/80 p-2 text-xs dark:border-white/10 dark:bg-black/30">
                                  <img src={step.image.dataUrl} alt={step.image.name} className="h-12 w-12 rounded-md object-cover" />
                                  <span className="truncate">{step.image.name}</span>
                                </div>
                              ) : null}
                            </div>
                          ) : null}

                          <div className="grid gap-2 sm:grid-cols-2">
                            <div className="space-y-1">
                              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Quando enviar</p>
                              <Select
                                value={step.triggerMode === "after_reply" ? "after_reply" : "immediate"}
                                onValueChange={(value) =>
                                  updateCampaignStep(step.id, {
                                    triggerMode: value === "after_reply" ? "after_reply" : "immediate",
                                  })
                                }
                              >
                                <SelectTrigger className={darkFieldClass}>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="immediate">No disparo da campanha</SelectItem>
                                  <SelectItem value="after_reply">Quando o lead responder</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Atraso apos passo</p>
                              <Input
                                type="number"
                                min="0"
                                step="1"
                                className={darkFieldClass}
                                value={step.delayAfterSeconds}
                                onChange={(event) => updateCampaignStep(step.id, { delayAfterSeconds: Math.max(0, Number(event.target.value) || 0) })}
                              />
                              <p className="text-[11px] text-muted-foreground">
                                {step.delayAfterSeconds >= 60
                                  ? `${(step.delayAfterSeconds / 60).toFixed(step.delayAfterSeconds % 60 === 0 ? 0 : 1)} min`
                                  : `${step.delayAfterSeconds}s`}
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                      <ErrorMessage message={campaignImageError} variant="banner" />
                    </div>
                  )}

                  <div className="grid gap-3 rounded-xl border border-slate-200/90 bg-white/80 p-3 dark:border-white/10 dark:bg-black/30 sm:grid-cols-2">
                    <div className="space-y-1">
                      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Atraso entre leads</p>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        className={darkFieldClass}
                        value={dispatchOptions.leadDelaySeconds}
                        onChange={(event) =>
                          setDispatchOptions((current) => ({
                            ...current,
                            leadDelaySeconds: Math.max(0, Number(event.target.value) || 0),
                          }))
                        }
                      />
                      <p className="text-[11px] text-muted-foreground">
                        {dispatchOptions.leadDelaySeconds >= 60
                          ? `${(dispatchOptions.leadDelaySeconds / 60).toFixed(dispatchOptions.leadDelaySeconds % 60 === 0 ? 0 : 1)} min`
                          : `${dispatchOptions.leadDelaySeconds}s`}
                      </p>
                    </div>
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={dispatchOptions.stopOnStepFailure}
                        onChange={(event) =>
                          setDispatchOptions((current) => ({
                            ...current,
                            stopOnStepFailure: event.target.checked,
                          }))
                        }
                      />
                      cancelar proximos passos se um passo falhar
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <input
                        type="checkbox"
                        checked={Boolean(dispatchOptions.waitForReply)}
                        onChange={(event) =>
                          setDispatchOptions((current) => ({
                            ...current,
                            waitForReply: event.target.checked,
                          }))
                        }
                      />
                      habilitar passos apos resposta no modo avancado
                    </label>
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
                <Button onClick={() => void handleDispatch()} disabled={isDispatching || createCampaign.isPending || !selectedClientId}>
                  <Megaphone className="mr-2 h-4 w-4" />
                  {isDispatching || createCampaign.isPending ? "Criando..." : "Criar campanha"}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === "disparo-direto" && isInternalUser && (
          <Card className="rounded-2xl border-border/80 bg-card/95 shadow-[0_18px_50px_rgba(0,0,0,0.22)]">
            <CardContent className="space-y-6 p-6">
              <div>
                <h2 className="text-2xl font-extrabold tracking-tight text-foreground">Disparo Direto</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Envie uma mensagem avulsa usando a URL Evolution configurada na empresa selecionada.
                </p>
              </div>

              {directDispatchStatus ? (
                <div
                  className={cn(
                    "rounded-xl border p-4 text-sm font-medium",
                    directDispatchStatus.includes("enviada")
                      ? "border-primary/30 bg-primary/10 text-primary"
                      : "border-destructive/30 bg-destructive/10 text-destructive",
                  )}
                >
                  {directDispatchStatus}
                </div>
              ) : null}

              <div className="grid gap-4 md:grid-cols-[0.7fr_1.3fr]">
                <div className="space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Telefone</p>
                  <Input
                    className={darkFieldClass}
                    inputMode="tel"
                    placeholder="Ex: 11999999999"
                    value={directPhone}
                    onChange={(event) => setDirectPhone(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Mensagem de texto</p>
                  <Textarea
                    className={cn("min-h-[150px]", darkFieldClass)}
                    placeholder="Digite a mensagem de texto que sera enviada pela Evolution..."
                    value={directMessage}
                    onChange={(event) => setDirectMessage(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-3 rounded-2xl border border-border/80 bg-background/70 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">Imagem opcional</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Envie uma imagem com legenda propria, separada da mensagem de texto.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <input ref={directImageInputRef} type="file" accept="image/*" className="sr-only" onChange={handleDirectImageChange} />
                    <Button type="button" variant="outline" onClick={() => directImageInputRef.current?.click()}>
                      <ImagePlus className="mr-2 h-4 w-4" />
                      {directImage ? "Trocar imagem" : "Selecionar imagem"}
                    </Button>
                    {directImage ? (
                      <Button type="button" variant="ghost" onClick={() => setDirectImage(null)}>
                        Remover
                      </Button>
                    ) : null}
                  </div>
                </div>

                {directImage ? (
                  <div className="grid gap-3 rounded-xl border border-border/70 bg-card/80 p-3 md:grid-cols-[140px_1fr]">
                    <img src={directImage.dataUrl} alt={directImage.name} className="h-28 w-full rounded-lg object-cover" />
                    <div className="space-y-1 text-sm text-muted-foreground">
                      <p className="font-medium text-foreground">{directImage.name}</p>
                      <p>{directImage.type || "imagem"} · {(directImage.size / 1024).toFixed(1)} KB</p>
                      <Input
                        className={darkFieldClass}
                        placeholder="Legenda da imagem opcional"
                        value={directImageCaption}
                        onChange={(event) => setDirectImageCaption(event.target.value)}
                      />
                      <div className="grid gap-2 sm:grid-cols-2">
                        <Button
                          type="button"
                          variant={!directImageFirst ? "secondary" : "outline"}
                          onClick={() => setDirectImageFirst(false)}
                        >
                          Texto primeiro
                        </Button>
                        <Button
                          type="button"
                          variant={directImageFirst ? "secondary" : "outline"}
                          onClick={() => setDirectImageFirst(true)}
                        >
                          Imagem primeiro
                        </Button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {directImageError ? <p className="text-sm text-destructive">{directImageError}</p> : null}
              </div>

              <div className="rounded-xl border border-slate-200/90 bg-slate-50/80 p-4 text-sm text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
                Texto envia <code>number</code> + <code>txt</code>. Imagem envia <code>number</code>, <code>caption</code> e base64 pela mesma URL Evolution da empresa.
              </div>

              <div className="flex flex-wrap gap-3 border-t border-border/70 pt-5">
                <Button
                  type="button"
                  onClick={() => void handleDirectDispatch()}
                  disabled={directDispatch.isPending || !selectedClientId}
                >
                  <Zap className="mr-2 h-4 w-4" />
                  {directDispatch.isPending ? "Enviando..." : "Disparar agora"}
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
                title="Nenhuma campanha encontrada"
                description="Crie uma campanha na aba Nova Campanha para começar."
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
                      <div className="flex flex-col items-end gap-1">
                        <span className={cn("rounded-md border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em]", getCampaignStatusView(campaign.status).className)}>
                          {getCampaignStatusView(campaign.status).label}
                        </span>
                        <span className={cn("rounded-md border px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.18em]", campaign.mode === "agente" ? "border-sky-500/40 bg-sky-500/10 text-sky-400" : "border-border/50 text-muted-foreground")}>
                          {campaign.mode === "agente" ? "Agente IA" : "Só Disparo"}
                        </span>
                      </div>
                    </div>
                    <div className="border-t border-border/70 pt-4">
                      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                        Base: {campaign.import_id || "todas as importacoes"} · Lote: {campaign.limit_per_run}
                      </p>
                      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                        {campaign.scheduled_for ? `Agendada para ${formatDate(campaign.scheduled_for)}` : "Sem data agendada"}
                      </p>
                    </div>
                    {getCampaignPreviewSteps(campaign).length > 0 ? (
                      <div className="rounded-xl border border-slate-200/90 bg-white/80 p-3 dark:border-white/10 dark:bg-black/30">
                        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Conteudo da campanha</p>
                        <div className="mt-2 space-y-2">
                          {getCampaignPreviewSteps(campaign).slice(0, 4).map((step) => (
                            <div key={step.id} className="rounded-lg border border-slate-200/80 bg-white/70 p-2 text-sm dark:border-white/10 dark:bg-black/25">
                              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                                {step.order}. {step.type === "image" ? "imagem" : "texto"}
                              </p>
                              {step.text ? <p className="mt-1 line-clamp-2 text-foreground">{step.text}</p> : null}
                              {step.image ? (
                                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                                  <img src={step.image.dataUrl} alt={step.image.name} className="h-10 w-10 rounded-md object-cover" />
                                  <span className="truncate">{step.image.name}</span>
                                </div>
                              ) : null}
                            </div>
                          ))}
                        </div>
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
                    {(campaign.starts_at || campaign.ends_at) && (
                      <div className="rounded-lg border border-sky-500/30 bg-sky-500/5 p-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-sky-400">Período ativo do chatbot</p>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {campaign.starts_at ? formatDate(campaign.starts_at) : "Sem início"} → {campaign.ends_at ? formatDate(campaign.ends_at) : "Sem fim"}
                        </p>
                        {(() => {
                          const now = Date.now();
                          const s = campaign.starts_at ? new Date(campaign.starts_at).getTime() : null;
                          const e = campaign.ends_at ? new Date(campaign.ends_at).getTime() : null;
                          const isActive = (!s || now >= s) && (!e || now <= e);
                          return isActive ? (
                            <span className="mt-1 inline-block rounded-full bg-emerald-500/20 px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.18em] text-emerald-400">● Ativo agora</span>
                          ) : null;
                        })()}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
                      <Button variant="outline" size="sm" onClick={() => setExpandedDispatchCampaignId(expandedDispatchCampaignId === campaign.id ? null : campaign.id)}>
                        Disparos
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => setCampaignActionDialog({ action: "archive", campaign })}>
                        <Archive className="mr-2 h-4 w-4" />
                        Arquivar
                      </Button>
                      <Button variant="destructive" size="sm" onClick={() => setCampaignActionDialog({ action: "delete", campaign })}>
                        <Trash2 className="mr-2 h-4 w-4" />
                        Apagar
                      </Button>
                    </div>
                    {expandedDispatchCampaignId === campaign.id && (
                      <CampaignDispatchPanel campaignId={campaign.id} />
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {activeTab === "agendamentos" && isInternalUser && (
          <DispatchManagerTab
            campaigns={filteredCampaigns}
            campaignsLoading={campaignsLoading}
            selectedClientId={selectedClientId}
            onNavigateToCampaign={() => setActiveTab("campanha")}
          />
        )}
      </section>
    </PageShell>
  );
}
