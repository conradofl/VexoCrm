// "Nova conversa" da aba Conversas: a empresa escreve primeiro para um número.
//
// Usa a MESMA rota e o mesmo registro da resposta manual (POST /api/whatsapp/messages, sender_type
// 'agent'). O que muda é só o que vem antes do envio:
//   - o telefone tem que ser um número brasileiro válido, e é gravado na forma canônica;
//   - se já existe conversa com esse número, nada é enviado: a tela só abre a conversa;
//   - quem pediu para não receber mensagem (opt-out) não recebe;
//   - o chip é o que a pessoa escolheu, e tem que estar conectado. Não há troca de chip aqui:
//     chip desconectado é erro na janela.
import { toCanonicalPhone } from "./canonicalPhone.js";
import { chipEvolutionName, isChipConnectedByRecord, matchChip, probeChipConnection } from "./inboxReplyChip.js";

// Celular: 55 + DDD + 9 + 8 dígitos. Fixo: 55 + DDD + [2-5] + 7 dígitos.
const VALID_CANONICAL = /^55[1-9]{2}(9\d{8}|[2-5]\d{7})$/;

/** Telefone digitado → forma canônica, ou null quando não é um número brasileiro com DDD. */
export function parseNewConversationPhone(raw) {
  const text = String(raw ?? "").trim();
  if (!text || /[a-z@]/i.test(text)) return null;
  const canonical = toCanonicalPhone(text);
  return VALID_CANONICAL.test(canonical) ? canonical : null;
}

export async function conversationExists(query, { clientId, phoneVariants }) {
  const { rows } = await query(
    `SELECT 1 FROM public.lead_messages WHERE client_id = $1 AND phone = ANY($2) LIMIT 1`,
    [clientId, phoneVariants]
  );
  return rows.length > 0;
}

/**
 * Chip da nova conversa: o escolhido na janela (ou o padrão da empresa, quando nenhum foi escolhido).
 *   { ok: true, instance }
 *   { ok: false, code: "NO_ACTIVE_WHATSAPP_CHIP" | "CHIP_NOT_FOUND" | "CHIP_NOT_CONNECTED", message }
 */
export async function resolveNewConversationChip({ instances, chipId = null, probe = probeChipConnection }) {
  const active = (instances || []).filter((inst) => inst.active !== false);
  if (!active.length) {
    return { ok: false, code: "NO_ACTIVE_WHATSAPP_CHIP", message: "Não há nenhum chip WhatsApp ativo configurado para esta empresa." };
  }
  const chosen = chipId ? matchChip(active, chipId) : active.find((inst) => inst.is_default === true) || active[0];
  if (!chosen) {
    return { ok: false, code: "CHIP_NOT_FOUND", message: "O chip escolhido não está ativo nesta empresa. Escolha outro chip." };
  }
  let connected = isChipConnectedByRecord(chosen);
  const live = await probe(chosen);
  if (live !== null) connected = live;
  if (!connected) {
    const name = chosen.name || chipEvolutionName(chosen);
    return { ok: false, code: "CHIP_NOT_CONNECTED", message: `O chip ${name} está desconectado. Escolha outro chip ou reconecte este em Integrações.` };
  }
  return { ok: true, instance: chosen };
}
