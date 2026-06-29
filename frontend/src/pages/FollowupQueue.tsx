import { useState, useEffect } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
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
  Sparkles,
  CheckCheck,
  X,
  Check,
  Play,
  Pause,
  Archive,
  Pencil,
  Plus,
  Copy,
  ExternalLink,
  GripVertical,
  Eye,
  ToggleLeft,
  ToggleRight,
  TrendingUp,
  Send,
  AlertCircle,
  Users,
} from "lucide-react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import {
  useFupCompanies,
  useFupCampaigns,
  useFupTemplates,
  useCreateFupCampaign,
  useUpdateFupCampaign,
  useDeleteFupCampaign,
  useCreateFupTemplate,
  useUpdateFupTemplate,
  useDeleteFupTemplate,
  useReorderFupTemplates,
  useCreateFupCompany,
  useUpdateFupCompany,
  useArchiveFupCompany,
  useFupAnalytics,
  type FupCompany,
  type FupCampaign,
  type FupTemplate,
  type AnalyticsFilters,
} from "@/hooks/useFollowupAdmin";
import {
  useFollowupQueue,
  useRescheduleFollowup,
  useDiscardFollowup,
  useConvertToInbound,
  type FollowupItem,
  type FollowupStatus,
  type FollowupQueueFilters,
} from "@/hooks/useFollowupQueue";
import {
  useFollowupSuggestions,
  useFollowupSuggestionCount,
  useApproveSuggestion,
  useRejectSuggestion,
  useApproveSuggestionBatch,
  type FollowupSuggestion,
} from "@/hooks/useFollowupSuggestions";
import { FollowUpJourneys } from "@/components/followup/FollowUpJourneys";

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & HELPERS COMUNS
// ═══════════════════════════════════════════════════════════════════════════════

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTES DA FILA OPERACIONAL
// ═══════════════════════════════════════════════════════════════════════════════

const QUEUE_STATUS_LABELS: Record<FollowupStatus, string> = {
  active:        "Ativo",
  awaiting_reply:"Aguardando resposta",
  replied:       "Respondeu",
  failed:        "Falhou",
  cancelled:     "Cancelado",
  converted:     "Convertido",
};

const QUEUE_STATUS_COLORS: Record<FollowupStatus, string> = {
  active:        "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  awaiting_reply:"border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-900/20 dark:text-blue-400",
  replied:       "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  failed:        "border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-400",
  cancelled:     "border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800/20 dark:text-slate-500",
  converted:     "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/20 dark:text-indigo-400",
};

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
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
              {item.leadName || "Lead sem nome"}
            </span>
            <Badge className={`shrink-0 border text-[10px] font-medium ${QUEUE_STATUS_COLORS[item.status]}`}>
              {QUEUE_STATUS_LABELS[item.status]}
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

function FilaTab({ companyId }: { companyId: string }) {
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

  if (companyId === "all") {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
        <Building2 className="h-7 w-7 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-400">Selecione uma empresa específica no cabeçalho para ver a fila.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Filter className="h-4 w-4 text-slate-400" />
              Filtros da Fila
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="sm" className="h-7 gap-1.5 text-xs border-indigo-200 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-800 dark:text-indigo-400 dark:hover:bg-indigo-900/20"
                onClick={() => {}} 
              >
                <Plus className="h-3.5 w-3.5" />
                Importar CSV
              </Button>
              <Button
                variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
                onClick={() => refetch()} disabled={isFetching}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                Atualizar
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Campanha</Label>
              <Select value={campaignId} onValueChange={setCampaignId}>
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
                  {(Object.keys(QUEUE_STATUS_LABELS) as FollowupStatus[]).map((s) => (
                    <SelectItem key={s} value={s} className="text-xs">{QUEUE_STATUS_LABELS[s]}</SelectItem>
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
      {error ? (
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
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTES DE SUGESTÕES IA
// ═══════════════════════════════════════════════════════════════════════════════

const SUGGESTIONS_TAB_LABELS = {
  pending:  "Pendentes",
  approved: "Aprovadas",
  rejected: "Rejeitadas",
} as const;

interface SuggestionCardProps {
  suggestion: FollowupSuggestion;
  selected: boolean;
  onToggleSelect: () => void;
}

function SuggestionCard({ suggestion, selected, onToggleSelect }: SuggestionCardProps) {
  const [editedMessage, setEditedMessage] = useState(suggestion.suggestedMessage ?? suggestion.templateMessage ?? "");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const approve = useApproveSuggestion();
  const reject  = useRejectSuggestion();

  const isPending = suggestion.status === "pending";

  const handleApprove = async () => {
    try {
      await approve.mutateAsync({ id: suggestion.id, message: editedMessage || undefined });
      toast({ title: "Sugestão aprovada", description: `Followup de ${suggestion.leadName || suggestion.phone} enfileirado.` });
      setApproveOpen(false);
    } catch (e) {
      toast({ title: "Erro ao aprovar", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  };

  const handleReject = async () => {
    try {
      await reject.mutateAsync(suggestion.id);
      toast({ title: "Sugestão rejeitada" });
      setRejectOpen(false);
    } catch (e) {
      toast({ title: "Erro ao rejeitar", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  };

  return (
    <>
      <Card
        className={`transition-colors ${selected ? "ring-2 ring-violet-400 border-violet-300" : ""} ${
          suggestion.status === "approved" ? "opacity-60" : ""
        } ${suggestion.status === "rejected" ? "opacity-40" : ""}`}
      >
        <CardContent className="pt-4 space-y-3">
          <div className="flex items-start gap-3">
            {isPending && (
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggleSelect}
                className="mt-1 h-4 w-4 accent-violet-500 cursor-pointer"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-sm text-slate-800 dark:text-slate-100">
                  {suggestion.leadName || "Lead sem nome"}
                </span>
                {suggestion.status === "approved" && (
                  <Badge className="border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400 text-[10px]">
                    Aprovada
                  </Badge>
                )}
                {suggestion.status === "rejected" && (
                  <Badge className="border-slate-300 bg-slate-50 text-slate-500 dark:bg-slate-800/20 text-[10px]">
                    Rejeitada
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{suggestion.phone}</span>
                {suggestion.companyName && (
                  <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{suggestion.companyName}</span>
                )}
                {suggestion.campaignName && (
                  <span className="flex items-center gap-1"><Megaphone className="h-3 w-3" />{suggestion.campaignName}</span>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 dark:bg-amber-900/10 dark:border-amber-800">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Motivo da sugestão</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">{suggestion.reason}</p>
          </div>

          {suggestion.templateName && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <span>Template: <span className="font-medium text-slate-700 dark:text-slate-300">{suggestion.templateName}</span></span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
              <Sparkles className="h-3 w-3 text-violet-400" />
              Mensagem sugerida pela IA
              {isPending && <span className="text-slate-400">(editável)</span>}
            </Label>
            {isPending ? (
              <Textarea
                value={editedMessage}
                onChange={(e) => setEditedMessage(e.target.value)}
                rows={3}
                className="text-xs resize-none"
                placeholder="Nenhuma mensagem gerada. Escreva aqui ou aprove para usar o template padrão."
              />
            ) : (
              <p className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-600 dark:border-white/10 dark:bg-slate-800/40 dark:text-slate-400 whitespace-pre-wrap">
                {suggestion.suggestedMessage || suggestion.templateMessage || "—"}
              </p>
            )}
          </div>

          {isPending && (
            <div className="flex justify-end gap-2 pt-1">
              <Button
                variant="ghost" size="sm"
                className="h-7 gap-1 text-xs text-slate-500 hover:text-red-500"
                onClick={() => setRejectOpen(true)}
                disabled={reject.isPending || approve.isPending}
              >
                <X className="h-3.5 w-3.5" />
                Rejeitar
              </Button>
              <Button
                size="sm"
                className="h-7 gap-1 text-xs bg-violet-600 hover:bg-violet-700"
                onClick={() => setApproveOpen(true)}
                disabled={approve.isPending || reject.isPending}
              >
                <Check className="h-3.5 w-3.5" />
                {approve.isPending ? "Aprovando..." : "Aprovar e enviar"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar aprovação</AlertDialogTitle>
            <AlertDialogDescription>
              Um job de followup será enfileirado imediatamente para <strong>{suggestion.leadName || suggestion.phone}</strong>.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleApprove} disabled={approve.isPending}>
              {approve.isPending ? "Aprovando..." : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rejeitar sugestão?</AlertDialogTitle>
            <AlertDialogDescription>
              A sugestão para <strong>{suggestion.leadName || suggestion.phone}</strong> será descartada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-500 hover:bg-red-600"
              onClick={handleReject}
              disabled={reject.isPending}
            >
              Rejeitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SuggestionsTab({ companyId }: { companyId: string }) {
  const [statusTab, setStatusTab] = useState<"pending" | "approved" | "rejected">("pending");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const { data: suggestions = [], isLoading, error, refetch, isFetching } = useFollowupSuggestions(
    companyId !== "all" ? companyId : undefined,
    statusTab
  );
  const batchApprove = useApproveSuggestionBatch();

  const pendingSuggestions = suggestions.filter((s) => s.status === "pending");
  const allPendingIds = pendingSuggestions.map((s) => s.id);
  const allSelected = allPendingIds.length > 0 && allPendingIds.every((id) => selected.has(id));

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(allPendingIds));
    }
  };

  const handleBatchApprove = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    try {
      const result = await batchApprove.mutateAsync(ids);
      toast({
        title: `${result.approved.length} sugestões aprovadas`,
        description: result.failed.length > 0 ? `${result.failed.length} falharam.` : undefined,
      });
      setSelected(new Set());
    } catch (e) {
      toast({ title: "Erro ao aprovar em lote", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      {/* Informações */}
      <Card className="border-violet-200 bg-violet-50/50 dark:border-violet-800 dark:bg-violet-900/10">
        <CardContent className="pt-4">
          <div className="flex gap-3">
            <Sparkles className="h-5 w-5 shrink-0 text-violet-500 mt-0.5" />
            <div className="space-y-1 text-sm text-violet-800 dark:text-violet-300">
              <p className="font-medium">Como funciona</p>
              <p className="text-violet-700 dark:text-violet-400">
                A cada 6 horas o motor verifica leads sem contato, sem resposta após 48h e com envios falhos.
                Para cada candidato, a IA escolhe o template mais adequado e personaliza a mensagem.
                <strong> Nenhuma mensagem é enviada sem aprovação do operador.</strong>
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs Filtro */}
      <Card>
        <CardContent className="pt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex-1 min-w-[300px] flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/40">
            {(Object.keys(SUGGESTIONS_TAB_LABELS) as Array<keyof typeof SUGGESTIONS_TAB_LABELS>).map((s) => (
              <button
                key={s}
                onClick={() => { setStatusTab(s); setSelected(new Set()); }}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  statusTab === s
                    ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {SUGGESTIONS_TAB_LABELS[s]}
                {s === "pending" && suggestions.length > 0 && statusTab === "pending" && (
                  <span className="ml-1.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                    {suggestions.length}
                  </span>
                )}
              </button>
            ))}
          </div>
          <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </CardContent>
      </Card>

      {/* Ações em lote */}
      {statusTab === "pending" && suggestions.length > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-violet-200 bg-violet-50/50 px-4 py-2.5 dark:border-violet-800 dark:bg-violet-900/10">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              className="h-4 w-4 accent-violet-500"
            />
            Selecionar todas ({allPendingIds.length})
          </label>
          {selected.size > 0 && (
            <Button
              size="sm"
              className="h-8 gap-1.5 text-xs bg-violet-600 hover:bg-violet-700"
              onClick={handleBatchApprove}
              disabled={batchApprove.isPending}
            >
              <CheckCheck className="h-3.5 w-3.5" />
              {batchApprove.isPending ? "Aprovando..." : `Aprovar ${selected.size} selecionadas`}
            </Button>
          )}
        </div>
      )}

      {/* Lista */}
      {error ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50/50 p-10 text-center dark:border-red-800/40 dark:bg-red-900/10">
          <AlertTriangle className="h-8 w-8 text-red-400" />
          <p className="font-medium text-red-800 dark:text-red-300">Erro ao carregar sugestões</p>
          <p className="text-sm text-red-700 dark:text-red-400">{(error as Error).message}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>Tentar novamente</Button>
        </div>
      ) : isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : suggestions.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <Sparkles className="h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400">
            {statusTab === "pending"
              ? "Nenhuma sugestão pendente. O motor verifica leads a cada 6 horas."
              : `Nenhuma sugestão ${SUGGESTIONS_TAB_LABELS[statusTab].toLowerCase()} encontrada.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {suggestions.map((s) => (
            <SuggestionCard
              key={s.id}
              suggestion={s}
              selected={selected.has(s.id)}
              onToggleSelect={() => toggleSelect(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTES DE CAMPANHAS & TEMPLATES (DRILL DOWN IN-PLACE)
// ═══════════════════════════════════════════════════════════════════════════════

const CAMPAIGN_STATUS_LABELS: Record<FupCampaign["status"], string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  archived: "Arquivada",
};

const CAMPAIGN_STATUS_COLORS: Record<FupCampaign["status"], string> = {
  draft: "border-slate-300 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
  active: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  paused: "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-400",
  archived: "border-slate-300 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500",
};

const EMPTY_CAMPAIGN_FORM = { name: "", description: "", default_origin: "" };

function CampaignForm({
  initial, onSave, onCancel, isLoading,
}: {
  initial: typeof EMPTY_CAMPAIGN_FORM;
  onSave: (v: typeof EMPTY_CAMPAIGN_FORM) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label className="text-xs">Nome da campanha *</Label>
        <Input value={form.name} onChange={(e) => set("name", e.target.value)}
          placeholder="Ex: Agendamento Consulta Maio" className="h-8 text-sm" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Descrição</Label>
        <Textarea value={form.description} onChange={(e) => set("description", e.target.value)}
          placeholder="Descreva o objetivo desta campanha..." className="text-sm min-h-[72px]" />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Origem padrão</Label>
        <Input value={form.default_origin} onChange={(e) => set("default_origin", e.target.value)}
          placeholder="Ex: Instagram Ads Maio" className="h-8 text-sm" />
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Usada quando o lead não traz parâmetros UTM. Ex: "Instagram Ads", "WhatsApp Orgânico".
        </p>
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isLoading}>Cancelar</Button>
        <Button size="sm" onClick={() => onSave(form)}
          disabled={isLoading || !form.name.trim()}>
          {isLoading ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function WebhookInfo({ campaign }: { campaign: FupCampaign }) {
  const [showSecret, setShowSecret] = useState(false);

  const copyUrl = () => {
    if (campaign.webhook_trigger_url) {
      navigator.clipboard.writeText(campaign.webhook_trigger_url);
      toast({ title: "URL copiada!" });
    }
  };

  const copySecret = () => {
    if (campaign.webhook_secret) {
      navigator.clipboard.writeText(campaign.webhook_secret);
      toast({ title: "Secret copiado!" });
    }
  };

  return (
    <div className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3 dark:border-white/10 dark:bg-slate-900/30">
      <p className="text-[11px] font-medium text-slate-600 dark:text-slate-400">Webhook de entrada (Calendly ou genérico)</p>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {campaign.webhook_trigger_url || "—"}
        </code>
        <button onClick={copyUrl} className="shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <code className="flex-1 truncate rounded bg-slate-100 px-2 py-1 text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300">
          {showSecret ? (campaign.webhook_secret || "—") : "••••••••••••"}
        </code>
        <button onClick={() => setShowSecret(!showSecret)}
          className="shrink-0 text-[10px] text-slate-400 hover:text-slate-700">
          {showSecret ? "Ocultar" : "Ver"}
        </button>
        <button onClick={copySecret} className="shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">
        No Calendly: Integrations → Webhooks → POST com esta URL. Adicione o header{" "}
        <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">X-Hub-Signature-256</code>{" "}
        com o secret acima.
      </p>
    </div>
  );
}

function CampaignCard({
  campaign, companyId, onEdit, onSelectTemplates,
}: {
  campaign: FupCampaign;
  companyId: string;
  onEdit: (c: FupCampaign) => void;
  onSelectTemplates: (c: FupCampaign) => void;
}) {
  const updateMut = useUpdateFupCampaign();
  const deleteMut = useDeleteFupCampaign();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const changeStatus = async (newStatus: FupCampaign["status"]) => {
    try {
      await updateMut.mutateAsync({ id: campaign.id, company_id: companyId, status: newStatus });
      toast({ title: `Campanha ${CAMPAIGN_STATUS_LABELS[newStatus].toLowerCase()}` });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    try {
      await deleteMut.mutateAsync({ id: campaign.id, company_id: companyId });
      toast({ title: "Campanha excluída" });
      setDeleteOpen(false);
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const canDelete = campaign.status === "draft" || campaign.status === "archived";
  const isMutating = updateMut.isPending || deleteMut.isPending;

  return (
    <>
      <Card className="overflow-hidden">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">
                  {campaign.name}
                </h3>
                <Badge className={`shrink-0 border text-[10px] font-medium ${CAMPAIGN_STATUS_COLORS[campaign.status]}`}>
                  {CAMPAIGN_STATUS_LABELS[campaign.status]}
                </Badge>
              </div>
              {campaign.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">
                  {campaign.description}
                </p>
              )}
              {campaign.default_origin && (
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Origem padrão: <span className="font-medium">{campaign.default_origin}</span>
                </p>
              )}
              <div className="flex gap-4 text-xs text-slate-500 dark:text-slate-400">
                <span>{campaign.totalLeads} leads</span>
                <span>{campaign.messagesSent} mensagens enviadas</span>
              </div>
            </div>
          </div>

          <WebhookInfo campaign={campaign} />

          <div className="flex flex-wrap gap-1.5">
            {campaign.status === "draft" || campaign.status === "paused" ? (
              <Button size="sm" variant="outline"
                className="h-7 gap-1 text-xs text-emerald-600 border-emerald-200 hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-800 dark:hover:bg-emerald-900/20"
                onClick={() => changeStatus("active")} disabled={isMutating}>
                <Play className="h-3 w-3" /> Iniciar
              </Button>
            ) : null}
            {campaign.status === "active" && (
              <Button size="sm" variant="outline"
                className="h-7 gap-1 text-xs text-amber-600 border-amber-200 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-900/20"
                onClick={() => changeStatus("paused")} disabled={isMutating}>
                <Pause className="h-3 w-3" /> Pausar
              </Button>
            )}
            {(campaign.status === "active" || campaign.status === "paused") && (
              <Button size="sm" variant="outline"
                className="h-7 gap-1 text-xs text-slate-500"
                onClick={() => changeStatus("archived")} disabled={isMutating}>
                <Archive className="h-3 w-3" /> Arquivar
              </Button>
            )}
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs"
              onClick={() => onEdit(campaign)} disabled={isMutating}>
              <Pencil className="h-3 w-3" /> Editar
            </Button>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs text-indigo-600 border-indigo-200 hover:bg-indigo-50 dark:text-indigo-400 dark:border-indigo-800 dark:hover:bg-indigo-900/20"
              onClick={() => onSelectTemplates(campaign)}>
              <ExternalLink className="h-3 w-3" /> Templates
            </Button>
            {canDelete && (
              <Button size="sm" variant="ghost"
                className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                onClick={() => setDeleteOpen(true)} disabled={isMutating}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir campanha?</AlertDialogTitle>
            <AlertDialogDescription>
              A campanha <strong>{campaign.name}</strong> e todos os seus templates serão excluídos permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-red-500 hover:bg-red-600" onClick={handleDelete} disabled={deleteMut.isPending}>
              {deleteMut.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTES DE GERENCIAMENTO DE TEMPLATES (EMBUTIDO NAS CAMPANHAS)
// ═══════════════════════════════════════════════════════════════════════════════

function labelForTemplate(t: FupTemplate) {
  if (t.trigger_type === "on_schedule") return "Envio Imediato";
  if (t.trigger_type === "no_reply") return `Após Inatividade (${t.trigger_value} ${t.trigger_unit === "days" ? "Dias" : t.trigger_unit === "hours" ? "Horas" : "Minutos"})`;
  if (t.trigger_type === "before_meeting") return `${t.trigger_value} ${t.trigger_unit === "days" ? "Dias" : t.trigger_unit === "hours" ? "Horas" : "Minutos"} Antes do Agendamento`;
  if (t.trigger_type === "after_meeting") return `${t.trigger_value} ${t.trigger_unit === "days" ? "Dias" : t.trigger_unit === "hours" ? "Horas" : "Minutos"} Depois do Agendamento`;
  return `${t.trigger_type} ${t.trigger_value} ${t.trigger_unit}`;
}

const SEGMENT_VARS: Record<string, string[]> = {
  geral: ["{{lead_name}}", "{{meeting_date}}", "{{meeting_time}}"],
  b2b: ["{{lead_name}}", "{{company_name}}", "{{role}}", "{{meeting_date}}", "{{meeting_time}}"],
  restaurante: ["{{lead_name}}", "{{reservation_date}}", "{{number_of_guests}}"],
  turismo: ["{{lead_name}}", "{{destination}}", "{{travel_date}}"],
};

const TEMPLATE_EXAMPLE_DATA: Record<string, Record<string, string>> = {
  geral: { lead_name: "Maria Silva", meeting_date: "20/06/2026", meeting_time: "14:00" },
  b2b: { lead_name: "João Silva", company_name: "Tech Corp", role: "CEO", meeting_date: "20/06/2026", meeting_time: "14:00" },
  restaurante: { lead_name: "Carlos", reservation_date: "20/06/2026 às 20:00", number_of_guests: "4 pessoas" },
  turismo: { lead_name: "Ana", destination: "Paris", travel_date: "15/08/2026" },
};

function renderPreview(msg: string, segment?: string) {
  let output = msg;
  let data = TEMPLATE_EXAMPLE_DATA.geral;
  if (segment && TEMPLATE_EXAMPLE_DATA[segment]) {
    data = TEMPLATE_EXAMPLE_DATA[segment];
  } else {
    data = { ...TEMPLATE_EXAMPLE_DATA.geral, ...TEMPLATE_EXAMPLE_DATA.b2b, ...TEMPLATE_EXAMPLE_DATA.restaurante, ...TEMPLATE_EXAMPLE_DATA.turismo };
  }
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "gi");
    output = output.replace(regex, value);
  }
  return output;
}

const EMPTY_TEMPLATE_FORM = {
  name: "",
  message: "",
  trigger_type: "no_reply" as FupTemplate["trigger_type"],
  trigger_value: 1,
  trigger_unit: "days" as FupTemplate["trigger_unit"],
  segment: "geral",
  is_active: true,
};

function TemplateForm({
  initial, onSave, onCancel, isLoading, campaignId, orderIndex,
}: {
  initial: typeof EMPTY_TEMPLATE_FORM;
  onSave: (v: Omit<FupTemplate, "id" | "created_at">) => void;
  onCancel: () => void;
  isLoading: boolean;
  campaignId: string;
  orderIndex: number;
}) {
  const [form, setForm] = useState(initial);
  const [showPreview, setShowPreview] = useState(false);
  const set = (k: keyof typeof form, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  const insertVar = (v: string) => set("message", form.message + v);

  const handleSave = () => {
    onSave({
      campaign_id: campaignId,
      name: form.name,
      message: form.message,
      trigger_type: form.trigger_type,
      trigger_value: form.trigger_type === "on_schedule" ? 0 : form.trigger_value,
      trigger_unit: form.trigger_type === "on_schedule" ? "minutes" : form.trigger_unit,
      trigger_direction: form.trigger_type === "before_meeting" ? "before" : form.trigger_type === "after_meeting" ? "after" : null,
      is_active: form.is_active,
      order_index: orderIndex,
    });
  };

  return (
    <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Nome do Estágio *</Label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)}
            placeholder="Ex: Mensagem Dia 1" className="h-8 text-sm" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Segmento (Variáveis)</Label>
          <Select value={form.segment} onValueChange={(v) => set("segment", v)}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="geral" className="text-xs">Geral</SelectItem>
              <SelectItem value="b2b" className="text-xs">B2B</SelectItem>
              <SelectItem value="restaurante" className="text-xs">Restaurante</SelectItem>
              <SelectItem value="turismo" className="text-xs">Turismo</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="p-3 border border-indigo-100 dark:border-indigo-900/50 bg-indigo-50/50 dark:bg-indigo-900/10 rounded-lg space-y-3">
        <Label className="text-xs font-bold text-indigo-800 dark:text-indigo-300">Regra de Disparo</Label>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3 sm:col-span-1 space-y-1.5">
            <Label className="text-[10px] text-slate-500">Tipo de Gatilho</Label>
            <Select value={form.trigger_type} onValueChange={(v) => set("trigger_type", v)}>
              <SelectTrigger className="h-8 text-xs bg-white dark:bg-slate-900">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="on_schedule" className="text-xs">Envio Imediato</SelectItem>
                <SelectItem value="no_reply" className="text-xs">Após Inatividade</SelectItem>
                <SelectItem value="before_meeting" className="text-xs">Antes do Agendamento</SelectItem>
                <SelectItem value="after_meeting" className="text-xs">Depois do Agendamento</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          {form.trigger_type !== "on_schedule" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-[10px] text-slate-500">Quantidade</Label>
                <Input type="number" min={1} value={form.trigger_value} onChange={(e) => set("trigger_value", parseInt(e.target.value) || 1)}
                  className="h-8 text-sm bg-white dark:bg-slate-900" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[10px] text-slate-500">Unidade de Tempo</Label>
                <Select value={form.trigger_unit} onValueChange={(v) => set("trigger_unit", v)}>
                  <SelectTrigger className="h-8 text-xs bg-white dark:bg-slate-900">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="minutes" className="text-xs">Minutos</SelectItem>
                    <SelectItem value="hours" className="text-xs">Horas</SelectItem>
                    <SelectItem value="days" className="text-xs">Dias</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Texto da Mensagem *</Label>
          <button onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-1 text-[10px] text-indigo-500 hover:text-indigo-700">
            <Eye className="h-3 w-3" />
            {showPreview ? "Editar" : "Preview"}
          </button>
        </div>
        {showPreview ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-3 text-xs text-slate-700 dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-300 whitespace-pre-wrap min-h-[100px]">
            {renderPreview(form.message, form.segment) || <span className="text-slate-400 italic">Nenhuma mensagem</span>}
          </div>
        ) : (
          <Textarea
            value={form.message}
            onChange={(e) => set("message", e.target.value)}
            placeholder="Olá {{lead_name}}, conseguimos falar sobre a proposta?"
            className="text-sm min-h-[100px] font-mono"
          />
        )}
        <div className="flex flex-wrap gap-1.5 mt-2">
          {(SEGMENT_VARS[form.segment] || SEGMENT_VARS.geral).map((v) => (
            <button key={v}
              onClick={() => insertVar(v)}
              className="rounded-full border border-indigo-200 bg-indigo-50 px-2 py-0.5 text-[10px] text-indigo-600 hover:bg-indigo-100 dark:border-indigo-800 dark:bg-indigo-900/20 dark:text-indigo-400 dark:hover:bg-indigo-900/40">
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Switch checked={form.is_active} onCheckedChange={(v) => set("is_active", v)} id="tpl-active" />
        <Label htmlFor="tpl-active" className="text-sm cursor-pointer">Estágio ativo (Pronto para envio)</Label>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isLoading}>Cancelar</Button>
        <Button size="sm" onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-700"
          disabled={isLoading || !form.name.trim() || !form.message.trim()}>
          {isLoading ? "Salvando..." : "Salvar Estágio"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function CampaignTemplatesView({ campaign, onBack }: { campaign: FupCampaign; onBack: () => void }) {
  const { data: templates = [], isLoading } = useFupTemplates(campaign.id);
  const createMut = useCreateFupTemplate();
  const updateMut = useUpdateFupTemplate();
  const deleteMut = useDeleteFupTemplate();
  const reorderMut = useReorderFupTemplates();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FupTemplate | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FupTemplate | null>(null);
  const [localOrder, setLocalOrder] = useState<FupTemplate[]>([]);

  useEffect(() => {
    setLocalOrder(templates);
  }, [templates]);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (t: FupTemplate) => { setEditing(t); setDialogOpen(true); };

  const handleSave = async (data: Omit<FupTemplate, "id" | "created_at">) => {
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, ...data });
        toast({ title: "Template atualizado" });
      } else {
        await createMut.mutateAsync(data);
        toast({ title: "Template criado" });
      }
      setDialogOpen(false);
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync({ id: deleteTarget.id, campaign_id: campaign.id });
      toast({ title: "Template excluído" });
      setDeleteTarget(null);
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const toggleActive = async (t: FupTemplate) => {
    try {
      await updateMut.mutateAsync({ id: t.id, campaign_id: t.campaign_id, is_active: !t.is_active });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  const moveUp = async (idx: number) => {
    if (idx === 0) return;
    const next = [...localOrder];
    [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
    const items = next.map((t, i) => ({ id: t.id, order_index: i }));
    setLocalOrder(next);
    await reorderMut.mutateAsync({ items, campaign_id: campaign.id });
  };

  const moveDown = async (idx: number) => {
    if (idx >= localOrder.length - 1) return;
    const next = [...localOrder];
    [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
    const items = next.map((t, i) => ({ id: t.id, order_index: i }));
    setLocalOrder(next);
    await reorderMut.mutateAsync({ items, campaign_id: campaign.id });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b pb-3 border-slate-100 dark:border-white/5">
        <div className="space-y-0.5">
          <button onClick={onBack} className="text-xs font-semibold text-indigo-500 hover:text-indigo-700 flex items-center gap-1">
            ← Voltar para Regras de Cadência
          </button>
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Estágios da Cadência — {campaign.name}</h3>
        </div>
        <Button size="sm" className="gap-2 bg-indigo-600 hover:bg-indigo-700" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Adicionar Estágio
        </Button>
      </div>

      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4 flex gap-4">
        <Bot className="h-6 w-6 text-amber-500 shrink-0" />
        <div>
          <h4 className="font-bold text-amber-800 dark:text-amber-500 mb-1 text-sm">Atenção: A Regra da Pausa Automática</h4>
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Qualquer mensagem configurada aqui será disparada na ordem e data corretas. Porém, <strong>se o cliente responder a qualquer momento</strong>, a cadência inteira será pausada e este lead sairá do fluxo de Follow-up para ser assumido por você.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : localOrder.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-400">Nenhum template ainda. Adicione a primeira mensagem.</p>
          <Button size="sm" variant="outline" onClick={openCreate} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Adicionar
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {localOrder.map((t, idx) => (
            <div key={t.id} className="relative">
              {idx > 0 && (
                <div className="absolute -top-3 left-6 flex items-center justify-center w-full max-w-[200px]">
                  <div className="h-6 w-px bg-slate-200 dark:bg-white/10 absolute left-0" />
                  <div className="bg-slate-50 border dark:bg-slate-900 dark:border-white/10 rounded-full px-3 py-1 text-[10px] font-medium text-slate-600 shadow-sm z-10 flex items-center gap-1.5 -translate-y-2">
                    <Clock className="w-3.5 h-3.5 text-indigo-500" /> ⏱️ {labelForTemplate(t)}
                  </div>
                </div>
              )}
              <div className={`flex items-start gap-3 rounded-xl border p-3 transition-opacity ${t.is_active ? "border-slate-200 bg-white dark:border-white/10 dark:bg-slate-900/40" : "border-slate-100 bg-slate-50/50 opacity-60 dark:border-white/5 dark:bg-slate-900/20"} ${idx > 0 ? "mt-4" : ""}`}>
              <div className="flex flex-col gap-0.5 pt-0.5">
                <button onClick={() => moveUp(idx)} disabled={idx === 0}
                  className="text-slate-300 hover:text-slate-600 disabled:opacity-0 transition-colors">
                  <GripVertical className="h-3.5 w-3.5 rotate-90" />
                </button>
                <button onClick={() => moveDown(idx)} disabled={idx >= localOrder.length - 1}
                  className="text-slate-300 hover:text-slate-600 disabled:opacity-0 transition-colors">
                  <GripVertical className="h-3.5 w-3.5 -rotate-90" />
                </button>
              </div>

              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    #{idx + 1}
                  </span>
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{t.name}</span>
                  <Badge variant="outline" className="text-[10px] border-indigo-200 text-indigo-600 dark:border-indigo-800 dark:text-indigo-400">
                    {labelForTemplate(t)}
                  </Badge>
                  {!t.is_active && (
                    <Badge variant="outline" className="text-[10px] text-slate-400">Inativo</Badge>
                  )}
                  <span className="flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-sm bg-green-50 text-green-600 dark:bg-green-900/20 dark:text-green-400 border border-green-100 dark:border-green-900/30">
                    <MessageSquare className="w-3 h-3" /> WhatsApp
                  </span>
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 font-mono">
                  {renderPreview(t.message)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Switch checked={t.is_active} onCheckedChange={() => toggleActive(t)}
                  className="scale-75" />
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                  onClick={() => openEdit(t)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                  onClick={() => setDeleteTarget(t)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Estágio" : "Novo Estágio da Cadência"}</DialogTitle>
          </DialogHeader>
          <TemplateForm
            campaignId={campaign.id}
            orderIndex={localOrder.length}
            initial={
              editing
                ? {
                    name: editing.name,
                    message: editing.message,
                    trigger_type: editing.trigger_type,
                    trigger_value: editing.trigger_value,
                    trigger_unit: editing.trigger_unit,
                    segment: "geral",
                    is_active: editing.is_active,
                  }
                : EMPTY_TEMPLATE_FORM
            }
            onSave={handleSave}
            onCancel={() => setDialogOpen(false)}
            isLoading={createMut.isPending || updateMut.isPending}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir template?</AlertDialogTitle>
            <AlertDialogDescription>
              O template <strong>{deleteTarget?.name}</strong> será excluído permanentemente.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction className="bg-red-500 hover:bg-red-600" onClick={handleDelete}
              disabled={deleteMut.isPending}>
              {deleteMut.isPending ? "Excluindo..." : "Excluir"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CampaignsTab({ companyId }: { companyId: string }) {
  const { data: campaigns = [], isLoading: loadingCampaigns } = useFupCampaigns(companyId !== "all" ? companyId : undefined);
  const createMut = useCreateFupCampaign();
  const updateMut = useUpdateFupCampaign();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FupCampaign | null>(null);
  const [selectedCampaignForTemplates, setSelectedCampaignForTemplates] = useState<FupCampaign | null>(null);

  useEffect(() => {
    // Reset templates drilldown on company change
    setSelectedCampaignForTemplates(null);
  }, [companyId]);

  const openCreate = () => { setEditing(null); setDialogOpen(true); };
  const openEdit = (c: FupCampaign) => { setEditing(c); setDialogOpen(true); };

  if (companyId === "all") {
    return (
      <div className="flex h-40 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
        <Building2 className="h-7 w-7 text-slate-300 dark:text-slate-600" />
        <p className="text-sm text-slate-400">Selecione uma empresa específica no cabeçalho para gerenciar as campanhas.</p>
      </div>
    );
  }

  // Drill down view
  if (selectedCampaignForTemplates) {
    return (
      <CampaignTemplatesView
        campaign={selectedCampaignForTemplates}
        onBack={() => setSelectedCampaignForTemplates(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2 h-8 bg-indigo-600 hover:bg-indigo-700" onClick={openCreate}>
          <Plus className="h-3.5 w-3.5" />
          Nova Regra de Cadência
        </Button>
      </div>

      {loadingCampaigns ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <Megaphone className="h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400">
            A empresa selecionada ainda não possui regras de cadência ativas.
          </p>
          <Button size="sm" variant="outline" onClick={openCreate} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Criar primeira regra de cadência
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {campaigns.map((c) => (
            <CampaignCard
              key={c.id}
              campaign={c}
              companyId={companyId}
              onEdit={openEdit}
              onSelectTemplates={(campaign) => setSelectedCampaignForTemplates(campaign)}
            />
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar Regra de Cadência" : "Nova Regra de Cadência"}</DialogTitle>
            {!editing && (
              <p className="text-sm text-slate-500">Defina o nome desta regra (ex: Lead Frio, Proposta Enviada) para poder jogar os leads nela.</p>
            )}
          </DialogHeader>
          <CampaignForm
            initial={
              editing
                ? { name: editing.name, description: editing.description || "", default_origin: editing.default_origin || "" }
                : EMPTY_CAMPAIGN_FORM
            }
            onSave={async (form) => {
              try {
                if (editing) {
                  await updateMut.mutateAsync({ id: editing.id, company_id: companyId, ...form });
                  toast({ title: "Campanha atualizada" });
                } else {
                  await createMut.mutateAsync({ company_id: companyId, ...form });
                  toast({ title: "Campanha criada" });
                }
                setDialogOpen(false);
              } catch (e) {
                toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
              }
            }}
            onCancel={() => setDialogOpen(false)}
            isLoading={createMut.isPending || updateMut.isPending}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTES DE MÉTRICAS (ANALYTICS)
// ═══════════════════════════════════════════════════════════════════════════════

const ANALYTICS_COLORS = ["#818cf8", "#34d399", "#f59e0b", "#f87171", "#60a5fa", "#a78bfa", "#2dd4bf", "#fb923c"];

function KpiCard({ label, value, sub, icon: Icon, color }: {
  label: string; value: string | number; sub?: string;
  icon: React.ElementType; color: string;
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
            <p className="mt-1 text-2xl font-bold text-slate-800 dark:text-slate-100">{value}</p>
            {sub && <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">{sub}</p>}
          </div>
          <div className={`rounded-xl p-2.5 ${color}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartSkeleton({ height = 200 }: { height?: number }) {
  return (
    <div
      className="animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800"
      style={{ height }}
    />
  );
}

function periodDates(period: string): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(now);

  if (period === "today") return { from: today, to: today };
  if (period === "7d") {
    const d = new Date(now); d.setDate(d.getDate() - 6);
    return { from: fmt(d), to: today };
  }
  if (period === "30d") {
    const d = new Date(now); d.setDate(d.getDate() - 29);
    return { from: fmt(d), to: today };
  }
  if (period === "thisMonth") {
    return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }
  if (period === "lastMonth") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: fmt(first), to: fmt(last) };
  }
  return { from: "", to: "" };
}

function AnalyticsTab({ companyId }: { companyId: string }) {
  const [campaignId, setCampaignId] = useState("_all");
  const [period, setPeriod] = useState("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const { data: campaigns = [] } = useFupCampaigns(companyId !== "all" ? companyId : undefined);

  const { from, to } = period === "custom"
    ? { from: customFrom, to: customTo }
    : periodDates(period);

  const filters: AnalyticsFilters = {
    companyId: companyId !== "all" ? companyId : undefined,
    campaignId: campaignId !== "_all" ? campaignId : undefined,
    from: from || undefined,
    to: to || undefined,
  };

  const { data, isLoading, isFetching, refetch, error } = useFupAnalytics(filters);

  const kpis = data?.kpis;
  const byOrigin = data?.byOrigin || [];
  const byDay = data?.byDay || [];
  const conversionByCampaign = data?.conversionByCampaign || [];
  const messagesByDay = data?.messagesByDay || [];
  const topCampaigns = data?.topCampaigns || [];

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Filter className="h-4 w-4 text-slate-400" />
              Filtros de Métricas
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs"
              onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Campanha</Label>
              <Select value={campaignId} onValueChange={setCampaignId} disabled={companyId === "all"}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Todas" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all" className="text-xs">Todas</SelectItem>
                  {campaigns.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500 dark:text-slate-400">Período</Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today" className="text-xs">Hoje</SelectItem>
                  <SelectItem value="7d" className="text-xs">7 dias</SelectItem>
                  <SelectItem value="30d" className="text-xs">30 dias</SelectItem>
                  <SelectItem value="thisMonth" className="text-xs">Este mês</SelectItem>
                  <SelectItem value="lastMonth" className="text-xs">Mês anterior</SelectItem>
                  <SelectItem value="custom" className="text-xs">Personalizado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {period === "custom" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-slate-500 dark:text-slate-400">De / Até</Label>
                <div className="flex gap-1.5">
                  <Input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-8 text-xs" />
                  <Input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-8 text-xs" />
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {error ? (
        <div className="flex h-32 flex-col items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50/50 dark:border-red-800/40 dark:bg-red-900/10">
          <AlertCircle className="h-6 w-6 text-red-400" />
          <p className="text-sm text-red-700 dark:text-red-400">Erro ao carregar dados operacionais. Tente novamente.</p>
        </div>
      ) : (
        <>
          {/* KPIs */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {isLoading ? (
              [1, 2, 3, 4, 5].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />)
            ) : (
              <>
                <KpiCard label="Total de leads" value={kpis?.totalLeads ?? 0} icon={Users}
                  color="bg-indigo-50 text-indigo-500 dark:bg-indigo-900/20 dark:text-indigo-400" />
                <KpiCard label="Com telefone" value={kpis?.validPhone ?? 0}
                  sub={kpis?.totalLeads ? `${Math.round((kpis.validPhone / kpis.totalLeads) * 100)}% do total` : undefined}
                  icon={Users} color="bg-cyan-50 text-cyan-500 dark:bg-cyan-900/20 dark:text-cyan-400" />
                <KpiCard label="Mensagens enviadas" value={kpis?.messagesSent ?? 0} icon={Send}
                  color="bg-emerald-50 text-emerald-500 dark:bg-emerald-900/20 dark:text-emerald-400" />
                <KpiCard label="Taxa de resposta" value={`${kpis?.replyRate ?? 0}%`} icon={MessageSquare}
                  color="bg-violet-50 text-violet-500 dark:bg-violet-900/20 dark:text-violet-400" />
                <KpiCard label="Taxa de falha" value={`${kpis?.failureRate ?? 0}%`} icon={AlertCircle}
                  color="bg-rose-50 text-rose-500 dark:bg-rose-900/20 dark:text-rose-400" />
              </>
            )}
          </div>

          {/* Gráficos */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Leads por Origem
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? <ChartSkeleton height={240} /> :
                  byOrigin.length === 0 ? (
                    <div className="flex h-40 items-center justify-center text-sm text-slate-400">Sem dados</div>
                  ) : (
                    <div className="flex items-center gap-4">
                      <ResponsiveContainer width="60%" height={200}>
                        <PieChart>
                          <Pie data={byOrigin} dataKey="total" nameKey="origin"
                            innerRadius={40} outerRadius={80} paddingAngle={2}>
                            {byOrigin.map((_, i) => (
                              <Cell key={i} fill={ANALYTICS_COLORS[i % ANALYTICS_COLORS.length]} />
                            ))}
                          </Pie>
                          <Tooltip formatter={(v: number, name: string) => [v, name]} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="flex-1 space-y-1.5">
                        {byOrigin.slice(0, 6).map((o, i) => (
                          <div key={o.origin} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ANALYTICS_COLORS[i % ANALYTICS_COLORS.length] }} />
                              <span className="truncate text-[11px] text-slate-600 dark:text-slate-300">{o.origin}</span>
                            </div>
                            <span className="shrink-0 text-[11px] font-medium text-slate-700 dark:text-slate-200">
                              {o.percentage}%
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                }
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Leads ao longo do tempo
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? <ChartSkeleton height={240} /> :
                  byDay.length === 0 ? (
                    <div className="flex h-40 items-center justify-center text-sm text-slate-400">Sem dados</div>
                  ) : (
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={byDay}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => (typeof d === "string" ? d.slice(5) : String(d))} />
                        <YAxis tick={{ fontSize: 10 }} width={30} />
                        <Tooltip />
                        <Line type="monotone" dataKey="total" stroke={ANALYTICS_COLORS[0]}
                          strokeWidth={2} dot={false} name="Leads" />
                      </LineChart>
                    </ResponsiveContainer>
                  )
                }
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Taxa de conversão por Campanha
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <ChartSkeleton height={200} /> :
                conversionByCampaign.length === 0 ? (
                  <div className="flex h-32 items-center justify-center text-sm text-slate-400">Sem dados</div>
                ) : (
                  <ResponsiveContainer width="100%" height={Math.max(120, conversionByCampaign.length * 40)}>
                    <BarChart data={conversionByCampaign} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                      <XAxis type="number" unit="%" tick={{ fontSize: 10 }} domain={[0, 100]} />
                      <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                      <Tooltip formatter={(v: number) => [`${v}%`, "Taxa"]} />
                      <Bar dataKey="rate" fill={ANALYTICS_COLORS[0]} radius={[0, 4, 4, 0]} name="Taxa (%)">
                        {conversionByCampaign.map((_, i) => (
                          <Cell key={i} fill={ANALYTICS_COLORS[i % ANALYTICS_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                )
              }
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Mensagens enviadas vs falhas por dia
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? <ChartSkeleton height={200} /> :
                messagesByDay.length === 0 ? (
                  <div className="flex h-32 items-center justify-center text-sm text-slate-400">Sem dados</div>
                ) : (
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={messagesByDay}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(d) => (typeof d === "string" ? d.slice(5) : String(d))} />
                      <YAxis tick={{ fontSize: 10 }} width={30} />
                      <Tooltip />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="sent" stackId="a" fill="#34d399" name="Enviadas" />
                      <Bar dataKey="failed" stackId="a" fill="#f87171" name="Falhas" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )
              }
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
                <TrendingUp className="h-4 w-4 text-slate-400" />
                Top Campanhas
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-4"><ChartSkeleton height={160} /></div>
              ) : topCampaigns.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-slate-400">Sem dados</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-white/5">
                        {["#", "Campanha", "Origem", "Leads", "Enviadas", "Taxa Resp.", "Status"].map((h) => (
                          <th key={h} className="px-4 py-2.5 text-left font-medium text-slate-500 dark:text-slate-400">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50 dark:divide-white/5">
                      {topCampaigns.map((c) => (
                        <tr key={c.campaignId} className="hover:bg-slate-50/50 dark:hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-2.5 font-mono text-slate-400">{c.rank}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-800 dark:text-slate-100 max-w-[160px] truncate">
                            {c.name}
                          </td>
                          <td className="px-4 py-2.5 text-slate-500 dark:text-slate-400">{c.origin}</td>
                          <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">{c.leads}</td>
                          <td className="px-4 py-2.5 text-slate-700 dark:text-slate-200">{c.sent}</td>
                          <td className="px-4 py-2.5 font-medium text-slate-700 dark:text-slate-200">{c.replyRate}%</td>
                          <td className="px-4 py-2.5">
                            <Badge className="border text-[10px] font-medium border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
                              Ativa
                            </Badge>
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t border-slate-200 bg-slate-50/50 dark:border-white/10 dark:bg-white/[0.02] font-medium">
                        <td className="px-4 py-2.5 text-slate-500" colSpan={3}>Total</td>
                        <td className="px-4 py-2.5 text-slate-800 dark:text-slate-100">
                          {topCampaigns.reduce((s, c) => s + c.leads, 0)}
                        </td>
                        <td className="px-4 py-2.5 text-slate-800 dark:text-slate-100">
                          {topCampaigns.reduce((s, c) => s + c.sent, 0)}
                        </td>
                        <td className="px-4 py-2.5" colSpan={2} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTES DE CONFIGURAÇÕES (EMPRESAS)
// ═══════════════════════════════════════════════════════════════════════════════

const EMPTY_COMPANY_FORM = {
  name: "",
  evolution_instance: "",
  webhook_url: "",
  calendly_webhook_secret: "",
  panel_access: false,
  auto_pause_on_reply: false,
  auto_pause_on_calendly: false,
  sending_window_start: "08:00",
  sending_window_end: "18:00",
  sending_days: "1,2,3,4,5",
};

function CompanyForm({
  initial,
  onSave,
  onCancel,
  isLoading,
}: {
  initial: typeof EMPTY_COMPANY_FORM;
  onSave: (v: typeof EMPTY_COMPANY_FORM) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState(initial);
  const set = (k: keyof typeof form, v: unknown) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Nome da empresa *</Label>
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Empresa XYZ"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Instância Evolution API *</Label>
          <Input
            value={form.evolution_instance}
            onChange={(e) => set("evolution_instance", e.target.value)}
            placeholder="minha-instancia"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Webhook URL (respostas)</Label>
          <Input
            value={form.webhook_url}
            onChange={(e) => set("webhook_url", e.target.value)}
            placeholder="https://seu-crm.com/webhook"
            className="h-8 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Secret Calendly (opcional)</Label>
          <Input
            value={form.calendly_webhook_secret}
            onChange={(e) => set("calendly_webhook_secret", e.target.value)}
            placeholder="secret_..."
          />
        </div>
      </div>
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 border-b pb-1">Horários de Disparo</h4>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-slate-500">Dias de Envio</Label>
            <Select value={form.sending_days} onValueChange={(v) => set("sending_days", v)}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Selecione..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1,2,3,4,5" className="text-xs">Segunda a Sexta</SelectItem>
                <SelectItem value="0,1,2,3,4,5,6" className="text-xs">Todos os dias</SelectItem>
                <SelectItem value="1,2,3,4" className="text-xs">Segunda a Quinta</SelectItem>
                <SelectItem value="1" className="text-xs">Somente Segunda</SelectItem>
                <SelectItem value="2" className="text-xs">Somente Terça</SelectItem>
                <SelectItem value="3" className="text-xs">Somente Quarta</SelectItem>
                <SelectItem value="4" className="text-xs">Somente Quinta</SelectItem>
                <SelectItem value="5" className="text-xs">Somente Sexta</SelectItem>
                <SelectItem value="6" className="text-xs">Somente Sábado</SelectItem>
                <SelectItem value="0" className="text-xs">Somente Domingo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">Início</Label>
              <Input type="time" className="h-8 text-xs" value={form.sending_window_start} onChange={(e) => set("sending_window_start", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-slate-500">Término</Label>
              <Input type="time" className="h-8 text-xs" value={form.sending_window_end} onChange={(e) => set("sending_window_end", e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-200 border-b pb-1">Regras de Saída (Proteção)</h4>
        
        <div className="flex items-center justify-between gap-3 bg-amber-50 dark:bg-amber-900/10 p-3 rounded-lg border border-amber-200 dark:border-amber-800">
          <div className="flex flex-col">
            <Label htmlFor="auto-pause" className="text-sm cursor-pointer font-medium text-amber-800 dark:text-amber-400">
              Pausar cadência se o lead responder (Auto-pause)
            </Label>
            <span className="text-[10px] text-amber-700/70 dark:text-amber-500/70">A IA interrompe mensagens programadas para atendimento humano.</span>
          </div>
          <Switch checked={form.auto_pause_on_reply} onCheckedChange={(v) => set("auto_pause_on_reply", v)} id="auto-pause" />
        </div>

        <div className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/40 p-3 rounded-lg border border-slate-200 dark:border-white/10">
          <div className="flex flex-col">
            <Label htmlFor="calendly-pause" className="text-sm cursor-pointer font-medium text-slate-700 dark:text-slate-300">
              Pausar cadência se agendar reunião (Calendly)
            </Label>
            <span className="text-[10px] text-slate-500">Requer o Webhook Secret do Calendly preenchido acima.</span>
          </div>
          <Switch checked={form.auto_pause_on_calendly} onCheckedChange={(v) => set("auto_pause_on_calendly", v)} id="calendly-pause" />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 dark:border-white/5 pt-3">
        <div className="flex flex-col">
          <Label htmlFor="panel-access" className="text-sm cursor-pointer">
            Acesso ao painel de analytics
          </Label>
        </div>
        <Switch checked={form.panel_access} onCheckedChange={(v) => set("panel_access", v)} id="panel-access" />
      </div>
      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isLoading}>
          Cancelar
        </Button>
        <Button
          size="sm"
          onClick={() => onSave(form)}
          disabled={isLoading || !form.name.trim() || !form.evolution_instance.trim()}
        >
          {isLoading ? "Salvando..." : "Salvar"}
        </Button>
      </DialogFooter>
    </div>
  );
}

function ConfigTab() {
  const { selectedClientId } = useOptionalCrmClient();
  const { data: companies = [], isLoading } = useFupCompanies(selectedClientId);
  const createMut = useCreateFupCompany();
  const updateMut = useUpdateFupCompany();
  const archiveMut = useArchiveFupCompany();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FupCompany | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<FupCompany | null>(null);

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (c: FupCompany) => {
    setEditing(c);
    setDialogOpen(true);
  };

  const handleSave = async (form: typeof EMPTY_COMPANY_FORM) => {
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, ...form });
        toast({ title: "Empresa atualizada" });
      } else {
        await createMut.mutateAsync({ ...form, tenant_id: selectedClientId });
        toast({ title: "Empresa criada" });
      }
      setDialogOpen(false);
    } catch (e) {
      toast({
        title: "Erro",
        description: e instanceof Error ? e.message : "Erro desconhecido",
        variant: "destructive",
      });
    }
  };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    try {
      await archiveMut.mutateAsync(archiveTarget.id);
      toast({ title: "Empresa arquivada", description: `"${archiveTarget.name}" foi removida das listagens.` });
    } catch (e) {
      toast({ title: "Erro ao arquivar", description: e instanceof Error ? e.message : "Erro desconhecido", variant: "destructive" });
    } finally {
      setArchiveTarget(null);
    }
  };

  const togglePanelAccess = async (c: FupCompany) => {
    try {
      await updateMut.mutateAsync({ id: c.id, company_id: c.id, panel_access: !c.panel_access });
      toast({ title: `Acesso ${!c.panel_access ? "habilitado" : "desabilitado"}` });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "", variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button size="sm" className="gap-2" onClick={openCreate}>
          <Plus className="h-4 w-4" />
          Nova Empresa
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
          ))}
        </div>
      ) : companies.length === 0 ? (
        <div className="flex h-48 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <Building2 className="h-8 w-8 text-slate-300 dark:text-slate-600" />
          <p className="text-sm text-slate-400">Nenhuma empresa cadastrada ainda.</p>
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {companies.length} empresa{companies.length !== 1 ? "s" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-slate-100 dark:divide-white/5">
              {companies.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                        {c.name}
                      </span>
                      {c.panel_access && (
                        <Badge variant="outline" className="border-indigo-300 text-indigo-700 text-[10px] dark:border-indigo-700 dark:text-indigo-400">
                          Acesso painel
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
                      <span>Instância: <code className="font-mono">{c.evolution_instance}</code></span>
                      <span>{c.activeCampaigns} campanha{c.activeCampaigns !== 1 ? "s" : ""} ativa{c.activeCampaigns !== 1 ? "s" : ""}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => togglePanelAccess(c)}
                      className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
                      title={c.panel_access ? "Desabilitar acesso ao painel" : "Habilitar acesso ao painel"}
                    >
                      {c.panel_access ? (
                        <ToggleRight className="h-5 w-5 text-indigo-500" />
                      ) : (
                        <ToggleLeft className="h-5 w-5" />
                      )}
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                      onClick={() => openEdit(c)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0 text-slate-400 hover:text-red-500 dark:hover:text-red-400"
                      onClick={() => setArchiveTarget(c)}
                      title="Arquivar empresa"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar empresa" : "Nova empresa (WhatsApp)"}</DialogTitle>
          </DialogHeader>
          <CompanyForm
            initial={
              editing
                ? {
                    name: editing.name,
                    evolution_instance: editing.evolution_instance,
                    webhook_url: editing.webhook_url || "",
                    calendly_webhook_secret: "",
                    panel_access: editing.panel_access,
                    auto_pause_on_reply: editing.auto_pause_on_reply || false,
                  }
                : EMPTY_COMPANY_FORM
            }
            onSave={handleSave}
            onCancel={() => setDialogOpen(false)}
            isLoading={createMut.isPending || updateMut.isPending}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => { if (!open) setArchiveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Arquivar empresa?</AlertDialogTitle>
            <AlertDialogDescription>
              A empresa <strong>"{archiveTarget?.name}"</strong> será removida de todos os dropdowns e filtros do sistema.
              Os dados de campanhas, leads e disparos associados são preservados mas ficam inacessíveis pela interface.
              Esta ação não pode ser desfeita pela interface.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleArchive}
              disabled={archiveMut.isPending}
            >
              {archiveMut.isPending ? "Arquivando..." : "Arquivar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TELA PRINCIPAL (DASHBOARD UNIFICADO DE FOLLOW-UP)
// ═══════════════════════════════════════════════════════════════════════════════

export default function FollowupDashboard() {
  const { canAccessInternalPage, currentTenant } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "fila";
  const crmClient = useOptionalCrmClient();
  const selectedCrmClient = crmClient?.selectedClient;

  const allowedTabs = selectedCrmClient?.n8n_settings?.allowed_tabs;
  const isSubTabAllowed = (subTabKey: string) => {
    if (!allowedTabs || !Array.isArray(allowedTabs)) return true;
    
    // Migração de permissões de UI
    if (subTabKey === "journeys") {
      if (allowedTabs.includes("followup:journeys")) return true;
      if (allowedTabs.includes("followup:regras") || allowedTabs.includes("followup:fila")) return true;
    }
    
    return allowedTabs.includes(`followup:${subTabKey}`);
  };

  const followupSubTabs = ["journeys", "metrics", "config"] as const;
  const allowedFollowupSubTabs = followupSubTabs.filter(isSubTabAllowed);

  useEffect(() => {
    if (allowedFollowupSubTabs.length > 0) {
      const isCurrentAllowed = allowedFollowupSubTabs.includes(activeTab as any);
      if (!isCurrentAllowed) {
        setSearchParams({ tab: allowedFollowupSubTabs[0] });
      }
    }
  }, [activeTab, allowedFollowupSubTabs, setSearchParams]);

  const { data: companies = [], isLoading: loadingCompanies } = useFupCompanies();

  // Selected company state shared across all operational tabs
  const [companyId, setCompanyId] = useState("all");

  useEffect(() => {
    // Select first company by default once loaded if none is selected
    if (companies.length > 0 && companyId === "all") {
      setCompanyId(companies[0].id);
    }
  }, [companies, companyId]);

  const setActiveTab = (tab: string) => {
    setSearchParams({ tab });
  };

  if (!canAccessInternalPage("fila-de-followup")) {
    return (
      <PageShell title="Follow-up" subtitle="Acesso restrito">
        <p className="text-sm text-slate-500">Você não tem permissão para acessar o painel de follow-up.</p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Módulo de Follow-up"
      subtitle="Gerenciamento proativo de leads, campanhas, analytics e conexões no mesmo lugar"
      spacing="space-y-6"
    >
      {/* Cabeçalho Unificado de Controle */}
      <Card className="border-indigo-100 bg-indigo-50/20 dark:border-indigo-950 dark:bg-indigo-950/10">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-indigo-500 shrink-0" />
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Selecione o Número do WhatsApp (Empresa) para gerenciar fila, cadências e métricas.
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 max-w-xs w-full sm:w-auto">
              <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 shrink-0">Número do WhatsApp:</Label>
              <Select value={companyId} onValueChange={setCompanyId} disabled={loadingCompanies}>
                <SelectTrigger className="h-8 text-xs bg-white dark:bg-slate-900 border-indigo-100 dark:border-indigo-950">
                  <SelectValue placeholder={loadingCompanies ? "Carregando..." : "Selecionar Empresa"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Todos os Perfis</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs Layout */}
      {allowedFollowupSubTabs.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10 bg-card">
          <p className="text-sm text-slate-400">Você não tem permissão para acessar nenhuma sub-aba do Follow-up.</p>
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="w-full flex justify-start rounded-xl border border-slate-200/80 bg-slate-100/50 p-1 dark:border-white/10 dark:bg-white/[0.02]">
            {isSubTabAllowed("journeys") && (
              <TabsTrigger value="journeys" className="text-xs font-semibold px-4 py-2">
                Jornadas Automatizadas
              </TabsTrigger>
            )}
            {isSubTabAllowed("metrics") && (
              <TabsTrigger value="metrics" className="text-xs font-semibold px-4 py-2">
                Estatísticas
              </TabsTrigger>
            )}
            {isSubTabAllowed("config") && (
              <TabsTrigger value="config" className="text-xs font-semibold px-4 py-2">
                Configuração
              </TabsTrigger>
            )}
          </TabsList>

          {isSubTabAllowed("journeys") && (
            <TabsContent value="journeys" className="space-y-4 outline-none">
              <FollowUpJourneys companyId={companyId} />
            </TabsContent>
          )}

          {isSubTabAllowed("metrics") && (
            <TabsContent value="metrics" className="space-y-4 outline-none">
              <AnalyticsTab companyId={companyId} />
            </TabsContent>
          )}

          {isSubTabAllowed("config") && (
            <TabsContent value="config" className="space-y-4 outline-none">
              <ConfigTab />
            </TabsContent>
          )}
        </Tabs>
      )}
    </PageShell>
  );
}
