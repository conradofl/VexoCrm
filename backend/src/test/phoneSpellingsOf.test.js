// PR 3 parte 2 do untangle: phoneSpellingsOf (JS) é o espelho de SQL_CANONICAL_PHONE_SPELLINGS aplicado ao canônico.
// As 9 buscas de lead por igualdade exata passaram a usar esta lista. O teste amarra as duas regras em Postgres real.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { SQL_CANONICAL_PHONE, SQL_CANONICAL_PHONE_SPELLINGS, phoneSpellingsOf, toCanonicalPhone } from "../services/canonicalPhone.js";
import { buildPhoneLookupVariants } from "../services/leadImport.js";

const DDDS = ["11", "34", "99"];
const LOCAIS = ["999990001", "960000002", "950000005", "900000007", "91234567", "61234567", "21234567", "52345678"];
const grafias = (ddd, local) => {
  const out = new Set();
  for (const ddi of ["", "55"]) {
    out.add(`${ddi}${ddd}${local}`);
    if (local.length === 9 && local[0] === "9") out.add(`${ddi}${ddd}${local.slice(1)}`);
    if (local.length === 8) out.add(`${ddi}${ddd}9${local}`);
  }
  return [...out];
};
const CORPUS = [...new Set(DDDS.flatMap((d) => LOCAIS.flatMap((l) => grafias(d, l))))];

let db;
beforeAll(async () => {
  db = new PGlite();
});
afterAll(async () => {
  await db.close();
});

describe("phoneSpellingsOf", () => {
  it("[OBRIGATÓRIO] para todo número do corpus: a lista JS = grafias do SQL sobre o canônico (+ o valor como veio)", async () => {
    for (const raw of CORPUS) {
      const { rows } = await db.query(
        `SELECT ${SQL_CANONICAL_PHONE_SPELLINGS("c")} AS g FROM (SELECT ${SQL_CANONICAL_PHONE("$1::text")} AS c) x`,
        [raw]
      );
      const esperado = new Set([raw, ...rows[0].g]);
      expect(new Set(phoneSpellingsOf(raw)), raw).toEqual(esperado);
    }
  });

  it("toda grafia gerada volta ao mesmo canônico (nunca acha o número de outra pessoa)", () => {
    for (const raw of CORPUS) {
      const canon = toCanonicalPhone(raw);
      for (const g of phoneSpellingsOf(raw)) expect(toCanonicalPhone(g), `${raw} -> ${g}`).toBe(canon);
    }
  });

  it("nunca gera número sem DDD (8 ou 9 dígitos)", () => {
    for (const raw of CORPUS) for (const g of phoneSpellingsOf(raw)) if (g !== raw) expect(g.length).toBeGreaterThanOrEqual(10);
  });

  it("casos do dia a dia", () => {
    expect(new Set(phoneSpellingsOf("5534991093607"))).toEqual(new Set(["5534991093607", "34991093607", "553491093607", "3491093607"]));
    expect(new Set(phoneSpellingsOf("553491093607"))).toEqual(new Set(["553491093607", "5534991093607", "34991093607", "3491093607"]));
    expect(new Set(phoneSpellingsOf("553432345678"))).toEqual(new Set(["553432345678", "3432345678"]));
    expect(phoneSpellingsOf("123@lid")).toEqual(["123@lid"]);
    expect(phoneSpellingsOf("")).toEqual([]);
    expect(phoneSpellingsOf(null)).toEqual([]);
  });

  it("as 9 buscas exatas foram trocadas (nenhum .eq(\"telefone\", phone) sobrou)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    for (const f of ["campaign/dispatch.js", "campaign/dispatchEngine.js", "chatbot-ai-engine.js", "hardcoded-chatbot-persistence.js", "hardcoded-chatbot.js"]) {
      const src = readFileSync(resolve("src", f), "utf8");
      expect(src, f).not.toContain('.eq("telefone", phone)');
    }
  });
});

describe("buildPhoneLookupVariants = gerador único (PR 3 parte 3)", () => {
  it("[OBRIGATÓRIO] toda variante é o mesmo número (tirando o '+'): nunca acha o telefone de outra pessoa", () => {
    for (const raw of CORPUS) {
      const canon = toCanonicalPhone(raw);
      for (const v of buildPhoneLookupVariants(raw)) expect(toCanonicalPhone(v.replace(/^\+/, "")), `${raw} -> ${v}`).toBe(canon);
    }
  });

  it("contém todas as grafias do phoneSpellingsOf (nunca acha menos que as buscas do #323)", () => {
    for (const raw of CORPUS) {
      const v = new Set(buildPhoneLookupVariants(raw));
      for (const g of phoneSpellingsOf(raw)) expect(v.has(g), `${raw}: falta ${g}`).toBe(true);
    }
  });

  it("não gera mais número sem DDD nem o '9' inventado em fixo", () => {
    expect(buildPhoneLookupVariants("5534984400049").some((v) => v.length <= 9)).toBe(false);
    expect(buildPhoneLookupVariants("553432345678")).not.toContain("5534932345678");
  });

  it("JID e LID: cobre o valor como veio e os dígitos", () => {
    expect(buildPhoneLookupVariants("553484400049@s.whatsapp.net")).toEqual(expect.arrayContaining(["553484400049@s.whatsapp.net", "553484400049", "5534984400049"]));
    expect(buildPhoneLookupVariants("123456789012345@lid")).toEqual(expect.arrayContaining(["123456789012345@lid", "123456789012345"]));
  });
});
