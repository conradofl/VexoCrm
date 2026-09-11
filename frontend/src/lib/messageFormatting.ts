/**
 * Normaliza quebras de linha para renderização das bolhas de mensagem:
 * - \n DUPLO (linha em branco) = parágrafo -> PRESERVA
 * - \n SIMPLES no meio de frase = artefato de quebra rígida (~60 colunas) -> converte em espaço
 *   (Critério: a linha anterior não termina em pontuação final [. ! ? :] E a próxima linha começa em minúscula)
 * - nos demais casos, preserva a quebra.
 *
 * Não altera o dado gravado no banco, é puramente para apresentação visual fluida.
 */
export function normalizeMessageText(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";

  // Divide por quebras de parágrafo (\n\n) para isolar blocos lógicos
  const paragraphs = raw.split(/\r?\n\s*\r?\n/);

  const cleanedParagraphs = paragraphs.map((paragraph) => {
    const lines = paragraph.split(/\r?\n/);
    if (lines.length <= 1) return paragraph.trim();

    let result = lines[0].trimEnd();
    for (let i = 1; i < lines.length; i++) {
      const prevLine = result.trimEnd();
      const currentLine = lines[i].trimStart();

      if (!currentLine) continue;

      const lastChar = prevLine.slice(-1);
      const endsWithPunctuation = [".", "!", "?", ":"].includes(lastChar);
      const startsWithLowercase = /^[a-zà-ÿ0-9]/.test(currentLine);

      if (!endsWithPunctuation && startsWithLowercase) {
        result = `${result} ${currentLine}`;
      } else {
        result = `${result}\n${currentLine}`;
      }
    }
    return result;
  });

  return cleanedParagraphs.filter(Boolean).join("\n\n");
}

/**
 * Formata o totalizador do cabeçalho da lista de conversas do Inbox:
 * - Se total > loaded: "Mostrando 40 de 458"
 * - Se total <= loaded: "15 conversas" ou "1 conversa" ou "0 conversas"
 */
export function formatHeaderCount(loaded: number, total: number): string {
  const safeLoaded = Math.max(0, loaded || 0);
  const safeTotal = Math.max(0, total || 0);
  if (safeTotal > safeLoaded) {
    return `Mostrando ${safeLoaded} de ${safeTotal}`;
  }
  return `${safeLoaded} conversa${safeLoaded === 1 ? "" : "s"}`;
}
