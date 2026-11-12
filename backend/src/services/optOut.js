// Opt-out: fonte única.
//
// A decisão "este número não recebe mais campanha nem robô" mora em public.lead_optouts, por empresa e telefone CANÔNICO
// (services/canonicalPhone.js). O pedido é do número, não da linha do lead: vale para lead duplicado, para conversa sem lead e
// sobrevive a exclusão e reimportação. Uma linha ativa por (client_id, phone): revogar NÃO apaga, grava revoked_at, e um
// novo pedido depois disso cria outra linha (o histórico fica).
//
// leads.opt_out / leads.metadata.opt_out são ESPELHO para a tela (o interruptor do dossiê lê o lead). Nenhum envio decide
// por eles enquanto a tabela está no formato novo.
//
// Schema velho (migration 20261112010000 ainda não aplicada): a leitura cai para o formato antigo da tabela e para a marca
// no lead, que era o que valia antes. A ESCRITA não tem atalho: falha alto, para ninguém achar que gravou.
//
// Erro de leitura que não seja de schema SOBE: quem chama trata como bloqueado nesta rodada, nunca como liberado.

import { SQL_CANONICAL_PHONE, SQL_CANONICAL_PHONE_SPELLINGS, toCanonicalPhone } from "./canonicalPhone.js";

export const OPTOUT_SOURCE_MANUAL = "manual";
export const OPTOUT_SOURCE_PALAVRA = "palavra";
export const OPTOUT_SOURCE_SEM_INTERESSE = "sem_interesse";
export const OPTOUT_SOURCE_MIGRACAO = "migracao";
export const OPTOUT_SOURCES = [OPTOUT_SOURCE_MANUAL, OPTOUT_SOURCE_PALAVRA, OPTOUT_SOURCE_SEM_INTERESSE, OPTOUT_SOURCE_MIGRACAO];

const SCHEMA_ERRORS = new Set(["42P01", "42703"]);
const MESSAGE_TEXT_MAX = 500;

const SQL_ATIVO = `
  SELECT EXISTS (
    SELECT 1 FROM public.lead_optouts o
     WHERE o.client_id = $1 AND o.phone = $2 AND o.revoked_at IS NULL
  ) AS hit`;

// Formato antigo: tabela sem revoked_at, telefone como veio.
const SQL_LEGADO_TABELA = `
  SELECT EXISTS (
    SELECT 1 FROM public.lead_optouts o
     WHERE o.client_id = $1 AND ${SQL_CANONICAL_PHONE("o.phone")} = $2
  ) AS hit`;

const SQL_LEGADO_FLAG = `
  SELECT EXISTS (
    SELECT 1 FROM public.leads l
     WHERE l.client_id = $1
       AND (l.opt_out IS TRUE OR l.metadata->>'opt_out' = 'true' OR l.dados->>'opt_out' = 'true')
       AND ${SQL_CANONICAL_PHONE("l.telefone")} = $2
  ) AS hit`;

const SQL_ESPELHO = `
  UPDATE public.leads
     SET opt_out = $3,
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('opt_out', $4::text),
         updated_at = now()
   WHERE client_id = $1
     AND telefone = ANY(${SQL_CANONICAL_PHONE_SPELLINGS("$2::text")})`;

function isSchemaError(err) {
  return SCHEMA_ERRORS.has(String(err?.code));
}

// Uma fonte do formato antigo. Tabela ou coluna ausente = fonte vazia; qualquer outro erro sobe.
async function lerLegado(pool, sql, params) {
  try {
    const { rows } = await pool.query(sql, params);
    return rows || [];
  } catch (err) {
    if (isSchemaError(err)) return [];
    throw err;
  }
}

function canonicalOrEmpty(phone) {
  const canonical = toCanonicalPhone(phone);
  // Grupo e @lid não são telefone: não têm opt-out.
  if (!canonical || canonical.includes("@")) return "";
  return canonical;
}

/**
 * Este telefone pediu para sair (e o pedido não foi revogado)?
 * Erro que não seja de schema SOBE: o chamador bloqueia nesta rodada, nunca libera.
 */
export async function isPhoneOptedOut(pool, { clientId, phone }) {
  const canonical = canonicalOrEmpty(phone);
  if (!pool || !clientId || !canonical) return false;
  try {
    const { rows } = await pool.query(SQL_ATIVO, [clientId, canonical]);
    return rows?.[0]?.hit === true;
  } catch (err) {
    if (!isSchemaError(err)) throw err;
  }
  const tabela = await lerLegado(pool, SQL_LEGADO_TABELA, [clientId, canonical]);
  if (tabela[0]?.hit === true) return true;
  const flag = await lerLegado(pool, SQL_LEGADO_FLAG, [clientId, canonical]);
  return flag[0]?.hit === true;
}

/**
 * Dos telefones dados, quantos estão em opt-out ativo na empresa? Serve só para AVISAR na prévia e na contagem de público
 * ("N serão pulados"): a lista não muda e a trava continua sendo a do envio.
 * Devolve null quando não dá para saber (schema velho ou erro de leitura): aviso que não se sabe não vira zero.
 */
export async function countOptedOutPhones(pool, { clientId, phones = [] }) {
  if (!pool || !clientId) return null;
  const canonicos = [...new Set((Array.isArray(phones) ? phones : []).map(canonicalOrEmpty).filter(Boolean))];
  if (canonicos.length === 0) return 0;
  try {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM public.lead_optouts o
        WHERE o.client_id = $1 AND o.revoked_at IS NULL AND o.phone = ANY($2::text[])`,
      [clientId, canonicos]
    );
    return Number(rows?.[0]?.n) || 0;
  } catch (err) {
    if (!isSchemaError(err)) console.error("[opt-out] falha ao contar opt-out do público (aviso omitido):", err?.code || "", err?.message || err);
    return null;
  }
}

// Espelho para a tela. Falha aqui não desfaz a decisão (que já está na tabela): só avisa.
async function espelharNoLead(pool, { clientId, canonical, optedOut }) {
  try {
    await pool.query(SQL_ESPELHO, [clientId, canonical, optedOut, optedOut ? "true" : "false"]);
  } catch (err) {
    console.warn("[opt-out] falha ao espelhar a marca no lead (a decisão está gravada em lead_optouts):", err?.code || "", err?.message || err);
  }
}

/**
 * Grava o pedido de saída. Idempotente: se já existe pedido ativo para o número, não cria outro.
 * Erro de escrita SOBE (inclusive schema velho): quem chama não pode achar que gravou.
 */
export async function registerOptOut(pool, { clientId, phone, source, reason = null, createdBy = null, waMessageId = null, messageText = null }) {
  const canonical = canonicalOrEmpty(phone);
  if (!pool || !clientId || !canonical) return { registered: false, alreadyActive: false, phone: null, reason: "invalid_target" };
  if (!OPTOUT_SOURCES.includes(source)) throw new Error(`[opt-out] origem inválida: ${source}`);
  const texto = messageText ? String(messageText).slice(0, MESSAGE_TEXT_MAX) : null;
  const { rows } = await pool.query(
    `INSERT INTO public.lead_optouts (client_id, phone, source, reason, created_by, wa_message_id, message_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (client_id, phone) WHERE revoked_at IS NULL DO NOTHING
     RETURNING id`,
    [clientId, canonical, source, reason, createdBy, waMessageId, texto]
  );
  await espelharNoLead(pool, { clientId, canonical, optedOut: true });
  const registered = (rows || []).length > 0;
  return { registered, alreadyActive: !registered, phone: canonical };
}

/**
 * Desfaz o pedido de saída sem apagar: grava revoked_at. O número volta a poder receber.
 */
export async function revokeOptOut(pool, { clientId, phone, revokedBy = null }) {
  const canonical = canonicalOrEmpty(phone);
  if (!pool || !clientId || !canonical) return { revoked: 0, phone: null };
  const { rows } = await pool.query(
    `UPDATE public.lead_optouts
        SET revoked_at = now(), revoked_by = $3
      WHERE client_id = $1 AND phone = $2 AND revoked_at IS NULL
      RETURNING id`,
    [clientId, canonical, revokedBy]
  );
  await espelharNoLead(pool, { clientId, canonical, optedOut: false });
  return { revoked: (rows || []).length, phone: canonical };
}
