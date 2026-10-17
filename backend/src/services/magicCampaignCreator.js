// backend/src/services/magicCampaignCreator.js
import { callLlmChatCompletion } from "../chatbot-ai-engine.js";
import { extractJsonFromLlmText } from "./jsonExtractor.js";

/**
 * Templates heurísticos de contingência para garantir que o usuário
 * NUNCA fique sem resposta caso a API da LLM falhe ou demore.
 */
const CONTINGENCY_TEMPLATES = {
  imobiliaria: {
    campaignName: "Oportunidade Imobiliária Exclusiva",
    rationale: "Abertura sutil de curiosidade sobre lançamentos com boa rentabilidade, seguida de opções interativas e link de agendamento com especialista.",
    steps: [
      {
        order: 1,
        type: "text",
        triggerMode: "immediate",
        text: "Olá {{primeiro_nome}}, tudo bem? Vi que você tem interesse no mercado imobiliário e surgiu uma condição diferenciada de lançamento que lembrei de você. Posso te adiantar por aqui?",
      },
      {
        order: 2,
        type: "text",
        triggerMode: "after_reply",
        text: "Que ótimo! Liberamos condições especiais de pré-lançamento com entrada facilitada e potencial de valorização acima da média da região.",
        buttons: [
          { type: "reply", displayText: "1 - Quero ver os detalhes", replyText: "1 - Quero ver os detalhes" },
          { type: "reply", displayText: "2 - Agora não posso", replyText: "2 - Agora não posso" },
        ],
      },
      {
        order: 3,
        type: "link",
        triggerMode: "after_reply",
        linkUrl: "https://{{scheduling_link}}",
        text: "👉 Acesse o link oficial para conferir a apresentação completa e reservar seu horário com nosso consultor especialista:",
      },
    ],
    agentPrompt: "Você é o especialista imobiliário da Vexo. Seu objetivo é tirar dúvidas do lead com tom consultivo e cordial. Se perguntarem sobre valores, metragens, localização ou fluxo de pagamento, explique de forma clara e convide a visitar o link de agendamento ou escolher o melhor horário para uma apresentação detalhada.",
  },

  estetica: {
    campaignName: "Renovação & Cuidado Especial",
    rationale: "Conexão humanizada focada em bem-estar e autoestima, com oferta de avaliação personalizada e agendamento direto.",
    steps: [
      {
        order: 1,
        type: "text",
        triggerMode: "immediate",
        text: "Oi {{primeiro_nome}}, tudo bem? Passando rapidinho porque abrimos uma oportunidade exclusiva de avaliação personalizada nesta semana. Consegue falar um minutinho?",
      },
      {
        order: 2,
        type: "text",
        triggerMode: "after_reply",
        text: "Maravilha! Preparamos um protocolo especial com condição VIP para os primeiros pacientes que confirmarem hoje.",
        buttons: [
          { type: "reply", displayText: "1 - Quero agendar avaliação", replyText: "1 - Quero agendar avaliação" },
          { type: "reply", displayText: "2 - No momento não", replyText: "2 - No momento não" },
        ],
      },
      {
        order: 3,
        type: "link",
        triggerMode: "after_reply",
        linkUrl: "https://{{scheduling_link}}",
        text: "👉 Acesse o link oficial para escolher o melhor dia e horário para o seu atendimento:",
      },
    ],
    agentPrompt: "Você é a consultora de estética e saúde. Responda dúvidas com tom acolhedor, profissional e empático. Se o cliente perguntar sobre contraindicações, valores ou procedimentos, explique os benefícios gerais e reforce que a avaliação presencial define o protocolo ideal com condição exclusiva.",
  },

  academia: {
    campaignName: "Plano Performance VIP",
    rationale: "Engajamento motivacional com foco em saúde e rotina, oferecendo passe livre ou condição especial de matrícula com link de ativação.",
    steps: [
      {
        order: 1,
        type: "text",
        triggerMode: "immediate",
        text: "Fala {{primeiro_nome}}, tudo certo? Vi que você estava querendo focar nos treinos e liberamos uma condição especial de matrícula nesta semana. Quer conferir?",
      },
      {
        order: 2,
        type: "text",
        triggerMode: "after_reply",
        text: "Show de bola! Liberamos isenção na taxa de matrícula + acompanhamento exclusivo com nossos personais no primeiro mês para quem ativar hoje.",
        buttons: [
          { type: "reply", displayText: "1 - Quero garantir minha vaga", replyText: "1 - Quero garantir minha vaga" },
          { type: "reply", displayText: "2 - Deixar para depois", replyText: "2 - Deixar para depois" },
        ],
      },
      {
        order: 3,
        type: "link",
        triggerMode: "after_reply",
        linkUrl: "https://{{scheduling_link}}",
        text: "👉 Acesse o link oficial para ativar sua matrícula com os benefícios exclusivos aplicados:",
      },
    ],
    agentPrompt: "Você é o consultor de treinos e bem-estar da academia. Seu objetivo é motivar o lead, tirar dúvidas sobre modalidades, horários de pico e estrutura, orientando a ativar a condição pelo link oficial.",
  },

  veiculos: {
    campaignName: "Troca Premiada & Condição Especial",
    rationale: "Abordagem consultiva para valorização do seminovo com taxa reduzida e simulação imediata.",
    steps: [
      {
        order: 1,
        type: "text",
        triggerMode: "immediate",
        text: "Olá {{primeiro_nome}}, tudo joia? Selecionamos alguns clientes para uma avaliação diferenciada de troca com taxa especial de financiamento neste mês. Posso te passar os detalhes?",
      },
      {
        order: 2,
        type: "text",
        triggerMode: "after_reply",
        text: "Excelente! Estamos com supervalorização no seu veículo usado e entrada facilitada para os modelos em destaque no nosso pátio.",
        buttons: [
          { type: "reply", displayText: "1 - Ver modelos disponíveis", replyText: "1 - Ver modelos disponíveis" },
          { type: "reply", displayText: "2 - Não tenho interesse", replyText: "2 - Não tenho interesse" },
        ],
      },
      {
        order: 3,
        type: "link",
        triggerMode: "after_reply",
        linkUrl: "https://{{scheduling_link}}",
        text: "👉 Acesse o link oficial para conferir as ofertas selecionadas e agendar sua visita ou test-drive:",
      },
    ],
    agentPrompt: "Você é o consultor automotivo. Tire dúvidas sobre modelos disponíveis, formas de pagamento, garantia e avaliação do usado, com tom cordial e prestativo, direcionando para o link oficial ou visita ao showroom.",
  },

  varejo: {
    campaignName: "Condição VIP de Desconto",
    rationale: "Sensação de benefício exclusivo para clientes da base, incentivando a compra com cupom ou link direto.",
    steps: [
      {
        order: 1,
        type: "text",
        triggerMode: "immediate",
        text: "Olá {{primeiro_nome}}, tudo bem? Como você já é nosso cliente especial, separamos um cupom exclusivo para sua próxima compra. Quer que eu te envie o código?",
      },
      {
        order: 2,
        type: "text",
        triggerMode: "after_reply",
        text: "Perfeito! Você ganhou um desconto exclusivo válido para as próximas 48 horas em toda a nossa linha selecionada.",
        buttons: [
          { type: "reply", displayText: "1 - Quero aproveitar agora", replyText: "1 - Quero aproveitar agora" },
          { type: "reply", displayText: "2 - Agora não preciso", replyText: "2 - Agora não preciso" },
        ],
      },
      {
        order: 3,
        type: "link",
        triggerMode: "after_reply",
        linkUrl: "https://{{scheduling_link}}",
        text: "👉 Acesse o link oficial para aplicar seu desconto exclusivo e garantir seu pedido:",
      },
    ],
    agentPrompt: "Você é o atendente comercial da loja. Ajude o lead tirando dúvidas sobre estoque, formas de pagamento e prazos de entrega, sempre incentivando o uso do link de desconto.",
  },

  b2b: {
    campaignName: "Aceleração Comercial B2B",
    rationale: "Prospecção consultiva corporativa focada em dor de negócio, eficiência operacional e reunião de diagnóstico.",
    steps: [
      {
        order: 1,
        type: "text",
        triggerMode: "immediate",
        text: "Olá {{primeiro_nome}}, tudo bem? Acompanho sua atuação no mercado e gostaria de trocar uma ideia rápida sobre como otimizar seus processos comerciais. Teria 5 minutos nesta semana?",
      },
      {
        order: 2,
        type: "text",
        triggerMode: "after_reply",
        text: "Excelente! Ajudamos empresas no mesmo segmento a reduzir custos operacionais e escalar vendas com automação inteligente.",
        buttons: [
          { type: "reply", displayText: "1 - Quero agendar conversa", replyText: "1 - Quero agendar conversa" },
          { type: "reply", displayText: "2 - No momento estamos bem", replyText: "2 - No momento estamos bem" },
        ],
      },
      {
        order: 3,
        type: "link",
        triggerMode: "after_reply",
        linkUrl: "https://{{scheduling_link}}",
        text: "👉 Acesse nossa agenda oficial para escolher o melhor horário para uma breve reunião de diagnóstico:",
      },
    ],
    agentPrompt: "Você é o consultor executivo B2B. Mantenha um tom profissional, focado em ROI, eficiência e escalabilidade. Responda a objeções de tempo ou orçamento explicando como funciona nossa consultoria rápida de diagnóstico.",
  },

  geral: {
    campaignName: "Campanha Promocional Exclusiva",
    rationale: "Estrutura de conversão em 3 tempos: curiosidade inicial, apresentação da oferta com botões rápidos e chamada direta para link oficial.",
    steps: [
      {
        order: 1,
        type: "text",
        triggerMode: "immediate",
        text: "Olá {{primeiro_nome}}, tudo bem? Separei uma condição especial que pode ser muito útil para você hoje. Posso te adiantar por aqui?",
      },
      {
        order: 2,
        type: "text",
        triggerMode: "after_reply",
        text: "Que bom! Liberamos uma oportunidade exclusiva para um grupo selecionado de clientes, com vantagens especiais válidas por tempo limitado.",
        buttons: [
          { type: "reply", displayText: "1 - Quero aproveitar", replyText: "1 - Quero aproveitar" },
          { type: "reply", displayText: "2 - Agora não", replyText: "2 - Agora não" },
        ],
      },
      {
        order: 3,
        type: "link",
        triggerMode: "after_reply",
        linkUrl: "https://{{scheduling_link}}",
        text: "👉 Acesse o link oficial para garantir sua condição exclusiva e tirar suas dúvidas:",
      },
    ],
    agentPrompt: "Você é o assistente virtual da campanha. Seu papel é acolher o lead com cortesia, tirar dúvidas sobre as vantagens e condições especiais, e direcioná-lo para acessar o link oficial ou finalizar o contato com nossa equipe.",
  },
};

/**
 * Normaliza o nicho recebido para uma chave conhecida ou customizada.
 */
function normalizeNicheKey(niche) {
  if (!niche || typeof niche !== "string") return "geral";
  const lower = niche.trim().toLowerCase();
  if (lower.includes("imob") || lower.includes("apto") || lower.includes("imovel") || lower.includes("casa")) return "imobiliaria";
  if (lower.includes("estet") || lower.includes("saude") || lower.includes("clinica") || lower.includes("beleza")) return "estetica";
  if (lower.includes("acad") || lower.includes("fitness") || lower.includes("treino") || lower.includes("crossfit")) return "academia";
  if (lower.includes("veic") || lower.includes("carro") || lower.includes("auto") || lower.includes("moto")) return "veiculos";
  if (lower.includes("varejo") || lower.includes("comerc") || lower.includes("loja") || lower.includes("shop")) return "varejo";
  if (lower.includes("b2b") || lower.includes("corp") || lower.includes("empresa") || lower.includes("software")) return "b2b";
  return "geral";
}

/**
 * Gera uma resposta de contingência heurística bem estruturada.
 */
export function getFallbackMagicCampaign({ prompt = "", niche = "geral", tone = "consultivo" } = {}) {
  const nicheKey = normalizeNicheKey(niche);
  const base = CONTINGENCY_TEMPLATES[nicheKey] || CONTINGENCY_TEMPLATES.geral;

  // Customiza nome ou rationale se houver prompt específico
  let campaignName = base.campaignName;
  let rationale = base.rationale;
  let agentPrompt = base.agentPrompt;

  const cleanPrompt = String(prompt || "").trim();
  if (cleanPrompt) {
    campaignName = cleanPrompt.length > 50 ? `${cleanPrompt.slice(0, 47)}...` : cleanPrompt;
    // Capitaliza primeira letra
    campaignName = campaignName.charAt(0).toUpperCase() + campaignName.slice(1);
    rationale = `Estratégia focada no segmento ${niche || "comercial"}: abertura gerando curiosidade rápida, oferta estruturada com botões e link direto de conversão.`;
  }

  if (tone === "descontraido") {
    agentPrompt = `${agentPrompt} Adote um tom amigável, informal e leve, usando emojis discretos quando apropriado.`;
  } else if (tone === "persuasivo") {
    agentPrompt = `${agentPrompt} Adote um tom persuasivo e seguro, destacando o valor e a exclusividade da oferta.`;
  }

  return {
    campaignName,
    rationale,
    steps: base.steps.map((step, idx) => ({
      ...step,
      order: idx + 1,
      buttons: step.buttons ? [...step.buttons] : undefined,
    })),
    agentPrompt,
  };
}

/**
 * Valida e normaliza o objeto retornado pela IA para garantir que obedece
 * estritamente ao contrato exigido pela tela de campanhas.
 */
function sanitizeMagicCampaignOutput(parsed, fallback) {
  if (!parsed || typeof parsed !== "object") return fallback;

  const campaignName = (typeof parsed.campaignName === "string" && parsed.campaignName.trim())
    ? parsed.campaignName.trim()
    : fallback.campaignName;

  const rationale = (typeof parsed.rationale === "string" && parsed.rationale.trim())
    ? parsed.rationale.trim()
    : fallback.rationale;

  const agentPrompt = (typeof parsed.agentPrompt === "string" && parsed.agentPrompt.trim())
    ? parsed.agentPrompt.trim()
    : fallback.agentPrompt;

  let rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
  if (rawSteps.length === 0 && Array.isArray(parsed.passos)) {
    rawSteps = parsed.passos;
  }

  if (rawSteps.length < 3) {
    // Se a IA devolveu menos de 3 passos, complementa com os do fallback
    const mergedSteps = [...rawSteps];
    for (let i = rawSteps.length; i < 3; i++) {
      mergedSteps.push(fallback.steps[i]);
    }
    rawSteps = mergedSteps;
  }

  // Normaliza os 3 passos exatamente como especificado no contrato
  const steps = [
    {
      order: 1,
      type: "text",
      triggerMode: "immediate",
      text: String(rawSteps[0]?.text || rawSteps[0]?.mensagem || fallback.steps[0].text).trim(),
    },
    {
      order: 2,
      type: "text",
      triggerMode: "after_reply",
      text: String(rawSteps[1]?.text || rawSteps[1]?.mensagem || fallback.steps[1].text).trim(),
      buttons: Array.isArray(rawSteps[1]?.buttons) && rawSteps[1].buttons.length > 0
        ? rawSteps[1].buttons.map((b) => ({
            type: "reply",
            displayText: String(b?.displayText || b?.text || "Sim, quero saber mais").slice(0, 30),
            replyText: String(b?.replyText || b?.displayText || b?.text || "Sim, quero saber mais").slice(0, 30),
          }))
        : fallback.steps[1].buttons,
    },
    {
      order: 3,
      type: "link",
      triggerMode: "after_reply",
      linkUrl: String(rawSteps[2]?.linkUrl || rawSteps[2]?.link || "https://{{scheduling_link}}").trim(),
      text: String(rawSteps[2]?.text || rawSteps[2]?.mensagem || fallback.steps[2].text).trim(),
    },
  ];

  return {
    campaignName,
    rationale,
    steps,
    agentPrompt,
  };
}

/**
 * Criação mágica de campanhas em 1-clique via LLM com contingência heurística imediata.
 */
export async function generateMagicCampaign({
  prompt = "",
  niche = "geral",
  tone = "consultivo",
  clientId = "",
} = {}) {
  const fallback = getFallbackMagicCampaign({ prompt, niche, tone });

  const effectiveNiche = (niche && niche !== "geral") ? niche : "geral (deduzir do texto do prompt)";
  const effectiveTone = tone || "consultivo";

  const systemPrompt = `Você é o Vexo Magic Creator, o copiloto especialista em copywriting de altíssima conversão para WhatsApp no Brasil.
Sua missão é criar campanhas completas, humanizadas, envolventes e sem parecer spam comercial.

Você DEVE responder ESTRITAMENTE em formato JSON puro, sem markdown, sem blocos de código com crases e sem texto introdutório ou conclusivo.
O JSON deve seguir rigorosamente a seguinte estrutura:
{
  "campaignName": "Nome Comercial Chamativo e Profissional",
  "rationale": "Breve explicação da estratégia de conversão adotada",
  "steps": [
    {
      "order": 1,
      "type": "text",
      "triggerMode": "immediate",
      "text": "Mensagem inicial curta gerando curiosidade legítima, usando {{primeiro_nome}}"
    },
    {
      "order": 2,
      "type": "text",
      "triggerMode": "after_reply",
      "text": "Mensagem apresentando a oferta/benefício de forma irresistível",
      "buttons": [
        { "type": "reply", "displayText": "1 - Quero aproveitar", "replyText": "1 - Quero aproveitar" },
        { "type": "reply", "displayText": "2 - Agora não", "replyText": "2 - Agora não" }
      ]
    },
    {
      "order": 3,
      "type": "link",
      "triggerMode": "after_reply",
      "linkUrl": "https://{{scheduling_link}}",
      "text": "👉 Texto curto direcionando para o link oficial"
    }
  ],
  "agentPrompt": "Instruções específicas para o Agente IA responder dúvidas sobre esta campanha específica..."
}

Diretrizes Críticas de Copywriting para WhatsApp Brasil:
- Passo 1: Saudação calorosa, pergunta rápida e curiosidade genuína. Nunca apresente a venda logo de cara.
- Passo 2: Disparo após a primeira resposta do lead (triggerMode: 'after_reply'). Apresenta o benefício principal de forma leve e persuasiva, com 2 botões de resposta rápida ('Quero aproveitar' / 'Agora não').
- Passo 3: Envio de link oficial (type: 'link', triggerMode: 'after_reply') com linkUrl: 'https://{{scheduling_link}}' para fechar o agendamento/garantir a condição exclusiva.
- Agent Prompt: Dê orientações práticas para a IA atender quem responder com dúvidas sobre preço, horários, localização e detalhes da oferta.`;

  const userPrompt = `Crie uma campanha completa de alta conversão:
- Segmento/Nicho: ${effectiveNiche}
- Tom de Voz: ${effectiveTone}
- Descrição da Campanha: ${prompt || "Campanha promocional e de engajamento para a base de clientes"}
${clientId ? `- Identificador do Tenant: ${clientId}` : ""}`;

  try {
    const rawContent = await callLlmChatCompletion({
      temperature: 0.4,
      max_tokens: 1500,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    console.log("[magic-campaign-creator] Resposta crua da IA:", rawContent);
    const parsed = extractJsonFromLlmText(rawContent);
    return sanitizeMagicCampaignOutput(parsed, fallback);
  } catch (error) {
    console.warn("[magic-campaign-creator] Falha ao consultar LLM, utilizando fallback de contingência:", error?.message || error);
    return fallback;
  }
}
