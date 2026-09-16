import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  detectRagDocumentType,
  buildRagDocumentStorageKey,
  saveRagDocumentBuffer,
  getRagDocumentBuffer,
  deleteRagDocumentBuffer,
  RAG_MAX_BYTES,
} from "../services/storage.js";

describe("Storage de Documentos RAG (Etapa 5, Leva 2, Commit 1)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("detectRagDocumentType — assinatura de bytes, não extensão declarada", () => {
    it("PDF: %PDF-", () => {
      const buffer = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(20)]);
      expect(detectRagDocumentType(buffer, "qualquer.txt")).toEqual({
        docType: "pdf",
        mimeType: "application/pdf",
      });
    });

    it("DOCX: zip PK + extensão .docx", () => {
      const buffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
      expect(detectRagDocumentType(buffer, "manual.docx")).toEqual({
        docType: "docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });
    });

    it("zip que não é .docx declarado é rejeitado (não vira RAG document)", () => {
      const buffer = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(20)]);
      expect(() => detectRagDocumentType(buffer, "arquivo.zip")).toThrow(/não permitido/);
    });

    it("TXT: texto UTF-8 puro, sem extensão .md", () => {
      const buffer = Buffer.from("Tabela de preços: Plano A R$100, Plano B R$200.", "utf-8");
      expect(detectRagDocumentType(buffer, "tabela.txt")).toEqual({
        docType: "txt",
        mimeType: "text/plain",
      });
    });

    it("MD: texto UTF-8 puro, extensão .md", () => {
      const buffer = Buffer.from("# FAQ\n\nPergunta: ...", "utf-8");
      expect(detectRagDocumentType(buffer, "faq.md")).toEqual({
        docType: "md",
        mimeType: "text/markdown",
      });
    });

    it("acentos em UTF-8 continuam sendo aceitos como texto", () => {
      const buffer = Buffer.from("Política de garantia: devolução em até 30 dias após a compra.", "utf-8");
      expect(() => detectRagDocumentType(buffer, "politica.txt")).not.toThrow();
    });

    it("executável (MZ) é bloqueado, mesmo travestido de .txt", () => {
      const buffer = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(20)]);
      expect(() => detectRagDocumentType(buffer, "fingido.txt")).toThrow(/não permitido/);
    });

    it("buffer binário arbitrário (não-UTF-8 válido, sem assinatura conhecida) é rejeitado, não vira TXT por acidente", () => {
      const buffer = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x02, 0x80, 0x81]);
      expect(() => detectRagDocumentType(buffer, "binario.txt")).toThrow(/não permitido/);
    });

    it("buffer vazio lança EMPTY_BUFFER", () => {
      expect(() => detectRagDocumentType(Buffer.alloc(0))).toThrow();
    });
  });

  describe("buildRagDocumentStorageKey", () => {
    it("gera chave com prefixo rag/, escapando clientId/filename", () => {
      const key = buildRagDocumentStorageKey("geracao-digital", "doc-1", "Tabela de Preços.pdf", 1700000000000);
      expect(key).toBe("rag/geracao-digital/doc-1/1700000000000_Tabela_de_Pre_os.pdf");
    });
  });

  describe("save/get/delete — round trip byte-a-byte no storage local (NODE_ENV=test)", () => {
    it("salva, lê de volta os bytes EXATOS, depois apaga — e uma segunda leitura devolve null", async () => {
      const original = Buffer.from("Conteúdo de teste do documento RAG, incluindo acentuação.", "utf-8");
      const saveResult = await saveRagDocumentBuffer({
        clientId: "geracao-digital",
        documentId: "doc-roundtrip-1",
        buffer: original,
        filename: "teste.txt",
        mimeType: "text/plain",
      });
      expect(saveResult.storageKey).toContain("rag/geracao-digital/doc-roundtrip-1/");
      expect(saveResult.sizeBytes).toBe(original.length);

      const read = await getRagDocumentBuffer(saveResult.storageKey);
      expect(read).not.toBeNull();
      expect(Buffer.compare(read.buffer, original)).toBe(0);

      const deleted = await deleteRagDocumentBuffer(saveResult.storageKey);
      expect(deleted).toBe(true);

      const readAfterDelete = await getRagDocumentBuffer(saveResult.storageKey);
      expect(readAfterDelete).toBeNull();
    });

    it("recusa buffer maior que o teto de 20MB", async () => {
      const big = Buffer.alloc(RAG_MAX_BYTES + 1);
      await expect(
        saveRagDocumentBuffer({ clientId: "t", documentId: "d", buffer: big, filename: "grande.txt" })
      ).rejects.toThrow(/20 MB/);
    });

    it("recusa buffer vazio", async () => {
      await expect(
        saveRagDocumentBuffer({ clientId: "t", documentId: "d", buffer: Buffer.alloc(0), filename: "vazio.txt" })
      ).rejects.toThrow();
    });

    it("apagar chave inexistente não lança — idempotente", async () => {
      const deleted = await deleteRagDocumentBuffer("rag/nao-existe/nao-existe/0_x.txt");
      expect(deleted).toBe(true);
    });
  });
});
