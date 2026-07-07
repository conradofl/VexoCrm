import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Gauge,
  Loader2,
  Play,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
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
import { useQueryClient } from "@tanstack/react-query";

import { useAuth } from "@/contexts/AuthContext";
import {
  useAllDispatches,
  useTriggerDispatch,
  useDeleteDispatch,
  CAMPAIGN_STATUS_COLORS,
  CAMPAIGN_STATUS_LABELS,
  type CampaignDispatch,
  type CampaignStatus,
} from "@/hooks/useCampanhas";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { API_BASE_URL } from "@/lib/api";
import { formatDateTime } from "@/lib/leadImports/spreadsheet";

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

export function LeadImportAuditReport({ activeClientId, imports, onSelectImportForFollowup }: LeadImportAuditReportProps) {
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
                  Lotes Criados
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
