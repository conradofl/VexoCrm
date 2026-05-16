/**
 * Agente Extrator Áureo - Transforma conversa em briefing para consultor
 * Recebe contexto da conversa qualificada e estrutura para ação comercial
 */

/**
 * Extrai e estrutura briefing da conversa qualificada
 */
function getCollectedCredit(data = {}) {
  return data.credito ?? data.credito_faixa ?? data.crédito ?? null;
}

export function extractConversationBriefing(conversationData) {
  if (!conversationData) {
    return { error: "No conversation data provided" };
  }

  const {
    phone,
    clientId,
    collectedData = {},
    conversationStatus,
    qualificationStatus,
    startedAt,
    finishedAt,
  } = conversationData;

  // Extrair dados coletados com fallback
  const interest = collectedData.interesse || "Não informado";
  const objective = collectedData.objetivo || "Não informado";
  const state = collectedData.estado || "Não informado";
  const city = collectedData.cidade || "Não informado";
  const credit = getCollectedCredit(collectedData) || "Não informado";
  const installments = collectedData.parcela || "Não informado";
  const timeline = collectedData.prazo || "Não informado";
  const fgts = collectedData.lance_entrada_fgts || "Não informado";
  const bestTime = collectedData.melhor_horario || "Não informado";

  // Calcular duração
  const durationSeconds = finishedAt
    ? Math.round(
        (new Date(finishedAt) - new Date(startedAt)) / 1000
      )
    : Math.round((new Date() - new Date(startedAt)) / 1000);

  // Gerar leitura do lead
  const leadReading = generateLeadReading(collectedData, conversationStatus);

  // Gerar gancho para o consultor
  const consultorHook = generateConsultorHook(collectedData, qualificationStatus);

  // Gerar pontos de atenção
  const attentionPoints = generateAttentionPoints(collectedData, qualificationStatus);

  // Sugerir próximo passo
  const nextStep = suggestNextStep(collectedData, qualificationStatus);

  // Mapear interesse para categoria
  const interestCategory = mapInterestCategory(interest);

  return {
    success: true,
    briefing: {
      cliente: "Não informado", // Será preenchido com nome se disponível
      contato: phone,
      localizacao: `${city} - ${state}`,
      interesse: interestCategory,
      creditoDesejado: formatCreditAmount(credit),
      prazoIntencao: mapTimeline(timeline),
      parcelaConfortavel: formatInstallment(installments),
      lancoEntradaFgts: fgts,
      temperatura: qualificationStatus || "Não informado",
      leituraDoLead: leadReading,
      ganhoParaConsultor: consultorHook,
      pontosDeAtencao: attentionPoints,
      proximoPassoSugerido: nextStep,
      duracao: formatDuration(durationSeconds),
      status: conversationStatus,
    },
  };
}

/**
 * Gera leitura humanizada do lead
 */
function generateLeadReading(data, status) {
  const interest = data.interesse?.toLowerCase() || "";
  const objective = data.objetivo?.toLowerCase() || "";
  const timeline = data.prazo?.toLowerCase() || "";
  const credit = String(getCollectedCredit(data) || "").toLowerCase();

  let reading = "";

  // Analisar padrão de interesse
  if (interest.includes("sim") || interest.includes("yes")) {
    reading = "Lead com interesse explícito. ";
  } else if (interest.includes("não") || interest.includes("no")) {
    reading = "Lead sem interesse aparente. ";
  } else {
    reading = "Lead em fase exploratória. ";
  }

  // Adicionar contexto de objetivo
  if (objective) {
    reading += `Busca ${objective}. `;
  }

  // Adicionar contexto de prazo
  if (
    timeline.includes("logo") ||
    timeline.includes("imediato") ||
    timeline.includes("urgente")
  ) {
    reading += "Prazo curto - alta urgência. ";
  } else if (
    timeline.includes("calma") ||
    timeline.includes("sem pressa") ||
    timeline.includes("futura")
  ) {
    reading += "Sem urgência - pesquisando. ";
  }

  // Adicionar contexto de crédito
  if (credit.includes("excelente") || credit.includes("bom")) {
    reading += "Capacidade financeira boa.";
  } else if (credit.includes("regular")) {
    reading += "Capacidade financeira moderada.";
  } else if (credit.includes("baixo")) {
    reading += "Capacidade financeira limitada - pode precisar de estratégia especial.";
  }

  return reading || "Lead com potencial moderado.";
}

/**
 * Gera gancho prático para o consultor
 */
function generateConsultorHook(data, temperature) {
  if (temperature === "QUENTE") {
    return "Abrir com simulação de cenários. Lead está pronto para decisão - focar em soluções práticas e prazos.";
  }

  if (temperature === "MORNO") {
    return "Começar com educação sobre consórcio. Oferecer comparação com financiamento para contextualizar vantagens.";
  }

  return "Investir em qualificação adicional. Descobrir dor principal e como consórcio resolve sem forçar venda.";
}

/**
 * Gera pontos de atenção baseado em padrões
 */
function generateAttentionPoints(data, temperature) {
  const points = [];

  const interest = data.interesse?.toLowerCase() || "";
  const credit = String(getCollectedCredit(data) || "").toLowerCase();
  const fgts = data.lance_entrada_fgts?.toLowerCase() || "";
  const timeline = data.prazo?.toLowerCase() || "";

  // Ponto 1: Interesse
  if (!interest || interest === "não" || interest === "no") {
    points.push("Lead recusou interesse inicial - verificar se é objeção ou apenas resistência comum");
  } else if (interest === "sim" || interest === "yes") {
    points.push("Lead aberto - aproveitar para detalhar soluções específicas");
  }

  // Ponto 2: Crédito
  if (credit.includes("baixo") || credit.includes("regular")) {
    points.push("Score limitado - destacar flexibilidade e aprovação mais rápida do consórcio vs financiamento");
  }

  // Ponto 3: FGTS
  if (
    fgts.includes("sim") ||
    fgts.includes("yes") ||
    fgts.includes("talvez")
  ) {
    points.push("Lead interessado em usar FGTS - preparar simulações com esse recurso como entrada");
  } else if (fgts.includes("não") || fgts.includes("no")) {
    points.push("Sem FGTS disponível - explorar outras formas de entrada (economias, parcial)");
  }

  // Ponto 4: Timeline
  if (
    timeline.includes("logo") ||
    timeline.includes("imediato") ||
    timeline.includes("próximas 2 semanas")
  ) {
    points.push("Prazo curto - priorizar agilidade na aprovação e envio de documentação simplificada");
  }

  // Adicionar genérico se menos de 3 pontos
  if (points.length < 3) {
    const dataPoints = Object.keys(data).length;
    if (dataPoints <= 3) {
      points.push("Faltam dados para qualificação completa - completar em primeira ligação");
    }
  }

  return points.slice(0, 3); // Máximo 3 pontos
}

/**
 * Sugere próximo passo comercial
 */
function suggestNextStep(data, temperature) {
  if (temperature === "QUENTE") {
    return "Simulação de cenários personalizados com prazos reais de aprovação";
  }

  if (temperature === "MORNO") {
    return "Explicar diferença entre consórcio e financiamento + enviar documentação de exemplo";
  }

  if (!data.objetivo || !data.prazo) {
    return "Qualificar melhor: entender timeline exata e qual bem específico busca";
  }

  return "Propor reunião para análise de melhor modalidade (carta contemplada vs grupo)";
}

/**
 * Mapeia descrição de interesse para categoria
 */
function mapInterestCategory(interest) {
  const normalized = interest?.toLowerCase() || "";

  if (
    normalized.includes("imóvel") ||
    normalized.includes("casa") ||
    normalized.includes("apartamento")
  ) {
    return "Imóvel";
  }
  if (
    normalized.includes("veículo") ||
    normalized.includes("carro") ||
    normalized.includes("moto")
  ) {
    return "Veículo";
  }
  if (
    normalized.includes("investimento") ||
    normalized.includes("patrimônio") ||
    normalized.includes("poupança")
  ) {
    return "Investimento";
  }
  if (
    normalized.includes("carta") ||
    normalized.includes("contemplada") ||
    normalized.includes("rápido")
  ) {
    return "Carta Contemplada";
  }
  if (
    normalized.includes("empresa") ||
    normalized.includes("negócio") ||
    normalized.includes("expansão")
  ) {
    return "Empresa";
  }

  return interest || "Não informado";
}

/**
 * Mapeia descrição de prazo para categoria
 */
function mapTimeline(timeline) {
  const normalized = timeline?.toLowerCase() || "";

  if (
    normalized.includes("logo") ||
    normalized.includes("imediato") ||
    normalized.includes("urgente") ||
    normalized.includes("próximas 2 semanas")
  ) {
    return "Imediato";
  }
  if (
    normalized.includes("próximos 3 meses") ||
    normalized.includes("até 90 dias") ||
    normalized.includes("próximas semanas")
  ) {
    return "Até 90 dias";
  }
  if (
    normalized.includes("3 a 12 meses") ||
    normalized.includes("próximo ano")
  ) {
    return "3 a 12 meses";
  }
  if (
    normalized.includes("acima de 12 meses") ||
    normalized.includes("futura") ||
    normalized.includes("calma") ||
    normalized.includes("sem pressa")
  ) {
    return "Acima de 12 meses";
  }

  return "Não informado";
}

/**
 * Formata valor de crédito
 */
function formatCreditAmount(value) {
  if (!value) return "Não informado";
  if (typeof value === "number") {
    return `R$ ${value.toLocaleString("pt-BR")}`;
  }
  return String(value);
}

/**
 * Formata parcela
 */
function formatInstallment(installment) {
  if (!installment) return "Não informado";

  const normalized = String(installment).toLowerCase();
  if (/^\d+$/.test(normalized)) {
    return `${normalized}x`;
  }

  return String(installment);
}

/**
 * Formata duração em minutos e segundos
 */
function formatDuration(seconds) {
  if (!seconds) return "0s";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }

  return `${minutes}m${remainingSeconds > 0 ? ` ${remainingSeconds}s` : ""}`;
}

export default extractConversationBriefing;
