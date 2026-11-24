// Helper centralizado para canonicalização de telefones em queries PostgreSQL.
// Garante casamento exato no padrão brasileiro com ou sem 9º dígito e DDI 55.

export const SQL_CANONICAL_PHONE = (col) => `
  CASE
    WHEN ${col} LIKE '%@g.us' OR ${col} LIKE '%@lid' THEN ${col}
    WHEN length(regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g')) = 12 AND regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g') ~ '^55[1-9]{2}[6-9]'
      THEN '55' || substr(regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g'), 3, 2) || '9' || substr(regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g'), 5)
    WHEN length(regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g')) = 10 AND regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g') ~ '^[1-9]{2}[6-9]'
      THEN '55' || substr(regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g'), 1, 2) || '9' || substr(regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g'), 3)
    WHEN length(regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g')) = 10 AND regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g') ~ '^[1-9]{2}[2-5]'
      THEN '55' || regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g')
    WHEN length(regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g')) = 11 AND regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g') ~ '^[1-9]{2}9'
      THEN '55' || regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g')
    ELSE regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g')
  END
`;

/**
 * Grafias cruas de um telefone JÁ CANÔNICO (${col}), como text[]: as únicas formas só de dígitos que
 * SQL_CANONICAL_PHONE leva de volta a esse mesmo número.
 *   celular  55 DD 9 XXXXXXXX   -> o próprio | sem 55 | sem o 9 | sem 55 e sem o 9
 *                                  (as duas "sem o 9" só quando o dígito depois do 9 é 6-9: é a
 *                                  única situação em que a expressão canônica devolve o 9)
 *   fixo     55 DD [2-5]XXXXXXX -> o próprio | sem 55
 *   qualquer outra coisa         -> só o próprio
 *
 * Serve para achar uma linha por IGUALDADE num índice comum sobre a coluna crua
 * (`telefone = ANY(...)`), em vez de aplicar a expressão canônica em cada linha da tabela.
 *
 * LIMITE, de propósito: só acha telefone gravado só com dígitos numa dessas grafias. Máscara
 * ("(34) 9..."), zero na frente ("034...") e número sem DDD (8 ou 9 dígitos) ficam de fora.
 * test/canonicalPhoneSpellings.test.js amarra esta lista à expressão canônica: mudou uma, o teste
 * cobra a outra.
 */
export const SQL_CANONICAL_PHONE_SPELLINGS = (col) => `array_remove(ARRAY[
    ${col},
    CASE WHEN ${col} ~ '^55[1-9]{2}9[0-9]{8}$' THEN substr(${col}, 3) END,
    CASE WHEN ${col} ~ '^55[1-9]{2}9[6-9][0-9]{7}$' THEN '55' || substr(${col}, 3, 2) || substr(${col}, 6) END,
    CASE WHEN ${col} ~ '^55[1-9]{2}9[6-9][0-9]{7}$' THEN substr(${col}, 3, 2) || substr(${col}, 6) END,
    CASE WHEN ${col} ~ '^55[1-9]{2}[2-5][0-9]{7}$' THEN substr(${col}, 3) END
  ], NULL)`;

/**
 * Canônico + JID: tira o sufixo de um JID de telefone do WhatsApp ("5534...@s.whatsapp.net", "...@c.us")
 * ANTES de canonicalizar, para o JID casar com o telefone puro equivalente. "@lid" NÃO é telefone (é um
 * identificador interno do WhatsApp, sem número por trás): continua com o "@" e nunca casa com telefone.
 * Usado nos cruzamentos por telefone do relatório de auditoria, dos dois lados.
 */
export const SQL_CANONICAL_PHONE_JID = (col) =>
  SQL_CANONICAL_PHONE(`regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '')`);

/** Só os dígitos de um telefone (sem "+", máscara ou sufixo). Uma regra para vários nomes antigos. */
export function phoneDigits(raw) {
  if (raw === null || raw === undefined) return "";
  return String(raw).replace(/\D/g, "");
}

/**
 * Número para a Evolution no jeito antigo da GD, Heloísa, jurídico e Slack: só dígitos e
 * "55" na frente quando vier com 10 ou 11 dígitos (DDD + número). NÃO põe o 9 nem trata
 * zero na frente (isso é toCanonicalPhone). Era copiado em 4 arquivos.
 */
export function toWhatsappNumberBr(raw) {
  const digits = phoneDigits(raw);
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

/**
 * Normaliza um telefone bruto para o formato canônico brasileiro no JavaScript.
 * Espelha fielmente a expressão SQL_CANONICAL_PHONE para garantir paridade exata
 * na escrita, permitindo indexação e busca direta por igualdade (=).
 *
 * Ex.:
 * - "(34) 99109-3607" -> "5534991093607"
 * - "3491093607"      -> "5534991093607"
 * - "553491093607"    -> "5534991093607"
 * - "5534991093607"   -> "5534991093607"
 * - "3432345678"      -> "553432345678"
 */
export function toCanonicalPhone(raw) {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower.includes("@g.us") || lower.includes("@lid")) return s;
  const clean = s.replace(/@(s\.whatsapp\.net|c\.us)$/i, "");
  const digits = clean.replace(/\D/g, "");
  if (!digits) return "";

  // 12 dígitos: 55 + DDD [1-9][1-9] + celular [6-9] (sem o 9) -> 55 + DDD + 9 + restante
  if (digits.length === 12 && /^55[1-9]{2}[6-9]/.test(digits)) {
    return `55${digits.slice(2, 4)}9${digits.slice(4)}`;
  }
  // 10 dígitos: DDD [1-9][1-9] + celular [6-9] (sem 55 e sem o 9) -> 55 + DDD + 9 + restante
  if (digits.length === 10 && /^[1-9]{2}[6-9]/.test(digits)) {
    return `55${digits.slice(0, 2)}9${digits.slice(2)}`;
  }
  // 10 dígitos: fixo com DDD [1-9][1-9] + [2-5] (sem 55) -> 55 + fixo
  if (digits.length === 10 && /^[1-9]{2}[2-5]/.test(digits)) {
    return `55${digits}`;
  }
  // 11 dígitos: celular com DDD [1-9][1-9] + 9 (sem 55) -> 55 + celular
  if (digits.length === 11 && /^[1-9]{2}9/.test(digits)) {
    return `55${digits}`;
  }
  return digits;
}

/**
 * Normaliza um telefone ou JID do WhatsApp para o formato canônico brasileiro.
 * Remove o sufixo de JID de telefone individual (@s.whatsapp.net, @c.us) ANTES de
 * canonicalizar para garantir que tanto o JID quanto o telefone cru convirjam
 * para a mesma chave canônica.
 *
 * JIDs de grupos (@g.us) e identificadores @lid NÃO são telefones:
 * são preservados sem passar pela canonicalização de dígitos.
 */
export function toCanonicalPhoneFromJid(raw) {
  if (raw === null || raw === undefined) return "";
  const s = String(raw).trim();
  if (!s) return "";
  const lower = s.toLowerCase();
  if (lower.includes("@g.us") || lower.includes("@lid")) {
    return s;
  }
  const stripped = s.replace(/@(s\.whatsapp\.net|c\.us)$/i, "");
  return toCanonicalPhone(stripped) || stripped;
}

/**
 * Espelha em JavaScript o padrão `col = $x OR SQL_CANONICAL_PHONE(col) =
 * SQL_CANONICAL_PHONE($x)` já usado em domains/chatbot/routes.js:955 e em
 * buildMessageEffectivenessSql (campaigns/routes.js) pro EXISTS de
 * "respondeu": igualdade crua primeiro (usa índice no caso comum, telefone
 * já no mesmo formato), canônica como OR pra quando o formato diverge (com
 * DDI de um lado, sem do outro). Só existe pra dar teste real a essa
 * comparação sem precisar de Postgres — a query continua em SQL.
 *
 * Vazio/null nunca casa com vazio/null, nem consigo mesmo: em SQL,
 * `'' = ''` é verdadeiro mas `NULL = NULL` nunca é — e o telefone do run
 * pode vir gravado como string vazia (campaigns/routes.js insere
 * `phone || ""`). Sem essa guarda, dois telefones vazios "respondem" um ao
 * outro.
 */
export function phoneMatches(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const canonicalA = toCanonicalPhone(a);
  const canonicalB = toCanonicalPhone(b);
  if (!canonicalA || !canonicalB) return false;
  return canonicalA === canonicalB;
}

/**
 * Formas de busca de um telefone digitado na busca de Conversas (19/11/2026): só os dígitos, sem o 55, com e sem o
 * nono dígito. A busca antiga comparava o texto cru com o telefone salvo: "(34) 98410-6585" ou "3484106585" não
 * achavam a conversa 5534984106585. A listagem usa cada forma como `%forma%` sobre os dígitos do telefone.
 *   "(34) 98410-6585" -> ["34984106585", "3484106585"]
 *   "553484106585"    -> ["3484106585", "34984106585"]
 *   "84106585"        -> ["84106585", "984106585"]
 * Vazio quando o texto tem letra (é busca por nome ou por mensagem) ou menos de 8 dígitos.
 */
export function variantesDeBuscaPorTelefone(texto) {
  const s = String(texto ?? "").trim();
  if (!s || /\p{L}/u.test(s)) return [];
  let d = s.replace(/\D/g, "");
  if (d.length < 8 || d.length > 13) return [];
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  const formas = [d];
  if (d.length === 11 && /^[1-9]{2}9[6-9]/.test(d)) formas.push(d.slice(0, 2) + d.slice(3)); // DD 9XXXX-XXXX -> sem o 9
  else if (d.length === 10 && /^[1-9]{2}[6-9]/.test(d)) formas.push(`${d.slice(0, 2)}9${d.slice(2)}`); // DD XXXX-XXXX -> com o 9
  else if (d.length === 9 && /^9[6-9]/.test(d)) formas.push(d.slice(1));
  else if (d.length === 8 && /^[6-9]/.test(d)) formas.push(`9${d}`);
  return formas;
}
