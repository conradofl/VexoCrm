// backend/src/test/smartLinksMetrics.test.js
// Suíte de testes para o Endpoint de Métricas Analíticas e Auto-Encurtamento em Campanhas (Etapa 3)
// Testa: Multi-tenant rigoroso, cálculo de CTR, totalLinks, totalClicks, clicksLast24h,
// ranking dos topLeads, filtros de campaignId e periodDays, e auto-encurtamento em disparos.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { registerSmartLinksRoutes } from "../domains/smartLinks/routes.js";
import { createSmartLink, recordLinkClick } from "../services/smartLinks.js";
import { prepareCampaignStepText } from "../campaign/dispatch.js";

const TENANT_A = "tenant-metrics-a";
const TENANT_B = "tenant-metrics-b";

describe("Módulo Vexo Smart Links - Etapa 3 (Métricas Analíticas & Auto-Encurtamento)", () => {
  let db;
  let server;
  let baseUrl;
  let leadA1;
  let leadA2;
  let leadA3;
  let campA1;
  let campA2;
  let linkA1;
  let linkA2;
  let linkA3;
  let linkB1;

  beforeAll(async () => {
    db = await createPgliteDb();

    // 1. Cria esquema
    await db.exec(`
      CREATE TABLE IF NOT EXISTS public.leads_clients (
        id TEXT PRIMARY KEY,
        name TEXT
      );
      CREATE TABLE IF NOT EXISTS public.campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id TEXT NOT NULL REFERENCES public.leads_clients(id),
        name TEXT
      );
      CREATE TABLE IF NOT EXISTS public.leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id TEXT NOT NULL REFERENCES public.leads_clients(id),
        nome TEXT,
        telefone TEXT,
        stage TEXT
      );
    `);

    // Inserir os tenants
    await db.exec(`
      INSERT INTO public.leads_clients (id, name) VALUES ('${TENANT_A}', 'Empresa Métricas A');
      INSERT INTO public.leads_clients (id, name) VALUES ('${TENANT_B}', 'Empresa Métricas B');
    `);

    // 2. Executa a migration real
    const migrationSql = readFileSync(
      resolve("supabase/migrations/20261008120000_create_smart_links.sql"),
      "utf8"
    );
    await db.exec(migrationSql);

    // 3. Cadastra campanhas e leads
    const { rows: cRows1 } = await db.query(
      `INSERT INTO public.campaigns (client_id, name) VALUES ($1, $2) RETURNING id`,
      [TENANT_A, "Campanha Primária"]
    );
    campA1 = cRows1[0].id;

    const { rows: cRows2 } = await db.query(
      `INSERT INTO public.campaigns (client_id, name) VALUES ($1, $2) RETURNING id`,
      [TENANT_A, "Campanha Secundária"]
    );
    campA2 = cRows2[0].id;

    const { rows: lRows1 } = await db.query(
      `INSERT INTO public.leads (client_id, nome, telefone, stage) VALUES ($1, $2, $3, $4) RETURNING id`,
      [TENANT_A, "Lead Mais Quente", "5511999991111", "proposta_enviada"]
    );
    leadA1 = lRows1[0].id;

    const { rows: lRows2 } = await db.query(
      `INSERT INTO public.leads (client_id, nome, telefone, stage) VALUES ($1, $2, $3, $4) RETURNING id`,
      [TENANT_A, "Lead Morno", "5511999992222", "em_atendimento"]
    );
    leadA2 = lRows2[0].id;

    const { rows: lRows3 } = await db.query(
      `INSERT INTO public.leads (client_id, nome, telefone, stage) VALUES ($1, $2, $3, $4) RETURNING id`,
      [TENANT_A, "Lead Frio", "5511999993333", "novo"]
    );
    leadA3 = lRows3[0].id;

    // Links para Tenant A
    linkA1 = await createSmartLink(db, {
      clientId: TENANT_A,
      destinationUrl: "https://vexoia.com/proposta-quente",
      title: "Proposta Quente",
      campaignId: campA1,
      leadId: leadA1,
    });

    linkA2 = await createSmartLink(db, {
      clientId: TENANT_A,
      destinationUrl: "https://vexoia.com/catalogo",
      title: "Catálogo Geral",
      campaignId: campA1,
      leadId: leadA2,
    });

    linkA3 = await createSmartLink(db, {
      clientId: TENANT_A,
      destinationUrl: "https://vexoia.com/promo-secundaria",
      title: "Promo Secundária",
      campaignId: campA2,
      leadId: leadA3,
    });

    // Links para Tenant B
    linkB1 = await createSmartLink(db, {
      clientId: TENANT_B,
      destinationUrl: "https://vexoia.com/tenant-b-link",
      title: "Link Tenant B",
    });

    // Cliques em linkA1: 3 cliques
    await recordLinkClick(db, { link: linkA1, req: { ip: "1.1.1.1", headers: { "user-agent": "iPhone" } } });
    await recordLinkClick(db, { link: linkA1, req: { ip: "1.1.1.1", headers: { "user-agent": "iPhone" } } });
    await recordLinkClick(db, { link: linkA1, req: { ip: "1.1.1.1", headers: { "user-agent": "iPhone" } } });

    // Cliques em linkA2: 1 clique
    await recordLinkClick(db, { link: linkA2, req: { ip: "2.2.2.2", headers: { "user-agent": "Chrome/Mac" } } });

    // linkA3: 0 cliques
    // linkB1: 5 cliques
    for (let i = 0; i < 5; i++) {
      await recordLinkClick(db, { link: linkB1, req: { ip: "9.9.9.9", headers: {} } });
    }

    // 4. Inicia Servidor HTTP de Teste
    const app = express();
    app.use(express.json());

    registerSmartLinksRoutes(app, {
      pgDatabasePool: db,
      resolveAuthorizedClientId: (req, res, targetClientId) => {
        if (!targetClientId) return null;
        if (targetClientId === "unauthorized-tenant") {
          res.status(403).json({ error: "Acesso negado para este cliente" });
          return null;
        }
        return targetClientId;
      },
      requireFirebaseAuth: (_req, _res, next) => next(),
    });

    await new Promise((resolveServer) => {
      server = http.createServer(app);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolveServer();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((res) => server.close(res));
    }
  });

  describe("1. Endpoint GET /api/smart-links/metrics", () => {
    it("bloqueia com 403 se o cliente não for autorizado", async () => {
      const res = await fetch(`${baseUrl}/api/smart-links/metrics?clientId=unauthorized-tenant`);
      expect(res.status).toBe(403);
    });

    it("retorna métricas calculadas corretamente para o Tenant A no período de 30 dias", async () => {
      const res = await fetch(`${baseUrl}/api/smart-links/metrics?clientId=${TENANT_A}&periodDays=30`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data).toHaveProperty("totalLinks", 3); // linkA1, linkA2, linkA3
      expect(data).toHaveProperty("totalClicks", 4); // 3 (A1) + 1 (A2) + 0 (A3)
      expect(data).toHaveProperty("uniqueLeadsClicked", 2); // leadA1 e leadA2
      expect(data).toHaveProperty("ctr", 66.7); // (2 / 3) * 100 = 66.666... -> 66.7
      expect(data).toHaveProperty("clicksLast24h", 4);
      expect(data).toHaveProperty("periodDays", 30);
      expect(Array.isArray(data.topLeads)).toBe(true);
      expect(data.topLeads).toHaveLength(2); // Apenas os que clicaram (clicks_count > 0)

      // Top 1 deve ser o Lead Mais Quente (3 cliques)
      const top1 = data.topLeads[0];
      expect(top1.leadNome).toBe("Lead Mais Quente");
      expect(top1.leadTelefone).toBe("5511999991111");
      expect(top1.clicksCount).toBe(3);
      expect(top1.linkCode).toBe(linkA1.code);
      expect(top1.destinationUrl).toBe("https://vexoia.com/proposta-quente");
      expect(top1.campaignName).toBe("Campanha Primária");

      // Top 2 deve ser o Lead Morno (1 clique)
      const top2 = data.topLeads[1];
      expect(top2.leadNome).toBe("Lead Morno");
      expect(top2.clicksCount).toBe(1);
    });

    it("isola os dados do Tenant B (multi-tenant estrito)", async () => {
      const res = await fetch(`${baseUrl}/api/smart-links/metrics?clientId=${TENANT_B}`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.totalLinks).toBe(1);
      expect(data.totalClicks).toBe(5);
      expect(data.uniqueLeadsClicked).toBe(0); // linkB1 não tinha lead_id associado
      expect(data.ctr).toBe(0);
      expect(data.clicksLast24h).toBe(5);
    });

    it("filtra por campaignId quando especificado", async () => {
      const res = await fetch(
        `${baseUrl}/api/smart-links/metrics?clientId=${TENANT_A}&campaignId=${campA2}`
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.totalLinks).toBe(1); // linkA3
      expect(data.totalClicks).toBe(0);
      expect(data.uniqueLeadsClicked).toBe(0);
      expect(data.ctr).toBe(0);
      expect(data.clicksLast24h).toBe(0);
      expect(data.topLeads).toHaveLength(0);
    });

    it("retorna empty state zerado elegante para tenant sem nenhum link", async () => {
      await db.exec(`INSERT INTO public.leads_clients (id, name) VALUES ('tenant-vazio', 'Vazio');`);
      const res = await fetch(`${baseUrl}/api/smart-links/metrics?clientId=tenant-vazio`);
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.totalLinks).toBe(0);
      expect(data.totalClicks).toBe(0);
      expect(data.uniqueLeadsClicked).toBe(0);
      expect(data.ctr).toBe(0);
      expect(data.clicksLast24h).toBe(0);
      expect(data.topLeads).toEqual([]);
    });
  });

  describe("2. Integração no Disparo de Campanhas (prepareCampaignStepText)", () => {
    it("auto-encurta links crus para links rastreados por lead", async () => {
      const text = "Olá! Acesse sua proposta em https://vexoia.com/proposta-especial e tire suas dúvidas.";
      const wrapped = await prepareCampaignStepText({
        text,
        clientId: TENANT_A,
        leadId: leadA1,
        campaignId: campA1,
        trackLinks: true,
        pool: db,
        baseUrl: "https://crm.vexoia.com",
      });

      expect(wrapped).not.toContain("https://vexoia.com/proposta-especial");
      expect(wrapped).toMatch(/https:\/\/crm\.vexoia\.com\/l\/[A-Za-z0-9]+/);

      // Verifica se o registro foi salvo no banco com o lead_id correto
      const match = wrapped.match(/\/l\/([A-Za-z0-9]+)/);
      const code = match[1];

      const { rows } = await db.query(
        "SELECT * FROM public.smart_links WHERE code = $1",
        [code]
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].client_id).toBe(TENANT_A);
      expect(rows[0].lead_id).toBe(leadA1);
      expect(rows[0].campaign_id).toBe(campA1);
      expect(rows[0].destination_url).toBe("https://vexoia.com/proposta-especial");
    });

    it("não altera mensagem se trackLinks for false", async () => {
      const text = "Acesse https://vexoia.com/sem-rastrear diretamente.";
      const result = await prepareCampaignStepText({
        text,
        clientId: TENANT_A,
        trackLinks: false,
        pool: db,
      });

      expect(result).toBe(text);
    });

    it("preserva texto sem URLs intacto", async () => {
      const text = "Olá Carlos, tudo bem com você?";
      const result = await prepareCampaignStepText({
        text,
        clientId: TENANT_A,
        leadId: leadA1,
        trackLinks: true,
        pool: db,
      });

      expect(result).toBe(text);
    });
  });
});
