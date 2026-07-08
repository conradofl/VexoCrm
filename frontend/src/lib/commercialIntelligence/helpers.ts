import { toast } from "sonner";
import type {
  CommercialIntelligenceFilters,
  CommercialIntelligenceSettings,
  CommercialMetricRow,
  InsightItem,
} from "@/hooks/useCommercialIntelligence";

export type TabId = "performance" | "equipe" | "ia-config";
export type SortOrder = "asc" | "desc";

export const DEFAULT_FILTERS: CommercialIntelligenceFilters = {
  period: "30d",
  campaignId: "",
  city: "",
  consultantId: "",
  status: "",
};

export const DEFAULT_SETTINGS: CommercialIntelligenceSettings = {
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

export const PERIOD_OPTIONS = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "180d", label: "180 dias" },
  { value: "all", label: "Todo o historico" },
];

export const LEAD_TYPE_OPTIONS = ["Residencial", "Empresa", "Premium", "Recorrente"];
export const REGION_OPTIONS = ["Capital", "Interior", "Sul", "Sudeste", "Centro-Oeste", "Nordeste"];
export const STATUS_COLORS = ["#22d3ee", "#a78bfa", "#fb7185", "#f59e0b", "#60a5fa", "#94a3b8"];

export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR").format(Number(value));
}

export function formatCurrency(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(1)}%`;
}

export function formatHours(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return `${Number(value).toFixed(1)}h`;
}

export function formatCompact(value: number | null | undefined, kind: string) {
  if (kind === "currency") return formatCurrency(value);
  if (kind === "percent") return formatPercent(value);
  if (kind === "hours") return formatHours(value);
  if (kind === "ratio") return value === null || value === undefined ? "—" : Number(value).toFixed(2);
  return formatNumber(value);
}

export function deltaLabel(delta: number | null | undefined, kind: string) {
  if (delta === null || delta === undefined || Number.isNaN(delta)) return "sem comparativo";
  const prefix = delta > 0 ? "+" : "";
  return `${prefix}${formatCompact(delta, kind)}`;
}

export function directionClasses(direction: CommercialMetricRow["direction"]) {
  if (direction === "up") return "border-emerald-300/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200";
  if (direction === "down") return "border-rose-300/60 bg-rose-500/10 text-rose-700 dark:text-rose-200";
  return "border-slate-300/60 bg-slate-500/10 text-slate-700 dark:text-slate-200";
}

export function toneFromAccent(accent: string): "cyan" | "teal" | "amber" | "pink" | "purple" {
  if (accent === "teal") return "teal";
  if (accent === "amber") return "amber";
  if (accent === "pink" || accent === "rose") return "pink";
  if (accent === "violet") return "purple";
  return "cyan";
}

export function severityClasses(severity: InsightItem["severity"]) {
  if (severity === "critical") return "bg-rose-500/10 text-rose-700 dark:text-rose-200";
  if (severity === "warning") return "bg-amber-500/10 text-amber-700 dark:text-amber-200";
  return "bg-cyan-500/10 text-cyan-700 dark:text-cyan-200";
}

export function statusClasses(value: string) {
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

export function parseCsvList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function serializeCsvList(values: string[] | undefined) {
  return (values || []).join(", ");
}

export function parseAvailableHours(value: string) {
  return value.trim() ? { label: value.trim() } : {};
}

export function serializeAvailableHours(value: Record<string, unknown> | undefined) {
  if (!value || typeof value !== "object") return "";
  return typeof value.label === "string" ? value.label : "";
}

export function paginate<T>(items: T[], page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const start = (safePage - 1) * pageSize;
  return {
    totalPages,
    page: safePage,
    items: items.slice(start, start + pageSize),
  };
}

export function compareValues(a: string | number | null | undefined, b: string | number | null | undefined, order: SortOrder) {
  const safeA = a ?? (typeof b === "number" ? -Infinity : "");
  const safeB = b ?? (typeof a === "number" ? -Infinity : "");
  if (typeof safeA === "number" && typeof safeB === "number") {
    return order === "asc" ? safeA - safeB : safeB - safeA;
  }
  return order === "asc"
    ? String(safeA).localeCompare(String(safeB), "pt-BR")
    : String(safeB).localeCompare(String(safeA), "pt-BR");
}

export function exportRows(filename: string, rows: Array<Record<string, unknown>>) {
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
