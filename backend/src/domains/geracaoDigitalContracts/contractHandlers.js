import { pgDatabasePool as db } from "../../services/database.js";
import { resolveTenantUuid, GD_TENANT_UUID } from "./tenantResolver.js";
import { sendError } from "../../services/httpInfra.js";
import { saveContractBuffer, getContractBuffer, CONTRACT_MAX_BYTES } from "../../services/storage.js";
import {
  sendTextMessageViaEvolution,
  resolveInstanceIdentifier,
  extractEvolutionInstanceSlug,
} from "../../services/evolution.js";
// ATENÇÃO (import circular): funciona porque getTenantContratadaConfig é function declaration (tem hoisting).
import { getTenantContratadaConfig } from "./juridicoHandlers.js";
import { resolveCandidateEvolutionInstances } from "./contractEvolutionResolver.js";
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
import {
  GD_COLORS,
  CONTRACT_PDF_COLORS,
  normalizeClauseHeader,
  renderFormattedParagraph,
  drawHeader,
  drawClauseHeader,
  drawPartesBoxes,
  drawPricingTable,
  drawSignaturesAndWitnesses,
  drawFooter,
  renderContractPdf,
} from "./contractVisualRenderer.js";

export {
  prepareContractDados,
  formatCnpj,
  formatTelefone,
  formatBrl,
  GD_COLORS,
  CONTRACT_PDF_COLORS,
  normalizeClauseHeader,
  renderFormattedParagraph,
  drawHeader,
  drawClauseHeader,
  drawPartesBoxes,
  drawPricingTable,
  drawSignaturesAndWitnesses,
  drawFooter,
  renderContractPdf,
};

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

export { resolveCandidateEvolutionInstances };

export async function notificarDiretoriaWhatsapp(req, res) {
  try {
    const tenantId = await resolveTenantUuid(req, res);
    if (!tenantId) return;
    const { id } = req.params;

    const { rows: contractRows } = await db.query(
      `SELECT * FROM public.gd_contracts WHERE id = $1 AND (tenant_id = $2 OR tenant_id = '00000000-0000-0000-0000-000000000000') LIMIT 1`,
      [id, tenantId]
    );
    if (contractRows.length === 0) {
      return sendError(res, 404, "NOT_FOUND", "Contrato não encontrado.");
    }

    const contract = contractRows[0];
    const dados = typeof contract.dados === "string" ? JSON.parse(contract.dados) : (contract.dados || {});
    const empresa = dados.razao_social || dados.empresa || "Cliente";
    const cnpj = dados.cnpj || "-";
    const responsavel = dados.responsavel_nome || dados.representante || "-";

    const { rows: modRows } = await db.query(
      `SELECT config FROM public.tenant_modules 
       WHERE tenant_id = $1 OR tenant_id = '00000000-0000-0000-0000-000000000000' 
       ORDER BY (CASE WHEN tenant_id = $1 THEN 0 ELSE 1 END) LIMIT 1`,
      [tenantId]
    );
    const cfg = modRows[0]?.config || {};
    const requestedInstance =
      cfg?.gd?.juridico?.evolution_instance ||
      process.env.GD_ONBOARDING_EVOLUTION_INSTANCE ||
      process.env.GD_EVOLUTION_INSTANCE ||
      null;

    const candidateInstances = await resolveCandidateEvolutionInstances(db, requestedInstance);

    const diretoriaWhatsAppNumeros = [
      process.env.GD_CAIO_WHATSAPP || "5534997719779",
      process.env.GD_CONRADO_WHATSAPP || "5534991751267",
    ];

    const mensagemDiretoria =
      `📄 *Novo Contrato Comercial Gerado!* 🚀\n\n` +
      `*Empresa:* ${empresa}\n` +
      `*CNPJ:* ${cnpj}\n` +
      `*Responsável:* ${responsavel}\n` +
      `*Origem:* Proposta Comercial Aceita\n\n` +
      `O cliente já deu o aceite nos termos. Conforme o protocolo GD, o contrato deve receber a *1ª assinatura da Diretoria (Caio)* via GOV.BR antes de seguir para o cliente.\n\n` +
      `👉 *Visualizar / Baixar Contrato para Assinatura:*\n` +
      `https://crm.vexoia.com/api/gd/contracts/${id}/pdf`;

    const resultados = [];
    let successfulInstance = null;
    const defaultInstanceSlug = candidateInstances[0]?.slug || String(candidateInstances[0] || "evolution");

    for (const numero of diretoriaWhatsAppNumeros) {
      let enviado = false;
      let ultimoErro = null;
      let usedInstance = defaultInstanceSlug;

      const attempted = new Set();
      for (const inst of candidateInstances) {
        const slug = typeof inst === "string" ? inst : (inst.slug || String(inst));
        const baseUrl = typeof inst === "object" ? inst.baseUrl : null;
        const webhookToken = typeof inst === "object" ? inst.webhookToken : null;

        if (!slug || attempted.has(slug)) continue;
        attempted.add(slug);

        try {
          await sendTextMessageViaEvolution({
            instanceName: slug,
            baseUrl: baseUrl || undefined,
            webhookToken: webhookToken || undefined,
            number: numero,
            text: mensagemDiretoria,
          });
          usedInstance = slug;
          if (!successfulInstance) successfulInstance = slug;
          resultados.push({
            numero,
            status: "sent",
            instance: slug,
            fallback: slug !== defaultInstanceSlug,
          });
          enviado = true;
          break;
        } catch (err) {
          ultimoErro = err.message;
          console.warn(`[notificarDiretoria] Falha no envio para ${numero} via "${slug}":`, err.message);
        }
      }

      if (!enviado) {
        resultados.push({ numero, status: "error", error: ultimoErro, instance: usedInstance });
      }
    }

    const erros = resultados.filter((r) => r.status === "error");
    if (erros.length === diretoriaWhatsAppNumeros.length) {
      const failingInstance = resultados[0]?.instance || defaultInstanceSlug || "whatsapp";
      return res.status(400).json({
        success: false,
        error: `Falha no envio via chip "${failingInstance}": ${erros[0]?.error || "Instância desconectada ou erro na Evolution"}`,
        instance: failingInstance,
        resultados,
      });
    }

    const successInstance = successfulInstance || defaultInstanceSlug;
    res.json({
      success: true,
      message: "Notificações enviadas com sucesso para a Diretoria.",
      instance: successInstance,
      resultados,
    });
  } catch (error) {
    console.error("[notificarDiretoriaWhatsapp] Error:", error);
    sendError(res, 500, "INTERNAL_ERROR", error.message || "Erro ao notificar diretoria.");
  }
}

