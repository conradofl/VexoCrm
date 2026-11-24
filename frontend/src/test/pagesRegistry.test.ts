// Registro único de páginas (lib/pages.ts): confere que ele, as rotas do App.tsx,
// o menu e o backend dizem a mesma coisa. Antes eram 4 mapas página→URL
// (App.tsx, ProtectedRoute.tsx, access.ts duas vezes) e a rota padrão pós-login
// montava /crm/<chave>, que não existe para fila-de-followup, chatbot-kanban,
// onboarding-wizard, disparos, onboarding-agent e condicoes-gd (caía no NotFound).
import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { INTERNAL_PAGES, findFirstOpenableInternalPage } from "@/lib/pages";
import { INTERNAL_PAGE_ORDER, getDefaultInternalRoute, isInternalPageAllowedForClient } from "@/lib/access";
import {
  OPERACAO_ITEMS,
  AGENTE_IA_ITEMS,
  CANAIS_ITEMS,
  GERACAO_DIGITAL_ITEMS,
  TRAFEGO_ITEMS,
  LIVPUB_ITEMS,
  AJUDA_ITEMS,
  ADMIN_ITEMS,
} from "@/lib/appSidebar/constants";
import { OPERATOR_MODULES } from "@/lib/operatorPermissions";

const appSource = readFileSync(resolve("src/App.tsx"), "utf8");
const claimsSource = readFileSync(resolve("../backend/src/access/claims.js"), "utf8");

// Blocos <Route path="x" ...> filhos de /crm: texto de cada um até o próximo path=.
function crmRouteBlocks(): Map<string, string> {
  const crmStart = appSource.indexOf('path="/crm"');
  const crmEnd = appSource.indexOf('path="/clientes/:clientId"', crmStart);
  const section = appSource.slice(crmStart + 'path="/crm"'.length, crmEnd);
  const blocks = new Map<string, string>();
  const parts = section.split(/path="/).slice(1);
  for (const part of parts) {
    const name = part.slice(0, part.indexOf('"'));
    if (!blocks.has(name)) blocks.set(name, part);
  }
  return blocks;
}

const routes = crmRouteBlocks();

function segmentOf(url: string): string {
  const pathname = url.split("?")[0];
  expect(pathname.startsWith("/crm/")).toBe(true);
  return pathname.slice("/crm/".length);
}

describe("registro de páginas (lib/pages.ts)", () => {
  it("tem as mesmas chaves que INTERNAL_PAGE_KEYS do backend", () => {
    const match = claimsSource.match(/export const INTERNAL_PAGE_KEYS = \[([\s\S]*?)\];/);
    expect(match).not.toBeNull();
    const backendKeys = [...match![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect([...INTERNAL_PAGES.map((p) => p.key)].sort()).toEqual([...backendKeys].sort());
  });

  it("não repete chave e INTERNAL_PAGE_ORDER segue a ordem do registro", () => {
    const keys = INTERNAL_PAGES.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect([...INTERNAL_PAGE_ORDER]).toEqual(keys);
  });

  it.each(INTERNAL_PAGES.map((p) => [p.key, p] as const))(
    "%s abre uma rota de tela real do App.tsx (não redirect) com o mesmo guarda",
    (_key, entry) => {
      const block = routes.get(segmentOf(entry.path));
      expect(block, `rota ${entry.path} não existe em App.tsx`).toBeDefined();
      const afterName = block!.slice(block!.indexOf('"') + 1).trimStart();
      expect(afterName.startsWith("element={<Navigate"), `${entry.path} é redirect`).toBe(false);
      const guard = block!.match(/requiredInternalPage="([^"]+)"/)?.[1] ?? null;
      expect(guard).toBe(entry.routeGuard);
    }
  );

  it("itens do menu e módulos de operador apontam para rotas que existem", () => {
    const urls = [
      ...OPERACAO_ITEMS,
      ...AGENTE_IA_ITEMS,
      ...CANAIS_ITEMS,
      ...GERACAO_DIGITAL_ITEMS,
      ...TRAFEGO_ITEMS,
      ...LIVPUB_ITEMS,
      ...AJUDA_ITEMS,
      ...ADMIN_ITEMS,
      ...OPERATOR_MODULES,
    ].map((item) => item.url);
    for (const url of urls) {
      expect(routes.has(segmentOf(url)), `menu aponta para ${url}, que não existe`).toBe(true);
    }
  });
});

describe("rota padrão pós-login", () => {
  it.each(INTERNAL_PAGES.map((p) => [p.key] as const))(
    "usuário só com %s não cai em URL inexistente",
    (key) => {
      const target = getDefaultInternalRoute([key]);
      expect(routes.has(segmentOf(target))).toBe(true);
    }
  );

  it("fila-de-followup sem planilhas não manda para /crm/followup (o guarda devolveria para /crm em laço)", () => {
    expect(getDefaultInternalRoute(["fila-de-followup"])).toBe("/crm/dashboard");
    expect(getDefaultInternalRoute(["fila-de-followup", "planilhas"])).toBe("/crm/planilhas");
  });

  it("disparos e chatbot-kanban levam à tela certa", () => {
    expect(getDefaultInternalRoute(["disparos", "planilhas"])).toBe("/crm/planilhas");
    expect(getDefaultInternalRoute(["chatbot-kanban"])).toBe("/crm/agente");
    expect(getDefaultInternalRoute(["onboarding-wizard"])).toBe("/crm/onboarding");
  });

  it("admin e usuário com dashboard continuam indo para o dashboard", () => {
    expect(getDefaultInternalRoute([], true)).toBe("/crm/dashboard");
    expect(getDefaultInternalRoute(["dashboard", "whatsapp"])).toBe("/crm/dashboard");
  });

  it("filtro de aba contratada é respeitado", () => {
    const target = findFirstOpenableInternalPage(
      () => true,
      (page) => isInternalPageAllowedForClient(page, ["conversas"])
    );
    expect(target?.path).toBe("/crm/whatsapp");
  });
});

describe("aba contratada por página (isInternalPageAllowedForClient)", () => {
  // Mapa que existia em access.ts antes do registro; o comportamento tem que ser o mesmo.
  const legacy: Record<string, string> = {
    dashboard: "dashboard",
    "banco-de-dados": "leads",
    planilhas: "campanhas",
    whatsapp: "conversas",
    usuarios: "usuarios",
    campanhas: "campanhas",
    "inteligencia-comercial": "inteligencia",
    "chatbot-kanban": "chatbot-kanban",
    "chatbot-config": "chatbot",
    followup: "followup",
    "fila-de-followup": "followup",
    "followup-empresas": "followup",
    "followup-campanhas": "followup",
    "followup-analytics": "followup",
    "followup-sugestoes": "followup",
    "chatbot-docs": "chatbot-docs",
    "onboarding-wizard": "onboarding",
    apresentacao: "apresentacao",
    conexoes: "conexoes",
    aquecimento: "aquecimento",
    "apresentacao-gd": "apresentacao-gd",
    "briefings-gd": "briefings-gd",
    "propostas-gd": "propostas-gd",
    "contratos-gd": "contratos-gd",
    "pacotes-gd": "pacotes-gd",
    "condicoes-gd": "condicoes-gd",
    eventos: "eventos",
    relacionamento: "relacionamento",
    livpub: "livpub",
    integracoes: "integracoes",
    agente: "inbound-agents",
  };

  it.each(INTERNAL_PAGES.map((p) => [p.key] as const))("%s decide igual ao mapa antigo", (key) => {
    const tab = legacy[key];
    const otherTabs = ["nenhuma-aba"];
    // Sem aba mapeada (ou empresas): sempre liberado.
    expect(isInternalPageAllowedForClient(key, otherTabs)).toBe(!tab);
    if (tab) expect(isInternalPageAllowedForClient(key, [tab])).toBe(true);
  });

  it("aliases fora do registro continuam iguais", () => {
    expect(isInternalPageAllowedForClient("inbound-agents", ["inbound-agents"])).toBe(true);
    expect(isInternalPageAllowedForClient("inbound-agents", ["x"])).toBe(false);
    expect(isInternalPageAllowedForClient("calendario", ["followup"])).toBe(true);
    expect(isInternalPageAllowedForClient("pagina-desconhecida", ["x"])).toBe(true);
    expect(isInternalPageAllowedForClient("dashboard", null)).toBe(true);
  });
});
