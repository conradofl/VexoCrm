// Público do lote (PR 9a do untangle, 25/11/2026): os parâmetros que o MOTOR usa para montar a fila
// (campaign/dispatchEngine.js), num lugar só, para as telas mostrarem o mesmo público que sai.
//
// Antes: prévia e destinatários filtravam pela segmentação do 1º passo (dispatch.steps[0].segmentation) com
// limit_per_run cru; "executar pendentes" contava sem segmentação nenhuma. O motor usa a segmentação da campanha
// (validateCampaignAnalyticsMeta sobre o meta normalizado + passos do lote) e resolveDispatchLeadLimit. Quem
// RECEBE continua sendo decidido só pelo motor; isto muda o número que a tela mostra, para bater com o envio.
import { normalizeCampaignAnalyticsMeta, validateCampaignAnalyticsMeta } from "../campaign-outbound.js";
import { resolveCampaignImportSelection, resolveDispatchLeadLimit } from "./dispatch.js";

/** Segmentação que o motor aplica ao lote (mesma expressão de dispatchEngine.js). */
export function dispatchAudienceSegmentation(campaign, dispatch) {
  const campaignMeta = normalizeCampaignAnalyticsMeta(campaign?.analytics_meta || {});
  const dispatchSteps = Array.isArray(dispatch?.steps) && dispatch.steps.length > 0 ? dispatch.steps : null;
  const steps = dispatchSteps ?? campaignMeta.sequence;
  const validation = validateCampaignAnalyticsMeta({ ...campaignMeta, sequence: steps });
  return validation?.analyticsMeta?.segmentation || null;
}

/**
 * Argumentos de buildDispatchLeads iguais aos do motor. occurrence vem de readOccurrenceInfo (lote de campanha
 * recorrente: público inteiro, sem fatia). excludeDispatchId/excludeCampaignId ficam com quem chama: a lista de
 * destinatários quer ver também quem já recebeu.
 */
export function dispatchAudienceArgs({
  clientId,
  campaign,
  dispatch,
  occurrence = { isOccurrence: false },
  excludeDispatchId = null,
  excludeCampaignId = null,
}) {
  const args = {
    clientId,
    importId: resolveCampaignImportSelection(campaign),
    limit: resolveDispatchLeadLimit(dispatch, { isOccurrence: Boolean(occurrence?.isOccurrence) }),
    offset: occurrence?.isOccurrence ? 0 : dispatch?.offset ?? 0,
    segmentation: dispatchAudienceSegmentation(campaign, dispatch),
    excludeDispatchId,
  };
  if (excludeCampaignId) args.excludeCampaignId = excludeCampaignId;
  return args;
}
