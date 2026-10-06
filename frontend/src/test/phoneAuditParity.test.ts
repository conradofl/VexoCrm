// Paridade da classificação de telefone dos totais da importação (intact | completed | missing) entre a tela e o servidor.
// A fixture compartilhada (shared/importPhoneAuditCases.json) é lida pelos DOIS lados: este teste e
// backend/src/test/leadImportBatchesPostgres.test.js (classifyImportedPhone).
import { describe, expect, it } from "vitest";
import cases from "../../../shared/importPhoneAuditCases.json";
import { classifyPhoneAudit } from "@/lib/leadImports/phoneAudit";

describe("classifyPhoneAudit: a regra dos totais da importação (fixture compartilhada com o servidor)", () => {
  for (const c of cases.cases) {
    it(`${JSON.stringify(c.raw)} com DDD ${JSON.stringify(c.defaultDdd)} → ${c.expected}`, () => {
      const r = classifyPhoneAudit(c.raw, c.defaultDdd);

      expect(r.kind === "incomplete" ? "missing" : r.kind).toBe(c.expected);
      expect(r.sanitized).toBe(c.sanitized);
      expect(r.reason ?? null).toBe(c.frontReason);
    });
  }

  it("a fixture cobre as três classes e os motivos de rejeição que a tela mostra", () => {
    const kinds = new Set(cases.cases.map((c) => c.expected));
    const reasons = new Set(cases.cases.map((c) => c.frontReason).filter(Boolean));

    expect([...kinds].sort()).toEqual(["completed", "intact", "missing"]);
    expect(reasons.has("Faltou informar o DDD padrão")).toBe(true);
    expect(reasons.has("Telefone incompleto")).toBe(true);
    expect(reasons.has("Identificador de grupo do WhatsApp bloqueado")).toBe(true);
    expect(reasons.has("Sem telefone")).toBe(true);
  });
});
