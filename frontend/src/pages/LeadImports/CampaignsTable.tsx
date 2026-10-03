import { useState } from "react";
import { Copy, Pencil, Trash2, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/leadImports/spreadsheet";
import { getStableColor } from "@/lib/stableColor";
import { CAMPAIGN_STATUS_LABELS, type Campaign } from "@/hooks/useCampanhas";
import { ListFilterBar } from "@/components/ListFilterBar";
import { useListFilter } from "@/hooks/useListFilter";
import { CAMPAIGNS_FILTER } from "@/lib/leadImportsListFilters";
import { DispatchKpiCards } from "./DispatchKpiCards";

interface CampaignsTableProps {
  clientId: string | null;
  campaigns: Campaign[];
  loadingCampaigns: boolean;
  onEditCampaign: (campaign: Campaign) => void;
  onDuplicateCampaign: (campaign: Campaign) => void;
  onDeleteCampaign: (campaign: Campaign) => void;
}

export function CampaignsTable({
  clientId,
  campaigns,
  loadingCampaigns,
  onEditCampaign,
  onDuplicateCampaign,
  onDeleteCampaign,
}: CampaignsTableProps) {
  const [expandedCampaignId, setExpandedCampaignId] = useState<string | null>(null);
  const { filtered: filteredCampaigns, controls: filterControls } = useListFilter(campaigns, CAMPAIGNS_FILTER);

  return (
    <div className="space-y-4">
      <DispatchKpiCards clientId={clientId} />

      <Card className="border-border bg-card shadow-lg text-card-foreground rounded-2xl">
        <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base font-bold">Campanhas Configuradas</CardTitle>
            <CardDescription>Clique para ver detalhes, editar as mensagens ou excluir as réguas</CardDescription>
          </div>
        </CardHeader>

        <CardContent className="p-4 sm:p-6 pt-0 space-y-4">
          <ListFilterBar
            controls={filterControls}
            searchPlaceholder="Buscar por campanha ou último chip..."
            testId="campaigns-filter"
          />
          {loadingCampaigns ? (
            <div className="p-6 text-center text-xs text-muted-foreground animate-pulse">
              Carregando dados das campanhas...
            </div>
          ) : filteredCampaigns.length === 0 ? (
            <div className="p-8">
              <EmptyState
                title="Nenhuma campanha encontrada"
                description={
                  filterControls.isFiltered
                    ? "Nenhuma campanha corresponde à busca ou aos filtros. Use \"Limpar filtros\" para ver todas."
                    : "Use o Novo Disparo para registrar a primeira campanha por planilha."
                }
              />
            </div>
          ) : (
            /* Grade responsiva: 3 colunas em tela larga, 2 em média, 1 no celular */
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredCampaigns.map((c) => {
                const color = getStableColor(c.id);
                const isExpanded = expandedCampaignId === c.id;

                const toggleExpand = () => {
                  setExpandedCampaignId((prev) => (prev === c.id ? null : c.id));
                };

                return (
                  <div
                    key={c.id}
                    data-testid={`campaign-card-${c.id}`}
                    className={cn(
                      "relative flex flex-col rounded-2xl border border-border/80 bg-card p-4 shadow-sm hover:shadow-md transition-all duration-200",
                      "border-l-[5px]",
                      color.borderLeft
                    )}
                  >
                    {/* 
                      Cartão fechado mostra exatamente quatro campos:
                      1. Nome (linha 1 com ponto de cor e seta)
                      2. Estado (linha 2)
                      3. Quantos leads (linha 3)
                      4. Data (linha 3)
                    */}
                    <div className="flex flex-col gap-2.5">
                      {/* Linha 1: ponto de cor, nome da campanha ocupando todo o espaço disponível, e seta encostada à direita */}
                      <div
                        data-testid={`campaign-line-1-${c.id}`}
                        className="flex items-center justify-between gap-2 min-w-0"
                      >
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <span
                            className={cn("h-2.5 w-2.5 rounded-full shrink-0", color.dot)}
                            title={`Cor: ${color.name}`}
                            aria-hidden="true"
                          />
                          <p
                            data-testid={`campaign-name-${c.id}`}
                            className="truncate font-display font-semibold text-foreground text-sm min-w-0 flex-1"
                            title={c.name}
                          >
                            {c.name}
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
                              ? `Recolher detalhes de ${c.name}`
                              : `Ver detalhes de ${c.name}`
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

                      {/* Linha 2: estado da campanha (badge de status e modo) */}
                      <div
                        data-testid={`campaign-line-2-${c.id}`}
                        className="flex items-center gap-1.5 flex-wrap min-w-0"
                      >
                        <Badge
                          data-testid={`campaign-status-${c.id}`}
                          variant="outline"
                          className={cn(
                            "text-[10px] font-bold uppercase",
                            c.status === "active"
                              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                              : c.status === "paused"
                              ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                              : "border-slate-300/80 bg-slate-100/50 text-slate-700 dark:border-white/10 dark:bg-white/5 dark:text-slate-300"
                          )}
                        >
                          {CAMPAIGN_STATUS_LABELS[c.status] ?? c.status ?? "Rascunho"}
                        </Badge>
                        <span
                          data-testid={`campaign-mode-${c.id}`}
                          className={cn(
                            "inline-block rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold uppercase",
                            c.mode === "agente"
                              ? "border-sky-500/40 bg-sky-500/10 text-sky-500 dark:text-sky-300"
                              : "border-border/60 text-muted-foreground"
                          )}
                        >
                          {c.mode === "agente" ? "Agente IA" : "Disparo Direto"}
                        </span>
                      </div>

                      {/* Linha 3: quantos leads à esquerda e data à direita */}
                      <div
                        data-testid={`campaign-line-3-${c.id}`}
                        className="flex items-center justify-between gap-2 text-xs pt-1 border-t border-border/40 min-w-0"
                      >
                        <span
                          data-testid={`campaign-leads-${c.id}`}
                          className="font-medium text-foreground truncate"
                        >
                          {c.limit_per_run} leads por lote
                        </span>
                        <span
                          data-testid={`campaign-date-${c.id}`}
                          className="text-[11px] text-muted-foreground shrink-0"
                        >
                          {formatDateTime(c.created_at)}
                        </span>
                      </div>
                    </div>

                    {/* O resto abre aqui dentro quando o cartão é expandido */}
                    {isExpanded && (
                      <div
                        data-testid={`campaign-details-${c.id}`}
                        className="mt-3.5 pt-3.5 border-t border-border/80 space-y-3 animate-in fade-in duration-150"
                      >
                        <div className="space-y-1 text-xs text-muted-foreground bg-muted/20 p-2.5 rounded-xl border border-border/40">
                          <p>
                            <span className="font-semibold text-foreground">Empresa:</span>{" "}
                            {c.client_name ?? "Empresa padrão"}
                          </p>
                          <p>
                            <span className="font-semibold text-foreground">Base:</span>{" "}
                            {c.import_id ? "Base importada" : "Geral"}
                          </p>
                          <p data-testid={`campaign-last-chip-${c.id}`}>
                            <span className="font-semibold text-foreground">Último chip:</span>{" "}
                            {c.chip_name ?? "Nenhum lote enviado ainda"}
                          </p>
                        </div>

                        {/* Ações da campanha */}
                        <div className="flex items-center justify-end gap-1.5 pt-1">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1 rounded-xl text-xs"
                            title="Editar"
                            onClick={() => onEditCampaign(c)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            <span>Editar</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1 rounded-xl text-xs"
                            title="Duplicar: cria uma cópia no formulário. A campanha original não muda."
                            onClick={() => onDuplicateCampaign(c)}
                          >
                            <Copy className="h-3.5 w-3.5" />
                            <span>Duplicar</span>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 gap-1 rounded-xl text-xs text-rose-500 border-rose-200/40 hover:bg-rose-50 dark:hover:bg-rose-950/20"
                            title="Excluir"
                            onClick={() => void onDeleteCampaign(c)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            <span>Excluir</span>
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
