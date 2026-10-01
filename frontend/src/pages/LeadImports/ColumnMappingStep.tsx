import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Columns3,
  HelpCircle,
  Info,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type ColumnMappingItem,
  type ColumnMappingTarget,
  type CustomFieldType,
  extractColumnSamples,
  validateColumnMappings,
  detectTypeDivergences,
  normalizeFieldKey,
} from "@/lib/leadImports/spreadsheet";

export interface ColumnMappingStepProps {
  columns: string[];
  sampleRows: Record<string, unknown>[];
  mappings: ColumnMappingItem[];
  onMappingChange: (mappings: ColumnMappingItem[]) => void;
  knownCustomFields?: Array<{ key: string; label: string; type: CustomFieldType }>;
  isImporting?: boolean;
  onConfirmImport: () => void;
  onCancel?: () => void;
  totalRowsCount?: number;
  fileName?: string;
}

export function ColumnMappingStep({
  columns,
  sampleRows,
  mappings,
  onMappingChange,
  knownCustomFields = [],
  isImporting = false,
  onConfirmImport,
  onCancel,
  totalRowsCount,
  fileName,
}: ColumnMappingStepProps) {
  // Amostras da primeira linha preenchida para cada coluna
  const samples = useMemo(
    () => extractColumnSamples(columns, sampleRows),
    [columns, sampleRows]
  );

  // Validação pura e oficial de mapeamento
  const validation = useMemo(
    () => validateColumnMappings(mappings, columns, sampleRows),
    [mappings, columns, sampleRows]
  );

  // Detecção de divergências de tipo com registros prévios do banco
  const divergences = useMemo(
    () => detectTypeDivergences(mappings, knownCustomFields),
    [mappings, knownCustomFields]
  );

  const divergenceMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of divergences) {
      map.set(d.column, d.message);
    }
    return map;
  }, [divergences]);

  function handleTargetChange(columnName: string, newTarget: ColumnMappingTarget) {
    const updated = mappings.map((m) => {
      if (m.column !== columnName) return m;
      return {
        ...m,
        target: newTarget,
        label: m.label || columnName,
        key: normalizeFieldKey(m.label || columnName),
      };
    });
    onMappingChange(updated);
  }

  function handleLabelChange(columnName: string, newLabel: string) {
    const updated = mappings.map((m) => {
      if (m.column !== columnName) return m;
      return {
        ...m,
        label: newLabel,
        key: normalizeFieldKey(newLabel),
      };
    });
    onMappingChange(updated);
  }

  function handleTypeChange(columnName: string, newType: CustomFieldType) {
    const updated = mappings.map((m) => {
      if (m.column !== columnName) return m;
      return {
        ...m,
        type: newType,
      };
    });
    onMappingChange(updated);
  }

  return (
    <div className="rounded-2xl border border-indigo-200/70 bg-white p-5 shadow-sm dark:border-indigo-900/40 dark:bg-slate-900 space-y-5 animate-fadeIn">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
              <Columns3 className="h-3.5 w-3.5" />
            </span>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
              Mapeamento de Colunas da Planilha
            </h3>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            {fileName ? (
              <>
                Arquivo <strong className="text-slate-700 dark:text-slate-200">{fileName}</strong> •{" "}
              </>
            ) : null}
            {columns.length} colunas encontradas
            {totalRowsCount !== undefined ? ` • ${totalRowsCount} linhas` : ""}.
            Confira o destino dos dados antes de importar. Apenas o telefone é obrigatório.
          </p>
        </div>

        {onCancel && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onCancel}
            className="h-8 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Trocar arquivo
          </Button>
        )}
      </div>

      {/* Alerta de Validação (Bloqueio sem telefone ou destino duplicado) */}
      {!validation.isValid && (
        <div
          data-testid="mapping-validation-error"
          className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50/80 p-3.5 text-xs text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
          <div className="space-y-0.5">
            <p className="font-semibold">Mapeamento incompleto ou inválido</p>
            <p className="leading-relaxed">{validation.errorMessage}</p>
          </div>
        </div>
      )}

      {/* Alerta de Divergência de Tipos */}
      {divergences.length > 0 && (
        <div
          data-testid="type-divergence-warning"
          className="flex items-start gap-2.5 rounded-xl border border-blue-200 bg-blue-50/70 p-3.5 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-200"
        >
          <Info className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400 mt-0.5" />
          <div className="space-y-1">
            <p className="font-semibold">Aviso de campos existentes com tipo divergente</p>
            <ul className="list-disc list-inside space-y-0.5 text-[11px]">
              {divergences.map((d) => (
                <li key={d.column}>{d.message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Tabela de Colunas */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              <th className="py-2.5 px-3 w-1/4">Coluna no Arquivo</th>
              <th className="py-2.5 px-3 w-1/4">Exemplo Real</th>
              <th className="py-2.5 px-3 w-1/4">Destino</th>
              <th className="py-2.5 px-3 w-1/4">Rótulo / Tipo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {columns.map((colName) => {
              const mapping = mappings.find((m) => m.column === colName) || {
                column: colName,
                target: "ignore" as ColumnMappingTarget,
                label: colName,
                type: "text" as CustomFieldType,
                key: normalizeFieldKey(colName),
              };

              const sampleVal = samples[colName];
              const divergenceMsg = divergenceMap.get(colName);

              return (
                <tr
                  key={colName}
                  data-testid={`column-row-${colName}`}
                  className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors"
                >
                  {/* Coluna no Arquivo */}
                  <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                    <span className="font-mono text-xs text-indigo-900 dark:text-indigo-300">
                      {colName}
                    </span>
                  </td>

                  {/* Exemplo Real (Primeira linha não vazia) */}
                  <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                    {sampleVal ? (
                      <span
                        data-testid={`sample-val-${colName}`}
                        className="inline-block max-w-[200px] truncate rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] text-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        title={sampleVal}
                      >
                        {sampleVal}
                      </span>
                    ) : (
                      <span className="text-[11px] italic text-slate-400 dark:text-slate-500">
                        (coluna vazia)
                      </span>
                    )}
                  </td>

                  {/* Destino */}
                  <td className="py-2.5 px-3">
                    <Select
                      value={mapping.target}
                      onValueChange={(val) =>
                        handleTargetChange(colName, val as ColumnMappingTarget)
                      }
                    >
                      <SelectTrigger
                        data-testid={`target-select-${colName}`}
                        className="h-8 text-xs rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                      >
                        <SelectValue placeholder="Selecione o destino" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ignore">Ignorar</SelectItem>
                        <SelectItem value="telefone">Telefone (Obrigatório)</SelectItem>
                        <SelectItem value="nome">Nome do Contato</SelectItem>
                        <SelectItem value="custom">Guardar como informação do lead</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>

                  {/* Configuração Extra (Rótulo e Tipo quando target === 'custom') */}
                  <td className="py-2.5 px-3">
                    {mapping.target === "custom" ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Input
                            data-testid={`label-input-${colName}`}
                            placeholder="Rótulo do campo"
                            value={mapping.label}
                            onChange={(e) => handleLabelChange(colName, e.target.value)}
                            className="h-8 text-xs rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          />

                          <Select
                            value={mapping.type}
                            onValueChange={(val) =>
                              handleTypeChange(colName, val as CustomFieldType)
                            }
                          >
                            <SelectTrigger
                              data-testid={`type-select-${colName}`}
                              className="h-8 w-28 text-xs rounded-lg border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="text">Texto</SelectItem>
                              <SelectItem value="number">Número</SelectItem>
                              <SelectItem value="date">Data</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {divergenceMsg && (
                          <p className="text-[10px] text-blue-600 dark:text-blue-400">
                            {divergenceMsg}
                          </p>
                        )}
                      </div>
                    ) : mapping.target === "telefone" ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Identificador principal
                      </span>
                    ) : mapping.target === "nome" ? (
                      <span className="text-[11px] text-slate-500 dark:text-slate-400">
                        Nome do lead
                      </span>
                    ) : (
                      <span className="text-[11px] text-slate-400 dark:text-slate-500">
                        Descartada na importação
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Botões de Ação */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
        <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
          <HelpCircle className="h-3.5 w-3.5" />
          <span>Campos marcados como informação do lead ficam disponíveis no CRM em dados.campos</span>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {onCancel && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onCancel}
              className="h-9 px-4 rounded-xl text-xs"
            >
              Cancelar
            </Button>
          )}

          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={onConfirmImport}
            disabled={!validation.isValid || isImporting}
            data-testid="confirm-import-btn"
            className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-colors w-full sm:w-auto justify-center"
          >
            {isImporting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importando...
              </>
            ) : (
              <>
                Confirmar e Importar Planilha
                <ArrowRight className="h-3.5 w-3.5 ml-0.5" />
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
