import { useNavigate } from "react-router-dom";
import { AlertCircle, AlertTriangle, Info, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { ActionAlert } from "@/hooks/useDashboard";

interface Block3ActionAlertsProps {
  alerts: ActionAlert[];
  // Algum aviso não pôde ser avaliado (faltou um número de que ele depende): a lista pode estar incompleta
  incomplete?: boolean;
}

const INCOMPLETE_NOTE = "Não foi possível verificar todos os avisos agora — esta lista pode estar incompleta.";

export function Block3ActionAlerts({ alerts, incomplete = false }: Block3ActionAlertsProps) {
  const navigate = useNavigate();

  // Se o dado não suporta a frase, nenhuma frase/aviso aparece (sem aviso fixo decorativo).
  // Mas se algum aviso não pôde ser avaliado, dizer isso: silêncio aqui pareceria "está tudo bem".
  if (!alerts || alerts.length === 0) {
    if (!incomplete) return null;
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {INCOMPLETE_NOTE}
      </p>
    );
  }

  // No máximo 3 frases
  const visibleAlerts = alerts.slice(0, 3);

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
          O que fazer agora · Ações Recomendadas
        </h2>
        <p className="text-xs text-muted-foreground">
          Recomendações pontuais e diretas derivadas estritamente dos números apurados
        </p>
      </div>

      <div className="grid gap-3">
        {visibleAlerts.map((alert) => {
          const isUrgent = alert.severity === "urgent";
          const isWarning = alert.severity === "warning" || !alert.severity;

          const IconComponent = isUrgent
            ? AlertCircle
            : isWarning
            ? AlertTriangle
            : Info;

          const borderBgClass = isUrgent
            ? "border-red-500/30 bg-red-500/[0.04]"
            : isWarning
            ? "border-amber-500/30 bg-amber-500/[0.04]"
            : "border-blue-500/30 bg-blue-500/[0.04]";

          const iconColorClass = isUrgent
            ? "text-red-600 dark:text-red-400 bg-red-500/10"
            : isWarning
            ? "text-amber-600 dark:text-amber-400 bg-amber-500/10"
            : "text-blue-600 dark:text-blue-400 bg-blue-500/10";

          return (
            <Card
              key={alert.id}
              className={cn(
                "rounded-2xl border p-0 shadow-xs transition-all hover:shadow-md",
                borderBgClass
              )}
            >
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start sm:items-center gap-3">
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                      iconColorClass
                    )}
                  >
                    <IconComponent className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-sm font-bold text-foreground">
                      {alert.text}
                    </p>
                  </div>
                </div>

                <Button
                  size="sm"
                  onClick={() => navigate(alert.actionUrl)}
                  className="shrink-0 h-8 gap-1.5 rounded-xl font-semibold text-xs self-start sm:self-auto"
                  variant={isUrgent ? "destructive" : "default"}
                >
                  <span>{alert.actionLabel}</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {incomplete && (
        <p role="status" className="text-xs text-muted-foreground">
          {INCOMPLETE_NOTE}
        </p>
      )}
    </section>
  );
}
