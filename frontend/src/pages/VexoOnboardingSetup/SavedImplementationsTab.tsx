import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Search,
  FileText,
  MessageCircle,
  Download,
  Trash2,
  Edit3,
  Calendar,
  Building2,
  Users,
  Smartphone,
  CheckCircle2,
  Clock,
  Sparkles,
  RefreshCw,
  Send,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import {
  exportImplementationBriefingToPdf,
  buildImplementationBriefingWhatsAppMessage,
  type ImplementationBriefingExportData,
} from "@/lib/geracaoDigital/implementationBriefingExport";
import { cn } from "@/lib/utils";

interface SavedImplementationsTabProps {
  clientId?: string;
  onSelectBriefing?: (briefing: any) => void;
  onGoToEsteira?: () => void;
}

export function SavedImplementationsTab({
  clientId,
  onSelectBriefing,
  onGoToEsteira,
}: SavedImplementationsTabProps) {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();

  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<"todos" | "em_andamento" | "concluido">("todos");

  // WhatsApp Dialog State
  const [waDialogOpen, setWaDialogOpen] = useState(false);
  const [selectedWaBriefing, setSelectedWaBriefing] = useState<ImplementationBriefingExportData | null>(null);
  const [waPhone, setWaPhone] = useState("");

  // Delete Dialog State
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");

  // Query: Busca briefings salvos
  const {
    data: briefings = [],
    isLoading,
    isRefetching,
    refetch,
  } = useQuery({
    queryKey: ["saved-implementation-briefings", clientId],
    queryFn: async () => {
      const token = await getIdToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const url = clientId
        ? `/api/gd/implementation-briefings?tenant_id=${encodeURIComponent(clientId)}&owner_company=all`
        : `/api/gd/implementation-briefings?owner_company=all`;
      const res = await fetchApi(url, { headers });
      if (!res.ok) {
        throw new Error("Erro ao carregar lista de implantações salvas.");
      }
      const json = await res.json();
      return Array.isArray(json.data) ? json.data : [];
    },
  });

  // Mutation: Excluir Briefing
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getIdToken();
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {};
      const res = await fetchApi(`/api/gd/implementation-briefings/${id}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || "Não foi possível excluir o briefing.");
      }
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["saved-implementation-briefings"] });
      setDeleteConfirmId(null);
    },
  });

  // Filtro client-side
  const filteredBriefings = useMemo(() => {
    return briefings.filter((b: any) => {
      const matchesSearch =
        !searchTerm.trim() ||
        (b.client_name && b.client_name.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (b.tenant_id && b.tenant_id.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (b.segmento && b.segmento.toLowerCase().includes(searchTerm.toLowerCase()));

      const matchesStatus =
        statusFilter === "todos" ||
        (statusFilter === "concluido" && b.status === "concluido") ||
        (statusFilter === "em_andamento" && b.status !== "concluido");

      return matchesSearch && matchesStatus;
    });
  }, [briefings, searchTerm, statusFilter]);

  // Ações
  const handleExportPdf = (briefing: any) => {
    exportImplementationBriefingToPdf(briefing);
  };

  const handleOpenWaModal = (briefing: any) => {
    setSelectedWaBriefing(briefing);
    setWaPhone("");
    setWaDialogOpen(true);
  };

  const handleSendWa = () => {
    if (!selectedWaBriefing) return;
    const cleanNumber = waPhone.replace(/\D/g, "");
    const msg = buildImplementationBriefingWhatsAppMessage(selectedWaBriefing);
    const dest = cleanNumber ? `55${cleanNumber}` : "";
    const url = dest
      ? `https://wa.me/${dest}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
    setWaDialogOpen(false);
  };

  const handleEditLoad = (briefing: any) => {
    if (clientId) {
      try {
        const payload = {
          companyName: briefing.client_name || "",
          segment: briefing.segmento || briefing.prerequisites?.segmento || "",
          operatingHours: briefing.operacao?.horarioComercial || "",
          products: briefing.agente_ia?.precisaSaber || "",
          priceRange: "",
          deliveryTerms: "",
          faq: "",
          forbiddenRules: briefing.agente_ia?.naoPodeInformar || "",
          updatedAt: new Date().toISOString(),
        };
        localStorage.setItem(`vexo_pipeline_${clientId}`, JSON.stringify(payload));
      } catch {
        // Ignora erro de storage
      }
    }
    if (onSelectBriefing) onSelectBriefing(briefing);
    if (onGoToEsteira) onGoToEsteira();
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Controles de Busca e Filtro */}
      <div className="rounded-xl border border-slate-200/80 bg-white dark:bg-card dark:border-border/80 p-5 shadow-xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <FileText className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>📁 Histórico de Implantações Salvas</span>
              <Badge variant="secondary" className="text-xs font-semibold ml-1">
                {filteredBriefings.length} {filteredBriefings.length === 1 ? "registro" : "registros"}
              </Badge>
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Gerencie, exporte em PDF e envie via WhatsApp os briefings técnicos de onboarding da sua operação.
            </p>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isRefetching}
              className="h-8 px-2.5 text-xs text-slate-600 dark:text-slate-300 gap-1.5"
              title="Atualizar lista"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isRefetching && "animate-spin")} />
              <span>Atualizar</span>
            </Button>
            {onGoToEsteira && (
              <Button
                size="sm"
                onClick={onGoToEsteira}
                className="h-8 px-3 text-xs bg-indigo-600 hover:bg-indigo-500 text-white gap-1.5 shadow-xs"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Nova Implantação</span>
              </Button>
            )}
          </div>
        </div>

        {/* Barra de Filtros */}
        <div className="flex flex-col sm:flex-row items-center gap-3 pt-2 border-t border-slate-100 dark:border-border/60">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar por nome da empresa, tenant ou segmento..."
              className="pl-9 h-9 text-xs bg-slate-50/50 dark:bg-slate-900/50 border-slate-200"
            />
          </div>

          <div className="flex items-center gap-1.5 w-full sm:w-auto">
            <Button
              type="button"
              variant={statusFilter === "todos" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("todos")}
              className={cn(
                "h-9 text-xs px-3 font-medium",
                statusFilter === "todos"
                  ? "bg-indigo-600 text-white hover:bg-indigo-500"
                  : "border-slate-200 text-slate-600 dark:text-slate-300"
              )}
            >
              Todos
            </Button>
            <Button
              type="button"
              variant={statusFilter === "concluido" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("concluido")}
              className={cn(
                "h-9 text-xs px-3 font-medium gap-1",
                statusFilter === "concluido"
                  ? "bg-emerald-600 text-white hover:bg-emerald-500"
                  : "border-slate-200 text-slate-600 dark:text-slate-300"
              )}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Concluídos
            </Button>
            <Button
              type="button"
              variant={statusFilter === "em_andamento" ? "default" : "outline"}
              size="sm"
              onClick={() => setStatusFilter("em_andamento")}
              className={cn(
                "h-9 text-xs px-3 font-medium gap-1",
                statusFilter === "em_andamento"
                  ? "bg-amber-600 text-white hover:bg-amber-500"
                  : "border-slate-200 text-slate-600 dark:text-slate-300"
              )}
            >
              <Clock className="w-3.5 h-3.5" />
              Em Andamento
            </Button>
          </div>
        </div>
      </div>

      {/* Listagem de Cards de Implantação */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-44 rounded-xl border border-slate-200/80 bg-white dark:bg-card p-5 animate-pulse"
            />
          ))}
        </div>
      ) : filteredBriefings.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 dark:border-border/80 bg-white dark:bg-card p-12 text-center space-y-3">
          <div className="flex items-center justify-center w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400 mx-auto">
            <FileText className="w-6 h-6" />
          </div>
          <h4 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Nenhuma implantação encontrada
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
            {searchTerm || statusFilter !== "todos"
              ? "Tente ajustar os filtros de busca ou status para encontrar o registro desejado."
              : "Preencha os passos na Esteira Técnica para gerar e salvar o primeiro briefing técnico."}
          </p>
          {onGoToEsteira && (
            <div className="pt-2">
              <Button
                size="sm"
                onClick={onGoToEsteira}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs gap-1.5 shadow-xs"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Ir para a Esteira Técnica
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredBriefings.map((b: any) => {
            const isDone = b.status === "concluido";
            const isAdv = b.model_type === "avancado";
            const dateStr = new Date(b.updated_at || b.created_at || Date.now()).toLocaleDateString("pt-BR");

            return (
              <div
                key={b.id}
                className="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white dark:bg-card dark:border-border/80 p-5 shadow-xs hover:shadow-md hover:border-indigo-300 dark:hover:border-indigo-500/40 transition-all group"
              >
                <div className="space-y-3.5">
                  {/* Header do Card */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block truncate">
                        ID: {b.tenant_id || "Tenant"}
                      </span>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {b.client_name || "Empresa sem nome"}
                      </h4>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] font-semibold py-0",
                          isAdv
                            ? "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300"
                            : "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300"
                        )}
                      >
                        {isAdv ? "Trilha [A]" : "Trilha [E]"}
                      </Badge>
                      <Badge
                        className={cn(
                          "text-[10px] font-semibold py-0",
                          isDone
                            ? "bg-emerald-100/80 text-emerald-800 border-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-400"
                            : "bg-amber-100/80 text-amber-800 border-amber-200 dark:bg-amber-500/10 dark:text-amber-400"
                        )}
                      >
                        {isDone ? "Concluído" : "Em Andamento"}
                      </Badge>
                    </div>
                  </div>

                  {/* Informações Resumidas */}
                  <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600 dark:text-slate-400 py-1 border-y border-slate-100 dark:border-border/50">
                    <div className="flex items-center gap-1.5 truncate">
                      <Users className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{b.num_employees || 1} Atendente(s)</span>
                    </div>
                    <div className="flex items-center gap-1.5 truncate">
                      <Smartphone className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{b.canais?.quantosChips || 1} Chip(s)</span>
                    </div>
                    <div className="flex items-center gap-1.5 truncate">
                      <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{b.segmento || b.prerequisites?.segmento || "Comércio"}</span>
                    </div>
                    <div className="flex items-center gap-1.5 truncate">
                      <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">{dateStr}</span>
                    </div>
                  </div>

                  {/* Indicador de Teste Sandbox */}
                  {b.test_performed_at && (
                    <div className="flex items-center gap-1.5 text-[10px] text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/20 px-2 py-1 rounded-md border border-emerald-200/80 dark:border-emerald-500/20">
                      <CheckCircle2 className="w-3 h-3 shrink-0" />
                      <span>Testado no Simulador ({b.test_questions_count || 1} perguntas)</span>
                    </div>
                  )}
                </div>

                {/* Botões de Ação */}
                <div className="grid grid-cols-4 gap-1.5 pt-4 mt-3 border-t border-slate-100 dark:border-border/50">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleExportPdf(b)}
                    className="h-8 text-xs border-slate-200 hover:bg-slate-50 dark:border-border px-2 gap-1 text-slate-700 dark:text-slate-300"
                    title="Exportar PDF para impressão"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>PDF</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenWaModal(b)}
                    className="h-8 text-xs border-slate-200 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-300 dark:border-border px-2 gap-1 text-slate-700 dark:text-slate-300"
                    title="Enviar briefing via WhatsApp"
                  >
                    <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Whats</span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleEditLoad(b)}
                    className="h-8 text-xs border-slate-200 hover:bg-indigo-50 hover:text-indigo-700 hover:border-indigo-300 dark:border-border px-2 gap-1 text-slate-700 dark:text-slate-300"
                    title="Carregar briefing na esteira para continuar edição"
                  >
                    <Edit3 className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Editar</span>
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setDeleteConfirmId(b.id);
                      setDeleteConfirmName(b.client_name || "esta empresa");
                    }}
                    className="h-8 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:hover:bg-rose-950/20 px-2"
                    title="Excluir implantação"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Enviar Briefing via WhatsApp */}
      <Dialog open={waDialogOpen} onOpenChange={setWaDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold">
              <MessageCircle className="w-5 h-5 text-emerald-600" />
              Enviar Briefing via WhatsApp
            </DialogTitle>
            <DialogDescription className="text-xs">
              Informe o número de WhatsApp com DDD para o qual deseja enviar o resumo estruturado da implantação da{" "}
              <strong>{selectedWaBriefing?.client_name || "empresa"}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Número de WhatsApp (com DDD)
            </label>
            <Input
              value={waPhone}
              onChange={(e) => setWaPhone(e.target.value)}
              placeholder="Ex: 11999998888"
              className="text-xs h-9"
              autoFocus
            />
            <p className="text-[11px] text-slate-500">
              Se deixar vazio, abrirá o seletor do WhatsApp Web para escolher o contato manualmente.
            </p>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setWaDialogOpen(false)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={handleSendWa}
              className="text-xs bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              Abrir WhatsApp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Modal: Confirmar Exclusão */}
      <Dialog open={Boolean(deleteConfirmId)} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-rose-600">
              <AlertTriangle className="w-5 h-5" />
              Excluir Briefing?
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              Tem certeza que deseja excluir o briefing da empresa <strong>{deleteConfirmName}</strong>? Esta ação não pode ser desfeita.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirmId(null)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              disabled={deleteMutation.isPending}
              className="text-xs gap-1.5"
            >
              {deleteMutation.isPending ? "Excluindo..." : "Sim, Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
