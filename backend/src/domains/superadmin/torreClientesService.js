import { resolveChipDailyLimit } from "../../services/chipQuota.js";
import { getDateKey } from "../../services/analytics.js";
import { enviarMensagemWhatsAppComFallback, DIRETORES_AUTORIZADOS } from "../goclaw/heloisaEngine.js";
import { GD_COLABORADORES } from "../gdClientes/gdColaboradoresMemoria.js";

const inMemoryTorreStore = new Map();

const COLABORADORES_PADRAO = [
  { nome: "Gabriel Oliveira", cargo: "Comercial / Operação", telefone: "5534996916397" },
  { nome: "Caio Almeida", cargo: "Diretor Comercial", telefone: "5534997719779" },
  { nome: "Conrado Finzi", cargo: "Diretor Executivo", telefone: "5534997817660" },
  ...(GD_COLABORADORES || []).filter(
    (c) => !["caio almeida", "conrado finzi", "gabriel", "gabriel oliveira"].includes(String(c.nome || "").toLowerCase())
  ),
];

export function classifyFuturoContatoStatus(futuroContatoIso, now = new Date()) {
  if (!futuroContatoIso) return "sem_agendamento";
  const target = new Date(futuroContatoIso);
  if (Number.isNaN(target.getTime())) return "sem_agendamento";

  const nowMs = now.getTime();
  const targetMs = target.getTime();
  if (targetMs < nowMs) {
    return "atrasado";
  }

  const sameDay =
    target.getUTCFullYear() === now.getUTCFullYear() &&
    target.getUTCMonth() === now.getUTCMonth() &&
    target.getUTCDate() === now.getUTCDate();
  if (sameDay || targetMs - nowMs <= 12 * 3600 * 1000) {
    return "hoje";
  }
  return "agendado";
}

export function computeEstimatedCampaignEnd({ remainingInQueue, dailyLimitTotal, now = new Date() }) {
  const rem = Number(remainingInQueue) || 0;
  if (rem <= 0) return null;
  const capacity = Math.max(Number(dailyLimitTotal) || 0, 30);
  const daysNeeded = Math.max(1, Math.ceil(rem / capacity));
  return new Date(now.getTime() + daysNeeded * 24 * 3600 * 1000).toISOString();
}

async function readTorreConfigEntries(pool) {
  const result = new Map(inMemoryTorreStore);
  if (!pool || typeof pool.query !== "function") return result;
  try {
    const { rows } = await pool.query(
      `SELECT chave, valor FROM public.heloisa_config WHERE chave = 'torre_controle_config' OR chave LIKE 'torre_cliente:%'`
    );
    for (const r of rows || []) {
      const val = typeof r.valor === "string" ? JSON.parse(r.valor) : r.valor;
      result.set(r.chave, val);
    }
  } catch {
    // Fallback para memória caso tabela não exista no ambiente de teste
  }
  return result;
}

async function writeTorreConfigEntry(pool, chave, valor, updatedBy = "Conrado") {
  inMemoryTorreStore.set(chave, valor);
  if (!pool || typeof pool.query !== "function") return valor;
  try {
    await pool.query(
      `INSERT INTO public.heloisa_config (chave, valor, updated_at, updated_by)
       VALUES ($1, $2::jsonb, NOW(), $3)
       ON CONFLICT (chave) DO UPDATE
         SET valor = EXCLUDED.valor,
             updated_at = NOW(),
             updated_by = EXCLUDED.updated_by`,
      [chave, JSON.stringify(valor), updatedBy]
    );
  } catch {
    // Mantém em memória se tabela não estiver disponível
  }
  return valor;
}

export async function isGdTorreAccessEnabled(pool) {
  const entries = await readTorreConfigEntries(pool);
  const cfg = entries.get("torre_controle_config");
  return cfg?.gdAccessEnabled !== false;
}

export async function setGdTorreAccess(pool, { enabled, updatedBy = "Conrado" }) {
  const payload = {
    gdAccessEnabled: Boolean(enabled),
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await writeTorreConfigEntry(pool, "torre_controle_config", payload, updatedBy);
  return payload;
}

export async function registrarContatoTorreCliente(
  pool,
  {
    clientId,
    responsavel,
    telefoneEmpresa,
    instrucaoWandinha,
    horarioContato,
    futuroContato,
    resumo,
    proximoAssunto,
    demandaAtual,
    criadoPor = "Conrado",
  }
) {
  const chave = `torre_cliente:${clientId}`;
  const entries = await readTorreConfigEntries(pool);
  const atual = entries.get(chave) || {
    clientId,
    responsavel: "",
    telefoneEmpresa: "",
    instrucaoWandinha: "",
    horarioContato: null,
    futuroContato: null,
    demandaAtual: "",
    proximoAssunto: "",
    historicoContatos: [],
  };

  const agoraIso = new Date().toISOString();
  const horarioFinal = horarioContato ? new Date(horarioContato).toISOString() : agoraIso;
  const futuroFinal = futuroContato ? new Date(futuroContato).toISOString() : atual.futuroContato || null;
  const responsavelFinal = responsavel !== undefined ? String(responsavel || "").trim() : atual.responsavel || "";
  const telefoneEmpresaFinal =
    telefoneEmpresa !== undefined ? String(telefoneEmpresa || "").trim() : atual.telefoneEmpresa || "";
  const instrucaoWandinhaFinal =
    instrucaoWandinha !== undefined ? String(instrucaoWandinha || "").trim() : atual.instrucaoWandinha || "";
  const resumoFinal = String(resumo || demandaAtual || "").trim();
  const assuntoFuturoFinal =
    proximoAssunto !== undefined ? String(proximoAssunto || "").trim() : atual.proximoAssunto || "";
  const demandaFinal =
    demandaAtual !== undefined ? String(demandaAtual || "").trim() : resumoFinal || atual.demandaAtual || "";

  const novoRegistro = {
    id: `ct-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    horarioContato: horarioFinal,
    futuroContato: futuroFinal,
    responsavel: responsavelFinal || "Não definido",
    resumo: resumoFinal || "Contato registrado na Torre de Controle",
    proximoAssunto: assuntoFuturoFinal,
    criadoEm: agoraIso,
    criadoPor,
  };

  const historico = [novoRegistro, ...(Array.isArray(atual.historicoContatos) ? atual.historicoContatos : [])].slice(
    0,
    50
  );

  const atualizado = {
    clientId,
    responsavel: responsavelFinal,
    telefoneEmpresa: telefoneEmpresaFinal,
    instrucaoWandinha: instrucaoWandinhaFinal,
    horarioContato: horarioFinal,
    futuroContato: futuroFinal,
    demandaAtual: demandaFinal,
    proximoAssunto: assuntoFuturoFinal,
    updatedAt: agoraIso,
    updatedBy: criadoPor,
    historicoContatos: historico,
  };

  await writeTorreConfigEntry(pool, chave, atualizado, criadoPor);
  return { registro: novoRegistro, clienteControle: atualizado };
}

export async function salvarConfigWandinhaTorreCliente(
  pool,
  { clientId, telefoneEmpresa, instrucaoWandinha, responsavel, updatedBy = "Conrado" }
) {
  const chave = `torre_cliente:${clientId}`;
  const entries = await readTorreConfigEntries(pool);
  const atual = entries.get(chave) || {
    clientId,
    responsavel: "",
    telefoneEmpresa: "",
    instrucaoWandinha: "",
    horarioContato: null,
    futuroContato: null,
    demandaAtual: "",
    proximoAssunto: "",
    historicoContatos: [],
  };

  const atualizado = {
    ...atual,
    responsavel: responsavel !== undefined ? String(responsavel || "").trim() : atual.responsavel || "",
    telefoneEmpresa:
      telefoneEmpresa !== undefined ? String(telefoneEmpresa || "").trim() : atual.telefoneEmpresa || "",
    instrucaoWandinha:
      instrucaoWandinha !== undefined ? String(instrucaoWandinha || "").trim() : atual.instrucaoWandinha || "",
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  await writeTorreConfigEntry(pool, chave, atualizado, updatedBy);
  return atualizado;
}

export async function editarContatoTorreCliente(
  pool,
  {
    clientId,
    contatoId,
    responsavel,
    telefoneEmpresa,
    instrucaoWandinha,
    horarioContato,
    futuroContato,
    resumo,
    proximoAssunto,
    demandaAtual,
    updatedBy = "Conrado",
  }
) {
  const chave = `torre_cliente:${clientId}`;
  const entries = await readTorreConfigEntries(pool);
  const atual = entries.get(chave);
  if (!atual) return null;

  const agoraIso = new Date().toISOString();
  const horarioFinal = horarioContato ? new Date(horarioContato).toISOString() : atual.horarioContato || agoraIso;
  const futuroFinal =
    futuroContato !== undefined
      ? futuroContato
        ? new Date(futuroContato).toISOString()
        : null
      : atual.futuroContato || null;
  const responsavelFinal = responsavel !== undefined ? String(responsavel || "").trim() : atual.responsavel || "";
  const telefoneEmpresaFinal =
    telefoneEmpresa !== undefined ? String(telefoneEmpresa || "").trim() : atual.telefoneEmpresa || "";
  const instrucaoWandinhaFinal =
    instrucaoWandinha !== undefined ? String(instrucaoWandinha || "").trim() : atual.instrucaoWandinha || "";
  const resumoFinal =
    resumo !== undefined || demandaAtual !== undefined
      ? String(resumo ?? demandaAtual ?? "").trim()
      : atual.demandaAtual || "";
  const assuntoFuturoFinal =
    proximoAssunto !== undefined ? String(proximoAssunto || "").trim() : atual.proximoAssunto || "";

  let historico = Array.isArray(atual.historicoContatos) ? [...atual.historicoContatos] : [];
  if (contatoId && historico.some((c) => c.id === contatoId)) {
    historico = historico.map((c) =>
      c.id === contatoId
        ? {
            ...c,
            horarioContato: horarioFinal,
            futuroContato: futuroFinal,
            responsavel: responsavelFinal || c.responsavel || "Não definido",
            resumo: resumoFinal || c.resumo,
            proximoAssunto: assuntoFuturoFinal,
            editadoEm: agoraIso,
            editadoPor: updatedBy,
          }
        : c
    );
  } else if (historico.length > 0) {
    historico[0] = {
      ...historico[0],
      horarioContato: horarioFinal,
      futuroContato: futuroFinal,
      responsavel: responsavelFinal || historico[0].responsavel || "Não definido",
      resumo: resumoFinal || historico[0].resumo,
      proximoAssunto: assuntoFuturoFinal,
      editadoEm: agoraIso,
      editadoPor: updatedBy,
    };
  }

  const maisRecente = historico[0] || null;
  const atualizado = {
    ...atual,
    responsavel: maisRecente ? maisRecente.responsavel : responsavelFinal,
    telefoneEmpresa: telefoneEmpresaFinal,
    instrucaoWandinha: instrucaoWandinhaFinal,
    horarioContato: maisRecente ? maisRecente.horarioContato : horarioFinal,
    futuroContato: maisRecente ? maisRecente.futuroContato : futuroFinal,
    demandaAtual: maisRecente ? maisRecente.resumo : resumoFinal,
    proximoAssunto: maisRecente ? maisRecente.proximoAssunto || "" : assuntoFuturoFinal,
    historicoContatos: historico,
    updatedAt: agoraIso,
    updatedBy,
  };

  await writeTorreConfigEntry(pool, chave, atualizado, updatedBy);
  return atualizado;
}

export async function limparControleContatoTorreCliente(pool, { clientId, updatedBy = "Conrado" }) {
  const chave = `torre_cliente:${clientId}`;
  const entries = await readTorreConfigEntries(pool);
  const atual = entries.get(chave) || { clientId, historicoContatos: [] };
  const atualizado = {
    ...atual,
    horarioContato: null,
    futuroContato: null,
    demandaAtual: "",
    proximoAssunto: "",
    updatedAt: new Date().toISOString(),
    updatedBy,
  };
  await writeTorreConfigEntry(pool, chave, atualizado, updatedBy);
  return atualizado;
}

export async function removerContatoTorreCliente(pool, { clientId, contatoId, updatedBy = "Conrado" }) {
  const chave = `torre_cliente:${clientId}`;
  const entries = await readTorreConfigEntries(pool);
  const atual = entries.get(chave);
  if (!atual) return null;

  const historico = (Array.isArray(atual.historicoContatos) ? atual.historicoContatos : []).filter(
    (c) => c.id !== contatoId
  );
  const maisRecente = historico[0] || null;

  const atualizado = {
    ...atual,
    horarioContato: maisRecente ? maisRecente.horarioContato : null,
    futuroContato: maisRecente ? maisRecente.futuroContato : null,
    demandaAtual: maisRecente ? maisRecente.resumo || "" : "",
    proximoAssunto: maisRecente ? maisRecente.proximoAssunto || "" : "",
    historicoContatos: historico,
    updatedAt: new Date().toISOString(),
    updatedBy,
  };

  await writeTorreConfigEntry(pool, chave, atualizado, updatedBy);
  return atualizado;
}

export async function buildTorreClientesOverview(pool, { now = new Date() } = {}) {
  const entries = await readTorreConfigEntries(pool);
  const globalCfg = entries.get("torre_controle_config") || { gdAccessEnabled: true };
  const todayKey = getDateKey(now, "America/Sao_Paulo");

  let clientsRows = [];
  let chipsRows = [];
  let usageRows = [];
  let runsByChipRows = [];
  let msgsByChipRows = [];
  let campaignsRows = [];
  let dispatchesRows = [];
  let msgStatsRows = [];
  let waitingLeadsRows = [];
  let stuckStepRows = [];

  if (pool && typeof pool.query === "function") {
    const [cRes, chRes, uRes, rChipRes, mChipRes, campRes, dispRes, mRes, wRes, stRes] = await Promise.all([
      pool
        .query(`SELECT id, name, created_at FROM public.leads_clients ORDER BY name ASC`)
        .catch(() => ({ rows: [] })),
      pool
        .query(
          `SELECT *
             FROM public.lead_client_evolution_instances
            WHERE active = true
            ORDER BY is_default DESC, id ASC`
        )
        .catch(() => ({ rows: [] })),
      pool
        .query(
          `SELECT
             instance_id::text AS instance_id,
             COALESCE(SUM(sent_count) FILTER (WHERE date = $1::date), 0)::int AS sent_today,
             COALESCE(SUM(sent_count), 0)::int AS sent_total
           FROM public.evolution_instance_daily_usage
           GROUP BY instance_id::text`,
          [todayKey]
        )
        .catch(() =>
          pool
            .query(
              `SELECT
                 instance_id::text AS instance_id,
                 COALESCE(SUM(sent_count) FILTER (WHERE usage_date = $1), 0)::int AS sent_today,
                 COALESCE(SUM(sent_count), 0)::int AS sent_total
               FROM public.evolution_instance_daily_usage
               GROUP BY instance_id::text`,
              [todayKey]
            )
            .catch(() => ({ rows: [] }))
        ),
      pool
        .query(
          `SELECT
             evolution_instance_id::text AS instance_id,
             COUNT(*) FILTER (WHERE status = 'sent' AND COALESCE(sent_at, updated_at) >= NOW() - INTERVAL '24 hours')::int AS runs_today,
             COUNT(*) FILTER (WHERE status = 'sent')::int AS runs_total
           FROM public.campaign_dispatch_runs
           WHERE evolution_instance_id IS NOT NULL
           GROUP BY evolution_instance_id::text`
        )
        .catch(() => ({ rows: [] })),
      pool
        .query(
          `SELECT
             client_id,
             LOWER(TRIM(instance_name)) AS instance_key,
             COUNT(*) FILTER (WHERE direction = 'outbound' AND COALESCE(message_timestamp, created_at) >= NOW() - INTERVAL '24 hours')::int AS msgs_today,
             COUNT(*) FILTER (WHERE direction = 'outbound')::int AS msgs_total
           FROM public.lead_messages
           WHERE instance_name IS NOT NULL AND TRIM(instance_name) <> ''
           GROUP BY client_id, LOWER(TRIM(instance_name))`
        )
        .catch(() => ({ rows: [] })),
      pool
        .query(
          `SELECT *
             FROM public.campaigns
            WHERE archived_at IS NULL
            ORDER BY COALESCE(last_triggered_at, created_at) DESC`
        )
        .catch(() => ({ rows: [] })),
      pool
        .query(
          `SELECT
             d.*,
             COALESCE(r.sent_cnt, d.sent_count, 0)::int AS real_sent_count,
             COALESCE(r.failed_cnt, d.failed_count, 0)::int AS real_failed_count,
             COALESCE(r.skipped_cnt, 0)::int AS real_skipped_count
           FROM public.campaign_dispatches d
           LEFT JOIN (
             SELECT
               dispatch_id,
               COUNT(*) FILTER (WHERE status = 'sent') AS sent_cnt,
               COUNT(*) FILTER (WHERE status IN ('failed', 'invalid_number')) AS failed_cnt,
               COUNT(*) FILTER (WHERE status = 'skipped') AS skipped_cnt
             FROM public.campaign_dispatch_runs
             GROUP BY dispatch_id
           ) r ON r.dispatch_id = d.id
           ORDER BY d.created_at DESC`
        )
        .catch(() =>
          pool
            .query(`SELECT * FROM public.campaign_dispatches ORDER BY created_at DESC`)
            .catch(() => ({ rows: [] }))
        ),
      pool
        .query(
          `SELECT
             client_id,
             COUNT(*) FILTER (WHERE direction = 'outbound' AND COALESCE(message_timestamp, created_at) >= NOW() - INTERVAL '24 hours')::int AS sent_today,
             COUNT(*) FILTER (WHERE direction = 'inbound' AND COALESCE(message_timestamp, created_at) >= NOW() - INTERVAL '24 hours')::int AS replies_today,
             COUNT(*) FILTER (WHERE direction = 'outbound')::int AS sent_30d,
             COUNT(*) FILTER (WHERE direction = 'inbound')::int AS replies_30d,
             COUNT(DISTINCT phone) FILTER (WHERE direction = 'inbound')::int AS unique_repliers_30d,
             MAX(COALESCE(message_timestamp, created_at)) FILTER (WHERE direction = 'outbound') AS last_outbound_at,
             MAX(COALESCE(message_timestamp, created_at)) FILTER (WHERE direction = 'inbound') AS last_inbound_at
           FROM public.lead_messages
           WHERE COALESCE(message_timestamp, created_at) >= NOW() - INTERVAL '30 days'
           GROUP BY client_id`
        )
        .catch(() =>
          pool
            .query(
              `SELECT
                 client_id,
                 COUNT(*) FILTER (WHERE direction = 'outbound' AND COALESCE(message_timestamp, created_at) >= NOW() - INTERVAL '24 hours')::int AS sent_today,
                 COUNT(*) FILTER (WHERE direction = 'inbound' AND COALESCE(message_timestamp, created_at) >= NOW() - INTERVAL '24 hours')::int AS replies_today,
                 COUNT(*) FILTER (WHERE direction = 'outbound')::int AS sent_30d,
                 COUNT(*) FILTER (WHERE direction = 'inbound')::int AS replies_30d,
                 MAX(COALESCE(message_timestamp, created_at)) FILTER (WHERE direction = 'outbound') AS last_outbound_at,
                 MAX(COALESCE(message_timestamp, created_at)) FILTER (WHERE direction = 'inbound') AS last_inbound_at
               FROM public.lead_messages
               WHERE COALESCE(message_timestamp, created_at) >= NOW() - INTERVAL '30 days'
               GROUP BY client_id`
            )
            .catch(() => ({ rows: [] }))
        ),
      pool
        .query(
          `SELECT client_id, COUNT(*)::int AS waiting_cnt
             FROM (
               SELECT DISTINCT ON (client_id, phone)
                 client_id, phone, direction, COALESCE(message_timestamp, created_at) AS ts
               FROM public.lead_messages
               WHERE COALESCE(message_timestamp, created_at) >= NOW() - INTERVAL '14 days'
               ORDER BY client_id, phone, COALESCE(message_timestamp, created_at) DESC
             ) last_m
            WHERE direction = 'inbound' AND ts < NOW() - INTERVAL '2 hours'
            GROUP BY client_id`
        )
        .catch(() => ({ rows: [] })),
      pool
        .query(
          `SELECT
             d.client_id,
             COUNT(*) FILTER (WHERE r.status IN ('waiting_reply', 'awaiting_reply', 'held_quota', 'pending_step', 'queued_step'))::int AS stuck_steps_cnt
           FROM public.campaign_dispatch_runs r
           JOIN public.campaign_dispatches d ON d.id = r.dispatch_id
           GROUP BY d.client_id`
        )
        .catch(() => ({ rows: [] })),
    ]);

    clientsRows = cRes.rows || [];
    chipsRows = chRes.rows || [];
    usageRows = uRes.rows || [];
    runsByChipRows = rChipRes.rows || [];
    msgsByChipRows = mChipRes.rows || [];
    campaignsRows = campRes.rows || [];
    dispatchesRows = dispRes.rows || [];
    msgStatsRows = mRes.rows || [];
    waitingLeadsRows = wRes.rows || [];
    stuckStepRows = stRes.rows || [];
  }

  const usageByChipId = new Map();
  for (const u of usageRows) {
    usageByChipId.set(String(u.instance_id), {
      sentToday: Number(u.sent_today) || 0,
      sentTotal: Number(u.sent_total) || 0,
    });
  }

  const runsByChipId = new Map();
  for (const r of runsByChipRows) {
    runsByChipId.set(String(r.instance_id), {
      runsToday: Number(r.runs_today) || 0,
      runsTotal: Number(r.runs_total) || 0,
    });
  }

  const msgsByClientAndKey = new Map();
  for (const m of msgsByChipRows) {
    const key = `${String(m.client_id || "")}|${String(m.instance_key || "")}`;
    msgsByClientAndKey.set(key, {
      msgsToday: Number(m.msgs_today) || 0,
      msgsTotal: Number(m.msgs_total) || 0,
    });
  }

  const chipsByClient = new Map();
  for (const ch of chipsRows) {
    const cid = String(ch.client_id || "");
    if (!chipsByClient.has(cid)) chipsByClient.set(cid, []);
    const limit = resolveChipDailyLimit(ch);
    const chipIdStr = String(ch.id);
    const slug = ch.dispatch_webhook_url ? String(ch.dispatch_webhook_url).split("/").filter(Boolean).pop() : null;
    const nameKey = String(ch.name || "").trim().toLowerCase();
    const slugKey = String(slug || "").trim().toLowerCase();

    const uStat = usageByChipId.get(chipIdStr) || { sentToday: 0, sentTotal: 0 };
    const rStat = runsByChipId.get(chipIdStr) || { runsToday: 0, runsTotal: 0 };
    const mStatName = nameKey ? msgsByClientAndKey.get(`${cid}|${nameKey}`) : null;
    const mStatSlug = slugKey && slugKey !== nameKey ? msgsByClientAndKey.get(`${cid}|${slugKey}`) : null;
    const mStatId = msgsByClientAndKey.get(`${cid}|${chipIdStr.toLowerCase()}`) || null;

    const msgsToday = (mStatName?.msgsToday || 0) + (mStatSlug?.msgsToday || 0) + (mStatId?.msgsToday || 0);
    const msgsTotal = (mStatName?.msgsTotal || 0) + (mStatSlug?.msgsTotal || 0) + (mStatId?.msgsTotal || 0);

    // Prioriza a cota oficial do dia (evolution_instance_daily_usage, igual à tela Chips WhatsApp), com fallback para runs/mensagens
    const usedToday = uStat.sentToday > 0 ? uStat.sentToday : Math.max(rStat.runsToday, msgsToday);
    const totalSent = Math.max(uStat.sentTotal, rStat.runsTotal, msgsTotal, usedToday);

    const isConnected = ch.connection_state === "open" || !ch.connection_state || ch.connection_state === "unknown";
    chipsByClient.get(cid).push({
      id: chipIdStr,
      name: ch.name || "Chip",
      phone: ch.phone || slug || null,
      connected: isConnected,
      connectionState: ch.connection_state || "open",
      chipState: ch.chip_state || "cold",
      usedToday,
      totalSent,
      dailyLimit: limit,
      isDefault: Boolean(ch.is_default),
      balancePercentToday: 0,
      balancePercentTotal: 0,
    });
  }

  // Calcula o balanceamento (% de participação de cada chip nos disparos do dia e no total da empresa)
  for (const list of chipsByClient.values()) {
    const sumToday = list.reduce((acc, c) => acc + c.usedToday, 0);
    const sumTotal = list.reduce((acc, c) => acc + c.totalSent, 0);
    for (const chip of list) {
      chip.balancePercentToday =
        sumToday > 0 ? Math.round((chip.usedToday / sumToday) * 100) : list.length > 0 ? Math.round(100 / list.length) : 0;
      chip.balancePercentTotal =
        sumTotal > 0 ? Math.round((chip.totalSent / sumTotal) * 100) : list.length > 0 ? Math.round(100 / list.length) : 0;
    }
  }

  // Agrupa lotes por campaign_id
  const dispatchesByCampaign = new Map();
  for (const d of dispatchesRows) {
    const campId = String(d.campaign_id || "");
    if (!dispatchesByCampaign.has(campId)) dispatchesByCampaign.set(campId, []);
    dispatchesByCampaign.get(campId).push(d);
  }

  const campaignsByClient = new Map();
  for (const c of campaignsRows) {
    const cid = String(c.client_id || "");
    if (!campaignsByClient.has(cid)) campaignsByClient.set(cid, []);
    campaignsByClient.get(cid).push(c);
  }

  const msgStatsByClient = new Map();
  for (const m of msgStatsRows) {
    msgStatsByClient.set(String(m.client_id || ""), m);
  }

  const waitingLeadsByClient = new Map();
  for (const w of waitingLeadsRows) {
    waitingLeadsByClient.set(String(w.client_id || ""), Number(w.waiting_cnt) || 0);
  }

  const stuckStepsByClient = new Map();
  for (const s of stuckStepRows) {
    stuckStepsByClient.set(String(s.client_id || ""), Number(s.stuck_steps_cnt) || 0);
  }

  const quadroAlertas = [];

  const clientes = clientsRows.map((client) => {
    const cid = String(client.id);
    const clientName = client.name || cid;
    const clientChips = chipsByClient.get(cid) || [];
    const connectedChips = clientChips.filter((c) => c.connected).length;
    const disconnectedChips = clientChips.length - connectedChips;
    const restrictedChips = clientChips.filter((c) => {
      const st = String(c.chipState || "").toLowerCase();
      const cs = String(c.connectionState || "").toLowerCase();
      return (
        ["restricted", "blocked", "banned", "quarantine", "bloqueado", "restrito"].includes(st) ||
        ["refused", "banned", "restricted", "blocked"].includes(cs)
      );
    }).length;
    const usedQuotaToday = clientChips.reduce((acc, c) => acc + c.usedToday, 0);
    const totalSentAllChips = clientChips.reduce((acc, c) => acc + (c.totalSent || 0), 0);
    const totalDailyLimit = clientChips.reduce((acc, c) => acc + c.dailyLimit, 0);
    const quotaExhausted = totalDailyLimit > 0 && usedQuotaToday >= totalDailyLimit;

    const rawCampaigns = campaignsByClient.get(cid) || [];
    let clientTotalQueueRemaining = 0;
    let clientTotalSent = 0;
    let clientTotalFailed = 0;
    let clientTotalLeadsInCampaigns = 0;

    const campanhas = rawCampaigns.map((camp) => {
      const lotes = dispatchesByCampaign.get(String(camp.id)) || [];
      const latestLote = lotes[0] || null;
      const meta = camp.analytics_meta && typeof camp.analytics_meta === "object" ? camp.analytics_meta : {};
      const phonesArr = Array.isArray(camp.phones) ? camp.phones : [];
      const stepsArr = Array.isArray(camp.message_sequence)
        ? camp.message_sequence
        : Array.isArray(camp.steps)
        ? camp.steps
        : [];

      const lotesTargetSum = lotes.reduce(
        (acc, l) => acc + (Number(l.target_count) || Number(l.total_leads) || 0),
        0
      );
      const lotesSentSum = lotes.reduce(
        (acc, l) => acc + (Number(l.real_sent_count ?? l.sent_count) || 0),
        0
      );
      const lotesFailedSum = lotes.reduce(
        (acc, l) => acc + (Number(l.real_failed_count ?? l.failed_count) || 0),
        0
      );
      const lotesSkippedSum = lotes.reduce(
        (acc, l) => acc + (Number(l.real_skipped_count ?? l.skipped_count) || 0),
        0
      );

      const totalLeads =
        lotesTargetSum ||
        Number(camp.target_count) ||
        Number(meta?.lastDispatchSummary?.totalLeads) ||
        Number(meta?.totalLeads) ||
        phonesArr.length ||
        lotesSentSum ||
        0;
      const sentCount =
        lotesSentSum ||
        Number(camp.sent_count) ||
        Number(meta?.lastDispatchSummary?.sentCount) ||
        Number(meta?.sentCount) ||
        0;
      const failedCount =
        lotesFailedSum ||
        Number(camp.failed_count) ||
        Number(meta?.lastDispatchSummary?.failedCount) ||
        0;
      const skippedCount = lotesSkippedSum || 0;
      const rawStatus = String(latestLote?.status || camp.status || "rascunho").toLowerCase();

      const isFinished = ["done", "completed", "concluida", "enviada", "cancelled", "cancelada"].includes(rawStatus);
      const remainingInQueue = isFinished ? 0 : Math.max(0, totalLeads - sentCount - failedCount - skippedCount);

      clientTotalQueueRemaining += remainingInQueue;
      clientTotalSent += sentCount;
      clientTotalFailed += failedCount;
      clientTotalLeadsInCampaigns += totalLeads;

      const dataInicio =
        latestLote?.started_at ||
        latestLote?.scheduled_at ||
        camp.starts_at ||
        camp.scheduled_for ||
        camp.last_triggered_at ||
        camp.created_at ||
        null;

      const dataConclusaoReal =
        latestLote?.finished_at ||
        latestLote?.completed_at ||
        camp.ends_at ||
        (isFinished ? latestLote?.updated_at || camp.updated_at : null) ||
        null;
      const previsaoConclusao =
        !dataConclusaoReal && remainingInQueue > 0
          ? computeEstimatedCampaignEnd({ remainingInQueue, dailyLimitTotal: totalDailyLimit, now })
          : null;

      const lastTriggeredIso =
        camp.last_triggered_at || latestLote?.updated_at || latestLote?.started_at || latestLote?.created_at || null;
      const hoursSinceLastTrigger = lastTriggeredIso
        ? Math.max(0, Math.round((now.getTime() - new Date(lastTriggeredIso).getTime()) / (3600 * 1000)))
        : null;

      const isStuck =
        !isFinished &&
        remainingInQueue > 0 &&
        (["paused", "pausada", "interrupted", "interrompido", "failed", "falhou"].includes(rawStatus) ||
          (["running", "ativa", "executando", "queued", "rascunho", "draft"].includes(rawStatus) &&
            sentCount > 0 &&
            hoursSinceLastTrigger !== null &&
            hoursSinceLastTrigger >= 18));

      return {
        id: String(camp.id),
        name: camp.name || "Campanha",
        status: rawStatus,
        startsAt: dataInicio,
        completedAt: dataConclusaoReal,
        estimatedEndAt: previsaoConclusao,
        totalLeads,
        sentCount,
        remainingInQueue,
        failedCount,
        stepsCount: Math.max(1, stepsArr.length || 1),
        isStuck,
        pauseReason:
          latestLote?.pause_reason ||
          latestLote?.error_message ||
          (isStuck && quotaExhausted ? "Retida por cota diária de chip atingida" : null),
        lastTriggeredAt: camp.last_triggered_at || latestLote?.created_at || null,
        createdAt: camp.created_at || null,
      };
    });

    const msgStat = msgStatsByClient.get(cid) || {};
    const controle = entries.get(`torre_cliente:${cid}`) || {
      clientId: cid,
      responsavel: "",
      horarioContato: null,
      futuroContato: null,
      demandaAtual: "",
      proximoAssunto: "",
      historicoContatos: [],
    };

    const futuroContatoStatus = classifyFuturoContatoStatus(controle.futuroContato, now);
    const activeCampaignsCount = campanhas.filter((c) =>
      ["running", "ativa", "executando", "scheduled", "agendada", "queued"].includes(c.status)
    ).length;
    const pausedCampaignsCount = campanhas.filter((c) =>
      ["paused", "pausada", "interrupted", "interrompido", "failed", "falhou"].includes(c.status)
    ).length;
    const stuckCampaigns = campanhas.filter((c) => c.isStuck);
    const stuckStepsCount = stuckStepsByClient.get(cid) || 0;
    const waitingLeadsCount = waitingLeadsByClient.get(cid) || 0;

    // Cálculo de inatividade: dias sem disparar e dias sem criar campanha
    const ultimoDisparoAt = msgStat.last_outbound_at || campanhas[0]?.lastTriggeredAt || null;
    const diasSemDisparo = ultimoDisparoAt
      ? Math.max(0, Math.floor((now.getTime() - new Date(ultimoDisparoAt).getTime()) / (24 * 3600 * 1000)))
      : null;

    const latestCampaignCreatedIso = rawCampaigns.reduce((acc, c) => {
      const ts = c.created_at ? new Date(c.created_at).getTime() : 0;
      return ts > acc ? ts : acc;
    }, 0);
    const diasSemCriarCampanha =
      latestCampaignCreatedIso > 0
        ? Math.max(0, Math.floor((now.getTime() - latestCampaignCreatedIso) / (24 * 3600 * 1000)))
        : null;

    // Métricas de Performance & Retorno para o Pódio Top 5
    const enviadosTotalBase = Math.max(
      Number(msgStat.sent_30d) || 0,
      totalSentAllChips || 0,
      clientTotalSent || 0,
      usedQuotaToday || 0
    );
    const respostasTotal30d = Number(msgStat.replies_30d) || Number(msgStat.replies_today) || 0;
    const leadsQueResponderam = Number(msgStat.unique_repliers_30d) || respostasTotal30d;
    const taxaRetornoPct =
      enviadosTotalBase > 0 ? Math.min(100, Number(((respostasTotal30d / enviadosTotalBase) * 100).toFixed(1))) : 0;
    const taxaFalhaPct =
      clientTotalSent + clientTotalFailed > 0
        ? Number(((clientTotalFailed / (clientTotalSent + clientTotalFailed)) * 100).toFixed(1))
        : 0;
    const scorePerformance = Math.round(
      enviadosTotalBase * 0.25 + respostasTotal30d * 2.2 + taxaRetornoPct * 4 - taxaFalhaPct * 1.5
    );

    // Semáforo inteligente da empresa & Alimentação do Quadro de Avisos/Alertas
    let semaforo = "saudavel";
    const alertas = [];

    if (disconnectedChips > 0 || restrictedChips > 0) {
      semaforo = "critico";
      const msgChip =
        restrictedChips > 0
          ? `${restrictedChips} chip(s) com bloqueio/restrição e ${disconnectedChips} desconectado(s)`
          : `${disconnectedChips} chip(s) desconectado(s)`;
      alertas.push(msgChip);
      quadroAlertas.push({
        id: `al-chip-${cid}`,
        clientId: cid,
        clientName,
        categoria: "chip_bloqueio",
        severidade: "critico",
        titulo: restrictedChips > 0 ? "Chip com bloqueio ou restrição" : "Chip WhatsApp desconectado",
        detalhe: `${msgChip}. Reconecte ou substitua para não travar a fila de ${clientTotalQueueRemaining} leads.`,
        responsavel: controle.responsavel || "Sem responsável",
      });
    }

    if (stuckCampaigns.length > 0 || stuckStepsCount > 0 || (pausedCampaignsCount > 0 && clientTotalQueueRemaining > 0)) {
      semaforo = "critico";
      const campNomes = stuckCampaigns
        .slice(0, 2)
        .map((c) => `${c.name} (${c.sentCount}/${c.totalLeads})`)
        .join(", ");
      const msgTravada =
        stuckCampaigns.length > 0
          ? `Campanha parada/incompleta: ${campNomes} · ${clientTotalQueueRemaining} na fila`
          : `Campanha com ${stuckStepsCount || clientTotalQueueRemaining} etapa(s) retida(s) na fila`;
      alertas.push(msgTravada);
      quadroAlertas.push({
        id: `al-camp-${cid}`,
        clientId: cid,
        clientName,
        categoria: "campanha_travada",
        severidade: "critico",
        titulo: "Campanha pausada/travada sem concluir etapas",
        detalhe: `${msgTravada}${quotaExhausted ? " (Cota diária do chip esgotada hoje)" : ""}.`,
        responsavel: controle.responsavel || "Sem responsável",
      });
    }

    if (futuroContatoStatus === "atrasado") {
      semaforo = "critico";
      const dataFuturoStr = new Date(controle.futuroContato).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      alertas.push(`Futuro contato atrasado (${dataFuturoStr})`);
      quadroAlertas.push({
        id: `al-contato-${cid}`,
        clientId: cid,
        clientName,
        categoria: "futuro_contato",
        severidade: "critico",
        titulo: "Futuro contato vencido / atrasado",
        detalhe: `Retorno agendado para ${dataFuturoStr}${
          controle.proximoAssunto ? ` (${controle.proximoAssunto})` : ""
        } ainda não foi realizado.`,
        responsavel: controle.responsavel || "Sem responsável",
      });
    } else if (futuroContatoStatus === "hoje") {
      if (semaforo !== "critico") semaforo = "atencao";
      const dataFuturoStr = new Date(controle.futuroContato).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
      alertas.push(`Futuro contato HOJE (${dataFuturoStr})`);
      quadroAlertas.push({
        id: `al-contato-hoje-${cid}`,
        clientId: cid,
        clientName,
        categoria: "futuro_contato",
        severidade: "atencao",
        titulo: "Futuro contato agendado para HOJE",
        detalhe: `Retorno programado para hoje (${dataFuturoStr})${
          controle.proximoAssunto ? ` · Assunto: ${controle.proximoAssunto}` : ""
        }.`,
        responsavel: controle.responsavel || "Sem responsável",
      });
    } else if (futuroContatoStatus === "sem_agendamento") {
      if (semaforo !== "critico") semaforo = "atencao";
      alertas.push("Sem futuro contato agendado");
      quadroAlertas.push({
        id: `al-sem-futuro-${cid}`,
        clientId: cid,
        clientName,
        categoria: "futuro_contato",
        severidade: "atencao",
        titulo: "Sem futuro contato agendado",
        detalhe: "Nenhum próximo retorno programado para esta empresa. Agende o Futuro Contato para manter o acompanhamento.",
        responsavel: controle.responsavel || "Sem responsável",
      });
    }

    if (quotaExhausted && clientTotalQueueRemaining > 0) {
      if (semaforo !== "critico") semaforo = "atencao";
      alertas.push(`Cota diária esgotada (${usedQuotaToday}/${totalDailyLimit}) com ${clientTotalQueueRemaining} na fila`);
      quadroAlertas.push({
        id: `al-cota-${cid}`,
        clientId: cid,
        clientName,
        categoria: "cota_fila",
        severidade: "atencao",
        titulo: "Cota diária atingida com fila pendente",
        detalhe: `Chips bateram ${usedQuotaToday}/${totalDailyLimit} msgs hoje e restam ${clientTotalQueueRemaining} leads aguardando próxima etapa.`,
        responsavel: controle.responsavel || "Sem responsável",
      });
    }

    if (taxaFalhaPct >= 15 && clientTotalFailed >= 10) {
      if (semaforo !== "critico") semaforo = "atencao";
      alertas.push(`Taxa de falha elevada (${taxaFalhaPct}% · ${clientTotalFailed} erros)`);
      quadroAlertas.push({
        id: `al-falha-${cid}`,
        clientId: cid,
        clientName,
        categoria: "falha_entrega",
        severidade: "atencao",
        titulo: "Taxa elevada de falhas nos disparos",
        detalhe: `${clientTotalFailed} envios falharam (${taxaFalhaPct}%). Verifique higienização da planilha ou saúde do chip.`,
        responsavel: controle.responsavel || "Sem responsável",
      });
    }

    if (waitingLeadsCount >= 5) {
      if (semaforo !== "critico") semaforo = "atencao";
      alertas.push(`${waitingLeadsCount} leads aguardando resposta no WhatsApp`);
      quadroAlertas.push({
        id: `al-inbox-${cid}`,
        clientId: cid,
        clientName,
        categoria: "leads_sem_resposta",
        severidade: "atencao",
        titulo: `${waitingLeadsCount} leads responderam e aguardam retorno`,
        detalhe: `Há ${waitingLeadsCount} conversas com resposta do lead há mais de 2h esperando atendimento ou 2ª etapa.`,
        responsavel: controle.responsavel || "Sem responsável",
      });
    }

    if (diasSemDisparo === null || diasSemDisparo >= 3 || (activeCampaignsCount === 0 && clientTotalQueueRemaining === 0)) {
      if (semaforo !== "critico") semaforo = "atencao";
      const textoInatividade =
        diasSemDisparo === null
          ? "Sem disparos registrados nos últimos 30 dias"
          : `${diasSemDisparo} dia(s) sem disparar${
              diasSemCriarCampanha !== null ? ` · ${diasSemCriarCampanha}d sem criar campanha` : ""
            }`;
      alertas.push(textoInatividade);
      quadroAlertas.push({
        id: `al-inativo-${cid}`,
        clientId: cid,
        clientName,
        categoria: "inatividade",
        severidade: diasSemDisparo === null || diasSemDisparo >= 7 ? "critico" : "atencao",
        titulo:
          diasSemDisparo === null
            ? "Empresa sem disparos recentes"
            : `Há ${diasSemDisparo} dia(s) sem fazer disparo`,
        detalhe: `${textoInatividade}. ${
          campanhas.length === 0
            ? "Nenhuma campanha criada."
            : `Última campanha há ${diasSemCriarCampanha ?? 0} dia(s).`
        }`,
        responsavel: controle.responsavel || "Sem responsável",
      });
    }

    if (semaforo !== "critico" && alertas.length === 0) {
      if (futuroContatoStatus === "hoje") {
        semaforo = "atencao";
        alertas.push("Futuro contato agendado para hoje");
      } else if (clientChips.length === 0) {
        semaforo = "atencao";
        alertas.push("Sem chip conectado");
      }
    }

    return {
      id: cid,
      name: clientName,
      createdAt: client.created_at,
      semaforo,
      alertas,
      chips: {
        total: clientChips.length,
        connected: connectedChips,
        disconnected: disconnectedChips,
        restricted: restrictedChips,
        usedQuotaToday,
        totalSentAllChips,
        totalDailyLimit,
        quotaExhausted,
        items: clientChips,
      },
      campanhas: {
        total: campanhas.length,
        ativas: activeCampaignsCount,
        pausadas: pausedCampaignsCount,
        travadas: stuckCampaigns.length,
        etapasRetidas: stuckStepsCount,
        totalLeads: clientTotalLeadsInCampaigns,
        enviadosTotal: clientTotalSent,
        filaRestante: clientTotalQueueRemaining,
        falhasTotal: clientTotalFailed,
        diasSemCriarCampanha,
        items: campanhas.slice(0, 8),
      },
      disparos: {
        enviadosHoje: Number(msgStat.sent_today) || usedQuotaToday || 0,
        respostasHoje: Number(msgStat.replies_today) || 0,
        enviados30d: enviadosTotalBase,
        respostas30d: respostasTotal30d,
        leadsQueResponderam,
        taxaRetornoPct,
        taxaFalhaPct,
        scorePerformance,
        leadsAguardandoResposta: waitingLeadsCount,
        diasSemDisparo,
        ultimoDisparoAt,
        ultimaRespostaAt: msgStat.last_inbound_at || null,
      },
      relacionamento: {
        responsavel: controle.responsavel || "",
        telefoneEmpresa: controle.telefoneEmpresa || "",
        instrucaoWandinha: controle.instrucaoWandinha || "",
        horarioContato: controle.horarioContato || null,
        futuroContato: controle.futuroContato || null,
        futuroContatoStatus,
        demandaAtual: controle.demandaAtual || "",
        proximoAssunto: controle.proximoAssunto || "",
        historicoContatos: Array.isArray(controle.historicoContatos) ? controle.historicoContatos : [],
      },
    };
  });

  // Pódio Top 5 Melhores Empresas (Mais dispararam, Mais retorno, Mais responderam, Melhor performance geral)
  const buildTop5 = (sorter) =>
    [...clientes]
      .sort(sorter)
      .slice(0, 5)
      .map((c, index) => ({
        posicao: index + 1,
        clientId: c.id,
        clientName: c.name,
        responsavel: c.relacionamento.responsavel || "Equipe Vexo",
        disparosTotal: c.disparos.enviados30d,
        disparosHoje: c.disparos.enviadosHoje,
        respostasTotal: c.disparos.respostas30d,
        leadsResponderam: c.disparos.leadsQueResponderam,
        taxaRetornoPct: c.disparos.taxaRetornoPct,
        scorePerformance: c.disparos.scorePerformance,
      }));

  const rankingPodium = {
    maisDispararam: buildTop5((a, b) => b.disparos.enviados30d - a.disparos.enviados30d),
    maisResponderam: buildTop5((a, b) => b.disparos.respostas30d - a.disparos.respostas30d),
    maiorTaxaRetorno: buildTop5((a, b) => b.disparos.taxaRetornoPct - a.disparos.taxaRetornoPct),
    melhorPerformance: buildTop5((a, b) => b.disparos.scorePerformance - a.disparos.scorePerformance),
  };

  const resumoGlobal = {
    totalClientes: clientes.length,
    clientesCriticos: clientes.filter((c) => c.semaforo === "critico").length,
    clientesAtencao: clientes.filter((c) => c.semaforo === "atencao").length,
    clientesSaudaveis: clientes.filter((c) => c.semaforo === "saudavel").length,
    contatosAtrasados: clientes.filter((c) => c.relacionamento.futuroContatoStatus === "atrasado").length,
    contatosHoje: clientes.filter((c) => c.relacionamento.futuroContatoStatus === "hoje").length,
    totalFilaPendente: clientes.reduce((acc, c) => acc + c.campanhas.filaRestante, 0),
    totalDisparosHoje: clientes.reduce((acc, c) => acc + c.disparos.enviadosHoje, 0),
    chipsConectados: clientes.reduce((acc, c) => acc + c.chips.connected, 0),
    chipsDesconectados: clientes.reduce((acc, c) => acc + c.chips.disconnected, 0),
    totalAlertasAtivos: quadroAlertas.length,
    campanhasTravadasTotal: clientes.reduce((acc, c) => acc + c.campanhas.travadas + c.campanhas.pausadas, 0),
    empresasInativasTotal: clientes.filter((c) => c.disparos.diasSemDisparo === null || c.disparos.diasSemDisparo >= 3)
      .length,
  };

  return {
    gdAccessEnabled: globalCfg.gdAccessEnabled !== false,
    colaboradoresDisponiveis: COLABORADORES_PADRAO,
    resumoGlobal,
    quadroAlertas,
    rankingPodium,
    clientes,
  };
}

export async function cobrarColaboradorTorreViaWandinha(
  pool,
  {
    clientId,
    clientName,
    responsavel,
    destino = "colaborador",
    telefoneEmpresa,
    instrucaoWandinha,
    mensagemCustomizada,
    updatedBy = "Conrado",
  }
) {
  if (telefoneEmpresa !== undefined || instrucaoWandinha !== undefined) {
    await salvarConfigWandinhaTorreCliente(pool, {
      clientId,
      telefoneEmpresa,
      instrucaoWandinha,
      responsavel,
      updatedBy,
    });
  }

  const entries = await readTorreConfigEntries(pool);
  const controle = entries.get(`torre_cliente:${clientId}`) || {};
  const instrucaoFinal =
    String(instrucaoWandinha ?? controle.instrucaoWandinha ?? "").trim() ||
    controle.demandaAtual ||
    "Verificar campanhas, fila de disparos e chips do cliente.";
  const telefoneEmpresaFinal = String(telefoneEmpresa ?? controle.telefoneEmpresa ?? "").replace(/\D/g, "");

  const horarioStr = controle.horarioContato
    ? new Date(controle.horarioContato).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "Não registrado";
  const futuroStr = controle.futuroContato
    ? new Date(controle.futuroContato).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "Definir agora";

  if (destino === "empresa") {
    if (!telefoneEmpresaFinal || telefoneEmpresaFinal.length < 10) {
      return {
        sucesso: false,
        destinatario: clientName || clientId,
        telefone: telefoneEmpresaFinal,
        message: "Cadastre o número de WhatsApp da empresa antes de enviar mensagem para o cliente via Wandinha.",
      };
    }

    const textoEmpresa =
      mensagemCustomizada ||
      `Olá, equipe *${clientName || clientId}*! Aqui é a *Wandinha*, assistente executiva da *Vexo OS*.\n\n` +
        `${instrucaoFinal}\n\n` +
        `Qualquer dúvida ou alinhamento, estamos à disposição!`;

    const envioEmpresa = await enviarMensagemWhatsAppComFallback({
      numero: telefoneEmpresaFinal,
      texto: textoEmpresa,
      tenantId: "vexo-adm",
      pool,
    });

    return {
      sucesso: Boolean(envioEmpresa?.sucesso),
      destinatario: `${clientName || clientId} (WhatsApp Empresa)`,
      telefone: telefoneEmpresaFinal,
      texto: textoEmpresa,
      envio: envioEmpresa,
    };
  }

  const nomeBusca = String(responsavel || controle.responsavel || "").trim().toLowerCase();
  const colab =
    COLABORADORES_PADRAO.find(
      (c) =>
        c.nome.toLowerCase() === nomeBusca ||
        c.nome.toLowerCase().includes(nomeBusca) ||
        (nomeBusca && nomeBusca.includes(c.nome.toLowerCase().split(" ")[0]))
    ) || {
      nome: responsavel || controle.responsavel || "Caio Almeida",
      telefone: DIRETORES_AUTORIZADOS.caio.telefone,
    };

  const texto =
    mensagemCustomizada ||
    `⚡ *Cobrança da Torre de Controle Vexo OS · Wandinha*\n\n` +
      `Olá, *${colab.nome}*! Cobrança de acompanhamento sobre a empresa *${clientName || clientId}*:\n\n` +
      `🎯 *Instrução / O que cobrar:* ${instrucaoFinal}\n` +
      (telefoneEmpresaFinal ? `📱 *WhatsApp da Empresa:* +${telefoneEmpresaFinal}\n` : "") +
      `🕒 *Último Contato:* ${horarioStr}\n` +
      `📅 *Futuro Contato Programado:* ${futuroStr}${controle.proximoAssunto ? ` (${controle.proximoAssunto})` : ""}\n\n` +
      `Por favor, execute e atualize o status na Torre de Controle.`;

  const envio = await enviarMensagemWhatsAppComFallback({
    numero: colab.telefone,
    texto,
    tenantId: "vexo-adm",
    pool,
  });

  return {
    sucesso: Boolean(envio?.sucesso),
    destinatario: colab.nome,
    telefone: colab.telefone,
    texto,
    envio,
  };
}
