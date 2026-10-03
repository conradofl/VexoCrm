// Banco e Supabase de mentira para os testes de POST /api/leads/import-csv (mesma forma do harness dos outros testes de importação).
import { vi } from "vitest";

export function createMockDb() {
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

export function createMockSupabase() {
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


