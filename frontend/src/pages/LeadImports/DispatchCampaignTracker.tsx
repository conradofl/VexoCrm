// frontend/src/pages/LeadImports/DispatchCampaignTracker.tsx
//
// "Cartões compactos e cor por campanha" — Acompanhar Disparos.
// Cada campanha é um cartão compacto em grade responsiva (3 em tela larga, 2 em média, 1 no celular).
// Faixa lateral esquerda com getStableColor(campaignId).
// Cartão fechado mostra nome, estado, quantos leads e data/agendamento.
// Abrir um cartão fecha o anterior (acordeão único).
// Os quadrados de lote continuam com as cores exatas de estado (verde, vermelho, azul, cinza).

import { useState } from "react";
import {
  Loader2,
  Pause,
  Play,
  X,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
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
import { getStableColor } from "@/lib/stableColor";
import {
  useDispatchSummary,
  useCampaignDispatchBulkAction,
  DISPATCH_AGGREGATE_STATUS_COLORS,
  DISPATCH_SQUARE_STATE_BY_STATUS,
  DISPATCH_SQUARE_STATE_LABELS,
  DISPATCH_SQUARE_STYLES,
  type DispatchSummaryCampaign,
} from "@/hooks/useCampanhas";
import { ListFilterBar } from "@/components/ListFilterBar";
import { useListFilter } from "@/hooks/useListFilter";
import { DISPATCH_QUEUE_FILTER } from "@/lib/leadImportsListFilters";
import { useViewMode } from "@/hooks/useViewMode";
import { ViewModeToggle } from "@/components/ViewModeToggle";
import { RecordView, type RecordField } from "@/components/records/RecordView";
import { DispatchKpiCardsView } from "./DispatchKpiCards";

// A aba carrega TODAS as campanhas de uma vez (a busca e os filtros rodam no navegador e precisam ver tudo).
// O servidor limita a 5000 por página; só acima disso a paginação volta a aparecer, com aviso no filtro.
const PAGE_SIZE_ENDED = 5000;

const dispatchDateOrEta = (c: DispatchSummaryCampaign) =>
  c.eta ? c.eta.label : c.status === "concluida" ? "Concluído" : "Sem agendamento";

/** Os campos do cartão fechado — e, na lista, as colunas. O cartão e a linha mostram exatamente estes. */
export const DISPATCH_FIELDS: RecordField<DispatchSummaryCampaign>[] = [
  { key: "name", label: "Campanha", render: (c) => c.campaignName },
  { key: "status", label: "Estado", render: (c) => c.statusLabel },
  { key: "chip", label: "Chip", render: (c) => c.chipName || "Sem chip" },
  { key: "leads", label: "Leads", render: (c) => `${c.leadsTotal} leads · ${c.loteCount} ${c.loteCount === 1 ? "lote" : "lotes"}` },
  { key: "date", label: "Próximo envio", render: dispatchDateOrEta },
];
const dispatchField = (key: string) => DISPATCH_FIELDS.find((f) => f.key === key)!;
const EMPTY_CAMPAIGNS: DispatchSummaryCampaign[] = [];

interface DispatchCampaignTrackerProps {
  clientId: string | null;
  onOpenDispatch: (dispatchId: string) => void;
}

export function DispatchCampaignTracker({ clientId, onOpenDispatch }: DispatchCampaignTrackerProps) {
  const [tab, setTab] = useState<"active" | "ended">("active");
  const [endedPage, setEndedPage] = useState(1);
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const view = useViewMode("fila-de-envios");

  const activeQuery = useDispatchSummary(clientId, "active", 1, PAGE_SIZE_ENDED);
  const endedQuery = useDispatchSummary(clientId, "ended", endedPage, PAGE_SIZE_ENDED);
  const current = tab === "active" ? activeQuery : endedQuery;

  const counts = current.data?.counts ?? activeQuery.data?.counts ?? endedQuery.data?.counts ?? { active: 0, ended: 0 };
  const kpis = current.data?.kpis;

  // O filtro age sobre o que a aba carregou — que é tudo, exceto acima do teto do servidor (aviso abaixo).
  const loadedCampaigns = current.data?.campaigns ?? EMPTY_CAMPAIGNS;
  const { filtered: visibleCampaigns, controls: filterControls } = useListFilter(loadedCampaigns, DISPATCH_QUEUE_FILTER);
  const totalInScope = current.data?.totalForScope ?? loadedCampaigns.length;
  const partialNote =
    totalInScope > loadedCampaigns.length
      ? `O filtro vale só para as ${loadedCampaigns.length} carregadas${tab === "ended" ? " nesta página" : ""}; há ${totalInScope} no total.`
      : null;

  return (
    <Card className="border-border bg-card shadow-lg text-card-foreground rounded-2xl">
      <CardHeader className="pb-3 space-y-4">
        <div>
          <h3 className="text-base font-bold">Acompanhar Disparos</h3>
          <p className="text-xs text-muted-foreground">Cartões compactos por campanha — cada lote é um quadrado na faixa.</p>
        </div>

        {/* Cartões do topo — somam Ativas + Encerradas, período explícito */}
        {kpis && <DispatchKpiCardsView kpis={kpis} />}

        {/* Abas Ativas / Encerradas, com contagem em cada uma */}
        <div className="flex items-center gap-2 border-b border-border">
          <button
            type="button"
            onClick={() => {
              setTab("active");
              setExpandedCampaignId(null);
              filterControls.clear();
            }}
            className={cn(
              "px-3 py-2 text-xs font-bold border-b-2 -mb-px transition-colors",
              tab === "active" ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Ativas ({counts.active})
          </button>
          <button
            type="button"
            onClick={() => {
              setTab("ended");
              setExpandedCampaignId(null);
              filterControls.clear();
            }}
            className={cn(
              "px-3 py-2 text-xs font-bold border-b-2 -mb-px transition-colors",
              tab === "ended" ? "border-indigo-600 text-indigo-600 dark:text-indigo-400" : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            Encerradas ({counts.ended})
          </button>
        </div>

        <ListFilterBar
          controls={filterControls}
          searchPlaceholder="Buscar por campanha ou último chip..."
          note={partialNote}
          testId="queue-filter"
          trailing={<ViewModeToggle view={view} />}
        />
      </CardHeader>

      <CardContent className="space-y-4 p-4 sm:p-6 pt-0">
        {current.isLoading ? (
          <div className="p-6 text-center text-xs text-muted-foreground animate-pulse">Carregando campanhas...</div>
        ) : visibleCampaigns.length === 0 ? (
          <div className="p-8">
            <EmptyState
              title={
                filterControls.isFiltered
                  ? "Nenhuma campanha encontrada"
                  : tab === "active"
                  ? "Nenhuma campanha ativa"
                  : "Nenhuma campanha encerrada"
              }
              description={
                filterControls.isFiltered
                  ? "Nenhuma campanha corresponde à busca ou aos filtros. Use \"Limpar filtros\" para ver todas."
                  : tab === "active"
                  ? "Campanhas agendadas, enviando ou pausadas aparecem aqui."
                  : "Campanhas concluídas ou canceladas aparecem aqui."
              }
            />
          </div>
        ) : (
          <>
            {/* Grade responsiva: 3 em tela larga, 2 em média, 1 no celular */}
            <RecordView
              mode={view.mode}
              items={visibleCampaigns}
              getId={(c) => c.campaignId}
              fields={DISPATCH_FIELDS}
              stripeClass={(id) => getStableColor(id).stripe}
              testIdPrefix="dispatch"
              labelOf={(c) => c.campaignName}
              cardsClassName="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              expandedId={expandedCampaignId}
              onExpandedChange={setExpandedCampaignId}
              renderCard={(c, { expanded, toggle }) => (
                <CampaignCard campaign={c} onOpenDispatch={onOpenDispatch} isExpanded={expanded} onToggleExpand={toggle} />
              )}
              renderExpanded={(c) => <CampaignDetails campaign={c} onOpenDispatch={onOpenDispatch} />}
            />

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

function CampaignCard({
  campaign,
  onOpenDispatch,
  isExpanded,
  onToggleExpand,
}: {
  campaign: DispatchSummaryCampaign;
  onOpenDispatch: (dispatchId: string) => void;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const color = getStableColor(campaign.campaignId);
  return (
    <div
      data-testid={`dispatch-card-${campaign.campaignId}`}
      className={cn(
        "relative flex flex-col rounded-2xl border border-border/80 bg-card p-4 shadow-sm hover:shadow-md transition-all duration-200",
        // Faixa de cor estável por campanha na lateral esquerda (longe dos quadrados)
        "border-l-[5px]",
        color.borderLeft
      )}
    >
      {/* 
        Cartão fechado mostra exatamente quatro campos:
        1. Nome da campanha (ocupando a linha 1 com ponto de cor e seta à direita)
        2. Estado (badge com as cores existentes de estado)
        3. Quantos leads
        4. Data / Próximo agendamento
      */}
      <div className="flex flex-col gap-2.5">
        {/* Linha 1: ponto de cor, nome ocupando o espaço disponível, e seta encostada à direita */}
        <div
          data-testid={`dispatch-line-1-${campaign.campaignId}`}
          className="flex items-center justify-between gap-2 min-w-0"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <span
              className={cn("h-2.5 w-2.5 rounded-full shrink-0", color.dot)}
              title={`Cor: ${color.name}`}
              aria-hidden="true"
            />
            <p
              data-field="name"
              data-testid={`dispatch-name-${campaign.campaignId}`}
              className="truncate font-display font-semibold text-foreground text-sm min-w-0 flex-1"
              title={campaign.campaignName}
            >
              {dispatchField("name").render(campaign)}
            </p>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-slate-100 dark:hover:bg-white/5 shrink-0 ml-auto"
            onClick={onToggleExpand}
            aria-expanded={isExpanded}
            aria-label={
              isExpanded
                ? `Recolher detalhes de ${campaign.campaignName}`
                : `Ver detalhes de ${campaign.campaignName}`
            }
            title={isExpanded ? "Recolher detalhes" : "Ver detalhes"}
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                isExpanded && "rotate-180 text-foreground"
              )}
            />
          </Button>
        </div>

        {/* Linha 2: selo de estado e chip utilizado */}
        <div
          data-testid={`dispatch-line-2-${campaign.campaignId}`}
          className="flex items-center gap-1.5 flex-wrap min-w-0"
        >
          <Badge
            data-field="status"
            data-testid={`dispatch-status-${campaign.campaignId}`}
            variant="outline"
            className={cn("text-[10px] font-bold uppercase", DISPATCH_AGGREGATE_STATUS_COLORS[campaign.status])}
          >
            {dispatchField("status").render(campaign)}
          </Badge>
          <span data-field="chip" className="text-xs text-muted-foreground truncate">
            {dispatchField("chip").render(campaign)}
          </span>
        </div>

        {/* Linha 3: quantos leads à esquerda e data/eta à direita */}
        <div
          data-testid={`dispatch-line-3-${campaign.campaignId}`}
          className="flex items-center justify-between gap-2 text-xs pt-1 border-t border-border/40 min-w-0"
        >
          <span
            data-field="leads"
            data-testid={`dispatch-leads-${campaign.campaignId}`}
            className="font-semibold text-foreground truncate"
          >
            {dispatchField("leads").render(campaign)}
          </span>
          <span
            data-field="date"
            data-testid={`dispatch-date-${campaign.campaignId}`}
            className="text-[11px] text-muted-foreground shrink-0 truncate max-w-[140px]"
            title={dispatchDateOrEta(campaign)}
          >
            {dispatchField("date").render(campaign)}
          </span>
        </div>
      </div>

      {/* 
        Parte que abre: tudo o que existia continua existindo aqui dentro.
      */}
      {isExpanded && (
        <div
          data-testid={`dispatch-details-${campaign.campaignId}`}
          className="mt-3.5 pt-3.5 border-t border-border/80 space-y-3 animate-in fade-in duration-150"
        >
          <CampaignDetails campaign={campaign} onOpenDispatch={onOpenDispatch} />
        </div>
      )}
    </div>
  );
}

/** O que abre: ações em massa, progresso, números e lotes. É o MESMO conteúdo no cartão aberto e na linha aberta. */
export function CampaignDetails({
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
    <>
      {/* Ações em massa */}
      <div className="flex items-center gap-1.5 flex-wrap">
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

      {/* Barra de progresso: enviado, falhou, restante */}
      <div className="h-2 w-full rounded-full bg-slate-100 dark:bg-white/5 overflow-hidden flex">
        <div className="h-full bg-emerald-500" style={{ width: `${sentPct}%` }} />
        <div className="h-full bg-rose-500" style={{ width: `${failedPct}%` }} />
      </div>

      {/* Os quatro números */}
      <div className="grid grid-cols-4 gap-2 text-center p-2 rounded-xl bg-muted/20 border border-border/40">
        <NumberStat label="Enviados" value={campaign.sentTotal} className="text-emerald-600 dark:text-emerald-400" />
        <NumberStat label="Responderam" value={campaign.repliedCount} className="text-indigo-600 dark:text-indigo-400" />
        <NumberStat label="Falharam" value={campaign.failedTotal} className="text-rose-500" />
        <NumberStat label="Na fila" value={campaign.leadsPending} className="text-slate-500" />
      </div>

      {/* Próximo envio com ícone de relógio */}
      {campaign.eta && (
        <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
          <Clock className="h-3 w-3 shrink-0" />
          <span>Próximo lote: {campaign.eta.label}</span>
        </p>
      )}

      {/* 
        Faixa de quadrados numerados por lote — as cores dos quadrados
        continuam exatamente as mesmas (verde, vermelho, azul, cinza) 
      */}
      {campaign.batches.length > 0 && (
        <div className="pt-1">
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

    </>
  );
}

function NumberStat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div>
      <p className={cn("text-sm font-bold font-num", className)}>{value}</p>
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
