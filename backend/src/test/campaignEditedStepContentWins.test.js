// Passo editado na campanha vale no lote já criado (26/11/2026, Advocacia Almeida).
//
// O lote guarda uma cópia dos passos (campaign_dispatches.steps). Com a campanha do mesmo tamanho, a cópia vencia
// inteira: o passo trocado de imagem para "Link / Página", com a URL do Instagram, saía só com a legenda antiga.
// Agora o lote dita a estrutura e o conteúdo de cada passo vem da campanha (mesmo id).
import { describe, expect, it } from "vitest";
import { resolveEffectiveCampaignSequence } from "../campaign/dispatch.js";
import { buildTextPayload } from "../campaign-outbound.js";

const URL_REEL = "https://www.instagram.com/reels/AbCdEf12345/";

const loteSteps = [
  { id: "s1", type: "text", order: 1, text: "Olá, tudo bem?", triggerMode: "immediate" },
  { id: "s2", type: "text", order: 2, text: "Posso te explicar?", triggerMode: "after_reply" },
  { id: "s3", type: "image", order: 3, text: "PROFESSOR, VOCÊ TEM DIREITO", image: null, triggerMode: "after_reply" },
];

const liveSteps = [
  loteSteps[0],
  loteSteps[1],
  { id: "s3", type: "link", order: 3, text: "PROFESSOR, VOCÊ TEM DIREITO", linkUrl: URL_REEL, triggerMode: "after_reply" },
];

describe("passo editado na campanha vale no lote já criado", () => {
  it("mesmo tamanho: o passo 3 vem da campanha (link com URL), não da cópia do lote", () => {
    const seq = resolveEffectiveCampaignSequence(loteSteps, liveSteps, 2);
    expect(seq).toHaveLength(3);
    expect(seq[2].type).toBe("link");
    expect(seq[2].linkUrl).toBe(URL_REEL);

    const payload = buildTextPayload("5534999990000", seq[2], { lead: { nome: "Ana" } });
    expect(payload.text).toContain(URL_REEL);
    expect(payload.text).toContain("PROFESSOR, VOCÊ TEM DIREITO");
  });

  it("sem índice (disparo do lote): também usa o conteúdo editado", () => {
    const seq = resolveEffectiveCampaignSequence(loteSteps, liveSteps, null);
    expect(seq.map((s) => s.type)).toEqual(["text", "text", "link"]);
  });

  it("passo removido da campanha continua vindo do lote (caso Container LED)", () => {
    const seq = resolveEffectiveCampaignSequence(loteSteps, [liveSteps[0]], 1);
    expect(seq).toHaveLength(3);
    expect(seq[1]).toBe(loteSteps[1]);
    expect(seq[2]).toBe(loteSteps[2]);
  });

  it("passo sem id no lote fica como está", () => {
    const semId = [{ type: "text", order: 1, text: "velho" }];
    const seq = resolveEffectiveCampaignSequence(semId, [{ type: "text", order: 1, text: "novo" }], null);
    expect(seq[0].text).toBe("velho");
  });

  it("campanha expandida continua valendo inteira", () => {
    const seq = resolveEffectiveCampaignSequence(loteSteps.slice(0, 2), liveSteps, 1);
    expect(seq).toBe(liveSteps);
  });
});
