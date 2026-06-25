import { EventDispatcherController } from "../../followup/EventDispatcherController.js";
import { createPaymentLinkStub } from "../../payments/paymentLink.js";
import crypto from "crypto";

// Dependência injetável mockada para o cron de testes
export async function runEventsDispatchJobs(routeDeps) {
  const { pgDatabasePool } = routeDeps;

  console.log("[Jobs] Iniciando varredura de eventos para disparo...");

  try {
    // 1. Buscar eventos futuros (ex: 3 dias a partir de hoje - Esteira 1)
    // Para simplificar o teste, vamos pegar eventos com nome "Falso" ou date > agora
    const futureEventsResult = await pgDatabasePool.query(
      "SELECT id, name, date FROM public.events WHERE date > NOW()"
    );

    // Simulando que vamos pegar N leads da base para comunicar sobre os eventos
    const leadsResult = await pgDatabasePool.query(
      "SELECT id, company_id, name, phone, email FROM public.leads_infinie LIMIT 1" // pegamos apenas 1 para o teste
    );
    const mockLead = leadsResult.rows[0];

    for (const event of futureEventsResult.rows) {
      if (!mockLead) continue;
      
      console.log(`[Jobs] Evento futuro encontrado: ${event.name}`);
      
      // Gera o link da sympla stub
      const paymentStub = await createPaymentLinkStub(event.id, {
        firstName: mockLead.name,
        email: mockLead.email
      }, "Ingresso VIP");

      const context = {
        eventName: event.name,
        paymentUrl: paymentStub.data.payment_url,
      };

      // Dispara a Esteira 1: pre_event_3_days
      await EventDispatcherController.dispatchEvent(
        mockLead.company_id,
        mockLead.id,
        "pre_event_3_days",
        context
      );
    }

    // 2. Buscar eventos passados (ex: Esteira 5 pós-evento)
    const pastEventsResult = await pgDatabasePool.query(
      "SELECT id, name, date FROM public.events WHERE date < NOW()"
    );

    for (const event of pastEventsResult.rows) {
      if (!mockLead) continue;

      console.log(`[Jobs] Evento passado encontrado: ${event.name}`);
      
      const couponCode = "CUPOM-" + crypto.randomBytes(4).toString("hex").toUpperCase();
      
      const context = {
        eventName: event.name,
        couponCode: couponCode
      };

      // Dispara a Esteira 5: after_event
      await EventDispatcherController.dispatchEvent(
        mockLead.company_id,
        mockLead.id,
        "after_event",
        context
      );
    }
    
    console.log("[Jobs] Varredura finalizada com sucesso!");
  } catch (error) {
    console.error("[Jobs] Erro na varredura de eventos:", error);
  }
}
