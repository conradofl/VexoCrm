import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import JSZip from "jszip";
import { extractText, docTypeFromMimeType, MIN_USEFUL_CHARS } from "../rag/extraction.js";

// ─── Helpers de fixture: PDF real via pdfkit, DOCX real via JSZip ────────────

function buildPdfBuffer(paragraphs) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument();
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    for (const p of paragraphs) doc.text(p);
    doc.end();
  });
}

async function buildDocxBuffer(paragraphs) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );
  zip.folder("_rels").file(
    ".rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );
  const paragraphsXml = paragraphs
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`)
    .join("");
  zip.folder("word").file(
    "document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${paragraphsXml}</w:body>
</w:document>`
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

const TEXTO_LONGO = "Política de garantia: devolução em até 30 dias após a compra do produto, mediante nota fiscal. ".repeat(5);

describe("extractText (Etapa 5, Leva 2, Commit 2)", () => {
  describe("PDF — pdf-parse contra PDF real gerado por pdfkit", () => {
    it("PDF com texto suficiente extrai normalmente", async () => {
      const buffer = await buildPdfBuffer([TEXTO_LONGO]);
      const text = await extractText(buffer, "pdf");
      expect(text.replace(/\s+/g, "")).toContain("Políticadegarantia".replace(/\s+/g, ""));
    });

    it("TESTE OBRIGATÓRIO: PDF sem texto extraível (digitalizado) falha limpo com mensagem clara, não indexa lixo", async () => {
      // PDF real, válido, mas SEM nenhuma chamada .text() — o equivalente a um
      // PDF só com imagem escaneada: pdf-parse não lança, devolve string vazia.
      const buffer = await buildPdfBuffer([]);
      await expect(extractText(buffer, "pdf")).rejects.toThrow(/digitalizado/);
    });

    it("o código de erro é INSUFFICIENT_TEXT (a rota/worker usa isso pra marcar failed com motivo)", async () => {
      const buffer = await buildPdfBuffer([]);
      try {
        await extractText(buffer, "pdf");
        expect.fail("deveria ter lançado");
      } catch (err) {
        expect(err.code).toBe("INSUFFICIENT_TEXT");
      }
    });
  });

  describe("DOCX — mammoth contra DOCX real construído com JSZip", () => {
    it("DOCX com texto suficiente extrai normalmente", async () => {
      const buffer = await buildDocxBuffer([TEXTO_LONGO]);
      const text = await extractText(buffer, "docx");
      expect(text).toContain("Política de garantia");
    });

    it("DOCX praticamente vazio falha com o piso mínimo (mensagem genérica, não a de PDF)", async () => {
      const buffer = await buildDocxBuffer(["oi"]);
      await expect(extractText(buffer, "docx")).rejects.toThrow(/texto insuficiente/);
      await expect(extractText(buffer, "docx")).rejects.not.toThrow(/digitalizado/);
    });
  });

  describe("TXT / MD — texto puro", () => {
    it("TXT com texto suficiente passa", async () => {
      const buffer = Buffer.from(TEXTO_LONGO, "utf-8");
      const text = await extractText(buffer, "txt");
      expect(text).toBe(TEXTO_LONGO);
    });

    it("MD curto demais falha no piso mínimo", async () => {
      const buffer = Buffer.from("# título\n\ncurto", "utf-8");
      await expect(extractText(buffer, "md")).rejects.toThrow(/texto insuficiente/);
    });
  });

  describe("piso mínimo — exatamente na fronteira", () => {
    it("texto com MIN_USEFUL_CHARS-1 caracteres úteis falha", async () => {
      const buffer = Buffer.from("a".repeat(MIN_USEFUL_CHARS - 1), "utf-8");
      await expect(extractText(buffer, "txt")).rejects.toThrow();
    });

    it("texto com MIN_USEFUL_CHARS caracteres úteis passa", async () => {
      const buffer = Buffer.from("a".repeat(MIN_USEFUL_CHARS), "utf-8");
      await expect(extractText(buffer, "txt")).resolves.toBeTruthy();
    });

    it("espaço em branco não conta como caractere útil (evita OCR 'muitas linhas em branco' escapar o piso)", async () => {
      const textoComEspacosDemais = "a".repeat(50) + " ".repeat(5000) + "a".repeat(50); // só 100 úteis
      const buffer = Buffer.from(textoComEspacosDemais, "utf-8");
      await expect(extractText(buffer, "txt")).rejects.toThrow(/texto insuficiente/);
    });
  });

  describe("docTypeFromMimeType", () => {
    it("mapeia os 4 tipos suportados", () => {
      expect(docTypeFromMimeType("application/pdf")).toBe("pdf");
      expect(docTypeFromMimeType("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("docx");
      expect(docTypeFromMimeType("text/plain")).toBe("txt");
      expect(docTypeFromMimeType("text/markdown")).toBe("md");
    });

    it("mime desconhecido lança UNSUPPORTED_DOC_TYPE", () => {
      expect(() => docTypeFromMimeType("application/zip")).toThrow(/não suportado/);
    });
  });
});
