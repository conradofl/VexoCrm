// PR 3 do untangle (telefone, lado leitura, parte 1): as cópias idênticas de regra de telefone
// viraram chamadas a uma função só, sem mudar o resultado. Este teste prende:
// 1. toCanonicalPhone e o espelho SQL_CANONICAL_PHONE contra a fixture shared/canonicalPhoneCases.json
//    (antes a fixture compartilhada só cobria sanitizePhone);
// 2. que as funções novas devolvem o mesmo que as cópias antigas (corpo antigo reproduzido aqui);
// 3. que as cópias não voltam (fonte não define de novo normalizeWhatsapp nem sanitizePhoneE164).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import {
  SQL_CANONICAL_PHONE,
  phoneDigits,
  toCanonicalPhone,
  toWhatsappNumberBr,
} from "../services/canonicalPhone.js";
import { sanitizePhone, sanitizePhoneE164 } from "../services/leadImport.js";
import { normalizeLeadPhoneKey } from "../services/leadUpsert.js";
import { normalizeSdrNumber } from "../services/sdrTarget.js";

const cases = JSON.parse(readFileSync(resolve(__dirname, "../../../shared/canonicalPhoneCases.json"), "utf8"));

const AMOSTRAS = [
  "5534991093607",
  "(34) 99109-3607",
  "+55 34 99109-3607",
  "34991093607",
  "3491093607",
  "553491093607",
  "3432345678",
  "034991093607",
  "91093607",
  "5534991093607@s.whatsapp.net",
  "  +55 (11) 98888-7777  ",
  "",
  "abc",
  null,
  undefined,
];

describe("fixture canonicalPhoneCases.json", () => {
  let db;
  beforeAll(async () => {
    db = new PGlite();
  });
  afterAll(async () => {
    await db?.close();
  });

  it.each(cases.map((c) => [c.caso, c]))("JS: %s", (_caso, c) => {
    expect(toCanonicalPhone(c.entrada)).toBe(c.canonico);
  });

  it("SQL_CANONICAL_PHONE devolve o mesmo que a fixture", async () => {
    for (const c of cases) {
      const { rows } = await db.query(`SELECT ${SQL_CANONICAL_PHONE("$1::text")} AS v`, [c.entrada]);
      expect(rows[0].v ?? "", c.caso).toBe(c.canonico);
    }
  });
});

describe("funções únicas devolvem o mesmo que as cópias antigas", () => {
  const antigoNormalizeWhatsapp = (num) => {
    const clean = String(num || "").replace(/\D/g, "");
    if (clean.length === 10 || clean.length === 11) return "55" + clean;
    return clean;
  };
  const antigoLeadKey = (phone) => String(phone || "").trim().replace(/^\+/, "").replace(/\D/g, "");
  const antigoSdr = (value) => String(value ?? "").replace(/\D/g, "");
  const antigoHeloisa = (raw) => (raw ? String(raw).replace(/\D/g, "") : "");
  const antigoE164 = (input, ddd = null) => {
    const s = sanitizePhone(input, ddd);
    if (!s) return null;
    return s.startsWith("+") ? s : `+${s}`;
  };

  it.each(AMOSTRAS.map((a) => [JSON.stringify(a), a]))("%s", (_rotulo, a) => {
    expect(toWhatsappNumberBr(a)).toBe(antigoNormalizeWhatsapp(a));
    expect(phoneDigits(a)).toBe(antigoHeloisa(a));
    expect(normalizeLeadPhoneKey(a)).toBe(antigoLeadKey(a));
    expect(normalizeSdrNumber(a)).toBe(antigoSdr(a));
    expect(sanitizePhoneE164(a)).toBe(antigoE164(a));
    expect(sanitizePhoneE164(a, "34")).toBe(antigoE164(a, "34"));
  });
});

describe("as cópias não voltam", () => {
  const SRC = resolve(__dirname, "..");
  function arquivos(dir) {
    return readdirSync(dir).flatMap((nome) => {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) return nome === "test" ? [] : arquivos(p);
      return p.endsWith(".js") ? [p] : [];
    });
  }
  const fontes = arquivos(SRC).map((p) => [p.slice(SRC.length + 1), readFileSync(p, "utf8")]);

  it("ninguém define normalizeWhatsapp (usar toWhatsappNumberBr)", () => {
    const achados = fontes
      .filter(([, s]) => /(function\s+normalizeWhatsapp\b|const\s+normalizeWhatsapp\s*=)/.test(s))
      .map(([p]) => p);
    expect(achados).toEqual([]);
  });

  it("sanitizePhoneE164 só é definido em services/leadImport.js", () => {
    const achados = fontes
      .filter(([, s]) => /function\s+sanitizePhoneE164\b/.test(s))
      .map(([p]) => p);
    expect(achados).toEqual(["services/leadImport.js"]);
  });
});
