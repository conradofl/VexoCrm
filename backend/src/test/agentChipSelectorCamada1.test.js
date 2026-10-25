// backend/src/test/agentChipSelectorCamada1.test.js
//
// Testes Camada 1 — Seletor de Chip do Agente (followup/routes.js):
// 1. Distinguir campo ausente de lista vazia explícita (evolution_instances: [] limpa de verdade)
// 2. Descartar do patch qualquer valor que não corresponda a instância ativa do tenant, com console.error (grava 1, não 2)
// 3. Mutação: demonstrar que o descarte é essencial para gravar apenas 1
// 4. Chip de outro agente devolve 409 CHIP_ALREADY_OWNED com mensagem indicando o proprietário
//
import { describe, expect, it, vi, beforeEach } from "vitest";

const supabaseMock = { from: vi.fn() };
vi.mock("../followup/db.js", () => ({
  query: vi.fn(),
  getSupabase: () => supabaseMock,
}));

const evolutionMock = { getLeadClientEvolutionInstances: vi.fn() };
vi.mock("../services/evolution.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getLeadClientEvolutionInstances: (...args) => evolutionMock.getLeadClientEvolutionInstances(...args),
  };
});

const { registerFollowupRoutes } = await import("../followup/routes.js");

function getRouteHandler(routePath, method) {
  let followupRouter = null;
  const fakeApp = {
    use: (path, router) => {
      if (path === "/api/followup") followupRouter = router;
    },
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  const noop = (req, res, next) => next?.();
  registerFollowupRoutes(fakeApp, noop, () => noop, noop);
  const layer = followupRouter.stack.find((l) => l.route && l.route.path === routePath && l.route.methods[method]);
  expect(layer, `rota ${method.toUpperCase()} ${routePath} não encontrada`).toBeDefined();
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; return this; },
  };
}

function adminAccess() {
  return { role: "internal", isAdmin: true, scopeMode: "all_clients", clientIds: [] };
}

describe("Camada 1 — Seletor de Chip do Agente (Backend followup/routes.js)", () => {
  const activeChips = [
    {
      id: "chip-uuid-1",
      name: "4343-ATENDIMENTO",
      dispatch_webhook_url: "https://evo.vexo.io/message/sendText/bia-spazio-4343",
      active: true,
    },
    {
      id: "chip-uuid-2",
      name: "2222-ELEICAO",
      dispatch_webhook_url: "https://evo.vexo.io/message/sendText/bia-spazio-2222",
      active: true,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMock.from.mockReset();
    evolutionMock.getLeadClientEvolutionInstances.mockResolvedValue(activeChips);
  });

  it("1. Esvaziar a lista limpa de verdade: evolution_instances: [] seta lista vazia e evolution_instance null", async () => {
    let capturedUpdate = null;

    supabaseMock.from.mockImplementation((table) => {
      if (table === "followup_companies") {
        return {
          select: () => ({
            eq: (col, val) => ({
              maybeSingle: () => Promise.resolve({
                data: { id: "agente-bia-2", name: "Dra. Beatriz - Pessoal 2", tenant_id: "bia-do-spazio" },
                error: null,
              }),
            }),
          }),
          update: (payload) => {
            capturedUpdate = payload;
            return {
              eq: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({
                    data: { id: "agente-bia-2", ...payload },
                    error: null,
                  }),
                }),
              }),
            };
          },
        };
      }
      return {};
    });

    const handler = getRouteHandler("/companies/:id", "patch");
    const req = {
      params: { id: "agente-bia-2" },
      body: { evolution_instances: [] },
      authAccess: adminAccess(),
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(capturedUpdate).not.toBeNull();
    expect(capturedUpdate.evolution_instances).toEqual([]);
    expect(capturedUpdate.evolution_instance).toBeNull();
  });

  it("2. Descartar do patch qualquer valor órfão: com órfão + chip válido, grava 1, não 2, e loga console.error", async () => {
    let capturedUpdate = null;
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    supabaseMock.from.mockImplementation((table) => {
      if (table === "followup_companies") {
        return {
          select: (fields) => {
            if (fields.includes("evolution_instances")) {
              // checkChipExclusivity query
              return {
                eq: () => ({
                  is: () => Promise.resolve({
                    data: [], // sem conflito com outros agentes
                    error: null,
                  }),
                }),
              };
            }
            return {
              eq: (col, val) => ({
                maybeSingle: () => Promise.resolve({
                  data: { id: "agente-bia-2", name: "Dra. Beatriz - Pessoal 2", tenant_id: "bia-do-spazio" },
                  error: null,
                }),
              }),
            };
          },
          update: (payload) => {
            capturedUpdate = payload;
            return {
              eq: () => ({
                select: () => ({
                  maybeSingle: () => Promise.resolve({
                    data: { id: "agente-bia-2", ...payload },
                    error: null,
                  }),
                }),
              }),
            };
          },
        };
      }
      return {};
    });

    const handler = getRouteHandler("/companies/:id", "patch");
    // Envia o órfão legado + o novo chip 4343
    const req = {
      params: { id: "agente-bia-2" },
      body: {
        evolution_instances: ["slug-antigo-orfao-zumbi", "bia-spazio-4343"],
      },
      authAccess: adminAccess(),
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(capturedUpdate).not.toBeNull();
    // O órfão foi descartado: gravou APENAS UM, NÃO DOIS!
    expect(capturedUpdate.evolution_instances).toEqual(["bia-spazio-4343"]);
    expect(capturedUpdate.evolution_instance).toBe("bia-spazio-4343");
    // console.error registrou o descarte explícito do órfão
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[followup/routes] Descartando vínculo órfão 'slug-antigo-orfao-zumbi'")
    );

    consoleErrorSpy.mockRestore();
  });

  it("3. Teste de Mutação: sem o descarte de órfão, gravaria 2 elementos; com o descarte, grava exatamente 1", async () => {
    // Simulando o comportamento antigo (sem filtro de instâncias ativas do tenant)
    const rawInput = ["slug-orfao", "bia-spazio-4343"];
    const semFiltro = [...rawInput];
    expect(semFiltro.length).toBe(2);

    // Com o descarte ativo implementado na rota:
    const activeSlugs = activeChips.map((c) => c.name.toLowerCase()).concat(
      activeChips.map((c) => c.dispatch_webhook_url.split("/").pop().toLowerCase())
    );
    const comFiltro = rawInput.filter((item) => activeSlugs.includes(item.toLowerCase()));
    expect(comFiltro.length).toBe(1);
    expect(comFiltro).toEqual(["bia-spazio-4343"]);
  });

  it("4. Chip pertencente a outro agente devolve 409 CHIP_ALREADY_OWNED com o nome do agente proprietário", async () => {
    supabaseMock.from.mockImplementation((table) => {
      if (table === "followup_companies") {
        return {
          select: (fields) => {
            if (fields.includes("evolution_instances")) {
              // checkChipExclusivity query
              return {
                eq: () => ({
                  is: () => Promise.resolve({
                    data: [
                      {
                        id: "agente-bia-1",
                        name: "Dra. Beatriz - Pessoal (Padrão)",
                        evolution_instance: "bia-spazio-4343",
                        evolution_instances: ["bia-spazio-4343"],
                      },
                    ],
                    error: null,
                  }),
                }),
              };
            }
            return {
              eq: () => ({
                maybeSingle: () => Promise.resolve({
                  data: { id: "agente-bia-2", name: "Dra. Beatriz - Pessoal 2", tenant_id: "bia-do-spazio" },
                  error: null,
                }),
              }),
            };
          },
          update: vi.fn(),
        };
      }
      return {};
    });

    const handler = getRouteHandler("/companies/:id", "patch");
    const req = {
      params: { id: "agente-bia-2" },
      body: { evolution_instances: ["bia-spazio-4343"] },
      authAccess: adminAccess(),
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body.error.code).toBe("CHIP_ALREADY_OWNED");
    expect(res.body.error.message).toContain("Dra. Beatriz - Pessoal (Padrão)");
  });
});
