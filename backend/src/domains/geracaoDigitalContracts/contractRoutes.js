import { requireFirebaseAuth } from "../../access/middlewares.js";
import {
  listContractTemplates,
  getContractTemplate,
  createContract,
  listContracts,
  getContract,
  updateContract,
  generateContractPdf,
} from "./contractHandlers.js";
import { extractContractData } from "./contractExtract.js";
import {
  getJuridicoSettings,
  saveJuridicoSettings,
  listEvolutionInstances,
  sendContractToJuridico,
} from "./juridicoHandlers.js";

export function registerContractRoutes(app) {
  // Jurídico: configuração (canal do Slack + WhatsApp + instância) e envio.
  app.get("/api/gd/juridico-settings", requireFirebaseAuth, getJuridicoSettings);
  app.put("/api/gd/juridico-settings", requireFirebaseAuth, saveJuridicoSettings);
  app.get("/api/gd/evolution-instances", requireFirebaseAuth, listEvolutionInstances);
  app.post("/api/gd/contracts/:id/enviar-juridico", requireFirebaseAuth, sendContractToJuridico);
  app.get("/api/gd/contract-templates", requireFirebaseAuth, listContractTemplates);
  app.get("/api/gd/contract-templates/:id", requireFirebaseAuth, getContractTemplate);
  
  // Preenchimento assistido por IA: recebe texto colado, devolve campos.
  app.post("/api/gd/contracts/extract", requireFirebaseAuth, extractContractData);

  app.post("/api/gd/contracts", requireFirebaseAuth, createContract);
  app.get("/api/gd/contracts", requireFirebaseAuth, listContracts);
  app.get("/api/gd/contracts/:id", requireFirebaseAuth, getContract);
  app.put("/api/gd/contracts/:id", requireFirebaseAuth, updateContract);
  
  app.get("/api/gd/contracts/:id/pdf", requireFirebaseAuth, generateContractPdf);
}
