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

    const { proposal_id } = req.query;
    
    let query = "SELECT * FROM gd_contracts WHERE tenant_id = $1";
    const params = [tenantId];
    
    if (proposal_id) {
      query += " AND proposal_id = $2";
      params.push(proposal_id);
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
    const { dados, status } = req.body;

    const { rows } = await db.query(
      `UPDATE gd_contracts 
       SET dados = COALESCE($1, dados), 
           status = COALESCE($2, status)
       WHERE id = $3 AND tenant_id = $4
       RETURNING *`,
      [dados, status, id, tenantId]
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

export async function generateContractPdf(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;
    const { id } = req.params;

    // Load Contract
    const { rows: contractRows } = await db.query(
      "SELECT * FROM gd_contracts WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );

    if (contractRows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Contrato não encontrado");
    }

    const contract = contractRows[0];
    const dados = contract.dados || {};
    dados.data_extenso = formatExtenseDate(); // add extense date for {{data_extenso}}

    // Load Template
    const { rows: templateRows } = await db.query(
      "SELECT * FROM gd_contract_templates WHERE tenant_id = $1 AND ativo = true ORDER BY created_at DESC LIMIT 1",
      [tenantId]
    );

    if (templateRows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Template de contrato não encontrado");
    }

    const templateConteudo = templateRows[0].conteudo;
    const mergedContent = applyMerge(templateConteudo, dados);

    // Generate PDF to Buffer instead of direct stream
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];
    doc.on('data', buffers.push.bind(buffers));
    
    // We wrap doc.end() in a promise to wait for the buffer to finish
    const pdfBufferPromise = new Promise((resolve) => {
      doc.on('end', () => {
        const pdfData = Buffer.concat(buffers);
        resolve(pdfData);
      });
    });

    // Split text by lines and render it
    const paragraphs = mergedContent.split("\n");
    for (let p of paragraphs) {
      if (p.trim() === "") {
        doc.moveDown();
      } else if (p.toUpperCase() === p && p.trim().length > 10 && !p.startsWith("A.") && !p.startsWith("B.") && !p.startsWith("C.")) {
        // Simple heuristic for titles
        doc.font("Helvetica-Bold").fontSize(12).text(p, { align: "center" });
        doc.moveDown();
      } else if (p.startsWith("Cláusula")) {
        doc.font("Helvetica-Bold").fontSize(11).text(p);
        doc.moveDown();
      } else {
        doc.font("Helvetica").fontSize(11).text(p, { align: "justify" });
      }
    }

    doc.moveDown(4);

    // Signatures
    doc.font("Helvetica").text("____________________________________________________", { align: "center" });
    doc.text("Contratada: CAIO VINÍCIUS ALMEIDA DE OLIVEIRA", { align: "center" });
    doc.moveDown(2);
    doc.text("____________________________________________________", { align: "center" });
    doc.text(`Contratante: ${dados.razao_social || "Razão Social"}`, { align: "center" });

    doc.end();

    const pdfData = await pdfBufferPromise;

    // FASE 3: Enviar para o ZapSign (Mock)
    const { createDocument } = await import("../../services/zapsign.js");
    
    const zapsignResponse = await createDocument(id, pdfData, {
      email: dados.email || "teste@teste.com"
    });

    // Salvar o link e provedor no banco de dados
    await db.query(
      `UPDATE gd_contracts 
       SET provider_id = $1, provider_name = $2, sign_url = $3, status = $4
       WHERE id = $5 AND tenant_id = $6`,
      [zapsignResponse.provider_id, zapsignResponse.provider_name, zapsignResponse.sign_url, zapsignResponse.status, id, tenantId]
    );

    // Retornar os dados para o frontend (JSON) em vez de baixar o PDF automaticamente.
    // O frontend pode exibir o link de assinatura.
    res.json({
      success: true,
      contract_id: id,
      sign_url: zapsignResponse.sign_url,
      message: "Contrato gerado e enviado para assinatura eletrônica com sucesso."
    });

  } catch (error) {
    console.error("[generateContractPdf] Error:", error);
    if (!res.headersSent) {
      sendError(res, 500, "INTERNAL_ERROR", "Erro ao gerar PDF do contrato");
    }
  }
}
