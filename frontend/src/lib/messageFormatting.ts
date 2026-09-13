/**
 * Normaliza quebras de linha para renderização das bolhas de mensagem:
 * - \n DUPLO (linha em branco) = parágrafo -> PRESERVA
 * - \n SIMPLES no meio de frase = artefato de quebra rígida (~60 colunas) -> converte em espaço
 *   (Critério: a linha anterior não termina em pontuação final [. ! ? :] E a próxima linha começa em minúscula)
 * - nos demais casos, preserva a quebra.
 *
 * Não altera o dado gravado no banco, é puramente para apresentação visual fluida.
 */
export function normalizeMessageText(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "";

  // Divide por quebras de parágrafo (\n\n) para isolar blocos lógicos
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

/**
 * Formata o totalizador do cabeçalho da lista de conversas do Inbox:
 * - Se total > loaded: "Mostrando 40 de 458"
 * - Se total <= loaded: "15 conversas" ou "1 conversa" ou "0 conversas"
 */
export function formatHeaderCount(loaded: number, total: number): string {
  const safeLoaded = Math.max(0, loaded || 0);
  const safeTotal = Math.max(0, total || 0);
  if (safeTotal > safeLoaded) {
    return `Mostrando ${safeLoaded} de ${safeTotal}`;
  }
  return `${safeLoaded} conversa${safeLoaded === 1 ? "" : "s"}`;
}

export interface DossierSummaryResult {
  objetivo: string | null;
  situacao: string | null;
  combinado: string | null;
  proximoPasso: string | null;
  missing: string[];
  isPersonal: boolean;
  personalText: string;
}

/**
 * Parser de resumo da IA do Dossiê Lateral (WhatsApp Inbox):
 * Reconhece os 4 marcadores padronizados (🎯, 📋, 🤝, ⏭️) gerados por chatInsight.js,
 * a saída de escape de conversa pessoal (🚫) e trata "nada ainda" como vazio.
 */
export function parseDossierSummary(
  summary: string | null,
  lead?: {
    objetivo?: string | null;
    interesse?: string | null;
    cidade?: string | null;
    estado?: string | null;
    tipo_cliente?: string | null;
    dados?: any;
  } | null
): DossierSummaryResult {
  let objetivo: string | null = null;
  let situacao: string | null = null;
  let combinado: string | null = null;
  let proximoPasso: string | null = null;

  let isPersonal = false;
  let personalText = "";

  const isNadaAinda = (val: string | null | undefined) => {
    if (!val) return true;
    const clean = val.trim().toLowerCase();
    return (
      clean === "" ||
      clean === "nada ainda" ||
      clean === "nada ainda." ||
      clean === "null" ||
      clean === "undefined"
    );
  };

  if (summary) {
    const trimmed = summary.trim();
    if (/^🚫/u.test(trimmed)) {
      isPersonal = true;
      personalText = trimmed.replace(/^🚫\uFE0F?\s*/u, "").trim();
    } else {
      const lines = summary.split("\n");
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (/^🎯/u.test(line)) {
          const val = line.replace(/^🎯\uFE0F?\s*/u, "").trim();
          if (!isNadaAinda(val)) objetivo = val;
        } else if (/^📋/u.test(line)) {
          const val = line.replace(/^📋\uFE0F?\s*/u, "").trim();
          if (!isNadaAinda(val)) situacao = val;
        } else if (/^🤝/u.test(line)) {
          const val = line.replace(/^🤝\uFE0F?\s*/u, "").trim();
          if (!isNadaAinda(val)) combinado = val;
        } else if (/^⏭/u.test(line)) {
          const val = line.replace(/^⏭\uFE0F?\s*/u, "").trim();
          if (!isNadaAinda(val)) proximoPasso = val;
        }
      }
    }
  }

  // Fallback nos dados do lead para o que não veio no resumo da IA
  if (!objetivo) {
    const leadObj = lead?.objetivo || lead?.interesse || null;
    if (!isNadaAinda(leadObj)) objetivo = leadObj;
  }
  if (!situacao) {
    const leadSit = [lead?.cidade, lead?.estado].filter(Boolean).join(" - ") || lead?.tipo_cliente || null;
    if (!isNadaAinda(leadSit)) situacao = leadSit;
  }
  if (!combinado) {
    const leadComb = (lead?.dados as any)?.combinado || (lead?.dados as any)?.acordo || null;
    if (!isNadaAinda(leadComb)) combinado = leadComb;
  }
  if (!proximoPasso) {
    const leadProx = (lead?.dados as any)?.proximo_passo || (lead?.dados as any)?.proxima_acao || null;
    if (!isNadaAinda(leadProx)) proximoPasso = leadProx;
  }

  const missing: string[] = [];
  if (!objetivo) missing.push("Objetivo");
  if (!situacao) missing.push("Situação");
  if (!combinado) missing.push("Combinado");
  if (!proximoPasso) missing.push("Próximo passo");

  return { objetivo, situacao, combinado, proximoPasso, missing, isPersonal, personalText };
}

