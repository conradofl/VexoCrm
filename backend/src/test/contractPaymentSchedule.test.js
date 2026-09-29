// backend/src/test/contractPaymentSchedule.test.js
//
// Testes automatizados da Peça 4: Bloco de Cronograma de Pagamento Flexível.

import { describe, expect, it } from "vitest";
import {
  generateScheduleInstallments,
  calculateScheduleTotals,
  buildCronograma,
  formatBrl,
  formatScheduleDateDisplay,
  formatTipoParcelaLabel,
  buildContractDados,
} from "../domains/geracaoDigitalContracts/contractMerge.js";

describe("Peça 4 — Bloco de Cronograma de Pagamento Flexível", () => {
  describe("1. Projeção de Parcelas por Periodicidade (generateScheduleInstallments)", () => {
    it("projeta parcelas com periodicidade semanal (intervalos de 7 dias)", () => {
      const parcelas = generateScheduleInstallments({
        numParcelas: 4,
        valorTotal: 4000,
        dataPrimeiroVenc: "2026-10-01",
        periodicidade: "semanal",
        tipoPadrao: "pix",
      });

      expect(parcelas).toHaveLength(4);
      expect(parcelas[0].data).toBe("2026-10-01");
      expect(parcelas[1].data).toBe("2026-10-08");
      expect(parcelas[2].data).toBe("2026-10-15");
      expect(parcelas[3].data).toBe("2026-10-22");

      expect(parcelas[0].valor).toBe(1000);
      expect(parcelas[0].tipo).toBe("pix");
      expect(parcelas[0].observacao).toBe("Entrada na assinatura");
      expect(parcelas[1].observacao).toBe("");
    });

    it("projeta parcelas com periodicidade quinzenal (intervalos de 15 dias)", () => {
      const parcelas = generateScheduleInstallments({
        numParcelas: 3,
        valorPorParcela: 1500,
        dataPrimeiroVenc: "2026-10-01",
        periodicidade: "quinzenal",
        tipoPadrao: "dinheiro",
      });

      expect(parcelas).toHaveLength(3);
      expect(parcelas[0].data).toBe("2026-10-01");
      expect(parcelas[1].data).toBe("2026-10-16");
      expect(parcelas[2].data).toBe("2026-10-31");
      expect(parcelas[0].valor).toBe(1500);
      expect(parcelas[1].valor).toBe(1500);
    });

    it("projeta parcelas com periodicidade mensal (mesmo dia do mês subsequente)", () => {
      const parcelas = generateScheduleInstallments({
        numParcelas: 3,
        valorTotal: 9000,
        dataPrimeiroVenc: "2026-10-15",
        periodicidade: "mensal",
        tipoPadrao: "boleto",
      });

      expect(parcelas).toHaveLength(3);
      expect(parcelas[0].data).toBe("2026-10-15");
      expect(parcelas[1].data).toBe("2026-11-15");
      expect(parcelas[2].data).toBe("2026-12-15");
      expect(parcelas[0].valor).toBe(3000);
      expect(parcelas[0].tipo).toBe("boleto");
    });

    it("respeita observação padrão customizada se informada", () => {
      const parcelas = generateScheduleInstallments({
        numParcelas: 2,
        valorTotal: 2000,
        dataPrimeiroVenc: "2026-10-01",
        observacaoPadrao: "Pagamento via transferência",
      });

      expect(parcelas[0].observacao).toBe("Pagamento via transferência");
      expect(parcelas[1].observacao).toBe("Pagamento via transferência");
    });
  });

  describe("2. Totalizadores do Cronograma (calculateScheduleTotals)", () => {
    it("segrega corretamente totais em dinheiro e permuta", () => {
      const parcelas = [
        { id: "1", numero: 1, data: "2026-10-01", valor: 5000, tipo: "dinheiro", observacao: "Entrada" },
        { id: "2", numero: 2, data: "2026-11-01", valor: 2500, tipo: "permuta", observacao: "Permuta serviço" },
        { id: "3", numero: 3, data: "2026-12-01", valor: 2500, tipo: "permuta", observacao: "Permuta produto" },
      ];

      const totals = calculateScheduleTotals(parcelas);

      expect(totals.totalGeral).toBe(10000);
      expect(totals.totalDinheiro).toBe(5000);
      expect(totals.totalPermuta).toBe(5000);
      expect(totals.numParcelas).toBe(3);
    });

    it("distribui meio 'misto' 50/50 entre dinheiro e permuta", () => {
      const parcelas = [
        { id: "1", numero: 1, data: "2026-10-01", valor: 4000, tipo: "misto" },
        { id: "2", numero: 2, data: "2026-11-01", valor: 2000, tipo: "pix" },
      ];

      const totals = calculateScheduleTotals(parcelas);

      expect(totals.totalGeral).toBe(6000);
      expect(totals.totalDinheiro).toBe(4000); // 2000 (misto) + 2000 (pix)
      expect(totals.totalPermuta).toBe(2000);  // 2000 (misto)
    });

    it("lida com lista vazia com segurança", () => {
      const totals = calculateScheduleTotals([]);
      expect(totals.totalGeral).toBe(0);
      expect(totals.totalDinheiro).toBe(0);
      expect(totals.totalPermuta).toBe(0);
      expect(totals.numParcelas).toBe(0);
    });
  });

  describe("3. Montagem Textual do Cronograma (buildCronograma)", () => {
    it("formata grade estruturada com detalhes, observações e linha de resumo", () => {
      const parcelas = [
        { id: "p1", numero: 1, data: "2026-10-05", valor: 3000, tipo: "pix", observacao: "Entrada na assinatura" },
        { id: "p2", numero: 2, data: "2026-11-05", valor: 3000, tipo: "permuta", observacao: "Permuta de marketing" },
      ];

      const texto = buildCronograma(parcelas);

      expect(texto).toContain("1ª Parcela — Vencimento: 05/10/2026 — Valor: R$ 3.000,00 (PIX) — Obs: Entrada na assinatura");
      expect(texto).toContain("2ª Parcela — Vencimento: 05/11/2026 — Valor: R$ 3.000,00 (Permuta) — Obs: Permuta de marketing");
      expect(texto).toContain("Total do Contrato: R$ 6.000,00 (Em Moeda: R$ 3.000,00 | Em Permuta: R$ 3.000,00)");
    });

    it("omite sufixo de observação se a parcela não contiver observação", () => {
      const parcelas = [
        { id: "p1", numero: 1, data: "2026-10-01", valor: 1500, tipo: "boleto" },
      ];

      const texto = buildCronograma(parcelas);

      expect(texto).toContain("1ª Parcela — Vencimento: 01/10/2026 — Valor: R$ 1.500,00 (Boleto)");
      expect(texto).not.toContain("— Obs:");
    });

    it("mantém 100% de retrocompatibilidade com modo legado numérico", () => {
      const legado = buildCronograma(3, 1200, "2026-10-01");

      expect(legado).toContain("1ª Parcela — Data:");
      expect(legado).toContain("Valor: R$ 1.200,00");
      expect(legado).toContain("2ª Parcela — Data:");
      expect(legado).toContain("3ª Parcela — Data:");
    });

    it("retorna string vazia para entradas vazias ou zeradas", () => {
      expect(buildCronograma([])).toBe("");
      expect(buildCronograma(0, 1000)).toBe("");
      expect(buildCronograma(null)).toBe("");
    });
  });

  describe("4. Formatadores Utilitários", () => {
    it("formatBrl formata valores monetários em Real", () => {
      expect(formatBrl(1500)).toContain("1.500,00");
      expect(formatBrl(0)).toContain("0,00");
    });

    it("formatScheduleDateDisplay formata YYYY-MM-DD para DD/MM/YYYY", () => {
      expect(formatScheduleDateDisplay("2026-12-25")).toBe("25/12/2026");
      expect(formatScheduleDateDisplay("a combinar")).toBe("a combinar");
      expect(formatScheduleDateDisplay("")).toBe("a combinar");
    });

    it("formatTipoParcelaLabel traduz tipos para rótulos legíveis", () => {
      expect(formatTipoParcelaLabel("dinheiro")).toBe("Dinheiro");
      expect(formatTipoParcelaLabel("pix")).toBe("PIX");
      expect(formatTipoParcelaLabel("boleto")).toBe("Boleto");
      expect(formatTipoParcelaLabel("cartao")).toBe("Cartão");
      expect(formatTipoParcelaLabel("permuta")).toBe("Permuta");
      expect(formatTipoParcelaLabel("misto")).toBe("Misto (Dinheiro + Permuta)");
    });
  });

  describe("5. Integração com buildContractDados", () => {
    it("integra grade de parcelas no payload final de contrato e reflete no cronograma", () => {
      const parcelas = [
        { id: "1", numero: 1, data: "2026-10-01", valor: 2000, tipo: "dinheiro", observacao: "Sinal" },
        { id: "2", numero: 2, data: "2026-11-01", valor: 2000, tipo: "dinheiro", observacao: "Final" },
      ];

      const dados = buildContractDados({
        razao_social: "Cliente Teste Ltda",
        parcelas,
        num_parcelas: "2",
        valor_parcela: "2000",
      });

      expect(dados.parcelas).toHaveLength(2);
      expect(dados.cronograma_pagamento).toContain("1ª Parcela — Vencimento: 01/10/2026");
      expect(dados.cronograma_pagamento).toContain("Total do Contrato: R$ 4.000,00");
    });
  });
});
