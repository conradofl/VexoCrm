import React, { useState, useMemo, useEffect } from "react";
import { useGdContracts, useUpdateGdContract, useUploadSignedContract } from "@/hooks/useGdContracts";
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
  ChevronLeft,
  ChevronRight,
  Plus,
  Upload,
  FileCheck,
  ChevronDown,
} from "lucide-react";
import { getStableColor } from "@/lib/stableColor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GenerateContractDialog } from "./GenerateContractDialog";
import { JuridicoSettingsCard } from "./JuridicoSettingsCard";
import { useViewMode } from "@/hooks/useViewMode";
import { ViewModeToggle } from "@/components/ViewModeToggle";
import { RecordView, type RecordCardState, type RecordField } from "@/components/records/RecordView";
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

/** Os campos do cartão fechado — e, na lista, as colunas. O cartão e a linha mostram exatamente estes. */
export const CONTRACT_FIELDS: RecordField<any>[] = [
  { key: "name", label: "Cliente", render: (c) => c.dados?.razao_social || "Sem Razão Social" },
  { key: "status", label: "Estado", render: (c) => (c.signed_file_path ? "Assinado" : getStatusConfig(c.status).label) },
  { key: "origin", label: "Origem", render: (c) => (c.proposal_id ? `Proposta #${c.proposal_id.slice(0, 8)}` : "Avulso") },
  { key: "date", label: "Gerado em", render: (c) => `Gerado em ${format(new Date(c.created_at), "dd/MM/yyyy", { locale: ptBR })}` },
];
const contractField = (key: string) => CONTRACT_FIELDS.find((f) => f.key === key)!;

export function ContractsList({ isVexoCommercial = false }: { isVexoCommercial?: boolean }) {
  const [showArquivados, setShowArquivados] = useState(false);
  const [busca, setBusca] = useState("");
  // Preferência de visualização persiste entre visitas à aba.
  const view = useViewMode("contratos", {
    key: "gd_contratos_view",
    map: (raw) => (raw === "list" ? "list" : raw === "grid" ? "card" : null),
  });
  const [page, setPage] = useState(1);

  const { data: contracts, isLoading, error } = useGdContracts(undefined, showArquivados, isVexoCommercial);
  const updateContract = useUpdateGdContract();
  const uploadSignedContract = useUploadSignedContract();
  const enviarJuridico = useSendContractToJuridico();
  const { getIdToken, clientId } = useAuth();
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadingSignedId, setDownloadingSignedId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [targetUploadContractId, setTargetUploadContractId] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<{ id: string; proposalId?: string | null; dados: any } | null>(null);
  const [creatingStandaloneKey, setCreatingStandaloneKey] = useState<string | null>(null);

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

  // Baixa o arquivo assinado preservando byte a byte o arquivo original do storage.
  const handleDownloadSigned = async (contract: any) => {
    try {
      setDownloadingSignedId(contract.id);
      const token = await getIdToken();
      const res = await fetchApi(`/api/gd/contracts/${contract.id}/signed?client_id=${clientId || ""}`, {
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      });
      if (!res.ok) {
        throw new Error("Não foi possível baixar o contrato assinado.");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = contract.signed_file_name || `contrato-${contract.id}-assinado.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro ao baixar contrato assinado", description: err.message, variant: "destructive" });
    } finally {
      setDownloadingSignedId(null);
    }
  };

  const handleTriggerUpload = (contractId: string) => {
    setTargetUploadContractId(contractId);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const contractId = targetUploadContractId;
    if (!file || !contractId) return;

    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: "Formato inválido", description: "O contrato assinado deve ser um arquivo PDF.", variant: "destructive" });
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast({ title: "Arquivo muito grande", description: "O arquivo excede o limite máximo permitido de 20 MB.", variant: "destructive" });
      return;
    }

    try {
      setUploadingId(contractId);
      await uploadSignedContract.mutateAsync({ contractId, file });
      toast({ title: "Contrato assinado guardado com sucesso!" });
    } catch (err: any) {
      console.error(err);
      toast({ title: "Erro no upload do contrato", description: err.message, variant: "destructive" });
    } finally {
      setUploadingId(null);
      setTargetUploadContractId(null);
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

      <ViewModeToggle view={view} />

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

      <Button
        onClick={() => setCreatingStandaloneKey(crypto.randomUUID())}
        className="bg-purple-650 hover:bg-purple-700 text-white font-bold text-xs h-9 gap-1.5 shrink-0 ml-auto"
      >
        <Plus className="h-4 w-4" />
        Novo contrato
      </Button>
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

  // Cada botão do contrato, separado, para a MESMA ação aparecer onde fizer sentido: no cartão aberto (todos),
  // na linha da lista (só as de uso diário) e na linha aberta (as demais).
  const botoesAssinado = (contract: any, compact = false) => (
    <>
      {/* Botões do contrato assinado (upload, download, substituir) */}
      {contract.signed_file_path ? (
        <>
          <Button
            size="sm"
            className={cn("bg-emerald-600 hover:bg-emerald-500 text-white font-medium", compact ? "" : "w-full")}
            onClick={() => handleDownloadSigned(contract)}
            disabled={downloadingSignedId === contract.id}
          >
            <Download className="h-4 w-4 mr-2" />
            {downloadingSignedId === contract.id ? "Baixando..." : "Baixar contrato assinado"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn("text-emerald-700 border-emerald-300 hover:bg-emerald-50 dark:text-emerald-300 dark:border-emerald-800", compact ? "" : "w-full")}
            onClick={() => handleTriggerUpload(contract.id)}
            disabled={uploadingId === contract.id}
          >
            <Upload className="h-4 w-4 mr-2" />
            {uploadingId === contract.id ? "Enviando..." : "Substituir assinado"}
          </Button>
        </>
      ) : (
        <Button
          size="sm"
          className={cn("bg-emerald-600 hover:bg-emerald-500 text-white font-medium", compact ? "" : "w-full")}
          onClick={() => handleTriggerUpload(contract.id)}
          disabled={uploadingId === contract.id}
        >
          <Upload className="h-4 w-4 mr-2" />
          {uploadingId === contract.id ? "Enviando..." : "Subir contrato assinado"}
        </Button>
      )}

    </>
  );

  const botaoJuridico = (contract: any, compact = false) => (
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
    </>
  );

  const botaoEditar = (contract: any, compact = false) => (
    <>
      <Button
        variant="outline"
        size="sm"
        className={cn("text-slate-700 border-slate-200 hover:bg-slate-50", compact ? "" : "w-full")}
        onClick={() => setEditing({ id: contract.id, proposalId: contract.proposal_id, dados: contract.dados })}
      >
        <Pencil className="h-4 w-4 mr-2" />
        Editar
      </Button>
    </>
  );

  const botaoPdf = (contract: any, compact = false) => (
    <>
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
    </>
  );

  const botaoArquivar = (contract: any, compact = false) => (
    <>
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

  /** Cartão aberto: todas as ações, na ordem de sempre. */
  const acoes = (contract: any, compact = false) => (
    <>
      {botoesAssinado(contract, compact)}
      {botaoJuridico(contract, compact)}
      {botaoEditar(contract, compact)}
      {botaoPdf(contract, compact)}
      {botaoArquivar(contract, compact)}
    </>
  );

  /** Ações de uso diário: ficam na própria linha da lista, sem expandir. */
  const acoesPrincipais = (contract: any, compact = false) => (
    <>
      {botaoPdf(contract, compact)}
      {botaoJuridico(contract, compact)}
    </>
  );

  /** O resto (assinado, editar, arquivar): ao expandir a linha. */
  const acoesSecundarias = (contract: any, compact = false) => (
    <>
      {botoesAssinado(contract, compact)}
      {botaoEditar(contract, compact)}
      {botaoArquivar(contract, compact)}
    </>
  );

  const renderContractDetails = (contract: any, emLista = false) => (
    <>
      <div className="space-y-1.5 text-xs text-muted-foreground bg-muted/40 p-2.5 rounded-lg border border-border/40">
        <p>
          <span className="font-medium text-foreground">CNPJ:</span> {contract.dados?.cnpj || "-"}
        </p>
        <p>
          <span className="font-medium text-foreground">Representante:</span> {contract.dados?.representante || "-"}
        </p>
        <p>
          <span className="font-medium text-foreground">Origem:</span>{" "}
          {contract.proposal_id ? (
            <span className="font-mono text-xs text-indigo-600 dark:text-indigo-400 font-bold">
              Proposta #{contract.proposal_id.slice(0, 8)}
            </span>
          ) : (
            <span className="italic text-muted-foreground">Avulso (sem proposta)</span>
          )}
        </p>

        {contract.signed_file_path && (
          <div className="bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/40 rounded-lg p-2 text-xs text-emerald-900 dark:text-emerald-300 space-y-1 mt-1">
            <div className="flex items-center gap-1.5 font-semibold">
              <FileCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="truncate" title={contract.signed_file_name || "Contrato assinado"}>
                {contract.signed_file_name || "Arquivo assinado"}
              </span>
            </div>
            <div className="text-[10px] text-emerald-700 dark:text-emerald-400">
              Upload: {contract.signed_uploaded_at ? format(new Date(contract.signed_uploaded_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }) : "-"}
            </div>
            <div className="text-[10px] text-emerald-700 dark:text-emerald-400 truncate">
              Por: {contract.signed_uploaded_by || "-"}
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-2 flex-col pt-1">
        {emLista ? acoesSecundarias(contract) : acoes(contract)}
      </div>

    </>
  );

  const renderContractCard = (contract: any, { expanded: isExpanded, toggle }: RecordCardState) => {
    const color = getStableColor(contract.id);
    const statusConfig = getStatusConfig(contract.status);
    const StatusIcon = statusConfig.icon;

    const toggleExpand = (e: React.MouseEvent) => {
      e.stopPropagation();
      toggle();
    };

    const clientName = contractField("name").render(contract) as string;

    return (
      <div
        data-testid={`contract-card-${contract.id}`}
        className={cn(
          "rounded-xl border bg-card text-card-foreground shadow-sm transition-all overflow-hidden flex flex-col justify-between",
          contract.signed_file_path
            ? "border-emerald-300 dark:border-emerald-800/60 ring-1 ring-emerald-500/10"
            : "border-border/70 hover:border-border hover:shadow-xs",
          isExpanded && "ring-1 ring-border shadow-md"
        )}
      >
        <div className="flex items-stretch min-w-0 flex-1">
          {/* Faixa lateral com cor estável */}
          <div
            data-testid={`contract-card-stripe-${contract.id}`}
            className={cn("w-1.5 self-stretch shrink-0 transition-opacity", color.stripe)}
            aria-hidden="true"
          />

          <div className="p-3.5 flex flex-col justify-between flex-1 min-w-0 gap-2">
            {/* Linha 1: ponto de cor, cliente ocupando espaço disponível, seta de abrir encostada à direita */}
            <div
              data-testid={`contract-line-1-${contract.id}`}
              className="flex items-center justify-between gap-2 min-w-0"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  data-testid={`contract-color-dot-${contract.id}`}
                  className={cn("h-2.5 w-2.5 rounded-full shrink-0", color.dot)}
                  title={`Cor: ${color.name}`}
                  aria-hidden="true"
                />
                <p
                  data-field="name"
                  data-testid={`contract-name-${contract.id}`}
                  className="truncate font-display font-semibold text-foreground text-sm min-w-0 flex-1"
                  title={clientName}
                >
                  {clientName}
                </p>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-slate-100 dark:hover:bg-white/5 shrink-0 ml-auto"
                onClick={toggleExpand}
                aria-expanded={isExpanded}
                aria-label={
                  isExpanded
                    ? `Recolher detalhes de ${clientName}`
                    : `Ver detalhes de ${clientName}`
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

            {/* Linha 2: selo de estado primeiro e equivalente de valor/origem lado a lado */}
            <div
              data-testid={`contract-line-2-${contract.id}`}
              className="flex items-center justify-between gap-2 min-w-0"
            >
              <div className="shrink-0">
                {contract.signed_file_path ? (
                  <Badge
                    data-field="status"
                    data-testid={`contract-status-${contract.id}`}
                    className="bg-emerald-600 hover:bg-emerald-600 text-white border-0 flex items-center gap-1 font-semibold text-[10px] shadow-sm"
                  >
                    <FileCheck className="h-3 w-3" />
                    {contractField("status").render(contract)}
                  </Badge>
                ) : (
                  <Badge
                    data-field="status"
                    data-testid={`contract-status-${contract.id}`}
                    className={`${statusConfig.color} border-0 flex items-center gap-1 text-[10px]`}
                  >
                    <StatusIcon className="h-3 w-3" />
                    {contractField("status").render(contract)}
                  </Badge>
                )}
              </div>

              <span
                data-field="origin"
                data-testid={`contract-value-or-origin-${contract.id}`}
                className="text-xs font-mono font-medium text-muted-foreground truncate"
                title={contractField("origin").render(contract) as string}
              >
                {contractField("origin").render(contract)}
              </span>
            </div>

            {/* Linha 3: data de criação à esquerda */}
            <div
              data-testid={`contract-line-3-${contract.id}`}
              className="flex items-center justify-between gap-2 text-xs text-muted-foreground pt-0.5 min-w-0"
            >
              <div className="flex items-center gap-1 min-w-0">
                <span data-field="date" data-testid={`contract-date-${contract.id}`} className="text-[11px]">
                  {contractField("date").render(contract)}
                </span>
              </div>
            </div>

            {/* O resto abre dentro do próprio cartão */}
            {isExpanded && (
              <div
                data-testid={`contract-expanded-content-${contract.id}`}
                className="pt-3 mt-1 border-t border-border/60 space-y-3 animate-in fade-in-50 duration-150"
              >
                {renderContractDetails(contract)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

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
      ) : (
        <RecordView
          mode={view.mode}
          items={pagina}
          getId={(c: any) => c.id}
          fields={CONTRACT_FIELDS}
          stripeClass={(id) => getStableColor(id).stripe}
          testIdPrefix="contract"
          labelOf={(c: any) => contractField("name").render(c) as string}
          cardsTestId="contracts-grid"
          cardsClassName="grid gap-3.5 md:grid-cols-2 lg:grid-cols-3"
          renderCard={renderContractCard}
          renderExpanded={(c: any) => renderContractDetails(c, true)}
          renderRowActions={(c: any) => acoesPrincipais(c, true)}
          rowActionsClassName="w-[20rem]"
        />
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

      {/* Criação de um contrato avulso (do zero, sem proposta) */}
      {creatingStandaloneKey && (
        <GenerateContractDialog
          open={!!creatingStandaloneKey}
          onOpenChange={(o) => { if (!o) setCreatingStandaloneKey(null); }}
          proposalId={null}
          initialData={{}}
          standaloneKey={creatingStandaloneKey}
        />
      )}

      {/* Input de arquivo invisível para subir PDF assinado (ex: gov.br) */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".pdf"
        className="hidden"
      />
    </div>
  );
}
