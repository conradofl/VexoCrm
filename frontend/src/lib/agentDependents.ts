// O que o servidor devolve quando recusa a exclusão definitiva de um agente
// (409 AGENT_HAS_DEPENDENTS): uma contagem por tabela. Aqui vira frase de gente.

export type AgentDependent = { table: string; count: number; onDelete?: string };

const LABELS: Record<string, [singular: string, plural: string]> = {
  followup_campaigns: ["campanha", "campanhas"],
  followup_schedules: ["agendamento", "agendamentos"],
  followup_replies: ["resposta recebida", "respostas recebidas"],
  followup_suggestions: ["sugestão", "sugestões"],
  fup_journeys: ["jornada", "jornadas"],
  rag_documents: ["documento da base de conhecimento", "documentos da base de conhecimento"],
};

// Ex.: "2 campanhas, 9 agendamentos". Tabela que esta lista não conhece não
// some da frase: aparece com o nome técnico, para ninguém achar que é zero.
export function describeAgentDependents(dependents: AgentDependent[] | null | undefined): string {
  return (dependents || [])
    .filter((d) => d && d.count > 0)
    .map((d) => {
      const label = LABELS[d.table];
      if (!label) return `${d.count} ${d.count === 1 ? "registro" : "registros"} em ${d.table}`;
      return `${d.count} ${d.count === 1 ? label[0] : label[1]}`;
    })
    .join(", ");
}

export class AgentHasDependentsError extends Error {
  dependents: AgentDependent[];
  constructor(message: string, dependents: AgentDependent[]) {
    super(message);
    this.name = "AgentHasDependentsError";
    this.dependents = dependents;
  }
}
