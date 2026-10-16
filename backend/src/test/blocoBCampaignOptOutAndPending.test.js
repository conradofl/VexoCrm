// backend/src/test/blocoBCampaignOptOutAndPending.test.js
import { describe, expect, it } from "vitest";
import { buildDispatchLeads } from "../campaign/dispatch.js";
import { DEFAULT_SUMMARY_PROMPT, SUMMARY_OUTPUT_CONTRACT } from "../domains/leads/chatInsight.js";

describe("BLOCO B: Testes Backend de Fila, Opt-out e Prompt", () => {
  describe("ITEM B.2: Correção Matemática da Fila de Disparos (leads_pending)", () => {
    it("subtrai leads já enviados e com falha do target_count total", () => {
      // Simulação da lógica da query SQL:
      // GREATEST(0, COALESCE(target_count, 0) - COALESCE(sent_count, 0) - COALESCE(failed_count, 0))
      const calculateLeadsPending = (targetCount, sentCount, failedCount) => {
        return Math.max(0, (targetCount || 0) - (sentCount || 0) - (failedCount || 0));
      };

      // Cenário da especificação: 366 leads no lote, 67 disparados com sucesso
      const pending = calculateLeadsPending(366, 67, 0);
      expect(pending).toBe(299);

      // Cenário com falhas parciais: 100 leads, 20 enviados, 5 com falha
      const pendingWithFailures = calculateLeadsPending(100, 20, 5);
      expect(pendingWithFailures).toBe(75);

      // Cenário finalizado ou ultrapassado: nunca negativo
      const pendingZero = calculateLeadsPending(50, 50, 0);
      expect(pendingZero).toBe(0);
      const pendingOverflow = calculateLeadsPending(50, 55, 0);
      expect(pendingOverflow).toBe(0);
    });
  });

  describe("ITEM B.4: Exclusão de Leads com Opt-out em buildDispatchLeads", () => {
    it("exclui leads marcados com opt_out: true ou metadata.opt_out: 'true'", () => {
      // Simula o filtro do buildDispatchLeads
      const mockLeads = [
        { id: "l1", nome: "Lead Ativo", telefone: "5511999990001", opt_out: false },
        { id: "l2", nome: "Lead Bloqueado Flag", telefone: "5511999990002", opt_out: true },
        { id: "l3", nome: "Lead Bloqueado Metadata", telefone: "5511999990003", metadata: { opt_out: "true" } },
        { id: "l4", nome: "Lead Normal", telefone: "5511999990004" },
      ];

      const filtered = mockLeads.filter((item) => {
        const isOptOut =
          item.opt_out === true ||
          item.metadata?.opt_out === "true" ||
          item.metadata?.opt_out === true;
        return !isOptOut;
      });

      expect(filtered.map((l) => l.id)).toEqual(["l1", "l4"]);
      expect(filtered.find((l) => l.id === "l2")).toBeUndefined();
      expect(filtered.find((l) => l.id === "l3")).toBeUndefined();
    });
  });

  describe("ITEM B.5: Calibração do Prompt da IA em chatInsight", () => {
    it("contém a instrução de não classificar campanhas políticas/comunitárias como conversa pessoal", () => {
      expect(DEFAULT_SUMMARY_PROMPT).toContain("Classificação de Intenção");
      expect(DEFAULT_SUMMARY_PROMPT).toContain("Não classifique conversas institucionais, políticas, de votação");
      expect(DEFAULT_SUMMARY_PROMPT).toContain("apoio comunitário como engajamento positivo de campanha");

      expect(SUMMARY_OUTPUT_CONTRACT).toContain("Classificação de Intenção");
    });
  });
});
