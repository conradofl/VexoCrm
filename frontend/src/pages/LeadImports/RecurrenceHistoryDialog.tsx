import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { RECURRENCE_ORIGIN_NOTES, formatAudienceToday } from "@/lib/campaignRecurrence";
import { useCampaignRecurrence, type RecurrenceOccurrence } from "@/hooks/useCampanhas";

const DISPATCH_STATUS_PT: Record<string, string> = {
  scheduled: "aguardando",
  running: "enviando",
  paused: "pausado",
  done: "concluído",
  failed: "falhou",
  cancelled: "cancelado",
  interrupted: "interrompido",
  draft: "rascunho",
};

function OccurrenceRow({ o }: { o: RecurrenceOccurrence }) {
  const skipped = o.outcome === "skipped";
  return (
    <li
      data-testid="recurrence-occurrence"
      data-outcome={o.outcome}
      className={cn(
        "rounded-xl border p-2.5 text-xs space-y-1",
        skipped ? "border-amber-500/40 bg-amber-500/5" : "border-border/60"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold text-foreground">{o.label}</span>
        <Badge variant="outline" className={cn("text-[10px]", skipped && "border-amber-500/50 text-amber-700 dark:text-amber-300")}>
          {skipped ? "Pulado" : DISPATCH_STATUS_PT[o.dispatchStatus || ""] || "Criado"}
        </Badge>
      </div>
      {skipped ? (
        <p className="text-amber-800 dark:text-amber-200">{o.reason}</p>
      ) : (
        <p className="text-muted-foreground">
          {o.audienceCount != null && <>Público do dia: {o.audienceCount.toLocaleString("pt-BR")} leads. </>}
          {o.sentCount != null && <>Enviadas: {o.sentCount.toLocaleString("pt-BR")}. </>}
          {o.failedCount ? <>Falhas: {o.failedCount.toLocaleString("pt-BR")}. </> : null}
          {o.dispatchError && <span className="text-destructive">{o.dispatchError}</span>}
        </p>
      )}
    </li>
  );
}

/** Histórico de uma campanha que repete — envios feitos E pulados, com o motivo e o número real de cada dia. */
export function RecurrenceHistoryDialog({
  campaignId,
  campaignName,
  open,
  onOpenChange,
}: {
  campaignId: string | null;
  campaignName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, isError } = useCampaignRecurrence(open ? campaignId : null);
  const audienceText = formatAudienceToday(data?.audienceToday);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Envios da repetição — {campaignName}</DialogTitle>
          <DialogDescription>{data?.summary || "Campanha que se repete"}</DialogDescription>
        </DialogHeader>

        {isLoading && <p className="text-xs text-muted-foreground">Carregando…</p>}
        {isError && <p className="text-xs text-destructive">Não foi possível carregar o histórico.</p>}

        {data && (
          <div className="space-y-3 text-xs">
            <div className="space-y-1 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3">
              {data.needsResave ? (
                <p data-testid="recurrence-needs-resave" className="font-semibold text-amber-800 dark:text-amber-200">
                  Parada: esta repetição foi criada antes do fim declarado. Edite e salve de novo, escolhendo quando termina.
                </p>
              ) : data.nextRunLabel ? (
                <p data-testid="recurrence-history-next-run" className="font-semibold text-foreground">
                  Próximo envio: {data.nextRunLabel}
                </p>
              ) : data.endedLabel ? (
                <p className="font-semibold text-foreground">Repetição encerrada em {data.endedLabel}.</p>
              ) : null}
              {data.endSummary && <p className="text-muted-foreground">{data.endSummary}</p>}
              {data.monthEndNote && <p className="text-muted-foreground">{data.monthEndNote}</p>}
              <p className="text-foreground">
                {RECURRENCE_ORIGIN_NOTES[data.originKind]}
                {audienceText && <> {audienceText}</>}
              </p>
            </div>

            {data.occurrences.length === 0 ? (
              <p className="text-muted-foreground">Nenhum envio ainda.</p>
            ) : (
              <ul className="space-y-2 max-h-[50vh] overflow-y-auto">
                {data.occurrences.map((o) => (
                  <OccurrenceRow key={o.occurrenceAt} o={o} />
                ))}
              </ul>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
