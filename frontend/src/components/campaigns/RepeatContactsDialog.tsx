import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/use-toast";
import {
  getRepeatContacts,
  putRepeatDecision,
  type RepeatContactsInfo,
  type RepeatDecision,
} from "@/lib/repeatContacts";

/** Texto da pergunta: quantos já receberam e de quais campanhas. Exportado para teste. */
export function describeRepeatContacts(info: RepeatContactsInfo) {
  const campanhas = info.campanhas
    .slice(0, 3)
    .map((c) => `"${c.campaignName}" (${c.count})`)
    .join(", ");
  const dos = info.pendentes > 0 ? ` dos ${info.pendentes} que ainda vão receber esta campanha` : "";
  return `${info.jaReceberam} lead(s)${dos} já receberam disparo de outra campanha: ${campanhas}.`;
}

export function RepeatContactsDialog({
  info,
  onChoose,
}: {
  info: RepeatContactsInfo | null;
  onChoose: (decisao: RepeatDecision | null) => void;
}) {
  return (
    <AlertDialog open={!!info} onOpenChange={(o) => { if (!o) onChoose(null); }}>
      <AlertDialogContent data-testid="repeat-contacts-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>Esses leads já receberam outra campanha</AlertDialogTitle>
          {info && (
            <AlertDialogDescription data-testid="repeat-contacts-text">
              {describeRepeatContacts(info)} Quer pular quem já recebeu ou enviar de novo? A escolha vale para todos os lotes
              desta campanha, inclusive os que saem sozinhos no horário agendado.
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel data-testid="repeat-contacts-cancel" onClick={() => onChoose(null)}>
            Não disparar
          </AlertDialogCancel>
          <Button variant="outline" data-testid="repeat-contacts-send" onClick={() => onChoose("enviar")}>
            Enviar de novo
          </Button>
          <Button data-testid="repeat-contacts-skip" onClick={() => onChoose("pular")}>
            Pular quem já recebeu
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Pergunta antes de disparar (pedido do Conrado, 26/11/2026: "pergunta sempre").
 * guard(run): confere os repetidos; sem repetido, roda direto; com repetido, abre a pergunta, grava a escolha e roda.
 * "Não disparar" não roda nada. Se a conferência falhar, roda: o motor para o lote sozinho se houver repetido sem decisão.
 * decide(decisao): responde direto (faixa do lote parado esperando a decisão) e libera os lotes parados.
 */
export function useRepeatContactsGuard(campaignId: string) {
  const auth = useAuth();
  const getIdToken = useCallback(async () => (auth ? auth.getIdToken() : null), [auth]);
  const qc = useQueryClient();
  const [info, setInfo] = useState<RepeatContactsInfo | null>(null);
  const resolver = useRef<((d: RepeatDecision | null) => void) | null>(null);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["dispatch-summary"] });
    qc.invalidateQueries({ queryKey: ["campaign-dispatches"] });
    qc.invalidateQueries({ queryKey: ["all-dispatches"] });
    qc.invalidateQueries({ queryKey: ["campaigns"] });
  }, [qc]);

  const decide = useCallback(
    async (decisao: RepeatDecision) => {
      const token = await getIdToken();
      const r = await putRepeatDecision(token, campaignId, decisao);
      invalidate();
      return r;
    },
    [campaignId, getIdToken, invalidate]
  );

  const guard = useCallback(
    async (run: () => void) => {
      let atual: RepeatContactsInfo | null = null;
      try {
        atual = await getRepeatContacts(await getIdToken(), campaignId);
      } catch {
        run();
        return;
      }
      if (!atual || !(Number(atual.jaReceberam) > 0)) {
        run();
        return;
      }
      resolver.current?.(null);
      setInfo(atual);
      const escolha = await new Promise<RepeatDecision | null>((resolve) => {
        resolver.current = resolve;
      });
      if (!escolha) return;
      try {
        await decide(escolha);
      } catch (err) {
        toast({ title: "Não foi possível gravar a escolha", description: err instanceof Error ? err.message : "Tente de novo.", variant: "destructive" });
        return;
      }
      run();
    },
    [campaignId, decide, getIdToken]
  );

  const choose = useCallback((d: RepeatDecision | null) => {
    resolver.current?.(d);
    resolver.current = null;
    setInfo(null);
  }, []);

  const repeatContactsDialog = <RepeatContactsDialog info={info} onChoose={choose} />;
  return { guard, decide, repeatContactsDialog };
}

/**
 * Faixa do lote que PAROU esperando a decisão (saiu pelo agendador, sem ninguém clicando). Mostra o motivo gravado pelo
 * motor e responde ali mesmo; a resposta libera os lotes parados.
 */
export function RepeatDecisionBanner({
  errorMessage,
  onDecide,
  testId,
}: {
  errorMessage: string;
  onDecide: (decisao: RepeatDecision) => Promise<unknown>;
  testId?: string;
}) {
  const [pendente, setPendente] = useState<RepeatDecision | null>(null);
  const responder = async (d: RepeatDecision) => {
    setPendente(d);
    try {
      const r = (await onDecide(d)) as { lotesLiberados?: number } | undefined;
      toast({
        title: d === "pular" ? "Quem já recebeu vai ser pulado" : "Vai enviar de novo para todos",
        description: r?.lotesLiberados ? `${r.lotesLiberados} lote(s) liberado(s) para sair agora.` : undefined,
      });
    } catch (err) {
      toast({ title: "Não foi possível gravar a escolha", description: err instanceof Error ? err.message : "Tente de novo.", variant: "destructive" });
    } finally {
      setPendente(null);
    }
  };
  const texto = errorMessage.replace(/^Aguardando sua decisão: leads que já receberam outra campanha:\s*/, "").replace(/\s*Escolha pular.*$/, "");
  return (
    <div
      data-testid={testId || "repeat-decision-banner"}
      className="mt-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/30 dark:text-amber-200"
      onClick={(e) => e.stopPropagation()}
    >
      <p className="font-semibold">Lote parado esperando sua decisão</p>
      <p className="mt-0.5">{texto} Pular quem já recebeu ou enviar de novo?</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" className="h-7 text-xs" disabled={!!pendente} onClick={() => void responder("pular")} data-testid="repeat-decision-skip">
          Pular quem já recebeu
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs" disabled={!!pendente} onClick={() => void responder("enviar")} data-testid="repeat-decision-send">
          Enviar de novo
        </Button>
      </div>
    </div>
  );
}
