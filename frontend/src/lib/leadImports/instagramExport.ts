// frontend/src/lib/leadImports/instagramExport.ts
//
// Extração de contatos de exportação do Instagram. Tudo aqui roda no
// navegador — a leitura e o parse do arquivo, nunca no servidor (mesmo
// padrão de parseSpreadsheetFile.ts pro xlsx). O que sobe pro backend é só
// o que estas funções produzem: nome, telefone (quando a regex acha um
// válido) e resumo. Nenhuma chamada de IA em lugar nenhum deste arquivo —
// telefone sai de regex validada, resumo é a primeira mensagem da pessoa,
// literal, cortada.

import { sanitizePhone } from "@/lib/phone";

export interface RawExportFile {
  /** Caminho relativo dentro da pasta escolhida, ex.: "instagram/messages/inbox/fernanda_123/message_1.json" */
  path: string;
  text: string;
}

export interface ParsedInstagramContact {
  name: string;
  /**
   * Identificador único do contato dentro do tenant. O JSON padrão do
   * Instagram só traz `participants[].name` (sem @usuário separado) — por
   * isso `perfil` é o próprio nome aqui. Se uma exportação futura trouxer
   * um handle de verdade, isso é o lugar pra trocar.
   */
  perfil: string;
  phone: string | null;
  resumo: string;
  /** Classificação: 'lead' (possível cliente) ou 'personal' (conversa pessoal/casual) */
  category?: "lead" | "personal";
  /** Rótulo da intenção identificada (ex: 'Orçamento / Preço', 'Dúvida de Serviço', 'Conversa Pessoal') */
  intentLabel?: string;
  /** Última mensagem da conversa */
  lastMessage?: string;
}

export interface InstagramParseResult {
  withPhone: ParsedInstagramContact[];
  withoutPhone: ParsedInstagramContact[];
  warning: "needs_unzip" | "needs_json_export" | "no_conversations_found" | null;
}

// O JSON do Instagram guarda texto em UTF-8 codificado DUAS vezes: cada
// byte da sequência UTF-8 correta foi interpretado como um code point
// Latin-1 separado antes de virar JSON. "ç" (2 bytes UTF-8: 0xC3 0xA7) chega
// como dois caracteres distintos (Ã, §) em vez de um. O jeito de desfazer:
// pegar o char code de cada caractere da string JS (0-255, um por byte
// original) e decodificar essa sequência de bytes como UTF-8 de verdade.
export function fixInstagramEncoding(value: string): string {
  if (!value) return value;
  try {
    const bytes = Uint8Array.from(value, (c) => c.charCodeAt(0) & 0xff);
    const fixed = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return fixed;
  } catch {
    // Não era o padrão esperado (já estava correto, ou não é texto
    // duplamente codificado) — devolve como veio, não inventa nada.
    return value;
  }
}

// Candidato a telefone brasileiro em prosa: DDI opcional (+55/55), DDD
// opcional entre parênteses, nono dígito opcional, separado por espaço,
// ponto ou traço. Isto só ACHA candidatos — quem decide se é um telefone de
// verdade é sanitizePhone, com as mesmas regras do backend.
const PHONE_CANDIDATE_REGEX = /(?:\+?55\s*)?\(?\d{2}\)?[\s.-]?9?\s?\d{4}[\s.-]?\d{4}/g;

/**
 * Procura um telefone válido no texto. Regex acha candidatos, sanitizePhone
 * valida — as MESMAS regras de sanitizePhoneE164 no backend (mesmo
 * arquivo-espelho, frontend/src/lib/phone.ts). O que não passa é
 * descartado, nunca corrigido ou completado.
 */
export function extractPhoneFromText(text: string): string | null {
  if (!text) return null;
  const candidates = text.match(PHONE_CANDIDATE_REGEX) || [];
  for (const candidate of candidates) {
    const sanitized = sanitizePhone(candidate);
    if (sanitized) {
      return sanitized.startsWith("+") ? sanitized : `+${sanitized}`;
    }
  }
  return null;
}

// Palavras-chave indicativas de intenção comercial / compra / contratação
export const COMMERCIAL_KEYWORDS_REGEX =
  /(?:orçamento|orcamento|cotação|cotacao|cotar|quanto\s+(?:custa|fica|sai|é|e|tá|ta)|qual\s+(?:o|é|e)?\s*(?:valor|preço|preco|custo|tabela)|tabela|tabela de preço|valores|preços|precos|desconto|proposta|condições|condicoes|pagamento|parcela|parcelas|parcelamento|parcelam|cartão|cartao|pix|boleto|comprar|compra|adquirir|contratar|contrato|fechar\s+negócio|fechar\s+serviço|vaga|vagas|inscrição|inscricao|matrícula|matricula|matricular|curso|mentoria|consultoria|projeto|serviço|servico|serviços|servicos|pacote|plano|planos|produto|produtos|atendimento|atendem|atende|atendimento presencial|entrega|entregam|entregas|frete|prazo|disponível|disponivel|tem pronta entrega|horário|horario|agendar|agenda|agendamento|marcar\s+horário|marcar\s+consulta|consulta|sessão|sessao|como\s+funciona|queria\s+saber\s+mais|mais\s+informações|mais\s+informacoes|informações|informacoes|detalhes|endereço|endereco|onde\s+fica|localização|localizacao|onde\s+vocês\s+estão|onde\s+voces\s+estao|qual\s+cidade|tem\s+loja|anúncio|anuncio|patrocinado)/i;

// Expressões típicas de conversa pessoal / casual / amigos / família
export const PERSONAL_CHAT_REGEX =
  /(?:hahaha|kkkk|rsrs|hehehe|mano|véi|vei|brother|amigo|amiga|parceiro|saudades|saudade|parabéns|parabens|feliz aniversário|aniversario|churrasco|cerveja|chopp|festa|almoço|almoco|jantar|bora|vamos\s+sair|sumido|sumida|rolê|role|beijo|beijos|abraço|abraco|academia|treino|frango|pegar\s+peso|futebol|jogo|família|familia|primo|prima|tio|tia|mãe|mae|pai|irmão|irmao)/i;

export interface InstagramConversationClassification {
  category: "lead" | "personal";
  intentLabel: string;
  resumo: string;
  phone: string | null;
  lastMessage: string;
}

/**
 * Classifica a conversa do Instagram entre "Possível Cliente" e "Conversa Pessoal".
 * Não faz nenhuma chamada de rede nem de IA: utiliza análise semântica e heurística
 * local no navegador, identificando dúvidas comerciais, termos de preço, serviços
 * e separando conversas casuais de amigos/família.
 */
export function classifyInstagramConversation(
  rawMessages: Array<{ sender_name?: string; content?: string; timestamp_ms?: number }>,
  selfName: string,
  otherName: string
): InstagramConversationClassification {
  const chronological = [...(rawMessages || [])].sort((a, b) => (a.timestamp_ms || 0) - (b.timestamp_ms || 0));

  const otherMessages = chronological
    .filter((m) => {
      const sender = fixInstagramEncoding(m.sender_name || "");
      return sender && sender !== selfName && m.content;
    })
    .map((m) => ({
      content: fixInstagramEncoding(m.content || "").trim(),
      timestamp: m.timestamp_ms || 0,
    }))
    .filter((m) => m.content.length > 0);

  let phone: string | null = null;
  for (const m of chronological) {
    if (!m.content) continue;
    phone = extractPhoneFromText(fixInstagramEncoding(m.content));
    if (phone) break;
  }

  const lastMessage = otherMessages[otherMessages.length - 1]?.content || "";

  if (otherMessages.length === 0) {
    return {
      category: "personal",
      intentLabel: "Sem Mensagens",
      resumo: "Nenhuma mensagem enviada pelo contato.",
      phone,
      lastMessage: "",
    };
  }

  const commercialInquiries: string[] = [];
  const generalQuestions: string[] = [];
  const personalMessages: string[] = [];

  for (const msg of otherMessages) {
    const text = msg.content;
    if (COMMERCIAL_KEYWORDS_REGEX.test(text)) {
      commercialInquiries.push(text);
    } else if (/\?/.test(text) && !PERSONAL_CHAT_REGEX.test(text)) {
      generalQuestions.push(text);
    } else if (PERSONAL_CHAT_REGEX.test(text)) {
      personalMessages.push(text);
    }
  }

  const isCommercial =
    commercialInquiries.length > 0 ||
    (generalQuestions.length > 0 && personalMessages.length === 0) ||
    (phone != null && commercialInquiries.length > 0);

  if (isCommercial) {
    const bestInquiry = commercialInquiries[0] || generalQuestions[0] || otherMessages[0].content;
    let label = "Dúvida de Serviço";
    if (/(?:orçamento|orcamento|preço|preco|valor|quanto\s+custa|tabela|pagamento|parcela)/i.test(bestInquiry)) {
      label = "Orçamento / Preço";
    } else if (phone && /(?:whats|telefone|celular|ligar)/i.test(bestInquiry)) {
      label = "WhatsApp / Contato";
    } else if (/(?:onde\s+fica|endereço|endereco|cidade|localização)/i.test(bestInquiry)) {
      label = "Localização / Atendimento";
    }

    return {
      category: "lead",
      intentLabel: label,
      resumo: bestInquiry.slice(0, 200),
      phone,
      lastMessage,
    };
  }

  // Não tem conteúdo comercial — conversa pessoal / amigos
  const samplePersonal = personalMessages[0] || otherMessages[0].content;
  const isShortReaction = /^(?:hahaha|kkkk|rsrs|😂|❤️|🔥|👏|opa|oi|ola|olá|oie)[!.]*$/i.test(samplePersonal);
  const prefix = isShortReaction ? '🚫 Conversa casual: "' : '🚫 Conversa pessoal: "';
  const suffix = '"';
  const availableLen = 200 - prefix.length - suffix.length;
  const cleanExcerpt = samplePersonal.slice(0, Math.max(availableLen, 0));
  const resumo = `${prefix}${cleanExcerpt}${suffix}`;

  return {
    category: "personal",
    intentLabel: "Conversa Pessoal",
    resumo,
    phone,
    lastMessage,
  };
}

export function isInstagramMessageJsonPath(path: string): boolean {
  if (/messages\/message_requests\//i.test(path)) return false;
  if (/photos\/|files\/|videos\/|voice_messages\//i.test(path)) return false;
  if (/your_scheduled_messages\.json$/i.test(path)) return false;
  return /(?:messages\/inbox\/[^/]+\/|inbox\/[^/]+\/|^(?:[^/]*\/)?)message_\d+\.json$/i.test(path);
}

export function isInstagramMessageHtmlPath(path: string): boolean {
  if (/messages\/message_requests\//i.test(path)) return false;
  return /(?:messages\/inbox\/[^/]+\/|inbox\/[^/]+\/|^(?:[^/]*\/)?)message_\d+\.html$/i.test(path);
}

interface RawInstagramMessage {
  sender_name?: string;
  content?: string;
  timestamp_ms?: number;
}

interface RawInstagramThread {
  participants?: { name?: string }[];
  messages?: RawInstagramMessage[];
}

/**
 * Parse local, sem rede, sem IA. Recebe {path, text} já lidos do navegador
 * (o File nunca precisa sair daqui) e devolve os contatos separados em dois
 * grupos, prontos pra tela mostrar ANTES de qualquer coisa ser salva.
 */
export function parseInstagramExport(files: RawExportFile[]): InstagramParseResult {
  if (files.some((f) => /\.zip$/i.test(f.path))) {
    return { withPhone: [], withoutPhone: [], warning: "needs_unzip" };
  }

  const jsonFiles = files.filter((f) => isInstagramMessageJsonPath(f.path));
  if (jsonFiles.length === 0) {
    const hasHtml = files.some((f) => isInstagramMessageHtmlPath(f.path));
    return { withPhone: [], withoutPhone: [], warning: hasHtml ? "needs_json_export" : "no_conversations_found" };
  }

  const threads: RawInstagramThread[] = [];
  for (const f of jsonFiles) {
    try {
      threads.push(JSON.parse(f.text));
    } catch {
      continue;
    }
  }

  // "Quem sou eu" não vem marcado no JSON do Instagram — mas é a mesma
  // pessoa em toda exportação (é a conta de quem exportou). O nome que
  // aparece em MAIS conversas é o dono da conta; o outro participante, por
  // conversa, é o contato.
  const participantCounts = new Map<string, number>();
  for (const t of threads) {
    const names = new Set((t.participants || []).map((p) => fixInstagramEncoding(p?.name || "")).filter(Boolean));
    for (const n of names) participantCounts.set(n, (participantCounts.get(n) || 0) + 1);
  }
  let selfName = "";
  let maxCount = 0;
  for (const [name, count] of participantCounts) {
    if (count > maxCount) {
      maxCount = count;
      selfName = name;
    }
  }

  const withPhone: ParsedInstagramContact[] = [];
  const withoutPhone: ParsedInstagramContact[] = [];

  for (const t of threads) {
    const participantNames = (t.participants || []).map((p) => fixInstagramEncoding(p?.name || "")).filter(Boolean);
    // Só conversa 1:1 — grupo tem mais de uma pessoa "não eu", e não dá pra
    // saber qual delas é o contato de verdade sem adivinhar.
    if (participantNames.length !== 2) continue;
    const other = participantNames.find((n) => n !== selfName) || participantNames[0];
    if (!other) continue;

    const classification = classifyInstagramConversation(t.messages || [], selfName, other);

    const contact: ParsedInstagramContact = {
      name: other,
      perfil: other,
      phone: classification.phone,
      resumo: classification.resumo,
      category: classification.category,
      intentLabel: classification.intentLabel,
      lastMessage: classification.lastMessage,
    };

    if (classification.phone) withPhone.push(contact);
    else withoutPhone.push(contact);
  }

  return { withPhone, withoutPhone, warning: null };
}

/**
 * O que sobe pro backend — só isto. Aceita o resultado completo ou uma lista
 * filtrada de contatos selecionados pelo usuário na tela.
 */
export function buildInstagramImportPayload(
  resultOrContacts: InstagramParseResult | ParsedInstagramContact[]
) {
  const list = Array.isArray(resultOrContacts)
    ? resultOrContacts
    : [...resultOrContacts.withPhone, ...resultOrContacts.withoutPhone];

  return {
    contacts: list.map((c) => ({
      name: c.name,
      perfil: c.perfil,
      phone: c.phone,
      resumo: c.resumo,
    })),
  };
}

/**
 * Formata a mensagem padrão para abordagem manual no Instagram Direct.
 * Usa o nome da pessoa e o resumo da primeira mensagem como contexto.
 */
export function formatInstagramDirectMessage(name: string, resumo?: string | null): string {
  const cleanName = (name || "").trim() || "lá";
  const cleanResumo = (resumo || "")
    .replace(/^🚫\s*(?:Conversa\s+pessoal|Conversa\s+casual|Pessoal)?[:\s-]*/i, "")
    .replace(/^['"]|['"]$/g, "")
    .trim();
  if (cleanResumo) {
    return `Oi ${cleanName}! Vi sua mensagem sobre '${cleanResumo}'. Me passa seu WhatsApp por aqui que te explico tudo em detalhes por lá rapidinho!`;
  }
  return `Oi ${cleanName}! Vi sua mensagem no Direct. Me passa seu WhatsApp por aqui que te explico tudo em detalhes por lá rapidinho!`;
}
