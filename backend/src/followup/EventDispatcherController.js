import { query, getSupabase } from "./db.js";
import { getFollowupQueue } from "./queue.js";
import { ResendProvider } from "../providers/ResendProvider.js";

/**
 * EventDispatcherController
 * Centraliza o disparo de jornadas baseado em eventos do CRM.
 */
export class EventDispatcherController {
  
  /**
   * Dispara um evento para um lead específico
   * @param {string} companyId ID da empresa
   * @param {string} leadId ID do lead
   * @param {string} eventName Nome do evento (ex: 'no_show', 'appointment_confirmed')
   * @param {object} context Contexto adicional (nome do lead, telefone, etc)
   */
  static async dispatchEvent(companyId, leadId, eventName, context = {}) {
    console.log(`[EventDispatcher] Recebido evento '${eventName}' para lead ${leadId} da empresa ${companyId}`);
    
    try {
      const supabase = getSupabase();
      
      // 1. Verifica se há uma jornada ativa para este evento
      const { data: journey, error: journeyError } = await supabase
        .from("fup_journeys")
        .select("*")
        .eq("company_id", companyId)
        .eq("trigger_event", eventName)
        .eq("is_active", true)
        .maybeSingle();

      if (journeyError) throw journeyError;
      
      if (!journey) {
        console.log(`[EventDispatcher] Nenhuma jornada ativa para '${eventName}' na empresa ${companyId}. Ignorando.`);
        return;
      }

      console.log(`[EventDispatcher] Jornada '${eventName}' ativada! Agendando envio para o canal ${journey.channel}`);

      // 2. Calcula o delay
      let delayMs = 0;
      if (journey.delay_value > 0) {
        const mult = journey.delay_unit === "days" ? 24 * 60 * 60 * 1000 :
                     journey.delay_unit === "hours" ? 60 * 60 * 1000 :
                     60 * 1000;
        delayMs = journey.delay_value * mult;
      }

      // 3. Envia para a fila do BullMQ
      // O worker do BullMQ irá executar a IA e disparar a mensagem no momento certo.
      const jobId = `event-${eventName}-${leadId}-${Date.now()}`;
      
      await getFollowupQueue().add(
        "process-event-journey",
        {
          companyId,
          leadId,
          eventName,
          journeyId: journey.id,
          channel: journey.channel,
          aiPrompt: journey.ai_prompt,
          context
        },
        { delay: delayMs, jobId }
      );

      console.log(`[EventDispatcher] Job agendado com sucesso (Delay: ${delayMs}ms). JobID: ${jobId}`);
      
    } catch (err) {
      console.error(`[EventDispatcher] Falha ao processar evento '${eventName}':`, err);
    }
  }
}
