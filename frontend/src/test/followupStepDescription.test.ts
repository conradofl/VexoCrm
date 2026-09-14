import { describe, it, expect } from "vitest";
import {
  describeStep,
  getStepPreview,
  requiresTargetDate,
  isTimeOutsideSendWindow,
} from "@/lib/followup/describeStep";

describe("describeStep", () => {
  it("descreve '3 dias antes do aniversário, às 09:00'", () => {
    const text = describeStep({
      trigger_type: "before_anchor",
      trigger_value: 3,
      trigger_unit: "days",
      anchor_field: "data_nascimento",
      scheduled_time: "09:00",
    });
    expect(text).toBe("3 dias antes do aniversário, às 09:00");
  });

  it("descreve '2 dias depois da inscrição, às 14:30'", () => {
    const text = describeStep({
      trigger_type: "after_enrollment",
      trigger_value: 2,
      trigger_unit: "days",
      scheduled_time: "14:30",
    });
    expect(text).toBe("2 dias depois da inscrição, às 14:30");
  });

  it("descreve '1 hora depois da data-alvo' (singular e sem hora fixa)", () => {
    const text = describeStep({
      trigger_type: "after_meeting",
      trigger_value: 1,
      trigger_unit: "hours",
    });
    expect(text).toBe("1 hora depois da data-alvo");
  });

  it("descreve passo imediato na inscrição", () => {
    expect(describeStep({ trigger_type: "on_schedule" })).toBe("na hora da inscrição (imediato)");
    expect(
      describeStep({ trigger_type: "on_schedule", scheduled_time: "10:00" })
    ).toBe("no dia da inscrição, às 10:00");
  });

  it("descreve âncora com whitelist dinâmica do backend", () => {
    const text = describeStep(
      {
        trigger_type: "after_anchor",
        trigger_value: 5,
        trigger_unit: "days",
        anchor_field: "vencimento_fatura",
        scheduled_time: "08:30",
      },
      [
        {
          key: "vencimento_fatura",
          label: "Vencimento da Fatura",
          source: "lead",
          recurring: false,
        },
      ]
    );
    expect(text).toBe("5 dias depois de vencimento da fatura, às 08:30");
  });
});

describe("requiresTargetDate", () => {
  it("exige data apenas para reunião (before_meeting / after_meeting)", () => {
    expect(requiresTargetDate({ trigger_type: "before_meeting" })).toBe(true);
    expect(requiresTargetDate({ trigger_type: "after_meeting" })).toBe(true);
    expect(requiresTargetDate({ trigger_type: "before_anchor" })).toBe(false);
    expect(requiresTargetDate({ trigger_type: "after_anchor" })).toBe(false);
    expect(requiresTargetDate({ trigger_type: "after_enrollment" })).toBe(false);
    expect(requiresTargetDate({ trigger_type: "no_reply" })).toBe(false);
    expect(requiresTargetDate({ trigger_type: "on_schedule" })).toBe(false);
  });
});

describe("getStepPreview", () => {
  it("passo de âncora de aniversário é válido sem exigir data-alvo", () => {
    const preview = getStepPreview({
      trigger_type: "before_anchor",
      trigger_value: 3,
      trigger_unit: "days",
      anchor_field: "data_nascimento",
      scheduled_time: "09:00",
    });
    expect(preview.type).toBe("valid");
    expect(preview.badge).toBe("Automático");
    expect(preview.message).toContain("aniversário do lead");
    expect(preview.message).toContain("09:00");
    expect(preview.message).toContain("cadastro do lead");
  });

  it("passo de reunião exige data-alvo quando ausente", () => {
    const preview = getStepPreview({
      trigger_type: "before_meeting",
      trigger_value: 1,
      trigger_unit: "days",
    });
    expect(preview.type).toBe("warning_no_date");
    expect(preview.badge).toBe("Sem data-alvo");
  });

  it("cadência só de aniversário aplica sem data-alvo (hasOnlySkippedSteps é falso)", () => {
    const birthdaySteps = [
      {
        trigger_type: "before_anchor",
        trigger_value: 0,
        trigger_unit: "days",
        anchor_field: "data_nascimento",
        scheduled_time: "09:00",
      },
      {
        trigger_type: "after_anchor",
        trigger_value: 1,
        trigger_unit: "days",
        anchor_field: "data_nascimento",
      },
    ];

    // Nenhuma data-alvo informada (string vazia)
    const previews = birthdaySteps.map((s) => getStepPreview(s, ""));
    const validCount = previews.filter((p) => p.type === "valid").length;
    const hasOnlySkippedSteps = birthdaySteps.length > 0 && validCount === 0;

    expect(validCount).toBe(2);
    expect(hasOnlySkippedSteps).toBe(false);
    expect(birthdaySteps.some(requiresTargetDate)).toBe(false);
  });

  it("prévia de âncora não inventa data e não menciona reunião", () => {
    const preview = getStepPreview({
      trigger_type: "before_anchor",
      trigger_value: 2,
      trigger_unit: "days",
      anchor_field: "data_nascimento",
      scheduled_time: "10:30",
    });
    expect(preview.type).toBe("valid");
    expect(preview.message).toContain("aniversário do lead");
    expect(preview.message).toContain("10:30");
    expect(preview.message).not.toContain("reunião");
    expect(preview.message).not.toContain("data-alvo");
  });

  it("hora fixa aparece na descrição e na prévia pelo módulo compartilhado", () => {
    const step = {
      trigger_type: "before_anchor",
      trigger_value: 3,
      trigger_unit: "days",
      anchor_field: "data_nascimento",
      scheduled_time: "16:45",
    };
    const desc = describeStep(step);
    const prev = getStepPreview(step);
    expect(desc).toContain("às 16:45");
    expect(prev.message).toContain("às 16:45");
  });
});

describe("isTimeOutsideSendWindow", () => {
  it("avisa para horários fora da janela 08:00–18:00", () => {
    expect(isTimeOutsideSendWindow("22:00", "08:00", "18:00")).toBe(true);
    expect(isTimeOutsideSendWindow("07:30", "08:00", "18:00")).toBe(true);
    expect(isTimeOutsideSendWindow("10:00", "08:00", "18:00")).toBe(false);
    expect(isTimeOutsideSendWindow("18:00", "08:00", "18:00")).toBe(false);
    expect(isTimeOutsideSendWindow("", "08:00", "18:00")).toBe(false);
    expect(isTimeOutsideSendWindow(null, "08:00", "18:00")).toBe(false);
  });
});
