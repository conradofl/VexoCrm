// Salvar campanha não dispara: plano depois do salvamento e lotes que podem ser atualizados.
import { describe, it, expect } from "vitest";
import { pendingDispatchesForUpdate, planAfterCampaignSave } from "@/lib/campaignSaveActions";

describe("planAfterCampaignSave — salvar não dispara", () => {
  it("editar campanha (já disparada ou não) não cria lote, qualquer que seja o botão", () => {
    for (const trigger of ["manual", "scheduled", "draft"] as const) {
      expect(planAfterCampaignSave({ isEdit: true, isRecurring: false, trigger })).toEqual({ createDispatch: false, triggerNow: false });
    }
  });
  it("editar campanha com botão deliberado 'Disparar agora' cria exatamente 1 lote e dispara", () => {
    expect(
      planAfterCampaignSave({ isEdit: true, isRecurring: false, trigger: "manual", deliberateDispatch: true })
    ).toEqual({ createDispatch: true, triggerNow: true });
  });
  it("nova + Disparar Agora cria e dispara", () => {
    expect(planAfterCampaignSave({ isEdit: false, isRecurring: false, trigger: "manual" })).toEqual({ createDispatch: true, triggerNow: true });
  });
  it("nova + Agendado cria lote agendado sem disparar", () => {
    expect(planAfterCampaignSave({ isEdit: false, isRecurring: false, trigger: "scheduled" })).toEqual({ createDispatch: true, triggerNow: false });
  });
  it("nova + Rascunho não cria nada", () => {
    expect(planAfterCampaignSave({ isEdit: false, isRecurring: false, trigger: "draft" })).toEqual({ createDispatch: false, triggerNow: false });
  });
  it("recorrente não cria lote no salvamento (o agendador cria as ocorrências)", () => {
    expect(planAfterCampaignSave({ isEdit: false, isRecurring: true, trigger: "manual" }).createDispatch).toBe(false);
  });
});

describe("pendingDispatchesForUpdate — só lote ainda não disparado", () => {
  const base = { triggered_at: null, sent_count: 0, failed_count: 0 };
  it("filtra rascunho/agendado intocados; ignora lote que já enviou, falhou, foi acionado ou terminou", () => {
    const lotes = [
      { ...base, id: "a", status: "scheduled" },
      { ...base, id: "b", status: "draft" },
      { ...base, id: "c", status: "scheduled", triggered_at: "2026-10-22T10:00:00Z" },
      { ...base, id: "d", status: "scheduled", sent_count: 1 },
      { ...base, id: "e", status: "draft", failed_count: 2 },
      { ...base, id: "f", status: "completed" },
      { ...base, id: "g", status: "running" },
    ] as any[];
    expect(pendingDispatchesForUpdate(lotes).map((d) => d.id)).toEqual(["a", "b"]);
  });
});
