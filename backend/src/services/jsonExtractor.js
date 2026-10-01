import { findUnresolvedPlaceholders } from "./messagePlaceholders.js";
export { findUnresolvedPlaceholders };

export const INTERNAL_CONTRACT_KEYS = [
  "status_conversa",
  "lead_source",
  "spin_fase",
  "resumo_chat",
  "classificacao",
  "finalizado",
  "origem_marketing",
  "contratoQuebrado",
  "lead_temperature",
  "temperatura",
];

export const REASONING_TAGS = [
  "<think",
  "</think",
  "<thinking",
  "</thinking",
  "<thought",
  "</thought",
  "<reflection",
  "</reflection",
];

export const REASONING_MARKERS = [
  "thinking process",
  "here's a thinking",
  "here is a thinking",
  "let me analyze",
  "let me think",
  "let me craft",
  "let's analyze",
  "let's check the json",
  "**analyze",
  "**thinking",
  "**plan",
  "refining for arthur",
  "refining for",
  "final polish:",
  "final polish",
  "draft:",
  "draft :",
  "plan:",
  "classification:",
  "this looks like a copy-paste",
  "my instructions say to act as",
  "the user keeps sending",
  "i need to address the fact",
  "i must maintain the persona",
  "previous attempts to ask",
  "let's stick to the rule",
];

export const ENGLISH_REASONING_PATTERNS = [
  /\bthe user\b/i,
  /\bthis looks like\b/i,
  /\bhowever, my instructions\b/i,
  /\bprevious attempts\b/i,
  /\bi will try to\b/i,
  /\bi need to\b/i,
  /\bi must maintain\b/i,
  /\blet's check\b/i,
  /\buser input is identical\b/i,
  /\bhere's a\b/i,
];

export const MAX_OUTBOUND_MESSAGE_LENGTH = 1500;

/**
 * Guarda de saída obrigatória: valida se o texto é seguro para envio no WhatsApp.
 * Recusa se começar com { ou [, se contiver ```, chaves internas do contrato,
 * tags/marcadores de raciocínio de LLM (<think>), tamanho excessivo (>1500 chars)
 * ou dump de raciocínio em inglês.
 */
export function validateOutboundMessage(text) {
  if (text === null || text === undefined) {
    return { valid: false, reason: "empty_null" };
  }

  const str = String(text);
  const trimmed = str.trim();
  if (!trimmed) {
    return { valid: false, reason: "empty_text" };
  }

  // Teto de tamanho para mensagens de WhatsApp
  if (trimmed.length > MAX_OUTBOUND_MESSAGE_LENGTH) {
    return { valid: false, reason: "message_exceeds_max_length" };
  }

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return { valid: false, reason: "starts_with_json_bracket" };
  }

  if (trimmed.includes("```")) {
    return { valid: false, reason: "contains_markdown_code_block" };
  }

  // Guarda estrita de variáveis: impede envio de templates com {{...}} ou tags não substituídas ao lead
  const unresolvedVars = findUnresolvedPlaceholders(trimmed);
  if (unresolvedVars.length > 0) {
    const varName = unresolvedVars[0];
    return { valid: false, reason: `contains_unresolved_variable:${varName}`, variable: varName, variables: unresolvedVars };
  }
  if (trimmed.includes("{{") || trimmed.includes("}}")) {
    return { valid: false, reason: "contains_unresolved_variable" };
  }

  // 1. Tags de raciocínio de modelo (DeepSeek/Qwen/etc.)
  const lower = trimmed.toLowerCase();
  for (const tag of REASONING_TAGS) {
    if (lower.includes(tag)) {
      return { valid: false, reason: `contains_reasoning_tag:${tag}` };
    }
  }

  // 2. Marcadores textuais de raciocínio do modelo
  for (const marker of REASONING_MARKERS) {
    if (lower.includes(marker)) {
      return { valid: false, reason: `contains_reasoning_marker:${marker}` };
    }
  }

  // 3. Raciocínio em inglês vazado em fluxo pt-BR
  let englishPatternMatches = 0;
  for (const pattern of ENGLISH_REASONING_PATTERNS) {
    if (pattern.test(trimmed)) {
      englishPatternMatches++;
    }
  }
  if (englishPatternMatches >= 2) {
    return { valid: false, reason: "contains_foreign_reasoning_dump" };
  }

  // 4. Verifica chaves internas do contrato
  for (const key of INTERNAL_CONTRACT_KEYS) {
    if (lower.includes(key.toLowerCase())) {
      return { valid: false, reason: `contains_internal_contract_key:${key}` };
    }
  }

  // 5. Verifica chaves de JSON serializado
  if (lower.includes('"mensagem"') || lower.includes('"dados"') || lower.includes('"message"')) {
    return { valid: false, reason: "contains_json_key_structure" };
  }

  return { valid: true, reason: null };
}

/**
 * Remove blocos de raciocínio de LLMs (<think>...</think>, <thinking>...</thinking>, etc.)
 * Trata tags fechadas e não-fechadas no início da resposta.
 */
export function stripReasoningBlocks(raw) {
  if (raw === null || raw === undefined) return "";
  let text = String(raw).trim();
  if (
    text.includes("<think") ||
    text.includes("<thinking") ||
    text.includes("<thought") ||
    text.includes("<reflection")
  ) {
    text = text.replace(/<(?:think|thinking|thought|reflection)>[\s\S]*?(?:<\/(?:think|thinking|thought|reflection)>|$)/gi, "").trim();
  }
  return text;
}

/**
 * Extrator de JSON multi-estágio resiliente para saídas de LLM.
 * Suporta remoção de tags de raciocínio (<think>), markdown, aspas tipográficas,
 * vírgulas residuais, comentários JS e quebras de linha literais em strings.
 */
export function extractJsonFromLlmText(raw) {
  if (raw === null || raw === undefined) {
    const error = new Error("A IA da Groq retornou uma resposta vazia.");
    error.statusCode = 502;
    error.code = "GROQ_EMPTY_RESPONSE";
    throw error;
  }

  if (typeof raw === "object") {
    return raw;
  }

  let text = String(raw).trim();
  if (!text) {
    const error = new Error("A IA da Groq retornou uma resposta vazia.");
    error.statusCode = 502;
    error.code = "GROQ_EMPTY_RESPONSE";
    throw error;
  }

  // 1. Remove blocos <think> ... </think> ou <thinking> ... </thinking> emitidos por modelos de raciocínio
  text = stripReasoningBlocks(text);

  // 2. Extrai conteúdo dentro de cercas de markdown ```json ... ``` ou ``` ... ```
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  // 3. Tenta parse direto
  try {
    const res = JSON.parse(text);
    if (res && typeof res === "object") {
      if (Array.isArray(res)) return { variants: res, rationale: "Variações geradas pela IA" };
      return res;
    }
  } catch {}

  // 4. Se falhar, busca o bloco mais externo { ... } ou [ ... ]
  const objectMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (objectMatch) {
    text = objectMatch[1].trim();
  }

  // 5. Sanitizações comuns de LLMs
  let sanitized = text
    // Aspas tipográficas / curvas
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    // Comentários JS de linha única ou bloco
    .replace(/\/\/[^\n\r]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // Vírgula residual antes de fechamento de array ou objeto
    .replace(/,\s*([\]\}])/g, "$1");

  try {
    const res = JSON.parse(sanitized);
    if (res && typeof res === "object") {
      if (Array.isArray(res)) return { variants: res, rationale: "Variações geradas pela IA" };
      return res;
    }
  } catch {}

  // 6. Normaliza quebras de linha literais dentro de strings JSON
  try {
    const escapedNewlines = sanitized.replace(/"([^"\\]*(?:\\.[^"\\]*)*)"/gs, (match) => {
      return match.replace(/\r?\n/g, "\\n");
    });
    const res = JSON.parse(escapedNewlines);
    if (res && typeof res === "object") {
      if (Array.isArray(res)) return { variants: res, rationale: "Variações geradas pela IA" };
      return res;
    }
  } catch {}

  // 7. Extração cirúrgica de variants (para gerador de campanhas)
  const variantsArrayMatch = text.match(/"(?:variants|variacoes|variations|mensagens|messages|items)"\s*:\s*\[([\s\S]*?)\]/i);
  if (variantsArrayMatch) {
    const inner = variantsArrayMatch[1];
    const itemMatches = [...inner.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)];
    const extracted = itemMatches
      .map((m) => {
        try {
          return JSON.parse(`"${m[1]}"`);
        } catch {
          return m[1].replace(/\\"/g, '"');
        }
      })
      .filter(Boolean);

    if (extracted.length > 0) {
      const rationaleMatch = text.match(/"(?:rationale|explicacao|motivo)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
      const rationale = rationaleMatch ? rationaleMatch[1] : "Variações geradas pela IA";
      return { variants: extracted, rationale };
    }
  }

  // 8. Extração cirúrgica de mensagem (para chatbot)
  const mensagemMatch = text.match(/"(?:mensagem|message|resposta)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"/i);
  if (mensagemMatch) {
    let unescapedMsg = "";
    try {
      unescapedMsg = JSON.parse(`"${mensagemMatch[1]}"`);
    } catch {
      unescapedMsg = mensagemMatch[1].replace(/\\"/g, '"').replace(/\\n/g, "\n");
    }
    if (unescapedMsg && typeof unescapedMsg === "string") {
      return {
        mensagem: unescapedMsg,
        status_conversa: "aguardando_usuario",
        dados: {},
        classificacao: null,
        finalizado: false,
        spin_fase: null,
      };
    }
  }

  const error = new Error("A IA da Groq retornou um formato JSON inválido.");
  error.statusCode = 502;
  error.code = "GROQ_INVALID_JSON";
  error.rawText = raw;
  throw error;
}
