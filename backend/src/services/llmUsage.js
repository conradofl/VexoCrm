// Custo de IA por cliente: uma linha em public.llm_usage por chamada de LLM que
// deu certo. Tabela e regras na migration 20261030120000_create_llm_usage.sql.
//
// So fato do evento (provedor, modelo, tokens). Nada de custo em reais e nada
// de texto de prompt ou resposta.

import { pgDatabasePool } from "./database.js";

/**
 * Rotulos fixos de quem chamou a IA. Curtos e estaveis: e por eles que o
 * relatorio agrupa o custo.
 *   chatbot    conversa do agente com o lead (runChatbotAI)
 *   simulador  a mesma conversa, disparada pela tela de teste do agente
 *   campanha   geracao de texto/variacoes/sequencia de campanha (campaign-ai.js)
 *   insight    resumo/insight de conversa do lead (chatInsight.js)
 *   extracao   extracao de campos do lead (aiExtractRoutes.js, leadAiFieldExtractor.js)
 *   magic      criador magico de campanha (magicCampaignCreator.js)
 */
export const LLM_USAGE_ORIGENS = Object.freeze(["chatbot", "simulador", "campanha", "insight", "extracao", "magic"]);

const SQL_INSERT = `INSERT INTO public.llm_usage
  (client_id, origem, phone, provider, model, prompt_tokens, completion_tokens, total_tokens, finish_reason, latency_ms, tentativas)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;

function inteiroOuNulo(valor) {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * Grava uma chamada. Sem pool (dev/teste sem banco), nao faz nada. Quem chama
 * NAO espera: ver registrarUsoLlm no motor, que isola qualquer falha daqui.
 */
export async function gravarUsoLlm(uso, { pool = pgDatabasePool } = {}) {
  if (!pool) return;
  await pool.query(SQL_INSERT, [
    uso.clientId || null,
    uso.origem || null,
    uso.phone || null,
    uso.provider,
    uso.model,
    inteiroOuNulo(uso.promptTokens),
    inteiroOuNulo(uso.completionTokens),
    inteiroOuNulo(uso.totalTokens),
    uso.finishReason || null,
    inteiroOuNulo(uso.latencyMs),
    inteiroOuNulo(uso.tentativas),
  ]);
}
