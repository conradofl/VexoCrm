// backend/src/test/funnelBlocks234.test.js
//
// Suíte de Testes Automatizados — Item 12: Funil de Vendas (Blocos 2, 3 e 4)
// Cobrindo:
// 1. Trava de inviolabilidade manual (stage_source = 'manual')
// 2. Reclassificação dinâmica por mensagens (stage_source = 'auto' / null)
// 3. Classificação semântica de fechamento (buyer), orçamento (open_budget), dúvida (inquiry) e perda com motivo (lost_reason)
// 4. Vocabulário customizável por tenant (funnel_vocabulary)
// 5. Importação direta de vendas fechadas (stage = 'buyer', stage_source = 'manual')

import { describe, expect, it, vi } from "vitest";
import {
  classifyLeadMessages,
  canonicalizeStageKey,
  formatStageLabel,
  DEFAULT_FUNNEL_VOCABULARY,
  reclassifyLeadFromMessages,
  getFunnelSettings,
  saveFunnelSettings,
  importClosedSalesBatch,
} from "../domains/leads/funnelService.js";
import * as leadUpsertModule from "../services/leadUpsert.js";

describe("Item 12: Funil de Vendas (Blocos 2, 3 e 4)", () => {
  // ─────────────────────────────────────────────────────────────────────────────
  // BLOCO 2: Classificação Semântica de Mensagens
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Bloco 2 — Classificação Semântica das Mensagens", () => {
    it("identifica sinal de fechamento / comprador (buyer) em comprovante ou pix", () => {
      const res = classifyLeadMessages(["Olá, segue o comprovante do pagamento, chave pix conferida!"]);
      expect(res.stage).toBe("buyer");
      expect(res.intent).toBe("purchase");
      expect(res.temperature).toBe("hot");
      expect(res.lost_reason).toBeNull();
    });

    it("identifica fechamento com termos de contrato assinado ou 'vamos fechar'", () => {
      const res = classifyLeadMessages(["Perfeito, contrato assinado, vamos fazer!"]);
      expect(res.stage).toBe("buyer");
      expect(res.intent).toBe("purchase");
    });

    it("identifica perda explícita por preço com motivo 'preco'", () => {
      const res = classifyLeadMessages(["Achei muito caro, está totalmente fora do meu orcamento no momento."]);
      expect(res.stage).toBe("lost");
      expect(res.lost_reason).toBe("preco");
      expect(res.temperature).toBe("cold");
    });

    it("identifica perda explícita por concorrência com motivo 'concorrente'", () => {
      const res = classifyLeadMessages(["Obrigado, mas já comprei com outro fornecedor ontem."]);
      expect(res.stage).toBe("lost");
      expect(res.lost_reason).toBe("concorrente");
      expect(res.temperature).toBe("cold");
    });

    it("identifica perda explícita por desinteresse com motivo 'desinteresse'", () => {
      const res = classifyLeadMessages(["Não tenho interesse, favor pare de mandar mensagem e cancele."]);
      expect(res.stage).toBe("lost");
      expect(res.lost_reason).toBe("desinteresse");
      expect(res.temperature).toBe("cold");
    });

    it("identifica interesse em orçamento / proposta (open_budget)", () => {
      const res = classifyLeadMessages(["Poderia me enviar a tabela de preços e um orçamento completo?"]);
      expect(res.stage).toBe("open_budget");
      expect(res.intent).toBe("budget");
      expect(res.temperature).toBe("hot");
      expect(res.lost_reason).toBeNull();
    });

    it("identifica dúvida / atendimento geral (inquiry)", () => {
      const res = classifyLeadMessages(["Olá, como funciona o serviço de vocês? Onde fica o endereço?"]);
      expect(res.stage).toBe("inquiry");
      expect(res.intent).toBe("inquiry");
      expect(res.temperature).toBe("warm");
      expect(res.lost_reason).toBeNull();
    });

    it("classifica como cold quando não há sinais comerciais explícitos", () => {
      const res = classifyLeadMessages(["Bom dia!", "Tudo bem?"]);
      expect(res.stage).toBe("cold");
      expect(res.intent).toBe("none");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // BLOCO 2: Trava de Inviolabilidade Manual (stage_source = 'manual')
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Bloco 2 — Trava de Sobrescrita Manual", () => {
    it("NUNCA sobrescreve estágio de lead com stage_source = 'manual', mesmo com mensagens de fechamento", async () => {
      const mockLead = {
        id: "lead-manual-1",
        phone: "5511999991111",
        telefone: "5511999991111",
        stage: "open_budget",
        stage_source: "manual",
        lost_reason: null,
        temperature: "hot",
      };

      const mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [mockLead] }),
      };

      const upsertSpy = vi.spyOn(leadUpsertModule, "upsertLeadByPhone");

      const result = await reclassifyLeadFromMessages({
        pool: mockPool,
        clientId: "tenant-test",
        leadId: "lead-manual-1",
        messages: ["Acabei de pagar o boleto, segue comprovante!"],
      });

      expect(result.updated).toBe(false);
      expect(result.reason).toBe("manual_protection");
      expect(result.stageSource).toBe("manual");
      expect(result.currentStage).toBe("open_budget");
      // Garante que o updater não foi chamado
      expect(upsertSpy).not.toHaveBeenCalled();

      upsertSpy.mockRestore();
    });

    it("reclassifica com sucesso se lead tem stage_source = 'auto' ou null", async () => {
      const mockLead = {
        id: "lead-auto-1",
        phone: "5511999992222",
        telefone: "5511999992222",
        stage: "inquiry",
        stage_source: "auto",
        lost_reason: null,
        temperature: "warm",
      };

      const mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [mockLead] }),
      };

      const upsertSpy = vi.spyOn(leadUpsertModule, "upsertLeadByPhone").mockResolvedValue({
        id: "lead-auto-1",
        stage: "buyer",
        stage_source: "auto",
      });

      const result = await reclassifyLeadFromMessages({
        pool: mockPool,
        clientId: "tenant-test",
        leadId: "lead-auto-1",
        messages: ["Manda a chave pix, fechamos o negócio!"],
      });

      expect(result.updated).toBe(true);
      expect(result.previousStage).toBe("inquiry");
      expect(result.newStage).toBe("buyer");
      expect(result.stageSource).toBe("auto");

      expect(upsertSpy).toHaveBeenCalledWith(
        mockPool,
        "tenant-test",
        "5511999992222",
        expect.objectContaining({
          stage: "buyer",
          stage_source: "auto",
          lost_reason: null,
        })
      );

      upsertSpy.mockRestore();
    });

    it("reclassifica lead automático para 'lost' com lost_reason preenchido ao detectar objeção", async () => {
      const mockLead = {
        id: "lead-auto-2",
        phone: "5511999993333",
        telefone: "5511999993333",
        stage: "open_budget",
        stage_source: null,
        lost_reason: null,
        temperature: "hot",
      };

      const mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [mockLead] }),
      };

      const upsertSpy = vi.spyOn(leadUpsertModule, "upsertLeadByPhone").mockResolvedValue({
        id: "lead-auto-2",
        stage: "lost",
        stage_source: "auto",
      });

      const result = await reclassifyLeadFromMessages({
        pool: mockPool,
        clientId: "tenant-test",
        leadId: "lead-auto-2",
        messages: ["Achei muito caro, não tenho esse valor"],
      });

      expect(result.updated).toBe(true);
      expect(result.newStage).toBe("lost");
      expect(result.lostReason).toBe("preco");

      expect(upsertSpy).toHaveBeenCalledWith(
        mockPool,
        "tenant-test",
        "5511999993333",
        expect.objectContaining({
          stage: "lost",
          stage_source: "auto",
          lost_reason: "preco",
        })
      );

      upsertSpy.mockRestore();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // BLOCO 3: Vocabulário e Etapas Customizáveis por Tenant
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Bloco 3 — Vocabulário Customizável por Tenant", () => {
    it("canonicalizeStageKey mapeia aliases legados para chaves canônicas", () => {
      expect(canonicalizeStageKey("novo")).toBe("cold");
      expect(canonicalizeStageKey("em_atendimento")).toBe("inquiry");
      expect(canonicalizeStageKey("qualificado")).toBe("open_budget");
      expect(canonicalizeStageKey("fechado")).toBe("buyer");
      expect(canonicalizeStageKey("perdido")).toBe("lost");
    });

    it("formatStageLabel retorna rótulo customizado ou fallback default", () => {
      const customVocab = {
        buyer: { label: "Contrato Assinado", color: "emerald" },
        inquiry: { label: "Diagnóstico Clínico", color: "blue" },
      };

      expect(formatStageLabel("buyer", customVocab)).toBe("Contrato Assinado");
      expect(formatStageLabel("fechado", customVocab)).toBe("Contrato Assinado");
      expect(formatStageLabel("inquiry", customVocab)).toBe("Diagnóstico Clínico");
      expect(formatStageLabel("open_budget", customVocab)).toBe(DEFAULT_FUNNEL_VOCABULARY.open_budget.label);
    });

    it("getFunnelSettings retorna vocabulário salvo no tenant mesclado aos defaults", async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({
          rows: [
            {
              funnel_config: {
                funnel_vocabulary: {
                  buyer: { label: "Venda Concretizada", color: "emerald" },
                  open_budget: { label: "Proposta Enviada", color: "amber" },
                },
              },
            },
          ],
        }),
      };

      const result = await getFunnelSettings(mockPool, "tenant-custom");
      expect(result.vocabulary.buyer.label).toBe("Venda Concretizada");
      expect(result.vocabulary.open_budget.label).toBe("Proposta Enviada");
      expect(result.vocabulary.cold.label).toBe(DEFAULT_FUNNEL_VOCABULARY.cold.label);
    });

    it("saveFunnelSettings persiste vocabulário customizado", async () => {
      const mockPool = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
      };

      const updated = await saveFunnelSettings(mockPool, "tenant-1", {
        buyer: { label: "Aluno Matriculado" },
      });

      expect(updated.vocabulary.buyer.label).toBe("Aluno Matriculado");
      expect(mockPool.query).toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // BLOCO 4: Importação Direta de Vendas Fechadas (Portas de Entrada Adicionais)
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Bloco 4 — Importação Direta de Vendas Fechadas", () => {
    it("cadastra lote com stage='buyer', stage_source='manual', tags de venda e temperatura hot", async () => {
      const batchSpy = vi.spyOn(leadUpsertModule, "upsertLeadsBatchByPhone").mockResolvedValue({
        importedCount: 2,
        updatedCount: 0,
        skippedCount: 0,
      });

      const rows = [
        {
          nome: "Dr. Roberto Carlos",
          telefone: "11987654321",
          valor_venda: 15000,
          produto_comprado: "Plano Anual Premium",
        },
        {
          nome: "Mariana Silva",
          telefone: "34999998888",
          valor_venda: 3500,
        },
      ];

      const mockPool = { query: vi.fn() };
      const res = await importClosedSalesBatch(mockPool, "tenant-med", rows);

      expect(res.importedCount).toBe(2);
      expect(batchSpy).toHaveBeenCalledTimes(1);

      const calledLeads = batchSpy.mock.calls[0][2];
      expect(calledLeads).toHaveLength(2);

      // Lead 1
      expect(calledLeads[0].stage).toBe("buyer");
      expect(calledLeads[0].stage_source).toBe("manual");
      expect(calledLeads[0].temperature).toBe("hot");
      expect(calledLeads[0].potential_contract_value).toBe(15000);
      expect(calledLeads[0].tags).toContain("Venda Fechada");
      expect(calledLeads[0].tags).toContain("Cliente Histórico");
      expect(calledLeads[0].dados.produto_comprado).toBe("Plano Anual Premium");

      // Lead 2
      expect(calledLeads[1].stage).toBe("buyer");
      expect(calledLeads[1].stage_source).toBe("manual");
      expect(calledLeads[1].potential_contract_value).toBe(3500);

      batchSpy.mockRestore();
    });
  });
});
