import { Bot } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";

export default function Agente() {
  return (
    <PageShell
      title="Agente"
      subtitle="Modulo legado removido do CRM"
      spacing="space-y-4"
    >
      <EmptyState
        icon={Bot}
        title="Modulo removido"
        description="As telas e automacoes de notificacoes, n8n_error_logs e lead_conversations foram descontinuadas."
      />
    </PageShell>
  );
}
