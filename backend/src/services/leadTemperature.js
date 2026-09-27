// backend/src/services/leadTemperature.js
//
// Duas colunas vivas de temperatura em public.leads, escalas diferentes:
//   - lead_temperature: QUENTE/MORNO/FRIO — escrita pelo robô (chatbot),
//     só quando alguém de fato classificou o lead.
//   - temperature: hot/warm/cold — escrita pela importação de planilha
//     (domains/leads/routes.js), MAS com DEFAULT 'warm' na coluna
//     (lead-client-tables.js) e o próprio importador cai em 'warm' quando a
//     planilha não traz nada (leads/routes.js). Ou seja: 'warm' não é sinal
//     de "morno" — é sinal de "ninguém disse nada". Não existe coluna que
//     distinga um 'warm' deliberado de um 'warm' default, então NENHUM dos
//     dois pode contar como classificação. Por isso:
//       lead_temperature: QUENTE/MORNO/FRIO valem todos, inclusive MORNO
//       (essa coluna só é escrita por escolha, nunca por default).
//       temperature: 'hot' vale QUENTE, 'cold' vale FRIO, 'warm' NÃO conta
//       (vira "sem classificação" — é o valor-fantasma do default).
//   Qualquer valor fora dessa lista fechada, nas duas colunas, também vira
//   "sem classificação" — nunca desaparece da soma. QUENTE/MORNO/FRIO/
//   sem-classificação têm que ser exaustivos: todo lead cai em algum dos
//   quatro, nunca em nenhum.

import { toCanonicalPhone } from "./canonicalPhone.js";

// SQL — usada de verdade na query de public.leads. CASE com valores
// fechados, não UPPER() cru: um valor sujo (ou 'warm' de default) tem que
// virar NULL aqui, não vazar pro agregador de fora.
export function SQL_LEAD_TEMPERATURE_BUCKET(alias) {
  return `
    CASE UPPER(NULLIF(${alias}.lead_temperature, ''))
      WHEN 'QUENTE' THEN 'QUENTE'
      WHEN 'MORNO' THEN 'MORNO'
      WHEN 'FRIO' THEN 'FRIO'
      ELSE
        CASE UPPER(NULLIF(${alias}.temperature, ''))
          WHEN 'HOT' THEN 'QUENTE'
          WHEN 'COLD' THEN 'FRIO'
          ELSE NULL
        END
    END
  `;
}

// Variante só de lead_temperature — usada quando o tenant não tem a coluna
// `temperature` (deriva de schema). Mesma whitelist fechada: MORNO só conta
// vindo daqui, nunca de um 'warm' de default que nem existe nesta variante.
export function SQL_LEAD_TEMPERATURE_ONLY(alias) {
  return `
    CASE UPPER(NULLIF(${alias}.lead_temperature, ''))
      WHEN 'QUENTE' THEN 'QUENTE'
      WHEN 'MORNO' THEN 'MORNO'
      WHEN 'FRIO' THEN 'FRIO'
      ELSE NULL
    END
  `;
}

// Espelha fielmente SQL_LEAD_TEMPERATURE_BUCKET em JavaScript — mesmo
// padrão de toCanonicalPhone/SQL_CANONICAL_PHONE em canonicalPhone.js: dá
// cobertura de teste real ao critério sem precisar rodar a query. Os dois
// lados tratam "warm" e valor desconhecido do mesmo jeito — devolvem null —
// senão a invariante da soma só fecha no teste, não em produção.
export function resolveLeadTemperatureBucket(leadTemperature, temperature) {
  const lt = String(leadTemperature || "").trim().toUpperCase();
  if (lt === "QUENTE" || lt === "MORNO" || lt === "FRIO") return lt;

  const t = String(temperature || "").trim().toUpperCase();
  if (t === "HOT") return "QUENTE";
  if (t === "COLD") return "FRIO";
  // 'WARM' cai aqui de propósito — é o default da coluna, não classificação.
  return null;
}

/**
 * Espelha em JavaScript o trio de CTEs da rota de message-effectiveness
 * (lead_by_phone → replied_temperature → temperature_agg): um lead por
 * telefone canônico (o mais recente primeiro, como DISTINCT ON ... ORDER BY
 * updated_at DESC), e uma contagem por telefone que respondeu — não por
 * telefone único, a mesma granularidade de `replied_count`.
 *
 * Só existe pra dar cobertura de teste real ao algoritmo sem precisar de um
 * Postgres de verdade. A rota continua usando a query SQL — as duas têm que
 * ser mantidas em sincronia, igual toCanonicalPhone/SQL_CANONICAL_PHONE já
 * são hoje.
 *
 * @param {string[]} repliedPhones - um item por RUN que respondeu (pode repetir telefone)
 * @param {{telefone?: string|null, phone?: string|null, lead_temperature?: string|null, temperature?: string|null, updated_at?: string}[]} leads
 */
export function aggregateRepliedTemperatures(repliedPhones, leads) {
  const latestByPhone = new Map();
  for (const lead of leads) {
    // telefone e phone são as duas colunas vivas do mesmo dado — lead sem
    // uma preenchida não pode ficar invisível no cruzamento.
    const rawPhone = lead.telefone || lead.phone;
    const canonical = toCanonicalPhone(rawPhone);
    if (!canonical) continue;
    const updatedAt = lead.updated_at ? new Date(lead.updated_at).getTime() : -Infinity;
    const existing = latestByPhone.get(canonical);
    if (!existing || updatedAt > existing.updatedAt) {
      latestByPhone.set(canonical, { lead, updatedAt });
    }
  }

  const counts = { quente: 0, morno: 0, frio: 0, semClassificacao: 0 };
  for (const phone of repliedPhones) {
    const canonical = toCanonicalPhone(phone);
    const entry = latestByPhone.get(canonical);
    const bucket = entry ? resolveLeadTemperatureBucket(entry.lead.lead_temperature, entry.lead.temperature) : null;
    if (bucket === "QUENTE") counts.quente += 1;
    else if (bucket === "MORNO") counts.morno += 1;
    else if (bucket === "FRIO") counts.frio += 1;
    else counts.semClassificacao += 1;
  }
  return counts;
}
