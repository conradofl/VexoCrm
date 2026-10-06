// src/test/leadChannels.test.ts
//
// O painel "Atribuição & Origem de Marketing" do Banco, contra a lista do que o sistema REALMENTE grava como
// origem (shared/leadOrigins.json — conferida contra o código no teste do backend). Se o sistema passar a
// gravar uma origem que o painel não sabe ler, ou se uma origem cair no cartão errado, isto quebra.

import { describe, it, expect } from "vitest";
import REGISTRY from "../../../shared/leadOrigins.json";
import bancoSrc from "../pages/BancoDeDados.tsx?raw";
import {
  MARKETING_CHANNELS,
  NOT_IDENTIFIED_CHANNEL_ID,
  computeMarketingMetrics,
  getLeadMarketingChannelId,
  getLeadSource,
} from "../lib/leadChannels";

const origins = REGISTRY.origins as Array<{ id: string; lead: Record<string, any>; expectedCard: string; reason?: string }>;
const cardIds = MARKETING_CHANNELS.map((c) => c.id);

describe("cada origem que o sistema grava tem o seu cartão", () => {
  it("o painel tem exatamente os cartões da lista compartilhada, sem sobra e sem falta", () => {
    expect([...cardIds].sort()).toEqual([...REGISTRY.cards].sort());
  });

  for (const origin of origins) {
    it(`[TESTE OBRIGATÓRIO] ${origin.id} → cartão '${origin.expectedCard}'`, () => {
      expect(getLeadMarketingChannelId(origin.lead)).toBe(origin.expectedCard);
      expect(cardIds).toContain(origin.expectedCard);
    });
  }

  it("[TESTE OBRIGATÓRIO] nenhuma origem gravada cai em 'não identificada' sem motivo registrado", () => {
    const naoIdentificadas = origins.filter((o) => getLeadMarketingChannelId(o.lead) === NOT_IDENTIFIED_CHANNEL_ID);

    expect(naoIdentificadas.length).toBeGreaterThan(0); // as que existem de fato
    for (const o of naoIdentificadas) expect(o.reason, `${o.id} caiu em não identificada sem motivo`).toBeTruthy();
    // e a recíproca: quem declara 'não identificada' como destino precisa mesmo cair lá
    for (const o of origins.filter((x) => x.expectedCard === NOT_IDENTIFIED_CHANNEL_ID)) expect(o.reason).toBeTruthy();
  });

  it("todo cartão da lista é o destino de alguma origem real (nenhum cartão fantasma), exceto os de canal pago que só vêm de tag/coluna", () => {
    const usados = new Set(origins.map((o) => o.expectedCard));
    for (const id of cardIds) {
      if (id === "google" || id === "tiktok") continue; // só chegam por tag/coluna informada pelo usuário
      expect(usados.has(id), `cartão '${id}' não recebe nenhuma origem da lista`).toBe(true);
    }
  });
});

describe("importação de planilha: cartão próprio", () => {
  it("[TESTE OBRIGATÓRIO] lead da planilha sem canal aparece no cartão da importação — não no WhatsApp, não no Instagram, não em desconhecida", () => {
    const lead = { tags: ["Lista Out/26"], dados: { origem: "Importação de planilha", origem_marketing: "importacao_planilha", lead_source: "importacao_planilha" } };

    expect(getLeadSource(lead)).toBe("importacao_planilha");
    expect(getLeadMarketingChannelId(lead)).toBe("importacao_planilha");
    expect(MARKETING_CHANNELS.find((c) => c.id === "importacao_planilha")!.name).toBe("Importação de planilha");
  });

  it("os vinte mil que saem de 'Instagram Direct' depois da correção entram no cartão da importação, e o Instagram deixa de contá-los", () => {
    const antes = Array.from({ length: 100 }, () => ({ tags: ["Lista Out/26", "Instagram Direct"], dados: { origem: "Instagram Direct", origem_marketing: "Instagram Direct" } }));
    const depois = antes.map(() => ({ tags: ["Lista Out/26"], dados: { origem: "Importação de planilha", origem_marketing: "importacao_planilha" } }));

    expect(computeMarketingMetrics(antes).counts).toMatchObject({ instagram: 100, importacao_planilha: 0 });
    expect(computeMarketingMetrics(depois).counts).toMatchObject({ instagram: 0, importacao_planilha: 100, whatsapp: 0, nao_identificada: 0 });
  });
});

describe("WhatsApp e origem não identificada são números separados", () => {
  const whatsapp = { tags: [], lead_source: "extracao_whatsapp", dados: { origem: "WhatsApp Extração", origem_marketing: "extracao_whatsapp" } };
  const semOrigem = { tags: [] };
  const desconhecida = { tags: [], dados: { origem: "Feira de negócios 2026" } };

  it("[TESTE OBRIGATÓRIO] WhatsApp só conta WhatsApp; o que não foi identificado conta à parte", () => {
    const { counts } = computeMarketingMetrics([whatsapp, whatsapp, semOrigem, desconhecida, { tags: [], lead_source: "outro" }]);

    expect(counts.whatsapp).toBe(2);
    expect(counts.nao_identificada).toBe(3);
  });

  it("há dois cartões distintos, com nomes que não se confundem", () => {
    const wa = MARKETING_CHANNELS.find((c) => c.id === "whatsapp")!;
    const nid = MARKETING_CHANNELS.find((c) => c.id === NOT_IDENTIFIED_CHANNEL_ID)!;

    expect(wa.name).toBe("WhatsApp");
    expect(nid.name).toBe("Origem não identificada");
    expect(MARKETING_CHANNELS.some((c) => /\//.test(c.name) && /whatsapp/i.test(c.name))).toBe(false); // sem "WhatsApp / Outros"
  });

  it("origem escrita à mão que o painel não reconhece (ex.: 'Feira') cai em não identificada, nunca em WhatsApp", () => {
    expect(getLeadMarketingChannelId(desconhecida)).toBe(NOT_IDENTIFIED_CHANNEL_ID);
    expect(getLeadMarketingChannelId({ tags: [], dados: { origem: "Não informado" } })).toBe(NOT_IDENTIFIED_CHANNEL_ID);
    expect(getLeadMarketingChannelId(undefined)).toBe(NOT_IDENTIFIED_CHANNEL_ID);
  });
});

describe("a soma dos cartões é o total de leads", () => {
  it("[TESTE OBRIGATÓRIO] com uma amostra de TODAS as origens da lista, mais as sem origem e as desconhecidas", () => {
    const leads = [...origins.map((o) => o.lead), ...origins.map((o) => o.lead), { tags: [] }, { tags: [], dados: { origem: "xyz" } }, { tags: ["LinkedIn"] }];

    const { total, counts, percentages } = computeMarketingMetrics(leads);

    expect(total).toBe(leads.length);
    expect(Object.values(counts).reduce((s, n) => s + n, 0)).toBe(leads.length);
    for (const id of cardIds) expect(counts[id], id).toBeGreaterThanOrEqual(0);
    expect(Object.keys(percentages).sort()).toEqual([...cardIds].sort());
  });

  it("lista vazia: todos os cartões em zero, sem dividir por zero", () => {
    const { total, counts, percentages } = computeMarketingMetrics([]);
    expect(total).toBe(0);
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);
    expect(Object.values(percentages).every((n) => n === 0)).toBe(true);
  });

  it("todo lead cai em exatamente um cartão que existe (nunca um id fora da lista)", () => {
    for (const o of origins) expect(cardIds).toContain(getLeadMarketingChannelId(o.lead));
    expect(cardIds).toContain(getLeadMarketingChannelId({ tags: ["qualquer"], lead_source: "valor-nunca-visto" }));
  });
});

describe("o que já funcionava continua", () => {
  it("a tag de canal ainda vence (lead com tag Instagram é Instagram)", () => {
    expect(getLeadMarketingChannelId({ tags: ["Lista", "Instagram Direct"], dados: { origem: "Importação de planilha", origem_marketing: "importacao_planilha" } })).toBe("instagram");
  });

  it("Google, Facebook, TikTok e Indicação continuam pelos mesmos textos", () => {
    const l = (source: string) => ({ tags: [], lead_source: source });
    expect(getLeadMarketingChannelId(l("pesquisa google"))).toBe("google");
    expect(getLeadMarketingChannelId(l("face ads"))).toBe("facebook");
    expect(getLeadMarketingChannelId(l("tt video"))).toBe("tiktok");
    expect(getLeadMarketingChannelId(l("amigo indicou"))).toBe("indicacao");
  });
});

describe("o Banco de Dados usa esta regra (e não uma cópia)", () => {
  it("[TESTE OBRIGATÓRIO] a tela monta os cartões com as contagens do banco (computeMarketingMetricsFromCounts) e não conhece mais o cartão misto", () => {
    // os cartões são a base INTEIRA, agregada no banco (facets), não a página carregada
    expect(bancoSrc).toContain("computeMarketingMetricsFromCounts(facets?.channels");
    expect(bancoSrc).not.toContain("computeMarketingMetrics(leads)");
    expect(bancoSrc).toContain('from "@/lib/leadChannels"');
    expect(bancoSrc).not.toContain("whatsapp_outros");
    expect(bancoSrc).not.toContain("WhatsApp / Outros");
  });
});
