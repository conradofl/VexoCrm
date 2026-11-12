// Extração assistida por IA dos campos do briefing a partir da transcrição.
//
// Substitui a heurística por palavra-chave que rodava no front. Aquela abordagem
// procurava a palavra na frase e devolvia a linha encontrada, o que numa
// transcrição real produzia sistematicamente o texto errado: a pergunta em vez
// da resposta, o nome de quem falou colado no valor, trechos do resumo
// automático da reunião e fragmentos sem sentido ("Ja."). Conversa humana não é
// estruturada o bastante para casamento de string.
//
// Reusa a mesma infra de IA do contrato e das campanhas (Groq / API compatível
// com OpenAI) — sem dependência nem chave nova.
import { sendError } from "../../services/httpInfra.js";
import { defaultGroqModel } from "../../services/llmModels.js";
import { extractJsonFromLlmText } from "../../services/jsonExtractor.js";
import { callLlmChatCompletion } from "../../chatbot-ai-engine.js";

const GROQ_BASE_URL = "https://api.groq.com/openai/v1/chat/completions";
const DEFAULT_GROQ_MODEL = defaultGroqModel();
const STRICT_JSON_MODELS = new Set(["openai/gpt-oss-20b", "openai/gpt-oss-120b"]);

function getModel() {
  return process.env.GROQ_CAMPAIGN_AI_MODEL || DEFAULT_GROQ_MODEL;
}

// Campos do formulário de briefing. As descrições guiam a IA.
// Espelham DEFAULT_BRIEFING_FIELDS no front e o ClientContractInfo.
const CAMPOS = {
  // Bloco A - Dados Contratuais e Empresa
  razaoSocial: "Razão social ou nome fantasia da empresa / cliente (ex: Sonhare Colchões, Ótica Visão Prime, Burger Flow)",
  cnpj: "CNPJ da empresa contratante formatado (ex: 00.000.000/0001-00) ou apenas dígitos se citado",
  responsavel: "Nome completo do responsável principal ou decisor da empresa (ex: Caio Almeida, Dr. Silva, Conrado)",
  whatsapp: "Número de WhatsApp comercial do cliente com DDD",
  email: "E-mail comercial ou financeiro corporativo da empresa",
  endereco: "Endereço completo da empresa (rua, número, bairro, cidade, estado/região)",
  produtos: "Lista dos produtos ou serviços contratados pelo cliente (ex: Gestão de redes sociais (Instagram), Gestão de redes sociais (Facebook), Gestão de tráfego google/meta ads, Google ads, Google meu negócio, Landing Page\\site, E-commerce, Logomarca, Branding)",

  // Bloco B - Diagnóstico Comercial & Funil
  concorrentes: "Principais concorrentes diretos citados",
  como_vende: "Como a empresa vende hoje (processo comercial, funil atual, equipe de vendas, WhatsApp manual, balcão, indicação)",
  servicos: "Produtos e serviços que a empresa vende (core business) E o diferencial competitivo, o que faz o cliente escolher este negócio em vez do concorrente",
  mitos_perguntas_recorrentes: "Mitos, objeções, preconceitos e dúvidas mais frequentes que os clientes sempre fazem antes de comprar",
  temas: "Temas e assuntos que combinam com a marca e devem ser abordados nos conteúdos",
  base_existente: "Se possui base de clientes cadastrada, lista de contatos, WhatsApp ou e-mails para remarketing",
  publico_alvo: "Visão geral do público-alvo e clientes ideais",
  "publico_alvo.genero": "Gênero predominante do público-alvo (Homens, Mulheres, Unissex/Todos)",
  "publico_alvo.idade": "Faixa etária do público-alvo (ex: 25 a 45 anos)",
  "publico_alvo.classe": "Classe social ou poder aquisitivo do público-alvo (ex: Classe A/B, Classe C)",
  "publico_alvo.interesses": "Interesses, estilo de vida e comportamentos do público-alvo",
  "publico_alvo.outros_detalhes": "Outros detalhes ou hábitos específicos do público-alvo",
  dores_publico: "Principais dores, frustrações e necessidades que levam o cliente a procurar a empresa",
  bloqueado: "Assuntos proibidos que a empresa NÃO quer que sejam abordados nos perfis (política, concorrência, etc.)",
  inspiracao: "Perfis, concorrentes indiretos ou marcas citadas como referência visual ou estética",

  // Bloco C - Mídia & Tráfego
  objetivo_trafego: "Objetivo principal do tráfego (reconhecimento, alcance, leads no whatsapp, vendas, conversão, remarketing)",
  verba: "Valor total de verba disponível para anúncios (ex: R$ 3.000 / mês)",
  verba_periodicidade: "Periodicidade da verba. Responda exatamente: Mensal, Semanal ou Por campanha/período",
  divisao_verba: "Como a verba se divide entre Google e Meta (ex: 70% Meta e 30% Google)",
  tipo_pagamento: "Forma de pagamento da mídia. Responda exatamente: Cartão de crédito virtual, PIX ou Boleto",
  ticket_margem: "Ticket médio dos produtos/serviços e margem de lucro aproximada",
  ja_rodou_trafego: "Se já investiu em tráfego pago antes. Responda exatamente: Sim, Não ou Não sei",
  trafego_historico: "Histórico com agências ou gestores anteriores, o que funcionou e o que não funcionou",
  produtos_trafego: "Quais produtos ou serviços específicos serão o foco das campanhas pagas",
  sazonalidade: "Datas comemorativas, épocas do ano, lançamentos ou sazonalidades que puxam as vendas",

  // Bloco D - Técnico & Acessos
  logo: "Onde está a logomarca em alta resolução ou link de drive/vetores",
  instagram: "Login, usuário (@usuario) ou forma de acesso ao Instagram",
  facebook: "Login, link ou forma de acesso à página comercial do Facebook",
  possui_bm: "Se a empresa possui Business Manager configurada. Responda exatamente: Sim, Não ou Não sei",
  google: "Login ou forma de acesso ao Google Ads / Analytics / Perfil da Empresa",
  site: "Endereço do site ou página web ativa da empresa",
  dominios_dns: "Onde o domínio/DNS está hospedado (ex: Cloudflare, Registro.br, Hostgator, etc.)",
  localizacao: "Região, bairros, cidade ou abrangência geográfica de atendimento",
};

// json_schema não aceita ponto no nome da propriedade em todos os modelos, então
// as chaves viajam com underscore e são traduzidas de volta na saída.
const paraChaveIA = (k) => k.replace(/\./g, "__");
const daChaveIA = (k) => k.replace(/__/g, ".");

const BRIEFING_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(
    Object.entries(CAMPOS).map(([k, desc]) => [paraChaveIA(k), { type: "string", description: desc }])
  ),
  required: Object.keys(CAMPOS).map(paraChaveIA),
  additionalProperties: false,
};

const SYSTEM_PROMPT = [
  "Você extrai dados de briefing comercial a partir da transcrição de uma reunião em português do Brasil.",
  "Responda APENAS com JSON válido, sem markdown.",
  "REGRAS OBRIGATÓRIAS:",
  "1. NUNCA invente. Se a informação não estiver clara na transcrição, retorne string vazia.",
  "2. Extraia a RESPOSTA do cliente, nunca a pergunta de quem entrevista.",
  "3. NUNCA inclua o nome de quem falou no valor. Sem 'Fulano:', sem '[Fulano]', e sem citar",
  "   a pessoa em terceira pessoa ('Fulano confirma que...'). Escreva só o conteúdo da resposta.",
  "4. Ignore o resumo automático, itens de ação, marcações de tempo (00:13:31) e saudações.",
  "5. Não repita o mesmo texto em campos diferentes. Se dois campos disputam o mesmo trecho,",
  "   deixe no mais específico e retorne vazio no outro.",
  "6. Responda de forma curta e direta, com o fato, não com a narrativa da conversa.",
  "7. Nos campos que pedem uma opção exata, use exatamente uma das opções indicadas.",
].join(" ");

export async function extractBriefingFields(req, res) {
  try {
    const { transcricao } = req.body || {};
    if (!transcricao || String(transcricao).trim().length < 30) {
      return sendError(res, 400, "BAD_REQUEST", "Cole a transcrição da reunião para a IA extrair os campos.");
    }

    let parsed = null;

    // 1. Tenta Groq diretamente se houver chave configurada
    if (process.env.GROQ_API_KEY) {
      const model = getModel();
      const payload = {
        model,
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: `Extraia os campos do briefing da transcrição abaixo:\n\n"""\n${String(transcricao).slice(0, 24000)}\n"""`,
          },
        ],
        response_format: STRICT_JSON_MODELS.has(model)
          ? { type: "json_schema", json_schema: { name: "briefing_fields", strict: true, schema: BRIEFING_SCHEMA } }
          : { type: "json_object" },
      };

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45_000);
      try {
        const response = await fetch(GROQ_BASE_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
        const rawBody = await response.text();
        if (response.ok) {
          const data = JSON.parse(rawBody);
          const content = data?.choices?.[0]?.message?.content;
          if (content) {
            parsed = extractJsonFromLlmText(content);
          }
        }
      } catch (groqErr) {
        console.warn("[extractBriefingFields] Falha temporária na Groq, acionando motor central de LLM:", groqErr?.message);
      } finally {
        clearTimeout(timeout);
      }
    }

    // 2. Fallback robusto para o motor central de LLM (Gemini, OpenAI, ladder)
    if (!parsed || typeof parsed !== "object") {
      try {
        const raw = await callLlmChatCompletion({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `Extraia todos os campos do briefing em formato JSON estrito para cada chave solicitada:\nCampos esperados: ${Object.keys(CAMPOS).join(", ")}\n\nTranscrição:\n"""\n${String(transcricao).slice(0, 24000)}\n"""`,
            },
          ],
          temperature: 0,
          max_tokens: 3500,
          response_format: { type: "json_object" },
        });
        if (raw) {
          parsed = extractJsonFromLlmText(raw);
        }
      } catch (ladderErr) {
        console.error("[extractBriefingFields] Falha no motor central de LLM:", ladderErr?.message);
      }
    }

    if (!parsed || typeof parsed !== "object") {
      return sendError(res, 503, "AI_UNAVAILABLE", "Não foi possível extrair com IA no momento. O formulário usará o assistente heurístico local.");
    }

    // Rede de segurança: mesmo instruída, a IA pode devolver o nome do falante.
    const limparFalante = (t) =>
      String(t || "")
        .replace(/^\s*\[?[\p{Lu}][\p{L}.'\- ]{1,40}\]?\s*:\s*/u, "")
        .replace(/\s*\(\d{1,2}:\d{2}(:\d{2})?\)\s*$/, "")
        .trim();

    const out = {};
    for (const chave of Object.keys(CAMPOS)) {
      const bruto = parsed?.[paraChaveIA(chave)] ?? parsed?.[chave];
      out[chave] = typeof bruto === "string" ? limparFalante(bruto) : "";
    }

    // Aliases bidirecionais para compatibilidade total front/back
    if (out.razaoSocial && !out.prospectName) out.prospectName = out.razaoSocial;
    if (out.prospectName && !out.razaoSocial) out.razaoSocial = out.prospectName;

    res.json({ success: true, data: out });
  } catch (error) {
    console.error("[extractBriefingFields] Error:", error);
    if (!res.headersSent) {
      sendError(res, 500, "INTERNAL_ERROR", "Erro ao extrair o briefing com a IA.");
    }
  }
}

export { CAMPOS as CAMPOS_BRIEFING, daChaveIA };
