// backend/src/test/imageImportsStayInsideBackend.test.js
//
// A imagem do backend é construída com contexto backend/ e só copia package*.json, src, scripts, supabase e
// start.sh (backend/Dockerfile). Todo import de código de PRODUÇÃO tem que resolver dentro dessas pastas.
//
// Em 14/10/2026 services/campaignScheduleValidation.js importava "../../../shared/…": no repositório o caminho
// existe (raiz/shared), no contêiner aponta para /shared — e o backend caiu no boot com ERR_MODULE_NOT_FOUND.
// Os testes passavam porque rodam no repositório. Este teste lê os imports e confere onde cada um vai parar.
//
// Testes (src/test) ficam de fora: leem fixtures da raiz (shared/*.json) e não rodam no contêiner.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const BACKEND = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PASTAS_NA_IMAGEM = ["src", "scripts", "supabase"]; // + package*.json e start.sh (Dockerfile)
// node_modules também está na imagem (RUN npm ci --omit=dev no Dockerfile).
const ALVOS_NA_IMAGEM = [...PASTAS_NA_IMAGEM, "node_modules"];

// Falsos positivos conhecidos, cada um com o motivo. Não é lugar para silenciar import de verdade.
const EXCECOES = new Map([
  // a linha é TEXTO do código que o script gera (template string), não um import do próprio script
  ["scripts/gen-domain-routes.mjs → ../http/routeDeps.js", "import dentro do código gerado (template string)"],
]);
const IMPORT_RELATIVO = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+)["']/g;

function arquivosDeCodigo(dir) {
  const saida = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (nome === "node_modules") continue;
    if (caminho === join(BACKEND, "src", "test")) continue;
    const st = statSync(caminho);
    if (st.isDirectory()) saida.push(...arquivosDeCodigo(caminho));
    else if (/\.(m?js|cjs)$/.test(nome)) saida.push(caminho);
  }
  return saida;
}

function importsQueSaemDaImagem() {
  const fora = [];
  for (const pasta of PASTAS_NA_IMAGEM) {
    for (const arquivo of arquivosDeCodigo(join(BACKEND, pasta))) {
      const texto = readFileSync(arquivo, "utf8");
      for (const m of texto.matchAll(IMPORT_RELATIVO)) {
        const alvo = resolve(dirname(arquivo), m[1]);
        const rel = relative(BACKEND, alvo);
        const dentro = ALVOS_NA_IMAGEM.some((p) => rel === p || rel.startsWith(p + sep));
        const chave = `${relative(BACKEND, arquivo)} → ${m[1]}`;
        if (!dentro && !EXCECOES.has(chave)) fora.push(chave);
      }
    }
  }
  return fora;
}

describe("[OBRIGATÓRIO] todo import de produção do backend resolve dentro do que a imagem copia", () => {
  it("nenhum import de src/, scripts/ ou supabase/ aponta para fora deles (ex.: ../../../shared/)", () => {
    expect(importsQueSaemDaImagem()).toEqual([]);
  });
});
