import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { evaluateLeadSequenceRetention, dispatchCampaignSequence } from "../campaign-outbound.js";

const sharedCasesPath = resolve(__dirname, "../../../shared/leadVariableRetentionTestCases.json");
const fixture = JSON.parse(readFileSync(sharedCasesPath, "utf-8"));

describe("Paridade de Retenção de Variáveis — Backend (Validação Atômica no Disparo)", () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  fixture.cases.forEach((testCase) => {
    it(testCase.description, async () => {
      const actualHeldIds = [];
      const actualSendableIds = [];

      for (const lead of testCase.leads) {
        const phone = lead.telefone || lead.phone || "";
        const result = evaluateLeadSequenceRetention(testCase.sequence, lead, phone);
        if (result.held) {
          actualHeldIds.push(lead.id);
        } else {
          actualSendableIds.push(lead.id);
        }
      }

      expect(actualHeldIds.sort()).toEqual([...testCase.expectedHeldLeadIds].sort());
      expect(actualSendableIds.sort()).toEqual([...testCase.expectedSendableLeadIds].sort());

      // Validação integrada via dispatchCampaignSequence
      const dispatchedSteps = [];
      const { summary } = await dispatchCampaignSequence({
        webhookUrl: "http://evolution.test/message/sendText/instancia",
        webhookToken: "token-teste",
        leads: testCase.leads,
        analyticsMeta: {
          sequence: testCase.sequence.map((s, idx) => ({
            id: `step-${idx + 1}`,
            order: s.order || idx + 1,
            type: "text",
            enabled: s.enabled !== false,
            triggerMode: "immediate",
            delayAfterSeconds: 0,
            text: s.text,
          })),
        },
        leadDelayProvider: () => 0,
        onStepDispatched: (data) => dispatchedSteps.push(data),
      });

      expect(summary.failureCount).toBe(testCase.expectedHeldLeadIds.length);
      expect(summary.successCount).toBe(testCase.expectedSendableLeadIds.length);

      // Garante que nenhum lead retido recebeu mensagens
      for (const heldId of testCase.expectedHeldLeadIds) {
        const lead = testCase.leads.find((l) => l.id === heldId);
        const phone = lead?.telefone || lead?.phone;
        if (phone) {
          const sentForHeld = dispatchedSteps.filter((d) => d.phone === phone);
          expect(sentForHeld.length).toBe(0);
        }
      }
    }, 15000);
  });
});
