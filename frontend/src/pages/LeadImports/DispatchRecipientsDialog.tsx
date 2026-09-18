import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Download, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Clock, Search, Play, PhoneOff, Trash2 } from "lucide-react";
import { useDispatchRecipients, useRetryFailedDispatchLeads, useRunPendingDispatchLeads } from "@/hooks/useCampanhas";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { API_BASE_URL } from "@/lib/api";
import { cn } from "@/lib/utils";

interface DispatchRecipientsDialogProps {
  dispatchId: string | null;
  onClose: () => void;
  /** Chamado depois de excluir o lote com sucesso — quem chama decide o que invalidar/atualizar. */
  onDeleted?: () => void;
}

export function DispatchRecipientsDialog({ dispatchId, onClose, onDeleted }: DispatchRecipientsDialogProps) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const { toast } = useToast();
  const { getIdToken } = useAuth();
  const { data, isLoading, refetch, isFetching } = useDispatchRecipients(dispatchId, statusFilter);
  const retryFailedMutation = useRetryFailedDispatchLeads();
  const runPendingMutation = useRunPendingDispatchLeads();

  const handleDownloadCsv = async () => {
    if (!dispatchId) return;
    try {
      setDownloadingCsv(true);
      const token = await getIdToken();
      const url = new URL(`${API_BASE_URL}/api/campaigns/dispatches/${dispatchId}/recipients`);
      url.searchParams.set("format", "csv");
      if (statusFilter && statusFilter !== "all") {
        url.searchParams.set("status", statusFilter);
      }

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) throw new Error("Falha ao exportar relatório CSV");

      const blob = await res.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      const fileName = `destinatarios-${(data?.dispatchName || "lote").replace(/[^a-zA-Z0-9_-]/g, "_")}.csv`;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(downloadUrl);

      toast({ title: "Relatório baixado com sucesso" });
    } catch (err: any) {
      toast({ title: "Erro na exportação", description: err.message, variant: "destructive" });
    } finally {
      setDownloadingCsv(false);
    }
  };

  const handleRetryFailed = async () => {
    if (!dispatchId) return;
    try {
      const res = await retryFailedMutation.mutateAsync(dispatchId);
      toast({
        title: "Reenvio agendado",
        description: res.message || `${res.retriedCount} lead(s) liberado(s) para reenvio.`,
      });
      refetch();
    } catch (err: any) {
      toast({
        title: "Erro ao reenviar",
        description: err.message || "Não foi possível reenviar os leads com falha.",
        variant: "destructive",
      });
    }
  };

  const handleRunPending = async () => {
    if (!dispatchId) return;
    try {
      const res = await runPendingMutation.mutateAsync(dispatchId);
      toast({
        title: "Disparo iniciado",
        description: res.message || `${res.pendingCount || data?.pendingCount || 0} lead(s) não processado(s) agendado(s) para envio.`,
      });
      refetch();
    } catch (err: any) {
      toast({
        title: "Erro ao disparar não processados",
        description: err.message || "Não foi possível iniciar o envio dos leads pendentes.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteDispatch = async () => {
    if (!dispatchId) return;
    const nome = data?.dispatchName || "este lote";
    if (
      !window.confirm(
        `Excluir o lote "${nome}"?\n\nOs leads já enviados continuam no histórico do Inbox — só a fila de agendamento deste lote é removida. Não pode ser desfeito.`
      )
    ) {
      return;
    }
    setDeleting(true);
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/dispatches/${dispatchId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message || "Erro ao excluir lote");
      }
      toast({ title: "Lote excluído" });
      onDeleted?.();
      onClose();
    } catch (err: any) {
      toast({ title: "Erro ao excluir lote", description: err.message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const filteredItems = (data?.items || []).filter((item) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase().trim();
    return (
      (item.nome && item.nome.toLowerCase().includes(q)) ||
      (item.telefone && item.telefone.includes(q)) ||
      (item.failureReason && item.failureReason.toLowerCase().includes(q))
    );
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "sent":
        return (
          <Badge className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 text-[10px] font-bold">
            <CheckCircle2 className="h-3 w-3 mr-1 text-emerald-600" /> Enviado
          </Badge>
        );
      case "invalid_number":
        return (
          <Badge className="border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-700 dark:bg-purple-900/30 dark:text-purple-400 text-[10px] font-bold">
            <PhoneOff className="h-3 w-3 mr-1 text-purple-600" /> Número inválido
          </Badge>
        );
      case "failed":
        return (
          <Badge className="border-rose-300 bg-rose-50 text-rose-700 dark:border-rose-700 dark:bg-rose-900/30 dark:text-rose-400 text-[10px] font-bold">
            <XCircle className="h-3 w-3 mr-1 text-rose-600" /> Falhou
          </Badge>
        );
      case "skipped":
        return (
          <Badge className="border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-400 text-[10px] font-bold">
            <AlertTriangle className="h-3 w-3 mr-1 text-amber-600" /> Pulado
          </Badge>
        );
      case "pending":
      default:
        return (
          <Badge className="border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 text-[10px] font-medium">
            <Clock className="h-3 w-3 mr-1 text-slate-500" /> Não processado
          </Badge>
        );
    }
  };

  const formatTime = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <Dialog open={!!dispatchId} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col bg-white dark:bg-slate-900 border border-border shadow-2xl rounded-2xl p-6">
        <DialogHeader className="pb-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/50">
          <div>
            <DialogTitle className="text-lg font-bold font-display text-foreground flex items-center gap-2">
              Destinatários do Lote
              {data?.dispatchName && <span className="text-indigo-600 dark:text-indigo-400">“{data.dispatchName}”</span>}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-0.5">
              Campanha: <strong className="text-foreground">{data?.campaignName || "—"}</strong> • Total de{" "}
              <strong>{data?.total ?? "..."}</strong> destinatários mapeados
            </DialogDescription>
          </div>

          {/* Ações superiores */}
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {data && data.pendingCount > 0 && (
              <Button
                size="sm"
                variant="default"
                disabled={runPendingMutation.isPending}
                onClick={handleRunPending}
                className="h-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-sm gap-1.5"
              >
                {runPendingMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5 fill-current" />
                )}
                Disparar não processados ({data.pendingCount})
              </Button>
            )}

            {data && data.failedCount > 0 && (
              <Button
                size="sm"
                variant="default"
                disabled={retryFailedMutation.isPending}
                onClick={handleRetryFailed}
                className="h-8 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-bold shadow-sm gap-1.5"
              >
                {retryFailedMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
                Reenviar Falhados ({data.failedCount})
              </Button>
            )}

            <Button
              size="sm"
              variant="outline"
              disabled={downloadingCsv || isLoading}
              onClick={handleDownloadCsv}
              className="h-8 border-border rounded-xl text-xs font-semibold gap-1.5"
            >
              {downloadingCsv ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5 text-indigo-500" />}
              Exportar CSV
            </Button>
          </div>
        </DialogHeader>

        {/* Filtros e Busca */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3">
          <div className="flex flex-wrap items-center gap-1.5 w-full sm:w-auto">
            <Button
              size="sm"
              variant={statusFilter === "all" ? "default" : "outline"}
              onClick={() => setStatusFilter("all")}
              className={cn("h-7 text-xs px-2.5 rounded-lg font-bold", statusFilter === "all" && "bg-slate-900 text-white dark:bg-white dark:text-slate-900")}
            >
              Todos ({data?.total ?? 0})
            </Button>
            <Button
              size="sm"
              variant={statusFilter === "sent" ? "default" : "outline"}
              onClick={() => setStatusFilter("sent")}
              className={cn(
                "h-7 text-xs px-2.5 rounded-lg font-bold",
                statusFilter === "sent" ? "bg-emerald-600 text-white" : "text-emerald-600 border-emerald-300"
              )}
            >
              Enviados ({data?.sentCount ?? 0}) ✓
            </Button>
            <Button
              size="sm"
              variant={statusFilter === "failed" ? "default" : "outline"}
              onClick={() => setStatusFilter("failed")}
              className={cn(
                "h-7 text-xs px-2.5 rounded-lg font-bold",
                statusFilter === "failed" ? "bg-rose-600 text-white" : "text-rose-600 border-rose-300"
              )}
            >
              Falhas ({data?.failedCount ?? 0}) ✗
            </Button>
            {data && (data.invalidCount ?? 0) > 0 && (
              <Button
                size="sm"
                variant={statusFilter === "invalid_number" ? "default" : "outline"}
                onClick={() => setStatusFilter("invalid_number")}
                className={cn(
                  "h-7 text-xs px-2.5 rounded-lg font-bold",
                  statusFilter === "invalid_number" ? "bg-purple-600 text-white" : "text-purple-600 border-purple-300"
                )}
              >
                Número inválido ({data.invalidCount}) 🚫
              </Button>
            )}
            {data && data.skippedCount > 0 && (
              <Button
                size="sm"
                variant={statusFilter === "skipped" ? "default" : "outline"}
                onClick={() => setStatusFilter("skipped")}
                className={cn(
                  "h-7 text-xs px-2.5 rounded-lg font-bold",
                  statusFilter === "skipped" ? "bg-amber-600 text-white" : "text-amber-600 border-amber-300"
                )}
              >
                Pulados ({data.skippedCount})
              </Button>
            )}
            <Button
              size="sm"
              variant={statusFilter === "pending" ? "default" : "outline"}
              onClick={() => setStatusFilter("pending")}
              className={cn(
                "h-7 text-xs px-2.5 rounded-lg font-bold",
                statusFilter === "pending" ? "bg-slate-600 text-white" : "text-slate-600 border-slate-300"
              )}
            >
              Não processados ({data?.pendingCount ?? 0})
            </Button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar nome, fone, motivo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 text-xs rounded-xl"
            />
          </div>
        </div>

        {/* Tabela de Destinatários */}
        <div className="flex-1 overflow-y-auto mt-3 rounded-xl border border-border bg-slate-50/50 dark:bg-slate-900/40">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-3 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
              <p className="text-xs font-medium">Buscando histórico de destinatários...</p>
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
              <p className="text-sm font-medium">Nenhum destinatário encontrado neste filtro.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-b border-border/60 hover:bg-transparent">
                  <TableHead className="w-12 text-xs font-bold text-center">#</TableHead>
                  <TableHead className="text-xs font-bold">Contato</TableHead>
                  <TableHead className="text-xs font-bold text-center">Status</TableHead>
                  <TableHead className="text-xs font-bold">Data / Horário</TableHead>
                  <TableHead className="text-xs font-bold">Motivo / Detalhe</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => (
                  <TableRow key={item.index} className="border-b border-border/30 hover:bg-muted/10">
                    <TableCell className="text-center text-xs text-muted-foreground font-mono">{item.index}</TableCell>
                    <TableCell className="py-2.5">
                      <p className="text-xs font-bold text-foreground">{item.nome}</p>
                      <p className="text-[11px] text-muted-foreground font-mono">{item.telefone}</p>
                    </TableCell>
                    <TableCell className="text-center py-2.5">{getStatusBadge(item.status)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground py-2.5 font-mono">
                      {formatTime(item.sentAt || item.attemptedAt)}
                    </TableCell>
                    <TableCell className="py-2.5 max-w-[280px]">
                      {item.failureReason ? (
                        <div>
                          <p className="text-xs font-semibold text-rose-600 dark:text-rose-400">{item.failureReason}</p>
                          {item.technicalDetails && (
                            <p
                              className="text-[10px] text-muted-foreground/80 truncate font-mono mt-0.5"
                              title={item.technicalDetails}
                            >
                              {item.technicalDetails}
                            </p>
                          )}
                        </div>
                      ) : item.status === "sent" ? (
                        <span className="text-xs text-emerald-600 font-medium">Entregue com sucesso</span>
                      ) : item.status === "skipped" ? (
                        <span className="text-xs text-amber-600 font-medium">Interrompido antes do envio</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Pendente na fila</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter className="mt-3 flex items-center justify-between border-t border-border/50 pt-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {isFetching && <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-500" />}
            <span>Exibindo {filteredItems.length} registros</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={handleDeleteDispatch}
              disabled={deleting || !dispatchId}
              variant="outline"
              title="Excluir este lote — cirurgia pontual, não afeta os outros lotes da campanha"
              className="h-8 text-xs font-bold rounded-xl px-3 text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-900/40 dark:hover:bg-rose-950/20"
            >
              {deleting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
              Excluir lote
            </Button>
            <Button onClick={onClose} variant="outline" className="h-8 text-xs font-bold rounded-xl px-4">
              Fechar
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
