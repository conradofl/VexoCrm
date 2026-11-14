// backend/src/test/dashboardQueueAccess.test.js
//
// Aba Atendimento: a lista de quem espera leva nome e telefone de lead. Ela só vai no payload do Dashboard para
// quem tem acesso à tela Conversas. O corte é no SERVIDOR, na entrega: quem não tem acesso recebe os números da
// fila, sem a lista. A guarda é a de verdade (a mesma das rotas /api/whatsapp/chats); o que é dublado é só o
// cálculo, que tem teste próprio.

import { beforeEach, describe, expect, it, vi } from "vitest";

const QUEUE = {
  states: { waiting: 2, withLead: 5, withRobot: 0, cooled: 9 },
  waitingOverThreshold: 1,
  thresholdHours: 3,
  oldest: [
    { phone: "5534991110001", name: "Jéssica Mendonça", chip: "Comercial", waitingSince: "2026-11-11T08:00:00.000Z" },
    { phone: "5534991110002", name: null, chip: "Pessoal", waitingSince: "2026-11-11T11:00:00.000Z" },
  ],
};
const METRICS = {
  period: "30d",
  summary: { sent: { current: 10, previous: 5, delta: 100 } },
  overview: { waiting: { status: "ready", waiting: 2, waitingOverThreshold: 1, thresholdHours: 3 }, queue: QUEUE },
};
const computeCalls = [];

vi.mock("../services/dashboardCalculations.js", async (importOriginal) => ({
  ...(await importOriginal()),
  getOrComputeDashboardMetrics: async (...args) => {
    computeCalls.push(args);
    return METRICS; // o MESMO objeto para todos, como o cache
  },
}));

const { registerInsightsRoutes } = await import("../domains/insights/routes.js");
const { ensureSharedRoutePageAccess } = await import("../access/notifications.js");
const { redactQueueListForViewer } = await import("../services/dashboardOverview.js");

function routes() {
  const table = {};
  const add = (method) => (path, ...handlers) => {
    table[`${method} ${path}`] = handlers[handlers.length - 1];
  };
  const app = { get: add("GET"), post: add("POST"), patch: add("PATCH"), put: add("PUT"), delete: add("DELETE") };
  registerInsightsRoutes(app, {
    ensureDb: () => true,
    ensureSharedRoutePageAccess, // a guarda de verdade
    resolveAuthorizedClientId: (_req, _res, id) => id || "tenant-a",
    requireFirebaseAuth: (_req, _res, next) => next?.(),
    requireInternalPageAccess: () => (_req, _res, next) => next?.(),
    normalizeString: (value) => (typeof value === "string" ? value.trim() : ""),
    sendError: (res, status, code, message) => res.status(status).json({ error: code, message }),
    pgDatabasePool: {},
    supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: "tenant-a", name: "Empresa" }, error: null }) }) }) }) },
  });
  return table;
}

async function call(handler, req) {
  const out = { status: 200, body: null };
  const res = {
    status(code) { out.status = code; return this; },
    json(body) { out.body = body; return this; },
  };
  await handler({ query: {}, body: {}, ...req }, res);
  return out;
}

const WHO = {
  admin: { role: "internal", isAdmin: true, internalPages: [] },
  internoComConversas: { role: "internal", internalPages: ["dashboard", "whatsapp"] },
  internoSemConversas: { role: "internal", internalPages: ["dashboard"] },
  clienteComConversas: { role: "client", clientId: "tenant-a", allowedViews: ["dashboard", "whatsapp"] },
  clienteSemConversas: { role: "client", clientId: "tenant-a", allowedViews: ["dashboard"] },
};
const get = (authAccess) => call(routes()["GET /api/dashboard"], { query: { clientId: "tenant-a", period: "30d" }, authAccess });
const refresh = (authAccess) => call(routes()["POST /api/dashboard/refresh"], { body: { clientId: "tenant-a", period: "30d" }, authAccess });

describe("Dashboard — lista de quem espera só para quem acessa Conversas", () => {
  beforeEach(() => {
    computeCalls.length = 0;
  });

  it.each(["admin", "internoComConversas", "clienteComConversas"])("[TESTE OBRIGATÓRIO] %s recebe a lista com nome e telefone", async (who) => {
    const { status, body } = await get(WHO[who]);
    expect(status).toBe(200);
    expect(body.overview.queue.oldest).toEqual(QUEUE.oldest);
    expect(body.overview.queue.listRestricted).toBeUndefined();
  });

  it.each(["internoSemConversas", "clienteSemConversas"])("[TESTE OBRIGATÓRIO] %s recebe os números da fila, sem a lista", async (who) => {
    const { status, body } = await get(WHO[who]);
    expect(status).toBe(200);
    // os números continuam
    expect(body.overview.queue.states).toEqual(QUEUE.states);
    expect(body.overview.queue.waitingOverThreshold).toBe(1);
    expect(body.overview.waiting).toEqual(METRICS.overview.waiting);
    expect(body.summary).toEqual(METRICS.summary);
    // a lista não
    expect(body.overview.queue.oldest).toEqual([]);
    expect(body.overview.queue.listRestricted).toBe(true);
    const raw = JSON.stringify(body);
    expect(raw).not.toContain("Jéssica");
    expect(raw).not.toContain("5534991110001");
    expect(raw).not.toContain("5534991110002");
  });

  it("[TESTE OBRIGATÓRIO] 'Atualizar agora' obedece à mesma regra: a resposta do recálculo não vaza a lista", async () => {
    const semAcesso = await refresh(WHO.clienteSemConversas);
    expect(semAcesso.status).toBe(200);
    expect(JSON.stringify(semAcesso.body)).not.toContain("Jéssica");
    expect(semAcesso.body.metrics.overview.queue.oldest).toEqual([]);
    expect(semAcesso.body.metrics.overview.queue.states).toEqual(QUEUE.states);

    const comAcesso = await refresh(WHO.clienteComConversas);
    expect(comAcesso.body.metrics.overview.queue.oldest).toEqual(QUEUE.oldest);
  });

  it("[TESTE OBRIGATÓRIO] cortar para um usuário não altera o que o próximo recebe (o cálculo é compartilhado)", async () => {
    await get(WHO.clienteSemConversas);
    expect(METRICS.overview.queue.oldest).toHaveLength(2); // o objeto do cache segue inteiro
    const depois = await get(WHO.clienteComConversas);
    expect(depois.body.overview.queue.oldest).toEqual(QUEUE.oldest);
  });

  it("quem não tem acesso ao Dashboard não recebe nada", async () => {
    const { status, body } = await get({ role: "client", clientId: "tenant-a", allowedViews: ["whatsapp"] });
    expect(status).toBe(403);
    expect(body.overview).toBeUndefined();
    expect(computeCalls).toHaveLength(0);
  });

  it("fila indisponível (null) ou payload sem a fila passa como está", () => {
    const semFila = { overview: { queue: null } };
    expect(redactQueueListForViewer(semFila, { canSeeConversations: false })).toBe(semFila);
    const antigo = { summary: {} };
    expect(redactQueueListForViewer(antigo, { canSeeConversations: false })).toBe(antigo);
  });
});
