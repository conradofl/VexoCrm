// Repositório em memória da correção de origem, para testar a regra sem Postgres. Honra as mesmas barreiras
// do repositório real: toda leitura e correção é escopada por clientId, a correção só altera quem AINDA está
// "Instagram Direct" nos três campos, e a transação trabalha num retrato (commit aplica, rollback descarta).
// O SQL de verdade é conferido contra Postgres real (pglite) fora do repositório.
const FAB = "Instagram Direct";

export function createMemoryOriginFixRepo({ leads = [] } = {}) {
  const store = { leads: leads.map((l) => ({ ...l, dados: { ...(l.dados || {}) }, tags: [...(l.tags || [])] })), audit: [] };
  const calls = [];
  let failAudit = false;
  let shortFixBy = 0;

  return {
    store,
    calls,
    failNextAudit() {
      failAudit = true;
    },
    /** faz o banco corrigir menos linhas do que o pedido (inconsistência) */
    fixShortBy(n) {
      shortFixBy = n;
    },

    async listCandidates(db, clientId) {
      calls.push({ op: "listCandidates", clientId });
      return db.leads
        .filter((l) => l.client_id === clientId && l.dados?.origem === FAB)
        .map((l) => ({
          id: l.id,
          tags: [...(l.tags || [])],
          origem: l.dados?.origem ?? null,
          origem_marketing: l.dados?.origem_marketing ?? null,
          lead_source: l.dados?.lead_source ?? null,
          lead_source_bruto: l.dados?.lead_source_bruto ?? null,
          lead_source_column: l.lead_source ?? null,
          import_ids: l.dados?.import_ids ?? null,
        }));
    },

    async fixLeads(db, clientId, ids) {
      calls.push({ op: "fixLeads", clientId, ids: [...ids] });
      let fixed = 0;
      for (const l of db.leads) {
        if (l.client_id !== clientId || !ids.includes(l.id)) continue;
        if (l.dados?.origem !== FAB || l.dados?.origem_marketing !== FAB || l.dados?.lead_source !== FAB) continue;
        l.dados = { ...l.dados, origem: "Importação de planilha", origem_marketing: "importacao_planilha", lead_source: "importacao_planilha" };
        l.tags = (l.tags || []).filter((t) => String(t).trim().toLowerCase() !== FAB.toLowerCase());
        fixed += 1;
      }
      return Math.max(0, fixed - shortFixBy);
    },

    async ensureAuditTable() {
      calls.push({ op: "ensureAuditTable" });
    },
    async insertAudit(db, row) {
      calls.push({ op: "insertAudit", row });
      if (failAudit) {
        failAudit = false;
        throw new Error("falha simulada ao gravar auditoria");
      }
      const saved = { id: `audit-${db.audit.length + 1}`, created_at: "2026-10-03T12:00:00.000Z", ...row };
      db.audit.push(saved);
      return saved;
    },

    async begin(pool) {
      calls.push({ op: "begin" });
      return { leads: pool.leads.map((l) => ({ ...l, dados: { ...l.dados }, tags: [...l.tags] })), audit: [...pool.audit], origin: pool };
    },
    async commit(tx) {
      calls.push({ op: "commit" });
      tx.origin.leads = tx.leads;
      tx.origin.audit = tx.audit;
    },
    async rollback() {
      calls.push({ op: "rollback" });
    },
  };
}

const sheetDados = (extra = {}) => ({ origem: FAB, origem_marketing: FAB, lead_source: FAB, ...extra });

/** Lead fabricado pelo importador de planilha, COM identificador de importação (grupo 1). */
export const withImportId = (clientId, id, over = {}) => ({
  id,
  client_id: clientId,
  tags: ["Lista Out/26", FAB],
  dados: sheetDados({ import_ids: ["imp-1"] }),
  ...over,
});

/** Lead fabricado, sem identificador, mas com a tag de importação ao lado de "Instagram Direct" (grupo 2). */
export const onlyImportTag = (clientId, id, over = {}) => ({
  id,
  client_id: clientId,
  tags: ["Lista Set/26", FAB],
  dados: sheetDados(),
  ...over,
});

/** Não dá para determinar (grupo 3): só a tag "Instagram Direct" e nada que diga que veio de planilha. */
export const undeterminable = (clientId, id, over = {}) => ({
  id,
  client_id: clientId,
  tags: [FAB],
  dados: sheetDados(),
  ...over,
});

/** Lead do importador de Instagram de verdade: nunca se toca. */
export const fromInstagramImporter = (clientId, id, over = {}) => ({
  id,
  client_id: clientId,
  tags: [],
  lead_source: "instagram_export",
  dados: { origem: FAB, lead_source_bruto: FAB, origem_marketing: "instagram_export" },
  ...over,
});
