// Correção dos leads que já estão marcados "Instagram Direct" por causa do padrão fabricado do importador
// de planilha (ver services/importOrigin.js). Mesma disciplina da exclusão em massa: prévia (só leitura)
// antes, execução depois, e a execução só roda se o número que o usuário viu ainda for o real.
//
// O que a execução corrige — só os DETERMINÁVEIS:
//   1. com identificador de importação (dados.import_ids) E a assinatura do importador de planilha;
//   2. sem identificador, mas com a assinatura E a tag de importação ao lado da tag "Instagram Direct".
// O que NÃO toca: lead do importador de Instagram de verdade, e os indetermináveis (a prévia diz quantos são).
//
// Assinatura do importador de planilha: dados.origem, dados.origem_marketing e dados.lead_source TODOS
// iguais a "Instagram Direct" (o importador de Instagram grava origem_marketing "instagram_export").

import { SYSTEM_TAGS } from "./leadMassDelete.js";
import { IMPORT_CHANNEL_RE, IMPORT_ORIGIN_KEY, IMPORT_ORIGIN_LABEL } from "./importOrigin.js";

export const FABRICATED_ORIGIN = "Instagram Direct";
export const TYPED_CONFIRMATION_THRESHOLD = 500;

export const ORIGIN_FIX_ERRORS = {
  COUNT_MISMATCH: "ORIGIN_FIX_COUNT_MISMATCH",
  CONFIRMATION_REQUIRED: "ORIGIN_FIX_CONFIRMATION_REQUIRED",
  INVALID_EXPECTED: "ORIGIN_FIX_INVALID_EXPECTED_COUNT",
  NOTHING_TO_FIX: "ORIGIN_FIX_NOTHING_TO_FIX",
};

const norm = (v) => (v === null || v === undefined ? "" : String(v).trim());
const isFabricated = (v) => norm(v) === FABRICATED_ORIGIN;
const isFabricatedTag = (t) => norm(t).toLowerCase() === FABRICATED_ORIGIN.toLowerCase();

function toArray(value) {
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

/** O lead veio do importador de Instagram de verdade? (é verdade ali: não se mexe) */
export function isFromInstagramImporter(lead) {
  return (
    norm(lead.origem_marketing) === "instagram_export" ||
    norm(lead.lead_source_column) === "instagram_export" ||
    norm(lead.lead_source_bruto) !== ""
  );
}

/** Os três campos de origem carregam a assinatura do importador de planilha. */
export function hasSpreadsheetSignature(lead) {
  return isFabricated(lead.origem) && isFabricated(lead.origem_marketing) && isFabricated(lead.lead_source);
}

/**
 * "Só a tag de importação": ao lado da tag "Instagram Direct" há ao menos uma tag de importação (que não é
 * do sistema nem de outro canal). Qualquer tag de canal ao lado deixa a origem ambígua → não determinável.
 */
export function hasImportTagBesideFabricated(lead) {
  const tags = toArray(lead.tags);
  if (!tags.some(isFabricatedTag)) return false;
  const others = tags.filter((t) => !isFabricatedTag(t));
  if (others.length === 0) return false;
  return others.every((t) => !SYSTEM_TAGS.has(t.toLowerCase()) && !IMPORT_CHANNEL_RE.test(t));
}

/**
 * Separa os leads com origem "Instagram Direct" em grupos MUTUAMENTE EXCLUSIVOS que somam `total`.
 * `instagramImporter` fica de fora do total (é Instagram de verdade) e vem separado, só para conferência.
 */
export function classifyOriginFix(leads) {
  const groups = { withImportId: [], onlyImportTag: [], undeterminable: [] };
  let instagramImporter = 0;

  for (const lead of leads) {
    if (!isFabricated(lead.origem)) continue;
    if (isFromInstagramImporter(lead)) {
      instagramImporter += 1;
      continue;
    }
    if (hasSpreadsheetSignature(lead) && toArray(lead.import_ids).length > 0) groups.withImportId.push(lead);
    else if (hasSpreadsheetSignature(lead) && hasImportTagBesideFabricated(lead)) groups.onlyImportTag.push(lead);
    else groups.undeterminable.push(lead);
  }

  const total = groups.withImportId.length + groups.onlyImportTag.length + groups.undeterminable.length;
  const correctable = groups.withImportId.length + groups.onlyImportTag.length;
  return { total, groups, correctable, instagramImporter };
}

export function requiresTypedConfirmation(count) {
  return Number(count) > TYPED_CONFIRMATION_THRESHOLD;
}

export function toOriginFixPreview(classified) {
  const { total, groups, correctable, instagramImporter } = classified;
  return {
    total,
    withImportId: groups.withImportId.length,
    onlyImportTag: groups.onlyImportTag.length,
    undeterminable: groups.undeterminable.length,
    correctable,
    instagramImporterUntouched: instagramImporter,
    willSet: { origem: IMPORT_ORIGIN_LABEL, origemMarketing: IMPORT_ORIGIN_KEY, leadSource: IMPORT_ORIGIN_KEY, removeTag: FABRICATED_ORIGIN },
    confirmation: { typedRequired: requiresTypedConfirmation(correctable), threshold: TYPED_CONFIRMATION_THRESHOLD },
  };
}

export async function selectOriginFix(repo, db, clientId) {
  return classifyOriginFix(await repo.listCandidates(db, clientId));
}

export async function previewOriginFix(repo, db, { clientId }) {
  return toOriginFixPreview(await selectOriginFix(repo, db, clientId));
}

/**
 * Execução: UMA transação — seleção, conferência do número visto na prévia, correção, auditoria, commit.
 * `{ ok: true, report }` ou `{ ok: false, code, message, details }` (nada foi alterado).
 */
export async function executeOriginFix(repo, pool, { clientId, expectedCount, typedConfirmation, actor }) {
  const expected = Number(expectedCount);
  if (!Number.isInteger(expected) || expected < 0 || expectedCount === null || expectedCount === undefined || expectedCount === "") {
    return {
      ok: false,
      code: ORIGIN_FIX_ERRORS.INVALID_EXPECTED,
      message: "Informe o número de leads corrigíveis que apareceu na prévia (expectedCount).",
      details: {},
    };
  }
  if (requiresTypedConfirmation(expected) && norm(typedConfirmation).replace(/\D/g, "") !== String(expected)) {
    return {
      ok: false,
      code: ORIGIN_FIX_ERRORS.CONFIRMATION_REQUIRED,
      message: `Acima de ${TYPED_CONFIRMATION_THRESHOLD} leads é preciso digitar o número (${expected}) para confirmar.`,
      details: { expected, threshold: TYPED_CONFIRMATION_THRESHOLD },
    };
  }

  await repo.ensureAuditTable(pool);
  const tx = await repo.begin(pool);
  try {
    const classified = await selectOriginFix(repo, tx, clientId);

    if (classified.correctable !== expected) {
      await repo.rollback(tx);
      return {
        ok: false,
        code: ORIGIN_FIX_ERRORS.COUNT_MISMATCH,
        message: `A contagem mudou: você viu ${expected} leads corrigíveis, mas agora são ${classified.correctable}. Nada foi alterado — revise a prévia e confirme de novo.`,
        details: { expected, actual: classified.correctable, preview: toOriginFixPreview(classified) },
      };
    }
    if (classified.correctable === 0) {
      await repo.rollback(tx);
      return { ok: false, code: ORIGIN_FIX_ERRORS.NOTHING_TO_FIX, message: "Não há leads determináveis a corrigir.", details: { preview: toOriginFixPreview(classified) } };
    }

    const toFix = [...classified.groups.withImportId, ...classified.groups.onlyImportTag];
    const ids = toFix.map((l) => l.id);
    const corrected = await repo.fixLeads(tx, clientId, ids);
    // O banco corrigiu exatamente o que a seleção contou? Senão, desfaz tudo.
    if (corrected !== ids.length) {
      throw new Error(`Correção inconsistente: esperado ${ids.length}, corrigidos ${corrected}. Transação desfeita.`);
    }

    const audit = await repo.insertAudit(tx, {
      clientId,
      userUid: actor?.uid || null,
      userEmail: actor?.email || null,
      expectedCount: expected,
      corrected,
      correctedWithImportId: classified.groups.withImportId.length,
      correctedOnlyImportTag: classified.groups.onlyImportTag.length,
      leftUndeterminable: classified.groups.undeterminable.length,
      leftInstagramImporter: classified.instagramImporter,
      leadIds: ids,
    });
    await repo.commit(tx);

    return {
      ok: true,
      report: {
        corrected,
        correctedWithImportId: classified.groups.withImportId.length,
        correctedOnlyImportTag: classified.groups.onlyImportTag.length,
        leftUndeterminable: classified.groups.undeterminable.length,
        leftInstagramImporter: classified.instagramImporter,
        audit: { id: audit?.id ?? null, at: audit?.created_at ?? null, byEmail: actor?.email || null },
      },
    };
  } catch (err) {
    await repo.rollback(tx).catch(() => {});
    throw err;
  }
}

// ── Repositório Postgres ────────────────────────────────────────────────────

/** Toda consulta filtra por `client_id = $1`: a correção de um cliente nunca alcança lead de outro. */
export function createPgOriginFixRepo() {
  let auditEnsured = false;
  return {
    async listCandidates(db, clientId) {
      const { rows } = await db.query(
        `SELECT id,
                tags,
                dados->>'origem' AS origem,
                dados->>'origem_marketing' AS origem_marketing,
                dados->>'lead_source' AS lead_source,
                dados->>'lead_source_bruto' AS lead_source_bruto,
                to_jsonb(l)->>'lead_source' AS lead_source_column,
                dados->'import_ids' AS import_ids
         FROM public.leads l
         WHERE client_id = $1 AND dados->>'origem' = $2`,
        [clientId, FABRICATED_ORIGIN]
      );
      return rows;
    },

    // Só altera quem AINDA está como "Instagram Direct" nos três campos: se alguém corrigiu à mão entre a
    // seleção e aqui, a linha não casa e a contagem confere falha (transação desfeita).
    async fixLeads(db, clientId, ids) {
      const res = await db.query(
        `UPDATE public.leads
         SET dados = COALESCE(dados, '{}'::jsonb)
                     || jsonb_build_object('origem', $3::text, 'origem_marketing', $4::text, 'lead_source', $4::text),
             tags = ARRAY(SELECT t FROM unnest(COALESCE(tags, ARRAY[]::text[])) AS t WHERE lower(btrim(t)) <> lower($5::text))
         WHERE client_id = $1
           AND id = ANY($2::uuid[])
           AND dados->>'origem' = $5 AND dados->>'origem_marketing' = $5 AND dados->>'lead_source' = $5`,
        [clientId, ids, IMPORT_ORIGIN_LABEL, IMPORT_ORIGIN_KEY, FABRICATED_ORIGIN]
      );
      return res.rowCount ?? 0;
    },

    async ensureAuditTable(pool) {
      if (auditEnsured) return;
      await pool.query(`
        CREATE TABLE IF NOT EXISTS public.lead_origin_fix_audit (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          client_id TEXT NOT NULL,
          user_uid TEXT,
          user_email TEXT,
          expected_count INTEGER NOT NULL,
          corrected INTEGER NOT NULL,
          corrected_with_import_id INTEGER NOT NULL DEFAULT 0,
          corrected_only_import_tag INTEGER NOT NULL DEFAULT 0,
          left_undeterminable INTEGER NOT NULL DEFAULT 0,
          left_instagram_importer INTEGER NOT NULL DEFAULT 0,
          lead_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE INDEX IF NOT EXISTS idx_lead_origin_fix_audit_client
          ON public.lead_origin_fix_audit (client_id, created_at DESC);
      `);
      auditEnsured = true;
    },

    async insertAudit(db, a) {
      const { rows } = await db.query(
        `INSERT INTO public.lead_origin_fix_audit
           (client_id, user_uid, user_email, expected_count, corrected, corrected_with_import_id, corrected_only_import_tag, left_undeterminable, left_instagram_importer, lead_ids)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
         RETURNING id, created_at`,
        [a.clientId, a.userUid, a.userEmail, a.expectedCount, a.corrected, a.correctedWithImportId, a.correctedOnlyImportTag, a.leftUndeterminable, a.leftInstagramImporter, JSON.stringify(a.leadIds)]
      );
      return rows[0];
    },

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
