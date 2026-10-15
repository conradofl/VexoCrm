import { describe, it, expect } from "vitest";
import { resolveTenantPlan, hasFeatureUnlocked } from "../lib/planTier";

describe("planTier resolver", () => {
  it("defaults to essencial when no client or plan is provided", () => {
    expect(resolveTenantPlan(undefined)).toBe("essencial");
    expect(resolveTenantPlan({})).toBe("essencial");
    expect(resolveTenantPlan({ name: "Empresa Solar" })).toBe("essencial");
  });

  it("identifies essencial plan correctly across various fields", () => {
    expect(resolveTenantPlan({ plan_tier: "essencial" })).toBe("essencial");
    expect(resolveTenantPlan({ plan_type: "essencial" })).toBe("essencial");
    expect(resolveTenantPlan({ model_type: "essencial" })).toBe("essencial");
    expect(resolveTenantPlan({ n8n_settings: { plan_tier: "essencial" } })).toBe("essencial");
  });

  it("identifies avancado plan correctly across various fields", () => {
    expect(resolveTenantPlan({ plan_tier: "avancado" })).toBe("avancado");
    expect(resolveTenantPlan({ plan_type: "avancado" })).toBe("avancado");
    expect(resolveTenantPlan({ model_type: "avancado" })).toBe("avancado");
    expect(resolveTenantPlan({ n8n_settings: { plan_tier: "avancado" } })).toBe("avancado");
    expect(resolveTenantPlan({ plan_tier: "advanced" })).toBe("avancado");
    expect(resolveTenantPlan({ plan_tier: "pro" })).toBe("avancado");
  });

  it("identifies modular plan correctly across various fields", () => {
    expect(resolveTenantPlan({ plan_tier: "modular" })).toBe("modular");
    expect(resolveTenantPlan({ plan_type: "modular" })).toBe("modular");
    expect(resolveTenantPlan({ model_type: "modular" })).toBe("modular");
    expect(resolveTenantPlan({ n8n_settings: { plan_tier: "modular" } })).toBe("modular");
    expect(resolveTenantPlan({ plan_tier: "avulso" })).toBe("modular");
    expect(resolveTenantPlan({ plan_tier: "modular", modulos_avulsos: ["agente_rag"] })).toBe("modular");
  });

  it("unlocks all features when tenant is in Plano Avancado", () => {
    const advancedTenant = { plan_tier: "avancado" };
    expect(hasFeatureUnlocked(advancedTenant, "followup_automations")).toBe(true);
    expect(hasFeatureUnlocked(advancedTenant, "antiban_groq")).toBe(true);
    expect(hasFeatureUnlocked(advancedTenant, "agente_campanha")).toBe(true);
    expect(hasFeatureUnlocked(advancedTenant, "agente_rag")).toBe(true);
  });

  it("unlocks only contracted modules when tenant is in Plano Modular", () => {
    const modularTenant = {
      plan_tier: "modular",
      modulos_avulsos: ["agente_rag", "sdr_broadcast"],
    };
    // Contracted modules
    expect(hasFeatureUnlocked(modularTenant, "agente_rag")).toBe(true);
    expect(hasFeatureUnlocked(modularTenant, "sdr_broadcast")).toBe(true);
    // Non-contracted advanced modules
    expect(hasFeatureUnlocked(modularTenant, "followup_automations")).toBe(false);
    expect(hasFeatureUnlocked(modularTenant, "antiban_groq")).toBe(false);
    // Universal base modules
    expect(hasFeatureUnlocked(modularTenant, "dashboard")).toBe(true);
    expect(hasFeatureUnlocked(modularTenant, "whatsapp")).toBe(true);
    expect(hasFeatureUnlocked(modularTenant, "conversas")).toBe(true);
  });

  it("locks advanced features when tenant is in Plano Essencial without degustacao", () => {
    const essencialTenant = { plan_tier: "essencial" };
    expect(hasFeatureUnlocked(essencialTenant, "followup_automations")).toBe(false);
    expect(hasFeatureUnlocked(essencialTenant, "antiban_groq")).toBe(false);
    expect(hasFeatureUnlocked(essencialTenant, "agente_campanha")).toBe(false);
    expect(hasFeatureUnlocked(essencialTenant, "agente_rag")).toBe(false);
  });

  it("unlocks specific features when tenant has individual module degustacao in modulos_avulsos", () => {
    const degustacaoTenant = {
      plan_tier: "essencial",
      modulos_avulsos: ["followup_automations", "agente_rag"],
    };
    expect(hasFeatureUnlocked(degustacaoTenant, "followup_automations")).toBe(true);
    expect(hasFeatureUnlocked(degustacaoTenant, "agente_rag")).toBe(true);
    expect(hasFeatureUnlocked(degustacaoTenant, "antiban_groq")).toBe(false);
    expect(hasFeatureUnlocked(degustacaoTenant, "agente_campanha")).toBe(false);
  });

  it("locks features when degustacao is expired (even if module is in modulos_avulsos)", () => {
    const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(); // 1 day ago
    const expiredTenant = {
      plan_tier: "essencial",
      modulos_avulsos: ["followup_automations", "agente_rag"],
      degustacao_expira_em: pastDate,
    };
    expect(hasFeatureUnlocked(expiredTenant, "followup_automations")).toBe(false);
    expect(hasFeatureUnlocked(expiredTenant, "agente_rag")).toBe(false);
  });

  it("keeps features unlocked when degustacao is still active in future", () => {
    const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(); // 7 days ahead
    const activeTenant = {
      plan_tier: "essencial",
      modulos_avulsos: ["followup_automations", "agente_rag"],
      degustacao_expira_em: futureDate,
    };
    expect(hasFeatureUnlocked(activeTenant, "followup_automations")).toBe(true);
    expect(hasFeatureUnlocked(activeTenant, "agente_rag")).toBe(true);
  });

  it("strictly locks uncontracted tools in modular plan", () => {
    const modularTenant = {
      plan_tier: "modular",
      modulos_avulsos: ["agente_rag", "followup_automations"],
    };
    // Contracted tools
    expect(hasFeatureUnlocked(modularTenant, "agente_rag")).toBe(true);
    expect(hasFeatureUnlocked(modularTenant, "agente")).toBe(true);
    expect(hasFeatureUnlocked(modularTenant, "followup_automations")).toBe(true);
    expect(hasFeatureUnlocked(modularTenant, "followup")).toBe(true);

    // Uncontracted tools
    expect(hasFeatureUnlocked(modularTenant, "disparador_campanhas")).toBe(false);
    expect(hasFeatureUnlocked(modularTenant, "campanhas")).toBe(false);
    expect(hasFeatureUnlocked(modularTenant, "multiplos_chips")).toBe(false);
    expect(hasFeatureUnlocked(modularTenant, "conexoes")).toBe(false);
    expect(hasFeatureUnlocked(modularTenant, "sdr_broadcast")).toBe(false);
    expect(hasFeatureUnlocked(modularTenant, "origem_leads")).toBe(false);
    expect(hasFeatureUnlocked(modularTenant, "relatorios")).toBe(false);
  });

  it("recognizes all aliases across modulos_avulsos in n8n_settings or root", () => {
    const tenantWithN8nModulos = {
      plan_tier: "modular",
      n8n_settings: {
        modulos_avulsos: ["disparador_campanhas", "multiplos_chips", "origem_leads"],
      },
    };
    // Aliases for disparador_campanhas
    expect(hasFeatureUnlocked(tenantWithN8nModulos, "disparador_campanhas")).toBe(true);
    expect(hasFeatureUnlocked(tenantWithN8nModulos, "campanhas")).toBe(true);
    expect(hasFeatureUnlocked(tenantWithN8nModulos, "planilhas")).toBe(true);
    expect(hasFeatureUnlocked(tenantWithN8nModulos, "disparos")).toBe(true);

    // Aliases for multiplos_chips
    expect(hasFeatureUnlocked(tenantWithN8nModulos, "multiplos_chips")).toBe(true);
    expect(hasFeatureUnlocked(tenantWithN8nModulos, "chips-whatsapp")).toBe(true);
    expect(hasFeatureUnlocked(tenantWithN8nModulos, "conexoes")).toBe(true);

    // Aliases for origem_leads
    expect(hasFeatureUnlocked(tenantWithN8nModulos, "origem_leads")).toBe(true);
    expect(hasFeatureUnlocked(tenantWithN8nModulos, "origens")).toBe(true);
    expect(hasFeatureUnlocked(tenantWithN8nModulos, "rastreamento")).toBe(true);

    // Non-contracted aliases
    expect(hasFeatureUnlocked(tenantWithN8nModulos, "followup")).toBe(false);
    expect(hasFeatureUnlocked(tenantWithN8nModulos, "fila-de-followup")).toBe(false);
    expect(hasFeatureUnlocked(tenantWithN8nModulos, "agente")).toBe(false);
    expect(hasFeatureUnlocked(tenantWithN8nModulos, "agente-ia")).toBe(false);
  });

  it("calendário abre com módulo de campanhas OU de follow-up — sem vazar o follow-up para quem só tem campanhas", () => {
    const soCampanhas = { plan_tier: "modular", n8n_settings: { modulos_avulsos: ["disparador_campanhas"] } };
    const soFollowup = { plan_tier: "modular", n8n_settings: { modulos_avulsos: ["followup"] } };
    const nenhum = { plan_tier: "modular", n8n_settings: { modulos_avulsos: [] } };

    expect(hasFeatureUnlocked(soCampanhas, "calendario")).toBe(true);
    expect(hasFeatureUnlocked(soCampanhas, "agenda")).toBe(true);
    expect(hasFeatureUnlocked(soCampanhas, "followup")).toBe(false);
    expect(hasFeatureUnlocked(soCampanhas, "fila-de-followup")).toBe(false);

    expect(hasFeatureUnlocked(soFollowup, "calendario")).toBe(true);
    expect(hasFeatureUnlocked(soFollowup, "followup")).toBe(true);

    expect(hasFeatureUnlocked(nenhum, "calendario")).toBe(false);
  });
});
