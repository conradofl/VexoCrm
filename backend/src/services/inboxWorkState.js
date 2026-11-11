// Estados de trabalho da coluna de Conversas.
//
// A fila de trabalho (conversa ativa, que não é grupo nem automação) se divide em:
//   esperam   = o lead falou por último, há no máximo AWAITING_WINDOW_DAYS dias
//   esfriaram = o lead falou por último, há mais tempo que isso
//   com_lead  = nós falamos por último (ou a conversa foi marcada como atendida)
//   robo      = o robô responde no chip em que o lead escreveu e não está pausado
//
// CONTADOR E LISTA SAEM DA MESMA CONSULTA: os dois partem de buildWorkConvCte e do
// mesmo CASE. O contador antigo ("Espera") e a lista tinham predicados copiados à
// mão em três consultas; aqui só existe um lugar que decide o estado.
//
// A consulta nunca junta com `leads` antes de contar: lead repetido no mesmo
// telefone duplicaria a conversa. Nome do lead e foto entram por LATERAL ... LIMIT 1,
// e só para as conversas da PÁGINA (depois do LIMIT).
//
// O lead é achado por igualdade no índice único (client_id, telefone), pelas grafias
// cruas do número (SQL_CANONICAL_PHONE_SPELLINGS). A primeira versão aplicava a expressão
// canônica em `leads.telefone` dentro do LATERAL: o banco varria todos os leads da empresa
// para cada conversa (medido em produção, 11/11/2026: 80.320 leads, 553 ms por conversa,
// 33 s a lista). Pelas grafias: 0,04 ms por conversa, mesmo lead em 1.143 de 1.143 conversas.

import { SQL_CANONICAL_PHONE, SQL_CANONICAL_PHONE_SPELLINGS } from "./canonicalPhone.js";
import { SQL_WORK_QUEUE_MATCH } from "./inboxSqlMatchers.js";

export const WORK_STATES = ["esperam", "com_lead", "robo", "esfriaram"];
export const AWAITING_WINDOW_DAYS = 7;

export function isWorkStateTab(tab) {
  return WORK_STATES.includes(tab);
}

const EFFECTIVE_TS = "COALESCE(message_timestamp, delivered_at, created_at)";

// A expressão canônica repete a limpeza do telefone ("só os dígitos") mais de dez vezes por
// linha. Aqui a limpeza roda UMA vez por mensagem e a expressão passa a ler a coluna pronta.
// A regra continua sendo a de SQL_CANONICAL_PHONE: o texto abaixo é o dela, com o trecho
// repetido trocado pelo nome da coluna. Se a expressão mudar de forma e a troca não cobrir
// tudo, o módulo se recusa a carregar em vez de calcular telefone por duas regras.
const SQL_PHONE_DIGITS = (col) =>
  `regexp_replace(regexp_replace(${col}, '@(s\\.whatsapp\\.net|c\\.us)$', '', 'i'), '\\D', '', 'g')`;
const SQL_CANONICAL_FROM_DIGITS = SQL_CANONICAL_PHONE("phone").split(SQL_PHONE_DIGITS("phone")).join("phone_digits");
if (SQL_CANONICAL_FROM_DIGITS.includes("regexp_replace") || !SQL_CANONICAL_FROM_DIGITS.includes("phone_digits")) {
  throw new Error("inboxWorkState: SQL_CANONICAL_PHONE mudou de forma; revise SQL_PHONE_DIGITS.");
}

/**
 * CTE `work_conv`: uma linha por conversa da fila de trabalho, já com o estado.
 *
 * Parâmetros fixos: $1 clientId, $2 agora (timestamptz), $3 chips em que o robô responde (text[]).
 * Com escopo de chip: $4 apelidos do chip (text[]).
 *
 * Escopo de chip = conversas que têm PELO MENOS UMA mensagem naquele chip. O estado
 * continua calculado sobre a conversa inteira: se o lead escreveu no chip A e foi
 * respondido pelo chip B, ele foi respondido. Mensagem sem chip gravado não coloca a
 * conversa dentro de chip nenhum (o filtro antigo somava todas elas em qualquer chip).
 */
export function buildWorkConvCte({ hasChipScope = false, pauseExpiredSql = "false" } = {}) {
  const chipScope = hasChipScope
    ? "WHERE canonical_phone IN (SELECT canonical_phone FROM pre_canonical WHERE instance_name = ANY($4))"
    : "";

  return `
    msg AS (
      -- Colunas estreitas (sem texto nem meta) e os dígitos do telefone calculados uma vez.
      -- OFFSET 0 é a cerca: sem ela o Postgres achata este bloco e recalcula a limpeza em
      -- cada uso da coluna (docs/DIAGNOSTICO-LISTA-LEADS-SQL.md, mesmo defeito dos cartões).
      SELECT
        id,
        phone,
        direction,
        ${EFFECTIVE_TS} AS effective_timestamp,
        instance_name,
        ${SQL_PHONE_DIGITS("phone")} AS phone_digits
      FROM public.lead_messages
      WHERE client_id = $1
      OFFSET 0
    ),
    pre_canonical AS (
      SELECT
        id,
        ${SQL_CANONICAL_FROM_DIGITS} AS canonical_phone,
        phone AS raw_phone,
        direction,
        effective_timestamp,
        instance_name
      FROM msg
    ),
    latest_ids AS (
      SELECT DISTINCT ON (canonical_phone)
        id, canonical_phone, raw_phone, effective_timestamp
      FROM pre_canonical
      ${chipScope}
      ORDER BY canonical_phone, effective_timestamp DESC NULLS LAST, id DESC
    ),
    latest_messages AS (
      -- Texto, meta e o resto só da ÚLTIMA mensagem de cada conversa, pela chave primária.
      SELECT
        lm.id, l.canonical_phone AS phone, l.raw_phone, lm.message_text, lm.direction, lm.sender_type,
        lm.delivered_at, lm.created_at, lm.message_timestamp, l.effective_timestamp,
        lm.campaign_id, lm.contact_name, lm.is_group, lm.meta
      FROM latest_ids l
      JOIN public.lead_messages lm ON lm.id = l.id
    ),
    last_inbound AS (
      SELECT DISTINCT ON (canonical_phone)
        canonical_phone AS phone,
        effective_timestamp AS last_in_at,
        instance_name AS lead_chip
      FROM pre_canonical
      WHERE direction = 'inbound'
      ORDER BY canonical_phone, effective_timestamp DESC NULLS LAST, id DESC
    ),
    work_conv AS (
      SELECT
        m.*,
        li.last_in_at,
        li.lead_chip,
        (li.last_in_at IS NULL) AS lead_never_spoke,
        cs.state AS chat_state,
        cs.reason AS chat_state_reason,
        cs.source AS chat_state_source,
        cs.changed_by AS chat_state_changed_by,
        cs.attended_at AS chat_attended_at,
        cs.attended_by AS chat_attended_by,
        cs.agent_muted_at,
        cs.agent_muted_reason,
        ${pauseExpiredSql} AS agent_mute_expired,
        CASE
          WHEN li.lead_chip = ANY($3) AND (cs.agent_muted_at IS NULL OR ${pauseExpiredSql}) THEN 'robo'
          WHEN m.direction = 'inbound' AND cs.attended_at IS NOT NULL AND cs.attended_at >= m.effective_timestamp THEN 'com_lead'
          WHEN m.direction = 'inbound' AND m.effective_timestamp >= $2::timestamptz - make_interval(days => ${AWAITING_WINDOW_DAYS}) THEN 'esperam'
          WHEN m.direction = 'inbound' THEN 'esfriaram'
          ELSE 'com_lead'
        END AS work_state
      FROM latest_messages m
      LEFT JOIN last_inbound li ON li.phone = m.phone
      LEFT JOIN public.whatsapp_chat_states cs ON cs.client_id = $1 AND cs.phone = m.phone
      WHERE ${SQL_WORK_QUEUE_MATCH("m", "cs")}
    )`;
}

// "Esperam você" e "Esfriaram": mais parado primeiro (quem espera há mais tempo no topo).
// As outras: mais recente primeiro.
export function workStateOrderSql(state) {
  return state === "esperam" || state === "esfriaram"
    ? "w.last_in_at ASC NULLS LAST, w.id ASC"
    : "w.effective_timestamp DESC NULLS LAST, w.id DESC";
}

function baseParams({ clientId, now, robotChips, chipAliases }) {
  const params = [clientId, (now instanceof Date ? now : new Date(now || Date.now())).toISOString(), robotChips || []];
  const hasChipScope = Array.isArray(chipAliases) && chipAliases.length > 0;
  if (hasChipScope) params.push(chipAliases);
  return { params, hasChipScope };
}

/** SQL do contador por estado. Exposto pelo mesmo motivo de buildWorkStatePageSql. */
export function buildWorkStateCountsSql({ hasChipScope = false, pauseExpiredSql = "false" } = {}) {
  return `
    WITH ${buildWorkConvCte({ hasChipScope, pauseExpiredSql })}
    SELECT w.work_state, count(*)::integer AS total
    FROM work_conv w
    GROUP BY w.work_state`;
}

// ---------------------------------------------------------------------------
// Teto de tempo
// ---------------------------------------------------------------------------

// A tela pede a lista a cada 12 s. O teto fica abaixo disso para um pedido lento nunca
// encontrar o seguinte ainda rodando no banco (foi assim que a lista de 33 s empilhou).
export const WORK_STATE_QUERY_TIMEOUT_MS = 8000;

/** O Postgres cancelou a consulta por statement_timeout (ou por pedido de cancelamento). */
export function isStatementTimeout(err) {
  return err?.code === "57014";
}

/**
 * Roda fn(query) numa conexão só, em transação somente leitura, com statement_timeout
 * valendo apenas ali (SET LOCAL): o teto não vaza para outras consultas do pool.
 */
export async function withStatementTimeout(pool, timeoutMs, fn) {
  const ms = Math.max(1, Math.trunc(Number(timeoutMs) || WORK_STATE_QUERY_TIMEOUT_MS));
  const client = await pool.connect();
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${ms}`);
    const result = await fn((sql, params) => client.query(sql, params));
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Quantas conversas em cada estado. Sempre devolve as quatro chaves.
 * @param {(sql: string, params: any[]) => Promise<{rows: any[]}>} query
 */
export async function fetchWorkStateCounts(query, { clientId, now, robotChips, chipAliases, pauseExpiredSql } = {}) {
  const { params, hasChipScope } = baseParams({ clientId, now, robotChips, chipAliases });
  const { rows } = await query(buildWorkStateCountsSql({ hasChipScope, pauseExpiredSql }), params);
  const counts = Object.fromEntries(WORK_STATES.map((s) => [s, 0]));
  for (const row of rows) {
    if (row.work_state in counts) counts[row.work_state] = Number(row.total) || 0;
  }
  return counts;
}

/**
 * SQL da página de um estado. Separado de fetchWorkStatePage para o mesmo texto servir à
 * rota e ao script de EXPLAIN que mede a consulta em produção.
 */
export function buildWorkStatePageSql({ hasChipScope = false, pauseExpiredSql = "false", state, leadsTable = "leads", stateIdx, limitIdx, offsetIdx }) {
  const order = workStateOrderSql(state);
  return `
    WITH ${buildWorkConvCte({ hasChipScope, pauseExpiredSql })},
    page AS (
      SELECT w.*
      FROM work_conv w
      WHERE w.work_state = $${stateIdx}
      ORDER BY ${order}
      LIMIT $${limitIdx} OFFSET $${offsetIdx}
    )
    SELECT
      w.id,
      w.phone AS phone_number,
      w.raw_phone,
      w.message_text,
      w.direction,
      w.sender_type,
      w.delivered_at,
      w.created_at,
      w.message_timestamp,
      w.effective_timestamp,
      w.campaign_id,
      w.contact_name,
      w.is_group,
      w.meta,
      w.work_state,
      w.last_in_at,
      w.lead_chip,
      w.lead_never_spoke,
      w.chat_state,
      w.chat_state_reason,
      w.chat_state_source,
      w.chat_state_changed_by,
      w.chat_attended_at,
      w.chat_attended_by,
      w.agent_muted_at,
      w.agent_muted_reason,
      w.agent_mute_expired,
      lm.profile_pic,
      lm.contact_name AS profile_name,
      l.nome AS lead_name,
      l.lead_origin,
      l.source_campaign_id
    FROM page w
    LEFT JOIN LATERAL (
      SELECT nome, lead_origin, source_campaign_id
      FROM public."${leadsTable}" l0
      WHERE l0.client_id = $1 AND l0.telefone = ANY(${SQL_CANONICAL_PHONE_SPELLINGS("w.phone")})
      ORDER BY l0.created_at DESC NULLS LAST
      LIMIT 1
    ) l ON true
    LEFT JOIN LATERAL (
      SELECT profile_pic, contact_name
      FROM public.whatsapp_lid_map lm0
      WHERE lm0.lid = w.phone OR lm0.lid = w.raw_phone
      LIMIT 1
    ) lm ON true
    ORDER BY ${order}`;
}

/**
 * Página de conversas de um estado. As colunas têm os mesmos nomes da listagem
 * antiga da rota, para o mesmo mapeador servir às duas.
 */
export async function fetchWorkStatePage(
  query,
  { clientId, state, now, robotChips, chipAliases, pauseExpiredSql, limit = 40, offset = 0, leadsTable = "leads" } = {}
) {
  if (!isWorkStateTab(state)) throw new Error(`Estado de trabalho desconhecido: ${state}`);
  const { params, hasChipScope } = baseParams({ clientId, now, robotChips, chipAliases });
  params.push(state, limit, offset);
  const stateIdx = params.length - 2;
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  const sql = buildWorkStatePageSql({ hasChipScope, pauseExpiredSql, state, leadsTable, stateIdx, limitIdx, offsetIdx });
  const { rows } = await query(sql, params);
  return rows;
}

// ---------------------------------------------------------------------------
// Em quais chips o robô responde
// ---------------------------------------------------------------------------

const normalize = (value) => (typeof value === "string" ? value.trim() : "");
const isPersonal = (name) => /pessoal/i.test(normalize(name));

function instanceAliases(inst) {
  const urlSuffix = normalize(inst?.dispatch_webhook_url).split("/").filter(Boolean).pop() || "";
  return [normalize(inst?.id), normalize(inst?.name), urlSuffix].filter(Boolean);
}

function agentChipNames(row) {
  const list = Array.isArray(row?.evolution_instances) ? row.evolution_instances.map(normalize).filter(Boolean) : [];
  const legacy = normalize(row?.evolution_instance);
  if (legacy && !list.includes(legacy)) list.push(legacy);
  return list;
}

/**
 * Espelha o portão do webhook (domains/chatbot/routes.js, "resolveInboundAgentConfig" em diante)
 * para dizer, por chip CADASTRADO, quem responde ali:
 *   - chip pessoal: ninguém;
 *   - chip com agente próprio (não arquivado): o agente, se estiver ligado e não for de campanha.
 *     Agente próprio DESLIGADO cala o chip, mesmo que o chip esteja marcado no robô da empresa;
 *   - chip sem agente próprio: o robô da empresa, se chatbot_enabled não for false e o chip
 *     estiver na lista chatbot_instances (lista vazia = todos).
 *
 * @returns {{ robotChips: string[], byChip: Record<string, {kind: "agente"|"empresa"|"nenhum", agentName: string|null, reason: string}> }}
 *   robotChips e as chaves de byChip trazem todos os apelidos (id, nome, sufixo da URL).
 */
export function resolveRobotChips({ settings = null, agents = [], instances = [] } = {}) {
  const liveAgents = (agents || []).filter((row) => !row?.archived_at);
  const aliasesOf = (value) => {
    const wanted = normalize(value);
    const match = (instances || []).find((inst) => instanceAliases(inst).includes(wanted));
    return match ? instanceAliases(match) : wanted ? [wanted] : [];
  };
  const genericFallback = liveAgents.length === 1 && agentChipNames(liveAgents[0]).length === 0 ? liveAgents[0] : null;
  const companyList = Array.isArray(settings?.chatbot_instances)
    ? settings.chatbot_instances.map((v) => normalize(String(v ?? ""))).filter(Boolean)
    : [];

  const robotChips = new Set();
  const byChip = {};

  for (const inst of instances || []) {
    const aliases = instanceAliases(inst);
    if (aliases.length === 0) continue;

    let verdict;
    if (aliases.some(isPersonal)) {
      verdict = { kind: "nenhum", agentName: null, reason: "chip_pessoal" };
    } else {
      const candidates = liveAgents.filter((row) =>
        agentChipNames(row).flatMap(aliasesOf).some((alias) => aliases.includes(alias))
      );
      const own = candidates.find((row) => row.inbound_enabled === true) || candidates[0] || genericFallback;
      if (own) {
        if (own.inbound_enabled !== true) {
          verdict = { kind: "nenhum", agentName: normalize(own.name) || null, reason: "agente_do_chip_desligado" };
        } else if (own.agent_kind === "campanha") {
          verdict = { kind: "nenhum", agentName: normalize(own.name) || null, reason: "agente_so_de_campanha" };
        } else {
          verdict = { kind: "agente", agentName: normalize(own.name) || null, reason: "agente_do_chip" };
        }
      } else if (!settings || settings.chatbot_enabled === false) {
        verdict = { kind: "nenhum", agentName: null, reason: "robo_da_empresa_desligado" };
      } else if (companyList.length > 0 && !companyList.some((name) => aliases.includes(name))) {
        verdict = { kind: "nenhum", agentName: null, reason: "chip_fora_do_robo_da_empresa" };
      } else {
        verdict = { kind: "empresa", agentName: null, reason: "robo_da_empresa" };
      }
    }

    for (const alias of aliases) {
      byChip[alias] = verdict;
      if (verdict.kind !== "nenhum") robotChips.add(alias);
    }
  }

  return { robotChips: Array.from(robotChips), byChip };
}
