import { type ChangeEvent, type Dispatch, type RefObject, type SetStateAction } from "react";
import { Filter, Info, Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InfoTip } from "@/components/InfoTip";
import { ALL_IMPORTS_VALUE, CRM_BASE_VALUE, type LeadImportItem } from "@/hooks/useLeadImports";
import { getLeadField, type FilterRule } from "@/lib/leadImports/spreadsheet";
import { darkSelectContentClass, darkSelectItemClass } from "./styles";
import { SpreadsheetUploader } from "./SpreadsheetUploader";

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

  setSelectedFile: Dispatch<SetStateAction<File | null>>;
  setParsedRows: Dispatch<SetStateAction<Record<string, unknown>[]>>;

  selectedImportId: string;
  setSelectedImportId: (value: string) => void;
  imports: LeadImportItem[];

  filterRules: FilterRule[];
  setFilterRules: Dispatch<SetStateAction<FilterRule[]>>;
  spreadsheetColumns: string[];

  parsedRows: Record<string, unknown>[];
  parsedLeadsStats: { total: number; valid: number; invalid: number };
  previewOpen: boolean;
  setPreviewOpen: Dispatch<SetStateAction<boolean>>;
  previewRows: Record<string, unknown>[];
}

export function LeadSourceStep({
  campaignName,
  setCampaignName,
  fileInputRef,
  selectedFile,
  isImportingFile,
  onFileChange,
  onImportSpreadsheetOnly,
  showNumbersModal,
  onCloseNumbersModal,
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
}: LeadSourceStepProps) {
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
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-500">Ou use uma importada</label>
            <Select
              value={selectedImportId}
              onValueChange={(val) => {
                setSelectedImportId(val);
                setSelectedFile(null);
                setParsedRows([]);
                setFilterRules([]);
              }}
            >
              <SelectTrigger className="h-12 rounded-xl">
                <SelectValue placeholder="Selecione uma base existente..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_IMPORTS_VALUE}>Todas as bases importadas</SelectItem>
                <SelectItem value={CRM_BASE_VALUE}>Todos os leads do CRM</SelectItem>
                {imports.map((imp) => (
                  <SelectItem key={imp.id} value={imp.id}>
                    {imp.source_name} ({imp.imported_rows} leads)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Dynamic Spreadsheet Filter Builder */}
        {parsedRows.length > 0 && (
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

            {/* Help/explanation box for spreadsheet filters */}
            <div className="flex items-start gap-2.5 rounded-lg border border-blue-400/20 bg-blue-500/5 p-3 text-[11px] leading-relaxed text-blue-700 dark:text-blue-300">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
              <div className="space-y-1">
                <p className="font-semibold">Como funciona a segmentação da planilha?</p>
                <p>
                  Você pode filtrar os contatos importados dinamicamente antes de realizar o envio. O sistema lê as colunas da sua planilha e permite criar regras de segmentação personalizadas.
                </p>
                <ul className="list-disc pl-4 space-y-0.5 mt-1">
                  <li><strong>Igual a:</strong> Busca exata (ex: <em>Sexo</em> igual a <em>Feminino</em>).</li>
                  <li><strong>Contém:</strong> Busca parcial de texto (ex: <em>Interesse</em> contém <em>consórcio</em>).</li>
                  <li><strong>Maior que / Menor que:</strong> Comparação numérica ou financeira (ex: <em>Valor</em> maior que <em>50000</em>).</li>
                </ul>
                <p className="text-muted-foreground text-[10px] mt-1">
                  * Apenas os leads que atenderem a todas as regras ativas serão importados e inseridos na fila de disparos.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              {filterRules.map((rule, idx) => (
                <div key={idx} className="flex flex-wrap gap-2 items-center bg-white dark:bg-black/35 p-2.5 rounded-xl border border-slate-200/80 dark:border-white/5 shadow-sm">
                  <Select
                    value={rule.column}
                    onValueChange={(val) => {
                      const updated = [...filterRules];
                      updated[idx].column = val;
                      setFilterRules(updated);
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs flex-1 min-w-[120px]">
                      <SelectValue placeholder="Coluna..." />
                    </SelectTrigger>
                    <SelectContent className={darkSelectContentClass}>
                      {spreadsheetColumns.map((col) => (
                        <SelectItem key={col} value={col} className={darkSelectItemClass}>
                          {col}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={rule.operator}
                    onValueChange={(val: any) => {
                      const updated = [...filterRules];
                      updated[idx].operator = val;
                      setFilterRules(updated);
                    }}
                  >
                    <SelectTrigger className="h-9 text-xs max-w-[120px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className={darkSelectContentClass}>
                      <SelectItem value="equals" className={darkSelectItemClass}>Igual a</SelectItem>
                      <SelectItem value="contains" className={darkSelectItemClass}>Contém</SelectItem>
                      <SelectItem value="gt" className={darkSelectItemClass}>Maior que</SelectItem>
                      <SelectItem value="lt" className={darkSelectItemClass}>Menor que</SelectItem>
                    </SelectContent>
                  </Select>

                  <Input
                    placeholder="Valor de comparação..."
                    value={rule.value}
                    onChange={(e) => {
                      const updated = [...filterRules];
                      updated[idx].value = e.target.value;
                      setFilterRules(updated);
                    }}
                    className="h-9 text-xs flex-1 min-w-[140px]"
                  />

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
              ))}

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (spreadsheetColumns.length > 0) {
                    setFilterRules([
                      ...filterRules,
                      { column: spreadsheetColumns[0], operator: "equals", value: "" }
                    ]);
                  }
                }}
                className="w-full h-9 text-xs border-dashed border-indigo-200 hover:border-indigo-300 text-indigo-600 dark:border-indigo-800/40 dark:text-indigo-400 bg-transparent rounded-xl"
              >
                <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar Filtro de Coluna
              </Button>
            </div>
          </div>
        )}

        {/* Simplified preview of uploaded leads */}
        {parsedRows.length > 0 && (
          <div className="rounded-xl border border-slate-200/60 bg-slate-50/40 p-4 dark:border-white/5 dark:bg-slate-900/10 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex gap-4">
                <div>
                  <p className="text-[10px] uppercase font-bold text-slate-400">Total Leads</p>
                  <p className="text-base font-bold text-slate-700 dark:text-slate-200">{parsedLeadsStats.total}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase font-bold text-emerald-500">WhatsApp Válidos</p>
                  <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">{parsedLeadsStats.valid}</p>
                </div>
                {parsedLeadsStats.invalid > 0 && (
                  <div>
                    <p className="text-[10px] uppercase font-bold text-rose-500">Formatos Inválidos</p>
                    <p className="text-base font-bold text-rose-600 dark:text-rose-400">{parsedLeadsStats.invalid}</p>
                  </div>
                )}
              </div>
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

            {previewOpen && (
              <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white dark:border-white/5 dark:bg-black/30">
                <Table className="text-[11px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-8 py-0">Nome</TableHead>
                      <TableHead className="h-8 py-0">Telefone</TableHead>
                      <TableHead className="h-8 py-0">Outras Colunas</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="h-8 py-0.5 font-medium">{getLeadField(row, ["nome", "name"]) || "Sem nome"}</TableCell>
                        <TableCell className="h-8 py-0.5 font-mono">{getLeadField(row, ["telefone", "phone", "number"]) || "—"}</TableCell>
                        <TableCell className="h-8 py-0.5 text-muted-foreground truncate max-w-[120px]">
                          {Object.keys(row).filter(k => !["nome", "name", "telefone", "phone"].includes(k.toLowerCase())).map(k => `${k}: ${row[k]}`).join(", ") || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
