// Duas migrations com o mesmo prefixo de 14 dígitos travam o boot de produção:
// o runner (src/migrate.js) recusa a fila inteira quando uma delas está pendente
// ("DUPLICATE MIGRATION TIMESTAMP"). Este teste barra isso no CI, antes do deploy.
//
// Tolerado: só o par antigo 20260715120000, já aplicado nos dois lados em
// produção (medido em 17/11/2026 no Console do bk-vexo). Renomear um deles faria
// a migration rodar de novo. Qualquer par novo derruba o teste.

import { readdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "supabase", "migrations");

const PARES_ANTIGOS_APLICADOS = {
  "20260715120000": [
    "20260715120000_add_entretenimento_local_segment.sql",
    "20260715120000_add_pacotes_ofertados_to_proposals.sql",
  ],
};

function prefixosRepetidos(arquivos) {
  const porPrefixo = new Map();
  for (const f of arquivos) {
    const m = f.match(/^(\d{14})_/); // a mesma regra do runner
    if (!m) continue;
    porPrefixo.set(m[1], [...(porPrefixo.get(m[1]) || []), f]);
  }
  return Object.fromEntries([...porPrefixo].filter(([, fs]) => fs.length > 1).map(([p, fs]) => [p, fs.sort()]));
}

describe("migrations: um timestamp por arquivo", () => {
  const arquivos = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();

  it("a pasta de migrations foi lida", () => {
    expect(arquivos.length).toBeGreaterThan(200);
  });

  it("nenhum prefixo repetido além do par antigo já aplicado em produção", () => {
    expect(prefixosRepetidos(arquivos)).toEqual(PARES_ANTIGOS_APLICADOS);
  });

  it("a regra pega par novo e terceiro arquivo no par antigo", () => {
    expect(prefixosRepetidos(["20261116180000_a.sql", "20261116180000_b.sql", "20261117000000_c.sql"])).toEqual({
      "20261116180000": ["20261116180000_a.sql", "20261116180000_b.sql"],
    });
    expect(prefixosRepetidos(["20261116180000_a.sql", "20261116180001_a.sql"])).toEqual({});
  });
});
