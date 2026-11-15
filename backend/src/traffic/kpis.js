// Catálogo dos KPIs que o Gestor de Tráfego sabe calcular a partir de
// traffic_metrics_daily. É a única lista: o perfil só aceita chave daqui, e o
// sentido ("quanto menor melhor" ou "quanto maior melhor") vem daqui, nunca do
// que a tela mandar.
//
// compute() devolve null quando não há como calcular (divisão por zero). null
// não é zero: a decisão trata "gastou e não teve resultado" à parte.

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

export const KPI_CATALOG = [
  { key: "cpl", label: "Custo por lead", better: "lower", unit: "currency", compute: (m) => ratio(m.spend, m.leads) },
  {
    key: "custo_por_conversa",
    label: "Custo por conversa iniciada",
    better: "lower",
    unit: "currency",
    compute: (m) => ratio(m.spend, m.messages_started),
  },
  { key: "cpc", label: "Custo por clique", better: "lower", unit: "currency", compute: (m) => ratio(m.spend, m.clicks) },
  {
    key: "custo_por_compra",
    label: "Custo por compra",
    better: "lower",
    unit: "currency",
    compute: (m) => ratio(m.spend, m.purchases),
  },
  {
    key: "ctr",
    label: "Taxa de cliques",
    better: "higher",
    unit: "percent",
    compute: (m) => {
      const value = ratio(m.clicks, m.impressions);
      return value === null ? null : value * 100;
    },
  },
  {
    key: "roas",
    label: "Retorno sobre o gasto",
    better: "higher",
    unit: "ratio",
    compute: (m) => ratio(m.purchase_value, m.spend),
  },
];

const KPI_BY_KEY = new Map(KPI_CATALOG.map((kpi) => [kpi.key, kpi]));

export function getKpiDefinition(key) {
  return KPI_BY_KEY.get(key) || null;
}

export function publicKpiCatalog() {
  return KPI_CATALOG.map(({ key, label, better, unit }) => ({ key, label, better, unit }));
}

export const EMPTY_METRICS = Object.freeze({
  spend: 0,
  impressions: 0,
  clicks: 0,
  leads: 0,
  messages_started: 0,
  purchases: 0,
  purchase_value: 0,
});

export const METRIC_KEYS = Object.keys(EMPTY_METRICS);

/** Soma métricas brutas. KPI nunca é somado: é recalculado sobre a soma. */
export function sumMetrics(list) {
  const total = { ...EMPTY_METRICS };
  for (const item of list) {
    for (const key of METRIC_KEYS) total[key] += Number(item?.[key]) || 0;
  }
  total.spend = Math.round(total.spend * 100) / 100;
  total.purchase_value = Math.round(total.purchase_value * 100) / 100;
  return total;
}

/** Valor de cada KPI do catálogo para um conjunto de métricas. */
export function computeKpis(metrics) {
  const out = {};
  for (const kpi of KPI_CATALOG) {
    const value = kpi.compute(metrics);
    out[kpi.key] = value === null || !Number.isFinite(value) ? null : Math.round(value * 10000) / 10000;
  }
  return out;
}
