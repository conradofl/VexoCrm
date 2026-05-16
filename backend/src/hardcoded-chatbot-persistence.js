/**
 * Persistência de Chatbot - Salva progresso incremental no Supabase
 */

/**
 * Salva ou atualiza progresso da conversa em tempo real
 * Usa leads_outlier para armazenar dados coletados incrementalmente
 */
import {
  buildLeadsOutlierDataColumns,
  normalizeLeadsOutlierDados,
} from "./leads-outlier-schema.js";

function leadsTable(clientId) {
  const safe = String(clientId || "").toLowerCase().replace(/-/g, "_").replace(/[^a-z0-9_]/g, "");
  return `leads_${safe || "outlier"}`;
}

export async function persistChatbotProgress({
  supabase,
  clientId,
  phone,
  telefone,
  currentStepId,
  collectedData,
  conversationStatus, // "em_atendimento" | "aguardando_usuario" | "finalizado"
  spinFase, // "situacao" | "problema" | "implicacao" | "necessidade"
  qualificationStatus, // "QUENTE" | "MORNO" | "FRIO"
  mensagem, // Última mensagem do bot
  isFinalized = false,
}) {
  const normalizedPhone = phone || telefone;

  if (!supabase || !clientId || !normalizedPhone) {
    console.error("[chatbot-persistence] Missing required parameters");
    return { error: "Missing parameters" };
  }

  const table = leadsTable(clientId);

  try {
    // Buscar lead existente ou criar novo
    const { data: existingLeadArray, error: fetchError } = await supabase
      .from(table)
      .select("id")
      .eq("client_id", clientId)
      .eq("telefone", normalizedPhone)
      .order("created_at", { ascending: false })
      .limit(1);

    const existingLead = existingLeadArray?.[0] || null;

    let leadRecord;
    const normalizedDados = normalizeLeadsOutlierDados({ dados: collectedData });
    const dataColumns = buildLeadsOutlierDataColumns({ dados: normalizedDados });

    if (existingLead) {
      // Atualizar registro existente
      const updatePayload = {
        status_conversa: conversationStatus,
        spin_fase: spinFase,
        status: qualificationStatus,
        mensagem,
        finalizado: isFinalized,
        dados: normalizedDados,
        ...dataColumns,
      };

      const { data: updated, error: updateError } = await supabase
        .from(table)
        .update(updatePayload)
        .eq("id", existingLead.id)
        .select()
        .single();

      if (updateError) throw updateError;
      leadRecord = updated || { id: existingLead.id };
    } else {
      // Criar novo registro
      const insertPayload = {
        client_id: clientId,
        telefone: normalizedPhone,
        status_conversa: conversationStatus,
        spin_fase: spinFase,
        status: qualificationStatus,
        mensagem,
        finalizado: isFinalized,
        dados: normalizedDados,
        ...dataColumns,
      };

      const { data: inserted, error: insertError } = await supabase
        .from(table)
        .insert([insertPayload])
        .select()
        .single();

      if (insertError) throw insertError;
      leadRecord = inserted;
    }

    const leadId = leadRecord?.id || existingLead?.id || null;

    console.info("[chatbot-persistence] Progress saved", {
      leadId,
      clientId,
      phone: normalizedPhone.slice(-4),
      status: conversationStatus,
      dataPoints: Object.keys(normalizedDados || {}).filter((key) => normalizedDados[key] != null).length,
      isFinalized,
    });

    return { success: true, leadId };
  } catch (err) {
    console.error("[chatbot-persistence] Failed to save progress:", err);
    return { error: err.message };
  }
}

/**
 * Determina a fase SPIN baseado no stepId
 */
export function determineSPINPhase(stepId) {
  if (!stepId) return null;

  if (stepId.startsWith("situation_")) return "situacao";
  if (stepId.startsWith("problem_")) return "problema";
  if (stepId.startsWith("implication_")) return "implicacao";
  if (stepId.startsWith("necessity_")) return "necessidade";

  return null;
}

/**
 * Qualifica o lead baseado nos dados coletados
 */
export function qualifyLead(collectedData) {
  if (!collectedData || Object.keys(collectedData).length === 0) {
    return "FRIO";
  }

  const dataPoints = Object.keys(collectedData).length;
  const credit = String(
    collectedData?.credito ?? collectedData?.credito_faixa ?? collectedData?.crédito ?? ""
  ).toLowerCase();
  const interest = collectedData.interesse?.toLowerCase();

  // QUENTE: Interesse explícito + bom crédito + maioria dos dados
  if (
    interest?.includes("sim") &&
    (credit?.includes("excelente") || credit?.includes("bom")) &&
    dataPoints >= 6
  ) {
    return "QUENTE";
  }

  // MORNO: Algum interesse + dados parciais
  if (dataPoints >= 4) {
    return "MORNO";
  }

  // FRIO: Poucos dados ou falta interesse
  return "FRIO";
}

/**
 * Gera resumo de conversa para análise
 */
export function generateConversationSummary(memory, metrics) {
  const totalSteps = 9; // Total de passos em OUTLIER_STEPS
  const completionPercentage = Math.round(
    (Object.keys(memory.collectedData).length / totalSteps) * 100
  );

  return {
    phone: memory.phone,
    startedAt: memory.startedAt,
    finishedAt: memory.finishedAt,
    durationSeconds: metrics.durationSeconds,
    completionPercentage,
    stepsCompleted: Object.keys(memory.collectedData).length,
    totalSteps,
    status: memory.status,
    collectedFields: Object.keys(memory.collectedData),
    qualification: qualifyLead(memory.collectedData),
    lastStep: memory.currentStepId,
  };
}

/**
 * Rastreia tentativas de resposta inválida
 */
export async function trackInvalidResponse({
  supabase,
  clientId,
  phone,
  stepId,
  response,
  errorMessage,
}) {
  if (!supabase) return;

  try {
    // Salvar tentativa inválida para análise posterior
    const { error } = await supabase.from("lead_import_items").insert([
      {
        client_id: clientId,
        telefone: phone,
        row_number: 0,
        raw_data: {
          event: "invalid_response",
          stepId,
          response,
          errorMessage,
          timestamp: new Date().toISOString(),
        },
      },
    ]);

    if (error) console.warn("[chatbot-persistence] Failed to track invalid response:", error);
  } catch (err) {
    console.error("[chatbot-persistence] Error tracking invalid response:", err);
  }
}
