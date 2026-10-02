// backend/src/test/gdProposalEditorPersistence.test.js
//
// O formulário único de proposta (Nova Proposta = Editar Proposta) grava SEMPRE pelo PUT
// /api/gd/proposals/:id. Este teste garante que o PUT grava cada campo que o formulário envia
// (lista em shared/proposalEditorFields.json, a mesma que o teste do frontend usa para barrar
// campo novo sem gravação).
//
// Motivo: `carencia_dias` era LIDA por todas as rotas e GRAVADA por nenhuma — a carência escolhida
// no formulário se perdia ao salvar, sem erro.

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it, vi } from "vitest";
import { registerGeracaoDigitalRoutes } from "../domains/geracaoDigitalRoutes.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIELDS = JSON.parse(readFileSync(resolve(__dirname, "../../../shared/proposalEditorFields.json"), "utf-8"));

const TENANT = "a1b2c3d4-e5f6-4a7b-8c9d-0123456789ab";
const PROPOSAL_ID = "b2c3d4e5-f6a7-4b8c-9d0e-123456789abc";

const CURRENT_ROW = {
  id: PROPOSAL_ID,
  tenant_id: TENANT,
  prospect_name: "Antiga",
  cobrar_setup: false,
  valor_setup_vexo: null,
  periodo_plano: "mensal",
  carencia_dias: 30,
  condicoes_especiais: null,
  desconto_setup_pct: 0,
  desconto_mensal_pct: 0,
  esconder_valores: false,
  presentation_slides: null,
  owner_company: "geracao-digital",
};

async function putProposal(body) {
  const updates = [];
  const pool = {
    query: vi.fn(async (sql, params) => {
      const text = String(sql);
      if (text.includes("information_schema.columns")) return { rows: [{ n: 2 }] }; // segment_id + prospect_logo existem
      if (text.includes("SELECT * FROM public.gd_proposals")) return { rows: [CURRENT_ROW] };
      if (text.includes("UPDATE public.gd_proposals")) {
        updates.push({ sql: text, params });
        return { rows: [{ ...CURRENT_ROW }] };
      }
      return { rows: [] };
    }),
  };

  let handler = null;
  const app = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    put: vi.fn((path, ...handlers) => {
      if (path === "/api/gd/proposals/:id") handler = handlers[handlers.length - 1];
    }),
  };
  const noop = (_req, _res, next) => next && next();
  registerGeracaoDigitalRoutes(app, pool, noop, noop);

  const res = { statusCode: 200, body: null, status(c) { res.statusCode = c; return res; }, json(b) { res.body = b; return res; } };
  await handler({ params: { id: PROPOSAL_ID }, body: { client_id: TENANT, ...body }, query: {}, authAccess: { role: "internal", isAdmin: true } }, res);
  return { res, update: updates[0] };
}

// índice do parâmetro ($N) que a coluna recebe no UPDATE: `coluna = $N` ou `coluna = COALESCE($N, ...)`
function paramIndexOf(sql, column) {
  const m = sql.match(new RegExp(`\\b${column}\\s*=\\s*(?:COALESCE\\()?\\$(\\d+)`));
  return m ? Number(m[1]) - 1 : -1;
}

const asStored = (value) => (value !== null && typeof value === "object" ? JSON.stringify(value) : value);

describe("PUT /api/gd/proposals/:id — grava cada campo do formulário único", () => {
  const fullBody = Object.fromEntries(FIELDS.persisted.map((f) => [f.field, f.sample]));

  it("[TESTE OBRIGATÓRIO] cada campo da lista compartilhada chega à coluna certa", async () => {
    const { res, update } = await putProposal(fullBody);

    expect(res.statusCode).toBe(200);
    expect(update).toBeDefined();
    const faltando = [];
    const errados = [];
    for (const { field, column, sample } of FIELDS.persisted) {
      const idx = paramIndexOf(update.sql, column);
      if (idx < 0) {
        faltando.push(`${field} (coluna ${column} não está no UPDATE)`);
        continue;
      }
      const got = update.params[idx];
      if (JSON.stringify(got) !== JSON.stringify(asStored(sample))) errados.push(`${field}: gravou ${JSON.stringify(got)}, esperado ${JSON.stringify(asStored(sample))}`);
    }
    expect(faltando, `campos que o PUT não grava: ${faltando.join("; ")}`).toEqual([]);
    expect(errados, errados.join("; ")).toEqual([]);
  });

  it("[TESTE OBRIGATÓRIO] carência do 1º vencimento é gravada (antes nenhuma rota gravava)", async () => {
    const { update } = await putProposal({ ...fullBody, carencia_dias: 20 });

    expect(update.sql).toMatch(/carencia_dias\s*=\s*\$\d+/);
    expect(update.params[paramIndexOf(update.sql, "carencia_dias")]).toBe(20);
  });

  it("carência vazia no formulário (imediato) limpa o valor gravado", async () => {
    const { update } = await putProposal({ ...fullBody, carencia_dias: null });

    expect(update.params[paramIndexOf(update.sql, "carencia_dias")]).toBeNull();
  });

  it("carência ausente do corpo mantém a que já estava gravada", async () => {
    const { carencia_dias: _omitido, ...semCarencia } = fullBody;

    const { update } = await putProposal(semCarencia);

    expect(update.params[paramIndexOf(update.sql, "carencia_dias")]).toBe(30);
  });

  it("carência inválida (texto) não vira NaN no banco", async () => {
    const { update } = await putProposal({ ...fullBody, carencia_dias: "abc" });

    expect(update.params[paramIndexOf(update.sql, "carencia_dias")]).toBeNull();
  });

  it("a lista compartilhada não tem campo repetido nem coluna repetida", () => {
    const fields = FIELDS.persisted.map((f) => f.field);
    const columns = FIELDS.persisted.map((f) => f.column);
    expect(new Set(fields).size).toBe(fields.length);
    expect(new Set(columns).size).toBe(columns.length);
  });
});
