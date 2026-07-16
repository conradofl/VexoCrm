export function applyContractMerge(template: string, data: Record<string, string>): string {
  if (!template) return "";
  
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    result = result.replace(regex, value || "");
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
// (forma_pagamento por extenso e cronograma). Usado no preview e ao gerar.
export function buildContractDados(formData: Record<string, any>): Record<string, string> {
  const forma = FORMA_PAGAMENTO_TEXTO[String(formData.forma_pagamento || "")] || String(formData.forma_pagamento || "conforme condições da proposta");
  const cronograma = buildCronograma(formData.num_parcelas, formData.valor_parcela, formData.data_primeiro_venc);
  return {
    ...formData,
    forma_pagamento: forma,
    cronograma_pagamento: cronograma || String(formData.condicoes_pagamento || "Conforme condições da proposta comercial aceita."),
  };
}

export function formatExtenseDateClient(): string {
  const months = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"
  ];
  const date = new Date();
  return `${date.getDate()} de ${months[date.getMonth()]} de ${date.getFullYear()}`;
}
