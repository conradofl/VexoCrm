import { AlertTriangle } from "lucide-react";

// Faixa "Próximos N dias" (Etapa 5 Commit 3). Mostra, por dia: a fração da cadência
// aberta (cadencePending) e o total REAL do chip inteiro (chipPending) — o teto de
// envio é do número de WhatsApp, compartilhado por todas as cadências que despacham
// por ele, não só a que está sendo editada/aplicada agora. O vermelho vem SEMPRE de
// chipPending > chipLimit, nunca da fração isolada da cadência.

export interface UpcomingStripDay {
  date: string;
  cadencePending: number;
  chipPending: number;
  chipLimit: number | null;
  overLimit: boolean;
  projected?: number;
}

interface Props {
  days: UpcomingStripDay[] | undefined;
  chipLimit?: number | null;
  loading?: boolean;
  /** Rótulo curto do que "cadencePending" representa nesta tela (ex.: "desta cadência"). */
  cadenceLabel?: string;
}

function formatDayLabel(dateStr: string) {
  const d = new Date(`${dateStr}T12:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "");
}

export default function UpcomingStrip({ days, chipLimit, loading, cadenceLabel = "desta cadência" }: Props) {
  if (loading) {
    return <p className="text-[11px] text-muted-foreground">Calculando faixa dos próximos dias…</p>;
  }
  if (!days || days.length === 0) return null;

  const anyOverLimit = days.some((d) => d.overLimit);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-foreground/80">Próximos {days.length} dias</span>
        {chipLimit != null ? (
          <span className="text-[10px] text-muted-foreground">Teto do chip: {chipLimit}/dia</span>
        ) : (
          <span className="text-[10px] text-muted-foreground">Chip não conectado — sem teto pra comparar</span>
        )}
      </div>

      <div className="grid gap-1.5 grid-cols-7">
        {days.map((d) => {
          const pct = chipLimit ? Math.min(100, Math.round((d.chipPending / chipLimit) * 100)) : 0;
          return (
            <div
              key={d.date}
              title={`${cadenceLabel}: ${d.cadencePending} · total do chip: ${d.chipPending}${
                chipLimit != null ? `/${chipLimit}` : ""
              }`}
              className={`rounded-md border p-1.5 text-center ${
                d.overLimit
                  ? "border-red-500/50 bg-red-500/10"
                  : "border-border bg-muted/20"
              }`}
            >
              <p className="text-[9px] text-muted-foreground capitalize leading-tight">{formatDayLabel(d.date)}</p>
              <p className={`text-sm font-bold leading-tight ${d.overLimit ? "text-red-600 dark:text-red-400" : "text-foreground"}`}>
                {d.chipPending}
              </p>
              <p className="text-[9px] text-muted-foreground leading-tight">{d.cadencePending} {cadenceLabel}</p>
              {chipLimit != null && (
                <div className="mt-1 h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full ${d.overLimit ? "bg-red-500" : "bg-indigo-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {anyOverLimit && (
        <div className="flex items-start gap-1.5 p-2 rounded-md bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-300 text-[11px]">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>Pelo menos um dia passa do teto do chip — o número corre risco de ban por volume.</span>
        </div>
      )}
    </div>
  );
}
