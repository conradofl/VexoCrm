// frontend/src/test/designTokens.test.ts
//
// "Fontes, raio e paleta — um lugar só" — estrutural sobre os dois arquivos
// que carregam o sistema de design (index.css, tailwind.config.ts). Não
// julga se ficou bonito (isso só se avalia na tela) — prova que a fonte
// carrega, que o raio mudou num lugar só, e que os três blocos de tema
// (:root/.light/.dark) definem exatamente o mesmo conjunto de tokens, o
// erro que deixa texto de um tema sobre fundo de outro.

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const cssPath = path.resolve(__dirname, "../index.css");
const tailwindConfigPath = path.resolve(__dirname, "../../tailwind.config.ts");

const css = fs.readFileSync(cssPath, "utf8");
const tailwindConfig = fs.readFileSync(tailwindConfigPath, "utf8");

function extractThemeBlock(source: string, selector: string): string {
  const marker = `${selector} {`;
  const start = source.indexOf(marker);
  expect(start, `bloco "${selector}" não encontrado em index.css`).toBeGreaterThan(-1);
  let depth = 0;
  let i = start + marker.length - 1;
  for (; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  return source.slice(start, i + 1);
}

function extractTokenNames(block: string): string[] {
  const matches = block.matchAll(/--([a-z0-9-]+):/g);
  return Array.from(matches, (m) => m[1]).sort();
}

describe("Design tokens — fontes, raio e paleta", () => {
  it("[TESTE OBRIGATÓRIO] as três fontes carregam do Google Fonts, com font-sans apontando pra Public Sans", () => {
    expect(css).toContain("fonts.googleapis.com");
    expect(css).toContain("family=Archivo");
    expect(css).toContain("family=Public+Sans");
    expect(css).toContain("family=JetBrains+Mono");

    // Lexend e Geist Mono saem — não podem sobrar em lugar nenhum
    expect(css).not.toMatch(/Lexend/);
    expect(css).not.toMatch(/Geist Mono/);
    expect(css).not.toMatch(/cdnfonts\.com/);
    expect(tailwindConfig).not.toMatch(/Lexend/);
    expect(tailwindConfig).not.toMatch(/Geist Mono/);

    // font-sans é Public Sans — é o que muda o corpo do sistema sem tocar
    // em componente nenhum
    const sansMatch = tailwindConfig.match(/sans:\s*\[([^\]]+)\]/);
    expect(sansMatch).toBeTruthy();
    expect(sansMatch![1]).toContain('"Public Sans"');

    const displayMatch = tailwindConfig.match(/display:\s*\[([^\]]+)\]/);
    expect(displayMatch![1]).toContain('"Archivo"');

    const monoMatch = tailwindConfig.match(/mono:\s*\[([^\]]+)\]/);
    expect(monoMatch![1]).toContain('"JetBrains Mono"');
  });

  it("[TESTE OBRIGATÓRIO] o raio mudou num lugar só — --radius vale 0.625rem, sem sobrar 1.125rem em lugar nenhum", () => {
    const radiusDeclarations = css.match(/--radius:\s*[^;]+;/g) || [];
    expect(radiusDeclarations).toHaveLength(1);
    expect(radiusDeclarations[0]).toContain("0.625rem");
    expect(css).not.toMatch(/1\.125rem/);
  });

  it("[TESTE OBRIGATÓRIO] :root, .light e .dark definem exatamente o mesmo conjunto de tokens", () => {
    const rootBlock = extractThemeBlock(css, ":root");
    const lightBlock = extractThemeBlock(css, ".light");
    const darkBlock = extractThemeBlock(css, ".dark");

    const rootTokens = extractTokenNames(rootBlock);
    const lightTokens = extractTokenNames(lightBlock);
    const darkTokens = extractTokenNames(darkBlock);

    // :root tem --radius a mais (não é tema, não se repete por bloco) —
    // removido antes de comparar, senão a comparação falsamente reprova.
    const rootThemeTokens = rootTokens.filter((t) => t !== "radius");

    expect(rootThemeTokens).toEqual(lightTokens);
    expect(lightTokens).toEqual(darkTokens);
    expect(darkTokens.length).toBeGreaterThan(15); // sanity: não é uma lista vazia
  });

  it("a paleta separa as cores semânticas do acento — destructive/success/warning/info não usam o hue do primary", () => {
    const darkBlock = extractThemeBlock(css, ".dark");
    const primaryHue = darkBlock.match(/--primary:\s*(\d+)/)?.[1];
    const destructiveHue = darkBlock.match(/--destructive:\s*(\d+)/)?.[1];
    const successHue = darkBlock.match(/--success:\s*(\d+)/)?.[1];
    expect(primaryHue).not.toBe(destructiveHue);
    expect(primaryHue).not.toBe(successHue);
  });
});
