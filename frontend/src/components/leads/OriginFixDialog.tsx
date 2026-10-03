import { useEffect, useState } from "react";
import { Loader2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OriginFixMismatchError, useExecuteOriginFix, useOriginFixPreview } from "@/hooks/useLeadOriginFix";
import {
  canConfirmOriginFix,
  originFixReportLines,
  originFixSentence,
  requiresTypedConfirmation,
  type OriginFixReport,
} from "@/lib/leadOriginFix";

interface OriginFixDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
}

/**
 * Corrige a origem "Instagram Direct" que o importador de planilha inventava. Mesma disciplina da exclusão
 * por tag: números por grupo antes de qualquer confirmação, número digitado acima do limite, e relatório
 * do que foi feito e do que ficou sem tocar.
 */
export function OriginFixDialog({ open, onOpenChange, clientId }: OriginFixDialogProps) {
  const [typed, setTyped] = useState("");
  const [report, setReport] = useState<OriginFixReport | null>(null);
  const [mismatch, setMismatch] = useState<OriginFixMismatchError | null>(null);
  const [error, setError] = useState<string | null>(null);

  // cada abertura começa do zero
  useEffect(() => {
    if (!open) return;
    setTyped("");
    setReport(null);
    setMismatch(null);
    setError(null);
  }, [open]);

  const preview = useOriginFixPreview(clientId, open && !report);
  const executor = useExecuteOriginFix();

  const data = preview.data;
  const correctable = data?.correctable ?? 0;
  const typedRequired = data ? requiresTypedConfirmation(correctable) : false;
  const canConfirm = !!data && !preview.isFetching && !executor.isPending && canConfirmOriginFix(correctable, typed);

  const handleConfirm = async () => {
    if (!data) return;
    setError(null);
    setMismatch(null);
    try {
      const result = await executor.mutateAsync({
        clientId,
        expectedCount: data.correctable,
        ...(typedRequired ? { confirmation: typed.trim() } : {}),
      });
      setReport(result);
    } catch (err) {
      setTyped("");
      if (err instanceof OriginFixMismatchError) {
        setMismatch(err);
        void preview.refetch(); // mostra o número de agora; o usuário confirma de novo
      } else {
        setError(err instanceof Error ? err.message : "A correção falhou e nada foi alterado.");
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="origin-fix-dialog">
        <DialogHeader>
          <DialogTitle>Corrigir origem "Instagram Direct"</DialogTitle>
          <DialogDescription>
            Planilhas importadas sem canal informado receberam "Instagram Direct" como origem, sem ninguém ter escolhido. Veja os números antes de confirmar.
          </DialogDescription>
        </DialogHeader>

        {report ? (
          <div data-testid="origin-fix-report" className="space-y-1.5 text-sm">
            {originFixReportLines(report).map((line) => (
              <p key={line}>{line}</p>
            ))}
            <p className="text-xs text-muted-foreground pt-1">
              A correção foi registrada com seu usuário, as quantidades por grupo e a lista dos leads corrigidos.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {preview.isFetching && <p className="text-xs text-muted-foreground">Calculando…</p>}
            {preview.error && (
              <p role="alert" className="text-xs text-rose-600">
                {(preview.error as Error).message}
              </p>
            )}

            {data && !preview.isFetching && (
              <div data-testid="origin-fix-preview" className="space-y-3 text-sm">
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                  <dt>Com identificador de importação (serão corrigidos)</dt>
                  <dd data-testid="num-with-import-id">{data.withImportId}</dd>
                  <dt>Só com a tag de importação (serão corrigidos)</dt>
                  <dd data-testid="num-only-import-tag">{data.onlyImportTag}</dd>
                  <dt>Indetermináveis (não serão tocados)</dt>
                  <dd data-testid="num-undeterminable">{data.undeterminable}</dd>
                  <dt className="font-semibold">Total com origem "Instagram Direct"</dt>
                  <dd className="font-semibold" data-testid="num-total">
                    {data.total}
                  </dd>
                </dl>

                <div className="rounded-md border p-2.5 text-xs space-y-1">
                  <p className="font-semibold">Não tocados, à parte</p>
                  <p>
                    <span data-testid="num-instagram-importer">{data.instagramImporterUntouched}</span> vieram do importador de Instagram: a
                    origem é verdadeira e não entra na conta acima.
                  </p>
                </div>

                {data.correctable > 0 ? (
                  <>
                    <p data-testid="origin-fix-sentence" className="font-medium">
                      {originFixSentence(data.correctable, data.willSet)}
                    </p>
                    {typedRequired && (
                      <label className="block text-xs">
                        Digite {data.correctable} para confirmar
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
                ) : (
                  <p className="text-xs">Nada determinável a corrigir.</p>
                )}
              </div>
            )}

            {mismatch && (
              <p role="alert" data-testid="origin-fix-mismatch" className="text-xs text-amber-700">
                A base mudou desde a prévia: você viu {mismatch.expected}, agora são {mismatch.actual}. Nada foi alterado. Revise os números
                acima e confirme de novo.
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
            <Button type="button" disabled={!canConfirm} onClick={handleConfirm} className="gap-1.5">
              {executor.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wrench className="h-4 w-4" />}
              {correctable > 0 ? `Corrigir ${correctable} ${correctable === 1 ? "lead" : "leads"}` : "Corrigir"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
