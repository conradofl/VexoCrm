// frontend/src/pages/LeadsParados.tsx
// Container da tela dedicada "Aviso de Lead Parado" (Pilar 1: Zero Perdas / Nenhum Lead Esquecido)

import React, { useState, useMemo } from "react";
import { Search, ChevronLeft, ChevronRight, SlidersHorizontal, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LeadsParadosHeader } from "./LeadsParados/LeadsParadosHeader";
import { LeadsParadosTable } from "./LeadsParados/LeadsParadosTable";
import { useStalledLeads, useNotifyStalledLeads, StalledLead } from "@/hooks/useStalledLeads";
import { CreateLeadReminderModal } from "@/components/inbox/CreateLeadReminderModal";
import ApplyFollowupModal from "@/components/followup/ApplyFollowupModal";
import { PageShell } from "@/components/PageShell";
import { API_BASE_URL } from "@/lib/api";
import { toast } from "sonner";

export default function LeadsParados() {
  const { clientId: authClientId, getIdToken } = useAuth();
  const crmClient = useOptionalCrmClient();
  const clientId = crmClient?.selectedClientId || authClientId || "";

  // Filtros da consulta
  const [minDaysSelection, setMinDaysSelection] = useState<string>("default");
  const [stageFilter, setStageFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<number>(0);
  const pageSize = 50;

  // Estado dos modais de 1 clique
  const [selectedLeadForReminder, setSelectedLeadForReminder] = useState<StalledLead | null>(null);
  const [isReminderModalOpen, setIsReminderModalOpen] = useState(false);
  const [selectedLeadForCadence, setSelectedLeadForCadence] = useState<StalledLead | null>(null);
  const [isCadenceModalOpen, setIsCadenceModalOpen] = useState(false);

  // Determina minDays numérico para a API
  const parsedMinDays = minDaysSelection === "default" ? null : parseInt(minDaysSelection, 10);

  // Consulta canônica de leads parados
  const { data, isLoading, refetch, isFetching } = useStalledLeads(clientId, parsedMinDays, {
    limit: pageSize,
    offset: currentPage * pageSize,
    stage: stageFilter !== "all" ? stageFilter : undefined,
  });

  const notifyMutation = useNotifyStalledLeads();

  // Filtragem local de texto (busca rápida por nome ou telefone)
  const filteredLeads = useMemo(() => {
    const list = data?.leads || [];
    if (!searchTerm.trim()) return list;
    const term = searchTerm.toLowerCase().trim();
    return list.filter((lead) => {
      const nome = (lead.nome || "").toLowerCase();
      const tel = (lead.telefone || lead.phone || "").toLowerCase();
      return nome.includes(term) || tel.includes(term);
    });
  }, [data?.leads, searchTerm]);

  // Lead parado há mais tempo
  const maxDaysIdle = useMemo(() => {
    const list = data?.leads || [];
    if (list.length === 0) return 0;
    return Math.max(...list.map((l) => l.days_idle || 0));
  }, [data?.leads]);

  const handleOpenReminder = (lead: StalledLead) => {
    setSelectedLeadForReminder(lead);
    setIsReminderModalOpen(true);
  };

  const handleOpenCadence = (lead: StalledLead) => {
    setSelectedLeadForCadence(lead);
    setIsCadenceModalOpen(true);
  };

  const handleNotifyAll = async () => {
    if (!clientId) return;
    try {
      const res = await notifyMutation.mutateAsync({
        clientId,
        minDays: data?.minDays,
      });
      if (res.inserted > 0) {
        toast.success(`Notificações enviadas! ${res.inserted} novo(s) alerta(s) gerado(s) no sininho.`);
      } else {
        toast.info("Todos os responsáveis já possuem notificações recentes e ativas para estes contatos.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro ao disparar notificações de alerta.");
    }
  };

  const totalCount = data?.count ?? 0;
  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <PageShell
      title="Leads Parados"
      subtitle="Zero perdas e nenhum lead esquecido: monitore contatos sem resposta e base nunca abordada"
    >
      <div className="space-y-6">
        {/* Cabeçalho e Métricas */}
        <LeadsParadosHeader
          count={totalCount}
          stalledCount={data?.stalled_count ?? totalCount}
          neverApproachedCount={data?.never_approached_count ?? 0}
          minDays={data?.minDays ?? 7}
          reactivationEnabled={data?.reactivation_enabled}
          maxDaysIdle={maxDaysIdle}
          onNotifyAll={handleNotifyAll}
          isNotifying={notifyMutation.isPending}
        />

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card/60 border rounded-2xl p-3 shadow-xs">
        <div className="flex items-center gap-2 flex-1">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Buscar por nome ou telefone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-xs rounded-xl bg-background/80"
            />
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            className="h-9 w-9 p-0 rounded-xl"
            title="Atualizar lista"
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Seletor de Dias Mínimos de Inatividade */}
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <Select
              value={minDaysSelection}
              onValueChange={(val) => {
                setMinDaysSelection(val);
                setCurrentPage(0);
              }}
            >
              <SelectTrigger className="h-9 text-xs w-[170px] rounded-xl bg-background/80">
                <SelectValue placeholder="Critério de dias" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="default" className="text-xs">
                  Padrão ({data?.reactivation_stalled_days ?? 7}d configurados)
                </SelectItem>
                <SelectItem value="3" className="text-xs">≥ 3 dias parado</SelectItem>
                <SelectItem value="7" className="text-xs">≥ 7 dias parado</SelectItem>
                <SelectItem value="14" className="text-xs">≥ 14 dias parado</SelectItem>
                <SelectItem value="30" className="text-xs">≥ 30 dias parado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Filtro por Estágio Comercial */}
          <Select
            value={stageFilter}
            onValueChange={(val) => {
              setStageFilter(val);
              setCurrentPage(0);
            }}
          >
            <SelectTrigger className="h-9 text-xs w-[150px] rounded-xl bg-background/80">
              <SelectValue placeholder="Estágio" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all" className="text-xs">Todos os ativos</SelectItem>
              <SelectItem value="open_budget" className="text-xs">Orçamento Aberto</SelectItem>
              <SelectItem value="inquiry" className="text-xs">Primeiro Contato</SelectItem>
              <SelectItem value="cold" className="text-xs">Lead Frio</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Tabela de Leads Parados */}
      <div className="flex-1 min-h-[300px]">
        <LeadsParadosTable
          leads={filteredLeads}
          onOpenReminder={handleOpenReminder}
          onOpenCadence={handleOpenCadence}
          isLoading={isLoading}
        />
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground">
          <span>
            Exibindo {currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, totalCount)} de {totalCount} leads
          </span>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 0}
              onClick={() => setCurrentPage((p) => Math.max(0, p - 1))}
              className="h-8 rounded-xl px-2.5 text-xs"
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              Anterior
            </Button>
            <span className="px-2 font-medium text-foreground">
              {currentPage + 1} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages - 1}
              onClick={() => setCurrentPage((p) => p + 1)}
              className="h-8 rounded-xl px-2.5 text-xs"
            >
              Próxima
              <ChevronRight className="h-3.5 w-3.5 ml-1" />
            </Button>
          </div>
        </div>
      )}

      {/* Modal Reusável de Criação de Lembrete */}
      {selectedLeadForReminder && (
        <CreateLeadReminderModal
          open={isReminderModalOpen}
          onOpenChange={(open) => {
            setIsReminderModalOpen(open);
            if (!open) setSelectedLeadForReminder(null);
          }}
          lead={{
            id: selectedLeadForReminder.id,
            nome: selectedLeadForReminder.nome || "Lead",
            phone: selectedLeadForReminder.telefone || selectedLeadForReminder.phone || "",
          }}
          clientId={clientId}
          initialReminder={null}
        />
      )}

      {/* Modal Reusável de Inscrição em Cadência de Follow-up */}
      {selectedLeadForCadence && (
        <ApplyFollowupModal
          open={isCadenceModalOpen}
          onOpenChange={(open) => {
            setIsCadenceModalOpen(open);
            if (!open) setSelectedLeadForCadence(null);
          }}
          clientId={clientId}
          leads={[
            {
              id: selectedLeadForCadence.id,
              nome: selectedLeadForCadence.nome || "Lead",
              phone: selectedLeadForCadence.telefone || selectedLeadForCadence.phone || "",
              telefone: selectedLeadForCadence.telefone || selectedLeadForCadence.phone || "",
            },
          ]}
          apiBase={API_BASE_URL}
          getToken={getIdToken}
        />
      )}
      </div>
    </PageShell>
  );
}
