// Que tipo de mensagem do WhatsApp chegou, quando ela não é texto nem mídia comum.
//
// Antes, tudo o que o webhook não reconhecia era gravado como "[Mensagem]": localização, contato,
// enquete, botão, mensagem apagada, e também TEXTO comum embrulhado (conversa com mensagens
// temporárias, visualização única). Aqui o embrulho é aberto e cada tipo ganha o conteúdo que
// tem, ou o nome do tipo. Rótulo vazio nunca.

const WRAPPERS = ["ephemeralMessage", "viewOnceMessage", "viewOnceMessageV2", "viewOnceMessageV2Extension"];
// Chaves que acompanham a mensagem mas não são o conteúdo dela.
const NOT_CONTENT = new Set(["messageContextInfo", "senderKeyDistributionMessage"]);

/** Abre os embrulhos do WhatsApp (mensagem temporária, visualização única) até chegar no conteúdo. */
export function unwrapEvolutionMessage(message) {
  let current = message && typeof message === "object" ? message : {};
  for (let depth = 0; depth < 5; depth += 1) {
    const wrapper = WRAPPERS.find((key) => current[key]?.message && typeof current[key].message === "object");
    if (!wrapper) break;
    current = current[wrapper].message;
  }
  return current;
}

/** Nome da chave que carrega o conteúdo (ex.: "locationMessage"). null quando a mensagem veio vazia. */
export function rawMessageKind(message) {
  const msg = unwrapEvolutionMessage(message);
  return Object.keys(msg).find((key) => !NOT_CONTENT.has(key) && msg[key] != null) || null;
}

const clean = (value) => (typeof value === "string" ? value.trim() : "");
const withDetail = (label, detail) => (clean(detail) ? `[${label}] ${clean(detail)}` : `[${label}]`);

function describeLocation(loc, label) {
  const place = [clean(loc?.name), clean(loc?.address)].filter(Boolean).join(" · ");
  if (place) return `[${label}] ${place}`;
  const lat = Number(loc?.degreesLatitude);
  const lng = Number(loc?.degreesLongitude);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return `[${label}] ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }
  return `[${label}]`;
}

/**
 * Texto para os tipos que não são texto simples nem mídia comum. Devolve null quando o tipo é dos
 * que o resto do webhook já trata (texto, imagem, áudio, vídeo, documento, figurinha, reação,
 * resposta de botão).
 */
export function describeSpecialMessage(message) {
  const msg = unwrapEvolutionMessage(message);

  if (msg.locationMessage) return describeLocation(msg.locationMessage, "Localização");
  if (msg.liveLocationMessage) return describeLocation(msg.liveLocationMessage, "Localização em tempo real");

  if (msg.contactMessage) return withDetail("Contato", msg.contactMessage.displayName);
  if (msg.contactsArrayMessage) {
    const names = (msg.contactsArrayMessage.contacts || []).map((c) => clean(c?.displayName)).filter(Boolean);
    return withDetail("Contatos", names.join(", ") || msg.contactsArrayMessage.displayName);
  }

  const poll = msg.pollCreationMessage || msg.pollCreationMessageV2 || msg.pollCreationMessageV3;
  if (poll) return withDetail("Enquete", poll.name);
  if (msg.pollUpdateMessage) return "[Voto em enquete]";

  // Mensagens com botão/lista enviadas pela empresa: o texto existe, só vem em outro campo.
  if (msg.templateMessage) {
    const tpl = msg.templateMessage.hydratedTemplate || msg.templateMessage.hydratedFourRowTemplate || {};
    return clean(tpl.hydratedContentText) || withDetail("Botão", tpl.hydratedTitleText);
  }
  if (msg.buttonsMessage) return clean(msg.buttonsMessage.contentText) || withDetail("Botão", msg.buttonsMessage.text);
  if (msg.listMessage) return clean(msg.listMessage.description) || withDetail("Lista", msg.listMessage.title);
  if (msg.interactiveMessage) {
    return clean(msg.interactiveMessage.body?.text) || withDetail("Botão", msg.interactiveMessage.header?.title);
  }

  if (msg.editedMessage?.message) {
    const edited = unwrapEvolutionMessage(msg.editedMessage.message);
    const inner = edited.protocolMessage?.editedMessage ? unwrapEvolutionMessage(edited.protocolMessage.editedMessage) : edited;
    return withDetail("Mensagem editada", inner.conversation || inner.extendedTextMessage?.text);
  }
  if (msg.protocolMessage) {
    const type = msg.protocolMessage.type;
    if (type === 0 || type === "REVOKE") return "[Mensagem apagada]";
    if (msg.protocolMessage.editedMessage) {
      const inner = unwrapEvolutionMessage(msg.protocolMessage.editedMessage);
      return withDetail("Mensagem editada", inner.conversation || inner.extendedTextMessage?.text);
    }
    return "[Aviso do WhatsApp]";
  }

  if (msg.groupInviteMessage) return withDetail("Convite de grupo", msg.groupInviteMessage.groupName);
  if (msg.eventMessage) return withDetail("Evento", msg.eventMessage.name);
  if (msg.productMessage) return withDetail("Produto", msg.productMessage.product?.title);
  if (msg.orderMessage) return withDetail("Pedido", msg.orderMessage.orderTitle);
  if (msg.ptvMessage) return "[Vídeo de recado]";
  if (msg.albumMessage) return "[Álbum de fotos]";
  if (msg.call || msg.callLogMesssage || msg.callLogMessage) return "[Chamada]";

  return null;
}

/** Último recurso: nunca devolve rótulo vazio. Diz o tipo técnico quando ele não tem nome em português. */
export function describeUnrecognizedMessage(message) {
  const kind = rawMessageKind(message);
  return kind ? `[Tipo não reconhecido: ${kind}]` : "[Mensagem sem conteúdo]";
}
