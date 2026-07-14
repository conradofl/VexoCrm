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

export function registerContractRoutes(app) {
  app.get("/api/gd/contract-templates", requireFirebaseAuth, listContractTemplates);
  app.get("/api/gd/contract-templates/:id", requireFirebaseAuth, getContractTemplate);
  
  app.post("/api/gd/contracts", requireFirebaseAuth, createContract);
  app.get("/api/gd/contracts", requireFirebaseAuth, listContracts);
  app.get("/api/gd/contracts/:id", requireFirebaseAuth, getContract);
  app.put("/api/gd/contracts/:id", requireFirebaseAuth, updateContract);
  
  app.get("/api/gd/contracts/:id/pdf", requireFirebaseAuth, generateContractPdf);
}
