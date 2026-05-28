import { useState } from "react";
import {
  Sparkles,
  Phone,
  Megaphone,
  Building2,
  AlertTriangle,
  CheckCheck,
  X,
  Check,
  RefreshCw,
  Filter,
  MessageSquare,
} from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { useFupCompanies } from "@/hooks/useFollowupAdmin";
import {
  useFollowupSuggestions,
  useApproveSuggestion,
  useRejectSuggestion,
  useApproveSuggestionBatch,
  type FollowupSuggestion,
} from "@/hooks/useFollowupSuggestions";

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_TAB_LABELS = {
  pending:  "Pendentes",
  approved: "Aprovadas",
  rejected: "Rejeitadas",
} as const;

// ── SuggestionCard ─────────────────────────────────────────────────────────────

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
          {/* Header */}
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

          {/* Motivo */}
          <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 dark:bg-amber-900/10 dark:border-amber-800">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300">Motivo da sugestão</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">{suggestion.reason}</p>
          </div>

          {/* Template escolhido */}
          {suggestion.templateName && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <span>Template: <span className="font-medium text-slate-700 dark:text-slate-300">{suggestion.templateName}</span></span>
            </div>
          )}

          {/* Mensagem editável */}
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

          {/* Ações */}
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

      {/* Dialogs */}
      <AlertDialog open={approveOpen} onOpenChange={setApproveOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar aprovação</AlertDialogTitle>
            <AlertDialogDescription>
              Um job de followup será enfileirado imediatamente para <strong>{suggestion.leadName || suggestion.phone}</strong>.
              {editedMessage && editedMessage !== (suggestion.suggestedMessage ?? "") && (
                <span> A mensagem editada será usada.</span>
              )}
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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function FollowupSuggestions() {
  const { canAccessInternalPage } = useAuth();
  const { data: companies = [] } = useFupCompanies();

  const [companyId, setCompanyId] = useState("all");
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

  if (!canAccessInternalPage("followup-sugestoes")) {
    return (
      <PageShell title="Sugestões IA" subtitle="Acesso restrito">
        <p className="text-sm text-slate-500">Você não tem permissão para acessar esta página.</p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Sugestões de Follow-up"
      subtitle="O motor proativo analisa leads represados e sugere abordagens para aprovação do operador"
      spacing="space-y-6"
    >
      {/* Info */}
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

      {/* Filtros + Tabs */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300">
              <Filter className="h-4 w-4 text-slate-400" />
              Filtros
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {/* Status tabs */}
          <div className="flex gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800/40">
            {(Object.keys(STATUS_TAB_LABELS) as Array<keyof typeof STATUS_TAB_LABELS>).map((s) => (
              <button
                key={s}
                onClick={() => { setStatusTab(s); setSelected(new Set()); }}
                className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-all ${
                  statusTab === s
                    ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white"
                    : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
                }`}
              >
                {STATUS_TAB_LABELS[s]}
                {s === "pending" && suggestions.length > 0 && statusTab === "pending" && (
                  <span className="ml-1.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                    {suggestions.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Empresa filter */}
          <div className="max-w-xs space-y-1.5">
            <Label className="text-xs text-slate-500 dark:text-slate-400">Empresa</Label>
            <Select value={companyId} onValueChange={setCompanyId}>
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
              : `Nenhuma sugestão ${STATUS_TAB_LABELS[statusTab].toLowerCase()} encontrada.`}
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
    </PageShell>
  );
}
