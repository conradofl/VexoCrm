export function resolveChipLimit(chipState: "cold" | "warm", overrideStr?: string): number {
  const parsed = overrideStr ? parseInt(overrideStr, 10) : NaN;
  if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  return chipState === "warm" ? 500 : 100;
}
