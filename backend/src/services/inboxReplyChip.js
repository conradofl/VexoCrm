// Por qual chip sai a resposta manual da aba Conversas.
//
// Regra: a resposta sai pelo chip em que o lead escreveu, quando esse chip está conectado.
// Se não está (desconectado, desativado ou apagado do cadastro), NADA é enviado: a rota devolve
// 409 e a tela pede confirmação explícita para enviar por outro chip. O servidor nunca troca de
// chip em silêncio. Conversa sem chip gravado (mensagem antiga, sem instance_name) não tem chip a
// respeitar e segue pelo chip padrão da empresa, como sempre foi.
import { extractEvolutionInstanceSlug, getEvolutionAdminConfig } from "./evolution.js";

const OPEN_STATES = new Set(["open", "connected", "online"]);
const CLOSED_STATES = new Set(["close", "closed", "connecting", "disconnected", "refused", "logout"]);
const PROBE_TIMEOUT_MS = 2500;

export const REPLY_CHIP_UNAVAILABLE = "REPLY_CHIP_UNAVAILABLE";

/** Nome do chip na Evolution: último trecho da URL de disparo. É o que fica em lead_messages.instance_name. */
export function chipEvolutionName(instance) {
  if (!instance) return null;
  return extractEvolutionInstanceSlug(instance.dispatch_webhook_url) || instance.name || null;
}

export function matchChip(instances, identifier) {
  const wanted = identifier != null ? String(identifier).trim() : "";
  if (!wanted) return null;
  return (
    (instances || []).find(
      (inst) => inst.id === wanted || inst.name === wanted || extractEvolutionInstanceSlug(inst.dispatch_webhook_url) === wanted
    ) || null
  );
}

/** Estado gravado no cadastro. Sem estado gravado ("unknown") o chip ativo conta como conectado. */
export function isChipConnectedByRecord(instance) {
  if (!instance || instance.active === false) return false;
  return !CLOSED_STATES.has(String(instance.connection_state || "").toLowerCase());
}

/**
 * Pergunta à Evolution se o chip está conectado agora. Devolve true, false ou null (não deu para saber:
 * sem configuração, erro de rede, tempo esgotado). null faz a decisão cair no estado gravado.
 */
export async function probeChipConnection(instance, { fetchImpl = globalThis.fetch, config = getEvolutionAdminConfig() } = {}) {
  const name = chipEvolutionName(instance);
  // O chip pode estar em outro servidor da Evolution: usa o endereço e a chave do próprio chip quando existem.
  let baseUrl = config?.baseUrl || null;
  try {
    if (instance?.dispatch_webhook_url) baseUrl = new URL(instance.dispatch_webhook_url).origin;
  } catch {
    // endereço inválido: fica o da configuração
  }
  const apiKey = instance?.dispatch_webhook_token || config?.apiKey || null;
  if (!name || !baseUrl || !apiKey || typeof fetchImpl !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${baseUrl}/instance/connectionState/${encodeURIComponent(name)}`, {
      method: "GET",
      headers: { apikey: apiKey },
      signal: controller.signal,
    });
    if (!response?.ok) return response?.status === 404 ? false : null;
    const data = await response.json();
    const state = String(data?.instance?.state || data?.state || data?.status || "").toLowerCase();
    if (OPEN_STATES.has(state)) return true;
    if (CLOSED_STATES.has(state)) return false;
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Chip da conversa: o da última mensagem que o lead mandou. Conversa em que só a empresa escreveu
 * (campanha sem resposta) usa o chip da última mensagem enviada.
 */
export async function findConversationChip(query, { clientId, phoneVariants }) {
  const { rows } = await query(
    `SELECT instance_name
       FROM public.lead_messages
      WHERE client_id = $1 AND phone = ANY($2)
        AND NULLIF(btrim(instance_name), '') IS NOT NULL
      ORDER BY (direction = 'inbound') DESC,
               COALESCE(message_timestamp, delivered_at, created_at) DESC NULLS LAST, id DESC
      LIMIT 1`,
    [clientId, phoneVariants]
  );
  return rows[0]?.instance_name || null;
}

const publicChip = (instance) =>
  instance ? { id: instance.id, name: instance.name || chipEvolutionName(instance), isDefault: instance.is_default === true } : null;

/**
 * Decide o chip da resposta.
 *   { ok: true, instance, conversationChip, reason }      reason: conversation_chip | confirmed_other | no_conversation_chip
 *   { ok: false, code, conversationChip, reason, alternatives }   reason: disconnected | not_registered | invalid_confirmation | no_active_chip
 */
export async function resolveReplyChip({ instances, conversationChip, confirmChipId = null, probe = probeChipConnection }) {
  const active = (instances || []).filter((inst) => inst.active !== false);
  const fallback = active.find((inst) => inst.is_default === true) || active[0] || null;
  if (!fallback) return { ok: false, code: "NO_ACTIVE_WHATSAPP_CHIP", reason: "no_active_chip", conversationChip, alternatives: [] };

  const chipOfConversation = conversationChip ? matchChip(instances, conversationChip) : null;

  // Confirmação explícita vinda da tela: só vale para chip ativo desta empresa.
  if (confirmChipId) {
    const confirmed = matchChip(active, confirmChipId);
    if (!confirmed) {
      return { ok: false, code: REPLY_CHIP_UNAVAILABLE, reason: "invalid_confirmation", conversationChip, alternatives: active.map(publicChip) };
    }
    const sameAsConversation = chipOfConversation && confirmed.id === chipOfConversation.id;
    return { ok: true, instance: confirmed, conversationChip, reason: sameAsConversation ? "conversation_chip" : "confirmed_other" };
  }

  if (!conversationChip) return { ok: true, instance: fallback, conversationChip: null, reason: "no_conversation_chip" };

  const alternatives = active.filter((inst) => inst.id !== chipOfConversation?.id && isChipConnectedByRecord(inst)).map(publicChip);

  if (!chipOfConversation) {
    return { ok: false, code: REPLY_CHIP_UNAVAILABLE, reason: "not_registered", conversationChip, alternatives };
  }

  let connected = isChipConnectedByRecord(chipOfConversation);
  if (chipOfConversation.active !== false) {
    const live = await probe(chipOfConversation);
    if (live !== null) connected = live;
  }
  if (!connected) {
    return {
      ok: false,
      code: REPLY_CHIP_UNAVAILABLE,
      reason: "disconnected",
      conversationChip,
      conversationChipName: chipOfConversation.name || conversationChip,
      alternatives,
    };
  }
  return { ok: true, instance: chipOfConversation, conversationChip, reason: "conversation_chip" };
}

export function replyChipUnavailableMessage(decision) {
  const name = decision?.conversationChipName || decision?.conversationChip || "da conversa";
  if (decision?.reason === "not_registered") {
    return `O chip ${name}, em que o lead escreveu, não está mais cadastrado. Confirme por qual chip enviar.`;
  }
  if (decision?.reason === "invalid_confirmation") {
    return "O chip escolhido não está ativo nesta empresa. Escolha outro chip.";
  }
  return `O chip ${name}, em que o lead escreveu, está desconectado. Confirme por qual chip enviar.`;
}
