// PR 4b do untangle: host e chave da Evolution saem só de variável de ambiente ou do cadastro da
// instância, nunca de valor escrito no código (o repositório é público). O /health
// (evolutionConfig) provou em 24/11/2026 que EVOLUTION_API_URL e EVOLUTION_API_KEY existem em produção.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");
function arquivos(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) return nome === "test" ? [] : arquivos(p);
    return p.endsWith(".js") ? [p] : [];
  });
}

describe("Evolution sem valor escrito no código", () => {
  const fontes = arquivos(SRC).map((p) => [p.slice(SRC.length + 1), readFileSync(p, "utf8")]);

  it("nenhum arquivo do backend escreve o host da Evolution de produção", () => {
    expect(fontes.filter(([, s]) => s.includes("vexo-evolution-api.")).map(([p]) => p)).toEqual([]);
  });

  it("evolution.js, heloisaEngine.js e slackMirrorIn.js não caem numa chave literal", () => {
    for (const p of ["services/evolution.js", "domains/goclaw/heloisaEngine.js", "geracaoDigital/slackMirrorIn.js"]) {
      const s = fontes.find(([nome]) => nome === p)[1];
      expect(s, p).not.toMatch(/(EVOLUTION_API_KEY|EVOLUTION_GLOBAL_KEY|GD_EVOLUTION_TOKEN)\)?\s*\|\|\s*\n?\s*"[A-Za-z0-9]{20,}"/);
    }
  });
});
