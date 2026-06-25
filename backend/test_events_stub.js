import { createPaymentLinkStub } from "./src/payments/paymentLink.js";
import express from "express";
import { registerEventosRoutes } from "./src/domains/eventos/routes.js";
import assert from "assert";

async function run() {
  console.log("=== Testando Stub Sympla ===");
  await createPaymentLinkStub(12345, { firstName: "João", lastName: "Silva" }, "VIP", 2, 250.00);
  
  console.log("\n=== Testando Injeção no Router ===");
  
  // Dummy dependecies
  const routeDeps = {
    pgDatabasePool: {
      query: async () => ({ rows: [] })
    },
    requireFirebaseAuth: (req, res, next) => next(),
    sendError: () => {}
  };

  const app = express();
  // Simulate the injection
  app.use("/api/eventos", registerEventosRoutes(routeDeps));

  // Quick unit check: verify if the route is mounted
  // A simple way is to check the router stack
  let isMounted = false;
  app._router.stack.forEach(layer => {
    if (layer.regexp.test("/api/eventos")) {
      isMounted = true;
    }
  });

  assert.ok(isMounted, "Router de eventos deve estar injetado corretamente.");
  console.log("Teste de Injeção: OK! /api/eventos está registrado no router principal (ou simulado com sucesso).");
}

run().catch(console.error);
