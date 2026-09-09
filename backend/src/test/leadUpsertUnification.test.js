import { describe, expect, it, vi } from "vitest";
import {
  isRealName,
  normalizeLeadPhoneKey,
  upsertLeadByPhone,
  upsertLeadsBatchByPhone,
} from "../services/leadUpsert.js";

describe("Unificação de Gravação de Leads (leadUpsert / CSV / Webhooks / WhatsApp)", () => {
  function createMockDb() {
    const leads = [];

    const pool = {
      leads,
      query: vi.fn(async (sql, params = []) => {
        const text = sql.trim();

        // 1. SELECT por client_id e telefone/phone
        if (text.includes("SELECT") && text.includes("FROM public.leads") && text.includes("WHERE client_id = $1")) {
          const clientId = params[0];

          // Batch query: telefone = ANY($2::text[])
          if (text.includes("ANY(")) {
            const phones = params[1] || [];
            const matching = leads.filter(
              (l) => l.client_id === clientId && (phones.includes(l.telefone) || phones.includes(l.phone))
            );
            return { rows: matching.map((l) => ({ ...l })) };
          }

          // Single query: telefone = $2 OR phone = $2 OR ...
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

        // 2. INSERT em lote ou individual
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

        // 3. UPDATE por ID
        if (text.startsWith("UPDATE public.leads")) {
          if (text.includes("WHERE id = $")) {
            const id = text.includes("WHERE id = $1") ? params[0] : params[params.length - 1];
            const lead = leads.find((l) => l.id === id);
            if (lead) {
              if (text.includes("nome = $1")) {
                lead.nome = params[0];
                if (params[1]) lead.stage = params[1];
                if (params[2]) lead.stage_source = params[2];
                if (params[3]) lead.lost_reason = params[3];
                if (params[4]) lead.temperature = params[4];
                lead.tags = params[5];
                lead.dados = typeof params[6] === "string" ? JSON.parse(params[6]) : params[6];
              } else {
                const setMatch = text.match(/SET (.+) WHERE/i);
                if (setMatch) {
                  const setClauses = setMatch[1].split(",").map((s) => s.trim());
                  for (const clause of setClauses) {
                    const m = clause.match(/"?([a-zA-Z0-9_]+)"?\s*=\s*\$(\d+)/);
                    if (m) {
                      const col = m[1];
                      const paramIdx = parseInt(m[2], 10) - 1;
                      lead[col] = params[paramIdx];
                    }
                  }
                }
                lead.updated_at = new Date().toISOString();
              }
              return { rowCount: 1 };
            }
          }
          return { rowCount: 0 };
        }

        return { rows: [] };
      }),
    };

    return { pool, leads };
  }

  it("isRealName identifica corretamente nomes reais vs placeholders e números", () => {
    expect(isRealName("Ana Clara")).toBe(true);
    expect(isRealName("João Silva Santos")).toBe(true);
    expect(isRealName("")).toBe(false);
    expect(isRealName("   ")).toBe(false);
    expect(isRealName("5511999990001")).toBe(false);
    expect(isRealName("+55 11 99999-0001")).toBe(false);
    expect(isRealName("você")).toBe(false);
    expect(isRealName("Voce")).toBe(false);
    expect(isRealName("Lead Social")).toBe(false);
    expect(isRealName("não informado")).toBe(false);
  });

  it("CSV com telefone repetido dentro do próprio arquivo resulta em um único lead com dados e tags consolidados", async () => {
    const { pool, leads } = createMockDb();

    const csvRows = [
      {
        telefone: "5511999991111",
        nome: "Carlos",
        tags: ["planilha-1", "interesse-solar"],
        dados: { cidade: "Campinas" },
      },
      {
        telefone: "5511999991111",
        nome: "Carlos Eduardo",
        tags: ["planilha-2", "lead-quente"],
        dados: { valor: 5000 },
      },
    ];

    const result = await upsertLeadsBatchByPhone(pool, "cliente-a", csvRows);

    expect(result.insertedCount).toBe(1);
    expect(result.updatedCount).toBe(0);
    expect(result.totalCount).toBe(1);

    expect(leads).toHaveLength(1);
    expect(leads[0].telefone).toBe("5511999991111");
    expect(leads[0].nome).toBe("Carlos Eduardo");
    expect(leads[0].tags).toEqual(expect.arrayContaining(["planilha-1", "interesse-solar", "planilha-2", "lead-quente"]));
    expect(leads[0].dados).toMatchObject({ cidade: "Campinas", valor: 5000 });
  });

  it("CSV com telefone que já existe na base atualiza o lead e NÃO duplica", async () => {
    const { pool, leads } = createMockDb();

    // Lead pré-existente
    leads.push({
      id: "lead-existente-1",
      client_id: "cliente-a",
      telefone: "5511988882222",
      phone: "5511988882222",
      nome: "Mariana Souza",
      stage: "cold",
      temperature: "cold",
      tags: ["origem-site"],
      dados: { interesse: "Bateria" },
    });

    const csvRows = [
      {
        telefone: "5511988882222",
        nome: "Mariana Souza",
        stage: "buyer",
        temperature: "hot",
        tags: ["campanha-agosto"],
        dados: { canal: "csv" },
      },
    ];

    const result = await upsertLeadsBatchByPhone(pool, "cliente-a", csvRows);

    expect(result.insertedCount).toBe(0);
    expect(result.updatedCount).toBe(1);
    expect(result.totalCount).toBe(1);

    expect(leads).toHaveLength(1);
    expect(leads[0].id).toBe("lead-existente-1");
    expect(leads[0].stage).toBe("buyer");
    expect(leads[0].temperature).toBe("hot");
    expect(leads[0].tags).toEqual(expect.arrayContaining(["origem-site", "campanha-agosto"]));
    expect(leads[0].dados).toMatchObject({ interesse: "Bateria", canal: "csv" });
  });

  it("Inbound do WhatsApp e CSV para o mesmo telefone convergem para um lead só", async () => {
    const { pool, leads } = createMockDb();

    // 1. Mensagem inbound do WhatsApp chega primeiro
    const waRes = await upsertLeadByPhone(pool, "cliente-a", "5511977773333", {
      nome: "Roberto WhatsApp",
      stage: "inquiry",
      temperature: "warm",
      tags: ["whatsapp-inbound"],
    });

    expect(waRes).toBe("inserted");
    expect(leads).toHaveLength(1);

    // 2. Posteriormente, sobe uma planilha CSV contendo o mesmo telefone
    const csvResult = await upsertLeadsBatchByPhone(pool, "cliente-a", [
      {
        telefone: "5511977773333",
        nome: "Roberto WhatsApp",
        tags: ["planilha-leads"],
        dados: { origem_campanha: "Meta Ads" },
      },
    ]);

    expect(csvResult.insertedCount).toBe(0);
    expect(csvResult.updatedCount).toBe(1);

    // Garante que continua havendo exatamente 1 lead
    expect(leads).toHaveLength(1);
    expect(leads[0].tags).toEqual(expect.arrayContaining(["whatsapp-inbound", "planilha-leads"]));
  });

  it("Nome vazio ou placeholder no CSV NÃO sobrescreve nome bom já existente na base", async () => {
    const { pool, leads } = createMockDb();

    // Lead pré-existente com nome completo de qualidade
    leads.push({
      id: "lead-nome-bom",
      client_id: "cliente-a",
      telefone: "5511966664444",
      phone: "5511966664444",
      nome: "Dra. Beatriz Mendes",
      stage: "cold",
      temperature: "cold",
      tags: ["crm"],
      dados: {},
    });

    // CSV chega sem nome ou com número no campo nome
    const csvRows = [
      {
        telefone: "5511966664444",
        nome: "5511966664444", // Placeholder de telefone
        stage: "open_budget",
        tags: ["evento-2026"],
      },
    ];

    await upsertLeadsBatchByPhone(pool, "cliente-a", csvRows);

    expect(leads[0].nome).toBe("Dra. Beatriz Mendes");
    expect(leads[0].stage).toBe("open_budget");
    expect(leads[0].tags).toEqual(expect.arrayContaining(["crm", "evento-2026"]));
  });

  it("Importação de volume realista (1.000 leads) processa rapidamente sem estourar timeout", async () => {
    const { pool, leads } = createMockDb();

    const largeBatch = Array.from({ length: 1000 }, (_, i) => ({
      telefone: `551190000${String(i).padStart(4, "0")}`,
      nome: `Contato ${i}`,
      stage: "cold",
      temperature: "warm",
      tags: ["carga-maciça"],
      dados: { index: i },
    }));

    const start = Date.now();
    const result = await upsertLeadsBatchByPhone(pool, "cliente-a", largeBatch);
    const elapsedMs = Date.now() - start;

    expect(result.insertedCount).toBe(1000);
    expect(result.totalCount).toBe(1000);
    expect(leads).toHaveLength(1000);
    expect(elapsedMs).toBeLessThan(1000); // Execução em milissegundos
  });

  it("Lead com stage_source='manual' NUNCA tem seu stage ou lost_reason sobrescritos por processos automáticos (upsert individual)", async () => {
    const { pool, leads } = createMockDb();

    // Lead inserido manualmente como buyer
    leads.push({
      id: "lead-manual-1",
      client_id: "cliente-a",
      telefone: "5511999998888",
      phone: "5511999998888",
      nome: "Carlos Silva",
      stage: "buyer",
      stage_source: "manual",
      lost_reason: null,
      tags: ["cliente-fechado"],
      dados: { valor: 10000 },
    });

    // Processo automático (ex: extração do WhatsApp ou sincronização de mensagem) tenta atualizar para 'inquiry'
    await upsertLeadByPhone(pool, "cliente-a", "5511999998888", {
      stage: "inquiry",
      stage_source: "auto",
      lost_reason: null,
      temperature: "warm",
      tags: ["whatsapp-msg"],
    });

    expect(leads[0].stage).toBe("buyer");
    expect(leads[0].stage_source).toBe("manual");
    expect(leads[0].tags).toEqual(expect.arrayContaining(["cliente-fechado", "whatsapp-msg"]));
  });

  it("Lead com stage_source='manual' NUNCA tem seu stage sobrescrito por importação em lote (batch)", async () => {
    const { pool, leads } = createMockDb();

    // Lead manual como lost
    leads.push({
      id: "lead-manual-2",
      client_id: "cliente-a",
      telefone: "5511988887777",
      phone: "5511988887777",
      nome: "Mariana Souza",
      stage: "lost",
      stage_source: "manual",
      lost_reason: "preco",
      tags: ["perda-preco"],
      dados: {},
    });

    // Planilha importada com stage 'cold' ou 'open_budget'
    await upsertLeadsBatchByPhone(pool, "cliente-a", [
      {
        telefone: "5511988887777",
        nome: "Mariana Souza",
        stage: "open_budget",
        stage_source: "auto",
        temperature: "hot",
        tags: ["planilha-2026"],
      },
    ]);

    expect(leads[0].stage).toBe("lost");
    expect(leads[0].stage_source).toBe("manual");
    expect(leads[0].lost_reason).toBe("preco");
  });
});
