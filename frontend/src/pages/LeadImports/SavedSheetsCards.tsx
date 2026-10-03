import React, { useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { ChevronDown, Eye, Trash2, FileSpreadsheet, Users, Calendar, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStableColor } from "@/lib/stableColor";
import { cn } from "@/lib/utils";
import type { LeadImportItem } from "@/hooks/useLeadImports";

interface SavedSheetsCardsProps {
  imports: LeadImportItem[];
  isDeleting?: boolean;
  onViewImport: (imp: LeadImportItem) => void;
  /** Remove só o REGISTRO da planilha salva. Os leads no Banco não são tocados. */
  onDeleteImport: (id: string, name: string) => void;
  /** Abre a exclusão em massa de leads (por tag). Ausente = usuário sem permissão. */
  onDeleteLeads?: (imp: LeadImportItem) => void;
}

export function SavedSheetsCards({
  imports,
  isDeleting = false,
  onViewImport,
  onDeleteImport,
  onDeleteLeads,
}: SavedSheetsCardsProps) {
  const [expandedSheetId, setExpandedSheetId] = useState<string | null>(null);

  if (imports.length === 0) {
    return (
      <div className="py-12 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
        <FileSpreadsheet className="h-8 w-8 mx-auto mb-2 opacity-40" />
        Nenhuma planilha importada ainda.
      </div>
    );
  }

  return (
    <div
      data-testid="saved-sheets-grid"
      className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5"
    >
      {imports.map((imp) => {
        const color = getStableColor(imp.id);
        const isExpanded = expandedSheetId === imp.id;

        const toggleExpand = (e: React.MouseEvent) => {
          e.stopPropagation();
          setExpandedSheetId((prev) => (prev === imp.id ? null : imp.id));
        };

        const formattedDate = imp.created_at
          ? format(new Date(imp.created_at), "dd/MM/yyyy", { locale: ptBR })
          : "—";

        const formattedFullDate = imp.created_at
          ? format(new Date(imp.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
          : "—";

        return (
          <div
            key={imp.id}
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
                      data-testid={`sheet-name-${imp.id}`}
                      className="truncate font-display font-semibold text-foreground text-sm min-w-0 flex-1"
                      title={imp.source_name}
                    >
                      {imp.source_name}
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
                    <span data-testid={`sheet-leads-${imp.id}`}>
                      {imp.imported_rows} {imp.imported_rows === 1 ? "linha importada" : "linhas importadas"}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0 text-muted-foreground text-[11px]">
                    <Calendar className="h-3 w-3 shrink-0" />
                    <span data-testid={`sheet-date-${imp.id}`}>{formattedDate}</span>
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
                      data-testid={`sheet-uploader-${imp.id}`}
                      className="truncate text-[11px]"
                      title={imp.uploaded_by_email || "Não informado"}
                    >
                      {imp.uploaded_by_email || "Não informado"}
                    </span>
                  </div>
                </div>

                {/* Bloco expandido: detalhes adicionais e ações */}
                {isExpanded && (
                  <div
                    data-testid={`sheet-expanded-content-${imp.id}`}
                    className="pt-3 mt-1 border-t border-border/60 space-y-3 animate-in fade-in-50 duration-150"
                  >
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
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
