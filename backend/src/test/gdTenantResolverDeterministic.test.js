// Resolvedor de tenant do módulo GD sem roleta (passo 0, decisão do dono, 01/11/2026).
//
// Antes, client_id → tenants.id era ILIKE pelo nome e, sem casar, "SELECT id FROM public.tenants
// LIMIT 1" sem ORDER BY. Funcionava por sorte: uma linha só em tenants. Medido 01/11 02:23Z: as 341
// linhas gd_* + tenant_modules da Geração Digital estão no uuid-zero (rebatizado 'LivPub' pela
// migration 20260711091500). O primeiro tenant novo podia virar o LIMIT 1 e esconder tudo.
//
// O SQL roda num Postgres de verdade em memória (PGlite). O tenant intruso é inserido ANTES do
// uuid-zero de propósito: é o cenário em que o LIMIT 1 devolve a linha errada.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const ZERO = "00000000-0000-0000-0000-000000000000";
const INTRUSO = "7d1c5b0e-3a2f-4c8e-9b6a-1f2e3d4c5b6a";

const pg = vi.hoisted(() => ({ db: null }));

vi.mock("../services/database.js", () => ({
  pgDatabasePool: { query: (sql, params) => pg.db.query(sql, params) },
}));

const { resolveTenantUuid, resolveGdTenantUuid, tenantUuidForClientKey } = await import(
  "../domains/geracaoDigitalContracts/tenantResolver.js"
);

function mockRes() {
  const res = { statusCode: null, body: null, headersSent: false };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (payload) => {
    res.body = payload;
    res.headersSent = true;
    return res;
  };
  return res;
}

const interno = { role: "internal", isAdmin: false, scopeMode: "all_clients", clientId: null, clientIds: [] };
const clienteGd = { role: "client", scopeMode: "assigned_clients", clientId: "geracao-digital", clientIds: ["geracao-digital"] };
const clienteOutro = { role: "client", scopeMode: "assigned_clients", clientId: "container-led", clientIds: ["container-led"] };

async function resolverContrato(authAccess, clientId) {
  const res = mockRes();
  const tenantId = await resolveTenantUuid({ authAccess, query: { client_id: clientId }, body: {} }, res);
  return { tenantId, status: res.statusCode };
}

beforeAll(async () => {
  pg.db = new PGlite();
  await pg.db.exec(`CREATE TABLE public.tenants (id UUID PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT now())`);
});

afterAll(async () => {
  await pg.db.close();
});

beforeEach(async () => {
  await pg.db.exec(`DELETE FROM public.tenants`);
  // Intruso primeiro: é a linha que o LIMIT 1 sem ORDER BY devolve.
  await pg.db.query(`INSERT INTO public.tenants (id, name) VALUES ($1, 'Cliente Novo da Frente')`, [INTRUSO]);
  await pg.db.query(`INSERT INTO public.tenants (id, name) VALUES ($1, 'LivPub')`, [ZERO]);
});

describe("cenário perigoso existe de fato", () => {
  it("com duas linhas, o LIMIT 1 sem ORDER BY devolve o intruso, não a Geração Digital", async () => {
    const { rows } = await pg.db.query("SELECT id FROM public.tenants LIMIT 1");
    expect(rows[0].id).toBe(INTRUSO);
  });
});

describe("contratos e jurídico: resolveTenantUuid(req, res)", () => {
  it("interno com client_id 'geracao-digital' cai no uuid-zero mesmo com outro tenant na frente", async () => {
    expect(await resolverContrato(interno, "geracao-digital")).toEqual({ tenantId: ZERO, status: null });
  });

  it("tenant novo chamado 'geracao-digital' não sequestra a chave (o nome não decide mais)", async () => {
    await pg.db.query(`UPDATE public.tenants SET name = 'geracao-digital' WHERE id = $1`, [INTRUSO]);
    expect((await resolverContrato(interno, "geracao-digital")).tenantId).toBe(ZERO);
  });

  it("depois do passo 1 (uuid-zero renomeado para 'Geração Digital') continua no mesmo tenant", async () => {
    await pg.db.query(`UPDATE public.tenants SET name = 'Geração Digital' WHERE id = $1`, [ZERO]);
    expect((await resolverContrato(interno, "geracao-digital")).tenantId).toBe(ZERO);
  });

  it("usuário cliente atribuído à Geração Digital chega nos contratos dela", async () => {
    expect((await resolverContrato(clienteGd, "geracao-digital")).tenantId).toBe(ZERO);
  });

  it("usuário cliente de outra empresa, com chave sem mapa, recebe 404 e nenhum tenant", async () => {
    expect(await resolverContrato(clienteOutro, "container-led")).toEqual({ tenantId: null, status: 404 });
  });

  it("interno com chave sem mapa segue na Geração Digital, como era antes, mas sem depender da ordem do banco", async () => {
    expect((await resolverContrato(interno, "container-led")).tenantId).toBe(ZERO);
  });

  it("uuid explícito passa direto, inclusive o uuid-zero (o regex antigo recusava versão 0)", async () => {
    expect((await resolverContrato(interno, INTRUSO)).tenantId).toBe(INTRUSO);
    expect((await resolverContrato(interno, ZERO)).tenantId).toBe(ZERO);
  });
});

describe("rotas /api/gd/*: resolveGdTenantUuid(clientKey)", () => {
  it.each([[undefined], [""], ["geracao-digital"], [ZERO], ["livpub"]])(
    "client_id %s resolve para o uuid-zero com o intruso na frente",
    async (key) => {
      expect(await resolveGdTenantUuid(key)).toBe(ZERO);
    }
  );
});

describe("mapa explícito", () => {
  it("só a Geração Digital está mapeada; chave desconhecida não vira tenant nenhum", () => {
    expect(tenantUuidForClientKey("geracao-digital")).toBe(ZERO);
    expect(tenantUuidForClientKey("livpub")).toBeNull();
    expect(tenantUuidForClientKey("")).toBeNull();
    expect(tenantUuidForClientKey(undefined)).toBeNull();
  });

  it("nenhum dos dois resolvedores volta a consultar tenants por nome ou por LIMIT 1", () => {
    for (const file of ["../domains/geracaoDigitalContracts/tenantResolver.js", "../domains/geracaoDigitalRoutes.js"]) {
      const src = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(src, file).not.toMatch(/FROM public\.tenants LIMIT 1/);
      expect(src, file).not.toMatch(/FROM public\.tenants WHERE name ILIKE/);
    }
  });
});
