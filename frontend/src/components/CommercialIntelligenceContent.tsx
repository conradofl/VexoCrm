import { useEffect, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  Bot,
  BrainCircuit,
  Building2,
  CalendarClock,
  CheckCircle2,
  CircleSlash,
  CircleUserRound,
  Download,
  Filter,
  Gauge,
  HandCoins,
  LayoutPanelTop,
  Loader2,
  Lock,
  MapPinned,
  MessageCircleReply,
  Plus,
  RefreshCcw,
  Route,
  Save,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  Target,
  TimerReset,
  Trash2,
  Unlock,
  UserCog,
  Users,
  WandSparkles,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { KpiGrid } from "@/components/KpiGrid";
import { KpiCard } from "@/components/KpiCard";
import { DashboardPanel } from "@/components/DashboardPanel";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import {
  type CampaignPerformanceItem,
  type CommercialIntelligenceFilters,
  type CommercialIntelligencePayload,
  type CommercialMetricRow,
  type CommercialRankingCampaign,
  type CommercialRankingCity,
  type CommercialRankingConsultant,
  type CommercialIntelligenceSettings,
  type ConsultantItem,
  type ConsultantPayload,
  type DistributionQueueRow,
  type DistributionRuleItem,
  type DistributionRulePayload,
  type InsightItem,
  useAssignmentAction,
  useCommercialIntelligence,
  useCreateConsultant,
  useCreateDistributionRule,
  useDeleteConsultant,
  useSaveCommercialIntelligenceSettings,
  useUpdateConsultant,
  useUpdateDistributionRule,
  useUpdateInsightStatus,
} from "@/hooks/useCommercialIntelligence";

type TabId = "performance" | "equipe" | "ia-config";
type SortOrder = "asc" | "desc";

const DEFAULT_FILTERS: CommercialIntelligenceFilters = {
  period: "30d",
  campaignId: "",
  city: "",
  consultantId: "",
  status: "",
};

const DEFAULT_SETTINGS: CommercialIntelligenceSettings = {
  qualificationThreshold: 60,
  slaMinutes: 30,
  defaultPeriod: "30d",
  distributionStrategy: "round_robin",
  rankingRules: {
    cities: "qualificationRate",
    campaigns: "qualifiedLeads",
    consultants: "conversionRate",
  },
  metricRules: {
    qualificationStatus: ["qualificado", "qualificados", "em_qualificacao"],
  },
  alertRules: {
    lowResponseRate: 15,
    lowConversionRate: 10,
    highQualificationDelayHours: 24,
    consultantBelowAverageFactor: 0.7,
  },
  permissions: {
    canEditSettings: true,
    canManageConsultants: true,
    canManageDistribution: true,
  },
};

const PERIOD_OPTIONS = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "180d", label: "180 dias" },
  { value: "all", label: "Todo o historico" },
];

const LEAD_TYPE_OPTIONS = ["Residencial", "Empresa", "Premium", "Recorrente"];
const REGION_OPTIONS = ["Capital", "Interior", "Sul", "Sudeste", "Centro-Oeste", "Nordeste"];
const STATUS_COLORS = ["#22d3ee", "#a78bfa", "#fb7185", "#f59e0b", "#60a5fa", "#94a3b8"];

function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR").format(Number(value));
}

function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(1)}%`;
}

function formatHours(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(1)}h`;
}

function formatCompact(value: number | null | undefined, kind: string) {
  if (kind === "currency") return formatCurrency(value);
  if (kind === "percent") return formatPercent(value);
  if (kind === "hours") return formatHours(value);
  if (kind === "ratio") return value === null || value === undefined ? "—" : Number(value).toFixed(2);
  return formatNumber(value);
}

function deltaLabel(delta: number | null | undefined, kind: string) {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return "sem comparativo";
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${formatCompact(delta, kind)}`;
}

function directionClasses(direction: CommercialMetricRow["direction"]) {
  if (direction === "up") return "border-emerald-300/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200";
  if (direction === "down") return "border-rose-300/60 bg-rose-500/10 text-rose-700 dark:text-rose-200";
  return "border-slate-300/60 bg-slate-500/10 text-slate-700 dark:text-slate-200";
}

function toneFromAccent(accent: string): "cyan" | "teal" | "amber" | "pink" | "purple" {
  if (accent === "teal") return "teal";
  if (accent === "amber") return "amber";
  if (accent === "pink" || accent === "rose") return "pink";
  if (accent === "violet") return "purple";
  return "cyan";
}

function severityClasses(severity: InsightItem["severity"]) {
  if (severity === "critical") return "bg-rose-500/10 text-rose-700 dark:text-rose-200";
  if (severity === "warning") return "bg-amber-500/10 text-amber-700 dark:text-amber-200";
  return "bg-cyan-500/10 text-cyan-700 dark:text-cyan-200";
}

function statusClasses(value: string) {
  const normalized = value.toLowerCase();
  if (normalized.includes("ativo") || normalized.includes("dispon")) {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200";
  }
  if (normalized.includes("pend") || normalized.includes("aguard")) {
    return "bg-amber-500/10 text-amber-700 dark:text-amber-200";
  }
  if (normalized.includes("trav")) {
    return "bg-rose-500/10 text-rose-700 dark:text-rose-200";
  }
  return "bg-slate-500/10 text-slate-700 dark:text-slate-200";
}

function parseCsvList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeCsvList(values: string[] | undefined) {
  return (values || []).join(", ");
}

function parseAvailableHours(value: string) {
  return value.trim() ? { label: value.trim() } : {};
}

function serializeAvailableHours(value: Record<string, unknown> | undefined) {
  if (!value || typeof value !== "object") return "";
  return typeof value.label === "string" ? value.label : "";
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    totalPages,
    page: safePage,
    items: items.slice(start, start + pageSize),
  };
}

function compareValues(a: string | number | null | undefined, b: string | number | null | undefined, order: SortOrder) {
  const safeA = a ?? (typeof b === "number" ? -Infinity : "");
  const safeB = b ?? (typeof a === "number" ? -Infinity : "");
  if (typeof safeA === "number" && typeof safeB === "number") {
    return order === "asc" ? safeA - safeB : safeB - safeA;
  }
  return order === "asc"
    ? String(safeA).localeCompare(String(safeB), "pt-BR")
    : String(safeB).localeCompare(String(safeA), "pt-BR");
}

function exportRows(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) {
    toast.info("Nao ha dados para exportar nesta visao.");
    return;
  }

  const columns = Array.from(
    rows.reduce((set, row) => {
      Object.keys(row).forEach((key) => set.add(key));
      return set;
    }, new Set<string>()),
  );

  const csv = [
    columns.join(";"),
    ...rows.map((row) =>
      columns
        .map((column) => {
          const raw = row[column];
          const value = Array.isArray(raw) ? raw.join(", ") : raw ?? "";
          return `"${String(value).replace(/"/g, '""')}"`;
        })
        .join(";"),
    ),
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function FilterField({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function EmptyChart({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center rounded-[1.25rem] border border-dashed border-border bg-card px-6 text-center text-card-foreground">
      <div className="space-y-2">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function PaginationBar({
  page,
  totalPages,
  onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (value: number) => void;
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-3 pt-3">
      <p className="text-xs text-muted-foreground">
        Pagina {page} de {totalPages}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => onChange(Math.max(1, page - 1))} disabled={page <= 1}>
          Anterior
        </Button>
        <Button variant="outline" size="sm" onClick={() => onChange(Math.min(totalPages, page + 1))} disabled={page >= totalPages}>
          Proxima
        </Button>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <DashboardPanel
      title="Carregando inteligencia comercial"
      subtitle="Estamos organizando metricas, rankings, distribuicao e insights desta empresa."
      className="p-6"
    >
      <div className="grid gap-3 md:grid-cols-4">
        {["Metricas", "Rankings", "Distribuicao", "Insights"].map((label) => (
          <div key={label} className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              {label}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">Preparando dados operacionais para uso.</p>
          </div>
        ))}
      </div>
    </DashboardPanel>
  );
}

function ConsultantFormDialog({
  open,
  onOpenChange,
  title,
  form,
  onChange,
  onSubmit,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  form: ConsultantPayload & { availableHoursLabel?: string };
  onChange: (next: ConsultantPayload & { availableHoursLabel?: string }) => void;
  onSubmit: () => void;
  isSaving: boolean;
}) {
  const leadTypes = form.leadTypes || [];
  const regions = form.territoryRegions || [];

  const toggleArrayValue = (key: "leadTypes" | "territoryRegions", value: string) => {
    const current = new Set(key === "leadTypes" ? leadTypes : regions);
    if (current.has(value)) {
      current.delete(value);
    } else {
      current.add(value);
    }
    onChange({ ...form, [key]: Array.from(current) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto rounded-[1.5rem] border-border bg-card text-card-foreground">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Configure criterios reais de distribuicao e atendimento do consultor.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 lg:grid-cols-2">
          <FilterField label="Nome">
            <Input value={form.name || ""} onChange={(event) => onChange({ ...form, name: event.target.value })} placeholder="Nome completo" />
          </FilterField>
          <FilterField label="Cargo">
            <Input value={form.position || ""} onChange={(event) => onChange({ ...form, position: event.target.value })} placeholder="Closer, executivo, consultor..." />
          </FilterField>
          <FilterField label="Telefone">
            <Input value={form.phone || ""} onChange={(event) => onChange({ ...form, phone: event.target.value })} placeholder="(11) 99999-9999" />
          </FilterField>
          <FilterField label="Email">
            <Input type="email" value={form.email || ""} onChange={(event) => onChange({ ...form, email: event.target.value })} placeholder="consultor@empresa.com" />
          </FilterField>
          <FilterField label="Cidade base">
            <Input value={form.city || ""} onChange={(event) => onChange({ ...form, city: event.target.value })} placeholder="Cidade principal" />
          </FilterField>
          <FilterField label="Estado base">
            <Input value={form.state || ""} onChange={(event) => onChange({ ...form, state: event.target.value })} placeholder="UF" />
          </FilterField>
          <FilterField label="Cidades atendidas" className="lg:col-span-2">
            <Input
              value={serializeCsvList(form.territoryCities)}
              onChange={(event) => onChange({ ...form, territoryCities: parseCsvList(event.target.value) })}
              placeholder="Sao Paulo, Campinas, Sorocaba"
            />
          </FilterField>
          <FilterField label="Estados atendidos" className="lg:col-span-2">
            <Input
              value={serializeCsvList(form.territoryStates)}
              onChange={(event) => onChange({ ...form, territoryStates: parseCsvList(event.target.value) })}
              placeholder="SP, RJ, MG"
            />
          </FilterField>
          <FilterField label="Regioes atendidas" className="lg:col-span-2">
            <div className="flex flex-wrap gap-2">
              {REGION_OPTIONS.map((option) => {
                const active = regions.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleArrayValue("territoryRegions", option)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                      active
                        ? "border-cyan-400/50 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200"
                        : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </FilterField>
          <FilterField label="Faixa de contrato" className="lg:col-span-2">
            <div className="grid gap-3 md:grid-cols-2">
              <Input
                type="number"
                min={0}
                value={form.contractValueMin ?? 0}
                onChange={(event) => onChange({ ...form, contractValueMin: Number(event.target.value) })}
                placeholder="Valor minimo"
              />
              <Input
                type="number"
                min={0}
                value={form.contractValueMax ?? 0}
                onChange={(event) => onChange({ ...form, contractValueMax: Number(event.target.value) })}
                placeholder="Valor maximo"
              />
            </div>
          </FilterField>
          <FilterField label="Tipos de lead" className="lg:col-span-2">
            <div className="flex flex-wrap gap-2">
              {LEAD_TYPE_OPTIONS.map((option) => {
                const active = leadTypes.includes(option);
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => toggleArrayValue("leadTypes", option)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                      active
                        ? "border-fuchsia-400/50 bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-200"
                        : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          </FilterField>
          <FilterField label="Capacidade diaria">
            <Input
              type="number"
              min={1}
              value={form.dailyCapacity ?? 20}
              onChange={(event) => onChange({ ...form, dailyCapacity: Number(event.target.value) })}
            />
          </FilterField>
          <FilterField label="Limite de leads abertos">
            <Input
              type="number"
              min={1}
              value={form.openLeadLimit ?? 30}
              onChange={(event) => onChange({ ...form, openLeadLimit: Number(event.target.value) })}
            />
          </FilterField>
          <FilterField label="Peso de distribuicao">
            <Input
              type="number"
              min={1}
              value={form.assignmentWeight ?? 1}
              onChange={(event) => onChange({ ...form, assignmentWeight: Number(event.target.value) })}
            />
          </FilterField>
          <FilterField label="Prioridade">
            <Input
              type="number"
              min={1}
              value={form.priorityRank ?? 1}
              onChange={(event) => onChange({ ...form, priorityRank: Number(event.target.value) })}
            />
          </FilterField>
          <FilterField label="Horario disponivel" className="lg:col-span-2">
            <Input
              value={form.availableHoursLabel || ""}
              onChange={(event) => onChange({ ...form, availableHoursLabel: event.target.value, availableHours: parseAvailableHours(event.target.value) })}
              placeholder="Seg a sex, 08:00 as 18:00"
            />
          </FilterField>
          <FilterField label="Observacoes" className="lg:col-span-2">
            <Textarea value={form.notes || ""} onChange={(event) => onChange({ ...form, notes: event.target.value })} placeholder="Notas de territorio, escalacao ou SLA." />
          </FilterField>
          <div className="flex flex-wrap items-center gap-6 lg:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={Boolean(form.active ?? true)} onCheckedChange={(checked) => onChange({ ...form, active: checked })} />
              Ativo
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={Boolean(form.available ?? true)} onCheckedChange={(checked) => onChange({ ...form, available: checked })} />
              Disponivel para receber
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={Boolean(form.acceptsAutoAssign ?? true)} onCheckedChange={(checked) => onChange({ ...form, acceptsAutoAssign: checked })} />
              Aceita distribuicao automatica
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={isSaving || !form.name?.trim()}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar consultor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DistributionRuleDialog({
  open,
  onOpenChange,
  form,
  onChange,
  onSubmit,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: DistributionRulePayload & { city?: string; state?: string; region?: string; leadType?: string; campaignOrigin?: string; availabilityRequired?: boolean; dailyCapacity?: number; slaMinutes?: number; minContract?: number; maxContract?: number; };
  onChange: (next: DistributionRulePayload & { city?: string; state?: string; region?: string; leadType?: string; campaignOrigin?: string; availabilityRequired?: boolean; dailyCapacity?: number; slaMinutes?: number; minContract?: number; maxContract?: number; }) => void;
  onSubmit: () => void;
  isSaving: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto rounded-[1.5rem] border-border bg-card text-card-foreground shadow-2xl">
        <DialogHeader>
          <DialogTitle>Regra de distribuicao</DialogTitle>
          <DialogDescription>Configure prioridade, SLA e elegibilidade de forma persistente.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 md:grid-cols-2">
          <FilterField label="Nome da regra" className="md:col-span-2">
            <Input value={form.name} onChange={(event) => onChange({ ...form, name: event.target.value })} placeholder="Prioridade capital premium" />
          </FilterField>
          <FilterField label="Estrategia">
            <Select value={form.distributionMode} onValueChange={(value) => onChange({ ...form, distributionMode: value })}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="round_robin">Round-robin</SelectItem>
                <SelectItem value="weighted_performance">Peso por performance</SelectItem>
                <SelectItem value="priority_region">Prioridade por regiao</SelectItem>
                <SelectItem value="priority_contract">Prioridade por valor potencial</SelectItem>
                <SelectItem value="hybrid">Distribuicao hibrida</SelectItem>
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Fairness floor">
            <Input
              type="number"
              min={0}
              step="0.1"
              value={form.fairnessFloor}
              onChange={(event) => onChange({ ...form, fairnessFloor: Number(event.target.value) })}
            />
          </FilterField>
          <FilterField label="Cidade">
            <Input value={form.city || ""} onChange={(event) => onChange({ ...form, city: event.target.value })} placeholder="Cidade prioritaria" />
          </FilterField>
          <FilterField label="Estado">
            <Input value={form.state || ""} onChange={(event) => onChange({ ...form, state: event.target.value })} placeholder="UF" />
          </FilterField>
          <FilterField label="Regiao">
            <Input value={form.region || ""} onChange={(event) => onChange({ ...form, region: event.target.value })} placeholder="Capital, Sul..." />
          </FilterField>
          <FilterField label="Origem da campanha">
            <Input value={form.campaignOrigin || ""} onChange={(event) => onChange({ ...form, campaignOrigin: event.target.value })} placeholder="Origem ou nome da campanha" />
          </FilterField>
          <FilterField label="Tipo de lead">
            <Input value={form.leadType || ""} onChange={(event) => onChange({ ...form, leadType: event.target.value })} placeholder="Residencial, empresa..." />
          </FilterField>
          <FilterField label="Valor potencial" className="md:col-span-2">
            <div className="grid gap-3 md:grid-cols-2">
              <Input type="number" min={0} value={form.minContract ?? 0} onChange={(event) => onChange({ ...form, minContract: Number(event.target.value) })} placeholder="Valor minimo" />
              <Input type="number" min={0} value={form.maxContract ?? 0} onChange={(event) => onChange({ ...form, maxContract: Number(event.target.value) })} placeholder="Valor maximo" />
            </div>
          </FilterField>
          <FilterField label="Capacidade diaria">
            <Input type="number" min={1} value={form.dailyCapacity ?? 30} onChange={(event) => onChange({ ...form, dailyCapacity: Number(event.target.value) })} />
          </FilterField>
          <FilterField label="SLA de aceite (min)">
            <Input type="number" min={1} value={form.slaMinutes ?? form.reassignAfterMinutes} onChange={(event) => onChange({ ...form, slaMinutes: Number(event.target.value), reassignAfterMinutes: Number(event.target.value) })} />
          </FilterField>
          <FilterField label="Leads abertos por consultor">
            <Input type="number" min={1} value={form.maxOpenLeadsPerConsultant} onChange={(event) => onChange({ ...form, maxOpenLeadsPerConsultant: Number(event.target.value) })} />
          </FilterField>
          <FilterField label="Reatribuir apos (min)">
            <Input type="number" min={1} value={form.reassignAfterMinutes} onChange={(event) => onChange({ ...form, reassignAfterMinutes: Number(event.target.value) })} />
          </FilterField>
          <div className="flex flex-wrap items-center gap-6 md:col-span-2">
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={form.prioritizeRegion} onCheckedChange={(checked) => onChange({ ...form, prioritizeRegion: checked })} />
              Priorizar regiao
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={form.prioritizeContractValue} onCheckedChange={(checked) => onChange({ ...form, prioritizeContractValue: checked })} />
              Priorizar valor potencial
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={form.prioritizeLeadType} onCheckedChange={(checked) => onChange({ ...form, prioritizeLeadType: checked })} />
              Priorizar tipo de lead
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={Boolean(form.availabilityRequired ?? true)} onCheckedChange={(checked) => onChange({ ...form, availabilityRequired: checked })} />
              Exigir consultor disponivel
            </label>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <Switch checked={form.active} onCheckedChange={(checked) => onChange({ ...form, active: checked })} />
              Regra ativa
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={isSaving || !form.name.trim()}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar regra
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentDialog({
  open,
  onOpenChange,
  row,
  consultants,
  consultantId,
  reason,
  onConsultantChange,
  onReasonChange,
  onSubmit,
  isSaving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: DistributionQueueRow | null;
  consultants: ConsultantItem[];
  consultantId: string;
  reason: string;
  onConsultantChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onSubmit: () => void;
  isSaving: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-[1.5rem] border-border bg-card text-card-foreground shadow-2xl">
        <DialogHeader>
          <DialogTitle>Reatribuir lead</DialogTitle>
          <DialogDescription>
            {row ? `Defina o novo consultor para ${row.leadName}.` : "Selecione um consultor e o motivo da troca."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <FilterField label="Novo consultor">
            <Select value={consultantId || "placeholder"} onValueChange={(value) => onConsultantChange(value === "placeholder" ? "" : value)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecione o consultor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="placeholder">Selecione</SelectItem>
                {consultants.map((consultant) => (
                  <SelectItem key={consultant.id} value={consultant.id}>
                    {consultant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>
          <FilterField label="Motivo">
            <Textarea value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="Explique a troca manual, excecao de territorio ou carga." />
          </FilterField>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancelar
          </Button>
          <Button onClick={onSubmit} disabled={isSaving || !consultantId}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Route className="h-4 w-4" />}
            Confirmar reatribuicao
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RankingDetailDialog({
  title,
  open,
  onOpenChange,
  rows,
}: {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: Array<{ label: string; value: string }>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-[1.5rem] border-border bg-card text-card-foreground shadow-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Breakdown operacional do item selecionado.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-4 py-3">
              <span className="text-sm text-muted-foreground">{row.label}</span>
              <span className="text-sm font-semibold text-foreground">{row.value}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CommercialIntelligenceContent({ clientId }: { clientId: string }) {
  const crmClient = useOptionalCrmClient();
  const selectedCrmClient = crmClient?.selectedClient;
  const allowedTabs = selectedCrmClient?.n8n_settings?.allowed_tabs;

  const isSubTabAllowed = (subTabKey: string) => {
    if (!allowedTabs || !Array.isArray(allowedTabs)) return true;

    // Check consolidated key
    if (allowedTabs.includes(`inteligencia:${subTabKey}`)) return true;

    // Fallback mappings for backwards compatibility
    if (subTabKey === "performance") {
      return (
        allowedTabs.includes("inteligencia:visao-geral") ||
        allowedTabs.includes("inteligencia:metricas") ||
        allowedTabs.includes("inteligencia:rankings") ||
        allowedTabs.includes("inteligencia:campanhas")
      );
    }
    if (subTabKey === "equipe") {
      return (
        allowedTabs.includes("inteligencia:distribuicao") ||
        allowedTabs.includes("inteligencia:consultores")
      );
    }
    if (subTabKey === "ia-config") {
      return (
        allowedTabs.includes("inteligencia:insights") ||
        allowedTabs.includes("inteligencia:configuracoes")
      );
    }

    return false;
  };

  const intelligenceSubTabs = ["performance", "equipe", "ia-config"] as const;
  const allowedIntelligenceSubTabs = intelligenceSubTabs.filter(isSubTabAllowed);

  const [activeTab, setActiveTab] = useState<TabId>("performance");
  const [showDetailedMetrics, setShowDetailedMetrics] = useState(false);
  const [showCampaignsPanel, setShowCampaignsPanel] = useState(false);

  useEffect(() => {
    if (allowedIntelligenceSubTabs.length > 0) {
      const isCurrentAllowed = allowedIntelligenceSubTabs.includes(activeTab);
      if (!isCurrentAllowed) {
        setActiveTab(allowedIntelligenceSubTabs[0] as TabId);
      }
    }
  }, [activeTab, allowedIntelligenceSubTabs]);

  const [draftFilters, setDraftFilters] = useState<CommercialIntelligenceFilters>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<CommercialIntelligenceFilters>(DEFAULT_FILTERS);
  const [metricSort, setMetricSort] = useState<{ key: keyof CommercialMetricRow; order: SortOrder }>({
    key: "current",
    order: "desc",
  });
  const [consultantSearch, setConsultantSearch] = useState("");
  const [consultantPage, setConsultantPage] = useState(1);
  const [consultantDialogOpen, setConsultantDialogOpen] = useState(false);
  const [consultantDetail, setConsultantDetail] = useState<ConsultantItem | null>(null);
  const [editingConsultantId, setEditingConsultantId] = useState<string | null>(null);
  const [consultantForm, setConsultantForm] = useState<ConsultantPayload & { availableHoursLabel?: string }>({
    clientId,
    name: "",
    phone: "",
    email: "",
    city: "",
    state: "",
    territoryCities: [],
    territoryStates: [],
    territoryRegions: [],
    contractValueMin: 0,
    contractValueMax: 0,
    leadTypes: [],
    dailyCapacity: 20,
    openLeadLimit: 30,
    assignmentWeight: 1,
    priorityRank: 1,
    available: true,
    active: true,
    position: "",
    availableHours: {},
    acceptsAutoAssign: true,
    notes: "",
    availableHoursLabel: "",
  });
  const [ruleDialogOpen, setRuleDialogOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState<DistributionRulePayload & { city?: string; state?: string; region?: string; leadType?: string; campaignOrigin?: string; availabilityRequired?: boolean; dailyCapacity?: number; slaMinutes?: number; minContract?: number; maxContract?: number; }>({
    clientId,
    name: "",
    distributionMode: "round_robin",
    prioritizeRegion: false,
    prioritizeContractValue: false,
    prioritizeLeadType: false,
    maxOpenLeadsPerConsultant: 30,
    reassignAfterMinutes: 30,
    fairnessFloor: 1,
    active: true,
    config: {},
    city: "",
    state: "",
    region: "",
    leadType: "",
    campaignOrigin: "",
    availabilityRequired: true,
    dailyCapacity: 30,
    slaMinutes: 30,
    minContract: 0,
    maxContract: 0,
  });
  const [queuePage, setQueuePage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [campaignSearch, setCampaignSearch] = useState("");
  const [campaignPage, setCampaignPage] = useState(1);
  const [campaignDetail, setCampaignDetail] = useState<CampaignPerformanceItem | null>(null);
  const [compareCampaignA, setCompareCampaignA] = useState("");
  const [compareCampaignB, setCompareCampaignB] = useState("");
  const [settingsDraft, setSettingsDraft] = useState<CommercialIntelligenceSettings>(DEFAULT_SETTINGS);
  const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
  const [selectedAssignmentRow, setSelectedAssignmentRow] = useState<DistributionQueueRow | null>(null);
  const [assignmentConsultantId, setAssignmentConsultantId] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [rankingCityCriterion, setRankingCityCriterion] = useState<keyof CommercialRankingCity>("qualificationRate");
  const [rankingCityOrder, setRankingCityOrder] = useState<SortOrder>("desc");
  const [rankingCampaignCriterion, setRankingCampaignCriterion] = useState<keyof CommercialRankingCampaign>("qualificationRate");
  const [rankingCampaignOrder, setRankingCampaignOrder] = useState<SortOrder>("desc");
  const [rankingConsultantCriterion, setRankingConsultantCriterion] = useState<keyof CommercialRankingConsultant>("conversionRate");
  const [rankingConsultantOrder, setRankingConsultantOrder] = useState<SortOrder>("desc");
  const [rankingDetailRows, setRankingDetailRows] = useState<Array<{ label: string; value: string }>>([]);
  const [rankingDetailTitle, setRankingDetailTitle] = useState("");
  const [rankingDetailOpen, setRankingDetailOpen] = useState(false);
  const [insightSeverity, setInsightSeverity] = useState("all");
  const [insightType, setInsightType] = useState("all");
  const [insightCampaign, setInsightCampaign] = useState("all");
  const [insightCity, setInsightCity] = useState("all");

  const { data, isLoading, error, refetch, isFetching } = useCommercialIntelligence(clientId, appliedFilters);
  const createConsultant = useCreateConsultant();
  const updateConsultant = useUpdateConsultant();
  const deleteConsultant = useDeleteConsultant();
  const createRule = useCreateDistributionRule();
  const updateRule = useUpdateDistributionRule();
  const assignmentAction = useAssignmentAction();
  const saveSettings = useSaveCommercialIntelligenceSettings();
  const updateInsightStatus = useUpdateInsightStatus();

  useEffect(() => {
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    setConsultantForm((current) => ({ ...current, clientId }));
    setRuleForm((current) => ({ ...current, clientId }));
  }, [clientId]);

  useEffect(() => {
    if (!data) return;
    setSettingsDraft(data.settings || DEFAULT_SETTINGS);
  }, [data]);

  const options = data?.filters.options;
  const consultants = useMemo(() => data?.consultants.items ?? [], [data?.consultants.items]);
  const campaigns = useMemo(() => data?.campaigns.items ?? [], [data?.campaigns.items]);
  const insights = useMemo(() => data?.insights.items ?? [], [data?.insights.items]);
  const distributionRules = useMemo(() => data?.distribution.rules ?? [], [data?.distribution.rules]);
  const distributionQueue = useMemo(() => data?.distribution.queue ?? [], [data?.distribution.queue]);
  const distributionHistory = useMemo(() => data?.distribution.history ?? [], [data?.distribution.history]);

  const metricsSorted = useMemo(() => {
    if (!data) return [];
    return [...data.metrics.items].sort((a, b) => compareValues(a[metricSort.key], b[metricSort.key], metricSort.order));
  }, [data, metricSort]);

  const consultantsFiltered = useMemo(() => {
    return consultants.filter((consultant) => {
      const haystack = [
        consultant.name,
        consultant.email,
        consultant.phone,
        consultant.city,
        consultant.state,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(consultantSearch.toLowerCase());
    });
  }, [consultants, consultantSearch]);

  const campaignsFiltered = useMemo(() => {
    return campaigns.filter((campaign) => campaign.name.toLowerCase().includes(campaignSearch.toLowerCase()));
  }, [campaigns, campaignSearch]);

  const insightsFiltered = useMemo(() => {
    return insights.filter((insight) => {
      if (insightSeverity !== "all" && insight.severity !== insightSeverity) return false;
      if (insightType !== "all" && insight.scope !== insightType) return false;
      if (insightCampaign !== "all") {
        const option = options?.campaigns.find((item) => item.id === insightCampaign || item.value === insightCampaign);
        const name = option?.label || option?.name || "";
        if (![insight.title, insight.message, insight.actionTargetName].join(" ").toLowerCase().includes(name.toLowerCase())) return false;
      }
      if (insightCity !== "all" && ![insight.title, insight.message, insight.actionTargetName].join(" ").toLowerCase().includes(insightCity.toLowerCase())) {
        return false;
      }
      return true;
    });
  }, [insightCampaign, insightCity, insightSeverity, insightType, insights, options?.campaigns]);

  const sortedCities = useMemo(() => {
    const items = [...(data?.rankings.cities || [])];
    items.sort((a, b) => compareValues(a[rankingCityCriterion], b[rankingCityCriterion], rankingCityOrder));
    return items;
  }, [data?.rankings.cities, rankingCityCriterion, rankingCityOrder]);

  const sortedCampaigns = useMemo(() => {
    const items = [...(data?.rankings.campaigns || [])];
    items.sort((a, b) => compareValues(a[rankingCampaignCriterion], b[rankingCampaignCriterion], rankingCampaignOrder));
    return items;
  }, [data?.rankings.campaigns, rankingCampaignCriterion, rankingCampaignOrder]);

  const sortedConsultants = useMemo(() => {
    const items = [...(data?.rankings.consultants || [])];
    items.sort((a, b) => compareValues(a[rankingConsultantCriterion], b[rankingConsultantCriterion], rankingConsultantOrder));
    return items;
  }, [data?.rankings.consultants, rankingConsultantCriterion, rankingConsultantOrder]);

  const pagedConsultants = paginate(consultantsFiltered, consultantPage, 8);
  const pagedCampaigns = paginate(campaignsFiltered, campaignPage, 8);
  const pagedQueue = paginate(distributionQueue, queuePage, 8);
  const pagedHistory = paginate(distributionHistory, historyPage, 8);

  const compareCampaignRows = useMemo(() => {
    return campaigns.filter((campaign) => [compareCampaignA, compareCampaignB].includes(campaign.id));
  }, [campaigns, compareCampaignA, compareCampaignB]);

  const consultantSummary = useMemo(() => {
    const active = consultants.filter((item) => item.status === "ativo").length;
    const available = consultants.filter((item) => item.available).length;
    const revenue = consultants.reduce((sum, item) => sum + Number(item.revenue || 0), 0);
    return { active, available, revenue };
  }, [consultants]);

  const handleApplyFilters = () => {
    setAppliedFilters(draftFilters);
    toast.success("Filtros aplicados na inteligencia comercial.");
  };

  const handleClearFilters = () => {
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    toast.success("Filtros limpos.");
  };

  const handleExport = () => {
    if (!data) return;

    if (activeTab === "performance") {
      exportRows("inteligencia-comercial-performance.csv", [
        ...data.overview.kpis.map((item) => ({
          tipo: "KPI",
          nome: item.title,
          valor: item.valueLabel,
          delta: item.delta === null ? "—" : deltaLabel(item.delta, item.kind),
          extra: item.kind,
        })),
        ...metricsSorted.map((metric) => ({
          tipo: "Metrica Detalhada",
          nome: metric.name,
          valor: metric.currentLabel,
          delta: metric.deltaLabel,
          extra: metric.direction,
        })),
        ...campaignsFiltered.map((campaign) => ({
          tipo: "Campanha",
          nome: campaign.name,
          valor: formatPercent(campaign.qualificationRate),
          delta: campaign.roiEstimated === null ? "—" : `${campaign.roiEstimated.toFixed(2)}x`,
          extra: campaign.status,
        })),
      ]);
      return;
    }

    if (activeTab === "equipe") {
      exportRows("inteligencia-comercial-equipe.csv", [
        ...consultantsFiltered.map((consultant) => ({
          tipo: "Consultor",
          nome: consultant.name,
          status: consultant.status,
          disponivel: consultant.available ? "Sim" : "Nao",
          conversao: formatPercent(consultant.conversionRate),
          tempo_resposta: formatHours(consultant.responseTimeHours),
          leads: `${consultant.leadsReceived}/${consultant.dailyCapacity}`,
          receita: formatCurrency(consultant.revenue),
        })),
        ...distributionQueue.map((row) => ({
          tipo: "Fila Ativa",
          nome: row.leadName,
          status: row.status,
          disponivel: row.slaStatus,
          conversao: row.ruleApplied,
          tempo_resposta: row.city,
          leads: row.campaignName,
          receita: formatCurrency(row.potentialValue),
        })),
      ]);
      return;
    }

    if (activeTab === "ia-config") {
      exportRows("inteligencia-comercial-ia-config.csv", [
        ...insightsFiltered.map((insight) => ({
          tipo: "Insight Brain",
          titulo: insight.title,
          severidade: insight.severity,
          impacto: insight.impact,
          recomendacao: insight.recommendation,
        })),
        {
          tipo: "Ajustes",
          titulo: "Limiar de qualificacao",
          severidade: String(settingsDraft.qualificationThreshold),
          impacto: `SLA Padrao: ${settingsDraft.slaMinutes} min`,
          recomendacao: `Estrategia: ${settingsDraft.distributionStrategy}`,
        },
      ]);
      return;
    }
  };

  const resetConsultantForm = () => {
    setConsultantForm({
      clientId,
      name: "",
      phone: "",
      email: "",
      city: "",
      state: "",
      territoryCities: [],
      territoryStates: [],
      territoryRegions: [],
      contractValueMin: 0,
      contractValueMax: 0,
      leadTypes: [],
      dailyCapacity: 20,
      openLeadLimit: 30,
      assignmentWeight: 1,
      priorityRank: 1,
      available: true,
      active: true,
      position: "",
      availableHours: {},
      acceptsAutoAssign: true,
      notes: "",
      availableHoursLabel: "",
    });
    setEditingConsultantId(null);
  };

  const openConsultantForEdit = (consultant: ConsultantItem) => {
    setEditingConsultantId(consultant.id);
    setConsultantForm({
      clientId,
      name: consultant.name,
      phone: consultant.phone,
      email: consultant.email,
      city: consultant.city,
      state: consultant.state,
      territoryCities: consultant.territoryCities,
      territoryStates: consultant.territoryStates,
      territoryRegions: consultant.territoryRegions,
      contractValueMin: consultant.contractValueMin,
      contractValueMax: consultant.contractValueMax,
      leadTypes: consultant.leadTypes,
      dailyCapacity: consultant.dailyCapacity,
      openLeadLimit: consultant.openLeadLimit,
      assignmentWeight: consultant.assignmentWeight,
      priorityRank: consultant.priorityRank,
      available: consultant.available,
      active: consultant.status === "ativo",
      position: consultant.position,
      availableHours: consultant.availableHours,
      acceptsAutoAssign: consultant.acceptsAutoAssign,
      notes: consultant.notes,
      availableHoursLabel: serializeAvailableHours(consultant.availableHours),
    });
    setConsultantDialogOpen(true);
  };

  const handleConsultantSubmit = async () => {
    try {
      const payload: ConsultantPayload = {
        ...consultantForm,
        clientId,
        availableHours: parseAvailableHours(consultantForm.availableHoursLabel || ""),
      };

      if (editingConsultantId) {
        await updateConsultant.mutateAsync({ id: editingConsultantId, ...payload });
        toast.success("Consultor atualizado com sucesso.");
      } else {
        await createConsultant.mutateAsync(payload);
        toast.success("Consultor cadastrado com sucesso.");
      }

      setConsultantDialogOpen(false);
      resetConsultantForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar consultor.");
    }
  };

  const handleDeleteConsultant = async (consultant: ConsultantItem) => {
    if (!window.confirm(`Remover ${consultant.name}? Esta acao nao pode ser desfeita.`)) return;
    try {
      await deleteConsultant.mutateAsync(consultant.id);
      toast.success("Consultor removido com sucesso.");
      if (consultantDetail?.id === consultant.id) setConsultantDetail(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao remover consultor.");
    }
  };

  const handleConsultantStatusToggle = async (consultant: ConsultantItem, nextActive: boolean) => {
    try {
      await updateConsultant.mutateAsync({
        id: consultant.id,
        clientId,
        name: consultant.name,
        phone: consultant.phone,
        email: consultant.email,
        city: consultant.city,
        state: consultant.state,
        territoryCities: consultant.territoryCities,
        territoryStates: consultant.territoryStates,
        territoryRegions: consultant.territoryRegions,
        contractValueMin: consultant.contractValueMin,
        contractValueMax: consultant.contractValueMax,
        leadTypes: consultant.leadTypes,
        dailyCapacity: consultant.dailyCapacity,
        openLeadLimit: consultant.openLeadLimit,
        assignmentWeight: consultant.assignmentWeight,
        priorityRank: consultant.priorityRank,
        available: nextActive,
        active: nextActive,
        position: consultant.position,
        availableHours: consultant.availableHours,
        acceptsAutoAssign: consultant.acceptsAutoAssign,
        notes: consultant.notes,
      });
      toast.success(nextActive ? "Consultor ativado." : "Consultor desativado.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar status do consultor.");
    }
  };

  const handleEligibilityTest = (consultant: ConsultantItem) => {
    const matchesCity = !draftFilters.city || consultant.territoryCities.length === 0 || consultant.territoryCities.includes(draftFilters.city);
    const hasCapacity = consultant.dailyCapacity > consultant.leadsReceived;
    const acceptsStatus = consultant.available && consultant.acceptsAutoAssign;

    const reasons = [
      matchesCity ? "territorio compativel" : "fora do territorio",
      hasCapacity ? "capacidade disponivel" : "sem capacidade diaria",
      acceptsStatus ? "recebimento automatico ativo" : "recebimento automatico bloqueado",
    ];

    toast.message(`Elegibilidade de ${consultant.name}`, {
      description: reasons.join(" • "),
    });
  };

  const resetRuleForm = () => {
    setRuleForm({
      clientId,
      name: "",
      distributionMode: "round_robin",
      prioritizeRegion: false,
      prioritizeContractValue: false,
      prioritizeLeadType: false,
      maxOpenLeadsPerConsultant: 30,
      reassignAfterMinutes: 30,
      fairnessFloor: 1,
      active: true,
      config: {},
      city: "",
      state: "",
      region: "",
      leadType: "",
      campaignOrigin: "",
      availabilityRequired: true,
      dailyCapacity: 30,
      slaMinutes: 30,
      minContract: 0,
      maxContract: 0,
    });
    setEditingRuleId(null);
  };

  const openRuleForEdit = (rule: DistributionRuleItem) => {
    setEditingRuleId(rule.id);
    const config = (rule.config || {}) as Record<string, unknown>;
    setRuleForm({
      clientId,
      name: rule.name,
      distributionMode: rule.distributionMode,
      prioritizeRegion: rule.prioritizeRegion,
      prioritizeContractValue: rule.prioritizeContractValue,
      prioritizeLeadType: rule.prioritizeLeadType,
      maxOpenLeadsPerConsultant: rule.maxOpenLeadsPerConsultant,
      reassignAfterMinutes: rule.reassignAfterMinutes,
      fairnessFloor: rule.fairnessFloor,
      active: rule.active,
      config,
      city: typeof config.city === "string" ? config.city : "",
      state: typeof config.state === "string" ? config.state : "",
      region: typeof config.region === "string" ? config.region : "",
      leadType: typeof config.leadType === "string" ? config.leadType : "",
      campaignOrigin: typeof config.campaignOrigin === "string" ? config.campaignOrigin : "",
      availabilityRequired: typeof config.availabilityRequired === "boolean" ? config.availabilityRequired : true,
      dailyCapacity: typeof config.dailyCapacity === "number" ? config.dailyCapacity : 30,
      slaMinutes: typeof config.slaMinutes === "number" ? config.slaMinutes : rule.reassignAfterMinutes,
      minContract: typeof config.minContract === "number" ? config.minContract : 0,
      maxContract: typeof config.maxContract === "number" ? config.maxContract : 0,
    });
    setRuleDialogOpen(true);
  };

  const handleRuleSubmit = async () => {
    try {
      const payload: DistributionRulePayload = {
        clientId,
        name: ruleForm.name,
        distributionMode: ruleForm.distributionMode,
        prioritizeRegion: ruleForm.prioritizeRegion,
        prioritizeContractValue: ruleForm.prioritizeContractValue,
        prioritizeLeadType: ruleForm.prioritizeLeadType,
        maxOpenLeadsPerConsultant: ruleForm.maxOpenLeadsPerConsultant,
        reassignAfterMinutes: ruleForm.reassignAfterMinutes,
        fairnessFloor: ruleForm.fairnessFloor,
        active: ruleForm.active,
        config: {
          city: ruleForm.city || null,
          state: ruleForm.state || null,
          region: ruleForm.region || null,
          leadType: ruleForm.leadType || null,
          campaignOrigin: ruleForm.campaignOrigin || null,
          availabilityRequired: ruleForm.availabilityRequired ?? true,
          dailyCapacity: ruleForm.dailyCapacity ?? 30,
          slaMinutes: ruleForm.slaMinutes ?? ruleForm.reassignAfterMinutes,
          minContract: ruleForm.minContract ?? 0,
          maxContract: ruleForm.maxContract ?? 0,
        },
      };

      if (editingRuleId) {
        await updateRule.mutateAsync({ id: editingRuleId, ...payload });
        toast.success("Regra de distribuicao atualizada.");
      } else {
        await createRule.mutateAsync(payload);
        toast.success("Regra de distribuicao criada.");
      }

      setRuleDialogOpen(false);
      resetRuleForm();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar regra.");
    }
  };

  const openAssignmentDialog = (row: DistributionQueueRow) => {
    setSelectedAssignmentRow(row);
    setAssignmentConsultantId(row.consultantId || "");
    setAssignmentReason("");
    setAssignmentDialogOpen(true);
  };

  const handleAssignmentMutation = async (payload: { id: string; action: string; consultantId?: string; reason?: string }, successMessage: string) => {
    try {
      await assignmentAction.mutateAsync(payload);
      toast.success(successMessage);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao executar acao na fila.");
    }
  };

  const handleAssignmentSubmit = async () => {
    if (!selectedAssignmentRow || !assignmentConsultantId) return;
    await handleAssignmentMutation(
      {
        id: selectedAssignmentRow.id,
        action: "reatribuir",
        consultantId: assignmentConsultantId,
        reason: assignmentReason,
      },
      "Lead reatribuido com sucesso.",
    );
    setAssignmentDialogOpen(false);
  };

  const handleStrategyToggle = async (strategy: string, enabled: boolean) => {
    if (!enabled && settingsDraft.distributionStrategy === strategy) {
      toast.info("Mantenha uma estrategia principal ativa antes de desativar esta.");
      return;
    }

    const nextStrategy = enabled ? strategy : settingsDraft.distributionStrategy;
    const next = { ...settingsDraft, distributionStrategy: nextStrategy };
    setSettingsDraft(next);
    try {
      await saveSettings.mutateAsync({ ...next, clientId });
      toast.success("Estrategia principal de distribuicao atualizada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao atualizar estrategia.");
      setSettingsDraft(data?.settings || DEFAULT_SETTINGS);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await saveSettings.mutateAsync({ ...settingsDraft, clientId });
      toast.success("Configuracoes salvas com sucesso.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao salvar configuracoes.");
    }
  };

  const handleRestoreSettings = () => {
    setSettingsDraft(DEFAULT_SETTINGS);
    toast.info("Valores padrao carregados. Clique em salvar para persistir.");
  };

  const openRankingDetails = (title: string, rows: Array<{ label: string; value: string }>) => {
    setRankingDetailTitle(title);
    setRankingDetailRows(rows);
    setRankingDetailOpen(true);
  };

  const handleInsightAction = async (insight: InsightItem) => {
    if (insight.actionType === "open_campaign") {
      const campaign = campaigns.find((item) => item.id === insight.actionTargetId) || campaigns.find((item) => item.name === insight.actionTargetName);
      setActiveTab("performance");
      if (campaign) setCampaignDetail(campaign);
    } else if (insight.actionType === "open_consultant") {
      const consultant = consultants.find((item) => item.id === insight.actionTargetId) || consultants.find((item) => item.name === insight.actionTargetName);
      setActiveTab("equipe");
      if (consultant) setConsultantDetail(consultant);
    } else if (insight.actionType === "adjust_rule" || insight.actionType === "redistribute") {
      setActiveTab("equipe");
    } else if (insight.actionType === "export_report") {
      handleExport();
    }

    if (insight.id) {
      try {
        await updateInsightStatus.mutateAsync({ id: insight.id, status: "read" });
      } catch {
        // noop
      }
    }
  };

  if (isLoading) {
    return <LoadingState />;
  }

  if (error) {
    return (
      <div className="space-y-3">
        <ErrorMessage message={(error as Error).message} variant="dashboard" />
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCcw className="h-4 w-4" />
          Tentar novamente
        </Button>
      </div>
    );
  }

  if (!data) {
    return <EmptyState title="Inteligencia comercial indisponivel" description="Nao foi possivel carregar dados operacionais para esta empresa." />;
  }

  if (allowedIntelligenceSubTabs.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-border bg-card p-6">
        <p className="text-sm text-slate-400 text-center">Você não tem permissão para acessar nenhuma sub-aba da Inteligência Comercial.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <DashboardPanel
        title="Operacao em tempo real"
        subtitle="Filtros, exportacao e recarga para governar a camada comercial sem sair do CRM."
        className="p-4"
      >
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-6">
            <FilterField label="Periodo">
              <Select value={draftFilters.period || "30d"} onValueChange={(value) => setDraftFilters((current) => ({ ...current, period: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Periodo" />
                </SelectTrigger>
                <SelectContent>
                  {PERIOD_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Campanha">
              <Select value={draftFilters.campaignId || "all"} onValueChange={(value) => setDraftFilters((current) => ({ ...current, campaignId: value === "all" ? "" : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as campanhas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as campanhas</SelectItem>
                  {(options?.campaigns || []).map((option) => (
                    <SelectItem key={option.id || option.value || option.name} value={option.id || option.value || option.name || ""}>
                      {option.label || option.name || option.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Cidade">
              <Select value={draftFilters.city || "all"} onValueChange={(value) => setDraftFilters((current) => ({ ...current, city: value === "all" ? "" : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Todas as cidades" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas as cidades</SelectItem>
                  {(options?.cities || []).map((option) => {
                    const value = option.value || option.name || option.label || "";
                    return (
                      <SelectItem key={value} value={value}>
                        {option.label || option.name || value}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Consultor">
              <Select value={draftFilters.consultantId || "all"} onValueChange={(value) => setDraftFilters((current) => ({ ...current, consultantId: value === "all" ? "" : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos os consultores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os consultores</SelectItem>
                  {(options?.consultants || []).map((option) => (
                    <SelectItem key={option.id || option.value || option.name} value={option.id || option.value || option.name || ""}>
                      {option.label || option.name || option.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Status do lead">
              <Select value={draftFilters.status || "all"} onValueChange={(value) => setDraftFilters((current) => ({ ...current, status: value === "all" ? "" : value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Todos os status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os status</SelectItem>
                  {(options?.statuses || []).map((option) => {
                    const value = option.value || option.name || option.label || "";
                    return (
                      <SelectItem key={value} value={value}>
                        {option.label || option.name || value}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </FilterField>

            <FilterField label="Atualizacao">
              <div className="flex items-center gap-2">
                <Button onClick={handleApplyFilters} className="flex-1">
                  <Filter className="h-4 w-4" />
                  Aplicar
                </Button>
                <Button variant="outline" size="icon" onClick={handleClearFilters} title="Limpar filtros">
                  <CircleSlash className="h-4 w-4" />
                </Button>
              </div>
            </FilterField>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
              {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
              Atualizar dados
            </Button>
            <Button variant="outline" onClick={handleExport}>
              <Download className="h-4 w-4" />
              Exportar visao
            </Button>
            <Badge variant="outline" className="border-cyan-400/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200">
              {data.client.name}
            </Badge>
            <Badge variant="outline">{PERIOD_OPTIONS.find((option) => option.value === appliedFilters.period)?.label || "30 dias"}</Badge>
            <span className="text-xs text-muted-foreground">Atualizado em {new Date(data.generatedAt).toLocaleString("pt-BR")}</span>
          </div>
        </div>
      </DashboardPanel>

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TabId)} className="space-y-4">
        <div className="rounded-[1.5rem] border border-border bg-card/60 p-2 backdrop-blur-md">
          <TabsList className="grid h-auto w-full gap-2 bg-transparent p-0" style={{ gridTemplateColumns: `repeat(auto-fit, minmax(110px, 1fr))` }}>
            {isSubTabAllowed("performance") && (
              <TabsTrigger value="performance" className="rounded-2xl px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em]">
                Performance Comercial
              </TabsTrigger>
            )}
            {isSubTabAllowed("equipe") && (
              <TabsTrigger value="equipe" className="rounded-2xl px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em]">
                Equipe & Roteamento
              </TabsTrigger>
            )}
            {isSubTabAllowed("ia-config") && (
              <TabsTrigger value="ia-config" className="rounded-2xl px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em]">
                Ajustes & Diagnósticos
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        <TabsContent value="performance" className="space-y-4">
          <KpiGrid cols={4} className="gap-3">
            {data.overview.kpis.map((item) => (
              <KpiCard
                key={item.key}
                title={item.title}
                value={item.valueLabel}
                tone={toneFromAccent(item.tone)}
                trend={item.delta === null ? "sem comparativo" : deltaLabel(item.delta, item.kind)}
                icon={
                  item.key.includes("response") ? (
                    <MessageCircleReply className="h-4 w-4" />
                  ) : item.key.includes("revenue") ? (
                    <HandCoins className="h-4 w-4" />
                  ) : item.key.includes("qualification") ? (
                    <Target className="h-4 w-4" />
                  ) : item.key.includes("closing") ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : item.key.includes("time") ? (
                    <CalendarClock className="h-4 w-4" />
                  ) : (
                    <Gauge className="h-4 w-4" />
                  )
                }
              />
            ))}
          </KpiGrid>

          <div className="grid gap-3 xl:grid-cols-2">
            <DashboardPanel title="Evolucao de qualificados" subtitle="Qualificados, respondidos e fechamentos ao longo do periodo" className="p-4">
              {data.overview.charts.qualifiedByDay.length ? (
                <ChartContainer
                  config={{
                    qualificados: { label: "Qualificados", color: "#22d3ee" },
                    respondidos: { label: "Respondidos", color: "#a78bfa" },
                    fechamentos: { label: "Fechamentos", color: "#fb7185" },
                  }}
                  className="h-[300px] w-full"
                >
                  <LineChart data={data.overview.charts.qualifiedByDay}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="date" tickLine={false} axisLine={false} />
                    <YAxis tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="qualificados" stroke="var(--color-qualificados)" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="respondidos" stroke="var(--color-respondidos)" strokeWidth={2.5} dot={false} />
                    <Line type="monotone" dataKey="fechamentos" stroke="var(--color-fechamentos)" strokeWidth={2.5} dot={false} />
                    <ChartLegend content={<ChartLegendContent />} />
                  </LineChart>
                </ChartContainer>
              ) : (
                <EmptyChart title="Sem evolucao registrada" description="Ative conversas, qualificacoes ou fechamentos para habilitar o grafico." />
              )}
            </DashboardPanel>

            <DashboardPanel title="Funil de conversao" subtitle="Entrada, resposta, qualificacao e fechamento no periodo" className="p-4">
              {data.overview.charts.funnel.length ? (
                <ChartContainer config={{ value: { label: "Volume", color: "#22d3ee" } }} className="h-[300px] w-full">
                  <FunnelChart>
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Funnel dataKey="value" data={data.overview.charts.funnel} isAnimationActive>
                      <LabelList position="right" fill="currentColor" stroke="none" dataKey="stage" />
                    </Funnel>
                  </FunnelChart>
                </ChartContainer>
              ) : (
                <EmptyChart title="Funil indisponivel" description="Precisamos de leads abordados e respostas para desenhar o funil." />
              )}
            </DashboardPanel>
          </div>

          <div className="grid gap-3 xl:grid-cols-3">
            <DashboardPanel title="Performance por cidade" subtitle="Leads, qualificados e receita" className="p-4 xl:col-span-1">
              {data.overview.charts.byCity.length ? (
                <ChartContainer config={{ qualificados: { label: "Qualificados", color: "#22d3ee" } }} className="h-[280px] w-full">
                  <BarChart data={data.overview.charts.byCity.slice(0, 6)} layout="vertical" margin={{ left: 8 }}>
                    <CartesianGrid horizontal={false} />
                    <XAxis type="number" hide />
                    <YAxis dataKey="name" type="category" width={90} tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="qualificados" fill="var(--color-qualificados)" radius={[0, 10, 10, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyChart title="Sem cidades suficientes" description="Quando os leads tiverem cidade preenchida, este ranking aparece aqui." />
              )}
            </DashboardPanel>

            <DashboardPanel title="Performance por campanha" subtitle="Qualificados e receita gerada" className="p-4 xl:col-span-1">
              {data.overview.charts.byCampaign.length ? (
                <ChartContainer
                  config={{
                    qualificados: { label: "Qualificados", color: "#a78bfa" },
                    receita: { label: "Receita", color: "#22d3ee" },
                  }}
                  className="h-[280px] w-full"
                >
                  <BarChart data={data.overview.charts.byCampaign.slice(0, 6)}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} angle={-15} height={60} />
                    <YAxis tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend />
                    <Bar dataKey="qualificados" fill="var(--color-qualificados)" radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyChart title="Sem campanhas no recorte" description="Importe ou dispare campanhas para acompanhar a performance aqui." />
              )}
            </DashboardPanel>

            <DashboardPanel title="Distribuicao por status" subtitle="Leitura rapida da base atual" className="p-4 xl:col-span-1">
              {data.overview.charts.statusDonut.length ? (
                <ChartContainer config={{ status: { label: "Status", color: "#22d3ee" } }} className="h-[280px] w-full">
                  <PieChart>
                    <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                    <Pie data={data.overview.charts.statusDonut} dataKey="value" nameKey="name" innerRadius={68} outerRadius={102} paddingAngle={2}>
                      {data.overview.charts.statusDonut.map((entry, index) => (
                        <Cell key={entry.name} fill={STATUS_COLORS[index % STATUS_COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              ) : (
                <EmptyChart title="Sem status para distribuir" description="Assim que houver leads com status, a distribuicao visual aparece aqui." />
              )}
            </DashboardPanel>
          </div>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.9fr)]">
            <DashboardPanel title="Comparativo entre consultores" subtitle="Conversao, receita e volume recebido" className="p-4">
              {data.overview.charts.consultantComparison.length ? (
                <ChartContainer config={{ conversao: { label: "Conversao", color: "#22d3ee" } }} className="h-[300px] w-full">
                  <BarChart data={data.overview.charts.consultantComparison.slice(0, 6)}>
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} angle={-12} height={56} />
                    <YAxis tickLine={false} axisLine={false} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="conversao" fill="var(--color-conversao)" radius={[10, 10, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              ) : (
                <EmptyChart title="Sem consultores atribuidos" description="Atribua leads para destravar o comparativo operacional." />
              )}
            </DashboardPanel>

            <DashboardPanel title="Alertas principais" subtitle="Leituras automaticas da operacao com acao rapida" className="p-4">
              <div className="space-y-3">
                {data.overview.alerts.length ? (
                  data.overview.alerts.slice(0, 4).map((insight) => (
                    <div key={`${insight.title}-${insight.generatedAt}`} className="rounded-[1.2rem] border border-border bg-card p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{insight.title}</p>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">{insight.message}</p>
                        </div>
                        <Badge className={cn("border-0", severityClasses(insight.severity))}>{insight.severity}</Badge>
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <span className="text-xs text-muted-foreground">{insight.impact}</span>
                        <Button variant="outline" size="sm" onClick={() => void handleInsightAction(insight)}>
                          {insight.actionLabel}
                        </Button>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState message="Nenhum alerta critico para a empresa selecionada." />
                )}
              </div>
            </DashboardPanel>
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <DashboardPanel title="Cidades em destaque" subtitle="Resumo rapido do ranking de cidades" className="p-4">
              <div className="space-y-2">
                {data.overview.rankingSummary.cities.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      openRankingDetails(item.name, [
                        { label: "Taxa de qualificacao", value: formatPercent(item.qualificationRate) },
                        { label: "Taxa de conversao", value: formatPercent(item.conversionRate) },
                        { label: "Volume de leads", value: formatNumber(item.volumeLeads) },
                        { label: "Receita gerada", value: formatCurrency(item.revenue) },
                        { label: "Tempo medio ate fechamento", value: formatHours(item.avgCloseHours) },
                      ])
                    }
                    className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-3 py-3 text-left transition hover:border-cyan-500/50 hover:bg-cyan-500/5"
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.name}</p>
                      <p className="text-xs text-muted-foreground">Qualificacao {formatPercent(item.qualificationRate)}</p>
                    </div>
                    <MapPinned className="h-4 w-4 text-cyan-600 dark:text-cyan-200" />
                  </button>
                ))}
              </div>
            </DashboardPanel>

            <DashboardPanel title="Campanhas em destaque" subtitle="Melhores campanhas no recorte atual" className="p-4">
              <div className="space-y-2">
                {data.overview.rankingSummary.campaigns.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() =>
                      openRankingDetails(item.name, [
                        { label: "Taxa de resposta", value: formatPercent(item.responseRate) },
                        { label: "Taxa de qualificacao", value: formatPercent(item.qualificationRate) },
                        { label: "Taxa de conversao", value: formatPercent(item.conversionRate) },
                        { label: "Qualificados", value: formatNumber(item.qualifiedLeads) },
                        { label: "Receita", value: formatCurrency(item.revenue) },
                      ])
                    }
                    className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-3 py-3 text-left transition hover:border-violet-500/50 hover:bg-violet-500/5"
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.name}</p>
                      <p className="text-xs text-muted-foreground">Resposta {formatPercent(item.responseRate)}</p>
                    </div>
                    <Target className="h-4 w-4 text-violet-600 dark:text-violet-200" />
                  </button>
                ))}
              </div>
            </DashboardPanel>

            <DashboardPanel title="Consultores em destaque" subtitle="Quem mais converte no periodo filtrado" className="p-4">
              <div className="space-y-2">
                {data.overview.rankingSummary.consultants.slice(0, 5).map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setConsultantDetail(item)}
                    className="flex w-full items-center justify-between rounded-xl border border-border bg-card px-3 py-3 text-left transition hover:border-fuchsia-500/50 hover:bg-fuchsia-500/5"
                  >
                    <div>
                      <p className="text-sm font-semibold text-foreground">{item.name}</p>
                      <p className="text-xs text-muted-foreground">Conversao {formatPercent(item.conversionRate)}</p>
                    </div>
                    <CircleUserRound className="h-4 w-4 text-fuchsia-600 dark:text-fuchsia-200" />
                  </button>
                ))}
              </div>
            </DashboardPanel>
          </div>

          {/* Campanhas de Marketing Collapsible Section */}
          <div className="pt-2">
            <Button 
              variant="outline" 
              className="w-full flex items-center justify-between py-5 border-border bg-card/50 rounded-2xl backdrop-blur-md"
              onClick={() => setShowCampaignsPanel(!showCampaignsPanel)}
            >
              <span className="text-sm font-semibold text-foreground">
                {showCampaignsPanel ? "Ocultar Painel de Campanhas" : "Gerenciar & Comparar Campanhas"}
              </span>
              <LayoutPanelTop className={cn("h-4 w-4 transition-transform", showCampaignsPanel ? "rotate-90" : "")} />
            </Button>
            
            {showCampaignsPanel && (
              <div className="mt-3 space-y-4">
                <KpiGrid cols={4} className="gap-3">
                  <KpiCard title="Campanhas totais" value={formatNumber(data.campaigns.summary.total)} icon={<LayoutPanelTop className="h-4 w-4" />} tone="cyan" trend="base acompanhada" />
                  <KpiCard title="Campanhas ativas" value={formatNumber(data.campaigns.summary.active)} icon={<Target className="h-4 w-4" />} tone="teal" trend="em operacao" />
                  <KpiCard title="Receita atribuida" value={formatCurrency(data.campaigns.summary.revenue)} icon={<HandCoins className="h-4 w-4" />} tone="amber" trend="por campanha" />
                  <KpiCard title="Qualificados" value={formatNumber(data.campaigns.summary.qualifiedLeads)} icon={<Sparkles className="h-4 w-4" />} tone="purple" trend="no periodo filtrado" />
                </KpiGrid>
                
                <div className="grid gap-3 xl:grid-cols-2">
                  <DashboardPanel title="Ranking interno" subtitle="Melhores campanhas por resposta, qualificacao e ROI" className="p-4">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-[1.2rem] border border-border bg-card p-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Maior resposta</p>
                        <p className="mt-2 text-sm font-semibold text-foreground">{[...campaigns].sort((a, b) => b.responseRate - a.responseRate)[0]?.name || "—"}</p>
                      </div>
                      <div className="rounded-[1.2rem] border border-border bg-card p-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Maior qualificacao</p>
                        <p className="mt-2 text-sm font-semibold text-foreground">{[...campaigns].sort((a, b) => b.qualificationRate - a.qualificationRate)[0]?.name || "—"}</p>
                      </div>
                      <div className="rounded-[1.2rem] border border-border bg-card p-3">
                        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Maior ROI</p>
                        <p className="mt-2 text-sm font-semibold text-foreground">{[...campaigns].sort((a, b) => (b.roiEstimated || 0) - (a.roiEstimated || 0))[0]?.name || "—"}</p>
                      </div>
                    </div>
                  </DashboardPanel>

                  <DashboardPanel title="Comparar campanhas" subtitle="Selecione duas campanhas e compare os numeros lado a lado" className="p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <FilterField label="Campanha A">
                        <Select value={compareCampaignA || "all"} onValueChange={(value) => setCompareCampaignA(value === "all" ? "" : value)}>
                          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Selecione</SelectItem>
                            {campaigns.map((campaign) => (
                              <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FilterField>
                      <FilterField label="Campanha B">
                        <Select value={compareCampaignB || "all"} onValueChange={(value) => setCompareCampaignB(value === "all" ? "" : value)}>
                          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Selecione</SelectItem>
                            {campaigns.map((campaign) => (
                              <SelectItem key={campaign.id} value={campaign.id}>{campaign.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </FilterField>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {compareCampaignRows.length ? compareCampaignRows.map((campaign) => (
                        <div key={campaign.id} className="rounded-[1.2rem] border border-border bg-card p-4">
                          <p className="text-sm font-semibold text-foreground">{campaign.name}</p>
                          <div className="mt-3 grid gap-2 text-sm">
                            <div className="flex items-center justify-between"><span className="text-muted-foreground">Resposta</span><span>{formatPercent(campaign.responseRate)}</span></div>
                            <div className="flex items-center justify-between"><span className="text-muted-foreground">Qualificacao</span><span>{formatPercent(campaign.qualificationRate)}</span></div>
                            <div className="flex items-center justify-between"><span className="text-muted-foreground">Fechamentos</span><span>{formatNumber(campaign.closings)}</span></div>
                            <div className="flex items-center justify-between"><span className="text-muted-foreground">Receita</span><span>{formatCurrency(campaign.revenue)}</span></div>
                          </div>
                        </div>
                      )) : <EmptyState message="Selecione duas campanhas para comparar." />}
                    </div>
                  </DashboardPanel>
                </div>

                <DashboardPanel title="Analise de campanhas" subtitle="Visualizacao e comparativo operacional" className="p-4">
                  {campaignsFiltered.length ? (
                    <>
                      <div className="mb-4">
                        <ChartContainer config={{ qualificados: { label: "Qualificados", color: "#22d3ee" } }} className="h-[280px] w-full">
                          <BarChart data={campaignsFiltered.slice(0, 8)}>
                            <CartesianGrid vertical={false} />
                            <XAxis dataKey="name" tickLine={false} axisLine={false} interval={0} angle={-15} height={64} />
                            <YAxis tickLine={false} axisLine={false} />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Bar dataKey="leadsQualified" fill="var(--color-qualificados)" radius={[10, 10, 0, 0]} />
                          </BarChart>
                        </ChartContainer>
                      </div>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Campanha</TableHead>
                              <TableHead>Status</TableHead>
                              <TableHead>Periodo</TableHead>
                              <TableHead>Importados</TableHead>
                              <TableHead>Abordados</TableHead>
                              <TableHead>Respondidos</TableHead>
                              <TableHead>Qualificados</TableHead>
                              <TableHead>Tx resposta</TableHead>
                              <TableHead>Tx qualificacao</TableHead>
                              <TableHead>Fechamentos</TableHead>
                              <TableHead>Receita</TableHead>
                              <TableHead>Custo</TableHead>
                              <TableHead>CPLQ</TableHead>
                              <TableHead>ROI</TableHead>
                              <TableHead>Acoes</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {pagedCampaigns.items.map((campaign) => (
                              <TableRow key={campaign.id}>
                                <TableCell><p className="font-semibold text-foreground">{campaign.name}</p></TableCell>
                                <TableCell><Badge className={cn("border-0", statusClasses(campaign.status))}>{campaign.status}</Badge></TableCell>
                                <TableCell>{campaign.period}</TableCell>
                                <TableCell>{formatNumber(campaign.leadsImported)}</TableCell>
                                <TableCell>{formatNumber(campaign.leadsApproached)}</TableCell>
                                <TableCell>{formatNumber(campaign.leadsResponded)}</TableCell>
                                <TableCell>{formatNumber(campaign.leadsQualified)}</TableCell>
                                <TableCell>{formatPercent(campaign.responseRate)}</TableCell>
                                <TableCell>{formatPercent(campaign.qualificationRate)}</TableCell>
                                <TableCell>{formatNumber(campaign.closings)}</TableCell>
                                <TableCell>{formatCurrency(campaign.revenue)}</TableCell>
                                <TableCell>{formatCurrency(campaign.cost)}</TableCell>
                                <TableCell>{campaign.cplq === null ? "—" : formatCurrency(campaign.cplq)}</TableCell>
                                <TableCell>{campaign.roiEstimated === null ? "—" : `${campaign.roiEstimated.toFixed(2)}x`}</TableCell>
                                <TableCell>
                                  <div className="flex flex-wrap gap-2">
                                    <Button variant="outline" size="sm" onClick={() => setCampaignDetail(campaign)}>Ver detalhes</Button>
                                    <Button variant="outline" size="sm" onClick={() => setActiveTab("performance")}>Comparar</Button>
                                    <Button variant="outline" size="sm" onClick={() => setCampaignDetail(campaign)}>Abrir leads</Button>
                                  </div>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                      <PaginationBar page={pagedCampaigns.page} totalPages={pagedCampaigns.totalPages} onChange={setCampaignPage} />
                    </>
                  ) : (
                    <EmptyState title="Nenhuma campanha encontrada" description="Ajuste a busca ou ative campanhas." />
                  )}
                </DashboardPanel>
              </div>
            )}
          </div>

          {/* Collapsible Detailed Metrics Section */}
          <div className="pt-2">
            <Button 
              variant="outline" 
              className="w-full flex items-center justify-between py-5 border-border bg-card/50 rounded-2xl backdrop-blur-md"
              onClick={() => setShowDetailedMetrics(!showDetailedMetrics)}
            >
              <span className="text-sm font-semibold text-foreground">
                {showDetailedMetrics ? "Ocultar Métricas Detalhadas" : "Visualizar Todas as Métricas Detalhadas"}
              </span>
              <Settings2 className={cn("h-4 w-4 transition-transform", showDetailedMetrics ? "rotate-90" : "")} />
            </Button>
            
            {showDetailedMetrics && (
              <div className="mt-3">
                <DashboardPanel title="Leitura detalhada das metricas" subtitle="Valor atual, delta e tendencia operacional" className="p-4">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>
                            <button type="button" onClick={() => setMetricSort((current) => ({ key: "name", order: current.key === "name" && current.order === "asc" ? "desc" : "asc" }))} className="inline-flex items-center gap-2">
                              Metrica {metricSort.key === "name" ? metricSort.order === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : null}
                            </button>
                          </TableHead>
                          <TableHead>Atual</TableHead>
                          <TableHead>Periodo anterior</TableHead>
                          <TableHead>
                            <button type="button" onClick={() => setMetricSort((current) => ({ key: "delta", order: current.key === "delta" && current.order === "asc" ? "desc" : "asc" }))} className="inline-flex items-center gap-2">
                              Delta {metricSort.key === "delta" ? metricSort.order === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : null}
                            </button>
                          </TableHead>
                          <TableHead>Tendencia</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {metricsSorted.map((metric) => (
                          <TableRow key={metric.key}>
                            <TableCell>
                              <div>
                                <p className="font-semibold text-foreground">{metric.name}</p>
                                <p className="text-xs text-muted-foreground">meta {metric.target === null ? "nao definida" : formatCompact(metric.target, metric.kind)}</p>
                              </div>
                            </TableCell>
                            <TableCell className="font-semibold text-foreground">{metric.currentLabel}</TableCell>
                            <TableCell>{metric.previousLabel}</TableCell>
                            <TableCell>{metric.deltaLabel}</TableCell>
                            <TableCell>
                              <Badge className={cn("border", directionClasses(metric.direction))}>
                                {metric.direction === "up" ? "Alta" : metric.direction === "down" ? "Queda" : "Estavel"}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </DashboardPanel>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="equipe" className="space-y-4">
          {/* KPI Grid for Consultants */}
          <KpiGrid cols={4} className="gap-3">
            <KpiCard title="Consultores ativos" value={formatNumber(consultantSummary.active)} icon={<Users className="h-4 w-4" />} tone="cyan" trend="elegiveis para distribuicao" />
            <KpiCard title="Disponiveis agora" value={formatNumber(consultantSummary.available)} icon={<UserCog className="h-4 w-4" />} tone="teal" trend="recebimento imediato" />
            <KpiCard title="Receita atribuida" value={formatCurrency(consultantSummary.revenue)} icon={<HandCoins className="h-4 w-4" />} tone="amber" trend="soma por consultor" />
            <KpiCard title="Capacidade media" value={consultants.length ? `${Math.round(consultants.reduce((sum, item) => sum + item.dailyCapacity, 0) / consultants.length)}` : "0"} icon={<Gauge className="h-4 w-4" />} tone="purple" trend="leads por dia" />
          </KpiGrid>

          {/* Consultant Management Section */}
          <DashboardPanel title="Gestao de consultores" subtitle="CRUD real para distribuicao, capacidade e elegibilidade regional" className="p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="relative w-full max-w-md">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-9" value={consultantSearch} onChange={(event) => setConsultantSearch(event.target.value)} placeholder="Buscar por nome, email ou cidade" />
              </div>
              <Button
                onClick={() => {
                  resetConsultantForm();
                  setConsultantDialogOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Novo consultor
              </Button>
            </div>

            {consultantsFiltered.length ? (
              <>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  {pagedConsultants.items.map((consultant) => (
                    <div 
                      key={consultant.id}
                      className="rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:shadow-md flex flex-col justify-between"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="relative">
                            <div className="h-10 w-10 rounded-full bg-cyan-500/10 text-cyan-600 dark:text-cyan-200 flex items-center justify-center font-bold text-sm">
                              {consultant.name.slice(0, 2).toUpperCase()}
                            </div>
                            <span className={cn(
                              "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white dark:border-slate-900",
                              consultant.status === "ativo" ? "bg-emerald-500" : "bg-slate-400"
                            )} />
                          </div>
                          <div>
                            <h4 className="font-semibold text-sm text-foreground">{consultant.name}</h4>
                            <p className="text-xs text-muted-foreground">{consultant.position || "Consultor"}</p>
                          </div>
                        </div>
                        <Badge className={cn("border-0 text-[10px] px-2 py-0.5", statusClasses(consultant.status))}>
                          {consultant.status}
                        </Badge>
                      </div>

                      <div className="mt-4 space-y-2 text-xs text-muted-foreground border-t border-border pt-3">
                        <div className="flex justify-between">
                          <span>Telefone:</span>
                          <span className="font-medium text-foreground">{consultant.phone || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Email:</span>
                          <span className="font-medium text-foreground truncate max-w-[150px]">{consultant.email || "—"}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Cidade/UF:</span>
                          <span className="font-medium text-foreground">{consultant.city || "—"} / {consultant.state || "—"}</span>
                        </div>
                        {consultant.territoryRegions.length > 0 && (
                          <div className="flex justify-between">
                            <span>Regiões:</span>
                            <span className="font-medium text-foreground truncate max-w-[150px]" title={consultant.territoryRegions.join(", ")}>
                              {consultant.territoryRegions.join(", ")}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 grid grid-cols-3 gap-2 bg-muted/30 p-2.5 rounded-xl border border-border">
                        <div className="text-center">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Leads</p>
                          <p className="font-semibold text-[11px] text-foreground mt-0.5">{consultant.leadsReceived}/{consultant.dailyCapacity}</p>
                        </div>
                        <div className="text-center border-x border-border">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Conversão</p>
                          <p className="font-semibold text-[11px] text-foreground mt-0.5">{formatPercent(consultant.conversionRate)}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Tempo Resp</p>
                          <p className="font-semibold text-[11px] text-foreground mt-0.5">{formatHours(consultant.responseTimeHours)}</p>
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="flex justify-between text-[9px] text-muted-foreground mb-1">
                          <span>Capacidade Diária</span>
                          <span>{Math.round((consultant.leadsReceived / (consultant.dailyCapacity || 1)) * 100)}%</span>
                        </div>
                        <div className="h-1 w-full bg-muted rounded-full overflow-hidden">
                          <div 
                            className="h-full bg-cyan-500 rounded-full" 
                            style={{ width: `${Math.min(100, (consultant.leadsReceived / (consultant.dailyCapacity || 1)) * 100)}%` }}
                          />
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between gap-3 text-xs text-foreground border-t border-border pt-3">
                        <span className="text-muted-foreground">Disponível:</span>
                        <Switch 
                          checked={consultant.available} 
                          onCheckedChange={(checked) => void handleConsultantStatusToggle(consultant, checked)}
                        />
                      </div>

                      <div className="mt-4 flex gap-2 pt-2 border-t border-border">
                        <Button variant="outline" size="sm" className="flex-1 text-[11px] h-8" onClick={() => openConsultantForEdit(consultant)}>
                          Editar
                        </Button>
                        <Button variant="outline" size="sm" className="flex-1 text-[11px] h-8" onClick={() => setConsultantDetail(consultant)}>
                          Desempenho
                        </Button>
                        <Button variant="outline" size="icon" className="h-8 w-8 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20" onClick={() => void handleDeleteConsultant(consultant)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                <PaginationBar page={pagedConsultants.page} totalPages={pagedConsultants.totalPages} onChange={setConsultantPage} />
              </>
            ) : (
              <EmptyState title="Nenhum consultor encontrado" description="Cadastre o primeiro consultor ou ajuste a busca aplicada." />
            )}
          </DashboardPanel>

          {/* Distribution Strategy selectors */}
          <DashboardPanel title="Estrategia de distribuicao de leads" subtitle="Ative a estrategia principal e acompanhe a fila em execucao" className="p-4">
            <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
              {data.distribution.strategies.map((strategy) => {
                const active = settingsDraft.distributionStrategy === strategy.key || strategy.enabled;
                return (
                  <div key={strategy.key} className={cn("rounded-[1.35rem] border p-4 transition-colors", active ? "border-cyan-500/30 bg-cyan-500/5 text-cyan-600 dark:text-cyan-300" : "border-border bg-card text-foreground")}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{strategy.label}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{strategy.description}</p>
                      </div>
                      <Switch checked={active} onCheckedChange={(checked) => void handleStrategyToggle(strategy.key, checked)} />
                    </div>
                    <div className="mt-3">
                      <Badge className={cn("border-0", active ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : "bg-slate-500/10 text-slate-700 dark:text-slate-200")}>
                        {active ? "Estrategia ativa" : "Pronta para ativacao"}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </DashboardPanel>

          {/* Regras de prioridade */}
          <DashboardPanel title="Regras de prioridade de Leads" subtitle="Cidade, regiao, valor potencial, tipo de lead e SLA com persistencia real" className="p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">Ajuste criterios para rodizio, peso por performance ou distribuicao hibrida.</p>
              <Button onClick={() => { resetRuleForm(); setRuleDialogOpen(true); }}>
                <Plus className="h-4 w-4" />
                Nova regra
              </Button>
            </div>
            {distributionRules.length ? (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Regra</TableHead>
                      <TableHead>Modo</TableHead>
                      <TableHead>Prioridades</TableHead>
                      <TableHead>SLA</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Acoes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {distributionRules.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <div>
                            <p className="font-semibold text-foreground">{rule.name}</p>
                            <p className="text-xs text-muted-foreground">cap {rule.maxOpenLeadsPerConsultant} • fairness {rule.fairnessFloor}</p>
                          </div>
                        </TableCell>
                        <TableCell>{rule.distributionMode}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {[rule.prioritizeRegion && "regiao", rule.prioritizeContractValue && "valor", rule.prioritizeLeadType && "tipo"].filter(Boolean).join(" • ") || "padrao"}
                        </TableCell>
                        <TableCell>{rule.reassignAfterMinutes} min</TableCell>
                        <TableCell>
                          <Badge className={cn("border-0", rule.active ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : "bg-slate-500/10 text-slate-700 dark:text-slate-200")}>
                            {rule.active ? "Ativa" : "Pausada"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => openRuleForEdit(rule)}>
                              Editar
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                openRankingDetails(rule.name, [
                                  { label: "Modo", value: rule.distributionMode },
                                  { label: "Prioriza regiao", value: rule.prioritizeRegion ? "Sim" : "Nao" },
                                  { label: "Prioriza valor", value: rule.prioritizeContractValue ? "Sim" : "Nao" },
                                  { label: "Prioriza tipo", value: rule.prioritizeLeadType ? "Sim" : "Nao" },
                                  { label: "Reatribui em", value: `${rule.reassignAfterMinutes} min` },
                                ])
                              }
                            >
                              Detalhar
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <EmptyState title="Nenhuma regra cadastrada" description="Crie regras reais para priorizar regiao, valor potencial e SLA de resposta." />
            )}
          </DashboardPanel>

          {/* Fila atual de distribuicao */}
          <DashboardPanel title="Fila atual de distribuicao" subtitle="Reatribua, trave, libere ou envie manualmente lead a lead" className="p-4">
            {distributionQueue.length ? (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Lead</TableHead>
                        <TableHead>Campanha</TableHead>
                        <TableHead>Cidade</TableHead>
                        <TableHead>Valor Potencial</TableHead>
                        <TableHead>Consultor Vinculado</TableHead>
                        <TableHead>Regra Aplicada</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>SLA</TableHead>
                        <TableHead>Acoes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedQueue.items.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            <div>
                              <p className="font-semibold text-foreground">{row.leadName}</p>
                              <p className="text-xs text-muted-foreground">recebido em {new Date(row.receivedAt).toLocaleString("pt-BR")}</p>
                            </div>
                          </TableCell>
                          <TableCell>{row.campaignName}</TableCell>
                          <TableCell>{row.city}</TableCell>
                          <TableCell className="font-semibold">{formatCurrency(row.potentialValue)}</TableCell>
                          <TableCell>{row.consultantName || "—"}</TableCell>
                          <TableCell>{row.ruleApplied}</TableCell>
                          <TableCell>
                            <Badge className={cn("border-0", row.status === "atribuido" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : "bg-amber-500/10 text-amber-700 dark:text-amber-200")}>
                              {row.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={cn("border-0", row.slaStatus === "no_prazo" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200" : "bg-rose-500/10 text-rose-700 dark:text-rose-200")}>
                              {row.slaStatus === "no_prazo" ? "No prazo" : "Atrasado"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              <Button variant="outline" size="sm" onClick={() => openAssignmentDialog(row)}>Reatribuir</Button>
                              <Button variant="outline" size="sm" onClick={() => void handleAssignmentMutation({ id: row.id, action: "aprovar" }, "Lead aprovado na fila.")}>Aprovar</Button>
                              <Button variant="outline" size="sm" onClick={() => void handleAssignmentMutation({ id: row.id, action: "rejeitar" }, "Lead rejeitado na fila.")}>Rejeitar</Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <PaginationBar page={pagedQueue.page} totalPages={pagedQueue.totalPages} onChange={setQueuePage} />
              </>
            ) : (
              <EmptyState title="Fila vazia" description="Nenhuma atribuicao esta pendente ou em execucao agora." />
            )}
          </DashboardPanel>

          {/* Historico de atribuicoes */}
          <DashboardPanel title="Historico de atribuicoes" subtitle="Rastreabilidade de reatribuicoes manuais e automaticas" className="p-4">
            {distributionHistory.length ? (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data e hora</TableHead>
                        <TableHead>Lead</TableHead>
                        <TableHead>Consultor anterior</TableHead>
                        <TableHead>Consultor atual</TableHead>
                        <TableHead>Motivo</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Responsavel</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedHistory.items.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>{row.dateTime ? new Date(row.dateTime).toLocaleString("pt-BR") : "—"}</TableCell>
                          <TableCell>{row.leadName}</TableCell>
                          <TableCell>{row.previousConsultant}</TableCell>
                          <TableCell>{row.currentConsultant}</TableCell>
                          <TableCell>{row.reason}</TableCell>
                          <TableCell>{row.distributionType}</TableCell>
                          <TableCell>{row.responsible}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <PaginationBar page={pagedHistory.page} totalPages={pagedHistory.totalPages} onChange={setHistoryPage} />
              </>
            ) : (
              <EmptyState title="Sem historico recente" description="A trilha de atribuicoes vai aparecer assim que o sistema distribuir ou reatribuir leads." />
            )}
          </DashboardPanel>
        </TabsContent>

        <TabsContent value="ia-config" className="space-y-4">
          <DashboardPanel title="Diagnósticos de IA (Vexo Brain)" subtitle="Alertas automáticos e insights preditivos gerados a partir do histórico operacional" className="p-4">
            <div className="mb-4 grid gap-3 lg:grid-cols-5">
              <FilterField label="Severidade">
                <Select value={insightSeverity} onValueChange={setInsightSeverity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="critical">Critica</SelectItem>
                    <SelectItem value="warning">Alerta</SelectItem>
                    <SelectItem value="info">Informativa</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Tipo">
                <Select value={insightType} onValueChange={setInsightType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="campaign">Campanha</SelectItem>
                    <SelectItem value="city">Cidade</SelectItem>
                    <SelectItem value="consultant">Consultor</SelectItem>
                    <SelectItem value="distribution">Distribuicao</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Campanha">
                <Select value={insightCampaign} onValueChange={setInsightCampaign}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as campanhas</SelectItem>
                    {(options?.campaigns || []).map((option) => (
                      <SelectItem key={option.id || option.value || option.name} value={option.id || option.value || option.name || ""}>
                        {option.label || option.name || option.value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Cidade">
                <Select value={insightCity} onValueChange={setInsightCity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as cidades</SelectItem>
                    {(options?.cities || []).map((option) => {
                      const value = option.value || option.name || option.label || "";
                      return <SelectItem key={value} value={value}>{option.label || option.name || value}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Periodo">
                <div className="rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
                  {PERIOD_OPTIONS.find((option) => option.value === appliedFilters.period)?.label || "30 dias"}
                </div>
              </FilterField>
            </div>

            {insightsFiltered.length ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {insightsFiltered.map((insight) => (
                  <div key={`${insight.id || insight.title}-${insight.generatedAt || ""}`} className="rounded-[1.35rem] border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-foreground">{insight.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{insight.message}</p>
                      </div>
                      <Badge className={cn("border-0", severityClasses(insight.severity))}>{insight.severity}</Badge>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-border bg-card/50 p-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Impacto estimado</p>
                        <p className="mt-1 text-sm font-medium text-foreground">{insight.impact}</p>
                      </div>
                      <div className="rounded-xl border border-border bg-card/50 p-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Recomendacao</p>
                        <p className="mt-1 text-sm font-medium text-foreground">{insight.recommendation}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button onClick={() => void handleInsightAction(insight)}>{insight.actionLabel}</Button>
                      {insight.id ? (
                        <Button variant="outline" onClick={() => void updateInsightStatus.mutateAsync({ id: insight.id, status: "resolved" }).then(() => toast.success("Insight marcado como resolvido.")).catch((err) => toast.error(err instanceof Error ? err.message : "Falha ao atualizar insight."))}>
                          Resolver
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Nenhum insight encontrado" description="Ajuste os filtros ou aguarde novos sinais operacionais da base." />
            )}
          </DashboardPanel>

          <DashboardPanel title="Parâmetros Operacionais & SLAs" subtitle="Limiar de qualificação, tempos de SLA de atendimento, regras de ranking e permissões" className="p-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-4 rounded-[1.35rem] border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">Metricas e janelas</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <FilterField label="Limiar de qualificacao">
                    <Input type="number" min={0} max={100} value={settingsDraft.qualificationThreshold} onChange={(event) => setSettingsDraft((current) => ({ ...current, qualificationThreshold: Number(event.target.value) }))} />
                  </FilterField>
                  <FilterField label="SLA padrao (min)">
                    <Input type="number" min={1} value={settingsDraft.slaMinutes} onChange={(event) => setSettingsDraft((current) => ({ ...current, slaMinutes: Number(event.target.value) }))} />
                  </FilterField>
                  <FilterField label="Periodo padrao">
                    <Select value={settingsDraft.defaultPeriod} onValueChange={(value) => setSettingsDraft((current) => ({ ...current, defaultPeriod: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PERIOD_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FilterField>
                  <FilterField label="Estrategia principal">
                    <Select value={settingsDraft.distributionStrategy} onValueChange={(value) => setSettingsDraft((current) => ({ ...current, distributionStrategy: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="round_robin">Round-robin</SelectItem>
                        <SelectItem value="weighted_performance">Peso por performance</SelectItem>
                        <SelectItem value="priority_region">Prioridade por regiao</SelectItem>
                        <SelectItem value="priority_contract">Prioridade por valor potencial</SelectItem>
                        <SelectItem value="hybrid">Distribuicao hibrida</SelectItem>
                      </SelectContent>
                    </Select>
                  </FilterField>
                </div>
              </div>

              <div className="space-y-4 rounded-[1.35rem] border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">Regras de ranking</p>
                <div className="grid gap-4 md:grid-cols-3">
                  <FilterField label="Cidades">
                    <Select value={String(settingsDraft.rankingRules?.cities || "qualificationRate")} onValueChange={(value) => setSettingsDraft((current) => ({ ...current, rankingRules: { ...current.rankingRules, cities: value } }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="qualificationRate">Qualificacao</SelectItem>
                        <SelectItem value="conversionRate">Conversao</SelectItem>
                        <SelectItem value="revenue">Receita</SelectItem>
                      </SelectContent>
                    </Select>
                  </FilterField>
                  <FilterField label="Campanhas">
                    <Select value={String(settingsDraft.rankingRules?.campaigns || "qualifiedLeads")} onValueChange={(value) => setSettingsDraft((current) => ({ ...current, rankingRules: { ...current.rankingRules, campaigns: value } }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="qualifiedLeads">Qualificados</SelectItem>
                        <SelectItem value="responseRate">Resposta</SelectItem>
                        <SelectItem value="roiEstimated">ROI</SelectItem>
                      </SelectContent>
                    </Select>
                  </FilterField>
                  <FilterField label="Consultores">
                    <Select value={String(settingsDraft.rankingRules?.consultants || "conversionRate")} onValueChange={(value) => setSettingsDraft((current) => ({ ...current, rankingRules: { ...current.rankingRules, consultants: value } }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="conversionRate">Conversao</SelectItem>
                        <SelectItem value="revenue">Receita</SelectItem>
                        <SelectItem value="leadsReceived">Leads recebidos</SelectItem>
                      </SelectContent>
                    </Select>
                  </FilterField>
                </div>
              </div>

              <div className="space-y-4 rounded-[1.35rem] border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">Alertas e limiares</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <FilterField label="Baixa resposta (%)">
                    <Input type="number" min={0} value={Number(settingsDraft.alertRules?.lowResponseRate || 15)} onChange={(event) => setSettingsDraft((current) => ({ ...current, alertRules: { ...current.alertRules, lowResponseRate: Number(event.target.value) } }))} />
                  </FilterField>
                  <FilterField label="Baixa conversao (%)">
                    <Input type="number" min={0} value={Number(settingsDraft.alertRules?.lowConversionRate || 10)} onChange={(event) => setSettingsDraft((current) => ({ ...current, alertRules: { ...current.alertRules, lowConversionRate: Number(event.target.value) } }))} />
                  </FilterField>
                  <FilterField label="Atraso de qualificacao (h)">
                    <Input type="number" min={0} value={Number(settingsDraft.alertRules?.highQualificationDelayHours || 24)} onChange={(event) => setSettingsDraft((current) => ({ ...current, alertRules: { ...current.alertRules, highQualificationDelayHours: Number(event.target.value) } }))} />
                  </FilterField>
                  <FilterField label="Fator abaixo da media">
                    <Input type="number" min={0} step="0.1" value={Number(settingsDraft.alertRules?.consultantBelowAverageFactor || 0.7)} onChange={(event) => setSettingsDraft((current) => ({ ...current, alertRules: { ...current.alertRules, consultantBelowAverageFactor: Number(event.target.value) } }))} />
                  </FilterField>
                </div>
              </div>

              <div className="space-y-4 rounded-[1.35rem] border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">Permissoes e governanca</p>
                <div className="space-y-3">
                  <label className="flex items-center justify-between rounded-xl border border-border bg-card/50 px-3 py-3 text-sm">
                    <span>Permitir editar configuracoes</span>
                    <Switch checked={Boolean(settingsDraft.permissions?.canEditSettings)} onCheckedChange={(checked) => setSettingsDraft((current) => ({ ...current, permissions: { ...current.permissions, canEditSettings: checked } }))} />
                  </label>
                  <label className="flex items-center justify-between rounded-xl border border-border bg-card/50 px-3 py-3 text-sm">
                    <span>Permitir gerenciar consultores</span>
                    <Switch checked={Boolean(settingsDraft.permissions?.canManageConsultants)} onCheckedChange={(checked) => setSettingsDraft((current) => ({ ...current, permissions: { ...current.permissions, canManageConsultants: checked } }))} />
                  </label>
                  <label className="flex items-center justify-between rounded-xl border border-border bg-card/50 px-3 py-3 text-sm">
                    <span>Permitir gerenciar distribuicao</span>
                    <Switch checked={Boolean(settingsDraft.permissions?.canManageDistribution)} onCheckedChange={(checked) => setSettingsDraft((current) => ({ ...current, permissions: { ...current.permissions, canManageDistribution: checked } }))} />
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">As alteracoes ficam persistidas por empresa e alimentam metricas, rankings, distribuicao e alertas.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={handleRestoreSettings}>
                  Restaurar padrao
                </Button>
                <Button onClick={() => void handleSaveSettings()} disabled={saveSettings.isPending}>
                  {saveSettings.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Salvar configuracoes
                </Button>
              </div>
            </div>
          </DashboardPanel>
        </TabsContent>
      </Tabs>

      <ConsultantFormDialog
        open={consultantDialogOpen}
        onOpenChange={setConsultantDialogOpen}
        title={editingConsultantId ? "Editar consultor" : "Novo consultor"}
        form={consultantForm}
        onChange={setConsultantForm}
        onSubmit={() => void handleConsultantSubmit()}
        isSaving={createConsultant.isPending || updateConsultant.isPending}
      />

      <DistributionRuleDialog
        open={ruleDialogOpen}
        onOpenChange={setRuleDialogOpen}
        form={ruleForm}
        onChange={setRuleForm}
        onSubmit={() => void handleRuleSubmit()}
        isSaving={createRule.isPending || updateRule.isPending}
      />

      <AssignmentDialog
        open={assignmentDialogOpen}
        onOpenChange={setAssignmentDialogOpen}
        row={selectedAssignmentRow}
        consultants={consultants}
        consultantId={assignmentConsultantId}
        reason={assignmentReason}
        onConsultantChange={setAssignmentConsultantId}
        onReasonChange={setAssignmentReason}
        onSubmit={() => void handleAssignmentSubmit()}
        isSaving={assignmentAction.isPending}
      />

      <RankingDetailDialog title={rankingDetailTitle} open={rankingDetailOpen} onOpenChange={setRankingDetailOpen} rows={rankingDetailRows} />

      <Dialog open={Boolean(consultantDetail)} onOpenChange={(open) => !open && setConsultantDetail(null)}>
        <DialogContent className="max-w-2xl rounded-[1.5rem] border-border bg-card text-card-foreground shadow-2xl">
          <DialogHeader>
            <DialogTitle>{consultantDetail?.name}</DialogTitle>
            <DialogDescription>Desempenho e elegibilidade operacional do consultor selecionado.</DialogDescription>
          </DialogHeader>
          {consultantDetail ? (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border bg-card/60 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Receita</p>
                <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(consultantDetail.revenue)}</p>
              </div>
              <div className="rounded-xl border border-border bg-card/60 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Conversao</p>
                <p className="mt-2 text-2xl font-bold text-foreground">{formatPercent(consultantDetail.conversionRate)}</p>
              </div>
              <div className="rounded-xl border border-border bg-card/60 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Leads recebidos</p>
                <p className="mt-2 text-2xl font-bold text-foreground">{formatNumber(consultantDetail.leadsReceived)}</p>
              </div>
              <div className="rounded-xl border border-border bg-card/60 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Tempo medio de resposta</p>
                <p className="mt-2 text-2xl font-bold text-foreground">{formatHours(consultantDetail.responseTimeHours)}</p>
              </div>
              <div className="rounded-xl border border-border bg-card/60 p-4 md:col-span-2">
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Cobertura operacional</p>
                <p className="mt-2 text-sm text-foreground">{consultantDetail.territoryRegions.join(", ") || "Sem regiao configurada"}</p>
                <p className="mt-2 text-sm text-muted-foreground">{consultantDetail.notes || "Sem observacoes operacionais."}</p>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(campaignDetail)} onOpenChange={(open) => !open && setCampaignDetail(null)}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto rounded-[1.5rem] border-border bg-card text-card-foreground shadow-2xl">
          <DialogHeader>
            <DialogTitle>{campaignDetail?.name}</DialogTitle>
            <DialogDescription>Evolucao temporal, consultores, cidades, gargalos e preview dos leads da campanha.</DialogDescription>
          </DialogHeader>
          {campaignDetail ? (
            <div className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-4">
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Taxa de resposta</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{formatPercent(campaignDetail.responseRate)}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Taxa de qualificacao</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{formatPercent(campaignDetail.qualificationRate)}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Receita</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{formatCurrency(campaignDetail.revenue)}</p>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">ROI estimado</p>
                  <p className="mt-2 text-2xl font-bold text-foreground">{campaignDetail.roiEstimated === null ? "—" : `${campaignDetail.roiEstimated.toFixed(2)}x`}</p>
                </div>
              </div>

              <div className="grid gap-3 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.9fr)]">
                <DashboardPanel title="Evolucao no tempo" subtitle="Qualificados e fechamentos por data" className="p-4">
                  {campaignDetail.trend.length ? (
                    <ChartContainer config={{ qualificados: { label: "Qualificados", color: "#22d3ee" }, fechamentos: { label: "Fechamentos", color: "#a78bfa" } }} className="h-[280px] w-full">
                      <LineChart data={campaignDetail.trend}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="date" tickLine={false} axisLine={false} />
                        <YAxis tickLine={false} axisLine={false} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Line type="monotone" dataKey="qualificados" stroke="var(--color-qualificados)" strokeWidth={2.5} dot={false} />
                        <Line type="monotone" dataKey="fechamentos" stroke="var(--color-fechamentos)" strokeWidth={2.5} dot={false} />
                      </LineChart>
                    </ChartContainer>
                  ) : (
                    <EmptyChart title="Sem linha temporal" description="Ainda nao ha volume suficiente para evolucao da campanha." />
                  )}
                </DashboardPanel>

                <DashboardPanel title="Gargalos do funil" subtitle="Volume por etapa operacional" className="p-4">
                  {campaignDetail.funnel.length ? (
                    <ChartContainer config={{ value: { label: "Volume", color: "#22d3ee" } }} className="h-[280px] w-full">
                      <BarChart data={campaignDetail.funnel}>
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="stage" tickLine={false} axisLine={false} />
                        <YAxis tickLine={false} axisLine={false} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="value" fill="var(--color-value)" radius={[10, 10, 0, 0]} />
                      </BarChart>
                    </ChartContainer>
                  ) : (
                    <EmptyChart title="Funil vazio" description="Sem dados suficientes para detalhar gargalos." />
                  )}
                </DashboardPanel>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <DashboardPanel title="Cidades com melhor resultado" subtitle="Melhor desempenho geografico" className="p-4">
                  <div className="space-y-2">
                    {campaignDetail.topCities.length ? campaignDetail.topCities.map((item) => (
                      <div key={item.city} className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-3 py-3">
                        <span className="text-sm font-medium text-foreground">{item.city}</span>
                        <span className="text-xs text-muted-foreground">{formatPercent(item.qualificationRate)}</span>
                      </div>
                    )) : <EmptyState message="Nenhuma cidade performou acima da media ainda." />}
                  </div>
                </DashboardPanel>

                <DashboardPanel title="Consultores que mais converteram" subtitle="Conversao e receita por campanha" className="p-4">
                  <div className="space-y-2">
                    {campaignDetail.topConsultants.length ? campaignDetail.topConsultants.map((item) => (
                      <div key={item.consultantId} className="flex items-center justify-between rounded-xl border border-border bg-card/60 px-3 py-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">{item.consultantName}</p>
                          <p className="text-xs text-muted-foreground">{item.converted} fechamentos</p>
                        </div>
                        <span className="text-xs text-muted-foreground">{formatCurrency(item.revenue)}</span>
                      </div>
                    )) : <EmptyState message="Nenhum consultor fechou oportunidades desta campanha ainda." />}
                  </div>
                </DashboardPanel>
              </div>

              <DashboardPanel title="Leads gerados pela campanha" subtitle="Preview real dos leads vinculados a esta origem" className="p-4">
                {campaignDetail.previewLeads.length ? (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Nome</TableHead>
                          <TableHead>Telefone</TableHead>
                          <TableHead>Cidade</TableHead>
                          <TableHead>Estado</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Qualificacao</TableHead>
                          <TableHead>Criado em</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {campaignDetail.previewLeads.map((lead) => (
                          <TableRow key={lead.id}>
                            <TableCell>{lead.nome}</TableCell>
                            <TableCell>{lead.telefone}</TableCell>
                            <TableCell>{lead.cidade}</TableCell>
                            <TableCell>{lead.estado}</TableCell>
                            <TableCell>{lead.status}</TableCell>
                            <TableCell>{lead.qualificacao}</TableCell>
                            <TableCell>{lead.createdAt ? new Date(lead.createdAt).toLocaleString("pt-BR") : "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState message="Esta campanha ainda nao tem leads vinculados no recorte atual." />
                )}
              </DashboardPanel>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
