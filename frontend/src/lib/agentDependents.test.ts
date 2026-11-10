import { describe, expect, it } from "vitest";
import { describeAgentDependents } from "./agentDependents";

describe("describeAgentDependents", () => {
  it("monta a frase com nome de gente e plural certo", () => {
    expect(
      describeAgentDependents([
        { table: "followup_campaigns", count: 2 },
        { table: "followup_schedules", count: 9 },
        { table: "fup_journeys", count: 1 },
      ])
    ).toBe("2 campanhas, 9 agendamentos, 1 jornada");
  });

  it("tabela desconhecida aparece com o nome técnico em vez de sumir", () => {
    expect(describeAgentDependents([{ table: "tabela_nova", count: 3 }])).toBe("3 registros em tabela_nova");
  });

  it("ignora contagem zero e lista vazia", () => {
    expect(describeAgentDependents([{ table: "followup_replies", count: 0 }])).toBe("");
    expect(describeAgentDependents(undefined)).toBe("");
  });
});
