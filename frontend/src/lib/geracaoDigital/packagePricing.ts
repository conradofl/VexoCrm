// Cálculo de preço de pacote por período (GD).
// Regra: o valor digitado é o TOTAL DO PERÍODO contratado; a mensalidade é derivada.
// "unico" não é recorrente (valor único, sem divisão). Período nulo/desconhecido = mensal.

export const PERIOD_MONTHS: Record<string, number> = {
  mensal: 1,
  trimestral: 3,
  semestral: 6,
  anual: 12,
};

export const PERIOD_LABELS: Record<string, string> = {
  mensal: "Mensal",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  unico: "Setup Único",
};

// null = valor único (sem recorrência)
export function monthsForPeriod(periodo?: string | null): number | null {
  const key = String(periodo || "mensal").trim().toLowerCase();
  if (key === "unico") return null;
  return PERIOD_MONTHS[key] ?? 1;
}

export interface PackagePricing {
  meses: number | null;          // null = valor único
  totalPeriodo: number;
  mensalidade: number | null;    // arredondada a 2 casas; null quando único
  aprox: boolean;                // true quando mensalidade*meses não fecha exato com o total
  valorTabela: number | null;    // preço cheio, se informado e maior que o total
  descontoPct: number | null;    // % de desconto sobre a tabela
}

export function computePackagePricing(
  valor: number | string | null | undefined,
  periodo?: string | null,
  valorTabela?: number | string | null
): PackagePricing {
  const total = Number(valor || 0);
  const meses = monthsForPeriod(periodo);
  const mensalidade = meses ? Math.round((total / meses) * 100) / 100 : null;
  const aprox = meses !== null && mensalidade !== null
    ? Math.round(mensalidade * meses * 100) !== Math.round(total * 100)
    : false;
  const tabela = Number(valorTabela || 0);
  const temTabela = tabela > total && total > 0;
  return {
    meses,
    totalPeriodo: total,
    mensalidade,
    aprox,
    valorTabela: temTabela ? tabela : null,
    descontoPct: temTabela ? Math.round((1 - total / tabela) * 100) : null,
  };
}

export const brlPkg = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
