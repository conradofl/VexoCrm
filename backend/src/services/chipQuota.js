// backend/src/services/chipQuota.js
// Maquinaria de cota diária por chip (Evolution Instance Daily Usage)
// Anti-ban: cota compartilhada entre campanhas e cadências de follow-up.
//
// Unidade: 1 unidade de cota = 1 MENSAGEM enviada pelo chip (follow-up e campanha medem igual).
// O contador NÃO é o total de mensagens que o chip manda: resposta do chatbot, mensagem manual do inbox e envio
// do módulo GD não reservam cota (decisão de 04/10/2026: natureza diferente, fora de escopo). Quem lê
// "enviados hoje" lê só o que passou por reserveChipDailyQuota (follow-up + disparos de campanha).
//
// Tipo da coluna: instance_id é TEXT, em todo banco. Houve dois criadores (este e services/evolution.js, que a
// criava como UUID) e cada leitor assumia um tipo — um dos dois sempre quebrava. A tabela e a conversão para TEXT
// moram SÓ na migration 20261004130000 (aplicada em produção). Desde o untangle (DDL de runtime, 25/11/2026) este
// módulo não cria nem converte nada: era DDL com lock exclusivo no caminho do envio.

import { pgDatabasePool } from "./database.js";
import { normalizeString } from "../textNormalize.js";

export const EVOLUTION_CHIP_DAILY_QUOTA_DEFAULTS = { cold: 50, warm: 500 };

let _customPool = null;

export function setChipQuotaDbPool(pool) {
  _customPool = pool;
}

export function resetChipQuotaStateForTest() {
  _customPool = null;
}

function getDb(customPool = null) {
  if (customPool) return customPool;
  if (_customPool) return _customPool;
  if (pgDatabasePool) return pgDatabasePool;
  return null;
}

// Esquema na migration 20261004130000 (tabela + instance_id TEXT). Mantidas para quem já chama: só dizem se há banco.
export async function ensureEvolutionInstanceDailyUsageTable(pool = null) {
  return Boolean(getDb(pool));
}

export const ensureEvolutionInstanceDailyUsableTable = ensureEvolutionInstanceDailyUsageTable;

export async function ensureTolerant(db) {
  return Boolean(db);
}

export function resolveChipDailyLimit(instance) {
  const override = Number.parseInt(String(instance?.daily_limit_override ?? ""), 10);
  if (Number.isInteger(override) && override > 0) return override;
  const state = (normalizeString(instance?.chip_state) || "").toLowerCase() === "warm" ? "warm" : "cold";
  return EVOLUTION_CHIP_DAILY_QUOTA_DEFAULTS[state];
}

// Tolerante ao tipo da coluna: `$1` SEM cast no INSERT (o Postgres infere uuid ou text pela própria coluna), e
// `instance_id::text = $1::text` nas consultas. Com `$1::text` o INSERT em coluna uuid estoura ("is of type uuid but
// expression is of type text") — foi o que quebrou toda reserva depois de 01/09.
// `count` mensagens de uma vez (um lead com 3 passos reserva 3). Devolve o total do dia DEPOIS da reserva.
export async function reserveChipDailyQuota(instanceId, dateStr = null, pool = null, count = 1) {
  const db = getDb(pool);
  if (!instanceId || !db) return null;
  await ensureTolerant(db);
  const n = Number.isInteger(count) && count > 0 ? count : 1;
  const targetDate = dateStr || new Date().toISOString().slice(0, 10);
  const { rows } = await db.query(
    `
      INSERT INTO public.evolution_instance_daily_usage (instance_id, date, sent_count)
      VALUES ($1, $2::date, $3::int)
      ON CONFLICT (instance_id, date)
      DO UPDATE SET sent_count = public.evolution_instance_daily_usage.sent_count + $3::int
      RETURNING sent_count
    `,
    [String(instanceId), targetDate, n]
  );
  return rows[0]?.sent_count ?? null;
}

export async function getChipDailyUsage(instanceId, dateStr = null, pool = null) {
  const db = getDb(pool);
  if (!instanceId || !db) return 0;
  await ensureTolerant(db);
  const targetDate = dateStr || new Date().toISOString().slice(0, 10);
  const { rows } = await db.query(
    `SELECT sent_count FROM public.evolution_instance_daily_usage WHERE instance_id::text = $1::text AND date = $2::date`,
    [String(instanceId), targetDate]
  );
  return Number(rows[0]?.sent_count ?? 0);
}

export async function releaseChipDailyQuota(instanceId, dateStr = null, pool = null, count = 1) {
  const db = getDb(pool);
  if (!instanceId || !db) return;
  const n = Number.isInteger(count) && count > 0 ? count : 1;
  const targetDate = dateStr || new Date().toISOString().slice(0, 10);
  await db
    .query(
      `
        UPDATE public.evolution_instance_daily_usage
        SET sent_count = GREATEST(sent_count - $3::int, 0)
        WHERE instance_id::text = $1::text AND date = $2::date
      `,
      [String(instanceId), targetDate, n]
    )
    .catch((err) => {
      // A devolução é caminho NORMAL (envio que falhou, lead que não coube, claim recusado): devolução perdida deixa a
      // cota do chip queimada até o fim do dia. Registra, mas não relança — quem devolve já está num caminho de erro e
      // um throw aqui mascararia a causa original.
      console.error("[chip-quota] falha ao devolver cota (a cota do dia pode ficar acima do real):", {
        instanceId: String(instanceId),
        date: targetDate,
        count: n,
        error: err?.message || err,
      });
    });
}

// Aliases para paridade e compatibilidade com código legado
export const resolveEvolutionInstanceDailyLimit = resolveChipDailyLimit;
export const reserveEvolutionInstanceDailyQuota = reserveChipDailyQuota;
export const getEvolutionInstanceDailyUsage = getChipDailyUsage;
export const releaseEvolutionInstanceDailyQuota = releaseChipDailyQuota;
