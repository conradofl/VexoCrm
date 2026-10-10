import { AlertTriangle, Lock, RotateCcw, Sparkles } from "lucide-react";
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
import { useAgentInstructionAudit, useConsolidateAgent, useUnconsolidateAgent } from "@/hooks/useAgentInstructionAudit";

export function AgentInstructionAuditPanel({ agentId }: { agentId: string | undefined }) {
  const { data, isLoading, error } = useAgentInstructionAudit(agentId);
  const consolidateMutation = useConsolidateAgent(agentId);
  const unconsolidateMutation = useUnconsolidateAgent(agentId);

  if (!agentId || isLoading || error || !data) return null;

  const { audit, templateKeyEmUso, consolidated } = data;
  const temConflitos = audit.collection.conflicts.length > 0;

  const handleConsolidate = () => {
    consolidateMutation.mutate(undefined, {
      onSuccess: () => toast.success("Agente autônomo ativo — a partir de agora ele não recebe mais instrução de fora."),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao tornar o agente autônomo."),
    });
  };

  const handleUnconsolidate = () => {
    unconsolidateMutation.mutate(undefined, {
      onSuccess: () => toast.success("Agente restaurado — voltou a seguir o template e instruções da empresa."),
      onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao voltar ao template da empresa."),
    });
  };

  // Se já estiver consolidado (autônomo), exibe o aviso claro de estado com o botão de desfazer
  if (consolidated) {
    return (
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
        <div className="flex items-start gap-2.5">
          <Sparkles className="w-4 h-4 mt-0.5 text-indigo-500 shrink-0" />
          <div className="space-y-0.5">
            <p className="text-xs font-semibold text-foreground">Agente operando de forma autônoma</p>
            <p className="text-[11px] text-muted-foreground">
              Este agente não usa mais o template da empresa. O que ele pergunta e como responde vem só do que está escrito aqui.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleUnconsolidate}
          disabled={unconsolidateMutation.isPending}
          className="h-8 text-xs border-indigo-500/30 hover:bg-indigo-500/10 shrink-0 gap-1.5"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {unconsolidateMutation.isPending ? "Restaurando..." : "Voltar ao template da empresa"}
        </Button>
      </div>
    );
  }

  // Sem conflito e não consolidado -> nada a resolver
  if (!temConflitos) return null;

  // Prévia do que "Tornar autônomo" vai gravar:
  const nomesJaNaColeta = new Set(audit.collection.agentFields.map((f) => f.name.toLowerCase()));
  const camposQueVaoEntrar = audit.collection.templateFields.filter((f) => !nomesJaNaColeta.has(f.name.toLowerCase()));
  const todosOsCampos = [...audit.collection.agentFields, ...camposQueVaoEntrar];

  const promptEfetivoVazio = !audit.prompt.value || audit.prompt.value.trim().length < 20;

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
              className="text-[11px] font-medium text-amber-600 hover:text-amber-700 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1 mt-1"
            >
              <Lock className="w-3 h-3" />
              Tornar agente autônomo (ignorar template) →
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent className="max-w-lg">
            <AlertDialogHeader>
              <AlertDialogTitle>Tornar este agente autônomo?</AlertDialogTitle>
              <AlertDialogDescription className="text-xs text-muted-foreground space-y-3 pt-1">
                <span className="block">
                  <strong>1. Prompt que será gravado:</strong>
                  <span className="block p-2 mt-1 rounded bg-slate-100 dark:bg-slate-900 font-mono text-[11px] text-foreground max-h-28 overflow-y-auto">
                    {audit.prompt.value || "(Nenhum prompt definido)"}
                  </span>
                </span>

                <span className="block">
                  <strong>2. Campos de Coleta que serão gravados:</strong>
                  <span className="block mt-1 text-foreground font-medium">
                    {todosOsCampos.length > 0 ? todosOsCampos.map((f) => f.name).join(", ") : "Nenhum campo"}
                  </span>
                </span>

                <span className="block p-2 rounded bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 font-medium">
                  Este agente não usará mais o template da empresa ("{templateKeyEmUso}"). O que ele pergunta e como responde virá exclusivamente do que está configurado nele. Você poderá desfazer e voltar ao template a qualquer momento.
                </span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="h-8 text-xs">Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleConsolidate} disabled={consolidateMutation.isPending} className="h-8 text-xs">
                {consolidateMutation.isPending ? "Gravando..." : "Tornar autônomo"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {promptEfetivoVazio && (
          <p className="text-[10px] text-rose-600">Escreva o prompt deste agente (mínimo de 20 caracteres) antes de torná-lo autônomo.</p>
        )}
      </div>
    </div>
  );
}

