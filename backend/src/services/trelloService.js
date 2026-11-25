/**
 * trelloService.js
 * 
 * Serviço oficial de criação, consulta e monitoramento de cards do Trello
 * para a Geração Digital & Vexo OS (GoClaw / Heloísa / Átrio).
 */

/**
 * Interpreta datas no fuso horário do Brasil (America/Sao_Paulo / -03:00)
 */
export function parseDataHoraBrasilia(dataHoraStr) {
  if (!dataHoraStr) return new Date().toISOString();
  let str = String(dataHoraStr).trim();

  // Suporta formato brasileiro DD/MM/YYYY HH:mm ou DD/MM/YYYY
  const brMatch = str.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:[T\s]+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if (brMatch) {
    const [, d, m, y, h = "09", min = "00", s = "00"] = brMatch;
    str = `${y}-${m}-${d}T${h}:${min}:${s}-03:00`;
  } else {
    if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(str)) {
      str = str.replace(/\s+/, "T");
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(str)) {
      str = `${str}:00`;
    }
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(str)) {
      str = `${str}-03:00`;
    }
  }

  const parsed = new Date(str);
  return !isNaN(parsed.getTime()) ? parsed.toISOString() : new Date().toISOString();
}

/**
 * Converte linguagem natural em data/hora ISO com fuso horário de Brasília (-03:00)
 * Exemplos:
 * - "sexta às 18h", "segunda às 14:00"
 * - "21/11 às 17h", "21/11/2026 18:00"
 * - "amanhã às 15:30", "hoje às 18h"
 * - "daqui 2 dias"
 */
export function parsePrazoTrello(prazoStr, refDate = new Date()) {
  if (!prazoStr) {
    const d = new Date(refDate);
    d.setDate(d.getDate() + 1);
    const dayStr = d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    return `${dayStr}T18:00:00-03:00`;
  }

  let s = String(prazoStr).trim().toLowerCase();
  const sNorm = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Extrair horário (ex: "18h", "18:00", "18h30", "as 17h", "as 17:00")
  let hora = 18;
  let min = 0;
  const matchHora = sNorm.match(/(?:as\s+)?(\d{1,2})(?:h(?:(\d{1,2}))?|:(\d{2}))/);
  if (matchHora) {
    hora = parseInt(matchHora[1], 10);
    min = parseInt(matchHora[2] || matchHora[3] || "0", 10);
  }

  const horaStr = String(hora).padStart(2, "0");
  const minStr = String(min).padStart(2, "0");

  const getBrParts = (d) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    }).formatToParts(d);
    const map = {};
    for (const p of parts) map[p.type] = p.value;
    return {
      year: parseInt(map.year, 10),
      month: parseInt(map.month, 10),
      day: parseInt(map.day, 10),
      weekday: map.weekday,
    };
  };

  const brToday = getBrParts(refDate);

  // 1. Data explícita: DD/MM/YYYY ou DD/MM
  const matchDataBr = sNorm.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);
  if (matchDataBr) {
    const d = parseInt(matchDataBr[1], 10);
    const m = parseInt(matchDataBr[2], 10);
    let y = matchDataBr[3] ? parseInt(matchDataBr[3], 10) : brToday.year;
    if (y < 100) y += 2000;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T${horaStr}:${minStr}:00-03:00`;
  }

  // 2. Data no formato ISO (YYYY-MM-DD...)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    return parseDataHoraBrasilia(s);
  }

  // 3. "hoje"
  if (sNorm.includes("hoje")) {
    return `${brToday.year}-${String(brToday.month).padStart(2, "0")}-${String(brToday.day).padStart(2, "0")}T${horaStr}:${minStr}:00-03:00`;
  }

  // 4. "amanha"
  if (sNorm.includes("amanha")) {
    const d = new Date(refDate.getTime() + 24 * 3600 * 1000);
    const p = getBrParts(d);
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${horaStr}:${minStr}:00-03:00`;
  }

  // 5. Dias da semana (domingo a sabado)
  const diasSemanaMap = {
    domingo: 0,
    segunda: 1,
    terca: 2,
    quarta: 3,
    quinta: 4,
    sexta: 5,
    sabado: 6,
  };

  for (const [diaNome, diaIdx] of Object.entries(diasSemanaMap)) {
    if (sNorm.includes(diaNome)) {
      const currentDayIdx = new Date(
        refDate.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
      ).getDay();

      let diff = diaIdx - currentDayIdx;
      if (diff <= 0) diff += 7;
      const target = new Date(refDate.getTime() + diff * 24 * 3600 * 1000);
      const p = getBrParts(target);
      return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${horaStr}:${minStr}:00-03:00`;
    }
  }

  // 6. "daqui X dias" ou "em X dias"
  const matchDias = sNorm.match(/(?:daqui\s+(?:a\s+)?|em\s+)(\d+)\s*dias?/);
  if (matchDias) {
    const qtd = parseInt(matchDias[1], 10);
    const target = new Date(refDate.getTime() + qtd * 24 * 3600 * 1000);
    const p = getBrParts(target);
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}T${horaStr}:${minStr}:00-03:00`;
  }

  // Fallback seguro
  return parseDataHoraBrasilia(prazoStr);
}

/**
 * REGRA DE OURO (Supressão de Cobrança):
 * Retorna true se dueComplete === true OU o card estiver em uma lista
 * indicativa de aprovação, conclusão ou entrega.
 */
export function isCardInApprovalOrDone({ listName = "", dueComplete = false }) {
  if (dueComplete === true) return true;

  const ln = String(listName || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  const approvalOrDonePatterns = [
    "aprov",        // aprovação, aprovado, aguardando aprovação
    "para aprovar",
    "aguardando",
    "conclu",       // concluído, concluida, conclusao
    "entregue",
    "feito",
    "finaliz",      // finalizado
    "revisao",      // em revisão da gerência
  ];

  return approvalOrDonePatterns.some((pattern) => ln.includes(pattern));
}

/**
 * Calcula os marcos D-2, D-1 e D-0 com relação ao prazo e ao momento atual
 */
export function calculateTrelloMarcoDelays(dueDate, now = new Date()) {
  const nowMs = now.getTime();
  const dueObj = typeof dueDate === "string" ? new Date(dueDate) : dueDate;
  const dueMs = dueObj.getTime();

  // D-2: 48h antes da entrega
  const d2Ms = dueMs - 2 * 24 * 3600 * 1000;
  // D-1: 24h antes da entrega
  const d1Ms = dueMs - 1 * 24 * 3600 * 1000;
  // D-0: às 09h da manhã do dia da entrega (ou 4h antes se o prazo for de manhã)
  const dueDayParts = dueObj.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const morningD0Ms = new Date(`${dueDayParts}T09:00:00-03:00`).getTime();
  const d0Ms = morningD0Ms < dueMs ? morningD0Ms : dueMs - 4 * 3600 * 1000;

  const marcos = [];
  if (d2Ms > nowMs) {
    marcos.push({ marco: "D-2", delayMs: d2Ms - nowMs, targetDate: new Date(d2Ms) });
  }
  if (d1Ms > nowMs) {
    marcos.push({ marco: "D-1", delayMs: d1Ms - nowMs, targetDate: new Date(d1Ms) });
  }
  if (d0Ms > nowMs) {
    marcos.push({ marco: "D-0", delayMs: d0Ms - nowMs, targetDate: new Date(d0Ms) });
  }

  return marcos;
}

/**
 * Formata uma data/hora ISO para exibição amigável em pt-BR
 */
export function formatarPrazoAmigavel(dateIso) {
  try {
    const d = new Date(dateIso);
    return d.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(dateIso);
  }
}

/**
 * Roteamento Multiquadro do Trello:
 * Localiza o quadro por URL/shortLink, por nome da empresa na workspace socialmediagdigital ou fallback
 */
export async function resolveTrelloBoard({
  clientName,
  boardIdOrUrl,
  apiKey = process.env.TRELLO_API_KEY || (process.env.NODE_ENV === "test" ? "test_trello_key" : undefined),
  token = process.env.TRELLO_TOKEN || (process.env.NODE_ENV === "test" ? "test_trello_token" : undefined),
  workspaceId = "socialmediagdigital",
  allowMock = true,
} = {}) {
  // 1. Se for passado URL completa ou shortLink (ex: https://trello.com/b/oLurW041/geracao-digital ou oLurW041)
  if (boardIdOrUrl) {
    const s = String(boardIdOrUrl).trim();
    const urlMatch = s.match(/(?:boards|b)\/([a-zA-Z0-9]+)/);
    if (urlMatch) {
      return urlMatch[1];
    }
    // Se for um shortLink ou ID alfanumérico direto
    if (/^[a-zA-Z0-9_-]+$/.test(s)) {
      return s;
    }
  }

  // 2. Se for informado o nome do cliente, busca quadros da workspace socialmediagdigital
  if (clientName && apiKey && token) {
    const cNorm = String(clientName)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

    try {
      const url = `https://api.trello.com/1/organizations/${workspaceId}/boards?key=${apiKey}&token=${token}&fields=name,id,shortLink,url`;
      const res = await fetch(url);
      if (res && res.ok) {
        const boards = await res.json();
        if (Array.isArray(boards)) {
          // Busca por correspondência no nome do quadro
          const found = boards.find((b) => {
            const bNorm = String(b.name || "")
              .toLowerCase()
              .normalize("NFD")
              .replace(/[\u0300-\u036f]/g, "")
              .trim();
            return bNorm.includes(cNorm) || cNorm.includes(bNorm);
          });
          if (found) {
            return found.id || found.shortLink;
          }
        }
      }
    } catch (err) {
      console.warn(`[trelloService] Falha ao buscar quadros da workspace ${workspaceId}:`, err.message);
    }
  }

  // 3. Fallback: board padrão configurado ou padrão de teste
  return process.env.TRELLO_BOARD_ID || (process.env.NODE_ENV === "test" ? "oLurW041" : undefined);
}

/**
 * Garante que a coluna "Heloísa" existe no quadro do cliente.
 * Se não existir, cria automaticamente via API no topo (pos=top).
 */
export async function ensureHeloisaList({
  boardId,
  apiKey = process.env.TRELLO_API_KEY || (process.env.NODE_ENV === "test" ? "test_trello_key" : undefined),
  token = process.env.TRELLO_TOKEN || (process.env.NODE_ENV === "test" ? "test_trello_token" : undefined),
  allowMock = true,
}) {
  if (!boardId) {
    throw new Error("boardId é obrigatório para garantir a coluna Wandinha.");
  }

  if ((!apiKey || !token) && allowMock) {
    return { id: `mock_list_wandinha_${boardId}`, name: "Wandinha", created: false };
  }

  const listsUrl = `https://api.trello.com/1/boards/${boardId}/lists?key=${apiKey}&token=${token}&fields=name,id`;
  let lists = [];
  try {
    const res = await fetch(listsUrl);
    if (res && res.ok) {
      lists = await res.json();
    }
  } catch (err) {
    console.warn(`[trelloService] Falha ao listar colunas do quadro ${boardId}:`, err.message);
  }

  if (Array.isArray(lists)) {
    const found = lists.find((l) => {
      const ln = String(l.name || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u300f\u0300-\u036f]/g, "")
        .trim();
      return ln === "wandinha" || ln === "heloisa";
    });
    if (found) {
      return { id: found.id, name: found.name, created: false };
    }
  }

  // Cria a coluna Wandinha no topo do quadro
  const postUrl = `https://api.trello.com/1/boards/${boardId}/lists?name=Wandinha&pos=top&key=${apiKey}&token=${token}`;
  try {
    const res = await fetch(postUrl, { method: "POST" });
    if (res && res.ok) {
      const newList = await res.json();
      return { id: newList.id, name: newList.name || "Wandinha", created: true };
    }
  } catch (errPost) {
    console.warn(`[trelloService] Falha ao criar coluna Wandinha no quadro ${boardId}:`, errPost.message);
  }

  if (allowMock) {
    return { id: `mock_list_wandinha_${boardId}`, name: "Wandinha", created: true };
  }

  throw new Error(`Não foi possível garantir a coluna Wandinha no quadro ${boardId}.`);
}

/**
 * Clona o quadro Board Base (TEMPLATE) da organização para uma nova empresa
 */
export async function cloneBoardBaseForNewClient({
  clientName,
  apiKey = process.env.TRELLO_API_KEY || (process.env.NODE_ENV === "test" ? "test_trello_key" : undefined),
  token = process.env.TRELLO_TOKEN || (process.env.NODE_ENV === "test" ? "test_trello_token" : undefined),
  workspaceId = "socialmediagdigital",
  allowMock = true,
}) {
  if (!clientName) {
    throw new Error("clientName é obrigatório para clonar quadro base.");
  }

  if ((!apiKey || !token) && allowMock) {
    const mockId = `mock_board_${Date.now()}`;
    return {
      id: mockId,
      name: clientName,
      shortUrl: `https://trello.com/b/${mockId.slice(-8)}`,
      url: `https://trello.com/b/${mockId.slice(-8)}`,
      isMock: true,
    };
  }

  // 1. Localiza o quadro Board Base (TEMPLATE)
  let templateId = null;
  try {
    const url = `https://api.trello.com/1/organizations/${workspaceId}/boards?key=${apiKey}&token=${token}&fields=name,id`;
    const res = await fetch(url);
    if (res && res.ok) {
      const boards = await res.json();
      if (Array.isArray(boards)) {
        const foundTemplate = boards.find((b) => {
          const bn = String(b.name || "").toLowerCase();
          return bn.includes("board base") || bn.includes("template");
        });
        if (foundTemplate) templateId = foundTemplate.id;
      }
    }
  } catch (err) {
    console.warn(`[trelloService] Falha ao localizar Board Base na workspace ${workspaceId}:`, err.message);
  }

  // 2. Dispara POST de criação do novo quadro clonado
  const postUrl = `https://api.trello.com/1/boards/?name=${encodeURIComponent(clientName)}&idOrganization=${workspaceId}${templateId ? `&idBoardSource=${templateId}` : ""}&key=${apiKey}&token=${token}`;
  let newBoard = null;
  try {
    const res = await fetch(postUrl, { method: "POST" });
    if (res && res.ok) {
      newBoard = await res.json();
    }
  } catch (errPost) {
    console.warn(`[trelloService] Falha ao clonar quadro para ${clientName}:`, errPost.message);
  }

  if (!newBoard?.id) {
    if (allowMock) {
      const mockId = `mock_board_${Date.now()}`;
      return {
        id: mockId,
        name: clientName,
        shortUrl: `https://trello.com/b/${mockId.slice(-8)}`,
        url: `https://trello.com/b/${mockId.slice(-8)}`,
        isMock: true,
      };
    }
    throw new Error(`Falha ao clonar quadro para o cliente ${clientName}.`);
  }

  // 3. Garante a coluna "Heloísa" no novo quadro
  await ensureHeloisaList({ boardId: newBoard.id, apiKey, token, allowMock });

  return {
    id: newBoard.id,
    name: newBoard.name || clientName,
    shortUrl: newBoard.shortUrl || newBoard.url,
    url: newBoard.url || newBoard.shortUrl,
    isMock: false,
  };
}

/**
 * Cria um card no Trello da Geração Digital com suporte a roteamento multiquadro
 */
export async function createTrelloCard({
  name,
  desc = "",
  listName = null, // se não informado, usa a coluna "Heloísa"
  dueDate,
  memberUsername,
  boardIdOrUrl,
  clientName,
  empresa,
  tipoDemanda,
  apiKey = process.env.TRELLO_API_KEY || (process.env.NODE_ENV === "test" ? "test_trello_key" : undefined),
  token = process.env.TRELLO_TOKEN || (process.env.NODE_ENV === "test" ? "test_trello_token" : undefined),
  boardId = process.env.TRELLO_BOARD_ID || (process.env.NODE_ENV === "test" ? "test_trello_board" : undefined),
  allowMock = true,
}) {
  if (!name) {
    throw new Error("Título da demanda é obrigatório para criação de card no Trello.");
  }

  // 1. Resolve o quadro do Trello (por URL, shortLink, nome do cliente na workspace ou fallback)
  const targetBoardId = await resolveTrelloBoard({
    clientName: clientName || empresa,
    boardIdOrUrl: boardIdOrUrl || boardId,
    apiKey,
    token,
    allowMock,
  });

  const dueIsoUtc = dueDate ? new Date(dueDate).toISOString() : null;

  const buildMockCard = (coluna = listName || "Heloísa") => {
    const mockId = `mock_card_${Date.now()}`;
    return {
      id: mockId,
      shortUrl: `https://trello.com/c/${mockId.slice(-8)}`,
      url: `https://trello.com/c/${mockId.slice(-8)}`,
      name,
      due: dueIsoUtc,
      idList: "mock_list_default",
      listName: coluna,
      boardId: targetBoardId,
      isMock: true,
    };
  };

  // Sem credenciais reais: fallback mock para testes e desenvolvimento
  if (!apiKey || !token || !targetBoardId) {
    if (!allowMock) {
      throw new Error("Credenciais do Trello incompletas (TRELLO_API_KEY, TRELLO_TOKEN, TRELLO_BOARD_ID).");
    }
    return buildMockCard();
  }

  // 2. Resolve a lista do quadro
  const listsUrl = `https://api.trello.com/1/boards/${targetBoardId}/lists?key=${apiKey}&token=${token}&fields=name,id`;
  let listsRes;
  try {
    listsRes = await fetch(listsUrl);
  } catch (errNet) {
    if (allowMock) return buildMockCard();
    throw errNet;
  }

  let lists = [];
  if (listsRes && listsRes.ok) {
    lists = await listsRes.json().catch(() => []);
  }

  let targetList = null;
  if (Array.isArray(lists) && lists.length > 0) {
    if (listName) {
      const lnNorm = String(listName).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

      // Regra de Negócio: Se pedir "aprovação", mapeia preferencialmente para "Aguardando Aprovação"
      if (lnNorm.includes("aprov")) {
        targetList = lists.find((l) => {
          const itemNorm = l.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
          return itemNorm.includes("aguardando aprov") || itemNorm.includes("aprov");
        });
      }

      if (!targetList) {
        targetList = lists.find((l) => {
          const itemNorm = l.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
          return itemNorm.includes(lnNorm);
        });
      }
    }
  }

  // Se a lista não foi encontrada ou não foi informada, utiliza a coluna "Heloísa"
  if (!targetList) {
    try {
      const heloisaCol = await ensureHeloisaList({ boardId: targetBoardId, apiKey, token, allowMock });
      targetList = { id: heloisaCol.id, name: heloisaCol.name };
    } catch {
      if (Array.isArray(lists) && lists.length > 0) {
        targetList = lists[0];
      }
    }
  }

  const idList = targetList?.id;
  if (!idList) {
    if (allowMock) return buildMockCard();
    throw new Error(`Lista de destino não encontrada no quadro do Trello (${listName || "Heloísa"}).`);
  }

  // 3. Resolve idMember se memberUsername foi fornecido
  let idMembers = [];
  if (memberUsername) {
    try {
      const membersUrl = `https://api.trello.com/1/boards/${targetBoardId}/members?key=${apiKey}&token=${token}&fields=username,fullName,id`;
      const membersRes = await fetch(membersUrl);
      if (membersRes?.ok) {
        const members = await membersRes.json().catch(() => []);
        if (Array.isArray(members)) {
          const uNorm = String(memberUsername).trim().toLowerCase();
          const found = members.find(
            (m) =>
              m.username.toLowerCase() === uNorm ||
              m.fullName.toLowerCase().includes(uNorm)
          );
          if (found) idMembers = [found.id];
        }
      }
    } catch (eMem) {
      console.warn("[trelloService] Falha ao resolver membro no Trello:", eMem.message);
    }
  }

  // 4. Dispara POST /1/cards
  const postUrl = `https://api.trello.com/1/cards`;
  const cardPayload = {
    key: apiKey,
    token,
    idList,
    name,
    desc,
    due: dueIsoUtc,
    idMembers: idMembers.length > 0 ? idMembers : undefined,
  };

  let createRes;
  try {
    createRes = await fetch(postUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cardPayload),
    });
  } catch (errPost) {
    if (allowMock) return buildMockCard(targetList?.name);
    throw errPost;
  }

  let cardData = null;
  if (createRes && createRes.ok) {
    cardData = await createRes.json().catch(() => null);
  }

  if (!cardData?.id) {
    if (allowMock) return buildMockCard(targetList?.name);
    throw new Error(`Falha ao criar card no Trello: ${JSON.stringify(cardData)}`);
  }

  return {
    id: cardData.id,
    shortUrl: cardData.shortUrl || cardData.url,
    url: cardData.url || cardData.shortUrl,
    name: cardData.name || name,
    due: cardData.due || dueIsoUtc,
    idList: cardData.idList || idList,
    listName: targetList?.name || listName || "Heloísa",
    boardId: targetBoardId,
    isMock: false,
  };
}

/**
 * Consulta o status em tempo real de um card no Trello
 */
export async function getTrelloCardStatus({
  cardId,
  apiKey = process.env.TRELLO_API_KEY || (process.env.NODE_ENV === "test" ? "test_trello_key" : undefined),
  token = process.env.TRELLO_TOKEN || (process.env.NODE_ENV === "test" ? "test_trello_token" : undefined),
  allowMock = true,
}) {
  if (!cardId) {
    throw new Error("cardId é obrigatório para consultar status no Trello.");
  }

  const buildMockStatus = () => ({
    id: cardId,
    name: "Demanda Operacional (Simulada)",
    due: new Date().toISOString(),
    dueComplete: false,
    idList: "mock_list_prod",
    listName: "Em Produção / Design",
    isMock: true,
  });

  // Suporte a mock se não houver credenciais
  if (!apiKey || !token) {
    if (allowMock) return buildMockStatus();
    throw new Error("Credenciais do Trello incompletas para consultar card.");
  }

  const url = `https://api.trello.com/1/cards/${cardId}?fields=name,due,dueComplete,idList&list=true&key=${apiKey}&token=${token}`;
  let res;
  try {
    res = await fetch(url);
  } catch (errNet) {
    if (allowMock) return buildMockStatus();
    throw errNet;
  }

  if (!res || !res.ok) {
    if (allowMock) return buildMockStatus();
    const errText = await res?.text().catch(() => "");
    throw new Error(`Erro na API do Trello ao consultar card (${res?.status}): ${errText}`);
  }

  let data = null;
  try {
    data = await res.json();
  } catch {
    if (allowMock) return buildMockStatus();
    throw new Error("Resposta inválida (não-JSON) da API do Trello ao consultar card.");
  }

  if (!data || !data.id) {
    if (allowMock) return buildMockStatus();
    throw new Error(`Card ${cardId} não encontrado no Trello ou credenciais inválidas.`);
  }

  return {
    id: data.id,
    name: data.name,
    due: data.due,
    dueComplete: Boolean(data.dueComplete),
    idList: data.idList,
    listName: data.list?.name || "",
    isMock: false,
  };
}
