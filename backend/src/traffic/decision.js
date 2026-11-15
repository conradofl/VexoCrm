// Decisão do Gestor de Tráfego (Fase 1): função pura, sem banco, sem rede, sem
// efeito. Na Fase 1 o resultado só aparece na tela como leitura; nada é aplicado
// em plataforma nenhuma.
//
// Regras (SPEC-GESTOR-TRAFEGO-FASE1, seções 3 e 5.3):
//   - ESCALAR quando o KPI está `scale_at` (padrão 20%) melhor que a meta;
//   - MATAR quando está `kill_at` (padrão 50%) pior que a meta;
//   - MANTER no meio;
//   - AMOSTRA_INSUFICIENTE quando o gasto ainda é menor que o gasto mínimo.
//
// Dois ajustes sobre a spec, porque ela não fechava:
//   - SEM_META: sem meta numérica não há o que comparar. Devolver um dos quatro
//     estados seria inventar decisão.
//   - Gasto mínimo: "1,2 vez a meta" só faz sentido para KPI de custo (meta em
//     reais, "quanto menor melhor"). KPI de "quanto maior melhor" (retorno sobre
//     o gasto, por exemplo) tem meta que não é dinheiro, então exige `min_spend`
//     próprio; sem ele, a resposta é SEM_META com o motivo.

export const DECISOES = Object.freeze({
  ESCALAR: "ESCALAR",
  MANTER: "MANTER",
  MATAR: "MATAR",
  AMOSTRA_INSUFICIENTE: "AMOSTRA_INSUFICIENTE",
  SEM_META: "SEM_META",
});

export const DEFAULT_SCALE_AT = 0.2;
export const DEFAULT_KILL_AT = 0.5;
export const DEFAULT_MIN_SPEND_FACTOR = 1.2;

function numeroOuNull(valor) {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = typeof valor === "number" ? valor : Number(valor);
  return Number.isFinite(n) ? n : null;
}

// Arredonda a 6 casas para o limiar exato não depender de resto de ponto
// flutuante (ex.: (0.3 - 0.24) / 0.3 dá 0.19999999999999996).
function arredonda(valor) {
  return Math.round(valor * 1e6) / 1e6;
}

function formata(valor) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(valor);
}

function pct(fracao) {
  return `${formata(arredonda(fracao * 100))}%`;
}

/**
 * @param {object} params
 * @param {number|null} params.valorKpi   Valor medido do KPI na janela. null = não houve resultado para calcular.
 * @param {object} params.kpi             { key, target, better: 'lower'|'higher', scale_at, kill_at, min_spend }
 * @param {number} params.gasto           Gasto na mesma janela, na moeda da conta.
 * @param {number} [params.minSpendFactor] Fator do perfil (padrão 1,2).
 * @returns {{ decisao: string, motivo: string, numeros: object }}
 */
export function decidir({ valorKpi, kpi, gasto, minSpendFactor = DEFAULT_MIN_SPEND_FACTOR } = {}) {
  const chave = kpi?.key || "kpi";
  const meta = numeroOuNull(kpi?.target);
  const melhor = kpi?.better === "higher" ? "higher" : "lower";
  const escalarEm = numeroOuNull(kpi?.scale_at) ?? DEFAULT_SCALE_AT;
  const matarEm = numeroOuNull(kpi?.kill_at) ?? DEFAULT_KILL_AT;
  const fator = numeroOuNull(minSpendFactor) ?? DEFAULT_MIN_SPEND_FACTOR;
  const gastoNum = numeroOuNull(gasto) ?? 0;
  const valor = numeroOuNull(valorKpi);

  const numeros = {
    kpi: chave,
    valor,
    meta,
    melhor,
    gasto: gastoNum,
    gastoMinimo: null,
    variacao: null,
    escalarEm,
    matarEm,
  };

  if (meta === null || meta <= 0) {
    return {
      decisao: DECISOES.SEM_META,
      motivo: `Sem meta definida para ${chave}. Sem meta não há decisão.`,
      numeros,
    };
  }

  const minSpendProprio = numeroOuNull(kpi?.min_spend);
  let gastoMinimo;
  if (minSpendProprio !== null && minSpendProprio >= 0) {
    gastoMinimo = minSpendProprio;
  } else if (melhor === "lower") {
    gastoMinimo = arredonda(fator * meta);
  } else {
    return {
      decisao: DECISOES.SEM_META,
      motivo: `${chave} é de "quanto maior melhor" e não tem gasto mínimo configurado. Sem ele não dá para saber se a amostra basta.`,
      numeros,
    };
  }
  numeros.gastoMinimo = gastoMinimo;

  if (gastoNum < gastoMinimo) {
    return {
      decisao: DECISOES.AMOSTRA_INSUFICIENTE,
      motivo: `Gasto de ${formata(gastoNum)} ainda abaixo do mínimo de ${formata(gastoMinimo)} para decidir.`,
      numeros,
    };
  }

  // Gastou o suficiente e não produziu resultado nenhum: o custo por resultado
  // não existe (divisão por zero) e o retorno é zero. É o pior caso, não um vazio.
  if (valor === null) {
    return {
      decisao: DECISOES.MATAR,
      motivo: `Gastou ${formata(gastoNum)} sem nenhum resultado em ${chave}.`,
      numeros,
    };
  }

  // variacao > 0 = melhor que a meta; < 0 = pior. Mesma leitura para os dois sentidos.
  const variacao = melhor === "lower" ? arredonda((meta - valor) / meta) : arredonda((valor - meta) / meta);
  numeros.variacao = variacao;

  if (variacao >= escalarEm) {
    return {
      decisao: DECISOES.ESCALAR,
      motivo: `${chave} em ${formata(valor)}, ${pct(variacao)} melhor que a meta de ${formata(meta)} (escala a partir de ${pct(escalarEm)}).`,
      numeros,
    };
  }

  if (variacao <= -matarEm) {
    return {
      decisao: DECISOES.MATAR,
      motivo: `${chave} em ${formata(valor)}, ${pct(-variacao)} pior que a meta de ${formata(meta)} (corta a partir de ${pct(matarEm)}).`,
      numeros,
    };
  }

  const lado = variacao >= 0 ? `${pct(variacao)} melhor` : `${pct(-variacao)} pior`;
  return {
    decisao: DECISOES.MANTER,
    motivo: `${chave} em ${formata(valor)}, ${lado} que a meta de ${formata(meta)}. Dentro da faixa.`,
    numeros,
  };
}

// Do pior para o melhor. Campanha herda a pior decisão dos anúncios dela.
const GRAVIDADE = [DECISOES.MATAR, DECISOES.MANTER, DECISOES.ESCALAR];

/**
 * Decisão da campanha a partir das decisões dos anúncios.
 *
 * Anúncio sem amostra ou sem meta não puxa a campanha para lugar nenhum: um
 * anúncio novo sempre começa sem amostra, e contá-lo como "pior" travaria toda
 * campanha que recebe criativo novo. Só quando NENHUM anúncio tem decisão é que
 * a campanha fica sem decisão também.
 *
 * @param {string[]} decisoes
 * @returns {string|null} null quando a lista vem vazia.
 */
export function piorDecisao(decisoes = []) {
  const lista = (Array.isArray(decisoes) ? decisoes : []).filter(Boolean);
  if (lista.length === 0) return null;

  for (const decisao of GRAVIDADE) {
    if (lista.includes(decisao)) return decisao;
  }
  if (lista.includes(DECISOES.AMOSTRA_INSUFICIENTE)) return DECISOES.AMOSTRA_INSUFICIENTE;
  return DECISOES.SEM_META;
}
