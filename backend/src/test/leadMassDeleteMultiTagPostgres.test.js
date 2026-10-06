// backend/src/test/leadMassDeleteMultiTagPostgres.test.js
//
// Testes de exclusão em massa por VÁRIAS tags com Postgres REAL (pglite):
// 1. Exclusão por três tags com sobreposição: a prévia conta cada lead uma vez, e o total excluído bate com a prévia.
// 2. Prévia divergindo do que seria excluído: a transação desfaz e nada é apagado.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import {
  MASS_DELETE_ERRORS,
  createPgMassDeleteRepo,
  executeMassDelete,
  normalizeCriterion,
  normalizeOptions,
  previewMassDelete,
} from "../services/leadMassDelete.js";

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
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE (client_id, telefone)
  );
  CREATE TABLE IF NOT EXISTS public.lead_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    lead_id UUID,
    phone TEXT,
    direction TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

const CLIENT_A = "empresa-alfa";
const CLIENT_B = "empresa-beta";

function createMockPool(db) {
  return {
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
}

describe("Exclusão em massa por várias tags (Postgres Real)", () => {
  let db;
  let pool;
  let repo;

  beforeEach(async () => {
    db = await createPgliteDb(SCHEMA);
    pool = createMockPool(db);
    repo = createPgMassDeleteRepo();

    await db.query(`INSERT INTO public.leads_clients (id, name) VALUES ($1, 'Alfa'), ($2, 'Beta')`, [
      CLIENT_A,
      CLIENT_B,
    ]);
  });

  afterEach(async () => {
    if (db) await db.close();
  });

  it("[TESTE OBRIGATÓRIO] exclusão por três tags com sobreposição: a prévia conta cada lead uma vez, e o total excluído bate com a prévia", async () => {
    // Inserir leads no CLIENT_A com combinações e sobreposição de 3 tags:
    // Lead 1: tagA, tagB (tem 2 das selecionadas)
    // Lead 2: tagB, tagC (tem 2 das selecionadas)
    // Lead 3: tagA, tagC (tem 2 das selecionadas)
    // Lead 4: tagA, tagB, tagC (tem as 3 selecionadas)
    // Lead 5: só tagA (1 selecionada)
    // Lead 6: só tagB (1 selecionada)
    // Lead 7: só tagC (1 selecionada)
    // Lead 8: só tagD (NÃO selecionada - deve sobrar)
    // Total com pelo menos uma das tags: 7 leads (Leads 1 a 7).
    // Leads com mais de uma das tags selecionadas: 4 leads (Leads 1, 2, 3, 4).
    const leadsData = [
      { nome: "Lead 1", fone: "5511911110001", tags: ["tagA", "tagB"] },
      { nome: "Lead 2", fone: "5511911110002", tags: ["tagB", "tagC"] },
      { nome: "Lead 3", fone: "5511911110003", tags: ["tagA", "tagC"] },
      { nome: "Lead 4", fone: "5511911110004", tags: ["tagA", "tagB", "tagC"] },
      { nome: "Lead 5", fone: "5511911110005", tags: ["tagA"] },
      { nome: "Lead 6", fone: "5511911110006", tags: ["tagB"] },
      { nome: "Lead 7", fone: "5511911110007", tags: ["tagC"] },
      { nome: "Lead 8", fone: "5511911110008", tags: ["tagD"] },
    ];

    for (const l of leadsData) {
      await db.query(
        `INSERT INTO public.leads (client_id, nome, telefone, tags) VALUES ($1, $2, $3, $4::text[])`,
        [CLIENT_A, l.nome, l.fone, l.tags]
      );
    }

    // Lead no CLIENT_B com tagA (não deve ser afetado)
    await db.query(
      `INSERT INTO public.leads (client_id, nome, telefone, tags) VALUES ($1, 'Lead B', '5511922220001', ARRAY['tagA']::text[])`,
      [CLIENT_B]
    );

    const normCrit = normalizeCriterion({ type: "tags", values: ["tagA", "tagB", "tagC"] });
    expect(normCrit.ok).toBe(true);
    const criterion = normCrit.criterion;
    const options = normalizeOptions({});

    // 1. PRÉVIA
    const preview = await previewMassDelete(repo, pool, { clientId: CLIENT_A, criterion, options });

    // Cada lead com pelo menos uma das tags é contado EXATAMENTE UMA VEZ
    expect(preview.matched).toBe(7);
    expect(preview.willDelete).toBe(7);
    expect(preview.kept).toBe(0);
    // 4 leads têm mais de uma das tags selecionadas (Lead 1, Lead 2, Lead 3, Lead 4)
    expect(preview.multiSelectedTags).toBe(4);

    // 2. EXECUÇÃO
    const outcome = await executeMassDelete(repo, pool, {
      clientId: CLIENT_A,
      criterion,
      options,
      expectedCount: preview.willDelete,
      actor: { uid: "user-test", email: "admin@vexo.com" },
    });

    expect(outcome.ok).toBe(true);
    // O total excluído bate com a prévia
    expect(outcome.report.deleted).toBe(preview.willDelete);
    expect(outcome.report.deleted).toBe(7);

    // Conferência no Postgres real:
    const remainingA = await db.query(`SELECT nome, tags FROM public.leads WHERE client_id = $1`, [CLIENT_A]);
    expect(remainingA.rows).toHaveLength(1);
    expect(remainingA.rows[0].nome).toBe("Lead 8");
    expect(remainingA.rows[0].tags).toEqual(["tagD"]);

    // Client B segue intacto
    const remainingB = await db.query(`SELECT nome FROM public.leads WHERE client_id = $1`, [CLIENT_B]);
    expect(remainingB.rows).toHaveLength(1);
    expect(remainingB.rows[0].nome).toBe("Lead B");

    // Registro de auditoria gravado no banco real
    const auditRows = await db.query(`SELECT * FROM public.lead_mass_delete_audit WHERE client_id = $1`, [CLIENT_A]);
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0].deleted).toBe(7);
    expect(auditRows.rows[0].expected_count).toBe(7);
  });

  it("[TESTE OBRIGATÓRIO] prévia divergindo do que seria excluído: a transação desfaz e nada é apagado", async () => {
    // 3 leads com tags A e B
    await db.query(
      `INSERT INTO public.leads (client_id, nome, telefone, tags) VALUES
        ($1, 'Lead 1', '5511911110001', ARRAY['tagA']::text[]),
        ($1, 'Lead 2', '5511911110002', ARRAY['tagB']::text[]),
        ($1, 'Lead 3', '5511911110003', ARRAY['tagA', 'tagB']::text[])`,
      [CLIENT_A]
    );

    const criterion = normalizeCriterion({ type: "tags", values: ["tagA", "tagB"] }).criterion;
    const options = normalizeOptions({});

    const preview = await previewMassDelete(repo, pool, { clientId: CLIENT_A, criterion, options });
    expect(preview.willDelete).toBe(3);

    // O usuário viu 3, mas enviou expectedCount = 2 (divergência)
    const outcome = await executeMassDelete(repo, pool, {
      clientId: CLIENT_A,
      criterion,
      options,
      expectedCount: 2,
      actor: { uid: "user-test", email: "admin@vexo.com" },
    });

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe(MASS_DELETE_ERRORS.COUNT_MISMATCH);
    expect(outcome.message).toContain("A contagem mudou: você viu 2 leads, mas agora são 3. Nada foi apagado");

    // No Postgres real: todos os 3 leads continuam lá! NADA foi apagado.
    const leadsAfter = await db.query(`SELECT id FROM public.leads WHERE client_id = $1`, [CLIENT_A]);
    expect(leadsAfter.rows).toHaveLength(3);

    // Nenhuma auditoria foi gravada (transação desfeita com rollback)
    const audit = await db.query(`SELECT count(*)::int AS n FROM public.lead_mass_delete_audit WHERE client_id = $1`, [CLIENT_A]);
    expect(audit.rows[0].n).toBe(0);
  });
});
