// Mensagens que o PRÓPRIO sistema mandou pela Evolution (agente, recontato, campanha, follow-up, tela Conversas, avisos).
//
// Serve para uma pergunta só: um "fromMe" que chegou pelo webhook foi digitado por gente no aparelho, ou é o eco de um envio
// nosso? A resposta vem do id da mensagem (key.id) que a Evolution devolve no envio, registrado aqui no instante em que volta.
// NUNCA pelo prefixo do id (3EB0...): o WhatsApp Web e a Evolution usam o mesmo formato, e o prefixo não separa os dois.
//
// Duas fontes, as duas pelo id:
//   1. memória do processo: o id entra assim que a Evolution responde, antes de qualquer gravação no banco (o eco do webhook
//      pode chegar antes de lead_messages gravar o envio);
//   2. lead_messages: linha de saída com aquele wa_message_id gravada por remetente do sistema (bot ou agent).
// Se o id não aparece em nenhuma, confere de novo UMA vez depois de poucos segundos antes de concluir "foi o aparelho".

const TTL_MS = 30 * 60 * 1000;
const MAX_IDS = 20_000;
const enviados = new Map();

let recheckMs = 4000;

function limpar(agora) {
  if (enviados.size < MAX_IDS) return;
  for (const [id, quando] of enviados) {
    if (agora - quando > TTL_MS || enviados.size >= MAX_IDS) enviados.delete(id);
    else break;
  }
}

export function registerSystemSentMessageId(id, agora = Date.now()) {
  const chave = typeof id === "string" ? id.trim() : "";
  if (!chave) return;
  limpar(agora);
  enviados.set(chave, agora);
}

/** Id da mensagem na resposta da Evolution (objeto já lido ou texto JSON). */
export function extractEvolutionMessageId(resposta) {
  let dados = resposta;
  if (typeof resposta === "string") {
    try {
      dados = JSON.parse(resposta);
    } catch {
      return null;
    }
  }
  if (!dados || typeof dados !== "object") return null;
  const id = dados?.key?.id || dados?.data?.key?.id || dados?.message?.key?.id || dados?.messageId || null;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

/** Registra o id contido na resposta da Evolution. Devolve o id, ou null se a resposta não trouxe id. */
export function registerSystemSentFromResponse(resposta) {
  const id = extractEvolutionMessageId(resposta);
  if (id) registerSystemSentMessageId(id);
  return id;
}

function estaNaMemoria(id, agora = Date.now()) {
  const quando = enviados.get(id);
  return quando !== undefined && agora - quando <= TTL_MS;
}

async function estaGravadoComoEnvioDoSistema(pool, { clientId, waMessageId }) {
  if (!pool) return false;
  const { rows } = await pool.query(
    `SELECT 1 FROM public.lead_messages
      WHERE client_id = $1 AND wa_message_id = $2 AND direction = 'outbound' AND sender_type IN ('bot', 'agent')
      LIMIT 1`,
    [clientId, waMessageId]
  );
  return (rows || []).length > 0;
}

async function foiDoSistemaAgora(pool, { clientId, waMessageId }) {
  if (estaNaMemoria(waMessageId)) return true;
  return estaGravadoComoEnvioDoSistema(pool, { clientId, waMessageId });
}

/**
 * Este fromMe foi digitado por gente no aparelho?
 * - true: id desconhecido nas duas fontes, mesmo depois da segunda conferência;
 * - false: é eco de envio nosso, ou não dá para saber (sem id, erro de leitura). Na dúvida NÃO pausa: pausa errada cala o
 *   agente até alguém clicar em "Reativar", sem ninguém saber por quê.
 */
export async function isDeviceTypedMessage(pool, { clientId, waMessageId }) {
  const id = typeof waMessageId === "string" ? waMessageId.trim() : "";
  if (!clientId || !id) return false;
  try {
    if (await foiDoSistemaAgora(pool, { clientId, waMessageId: id })) return false;
    await new Promise((resolve) => setTimeout(resolve, recheckMs));
    return !(await foiDoSistemaAgora(pool, { clientId, waMessageId: id }));
  } catch (err) {
    console.error("[system-sent] falha ao conferir se o fromMe é envio do sistema; sem pausa:", err?.message || err);
    return false;
  }
}

export function _setDeviceReplyRecheckMsForTesting(ms) {
  recheckMs = ms;
}

export function _resetSystemSentMessagesForTesting() {
  enviados.clear();
}
