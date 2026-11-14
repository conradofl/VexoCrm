// Fase 0 do redesenho do Dashboard (31/10/2026): a tela nunca afirma o que não mediu.
// Selo de variação: "sem delta" (período anterior zerado) é diferente de 0%.
import { describe, it, expect } from "vitest";
import { formatDelta } from "@/lib/dashboard/formatters";

describe("Selo de variação — sem base de comparação", () => {
  it("formatDelta separa 'sem delta' de 0%", () => {
    expect(formatDelta(null)).toMatchObject({ isMissing: true, isZero: false });
    expect(formatDelta(0)).toMatchObject({ isMissing: false, isZero: true, text: "0%" });
  });
});
