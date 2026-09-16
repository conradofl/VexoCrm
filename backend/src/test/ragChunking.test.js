import { describe, expect, it } from "vitest";
import { chunkText, DEFAULT_CHUNK_SIZE, DEFAULT_CHUNK_OVERLAP } from "../rag/chunking.js";

describe("chunkText (Etapa 5, Leva 2, Commit 2)", () => {
  it("texto vazio devolve array vazio", () => {
    expect(chunkText("")).toEqual([]);
    expect(chunkText("   \n\n  ")).toEqual([]);
  });

  it("texto curto (menor que chunkSize) vira um único trecho", () => {
    const chunks = chunkText("Um texto curto de teste.", { chunkSize: 1000, overlap: 150 });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual({ ordinal: 0, content: "Um texto curto de teste.", charCount: 24 });
  });

  it("determinístico: o mesmo texto gera sempre os mesmos trechos, na mesma ordem", () => {
    const texto = "Parágrafo um bem longo. ".repeat(100) + "\n\n" + "Parágrafo dois bem longo. ".repeat(100);
    const a = chunkText(texto);
    const b = chunkText(texto);
    expect(a).toEqual(b);
  });

  it("mantém a ordem crescente de ordinal, sem pular nem repetir", () => {
    const texto = "frase curta. ".repeat(500);
    const chunks = chunkText(texto, { chunkSize: 1000, overlap: 150 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => expect(c.ordinal).toBe(i));
  });

  it("aplica sobreposição: o fim de um trecho reaparece no início do próximo", () => {
    const texto = "abcdefghij ".repeat(200); // sem quebra de parágrafo, força corte por tamanho
    const chunks = chunkText(texto, { chunkSize: 300, overlap: 50 });
    expect(chunks.length).toBeGreaterThan(1);

    const fimDoPrimeiro = chunks[0].content.slice(-30);
    expect(chunks[1].content).toContain(fimDoPrimeiro.trim().split(" ").slice(-2).join(" "));
  });

  it("corta em fim de parágrafo quando o parágrafo cabe razoavelmente na janela", () => {
    const paragrafo1 = "A".repeat(600);
    const paragrafo2 = "B".repeat(600);
    const texto = `${paragrafo1}\n\n${paragrafo2}`;
    const chunks = chunkText(texto, { chunkSize: 700, overlap: 100 });

    // O primeiro trecho não deveria misturar A com B no meio de uma "palavra" de 600 chars —
    // o corte em \n\n acontece porque cai depois da metade da janela (350).
    expect(chunks[0].content).not.toContain("B");
  });

  it("parágrafo maior que chunkSize é fatiado por tamanho, sem travar", () => {
    const paragrafoGigante = "X".repeat(5000);
    const chunks = chunkText(paragrafoGigante, { chunkSize: 1000, overlap: 150 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c) => expect(c.content.length).toBeLessThanOrEqual(1000));
  });

  it("usa os valores padrão (1000/150) quando nenhuma opção é passada", () => {
    const texto = "palavra ".repeat(2000); // bem mais que 1000 chars
    const semOpcoes = chunkText(texto);
    const comOpcoesIguais = chunkText(texto, { chunkSize: DEFAULT_CHUNK_SIZE, overlap: DEFAULT_CHUNK_OVERLAP });
    expect(semOpcoes).toEqual(comOpcoesIguais);
  });

  it("não entra em loop infinito com overlap >= chunkSize (configuração defensiva)", () => {
    const texto = "conteudo ".repeat(500);
    const start = Date.now();
    const chunks = chunkText(texto, { chunkSize: 100, overlap: 100 });
    expect(Date.now() - start).toBeLessThan(2000);
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("charCount bate com o tamanho real do content", () => {
    const chunks = chunkText("frase curta. ".repeat(500), { chunkSize: 400, overlap: 50 });
    for (const c of chunks) {
      expect(c.charCount).toBe(c.content.length);
    }
  });
});
