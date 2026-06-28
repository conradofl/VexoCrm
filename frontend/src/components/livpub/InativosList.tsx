import React, { useState } from "react";
import { Search, Users, UserMinus, Check, X, Loader2, User, Phone, MessageSquare } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  useFollowupSuggestions,
  useApproveSuggestion,
  useRejectSuggestion
} from "@/hooks/useFollowupSuggestions";
import { toast } from "sonner";

interface InativosListProps {
  companyId: string;
}

export function InativosList({ companyId }: InativosListProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const {
    data: suggestions = [],
    isLoading,
    error
  } = useFollowupSuggestions(companyId === "all" ? undefined : companyId);

  const approveMutation = useApproveSuggestion();
  const rejectMutation = useRejectSuggestion();

  const handleApprove = async (id: string, suggestedMessage: string | null) => {
    try {
      await approveMutation.mutateAsync({ id, message: suggestedMessage ?? undefined });
      toast.success("Abordagem de reativação aprovada com sucesso!");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao aprovar sugestão");
    }
  };

  const handleReject = async (id: string) => {
    try {
      await rejectMutation.mutateAsync(id);
      toast.success("Abordagem de reativação rejeitada.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao rejeitar sugestão");
    }
  };

  // Filtrar apenas clientes inativos e bater com a busca
  const inactiveSuggestions = suggestions.filter((s) => {
    const isInactive = s.reason && s.reason.toLowerCase().includes("inativo");
    if (!isInactive) return false;

    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      (s.leadName && s.leadName.toLowerCase().includes(query)) ||
      (s.phone && s.phone.includes(query)) ||
      (s.suggestedMessage && s.suggestedMessage.toLowerCase().includes(query))
    );
  });

  const isMutating = approveMutation.isPending || rejectMutation.isPending;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-2 border-border bg-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <UserMinus className="h-4.5 w-4.5 text-pink-400" />
              Sugestões de Reativação
            </CardTitle>
            <CardDescription>
              Clientes sem comparecimento nos últimos meses
            </CardDescription>
          </div>
          <Badge variant="secondary" className="bg-pink-500/10 text-pink-300 border border-pink-500/20">
            Ativo
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              placeholder="Buscar cliente inativo por nome ou telefone..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled={isLoading}
            />
          </div>

          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 text-pink-400 animate-spin mb-2" />
              <span className="text-sm text-muted-foreground">Buscando clientes inativos...</span>
            </div>
          ) : error ? (
            <div className="border border-red-500/20 bg-red-500/5 p-4 rounded-lg text-center">
              <span className="text-sm text-red-400">Erro ao carregar dados do servidor.</span>
            </div>
          ) : inactiveSuggestions.length === 0 ? (
            <div className="border border-dashed border-border py-12 rounded-lg text-center flex flex-col items-center justify-center">
              <Users className="h-8 w-8 text-muted-foreground mb-3" />
              <span className="text-sm font-medium text-muted-foreground">Nenhuma sugestão disponível</span>
              <span className="text-xs text-muted-foreground mt-0.5">
                Não há sugestões pendentes de reativação para a empresa selecionada.
              </span>
            </div>
          ) : (
            <div className="space-y-4">
              {inactiveSuggestions.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col md:flex-row md:items-center justify-between border border-border p-4 rounded-lg bg-muted/10 hover:bg-muted/20 transition-colors gap-4"
                >
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-semibold text-foreground">
                        {s.leadName || "Sem Nome"}
                      </span>
                      {s.leadSource && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {s.leadSource}
                        </Badge>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />
                      <span>{s.phone}</span>
                    </div>

                    {s.suggestedMessage && (
                      <div className="bg-muted/30 p-2.5 rounded border border-border/50 mt-1 flex gap-2 items-start">
                        <MessageSquare className="h-3.5 w-3.5 text-pink-400 mt-0.5 shrink-0" />
                        <p className="text-xs text-foreground font-sans leading-relaxed whitespace-pre-line">
                          {s.suggestedMessage}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleReject(s.id)}
                      disabled={isMutating}
                      className="h-8 w-8 p-0 text-red-400 hover:text-red-300 hover:bg-red-500/10"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleApprove(s.id, s.suggestedMessage)}
                      disabled={isMutating}
                      className="bg-pink-500 hover:bg-pink-600 text-white font-medium text-xs h-8 gap-1 px-3"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Aprovar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Esteira 4 — Abordagem de Inativos</CardTitle>
          <CardDescription>Regras de reengajamento</CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-3 leading-relaxed">
          <p>
            • **Métrica de Ausência:** O motor identifica clientes que não visitam a casa há mais de 6 meses (com base na data `ultima_visita`).
          </p>
          <p>
            • **Copy Inteligente:** A IA do Groq redige uma copy personalizada baseada nas preferências do cliente, oferecendo mimos ou informando de novos shows compatíveis.
          </p>
          <p>
            • **Aprovação Manual:** O assessor avalia o rascunho antes de aprovar o disparo.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
