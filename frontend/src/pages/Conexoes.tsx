import { Wifi } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { EvolutionChipsPanel } from "@/components/EvolutionChipsPanel";
import { PageShell } from "@/components/PageShell";
import { useLeadClients } from "@/hooks/useLeadClients";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";

export default function Conexoes() {
  const crmClient = useOptionalCrmClient();
  const { data: tenants = [], isLoading } = useLeadClients();
  const effectiveClientId = crmClient?.selectedClientId || "";

  const activeTenant = tenants.find((t) => t.id === effectiveClientId) ?? null;

  return (
    <PageShell
      title="Conexões de WhatsApp"
      subtitle="Monitore os chips de WhatsApp conectados, cotas diárias, estado de aquecimento e pareamento."
      spacing="space-y-4"
      compactHero
    >
      {isLoading && (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-sm text-muted-foreground">
          <Wifi className="h-7 w-7 animate-pulse text-primary" />
          Carregando conexões...
        </div>
      )}

      {!isLoading && !activeTenant && (
        <EmptyState
          title="Selecione uma empresa"
          description="Escolha uma empresa no seletor do topo para ver os chips de WhatsApp vinculados."
        />
      )}

      {!isLoading && activeTenant && (
        <EvolutionChipsPanel tenant={activeTenant} />
      )}
    </PageShell>
  );
}
