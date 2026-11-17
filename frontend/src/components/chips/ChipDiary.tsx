// Diário do chip — aba "Saúde & Volume" de Canais & Chips.
// Cada queda e cada volta de conexão de um chip, com o motivo que a Evolution informou e o que o Vexo enviou pelo chip
// antes da queda. Responde a pergunta que levou a este registro (Nous, 17/11/2026): "o chip caiu por causa de disparo
// do sistema, ou por algo de fora?". Dados: GET /api/reports/chip-diary (backend/src/services/chipDiary.js).
import { Plug, Unplug } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useChipDiary, type ChipDiaryEvent, type ChipDiaryReport, type ChipDiarySnapshot } from "@/hooks/useReports";

const TZ = "America/Sao_Paulo";

export function formatDiaryTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function intervalo(segundos: number): string {
  if (segundos < 120) return `${segundos} s`;
  if (segundos < 7200) return `${Math.round(segundos / 60)} min`;
  return `${Math.round(segundos / 3600)} h`;
}

/** "O que o Vexo enviou antes da queda", em frases curtas. Vazio quando não há foto. */
export function describeSnapshot(s: ChipDiarySnapshot | null | undefined): string[] {
  if (!s) return [];
  const linhas: string[] = [];
  const env24 = s.envios_24h ?? null;
  if (env24 === 0) {
    linhas.push("O Vexo não enviou mensagens de campanha por este chip nas 24 h antes da queda.");
  } else if (env24 !== null) {
    const partes = [`${s.envios_1h ?? 0} envios de campanha na última hora (${env24} em 24 h)`];
    if (typeof s.segundos_do_ultimo_envio_ate_a_queda === "number" && s.segundos_do_ultimo_envio_ate_a_queda >= 0) {
      partes.push(`último envio ${intervalo(s.segundos_do_ultimo_envio_ate_a_queda)} antes da queda`);
    }
    linhas.push(`Antes da queda: ${partes.join(", ")}.`);
  }
  if (typeof s.cota_usada_no_dia === "number") {
    linhas.push(
      `Mensagens do chip no dia (campanha, fila de resposta, follow-up e agente): ${s.cota_usada_no_dia}${
        typeof s.limite_diario === "number" ? ` de ${s.limite_diario}` : ""
      }.`
    );
  }
  if (typeof s.invalidos_24h === "number" && s.invalidos_24h > 0) {
    linhas.push(`${s.invalidos_24h} números inexistentes no WhatsApp nos lotes deste chip nas 24 h antes.`);
  }
  return linhas;
}

function EventoDoDiario({ ev }: { ev: ChipDiaryEvent }) {
  const queda = ev.kind === "queda";
  const nome = ev.chip_name || ev.instance_name;
  const snapshot = queda ? describeSnapshot(ev.snapshot) : [];
  return (
    <li data-testid="chip-diary-event" data-kind={ev.kind} className="flex gap-3 border-b border-border/60 py-3 last:border-b-0">
      <div
        className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
          queda ? "bg-red-500/10 text-red-600 dark:text-red-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        }`}
        aria-hidden="true"
      >
        {queda ? <Unplug className="h-4 w-4" /> : <Plug className="h-4 w-4" />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-sm font-semibold text-foreground">
            {nome} {queda ? "caiu" : "voltou"}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatDiaryTime(ev.occurred_at)}
            {ev.occurred_at_approx ? " (hora aproximada)" : ""}
          </span>
        </div>
        {queda && ev.reason_label && (
          <p data-testid="chip-diary-reason" className="break-words text-xs text-foreground/90">
            {ev.reason_label}
          </p>
        )}
        {snapshot.map((linha) => (
          <p key={linha} data-testid="chip-diary-snapshot" className="break-words text-xs text-muted-foreground">
            {linha}
          </p>
        ))}
      </div>
    </li>
  );
}

export function ChipDiaryView({ data, isLoading, error }: { data?: ChipDiaryReport; isLoading?: boolean; error?: unknown }) {
  let corpo: JSX.Element;
  if (isLoading) {
    corpo = <p className="text-sm text-muted-foreground">Carregando o diário do chip...</p>;
  } else if (error) {
    corpo = (
      <p className="text-sm text-red-600 dark:text-red-400">
        {error instanceof Error ? error.message : "Falha ao carregar o diário do chip."}
      </p>
    );
  } else if (!data || data.available === false) {
    corpo = (
      <p data-testid="chip-diary-unavailable" className="text-sm text-muted-foreground">
        O diário começa a registrar as quedas depois da próxima atualização do sistema.
      </p>
    );
  } else if (data.items.length === 0) {
    corpo = (
      <p data-testid="chip-diary-empty" className="text-sm text-muted-foreground">
        Nenhuma queda registrada para os chips desta empresa.
      </p>
    );
  } else {
    corpo = (
      <ol data-testid="chip-diary-list" className="m-0 list-none p-0">
        {data.items.map((ev) => (
          <EventoDoDiario key={ev.id} ev={ev} />
        ))}
      </ol>
    );
  }
  return (
    <Card data-testid="chip-diary" className="overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Diário do chip</CardTitle>
        <CardDescription className="text-xs">
          Quedas e voltas de cada chip, com o motivo que a Evolution informou e o que o Vexo enviou antes da queda.
        </CardDescription>
      </CardHeader>
      <CardContent>{corpo}</CardContent>
    </Card>
  );
}

export function ChipDiary({ clientId }: { clientId: string | null }) {
  const { data, isLoading, error } = useChipDiary(clientId);
  return <ChipDiaryView data={data} isLoading={isLoading} error={error} />;
}
