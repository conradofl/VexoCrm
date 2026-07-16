import React, { useState, useMemo, useEffect } from "react";
import { useGdContracts, useUpdateGdContract } from "@/hooks/useGdContracts";
import { useAuth } from "@/contexts/AuthContext";
import { fetchApi } from "@/lib/api";
import { toast } from "@/components/ui/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  FileText,
  Download,
  CheckCircle,
  Clock,
  Send,
  Pencil,
  Archive,
  ArchiveRestore,
  Search,
  LayoutGrid,
  List as ListIcon,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GenerateContractDialog } from "./GenerateContractDialog";
import { JuridicoSettingsCard } from "./JuridicoSettingsCard";
import { useSendContractToJuridico } from "@/hooks/useJuridico";

const PAGE_SIZE = 20;

function getStatusConfig(status: string) {
  switch (status) {
    case "rascunho":
      return { label: "Rascunho", color: "bg-amber-100 text-amber-800", icon: Clock };
    case "gerado":
      return { label: "Gerado", color: "bg-purple-100 text-purple-800", icon: FileText };
    case "aguardando_assinatura":
      return { label: "Aguardando Assinatura", color: "bg-blue-100 text-blue-800", icon: Send };
    case "em_revisao_juridico":
      return { label: "No Jurídico", color: "bg-indigo-100 text-indigo-800", icon: Send };
    case "assinado":
      return { label: "Assinado", color: "bg-emerald-100 text-emerald-800", icon: CheckCircle };
    default:
      return { label: status, color: "bg-slate-100 text-slate-800", icon: FileText };
  }
}

export function ContractsList() {
  const [showArquivados, setShowArquivados] = useState(false);
  const [busca, setBusca] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [page, setPage] = useState(1);

  const { data: contracts, isLoading, error } = useGdContracts(undefined, showArquivados);
  const updateContract = useUpdateGdContract();
  const enviarJuridico = useSendContractToJuridico();
  const { getIdToken, clientId } = useAuth();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; proposalId: string; dados: any } | null>(null);

  // Busca e troca de aba voltam para a primeira página.
  useEffect(() => { setPage(1); }, [busca, showArquivados]);

  // Abre o PDF do contrato numa nova aba. O backend remonta o documento a partir
  // do template ativo + dados salvos, então dá para reabrir quantas vezes quiser.
  const handleOpenPdf = async (contractId: string) => {
    try {
      setDownloadingId(contractId);
      const token = await getIdToken();
      const res = await fetchApi(`/api/gd/contracts/${contractId}/pdf?client_id=${clientId || ""}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) throw new Error("Não foi possível gerar o PDF do contrato.");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro ao abrir contrato", description: err.message, variant: "destructive" });
    } finally {
      setDownloadingId(null);
    }
  };

  // Arquivar não apaga: só tira da lista principal (consultável em Arquivados).
  const handleArquivar = (id: string, arquivar: boolean) => {
    updateContract.mutate(
      { id, data: { arquivado: arquivar } as any },
      {
        onSuccess: () => toast({ title: arquivar ? "Contrato arquivado" : "Contrato restaurado" }),
        onError: (err: any) => toast({ title: "Erro", description: err.message, variant: "destructive" }),
      }
    );
  };

  // Busca por razão social, CNPJ, representante ou ID da proposta.
  const filtrados = useMemo(() => {
    const lista = Array.isArray(contracts) ? contracts : [];
    const q = busca.trim().toLowerCase();
    if (!q) return lista;
    return lista.filter((c) => {
      const d = c.dados || ({} as any);
      return [d.razao_social, d.cnpj, d.representante, d.email, c.proposal_id]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [contracts, busca]);

  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pagina = filtrados.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 mb-4">
      <div className="relative flex-1 min-w-[220px]">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por razão social, CNPJ, representante ou proposta..."
          className="pl-8"
        />
      </div>

      <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
        <button
          onClick={() => setShowArquivados(false)}
          className={cn("px-3 py-2 text-xs font-bold transition-colors", !showArquivados ? "bg-purple-650 text-white" : "bg-transparent text-slate-600 dark:text-slate-300")}
        >
          Ativos
        </button>
        <button
          onClick={() => setShowArquivados(true)}
          className={cn("px-3 py-2 text-xs font-bold transition-colors", showArquivados ? "bg-purple-650 text-white" : "bg-transparent text-slate-600 dark:text-slate-300")}
        >
          Arquivados
        </button>
      </div>

      <div className="flex rounded-lg border border-slate-200 dark:border-white/10 overflow-hidden">
        <button
          onClick={() => setView("grid")}
          aria-label="Visualizar em cards"
          className={cn("px-2.5 py-2 transition-colors", view === "grid" ? "bg-purple-650 text-white" : "text-slate-600 dark:text-slate-300")}
        >
          <LayoutGrid className="h-4 w-4" />
        </button>
        <button
          onClick={() => setView("list")}
          aria-label="Visualizar em lista"
          className={cn("px-2.5 py-2 transition-colors", view === "list" ? "bg-purple-650 text-white" : "text-slate-600 dark:text-slate-300")}
        >
          <ListIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-650"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 dark:bg-red-950/20 text-red-650 dark:text-red-400 p-4 rounded-xl">
        Erro ao carregar contratos: {(error as Error).message}
      </div>
    );
  }

  // Envia o PDF para o canal do jurídico no Slack + aviso no WhatsApp.
  const handleEnviarJuridico = (contract: any) => {
    const empresa = contract.dados?.razao_social || "este contrato";
    if (!window.confirm(`Enviar o contrato de "${empresa}" para o jurídico revisar?`)) return;
    enviarJuridico.mutate(contract.id, {
      onSuccess: (r: any) => {
        const wa =
          r?.whatsapp === "sent" ? " WhatsApp avisado." :
          r?.whatsapp === "not_configured" ? " (WhatsApp não configurado)" :
          r?.whatsapp === "error" ? " (falha no aviso por WhatsApp)" : "";
        toast({ title: "Enviado ao jurídico", description: `PDF publicado no Slack.${wa}` });
      },
      onError: (err: any) => toast({ title: "Erro ao enviar", description: err.message, variant: "destructive" }),
    });
  };

  const acoes = (contract: any, compact = false) => (
    <>
      <Button
        size="sm"
        className={cn("bg-indigo-600 hover:bg-indigo-500 text-white", compact ? "" : "w-full")}
        onClick={() => handleEnviarJuridico(contract)}
        disabled={enviarJuridico.isPending}
      >
        <Send className="h-4 w-4 mr-2" />
        {enviarJuridico.isPending ? "Enviando..." : "Enviar ao Jurídico"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={cn("text-slate-700 border-slate-200 hover:bg-slate-50", compact ? "" : "w-full")}
        onClick={() => setEditing({ id: contract.id, proposalId: contract.proposal_id, dados: contract.dados })}
      >
        <Pencil className="h-4 w-4 mr-2" />
        Editar
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={cn("text-purple-650 border-purple-200 hover:bg-purple-50", compact ? "" : "w-full")}
        onClick={() => handleOpenPdf(contract.id)}
        disabled={downloadingId === contract.id}
      >
        <Download className="h-4 w-4 mr-2" />
        {downloadingId === contract.id ? "Gerando..." : "Abrir / Baixar PDF"}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className={cn("text-slate-500 border-slate-200 hover:bg-slate-50", compact ? "" : "w-full")}
        onClick={() => handleArquivar(contract.id, !contract.arquivado)}
      >
        {contract.arquivado ? <ArchiveRestore className="h-4 w-4 mr-2" /> : <Archive className="h-4 w-4 mr-2" />}
        {contract.arquivado ? "Restaurar" : "Arquivar"}
      </Button>
    </>
  );

  return (
    <div>
      <JuridicoSettingsCard />
      {toolbar}

      {pagina.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 text-slate-500 dark:text-slate-400">
          <FileText className="h-12 w-12 mb-4 opacity-50" />
          <h3 className="text-lg font-medium">
            {busca ? "Nenhum contrato encontrado" : showArquivados ? "Nenhum contrato arquivado" : "Nenhum contrato gerado"}
          </h3>
          <p className="text-sm">
            {busca ? "Tente outro termo de busca." : "Os contratos gerados aparecerão aqui."}
          </p>
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {pagina.map((contract) => {
            const statusConfig = getStatusConfig(contract.status);
            const StatusIcon = statusConfig.icon;
            return (
              <Card key={contract.id} className="border-slate-200 dark:border-white/10 flex flex-col">
                <CardHeader className="pb-3">
                  <div className="flex justify-between items-start">
                    <CardTitle className="text-lg truncate pr-2">
                      {contract.dados?.razao_social || "Sem Razão Social"}
                    </CardTitle>
                    <Badge className={`${statusConfig.color} border-0 flex items-center gap-1`}>
                      <StatusIcon className="h-3 w-3" />
                      {statusConfig.label}
                    </Badge>
                  </div>
                  <CardDescription>
                    Gerado em {format(new Date(contract.created_at), "dd 'de' MMMM, yyyy", { locale: ptBR })}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col flex-grow">
                  <div className="space-y-2 text-sm text-slate-600 dark:text-slate-400 mb-4 flex-grow">
                    <p><span className="font-medium text-slate-900 dark:text-slate-100">CNPJ:</span> {contract.dados?.cnpj || "-"}</p>
                    <p><span className="font-medium text-slate-900 dark:text-slate-100">Representante:</span> {contract.dados?.representante || "-"}</p>
                    <p><span className="font-medium text-slate-900 dark:text-slate-100">Proposta ID:</span> <span className="truncate inline-block max-w-[120px] align-bottom">{contract.proposal_id || "-"}</span></p>
                  </div>
                  <div className="flex gap-2 flex-col">{acoes(contract)}</div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 dark:border-white/10 divide-y divide-slate-100 dark:divide-white/5 overflow-hidden">
          {pagina.map((contract) => {
            const statusConfig = getStatusConfig(contract.status);
            const StatusIcon = statusConfig.icon;
            return (
              <div key={contract.id} className="flex flex-wrap items-center gap-3 p-3 bg-white dark:bg-slate-900">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                      {contract.dados?.razao_social || "Sem Razão Social"}
                    </span>
                    <Badge className={`${statusConfig.color} border-0 flex items-center gap-1 shrink-0`}>
                      <StatusIcon className="h-3 w-3" />
                      {statusConfig.label}
                    </Badge>
                  </div>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400">
                    {contract.dados?.cnpj || "sem CNPJ"} · {contract.dados?.representante || "sem representante"} ·{" "}
                    {format(new Date(contract.created_at), "dd/MM/yyyy", { locale: ptBR })}
                  </span>
                </div>
                <div className="flex gap-2 shrink-0">{acoes(contract, true)}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Paginação — 20 por página */}
      {filtrados.length > PAGE_SIZE && (
        <div className="flex items-center justify-between gap-3 mt-4">
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {(pageSafe - 1) * PAGE_SIZE + 1}–{Math.min(pageSafe * PAGE_SIZE, filtrados.length)} de {filtrados.length}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" disabled={pageSafe <= 1} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
              {pageSafe} / {totalPages}
            </span>
            <Button variant="outline" size="sm" disabled={pageSafe >= totalPages} onClick={() => setPage((p) => p + 1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Edição de um contrato já gerado */}
      {editing && (
        <GenerateContractDialog
          open={!!editing}
          onOpenChange={(o) => { if (!o) setEditing(null); }}
          proposalId={editing.proposalId}
          initialData={{}}
          contractId={editing.id}
          initialDados={editing.dados}
        />
      )}
    </div>
  );
}
