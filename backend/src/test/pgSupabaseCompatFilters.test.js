// backend/src/test/pgSupabaseCompatFilters.test.js
//
// A camada de compatibilidade (pgSupabaseCompat.js) imita o builder do supabase-js sobre o pool do Postgres. Faltavam `.contains()`
// e quase todo operador de `.or()` (só `eq` e `is.null`): GET /api/leads filtrando por tag ou busca LANÇAVA, caía num fallback
// silencioso e devolvia as 2.000 primeiras linhas SEM filtro. Aqui cada operador contra Postgres real (pglite).

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPgSupabaseClient } from "../pgSupabaseCompat.js";
import { createPgliteDb } from "./helpers/pgliteDb.js";

let db;
let supabase;
beforeAll(async () => {
  db = await createPgliteDb(`
    CREATE TABLE people (id serial PRIMARY KEY, nome text, telefone text, tags text[], dados jsonb, score int, assigned_to text, ativo boolean);
    INSERT INTO people (nome, telefone, tags, dados, score, assigned_to, ativo) VALUES
      ('Ana Souza', '5511900000001', ARRAY['vip','evento'], '{"origem":"site","n":1}', 10, 'gabriel', true),
      ('Bruno, o Grande', '5511900000002', ARRAY['vip'], '{"origem":"insta"}', 20, NULL, false),
      ('Carla (Lima)', '5511900000003', ARRAY[]::text[], '{}', 30, 'priscila', NULL),
      ('Dário "Dado" Reis', '5511900000004', NULL, '{"origem":"site"}', NULL, 'gabriel', true);
  `);
  supabase = createPgSupabaseClient({ query: (sql, values) => db.query(sql, values) });
});
afterAll(async () => db.close());

const nomes = async (q) => {
  const { data, error } = await q.order("id", { ascending: true });
  expect(error).toBeNull();
  return data.map((r) => r.nome);
};

describe(".contains()", () => {
  it("array de texto: todos os itens pedidos têm que estar na coluna", async () => {
    expect(await nomes(supabase.from("people").select("*").contains("tags", ["vip"]))).toEqual(["Ana Souza", "Bruno, o Grande"]);
    expect(await nomes(supabase.from("people").select("*").contains("tags", ["vip", "evento"]))).toEqual(["Ana Souza"]);
    expect(await nomes(supabase.from("people").select("*").contains("tags", ["nada"]))).toEqual([]);
  });
  it("jsonb: objeto contido", async () => {
    expect(await nomes(supabase.from("people").select("*").contains("dados", { origem: "site" }))).toEqual(["Ana Souza", "Dário \"Dado\" Reis"]);
  });
  it("valor com aspas e vírgula não vira injeção nem quebra a consulta", async () => {
    expect(await nomes(supabase.from("people").select("*").contains("tags", ["a,b\"c'd"]))).toEqual([]);
  });
});

describe(".or() com todos os operadores usados", () => {
  const or = (expr) => nomes(supabase.from("people").select("*").or(expr));

  it("ilike com curinga (a busca da tela)", async () => {
    expect(await or("nome.ilike.%souza%,telefone.ilike.%0003%")).toEqual(["Ana Souza", "Carla (Lima)"]);
  });
  it("eq + is.null (o escopo do operador)", async () => {
    expect(await or("assigned_to.eq.gabriel,assigned_to.is.null")).toEqual(["Ana Souza", "Bruno, o Grande", "Dário \"Dado\" Reis"]);
  });
  it("is.true / is.false", async () => {
    expect(await or("ativo.is.true")).toEqual(["Ana Souza", "Dário \"Dado\" Reis"]);
    expect(await or("ativo.is.false")).toEqual(["Bruno, o Grande"]);
  });
  it("neq, gt, gte, lt, lte, like", async () => {
    expect(await or("score.gt.20")).toEqual(["Carla (Lima)"]);
    expect(await or("score.gte.20")).toEqual(["Bruno, o Grande", "Carla (Lima)"]);
    expect(await or("score.lt.20")).toEqual(["Ana Souza"]);
    expect(await or("score.lte.20")).toEqual(["Ana Souza", "Bruno, o Grande"]);
    expect(await or("assigned_to.neq.gabriel")).toEqual(["Carla (Lima)"]);
    expect(await or("nome.like.Ana%")).toEqual(["Ana Souza"]);
  });
  it("in.(a,b)", async () => {
    expect(await or("assigned_to.in.(gabriel,priscila)")).toEqual(["Ana Souza", "Carla (Lima)", "Dário \"Dado\" Reis"]);
  });
  it("valor entre aspas pode ter vírgula e parêntese sem separar a condição", async () => {
    expect(await or('nome.eq."Bruno, o Grande",nome.eq."Carla (Lima)"')).toEqual(["Bruno, o Grande", "Carla (Lima)"]);
    expect(await or('nome.eq."Dário \\"Dado\\" Reis"')).toEqual(["Dário \"Dado\" Reis"]);
  });
  it("operador desconhecido LANÇA em vez de ignorar (ignorar devolveria linhas sem filtro)", async () => {
    const { error } = await supabase.from("people").select("*").or("nome.regex.x");
    expect(error?.message ?? "").toMatch(/Unsupported or filter/i);
  });
  it("combina com eq encadeado (E entre o or e os demais filtros)", async () => {
    expect(await nomes(supabase.from("people").select("*").eq("assigned_to", "gabriel").or("nome.ilike.%ana%,nome.ilike.%reis%"))).toEqual(["Ana Souza", "Dário \"Dado\" Reis"]);
  });
});
