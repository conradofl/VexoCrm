// Como a tela escreve uma mensagem que não é texto.
//
// O servidor grava entre colchetes o que não tem texto: "[Localização] Rua A", "[Contato] Ana",
// "[sticker]". Mensagens antigas ficaram gravadas só como "[Mensagem]", sem o tipo: para essas a
// tela diz que o tipo não foi registrado, em vez de repetir um rótulo vazio.

const EXACT: Record<string, string> = {
  "[mensagem]": "Mensagem sem texto (tipo não registrado)",
  "[mensagem sem conteúdo]": "Mensagem sem conteúdo",
  "[sticker]": "Figurinha",
  "[reação]": "Reação",
  "[interação]": "Resposta de botão",
  "[áudio]": "Áudio",
  "[audio]": "Áudio",
  "[imagem]": "Imagem",
  "[vídeo]": "Vídeo",
  "[video]": "Vídeo",
  "[documento]": "Documento",
};

const UNRECOGNIZED = /^\[tipo não reconhecido:\s*([^\]]+)\]$/i;

/** Texto de prévia (lista de conversas): nome do tipo em vez do colchete cru. */
export function describeMessageLabel(body: string | null | undefined): string {
  const raw = (body ?? "").trim();
  if (!raw) return "";
  const exact = EXACT[raw.toLowerCase()];
  if (exact) return exact;
  const unrecognized = raw.match(UNRECOGNIZED);
  if (unrecognized) return `Tipo de mensagem não reconhecido (${unrecognized[1].trim()})`;
  return raw;
}

/** true quando a mensagem é só um rótulo de tipo, sem conteúdo escrito pelo contato. */
export function isTypeOnlyLabel(body: string | null | undefined): boolean {
  const raw = (body ?? "").trim();
  return Boolean(EXACT[raw.toLowerCase()]) || UNRECOGNIZED.test(raw);
}
