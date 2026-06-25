import React from "react";
import { Sliders, Settings2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function SegmentacaoCatalog() {
  const segmentationFields = [
    { label: "Perfil Musical", field: "perfil_musical", type: "Categoria (Texto)", desc: "Estilos preferidos (ex: Funk, Sertanejo, Eletrônico) mapeados a partir do histórico de ingressos e comportamento." },
    { label: "Última Visita", field: "ultima_visita", type: "Data (Date)", desc: "Data do último evento frequentado pelo cliente na casa. Usado na régua de reativação." },
    { label: "Data de Nascimento", field: "data_nascimento", type: "Data (Date)", desc: "Data de nascimento para campanhas automáticas de aniversário." }
  ];

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Sliders className="h-4.5 w-4.5 text-pink-400" />
          Catálogo de Campos LivPub
        </CardTitle>
        <CardDescription>
          Filtros e campos mapeados no banco para criação de réguas dinâmicas
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {segmentationFields.map((field) => (
            <div key={field.field} className="p-4 rounded-lg border border-border bg-muted/20 flex flex-col justify-between space-y-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">{field.label}</span>
                  <Badge variant="secondary" className="text-[10px] bg-pink-500/10 text-pink-300 border border-pink-500/20 px-1.5">{field.type}</Badge>
                </div>
                <code className="text-[10px] text-muted-foreground block font-mono bg-muted/40 px-1.5 py-0.5 rounded w-max mt-1">
                  {field.field}
                </code>
                <p className="text-xs text-muted-foreground leading-relaxed mt-2">
                  {field.desc}
                </p>
              </div>
              <Button variant="outline" size="sm" className="w-full text-xs h-8 border-border text-muted-foreground hover:text-foreground" disabled>
                <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                Ajustar Filtro
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
