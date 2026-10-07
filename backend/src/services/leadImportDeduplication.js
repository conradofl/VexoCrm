// backend/src/services/leadImportDeduplication.js
//
// Análise prévia de duplicados na importação de planilhas/contatos.
// Identifica colisões por telefone normalizado (canônico) e por nome exato quando o telefone for diferente.
// Permite que o operador escolha conscientemente a estratégia de importação (merge, skip ou overwrite).

import { sanitizePhone } from "./leadImport.js";
import { normalizeLeadPhoneKey, isRealName } from "./leadUpsert.js";
import { normalizeString } from "../textNormalize.js";
import { extractMappingItems } from "./leadImportBatches.js";

/**
 * Normaliza um telefone para chave canônica de busca (dígitos E.164 sem pontuação).
 */
export function canonicalPhone(phoneRaw, defaultDdd = null) {
  const sanitized = sanitizePhone(phoneRaw, defaultDdd);
  if (!sanitized) return null;
  return normalizeLeadPhoneKey(sanitized);
}

/**
 * Analisa as linhas de uma planilha antes da importação, comparando com o banco de dados.
 *
 * @param {import("pg").Pool} pool
 * @param {Object} params
 * @param {string} params.clientId
 * @param {Array<Record<string, unknown>>} params.rows
 * @param {unknown} [params.columnMapping]
 * @param {string} [params.defaultDdd]
 * @returns {Promise<{
 *   totalRows: number,
 *   newCount: number,
 *   duplicateCount: number,
 *   duplicatesByPhone: number,
 *   duplicatesByName: number,
 *   sampleDuplicates: Array<{ nome: string, telefone: string, existingTags: string[] }>
 * }>}
 */
export async function analyzeImportDuplicates(pool, { clientId, rows = [], columnMapping = null, defaultDdd = null }) {
  if (!pool || !clientId || !Array.isArray(rows) || rows.length === 0) {
    return {
      totalRows: Array.isArray(rows) ? rows.length : 0,
      newCount: 0,
      duplicateCount: 0,
      duplicatesByPhone: 0,
      duplicatesByName: 0,
      sampleDuplicates: [],
    };
  }

  const mappingItems = extractMappingItems(columnMapping);
  const phoneCol = mappingItems?.find((m) => m && m.target === "telefone")?.column;
  const nameCol = mappingItems?.find((m) => m && m.target === "nome")?.column;

  // 1. Extração e normalização de telefones e nomes da planilha
  const processedRows = [];
  const phonesSet = new Set();
  const namesSet = new Set();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;

    let rawPhone = "";
    if (phoneCol && row[phoneCol] !== undefined) {
      rawPhone = row[phoneCol];
    } else {
      rawPhone = row.telefone || row.phone || row.celular || row.whatsapp || row.numero || "";
    }

    let rawName = "";
    if (nameCol && row[nameCol] !== undefined) {
      rawName = row[nameCol];
    } else {
      rawName = row.nome || row.name || row.cliente || row.contato || "";
    }

    const normPhone = canonicalPhone(rawPhone, defaultDdd);
    const cleanName = normalizeString(rawName);
    const hasRealName = isRealName(cleanName);

    if (normPhone) phonesSet.add(normPhone);
    if (hasRealName) namesSet.add(cleanName.toLowerCase());

    processedRows.push({
      originalRow: row,
      normPhone,
      cleanName: hasRealName ? cleanName : null,
      rawPhone: String(rawPhone || "").trim(),
    });
  }

  const allPhones = Array.from(phonesSet);
  const allNames = Array.from(namesSet);

  // 2. Consulta em lote ao banco por telefones
  const existingByPhone = new Map();
  const CHUNK_SIZE = 500;

  for (let i = 0; i < allPhones.length; i += CHUNK_SIZE) {
    const chunk = allPhones.slice(i, i + CHUNK_SIZE);
    const res = await pool.query(
      `SELECT id, telefone, phone, nome, tags, stage, dados
       FROM public.leads
       WHERE client_id = $1 AND (telefone = ANY($2::text[]) OR phone = ANY($2::text[]))`,
      [clientId, chunk]
    ).catch((err) => {
      console.warn("[analyzeImportDuplicates] erro ao buscar telefones:", err?.message || err);
      return { rows: [] };
    });

    for (const lead of res.rows) {
      if (lead.telefone) existingByPhone.set(normalizeLeadPhoneKey(lead.telefone), lead);
      if (lead.phone) existingByPhone.set(normalizeLeadPhoneKey(lead.phone), lead);
    }
  }

  // 3. Consulta em lote ao banco por nomes (para detectar colisões por nome exato)
  const existingByName = new Map();
  for (let i = 0; i < allNames.length; i += CHUNK_SIZE) {
    const chunk = allNames.slice(i, i + CHUNK_SIZE);
    const res = await pool.query(
      `SELECT id, telefone, phone, nome, tags, stage, dados
       FROM public.leads
       WHERE client_id = $1 AND LOWER(TRIM(nome)) = ANY($2::text[])`,
      [clientId, chunk]
    ).catch((err) => {
      console.warn("[analyzeImportDuplicates] erro ao buscar nomes:", err?.message || err);
      return { rows: [] };
    });

    for (const lead of res.rows) {
      if (lead.nome) {
        existingByName.set(lead.nome.trim().toLowerCase(), lead);
      }
    }
  }

  // 4. Classificação das linhas e coleta de amostras
  let duplicatesByPhone = 0;
  let duplicatesByName = 0;
  let newCount = 0;
  const sampleDuplicates = [];
  const MAX_SAMPLES = 10;

  // Rastreamento para não duplicar contagem se uma mesma pessoa/telefone se repetir na própria planilha
  const seenPhones = new Set();
  const seenNames = new Set();

  for (const item of processedRows) {
    const { normPhone, cleanName } = item;

    let matchedExisting = null;
    let matchType = null;

    if (normPhone && existingByPhone.has(normPhone)) {
      matchedExisting = existingByPhone.get(normPhone);
      matchType = "phone";
    } else if (cleanName && existingByName.has(cleanName.toLowerCase())) {
      matchedExisting = existingByName.get(cleanName.toLowerCase());
      matchType = "name";
    }

    if (matchType === "phone") {
      duplicatesByPhone += 1;
      if (sampleDuplicates.length < MAX_SAMPLES && !seenPhones.has(normPhone)) {
        seenPhones.add(normPhone);
        const tags = Array.isArray(matchedExisting.tags)
          ? matchedExisting.tags
          : typeof matchedExisting.tags === "string"
          ? matchedExisting.tags.split(",").map((t) => t.trim()).filter(Boolean)
          : [];
        sampleDuplicates.push({
          nome: matchedExisting.nome || cleanName || "Lead sem nome",
          telefone: normPhone,
          existingTags: tags,
        });
      }
    } else if (matchType === "name") {
      duplicatesByName += 1;
      const lowerName = cleanName.toLowerCase();
      if (sampleDuplicates.length < MAX_SAMPLES && !seenNames.has(lowerName)) {
        seenNames.add(lowerName);
        const tags = Array.isArray(matchedExisting.tags)
          ? matchedExisting.tags
          : typeof matchedExisting.tags === "string"
          ? matchedExisting.tags.split(",").map((t) => t.trim()).filter(Boolean)
          : [];
        sampleDuplicates.push({
          nome: cleanName,
          telefone: normPhone || matchedExisting.telefone || "Sem telefone",
          existingTags: tags,
        });
      }
    } else {
      newCount += 1;
    }
  }

  return {
    totalRows: rows.length,
    newCount,
    duplicateCount: duplicatesByPhone + duplicatesByName,
    duplicatesByPhone,
    duplicatesByName,
    sampleDuplicates,
  };
}
