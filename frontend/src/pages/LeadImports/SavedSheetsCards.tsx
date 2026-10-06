import React, { useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronDown, Eye, Trash2, FileSpreadsheet, Users, Calendar, User, RotateCcw, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStableColor } from "@/lib/stableColor";
import { cn } from "@/lib/utils";
import type { LeadImportItem } from "@/hooks/useLeadImports";
import { describeIncompleteImport, isImportIncomplete } from "@/lib/leadImports/importStatus";
import { ListFilterBar } from "@/components/ListFilterBar";
import { useListFilter } from "@/hooks/useListFilter";
import { SAVED_SHEETS_FILTER } from "@/lib/leadImportsListFilters";
import { useViewMode } from "@/hooks/useViewMode";
import { ViewModeToggle } from "@/components/ViewModeToggle";
import { RecordView, type RecordCardState, type RecordField } from "@/components/records/RecordView";

const formatSheetDate = (imp: LeadImportItem) => (imp.created_at ? format(new Date(imp.created_at), "dd/MM/yyyy", { locale: ptBR }) : "—");

/** Os campos do cartão fechado — e, na lista, as colunas. O cartão e a linha mostram exatamente estes. */
export const SHEET_FIELDS: RecordField<LeadImportItem>[] = [
  { key: "name", label: "Arquivo", render: (imp) => imp.source_name },
  {
    key: "rows",
    label: "Linhas importadas",
    // planilha incompleta NUNCA aparece como completa: o campo mostra o que entrou e quanto falta
    render: (imp) =>
      isImportIncomplete(imp)
        ? describeIncompleteImport(imp)
        : `${imp.imported_rows} ${imp.imported_rows === 1 ? "linha importada" : "linhas importadas"}`,
  },
  { key: "date", label: "Importada em", render: formatSheetDate },
  { key: "uploader", label: "Importada por", render: (imp) => imp.uploaded_by_email || "Não informado" },
];
const sheetField = (key: string) => SHEET_FIELDS.find((f) => f.key === key)!;

interface SavedSheetsCardsProps {
  imports: LeadImportItem[];
  isDeleting?: boolean;
  onViewImport: (imp: LeadImportItem) => void;
  /** Remove só o REGISTRO da planilha salva. Os leads no Banco não são tocados. */
  onDeleteImport: (id: string, name: string) => void;
  /** Abre a exclusão em massa de leads (por tag). Ausente = usuário sem permissão. */
  onDeleteLeads?: (imp: LeadImportItem) => void;
  /** Retoma uma importação incompleta com o MESMO arquivo, de onde o servidor parou. */
  onResumeImport?: (imp: LeadImportItem, file: File) => void;
  /** Importação em retomada agora (desabilita o botão). */
  resumingImportId?: string | null;
}

export function SavedSheetsCards({
  imports,
  isDeleting = false,
  onViewImport,
  onDeleteImport,
  onDeleteLeads,
  onResumeImport,
  resumingImportId = null,
}: SavedSheetsCardsProps) {
  const view = useViewMode("planilhas-salvas");
  // um seletor de arquivo para todas as planilhas incompletas: guarda qual está sendo retomada
  const resumeInputRef = useRef<HTMLInputElement | null>(null);
  const resumeTargetRef = useRef<LeadImportItem | null>(null);
  const openResumePicker = (imp: LeadImportItem) => {
    resumeTargetRef.current = imp;
    resumeInputRef.current?.click();
  };

  const renderResumeButton = (imp: LeadImportItem, compact = false) =>
    isImportIncomplete(imp) && onResumeImport ? (
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-testid={`sheet-resume-${imp.id}`}
        disabled={resumingImportId === imp.id}
        title="Selecione o mesmo arquivo: o envio continua de onde parou, sem duplicar."
        className={cn("text-xs gap-1.5 border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-700/60 dark:text-amber-300 dark:hover:bg-amber-950/30", compact ? "h-7 px-2" : "h-8")}
        onClick={(e) => {
          e.stopPropagation();
          openResumePicker(imp);
        }}
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Retomar
      </Button>
    ) : null;
  const { filtered: visibleImports, controls: filterControls } = useListFilter(imports, SAVED_SHEETS_FILTER);

  const renderDetails = (imp: LeadImportItem) => {
    const formattedFullDate = imp.created_at
      ? format(new Date(imp.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
      : "—";
    return (
      <>
        <div className="grid grid-cols-2 gap-2 text-xs bg-muted/40 p-2.5 rounded-lg border border-border/40">
          <div>
            <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
              Ignorados
            </span>
            <span className="font-mono text-xs text-foreground font-medium">
              {imp.skipped_rows || 0}
            </span>
          </div>
          <div>
            <span className="text-[10px] uppercase font-semibold text-muted-foreground block">
              Importado em
            </span>
            <span className="text-[11px] text-foreground font-medium">
              {formattedFullDate}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-xs h-8 font-medium gap-1.5"
            onClick={() => onViewImport(imp)}
          >
            <Eye className="h-3.5 w-3.5" />
            Ver leads
          </Button>

          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={isDeleting}
            title="Tira só esta planilha da lista. Os leads continuam no Banco."
            className="text-xs h-8 text-muted-foreground hover:text-foreground gap-1.5 justify-start"
            onClick={() => onDeleteImport(imp.id, imp.source_name)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remover registro da planilha
          </Button>

          {onDeleteLeads && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              title="Abre a exclusão de leads por tag, com prévia e confirmação."
              className="text-xs h-8 text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/30 gap-1.5 justify-start"
              onClick={() => onDeleteLeads(imp)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Excluir os leads desta planilha…
            </Button>
          )}
        </div>

      </>
    );
  };

  const renderCard = (imp: LeadImportItem, { expanded: isExpanded, toggle }: RecordCardState) => {
    const color = getStableColor(imp.id);

    const toggleExpand = (e: React.MouseEvent) => {
      e.stopPropagation();
      toggle();
    };

    return (
      <div
        data-testid={`sheet-card-${imp.id}`}
        className={cn(
          "rounded-xl border bg-card text-card-foreground shadow-sm transition-all overflow-hidden flex flex-col justify-between",
          isExpanded
            ? "ring-1 ring-border shadow-md border-border"
            : "border-border/70 hover:border-border hover:shadow-xs"
        )}
      >
        <div className="flex items-stretch min-w-0 flex-1">
          {/* Faixa lateral com cor estável determinística */}
          <div
            data-testid={`sheet-card-stripe-${imp.id}`}
            className={cn("w-1.5 self-stretch shrink-0 transition-opacity", color.stripe)}
            aria-hidden="true"
          />

          <div className="p-3.5 flex flex-col justify-between flex-1 min-w-0 gap-2">
            {/* Linha 1: ponto de cor, nome do arquivo ocupando todo o espaço, e seta encostada à direita */}
            <div
              data-testid={`sheet-line-1-${imp.id}`}
              className="flex items-center justify-between gap-2 min-w-0"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span
                  data-testid={`sheet-color-dot-${imp.id}`}
                  className={cn("h-2.5 w-2.5 rounded-full shrink-0", color.dot)}
                  title={`Cor: ${color.name}`}
                  aria-hidden="true"
                />
                <p
                  data-field="name"
                  data-testid={`sheet-name-${imp.id}`}
                  className="truncate font-display font-semibold text-foreground text-sm min-w-0 flex-1"
                  title={imp.source_name}
                >
                  {sheetField("name").render(imp)}
                </p>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground hover:bg-slate-100 dark:hover:bg-white/5 shrink-0 ml-auto"
                onClick={toggleExpand}
                aria-expanded={isExpanded}
                aria-label={
                  isExpanded
                    ? `Recolher detalhes de ${imp.source_name}`
                    : `Ver detalhes de ${imp.source_name}`
                }
                title={isExpanded ? "Recolher detalhes" : "Ver detalhes"}
              >
                <ChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform duration-200",
                    isExpanded && "rotate-180 text-foreground"
                  )}
                />
              </Button>
            </div>

            {/* Linha 2: total de leads e data de upload lado a lado */}
            <div
              data-testid={`sheet-line-2-${imp.id}`}
              className="flex items-center justify-between gap-2 text-xs text-muted-foreground min-w-0"
            >
              <div className="flex items-center gap-1.5 min-w-0 font-medium text-foreground">
                <Users className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span data-field="rows" data-testid={`sheet-leads-${imp.id}`}>
                  {sheetField("rows").render(imp)}
                </span>
              </div>

              <div className="flex items-center gap-1 shrink-0 text-muted-foreground text-[11px]">
                <Calendar className="h-3 w-3 shrink-0" />
                <span data-field="date" data-testid={`sheet-date-${imp.id}`}>{sheetField("date").render(imp)}</span>
              </div>
            </div>

            {/* Linha 3: quem subiu à esquerda */}
            <div
              data-testid={`sheet-line-3-${imp.id}`}
              className="flex items-center justify-between gap-2 text-xs text-muted-foreground pt-0.5 min-w-0"
            >
              <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span
                  data-field="uploader"
                  data-testid={`sheet-uploader-${imp.id}`}
                  className="truncate text-[11px]"
                  title={imp.uploaded_by_email || "Não informado"}
                >
                  {sheetField("uploader").render(imp)}
                </span>
              </div>
              {renderResumeButton(imp, true)}
            </div>
            {isImportIncomplete(imp) && (
              <p data-testid={`sheet-incomplete-${imp.id}`} className="flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                Não use esta planilha em campanhas até concluir a importação.
              </p>
            )}

            {isExpanded && (
              <div
                data-testid={`sheet-expanded-content-${imp.id}`}
                className="pt-3 mt-1 border-t border-border/60 space-y-3 animate-in fade-in-50 duration-150"
              >
                {renderDetails(imp)}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (imports.length === 0) {
    return (
      <div className="py-12 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
        <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 opacity-40" />
        Nenhuma planilha importada ainda.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ListFilterBar
        controls={filterControls}
        searchPlaceholder="Buscar por arquivo ou por quem importou..."
        testId="sheets-filter"
        trailing={<ViewModeToggle view={view} />}
      />
      {visibleImports.length === 0 ? (
        <div className="py-12 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
          Nenhuma planilha corresponde à busca ou aos filtros. Use "Limpar filtros" para ver todas.
        </div>
      ) : (
          <RecordView
            mode={view.mode}
            items={visibleImports}
            getId={(i) => i.id}
            fields={SHEET_FIELDS}
            stripeClass={(id) => getStableColor(id).stripe}
            testIdPrefix="sheet"
            labelOf={(i) => i.source_name}
            cardsTestId="saved-sheets-grid"
            cardsClassName="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5"
            renderCard={renderCard}
            renderExpanded={renderDetails}
            renderRowActions={(imp) => renderResumeButton(imp)}
          />
      )}
      <input
        ref={resumeInputRef}
        type="file"
        accept=".xlsx,.xls,.csv,.ods,.txt"
        className="hidden"
        data-testid="sheet-resume-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const target = resumeTargetRef.current;
          e.target.value = "";
          if (file && target && onResumeImport) onResumeImport(target, file);
        }}
      />
    </div>
  );
}
