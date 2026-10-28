import { Input } from "@/components/ui/input";
import { describeDispatchVolume, formatDispatchVolume } from "@/lib/leadImports/dispatchVolume";

interface DispatchVolumeNoticeProps {
  totalLeads: number;
  batchingEnabled: boolean;
  batchSize: string;
  capText: string;
  onCapChange: (value: string) => void;
}

/**
 * Quantos leads REALMENTE saem neste envio, e o único limite possível: "só os primeiros N", opcional e vazio por
 * padrão. Sem lotes, o envio cobre o público inteiro.
 */
export function DispatchVolumeNotice({ totalLeads, batchingEnabled, batchSize, capText, onCapChange }: DispatchVolumeNoticeProps) {
  const volume = describeDispatchVolume({ totalLeads, batchingEnabled, batchSize, capText });
  if (!volume) return null;

  return (
    <div className="rounded-xl border border-border/60 bg-muted/20 p-3 space-y-2" data-testid="dispatch-volume-notice">
      <p className="text-xs font-semibold text-foreground" data-testid="dispatch-volume-text">
        {formatDispatchVolume(volume)}
      </p>
      {!batchingEnabled && (
        <div className="space-y-1">
          <label htmlFor="dispatch-cap-input" className="text-[10px] uppercase font-bold text-slate-500">
            Enviar só os primeiros (opcional)
          </label>
          <Input
            id="dispatch-cap-input"
            data-testid="dispatch-cap-input"
            type="number"
            min="1"
            placeholder="Vazio = todos"
            value={capText}
            onChange={(e) => onCapChange(e.target.value)}
            className="h-9 text-xs rounded-xl max-w-[180px]"
          />
        </div>
      )}
    </div>
  );
}
