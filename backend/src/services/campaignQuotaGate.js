// Cota diária de chip no disparo de campanha.
//
// O follow-up já reservava cota por MENSAGEM (followup/worker.js); o disparo de campanha não reservava nada: o
// rodízio (chipProvider) que faria isso nunca foi ligado ao laço de envio. Este portão aplica a MESMA cota, na
// MESMA unidade (1 mensagem = 1 unidade) e na MESMA tabela, no chip que de fato envia — a instância dona do webhook
// resolvido para o disparo. Não troca de chip, não muda variação de texto: só reserva antes de enviar.
//
// Chip não identificado (o webhook não pertence a uma instância cadastrada) NÃO recebe cota inventada: o envio segue,
// e o fato é registrado (log + contagem em `unidentifiedMessages`; o envio também fica com evolution_instance_id NULL
// em campaign_dispatch_runs, que o dashboard mostra como "sem chip registrado").
//
// Fora de escopo de propósito (04/10/2026): resposta do chatbot, mensagem manual do inbox e envio do módulo GD
// continuam sem reservar cota. O número da cota, portanto, NÃO é o total de mensagens que o chip manda.

import { getDateKey } from "./analytics.js";
import { releaseChipDailyQuota, reserveChipDailyQuota, resolveChipDailyLimit } from "./chipQuota.js";
import { normalizeString } from "../textNormalize.js";

// O agendador (routes.js, runDueIndependentDispatches) reconhece o lote pausado por cota por este trecho.
export const QUOTA_PAUSE_MARKER = "cota diária do chip atingida";

export function buildQuotaExhaustedMessage(limit) {
  return `Pausado — ${QUOTA_PAUSE_MARKER} (${limit}/${limit}). Retoma amanhã.`;
}

/**
 * A instância cadastrada cujo webhook de envio é EXATAMENTE `webhookUrl` (igualdade de texto, sem aproximação).
 * Usado nos disparos que só têm a URL (envio manual e direto). Sem correspondência exata → null (não identificado).
 */
export function findInstanceByWebhookUrl(instances, webhookUrl) {
  const alvo = normalizeString(webhookUrl);
  if (!alvo || !Array.isArray(instances)) return null;
  return instances.find((inst) => normalizeString(inst?.dispatch_webhook_url) === alvo) || null;
}

/**
 * @param chip      linha de lead_client_evolution_instances do chip que envia (id, name, chip_state, daily_limit_override),
 *                  ou null quando o chip não é identificado.
 * @param timezone  fuso do tenant (dia da cota = dia do tenant, como no follow-up)
 */
export function createChipQuotaGate({ chip = null, timezone = "America/Sao_Paulo", pool = null, clock = () => new Date(), logger = console } = {}) {
  let unidentifiedMessages = 0;
  let warned = false;

  return {
    get unidentifiedMessages() {
      return unidentifiedMessages;
    },

    /**
     * Reserva `count` mensagens ANTES de enviar. Devolve:
     *  - { status: "reserved", release(n) }  → pode enviar; release(n) devolve as n não enviadas
     *  - { status: "exhausted", ... }        → não cabe no dia: não envia, o lote pausa
     *  - { status: "unidentified" }          → chip desconhecido: segue sem cota, registrado
     */
    async reserve(count) {
      const n = Number.isInteger(count) && count > 0 ? count : 1;

      if (!chip?.id) {
        unidentifiedMessages += n;
        if (!warned) {
          warned = true;
          logger.warn("[campaign-quota] envio sem chip identificado: o webhook não é de uma instância cadastrada, então não há cota a debitar. O envio segue.");
        }
        return { status: "unidentified" };
      }

      const limit = resolveChipDailyLimit(chip);
      const dateKey = getDateKey(clock(), timezone);
      const reserved = await reserveChipDailyQuota(chip.id, dateKey, pool, n);
      if (reserved === null) {
        // contador indisponível: como no follow-up, não envia às cegas
        throw new Error(`[campaign-quota] falha ao reservar cota para a instância ${chip.id}`);
      }

      if (reserved > limit) {
        await releaseChipDailyQuota(chip.id, dateKey, pool, n);
        return {
          status: "exhausted",
          chipName: chip.name || String(chip.id),
          limitQuota: limit,
          usedQuota: Math.min(Math.max(reserved - n, 0), limit),
          message: buildQuotaExhaustedMessage(limit),
        };
      }

      return {
        status: "reserved",
        usedQuota: reserved,
        limitQuota: limit,
        release: (unused) => releaseChipDailyQuota(chip.id, dateKey, pool, unused),
      };
    },
  };
}
