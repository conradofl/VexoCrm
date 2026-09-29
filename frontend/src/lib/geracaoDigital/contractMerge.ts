export function buildSignatureBlock(data: Record<string, any>): string {
  const contratada = data.assinatura_contratada || "";
  const contratante = data.assinatura_contratante || data.razao_social || "";
  const nLinhas = Math.max(1, Number(data.espaco_assinatura || 4));
  const espaco = "\n".repeat(nLinhas);
  return `\n\n____________________________________________________\nContratada: ${contratada}${espaco}\n____________________________________________________\nContratante: ${contratante}`;
}

export const CONTRACT_FILL_LINE = "______________________________";

export function applyContractMerge(template: string, data: Record<string, any>): string {
  if (!template) return "";
  
  let result = template;
  for (const [key, value] of Object.entries(data || {})) {
    if (value != null && typeof value === "object") continue;
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    const val = value != null ? String(value).trim() : "";
    result = result.replace(regex, val || CONTRACT_FILL_LINE);
  }

  // Varre qualquer {{marcador}} restante que não foi preenchido e troca por linha de preenchimento
  result = result.replace(/\{\{[^}]+\}\}/g, CONTRACT_FILL_LINE);

  // Se o template não possui o bloco de assinaturas, anexa as assinaturas dinâmicas
  const jaPossuiAssinaturas = /Contratada:\s*.*?\n.*?Contratante:/is.test(result) || result.includes("________________");
  if (!jaPossuiAssinaturas) {
    result += buildSignatureBlock(data || {});
  }

  return result;
}

const FORMA_PAGAMENTO_TEXTO: Record<string, string> = {
  permuta: "100% permutado na troca de serviços",
  dinheiro: "em moeda corrente (dinheiro)",
  misto: "parte em dinheiro e parte em permuta",
};

export type FormaPagamentoParcela = "dinheiro" | "pix" | "boleto" | "cartao" | "permuta" | "misto";

export interface ContractParcela {
  id: string;               // Identificador único temporário ou uuid
  numero: number;           // 1, 2, 3...
  data: string;             // YYYY-MM-DD ou "a combinar"
  valor: number;            // Valor numérico em reais (>= 0)
  tipo: FormaPagamentoParcela; // Meio de pagamento
  observacao?: string;      // Observações (ex: "Sinal na assinatura", "Permuta de serviços")
}

export type PeriodicidadeParcela = "mensal" | "quinzenal" | "semanal" | "livre";

export interface ScheduleTotals {
  totalGeral: number;
  totalDinheiro: number;
  totalPermuta: number;
  numParcelas: number;
}

export function formatBrl(val: number): string {
  return Number(val || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" }).replace(/\s/g, " ");
}

export function formatScheduleDateDisplay(dateStr: string): string {
  if (!dateStr || dateStr === "a combinar") return "a combinar";
  const [yyyy, mm, dd] = String(dateStr).split("-");
  if (yyyy && mm && dd) return `${dd}/${mm}/${yyyy}`;
  return String(dateStr);
}

export function formatTipoParcelaLabel(tipo: FormaPagamentoParcela): string {
  const map: Record<FormaPagamentoParcela, string> = {
    dinheiro: "Dinheiro",
    pix: "PIX",
    boleto: "Boleto",
    cartao: "Cartão",
    permuta: "Permuta",
    misto: "Misto (Dinheiro + Permuta)",
  };
  return map[tipo] || tipo;
}

export function generateScheduleInstallments({
  numParcelas,
  valorTotal,
  valorPorParcela,
  dataPrimeiroVenc,
  periodicidade = "mensal",
  tipoPadrao = "dinheiro",
  observacaoPadrao = "",
}: {
  numParcelas: number;
  valorTotal?: number;
  valorPorParcela?: number;
  dataPrimeiroVenc: string;
  periodicidade?: PeriodicidadeParcela;
  tipoPadrao?: FormaPagamentoParcela;
  observacaoPadrao?: string;
}): ContractParcela[] {
  const n = Math.max(1, Math.floor(Number(numParcelas) || 1));
  const valor = valorPorParcela !== undefined && Number(valorPorParcela) > 0
    ? Number(valorPorParcela)
    : (Number(valorTotal || 0) / n);
  const baseDate = dataPrimeiroVenc ? new Date(`${dataPrimeiroVenc}T12:00:00`) : null;
  const parcelas: ContractParcela[] = [];
  for (let i = 0; i < n; i++) {
    let dataStr = "";
    if (baseDate && !isNaN(baseDate.getTime())) {
      const d = new Date(baseDate);
      if (periodicidade === "semanal") {
        d.setDate(d.getDate() + (i * 7));
      } else if (periodicidade === "quinzenal") {
        d.setDate(d.getDate() + (i * 15));
      } else if (periodicidade === "mensal") {
        d.setMonth(d.getMonth() + i);
      }
      dataStr = d.toISOString().slice(0, 10);
    }
    parcelas.push({
      id: `parcela-${i + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      numero: i + 1,
      data: dataStr || dataPrimeiroVenc || "",
      valor: Math.round(valor * 100) / 100,
      tipo: tipoPadrao,
      observacao: i === 0 && !observacaoPadrao ? "Entrada na assinatura" : (observacaoPadrao || ""),
    });
  }
  return parcelas;
}

export function calculateScheduleTotals(parcelas: ContractParcela[]): ScheduleTotals {
  let totalGeral = 0;
  let totalDinheiro = 0;
  let totalPermuta = 0;
  for (const p of parcelas || []) {
    const val = Number(p.valor) || 0;
    totalGeral += val;
    if (p.tipo === "permuta") {
      totalPermuta += val;
    } else if (p.tipo === "misto") {
      totalDinheiro += val / 2;
      totalPermuta += val / 2;
    } else {
      totalDinheiro += val;
    }
  }
  return {
    totalGeral: Math.round(totalGeral * 100) / 100,
    totalDinheiro: Math.round(totalDinheiro * 100) / 100,
    totalPermuta: Math.round(totalPermuta * 100) / 100,
    numParcelas: (parcelas || []).length,
  };
}

export function buildCronograma(
  numParcelasOrList: number | ContractParcela[],
  valorParcela?: number,
  dataPrimeiroVenc?: string
): string {
  // Caso 1: Array de parcelas estruturadas (Peça 4)
  if (Array.isArray(numParcelasOrList)) {
    const parcelas = numParcelasOrList;
    if (parcelas.length === 0) return "";
    const linhas = parcelas.map((p, idx) => {
      const numOrdinal = `${idx + 1}ª Parcela`;
      const dataFmt = formatScheduleDateDisplay(p.data);
      const valorFmt = formatBrl(p.valor);
      const tipoFmt = formatTipoParcelaLabel(p.tipo);
      const obsFmt = p.observacao && p.observacao.trim() ? ` — Obs: ${p.observacao.trim()}` : "";
      return `${numOrdinal} — Vencimento: ${dataFmt} — Valor: ${valorFmt} (${tipoFmt})${obsFmt}`;
    });
    const totals = calculateScheduleTotals(parcelas);
    const resumoLinha = `Total do Contrato: ${formatBrl(totals.totalGeral)} (Em Moeda: ${formatBrl(totals.totalDinheiro)} | Em Permuta: ${formatBrl(totals.totalPermuta)})`;
    return `${linhas.join("\n")}\n\n${resumoLinha}`;
  }

  // Caso 2: Modo legado (numParcelas, valorParcela, dataPrimeiroVenc)
  const n = Math.max(0, Math.floor(Number(numParcelasOrList) || 0));
  const valor = Number(valorParcela) || 0;
  if (n <= 0) return "";
  const base = dataPrimeiroVenc ? new Date(`${dataPrimeiroVenc}T12:00:00`) : null;
  const linhas: string[] = [];
  for (let i = 0; i < n; i++) {
    let dataStr = "a combinar";
    if (base && !isNaN(base.getTime())) {
      const d = new Date(base);
      d.setMonth(d.getMonth() + i);
      dataStr = d.toLocaleDateString("pt-BR");
    }
    linhas.push(`${i + 1}ª Parcela — Data: ${dataStr} — Valor: ${formatBrl(valor)}`);
  }
  return linhas.join("\n");
}

// Enriquece o formData com os campos derivados usados no template
// (forma_pagamento por extenso, cronograma e assinaturas). Usado no preview e ao gerar.
export function buildContractDados(formData: Record<string, any>): Record<string, any> {
  const forma = FORMA_PAGAMENTO_TEXTO[String(formData.forma_pagamento || "")] || String(formData.forma_pagamento || "conforme condições da proposta");
  const cronograma = Array.isArray(formData.parcelas) && formData.parcelas.length > 0
    ? buildCronograma(formData.parcelas)
    : buildCronograma(formData.num_parcelas, formData.valor_parcela, formData.data_primeiro_venc);
  const contratada = String(formData.assinatura_contratada || "").trim();
  const contratante = String(formData.assinatura_contratante || formData.razao_social || "").trim();
  const espacoAssinatura = String(formData.espaco_assinatura || "4");
  const comarca = String(formData.contratada_comarca || formData.foro_cidade || "").trim();

  const result: Record<string, any> = {
    ...formData,
    forma_pagamento: forma,
    cronograma_pagamento: cronograma || String(formData.condicoes_pagamento || "Conforme condições da proposta comercial aceita."),
    parcelas: Array.isArray(formData.parcelas) ? formData.parcelas : undefined,
    contratada_razao_social: String(formData.contratada_razao_social || "").trim(),
    contratada_cnpj: String(formData.contratada_cnpj || "").trim(),
    contratada_representante: String(formData.contratada_representante || "").trim(),
    contratada_endereco: String(formData.contratada_endereco || "").trim(),
    contratada_telefone: String(formData.contratada_telefone || "").trim(),
    contratada_email: String(formData.contratada_email || "").trim(),
    contratada_comarca: comarca,
    foro_cidade: comarca,
    assinatura_contratada: contratada,
    assinatura_contratante: contratante,
    espaco_assinatura: espacoAssinatura,
  };
  if (formData.texto_final && typeof formData.texto_final === "string" && formData.texto_final.trim()) {
    result.texto_final = formData.texto_final;
  } else {
    delete result.texto_final;
  }
  return result;
}

/**
 * Localiza o espaçamento entre a assinatura da Contratada e da Contratante
 * e insere quebras de linha adicionais.
 */
export function expandSignatureSpacingInText(text: string, additionalLines = 2): string {
  const extra = "\n".repeat(additionalLines);
  const regex = /(Contratada:[^\n]*\n)([\s\n]*)(_{10,})/i;
  if (regex.test(text)) {
    return text.replace(regex, (match, p1, p2, p3) => `${p1}${p2}${extra}${p3}`);
  }
  const regexUnderline = /(_{10,}[\s\S]*?Contratante:)/i;
  if (regexUnderline.test(text)) {
    return text.replace(regexUnderline, `${extra}$1`);
  }
  return text + extra;
}

export function formatExtenseDateClient(): string {
  const months = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const date = new Date();
  return `${date.getDate()} de ${months[date.getMonth()]} de ${date.getFullYear()}`;
}

/**
 * Envolve ou desenvolve seleção com sintaxe Markdown de negrito (****).
 */
export function toggleBoldMarkdown(text: string, start: number, end: number): { text: string; newStart: number; newEnd: number } {
  if (start === end) {
    const before = text.slice(0, start);
    const after = text.slice(start);
    return {
      text: `${before}****${after}`,
      newStart: start + 2,
      newEnd: start + 2,
    };
  }

  const selected = text.slice(start, end);

  // Se o próprio texto selecionado já contém ** no início e fim
  if (selected.startsWith("**") && selected.endsWith("**") && selected.length >= 4) {
    const unwrapped = selected.slice(2, -2);
    const newText = text.slice(0, start) + unwrapped + text.slice(end);
    return {
      text: newText,
      newStart: start,
      newEnd: start + unwrapped.length,
    };
  }

  // Se os caracteres vizinhos externos já são **
  if (start >= 2 && text.slice(start - 2, start) === "**" && text.slice(end, end + 2) === "**") {
    const newText = text.slice(0, start - 2) + selected + text.slice(end + 2);
    return {
      text: newText,
      newStart: start - 2,
      newEnd: start - 2 + selected.length,
    };
  }

  const wrapped = `**${selected}**`;
  const newText = text.slice(0, start) + wrapped + text.slice(end);
  return {
    text: newText,
    newStart: start,
    newEnd: start + wrapped.length,
  };
}

export interface ContractClauseBlock {
  id: string;            // Identificador único (ex: "partes", "objeto", "plataforma", "obrigacoes", "preco", "prazo", "foro", ou uuid)
  titulo: string;        // Título temático da cláusula (ex: "Das Partes", "Dos Objetos", "Da Plataforma Vexo OS", "Das Obrigações das Partes", "Do Preço e Condições", "Do Prazo", "Do Foro")
  conteudo: string;      // Corpo do texto da cláusula com seus marcadores {{marcador}}
  ativo: boolean;        // Se está incluída no contrato
  obrigatorio?: boolean; // Opcional: protege cláusulas fundamentais (ex: "Das Partes")
}

export const ORDINAIS_EXTENSO = [
  "", "Primeira", "Segunda", "Terceira", "Quarta", "Quinta",
  "Sexta", "Sétima", "Oitava", "Nona", "Décima",
  "Décima Primeira", "Décima Segunda", "Décima Terceira", "Décima Quarta", "Décima Quinta",
  "Décima Sexta", "Décima Sétima", "Décima Oitava", "Décima Nona", "Vigésima",
  "Vigésima Primeira", "Vigésima Segunda", "Vigésima Terceira", "Vigésima Quarta", "Vigésima Quinta",
  "Vigésima Sexta", "Vigésima Sétima", "Vigésima Oitava", "Vigésima Nona", "Trigésima"
];

export function toExtenseOrdinal(index: number): string {
  const n = Math.floor(Number(index) || 0);
  return ORDINAIS_EXTENSO[n] || `${n}ª`;
}

export function assembleContractFromBlocks({
  tituloPrincipal,
  clausulas = [],
  fechamento,
}: {
  tituloPrincipal?: string;
  clausulas: ContractClauseBlock[];
  fechamento?: string;
}): string {
  const activeClauses = (clausulas || []).filter((c) => c && c.ativo !== false);

  const assembledClauses = activeClauses.map((c, idx) => {
    const ordinal = toExtenseOrdinal(idx + 1);
    const cleanTitle = (c.titulo || "")
      .replace(/^Cláusula\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9ºª\s]+?)\s*[–\-:]\s*/i, "")
      .trim();
    const header = `Cláusula ${ordinal} – ${cleanTitle}`;
    const body = (c.conteudo || "").trim();
    return body ? `${header}\n${body}` : header;
  });

  const parts: string[] = [];
  if (tituloPrincipal && tituloPrincipal.trim()) {
    parts.push(tituloPrincipal.trim());
  }
  if (assembledClauses.length > 0) {
    parts.push(assembledClauses.join("\n\n"));
  }
  if (fechamento && fechamento.trim()) {
    parts.push(fechamento.trim());
  }
  return parts.join("\n\n");
}

export function parseTemplateContentToClauses(conteudo: string): {
  tituloPrincipal: string;
  clausulas: ContractClauseBlock[];
  fechamento: string;
} {
  if (!conteudo || typeof conteudo !== "string") {
    return { tituloPrincipal: "", clausulas: [], fechamento: "" };
  }

  const clauseRegex = /(?:^|\n)(?:Cláusula|CLAUSULA)\s+([A-Za-zÀ-ÖØ-öø-ÿ0-9ºª\s]+?)\s*[–\-:]\s*([^\n]+)/gi;
  const matches = [...conteudo.matchAll(clauseRegex)];

  if (matches.length === 0) {
    return {
      tituloPrincipal: "",
      clausulas: [
        {
          id: "conteudo-geral",
          titulo: "Conteúdo Geral",
          conteudo: conteudo.trim(),
          ativo: true,
          obrigatorio: true,
        },
      ],
      fechamento: "",
    };
  }

  const firstMatch = matches[0];
  const firstIndex = (firstMatch.index ?? 0) + (firstMatch[0].startsWith("\n") ? 1 : 0);
  const tituloPrincipal = conteudo.slice(0, firstIndex).trim();

  const fechamentoRegex = /(?:\n\n|\n)(E,?\s*por\s*estarem\s*assim[\s\S]*)$/i;
  const fechamentoMatch = conteudo.match(fechamentoRegex);
  let fechamento = "";
  let endOfClauses = conteudo.length;

  if (fechamentoMatch && fechamentoMatch.index !== undefined) {
    fechamento = fechamentoMatch[1].trim();
    endOfClauses = fechamentoMatch.index;
  }

  const clausulas: ContractClauseBlock[] = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const matchStart = (match.index ?? 0) + (match[0].startsWith("\n") ? 1 : 0);
    const headerLineEnd = matchStart + match[0].trim().length;

    let bodyEnd = endOfClauses;
    if (i + 1 < matches.length) {
      const nextMatch = matches[i + 1];
      bodyEnd = (nextMatch.index ?? 0) + (nextMatch[0].startsWith("\n") ? 1 : 0);
    }

    const rawTitle = (match[2] || "").trim();
    const clauseBody = conteudo.slice(headerLineEnd, bodyEnd).trim();

    const slug = rawTitle
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `clausula-${i + 1}`;

    const isPartes = /^(das\s+partes|partes|dos\s+contratantes)$/i.test(rawTitle.trim());

    clausulas.push({
      id: slug,
      titulo: rawTitle,
      conteudo: clauseBody,
      ativo: true,
      obrigatorio: isPartes,
    });
  }

  return {
    tituloPrincipal,
    clausulas,
    fechamento,
  };
}

export function extractPlaceholders(textOrClauses: string | ContractClauseBlock[]): string[] {
  const text = typeof textOrClauses === "string"
    ? textOrClauses
    : (textOrClauses || [])
        .filter((c) => c && c.ativo !== false)
        .map((c) => c.conteudo || "")
        .join("\n");

  const matches = text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g);
  const found = new Set<string>();
  for (const m of matches) {
    if (m[1]) found.add(m[1]);
  }
  return Array.from(found);
}

export const STANDARD_CONTRACT_FIELDS = new Set([
  // Contratante
  "razao_social",
  "cnpj",
  "telefone",
  "telefone2",
  "email",
  "representante",
  "endereco",
  // Objeto & Preço
  "produtos",
  "artes_mensais",
  "forma_pagamento",
  "num_parcelas",
  "valor_parcela",
  "data_primeiro_venc",
  "condicoes_pagamento",
  // Prazo, Foro & Assinatura
  "prazo_dias",
  "aviso_previo_dias",
  "vigencia",
  "foro_cidade",
  "cidade_assinatura",
  // Sistema / Calculados / Assinaturas / Cronograma
  "data_extenso",
  "cronograma_pagamento",
  "parcelas",
  "assinatura_contratada",
  "assinatura_contratante",
  "espaco_assinatura",
]);

export function isSystemOrStandardField(key: string): boolean {
  if (!key) return false;
  if (STANDARD_CONTRACT_FIELDS.has(key)) return true;
  if (key.startsWith("contratada_")) return true;
  return false;
}

export function extractDynamicPlaceholders(textOrClauses: string | ContractClauseBlock[]): string[] {
  const all = extractPlaceholders(textOrClauses);
  return all.filter((key) => !isSystemOrStandardField(key));
}

export function formatFieldLabel(key: string): string {
  if (!key) return "";
  return key
    .replace(/_/g, " ")
    .replace(/\b[a-zÀ-ÿ]/g, (letter) => letter.toUpperCase())
    .trim();
}


