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

export function isInstagramMessageJsonPath(path: string): boolean {
  return /messages\/inbox\/[^/]+\/message_\d+\.json$/i.test(path);
}

export function isInstagramMessageHtmlPath(path: string): boolean {
  return /messages\/inbox\/[^/]+\/message_\d+\.html$/i.test(path);
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

  // Simplificação assumida: uma conversa cabe em um message_1.json. O
  // Instagram pode paginar conversas longas em message_2.json,
  // message_3.json... — não mescladas aqui. Primeira mensagem da pessoa
  // pode estar num arquivo mais antigo que não foi lido. Documentado, não
  // escondido.
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

    // O export do Instagram lista mensagens da mais recente pra mais
    // antiga — inverte pra ordem cronológica antes de procurar "a
    // primeira".
    const messagesChronological = Array.isArray(t.messages) ? [...t.messages].reverse() : [];

    let resumo = "";
    for (const m of messagesChronological) {
      const sender = fixInstagramEncoding(m?.sender_name || "");
      if (sender && sender !== selfName && m?.content) {
        resumo = fixInstagramEncoding(m.content).slice(0, 200);
        break;
      }
    }

    let phone: string | null = null;
    for (const m of messagesChronological) {
      if (!m?.content) continue;
      phone = extractPhoneFromText(fixInstagramEncoding(m.content));
      if (phone) break;
    }

    const contact: ParsedInstagramContact = { name: other, perfil: other, phone, resumo };
    if (phone) withPhone.push(contact);
    else withoutPhone.push(contact);
  }

  return { withPhone, withoutPhone, warning: null };
}

/**
 * O que sobe pro backend — só isto. Nunca o arquivo, nunca a conversa
 * inteira, nunca mensagem de terceiro que não virou o resumo.
 */
export function buildInstagramImportPayload(result: InstagramParseResult) {
  return {
    contacts: [...result.withPhone, ...result.withoutPhone].map((c) => ({
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
  const cleanResumo = (resumo || "").trim();
  if (cleanResumo) {
    return `Oi ${cleanName}! Vi sua mensagem sobre '${cleanResumo}'. Me passa seu WhatsApp por aqui que te explico tudo em detalhes por lá rapidinho!`;
  }
  return `Oi ${cleanName}! Vi sua mensagem no Direct. Me passa seu WhatsApp por aqui que te explico tudo em detalhes por lá rapidinho!`;
}
