// backend/src/test/publicCorsRoutes.test.js
// Testes de CORS para as Rotas Públicas vs. Rotas Autenticadas do Vexo OS.
//
// Especificação: SPEC — CORS das rotas públicas (18/10/2026).
// Objetivo: Garantir que páginas de captura de clientes em domínios próprios
// possam chamar /api/public/leads/capture, /api/public/diagnostico e
// /api/public/landing-pages/telemetry sem bloqueio de CORS, enquanto todas as
// demais rotas autenticadas do CRM permanecem estritamente fechadas.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import cors from "cors";
import {
  createCorsOptionsDelegate,
  isPublicApiRoute,
  configureCorsPolicy,
  isTrustedSocialOrigin,
  isAllowedCorsOrigin,
  applyCorsHeaders,
} from "../services/corsPolicy.js";
import { sendError } from "../services/httpInfra.js";

const ORIGEM_CRM_CONHECIDA = "https://crm.vexoia.com";
const ORIGEM_CLIENTE_DESCONHECIDA_1 = "https://landing.cliente-a.com.br";
const ORIGEM_CLIENTE_DESCONHECIDA_2 = "https://paginacaptura.empresa-b.io";
const ORIGEM_ATACANTE = "https://site-malicioso.example";

describe("Classificacao de Rotas Publicas (isPublicApiRoute)", () => {
  it("reconhece rotas publicas de captura e telemetria", () => {
    expect(isPublicApiRoute("/api/public/leads/capture")).toBe(true);
    expect(isPublicApiRoute("/api/public/diagnostico")).toBe(true);
    expect(isPublicApiRoute("/api/public/landing-pages/telemetry")).toBe(true);
    expect(isPublicApiRoute("/api/public/leads/capture?source=facebook")).toBe(true);
  });

  it("rejeita rotas autenticadas do CRM e caminhos nao publicos", () => {
    expect(isPublicApiRoute("/api/leads")).toBe(false);
    expect(isPublicApiRoute("/api/campaigns")).toBe(false);
    expect(isPublicApiRoute("/api/publico")).toBe(false);
    expect(isPublicApiRoute("/api/public")).toBe(false);
    expect(isPublicApiRoute("")).toBe(false);
    expect(isPublicApiRoute(null)).toBe(false);
  });
});

describe("Comportamento HTTP de CORS: Rotas Publicas vs Rotas Autenticadas", () => {
  let app;
  let server;
  let baseUrl;

  beforeAll(async () => {
    configureCorsPolicy({
      allowAny: false,
      origens: [ORIGEM_CRM_CONHECIDA],
    });

    app = express();
    app.use(express.json());

    // Middleware oficial de CORS configurado exatamente como em server.js
    app.use(
      cors(
        createCorsOptionsDelegate({
          allowAny: false,
          corsOrigins: [ORIGEM_CRM_CONHECIDA],
        })
      )
    );

    // Rotas públicas do produto
    app.post("/api/public/leads/capture", (req, res) => {
      res.status(200).json({ success: true, message: "Lead recebido" });
    });
    app.post("/api/public/diagnostico", (req, res) => {
      res.status(200).json({ success: true, message: "Diagnostico recebido" });
    });
    app.post("/api/public/landing-pages/telemetry", (req, res) => {
      res.status(200).json({ success: true, message: "Evento registrado" });
    });
    app.post("/api/public/erro-teste", (req, res) => {
      sendError(res, 429, "RATE_LIMIT_EXCEEDED", "Limite atingido");
    });

    // Rota autenticada de exemplo do CRM
    app.post("/api/leads", (req, res) => {
      res.status(200).json({ success: true, leads: [] });
    });

    await new Promise((resolve) => {
      server = app.listen(0, "127.0.0.1", () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // Teste (a) da SPEC: POST na rota pública de captura com Origin desconhecida: aceito
  it("a) POST na rota publica de captura com Origin desconhecida: aceito", async () => {
    const res = await fetch(`${baseUrl}/api/public/leads/capture`, {
      method: "POST",
      headers: {
        Origin: ORIGEM_CLIENTE_DESCONHECIDA_1,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone: "11999999999", fullName: "Cliente Teste" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGEM_CLIENTE_DESCONHECIDA_1);
    // Rota pública não deve enviar credenciais
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("a.2) POST no alias /api/public/diagnostico com Origin desconhecida: aceito", async () => {
    const res = await fetch(`${baseUrl}/api/public/diagnostico`, {
      method: "POST",
      headers: {
        Origin: ORIGEM_CLIENTE_DESCONHECIDA_2,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ phone: "11999999999" }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGEM_CLIENTE_DESCONHECIDA_2);
  });

  // Teste (b) da SPEC: POST na rota pública de telemetria com Origin desconhecida: aceito
  it("b) POST na rota publica de telemetria com Origin desconhecida: aceito", async () => {
    const res = await fetch(`${baseUrl}/api/public/landing-pages/telemetry`, {
      method: "POST",
      headers: {
        Origin: ORIGEM_CLIENTE_DESCONHECIDA_2,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event: { event_type: "page_view" } }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGEM_CLIENTE_DESCONHECIDA_2);
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  // Teste (c) da SPEC: POST em rota autenticada com Origin desconhecida: recusado
  it("c) POST em rota autenticada com Origin desconhecida: recusado (sem cabecalho CORS)", async () => {
    const res = await fetch(`${baseUrl}/api/leads`, {
      method: "POST",
      headers: {
        Origin: ORIGEM_ATACANTE,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    // O navegador bloqueia porque o cabecalho de CORS esta ausente
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("c.2) POST em rota autenticada com Origin configurada do CRM: aceito com credenciais", async () => {
    const res = await fetch(`${baseUrl}/api/leads`, {
      method: "POST",
      headers: {
        Origin: ORIGEM_CRM_CONHECIDA,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGEM_CRM_CONHECIDA);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  // Teste (d) da SPEC: o preflight OPTIONS das rotas públicas responde certo
  it("d) o preflight OPTIONS das rotas publicas responde certo (204 No Content com headers)", async () => {
    const res = await fetch(`${baseUrl}/api/public/leads/capture`, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGEM_CLIENTE_DESCONHECIDA_1,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "Content-Type, X-Requested-With",
      },
    });

    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGEM_CLIENTE_DESCONHECIDA_1);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("d.2) preflight OPTIONS em rota autenticada com Origin desconhecida: recusado", async () => {
    const res = await fetch(`${baseUrl}/api/leads`, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGEM_ATACANTE,
        "Access-Control-Request-Method": "POST",
      },
    });

    // Sem cabecalho de liberacao da origem
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("e) sendError em rota publica preserva o cabecalho CORS para o navegador exibir o erro", async () => {
    const res = await fetch(`${baseUrl}/api/public/erro-teste`, {
      method: "POST",
      headers: {
        Origin: ORIGEM_CLIENTE_DESCONHECIDA_1,
      },
    });

    expect(res.status).toBe(429);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGEM_CLIENTE_DESCONHECIDA_1);
    const data = await res.json();
    expect(data.error.code).toBe("RATE_LIMIT_EXCEEDED");
  });
});

describe("Seguranca de Dominios Confiaveis (Scout / Redes Sociais)", () => {
  // Teste (f) da SPEC: subdomínio legítimo aceito
  it("f) https://www.instagram.com -> aceito (subdominio legitimo)", () => {
    expect(isTrustedSocialOrigin("https://www.instagram.com")).toBe(true);
    expect(isAllowedCorsOrigin("https://www.instagram.com")).toBe(true);
  });

  // Teste (g) da SPEC: domínio exato aceito
  it("g) https://instagram.com -> aceito (dominio exato)", () => {
    expect(isTrustedSocialOrigin("https://instagram.com")).toBe(true);
    expect(isAllowedCorsOrigin("https://instagram.com")).toBe(true);
  });

  it("g.2) outros dominios confiaveis: linkedin, facebook, tiktok e subdominios", () => {
    expect(isTrustedSocialOrigin("https://linkedin.com")).toBe(true);
    expect(isTrustedSocialOrigin("https://www.linkedin.com")).toBe(true);
    expect(isTrustedSocialOrigin("https://facebook.com")).toBe(true);
    expect(isTrustedSocialOrigin("https://web.facebook.com")).toBe(true);
    expect(isTrustedSocialOrigin("https://tiktok.com")).toBe(true);
    expect(isTrustedSocialOrigin("https://www.tiktok.com")).toBe(true);
  });

  // Teste (h) da SPEC: https://instagram.com.atacante.net -> RECUSADO
  it("h) https://instagram.com.atacante.net -> RECUSADO (nao casa por includes)", () => {
    expect(isTrustedSocialOrigin("https://instagram.com.atacante.net")).toBe(false);
    expect(isAllowedCorsOrigin("https://instagram.com.atacante.net")).toBe(false);
  });

  // Teste (i) da SPEC: https://meu-facebook.com.br -> RECUSADO
  it("i) https://meu-facebook.com.br -> RECUSADO (nao casa por includes)", () => {
    expect(isTrustedSocialOrigin("https://meu-facebook.com.br")).toBe(false);
    expect(isAllowedCorsOrigin("https://meu-facebook.com.br")).toBe(false);
  });

  // Teste (j) da SPEC: Origin malformado -> RECUSADO sem lançar exceção
  it("j) Origin malformado ('nao-e-url') -> RECUSADO sem lancar excecao", () => {
    expect(() => isTrustedSocialOrigin("nao-e-url")).not.toThrow();
    expect(isTrustedSocialOrigin("nao-e-url")).toBe(false);
    expect(isAllowedCorsOrigin("nao-e-url")).toBe(false);
    expect(isAllowedCorsOrigin(null)).toBe(false);
    expect(isAllowedCorsOrigin("")).toBe(false);
  });

  it("k) applyCorsHeaders em rota publica com origin vazio retorna false e nao escreve cabecalho", () => {
    const headers = {};
    const res = {
      headersSent: false,
      req: { path: "/api/public/leads/capture" },
      setHeader(k, v) { headers[k] = v; },
      getHeader(k) { return headers[k]; },
    };

    const resultado = applyCorsHeaders(res, "");
    expect(resultado).toBe(false);
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });
});

