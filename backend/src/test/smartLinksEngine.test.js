// backend/src/test/smartLinksEngine.test.js
// Suíte de testes unitários e de integração para o Módulo Vexo Smart Links (Etapa 1)
// Testa: Migração idempotente, sentinela, geração de código, detecção de dispositivo,
// criação de link com tratamento de colisão, registro assíncrono de cliques com telemetria,
// rota pública de redirecionamento 302 (/l/:code e /api/l/:code) e substituição de URLs em mensagens.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import http from "http";
import { readFileSync } from "fs";
import { resolve } from "path";
import { createPgliteDb } from "./helpers/pgliteDb.js";
import {
  SAFE_ALPHABET,
  generateLinkCode,
  detectDeviceType,
  createSmartLink,
  recordLinkClick,
  isVexoShortLink,
  wrapMessageUrlsWithSmartLinks,
} from "../services/smartLinks.js";
import { registerSmartLinksRoutes } from "../domains/smartLinks/routes.js";

const TENANT_ID = "tenant-smart-links-test";

describe("Módulo Vexo Smart Links - Etapa 1", () => {
  let db;
  let server;
  let baseUrl;

  beforeAll(async () => {
    // Banco Postgres real WASM em memória (pglite)
    db = await createPgliteDb();

    // 1. Cria tabelas de pré-requisito para as foreign keys (multi-tenant)
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
        telefone TEXT
      );
    `);

    // Inserir tenant e dados de teste
    await db.exec(`
      INSERT INTO public.leads_clients (id, name) VALUES ('${TENANT_ID}', 'Tenant Smart Links Test');
    `);

    // 2. Executa a migration real 20261008120000_create_smart_links.sql
    const migrationSql = readFileSync(
      resolve("supabase/migrations/20261008120000_create_smart_links.sql"),
      "utf8"
    );
    await db.exec(migrationSql);

    // 3. Inicializa servidor HTTP Express com as rotas reais do domínio
    const app = express();
    app.use(express.json());
    registerSmartLinksRoutes(app, { pgDatabasePool: db });

    server = http.createServer(app);
    await new Promise((r) => server.listen(0, r));
    baseUrl = `http://localhost:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) {
      await new Promise((r) => server.close(r));
    }
    if (db) {
      await db.close();
    }
  });

  describe("1. Migração e Sentinela de Banco de Dados", () => {
    it("arquivo de migration 20261008120000_create_smart_links.sql existe com DDL idempotente", () => {
      const sql = readFileSync(
        resolve("supabase/migrations/20261008120000_create_smart_links.sql"),
        "utf8"
      );
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.smart_links");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.smart_link_clicks");
      expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_smart_links_code");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_smart_links_tenant_lead");
      expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_smart_link_clicks_tenant");
    });

    it("possui sentinela forte em migrate.js checando ambas as tabelas e o índice do slug", () => {
      const migrateSource = readFileSync(resolve("src/migrate.js"), "utf8");
      expect(migrateSource).toContain("20261008120000_create_smart_links.sql");
      expect(migrateSource).toContain("table_name='smart_links'");
      expect(migrateSource).toContain("table_name='smart_link_clicks'");
      expect(migrateSource).toContain("indexname='idx_smart_links_code'");
    });

    it("as tabelas e índices foram criados com sucesso no banco Postgres", async () => {
      const { rows: linksRows } = await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='smart_links'"
      );
      const linkCols = linksRows.map((r) => r.column_name);
      expect(linkCols).toContain("id");
      expect(linkCols).toContain("client_id");
      expect(linkCols).toContain("code");
      expect(linkCols).toContain("destination_url");
      expect(linkCols).toContain("clicks_count");
      expect(linkCols).toContain("first_clicked_at");
      expect(linkCols).toContain("last_clicked_at");

      const { rows: clickRows } = await db.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='smart_link_clicks'"
      );
      const clickCols = clickRows.map((r) => r.column_name);
      expect(clickCols).toContain("link_id");
      expect(clickCols).toContain("device_type");
      expect(clickCols).toContain("ip_address");
      expect(clickCols).toContain("user_agent");
    });
  });

  describe("2. Geração de Código (generateLinkCode)", () => {
    it("gera código com tamanho padrão de 6 caracteres", () => {
      const code = generateLinkCode();
      expect(code).toHaveLength(6);
    });

    it("respeita tamanho customizado", () => {
      const code = generateLinkCode(8);
      expect(code).toHaveLength(8);
    });

    it("utiliza apenas o alfabeto seguro sem caracteres ambíguos (0, O, 1, I, l)", () => {
      const ambiguous = ["0", "O", "1", "I", "l"];
      for (let i = 0; i < 200; i++) {
        const code = generateLinkCode(10);
        for (const char of code) {
          expect(SAFE_ALPHABET).toContain(char);
          expect(ambiguous).not.toContain(char);
        }
      }
    });

    it("gera códigos com alta entropia e sem repetições imediatas", () => {
      const set = new Set();
      for (let i = 0; i < 100; i++) {
        set.add(generateLinkCode(6));
      }
      expect(set.size).toBe(100);
    });
  });

  describe("3. Detecção de Dispositivo (detectDeviceType)", () => {
    it("identifica 'mobile' corretamente para navegadores de smartphones", () => {
      const iphoneUA = "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1";
      const androidMobileUA = "Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Mobile Safari/537.36";
      expect(detectDeviceType(iphoneUA)).toBe("mobile");
      expect(detectDeviceType(androidMobileUA)).toBe("mobile");
    });

    it("identifica 'tablet' para iPads e tablets Android", () => {
      const ipadUA = "Mozilla/5.0 (iPad; CPU OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1";
      const androidTabletUA = "Mozilla/5.0 (Linux; Android 12; SM-T870) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/112.0.0.0 Safari/537.36";
      expect(detectDeviceType(ipadUA)).toBe("tablet");
      expect(detectDeviceType(androidTabletUA)).toBe("tablet");
    });

    it("identifica 'desktop' para sistemas operacionais comuns de computadores", () => {
      const macUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";
      const windowsUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";
      const linuxUA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";
      expect(detectDeviceType(macUA)).toBe("desktop");
      expect(detectDeviceType(windowsUA)).toBe("desktop");
      expect(detectDeviceType(linuxUA)).toBe("desktop");
    });

    it("retorna 'outro' para valores vazios, inválidos ou bots", () => {
      expect(detectDeviceType(null)).toBe("outro");
      expect(detectDeviceType(undefined)).toBe("outro");
      expect(detectDeviceType("")).toBe("outro");
      expect(detectDeviceType("curl/7.88.1")).toBe("outro");
    });
  });

  describe("4. Criação de Smart Links (createSmartLink)", () => {
    it("rejeita criação sem clientId ou sem destinationUrl", async () => {
      await expect(
        createSmartLink(db, { clientId: "", destinationUrl: "https://vexoia.com" })
      ).rejects.toThrow("clientId é obrigatório");

      await expect(
        createSmartLink(db, { clientId: TENANT_ID, destinationUrl: "" })
      ).rejects.toThrow("destinationUrl é obrigatória");
    });

    it("cria um smart link válido e persiste no banco de dados", async () => {
      const link = await createSmartLink(db, {
        clientId: TENANT_ID,
        destinationUrl: "https://minhaempresa.com.br/proposta-comercial-123",
        title: "Proposta Comercial",
      });

      expect(link).toHaveProperty("id");
      expect(link.code).toMatch(/^[23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
      expect(link.url).toBe(`/l/${link.code}`);
      expect(link.shortUrl).toBe(`/l/${link.code}`);
      expect(link.destination_url).toBe("https://minhaempresa.com.br/proposta-comercial-123");
      expect(link.clicks_count).toBe(0);

      // Conferir no banco
      const { rows } = await db.query("SELECT * FROM public.smart_links WHERE id = $1", [link.id]);
      expect(rows).toHaveLength(1);
      expect(rows[0].code).toBe(link.code);
    });

    it("resolve colisões de código tentando um novo slug automaticamente", async () => {
      // 1. Cria um link com código específico
      const existing = await createSmartLink(db, {
        clientId: TENANT_ID,
        destinationUrl: "https://site-a.com",
        code: "slug12",
      });
      expect(existing.code).toBe("slug12");

      // 2. Tenta criar outro link passando o mesmo código 'slug12':
      // O tratamento de colisão deve capturar o erro 23505 e gerar um novo código aleatório com sucesso!
      const resolved = await createSmartLink(db, {
        clientId: TENANT_ID,
        destinationUrl: "https://site-b.com",
        code: "slug12",
      });

      expect(resolved.code).not.toBe("slug12");
      expect(resolved.destination_url).toBe("https://site-b.com");

      // Conferir que ambos existem no banco com URLs distintas
      const { rows } = await db.query(
        "SELECT code, destination_url FROM public.smart_links WHERE code IN ($1, $2)",
        [existing.code, resolved.code]
      );
      expect(rows).toHaveLength(2);
    });
  });

  describe("5. Registro de Cliques e Telemetria (recordLinkClick)", () => {
    it("incrementa contador de cliques e insere linha em smart_link_clicks", async () => {
      const link = await createSmartLink(db, {
        clientId: TENANT_ID,
        destinationUrl: "https://checkout.com/pagamento",
        title: "Checkout Lead",
      });

      const mockReq = {
        headers: {
          "x-forwarded-for": "177.136.240.10, 10.0.0.1",
          "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
          "referer": "https://web.whatsapp.com/",
        },
      };

      // 1º Clique
      const click1 = await recordLinkClick(db, { link, req: mockReq });
      expect(click1).toHaveProperty("id");
      expect(click1.device_type).toBe("mobile");
      expect(click1.ip_address).toBe("177.136.240.10");
      expect(click1.user_agent).toContain("iPhone");
      expect(click1.referrer).toBe("https://web.whatsapp.com/");

      // Verificar contadores no smart_links
      const { rows: linksAfter1 } = await db.query(
        "SELECT clicks_count, first_clicked_at, last_clicked_at FROM public.smart_links WHERE id = $1",
        [link.id]
      );
      expect(linksAfter1[0].clicks_count).toBe(1);
      expect(linksAfter1[0].first_clicked_at).toBeTruthy();
      expect(linksAfter1[0].last_clicked_at).toBeTruthy();
      const firstClickedAt = linksAfter1[0].first_clicked_at;

      // 2º Clique (Desktop)
      const mockReqDesktop = {
        headers: {
          "x-real-ip": "189.100.50.2",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/114.0.0.0 Safari/537.36",
        },
      };
      await recordLinkClick(db, { link, req: mockReqDesktop });

      const { rows: linksAfter2 } = await db.query(
        "SELECT clicks_count, first_clicked_at, last_clicked_at FROM public.smart_links WHERE id = $1",
        [link.id]
      );
      expect(linksAfter2[0].clicks_count).toBe(2);
      // first_clicked_at deve ser mantido
      expect(new Date(linksAfter2[0].first_clicked_at).getTime()).toBe(new Date(firstClickedAt).getTime());

      // Verificar histórico de cliques gravados
      const { rows: clicksHistory } = await db.query(
        "SELECT * FROM public.smart_link_clicks WHERE link_id = $1 ORDER BY clicked_at ASC",
        [link.id]
      );
      expect(clicksHistory).toHaveLength(2);
      expect(clicksHistory[0].device_type).toBe("mobile");
      expect(clicksHistory[1].device_type).toBe("desktop");
      expect(clicksHistory[1].ip_address).toBe("189.100.50.2");
    });
  });

  describe("6. Rota Pública de Redirecionamento (GET /l/:code e /api/l/:code)", () => {
    it("redireciona com HTTP 302 para a destination_url e grava telemetria", async () => {
      const destination = "https://minhaempresa.com.br/landing-page-oferta";
      const link = await createSmartLink(db, {
        clientId: TENANT_ID,
        destinationUrl: destination,
      });

      // Faz a requisição sem seguir redirecionamento automático
      const res = await fetch(`${baseUrl}/l/${link.code}`, {
        method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/114.0.0.0",
          "X-Forwarded-For": "200.150.10.5",
          "Referer": "https://l.instagram.com/",
        },
        redirect: "manual",
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(destination);
      expect(res.headers.get("cache-control")).toContain("no-cache");

      // Aguarda pequena janela para a gravação assíncrona do clique
      await new Promise((r) => setTimeout(r, 100));

      const { rows: updatedLink } = await db.query(
        "SELECT clicks_count FROM public.smart_links WHERE id = $1",
        [link.id]
      );
      expect(updatedLink[0].clicks_count).toBe(1);

      const { rows: clicks } = await db.query(
        "SELECT * FROM public.smart_link_clicks WHERE link_id = $1",
        [link.id]
      );
      expect(clicks).toHaveLength(1);
      expect(clicks[0].device_type).toBe("desktop");
      expect(clicks[0].ip_address).toBe("200.150.10.5");
      expect(clicks[0].referrer).toBe("https://l.instagram.com/");
    });

    it("funciona através do alias /api/l/:code", async () => {
      const destination = "https://minhaempresa.com.br/catalogo";
      const link = await createSmartLink(db, {
        clientId: TENANT_ID,
        destinationUrl: destination,
      });

      const res = await fetch(`${baseUrl}/api/l/${link.code}`, {
        method: "GET",
        redirect: "manual",
      });

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe(destination);
    });

    it("retorna HTTP 404 amigável quando o link não existe", async () => {
      const res = await fetch(`${baseUrl}/l/codigo-inexistente`, {
        method: "GET",
        headers: {
          Accept: "text/html",
        },
        redirect: "manual",
      });

      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).toContain("Link não encontrado ou expirado");
    });
  });

  describe("7. Substituição de URLs em Mensagens (wrapMessageUrlsWithSmartLinks)", () => {
    it("substitui uma única URL no texto gerando smart link para o lead", async () => {
      const text = "Olá Pedro! Veja sua proposta em https://vexoia.com/proposta-exclusiva e nos avise.";
      const wrapped = await wrapMessageUrlsWithSmartLinks(db, {
        text,
        clientId: TENANT_ID,
        leadId: null,
        baseUrl: "https://crm.vexoia.com",
      });

      expect(wrapped).not.toContain("https://vexoia.com/proposta-exclusiva");
      expect(wrapped).toMatch(/https:\/\/crm\.vexoia\.com\/l\/[23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ]{6}/);
      expect(wrapped.endsWith(" e nos avise.")).toBe(true);

      // Conferir que o smart link foi gravado com a destinationUrl correta
      const match = wrapped.match(/\/l\/([a-zA-Z0-9]+)/);
      const code = match[1];
      const { rows } = await db.query("SELECT destination_url FROM public.smart_links WHERE code = $1", [code]);
      expect(rows[0].destination_url).toBe("https://vexoia.com/proposta-exclusiva");
    });

    it("substitui múltiplas URLs distintas por smart links individuais", async () => {
      const text = "Acesse o contrato em https://doc.empresa.com/assinar e o tutorial em https://video.empresa.com/watch.";
      const wrapped = await wrapMessageUrlsWithSmartLinks(db, {
        text,
        clientId: TENANT_ID,
        baseUrl: "https://crm.vexoia.com",
      });

      expect(wrapped).not.toContain("https://doc.empresa.com/assinar");
      expect(wrapped).not.toContain("https://video.empresa.com/watch");

      const matches = [...wrapped.matchAll(/https:\/\/crm\.vexoia\.com\/l\/([a-zA-Z0-9]+)/g)];
      expect(matches).toHaveLength(2);
      expect(matches[0][1]).not.toBe(matches[1][1]);
    });

    it("preserva links que já pertençam ao encurtador Vexo sem re-encurtá-los", async () => {
      const original = "Link já encurtado: https://crm.vexoia.com/l/x7k9p - não mexer!";
      const wrapped = await wrapMessageUrlsWithSmartLinks(db, {
        text: original,
        clientId: TENANT_ID,
        baseUrl: "https://crm.vexoia.com",
      });

      expect(wrapped).toBe(original);
    });

    it("mantém pontuações finais após o link (vírgula, ponto, exclamação)", async () => {
      const text = "Acesse https://site.com/oferta, aproveite!";
      const wrapped = await wrapMessageUrlsWithSmartLinks(db, {
        text,
        clientId: TENANT_ID,
        baseUrl: "https://crm.vexoia.com",
      });

      expect(wrapped).toMatch(/https:\/\/crm\.vexoia\.com\/l\/[a-zA-Z0-9]+,/);
      expect(wrapped.endsWith(" aproveite!")).toBe(true);
    });

    it("reutiliza o mesmo smart link se a mesma URL aparecer repetida na mensagem", async () => {
      const text = "Clique em https://site.com/duplicado e depois confirme em https://site.com/duplicado novamente.";
      const wrapped = await wrapMessageUrlsWithSmartLinks(db, {
        text,
        clientId: TENANT_ID,
        baseUrl: "https://crm.vexoia.com",
      });

      const matches = [...wrapped.matchAll(/https:\/\/crm\.vexoia\.com\/l\/([a-zA-Z0-9]+)/g)];
      expect(matches).toHaveLength(2);
      // Os códigos gerados para a mesma URL nesta mensagem devem ser idênticos
      expect(matches[0][1]).toBe(matches[1][1]);
    });

    it("retorna texto original inalterado quando não há links ou entrada inválida", async () => {
      expect(await wrapMessageUrlsWithSmartLinks(db, { text: "Sem links aqui", clientId: TENANT_ID })).toBe("Sem links aqui");
      expect(await wrapMessageUrlsWithSmartLinks(db, { text: null, clientId: TENANT_ID })).toBe(null);
      expect(await wrapMessageUrlsWithSmartLinks(db, { text: "", clientId: TENANT_ID })).toBe("");
    });
  });

  describe("8. Helper isVexoShortLink", () => {
    it("reconhece URLs com baseUrl e domínios Vexo padrão", () => {
      expect(isVexoShortLink("https://crm.vexoia.com/l/abc123", "https://crm.vexoia.com")).toBe(true);
      expect(isVexoShortLink("https://crm.vexoia.com/api/l/abc123", "https://crm.vexoia.com")).toBe(true);
      expect(isVexoShortLink("https://app.vexoia.com/l/abc123")).toBe(true);
      expect(isVexoShortLink("http://localhost:3001/l/abc123")).toBe(true);
      expect(isVexoShortLink("https://outrosite.com/l/abc123", "https://crm.vexoia.com")).toBe(false);
      expect(isVexoShortLink("https://google.com")).toBe(false);
    });
  });
});
