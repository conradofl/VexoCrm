// Importação de planilha em LOTES (tela de Planilhas / Campanhas).
//
// O teto de 5.000 linhas existia porque o POST único fazia UM INSERT com todas as linhas e lead_import_items tem 9
// colunas gravadas: 65.535 parâmetros ÷ 9 = 7.281 linhas, o teto do Postgres. Tirar só o `if` trocaria a mensagem clara por
// um erro de bind em 7.281. Aqui não há teto de linhas: a tela abre a importação, manda lotes de até 500 linhas em
// sequência e fecha; o servidor grava em fatias de 500 (a mesma regra de leadUpsert.js) — o teto de parâmetros não aparece
// mais, e o teto POR REQUISIÇÃO é o tamanho do lote.
//
// Estados de lead_imports.status: 'incomplete' (aberta, ainda faltam linhas) → 'completed' (fechada, com os totais).
// Nunca existe planilha pela metade parecendo completa: a importação nasce 'incomplete' e só o fechamento a torna
// 'completed'. As anteriores a esta mudança são 'completed' (DEFAULT da coluna).
//
// Regra do schema (DIRETRIZES-IA.md §12): LEITORES (listagem, progresso) funcionam com o schema antigo (sem as colunas
// novas); o fluxo em lotes precisa das colunas e as garante em runtime (ADD COLUMN IF NOT EXISTS, espelho da migration
// 20261005120000). O caminho de um POST só (compatibilidade) NÃO usa as colunas novas: roda numa transação única.

import { normalizeHeaderKey, normalizeImportedLead as defaultNormalizeImportedLead, isImportedLeadEmpty as defaultIsImportedLeadEmpty } from "./leadImport.js";
import { normalizeString } from "../textNormalize.js";

/** Máximo de linhas por requisição de lote E tamanho da fatia de gravação (9 colunas × 500 = 4.500 parâmetros). */
export const IMPORT_BATCH_SIZE = 500;
export const IMPORT_STATUS_INCOMPLETE = "incomplete";
export const IMPORT_STATUS_COMPLETED = "completed";

export class ImportError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.name = "ImportError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ── regras de linha (as mesmas do POST único anterior) ───────────────────────────────────────────────────────────────
export function isRowHeader(row) {
  if (!row || typeof row !== "object") return false;
  const values = Object.values(row).map((val) =>
    String(val ?? "").trim().toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "")
  );
  const hasPhoneHeader = values.some((val) => ["telefone", "celular", "phone", "fone", "whatsapp", "number", "numero"].some((alias) => val.includes(alias)));
  const hasNameHeader = values.some((val) => ["nome", "name", "cliente", "contato", "lead", "responsavel"].some((alias) => val.includes(alias)));
  return hasPhoneHeader && hasNameHeader;
}

// Auto-detecção de colunas por cabeçalho e conteúdo. Lê só a PRIMEIRA linha (chaves) e as 10 primeiras (conteúdo): por isso
// a abertura da importação decide o mapeamento a partir de uma amostra e os lotes seguintes o reaproveitam.
export function detectImportColumns(rows) {
  const mapping = { telefone: null, nome: null, tipo_cliente: null, faixa_consumo: null, cidade: null, estado: null, status: null, data_hora: null, qualificacao: null };
  if (!Array.isArray(rows) || rows.length === 0) return mapping;
  const firstRow = rows[0];
  if (!firstRow || typeof firstRow !== "object") return mapping;
  const keys = Object.keys(firstRow);
  const aliasesMap = {
    telefone: ["telefone", "telefones", "fone", "fones", "celular", "celulares", "whatsapp", "whatsapps", "phone", "phones", "numero", "numeros", "numero_telefone", "numero_telefones", "telefone_whatsapp", "telefones_whatsapp"],
    nome: ["nome", "name", "cliente", "contato", "lead", "responsavel"],
    tipo_cliente: ["tipo_cliente", "tipo", "perfil", "segmento", "classificacao"],
    faixa_consumo: ["faixa_consumo", "consumo", "consumo_mensal", "valor_conta", "conta_de_energia", "ticket"],
    cidade: ["cidade", "city", "municipio"],
    estado: ["estado", "uf", "state"],
    status: ["status", "etapa", "situacao", "pipeline_status"],
    data_hora: ["data_hora", "data", "created_at", "data_de_cadastro", "timestamp"],
    qualificacao: ["qualificacao", "observacoes", "observacao", "resumo", "anotacoes", "notas", "descricao"],
  };
  for (const key of keys) {
    const normalizedKey = key.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    for (const [field, aliases] of Object.entries(aliasesMap)) {
      if (!mapping[field] && aliases.includes(normalizedKey)) mapping[field] = key;
    }
  }
  const sampleRows = rows.slice(0, 10);
  if (!mapping.telefone) {
    for (const key of keys) {
      let matches = 0;
      let total = 0;
      for (const row of sampleRows) {
        const value = String(row[key] ?? "").replace(/\D/g, "");
        if (value) {
          total += 1;
          if (value.length >= 8 && value.length <= 14) matches += 1;
        }
      }
      if (total > 0 && matches / total >= 0.6) {
        mapping.telefone = key;
        break;
      }
    }
  }
  if (!mapping.nome) {
    const unmappedKeys = keys.filter((k) => k !== mapping.telefone);
    for (const key of unmappedKeys) {
      let textMatches = 0;
      let total = 0;
      for (const row of sampleRows) {
        const value = String(row[key] ?? "").trim();
        if (value) {
          total += 1;
          if (/[a-zA-ZÀ-ÿ]/.test(value) && !/^\d+$/.test(value)) textMatches += 1;
        }
      }
      if (total > 0 && textMatches / total >= 0.6) {
        mapping.nome = key;
        break;
      }
    }
    if (!mapping.nome && unmappedKeys.length > 0) mapping.nome = unmappedKeys[0];
    else if (!mapping.nome && keys.length > 1) mapping.nome = keys[1] === mapping.telefone ? keys[0] : keys[1];
  }
  return mapping;
}

export function extractMappingItems(columnMapping) {
  if (Array.isArray(columnMapping)) return columnMapping;
  if (Array.isArray(columnMapping?.mapping)) return columnMapping.mapping;
  return null;
}

/**
 * Classificação do telefone para os totais da tela: "intact" (já vinha completo), "completed" (a rotina completou com DDD/DDI)
 * ou "missing" (sem telefone aproveitável). É a MESMA regra de phoneAuditStats em LeadImports.tsx (fixture compartilhada
 * shared/importPhoneAuditCases.json confere os dois lados).
 */
export function classifyImportedPhone(rawPhone, sanitized) {
  if (!sanitized) return "missing";
  const rawDigits = String(rawPhone ?? "").trim().replace(/\D/g, "");
  const alreadyComplete =
    (rawDigits.length === 12 && rawDigits.startsWith("55") && sanitized === rawDigits) ||
    (rawDigits.length === 13 && rawDigits.startsWith("55") && sanitized === rawDigits) ||
    (rawDigits.length >= 10 && rawDigits.length < 15 && !rawDigits.startsWith("55") && sanitized === rawDigits);
  return alreadyComplete ? "intact" : "completed";
}

/**
 * Transforma linhas CRUAS em itens a gravar. `numbering`:
 *  - "filtered" (POST único, como sempre foi): row_number = posição entre as linhas que NÃO são cabeçalho, + 2;
 *  - "original" (lotes): row_number = posição da linha no arquivo enviado + 2 — estável entre lotes, o que torna o
 *    reenvio de um lote idempotente por (import_id, row_number).
 * Linha de cabeçalho no meio dos dados é descartada nos dois casos (como antes).
 */
export function parseImportRows(rows, ctx) {
  const {
    clientId,
    defaultDdd = null,
    mappingItems = null,
    autoMapping = null,
    startIndex = 0,
    numbering = "original",
    normalizeImportedLead = defaultNormalizeImportedLead,
    isImportedLeadEmpty = defaultIsImportedLeadEmpty,
  } = ctx;
  const parsed = [];
  let filteredIndex = 0;
  rows.forEach((row, offset) => {
    if (isRowHeader(row)) return;
    const originalIndex = startIndex + offset;
    const enrichedRow = { ...row };
    if (!mappingItems && autoMapping) {
      if (autoMapping.telefone && !enrichedRow.telefone) enrichedRow.telefone = row[autoMapping.telefone];
      if (autoMapping.nome && !enrichedRow.nome) enrichedRow.nome = row[autoMapping.nome];
    }
    const normalized = normalizeImportedLead(enrichedRow, clientId, defaultDdd, mappingItems || null);
    const imported = !!normalized.telefone;
    const phoneMapping = mappingItems?.find((m) => m.target === "telefone");
    const rawPhone = phoneMapping ? String(row[phoneMapping.column] ?? "").trim() : String(enrichedRow.telefone ?? "").trim();
    const rawDigits = rawPhone.replace(/\D/g, "");
    const skipReason = imported
      ? null
      : isImportedLeadEmpty(normalized)
        ? "Linha vazia ou sem dados aproveitaveis"
        : (rawDigits.length === 8 || rawDigits.length === 9) && !defaultDdd
          ? "Telefone incompleto (faltou DDD)"
          : rawDigits.length >= 15 || rawPhone.includes("@g.us")
            ? "Identificador de grupo do WhatsApp bloqueado"
            : "Telefone ausente ou invalido";
    parsed.push({
      rowNumber: (numbering === "filtered" ? startIndex + filteredIndex : originalIndex) + 2,
      rawData: row,
      normalized,
      imported,
      skipReason,
      phoneClass: classifyImportedPhone(rawPhone, normalized.telefone),
    });
    filteredIndex += 1;
  });
  return parsed;
}

// ── banco ────────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function withTransaction(pool, fn) {
  if (typeof pool.connect === "function") {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch { /* conexão já perdida */ }
      throw err;
    } finally {
      client.release?.();
    }
  }
  // pool de uma conexão só (testes em Postgres embutido)
  await pool.query("BEGIN");
  try {
    const result = await fn(pool);
    await pool.query("COMMIT");
    return result;
  } catch (err) {
    await pool.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

let _batchColumnsEnsured = false;
export function resetLeadImportBatchStateForTest() {
  _batchColumnsEnsured = false;
}

/** Espelho em runtime da migration 20261005120000 (idempotente, memoizado por processo). */
export async function ensureLeadImportBatchColumns(pool) {
  if (_batchColumnsEnsured) return true;
  await pool.query(`
    ALTER TABLE public.lead_imports
      ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'completed',
      ADD COLUMN IF NOT EXISTS expected_rows INTEGER,
      ADD COLUMN IF NOT EXISTS received_offset INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS import_params JSONB,
      ADD COLUMN IF NOT EXISTS import_stats JSONB,
      ADD COLUMN IF NOT EXISTS fingerprint TEXT
  `);
  _batchColumnsEnsured = true;
  return true;
}

const ITEM_COLUMNS = "import_id, client_id, row_number, telefone, lead_id, imported, skip_reason, raw_data, normalized_data";

/**
 * Grava itens em fatias de IMPORT_BATCH_SIZE (9 colunas × 500 = 4.500 parâmetros, longe dos 65.535). Com
 * `skipExisting`, ignora o que já existe por (import_id, row_number) — o reenvio de um lote não duplica — e devolve só as
 * linhas NOVAS (para os totais não contarem duas vezes).
 */
export async function insertImportItems(db, { importId, clientId, items, skipExisting = false }) {
  const inserted = [];
  for (let start = 0; start < items.length; start += IMPORT_BATCH_SIZE) {
    const slice = items.slice(start, start + IMPORT_BATCH_SIZE);
    const params = [];
    const tuples = slice.map((item, i) => {
      const o = i * 9;
      params.push(importId, clientId, item.rowNumber, item.normalized.telefone ?? null, null, item.imported, item.skipReason ?? null, JSON.stringify(item.rawData ?? {}), JSON.stringify(item.normalized ?? {}));
      return `($${o + 1}::uuid, $${o + 2}::text, $${o + 3}::int, $${o + 4}::text, $${o + 5}::uuid, $${o + 6}::boolean, $${o + 7}::text, $${o + 8}::jsonb, $${o + 9}::jsonb)`;
    });
    const sql = skipExisting
      ? `INSERT INTO public.lead_import_items (${ITEM_COLUMNS})
         SELECT v.* FROM (VALUES ${tuples.join(", ")}) AS v(${ITEM_COLUMNS})
         WHERE NOT EXISTS (SELECT 1 FROM public.lead_import_items x WHERE x.import_id = v.import_id AND x.row_number = v.row_number)
         RETURNING row_number`
      : `INSERT INTO public.lead_import_items (${ITEM_COLUMNS}) VALUES ${tuples.join(", ")} RETURNING row_number`;
    const { rows } = await db.query(sql, params);
    for (const r of rows) inserted.push(Number(r.row_number));
  }
  return inserted;
}

const IMPORT_RETURN_FIELDS = "id, client_id, source_name, source_type, total_rows, imported_rows, skipped_rows, uploaded_by_uid, uploaded_by_email, created_at, column_mapping";

/** Campos personalizados do mapeamento: reaproveita o cadastrado (com aviso se o tipo divergir) ou cadastra o novo. */
async function planCustomFields(db, clientId, mappingItems) {
  const warnings = [];
  const toInsert = [];
  if (!Array.isArray(mappingItems)) return { warnings, toInsert };
  for (const item of mappingItems.filter((m) => m && m.target === "custom")) {
    const key = item.key || normalizeHeaderKey(item.label || item.column);
    const label = item.label || item.column;
    const detectedType = item.type || "text";
    const { rows } = await db.query("SELECT id, type FROM public.lead_custom_fields WHERE client_id = $1 AND key = $2 LIMIT 1", [clientId, key]);
    if (rows[0]) {
      if (rows[0].type !== detectedType) {
        warnings.push({
          column: item.column, label, key, detectedType, registeredType: rows[0].type,
          message: `A coluna '${item.column}' veio com valores do tipo '${detectedType}', mas o campo '${label}' já está cadastrado como '${rows[0].type}'. O tipo original foi mantido.`,
        });
      }
    } else {
      toInsert.push({ key, label, type: detectedType });
    }
  }
  return { warnings, toInsert };
}

async function insertCustomFields(db, clientId, importId, fields) {
  const seen = new Set();
  for (const field of fields) {
    if (seen.has(field.key)) continue;
    seen.add(field.key);
    await db.query(
      "INSERT INTO public.lead_custom_fields (client_id, key, label, type, import_id) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (client_id, key) DO NOTHING",
      [clientId, field.key, field.label, field.type, importId]
    );
  }
}

// ── 1. abrir ─────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function openLeadImport(pool, input) {
  const clientId = normalizeString(input.clientId);
  const sourceName = normalizeString(input.sourceName) || "planilha";
  const sourceType = normalizeString(input.sourceType) || "spreadsheet";
  const defaultDdd = normalizeString(input.defaultDdd) || null;
  const columnMapping = input.columnMapping || null;
  const mappingItems = extractMappingItems(columnMapping);
  const totalRows = Number(input.totalRows);

  if (!clientId) throw new ImportError(400, "INVALID_BODY", "Missing clientId");
  if (!Number.isInteger(totalRows) || totalRows < 1) throw new ImportError(400, "INVALID_BODY", "totalRows deve ser um inteiro maior que zero");

  await ensureLeadImportBatchColumns(pool);

  // sem mapeamento explícito, o mapeamento automático sai de uma AMOSTRA (a detecção só olha as primeiras linhas)
  const sample = Array.isArray(input.sampleRows) ? input.sampleRows.filter((r) => !isRowHeader(r)) : [];
  const autoMapping = mappingItems ? null : detectImportColumns(sample);

  return withTransaction(pool, async (db) => {
    const { warnings, toInsert } = await planCustomFields(db, clientId, mappingItems);
    const { rows } = await db.query(
      `INSERT INTO public.lead_imports
         (client_id, source_name, source_type, total_rows, imported_rows, skipped_rows, column_mapping, uploaded_by_uid, uploaded_by_email,
          status, expected_rows, received_offset, import_params, import_stats, fingerprint)
       VALUES ($1,$2,$3,0,0,0,$4::jsonb,$5,$6,'${IMPORT_STATUS_INCOMPLETE}',$7,0,$8::jsonb,$9::jsonb,$10)
       RETURNING ${IMPORT_RETURN_FIELDS}, status, expected_rows, received_offset, fingerprint`,
      [
        clientId, sourceName, sourceType, columnMapping ? JSON.stringify(columnMapping) : null,
        input.uploadedByUid || null, input.uploadedByEmail || null, totalRows,
        JSON.stringify({ defaultDdd, autoMapping, ...(input.importParams && typeof input.importParams === "object" ? input.importParams : {}) }), JSON.stringify({ valid: 0, intact: 0, completed: 0, missing: 0 }),
        input.fingerprint || null,
      ]
    );
    const item = rows[0];
    await insertCustomFields(db, clientId, item.id, toInsert);
    return { item, warnings, batchSize: IMPORT_BATCH_SIZE };
  });
}

async function loadImport(db, importId, clientId = null, forUpdate = false) {
  const { rows } = await db.query(
    `SELECT ${IMPORT_RETURN_FIELDS}, status, expected_rows, received_offset, import_params, import_stats, fingerprint
       FROM public.lead_imports WHERE id = $1 ${clientId ? "AND client_id = $2" : ""} ${forUpdate ? "FOR UPDATE" : ""}`,
    clientId ? [importId, clientId] : [importId]
  );
  return rows[0] || null;
}

/** Contexto da importação aberta (parâmetros guardados na abertura): quem decide o modo (planilha ou Banco) é o servidor, não o cliente. */
export async function getLeadImportContext(pool, { importId, clientId }) {
  await ensureLeadImportBatchColumns(pool);
  const imp = await loadImport(pool, importId, clientId);
  if (!imp) throw new ImportError(404, "IMPORT_NOT_FOUND", "Importação não encontrada");
  return { importId, clientId: imp.client_id, params: imp.import_params || {}, columnMapping: imp.column_mapping || null, status: imp.status };
}

/** Só o dono do registro: a rota autoriza o tenant a partir daqui. */
export async function findLeadImportOwner(pool, importId) {
  await ensureLeadImportBatchColumns(pool);
  const { rows } = await pool.query("SELECT client_id FROM public.lead_imports WHERE id = $1", [importId]);
  return rows[0]?.client_id || null;
}

// ── 2. enviar um lote ────────────────────────────────────────────────────────────────────────────────────────────────
export async function appendLeadImportBatch(pool, { importId, clientId, startIndex, rows, fingerprint = null, normalizeImportedLead, isImportedLeadEmpty }) {
  if (!Array.isArray(rows) || rows.length === 0) throw new ImportError(400, "INVALID_BODY", "O lote precisa ter pelo menos uma linha");
  if (rows.length > IMPORT_BATCH_SIZE) {
    throw new ImportError(413, "BATCH_TOO_LARGE", `Cada lote aceita no máximo ${IMPORT_BATCH_SIZE} linhas (recebeu ${rows.length}). Divida o envio em lotes de até ${IMPORT_BATCH_SIZE}.`);
  }
  const start = Number(startIndex);
  if (!Number.isInteger(start) || start < 0) throw new ImportError(400, "INVALID_BODY", "startIndex deve ser um inteiro maior ou igual a zero");

  await ensureLeadImportBatchColumns(pool);

  return withTransaction(pool, async (db) => {
    // um lote por vez por importação: duas requisições simultâneas do mesmo lote não duplicam nem se atropelam
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`lead-import:${importId}`]);
    const imp = await loadImport(db, importId, clientId, true);
    if (!imp) throw new ImportError(404, "IMPORT_NOT_FOUND", "Importação não encontrada");
    if (imp.status === IMPORT_STATUS_COMPLETED) throw new ImportError(409, "IMPORT_ALREADY_COMPLETED", "Esta importação já foi concluída");
    if (fingerprint && imp.fingerprint && fingerprint !== imp.fingerprint) {
      throw new ImportError(409, "IMPORT_FILE_MISMATCH", "O arquivo enviado não é o mesmo da importação aberta");
    }
    if (start + rows.length > Number(imp.expected_rows)) {
      throw new ImportError(400, "INVALID_BODY", `O lote passa do total esperado (${imp.expected_rows} linhas)`);
    }

    const params = imp.import_params || {};
    const items = parseImportRows(rows, {
      clientId: imp.client_id,
      defaultDdd: params.defaultDdd || null,
      mappingItems: extractMappingItems(imp.column_mapping),
      autoMapping: params.autoMapping || null,
      startIndex: start,
      numbering: "original",
      normalizeImportedLead,
      isImportedLeadEmpty,
    });

    const newRowNumbers = new Set(await insertImportItems(db, { importId, clientId: imp.client_id, items, skipExisting: true }));
    const stats = { ...(imp.import_stats || { valid: 0, intact: 0, completed: 0, missing: 0 }) };
    for (const item of items) {
      if (!newRowNumbers.has(item.rowNumber)) continue; // já estava gravado: não conta duas vezes
      if (item.phoneClass === "missing") stats.missing += 1;
      else {
        stats.valid += 1;
        stats[item.phoneClass] += 1;
      }
    }
    const receivedOffset = Math.max(Number(imp.received_offset), start + rows.length);
    await db.query("UPDATE public.lead_imports SET received_offset = $2, import_stats = $3::jsonb WHERE id = $1", [importId, receivedOffset, JSON.stringify(stats)]);

    return {
      importId,
      accepted: rows.length,
      stored: newRowNumbers.size,
      duplicatesIgnored: items.length - newRowNumbers.size,
      headersDropped: rows.length - items.length,
      receivedOffset,
      expectedRows: Number(imp.expected_rows),
    };
  });
}

// ── progresso (retomada) ─────────────────────────────────────────────────────────────────────────────────────────────
export async function getLeadImportProgress(pool, { importId, clientId }) {
  await ensureLeadImportBatchColumns(pool);
  const imp = await loadImport(pool, importId, clientId);
  if (!imp) throw new ImportError(404, "IMPORT_NOT_FOUND", "Importação não encontrada");
  const { rows } = await pool.query("SELECT count(*)::int AS n FROM public.lead_import_items WHERE import_id = $1", [importId]);
  const expected = imp.expected_rows == null ? null : Number(imp.expected_rows);
  return {
    importId,
    status: imp.status,
    expectedRows: expected,
    receivedOffset: Number(imp.received_offset),
    missingRows: expected == null ? 0 : Math.max(expected - Number(imp.received_offset), 0),
    storedItems: rows[0].n,
    fingerprint: imp.fingerprint || null,
    batchSize: IMPORT_BATCH_SIZE,
  };
}

// ── 3. fechar ────────────────────────────────────────────────────────────────────────────────────────────────────────
export async function closeLeadImport(pool, { importId, clientId }) {
  await ensureLeadImportBatchColumns(pool);
  return withTransaction(pool, async (db) => {
    await db.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`lead-import:${importId}`]);
    const imp = await loadImport(db, importId, clientId, true);
    if (!imp) throw new ImportError(404, "IMPORT_NOT_FOUND", "Importação não encontrada");

    const totalsFrom = async () => {
      const { rows } = await db.query(
        `SELECT count(*)::int AS total,
                count(DISTINCT telefone) FILTER (WHERE imported)::int AS unique_phones
           FROM public.lead_import_items WHERE import_id = $1`,
        [importId]
      );
      const stats = imp.import_stats || { valid: 0, intact: 0, completed: 0, missing: 0 };
      return {
        total: rows[0].total,
        valid: stats.valid,
        intact: stats.intact,
        completedWithDdd: stats.completed,
        withoutPhone: stats.missing,
        uniquePhones: rows[0].unique_phones,
      };
    };

    if (imp.status === IMPORT_STATUS_COMPLETED) {
      const { rows: previewRows } = await db.query("SELECT row_number, imported, skip_reason, normalized_data FROM public.lead_import_items WHERE import_id = $1 ORDER BY row_number LIMIT 10", [importId]);
      return { item: imp, totals: await totalsFrom(), preview: previewRows.map(previewRowToPreview), alreadyCompleted: true };
    }

    const expected = Number(imp.expected_rows);
    if (Number(imp.received_offset) < expected) {
      throw new ImportError(409, "IMPORT_INCOMPLETE", `Faltam ${expected - Number(imp.received_offset)} de ${expected} linhas; a importação continua incompleta.`, {
        receivedOffset: Number(imp.received_offset), expectedRows: expected, missingRows: expected - Number(imp.received_offset),
      });
    }

    const totals = await totalsFrom();
    const importedRows = totals.uniquePhones;
    const skippedRows = totals.total - importedRows;
    const { rows } = await db.query(
      `UPDATE public.lead_imports SET status = '${IMPORT_STATUS_COMPLETED}', total_rows = $2, imported_rows = $3, skipped_rows = $4
        WHERE id = $1 RETURNING ${IMPORT_RETURN_FIELDS}, status, expected_rows, received_offset, fingerprint`,
      [importId, totals.total, importedRows, skippedRows]
    );
    const { rows: previewRows } = await db.query("SELECT row_number, imported, skip_reason, normalized_data FROM public.lead_import_items WHERE import_id = $1 ORDER BY row_number LIMIT 10", [importId]);
    return { item: rows[0], totals, preview: previewRows.map(previewRowToPreview), alreadyCompleted: false };
  });
}

function previewRowToPreview(r) {
  const n = r.normalized_data || {};
  return { rowNumber: Number(r.row_number), telefone: n.telefone, nome: n.nome, cidade: n.cidade, status: n.status, imported: r.imported, skipReason: r.skip_reason };
}

// ── leitura da lista (tolerante ao schema antigo) ────────────────────────────────────────────────────────────────────────
export async function listLeadImports(pool, clientId, limit = 20, { includeReconstructed = false } = {}) {
  const base = "id, client_id, source_name, source_type, total_rows, imported_rows, skipped_rows, uploaded_by_uid, uploaded_by_email, created_at, column_mapping";
  const extended = `${base}, status, expected_rows, received_offset`;
  try {
    await ensureLeadImportBatchColumns(pool);
  } catch (err) {
    console.warn("[lead-imports] não foi possível garantir as colunas de importação em lotes; listando com o schema atual:", err?.message || err);
  }
  try {
    // As importações RECONSTRUÍDAS (sem itens nem dados brutos) não são fonte de campanha na tela de Planilhas: só o seletor do Banco as lista.
    const where = includeReconstructed ? "" : " AND source_type <> 'reconstruida'";
    const { rows } = await pool.query(`SELECT ${extended} FROM public.lead_imports WHERE client_id = $1${where} ORDER BY created_at DESC LIMIT $2`, [clientId, limit]);
    return rows;
  } catch (err) {
    if (err?.code !== "42703") throw err; // coluna inexistente: schema antigo — lista como sempre foi (tudo 'completed')
    const where = includeReconstructed ? "" : " AND source_type <> 'reconstruida'";
    const { rows } = await pool.query(`SELECT ${base} FROM public.lead_imports WHERE client_id = $1${where} ORDER BY created_at DESC LIMIT $2`, [clientId, limit]);
    return rows.map((r) => ({ ...r, status: IMPORT_STATUS_COMPLETED, expected_rows: null, received_offset: 0 }));
  }
}
