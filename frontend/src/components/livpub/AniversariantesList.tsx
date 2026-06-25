import React, { useState } from "react";
import { Search, Gift, CalendarDays } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export function AniversariantesList() {
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-2 border-border bg-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarDays className="h-4.5 w-4.5 text-pink-400" />
              Aniversariantes do Dia
            </CardTitle>
            <CardDescription>
              Lista de clientes fazendo aniversário hoje
            </CardDescription>
          </div>
          <Badge variant="secondary" className="bg-pink-500/10 text-pink-300 border border-pink-500/20">
            Semana 4
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative">
            <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input 
              placeholder="Buscar aniversariante..." 
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              disabled
            />
          </div>
          <div className="border border-dashed border-border py-12 rounded-lg text-center flex flex-col items-center justify-center">
            <Gift className="h-8 w-8 text-muted-foreground mb-3 animate-pulse" />
            <span className="text-sm font-medium text-muted-foreground">Nenhum aniversariante listado</span>
            <span className="text-xs text-muted-foreground mt-0.5">As sugestões de benefícios automáticas da Esteira 3 aparecerão aqui.</span>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border bg-card">
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Esteira 3 — Benefício Automático</CardTitle>
          <CardDescription>Regras da automação de aniversário</CardDescription>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground space-y-3 leading-relaxed">
          <p>
            • **Rotina Diária:** Um cron job roda às 08:00 buscando clientes cuja data de nascimento é idêntica ao dia atual.
          </p>
          <p>
            • **Validação da Proposta:** Gera sugestões pré-aprovadas contendo cortesia de entrada ou drink especial.
          </p>
          <p>
            • **Disparo:** O assessor revisa a lista e aprova o envio da mensagem personalizada via WhatsApp.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
