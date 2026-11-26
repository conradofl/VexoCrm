// Qual campanha está esperando a resposta deste lead (e tem próximo passo a enviar). Extraída do webhook de entrada
// (domains/chatbot/routes.js, ETAPA 4) em 26/11/2026, SEM mudar a regra, para a retomada das respostas barradas
// (campaign/retomadaBarradas.js) escolher exatamente a mesma campanha que o webhook escolheria.
import { getCampaignStepPlan } from "../campaign-outbound.js";
import { normalizeCampaignPendingStepIndex } from "./dispatch.js";

/** @param campaignReplyContext retorno de findCampaignReplyMatches({ clientId, phone }) */
export function pickCampaignAwaitingReply(campaignReplyContext) {
  const allCandidates = [
    ...(campaignReplyContext.processingWaitForReplyMatches || []),
    ...(campaignReplyContext.waitForReplyMatches || []),
    ...(campaignReplyContext.matches || []),
    ...(campaignReplyContext.activePeriodCampaign ? [campaignReplyContext.activePeriodCampaign] : []),
  ];

  // Prioriza a campanha que efetivamente possui progresso pendente e passos a enviar (não pausada nem superada por campanha já concluída)
  return allCandidates.find((c) => {
    if (!c || c.status === "pausada" || c.supersededByCompletedCampaign) return false;
    const progress = c.leadImportItem?.progress || {};
    const hasProgress = progress && Object.keys(progress).length > 0;
    if (!hasProgress) return false;
    if (progress.status === "finalizado" || progress.status === "erro" || Boolean(progress.completedAt)) return false;
    const nextStepIndex = normalizeCampaignPendingStepIndex(progress.nextStepIndex);
    if (nextStepIndex === null) return false;
    const stepPlan = getCampaignStepPlan(c.analyticsMeta || {});
    const steps = stepPlan.enabledSteps || [];
    return nextStepIndex < steps.length;
  }) || (
    campaignReplyContext.processingWaitForReplyMatches?.[0]?.status !== "pausada" &&
    !campaignReplyContext.processingWaitForReplyMatches?.[0]?.supersededByCompletedCampaign
      ? campaignReplyContext.processingWaitForReplyMatches?.[0]
      : null
  ) || null;
}
