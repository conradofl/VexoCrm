import { useState, type ChangeEvent, type Dispatch, type RefObject, type SetStateAction } from "react";
import { Filter, Info, Trash2, Plus, Check, ChevronDown, Loader2, AlertTriangle, AlertCircle, CheckCircle2, FileSpreadsheet, Database } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InfoTip } from "@/components/InfoTip";
import { cn } from "@/lib/utils";
import { ALL_IMPORTS_VALUE, CRM_BASE_VALUE, type LeadImportItem } from "@/hooks/useLeadImports";
import { getLeadField, type FilterRule, type ColumnMappingItem, type CustomFieldType, type CustomFieldDefinition } from "@/lib/leadImports/spreadsheet";
import { darkSelectContentClass, darkSelectItemClass } from "./styles";
import { SpreadsheetUploader } from "./SpreadsheetUploader";
import { ColumnMappingStep } from "./ColumnMappingStep";

export interface PhoneAuditStats {
  total: number;
  valid: number;
  intactCount: number;
  completedCount: number;
  incompleteCount: number;
  completedList: Array<{ original: string; result: string }>;
  incompleteList: Array<{ original: string; reason: string }>;
}

export interface BancoAudienceInfo {
  description: string;
  count: number;
}

interface LeadSourceStepProps {
  campaignName: string;
  setCampaignName: (value: string) => void;

  fileInputRef: RefObject<HTMLInputElement>;
  selectedFile: File | null;
  isImportingFile: boolean;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onImportSpreadsheetOnly: () => void;
  showNumbersModal: boolean;
  onCloseNumbersModal: () => void;

  defaultDdd?: string;
  onDefaultDddChange?: (value: string) => void;
  phoneAuditStats?: PhoneAuditStats;

  setSelectedFile: Dispatch<SetStateAction<File | null>>;
  setParsedRows: Dispatch<SetStateAction<Record<string, unknown>[]>>;

  selectedImportId: string;
  setSelectedImportId: (value: string) => void;
  selectedImportIds: string[];
  setSelectedImportIds: Dispatch<SetStateAction<string[]>>;
  imports: LeadImportItem[];

  filterRules: FilterRule[];
  setFilterRules: Dispatch<SetStateAction<FilterRule[]>>;
  spreadsheetColumns: string[];

  parsedRows: Record<string, unknown>[];
  parsedLeadsStats: { total: number; valid: number; invalid: number };
  previewOpen: boolean;
  setPreviewOpen: Dispatch<SetStateAction<boolean>>;
  previewRows: Record<string, unknown>[];

  hasSourceRows?: boolean;
  isLoadingSourceRows?: boolean;
  isMultiSpreadsheet?: boolean;
  missingColumnWarnings?: Array<{
    column: string;
    missingSpreadsheetNames: string[];
    count: number;
    includeMissing: boolean;
  }>;
  onToggleIncludeMissing?: (column: string) => void;

  bancoAudience?: BancoAudienceInfo | null;
  onDiscardBancoAudience?: () => void;

  uploadedColumns?: string[];
  rawUploadedRows?: Record<string, unknown>[];
  columnMappings?: ColumnMappingItem[];
  setColumnMappings?: (mappings: ColumnMappingItem[]) => void;
  knownCustomFields?: Array<{ key: string; label: string; type: CustomFieldType }>;
  availableCustomFields?: CustomFieldDefinition[];
  excludedCustomFields?: Array<{ key: string; label: string; missingInBaseNames: string[]; count: number }>;
  isMultiBaseCustomFields?: boolean;
  getMissingCountForField?: (fieldKey: string) => number;
}

export function handleSelectSavedBaseAudience(
  hasBancoAudience: boolean,
  onDiscard: () => void,
  clearUpload: () => void,
  action: () => void
): { discarded: boolean; warningMessage?: string } {
  let discarded = false;
  let warningMessage: string | undefined;
  if (hasBancoAudience) {
    onDiscard();
    discarded = true;
    warningMessage = "Público do Banco de Dados descartado ao selecionar uma base salva.";
  }
  clearUpload();
  action();
  return { discarded, warningMessage };
}

export function LeadSourceStep({
  selectedImportIds,
  setSelectedImportIds,
  campaignName,
  setCampaignName,
  fileInputRef,
  selectedFile,
  isImportingFile,
  onFileChange,
  onImportSpreadsheetOnly,
  showNumbersModal,
  onCloseNumbersModal,
  defaultDdd = "34",
  onDefaultDddChange,
  phoneAuditStats,
  setSelectedFile,
  setParsedRows,
  selectedImportId,
  setSelectedImportId,
  imports,
  filterRules,
  setFilterRules,
  spreadsheetColumns,
  parsedRows,
  parsedLeadsStats,
  previewOpen,
  setPreviewOpen,
  previewRows,
  hasSourceRows = false,
  isLoadingSourceRows = false,
  isMultiSpreadsheet = false,
  missingColumnWarnings = [],
  onToggleIncludeMissing,
  bancoAudience,
  onDiscardBancoAudience,
  uploadedColumns = [],
  rawUploadedRows = [],
  columnMappings = [],
  setColumnMappings,
  knownCustomFields = [],
  availableCustomFields,
  excludedCustomFields = [],
  isMultiBaseCustomFields = false,
  getMissingCountForField,
}: LeadSourceStepProps) {
  const [showPhoneAuditModal, setShowPhoneAuditModal] = useState(false);

  // Escolher base pronta e planilha nova sao mutuamente exclusivos.
  const clearUpload = () => {
    setSelectedFile(null);
    setParsedRows([]);
    setFilterRules([]);
    if (setColumnMappings) setColumnMappings([]);
  };

  const handleSelectSavedBase = (action: () => void) => {
    const res = handleSelectSavedBaseAudience(
      !!bancoAudience,
      () => onDiscardBancoAudience?.(),
      clearUpload,
      action
    );
    if (res.discarded && res.warningMessage) {
      toast.info(res.warningMessage);
    }
  };

  const totalSelectedLeads = imports
    .filter((imp) => selectedImportIds.includes(imp.id))
    .reduce((acc, imp) => acc + (imp.imported_rows || 0), 0);

  const canShowFiltersAndPreview = hasSourceRows || parsedRows.length > 0;
  // Se não tem campos customizados: esconder o bloco de filtros!
  const hasCustomFields = availableCustomFields ? availableCustomFields.length > 0 : spreadsheetColumns.length > 0;
  const canShowFilters = !isLoadingSourceRows && canShowFiltersAndPreview && hasCustomFields;

  const selectableFields = availableCustomFields && availableCustomFields.length > 0
    ? availableCustomFields
    : spreadsheetColumns.map((c) => ({ key: c, label: c, type: "text" as const }));

  return (
    <Card className="border-border bg-card shadow-sm text-card-foreground rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500 text-[10px] text-white">1</span>
          Base de Leads
        </CardTitle>
        <CardDescription>Carregue a planilha XLSX/CSV com contatos ou selecione uma existente</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <label className="text-xs font-semibold text-slate-500">Nome da Campanha / Disparo <span className="text-red-500">*</span></label>
          <Input
            placeholder="Ex: Oferta Black Friday"
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            className="h-12 rounded-xl border-indigo-100 bg-white dark:border-indigo-900/40 dark:bg-slate-900 focus-visible:ring-indigo-500"
          />
        </div>

        {bancoAudience && (
          <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-200">
            <div className="flex items-center gap-2.5">
              <Database className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <div>
                <p className="font-semibold text-foreground">Público do Banco de Dados Ativo</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{bancoAudience.description}</p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                onDiscardBancoAudience?.();
                toast.info("Público do Banco de Dados descartado.");
              }}
              className="h-7 text-xs border-amber-500/30 hover:bg-amber-500/20 text-amber-900 dark:text-amber-100"
            >
              Descartar
            </Button>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-500">Selecionar Planilha</label>
            <SpreadsheetUploader
              fileInputRef={fileInputRef}
              selectedFile={selectedFile}
              isImportingFile={isImportingFile}
              onFileChange={onFileChange}
              onImport={onImportSpreadsheetOnly}
              onClear={() => {
                setSelectedFile(null);
                setParsedRows([]);
                setFilterRules([]);
                setCampaignName("");
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
              showNumbersModal={showNumbersModal}
              onCloseNumbersModal={onCloseNumbersModal}
              defaultDdd={defaultDdd}
              onDefaultDddChange={onDefaultDddChange}
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-500">Ou use uma importada</label>
            {/* Multi-selecao: da para disparar para varias planilhas de uma vez.
                "Todas" e "CRM" continuam exclusivos entre si e limpam a lista. */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="flex h-12 w-full items-center justify-between rounded-xl border border-input bg-background px-3 text-sm text-left"
                >
                  <span className="truncate">
                    {bancoAudience
                      ? "Nenhuma base selecionada (usando público do Banco)"
                      : selectedImportIds.length > 0
                        ? `${selectedImportIds.length} ${selectedImportIds.length === 1 ? "planilha selecionada" : "planilhas selecionadas"} (${totalSelectedLeads} leads)`
                        : selectedImportId === CRM_BASE_VALUE
                          ? "Todos os leads do CRM"
                          : selectedImportId === ALL_IMPORTS_VALUE
                            ? "Todas as bases importadas"
                            : imports.find(i => i.id === selectedImportId)
                              ? `${imports.find(i => i.id === selectedImportId)?.source_name} (${imports.find(i => i.id === selectedImportId)?.imported_rows} leads)`
                              : "Selecione uma base"}
                  </span>
                  <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-1" align="start">
                <div className="max-h-72 overflow-y-auto">
                  <button
                    type="button"
                    onClick={() => {
                      handleSelectSavedBase(() => {
                        setSelectedImportIds([]);
                        setSelectedImportId(ALL_IMPORTS_VALUE);
                      });
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
                  >
                    <Check className={cn("h-4 w-4", !bancoAudience && selectedImportIds.length === 0 && selectedImportId === ALL_IMPORTS_VALUE ? "opacity-100" : "opacity-0")} />
                    Todas as bases importadas
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      handleSelectSavedBase(() => {
                        setSelectedImportIds([]);
                        setSelectedImportId(CRM_BASE_VALUE);
                      });
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
                  >
                    <Check className={cn("h-4 w-4", !bancoAudience && selectedImportIds.length === 0 && selectedImportId === CRM_BASE_VALUE ? "opacity-100" : "opacity-0")} />
                    Todos os leads do CRM
                  </button>

                  {imports.length > 0 && (
                    <div className="my-1 border-t border-border pt-1">
                      <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        Planilhas importadas
                      </p>
                      {imports.map((imp) => {
                        const checked = !bancoAudience && (selectedImportIds.includes(imp.id) || (selectedImportIds.length === 0 && selectedImportId === imp.id));
                        return (
                          <label
                            key={imp.id}
                            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-accent"
                          >
                            <Checkbox
                              checked={checked}
                              onCheckedChange={() => {
                                handleSelectSavedBase(() => {
                                  setSelectedImportIds((current) => {
                                    const already = current.includes(imp.id);
                                    if (already) {
                                      return current.filter((id) => id !== imp.id);
                                    }
                                    return [...current, imp.id];
                                  });
                                  setSelectedImportId("");
                                });
                              }}
                            />
                            <span className="truncate">
                              {imp.source_name}{" "}
                              <span className="text-slate-400">({imp.imported_rows} leads)</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Etapa de Mapeamento de Colunas da Planilha Carregada */}
        {selectedFile && uploadedColumns.length > 0 && setColumnMappings && (
          <ColumnMappingStep
            columns={uploadedColumns}
            sampleRows={rawUploadedRows}
            mappings={columnMappings}
            onMappingChange={setColumnMappings}
            knownCustomFields={knownCustomFields}
            isImporting={isImportingFile}
            onConfirmImport={onImportSpreadsheetOnly}
            onCancel={clearUpload}
            totalRowsCount={rawUploadedRows.length}
            fileName={selectedFile.name}
          />
        )}

        {/* Loading state for imported spreadsheets */}
        {isLoadingSourceRows && (
          <div className="rounded-xl border border-slate-200/60 bg-slate-50/40 p-6 dark:border-white/5 dark:bg-slate-900/10 flex items-center justify-center gap-2.5 text-xs text-slate-500">
            <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
            <span>Carregando dados da base selecionada...</span>
          </div>
        )}

        {/* Dynamic Spreadsheet Filter Builder */}
        {canShowFilters && (
          <div className="rounded-xl border border-indigo-100/60 bg-indigo-50/10 p-4 dark:border-indigo-950/20 dark:bg-indigo-950/5 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5 text-indigo-500" />
                Filtros de Segmentação da Planilha
                <InfoTip text="Filtre os contatos da planilha antes de realizar a importação e disparo. Apenas linhas que atendam aos filtros serão enviadas." />
              </p>
              {filterRules.length > 0 && (
                <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-400 px-2 py-0.5 rounded-full">
                  {filterRules.length} {filterRules.length === 1 ? "regra ativa" : "regras ativas"}
                </span>
              )}
            </div>

            {/* Aviso de campos excluídos em multi-bases */}
            {isMultiBaseCustomFields && excludedCustomFields.length > 0 && (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-300/60 bg-amber-500/10 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    {excludedCustomFields.length} {excludedCustomFields.length === 1 ? "campo foi excluído" : "campos foram excluídos"} por não {excludedCustomFields.length === 1 ? "estar presente" : "estarem presentes"} em todas as bases selecionadas:
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {excludedCustomFields.map((f) => `${f.label} (ausente em: ${f.missingInBaseNames.join(", ")})`).join("; ")}
                  </p>
                </div>
              </div>
            )}

            {/* Help/explanation box for spreadsheet filters */}
            <div className="flex items-start gap-2.5 rounded-lg border border-blue-400/20 bg-blue-500/5 p-3 text-[11px] leading-relaxed text-blue-700 dark:text-blue-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
              <div className="space-y-1">
                <p className="font-semibold">Como funciona a segmentação da planilha?</p>
                <p>
                  Você pode filtrar os contatos dinamicamente antes de realizar o envio. O sistema lê os campos customizados da base selecionada e permite criar regras tipadas de segmentação.
                </p>
                <ul className="list-disc pl-4 space-y-0.5 mt-1">
                  <li><strong>Número:</strong> Comparação numérica real (40 &gt; 9, menor que, igual a).</li>
                  <li><strong>Data:</strong> Cronologia real (anterior a, posterior a, entre datas).</li>
                  <li><strong>Texto:</strong> Busca por texto (contém, igual a).</li>
                </ul>
                <p className="text-muted-foreground text-[10px] mt-1">
                  * Apenas os leads que atenderem a todas as regras ativas serão inseridos na fila de disparos.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {filterRules.map((rule, idx) => {
                const warning = missingColumnWarnings.find((w) => w.column === rule.column);
                const fieldDef = selectableFields.find((f) => f.key === rule.column);
                const effectiveType = rule.type || fieldDef?.type || "text";
                const missingCount = getMissingCountForField ? getMissingCountForField(rule.column) : 0;

                return (
                  <div key={idx} className="space-y-2">
                    <div className="flex flex-wrap gap-2 items-center bg-white dark:bg-black/35 p-2.5 rounded-xl border border-slate-200/80 dark:border-white/5 shadow-sm">
                      <div className="flex-1 min-w-[140px] flex flex-col gap-0.5">
                        <Select
                          value={rule.column}
                          onValueChange={(val) => {
                            const updated = [...filterRules];
                            const selectedDef = selectableFields.find((f) => f.key === val);
                            const newType = selectedDef?.type || "text";
                            updated[idx].column = val;
                            updated[idx].type = newType;
                            if (newType === "number") updated[idx].operator = "gt";
                            else if (newType === "date") updated[idx].operator = "after";
                            else updated[idx].operator = "contains";
                            setFilterRules(updated);
                          }}
                        >
                          <SelectTrigger className="h-9 text-xs">
                            <SelectValue placeholder="Campo..." />
                          </SelectTrigger>
                          <SelectContent className={darkSelectContentClass}>
                            {selectableFields.map((f) => (
                              <SelectItem key={f.key} value={f.key} className={darkSelectItemClass}>
                                {f.label || f.key} {f.type ? `(${f.type})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {missingCount > 0 && (
                          <span className="text-[10px] text-amber-600 dark:text-amber-400 pl-1">
                            {missingCount} leads não têm este campo preenchido
                          </span>
                        )}
                      </div>

                      <Select
                        value={rule.operator}
                        onValueChange={(val: any) => {
                          const updated = [...filterRules];
                          updated[idx].operator = val;
                          setFilterRules(updated);
                        }}
                      >
                        <SelectTrigger className="h-9 text-xs max-w-[130px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className={darkSelectContentClass}>
                          {effectiveType === "number" && (
                            <>
                              <SelectItem value="equals" className={darkSelectItemClass}>Igual a</SelectItem>
                              <SelectItem value="gt" className={darkSelectItemClass}>Maior que</SelectItem>
                              <SelectItem value="lt" className={darkSelectItemClass}>Menor que</SelectItem>
                            </>
                          )}
                          {effectiveType === "date" && (
                            <>
                              <SelectItem value="before" className={darkSelectItemClass}>Anterior a</SelectItem>
                              <SelectItem value="after" className={darkSelectItemClass}>Posterior a</SelectItem>
                              <SelectItem value="between" className={darkSelectItemClass}>Entre</SelectItem>
                              <SelectItem value="equals" className={darkSelectItemClass}>Na data</SelectItem>
                            </>
                          )}
                          {effectiveType === "text" && (
                            <>
                              <SelectItem value="contains" className={darkSelectItemClass}>Contém</SelectItem>
                              <SelectItem value="equals" className={darkSelectItemClass}>Igual a</SelectItem>
                            </>
                          )}
                        </SelectContent>
                      </Select>

                      {rule.operator === "between" ? (
                        <div className="flex items-center gap-1.5 flex-1 min-w-[200px]">
                          <Input
                            placeholder="De (DD/MM/AAAA)..."
                            value={rule.value}
                            onChange={(e) => {
                              const updated = [...filterRules];
                              updated[idx].value = e.target.value;
                              setFilterRules(updated);
                            }}
                            className="h-9 text-xs flex-1"
                          />
                          <span className="text-xs text-muted-foreground">até</span>
                          <Input
                            placeholder="Até (DD/MM/AAAA)..."
                            value={rule.secondValue || ""}
                            onChange={(e) => {
                              const updated = [...filterRules];
                              updated[idx].secondValue = e.target.value;
                              setFilterRules(updated);
                            }}
                            className="h-9 text-xs flex-1"
                          />
                        </div>
                      ) : (
                        <Input
                          type={effectiveType === "number" ? "number" : "text"}
                          placeholder={
                            effectiveType === "date"
                              ? "Data (DD/MM/AAAA)..."
                              : effectiveType === "number"
                              ? "Número (ex: 40)..."
                              : "Valor de comparação..."
                          }
                          value={rule.value}
                          onChange={(e) => {
                            const updated = [...filterRules];
                            updated[idx].value = e.target.value;
                            setFilterRules(updated);
                          }}
                          className="h-9 text-xs flex-1 min-w-[140px]"
                        />
                      )}

                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => {
                          setFilterRules(filterRules.filter((_, rIdx) => rIdx !== idx));
                        }}
                        className="h-9 w-9 p-0 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/20 rounded-xl"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    {/* Missing column warning box for multi-spreadsheet / CRM filters */}
                    {warning && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/50 bg-amber-500/10 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
                        <div className="flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />
                          <span>
                            <strong>{warning.count} {warning.count === 1 ? "lead" : "leads"}</strong> da planilha{" "}
                            <em>"{warning.missingSpreadsheetNames.join(", ")}"</em> não {warning.missingSpreadsheetNames.length === 1 ? "possui" : "possuem"} a coluna{" "}
                            <strong>"{warning.column}"</strong> e {warning.includeMissing ? "foram mantidos para disparo" : "foram excluídos pelo filtro"}.
                          </span>
                        </div>
                        <label className="flex items-center gap-1.5 cursor-pointer font-semibold select-none text-xs text-amber-900 dark:text-amber-200 hover:opacity-80">
                          <Checkbox
                            checked={warning.includeMissing}
                            onCheckedChange={() => onToggleIncludeMissing?.(warning.column)}
                          />
                          <span>Incluir mesmo assim</span>
                        </label>
                      </div>
                    )}
                  </div>
                );
              })}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (selectableFields.length > 0) {
                    const first = selectableFields[0];
                    const op = first.type === "number" ? "gt" : first.type === "date" ? "after" : "equals";
                    setFilterRules([
                      ...filterRules,
                      { column: first.key, operator: op, value: "", type: first.type }
                    ]);
                  }
                }}
                className="w-full h-9 text-xs border-dashed border-indigo-200 hover:border-indigo-300 text-indigo-600 dark:border-indigo-800/40 dark:text-indigo-400 bg-transparent rounded-xl"
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar Filtro de Campo
              </Button>
            </div>
          </div>
        )}

        {/* Simplified preview of uploaded or imported leads */}
        {!isLoadingSourceRows && canShowFiltersAndPreview && (
          <div className="rounded-xl border border-slate-200/60 bg-slate-50/40 p-4 dark:border-white/5 dark:bg-slate-900/10 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex flex-wrap gap-4">
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">Total Leads</p>
                  <p className="text-base font-bold text-slate-700 dark:text-slate-200">
                    {phoneAuditStats ? phoneAuditStats.total : parsedLeadsStats.total}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-emerald-500">WhatsApp Válidos</p>
                  <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                    {phoneAuditStats ? phoneAuditStats.valid : parsedLeadsStats.valid}
                  </p>
                </div>
                {phoneAuditStats && phoneAuditStats.completedCount > 0 && (
                  <div>
                    <p className="text-[10px] uppercase font-bold text-indigo-500">Completados c/ DDD</p>
                    <p className="text-base font-bold text-indigo-600 dark:text-indigo-400">{phoneAuditStats.completedCount}</p>
                  </div>
                )}
                {(phoneAuditStats ? phoneAuditStats.incompleteCount : parsedLeadsStats.invalid) > 0 && (
                  <div>
                    <p className="text-[10px] uppercase font-bold text-rose-500">Incompletos / Inválidos</p>
                    <p className="text-base font-bold text-rose-600 dark:text-rose-400">
                      {phoneAuditStats ? phoneAuditStats.incompleteCount : parsedLeadsStats.invalid}
                    </p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {phoneAuditStats && (phoneAuditStats.completedCount > 0 || phoneAuditStats.incompleteCount > 0) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowPhoneAuditModal(true)}
                    className="text-xs h-7 border-indigo-200 text-indigo-600 dark:border-indigo-800 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                  >
                    🔍 Ver Auditoria
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setPreviewOpen(!previewOpen)}
                  className="text-xs h-7 text-indigo-500 hover:text-indigo-600"
                >
                  {previewOpen ? "Esconder Tabela" : "Ver Contatos"}
                </Button>
              </div>
            </div>

            {phoneAuditStats && (phoneAuditStats.completedCount > 0 || phoneAuditStats.incompleteCount > 0) && (
              <div className="rounded-lg bg-indigo-50/50 p-2.5 text-xs text-indigo-900 dark:bg-indigo-950/30 dark:text-indigo-200 border border-indigo-100 dark:border-indigo-900/30 space-y-1">
                {phoneAuditStats.completedCount > 0 && (
                  <p>
                    ⚡ <strong>{phoneAuditStats.completedCount} números</strong> serão completados com{" "}
                    {defaultDdd ? `DDD ${defaultDdd} e ` : ""}DDI 55.
                  </p>
                )}
                {phoneAuditStats.incompleteCount > 0 && (
                  <p className="text-rose-600 dark:text-rose-400">
                    ⚠ <strong>{phoneAuditStats.incompleteCount} números</strong> ficaram incompletos e não serão importados.
                  </p>
                )}
              </div>
            )}

            {previewOpen && (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-white/5 dark:bg-black/30">
                <Table className="text-[11px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 py-0">Nome</TableHead>
                      <TableHead className="h-8 py-0">Telefone</TableHead>
                      {isMultiSpreadsheet && <TableHead className="h-8 py-0">Origem / Planilha</TableHead>}
                      <TableHead className="h-8 py-0">Outras Colunas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="h-8 py-0.5 font-medium">{getLeadField(row, ["nome", "name"]) || "Sem nome"}</TableCell>
                        <TableCell className="h-8 py-0.5 font-mono">{getLeadField(row, ["telefone", "phone", "number"]) || "—"}</TableCell>
                        {isMultiSpreadsheet && (
                          <TableCell className="h-8 py-0.5">
                            <span className="inline-flex items-center rounded-md bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 truncate max-w-[140px]">
                              {String(row.__importName || "Planilha")}
                            </span>
                          </TableCell>
                        )}
                        <TableCell className="h-8 py-0.5 text-muted-foreground truncate max-w-[150px]">
                          {Object.keys(row)
                            .filter((k) => !["nome", "name", "telefone", "phone", "id", "import_id", "client_id", "__importName", "__importId", "__imported", "__rowNumber"].includes(k.toLowerCase()))
                            .map((k) => `${k}: ${row[k]}`)
                            .join(", ") || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {parsedLeadsStats.total > previewRows.length && (
                  <div className="px-3 py-1.5 text-[10px] text-muted-foreground border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-black/20">
                    Mostrando amostra inicial de {previewRows.length} de {parsedLeadsStats.total} contatos filtrados da base.
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Modal: Auditoria Detalhada dos Telefones */}
        {phoneAuditStats && (
          <Dialog open={showPhoneAuditModal} onOpenChange={setShowPhoneAuditModal}>
            <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col">
              <DialogHeader>
                <DialogTitle className="text-sm font-bold flex items-center gap-2">
                  <FileSpreadsheet className="w-4 h-4 text-indigo-500" />
                  Auditoria de Telefones da Planilha
                </DialogTitle>
                <DialogDescription className="text-xs">
                  Confira como os números serão tratados antes de confirmar o disparo ou importação.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 py-2 flex-1 overflow-y-auto min-h-0 text-xs">
                {phoneAuditStats.completedCount > 0 && (
                  <div className="space-y-2">
                    <p className="font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Números Completados com Sucesso ({phoneAuditStats.completedList.length}):
                    </p>
                    <div className="rounded-lg border border-border bg-background overflow-hidden max-h-48 overflow-y-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-muted/50 font-semibold border-b border-border sticky top-0">
                          <tr>
                            <th className="p-2">Original na Planilha</th>
                            <th className="p-2">Resultado Higienizado</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border font-mono">
                          {phoneAuditStats.completedList.map((item, i) => (
                            <tr key={i} className="hover:bg-muted/20">
                              <td className="p-2 text-muted-foreground">{item.original}</td>
                              <td className="p-2 text-emerald-600 dark:text-emerald-400 font-bold">{item.result}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {phoneAuditStats.incompleteCount > 0 && (
                  <div className="space-y-2">
                    <p className="font-semibold text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5" />
                      Números Incompletos / Descartados ({phoneAuditStats.incompleteList.length}):
                    </p>
                    <div className="rounded-lg border border-border bg-background overflow-hidden max-h-48 overflow-y-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-muted/50 font-semibold border-b border-border sticky top-0">
                          <tr>
                            <th className="p-2">Original na Planilha</th>
                            <th className="p-2">Motivo</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border font-mono">
                          {phoneAuditStats.incompleteList.map((item, i) => (
                            <tr key={i} className="hover:bg-muted/20">
                              <td className="p-2 text-rose-500 font-medium">{item.original}</td>
                              <td className="p-2 text-muted-foreground font-sans">{item.reason}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>

              <DialogFooter>
                <Button size="sm" onClick={() => setShowPhoneAuditModal(false)} className="text-xs">
                  Fechar
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </CardContent>
    </Card>
  );
}
