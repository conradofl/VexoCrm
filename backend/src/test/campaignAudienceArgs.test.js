// PR 9a do untangle: prévia, destinatários e "executar pendentes" usam o MESMO público que o motor do lote.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { dispatchAudienceArgs, dispatchAudienceSegmentation } from "../campaign/audience.js";

const SEG_CAMPANHA = { gender: "female" };
const campanha = {
  id: "c1",
  import_id: "imp-1",
  analytics_meta: {
    segmentation: SEG_CAMPANHA,
    sequence: [{ id: "s1", type: "text", text: "Oi", order: 1, enabled: true }],
  },
};

describe("dispatchAudienceArgs", () => {
  it("usa a segmentação da campanha, não a do 1º passo (como o motor)", () => {
    const lote = { id: "d1", limit_per_run: 50, offset: 100, steps: [{ id: "s1", type: "text", text: "Oi", order: 1, enabled: true, segmentation: { gender: "male" } }] };
    expect(dispatchAudienceSegmentation(campanha, lote)).toEqual(SEG_CAMPANHA);
    const args = dispatchAudienceArgs({ clientId: "t1", campaign: campanha, dispatch: lote });
    expect(args).toMatchObject({ clientId: "t1", limit: 50, offset: 100, segmentation: SEG_CAMPANHA, excludeDispatchId: null });
    expect(args).not.toHaveProperty("excludeCampaignId");
  });

  it("ocorrência de recorrente: público inteiro (sem fatia), como o motor", () => {
    const lote = { id: "d1", limit_per_run: 50, offset: 100, steps: [] };
    expect(dispatchAudienceArgs({ clientId: "t1", campaign: campanha, dispatch: lote, occurrence: { isOccurrence: true } })).toMatchObject({ limit: null, offset: 0 });
  });

  it("lote sem fatia ou com limite inválido: sem limite", () => {
    expect(dispatchAudienceArgs({ clientId: "t1", campaign: campanha, dispatch: { limit_per_run: null } }).limit).toBeNull();
    expect(dispatchAudienceArgs({ clientId: "t1", campaign: campanha, dispatch: { limit_per_run: 0 } }).limit).toBeNull();
  });

  it("repassa as exclusões de quem chama", () => {
    expect(dispatchAudienceArgs({ clientId: "t1", campaign: campanha, dispatch: {}, excludeDispatchId: "d1", excludeCampaignId: "c1" })).toMatchObject({ excludeDispatchId: "d1", excludeCampaignId: "c1" });
  });

  it("a regra é a mesma expressão que o motor usa", () => {
    const motor = readFileSync(resolve("src/campaign/dispatchEngine.js"), "utf8");
    expect(motor).toMatch(/segmentation: validation\.analyticsMeta\.segmentation \|\| null/);
    expect(motor).toMatch(/const steps = dispatchSteps \? resolveEffectiveCampaignSequence\(dispatchSteps, campaignMeta\.sequence, null\) : campaignMeta\.sequence;/);
    const publico = readFileSync(resolve("src/campaign/audience.js"), "utf8");
    expect(publico).toMatch(/const steps = dispatchSteps \? resolveEffectiveCampaignSequence\(dispatchSteps, campaignMeta\.sequence, null\) : campaignMeta\.sequence;/);
    const rotas = readFileSync(resolve("src/domains/campaigns/routes.js"), "utf8");
    expect(rotas).not.toMatch(/segmentation: dispatch\.steps\?\.\[0\]\?\.segmentation/);
    // PR 9b: a criação do lote também não conta mais pela segmentação do 1º passo
    expect(rotas).not.toMatch(/sequence\?\.\[0\]\?\.segmentation/);
  });
});
