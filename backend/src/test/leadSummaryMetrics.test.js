import { describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { isManagerOrAdmin } from "../access/claims.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function startTestServer(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

describe("Card Potencial da Base — Métricas do Backend (GET /api/leads) e Permissões (PATCH /api/lead-clients/:tenantId)", () => {
  // Teste 5: O literal 2500 não existe mais no cálculo de estimatedRevenue em routes.js
  it("garante estaticamente que o literal '2500' não existe mais no routes.js de leads", () => {
    const routesContent = readFileSync(join(__dirname, "../domains/leads/routes.js"), "utf8");
    expect(routesContent).not.toContain("|| 2500");
    expect(routesContent).not.toContain("||2500");
  });

  describe("Cálculo das 3 Faixas no Summary (GET /api/leads)", () => {
    function setupAppWithMockLeads(leadsList) {
      const app = express();
      app.use(express.json());

      const mockSupabase = {
        from: vi.fn((table) => {
          if (table === "leads") {
            const queryBuilder = {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              range: vi.fn().mockReturnThis(),
              or: vi.fn().mockReturnThis(),
              then: (resolve) =>
                resolve({
                  data: leadsList,
                  error: null,
                  count: leadsList.length,
                }),
            };
            return queryBuilder;
          }
          if (table === "leads_clients") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: "gmca", name: "GMCA", ticket_medio: 1000 },
                error: null,
              }),
            };
          }
          return {};
        }),
      };

      const deps = {
        app,
        supabase: mockSupabase,
        ensureDb: () => true,
        ensureDbClient: vi.fn(),
        requireFirebaseAuth: (req, _res, next) => {
          req.authAccess = { isAdmin: true, role: "internal", clientId: "gmca" };
          next();
        },
        requireAppViewAccess: () => (_req, _res, next) => next(),
        requireInternalPageAccess: () => (_req, _res, next) => next(),
        ensureSharedRoutePageAccess: () => true,
        resolveAuthorizedClientId: (_req, _res, cid) => cid || "gmca",
        normalizeTenantKey: (k) => k,
        normalizeString: (s) => (s ? String(s).trim() : ""),
        sendError: (res, status, code, msg) => res.status(status).json({ error: code, message: msg }),
        pgDatabasePool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      };

      registerLeadsRoutes(app, deps);
      return app;
    }

    it("Lead em open_budget que também tem raw_chat_summary conta uma vez só, em Negociação", async () => {
      const leads = [
        {
          id: "lead-1",
          client_id: "gmca",
          stage: "open_budget",
          raw_chat_summary: "Cliente interessado no pacote premium, pediu proposta",
          potential_contract_value: 5000,
        },
      ];

      const app = setupAppWithMockLeads(leads);
      const srv = await startTestServer(app);
      try {
        const res = await fetch(`${srv.baseUrl}/api/leads?clientId=gmca`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.summary.inNegotiationCount).toBe(1);
        expect(data.summary.inConversationCount).toBe(0);
        expect(data.summary.neverContactedCount).toBe(0);
        expect(data.summary.buyersCount).toBe(0);
        expect(data.summary.lostCount).toBe(0);
        expect(data.summary.activeLeadsCount).toBe(1);
        expect(data.summary.totalLeads).toBe(1);
        expect(data.summary.estimatedRevenue).toBe(5000);
      } finally {
        await srv.close();
      }
    });

    it("buyer e lost ficam fora das três faixas", async () => {
      const leads = [
        {
          id: "lead-buyer-1",
          client_id: "gmca",
          stage: "buyer",
          raw_chat_summary: "Comprou serviço",
        },
        {
          id: "lead-buyer-2",
          client_id: "gmca",
          stage: "buyer",
          raw_chat_summary: "Já é cliente antigo",
        },
        {
          id: "lead-lost-1",
          client_id: "gmca",
          stage: "lost",
          raw_chat_summary: "Desistiu por preço",
        },
      ];

      const app = setupAppWithMockLeads(leads);
      const srv = await startTestServer(app);
      try {
        const res = await fetch(`${srv.baseUrl}/api/leads?clientId=gmca`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.summary.buyersCount).toBe(2);
        expect(data.summary.lostCount).toBe(1);
        expect(data.summary.inNegotiationCount).toBe(0);
        expect(data.summary.inConversationCount).toBe(0);
        expect(data.summary.neverContactedCount).toBe(0);
        expect(data.summary.activeLeadsCount).toBe(0);
        expect(data.summary.totalLeads).toBe(3);
      } finally {
        await srv.close();
      }
    });

    it("status ('cliente', 'qualificado', 'WON') NÃO alimenta buyersCount — somente stage === 'buyer' conta", async () => {
      const leads = [
        {
          id: "lead-status-cliente",
          client_id: "gmca",
          stage: "cold",
          status: "cliente",
          raw_chat_summary: "Lead antigo",
        },
        {
          id: "lead-status-qualificado",
          client_id: "gmca",
          stage: "cold",
          status: "qualificado",
          raw_chat_summary: "Qualificado no passado",
        },
        {
          id: "lead-status-won",
          client_id: "gmca",
          stage: "cold",
          status: "WON",
          raw_chat_summary: "Fechamento antigo",
        },
      ];

      const app = setupAppWithMockLeads(leads);
      const srv = await startTestServer(app);
      try {
        const res = await fetch(`${srv.baseUrl}/api/leads?clientId=gmca`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.summary.buyersCount).toBe(0);
        expect(data.summary.inConversationCount).toBe(3);
        expect(data.summary.totalLeads).toBe(3);
      } finally {
        await srv.close();
      }
    });

    it("Lead sem raw_chat_summary cai em Nunca Abordados, tendo ou não a tag agenda-whatsapp", async () => {
      const leads = [
        {
          id: "lead-agenda",
          client_id: "gmca",
          stage: "cold",
          tags: ["agenda-whatsapp"],
          raw_chat_summary: null,
        },
        {
          id: "lead-planilha",
          client_id: "gmca",
          stage: "cold",
          tags: ["planilha-leads"],
          raw_chat_summary: "",
        },
        {
          id: "lead-form",
          client_id: "gmca",
          stage: "cold",
          tags: [],
          raw_chat_summary: "   ",
        },
      ];

      const app = setupAppWithMockLeads(leads);
      const srv = await startTestServer(app);
      try {
        const res = await fetch(`${srv.baseUrl}/api/leads?clientId=gmca`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.summary.neverContactedCount).toBe(3);
        expect(data.summary.inConversationCount).toBe(0);
        expect(data.summary.inNegotiationCount).toBe(0);
        expect(data.summary.activeLeadsCount).toBe(3);
        expect(data.summary.totalLeads).toBe(3);
      } finally {
        await srv.close();
      }
    });

    it("Soma das faixas + buyers + lost igual a totalLeads (fechamento estrito com referência GMCA)", async () => {
      const leads = [];

      // 2 Buyers
      leads.push({ id: "b1", client_id: "gmca", stage: "buyer" });
      leads.push({ id: "b2", client_id: "gmca", stage: "buyer" });

      // 6 inNegotiation
      for (let i = 1; i <= 6; i++) {
        leads.push({
          id: `neg-${i}`,
          client_id: "gmca",
          stage: "open_budget",
          raw_chat_summary: `Resumo negociação ${i}`,
        });
      }

      // 206 inConversation
      for (let i = 1; i <= 206; i++) {
        leads.push({
          id: `conv-${i}`,
          client_id: "gmca",
          stage: "cold",
          raw_chat_summary: `Resumo conversa ${i}`,
        });
      }

      // 1892 neverContacted
      for (let i = 1; i <= 1892; i++) {
        leads.push({
          id: `agenda-${i}`,
          client_id: "gmca",
          stage: "cold",
          tags: ["agenda-whatsapp"],
          raw_chat_summary: null,
        });
      }

      expect(leads.length).toBe(2106);

      const app = setupAppWithMockLeads(leads);
      const srv = await startTestServer(app);
      try {
        const res = await fetch(`${srv.baseUrl}/api/leads?clientId=gmca`);
        expect(res.status).toBe(200);
        const data = await res.json();
        const s = data.summary;
        expect(s.totalLeads).toBe(2106);
        expect(s.buyersCount).toBe(2);
        expect(s.lostCount).toBe(0);
        expect(s.inNegotiationCount).toBe(6);
        expect(s.inConversationCount).toBe(206);
        expect(s.neverContactedCount).toBe(1892);
        expect(s.activeLeadsCount).toBe(2104);

        const totalSoma =
          s.buyersCount +
          s.lostCount +
          s.inNegotiationCount +
          s.inConversationCount +
          s.neverContactedCount;
        expect(totalSoma).toBe(s.totalLeads);
      } finally {
        await srv.close();
      }
    });

    it("estimatedRevenue não inventa 2500 quando potential_contract_value for vazio", async () => {
      const leads = [
        {
          id: "neg-sem-valor",
          client_id: "gmca",
          stage: "open_budget",
          potential_contract_value: null,
        },
        {
          id: "neg-com-valor",
          client_id: "gmca",
          stage: "open_budget",
          potential_contract_value: 3200,
        },
      ];

      const app = setupAppWithMockLeads(leads);
      const srv = await startTestServer(app);
      try {
        const res = await fetch(`${srv.baseUrl}/api/leads?clientId=gmca`);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.summary.estimatedRevenue).toBe(3200);
      } finally {
        await srv.close();
      }
    });
  });

  describe("Permissões de Escrita do Ticket Médio (PATCH /api/lead-clients/:tenantId)", () => {
    function setupAppForPermissions(authAccess) {
      const app = express();
      app.use(express.json());

      let mockTenant = { id: "gmca", name: "GMCA", ticket_medio: 1000 };

      const mockSupabase = {
        from: vi.fn((table) => {
          if (table === "leads_clients") {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn(() => ({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: mockTenant,
                  error: null,
                }),
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                  data: mockTenant,
                  error: null,
                }),
              })),
              update: vi.fn((updates) => {
                mockTenant = { ...mockTenant, ...updates };
                return {
                  eq: vi.fn().mockReturnThis(),
                  select: vi.fn().mockReturnThis(),
                  single: vi.fn().mockResolvedValue({
                    data: mockTenant,
                    error: null,
                  }),
                };
              }),
            };
          }
          return {};
        }),
      };

      const deps = {
        app,
        supabase: mockSupabase,
        ensureDb: () => true,
        ensureDbClient: vi.fn(),
        requireFirebaseAuth: (req, _res, next) => {
          req.authAccess = authAccess;
          next();
        },
        requireAppViewAccess: () => (_req, _res, next) => next(),
        requireInternalPageAccess: () => (_req, _res, next) => next(),
        ensureSharedRoutePageAccess: () => true,
        resolveAuthorizedClientId: (_req, _res, cid) => cid || "gmca",
        normalizeTenantKey: (k) => k,
        normalizeString: (s) => (s ? String(s).trim() : ""),
        sendError: (res, status, code, msg) => res.status(status).json({ error: code, message: msg }),
        pgDatabasePool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
      };

      registerLeadsRoutes(app, deps);
      return app;
    }

    it("isManagerOrAdmin unificado identifica corretamente quem pode e quem não pode gravar", () => {
      // a) Gestor completo → true
      const gestorCompleto = {
        role: "internal",
        isAdmin: false,
        accessPreset: "gestor",
        scopeMode: "all_clients",
        approvalLevel: "manager",
        clientId: "gmca",
        clientIds: ["gmca"],
        internalPages: [
          "dashboard",
          "banco-de-dados",
          "whatsapp",
          "conexoes",
          "campanhas",
          "disparos",
          "planilhas",
          "agente",
          "usuarios",
        ],
        permissions: ["users.view", "users.manage"],
      };

      // b) Gestor com approvalLevel: "none" → true (caso real de produção: tinturariadocarlos e sonhareviagens)
      // Prova que o gate funciona sem depender do approvalLevel
      const gestorApprovalNone = {
        role: "internal",
        isAdmin: false,
        accessPreset: "gestor",
        scopeMode: "all_clients",
        approvalLevel: "none",
        clientId: "gmca",
        clientIds: ["gmca"],
        internalPages: [
          "dashboard",
          "banco-de-dados",
          "whatsapp",
          "conexoes",
          "campanhas",
          "disparos",
          "planilhas",
          "agente",
          "usuarios",
        ],
        permissions: ["users.manage"],
      };

      // c) Operador real → false
      const operadorReal = {
        role: "internal",
        isAdmin: false,
        accessPreset: "operador",
        scopeMode: "all_clients",
        approvalLevel: "operator",
        clientId: "gmca",
        clientIds: ["gmca"],
        internalPages: [
          "dashboard",
          "banco-de-dados",
          "whatsapp",
          "conexoes",
          "campanhas",
          "disparos",
          "planilhas",
          "agente",
        ],
        permissions: [],
      };

      // d) Teste que documenta o campo morto → false
      // A linha access.preset === "gestor" do isManagerOrAdmin não dispara porque o campo real
      // produzido por resolveAccess é accessPreset; se alguém corrigir isso, este teste quebra
      // de propósito, porque a mudança amplia a superfície de permissão e precisa de decisão consciente.
      const objetoCampoMorto = {
        role: "internal",
        accessPreset: "gestor",
      };

      const admin = {
        role: "internal",
        isAdmin: true,
        accessPreset: "admin_vexo",
        scopeMode: "all_clients",
        approvalLevel: "director",
        clientId: "gmca",
        clientIds: ["gmca"],
        internalPages: ["all"],
        permissions: ["users.view", "users.manage"],
      };

      expect(isManagerOrAdmin(gestorCompleto)).toBe(true);
      expect(isManagerOrAdmin(gestorApprovalNone)).toBe(true);
      expect(isManagerOrAdmin(operadorReal)).toBe(false);
      expect(isManagerOrAdmin(objetoCampoMorto)).toBe(false);
      expect(isManagerOrAdmin(admin)).toBe(true);
    });

    it("Operador recebe 403 ao gravar o ticket médio", async () => {
      const operadorAccess = {
        role: "internal",
        isAdmin: false,
        accessPreset: "operador",
        scopeMode: "all_clients",
        approvalLevel: "operator",
        clientId: "gmca",
        clientIds: ["gmca"],
        internalPages: [
          "dashboard",
          "banco-de-dados",
          "whatsapp",
          "conexoes",
          "campanhas",
          "disparos",
          "planilhas",
          "agente",
        ],
        permissions: [],
      };

      const app = setupAppForPermissions(operadorAccess);
      const srv = await startTestServer(app);
      try {
        const res = await fetch(`${srv.baseUrl}/api/lead-clients/gmca`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket_medio: 1500 }),
        });

        expect(res.status).toBe(403);
        const data = await res.json();
        expect(data.error).toBe("FORBIDDEN");
      } finally {
        await srv.close();
      }
    });

    it("Gestor com approvalLevel 'none' (caso real de produção) grava o ticket médio com 200", async () => {
      const gestorAccess = {
        role: "internal",
        isAdmin: false,
        accessPreset: "gestor",
        scopeMode: "all_clients",
        approvalLevel: "none",
        clientId: "gmca",
        clientIds: ["gmca"],
        internalPages: [
          "dashboard",
          "banco-de-dados",
          "whatsapp",
          "conexoes",
          "campanhas",
          "disparos",
          "planilhas",
          "agente",
          "usuarios",
        ],
        permissions: ["users.manage"],
      };

      const app = setupAppForPermissions(gestorAccess);
      const srv = await startTestServer(app);
      try {
        const res = await fetch(`${srv.baseUrl}/api/lead-clients/gmca`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket_medio: 1500 }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.item.ticket_medio).toBe(1500);
      } finally {
        await srv.close();
      }
    });

    it("Admin grava o ticket médio com 200", async () => {
      const adminAccess = {
        role: "internal",
        isAdmin: true,
        accessPreset: "admin_vexo",
        scopeMode: "all_clients",
        approvalLevel: "director",
        clientId: "gmca",
        clientIds: ["gmca"],
        internalPages: ["all"],
        permissions: ["users.view", "users.manage"],
      };

      const app = setupAppForPermissions(adminAccess);
      const srv = await startTestServer(app);
      try {
        const res = await fetch(`${srv.baseUrl}/api/lead-clients/gmca`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticket_medio: 2000 }),
        });

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.item.ticket_medio).toBe(2000);
      } finally {
        await srv.close();
      }
    });
  });
});
