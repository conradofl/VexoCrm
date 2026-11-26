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
    futuroContato: maisRecente ? maisRecente.futuroContato : atual.futuroContato,
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
  let campaignsRows = [];
  let dispatchesRows = [];
  let msgStatsRows = [];

  if (pool && typeof pool.query === "function") {
    const [cRes, chRes, uRes, campRes, dispRes, mRes] = await Promise.all([
      pool
        .query(`SELECT id, name, created_at FROM public.leads_clients ORDER BY name ASC`)
        .catch(() => ({ rows: [] })),
      pool
        .query(
          `SELECT id, client_id, name, phone, active, is_default, connection_state, chip_state, daily_limit_override
             FROM public.lead_client_evolution_instances
            WHERE active = true
            ORDER BY is_default DESC, id ASC`
        )
        .catch(() => ({ rows: [] })),
      pool
        .query(
          `SELECT instance_id::text AS instance_id, sent_count
             FROM public.evolution_instance_daily_usage
            WHERE usage_date = $1`,
          [todayKey]
        )
        .catch(() => ({ rows: [] })),
      pool
        .query(
          `SELECT id::text AS id, client_id, name, status, starts_at, ends_at, scheduled_for, last_triggered_at, created_at, archived_at, analytics_meta
             FROM public.campaigns
            WHERE archived_at IS NULL
            ORDER BY COALESCE(last_triggered_at, created_at) DESC`
        )
        .catch(() => ({ rows: [] })),
      pool
        .query(
          `SELECT id::text AS id, campaign_id::text AS campaign_id, client_id, status, total_leads, sent_count, failed_count, skipped_count, error_message, started_at, completed_at, created_at
             FROM public.campaign_dispatches
            ORDER BY created_at DESC`
        )
        .catch(() => ({ rows: [] })),
      pool
        .query(
          `SELECT
             client_id,
             COUNT(*) FILTER (WHERE direction = 'outbound' AND COALESCE(message_timestamp, created_at) >= NOW() - INTERVAL '24 hours')::int AS sent_today,
             COUNT(*) FILTER (WHERE direction = 'inbound' AND COALESCE(message_timestamp, created_at) >= NOW() - INTERVAL '24 hours')::int AS replies_today,
             MAX(COALESCE(message_timestamp, created_at)) FILTER (WHERE direction = 'outbound') AS last_outbound_at,
             MAX(COALESCE(message_timestamp, created_at)) FILTER (WHERE direction = 'inbound') AS last_inbound_at
           FROM public.lead_messages
           WHERE COALESCE(message_timestamp, created_at) >= NOW() - INTERVAL '30 days'
           GROUP BY client_id`
        )
        .catch(() => ({ rows: [] })),
    ]);

    clientsRows = cRes.rows || [];
    chipsRows = chRes.rows || [];
    usageRows = uRes.rows || [];
    campaignsRows = campRes.rows || [];
    dispatchesRows = dispRes.rows || [];
    msgStatsRows = mRes.rows || [];
  }

  const usageByChipId = new Map();
  for (const u of usageRows) {
    usageByChipId.set(String(u.instance_id), Number(u.sent_count) || 0);
  }

  const chipsByClient = new Map();
  for (const ch of chipsRows) {
    const cid = String(ch.client_id || "");
    if (!chipsByClient.has(cid)) chipsByClient.set(cid, []);
    const limit = resolveChipDailyLimit(ch);
    const used = usageByChipId.get(String(ch.id)) || 0;
    const isConnected = ch.connection_state === "open";
    chipsByClient.get(cid).push({
      id: String(ch.id),
      name: ch.name || "Chip",
      phone: ch.phone || null,
      connected: isConnected,
      connectionState: ch.connection_state || "unknown",
      chipState: ch.chip_state || "active",
      usedToday: used,
      dailyLimit: limit,
      isDefault: Boolean(ch.is_default),
    });
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

  const clientes = clientsRows.map((client) => {
    const cid = String(client.id);
    const clientChips = chipsByClient.get(cid) || [];
    const connectedChips = clientChips.filter((c) => c.connected).length;
    const disconnectedChips = clientChips.length - connectedChips;
    const usedQuotaToday = clientChips.reduce((acc, c) => acc + c.usedToday, 0);
    const totalDailyLimit = clientChips.reduce((acc, c) => acc + c.dailyLimit, 0);

    const rawCampaigns = campaignsByClient.get(cid) || [];
    let clientTotalQueueRemaining = 0;
    let clientTotalSent = 0;
    let clientTotalFailed = 0;
    let clientTotalLeadsInCampaigns = 0;

    const campanhas = rawCampaigns.map((camp) => {
      const lotes = dispatchesByCampaign.get(String(camp.id)) || [];
      const latestLote = lotes[0] || null;
      const meta = camp.analytics_meta && typeof camp.analytics_meta === "object" ? camp.analytics_meta : {};

      const totalLeads =
        Number(latestLote?.total_leads) ||
        Number(meta?.lastDispatchSummary?.totalLeads) ||
        Number(meta?.totalLeads) ||
        0;
      const sentCount =
        Number(latestLote?.sent_count) ||
        Number(meta?.lastDispatchSummary?.sentCount) ||
        Number(meta?.sentCount) ||
        0;
      const failedCount =
        Number(latestLote?.failed_count) ||
        Number(meta?.lastDispatchSummary?.failedCount) ||
        0;
      const skippedCount = Number(latestLote?.skipped_count) || 0;
      const rawStatus = String(latestLote?.status || camp.status || "rascunho").toLowerCase();

      const isFinished = ["done", "completed", "concluida", "enviada", "cancelled", "cancelada"].includes(rawStatus);
      const remainingInQueue = isFinished ? 0 : Math.max(0, totalLeads - sentCount - failedCount - skippedCount);

      clientTotalQueueRemaining += remainingInQueue;
      clientTotalSent += sentCount;
      clientTotalFailed += failedCount;
      clientTotalLeadsInCampaigns += totalLeads;

      const dataInicio =
        latestLote?.started_at ||
        camp.starts_at ||
        camp.scheduled_for ||
        camp.last_triggered_at ||
        camp.created_at ||
        null;

      const dataConclusaoReal = latestLote?.completed_at || camp.ends_at || null;
      const previsaoConclusao =
        !dataConclusaoReal && remainingInQueue > 0
          ? computeEstimatedCampaignEnd({ remainingInQueue, dailyLimitTotal: totalDailyLimit, now })
          : null;

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
        pauseReason: latestLote?.error_message || null,
        lastTriggeredAt: camp.last_triggered_at || latestLote?.created_at || null,
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

    // Semáforo inteligente da empresa
    let semaforo = "saudavel";
    const alertas = [];

    if (disconnectedChips > 0) {
      semaforo = "critico";
      alertas.push(`${disconnectedChips} chip(s) desconectado(s)`);
    }
    if (futuroContatoStatus === "atrasado") {
      semaforo = "critico";
      alertas.push("Futuro contato atrasado");
    }
    if (pausedCampaignsCount > 0 && clientTotalQueueRemaining > 0) {
      semaforo = "critico";
      alertas.push(`Campanha pausada com ${clientTotalQueueRemaining} leads na fila`);
    }
    if (semaforo !== "critico") {
      if (futuroContatoStatus === "hoje") {
        semaforo = "atencao";
        alertas.push("Futuro contato agendado para hoje");
      } else if (clientChips.length === 0) {
        semaforo = "atencao";
        alertas.push("Sem chip conectado");
      } else if (activeCampaignsCount === 0 && clientTotalQueueRemaining === 0) {
        semaforo = "atencao";
        alertas.push("Sem campanha ativa ou fila de disparo");
      }
    }

    return {
      id: cid,
      name: client.name || cid,
      createdAt: client.created_at,
      semaforo,
      alertas,
      chips: {
        total: clientChips.length,
        connected: connectedChips,
        disconnected: disconnectedChips,
        usedQuotaToday,
        totalDailyLimit,
        items: clientChips,
      },
      campanhas: {
        total: campanhas.length,
        ativas: activeCampaignsCount,
        pausadas: pausedCampaignsCount,
        totalLeads: clientTotalLeadsInCampaigns,
        enviadosTotal: clientTotalSent,
        filaRestante: clientTotalQueueRemaining,
        falhasTotal: clientTotalFailed,
        items: campanhas.slice(0, 8),
      },
      disparos: {
        enviadosHoje: Number(msgStat.sent_today) || usedQuotaToday || 0,
        respostasHoje: Number(msgStat.replies_today) || 0,
        ultimoDisparoAt: msgStat.last_outbound_at || campanhas[0]?.lastTriggeredAt || null,
        ultimaRespostaAt: msgStat.last_inbound_at || null,
      },
      relacionamento: {
        responsavel: controle.responsavel || "",
        horarioContato: controle.horarioContato || null,
        futuroContato: controle.futuroContato || null,
        futuroContatoStatus,
        demandaAtual: controle.demandaAtual || "",
        proximoAssunto: controle.proximoAssunto || "",
        historicoContatos: Array.isArray(controle.historicoContatos) ? controle.historicoContatos : [],
      },
    };
  });

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
  };

  return {
    gdAccessEnabled: globalCfg.gdAccessEnabled !== false,
    colaboradoresDisponiveis: COLABORADORES_PADRAO,
    resumoGlobal,
    clientes,
  };
}

export async function cobrarColaboradorTorreViaWandinha(
  pool,
  { clientId, clientName, responsavel, mensagemCustomizada }
) {
  const nomeBusca = String(responsavel || "").trim().toLowerCase();
  const colab =
    COLABORADORES_PADRAO.find(
      (c) =>
        c.nome.toLowerCase() === nomeBusca ||
        c.nome.toLowerCase().includes(nomeBusca) ||
        nomeBusca.includes(c.nome.toLowerCase().split(" ")[0])
    ) || {
      nome: responsavel || "Caio Almeida",
      telefone: DIRETORES_AUTORIZADOS.caio.telefone,
    };

  const entries = await readTorreConfigEntries(pool);
  const controle = entries.get(`torre_cliente:${clientId}`) || {};

  const horarioStr = controle.horarioContato
    ? new Date(controle.horarioContato).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "Não registrado";
  const futuroStr = controle.futuroContato
    ? new Date(controle.futuroContato).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : "Definir agora";

  const texto =
    mensagemCustomizada ||
    `⚡ *Cobrança da Torre de Controle Vexo OS · Wandinha*\n\n` +
      `Olá, *${colab.nome}*! Cobrança de acompanhamento sobre o cliente *${clientName || clientId}*:\n\n` +
      `📌 *Demanda / Alinhamento:* ${controle.demandaAtual || "Verificar campanhas, fila de disparos e chips do cliente."}\n` +
      `🕒 *Último Contato:* ${horarioStr}\n` +
      `📅 *Futuro Contato Programado:* ${futuroStr}${controle.proximoAssunto ? ` (${controle.proximoAssunto})` : ""}\n\n` +
      `Por favor, atualize o status da operação na Torre de Controle.`;

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
