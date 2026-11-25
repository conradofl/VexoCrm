// backend/src/domains/leads/aiExtractRoutes.js
// Endpoint de extração semântica e inteligente de contatos/conversas com Groq (Llama 3.3 70B Versatile).

import { callLlmChatCompletion } from "../../services/llm/client.js";
import { defaultGroqModel } from "../../services/llmModels.js";

export function registerAiExtractRoutes(app, deps) {
  const {
    requireFirebaseAuth,
    requireAppViewAccess,
  } = deps;

  app.post(
    "/api/leads/ai-extract",
    requireFirebaseAuth,
    // "leads" saiu de INTERNAL_PAGE_KEYS (fc4f49e). Unico chamador e
    // BancoDeDados.tsx:783, rota interna gateada no frontend por
    // requiredInternalPage="banco-de-dados" — mesma chave aqui.
    requireAppViewAccess("banco-de-dados"),
    async (req, res) => {
      try {
        const { rawText, defaultOrigin, defaultContactName } = req.body || {};

        if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
          return res.status(400).json({
            success: false,
            error: {
              code: "MISSING_RAW_TEXT",
              message: "O texto ou diálogo para análise é obrigatório.",
            },
          });
        }

        // Extrai fallback do nome do cabeçalho se houver "Contato: Nome"
        let fallbackName = defaultContactName ? String(defaultContactName).trim() : "";
        if (!fallbackName) {
          const matchName = rawText.match(/Contato:\s*([^\n\r]+)/i);
          if (matchName) fallbackName = matchName[1].trim();
        }

        if (!process.env.GROQ_API_KEY && !process.env.OPENAI_API_KEY && !process.env.GEMINI_API_KEY) {
          return res.status(503).json({
            success: false,
            error: {
              code: "GROQ_DISABLED",
              message: "Provedor de IA não configurado no servidor.",
            },
          });
        }

        const prompt = `Você é um extrator de contatos comerciais de altíssima precisão.
Analise o diálogo abaixo e extraia SEMPRE o contato identificado pelo nome/perfil.
Regras de Extração Obrigatórias:
1. "nome": Nome da pessoa no cabeçalho ou @username (ex: "${fallbackName || "Lead Social"}"). NUNCA deixe vazio se houver contato.
2. "telefone": Dígitos com DDD se houver no texto, ou null se não houver.
3. "email": E-mail se houver, ou null.
4. "origem": "${defaultOrigin || "Instagram Direct"}".
5. "interesse": Resumo conciso do assunto da conversa (ex: "Conversa sobre vídeos", "Interesse em proposta", "Interação informal").
6. "temperatura": "Quente" se pediu preço/zap, "Morno" se demonstrou interesse, "Frio" se foi apenas conversa amigável/meme.
7. "valor_estimado": number ou null.

MESMO QUE NÃO HAJA NÚMERO DE TELEFONE, retorne o contato com o Nome/Perfil identificado.

Responda ESTRITAMENTE com o seguinte JSON:
{
  "leads": [
    {
      "nome": "${fallbackName || "Contato"}",
      "telefone": null,
      "email": null,
      "origem": "${defaultOrigin || "Instagram Direct"}",
      "interesse": "Interação no Direct",
      "temperatura": "Frio",
      "valor_estimado": null
    }
  ]
}

Texto:
"""
${rawText}
"""`;

        const rawContent = await callLlmChatCompletion({
          model: defaultGroqModel(),
          temperature: 0.1,
          max_tokens: 1200,
          messages: [
            {
              role: "system",
              content:
                "Você é um assistente que responde APENAS com um objeto JSON contendo a propriedade 'leads'.",
            },
            {
              role: "user",
              content: prompt,
            },
          ],
        });

        let parsed = {};
        try {
          parsed = JSON.parse(rawContent);
        } catch (parseError) {
          console.warn("[ai-extract] JSON parse fallback:", parseError);
          const match = String(rawContent || "").match(/\{[\s\S]*\}/);
          if (match) {
            try {
              parsed = JSON.parse(match[0]);
            } catch {
              parsed = {};
            }
          }
        }

        const rawLeads = Array.isArray(parsed?.leads) ? parsed.leads : [];
        let leads = rawLeads.map((item) => {
          let cleanPhone = null;
          if (item.telefone) {
            const digits = String(item.telefone).replace(/\D/g, "");
            if (digits.length >= 8) {
              cleanPhone = digits.startsWith("55") ? digits : `55${digits}`;
            }
          }

          return {
            nome: String(item.nome || fallbackName || "Contato Social").trim(),
            telefone: cleanPhone,
            email: item.email ? String(item.email).trim() : null,
            origem: String(item.origem || defaultOrigin || "Instagram Direct").trim(),
            interesse: String(item.interesse || "Interação no Direct").trim(),
            temperatura: ["Quente", "Morno", "Frio"].includes(item.temperatura)
              ? item.temperatura
              : "Morno",
            valor_estimado:
              typeof item.valor_estimado === "number" ? item.valor_estimado : null,
          };
        });

        // Garantia Universal: Nunca deixa a lista de leads vazia se houver texto
        if (leads.length === 0 && rawText.length >= 10) {
          leads.push({
            nome: fallbackName || "Contato Social",
            telefone: null,
            email: null,
            origem: String(defaultOrigin || "Instagram Direct").trim(),
            interesse: "Interação no Direct",
            temperatura: "Frio",
            valor_estimado: null,
          });
        }

        return res.json({
          success: true,
          leads,
        });
      } catch (error) {
        console.error("[ai-extract] Erro ao extrair leads:", error);
        return res.status(500).json({
          success: false,
          error: {
            code: "AI_EXTRACT_FAILED",
            message:
              error instanceof Error ? error.message : "Falha na extração de contatos com IA.",
          },
        });
      }
    }
  );
}
