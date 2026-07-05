// Extraído de src/pages/FollowupQueue.tsx (Onda 4 Run F6) — movimento puro, sem alteração de forma.
import type { FupTemplate } from "@/hooks/useFollowupAdmin";
import { TEMPLATE_EXAMPLE_DATA } from "./constants";

// ─── CONSTANTS & HELPERS COMUNS ───────────────────────────────────────────────

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

// ─── CAMPANHAS & TEMPLATES ────────────────────────────────────────────────────

export function labelForTemplate(t: FupTemplate) {
  if (t.trigger_type === "on_schedule") return "Envio Imediato";
  if (t.trigger_type === "no_reply") return `Após Inatividade (${t.trigger_value} ${t.trigger_unit === "days" ? "Dias" : t.trigger_unit === "hours" ? "Horas" : "Minutos"})`;
  if (t.trigger_type === "before_meeting") return `${t.trigger_value} ${t.trigger_unit === "days" ? "Dias" : t.trigger_unit === "hours" ? "Horas" : "Minutos"} Antes do Agendamento`;
  if (t.trigger_type === "after_meeting") return `${t.trigger_value} ${t.trigger_unit === "days" ? "Dias" : t.trigger_unit === "hours" ? "Horas" : "Minutos"} Depois do Agendamento`;
  return `${t.trigger_type} ${t.trigger_value} ${t.trigger_unit}`;
}

export function renderPreview(msg: string, segment?: string) {
  let output = msg;
  let data = TEMPLATE_EXAMPLE_DATA.geral;
  if (segment && TEMPLATE_EXAMPLE_DATA[segment]) {
    data = TEMPLATE_EXAMPLE_DATA[segment];
  } else {
    data = { ...TEMPLATE_EXAMPLE_DATA.geral, ...TEMPLATE_EXAMPLE_DATA.b2b, ...TEMPLATE_EXAMPLE_DATA.restaurante, ...TEMPLATE_EXAMPLE_DATA.turismo };
  }
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "gi");
    output = output.replace(regex, value);
  }
  return output;
}

// ─── MÉTRICAS (ANALYTICS) ─────────────────────────────────────────────────────

export function periodDates(period: string): { from: string; to: string } {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(now);

  if (period === "today") return { from: today, to: today };
  if (period === "7d") {
    const d = new Date(now); d.setDate(d.getDate() - 6);
    return { from: fmt(d), to: today };
  }
  if (period === "30d") {
    const d = new Date(now); d.setDate(d.getDate() - 29);
    return { from: fmt(d), to: today };
  }
  if (period === "thisMonth") {
    return { from: fmt(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }
  if (period === "lastMonth") {
    const first = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const last = new Date(now.getFullYear(), now.getMonth(), 0);
    return { from: fmt(first), to: fmt(last) };
  }
  return { from: "", to: "" };
}
