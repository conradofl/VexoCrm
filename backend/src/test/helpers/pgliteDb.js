// Postgres REAL, em memória (pglite = Postgres compilado para WASM), para testar SQL escrita à mão contra um banco
// de verdade em vez de contra um mock. Cada chamada devolve um banco novo e isolado; feche com `await db.close()`.
//
// Como usar sem virar falsa segurança (DIRETRIZES-IA.md, seção 11):
//   1. Teste em Postgres real é NECESSÁRIO para consulta nova ou alterada, mas NÃO garante que roda em produção:
//      o pglite diverge do Postgres do servidor em extensão, função e alguns tipos.
//   2. Se uma consulta não rodar no pglite por limitação dele, diga qual e por quê (comentário no teste) — NUNCA
//      mude a consulta para caber na ferramenta. A consulta é a do produto; a ferramenta é que tem limites.
//   3. O esquema do teste imita o de produção nos tipos que importam (uuid, text, jsonb, timestamptz). Se o tipo
//      do teste for mais frouxo que o de produção, o teste deixa de pegar `uuid = text`.
import { PGlite } from "@electric-sql/pglite";

export async function createPgliteDb(schemaSql = "") {
  const db = new PGlite();
  if (schemaSql) await db.exec(schemaSql);
  return db;
}
