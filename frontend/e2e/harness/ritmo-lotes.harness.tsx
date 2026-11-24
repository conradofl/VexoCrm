// Harness do "Enviar em lotes" com máximo por dia (Tinge, 23/11/2026: 100 leads, 5 por hora, 50 por dia), para abrir
// em Chromium de verdade: a etapa REAL de agendamento do Novo Disparo. O servidor é de mentira (Playwright).
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/index.css";
import { SchedulingStep } from "@/pages/LeadImports/SchedulingStep";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const nada = () => {};

function Pagina() {
  const [batchingEnabled, setBatchingEnabled] = useState(true);
  const [batchSize, setBatchSize] = useState("5");
  const [batchIntervalHours, setBatchIntervalHours] = useState("1");
  const [batchMaxPerDay, setBatchMaxPerDay] = useState("50");
  const props: any = {
    selectedLeadClient: { id: "tinge-brasil", name: "Tinge Brasil", n8n_settings: {} },
    evolutionInstances: [{ id: "chip-1", name: "Chip disparo - Fixo", connection_state: "open", active: true }],
    evolutionInstanceOptions: [{ id: "chip-1", name: "Chip disparo - Fixo", connection_state: "open", active: true }],
    campaignSequence: [{ id: "s1", type: "text", order: 1, text: "Olá!" }],
    dispatchOptions: { evolutionInstanceId: "chip-1", dispatchChipIds: ["chip-1"] },
    setDispatchOptions: nada,
    newTriggerType: "manual", setNewTriggerType: nada, newScheduledAt: "", setNewScheduledAt: nada,
    batchingEnabled, setBatchingEnabled, batchSize, setBatchSize, batchIntervalHours, setBatchIntervalHours,
    batchMaxPerDay, setBatchMaxPerDay,
    dispatchCapText: "", setDispatchCapText: nada,
    isRecurring: false, setIsRecurring: nada, recurrencePattern: "monthly", setRecurrencePattern: nada,
    recurrenceDayOfMonth: 15, setRecurrenceDayOfMonth: nada, recurrenceDayOfWeek: 2, setRecurrenceDayOfWeek: nada,
    recurrenceTime: "09:00", setRecurrenceTime: nada, recurrenceEndType: null, setRecurrenceEndType: nada,
    recurrenceEndsOn: "", setRecurrenceEndsOn: nada, recurrenceMaxOccurrences: 12, setRecurrenceMaxOccurrences: nada,
    recurrenceNoEndConfirmed: false, setRecurrenceNoEndConfirmed: nada, recurrenceOverrunConfirmed: false,
    setRecurrenceOverrunConfirmed: nada, recurrencePreviewInput: null,
    replyAgent: "atendimento", setReplyAgent: nada, campaignAgentPrompt: "", setCampaignAgentPrompt: nada,
    onSubmit: nada, onDispatchNow: nada, onSaveAndDispatchNow: nada, alreadyReceivedCount: 0, isWithoutSource: false,
    isSubmitting: false, editingCampaignId: null, onCancelEdit: nada, onNovaCampanha: nada, totalLeads: 100,
  };
  return (
    <main className="p-3 sm:p-6">
      <SchedulingStep {...props} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <Pagina />
  </QueryClientProvider>
);
