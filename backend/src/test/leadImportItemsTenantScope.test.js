// Isolamento de tenant em GET /api/lead-import-items — a rota que o visualizador de
// planilha salva usa. Exercita o HANDLER REAL registrado por registerLeadsRoutes, com o
// resolveAuthorizedClientId e o sendError REAIS (nao mockados): o que se prova aqui e o
// caminho que roda em producao, nao uma reimplementacao.

import { describe, expect, it, vi } from "vitest";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { resolveAuthorizedClientId } from "../services/tenant.js";
import { sendError } from "../services/httpInfra.js";

// Query builder encadeavel que registra cada filtro aplicado.
function makeQueryRecorder(rows) {
  const filters = [];
  const builder = {
    filters,
    select: () => builder,
    order: () => builder,
    limit: (...args) => {
      filters.push(["limit", ...args]);
      return builder;
    },
    not: (...args) => {
      filters.push(["not", ...args]);
      return builder;
    },
    eq: (column, value) => {
      filters.push(["eq", column, value]);
      return builder;
    },
    then: (resolve) => resolve({ data: rows, error: null }),
  };
  return builder;
}

function makeHarness({ rows = [], dispatchRows = [] } = {}) {
  const tables = [];
  const supabase = {
    from: (table) => {
      const builder = makeQueryRecorder(table === "campaign_dispatch_runs" ? dispatchRows : rows);
      tables.push({ table, builder });
      return builder;
    },
  };

  const handlers = {};
  const app = {
    get: (path, ...rest) => {
      handlers[`GET ${path}`] = rest[rest.length - 1];
    },
    post: () => {},
    patch: () => {},
    delete: () => {},
  };

  registerLeadsRoutes(app, {
    ensureDb: () => true,
    normalizeString: (v) => (typeof v === "string" && v.trim() ? v.trim() : null),
    resolveAuthorizedClientId,
    sendError,
    supabase,
    requireFirebaseAuth: () => {},
    requireAppViewAccess: () => () => {},
    requireInternalPageAccess: () => () => {},
  });

  return { handlers, tables };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(payload) {
      res.body = payload;
      return res;
    },
  };
  return res;
}

const TENANT_A = "empresa-a";
const TENANT_B = "empresa-b";

// Usuario de empresa, preso ao proprio tenant — o caso do enunciado.
function clientUserOf(tenant) {
  return { role: "client", scopeMode: "assigned_clients", clientId: tenant, clientIds: [tenant] };
}

describe("GET /api/lead-import-items — escopo de tenant", () => {
  it("usuario da empresa A pedindo import da empresa B recebe 403 e nao consulta o banco", async () => {
    const { handlers, tables } = makeHarness();
    const req = {
      authAccess: clientUserOf(TENANT_A),
      query: { clientId: TENANT_B, importId: "import-da-empresa-b" },
    };
    const res = makeRes();

    await handlers["GET /api/lead-import-items"](req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN_CLIENT_SCOPE");
    // O ponto que importa: barrou ANTES de tocar no banco.
    expect(tables).toHaveLength(0);
  });

  it("sem clientId explicito, o escopo cai no tenant do proprio usuario", async () => {
    const { handlers, tables } = makeHarness();
    const req = { authAccess: clientUserOf(TENANT_A), query: { importId: "qualquer" } };
    const res = makeRes();

    await handlers["GET /api/lead-import-items"](req, res);

    const itemsQuery = tables.find((t) => t.table === "lead_import_items");
    expect(itemsQuery.builder.filters).toContainEqual(["eq", "client_id", TENANT_A]);
    expect(itemsQuery.builder.filters).not.toContainEqual(["eq", "client_id", TENANT_B]);
  });

  it("client_id continua no filtro em todos os status, inclusive nos ignorados", async () => {
    for (const status of ["imported", "skipped", "all"]) {
      const { handlers, tables } = makeHarness();
      const req = {
        authAccess: clientUserOf(TENANT_A),
        query: { clientId: TENANT_A, importId: "import-1", status },
      };
      await handlers["GET /api/lead-import-items"](req, makeRes());

      const itemsQuery = tables.find((t) => t.table === "lead_import_items");
      expect(itemsQuery.builder.filters).toContainEqual(["eq", "client_id", TENANT_A]);
      expect(itemsQuery.builder.filters).toContainEqual(["eq", "import_id", "import-1"]);
      expect(itemsQuery.builder.filters.some((f) => f[0] === "limit")).toBe(false);
    }
  });

  it("status=skipped traz os ignorados; o default segue trazendo so importados", async () => {
    const skipped = makeHarness();
    await skipped.handlers["GET /api/lead-import-items"](
      { authAccess: clientUserOf(TENANT_A), query: { clientId: TENANT_A, status: "skipped" } },
      makeRes()
    );
    const skippedFilters = skipped.tables.find((t) => t.table === "lead_import_items").builder.filters;
    expect(skippedFilters).toContainEqual(["eq", "imported", false]);
    // Ignorado costuma ser exatamente a linha sem telefone: o filtro de telefone nao pode valer.
    expect(skippedFilters.some((f) => f[0] === "not" && f[1] === "telefone")).toBe(false);

    const legacy = makeHarness();
    await legacy.handlers["GET /api/lead-import-items"](
      { authAccess: clientUserOf(TENANT_A), query: { clientId: TENANT_A } },
      makeRes()
    );
    const legacyFilters = legacy.tables.find((t) => t.table === "lead_import_items").builder.filters;
    expect(legacyFilters).toContainEqual(["eq", "imported", true]);
    expect(legacyFilters.some((f) => f[0] === "not" && f[1] === "telefone")).toBe(true);
  });

  it("sem limit devolve tudo (contrato antigo); com limit pagina", async () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      id: `i${i}`,
      row_number: i + 1,
      telefone: `5511900000${String(i).padStart(3, "0")}`,
      normalized_data: { nome: `Lead ${i}` },
      imported: true,
      skip_reason: null,
    }));

    const semLimit = makeHarness({ rows });
    const resSem = makeRes();
    await semLimit.handlers["GET /api/lead-import-items"](
      { authAccess: clientUserOf(TENANT_A), query: { clientId: TENANT_A } },
      resSem
    );
    expect(resSem.body.items).toHaveLength(120);
    expect(resSem.body.page).toBeUndefined();
    const semLimitFilters = semLimit.tables.find((t) => t.table === "lead_import_items").builder.filters;
    expect(semLimitFilters).toContainEqual(["limit", 500]);

    const comLimit = makeHarness({ rows });
    const resCom = makeRes();
    await comLimit.handlers["GET /api/lead-import-items"](
      { authAccess: clientUserOf(TENANT_A), query: { clientId: TENANT_A, limit: "50", page: "2" } },
      resCom
    );
    expect(resCom.body.items).toHaveLength(50);
    expect(resCom.body.items[0].row_number).toBe(51);
    expect(resCom.body.matched).toBe(120);
  });

  it("busca filtra por nome e por telefone", async () => {
    const rows = [
      { id: "1", row_number: 1, telefone: "5511911111111", normalized_data: { nome: "Ana Souza" }, imported: true },
      { id: "2", row_number: 2, telefone: "5511922222222", normalized_data: { nome: "Bruno Lima" }, imported: true },
    ];

    const porNome = makeHarness({ rows });
    const resNome = makeRes();
    await porNome.handlers["GET /api/lead-import-items"](
      { authAccess: clientUserOf(TENANT_A), query: { clientId: TENANT_A, search: "bruno", limit: "50" } },
      resNome
    );
    expect(resNome.body.items).toHaveLength(1);
    expect(resNome.body.items[0].id).toBe("2");

    const porTelefone = makeHarness({ rows });
    const resTel = makeRes();
    await porTelefone.handlers["GET /api/lead-import-items"](
      { authAccess: clientUserOf(TENANT_A), query: { clientId: TENANT_A, search: "911111", limit: "50" } },
      resTel
    );
    expect(resTel.body.items).toHaveLength(1);
    expect(resTel.body.items[0].id).toBe("1");
  });
});
