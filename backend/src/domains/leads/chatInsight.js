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

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = defaultGroqModel();

export const DEFAULT_SUMMARY_PROMPT = `Você resume conversas de WhatsApp para o dono do negócio se situar sem precisar reler tudo.

Ele abre o chat depois de dias e precisa lembrar em dez segundos o que já foi combinado.

FORMATO PADRÃO (no máximo seis linhas):

🎯 [o que a pessoa quer, uma linha]
📋 [fatos já estabelecidos: quantas pessoas, datas, destino, valores, nomes. Literal, tirado da conversa]
🤝 [o que foi combinado ou prometido]
⏭️ [próximo passo concreto, uma linha]

SAÍDA DE ESCAPE (QUANDO NÃO HOUVER NENHUMA OPORTUNIDADE COMERCIAL):
Quando não houver NENHUMA intenção comercial (conversa puramente pessoal, amigos, família, spam ou comentário casual sem interesse de compra), responda em UMA LINHA SÓ:
🚫 [por que não é oportunidade comercial, poucas palavras]

REGRAS
· Só use 🚫 quando não houver NADA comercial. Na dúvida, prefira as quatro linhas com "nada ainda".
· Citar um produto ou serviço de passagem, sem querer comprar, é 🚫.
· Nunca transforme comentário casual ou piada em intenção de compra (exemplo: "o cara bota i.a pra falar com o amigo" não significa querer comprar IA).
· 📋 é a linha mais importante quando houver oportunidade. São os fatos que se esquecem: "2 adultos e 1 criança de 4 anos", "quer ir em janeiro", "orçamento até 8 mil". Varra a conversa INTEIRA, não só as últimas mensagens.
· Nunca invente. O que não foi dito não entra.
· Bloco sem conteúdo real recebe "nada ainda". Nunca preencha com frase de efeito.
· ⏭️ jamais pode ser "dar continuidade ao contato comercial" nem "qualificar o interesse". Isso não diz nada. Tem que ser a ação exata: "cotar Maceió em janeiro para 2 adultos e 1 criança".
· Não use travessão.
· Não repita a conversa. Isso é resumo, não transcrição.
· Sem subitens (a)(b)(c), sem parágrafos, sem numeração.`;

/**
 * Contrato de SAIDA do resumo, anexado pelo codigo — nunca deixado a cargo do
 * texto que o dono edita na tela. Mesmo principio do contrato JSON do agente
 * (buildJsonInstruction) e do buildFieldContext: o usuario escreve COMPORTAMENTO,
 * o sistema garante o FORMATO.
 *
 * Sem isto, um prompt de resumo reescrito sem os quatro emojis faz
 * formatSummaryOutput nao achar marcador nenhum e devolver "nada ainda" nas
 * quatro linhas — resumo vazio, sem erro, exatamente o tipo de falha silenciosa
 * que este repositorio ja pagou caro tres vezes.
 */
export const SUMMARY_OUTPUT_CONTRACT = `

═══════════════════════════════════════════════════════════════
FORMATO DE SAÍDA OBRIGATÓRIO
═══════════════════════════════════════════════════════════════
Se houver oportunidade comercial ou intenção de compra, responda EXATAMENTE nestas quatro linhas, cada uma começando pelo seu emoji, sem texto antes ou depois, sem markdown, sem numeração:

🎯 [o que a pessoa quer]
📋 [fatos já estabelecidos, literais da conversa]
🤝 [o que foi combinado ou prometido]
⏭️ [próximo passo concreto]

Linha sem conteúdo real recebe exatamente "nada ainda". Nunca invente.

Se NÃO houver nenhuma intenção comercial (conversa pessoal entre amigos/família, menção casual sem interesse de compra, engano):
Responda em UMA LINHA SÓ:
🚫 [por que não é oportunidade comercial, poucas palavras]

Regras de escape:
· Só use 🚫 quando não houver nada comercial. Na dúvida, prefira as quatro linhas com "nada ainda".
· Citar um produto de passagem, sem querer comprar, é 🚫.
· Nunca transforme comentário casual em intenção de compra.`;

export function buildSummarySystemPrompt(promptDoUsuario) {
  const base = String(promptDoUsuario || "").trim();
  // Prompt que ja traz os quatro marcadores e o marcador de escape nao recebe o contrato de novo
  const jaTemContrato = ["🎯", "📋", "🤝", "⏭", "🚫"].every((marcador) => base.includes(marcador));
  return jaTemContrato ? base : `${base}${SUMMARY_OUTPUT_CONTRACT}`;
}

function getModel() {
  const raw = String(process.env.GROQ_CAMPAIGN_AI_MODEL || process.env.GROQ_MODEL || "").trim();
  // A exclusao de "gpt-oss" que estava aqui recusava justamente a UNICA familia
  // de modelos que a conta ainda tem, e caia no llama-3.3, descontinuado (404).
  // Era o motivo de o resumo do Inbox nao gerar de jeito nenhum.
  if (!raw || raw.includes(" ")) return DEFAULT_GROQ_MODEL;
  return raw;
}

/**
 * Normaliza e formata o retorno da IA no padrão estrito de 4 seções (máximo 6 linhas).
 * Tolera JSON parcial, chaves ausentes ou texto corrido sem descartar a resposta.
 */
export function formatSummaryOutput(raw) {
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
  let combinados = "";
  let proximo = "";

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
    combinados = String(parsed.combinados || parsed.o_que_foi_combinado || parsed.acordos || "").trim();
    proximo = String(parsed.proximo_passo || parsed.proxima_acao || parsed.acao || "").trim();
  } else if (typeof raw === "string") {
    // 2. Extrai de texto corrido baseado nos marcadores de emoji.
    //
    // O seletor de variacao U+FE0F e OPCIONAL em cada marcador: o modelo emite
    // ora "⏭️" ora "⏭" cru, e startsWith("⏭️") falhava no segundo caso — a linha
    // do proximo passo caia para "nada ainda" sem erro nenhum aparecer.
    const MARCADORES = [
      { re: /^🎯\uFE0F?\s*/u, campo: "objetivo" },
      { re: /^📋\uFE0F?\s*/u, campo: "fatos" },
      { re: /^🤝\uFE0F?\s*/u, campo: "combinados" },
      { re: /^⏭\uFE0F?\s*/u, campo: "proximo" },
    ];
    const capturado = { objetivo: "", fatos: "", combinados: "", proximo: "" };

    const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of lines) {
      const marcador = MARCADORES.find(({ re }) => re.test(line));
      if (marcador) {
        capturado[marcador.campo] = line.replace(marcador.re, "").trim();
      } else if (!capturado.objetivo && !MARCADORES.some(({ re }) => re.test(line))) {
        // Primeira linha sem marcador nenhum: assume objetivo.
        capturado.objetivo = line;
      }
    }

    objetivo = capturado.objetivo;
    fatos = capturado.fatos;
    combinados = capturado.combinados;
    proximo = capturado.proximo;
  }

  // Limpeza de frases proibidas / vazias
  const sanitize = (val) => {
    if (!val || val === "null" || val === "undefined") return "nada ainda";
    let cleaned = val
      .replace(/[—–]/g, "-") // sem travessão
      .replace(/\b(dar continuidade ao contato comercial|qualificar o interesse)\b/gi, "nada ainda")
      .trim();
    return cleaned || "nada ainda";
  };

  objetivo = sanitize(objetivo);
  fatos = sanitize(fatos);
  combinados = sanitize(combinados);
  proximo = sanitize(proximo);

  // Se todos os 4 blocos forem "nada ainda", não é um resumo válido
  if (objetivo === "nada ainda" && fatos === "nada ainda" && combinados === "nada ainda" && proximo === "nada ainda") {
    return null;
  }

  const formattedLines = [
    `🎯 ${objetivo}`,
    `📋 ${fatos}`,
    `🤝 ${combinados}`,
    `⏭️ ${proximo}`,
  ];

  // Limite estrito de no máximo 6 linhas e 500 caracteres
  return formattedLines.slice(0, 6).join("\n").slice(0, 500);
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

  // 1. Tenta via callLlmChatCompletion (suporta Groq, OpenAI, Gemini com retries automáticos)
  try {
    const rawResult = await callLlmChatCompletion({
      model: getModel(),
      temperature: 0.1,
      max_tokens: 350,
      messages: [
        { role: "system", content: promptToUse },
        { role: "user", content: `Contato: ${contactName || "desconhecido"}\n\nHistórico da Conversa:\n${conversa}` },
      ],
    });

    if (rawResult) {
      const summary = formatSummaryOutput(rawResult);
      if (summary) {
        return {
          summary,
          canalSugerido: "followup",
          prioridade: "media",
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
            max_tokens: 350,
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

        const summary = formatSummaryOutput(content);
        if (summary) {
          return {
            summary,
            canalSugerido: "followup",
            prioridade: "media",
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
 * Retorna true se houver raw_chat_summary preenchido e que NÃO comece com 🚫
 * (pois 🚫 indica conversa pessoal, piada, família ou sem oportunidade comercial).
 *
 * Aceita um objeto lead (com raw_chat_summary) ou a própria string de resumo.
 *
 * @param {object|string|null} leadOuSummary
 * @returns {boolean}
 */
export function temConversaComercial(leadOuSummary) {
  if (!leadOuSummary) return false;
  const summary =
    typeof leadOuSummary === "object"
      ? leadOuSummary.raw_chat_summary || leadOuSummary.summary
      : leadOuSummary;

  if (!summary || typeof summary !== "string") return false;
  const trimmed = summary.trim();
  if (!trimmed) return false;

  // Se começar com 🚫, é conversa pessoal / sem oportunidade comercial
  if (/^🚫/u.test(trimmed)) return false;

  return true;
}

