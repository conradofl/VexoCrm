import { describe, expect, it } from "vitest";
import { validateOnboardingPayload } from "./routes.js";

const VALID_PAYLOAD = {
  company_name: "Solar Prime",
  evolution_instance: "solar-prime-evo",
  campaign_name: "Pós-agendamento",
  templates: [
    {
      name: "Boas vindas",
      message: "Olá {{lead_name}}, obrigado pelo agendamento em {{meeting_date}}!",
      trigger_type: "on_schedule",
      trigger_value: 0,
      trigger_unit: "minutes",
      trigger_direction: null,
      order_index: 0,
    },
  ],
};

describe("validateOnboardingPayload", () => {
  it("retorna array vazio para payload válido completo", () => {
    expect(validateOnboardingPayload(VALID_PAYLOAD)).toEqual([]);
  });

  it("retorna erro se company_name ausente", () => {
    const errors = validateOnboardingPayload({ ...VALID_PAYLOAD, company_name: "" });
    expect(errors.some((e) => e.field === "company_name")).toBe(true);
  });

  it("retorna erro se company_name é apenas espaços", () => {
    const errors = validateOnboardingPayload({ ...VALID_PAYLOAD, company_name: "   " });
    expect(errors.some((e) => e.field === "company_name")).toBe(true);
  });

  it("retorna erro se evolution_instance ausente", () => {
    const errors = validateOnboardingPayload({ ...VALID_PAYLOAD, evolution_instance: "" });
    expect(errors.some((e) => e.field === "evolution_instance")).toBe(true);
  });

  it("retorna erro se campaign_name ausente", () => {
    const errors = validateOnboardingPayload({ ...VALID_PAYLOAD, campaign_name: "" });
    expect(errors.some((e) => e.field === "campaign_name")).toBe(true);
  });

  it("retorna erro se templates é undefined", () => {
    const { templates: _, ...rest } = VALID_PAYLOAD;
    const errors = validateOnboardingPayload(rest);
    expect(errors.some((e) => e.field === "templates")).toBe(true);
  });

  it("retorna erro se templates é array vazio", () => {
    const errors = validateOnboardingPayload({ ...VALID_PAYLOAD, templates: [] });
    expect(errors.some((e) => e.field === "templates")).toBe(true);
  });

  it("retorna erro se templates não é array", () => {
    const errors = validateOnboardingPayload({ ...VALID_PAYLOAD, templates: null });
    expect(errors.some((e) => e.field === "templates")).toBe(true);
  });

  it("retorna erro se user_email é inválido", () => {
    const errors = validateOnboardingPayload({ ...VALID_PAYLOAD, user_email: "nao-e-email" });
    expect(errors.some((e) => e.field === "user_email")).toBe(true);
  });

  it("retorna erro se user_email não tem @", () => {
    const errors = validateOnboardingPayload({ ...VALID_PAYLOAD, user_email: "semarroba.com" });
    expect(errors.some((e) => e.field === "user_email")).toBe(true);
  });

  it("não retorna erro para user_email válido", () => {
    const errors = validateOnboardingPayload({ ...VALID_PAYLOAD, user_email: "cliente@empresa.com" });
    expect(errors.some((e) => e.field === "user_email")).toBe(false);
  });

  it("não retorna erro quando user_email está ausente (não obrigatório)", () => {
    const errors = validateOnboardingPayload(VALID_PAYLOAD);
    expect(errors.some((e) => e.field === "user_email")).toBe(false);
  });

  it("não retorna erro quando user_email é string vazia (campo omitido)", () => {
    const errors = validateOnboardingPayload({ ...VALID_PAYLOAD, user_email: "" });
    expect(errors.some((e) => e.field === "user_email")).toBe(false);
  });

  it("aceita payload mínimo sem campos opcionais", () => {
    const minimal = {
      company_name: "Empresa",
      evolution_instance: "inst-evo",
      campaign_name: "Campanha",
      templates: [
        { name: "T1", message: "msg", trigger_type: "on_schedule", trigger_value: 0, trigger_unit: "minutes", order_index: 0 },
      ],
    };
    expect(validateOnboardingPayload(minimal)).toEqual([]);
  });

  it("retorna erro de campo obrigatório com mensagem legível", () => {
    const errors = validateOnboardingPayload({ ...VALID_PAYLOAD, company_name: "" });
    const err = errors.find((e) => e.field === "company_name");
    expect(err).toBeTruthy();
    expect(typeof err.message).toBe("string");
    expect(err.message.length).toBeGreaterThan(5);
  });

  it("acumula múltiplos erros quando vários campos estão inválidos", () => {
    const errors = validateOnboardingPayload({ company_name: "", evolution_instance: "", campaign_name: "" });
    expect(errors.length).toBeGreaterThan(1);
  });

  it("retorna erro quando body é null", () => {
    const errors = validateOnboardingPayload(null);
    expect(errors.length).toBeGreaterThan(0);
  });
});
