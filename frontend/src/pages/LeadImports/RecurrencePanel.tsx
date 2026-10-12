import { type Dispatch, type SetStateAction, useEffect } from "react";
import { AlertTriangle, CalendarClock, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  RECURRENCE_ORIGIN_NOTES,
  RECURRENCE_PATTERNS,
  WEEKDAY_OPTIONS,
  formatAudienceToday,
  type RecurrenceEndType,
  type RecurrencePattern,
} from "@/lib/campaignRecurrence";
import { useRecurrencePreview, type RecurrencePreviewInput } from "@/hooks/useCampanhas";
import { darkSelectContentClass } from "./styles";

export interface RecurrencePanelProps {
  recurrencePattern: RecurrencePattern;
  setRecurrencePattern: Dispatch<SetStateAction<RecurrencePattern>>;
  recurrenceDayOfMonth: number;
  setRecurrenceDayOfMonth: Dispatch<SetStateAction<number>>;
  recurrenceDayOfWeek: number;
  setRecurrenceDayOfWeek: Dispatch<SetStateAction<number>>;
  recurrenceTime: string;
  setRecurrenceTime: Dispatch<SetStateAction<string>>;
  recurrenceEndType: RecurrenceEndType | null;
  setRecurrenceEndType: Dispatch<SetStateAction<RecurrenceEndType | null>>;
  recurrenceEndsOn: string;
  setRecurrenceEndsOn: Dispatch<SetStateAction<string>>;
  recurrenceMaxOccurrences: number;
  setRecurrenceMaxOccurrences: Dispatch<SetStateAction<number>>;
  recurrenceNoEndConfirmed: boolean;
  setRecurrenceNoEndConfirmed: Dispatch<SetStateAction<boolean>>;
  recurrenceOverrunConfirmed: boolean;
  setRecurrenceOverrunConfirmed: Dispatch<SetStateAction<boolean>>;
  /** Origem, texto e limite do formulário: a prévia usa o mesmo critério do envio. Null = sem prévia. */
  previewInput: Omit<RecurrencePreviewInput, "recurrencePattern" | "recurrenceDayOfMonth" | "recurrenceDayOfWeek" | "recurrenceTime"> | null;
}

const END_OPTIONS: { value: RecurrenceEndType; label: string }[] = [
  { value: "until_date", label: "Até uma data" },
  { value: "count", label: "Depois de N envios" },
  { value: "never", label: "Sem fim" },
];

/**
 * Repetição, fim declarado e o que o dono precisa ler antes de salvar: o próximo envio em texto, a regra do mês curto,
 * o que a origem do público significa, quantos leads seriam hoje e se faltam variações do texto.
 */
export function RecurrencePanel(props: RecurrencePanelProps) {
  const {
    recurrencePattern,
    setRecurrencePattern,
    recurrenceDayOfMonth,
    setRecurrenceDayOfMonth,
    recurrenceDayOfWeek,
    setRecurrenceDayOfWeek,
    recurrenceTime,
    setRecurrenceTime,
    recurrenceEndType,
    setRecurrenceEndType,
    recurrenceEndsOn,
    setRecurrenceEndsOn,
    recurrenceMaxOccurrences,
    setRecurrenceMaxOccurrences,
    recurrenceNoEndConfirmed,
    setRecurrenceNoEndConfirmed,
    recurrenceOverrunConfirmed,
    setRecurrenceOverrunConfirmed,
    previewInput,
  } = props;

  const isWeekly = recurrencePattern === "weekly" || recurrencePattern === "biweekly";
  const preview = useRecurrencePreview(
    previewInput
      ? {
          ...previewInput,
          recurrencePattern,
          recurrenceDayOfMonth: recurrencePattern === "monthly" ? recurrenceDayOfMonth : null,
          recurrenceDayOfWeek: isWeekly ? recurrenceDayOfWeek : null,
          recurrenceTime,
        }
      : null
  );
  const p = preview.data;
  const audienceText = formatAudienceToday(p?.audience);
  const loadMessage = p?.load?.message ?? null;
  // A confirmação vale para ESTA conta: mudou a repetição, o público ou o texto, o dono confirma de novo.
  useEffect(() => {
    setRecurrenceOverrunConfirmed(false);
  }, [loadMessage, setRecurrenceOverrunConfirmed]);

  const timeInput = (
    <div className="space-y-1.5">
      <label className="text-[10px] uppercase font-bold text-slate-500">Horário do envio</label>
      <Input
        type="time"
        data-testid="recurrence-time-input"
        value={recurrenceTime}
        onChange={(e) => setRecurrenceTime(e.target.value)}
        className="h-10 text-xs rounded-xl"
      />
    </div>
  );

  return (
    <div className="space-y-3 pt-2 animate-fadeIn" data-testid="recurrence-options">
      <div className="space-y-1.5">
        <label className="text-[10px] uppercase font-bold text-slate-500">Repetição</label>
        <Select value={recurrencePattern} onValueChange={(val: RecurrencePattern) => setRecurrencePattern(val)}>
          <SelectTrigger data-testid="recurrence-pattern-select" className="h-10 text-xs rounded-xl">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className={darkSelectContentClass}>
            {RECURRENCE_PATTERNS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {recurrencePattern === "monthly" && (
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-bold text-slate-500">Dia do mês</label>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground whitespace-nowrap">Todo dia</span>
              <Input
                type="number"
                min="1"
                max="31"
                data-testid="recurrence-day-of-month-input"
                value={recurrenceDayOfMonth}
                onChange={(e) => setRecurrenceDayOfMonth(Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)))}
                className="h-10 text-xs rounded-xl text-center font-bold"
              />
              <span className="text-xs text-muted-foreground whitespace-nowrap">do mês</span>
            </div>
          </div>
        )}
        {isWeekly && (
          <div className="space-y-1.5">
            <label className="text-[10px] uppercase font-bold text-slate-500">Dia da semana</label>
            <Select value={String(recurrenceDayOfWeek)} onValueChange={(val) => setRecurrenceDayOfWeek(parseInt(val, 10))}>
              <SelectTrigger data-testid="recurrence-day-of-week-select" className="h-10 text-xs rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className={darkSelectContentClass}>
                {WEEKDAY_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={String(opt.value)}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {timeInput}
      </div>

      {recurrencePattern === "monthly" && recurrenceDayOfMonth >= 29 && (
        <p data-testid="recurrence-month-end-note" className="text-[11px] text-muted-foreground">
          Em meses sem dia {recurrenceDayOfMonth}, o envio sai no último dia do mês (ex.: 30/11, 28/02).
        </p>
      )}

      {/* Fim declarado */}
      <fieldset className="space-y-2" data-testid="recurrence-end">
        <legend className="text-[10px] uppercase font-bold text-slate-500">Quando termina</legend>
        <div className="flex flex-wrap gap-2">
          {END_OPTIONS.map((opt) => (
            <label
              key={opt.value}
              className={cn(
                "flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs cursor-pointer",
                recurrenceEndType === opt.value ? "border-indigo-500 bg-indigo-500/10" : "border-border/60"
              )}
            >
              <input
                type="radio"
                name="recurrence-end-type"
                data-testid={`recurrence-end-${opt.value}`}
                checked={recurrenceEndType === opt.value}
                onChange={() => setRecurrenceEndType(opt.value)}
              />
              {opt.label}
            </label>
          ))}
        </div>
        {recurrenceEndType === "until_date" && (
          <Input
            type="date"
            data-testid="recurrence-ends-on-input"
            value={recurrenceEndsOn}
            onChange={(e) => setRecurrenceEndsOn(e.target.value)}
            className="h-10 text-xs rounded-xl max-w-[200px]"
          />
        )}
        {recurrenceEndType === "count" && (
          <div className="flex items-center gap-2 text-xs">
            <Input
              type="number"
              min="1"
              max="1000"
              data-testid="recurrence-max-occurrences-input"
              value={recurrenceMaxOccurrences}
              onChange={(e) => setRecurrenceMaxOccurrences(Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="h-10 text-xs rounded-xl w-24 text-center font-bold"
            />
            <span className="text-muted-foreground">envios e para</span>
          </div>
        )}
        {recurrenceEndType === "never" && (
          <label className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-900 dark:text-amber-200">
            <input
              type="checkbox"
              data-testid="recurrence-no-end-confirm"
              checked={recurrenceNoEndConfirmed}
              onChange={(e) => setRecurrenceNoEndConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>Confirmo que esta campanha envia até alguém desligar. Sem esta confirmação ela não é salva.</span>
          </label>
        )}
      </fieldset>

      {/* O que o dono precisa ler antes de salvar */}
      {previewInput && (
        <div
          data-testid="recurrence-preview"
          className="space-y-1.5 rounded-xl border border-indigo-500/30 bg-indigo-500/5 p-3 text-xs"
        >
          {preview.isLoading && <p className="text-muted-foreground">Calculando o próximo envio…</p>}
          {preview.isError && <p className="text-destructive">Não foi possível calcular a prévia agora.</p>}
          {p?.nextRunLabel && (
            <p data-testid="recurrence-next-run" className="flex items-center gap-1.5 font-semibold text-foreground">
              <CalendarClock className="h-3.5 w-3.5 text-indigo-500" />
              Próximo envio: {p.nextRunLabel}
            </p>
          )}
          {p?.summary && <p className="text-muted-foreground">{p.summary}</p>}
          {p && (
            <p data-testid="recurrence-origin-note" className="flex items-start gap-1.5 text-foreground">
              <Users className="h-3.5 w-3.5 mt-0.5 shrink-0 text-indigo-500" />
              <span>
                {RECURRENCE_ORIGIN_NOTES[p.originKind]}
                {audienceText && <span data-testid="recurrence-audience"> {audienceText}</span>}
              </span>
            </p>
          )}
          {p?.load && (
            <div
              data-testid="recurrence-load"
              data-overrun={p.load.overrun ? "true" : "false"}
              className={cn(
                "space-y-1.5 rounded-lg p-2",
                p.load.overrun ? "bg-destructive/10 text-destructive" : "bg-muted/40 text-foreground"
              )}
            >
              <p className="flex items-start gap-1.5">
                <CalendarClock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <span>{p.load.message}</span>
              </p>
              {p.load.overrun && (
                <label className="flex items-start gap-2 font-medium">
                  <input
                    type="checkbox"
                    data-testid="recurrence-overrun-confirm"
                    checked={recurrenceOverrunConfirmed}
                    onChange={(e) => setRecurrenceOverrunConfirmed(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>Entendi que envios vão ser pulados e quero salvar assim mesmo. Sem esta confirmação ela não é salva.</span>
                </label>
              )}
            </div>
          )}
          {p?.variantsMessage && (
            <p
              data-testid="recurrence-variants-message"
              data-blocking={p.variantsBlocking ? "true" : "false"}
              className={cn(
                "flex items-start gap-1.5 rounded-lg p-2",
                p.variantsBlocking
                  ? "bg-destructive/10 text-destructive"
                  : "bg-amber-500/10 text-amber-900 dark:text-amber-200"
              )}
            >
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{p.variantsMessage}</span>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
