// backend/src/test/campaignEditPreservesConfig.test.js
//
// Editar e salvar uma campanha (PATCH /api/campaigns/:id) apagava configuracao em silencio.
// Reproduzido em producao em 29/10/2026 (campanha 0423a574, tenant bia-do-spazio):
//   - analytics_meta.dispatch sumia inteiro (o PATCH gravava o analytics_meta do corpo, sem mesclar com o salvo);
//   - dispatchOptions perdia dispatchChipIds, dailyQuotaPerChip, minWaitSeconds, maxWaitSeconds e
//     maxRepetitionsPerTemplate (a lista branca de normalizeDispatchOptions descartava tudo que nao conhecia);
//   - campaigns.updated_at nao mudava.
// Estas cinco chaves sao a protecao anti-ban (rodizio de chip, cota por chip, intervalo, repeticao de texto).

import { describe, expect, it, vi, afterEach } from "vitest";
import { registerCampaignsRoutes } from "../domains/campaigns/routes.js";
import { normalizeCampaignAnalyticsMeta } from "../campaign-outbound.js";

const CHIPS = ["chip-a", "chip-b", "chip-c"];

const PROTECAO = {
  dispatchChipIds: CHIPS,
  dailyQuotaPerChip: 200,
  minWaitSeconds: 15,
  maxWaitSeconds: 45,
  maxRepetitionsPerTemplate: 5,
};

function campanhaSalva() {
  return {
    id: "camp-1",
    client_id: "tenant-1",
    import_id: "imp-1",
    is_recurring: false,
    analytics_meta: {
      message: "Olá {{nome}}",
      sequence: [{ id: "s1", type: "text", text: "Olá {{nome}}", order: 1 }],
      segmentation: { filters: [] },
      dispatchOptions: {
        leadDelaySeconds: 2,
        evolutionInstanceId: "chip-a",
        ...PROTECAO,
        trackLinks: false,
        multiAgendaEnabled: true,
      },
      dispatch: {
        status: "draft",
        createdAt: "2026-10-29T14:28:02.911Z",
        updatedAt: "2026-10-29T14:28:02.911Z",
      },
    },
  };
}

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) { this.statusCode = s; return this; },
    json(b) { this.body = b; return this; },
  };
}

function montarRota(current) {
  const gravacoes = [];
  const supabase = {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: structuredClone(current), error: null }) }) }),
      update: (fields) => {
        gravacoes.push(structuredClone(fields));
        return {
          eq: () => ({
            eq: () => ({
              select: () => ({
                single: async () => ({ data: { ...current, ...fields }, error: null }),
              }),
            }),
          }),
        };
      },
    }),
  };
  const deps = {
    ensureDb: () => true,
    getLeadClientEvolutionInstances: async () => [],
    internalErrorPayloadDetails: () => ({}),
    isMissingSchemaError: () => false,
    normalizeString: (s) => String(s ?? "").trim(),
    pgDatabasePool: { query: async () => ({ rows: [] }) },
    requireAppViewAccess: () => (req, res, next) => next(),
    requireCampaignDispatchAccess: (req, res, next) => next(),
    requireFirebaseAuth: (req, res, next) => next(),
    requireInternalPageAccess: () => (req, res, next) => next(),
    resolveAuthorizedClientId: () => "tenant-1",
    resolveRequiredAuthorizedClientId: () => "tenant-1",
    resolveTenantTimezone: async () => "America/Sao_Paulo",
    sendError: (res, status, code, message) => {
      res.statusCode = status;
      res.body = { error: { code, message } };
    },
    supabase,
  };
  const routes = {};
  const app = {
    get: (p, ...h) => { routes[`get ${p}`] = h[h.length - 1]; },
    post: (p, ...h) => { routes[`post ${p}`] = h[h.length - 1]; },
    put: (p, ...h) => { routes[`put ${p}`] = h[h.length - 1]; },
    patch: (p, ...h) => { routes[`patch ${p}`] = h[h.length - 1]; },
    delete: (p, ...h) => { routes[`delete ${p}`] = h[h.length - 1]; },
    use: () => {},
  };
  registerCampaignsRoutes(app, deps);
  return { patch: routes["patch /api/campaigns/:id"], gravacoes };
}

// O que a tela de edicao (LeadImports.tsx) manda: o analytics_meta montado a partir do formulario, que nao
// carrega a chave `dispatch` e, para dispatchOptions, so o que esta no estado do formulario.
function corpoDaTela(dispatchOptions) {
  return {
    name: "Campanha editada",
    analyticsMeta: {
      audienceCriteria: null,
      segmentation: { filters: [] },
      message: "Olá de novo {{nome}}",
      sequence: [{ id: "s1", type: "text", text: "Olá de novo {{nome}}", order: 1 }],
      dispatchOptions,
    },
  };
}

async function salvar(patch, body) {
  const res = fakeRes();
  await patch({ params: { id: "camp-1" }, body }, res);
  return res;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("editar campanha nao apaga configuracao (PATCH /api/campaigns/:id)", () => {
  it("a tela recebe as cinco chaves de protecao ao abrir a campanha (leitura nao descarta)", () => {
    const lido = normalizeCampaignAnalyticsMeta(campanhaSalva().analytics_meta);
    expect(lido.dispatchOptions).toMatchObject(PROTECAO);
    expect(lido.dispatchOptions.trackLinks).toBe(false);
    expect(lido.dispatchOptions.multiAgendaEnabled).toBe(true);
  });

  it("round-trip: a tela reenviando as cinco chaves sai com as cinco intactas", async () => {
    const { patch, gravacoes } = montarRota(campanhaSalva());
    const aberto = normalizeCampaignAnalyticsMeta(campanhaSalva().analytics_meta);
    const res = await salvar(patch, corpoDaTela({ ...aberto.dispatchOptions, leadDelaySeconds: 3 }));

    expect(res.statusCode).toBe(200);
    expect(gravacoes).toHaveLength(1);
    const gravado = gravacoes[0].analytics_meta;
    expect(gravado.dispatchOptions).toMatchObject({ ...PROTECAO, leadDelaySeconds: 3 });
    expect(gravado.message).toBe("Olá de novo {{nome}}");
    expect(res.body.item.analytics_meta.dispatchOptions).toMatchObject(PROTECAO);
  });

  it("chave ausente no corpo significa 'nao mexer': as cinco sobrevivem mesmo se a tela nao manda", async () => {
    const { patch, gravacoes } = montarRota(campanhaSalva());
    const res = await salvar(patch, corpoDaTela({ leadDelaySeconds: 4 }));

    expect(res.statusCode).toBe(200);
    const opcoes = gravacoes[0].analytics_meta.dispatchOptions;
    expect(opcoes).toMatchObject({ ...PROTECAO, leadDelaySeconds: 4 });
    expect(opcoes.trackLinks).toBe(false);
    expect(opcoes.multiAgendaEnabled).toBe(true);
  });

  it("analytics_meta.dispatch sobrevive ao salvar", async () => {
    const { patch, gravacoes } = montarRota(campanhaSalva());
    await salvar(patch, corpoDaTela({ leadDelaySeconds: 2 }));

    expect(gravacoes[0].analytics_meta.dispatch).toEqual(campanhaSalva().analytics_meta.dispatch);
  });

  it("updated_at e carimbado e muda a cada edicao", async () => {
    vi.useFakeTimers();
    const { patch, gravacoes } = montarRota(campanhaSalva());

    vi.setSystemTime(new Date("2026-10-29T15:20:00.000Z"));
    await salvar(patch, corpoDaTela({ leadDelaySeconds: 2 }));
    vi.setSystemTime(new Date("2026-10-29T15:22:23.000Z"));
    await salvar(patch, { name: "So o nome" });

    expect(gravacoes.map((g) => g.updated_at)).toEqual([
      "2026-10-29T15:20:00.000Z",
      "2026-10-29T15:22:23.000Z",
    ]);
  });

  it("remover protecao de proposito e respeitado, mas a resposta avisa", async () => {
    const { patch, gravacoes } = montarRota(campanhaSalva());
    const res = await salvar(patch, corpoDaTela({ dispatchChipIds: ["chip-a"], dailyQuotaPerChip: null }));

    expect(res.statusCode).toBe(200);
    const opcoes = gravacoes[0].analytics_meta.dispatchOptions;
    expect(opcoes.dispatchChipIds).toEqual(["chip-a"]);
    expect(opcoes.dailyQuotaPerChip).toBeNull();
    expect(opcoes.minWaitSeconds).toBe(15);
    const campos = res.body.dispatchProtectionWarnings.map((w) => w.field).sort();
    expect(campos).toEqual(["dailyQuotaPerChip", "dispatchChipIds"]);
  });

  it("edicao que nao mexe na protecao nao gera aviso", async () => {
    const { patch } = montarRota(campanhaSalva());
    const res = await salvar(patch, corpoDaTela({ leadDelaySeconds: 2 }));

    expect(res.body.dispatchProtectionWarnings).toEqual([]);
  });
});
