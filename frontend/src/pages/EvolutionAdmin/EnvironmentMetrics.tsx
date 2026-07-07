import { Database, KeyRound, ServerCog } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EvolutionInventory } from "@/lib/evolutionAdmin/types";
import { SecretBadge } from "@/lib/evolutionAdmin/SecretBadge";

interface EnvironmentMetricsProps {
  inventory: EvolutionInventory | undefined;
}

export function EnvironmentMetrics({ inventory }: EnvironmentMetricsProps) {
  return (
    <div className="grid gap-3 lg:grid-cols-4">
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <ServerCog className="h-5 w-5 text-cyan-600" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">EVOLUTION_API_URL</p>
            <p className="truncate text-sm font-medium">{inventory?.env.evolutionApiUrl || "Nao configurada"}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <KeyRound className="h-5 w-5 text-emerald-600" />
          <div>
            <p className="text-xs text-muted-foreground">EVOLUTION_API_KEY</p>
            <div className="mt-1"><SecretBadge defined={Boolean(inventory?.env.hasEvolutionApiKey)} /></div>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <Database className="h-5 w-5 text-violet-600" />
          <div>
            <p className="text-xs text-muted-foreground">Instancias no banco</p>
            <p className="text-lg font-semibold">{inventory?.instances.length ?? 0}</p>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <ServerCog className="h-5 w-5 text-amber-600" />
          <div>
            <p className="text-xs text-muted-foreground">Instancias na Evolution</p>
            <p className="text-lg font-semibold">{inventory?.remoteInstances.items.length ?? 0}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
