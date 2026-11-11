import { describe, expect, it } from "vitest";
import { buildDispatchRequestBody, resolveDispatchChipIds } from "@/lib/campaignDispatchRequest";
import type { CampaignDispatchOptions } from "@/hooks/useCampanhas";

const CHIPS = [
  { id: "chip-caio", isDefault: true },
  { id: "chip-gabriel" },
  { id: "chip-terceiro" },
];

const opcoes = (extra: Partial<CampaignDispatchOptions>) =>
  ({ leadDelaySeconds: 9, stopOnStepFailure: true, aiAssisted: false, ...extra }) as CampaignDispatchOptions;

const corpo = (dispatchOptions: CampaignDispatchOptions, chips = CHIPS) =>
  buildDispatchRequestBody({
    name: "Lote",
    steps: [],
    triggerType: "manual",
    scheduledAt: null,
    dispatchOptions,
    chips,
  });

describe("buildDispatchRequestBody: a lista de chips é a fonte, o singular deriva dela", () => {
  it("chip marcado sai no corpo, no singular e na lista", () => {
    const body = corpo(opcoes({ dispatchChipIds: ["chip-gabriel"] }));

    expect(body.evolutionInstanceId).toBe("chip-gabriel");
    expect(body.dispatch_options.dispatchChipIds).toEqual(["chip-gabriel"]);
  });

  it("dois marcados: os dois vão, e o singular é o primeiro", () => {
    const body = corpo(opcoes({ dispatchChipIds: ["chip-gabriel", "chip-terceiro"] }));

    expect(body.dispatch_options.dispatchChipIds).toEqual(["chip-gabriel", "chip-terceiro"]);
    expect(body.evolutionInstanceId).toBe("chip-gabriel");
  });

  it("singular salvo com valor próprio não vence a lista", () => {
    const body = corpo(opcoes({ evolutionInstanceId: "chip-terceiro", dispatchChipIds: ["chip-gabriel"] }));

    expect(body.evolutionInstanceId).toBe("chip-gabriel");
    expect(body.dispatch_options.evolutionInstanceId).toBe("chip-gabriel");
  });

  it("id que não é da empresa não aparece em lugar nenhum do corpo", () => {
    const body = corpo(opcoes({ evolutionInstanceId: "id-fantasma", dispatchChipIds: ["id-fantasma", "chip-gabriel"] }));

    expect(JSON.stringify(body)).not.toContain("id-fantasma");
    expect(body.dispatch_options.dispatchChipIds).toEqual(["chip-gabriel"]);
  });

  it("nada clicado: sai o chip padrão, o mesmo que a tela pinta", () => {
    const options = opcoes({});
    const body = corpo(options);

    expect(body.evolutionInstanceId).toBe("chip-caio");
    expect(body.dispatch_options.dispatchChipIds).toEqual(resolveDispatchChipIds(options, CHIPS));
  });

  it("empresa sem chip na tela: singular null e lista vazia, o backend resolve", () => {
    const body = corpo(opcoes({ evolutionInstanceId: "id-fantasma" }), []);

    expect(body.evolutionInstanceId).toBeNull();
    expect(body.dispatch_options.dispatchChipIds).toEqual([]);
  });

  it("não perde as demais opções nem manda limite e offset que não vieram", () => {
    const body = corpo(opcoes({ dispatchChipIds: ["chip-caio"] }));

    expect(body.dispatch_options.leadDelaySeconds).toBe(9);
    expect(body).not.toHaveProperty("limitPerRun");
    expect(body).not.toHaveProperty("offset");
  });

  it("lote leva limite e offset, inclusive offset zero", () => {
    const body = buildDispatchRequestBody({
      name: "Lote 1/2",
      steps: [],
      triggerType: "scheduled",
      scheduledAt: "2026-11-05T12:00:00.000Z",
      dispatchOptions: opcoes({ dispatchChipIds: ["chip-caio"] }),
      chips: CHIPS,
      limitPerRun: 100,
      offset: 0,
    });

    expect(body.limitPerRun).toBe(100);
    expect(body.offset).toBe(0);
    expect(body.scheduledAt).toBe("2026-11-05T12:00:00.000Z");
  });
});
