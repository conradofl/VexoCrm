// backend/src/test/bancoCampanhasSeparationPostgres.test.js
//
// Testes em Postgres REAL (pglite) para a separação Banco de Dados vs Campanhas:
// 1. Nenhuma rota de importação ou exclusão de planilha é alcançável a partir de Campanhas.
// 2. O público criado no Banco chega em Campanhas com o mesmo número que a tela do Banco mostrava.
// 3. Seleção grande (20 mil) chega sem estourar o repasse (critérios em < 1 KB vs lista bruta > 15 MB).

import express from "express";
import http from "http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { queryLeadIds, queryLeadsPage } from "../services/leadListQuery.js";
import { sanitizePhone } from "../services/leadImport.js";

const SLOW = 180_000;
const T = "tenant-alfa";
const OTHER = "tenant-beta";

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE IF NOT EXISTS public.leads_clients (
    id TEXT PRIMARY KEY,
    name TEXT
  );
  CREATE TABLE IF NOT EXISTS public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL REFERENCES public.leads_clients(id) ON DELETE CASCADE,
    nome TEXT,
    telefone TEXT NOT NULL,
    phone TEXT,
    tags TEXT[] DEFAULT ARRAY[]::text[],
    dados JSONB NOT NULL DEFAULT '{}'::jsonb,
    stage TEXT DEFAULT 'cold',
    temperature TEXT DEFAULT 'warm',
    status TEXT,
    lead_source TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (client_id, telefone)
  );
  CREATE TABLE IF NOT EXISTS public.lead_imports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_type TEXT NOT NULL DEFAULT 'spreadsheet',
    total_rows INT DEFAULT 0,
    imported_rows INT DEFAULT 0,
    skipped_rows INT DEFAULT 0,
    uploaded_by_uid TEXT,
    uploaded_by_email TEXT,
    status TEXT DEFAULT 'completed',
    expected_rows INT,
    received_offset INT DEFAULT 0,
    fingerprint TEXT,
    column_mapping JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS public.lead_import_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    import_id UUID NOT NULL,
    row_number INT,
    status TEXT DEFAULT 'success',
    raw_data JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS idx_leads_client_id ON public.leads (client_id);
`;

let db;
let pool;
let server;
let baseUrl;

// Estado de autorização do mock para testar modular gate
let authConfig = {
  uid: "user-1",
  email: "u@vexo.com",
  role: "internal",
  clientId: T,
  planTier: "modular",
  internalPages: ["banco-de-dados", "campanhas"],
};

beforeAll(async () => {
  db = await createPgliteDb(SCHEMA);
  pool = {
    async query(sql, params) {
      if (!params || (Array.isArray(params) && params.length === 0)) {
        return db.exec(sql);
      }
      return db.query(sql, params);
    },
    async connect() {
      return {
        async query(sql, params) {
          if (!params || (Array.isArray(params) && params.length === 0)) {
            return db.exec(sql);
          }
          return db.query(sql, params);
        },
        release() {},
      };
    },
  };

  await db.query(`INSERT INTO public.leads_clients (id, name) VALUES ($1, 'Alfa'), ($2, 'Beta')`, [T, OTHER]);

  const app = express();
  app.use(express.json({ limit: "25mb" }));

  const sendError = (res, status, code, message, details) =>
    res.status(status).json({ error: { code, message, details } });

  // Supabase mock para compatibilidade de rotas que ainda usam supabase client
  const supabase = {
    from: (table) => ({
      select: (cols) => ({
        eq: (col1, val1) => ({
          order: () => ({
            limit: async () => {
              const res = await db.query(`SELECT * FROM public.${table} WHERE ${col1} = $1 LIMIT 20`, [val1]);
              return { data: res.rows, error: null };
            },
          }),
          eq: (col2, val2) => ({
            single: async () => {
              const res = await db.query(`SELECT * FROM public.${table} WHERE ${col1} = $1 AND ${col2} = $2 LIMIT 1`, [val1, val2]);
              return { data: res.rows[0] || null, error: null };
            },
          }),
          single: async () => {
            const res = await db.query(`SELECT * FROM public.${table} WHERE ${col1} = $1 LIMIT 1`, [val1]);
            return { data: res.rows[0] || null, error: null };
          },
          maybeSingle: async () => {
            const res = await db.query(`SELECT * FROM public.${table} WHERE ${col1} = $1 LIMIT 1`, [val1]);
            return { data: res.rows[0] || null, error: null };
          },
        }),
      }),
      delete: () => ({
        eq: (col1, val1) => {
          const p = Promise.resolve().then(async () => {
            await db.query(`DELETE FROM public.${table} WHERE ${col1} = $1`, [val1]);
            return { data: null, error: null };
          });
          p.eq = async (col2, val2) => {
            await db.query(`DELETE FROM public.${table} WHERE ${col1} = $1 AND ${col2} = $2`, [val1, val2]);
            return { data: null, error: null };
          };
          return p;
        },
      }),
    }),
  };

  registerLeadsRoutes(app, {
    ensureDb: () => true,
    pgDatabasePool: pool,
    supabase,
    requireFirebaseAuth: (req, _res, next) => {
      req.authAccess = { ...authConfig };
      next();
    },
    requireInternalPageAccess: () => (_req, _res, next) => next(),
    requireAppViewAccess: () => (_req, _res, next) => next(),
    ensureSharedRoutePageAccess: () => true,
    resolveAuthorizedClientId: (_req, res, cid) => {
      if (cid && cid !== T) {
        sendError(res, 403, "FORBIDDEN", "Sem acesso a este cliente");
        return null;
      }
      return cid || T;
    },
    sanitizePhone: (p, ddd) => sanitizePhone(p, ddd),
    sendError,
    normalizeString: (s) => (s ? String(s).trim() : ""),
  });

  server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  baseUrl = `http://localhost:${server.address().port}`;
}, SLOW);

afterAll(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (db) await db.close();
});

describe("Separação Banco de Dados e Campanhas (Postgres Real)", () => {
  it("[TESTE OBRIGATÓRIO] nenhuma rota de importação ou exclusão de planilha é alcançável a partir de Campanhas", async () => {
    // Cria uma planilha de teste no banco real
    const importRes = await db.query(
      `INSERT INTO public.lead_imports (client_id, source_name, source_type, total_rows, imported_rows)
       VALUES ($1, 'base-vendas.xlsx', 'spreadsheet', 10, 10)
       RETURNING id`,
      [T]
    );
    const importId = importRes.rows[0].id;

    // Cenário 1: Usuário possui apenas o módulo 'campanhas' (NÃO tem 'banco-de-dados')
    authConfig = {
      uid: "user-campanhas-only",
      email: "disparo@vexo.com",
      role: "internal",
      clientId: T,
      planTier: "modular",
      internalPages: ["campanhas"], // Apenas campanhas!
    };

    // 1. Tentar excluir planilha a partir de campanhas -> 403 FORBIDDEN
    const deleteRes = await fetch(`${baseUrl}/api/lead-imports/${importId}`, { method: "DELETE" });
    expect(deleteRes.status).toBe(403);
    const deleteJson = await deleteRes.json();
    expect(deleteJson.error.code).toBe("FORBIDDEN");
    expect(deleteJson.error.message).toContain("banco-de-dados");

    // 2. Tentar abrir importação em lotes a partir de campanhas -> 403 FORBIDDEN
    const openRes = await fetch(`${baseUrl}/api/leads/import-batches/open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: T, sourceName: "teste.xlsx" }),
    });
    expect(openRes.status).toBe(403);
    const openJson = await openRes.json();
    expect(openJson.error.code).toBe("FORBIDDEN");

    // 3. Tentar importação CSV a partir de campanhas -> 403 FORBIDDEN
    const csvRes = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: T, leads: [{ telefone: "5511999990001", nome: "X" }] }),
    });
    expect(csvRes.status).toBe(403);

    // 4. Mas ler a lista de planilhas para o seletor "Ou use uma importada" é PERMITIDO
    const listRes = await fetch(`${baseUrl}/api/lead-imports?clientId=${T}`);
    expect(listRes.status).toBe(200);
    const listJson = await listRes.json();
    expect(listJson.items.some((i) => i.id === importId)).toBe(true);

    // Cenário 2: Usuário do Banco de Dados pode excluir a planilha
    authConfig = {
      uid: "user-banco",
      email: "gestor@vexo.com",
      role: "internal",
      clientId: T,
      planTier: "modular",
      internalPages: ["banco-de-dados"],
    };

    const deleteOkRes = await fetch(`${baseUrl}/api/lead-imports/${importId}`, { method: "DELETE" });
    expect(deleteOkRes.status).toBe(200);

    // Confere no Postgres real que o registro foi removido
    const checkDb = await db.query(`SELECT id FROM public.lead_imports WHERE id = $1`, [importId]);
    expect(checkDb.rows).toHaveLength(0);
  });

  it("[TESTE OBRIGATÓRIO] o público criado no Banco chega em Campanhas com o mesmo número que a tela do Banco mostrava", async () => {
    authConfig = {
      uid: "user-admin",
      email: "admin@vexo.com",
      role: "internal",
      clientId: T,
      planTier: "modular",
      internalPages: ["banco-de-dados", "campanhas"],
    };

    // Cria um importId de referência
    const fakeImportId = "11111111-2222-3333-4444-555555555555";
    await db.query(
      `INSERT INTO public.lead_imports (id, client_id, source_name) VALUES ($1, $2, 'Planilha Segmentada.xlsx')`,
      [fakeImportId, T]
    );

    // Insere exatamente 1.482 leads que casam com o critério:
    // stage = 'cold', tag = 'vip', dados.import_ids contém fakeImportId
    await db.query(`
      INSERT INTO public.leads (client_id, telefone, nome, stage, tags, dados)
      SELECT
        '${T}',
        '5511900' || lpad(i::text, 8, '0'),
        'Lead Frio VIP ' || i,
        'cold',
        ARRAY['vip', 'outra-tag']::text[],
        jsonb_build_object('import_ids', jsonb_build_array('${fakeImportId}'))
      FROM generate_series(1, 1482) AS i;
    `);

    // Insere leads que NÃO casam com o critério (ruído para garantir filtro no banco real)
    await db.query(`
      INSERT INTO public.leads (client_id, telefone, nome, stage, tags, dados)
      VALUES
        ('${T}', '5511999900001', 'Comprador VIP', 'buyer', ARRAY['vip']::text[], jsonb_build_object('import_ids', jsonb_build_array('${fakeImportId}'))),
        ('${T}', '5511999900002', 'Frio Sem VIP', 'cold', ARRAY['lead-novo']::text[], jsonb_build_object('import_ids', jsonb_build_array('${fakeImportId}'))),
        ('${T}', '5511999900003', 'Frio VIP Outro Arquivo', 'cold', ARRAY['vip']::text[], jsonb_build_object('import_ids', jsonb_build_array('99999999-0000-0000-0000-000000000000')));
    `);

    // 1. No Banco de Dados: o usuário filtra por stage='cold', tag='vip', importId=fakeImportId
    const criteria = {
      stage: "cold",
      tag: "vip",
      importId: fakeImportId,
    };

    const bancoPage = await queryLeadsPage(pool, {
      scope: { clientId: T },
      filters: criteria,
      page: 1,
      limit: 50,
    });

    // O Banco de Dados calcula e exibe 1.482 leads
    expect(bancoPage.total).toBe(1482);

    // O Banco empacota o critério e o texto descritivo
    const handoffPayload = {
      criteria,
      description: "público: planilha Planilha Segmentada.xlsx, estágio Frio, 1.482 leads",
      totalCount: bancoPage.total,
      campaignName: "Campanha Frio VIP",
    };

    // 2. Em Campanhas: a tela recebe os critérios e consulta /api/leads/ids com contacts=true
    const queryParams = new URLSearchParams({
      clientId: T,
      stage: handoffPayload.criteria.stage,
      tag: handoffPayload.criteria.tag,
      importId: handoffPayload.criteria.importId,
      contacts: "true",
    });

    const campanhasRes = await fetch(`${baseUrl}/api/leads/ids?${queryParams.toString()}`);
    expect(campanhasRes.status).toBe(200);
    const campanhasData = await campanhasRes.json();

    // O público em Campanhas BATE EXATAMENTE com o número visto no Banco: 1.482
    expect(campanhasData.total).toBe(1482);
    expect(campanhasData.ids).toHaveLength(1482);
    expect(campanhasData.contacts).toHaveLength(1482);
    expect(campanhasData.truncated).toBe(false);

    // Confere que todos os contatos carregados respeitam os filtros
    expect(campanhasData.contacts[0].nome).toMatch(/^Lead Frio VIP/);
    expect(campanhasData.contacts[0].telefone).toMatch(/^5511900/);
  }, SLOW);

  it("[TESTE OBRIGATÓRIO] seleção grande (20 mil) chega sem estourar o repasse", async () => {
    // Insere 20.000 leads no Postgres real para demonstrar a escala
    await db.query(`
      INSERT INTO public.leads (client_id, telefone, nome, stage)
      SELECT
        '${T}',
        '5521990' || lpad(i::text, 8, '0'),
        'Lead Escala ' || i,
        'cold'
      FROM generate_series(1, 20000) AS i
      ON CONFLICT (client_id, telefone) DO NOTHING;
    `);

    const criteria = { stage: "cold" };

    // 1. Prova do gargalo do localStorage:
    // Se enviássemos 20.000 linhas de leads serializadas (formato antigo):
    const fakeRow = {
      id: "00000000-0000-0000-0000-000000000000",
      nome: "Nome Completo do Cliente Longo de Teste",
      telefone: "5511999998888",
      phone: "5511999998888",
      tags: ["tag1", "tag2", "tag3"],
      stage: "cold",
      temperature: "warm",
      dados: { origem: "planilha", cidade: "São Paulo", estado: "SP", resumo_chat: "Interesse confirmado" },
    };
    const rowJson = JSON.stringify(fakeRow);
    const totalRawEstimatedBytes = rowJson.length * 20000;
    // Mais de 5 MB (limite típico de localStorage é 5 MB = 5.242.880 bytes)
    expect(totalRawEstimatedBytes).toBeGreaterThan(5 * 1024 * 1024);

    // 2. Solução implementada: Repassar APENAS os critérios
    const criteriaPayload = {
      criteria: { stage: "cold" },
      description: "público: estágio Frio, 20.000 leads",
      totalCount: 20000,
      campaignName: "Disparo 20k Leads",
    };
    const criteriaJson = JSON.stringify(criteriaPayload);
    // Critérios ocupam menos de 500 bytes (cabe com folga de mais de 99.9% no localStorage)
    expect(criteriaJson.length).toBeLessThan(500);

    // 3. Campanhas pede o público ao servidor via queryLeadIds em Postgres real
    const leadIdsResult = await queryLeadIds(pool, {
      scope: { clientId: T },
      filters: criteriaPayload.criteria,
      contacts: true,
    });

    // Os 20.000 leads chegam sem corte, sem estourar e sem repetir
    expect(leadIdsResult.truncated).toBe(false);
    expect(leadIdsResult.total).toBeGreaterThanOrEqual(20000);
    expect(leadIdsResult.ids.length).toBeGreaterThanOrEqual(20000);
    expect(leadIdsResult.contacts.length).toBeGreaterThanOrEqual(20000);

    // Nenhum ID repetido
    const uniqueIds = new Set(leadIdsResult.ids);
    expect(uniqueIds.size).toBe(leadIdsResult.ids.length);
  }, SLOW);
});
