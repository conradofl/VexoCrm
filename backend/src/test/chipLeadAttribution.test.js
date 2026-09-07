import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import http from "http";
import {
  upsertLeadByPhone,
  upsertLeadsBatchByPhone,
} from "../services/leadUpsert.js";
import { resolveEvolutionInstanceOwner } from "../services/evolution.js";
import { isManagerOrAdmin } from "../access/claims.js";
import { registerChatbotRoutes } from "../domains/chatbot/routes.js";
import { registerLeadsRoutes } from "../domains/leads/routes.js";

describe("Bloco 3 — Atribuição Real de Lead por Chip", () => {
  function createMockDb() {
    const leads = [];

    const pool = {
      leads,
      query: vi.fn(async (sql, params = []) => {
        const text = sql.trim();

        // 1. SELECT leads
        if (text.includes("SELECT") && text.includes("FROM public.leads") && text.includes("WHERE client_id = $1")) {
          const clientId = params[0];
          if (text.includes("ANY(")) {
            const phones = params[1] || [];
            const matching = leads.filter(
              (l) => l.client_id === clientId && (phones.includes(l.telefone) || phones.includes(l.phone))
            );
            return { rows: matching.map((l) => ({ ...l })) };
          }
          const phoneQuery = params[1];
          const found = leads.find(
            (l) =>
              l.client_id === clientId &&
              (l.telefone === phoneQuery ||
                l.phone === phoneQuery ||
                l.telefone === `+${phoneQuery}` ||
                l.phone === `+${phoneQuery}` ||
                (phoneQuery && l.telefone && l.telefone.endsWith(phoneQuery.slice(-8))) ||
                (phoneQuery && l.phone && l.phone.endsWith(phoneQuery.slice(-8))))
          );
          return { rows: found ? [{ ...found }] : [] };
        }

        // 2. INSERT
        if (text.startsWith("INSERT INTO public.leads")) {
          const colsMatch = text.match(/\(([^)]+)\)/);
          const colNames = colsMatch ? colsMatch[1].split(",").map((c) => c.trim().replace(/"/g, "")) : [];

          if (colNames.length > 0) {
            const COLS_COUNT = colNames.length;
            const insertedRows = [];
            for (let i = 0; i < params.length; i += COLS_COUNT) {
              const row = { id: `lead-${leads.length + 1}` };
              colNames.forEach((col, idx) => {
                let val = params[i + idx];
                if (col === "dados" && typeof val === "string") {
                  try { val = JSON.parse(val); } catch {}
                }
                row[col] = val;
              });
              leads.push(row);
              insertedRows.push({ id: row.id, ...row });
            }
            return { rows: insertedRows };
          }
        }

        // 3. UPDATE
        if (text.startsWith("UPDATE public.leads SET")) {
          const whereIdMatch = text.match(/WHERE id = \$(\d+)/);
          const idIdx = whereIdMatch ? parseInt(whereIdMatch[1], 10) - 1 : -1;
          const targetId = params[idIdx];

          const target = leads.find((l) => l.id === targetId);
          if (target) {
            const setClause = text.match(/SET (.+?) WHERE/)?.[1] || "";
            const assignments = setClause.split(",").map((a) => a.trim());

            assignments.forEach((assignment) => {
              const [col, paramPlaceholder] = assignment.split("=").map((s) => s.trim());
              const pIndex = parseInt(paramPlaceholder.replace("$", ""), 10) - 1;
              let val = params[pIndex];
              if (col === "dados" && typeof val === "string") {
                try { val = JSON.parse(val); } catch {}
              }
              target[col] = val;
            });
          }
          return { rowCount: target ? 1 : 0 };
        }

        // 4. SELECT instances (for evolution owner lookup)
        if (text.includes("FROM public.lead_client_evolution_instances")) {
          const clientId = params[0];
          if (clientId === "geracao-digital") {
            return {
              rows: [
                {
                  id: "inst-1",
                  client_id: "geracao-digital",
                  name: "GD Priscila",
                  dispatch_webhook_url: "https://evo.vexo.com/instance/GD_Priscila",
                  owner_uid: "uid-priscila-123",
                  active: true,
                  is_default: false,
                },
                {
                  id: "inst-2",
                  client_id: "geracao-digital",
                  name: "Gabriel - Comercial Agência GD",
                  dispatch_webhook_url: "https://evo.vexo.com/instance/Gabriel_GD",
                  owner_uid: "uid-gabriel-456",
                  active: true,
                  is_default: false,
                },
                {
                  id: "inst-3",
                  client_id: "geracao-digital",
                  name: "Número oficial – Agência GD",
                  dispatch_webhook_url: "https://evo.vexo.com/instance/Oficial_GD",
                  owner_uid: null,
                  active: true,
                  is_default: true,
                },
              ],
            };
          }
          return { rows: [] };
        }

        // 5. SELECT lead_messages
        if (text.includes("FROM public.lead_messages")) {
          return { rows: [] };
        }

        // 6. UPDATE lead_messages
        if (text.includes("UPDATE public.lead_messages")) {
          return { rowCount: 1 };
        }

        return { rows: [], rowCount: 0 };
      }),
    };

    return pool;
  }

  describe("Atribuição de Leads Novos por Chip (upsertLeadByPhone)", () => {
    it("atribui assigned_to ao criar novo lead a partir de chip com dono (Priscila)", async () => {
      const db = createMockDb();

      const action = await upsertLeadByPhone(
        db,
        "geracao-digital",
        "5511999990001",
        {
          nome: "Lead da Priscila",
          assigned_to: "uid-priscila-123",
        }
      );

      expect(action).toBe("inserted");
      const inserted = db.leads.find((l) => l.telefone === "5511999990001");
      expect(inserted).toBeDefined();
      expect(inserted.assigned_to).toBe("uid-priscila-123");
    });

    it("mantém assigned_to NULL ao criar novo lead a partir de chip sem dono (Número oficial / Caio)", async () => {
      const db = createMockDb();

      const action = await upsertLeadByPhone(
        db,
        "geracao-digital",
        "5511999990002",
        {
          nome: "Lead do Número Oficial",
          assigned_to: null,
        }
      );

      expect(action).toBe("inserted");
      const inserted = db.leads.find((l) => l.telefone === "5511999990002");
      expect(inserted).toBeDefined();
      expect(inserted.assigned_to).toBeNull();
    });
  });

  describe("Blindagem e Preservação de Histórico (Regra Inviolável dos 2.126 leads)", () => {
    it("NUNCA sobrescreve assigned_to em lead existente ao receber nova mensagem inbound", async () => {
      const db = createMockDb();

      // Lead histórico existente com assigned_to = NULL
      db.leads.push({
        id: "lead-historico-1",
        client_id: "geracao-digital",
        telefone: "5511888880001",
        phone: "5511888880001",
        nome: "Cliente Histórico",
        assigned_to: null,
      });

      // Nova mensagem chega no chip da Priscila
      const action = await upsertLeadByPhone(
        db,
        "geracao-digital",
        "5511888880001",
        {
          nome: "Cliente Histórico Atualizado",
          assigned_to: "uid-priscila-123", // Tentativa de atribuição em inbound
        }
      );

      expect(action).toBe("updated");
      const existing = db.leads.find((l) => l.id === "lead-historico-1");
      expect(existing).toBeDefined();
      // Permanece NULL — jamais sobreescrito!
      expect(existing.assigned_to).toBeNull();
    });

    it("NUNCA altera assigned_to existente de um operador para outro via inbound", async () => {
      const db = createMockDb();

      // Lead atribuído previamente ao Gabriel
      db.leads.push({
        id: "lead-gabriel-1",
        client_id: "geracao-digital",
        telefone: "5511888880002",
        phone: "5511888880002",
        nome: "Cliente do Gabriel",
        assigned_to: "uid-gabriel-456",
      });

      // Mensagem inbound chega no chip da Priscila
      await upsertLeadByPhone(
        db,
        "geracao-digital",
        "5511888880002",
        {
          nome: "Cliente do Gabriel Atualizado",
          assigned_to: "uid-priscila-123",
        }
      );

      const lead = db.leads.find((l) => l.id === "lead-gabriel-1");
      expect(lead.assigned_to).toBe("uid-gabriel-456");
    });
  });

  describe("Resolução de Dono de Instância Evolution", () => {
    it("resolve owner_uid corretamente para chips com dono e sem dono", async () => {
      const db = createMockDb();

      const priscilaOwner = await resolveEvolutionInstanceOwner({
        clientId: "geracao-digital",
        instanceName: "GD Priscila",
        dbPool: db,
      });
      expect(priscilaOwner).toBe("uid-priscila-123");

      const gabrielOwner = await resolveEvolutionInstanceOwner({
        clientId: "geracao-digital",
        instanceName: "Gabriel - Comercial Agência GD",
        dbPool: db,
      });
      expect(gabrielOwner).toBe("uid-gabriel-456");

      const oficialOwner = await resolveEvolutionInstanceOwner({
        clientId: "geracao-digital",
        instanceName: "Número oficial – Agência GD",
        dbPool: db,
      });
      expect(oficialOwner).toBeNull();
    });

    it("devolve null quando instanceName é null ou undefined, mesmo havendo chip padrão com dono no tenant", async () => {
      const customDb = {
        query: vi.fn(async (sql, params = []) => {
          if (sql.includes("FROM public.lead_client_evolution_instances")) {
            return {
              rows: [
                {
                  id: "inst-1",
                  client_id: "geracao-digital",
                  name: "GD Priscila",
                  dispatch_webhook_url: "https://evo.vexo.com/instance/GD_Priscila",
                  owner_uid: "uid-priscila-123",
                  active: true,
                  is_default: true,
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const ownerNull = await resolveEvolutionInstanceOwner({
        clientId: "geracao-digital",
        instanceName: null,
        dbPool: customDb,
      });
      expect(ownerNull).toBeNull();

      const ownerUndefined = await resolveEvolutionInstanceOwner({
        clientId: "geracao-digital",
        instanceName: undefined,
        dbPool: customDb,
      });
      expect(ownerUndefined).toBeNull();
    });

    it("devolve null quando instanceName não bate com nenhum chip cadastrado, mesmo havendo chip padrão", async () => {
      const customDb = {
        query: vi.fn(async (sql, params = []) => {
          if (sql.includes("FROM public.lead_client_evolution_instances")) {
            return {
              rows: [
                {
                  id: "inst-1",
                  client_id: "geracao-digital",
                  name: "GD Priscila",
                  dispatch_webhook_url: "https://evo.vexo.com/instance/GD_Priscila",
                  owner_uid: "uid-priscila-123",
                  active: true,
                  is_default: true,
                },
              ],
            };
          }
          return { rows: [] };
        }),
      };

      const ownerUnknown = await resolveEvolutionInstanceOwner({
        clientId: "geracao-digital",
        instanceName: "chip-inexistente-xyz",
        dbPool: customDb,
      });
      expect(ownerUnknown).toBeNull();
    });
  });

  describe("Controle de Acesso e Barreiras de 403 (isManagerOrAdmin unificado)", () => {
    it("identifica corretamente gestor e admin como autorizados", () => {
      const adminVexo = { preset: "admin_vexo", role: "internal" };
      const gestor = { preset: "gestor", role: "internal", internalPages: ["usuarios"] };
      const fixedAdmin = { isFixedAdmin: true, email: "conradofl@gmail.com" };

      expect(isManagerOrAdmin(adminVexo)).toBe(true);
      expect(isManagerOrAdmin(gestor)).toBe(true);
      expect(isManagerOrAdmin(fixedAdmin)).toBe(true);
    });

    it("identifica operador puro como NÃO autorizado para reatribuição", () => {
      const operador = {
        preset: "operador",
        role: "internal",
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
      };

      expect(isManagerOrAdmin(operador)).toBe(false);
      expect(isManagerOrAdmin(null)).toBe(false);
      expect(isManagerOrAdmin({})).toBe(false);
    });
  });

  describe("Ponto 2: Atribuição Automática Ponta a Ponta via Rota Real (/api/whatsapp/chats/create-lead)", () => {
    let server;
    let baseUrl;
    let mockDb;

    beforeAll(async () => {
      const app = express();
      app.use(express.json());

      mockDb = createMockDb();

      const deps = {
        appendLeadMessage: vi.fn(),
        classifyConversation: vi.fn(),
        ensureDb: () => true,
        ensureDbClient: vi.fn(),
        findCampaignReplyMatches: vi.fn(),
        normalizeString: (s) => (s ? String(s).trim() : ""),
        normalizeTenantKey: (k) => k,
        pgDatabasePool: mockDb,
        requireAppViewAccess: () => (_req, _res, next) => next(),
        requireFirebaseAuth: (_req, res, next) => {
          _req.user = { client_id: "geracao-digital", role: "admin" };
          _req.authAccess = { isAdmin: true, role: "internal", clientId: "geracao-digital" };
          next();
        },
        resolveAuthorizedClientId: (_req, _res, cid) => cid || "geracao-digital",
        resolveDispatchWebhookSettings: async () => ({}),
        resolveInboundDispatchSettings: async () => ({}),
        sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
        sendError: (res, status, code, msg) => res.status(status).json({ error: code, message: msg }),
        supabase: null,
        validateLeadsOutlierRecord: () => true,
        validateN8nInboundBearer: () => true,
      };

      registerChatbotRoutes(app, deps);

      server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      baseUrl = `http://localhost:${server.address().port}`;
    });

    afterAll(async () => {
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it("atribui automaticamente à Priscila quando chamado com instanceName 'GD Priscila' sem enviar assigned_to", async () => {
      const phone = "5511999990010";

      const res = await fetch(`${baseUrl}/api/whatsapp/chats/create-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "geracao-digital",
          phone,
          name: "Lead Inbound Priscila",
          instanceName: "GD Priscila",
          // assigned_to NÃO enviado manualmente: rota deve resolver sozinha
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      const savedLead = mockDb.leads.find((l) => l.telefone === phone || l.phone === phone);
      expect(savedLead).toBeDefined();
      expect(savedLead.assigned_to).toBe("uid-priscila-123");
    });

    it("mantém assigned_to = NULL quando chamado com chip sem dono ('Número oficial – Agência GD')", async () => {
      const phone = "5511999990011";

      const res = await fetch(`${baseUrl}/api/whatsapp/chats/create-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "geracao-digital",
          phone,
          name: "Lead Inbound Oficial",
          instanceName: "Número oficial – Agência GD",
          // assigned_to NÃO enviado manualmente
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      const savedLead = mockDb.leads.find((l) => l.telefone === phone || l.phone === phone);
      expect(savedLead).toBeDefined();
      expect(savedLead.assigned_to).toBeNull();
    });
  });

  describe("Ponto 3: Extração do Banco Inteligente (/api/leads/extract-wa-contacts)", () => {
    let server;
    let baseUrl;
    let mockDb;
    let originalFetch;

    beforeAll(async () => {
      originalFetch = globalThis.fetch;

      const app = express();
      app.use(express.json());

      mockDb = createMockDb();

      // Mock de fetch para interceptar chamadas para a Evolution API
      globalThis.fetch = vi.fn(async (url, opts) => {
        const urlStr = String(url);

        // Se for para o servidor local do teste, usa o fetch nativo
        if (urlStr.includes("localhost") || urlStr.includes("127.0.0.1")) {
          return originalFetch(url, opts);
        }

        // Simula resposta de /chat/findChats
        if (urlStr.includes("/chat/findChats/")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                remoteJid: "5511999990020@s.whatsapp.net",
                pushName: "Lead Extraído Conversa",
                lastMessage: { key: { fromMe: false, remoteJid: "5511999990020@s.whatsapp.net" }, messageTimestamp: 1700000000 },
              },
            ],
          };
        }

        // Simula resposta de /chat/findContacts
        if (urlStr.includes("/chat/findContacts/")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                remoteJid: "5511999990021@s.whatsapp.net",
                name: "Contato Agenda",
              },
            ],
          };
        }

        // Simula resposta de /instance/fetchInstances
        if (urlStr.includes("/instance/fetchInstances")) {
          return {
            ok: true,
            status: 200,
            json: async () => [
              {
                name: "GD Priscila",
                owner: "5511988888888@s.whatsapp.net",
              },
            ],
          };
        }

        // Simula resposta de /chat/findMessages
        if (urlStr.includes("/chat/findMessages/")) {
          return {
            ok: true,
            status: 200,
            json: async () => [],
          };
        }

        return { ok: false, status: 404, text: async () => "Not Found" };
      });

      const deps = {
        ensureDb: () => true,
        pgDatabasePool: mockDb,
        requireFirebaseAuth: (_req, res, next) => {
          _req.user = { client_id: "geracao-digital", role: "admin" };
          _req.authAccess = { isAdmin: true, role: "internal", clientId: "geracao-digital" };
          next();
        },
        requireInternalPageAccess: () => (_req, _res, next) => next(),
        requireAppViewAccess: () => (_req, _res, next) => next(),
        resolveAuthorizedClientId: (_req, _res, cid) => cid || "geracao-digital",
        sanitizePhone: (p) => String(p || "").replace(/\D/g, ""),
        sendError: (res, status, code, msg) => res.status(status).json({ error: code, message: msg }),
        normalizeString: (s) => (s ? String(s).trim() : ""),
        supabase: null,
      };

      registerLeadsRoutes(app, deps);

      server = http.createServer(app);
      await new Promise((resolve) => server.listen(0, resolve));
      baseUrl = `http://localhost:${server.address().port}`;
    });

    afterAll(async () => {
      globalThis.fetch = originalFetch;
      if (server) {
        await new Promise((resolve) => server.close(resolve));
      }
    });

    it("extração de conversa e agenda do chip da Priscila atribui leads à Priscila", async () => {
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "geracao-digital",
          instanceName: "GD Priscila",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      // Lead extraído da conversa
      const chatLead = mockDb.leads.find((l) => l.telefone === "5511999990020");
      expect(chatLead).toBeDefined();
      expect(chatLead.assigned_to).toBe("uid-priscila-123");

      // Lead extraído da agenda
      const agendaLead = mockDb.leads.find((l) => l.telefone === "5511999990021");
      expect(agendaLead).toBeDefined();
      expect(agendaLead.assigned_to).toBe("uid-priscila-123");
    });

    it("extração de chip sem dono mantém assigned_to = NULL para novos leads", async () => {
      // Limpa os leads anteriores para testar nova extração limpa
      mockDb.leads.length = 0;

      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "geracao-digital",
          instanceName: "Número oficial – Agência GD",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);

      const chatLead = mockDb.leads.find((l) => l.telefone === "5511999990020");
      expect(chatLead).toBeDefined();
      expect(chatLead.assigned_to).toBeNull();

      const agendaLead = mockDb.leads.find((l) => l.telefone === "5511999990021");
      expect(agendaLead).toBeDefined();
      expect(agendaLead.assigned_to).toBeNull();
    });

    it("re-extração de lead histórico existente NUNCA altera seu assigned_to (sem backfill)", async () => {
      // Pré-insere um lead histórico existente na base mock com assigned_to = NULL
      mockDb.leads.push({
        id: "lead-historico-99",
        client_id: "geracao-digital",
        telefone: "5511999990020",
        phone: "5511999990020",
        nome: "Lead Histórico dos 2.126",
        assigned_to: null,
      });

      // Extrai novamente a partir do chip da Priscila
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "geracao-digital",
          instanceName: "GD Priscila",
        }),
      });

      expect(res.status).toBe(200);
      const existing = mockDb.leads.find((l) => l.id === "lead-historico-99");
      expect(existing).toBeDefined();
      // Permanece NULL — jamais sobreescrito nem backfilled
      expect(existing.assigned_to).toBeNull();
    });
  });
});
