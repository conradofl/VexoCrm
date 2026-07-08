import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ConsultantItem } from "@/hooks/useCommercialIntelligence";
import { formatCurrency, formatHours, formatNumber, formatPercent } from "@/lib/commercialIntelligence/helpers";

export function ConsultantDetailDialog({
  consultantDetail,
  onOpenChange,
}: {
  consultantDetail: ConsultantItem | null;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={Boolean(consultantDetail)} onOpenChange={onOpenChange}>
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
  );
}
