// backend/src/services/leadMassDelete.js
//
// EXCLUSÃO EM MASSA DE LEADS — por tag ou por identificador de importação.
//
// Operação irreversível. Este módulo é mais sobre o que IMPEDIR do que sobre o que fazer:
//
//  1. PRÉVIA e EXECUÇÃO usam a MESMA função de seleção (selectMassDeleteTargets) e o mesmo critério:
//     o número que o usuário vê é, por construção, o número que a execução calcula.
//  2. A execução recebe o número visto na prévia. Se a contagem real divergir, RECUSA: entre ver e
//     confirmar uma importação pode ter rodado, e o usuário apagaria mais do que viu.
//  3. Por padrão NÃO se apaga: lead de mais de uma importação (pertence também a outro lote) nem lead
//     que já trocou mensagem (tem histórico, não é lixo de importação). Cada exceção é uma opção
//     desligada por padrão, e os dois números aparecem na prévia, nomeados.
//  4. Acima de 500 leads, a execução exige o número digitado (no servidor, não só no botão).
//  5. Tudo roda em UMA transação e a auditoria (quem, critério, quantidade, quando) é gravada nela: não
//     existe exclusão sem rastro.
//  6. Todo SQL é escopado por client_id. Critério de um cliente nunca alcança lead de outro.
//
// A camada de banco é um "repositório" injetável (createPgMassDeleteRepo): a regra de negócio abaixo é
// pura e testável sem Postgres.

import { SQL_CANONICAL_PHONE, toCanonicalPhone } from "./canonicalPhone.js";

/** Acima disso o usuário precisa digitar o número para confirmar. */
export const TYPED_CONFIRMATION_THRESHOLD = 500;
export const MAX_CRITERION_VALUE_LENGTH = 200;
const DELETE_CHUNK_SIZE = 2000;

// Tags que o SISTEMA aplica (origem padrão da importação, venda fechada, classificação da IA, atalhos).
// Qualquer OUTRA tag no lead pode ser de outra importação (ou manual): como não existe registro de
// quais tags são "de importação", a regra é conservadora — na dúvida, o lead fica.
export const SYSTEM_TAGS = new Set(
  [
    "instagram direct",
    "importação vendas fechadas",
    "venda fechada",
    "cliente histórico",
    "whatsapp wa",
    "agenda-whatsapp",
    "ia direct/chat",
    "fechamento",
    "orçamento",
    "dúvida",
    "não convertido",
    "óculos de sol",
    "prótese",
    "energia solar",
    "prioridade alta",
    "follow-up",
    "campanha",
  ].map((t) => t.toLowerCase())
);
const ORIGIN_TAG_RE = /instagram|facebook|linkedin|tiktok|direct|messenger/i;

export const CRITERION_TYPES = ["tag", "import"];

const norm = (v) => (v === null || v === undefined ? "" : String(v).trim());

/** Valida e normaliza o critério. `{type: "tag"|"import", value}`. */
export function normalizeCriterion(raw) {
  const type = norm(raw?.type);
  const value = norm(raw?.value);
  if (!CRITERION_TYPES.includes(type)) {
    return { ok: false, message: "Critério inválido: informe type 'tag' ou 'import'." };
  }
  if (!value) {
    return { ok: false, message: "Critério inválido: informe a tag ou o identificador da importação." };
  }
  if (value.length > MAX_CRITERION_VALUE_LENGTH) {
    return { ok: false, message: "Critério inválido: valor longo demais." };
  }
  return { ok: true, criterion: { type, value } };
}

/** As exceções são opt-in: só `true` liga. Qualquer outra coisa (ausente, "true", 1) fica desligada. */
export function normalizeOptions(raw) {
  return {
    includeMultiImport: raw?.includeMultiImport === true,
    includeWithMessages: raw?.includeWithMessages === true,
  };
}

export const requiresTypedConfirmation = (count) => Number(count) > TYPED_CONFIRMATION_THRESHOLD;

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map(norm).filter(Boolean);
  if (typeof tags === "string") return tags.split(",").map(norm).filter(Boolean);
  return [];
}

function normalizeImportIds(value) {
  if (Array.isArray(value)) return value.map(norm).filter(Boolean);
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(norm).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * O lead também pertence a OUTRA importação?
 *  - critério por importação: exato — o lead lista outro identificador em import_ids;
 *  - critério por tag: o lead tem alguma tag que não é a do critério nem do sistema, OU lista mais de
 *    um identificador de importação.
 */
export function hasOtherImport(lead, criterion) {
  const importIds = normalizeImportIds(lead.import_ids);
  if (criterion.type === "import") {
    return importIds.some((id) => id !== criterion.value);
  }
  if (importIds.length > 1) return true;
  const target = criterion.value.toLowerCase();
  return normalizeTags(lead.tags).some((t) => {
    const lower = t.toLowerCase();
    return lower !== target && !SYSTEM_TAGS.has(lower) && !ORIGIN_TAG_RE.test(t);
  });
}

/** O lead já trocou mensagem? Por lead_id ou pelo telefone canônico (mensagens ligam por telefone). */
export function hasMessages(lead, messageKeys) {
  if (messageKeys.leadIds.has(String(lead.id))) return true;
  const phone = toCanonicalPhone(lead.telefone || lead.phone);
  return Boolean(phone) && messageKeys.phones.has(phone);
}

/**
 * Regra de seleção — PURA. Recebe os candidatos (leads que batem com o critério, do cliente) e as
 * chaves de mensagens, e separa o que será apagado do que fica, com o motivo.
 */
export function classifyTargets({ candidates, messageKeys, criterion, options }) {
  let multiImport = 0;
  let withMessages = 0;
  let both = 0;
  let keptOnlyMulti = 0;
  let keptOnlyMessages = 0;
  let keptBoth = 0;
  const deletable = [];

  for (const lead of candidates) {
    const multi = hasOtherImport(lead, criterion);
    const msgs = hasMessages(lead, messageKeys);
    if (multi) multiImport += 1;
    if (msgs) withMessages += 1;
    if (multi && msgs) both += 1;

    const keepMulti = multi && !options.includeMultiImport;
    const keepMsgs = msgs && !options.includeWithMessages;
    if (keepMulti && keepMsgs) keptBoth += 1;
    else if (keepMulti) keptOnlyMulti += 1;
    else if (keepMsgs) keptOnlyMessages += 1;
    else deletable.push(lead);
  }

  const matched = candidates.length;
  return {
    matched,
    multiImport,
    withMessages,
    both,
    willDelete: deletable.length,
    kept: matched - deletable.length,
    // grupos de quem fica, EXCLUSIVOS: somam `kept`
    keptReasons: { multiImport: keptOnlyMulti, withMessages: keptOnlyMessages, both: keptBoth },
    deletable,
  };
}

/**
 * Seleção única — chamada pela prévia, pela execução e pela exportação. É esta função que garante
 * que "o que vi" e "o que será apagado" são a mesma coisa.
 */
export async function selectMassDeleteTargets(repo, db, { clientId, criterion, options }) {
  const candidates = await repo.listCandidates(db, clientId, criterion);
  const messageKeys = await repo.listMessageKeys(db, clientId);
  return classifyTargets({ candidates, messageKeys, criterion, options });
}

/** O que a tela vê: números, sem os leads. */
export function toPreview(selection) {
  const { matched, multiImport, withMessages, both, willDelete, kept, keptReasons } = selection;
  return {
    matched,
    multiImport,
    withMessages,
    both,
    willDelete,
    kept,
    keptReasons,
    confirmation: { typedRequired: requiresTypedConfirmation(willDelete), threshold: TYPED_CONFIRMATION_THRESHOLD },
  };
}

export async function previewMassDelete(repo, db, { clientId, criterion, options }) {
  return toPreview(await selectMassDeleteTargets(repo, db, { clientId, criterion, options }));
}

/** CSV dos leads que SERIAM apagados (mesma seleção). Protege contra injeção de fórmula em planilha. */
export function buildDeletableCsv(deletable) {
  const header = ["nome", "telefone", "tags", "estagio", "temperatura", "criado_em", "id"];
  const cell = (v) => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
  };
  const lines = deletable.map((l) =>
    [
      l.nome,
      l.telefone || l.phone,
      normalizeTags(l.tags).join("; "),
      l.stage,
      l.temperature,
      l.created_at instanceof Date ? l.created_at.toISOString() : l.created_at,
      l.id,
    ]
      .map(cell)
      .join(",")
  );
  // BOM: o Excel abre acentuação em UTF-8 corretamente
  return `﻿${header.map(cell).join(",")}\n${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

export const MASS_DELETE_ERRORS = {
  COUNT_MISMATCH: "MASS_DELETE_COUNT_MISMATCH",
  CONFIRMATION_REQUIRED: "MASS_DELETE_CONFIRMATION_REQUIRED",
  INVALID_EXPECTED: "MASS_DELETE_INVALID_EXPECTED_COUNT",
  NOTHING_TO_DELETE: "MASS_DELETE_NOTHING_TO_DELETE",
};

/**
 * Execução. UMA transação: seleção → conferência do número → exclusão → auditoria → commit.
 * Devolve `{ ok: true, report }` ou `{ ok: false, code, message, details }` (nada foi apagado).
 */
export async function executeMassDelete(repo, pool, { clientId, criterion, options, expectedCount, typedConfirmation, actor }) {
  const expected = Number(expectedCount);
  if (!Number.isInteger(expected) || expected < 0 || expectedCount === null || expectedCount === undefined || expectedCount === "") {
    return {
      ok: false,
      code: MASS_DELETE_ERRORS.INVALID_EXPECTED,
      message: "Informe o número de leads que apareceu na prévia (expectedCount).",
      details: {},
    };
  }
  // Confirmação digitada: exigida NO SERVIDOR (o botão desabilitado da tela não protege ninguém da API).
  if (requiresTypedConfirmation(expected) && norm(typedConfirmation).replace(/\D/g, "") !== String(expected)) {
    return {
      ok: false,
      code: MASS_DELETE_ERRORS.CONFIRMATION_REQUIRED,
      message: `Acima de ${TYPED_CONFIRMATION_THRESHOLD} leads é preciso digitar o número (${expected}) para confirmar.`,
      details: { expected, threshold: TYPED_CONFIRMATION_THRESHOLD },
    };
  }

  await repo.ensureAuditTable(pool);
  const tx = await repo.begin(pool);
  try {
    const selection = await selectMassDeleteTargets(repo, tx, { clientId, criterion, options });

    if (selection.willDelete !== expected) {
      await repo.rollback(tx);
      return {
        ok: false,
        code: MASS_DELETE_ERRORS.COUNT_MISMATCH,
        message: `A contagem mudou: você viu ${expected} leads, mas agora são ${selection.willDelete}. Nada foi apagado — revise a prévia e confirme de novo.`,
        details: { expected, actual: selection.willDelete, preview: toPreview(selection) },
      };
    }
    if (selection.willDelete === 0) {
      await repo.rollback(tx);
      return { ok: false, code: MASS_DELETE_ERRORS.NOTHING_TO_DELETE, message: "Não há leads a apagar com este critério.", details: { preview: toPreview(selection) } };
    }

    const ids = selection.deletable.map((l) => l.id);
    let deleted = 0;
    for (let i = 0; i < ids.length; i += DELETE_CHUNK_SIZE) {
      deleted += await repo.deleteLeads(tx, clientId, ids.slice(i, i + DELETE_CHUNK_SIZE));
    }
    // O banco apagou exatamente o que a seleção contou? Senão, desfaz tudo.
    if (deleted !== ids.length) {
      throw new Error(`Exclusão inconsistente: esperado ${ids.length}, apagados ${deleted}. Transação desfeita.`);
    }

    const audit = await repo.insertAudit(tx, {
      clientId,
      userUid: actor?.uid || null,
      userEmail: actor?.email || null,
      criterion,
      options,
      matched: selection.matched,
      expectedCount: expected,
      deleted,
      kept: selection.kept,
      keptMultiImport: selection.keptReasons.multiImport,
      keptWithMessages: selection.keptReasons.withMessages,
      keptBoth: selection.keptReasons.both,
    });
    await repo.commit(tx);

    return {
      ok: true,
      report: {
        matched: selection.matched,
        deleted,
        kept: selection.kept,
        keptReasons: selection.keptReasons,
        options,
        criterion,
        audit: { id: audit?.id ?? null, at: audit?.created_at ?? null, byEmail: actor?.email || null },
      },
    };
  } catch (err) {
    await repo.rollback(tx).catch(() => {});
    throw err;
  }
}

// ── Repositório Postgres ────────────────────────────────────────────────────

const CANON_PHONE_LM = SQL_CANONICAL_PHONE("lm.phone");

/**
 * Toda consulta daqui filtra por `client_id = $1`. É a barreira entre tenants: o critério de um
 * cliente nunca alcança lead de outro, mesmo que as tags tenham o mesmo nome.
 */
export function createPgMassDeleteRepo() {
  let auditEnsured = false;
  return {
    async listCandidates(db, clientId, criterion) {
      const where =
        criterion.type === "tag"
          ? `tags @> ARRAY[$2]::text[]`
          : `dados @> jsonb_build_object('import_ids', jsonb_build_array($2::text))`;
      const { rows } = await db.query(
        `SELECT id, nome, telefone, phone, tags, stage, temperature, created_at, dados->'import_ids' AS import_ids
         FROM public.leads
         WHERE client_id = $1 AND ${where}`,
        [clientId, criterion.value]
      );
      return rows;
    },

    async listMessageKeys(db, clientId) {
      const byLead = await db.query(
        `SELECT DISTINCT lead_id::text AS k FROM public.lead_messages WHERE client_id = $1 AND lead_id IS NOT NULL`,
        [clientId]
      );
      const byPhone = await db.query(
        `SELECT DISTINCT ${CANON_PHONE_LM} AS p
         FROM public.lead_messages lm
         WHERE lm.client_id = $1 AND lm.phone IS NOT NULL AND lm.phone <> ''`,
        [clientId]
      );
      return {
        leadIds: new Set(byLead.rows.map((r) => String(r.k))),
        phones: new Set(byPhone.rows.map((r) => String(r.p)).filter(Boolean)),
      };
    },

    async deleteLeads(db, clientId, ids) {
      const res = await db.query(`DELETE FROM public.leads WHERE client_id = $1 AND id = ANY($2::uuid[])`, [clientId, ids]);
      return res.rowCount ?? 0;
    },

    async listTags(db, clientId) {
      const { rows } = await db.query(
        `SELECT t AS tag, COUNT(*)::int AS leads
         FROM public.leads l, unnest(COALESCE(l.tags, ARRAY[]::text[])) AS t
         WHERE l.client_id = $1 AND t <> ''
         GROUP BY t
         ORDER BY COUNT(*) DESC, t ASC
         LIMIT 500`,
        [clientId]
      );
      return rows;
    },

    async ensureAuditTable(pool) {
      if (auditEnsured) return;
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.lead_mass_delete_audit (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id TEXT NOT NULL,
          user_uid TEXT,
          user_email TEXT,
          criterion JSONB NOT NULL,
          options JSONB NOT NULL,
          matched INTEGER NOT NULL,
          expected_count INTEGER NOT NULL,
          deleted INTEGER NOT NULL,
          kept INTEGER NOT NULL,
          kept_multi_import INTEGER NOT NULL DEFAULT 0,
          kept_with_messages INTEGER NOT NULL DEFAULT 0,
          kept_both INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_lead_mass_delete_audit_client
          ON public.lead_mass_delete_audit (client_id, created_at DESC);
      `);
      auditEnsured = true;
    },

    async insertAudit(db, a) {
      const { rows } = await db.query(
        `INSERT INTO public.lead_mass_delete_audit
           (client_id, user_uid, user_email, criterion, options, matched, expected_count, deleted, kept, kept_multi_import, kept_with_messages, kept_both)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9, $10, $11, $12)
         RETURNING id, created_at`,
        [
          a.clientId,
          a.userUid,
          a.userEmail,
          JSON.stringify(a.criterion),
          JSON.stringify(a.options),
          a.matched,
          a.expectedCount,
          a.deleted,
          a.kept,
          a.keptMultiImport,
          a.keptWithMessages,
          a.keptBoth,
        ]
      );
      return rows[0];
    },

    // REPEATABLE READ: a contagem e a exclusão veem o MESMO retrato do banco. Uma importação que
    // rode no meio não entra na exclusão; se mexer numa linha que vamos apagar, a transação falha
    // (serialização) e nada é apagado.
    async begin(pool) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      } catch (err) {
        client.release();
        throw err;
      }
      return client;
    },
    async commit(client) {
      try {
        await client.query("COMMIT");
      } finally {
        client.release();
      }
    },
    async rollback(client) {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    },
  };
}
