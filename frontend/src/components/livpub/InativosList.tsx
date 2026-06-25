import React from "react";
import { Users, UserMinus } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export function InativosList() {
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
              Clientes sem comparecimento nos últimos X dias
            </CardDescription>
          </div>
          <Badge variant="secondary" className="bg-pink-500/10 text-pink-300 border border-pink-500/20">
            Semana 4
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border border-dashed border-border py-12 rounded-lg text-center flex flex-col items-center justify-center">
            <Users className="h-8 w-8 text-muted-foreground mb-3 animate-pulse" />
            <span className="text-sm font-medium text-muted-foreground">Nenhuma sugestão disponível</span>
            <span className="text-xs text-muted-foreground mt-0.5">Clientes ausentes serão analisados com base na data da última visita.</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Esteira 4 — Abordagem de Inativos</CardTitle>
          <CardDescription>Regras de reengajamento</CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-3 leading-relaxed">
          <p>
            • **Métrica de Ausência:** Identifica leads onde a data `ultima_visita` é superior ao limite definido pelo administrador (ex: 30, 60 ou 90 dias).
          </p>
          <p>
            • **IA de Abordagem:** O chatbot inicia a conversa de forma sutil, lembrando de eventos marcantes do perfil musical preferido e oferecendo cortesia para o próximo evento.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
