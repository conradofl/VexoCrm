import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Eye, Clock, CheckCircle, XCircle, Search, Trash2 } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/contexts/AuthContext";

type BriefingData = {
  id: string;
  prospect_name: string;
  whatsapp_number: string;
  theme_preset: string;
  briefing_data: Record<string, string>;
  status: string;
  slack_status: string;
  created_at: string;
};

export default function GeracaoDigitalBriefings() {
  const { getIdToken } = useAuth();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedBriefing, setSelectedBriefing] = useState<BriefingData | null>(null);

  const { data: briefings = [], isLoading } = useQuery({
    queryKey: ["geracao-digital-briefings"],
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetch("/api/geracao-digital/briefings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Erro ao buscar briefings");
      const json = await res.json();
      return json.data as BriefingData[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getIdToken();
      const res = await fetch(`/api/geracao-digital/briefings/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Erro ao deletar briefing");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["geracao-digital-briefings"] });
    },
    onError: (error) => {
      console.error("Erro ao deletar briefing:", error);
      alert("Não foi possível deletar o briefing.");
    }
  });

  const filteredBriefings = briefings.filter(
    (b) =>
      b.prospect_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (b.whatsapp_number && b.whatsapp_number.includes(searchTerm))
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "success":
        return <Badge className="bg-green-100 text-green-700 hover:bg-green-200 border-green-200"><CheckCircle className="mr-1 h-3 w-3" /> Enviado</Badge>;
      case "pending":
        return <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-200 border-amber-200"><Clock className="mr-1 h-3 w-3" /> Pendente</Badge>;
      default:
        return <Badge variant="destructive" className="bg-red-100 text-red-700 hover:bg-red-200 border-red-200"><XCircle className="mr-1 h-3 w-3" /> Falha</Badge>;
    }
  };

  return (
    <PageShell
      title="Briefings Salvos"
      subtitle="Acompanhe os dossiês comerciais gerados pela Geração Digital."
      compactHero
    >
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-white dark:bg-card p-4 rounded-xl border border-slate-200 dark:border-border shadow-sm">
          <div className="relative w-full sm:max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-slate-50 dark:bg-muted/50 border-slate-200 dark:border-border focus-visible:ring-primary/20"
            />
          </div>
          <div className="text-sm font-medium text-muted-foreground">
            {filteredBriefings.length} {filteredBriefings.length === 1 ? "registro" : "registros"}
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="animate-pulse">
                <CardHeader className="pb-2 h-20 bg-slate-100 dark:bg-muted/50 rounded-t-xl" />
                <CardContent className="h-24 bg-white dark:bg-card rounded-b-xl" />
              </Card>
            ))}
          </div>
        ) : filteredBriefings.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border rounded-xl bg-white dark:bg-card">
            <div className="bg-slate-100 dark:bg-muted/50 p-4 rounded-full mb-4">
              <Search className="h-8 w-8 text-slate-400" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">Nenhum briefing encontrado</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-sm">
              {searchTerm ? "Tente buscar por outro termo." : "Os formulários preenchidos na apresentação aparecerão aqui."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredBriefings.map((briefing) => (
              <Card key={briefing.id} className="overflow-hidden hover:shadow-md transition-shadow group">
                <CardHeader className="pb-3 border-b bg-slate-50/50 dark:bg-muted/20">
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <CardTitle className="text-base font-semibold text-slate-900 dark:text-white line-clamp-1">
                        {briefing.prospect_name}
                      </CardTitle>
                      <div className="text-sm text-slate-500 mt-1 flex items-center gap-2">
                        {briefing.whatsapp_number || "Sem telefone"}
                      </div>
                    </div>
                    {getStatusBadge(briefing.status)}
                  </div>
                </CardHeader>
                <CardContent className="pt-4 space-y-4">
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">Data</span>
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      {format(new Date(briefing.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-slate-500">Tema</span>
                    <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20">
                      {briefing.theme_preset}
                    </Badge>
                  </div>
                  <div className="flex gap-2 mt-2">
                    <Button 
                      variant="outline" 
                      className="flex-1 group-hover:border-primary/50 transition-colors"
                      onClick={() => setSelectedBriefing(briefing)}
                    >
                      <Eye className="h-4 w-4 mr-2 text-slate-400 group-hover:text-primary transition-colors" />
                      Ver Dossiê Completo
                    </Button>
                    <Button
                      variant="outline"
                      className="px-3 text-slate-400 hover:text-red-600 hover:bg-red-50 hover:border-red-200 transition-colors"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Tem certeza que deseja deletar este briefing?")) {
                          deleteMutation.mutate(briefing.id);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!selectedBriefing} onOpenChange={(open) => !open && setSelectedBriefing(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] p-0 overflow-hidden bg-slate-50 dark:bg-slate-900">
          <DialogHeader className="p-6 pb-4 bg-white dark:bg-card border-b sticky top-0 z-10">
            <div className="flex justify-between items-start">
              <div>
                <DialogTitle className="text-xl font-bold">Dossiê: {selectedBriefing?.prospect_name}</DialogTitle>
                <p className="text-sm text-slate-500 mt-1">
                  Enviado em {selectedBriefing && format(new Date(selectedBriefing.created_at), "dd 'de' MMMM 'às' HH:mm", { locale: ptBR })}
                </p>
              </div>
              {selectedBriefing && getStatusBadge(selectedBriefing.status)}
            </div>
          </DialogHeader>
          <ScrollArea className="p-6 h-full max-h-[calc(85vh-100px)]">
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white dark:bg-card p-4 rounded-xl border shadow-sm">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Telefone</div>
                  <div className="font-medium">{selectedBriefing?.whatsapp_number || "Não preenchido"}</div>
                </div>
                <div className="bg-white dark:bg-card p-4 rounded-xl border shadow-sm">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Tema Escolhido</div>
                  <div className="font-medium capitalize">{selectedBriefing?.theme_preset}</div>
                </div>
              </div>

              <div className="bg-white dark:bg-card border rounded-xl shadow-sm overflow-hidden">
                <div className="bg-slate-50 dark:bg-muted/50 px-4 py-3 border-b font-medium text-slate-700 dark:text-slate-200">
                  Respostas do Briefing
                </div>
                <div className="divide-y">
                  {selectedBriefing?.briefing_data && Object.entries(selectedBriefing.briefing_data).map(([key, value]) => (
                    <div key={key} className="p-4 flex flex-col sm:flex-row sm:gap-4 hover:bg-slate-50/50 dark:hover:bg-muted/20 transition-colors">
                      <div className="sm:w-1/3 text-sm font-medium text-slate-500 capitalize">
                        {key.replace(/_/g, " ")}
                      </div>
                      <div className="sm:w-2/3 text-sm text-slate-900 dark:text-slate-100 mt-1 sm:mt-0 whitespace-pre-wrap">
                        {value || <span className="text-slate-400 italic">Não preenchido</span>}
                      </div>
                    </div>
                  ))}
                  {(!selectedBriefing?.briefing_data || Object.keys(selectedBriefing.briefing_data).length === 0) && (
                    <div className="p-8 text-center text-slate-500 italic">
                      Nenhum dado adicional preenchido.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
