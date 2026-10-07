// backend/src/test/leadImportDeduplication.test.js
//
// Testes do Detector e Deduplicador Inteligente de Importação:
// 1. Endpoint /api/lead-imports/analyze e helper analyzeImportDuplicates
//    - Identificação de colisões por telefone normalizado (canônico)
//    - Identificação de colisões por nome exato quando telefone for diferente
//    - Estrutura completa de retorno (totalRows, newCount, duplicateCount, duplicatesByPhone, duplicatesByName, sampleDuplicates)
// 2. Estratégias de Importação (merge, skip, overwrite) em upsertLeadsBatchByPhone

import { afterAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { analyzeImportDuplicates, canonicalPhone } from "../services/leadImportDeduplication.js";
import { upsertLeadsBatchByPhone } from "../services/leadUpsert.js";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { sanitizePhone, normalizeImportedLead } from "../services/leadImport.js";

const CLIENT_ID = "tenant-dedup-test";

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    telefone text NOT NULL,
    phone text,
    nome text,
    stage text DEFAULT 'cold',
    stage_source text,
    lost_reason text,
    temperature text DEFAULT 'warm',
    tags text[] DEFAULT ARRAY[]::text[],
    dados jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz DEFAULT now()
  );
  CREATE TABLE lead_imports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    source_name text NOT NULL,
    source_type text NOT NULL DEFAULT 'spreadsheet',
    total_rows integer NOT NULL DEFAULT 0,
    imported_rows integer NOT NULL DEFAULT 0,
    skipped_rows integer NOT NULL DEFAULT 0,
    uploaded_by_uid text,
    uploaded_by_email text,
    created_at timestamptz NOT NULL DEFAULT now(),
    column_mapping jsonb
  );
  CREATE TABLE lead_import_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id uuid NOT NULL REFERENCES lead_imports(id) ON DELETE CASCADE,
    client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    row_number integer NOT NULL,
    telefone text,
    lead_id uuid REFERENCES leads(id) ON DELETE SET NULL,
    imported boolean NOT NULL DEFAULT false,
    skip_reason text,
    raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    normalized_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
`;

const openServers = [];
afterAll(async () => {
  for (const s of openServers) {
    await s();
  }
});

async function setupTestDb() {
  const pool = await createPgliteDb(SCHEMA);
  await pool.query("INSERT INTO leads_clients (id, name) VALUES ($1, $2)", [CLIENT_ID, "Tenant Dedup"]);
  return pool;
}

describe("Detector e Deduplicador Inteligente de Importação", () => {
  describe("canonicalPhone helper", () => {
    it("normaliza telefones brasileiros para padrão 55 + DDD + dígitos", () => {
      expect(canonicalPhone("(34) 99771-9779")).toBe("5534997719779");
      expect(canonicalPhone("5534997719779")).toBe("5534997719779");
      expect(canonicalPhone("+55 (34) 99771-9779")).toBe("5534997719779");
      expect(canonicalPhone("99771-9779", "34")).toBe("5534997719779");
    });
  });

  describe("analyzeImportDuplicates service", () => {
    it("identifica duplicatas por telefone e nome, retornando contagens e amostras", async () => {
      const pool = await setupTestDb();

      // Lead 1: Cadastrado com telefone 5534997719779
      await pool.query(
        `INSERT INTO public.leads (client_id, telefone, phone, nome, tags)
         VALUES ($1, '5534997719779', '5534997719779', 'Caio Silva', ARRAY['lead_antigo'])`,
        [CLIENT_ID]
      );

      // Lead 2: Cadastrado com nome Beatriz Santos e outro telefone
      await pool.query(
        `INSERT INTO public.leads (client_id, telefone, phone, nome, tags)
         VALUES ($1, '5511988887777', '5511988887777', 'Beatriz Santos', ARRAY['cliente_vip'])`,
        [CLIENT_ID]
      );

      // Planilha de entrada para importação:
      // Linha 1: Caio com o mesmo telefone -> duplicado por telefone
      // Linha 2: Beatriz Santos com telefone diferente -> duplicado por nome
      // Linha 3: Daniel Novo -> novo lead
      const rows = [
        { Nome: "Caio Silva", Telefone: "(34) 99771-9779" },
        { Nome: "Beatriz Santos", Telefone: "(11) 91111-2222" },
        { Nome: "Daniel Novo", Telefone: "(34) 99999-0001" },
      ];

      const mapping = [
        { column: "Nome", target: "nome" },
        { column: "Telefone", target: "telefone" },
      ];

      const result = await analyzeImportDuplicates(pool, {
        clientId: CLIENT_ID,
        rows,
        columnMapping: mapping,
        defaultDdd: "34",
      });

      expect(result.totalRows).toBe(3);
      expect(result.newCount).toBe(1);
      expect(result.duplicateCount).toBe(2);
      expect(result.duplicatesByPhone).toBe(1);
      expect(result.duplicatesByName).toBe(1);
      expect(result.sampleDuplicates).toHaveLength(2);

      // Amostra do lead encontrado por telefone
      const caioSample = result.sampleDuplicates.find((s) => s.nome === "Caio Silva");
      expect(caioSample).toBeDefined();
      expect(caioSample.telefone).toBe("5534997719779");
      expect(caioSample.existingTags).toContain("lead_antigo");

      // Amostra do lead encontrado por nome
      const beatrizSample = result.sampleDuplicates.find((s) => s.nome === "Beatriz Santos");
      expect(beatrizSample).toBeDefined();
      expect(beatrizSample.existingTags).toContain("cliente_vip");
    });
  });

  describe("Endpoint HTTP POST /api/lead-imports/analyze", () => {
    it("responde 200 com métricas de duplicados e amostras", async () => {
      const pool = await setupTestDb();

      // Lead no banco
      await pool.query(
        `INSERT INTO public.leads (client_id, telefone, phone, nome, tags)
         VALUES ($1, '5534997719779', '5534997719779', 'Caio', ARRAY['teste1'])`,
        [CLIENT_ID]
      );

      const app = express();
      app.use(express.json());
      registerLeadsRoutes(app, {
        ensureDb: () => true,
        pgDatabasePool: pool,
        requireFirebaseAuth: (req, res, next) => {
          req.authAccess = { uid: "user-test", email: "user@test.com" };
          next();
        },
        requireBancoDeDadosOrCampanhas: (req, res, next) => next(),
        requireAppViewAccess: () => (_req, _res, next) => next(),
        requireInternalPageAccess: () => (_req, _res, next) => next(),
        resolveAuthorizedClientId: () => CLIENT_ID,
        sanitizePhone: (p, ddd) => sanitizePhone(p, ddd),
        normalizeImportedLead,
        sendError: (res, status, code, message) => res.status(status).json({ error: { code, message } }),
        normalizeString: (s) => (s ? String(s).trim() : ""),
      });

      const server = http.createServer(app);
      await new Promise((r) => server.listen(0, r));
      openServers.push(() => new Promise((r) => server.close(r)));
      const port = server.address().port;

      const res = await fetch(`http://localhost:${port}/api/lead-imports/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: CLIENT_ID,
          rows: [
            { nome: "Caio", telefone: "5534997719779" },
            { nome: "Mariana Nova", telefone: "5534991112222" },
          ],
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual({
        totalRows: 2,
        newCount: 1,
        duplicateCount: 1,
        duplicatesByPhone: 1,
        duplicatesByName: 0,
        sampleDuplicates: [
          {
            nome: "Caio",
            telefone: "5534997719779",
            existingTags: ["teste1"],
          },
        ],
      });
    });
  });

  describe("Estratégias de Deduplicação no upsertLeadsBatchByPhone", () => {
    it("estratégia 'merge': adiciona novas tags ao lead existente e não duplica a linha", async () => {
      const pool = await setupTestDb();

      // Lead inicial com tag 'base_original'
      await pool.query(
        `INSERT INTO public.leads (client_id, telefone, phone, nome, tags)
         VALUES ($1, '5534997719779', '5534997719779', 'Caio', ARRAY['base_original'])`,
        [CLIENT_ID]
      );

      // Nova importação contendo o mesmo telefone com nova tag 'imp_planilha_2'
      const leads = [
        {
          client_id: CLIENT_ID,
          telefone: "5534997719779",
          nome: "Caio Atualizado",
          tags: ["imp_planilha_2"],
        },
      ];

      const res = await upsertLeadsBatchByPhone(pool, CLIENT_ID, leads, {
        duplicateStrategy: "merge",
      });

      expect(res.insertedCount).toBe(0);
      expect(res.updatedCount).toBe(1);

      // Total de leads no banco continua sendo 1 (sem duplicata)
      const countRes = await pool.query("SELECT COUNT(*) FROM public.leads WHERE client_id = $1", [CLIENT_ID]);
      expect(Number(countRes.rows[0].count)).toBe(1);

      // Tags foram mescladas
      const leadRes = await pool.query("SELECT tags FROM public.leads WHERE client_id = $1", [CLIENT_ID]);
      expect(leadRes.rows[0].tags).toContain("base_original");
      expect(leadRes.rows[0].tags).toContain("imp_planilha_2");
    });

    it("estratégia 'skip': ignora leads já existentes, inserindo exclusivamente os novos", async () => {
      const pool = await setupTestDb();

      // Lead inicial
      await pool.query(
        `INSERT INTO public.leads (client_id, telefone, phone, nome, tags)
         VALUES ($1, '5534997719779', '5534997719779', 'Caio', ARRAY['base_original'])`,
        [CLIENT_ID]
      );

      // Lote com 1 lead repetido e 1 novo
      const leads = [
        {
          client_id: CLIENT_ID,
          telefone: "5534997719779",
          nome: "Caio Tentativa Modificacao",
          tags: ["tag_ignorada"],
        },
        {
          client_id: CLIENT_ID,
          telefone: "5534988880000",
          nome: "Novo Contato",
          tags: ["tag_novo"],
        },
      ];

      const res = await upsertLeadsBatchByPhone(pool, CLIENT_ID, leads, {
        duplicateStrategy: "skip",
      });

      expect(res.insertedCount).toBe(1);
      expect(res.updatedCount).toBe(0);

      // O lead antigo permanece inalterado
      const caioRes = await pool.query(
        "SELECT nome, tags FROM public.leads WHERE client_id = $1 AND telefone = '5534997719779'",
        [CLIENT_ID]
      );
      expect(caioRes.rows[0].nome).toBe("Caio");
      expect(caioRes.rows[0].tags).toEqual(["base_original"]);

      // O novo lead foi criado
      const novoRes = await pool.query(
        "SELECT nome, tags FROM public.leads WHERE client_id = $1 AND telefone = '5534988880000'",
        [CLIENT_ID]
      );
      expect(novoRes.rows[0].nome).toBe("Novo Contato");
    });

    it("estratégia 'overwrite': substitui tags e cadastro do lead existente", async () => {
      const pool = await setupTestDb();

      // Lead inicial
      await pool.query(
        `INSERT INTO public.leads (client_id, telefone, phone, nome, tags)
         VALUES ($1, '5534997719779', '5534997719779', 'Nome Antigo', ARRAY['tag_velha'])`,
        [CLIENT_ID]
      );

      const leads = [
        {
          client_id: CLIENT_ID,
          telefone: "5534997719779",
          nome: "Nome Sobrescrito",
          tags: ["tag_nova"],
        },
      ];

      const res = await upsertLeadsBatchByPhone(pool, CLIENT_ID, leads, {
        duplicateStrategy: "overwrite",
      });

      expect(res.insertedCount).toBe(0);
      expect(res.updatedCount).toBe(1);

      const leadRes = await pool.query("SELECT nome, tags FROM public.leads WHERE client_id = $1", [CLIENT_ID]);
      expect(leadRes.rows[0].nome).toBe("Nome Sobrescrito");
      expect(leadRes.rows[0].tags).toEqual(["tag_nova"]);
    });
  });
});
