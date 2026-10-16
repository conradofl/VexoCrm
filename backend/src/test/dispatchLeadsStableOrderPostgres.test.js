// backend/src/test/dispatchLeadsStableOrderPostgres.test.js
//
// Lote de campanha é fatia por POSIÇÃO (slice offset/limit) sobre buildDispatchLeads, ordenado por created_at DESC.
// Importação em lote grava muitos leads com created_at IGUAL; em empate o Postgres devolve ordem arbitrária, que muda
// entre consultas — principalmente depois de UPDATEs, que mudam a posição física da linha (e lead_import_items é
// atualizado o tempo todo pela conversa). Sem desempate, o mesmo lead caía em dois lotes e recebia duas vezes
// (campanha 3206272b, 14/10/2026: 67 envios 'sent' para 50 telefones; 17 pessoas 2x, todas em 2 lotes diferentes).
//
// Postgres REAL (pglite): empate e ordem física só existem num banco de verdade.

import { afterAll, describe, expect, it } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { _setPgDatabasePoolForTesting } from "../services/database.js";
import { buildDispatchLeads } from "../campaign/dispatch.js";

const T = "tenant-lotes";
const SLOW = 60_000;
const MESMO_INSTANTE = "2026-10-14T12:00:00.000Z";

const SCHEMA = `
  SET TimeZone = 'UTC';
  CREATE TABLE public.lead_import_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    import_id UUID NOT NULL,
    client_id TEXT NOT NULL,
    lead_id UUID,
    telefone TEXT,
    imported BOOLEAN NOT NULL DEFAULT true,
    normalized_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    status_conversa TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE public.leads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id TEXT NOT NULL,
    telefone TEXT,
    nome TEXT, tipo_cliente TEXT, faixa_consumo TEXT, qualificacao TEXT, cidade TEXT, estado TEXT, status TEXT,
    opt_out BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}'::jsonb,
    dados JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

const abertos = [];
afterAll(async () => {
  _setPgDatabasePoolForTesting(null);
  for (const db of abertos) await db.close();
});

const IMPORT = "11111111-1111-4111-8111-111111111111";

async function baseCom30Empatados() {
  const db = await createPgliteDb(SCHEMA);
  abertos.push(db);
  _setPgDatabasePoolForTesting({ query: (sql, params) => db.query(sql, params) });
  for (let i = 0; i < 30; i += 1) {
    const tel = `5511990${String(10000 + i)}`;
    await db.query(
      "INSERT INTO lead_import_items (import_id, client_id, telefone, normalized_data, created_at) VALUES ($1, $2, $3, $4::jsonb, $5)",
      [IMPORT, T, tel, JSON.stringify({ nome: `Lead ${i}` }), MESMO_INSTANTE]
    );
    await db.query(
      "INSERT INTO leads (client_id, telefone, nome, created_at) VALUES ($1, $2, $3, $4)",
      [T, tel, `Lead ${i}`, MESMO_INSTANTE]
    );
  }
  return db;
}

// O que acontece em produção entre um lote e outro: a conversa atualiza linhas, que mudam de posição física.
async function conversaAtualizaLinhas(db, rodada) {
  await db.query(
    "UPDATE lead_import_items SET status_conversa = $1 WHERE (('x' || substr(md5(id::text || $1), 1, 2))::bit(8)::int % 3) = 0",
    [`r${rodada}`]
  );
  await db.query(
    "UPDATE leads SET status = $1 WHERE (('x' || substr(md5(id::text || $1), 1, 2))::bit(8)::int % 3) = 0",
    [`r${rodada}`]
  );
}

const tels = (leads) => leads.map((l) => l.telefone);

for (const [origem, importId] of [["planilha (lead_import_items)", IMPORT], ["CRM (leads)", "__crm__"]]) {
  describe(`[OBRIGATÓRIO] ordem estável com created_at empatado — ${origem}`, () => {
    it("(a) três chamadas com o mesmo offset/limit devolvem os mesmos leads, na mesma ordem", async () => {
      const db = await baseCom30Empatados();
      const lote = () => buildDispatchLeads({ clientId: T, importId, limit: 10, offset: 10 });

      const primeira = tels(await lote());
      await conversaAtualizaLinhas(db, 1);
      const segunda = tels(await lote());
      await conversaAtualizaLinhas(db, 2);
      const terceira = tels(await lote());

      expect(primeira).toHaveLength(10);
      expect(segunda).toEqual(primeira);
      expect(terceira).toEqual(primeira);
    }, SLOW);

    it("(b) os lotes offset 0, 10 e 20 cobrem os 30 sem repetir nenhum — com a conversa mexendo nas linhas entre um e outro", async () => {
      const db = await baseCom30Empatados();
      const vistos = [];
      for (const [i, offset] of [0, 10, 20].entries()) {
        vistos.push(...tels(await buildDispatchLeads({ clientId: T, importId, limit: 10, offset })));
        await conversaAtualizaLinhas(db, 10 + i);
      }
      expect(vistos).toHaveLength(30);
      expect(new Set(vistos).size).toBe(30);
    }, SLOW);
  });
}
