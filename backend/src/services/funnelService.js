// backend/src/services/funnelService.js
//
// Motor Comercial do Funil de Vendas (Item 12 & Marco 3):
// - Classificação semântica de mensagens (buyer, open_budget, inquiry, lost com motivo)
// - Trava de inviolabilidade manual (stage_source = 'manual')
// - Alertas proativos ao SDR / Notificações (lead_closed, human_requested)
// - Cancelamento automático de cadências de follow-up (exit_on_won / on reply)
// - Vocabulário customizável por tenant (funnel_vocabulary)
// - Importação de vendas fechadas e clientes históricos

import { upsertLeadByPhone, upsertLeadsBatchByPhone } from "./leadUpsert.js";
import { sanitizePhone } from "./leadImport.js";
import {
  cancelFollowupCadenceOnReply,
  cancelFollowupCadenceOnStageChange,
  isWonStage,
  isLostStage,
} from "./followupExitGuard.js";

export const DEFAULT_FUNNEL_VOCABULARY = {
  cold: { label: "Primeiro Contato", color: "slate" },
  inquiry: { label: "Em Atendimento", color: "blue" },
  open_budget: { label: "Proposta Apresentada", color: "amber" },
  buyer: { label: "Venda Fechada", color: "emerald" },
  lost: { label: "Não Convertido", color: "rose" },
};

export function canonicalizeStageKey(rawKey = "") {
  const k = String(rawKey || "").trim().toLowerCase();
  if (k === "novo" || k === "frio" || k === "cold") return "cold";
  if (k === "em_atendimento" || k === "atendimento" || k === "inquiry" || k === "duvida") return "inquiry";
  if (k === "qualificado" || k === "orcamento" || k === "open_budget" || k === "proposta") return "open_budget";
  if (k === "fechado" || k === "comprador" || k === "buyer" || k === "won") return "buyer";
  if (k === "perdido" || k === "lost" || k === "cancelado") return "lost";
  return "cold";
}

export function formatStageLabel(stageKey, vocabulary = {}) {
  const canonical = canonicalizeStageKey(stageKey);
  if (vocabulary && vocabulary[canonical]?.label) {
    return vocabulary[canonical].label;
  }
  return DEFAULT_FUNNEL_VOCABULARY[canonical]?.label || stageKey;
}

/**
 * Remove acentos e caracteres especiais para comparação fonética/semântica.
 */
function normalizeText(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

/**
 * Classificador semântico puro de mensagens do WhatsApp.
 * Retorna o estágio sugerido, temperatura, motivo de perda (se aplicável) e justificativa.
 */
export function classifyLeadMessages(messages = []) {
  const textList = Array.isArray(messages)
    ? messages.map((m) => (typeof m === "string" ? m : m?.message_text || m?.text || m?.body || ""))
    : [String(messages || "")];

  const fullText = normalizeText(textList.join(" "));

  // 1. Sinais de Fechamento / Comprador (buyer)
  const buyerRegex = /\b(paguei|comprovante|chave pix|pix feito|pix enviado|manda a chave pix|manda o pix|manda o boleto|boleto pago|fechado|fechamos|vamos fechar|contrato assinado|ja transferi|acabei de pagar|vamos fazer|pode emitir|fechar o pedido)\b/i;
  if (buyerRegex.test(fullText)) {
    const match = fullText.match(buyerRegex);
    return {
      stage: "buyer",
      temperature: "hot",
      lost_reason: null,
      intent: "purchase",
      matchedTerm: match ? match[0] : "fechamento",
      reason: `Cliente demonstrou intenção direta de compra ou pagamento ("${match ? match[0] : "fechamento"}").`,
    };
  }

  // 2. Sinais de Perda Explícita (lost) com categorização de motivo
  // 2.1 Preço
  const lostPrecoRegex = /\b(muito caro|fora do orcamento|fora do meu orcamento|preco alto|nao cabe no bolso|achei caro|salgado|nao tenho esse valor)\b/i;
  if (lostPrecoRegex.test(fullText)) {
    const match = fullText.match(lostPrecoRegex);
    return {
      stage: "lost",
      temperature: "cold",
      lost_reason: "preco",
      intent: "lost",
      matchedTerm: match ? match[0] : "preco",
      reason: `Cliente indicou objeção de preço ("${match ? match[0] : "muito caro"}").`,
    };
  }

  // 2.2 Concorrente
  const lostConcorrenteRegex = /\b(ja comprei com outro|fechei com outro|peguei com outro|fechamos com outra empresa|comprei de outro|fechei com concorrente|ja fechei com outro)\b/i;
  if (lostConcorrenteRegex.test(fullText)) {
    const match = fullText.match(lostConcorrenteRegex);
    return {
      stage: "lost",
      temperature: "cold",
      lost_reason: "concorrente",
      intent: "lost",
      matchedTerm: match ? match[0] : "concorrente",
      reason: `Cliente já fechou com concorrente ("${match ? match[0] : "fechei com outro"}").`,
    };
  }

  // 2.3 Desinteresse / Cancelamento
  const lostDesinteresseRegex = /\b(nao tenho interesse|sem interesse|nao quero|cancele|cancelar|pare de mandar mensagem|nao me mande mais|descadastrar|favor parar|remova meu numero|nao me procure mais)\b/i;
  if (lostDesinteresseRegex.test(fullText)) {
    const match = fullText.match(lostDesinteresseRegex);
    return {
      stage: "lost",
      temperature: "cold",
      lost_reason: "desinteresse",
      intent: "lost",
      matchedTerm: match ? match[0] : "desinteresse",
      reason: `Cliente manifestou desinteresse explícito ou pediu cancelamento ("${match ? match[0] : "não tenho interesse"}").`,
    };
  }

  // 2.4 Perfil
  const lostPerfilRegex = /\b(nao e pra mim|nao atende|perfil diferente|nao serve pra mim)\b/i;
  if (lostPerfilRegex.test(fullText)) {
    const match = fullText.match(lostPerfilRegex);
    return {
      stage: "lost",
      temperature: "cold",
      lost_reason: "perfil",
      intent: "lost",
      matchedTerm: match ? match[0] : "perfil",
      reason: `Cliente indicou incompatibilidade de perfil ("${match ? match[0] : "não atende"}").`,
    };
  }

  // 3. Sinais de Orçamento / Negociação (open_budget)
  const budgetRegex = /\b(quanto custa|preco|orcamento|proposta|valor|desconto|tabela|cotacao|enviar valor|quanto fica|qual o valor)\b/i;
  if (budgetRegex.test(fullText)) {
    const match = fullText.match(budgetRegex);
    return {
      stage: "open_budget",
      temperature: "hot",
      lost_reason: null,
      intent: "budget",
      matchedTerm: match ? match[0] : "orçamento",
      reason: `Cliente solicitou orçamento, tabela de valores ou proposta comercial ("${match ? match[0] : "orçamento"}").`,
    };
  }

  // 4. Sinais de Dúvida / Atendimento (inquiry)
  const inquiryRegex = /\b(como funciona|endereco|horario|catalogo|informacoes|informacao|duvida|duvidas|como faz|tem vaga|onde fica|atendem)\b/i;
  if (inquiryRegex.test(fullText)) {
    const match = fullText.match(inquiryRegex);
    return {
      stage: "inquiry",
      temperature: "warm",
      lost_reason: null,
      intent: "inquiry",
      matchedTerm: match ? match[0] : "dúvida",
      reason: `Cliente tirou dúvidas ou solicitou informações gerais ("${match ? match[0] : "como funciona"}").`,
    };
  }

  // 5. Sem sinal claro / Cold
  return {
    stage: "cold",
    temperature: "warm",
    lost_reason: null,
    intent: "none",
    matchedTerm: null,
    reason: "Sem sinais comerciais explícitos nas mensagens recentes.",
  };
}

/**
 * Reclassifica o estágio de um lead a partir de mensagens, com proteção estrita
 * contra sobrescrita manual (stage_source = 'manual'), alertas proativos ao SDR
 * e cancelamento automático de follow-up ao fechar venda.
 */
export async function reclassifyLeadFromMessages({
  pool,
  clientId,
  leadId,
  phone,
  messages = [],
}) {
  if (!pool || !clientId) return { updated: false, reason: "missing_params" };

  const cleanPhone = phone ? sanitizePhone(String(phone)) : null;

  // Busca o lead atual
  let query;
  let params;
  if (leadId) {
    query = `SELECT id, phone, telefone, stage, stage_source, lost_reason, temperature FROM public.leads WHERE client_id = $1 AND id = $2 LIMIT 1`;
    params = [clientId, leadId];
  } else if (cleanPhone) {
    query = `SELECT id, phone, telefone, stage, stage_source, lost_reason, temperature FROM public.leads WHERE client_id = $1 AND (phone = $2 OR telefone = $2) LIMIT 1`;
    params = [clientId, cleanPhone];
  } else {
    return { updated: false, reason: "missing_lead_identifier" };
  }

  const { rows } = await pool.query(query, params);
  if (rows.length === 0) {
    return { updated: false, reason: "lead_not_found" };
  }

  const currentLead = rows[0];
  const targetPhone = currentLead.phone || currentLead.telefone || cleanPhone || phone;

  // Normaliza o texto conjunto das mensagens para verificação semântica
  const textList = Array.isArray(messages)
    ? messages.map((m) => (typeof m === "string" ? m : m?.message_text || m?.text || m?.body || ""))
    : [String(messages || "")];
  const fullText = normalizeText(textList.join(" "));

  // Detecção de solicitação de humano ("atendente", "humano", "me liga", "falar com alguém")
  const humanRegex = /\b(atendente|humano|me liga|me ligue|falar com alguem|falar com alguém|falar com atendente|falar com humano|atendimento humano|suporte humano|pessoa real)\b/i;
  const isHumanRequested = humanRegex.test(fullText);

  if (isHumanRequested) {
    try {
      await pool.query(
        `INSERT INTO public.notifications (client_id, type, title, description, link, read)
         VALUES ($1, $2, $3, $4, $5, false)`,
        [
          clientId,
          "human_requested",
          "🙋‍♂️ Lead Pediu Atendente Humano",
          `O lead ${targetPhone} solicitou suporte humano na conversa.`,
          `/crm/whatsapp?phone=${targetPhone}`,
        ]
      );
    } catch (notifErr) {
      console.warn("[auto-funnel] Erro ao criar notificacao human_requested:", notifErr?.message || notifErr);
    }
  }

  // REGRA DE OURO: Inviolabilidade da ação humana
  if (currentLead.stage_source === "manual") {
    return {
      updated: false,
      reason: "manual_protection",
      currentStage: currentLead.stage,
      stageSource: "manual",
      humanRequested: isHumanRequested,
    };
  }

  // Avalia semântica das mensagens
  const classification = classifyLeadMessages(messages);

  // Se o estágio mudou ou se é lost e o motivo mudou:
  const stageChanged = classification.stage && classification.stage !== currentLead.stage;
  const lostReasonChanged = classification.stage === "lost" && classification.lost_reason !== currentLead.lost_reason;

  if (stageChanged || lostReasonChanged) {
    if (targetPhone) {
      await upsertLeadByPhone(pool, clientId, targetPhone, {
        stage: classification.stage,
        stage_source: "auto",
        lost_reason: classification.stage === "lost" ? classification.lost_reason : null,
        temperature: classification.temperature,
      });
    }

    // Se transitou para buyer:
    if (classification.stage === "buyer") {
      // 1. Notificação proativa ao time de SDR
      try {
        await pool.query(
          `INSERT INTO public.notifications (client_id, type, title, description, link, read)
           VALUES ($1, $2, $3, $4, $5, false)`,
          [
            clientId,
            "lead_closed",
            "🎉 Intenção de Fechamento Detectada",
            `O lead ${targetPhone} confirmou pagamento ou fechamento: "${classification.reason}". Acesse a conversa para concluir.`,
            `/crm/whatsapp?phone=${targetPhone}`,
          ]
        );
      } catch (notifErr) {
        console.warn("[auto-funnel] Erro ao criar notificacao lead_closed:", notifErr?.message || notifErr);
      }

      // 2. Cancela cadências ativas de follow-up
      try {
        await cancelFollowupCadenceOnReply({
          companyId: clientId,
          phone: targetPhone,
          queryFn: pool.query.bind(pool),
        });
        await cancelFollowupCadenceOnStageChange({
          clientId,
          phone: targetPhone,
          newStage: "buyer",
          queryFn: pool.query.bind(pool),
        });
      } catch (cancelErr) {
        console.warn("[auto-funnel] Erro ao cancelar follow-up ao virar buyer:", cancelErr?.message || cancelErr);
      }
    } else if (classification.stage === "lost") {
      // Se virou lost, também cancela follow-ups com exit_on_lost
      try {
        await cancelFollowupCadenceOnStageChange({
          clientId,
          phone: targetPhone,
          newStage: "lost",
          queryFn: pool.query.bind(pool),
        });
      } catch (cancelErr) {}
    }

    return {
      updated: true,
      previousStage: currentLead.stage,
      newStage: classification.stage,
      stageSource: "auto",
      lostReason: classification.lost_reason,
      reason: classification.reason,
      humanRequested: isHumanRequested,
    };
  }

  return {
    updated: false,
    reason: "same_stage",
    currentStage: currentLead.stage,
    stageSource: currentLead.stage_source || "auto",
    humanRequested: isHumanRequested,
  };
}

/**
 * Obtém o vocabulário de etapas configurado para o tenant (com fallback para os padrões Vexo).
 */
export async function getFunnelSettings(pool, clientId) {
  if (!pool || !clientId) return { vocabulary: DEFAULT_FUNNEL_VOCABULARY };

  try {
    // 1. Tenta buscar em leads_clients
    const clientRes = await pool.query(
      `SELECT funnel_config FROM public.leads_clients WHERE id = $1 LIMIT 1`,
      [clientId]
    );
    if (clientRes.rows[0]?.funnel_config?.funnel_vocabulary) {
      return {
        vocabulary: {
          ...DEFAULT_FUNNEL_VOCABULARY,
          ...clientRes.rows[0].funnel_config.funnel_vocabulary,
        },
      };
    }

    // 2. Tenta buscar em tenant_modules se houver tenant mapeado
    const tenantRes = await pool.query(
      `SELECT tm.config 
       FROM public.tenant_modules tm
       JOIN public.tenants t ON t.id = tm.tenant_id
       WHERE t.name ILIKE $1 LIMIT 1`,
      [clientId]
    );
    if (tenantRes.rows[0]?.config?.funnel_vocabulary) {
      return {
        vocabulary: {
          ...DEFAULT_FUNNEL_VOCABULARY,
          ...tenantRes.rows[0].config.funnel_vocabulary,
        },
      };
    }
  } catch (err) {
    console.warn(`[getFunnelSettings] Aviso ao ler configuração do tenant ${clientId}:`, err?.message || err);
  }

  return { vocabulary: DEFAULT_FUNNEL_VOCABULARY };
}

/**
 * Salva a customização de vocabulário de etapas do tenant.
 */
export async function saveFunnelSettings(pool, clientId, vocabulary = {}) {
  if (!pool || !clientId) throw new Error("Parâmetros inválidos");

  const cleanVocab = {};
  for (const key of ["cold", "inquiry", "open_budget", "buyer", "lost"]) {
    if (vocabulary[key]) {
      cleanVocab[key] = {
        label: String(vocabulary[key].label || DEFAULT_FUNNEL_VOCABULARY[key].label).trim(),
        color: String(vocabulary[key].color || DEFAULT_FUNNEL_VOCABULARY[key].color).trim(),
      };
    } else {
      cleanVocab[key] = DEFAULT_FUNNEL_VOCABULARY[key];
    }
  }

  const funnelConfig = { funnel_vocabulary: cleanVocab };

  // 1. Grava em leads_clients (garante coluna com fallback)
  try {
    await pool.query(
      `ALTER TABLE public.leads_clients ADD COLUMN IF NOT EXISTS funnel_config JSONB DEFAULT '{}'::jsonb`
    );
    await pool.query(
      `UPDATE public.leads_clients SET funnel_config = $1, updated_at = NOW() WHERE id = $2`,
      [JSON.stringify(funnelConfig), clientId]
    );
  } catch (err) {
    console.warn(`[saveFunnelSettings] Erro ao gravar em leads_clients:`, err?.message || err);
  }

  // 2. Grava em tenant_modules se houver correspondência em tenants
  try {
    const { rows: tRows } = await pool.query(
      `SELECT id FROM public.tenants WHERE name ILIKE $1 LIMIT 1`,
      [clientId]
    );
    if (tRows.length > 0) {
      const tenantUuid = tRows[0].id;
      const { rows: tmRows } = await pool.query(
        `SELECT config FROM public.tenant_modules WHERE tenant_id = $1`,
        [tenantUuid]
      );
      const existingConfig = tmRows[0]?.config || {};
      const updatedConfig = {
        ...existingConfig,
        funnel_vocabulary: cleanVocab,
      };
      await pool.query(
        `INSERT INTO public.tenant_modules (tenant_id, config)
         VALUES ($1, $2)
         ON CONFLICT (tenant_id) DO UPDATE SET config = $2`,
        [tenantUuid, JSON.stringify(updatedConfig)]
      );
    }
  } catch (tErr) {
    // Ignora se tabela tenants/tenant_modules não se aplicar a este client
  }

  return { vocabulary: cleanVocab };
}

/**
 * Importa clientes históricos e vendas fechadas diretamente no estágio buyer.
 */
export async function importClosedSalesBatch(pool, clientId, rows = []) {
  if (!pool || !clientId) throw new Error("Parâmetros inválidos");
  if (!Array.isArray(rows) || rows.length === 0) return { importedCount: 0, skippedCount: 0 };

  const parsedLeads = [];
  let skippedCount = 0;

  for (const row of rows) {
    const rawPhone = row.telefone || row.phone || row.celular || row.whatsapp || row.numero || "";
    const cleanPhone = sanitizePhone(String(rawPhone));

    if (!cleanPhone) {
      skippedCount++;
      continue;
    }

    const name = String(row.nome || row.name || row.cliente || "Cliente Histórico").trim();
    const valorVenda = Number(row.valor_venda || row.valor || row.valor_total || 0) || null;
    const dataFechamento = row.data_fechamento || row.data || new Date().toISOString().slice(0, 10);
    const produtoComprado = String(row.produto_comprado || row.produto || row.servico || "").trim();

    const rowTags = row.tags || row.tag || [];
    const parsedRowTags = Array.isArray(rowTags)
      ? rowTags.map((t) => String(t).trim())
      : typeof rowTags === "string"
      ? rowTags.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    const defaultTags = ["Venda Fechada", "Cliente Histórico"];
    const combinedTags = Array.from(new Set([...defaultTags, ...parsedRowTags]));

    parsedLeads.push({
      client_id: clientId,
      telefone: cleanPhone,
      phone: cleanPhone,
      nome: name,
      stage: "buyer",
      stage_source: "manual", // Ação manual expressa do operador ao importar vendas fechadas
      temperature: "hot",
      potential_contract_value: valorVenda,
      tags: combinedTags,
      dados: {
        ...(row.dados || {}),
        origem: row.origem || "Importação Vendas Fechadas",
        valor_venda: valorVenda,
        data_fechamento: dataFechamento,
        produto_comprado: produtoComprado || undefined,
        historico_importacao: `Cliente importado como venda fechada em ${new Date().toISOString()}`,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
  }

  if (parsedLeads.length === 0) {
    return { importedCount: 0, skippedCount };
  }

  const batchRes = await upsertLeadsBatchByPhone(
    pool,
    clientId,
    parsedLeads
  );

  const importedCount = batchRes?.totalCount ?? batchRes?.importedCount ?? ((batchRes?.insertedCount || 0) + (batchRes?.updatedCount || 0));

  return {
    importedCount,
    insertedCount: batchRes?.insertedCount || 0,
    updatedCount: batchRes?.updatedCount || 0,
    skippedCount,
    totalRows: rows.length,
  };
}
