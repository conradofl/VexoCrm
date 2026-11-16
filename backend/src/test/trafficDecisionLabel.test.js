// A frase do motivo usa o nome do KPI quando ele vem; os números guardam a chave.
import { describe, expect, it } from "vitest";
import { decidir } from "../traffic/decision.js";

describe("decidir: rótulo do KPI na frase", () => {
  it("usa o rótulo na frase e mantém a chave nos números", () => {
    const r = decidir({ valorKpi: 100, kpi: { key: "cpl", label: "Custo por lead", target: 50, better: "lower" }, gasto: 300 });
    expect(r.motivo).toBe("Custo por lead em 100, 100% pior que a meta de 50 (corta a partir de 50%).");
    expect(r.numeros.kpi).toBe("cpl");
  });

  it("sem rótulo, a frase usa a chave", () => {
    expect(decidir({ valorKpi: 100, kpi: { key: "cpl", target: 50, better: "lower" }, gasto: 300 }).motivo).toContain("cpl em 100");
  });
});
