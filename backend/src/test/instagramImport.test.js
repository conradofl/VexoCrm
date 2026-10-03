// backend/src/test/instagramImport.test.js
//
// Extração de contatos de exportação do Instagram — o arquivo nunca sobe
// pro servidor, esta rota só recebe nome/telefone/resumo já extraídos no
// navegador. Com telefone válido vira lead (lead_temperature MORNO,
// deliberado). Sem telefone, ou com telefone que não passa na validação,
// vai pra contacts_without_channel — nunca telefone inventado (proibido
// reaproveitar o caminho 5500 de import-csv).

import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function createMockDb() {
  const leads = [];
  const contactsWithoutChannel = [];

  const pool = {
    leads,
    contactsWithoutChannel,
    query: vi.fn(async (sql, params = []) => {
      const text = sql.trim();

      // upsertLeadByPhone: busca existente
      if (text.includes("SELECT") && text.includes("FROM public.leads") && text.includes("WHERE client_id = $1")) {
        return { rows: [] };
      }
      // upsertLeadByPhone: insert
      if (text.startsWith("INSERT INTO public.leads")) {
        const colsMatch = text.match(/\(([^)]+)\)/);
        const colNames = colsMatch ? colsMatch[1].split(",").map((c) => c.trim().replace(/"/g, "")) : [];
        const row = { id: `lead-${leads.length + 1}` };
        colNames.forEach((col, idx) => {
          let val = params[idx];
          if (col === "dados" && typeof val === "string") {
            try { val = JSON.parse(val); } catch {}
          }
          row[col] = val;
        });
        leads.push(row);
        return { rows: [row] };
      }

      // contacts_without_channel: upsert (INSERT ... ON CONFLICT). O mock só
      // mescla se o SQL de verdade tiver ON CONFLICT — senão insere sempre,
      // igual o Postgres faria com a constraint ausente. Sem isso, mutar a
      // query pra tirar o ON CONFLICT não quebraria o teste de dedup: o
      // mock estaria testando a si mesmo, não a query.
      if (text.startsWith("INSERT INTO public.contacts_without_channel")) {
        const [clientId, nome, perfil, resumo] = params;
        const hasOnConflict = text.includes("ON CONFLICT");
        const existing = hasOnConflict
          ? contactsWithoutChannel.find((c) => c.client_id === clientId && c.perfil === perfil)
          : null;
        if (existing) {
          existing.nome = nome;
          existing.resumo = resumo;
        } else {
          contactsWithoutChannel.push({
            id: `cwc-${contactsWithoutChannel.length + 1}`,
            client_id: clientId,
            nome,
            perfil,
            resumo,
            origem: "Instagram Direct",
            asked_whatsapp_at: null,
            became_lead_at: null,
            created_at: new Date().toISOString(),
          });
        }
        return { rows: [] };
      }

      // contacts_without_channel: listagem
      if (text.includes("SELECT") && text.includes("FROM public.contacts_without_channel") && text.includes("WHERE client_id = $1")) {
        const clientId = params[0];
        return { rows: contactsWithoutChannel.filter((c) => c.client_id === clientId) };
      }

      // contacts_without_channel: PATCH
      if (text.startsWith("UPDATE public.contacts_without_channel")) {
        const columnMatch = text.match(/SET (\w+) = \$1/);
        const column = columnMatch ? columnMatch[1] : null;
        const [value, id, clientId] = params;
        const target = contactsWithoutChannel.find((c) => c.id === id && c.client_id === clientId);
        if (target && column) {
          target[column] = value;
          return { rowCount: 1 };
        }
        return { rowCount: 0 };
      }

      return { rows: [], rowCount: 0 };
    }),
  };

  return pool;
}

describe("Extração de contatos do Instagram", () => {
  let server;
  let baseUrl;
  let mockDb;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mockDb = createMockDb();

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
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    mockDb.leads.length = 0;
    mockDb.contactsWithoutChannel.length = 0;
  });

  it("[TESTE OBRIGATÓRIO] com telefone vira lead; sem telefone e com telefone inválido vão para contacts_without_channel", async () => {
    const res = await fetch(`${baseUrl}/api/leads/import-instagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "geracao-digital",
        contacts: [
          { name: "Fernanda Comprou", perfil: "fernanda.ig", phone: "5511988887777", resumo: "Oi, vocês entregam?" },
          { name: "Bruno Sem Fone", perfil: "bruno.ig", phone: null, resumo: "Quanto custa?" },
          { name: "Carla Fone Invalido", perfil: "carla.ig", phone: "123", resumo: "Tem em azul?" },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.leadsCreated).toBe(1);
    expect(data.contactsWithoutChannelCreated).toBe(2);

    const lead = mockDb.leads.find((l) => l.telefone === "5511988887777");
    expect(lead).toBeDefined();
    expect(lead.dados.origem).toBe("Instagram Direct");
    expect(lead.lead_temperature).toBe("MORNO");

    const semFone = mockDb.contactsWithoutChannel.find((c) => c.perfil === "bruno.ig");
    expect(semFone).toBeDefined();
    expect(mockDb.leads.find((l) => l.nome === "Bruno Sem Fone")).toBeUndefined();

    const foneInvalido = mockDb.contactsWithoutChannel.find((c) => c.perfil === "carla.ig");
    expect(foneInvalido).toBeDefined();
    expect(mockDb.leads.find((l) => l.nome === "Carla Fone Invalido")).toBeUndefined();
  });

  it("[TESTE OBRIGATÓRIO] o importador de Instagram continua marcando Instagram — com a assinatura própria, que a correção de origem usa para não tocá-lo", async () => {
    await fetch(`${baseUrl}/api/leads/import-instagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "geracao-digital",
        contacts: [{ name: "Fernanda", perfil: "fernanda.ig", phone: "5511988887777", resumo: "Oi" }],
      }),
    });

    const lead = mockDb.leads.find((l) => l.telefone === "5511988887777" || l.phone === "5511988887777");
    expect(lead.dados.origem).toBe("Instagram Direct");
    expect(lead.dados.lead_source_bruto).toBe("Instagram Direct");
    expect(lead.dados.origem_marketing).toBe("instagram_export");
    expect(lead.lead_source).toBe("instagram_export");
    expect(mockDb.leads).toHaveLength(1);
  });

  it("[TESTE OBRIGATÓRIO] nenhum telefone gerado começa com 5500 — telefone inválido é descartado, não inventado", async () => {
    await fetch(`${baseUrl}/api/leads/import-instagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: "geracao-digital",
        contacts: [
          { name: "Sem Fone Nenhum", perfil: "semfone.ig", phone: null, resumo: "oi" },
          { name: "Fone Ruim", perfil: "foneruim.ig", phone: "abc", resumo: "oi" },
        ],
      }),
    });

    const algumComPrefixo5500 = mockDb.leads.some((l) => String(l.telefone || "").startsWith("5500"));
    expect(algumComPrefixo5500).toBe(false);
    expect(mockDb.leads).toHaveLength(0);
  });

  it("mesmo perfil, mesmo client_id — reimportar atualiza em vez de duplicar", async () => {
    const body = {
      clientId: "geracao-digital",
      contacts: [{ name: "Dener V1", perfil: "dener.ig", phone: null, resumo: "primeira" }],
    };
    await fetch(`${baseUrl}/api/leads/import-instagram`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    await fetch(`${baseUrl}/api/leads/import-instagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: "geracao-digital", contacts: [{ name: "Dener V2", perfil: "dener.ig", phone: null, resumo: "segunda" }] }),
    });

    const matches = mockDb.contactsWithoutChannel.filter((c) => c.perfil === "dener.ig");
    expect(matches).toHaveLength(1);
    expect(matches[0].nome).toBe("Dener V2");
  });

  it("[TESTE OBRIGATÓRIO] contato sem canal não aparece na tabela leads nem em nenhuma contagem de leads", async () => {
    await fetch(`${baseUrl}/api/leads/import-instagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: "geracao-digital", contacts: [{ name: "Isolado", perfil: "isolado.ig", phone: null, resumo: "oi" }] }),
    });

    expect(mockDb.leads).toHaveLength(0);
    const listRes = await fetch(`${baseUrl}/api/contacts-without-channel?clientId=geracao-digital`);
    const listData = await listRes.json();
    expect(listData.contacts).toHaveLength(1);
    expect(listData.contacts[0].perfil).toBe("isolado.ig");
  });

  it("GET /api/contacts-without-channel lista com nome, resumo e datas de marcação", async () => {
    await fetch(`${baseUrl}/api/leads/import-instagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: "geracao-digital", contacts: [{ name: "Listado", perfil: "listado.ig", phone: null, resumo: "o que a pessoa perguntou" }] }),
    });

    const res = await fetch(`${baseUrl}/api/contacts-without-channel?clientId=geracao-digital`);
    const data = await res.json();
    expect(data.contacts[0]).toMatchObject({
      nome: "Listado",
      perfil: "listado.ig",
      resumo: "o que a pessoa perguntou",
      askedWhatsappAt: null,
      becameLeadAt: null,
    });
  });

  it("PATCH marca 'pedi o whatsapp' com data, e marcar de novo desmarca", async () => {
    await fetch(`${baseUrl}/api/leads/import-instagram`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: "geracao-digital", contacts: [{ name: "Pra Marcar", perfil: "pramarcar.ig", phone: null, resumo: "oi" }] }),
    });
    const contact = mockDb.contactsWithoutChannel[0];

    const markRes = await fetch(`${baseUrl}/api/contacts-without-channel/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: "geracao-digital", field: "asked_whatsapp", value: true }),
    });
    expect(markRes.status).toBe(200);
    expect(contact.asked_whatsapp_at).toBeTruthy();

    await fetch(`${baseUrl}/api/contacts-without-channel/${contact.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: "geracao-digital", field: "asked_whatsapp", value: false }),
    });
    expect(contact.asked_whatsapp_at).toBeNull();
  });

  it("nenhum endpoint de campanhas referencia contacts_without_channel — a lista não entra em seletor nenhum", () => {
    const campaignsSource = fs.readFileSync(path.resolve(__dirname, "../domains/campaigns/routes.js"), "utf-8");
    expect(campaignsSource).not.toContain("contacts_without_channel");
  });
});
