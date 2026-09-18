// backend/src/test/agentInstructionAudit.test.js
//
// "Um agente, um dono para cada texto" — Commit 1 (mostrar a verdade, sem
// mover nada). auditAgentInstructionSources é pura: recebe os mesmos dados
// que o motor usaria e só DESCREVE de onde vem cada instrução, sem gravar ou
// mudar comportamento nenhum.

import { describe, expect, it } from "vitest";
import { auditAgentInstructionSources } from "../services/agentInstructionAudit.js";

function template(overrides = {}) {
  return {
    template_key: "generico",
    data_fields: [
      { key: "interesse", label: "Interesse", description: "Produto de interesse" },
      { key: "cidade", label: "Cidade", description: "Cidade do lead" },
    ],
    required_fields: ["interesse"],
    ...overrides,
  };
}

describe("auditAgentInstructionSources — prompt: de onde vem o texto que o agente fala", () => {
  it("agente com prompt próprio: a fonte é 'agente', não o prompt do tenant", () => {
    const audit = auditAgentInstructionSources({
      agentRow: { inbound_prompt: "Sou o agente X, atendo a Empresa Y." },
      tenantPromptContent: "Prompt genérico do tenant, nunca deveria vencer aqui.",
      template: null,
    });
    expect(audit.prompt.source).toBe("agente");
    expect(audit.prompt.value).toBe("Sou o agente X, atendo a Empresa Y.");
  });

  it("agente SEM prompt próprio: cai no prompt do tenant, e o painel sabe disso (fonte 'tenant')", () => {
    const audit = auditAgentInstructionSources({
      agentRow: { inbound_prompt: null },
      tenantPromptContent: "Prompt padrão do tenant.",
      template: null,
    });
    expect(audit.prompt.source).toBe("tenant");
    expect(audit.prompt.value).toBe("Prompt padrão do tenant.");
  });

  it("nem agente nem tenant têm prompt: fonte 'nenhum', valor nulo — não inventa texto", () => {
    const audit = auditAgentInstructionSources({ agentRow: {}, tenantPromptContent: null, template: null });
    expect(audit.prompt.source).toBe("nenhum");
    expect(audit.prompt.value).toBeNull();
  });
});

describe("auditAgentInstructionSources — coleta: conflito só numa direção (template instruindo o robô por baixo)", () => {
  it("[TESTE OBRIGATÓRIO] campo no template ausente na coleta do agente: conflito aponta as duas origens", () => {
    const audit = auditAgentInstructionSources({
      agentRow: { inbound_spin_fields: [{ name: "orcamento", required: true }] },
      template: template({ data_fields: [{ key: "telefone", label: "Telefone", description: "Telefone alternativo" }], required_fields: [] }),
    });

    expect(audit.collection.conflicts).toHaveLength(1);
    const doTemplate = audit.collection.conflicts[0];
    expect(doTemplate).toMatchObject({ field: "telefone", emAgente: false, emTemplate: true, origemTemplate: "generico" });
    expect(doTemplate.motivo).toContain("telefone");
    expect(doTemplate.motivo).toContain("generico");
  });

  it("[TESTE OBRIGATÓRIO] agente com 3 campos e template com 0: nenhum conflito — o agente é a autoridade sobre a própria Coleta", () => {
    const audit = auditAgentInstructionSources({
      agentRow: {
        inbound_spin_fields: [
          { name: "interesse", required: true },
          { name: "orcamento", required: true },
          { name: "melhor_horario", required: false },
        ],
      },
      template: template({ data_fields: [], required_fields: [] }),
    });

    expect(audit.collection.conflicts).toEqual([]);
  });

  it("mesmos campos nos dois lados: zero conflito", () => {
    const audit = auditAgentInstructionSources({
      agentRow: { inbound_spin_fields: [{ name: "interesse", required: true }, { name: "cidade", required: false }] },
      template: template(),
    });
    expect(audit.collection.conflicts).toEqual([]);
  });

  it("[o teste que fecha a leva] agente com 2 campos, template com 5: os 3 que faltam na coleta aparecem nomeados, nada mais", () => {
    const audit = auditAgentInstructionSources({
      agentRow: { inbound_spin_fields: [{ name: "interesse", required: true }, { name: "cidade", required: false }] },
      template: template({
        data_fields: [
          { key: "interesse", label: "Interesse", description: "..." },
          { key: "cidade", label: "Cidade", description: "..." },
          { key: "telefone", label: "Telefone", description: "..." },
          { key: "email", label: "E-mail", description: "..." },
          { key: "cep", label: "CEP", description: "..." },
        ],
        required_fields: ["interesse"],
      }),
    });

    const camposFaltantes = audit.collection.conflicts.map((c) => c.field);
    expect(camposFaltantes.sort()).toEqual(["cep", "email", "telefone"]);
  });

  it("sem template resolvido: nenhum conflito inventado, campos do agente aparecem normalmente na Coleta", () => {
    const audit = auditAgentInstructionSources({
      agentRow: { inbound_spin_fields: [{ name: "interesse", required: true }] },
      template: null,
    });
    expect(audit.collection.templateFields).toEqual([]);
    expect(audit.collection.agentFields).toEqual([{ name: "interesse", required: true }]);
    expect(audit.collection.conflicts).toEqual([]);
  });
});

describe("auditAgentInstructionSources — modelo: agente próprio ou padrão do sistema", () => {
  it("agente com inbound_model definido: fonte 'agente'", () => {
    const audit = auditAgentInstructionSources({ agentRow: { inbound_model: "openai/gpt-oss-120b" }, defaultLlmModel: "llama-3.3-70b" });
    expect(audit.model).toEqual({ source: "agente", value: "openai/gpt-oss-120b" });
  });

  it("agente sem inbound_model: cai no padrão do sistema, e o painel sabe disso", () => {
    const audit = auditAgentInstructionSources({ agentRow: {}, defaultLlmModel: "llama-3.3-70b" });
    expect(audit.model).toEqual({ source: "padrão do sistema", value: "llama-3.3-70b" });
  });
});
