// backend/src/test/leadOriginsRegistry.test.js
//
// shared/leadOrigins.json é a lista do que o sistema grava como origem de um lead, e o painel
// "Atribuição & Origem de Marketing" do Banco é testado contra ela (frontend/src/test/leadChannels.test.ts).
// Este teste garante o outro lado: que a lista É o que o código realmente grava — as origens dinâmicas rodando
// de verdade (import-csv), as estáticas conferidas no código-fonte, e nenhum valor novo escondido fora da lista.

import { describe, expect, it, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import http from "http";
import { registerLeadsRoutes } from "../domains/leads/routes.js";
import { sanitizePhone } from "../services/leadImport.js";
import { normalizeLeadSource } from "../chatbot-ai-engine.js";
import { createMockDb, createMockSupabase } from "./helpers/importCsvHarness.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(__dirname, "..");
const REGISTRY = JSON.parse(readFileSync(resolve(__dirname, "../../../shared/leadOrigins.json"), "utf-8"));
const byId = (id) => REGISTRY.origins.find((o) => o.id === id);
const read = (rel) => readFileSync(join(SRC, rel), "utf-8");

describe("a lista compartilhada é o que o import-csv realmente grava", () => {
  let server;
  let baseUrl;
  let mockDb;
  const clientId = "tenant-registro";

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mockDb = createMockDb();
    registerLeadsRoutes(app, {
      ensureDb: () => true,
      pgDatabasePool: mockDb,
      requireFirebaseAuth: (req, _res, next) => {
        req.authAccess = { isAdmin: true, role: "internal", clientId };
        next();
      },
      requireInternalPageAccess: () => (_req, _res, next) => next(),
      requireAppViewAccess: () => (_req, _res, next) => next(),
      resolveAuthorizedClientId: (_req, _res, cid) => cid || clientId,
      sanitizePhone: (p, ddd) => sanitizePhone(p, ddd),
      sendError: (res, status, code, msg) => res.status(status).json({ error: code, message: msg }),
      normalizeString: (s) => (s ? String(s).trim() : ""),
      supabase: createMockSupabase(),
    });
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    mockDb.leads.length = 0;
  });

  const importar = async ({ row = {}, importTags = [], asClosedSales = false }) => {
    const res = await fetch(`${baseUrl}/api/leads/import-csv`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId,
        importTags,
        asClosedSales,
        rows: [{ Nome: "Ana", Telefone: "34991234567", ...row }],
        columnMapping: [
          { column: "Telefone", target: "telefone" },
          { column: "Nome", target: "nome" },
        ],
      }),
    });
    expect(res.status).toBe(200);
    return mockDb.leads[0];
  };

  const shapeOf = (lead) => ({
    tags: lead.tags,
    dados: { origem: lead.dados.origem, origem_marketing: lead.dados.origem_marketing, lead_source: lead.dados.lead_source },
  });

  it("[TESTE OBRIGATÓRIO] planilha sem canal informado", async () => {
    expect(shapeOf(await importar({ importTags: ["Lista Out/26"] }))).toEqual(byId("planilha_sem_canal").lead);
  });

  it("[TESTE OBRIGATÓRIO] planilha com tag de canal informada na importação", async () => {
    expect(shapeOf(await importar({ importTags: ["Lista X", "Facebook Ads"] }))).toEqual(byId("planilha_com_canal_facebook").lead);
  });

  it("[TESTE OBRIGATÓRIO] planilha com coluna de origem", async () => {
    expect(shapeOf(await importar({ row: { origem: "Indicação" }, importTags: ["Lista X"] }))).toEqual(byId("planilha_coluna_origem_indicacao").lead);
  });

  it("[TESTE OBRIGATÓRIO] planilha de vendas fechadas", async () => {
    const lead = await importar({ importTags: ["Clientes 2025"], asClosedSales: true });
    const registered = byId("vendas_fechadas").lead;
    expect(lead.dados).toMatchObject(registered.dados);
    expect([...lead.tags].sort()).toEqual([...registered.tags].sort());
  });

  it("[TESTE OBRIGATÓRIO] texto avulso (a tela manda importTags ['IA Direct/Chat'] e a origem escolhida como tag da linha)", async () => {
    expect(shapeOf(await importar({ row: { tags: ["WhatsApp"] }, importTags: ["IA Direct/Chat"] }))).toEqual(byId("texto_avulso").lead);
  });

  it("texto avulso com a origem 'Instagram Direct' escolhida pela pessoa", async () => {
    expect(shapeOf(await importar({ row: { tags: ["Instagram Direct"] }, importTags: ["IA Direct/Chat"] }))).toEqual(byId("texto_avulso_origem_escolhida_instagram").lead);
  });
});

describe("a lista compartilhada é o que o normalizador do chatbot realmente devolve", () => {
  it("[TESTE OBRIGATÓRIO] cada valor canônico do chatbot está na lista, e o normalizador produz exatamente esses valores", () => {
    const produced = {
      organico: normalizeLeadSource("Instagram"),
      trafego_pago: normalizeLeadSource("Google Ads"),
      whatsapp_ads: normalizeLeadSource("click to whatsapp"),
      indicacao: normalizeLeadSource("indicação"),
    };

    for (const [value, got] of Object.entries(produced)) expect(got).toBe(value);
    for (const value of Object.keys(produced)) {
      expect(REGISTRY.origins.some((o) => o.lead.lead_source === value), `'${value}' não está na lista`).toBe(true);
    }
    // valor que o sistema não sabe classificar vira 'outro' — e 'outro' está na lista, com motivo
    expect(normalizeLeadSource("xyzzy-nunca-visto")).toBe("outro");
    expect(byId("chatbot_outro").reason).toBeTruthy();
  });
});

describe("as origens estáticas estão no código que a lista diz", () => {
  const has = (file, snippet) => expect(read(file), `${file} não contém ${snippet}`).toContain(snippet);

  it("[TESTE OBRIGATÓRIO] extração de WhatsApp (conversas, agenda e grupos) e inbound", () => {
    const leads = "domains/leads/routes.js";
    has(leads, 'origem: "WhatsApp Extração"');
    has(leads, 'origem: "WhatsApp Agenda"');
    has(leads, 'origem: "WhatsApp Grupo"');
    has(leads, 'tags: ["agenda-whatsapp"]');
    expect((read(leads).match(/origem_marketing: "extracao_whatsapp"/g) || []).length).toBe(3);
    expect((read(leads).match(/lead_source: "extracao_whatsapp"/g) || []).length).toBe(2); // conversas e agenda; grupo não grava a coluna
    // os dois lugares que cadastram lead a partir do WhatsApp gravam 'inbound' (nenhum pode mudar sem a lista saber)
    expect((read("domains/chatbot/routes.js").match(/const leadSource = "inbound";/g) || []).length).toBe(2);
    expect(byId("whatsapp_extracao_grupo").lead.lead_source).toBeUndefined();
  });

  it("[TESTE OBRIGATÓRIO] Instagram (importador) e campanha", () => {
    has("domains/leads/routes.js", 'lead_source: "instagram_export"');
    has("domains/leads/routes.js", 'origem_marketing: "instagram_export"');
    for (const file of ["domains/chatbot/routes.js", "domains/leads/routes.js", "domains/campaigns/routes.js"]) has(file, 'lead_source: "campanha"');
  });
});

describe("nenhuma origem nova pode aparecer sem entrar na lista (e, portanto, sem o painel aprender a lê-la)", () => {
  const walk = (dir) =>
    readdirSync(dir).flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return name === "test" || name === "scripts" ? [] : walk(full);
      return full.endsWith(".js") ? [full] : [];
    });

  // todo valor que a lista conhece, em qualquer um dos campos que o painel lê
  const known = new Set(
    REGISTRY.origins.flatMap((o) => [o.lead.lead_source, o.lead.dados?.origem, o.lead.dados?.origem_marketing, o.lead.dados?.lead_source]).filter(Boolean)
  );

  it("[TESTE OBRIGATÓRIO] todo valor literal gravado em lead_source / origem_marketing / origem (no código) está na lista", () => {
    const found = [];
    const re = /\b(lead_source|origem_marketing|origem)\s*:\s*"([^"]+)"/g;
    for (const file of walk(SRC)) {
      const text = readFileSync(file, "utf-8");
      const isLeadWriter = /domains\/(leads|chatbot|campaigns)\/routes\.js$/.test(file) || /services\/importOrigin\.js$/.test(file);
      for (const m of text.matchAll(re)) {
        if (m[1] === "origem" && !isLeadWriter) continue; // `origem` só é origem de lead nos arquivos que gravam lead
        found.push({ file: file.replace(SRC + "/", ""), field: m[1], value: m[2] });
      }
    }

    expect(found.length).toBeGreaterThan(5); // o regex achou o que devia
    const desconhecidos = found.filter((f) => !known.has(f.value));
    expect(desconhecidos, `valor gravado que o painel não conhece: ${JSON.stringify(desconhecidos)}`).toEqual([]);
  });

  it("os valores das constantes do importador estão na lista", async () => {
    const m = await import("../services/importOrigin.js");
    for (const v of [m.IMPORT_ORIGIN_LABEL, m.IMPORT_ORIGIN_KEY, m.CLOSED_SALES_ORIGIN_LABEL, m.CLOSED_SALES_ORIGIN_KEY]) {
      expect(known.has(v), `'${v}' fora da lista`).toBe(true);
    }
  });
});
