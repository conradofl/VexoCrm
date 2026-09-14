// backend/src/services/chipQuota.js
// Maquinaria de cota diária por chip (Evolution Instance Daily Usage)
// Anti-ban: cota compartilhada entre campanhas e cadências de follow-up.

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

export async function ensureEvolutionInstanceDailyUsageTable(pool = null) {
  const db = getDb(pool);
  if (!db) return false;
  if (_evolutionDailyUsageSchemaEnsured) return true;
  await db.query(`
    CREATE TABLE IF NOT EXISTS public.evolution_instance_daily_usage (
      instance_id TEXT NOT NULL,
      date DATE NOT NULL,
      sent_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (instance_id, date)
    )
  `);
  await db.query(`
    ALTER TABLE public.evolution_instance_daily_usage ALTER COLUMN instance_id TYPE TEXT
  `).catch(() => {});
  _evolutionDailyUsageSchemaEnsured = true;
  return true;
}

export function resolveChipDailyLimit(instance) {
  const override = Number.parseInt(String(instance?.daily_limit_override ?? ""), 10);
  if (Number.isInteger(override) && override > 0) return override;
  const state = (normalizeString(instance?.chip_state) || "").toLowerCase() === "warm" ? "warm" : "cold";
  return EVOLUTION_CHIP_DAILY_QUOTA_DEFAULTS[state];
}

export async function reserveChipDailyQuota(instanceId, dateStr = null, pool = null) {
  const db = getDb(pool);
  if (!instanceId || !db || !(await ensureEvolutionInstanceDailyUsageTable(db))) return null;
  const targetDate = dateStr || new Date().toISOString().slice(0, 10);
  const { rows } = await db.query(
    `
      INSERT INTO public.evolution_instance_daily_usage (instance_id, date, sent_count)
      VALUES ($1::text, $2::date, 1)
      ON CONFLICT (instance_id, date)
      DO UPDATE SET sent_count = public.evolution_instance_daily_usage.sent_count + 1
      RETURNING sent_count
    `,
    [String(instanceId), targetDate]
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

export async function releaseChipDailyQuota(instanceId, dateStr = null, pool = null) {
  const db = getDb(pool);
  if (!instanceId || !db) return;
  const targetDate = dateStr || new Date().toISOString().slice(0, 10);
  await db
    .query(
      `
        UPDATE public.evolution_instance_daily_usage
        SET sent_count = GREATEST(sent_count - 1, 0)
        WHERE instance_id = $1::text AND date = $2::date
      `,
      [String(instanceId), targetDate]
    )
    .catch(() => {});
}

// Aliases para paridade e compatibilidade com código legado
export const resolveEvolutionInstanceDailyLimit = resolveChipDailyLimit;
export const reserveEvolutionInstanceDailyQuota = reserveChipDailyQuota;
export const getEvolutionInstanceDailyUsage = getChipDailyUsage;
export const releaseEvolutionInstanceDailyQuota = releaseChipDailyQuota;
