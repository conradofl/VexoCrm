// O rótulo do cartão do passo segue o TIPO escolhido, não a posição (26/11/2026: o passo 3 aparecia como
// "MÍDIA / IMAGEM" sendo texto e parecia que o tipo estava "chumbado").
import { describe, expect, it } from "vitest";
import { getStepChromaticStyle } from "@/pages/LeadImports/MessageSequenceStep";

describe("rótulo do passo pelo tipo", () => {
  it("texto em qualquer posição é TEXTO (inclusive o passo 3)", () => {
    for (const ordem of [1, 2, 3, 4, 5]) expect(getStepChromaticStyle(ordem, "text").badgeText).toBe(`💬 PASSO ${ordem} · TEXTO`);
  });
  it("imagem em qualquer posição é MÍDIA / IMAGEM", () => {
    for (const ordem of [1, 2, 3, 7]) expect(getStepChromaticStyle(ordem, "image").badgeText).toBe(`🖼️ PASSO ${ordem} · MÍDIA / IMAGEM`);
  });
  it("link em qualquer posição é LINK / PÁGINA", () => {
    for (const ordem of [1, 2, 3]) expect(getStepChromaticStyle(ordem, "link").badgeText).toBe(`🔗 PASSO ${ordem} · LINK / PÁGINA`);
  });
  it("nenhum rótulo depende só da posição (sem DISPARO INICIAL / PÓS-RESPOSTA fixos)", () => {
    const todos = [1, 2, 3].flatMap((o) => (["text", "image", "link"] as const).map((t) => getStepChromaticStyle(o, t).badgeText));
    expect(todos.join(" ")).not.toMatch(/DISPARO INICIAL|PÓS-RESPOSTA/);
  });
});
