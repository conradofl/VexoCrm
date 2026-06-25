import { runEventsDispatchJobs } from "./src/domains/eventos/jobs.js";
import { EventDispatcherController } from "./src/followup/EventDispatcherController.js";
import * as eventDispatcherModule from "./src/followup/EventDispatcherController.js";

// Mock dependencies
const mockPgDatabasePool = {
  query: async (queryStr) => {
    if (queryStr.includes("WHERE date > NOW()")) {
      return {
        rows: [
          { id: "evt-future-1", name: "LivPub Pré-venda Falso", date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) }
        ]
      };
    }
    if (queryStr.includes("WHERE date < NOW()")) {
      return {
        rows: [
          { id: "evt-past-1", name: "LivPub Pós-evento Falso", date: new Date(Date.now() - 24 * 60 * 60 * 1000) }
        ]
      };
    }
    if (queryStr.includes("leads_infinie LIMIT 1")) {
      return {
        rows: [
          { id: "lead-1", company_id: "comp-1", name: "Conrado", phone: "11999999999", email: "conradofl@gmail.com" }
        ]
      };
    }
    return { rows: [] };
  }
};

async function run() {
  console.log("=== Iniciando Simulação das Esteiras (1, 2, 5) ===\n");

  // Intercept EventDispatcher to simulate the queue and worker output
  EventDispatcherController.dispatchEvent = async (companyId, leadId, eventName, context) => {
    console.log(`[EventDispatcher] Recebido evento '${eventName}' para lead ${leadId} da empresa ${companyId}`);
    console.log(`[EventDispatcher] Jornada '${eventName}' ativada! Agendando envio...`);
    const jobId = `event-${eventName}-${leadId}-${Date.now()}`;
    console.log(`[EventDispatcher] Job agendado com sucesso (Delay: 0ms). JobID: ${jobId}`);
    
    // Simular o WORKER processando instantaneamente
    console.log(`\n[followup/worker] Processando disparo de jornada... JobID: ${jobId}`);
    console.log(`[event-journey][${eventName}][${leadId}] Contexto recebido:`, JSON.stringify(context, null, 2));

    let finalMessage = `Olá Conrado, esta é a mensagem de fallback para a jornada ${eventName}.`;
    
    if (context.paymentUrl) {
      finalMessage += ` Seu link VIP: ${context.paymentUrl}`;
      console.log(`[event-journey][${eventName}][${leadId}] [ESTEIRA 1] Link da Sympla injetado!`);
    }
    if (context.couponCode) {
      finalMessage += ` Seu cupom de desconto é: ${context.couponCode}`;
      console.log(`[event-journey][${eventName}][${leadId}] [ESTEIRA 5] Cupom gerado e injetado!`);
    }

    console.log(`[event-journey][${eventName}][${leadId}] Mensagem Final (mock): "${finalMessage}"`);
    console.log(`[event-journey][${eventName}][${leadId}] WhatsApp disparado com sucesso via Evolution!\n`);
  };

  const routeDeps = { pgDatabasePool: mockPgDatabasePool };

  await runEventsDispatchJobs(routeDeps);
}

run().catch(console.error);
