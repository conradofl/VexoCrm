export function buildSignatureBlock(data: Record<string, any>): string {
  const contratada = data.assinatura_contratada || "CAIO VINÍCIUS ALMEIDA DE OLIVEIRA";
  const contratante = data.assinatura_contratante || data.razao_social || "Razão Social";
  const nLinhas = Math.max(1, Number(data.espaco_assinatura || 4));
  const espaco = "\n".repeat(nLinhas);
  return `\n\n____________________________________________________\nContratada: ${contratada}${espaco}\n____________________________________________________\nContratante: ${contratante}`;
}

export function applyContractMerge(template: string, data: Record<string, string>): string {
  if (!template) return "";
  
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    result = result.replace(regex, value || "");
  }

  // Se o template não possui o bloco de assinaturas, anexa as assinaturas dinâmicas
  const jaPossuiAssinaturas = /Contratada:\s*.*?\n.*?Contratante:/is.test(result) || result.includes("________________");
  if (!jaPossuiAssinaturas) {
    result += buildSignatureBlock(data);
  }

  return result;
}

const FORMA_PAGAMENTO_TEXTO: Record<string, string> = {
  permuta: "100% permutado na troca de serviços",
  dinheiro: "em moeda corrente (dinheiro)",
  misto: "parte em dinheiro e parte em permuta",
};

// Monta o cronograma de vencimentos (Cláusula Quarta) a partir dos campos
// estruturados: nº de parcelas, valor por parcela e data do 1º vencimento
// (mensal). Ex: "1º Pagamento — Data 09/07/2026 — Valor: R$ 3.500,00".
export function buildCronograma(numParcelas: number, valorParcela: number, dataPrimeiroVenc: string): string {
  const n = Math.max(0, Math.floor(Number(numParcelas) || 0));
  const valor = Number(valorParcela) || 0;
  if (n <= 0) return "";
  const base = dataPrimeiroVenc ? new Date(`${dataPrimeiroVenc}T12:00:00`) : null;
  const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const linhas: string[] = [];
  for (let i = 0; i < n; i++) {
    let dataStr = "a combinar";
    if (base && !isNaN(base.getTime())) {
      const d = new Date(base);
      d.setMonth(d.getMonth() + i);
      dataStr = d.toLocaleDateString("pt-BR");
    }
    linhas.push(`${i + 1}º Pagamento — Data ${dataStr} — Valor: ${brl(valor)}`);
  }
  return linhas.join("\n");
}

// Enriquisce o formData com os campos derivados usados no template
// (forma_pagamento por extenso, cronograma e assinaturas). Usado no preview e ao gerar.
export function buildContractDados(formData: Record<string, any>): Record<string, string> {
  const forma = FORMA_PAGAMENTO_TEXTO[String(formData.forma_pagamento || "")] || String(formData.forma_pagamento || "conforme condições da proposta");
  const cronograma = buildCronograma(formData.num_parcelas, formData.valor_parcela, formData.data_primeiro_venc);
  const contratada = String(formData.assinatura_contratada || "CAIO VINÍCIUS ALMEIDA DE OLIVEIRA").trim() || "CAIO VINÍCIUS ALMEIDA DE OLIVEIRA";
  const contratante = String(formData.assinatura_contratante || formData.razao_social || "Razão Social").trim() || "Razão Social";
  const espacoAssinatura = String(formData.espaco_assinatura || "4");

  const result: Record<string, any> = {
    ...formData,
    forma_pagamento: forma,
    cronograma_pagamento: cronograma || String(formData.condicoes_pagamento || "Conforme condições da proposta comercial aceita."),
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

