import PDFDocument from "pdfkit";
import { pgDatabasePool as db } from "../../services/database.js";
import { resolveTenantUuid, GD_TENANT_UUID } from "./tenantResolver.js";
import { sendError } from "../../services/httpInfra.js";
import { saveContractBuffer, getContractBuffer, CONTRACT_MAX_BYTES } from "../../services/storage.js";
// ATENÇÃO (import circular): funciona porque getTenantContratadaConfig é function declaration (tem hoisting).
import { getTenantContratadaConfig } from "./juridicoHandlers.js";
import {
  assembleContractFromBlocks,
  buildCronograma,
  parseTemplateContentToClauses,
  prepareContractDados,
  formatCnpj,
  formatTelefone,
  formatBrl,
  toExtenseOrdinal,
} from "./contractMerge.js";

export { prepareContractDados, formatCnpj, formatTelefone, formatBrl };

// Helper for formatting date
function formatExtenseDate() {
  const months = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const date = new Date();
  return `${date.getDate()} de ${months[date.getMonth()]} de ${date.getFullYear()}`;
}

export const CONTRACT_FILL_LINE = "______________________________";

// Mail merge function
export function applyMerge(template, data = {}) {
  if (!template) return "";
  let result = template;
  for (const [key, value] of Object.entries(data || {})) {
    const regex = new RegExp(`{{${key}}}`, "g");
    const val = value != null ? String(value).trim() : "";
    result = result.replace(regex, val || CONTRACT_FILL_LINE);
  }
  // Varre qualquer {{marcador}} restante que não foi preenchido e troca por linha de preenchimento
  result = result.replace(/\{\{[^}]+\}\}/g, CONTRACT_FILL_LINE);
  return result;
}

export async function listContractTemplates(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;

    const { rows } = await db.query(
      "SELECT id, tenant_id, nome, conteudo, COALESCE(clausulas, '[]'::jsonb) as clausulas, ativo, created_at, updated_at FROM gd_contract_templates WHERE tenant_id = $1 AND ativo = true ORDER BY created_at DESC",
      [tenantId]
    );

    res.json(rows);
  } catch (error) {
    console.error("[listContractTemplates] Error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Erro ao listar templates de contrato");
  }
}

export async function getContractTemplate(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;
    const { id } = req.params;

    const { rows } = await db.query(
      "SELECT id, tenant_id, nome, conteudo, COALESCE(clausulas, '[]'::jsonb) as clausulas, ativo, created_at, updated_at FROM gd_contract_templates WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Template não encontrado");
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("[getContractTemplate] Error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Erro ao buscar template de contrato");
  }
}

export async function createContractTemplate(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;

    const { nome, conteudo, clausulas, ativo } = req.body;
    if (!nome || !String(nome).trim()) {
      return sendError(res, 400, "BAD_REQUEST", "nome é obrigatório");
    }

    const finalConteudo = conteudo || (Array.isArray(clausulas) ? assembleContractFromBlocks({ clausulas }) : "");
    const finalClausulas = Array.isArray(clausulas) ? JSON.stringify(clausulas) : "[]";
    const finalAtivo = typeof ativo === "boolean" ? ativo : true;

    const { rows } = await db.query(
      `INSERT INTO gd_contract_templates (tenant_id, nome, conteudo, clausulas, ativo)
       VALUES ($1, $2, $3, $4::jsonb, $5)
       RETURNING id, tenant_id, nome, conteudo, clausulas, ativo, created_at, updated_at`,
      [tenantId, String(nome).trim(), finalConteudo, finalClausulas, finalAtivo]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    console.error("[createContractTemplate] Error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Erro ao criar template de contrato");
  }
}

export async function updateContractTemplate(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;
    const { id } = req.params;
    const { nome, conteudo, clausulas, ativo } = req.body;

    const finalClausulas = clausulas !== undefined
      ? (Array.isArray(clausulas) ? JSON.stringify(clausulas) : "[]")
      : null;

    const { rows } = await db.query(
      `UPDATE gd_contract_templates
       SET nome = COALESCE($1, nome),
           conteudo = COALESCE($2, conteudo),
           clausulas = CASE WHEN $3::text IS NOT NULL THEN $3::jsonb ELSE clausulas END,
           ativo = COALESCE($4, ativo),
           updated_at = NOW()
       WHERE id = $5 AND tenant_id = $6
       RETURNING id, tenant_id, nome, conteudo, clausulas, ativo, created_at, updated_at`,
      [
        nome !== undefined ? String(nome).trim() : null,
        conteudo !== undefined ? conteudo : null,
        finalClausulas,
        typeof ativo === "boolean" ? ativo : null,
        id,
        tenantId
      ]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Template não encontrado");
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("[updateContractTemplate] Error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Erro ao atualizar template de contrato");
  }
}

export async function deleteContractTemplate(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;
    const { id } = req.params;

    const { rows } = await db.query(
      `UPDATE gd_contract_templates
       SET ativo = false, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2
       RETURNING id`,
      [id, tenantId]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Template não encontrado");
    }

    res.json({ success: true, id: rows[0].id });
  } catch (error) {
    console.error("[deleteContractTemplate] Error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Erro ao excluir template de contrato");
  }
}

export async function createContract(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;

    const { proposal_id, template_id, dados } = req.body;

    if (!dados) {
      return sendError(res, 400, "BAD_REQUEST", "dados é obrigatório");
    }

    let resolvedTemplateId = template_id;

    if (!resolvedTemplateId) {
      const { rows: templates } = await db.query(
        "SELECT id FROM gd_contract_templates WHERE tenant_id = $1 AND ativo = true ORDER BY created_at DESC LIMIT 1",
        [tenantId]
      );
      if (templates.length > 0) {
        resolvedTemplateId = templates[0].id;
      }
    }

    const ownerCompany = req.body.owner_company || req.body.ownerCompany || (req.body.isVexo ? "vexo" : null);
    let finalOwnerCompany = ownerCompany;
    if (!finalOwnerCompany && proposal_id) {
      const propRes = await db.query("SELECT owner_company FROM gd_proposals WHERE id = $1", [proposal_id]);
      if (propRes.rows.length > 0 && propRes.rows[0].owner_company) {
        finalOwnerCompany = propRes.rows[0].owner_company;
      }
    }
    if (!finalOwnerCompany) {
      finalOwnerCompany = "geracao-digital";
    }

    const { rows: contractRows } = await db.query(
      `INSERT INTO gd_contracts (tenant_id, proposal_id, dados, status, owner_company, template_id)
       VALUES ($1, $2, $3, 'rascunho', $4, $5)
       RETURNING *`,
      [tenantId, proposal_id || null, dados, finalOwnerCompany, resolvedTemplateId || null]
    );

    res.status(201).json(contractRows[0]);
  } catch (error) {
    console.error("[createContract] Error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Erro ao criar contrato");
  }
}

export async function listContracts(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;

    const { proposal_id, arquivado } = req.query;
    const ownerCompany = req.query.owner_company || req.query.ownerCompany || (req.query.isVexo === "1" || req.query.isVexo === "true" ? "vexo" : null);

    // Por padrão lista só os ativos; ?arquivado=true traz os arquivados.
    const querArquivados = String(arquivado) === "true";

    let query = "SELECT * FROM gd_contracts WHERE tenant_id = $1 AND COALESCE(arquivado, false) = $2";
    const params = [tenantId, querArquivados];

    if (ownerCompany) {
      params.push(ownerCompany);
      query += ` AND owner_company = $${params.length}`;
    } else {
      query += ` AND (owner_company = 'geracao-digital' OR owner_company IS NULL)`;
    }

    if (proposal_id) {
      params.push(proposal_id);
      query += ` AND proposal_id = $${params.length}`;
    }

    query += " ORDER BY created_at DESC";

    const { rows } = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error("[listContracts] Error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Erro ao listar contratos");
  }
}

export async function getContract(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;
    const { id } = req.params;

    const { rows } = await db.query(
      "SELECT * FROM gd_contracts WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Contrato não encontrado");
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("[getContract] Error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Erro ao buscar contrato");
  }
}

export async function updateContract(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;
    const { id } = req.params;
    const { dados, status, arquivado, template_id } = req.body;

    const { rows } = await db.query(
      `UPDATE gd_contracts
       SET dados = COALESCE($1, dados),
           status = COALESCE($2, status),
           arquivado = COALESCE($3, arquivado),
           template_id = COALESCE($4, template_id),
           updated_at = NOW()
       WHERE id = $5 AND tenant_id = $6
       RETURNING *`,
      [
        dados,
        status,
        typeof arquivado === "boolean" ? arquivado : null,
        template_id !== undefined ? template_id : null,
        id,
        tenantId
      ]
    );

    if (rows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Contrato não encontrado");
    }

    res.json(rows[0]);
  } catch (error) {
    console.error("[updateContract] Error:", error);
    sendError(res, 500, "INTERNAL_ERROR", "Erro ao atualizar contrato");
  }
}

// Monta o PDF do contrato (template ativo + dados salvos) e devolve o Buffer.
// Usado pelo download e pelo envio ao jurídico — uma única fonte de verdade
// para o documento. Lança Error com code para o chamador traduzir em HTTP.
export async function buildContractPdfBuffer(tenantId, id) {
  const { rows: contractRows } = await db.query(
    "SELECT * FROM gd_contracts WHERE id = $1 AND (tenant_id = $2 OR tenant_id = '00000000-0000-0000-0000-000000000000') ORDER BY (CASE WHEN tenant_id = $2 THEN 0 ELSE 1 END) LIMIT 1",
    [id, tenantId]
  );
  if (contractRows.length === 0) {
    const e = new Error("Contrato não encontrado");
    e.code = "CONTRACT_NOT_FOUND";
    throw e;
  }

  const contract = contractRows[0];
  const dados = contract.dados || {};
  dados.data_extenso = formatExtenseDate();

  // Injeta configuração da Contratada do tenant ANTES de qualquer atalho de texto_final
  const contratadaConfig = await getTenantContratadaConfig(tenantId);
  dados.contratada_razao_social = dados.contratada_razao_social || contratadaConfig.razao_social || "";
  dados.contratada_cnpj = dados.contratada_cnpj || contratadaConfig.cnpj || "";
  dados.contratada_representante = dados.contratada_representante || contratadaConfig.representante || "";
  dados.contratada_endereco = dados.contratada_endereco || contratadaConfig.endereco || "";
  dados.contratada_telefone = dados.contratada_telefone || contratadaConfig.telefone || "";
  dados.contratada_email = dados.contratada_email || contratadaConfig.email || "";
  dados.contratada_comarca = dados.contratada_comarca || contratadaConfig.comarca || "";
  dados.assinatura_contratada = dados.assinatura_contratada || contratadaConfig.assinatura || "";
  if (!dados.foro_cidade && dados.contratada_comarca) {
    dados.foro_cidade = dados.contratada_comarca;
  }
  dados.representante_nome = dados.representante_nome || dados.responsavel_nome || dados.representante || dados.assinatura_contratante || dados.razao_social || "";
  dados.prazo_meses = dados.prazo_meses || "12";
  dados.condicao_permuta = dados.condicao_permuta || "Não aplicável";

  // Se o contrato tem parcelas estruturadas salvas, garante a formatação atualizada do cronograma
  if (Array.isArray(dados?.parcelas) && dados.parcelas.length > 0) {
    dados.cronograma_pagamento = buildCronograma(dados.parcelas);
  }

  // Aplica máscaras e formatação padrão BRL em dados
  const formattedDados = prepareContractDados(dados);
  Object.assign(dados, formattedDados);

  // Se o usuário editou o texto final na tela, renderiza diretamente ignorando o template
  if (dados?.texto_final && typeof dados.texto_final === "string" && dados.texto_final.trim()) {
    const pdfData = await renderContractPdf(dados.texto_final, dados);
    return { contract, dados, pdfData };
  }

  let templateQuery;
  let templateParams;
  if (contract.template_id) {
    templateQuery =
      "SELECT * FROM gd_contract_templates WHERE id = $1 AND (tenant_id = $2 OR tenant_id = '00000000-0000-0000-0000-000000000000') ORDER BY (CASE WHEN tenant_id = $2 THEN 0 ELSE 1 END) LIMIT 1";
    templateParams = [contract.template_id, tenantId];
  } else {
    templateQuery =
      "SELECT * FROM gd_contract_templates WHERE (tenant_id = $1 OR tenant_id = '00000000-0000-0000-0000-000000000000') AND ativo = true ORDER BY (CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END), created_at DESC LIMIT 1";
    templateParams = [tenantId];
  }

  let { rows: templateRows } = await db.query(templateQuery, templateParams);
  if (templateRows.length === 0 && contract.template_id) {
    const fallbackRes = await db.query(
      "SELECT * FROM gd_contract_templates WHERE (tenant_id = $1 OR tenant_id = '00000000-0000-0000-0000-000000000000') AND ativo = true ORDER BY (CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END), created_at DESC LIMIT 1",
      [tenantId]
    );
    templateRows = fallbackRes.rows;
  }
  if (templateRows.length === 0) {
    const e = new Error("Template de contrato não encontrado");
    e.code = "TEMPLATE_NOT_FOUND";
    throw e;
  }

  const template = templateRows[0];
  let templateConteudo = template.conteudo;
  if (Array.isArray(template.clausulas) && template.clausulas.length > 0) {
    templateConteudo = assembleContractFromBlocks({
      tituloPrincipal: template.conteudo ? parseTemplateContentToClauses(template.conteudo).tituloPrincipal : "",
      clausulas: template.clausulas,
      fechamento: template.conteudo ? parseTemplateContentToClauses(template.conteudo).fechamento : "",
    });
  }

  const pdfData = await renderContractPdf(templateConteudo, dados);
  return { contract, dados, pdfData };
}

export async function generateContractPdf(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;
    const { id } = req.params;

    let built;
    try {
      built = await buildContractPdfBuffer(tenantId, id);
    } catch (e) {
      if (e.code === "CONTRACT_NOT_FOUND" || e.code === "TEMPLATE_NOT_FOUND") {
        return sendError(res, 404, "NOT_FOUND", e.message);
      }
      throw e;
    }
    const { dados, pdfData } = built;
    return await finalizeContractPdfResponse(res, tenantId, id, dados, pdfData);
  } catch (error) {
    console.error("[generateContractPdf] Error:", error);
    if (!res.headersSent) {
      sendError(res, 500, "INTERNAL_ERROR", "Erro ao gerar PDF do contrato");
    }
  }
}

async function finalizeContractPdfResponse(res, tenantId, id, dados, pdfData) {
  // Marca o contrato como "gerado" (não sobrescreve um já "assinado") e
  // devolve o PDF direto para download/visualização no navegador.
  await db.query(
    `UPDATE gd_contracts
     SET status = CASE WHEN status = 'assinado' THEN status ELSE 'gerado' END,
         updated_at = NOW()
     WHERE id = $1 AND (tenant_id = $2 OR tenant_id = '00000000-0000-0000-0000-000000000000')`,
    [id, tenantId]
  );
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="contrato-${id}.pdf"`);
  return res.send(pdfData);
}

// Renderiza parágrafo com suporte a marcação de negrito (**texto** ou <b>texto</b>)
function renderFormattedParagraph(doc, text, options = {}) {
  const regex = /(\*\*.*?\*\*|<b>.*?<\/b>)/g;
  const parts = text.split(regex);
  const tokens = parts.filter(Boolean).map((part) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length >= 4) {
      return { text: part.slice(2, -2), bold: true };
    }
    if (/^<b>(.*?)<\/b>$/i.test(part)) {
      return { text: part.replace(/^<b>|<\/b>$/gi, ""), bold: true };
    }
    return { text: part, bold: false };
  });

  if (tokens.length === 0) {
    return;
  }

  tokens.forEach((token, idx) => {
    const isLast = idx === tokens.length - 1;
    doc.font(token.bold ? "Helvetica-Bold" : "Helvetica");
    doc.text(token.text, {
      ...options,
      continued: !isLast,
    });
  });
}

export const CONTRACT_PDF_COLORS = {
  primaryDark: "#4A1370",
  primary: "#7B1FB0",
  secondary: "#C2208E",
  accentLight: "#DCC7EC",
  boxBg: "#F6EEFB",
  tableSubBg: "#EEDFF7",
  tableAltBg: "#FBF8FD",
  textDark: "#222222",
  textMuted: "#555555",
  white: "#FFFFFF",
};

export function normalizeClauseHeader(line) {
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

// Renderização do documento diagramada rigorosamente em 2 páginas conforme modelo oficial Word.
export async function renderContractPdf(templateConteudo, dados = {}) {
  const preparedDados = prepareContractDados(dados);
  let mergedContent = applyMerge(templateConteudo, preparedDados);

  // Auto-máscara preventiva em CNPJ e Telefone no corpo do texto
  mergedContent = mergedContent.replace(/(CNPJ:\s*)(\d{14})/gi, (_, p1, p2) => p1 + formatCnpj(p2));
  mergedContent = mergedContent.replace(/(Telefone:\s*)(\d{10,13})/gi, (_, p1, p2) => p1 + formatTelefone(p2));

  // Gera o PDF com margens exatas de 42pt
  const doc = new PDFDocument({ margin: 42, size: "A4", bufferPages: true });
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

  const lines = mergedContent.split("\n");
  const totalLines = lines.length;
  let i = 0;
  let tituloRenderizado = false;
  let inClausulaPrimeira = false;
  let inClausulaQuarta = false;
  let pastClausulaSexta = false;
  let signaturesRendered = false;

  while (i < totalLines) {
    const rawLine = lines[i];
    const p = rawLine.trim();

    if (p === "") {
      i++;
      continue;
    }

    // 1. Título principal e subtítulo (apenas no início do documento)
    if (!tituloRenderizado && p === p.toUpperCase() && p.length > 8 && !p.startsWith("CLÁUSULA") && !p.startsWith("Cláusula")) {
      doc.font("Helvetica-Bold").fontSize(13.5).fillColor(CONTRACT_PDF_COLORS.primaryDark)
         .text(p, 42, doc.y, { align: "center", width: 511 });
      doc.moveDown(0.2);
      tituloRenderizado = true;

      // Verifica se a próxima linha não vazia é subtítulo
      let nextIdx = i + 1;
      while (nextIdx < totalLines && lines[nextIdx].trim() === "") nextIdx++;
      if (nextIdx < totalLines) {
        const nextP = lines[nextIdx].trim();
        if (nextP.includes("&") || (nextP === nextP.toUpperCase() && !nextP.startsWith("CLÁUSULA") && !nextP.startsWith("Cláusula"))) {
          doc.font("Helvetica-Bold").fontSize(8.5).fillColor(CONTRACT_PDF_COLORS.secondary)
             .text(nextP, 42, doc.y, { align: "center", width: 511 });
          doc.moveDown(0.5);
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

      // Garante que a Cláusula 4 (e subsequentes) fiquem confortavelmente no topo da Página 2
      if (isQuartaOrHigher && doc.bufferedPageRange().count === 1) {
        doc.addPage();
      }

      inClausulaPrimeira = clauseInfo.ordinal === "PRIMEIRA" || clauseInfo.title.includes("PARTES");
      inClausulaQuarta = clauseInfo.ordinal === "QUARTA" || clauseInfo.title.includes("PREÇO");
      if (clauseInfo.ordinal === "SEXTA" || clauseInfo.title.includes("FORO")) {
        pastClausulaSexta = true;
      }

      doc.moveDown(0.35);
      const startY = doc.y;
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(CONTRACT_PDF_COLORS.primary)
         .text(`CLÁUSULA ${clauseInfo.ordinal}`, 42, startY, { continued: true });
      doc.font("Helvetica").fontSize(9.5).fillColor(CONTRACT_PDF_COLORS.accentLight)
         .text("   |   ", { continued: true });
      doc.font("Helvetica-Bold").fontSize(9.5).fillColor(CONTRACT_PDF_COLORS.primaryDark)
         .text(clauseInfo.title, { continued: false });
      doc.fillColor(CONTRACT_PDF_COLORS.textDark);
      doc.moveDown(0.25);
      i++;
      continue;
    }

    // 3. Cláusula Primeira: duas colunas paralelas (CONTRATADA à esquerda e CONTRATANTE à direita)
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

      const startX = 42;
      const colWidth = 248;
      const gap = 15;
      const col1X = startX;
      const col2X = startX + colWidth + gap;
      const headerH = 16;
      const padding = 6;

      const c1Title = contratadaLines[0] || (preparedDados.contratada_razao_social || "CONTRATADA");
      const c1Fields = contratadaLines.slice(1);
      const c2Title = contratanteLines[0] || (preparedDados.razao_social || "CONTRATANTE");
      const c2Fields = contratanteLines.slice(1);

      const c1H = padding * 2 + 12 + c1Fields.length * 10.5;
      const c2H = padding * 2 + 12 + c2Fields.length * 10.5;
      const contentH = Math.max(c1H, c2H, 72);

      const boxY = doc.y;

      // Coluna 1: CONTRATADA
      doc.rect(col1X, boxY, colWidth, headerH).fill(CONTRACT_PDF_COLORS.primary);
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(CONTRACT_PDF_COLORS.white)
         .text("CONTRATADA", col1X + padding, boxY + 4, { width: colWidth - padding * 2 });
      doc.rect(col1X, boxY + headerH, colWidth, contentH).fill(CONTRACT_PDF_COLORS.boxBg);
      doc.rect(col1X, boxY, colWidth, headerH + contentH).strokeColor(CONTRACT_PDF_COLORS.accentLight).lineWidth(0.5).stroke();

      let tY1 = boxY + headerH + padding;
      doc.font("Helvetica-Bold").fontSize(7.8).fillColor(CONTRACT_PDF_COLORS.primaryDark)
         .text(c1Title, col1X + padding, tY1, { width: colWidth - padding * 2 });
      tY1 += 12;
      doc.font("Helvetica").fontSize(7.5).fillColor(CONTRACT_PDF_COLORS.textDark);
      for (const field of c1Fields) {
        const parts = field.split(/:(.*)/s);
        if (parts.length > 1) {
          doc.font("Helvetica-Bold").text(parts[0] + ":", col1X + padding, tY1, { continued: true, lineGap: 1 });
          doc.font("Helvetica").text(parts[1], { lineGap: 1 });
        } else {
          doc.font("Helvetica").text(field, col1X + padding, tY1, { width: colWidth - padding * 2, lineGap: 1 });
        }
        tY1 += 10.5;
      }

      // Coluna 2: CONTRATANTE
      doc.rect(col2X, boxY, colWidth, headerH).fill(CONTRACT_PDF_COLORS.primary);
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(CONTRACT_PDF_COLORS.white)
         .text("CONTRATANTE", col2X + padding, boxY + 4, { width: colWidth - padding * 2 });
      doc.rect(col2X, boxY + headerH, colWidth, contentH).fill(CONTRACT_PDF_COLORS.boxBg);
      doc.rect(col2X, boxY, colWidth, headerH + contentH).strokeColor(CONTRACT_PDF_COLORS.accentLight).lineWidth(0.5).stroke();

      let tY2 = boxY + headerH + padding;
      doc.font("Helvetica-Bold").fontSize(7.8).fillColor(CONTRACT_PDF_COLORS.primaryDark)
         .text(c2Title, col2X + padding, tY2, { width: colWidth - padding * 2 });
      tY2 += 12;
      doc.font("Helvetica").fontSize(7.5).fillColor(CONTRACT_PDF_COLORS.textDark);
      for (const field of c2Fields) {
        const parts = field.split(/:(.*)/s);
        if (parts.length > 1) {
          doc.font("Helvetica-Bold").text(parts[0] + ":", col2X + padding, tY2, { continued: true, lineGap: 1 });
          doc.font("Helvetica").text(parts[1], { lineGap: 1 });
        } else {
          doc.font("Helvetica").text(field, col2X + padding, tY2, { width: colWidth - padding * 2, lineGap: 1 });
        }
        tY2 += 10.5;
      }

      doc.y = boxY + headerH + contentH + 6;
      doc.x = 42;
      inClausulaPrimeira = false;
      continue;
    }

    // 4. Cláusula Quarta: Tabela de Preço e Condições
    if (inClausulaQuarta && (p.startsWith("Compromisso do Período") || p === "COMPOSIÇÃO DO PERÍODO")) {
      let valorTotalStr = preparedDados.valor_total || "";
      let composicaoLabel = "Em reais (dividido em até 12x no cartão de crédito)";
      let composicaoVal = preparedDados.cronograma_pagamento || "";
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

      valorTotalStr = formatBrl(valorTotalStr) || valorTotalStr;
      if (composicaoVal && !composicaoVal.includes("R$") && !isNaN(Number(composicaoVal.replace(/[^\d.,-]/g, "").replace(",", ".")))) {
        composicaoVal = formatBrl(composicaoVal);
      }
      if (permutaVal && !permutaVal.includes("R$") && !isNaN(Number(permutaVal.replace(/[^\d.,-]/g, "").replace(",", ".")))) {
        permutaVal = formatBrl(permutaVal);
      }

      const tblY = doc.y;
      const tblW = 511;
      const c1W = 340;
      const c2W = 171;

      // Linha 1: Compromisso do Período
      doc.rect(42, tblY, tblW, 16).fill(CONTRACT_PDF_COLORS.primary);
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(CONTRACT_PDF_COLORS.white)
         .text("Compromisso do Período", 48, tblY + 4, { width: c1W - 12 });
      doc.text(valorTotalStr, 42 + c1W, tblY + 4, { width: c2W - 8, align: "right" });

      // Linha 2: COMPOSIÇÃO DO PERÍODO
      doc.rect(42, tblY + 16, tblW, 14).fill(CONTRACT_PDF_COLORS.tableSubBg);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(CONTRACT_PDF_COLORS.primaryDark)
         .text("COMPOSIÇÃO DO PERÍODO", 48, tblY + 19, { width: tblW - 12 });

      // Linha 3: Em reais
      doc.rect(42, tblY + 30, tblW, 14).fill(CONTRACT_PDF_COLORS.white);
      doc.font("Helvetica").fontSize(8).fillColor(CONTRACT_PDF_COLORS.textDark)
         .text(composicaoLabel, 48, tblY + 33, { width: c1W - 12 });
      doc.text(composicaoVal, 42 + c1W, tblY + 33, { width: c2W - 8, align: "right" });

      // Linha 4: Em permuta
      doc.rect(42, tblY + 44, tblW, 14).fill(CONTRACT_PDF_COLORS.tableAltBg);
      doc.font("Helvetica").fontSize(8).fillColor(CONTRACT_PDF_COLORS.textDark)
         .text(permutaLabel, 48, tblY + 47, { width: c1W - 12 });
      doc.text(permutaVal, 42 + c1W, tblY + 47, { width: c2W - 8, align: "right" });

      // Bordas
      doc.rect(42, tblY, tblW, 58).strokeColor(CONTRACT_PDF_COLORS.primary).lineWidth(0.5).stroke();
      doc.moveTo(42, tblY + 16).lineTo(42 + tblW, tblY + 16).stroke();
      doc.moveTo(42, tblY + 30).lineTo(42 + tblW, tblY + 30).stroke();
      doc.moveTo(42, tblY + 44).lineTo(42 + tblW, tblY + 44).stroke();

      doc.y = tblY + 58 + 8;
      doc.x = 42;
      inClausulaQuarta = false;
      continue;
    }

    // 5. Bloco de Assinaturas e Testemunhas (renderizado em 2 colunas paralelas)
    const isUnderline = /^[_\s]{10,}$/.test(p);
    const isSigSectionStart = pastClausulaSexta && (isUnderline || p === "CONTRATADA" || p === "CONTRATANTE" || p.startsWith("Testemunha"));
    if (isSigSectionStart && !signaturesRendered) {
      const sColW = 235;
      const sCol1X = 42;
      const sCol2X = 42 + sColW + 41;

      const contratadaNome = preparedDados.contratada_razao_social || "AGÊNCIA GERAÇÃO DIGITAL LTDA";
      const contratadaRep = preparedDados.contratada_representante || "Caio Vinícius Almeida de Oliveira";
      const contratanteNome = preparedDados.razao_social || preparedDados.assinatura_contratante || "CONTRATANTE";
      const contratanteRep = preparedDados.representante_nome || preparedDados.responsavel_nome || "";

      doc.moveDown(0.6);
      const sigY = doc.y;

      // Assinatura Contratada
      doc.font("Helvetica").fontSize(8).fillColor(CONTRACT_PDF_COLORS.textDark);
      doc.text("____________________________________________", sCol1X, sigY, { width: sColW, align: "center" });
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(CONTRACT_PDF_COLORS.primaryDark)
         .text(contratadaNome, sCol1X, sigY + 11, { width: sColW, align: "center" });
      doc.font("Helvetica").fontSize(8).fillColor(CONTRACT_PDF_COLORS.textDark)
         .text(contratadaRep, sCol1X, sigY + 21, { width: sColW, align: "center" });
      doc.font("Helvetica-Bold").fontSize(8).fillColor(CONTRACT_PDF_COLORS.primary)
         .text("CONTRATADA", sCol1X, sigY + 31, { width: sColW, align: "center" });

      // Assinatura Contratante
      doc.font("Helvetica").fontSize(8).fillColor(CONTRACT_PDF_COLORS.textDark);
      doc.text("____________________________________________", sCol2X, sigY, { width: sColW, align: "center" });
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(CONTRACT_PDF_COLORS.primaryDark)
         .text(contratanteNome, sCol2X, sigY + 11, { width: sColW, align: "center" });
      doc.font("Helvetica").fontSize(8).fillColor(CONTRACT_PDF_COLORS.textDark)
         .text(contratanteRep, sCol2X, sigY + 21, { width: sColW, align: "center" });
      doc.font("Helvetica-Bold").fontSize(8).fillColor(CONTRACT_PDF_COLORS.primary)
         .text("CONTRATANTE", sCol2X, sigY + 31, { width: sColW, align: "center" });

      // Testemunhas
      const witY = sigY + 48;
      doc.font("Helvetica-Bold").fontSize(8).fillColor(CONTRACT_PDF_COLORS.primaryDark)
         .text("Testemunha 1", sCol1X, witY, { width: sColW, align: "left" });
      doc.font("Helvetica").fontSize(8).fillColor(CONTRACT_PDF_COLORS.textDark)
         .text("Nome: ____________________________________", sCol1X, witY + 11, { width: sColW, align: "left" });
      doc.text("CPF:     ____________________________________", sCol1X, witY + 22, { width: sColW, align: "left" });

      doc.font("Helvetica-Bold").fontSize(8).fillColor(CONTRACT_PDF_COLORS.primaryDark)
         .text("Testemunha 2", sCol2X, witY, { width: sColW, align: "left" });
      doc.font("Helvetica").fontSize(8).fillColor(CONTRACT_PDF_COLORS.textDark)
         .text("Nome: ____________________________________", sCol2X, witY + 11, { width: sColW, align: "left" });
      doc.text("CPF:     ____________________________________", sCol2X, witY + 22, { width: sColW, align: "left" });

      doc.y = witY + 34;
      doc.x = 42;
      signaturesRendered = true;

      // Pula os marcadores de assinaturas individuais que foram mesclados
      while (i < totalLines) i++;
      break;
    }

    // 6. Subtítulos internos ("Compete à CONTRATANTE:" / "Compete à CONTRATADA:")
    if (/^Compete\s+à\s+/i.test(p)) {
      doc.moveDown(0.2);
      doc.font("Helvetica-Bold").fontSize(8.5).fillColor(CONTRACT_PDF_COLORS.primaryDark)
         .text(p, { width: 511 });
      doc.moveDown(0.2);
      i++;
      continue;
    }

    // 7. Linha de Data/Local centralizada ("Uberlândia – MG, 16 de outubro de 2026.")
    if (pastClausulaSexta && /\b\d{1,2}\s+de\s+[a-zçã]+\s+de\s+\d{4}\b/i.test(p)) {
      doc.moveDown(0.6);
      doc.font("Helvetica").fontSize(8.5).fillColor(CONTRACT_PDF_COLORS.primaryDark)
         .text(p, 42, doc.y, { align: "center", width: 511 });
      doc.moveDown(0.6);
      i++;
      continue;
    }

    // 8. Linhas de assinatura legadas com rótulo centralizado (ex: "Contratada: Caio..." em contratos antigos)
    const isLegacySigLabel = /^(Contratada|Contratante):/i.test(p);
    if (isUnderline || isLegacySigLabel) {
      doc.font("Helvetica").fontSize(9).fillColor(CONTRACT_PDF_COLORS.textDark);
      doc.text(p, { align: "center", lineGap: 1.5, width: 511 });
      if (isLegacySigLabel) {
        doc.moveDown(1.5);
      }
      i++;
      continue;
    }

    // 9. Parágrafos comuns e itens de lista
    const isItem = /^([A-Z]\.|[-•]|\d+[ºª.]?)\s/.test(p);
    doc.fontSize(isItem ? 8 : 8.2).fillColor(CONTRACT_PDF_COLORS.textDark);
    renderFormattedParagraph(doc, p, {
      align: "left",
      lineGap: isItem ? 1 : 1.5,
      paragraphGap: isItem ? 1.5 : 2.5,
      width: 511,
    });

    i++;
  }

  // Se o documento não teve assinaturas no corpo nem pelo bloco estruturado, e tem dados para isso:
  const jaTemAssinaturas = lines.some((l) => /^(Contratada|Contratante):/i.test(l.trim()));
  if (!signaturesRendered && !jaTemAssinaturas && (preparedDados.assinatura_contratada || preparedDados.assinatura_contratante)) {
    doc.moveDown(1.5);
    doc.font("Helvetica").fontSize(9);
    doc.text("____________________________________________________", { align: "center" });
    doc.text(`Contratada: ${preparedDados.assinatura_contratada || ""}`.trimEnd(), { align: "center" });
    doc.moveDown(2);
    doc.text("____________________________________________________", { align: "center" });
    doc.text(`Contratante: ${preparedDados.assinatura_contratante || preparedDados.razao_social || ""}`.trimEnd(), { align: "center" });
  }

  finalPageCount = doc.bufferedPageRange().count;
  doc.end();

  return await pdfBufferPromise;
}

/**
 * Upload de contrato assinado (ex: assinado via gov.br).
 * Guarda os bytes exatos no Cloudflare R2 (com trava de ambiente em prod).
 * Ao subir o arquivo, atualiza o status do contrato para "assinado".
 * Substituição preserva o histórico de versões em signed_file_history (nunca apaga do storage).
 */
export async function uploadSignedContract(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;

    const { id } = req.params;

    let buffer = null;
    if (Buffer.isBuffer(req.body)) {
      buffer = req.body;
    } else if (req.body && typeof req.body === "object" && typeof req.body.base64 === "string") {
      buffer = Buffer.from(req.body.base64, "base64");
    } else if (typeof req.body === "string") {
      buffer = Buffer.from(req.body, "binary");
    }

    if (!buffer || buffer.length === 0) {
      return sendError(res, 400, "BAD_REQUEST", "Arquivo não fornecido ou buffer vazio");
    }

    if (buffer.length > CONTRACT_MAX_BYTES) {
      return sendError(res, 400, "FILE_TOO_LARGE", "O arquivo excede o limite máximo permitido de 20 MB.");
    }

    // Validação estrita de cabeçalho PDF (%PDF)
    const isPdf = buffer.length >= 4 && buffer.slice(0, 4).toString("ascii") === "%PDF";
    if (!isPdf) {
      return sendError(res, 400, "INVALID_FILE_TYPE", "Apenas arquivos PDF são aceitos.");
    }

    const { rows: contractRows } = await db.query(
      "SELECT id, tenant_id, status, signed_file_path, signed_file_name, signed_uploaded_at, signed_uploaded_by, signed_file_history FROM public.gd_contracts WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );

    if (contractRows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Contrato não encontrado");
    }

    const contract = contractRows[0];

    const rawFileName = req.headers["x-file-name"] || req.query.filename || "contrato-assinado.pdf";
    let originalFileName = "contrato-assinado.pdf";
    try {
      originalFileName = decodeURIComponent(String(rawFileName)).trim() || "contrato-assinado.pdf";
    } catch {
      originalFileName = String(rawFileName).trim() || "contrato-assinado.pdf";
    }
    if (!originalFileName.toLowerCase().endsWith(".pdf")) {
      originalFileName += ".pdf";
    }

    const timestamp = Date.now();
    const saveResult = await saveContractBuffer({
      clientId: tenantId,
      contractId: id,
      buffer,
      timestamp,
    });

    // Versionamento histórico (substitui atual sem apagar o anterior do storage)
    const history = Array.isArray(contract.signed_file_history) ? [...contract.signed_file_history] : [];
    if (contract.signed_file_path) {
      history.push({
        signed_file_path: contract.signed_file_path,
        signed_file_name: contract.signed_file_name,
        signed_uploaded_at: contract.signed_uploaded_at,
        signed_uploaded_by: contract.signed_uploaded_by,
        archived_at: new Date().toISOString(),
      });
    }

    const uploadedBy =
      req.authAccess?.email ||
      req.authUser?.email ||
      req.authAccess?.uid ||
      req.authUser?.name ||
      "usuario";

    const { rows: updatedRows } = await db.query(
      `UPDATE public.gd_contracts
       SET signed_file_path = $1,
           signed_file_name = $2,
           signed_uploaded_at = NOW(),
           signed_uploaded_by = $3,
           signed_file_history = $4,
           status = 'assinado',
           updated_at = NOW()
       WHERE id = $5 AND tenant_id = $6
       RETURNING *`,
      [
        saveResult.storageKey,
        originalFileName,
        uploadedBy,
        JSON.stringify(history),
        id,
        tenantId,
      ]
    );

    res.status(200).json(updatedRows[0]);
  } catch (error) {
    console.error("[uploadSignedContract] Error:", error);
    if (!res.headersSent) {
      sendError(res, 500, "INTERNAL_ERROR", error.message || "Erro ao fazer upload do contrato assinado");
    }
  }
}

/**
 * Download de contrato assinado.
 * Escopo de tenant estrito (WHERE id = $1 AND tenant_id = $2). Se não encontrar, responde 404 (nunca 403).
 * Serve os bytes exatos salvos no storage, preservando integralmente a assinatura digital.
 */
export async function downloadSignedContract(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;

    const { id } = req.params;

    const { rows } = await db.query(
      "SELECT id, tenant_id, signed_file_path, signed_file_name FROM public.gd_contracts WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );

    if (rows.length === 0 || !rows[0].signed_file_path) {
      return sendError(res, 404, "NOT_FOUND", "Contrato assinado não encontrado");
    }

    const contract = rows[0];
    const fileResult = await getContractBuffer(contract.signed_file_path);
    if (!fileResult || !fileResult.buffer) {
      return sendError(res, 404, "NOT_FOUND", "Arquivo assinado não encontrado no armazenamento");
    }

    const fileName = contract.signed_file_name || `contrato-${id}-assinado.pdf`;
    const cleanFileName = fileName.replace(/["\r\n]/g, "");
    const safeEncodedName = encodeURIComponent(cleanFileName);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", fileResult.buffer.length);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${cleanFileName}"; filename*=UTF-8''${safeEncodedName}`
    );
    return res.send(fileResult.buffer);
  } catch (error) {
    console.error("[downloadSignedContract] Error:", error);
    if (!res.headersSent) {
      sendError(res, 500, "INTERNAL_ERROR", "Erro ao baixar contrato assinado");
    }
  }
}

