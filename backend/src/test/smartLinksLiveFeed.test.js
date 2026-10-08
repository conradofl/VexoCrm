// backend/src/test/smartLinksLiveFeed.test.js
// Suíte de testes para o Endpoint de Live Feed e Alertas de Cliques para SDR (Etapa 2)
// Testa: Multi-tenant rigoroso, join de leads/campanhas, polling incremental via 'since',
// formatação de alerta para WhatsApp e disparo seguro para o SDR.

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import { registerSmartLinksRoutes } from "../domains/smartLinks/routes.js";
import { createSmartLink, recordLinkClick } from "../services/smartLinks.js";
import {
  formatClickTime,
  formatDeviceLabel,
  formatSdrClickAlert,
  notifySdrOnLinkClick,
} from "../services/smartLinkAlerts.js";

const TENANT_A = "tenant-a";
const TENANT_B = "tenant-b";

describe("Módulo Vexo Smart Links - Etapa 2 (Live Feed & Alertas SDR)", () => {
  let db;
  let server;
  let baseUrl;
  let leadA1;
  let campA1;
  let linkA1;

  beforeAll(async () => {
    db = await createPgliteDb();

    // 1. Cria esquema completo
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
      CREATE TABLE IF NOT EXISTS public.lead_client_n8n_settings (
        client_id TEXT PRIMARY KEY REFERENCES public.leads_clients(id),
        sdr_whatsapp_number TEXT,
        sdr_whatsapp_numbers JSONB,
        dispatch_webhook_url TEXT,
        dispatch_webhook_token TEXT
      );
      CREATE TABLE IF NOT EXISTS public.lead_client_evolution_instances (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        client_id TEXT NOT NULL REFERENCES public.leads_clients(id),
        name TEXT,
        dispatch_webhook_url TEXT,
        dispatch_webhook_token TEXT,
        active BOOLEAN DEFAULT true,
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT now()
      );
    `);

    // Inserir os dois tenants para validação multi-tenant
    await db.exec(`
      INSERT INTO public.leads_clients (id, name) VALUES ('${TENANT_A}', 'Empresa A');
      INSERT INTO public.leads_clients (id, name) VALUES ('${TENANT_B}', 'Empresa B');
    `);

    // 2. Executa a migration real 20261008120000_create_smart_links.sql
    const migrationSql = readFileSync(
      resolve("supabase/migrations/20261008120000_create_smart_links.sql"),
      "utf8"
    );
    await db.exec(migrationSql);

    // 3. Cadastra dados de teste para Tenant A e Tenant B
    const { rows: cRows } = await db.query(
      `INSERT INTO public.campaigns (client_id, name) VALUES ($1, $2) RETURNING id`,
      [TENANT_A, "Campanha Black Friday"]
    );
    campA1 = cRows[0].id;

    const { rows: lRows } = await db.query(
      `INSERT INTO public.leads (client_id, nome, telefone, stage) VALUES ($1, $2, $3, $4) RETURNING id`,
      [TENANT_A, "Carlos Oliveira", "5511999998888", "proposta_enviada"]
    );
    leadA1 = lRows[0].id;

    // Smart links
    linkA1 = await createSmartLink(db, {
      clientId: TENANT_A,
      destinationUrl: "https://oferta.empresa-a.com/prop-carlos",
      title: "Proposta Personalizada",
      campaignId: campA1,
      leadId: leadA1,
    });

    const linkB = await createSmartLink(db, {
      clientId: TENANT_B,
      destinationUrl: "https://empresa-b.com/checkout",
      title: "Checkout B",
    });

    // Inserir cliques para Tenant A e Tenant B
    await recordLinkClick(db, {
      link: linkA1,
      req: {
        headers: {
          "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5)",
          "x-forwarded-for": "177.10.20.30",
        },
      },
    });

    await recordLinkClick(db, {
      link: linkB,
      req: {
        headers: {
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          "x-real-ip": "200.50.60.70",
        },
      },
    });

    // 4. Inicializa rotas no Express
    const app = express();
    app.use(express.json());

    registerSmartLinksRoutes(app, {
      pgDatabasePool: db,
      resolveAuthorizedClientId: (_req, res, requestedClientId) => {
        if (requestedClientId === "forbidden-tenant") {
          res.status(403).json({ error: "FORBIDDEN" });
          return null;
        }
        return requestedClientId || TENANT_A;
      },
    });

    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise((r) => server.close(r));
    if (db) await db.close();
  });

  describe("1. Endpoint GET /api/smart-links/live-feed", () => {
    it("isola os cliques estritamente pelo client_id (Tenant A nunca vê cliques do Tenant B)", async () => {
      const resA = await fetch(`${baseUrl}/api/smart-links/live-feed?clientId=${TENANT_A}`);
      expect(resA.status).toBe(200);
      const dataA = await resA.json();

      expect(dataA.clicks).toBeInstanceOf(Array);
      expect(dataA.clicks.length).toBeGreaterThanOrEqual(1);

      // Todos os cliques devem pertencer aos links do Tenant A
      for (const click of dataA.clicks) {
        expect(click.code).toBe(linkA1.code);
        expect(click.link_title).toBe("Proposta Personalizada");
        expect(click.lead_nome).toBe("Carlos Oliveira");
        expect(click.lead_telefone).toBe("5511999998888");
        expect(click.lead_stage).toBe("proposta_enviada");
        expect(click.campaign_name).toBe("Campanha Black Friday");
      }

      // Agora consulta como Tenant B
      const resB = await fetch(`${baseUrl}/api/smart-links/live-feed?clientId=${TENANT_B}`);
      expect(resB.status).toBe(200);
      const dataB = await resB.json();

      expect(dataB.clicks.length).toBeGreaterThanOrEqual(1);
      for (const click of dataB.clicks) {
        expect(click.link_title).toBe("Checkout B");
        expect(click.lead_nome).toBeNull();
      }
    });

    it("respeita o filtro incremental 'since' (retorna apenas cliques posteriores)", async () => {
      const pastTime = new Date(Date.now() + 10_000).toISOString();
      const res = await fetch(`${baseUrl}/api/smart-links/live-feed?clientId=${TENANT_A}&since=${encodeURIComponent(pastTime)}`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.clicks).toHaveLength(0);
    });

    it("respeita o parâmetro limit", async () => {
      // Cria mais 3 cliques no link A1
      for (let i = 0; i < 3; i++) {
        await recordLinkClick(db, {
          link: linkA1,
          req: { headers: { "user-agent": "Desktop" } },
        });
      }

      const res = await fetch(`${baseUrl}/api/smart-links/live-feed?clientId=${TENANT_A}&limit=2`);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.clicks).toHaveLength(2);
    });

    it("bloqueia acesso caso resolveAuthorizedClientId rejeite o tenant", async () => {
      const res = await fetch(`${baseUrl}/api/smart-links/live-feed?clientId=forbidden-tenant`);
      expect(res.status).toBe(403);
    });
  });

  describe("2. Formatação e Helpers de Alerta SDR (smartLinkAlerts.js)", () => {
    it("formatDeviceLabel retorna rótulo e ícone apropriados", () => {
      expect(formatDeviceLabel("mobile")).toBe("📱 Celular");
      expect(formatDeviceLabel("tablet")).toBe("📱 Tablet");
      expect(formatDeviceLabel("desktop")).toBe("💻 Desktop");
      expect(formatDeviceLabel("outro")).toBe("🌐 Web");
    });

    it("formatClickTime formata data no padrão brasileiro com segurança", () => {
      const formatted = formatClickTime("2026-10-08T15:30:00Z");
      expect(formatted).toMatch(/\d{2}\/\d{2}\/\d{4}/);
      expect(formatted).toMatch(/\d{2}:\d{2}/);
    });

    it("formatSdrClickAlert monta mensagem completa com todos os campos exigidos", () => {
      const msg = formatSdrClickAlert({
        link: { title: "Proposta Vexo IA", code: "abc123" },
        click: { device_type: "mobile", clicked_at: new Date() },
        lead: { nome: "Marina Silva", telefone: "5534999990000" },
        campaign: { name: "Prospecção Ativa" },
      });

      expect(msg).toContain("🔔 *Alerta Vexo — Lead Clicou no Link!*");
      expect(msg).toContain("*Lead:* Marina Silva (5534999990000)");
      expect(msg).toContain("*Link:* Proposta Vexo IA");
      expect(msg).toContain("*Campanha:* Prospecção Ativa");
      expect(msg).toContain("*Dispositivo:* 📱 Celular");
      expect(msg).toContain("👉 _Momento de ouro para contato de fechamento!_");
    });
  });

  describe("3. Disparo de Notificação SDR (notifySdrOnLinkClick)", () => {
    it("retorna motivo 'sem_numero_sdr' quando o tenant não possui SDR configurado", async () => {
      const res = await notifySdrOnLinkClick(db, {
        link: linkA1,
        click: { device_type: "mobile" },
      });
      expect(res.sent).toBe(false);
      expect(res.reason).toBe("sem_numero_sdr");
    });

    it("retorna motivo 'sem_webhook_evolution' se houver número de SDR mas nenhum webhook Evolution", async () => {
      await db.query(
        `INSERT INTO public.lead_client_n8n_settings (client_id, sdr_whatsapp_number)
         VALUES ($1, $2)
         ON CONFLICT (client_id) DO UPDATE SET sdr_whatsapp_number = $2`,
        [TENANT_A, "5534988887777"]
      );

      const res = await notifySdrOnLinkClick(db, {
        link: linkA1,
        click: { device_type: "mobile" },
      });

      expect(res.sent).toBe(false);
      expect(res.reason).toBe("sem_webhook_evolution");
      expect(res.sdrNumbers).toContain("5534988887777");
    });

    it("dispara notificação via webhook com sucesso quando número de SDR e webhook estão configurados", async () => {
      // Mock do fetch global para interceptar envio WhatsApp
      const originalFetch = global.fetch;
      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ message: "sent" }),
      });
      global.fetch = fetchSpy;

      try {
        await db.query(
          `UPDATE public.lead_client_n8n_settings
           SET dispatch_webhook_url = 'https://evolution.crm.vexoia.com/message/sendText/inst-sdr',
               dispatch_webhook_token = 'token-evo-123'
           WHERE client_id = $1`,
          [TENANT_A]
        );

        const res = await notifySdrOnLinkClick(db, {
          link: linkA1,
          click: { device_type: "mobile", clicked_at: new Date() },
          lead: { nome: "Carlos Oliveira", telefone: "5511999998888" },
        });

        expect(res.sent).toBe(true);
        expect(res.sentCount).toBe(1);
        expect(res.sdrNumbers).toEqual(["5534988887777"]);
        expect(res.message).toContain("Carlos Oliveira");

        // Verifica os parâmetros chamados no fetch do Evolution
        expect(fetchSpy).toHaveBeenCalledWith(
          "https://evolution.crm.vexoia.com/message/sendText/inst-sdr",
          expect.objectContaining({
            method: "POST",
            headers: expect.objectContaining({
              "Content-Type": "application/json",
              apikey: "token-evo-123",
            }),
            body: expect.stringContaining("5534988887777"),
          })
        );
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
