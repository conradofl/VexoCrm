import { describe, it, expect } from "vitest";
import fixture from "../../../shared/leadVariableRetentionTestCases.json";
import { auditMessageVariablesAgainstLeads } from "../lib/leadImports/spreadsheet";

describe("Paridade de Retenção de Variáveis — Frontend (Auditoria Prévia)", () => {
  fixture.cases.forEach((testCase) => {
    it(testCase.description, () => {
      const messages = testCase.sequence
        .filter((step) => step.enabled !== false)
        .map((step) => step.text || "");

      const audit = auditMessageVariablesAgainstLeads(messages, testCase.leads as any[]);

      const actualHeldIds = audit.heldLeads.map((l: any) => l.id).sort();
      const expectedHeldIds = [...testCase.expectedHeldLeadIds].sort();

      expect(actualHeldIds).toEqual(expectedHeldIds);
      expect(audit.heldLeadsCount).toBe(expectedHeldIds.length);

      const actualSendableIds = (testCase.leads as any[])
        .filter((l) => !actualHeldIds.includes(l.id))
        .map((l) => l.id)
        .sort();
      const expectedSendableIds = [...testCase.expectedSendableLeadIds].sort();

      expect(actualSendableIds).toEqual(expectedSendableIds);
      expect(audit.sendableLeadsCount).toBe(expectedSendableIds.length);
    });
  });
});
