// backend/src/test/leadCustomFieldsImport.test.js
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import {
  normalizeImportedLead,
  sanitizePhone,
  normalizeHeaderKey,
  parseNumberValue,
} from "../services/leadImport.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const sharedCasesPath = resolve(__dirname, "../../../shared/leadColumnMappingTestCases.json");
const sharedCases = JSON.parse(readFileSync(sharedCasesPath, "utf-8"));

describe("Mapeamento de colunas na importação de planilhas - Backend", () => {
  let server;
  let baseUrl;
  const clientId = "tenant-custom-fields";

  // Mock in-memory tables for Supabase
  const customFieldsTable = [];
  const leadImportsTable = [];
  const leadImportItemsTable = [];

  const mockSupabase = {
    from: (table) => {
      if (table === "lead_custom_fields") {
        return {
          select: (cols) => {
            let filterClientId = null;
            let filterKey = null;

            const chain = {
              eq: (field, val) => {
                if (field === "client_id") filterClientId = val;
                if (field === "key") filterKey = val;
                return chain;
              },
              order: (orderCol, { ascending } = {}) => {
                return chain;
              },
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
          update: (patch) => {
            let filterClientId = null;
            let filterIsNull = null;
            return {
              eq: (field, val) => {
                if (field === "client_id") filterClientId = val;
                return {
                  is: async (nullField, nullVal) => {
                    filterIsNull = nullField;
                    for (const r of customFieldsTable) {
                      if (
                        (!filterClientId || r.client_id === filterClientId) &&
                        r[nullField] === null
                      ) {
                        Object.assign(r, patch);
                      }
                    }
                    return { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      }

      if (table === "lead_imports") {
        return {
          insert: (data) => {
            const record = {
              id: `import-${leadImportsTable.length + 1}`,
              created_at: new Date().toISOString(),
              ...data,
            };
            leadImportsTable.push(record);
            return {
              select: () => ({
                single: async () => ({ data: { ...record }, error: null }),
              }),
            };
          },
          select: (cols) => {
            let filterClientId = null;
            return {
              eq: (col, val) => {
                if (col === "client_id") filterClientId = val;
                return {
                  order: () => ({
                    limit: async () => ({
                      data: leadImportsTable.filter(
                        (i) => !filterClientId || i.client_id === filterClientId
                      ),
                      error: null,
                    }),
                  }),
                };
              },
            };
          },
        };
      }

      if (table === "lead_import_items") {
        return {
          insert: async (items) => {
            const arr = Array.isArray(items) ? items : [items];
            leadImportItemsTable.push(...arr);
            return { data: arr, error: null };
          },
        };
      }

      throw new Error(`Unexpected table in mock: ${table}`);
    },
  };

  beforeAll(async () => {
    const app = express();
    app.use(express.json());

    const deps = {
      ensureDb: () => true,
      pgDatabasePool: { query: vi.fn(async () => ({ rows: [] })) },
      requireFirebaseAuth: (_req, _res, next) => {
        _req.user = { client_id: clientId, role: "admin" };
        _req.authAccess = { isAdmin: true, role: "internal", clientId };
        next();
      },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      resolveAuthorizedClientId: (_req, _res, cid) => cid || clientId,
      sanitizePhone: (p, ddd) => sanitizePhone(p, ddd),
      sendError: (res, status, code, msg) =>
        res.status(status).json({ error: code, message: msg }),
      normalizeString: (s) => (s ? String(s).trim() : ""),
      normalizeImportedLead,
      supabase: mockSupabase,
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
    customFieldsTable.length = 0;
    leadImportsTable.length = 0;
    leadImportItemsTable.length = 0;
  });

  // Teste 6
  it("6. as colunas marcadas entram em dados.campos com a chave normalizada; as ignoradas não entram em lugar nenhum", () => {
    const mapping = [
      { column: "Telefone", target: "telefone" },
      { column: "Nome", target: "nome" },
      { column: "Profissão / Atividade", target: "custom", label: "Profissão", type: "text" },
      { column: "Renda Mensal (R$)", target: "custom", label: "Renda Mensal", type: "number" },
      { column: "Ignorar Esta", target: "ignore" },
    ];

    const row = {
      Telefone: "(34) 99123-4567",
      Nome: "Marcelo Rezende",
      "Profissão / Atividade": "Arquiteto",
      "Renda Mensal (R$)": "12.500,00",
      "Ignorar Esta": "Lixo que não deve ser guardado",
    };

    const normalized = normalizeImportedLead(row, clientId, "34", mapping);

    expect(normalized.telefone).toBe("5534991234567");
    expect(normalized.nome).toBe("Marcelo Rezende");
    expect(normalized.dados.campos.profissao).toBe("Arquiteto");
    expect(normalized.dados.campos.renda_mensal).toBe(12500);

    // Chave ignorada não existe em dados.campos
    expect(normalized.dados.campos).not.toHaveProperty("ignorar_esta");
    expect(normalized.dados.campos).not.toHaveProperty("Ignorar Esta");

    // E não criou coluna nova no root de normalized
    expect(normalized).not.toHaveProperty("profissao");
    expect(normalized).not.toHaveProperty("renda_mensal");
  });

  // Teste 7
  it("7. valor vazio não cria a chave para aquele lead — nem string vazia, nem zero", () => {
    const mapping = [
      { column: "Telefone", target: "telefone" },
      { column: "Cargo", target: "custom", label: "Cargo", type: "text" },
      { column: "Bonus", target: "custom", label: "Bônus", type: "number" },
    ];

    const rowA = {
      Telefone: "34991112222",
      Cargo: "Engenheiro",
      Bonus: "", // Vazio
    };

    const rowB = {
      Telefone: "34993334444",
      Cargo: "   ", // Espaços
      Bonus: 1000,
    };

    const rowC = {
      Telefone: "34995556666",
      Cargo: null,
      Bonus: undefined,
    };

    const normA = normalizeImportedLead(rowA, clientId, "34", mapping);
    const normB = normalizeImportedLead(rowB, clientId, "34", mapping);
    const normC = normalizeImportedLead(rowC, clientId, "34", mapping);

    // Lead A: tem cargo, não tem bonus
    expect(normA.dados.campos).toHaveProperty("cargo", "Engenheiro");
    expect(normA.dados.campos).not.toHaveProperty("bonus");
    expect(normA.dados.campos.bonus).toBeUndefined();

    // Lead B: tem bonus, não tem cargo
    expect(normB.dados.campos).toHaveProperty("bonus", 1000);
    expect(normB.dados.campos).not.toHaveProperty("cargo");

    // Lead C: não tem nenhum dos dois (campos vazio)
    expect(normC.dados.campos).toBeUndefined();
  });

  // Teste 8
  it("8. o registro ganha uma entrada por campo novo e reaproveita o existente na segunda importação", async () => {
    // 1ª importação: introduz o campo customizado "Departamento"
    const res1 = await fetch(`${baseUrl}/api/lead-imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        sourceName: "lote_1.xlsx",
        rows: [{ Telefone: "34991112222", Departamento: "Comercial" }],
        columnMapping: {
          columns: ["Telefone", "Departamento"],
          mapping: [
            { column: "Telefone", target: "telefone" },
            { column: "Departamento", target: "custom", label: "Departamento", type: "text" },
          ],
        },
      }),
    });

    expect(res1.status).toBe(201);
    expect(customFieldsTable).toHaveLength(1);
    expect(customFieldsTable[0].key).toBe("departamento");
    expect(customFieldsTable[0].label).toBe("Departamento");
    expect(customFieldsTable[0].type).toBe("text");

    // 2ª importação: traz o MESMO campo customizado "Departamento"
    const res2 = await fetch(`${baseUrl}/api/lead-imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        sourceName: "lote_2.xlsx",
        rows: [{ Telefone: "34993334444", Departamento: "Suporte" }],
        columnMapping: {
          columns: ["Telefone", "Departamento"],
          mapping: [
            { column: "Telefone", target: "telefone" },
            { column: "Departamento", target: "custom", label: "Departamento", type: "text" },
          ],
        },
      }),
    });

    expect(res2.status).toBe(201);

    // O registro em lead_custom_fields foi reaproveitado: continua sendo 1 único registro
    expect(customFieldsTable).toHaveLength(1);
    expect(customFieldsTable[0].key).toBe("departamento");
  });

  // Teste 9
  it("9. tipo divergente na segunda importação não sobrescreve o registro e avisa", async () => {
    // Preenche campo inicial como number no banco
    customFieldsTable.push({
      id: "cf-existente",
      client_id: clientId,
      key: "pontuacao",
      label: "Pontuação",
      type: "number",
      import_id: "import-antigo",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // 2ª importação traz "pontuacao", mas detectado como "text"
    const res = await fetch(`${baseUrl}/api/lead-imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        sourceName: "divergente.xlsx",
        rows: [{ Telefone: "34991112222", Pontuação: "Excelente" }],
        columnMapping: {
          columns: ["Telefone", "Pontuação"],
          mapping: [
            { column: "Telefone", target: "telefone" },
            { column: "Pontuação", target: "custom", label: "Pontuação", type: "text" },
          ],
        },
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();

    // 1. O tipo original "number" foi mantido no banco (NÃO foi sobrescrito para "text")
    const dbField = customFieldsTable.find((f) => f.key === "pontuacao");
    expect(dbField.type).toBe("number");

    // 2. A resposta inclui aviso explícito sobre a divergência
    expect(body.warnings).toBeDefined();
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0].detectedType).toBe("text");
    expect(body.warnings[0].registeredType).toBe("number");
    expect(body.warnings[0].message).toContain("já está cadastrado como 'number'");
    expect(body.warnings[0].message).toContain("O tipo original foi mantido");
  });

  // Teste 11
  it("11. linha sem telefone é contada e reportada, e nenhum telefone começa com 5500", async () => {
    const res = await fetch(`${baseUrl}/api/lead-imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        sourceName: "auditoria_telefones.xlsx",
        rows: [
          { Nome: "Lead Valido 1", Telefone: "34991112222" },
          { Nome: "Sem Telefone", Telefone: "" },
          { Nome: "Telefone Muito Curto", Telefone: "1234" },
          { Nome: "Lead Valido 2", Telefone: "(11) 98888-7777" },
        ],
        columnMapping: {
          columns: ["Nome", "Telefone"],
          mapping: [
            { column: "Nome", target: "nome" },
            { column: "Telefone", target: "telefone" },
          ],
        },
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();

    // 1. Linhas sem telefone contadas e reportadas
    expect(body.item.total_rows).toBe(4);
    expect(body.item.imported_rows).toBe(2);
    expect(body.item.skipped_rows).toBe(2);

    // 2. Os itens foram gravados com o motivo do descarte
    const skippedItems = leadImportItemsTable.filter((i) => !i.imported);
    expect(skippedItems).toHaveLength(2);
    expect(skippedItems[0].skip_reason).toMatch(/Telefone ausente ou invalido/i);
    expect(skippedItems[1].skip_reason).toMatch(/Telefone ausente ou invalido/i);

    // 3. Nenhum telefone no banco ou nos itens começa com 5500
    const has5500 = leadImportItemsTable.some(
      (item) =>
        String(item.telefone || "").startsWith("5500") ||
        String(item.normalized_data?.telefone || "").startsWith("5500")
    );
    expect(has5500).toBe(false);
  });

  // Ajuste 1: Procedência de campos (import_id)
  it("dois campos criados em importações diferentes mantêm cada um a sua procedência depois da segunda importação", async () => {
    // Campo pré-existente de semanas atrás com import_id null (procedência sem importação)
    customFieldsTable.push({
      id: "cf-legado",
      client_id: clientId,
      key: "campo_antigo",
      label: "Campo Antigo",
      type: "text",
      import_id: null,
      created_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
      updated_at: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
    });

    // 1ª importação: introduz o campo customizado "departamento"
    const res1 = await fetch(`${baseUrl}/api/lead-imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        sourceName: "lote_1.xlsx",
        rows: [{ Telefone: "34991112222", Departamento: "Comercial" }],
        columnMapping: {
          columns: ["Telefone", "Departamento"],
          mapping: [
            { column: "Telefone", target: "telefone" },
            { column: "Departamento", target: "custom", label: "Departamento", type: "text" },
          ],
        },
      }),
    });

    expect(res1.status).toBe(201);
    const body1 = await res1.json();
    const import1Id = body1.item.id;
    expect(import1Id).toBeDefined();

    const campo1 = customFieldsTable.find((f) => f.key === "departamento");
    expect(campo1).toBeDefined();
    expect(campo1.import_id).toBe(import1Id);

    // 2ª importação: traz o campo existente "departamento" e introduz um novo campo "cargo"
    const res2 = await fetch(`${baseUrl}/api/lead-imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        sourceName: "lote_2.xlsx",
        rows: [{ Telefone: "34993334444", Departamento: "Comercial", Cargo: "Gerente" }],
        columnMapping: {
          columns: ["Telefone", "Departamento", "Cargo"],
          mapping: [
            { column: "Telefone", target: "telefone" },
            { column: "Departamento", target: "custom", label: "Departamento", type: "text" },
            { column: "Cargo", target: "custom", label: "Cargo", type: "text" },
          ],
        },
      }),
    });

    expect(res2.status).toBe(201);
    const body2 = await res2.json();
    const import2Id = body2.item.id;
    expect(import2Id).toBeDefined();
    expect(import2Id).not.toBe(import1Id);

    // 1. O campo da primeira importação MANTÉM a procedência da primeira (NÃO foi sobrescrito para import-2)
    const campo1AposImport2 = customFieldsTable.find((f) => f.key === "departamento");
    expect(campo1AposImport2.import_id).toBe(import1Id);

    // 2. O campo novo da segunda importação recebe a procedência da segunda importação
    const campo2 = customFieldsTable.find((f) => f.key === "cargo");
    expect(campo2).toBeDefined();
    expect(campo2.import_id).toBe(import2Id);

    // 3. O campo legado antigo com import_id null NÃO foi alterado (nenhum update em massa por IS NULL)
    const campoLegado = customFieldsTable.find((f) => f.key === "campo_antigo");
    expect(campoLegado.import_id).toBeNull();
  });

  // Ajuste 2: Linhas cruas e autoridade do servidor no mapeamento
  it("servidor recebe linhas cruas e columnMapping e é a autoridade que mapeia dados.campos, telefone e nome", async () => {
    // Linha crua como sai do parser da planilha no navegador: sem dados.campos, sem telefone canônico
    const rawRows = [
      {
        "Contato WhatsApp": "(34) 99888-7777",
        "Razão / Nome": "Empresa Alfa",
        "Faturamento Anual (R$)": "R$ 1.500.000,50",
        "Observação": "Ignorar",
      },
    ];

    const columnMapping = {
      columns: ["Contato WhatsApp", "Razão / Nome", "Faturamento Anual (R$)", "Observação"],
      mapping: [
        { column: "Contato WhatsApp", target: "telefone" },
        { column: "Razão / Nome", target: "nome" },
        { column: "Faturamento Anual (R$)", target: "custom", label: "Faturamento Anual", type: "number" },
        { column: "Observação", target: "ignore" },
      ],
    };

    const res = await fetch(`${baseUrl}/api/lead-imports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        sourceName: "linhas_cruas.xlsx",
        rows: rawRows,
        columnMapping,
        defaultDdd: "34",
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.item.imported_rows).toBe(1);

    // Verifica que o item gravado no banco teve dados.campos, telefone e nome mapeados pelo backend
    const savedItem = leadImportItemsTable[0];
    expect(savedItem.telefone).toBe("5534998887777");
    expect(savedItem.normalized_data.telefone).toBe("5534998887777");
    expect(savedItem.normalized_data.nome).toBe("Empresa Alfa");
    expect(savedItem.normalized_data.dados.campos.faturamento_anual).toBe(1500000.5);
    expect(savedItem.normalized_data.dados.campos).not.toHaveProperty("observacao");
  });

  // Ajuste 3: Teste de espelho (Backend) usando a tabela compartilhada
  describe("Teste de espelho: normalização de chaves e parsing numérico (Backend)", () => {
    it("normalizeHeaderKey produz exatamente as chaves esperadas da tabela compartilhada", () => {
      expect(sharedCases.keyNormalizationCases.length).toBeGreaterThan(0);
      for (const item of sharedCases.keyNormalizationCases) {
        expect(normalizeHeaderKey(item.label)).toBe(item.expected);
      }
    });

    it("parseNumberValue converte valores numéricos conforme a tabela compartilhada", () => {
      expect(sharedCases.numberParsingCases.length).toBeGreaterThan(0);
      for (const item of sharedCases.numberParsingCases) {
        const result = parseNumberValue(item.input);
        if (item.expected === null) {
          expect(Number.isNaN(result)).toBe(true);
        } else {
          expect(result).toBe(item.expected);
        }
      }
    });
  });
});
