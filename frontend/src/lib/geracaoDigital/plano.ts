// ---------------------------------------------------------------------------
// PLANO = escopo × prazos.
//
// Antes: para oferecer trimestral/semestral/anual ao cliente, o vendedor criava
// TRÊS pacotes na biblioteca — mesmo escopo, nomes inventados para conseguir
// diferenciar ("Pacote O Anual", "Pacote P Anual"). Resultado real no banco:
// 29 pacotes GD que eram ~8 escopos, com duplicatas exatas e "- Cópia".
//
// Agora: um escopo (lista de serviços) e uma escada de preço por prazo. O
// vendedor preenche o preço dos prazos que quer ofertar; o cliente escolhe.
// Cada prazo preenchido continua virando uma linha `gd_packages` com
// `ad_hoc = true` e nome gerado — detalhe de implementação que ninguém vê nem
// nomeia. `gd_packages` deixa de ser biblioteca e vira linha de preço.
// ---------------------------------------------------------------------------

export const PERIODOS = [
  { key: "mensal", label: "Mensal", meses: 1 },
  { key: "trimestral", label: "Trimestral", meses: 3 },
  { key: "semestral", label: "Semestral", meses: 6 },
  { key: "anual", label: "Anual", meses: 12 },
] as const;

export type PeriodoKey = (typeof PERIODOS)[number]["key"];

export const mesesDoPeriodo = (p: string): number =>
  PERIODOS.find((x) => x.key === p)?.meses ?? 1;

export const labelDoPeriodo = (p: string): string =>
  PERIODOS.find((x) => x.key === p)?.label ?? p;

export interface Plano {
  /** ids de gd_products que compõem o escopo */
  gdIds: string[];
  /** ids de vexo_products que compõem o escopo */
  vexoIds: string[];
  /** R$/mês por prazo. 0 (ou ausente) = prazo não ofertado. */
  precos: Record<PeriodoKey, number>;
  /** preço cheio mensal, para exibir riscado. 0 = sem riscado. */
  valorTabelaMensal: number;
  /** % da mensalidade aceita em permuta, aplicada a TODOS os prazos. 0 = sem VP.
   * Antes era um valor fixo em R$ (vpMensal), que não fazia sentido com vários
   * prazos: 2.200 de VP num Anual de 2.400 e num Semestral de 6.000 é a mesma
   * cara mas outra proporção. Percentual escala junto com cada prazo. */
  vpPercent: number;
}

export const planoVazio = (): Plano => ({
  gdIds: [],
  vexoIds: [],
  precos: { mensal: 0, trimestral: 0, semestral: 0, anual: 0 },
  valorTabelaMensal: 0,
  vpPercent: 0,
});

/** VP mensal de um prazo, derivado do percentual. */
export function vpMensalDoPrazo(plano: Plano, periodo: PeriodoKey): number {
  const mensal = Number(plano.precos[periodo] || 0);
  return Math.round(mensal * (Number(plano.vpPercent || 0) / 100) * 100) / 100;
}

/** Prazos com preço preenchido — preencher É ofertar, sem checkbox separado. */
export function prazosOfertados(plano: Plano): PeriodoKey[] {
  return PERIODOS.map((p) => p.key).filter((k) => Number(plano.precos[k] || 0) > 0);
}

export function planoValido(plano: Plano): boolean {
  return (plano.gdIds.length + plano.vexoIds.length) > 0 && prazosOfertados(plano).length > 0;
}

/** Nome gerado da linha de preço. O vendedor nunca digita isso. */
export function nomeDaLinha(nomeBase: string, periodo: PeriodoKey): string {
  return `${(nomeBase || "Plano").trim()} · ${labelDoPeriodo(periodo)}`;
}

export interface ProdutoRef {
  product_id: string;
  nome: string;
  origem: "gd" | "vexo";
}

export function produtosDoPlano(
  plano: Plano,
  gdProducts: any[],
  vexoProducts: any[]
): ProdutoRef[] {
  const gd = (gdProducts || [])
    .filter((p) => plano.gdIds.includes(p.id))
    .map((p) => ({ product_id: p.id, nome: p.nome, origem: "gd" as const }));
  const vexo = (vexoProducts || [])
    .filter((p) => plano.vexoIds.includes(p.id))
    .map((p) => ({ product_id: p.id, nome: p.nome, origem: "vexo" as const }));
  return [...gd, ...vexo];
}

export interface PacotePayload {
  periodo: PeriodoKey;
  nome: string;
  tipo: "gd";
  valor: number;
  valor_tabela: number | null;
  valor_vp: number | null;
  produtos_incluidos: ProdutoRef[];
  ad_hoc: true;
}

/**
 * Uma linha de preço por prazo ofertado. `valor` é o total do PERÍODO —
 * convenção já usada por gd_packages e pelo proposalCalculator.
 */
export function planoParaPacotes(
  plano: Plano,
  nomeBase: string,
  gdProducts: any[],
  vexoProducts: any[]
): PacotePayload[] {
  const produtos = produtosDoPlano(plano, gdProducts, vexoProducts);
  return prazosOfertados(plano).map((periodo) => {
    const meses = mesesDoPeriodo(periodo);
    const mensal = Number(plano.precos[periodo] || 0);
    const tabela = Number(plano.valorTabelaMensal || 0);
    return {
      periodo,
      nome: nomeDaLinha(nomeBase, periodo),
      tipo: "gd",
      valor: Math.round(mensal * meses * 100) / 100,
      valor_tabela: tabela > mensal ? Math.round(tabela * meses * 100) / 100 : null,
      // VP do PERÍODO = % × mensalidade × meses. Escala com o prazo.
      valor_vp: plano.vpPercent > 0 ? Math.round(vpMensalDoPrazo(plano, periodo) * meses * 100) / 100 : null,
      produtos_incluidos: produtos,
      ad_hoc: true,
    };
  });
}

/**
 * Reconstrói o plano a partir das linhas de preço já gravadas (edição).
 * O escopo vem da primeira linha — todas compartilham o mesmo por construção.
 */
export function planoDePacotes(pacotes: any[]): Plano {
  const plano = planoVazio();
  const linhas = (pacotes || []).filter((p) => p && (p.tipo === "gd" || !p.tipo));
  if (linhas.length === 0) return plano;

  // O escopo vem da primeira linha que TEM conteúdo: linha legada de período
  // "unico" (ou pacote antigo sem produtos) não pode zerar o escopo.
  const base =
    linhas.find((p) => Array.isArray(p.produtos_incluidos) && p.produtos_incluidos.length > 0) || linhas[0];
  const incluidos = Array.isArray(base.produtos_incluidos) ? base.produtos_incluidos : [];
  plano.gdIds = incluidos.filter((p: any) => p?.origem !== "vexo" && p?.product_id).map((p: any) => p.product_id);
  plano.vexoIds = incluidos.filter((p: any) => p?.origem === "vexo" && p?.product_id).map((p: any) => p.product_id);

  hidratarPrecos(plano, linhas);
  return plano;
}

/**
 * Plano de uma proposta LEGADA. Além das linhas de preço, absorve no escopo os
 * "avulsos com valor" que sobraram do modelo antigo.
 *
 * Esses itens não somam mais nada desde PACOTE FECHADO, mas continuavam sendo
 * impressos com preço na proposta do cliente, embaixo de um cabeçalho que diz
 * "tudo incluído no pacote". Apagá-los tiraria serviço prometido do escopo
 * (ex.: a Landing Page da Vitallis não está no pacote). Absorver mantém o
 * serviço e elimina o preço fantasma: ou está no plano, ou não existe.
 */
export function planoDeProposta(pacotes: any[], itens: any[]): Plano {
  const plano = planoDePacotes(pacotes);
  const jaNoEscopo = new Set([...plano.gdIds, ...plano.vexoIds]);

  (itens || []).forEach((item) => {
    if (!item?.product_id || Number(item.valor || 0) <= 0) return;
    const d = String(item.descricao || "");
    if (d.startsWith("Pacote:") || d.startsWith("Pacote Vexo:")) return;
    if (jaNoEscopo.has(item.product_id)) return;
    jaNoEscopo.add(item.product_id);
    if (item.categoria === "vexo") plano.vexoIds.push(item.product_id);
    else plano.gdIds.push(item.product_id);
  });

  return plano;
}

function hidratarPrecos(plano: Plano, linhas: any[]): void {
  linhas.forEach((pk) => {
    const key = PERIODOS.find((p) => p.key === pk.periodo)?.key;
    if (!key) return; // ignora "unico" e períodos legados
    const meses = mesesDoPeriodo(key);
    plano.precos[key] = Math.round((Number(pk.valor || 0) / meses) * 100) / 100;
    if (!plano.valorTabelaMensal && Number(pk.valor_tabela || 0) > 0) {
      plano.valorTabelaMensal = Math.round((Number(pk.valor_tabela) / meses) * 100) / 100;
    }
    // Reconstrói o % a partir do VP e do valor gravados: pct = vp / valor × 100.
    if (!plano.vpPercent && Number(pk.valor_vp || 0) > 0 && Number(pk.valor || 0) > 0) {
      plano.vpPercent = Math.round((Number(pk.valor_vp) / Number(pk.valor)) * 100 * 10) / 10;
    }
  });
}
