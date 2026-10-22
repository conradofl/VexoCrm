/**
 * trelloSlackReporter.js
 * 
 * Conector de auditoria operacional Trello ↔ Slack para a Geração Digital & Vexo OS.
 * Consome os cards e listas do quadro operacional e publica os briefings matinal (09h)
 * e vespertino (18h) no canal oficial #01-ops-geral.
 */

export function categorizeTrelloCards(cards = [], lists = [], now = new Date()) {
  const listMap = new Map();
  for (const l of lists) {
    listMap.set(l.id, l.name);
  }

  const nowMs = now.getTime();
  const startOfTodayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfTodayMs = startOfTodayMs + 24 * 60 * 60 * 1000 - 1;

  const overdue = [];
  const dueToday = [];
  const blocked = [];
  const completed = [];
  const inProgress = [];

  for (const c of cards) {
    const listName = listMap.get(c.idList) || "";
    const listLower = listName.toLowerCase();
    const isDone = c.dueComplete || listLower.includes("conclu") || listLower.includes("feito") || listLower.includes("entregue");

    if (isDone) {
      completed.push({ ...c, listName });
      continue;
    }

    if (listLower.includes("trav") || listLower.includes("gargalo") || listLower.includes("bloque") || listLower.includes("aguardando")) {
      blocked.push({ ...c, listName });
    }

    if (c.due) {
      const dueMs = new Date(c.due).getTime();
      if (dueMs < startOfTodayMs) {
        overdue.push({ ...c, listName });
      } else if (dueMs >= startOfTodayMs && dueMs <= endOfTodayMs) {
        dueToday.push({ ...c, listName });
      } else {
        inProgress.push({ ...c, listName });
      }
    } else {
      inProgress.push({ ...c, listName });
    }
  }

  return {
    overdue,
    dueToday,
    blocked,
    completed,
    inProgress,
    totalOpen: overdue.length + dueToday.length + inProgress.length + blocked.length,
  };
}

export function formatDailyReport({ boardName = "Operações GD", summary, mode = "morning" }) {
  const isMorning = mode === "morning";

  if (isMorning) {
    let msg = `☀️ *CHECK-IN MATINAL OPERACIONAL (09h00)*\n`;
    msg += `_Geração Digital & Vexo OS · ${boardName}_\n\n`;

    // 1. Alerta Crítico / Atrasos
    if (summary.overdue.length > 0) {
      msg += `🚨 *ATENÇÃO: DEMANDAS ATRASADAS (${summary.overdue.length})*\n`;
      for (const card of summary.overdue.slice(0, 5)) {
        msg += `  • *${card.name}* (Lista: ${card.listName})\n`;
      }
      if (summary.overdue.length > 5) {
        msg += `  _...e mais ${summary.overdue.length - 5} demanda(s) pendente(s)_\n`;
      }
      msg += `\n`;
    } else {
      msg += `✅ *Zero atrasos críticos acumulados!*\n\n`;
    }

    // 2. Entregas de Hoje
    msg += `🎯 *ENTREGAS INEGOCIÁVEIS DE HOJE (${summary.dueToday.length})*\n`;
    if (summary.dueToday.length > 0) {
      for (const card of summary.dueToday.slice(0, 5)) {
        msg += `  • [ ] *${card.name}* (${card.listName})\n`;
      }
    } else {
      msg += `  • Nenhuma demanda com vencimento fixado para hoje no quadro.\n`;
    }
    msg += `\n`;

    // 3. Gargalos e Bloqueios
    if (summary.blocked.length > 0) {
      msg += `⚠️ *GARGALOS & DEMANDAS AGUARDANDO APROVAÇÃO (${summary.blocked.length})*\n`;
      for (const card of summary.blocked.slice(0, 4)) {
        msg += `  • *${card.name}* (${card.listName})\n`;
      }
      msg += `\n`;
    }

    msg += `💬 _"Sem desculpas: foco nas prioridades de hoje. Destravem os gargalos antes do cliente cobrar."_\n`;
    return msg;
  }

  // Evening Mode (18h00)
  let msg = `🌙 *CHECK-OUT VESPERTINO OPERACIONAL (18h00)*\n`;
  msg += `_Geração Digital & Vexo OS · ${boardName}_\n\n`;

  msg += `✅ *ENTREGAS CONCLUÍDAS HOJE (${summary.completed.length})*\n`;
  if (summary.completed.length > 0) {
    for (const card of summary.completed.slice(0, 5)) {
      msg += `  • *${card.name}*\n`;
    }
  } else {
    msg += `  • Nenhuma entrega registrada como concluída hoje.\n`;
  }
  msg += `\n`;

  // Pendências para amanhã
  const pendencias = [...summary.overdue, ...summary.dueToday];
  if (pendencias.length > 0) {
    msg += `🚨 *ENCABEÇAM A FILA DE AMANHÃ (${pendencias.length})*\n`;
    for (const card of pendencias.slice(0, 5)) {
      msg += `  • *${card.name}* (${card.listName})\n`;
    }
    msg += `\n`;
  } else {
    msg += `🎉 *Dia 100% zerado! Nenhuma pendência em atraso.*\n\n`;
  }

  msg += `💬 _"O que não rodou hoje vai encabeçar a fila de amanhã às 09h00. Bom descanso ao time!"_\n`;
  return msg;
}

/**
 * Envia mensagem para o canal do Slack via API
 */
export async function sendSlackMessage({ text, channel = "01-ops-geral", token = process.env.SLACK_BOT_TOKEN }) {
  if (!token) {
    throw new Error("SLACK_BOT_TOKEN não configurado.");
  }

  // Se o canal começa com '#', remove para resolver ID
  const cleanChannelName = channel.replace(/^#/, "");

  // Descobre o ID se foi passado nome
  let targetId = cleanChannelName;
  if (!cleanChannelName.startsWith("C") && !cleanChannelName.startsWith("G")) {
    const listRes = await fetch("https://slack.com/api/conversations.list?types=public_channel&limit=500", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const listData = await listRes.json();
    if (listData.ok && Array.isArray(listData.channels)) {
      const ch = listData.channels.find((c) => c.name === cleanChannelName);
      if (ch) targetId = ch.id;
    }
  }

  const postRes = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: targetId,
      text,
    }),
  });

  const postData = await postRes.json();
  if (!postData.ok) {
    throw new Error(`Erro ao postar mensagem no Slack: ${postData.error}`);
  }

  return postData;
}

/**
 * Busca dados da API do Trello ou gera dados simulados se em modo mock
 */
export async function fetchTrelloBoardData({ apiKey, token, boardId, allowMock = true }) {
  if (!apiKey || !token || !boardId) {
    if (!allowMock) {
      throw new Error("Credenciais do Trello incompletas (TRELLO_API_KEY, TRELLO_TOKEN, TRELLO_BOARD_ID).");
    }

    // Dados Mock para execução imediata / auditoria simulada
    return {
      boardName: "Operações Geração Digital (Simulado)",
      lists: [
        { id: "l_backlog", name: "Backlog & Briefings" },
        { id: "l_progresso", name: "Em Produção / Design" },
        { id: "l_aprovacao", name: "Aguardando Aprovação do Cliente" },
        { id: "l_concluido", name: "Entregue & Concluído" },
      ],
      cards: [
        {
          id: "c1",
          name: "Campanha Black Friday - Espaço Laser",
          idList: "l_progresso",
          due: new Date(Date.now() + 3 * 3600 * 1000).toISOString(),
          dueComplete: false,
        },
        {
          id: "c2",
          name: "Carrossel Instagram - Dr. Roberto",
          idList: "l_aprovacao",
          due: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
          dueComplete: false,
        },
        {
          id: "c3",
          name: "Ajuste de Saldo Meta Ads - Barbearia Vintage",
          idList: "l_progresso",
          due: new Date().toISOString(),
          dueComplete: false,
        },
        {
          id: "c4",
          name: "Vídeo Reel Institucional - Odonto Prime",
          idList: "l_concluido",
          due: new Date().toISOString(),
          dueComplete: true,
        },
      ],
      isMock: true,
    };
  }

  // Chamada Real à API do Trello
  const listsUrl = `https://api.trello.com/1/boards/${boardId}/lists?key=${apiKey}&token=${token}&fields=name,id`;
  const cardsUrl = `https://api.trello.com/1/boards/${boardId}/cards?filter=visible&key=${apiKey}&token=${token}&fields=name,desc,due,dueComplete,idList,labels,shortUrl`;

  const [listsRes, cardsRes] = await Promise.all([
    fetch(listsUrl),
    fetch(cardsUrl),
  ]);

  const [lists, cards] = await Promise.all([
    listsRes.json(),
    cardsRes.json(),
  ]);

  if (!Array.isArray(lists) || !Array.isArray(cards)) {
    throw new Error("Resposta inválida da API do Trello. Verifique as credenciais e o ID do quadro.");
  }

  return {
    boardName: "Operações Geração Digital",
    lists,
    cards,
    isMock: false,
  };
}

/**
 * Orquestrador principal: Coleta do Trello -> Categoriza -> Envia ao Slack
 */
export async function runTrelloDailyAudit({
  mode = "morning",
  trelloApiKey = process.env.TRELLO_API_KEY,
  trelloToken = process.env.TRELLO_TOKEN,
  trelloBoardId = process.env.TRELLO_BOARD_ID,
  slackToken = process.env.SLACK_BOT_TOKEN,
  slackChannel = "01-ops-geral",
  dryRun = false,
  allowMock = true,
}) {
  const data = await fetchTrelloBoardData({
    apiKey: trelloApiKey,
    token: trelloToken,
    boardId: trelloBoardId,
    allowMock,
  });

  const summary = categorizeTrelloCards(data.cards, data.lists);
  const reportText = formatDailyReport({
    boardName: data.boardName,
    summary,
    mode,
  });

  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      reportText,
      summary,
      isMock: data.isMock,
    };
  }

  await sendSlackMessage({
    text: reportText,
    channel: slackChannel,
    token: slackToken,
  });

  return {
    success: true,
    dryRun: false,
    reportText,
    summary,
    isMock: data.isMock,
  };
}
