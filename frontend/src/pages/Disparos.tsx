import { useMemo, useState } from "react";
import {
  Play,
  Trash2,
  Download,
  RefreshCw,
  Send,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Gauge,
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
import { useQueryClient } from "@tanstack/react-query";

import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useLeadClients } from "@/hooks/useLeadClients";
import {
  useAllDispatches,
  useTriggerDispatch,
  useDeleteDispatch,
  type CampaignDispatch,
} from "@/hooks/useCampanhas";
import { toast } from "@/components/ui/use-toast";
import { API_BASE_URL } from "@/lib/api";

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

export default function Disparos() {
  const { clientId, isAdminUser, getIdToken } = useAuth();
  const { data: tenants = [] } = useLeadClients();
  const { resolvedTheme } = useTheme();
  const queryClient = useQueryClient();

  const [selectedClientId, setSelectedClientId] = useState<string>(() => clientId ?? "");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");

  const showSelector = isAdminUser || !clientId;
  const activeClientId = selectedClientId || clientId || "";

  const { data: dispatches = [], isLoading, error, refetch, isRefetching } = useAllDispatches(activeClientId || null);

  const triggerDispatch = useTriggerDispatch("");
  const deleteDispatch = useDeleteDispatch("");

  // Filter dispatches based on search term
  const filteredDispatches = useMemo(() => {
    if (!searchTerm.trim()) return dispatches;
    const term = searchTerm.toLowerCase();
    return dispatches.filter(
      (d) =>
        d.name.toLowerCase().includes(term) ||
        (d as any).campaign_name?.toLowerCase().includes(term)
    );
  }, [dispatches, searchTerm]);

  // General KPIs metrics
  const kpis = useMemo(() => {
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

  // Chart data: last 8 dispatches with sends/failures
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

  const handleTrigger = async (dispatch: CampaignDispatch) => {
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
      refetch();
    } catch (err) {
      toast({
        title: "Erro ao iniciar disparo",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (dispatch: CampaignDispatch) => {
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
      refetch();
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
          <Badge className="border border-slate-300/80 bg-white/90 text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/65 rounded-xl text-[10px]">
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
          <Badge className="border border-slate-300/80 bg-white/90 text-slate-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/50 rounded-xl text-[10px]">
            Cancelado
          </Badge>
        );
      default:
        return (
          <Badge className="border border-slate-300/80 bg-white/90 text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/65 rounded-xl text-[10px]">
            {status}
          </Badge>
        );
    }
  };

  return (
    <PageShell
      title="Disparos"
      subtitle="Acompanhe e gerencie lotes de disparo em massa da sua plataforma."
      spacing="space-y-6"
      compactHero
      headerRight={
        <div className="flex items-center gap-3">
          {showSelector && (
            <Select value={selectedClientId} onValueChange={setSelectedClientId}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Selecione um tenant" />
              </SelectTrigger>
              <SelectContent>
                {tenants.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            variant="outline"
            size="sm"
            className="rounded-xl h-10 border-slate-200/80 dark:border-white/10"
            disabled={isLoading || isRefetching}
            onClick={() => void refetch()}
          >
            <RefreshCw className={`h-4 w-4 mr-1.5 ${isRefetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      }
    >
      <ErrorMessage message={error ? (error as Error).message : null} variant="banner" />

      {!activeClientId ? (
        <EmptyState
          title="Selecione um tenant"
          description="Escolha um tenant no seletor acima para acompanhar os disparos."
        />
      ) : isLoading ? (
        <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
          Carregando disparos...
        </div>
      ) : (
        <>
          {/* KPI Dashboard Cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-white/5 dark:bg-white/[0.02] rounded-2xl">
              <CardContent className="p-6 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-display">
                    Total de Disparos
                  </p>
                  <p className="text-3xl font-bold font-num text-foreground">
                    {kpis.total}
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-indigo-200/60 bg-indigo-50 dark:border-indigo-800/40 dark:bg-indigo-950/40">
                  <Send className="h-6 w-6 text-indigo-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-white/5 dark:bg-white/[0.02] rounded-2xl">
              <CardContent className="p-6 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-display">
                    Sucessos
                  </p>
                  <p className="text-3xl font-bold font-num text-emerald-600 dark:text-emerald-400">
                    {kpis.sent}
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-200/60 bg-emerald-50 dark:border-emerald-800/40 dark:bg-emerald-950/40">
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-white/5 dark:bg-white/[0.02] rounded-2xl">
              <CardContent className="p-6 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-display">
                    Falhas
                  </p>
                  <p className="text-3xl font-bold font-num text-rose-600 dark:text-rose-400">
                    {kpis.failed}
                  </p>
                </div>
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-200/60 bg-rose-50 dark:border-rose-800/40 dark:bg-rose-950/40">
                  <AlertTriangle className="h-6 w-6 text-rose-500" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/80 bg-white/90 shadow-[0_10px_30px_rgba(15,23,42,0.04)] dark:border-white/5 dark:bg-white/[0.02] rounded-2xl">
              <CardContent className="p-6 flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider font-display">
                    Taxa de Entrega
                  </p>
                  <p className="text-3xl font-bold font-num text-foreground">
                    {kpis.successRate}%
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
            <Card className="lg:col-span-1 border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.04] rounded-2xl">
              <CardHeader>
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
            <Card className="lg:col-span-2 border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/[0.04] rounded-2xl">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <div>
                  <CardTitle className="text-base font-bold">Histórico de Execuções</CardTitle>
                  <CardDescription>Gerencie o envio dos lotes de disparo.</CardDescription>
                </div>
                <input
                  className="h-9 w-44 rounded-xl border border-slate-200 bg-white px-3 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-white/10 dark:bg-white/[0.05]"
                  placeholder="Buscar lote..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </CardHeader>
              <CardContent className="p-0">
                {filteredDispatches.length === 0 ? (
                  <div className="p-8">
                    <EmptyState
                      title="Nenhum disparo encontrado"
                      description={searchTerm ? "Tente alterar os termos da busca." : "Nenhum lote de disparo foi cadastrado ainda."}
                    />
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-slate-200/60 dark:border-white/5">
                          <TableHead className="px-6 py-4 text-xs font-semibold uppercase tracking-wider font-display">
                            Lote / Campanha
                          </TableHead>
                          <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider font-display text-center">
                            Status
                          </TableHead>
                          <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider font-display text-center">
                            Progresso
                          </TableHead>
                          <TableHead className="px-4 py-4 text-xs font-semibold uppercase tracking-wider font-display">
                            Executado Em
                          </TableHead>
                          <TableHead className="px-6 py-4 text-xs font-semibold uppercase tracking-wider font-display text-right">
                            Ações
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredDispatches.map((d) => {
                          const total = (d.sent_count ?? 0) + (d.failed_count ?? 0);
                          const isTriggering = triggerDispatch.isPending && triggerDispatch.variables === d.id;
                          const isDeleting = deleteDispatch.isPending && deleteDispatch.variables === d.id;
                          const isDownloading = downloadingId === d.id;

                          return (
                            <TableRow key={d.id} className="border-slate-200/60 hover:bg-slate-50/50 dark:border-white/5 dark:hover:bg-white/[0.01]">
                              <TableCell className="px-6 py-4">
                                <div className="space-y-0.5">
                                  <p className="text-sm font-semibold text-foreground">
                                    {d.name}
                                  </p>
                                  <p className="text-xs text-muted-foreground font-medium flex items-center gap-1.5">
                                    <span>{(d as any).campaign_name || "Sem Campanha"}</span>
                                    <span>•</span>
                                    <span className="capitalize">{d.trigger_type}</span>
                                  </p>
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-4 text-center">
                                {getStatusBadge(d.status)}
                              </TableCell>
                              <TableCell className="px-4 py-4">
                                <div className="flex flex-col items-center justify-center gap-1.5">
                                  <div className="flex items-center justify-between gap-2 text-xs w-28">
                                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                                      {d.sent_count} ✓
                                    </span>
                                    <span className="font-semibold text-rose-500">
                                      {d.failed_count} ✗
                                    </span>
                                  </div>
                                  {total > 0 && (
                                    <div className="h-1.5 w-28 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                                      <div
                                        className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                                        style={{ width: `${Math.round((d.sent_count / total) * 100)}%` }}
                                      />
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell className="px-4 py-4 text-xs font-num text-muted-foreground whitespace-nowrap">
                                {formatDateTime(d.triggered_at || d.created_at)}
                              </TableCell>
                              <TableCell className="px-6 py-4 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {d.status === "draft" && (
                                    <Button
                                      size="sm"
                                      variant="default"
                                      className="h-8 rounded-xl px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs shadow-sm"
                                      disabled={isTriggering}
                                      onClick={() => void handleTrigger(d)}
                                    >
                                      {isTriggering ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Play className="h-3.5 w-3.5 mr-1" />
                                      )}
                                      Iniciar
                                    </Button>
                                  )}

                                  {d.failed_count > 0 && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 w-8 rounded-xl p-0 border-slate-200/80 hover:bg-slate-100 dark:border-white/10 dark:hover:bg-white/[0.05]"
                                      title="Baixar falhas"
                                      disabled={isDownloading}
                                      onClick={() => void handleDownloadFailedCsv(d)}
                                    >
                                      {isDownloading ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Download className="h-3.5 w-3.5 text-slate-700 dark:text-white/80" />
                                      )}
                                    </Button>
                                  )}

                                  {(d.status === "draft" || d.status === "failed" || d.status === "done") && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 w-8 rounded-xl p-0 border-rose-200/40 hover:bg-rose-500/10 hover:text-rose-600 dark:border-rose-950/20 text-rose-500"
                                      title="Excluir lote"
                                      disabled={isDeleting}
                                      onClick={() => void handleDelete(d)}
                                    >
                                      {isDeleting ? (
                                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                      ) : (
                                        <Trash2 className="h-3.5 w-3.5" />
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
        </>
      )}
    </PageShell>
  );
}
