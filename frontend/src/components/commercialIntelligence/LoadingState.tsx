import { Loader2 } from "lucide-react";
import { DashboardPanel } from "@/components/DashboardPanel";

export function LoadingState() {
  return (
    <DashboardPanel
      title="Carregando inteligencia comercial"
      subtitle="Estamos organizando metricas, rankings, distribuicao e insights desta empresa."
      className="p-6"
    >
      <div className="grid gap-3 md:grid-cols-4">
        {["Metricas", "Rankings", "Distribuicao", "Insights"].map((label) => (
          <div key={label} className="rounded-2xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              {label}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">Preparando dados operacionais para uso.</p>
          </div>
        ))}
      </div>
    </DashboardPanel>
  );
}
