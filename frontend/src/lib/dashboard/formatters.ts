// frontend/src/lib/dashboard/formatters.ts

export function formatMetricNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return Number(value).toLocaleString("pt-BR");
}

export function formatDelta(delta: number | null | undefined): {
  text: string;
  isPositive: boolean;
  isNegative: boolean;
  isZero: boolean;
} {
  if (delta == null || !Number.isFinite(delta)) {
    return { text: "—", isPositive: false, isNegative: false, isZero: true };
  }
  const rounded = Math.round(delta);
  if (rounded > 0) {
    return { text: `+${rounded}%`, isPositive: true, isNegative: false, isZero: false };
  }
  if (rounded < 0) {
    return { text: `${rounded}%`, isPositive: false, isNegative: true, isZero: false };
  }
  return { text: "0%", isPositive: false, isNegative: false, isZero: true };
}

export function formatLastUpdatedTime(isoString: string | null | undefined): string {
  if (!isoString) return "Horário indisponível";
  try {
    const d = new Date(isoString);
    if (Number.isNaN(d.getTime())) return "Horário inválido";
    return d.toLocaleString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "Horário indisponível";
  }
}
