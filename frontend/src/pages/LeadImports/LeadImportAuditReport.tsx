import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react";

import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/use-toast";
import { API_BASE_URL } from "@/lib/api";
import { DispatchKpiCards } from "./DispatchKpiCards";

const PAGE_SIZE = 50;

// Vocabulário de status de UMA tentativa de envio (campaign_dispatch_runs),
// diferente do status da CAMPANHA (CampaignStatus, em useCampanhas.ts) —
// misturar os dois é o motivo do enum cru (ex.: "invalid_number") vazar na
// tela: o mapa de campanha não tem essa chave e cai no fallback vazio.
type RunStatus = "pending" | "claimed" | "sent" | "failed" | "skipped" | "invalid_number";

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  pending: "Pendente",
  claimed: "Reivindicado",
  sent: "Enviado",
  failed: "Falhou",
  skipped: "Ignorado",
  invalid_number: "Número inválido",
};

const RUN_STATUS_COLORS: Record<RunStatus, string> = {
  pending: "border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400",
  claimed: "border-sky-300 bg-sky-50 text-sky-600 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-400",
  sent: "border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400",
  failed: "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400",
  skipped: "border-slate-300 bg-slate-50 text-slate-400 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-500",
  invalid_number: "border-rose-300 bg-rose-50 text-rose-600 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-400",
};

// Sub-component for auditing lead imports and creating follow-up cohorts
interface AuditItem {
  lead_import_item_id: string;
  import_id: string;
  telefone: string;
  normalized_data: Record<string, any>;
  imported_at: string;
  row_number: number;
  imported: boolean;
  skip_reason: string | null;
  dispatch_count: number;
  last_sent_at: string | null;
  last_attempt_at: string | null;
  last_status: string | null;
  last_error_message: string | null;
  has_replied: boolean;
  // Um motivo só, já traduzido pelo backend — não importado usa o
  // skip_reason da planilha, disparado-e-falho usa o tradutor de erro.
  // null quando o lead não é uma falha (enviado, pendente, etc).
  failure_reason: string | null;
}

interface LeadImportAuditReportProps {
  activeClientId: string;
  imports: any[];
  onSelectImportForFollowup: (importId: string) => void;
}

export function LeadImportAuditReport({ activeClientId, imports, onSelectImportForFollowup }: LeadImportAuditReportProps) {
  const { getIdToken } = useAuth();
  const [selectedImportId, setSelectedImportId] = useState<string>("");
  const [auditItems, setAuditItems] = useState<AuditItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"all" | "failed" | "replied">("all");
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState("");
  const [creatingSubset, setCreatingSubset] = useState(false);
  const [deletingItems, setDeletingItems] = useState(false);

  // ── Limpeza de estado e seleções ao trocar de empresa (tenant) ───────────
  useEffect(() => {
    setSelectedImportId("");
    setAuditItems([]);
    setSelectedItemIds(new Set());
    setSearchTerm("");
    setActiveFilter("all");
    setSelectedReason(null);
    setPage(1);
  }, [activeClientId]);

  // ── Sincronização de seleção com os imports válidos do tenant atual ──────
  useEffect(() => {
    if (imports.length > 0) {
      if (!selectedImportId || !imports.some((imp) => imp.id === selectedImportId)) {
        setSelectedImportId(imports[0].id);
      }
    } else {
      setSelectedImportId("");
      setAuditItems([]);
    }
  }, [imports, selectedImportId]);

  // ── Carregamento de auditoria protegido com AbortController ──────────────
  // Troca de planilha/campanha: nenhum dado da anterior pode sobrar — motivo
  // selecionado e página voltam ao início ANTES da nova busca terminar, não
  // só depois (senão um clique rápido mostra o filtro velho por um instante).
  useEffect(() => {
    setSelectedReason(null);
    setPage(1);

    if (!selectedImportId || !activeClientId) {
      setAuditItems([]);
      return;
    }

    // Validação estrita: não envia requisição com ID que não pertence ao tenant ativo
    if (imports.length > 0 && !imports.some((imp) => imp.id === selectedImportId)) {
      setAuditItems([]);
      return;
    }

    let isMounted = true;
    const controller = new AbortController();

    async function loadAudit() {
      setLoading(true);
      try {
        const token = await getIdToken();
        if (!token) throw new Error("Usuário não autenticado.");

        const res = await fetch(
          `${API_BASE_URL}/api/campaigns/reports/import-audit?clientId=${encodeURIComponent(activeClientId)}&importId=${encodeURIComponent(selectedImportId)}`,
          {
            headers: { Authorization: `Bearer ${token}` },
            signal: controller.signal,
          }
        );

        if (!res.ok) {
          // Erros 404 e 403 não devem disparar toasts destrutivos de erro genérico
          if (res.status === 404) {
            if (isMounted) setAuditItems([]);
            const isOtherTenantOrDeleted = !imports.some((imp) => imp.id === selectedImportId);
            const msg = isOtherTenantOrDeleted
              ? "Selecione uma planilha desta empresa."
              : "Essa planilha não existe mais.";
            console.warn("[audit-report] 404:", msg, { clientId: activeClientId, importId: selectedImportId });
            return;
          }

          if (res.status === 403) {
            if (isMounted) setAuditItems([]);
            console.warn("[audit-report] 403: Acesso não autorizado.", { clientId: activeClientId, importId: selectedImportId });
            return;
          }

          const contentType = res.headers.get("content-type") || "";
          let errorMsg = "Erro ao carregar auditoria";
          if (contentType.includes("application/json")) {
            const errData = await res.json().catch(() => null);
            if (errData?.error?.message) {
              errorMsg = errData.error.message;
            }
          } else {
            const txt = await res.text().catch(() => "");
            if (txt.trim().startsWith("<!DOCTYPE") || txt.trim().startsWith("<html")) {
              errorMsg = "Resposta HTML inesperada (o servidor backend pode estar em processo de deploy ou a rota não existe).";
            } else if (txt) {
              errorMsg = txt.slice(0, 100);
            }
          }
          throw new Error(errorMsg);
        }

        const data = await res.json();
        if (isMounted) {
          setAuditItems(data.items || []);
          setSelectedItemIds(new Set());
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
          return;
        }
        if (isMounted) {
          toast({
            title: "Erro ao carregar relatório",
            description: err instanceof Error ? err.message : "Erro desconhecido.",
            variant: "destructive",
          });
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    loadAudit();

    return () => {
      isMounted = false;
      controller.abort();
    };
  }, [selectedImportId, activeClientId, imports, getIdToken]);

  const filteredItems = useMemo(() => {
    return auditItems.filter((item) => {
      const name = String(item.normalized_data?.nome || item.normalized_data?.name || "").toLowerCase();
      const phone = String(item.telefone || "").toLowerCase();
      const matchesSearch = name.includes(searchTerm.toLowerCase()) || phone.includes(searchTerm.toLowerCase());
      if (!matchesSearch) return false;
      if (selectedReason && item.failure_reason !== selectedReason) return false;

      switch (activeFilter) {
        case "failed":
          return !!item.failure_reason;
        case "replied":
          return item.has_replied;
        default:
          return true;
      }
    });
  }, [auditItems, activeFilter, searchTerm, selectedReason]);

  // Motivos agrupados — a razão de existir desta tela. Calculado sobre TODOS
  // os leads da campanha selecionada (não sobre a busca de texto), pra não
  // fazer o percentual mudar de significado conforme o que está digitado.
  const reasonGroups = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of auditItems) {
      if (!item.failure_reason) continue;
      counts.set(item.failure_reason, (counts.get(item.failure_reason) || 0) + 1);
    }
    const total = Array.from(counts.values()).reduce((sum, n) => sum + n, 0);
    return Array.from(counts.entries())
      .map(([reason, count]) => ({ reason, count, pct: total > 0 ? Math.round((count / total) * 100) : 0 }))
      .sort((a, b) => b.count - a.count);
  }, [auditItems]);

  const stats = useMemo(() => {
    const total = auditItems.length;
    const failed = reasonGroups.reduce((sum, g) => sum + g.count, 0);
    const replied = auditItems.filter((i) => i.has_replied).length;
    return { total, failed, replied };
  }, [auditItems, reasonGroups]);

  // Paginação só do RENDER da tabela — a seleção em massa e os motivos
  // continuam olhando pra lista filtrada inteira, não só a página visível.
  const totalPages = Math.max(1, Math.ceil(filteredItems.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pagedItems = useMemo(
    () => filteredItems.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filteredItems, safePage]
  );

  // Busca/filtro/motivo mudou o resultado — volta pra página 1, senão a
  // pessoa pode ficar numa página que não existe mais no conjunto novo.
  useEffect(() => {
    setPage(1);
  }, [activeFilter, searchTerm, selectedReason]);

  const handleReasonClick = (reason: string) => {
    setSelectedReason((prev) => (prev === reason ? null : reason));
  };

  const handleToggleSelectAll = () => {
    if (selectedItemIds.size === filteredItems.length) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(filteredItems.map((i) => i.lead_import_item_id)));
    }
  };

  const handleToggleSelectItem = (id: string) => {
    const next = new Set(selectedItemIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedItemIds(next);
  };

  const handleSelectCohort = (type: "all" | "failed" | "replied") => {
    let ids: string[] = [];
    if (type === "all") {
      ids = auditItems.map((i) => i.lead_import_item_id);
    } else if (type === "failed") {
      ids = auditItems.filter((i) => !!i.failure_reason).map((i) => i.lead_import_item_id);
    } else if (type === "replied") {
      ids = auditItems.filter((i) => i.has_replied).map((i) => i.lead_import_item_id);
    }
    setSelectedItemIds(new Set(ids));
  };

  const handleCreateCohortCampaign = async () => {
    if (selectedItemIds.size === 0) {
      toast({ title: "Nenhum lead selecionado", description: "Selecione pelo menos um lead na tabela.", variant: "destructive" });
      return;
    }
    const originalImport = imports.find((i) => i.id === selectedImportId);
    const defaultName = `Follow-up — ${originalImport?.source_name.replace(/\.[^/.]+$/, "") || "Planilha"} (${activeFilter === "replied" ? "Com Retorno" : activeFilter === "failed" ? "Falhas" : "Recampanha"})`;
    const finalCampaignName = prompt("Digite o nome para esta nova base de leads:", defaultName);
    if (!finalCampaignName) return;

    setCreatingSubset(true);
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/reports/create-import-from-subset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientId: activeClientId,
          sourceName: finalCampaignName.trim(),
          leadImportItemIds: Array.from(selectedItemIds),
        }),
      });

      if (!res.ok) throw new Error("Erro ao criar base de recampanha");
      const data = await res.json();

      toast({
        title: "Sucesso!",
        description: `Base "${finalCampaignName}" criada com ${selectedItemIds.size} leads. Redirecionando...`,
      });
      onSelectImportForFollowup(data.item.id);
    } catch (err) {
      toast({
        title: "Erro ao criar recampanha",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setCreatingSubset(false);
    }
  };

  const handleDeleteImportItems = async () => {
    if (selectedItemIds.size === 0) return;
    if (!confirm(`Tem certeza que deseja excluir os ${selectedItemIds.size} leads selecionados desta planilha?`)) return;

    setDeletingItems(true);
    try {
      const token = await getIdToken();
      const res = await fetch(`${API_BASE_URL}/api/campaigns/reports/delete-import-items`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          clientId: activeClientId,
          leadImportItemIds: Array.from(selectedItemIds),
        }),
      });

      if (!res.ok) throw new Error("Erro ao excluir leads");

      toast({
        title: "Sucesso!",
        description: `${selectedItemIds.size} leads foram excluídos com sucesso.`,
      });

      setAuditItems((prev) => prev.filter((item) => !selectedItemIds.has(item.lead_import_item_id)));
      setSelectedItemIds(new Set());
    } catch (err) {
      toast({
        title: "Erro ao excluir leads",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setDeletingItems(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* ── SEÇÃO 1: OS QUATRO CARTÕES DO PERÍODO (campanhas, leads, enviados,
          taxa de entrega) — o Acompanhar Disparos mora só na Fila de Envios,
          isso aqui é só o resumo. ─────────────────────────────────────── */}
      <DispatchKpiCards clientId={activeClientId || null} />

      {/* ── SEÇÃO 2: RESULTADO E DIAGNÓSTICO DA PLANILHA SELECIONADA ────── */}
      <Card className="border-border bg-card text-card-foreground shadow-lg rounded-2xl">
        <CardHeader className="pb-3">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base font-bold">Relatório & Auditoria de Envios</CardTitle>
              <CardDescription>O que aconteceu, e por que falhou — motivos agrupados, com contagem e percentual</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-400">Planilha:</span>
              <Select value={selectedImportId} onValueChange={setSelectedImportId}>
                <SelectTrigger className="h-9 w-56 rounded-xl">
                  <SelectValue placeholder="Selecione a planilha..." />
                </SelectTrigger>
                <SelectContent className="border-border bg-card text-card-foreground shadow-2xl">
                  {imports.map((imp) => (
                    <SelectItem key={imp.id} value={imp.id} className="rounded-md focus:bg-muted dark:focus:bg-white/10">
                      {imp.source_name} ({imp.imported_rows} leads)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {imports.length === 0 ? (
            <div className="p-8">
              <EmptyState title="Nenhuma planilha importada" description="Importe uma planilha na aba Novo Disparo para visualizar os relatórios." />
            </div>
          ) : loading ? (
            <div className="p-12 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
              <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />
              Carregando detalhes do relatório...
            </div>
          ) : (
            <>
              {/* ── Por que falhou — o motivo desta tela existir. Cada linha é
                  clicável e filtra a lista abaixo. ────────────────────────── */}
              {reasonGroups.length > 0 && (
                <div className="bg-slate-50/50 dark:bg-black/20 p-3.5 rounded-2xl border border-slate-200/60 dark:border-white/5 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-foreground flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-rose-500" />
                      Por que falhou
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {stats.failed} de {stats.total} {stats.total === 1 ? "lead" : "leads"} falharam
                    </p>
                  </div>
                  <div className="space-y-1">
                    {reasonGroups.map((g) => (
                      <button
                        key={g.reason}
                        type="button"
                        onClick={() => handleReasonClick(g.reason)}
                        className={cn(
                          "w-full flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-xs transition-colors",
                          selectedReason === g.reason
                            ? "border-rose-300 bg-rose-50 dark:border-rose-800/60 dark:bg-rose-950/20"
                            : "border-transparent bg-white/60 hover:bg-white dark:bg-white/5 dark:hover:bg-white/10"
                        )}
                      >
                        <span className="font-semibold text-foreground truncate">{g.reason}</span>
                        <span className="shrink-0 text-muted-foreground font-mono">
                          {g.count} ({g.pct}%)
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Busca + filtros Todos/Falhas/Com Retorno ────────────────── */}
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-50/20 dark:bg-black/10 p-3.5 rounded-2xl border border-slate-200/60 dark:border-white/5">
                <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
                  <Input
                    placeholder="Buscar lead por nome ou telefone..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-9 text-xs w-full sm:w-64 rounded-xl"
                  />

                  <div className="flex items-center gap-1.5">
                    {([
                      { key: "all", label: "Todos" },
                      { key: "failed", label: "Falhas" },
                      { key: "replied", label: "Com Retorno" },
                    ] as const).map((f) => (
                      <button
                        key={f.key}
                        type="button"
                        onClick={() => setActiveFilter(f.key)}
                        className={cn(
                          "rounded-full px-2.5 py-1 text-[10px] font-bold transition-colors",
                          activeFilter === f.key
                            ? "bg-indigo-600 text-white"
                            : "bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-muted-foreground"
                        )}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-1 sm:mt-0">
                    <span>Selecionar:</span>
                    <button type="button" onClick={() => handleSelectCohort("all")} className="rounded-full bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 px-2 py-0.5">Todos</button>
                    <button type="button" onClick={() => handleSelectCohort("failed")} className="rounded-full bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-950/40 text-rose-600 px-2 py-0.5">Falhas</button>
                    <button type="button" onClick={() => handleSelectCohort("replied")} className="rounded-full bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/20 dark:hover:bg-indigo-950/40 text-indigo-600 px-2 py-0.5">Com Retorno</button>
                  </div>
                </div>

                {selectedItemIds.size > 0 && (
                  <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
                    <Button
                      type="button"
                      onClick={handleDeleteImportItems}
                      disabled={deletingItems || creatingSubset}
                      variant="destructive"
                      className="w-full sm:w-auto h-9 text-xs font-bold gap-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-xl shadow-sm"
                    >
                      {deletingItems ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                      ) : (
                        <Trash2 className="h-3.5 w-3.5 text-white" />
                      )}
                      Excluir Selecionados ({selectedItemIds.size})
                    </Button>
                    <Button
                      type="button"
                      onClick={handleCreateCohortCampaign}
                      disabled={creatingSubset || deletingItems}
                      className="w-full sm:w-auto h-9 text-xs font-bold gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm"
                    >
                      {creatingSubset ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-white" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 text-white" />
                      )}
                      Criar Campanha com Selecionados ({selectedItemIds.size})
                    </Button>
                  </div>
                )}
              </div>

              {filteredItems.length === 0 ? (
                <p className="text-center text-xs text-muted-foreground italic py-6">Nenhum lead correspondente aos filtros atuais.</p>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-border">
                  <Table className="text-xs">
                    <TableHeader className="bg-muted/30 dark:bg-muted/10">
                      <TableRow className="border-slate-200/60 dark:border-white/5">
                        <TableHead className="w-12 text-center h-10 py-0">
                          <input
                            type="checkbox"
                            checked={filteredItems.length > 0 && selectedItemIds.size === filteredItems.length}
                            onChange={handleToggleSelectAll}
                            className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500"
                          />
                        </TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Linha</TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Nome</TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Telefone</TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500 text-center">Último Status</TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500 text-center">Tentativas</TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500 text-center">Retorno?</TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Há quanto tempo</TableHead>
                        <TableHead className="h-10 py-0 font-semibold uppercase text-[10px] tracking-wider text-slate-500">Motivo da Falha / Detalhe</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pagedItems.map((item) => {
                        const isSelected = selectedItemIds.has(item.lead_import_item_id);

                        let timeAgo = "—";
                        if (item.last_attempt_at) {
                          const diffMs = Date.now() - new Date(item.last_attempt_at).getTime();
                          const diffMins = Math.floor(diffMs / 60000);
                          const diffHours = Math.floor(diffMins / 60);
                          const diffDays = Math.floor(diffHours / 24);
                          if (diffMins < 1) timeAgo = "Agora mesmo";
                          else if (diffMins < 60) timeAgo = `${diffMins} min atrás`;
                          else if (diffHours < 24) timeAgo = `${diffHours}h atrás`;
                          else timeAgo = `${diffDays}d atrás`;
                        }

                        return (
                          <TableRow
                            key={item.lead_import_item_id}
                            className={cn(
                              "border-border hover:bg-muted/10",
                              isSelected ? "bg-indigo-50/10 dark:bg-indigo-950/5" : ""
                            )}
                          >
                            <TableCell className="text-center py-2">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleSelectItem(item.lead_import_item_id)}
                                className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500"
                              />
                            </TableCell>
                            <TableCell className="py-2 text-muted-foreground font-mono text-[10px]">
                              {item.row_number}
                            </TableCell>
                            <TableCell className="py-2 font-semibold text-foreground">
                              {item.normalized_data?.nome || item.normalized_data?.name || "Sem nome"}
                            </TableCell>
                            <TableCell className="py-2 font-mono text-[11px]">
                              {item.telefone}
                            </TableCell>
                            <TableCell className="py-2 text-center">
                              {item.last_status && item.last_status in RUN_STATUS_LABELS ? (
                                <Badge className={cn("border text-[9px] font-bold rounded-lg px-2 py-0.25", RUN_STATUS_COLORS[item.last_status as RunStatus])}>
                                  {RUN_STATUS_LABELS[item.last_status as RunStatus]}
                                </Badge>
                              ) : (
                                <span className="text-[10px] text-slate-400">Pendente</span>
                              )}
                            </TableCell>
                            <TableCell className="py-2 text-center font-bold">
                              {item.dispatch_count || 0}
                            </TableCell>
                            <TableCell className="py-2 text-center">
                              {item.has_replied ? (
                                <Badge className="border border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-800/40 dark:bg-indigo-950/20 dark:text-indigo-400 font-bold text-[9px] rounded-lg px-2 py-0.25">
                                  Respondido 💬
                                </Badge>
                              ) : (
                                <span className="text-[10px] text-slate-400">—</span>
                              )}
                            </TableCell>
                            <TableCell className="py-2 text-[10px] text-muted-foreground">
                              {timeAgo}
                            </TableCell>
                            <TableCell className="py-2 text-muted-foreground truncate max-w-[200px]" title={item.failure_reason || ""}>
                              {item.failure_reason ? (
                                <span className="text-rose-500 font-medium flex items-center gap-1.5">
                                  <AlertTriangle className="h-3 w-3 shrink-0" />
                                  {item.failure_reason}
                                </span>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}

              {filteredItems.length > PAGE_SIZE && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-xs text-muted-foreground">
                    Página {safePage} de {totalPages} — {filteredItems.length} leads
                  </span>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0"
                      disabled={safePage <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 w-7 p-0"
                      disabled={safePage >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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
    </div>
  );
}
