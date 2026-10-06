// backend/src/test/importCsvColumnMapping.test.js
//
// Testes para importação de planilhas via POST /api/leads/import-csv com Mapeamento Dinâmico de Colunas.
// Garante resolução de headers não-padrão (ex: "Telefone 1"), validação de telefone obrigatório,
// registro de lead_custom_fields, compatibilidade retroativa legada, preservação de tags/vendas fechadas
// e imunidade a telefones sintéticos 5500.

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { attachImportRegistry } from "./helpers/importRegistryStub.js";
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

describe("Mapeamento Dinâmico de Colunas em /api/leads/import-csv", () => {
  let server;
  let baseUrl;
  let mockDb;
  let mockSupabase;
  const testClientId = "tenant-mapping-test";

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mockDb = createMockDb();
    await attachImportRegistry(mockDb);
    mockSupabase = createMockSupabase();

    const deps = {
      ensureDb: () => true,
      pgDatabasePool: mockDb,
      requireFirebaseAuth: (_req, _res, next) => {
        _req.user = { client_id: testClientId, role: "admin" };
        _req.authAccess = { isAdmin: true, role: "internal", clientId: testClientId };
        next();
      },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      resolveAuthorizedClientId: (_req, _res, cid) => cid || testClientId,
      sanitizePhone: (p, ddd) => sanitizePhone(p, ddd),
      sendError: (res, status, code, msg) => res.status(status).json({ error: code, message: msg }),
      normalizeString: (s) => (s ? String(s).trim() : ""),
      supabase: mockSupabase,
    };

    registerLeadsRoutes(app, deps);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  afterAll(async () => {
    await mockDb?.registry?.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(async () => {
    mockDb.leads.length = 0;
    mockDb.query.mockClear();
    mockSupabase.customFieldsTable.length = 0;
    await mockDb.registry.exec("DELETE FROM lead_custom_fields; DELETE FROM lead_import_items; DELETE FROM lead_imports;");
  });

  it("1. Planilha com header 'Telefone 1' mapeado importa corretamente (solução para o caso de 19.998 leads)", async () => {
    const res = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: testClientId,
        rows: [
          { "Nome do Lead": "João da Silva", "Telefone 1": "34991234567", Cidade: "Uberlândia" },
          { "Nome do Lead": "Maria Souza", "Telefone 1": "11987654321", Cidade: "São Paulo" },
        ],
        columnMapping: [
          { column: "Telefone 1", target: "telefone" },
          { column: "Nome do Lead", target: "nome" },
          { column: "Cidade", target: "custom", label: "Cidade", type: "text" },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.importedCount).toBe(2);
    expect(data.skippedNoPhoneCount).toBe(0);

    expect(mockDb.leads).toHaveLength(2);
    expect(mockDb.leads[0].telefone).toBe("5534991234567");
    expect(mockDb.leads[0].nome).toBe("João da Silva");
    expect(mockDb.leads[0].dados.campos.cidade).toBe("Uberlândia");
    expect(mockDb.leads[1].telefone).toBe("5511987654321");
    expect(mockDb.leads[1].nome).toBe("Maria Souza");
    expect(mockDb.leads[1].dados.campos.cidade).toBe("São Paulo");
  });

  it("2. Sem telefone mapeado no columnMapping retorna 400 INVALID_MAPPING", async () => {
    const res = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: testClientId,
        rows: [{ "Nome do Lead": "Carlos", Cidade: "Belo Horizonte" }],
        columnMapping: [
          { column: "Nome do Lead", target: "nome" },
          { column: "Cidade", target: "custom", label: "Cidade", type: "text" },
        ],
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("INVALID_MAPPING");
    expect(data.message).toContain("Nenhuma coluna mapeada para telefone");
    expect(mockDb.leads).toHaveLength(0);
  });

  it("3. Custom fields são registrados em lead_custom_fields e salvos em dados.campos com tipos corretos", async () => {
    const res = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: testClientId,
        rows: [
          {
            Contato: "34992223333",
            "Nome Completo": "Ana Paula",
            "Valor da Venda": "1.500,50",
            Segmento: "Tecnologia",
          },
        ],
        columnMapping: [
          { column: "Contato", target: "telefone" },
          { column: "Nome Completo", target: "nome" },
          { column: "Valor da Venda", target: "custom", label: "Valor da Venda", type: "number" },
          { column: "Segmento", target: "custom", label: "Segmento", type: "text" },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.importedCount).toBe(1);

    // Verifica se os campos foram registrados em lead_custom_fields (agora pelo registro da importação, no mesmo banco)
    const { rows: customFields } = await mockDb.registry.query("SELECT key, type, client_id, import_id FROM lead_custom_fields WHERE client_id = $1 ORDER BY key", [testClientId]);
    expect(customFields).toHaveLength(2);
    const valorField = customFields.find((f) => f.key === "valor_da_venda");
    expect(valorField).toBeDefined();
    expect(valorField.type).toBe("number");
    expect(valorField.client_id).toBe(testClientId);
    expect(valorField.import_id).toBe(data.importId); // e o campo aponta para a importação que o criou

    const segmentoField = customFields.find((f) => f.key === "segmento");
    expect(segmentoField).toBeDefined();
    expect(segmentoField.type).toBe("text");

    // Verifica dados.campos do lead salvo
    expect(mockDb.leads).toHaveLength(1);
    const lead = mockDb.leads[0];
    expect(lead.dados.campos.valor_da_venda).toBe(1500.5);
    expect(lead.dados.campos.segmento).toBe("Tecnologia");
  });

  it("4. Chamada a /api/leads/import-csv sem columnMapping funciona como legado (backward compatibility)", async () => {
    const res = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: testClientId,
        rows: [
          {
            nome: "Cliente Legado",
            telefone: "34999998888",
            origem: "Indicação",
            dados: { campos: { cargo: "Gerente" } },
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.importedCount).toBe(1);

    expect(mockDb.leads).toHaveLength(1);
    expect(mockDb.leads[0].nome).toBe("Cliente Legado");
    expect(mockDb.leads[0].telefone).toBe("5534999998888");
    expect(mockDb.leads[0].dados.campos.cargo).toBe("Gerente");
  });

  it("5. Tags de importação, 'vendas fechadas' e DDD padrão são preservados com mapeamento ativo", async () => {
    const res = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: testClientId,
        rows: [
          { Nome: "Juliana Santos", Celular: "991112222" }, // 9 dígitos sem DDD
        ],
        columnMapping: [
          { column: "Celular", target: "telefone" },
          { column: "Nome", target: "nome" },
        ],
        defaultDdd: "11",
        importTags: ["tag_campanha_q4", "BlackFriday"],
        asClosedSales: true,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.importedCount).toBe(1);

    expect(mockDb.leads).toHaveLength(1);
    const lead = mockDb.leads[0];
    expect(lead.telefone).toBe("5511991112222"); // DDD 11 aplicado
    expect(lead.stage).toBe("buyer");
    expect(lead.stage_source).toBe("manual");
    expect(lead.temperature).toBe("hot");
    expect(lead.tags).toContain("Venda Fechada");
    expect(lead.tags).toContain("Cliente Histórico");
    expect(lead.tags).toContain("tag_campanha_q4");
    expect(lead.tags).toContain("BlackFriday");
  });

  it("6. Telefones sintéticos 5500 ou linhas com telefone inválido são ignorados e não gerados", async () => {
    const res = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: testClientId,
        rows: [
          { "Tel Principal": "34999995555", Nome: "Lead Válido" },
          { "Tel Principal": "", Nome: "Vazio" },
          { "Tel Principal": "sem-numero", Nome: "Texto" },
          { "Tel Principal": "5500999999999", Nome: "Sintético 5500" },
        ],
        columnMapping: [
          { column: "Tel Principal", target: "telefone" },
          { column: "Nome", target: "nome" },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.importedCount).toBe(1);
    expect(data.skippedNoPhoneCount).toBe(3);

    expect(mockDb.leads).toHaveLength(1);
    expect(mockDb.leads[0].telefone).toBe("5534999995555");
    expect(mockDb.leads[0].telefone.startsWith("5500")).toBe(false);
  });

  it("7. [CRÍTICO] Reimportação preserva dados.campos anteriores via deep-merge (campos anteriores como 'cidade' sobrevivem à chegada apenas de 'cargo')", async () => {
    // 1ª importação traz "Cidade"
    const res1 = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: testClientId,
        rows: [
          { Tel: "34991112222", Nome: "Lead Persistente", Cidade: "Uberlândia" },
        ],
        columnMapping: [
          { column: "Tel", target: "telefone" },
          { column: "Nome", target: "nome" },
          { column: "Cidade", target: "custom", label: "Cidade", type: "text" },
        ],
      }),
    });

    expect(res1.status).toBe(200);
    expect(mockDb.leads).toHaveLength(1);
    expect(mockDb.leads[0].dados.campos.cidade).toBe("Uberlândia");

    // 2ª importação da mesma pessoa, mas a planilha só traz "Cargo", sem a coluna "Cidade"
    const res2 = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: testClientId,
        rows: [
          { Tel: "34991112222", Cargo: "Diretor de Operações" },
        ],
        columnMapping: [
          { column: "Tel", target: "telefone" },
          { column: "Cargo", target: "custom", label: "Cargo", type: "text" },
        ],
      }),
    });

    expect(res2.status).toBe(200);
    // Não duplica o lead (continua 1 lead)
    expect(mockDb.leads).toHaveLength(1);
    const lead = mockDb.leads[0];
    // O campo antigo 'cidade' DEVE sobreviver (prova do deep-merge de dados.campos)
    expect(lead.dados.campos.cidade).toBe("Uberlândia");
    // O campo novo 'cargo' foi mesclado com sucesso
    expect(lead.dados.campos.cargo).toBe("Diretor de Operações");
  });
});
