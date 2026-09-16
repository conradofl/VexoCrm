// backend/src/rag/chunking.js
//
// Fatia texto extraído em trechos de ~1000 caracteres com 150 de sobreposição,
// cortando em fim de parágrafo quando possível. Determinístico: o mesmo texto
// gera sempre os mesmos trechos, na mesma ordem — sem isso, reindexar o MESMO
// arquivo sem nenhuma mudança geraria embeddings diferentes por acaso de
// fatiamento, o que não ajuda ninguém a confiar no resultado.

export const DEFAULT_CHUNK_SIZE = 1000;
export const DEFAULT_CHUNK_OVERLAP = 150;

/**
 * @param {string} text
 * @param {{ chunkSize?: number, overlap?: number }} [options]
 * @returns {Array<{ ordinal: number, content: string, charCount: number }>}
 */
export function chunkText(text, { chunkSize = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP } = {}) {
  const normalized = String(text || "").trim();
  if (!normalized) return [];

  const chunks = [];
  let start = 0;
  let ordinal = 0;

  while (start < normalized.length) {
    let end = Math.min(start + chunkSize, normalized.length);

    if (end < normalized.length) {
      // Só aceita cortar num fim de parágrafo/linha se isso não encolher o
      // trecho pra menos da metade do tamanho alvo — senão um parágrafo bem
      // no início da janela geraria trechos minúsculos em cascata.
      const minAcceptableEnd = start + Math.floor(chunkSize * 0.5);

      const paragraphBreak = normalized.lastIndexOf("\n\n", end);
      if (paragraphBreak > minAcceptableEnd) {
        end = paragraphBreak + 2;
      } else {
        const lineBreak = normalized.lastIndexOf("\n", end);
        if (lineBreak > minAcceptableEnd) {
          end = lineBreak + 1;
        }
      }
    }

    const content = normalized.slice(start, end).trim();
    if (content) {
      chunks.push({ ordinal, content, charCount: content.length });
      ordinal++;
    }

    if (end >= normalized.length) break;

    // Próximo trecho recua `overlap` caracteres — mas sempre avança pelo
    // menos 1 caractere a partir do `start` atual, pra nunca travar em loop
    // infinito com overlap >= chunkSize (configuração absurda, mas defensiva).
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}
