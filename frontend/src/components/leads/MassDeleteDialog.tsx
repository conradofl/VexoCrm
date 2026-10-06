import { useEffect, useState } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  MassDeleteMismatchError,
  useExecuteMassDelete,
  useExportMassDelete,
  useMassDeletePreview,
  useMassDeleteTags,
  type MassDeleteCriterion,
} from "@/hooks/useLeadMassDelete";
import {
  DEFAULT_MASS_DELETE_OPTIONS,
  canConfirmMassDelete,
  confirmationSentence,
  reportLines,
  requiresTypedConfirmation,
  type MassDeleteOptions,
  type MassDeleteReport,
} from "@/lib/leadMassDelete";

interface MassDeleteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  /** Tag já escolhida (ex.: atalho vindo de uma planilha). */
  initialTag?: string;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function MassDeleteDialog({ open, onOpenChange, clientId, initialTag }: MassDeleteDialogProps) {
  const [selectedTags, setSelectedTags] = useState<string[]>(initialTag ? [initialTag] : []);
  const [tagSearch, setTagSearch] = useState("");
  const [options, setOptions] = useState<MassDeleteOptions>(DEFAULT_MASS_DELETE_OPTIONS);
  const [typed, setTyped] = useState("");
  const [report, setReport] = useState<MassDeleteReport | null>(null);
  const [mismatch, setMismatch] = useState<MassDeleteMismatchError | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportedCount, setExportedCount] = useState<number | null>(null);

  // cada abertura começa do zero: nada de opção ligada ou confirmação digitada de uso anterior
  useEffect(() => {
    if (!open) return;
    setSelectedTags(initialTag ? [initialTag] : []);
    setTagSearch("");
    setOptions(DEFAULT_MASS_DELETE_OPTIONS);
    setTyped("");
    setReport(null);
    setMismatch(null);
    setError(null);
    setExportedCount(null);
  }, [open, initialTag]);

  const tags = useMassDeleteTags(clientId, open && !report);
  const criterion: MassDeleteCriterion | null =
    selectedTags.length > 0
      ? selectedTags.length === 1
        ? { type: "tag", value: selectedTags[0] }
        : { type: "tag", value: selectedTags.join(", "), values: selectedTags }
      : null;

  const preview = useMassDeletePreview(clientId, report ? null : criterion, options);
  const exporter = useExportMassDelete();
  const executor = useExecuteMassDelete();

  const data = preview.data;
  const willDelete = data?.willDelete ?? 0;
  const typedRequired = data ? requiresTypedConfirmation(data.willDelete) : false;
  const canConfirm = !!data && !executor.isPending && canConfirmMassDelete(willDelete, typed);

  const resetReview = () => {
    setTyped("");
    setMismatch(null);
    setError(null);
    setExportedCount(null);
  };

  const toggleTag = (t: string) => {
    setSelectedTags((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
    resetReview();
  };

  const handleExport = async () => {
    if (!criterion) return;
    setError(null);
    try {
      const { blob, count } = await exporter.mutateAsync({ clientId, criterion, options });
      const tagSuffix = selectedTags.slice(0, 3).join("_").replace(/[^\w-]+/g, "_") || "tags";
      downloadBlob(blob, `leads-a-apagar-${tagSuffix}.csv`);
      setExportedCount(count);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível exportar.");
    }
  };

  const handleConfirm = async () => {
    if (!criterion || !data) return;
    setError(null);
    setMismatch(null);
    try {
      const result = await executor.mutateAsync({
        clientId,
        criterion,
        options,
        expectedCount: data.willDelete,
        ...(typedRequired ? { confirmation: typed.trim() } : {}),
      });
      setReport(result);
    } catch (err) {
      setTyped("");
      if (err instanceof MassDeleteMismatchError) {
        setMismatch(err);
        void preview.refetch(); // mostra o número de agora; o usuário confirma de novo
      } else {
        setError(err instanceof Error ? err.message : "A exclusão falhou e nada foi apagado.");
      }
    }
  };

  const availableTagsList = tags.data ?? [];
  const filteredTags = availableTagsList.filter((t) =>
    t.tag.toLowerCase().includes(tagSearch.toLowerCase().trim())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="mass-delete-dialog">
        <DialogHeader>
          <DialogTitle>Excluir leads por tags</DialogTitle>
          <DialogDescription>
            Exclusão em massa, irreversível. Selecione uma ou mais tags e confira os números antes de confirmar.
          </DialogDescription>
        </DialogHeader>

        {report ? (
          <div data-testid="mass-delete-report" className="space-y-1.5 text-sm">
            {reportLines(report).map((line) => (
              <p key={line}>{line}</p>
            ))}
            <p className="text-xs text-muted-foreground pt-1">
              A exclusão foi registrada com seu usuário, o critério, a quantidade e a data.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Seletor com busca e seleção múltipla de tags */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-foreground">
                  Tags selecionadas ({selectedTags.length})
                </label>
                {selectedTags.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedTags([]);
                      resetReview();
                    }}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline"
                  >
                    Limpar seleção
                  </button>
                )}
              </div>

              {/* Badges das tags selecionadas */}
              {selectedTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 p-2 bg-muted/40 rounded-md border text-xs max-h-24 overflow-y-auto">
                  {selectedTags.map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium text-xs"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() => toggleTag(t)}
                        className="hover:text-rose-500 rounded-full"
                        aria-label={`Remover tag ${t}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Campo de busca para filtrar as tags */}
              <Input
                placeholder="Buscar tags..."
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                className="h-8 text-xs"
                aria-label="Buscar tags"
              />

              {/* Lista rolável de tags com checkboxes */}
              <div
                className="max-h-36 overflow-y-auto rounded-md border bg-background p-1 space-y-0.5 text-xs"
                role="group"
                aria-label="Lista de tags disponíveis"
              >
                {filteredTags.length === 0 ? (
                  <p className="p-2 text-center text-muted-foreground text-xs">
                    {tagSearch ? "Nenhuma tag encontrada para esta busca." : "Nenhuma tag disponível."}
                  </p>
                ) : (
                  filteredTags.map((t) => {
                    const isSelected = selectedTags.includes(t.tag);
                    return (
                      <button
                        type="button"
                        key={t.tag}
                        onClick={() => toggleTag(t.tag)}
                        className={`w-full flex items-center justify-between px-2 py-1.5 rounded cursor-pointer transition-colors text-left ${
                          isSelected ? "bg-primary/10 font-medium" : "hover:bg-muted/60"
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
                              isSelected
                                ? "bg-primary border-primary text-primary-foreground font-bold"
                                : "border-input bg-background"
                            }`}
                          >
                            {isSelected ? "✓" : ""}
                          </span>
                          <span>{t.tag}</span>
                        </div>
                        <span className="text-[11px] text-muted-foreground">({t.leads} leads)</span>
                      </button>
                    );
                  })
                )}
              </div>

              {/* Select oculto para compatibilidade com testes automatizados */}
              <select
                aria-label="Tag"
                value={selectedTags[0] ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedTags(val ? [val] : []);
                  resetReview();
                }}
                className="sr-only"
                tabIndex={-1}
              >
                <option value="">Escolha uma tag…</option>
                {availableTagsList.map((t) => (
                  <option key={t.tag} value={t.tag}>
                    {t.tag} ({t.leads})
                  </option>
                ))}
              </select>
            </div>

            {preview.isFetching && <p className="text-xs text-muted-foreground">Calculando…</p>}
            {preview.error && (
              <p role="alert" className="text-xs text-rose-600">
                {(preview.error as Error).message}
              </p>
            )}

            {data && !preview.isFetching && (
              <div data-testid="mass-delete-preview" className="space-y-3 text-sm">
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                  <dt>Leads com {selectedTags.length > 1 ? "as tags selecionadas" : "esta tag"}</dt>
                  <dd data-testid="num-matched">{data.matched}</dd>
                  {data.multiSelectedTags !== undefined && data.multiSelectedTags > 0 && (
                    <>
                      <dt className="text-amber-700 dark:text-amber-400 font-medium">
                        Têm mais de uma das tags selecionadas
                      </dt>
                      <dd
                        data-testid="num-multi-selected-tags"
                        className="text-amber-700 dark:text-amber-400 font-medium"
                      >
                        {data.multiSelectedTags} {data.multiSelectedTags === 1 ? "lead tem" : "leads têm"} mais de uma das tags selecionadas
                      </dd>
                    </>
                  )}
                  <dt>Também têm tag de outra importação</dt>
                  <dd data-testid="num-multi-import">{data.multiImport}</dd>
                  <dt>Já trocaram mensagem</dt>
                  <dd data-testid="num-with-messages">{data.withMessages}</dd>
                  <dt className="font-semibold">Serão apagados</dt>
                  <dd className="font-semibold" data-testid="num-will-delete">
                    {data.willDelete}
                  </dd>
                  <dt>Sobram (mantidos)</dt>
                  <dd data-testid="num-kept">{data.kept}</dd>
                </dl>

                <div className="space-y-1.5 rounded-md border p-2.5 text-xs">
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={options.includeMultiImport}
                      onChange={(e) => {
                        setOptions((o) => ({ ...o, includeMultiImport: e.target.checked }));
                        resetReview();
                      }}
                    />
                    <span>Apagar também os que vieram de mais de uma importação ({data.multiImport})</span>
                  </label>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      checked={options.includeWithMessages}
                      onChange={(e) => {
                        setOptions((o) => ({ ...o, includeWithMessages: e.target.checked }));
                        resetReview();
                      }}
                    />
                    <span>Apagar também os que já trocaram mensagem ({data.withMessages})</span>
                  </label>
                </div>

                {data.willDelete > 0 && (
                  <>
                    <div className="space-y-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5 text-xs"
                        disabled={exporter.isPending}
                        onClick={handleExport}
                      >
                        <Download className="h-3.5 w-3.5" />
                        Exportar os {data.willDelete} leads que serão apagados (planilha)
                      </Button>
                      <p className="text-[11px] text-muted-foreground">
                        Não há desfazer. Se precisar voltar atrás, só reimportando esta planilha.
                        {exportedCount !== null && ` Exportados: ${exportedCount}.`}
                      </p>
                    </div>

                    <p data-testid="mass-delete-sentence" className="font-medium">
                      {confirmationSentence(data.willDelete, selectedTags)}
                    </p>

                    {typedRequired && (
                      <label className="block text-xs">
                        Digite {data.willDelete} para confirmar
                        <Input
                          aria-label="Digite o número para confirmar"
                          inputMode="numeric"
                          value={typed}
                          onChange={(e) => setTyped(e.target.value)}
                          className="mt-1"
                        />
                      </label>
                    )}
                  </>
                )}

                {data.willDelete === 0 && <p className="text-xs">Nada a apagar com estas opções.</p>}
              </div>
            )}

            {mismatch && (
              <p role="alert" data-testid="mass-delete-mismatch" className="text-xs text-amber-700">
                A base mudou desde a prévia: você viu {mismatch.expected}, agora são {mismatch.actual}. Nada foi apagado.
                Revise os números acima e confirme de novo.
              </p>
            )}
            {error && (
              <p role="alert" className="text-xs text-rose-600">
                {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {report ? "Fechar" : "Cancelar"}
          </Button>
          {!report && (
            <Button
              type="button"
              variant="destructive"
              disabled={!canConfirm}
              onClick={handleConfirm}
              className="gap-1.5"
            >
              {executor.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {willDelete > 0 ? `Apagar ${willDelete} ${willDelete === 1 ? "lead" : "leads"}` : "Apagar"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
