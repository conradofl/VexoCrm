import express from "express";
import { pgDatabasePool as db } from "../../services/database.js";

const router = express.Router();

// Webhook da ZapSign (Disparado quando o documento muda de status)
router.post("/webhook/zapsign", async (req, res) => {
  try {
    const payload = req.body;
    
    // Na ZapSign real, o payload vem como:
    // { event_type: "doc_signed", doc_token: "mock-doc-1-12345", status: "signed" }
    // No mock, vamos assumir que recebemos doc_token e status.
    
    const providerId = payload.doc_token || payload.document_token;
    const eventType = payload.event_type;
    
    if (!providerId) {
      return res.status(400).send("Faltando identificador do documento");
    }
    
    console.log("[Webhook ZapSign] Recebido evento:", eventType, "para o doc:", providerId);

    if (eventType === "doc_signed" || payload.status === "signed" || payload.status === "assinado") {
      // 1. Atualizar o status do Contrato para assinado
      const { rows } = await db.query(
        `UPDATE gd_contracts 
         SET status = 'assinado', updated_at = NOW() 
         WHERE provider_id = $1
         RETURNING proposal_id, tenant_id`,
        [providerId]
      );
      
      if (rows.length > 0) {
        const { proposal_id, tenant_id } = rows[0];
        
        // 2. Atualizar a Proposta original para fechada (won)
        await db.query(
          `UPDATE gd_proposals 
           SET status = 'fechada', updated_at = NOW() 
           WHERE id = $1 AND tenant_id = $2`,
          [proposal_id, tenant_id]
        );
        console.log(`[Webhook ZapSign] Proposta ${proposal_id} marcada como fechada/won.`);
      }
    }

    // Sempre responder 200 pro provedor de webhook
    res.status(200).send("Webhook recebido com sucesso");
  } catch (error) {
    console.error("[Webhook ZapSign] Erro ao processar webhook:", error);
    res.status(500).send("Erro interno");
  }
});

export function registerContractWebhookRoutes(app) {
  app.use("/api/gd/contracts", router);
}
