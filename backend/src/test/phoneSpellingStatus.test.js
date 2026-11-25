// Medição do PR 3 parte 2 do untangle: grafias de telefone gravadas em leads e lead_import_items. Postgres real (pglite).
import { afterEach, describe, expect, it } from "vitest";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { measurePhoneSpellings, getPhoneSpellingStatus, _resetPhoneSpellingStatusForTesting } from "../services/phoneSpellingStatus.js";

const SCHEMA = `
  CREATE TABLE public.leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text, telefone text);
  CREATE TABLE public.lead_import_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text, telefone text);
`;

let db;
afterEach(async () => {
  _resetPhoneSpellingStatusForTesting();
  await db?.close();
});

describe("measurePhoneSpellings", () => {
  it("conta, por empresa, fora do canônico, com não-dígito e números com várias grafias; nenhum telefone sai", async () => {
    db = await createPgliteDb(SCHEMA);
    await db.exec(`
      INSERT INTO leads (client_id, telefone) VALUES
        ('a', '5534991093607'),            -- canônico
        ('a', '553491093607'),             -- mesmo número sem o 9: fora do canônico, 2ª grafia
        ('a', '(34) 98888-7777'),          -- máscara
        ('a', '5534977776666'),
        ('b', '5511999990001'),
        ('b', NULL), ('b', '');
      INSERT INTO lead_import_items (client_id, telefone) VALUES
        ('a', '5534991093607'), ('a', '5534991093607'), -- mesma grafia em duas planilhas: NÃO é "várias grafias"
        ('c', '3491093607');                             -- sem 55 e sem 9
    `);
    const pool = { query: (sql, p) => db.query(sql, p) };
    const r = await measurePhoneSpellings(pool);
    expect(r.medido).toBe(true);
    expect(r.tabelas.leads.total).toEqual({ linhas: 5, foraDoCanonico: 2, comNaoDigito: 1, numerosComVariasGrafias: 1 });
    expect(r.tabelas.leads.porEmpresa).toEqual({ a: { linhas: 4, foraDoCanonico: 2, comNaoDigito: 1, numerosComVariasGrafias: 1 } });
    expect(r.tabelas.lead_import_items.total).toEqual({ linhas: 3, foraDoCanonico: 1, comNaoDigito: 0, numerosComVariasGrafias: 0 });
    expect(JSON.stringify(r)).not.toMatch(/\d{8,}/);
  });

  it("tabela que falha não derruba as outras", async () => {
    db = await createPgliteDb("CREATE TABLE public.leads (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), client_id text, telefone text);");
    const r = await measurePhoneSpellings({ query: (sql, p) => db.query(sql, p) });
    expect(r.tabelas.leads.medido).toBe(true);
    expect(r.tabelas.lead_import_items.medido).toBe(false);
  });

  it("no /health: primeira leitura dispara em segundo plano e devolve emAndamento; depois devolve o resultado guardado", async () => {
    db = await createPgliteDb(SCHEMA);
    let chamadas = 0;
    const pool = { query: (sql, p) => { chamadas += 1; return db.query(sql, p); } };
    expect(getPhoneSpellingStatus(pool)).toEqual({ medido: false, emAndamento: true });
    expect(getPhoneSpellingStatus(pool)).toEqual({ medido: false, emAndamento: true });
    await new Promise((r) => setTimeout(r, 300));
    const fim = getPhoneSpellingStatus(pool);
    expect(fim.medido).toBe(true);
    const n = chamadas;
    getPhoneSpellingStatus(pool);
    expect(chamadas).toBe(n); // não mede de novo
  });
});
