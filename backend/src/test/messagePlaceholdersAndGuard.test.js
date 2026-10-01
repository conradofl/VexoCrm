import { describe, expect, it } from "vitest";
import { validateOutboundMessage } from "../services/jsonExtractor.js";
import { applyMessagePlaceholders } from "../services/messagePlaceholders.js";

describe("Substituição de Placeholders (applyMessagePlaceholders)", () => {
  it("substitui {{nome}} e {{telefone}} corretamente quando preenchidos", () => {
    const template = "Olá {{nome}}, seu telefone é {{telefone}}!";
    const lead = { nome: "Conrado", telefone: "5534997817660" };
    const res = applyMessagePlaceholders(template, lead, "5534997817660");
    expect(res).toBe("Olá Conrado, seu telefone é 5534997817660!");
  });

  it("suporta variações de tokens como {{ Nome }}, {{lead_name}}, {{cliente}} e {{name}}", () => {
    expect(applyMessagePlaceholders("Oi {{ Nome }}!", { nome: "Ana" })).toBe("Oi Ana!");
    expect(applyMessagePlaceholders("Oi {{ lead_name }}!", { lead_name: "Carlos" })).toBe("Oi Carlos!");
    expect(applyMessagePlaceholders("Oi {{ cliente }}!", { name: "Maria" })).toBe("Oi Maria!");
  });

  it("se nome estiver ausente, faz fallback seguro para 'cliente' sem vazar a tag crua", () => {
    const template = "Oi {{nome}}, tudo bem? Aqui é o consultor.";
    const res = applyMessagePlaceholders(template, { telefone: "5534997817660" }, "5534997817660");
    expect(res).toBe("Oi cliente, tudo bem? Aqui é o consultor.");
    expect(res).not.toContain("{{");
    expect(res).not.toContain("}}");
  });

  it("substitui {{scheduling_link}} quando presente em normalized_data ou extraContext", () => {
    const template = "Agende aqui: {{scheduling_link}}";
    const lead = { nome: "João", normalized_data: { scheduling_link: "https://agenda.vexo.com/demo" } };
    const res = applyMessagePlaceholders(template, lead);
    expect(res).toBe("Agende aqui: https://agenda.vexo.com/demo");
  });

  it("substitui campos dinâmicos customizados da planilha", () => {
    const template = "Confirmando sua cidade {{cidade}} e plano {{plano}}.";
    const lead = { nome: "João", normalized_data: { cidade: "Uberlândia", plano: "Avançado" } };
    const res = applyMessagePlaceholders(template, lead);
    expect(res).toBe("Confirmando sua cidade Uberlândia e plano Avançado.");
  });
});

describe("Guarda de Saída contra Variáveis Não Substituídas (validateOutboundMessage)", () => {
  it("BLOQUEIA qualquer mensagem que contenha {{nome}} ou qualquer {{...}} cru", () => {
    const msg = "Oi {{nome}}, tudo bem? Aqui e o Conrado, da Vexo.";
    const guard = validateOutboundMessage(msg);
    expect(guard.valid).toBe(false);
    expect(guard.reason).toBe("contains_unresolved_variable:{{nome}}");
  });

  it("BLOQUEIA mensagens com chaves duplas soltas como {{ ou }}", () => {
    expect(validateOutboundMessage("Olá {{ cliente").valid).toBe(false);
    expect(validateOutboundMessage("Olá cliente }}").valid).toBe(false);
    expect(validateOutboundMessage("Link: {{scheduling_link}}").valid).toBe(false);
  });

  it("LIBERA mensagens com variáveis devidamente resolvidas", () => {
    const raw = "Oi {{nome}}, tudo bem? Aqui e o Conrado, da Vexo.";
    const resolvida = applyMessagePlaceholders(raw, { nome: "Conrado" });
    expect(resolvida).toBe("Oi Conrado, tudo bem? Aqui e o Conrado, da Vexo.");
    
    const guard = validateOutboundMessage(resolvida);
    expect(guard.valid).toBe(true);
    expect(guard.reason).toBe(null);
  });
});
