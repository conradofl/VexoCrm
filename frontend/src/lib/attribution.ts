// Atribuição por canal de origem (Raia 1 da Inteligência Comercial). A origem de um lead é lida na ordem:
// coluna lead_source, dados.origem_marketing, dados.origem, origem. Valor que não é de nenhum canal
// conhecido cai em "Origem desconhecida" — por isso todo valor GRAVADO pelo sistema precisa ter linha própria
// aqui (senão a atribuição vira um número inútil).

export interface AttributionChannel {
  /** valor gravado no lead (minúsculo) */
  source: string;
  label: string;
}

export const UNKNOWN_CHANNEL_LABEL = "Origem desconhecida";

export const ATTRIBUTION_CHANNELS: readonly AttributionChannel[] = [
  { source: "campanha", label: "📢 Campanha" },
  { source: "organico", label: "🌱 Orgânico" },
  { source: "trafego_pago", label: "🎯 Tráfego Pago" },
  { source: "whatsapp_ads", label: "📱 WhatsApp Ads" },
  { source: "indicacao", label: "🤝 Indicação" },
  { source: "extracao_whatsapp", label: "💬 Extração WhatsApp" },
  // Planilha sem canal informado: a origem é a própria importação (não um canal que ninguém escolheu).
  { source: "importacao_planilha", label: "📥 Importação de planilha" },
  { source: "outro", label: "🌐 Outro" },
];

export interface AttributionLead {
  lead_source?: string | null;
  origem?: string | null;
  stage?: string | null;
  temperature?: string | null;
  dados?: { origem_marketing?: string | null; origem?: string | null } | null;
}

export interface AttributionRow {
  channel: string;
  total: number;
  qualified: number;
  rate: number;
  share: number;
  revenue: number;
}

export function attributionChannelLabel(lead: AttributionLead): string {
  const src = String(lead.lead_source || lead.dados?.origem_marketing || lead.dados?.origem || lead.origem || "")
    .trim()
    .toLowerCase();
  return ATTRIBUTION_CHANNELS.find((c) => c.source === src)?.label ?? UNKNOWN_CHANNEL_LABEL;
}

export function computeAttributionByChannel(leads: readonly AttributionLead[]): AttributionRow[] {
  const map: Record<string, { total: number; qualified: number; revenue: number }> = {};
  for (const c of ATTRIBUTION_CHANNELS) map[c.label] = { total: 0, qualified: 0, revenue: 0 };
  map[UNKNOWN_CHANNEL_LABEL] = { total: 0, qualified: 0, revenue: 0 };

  for (const lead of leads) {
    const key = attributionChannelLabel(lead);
    map[key].total += 1;
    const isQual = lead.stage === "buyer" || lead.stage === "open_budget" || lead.temperature === "hot" || lead.temperature === "warm";
    if (isQual) {
      map[key].qualified += 1;
      map[key].revenue += 2500;
    }
  }

  const totalLeadsCount = leads.length || 1;
  return Object.entries(map).map(([channel, stat]) => ({
    channel,
    total: stat.total,
    qualified: stat.qualified,
    rate: stat.total > 0 ? Math.round((stat.qualified / stat.total) * 100) : 0,
    share: Math.round((stat.total / totalLeadsCount) * 100),
    revenue: stat.revenue,
  }));
}
