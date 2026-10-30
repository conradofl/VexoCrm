// Freios da fila de leads (startNextCampaignLeadInQueue): janela de envio e abertura do dia seguinte para a cota.
// A REGRA da janela é uma só (services/sendWindow.js); aqui só se pergunta "agora está aberta?" e "quando abre?".
// A cota é a do chip (services/campaignQuotaGate.js), a mesma do lote: nada novo.

import { getLeadClientN8nSettings } from "../services/n8nSettings.js";
import {
  resolveSendWindowConfig,
  isWithinSendWindow,
  getNextSendWindowOpening,
  getPartsInTimezone,
  createDateInTimezone,
} from "../services/sendWindow.js";

/**
 * @returns {Promise<{ open: true, config: object } | { open: false, config: object, retryAfter: Date }>}
 * Configuração ilegível: usa o padrão (08:00–20:00, seg–sex): errar para o lado de NÃO enviar de madrugada.
 */
export async function evaluateQueueSendWindow(clientId, now = new Date()) {
  let settings = null;
  try {
    settings = await getLeadClientN8nSettings(clientId);
  } catch (err) {
    console.warn("[campaign-queue] não foi possível ler a janela de envio do tenant; usando o padrão:", err?.message || err);
  }
  const config = resolveSendWindowConfig(settings || {});
  if (isWithinSendWindow(now, config)) return { open: true, config };
  return { open: false, config, retryAfter: getNextSendWindowOpening(now, config) };
}

/** Cota esgotada hoje: volta na primeira abertura de janela a partir da meia-noite seguinte (mesma conta do follow-up). */
export function nextDayWindowOpening(now, config) {
  const parts = getPartsInTimezone(now, config.timezone);
  const amanha = createDateInTimezone(parts.year, parts.month, parts.day + 1, 0, 1, 0, config.timezone);
  return getNextSendWindowOpening(amanha, config);
}
