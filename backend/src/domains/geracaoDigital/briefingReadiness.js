/**
 * backend/src/domains/geracaoDigital/briefingReadiness.js
 *
 * Avaliação da prontidão da implantação (O que falta para soltar).
 * Espelha frontend/src/lib/geracaoDigital/briefingReadiness.ts.
 */

export function calculateImplementationReadiness(data = {}) {
  const activeChips = Number(data.activeChipsCount || 0);
  const agent = data.inboundAgent || null;

  // 1. Chip conectado
  const chipConectado = activeChips > 0;

  // 2. Agente vinculado ao chip
  const instancesList = Array.isArray(agent?.evolution_instances) ? agent.evolution_instances : [];
  const hasLegacyInstance = Boolean(agent?.evolution_instance && String(agent.evolution_instance).trim());
  const agenteVinculado = instancesList.length > 0 || hasLegacyInstance;

  // 3. Agente ligado (se o agente for desligado, reflete imediatamente)
  const agenteLigado = Boolean(agent?.inbound_enabled || data.chatbotEnabled);

  // 4. Base de conhecimento com pelo menos um documento
  const baseConhecimento = Number(data.documentsCount || 0) > 0;

  // 5. Prompt aprovado
  const promptValido = Boolean(
    (agent?.inbound_prompt && String(agent.inbound_prompt).trim().length > 0) ||
    (data.promptContent && String(data.promptContent).trim().length > 0)
  );

  const itens = [
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
