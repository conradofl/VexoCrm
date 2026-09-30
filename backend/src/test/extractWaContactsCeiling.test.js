// backend/src/test/extractWaContactsCeiling.test.js
//
// Trava de teto de plano no servidor para extração de contatos do WhatsApp.
// O backend resolve o limite pelo plano do tenant; o corpo da requisição
// só pode reduzir, nunca aumentar. Válido para todas as origens (conversas,
// agenda, grupos) e qualquer combinação entre elas.

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import {
  registerLeadsRoutes,
  resolveServerExtractionLimit,
} from "../domains/leads/routes.js";

describe("Trava de teto de plano no servidor (resolveServerExtractionLimit)", () => {
  it("corpo pedindo 'all' num tenant sem plano avançado recebe o teto do plano (500), não o ilimitado", () => {
    expect(resolveServerExtractionLimit({ planTier: "essencial", requestedLimit: "all" })).toBe(500);
    expect(resolveServerExtractionLimit({ planTier: "essencial", requestedLimit: "unlimited" })).toBe(500);
    expect(resolveServerExtractionLimit({ planTier: "essencial", requestedLimit: 0 })).toBe(500);
    expect(resolveServerExtractionLimit({ planTier: "modular", modulosAvulsos: [], requestedLimit: "all" })).toBe(500);
    expect(resolveServerExtractionLimit({ planTier: undefined, requestedLimit: "all" })).toBe(500);
  });

  it("corpo pedindo valor menor que o teto é respeitado — reduzir pode", () => {
    expect(resolveServerExtractionLimit({ planTier: "essencial", requestedLimit: 100 })).toBe(100);
    expect(resolveServerExtractionLimit({ planTier: "essencial", requestedLimit: "50" })).toBe(50);
    expect(resolveServerExtractionLimit({ planTier: "essencial", requestedLimit: 250 })).toBe(250);
    expect(resolveServerExtractionLimit({ planTier: "avancado", requestedLimit: 100 })).toBe(100);
  });

  it("corpo pedindo valor maior que o teto em tenant sem plano avançado é travado no teto (500)", () => {
    expect(resolveServerExtractionLimit({ planTier: "essencial", requestedLimit: 600 })).toBe(500);
    expect(resolveServerExtractionLimit({ planTier: "essencial", requestedLimit: 5000 })).toBe(500);
  });

  it("tenant com plano avançado continua com ilimitado", () => {
    expect(resolveServerExtractionLimit({ planTier: "avancado", requestedLimit: "all" })).toBe(Infinity);
    expect(resolveServerExtractionLimit({ planTier: "avancado", requestedLimit: "unlimited" })).toBe(Infinity);
    expect(resolveServerExtractionLimit({ planTier: "avancado", requestedLimit: 0 })).toBe(Infinity);
    expect(resolveServerExtractionLimit({ planTier: "pro", requestedLimit: "all" })).toBe(Infinity);
    // Modular com o módulo avulso contratado
    expect(
      resolveServerExtractionLimit({
        planTier: "modular",
        modulosAvulsos: ["extracao_ilimitada"],
        requestedLimit: "all",
      })
    ).toBe(Infinity);
  });
});

describe("POST /api/leads/extract-wa-contacts — Teto no Servidor para Todas as Origens", () => {
  let server;
  let baseUrl;
  let mockDb;
  let originalFetch;
  let currentTenantPlan = "essencial";
  let currentTenantModulos = [];

  // Gera 600 itens para testar o teto de 500
  const MANY_CHATS = Array.from({ length: 600 }, (_, i) => {
    const phone = `551191000${String(i).padStart(4, "0")}`;
    return {
      remoteJid: `${phone}@s.whatsapp.net`,
      pushName: `Lead Chat ${i}`,
      lastMessage: {
        key: {
          remoteJidAlt: `${phone}@s.whatsapp.net`,
          fromMe: false,
        },
      },
    };
  });

  const MANY_CONTACTS = Array.from({ length: 600 }, (_, i) => {
    const phone = `551192000${String(i).padStart(4, "0")}`;
    return {
      remoteJid: `${phone}@s.whatsapp.net`,
      pushName: `Contato Agenda ${i}`,
    };
  });

  const MANY_GROUP_PARTICIPANTS = Array.from({ length: 600 }, (_, i) => {
    const phone = `551193000${String(i).padStart(4, "0")}`;
    return {
      phoneNumber: `${phone}@s.whatsapp.net`,
      pushName: `Membro Grupo ${i}`,
    };
  });

  beforeAll(async () => {
    originalFetch = globalThis.fetch;

    const app = express();
    app.use(express.json());

    mockDb = {
      leads: [],
      query: vi.fn(async (sql, params = []) => {
        const text = sql.trim();

        if (text.includes("FROM public.lead_client_n8n_settings")) {
          return {
            rows: [
              {
                plan_tier: currentTenantPlan,
                modulos_avulsos: currentTenantModulos,
              },
            ],
          };
        }

        if (text.includes("FROM public.lead_client_evolution_instances")) {
          return {
            rows: [
              {
                id: "inst-1",
                client_id: "test-tenant",
                name: "GD Instancia",
                dispatch_webhook_url: "https://evo.vexo.com/instance/GD_Instancia",
                owner_uid: "uid-dono",
                active: true,
                is_default: true,
              },
            ],
          };
        }

        if (text.includes("FROM public.leads") && text.includes("SELECT")) {
          return { rows: [] };
        }

        if (text.startsWith("INSERT INTO public.leads")) {
          const colsMatch = text.match(/\(([^)]+)\)/);
          const colNames = colsMatch ? colsMatch[1].split(",").map((c) => c.trim().replace(/"/g, "")) : [];
          if (colNames.length > 0) {
            const COLS_COUNT = colNames.length;
            const inserted = [];
            for (let i = 0; i < params.length; i += COLS_COUNT) {
              const row = { id: `lead-${mockDb.leads.length + 1}` };
              colNames.forEach((col, idx) => {
                row[col] = params[i + idx];
              });
              mockDb.leads.push(row);
              inserted.push(row);
            }
            return { rows: inserted };
          }
        }

        if (text.includes("FROM public.lead_messages")) {
          return { rows: [] };
        }

        return { rows: [], rowCount: 0 };
      }),
    };

    globalThis.fetch = vi.fn(async (url, opts) => {
      const urlStr = String(url);

      if (urlStr.includes("localhost") || urlStr.includes("127.0.0.1")) {
        return originalFetch(url, opts);
      }

      if (urlStr.includes("/instance/fetchInstances")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ name: "GD Instancia", owner: "5511999990000@s.whatsapp.net" }],
        };
      }

      if (urlStr.includes("/chat/findChats/")) {
        return { ok: true, status: 200, json: async () => MANY_CHATS };
      }

      if (urlStr.includes("/chat/findContacts/")) {
        return { ok: true, status: 200, json: async () => MANY_CONTACTS };
      }

      if (urlStr.includes("/group/fetchAllGroups/")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            {
              id: "120363000999@g.us",
              subject: "Grupo Grande",
              participants: MANY_GROUP_PARTICIPANTS,
            },
          ],
        };
      }

      if (urlStr.includes("/chat/findMessages/")) {
        return { ok: true, status: 200, json: async () => [] };
      }

      return { ok: false, status: 404, text: async () => "Not Found" };
    });

    const deps = {
      ensureDb: () => true,
      pgDatabasePool: mockDb,
      requireFirebaseAuth: (_req, _res, next) => {
        _req.user = { client_id: "test-tenant", role: "admin" };
        _req.authAccess = { isAdmin: true, role: "internal", clientId: "test-tenant" };
        next();
      },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      resolveAuthorizedClientId: (_req, _res, cid) => cid || "test-tenant",
      sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
      sendError: (res, status, code, msg) => res.status(status).json({ error: code, message: msg }),
      normalizeString: (s) => (s ? String(s).trim() : ""),
      supabase: null,
      getLeadClientN8nSettings: async () => ({
        plan_tier: currentTenantPlan,
        modulos_avulsos: currentTenantModulos,
      }),
    };

    registerLeadsRoutes(app, deps);

    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  afterAll(async () => {
    globalThis.fetch = originalFetch;
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    mockDb.leads.length = 0;
    currentTenantPlan = "essencial";
    currentTenantModulos = [];
  });

  // 1. Testes com Tenant sem plano avançado pedindo "all" (deve receber 500)
  describe("corpo pedindo 'all' num tenant sem plano avançado recebe o teto do plano (500)", () => {
    it("origem conversas: pede 'all' e recebe no máximo 500 contatos", async () => {
      currentTenantPlan = "essencial";
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "test-tenant",
          sources: ["conversas"],
          chatLimit: "all",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.extractedCount).toBe(500);
      expect(data.fromChats).toBe(500);
    });

    it("origem agenda: pede 'all' e recebe no máximo 500 contatos", async () => {
      currentTenantPlan = "essencial";
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "test-tenant",
          sources: ["agenda"],
          chatLimit: "all",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.extractedCount).toBe(500);
      expect(data.fromAddressBook).toBe(500);
    });

    it("origem grupos: pede 'all' e recebe no máximo 500 contatos", async () => {
      currentTenantPlan = "essencial";
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "test-tenant",
          sources: ["grupos"],
          groupIds: ["120363000999@g.us"],
          chatLimit: "all",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.extractedCount).toBe(500);
      expect(data.fromGroups).toBe(500);
    });

    it("combinação de origens: agenda + conversas somam no máximo 500 contatos", async () => {
      currentTenantPlan = "essencial";
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "test-tenant",
          sources: ["agenda", "conversas"],
          chatLimit: "all",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.extractedCount).toBe(500);
      expect(data.fromAddressBook + data.fromChats).toBe(500);
    });
  });

  // 2. Testes com corpo pedindo valor menor que o teto (redução permitida)
  describe("corpo pedindo valor menor que o teto é respeitado — reduzir pode", () => {
    it("origem conversas: pede 50 e recebe exatamente 50", async () => {
      currentTenantPlan = "essencial";
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "test-tenant",
          sources: ["conversas"],
          chatLimit: 50,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.extractedCount).toBe(500 ? 50 : 500); // 50
      expect(data.fromChats).toBe(50);
    });

    it("origem agenda: pede 100 e recebe exatamente 100", async () => {
      currentTenantPlan = "essencial";
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "test-tenant",
          sources: ["agenda"],
          chatLimit: 100,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.extractedCount).toBe(100);
      expect(data.fromAddressBook).toBe(100);
    });

    it("origem grupos: pede 30 e recebe exatamente 30", async () => {
      currentTenantPlan = "essencial";
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "test-tenant",
          sources: ["grupos"],
          groupIds: ["120363000999@g.us"],
          chatLimit: 30,
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.extractedCount).toBe(30);
      expect(data.fromGroups).toBe(30);
    });
  });

  // 3. Testes com Tenant no plano avançado (continua com ilimitado)
  describe("tenant com plano avançado continua com ilimitado", () => {
    it("origem conversas: extrai todos os 600 disponíveis", async () => {
      currentTenantPlan = "avancado";
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "test-tenant",
          sources: ["conversas"],
          chatLimit: "all",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.extractedCount).toBe(600);
      expect(data.fromChats).toBe(600);
    });

    it("origem agenda: extrai todos os 600 contatos da agenda", async () => {
      currentTenantPlan = "avancado";
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "test-tenant",
          sources: ["agenda"],
          chatLimit: "all",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.extractedCount).toBe(600);
      expect(data.fromAddressBook).toBe(600);
    });

    it("origem grupos: extrai todos os 600 membros do grupo", async () => {
      currentTenantPlan = "avancado";
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "test-tenant",
          sources: ["grupos"],
          groupIds: ["120363000999@g.us"],
          chatLimit: "all",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.extractedCount).toBe(600);
      expect(data.fromGroups).toBe(600);
    });

    it("tenant modular com módulo avulso 'extracao_ilimitada' tem acesso ilimitado", async () => {
      currentTenantPlan = "modular";
      currentTenantModulos = ["extracao_ilimitada"];
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "test-tenant",
          sources: ["conversas"],
          chatLimit: "all",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.extractedCount).toBe(600);
      expect(data.fromChats).toBe(600);
    });
  });
});
