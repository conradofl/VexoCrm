import React from "react";
import { Sliders, Settings2, Loader2, Database, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useLeads, type LeadRow } from "@/hooks/useLeads";

interface ExtendedLeadRow extends LeadRow {
  perfil_musical?: string | null;
  data_nascimento?: string | null;
  ultima_visita?: string | null;
}

interface SegmentacaoCatalogProps {
  clientId: string;
}

export function SegmentacaoCatalog({ clientId }: SegmentacaoCatalogProps) {
  const { data: leads = [], isLoading, error } = useLeads(clientId === "all" ? "infinie" : clientId);

  const totalLeads = leads.length;

  // Calcular estatísticas com base nos dados reais do banco
  const getStats = (field: "perfil_musical" | "data_nascimento" | "ultima_visita") => {
    if (isLoading || error || totalLeads === 0) return { count: 0, pct: 0 };
    const count = (leads as ExtendedLeadRow[]).filter((l) => l[field] !== null && l[field] !== undefined && l[field] !== "").length;
    const pct = Math.round((count / totalLeads) * 100);
    return { count, pct };
  };

  const segmentationFields = [
    {
      label: "Perfil Musical",
      field: "perfil_musical",
      type: "Categoria (Texto)",
      desc: "Estilos preferidos (ex: Funk, Sertanejo, Eletrônico) mapeados a partir do histórico de ingressos e comportamento do cliente.",
      stats: getStats("perfil_musical")
    },
    {
      label: "Última Visita",
      field: "ultima_visita",
      type: "Data (Date)",
      desc: "Data do último evento frequentado pelo cliente na casa. Usado na régua de inatividade.",
      stats: getStats("ultima_visita")
    },
    {
      label: "Data de Nascimento",
      field: "data_nascimento",
      type: "Data (Date)",
      desc: "Data de nascimento para campanhas automáticas de aniversário.",
      stats: getStats("data_nascimento")
    }
  ];

  return (
    <Card className="border-border bg-card">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle className="text-base flex items-center gap-2">
            <Sliders className="h-4.5 w-4.5 text-pink-400" />
            Catálogo de Campos LivPub
          </CardTitle>
          <CardDescription>
            Filtros e campos mapeados no banco para criação de réguas dinâmicas
          </CardDescription>
        </div>
        {!isLoading && !error && (
          <Badge variant="outline" className="text-xs bg-pink-500/5 text-pink-400 border-pink-500/20 flex gap-1 items-center px-2 py-0.5">
            <Users className="h-3 w-3" />
            {totalLeads} Leads
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Loader2 className="h-8 w-8 text-pink-400 animate-spin mb-2" />
            <span className="text-sm text-muted-foreground">Carregando catálogo...</span>
          </div>
        ) : error ? (
          <div className="border border-red-500/20 bg-red-500/5 p-4 rounded-lg text-center">
            <span className="text-sm text-red-400">Erro ao consultar catálogo no banco.</span>
          </div>
        ) : (
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
                  <p className="text-xs text-muted-foreground leading-relaxed mt-2 mb-3">
                    {field.desc}
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Database className="h-3 w-3" />
                      Preenchimento:
                    </span>
                    <span className="font-medium text-foreground">
                      {field.stats.count} / {totalLeads} ({field.stats.pct}%)
                    </span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-pink-500 h-1.5 rounded-full transition-all duration-500"
                      style={{ width: `${field.stats.pct}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
