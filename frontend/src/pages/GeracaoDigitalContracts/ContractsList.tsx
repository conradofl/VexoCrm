import React from "react";
import { useGdContracts } from "@/hooks/useGdContracts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FileText, Download, CheckCircle, Clock, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ContractsList() {
  const { data: contracts, isLoading, error } = useGdContracts();

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

  if (!contracts || contracts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-12 text-slate-500 dark:text-slate-400">
        <FileText className="h-12 w-12 mb-4 opacity-50" />
        <h3 className="text-lg font-medium">Nenhum contrato gerado</h3>
        <p className="text-sm">Os contratos gerados aparecerão aqui.</p>
      </div>
    );
  }

  const getStatusConfig = (status: string) => {
    switch (status) {
      case "rascunho":
        return { label: "Rascunho", color: "bg-amber-100 text-amber-800", icon: Clock };
      case "aguardando_assinatura":
        return { label: "Aguardando Assinatura", color: "bg-blue-100 text-blue-800", icon: Send };
      case "assinado":
        return { label: "Assinado", color: "bg-emerald-100 text-emerald-800", icon: CheckCircle };
      default:
        return { label: status, color: "bg-slate-100 text-slate-800", icon: FileText };
    }
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.isArray(contracts) ? contracts.map((contract) => {
        const statusConfig = getStatusConfig(contract.status);
        const StatusIcon = statusConfig.icon;

        return (
          <Card key={contract.id} className="border-slate-200 dark:border-white/10 flex flex-col">
            <CardHeader className="pb-3">
              <div className="flex justify-between items-start">
                <CardTitle className="text-lg truncate pr-2">
                  {contract.dados.razao_social || "Sem Razão Social"}
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
                <p><span className="font-medium text-slate-900 dark:text-slate-100">CNPJ:</span> {contract.dados.cnpj || "-"}</p>
                <p><span className="font-medium text-slate-900 dark:text-slate-100">Representante:</span> {contract.dados.representante || "-"}</p>
                <p><span className="font-medium text-slate-900 dark:text-slate-100">Proposta ID:</span> <span className="truncate inline-block max-w-[120px] align-bottom">{contract.proposal_id || "-"}</span></p>
              </div>

              <div className="flex gap-2 flex-col">
                {contract.sign_url && (
                  <Button 
                    variant="default" 
                    size="sm" 
                    className="w-full bg-purple-650 hover:bg-purple-700"
                    onClick={() => {
                      navigator.clipboard.writeText(contract.sign_url);
                      alert("Link de assinatura copiado para a área de transferência!");
                    }}
                  >
                    <Send className="h-4 w-4 mr-2" />
                    Copiar Link p/ Cliente
                  </Button>
                )}
                
                {/* Fallback para baixar (regeramos on the fly porque não salvamos o arquivo fisicamente. A API retorna erro de "cabeçalho JSON"? Não, adaptamos o generateContractPdf para json) */}
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="w-full text-purple-650 border-purple-200 hover:bg-purple-50"
                  onClick={() => alert('A geração local direta foi substituída pelo envio à plataforma de assinaturas.')}
                  disabled
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download PDF Local Indisponível
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      }) : null}
    </div>
  );
}
