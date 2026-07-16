import PDFDocument from "pdfkit";
import { pgDatabasePool as db } from "../../services/database.js";
import { resolveTenantUuid } from "./tenantResolver.js";
import { sendError } from "../../services/httpInfra.js";

// Helper for formatting date
function formatExtenseDate() {
  const months = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const date = new Date();
  return `${date.getDate()} de ${months[date.getMonth()]} de ${date.getFullYear()}`;
}

// Mail merge function
function applyMerge(template, data) {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`{{${key}}}`, "g");
    result = result.replace(regex, value || "");
  }
  return result;
}

export async function listContractTemplates(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;

    const { rows } = await db.query(
      "SELECT * FROM gd_contract_templates WHERE tenant_id = $1 AND ativo = true ORDER BY created_at DESC",
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
      "SELECT * FROM gd_contract_templates WHERE id = $1 AND tenant_id = $2",
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

export async function createContract(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;

    const { proposal_id, template_id, dados } = req.body;

    if (!proposal_id || !dados) {
      return sendError(res, 400, "BAD_REQUEST", "proposal_id e dados são obrigatórios");
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

    const { rows: contractRows } = await db.query(
      `INSERT INTO gd_contracts (tenant_id, proposal_id, dados, status)
       VALUES ($1, $2, $3, 'rascunho')
       RETURNING *`,
      [tenantId, proposal_id, dados]
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

    // Por padrão lista só os ativos; ?arquivado=true traz os arquivados.
    const querArquivados = String(arquivado) === "true";

    let query = "SELECT * FROM gd_contracts WHERE tenant_id = $1 AND COALESCE(arquivado, false) = $2";
    const params = [tenantId, querArquivados];

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
    const { dados, status, arquivado } = req.body;

    const { rows } = await db.query(
      `UPDATE gd_contracts
       SET dados = COALESCE($1, dados),
           status = COALESCE($2, status),
           arquivado = COALESCE($3, arquivado),
           updated_at = NOW()
       WHERE id = $4 AND tenant_id = $5
       RETURNING *`,
      [dados, status, typeof arquivado === "boolean" ? arquivado : null, id, tenantId]
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
    "SELECT * FROM gd_contracts WHERE id = $1 AND tenant_id = $2",
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

  const { rows: templateRows } = await db.query(
    "SELECT * FROM gd_contract_templates WHERE tenant_id = $1 AND ativo = true ORDER BY created_at DESC LIMIT 1",
    [tenantId]
  );
  if (templateRows.length === 0) {
    const e = new Error("Template de contrato não encontrado");
    e.code = "TEMPLATE_NOT_FOUND";
    throw e;
  }

  const pdfData = await renderContractPdf(templateRows[0].conteudo, dados);
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
     WHERE id = $1 AND tenant_id = $2`,
    [id, tenantId]
  );
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="contrato-${id}.pdf"`);
  return res.send(pdfData);
}

// Renderização do documento (mesmo layout do preview da tela).
async function renderContractPdf(templateConteudo, dados) {
  {
    const mergedContent = applyMerge(templateConteudo, dados);

    // Generate PDF to Buffer instead of direct stream
    const doc = new PDFDocument({ margin: 56, bufferPages: true });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    
    // We wrap doc.end() in a promise to wait for the buffer to finish
    const pdfBufferPromise = new Promise((resolve) => {
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
    });

    // Renderização espelhando o preview da tela: alinhado à esquerda, espaçamento
    // consistente e sem "justify" (que esticava as linhas e desalinhava o texto).
    const BODY_SIZE = 10.5;
    const LINE_GAP = 2.5;
    const linhas = mergedContent.split("\n");
    let tituloRenderizado = false;

    for (const linha of linhas) {
      const p = linha.trimEnd();

      if (p.trim() === "") {
        doc.moveDown(0.5);
        continue;
      }

      // Título principal: apenas a primeira linha em caixa alta do documento.
      if (!tituloRenderizado && p.trim() === p.trim().toUpperCase() && p.trim().length > 10) {
        doc.font("Helvetica-Bold").fontSize(13).text(p.trim(), { align: "center", lineGap: LINE_GAP });
        doc.moveDown(1);
        tituloRenderizado = true;
        continue;
      }

      // Cabeçalho de cláusula.
      if (/^Cláusula\s/i.test(p.trim())) {
        doc.moveDown(0.4);
        doc.font("Helvetica-Bold").fontSize(11.5).text(p.trim(), { align: "left", lineGap: LINE_GAP });
        doc.moveDown(0.25);
        continue;
      }

      // Itens de lista (A./B./ "- item" / "1º Pagamento") — sem recuo extra,
      // mantendo o alinhamento à esquerda igual ao preview.
      const isItem = /^([A-Z]\.|[-•]|\d+º)\s/.test(p.trim());
      doc.font("Helvetica").fontSize(BODY_SIZE).text(p.trim(), {
        align: "left",
        lineGap: LINE_GAP,
        paragraphGap: isItem ? 0 : 2,
      });
    }

    doc.moveDown(3);

    // Assinaturas
    doc.font("Helvetica").fontSize(10.5);
    doc.text("____________________________________________________", { align: "center" });
    doc.text("Contratada: CAIO VINÍCIUS ALMEIDA DE OLIVEIRA", { align: "center" });
    doc.moveDown(2);
    doc.text("____________________________________________________", { align: "center" });
    doc.text(`Contratante: ${dados.razao_social || "Razão Social"}`, { align: "center" });

    doc.end();

    return await pdfBufferPromise;
  }
}
