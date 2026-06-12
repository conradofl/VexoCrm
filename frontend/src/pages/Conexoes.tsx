import { useState } from "react";
import { Wifi } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { EvolutionChipsPanel } from "@/components/EvolutionChipsPanel";
import { PageShell } from "@/components/PageShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useLeadClients } from "@/hooks/useLeadClients";

export default function Conexoes() {
  const { clientId, isAdminUser } = useAuth();
  const { data: tenants = [], isLoading } = useLeadClients();

  // Admins sem clientId fixo podem selecionar qualquer tenant.
  const [selectedTenantId, setSelectedTenantId] = useState<string>(() => clientId ?? "");
  const showSelector = isAdminUser || !clientId;

  const activeTenant = tenants.find((t) => t.id === selectedTenantId) ?? null;

  return (
    <PageShell
      title="Conexões"
      subtitle="Chips WhatsApp do seu tenant — cota diária, estado e pareamento."
      spacing="space-y-4"
      compactHero
      headerRight={
        showSelector ? (
          <Select value={selectedTenantId} onValueChange={setSelectedTenantId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Selecione um tenant" />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null
      }
    >
      {isLoading && (
        <div className="flex flex-col items-center justify-center gap-4 py-16 text-sm text-muted-foreground">
          <Wifi className="h-7 w-7 animate-pulse text-amber-500" />
          Carregando chips...
        </div>
      )}

      {!isLoading && !activeTenant && (
        <EmptyState
          title={showSelector ? "Selecione um tenant" : "Nenhum tenant associado"}
          description={
            showSelector
              ? "Escolha um tenant no seletor acima para ver os chips vinculados."
              : "Seu perfil nao tem um tenant associado. Fale com o administrador."
          }
        />
      )}

      {!isLoading && activeTenant && (
        <EvolutionChipsPanel tenant={activeTenant} />
      )}
    </PageShell>
  );
}
