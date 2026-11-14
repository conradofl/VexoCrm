// Regras de tela da janela "Nova conversa": reconhecer um número digitado e achar lead pelo nome
// ou pelo telefone. O servidor confere tudo de novo; isto só evita pedido que já nasce errado.

export interface NewConversationChip {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface NewConversationLead {
  id: string;
  name: string;
  phone: string;
}

export interface StartConversationResult {
  chatId: string;
  existing: boolean;
}

const digitsOf = (value: string) => value.replace(/\D/g, "");
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Número brasileiro com DDD: 10 ou 11 dígitos, ou 12 ou 13 com o 55 na frente. O servidor confere de novo. */
export function looksLikePhone(value: string): boolean {
  if (/[a-zA-Z@]/.test(value)) return false;
  const digits = digitsOf(value);
  return digits.startsWith("55") ? digits.length === 12 || digits.length === 13 : digits.length === 10 || digits.length === 11;
}

export function formatPhoneLabel(phone: string): string {
  const digits = digitsOf(phone);
  const local = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return phone;
}

/** Leads cujo nome ou telefone contém o que foi digitado. Precisa de 2 letras ou 4 dígitos para começar. */
export function searchLeads(leads: NewConversationLead[], term: string, limit = 6): NewConversationLead[] {
  const text = normalize(term.trim());
  const digits = digitsOf(term);
  const byName = /[a-z]/.test(text) && text.length >= 2;
  const byPhone = !byName && digits.length >= 4;
  if (!byName && !byPhone) return [];
  const out: NewConversationLead[] = [];
  for (const lead of leads) {
    if (!digitsOf(lead.phone)) continue;
    const hit = byName ? normalize(lead.name).includes(text) : digitsOf(lead.phone).includes(digits);
    if (hit) out.push(lead);
    if (out.length >= limit) break;
  }
  return out;
}

