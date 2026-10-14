import { useEffect, useState } from "react";
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";

export interface LastUpdatedIndicatorProps {
  timestamp?: number | null;
  onRefresh?: () => void;
  isFetching?: boolean;
  className?: string;
}

export function formatTimeAgo(diffSeconds: number, timestamp: number): string {
  if (diffSeconds < 5) return "Atualizado agora";
  if (diffSeconds < 60) return `Atualizado há ${diffSeconds}s`;
  if (diffSeconds < 3600) return `Atualizado há ${Math.floor(diffSeconds / 60)}m`;
  const d = new Date(timestamp);
  return `Atualizado às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}

export function LastUpdatedIndicator({
  timestamp,
  onRefresh,
  isFetching = false,
  className,
}: LastUpdatedIndicatorProps) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  if (!timestamp) return null;

  const diffSec = Math.max(0, Math.floor((now - timestamp) / 1000));
  const label = formatTimeAgo(diffSec, timestamp);

  return (
    <div
      data-testid="last-updated-indicator"
      className={cn("flex items-center gap-1.5 text-[11px] text-muted-foreground", className)}
      title={`Última resposta do servidor: ${new Date(timestamp).toLocaleTimeString("pt-BR")}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
      <span>{label}</span>
      {onRefresh && (
        <button
          type="button"
          onClick={onRefresh}
          disabled={isFetching}
          className="p-1 rounded-md hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground disabled:opacity-50"
          title="Recarregar agora"
          aria-label="Recarregar dados"
        >
          <RotateCw className={cn("h-3 w-3", isFetching && "animate-spin text-indigo-500")} />
        </button>
      )}
    </div>
  );
}
