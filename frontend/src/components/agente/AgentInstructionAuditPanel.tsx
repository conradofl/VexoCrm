import { AlertTriangle, FileText, ListChecks, Cpu, Loader2, ShieldCheck, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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

// "Um agente, um dono para cada texto" — Commits 1 e 2.
// Commit 1: painel só descreve, não muda nada — de onde vem prompt, modelo e
// coleta, e onde template e Coleta do agente competem em silêncio.
// Commit 2: "Consolidar neste agente" grava no próprio agente o que já valia
// (prompt efetivo + união dos campos) e marca o agente como autônomo — a
// partir daí template e prompt padrão do tenant nem são buscados
// (chatbot-ai-engine.js). Ação de mão única: não existe "desconsolidar".
export function AgentInstructionAuditPanel({ agentId }: { agentId: string | undefined }) {
  const { data, isLoading, error } = useAgentInstructionAudit(agentId);
  const consolidateMutation = useConsolidateAgent(agentId);

  if (!agentId) return null;

  if (isLoading) {
    return (
      <Card className="border-border dark:border-zinc-800">
        <CardContent className="p-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Carregando diagnóstico do agente...
        </CardContent>
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card className="border-border dark:border-zinc-800">
        <CardContent className="p-4 text-xs text-muted-foreground">
          Não foi possível carregar o diagnóstico deste agente agora.
        </CardContent>
      </Card>
    );
  }

  const { audit, templateKeyEmUso, consolidated } = data;
  const temConflitos = audit.collection.conflicts.length > 0;

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

  if (consolidated) {
    return (
      <Card className="border-emerald-500/30 dark:border-emerald-500/20">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-600">
              <ShieldCheck className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold">Este agente é autônomo</CardTitle>
              <CardDescription className="text-[11px]">Nada fora daqui o instrui — nem template, nem prompt padrão do tenant.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <div className="flex items-start gap-2">
            <FileText className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <span className="font-semibold">Prompt</span>{" "}
              <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                Fonte: este agente
              </Badge>
            </div>
          </div>
          <div className="flex items-start gap-2">
            <ListChecks className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
            <span>Coleta: {audit.collection.agentFields.length} campo(s), todos definidos neste agente.</span>
          </div>
          <div className="flex items-start gap-2">
            <Cpu className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
            <span>Modelo: {audit.model.value || "—"}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-500/30 dark:border-amber-500/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-600">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <div>
              <CardTitle className="text-sm font-bold">De onde vem o que este agente fala</CardTitle>
              <CardDescription className="text-[11px]">
                Diagnóstico — não muda nada. Mostra quem instrui este agente hoje, e onde duas fontes competem.
              </CardDescription>
            </div>
          </div>

          <div className="flex flex-col items-end gap-1 shrink-0">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" className="text-xs gap-1.5" disabled={promptEfetivoVazio}>
                  <Lock className="w-3 h-3" />
                  Consolidar neste agente
                </Button>
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
                      A Coleta ganha {camposQueVaoEntrar.length} campo(s) que o template pedia e este agente ainda não pedia:{" "}
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
              <p className="text-[10px] text-rose-600 text-right max-w-[220px]">
                Escreva o prompt deste agente antes de consolidar.
              </p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-xs">
        {/* Prompt */}
        <div className="flex items-start gap-2">
          <FileText className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-semibold">Prompt</span>
              {audit.prompt.source === "agente" && (
                <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-500/30">
                  Fonte: este agente
                </Badge>
              )}
              {audit.prompt.source === "tenant" && (
                <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-500/30">
                  Fonte: prompt padrão do tenant (agente não tem prompt próprio)
                </Badge>
              )}
              {audit.prompt.source === "nenhum" && (
                <Badge variant="outline" className="text-[10px] text-rose-600 border-rose-500/30">
                  Nenhum prompt configurado
                </Badge>
              )}
            </div>
            {audit.prompt.source === "tenant" && (
              <p className="text-[11px] text-muted-foreground">
                Este texto vale para TODOS os agentes do tenant sem prompt próprio — mudar aqui muda a conversa de todos eles.
              </p>
            )}
          </div>
        </div>

        {/* Modelo */}
        <div className="flex items-start gap-2">
          <Cpu className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <div className="flex items-center gap-2">
            <span className="font-semibold">Modelo</span>
            <Badge
              variant="outline"
              className={`text-[10px] ${audit.model.source === "agente" ? "text-emerald-600 border-emerald-500/30" : "text-amber-600 border-amber-500/30"}`}
            >
              Fonte: {audit.model.source}
            </Badge>
            <span className="text-muted-foreground">{audit.model.value || "—"}</span>
          </div>
        </div>

        {/* Coleta */}
        <div className="flex items-start gap-2">
          <ListChecks className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
          <div className="space-y-2 min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold">Coleta</span>
              <span className="text-muted-foreground">
                agente pede {audit.collection.agentFields.length} campo(s) · template "{templateKeyEmUso}" pede{" "}
                {audit.collection.templateFields.length} campo(s)
              </span>
            </div>

            {!temConflitos && (
              <p className="text-[11px] text-emerald-600">Sem conflito — as duas listas pedem exatamente os mesmos campos.</p>
            )}

            {temConflitos && (
              <div className="space-y-1.5">
                {audit.collection.conflicts.map((c) => (
                  <div
                    key={c.field}
                    className="flex items-start gap-1.5 p-2 rounded-lg bg-amber-500/5 border border-amber-500/20"
                  >
                    <AlertTriangle className="w-3 h-3 mt-0.5 text-amber-600 shrink-0" />
                    <span className="text-[11px] text-foreground">{c.motivo}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
