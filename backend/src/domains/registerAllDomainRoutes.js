import { routeDeps } from "../http/routeDeps.js";
import { registerFollowupRoutes } from "../followup/routes.js";
import { registerJourneysRoutes } from "../followup/journeysRoutes.js";
import { registerFollowupQueueRoutes } from "../followup/queueRoutes.js";
import { registerGeracaoDigitalRoutes } from "./geracaoDigitalRoutes.js";
import { registerContractRoutes } from "./geracaoDigitalContracts/contractRoutes.js";
import { registerContractWebhookRoutes } from "./geracaoDigitalContracts/webhookRoutes.js";
import { registerOnboardingRoutes } from "../onboarding/routes.js";
import { registerEventosRoutes } from "./eventos/routes.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { registerVexoSalesRoutes } from "./vexoSales/routes.js";
import { registerLeadsRoutes } from "./leads/routes.js";
import { registerInsightsRoutes } from "./insights/routes.js";
import { registerIntegrationsRoutes } from "./integrations/routes.js";
import { registerChatbotRoutes } from "./chatbot/routes.js";
import { registerCampaignsRoutes } from "./campaigns/routes.js";

/**
 * Registers all HTTP routes (extracted from legacy server.js).
 * routeDeps must be populated in server.js before this runs.
 *
 * Cada domínio é registrado por seu próprio módulo (src/domains/<dominio>/routes.js
 * ou src/followup/*.js) e recebe routeDeps inteiro — cada módulo destructura só o
 * que usa. A ordem relativa de registro abaixo preserva a ordem original do
 * monólito; as delegações externas (followup, journeys, geração digital,
 * onboarding) e o mount de /api/eventos ficam por último, como sempre.
 */
export function registerAllDomainRoutes(app) {
  const {
    pgDatabasePool,
    requireAdminAccess,
    requireFirebaseAuth,
    requireInternalAccess,
    requireInternalPageAccess,
  } = routeDeps;

  registerInsightsRoutes(app, routeDeps);
  registerLeadsRoutes(app, routeDeps);
  registerIntegrationsRoutes(app, routeDeps);
  registerAuthRoutes(app, routeDeps);
  registerVexoSalesRoutes(app, routeDeps);
  registerChatbotRoutes(app, routeDeps);
  registerCampaignsRoutes(app, routeDeps);

  // ─── Fila de Follow-up (painel de moderação /api/followup-queue) ───
  registerFollowupQueueRoutes(app, routeDeps);

  // ─── Módulo de Follow-up (BullMQ + campanhas independentes) ───────────────
  registerFollowupRoutes(app, requireFirebaseAuth, requireInternalPageAccess, requireAdminAccess);
  registerJourneysRoutes(app, requireFirebaseAuth, requireInternalPageAccess, requireAdminAccess);
  registerGeracaoDigitalRoutes(app, pgDatabasePool, requireFirebaseAuth, requireInternalPageAccess);
  registerContractRoutes(app);
  registerContractWebhookRoutes(app);

  // ─── Módulo de Onboarding (criação transacional de empresa + campanha + templates) ───
  registerOnboardingRoutes(app, requireFirebaseAuth, requireInternalAccess);

  // ─── Módulo de Eventos ───
  app.use("/api/eventos", registerEventosRoutes(routeDeps));
}
