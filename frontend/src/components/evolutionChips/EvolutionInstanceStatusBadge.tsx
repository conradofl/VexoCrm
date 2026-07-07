import { Badge } from "@/components/ui/badge";
import { useLeadClientEvolutionInstanceStatus } from "@/hooks/useLeadClients";

export function EvolutionInstanceStatusBadge({ tenantId, instanceId }: { tenantId: string; instanceId: string }) {
  const { data, isLoading } = useLeadClientEvolutionInstanceStatus(tenantId, instanceId);

  if (isLoading) return <Badge variant="outline" className="text-[10px] rounded-xl">Status...</Badge>;
  if (!data) return null;

  return (
    <>
      <Badge variant={data.connected ? "default" : "destructive"} className="text-[10px] rounded-xl">
        {data.connected ? "Conectado" : "Desconectado"}
      </Badge>
      {data.ownerJid && (
        <Badge variant="outline" className="text-[10px] rounded-xl font-mono text-muted-foreground bg-white/50 dark:bg-black/20">
          +{data.ownerJid.split('@')[0]}
        </Badge>
      )}
      {data.profileName && (
        <Badge variant="outline" className="text-[10px] rounded-xl text-muted-foreground bg-white/50 dark:bg-black/20">
          {data.profileName}
        </Badge>
      )}
    </>
  );
}
