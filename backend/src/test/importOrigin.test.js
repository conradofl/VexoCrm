// backend/src/test/importOrigin.test.js
//
// A origem de um lead importado por planilha é um fato, não um palpite. Sem coluna de origem e sem tag de
// canal, a origem é a própria importação — nunca "Instagram Direct" que ninguém escolheu. A tag de canal
// informada, a coluna de origem e as vendas fechadas continuam como sempre foram.

import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { sanitizePhone } from "../services/leadImport.js";
import { IMPORT_CHANNEL_RE, IMPORT_ORIGIN_KEY, IMPORT_ORIGIN_LABEL, resolveImportOrigin } from "../services/importOrigin.js";
import { createMockDb, createMockSupabase } from "./helpers/importCsvHarness.js";

describe("resolveImportOrigin (regra pura)", () => {
  it("[TESTE OBRIGATÓRIO] sem coluna de origem e sem tag de canal: a origem é a importação, sem tag de origem", () => {
    const o = resolveImportOrigin({ importTags: ["Lista Out/26"], rowTags: [], rowOrigem: undefined });

    expect(o).toEqual({ originTag: null, origem: IMPORT_ORIGIN_LABEL, origemMarketing: IMPORT_ORIGIN_KEY, leadSource: IMPORT_ORIGIN_KEY });
    expect(JSON.stringify(o)).not.toMatch(/instagram/i);
  });

  it("[TESTE OBRIGATÓRIO] tag de canal informada na importação continua valendo", () => {
    const o = resolveImportOrigin({ importTags: ["Lista X", "Facebook Ads"], rowTags: [] });
    expect(o).toMatchObject({ originTag: "Facebook Ads", origem: "Facebook Ads", origemMarketing: "Facebook Ads", leadSource: "Facebook Ads" });
  });

  it("tag de canal na própria linha também vale, mas a da importação tem prioridade", () => {
    expect(resolveImportOrigin({ importTags: [], rowTags: ["TikTok"] }).originTag).toBe("TikTok");
    expect(resolveImportOrigin({ importTags: ["LinkedIn"], rowTags: ["TikTok"] }).originTag).toBe("LinkedIn");
  });

  it("[TESTE OBRIGATÓRIO] coluna de origem da planilha continua valendo (sem canal informado)", () => {
    const o = resolveImportOrigin({ importTags: ["Lista X"], rowTags: [], rowOrigem: "  Indicação " });
    expect(o).toMatchObject({ originTag: "Indicação", origem: "Indicação", origemMarketing: "Indicação" });
  });

  it("coluna de origem vazia ou só espaços não vira origem: cai na importação", () => {
    expect(resolveImportOrigin({ importTags: [], rowTags: [], rowOrigem: "   " }).origem).toBe(IMPORT_ORIGIN_LABEL);
    expect(resolveImportOrigin({ importTags: [], rowTags: [], rowOrigem: "" }).originTag).toBeNull();
  });

  it("[TESTE OBRIGATÓRIO] vendas fechadas continua com o seu rótulo", () => {
    const o = resolveImportOrigin({ importTags: [], rowTags: [], isClosedSales: true });
    expect(o).toEqual({ originTag: "Importação Vendas Fechadas", origem: "Importação Vendas Fechadas", origemMarketing: "vendas_fechadas", leadSource: "vendas_fechadas" });
  });

  it("vendas fechadas vence a coluna de origem; canal informado vence tudo e mantém vendas_fechadas no marketing", () => {
    expect(resolveImportOrigin({ importTags: [], rowTags: [], rowOrigem: "Indicação", isClosedSales: true }).origem).toBe("Importação Vendas Fechadas");
    expect(resolveImportOrigin({ importTags: ["Instagram"], rowTags: [], isClosedSales: true })).toMatchObject({
      originTag: "Instagram",
      origemMarketing: "vendas_fechadas",
      leadSource: "vendas_fechadas",
    });
  });
});

describe("POST /api/leads/import-csv — a origem que o lead recebe", () => {
  let server;
  let baseUrl;
  let mockDb;
  const clientId = "tenant-origem";

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mockDb = createMockDb();
    registerLeadsRoutes(app, {
      ensureDb: () => true,
      pgDatabasePool: mockDb,
      requireFirebaseAuth: (req, _res, next) => {
        req.authAccess = { isAdmin: true, role: "internal", clientId };
        next();
      },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      resolveAuthorizedClientId: (_req, _res, cid) => cid || clientId,
      sanitizePhone: (p, ddd) => sanitizePhone(p, ddd),
      sendError: (res, status, code, msg) => res.status(status).json({ error: code, message: msg }),
      normalizeString: (s) => (s ? String(s).trim() : ""),
      supabase: createMockSupabase(),
    });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    mockDb.leads.length = 0;
  });

  const importar = async ({ rows, importTags, asClosedSales, withOrigemColumn = false }) => {
    const res = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        rows,
        importTags,
        asClosedSales,
        columnMapping: [
          { column: "Telefone", target: "telefone" },
          { column: "Nome", target: "nome" },
          ...(withOrigemColumn ? [{ column: "origem", target: "ignore" }] : []),
        ],
      }),
    });
    expect(res.status).toBe(200);
    return mockDb.leads[0];
  };

  const originTags = (lead) => (lead.tags || []).filter((t) => IMPORT_CHANNEL_RE.test(t));

  it("[TESTE OBRIGATÓRIO] planilha sem coluna de origem e sem tag de canal produz origem de importação, não Instagram", async () => {
    const lead = await importar({ rows: [{ Nome: "Ana", Telefone: "34991234567" }], importTags: ["Lista Out/26"] });

    expect(lead.dados.origem).toBe(IMPORT_ORIGIN_LABEL);
    expect(lead.dados.origem_marketing).toBe(IMPORT_ORIGIN_KEY);
    expect(lead.dados.lead_source).toBe(IMPORT_ORIGIN_KEY);
    expect(JSON.stringify(lead)).not.toMatch(/instagram/i);
  });

  it("[TESTE OBRIGATÓRIO] nenhum lead de planilha recebe duas tags de origem — e a padrão não ganha tag redundante", async () => {
    const lead = await importar({ rows: [{ Nome: "Ana", Telefone: "34991234567" }], importTags: ["Lista Out/26"] });

    expect(lead.tags).toEqual(["Lista Out/26"]); // só a tag da importação: ela já representa a origem
    expect(originTags(lead)).toHaveLength(0);
  });

  it("planilha sem nenhuma tag informada: o lead não ganha tag alguma de origem inventada", async () => {
    const lead = await importar({ rows: [{ Nome: "Ana", Telefone: "34991234567" }], importTags: [] });
    expect(lead.tags).toEqual([]);
    expect(lead.dados.origem).toBe(IMPORT_ORIGIN_LABEL);
  });

  it("[TESTE OBRIGATÓRIO] planilha com tag de canal continua usando a tag — uma só tag de origem", async () => {
    const lead = await importar({ rows: [{ Nome: "Ana", Telefone: "34991234567" }], importTags: ["Lista X", "Facebook Ads"] });

    expect(lead.dados.origem).toBe("Facebook Ads");
    expect(lead.dados.origem_marketing).toBe("Facebook Ads");
    expect(originTags(lead)).toEqual(["Facebook Ads"]);
    expect(lead.tags).not.toContain("Instagram Direct");
  });

  it("[TESTE OBRIGATÓRIO] planilha com coluna de origem continua usando a coluna", async () => {
    const lead = await importar({ rows: [{ Nome: "Ana", Telefone: "34991234567", origem: "Indicação" }], importTags: ["Lista X"] });

    expect(lead.dados.origem).toBe("Indicação");
    expect(lead.dados.origem_marketing).toBe("Indicação");
    expect(lead.tags).toEqual(expect.arrayContaining(["Lista X", "Indicação"]));
    expect(lead.tags).not.toContain("Instagram Direct");
  });

  it("[TESTE OBRIGATÓRIO] vendas fechadas continua com o seu rótulo", async () => {
    const lead = await importar({ rows: [{ Nome: "Ana", Telefone: "34991234567" }], importTags: ["Clientes 2025"], asClosedSales: true });

    expect(lead.dados.origem).toBe("Importação Vendas Fechadas");
    expect(lead.dados.origem_marketing).toBe("vendas_fechadas");
    expect(lead.dados.lead_source).toBe("vendas_fechadas");
    expect(lead.tags).toEqual(expect.arrayContaining(["Clientes 2025", "Venda Fechada", "Cliente Histórico", "Importação Vendas Fechadas"]));
    expect(lead.tags).not.toContain("Instagram Direct");
  });

  it("o identificador da importação continua sendo gravado, com a origem nova", async () => {
    const res = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        rows: [{ Nome: "Ana", Telefone: "34991234567" }],
        columnMapping: [
          { column: "Telefone", target: "telefone" },
          { column: "Nome", target: "nome" },
        ],
      }),
    });
    const body = await res.json();
    expect(mockDb.leads[0].dados.import_ids).toEqual([body.importId]);
  });
});
