import express from "express";
import { requireFirebaseAuth } from "../../access/middlewares.js";
import {
  requireVexoCommercialAccess,
  makeVexoCommercialRowGuard,
} from "../../access/vexoCommercialGate.js";
import { pgDatabasePool } from "../../services/database.js";
import {
  listContractTemplates,
  getContractTemplate,
  createContract,
  listContracts,
  getContract,
  updateContract,
  generateContractPdf,
  uploadSignedContract,
  downloadSignedContract,
} from "./contractHandlers.js";
import { extractContractData } from "./contractExtract.js";
import {
  getJuridicoSettings,
  saveJuridicoSettings,
  listEvolutionInstances,
  sendContractToJuridico,
} from "./juridicoHandlers.js";

export function registerContractRoutes(app) {
  // Contratos do Comercial Vexo moram na mesma tabela dos da Geração Digital,
  // separados só por owner_company. Nas rotas por :id o dono não vem na
  // requisição, vem na linha — daí o row guard.
  // Getter, não o pool: pgDatabasePool só é atribuído no initDatabase, e o
  // registro das rotas acontece antes — passar o valor capturaria null.
  const guardContratoVexo = makeVexoCommercialRowGuard(() => pgDatabasePool, "gd_contracts");

  // Jurídico: configuração (canal do Slack + WhatsApp + instância) e envio.
  app.get("/api/gd/juridico-settings", requireFirebaseAuth, getJuridicoSettings);
  app.put("/api/gd/juridico-settings", requireFirebaseAuth, saveJuridicoSettings);
  app.get("/api/gd/evolution-instances", requireFirebaseAuth, listEvolutionInstances);
  app.post("/api/gd/contracts/:id/enviar-juridico", requireFirebaseAuth, guardContratoVexo, sendContractToJuridico);
  app.get("/api/gd/contract-templates", requireFirebaseAuth, listContractTemplates);
  app.get("/api/gd/contract-templates/:id", requireFirebaseAuth, getContractTemplate);
  
  // Preenchimento assistido por IA: recebe texto colado, devolve campos.
  app.post("/api/gd/contracts/extract", requireFirebaseAuth, extractContractData);

  app.post("/api/gd/contracts", requireFirebaseAuth, requireVexoCommercialAccess, createContract);
  app.get("/api/gd/contracts", requireFirebaseAuth, requireVexoCommercialAccess, listContracts);
  app.get("/api/gd/contracts/:id", requireFirebaseAuth, guardContratoVexo, getContract);
  app.put("/api/gd/contracts/:id", requireFirebaseAuth, requireVexoCommercialAccess, guardContratoVexo, updateContract);
  
  app.get("/api/gd/contracts/:id/pdf", requireFirebaseAuth, guardContratoVexo, generateContractPdf);

  // Contrato assinado externamente (ex: gov.br): upload e download byte a byte com trava de tenant
  app.post(
    "/api/gd/contracts/:id/signed",
    requireFirebaseAuth,
    guardContratoVexo,
    express.raw({ type: ["application/pdf", "application/octet-stream"], limit: "25mb" }),
    uploadSignedContract
  );
  app.get("/api/gd/contracts/:id/signed", requireFirebaseAuth, guardContratoVexo, downloadSignedContract);
}
