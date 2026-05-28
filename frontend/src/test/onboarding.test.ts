import { describe, expect, it } from "vitest";
import {
  getTriggerKey,
  getTriggerLabel,
  replaceVariables,
  TRIGGER_OPTIONS,
} from "../pages/OnboardingWizard";
import type { OnboardingTemplate } from "../hooks/useOnboarding";

// ─── Trigger helpers ──────────────────────────────────────────────────────────

describe("getTriggerKey", () => {
  it("gera chave no formato trigger_type:trigger_value:trigger_unit", () => {
    const t: OnboardingTemplate = {
      name: "T1",
      message: "msg",
      trigger_type: "on_schedule",
      trigger_value: 0,
      trigger_unit: "minutes",
      trigger_direction: null,
      order_index: 0,
    };
    expect(getTriggerKey(t)).toBe("on_schedule:0:minutes");
  });

  it("gera chave correta para before_meeting", () => {
    const t: OnboardingTemplate = {
      name: "T2",
      message: "msg",
      trigger_type: "before_meeting",
      trigger_value: 1,
      trigger_unit: "days",
      trigger_direction: "before",
      order_index: 1,
    };
    expect(getTriggerKey(t)).toBe("before_meeting:1:days");
  });
});

describe("getTriggerLabel", () => {
  it("retorna label correto para on_schedule", () => {
    const t: OnboardingTemplate = {
      name: "T1", message: "msg",
      trigger_type: "on_schedule", trigger_value: 0, trigger_unit: "minutes",
      trigger_direction: null, order_index: 0,
    };
    expect(getTriggerLabel(t)).toBe("Assim que o webhook for disparado");
  });

  it("retorna label correto para 1 dia antes", () => {
    const t: OnboardingTemplate = {
      name: "T2", message: "msg",
      trigger_type: "before_meeting", trigger_value: 1, trigger_unit: "days",
      trigger_direction: "before", order_index: 1,
    };
    expect(getTriggerLabel(t)).toBe("1 dia antes");
  });

  it("retorna label correto para no_reply em 2 dias", () => {
    const t: OnboardingTemplate = {
      name: "T3", message: "msg",
      trigger_type: "no_reply", trigger_value: 2, trigger_unit: "days",
      trigger_direction: null, order_index: 2,
    };
    expect(getTriggerLabel(t)).toBe("Se não respondeu em 2 dias");
  });

  it("retorna fallback para trigger desconhecido", () => {
    const t: OnboardingTemplate = {
      name: "T4", message: "msg",
      trigger_type: "unknown", trigger_value: 99, trigger_unit: "seconds",
      trigger_direction: null, order_index: 3,
    };
    const label = getTriggerLabel(t);
    expect(label).toBeTruthy();
    expect(label).toContain("unknown");
  });
});

// ─── replaceVariables ─────────────────────────────────────────────────────────

describe("replaceVariables", () => {
  it("substitui {{lead_name}} por dado fictício", () => {
    const result = replaceVariables("Olá {{lead_name}}!");
    expect(result).not.toContain("{{lead_name}}");
    expect(result).toContain("João Silva");
  });

  it("substitui {{meeting_date}} por data fictícia", () => {
    const result = replaceVariables("Reunião em {{meeting_date}}");
    expect(result).not.toContain("{{meeting_date}}");
    expect(result).toContain("28/05/2026");
  });

  it("substitui {{meeting_time}} por horário fictício", () => {
    const result = replaceVariables("Às {{meeting_time}}");
    expect(result).not.toContain("{{meeting_time}}");
    expect(result).toContain("14:00");
  });

  it("substitui todas as variáveis de uma vez", () => {
    const msg = "Olá {{lead_name}}, reunião em {{meeting_date}} às {{meeting_time}}.";
    const result = replaceVariables(msg);
    expect(result).not.toContain("{{");
    expect(result).toContain("João Silva");
    expect(result).toContain("28/05/2026");
    expect(result).toContain("14:00");
  });

  it("retorna string intacta quando não há variáveis", () => {
    expect(replaceVariables("Mensagem sem variáveis")).toBe("Mensagem sem variáveis");
  });

  it("retorna string vazia intacta", () => {
    expect(replaceVariables("")).toBe("");
  });
});

// ─── TRIGGER_OPTIONS completeness ─────────────────────────────────────────────

describe("TRIGGER_OPTIONS", () => {
  it("contém pelo menos 25 opções", () => {
    expect(TRIGGER_OPTIONS.length).toBeGreaterThanOrEqual(25);
  });

  it("tem exatamente 1 opção on_schedule", () => {
    const count = TRIGGER_OPTIONS.filter((o) => o.trigger_type === "on_schedule").length;
    expect(count).toBe(1);
  });

  it("todas as opções têm label não vazio", () => {
    TRIGGER_OPTIONS.forEach((o) => {
      expect(o.label.trim().length).toBeGreaterThan(0);
    });
  });

  it("opções before_meeting têm trigger_direction 'before'", () => {
    TRIGGER_OPTIONS.filter((o) => o.trigger_type === "before_meeting").forEach((o) => {
      expect(o.trigger_direction).toBe("before");
    });
  });

  it("opções after_meeting têm trigger_direction 'after'", () => {
    TRIGGER_OPTIONS.filter((o) => o.trigger_type === "after_meeting").forEach((o) => {
      expect(o.trigger_direction).toBe("after");
    });
  });

  it("opções no_reply têm trigger_direction null", () => {
    TRIGGER_OPTIONS.filter((o) => o.trigger_type === "no_reply").forEach((o) => {
      expect(o.trigger_direction).toBeNull();
    });
  });
});

// ─── Wizard validation logic (pure) ──────────────────────────────────────────

describe("wizard canAdvance logic (step 1 — company data)", () => {
  function canAdvanceStep0(company_name: string, evolution_instance: string) {
    return Boolean(company_name.trim() && evolution_instance.trim());
  }

  it("não avança sem company_name", () => {
    expect(canAdvanceStep0("", "inst-evo")).toBe(false);
  });

  it("não avança sem evolution_instance", () => {
    expect(canAdvanceStep0("Solar Prime", "")).toBe(false);
  });

  it("não avança com ambos vazios", () => {
    expect(canAdvanceStep0("", "")).toBe(false);
  });

  it("avança com ambos preenchidos", () => {
    expect(canAdvanceStep0("Solar Prime", "solar-evo")).toBe(true);
  });
});

describe("wizard canAdvance logic (step 4 — templates)", () => {
  function canAdvanceStep3(templates: unknown[]) {
    return templates.length > 0;
  }

  it("não avança sem nenhum template", () => {
    expect(canAdvanceStep3([])).toBe(false);
  });

  it("avança com pelo menos 1 template", () => {
    expect(canAdvanceStep3([{ name: "T1" }])).toBe(true);
  });
});
