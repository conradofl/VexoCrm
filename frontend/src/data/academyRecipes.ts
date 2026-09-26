// frontend/src/data/academyRecipes.ts
//
// Vexo Academy — receita é dado. Cada entrada aqui é uma receita pronta:
// título, resultado, pré-requisitos, passos com o nome real da tela, o
// conteúdo de verdade (mensagens) e o que a instalação cria. Nada de
// conteúdo escrito dentro de componente de tela — quem edita uma receita
// edita este arquivo, não JSX.
//
// Regra do anonimato: nenhuma receita cita nome de empresa real, nossa ou de
// cliente. Só o nome do segmento (genérico). Vale para título, resultado,
// passos e — principalmente — para o texto das mensagens.

export type AcademyRecipeObjective =
  | "Recuperar lead frio"
  | "Aumentar comparecimento";

export interface AcademyRecipeStep {
  /** Nome real da tela do sistema, como aparece no menu — não uma paráfrase. */
  screen: string;
  instruction: string;
}

/**
 * Uma mensagem da cadência a ser criada. O formato espelha o que
 * POST /api/followup/templates espera (menos campaign_id, que só existe
 * depois de instalada) — pra instalar não ser mais que "mandar isto aqui".
 */
export interface AcademyRecipeTemplate {
  label: string;
  message: string;
  trigger_type: "no_reply" | "before_meeting" | "after_meeting" | "on_schedule";
  trigger_value: number;
  trigger_unit: "minutes" | "hours" | "days";
  trigger_direction: "before" | "after" | null;
}

export interface AcademyRecipe {
  id: string;
  title: string;
  /** A frase de resultado — o que a pessoa ganha, não o que a receita faz tecnicamente. */
  resultPhrase: string;
  objective: AcademyRecipeObjective;
  /** Segmentos que a receita atende — só o nome do segmento, nunca empresa real. */
  segments: string[];
  prerequisites: string[];
  whatHappens: string;
  estimatedMinutes: number;
  steps: AcademyRecipeStep[];
  /** O nome-base da cadência criada na instalação — ganha sufixo se já existir. */
  cadenceName: string;
  cadenceDescription: string;
  templates: AcademyRecipeTemplate[];
}

export const ACADEMY_RECIPES: AcademyRecipe[] = [
  {
    id: "recipe-recuperar-lead-frio",
    title: "Recuperar lead que parou de responder",
    resultPhrase:
      "Quem some no meio da conversa volta a receber contato sozinho — sem alguém do time precisar lembrar.",
    objective: "Recuperar lead frio",
    segments: ["Clínicas e estética", "Serviços em geral", "Climatização"],
    prerequisites: [
      "Ter um agente configurado em Cadências de Follow-up.",
      "Esse agente com um chip conectado e ativo.",
    ],
    whatHappens:
      "Cria uma cadência com 3 mensagens espaçadas, disparadas automaticamente para quem não responde. A cadência para sozinha assim que o lead responde qualquer coisa — ninguém recebe cobrança depois de já ter respondido.",
    estimatedMinutes: 5,
    steps: [
      {
        screen: "Cadências de Follow-up",
        instruction: "Abra o agente que vai enviar esta cadência (o que a Academy criar fica como rascunho, desligado).",
      },
      {
        screen: "Cadências de Follow-up",
        instruction: "Confira as 3 mensagens criadas, ajuste o texto se quiser, e só então ligue a cadência.",
      },
      {
        screen: "Fila de Follow-up",
        instruction: "Acompanhe quem está agendado para receber cada etapa.",
      },
    ],
    cadenceName: "Recuperação — sem resposta",
    cadenceDescription: "Cadência de 3 toques para lead que parou de responder, instalada pela Vexo Academy.",
    templates: [
      {
        label: "1º toque — 1 dia depois",
        message:
          "Oi {{nome}}, tudo bem? Vi que nossa conversa ficou parada — ainda faz sentido pra você seguirmos com o que combinamos?",
        trigger_type: "no_reply",
        trigger_value: 1,
        trigger_unit: "days",
        trigger_direction: "after",
      },
      {
        label: "2º toque — 3 dias depois",
        message:
          "{{nome}}, só pra não perder o fio: se ainda tiver interesse, me chama por aqui mesmo que eu te explico o próximo passo.",
        trigger_type: "no_reply",
        trigger_value: 3,
        trigger_unit: "days",
        trigger_direction: "after",
      },
      {
        label: "3º toque — 7 dias depois",
        message:
          "{{nome}}, essa é a última mensagem que mando por aqui sobre esse assunto. Se quiser retomar depois, é só me chamar quando fizer sentido pra você.",
        trigger_type: "no_reply",
        trigger_value: 7,
        trigger_unit: "days",
        trigger_direction: "after",
      },
    ],
  },
  {
    id: "recipe-confirmar-presenca",
    title: "Confirmar presença antes do horário marcado",
    resultPhrase:
      "Menos gente falta: o lead recebe um lembrete automático antes do horário combinado, sem alguém do time precisar ligar.",
    objective: "Aumentar comparecimento",
    segments: ["Clínicas e estética", "Serviços em geral", "Educação"],
    prerequisites: [
      "Ter um agente configurado em Cadências de Follow-up.",
      "Os agendamentos desse agente terem data/hora marcada (vindos do fluxo de marcação já em uso).",
    ],
    whatHappens:
      "Cria uma cadência com 2 mensagens: um lembrete um dia antes do horário marcado e uma confirmação poucas horas antes. Para sozinha se o lead responder cancelando ou remarcando.",
    estimatedMinutes: 5,
    steps: [
      {
        screen: "Cadências de Follow-up",
        instruction: "Abra o agente que atende esse agendamento (a cadência entra como rascunho, desligada).",
      },
      {
        screen: "Cadências de Follow-up",
        instruction: "Revise as 2 mensagens e o intervalo de cada uma antes de ligar a cadência.",
      },
      {
        screen: "Fila de Follow-up",
        instruction: "Veja quem está na fila de lembrete para os próximos dias.",
      },
    ],
    cadenceName: "Confirmação de presença",
    cadenceDescription: "Cadência de 2 toques de lembrete antes do horário marcado, instalada pela Vexo Academy.",
    templates: [
      {
        label: "Lembrete — 1 dia antes",
        message:
          "Oi {{nome}}! Passando pra lembrar do nosso horário marcado amanhã. Consegue confirmar presença por aqui?",
        trigger_type: "before_meeting",
        trigger_value: 1,
        trigger_unit: "days",
        trigger_direction: "before",
      },
      {
        label: "Confirmação — 2 horas antes",
        message:
          "{{nome}}, já já é o nosso horário. Te espero! Se precisar remarcar, me avisa por aqui o quanto antes.",
        trigger_type: "before_meeting",
        trigger_value: 2,
        trigger_unit: "hours",
        trigger_direction: "before",
      },
    ],
  },
];

export function getAcademyRecipeById(id: string): AcademyRecipe | undefined {
  return ACADEMY_RECIPES.find((r) => r.id === id);
}
