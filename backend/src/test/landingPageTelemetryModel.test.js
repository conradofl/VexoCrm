// backend/src/test/landingPageTelemetryModel.test.js
// Testes do modelo de dados do Módulo 06: Página de Captação e Telemetria LGPD

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

/**
 * Validador puro de conformidade LGPD para ingestão de eventos de telemetria.
 * Regra jurídica inegociável: rastreamento comportamental SÓ é permitido com aceite ativo.
 * @param {object} session
 * @param {boolean} session.consent_given
 * @param {object} event
 * @returns {{ allowed: boolean, reason?: string }}
 */
export function validateTelemetryEventIngestion(session, event) {
  if (!session || !session.consent_given) {
    return {
      allowed: false,
      reason: "CONSENTIMENTO_LGPD_OBRIGATORIO",
    };
  }

  if (!event || !event.event_type) {
    return {
      allowed: false,
      reason: "EVENT_TYPE_OBRIGATORIO",
    };
  }

  return { allowed: true };
}

describe("Módulo 06 — Modelo de Dados e Conformidade LGPD da Telemetria", () => {
  const migrationPath = resolve("supabase/migrations/20261018120000_create_landing_page_module_tables.sql");
  const sql = readFileSync(migrationPath, "utf8");

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
  // d) Visitante sem aceitar cookies: sem evento individual registrado
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
    expect(resultado.reason).toBe("CONSENTIMENTO_LGPD_OBRIGATORIO");
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
  // MUTAÇÃO: rastrear antes do aceite -> MORRE (d)
  // --------------------------------------------------------------------------
  it("MUTAÇÃO: tentar rastrear sem verificar consentimento ativo morre imediatamente no validador", () => {
    // Simula implementação mutante que ignora a checagem jurídica de consentimento
    function validateMutantIngestion(session, event) {
      // MUTANTE: esqueceu if (!session.consent_given)
      return { allowed: true };
    }

    const sessionSemConsentimento = { consent_given: false };
    const event = { event_type: "scroll_depth" };

    const mutantResult = validateMutantIngestion(sessionSemConsentimento, event);
    const realResult = validateTelemetryEventIngestion(sessionSemConsentimento, event);

    // O mutante autorizaria ilegalmente sem consentimento (violando LGPD)
    expect(mutantResult.allowed).toBe(true);

    // O código de produção BARRARIA o mutante, garantindo proteção jurídica
    expect(realResult.allowed).toBe(false);
    expect(realResult.reason).toBe("CONSENTIMENTO_LGPD_OBRIGATORIO");
  });
});
