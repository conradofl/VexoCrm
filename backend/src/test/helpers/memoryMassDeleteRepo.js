// Repositório em memória da exclusão em massa, para testar a regra de negócio sem Postgres.
// Honra as mesmas barreiras do repositório real: toda leitura e exclusão é escopada por clientId, e a
// transação trabalha num retrato (commit aplica, rollback descarta). Uma importação rodando entre a
// prévia e a confirmação se simula alterando `repo.store.leads` entre as duas chamadas.
import { toCanonicalPhone } from "../../services/canonicalPhone.js";

export function createMemoryMassDeleteRepo({ leads = [], messages = [] } = {}) {
  const store = {
    leads: leads.map((l) => ({ ...l })),
    messages: messages.map((m) => ({ ...m })),
    audit: [],
  };
  const calls = [];
  let failAudit = false;
  let shortDeleteBy = 0;

  const tagsOf = (l) => (Array.isArray(l.tags) ? l.tags : []);

  const repo = {
    store,
    calls,
    failNextAudit() {
      failAudit = true;
    },
    /** faz o banco apagar menos linhas do que o pedido (inconsistência) */
    deleteShortBy(n) {
      shortDeleteBy = n;
    },

    async listCandidates(db, clientId, criterion) {
      calls.push({ op: "listCandidates", clientId, criterion });
      const src = db.leads;
      return src
        .filter((l) => l.client_id === clientId)
        .filter((l) =>
          criterion.type === "tag"
            ? tagsOf(l).includes(criterion.value)
            : Array.isArray(l.import_ids) && l.import_ids.includes(criterion.value)
        )
        .map((l) => ({ ...l }));
    },

    async listMessageKeys(db, clientId) {
      calls.push({ op: "listMessageKeys", clientId });
      const mine = db.messages.filter((m) => m.client_id === clientId);
      return {
        leadIds: new Set(mine.filter((m) => m.lead_id).map((m) => String(m.lead_id))),
        phones: new Set(mine.map((m) => toCanonicalPhone(m.phone)).filter(Boolean)),
      };
    },

    async deleteLeads(db, clientId, ids) {
      calls.push({ op: "deleteLeads", clientId, ids: [...ids] });
      const before = db.leads.length;
      db.leads = db.leads.filter((l) => !(l.client_id === clientId && ids.includes(l.id)));
      const removed = before - db.leads.length;
      return Math.max(0, removed - shortDeleteBy);
    },

    async listTags(db, clientId) {
      calls.push({ op: "listTags", clientId });
      const count = new Map();
      for (const l of db.leads.filter((x) => x.client_id === clientId)) for (const t of tagsOf(l)) count.set(t, (count.get(t) || 0) + 1);
      return [...count.entries()].map(([tag, leads]) => ({ tag, leads })).sort((a, b) => b.leads - a.leads);
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
      const saved = { id: `audit-${db.audit.length + 1}`, created_at: "2026-10-02T12:00:00.000Z", ...row };
      db.audit.push(saved);
      return saved;
    },

    // "pool" e "transação" são o mesmo objeto de dados; a transação trabalha numa cópia
    async begin(pool) {
      calls.push({ op: "begin" });
      return { leads: pool.leads.map((l) => ({ ...l })), messages: pool.messages, audit: [...pool.audit], origin: pool };
    },
    async commit(tx) {
      calls.push({ op: "commit" });
      tx.origin.leads = tx.leads;
      tx.origin.audit = tx.audit;
    },
    async rollback(tx) {
      calls.push({ op: "rollback" });
    },
  };
  return repo;
}

/** `pool` de teste = o próprio store do repositório */
export const poolOf = (repo) => repo.store;

export function makeLeads(clientId, n, over = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `${clientId}-${over.prefix || "l"}${i}`,
    client_id: clientId,
    nome: `Lead ${i}`,
    telefone: `+55119${String(80000000 + (over.offset || 0) + i)}`,
    tags: ["Lista Out/26", "Instagram Direct"],
    import_ids: null,
    stage: "cold",
    temperature: "warm",
    created_at: "2026-10-01T10:00:00.000Z",
    ...over.fields,
  }));
}
