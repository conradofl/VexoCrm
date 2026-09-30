// backend/src/services/leadAgreement.js
// Serviço central de acordos comerciais de leads para Follow-up e Inbox.
//
// Regra de Ouro: Acordo é sugestão do modelo até que um humano confirme.
// Acordo confirmado é decisão humana e nunca é sobrescrito por IA.

export const MAX_AGREEMENT_LENGTH = 140;

/**
 * Remove emojis, marcações de resumo (colchetes, prefixos) e limpa o texto do acordo.
 * Se o texto exceder o limite de tamanho, retorna null para não enviar frase truncada.
 *
 * @param {string} texto
 * @param {number} [maxLen=MAX_AGREEMENT_LENGTH]
 * @returns {string|null}
 */
export function sanitizeAgreementForMessage(texto, maxLen = MAX_AGREEMENT_LENGTH) {
  if (!texto || typeof texto !== "string") return null;

  // 1. Remove emojis e símbolos gráficos
  let cleaned = texto
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/[🤝🎯📋🛑💰⏭️❓⚠️🛡️💵💸🔍❔]/gu, "");

  // 2. Remove prefixos e colchetes típicos de resumo
  cleaned = cleaned
    .replace(/^\s*(?:acordo(?:\s+combinado)?|combinado|o\s+que\s+foi\s+combinado):\s*/i, "")
    .replace(/[\[\]]/g, "")
    .replace(/^[\s—–:-]+|[\s—–:-]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return null;

  // 3. Trava de tamanho: se exceder o limite, NUNCA trunca no meio. Retorna null ("melhor não enviar")
  if (cleaned.length > maxLen) {
    return null;
  }

  return cleaned;
}

/**
 * Verifica se o lead possui um acordo com validação humana confirmada.
 *
 * @param {object} lead
 * @returns {boolean}
 */
export function hasConfirmedAgreement(lead) {
  const acordo = lead?.dados?.acordo || lead?.acordo;
  return Boolean(
    acordo &&
    acordo.texto &&
    typeof acordo.texto === "string" &&
    acordo.texto.trim().length > 0 &&
    acordo.confirmado_por &&
    acordo.confirmado_em
  );
}

/**
 * Salva um acordo no objeto de dados do lead sem criar coluna nova no banco.
 * Se já houver um acordo confirmado, guarda a nova extração em `acordo_pendente`
 * para decisão humana e NÃO sobrescreve.
 *
 * @param {object} leadDados
 * @param {object} novoAcordo
 * @returns {object} dados atualizados
 */
export function saveLeadAgreement(leadDados = {}, novoAcordo = {}) {
  const dados = { ...(leadDados || {}) };
  const existingAcordo = dados.acordo;

  const acordoObj = {
    texto: String(novoAcordo.texto || "").trim(),
    prazo_data: novoAcordo.prazo_data || null,
    quem_faz: novoAcordo.quem_faz || "lead",
    registrado_em: novoAcordo.registrado_em || new Date().toISOString(),
    confirmado_por: novoAcordo.confirmado_por || null,
    confirmado_em: novoAcordo.confirmado_em || null,
  };

  const hasConfirmed = Boolean(
    existingAcordo?.confirmado_por &&
    existingAcordo?.confirmado_em &&
    existingAcordo?.texto
  );

  if (hasConfirmed) {
    // Não sobrescreve acordo confirmado: guarda como sugestão pendente
    dados.acordo_pendente = {
      ...acordoObj,
      confirmado_por: null,
      confirmado_em: null,
      sugerido_em: new Date().toISOString(),
    };
  } else {
    dados.acordo = acordoObj;
  }

  return dados;
}

/**
 * Confirma o acordo comercial por um usuário humano no Inbox.
 * Se houver acordo_pendente, promove-o para acordo oficial.
 *
 * @param {object} leadDados
 * @param {object} param1
 * @returns {object} dados atualizados
 */
export function confirmLeadAgreement(
  leadDados = {},
  { confirmedBy, confirmedAt = new Date().toISOString() } = {}
) {
  const dados = { ...(leadDados || {}) };
  if (!confirmedBy) {
    throw new Error("confirmLeadAgreement exige identificação do usuário em confirmedBy.");
  }

  if (dados.acordo_pendente) {
    dados.acordo = {
      ...dados.acordo_pendente,
      confirmado_por: confirmedBy,
      confirmado_em: confirmedAt,
    };
    delete dados.acordo_pendente;
  } else if (dados.acordo) {
    dados.acordo = {
      ...dados.acordo,
      confirmado_por: confirmedBy,
      confirmado_em: confirmedAt,
    };
  }

  return dados;
}

/**
 * Tenta inferir uma data de prazo (YYYY-MM-DD) a partir de termos temporais comuns em português.
 *
 * @param {string} texto
 * @param {Date} [refDate=new Date()]
 * @returns {string|null}
 */
export function parsePrazoData(texto, refDate = new Date()) {
  if (!texto || typeof texto !== "string") return null;
  const t = texto.toLowerCase();

  // Data explícita ISO ou YYYY-MM-DD
  const isoMatch = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  // Data DD/MM/YYYY ou DD/MM
  const brDateMatch = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (brDateMatch) {
    const day = Number(brDateMatch[1]);
    const month = Number(brDateMatch[2]) - 1;
    let year = brDateMatch[3] ? Number(brDateMatch[3]) : refDate.getFullYear();
    if (year < 100) year += 2000;
    const d = new Date(Date.UTC(year, month, day, 12, 0, 0));
    return d.toISOString().split("T")[0];
  }

  // Palavras-chave relativas
  const ref = new Date(refDate.getTime());
  const year = ref.getUTCFullYear();
  const month = ref.getUTCMonth();
  const date = ref.getUTCDate();
  const dayOfWeek = ref.getUTCDay(); // 0 = Domingo, 1 = Segunda...

  if (/\bhoje\b/i.test(t)) {
    return new Date(Date.UTC(year, month, date, 12, 0, 0)).toISOString().split("T")[0];
  }

  if (/\bamanh[aã]\b/i.test(t)) {
    return new Date(Date.UTC(year, month, date + 1, 12, 0, 0)).toISOString().split("T")[0];
  }

  const diasSemana = [
    { regex: /\bdomingo\b/i, targetDay: 0 },
    { regex: /\bsegunda(?:-feira)?\b/i, targetDay: 1 },
    { regex: /\bter[cç]a(?:-feira)?\b/i, targetDay: 2 },
    { regex: /\bquarta(?:-feira)?\b/i, targetDay: 3 },
    { regex: /\bquinta(?:-feira)?\b/i, targetDay: 4 },
    { regex: /\bsexta(?:-feira)?\b/i, targetDay: 5 },
    { regex: /\bs[aá]bado\b/i, targetDay: 6 },
  ];

  for (const ds of diasSemana) {
    if (ds.regex.test(t)) {
      let diff = ds.targetDay - dayOfWeek;
      if (diff <= 0) diff += 7; // Próximo dia correspondente
      return new Date(Date.UTC(year, month, date + diff, 12, 0, 0)).toISOString().split("T")[0];
    }
  }

  return null;
}
