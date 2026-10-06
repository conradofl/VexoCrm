// backend/src/test/importCsvImportId.test.js
//
// Cada importação do Banco grava o identificador dela em `dados.import_ids` de cada lead criado.
// A tag continua servindo para o que já existe, mas é editável pelo usuário — a exclusão em massa
// não pode depender só dela. Lead que entra numa segunda planilha acumula os dois identificadores.

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { attachImportRegistry } from "./helpers/importRegistryStub.js";
import { unionImportIds, upsertLeadsBatchByPhone } from "../services/leadUpsert.js";
import { sanitizePhone } from "../services/leadImport.js";

function createMockDb() {
  const leads = [];

  const pool = {
    leads,
    query: vi.fn(async (sql, params = []) => {
      const text = sql.trim();

      // SELECT por client_id e telefone/phone
      if (text.includes("SELECT") && text.includes("FROM public.leads") && text.includes("WHERE client_id = $1")) {
        const clientId = params[0];

        // Batch query: telefone = ANY($2::text[]) OR phone = ANY($2::text[])
        if (text.includes("ANY(")) {
          const phones = params[1] || [];
          const matching = leads.filter(
            (l) => l.client_id === clientId && (phones.includes(l.telefone) || phones.includes(l.phone))
          );
          return { rows: matching.map((l) => ({ ...l })) };
        }

        // Single query
        const phoneQuery = params[1];
        const found = leads.find(
          (l) =>
            l.client_id === clientId &&
            (l.telefone === phoneQuery ||
              l.phone === phoneQuery ||
              l.telefone === `+${phoneQuery}` ||
              l.phone === `+${phoneQuery}`)
        );
        return { rows: found ? [{ ...found }] : [] };
      }

      // INSERT em lote (upsertLeadsBatchByPhone)
      if (text.startsWith("INSERT INTO public.leads")) {
        const colsMatch = text.match(/\(([^)]+)\)/);
        const colNames = colsMatch ? colsMatch[1].split(",").map((c) => c.trim().replace(/"/g, "")) : [];

        if (colNames.length > 0) {
          const COLS_COUNT = colNames.length;
          const insertedRows = [];
          for (let i = 0; i < params.length; i += COLS_COUNT) {
            const row = { id: `lead-id-${leads.length + 1}` };
            colNames.forEach((col, idx) => {
              let val = params[i + idx];
              if (col === "dados" && typeof val === "string") {
                try {
                  val = JSON.parse(val);
                } catch {}
              }
              row[col] = val;
            });
            leads.push(row);
            insertedRows.push(row);
          }
          return { rows: insertedRows, rowCount: insertedRows.length };
        }

        const row = {
          id: `lead-id-${leads.length + 1}`,
          client_id: params[0],
          telefone: params[1],
          phone: params[2] || params[1],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        leads.push(row);
        return { rows: [row], rowCount: 1 };
      }

      // UPDATE por ID
      if (text.startsWith("UPDATE public.leads")) {
        const leadId = params[7];
        const targetLead = leads.find((l) => l.id === leadId);
        if (targetLead) {
          targetLead.nome = params[0];
          if (params[1] !== null && params[1] !== undefined) targetLead.stage = params[1];
          if (params[2] !== null && params[2] !== undefined) targetLead.stage_source = params[2];
          targetLead.lost_reason = params[3];
          if (params[4] !== null && params[4] !== undefined) targetLead.temperature = params[4];
          targetLead.tags = params[5];
          targetLead.dados = typeof params[6] === "string" ? JSON.parse(params[6]) : params[6];
          targetLead.updated_at = new Date().toISOString();
        }
        return { rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    }),
  };

  return pool;
}

function createMockSupabase() {
  const customFieldsTable = [];

  const supabase = {
    customFieldsTable,
    from: (table) => {
      if (table === "lead_custom_fields") {
        return {
          select: () => {
            let filterClientId = null;
            let filterKey = null;

            const chain = {
              eq: (field, val) => {
                if (field === "client_id") filterClientId = val;
                if (field === "key") filterKey = val;
                return chain;
              },
              order: () => chain,
              maybeSingle: async () => {
                const found = customFieldsTable.find(
                  (f) =>
                    (!filterClientId || f.client_id === filterClientId) &&
                    (!filterKey || f.key === filterKey)
                );
                return { data: found ? { ...found } : null, error: null };
              },
              then: async (resolve) => {
                const results = customFieldsTable.filter(
                  (f) => !filterClientId || f.client_id === filterClientId
                );
                return resolve({ data: results.map((r) => ({ ...r })), error: null });
              },
            };
            return chain;
          },
          insert: async (entry) => {
            const newRecord = {
              id: `cf-${customFieldsTable.length + 1}`,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              ...entry,
            };
            customFieldsTable.push(newRecord);
            return { data: newRecord, error: null };
          },
        };
      }
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
      };
    },
  };

  return supabase;
}


describe("unionImportIds", () => {
  it("une sem duplicar, preservando a ordem", () => {
    expect(unionImportIds(["a"], ["b", "a"], ["c"])).toEqual(["a", "b", "c"]);
  });

  it("ignora o que não é lista e devolve null quando não há nenhum", () => {
    expect(unionImportIds(undefined, null, "x", [])).toBeNull();
    expect(unionImportIds(undefined, ["a"])).toEqual(["a"]);
  });
});

describe("import-csv grava o identificador da importação em dados.import_ids", () => {
  let server;
  let baseUrl;
  let mockDb;
  const clientId = "tenant-import-id";

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mockDb = createMockDb();
    await attachImportRegistry(mockDb);
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
    await mockDb?.registry?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    mockDb.leads.length = 0;
  });

  const importar = async (rows, extra = {}) => {
    const res = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        rows,
        columnMapping: [
          { column: "Telefone", target: "telefone" },
          { column: "Nome", target: "nome" },
        ],
        ...extra,
      }),
    });
    return { status: res.status, body: await res.json() };
  };

  it("[TESTE OBRIGATÓRIO] cada lead criado leva o importId devolvido na resposta", async () => {
    const { status, body } = await importar([
      { Nome: "Ana", Telefone: "34991234567" },
      { Nome: "Bia", Telefone: "11987654321" },
    ]);

    expect(status).toBe(200);
    expect(body.importId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mockDb.leads).toHaveLength(2);
    for (const lead of mockDb.leads) expect(lead.dados.import_ids).toEqual([body.importId]);
  });

  it("[TESTE OBRIGATÓRIO] duas importações têm identificadores diferentes", async () => {
    const um = await importar([{ Nome: "Ana", Telefone: "34991234567" }]);
    const dois = await importar([{ Nome: "Caio", Telefone: "21988887777" }]);

    expect(um.body.importId).not.toBe(dois.body.importId);
  });

  it("[TESTE OBRIGATÓRIO] lead que entra numa segunda planilha acumula os dois identificadores", async () => {
    const um = await importar([{ Nome: "Ana", Telefone: "34991234567" }]);
    const dois = await importar([{ Nome: "Ana", Telefone: "34991234567" }]);

    expect(mockDb.leads).toHaveLength(1);
    expect(mockDb.leads[0].dados.import_ids).toEqual([um.body.importId, dois.body.importId]);
  });

  it("reimportar a mesma planilha não duplica o identificador do lead", async () => {
    const um = await importar([{ Nome: "Ana", Telefone: "34991234567" }]);

    // o mesmo id nunca se repete numa importação nova, mas a união é idempotente
    expect(unionImportIds(mockDb.leads[0].dados.import_ids, [um.body.importId])).toEqual([um.body.importId]);
  });
});

describe("upsertLeadsBatchByPhone: telefone repetido dentro do mesmo lote", () => {
  it("[TESTE OBRIGATÓRIO] une os identificadores das duas linhas em vez de ficar com o da última", async () => {
    const db = createMockDb();

    await upsertLeadsBatchByPhone(db, "tenant-x", [
      { nome: "Ana", telefone: "5534991234567", tags: [], dados: { import_ids: ["imp-a"] } },
      { nome: "Ana", telefone: "5534991234567", tags: [], dados: { import_ids: ["imp-b"] } },
    ]);

    expect(db.leads).toHaveLength(1);
    expect(db.leads[0].dados.import_ids).toEqual(["imp-a", "imp-b"]);
  });
});
