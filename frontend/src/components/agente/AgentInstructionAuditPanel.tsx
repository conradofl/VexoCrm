import { AlertTriangle, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useAgentInstructionAudit, useConsolidateAgent } from "@/hooks/useAgentInstructionAudit";

// "Uma tela, um agente" — este painel virou um aviso condicional, não mais
// um diagnóstico permanente. Antes ele sempre renderizava (mostrando até
// "Sem conflito" quando estava tudo certo); agora ele só existe quando há
// algo a resolver. Consolidado ou sem conflito de Coleta → não renderiza
// nada. "Resolver agora" abre a mesma confirmação de sempre — consolidar
// grava no agente o prompt efetivo + a união dos campos e marca a partir daí
// que nem template nem prompt padrão do tenant são buscados de novo
// (chatbot-ai-engine.js). Ação de mão única: não existe "desconsolidar".
export function AgentInstructionAuditPanel({ agentId }: { agentId: string | undefined }) {
  const { data, isLoading, error } = useAgentInstructionAudit(agentId);
  const consolidateMutation = useConsolidateAgent(agentId);

  if (!agentId || isLoading || error || !data) return null;

  const { audit, templateKeyEmUso, consolidated } = data;
  const temConflitos = audit.collection.conflicts.length > 0;

  if (consolidated || !temConflitos) return null;

  const handleConsolidate = () => {
    consolidateMutation.mutate(undefined, {
      onSuccess: () => toast.success("Agente consolidado — a partir de agora ele não recebe mais instrução de fora."),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao consolidar o agente."),
    });
  };

  // Prévia do que "Consolidar" vai gravar: o prompt efetivo de hoje, e os
  // campos do template que ainda não estão na Coleta do agente (os que já
  // estão não mudam nada).
  const nomesJaNaColeta = new Set(audit.collection.agentFields.map((f) => f.name.toLowerCase()));
  const camposQueVaoEntrar = audit.collection.templateFields.filter((f) => !nomesJaNaColeta.has(f.name.toLowerCase()));

  // Prompt efetivo vazio (nem agente nem tenant têm prompt): consolidar
  // gravaria inbound_prompt = "" e, como o agente consolidado nunca mais
  // busca o prompt do tenant como reserva, o motor calaria o agente pra
  // sempre — sem botão que desfizesse (consolidar é mão única). O backend já
  // recusa isso; aqui é prevenir ANTES do clique, não só reagir ao erro dele.
  const promptEfetivoVazio = !audit.prompt.value;

  return (
    <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
      <AlertTriangle className="w-4 h-4 mt-0.5 text-amber-600 shrink-0" />
      <div className="space-y-1.5 flex-1 min-w-0">
        <p className="text-xs font-semibold text-foreground">Duas fontes competem neste agente</p>
        <div className="space-y-1">
          {audit.collection.conflicts.map((c) => (
            <p key={c.field} className="text-[11px] text-muted-foreground">
              {c.motivo}
            </p>
          ))}
        </div>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button
              type="button"
              disabled={promptEfetivoVazio}
              className="text-[11px] font-medium text-amber-600 hover:text-amber-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
            >
              <Lock className="w-3 h-3" />
              Resolver agora →
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Consolidar este agente?</AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-muted-foreground space-y-2">
                <span className="block">
                  O prompt deste agente passa a ser:{" "}
                  <span className="text-foreground font-medium">
                    {audit.prompt.source === "agente" ? "o texto que já está aqui (sem mudança)." : "o prompt padrão do tenant, copiado pra este agente."}
                  </span>
                </span>
                {camposQueVaoEntrar.length > 0 ? (
                  <span className="block">
                    A Coleta ganha {camposQueVaoEntrar.length} campo(s) que o template "{templateKeyEmUso}" pedia e este agente ainda não pedia:{" "}
                    <span className="text-foreground font-medium">{camposQueVaoEntrar.map((f) => f.name).join(", ")}</span>.
                  </span>
                ) : (
                  <span className="block">A Coleta não ganha nenhum campo novo — já pede tudo que o template pedia.</span>
                )}
                <span className="block font-medium text-amber-600">
                  Depois disso, este agente ignora o template e o prompt padrão do tenant pra sempre. Não existe desfazer.
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-8 text-xs">Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleConsolidate} disabled={consolidateMutation.isPending} className="h-8 text-xs">
                {consolidateMutation.isPending ? "Consolidando..." : "Consolidar"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {promptEfetivoVazio && (
          <p className="text-[10px] text-rose-600">Escreva o prompt deste agente antes de consolidar.</p>
        )}
      </div>
    </div>
  );
}
