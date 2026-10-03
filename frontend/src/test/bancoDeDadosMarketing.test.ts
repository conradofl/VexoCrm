import { describe, it, expect } from "vitest";
import {
  MARKETING_CHANNELS,
  getLeadSource,
  getLeadMarketingChannelId,
  type LeadIntelligenceItem,
} from "../pages/BancoDeDados";

describe("Banco de Dados - Inteligência de Origem & Atribuição de Marketing", () => {
  it("deve conter os canais principais de marketing (e o WhatsApp separado da origem não identificada)", () => {
    const channelIds = MARKETING_CHANNELS.map((c) => c.id);
    expect(channelIds).toContain("instagram");
    expect(channelIds).toContain("google");
    expect(channelIds).toContain("facebook");
    expect(channelIds).toContain("tiktok");
    expect(channelIds).toContain("indicacao");
    expect(channelIds).toContain("whatsapp");
    expect(channelIds).toContain("nao_identificada");
    expect(channelIds).not.toContain("whatsapp_outros"); // o cartão que misturava WhatsApp com o resto deixou de existir
  });

  it("deve extrair a origem do lead a partir de múltiplos campos com fallback seguro", () => {
    const lead1: LeadIntelligenceItem = {
      id: "1",
      client_id: "test",
      telefone: "11999999999",
      lead_source: "Instagram",
      created_at: new Date().toISOString(),
      nome: "Lead 1",
    };
    expect(getLeadSource(lead1)).toBe("Instagram");

    const lead2: LeadIntelligenceItem = {
      id: "2",
      client_id: "test",
      telefone: "11999999999",
      dados: { origem_marketing: "Google Ads" },
      created_at: new Date().toISOString(),
      nome: "Lead 2",
    };
    expect(getLeadSource(lead2)).toBe("Google Ads");

    const lead3: LeadIntelligenceItem = {
      id: "3",
      client_id: "test",
      telefone: "11999999999",
      dados: { origem: "TikTok" },
      created_at: new Date().toISOString(),
      nome: "Lead 3",
    };
    expect(getLeadSource(lead3)).toBe("TikTok");

    expect(getLeadSource(null)).toBe("Não informado");
    expect(getLeadSource(undefined)).toBe("Não informado");
  });

  it("deve classificar os leads nos canais corretos de marketing", () => {
    const makeLead = (source: string): LeadIntelligenceItem => ({
      id: "x",
      client_id: "test",
      telefone: "11999999999",
      lead_source: source,
      created_at: new Date().toISOString(),
      nome: "Teste",
    });

    expect(getLeadMarketingChannelId(makeLead("Instagram"))).toBe("instagram");
    expect(getLeadMarketingChannelId(makeLead("instagram"))).toBe("instagram");
    expect(getLeadMarketingChannelId(makeLead("insta stories"))).toBe("instagram");

    expect(getLeadMarketingChannelId(makeLead("Google Ads"))).toBe("google");
    expect(getLeadMarketingChannelId(makeLead("pesquisa google"))).toBe("google");

    expect(getLeadMarketingChannelId(makeLead("Facebook Ads"))).toBe("facebook");
    expect(getLeadMarketingChannelId(makeLead("face ads"))).toBe("facebook");

    expect(getLeadMarketingChannelId(makeLead("TikTok"))).toBe("tiktok");
    expect(getLeadMarketingChannelId(makeLead("tt video"))).toBe("tiktok");

    expect(getLeadMarketingChannelId(makeLead("Indicação"))).toBe("indicacao");
    expect(getLeadMarketingChannelId(makeLead("amigo indicou"))).toBe("indicacao");

    // WhatsApp é WhatsApp; formulário é orgânico; o que não tem origem NÃO vai para o WhatsApp
    expect(getLeadMarketingChannelId(makeLead("WhatsApp"))).toBe("whatsapp");
    expect(getLeadMarketingChannelId(makeLead("Formulário"))).toBe("organico");
    expect(getLeadMarketingChannelId(makeLead(""))).toBe("nao_identificada");
    expect(getLeadMarketingChannelId(null)).toBe("nao_identificada");
  });
});
