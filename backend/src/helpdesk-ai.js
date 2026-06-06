const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_HELPDESK_MODEL = "openai/gpt-oss-20b";

const SYSTEM_CONTEXT = `
Voce e o help desk do Vexo OS, um CRM operacional com modulos de:
- Dashboard: leitura de indicadores, leads, qualificacao e receita por empresa.
- Empresas: cadastro de tenants/clientes, schema de chatbot e configuracoes Evolution API.
- Usuarios e Acessos: aprovacao de usuarios, permissoes, escopo por empresa e sincronizacao Firebase Auth.
- Leads e Planilhas: importacao de bases, segmentacao, campanhas, envios e acompanhamento.
- WhatsApp: caixa de entrada e integracao com Evolution API.
- Chatbot: configuracao de prompts, templates e agente SPIN por empresa.
- Follow-up: fila, campanhas, sugestoes IA, templates e analytics.
- Onboarding: criacao guiada de clientes e campanhas iniciais.
- Vendas Vexo: gestao interna de oportunidades.

Responda sempre em portugues do Brasil, com passos curtos e acionaveis.
Nao invente dados internos, credenciais, URLs privadas ou permissoes que o usuario nao informou.
Se a pergunta depender de permissao ou configuracao, diga onde verificar no sistema.
Se nao souber, explique a limitacao e sugira o proximo passo operacional.
`;

function getHelpDeskModel() {
  return process.env.GROQ_HELPDESK_MODEL || process.env.GROQ_CAMPAIGN_AI_MODEL || DEFAULT_HELPDESK_MODEL;
}

function normalizeMessage(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim().slice(0, 4000);
}

function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .slice(-8)
    .map((item) => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: normalizeMessage(item?.content),
    }))
    .filter((item) => item.content);
}

export function getHelpDeskAiStatus() {
  return {
    enabled: Boolean(process.env.GROQ_API_KEY),
    provider: "groq",
    model: getHelpDeskModel(),
  };
}

export async function answerHelpDeskQuestion({ message, history = [], context = {} }) {
  const userMessage = normalizeMessage(message);
  if (!userMessage) {
    throw new Error("EMPTY_HELPDESK_MESSAGE");
  }

  if (!process.env.GROQ_API_KEY) {
    throw new Error("GROQ_DISABLED");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await fetch(GROQ_BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: getHelpDeskModel(),
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: SYSTEM_CONTEXT,
          },
          {
            role: "system",
            content: `Contexto da sessao: ${JSON.stringify(context).slice(0, 2500)}`,
          },
          ...normalizeHistory(history),
          {
            role: "user",
            content: userMessage,
          },
        ],
      }),
      signal: controller.signal,
    });

    const rawBody = await response.text();
    if (!response.ok) {
      throw new Error(rawBody || `Groq HTTP ${response.status}`);
    }

    const payload = JSON.parse(rawBody);
    const answer = normalizeMessage(payload?.choices?.[0]?.message?.content);
    if (!answer) {
      throw new Error("EMPTY_HELPDESK_RESPONSE");
    }

    return {
      answer,
      provider: "groq",
      model: getHelpDeskModel(),
    };
  } finally {
    clearTimeout(timeout);
  }
}
