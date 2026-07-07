import { useState } from "react";
import {
  CalendarDays,
  Search,
  Check,
  X,
  User,
  Phone,
  MessageSquare,
  Loader2,
  Play,
  Ban,
  Clock
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { useLivpubHistory, usePlaySuggestion, useCancelSuggestion } from "@/hooks/useFollowupAdmin";
import { format, parseISO } from "date-fns";
import ptBR from "date-fns/locale/pt-BR";

export function LivpubHistoryList({ companyId }: { companyId: string }) {
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();
  const { data: history = [], isLoading, error } = useLivpubHistory(companyId);
  const playSuggestion = usePlaySuggestion();
  const cancelSuggestion = useCancelSuggestion();

  const filtered = history.filter((item: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.lead_name?.toLowerCase().includes(q) ||
      item.phone?.includes(q)
    );
  });

  const getStatusBadge = (suggestionStatus: string, jobStatus: string) => {
    if (suggestionStatus === "rejected") {
      return <Badge variant="outline" className="text-slate-500 border-slate-300">Rejeitada</Badge>;
    }
    
    if (jobStatus === "cancelled") {
      return <Badge variant="outline" className="text-slate-500 border-slate-300">Cancelada</Badge>;
    }

    if (jobStatus === "pending") {
      return <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50">Aguardando Envio (Delay)</Badge>;
    }
    
    if (jobStatus === "sent" || jobStatus === "replied") {
      return <Badge variant="outline" className="text-emerald-600 border-emerald-300 bg-emerald-50">Enviada com Sucesso</Badge>;
    }
    
    if (jobStatus === "failed") {
      return <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50">Falhou</Badge>;
    }
    
    return <Badge variant="outline">{jobStatus || suggestionStatus}</Badge>;
  };

  const handlePlay = async (id: string) => {
    try {
      await playSuggestion.mutateAsync(id);
      toast({ title: "Sucesso", description: "Mensagem enviada para disparo imediato!" });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha ao enviar", variant: "destructive" });
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelSuggestion.mutateAsync(id);
      toast({ title: "Sucesso", description: "O disparo foi cancelado com sucesso." });
    } catch (e) {
      toast({ title: "Erro", description: e instanceof Error ? e.message : "Falha ao cancelar", variant: "destructive" });
    }
  };

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-40">
        <Loader2 className="w-8 h-8 animate-spin text-slate-300" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-lg bg-red-50 text-red-600 border border-red-200">
        Falha ao carregar histórico. {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* HEADER / BUSCA */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Buscar por nome ou telefone..."
            className="pl-9 bg-white"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* LISTAGEM */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="text-center p-8 bg-white border border-dashed border-slate-200 rounded-xl">
            <CalendarDays className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 font-medium">Nenhum histórico encontrado</p>
            <p className="text-slate-400 text-sm mt-1">
              As mensagens aprovadas recentemente aparecerão aqui.
            </p>
          </div>
        ) : (
          filtered.map((item: any) => (
            <Card key={item.id} className="shadow-sm">
              <CardContent className="pt-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-slate-400" />
                      <span className="font-semibold text-slate-900">
                        {item.lead_name || "Desconhecido"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Phone className="h-4 w-4" />
                      {item.phone}
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                      <Clock className="h-3 w-3" />
                      Aprovada em {item.approved_at ? format(parseISO(item.approved_at), "dd/MM/yyyy HH:mm", { locale: ptBR }) : "--"}
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-end gap-2">
                    {getStatusBadge(item.suggestion_status, item.job_status)}
                    
                    {item.suggestion_status === "approved" && item.job_status === "pending" && (
                      <div className="flex gap-2 mt-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          className="h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                          onClick={() => handleCancel(item.id)}
                          disabled={cancelSuggestion.isPending}
                        >
                          <Ban className="h-3 w-3 mr-1" /> Cancelar
                        </Button>
                        <Button 
                          size="sm" 
                          className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white"
                          onClick={() => handlePlay(item.id)}
                          disabled={playSuggestion.isPending}
                        >
                          <Play className="h-3 w-3 mr-1" /> Enviar Agora
                        </Button>
                      </div>
                    )}
                  </div>
                </div>

                <div className="bg-slate-50 p-3 rounded-lg flex gap-3 text-sm border border-slate-100">
                  <MessageSquare className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
                  <p className="text-slate-600 leading-relaxed whitespace-pre-wrap">
                    {item.suggested_message}
                  </p>
                </div>
                
                {item.job_status === "failed" && item.error_message && (
                  <div className="text-xs text-red-500 bg-red-50 p-2 rounded border border-red-100">
                    Erro: {item.error_message}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
