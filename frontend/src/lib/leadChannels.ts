// Atribuição por canal no Banco de Dados ("Atribuição & Origem de Marketing"). Cada lead cai em UM cartão,
// sempre — a soma dos cartões é o total de leads. A lista do que o sistema realmente grava como origem
// está em shared/leadOrigins.json; o teste confere que cada uma tem o cartão certo.
//
// Regra de ouro: um cartão chamado "WhatsApp" só recebe WhatsApp. O que não foi identificado vai para o
// cartão próprio, "Origem não identificada" — nunca misturado com um canal.

export interface MarketingChannel {
  id: string;
  name: string;
  icon: string;
  activeBorder: string;
  badgeClass: string;
}

export const NOT_IDENTIFIED_CHANNEL_ID = "nao_identificada";

// Definições de Canais de Marketing para Atribuição e Disparos
export const MARKETING_CHANNELS: MarketingChannel[] = [
  {
    id: "instagram",
    name: "Instagram",
    icon: "📸",
    activeBorder: "border-pink-500 ring-2 ring-pink-500/30 bg-pink-500/10 shadow-sm",
    badgeClass: "bg-pink-500/15 text-pink-700 dark:text-pink-300 border-pink-500/30",
  },
  {
    id: "google",
    name: "Google Ads",
    icon: "🔍",
    activeBorder: "border-blue-500 ring-2 ring-blue-500/30 bg-blue-500/10 shadow-sm",
    badgeClass: "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30",
  },
  {
    id: "facebook",
    name: "Facebook Ads",
    icon: "📘",
    activeBorder: "border-indigo-500 ring-2 ring-indigo-500/30 bg-indigo-500/10 shadow-sm",
    badgeClass: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30",
  },
  {
    id: "tiktok",
    name: "TikTok",
    icon: "🎵",
    activeBorder: "border-zinc-500 ring-2 ring-zinc-500/30 bg-zinc-500/10 shadow-sm",
    badgeClass: "bg-zinc-500/15 text-zinc-800 dark:text-zinc-200 border-zinc-500/30",
  },
  {
    id: "indicacao",
    name: "Indicação",
    icon: "🤝",
    activeBorder: "border-emerald-500 ring-2 ring-emerald-500/30 bg-emerald-500/10 shadow-sm",
    badgeClass: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: "💬",
    activeBorder: "border-green-500 ring-2 ring-green-500/30 bg-green-500/10 shadow-sm",
    badgeClass: "bg-green-500/15 text-green-700 dark:text-green-300 border-green-500/30",
  },
  {
    id: "campanha",
    name: "Campanha",
    icon: "📢",
    activeBorder: "border-sky-500 ring-2 ring-sky-500/30 bg-sky-500/10 shadow-sm",
    badgeClass: "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30",
  },
  {
    id: "organico",
    name: "Orgânico",
    icon: "🌱",
    activeBorder: "border-lime-500 ring-2 ring-lime-500/30 bg-lime-500/10 shadow-sm",
    badgeClass: "bg-lime-500/15 text-lime-700 dark:text-lime-300 border-lime-500/30",
  },
  {
    id: "trafego_pago",
    name: "Tráfego pago",
    icon: "🎯",
    activeBorder: "border-violet-500 ring-2 ring-violet-500/30 bg-violet-500/10 shadow-sm",
    badgeClass: "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30",
  },
  {
    id: "importacao_planilha",
    name: "Importação de planilha",
    icon: "📥",
    activeBorder: "border-teal-500 ring-2 ring-teal-500/30 bg-teal-500/10 shadow-sm",
    badgeClass: "bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30",
  },
  {
    id: "vendas_fechadas",
    name: "Vendas fechadas",
    icon: "🏆",
    activeBorder: "border-amber-500 ring-2 ring-amber-500/30 bg-amber-500/10 shadow-sm",
    badgeClass: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  },
  {
    id: "texto_avulso",
    name: "Texto avulso (IA)",
    icon: "📝",
    activeBorder: "border-purple-500 ring-2 ring-purple-500/30 bg-purple-500/10 shadow-sm",
    badgeClass: "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30",
  },
  {
    id: NOT_IDENTIFIED_CHANNEL_ID,
    name: "Origem não identificada",
    icon: "❓",
    activeBorder: "border-slate-500 ring-2 ring-slate-500/30 bg-slate-500/10 shadow-sm",
    badgeClass: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30",
  },
];

/** O recorte do lead que a atribuição lê (estruturalmente compatível com LeadIntelligenceItem). */
export interface ChannelLead {
  tags?: string[] | null;
  lead_source?: string | null;
  origem?: string | null;
  dados?: Record<string, any> | null;
  [key: string]: any;
}

export function getLeadSource(lead?: ChannelLead | null): string {
  if (!lead) return "Não informado";
  if (Array.isArray(lead.tags)) {
    if (lead.tags.some((t) => /instagram/i.test(t))) return "Instagram Direct";
    if (lead.tags.some((t) => /facebook|messenger/i.test(t))) return "Facebook Messenger";
    if (lead.tags.some((t) => /tiktok/i.test(t))) return "TikTok";
    if (lead.tags.some((t) => /linkedin/i.test(t))) return "LinkedIn";
  }
  return lead.lead_source || lead.dados?.origem_marketing || lead.dados?.origem || lead.origem || "Não informado";
}

/** Em qual cartão o lead cai. A ordem das regras importa: do mais específico ao mais geral. */
export function getLeadMarketingChannelId(lead?: ChannelLead | null): string {
  const s = (getLeadSource(lead) || "").toLowerCase().trim();
  if (s === "instagram" || s.startsWith("insta")) return "instagram";
  if (s === "google ads" || s.includes("google") || s.includes("gads") || s.includes("pesquisa")) return "google";
  if (s === "facebook ads" || s.includes("facebook") || s.includes("face") || s.includes("messenger")) return "facebook";
  if (s === "tiktok" || s.includes("tiktok") || s.startsWith("tt")) return "tiktok";
  if (s === "indicacao" || s.includes("indica") || s.includes("amigo") || s.includes("referral")) return "indicacao";
  // Importação: a origem é a própria planilha / o histórico de vendas / o texto colado (não um canal).
  if (s === "importacao_planilha" || s === "importação de planilha") return "importacao_planilha";
  if (s === "vendas_fechadas" || s === "importação vendas fechadas") return "vendas_fechadas";
  if (s === "ia direct/chat") return "texto_avulso";
  if (s.includes("campanh")) return "campanha";
  // Anúncios (inclui o anúncio que leva ao WhatsApp) antes de WhatsApp: "whatsapp_ads" é tráfego pago.
  if (s === "trafego_pago" || s.includes("trafego") || s.includes("tráfego") || s === "whatsapp_ads" || s.includes("whatsapp ads")) return "trafego_pago";
  // WhatsApp de verdade: extração (conversas, agenda, grupos) e quem escreveu para o número (inbound).
  if (s.includes("whatsapp") || s === "inbound" || s.includes("zap")) return "whatsapp";
  if (s === "organico" || s.includes("orgânico") || s.includes("organico") || s.includes("formul") || s.includes("site") || s.includes("landing")) return "organico";
  return NOT_IDENTIFIED_CHANNEL_ID;
}

export interface MarketingMetrics {
  total: number;
  counts: Record<string, number>;
  percentages: Record<string, number>;
}

/** Contagem e percentual por cartão. Todo canal aparece (com 0), e a soma das contagens é o total. */
export function computeMarketingMetrics(leads: readonly ChannelLead[]): MarketingMetrics {
  const total = leads.length;
  const counts: Record<string, number> = {};
  for (const c of MARKETING_CHANNELS) counts[c.id] = 0;
  for (const lead of leads) {
    const id = getLeadMarketingChannelId(lead);
    counts[id] = (counts[id] || 0) + 1;
  }
  const percentages: Record<string, number> = {};
  for (const id of Object.keys(counts)) percentages[id] = total > 0 ? Math.round((counts[id] / total) * 100) : 0;
  return { total, counts, percentages };
}
