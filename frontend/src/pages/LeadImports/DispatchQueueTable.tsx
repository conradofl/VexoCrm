import { Download, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
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
}

export function DispatchQueueTable({
  dispatches,
  loadingDispatches,
  refetchDispatches,
  onTriggerDispatchBatch,
  onPauseDispatchBatch,
  onDownloadFailedCsv,
  onDeleteDispatchBatch,
}: DispatchQueueTableProps) {
  return (
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
                              onClick={() => onTriggerDispatchBatch(disp.id)}
                              className="h-8 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs px-2.5 font-bold shadow-sm"
                            >
                              <Play className="h-3.5 w-3.5 mr-1" /> Iniciar
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
                          {(disp.status === "draft" || disp.status === "failed" || disp.status === "done") && (
                            <Button
                              size="sm"
                              variant="outline"
                              title="Excluir Lote"
                              onClick={() => onDeleteDispatchBatch(disp.id)}
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
  );
}
