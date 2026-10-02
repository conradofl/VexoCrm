export const CHIP_DAILY_QUOTA_DEFAULTS = { cold: 50, warm: 500 } as const;

export function resolveChipLimit(
  chipStateOrInstance?: "cold" | "warm" | { chip_state?: string | null; daily_limit_override?: number | string | null } | null,
  overrideArg?: string | number | null
): number {
  if (typeof chipStateOrInstance === "object" && chipStateOrInstance !== null) {
    const rawOverride = chipStateOrInstance.daily_limit_override;
    const parsed = rawOverride != null ? parseInt(String(rawOverride), 10) : NaN;
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    const state = String(chipStateOrInstance.chip_state || "").toLowerCase() === "warm" ? "warm" : "cold";
    return CHIP_DAILY_QUOTA_DEFAULTS[state];
  }

  const parsed = overrideArg != null ? parseInt(String(overrideArg), 10) : NaN;
  if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  return chipStateOrInstance === "warm" ? CHIP_DAILY_QUOTA_DEFAULTS.warm : CHIP_DAILY_QUOTA_DEFAULTS.cold;
}

export {
  getStableColor as getChipColor,
  getStableColor,
  getEntityColor,
  STABLE_COLOR_PALETTE as CHIP_COLOR_PALETTE,
  STABLE_COLOR_PALETTE,
  type StableColor as ChipColor,
  type StableColor,
} from "@/lib/stableColor";
