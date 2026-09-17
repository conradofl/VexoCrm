// Qual cerebro atende o lead que respondeu: o da CAMPANHA ou o de ATENDIMENTO.
//
// Defeito real: lead que respondeu a um disparo era atendido pelo agente de
// atendimento, com o roteiro de quem procurou a empresa. O ramo "disparo" usava
// o prompt padrao e o roteiro da campanha era inalcancavel — `mode` existia no
// tipo, o backend aceitava, o roteamento consumia, e nenhuma tela escrevia.
//
// O gatilho e o ROTEIRO EXISTIR, nao o `mode`. Campanha antiga tem
// campaign_prompt_id nulo e continua exatamente como antes.
//
// Segundo defeito, achado na leva "Um agente por chip" (Commit 3): quando a
// campanha estava configurada como replyAgent "atendimento", o roteiro era
// DESCARTADO por completo (campaignPromptId: null), mesmo tendo roteiro
// salvo. "Atendimento" decide QUEM FALA (o agente do chip, no tom dele) —
// nao decide se o roteiro da campanha entra ou nao. Regra final: "o roteiro
// da campanha manda no conteudo, o agente do chip manda no tom" vale nos dois
// modos (campanha e atendimento); so muda QUEM assina o tom da conversa.
// chatbot-ai-engine.js ja sabia compor os dois (camada da campanha sobre o
// prompt base) — o bug era este arquivo nunca entregar o roteiro pra ele.

export const AGENTE_CAMPANHA = "campanha";
export const AGENTE_ATENDIMENTO = "atendimento";
export const AGENTE_NENHUM = "nenhum";

export function resolveCampaignAgent(activeCampaign) {
  if (!activeCampaign) {
    return {
      agente: AGENTE_ATENDIMENTO,
      campaignPromptId: null,
      porque: "nenhuma campanha ativa para este telefone",
    };
  }

  // 1. Configuração explícita de replyAgent (salvo em analytics_meta.dispatchOptions.replyAgent)
  const meta = activeCampaign.analytics_meta || activeCampaign.analyticsMeta || {};
  const dispatchOpts = meta.dispatchOptions || activeCampaign.dispatchOptions || {};
  const explicitReplyAgent = dispatchOpts.replyAgent || activeCampaign.replyAgent || null;

  if (explicitReplyAgent === "passos") {
    return {
      agente: AGENTE_NENHUM,
      bloqueado: true,
      campaignPromptId: null,
      porque: "campanha configurada como Sem IA (apenas passos)",
    };
  }

  const roteiro = activeCampaign.campaignPromptId || activeCampaign.campaign_prompt_id || null;

  if (explicitReplyAgent === "campanha") {
    return {
      agente: AGENTE_CAMPANHA,
      campaignPromptId: roteiro,
      porque: roteiro ? "campanha ativa com roteiro próprio" : "campanha configurada para agente próprio sem roteiro salvo",
      configuracaoIncompleta: !roteiro,
    };
  }

  if (explicitReplyAgent === "atendimento") {
    // O agente de ATENDIMENTO fala (tom, modelo, coleta, base de
    // conhecimento) — mas o roteiro da campanha, se existir, ainda entra
    // como camada de conteúdo sobre esse prompt. "Atendimento" decide quem
    // assina o tom, nunca se o roteiro é descartado.
    return {
      agente: AGENTE_ATENDIMENTO,
      campaignPromptId: roteiro,
      porque: roteiro
        ? "campanha configurada para atendimento padrão, com roteiro da campanha como camada de conteúdo"
        : "campanha configurada para atendimento padrão, sem roteiro salvo",
    };
  }

  // 2. Retrocompatibilidade para campanhas legadas sem replyAgent explícito
  if (roteiro) {
    return {
      agente: AGENTE_CAMPANHA,
      campaignPromptId: roteiro,
      porque: "campanha legada ativa com roteiro proprio",
    };
  }

  return {
    agente: AGENTE_ATENDIMENTO,
    campaignPromptId: null,
    porque: "campanha legada ativa sem roteiro proprio",
    configuracaoIncompleta: activeCampaign.mode === "agente",
  };
}

