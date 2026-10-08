// frontend/src/components/dashboard/StalledLeadsAlertCard.tsx
// Card indicador visual de SLA: "⚠️ X Leads Parados (> 3 dias)" (Pilar 1: Aviso de Lead Parado - Nenhum Lead Esquecido)

import React from "react";
import { useNavigate } from "react-router-dom";
import { Clock, ArrowRight, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useStalledLeads } from "@/hooks/useStalledLeads";
import { cn } from "@/lib/utils";

export interface StalledLeadsAlertCardProps {
  clientId: string;
  minDays?: number;
}

export function StalledLeadsAlertCard({ clientId, minDays = 3 }: StalledLeadsAlertCardProps) {
  const navigate = useNavigate();
  const { data, isLoading } = useStalledLeads(clientId, minDays, { limit: 1 });
  const count = data?.count ?? 0;

  if (isLoading && !data) {
    return (
      <div className="h-16 rounded-2xl border border-border bg-muted/20 animate-pulse" />
    );
  }

  const hasStalled = count > 0;

  return (
    <Card
      data-testid="stalled-leads-alert-card"
      className={cn(
        "rounded-2xl border p-0 shadow-xs transition-all hover:shadow-md",
        hasStalled
          ? "border-amber-500/40 bg-gradient-to-r from-amber-500/[0.08] via-amber-500/[0.03] to-transparent dark:from-amber-950/30 dark:via-zinc-900"
          : "border-emerald-500/30 bg-emerald-500/[0.03] dark:bg-emerald-950/10"
      )}
    >
      <CardContent className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start sm:items-center gap-3.5">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
              hasStalled
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/30"
                : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30"
            )}
          >
            {hasStalled ? <Clock className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm sm:text-base font-bold text-foreground flex items-center gap-1.5">
                <span>⚠️ {count} Leads Parados (&gt; {minDays} dias)</span>
              </h3>
              <Badge
                variant="outline"
                className={cn(
                  "text-[10px] font-semibold px-2 py-0.5",
                  hasStalled
                    ? "bg-amber-500/10 text-amber-700 dark:text-amber-300 border-amber-500/30"
                    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                )}
              >
                {hasStalled ? "Alerta de SLA Comercial" : "SLA 100% em dia"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              Nenhum lead esquecido · Identificação automática de contatos ativos sem resposta
            </p>
          </div>
        </div>

        <Button
          size="sm"
          data-testid="view-stalled-leads-button"
          onClick={() => navigate(`/crm/banco-de-dados?stalled=${minDays}`)}
          className={cn(
            "shrink-0 h-9 gap-2 rounded-xl font-semibold text-xs self-start sm:self-auto",
            hasStalled
              ? "bg-amber-600 hover:bg-amber-700 text-white dark:bg-amber-500 dark:hover:bg-amber-600 dark:text-zinc-950"
              : "variant-outline"
          )}
        >
          <span>Visualizar no Banco de Dados</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}
