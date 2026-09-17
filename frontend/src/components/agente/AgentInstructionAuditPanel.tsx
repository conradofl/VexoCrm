import { AlertTriangle, FileText, ListChecks, Cpu, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAgentInstructionAudit } from "@/hooks/useAgentInstructionAudit";

// "Um agente, um dono para cada texto" — Commit 1: mostrar a verdade, sem
// mover nada. Este painel não salva nada e não muda nenhum comportamento —
// só descreve, pra quem configura, de onde vem cada instrução que o agente
// usa HOJE, e aponta quando duas fontes pedem coisas diferentes.
export function AgentInstructionAuditPanel({ agentId }: { agentId: string | undefined }) {
  const { data, isLoading, error } = useAgentInstructionAudit(agentId);

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

  const { audit, templateKeyEmUso } = data;
  const temConflitos = audit.collection.conflicts.length > 0;

  return (
    <Card className="border-amber-500/30 dark:border-amber-500/20">
      <CardHeader className="pb-3">
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
