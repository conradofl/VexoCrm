// Captura do pedido de saída na mensagem do lead.
//
// Regras decididas pelo dono em 12/11/2026, depois de medir 90 dias de mensagens em produção:
//   1. PALAVRA SOZINHA (a mensagem inteira é uma destas): sair, parar, pare, stop, cancelar, descadastrar.
//      Grava com origem "palavra".
//   2. "não tenho interesse" / "sem interesse" em mensagem CURTA (até 60 caracteres). Grava com origem "sem_interesse".
//      Foi o único tipo de pedido real que apareceu na medição ("Muito obrigado não tenho interesse").
//   3. Frase larga (bloquear, não mande, tirar da lista, parar de...) NÃO captura: na medição, quase tudo que casava com
//      elas era falso positivo ("Tudo ajuda a não bloquear", "não mandei pra agenda").
//   4. Número da lista SDR da empresa nunca é capturado.
//   5. Sem mensagem de confirmação para quem pediu. Desfaz-se com um clique no interruptor do dossiê (revoga, não apaga).
//
// A captura só GRAVA (services/optOut.js). Quem para de enviar são as portas, que leem a fonte única.

import { toCanonicalPhone } from "./canonicalPhone.js";
import { resolveTenantSdrNumbers } from "./sdrTarget.js";
import { registerOptOut, OPTOUT_SOURCE_PALAVRA, OPTOUT_SOURCE_SEM_INTERESSE } from "./optOut.js";

export const OPTOUT_PALAVRAS = ["sair", "parar", "pare", "stop", "cancelar", "descadastrar"];
export const OPTOUT_FRASES_SEM_INTERESSE = ["nao tenho interesse", "sem interesse"];
export const OPTOUT_SEM_INTERESSE_MAX_CHARS = 60;

// minúsculas, sem acento, espaços colapsados
function normalizar(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A mensagem é um pedido de saída? Devolve { source, reason } ou null.
 * Função pura: não olha banco, empresa nem telefone.
 */
export function detectOptOutRequest(text) {
  const bruto = String(text ?? "").trim();
  if (!bruto) return null;
  const normal = normalizar(bruto);

  // 1. Palavra sozinha: tira pontuação, símbolo e emoji das pontas; o que sobra tem de SER a palavra.
  const miolo = normal.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  if (OPTOUT_PALAVRAS.includes(miolo)) {
    return { source: OPTOUT_SOURCE_PALAVRA, reason: miolo };
  }

  // 2. Sem interesse, só em mensagem curta. O limite conta os caracteres da mensagem como o lead escreveu.
  if ([...bruto].length <= OPTOUT_SEM_INTERESSE_MAX_CHARS) {
    const frase = OPTOUT_FRASES_SEM_INTERESSE.find((f) => new RegExp(`(^|[^a-z0-9])${f}([^a-z0-9]|$)`).test(normal));
    if (frase) return { source: OPTOUT_SOURCE_SEM_INTERESSE, reason: frase };
  }

  return null;
}

/**
 * O telefone é um número SDR da empresa? Compara em telefone canônico (a lista pode estar com ou sem 55 e 9).
 */
export function isSdrPhone(tenantSettings, phone) {
  const alvo = toCanonicalPhone(phone);
  if (!alvo) return false;
  return resolveTenantSdrNumbers(tenantSettings).some((n) => toCanonicalPhone(n) === alvo);
}

/**
 * Avalia uma mensagem de ENTRADA do lead e, se for pedido de saída, grava na fonte única.
 *
 * Nunca lança: a captura não pode derrubar o webhook de entrada. Devolve { captured, source?, skipped? }.
 * - getTenantSettings: função que lê as configurações da empresa (só é chamada quando a mensagem casou). Se a leitura
 *   falhar, NÃO captura: sem a lista SDR não dá para garantir a regra 4.
 */
export async function captureOptOutFromInbound(pool, { clientId, phone, text, waMessageId = null, getTenantSettings }) {
  try {
    if (!pool || !clientId || !phone) return { captured: false, skipped: "missing_context" };
    const pedido = detectOptOutRequest(text);
    if (!pedido) return { captured: false };

    let tenantSettings;
    try {
      tenantSettings = await getTenantSettings(clientId);
    } catch (err) {
      console.error("[opt-out] pedido de saída NÃO capturado: falha ao ler a lista SDR da empresa:", err?.message || err);
      return { captured: false, skipped: "settings_unavailable" };
    }
    if (isSdrPhone(tenantSettings, phone)) return { captured: false, skipped: "sdr_number" };

    const result = await registerOptOut(pool, {
      clientId,
      phone,
      source: pedido.source,
      reason: pedido.reason,
      waMessageId,
      messageText: text,
    });
    if (result.registered) {
      console.info("[opt-out] pedido de saída capturado na mensagem do lead", { clientId, origem: pedido.source, motivo: pedido.reason });
    }
    return { captured: true, source: pedido.source, alreadyActive: result.alreadyActive === true };
  } catch (err) {
    console.error("[opt-out] falha ao capturar pedido de saída (a mensagem segue o fluxo normal):", err?.code || "", err?.message || err);
    return { captured: false, skipped: "error" };
  }
}
