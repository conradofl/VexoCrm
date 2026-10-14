import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CheckSquare,
  Download,
  Filter,
  Pause,
  Play,
  RefreshCw,
  Square,
  Trash2,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { formatDateTime } from "@/lib/leadImports/spreadsheet";
import {
  CAMPAIGN_STATUS_COLORS,
  CAMPAIGN_STATUS_LABELS,
  type CampaignDispatch,
} from "@/hooks/useCampanhas";

interface DispatchQueueTableProps {
  dispatches: CampaignDispatch[];
  loadingDispatches: boolean;
  refetchDispatches: () => void;
  onTriggerDispatchBatch: (dispId: string) => void;
  onPauseDispatchBatch: (dispId: string) => void;
  onDownloadFailedCsv: (disp: CampaignDispatch) => void;
  onDeleteDispatchBatch: (dispId: string) => void;
  onDeleteMultipleDispatches?: (dispIds: string[]) => void;
  onPreviewDispatch: (dispId: string) => void;
  /** Abre o roteiro do agente DAQUELE disparo (copia isolada, editavel). */
  onEditDispatchPrompt: (dispId: string) => void;
}

export function DispatchQueueTable({
  dispatches,
  loadingDispatches,
  refetchDispatches,
  onTriggerDispatchBatch,
  onPauseDispatchBatch,
  onDownloadFailedCsv,
  onDeleteDispatchBatch,
  onDeleteMultipleDispatches,
  onPreviewDispatch,
  onEditDispatchPrompt,
}: DispatchQueueTableProps) {
  const [selectedCampaignFilter, setSelectedCampaignFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const runningDispatches = dispatches.filter((d) => d.status === "running");

  // Agrupamento de campanhas para filtro
  const campaignOptions = useMemo(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const d of dispatches) {
      const cId = d.campaign_id || "sem-campanha";
      const cName = (d as any).campaign_name || "Sem Campanha";
      if (!map.has(cId)) {
        map.set(cId, { id: cId, name: cName, count: 0 });
      }
      map.get(cId)!.count += 1;
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [dispatches]);

  // Disparos filtrados pela campanha selecionada
  const filteredDispatches = useMemo(() => {
    if (selectedCampaignFilter === "all") return dispatches;
    return dispatches.filter(
      (d) => (d.campaign_id || "sem-campanha") === selectedCampaignFilter
    );
  }, [dispatches, selectedCampaignFilter]);

  // Lotes selecionáveis (TRAVA: lotes running NÃO podem ser selecionados/excluídos)
  const selectableVisibleDispatches = useMemo(() => {
    return filteredDispatches.filter((d) => d.status !== "running");
  }, [filteredDispatches]);

  const allVisibleSelected =
    selectableVisibleDispatches.length > 0 &&
    selectableVisibleDispatches.every((d) => selectedIds.has(d.id));

  const someVisibleSelected =
    selectableVisibleDispatches.some((d) => selectedIds.has(d.id)) && !allVisibleSelected;

  const handleToggleSelectAll = () => {
    if (allVisibleSelected) {
      // Desmarca todos os visíveis
      const next = new Set(selectedIds);
      for (const d of selectableVisibleDispatches) {
        next.delete(d.id);
      }
      setSelectedIds(next);
    } else {
      // Marca todos os visíveis não-running
      const next = new Set(selectedIds);
      for (const d of selectableVisibleDispatches) {
        next.add(d.id);
      }
      setSelectedIds(next);
    }
  };

  const handleToggleSelectOne = (id: string, status: string) => {
    if (status === "running") {
      toast({
        title: "Lote em execução",
        description: "Lotes em andamento não podem ser excluídos. Pause o lote antes.",
        variant: "destructive",
      });
      return;
    }
    const next = new Set(selectedIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedIds(next);
  };

  // Exclusão em lote com confirmação rica
  const handleExecuteBatchDelete = (idsToDelete: string[]) => {
    if (idsToDelete.length === 0) return;

    const batches = dispatches.filter((d) => idsToDelete.includes(d.id));

    // TRAVA RIGOROSA: Nenhum lote em running pode ser excluído
    const runningBatch = batches.find((d) => d.status === "running");
    if (runningBatch) {
      toast({
        title: "Operação Bloqueada",
        description: `O lote "${runningBatch.name}" está em execução. Pause-o antes de excluir.`,
        variant: "destructive",
      });
      return;
    }

    const totalDestinatarios = batches.reduce((acc, d) => acc + (d.target_count ?? 0), 0);
    const totalEnviados = batches.reduce((acc, d) => acc + (d.sent_count ?? 0), 0);

    const enviadosAviso =
      totalEnviados > 0
        ? `\n\nℹ️ ${totalEnviados} destinatários já receberam mensagem deste(s) lote(s). O histórico de envio real permanecerá 100% preservado no Inbox.`
        : "";

    const confirmMsg = `Excluir permanentemente ${batches.length} ${
      batches.length === 1 ? "lote" : "lotes"
    } (${totalDestinatarios} destinatários)?${enviadosAviso}\n\nEsta ação removerá a fila de agendamento e não pode ser desfeita.`;

    if (!window.confirm(confirmMsg)) return;

    if (onDeleteMultipleDispatches) {
      onDeleteMultipleDispatches(idsToDelete);
    } else {
      // Fallback para exclusão sequencial
      for (const id of idsToDelete) {
        onDeleteDispatchBatch(id);
      }
    }

    // Limpa seleção
    const next = new Set(selectedIds);
    for (const id of idsToDelete) {
      next.delete(id);
    }
    setSelectedIds(next);
  };

  // Atalho: Excluir todos os lotes da campanha selecionada
  const handleDeleteAllCampaignBatches = () => {
    if (selectedCampaignFilter === "all") return;
    const campaignBatches = dispatches.filter(
      (d) => (d.campaign_id || "sem-campanha") === selectedCampaignFilter
    );

    const running = campaignBatches.find((d) => d.status === "running");
    if (running) {
      toast({
        title: "Campanha com lote em execução",
        description: `O lote "${running.name}" está rodando no momento. Pause antes de excluir a fila.`,
        variant: "destructive",
      });
      return;
    }

    const ids = campaignBatches.map((d) => d.id);
    handleExecuteBatchDelete(ids);
  };

  return (
    <Card className="border-border bg-card shadow-lg text-card-foreground rounded-2xl">
      <CardHeader className="pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <CardTitle className="text-base font-bold">Fila de Disparos em Massa</CardTitle>
          <CardDescription>
            Acompanhe e gerencie lotes de disparos criados por planilha diretamente
          </CardDescription>
          <p className="mt-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
            Cada disparo guarda os passos de quando foi criado — texto, imagem, gatilho
            e <strong>botões</strong>. Editar a campanha não altera disparo já enfileirado.
            Botão adicionado depois só sai em um disparo novo: exclua e crie de novo, ou
            crie outro lote.
          </p>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
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
        </div>
      </CardHeader>

      {/* ⚠️ AVISO DE DISPARO EM ANDAMENTO */}
      {runningDispatches.length > 0 && (
        <div className="mx-6 mb-3 p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/10 dark:bg-amber-950/30 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500"></span>
            </span>
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
              <strong>Disparo em andamento:</strong>{" "}
              {runningDispatches
                .map((d) => `${d.name} (${d.sent_count ?? 0} de ${d.target_count ?? "—"} enviados)`)
                .join(", ")}.
              <span className="ml-1 font-normal text-amber-700 dark:text-amber-400">
                Evite reiniciar o servidor agora para não interromper a fila.
              </span>
            </p>
          </div>
          <Badge
            variant="outline"
            className="border-amber-500/40 bg-amber-500/20 text-amber-700 dark:text-amber-300 text-[10px] font-bold shrink-0"
          >
            Disparando
          </Badge>
        </div>
      )}

      {/* 🛠️ BARRA DE FILTRO POR CAMPANHA & AÇÕES EM LOTE */}
      <div className="px-6 py-2.5 bg-muted/20 border-y border-border flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            <Filter className="h-3.5 w-3.5" />
            <span>Filtrar por Campanha:</span>
          </div>
          <Select
            value={selectedCampaignFilter}
            onValueChange={(val) => {
              setSelectedCampaignFilter(val);
              setSelectedIds(new Set()); // Limpa seleções ao trocar filtro
            }}
          >
            <SelectTrigger className="h-8 text-xs w-[240px] rounded-xl bg-card border-border">
              <SelectValue placeholder="Todas as campanhas" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as campanhas ({dispatches.length})</SelectItem>
              {campaignOptions.map((opt) => (
                <SelectItem key={opt.id} value={opt.id}>
                  {opt.name} ({opt.count} {opt.count === 1 ? "lote" : "lotes"})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedCampaignFilter !== "all" && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteAllCampaignBatches}
              className="h-8 text-xs font-semibold text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/40 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-xl"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Excluir todos os lotes desta campanha ({filteredDispatches.length})
            </Button>
          )}
        </div>

        {/* Ações para itens selecionados via Checkbox */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2 animate-fadeIn bg-indigo-500/10 dark:bg-indigo-950/30 border border-indigo-500/30 rounded-xl px-3 py-1.5">
            <span className="text-xs font-bold text-indigo-700 dark:text-indigo-300">
              {selectedIds.size} {selectedIds.size === 1 ? "lote selecionado" : "lotes selecionados"}
            </span>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => handleExecuteBatchDelete(Array.from(selectedIds))}
              className="h-7 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg px-2.5"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Excluir selecionados ({selectedIds.size})
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
              className="h-7 text-xs text-muted-foreground hover:text-foreground rounded-lg px-2"
            >
              Limpar seleção
            </Button>
          </div>
        )}
      </div>

      <CardContent className="p-0">
        {loadingDispatches ? (
          <div className="p-6 text-center text-xs text-muted-foreground animate-pulse">
            Carregando lotes de disparo...
          </div>
        ) : filteredDispatches.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title={
                selectedCampaignFilter !== "all"
                  ? "Nenhum lote para a campanha selecionada"
                  : "Nenhum lote de disparo"
              }
              description="Crie um disparo para enfileirar as execuções de envio em massa."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-200/60 dark:border-white/5">
                  <TableHead className="w-[44px] px-3 py-4 text-center">
                    <Checkbox
                      checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                      onCheckedChange={handleToggleSelectAll}
                      aria-label="Selecionar todos os lotes visíveis"
                      title="Selecionar todos os lotes visíveis (lotes em execução são ignorados)"
                    />
                  </TableHead>
                  <TableHead className="px-4 py-4 text-xs font-semibold uppercase font-display">
                    Lote / Origem
                  </TableHead>
                  <TableHead className="px-4 py-4 text-xs font-semibold uppercase font-display text-center">
                    Status
                  </TableHead>
                  <TableHead
                    className="px-4 py-4 text-xs font-semibold uppercase font-display text-center cursor-help"
                    title="Soma estritamente as mensagens enviadas por este lote. O total diário do chip na aba de Chips soma todos os envios do dia (campanhas, follow-ups e atendimentos)."
                  >
                    Progresso do Lote ℹ️
                  </TableHead>
                  <TableHead className="px-4 py-4 text-xs font-semibold uppercase font-display">
                    Criado / Agendado
                  </TableHead>
                  <TableHead className="px-6 py-4 text-xs font-semibold uppercase font-display text-right">
                    Ações
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredDispatches.map((disp) => {
                  const total = (disp.sent_count ?? 0) + (disp.failed_count ?? 0);
                  const isRunning = disp.status === "running";
                  const isSelected = selectedIds.has(disp.id);

                  return (
                    <TableRow
                      key={disp.id}
                      className={cn(
                        "border-border hover:bg-muted/10 transition-colors",
                        isSelected && "bg-indigo-500/5 dark:bg-indigo-950/20"
                      )}
                    >
                      <TableCell className="px-3 py-4 text-center">
                        <Checkbox
                          checked={isSelected}
                          disabled={isRunning}
                          onCheckedChange={() => handleToggleSelectOne(disp.id, disp.status)}
                          aria-label={`Selecionar ${disp.name}`}
                          title={
                            isRunning
                              ? "Lote em execução não pode ser excluído"
                              : "Selecionar lote para exclusão"
                          }
                        />
                      </TableCell>
                      <TableCell className="px-4 py-4">
                        <p
                          className="text-sm font-bold text-foreground hover:text-indigo-600 dark:hover:text-indigo-400 cursor-pointer hover:underline transition-colors"
                          onClick={() => onPreviewDispatch(disp.id)}
                          title="Clique para ver os destinatários e status de cada lead"
                        >
                          {disp.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Campanha: {(disp as any).campaign_name || "Planilha"}
                        </p>
                      </TableCell>
                      <TableCell className="px-4 py-4 text-center">
                        <Badge
                          className={cn(
                            "border text-[10px] font-semibold rounded-xl px-2 py-0.5",
                            CAMPAIGN_STATUS_COLORS[disp.status] || ""
                          )}
                        >
                          {CAMPAIGN_STATUS_LABELS[disp.status] || disp.status}
                        </Badge>
                        {(disp.status === "failed" ||
                          disp.status === "interrupted" ||
                          disp.status === "paused" ||
                          disp.status === "scheduled" ||
                          (disp.error_message && disp.error_message.includes("Chip configurado não encontrado"))) &&
                          disp.error_message && (
                            <p
                              className={cn(
                                "mt-1 text-[10px] font-medium max-w-[240px] mx-auto leading-tight",
                                disp.error_message.includes("Chip configurado não encontrado") ||
                                  disp.status === "interrupted" ||
                                  disp.status === "paused" ||
                                  disp.status === "scheduled"
                                  ? "text-amber-600 dark:text-amber-400"
                                  : "text-rose-500"
                              )}
                              title={disp.error_message}
                            >
                              {disp.error_message}
                            </p>
                          )}
                      </TableCell>
                      <TableCell className="px-4 py-4">
                        <div
                          className="flex flex-col items-center justify-center gap-1 w-28 mx-auto cursor-pointer group"
                          onClick={() => onPreviewDispatch(disp.id)}
                          title="Clique para abrir lista detalhada de destinatários"
                        >
                          <div className="flex items-center justify-between text-[10px] font-bold w-full">
                            <span className="text-emerald-500">{disp.sent_count} ✓</span>
                            <span className="text-rose-500">{disp.failed_count} ✗</span>
                            {disp.target_count != null && (
                              <span
                                className="text-blue-500 ml-1 group-hover:underline"
                                title="Ver leads alvo desta campanha"
                              >
                                / {disp.target_count} 🎯
                              </span>
                            )}
                          </div>
                          {total > 0 && (
                            <div className="h-1.5 w-full rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden">
                              <div
                                className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                                style={{
                                  width: `${Math.round((disp.sent_count / total) * 100)}%`,
                                }}
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
                          {(disp.status === "draft" ||
                            disp.status === "paused" ||
                            disp.status === "failed" ||
                            disp.status === "interrupted") && (
                            <Button
                              size="sm"
                              variant="default"
                              title={
                                disp.status === "paused" ||
                                disp.status === "failed" ||
                                disp.status === "interrupted"
                                  ? "Continua de onde parou: quem já recebeu não recebe de novo"
                                  : "Iniciar o envio deste lote"
                              }
                              onClick={() => onTriggerDispatchBatch(disp.id)}
                              className="h-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs px-2.5 font-bold shadow-sm"
                            >
                              <Play className="h-3.5 w-3.5 mr-1" />{" "}
                              {disp.status === "paused" || disp.status === "interrupted"
                                ? "Retomar"
                                : disp.status === "failed"
                                ? "Disparar"
                                : "Iniciar"}
                            </Button>
                          )}
                          {disp.status === "running" && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => onPauseDispatchBatch(disp.id)}
                              className="h-8 border-amber-200 text-amber-600 hover:bg-amber-50 dark:border-amber-900/40 dark:text-amber-400 rounded-xl text-xs px-2.5 font-bold"
                            >
                              <Pause className="h-3.5 w-3.5 mr-1" /> Pausar
                            </Button>
                          )}
                          {/* Detalhes de Destinatários */}
                          <Button
                            size="sm"
                            variant="outline"
                            title="Ver destinatários e status de cada lead"
                            onClick={() => onPreviewDispatch(disp.id)}
                            className="h-8 w-8 p-0 rounded-xl"
                          >
                            <Users className="h-3.5 w-3.5 text-slate-700 dark:text-white/80" />
                          </Button>
                          {disp.failed_count > 0 && (
                            <Button
                              size="sm"
                              variant="outline"
                              title="Baixar Relatório de Falhas"
                              onClick={() => onDownloadFailedCsv(disp)}
                              className="h-8 w-8 p-0 rounded-xl"
                            >
                              <Download className="h-3.5 w-3.5 text-slate-700 dark:text-white/80" />
                            </Button>
                          )}
                          {/* Roteiro do agente DESTE disparo */}
                          <Button
                            size="sm"
                            variant="outline"
                            title="Roteiro do agente deste disparo"
                            onClick={() => onEditDispatchPrompt(disp.id)}
                            className="h-8 w-8 p-0 rounded-xl"
                          >
                            <Bot className="h-3.5 w-3.5 text-indigo-500" />
                          </Button>
                          {/* Excluir Lote individual: habilitado para todos os status NÃO-running (incluindo scheduled) */}
                          {!isRunning && (
                            <Button
                              size="sm"
                              variant="outline"
                              title="Excluir Lote"
                              onClick={() => onDeleteDispatchBatch(disp.id)}
                              className="h-8 w-8 p-0 text-rose-500 border-rose-200/40 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-xl"
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
  );
}
