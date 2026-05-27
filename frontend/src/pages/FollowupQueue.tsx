import { useEffect, useState } from "react";
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
import { useLeadClients } from "@/hooks/useLeadClients";
import { useCampanhas } from "@/hooks/useCampanhas";
import {
  useFollowupQueue,
  useRescheduleFollowup,
  useDiscardFollowup,
  useConvertToInbound,
  type FollowupItem,
  type FollowupStatus,
  type FollowupQueueFilters,
} from "@/hooks/useFollowupQueue";

const STATUS_LABELS: Record<FollowupStatus, string> = {
  pending: "Pendente",
  replied: "Respondeu",
  scheduled: "Agendado",
  discarded: "Descartado",
  converted: "Convertido",
};

const STATUS_COLORS: Record<FollowupStatus, string> = {
  pending: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  replied: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  scheduled: "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  discarded: "border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/20 dark:text-slate-500",
  converted: "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

interface RescheduleDialogProps {
  item: FollowupItem;
  onClose: () => void;
}

function RescheduleDialog({ item, onClose }: RescheduleDialogProps) {
  const [date, setDate] = useState(
    item.scheduledAt ? item.scheduledAt.slice(0, 16) : ""
  );
  const reschedule = useRescheduleFollowup();

  const handleConfirm = async () => {
    if (!date) return;
    try {
      await reschedule.mutateAsync({ id: item.id, scheduledAt: new Date(date).toISOString() });
      toast({ title: "Reagendado", description: `Followup de ${item.leadName || item.phone} reagendado.` });
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
      <div className="py-2">
        <Label className="text-xs">Nova data e hora</Label>
        <Input
          type="datetime-local"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 h-9 text-sm"
        />
      </div>
      <AlertDialogFooter>
        <AlertDialogCancel onClick={onClose}>Cancelar</AlertDialogCancel>
        <AlertDialogAction onClick={handleConfirm} disabled={!date || reschedule.isPending}>
          {reschedule.isPending ? "Salvando..." : "Confirmar"}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  );
}

interface FollowupRowProps {
  item: FollowupItem;
}

function FollowupRow({ item }: FollowupRowProps) {
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const discard = useDiscardFollowup();
  const convert = useConvertToInbound();

  const handleDiscard = async () => {
    try {
      await discard.mutateAsync(item.id);
      toast({ title: "Descartado", description: `Followup de ${item.leadName || item.phone} descartado.` });
      setDiscardOpen(false);
    } catch (e) {
      toast({ title: "Erro ao descartar", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  };

  const handleConvert = async () => {
    try {
      await convert.mutateAsync(item.id);
      toast({ title: "Convertido para inbound", description: `Lead ${item.leadName || item.phone} movido para inbound.` });
    } catch (e) {
      toast({ title: "Erro ao converter", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  };

  const isActive = item.status === "pending" || item.status === "scheduled";

  return (
    <>
      <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-900/40 sm:flex-row sm:items-center sm:gap-4">
        {/* Lead info */}
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
              {item.leadName || "Lead sem nome"}
            </span>
            <Badge className={`shrink-0 border text-[10px] font-medium ${STATUS_COLORS[item.status]}`}>
              {STATUS_LABELS[item.status]}
            </Badge>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            <span className="flex items-center gap-1">
              <Phone className="h-3 w-3" />
              {item.phone}
            </span>
            <span className="flex items-center gap-1">
              <Megaphone className="h-3 w-3" />
              {item.campaignName}
            </span>
            {item.scheduledAt && (
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Agendado: {formatDate(item.scheduledAt)}
              </span>
            )}
            {item.lastContactAt && (
              <span className="text-slate-400 dark:text-slate-500">
                Último contato: {formatDate(item.lastContactAt)}
              </span>
            )}
            {item.origin && (
              <span className="flex items-center gap-1 text-indigo-500 dark:text-indigo-400">
                <MapPin className="h-3 w-3" />
                {item.origin}
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        {isActive && (
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => setRescheduleOpen(true)}
              disabled={discard.isPending || convert.isPending}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Reagendar
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs text-indigo-600 border-indigo-200 hover:bg-indigo-50 dark:text-indigo-400 dark:border-indigo-800 dark:hover:bg-indigo-900/20"
              onClick={handleConvert}
              disabled={discard.isPending || convert.isPending}
            >
              <UserCheck className="h-3.5 w-3.5" />
              {convert.isPending ? "..." : "Inbound"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 dark:hover:text-red-400"
              onClick={() => setDiscardOpen(true)}
              disabled={discard.isPending || convert.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      {/* Reagendar dialog */}
      <AlertDialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
        <RescheduleDialog item={item} onClose={() => setRescheduleOpen(false)} />
      </AlertDialog>

      {/* Descartar dialog */}
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Descartar followup?</AlertDialogTitle>
            <AlertDialogDescription>
              O lead <strong>{item.leadName || item.phone}</strong> será removido da fila de followup. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={handleDiscard}
              disabled={discard.isPending}
            >
              {discard.isPending ? "Descartando..." : "Descartar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function FollowupQueue() {
  const { canAccessInternalPage } = useAuth();
  const { data: clients = [] } = useLeadClients();

  const [clientId, setClientId] = useState("");
  const [campaignId, setCampaignId] = useState("_all");
  const [status, setStatus] = useState<FollowupStatus | "_all">("_all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    if (!clientId && clients.length > 0) {
      setClientId(clients[0].id);
    }
  }, [clientId, clients]);

  const { data: campaigns = [] } = useCampanhas(clientId || undefined);

  const filters: FollowupQueueFilters = {
    clientId: clientId || undefined,
    campaignId: campaignId !== "_all" ? campaignId : undefined,
    status: status !== "_all" ? (status as FollowupStatus) : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  };

  const { data, isLoading, error, refetch, isFetching } = useFollowupQueue(filters);

  if (!canAccessInternalPage("planilhas") && !canAccessInternalPage("agente")) {
    return (
      <PageShell title="Fila de Followup" subtitle="Acesso restrito">
        <p className="text-sm text-slate-500">Você não tem permissão para acessar esta página.</p>
      </PageShell>
    );
  }

  const apiNotReady = data === null || (error instanceof Error && error.message.includes("404"));

  return (
    <PageShell
      title="Fila de Followup"
      subtitle="Leads de campanha aguardando acompanhamento — reagende, descarte ou converta para inbound"
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
                Leads que receberam mensagens de campanha mas ainda não responderam entram nesta fila. Você pode <strong>reagendar</strong> para tentar novamente, <strong>descartar</strong> para encerrar o contato ou <strong>converter para inbound</strong> para que o chatbot atenda como se fosse um contato orgânico.
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
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 text-xs"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Empresa</Label>
              <Select value={clientId} onValueChange={(v) => { setClientId(v); setCampaignId("_all"); }}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Campanha</Label>
              <Select value={campaignId} onValueChange={setCampaignId} disabled={!clientId}>
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
      {apiNotReady ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/50 p-10 text-center dark:border-amber-800/40 dark:bg-amber-900/10">
          <AlertTriangle className="h-8 w-8 text-amber-400" />
          <p className="font-medium text-amber-800 dark:text-amber-300">Endpoint ainda não disponível</p>
          <p className="text-sm text-amber-700 dark:text-amber-400">
            O Conrado ainda não publicou <code className="rounded bg-amber-100 px-1 dark:bg-amber-800">GET /api/followup-queue</code>.
            Quando o endpoint estiver no ar, a fila será exibida aqui automaticamente.
          </p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50/50 p-10 text-center dark:border-red-800/40 dark:bg-red-900/10">
          <AlertTriangle className="h-8 w-8 text-red-400" />
          <p className="font-medium text-red-800 dark:text-red-300">Erro ao carregar fila</p>
          <p className="text-sm text-red-700 dark:text-red-400">{error.message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      ) : isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : data && data.items.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <ListChecks className="h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400">Nenhum followup encontrado com os filtros selecionados.</p>
        </div>
      ) : data ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {data.total} {data.total === 1 ? "item" : "itens"} encontrado{data.total !== 1 ? "s" : ""}
            </p>
          </div>
          {data.items.map((item) => (
            <FollowupRow key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </PageShell>
  );
}
