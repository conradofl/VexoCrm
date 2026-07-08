import { type ChangeEvent, type RefObject } from "react";
import { AlertCircle, FileSpreadsheet, Loader2, Trash2, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SpreadsheetUploaderProps {
  fileInputRef: RefObject<HTMLInputElement>;
  selectedFile: File | null;
  isImportingFile: boolean;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onImport: () => void;
  onClear: () => void;
  showNumbersModal: boolean;
  onCloseNumbersModal: () => void;
}

export function SpreadsheetUploader({
  fileInputRef,
  selectedFile,
  isImportingFile,
  onFileChange,
  onImport,
  onClear,
  showNumbersModal,
  onCloseNumbersModal,
}: SpreadsheetUploaderProps) {
  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xls,.xlsx,.numbers"
        className="sr-only"
        onChange={onFileChange}
      />
      {selectedFile ? (
        <div className="flex h-12 items-center justify-between gap-2 rounded-xl border border-indigo-200 bg-indigo-50/20 px-3 dark:border-indigo-800/40 dark:bg-indigo-950/10 text-xs font-semibold text-indigo-600 dark:text-indigo-400 transition-all">
          <div className="flex items-center gap-2 truncate">
            <FileSpreadsheet className="h-4 w-4 text-indigo-500 flex-shrink-0" />
            <span className="truncate">{selectedFile.name}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="default"
              size="sm"
              onClick={onImport}
              disabled={isImportingFile}
              className="h-8 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] uppercase font-bold flex items-center gap-1.5 shadow-sm transition-colors border-0"
            >
              {isImportingFile ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              Importar Planilha
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="h-8 px-2 text-indigo-600 hover:text-indigo-700 dark:text-indigo-400 dark:hover:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 text-[10px] uppercase font-bold"
            >
              Alterar
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              className="h-8 w-8 p-0 text-rose-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ) : (
        <div
          onClick={() => fileInputRef.current?.click()}
          className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/20 px-3 hover:bg-indigo-50/50 dark:border-indigo-800/40 dark:bg-indigo-950/10 dark:hover:bg-indigo-950/20 text-xs font-semibold text-indigo-600 dark:text-indigo-400 transition-all"
        >
          <Upload className="h-4 w-4" />
          Carregar Planilha (Excel/CSV/Numbers)
        </div>
      )}

      {/* 🍏 APPLE NUMBERS INSTRUCTIONS MODAL */}
      {showNumbersModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white p-6 shadow-2xl dark:border-white/10 dark:bg-[#0b0e1a] animate-scaleUp">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-indigo-500 animate-pulse" />
                Planilha Numbers detectada
              </h3>
              <button
                onClick={onCloseNumbersModal}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-white transition-colors"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-4 text-xs text-slate-600 dark:text-slate-300">
              <p className="leading-relaxed">
                Arquivos do <strong>Apple Numbers (.numbers)</strong> são pacotes binários compactados exclusivos da Apple e não podem ser lidos diretamente no navegador.
              </p>
              <p className="font-semibold text-slate-700 dark:text-white">
                Como exportar para Excel (.xlsx) no seu Mac em segundos:
              </p>
              <div className="rounded-xl border border-indigo-100/70 bg-indigo-50/30 p-4 dark:border-indigo-950/40 dark:bg-indigo-950/15 space-y-3">
                <div className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-950 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">1</span>
                  <p>Abra o arquivo no seu aplicativo <strong>Numbers</strong>.</p>
                </div>
                <div className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-950 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">2</span>
                  <p>No menu superior do Numbers, clique em <strong>Arquivo &gt; Exportar Para &gt; Excel...</strong> (ou CSV).</p>
                </div>
                <div className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-950 text-[10px] font-bold text-indigo-600 dark:text-indigo-400">3</span>
                  <p>Salve o arquivo e faça o upload do novo arquivo <strong>.xlsx</strong> gerado aqui.</p>
                </div>
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <Button
                onClick={onCloseNumbersModal}
                className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold px-4"
              >
                Entendi
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
