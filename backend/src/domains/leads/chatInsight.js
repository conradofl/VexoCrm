// backend/src/domains/leads/chatInsight.js
// Análise inteligente da conversa do WhatsApp para o Banco de Dados e WhatsApp Inbox.
//
// Lê o histórico da conversa e devolve no formato padrão (máximo 6 linhas):
// 🎯 [o que a pessoa quer]
// 📋 [fatos já estabelecidos: quantidades, datas, destino, valores, nomes]
// 🤝 [o que foi combinado ou prometido]
// ⏭️ [próximo passo concreto]

import { callLlmChatCompletion } from "../../chatbot-ai-engine.js";
import { defaultGroqModel, resolveGroqLadder, classifyLlmHttpError } from "../../services/llmModels.js";
import { parsePrazoData } from "../../services/leadAgreement.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = defaultGroqModel();

export const DEFAULT_SUMMARY_PROMPT = `Você extrai a ficha de atendimento de conversas de WhatsApp para o consultor comercial se situar e saber o que fazer agora (no máximo seis linhas no resumo essencial).

Ele abre o chat e precisa saber em dez segundos o que a pessoa quer, qual a objeção real, o orçamento sinalizado, o acordo combinado e a pergunta que falta fazer na próxima conversa.

FORMATO PADRÃO DA FICHA:

🎯 [o que a pessoa quer, uma linha]
📋 [fatos já estabelecidos: quantas pessoas, datas, destino, valores, nomes. Literal, tirado da conversa]
🛑 [objeção real: o que fez a pessoa recuar, nas palavras dela. Se não recuou nem apresentou objeção, coloque "nada ainda"]
💰 [orçamento sinalizado: o que ela disse sobre dinheiro, com as palavras dela ("tenho cinco mil agora", "meu limite tá comprometido", "quanto fica em dez vezes"). REGRA CRÍTICA: NUNCA ESTIME. Se a pessoa não falou de dinheiro, responda exatamente "não falou"]
🤝 [acordo combinado: exatamente o que ficou de acontecer, quem faz e quando. "Vai pensar" não é acordo. Se não houve acordo nenhum, responda com todas as letras "saiu sem acordo"]
⏭️ [próximo passo concreto, uma linha]
❓ [o que falta descobrir: uma pergunta só, a que o consultor precisa fazer na próxima conversa para avançar a venda. Não faça lista]

SAÍDA DE ESCAPE (QUANDO NÃO HOUVER NENHUMA OPORTUNIDADE COMERCIAL):
Quando não houver NENHUMA intenção comercial (conversa puramente pessoal, amigos, família, spam ou comentário casual sem interesse de compra), responda em UMA LINHA SÓ:
🚫 [por que não é oportunidade comercial, poucas palavras]

REGRAS:
· Só use 🚫 quando não houver NADA comercial. Na dúvida, prefira as linhas com "nada ainda".
· Citar um produto ou serviço de passagem, sem querer comprar, é 🚫.
· Nunca transforme comentário casual ou piada em intenção de compra.
· 🛑 Objeção real: o que fez a pessoa recuar nas palavras dela ("tá caro", "vou ver com meu sócio", "depois te chamo"). Se não houve objeção, "nada ainda".
· 💰 Orçamento sinalizado: REGRA MAIS IMPORTANTE: NUNCA ESTIME. Se a pessoa não falou de dinheiro, o campo diz exatamente "não falou". Não deduza da profissão, do produto que ela quer, do que outros costumam pagar, nem de qualquer coisa. Valor inventado vira proposta errada na frente do cliente.
· 🤝 Acordo combinado: o que exatamente ficou de acontecer, quem faz e quando. "Vai pensar" não é acordo. Se não houve acordo nenhum, o campo tem que dizer isso com todas as letras: "saiu sem acordo".
· ❓ O que falta descobrir: uma pergunta só, a que o consultor precisa fazer na próxima conversa. Não uma lista.
· 📋 Fatos já estabelecidos: varra a conversa INTEIRA, não só as últimas mensagens.
· Nunca invente. O que não foi dito não entra.
· Linha sem conteúdo real recebe "nada ainda" (exceto 💰 que recebe "não falou" e 🤝 que recebe "saiu sem acordo").
· ⏭️ jamais pode ser "dar continuidade ao contato comercial" nem "qualificar o interesse". Tem que ser a ação exata.
· Não use travessão.
· Não repita a conversa. Sem subitens (a)(b)(c), sem parágrafos, sem numeração.`;

/**
 * Contrato de SAIDA do resumo/ficha, anexado pelo código — nunca deixado a cargo do
 * texto que o dono edita na tela. O prompt editável pelo dono NÃO decide nem remove
 * estes campos.
 */
export const SUMMARY_OUTPUT_CONTRACT = `

═══════════════════════════════════════════════════════════════
FORMATO DE SAÍDA OBRIGATÓRIO (FICHA DO LEAD)
═══════════════════════════════════════════════════════════════
Se houver oportunidade comercial ou intenção de compra, responda EXATAMENTE nestas linhas, cada uma começando pelo seu emoji, sem texto antes ou depois, sem markdown, sem numeração:

🎯 [o que a pessoa quer]
📋 [fatos já estabelecidos, literais da conversa]
🛑 [objeção real: o que fez a pessoa recuar, nas palavras dela, ou "nada ainda"]
💰 [orçamento sinalizado: o que disse sobre dinheiro, nas palavras dela. NUNCA estime. Se não falou de dinheiro, responda exatamente "não falou"]
🤝 [acordo combinado: exatamente o que ficou de acontecer, quem faz e quando, ou "saiu sem acordo"]
⏭️ [próximo passo concreto]
❓ [o que falta descobrir: uma pergunta só que o consultor precisa fazer na próxima conversa]

Regras obrigatórias da ficha anexadas pelo código:
· 🛑 Objeção real: o que fez a pessoa recuar, nas palavras dela ("tá caro", "vou pensar"). Se não recuou nem apresentou objeção, coloque "nada ainda".
· 💰 Orçamento sinalizado: NUNCA estime nem deduza do produto desejado ou da profissão. Se a pessoa não falou de dinheiro, o campo diz que ela não falou: responda exatamente "não falou".
· 🤝 Acordo combinado: o que exatamente ficou de acontecer, quem faz e quando. "Vai pensar" não é acordo. Se não houve nada combinado, responda explicitamente "saiu sem acordo".
· ❓ O que falta descobrir: uma pergunta só, a que o consultor precisa fazer na próxima conversa. Não faça lista.
· Linha sem conteúdo real recebe exatamente "nada ainda" (exceto 💰 que recebe "não falou" e 🤝 que recebe "saiu sem acordo"). Nunca invente.

Se NÃO houver nenhuma intenção comercial (conversa pessoal entre amigos/família, menção casual sem interesse de compra, engano):
Responda em UMA LINHA SÓ:
🚫 [por que não é oportunidade comercial, poucas palavras]

Regras de escape:
· Só use 🚫 quando não houver nada comercial. Na dúvida, prefira as linhas com "nada ainda".
· Citar um produto de passagem, sem querer comprar, é 🚫.
· Nunca transforme comentário casual em intenção de compra.`;

export function buildSummarySystemPrompt(promptDoUsuario) {
  const base = String(promptDoUsuario || "").trim();
  // Se for o prompt padrão que já traz os quatro novos campos obrigatórios e escape, não precisa anexar de novo
  const jaTemContratoCompleto =
    base.includes("🛑") &&
    base.includes("💰") &&
    base.includes("❓") &&
    ["🎯", "📋", "🤝", "⏭", "🚫"].every((marcador) => base.includes(marcador));

  return jaTemContratoCompleto ? base : `${base}${SUMMARY_OUTPUT_CONTRACT}`;
}

function getModel() {
  const raw = String(process.env.GROQ_CAMPAIGN_AI_MODEL || process.env.GROQ_MODEL || "").trim();
  if (!raw || raw.includes(" ")) return DEFAULT_GROQ_MODEL;
  return raw;
}

/**
 * Verifica se um texto possui ação concreta com prazo explícito (quem faz e quando).
 * Permite que expressões contendo 'vou pensar' sejam válidas quando acompanhadas
 * de compromisso real (ex: 'vou pensar no que você falou e te mando o CNPJ amanhã').
 */
export function hasAcaoComPrazo(texto) {
  if (!texto || typeof texto !== "string") return false;
  const t = texto.toLowerCase();

  const prazoRegex = /(?:^|\W)(amanh[aã]|hoje|segunda(?:-feira)?|ter[cç]a(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|s[aá]bado|domingo|semana que vem|pr[oó]xima semana|fim de semana|m[eê]s que vem|\d{1,2}\/\d{1,2}|\d{1,2}h|\d{1,2}:\d{2}|[aà]s \d+|at[eé]|no fim do dia|de manh[aã]|[aà] tarde|[aà] noite|pela manh[aã]|daqui a \d+)(?:\W|$)/i;

  const acaoRegex = /(?:^|\W)(mand(?:o|a|ar|am|ando)|envi(?:o|a|ar|am|ando)|lig(?:o|a|ar|am|ando)|confer(?:e|ir|em|indo)|pass(?:o|a|ar|am|ando)|respond(?:o|e|er|em|endo)|fech(?:o|a|ar|am|ando)|assin(?:o|a|ar|am|ando)|transfer(?:e|ir|em|indo)|pag(?:o|a|ar|am|ando)|deposit(?:o|a|ar|am|ando)|retorn(?:o|a|ar|am|ando)|avis(?:o|a|ar|am|ando)|confirm(?:o|a|ar|am|ando))(?:\W|$)/i;

  return prazoRegex.test(t) && acaoRegex.test(t);
}

/**
 * Normaliza e formata o retorno da IA na ficha padrão comercial.
 * Tolera JSON parcial, chaves ausentes ou texto corrido sem descartar a resposta.
 *
 * @param {string|object} raw
 * @param {object} [options]
 * @returns {string|null}
 */
export function formatSummaryOutput(raw, options = {}) {
  if (!raw) return null;

  // 0. Detecção de saída de escape (🚫): conversa sem oportunidade comercial
  if (typeof raw === "string") {
    const trimmedRaw = raw.trim();
    const lines = trimmedRaw.split("\n").map((l) => l.trim()).filter(Boolean);
    const escapeLine = lines.find((l) => /🚫/u.test(l));
    if (escapeLine) {
      const reason = escapeLine
        .replace(/^.*?🚫\uFE0F?\s*(\[|:\s*)?/u, "")
        .replace(/\]\s*$/, "")
        .trim();
      return `🚫 ${reason || "Conversa pessoal — sem oportunidade comercial"}`.slice(0, 500);
    }
  }

  let objetivo = "";
  let fatos = "";
  let objecao = "";
  let orcamento = "";
  let combinados = "";
  let proximo = "";
  let faltaDescobrir = "";
  let hasNewMarkersInRaw = false;

  // 1. Tenta interpretar como JSON
  let parsed = null;
  if (typeof raw === "object" && raw !== null) {
    parsed = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    try {
      parsed = JSON.parse(trimmed);
    } catch (_) {
      const match = trimmed.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          parsed = JSON.parse(match[0]);
        } catch (_) {}
      }
    }
  }

  if (parsed && typeof parsed === "object") {
    if (parsed.nao_e_lead || parsed.nao_lead || parsed.sem_oportunidade || String(parsed.objetivo || "").includes("🚫")) {
      const reason = parsed.motivo || parsed.razao || String(parsed.objetivo || "").replace(/^.*?🚫\uFE0F?\s*(\[|:\s*)?/u, "").replace(/\]\s*$/, "").trim();
      return `🚫 ${reason || "Conversa pessoal — sem oportunidade comercial"}`.slice(0, 500);
    }
    objetivo = String(parsed.objetivo || parsed.o_que_quer || parsed.interesse || "").trim();
    fatos = String(parsed.fatos || parsed.fatos_estabelecidos || parsed.pontos_chave || "").trim();
    objecao = String(parsed.objecao || parsed.objecao_real || parsed.objecao_detectada || "").trim();
    orcamento = String(parsed.orcamento || parsed.orcamento_sinalizado || parsed.valor_sinalizado || "").trim();
    combinados = String(parsed.combinados || parsed.o_que_foi_combinado || parsed.acordos || parsed.acordo || parsed.acordo_combinado || "").trim();
    proximo = String(parsed.proximo_passo || parsed.proxima_acao || parsed.acao || "").trim();
    faltaDescobrir = String(parsed.falta_descobrir || parsed.o_que_falta_descobrir || parsed.pergunta_seguinte || parsed.pergunta || "").trim();

    if (parsed.objecao || parsed.objecao_real || parsed.orcamento || parsed.orcamento_sinalizado || parsed.falta_descobrir || parsed.o_que_falta_descobrir) {
      hasNewMarkersInRaw = true;
    }
  } else if (typeof raw === "string") {
    // 2. Extrai de texto corrido baseado nos marcadores de emoji.
    const MARCADORES = [
      { re: /^🎯\uFE0F?\s*/u, campo: "objetivo" },
      { re: /^📋\uFE0F?\s*/u, campo: "fatos" },
      { re: /^(?:🛑|⚠️|🛡️)\uFE0F?\s*/u, campo: "objecao" },
      { re: /^(?:💰|💵|💸)\uFE0F?\s*/u, campo: "orcamento" },
      { re: /^🤝\uFE0F?\s*/u, campo: "combinados" },
      { re: /^⏭\uFE0F?\s*/u, campo: "proximo" },
      { re: /^(?:❓|🔍|❔)\uFE0F?\s*/u, campo: "faltaDescobrir" },
    ];
    const capturado = {
      objetivo: "",
      fatos: "",
      objecao: "",
      orcamento: "",
      combinados: "",
      proximo: "",
      faltaDescobrir: "",
    };

    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const marcador = MARCADORES.find(({ re }) => re.test(line));
      if (marcador) {
        capturado[marcador.campo] = line.replace(marcador.re, "").trim();
        if (marcador.campo === "objecao" || marcador.campo === "orcamento" || marcador.campo === "faltaDescobrir") {
          hasNewMarkersInRaw = true;
        }
      } else if (!capturado.objetivo && !MARCADORES.some(({ re }) => re.test(line))) {
        // Primeira linha sem marcador nenhum: assume objetivo.
        capturado.objetivo = line;
      }
    }

    objetivo = capturado.objetivo;
    fatos = capturado.fatos;
    objecao = capturado.objecao;
    orcamento = capturado.orcamento;
    combinados = capturado.combinados;
    proximo = capturado.proximo;
    faltaDescobrir = capturado.faltaDescobrir;
  }

  // Limpeza de frases proibidas / vazias
  const sanitize = (val) => {
    if (!val || val === "null" || val === "undefined") return "nada ainda";
    let cleaned = val
      .replace(/[—–]/g, "-") // sem travessão
      .replace(/\b(dar continuidade ao contato comercial|qualificar o interesse)\b/gi, "nada ainda")
      .replace(/^\[|\]$/g, "")
      .trim();
    return cleaned || "nada ainda";
  };

  objetivo = sanitize(objetivo);
  fatos = sanitize(fatos);
  combinados = sanitize(combinados);
  proximo = sanitize(proximo);
  faltaDescobrir = sanitize(faltaDescobrir);
  if (faltaDescobrir.includes("\n")) {
    faltaDescobrir = faltaDescobrir.split("\n")[0].trim();
  }

  // Objeção real: Se o agente já capturou objecao_detectada na conversa, usa aquele valor diretamente
  const objecaoDetectada =
    options?.objecao_detectada ||
    options?.lead?.objecao_detectada ||
    options?.dados?.objecao_detectada ||
    (typeof options === "string" ? options : null);

  let objecaoFinal = "";
  if (objecaoDetectada && typeof objecaoDetectada === "string" && objecaoDetectada.trim().length > 0) {
    objecaoFinal = sanitize(objecaoDetectada);
  } else {
    objecaoFinal = sanitize(objecao);
  }
  if (!objecaoFinal || objecaoFinal === "null" || objecaoFinal === "undefined" || /^nenhum[ao]?$/i.test(objecaoFinal)) {
    objecaoFinal = "nada ainda";
  }

  // Orçamento sinalizado: REGRA MAIS IMPORTANTE: NUNCA ESTIME.
  // Se a pessoa não falou de dinheiro, o campo diz que ela não falou.
  let orcamentoFinal = sanitize(orcamento);
  const messagesList = Array.isArray(options?.messages) ? options.messages : [];
  if (messagesList.length > 0) {
    const fullText = messagesList
      .map((m) => (typeof m === "string" ? m : m?.text || m?.message_text || m?.body || ""))
      .join(" ")
      .toLowerCase();
    const moneyMentionRegex = /(r\$|\$|reais|mil\b|\b\d+k\b|parcel|cart[aã]o|limite|or[cç]amento|pre[cç]o|quanto custa|pagar|investimento|investir)/i;
    const falouDeDinheiro = moneyMentionRegex.test(fullText);
    if (!falouDeDinheiro) {
      orcamentoFinal = "não falou";
    }
  }

  const orcamentoAusenteRegex = /^(nada ainda|n[aã]o informad[ao]|n[aã]o mencionou|sem men[cç][aã]o|n[aã]o citou|n[aã]o falou.*|nenhum.*|null|undefined)$/i;
  if (!orcamentoFinal || orcamentoAusenteRegex.test(orcamentoFinal)) {
    orcamentoFinal = "não falou";
  }

  // Acordo combinado: Se a frase tem ação concreta com prazo (quem faz e quando), é acordo
  // mesmo que contenha "vou pensar".
  // Sem ação concreta com prazo, ou frase vaga ("vou pensar e qualquer coisa te chamo"),
  // o campo vira explicitamente "saiu sem acordo".
  let acordoFinal = sanitize(combinados);
  const ausenciaLiteralRegex = /^(nada ainda|sem acordo|saiu sem acordo|n[aã]o combinad[ao]|nada combinad[ao]|nenhum.*|n[aã]o houve.*|null|undefined)$/i;
  const hesitacaoVagaRegex = /\b(vai pensar|vou pensar|vai ver|vou ver|pensar|analisar|qualquer coisa|vamos nos falando|depois vejo|depois te aviso)\b/i;

  if (!acordoFinal || ausenciaLiteralRegex.test(acordoFinal)) {
    acordoFinal = "saiu sem acordo";
  } else if (hesitacaoVagaRegex.test(acordoFinal)) {
    // Só é acordo se tiver ação concreta com prazo (quem faz e quando)
    if (!hasAcaoComPrazo(acordoFinal)) {
      acordoFinal = "saiu sem acordo";
    }
  }

  // Validade do resumo: resumo com todos os blocos vazios é inválido e vira null.
  // Os blocos novos não podem fazer um resumo vazio parecer preenchido:
  // "não falou" e "saiu sem acordo" são conteúdo legítimo, mas não bastam sozinhos para um resumo existir.
  const isVazio = (v) => !v || v === "nada ainda" || v === "null" || v === "undefined";
  const orcamentoEhAusencia = isVazio(orcamentoFinal) || orcamentoFinal === "não falou" || orcamentoFinal === "não falou de valor";
  const acordoEhAusencia = isVazio(acordoFinal) || acordoFinal === "saiu sem acordo" || acordoFinal === "nada ainda";

  const semConteudoReal =
    isVazio(objetivo) &&
    isVazio(fatos) &&
    isVazio(proximo) &&
    isVazio(objecaoFinal) &&
    isVazio(faltaDescobrir) &&
    orcamentoEhAusencia &&
    acordoEhAusencia;

  if (semConteudoReal) {
    return null;
  }

  // Compatibilidade: preserva formato de 4 linhas se for uma resposta antiga que não tinha nenhum campo novo
  const isFicha = Boolean(
    hasNewMarkersInRaw ||
    options?.fullFicha ||
    options?.isFicha ||
    options?.objecao_detectada ||
    (objecaoDetectada && objecaoDetectada.trim().length > 0) ||
    (typeof raw === "string" && (/saiu sem acordo/i.test(raw) || /não falou/i.test(raw)))
  );

  let formattedLines;
  if (isFicha) {
    formattedLines = [
      `🎯 ${objetivo}`,
      `📋 ${fatos}`,
      `🛑 ${objecaoFinal}`,
      `💰 ${orcamentoFinal}`,
      `🤝 ${acordoFinal}`,
      `⏭️ ${proximo}`,
      `❓ ${faltaDescobrir}`,
    ];
  } else {
    formattedLines = [
      `🎯 ${objetivo}`,
      `📋 ${fatos}`,
      `🤝 ${combinados}`,
      `⏭️ ${proximo}`,
    ];
  }

  const resultStr = formattedLines.slice(0, 10).join("\n").slice(0, 800);
  return resultStr;
}

/**
 * Extrai os campos individuais da ficha ou resumo, garantindo compatibilidade:
 * Campo ausente vira o texto de ausência correspondente, nunca erro e nunca string vazia.
 *
 * @param {string|object} raw
 * @param {object} [options]
 * @returns {object|null}
 */
export function extractSummaryFields(raw, options = {}) {
  const defaultAbsent = {
    objetivo: "nada ainda",
    fatos: "nada ainda",
    objecao: "nada ainda",
    orcamento: "não falou",
    acordo: "saiu sem acordo",
    proximo: "nada ainda",
    faltaDescobrir: "nada ainda",
  };

  if (!raw) {
    return defaultAbsent;
  }

  const res = formatSummaryOutput(raw, { ...options, fullFicha: true });
  if (!res) return null;

  if (res.startsWith("🚫")) {
    return {
      ...defaultAbsent,
      objetivo: res,
      escape: true,
    };
  }

  const result = { ...defaultAbsent };
  const lines = res.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    if (/^🎯\uFE0F?\s*/u.test(line)) {
      result.objetivo = line.replace(/^🎯\uFE0F?\s*/u, "").trim() || "nada ainda";
    } else if (/^📋\uFE0F?\s*/u.test(line)) {
      result.fatos = line.replace(/^📋\uFE0F?\s*/u, "").trim() || "nada ainda";
    } else if (/^(?:🛑|⚠️|🛡️)\uFE0F?\s*/u.test(line)) {
      result.objecao = line.replace(/^(?:🛑|⚠️|🛡️)\uFE0F?\s*/u, "").trim() || "nada ainda";
    } else if (/^(?:💰|💵|💸)\uFE0F?\s*/u.test(line)) {
      result.orcamento = line.replace(/^(?:💰|💵|💸)\uFE0F?\s*/u, "").trim() || "não falou";
    } else if (/^🤝\uFE0F?\s*/u.test(line)) {
      result.acordo = line.replace(/^🤝\uFE0F?\s*/u, "").trim() || "saiu sem acordo";
    } else if (/^⏭\uFE0F?\s*/u.test(line)) {
      result.proximo = line.replace(/^⏭\uFE0F?\s*/u, "").trim() || "nada ainda";
    } else if (/^(?:❓|🔍|❔)\uFE0F?\s*/u.test(line)) {
      result.faltaDescobrir = line.replace(/^(?:❓|🔍|❔)\uFE0F?\s*/u, "").trim() || "nada ainda";
    }
  }

  return result;
}

/**
 * Busca prompt customizado do tenant se existir
 */
async function resolvePromptForTenant(clientId, options = {}) {
  if (options.customPrompt && typeof options.customPrompt === "string") {
    return options.customPrompt.trim();
  }

  if (!clientId) return DEFAULT_SUMMARY_PROMPT;

  // 1. Tenta via Postgres Pool se fornecido
  if (options.pool) {
    try {
      const res = await options.pool.query(
        "SELECT content FROM public.chatbot_prompts WHERE client_id = $1 AND type = 'resumo' LIMIT 1",
        [clientId]
      );
      if (res?.rows?.[0]?.content && res.rows[0].content.trim().length > 10) {
        return res.rows[0].content.trim();
      }
    } catch (_) {}
  }

  // 2. Tenta via Supabase client se fornecido
  if (options.supabase) {
    try {
      const { data } = await options.supabase
        .from("chatbot_prompts")
        .select("content")
        .eq("client_id", clientId)
        .eq("type", "resumo")
        .maybeSingle();
      if (data?.content && data.content.trim().length > 10) {
        return data.content.trim();
      }
    } catch (_) {}
  }

  return DEFAULT_SUMMARY_PROMPT;
}

/**
 * @param {string[]} messages  mensagens da conversa (ordem cronológica)
 * @param {string} contactName
 * @param {object} [options] { clientId, customPrompt, supabase, pool }
 * @returns {Promise<{summary:string|null, canalSugerido:string|null, prioridade:string|null, error?:string}|null>}
 */
export async function summarizeChatWithAI(messages, contactName, options = {}) {
  const texts = (messages || []).map((m) => String(m || "").trim()).filter(Boolean);
  if (texts.length === 0) {
    return { summary: null, error: "Nenhuma mensagem fornecida para análise." };
  }

  const clientId = options?.clientId || null;
  const promptToUse = buildSummarySystemPrompt(await resolvePromptForTenant(clientId, options));

  // Varre a conversa inteira (até 100 mensagens ou 16.000 caracteres para não perder fatos iniciais)
  const conversa = texts.slice(-100).join("\n").slice(0, 16000);

  let lastError = null;

  // Resolver objecao_detectada da conversa se disponível
  let resolvedObjecao = options?.objecao_detectada || options?.lead?.objecao_detectada || options?.dados?.objecao_detectada || null;
  if (!resolvedObjecao && (options?.pool || options?.supabase) && clientId && options?.phone) {
    try {
      const cleanPhone = String(options.phone).replace(/\D/g, "");
      if (cleanPhone) {
        if (options.pool) {
          const rowRes = await options.pool.query(
            `SELECT objecao_detectada, dados FROM public.leads WHERE client_id = $1 AND (phone = $2 OR phone = $3) LIMIT 1`,
            [clientId, cleanPhone, `55${cleanPhone}`]
          );
          if (rowRes?.rows?.[0]) {
            resolvedObjecao = rowRes.rows[0].objecao_detectada || rowRes.rows[0].dados?.objecao_detectada || null;
          }
        } else if (options.supabase) {
          const { data } = await options.supabase
            .from("leads")
            .select("objecao_detectada, dados")
            .eq("client_id", clientId)
            .or(`phone.eq.${cleanPhone},phone.eq.55${cleanPhone}`)
            .limit(1)
            .maybeSingle();
          if (data) {
            resolvedObjecao = data.objecao_detectada || data.dados?.objecao_detectada || null;
          }
        }
      }
    } catch (_) {}
  }

  const formatOpts = {
    ...options,
    messages: texts,
    objecao_detectada: resolvedObjecao,
    fullFicha: true,
  };

  // 1. Tenta via callLlmChatCompletion (suporta Groq, OpenAI, Gemini com retries automáticos)
  try {
    const rawResult = await callLlmChatCompletion({
      model: getModel(),
      temperature: 0.1,
      max_tokens: 450,
      messages: [
        { role: "system", content: promptToUse },
        { role: "user", content: `Contato: ${contactName || "desconhecido"}\n\nHistórico da Conversa:\n${conversa}` },
      ],
    });

    if (rawResult) {
      const summary = formatSummaryOutput(rawResult, formatOpts);
      if (summary) {
        const fields = extractSummaryFields(summary, formatOpts);
        let acordoSugerido = null;
        if (fields?.acordo && fields.acordo !== "saiu sem acordo" && fields.acordo !== "nada ainda") {
          acordoSugerido = {
            texto: fields.acordo,
            prazo_data: parsePrazoData(fields.acordo),
            quem_faz: /consultor|nós|vamos enviar|vou enviar|vou mandar/i.test(fields.acordo) ? "consultor" : "lead",
            registrado_em: new Date().toISOString(),
            confirmado_por: null,
            confirmado_em: null,
          };
        }
        return {
          summary,
          canalSugerido: "followup",
          prioridade: "media",
          fields,
          acordo_sugerido: acordoSugerido,
        };
      }
      lastError = "Formatação do resumo retornou vazio a partir da resposta da IA.";
    }
  } catch (err) {
    lastError = err?.message || String(err);
    console.warn("[chat-insight] callLlmChatCompletion falhou, tentando fallback direto:", lastError);
  }

  // 2. Fallback direto para Groq API com modelos canônicos
  if (process.env.GROQ_API_KEY) {
    // Escada compartilhada: os dois nomes que estavam aqui foram descontinuados.
    const modelsToTry = resolveGroqLadder(getModel());
    for (const m of Array.from(new Set(modelsToTry))) {
      try {
        const response = await fetch(GROQ_BASE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: m,
            temperature: 0.1,
            max_tokens: 450,
            messages: [
              { role: "system", content: promptToUse },
              { role: "user", content: `Contato: ${contactName || "desconhecido"}\n\nHistórico da Conversa:\n${conversa}` },
            ],
          }),
        });

        if (!response.ok) {
          const corpo = await response.text().catch(() => "");
          const diagnostico = classifyLlmHttpError(response.status, corpo);
          lastError =
            diagnostico.tipo === "COTA_ESTOURADA"
              ? `Cota de IA estourada no modelo ${m}${diagnostico.limiteTpm ? ` (teto ${diagnostico.limiteTpm} TPM)` : ""}`
              : diagnostico.tipo === "MODELO_INEXISTENTE"
                ? `Modelo ${m} nao existe mais na Groq (HTTP ${response.status})`
                : `Groq API status ${response.status}: ${response.statusText}`;
          console.warn(`[chat-insight] ${lastError}`);
          continue;
        }

        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) {
          lastError = "Groq retornou conteúdo vazio.";
          continue;
        }

        const summary = formatSummaryOutput(content, formatOpts);
        if (summary) {
          const fields = extractSummaryFields(summary, formatOpts);
          let acordoSugerido = null;
          if (fields?.acordo && fields.acordo !== "saiu sem acordo" && fields.acordo !== "nada ainda") {
            acordoSugerido = {
              texto: fields.acordo,
              prazo_data: parsePrazoData(fields.acordo),
              quem_faz: /consultor|nós|vamos enviar|vou enviar|vou mandar/i.test(fields.acordo) ? "consultor" : "lead",
              registrado_em: new Date().toISOString(),
              confirmado_por: null,
              confirmado_em: null,
            };
          }
          return {
            summary,
            canalSugerido: "followup",
            prioridade: "media",
            fields,
            acordo_sugerido: acordoSugerido,
          };
        }
      } catch (e) {
        lastError = e?.message || String(e);
        console.warn(`[chat-insight] groq fallback (${m}) falhou:`, lastError);
      }
    }
  }

  // Falhou completamente: retorna null / erro explicativo. NUNCA template de mentira!
  return {
    summary: null,
    error: lastError || "Falha na chamada ao modelo de IA.",
  };
}

/**
 * Determina se o lead possui uma conversa com oportunidade comercial real.
 * Re-exportado de services/conversationInsightHelper.js para compatibilidade.
 */
export { temConversaComercial } from "../../services/conversationInsightHelper.js";

