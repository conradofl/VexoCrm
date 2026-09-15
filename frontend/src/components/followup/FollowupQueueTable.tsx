import { useState, useMemo } from "react";
import {
  AlertTriangle,
  Calendar,
  Clock,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  UserCheck,
  Zap,
  Pencil,
  Ban,
  Info,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import {
  useFollowupQueue,
  useRetryFollowupStep,
  useDiscardFollowup,
  useCancelFollowupJob,
  useDeleteFollowup,
  useConvertToInbound,
  type FollowupItem,
  type FollowupStatus,
} from "@/hooks/useFollowupQueue";
import { FOLLOWUP_STATUS_COLORS, FOLLOWUP_STATUS_LABELS } from "@/lib/followup/constants";
import { useFupCampaigns } from "@/hooks/useFollowupAdmin";
import { EditFollowupScheduleModal } from "./EditFollowupScheduleModal";

interface FollowupQueueTableProps {
  companyId?: string;
  tenantId?: string;
}

export function FollowupQueueTable({ companyId, tenantId }: FollowupQueueTableProps) {
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("all");
  const [selectedStatus, setSelectedStatus] = useState<string>("open");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [editingItem, setEditingItem] = useState<FollowupItem | null>(null);

  const { data: campaigns = [] } = useFupCampaigns(companyId);

  // Se selectedStatus for 'open', não passamos status na query para que o hook traga a base e possamos calcular quantos estão ocultos
  const backendStatusFilter =
    selectedStatus === "all" || selectedStatus === "open"
      ? undefined
      : (selectedStatus as FollowupStatus);

  const {
    data: queueData,
    isLoading: loadingQueue,
    refetch: refetchQueue,
  } = useFollowupQueue({
    companyId: companyId || undefined,
    tenantId: tenantId || undefined,
    campaignId: selectedCampaignId !== "all" ? selectedCampaignId : undefined,
    status: backendStatusFilter,
  });

  const retryStep = useRetryFollowupStep();
  const discardFollowup = useDiscardFollowup();
  const cancelJob = useCancelFollowupJob();
  const deleteFollowup = useDeleteFollowup();
  const convertToInbound = useConvertToInbound();

  const [loadingActionId, setLoadingActionId] = useState<string | null>(null);

  const items = queueData?.items || [];

  // Quantidade de itens cancelados e concluídos ocultos na visualização padrão ('open')
  const hiddenCancelledCompletedCount = useMemo(() => {
    return items.filter((i) => i.status === "cancelled" || i.status === "completed").length;
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // 1. Filtro de Status Oculto por padrão
      if (selectedStatus === "open") {
        if (item.status === "cancelled" || item.status === "completed") {
          return false;
        }
      } else if (selectedStatus !== "all" && item.status !== selectedStatus) {
        return false;
      }

      // 2. Filtro de Busca Textual
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      const nameMatch = (item.leadName || "").toLowerCase().includes(q);
      const phoneMatch = (item.phone || "").includes(q);
      const campaignMatch = (item.campaignName || "").toLowerCase().includes(q);
      return nameMatch || phoneMatch || campaignMatch;
    });
  }, [items, selectedStatus, searchQuery]);

  const formatDateTime = (dateStr: string | null) => {
    if (!dateStr) return "—";
    try {
      const d = new Date(dateStr);
      if (isNaN(d.getTime())) return dateStr;
      return d.toLocaleString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateStr;
    }
  };

  const handleRetry = async (item: FollowupItem) => {
    try {
      setLoadingActionId(`retry-${item.id}`);
      await retryStep.mutateAsync(item.id);
      toast({
        title: "Passo reenviado para a fila",
        description: `O próximo passo de ${item.leadName || item.phone} foi enfileirado para disparo imediato.`,
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Falha ao reenviar passo",
        description: err?.message || "Ocorreu um erro ao reenviar.",
      });
    } finally {
      setLoadingActionId(null);
    }
  };

  // Cancelar (Interrompe agendamento e mantém o registro como cancelado)
  const handleDiscard = async (item: FollowupItem) => {
    if (!confirm(`Deseja cancelar os disparos futuros de ${item.leadName || item.phone}? O histórico será preservado com status Cancelado.`)) return;
    try {
      setLoadingActionId(`discard-${item.id}`);
      await discardFollowup.mutateAsync(item.id);
      toast({
        title: "Agendamento cancelado",
        description: "Os disparos pendentes foram interrompidos.",
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Falha ao cancelar agendamento",
        description: err?.message || "Ocorreu um erro ao cancelar.",
      });
    } finally {
      setLoadingActionId(null);
    }
  };

  // Cancelar apenas o passo pendente atual (mantém a cadência ativa para os passos futuros)
  const handleCancelStep = async (item: FollowupItem) => {
    if (!item.nextJobId) return;
    if (!confirm(`Deseja cancelar apenas este envio pendente de ${item.leadName || item.phone}? Os próximos passos da cadência continuarão agendados.`)) return;
    try {
      setLoadingActionId(`cancel-step-${item.id}`);
      await cancelJob.mutateAsync(item.nextJobId);
      toast({
        title: "Passo cancelado",
        description: "O envio deste passo foi cancelado. Os próximos passos da cadência seguem ativos.",
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Falha ao cancelar passo",
        description: err?.message || "Ocorreu um erro ao cancelar o passo.",
      });
    } finally {
      setLoadingActionId(null);
    }
  };

  // Excluir Permanentemente (Apenas para 0 mensagens enviadas)
  const handleDelete = async (item: FollowupItem) => {
    if (item.jobsSent > 0) {
      toast({
        variant: "destructive",
        title: "Exclusão não permitida",
        description: "Itens que já enviaram mensagens não podem ser apagados, apenas cancelados.",
      });
      return;
    }

    if (!confirm(`Excluir permanentemente o agendamento de ${item.leadName || item.phone}? Como nenhuma mensagem foi enviada, o registro será completamente removido do banco.`)) return;

    try {
      setLoadingActionId(`delete-${item.id}`);
      await deleteFollowup.mutateAsync(item.id);
      toast({
        title: "Agendamento excluído",
        description: "O registro foi permanentemente removido.",
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Falha ao excluir agendamento",
        description: err?.message || "Ocorreu um erro ao excluir.",
      });
    } finally {
      setLoadingActionId(null);
    }
  };

  const handleConvert = async (item: FollowupItem) => {
    try {
      setLoadingActionId(`convert-${item.id}`);
      await convertToInbound.mutateAsync(item.id);
      toast({
        title: "Convertido para Atendimento",
        description: `${item.leadName || item.phone} foi marcado como respondido/convertido.`,
      });
    } catch (err: any) {
      toast({
        variant: "destructive",
        title: "Falha ao converter",
        description: err?.message || "Ocorreu um erro ao converter.",
      });
    } finally {
      setLoadingActionId(null);
    }
  };

  return (
    <Card className="border-border bg-card shadow-sm text-card-foreground rounded-2xl">
      <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Zap className="h-4 w-4 text-indigo-500" />
            Fila de Acompanhamento
          </CardTitle>
          <CardDescription>
            Acompanhe em tempo real os leads inscritos nas cadências e lembretes avulsos.
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5"
          onClick={() => {
            refetchQueue();
            toast({ title: "Fila atualizada com sucesso" });
          }}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loadingQueue && "animate-spin")} />
          Atualizar
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Barra de Filtros */}
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome, telefone ou cadência..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-8 h-9 text-xs"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
              <SelectTrigger className="h-9 text-xs min-w-[150px]">
                <SelectValue placeholder="Todas as Cadências" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">
                  Todas as Cadências
                </SelectItem>
                {campaigns.map((c) => (
                  <SelectItem key={c.id} value={c.id} className="text-xs">
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger className="h-9 text-xs min-w-[160px]">
                <SelectValue placeholder="Filtrar por Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open" className="text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                  ⚡ Ativos / Em Aberto (Padrão)
                </SelectItem>
                <SelectItem value="all" className="text-xs">
                  Todos (incluindo Cancelados)
                </SelectItem>
                <SelectItem value="active" className="text-xs">
                  Agendado / Ativo
                </SelectItem>
                <SelectItem value="completed" className="text-xs">
                  Concluído
                </SelectItem>
                <SelectItem value="failed" className="text-xs">
                  Falhou
                </SelectItem>
                <SelectItem value="replied" className="text-xs">
                  Respondeu
                </SelectItem>
                <SelectItem value="converted" className="text-xs">
                  Convertido
                </SelectItem>
                <SelectItem value="cancelled" className="text-xs">
                  Cancelado
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Contador Discreto de Itens Ocultos */}
        {selectedStatus === "open" && hiddenCancelledCompletedCount > 0 && (
          <div className="flex items-center justify-between px-3 py-2 rounded-xl bg-muted/40 border border-border/80 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-slate-400" />
              {hiddenCancelledCompletedCount} item(ns) cancelados ou concluídos estão ocultos nesta visualização.
            </span>
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => setSelectedStatus("all")}
              className="h-auto p-0 text-xs text-indigo-500 hover:text-indigo-600 font-semibold"
            >
              Exibir todos ({items.length})
            </Button>
          </div>
        )}

        {/* Conteúdo da Tabela */}
        {loadingQueue ? (
          <div className="py-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
            <RefreshCw className="h-5 w-5 animate-spin text-indigo-500" />
            <span>Carregando fila de acompanhamento...</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="py-10">
            <EmptyState
              title="Nenhum lead na fila com os filtros selecionados"
              description="Ajuste os filtros de status ou cadência para visualizar outros registros."
            />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40">
                  <TableHead className="py-3 px-4 text-xs font-semibold">Lead / Telefone</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-semibold">Cadência</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-semibold text-center">Progresso</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-semibold">Data-Alvo</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-semibold">Próximo Envio</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-semibold text-center">Status</TableHead>
                  <TableHead className="py-3 px-4 text-xs font-semibold text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map((item) => {
                  const statusColor = FOLLOWUP_STATUS_COLORS[item.status] || "bg-slate-100 text-slate-700";
                  const statusLabel = FOLLOWUP_STATUS_LABELS[item.status] || item.status;
                  const isFailed = item.status === "failed" || item.jobsFailed > 0;
                  const canEdit = (item.status === "active" || item.jobsPending > 0) && item.status !== "cancelled" && item.status !== "completed";
                  const canCancel = item.status !== "cancelled" && item.status !== "completed";
                  const canPermanentlyDelete = item.jobsSent === 0;

                  return (
                    <TableRow key={item.id} className="hover:bg-muted/20">
                      {/* Lead / Telefone */}
                      <TableCell className="py-3 px-4">
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold text-foreground">
                            {item.leadName || "Lead sem nome"}
                          </p>
                          <p className="text-[11px] text-muted-foreground font-mono">
                            {item.phone}
                          </p>
                          {item.origin && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 font-normal">
                              {item.origin}
                            </Badge>
                          )}
                        </div>
                      </TableCell>

                      {/* Cadência */}
                      <TableCell className="py-3 px-4">
                        <span className="text-xs font-medium text-foreground">
                          {item.campaignName}
                        </span>
                      </TableCell>

                      {/* Progresso / Passo Atual */}
                      <TableCell className="py-3 px-4 text-center">
                        <div className="flex flex-col items-center justify-center gap-1">
                          <Badge variant="secondary" className="text-[10px] font-semibold px-2 py-0.5">
                            Passo {item.currentStep} de {item.totalSteps || 1}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground">
                            {item.jobsSent} enviado(s)
                          </span>
                        </div>
                      </TableCell>

                      {/* Data-Alvo */}
                      <TableCell className="py-3 px-4">
                        {item.meetingDatetime ? (
                          <div className="flex items-center gap-1 text-xs text-foreground font-medium">
                            <Calendar className="h-3 w-3 text-indigo-500 shrink-0" />
                            <span>{formatDateTime(item.meetingDatetime)}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      {/* Próximo Envio */}
                      <TableCell className="py-3 px-4">
                        {item.nextScheduledFor ? (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400">
                            <Clock className="h-3 w-3 shrink-0" />
                            <span>{formatDateTime(item.nextScheduledFor)}</span>
                          </div>
                        ) : item.lastSentAt ? (
                          <div className="text-[11px] text-muted-foreground">
                            Último: {formatDateTime(item.lastSentAt)}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>

                      {/* Status + Detalhe do Erro */}
                      <TableCell className="py-3 px-4 text-center">
                        <div className="flex flex-col items-center justify-center gap-1">
                          <Badge className={cn("border text-[10px] font-semibold rounded-lg px-2 py-0.5", statusColor)}>
                            {item.status === "active" && (
                              <span className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-pulse mr-1" />
                            )}
                            {statusLabel}
                          </Badge>

                          {isFailed && item.lastErrorLog && (
                            <div
                              className="mt-1 flex items-start gap-1 p-1.5 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-[10px] text-rose-700 dark:text-rose-300 max-w-[240px] text-left leading-tight"
                              title={item.lastErrorLog}
                            >
                              <AlertTriangle className="h-3 w-3 shrink-0 text-rose-600 mt-0.5" />
                              <span className="line-clamp-2">{item.lastErrorLog}</span>
                            </div>
                          )}
                        </div>
                      </TableCell>

                      {/* Ações */}
                      <TableCell className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {/* 1. Botão Editar (SOMENTE para linhas com envio pendente/agendado) */}
                          {canEdit && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px] text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 gap-1 font-medium"
                              onClick={() => setEditingItem(item)}
                              title="Editar horário de envio ou mensagem"
                            >
                              <Pencil className="h-3 w-3" />
                              Editar
                            </Button>
                          )}

                          {/* 2. Reenviar passo que falhou */}
                          {isFailed && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px] text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-800 dark:hover:bg-rose-950/40 gap-1"
                              disabled={loadingActionId === `retry-${item.id}`}
                              onClick={() => handleRetry(item)}
                              title="Tentar reenviar este passo agora"
                            >
                              <RotateCcw className={cn("h-3 w-3", loadingActionId === `retry-${item.id}` && "animate-spin")} />
                              Reenviar
                            </Button>
                          )}

                          {/* 3. Converter para atendimento humano */}
                          {item.status !== "converted" && item.status !== "cancelled" && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-slate-500 hover:text-emerald-600"
                              disabled={loadingActionId === `convert-${item.id}`}
                              onClick={() => handleConvert(item)}
                              title="Marcar como Convertido / Atendido"
                            >
                              <UserCheck className="h-3.5 w-3.5" />
                            </Button>
                          )}

                          {/* 4. Cancelar apenas este passo (a cadência segue ativa) */}
                          {item.nextJobId && item.totalSteps > 1 && item.jobsPending > 0 && canCancel && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-amber-600 hover:text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                              disabled={loadingActionId === `cancel-step-${item.id}`}
                              onClick={() => handleCancelStep(item)}
                              title="Cancelar apenas este envio (a cadência do lead continuará ativa para os próximos passos)"
                            >
                              <XCircle className="h-3.5 w-3.5" />
                            </Button>
                          )}

                          {/* 5. Cancelar Toda a Cadência (Interromper disparos futuros) */}
                          {canCancel && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-amber-500 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                              disabled={loadingActionId === `discard-${item.id}`}
                              onClick={() => handleDiscard(item)}
                              title="Cancelar agendamento (interrompe disparos futuros e mantém registro como cancelado)"
                            >
                              <Ban className="h-3.5 w-3.5" />
                            </Button>
                          )}

                          {/* 5. Excluir Permanentemente (SOMENTE para nunca enviados: jobsSent === 0) */}
                          {canPermanentlyDelete && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                              disabled={loadingActionId === `delete-${item.id}`}
                              onClick={() => handleDelete(item)}
                              title="Excluir permanentemente (como nenhuma mensagem foi enviada, apaga do banco)"
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

      {/* Modal de Edição de Agendamento */}
      <EditFollowupScheduleModal
        open={Boolean(editingItem)}
        onOpenChange={(open) => {
          if (!open) setEditingItem(null);
        }}
        item={editingItem}
      />
    </Card>
  );
}
