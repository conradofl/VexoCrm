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
import { SQL_AUTOMATION_MATCH, SQL_NUMBER_CHANGE_MATCH, SQL_WORK_QUEUE_MATCH } from "./inboxSqlMatchers.js";

export const WORK_STATES = ["esperam", "com_lead", "robo", "esfriaram"];
export const AWAITING_WINDOW_DAYS = 7;
// "Esperando há muito": o mesmo limite que o Dashboard mostra (SLOW_FIRST_RESPONSE_HOURS).
export const WAITING_THRESHOLD_HOURS = 3;

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
    conv AS (
      -- Toda conversa, com a marca de quem está na fila de trabalho. O contador lê daqui
      -- (uma passada só, inclusive grupos, automações e arquivadas do rodapé da coluna).
      SELECT
        m.*,
        ${SQL_WORK_QUEUE_MATCH("m", "cs")} AS in_queue,
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
    ),
    work_conv AS (
      SELECT * FROM conv WHERE in_queue
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

/**
 * SQL dos contadores da coluna: UMA linha, uma passada pelas conversas.
 *   - os quatro estados de trabalho (mesmo CASE da lista);
 *   - quantas de "esperam" passaram de WAITING_THRESHOLD_HOURS;
 *   - grupos, automações, arquivadas e pausadas, com os mesmos predicados das abas antigas.
 * Exposto pelo mesmo motivo de buildWorkStatePageSql.
 */
export function buildWorkStateCountsSql({ hasChipScope = false, pauseExpiredSql = "false" } = {}) {
  const states = WORK_STATES.map(
    (state) => `count(*) FILTER (WHERE c.in_queue AND c.work_state = '${state}')::integer AS ${state}`
  ).join(",\n      ");
  return `
    WITH ${buildWorkConvCte({ hasChipScope, pauseExpiredSql })}
    SELECT
      ${states},
      count(*) FILTER (
        WHERE c.in_queue AND c.work_state = 'esperam'
          AND c.effective_timestamp < $2::timestamptz - make_interval(hours => ${WAITING_THRESHOLD_HOURS})
      )::integer AS esperam_over_threshold,
      count(*) FILTER (WHERE c.is_group IS TRUE AND COALESCE(c.chat_state, 'ativa') != 'lixeira')::integer AS groups_count,
      count(*) FILTER (WHERE c.is_group IS NOT TRUE AND c.chat_state = 'arquivada')::integer AS archived_count,
      count(*) FILTER (
        WHERE c.is_group IS NOT TRUE
          AND (c.chat_state = 'automacao' OR (c.chat_state IS NULL AND ${SQL_AUTOMATION_MATCH("c.message_text")}))
          AND NOT ${SQL_NUMBER_CHANGE_MATCH("c.message_text")}
      )::integer AS automations_count,
      count(*) FILTER (
        WHERE c.is_group IS NOT TRUE AND c.agent_muted_at IS NOT NULL AND NOT c.agent_mute_expired
          AND COALESCE(c.chat_state, 'ativa') != 'lixeira'
      )::integer AS paused_count
    FROM conv c`;
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
 * Todos os contadores da coluna, de uma consulta só.
 * @param {(sql: string, params: any[]) => Promise<{rows: any[]}>} query
 * @returns {Promise<{work: Record<string, number>, waitingOverThreshold: number, groups: number, archived: number, automations: number, paused: number}>}
 */
export async function fetchInboxCounts(query, { clientId, now, robotChips, chipAliases, pauseExpiredSql } = {}) {
  const { params, hasChipScope } = baseParams({ clientId, now, robotChips, chipAliases });
  const { rows } = await query(buildWorkStateCountsSql({ hasChipScope, pauseExpiredSql }), params);
  const row = rows[0] || {};
  const int = (v) => Number(v) || 0;
  return {
    work: Object.fromEntries(WORK_STATES.map((state) => [state, int(row[state])])),
    waitingOverThreshold: int(row.esperam_over_threshold),
    groups: int(row.groups_count),
    archived: int(row.archived_count),
    automations: int(row.automations_count),
    paused: int(row.paused_count),
  };
}

/** Quantas conversas em cada estado de trabalho. Sempre devolve as quatro chaves. */
export async function fetchWorkStateCounts(query, options = {}) {
  return (await fetchInboxCounts(query, options)).work;
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

// ---------------------------------------------------------------------------
// Contexto da fila (pausa vencida + chips do robô) e o número que o Dashboard lê
// ---------------------------------------------------------------------------

const AGENTS_SQL = `SELECT name, evolution_instance, evolution_instances, inbound_enabled, agent_kind, archived_at
                      FROM public.followup_companies
                     WHERE tenant_id = $1 AND archived_at IS NULL`;

async function defaultLoadSettings(clientId) {
  const { getLeadClientN8nSettings } = await import("./n8nSettings.js");
  return getLeadClientN8nSettings(clientId);
}

async function defaultLoadInstances(clientId) {
  const { getLeadClientEvolutionInstances } = await import("./evolution.js");
  return getLeadClientEvolutionInstances(clientId);
}

/**
 * O que a consulta da fila precisa saber da empresa: a expressão de "pausa vencida" e em
 * quais chips o robô responde. A rota da aba e o Dashboard passam por aqui, para os dois
 * contarem com a mesma regra.
 *
 * Falha ao ler agentes ou chips = nenhum chip de robô: na dúvida a conversa fica com a
 * pessoa, nunca "com o robô".
 */
export async function loadWorkStateContext(
  pool,
  clientId,
  { settings, loadSettings = defaultLoadSettings, loadInstances = defaultLoadInstances } = {}
) {
  const { resolveAgentPauseExpiryDays, agentPauseExpiredSql } = await import("./agentMuteGuard.js");
  const tenantSettings = settings !== undefined ? settings : await loadSettings(clientId).catch(() => null);
  const pauseExpiredSql = agentPauseExpiredSql(resolveAgentPauseExpiryDays(tenantSettings), "cs");

  let robotInfo = { robotChips: [], byChip: {} };
  try {
    const [agentsRes, instances] = await Promise.all([pool.query(AGENTS_SQL, [clientId]), loadInstances(clientId)]);
    robotInfo = resolveRobotChips({ settings: tenantSettings, agents: agentsRes?.rows || [], instances: instances || [] });
  } catch (err) {
    console.warn("[inboxWorkState] não foi possível resolver os chips do robô:", err?.message || err);
  }
  return { settings: tenantSettings, pauseExpiredSql, robotInfo };
}

/**
 * Contrato do Dashboard ("Pessoas esperam resposta"): o número é o da aba "Esperam você",
 * de todos os chips. Não existe segunda conta: é a mesma consulta dos contadores da aba,
 * com o mesmo teto de tempo.
 * @returns {Promise<{waiting: number, waitingOverThreshold: number}>}
 */
export async function countWaitingForDashboard(pool, { clientId, now } = {}, deps = {}) {
  const { pauseExpiredSql, robotInfo } = await loadWorkStateContext(pool, clientId, deps);
  const run = (query) =>
    fetchInboxCounts(query, { clientId, now, robotChips: robotInfo.robotChips, chipAliases: null, pauseExpiredSql });
  // O pool de produção tem connect() e a consulta roda com teto. Sem connect() (banco em
  // memória dos testes) roda a MESMA consulta direto, sem teto.
  const counts =
    typeof pool?.connect === "function"
      ? await withStatementTimeout(pool, WORK_STATE_QUERY_TIMEOUT_MS, run)
      : await run((sql, params) => pool.query(sql, params));
  return { waiting: counts.work.esperam, waitingOverThreshold: counts.waitingOverThreshold };
}
