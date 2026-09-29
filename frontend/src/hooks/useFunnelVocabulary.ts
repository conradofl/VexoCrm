// frontend/src/hooks/useFunnelVocabulary.ts
//
// Hook para gestão e mapeamento de vocabulário do funil comercial customizável por tenant (Bloco 3).

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";

export type FunnelStageKey = "cold" | "inquiry" | "open_budget" | "buyer" | "lost";

export interface StageVocabularyConfig {
  label: string;
  color?: string;
}

export type FunnelVocabulary = Record<FunnelStageKey, StageVocabularyConfig>;

export const DEFAULT_FUNNEL_VOCABULARY: FunnelVocabulary = {
  cold: { label: "Primeiro Contato", color: "slate" },
  inquiry: { label: "Em Atendimento", color: "blue" },
  open_budget: { label: "Proposta Apresentada", color: "amber" },
  buyer: { label: "Venda Fechada", color: "emerald" },
  lost: { label: "Não Convertido", color: "rose" },
};

/**
 * Normaliza chaves e apelidos legados para as chaves canônicas do banco (cold, inquiry, open_budget, buyer, lost).
 */
export interface StageSuggestion {
  suggestedStage: FunnelStageKey;
  reason: string;
  matchedTerm: string;
  lostReason?: string | null;
}

function normalizeText(text = ""): string {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Classificador semântico puro de mensagens do WhatsApp (isomórfico ao backend).
 */
export function classifyLeadMessages(messages: (string | any)[] = []) {
  const textList = Array.isArray(messages)
    ? messages.map((m) => (typeof m === "string" ? m : m?.message_text || m?.text || m?.body || ""))
    : [String(messages || "")];

  const fullText = normalizeText(textList.join(" "));

  // 1. Sinais de Fechamento / Comprador (buyer)
  const buyerRegex = /\b(paguei|comprovante|chave pix|pix feito|pix enviado|manda a chave pix|manda o pix|manda o boleto|boleto pago|fechado|fechamos|vamos fechar|contrato assinado|ja transferi|acabei de pagar|vamos fazer|pode emitir|fechar o pedido)\b/i;
  if (buyerRegex.test(fullText)) {
    const match = fullText.match(buyerRegex);
    return {
      stage: "buyer" as FunnelStageKey,
      temperature: "hot",
      lost_reason: null,
      intent: "purchase",
      matchedTerm: match ? match[0] : "fechamento",
      reason: `Cliente demonstrou intenção de compra ou confirmação de pagamento ("${match ? match[0] : "fechamento"}").`,
    };
  }

  // 2. Sinais de Perda Explícita (lost)
  const lostPrecoRegex = /\b(muito caro|fora do orcamento|fora do meu orcamento|preco alto|nao cabe no bolso|achei caro|salgado|nao tenho esse valor)\b/i;
  if (lostPrecoRegex.test(fullText)) {
    const match = fullText.match(lostPrecoRegex);
    return {
      stage: "lost" as FunnelStageKey,
      temperature: "cold",
      lost_reason: "preco",
      intent: "lost",
      matchedTerm: match ? match[0] : "preço",
      reason: `Cliente indicou objeção de preço ("${match ? match[0] : "muito caro"}").`,
    };
  }

  const lostConcorrenteRegex = /\b(ja comprei com outro|fechei com outro|peguei com outro|fechamos com outra empresa|comprei de outro|fechei com concorrente|ja fechei com outro)\b/i;
  if (lostConcorrenteRegex.test(fullText)) {
    const match = fullText.match(lostConcorrenteRegex);
    return {
      stage: "lost" as FunnelStageKey,
      temperature: "cold",
      lost_reason: "concorrente",
      intent: "lost",
      matchedTerm: match ? match[0] : "concorrente",
      reason: `Cliente já fechou com concorrente ("${match ? match[0] : "fechei com outro"}").`,
    };
  }

  const lostDesinteresseRegex = /\b(nao tenho interesse|sem interesse|nao quero|cancele|cancelar|pare de mandar mensagem|nao me mande mais|descadastrar|favor parar|remova meu numero|nao me procure mais)\b/i;
  if (lostDesinteresseRegex.test(fullText)) {
    const match = fullText.match(lostDesinteresseRegex);
    return {
      stage: "lost" as FunnelStageKey,
      temperature: "cold",
      lost_reason: "desinteresse",
      intent: "lost",
      matchedTerm: match ? match[0] : "desinteresse",
      reason: `Cliente manifestou desinteresse explícito ou pediu cancelamento ("${match ? match[0] : "não tenho interesse"}").`,
    };
  }

  // 3. Sinais de Orçamento / Negociação (open_budget)
  const budgetRegex = /\b(quanto custa|preco|orcamento|proposta|valor|desconto|tabela|cotacao|enviar valor|quanto fica|qual o valor)\b/i;
  if (budgetRegex.test(fullText)) {
    const match = fullText.match(budgetRegex);
    return {
      stage: "open_budget" as FunnelStageKey,
      temperature: "hot",
      lost_reason: null,
      intent: "budget",
      matchedTerm: match ? match[0] : "orçamento",
      reason: `Cliente solicitou orçamento, proposta ou tabela de valores ("${match ? match[0] : "orçamento"}").`,
    };
  }

  // 4. Sinais de Dúvida / Atendimento (inquiry)
  const inquiryRegex = /\b(como funciona|endereco|horario|catalogo|informacoes|informacao|duvida|duvidas|como faz|tem vaga|onde fica|atendem)\b/i;
  if (inquiryRegex.test(fullText)) {
    const match = fullText.match(inquiryRegex);
    return {
      stage: "inquiry" as FunnelStageKey,
      temperature: "warm",
      lost_reason: null,
      intent: "inquiry",
      matchedTerm: match ? match[0] : "dúvida",
      reason: `Cliente tirou dúvidas ou solicitou informações gerais ("${match ? match[0] : "como funciona"}").`,
    };
  }

  return {
    stage: "cold" as FunnelStageKey,
    temperature: "warm",
    lost_reason: null,
    intent: "none",
    matchedTerm: "",
    reason: "Sem sinais comerciais explícitos nas mensagens recentes.",
  };
}

/**
 * Detecta se há uma sugestão inteligente de evolução de estágio para a conversa.
 */
export function detectStageSuggestion(messages: (string | any)[] = [], currentStage?: string): StageSuggestion | null {
  if (!messages || messages.length === 0) return null;
  const classification = classifyLeadMessages(messages);
  const canonicalCurrent = canonicalizeStageKey(currentStage || "cold");

  // Só sugere se for uma evolução real e não o estágio já ativo
  if (classification.stage !== "cold" && classification.stage !== canonicalCurrent) {
    return {
      suggestedStage: classification.stage,
      reason: classification.reason,
      matchedTerm: classification.matchedTerm,
      lostReason: classification.lost_reason,
    };
  }

  return null;
}

export function canonicalizeStageKey(rawKey: string): FunnelStageKey {
  const k = String(rawKey || "").trim().toLowerCase();
  if (k === "novo" || k === "frio" || k === "cold") return "cold";
  if (k === "em_atendimento" || k === "atendimento" || k === "inquiry" || k === "duvida") return "inquiry";
  if (k === "qualificado" || k === "orcamento" || k === "open_budget" || k === "proposta") return "open_budget";
  if (k === "fechado" || k === "comprador" || k === "buyer" || k === "won") return "buyer";
  if (k === "perdido" || k === "lost" || k === "cancelado") return "lost";
  return "cold";
}

/**
 * Retorna o rótulo de um estágio a partir de um vocabulário fornecido com fallback robusto.
 */
export function formatStageLabel(stageKey: string, vocabulary?: Partial<FunnelVocabulary>): string {
  const canonical = canonicalizeStageKey(stageKey);
  if (vocabulary && vocabulary[canonical]?.label) {
    return vocabulary[canonical].label;
  }
  return DEFAULT_FUNNEL_VOCABULARY[canonical]?.label || stageKey;
}

/**
 * Retorna a cor/estilo de destaque para o estágio.
 */
export function formatStageColor(stageKey: string, vocabulary?: Partial<FunnelVocabulary>): string {
  const canonical = canonicalizeStageKey(stageKey);
  if (vocabulary && vocabulary[canonical]?.color) {
    return vocabulary[canonical].color || "slate";
  }
  return DEFAULT_FUNNEL_VOCABULARY[canonical]?.color || "slate";
}

export function useFunnelVocabulary(clientIdOverride?: string) {
  const crmContext = useOptionalCrmClient();
  const clientId = clientIdOverride || crmContext?.selectedClientId;

  const queryClient = useQueryClient();
  const queryKey = ["funnel-settings", clientId];

  const query = useQuery<FunnelVocabulary>({
    queryKey,
    queryFn: async () => {
      if (!clientId) return DEFAULT_FUNNEL_VOCABULARY;
      const res = await fetchApi(`/api/leads/funnel-settings?clientId=${encodeURIComponent(clientId)}`);
      if (!res.ok) {
        return DEFAULT_FUNNEL_VOCABULARY;
      }
      const data = await readApiJson<{ success: boolean; vocabulary: FunnelVocabulary }>(res, "obter vocabulário do funil");
      return {
        ...DEFAULT_FUNNEL_VOCABULARY,
        ...(data?.vocabulary || {}),
      };
    },
    staleTime: 1000 * 60 * 5, // 5 min
    enabled: Boolean(clientId),
  });

  const vocabulary = query.data || DEFAULT_FUNNEL_VOCABULARY;

  const updateMutation = useMutation({
    mutationFn: async (newVocabulary: Partial<FunnelVocabulary>) => {
      if (!clientId) throw new Error("Cliente não selecionado");
      const res = await fetchApi("/api/leads/funnel-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId,
          vocabulary: newVocabulary,
        }),
      });
      if (!res.ok) {
        const err = await readApiErrorMessage(res, "Falha ao salvar vocabulário do funil.");
        throw new Error(err);
      }
      const data = await readApiJson<{ success: boolean; vocabulary: FunnelVocabulary }>(res, "salvar vocabulário do funil");
      return data.vocabulary;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKey, updated);
      queryClient.invalidateQueries({ queryKey });
    },
  });

  return {
    vocabulary,
    isLoading: query.isLoading,
    getStageLabel: (stageKey: string) => formatStageLabel(stageKey, vocabulary),
    getStageColor: (stageKey: string) => formatStageColor(stageKey, vocabulary),
    stages: (["cold", "inquiry", "open_budget", "buyer", "lost"] as FunnelStageKey[]).map((key) => ({
      key,
      label: formatStageLabel(key, vocabulary),
      color: formatStageColor(key, vocabulary),
    })),
    updateVocabulary: updateMutation.mutate,
    updateVocabularyAsync: updateMutation.mutateAsync,
    isUpdating: updateMutation.isPending,
  };
}
