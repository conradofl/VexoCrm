// backend/src/test/campaignAudienceMultiTagPostgres.test.js
//
// Testes obrigatórios do público de campanha com Postgres REAL (pglite):
// a) duas tags selecionadas: entram leads que têm UMA das duas (prova do OU)
// b) lead que tem AS DUAS tags aparece UMA VEZ só (sem duplicata)
// c) lead sem nenhuma das tags NÃO entra
// d) uma tag só: resultado idêntico ao do campo tag antigo (compatibilidade)
// e) lista vazia: nenhum filtro de tag é aplicado

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { queryCampaignAudience } from "../services/leadListQuery.js";

const CLIENT_ID = "empresa-campanha-multitag";
const scope = { clientId: CLIENT_ID };

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE leads_clients (id text PRIMARY KEY, name text);
  CREATE TABLE leads (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id text NOT NULL REFERENCES leads_clients(id) ON DELETE CASCADE,
    telefone text NOT NULL,
    phone text,
    nome text,
    tags text[] DEFAULT ARRAY[]::text[],
    stage text DEFAULT 'cold',
    temperature text DEFAULT 'warm',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    raw_chat_summary text,
    dados jsonb NOT NULL DEFAULT '{}'::jsonb
  );
`;

let db;
let pool;

function createMockPool(instance) {
  return {
    async query(sql, params) {
      if (!params || (Array.isArray(params) && params.length === 0)) {
        return instance.exec(sql);
      }
      return instance.query(sql, params);
    },
  };
}

beforeAll(async () => {
  db = await createPgliteDb();
  pool = createMockPool(db);

  await db.exec(SCHEMA);
  await db.query(`INSERT INTO leads_clients (id, name) VALUES ($1, $2)`, [CLIENT_ID, "Empresa Teste MultiTag"]);

  // Inserção da base controlada de teste:
  // Lead 1: tem tagA
  // Lead 2: tem tagB
  // Lead 3: tem tagA e tagB (sobreposição)
  // Lead 4: tem tagC (outra tag)
  // Lead 5: tem tagC e tagD (sobreposição)
  // Lead 6: tem tagE (fora das 4 tags)
  // Lead 7: sem tags
  await db.query(
    `INSERT INTO leads (client_id, telefone, nome, tags, stage) VALUES
      ($1, '551199990001', 'Lead Tag A', ARRAY['tagA'], 'cold'),
      ($1, '551199990002', 'Lead Tag B', ARRAY['tagB'], 'cold'),
      ($1, '551199990003', 'Lead Tags AB', ARRAY['tagA', 'tagB'], 'cold'),
      ($1, '551199990004', 'Lead Tag C', ARRAY['tagC'], 'cold'),
      ($1, '551199990005', 'Lead Tags CD', ARRAY['tagC', 'tagD'], 'cold'),
      ($1, '551199990006', 'Lead Tag E', ARRAY['tagE'], 'cold'),
      ($1, '551199990007', 'Lead Sem Tag', ARRAY[]::text[], 'cold')`,
    [CLIENT_ID]
  );
});

afterAll(async () => {
  if (db) await db.close();
});

describe("Público de Campanha por Múltiplas Tags (queryCampaignAudience)", () => {
  // Teste (a) - Prova do OU
  it("a) duas tags selecionadas: entram leads que têm UMA das duas (prova do OU)", async () => {
    const res = await queryCampaignAudience(pool, {
      scope,
      tags: ["tagA", "tagB"],
    });

    const nomes = res.items.map((i) => i.nome);
    // Devem entrar: 'Lead Tag A' (tem tagA), 'Lead Tag B' (tem tagB) e 'Lead Tags AB' (tem ambas)
    expect(res.total).toBe(3);
    expect(nomes).toContain("Lead Tag A");
    expect(nomes).toContain("Lead Tag B");
    expect(nomes).toContain("Lead Tags AB");
  });

  // Teste (b) - Sem duplicatas
  it("b) lead que tem AS DUAS tags aparece UMA VEZ só (sem duplicata)", async () => {
    const res = await queryCampaignAudience(pool, {
      scope,
      tags: ["tagA", "tagB"],
    });

    const leadABMatches = res.items.filter((i) => i.nome === "Lead Tags AB");
    expect(leadABMatches.length).toBe(1);

    const ids = res.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Teste (c) - Exclusão de não-combinados
  it("c) lead sem nenhuma das tags NÃO entra", async () => {
    const res = await queryCampaignAudience(pool, {
      scope,
      tags: ["tagA", "tagB"],
    });

    const nomes = res.items.map((i) => i.nome);
    expect(nomes).not.toContain("Lead Tag C");
    expect(nomes).not.toContain("Lead Sem Tag");
  });

  // Teste (d) - Compatibilidade com campo tag antigo
  it("d) uma tag só: resultado idêntico ao do campo tag antigo (compatibilidade)", async () => {
    const resMulti = await queryCampaignAudience(pool, {
      scope,
      tags: ["tagA"],
    });

    const resSingle = await queryCampaignAudience(pool, {
      scope,
      tag: "tagA",
    });

    expect(resMulti.total).toBe(resSingle.total);
    const idsMulti = resMulti.items.map((i) => i.id).sort();
    const idsSingle = resSingle.items.map((i) => i.id).sort();
    expect(idsMulti).toEqual(idsSingle);
    expect(resMulti.total).toBe(2); // Lead Tag A e Lead Tags AB
  });

  // Teste (e) - Lista vazia: nenhum filtro de tag é aplicado
  it("e) lista vazia: nenhum filtro de tag é aplicado", async () => {
    const resVazio = await queryCampaignAudience(pool, {
      scope,
      tags: [],
    });

    // Retorna todos os 7 leads da base
    expect(resVazio.total).toBe(7);

    // Normalização: strings vazias ou duplicadas são tratadas
    const resEspacos = await queryCampaignAudience(pool, {
      scope,
      tags: ["", "   "],
    });
    expect(resEspacos.total).toBe(7);

    const resDuplicadas = await queryCampaignAudience(pool, {
      scope,
      tags: ["tagA", "tagA"],
    });
    expect(resDuplicadas.total).toBe(2);
  });

  // Verificação 5 - Marcar 4 tags: bate com união SEM duplicar
  it("5) marcar 4 tags: contador bate com união sem duplicar quem está em mais de um grupo", async () => {
    // tagA: 2 leads ('Lead Tag A', 'Lead Tags AB')
    // tagB: 2 leads ('Lead Tag B', 'Lead Tags AB')
    // tagC: 2 leads ('Lead Tag C', 'Lead Tags CD')
    // tagD: 1 lead  ('Lead Tags CD')
    // Soma ingênua das contagens = 2 + 2 + 2 + 1 = 7
    // Total real com união (sem duplicatas) = 5 leads únicos
    // Fora do filtro: 'Lead Tag E' (só tagE) e 'Lead Sem Tag' (0 tags)
    const res = await queryCampaignAudience(pool, {
      scope,
      tags: ["tagA", "tagB", "tagC", "tagD"],
    });

    expect(res.total).toBe(5);
    const nomes = res.items.map((i) => i.nome);
    expect(nomes).toContain("Lead Tag A");
    expect(nomes).toContain("Lead Tag B");
    expect(nomes).toContain("Lead Tags AB");
    expect(nomes).toContain("Lead Tag C");
    expect(nomes).toContain("Lead Tags CD");
    expect(nomes).not.toContain("Lead Tag E");
    expect(nomes).not.toContain("Lead Sem Tag");

    // Prova de unicidade: nenhum ID duplicado retornado
    const ids = res.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(5);
  });
});
