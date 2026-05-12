/**
 * Chatbot Outlier - SPIN Selling Flow (Qualificação de Leads)
 * Hardcoded flow para coleta incremental de dados
 */

import HardcodedChatbot, { ChatbotStep } from "./hardcoded-chatbot.js";

const OUTLIER_STEPS = {
  // SITUAÇÃO: Entender contexto e interesse
  situation_interest: {
    id: "situation_interest",
    message:
      "Olá! 👋 Nós da Vexo CRM estamos te contando sobre oportunidades de crédito. Você tem interesse em conhecer nossas soluções? (sim/não)",
    dataField: "interesse",
    validator: (response) => {
      const normalized = response?.toLowerCase()?.trim();
      if (["sim", "yes", "s", "1"].includes(normalized)) {
        return { valid: true };
      }
      if (["não", "no", "n", "0"].includes(normalized)) {
        return { valid: false, error: "Entendido, obrigado!" };
      }
      return { valid: false, error: "Por favor, responda com 'sim' ou 'não'" };
    },
    nextStepId: "situation_objective",
  },

  // SITUAÇÃO: Qual o objetivo
  situation_objective: {
    id: "situation_objective",
    message:
      "Qual é seu principal objetivo? (Refinanciar dívidas / Investimento pessoal / Expandir negócio / Reforma / Outro)",
    dataField: "objetivo",
    validator: (response) => {
      if (response && response.trim().length >= 3) {
        return { valid: true };
      }
      return {
        valid: false,
        error: "Por favor, descreva seu objetivo com mais detalhes",
      };
    },
    nextStepId: "situation_state",
  },

  // SITUAÇÃO: Estado/Localização
  situation_state: {
    id: "situation_state",
    message:
      "Em qual estado você está localizado? (Ex: São Paulo, Rio de Janeiro, etc.)",
    dataField: "estado",
    validator: (response) => {
      if (response && response.trim().length >= 2) {
        return { valid: true };
      }
      return { valid: false, error: "Por favor, informe um estado válido" };
    },
    nextStepId: "situation_city",
  },

  // SITUAÇÃO: Cidade
  situation_city: {
    id: "situation_city",
    message: "E qual é sua cidade?",
    dataField: "cidade",
    validator: (response) => {
      if (response && response.trim().length >= 2) {
        return { valid: true };
      }
      return { valid: false, error: "Por favor, informe uma cidade válida" };
    },
    nextStepId: "problem_credit",
  },

  // PROBLEMA: Situação financeira e crédito
  problem_credit: {
    id: "problem_credit",
    message:
      "Como você avalia seu score de crédito? (Excelente / Bom / Regular / Baixo)",
    dataField: "crédito",
    validator: (response) => {
      const normalized = response?.toLowerCase()?.trim();
      const valid = [
        "excelente",
        "bom",
        "regular",
        "baixo",
        "excellent",
        "good",
        "fair",
        "poor",
      ];
      if (valid.includes(normalized)) {
        return { valid: true };
      }
      return {
        valid: false,
        error: "Por favor, escolha: Excelente, Bom, Regular ou Baixo",
      };
    },
    nextStepId: "implication_parcels",
  },

  // IMPLICAÇÃO: Parcelamento
  implication_parcels: {
    id: "implication_parcels",
    message:
      "Em quantas parcelas você gostaria de parcelar? (3 / 6 / 12 / 24 / 36 / Outra)",
    dataField: "parcela",
    validator: (response) => {
      const normalized = response?.toLowerCase()?.trim();
      const valid = ["3", "6", "12", "24", "36", "outra", "other"];
      if (valid.includes(normalized) || /^\d+$/.test(normalized)) {
        return { valid: true };
      }
      return {
        valid: false,
        error: "Por favor, especifique um número de parcelas válido",
      };
    },
    nextStepId: "implication_timeline",
  },

  // IMPLICAÇÃO: Timeline
  implication_timeline: {
    id: "implication_timeline",
    message:
      "Qual seu prazo? (Imediato / Próximos 7 dias / Próximas 2 semanas / Próximo mês / Sem pressa)",
    dataField: "prazo",
    validator: (response) => {
      if (response && response.trim().length >= 3) {
        return { valid: true };
      }
      return { valid: false, error: "Por favor, descreva o prazo" };
    },
    nextStepId: "implication_fgts",
  },

  // IMPLICAÇÃO: Entrada com FGTS
  implication_fgts: {
    id: "implication_fgts",
    message:
      "Você gostaria de usar FGTS como lançamento de entrada? (sim / não / talvez)",
    dataField: "lance_entrada_fgts",
    validator: (response) => {
      const normalized = response?.toLowerCase()?.trim();
      const valid = ["sim", "não", "talvez", "yes", "no", "maybe", "s", "n"];
      if (valid.includes(normalized)) {
        return { valid: true };
      }
      return {
        valid: false,
        error: "Por favor, responda: sim, não ou talvez",
      };
    },
    nextStepId: "necessity_best_time",
  },

  // NECESSIDADE: Melhor horário de contato
  necessity_best_time: {
    id: "necessity_best_time",
    message:
      "Qual é o melhor horário para você ser contactado? (Manhã / Tarde / Noite)",
    dataField: "melhor_horario",
    validator: (response) => {
      const normalized = response?.toLowerCase()?.trim();
      const valid = ["manhã", "tarde", "noite", "morning", "afternoon", "night"];
      if (valid.includes(normalized)) {
        return { valid: true };
      }
      return {
        valid: false,
        error: "Por favor, escolha: Manhã, Tarde ou Noite",
      };
    },
    nextStepId: null, // FIM
  },
};

/**
 * Instância configurada para Outlier
 */
export class OutlierQualificationBot extends HardcodedChatbot {
  constructor(clientId = "outlier") {
    super(clientId, {
      startStepId: "situation_interest",
      steps: Object.values(OUTLIER_STEPS),
    });
  }

  validateCollectedData(data) {
    const requiredFields = [
      "interesse",
      "objetivo",
      "estado",
      "cidade",
      "crédito",
    ];
    const missingFields = requiredFields.filter(
      (field) => !data[field] || !data[field].trim()
    );

    if (missingFields.length > 0) {
      return {
        valid: false,
        missingFields,
        message: `Faltam informações: ${missingFields.join(", ")}`,
      };
    }

    return { valid: true };
  }

  generateMetrics(memory) {
    const baseMetrics = super.generateMetrics(memory);
    return {
      ...baseMetrics,
      dataCompleteness: Math.round(
        (Object.keys(memory.collectedData).length / Object.keys(OUTLIER_STEPS).length) *
          100
      ),
    };
  }
}

export default OutlierQualificationBot;
