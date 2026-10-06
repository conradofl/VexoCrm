// Importação do Banco de Dados (planilha/CSV/texto da IA → leads). A regra de transformar linha em lead mora AQUI, uma só vez:
// a rota de POST único (/api/leads/import-csv) e as rotas em lotes do Banco (/api/leads/import-batches/…) usam a mesma função.
//
// O registro da importação (lead_imports + lead_import_items) é o MESMO da tela de Planilhas, feito pelo caminho em lotes
// (services/leadImportBatches.js), para a Campanhas listar a planilha com os leads dela. O identificador que fica em
// dados.import_ids de cada lead é o id desse registro (a abertura), de modo que a exclusão em massa por importação continua exata.
//
// Cada lote grava os LEADS primeiro e só depois registra o lote (itens + ponto de retomada): se algo cair entre os dois, o ponto
// de retomada ainda não avançou, o lote é reenviado e o upsert por telefone é idempotente (import_ids é união, não duplica).

import { normalizeImportedLead as defaultNormalizeImportedLead, sanitizePhone } from "./leadImport.js";
import { resolveImportOrigin } from "./importOrigin.js";
import { normalizeString } from "../textNormalize.js";
import { upsertLeadsBatchByPhone } from "./leadUpsert.js";
import { IMPORT_BATCH_SIZE, appendLeadImportBatch, closeLeadImport, extractMappingItems, openLeadImport, ImportError } from "./leadImportBatches.js";

export const BANCO_IMPORT_MODE = "banco";

function sanitizePhoneE164(phoneInput, defaultDdd = null) {
  const s = sanitizePhone(phoneInput, defaultDdd);
  if (!s) return null;
  return s.startsWith("+") ? s : `+${s}`;
}

/** "tag1, tag2" ou ["tag1"] → ["tag1","tag2"] */
export function normalizeImportTags(raw) {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  if (typeof raw === "string") return raw.split(",").map((t) => t.trim()).filter(Boolean);
  return [];
}

/** Nome do registro quando quem importou não deu um nome de arquivo (texto colado da IA, chamada antiga). Descritivo, nunca inventa arquivo. */
export function describeImportSource({ sourceName, importTags = [], asClosedSales = false, now = new Date() }) {
  const given = normalizeString(sourceName);
  if (given) return given;
  const when = now.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const label = asClosedSales ? "Vendas fechadas" : importTags.includes("IA Direct/Chat") ? "Texto colado (IA)" : "Importação direta";
  return `${label} — ${when}`;
}

/** Tipo do registro pelo nome do arquivo (xlsx, csv…); sem extensão conhecida, 'banco'. */
export function inferSourceType(sourceName) {
  const m = /\.([a-z0-9]{2,5})$/i.exec(String(sourceName || "").trim());
  const ext = m ? m[1].toLowerCase() : "";
  return ["xlsx", "xls", "csv", "ods", "numbers"].includes(ext) ? ext : "banco";
}

/**
 * Linhas cruas → leads para o upsert. Mesma regra de sempre da rota (movida, não reescrita):
 *  - com mapeamento: normalizeImportedLead; sem mapeamento: colunas conhecidas (telefone/phone/celular/whatsapp/numero);
 *  - sem telefone válido (ou 5500…): a linha é pulada, nunca inventa número;
 *  - origem pela tag da importação/linha, coluna de origem, vendas fechadas ou a própria importação.
 */
export function buildBancoLeads(rows, { clientId, defaultDdd = null, mappingItems = null, importTags = [], asClosedSales = false, importId, normalizeImportedLead = defaultNormalizeImportedLead, now = () => new Date().toISOString() }) {
  const parsedLeads = [];
  let skippedNoPhoneCount = 0;
  const phoneMapping = mappingItems?.find((m) => m && m.target === "telefone");

  for (const row of rows) {
    let formattedPhone = null;
    let name = null;
    let rawPhone = "";
    let customCampos = {};

    if (mappingItems) {
      const normalized = normalizeImportedLead(row, clientId, defaultDdd, mappingItems);
      if (normalized.telefone) {
        formattedPhone = normalized.telefone.startsWith("+") ? normalized.telefone : `+${normalized.telefone}`;
      }
      name = normalized.nome;
      rawPhone = normalized.dados?.telefone_bruto || (phoneMapping ? row[phoneMapping.column] : "") || "";
      customCampos = normalized.dados?.campos || {};
    } else {
      rawPhone = row.telefone || row.phone || row.celular || row.whatsapp || row.numero || "";
      formattedPhone = sanitizePhoneE164(rawPhone, defaultDdd);
      name = normalizeString(row.nome || row.name || row.cliente || row.contato || formattedPhone || "Lead Social");
      if (row.dados && typeof row.dados.campos === "object" && row.dados.campos) {
        customCampos = { ...row.dados.campos };
      }
    }

    if (!formattedPhone || formattedPhone.replace(/^\+/, "").startsWith("5500")) {
      skippedNoPhoneCount++;
      continue;
    }

    const stageInput = normalizeString(row.stage || row.estagio || row.etapa)?.toLowerCase();
    const validStage = asClosedSales ? "buyer" : ["buyer", "open_budget", "inquiry", "cold", "lost"].includes(stageInput) ? stageInput : "cold";

    const tempInput = normalizeString(row.temperature || row.temperatura)?.toLowerCase();
    const validTemp = asClosedSales ? "hot" : ["hot", "warm", "cold"].includes(tempInput) ? tempInput : "warm";

    const rowTags = row.tags || row.tag || [];
    const parsedRowTags = Array.isArray(rowTags)
      ? rowTags.map((t) => String(t).trim())
      : typeof rowTags === "string"
        ? rowTags.split(",").map((t) => t.trim()).filter(Boolean)
        : [];

    const closedSalesTags = asClosedSales ? ["Venda Fechada", "Cliente Histórico"] : [];
    const resolvedOrigin = resolveImportOrigin({ importTags, rowTags: parsedRowTags, rowOrigem: row.origem, isClosedSales: asClosedSales });
    const originTag = resolvedOrigin.originTag;
    const combinedTags = Array.from(new Set([...parsedRowTags, ...importTags, ...closedSalesTags, ...(originTag ? [originTag] : [])]));
    const valorVenda = Number(row.valor_venda || row.valor || row.valor_total) || null;

    const dadosPayload = {
      import_ids: [importId],
      origem: resolvedOrigin.origem,
      origem_marketing: resolvedOrigin.origemMarketing,
      lead_source: resolvedOrigin.leadSource,
      resumo_chat: row.interesse || row.resumo_chat || (asClosedSales ? "Cliente histórico importado como venda fechada" : "Interação no Direct"),
      telefone_bruto: rawPhone ? String(rawPhone).trim() : null,
      valor_venda: valorVenda || undefined,
      data_fechamento: row.data_fechamento || undefined,
      produto_comprado: row.produto_comprado || undefined,
    };
    if (Object.keys(customCampos).length > 0) dadosPayload.campos = customCampos;

    parsedLeads.push({
      client_id: clientId,
      telefone: formattedPhone,
      phone: formattedPhone,
      nome: name,
      stage: validStage,
      stage_source: asClosedSales ? "manual" : undefined,
      temperature: validTemp,
      potential_contract_value: valorVenda || undefined,
      tags: combinedTags,
      dados: dadosPayload,
      created_at: now(),
      updated_at: now(),
    });
  }
  return { leads: parsedLeads, skippedNoPhoneCount };
}

/** O que a abertura guarda em import_params para os lotes seguintes (o servidor é a fonte, o cliente não reenvia a cada lote). */
export function bancoImportParams({ importTags = [], asClosedSales = false }) {
  return { mode: BANCO_IMPORT_MODE, importTags: normalizeImportTags(importTags), asClosedSales: Boolean(asClosedSales) };
}

/** Abre o registro de uma importação do Banco (mesma tabela e mesmo caminho da tela de Planilhas). */
export function openBancoImport(pool, { clientId, sourceName, defaultDdd, columnMapping, totalRows, sampleRows, fingerprint, importTags, asClosedSales, uploadedByUid, uploadedByEmail }) {
  const tags = normalizeImportTags(importTags);
  const name = describeImportSource({ sourceName, importTags: tags, asClosedSales });
  return openLeadImport(pool, {
    clientId,
    sourceName: name,
    sourceType: inferSourceType(name),
    defaultDdd,
    columnMapping,
    totalRows,
    sampleRows,
    fingerprint,
    uploadedByUid,
    uploadedByEmail,
    importParams: bancoImportParams({ importTags: tags, asClosedSales }),
  });
}

/**
 * Um lote do Banco: cria/atualiza os LEADS e depois registra o lote. `ctx` é o contexto lido do servidor (parâmetros da abertura):
 * { importId, clientId, params: {defaultDdd, mode, importTags, asClosedSales}, columnMapping }.
 */
export async function appendBancoImportBatch(pool, ctx, { startIndex, rows, fingerprint, normalizeImportedLead, isImportedLeadEmpty, upsert = upsertLeadsBatchByPhone }) {
  if (!Array.isArray(rows) || rows.length === 0) throw new ImportError(400, "INVALID_BODY", "O lote precisa ter pelo menos uma linha");
  if (rows.length > IMPORT_BATCH_SIZE) {
    throw new ImportError(413, "BATCH_TOO_LARGE", `Cada lote aceita no máximo ${IMPORT_BATCH_SIZE} linhas (recebeu ${rows.length}). Divida o envio em lotes de até ${IMPORT_BATCH_SIZE}.`);
  }
  const params = ctx.params || {};
  const { leads, skippedNoPhoneCount } = buildBancoLeads(rows, {
    clientId: ctx.clientId,
    defaultDdd: params.defaultDdd || null,
    mappingItems: extractMappingItems(ctx.columnMapping),
    importTags: params.importTags || [],
    asClosedSales: Boolean(params.asClosedSales),
    importId: ctx.importId,
    normalizeImportedLead,
  });
  let leadsTouched = 0;
  if (leads.length > 0) {
    const result = await upsert(pool, ctx.clientId, leads);
    leadsTouched = result?.totalCount ?? leads.length;
  }
  const registered = await appendLeadImportBatch(pool, {
    importId: ctx.importId,
    clientId: ctx.clientId,
    startIndex,
    rows,
    fingerprint,
    normalizeImportedLead,
    isImportedLeadEmpty,
  });
  return { ...registered, leadsTouched, skippedNoPhone: skippedNoPhoneCount };
}

/**
 * Importação do Banco num POST só (texto colado da IA, chamadas antigas): abre → lotes de 500 → fecha, pelo MESMO caminho dos
 * lotes. Sem teto de linhas por parâmetros; o teto por requisição continua sendo o tamanho do corpo (express.json).
 * Se algo falhar no meio a importação fica 'incomplete' com o que entrou e o erro leva o id e o ponto alcançado.
 */
export async function runBancoImportInOnePost(pool, input, deps = {}) {
  const rows = input.rows;
  const mappingItems = extractMappingItems(input.columnMapping);
  const opened = await openBancoImport(pool, {
    clientId: input.clientId,
    sourceName: input.sourceName,
    defaultDdd: input.defaultDdd,
    columnMapping: input.columnMapping,
    totalRows: rows.length,
    sampleRows: rows.slice(0, 15),
    importTags: input.importTags,
    asClosedSales: input.asClosedSales,
    uploadedByUid: input.uploadedByUid,
    uploadedByEmail: input.uploadedByEmail,
  });
  const importId = opened.item.id;
  const ctx = {
    importId,
    clientId: input.clientId,
    params: { defaultDdd: input.defaultDdd || null, mode: BANCO_IMPORT_MODE, importTags: normalizeImportTags(input.importTags), asClosedSales: Boolean(input.asClosedSales) },
    columnMapping: mappingItems ? input.columnMapping : null,
  };
  let leadsTouched = 0;
  let skippedNoPhone = 0;
  let receivedOffset = 0;
  try {
    for (let start = 0; start < rows.length; start += IMPORT_BATCH_SIZE) {
      const out = await appendBancoImportBatch(pool, ctx, { startIndex: start, rows: rows.slice(start, start + IMPORT_BATCH_SIZE), ...deps });
      leadsTouched += out.leadsTouched;
      skippedNoPhone += out.skippedNoPhone;
      receivedOffset = out.receivedOffset;
    }
    const closed = await closeLeadImport(pool, { importId, clientId: input.clientId });
    return { importId, leadsTouched, skippedNoPhone, totals: closed.totals, item: closed.item, warnings: opened.warnings };
  } catch (error) {
    error.importId = importId;
    error.receivedOffset = receivedOffset;
    error.leadsTouched = leadsTouched;
    throw error;
  }
}
