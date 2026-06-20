import { cn } from "@/lib/utils";

interface KpiCardProps {
  title: string;
  value: string;
  icon: React.ReactNode;
  indicator?: { color: string; label: string };
  tone?: "cyan" | "teal" | "amber" | "pink" | "purple";
  trend?: string;
}

const toneColors = {
  cyan: "text-cyan-600 dark:text-cyan-300 border-cyan-500/20 bg-cyan-500/5 dark:bg-cyan-500/10",
  teal: "text-emerald-600 dark:text-emerald-300 border-emerald-500/20 bg-emerald-500/5 dark:bg-emerald-500/10",
  amber: "text-amber-600 dark:text-amber-300 border-amber-500/20 bg-amber-500/5 dark:bg-amber-500/10",
  pink: "text-rose-600 dark:text-rose-300 border-rose-500/20 bg-rose-500/5 dark:bg-rose-500/10",
  purple: "text-indigo-600 dark:text-indigo-300 border-indigo-500/20 bg-indigo-500/5 dark:bg-indigo-500/10",
};

function normalizeKpiText(value?: string) {
  const text = String(value ?? "").trim();
  if (!text) return "0";

  return text
    .replace(/undefined/gi, "0")
    .replace(/\bNaN\b/g, "0")
    .replace(/\bnull\b/gi, "0");
}

export function KpiCard({ title, value, icon, indicator, tone = "cyan", trend }: KpiCardProps) {
  const displayValue = normalizeKpiText(value);
  const displayTrend = trend ? normalizeKpiText(trend) : null;

  return (
    <div
      className="group relative overflow-hidden rounded-[1.25rem] border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-0.5 shadow-sm text-card-foreground"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-white/10 dark:bg-white/5" />
      <div className="absolute -bottom-8 -right-8 h-24 w-24 rounded-full bg-current/5 blur-2xl" />

      <div className="relative flex flex-col gap-2.5">
        <div className="flex items-start justify-between">
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            {title}
          </span>
          <div className="flex items-center gap-1.5">
            {indicator && (
              <span className={cn("h-2 w-2 rounded-full", indicator.color)} title={indicator.label} />
            )}
            <div className={cn("flex h-8 w-8 items-center justify-center rounded-lg border", toneColors[tone])}>
              {icon}
            </div>
          </div>
        </div>

        <div>
          <p className="text-[2rem] font-extrabold tracking-[-0.06em] text-foreground">{displayValue}</p>
          {displayTrend && (
            <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
              {displayTrend}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

