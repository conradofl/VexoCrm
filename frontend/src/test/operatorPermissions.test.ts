import { describe, expect, it } from "vitest";
import {
  OPERATOR_MODULES,
  ALL_OPERATOR_MODULE_IDS,
  DEFAULT_OPERATOR_MODULE_IDS,
  deriveOperatorModulesFromPages,
  derivePagesAndPermissionsFromModules,
  isOperatorModuleAllowed,
  getModuleIdFromSidebarItemKey,
  getModuleIdFromPath,
  type OperatorModuleId,
} from "@/lib/operatorPermissions";

describe("Trava de Acesso por Módulo para Operadores (12 Módulos)", () => {
  it("contém exatamente os 12 módulos solicitados pelo usuário", () => {
    const expectedModules: OperatorModuleId[] = [
      "dashboard",
      "banco-de-dados",
      "leads-parados",
      "conversas",
      "followup",
      "campanhas",
      "calendario",
      "agente-ia",
      "chips-whatsapp",
      "implantacao",
      "onboarding",
      "admin",
    ];

    expect(ALL_OPERATOR_MODULE_IDS).toEqual(expectedModules);
    expect(OPERATOR_MODULES).toHaveLength(12);

    const labels = OPERATOR_MODULES.map((m) => m.label);
    expect(labels).toContain("Dashboard");
    expect(labels).toContain("Banco de Dados");
    expect(labels).toContain("Leads Parados");
    expect(labels).toContain("Conversas");
    expect(labels).toContain("Follow-up");
    expect(labels).toContain("Campanhas");
    expect(labels).toContain("Calendário");
    expect(labels).toContain("Agente IA");
    expect(labels).toContain("Chips WhatsApp");
    expect(labels).toContain("Implantação (Setup)");
    expect(labels).toContain("VE Treinamento Vexo");
    expect(labels).toContain("Administração");
  });

  it("admin possui acesso irrestrito a todos os 12 módulos", () => {
    const adminAccess = {
      role: "internal",
      isAdmin: true,
      accessPreset: "admin_vexo",
    };

    for (const modId of ALL_OPERATOR_MODULE_IDS) {
      expect(isOperatorModuleAllowed(modId, adminAccess)).toBe(true);
    }
  });

  it("operador respeita rigorosamente os módulos liberados em allowedModules", () => {
    const restrictedOperator = {
      role: "internal",
      isAdmin: false,
      accessPreset: "operador",
      allowedModules: ["conversas", "followup"],
    };

    expect(isOperatorModuleAllowed("conversas", restrictedOperator)).toBe(true);
    expect(isOperatorModuleAllowed("followup", restrictedOperator)).toBe(true);
    expect(isOperatorModuleAllowed("dashboard", restrictedOperator)).toBe(false);
    expect(isOperatorModuleAllowed("banco-de-dados", restrictedOperator)).toBe(false);
    expect(isOperatorModuleAllowed("leads-parados", restrictedOperator)).toBe(false);
    expect(isOperatorModuleAllowed("campanhas", restrictedOperator)).toBe(false);
    expect(isOperatorModuleAllowed("calendario", restrictedOperator)).toBe(false);
    expect(isOperatorModuleAllowed("agente-ia", restrictedOperator)).toBe(false);
    expect(isOperatorModuleAllowed("chips-whatsapp", restrictedOperator)).toBe(false);
    expect(isOperatorModuleAllowed("implantacao", restrictedOperator)).toBe(false);
    expect(isOperatorModuleAllowed("onboarding", restrictedOperator)).toBe(false);
    expect(isOperatorModuleAllowed("admin", restrictedOperator)).toBe(false);
  });

  it("fallback para operador legado sem allowedModules deriva de internalPages", () => {
    const legacyOperator = {
      role: "internal",
      isAdmin: false,
      accessPreset: "operador",
      internalPages: ["whatsapp", "banco-de-dados"],
    };

    expect(isOperatorModuleAllowed("conversas", legacyOperator)).toBe(true);
    expect(isOperatorModuleAllowed("banco-de-dados", legacyOperator)).toBe(true);
    expect(isOperatorModuleAllowed("dashboard", legacyOperator)).toBe(false);
    expect(isOperatorModuleAllowed("campanhas", legacyOperator)).toBe(false);
  });

  it("mapeia corretamente as rotas do CRM para seus respectivos módulos", () => {
    expect(getModuleIdFromPath("/crm/dashboard")).toBe("dashboard");
    expect(getModuleIdFromPath("/crm/banco-de-dados")).toBe("banco-de-dados");
    expect(getModuleIdFromPath("/crm/leads-parados")).toBe("leads-parados");
    expect(getModuleIdFromPath("/crm/whatsapp")).toBe("conversas");
    expect(getModuleIdFromPath("/crm/followup")).toBe("followup");
    expect(getModuleIdFromPath("/crm/campanhas")).toBe("campanhas");
    expect(getModuleIdFromPath("/crm/calendario")).toBe("calendario");
    expect(getModuleIdFromPath("/crm/agente")).toBe("agente-ia");
    expect(getModuleIdFromPath("/crm/chips-whatsapp")).toBe("chips-whatsapp");
    expect(getModuleIdFromPath("/crm/implantacao")).toBe("implantacao");
    expect(getModuleIdFromPath("/crm/onboarding")).toBe("onboarding");
    expect(getModuleIdFromPath("/crm/admin")).toBe("admin");
  });

  it("mapeia corretamente as chaves da sidebar para seus respectivos módulos", () => {
    expect(getModuleIdFromSidebarItemKey("dashboard")).toBe("dashboard");
    expect(getModuleIdFromSidebarItemKey("banco-de-dados")).toBe("banco-de-dados");
    expect(getModuleIdFromSidebarItemKey("leads-parados")).toBe("leads-parados");
    expect(getModuleIdFromSidebarItemKey("conversas")).toBe("conversas");
    expect(getModuleIdFromSidebarItemKey("followup")).toBe("followup");
    expect(getModuleIdFromSidebarItemKey("campanhas")).toBe("campanhas");
    expect(getModuleIdFromSidebarItemKey("calendario")).toBe("calendario");
    expect(getModuleIdFromSidebarItemKey("agente-ia")).toBe("agente-ia");
    expect(getModuleIdFromSidebarItemKey("chips-whatsapp")).toBe("chips-whatsapp");
    expect(getModuleIdFromSidebarItemKey("implantacao")).toBe("implantacao");
    expect(getModuleIdFromSidebarItemKey("onboarding")).toBe("onboarding");
    expect(getModuleIdFromSidebarItemKey("admin")).toBe("admin");
  });

  it("deriva páginas internas e permissões sincronizadas a partir dos módulos selecionados", () => {
    const { internalPages, permissions } = derivePagesAndPermissionsFromModules([
      "conversas",
      "banco-de-dados",
    ]);

    expect(internalPages).toContain("whatsapp");
    expect(internalPages).toContain("banco-de-dados");
    expect(permissions).toContain("whatsapp.view");
    expect(permissions).toContain("whatsapp.reply");
    expect(permissions).toContain("banco_dados.view");
    expect(internalPages).not.toContain("campanhas");
  });
});
