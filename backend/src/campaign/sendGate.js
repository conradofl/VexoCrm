// Portão de envio de campanha (C4 do diagnóstico do untangle; PR 10a, 25/11/2026).
//
// Política declarada: NA DÚVIDA, NÃO ENVIA. Toda porta que manda mensagem de campanha pergunta aqui antes de montar a
// fila. Este PR traz os dois primeiros freios e liga a primeira porta (/api/n8n-dispatches, o "envio manual" que até aqui
// saía sem janela e, com origem vazia, para a base inteira do tenant). As outras portas (fila, resposta, envio direto)
// entram uma por PR; a trava por chip no banco vem com a migration própria.
//
// Freios:
//  1. Origem explícita. Origem vazia, para buildDispatchLeads, é "todas as planilhas" (a armadilha do lote de 504).
//     Só sai quem escolheu: uma planilha, uma lista, "__all__" ou "__crm__" dito de propósito.
//  2. Janela de envio do tenant (services/sendWindow.js). Fora dela recusa com a próxima abertura; só sai quem repete com
//     forceOutsideWindow === true (o booleano, não o texto), e o forçamento vai para o log de quem chama.
import {
  getNextSendWindowOpening,
  getPartsInTimezone,
  isWithinSendWindow,
  resolveSendWindowConfig,
} from "../services/sendWindow.js";

export const SEND_GATE_POLICY = "na_duvida_nao_envia";

export const SEND_WITHOUT_SOURCE_MESSAGE =
  "Escolha a planilha (ou a base) de origem do envio. Sem origem o envio iria para todos os leads da empresa, e por isso não sai.";

// "Disparar Agora" fora da janela de envio do tenant. Até 30/10/2026 a rota do botão passava ignoreSendWindow: true
// sem perguntar (decisão de projeto), e o lote saía depois do horário que a própria tela prometia. Agora o botão
// recusa com 422 e devolve a janela e a próxima abertura; só sai fora dela quem repete a chamada com
// forceOutsideWindow: true, e esse forçamento fica no log. Mesmo texto do agendador (runDueIndependentDispatches).
export function describeSendWindowRefusal(now, sendWindowConfig) {
  const localParts = getPartsInTimezone(now, sendWindowConfig.timezone);
  const nextOpeningDate = getNextSendWindowOpening(now, sendWindowConfig);
  const nextOpeningParts = getPartsInTimezone(nextOpeningDate, sendWindowConfig.timezone);
  const nextOpeningStr = `${nextOpeningParts.timeString} (${nextOpeningParts.day}/${nextOpeningParts.month})`;
  const windowStr = `${sendWindowConfig.start}–${sendWindowConfig.end} [${sendWindowConfig.days.join(",")}] (${sendWindowConfig.timezone})`;
  return {
    message: `Fora da janela de envio: horário local ${localParts.timeString}, janela ${windowStr}, próxima abertura prevista para ${nextOpeningStr}`,
    details: {
      localTime: localParts.timeString,
      start: sendWindowConfig.start,
      end: sendWindowConfig.end,
      days: sendWindowConfig.days,
      timezone: sendWindowConfig.timezone,
      sendWindow: windowStr,
      nextOpening: nextOpeningDate.toISOString(),
      nextOpeningLocal: nextOpeningStr,
    },
  };
}

// Regra única da janela para os botões que disparam na hora ("Disparar Agora" e "Disparar não processados"). Até 16/11/2026
// o run-pending não olhava a janela: respondia "N pendentes em execução", marcava o lote 'running' e o motor pausava no
// primeiro lead (caso Nous, 20:22, janela até 20:00). allowed=false: a rota devolve 422 OUTSIDE_SEND_WINDOW e não toca no
// lote. forced=true só com o booleano true confirmado na tela, e vira ignoreSendWindow no motor.
export function evaluateManualSendWindow({ now = new Date(), settings, forceOutsideWindow }) {
  const sendWindowConfig = resolveSendWindowConfig(settings || {});
  if (isWithinSendWindow(now, sendWindowConfig)) return { allowed: true, forced: false, refusal: null };
  const refusal = describeSendWindowRefusal(now, sendWindowConfig);
  if (forceOutsideWindow !== true) return { allowed: false, forced: false, refusal };
  return { allowed: true, forced: true, refusal };
}

/** Origem escolhida de propósito? String não vazia (inclui "__all__"/"__crm__") ou lista com pelo menos um id. */
export function hasExplicitSendSource(importSelection) {
  if (Array.isArray(importSelection)) return importSelection.some((id) => String(id ?? "").trim() !== "");
  return String(importSelection ?? "").trim() !== "";
}

/**
 * Pergunta única antes de montar a fila de uma porta de envio.
 * @returns {{ allowed: true, forced: boolean, refusal: object|null }
 *         | { allowed: false, status: number, code: string, message: string, details: object|null }}
 */
export function evaluateCampaignSendGate({ now = new Date(), settings, forceOutsideWindow, importSelection }) {
  if (!hasExplicitSendSource(importSelection)) {
    return { allowed: false, status: 422, code: "SEND_WITHOUT_SOURCE", message: SEND_WITHOUT_SOURCE_MESSAGE, details: null };
  }
  const janela = evaluateManualSendWindow({ now, settings, forceOutsideWindow });
  if (!janela.allowed) {
    return { allowed: false, status: 422, code: "OUTSIDE_SEND_WINDOW", message: janela.refusal.message, details: janela.refusal.details };
  }
  return { allowed: true, forced: janela.forced, refusal: janela.refusal };
}
