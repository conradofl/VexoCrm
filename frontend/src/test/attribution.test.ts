// src/test/attribution.test.ts
//
// A atribuição por canal (Raia 1) precisa conhecer TODO valor de origem que o sistema grava. A origem da
// planilha sem canal informado é "importacao_planilha": sem linha própria ela cairia em "Origem
// desconhecida" e a correção trocaria um número errado por um número inútil.

import { describe, it, expect } from "vitest";
import { ATTRIBUTION_CHANNELS, UNKNOWN_CHANNEL_LABEL, attributionChannelLabel, computeAttributionByChannel } from "../lib/attribution";

const IMPORT_LABEL = "📥 Importação de planilha";
const row = (rows: ReturnType<typeof computeAttributionByChannel>, channel: string) => rows.find((r) => r.channel === channel)!;

describe("atribuição por canal", () => {
  it("[TESTE OBRIGATÓRIO] lead com a origem nova aparece na linha própria, não em 'Origem desconhecida'", () => {
    const rows = computeAttributionByChannel([
      { dados: { origem_marketing: "importacao_planilha", origem: "Importação de planilha" }, stage: "cold", temperature: "cold" },
      { dados: { origem_marketing: "importacao_planilha" }, stage: "buyer" },
    ]);

    expect(row(rows, IMPORT_LABEL).total).toBe(2);
    expect(row(rows, UNKNOWN_CHANNEL_LABEL).total).toBe(0);
  });

  it("a linha 'Importação de planilha' existe mesmo sem nenhum lead (mesmo tratamento dos outros canais)", () => {
    const rows = computeAttributionByChannel([]);
    expect(row(rows, IMPORT_LABEL)).toMatchObject({ total: 0, qualified: 0, rate: 0, share: 0, revenue: 0 });
    expect(rows.map((r) => r.channel)).toContain(IMPORT_LABEL);
  });

  it("tem o mesmo tratamento dos outros canais: qualificados, conversão, participação e receita", () => {
    const rows = computeAttributionByChannel([
      { dados: { origem_marketing: "importacao_planilha" }, stage: "buyer" }, // qualificado
      { dados: { origem_marketing: "importacao_planilha" }, stage: "cold", temperature: "cold" }, // não
      { dados: { origem_marketing: "campanha" }, stage: "cold", temperature: "cold" },
      { dados: { origem_marketing: "campanha" }, stage: "cold", temperature: "cold" },
    ]);

    expect(row(rows, IMPORT_LABEL)).toMatchObject({ total: 2, qualified: 1, rate: 50, share: 50, revenue: 2500 });
    expect(row(rows, "📢 Campanha")).toMatchObject({ total: 2, qualified: 0, share: 50 });
  });

  it("a origem é lida na mesma ordem de sempre: lead_source, origem_marketing, origem", () => {
    expect(attributionChannelLabel({ lead_source: "importacao_planilha" })).toBe(IMPORT_LABEL);
    expect(attributionChannelLabel({ dados: { origem_marketing: "importacao_planilha" } })).toBe(IMPORT_LABEL);
    expect(attributionChannelLabel({ lead_source: "campanha", dados: { origem_marketing: "importacao_planilha" } })).toBe("📢 Campanha");
  });

  it("os canais que já existiam continuam, e valor desconhecido continua sendo 'Origem desconhecida'", () => {
    for (const [source, label] of [
      ["campanha", "📢 Campanha"],
      ["organico", "🌱 Orgânico"],
      ["trafego_pago", "🎯 Tráfego Pago"],
      ["whatsapp_ads", "📱 WhatsApp Ads"],
      ["indicacao", "🤝 Indicação"],
      ["extracao_whatsapp", "💬 Extração WhatsApp"],
      ["outro", "🌐 Outro"],
    ]) {
      expect(attributionChannelLabel({ dados: { origem_marketing: source } }), source).toBe(label);
    }
    expect(attributionChannelLabel({ dados: { origem_marketing: "algo-novo" } })).toBe(UNKNOWN_CHANNEL_LABEL);
    expect(attributionChannelLabel({})).toBe(UNKNOWN_CHANNEL_LABEL);
  });

  it("a soma das linhas fecha com o total de leads", () => {
    const leads = [{ dados: { origem_marketing: "importacao_planilha" } }, { dados: { origem_marketing: "campanha" } }, { dados: { origem_marketing: "xyz" } }, {}];
    const rows = computeAttributionByChannel(leads);
    expect(rows.reduce((s, r) => s + r.total, 0)).toBe(leads.length);
  });

  it("[TESTE OBRIGATÓRIO] o valor que o importador grava é exatamente o que o painel reconhece (os dois lados usam a mesma chave)", async () => {
    const { IMPORT_ORIGIN_KEY } = await import("../../../backend/src/services/importOrigin.js");
    expect(ATTRIBUTION_CHANNELS.map((c) => c.source)).toContain(IMPORT_ORIGIN_KEY);
  });
});
