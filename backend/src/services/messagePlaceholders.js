// Serviço Central de Substituição de Variáveis / Placeholders em Mensagens de Saída.
// Garante que NENHUM template ou variável como {{nome}} chegue crua ao lead.

import { sanitizeAgreementForMessage, hasConfirmedAgreement } from "./leadAgreement.js";

function normalizeString(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Substitui todas as variáveis de template no texto da mensagem antes do envio ao WhatsApp.
 * Suporta tokens case-insensitive com espaços internos opcionais:
 * - {{nome}}, {{Nome}}, {{lead_name}}, {{cliente}}, {{name}}
 * - {{telefone}}, {{phone}}, {{celular}}
 * - {{scheduling_link}}, {{link}}, {{agendamento}}
 * - {{meeting_date}}, {{meeting_time}}
 * - Variáveis dinâmicas de planilhas e campos personalizados (normalized_data, dados)
 *
 * @param {string} text - Texto da mensagem com ou sem placeholders
 * @param {object} [lead] - Objeto do lead com nome, telefone, dados, etc.
 * @param {string} [phone] - Telefone de envio / destino
 * @param {object} [extraContext] - Dados extras de agendamento, reunião ou campanha
 * @returns {string} Texto com variáveis substituídas
 */
export function applyMessagePlaceholders(text, lead = {}, phone = "", extraContext = {}) {
  let raw = normalizeString(text);
  if (!raw) return raw;

  const leadObj = lead && typeof lead === "object" ? lead : {};
  const extraObj = extraContext && typeof extraContext === "object" ? extraContext : {};

  // 1. Resolução de Nome: busca lead.nome, lead.name, lead.lead_name, dados.nome, normalized_data.nome
  const rawNome =
    normalizeString(leadObj.nome) ||
    normalizeString(leadObj.name) ||
    normalizeString(leadObj.lead_name) ||
    normalizeString(leadObj.normalized_data?.nome) ||
    normalizeString(leadObj.normalizedData?.nome) ||
    normalizeString(leadObj.dados?.nome);

  // Fallback seguro: se não houver nome cadastrado, usa "cliente"
  const nomeResolvido = rawNome || "cliente";

  // 2. Resolução de Telefone
  const telResolvido =
    normalizeString(phone) ||
    normalizeString(leadObj.telefone) ||
    normalizeString(leadObj.phone) ||
    normalizeString(leadObj.normalized_data?.telefone) ||
    "";

  // 3. Resolução de Links e Agendamento
  const schedulingLink =
    normalizeString(extraObj.scheduling_link) ||
    normalizeString(extraObj.link) ||
    normalizeString(leadObj.scheduling_link) ||
    normalizeString(leadObj.link) ||
    normalizeString(leadObj.normalized_data?.scheduling_link) ||
    normalizeString(leadObj.normalized_data?.link) ||
    normalizeString(leadObj.normalizedData?.scheduling_link) ||
    "";

  // 4. Substituições principais
  raw = raw
    .replace(/\{\{\s*(?:nome|name|lead_name|cliente)\s*\}\}/gi, nomeResolvido)
    .replace(/\{\{\s*(?:telefone|phone|celular)\s*\}\}/gi, telResolvido);

  if (schedulingLink) {
    raw = raw.replace(/\{\{\s*(?:scheduling_link|link|agendamento)\s*\}\}/gi, schedulingLink);
  }

  // 5. Variável de acordo comercial (SOMENTE se confirmado por humano)
  const hasAcordoPlaceholder = /\{\{\s*(?:acordo|combinado)\s*\}\}/gi.test(raw);
  if (hasAcordoPlaceholder) {
    const acordoObj =
      leadObj?.dados?.acordo ||
      leadObj?.acordo ||
      extraObj?.dados?.acordo ||
      extraObj?.acordo;

    const isConfirmed = Boolean(
      acordoObj &&
      acordoObj.confirmado_por &&
      acordoObj.confirmado_em &&
      acordoObj.texto &&
      typeof acordoObj.texto === "string" &&
      acordoObj.texto.trim().length > 0
    );

    if (isConfirmed) {
      const cleanAcordo = sanitizeAgreementForMessage(acordoObj.texto);
      if (cleanAcordo) {
        raw = raw.replace(/\{\{\s*(?:acordo|combinado)\s*\}\}/gi, cleanAcordo);
      }
      // Se cleanAcordo for null (porque excedeu limite de tamanho), NÃO substitui
      // para que a guarda de saída bloqueie o envio da mensagem crua!
    }
    // Se NÃO confirmado, NÃO substitui — o placeholder cru causará bloqueio pela guarda de saída
    // garantindo que acordo não confirmado NUNCA chegue ao lead por nenhum caminho!
  }

  // 6. Variáveis de reunião / follow-up
  if (extraObj.meeting_date || leadObj.meeting_date || leadObj.meeting_datetime) {
    const d = extraObj.meeting_datetime || leadObj.meeting_datetime ? new Date(extraObj.meeting_datetime || leadObj.meeting_datetime) : null;
    const dateStr = extraObj.meeting_date || leadObj.meeting_date || (d ? d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "");
    const timeStr = extraObj.meeting_time || leadObj.meeting_time || (d ? d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "");
    raw = raw
      .replace(/\{\{\s*meeting_date\s*\}\}/gi, dateStr)
      .replace(/\{\{\s*meeting_time\s*\}\}/gi, timeStr);
  }

  // 7. Dados dinâmicos adicionais (normalized_data, dados, dados.campos, extraContext)
  const leadDados = leadObj.dados && typeof leadObj.dados === "object" ? leadObj.dados : {};
  const customCampos = leadDados.campos && typeof leadDados.campos === "object" ? leadDados.campos : {};

  const customData = {
    ...leadObj,
    ...(leadObj.normalized_data || {}),
    ...(leadObj.normalizedData || {}),
    ...leadDados,
    ...customCampos,
    ...extraObj,
  };

  // Trava de segurança: impede que dados brutos ou objetos vazem nos placeholders de acordo
  delete customData.acordo;
  delete customData.combinado;
  delete customData.acordo_pendente;

  // Proteção estrita de chaves de sistema: campo do cliente chamado "nome" ou "telefone"
  // nunca sobrescreve o valor do sistema.
  delete customData.nome;
  delete customData.name;
  delete customData.lead_name;
  delete customData.cliente;
  delete customData.telefone;
  delete customData.phone;
  delete customData.celular;
  delete customData.scheduling_link;
  delete customData.link;
  delete customData.agendamento;
  delete customData.meeting_date;
  delete customData.meeting_time;
  delete customData.campos;

  for (const [key, value] of Object.entries(customData)) {
    if (typeof value === "string" || typeof value === "number") {
      const escapedKey = String(key).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, "gi");
      raw = raw.replace(regex, String(value));
    }
  }

  return raw;
}

/**
 * Detecta placeholders/variáveis não resolvidas remanescentes no texto.
 * A detecção é mais larga que a substituição: qualquer {{ até }},
 * capturando acento, espaço, hífen e pontuação (ex: {{razão social}}, {{nome do cliente}}, {{CNPJ-MATRIZ}}).
 *
 * @param {string} text - Texto a ser inspecionado
 * @returns {string[]} Lista de placeholders detectados (ex: ["{{razão social}}"])
 */
export function findUnresolvedPlaceholders(text) {
  if (!text || typeof text !== "string") return [];
  const matches = text.match(/\{\{\s*([^{}]+?)\s*\}\}/g);
  if (!matches) return [];

  const seen = new Set();
  const result = [];
  for (const match of matches) {
    const inner = match.replace(/^\{\{\s*|\s*\}\}$/g, "").trim();
    const normalized = `{{${inner}}}`;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

/**
 * Normaliza quebras de linha artificiais geradas no meio de frases:
 * - \n duplo (linhas em branco) = parágrafo -> PRESERVA
 * - \n simples no meio de frase = artefato -> converte em espaço
 *   (se linha anterior não termina em pontuação final . ! ? : e próxima linha começa em minúscula)
 * - nos demais casos, preserva a quebra.
 */
export function normalizeSentenceNewlines(raw) {
  if (!raw || typeof raw !== "string") return "";

  // Divide por quebras de parágrafo (\n\n) para isolar blocos
  const paragraphs = raw.split(/\r?\n\s*\r?\n/);

  const cleanedParagraphs = paragraphs.map((paragraph) => {
    const lines = paragraph.split(/\r?\n/);
    if (lines.length <= 1) return paragraph.trim();

    let result = lines[0].trimEnd();
    for (let i = 1; i < lines.length; i++) {
      const prevLine = result.trimEnd();
      const currentLine = lines[i].trimStart();

      if (!currentLine) continue;

      const lastChar = prevLine.slice(-1);
      const endsWithPunctuation = [".", "!", "?", ":"].includes(lastChar);
      const startsWithLowercase = /^[a-zà-ÿ0-9]/.test(currentLine);

      if (!endsWithPunctuation && startsWithLowercase) {
        result = `${result} ${currentLine}`;
      } else {
        result = `${result}\n${currentLine}`;
      }
    }
    return result;
  });

  return cleanedParagraphs.filter(Boolean).join("\n\n");
}
