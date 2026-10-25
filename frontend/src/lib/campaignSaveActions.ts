// O que acontece DEPOIS de salvar uma campanha — salvar não pode disparar.
//
// 20–22/10/2026 (campanha 0d3e7b15, bia-do-spazio): a tela criava um lote novo com o público inteiro a CADA Salvar, na
// criação e na edição; com "Disparar Agora" ele já saía. Seis salvamentos = seis lotes, e o mesmo lead recebeu a
// sequência mais de uma vez. Regra agora:
//  - editar (salvar campanha que já existe): NUNCA cria lote nem dispara;
//  - criar: respeita o botão — "Disparar Agora" cria e dispara; "Agendado" cria agendado; "Rascunho" não cria nada;
//  - recorrente: os lotes nascem das ocorrências, no agendador.

export type CampaignTriggerChoice = "manual" | "scheduled" | "draft";

export interface AfterSavePlan {
  createDispatch: boolean;
  triggerNow: boolean;
}

export function planAfterCampaignSave({
  isEdit,
  isRecurring,
  trigger,
  deliberateDispatch,
}: {
  isEdit: boolean;
  isRecurring: boolean;
  trigger: CampaignTriggerChoice;
  deliberateDispatch?: boolean;
}): AfterSavePlan {
  if (isRecurring || trigger === "draft") return { createDispatch: false, triggerNow: false };
  if (isEdit && !deliberateDispatch) return { createDispatch: false, triggerNow: false };
  if (trigger === "manual" || deliberateDispatch) return { createDispatch: true, triggerNow: true };
  return { createDispatch: true, triggerNow: false };
}

/**
 * Lotes desta campanha que ainda NÃO foram disparados — os únicos que "atualizar para a nova versão" pode tocar.
 * Disparado = já começou (triggered_at), já enviou/falhou alguém, ou está rodando/terminado.
 */
export function pendingDispatchesForUpdate<
  T extends { status: string; triggered_at?: string | null; sent_count?: number | null; failed_count?: number | null }
>(dispatches: T[]): T[] {
  return (dispatches || []).filter(
    (d) =>
      (d.status === "draft" || d.status === "scheduled") &&
      !d.triggered_at &&
      !(Number(d.sent_count) > 0) &&
      !(Number(d.failed_count) > 0)
  );
}
