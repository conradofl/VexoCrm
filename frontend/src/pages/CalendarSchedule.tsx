import { PageShell } from "@/components/PageShell";
import FollowupCalendar from "@/components/followup/FollowupCalendar";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";

export default function CalendarSchedule() {
  const crmClient = useOptionalCrmClient();
  const selectedCrmClient = crmClient?.selectedClient;
  const tenantId = crmClient?.selectedClientId || selectedCrmClient?.id || undefined;

  return (
    <PageShell
      title="Calendário de Envios"
      subtitle="Visão unificada de campanhas em massa e cadências de follow-up programadas"
    >
      <div className="w-full max-w-7xl mx-auto space-y-4">
        <FollowupCalendar tenantId={tenantId} />
      </div>
    </PageShell>
  );
}
