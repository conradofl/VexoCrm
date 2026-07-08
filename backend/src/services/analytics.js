// Helpers puros de dashboard / revenue-ops (movidos de server.js — grupo G do mapa, Onda 3 Run C).
// Movimento puro: corpos idênticos aos de server.js na revisão 0ae005a.
//
// leadMatchesCampaignSegmentation é um adapter legado intencional (não duplicação — ver
// segmentation.js para a implementação nova usada pelo motor de campanhas).

import { normalizeString, normalizeLooseText, getNormalizedField, parseMoneyLikeValue } from "../textNormalize.js";
import { sanitizePhone } from "./leadImport.js";

export function getZonedDateParts(date, timeZone = "America/Sao_Paulo") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;

  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
  };
}

export function getDateKey(date, timeZone = "America/Sao_Paulo") {
  const parts = getZonedDateParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getDateLabel(date, timeZone = "America/Sao_Paulo") {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

export function humanizeStatus(value) {
  const normalized = normalizeString(value);
  if (!normalized) return "Sem status";

  const map = {
    em_qualificacao: "Em qualificacao",
    qualificado: "Qualificado",
    qualificados: "Qualificados",
    contatado: "Contatado",
    contatados: "Contatados",
    convertido: "Convertido",
    convertidos: "Convertidos",
    filtrado: "Filtrado",
    filtrados: "Filtrados",
    recebido: "Recebido",
    recebidos: "Recebidos",
    aguardando_sdr: "Aguardando SDR",
  };

  return map[normalized] || normalized.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

export function isQualifiedStatus(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  return normalized === "qualificado" || normalized === "qualificados" || normalized === "em_qualificacao";
}

export function detectTemperature(lead) {
  try {
    const raw = lead?.qualificacao;
    const source =
      raw != null && typeof raw === "object"
        ? JSON.stringify(raw).toLowerCase()
        : normalizeString(raw)?.toLowerCase() || "";

    if (source.includes("quente")) return "hot";
    if (source.includes("morno")) return "warm";
    if (source.includes("frio")) return "cold";
    return "unknown";
  } catch {
    return "unknown";
  }
}

/** Safe date for bucketing; invalid spreadsheet values must not crash Intl formatting. */
export function parseLeadReferenceDate(lead) {
  const tryParse = (v) => {
    if (v === null || v === undefined || v === "") return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return tryParse(lead?.data_hora) ?? tryParse(lead?.created_at);
}

export function buildDashboardPayload(client, leads, conversions = [], messages = []) {
  const now = new Date();
  const timeZone = "America/Sao_Paulo";
  const todayKey = getDateKey(now, timeZone);
  const recentDays = Array.from({ length: 10 }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (9 - index));
    const key = getDateKey(date, timeZone);
    return {
      key,
      day: getDateLabel(date, timeZone),
      leads: 0,
      qualifiedLeads: 0,
      respostas: 0,
    };
  });

  const recentDaysMap = new Map(recentDays.map((item) => [item.key, item]));
  const statusCounts = new Map();
  const typeCounts = new Map();
  const temperatureCounts = {
    hot: 0,
    warm: 0,
    cold: 0,
    unknown: 0,
  };

  let leadsToday = 0;
  let qualifiedLeads = 0;
  const cities = new Set();

  for (const lead of leads) {
    const statusKey = (normalizeString(lead.status) || "sem_status").toLowerCase();
    const typeKey = normalizeString(lead.tipo_cliente) || "nao_informado";
    const temperatureKey = detectTemperature(lead);
    const cityKey = normalizeString(lead.cidade);

    const referenceDate = parseLeadReferenceDate(lead);
    let dateKey = null;
    if (referenceDate) {
      try {
        dateKey = getDateKey(referenceDate, timeZone);
      } catch {
        console.warn("[dashboard] invalid date for lead bucketing", lead?.id);
      }
    }

    if (dateKey === todayKey) {
      leadsToday += 1;
    }

    if (isQualifiedStatus(statusKey)) {
      qualifiedLeads += 1;
    }

    temperatureCounts[temperatureKey] += 1;
    statusCounts.set(statusKey, (statusCounts.get(statusKey) || 0) + 1);
    typeCounts.set(typeKey, (typeCounts.get(typeKey) || 0) + 1);
    if (cityKey) {
      cities.add(cityKey.toLowerCase());
    }

    const dayEntry = dateKey ? recentDaysMap.get(dateKey) : null;
    if (dayEntry) {
      dayEntry.leads += 1;
      if (isQualifiedStatus(statusKey)) {
        dayEntry.qualifiedLeads += 1;
      }
    }
  }

  // Populate daily replies (respostas) based on inbound messages
  for (const m of messages) {
    if (m.direction !== "inbound") continue;
    const msgDate = new Date(m.created_at || now);
    let dateKey = null;
    try {
      dateKey = getDateKey(msgDate, timeZone);
    } catch {
      continue;
    }
    const dayEntry = dateKey ? recentDaysMap.get(dateKey) : null;
    if (dayEntry) {
      dayEntry.respostas = (dayEntry.respostas || 0) + 1;
    }
  }

  // ── Calculate metrics: responseRate, noContact3d, contactedLeads ───────────
  const outboundPhones = new Set();
  const inboundPhones = new Set();
  const outboundLeads = new Set();
  const inboundLeads = new Set();

  for (const m of messages) {
    const phone = m.phone;
    const leadId = m.lead_id;
    if (m.direction === "outbound") {
      if (leadId) outboundLeads.add(leadId);
      if (phone) outboundPhones.add(phone);
    } else if (m.direction === "inbound") {
      if (leadId) inboundLeads.add(leadId);
      if (phone) inboundPhones.add(phone);
    }
  }

  const totalMessaged = leads.filter((lead) => {
    return (lead.id && outboundLeads.has(lead.id)) || (lead.telefone && outboundPhones.has(lead.telefone));
  }).length;

  const totalResponded = leads.filter((lead) => {
    const sent = (lead.id && outboundLeads.has(lead.id)) || (lead.telefone && outboundPhones.has(lead.telefone));
    const replied = (lead.id && inboundLeads.has(lead.id)) || (lead.telefone && inboundPhones.has(lead.telefone));
    return sent && replied;
  }).length;

  const responseRate = totalMessaged === 0 ? 0 : Math.round((totalResponded / totalMessaged) * 100);

  // Sem contato +3 dias
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const lastContactByLead = new Map();
  const lastContactByPhone = new Map();

  for (const m of messages) {
    const msgDate = new Date(m.created_at || now);
    if (Number.isNaN(msgDate.getTime())) continue;

    if (m.lead_id) {
      const current = lastContactByLead.get(m.lead_id);
      if (!current || msgDate > current) {
        lastContactByLead.set(m.lead_id, msgDate);
      }
    }
    if (m.phone) {
      const current = lastContactByPhone.get(m.phone);
      if (!current || msgDate > current) {
        lastContactByPhone.set(m.phone, msgDate);
      }
    }
  }

  let noContact3d = 0;
  let contactedLeads = 0;

  for (const lead of leads) {
    const statusKey = (normalizeString(lead.status) || "sem_status").toLowerCase();
    const isClosedOrQualified = isQualifiedStatus(statusKey) || normalizeWonStatus(statusKey) || statusKey === "perdido" || statusKey === "arquivado";
    if (isClosedOrQualified) continue;

    // Last contact calculation for noContact3d
    let lastDate = null;
    if (lead.id && lastContactByLead.has(lead.id)) {
      lastDate = lastContactByLead.get(lead.id);
    } else if (lead.telefone && lastContactByPhone.has(lead.telefone)) {
      lastDate = lastContactByPhone.get(lead.telefone);
    } else {
      lastDate = parseLeadReferenceDate(lead);
    }

    if (lastDate && lastDate < threeDaysAgo) {
      noContact3d++;
    }

    // ContactedLeads (Em contato) calculation
    const hasMessages = (lead.id && (outboundLeads.has(lead.id) || inboundLeads.has(lead.id))) ||
                        (lead.telefone && (outboundPhones.has(lead.telefone) || inboundPhones.has(lead.telefone)));
    const isExplicitlyEmContato = statusKey === "em_contato" || statusKey === "em contato" || statusKey === "conversando" || statusKey === "atendimento";

    if (isExplicitlyEmContato || hasMessages) {
      contactedLeads++;
    }
  }

  const totalLeads = leads.length;
  const qualificationRate = totalLeads === 0 ? 0 : Math.round((qualifiedLeads / totalLeads) * 100);
  const closedConversions = (conversions || []).filter((conversion) => {
    const status = normalizeLooseText(conversion.conversion_status || conversion.status);
    return status.includes("won") || status.includes("ganho") || status.includes("fechado") || status.includes("convertido");
  });
  const conversionsCount = closedConversions.length;
  const revenueGenerated = Math.round(
    closedConversions.reduce((sum, conversion) => {
      const value = Number(conversion.revenue_amount ?? conversion.contract_value ?? 0);
      return sum + (Number.isFinite(value) ? value : 0);
    }, 0)
  );
  const conversionRate = totalLeads === 0 ? 0 : Math.round((conversionsCount / totalLeads) * 100);
  const averageTicket = conversionsCount === 0 ? 0 : Math.round(revenueGenerated / conversionsCount);
  const performanceScore = Math.round(
    (qualificationRate * 0.45) +
      (conversionRate * 0.45) +
      (totalLeads === 0 ? 0 : Math.min(100, Math.round((temperatureCounts.hot / totalLeads) * 100)) * 0.1)
  );
  const funnelCoverage = totalLeads === 0 ? 0 : Math.round(((qualifiedLeads + conversionsCount) / Math.max(totalLeads * 2, 1)) * 100);

  return {
    client,
    summary: {
      totalLeads,
      leadsToday,
      qualifiedLeads,
      qualificationRate,
      activeCities: cities.size,
      hotLeads: temperatureCounts.hot,
      warmLeads: temperatureCounts.warm,
      coldLeads: temperatureCounts.cold,
      noSignalLeads: temperatureCounts.unknown,
      conversions: conversionsCount,
      conversionRate,
      revenueGenerated,
      averageTicket,
      performanceScore,
      funnelCoverage,
      responseRate,
      noContact3d,
      contactedLeads,
    },
    leadsByDay: recentDays,
    temperatureBreakdown: [
      { name: "Quente", value: temperatureCounts.hot, color: "hsl(0, 72%, 51%)" },
      { name: "Morno", value: temperatureCounts.warm, color: "hsl(32, 95%, 55%)" },
      { name: "Frio", value: temperatureCounts.cold, color: "hsl(217, 91%, 60%)" },
      { name: "Sem sinal", value: temperatureCounts.unknown, color: "hsl(220, 12%, 60%)" },
    ],
    statusBreakdown: [
      ...Array.from(statusCounts.entries())
      .map(([status, value]) => ({
        name: humanizeStatus(status),
        value,
      }))
      .sort((a, b) => b.value - a.value),
      ...(conversionsCount > 0 ? [{ name: "Fechamentos", value: conversionsCount }] : []),
    ],
    typeBreakdown: Array.from(typeCounts.entries())
      .map(([type, value]) => ({
        name: type === "nao_informado" ? "Nao informado" : humanizeStatus(type),
        value,
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6),
    recentLeads: leads.slice(0, 5).map((lead) => ({
      id: lead.id,
      nome: lead.nome || "Lead sem nome",
      tipo_cliente: lead.tipo_cliente,
      cidade: lead.cidade,
      status: humanizeStatus(lead.status),
      temperature: detectTemperature(lead),
      data_hora: lead.data_hora || lead.created_at,
    })),
  };
}

// normalizeLooseText, getNormalizedField, parseMoneyLikeValue: ver ./textNormalize.js (Onda 3, Run A).

export function leadMatchesCampaignSegmentation(lead, segmentation = {}) {
  const normalizedData = lead.normalized_data && typeof lead.normalized_data === "object"
    ? lead.normalized_data
    : lead;
  const filters = segmentation && typeof segmentation === "object" ? segmentation : {};

  const gender = normalizeLooseText(filters.gender);
  if (gender && gender !== "todos") {
    const leadGender = normalizeLooseText(getNormalizedField(normalizedData, ["genero", "gênero", "sexo"]));
    if (!leadGender.includes(gender)) return false;
  }

  const productType = normalizeLooseText(filters.productType);
  if (productType && productType !== "todos") {
    const leadProduct = normalizeLooseText(
      getNormalizedField(normalizedData, ["tipo_produto", "tipo de produto", "produto", "tipo_cliente", "perfil"])
    );
    if (!leadProduct.includes(productType)) return false;
  }

  const ticket = normalizeLooseText(filters.ticket);
  const ticketThreshold = Number(filters.ticketThreshold || 0);
  if (ticket && ticket !== "todos") {
    const rawValue =
      getNormalizedField(normalizedData, ["valor", "ticket", "valor_contrato", "contrato", "renda", "faixa_consumo", "consumo"]) ||
      "";
    const leadValue = parseMoneyLikeValue(rawValue);
    const textValue = normalizeLooseText(rawValue);

    if (leadValue !== null && ticketThreshold > 0) {
      if (ticket === "alto" && leadValue < ticketThreshold) return false;
      if (ticket === "baixo" && leadValue >= ticketThreshold) return false;
    } else if (!textValue.includes(ticket)) {
      return false;
    }
  }

  const interest = normalizeLooseText(filters.interest);
  if (interest) {
    const leadInterest = normalizeLooseText(
      [
        getNormalizedField(normalizedData, ["interesse", "categoria", "segmento", "produto", "tipo_cliente"]),
        getNormalizedField(normalizedData, ["observacao", "observações", "descricao", "descrição"]),
      ].filter(Boolean).join(" ")
    );
    if (!leadInterest.includes(interest)) return false;
  }

  const campaignTag = normalizeLooseText(filters.campaignTag);
  if (campaignTag) {
    const source = normalizeLooseText(
      [
        getNormalizedField(normalizedData, ["campanha", "origem", "source", "utm_campaign"]),
        lead.import_id,
      ].filter(Boolean).join(" ")
    );
    if (!source.includes(campaignTag)) return false;
  }

  return true;
}

export function isMissingSchemaError(error) {
  const code = normalizeString(error?.code);
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();
  return (
    code === "42P01" ||
    code === "42703" ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "PGRST100" ||
    code === "42704" ||
    message.includes("schema cache") ||
    message.includes("could not find the") ||
    message.includes("relation") && message.includes("does not exist") ||
    message.includes("does not exist") ||
    message.includes("column") && message.includes("does not exist") ||
    message.includes("table") && message.includes("does not exist")
  );
}

export async function optionalQuery(factory, fallback = []) {
  const { data, error } = await factory();
  if (error) {
    if (isMissingSchemaError(error)) {
      return { data: fallback, available: false };
    }
    throw error;
  }
  return { data: data || fallback, available: true };
}

export async function queryWithSchemaFallback(factories, fallback = []) {
  let lastError = null;

  for (const factory of factories) {
    const { data, error } = await factory();
    if (!error) {
      return { data: data || fallback, available: true };
    }

    if (isMissingSchemaError(error)) {
      lastError = error;
      continue;
    }

    throw error;
  }

  if (lastError) {
    return { data: fallback, available: false };
  }

  return { data: fallback, available: false };
}

export function safePercent(numerator, denominator) {
  if (!denominator) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

export function average(values) {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(1));
}

export function hoursBetween(start, end) {
  if (!start || !end) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  return (endDate.getTime() - startDate.getTime()) / 36e5;
}

export function normalizeMetricValue(value, kind = "number") {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return {
      raw: null,
      displayValue: "Aguardando dados",
    };
  }

  if (kind === "percent") {
    return {
      raw: value,
      displayValue: `${Number(value).toFixed(1)}%`,
    };
  }

  if (kind === "currency") {
    return {
      raw: value,
      displayValue: new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
        maximumFractionDigits: 0,
      }).format(Number(value)),
    };
  }

  if (kind === "duration_hours") {
    return {
      raw: value,
      displayValue: `${Number(value).toFixed(1)}h`,
    };
  }

  if (kind === "ratio") {
    return {
      raw: value,
      displayValue: Number(value).toFixed(2),
    };
  }

  return {
    raw: value,
    displayValue: String(value),
  };
}

export function buildMetricDefinition({
  key,
  name,
  formula,
  source,
  frequency,
  display,
  kind = "number",
  value = null,
  availability = "ready",
  note = null,
}) {
  return {
    key,
    name,
    formula,
    source,
    frequency,
    display,
    kind,
    availability,
    note,
    ...normalizeMetricValue(value, kind),
  };
}

export function normalizeWonStatus(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  return normalized === "won" || normalized === "closed_won" || normalized === "convertido" || normalized === "converted";
}

export function getLeadReferenceDate(lead) {
  return lead.data_hora || lead.updated_at || lead.created_at || null;
}

export function buildRevenueOpsPayload({
  client,
  leads,
  campaigns,
  leadImportItems,
  conversations,
  messages,
  assignments,
  conversions,
  consultants,
  rules,
  storedInsights,
  availability,
}) {
  const sanitizedLeads = (leads || []).map((lead) => ({
    ...lead,
    telefone: sanitizePhone(lead.telefone),
  }));

  const leadById = new Map(sanitizedLeads.map((lead) => [lead.id, lead]));
  const leadByPhone = new Map(
    sanitizedLeads
      .filter((lead) => lead.telefone)
      .map((lead) => [lead.telefone, lead])
  );

  const conversationCounts = new Map();
  for (const item of conversations || []) {
    const phone = sanitizePhone(item.telefone);
    if (!phone) continue;
    conversationCounts.set(phone, (conversationCounts.get(phone) || 0) + 1);
  }

  const messageStatsByPhone = new Map();
  for (const item of messages || []) {
    const phone = sanitizePhone(item.phone) || leadById.get(item.lead_id)?.telefone || null;
    if (!phone) continue;

    const current = messageStatsByPhone.get(phone) || {
      total: 0,
      inbound: 0,
      outbound: 0,
      engaged: 0,
      firstOutboundAt: null,
      lastInboundAt: null,
    };

    current.total += 1;
    if (item.direction === "inbound" || item.sender_type === "lead") {
      current.inbound += 1;
      if (!current.lastInboundAt || new Date(item.created_at) > new Date(current.lastInboundAt)) {
        current.lastInboundAt = item.created_at;
      }
    } else {
      current.outbound += 1;
      if (!current.firstOutboundAt || new Date(item.created_at) < new Date(current.firstOutboundAt)) {
        current.firstOutboundAt = item.created_at;
      }
    }

    if (item.engagement_signal === "reply" || item.engagement_signal === "clicked" || item.direction === "inbound") {
      current.engaged += 1;
    }

    messageStatsByPhone.set(phone, current);
  }

  const addressedLeads = sanitizedLeads.filter((lead) => {
    const phone = lead.telefone;
    return Boolean(
      lead.bot_ativo ||
      normalizeString(lead.status) ||
      normalizeString(lead.historico) ||
      (phone && conversationCounts.has(phone)) ||
      (phone && messageStatsByPhone.has(phone))
    );
  });

  const qualifiedLeads = sanitizedLeads.filter((lead) =>
    isQualifiedStatus(lead.status) || (normalizeString(lead.qualificacao)?.toLowerCase() || "").includes("qualific")
  );

  const wonConversions = (conversions || []).filter((item) => normalizeWonStatus(item.conversion_status));
  const closedLeadIds = new Set(
    wonConversions.map((item) => item.lead_id).filter(Boolean)
  );
  sanitizedLeads.forEach((lead) => {
    if (normalizeWonStatus(lead.status)) {
      closedLeadIds.add(lead.id);
    }
  });

  const respondedPhones = new Set(
    [...messageStatsByPhone.entries()]
      .filter(([, stats]) => stats.inbound > 0 || stats.engaged > 0)
      .map(([phone]) => phone)
  );
  if (!availability.messages) {
    for (const phone of conversationCounts.keys()) {
      respondedPhones.add(phone);
    }
  }

  const qualifiedLeadIds = new Set(qualifiedLeads.map((lead) => lead.id));
  const totalInteractions = availability.messages
    ? (messages || []).length
    : (conversations || []).length;

  const qualificationDurations = sanitizedLeads
    .filter((lead) => qualifiedLeadIds.has(lead.id))
    .map((lead) => hoursBetween(lead.first_contact_at || getLeadReferenceDate(lead), lead.qualified_at || lead.updated_at))
    .filter((value) => typeof value === "number" && value >= 0);

  const closingDurations = sanitizedLeads
    .filter((lead) => closedLeadIds.has(lead.id))
    .map((lead) => {
      const conversion = wonConversions.find((item) => item.lead_id === lead.id) || null;
      return hoursBetween(
        conversion?.first_contact_at || lead.first_contact_at || getLeadReferenceDate(lead),
        conversion?.closed_at || lead.closed_at || lead.updated_at
      );
    })
    .filter((value) => typeof value === "number" && value >= 0);

  const totalWon = closedLeadIds.size;
  const responseRate = safePercent(
    addressedLeads.filter((lead) => lead.telefone && respondedPhones.has(lead.telefone)).length,
    addressedLeads.length
  );
  const abandonmentRate = safePercent(
    addressedLeads.filter((lead) => !lead.telefone || !respondedPhones.has(lead.telefone)).length,
    addressedLeads.length
  );
  const engagementPerMessage = availability.messages
    ? safePercent(
        (messages || []).filter((item) => item.engagement_signal === "reply" || item.engagement_signal === "clicked").length,
        (messages || []).filter((item) => item.direction !== "inbound").length
      )
    : null;

  const reactivatedLeadCount = availability.messages
    ? Array.from(messageStatsByPhone.values()).filter((stats) => stats.outbound > 1 && stats.inbound > 0).length
    : null;

  const essentialMetrics = [
    buildMetricDefinition({
      key: "qualification_rate",
      name: "Taxa de Qualificacao",
      formula: "leads qualificados / leads abordados",
      source: "public.leads.status, public.leads.qualificacao, public.lead_messages.direction ou public.lead_conversations.telefone",
      frequency: "Tempo real",
      display: "Card principal + tendencia diaria",
      kind: "percent",
      value: safePercent(qualifiedLeads.length, addressedLeads.length),
    }),
    buildMetricDefinition({
      key: "qualification_cost",
      name: "Custo de Qualificacao",
      formula: "custo da campanha / leads qualificados",
      source: "public.campaigns.budget_amount, public.lead_conversions, public.leads",
      frequency: "Diario",
      display: "Card financeiro por campanha",
      kind: "currency",
      value: null,
      availability: "future",
      note: "Aguardando custo real de campanha em budget_amount e fechamento da atribuicao de origem por lead.",
    }),
    buildMetricDefinition({
      key: "interactions_per_qualified_lead",
      name: "Conversas por Lead Qualificado",
      formula: "total de interacoes / leads qualificados",
      source: availability.messages
        ? "public.lead_messages"
        : "public.lead_conversations (proxy parcial)",
      frequency: "Tempo real",
      display: "Card operacional + comparativo por campanha",
      kind: "ratio",
      value: qualifiedLeads.length ? totalInteractions / qualifiedLeads.length : null,
      availability: availability.messages ? "ready" : "partial",
      note: availability.messages ? null : "Sem tabela de mensagens populada, usando snapshots de conversa como aproximacao.",
    }),
    buildMetricDefinition({
      key: "interactions_per_closing",
      name: "Conversas por Fechamento",
      formula: "total de interacoes / vendas fechadas",
      source: "public.lead_messages, public.lead_conversions",
      frequency: "Tempo real",
      display: "Card operacional + ranking de consultores",
      kind: "ratio",
      value: totalWon ? totalInteractions / totalWon : null,
      availability: availability.messages && availability.conversions ? "ready" : "partial",
      note: availability.conversions ? null : "Usando status convertido em leads como proxy de venda fechada.",
    }),
    buildMetricDefinition({
      key: "final_conversion_rate",
      name: "Taxa de Conversao Final",
      formula: "vendas / leads totais",
      source: "public.lead_conversions.conversion_status ou public.leads.status",
      frequency: "Tempo real",
      display: "Card executivo + funil final",
      kind: "percent",
      value: safePercent(totalWon, sanitizedLeads.length),
      availability: availability.conversions ? "ready" : "partial",
      note: availability.conversions ? null : "Enquanto a tabela de conversoes nao estiver populada, o CRM usa status convertido como proxy.",
    }),
    buildMetricDefinition({
      key: "avg_time_to_qualification",
      name: "Tempo Medio ate Qualificacao",
      formula: "media(qualified_at - primeiro_contato)",
      source: "public.leads.first_contact_at, public.leads.qualified_at, public.lead_messages.created_at",
      frequency: "Tempo real",
      display: "Card de velocidade + histograma",
      kind: "duration_hours",
      value: average(qualificationDurations),
      availability: qualificationDurations.length ? "ready" : "partial",
      note: qualificationDurations.length ? null : "Sem timestamps dedicados de contato/qualificacao suficientes para fechar a media.",
    }),
    buildMetricDefinition({
      key: "avg_time_to_closing",
      name: "Tempo Medio ate Fechamento",
      formula: "media(closed_at - primeiro_contato)",
      source: "public.lead_conversions.closed_at, public.lead_conversions.first_contact_at, public.leads.closed_at",
      frequency: "Tempo real",
      display: "Card executivo + ranking de consultores",
      kind: "duration_hours",
      value: average(closingDurations),
      availability: closingDurations.length ? "ready" : "partial",
      note: closingDurations.length ? null : "Sem eventos de fechamento suficientes para consolidar essa media.",
    }),
  ];

  const advancedMetrics = [
    buildMetricDefinition({
      key: "lead_response_rate",
      name: "Taxa de resposta do lead",
      formula: "leads que responderam / leads abordados",
      source: availability.messages
        ? "public.lead_messages.direction, public.lead_messages.sender_type"
        : "public.lead_conversations",
      frequency: "Tempo real",
      display: "Card + heatmap por campanha",
      kind: "percent",
      value: responseRate,
      availability: availability.messages ? "ready" : "partial",
    }),
    buildMetricDefinition({
      key: "engagement_per_message",
      name: "Taxa de engajamento por mensagem",
      formula: "mensagens com resposta ou clique / mensagens enviadas",
      source: "public.lead_messages.engagement_signal, public.lead_messages.direction",
      frequency: "Tempo real",
      display: "Card + serie temporal",
      kind: "percent",
      value: engagementPerMessage,
      availability: availability.messages ? "ready" : "future",
      note: availability.messages ? null : "Requer instrumentacao da tabela lead_messages pelo n8n ou WhatsApp.",
    }),
    buildMetricDefinition({
      key: "conversation_abandonment_rate",
      name: "Taxa de abandono da conversa",
      formula: "leads abordados sem resposta / leads abordados",
      source: "public.lead_messages, public.lead_conversations",
      frequency: "Tempo real",
      display: "Card de risco + alerta automatico",
      kind: "percent",
      value: abandonmentRate,
      availability: "ready",
    }),
    buildMetricDefinition({
      key: "base_quality_rate",
      name: "Qualidade da base",
      formula: "leads que respondem / leads abordados",
      source: "public.lead_messages, public.lead_conversations, public.leads",
      frequency: "Tempo real",
      display: "Card + ranking por campanha",
      kind: "percent",
      value: responseRate,
      availability: "ready",
    }),
    buildMetricDefinition({
      key: "agent_campaign_performance",
      name: "Performance do agente por campanha",
      formula: "taxa de qualificacao e resposta por campanha",
      source: "public.campaigns, public.leads, public.lead_messages",
      frequency: "Horario",
      display: "Ranking Top 5 / Bottom 5",
      kind: "percent",
      value: null,
      availability: campaigns.length ? "ready" : "partial",
      note: campaigns.length ? null : "Sem campanhas suficientes para consolidar comparativo.",
    }),
    buildMetricDefinition({
      key: "agent_city_performance",
      name: "Performance do agente por cidade",
      formula: "taxa de qualificacao e conversao por cidade",
      source: "public.leads.cidade, public.leads.status, public.lead_conversions",
      frequency: "Diario",
      display: "Ranking Top 5 / Bottom 5",
      kind: "percent",
      value: null,
      availability: "ready",
    }),
    buildMetricDefinition({
      key: "dynamic_lead_score",
      name: "Lead Score dinamico",
      formula: "peso de temperatura + resposta + recencia + potencial de contrato",
      source: "public.leads.qualificacao, public.leads.lead_score, public.lead_messages, public.lead_conversions",
      frequency: "Tempo real",
      display: "Badge por lead + media da carteira",
      kind: "number",
      value: average(
        sanitizedLeads.map((lead) => {
          const baseScore = Number(lead.lead_score || 0);
          const temp = detectTemperature(lead);
          const responseBoost = lead.telefone && respondedPhones.has(lead.telefone) ? 12 : 0;
          const temperatureBoost = temp === "hot" ? 35 : temp === "warm" ? 18 : temp === "cold" ? 8 : 0;
          return baseScore || temperatureBoost + responseBoost + (isQualifiedStatus(lead.status) ? 20 : 0);
        })
      ),
      availability: "ready",
    }),
    buildMetricDefinition({
      key: "reactivation_rate",
      name: "Taxa de reativacao",
      formula: "leads que voltaram a responder / leads em reengajamento",
      source: "public.lead_messages",
      frequency: "Diario",
      display: "Card + coorte",
      kind: "percent",
      value: availability.messages && addressedLeads.length
        ? safePercent(reactivatedLeadCount || 0, addressedLeads.length)
        : null,
      availability: availability.messages ? "partial" : "future",
      note: availability.messages
        ? "A implementacao atual considera reativacao quando o lead volta a responder apos mais de um contato."
        : "Requer historico de mensagens inbound/outbound por lead.",
    }),
  ];

  const buildTrend = (currentValue, previousValue) => {
    if (previousValue === null || previousValue === undefined) return "estavel";
    if (currentValue > previousValue) return "subindo";
    if (currentValue < previousValue) return "caindo";
    return "estavel";
  };

  const now = new Date();
  const currentWindowStart = new Date(now);
  currentWindowStart.setDate(now.getDate() - 6);
  const previousWindowStart = new Date(now);
  previousWindowStart.setDate(now.getDate() - 13);
  const previousWindowEnd = new Date(now);
  previousWindowEnd.setDate(now.getDate() - 7);

  const cityRows = Array.from(
    sanitizedLeads.reduce((acc, lead) => {
      const key = normalizeString(lead.cidade) || "Sem cidade";
      const current = acc.get(key) || {
        name: key,
        total: 0,
        qualified: 0,
        converted: 0,
        closeHours: [],
        currentWindowQualified: 0,
        previousWindowQualified: 0,
      };
      current.total += 1;
      if (isQualifiedStatus(lead.status)) current.qualified += 1;
      if (closedLeadIds.has(lead.id)) current.converted += 1;

      const closeHours = hoursBetween(lead.first_contact_at || getLeadReferenceDate(lead), lead.closed_at || lead.updated_at);
      if (closedLeadIds.has(lead.id) && typeof closeHours === "number" && closeHours >= 0) {
        current.closeHours.push(closeHours);
      }

      const leadDate = new Date(lead.created_at || lead.updated_at || lead.data_hora || now);
      if (leadDate >= currentWindowStart) {
        if (isQualifiedStatus(lead.status)) current.currentWindowQualified += 1;
      } else if (leadDate >= previousWindowStart && leadDate <= previousWindowEnd) {
        if (isQualifiedStatus(lead.status)) current.previousWindowQualified += 1;
      }

      acc.set(key, current);
      return acc;
    }, new Map()).values()
  ).map((item) => {
    const qualificationRate = safePercent(item.qualified, item.total);
    const conversionRate = safePercent(item.converted, item.total);
    const avgCloseHours = average(item.closeHours) || 999;
    const score = Number((qualificationRate * 0.45 + conversionRate * 0.45 + (avgCloseHours ? 100 / avgCloseHours : 0) * 0.1).toFixed(2));
    return {
      name: item.name,
      qualificationRate,
      conversionRate,
      avgCloseHours: avgCloseHours === 999 ? null : avgCloseHours,
      score,
      trend: buildTrend(item.currentWindowQualified, item.previousWindowQualified),
    };
  }).sort((a, b) => b.score - a.score);

  const importPhonesByImportId = new Map();
  for (const item of leadImportItems || []) {
    if (!item.import_id) continue;
    const current = importPhonesByImportId.get(item.import_id) || [];
    const phone = sanitizePhone(item.telefone);
    if (phone) current.push(phone);
    importPhonesByImportId.set(item.import_id, current);
  }

  const campaignRows = (campaigns || []).map((campaign) => {
    const storedPhones = Array.isArray(campaign.phones) ? campaign.phones.map((phone) => sanitizePhone(phone)).filter(Boolean) : [];
    const importPhones = campaign.import_id ? importPhonesByImportId.get(campaign.import_id) || [] : [];
    const phones = Array.from(new Set([...storedPhones, ...importPhones]));
    const relatedLeads = phones.length
      ? phones.map((phone) => leadByPhone.get(phone)).filter(Boolean)
      : [];
    const approached = relatedLeads.filter((lead) => lead.bot_ativo || lead.status || (lead.telefone && respondedPhones.has(lead.telefone)));
    const qualified = relatedLeads.filter((lead) => isQualifiedStatus(lead.status));
    const converted = relatedLeads.filter((lead) => closedLeadIds.has(lead.id));
    const currentWindowQualified = qualified.filter((lead) => new Date(lead.created_at || lead.updated_at || now) >= currentWindowStart).length;
    const previousWindowQualified = qualified.filter((lead) => {
      const createdAt = new Date(lead.created_at || lead.updated_at || now);
      return createdAt >= previousWindowStart && createdAt <= previousWindowEnd;
    }).length;

    return {
      id: campaign.id,
      name: campaign.name,
      qualifiedLeads: qualified.length,
      responseRate: safePercent(
        approached.filter((lead) => lead.telefone && respondedPhones.has(lead.telefone)).length,
        approached.length
      ),
      potentialRoi: converted.reduce((sum, lead) => sum + Number(lead.potential_contract_value || 0), 0),
      score: Number((qualified.length * 0.5 + converted.length * 0.3 + safePercent(
        approached.filter((lead) => lead.telefone && respondedPhones.has(lead.telefone)).length,
        approached.length
      ) * 0.2).toFixed(2)),
      trend: buildTrend(currentWindowQualified, previousWindowQualified),
    };
  }).sort((a, b) => b.score - a.score);

  const consultantRows = (consultants || []).map((consultant) => {
    const consultantAssignments = (assignments || []).filter((item) => item.consultant_id === consultant.id);
    const consultantConversions = (conversions || []).filter((item) => item.consultant_id === consultant.id);
    const received = consultantAssignments.length;
    const won = consultantConversions.filter((item) => normalizeWonStatus(item.conversion_status)).length;
    const responseHours = consultantAssignments
      .map((item) => hoursBetween(item.assigned_at, item.first_response_at))
      .filter((value) => typeof value === "number" && value >= 0);
    const currentWindowWon = consultantConversions.filter((item) => item.closed_at && new Date(item.closed_at) >= currentWindowStart && normalizeWonStatus(item.conversion_status)).length;
    const previousWindowWon = consultantConversions.filter((item) => item.closed_at && new Date(item.closed_at) >= previousWindowStart && new Date(item.closed_at) <= previousWindowEnd && normalizeWonStatus(item.conversion_status)).length;
    return {
      id: consultant.id,
      name: consultant.name,
      conversionRate: safePercent(won, received),
      responseTimeHours: average(responseHours),
      conversionPerLead: safePercent(won, received),
      score: Number((safePercent(won, received) * 0.7 + (responseHours.length ? (100 / average(responseHours)) : 0) * 0.3).toFixed(2)),
      trend: buildTrend(currentWindowWon, previousWindowWon),
    };
  }).sort((a, b) => b.score - a.score);

  const generatedInsights = [];
  const weakCampaign = campaignRows.find((item) => item.qualifiedLeads >= 5 && item.responseRate < 15);
  if (weakCampaign) {
    generatedInsights.push({
      title: `Campanha ${weakCampaign.name} com baixa resposta`,
      message: `A campanha ${weakCampaign.name} esta com taxa de resposta em ${weakCampaign.responseRate.toFixed(1)}%. Vale revisar lista, copy do agente e origem da base.`,
      severity: "warning",
      scope: "campaign",
    });
  }

  const hiddenOpportunityCity = cityRows.find((item) => item.qualificationRate >= 35 && item.conversionRate < 10);
  if (hiddenOpportunityCity) {
    generatedInsights.push({
      title: `Cidade ${hiddenOpportunityCity.name} qualifica mas converte pouco`,
      message: `${hiddenOpportunityCity.name} qualificou ${hiddenOpportunityCity.qualificationRate.toFixed(1)}% dos leads, mas converteu apenas ${hiddenOpportunityCity.conversionRate.toFixed(1)}%. O gargalo parece comercial.`,
      severity: "warning",
      scope: "city",
    });
  }

  const avgQualificationHours = average(qualificationDurations);
  if (avgQualificationHours !== null && avgQualificationHours > 24) {
    generatedInsights.push({
      title: "Agente esta demorando para qualificar",
      message: `O tempo medio ate qualificacao subiu para ${avgQualificationHours.toFixed(1)}h. Revise prompts, roteiros e velocidade de follow-up.`,
      severity: "warning",
      scope: "agent",
    });
  }

  if (consultantRows.length > 0) {
    const consultantAverage = average(consultantRows.map((item) => item.conversionRate)) || 0;
    const belowAverageConsultant = consultantRows.find((item) => item.conversionRate < consultantAverage * 0.7);
    if (belowAverageConsultant) {
      generatedInsights.push({
        title: `Consultor ${belowAverageConsultant.name} abaixo da media`,
        message: `${belowAverageConsultant.name} esta com ${belowAverageConsultant.conversionRate.toFixed(1)}% de fechamento por lead recebido, abaixo da media da carteira.`,
        severity: "critical",
        scope: "consultant",
      });
    }
  }

  const mergedInsights = [
    ...generatedInsights,
    ...(storedInsights || []).map((item) => ({
      title: item.title,
      message: item.message,
      severity: item.severity || "info",
      scope: item.insight_scope || "dashboard",
    })),
  ].slice(0, 8);

  const distributionModels = [
    {
      key: "round_robin",
      name: "Round-robin",
      description: "Distribui em rodizio simples respeitando disponibilidade e limite de carga.",
      rules: [
        "Mantem fila circular por consultor ativo.",
        "Ignora consultor indisponivel ou acima do limite de leads abertos.",
        "Reatribui automaticamente quando response_due_at expira.",
      ],
    },
    {
      key: "performance_weighted",
      name: "Peso por performance",
      description: "Quem converte mais e responde mais rapido recebe mais oportunidades.",
      rules: [
        "Peso base em assignment_weight do consultor.",
        "Boost adicional por taxa de fechamento e tempo medio de resposta.",
        "Aplicar fairness_floor para evitar concentracao excessiva.",
      ],
    },
    {
      key: "regional_priority",
      name: "Prioridade por regiao",
      description: "Entrega primeiro para consultor aderente a cidade e estado do lead.",
      rules: [
        "Match por cidade/estado antes de abrir fallback nacional.",
        "Contrato potencial alto prioriza especialistas ou faixa de contrato.",
        "Tipo de lead pode acionar fila dedicada por residencial/empresa.",
      ],
    },
  ];

  const activeRules = (rules || []).filter((item) => item.active);
  const consultantLoadSummary = {
    totalConsultants: consultants.length,
    availableConsultants: consultants.filter((item) => item.available && item.active).length,
    overloadedConsultants: consultants.filter((consultant) => {
      const openAssignments = assignments.filter(
        (item) => item.consultant_id === consultant.id && item.assignment_status !== "closed"
      ).length;
      return openAssignments >= consultant.open_lead_limit;
    }).length,
  };

  return {
    client,
    generatedAt: new Date().toISOString(),
    essentialMetrics,
    advancedMetrics,
    rankings: {
      cities: {
        top5: cityRows.slice(0, 5),
        bottom5: cityRows.slice(-5).reverse(),
      },
      campaigns: {
        top5: campaignRows.slice(0, 5),
        bottom5: campaignRows.slice(-5).reverse(),
      },
      consultants: {
        top5: consultantRows.slice(0, 5),
        bottom5: consultantRows.slice(-5).reverse(),
        availability: consultants.length ? "ready" : "future",
      },
    },
    distribution: {
      criteria: [
        "Regiao (cidade e estado)",
        "Valor potencial do contrato",
        "Tipo do lead (residencial, empresa, rural, etc.)",
        "Disponibilidade e carga atual do consultor",
      ],
      models: distributionModels,
      activeRules,
      consultantLoadSummary,
      operationalRules: [
        "Evitar sobrecarga usando open_lead_limit e daily_capacity.",
        "Garantir distribuicao justa com fairness_floor e assignment_weight.",
        "Reatribuir automaticamente quando o consultor nao responder dentro de response_due_at.",
      ],
    },
    dataModel: {
      tables: [
        {
          name: "leads",
          purpose: "Base central do lead com origem, score, timestamps operacionais e status de conversao.",
          fields: ["client_id", "telefone", "status", "qualificacao", "source_campaign_id", "lead_score", "first_contact_at", "qualified_at", "closed_at", "potential_contract_value"],
        },
        {
          name: "lead_conversations",
          purpose: "Memoria comprimida da conversa para auditoria e replay do agente.",
          fields: ["telefone", "conversation_compressed", "created_at"],
        },
        {
          name: "lead_messages",
          purpose: "Granularidade por mensagem para medir resposta, engajamento, abandono e reativacao.",
          fields: ["lead_id", "campaign_id", "sender_type", "direction", "engagement_signal", "created_at"],
        },
        {
          name: "campaigns",
          purpose: "Origem comercial da demanda, com configuracao de limite, canal e futuro custo.",
          fields: ["client_id", "name", "import_id", "limit_per_run", "status", "budget_amount", "channel"],
        },
        {
          name: "crm_consultants",
          purpose: "Carteira de consultores com capacidade, disponibilidade, territorio e peso.",
          fields: ["client_id", "name", "territory_cities", "territory_states", "daily_capacity", "open_lead_limit", "assignment_weight", "available"],
        },
        {
          name: "lead_assignments",
          purpose: "Historico de distribuicao do lead, SLA de resposta e reatribuicoes.",
          fields: ["lead_id", "consultant_id", "campaign_id", "assignment_mode", "assigned_at", "first_response_at", "response_due_at", "reassign_count"],
        },
        {
          name: "lead_conversions",
          purpose: "Eventos comerciais finais para medicao de fechamento, receita e ROI.",
          fields: ["lead_id", "campaign_id", "consultant_id", "conversion_status", "contract_value", "revenue_amount", "first_contact_at", "qualified_at", "closed_at"],
        },
      ],
    },
    dashboardBlueprint: {
      cards: [
        "Taxa de qualificacao",
        "Taxa de conversao final",
        "Tempo medio ate qualificacao",
        "Tempo medio ate fechamento",
        "Conversas por lead qualificado",
        "Taxa de resposta do lead",
      ],
      charts: [
        "Linha de qualificacao e conversao por dia",
        "Funil por etapa do agente ao fechamento",
        "Barra por campanha e cidade",
        "Radar de distribuicao por consultor",
      ],
      alerts: [
        "Queda de conversao",
        "Aumento de abandono",
        "Campanha com baixa resposta",
        "Consultor abaixo da media",
      ],
      filters: ["Empresa", "Campanha", "Periodo", "Cidade", "Consultor", "Status", "Origem"],
    },
    insights: mergedInsights,
  };
}

export function buildRevenueOpsFallbackPayload(clientId) {
  const timestamp = new Date().toISOString();

  return {
    client: {
      id: clientId,
      name: clientId,
    },
    generatedAt: timestamp,
    essentialMetrics: [],
    advancedMetrics: [],
    rankings: {
      cities: { top5: [], bottom5: [] },
      campaigns: { top5: [], bottom5: [] },
      consultants: { top5: [], bottom5: [], availability: "future" },
    },
    distribution: {
      criteria: [
        "Regiao (cidade e estado)",
        "Valor potencial do contrato",
        "Tipo de lead",
        "Disponibilidade do consultor",
      ],
      models: [
        {
          key: "round_robin",
          name: "Round-robin",
          description: "Rodizio simples para manter a distribuicao equilibrada.",
          rules: [
            "Distribuir em sequencia entre consultores ativos",
            "Pular consultores indisponiveis",
            "Respeitar limite de leads simultaneos",
          ],
        },
        {
          key: "weighted_performance",
          name: "Peso por performance",
          description: "Quem converte melhor recebe mais leads sem gerar sobrecarga.",
          rules: [
            "Usar taxa de fechamento como peso principal",
            "Aplicar piso de justica para todos receberem oportunidades",
            "Reduzir distribuicao quando o consultor atingir o limite de carga",
          ],
        },
        {
          key: "regional_priority",
          name: "Prioridade por regiao",
          description: "Encaminhar leads para consultores mais aderentes a cidade ou estado.",
          rules: [
            "Priorizar cobertura geografica local",
            "Reencaminhar automaticamente se nao houver resposta no SLA",
            "Manter fila de fallback para operacao geral",
          ],
        },
      ],
      activeRules: [],
      consultantLoadSummary: {
        totalConsultants: 0,
        availableConsultants: 0,
        overloadedConsultants: 0,
      },
      operationalRules: [
        "Evitar sobrecarga por limite de leads abertos",
        "Garantir distribuicao justa entre consultores ativos",
        "Permitir reatribuicao automatica quando o SLA expirar",
      ],
    },
    dataModel: {
      tables: [
        {
          name: "leads",
          purpose: "Base principal de leads e status operacionais.",
          fields: ["id", "client_id", "telefone", "nome", "cidade", "estado", "qualificacao", "campaign_id", "created_at", "updated_at"],
        },
        {
          name: "conversations",
          purpose: "Sessao de conversa do lead com o agente.",
          fields: ["id", "client_id", "lead_id", "campaign_id", "started_at", "qualified_at", "closed_at"],
        },
        {
          name: "messages",
          purpose: "Historico completo das mensagens.",
          fields: ["id", "client_id", "lead_id", "campaign_id", "direction", "sender_type", "engagement_signal", "created_at"],
        },
        {
          name: "campaigns",
          purpose: "Origem, custo e performance das campanhas.",
          fields: ["id", "client_id", "name", "status", "cost_amount", "created_at"],
        },
        {
          name: "consultants",
          purpose: "Capacidade e disponibilidade comercial.",
          fields: ["id", "client_id", "name", "city", "state", "available", "daily_capacity", "assignment_weight"],
        },
        {
          name: "assignments",
          purpose: "Distribuicao e SLA dos leads para consultores.",
          fields: ["id", "client_id", "lead_id", "consultant_id", "assigned_at", "first_response_at", "closed_at"],
        },
        {
          name: "conversions",
          purpose: "Fechamentos e receita gerada.",
          fields: ["id", "client_id", "lead_id", "campaign_id", "consultant_id", "revenue_amount", "closed_at"],
        },
      ],
    },
    dashboardBlueprint: {
      cards: [
        "Taxa de qualificacao",
        "Conversas por lead qualificado",
        "Conversas por fechamento",
        "Tempo medio ate qualificacao",
        "Tempo medio ate fechamento",
        "Taxa de conversao final",
      ],
      charts: [
        "Linha de qualificacao por periodo",
        "Funil de conversao por campanha",
        "Barras de performance por cidade",
        "Radar de eficiencia por consultor",
      ],
      alerts: [
        "Queda de conversao por campanha",
        "Aumento no tempo medio ate qualificacao",
        "Consultor abaixo da media operacional",
      ],
      filters: ["Empresa", "Campanha", "Periodo", "Cidade"],
    },
    insights: [
      {
        title: "Base analitica em preparacao",
        message: "A inteligencia comercial continua disponivel, mas esta instancia ainda esta consolidando algumas fontes analiticas.",
        severity: "warning",
        scope: "dashboard",
      },
    ],
  };
}

export function parseCommercialIntelligenceFilters(query = {}, defaultPeriod = "30d") {
  return {
    period: normalizeString(query.period) || defaultPeriod,
    campaignId: normalizeString(query.campaignId) || "",
    city: normalizeString(query.city) || "",
    consultantId: normalizeString(query.consultantId) || "",
    status: normalizeString(query.status) || "",
  };
}
