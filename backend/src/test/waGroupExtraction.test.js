// backend/src/test/waGroupExtraction.test.js
//
// Extração de membros de grupo — terceira procedência do Banco de Dados,
// ao lado de conversas e agenda. Só nome e telefone: nenhuma mensagem de
// grupo é lida ou gravada por este caminho. LID é perda irreversível (sem
// telefone recuperável) — conta, não inventa. Duas etapas: prévia (só
// leitura) e extração (grava só dos grupos escolhidos).

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import express from "express";
import http from "http";
import {
  registerLeadsRoutes,
  classifyGroupParticipantObject,
  classifyGroupParticipant,
} from "../domains/leads/routes.js";

function createMockDb() {
  const leads = [];

  const pool = {
    leads,
    query: vi.fn(async (sql, params = []) => {
      const text = sql.trim();

      // Instância Evolution do tenant de teste
      if (text.includes("FROM public.lead_client_evolution_instances")) {
        return {
          rows: [
            {
              id: "inst-1",
              client_id: "geracao-digital",
              name: "GD Grupos",
              dispatch_webhook_url: "https://evo.vexo.com/instance/GD_Grupos",
              owner_uid: "uid-dono-123",
              active: true,
              is_default: true,
            },
          ],
        };
      }

      // Busca em lote de leads existentes (upsertLeadsBatchByPhone) —
      // nenhum lead pré-existe nestes testes, tudo entra como INSERT.
      if (text.includes("SELECT") && text.includes("FROM public.leads") && text.includes("ANY(")) {
        return { rows: [] };
      }

      // Busca individual de lead existente (upsertLeadByPhone, usado por
      // conversas/agenda) — também vazio.
      if (text.includes("SELECT") && text.includes("FROM public.leads") && text.includes("WHERE client_id = $1")) {
        return { rows: [] };
      }

      // INSERT em lote ou individual em public.leads
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

      if (text.includes("FROM public.lead_messages")) {
        return { rows: [] };
      }

      return { rows: [], rowCount: 0 };
    }),
  };

  return pool;
}

describe("Extração de membros de grupo do WhatsApp", () => {
  let server;
  let baseUrl;
  let mockDb;
  let originalFetch;
  let fetchCalls;
  let groupsPayloadOverride = null;

  // Três grupos: um com mistura de válido/LID/o-próprio-chip/inválido, um
  // com participante repetido no outro grupo (dedupe), um não selecionado
  // (pra provar que só os escolhidos entram).
  const GROUPS_PAYLOAD = [
    {
      id: "120363000001@g.us",
      subject: "Clientes VIP",
      participants: [
        { id: "5511988887777@s.whatsapp.net" }, // válido
        { id: "5511988886666@s.whatsapp.net" }, // válido — também está no grupo B (dedupe)
        { id: "18293847561029384756@lid" }, // LID — perdido
        { id: "5511999998888@s.whatsapp.net" }, // é o próprio chip (ownerDigits) — excluído
        { id: "12345@s.whatsapp.net" }, // dígitos curtos demais — inválido
      ],
    },
    {
      id: "120363000002@g.us",
      subject: "Leads Feira",
      participants: [
        { id: "5511988886666@s.whatsapp.net" }, // mesmo telefone do grupo A — dedupe
        { id: "5511977776655@s.whatsapp.net" }, // válido, único deste grupo
      ],
    },
    {
      id: "120363000003@g.us",
      subject: "Grupo Não Selecionado",
      participants: [{ id: "5511900000000@s.whatsapp.net" }],
    },
  ];

  beforeAll(async () => {
    originalFetch = globalThis.fetch;

    const app = express();
    app.use(express.json());
    mockDb = createMockDb();

    globalThis.fetch = vi.fn(async (url, opts) => {
      const urlStr = String(url);
      fetchCalls.push(urlStr);

      if (urlStr.includes("localhost") || urlStr.includes("127.0.0.1")) {
        return originalFetch(url, opts);
      }

      if (urlStr.includes("/instance/fetchInstances")) {
        return {
          ok: true,
          status: 200,
          json: async () => [{ name: "GD Grupos", owner: "5511999998888@s.whatsapp.net" }],
        };
      }

      if (urlStr.includes("/group/fetchAllGroups/")) {
        return { ok: true, status: 200, json: async () => groupsPayloadOverride || GROUPS_PAYLOAD };
      }

      if (urlStr.includes("/chat/findContacts/")) {
        return {
          ok: true,
          status: 200,
          json: async () => [
            { remoteJid: "5511988887777@s.whatsapp.net", name: "Fernanda VIP" },
          ],
        };
      }

      // Não deveriam ser chamadas quando sources = ["grupos"] — se forem,
      // os testes que checam fetchCalls pegam.
      if (urlStr.includes("/chat/findChats/") || urlStr.includes("/chat/findMessages/")) {
        return { ok: true, status: 200, json: async () => [] };
      }

      return { ok: false, status: 404, text: async () => "Not Found" };
    });

    const deps = {
      ensureDb: () => true,
      pgDatabasePool: mockDb,
      requireFirebaseAuth: (_req, _res, next) => {
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
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    mockDb.leads.length = 0;
    fetchCalls = [];
    groupsPayloadOverride = null;
  });

  describe("POST /api/leads/extract-wa-groups/preview", () => {
    it("[TESTE OBRIGATÓRIO] a prévia não grava nada — a contagem de leads não muda", async () => {
      const before = mockDb.leads.length;
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-groups/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "geracao-digital", instanceName: "GD Grupos" }),
      });
      expect(res.status).toBe(200);
      await res.json();
      expect(mockDb.leads.length).toBe(before);
      expect(mockDb.leads.length).toBe(0);
    });

    it("devolve por grupo: nome, total de membros, aproveitáveis e LID", async () => {
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-groups/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "geracao-digital", instanceName: "GD Grupos" }),
      });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.groups).toHaveLength(3);

      const vip = data.groups.find((g) => g.id === "120363000001@g.us");
      expect(vip.name).toBe("Clientes VIP");
      expect(vip.totalMembers).toBe(5);
      // válidos: 5511988887777 e 5511988886666 (2) — LID: 1 — o próprio chip
      // e o número curto não entram em nenhum dos dois baldes
      expect(vip.usableCount).toBe(2);
      expect(vip.lidCount).toBe(1);

      const feira = data.groups.find((g) => g.id === "120363000002@g.us");
      expect(feira.totalMembers).toBe(2);
      expect(feira.usableCount).toBe(2);
      expect(feira.lidCount).toBe(0);
    });
  });

  describe("POST /api/leads/extract-wa-contacts com sources incluindo 'grupos'", () => {
    it("[TESTE OBRIGATÓRIO] sources omitido devolve exatamente o resultado de hoje — grupo nenhum entra", async () => {
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "geracao-digital", instanceName: "GD Grupos" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.fromGroups).toBe(0);
      expect(data.groupParticipantsLid).toBe(0);
      // sem sources, /group/fetchAllGroups nunca é chamada
      expect(fetchCalls.some((u) => u.includes("/group/fetchAllGroups/"))).toBe(false);
      // comportamento de sempre continua: conversas (0, mock sem chats) +
      // agenda (1, o contato do findContacts) — nenhum lead com origem de grupo
      expect(mockDb.leads.every((l) => l.dados?.origem !== "WhatsApp Grupo")).toBe(true);
    });

    it("[TESTE OBRIGATÓRIO] participante LID não vira lead e entra na contagem de perdidos", async () => {
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "geracao-digital",
          instanceName: "GD Grupos",
          sources: ["grupos"],
          groupIds: ["120363000001@g.us"],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.groupParticipantsLid).toBe(1);
      const lidLead = mockDb.leads.find((l) => l.telefone === "18293847561029384756");
      expect(lidLead).toBeUndefined();
    });

    it("[TESTE OBRIGATÓRIO] o número do próprio chip não entra", async () => {
      await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "geracao-digital",
          instanceName: "GD Grupos",
          sources: ["grupos"],
          groupIds: ["120363000001@g.us"],
        }),
      });
      const ownLead = mockDb.leads.find((l) => l.telefone === "5511999998888");
      expect(ownLead).toBeUndefined();
    });

    it("[TESTE OBRIGATÓRIO] mesmo telefone em dois grupos vira um lead só", async () => {
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "geracao-digital",
          instanceName: "GD Grupos",
          sources: ["grupos"],
          groupIds: ["120363000001@g.us", "120363000002@g.us"],
        }),
      });
      const data = await res.json();
      const dupPhoneLeads = mockDb.leads.filter((l) => l.telefone === "5511988886666");
      expect(dupPhoneLeads).toHaveLength(1);
      // 5511988887777 (grupo A) + 5511988886666 (A e B, deduplicado) + 5511977776655 (B) = 3
      expect(data.fromGroups).toBe(3);
    });

    it("[TESTE OBRIGATÓRIO] nenhuma mensagem de grupo é lida ou gravada em lead_messages por este caminho", async () => {
      await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "geracao-digital",
          instanceName: "GD Grupos",
          sources: ["grupos"],
          groupIds: ["120363000001@g.us", "120363000002@g.us"],
        }),
      });
      expect(fetchCalls.some((u) => u.includes("/chat/findMessages/"))).toBe(false);
      expect(fetchCalls.some((u) => u.includes("/chat/findChats/"))).toBe(false);
      const lmCalls = mockDb.query.mock.calls.filter(([sql]) => sql.includes("lead_messages"));
      expect(lmCalls).toHaveLength(0);
    });

    it("[TESTE OBRIGATÓRIO] lead criado sai com origem: 'WhatsApp Grupo' e temperatura cold", async () => {
      await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "geracao-digital",
          instanceName: "GD Grupos",
          sources: ["grupos"],
          groupIds: ["120363000001@g.us"],
        }),
      });
      const lead = mockDb.leads.find((l) => l.telefone === "5511988887777");
      expect(lead).toBeDefined();
      expect(lead.temperature).toBe("cold");
      expect(lead.dados.origem).toBe("WhatsApp Grupo");
      expect(lead.dados.grupo_nome).toBe("Clientes VIP");
      expect(lead.tags).toContain("Clientes VIP");
      // nome veio do mapa de findContacts
      expect(lead.nome).toBe("Fernanda VIP");
    });

    it("sem nome no findContacts, o nome fica sendo o telefone", async () => {
      await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "geracao-digital",
          instanceName: "GD Grupos",
          sources: ["grupos"],
          groupIds: ["120363000002@g.us"],
        }),
      });
      const lead = mockDb.leads.find((l) => l.telefone === "5511977776655");
      expect(lead).toBeDefined();
      expect(lead.nome).toBe("+5511977776655");
    });

    it("só entram membros dos grupos escolhidos — grupo não selecionado fica de fora", async () => {
      await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "geracao-digital",
          instanceName: "GD Grupos",
          sources: ["grupos"],
          groupIds: ["120363000001@g.us"],
        }),
      });
      const naoSelecionado = mockDb.leads.find((l) => l.telefone === "5511900000000");
      expect(naoSelecionado).toBeUndefined();
    });

    it("groupIds vazio com 'grupos' em sources não chama fetchAllGroups nem grava nada", async () => {
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "geracao-digital", instanceName: "GD Grupos", sources: ["grupos"], groupIds: [] }),
      });
      const data = await res.json();
      expect(data.fromGroups).toBe(0);
      expect(fetchCalls.some((u) => u.includes("/group/fetchAllGroups/"))).toBe(false);
    });
  });

  describe("Evolution API moderna (LID + phoneNumber real e pushName)", () => {
    it("[TESTE OBRIGATÓRIO 1 - PRÉVIA] participante com id @lid E phoneNumber real entra como aproveitável (usableCount: 1, lidCount: 0)", async () => {
      groupsPayloadOverride = [
        {
          id: "120363000099@g.us",
          subject: "Grupo VIP Evolution",
          participants: [
            {
              id: "1829384756@lid",
              phoneNumber: "5511988887777@s.whatsapp.net",
              pushName: "Marcos Cliente",
            },
          ],
        },
      ];
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-groups/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "geracao-digital", instanceName: "GD Grupos" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
      const grp = data.groups.find((g) => g.id === "120363000099@g.us");
      expect(grp).toBeDefined();
      expect(grp.usableCount).toBe(1);
      expect(grp.lidCount).toBe(0);
      expect(grp.totalMembers).toBe(1);
    });

    it("[TESTE OBRIGATÓRIO 1 - EXTRAÇÃO] extrai com telefone 5511988887777 e nome Marcos Cliente", async () => {
      groupsPayloadOverride = [
        {
          id: "120363000099@g.us",
          subject: "Grupo VIP Evolution",
          participants: [
            {
              id: "1829384756@lid",
              phoneNumber: "5511988887777@s.whatsapp.net",
              pushName: "Marcos Cliente",
            },
          ],
        },
      ];
      const res = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "geracao-digital",
          instanceName: "GD Grupos",
          sources: ["grupos"],
          groupIds: ["120363000099@g.us"],
        }),
      });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.fromGroups).toBe(1);
      expect(data.groupParticipantsLid).toBe(0);

      const lead = mockDb.leads.find((l) => l.telefone === "5511988887777");
      expect(lead).toBeDefined();
      expect(lead.phone).toBe("5511988887777");
      expect(lead.nome).toBe("Marcos Cliente");
      expect(lead.stage).toBe("cold");
      expect(lead.temperature).toBe("cold");
      expect(lead.dados.origem).toBe("WhatsApp Grupo");
      expect(lead.dados.grupo_nome).toBe("Grupo VIP Evolution");
    });

    it("[TESTE OBRIGATÓRIO 2] participante que só tem id @lid (sem phoneNumber) cai em lidCount: 1 e não vira lead", async () => {
      groupsPayloadOverride = [
        {
          id: "120363000099@g.us",
          subject: "Grupo VIP Evolution",
          participants: [
            { id: "1829384756@lid" },
          ],
        },
      ];

      // Prévia
      const prevRes = await fetch(`${baseUrl}/api/leads/extract-wa-groups/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "geracao-digital", instanceName: "GD Grupos" }),
      });
      const prevData = await prevRes.json();
      const grp = prevData.groups.find((g) => g.id === "120363000099@g.us");
      expect(grp.usableCount).toBe(0);
      expect(grp.lidCount).toBe(1);

      // Extração
      const extRes = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "geracao-digital",
          instanceName: "GD Grupos",
          sources: ["grupos"],
          groupIds: ["120363000099@g.us"],
        }),
      });
      const extData = await extRes.json();
      expect(extData.fromGroups).toBe(0);
      expect(extData.groupParticipantsLid).toBe(1);
      expect(mockDb.leads).toHaveLength(0);
    });

    it("[TESTE OBRIGATÓRIO 3] mantém a exclusão do próprio chip (ownerDigits) mesmo com LID no id", async () => {
      groupsPayloadOverride = [
        {
          id: "120363000099@g.us",
          subject: "Grupo VIP Evolution",
          participants: [
            {
              id: "1829384756@lid",
              phoneNumber: "5511999998888@s.whatsapp.net",
              pushName: "Meu Próprio Chip",
            },
          ],
        },
      ];

      // Prévia: self não conta nem como usableCount nem como lidCount
      const prevRes = await fetch(`${baseUrl}/api/leads/extract-wa-groups/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "geracao-digital", instanceName: "GD Grupos" }),
      });
      const prevData = await prevRes.json();
      const grp = prevData.groups.find((g) => g.id === "120363000099@g.us");
      expect(grp.usableCount).toBe(0);
      expect(grp.lidCount).toBe(0);

      // Extração: não vira lead
      const extRes = await fetch(`${baseUrl}/api/leads/extract-wa-contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "geracao-digital",
          instanceName: "GD Grupos",
          sources: ["grupos"],
          groupIds: ["120363000099@g.us"],
        }),
      });
      const extData = await extRes.json();
      expect(extData.fromGroups).toBe(0);
      expect(mockDb.leads.find((l) => l.telefone === "5511999998888")).toBeUndefined();
    });

    it("classifyGroupParticipantObject avalia candidatos e prioriza phoneNumber e pushName", () => {
      const owner = "5511999998888";

      // 1. Participante Evolution com LID e phoneNumber
      const res1 = classifyGroupParticipantObject(
        {
          id: "1829384756@lid",
          phoneNumber: "5511988887777@s.whatsapp.net",
          pushName: "Marcos Cliente",
        },
        owner
      );
      expect(res1).toEqual({ kind: "valid", digits: "5511988887777", name: "Marcos Cliente" });

      // 2. Fallback para name e notify
      const res2 = classifyGroupParticipantObject(
        {
          id: "1829384756@lid",
          phoneNumber: "5511977776666@s.whatsapp.net",
          name: "Nome Alternativo",
        },
        owner
      );
      expect(res2).toEqual({ kind: "valid", digits: "5511977776666", name: "Nome Alternativo" });

      const res3 = classifyGroupParticipantObject(
        {
          id: "1829384756@lid",
          phone: "5511966665555",
          notify: "Notify User",
        },
        owner
      );
      expect(res3).toEqual({ kind: "valid", digits: "5511966665555", name: "Notify User" });

      // 3. Somente LID
      const resLid = classifyGroupParticipantObject({ id: "1829384756@lid" }, owner);
      expect(resLid).toEqual({ kind: "lid" });

      // 4. Próprio chip
      const resSelf = classifyGroupParticipantObject(
        { id: "1829384756@lid", phoneNumber: "5511999998888@s.whatsapp.net" },
        owner
      );
      expect(resSelf).toEqual({ kind: "self" });

      // 5. Compatibilidade com strings
      expect(classifyGroupParticipantObject("5511988887777@s.whatsapp.net", owner)).toEqual({
        kind: "valid",
        digits: "5511988887777",
        name: null,
      });
      expect(classifyGroupParticipantObject("1829384756@lid", owner)).toEqual({ kind: "lid" });
      expect(classifyGroupParticipant("5511988887777@s.whatsapp.net", owner)).toEqual({
        kind: "valid",
        digits: "5511988887777",
        name: null,
      });
    });
  });
});

