// Ponte Proposta -> Contrato.
//
// Quando o cliente aceita a proposta, tudo que já foi negociado (escopo, valores,
// período, forma de pagamento, carência) deve cair pronto no contrato — sem o
// vendedor redigitar. Este módulo só TRADUZ dados já calculados; não recalcula
// nada nem altera a proposta.
import { calculateProposalValues } from "./proposalCalculator";

// yyyy-mm-dd para <input type="date">.
function toDateInput(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function buildContractInitialData(proposal: any, availablePackages: any[] = []): Record<string, string> {
  const calc = calculateProposalValues(proposal, availablePackages);

  const itens = Array.isArray(proposal?.itens) ? proposal.itens : [];
  // Escopo (Cláusula Segunda): itens inclusos entram sem valor, para não poluir.
  const produtos = itens
    .map((i: any) => {
      const valor = Number(i.valor || 0);
      return valor > 0
        ? `- ${i.descricao} (R$ ${valor.toLocaleString("pt-BR")})`
        : `- ${i.descricao}`;
    })
    .join("\n");

  const mensalidade = Number(calc.mensalidadeFinal || 0);
  const vp = Number(proposal?.valor_vp || 0);

  // Forma de pagamento: VP cobrindo tudo = permuta; VP parcial = misto.
  let forma_pagamento = "dinheiro";
  if (vp > 0) forma_pagamento = vp >= mensalidade ? "permuta" : "misto";

  // 1º vencimento respeita a carência acordada na mesa.
  const carencia = Number(proposal?.carencia_dias || 0);
  const primeiroVenc = new Date();
  if (carencia > 0) primeiroVenc.setDate(primeiroVenc.getDate() + carencia);

  const meses = Number(calc.mesesPeriodo || 1);

  return {
    razao_social: proposal?.prospect_name || "",
    produtos,
    condicoes_pagamento: proposal?.condicoes_pagamento?.escolhida?.nome || "",
    // Cláusula Quinta — preço estruturado
    forma_pagamento,
    num_parcelas: String(meses > 0 ? meses : 1),
    valor_parcela: mensalidade > 0 ? String(mensalidade) : "",
    data_primeiro_venc: toDateInput(primeiroVenc),
    // Cláusula Sexta — prazo derivado do período contratado
    prazo_dias: String((meses > 0 ? meses : 1) * 30),
  };
}
