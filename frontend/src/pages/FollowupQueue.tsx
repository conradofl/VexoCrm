import { useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Filter,
  ListChecks,
  RefreshCw,
  Trash2,
  UserCheck,
  Phone,
  Megaphone,
  Clock,
  MapPin,
  Building2,
  MessageSquare,
  CalendarDays,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useFupCompanies, useFupCampaigns, useFupTemplates } from "@/hooks/useFollowupAdmin";
import {
  useFollowupQueue,
  useRescheduleFollowup,
  useDiscardFollowup,
  useConvertToInbound,
  type FollowupItem,
  type FollowupStatus,
  type FollowupQueueFilters,
} from "@/hooks/useFollowupQueue";

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<FollowupStatus, string> = {
  active:        "Ativo",
  awaiting_reply:"Aguardando resposta",
  replied:       "Respondeu",
  failed:        "Falhou",
  cancelled:     "Cancelado",
  converted:     "Convertido",
};

const STATUS_COLORS: Record<FollowupStatus, string> = {
  active:        "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  awaiting_reply:"border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  replied:       "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  failed:        "border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400",
  cancelled:     "border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/20 dark:text-slate-500",
  converted:     "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400",
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

// ── RescheduleDialog ───────────────────────────────────────────────────────────

interface RescheduleDialogProps {
  item: FollowupItem;
  onClose: () => void;
}

function RescheduleDialog({ item, onClose }: RescheduleDialogProps) {
  const [delayMinutes, setDelayMinutes] = useState(60);
  const [templateId, setTemplateId] = useState("_auto");
  const reschedule = useRescheduleFollowup();
  const { data: templates = [] } = useFupTemplates(item.campaignId);

  const handleConfirm = async () => {
    try {
      await reschedule.mutateAsync({
        id: item.id,
        delayMinutes,
        templateId: templateId !== "_auto" ? templateId : undefined,
      });
      toast({ title: "Reagendado", description: `Followup de ${item.leadName || item.phone} enfileirado em ${delayMinutes} min.` });
      onClose();
    } catch (e) {
      toast({ title: "Erro ao reagendar", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  };

  return (
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>Reagendar followup</AlertDialogTitle>
        <AlertDialogDescription>
          Lead: <strong>{item.leadName || item.phone}</strong> — Campanha: <strong>{item.campaignName}</strong>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <div className="space-y-3 py-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Delay (minutos)</Label>
          <Input
            type="number"
            min={1}
            value={delayMinutes}
            onChange={(e) => setDelayMinutes(Math.max(1, Number(e.target.value)))}
            className="h-9 text-sm"
          />
        </div>
        {templates.length > 0 && (
          <div className="space-y-1.5">
            <Label className="text-xs">Template (opcional)</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="_auto">Próximo ativo da campanha</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={onClose}>Cancelar</AlertDialogCancel>
        <AlertDialogAction onClick={handleConfirm} disabled={reschedule.isPending}>
          {reschedule.isPending ? "Salvando..." : `Reagendar em ${delayMinutes} min`}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

// ── FollowupRow ────────────────────────────────────────────────────────────────

function FollowupRow({ item }: { item: FollowupItem }) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const discard = useDiscardFollowup();
  const convert = useConvertToInbound();

  const handleDiscard = async () => {
    try {
      await discard.mutateAsync(item.id);
      toast({ title: "Cancelado", description: `Followup de ${item.leadName || item.phone} cancelado.` });
      setDiscardOpen(false);
    } catch (e) {
      toast({ title: "Erro ao cancelar", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  };

  const handleConvert = async () => {
    try {
      await convert.mutateAsync(item.id);
      toast({ title: "Convertido", description: `Lead ${item.leadName || item.phone} convertido para inbound.` });
      setConvertOpen(false);
    } catch (e) {
      toast({ title: "Erro ao converter", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  };

  const isActionable = item.status === "active" || item.status === "awaiting_reply" || item.status === "failed";

  return (
    <>
      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-900/40 sm:flex-row sm:items-start sm:gap-4">
        {/* Lead + meta */}
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
              {item.leadName || "Lead sem nome"}
            </span>
            <Badge className={`shrink-0 border text-[10px] font-medium ${STATUS_COLORS[item.status]}`}>
              {STATUS_LABELS[item.status]}
            </Badge>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1">
              <Phone className="h-3 w-3" />{item.phone}
            </span>
            <span className="flex items-center gap-1">
              <Building2 className="h-3 w-3" />{item.companyName}
            </span>
            <span className="flex items-center gap-1">
              <Megaphone className="h-3 w-3" />{item.campaignName}
            </span>
            {item.origin && (
              <span className="flex items-center gap-1 text-indigo-500 dark:text-indigo-400">
                <MapPin className="h-3 w-3" />{item.origin}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-400 dark:text-slate-500">
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {item.jobsSent} enviada{item.jobsSent !== 1 ? "s" : ""}
              {item.jobsFailed > 0 && <span className="text-red-400"> · {item.jobsFailed} falhou</span>}
              {item.jobsPending > 0 && <span className="text-amber-400"> · {item.jobsPending} pendente{item.jobsPending !== 1 ? "s" : ""}</span>}
            </span>
            {item.lastSentAt && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />Último: {formatDate(item.lastSentAt)}
              </span>
            )}
            {item.meetingDatetime && (
              <span className="flex items-center gap-1 text-violet-400">
                <CalendarDays className="h-3 w-3" />Reunião: {formatDate(item.meetingDatetime)}
              </span>
            )}
          </div>
        </div>

        {/* Ações */}
        {isActionable && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline" size="sm" className="h-7 gap-1 text-xs"
              onClick={() => setRescheduleOpen(true)}
              disabled={discard.isPending || convert.isPending}
              title="Reagendar"
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Reagendar
            </Button>
            <Button
              variant="outline" size="sm"
              className="h-7 gap-1 text-xs text-indigo-600 border-indigo-200 hover:bg-indigo-50 dark:text-indigo-400 dark:border-indigo-800 dark:hover:bg-indigo-900/20"
              onClick={() => setConvertOpen(true)}
              disabled={discard.isPending || convert.isPending}
              title="Converter para inbound"
            >
              <UserCheck className="h-3.5 w-3.5" />
              Inbound
            </Button>
            <Button
              variant="ghost" size="sm"
              className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 dark:hover:text-red-400"
              onClick={() => setDiscardOpen(true)}
              disabled={discard.isPending || convert.isPending}
              title="Cancelar"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Dialogs */}
      <AlertDialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <RescheduleDialog item={item} onClose={() => setRescheduleOpen(false)} />
      </AlertDialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancelar followup?</AlertDialogTitle>
            <AlertDialogDescription>
              O lead <strong>{item.leadName || item.phone}</strong> terá seus jobs pendentes cancelados e sairá da fila ativa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction className="bg-red-500 hover:bg-red-600" onClick={handleDiscard} disabled={discard.isPending}>
              {discard.isPending ? "Cancelando..." : "Cancelar followup"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={convertOpen} onOpenChange={setConvertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Converter para inbound?</AlertDialogTitle>
            <AlertDialogDescription>
              O lead <strong>{item.leadName || item.phone}</strong> será marcado como convertido e o webhook da empresa será acionado (se configurado).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction onClick={handleConvert} disabled={convert.isPending}>
              {convert.isPending ? "Convertendo..." : "Confirmar conversão"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function FollowupQueue() {
  const { canAccessInternalPage } = useAuth();
  const { data: companies = [], isLoading: loadingCompanies } = useFupCompanies();

  const [companyId, setCompanyId] = useState("all");
  const [campaignId, setCampaignId] = useState("_all");
  const [status, setStatus] = useState<FollowupStatus | "_all">("_all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: campaigns = [] } = useFupCampaigns(companyId !== "all" ? companyId : undefined);

  const filters: FollowupQueueFilters = {
    companyId: companyId !== "all" ? companyId : undefined,
    campaignId: campaignId !== "_all" ? campaignId : undefined,
    status: status !== "_all" ? status : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  const { data, isLoading, error, refetch, isFetching } = useFollowupQueue(filters);

  if (!canAccessInternalPage("fila-de-followup")) {
    return (
      <PageShell title="Fila de Followup" subtitle="Acesso restrito">
        <p className="text-sm text-slate-500">Você não tem permissão para acessar esta página.</p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Fila de Followup"
      subtitle="Leads aguardando acompanhamento — reagende, cancele ou converta para inbound"
      spacing="space-y-6"
    >
      {/* Info */}
      <Card className="border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-900/10">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <ListChecks className="h-5 w-5 shrink-0 text-indigo-500 mt-0.5" />
            <div className="space-y-1 text-sm text-indigo-800 dark:text-indigo-300">
              <p className="font-medium">Como funciona</p>
              <p className="text-indigo-700 dark:text-indigo-400">
                Leads que entraram em campanhas de follow-up aparecem aqui com o status de cada job BullMQ.
                <strong> Reagende</strong> para enfileirar um novo envio com delay, <strong>cancele</strong> para encerrar a sequência ou <strong>converta</strong> para acionar o webhook de inbound da empresa.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Filter className="h-4 w-4 text-slate-400" />
              Filtros
            </CardTitle>
            <Button
              variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
              onClick={() => refetch()} disabled={isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {/* Empresa */}
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Empresa</Label>
              <Select
                value={companyId}
                onValueChange={(v) => { setCompanyId(v); setCampaignId("_all"); }}
                disabled={loadingCompanies}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Todas as empresas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Todas as empresas</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Campanha */}
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Campanha</Label>
              <Select value={campaignId} onValueChange={setCampaignId} disabled={companyId === "all"}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all" className="text-xs">Todas as campanhas</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status */}
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Status</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as FollowupStatus | "_all")}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Todos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all" className="text-xs">Todos os status</SelectItem>
                  {(Object.keys(STATUS_LABELS) as FollowupStatus[]).map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">{STATUS_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Data */}
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Data (de / até)</Label>
              <div className="flex gap-1.5">
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 text-xs" />
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 text-xs" />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista */}
      {!filters.companyId ? (
        <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <Building2 className="h-7 w-7 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400">Selecione uma empresa para ver a fila.</p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50/50 p-10 text-center dark:border-red-800/40 dark:bg-red-900/10">
          <AlertTriangle className="h-8 w-8 text-red-400" />
          <p className="font-medium text-red-800 dark:text-red-300">Erro ao carregar fila</p>
          <p className="text-sm text-red-700 dark:text-red-400">{(error as Error).message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      ) : isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : data && data.items.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <ListChecks className="h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400">Nenhum followup encontrado com os filtros selecionados.</p>
        </div>
      ) : data ? (
        <div className="space-y-2">
          <p className="px-1 text-xs text-slate-500 dark:text-slate-400">
            {data.total} {data.total === 1 ? "item" : "itens"} encontrado{data.total !== 1 ? "s" : ""}
          </p>
          {data.items.map((item) => (
            <FollowupRow key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </PageShell>
  );
}
