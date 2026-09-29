// backend/src/test/importCsvPhoneSanitization.test.js
//
// Teste automatizado para desativação da fábrica de telefones 5500 no import de CSV/Excel.
// Garante que linhas sem telefone ou com telefone inválido não geram número sintético 5500,
// sendo puladas e contabilizadas em skippedNoPhoneCount.

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { sanitizePhone } from "../services/leadImport.js";

function createMockDb() {
  const leads = [];

  const pool = {
    leads,
    query: vi.fn(async (sql, params = []) => {
      const text = sql.trim();

      // 1. SELECT por client_id e telefone/phone (upsertLeadsBatchByPhone)
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

      // 2. INSERT em lote (upsertLeadsBatchByPhone)
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

      // 3. UPDATE por ID (caso ocorra)
      if (text.startsWith("UPDATE public.leads")) {
        return { rowCount: 1 };
      }

      return { rows: [], rowCount: 0 };
    }),
  };

  return pool;
}

describe("Desativação da Fábrica 5500 e Sanitização do CSV Import (POST /api/leads/import-csv)", () => {
  let server;
  let baseUrl;
  let mockDb;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mockDb = createMockDb();

    const deps = {
      ensureDb: () => true,
      pgDatabasePool: mockDb,
      requireFirebaseAuth: (_req, _res, next) => {
        _req.user = { client_id: "geracao-digital", role: "admin" };
        _req.authAccess = { isAdmin: true, role: "internal", clientId: "geracao-digital" };
        next();
      },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      resolveAuthorizedClientId: (_req, _res, cid) => cid || "geracao-digital",
      sanitizePhone: (p, ddd) => sanitizePhone(p, ddd),
      sendError: (res, status, code, msg) => res.status(status).json({ error: code, message: msg }),
      normalizeString: (s) => (s ? String(s).trim() : ""),
      supabase: null,
    };

    registerLeadsRoutes(app, deps);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    mockDb.leads.length = 0;
    mockDb.query.mockClear();
  });

  it("[TESTE OBRIGATÓRIO] Importação de CSV com linhas sem telefone ou telefone inválido: não gera 5500, pula linhas e contabiliza skippedNoPhoneCount", async () => {
    const res = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "geracao-digital",
        rows: [
          { nome: "Lucas Valido 1", telefone: "(34) 99999-1111" },
          { nome: "Sem Telefone Vazio", telefone: "" },
          { nome: "Telefone Nulo", telefone: null },
          { nome: "Telefone Invalido Letras", telefone: "sem-numero" },
          { nome: "Telefone Invalido Curto", telefone: "123" },
          { nome: "Mariana Valida 2", telefone: "11988882222" },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    // Valida payload de resposta
    expect(data.success).toBe(true);
    expect(data.totalRows).toBe(6);
    expect(data.importedCount).toBe(2);
    expect(data.skippedNoPhoneCount).toBe(4);

    // Valida que nenhum lead foi inserido com prefixo 5500
    const has5500Lead = mockDb.leads.some((l) =>
      String(l.telefone || "").startsWith("5500") ||
      String(l.telefone || "").startsWith("+5500") ||
      String(l.phone || "").startsWith("5500") ||
      String(l.phone || "").startsWith("+5500")
    );
    expect(has5500Lead).toBe(false);

    // Valida que exatamente os 2 leads válidos foram persistidos com telefones sanitizados
    expect(mockDb.leads).toHaveLength(2);
    expect(mockDb.leads.map((l) => l.nome)).toEqual(["Lucas Valido 1", "Mariana Valida 2"]);
    expect(mockDb.leads.map((l) => l.telefone)).toEqual(["5534999991111", "5511988882222"]);
  });

  it("[TESTE OBRIGATÓRIO] Planilha com 100% das linhas sem telefone: nada é gravado no banco e skippedNoPhoneCount igual ao totalRows", async () => {
    const res = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "geracao-digital",
        rows: [
          { nome: "Lead Sem Fone 1", telefone: "" },
          { nome: "Lead Sem Fone 2", phone: null },
          { nome: "Lead Fone Curto", celular: "999" },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.totalRows).toBe(3);
    expect(data.importedCount).toBe(0);
    expect(data.skippedNoPhoneCount).toBe(3);

    // Nenhuma chamada de insert deve ter ocorrido e zero leads no banco
    expect(mockDb.leads).toHaveLength(0);
  });

  it("Aplica defaultDdd corretamente em números locais e pula linhas ausentes", async () => {
    const res = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "geracao-digital",
        defaultDdd: "34",
        rows: [
          { nome: "Lead Local Uberlândia", telefone: "991112233" },
          { nome: "Lead Sem Canal", telefone: "" },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.success).toBe(true);
    expect(data.totalRows).toBe(2);
    expect(data.importedCount).toBe(1);
    expect(data.skippedNoPhoneCount).toBe(1);

    expect(mockDb.leads).toHaveLength(1);
    expect(mockDb.leads[0].nome).toBe("Lead Local Uberlândia");
    expect(mockDb.leads[0].telefone).toBe("5534991112233");
  });
});
