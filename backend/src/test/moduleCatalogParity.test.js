// Paridade entre o catalogo de modulos do backend e o do frontend.
//
// O catalogo autoritativo e MODULE_CATALOG em access/permissionsRegistry.js — e
// dele que deriveTenantInternalPages tira as paginas de um tenant modular, ou seja,
// e ele que decide o que a claim concede. O frontend tem AVAILABLE_CUSTOM_MODULES
// em lib/planTier.ts, que alimenta os dois dialogs de tenant.
//
// Enquanto os dois existirem, podem divergir — e divergencia aqui e silenciosa e
// cara: a tela oferece um modulo que a claim nao concede (usuario contrata e nao
// recebe), ou concede um que a tela nao oferece. Este teste falha no dia em que
// alguem mexer num sem mexer no outro.

import { describe, expect, it } from "vitest";
import {
  MODULE_CATALOG,
  MODULAR_BASE_PAGES,
  AVAILABLE_CUSTOM_MODULES as BACKEND_CUSTOM_MODULES,
  pagesForContractedModules,
} from "../access/permissionsRegistry.js";
import { AVAILABLE_CUSTOM_MODULES as FRONTEND_CUSTOM_MODULES } from "../../../frontend/src/lib/planTier.ts";
import { INTERNAL_PAGE_ORDER as FRONTEND_INTERNAL_PAGE_ORDER } from "../../../frontend/src/lib/access.ts";

describe("os dois catalogos descrevem os mesmos modulos (em memoria)", () => {
  it("mesmos ids de modulos, na mesma quantidade exata", () => {
    const backendIds = BACKEND_CUSTOM_MODULES.map((m) => m.id).sort();
    const frontendIds = FRONTEND_CUSTOM_MODULES.map((m) => m.id).sort();
    expect(backendIds).toEqual(frontendIds);
    expect(backendIds).toContain("banco-de-dados");
    expect(backendIds).toHaveLength(11);
  });

  it("cada modulo libera as MESMAS paginas nos dois lados", () => {
    for (const doFrontend of FRONTEND_CUSTOM_MODULES) {
      const doBackend = BACKEND_CUSTOM_MODULES.find((m) => m.id === doFrontend.id);
      expect(doBackend, `${doFrontend.id} nao existe no backend`).toBeTruthy();
      expect(
        [...doFrontend.pages].sort(),
        `paginas de ${doFrontend.id} divergem entre backend e frontend`
      ).toEqual([...doBackend.pages].sort());
    }
  });

  it("INTERNAL_PAGE_KEYS do backend e INTERNAL_PAGE_ORDER do frontend possuem exatamente o mesmo conjunto", async () => {
    const { INTERNAL_PAGE_KEYS } = await import("../access/claims.js");
    const backendSet = new Set(INTERNAL_PAGE_KEYS);
    const frontendSet = new Set(FRONTEND_INTERNAL_PAGE_ORDER);

    expect([...backendSet].sort()).toEqual([...frontendSet].sort());
    expect(backendSet.size).toBe(frontendSet.size);
    expect(backendSet.size).toBe(35);
  });
});

describe("resolucao por id e por apelido", () => {
  it("casa pelo id do modulo", () => {
    expect(pagesForContractedModules(["disparador_campanhas"])).toContain("campanhas");
  });

  it("casa pelos apelidos que a cascata antiga ja aceitava", () => {
    // Nenhum apelido novo: sao os mesmos que estavam espalhados nos ifs.
    expect(pagesForContractedModules(["campanhas"])).toContain("planilhas");
    expect(pagesForContractedModules(["agente-ia"])).toContain("agente");
    expect(pagesForContractedModules(["chips-whatsapp"])).toContain("conexoes");
    expect(pagesForContractedModules(["relatorio"])).toContain("inteligencia-comercial");
  });

  it("ignora prefixo mod_/modulo_ e caixa", () => {
    expect(pagesForContractedModules(["MOD_Disparador_Campanhas"])).toContain("campanhas");
    expect(pagesForContractedModules(["modulo_followup"])).toContain("fila-de-followup");
  });

  it("nada contratado nao libera nada", () => {
    expect(pagesForContractedModules([])).toEqual([]);
    expect(pagesForContractedModules(null)).toEqual([]);
  });

  it('"all" libera o catalogo inteiro', () => {
    const todas = pagesForContractedModules(["all"]);
    for (const modulo of MODULE_CATALOG) {
      for (const pagina of modulo.pages) {
        expect(todas).toContain(pagina);
      }
    }
  });
});

describe("base universal do plano modular", () => {
  it("inclui as paginas que todo tenant modular ve", () => {
    for (const base of ["dashboard", "whatsapp"]) {
      expect(MODULAR_BASE_PAGES).toContain(base);
    }
  });

  it("banco-de-dados e leads NAO estao na base universal", () => {
    expect(MODULAR_BASE_PAGES).not.toContain("banco-de-dados");
    expect(MODULAR_BASE_PAGES).not.toContain("leads");
    expect(MODULE_CATALOG.some((m) => m.id === "banco-de-dados")).toBe(true);
  });
});

import { deriveTenantInternalPages, INTERNAL_PAGE_KEYS } from "../access/claims.js";
import { hasInternalPageAccess } from "../accessGuards.js";

describe("comportamento de derivacao de permissoes e isolamento", () => {
  it("AVAILABLE_CUSTOM_MODULES do backend contem todos os 11 modulos incluindo banco-de-dados", async () => {
    const { AVAILABLE_CUSTOM_MODULES } = await import("../access/permissionsRegistry.js");
    expect(AVAILABLE_CUSTOM_MODULES.map((m) => m.id)).toContain("banco-de-dados");
    expect(AVAILABLE_CUSTOM_MODULES.length).toBe(11);
  });

  it("INTERNAL_PAGE_KEYS contem as 35 chaves de pagina incluindo as 4 chaves -gd", () => {
    expect(INTERNAL_PAGE_KEYS).toContain("propostas-gd");
    expect(INTERNAL_PAGE_KEYS).toContain("contratos-gd");
    expect(INTERNAL_PAGE_KEYS).toContain("pacotes-gd");
    expect(INTERNAL_PAGE_KEYS).toContain("condicoes-gd");
    expect(INTERNAL_PAGE_KEYS).toContain("banco-de-dados");
  });

  it("tenant modular COM 'banco-de-dados' contratado recebe a pagina nas permissoes efetivas", () => {
    const tenantComBanco = {
      id: "teste-com-banco",
      plan_tier: "modular",
      modulos_avulsos: ["banco-de-dados"],
    };
    const pages = deriveTenantInternalPages(tenantComBanco);
    expect(pages).toContain("banco-de-dados");
    expect(pages).toContain("dashboard");
    expect(pages).toContain("whatsapp");
  });

  it("tenant modular SEM 'banco-de-dados' contratado NAO recebe a pagina", () => {
    const tenantSemBanco = {
      id: "teste-sem-banco",
      plan_tier: "modular",
      modulos_avulsos: ["disparador_campanhas"],
    };
    const pages = deriveTenantInternalPages(tenantSemBanco);
    expect(pages).not.toContain("banco-de-dados");
    expect(pages).toContain("campanhas");
  });

  it("usuario com role 'client' NUNCA acessa paginas -gd nem paginas internas", () => {
    const clientAccess = {
      role: "client",
      allowedViews: ["dashboard", "leads"],
      internalPages: [],
    };
    expect(hasInternalPageAccess(clientAccess, "propostas-gd")).toBe(false);
    expect(hasInternalPageAccess(clientAccess, "contratos-gd")).toBe(false);
    expect(hasInternalPageAccess(clientAccess, "pacotes-gd")).toBe(false);
    expect(hasInternalPageAccess(clientAccess, "condicoes-gd")).toBe(false);
  });
});

