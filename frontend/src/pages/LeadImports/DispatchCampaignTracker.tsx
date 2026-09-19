// frontend/src/pages/LeadImports/DispatchCampaignTracker.tsx
//
// "Uma linha por campanha, lote vira quadrado" — Acompanhar Disparos. Cada
// campanha é UMA linha (não um lote): progresso somado, faixa de quadrados
// (um por lote, clicável), e as ações (Pausar/Retomar/Cancelar o que falta)
// operam em todos os lotes pendentes da campanha numa chamada só. A lixeira
// por lote saiu daqui — mora dentro do lote aberto (DispatchRecipientsDialog).

import { useState } from "react";
import {
  Loader2,
  Pause,
  Play,
  X,
  Clock,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { formatDateTime } from "@/lib/leadImports/spreadsheet";
import {
  useDispatchSummary,
  useCampaignDispatchBulkAction,
  DISPATCH_AGGREGATE_STATUS_COLORS,
  DISPATCH_SQUARE_STATE_BY_STATUS,
  DISPATCH_SQUARE_STATE_LABELS,
  DISPATCH_SQUARE_STYLES,
  type DispatchSummaryCampaign,
} from "@/hooks/useCampanhas";
import { DispatchKpiCardsView } from "./DispatchKpiCards";

const PAGE_SIZE_ENDED = 20;

interface DispatchCampaignTrackerProps {
  clientId: string | null;
  onOpenDispatch: (dispatchId: string) => void;
}

export function DispatchCampaignTracker({ clientId, onOpenDispatch }: DispatchCampaignTrackerProps) {
  const [tab, setTab] = useState<"active" | "ended">("active");
  const [endedPage, setEndedPage] = useState(1);

  const activeQuery = useDispatchSummary(clientId, "active", 1, 100);
  const endedQuery = useDispatchSummary(clientId, "ended", endedPage, PAGE_SIZE_ENDED);
  const current = tab === "active" ? activeQuery : endedQuery;

  const counts = current.data?.counts ?? activeQuery.data?.counts ?? endedQuery.data?.counts ?? { active: 0, ended: 0 };
  const kpis = current.data?.kpis;

  return (
    <Card className="border-border bg-card shadow-lg text-card-foreground rounded-2xl">
      <CardHeader className="pb-3 space-y-4">
        <div>
          <h3 className="text-base font-bold">Acompanhar Disparos</h3>
          <p className="text-xs text-muted-foreground">Uma linha por campanha — cada lote é um quadrado na faixa.</p>
        </div>

        {/* Cartões do topo — somam Ativas + Encerradas, período explícito */}
        {kpis && <DispatchKpiCardsView kpis={kpis} />}

        {/* Abas Ativas / Encerradas, com contagem em cada uma */}
        <div className="flex items-center gap-2 border-b border-border">
          <button
            type="button"
            onClick={() => setTab("active")}
            className={cn(
              "px-3 py-2 text-xs font-bold border-b-2 -mb-px transition-colors",
              tab === "active" ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Ativas ({counts.active})
          </button>
          <button
            type="button"
            onClick={() => setTab("ended")}
            className={cn(
              "px-3 py-2 text-xs font-bold border-b-2 -mb-px transition-colors",
              tab === "ended" ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Encerradas ({counts.ended})
          </button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {current.isLoading ? (
          <div className="p-6 text-center text-xs text-muted-foreground animate-pulse">Carregando campanhas...</div>
        ) : (current.data?.campaigns.length ?? 0) === 0 ? (
          <div className="p-8">
            <EmptyState
              title={tab === "active" ? "Nenhuma campanha ativa" : "Nenhuma campanha encerrada"}
              description={
                tab === "active"
                  ? "Campanhas agendadas, enviando ou pausadas aparecem aqui."
                  : "Campanhas concluídas ou canceladas aparecem aqui."
              }
            />
          </div>
        ) : (
          <>
            {current.data!.campaigns.map((c) => (
              <CampaignRow key={c.campaignId} campaign={c} onOpenDispatch={onOpenDispatch} />
            ))}

            {tab === "ended" && (current.data?.totalForScope ?? 0) > PAGE_SIZE_ENDED && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-muted-foreground">
                  Página {endedPage} de {Math.ceil((current.data?.totalForScope ?? 0) / PAGE_SIZE_ENDED)}
                </span>
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 p-0"
                    disabled={endedPage <= 1}
                    onClick={() => setEndedPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 w-7 p-0"
                    disabled={endedPage >= Math.ceil((current.data?.totalForScope ?? 0) / PAGE_SIZE_ENDED)}
                    onClick={() => setEndedPage((p) => p + 1)}
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CampaignRow({
  campaign,
  onOpenDispatch,
}: {
  campaign: DispatchSummaryCampaign;
  onOpenDispatch: (dispatchId: string) => void;
}) {
  const bulkAction = useCampaignDispatchBulkAction();
  const total = campaign.leadsTotal || 1;
  const sentPct = Math.round((campaign.sentTotal / total) * 100);
  const failedPct = Math.round((campaign.failedTotal / total) * 100);

  const handleBulkAction = (action: "pause" | "resume" | "cancel", scheduledAt?: string) => {
    bulkAction.mutate(
      { campaignId: campaign.campaignId, action, scheduledAt },
      {
        onSuccess: (res) => {
          if (res.resumedAt) {
            toast({
              title: `${res.affectedLeads} ${res.affectedLeads === 1 ? "lead" : "leads"} reagendados`,
              description: `${res.affectedDispatches} ${res.affectedDispatches === 1 ? "lote" : "lotes"} — retomam ${formatDateTime(res.resumedAt)}.`,
            });
            return;
          }
          const verbo = action === "pause" ? "pausados" : action === "resume" ? "retomados" : "cancelados";
          toast({
            title: `${res.affectedLeads} ${res.affectedLeads === 1 ? "lead" : "leads"} ${verbo}`,
            description: `${res.affectedDispatches} ${res.affectedDispatches === 1 ? "lote afetado" : "lotes afetados"}.`,
          });
        },
        onError: (err: any) => toast({ title: "Erro ao executar ação", description: err.message, variant: "destructive" }),
      }
    );
  };

  return (
    <div className="rounded-xl border border-border bg-muted/10 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-foreground">{campaign.campaignName}</p>
            <Badge variant="outline" className={cn("text-[10px] font-bold", DISPATCH_AGGREGATE_STATUS_COLORS[campaign.status])}>
              {campaign.statusLabel}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {campaign.chipName || "Sem chip"} · {campaign.leadsTotal} leads · {campaign.loteCount} {campaign.loteCount === 1 ? "lote" : "lotes"}
          </p>
        </div>

        <div className="flex items-center gap-1.5">
          {campaign.leadsActionable.pause > 0 && (
            <BulkActionButton
              action="pause"
              icon={<Pause className="h-3.5 w-3.5 mr-1" />}
              label="Pausar"
              leadsCount={campaign.leadsActionable.pause}
              campaignName={campaign.campaignName}
              pending={bulkAction.isPending}
              onConfirm={() => handleBulkAction("pause")}
              className="border-amber-200 text-amber-600 hover:bg-amber-50 dark:border-amber-900/40 dark:text-amber-400"
            />
          )}
          {campaign.leadsActionable.resume > 0 && (
            <ResumeActionButton
              leadsCount={campaign.leadsActionable.resume}
              campaignName={campaign.campaignName}
              pending={bulkAction.isPending}
              onConfirm={(scheduledAt) => handleBulkAction("resume", scheduledAt)}
              className="bg-indigo-600 hover:bg-indigo-700 text-white border-transparent"
            />
          )}
          {campaign.leadsActionable.cancel > 0 && (
            <BulkActionButton
              action="cancel"
              icon={<X className="h-3.5 w-3.5 mr-1" />}
              label="Cancelar o que falta"
              leadsCount={campaign.leadsActionable.cancel}
              campaignName={campaign.campaignName}
              pending={bulkAction.isPending}
              onConfirm={() => handleBulkAction("cancel")}
              className="border-rose-200 text-rose-600 hover:bg-rose-50 dark:border-rose-900/40 dark:text-rose-400"
              destructive
            />
          )}
        </div>
      </div>

      {/* Barra de progresso: enviado, falhou, restante */}
      <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden flex">
        <div className="h-full bg-emerald-500" style={{ width: `${sentPct}%` }} />
        <div className="h-full bg-rose-500" style={{ width: `${failedPct}%` }} />
      </div>

      {/* Os quatro números */}
      <div className="grid grid-cols-4 gap-2 text-center">
        <NumberStat label="Enviados" value={campaign.sentTotal} className="text-emerald-600" />
        <NumberStat label="Responderam" value={campaign.repliedCount} className="text-indigo-600" />
        <NumberStat label="Falharam" value={campaign.failedTotal} className="text-rose-500" />
        <NumberStat label="Na fila" value={campaign.leadsPending} className="text-slate-500" />
      </div>

      {/* Próximo envio */}
      {campaign.eta && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Clock className="h-3 w-3" />
          Termina {campaign.eta.label}
        </p>
      )}

      {/* Faixa de quadrados — um por lote, numerado, rola dentro do próprio
          contêiner. O número é o que deixa dizer "abre o lote 4" em vez de
          "o quarto contando da esquerda". */}
      {campaign.batches.length > 0 && (
        <div>
          <p className="text-[11px] text-muted-foreground mb-1.5">
            {campaign.batches.length} {campaign.batches.length === 1 ? "lote" : "lotes"} — clique em um para ver os leads dele
          </p>
          <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto overflow-x-hidden pr-1">
            {campaign.batches.map((b, i) => {
              const state = DISPATCH_SQUARE_STATE_BY_STATUS[b.status];
              return (
                <button
                  key={b.id}
                  type="button"
                  onClick={() => onOpenDispatch(b.id)}
                  title={`Lote ${i + 1} — ${DISPATCH_SQUARE_STATE_LABELS[state]} · ${b.sentCount} enviados, ${b.failedCount} falhas, ${b.targetCount} alvo${b.scheduledAt ? ` — agendado ${formatDateTime(b.scheduledAt)}` : ""}`}
                  className={cn(
                    // Raio EXPLÍCITO — rounded-md/sm/lg derivam de --radius
                    // (18px no tema), que num quadrado de 28px vira círculo.
                    // Não trocar por classe do tema.
                    "h-7 w-7 shrink-0 rounded-[4px] flex items-center justify-center text-[10px] font-bold leading-none hover:ring-2 hover:ring-indigo-400 hover:scale-105 transition-all",
                    DISPATCH_SQUARE_STYLES[state]
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function NumberStat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div>
      <p className={cn("text-sm font-bold", className)}>{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function BulkActionButton({
  action,
  icon,
  label,
  leadsCount,
  campaignName,
  pending,
  onConfirm,
  className,
  destructive,
}: {
  action: "pause" | "resume" | "cancel";
  icon: React.ReactNode;
  label: string;
  leadsCount: number;
  campaignName: string;
  pending: boolean;
  onConfirm: () => void;
  className?: string;
  destructive?: boolean;
}) {
  const verbo = action === "pause" ? "pausar" : action === "resume" ? "retomar" : "cancelar o que falta de";
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={action === "resume" ? "default" : "outline"} disabled={pending} className={cn("h-8 text-xs font-bold rounded-xl px-2.5", className)}>
          {pending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : icon}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {label} "{campaignName}"?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Isto vai {verbo} <strong className="text-foreground">{leadsCount} {leadsCount === 1 ? "lead" : "leads"}</strong> em todos os lotes pendentes desta campanha, numa ação só.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-8 text-xs">Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn("h-8 text-xs", destructive && "bg-rose-600 hover:bg-rose-700 text-white")}
          >
            {label}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// "Retomar" precisa de uma escolha: agora, ou numa data/hora futura — o caso
// real de "pausei ontem, quero retomar amanhã às 9h". Por isso não usa o
// BulkActionButton genérico (só confirma/cancela): tem um formulário dentro
// da confirmação, e o botão de confirmar não fecha sozinho se a data ainda
// não foi escolhida.
function ResumeActionButton({
  leadsCount,
  campaignName,
  pending,
  onConfirm,
  className,
}: {
  leadsCount: number;
  campaignName: string;
  pending: boolean;
  onConfirm: (scheduledAt?: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"now" | "later">("now");
  const [dateTimeValue, setDateTimeValue] = useState("");

  const handleOpenChange = (next: boolean) => {
    if (next) {
      setMode("now");
      setDateTimeValue("");
    }
    setOpen(next);
  };

  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  const minDateTime = now.toISOString().slice(0, 16);

  const confirmDisabled = mode === "later" && !dateTimeValue;

  const handleConfirm = () => {
    if (mode === "later") {
      if (!dateTimeValue) return;
      onConfirm(new Date(dateTimeValue).toISOString());
    } else {
      onConfirm(undefined);
    }
    setOpen(false);
  };

  const previewLabel = mode === "later" && dateTimeValue ? formatDateTime(new Date(dateTimeValue).toISOString()) : "agora";

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogTrigger asChild>
        <Button size="sm" disabled={pending} className={cn("h-8 text-xs font-bold rounded-xl px-2.5", className)}>
          {pending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Play className="h-3.5 w-3.5 mr-1" />}
          Retomar
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Retomar "{campaignName}"?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3 text-left">
              <p>
                Isto vai retomar{" "}
                <strong className="text-foreground">
                  {leadsCount} {leadsCount === 1 ? "lead" : "leads"}
                </strong>{" "}
                em todos os lotes pendentes desta campanha.
              </p>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <input type="radio" name="resume-mode" className="accent-indigo-600" checked={mode === "now"} onChange={() => setMode("now")} />
                  Retomar agora
                </label>
                <label className="flex items-center gap-2 text-xs text-foreground">
                  <input type="radio" name="resume-mode" className="accent-indigo-600" checked={mode === "later"} onChange={() => setMode("later")} />
                  Retomar em outra data e hora
                </label>
                {mode === "later" && (
                  <input
                    type="datetime-local"
                    value={dateTimeValue}
                    min={minDateTime}
                    onChange={(e) => setDateTimeValue(e.target.value)}
                    className="ml-6 h-9 rounded-lg border border-input bg-background px-2.5 text-xs text-foreground"
                  />
                )}
              </div>

              <p className="text-[11px]">
                Retoma <strong className="text-foreground">{previewLabel}</strong> — respeitando a janela de envio e a cota do chip.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-8 text-xs">Cancelar</AlertDialogCancel>
          <Button className="h-8 text-xs bg-indigo-600 hover:bg-indigo-700 text-white" disabled={confirmDisabled} onClick={handleConfirm}>
            Retomar
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
