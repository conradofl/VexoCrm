// backend/src/test/isMissingSchemaError.test.js
//
// isMissingSchemaError decide "schema ausente = caso esperado, siga em frente" em ~30 pontos do
// backend (11 deles no caminho do disparo). Ele casava `message.includes("does not exist")` genérico,
// o que incluía "operator does not exist: uuid = text" e "function ... does not exist": erro de TIPO
// virava "tabela ausente", silenciosamente. Isso escondeu as caixas de proposta e contrato do
// dashboard (tenants.id UUID = gd_*.tenant_id TEXT).
//
// Regra: só é schema ausente o que é tabela, coluna ou objeto inexistente (códigos do Postgres) e os
// erros do PostgREST. Operador e função inexistentes são bug nosso e têm que estourar.
//
// Sem fixture em shared/: as fixtures de lá existem para manter em sincronia duas implementações
// (backend e frontend) da mesma regra; esta função só existe no backend.

import { describe, expect, it } from "vitest";
import { isMissingSchemaError } from "../services/analytics.js";

const pg = (code, message) => Object.assign(new Error(message), { code });

describe("isMissingSchemaError — o que É schema ausente", () => {
  const CASES = [
    ["tabela inexistente (42P01)", pg("42P01", 'relation "gd_proposals" does not exist')],
    ["coluna inexistente (42703)", pg("42703", 'column "analytics_meta" does not exist')],
    ["coluna inexistente em UPDATE (42703)", pg("42703", 'column "phones" of relation "campaigns" does not exist')],
    ["objeto indefinido (42704)", pg("42704", 'type "chip_state" does not exist')],
    ["PostgREST: coluna fora do cache (PGRST204)", pg("PGRST204", "Could not find the 'phones' column of 'campaigns' in the schema cache")],
    ["PostgREST: tabela fora do cache (PGRST205)", pg("PGRST205", "Could not find the table 'public.leads_x' in the schema cache")],
    ["PostgREST: filtro inválido (PGRST100)", pg("PGRST100", "failed to parse select parameter")],
    ["PostgREST pela mensagem, sem código", new Error("Could not find the 'x' column in the schema cache")],
    ["tabela inexistente só pela mensagem (erro sem código)", new Error('relation "leads_x" does not exist')],
    ["coluna inexistente só pela mensagem (erro sem código)", new Error('column "x" does not exist')],
  ];

  for (const [name, error] of CASES) {
    it(`${name} → true`, () => {
      expect(isMissingSchemaError(error)).toBe(true);
    });
  }
});

describe("isMissingSchemaError — o que NÃO é schema ausente", () => {
  it("[TESTE OBRIGATÓRIO] operator does not exist: uuid = text NÃO é schema ausente (com código)", () => {
    expect(isMissingSchemaError(pg("42883", "operator does not exist: uuid = text"))).toBe(false);
  });

  it("[TESTE OBRIGATÓRIO] operator does not exist: uuid = text NÃO é schema ausente (só pela mensagem, sem código)", () => {
    expect(isMissingSchemaError(new Error("operator does not exist: uuid = text"))).toBe(false);
  });

  it("[TESTE OBRIGATÓRIO] function ... does not exist NÃO é schema ausente (com e sem código)", () => {
    expect(isMissingSchemaError(pg("42883", "function lower(uuid) does not exist"))).toBe(false);
    expect(isMissingSchemaError(new Error("function lower(uuid) does not exist"))).toBe(false);
    expect(isMissingSchemaError(new Error("function gen_random_uuid() does not exist"))).toBe(false);
  });

  it("outros 'does not exist' que não são tabela nem coluna também estouram (schema, papel, extensão)", () => {
    expect(isMissingSchemaError(pg("3F000", 'schema "tenant_x" does not exist'))).toBe(false);
    expect(isMissingSchemaError(new Error('schema "tenant_x" does not exist'))).toBe(false);
    expect(isMissingSchemaError(new Error('extension "pgcrypto" does not exist'))).toBe(false);
  });

  it("erros que nada têm a ver com schema continuam false", () => {
    expect(isMissingSchemaError(null)).toBe(false);
    expect(isMissingSchemaError(undefined)).toBe(false);
    expect(isMissingSchemaError({})).toBe(false);
    expect(isMissingSchemaError(pg("22P02", 'invalid input syntax for type uuid: "x"'))).toBe(false);
    expect(isMissingSchemaError(pg("23505", "duplicate key value violates unique constraint"))).toBe(false);
    expect(isMissingSchemaError(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).toBe(false);
  });

  it("[TESTE OBRIGATÓRIO] função/operador que CITA 'table', 'column' ou 'relation' na mensagem também estoura", () => {
    // Falsos positivos que sobravam depois de tirar a linha genérica: as linhas por mensagem
    // ("table"/"column"/"relation" + "does not exist") casavam com erro de função/operador.
    const mensagens = [
      "function array_to_table(uuid) does not exist",
      "operator does not exist: character varying = table_kind",
      "function foo(column) does not exist",
    ];
    for (const message of mensagens) {
      expect(isMissingSchemaError(new Error(message)), `sem código: ${message}`).toBe(false);
      expect(isMissingSchemaError(pg("42883", message)), `com 42883: ${message}`).toBe(false);
    }
  });

  it("[TESTE OBRIGATÓRIO] 42883 com mensagem embrulhada (que não começa com operator/function) também estoura", () => {
    // a guarda por CÓDIGO existe para quando um wrapper prefixa a mensagem do Postgres
    const embrulhado = pg("42883", "query failed: operator does not exist: uuid = text on table tenants");
    expect(isMissingSchemaError(embrulhado)).toBe(false);
    // sem o código, o mesmo texto é ambíguo e casa por "table" — por isso o código tem que valer sozinho
    expect(isMissingSchemaError(new Error("query failed: operator does not exist: uuid = text on table tenants"))).toBe(true);
  });

  it("a guarda não derruba o que é schema ausente: coluna/tabela de verdade seguem true", () => {
    expect(isMissingSchemaError(new Error('column "table_name" does not exist'))).toBe(true);
    expect(isMissingSchemaError(pg("42P01", 'relation "function_log" does not exist'))).toBe(true);
    expect(isMissingSchemaError(pg("42703", 'column "operator_id" of relation "campaigns" does not exist'))).toBe(true);
  });

  it("o erro real do dashboard (tenants.id UUID = gd_proposals.tenant_id TEXT) estoura", () => {
    // mensagem exata devolvida pelo Postgres 18 na verificação de uso de GD
    const error = pg("42883", "operator does not exist: uuid = text");
    expect(isMissingSchemaError(error)).toBe(false);
  });
});
