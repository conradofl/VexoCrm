import { Fragment, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ViewMode } from "@/lib/viewMode";

/**
 * Um campo do registro fechado (o que o cartão e a linha mostram). A lista tem EXATAMENTE os campos do cartão
 * fechado: nenhuma informação muda entre os modos, só a forma.
 */
export interface RecordField<T> {
  key: string;
  label: string;
  render: (item: T) => ReactNode;
  className?: string;
}

export interface RecordCardState {
  expanded: boolean;
  toggle: () => void;
}

interface RecordViewProps<T> {
  mode: ViewMode;
  items: readonly T[];
  getId: (item: T) => string;
  /** Campos do registro fechado, na ordem das colunas da lista (o primeiro é o nome). */
  fields: readonly RecordField<T>[];
  /** Classe da faixa de cor do registro (getStableColor(id).stripe): a mesma nos dois modos. */
  stripeClass: (id: string) => string;
  /** O cartão de hoje, sem mudança. Recebe o estado de "aberto" (um por vez, nos dois modos). */
  renderCard: (item: T, state: RecordCardState) => ReactNode;
  /** O que abre: o MESMO conteúdo do cartão aberto. */
  renderExpanded: (item: T) => ReactNode;
  /** Prefixo dos data-testid da linha: `${prefix}-row-${id}`, `${prefix}-row-stripe-${id}`... */
  testIdPrefix: string;
  /** Nome do registro, para os rótulos de acessibilidade ("Ver detalhes de ..."). */
  labelOf: (item: T) => string;
  cardsClassName?: string;
  /** data-testid do contêiner dos cartões (a grade que já existia em cada aba). */
  cardsTestId?: string;
  /** Linha compacta (coluna estreita, ex.: a lateral de Propostas): campos empilhados em vez de colunas. */
  compact?: boolean;
  /** Ações da linha (ex.: abrir o PDF), antes da seta. Não são campos. Ficam visíveis sem expandir. */
  renderRowActions?: (item: T) => ReactNode;
  /** Largura fixa da área de ações (ex.: "w-[19rem]"): mantém as colunas alinhadas com o cabeçalho. */
  rowActionsClassName?: string;
  /** Destaque de linha selecionada. */
  isSelected?: (item: T) => boolean;
  /** Aberto controlado de fora (para quem precisa fechar ao trocar de aba). Sem isto, a lista guarda sozinha. */
  expandedId?: string | null;
  onExpandedChange?: (id: string | null) => void;
}

/** Valor de um campo, marcado com data-field para conferir que cartão e linha mostram os mesmos. */
export function FieldValue<T>({ field, item }: { field: RecordField<T>; item: T }) {
  return (
    <span data-field={field.key} className={cn("min-w-0 truncate", field.className)}>
      {field.render(item)}
    </span>
  );
}

/**
 * Cartões ou linhas, a mesma lista de registros. Um aberto por vez, nos dois modos; a faixa de cor existe nos
 * dois (traço à esquerda da linha); a linha expande com o mesmo conteúdo do cartão aberto.
 */
export function RecordView<T>({
  mode,
  items,
  getId,
  fields,
  stripeClass,
  renderCard,
  renderExpanded,
  testIdPrefix,
  labelOf,
  cardsClassName,
  cardsTestId,
  compact = false,
  renderRowActions,
  rowActionsClassName,
  isSelected,
  expandedId: controlledExpanded,
  onExpandedChange,
}: RecordViewProps<T>) {
  const [internalExpanded, setInternalExpanded] = useState<string | null>(null);
  const expandedId = controlledExpanded !== undefined ? controlledExpanded : internalExpanded;
  const setExpanded = (id: string | null) => {
    if (controlledExpanded === undefined) setInternalExpanded(id);
    onExpandedChange?.(id);
  };
  const toggle = (id: string) => setExpanded(expandedId === id ? null : id);

  if (mode === "card") {
    return (
      <div className={cardsClassName} data-testid={cardsTestId ?? `${testIdPrefix}-cards`}>
        {items.map((item) => {
          const id = getId(item);
          return <Fragment key={id}>{renderCard(item, { expanded: expandedId === id, toggle: () => toggle(id) })}</Fragment>;
        })}
      </div>
    );
  }

  const [nameField, ...otherFields] = fields;
  const columns = `minmax(0,2fr) repeat(${otherFields.length}, minmax(0,1fr))`;

  return (
    <div role="table" aria-label="Lista de registros" data-testid={`${testIdPrefix}-list`} className="space-y-2">
      {!compact && (
        <div role="row" data-testid={`${testIdPrefix}-list-header`} className="hidden md:flex items-center gap-2 pl-4 pr-2.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          <div className="grid min-w-0 flex-1 gap-3" style={{ gridTemplateColumns: columns }}>
            {fields.map((f) => (
              <span key={f.key} role="columnheader">
                {f.label}
              </span>
            ))}
          </div>
          {renderRowActions && <span className={cn("shrink-0", rowActionsClassName)} aria-hidden="true" />}
          <span className="w-7 shrink-0" aria-hidden="true" />
        </div>
      )}
      {items.map((item) => {
        const id = getId(item);
        const open = expandedId === id;
        const name = labelOf(item);
        return (
          <div
            key={id}
            role="row"
            data-testid={`${testIdPrefix}-row-${id}`}
            className={cn(
              "flex rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden",
              isSelected?.(item) ? "border-purple-500/50 ring-1 ring-purple-500/20" : "border-border/70",
              open && "ring-1 ring-border shadow-md"
            )}
          >
            {/* traço de cor à esquerda: a faixa do cartão, com a mesma cor para o mesmo registro */}
            <div data-testid={`${testIdPrefix}-row-stripe-${id}`} className={cn("w-1.5 self-stretch shrink-0", stripeClass(id))} aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 p-2.5">
                {compact ? (
                  <div className="min-w-0 flex-1 space-y-0.5 text-xs">
                    <div className="font-semibold text-foreground">
                      <FieldValue field={nameField} item={item} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      {otherFields.map((f) => (
                        <FieldValue key={f.key} field={f} item={item} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="grid min-w-0 flex-1 items-center gap-3 text-xs" style={{ gridTemplateColumns: columns }}>
                    <div className="font-semibold text-foreground">
                      <FieldValue field={nameField} item={item} />
                    </div>
                    {otherFields.map((f) => (
                      <FieldValue key={f.key} field={f} item={item} />
                    ))}
                  </div>
                )}
                {renderRowActions && (
                  <div className={cn("flex shrink-0 items-center justify-end gap-1.5", rowActionsClassName)}>{renderRowActions(item)}</div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 rounded-lg text-muted-foreground hover:text-foreground"
                  onClick={() => toggle(id)}
                  aria-expanded={open}
                  aria-label={open ? `Recolher detalhes de ${name}` : `Ver detalhes de ${name}`}
                  title={open ? "Recolher detalhes" : "Ver detalhes"}
                >
                  <ChevronDown className={cn("h-4 w-4 transition-transform duration-200", open && "rotate-180 text-foreground")} />
                </Button>
              </div>
              {open && (
                <div data-testid={`${testIdPrefix}-row-expanded-${id}`} className="border-t border-border/60 p-3 space-y-3">
                  {renderExpanded(item)}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
