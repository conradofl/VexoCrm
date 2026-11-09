// backend/src/domains/geracaoDigitalContracts/contractVisualRenderer.js
//
// Módulo de renderização visual de alta fidelidade para contratos da Geração Digital (GD).
// Reflete com 100% de precisão o design do modelo oficial docx, utilizando as cores oficiais,
// componentes estruturados (boxes, tabelas roxas, alíneas estilizadas) e fechamento rigoroso em 2 páginas.

import PDFDocument from "pdfkit";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  prepareContractDados,
  formatCnpj,
  formatTelefone,
  formatBrl,
  toExtenseOrdinal,
  calculateScheduleTotals,
} from "./contractMerge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Diretório de assets oficiais extraídos do modelo docx
export const ASSETS_DIR = path.resolve(__dirname, "../../assets/contractTemplate");

/**
 * Resolve com segurança o caminho de um arquivo de asset com múltiplos fallbacks.
 */
export function getImageAssetPath(fileName) {
  const directPath = path.join(ASSETS_DIR, fileName);
  if (fs.existsSync(directPath)) return directPath;

  const cwdPath = path.resolve(process.cwd(), "src/assets/contractTemplate", fileName);
  if (fs.existsSync(cwdPath)) return cwdPath;

  const backendCwdPath = path.resolve(process.cwd(), "backend/src/assets/contractTemplate", fileName);
  if (fs.existsSync(backendCwdPath)) return backendCwdPath;

  return directPath;
}

// 1. Paleta de Cores Fidedigna ao Modelo Word GD
export const GD_COLORS = {
  deepPurple: "#4A1370",  // Título principal, títulos de empresas, títulos de cláusula, valores na tabela
  primary: "#7B1FB0",     // "CLÁUSULA ORDINAL", rótulos nos boxes (CNPJ:, Telefone:), cabeçalhos de tabela
  magenta: "#C2208E",     // Subtítulo "MARKETING DIGITAL & AUTOMAÇÃO", alíneas a), b), c), tag CONTRATANTE/CONTRATADA
  lightLilac: "#DCC7EC",  // Borda suave, separador " | ", fundo suave
  highlightBg: "#FAF5FF", // Fundo lavanda das barras de cláusula e linhas alternadas
  textDark: "#1F2937",    // Texto escuro padrão de leitura
  textMuted: "#6E6878",   // Cinza elegante dos dados de rodapé e linhas de testemunhas
  white: "#FFFFFF",
  boxBg: "#FAFAFE",

  // Aliases auxiliares para retrocompatibilidade
  softBorder: "#DCC7EC",
  secondary: "#C2208E",
  tableRowAlt: "#FAF5FF",
};

// Aliases para retrocompatibilidade
export const CONTRACT_PDF_COLORS = {
  primaryDark: GD_COLORS.deepPurple,
  primary: GD_COLORS.primary,
  secondary: GD_COLORS.magenta,
  accentLight: GD_COLORS.lightLilac,
  boxBg: GD_COLORS.highlightBg,
  tableSubBg: GD_COLORS.highlightBg,
  tableAltBg: GD_COLORS.highlightBg,
  textDark: GD_COLORS.textDark,
  textMuted: GD_COLORS.textMuted,
  white: GD_COLORS.white,
};

// Métricas padrão de página A4 e margens oficiais
export const PAGE_METRICS = {
  width: 595.28,
  height: 841.89,
  margins: { top: 36, bottom: 36, left: 42, right: 42 },
  contentWidth: 511.28, // 595.28 - (42 * 2)
};

/**
 * 3. Topo Gradiente em Todas as Páginas
 * Desenha image2.png cobrindo toda a largura superior (595.28 x 6.0 pt).
 */
export function drawTopGradient(doc) {
  const image2Path = getImageAssetPath("image2.png");
  if (fs.existsSync(image2Path)) {
    try {
      doc.image(image2Path, 0, 0, { width: 595.28, height: 6.0 });
    } catch (err) {
      console.warn("[drawTopGradient] Aviso ao renderizar image2.png:", err.message);
    }
  }
}

/**
 * Identifica e normaliza cabeçalhos de cláusula (ex: "CLÁUSULA PRIMEIRA | DAS PARTES").
 */
export function normalizeClauseHeader(line) {
  if (!line || typeof line !== "string") return null;
  const match = line.match(/^(?:CLÁUSULA|Cláusula|CLAUSULA)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9ºª\s]+?)\s*(?:[–\-:|]\s*(.*))?$/i);
  if (!match) return null;
  let ordinal = match[1].trim();
  const num = parseInt(ordinal, 10);
  if (!isNaN(num) && num > 0) {
    ordinal = toExtenseOrdinal(num);
  }
  const cleanTitle = (match[2] || "").trim();
  return {
    ordinal: ordinal.toUpperCase(),
    title: cleanTitle.toUpperCase(),
    fullHeader: `CLÁUSULA ${ordinal.toUpperCase()}   |   ${cleanTitle.toUpperCase()}`,
  };
}

/**
 * Renderiza parágrafos com suporte a marcação de negrito (**texto** ou <b>texto</b>).
 * Configura doc.x e doc.y previamente para evitar saltos de continuação no PDFKit.
 */
export function renderFormattedParagraph(doc, text, options = {}) {
  if (!text) return;
  const regex = /(\*\*.*?\*\*|<b>.*?<\/b>)/g;
  const parts = String(text).split(regex);
  const tokens = parts.filter(Boolean).map((part) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return { text: part.slice(2, -2), bold: true };
    }
    if (/^<b>(.*?)<\/b>$/i.test(part)) {
      return { text: part.replace(/^<b>|<\/b>$/gi, ""), bold: true };
    }
    return { text: part, bold: false };
  });

  if (tokens.length === 0) return;

  const { x, y, ...textOptions } = options;
  if (x !== undefined) doc.x = x;
  if (y !== undefined) doc.y = y;

  tokens.forEach((token, idx) => {
    const isLast = idx === tokens.length - 1;
    doc.font(token.bold ? "Helvetica-Bold" : "Helvetica");
    doc.text(token.text, {
      ...textOptions,
      continued: !isLast,
    });
  });
}

/**
 * a) drawHeader(doc) com tipografia, cores e traço divisório degradê.
 */
export function drawHeader(doc) {
  const startX = 42;
  const contentW = 511.28;
  const startY = doc.page.margins.top || 36;

  // Título principal em negrito deepPurple (15pt)
  doc.font("Helvetica-Bold")
    .fontSize(15)
    .fillColor(GD_COLORS.deepPurple)
    .text("CONTRATO DE PRESTAÇÃO DE SERVIÇOS", startX, startY, {
      align: "center",
      width: contentW,
    });

  doc.moveDown(0.2);

  // Subtítulo em magenta com espaçamento de caracteres (10pt)
  doc.font("Helvetica-Bold")
    .fontSize(10)
    .fillColor(GD_COLORS.magenta)
    .text("MARKETING DIGITAL & AUTOMAÇÃO", startX, doc.y, {
      align: "center",
      width: contentW,
      characterSpacing: 1.5,
    });

  doc.moveDown(0.35);

  // Linha divisória de degradê abaixo do cabeçalho
  const dividerY = doc.y;
  const image1Path = getImageAssetPath("image1.png");

  if (fs.existsSync(image1Path)) {
    const imgW = 140;
    const imgH = 2.5;
    const imgX = (doc.page.width - imgW) / 2;
    try {
      doc.image(image1Path, imgX, dividerY, { width: imgW, height: imgH });
      doc.y = dividerY + imgH + 8;
    } catch {
      doc.rect(imgX, dividerY, imgW, 1.5).fill(GD_COLORS.magenta);
      doc.y = dividerY + 1.5 + 8;
    }
  } else {
    const lineW = 140;
    const lineX = (doc.page.width - lineW) / 2;
    doc.rect(lineX, dividerY, lineW, 1.5).fill(GD_COLORS.magenta);
    doc.y = dividerY + 1.5 + 8;
  }
}

/**
 * b) drawClauseHeader(doc, title) com barra lateral roxa (#7B1FB0) e fundo #FAF5FF.
 * Suporta tanto drawClauseHeader(doc, title) quanto drawClauseHeader(doc, ordinal, title).
 */
export function drawClauseHeader(doc, ordinalOrTitle, title) {
  let ordinal = "";
  let cleanTitle = "";

  if (title !== undefined) {
    ordinal = String(ordinalOrTitle || "").trim();
    cleanTitle = String(title || "").trim();
  } else if (ordinalOrTitle) {
    const parsed = normalizeClauseHeader(String(ordinalOrTitle));
    if (parsed) {
      ordinal = parsed.ordinal;
      cleanTitle = parsed.title;
    } else {
      cleanTitle = String(ordinalOrTitle).trim();
    }
  }

  const startX = 42;
  const barW = 511.28;
  const barH = 19;
  const curY = doc.y;

  // Fundo lavanda / destaque (#FAF5FF)
  doc.rect(startX, curY, barW, barH).fill(GD_COLORS.highlightBg);

  // Barra lateral roxa sólida à esquerda (#7B1FB0) de 3.5pt de espessura
  const lateralBarW = 3.5;
  doc.rect(startX, curY, lateralBarW, barH).fill(GD_COLORS.primary);

  // Borda suave inferior/externa (#DCC7EC)
  doc.rect(startX, curY, barW, barH)
    .strokeColor(GD_COLORS.lightLilac)
    .lineWidth(0.5)
    .stroke();

  // Texto: CLÁUSULA ORDINAL   |   TÍTULO
  const textX = startX + 8;
  const textY = curY + 4.2;

  if (ordinal) {
    const ordNormalized = ordinal.replace(/^(?:CLÁUSULA|CLAUSULA)\s+/i, "").trim().toUpperCase();
    doc.font("Helvetica-Bold").fontSize(10).fillColor(GD_COLORS.primary)
      .text(`CLÁUSULA ${ordNormalized}`, textX, textY, { continued: true });
    doc.font("Helvetica").fontSize(10).fillColor(GD_COLORS.lightLilac)
      .text("   |   ", { continued: true });
    doc.font("Helvetica-Bold").fontSize(10).fillColor(GD_COLORS.deepPurple)
      .text(cleanTitle.toUpperCase(), { continued: false });
  } else {
    doc.font("Helvetica-Bold").fontSize(10).fillColor(GD_COLORS.deepPurple)
      .text(cleanTitle.toUpperCase(), textX, textY, { continued: false });
  }

  doc.y = curY + barH + 5;
  doc.x = startX;
}

/**
 * Normaliza os dados das partes (objeto ou array de linhas de texto).
 */
export function normalizePartesBoxData(data, fallbackRole = "") {
  if (!data) return { title: fallbackRole, fields: [] };

  if (Array.isArray(data)) {
    const title = data[0] || fallbackRole;
    const fields = [];
    for (let i = 1; i < data.length; i++) {
      const line = data[i].trim();
      if (!line) continue;
      const colonIdx = line.indexOf(":");
      if (colonIdx > 0) {
        const rawLabel = line.slice(0, colonIdx).trim() + ":";
        let rawVal = line.slice(colonIdx + 1).trim();
        if (/cnpj/i.test(rawLabel)) rawVal = formatCnpj(rawVal);
        if (/telefone/i.test(rawLabel)) rawVal = formatTelefone(rawVal);
        fields.push({ label: rawLabel, value: rawVal });
      } else {
        fields.push({ label: "", value: line });
      }
    }
    return { title, fields };
  }

  // Objeto estruturado
  const title = data.razao_social || data.nome || fallbackRole;
  const fields = [];
  if (data.cnpj) {
    fields.push({ label: "CNPJ:", value: formatCnpj(data.cnpj) });
  }
  const rep = data.representante || data.representante_nome || data.responsavel_nome || data.responsavel || "";
  if (rep) {
    const repLabel = data.responsavel_nome ? "Responsável:" : "Representante:";
    fields.push({ label: repLabel, value: rep });
  }
  if (data.endereco) {
    const endStr = typeof data.endereco === "object"
      ? [
        data.endereco.logradouro ? `${data.endereco.logradouro}${data.endereco.numero ? `, ${data.endereco.numero}` : ""}` : "",
        data.endereco.bairro || "",
        data.endereco.cidade && data.endereco.uf ? `${data.endereco.cidade} – ${data.endereco.uf}` : (data.endereco.cidade || ""),
        data.endereco.cep ? `CEP ${data.endereco.cep}` : "",
      ].filter(Boolean).join(", ")
      : String(data.endereco);
    fields.push({ label: "Endereço:", value: endStr });
  }
  if (data.telefone) {
    fields.push({ label: "Telefone:", value: formatTelefone(data.telefone) });
  }
  if (data.email) {
    fields.push({ label: "E-mail:", value: String(data.email) });
  }
  return { title, fields };
}

/**
 * 4. Caixas das Partes (Cláusula Primeira)
 * - colWidth = 244, gap = 12, startX = 42.
 * - Cabeçalhos CONTRATADA e CONTRATANTE com fundo #7B1FB0 e texto branco.
 * - Labels dos campos (CNPJ:, Representante:, Endereço:, Telefone:, E-mail:) em negrito #7B1FB0, com valores em #1F2937.
 */
export function drawPartesBoxes(doc, contratadaInput, contratanteInput) {
  const c1 = normalizePartesBoxData(contratadaInput, "AGÊNCIA GERAÇÃO DIGITAL LTDA");
  const c2 = normalizePartesBoxData(contratanteInput, "CONTRATANTE");

  const startX = 42;
  const colWidth = 244;
  const gap = 12;
  const col1X = startX;
  const col2X = startX + colWidth + gap; // 42 + 244 + 12 = 298
  const headerH = 16;
  const padding = 6;
  const innerW = colWidth - (padding * 2);

  // Calcula a altura necessária para acomodar os campos
  const calcFieldsH = (title, fields) => {
    let h = 14; // título da razão social
    for (const f of fields) {
      const fullText = (f.label ? f.label + " " : "") + f.value;
      if (fullText.length > 42) h += 24;
      else h += 13.5;
    }
    return h;
  };

  const contentH = Math.max(calcFieldsH(c1.title, c1.fields), calcFieldsH(c2.title, c2.fields), 80) + (padding * 2);
  const boxY = doc.y;

  // Box 1: CONTRATADA
  doc.rect(col1X, boxY, colWidth, headerH).fill(GD_COLORS.primary); // #7B1FB0
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(GD_COLORS.white)
    .text("CONTRATADA", col1X + padding, boxY + 4, { width: innerW });
  doc.rect(col1X, boxY + headerH, colWidth, contentH).fill(GD_COLORS.boxBg);
  doc.rect(col1X, boxY, colWidth, headerH + contentH).strokeColor(GD_COLORS.lightLilac).lineWidth(0.5).stroke();

  let tY1 = boxY + headerH + padding;
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(GD_COLORS.deepPurple) // #4A1370
    .text(c1.title, col1X + padding, tY1, { width: innerW });
  tY1 += 13.5;
  for (const field of c1.fields) {
    if (field.label) {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(GD_COLORS.primary) // #7B1FB0
        .text(field.label, col1X + padding, tY1, { continued: true });
      doc.font("Helvetica").fontSize(8.5).fillColor(GD_COLORS.textDark) // #1F2937
        .text(" " + field.value, { width: innerW });
    } else {
      doc.font("Helvetica").fontSize(8.5).fillColor(GD_COLORS.textDark)
        .text(field.value, col1X + padding, tY1, { width: innerW });
    }
    const fullLen = (field.label ? field.label + " " : "") + field.value;
    tY1 += fullLen.length > 42 ? 24 : 13.5;
  }

  // Box 2: CONTRATANTE
  doc.rect(col2X, boxY, colWidth, headerH).fill(GD_COLORS.primary); // #7B1FB0
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(GD_COLORS.white)
    .text("CONTRATANTE", col2X + padding, boxY + 4, { width: innerW });
  doc.rect(col2X, boxY + headerH, colWidth, contentH).fill(GD_COLORS.boxBg);
  doc.rect(col2X, boxY, colWidth, headerH + contentH).strokeColor(GD_COLORS.lightLilac).lineWidth(0.5).stroke();

  let tY2 = boxY + headerH + padding;
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(GD_COLORS.deepPurple) // #4A1370
    .text(c2.title, col2X + padding, tY2, { width: innerW });
  tY2 += 13.5;
  for (const field of c2.fields) {
    if (field.label) {
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(GD_COLORS.primary) // #7B1FB0
        .text(field.label, col2X + padding, tY2, { continued: true });
      doc.font("Helvetica").fontSize(8.5).fillColor(GD_COLORS.textDark) // #1F2937
        .text(" " + field.value, { width: innerW });
    } else {
      doc.font("Helvetica").fontSize(8.5).fillColor(GD_COLORS.textDark)
        .text(field.value, col2X + padding, tY2, { width: innerW });
    }
    const fullLen = (field.label ? field.label + " " : "") + field.value;
    tY2 += fullLen.length > 42 ? 24 : 13.5;
  }

  doc.y = boxY + headerH + contentH + 6;
  doc.x = startX;
}

/**
 * d) drawPricingTable(doc, dados) com colunas rebalanceadas e altura dinâmica de células.
 */
export function drawPricingTable(doc, dados = {}, options = {}) {
  const startX = 42;
  const tblW = 511.28;
  const col1W = 290; // Rebalanceado para acomodar labels
  const col2W = tblW - col1W; // 221.28pt (acomoda "Contrato semestral com pagamento mensal" em 1 linha)
  const tblY = doc.y;

  // Extração e cálculo de valores monetários
  let valorTotalStr = formatBrl(dados.valor_total || options.valorTotal || "") || (options.valorTotal || "R$ 0,00");

  let composicaoLabel = options.composicaoLabel || "Em reais (conforme condições de pagamento)";
  let emReaisVal = options.emReaisVal || "";
  let permutaVal = options.permutaVal || dados.condicao_permuta || "Não aplicável";

  // Se o contrato tem parcelas estruturadas, segrega moeda corrente e permuta
  if (!emReaisVal && Array.isArray(dados.parcelas) && dados.parcelas.length > 0) {
    const totals = calculateScheduleTotals(dados.parcelas);
    emReaisVal = formatBrl(totals.totalDinheiro);
    if (totals.totalPermuta > 0) {
      permutaVal = formatBrl(totals.totalPermuta);
    }
  } else if (!emReaisVal) {
    if (dados.cronograma_pagamento) {
      emReaisVal = formatBrl(dados.cronograma_pagamento) || String(dados.cronograma_pagamento);
    } else if (dados.valor_parcela && dados.num_parcelas) {
      emReaisVal = `${dados.num_parcelas}x de ${formatBrl(dados.valor_parcela)}`;
    } else {
      emReaisVal = valorTotalStr;
    }
  }

  if (typeof emReaisVal === "number") {
    emReaisVal = formatBrl(emReaisVal);
  } else if (typeof emReaisVal === "string" && !emReaisVal.includes("R$") && !isNaN(Number(emReaisVal.replace(/[^\d.,-]/g, "").replace(",", ".")))) {
    emReaisVal = formatBrl(emReaisVal);
  }

  if (typeof permutaVal === "number") {
    permutaVal = formatBrl(permutaVal);
  } else if (typeof permutaVal === "string" && permutaVal !== "Não aplicável" && !permutaVal.includes("R$") && !isNaN(Number(permutaVal.replace(/[^\d.,-]/g, "").replace(",", ".")))) {
    permutaVal = formatBrl(permutaVal);
  }

  emReaisVal = String(emReaisVal || valorTotalStr);
  permutaVal = String(permutaVal || "Não aplicável");

  // Cálculo Dinâmico de Altura para Evitar Qualquer Sobreposição
  const hRow1 = 24;
  const hRow2 = 18;

  doc.font("Helvetica").fontSize(9.0);
  const hLabel3 = doc.heightOfString(composicaoLabel, { width: col1W - 16 });
  doc.font("Helvetica-Bold").fontSize(9.5);
  const hVal3 = doc.heightOfString(emReaisVal, { width: col2W - 16 });
  const hRow3 = Math.max(hLabel3, hVal3, 14) + 8; // Padding superior e inferior

  doc.font("Helvetica").fontSize(9.0);
  const hLabel4 = doc.heightOfString("Em permuta", { width: col1W - 16 });
  doc.font("Helvetica-Bold").fontSize(9.5);
  const hVal4 = doc.heightOfString(permutaVal, { width: col2W - 16 });
  const hRow4 = Math.max(hLabel4, hVal4, 14) + 8;

  const totalH = hRow1 + hRow2 + hRow3 + hRow4;

  const y1 = tblY;
  const y2 = y1 + hRow1;
  const y3 = y2 + hRow2;
  const y4 = y3 + hRow3;

  // Linha 1: Compromisso do Período (Header Roxo Sólido #7B1FB0, texto branco)
  doc.rect(startX, y1, tblW, hRow1).fill(GD_COLORS.primary);
  doc.font("Helvetica-Bold").fontSize(10.5).fillColor(GD_COLORS.white)
     .text("Compromisso do Período", startX + 8, y1 + (hRow1 - 10.5) / 2, { width: col1W - 16 });
  doc.font("Helvetica-Bold").fontSize(11.5).fillColor(GD_COLORS.white)
     .text(valorTotalStr, startX + col1W, y1 + (hRow1 - 11.5) / 2, { width: col2W - 10, align: "right" });

  // Linha 2: COMPOSIÇÃO DO PERÍODO (Subcabeçalho #FAF5FF, texto roxo #7B1FB0)
  doc.rect(startX, y2, tblW, hRow2).fill(GD_COLORS.highlightBg);
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(GD_COLORS.primary)
     .text("COMPOSIÇÃO DO PERÍODO", startX + 8, y2 + (hRow2 - 8.5) / 2, { width: tblW - 16 });

  // Linha 3: Em reais (conforme condições de pagamento)
  doc.rect(startX, y3, tblW, hRow3).fill(GD_COLORS.white);
  doc.font("Helvetica").fontSize(9.0).fillColor(GD_COLORS.textDark)
     .text(composicaoLabel, startX + 8, y3 + (hRow3 - hLabel3) / 2, { width: col1W - 16 });
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(GD_COLORS.deepPurple)
     .text(emReaisVal, startX + col1W, y3 + (hRow3 - hVal3) / 2, { width: col2W - 10, align: "right" });

  // Linha 4: Em permuta
  doc.rect(startX, y4, tblW, hRow4).fill(GD_COLORS.highlightBg);
  doc.font("Helvetica").fontSize(9.0).fillColor(GD_COLORS.textDark)
     .text("Em permuta", startX + 8, y4 + (hRow4 - hLabel4) / 2, { width: col1W - 16 });
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(GD_COLORS.deepPurple)
     .text(permutaVal, startX + col1W, y4 + (hRow4 - hVal4) / 2, { width: col2W - 10, align: "right" });

  // Bordas da tabela
  doc.rect(startX, tblY, tblW, totalH).strokeColor(GD_COLORS.primary).lineWidth(0.75).stroke();
  doc.moveTo(startX, y2).lineTo(startX + tblW, y2).strokeColor(GD_COLORS.primary).lineWidth(0.5).stroke();
  doc.moveTo(startX, y3).lineTo(startX + tblW, y3).strokeColor(GD_COLORS.lightLilac).lineWidth(0.5).stroke();
  doc.moveTo(startX, y4).lineTo(startX + tblW, y4).strokeColor(GD_COLORS.lightLilac).lineWidth(0.5).stroke();

  // Respiro confortável abaixo da tabela para que a Cláusula Quinta não fique colada
  doc.y = tblY + totalH + 14;
  doc.x = startX;
}

/**
 * e) drawSignaturesAndWitnesses(doc, dados) com 2 colunas de assinaturas e 2 testemunhas.
 */
export function drawSignaturesAndWitnesses(doc, dados = {}) {
  const startX = 42;
  const colW = 235;
  const gap = 41;
  const col1X = startX;
  const col2X = startX + colW + gap;

  const contratadaNome = dados.contratada_razao_social || "AGÊNCIA GERAÇÃO DIGITAL LTDA";
  const contratadaRep = dados.contratada_representante || "Caio Vinícius Almeida de Oliveira";
  const contratanteNome = dados.razao_social || dados.assinatura_contratante || "CONTRATANTE";
  const contratanteRep = dados.representante_nome || dados.responsavel_nome || dados.representante || "";

  const sigY = doc.y + 8;

  // Assinatura Contratada
  doc.moveTo(col1X + 10, sigY).lineTo(col1X + colW - 10, sigY)
    .strokeColor(GD_COLORS.lightLilac).lineWidth(0.75).stroke();
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(GD_COLORS.deepPurple) // #4A1370
    .text(contratadaNome, col1X, sigY + 6, { width: colW, align: "center" });
  doc.font("Helvetica").fontSize(8.5).fillColor(GD_COLORS.textDark)
    .text(contratadaRep, col1X, sigY + 18, { width: colW, align: "center" });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(GD_COLORS.magenta) // #C2208E
    .text("CONTRATADA", col1X, sigY + 29, { width: colW, align: "center" });

  // Assinatura Contratante
  doc.moveTo(col2X + 10, sigY).lineTo(col2X + colW - 10, sigY)
    .strokeColor(GD_COLORS.lightLilac).lineWidth(0.75).stroke();
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(GD_COLORS.deepPurple) // #4A1370
    .text(contratanteNome, col2X, sigY + 6, { width: colW, align: "center" });
  doc.font("Helvetica").fontSize(8.5).fillColor(GD_COLORS.textDark)
    .text(contratanteRep, col2X, sigY + 18, { width: colW, align: "center" });
  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(GD_COLORS.magenta) // #C2208E
    .text("CONTRATANTE", col2X, sigY + 29, { width: colW, align: "center" });

  // Testemunhas
  const witY = sigY + 46;

  // Testemunha 1
  doc.font("Helvetica-Bold").fontSize(9.0).fillColor(GD_COLORS.deepPurple) // #4A1370
    .text("Testemunha 1", col1X, witY, { width: colW, align: "left" });
  doc.font("Helvetica").fontSize(8.5).fillColor(GD_COLORS.textMuted) // #6E6878
    .text("Nome: ____________________________________", col1X, witY + 12, { width: colW, align: "left" });
  doc.text("CPF:     ____________________________________", col1X, witY + 24, { width: colW, align: "left" });

  // Testemunha 2
  doc.font("Helvetica-Bold").fontSize(9.0).fillColor(GD_COLORS.deepPurple) // #4A1370
    .text("Testemunha 2", col2X, witY, { width: colW, align: "left" });
  doc.font("Helvetica").fontSize(8.5).fillColor(GD_COLORS.textMuted) // #6E6878
    .text("Nome: ____________________________________", col2X, witY + 12, { width: colW, align: "left" });
  doc.text("CPF:     ____________________________________", col2X, witY + 24, { width: colW, align: "left" });

  doc.y = witY + 38;
  doc.x = startX;
}

/**
 * 2. Eliminação Total do Loop de Paginação (Garantia de 2 Páginas)
 * f) drawFooter(doc, pageNumber, totalPages, isFirstPage)
 * - Define doc.page.margins.bottom = 0 para desativar auto-pagebreak do PDFKit.
 * - Linha divisória em y = 746.
 * - Texto de contato em y = 750.
 * - Inserção na base em todas as páginas:
 *   - image3.png em x = 24, y = 766, w = 320, h = 66
 *   - image4.png em x = 420, y = 774, w = 120, h = 50
 * - Restaura doc.page.margins.bottom = savedBottomMargin ao concluir.
 */
export function drawFooter(doc, pageNumber = 1, totalPages = 2, isFirstPage = false) {
  const savedBottomMargin = doc.page.margins.bottom;
  doc.page.margins.bottom = 0; // Previne qualquer auto-pagebreak espúrio do PDFKit

  const startX = 42;
  const contentW = 511.28;

  // 1. Linha divisória do rodapé em y = 746
  const footerLineY = 746;
  doc.moveTo(startX, footerLineY)
    .lineTo(startX + contentW, footerLineY)
    .strokeColor(GD_COLORS.lightLilac)
    .lineWidth(0.5)
    .stroke();

  // 2. Linha de contato oficial e paginação em y = 750
  const textY = 750;
  doc.font("Helvetica-Bold").fontSize(7.5).fillColor(GD_COLORS.primary)
    .text("www.mktgeracaodigital.com.br", startX, textY, { continued: true });
  doc.font("Helvetica").fontSize(7.5).fillColor(GD_COLORS.textMuted)
    .text("   •   comercial@mktgeracaodigital.com.br   •   (34) 99771-9779", { continued: false });

  doc.font("Helvetica").fontSize(7.5).fillColor(GD_COLORS.textMuted)
    .text(`Página ${pageNumber} de ${totalPages}`, startX, textY, {
      width: contentW,
      align: "right",
    });

  // 3. Imagens na base em todas as páginas:
  // image3.png (constelação de ícones) em x = 24, y = 766, largura: 320, altura: 66
  const image3Path = getImageAssetPath("image3.png");
  if (fs.existsSync(image3Path)) {
    try {
      doc.image(image3Path, 24, 766, { width: 320, height: 66 });
    } catch (err) {
      console.warn("[drawFooter] Aviso ao renderizar image3.png:", err.message);
    }
  }

  // image4.png (logo com foguete GERAÇÃO DIGITAL) em x = 420, y = 774, largura: 120, altura: 50
  const image4Path = getImageAssetPath("image4.png");
  if (fs.existsSync(image4Path)) {
    try {
      doc.image(image4Path, 420, 774, { width: 120, height: 50 });
    } catch (err) {
      console.warn("[drawFooter] Aviso ao renderizar image4.png:", err.message);
    }
  }

  // Restaura margem inferior original
  doc.page.margins.bottom = savedBottomMargin;
}

/**
 * 5. Distribuição Rigorosa das Cláusulas por Página & Renderização Executiva
 * Rigorosamente 2 páginas com margens ajustadas (topo/base: 36pt, laterais: 42pt).
 */
export async function renderContractPdf(templateConteudo, dados = {}) {
  const preparedDados = prepareContractDados(dados);

  // Aplicação da mesclagem (mail merge)
  let mergedContent = templateConteudo || "";
  for (const [key, value] of Object.entries(preparedDados || {})) {
    const regex = new RegExp(`{{${key}}}`, "g");
    const val = value != null ? String(value).trim() : "";
    mergedContent = mergedContent.replace(regex, val || "______________________________");
  }
  mergedContent = mergedContent.replace(/\{\{[^}]+\}\}/g, "______________________________");

  // Auto-máscara preventiva em CNPJ e Telefone no corpo do texto
  mergedContent = mergedContent.replace(/(CNPJ:\s*)(\d{14})/gi, (_, p1, p2) => p1 + formatCnpj(p2));
  mergedContent = mergedContent.replace(/(Telefone:\s*)(\d{10,13})/gi, (_, p1, p2) => p1 + formatTelefone(p2));

  // Inicializa o PDF com as margens oficiais (topo 36, base 36, laterais 42)
  const doc = new PDFDocument({
    size: "A4",
    margins: PAGE_METRICS.margins,
    bufferPages: true,
  });

  const buffers = [];
  doc.on("data", buffers.push.bind(buffers));

  let finalPageCount = 1;
  const pdfBufferPromise = new Promise((resolve) => {
    doc.on("end", () => {
      const pdfData = Buffer.concat(buffers);
      pdfData.pageCount = finalPageCount;
      resolve(pdfData);
    });
  });

  // Topo Gradiente na Página 1
  drawTopGradient(doc);
  doc.y = PAGE_METRICS.margins.top;
  doc.x = PAGE_METRICS.margins.left;

  const lines = mergedContent.split("\n");
  const totalLines = lines.length;
  let i = 0;
  let tituloRenderizado = false;
  let inClausulaPrimeira = false;
  let inClausulaTerceira = false;
  let inClausulaQuarta = false;
  let pastClausulaSexta = false;
  let signaturesRendered = false;
  let alineaLetterIdx = 0;

  while (i < totalLines) {
    const rawLine = lines[i];
    const p = rawLine.trim();

    if (p === "") {
      i++;
      continue;
    }

    // 1. Título principal e subtítulo (apenas no início do documento)
    if (!tituloRenderizado && p === p.toUpperCase() && p.length > 8 && !p.startsWith("CLÁUSULA") && !p.startsWith("Cláusula")) {
      drawHeader(doc);
      tituloRenderizado = true;

      // Pula subtítulo se já tiver sido desenhado no drawHeader
      let nextIdx = i + 1;
      while (nextIdx < totalLines && lines[nextIdx].trim() === "") nextIdx++;
      if (nextIdx < totalLines) {
        const nextP = lines[nextIdx].trim();
        if (nextP.includes("&") || (nextP === nextP.toUpperCase() && !nextP.startsWith("CLÁUSULA") && !nextP.startsWith("Cláusula"))) {
          i = nextIdx + 1;
          continue;
        }
      }
      i++;
      continue;
    }

    // 2. Cabeçalho de cláusula padronizado: CLÁUSULA [NÚMERO]   |   [TÍTULO]
    const clauseInfo = normalizeClauseHeader(p);
    if (clauseInfo) {
      const isQuartaOrHigher = [
        "QUARTA", "QUINTA", "SEXTA", "SÉTIMA", "OITAVA", "NONA", "DÉCIMA"
      ].includes(clauseInfo.ordinal) || ["4", "5", "6", "7"].some(n => clauseInfo.ordinal.includes(n));

      // Quebra forçada controlada doc.addPage() imediatamente antes da Cláusula 4
      if (isQuartaOrHigher && doc.bufferedPageRange().count === 1) {
        doc.addPage();
        drawTopGradient(doc);
        doc.y = PAGE_METRICS.margins.top;
        doc.x = PAGE_METRICS.margins.left;
      }

      inClausulaPrimeira = clauseInfo.ordinal === "PRIMEIRA" || clauseInfo.title.includes("PARTES");
      inClausulaTerceira = clauseInfo.ordinal === "TERCEIRA" || clauseInfo.title.includes("OBRIGAÇÕES");
      inClausulaQuarta = clauseInfo.ordinal === "QUARTA" || clauseInfo.title.includes("PREÇO");
      if (clauseInfo.ordinal === "SEXTA" || clauseInfo.title.includes("FORO")) {
        pastClausulaSexta = true;
      }
      alineaLetterIdx = 0;

      doc.moveDown(0.2);
      drawClauseHeader(doc, clauseInfo.ordinal, clauseInfo.title);
      i++;
      continue;
    }

    // 3. Cláusula Primeira: caixas das partes em 2 colunas paralelas
    if (inClausulaPrimeira && (p === "CONTRATADA" || p === "**CONTRATADA**")) {
      const contratadaLines = [];
      i++;
      while (i < totalLines && lines[i].trim() !== "CONTRATANTE" && lines[i].trim() !== "**CONTRATANTE**" && !normalizeClauseHeader(lines[i].trim())) {
        if (lines[i].trim()) contratadaLines.push(lines[i].trim());
        i++;
      }

      const contratanteLines = [];
      if (i < totalLines && (lines[i].trim() === "CONTRATANTE" || lines[i].trim() === "**CONTRATANTE**")) {
        i++;
        while (i < totalLines && !lines[i].trim().startsWith("Por este instrumento") && !normalizeClauseHeader(lines[i].trim())) {
          if (lines[i].trim()) contratanteLines.push(lines[i].trim());
          i++;
        }
      }

      const contratadaParam = contratadaLines.length > 0 ? contratadaLines : {
        razao_social: preparedDados.contratada_razao_social,
        cnpj: preparedDados.contratada_cnpj,
        representante: preparedDados.contratada_representante,
        endereco: preparedDados.contratada_endereco,
        telefone: preparedDados.contratada_telefone,
        email: preparedDados.contratada_email,
      };

      const contratanteParam = contratanteLines.length > 0 ? contratanteLines : {
        razao_social: preparedDados.razao_social,
        cnpj: preparedDados.cnpj,
        representante_nome: preparedDados.representante_nome,
        endereco: preparedDados.endereco,
        telefone: preparedDados.telefone,
        email: preparedDados.email,
      };

      drawPartesBoxes(doc, contratadaParam, contratanteParam);
      inClausulaPrimeira = false;
      continue;
    }

    // 4. Cláusula Terceira: Subtítulos e alíneas estilizadas em magenta/roxo a), b), c)...
    if (inClausulaTerceira && /^Compete\s+à\s+/i.test(p)) {
      doc.moveDown(0.15);
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(GD_COLORS.deepPurple)
        .text(p, 42, doc.y, { width: 511.28 });
      doc.moveDown(0.15);
      alineaLetterIdx = 0;
      i++;
      continue;
    }

    if (inClausulaTerceira && !normalizeClauseHeader(p)) {
      const letter = String.fromCharCode(97 + alineaLetterIdx) + ")";
      alineaLetterIdx++;

      const cleanItemText = p.replace(/^([a-z]\)|\d+[.)]|\-|\•)\s*/i, "").trim();
      const itemY = doc.y;
      const itemX = 42 + 4;
      const textX = itemX + 16;
      const textW = 511.28 - 20;

      doc.font("Helvetica-Bold").fontSize(9.0).fillColor(GD_COLORS.magenta)
        .text(letter, itemX, itemY, { width: 16 });

      doc.font("Helvetica").fontSize(9.0).fillColor(GD_COLORS.textDark);
      renderFormattedParagraph(doc, cleanItemText, {
        x: textX,
        y: itemY,
        width: textW,
        lineGap: 1.2,
        paragraphGap: 2.2,
      });

      doc.x = 42;
      i++;
      continue;
    }

    // 5. Cláusula Quarta: Tabela de Preço e Condições
    if (inClausulaQuarta && (p.startsWith("Compromisso do Período") || p === "COMPOSIÇÃO DO PERÍODO")) {
      let valorTotalStr = preparedDados.valor_total || "";
      let composicaoLabel = "Em reais (conforme condições de pagamento)";
      let composicaoVal = "";
      let permutaLabel = "Em permuta";
      let permutaVal = preparedDados.condicao_permuta || "Não aplicável";

      while (i < totalLines && !normalizeClauseHeader(lines[i].trim()) && !lines[i].trim().startsWith("CLÁUSULA QUINTA") && !lines[i].trim().startsWith("Cláusula Quinta")) {
        const lp = lines[i].trim();
        if (lp.startsWith("Compromisso do Período")) {
          const parts = lp.split(/:(.*)/s);
          if (parts[1] && parts[1].trim()) valorTotalStr = parts[1].trim();
          else if (i + 1 < totalLines && lines[i + 1].trim() && !lines[i + 1].trim().startsWith("COMPOSIÇÃO")) {
            valorTotalStr = lines[i + 1].trim();
            i++;
          }
        } else if (lp.startsWith("Em reais")) {
          const parts = lp.split(/:(.*)/s);
          composicaoLabel = parts[0].trim();
          if (parts[1] && parts[1].trim()) composicaoVal = parts[1].trim();
          else if (i + 1 < totalLines && lines[i + 1].trim() && !lines[i + 1].trim().startsWith("Em permuta")) {
            composicaoVal = lines[i + 1].trim();
            i++;
          }
        } else if (lp.startsWith("Em permuta")) {
          const parts = lp.split(/:(.*)/s);
          permutaLabel = parts[0].trim();
          if (parts[1] && parts[1].trim()) permutaVal = parts[1].trim();
          else if (i + 1 < totalLines && lines[i + 1].trim()) {
            permutaVal = lines[i + 1].trim();
            i++;
          }
        }
        i++;
      }

      drawPricingTable(doc, preparedDados, {
        valorTotal: valorTotalStr,
        composicaoLabel,
        emReaisVal: composicaoVal,
        permutaVal,
      });

      inClausulaQuarta = false;
      continue;
    }

    // 6. Bloco de Assinaturas e Testemunhas
    const isUnderline = /^[_\s]{10,}$/.test(p);
    const isSigSectionStart = pastClausulaSexta && (isUnderline || p === "CONTRATADA" || p === "CONTRATANTE" || p.startsWith("Testemunha"));
    if (isSigSectionStart && !signaturesRendered) {
      drawSignaturesAndWitnesses(doc, preparedDados);
      signaturesRendered = true;
      while (i < totalLines) i++;
      break;
    }

    // 7. Linha de Data/Local centralizada ("Uberlândia – MG, 16 de outubro de 2026.")
    if (pastClausulaSexta && /\b\d{1,2}\s+de\s+[a-zçã]+\s+de\s+\d{4}\b/i.test(p)) {
      doc.moveDown(0.4);
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(GD_COLORS.deepPurple)
        .text(p, 42, doc.y, { align: "center", width: 511.28 });
      doc.moveDown(0.4);
      i++;
      continue;
    }

    // 8. Linhas de assinatura legadas
    const isLegacySigLabel = /^(Contratada|Contratante):/i.test(p);
    if (isUnderline || isLegacySigLabel) {
      doc.font("Helvetica").fontSize(8.5).fillColor(GD_COLORS.textDark);
      doc.text(p, { align: "center", lineGap: 1.5, width: 511.28 });
      if (isLegacySigLabel) doc.moveDown(1.5);
      i++;
      continue;
    }

    // 9. Parágrafos comuns
    const isItem = /^([A-Z]\.|[-•]|\d+[ºª.]?)\s/.test(p);
    doc.fontSize(isItem ? 9.0 : 9.5).fillColor(GD_COLORS.textDark);
    renderFormattedParagraph(doc, p, {
      align: "left",
      lineGap: isItem ? 1.2 : 1.6,
      paragraphGap: isItem ? 2.0 : 3.5,
      width: 511.28,
    });

    i++;
  }

  // Se o documento não teve assinaturas pelo bloco estruturado, renderiza fallback se houver dados
  const jaTemAssinaturas = lines.some((l) => /^(Contratada|Contratante):/i.test(l.trim()));
  if (!signaturesRendered && !jaTemAssinaturas && (preparedDados.assinatura_contratada || preparedDados.assinatura_contratante)) {
    doc.moveDown(1.2);
    doc.font("Helvetica").fontSize(8.5);
    doc.text("____________________________________________________", { align: "center" });
    doc.text(`Contratada: ${preparedDados.assinatura_contratada || ""}`.trimEnd(), { align: "center" });
    doc.moveDown(1.8);
    doc.text("____________________________________________________", { align: "center" });
    doc.text(`Contratante: ${preparedDados.assinatura_contratante || preparedDados.razao_social || ""}`.trimEnd(), { align: "center" });
  }

  // Aplicação do Rodapé Oficial e Topo Gradiente em todas as páginas
  const range = doc.bufferedPageRange();
  finalPageCount = range.count;

  for (let pIdx = range.start; pIdx < range.start + range.count; pIdx++) {
    doc.switchToPage(pIdx);
    drawTopGradient(doc);
    const pageNum = pIdx - range.start + 1;
    drawFooter(doc, pageNum, finalPageCount, pageNum === 1);
  }

  doc.end();
  return await pdfBufferPromise;
}
