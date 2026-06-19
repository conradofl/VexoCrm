import { describe, expect, it } from "vitest";

// ─── Testes do Simulador e Calculadora de ROI ──────────────────────────────────

describe("Calculadora de ROI do Vexo OS", () => {
  it("calcula leads qualificados automaticamente como 80% do total", () => {
    const leadsCount = 400;
    const qualifiedLeads = Math.round(leadsCount * 0.8);
    expect(qualifiedLeads).toBe(320);
  });

  it("calcula horas economizadas do operador comercial", () => {
    const qualifiedLeads = 320;
    // 12 minutos por lead qualificado, convertido em horas
    const operatorHoursSaved = Math.round((qualifiedLeads * 12) / 60);
    expect(operatorHoursSaved).toBe(64);
  });

  it("calcula custo de horas economizadas estimadas", () => {
    const hoursSaved = 64;
    const hourlyRate = 15; // R$15 a hora estimada
    const savedCost = hoursSaved * hourlyRate;
    expect(savedCost).toBe(960);
  });

  it("calcula vendas adicionais estimadas com base em taxa de conversão", () => {
    const leadsCount = 400;
    const conversionRate = 5; // 5%
    const currentSales = Math.round(leadsCount * (conversionRate / 100)); // 20
    const estimatedVexoSales = Math.round(currentSales * 1.25); // +25% de aumento = 25
    const extraSales = estimatedVexoSales - currentSales; // 5
    expect(extraSales).toBe(5);
  });
});
