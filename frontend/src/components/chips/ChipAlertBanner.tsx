// Aviso de chip conectado que recebe com atraso ou ficou mudo (19/11/2026).
// Aparece em Conversas (topo da fila), Canais & Chips (topo da página) e no Diário do chip.
// Em 19/11 quatro chips "conectados" entregavam mensagens com 8 a 37 h de atraso e a tela não mostrava nada.
// Sem alerta, o componente não ocupa espaço nenhum.
import { AlertTriangle, BellOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChipAlerts, type ChipAlert, type ChipAlertsReport } from "@/hooks/useChipAlerts";

/** "45 min", "2 h", "1 h 30 min", "37 h". */
export function duracao(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  if (h >= 10 || resto === 0) return `${h} h`;
  return `${h} h ${resto} min`;
}

/** Frase do aviso, em português de gente. */
export function fraseDoAlerta(a: ChipAlert): string {
  if (a.tipo === "atrasado") {
    const n = a.mensagensAtrasadas ?? 0;
    const qtd = n === 1 ? "1 mensagem chegou" : `${n} mensagens chegaram`;
    return `${a.instancia}: ${qtd} com até ${duracao(a.maiorAtrasoMin ?? 0)} de atraso na última hora. O chip aparece conectado, mas o WhatsApp está segurando as mensagens.`;
  }
  return `${a.instancia}: nenhuma mensagem recebida há ${duracao(a.minutosSemReceber ?? 0)}, num horário em que este chip costuma receber. Confira se as mensagens estão chegando.`;
}

export function ChipAlertBannerView({
  data,
  compact = false,
  className,
}: {
  data?: ChipAlertsReport;
  compact?: boolean;
  className?: string;
}) {
  const alertas = data?.alertas ?? [];
  if (alertas.length === 0) return null;
  const temAtraso = alertas.some((a) => a.tipo === "atrasado");
  return (
    <div
      role="alert"
      data-testid="chip-alert-banner"
      data-compact={compact ? "true" : undefined}
      className={cn(
        "rounded-lg border text-xs",
        compact ? "px-3 py-2" : "px-3 py-2.5",
        temAtraso
          ? "border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200"
          : "border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-100",
        className
      )}
    >
      {!compact && (
        <p className="mb-1 font-semibold">
          {alertas.length === 1 ? "Chip com problema para receber" : `${alertas.length} chips com problema para receber`}
        </p>
      )}
      <ul className="m-0 list-none space-y-1 p-0">
        {alertas.map((a) => (
          <li key={`${a.instancia}-${a.tipo}`} data-testid="chip-alert" data-tipo={a.tipo} className="flex gap-2">
            {a.tipo === "atrasado" ? (
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <BellOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 break-words">{fraseDoAlerta(a)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChipAlertBanner({
  clientId,
  compact = false,
  className,
}: {
  clientId: string | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  const { data } = useChipAlerts(clientId);
  return <ChipAlertBannerView data={data} compact={compact} className={className} />;
}
