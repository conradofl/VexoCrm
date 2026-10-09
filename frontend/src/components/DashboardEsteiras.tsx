import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";

export interface EsteirasStatus {
  esteira1?: "aguardando_disparo" | "enviado" | "erro" | string;
  esteira2?: "processando_prompts" | "enviado" | "aguardando_vaga" | string;
  esteira5?: "aguardando_data" | "cupom_enviado" | string;
  [key: string]: any;
}

interface DashboardEsteirasProps {
  esteiras?: EsteirasStatus;
  compact?: boolean;
}

const getBadgeVariant = (status?: string) => {
  switch (status) {
    case "enviado":
    case "cupom_enviado":
      return "default"; // success
    case "erro":
      return "destructive";
    case "processando_prompts":
      return "secondary";
    default:
      return "outline";
  }
};

const formatStatus = (status?: string) => {
  if (!status) return "Aguardando";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

export const DashboardEsteiras: React.FC<DashboardEsteirasProps> = ({ esteiras = {}, compact = false }) => {
  const e1 = esteiras.esteira1 || "aguardando_disparo";
  const e2 = esteiras.esteira2 || "processando_prompts";
  const e5 = esteiras.esteira5 || "aguardando_data";

  if (compact) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2">
        <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-foreground">Esteira 1 (Pré-venda)</span>
            <Badge variant={getBadgeVariant(e1)} className="text-[9px] h-4 px-1.5">
              {formatStatus(e1)}
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground">D-7 / D-3 / D-1 (Escassez)</p>
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-foreground">Esteira 2 (VIP)</span>
            <Badge variant={getBadgeVariant(e2)} className="text-[9px] h-4 px-1.5">
              {formatStatus(e2)}
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground">Camarotes assistidos por IA</p>
        </div>

        <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5 space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-foreground">Esteira 5 (Pós-evento)</span>
            <Badge variant={getBadgeVariant(e5)} className="text-[9px] h-4 px-1.5">
              {formatStatus(e5)}
            </Badge>
          </div>
          <p className="text-[10px] text-muted-foreground">D+1 (Agradecimento & Cupom)</p>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Esteira 1 (Pré-venda)</CardTitle>
          <CardDescription className="text-xs">Avisos de escassez (D-7, D-3, D-1) e link de compra</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Status:</span>
            <Badge variant={getBadgeVariant(e1)}>
              {formatStatus(e1)}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Esteira 2 (VIP)</CardTitle>
          <CardDescription className="text-xs">Abordagem assistida por IA para camarotes e High-ticket</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Status:</span>
            <Badge variant={getBadgeVariant(e2)}>
              {formatStatus(e2)}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Esteira 5 (Pós-evento)</CardTitle>
          <CardDescription className="text-xs">Agradecimento e envio de cupom de retorno (D+1)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">Status:</span>
            <Badge variant={getBadgeVariant(e5)}>
              {formatStatus(e5)}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
