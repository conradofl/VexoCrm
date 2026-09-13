import PDFDocument from "pdfkit";
import { pgDatabasePool as db } from "../../services/database.js";
import { resolveTenantUuid } from "./tenantResolver.js";
import { sendError } from "../../services/httpInfra.js";
import { saveContractBuffer, getContractBuffer, CONTRACT_MAX_BYTES } from "../../services/storage.js";
// ATENÇÃO (import circular): funciona porque getTenantContratadaConfig é function declaration (tem hoisting).
// NÃO converter para const/arrow function, sob risco de quebra em tempo de execução por TDZ.
import { getTenantContratadaConfig } from "./juridicoHandlers.js";

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
      `INSERT INTO gd_contracts (tenant_id, proposal_id, dados, status, owner_company)
       VALUES ($1, $2, $3, 'rascunho', $4)
       RETURNING *`,
      [tenantId, proposal_id || null, dados, finalOwnerCompany]
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

  // Se o usuário editou o texto final na tela, renderiza diretamente ignorando o template
  if (dados?.texto_final && typeof dados.texto_final === "string" && dados.texto_final.trim()) {
    const pdfData = await renderContractPdf(dados.texto_final, dados);
    return { contract, dados, pdfData };
  }

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

// Renderização do documento (mesmo layout do preview da tela).
export async function renderContractPdf(templateConteudo, dados) {
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
        // Cada linha vazia (Enter) agora gera um espaçamento completo real (~14pt)
        doc.moveDown(1.0);
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

      // Linhas de assinatura centralizadas (traços e rótulos de Contratada/Contratante)
      const isSignatureUnderline = /^[_\s]{10,}$/.test(p.trim());
      const isSignatureLabel = /^(Contratada|Contratante):/i.test(p.trim());
      if (isSignatureUnderline || isSignatureLabel) {
        doc.font("Helvetica").fontSize(10.5);
        doc.text(p.trim(), { align: "center", lineGap: LINE_GAP });
        if (isSignatureLabel) {
          // Espaço base generoso após o nome para acomodar carimbo/rubrica digital
          doc.moveDown(2.5);
        }
        continue;
      }

      // Itens de lista (A./B./ "- item" / "1º Pagamento") — sem recuo extra,
      // mantendo o alinhamento à esquerda igual ao preview.
      const isItem = /^([A-Z]\.|[-•]|\d+º)\s/.test(p.trim());
      doc.fontSize(BODY_SIZE);
      renderFormattedParagraph(doc, p.trim(), {
        align: "left",
        lineGap: LINE_GAP,
        paragraphGap: isItem ? 0 : 2,
      });
    }

    // Assinaturas: se o documento já não renderizou assinaturas no corpo do texto,
    // inclui o bloco de rodapé com suporte aos campos dinâmicos dados.assinatura_contratada / contratante
    const jaTemAssinaturas = linhas.some((l) => /^(Contratada|Contratante):/i.test(l.trim()));
    if (!jaTemAssinaturas) {
      doc.moveDown(3);
      doc.font("Helvetica").fontSize(10.5);
      doc.text("____________________________________________________", { align: "center" });
      doc.text(`Contratada: ${dados.assinatura_contratada || ""}`.trimEnd(), { align: "center" });
      doc.moveDown(4.5);
      doc.text("____________________________________________________", { align: "center" });
      doc.text(`Contratante: ${dados.assinatura_contratante || dados.razao_social || ""}`.trimEnd(), { align: "center" });
    }

    doc.end();

    return await pdfBufferPromise;
  }
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

