// Registro único das páginas internas do CRM.
//
// Cada chave de permissão (InternalPage) diz aqui, num lugar só:
// - path: a URL que abre a tela (a rota final em App.tsx, sem passar por redirect quebrado);
// - routeGuard: a página que essa rota exige em `requiredInternalPage` no App.tsx
//   (null quando a rota não exige página). O teste pagesRegistry.test.ts confere
//   que App.tsx e este registro dizem a mesma coisa;
// - tenantTab: a aba contratada da empresa (n8n_settings.allowed_tabs) que libera a página
//   (null = não depende de aba).
//
// A ordem da lista é a ordem de preferência da rota padrão pós-login.
// O conjunto de chaves tem que ser igual a INTERNAL_PAGE_KEYS do backend
// (backend/src/access/claims.js); o teste também confere isso.

export type InternalPageEntry = {
  readonly key: string;
  readonly path: string;
  readonly routeGuard: string | null;
  readonly tenantTab: string | null;
};

export const INTERNAL_PAGES = [
  { key: "dashboard", path: "/crm/dashboard", routeGuard: "dashboard", tenantTab: "dashboard" },
  { key: "planilhas", path: "/crm/planilhas", routeGuard: "planilhas", tenantTab: "campanhas" },
  { key: "whatsapp", path: "/crm/whatsapp", routeGuard: "whatsapp", tenantTab: "conversas" },
  { key: "agente", path: "/crm/agente", routeGuard: null, tenantTab: "inbound-agents" },
  { key: "usuarios", path: "/crm/admin?tab=usuarios", routeGuard: null, tenantTab: "usuarios" },
  // Empresas não depende de aba contratada (a regra de quem vê fica em canAccessInternalPage).
  { key: "empresas", path: "/crm/admin?tab=empresas", routeGuard: null, tenantTab: null },
  { key: "campanhas", path: "/crm/planilhas", routeGuard: "planilhas", tenantTab: "campanhas" },
  { key: "inteligencia-comercial", path: "/crm/inteligencia-comercial", routeGuard: "dashboard", tenantTab: "inteligencia" },
  { key: "chatbot-kanban", path: "/crm/agente", routeGuard: null, tenantTab: "chatbot-kanban" },
  { key: "chatbot-config", path: "/crm/agente", routeGuard: null, tenantTab: "chatbot" },
  { key: "followup", path: "/crm/followup", routeGuard: "planilhas", tenantTab: "followup" },
  { key: "fila-de-followup", path: "/crm/followup", routeGuard: "planilhas", tenantTab: "followup" },
  { key: "followup-empresas", path: "/crm/followup", routeGuard: "planilhas", tenantTab: "followup" },
  { key: "followup-campanhas", path: "/crm/followup", routeGuard: "planilhas", tenantTab: "followup" },
  { key: "followup-analytics", path: "/crm/followup", routeGuard: "planilhas", tenantTab: "followup" },
  { key: "followup-sugestoes", path: "/crm/followup", routeGuard: "planilhas", tenantTab: "followup" },
  { key: "chatbot-docs", path: "/crm/agente?tab=docs", routeGuard: null, tenantTab: "chatbot-docs" },
  { key: "onboarding-wizard", path: "/crm/onboarding", routeGuard: null, tenantTab: "onboarding" },
  { key: "onboarding-agent", path: "/crm/implantacao", routeGuard: null, tenantTab: null },
  { key: "conexoes", path: "/crm/chips-whatsapp?tab=conexoes", routeGuard: null, tenantTab: "conexoes" },
  { key: "disparos", path: "/crm/planilhas", routeGuard: "planilhas", tenantTab: null },
  { key: "aquecimento", path: "/crm/chips-whatsapp?tab=aquecimento", routeGuard: null, tenantTab: "aquecimento" },
  { key: "apresentacao", path: "/crm/apresentacao", routeGuard: null, tenantTab: "apresentacao" },
  { key: "apresentacao-gd", path: "/crm/geracao-digital", routeGuard: null, tenantTab: "apresentacao-gd" },
  { key: "briefings-gd", path: "/crm/geracao-digital?tab=briefings", routeGuard: null, tenantTab: "briefings-gd" },
  { key: "propostas-gd", path: "/crm/propostas-gd", routeGuard: null, tenantTab: "propostas-gd" },
  { key: "contratos-gd", path: "/crm/contratos-gd", routeGuard: null, tenantTab: "contratos-gd" },
  { key: "pacotes-gd", path: "/crm/pacotes-gd", routeGuard: null, tenantTab: "pacotes-gd" },
  // Não há tela própria de condições: abre o painel da GD.
  { key: "condicoes-gd", path: "/crm/geracao-digital", routeGuard: null, tenantTab: "condicoes-gd" },
  { key: "integracoes", path: "/crm/admin?tab=integracoes", routeGuard: null, tenantTab: "integracoes" },
  { key: "eventos", path: "/crm/livpub?tab=eventos", routeGuard: "livpub", tenantTab: "eventos" },
  { key: "relacionamento", path: "/crm/livpub?tab=relacionamento", routeGuard: "livpub", tenantTab: "relacionamento" },
  { key: "livpub", path: "/crm/livpub", routeGuard: "livpub", tenantTab: "livpub" },
  { key: "banco-de-dados", path: "/crm/banco-de-dados", routeGuard: "banco-de-dados", tenantTab: "leads" },
  { key: "leads-parados", path: "/crm/leads-parados", routeGuard: "leads-parados", tenantTab: null },
  { key: "trafego", path: "/crm/trafego", routeGuard: "trafego", tenantTab: null },
] as const satisfies readonly InternalPageEntry[];

export type InternalPageKey = (typeof INTERNAL_PAGES)[number]["key"];

const BY_KEY = new Map<string, InternalPageEntry>(INTERNAL_PAGES.map((entry) => [entry.key, entry]));

export function getInternalPageEntry(page: string): InternalPageEntry | undefined {
  return BY_KEY.get(page);
}

/** URL que abre a página; undefined para chave desconhecida. */
export function getInternalPagePath(page: string): string | undefined {
  return BY_KEY.get(page)?.path;
}

/**
 * Primeira página (na ordem do registro) que o usuário consegue de fato abrir:
 * tem a página e passa no guarda da rota de destino. `canAccess` é a regra de acesso
 * do chamador (canAccessInternalPage, internalPages.includes, ...). `extraFilter`
 * aplica regras de empresa (aba contratada) quando o chamador precisa.
 */
export function findFirstOpenableInternalPage(
  canAccess: (page: InternalPageKey) => boolean,
  extraFilter: (page: InternalPageKey) => boolean = () => true
): (typeof INTERNAL_PAGES)[number] | undefined {
  return INTERNAL_PAGES.find(
    (entry) =>
      canAccess(entry.key) &&
      (entry.routeGuard === null || canAccess(entry.routeGuard)) &&
      extraFilter(entry.key)
  );
}
