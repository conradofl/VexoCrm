import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  MessageCircle,
  MessageSquareQuote,
  Search,
  RotateCcw,
  Sparkles,
  Trash2,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { API_BASE_URL, readApiErrorMessage } from "@/lib/api";
import {
  useCampaignRecipients,
  CAMPAIGN_STATUS_LABELS,
  type Campaign,
  type CampaignRecipientItem,
} from "@/hooks/useCampanhas";

const PAGE_SIZE = 50;

type SortKey = "nome" | "telefone" | "status" | "tentativas" | "retorno" | "tempo" | "lote";

import {
  DELIVERY_STATE_LABELS,
  computeImportAuditStats,
  legacyTrackingNotice,
  type DeliveryState,
  type LegacyDispatchCampaign,
} from "@/lib/importAudit";

type RunStatus = "pending" | "claimed" | "sent" | "failed" | "skipped" | "invalid_number";

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  pending: "Pendente",
  claimed: "Reivindicado",
  sent: "Enviado",
  failed: "Falhou",
  skipped: "Ignorado",
  invalid_number: "Número inválido",
};

const RUN_STATUS_COLORS: Record<RunStatus, string> = {
  pending: "border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
  claimed: "border-sky-300 bg-sky-50 text-sky-600 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-400",
  sent: "border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  failed: "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400",
  skipped: "border-slate-300 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500",
  invalid_number: "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400",
};

const DELIVERY_STATE_COLORS: Record<DeliveryState, string> = {
  sem_telefone_valido: "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400",
  enviado_por_esta_planilha: "border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  enviado_por_outra_campanha: "border-sky-300 bg-sky-50 text-sky-600 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-400",
  falhou: "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400",
  pendente: "border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
};

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
  delivery_state: DeliveryState;
  duplicate_of_row?: number | null;
  sent_count?: number;
  sent_by_import_count?: number;
  sent_by_other_count?: number;
  last_sent_at: string | null;
  last_attempt_at: string | null;
  last_status: string | null;
  last_error_message: string | null;
  has_replied: boolean;
  failure_reason: string | null;
}

export interface LeadImportAuditReportProps {
  activeClientId: string;
  imports: any[];
  campaigns?: Campaign[];
  onSelectImportForFollowup: (importId: string) => void;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function getCampaignStatusBadge(item: CampaignRecipientItem) {
  if (item.replied) {
    return (
      <Badge className="border border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800/40 dark:bg-indigo-950/20 dark:text-indigo-400 font-bold text-[9px] rounded-lg px-2 py-0.5">
        Respondido 💬
      </Badge>
    );
  }
  if (item.status === "sent") {
    return (
      <Badge className="border border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-400 font-bold text-[9px] rounded-lg px-2 py-0.5">
        Enviado
      </Badge>
    );
  }
  if (item.status === "failed") {
    return (
      <Badge className="border border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400 font-bold text-[9px] rounded-lg px-2 py-0.5">
        Falhou
      </Badge>
    );
  }
  if (item.status === "invalid_number") {
    return (
      <Badge className="border border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950/30 dark:text-rose-400 font-bold text-[9px] rounded-lg px-2 py-0.5">
        Número inválido
      </Badge>
    );
  }
  if (item.status === "claimed") {
    return (
      <Badge className="border border-sky-300 bg-sky-50 text-sky-700 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-400 font-bold text-[9px] rounded-lg px-2 py-0.5">
        Em processamento
      </Badge>
    );
  }
  if (item.status === "skipped") {
    return (
      <Badge className="border border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 font-bold text-[9px] rounded-lg px-2 py-0.5">
        Ignorado
      </Badge>
    );
  }
  return (
    <Badge className="border border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 font-bold text-[9px] rounded-lg px-2 py-0.5">
      Na fila
    </Badge>
  );
}

export function LeadImportAuditReport({
  activeClientId,
  imports,
  campaigns = [],
  onSelectImportForFollowup,
}: LeadImportAuditReportProps) {
  const { getIdToken } = useAuth();
  const [auditTarget, setAuditTarget] = useState<"campaign" | "import">(() => {
    if (campaigns && campaigns.length > 0) return "campaign";
    return "import";
  });
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [selectedImportId, setSelectedImportId] = useState<string>("");

  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [legacyCampaigns, setLegacyCampaigns] = useState<LegacyDispatchCampaign[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"all" | "sent" | "failed" | "replied" | "pending">("all");
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [creatingSubset, setCreatingSubset] = useState(false);
  const [deletingItems, setDeletingItems] = useState(false);
  const [resettingHistory, setResettingHistory] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // ── Limpeza de estado e seleções ao trocar de empresa (tenant) ───────────
  useEffect(() => {
    setSelectedImportId("");
    setSelectedCampaignId("");
    setAuditItems([]);
    setLegacyCampaigns([]);
    setSelectedItemIds(new Set());
    setSelectedRecipientIds(new Set());
    setSearchTerm("");
    setActiveFilter("all");
    setSelectedReason(null);
    setPage(1);
  }, [activeClientId]);

  // ── Limpeza de seleção de destinatários ao trocar filtros ou campanha ────
  useEffect(() => {
    setSelectedRecipientIds(new Set());
  }, [selectedCampaignId, activeFilter, searchTerm, selectedReason]);

  // ── Sincronização de seleção com os imports válidos do tenant atual ──────
  useEffect(() => {
    if (imports.length > 0) {
      if (!selectedImportId || !imports.some((imp) => imp.id === selectedImportId)) {
        setSelectedImportId(imports[0].id);
      }
    } else {
      setSelectedImportId("");
      setAuditItems([]);
    }
  }, [imports, selectedImportId]);

  // ── Sincronização de seleção com as campanhas válidas do tenant atual ────
  useEffect(() => {
    if (campaigns && campaigns.length > 0) {
      if (!selectedCampaignId || !campaigns.some((c) => c.id === selectedCampaignId)) {
        setSelectedCampaignId(campaigns[0].id);
      }
    } else {
      setSelectedCampaignId("");
    }
  }, [campaigns, selectedCampaignId]);

  // ── Se não há planilhas mas há campanhas disponíveis, padrão é auditar campanhas ──
  useEffect(() => {
    if ((!imports || imports.length === 0) && campaigns && campaigns.length > 0) {
      setAuditTarget("campaign");
    }
  }, [campaigns, imports]);

  const handleSwitchTarget = (target: "campaign" | "import") => {
    setAuditTarget(target);
    setSelectedReason(null);
    setSearchTerm("");
    setActiveFilter("all");
    setPage(1);
    setSelectedItemIds(new Set());
  };

  // ── Dados da Campanha (via hook useCampaignRecipients) ────────────────────
  const {
    data: campaignRecipientsData,
    isLoading: loadingCampaignRecipients,
    isFetching: fetchingCampaignRecipients,
  } = useCampaignRecipients(
    auditTarget === "campaign" && selectedCampaignId ? selectedCampaignId : null,
    "all",
    undefined
  );

  // Motivos de falha da campanha agrupados
  const campaignReasonGroups = useMemo(() => {
    if (!campaignRecipientsData?.recipients) return [];
    const counts = new Map<string, number>();
    for (const item of campaignRecipientsData.recipients) {
      if (!item.failureReason) continue;
      counts.set(item.failureReason, (counts.get(item.failureReason) || 0) + 1);
    }
    const total = Array.from(counts.values()).reduce((sum, n) => sum + n, 0);
    return Array.from(counts.entries())
      .map(([reason, count]) => ({
        reason,
        count,
        pct: total > 0 ? Math.round((count / total) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [campaignRecipientsData]);

  // Destinatários da campanha filtrados
  const filteredCampaignRecipients = useMemo(() => {
    if (!campaignRecipientsData?.recipients) return [];
    return campaignRecipientsData.recipients.filter((item) => {
      const name = (item.nome || "").toLowerCase();
      const phone = (item.telefone || "").toLowerCase();
      const term = searchTerm.toLowerCase();
      const matchesSearch = !term || name.includes(term) || phone.includes(term);
      if (!matchesSearch) return false;

      if (selectedReason && item.failureReason !== selectedReason) return false;

      switch (activeFilter) {
        case "failed":
          return item.status === "failed" || item.status === "invalid_number" || !!item.failureReason;
        case "replied":
          return item.replied;
        case "sent":
          return item.status === "sent" || item.replied;
        case "pending":
          return item.status === "pending" || item.status === "claimed" || item.status === "skipped";
        default:
          return true;
      }
    });
  }, [campaignRecipientsData?.recipients, activeFilter, searchTerm, selectedReason]);

  const campaignCounts = useMemo(() => {
    if (!campaignRecipientsData) {
      return { all: 0, sent: 0, replied: 0, failed: 0, pending: 0 };
    }
    return campaignRecipientsData.counts || {
      all: campaignRecipientsData.total || 0,
      sent: 0,
      replied: 0,
      failed: 0,
      pending: 0,
    };
  }, [campaignRecipientsData]);

  const campaignResponseRate = useMemo(() => {
    if (!campaignCounts.sent || campaignCounts.sent === 0) return 0;
    return Math.round((campaignCounts.replied / campaignCounts.sent) * 100);
  }, [campaignCounts]);

  const handleExportCampaignCsv = (onlySelected: boolean = false) => {
    const recipientsToExport = onlySelected
      ? filteredCampaignRecipients.filter((r) => selectedRecipientIds.has(r.leadId || r.telefone))
      : filteredCampaignRecipients;

    if (!recipientsToExport || recipientsToExport.length === 0) {
      toast({
        title: "Nenhum dado para exportar",
        description: onlySelected
          ? "Nenhum destinatário selecionado para exportar."
          : "Não há destinatários para exportar nesta campanha.",
        variant: "destructive",
      });
      return;
    }

    const currentCampaign = campaigns?.find((c) => c.id === selectedCampaignId);
    const campaignName = currentCampaign?.name || campaignRecipientsData.campaignName || "campanha";

    const headers = [
      "Nome",
      "Telefone",
      "Status",
      "Lote",
      "Data de Envio",
      "Data de Resposta",
      "Preview da Mensagem",
      "Motivo da Falha",
    ];

    const escapeCsv = (str: string | null | undefined) => {
      if (!str) return "\"\"";
      const clean = String(str).replace(/"/g, "\"\"");
      return `"${clean}"`;
    };

    const rows = recipientsToExport.map((r) => [
      escapeCsv(r.nome),
      escapeCsv(r.telefone),
      escapeCsv(r.replied ? "Respondido" : r.status),
      escapeCsv(r.dispatchName),
      escapeCsv(r.sentAt ? new Date(r.sentAt).toLocaleString("pt-BR") : ""),
      escapeCsv(r.repliedAt ? new Date(r.repliedAt).toLocaleString("pt-BR") : ""),
      escapeCsv(r.lastInboundText),
      escapeCsv(r.failureReason),
    ]);

    const csvContent = "\uFEFF" + [headers.join(","), ...rows.map((row) => row.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeName = campaignName.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
    link.setAttribute("href", url);
    link.setAttribute("download", `auditoria-campanha-${safeName}-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: "Relatório exportado!",
      description: `${recipientsToExport.length} registros exportados em CSV com sucesso.`,
    });
  };

  // ── Carregamento de auditoria de Planilha protegido com AbortController ──
  useEffect(() => {
    if (auditTarget !== "import") return;

    setSelectedReason(null);
    setPage(1);

    if (!selectedImportId || !activeClientId) {
      setAuditItems([]);
      return;
    }

    if (imports.length > 0 && !imports.some((imp) => imp.id === selectedImportId)) {
      setAuditItems([]);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    async function loadAudit() {
      setLoading(true);
      try {
        const token = await getIdToken();
        if (!token) throw new Error("Usuário não autenticado.");

        const res = await fetch(
          `${API_BASE_URL}/api/campaigns/reports/import-audit?clientId=${encodeURIComponent(activeClientId)}&importId=${encodeURIComponent(selectedImportId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          }
        );

        if (!res.ok) {
          if (res.status === 404) {
            if (isMounted) setAuditItems([]);
            const isOtherTenantOrDeleted = !imports.some((imp) => imp.id === selectedImportId);
            const msg = isOtherTenantOrDeleted
              ? "Selecione uma planilha desta empresa."
              : "Essa planilha não existe mais.";
            console.warn("[audit-report] 404:", msg, { clientId: activeClientId, importId: selectedImportId });
            return;
          }

          if (res.status === 403) {
            if (isMounted) setAuditItems([]);
            console.warn("[audit-report] 403: Acesso não autorizado.", { clientId: activeClientId, importId: selectedImportId });
            return;
          }

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
        if (isMounted) {
          setAuditItems(data.items || []);
          setLegacyCampaigns(Array.isArray(data.legacy_dispatch_campaigns) ? data.legacy_dispatch_campaigns : []);
          setSelectedItemIds(new Set());
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        if (isMounted) {
          toast({
            title: "Erro ao carregar relatório",
            description: err instanceof Error ? err.message : "Erro desconhecido.",
            variant: "destructive",
          });
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadAudit();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [selectedImportId, activeClientId, imports, getIdToken, auditTarget, refreshKey]);

  const filteredItems = useMemo(() => {
    return auditItems.filter((item) => {
      const name = String(item.normalized_data?.nome || item.normalized_data?.name || "").toLowerCase();
      const phone = String(item.telefone || "").toLowerCase();
      const matchesSearch = name.includes(searchTerm.toLowerCase()) || phone.includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;
      if (selectedReason && item.failure_reason !== selectedReason) return false;

      switch (activeFilter) {
        case "failed":
          return !!item.failure_reason;
        case "replied":
          return item.has_replied;
        case "sent":
          return item.delivery_state === "enviado_por_esta_planilha" || item.delivery_state === "enviado_por_outra_campanha";
        case "pending":
          return item.delivery_state === "pendente";
        default:
          return true;
      }
    });
  }, [auditItems, activeFilter, searchTerm, selectedReason]);

  const reasonGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of auditItems) {
      if (!item.failure_reason) continue;
      counts.set(item.failure_reason, (counts.get(item.failure_reason) || 0) + 1);
    }
    const total = Array.from(counts.values()).reduce((sum, n) => sum + n, 0);
    return Array.from(counts.entries())
      .map(([reason, count]) => ({ reason, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);
  }, [auditItems]);

  const stats = useMemo(() => {
    const base = computeImportAuditStats(auditItems);
    const problems = reasonGroups.reduce((sum, g) => sum + g.count, 0);
    return { ...base, problems };
  }, [auditItems, reasonGroups]);
  const legacyNotice = legacyTrackingNotice(legacyCampaigns);

  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sortValue = (item: AuditItem, key: SortKey): string | number => {
    switch (key) {
      case "nome":
        return String(item.normalized_data?.nome || item.normalized_data?.name || "").toLowerCase();
      case "telefone":
        return item.telefone || "";
      case "status":
        return DELIVERY_STATE_LABELS[item.delivery_state] ?? "Ainda vai receber";
      case "tentativas":
        return item.dispatch_count || 0;
      case "retorno":
        return item.has_replied ? 1 : 0;
      case "tempo":
        return item.last_attempt_at ? new Date(item.last_attempt_at).getTime() : -1;
      case "lote":
        return "";
    }
  };

  const sortedItems = useMemo(() => {
    if (!sortKey) return filteredItems;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredItems].sort((a, b) => {
      const va = sortValue(a, sortKey);
      const vb = sortValue(b, sortKey);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [filteredItems, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedItems = useMemo(
    () => sortedItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [sortedItems, safePage]
  );

  const sortedCampaignRecipients = useMemo(() => {
    if (!sortKey) return filteredCampaignRecipients;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filteredCampaignRecipients].sort((a, b) => {
      let va: string | number = "";
      let vb: string | number = "";
      switch (sortKey) {
        case "nome":
          va = (a.nome || "").toLowerCase();
          vb = (b.nome || "").toLowerCase();
          break;
        case "telefone":
          va = a.telefone || "";
          vb = b.telefone || "";
          break;
        case "status":
          va = a.replied ? "respondido" : a.status;
          vb = b.replied ? "respondido" : b.status;
          break;
        case "retorno":
          va = a.replied ? 1 : 0;
          vb = b.replied ? 1 : 0;
          break;
        case "tempo":
          va = a.sentAt ? new Date(a.sentAt).getTime() : -1;
          vb = b.sentAt ? new Date(b.sentAt).getTime() : -1;
          break;
        case "lote":
          va = (a.dispatchName || "").toLowerCase();
          vb = (b.dispatchName || "").toLowerCase();
          break;
        default:
          return 0;
      }
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [filteredCampaignRecipients, sortKey, sortDir]);

  const totalCampaignPages = Math.max(1, Math.ceil(filteredCampaignRecipients.length / PAGE_SIZE));
  const safeCampaignPage = Math.min(page, totalCampaignPages);
  const pagedCampaignRecipients = useMemo(
    () => sortedCampaignRecipients.slice((safeCampaignPage - 1) * PAGE_SIZE, safeCampaignPage * PAGE_SIZE),
    [sortedCampaignRecipients, safeCampaignPage]
  );

  useEffect(() => {
    setPage(1);
  }, [activeFilter, searchTerm, selectedReason, auditTarget]);

  const handleReasonClick = (reason: string) => {
    setSelectedReason((prev) => (prev === reason ? null : reason));
  };

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

  const handleToggleSelectAllCampaignRecipients = () => {
    if (selectedRecipientIds.size === filteredCampaignRecipients.length) {
      setSelectedRecipientIds(new Set());
    } else {
      setSelectedRecipientIds(new Set(filteredCampaignRecipients.map((r) => r.leadId || r.telefone)));
    }
  };

  const handleToggleSelectCampaignRecipient = (id: string) => {
    const next = new Set(selectedRecipientIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedRecipientIds(next);
  };

  const handleCopySelectedPhones = () => {
    const selectedRecipients = filteredCampaignRecipients.filter((r) =>
      selectedRecipientIds.has(r.leadId || r.telefone)
    );
    const phones = selectedRecipients
      .map((r) => (r.telefone || "").replace(/\D/g, ""))
      .filter(Boolean);

    if (phones.length === 0) {
      toast({
        title: "Nenhum telefone válido",
        description: "Os destinatários selecionados não possuem telefones válidos.",
        variant: "destructive",
      });
      return;
    }

    navigator.clipboard.writeText(phones.join("\n"));
    toast({
      title: "Telefones copiados!",
      description: `${phones.length} telefone(s) copiado(s) para a área de transferência.`,
    });
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
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientId: activeClientId,
          leadImportItemIds: Array.from(selectedItemIds),
        }),
      });

      if (!res.ok) {
        const errorMsg = await readApiErrorMessage(res, "Erro ao excluir leads");
        throw new Error(errorMsg);
      }

      toast({
        title: "Leads excluídos",
        description: `${selectedItemIds.size} leads foram removidos da planilha.`,
      });

      setAuditItems((prev) => prev.filter((i) => !selectedItemIds.has(i.lead_import_item_id)));
      setSelectedItemIds(new Set());
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast({
        title: "Erro ao excluir",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setDeletingItems(false);
    }
  };

  const handleResetDispatchHistory = async () => {
    if (selectedItemIds.size === 0) return;
    if (!confirm(`Deseja resetar o histórico de disparos de ${selectedItemIds.size} lead(s)? Eles voltarão a ser elegíveis para novos disparos nesta planilha.`)) return;

    setResettingHistory(true);
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/reports/reset-dispatch-history`, {
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

      if (!res.ok) {
        const errorMsg = await readApiErrorMessage(res, "Erro ao resetar histórico de disparos");
        throw new Error(errorMsg);
      }

      const count = selectedItemIds.size;
      toast({
        title: "Histórico resetado",
        description: `Histórico resetado: ${count} lead(s) liberado(s) para novos disparos.`,
      });

      setSelectedItemIds(new Set());
      setRefreshKey((k) => k + 1);
    } catch (err) {
      toast({
        title: "Erro ao resetar disparos",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setResettingHistory(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="rounded-3xl border-border bg-card shadow-sm overflow-hidden">
        <CardHeader className="flex flex-col gap-4 border-b border-border/60 pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2">
                Auditoria de Envios
                <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider">
                  {auditTarget === "campaign" ? "Campanha" : "Planilha"}
                </Badge>
              </CardTitle>
              <CardDescription className="text-xs">
                {auditTarget === "campaign"
                  ? "Audite destinatários, taxas de resposta e falhas da campanha (Tags, Grupos, CRM ou Planilha)."
                  : "Audite o status de cada lead da planilha importada e crie novas bases de recampanha."}
              </CardDescription>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              {/* Alternador de Modo: Campanhas vs Planilhas */}
              <div className="flex items-center rounded-xl bg-slate-100 p-0.5 dark:bg-slate-800 border border-border">
                <button
                  type="button"
                  onClick={() => handleSwitchTarget("campaign")}
                  className={cn(
                    "px-3 py-1 text-xs font-semibold rounded-lg transition-all",
                    auditTarget === "campaign"
                      ? "bg-white text-foreground shadow-sm dark:bg-slate-700"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="audit-target-campaign"
                >
                  Campanhas {campaigns && campaigns.length > 0 ? `(${campaigns.length})` : ""}
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchTarget("import")}
                  className={cn(
                    "px-3 py-1 text-xs font-semibold rounded-lg transition-all",
                    auditTarget === "import"
                      ? "bg-white text-foreground shadow-sm dark:bg-slate-700"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  data-testid="audit-target-import"
                >
                  Planilhas {imports.length > 0 ? `(${imports.length})` : ""}
                </button>
              </div>

              {/* Seletor do Item Atual */}
              {auditTarget === "campaign" ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400">Campanha:</span>
                  <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
                    <SelectTrigger className="h-9 w-64 rounded-xl" data-testid="select-campaign-trigger">
                      <SelectValue placeholder="Selecione a campanha..." />
                    </SelectTrigger>
                    <SelectContent className="border-border bg-card text-card-foreground shadow-2xl">
                      {campaigns.map((c) => (
                        <SelectItem key={c.id} value={c.id} className="rounded-md focus:bg-muted dark:focus:bg-white/10">
                          {c.name} {c.status ? `(${CAMPAIGN_STATUS_LABELS[c.status] || c.status})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-400">Planilha:</span>
                  <Select value={selectedImportId} onValueChange={setSelectedImportId}>
                    <SelectTrigger className="h-9 w-56 rounded-xl" data-testid="select-import-trigger">
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
              )}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* ========================================================= */}
          {/* MODO CAMPANHA: AUDITORIA UNIVERSAL                        */}
          {/* ========================================================= */}
          {auditTarget === "campaign" ? (
            campaigns.length === 0 ? (
              <div className="p-8">
                <EmptyState
                  title="Nenhuma campanha encontrada"
                  description="Crie ou dispare uma campanha na aba Campanhas para visualizar os relatórios de auditoria."
                />
              </div>
            ) : loadingCampaignRecipients ? (
              <div className="p-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
                Carregando detalhes do relatório da campanha...
              </div>
            ) : (
              <>
                {/* ── Blocos de Métricas / KPIs da Campanha ── */}
                <div data-testid="audit-campaign-numbers" className="space-y-2 bg-slate-50/50 dark:bg-black/20 p-3 rounded-2xl border border-slate-200/60 dark:border-white/5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                    <PlanilhaStatCard
                      label="Total de Alvos"
                      value={campaignCounts.all}
                      className="text-slate-800 dark:text-slate-100"
                      testId="stat-campaign-total"
                    />
                    <PlanilhaStatCard
                      label="Enviados"
                      value={campaignCounts.sent}
                      className="text-emerald-600 dark:text-emerald-400"
                      testId="stat-campaign-sent"
                    />
                    <PlanilhaStatCard
                      label="Responderam (14d)"
                      value={campaignCounts.replied}
                      className="text-indigo-600 dark:text-indigo-400"
                      testId="stat-campaign-replied"
                    />
                    <PlanilhaStatCard
                      label="Falharam"
                      value={campaignCounts.failed}
                      className="text-rose-600 dark:text-rose-400"
                      testId="stat-campaign-failed"
                    />
                    <PlanilhaStatCard
                      label="Na Fila"
                      value={campaignCounts.pending}
                      className="text-slate-600 dark:text-slate-400"
                      testId="stat-campaign-pending"
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between text-[11px] text-muted-foreground px-1 pt-1 border-t border-slate-200/50 dark:border-white/5">
                    <span>
                      Taxa de Resposta: <strong className="text-indigo-600 dark:text-indigo-400">{campaignResponseRate}%</strong> ({campaignCounts.replied} respostas com janela causal de 14 dias pós-disparo)
                    </span>
                    <span>
                      {campaignCounts.all} alvos = {campaignCounts.sent} enviados + {campaignCounts.failed} falharam + {campaignCounts.pending} na fila
                    </span>
                  </div>
                </div>

                {/* ── Motivos das falhas agrupados ── */}
                {campaignReasonGroups.length > 0 && (
                  <div className="bg-slate-50/50 dark:bg-black/20 p-3.5 rounded-2xl border border-slate-200/60 dark:border-white/5 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
                        Motivos das falhas ({campaignCounts.failed} com erro)
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Clique em um motivo para filtrar a lista abaixo
                      </p>
                    </div>
                    <div className="space-y-1">
                      {campaignReasonGroups.map((g) => (
                        <button
                          key={g.reason}
                          type="button"
                          onClick={() => handleReasonClick(g.reason)}
                          className={cn(
                            "w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-xs transition-colors",
                            selectedReason === g.reason
                              ? "border-rose-300 bg-rose-50 dark:border-rose-800/60 dark:bg-rose-950/20"
                              : "border-transparent bg-white/60 hover:bg-white dark:bg-white/5 dark:hover:bg-white/10"
                          )}
                        >
                          <span className="font-semibold text-foreground truncate">{g.reason}</span>
                          <span className="shrink-0 text-muted-foreground font-mono">
                            {g.count} ({g.pct}%)
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Barra de Filtros, Busca e Exportação ── */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Button
                      size="sm"
                      variant={activeFilter === "all" ? "default" : "outline"}
                      onClick={() => setActiveFilter("all")}
                      className="h-8 text-xs font-semibold rounded-xl"
                    >
                      Todos ({campaignCounts.all})
                    </Button>
                    <Button
                      size="sm"
                      variant={activeFilter === "sent" ? "default" : "outline"}
                      onClick={() => setActiveFilter("sent")}
                      className={cn(
                        "h-8 text-xs font-semibold rounded-xl",
                        activeFilter === "sent" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : ""
                      )}
                    >
                      Enviados ({campaignCounts.sent})
                    </Button>
                    <Button
                      size="sm"
                      variant={activeFilter === "replied" ? "default" : "outline"}
                      onClick={() => setActiveFilter("replied")}
                      className={cn(
                        "h-8 text-xs font-semibold rounded-xl",
                        activeFilter === "replied" ? "bg-indigo-600 hover:bg-indigo-700 text-white" : ""
                      )}
                    >
                      Responderam ({campaignCounts.replied})
                    </Button>
                    <Button
                      size="sm"
                      variant={activeFilter === "failed" ? "default" : "outline"}
                      onClick={() => setActiveFilter("failed")}
                      className={cn(
                        "h-8 text-xs font-semibold rounded-xl",
                        activeFilter === "failed" ? "bg-rose-600 hover:bg-rose-700 text-white" : ""
                      )}
                    >
                      Falharam ({campaignCounts.failed})
                    </Button>
                    <Button
                      size="sm"
                      variant={activeFilter === "pending" ? "default" : "outline"}
                      onClick={() => setActiveFilter("pending")}
                      className="h-8 text-xs font-semibold rounded-xl"
                    >
                      Na Fila ({campaignCounts.pending})
                    </Button>
                    {selectedReason && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedReason(null)}
                        className="h-8 text-xs text-rose-500 hover:text-rose-600"
                      >
                        Limpar motivo ✕
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Buscar por nome ou telefone..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="h-8 pl-8 text-xs rounded-xl"
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleExportCampaignCsv(false)}
                      className="h-8 gap-1.5 text-xs font-semibold rounded-xl border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800"
                      data-testid="export-campaign-csv"
                    >
                      <Download className="h-3.5 w-3.5 text-indigo-500" />
                      <span>Exportar CSV</span>
                    </Button>
                  </div>
                </div>

                {/* ── Barra de Ações em Massa para Destinatários Selecionados ── */}
                {selectedRecipientIds.size > 0 && (
                  <div
                    data-testid="campaign-recipients-selection-bar"
                    className="flex flex-wrap items-center justify-between gap-3 p-3 bg-indigo-50/70 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/60 rounded-2xl animate-in fade-in duration-200"
                  >
                    <div className="flex items-center gap-2">
                      <Badge className="bg-indigo-600 text-white font-bold text-xs px-2.5 py-0.5 rounded-lg shadow-sm">
                        {selectedRecipientIds.size} selecionado{selectedRecipientIds.size > 1 ? "s" : ""}
                      </Badge>
                      <span className="text-xs text-indigo-950 dark:text-indigo-200 font-medium">
                        de {filteredCampaignRecipients.length} destinatários filtrados
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleExportCampaignCsv(true)}
                        className="h-7 text-xs font-semibold rounded-xl gap-1 border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-indigo-950"
                        data-testid="export-selected-campaign-recipients"
                      >
                        <Download className="h-3 w-3 text-indigo-500" />
                        <span>Exportar Selecionados ({selectedRecipientIds.size})</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleCopySelectedPhones}
                        className="h-7 text-xs font-semibold rounded-xl gap-1 border-indigo-300 dark:border-indigo-700 bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-indigo-950"
                        data-testid="copy-selected-campaign-phones"
                      >
                        <Copy className="h-3 w-3 text-indigo-500" />
                        <span>Copiar Telefones</span>
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedRecipientIds(new Set())}
                        className="h-7 text-xs text-muted-foreground hover:text-foreground rounded-xl"
                      >
                        Limpar seleção ✕
                      </Button>
                    </div>
                  </div>
                )}

                {/* ── Tabela de Destinatários da Campanha ── */}
                {filteredCampaignRecipients.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted-foreground border border-dashed rounded-2xl">
                    Nenhum destinatário encontrado com os filtros atuais.
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-2xl border border-border">
                    <Table className="text-xs">
                      <TableHeader className="bg-muted/30 dark:bg-muted/10">
                        <TableRow className="border-slate-200/60 dark:border-white/5">
                          <TableHead className="w-12 text-center h-10 py-0">
                            <input
                              type="checkbox"
                              data-testid="select-all-campaign-recipients"
                              checked={filteredCampaignRecipients.length > 0 && selectedRecipientIds.size === filteredCampaignRecipients.length}
                              onChange={handleToggleSelectAllCampaignRecipients}
                              className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500"
                            />
                          </TableHead>
                          <TableHead className="w-12 text-center h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500">#</TableHead>
                          <SortableTableHead sortKey="nome" activeKey={sortKey} dir={sortDir} onSort={handleSort}>Nome</SortableTableHead>
                          <SortableTableHead sortKey="telefone" activeKey={sortKey} dir={sortDir} onSort={handleSort}>Telefone</SortableTableHead>
                          <SortableTableHead sortKey="lote" activeKey={sortKey} dir={sortDir} onSort={handleSort}>Lote</SortableTableHead>
                          <SortableTableHead sortKey="status" activeKey={sortKey} dir={sortDir} onSort={handleSort} center>Status</SortableTableHead>
                          <SortableTableHead sortKey="tempo" activeKey={sortKey} dir={sortDir} onSort={handleSort}>Horário de Envio</SortableTableHead>
                          <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Resposta / Falha</TableHead>
                          <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500 text-right pr-4">Ação</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedCampaignRecipients.map((item, idx) => {
                          const cleanPhone = (item.telefone || "").replace(/\D/g, "");
                          const itemKey = item.leadId || item.telefone;
                          const isSelected = selectedRecipientIds.has(itemKey);
                          return (
                            <TableRow
                              key={item.leadId ? `${item.leadId}-${idx}` : `row-${idx}`}
                              className={cn(
                                "border-border hover:bg-muted/10",
                                isSelected ? "bg-indigo-50/10 dark:bg-indigo-950/5" : ""
                              )}
                            >
                              <TableCell className="text-center py-2">
                                <input
                                  type="checkbox"
                                  data-testid={`select-recipient-${itemKey}`}
                                  checked={isSelected}
                                  onChange={() => handleToggleSelectCampaignRecipient(itemKey)}
                                  className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500"
                                />
                              </TableCell>
                              <TableCell className="text-center py-2 text-muted-foreground font-mono text-[10px]">
                                {(safeCampaignPage - 1) * PAGE_SIZE + idx + 1}
                              </TableCell>
                              <TableCell className="py-2 font-semibold text-foreground">
                                {item.nome || "Sem nome"}
                              </TableCell>
                              <TableCell className="py-2 font-mono text-[11px]">
                                {item.telefone || "—"}
                              </TableCell>
                              <TableCell className="py-2 text-[11px] text-muted-foreground">
                                {item.dispatchName || "—"}
                              </TableCell>
                              <TableCell className="py-2 text-center">
                                {getCampaignStatusBadge(item)}
                              </TableCell>
                              <TableCell className="py-2 font-mono text-[11px] text-muted-foreground">
                                {formatTime(item.sentAt)}
                              </TableCell>
                              <TableCell className="py-2 max-w-[240px]">
                                {item.replied && item.lastInboundText ? (
                                  <div className="space-y-0.5">
                                    <p
                                      className="text-[11px] text-muted-foreground italic flex items-start gap-1 line-clamp-2"
                                      title={item.lastInboundText}
                                    >
                                      <MessageSquareQuote className="h-3 w-3 shrink-0 text-indigo-500 mt-0.5" />
                                      <span>“{item.lastInboundText}”</span>
                                    </p>
                                    {item.repliedAt && (
                                      <span className="text-[9px] text-muted-foreground font-mono">
                                        às {formatTime(item.repliedAt)}
                                      </span>
                                    )}
                                  </div>
                                ) : !item.replied && item.failureReason ? (
                                  <span className="text-rose-500 font-medium flex items-center gap-1.5 text-[11px]" title={item.failureReason}>
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                    <span className="truncate">{item.failureReason}</span>
                                  </span>
                                ) : (
                                  <span className="text-[11px] text-slate-400">—</span>
                                )}
                              </TableCell>
                              <TableCell className="py-2 text-right pr-4">
                                {cleanPhone ? (
                                  <Button
                                    asChild
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2.5 text-[11px] font-semibold gap-1 rounded-lg text-emerald-700 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-950/30"
                                  >
                                    <Link
                                      to={`/crm/whatsapp?chatId=${cleanPhone}&phone=${cleanPhone}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={`Abrir conversa com ${item.nome || cleanPhone} no WhatsApp Inbox`}
                                    >
                                      <MessageCircle className="h-3 w-3" />
                                      <span>Abrir no WhatsApp</span>
                                      <ExternalLink className="h-2.5 w-2.5 opacity-60 ml-0.5" />
                                    </Link>
                                  </Button>
                                ) : (
                                  <span className="text-[11px] text-muted-foreground">—</span>
                                )}
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {/* ── Paginação Campanha ── */}
                {filteredCampaignRecipients.length > PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-muted-foreground">
                      Página {safeCampaignPage} de {totalCampaignPages} — {filteredCampaignRecipients.length} destinatários
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 p-0"
                        disabled={safeCampaignPage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 p-0"
                        disabled={safeCampaignPage >= totalCampaignPages}
                        onClick={() => setPage((p) => Math.min(totalCampaignPages, p + 1))}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )
          ) : (
            /* ========================================================= */
            /* MODO PLANILHA: AUDITORIA LEGADA DE IMPORTAÇÃO             */
            /* ========================================================= */
            imports.length === 0 ? (
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
                {/* ── Aviso: campanha desta planilha disparada pelo caminho antigo (não registra envios) ── */}
                {legacyNotice && (
                  <div
                    role="alert"
                    data-testid="audit-legacy-notice"
                    className="flex items-start gap-2 rounded-2xl border border-amber-300/60 bg-amber-50 p-3.5 text-xs text-amber-900 dark:border-amber-700/40 dark:bg-amber-950/20 dark:text-amber-200"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <span>{legacyNotice}</span>
                  </div>
                )}

                {/* ── O ARQUIVO: linhas, contatos válidos, descartadas. Cada número diz o que conta, e a soma fecha. ── */}
                <div data-testid="audit-file-numbers" className="space-y-2 bg-slate-50/50 dark:bg-black/20 p-3 rounded-2xl border border-slate-200/60 dark:border-white/5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <PlanilhaStatCard label="Linhas do arquivo" value={stats.fileRows} className="text-slate-800 dark:text-slate-100" testId="stat-file-rows" />
                    <PlanilhaStatCard label="Contatos válidos (telefones únicos)" value={stats.validContacts} className="text-slate-800 dark:text-slate-100" testId="stat-valid-contacts" />
                    <PlanilhaStatCard label="Linhas descartadas" value={stats.discardedRows} className="text-rose-600 dark:text-rose-400" testId="stat-discarded-rows" />
                  </div>
                  <p data-testid="audit-file-sum" className="text-[11px] text-muted-foreground">
                    {stats.fileRows} {stats.fileRows === 1 ? "linha" : "linhas"} = {stats.validContacts} {stats.validContacts === 1 ? "contato válido" : "contatos válidos"} +{" "}
                    {stats.repeatedRows} {stats.repeatedRows === 1 ? "repetida (mesmo telefone de outra linha)" : "repetidas (mesmo telefone de outra linha)"} + {stats.discardedRows}{" "}
                    {stats.discardedRows === 1 ? "descartada" : "descartadas"}
                    {stats.discardedByReason.length > 0 && (
                      <span data-testid="audit-discard-reasons"> — {stats.discardedByReason.map((d) => `${d.count} × ${d.reason}`).join("; ")}</span>
                    )}
                    .
                  </p>
                </div>

                {/* ── Os CONTATOS: o que cada telefone válido recebeu. "Receberam" = o TELEFONE recebeu mensagem. ── */}
                <div data-testid="audit-contact-numbers" className="space-y-2 bg-slate-50/50 dark:bg-black/20 p-3 rounded-2xl border border-slate-200/60 dark:border-white/5">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <PlanilhaStatCard label="Receberam mensagem" value={stats.received} className="text-emerald-600 dark:text-emerald-400" testId="stat-received" />
                    <PlanilhaStatCard label="Falharam" value={stats.failed} className="text-rose-600 dark:text-rose-400" testId="stat-failed" />
                    <PlanilhaStatCard label="Ainda vão receber" value={stats.pending} className="text-slate-700 dark:text-slate-200" testId="stat-pending" />
                    <PlanilhaStatCard label="Com retorno (14d após um envio)" value={stats.replied} className="text-indigo-600 dark:text-indigo-400" testId="stat-replied" />
                  </div>
                  <p data-testid="audit-contact-sum" className="text-[11px] text-muted-foreground">
                    {stats.validContacts} {stats.validContacts === 1 ? "contato" : "contatos"} = {stats.received} receberam ({stats.receivedByThisImport} por campanha desta planilha +{" "}
                    {stats.receivedByOther} por outra campanha) + {stats.failed} falharam + {stats.pending} ainda vão receber.
                  </p>
                  <p data-testid="audit-meaning-note" className="text-[11px] text-muted-foreground">
                    "Receberam" conta telefones que receberam mensagem de qualquer campanha — não quer dizer que esta planilha disparou para eles. Um contato que está em duas planilhas
                    aparece como recebido nas duas, porque recebeu.
                  </p>
                </div>

                {/* ── Por que falhou — o motivo desta tela existir. Cada linha é clicável e filtra a lista abaixo. ── */}
                {reasonGroups.length > 0 && (
                  <div className="bg-slate-50/50 dark:bg-black/20 p-3.5 rounded-2xl border border-slate-200/60 dark:border-white/5 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
                        Linhas com problema (descartadas e falhas de envio)
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {stats.problems} de {stats.fileRows} {stats.fileRows === 1 ? "linha" : "linhas"} do arquivo com problema
                      </p>
                    </div>
                    <div className="space-y-1">
                      {reasonGroups.map((g) => (
                        <button
                          key={g.reason}
                          type="button"
                          onClick={() => handleReasonClick(g.reason)}
                          className={cn(
                            "w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-xs transition-colors",
                            selectedReason === g.reason
                              ? "border-rose-300 bg-rose-50 dark:border-rose-800/60 dark:bg-rose-950/20"
                              : "border-transparent bg-white/60 hover:bg-white dark:bg-white/5 dark:hover:bg-white/10"
                          )}
                        >
                          <span className="font-semibold text-foreground truncate">{g.reason}</span>
                          <span className="shrink-0 text-muted-foreground font-mono">
                            {g.count} ({g.pct}%)
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Busca + filtros Todos/Falhas/Com Retorno ────────────────── */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {([
                      { key: "all", label: "Todos" },
                      { key: "failed", label: "Falhas" },
                      { key: "replied", label: "Com Retorno" },
                    ] as const).map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setActiveFilter(f.key)}
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[10px] font-bold transition-colors",
                          activeFilter === f.key
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-muted-foreground"
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                    {selectedReason && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelectedReason(null)}
                        className="h-8 text-xs text-rose-500 hover:text-rose-600"
                      >
                        Limpar motivo ✕
                      </Button>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                      <Input
                        placeholder="Buscar por nome ou telefone..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="h-8 pl-8 text-xs rounded-xl"
                      />
                    </div>
                    {selectedItemIds.size > 0 && (
                      <div className="flex items-center gap-1.5 animate-in fade-in">
                        <Button
                          size="sm"
                          onClick={handleCreateCohortCampaign}
                          disabled={creatingSubset || resettingHistory || deletingItems}
                          className="h-8 gap-1.5 text-xs font-bold rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm"
                        >
                          {creatingSubset ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          Criar Recampanha ({selectedItemIds.size})
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={handleResetDispatchHistory}
                          disabled={resettingHistory || deletingItems || creatingSubset}
                          className="h-8 gap-1.5 text-xs font-semibold rounded-xl border-amber-300 dark:border-amber-700/60 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                          title="Limpa o histórico de envios e réguas para permitir novos disparos a estes contatos"
                        >
                          {resettingHistory ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                          Resetar Disparos ({selectedItemIds.size})
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={handleDeleteImportItems}
                          disabled={deletingItems || resettingHistory || creatingSubset}
                          className="h-8 gap-1 text-xs font-bold rounded-xl"
                          title="Excluir leads selecionados da planilha"
                        >
                          {deletingItems ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Tabela Detalhada de Leads da Planilha ─────────────────────────── */}
                {filteredItems.length === 0 ? (
                  <div className="p-8 text-center text-xs text-muted-foreground border border-dashed rounded-2xl">
                    Nenhum lead encontrado com os filtros atuais.
                  </div>
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
                          <SortableTableHead sortKey="nome" activeKey={sortKey} dir={sortDir} onSort={handleSort}>Nome</SortableTableHead>
                          <SortableTableHead sortKey="telefone" activeKey={sortKey} dir={sortDir} onSort={handleSort}>Telefone</SortableTableHead>
                          <SortableTableHead sortKey="status" activeKey={sortKey} dir={sortDir} onSort={handleSort} center title="O que ESTE TELEFONE recebeu (de qualquer campanha), não só desta planilha">Situação do telefone</SortableTableHead>
                          <SortableTableHead sortKey="tentativas" activeKey={sortKey} dir={sortDir} onSort={handleSort} center title="Tentativas de envio para este telefone, de qualquer campanha">Tentativas (telefone)</SortableTableHead>
                          <SortableTableHead
                            sortKey="retorno"
                            activeKey={sortKey}
                            dir={sortDir}
                            onSort={handleSort}
                            center
                            title="Mede respostas recebidas em até 14 dias pós-disparo"
                          >
                            Retorno (14d)
                          </SortableTableHead>
                          <SortableTableHead sortKey="tempo" activeKey={sortKey} dir={sortDir} onSort={handleSort}>Há quanto tempo</SortableTableHead>
                          <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Motivo da Falha / Detalhe</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {pagedItems.map((item) => {
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
                                <Badge
                                  data-testid={`row-state-${item.row_number}`}
                                  className={cn("border text-[9px] font-bold rounded-lg px-2 py-0.25", DELIVERY_STATE_COLORS[item.delivery_state] ?? DELIVERY_STATE_COLORS.pendente)}
                                >
                                  {DELIVERY_STATE_LABELS[item.delivery_state] ?? DELIVERY_STATE_LABELS.pendente}
                                </Badge>
                                {item.duplicate_of_row != null && (
                                  <span data-testid={`row-repeated-${item.row_number}`} className="mt-0.5 block text-[9px] text-muted-foreground">
                                    Repete a linha {item.duplicate_of_row}
                                  </span>
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
                              <TableCell className="py-2 text-muted-foreground truncate max-w-[200px]" title={item.failure_reason || ""}>
                                {item.failure_reason ? (
                                  <span className="text-rose-500 font-medium flex items-center gap-1.5">
                                    <AlertTriangle className="h-3 w-3 shrink-0" />
                                    {item.failure_reason}
                                  </span>
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

                {/* ── Paginação Planilha ── */}
                {filteredItems.length > PAGE_SIZE && (
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-muted-foreground">
                      Página {safePage} de {totalPages} — {filteredItems.length} leads
                    </span>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 p-0"
                        disabled={safePage <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 p-0"
                        disabled={safePage >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PlanilhaStatCard({ label, value, className, testId }: { label: string; value: number; className?: string; testId?: string }) {
  return (
    <div className="flex flex-col items-center justify-center p-2 rounded-xl border border-transparent text-center" data-testid={testId}>
      <span className="text-[10px] font-bold text-slate-400 uppercase">{label}</span>
      <span data-testid={testId ? `${testId}-value` : undefined} className={cn("text-base font-bold", className)}>{value}</span>
    </div>
  );
}

function SortableTableHead({
  sortKey,
  activeKey,
  dir,
  onSort,
  center,
  title,
  children,
}: {
  sortKey: SortKey;
  activeKey: SortKey | null;
  dir: "asc" | "desc";
  onSort: (key: SortKey) => void;
  center?: boolean;
  title?: string;
  children: ReactNode;
}) {
  const isActive = activeKey === sortKey;
  return (
    <TableHead
      onClick={() => onSort(sortKey)}
      title={title}
      className={cn(
        "h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500 cursor-pointer select-none hover:text-foreground transition-colors",
        center && "text-center"
      )}
    >
      <span className={cn("inline-flex items-center gap-0.5", center && "justify-center")}>
        {children}
        {isActive && (dir === "asc" ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}
      </span>
    </TableHead>
  );
}
