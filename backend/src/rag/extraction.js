// backend/src/rag/extraction.js
//
// Extração de texto pra indexação RAG. PDF via pdf-parse, DOCX via mammoth,
// TXT/MD são texto puro. O tipo já foi decidido na assinatura de bytes no
// upload (detectRagDocumentType) — aqui só traduz o mime_type gravado de
// volta pro tipo de extração.
//
// Piso mínimo de texto útil: é aqui que um PDF digitalizado (imagem sem
// camada de texto) é pego. pdf-parse não lança erro pra isso — devolve string
// vazia ou um punhado de caracteres de lixo (cabeçalho/rodapé OCR malfeito).
// Sem o piso, esse documento entraria "ready" com 1-2 trechos vazios: pior que
// recusar, porque a base fica com um item que PARECE indexado e nunca vai
// achar nada.

import { PDFParse } from "pdf-parse";
import { extractRawText } from "mammoth";

export const MIN_USEFUL_CHARS = 200;

export function docTypeFromMimeType(mimeType) {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (mimeType === "text/markdown") return "md";
  if (mimeType === "text/plain") return "txt";
  const err = new Error(`Tipo de arquivo não suportado para extração de texto: ${mimeType}`);
  err.code = "UNSUPPORTED_DOC_TYPE";
  throw err;
}

async function extractPdfText(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return result?.text || "";
  } finally {
    await parser.destroy();
  }
}

async function extractDocxText(buffer) {
  const result = await extractRawText({ buffer });
  return result?.value || "";
}

function countUsefulChars(text) {
  // Espaço/quebra de linha não conta como conteúdo — um PDF digitalizado mal
  // OCRizado pode devolver várias linhas em branco que somam "muitos
  // caracteres" sem ter nenhuma informação real.
  return String(text || "").replace(/\s+/g, "").length;
}

/**
 * Extrai o texto de um buffer de documento. Lança INSUFFICIENT_TEXT se o
 * documento inteiro tiver menos de MIN_USEFUL_CHARS caracteres úteis — nunca
 * indexa um documento vazio ou quase vazio.
 */
export async function extractText(buffer, docType) {
  let raw;
  if (docType === "pdf") {
    raw = await extractPdfText(buffer);
  } else if (docType === "docx") {
    raw = await extractDocxText(buffer);
  } else if (docType === "txt" || docType === "md") {
    raw = buffer.toString("utf-8");
  } else {
    const err = new Error(`Tipo de documento desconhecido pra extração: ${docType}`);
    err.code = "UNSUPPORTED_DOC_TYPE";
    throw err;
  }

  const usefulChars = countUsefulChars(raw);
  if (usefulChars < MIN_USEFUL_CHARS) {
    const err = new Error(
      docType === "pdf"
        ? "Este PDF parece ser digitalizado (sem texto extraível). Exporte em texto ou envie outro formato."
        : `O documento tem texto insuficiente pra indexar (${usefulChars} caractere(s) útil(eis) — mínimo ${MIN_USEFUL_CHARS}).`
    );
    err.code = "INSUFFICIENT_TEXT";
    throw err;
  }

  return raw;
}
