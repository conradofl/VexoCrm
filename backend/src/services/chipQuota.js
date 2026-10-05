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
// criava como UUID) e cada leitor assumia um tipo — um dos dois sempre quebrava. Agora este módulo é o ÚNICO
// criador e converge qualquer tabela existente para TEXT (CONVERGE_USAGE_INSTANCE_ID_SQL, a mesma da migration
// 20261004130000). TEXT, e não UUID, porque UUID→TEXT nunca perde dado e TEXT→UUID falharia (ou exigiria apagar
// linhas) se existir um valor que não é UUID.

import { pgDatabasePool } from "./database.js";
import { normalizeString } from "../textNormalize.js";

export const EVOLUTION_CHIP_DAILY_QUOTA_DEFAULTS = { cold: 50, warm: 500 };

let _evolutionDailyUsageSchemaEnsured = false;
let _customPool = null;

export function setChipQuotaDbPool(pool) {
  _customPool = pool;
}

export function resetChipQuotaStateForTest() {
  _evolutionDailyUsageSchemaEnsured = false;
  _customPool = null;
}

function getDb(customPool = null) {
  if (customPool) return customPool;
  if (_customPool) return _customPool;
  if (pgDatabasePool) return pgDatabasePool;
  return null;
}

// Só roda o ALTER se a coluna AINDA não é TEXT (ALTER TABLE pega ACCESS EXCLUSIVE mesmo em no-op).
export const CONVERGE_USAGE_INSTANCE_ID_SQL = `DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'evolution_instance_daily_usage'
       AND column_name = 'instance_id' AND data_type <> 'text'
  ) THEN
    ALTER TABLE public.evolution_instance_daily_usage ALTER COLUMN instance_id TYPE TEXT USING instance_id::text;
  END IF;
END $$;`;

export const CREATE_USAGE_TABLE_SQL = `
    CREATE TABLE IF NOT EXISTS public.evolution_instance_daily_usage (
      instance_id TEXT NOT NULL,
      date DATE NOT NULL,
      sent_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (instance_id, date)
    )
  `;

export async function ensureEvolutionInstanceDailyUsageTable(pool = null) {
  const db = getDb(pool);
  if (!db) return false;
  if (_evolutionDailyUsageSchemaEnsured) return true;
  await db.query(CREATE_USAGE_TABLE_SQL);
  // sem .catch: se a conversão falhar, o erro aparece — engoli-lo deixou a tabela em UUID por meses em alguns bancos
  await db.query(CONVERGE_USAGE_INSTANCE_ID_SQL);
  _evolutionDailyUsageSchemaEnsured = true;
  return true;
}

export function resolveChipDailyLimit(instance) {
  const override = Number.parseInt(String(instance?.daily_limit_override ?? ""), 10);
  if (Number.isInteger(override) && override > 0) return override;
  const state = (normalizeString(instance?.chip_state) || "").toLowerCase() === "warm" ? "warm" : "cold";
  return EVOLUTION_CHIP_DAILY_QUOTA_DEFAULTS[state];
}

// `count` mensagens de uma vez (um lead com 3 passos reserva 3). Devolve o total do dia DEPOIS da reserva.
export async function reserveChipDailyQuota(instanceId, dateStr = null, pool = null, count = 1) {
  const db = getDb(pool);
  if (!instanceId || !db || !(await ensureEvolutionInstanceDailyUsageTable(db))) return null;
  const n = Number.isInteger(count) && count > 0 ? count : 1;
  const targetDate = dateStr || new Date().toISOString().slice(0, 10);
  const { rows } = await db.query(
    `
      INSERT INTO public.evolution_instance_daily_usage (instance_id, date, sent_count)
      VALUES ($1::text, $2::date, $3::int)
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
  if (!instanceId || !db || !(await ensureEvolutionInstanceDailyUsageTable(db))) return 0;
  const targetDate = dateStr || new Date().toISOString().slice(0, 10);
  const { rows } = await db.query(
    `SELECT sent_count FROM public.evolution_instance_daily_usage WHERE instance_id = $1::text AND date = $2::date`,
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
        WHERE instance_id = $1::text AND date = $2::date
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
