import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";

export interface EsteirasStatus {
  esteira1: "aguardando_disparo" | "enviado" | "erro";
  esteira2: "processando_prompts" | "enviado" | "aguardando_vaga";
  esteira5: "aguardando_data" | "cupom_enviado";
}

interface DashboardEsteirasProps {
  esteiras: EsteirasStatus;
}

const getBadgeVariant = (status: string) => {
  switch (status) {
    case "enviado":
    case "cupom_enviado":
      return "default"; // green/success equivalent
    case "erro":
      return "destructive";
    default:
      return "secondary";
  }
};

const formatStatus = (status: string) => {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};

export const DashboardEsteiras: React.FC<DashboardEsteirasProps> = ({ esteiras }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Esteira 1 (Pré-venda)</CardTitle>
          <CardDescription>Avisos de escassez e link de pagamento</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Status:</span>
            <Badge variant={getBadgeVariant(esteiras.esteira1)}>
              {formatStatus(esteiras.esteira1)}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Esteira 2 (VIP)</CardTitle>
          <CardDescription>Abordagem assistida por IA (High-ticket)</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Status:</span>
            <Badge variant={getBadgeVariant(esteiras.esteira2)}>
              {formatStatus(esteiras.esteira2)}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Esteira 5 (Pós-evento)</CardTitle>
          <CardDescription>Agradecimento e envio de cupom</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Status:</span>
            <Badge variant={getBadgeVariant(esteiras.esteira5)}>
              {formatStatus(esteiras.esteira5)}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
