// backend/src/test/chipExclusivity.test.js
//
// "Um chip pertence a um agente só" — hoje evolution_instances é lista solta
// e nada impede dois agentes reivindicarem o mesmo chip (resolução escolhia
// "o primeiro que casar", regra invisível). findChipExclusivityConflict roda
// na gravação e recusa isso, nomeando quem já usa o chip.

import { describe, expect, it } from "vitest";
import { findChipExclusivityConflict } from "../services/chipExclusivity.js";

const TENANT_INSTANCES = [
  { id: "inst-abc", name: "Chip Vendas", dispatch_webhook_url: "https://evo.example/message/sendText/chip-vendas-slug" },
  { id: "inst-xyz", name: "Chip Suporte", dispatch_webhook_url: "https://evo.example/message/sendText/chip-suporte-slug" },
];

describe("findChipExclusivityConflict", () => {
  it("[TESTE OBRIGATÓRIO] dois agentes disputando o mesmo chip: o segundo é recusado, com o nome do primeiro na mensagem", () => {
    const outrosAgentes = [
      { id: "agente-1", name: "Atendimento Principal", evolution_instance: "Chip Vendas", evolution_instances: ["Chip Vendas"] },
    ];

    const conflito = findChipExclusivityConflict({
      requestedInstanceNames: ["inst-abc"], // mesmo chip, apelido DIFERENTE (id em vez de nome)
      agentIdBeingSaved: "agente-2",
      otherAgentRows: outrosAgentes,
      tenantInstances: TENANT_INSTANCES,
    });

    expect(conflito).toBeTruthy();
    expect(conflito.ownedByAgentId).toBe("agente-1");
    expect(conflito.ownedByAgentName).toBe("Atendimento Principal");
  });

  it("nenhum conflito: chips pedidos não pertencem a nenhum outro agente do tenant", () => {
    const outrosAgentes = [
      { id: "agente-1", name: "Atendimento Principal", evolution_instance: "Chip Vendas", evolution_instances: ["Chip Vendas"] },
    ];

    const conflito = findChipExclusivityConflict({
      requestedInstanceNames: ["Chip Suporte"],
      agentIdBeingSaved: "agente-2",
      otherAgentRows: outrosAgentes,
      tenantInstances: TENANT_INSTANCES,
    });

    expect(conflito).toBeNull();
  });

  it("salvar o PRÓPRIO agente de novo (mesmo id) nunca conflita consigo mesmo", () => {
    const outrosAgentes = [
      { id: "agente-1", name: "Atendimento Principal", evolution_instance: "Chip Vendas", evolution_instances: ["Chip Vendas"] },
    ];

    const conflito = findChipExclusivityConflict({
      requestedInstanceNames: ["Chip Vendas"],
      agentIdBeingSaved: "agente-1", // o mesmo id da linha que já tem esse chip
      otherAgentRows: outrosAgentes,
      tenantInstances: TENANT_INSTANCES,
    });

    expect(conflito).toBeNull();
  });

  it("criando um agente novo (agentIdBeingSaved null): ainda checa contra todas as linhas existentes", () => {
    const outrosAgentes = [
      { id: "agente-1", name: "Atendimento Principal", evolution_instance: "Chip Vendas", evolution_instances: ["Chip Vendas"] },
    ];

    const conflito = findChipExclusivityConflict({
      requestedInstanceNames: ["Chip Vendas"],
      agentIdBeingSaved: null,
      otherAgentRows: outrosAgentes,
      tenantInstances: TENANT_INSTANCES,
    });

    expect(conflito).toBeTruthy();
    expect(conflito.ownedByAgentId).toBe("agente-1");
  });

  it("reconhece o mesmo chip mesmo quando as duas linhas guardaram apelidos diferentes (id vs slug da URL de disparo)", () => {
    const outrosAgentes = [
      { id: "agente-1", name: "Atendimento Principal", evolution_instance: "chip-vendas-slug", evolution_instances: [] },
    ];

    const conflito = findChipExclusivityConflict({
      requestedInstanceNames: ["Chip Vendas"], // nome de display, não o slug
      agentIdBeingSaved: "agente-2",
      otherAgentRows: outrosAgentes,
      tenantInstances: TENANT_INSTANCES,
    });

    expect(conflito).toBeTruthy();
    expect(conflito.ownedByAgentId).toBe("agente-1");
  });

  it("lista de chips pedidos vazia: nunca conflita", () => {
    const conflito = findChipExclusivityConflict({
      requestedInstanceNames: [],
      agentIdBeingSaved: "agente-2",
      otherAgentRows: [{ id: "agente-1", name: "X", evolution_instance: "Chip Vendas", evolution_instances: [] }],
      tenantInstances: TENANT_INSTANCES,
    });
    expect(conflito).toBeNull();
  });
});
