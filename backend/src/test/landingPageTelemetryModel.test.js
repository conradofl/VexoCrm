// backend/src/test/landingPageTelemetryModel.test.js
// Testes do modelo de dados e do serviço de produção de telemetria LGPD

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  validateTelemetryEventIngestion,
  ingestTelemetryEvent,
  VALID_TELEMETRY_EVENT_TYPES,
} from "../services/landingPageTelemetry.js";
import { registerLeadCaptureRoutes } from "../domains/leads/captureRoutes.js";

function fakeRes() {
  return {
    statusCode: 200,
    body: null,
    status(s) {
      this.statusCode = s;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
  };
}

describe("Módulo 06 — Modelo de Dados e Serviço de Produção de Telemetria LGPD", () => {
  const migrationPath = resolve("supabase/migrations/20261018120000_create_landing_page_module_tables.sql");
  const sql = readFileSync(migrationPath, "utf8");

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // --------------------------------------------------------------------------
  // Estrutura e DDL Idempotente
  // --------------------------------------------------------------------------
  it("arquivo de migration existe com DDL idempotente e multi-tenant estrito", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.landing_pages");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.landing_page_sessions");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.landing_page_events");

    // Índices de performance e unicidade
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_landing_pages_tenant_slug");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_landing_page_sessions_tenant_page");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS idx_landing_page_events_session");
  });

  // --------------------------------------------------------------------------
  // f) Apagar o lead apaga a sessão e os eventos em cascata (Direito ao Esquecimento LGPD)
  // --------------------------------------------------------------------------
  it("f) apagar o lead apaga a sessão e os eventos dele em cascata (ON DELETE CASCADE)", () => {
    // Garante que landing_page_sessions referencia public.leads com ON DELETE CASCADE
    expect(sql).toMatch(/lead_id UUID REFERENCES public\.leads\(id\)\s+ON DELETE CASCADE/i);

    // Garante que landing_page_events referencia landing_page_sessions com ON DELETE CASCADE
    expect(sql).toMatch(/session_id UUID NOT NULL REFERENCES public\.landing_page_sessions\(id\)\s+ON DELETE CASCADE/i);
  });

  // --------------------------------------------------------------------------
  // d) Visitante sem aceitar cookies: recusa evento individual com consent_given = false
  // --------------------------------------------------------------------------
  it("d) visitante sem aceitar cookies: consent_given é false e bloqueia evento comportamental", () => {
    expect(sql).toContain("consent_given BOOLEAN NOT NULL DEFAULT false");

    const sessionSemAceite = {
      id: "sess-123",
      consent_given: false,
    };

    const eventoTentado = {
      event_type: "scroll_depth",
      metadata: { depth_pct: 75, time_spent_seconds: 45 },
    };

    const resultado = validateTelemetryEventIngestion(sessionSemAceite, eventoTentado);

    expect(resultado.allowed).toBe(false);
    expect(resultado.error).toBe("CONSENTIMENTO_LGPD_OBRIGATORIO");
  });

  // --------------------------------------------------------------------------
  // e) Visitante que aceita e preenche: a jornada aparece amarrada ao lead
  // --------------------------------------------------------------------------
  it("e) visitante que aceita cookies: eventos comportamentais são autorizados e amarrados à sessão", () => {
    const sessionComAceite = {
      id: "sess-456",
      consent_given: true,
      lead_id: "lead-789", // preenchido quando envia o formulário
    };

    const eventoValido = {
      event_type: "section_view",
      section_name: "planos",
      time_spent_seconds: 128,
      metadata: { clicked_element: "card_avancado" },
    };

    const resultado = validateTelemetryEventIngestion(sessionComAceite, eventoValido);

    expect(resultado.allowed).toBe(true);
    expect(sessionComAceite.lead_id).toBe("lead-789");
  });

  // --------------------------------------------------------------------------
  // Ingestão no serviço de produção (ingestTelemetryEvent)
  // --------------------------------------------------------------------------
  it("ingestTelemetryEvent recusa no banco evento de sessão sem consentimento", async () => {
    const mockPool = {
      query: vi.fn(async (querySql) => {
        if (querySql.includes("FROM public.landing_page_sessions")) {
          return {
            rows: [
              {
                id: "sess-uuid-sem-consent",
                client_id: "vexo-adm",
                session_token: "tok-sem-aceite",
                consent_given: false, // NÃO deu consentimento
              },
            ],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const res = await ingestTelemetryEvent(mockPool, {
      clientId: "vexo-adm",
      sessionToken: "tok-sem-aceite",
      event: { event_type: "scroll_depth", metadata: { depth: 50 } },
    });

    expect(res.recorded).toBe(false);
    expect(res.error).toBe("CONSENTIMENTO_LGPD_OBRIGATORIO");

    // Verifica que NENHUM INSERT foi feito em landing_page_events
    const insertCall = mockPool.query.mock.calls.find(([sqlStr]) =>
      sqlStr.includes("INSERT INTO public.landing_page_events")
    );
    expect(insertCall).toBeUndefined();
  });

  it("ingestTelemetryEvent autoriza e grava evento no banco quando consentimento é ativo", async () => {
    let eventInserted = false;
    const mockPool = {
      query: vi.fn(async (querySql) => {
        if (querySql.includes("FROM public.landing_page_sessions")) {
          return {
            rows: [
              {
                id: "sess-uuid-com-consent",
                client_id: "vexo-adm",
                session_token: "tok-com-aceite",
                consent_given: true, // DEU consentimento ativo
              },
            ],
          };
        }
        if (querySql.includes("INSERT INTO public.landing_page_events")) {
          eventInserted = true;
          return { rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const res = await ingestTelemetryEvent(mockPool, {
      clientId: "vexo-adm",
      sessionToken: "tok-com-aceite",
      event: {
        event_type: "section_view",
        section_name: "planos",
        time_spent_seconds: 60,
        metadata: { clicked: "card_avancado" },
      },
    });

    expect(res.recorded).toBe(true);
    expect(eventInserted).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Rota HTTP real POST /api/public/landing-pages/telemetry
  // --------------------------------------------------------------------------
  it("rota HTTP pública /api/public/landing-pages/telemetry responde 403 quando falta consentimento", async () => {
    const routes = {};
    const fakeApp = {
      post: (p, ...handlers) => {
        routes[`post ${p}`] = handlers[handlers.length - 1];
      },
    };

    const pool = {
      query: vi.fn(async (querySql) => {
        if (querySql.includes("FROM public.landing_page_sessions")) {
          return {
            rows: [{ id: "sess-1", client_id: "solar-prime", consent_given: false }],
          };
        }
        return { rows: [], rowCount: 1 };
      }),
    };

    const deps = {
      pgDatabasePool: pool,
      sendError: (res, status, code, message) => {
        res.status(status).json({ error: code, message });
      },
    };

    registerLeadCaptureRoutes(fakeApp, deps);
    const handler = routes["post /api/public/landing-pages/telemetry"];
    expect(handler).toBeDefined();

    const req = {
      body: {
        client_id: "solar-prime",
        session_token: "tok-anônimo",
        event: { event_type: "scroll_depth" },
      },
    };
    const res = fakeRes();

    await handler(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.body.error).toBe("CONSENTIMENTO_LGPD_OBRIGATORIO");
  });
});
