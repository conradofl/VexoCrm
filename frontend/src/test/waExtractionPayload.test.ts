// frontend/src/test/waExtractionPayload.test.ts
//
// Corpo de POST /api/leads/extract-wa-contacts com três origens marcáveis
// (conversas, agenda, grupos). Uma combinação é o estado de sempre —
// conversas+agenda ligadas, grupos desligada — e essa não pode mandar
// `sources` no corpo, senão a chamada deixa de ser idêntica à de hoje.

import { describe, it, expect } from "vitest";
import { buildWaExtractionPayload } from "../pages/BancoDeDados";

const base = { clientId: "tenant-teste", instanceId: "inst-1", chatLimit: 100 as const };

describe("buildWaExtractionPayload", () => {
  it("[TESTE OBRIGATÓRIO] nenhuma mudança do usuário — conversas+agenda ligadas, grupos desligada — sai sem sources", () => {
    const payload = buildWaExtractionPayload(base, { conversas: true, agenda: true, grupos: false }, []);
    expect(payload).toEqual(base);
    expect(payload).not.toHaveProperty("sources");
    expect(payload).not.toHaveProperty("groupIds");
  });

  it("[TESTE OBRIGATÓRIO] só conversas — sources com um item, sem groupIds", () => {
    const payload = buildWaExtractionPayload(base, { conversas: true, agenda: false, grupos: false }, []);
    expect(payload.sources).toEqual(["conversas"]);
    expect(payload).not.toHaveProperty("groupIds");
  });

  it("[TESTE OBRIGATÓRIO] só grupos — sources só com grupos, e os groupIds marcados", () => {
    const payload = buildWaExtractionPayload(base, { conversas: false, agenda: false, grupos: true }, ["g1@g.us", "g2@g.us"]);
    expect(payload.sources).toEqual(["grupos"]);
    expect(payload.groupIds).toEqual(["g1@g.us", "g2@g.us"]);
  });

  it("[TESTE OBRIGATÓRIO] as três juntas — sources com as três, e os groupIds marcados", () => {
    const payload = buildWaExtractionPayload(base, { conversas: true, agenda: true, grupos: true }, ["g1@g.us"]);
    expect(payload.sources).toEqual(["conversas", "agenda", "grupos"]);
    expect(payload.groupIds).toEqual(["g1@g.us"]);
  });
});
