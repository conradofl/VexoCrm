/**
 * Avaliação da prontidão da implantação (O que falta para soltar)
 *
 * Itens concretos:
 * 1. Chip conectado (/crm/chips-whatsapp?tab=conexoes)
 * 2. Agente vinculado ao chip (/crm/agente)
 * 3. Agente ligado (/crm/agente)
 * 4. Base de conhecimento com pelo menos um documento (/crm/agente?tab=docs)
 * 5. Prompt aprovado (/crm/padroes-da-empresa)
 */

export interface ReadinessItem {
  id: "chip_conectado" | "agente_vinculado_chip" | "agente_ligado" | "base_conhecimento" | "prompt_aprovado";
  nome: string;
  descricao: string;
  pronto: boolean;
  link: string;
  linkTexto: string;
}

export interface ImplementationReadinessReport {
  prontoParaSoltar: boolean;
  totalItens: number;
  itensProntos: number;
  itens: ReadinessItem[];
}

export interface ReadinessInputData {
  activeChipsCount?: number;
  inboundAgent?: {
    id?: string;
    evolution_instances?: string[];
    evolution_instance?: string | null;
    inbound_enabled?: boolean;
    inbound_prompt?: string | null;
  } | null;
  chatbotEnabled?: boolean;
  documentsCount?: number;
  promptContent?: string | null;
}

export function calculateImplementationReadiness(data: ReadinessInputData): ImplementationReadinessReport {
  const activeChips = Number(data.activeChipsCount || 0);
  const agent = data.inboundAgent || null;

  // 1. Chip conectado
  const chipConectado = activeChips > 0;

  // 2. Agente vinculado ao chip
  const instancesList = Array.isArray(agent?.evolution_instances) ? agent.evolution_instances : [];
  const hasLegacyInstance = Boolean(agent?.evolution_instance && String(agent.evolution_instance).trim());
  const agenteVinculado = instancesList.length > 0 || hasLegacyInstance;

  // 3. Agente ligado
  // Se o consultor desligar o agente na tela, inbound_enabled fica false.
  // chatbotEnabled do n8n_settings também é avaliado como fallback do tenant.
  const agenteLigado = Boolean(agent?.inbound_enabled || data.chatbotEnabled);

  // 4. Base de conhecimento com pelo menos um documento
  const baseConhecimento = Number(data.documentsCount || 0) > 0;

  // 5. Prompt aprovado
  const promptValido = Boolean(
    (agent?.inbound_prompt && agent.inbound_prompt.trim().length > 0) ||
    (data.promptContent && data.promptContent.trim().length > 0)
  );

  const itens: ReadinessItem[] = [
    {
      id: "chip_conectado",
      nome: "Chip conectado",
      descricao: chipConectado
        ? `${activeChips} chip(s) ativo(s) e conectado(s).`
        : "Nenhum chip WhatsApp conectado no momento.",
      pronto: chipConectado,
      link: "/crm/chips-whatsapp?tab=conexoes",
      linkTexto: "Conectar Chip",
    },
    {
      id: "agente_vinculado_chip",
      nome: "Agente vinculado ao chip",
      descricao: agenteVinculado
        ? "Agente de atendimento devidamente associado ao número do WhatsApp."
        : "O agente ainda não foi vinculado a nenhum chip conectado.",
      pronto: agenteVinculado,
      link: "/crm/agente",
      linkTexto: "Vincular Agente",
    },
    {
      id: "agente_ligado",
      nome: "Agente ligado",
      descricao: agenteLigado
        ? "Agente ativo e pronto para responder mensagens automaticamente."
        : "Agente pausado/desligado nas configurações de atendimento.",
      pronto: agenteLigado,
      link: "/crm/agente",
      linkTexto: "Ligar Agente",
    },
    {
      id: "base_conhecimento",
      nome: "Base de conhecimento com pelo menos um documento",
      descricao: baseConhecimento
        ? `${data.documentsCount} documento(s) indexado(s) para contextualização da IA.`
        : "Nenhum documento institucional anexado para consulta da IA.",
      pronto: baseConhecimento,
      link: "/crm/agente?tab=docs",
      linkTexto: "Enviar Documento",
    },
    {
      id: "prompt_aprovado",
      nome: "Prompt aprovado",
      descricao: promptValido
        ? "Prompt com instruções comerciais e limites aprovados."
        : "Prompt padrão não preenchido ou pendente de aprovação.",
      pronto: promptValido,
      link: "/crm/padroes-da-empresa",
      linkTexto: "Aprovar Prompt",
    },
  ];

  const itensProntos = itens.filter(i => i.pronto).length;

  return {
    prontoParaSoltar: itensProntos === itens.length,
    totalItens: itens.length,
    itensProntos,
    itens,
  };
}
