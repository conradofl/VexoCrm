import { describe, expect, it } from "vitest";
import { applyMessagePlaceholders } from "../services/messagePlaceholders.js";
import { validateOutboundMessage } from "../services/jsonExtractor.js";
import { leadVariableIsFilled, evaluateLeadSequenceRetention } from "../campaign-outbound.js";

describe("Substituição de {{primeiro_nome}} (applyMessagePlaceholders)", () => {
  it("substitui {{primeiro_nome}} pelo primeiro nome para 'Conrado Finzi' -> 'Conrado'", () => {
    const template = "Olá {{primeiro_nome}}, tudo bem?";
    const lead = { nome: "Conrado Finzi" };
    const res = applyMessagePlaceholders(template, lead);
    expect(res).toBe("Olá Conrado, tudo bem?");
  });

  it("substitui por 'cliente' quando o nome estiver ausente ou vazio", () => {
    const template = "Olá {{primeiro_nome}}, temos uma novidade!";
    expect(applyMessagePlaceholders(template, {})).toBe("Olá cliente, temos uma novidade!");
    expect(applyMessagePlaceholders(template, { nome: "" })).toBe("Olá cliente, temos uma novidade!");
    expect(applyMessagePlaceholders(template, { nome: null })).toBe("Olá cliente, temos uma novidade!");
  });

  it("suporta variações de sintaxe: {{primeironome}}, {{primeiro nome}}, {{first_name}}, {{firstname}} e case-insensitive com espaços", () => {
    const lead = { nome: "Maria Clara Santos" };
    expect(applyMessagePlaceholders("Oi {{primeironome}}!", lead)).toBe("Oi Maria!");
    expect(applyMessagePlaceholders("Oi {{primeiro nome}}!", lead)).toBe("Oi Maria!");
    expect(applyMessagePlaceholders("Oi {{first_name}}!", lead)).toBe("Oi Maria!");
    expect(applyMessagePlaceholders("Oi {{firstname}}!", lead)).toBe("Oi Maria!");
    expect(applyMessagePlaceholders("Oi {{ Primeiro_Nome }}!", lead)).toBe("Oi Maria!");
    expect(applyMessagePlaceholders("Oi {{ First_Name }}!", lead)).toBe("Oi Maria!");
  });

  it("permite usar {{primeiro_nome}} e {{nome}} juntos na mesma mensagem", () => {
    const template = "Oi {{primeiro_nome}}, confirmando o cadastro completo de {{nome}}.";
    const lead = { nome: "Conrado Finzi" };
    const res = applyMessagePlaceholders(template, lead);
    expect(res).toBe("Oi Conrado, confirmando o cadastro completo de Conrado Finzi.");
    expect(validateOutboundMessage(res).valid).toBe(true);
  });

  it("extrai primeiro nome a partir de campos alternativos (name, lead_name, normalized_data, dados)", () => {
    expect(applyMessagePlaceholders("Oi {{primeiro_nome}}!", { name: "Lucas Rocha" })).toBe("Oi Lucas!");
    expect(applyMessagePlaceholders("Oi {{primeiro_nome}}!", { lead_name: "Beatriz Lima" })).toBe("Oi Beatriz!");
    expect(applyMessagePlaceholders("Oi {{primeiro_nome}}!", { normalized_data: { nome: "Gabriel Mendes" } })).toBe("Oi Gabriel!");
    expect(applyMessagePlaceholders("Oi {{primeiro_nome}}!", { dados: { nome: "Fernanda Costa" } })).toBe("Oi Fernanda!");
  });

  it("leadVariableIsFilled reconhece tags de primeiro nome como seguras (fallback cliente)", () => {
    expect(leadVariableIsFilled("primeiro_nome", {}, "")).toBe(true);
    expect(leadVariableIsFilled("primeironome", {}, "")).toBe(true);
    expect(leadVariableIsFilled("primeiro nome", {}, "")).toBe(true);
    expect(leadVariableIsFilled("first_name", {}, "")).toBe(true);
    expect(leadVariableIsFilled("firstname", {}, "")).toBe(true);
  });

  it("evaluateLeadSequenceRetention não bloqueia passo com {{primeiro_nome}} mesmo sem nome cadastrado", () => {
    const sequence = [
      { order: 1, text: "Olá {{primeiro_nome}}, tudo bem? Aqui é da Vexo.", enabled: true }
    ];
    const retention = evaluateLeadSequenceRetention(sequence, { telefone: "5534997817660" }, "5534997817660");
    expect(retention.held).toBe(false);
    expect(retention.reason).toBe(null);
  });
});
