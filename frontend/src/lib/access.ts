export const INTERNAL_PAGE_ORDER = [
  "dashboard",
  "planilhas",
  "whatsapp",
  "agente",
  "usuarios",
  "empresas",
  "campanhas",
  "inteligencia-comercial",
  "chatbot-kanban",
  "chatbot-config",
  "followup",
  "fila-de-followup",
  "followup-empresas",
  "followup-campanhas",
  "followup-analytics",
  "followup-sugestoes",
  "chatbot-docs",
  "onboarding-wizard",
  "onboarding-agent",
  "conexoes",
  "disparos",
  "aquecimento",
  "apresentacao",
  "apresentacao-gd",
  "briefings-gd",
  "propostas-gd",
  "contratos-gd",
  "pacotes-gd",
  "condicoes-gd",
  "integracoes",
  "eventos",
  "relacionamento",
  "livpub",
  "banco-de-dados",
] as const;

export type InternalPage = (typeof INTERNAL_PAGE_ORDER)[number];
export type AccessView = "dashboard" | "leads" | "planilhas" | "whatsapp";
export type AccessRole = "internal" | "client" | "pending";
export type AccessScope = "all_clients" | "assigned_clients" | "no_client_access";
export type ApprovalLevel = "none" | "operator" | "supervisor" | "manager" | "director";
export type AccessPermission =
  | "dashboard.view"
  | "leads.view"
  | "leads.export"
  | "imports.manage"
  | "whatsapp.view"
  | "whatsapp.reply"
  | "campaigns.manage"
  | "agente.view"
  | "tenants.manage"
  | "users.view"
  | "users.manage"
  | "banco_dados.view"
  | "banco_dados.import"
  | "banco_dados.extract_wa"
  | "whatsapp.chips_view"
  | "whatsapp.chips_add"
  | "campaigns.view"
  | "campaigns.create"
  | "campaigns.delete"
  | "dispatches.execute"
  | "dispatches.pause"
  | "dispatches.export_failed";
export type SystemAccessPreset =
  | "admin_vexo"
  | "gestor"
  | "operador"
  | "parceiro"
  | "client_manager"
  | "client_operator"
  | "client_viewer"
  | "pending";
export type AccessPreset = string;

export const CLIENT_VIEW_ORDER: AccessView[] = ["dashboard", "leads", "planilhas", "whatsapp"];
export const ACCESS_SCOPE_ORDER: AccessScope[] = [
  "all_clients",
  "assigned_clients",
  "no_client_access",
];
export const APPROVAL_LEVEL_ORDER: ApprovalLevel[] = [
  "none",
  "operator",
  "supervisor",
  "manager",
  "director",
];
export const ACCESS_PERMISSION_ORDER: AccessPermission[] = [
  "dashboard.view",
  "leads.view",
  "leads.export",
  "imports.manage",
  "whatsapp.view",
  "whatsapp.reply",
  "campaigns.manage",
  "agente.view",
  "tenants.manage",
  "users.view",
  "users.manage",
];
export const ACCESS_PRESET_ORDER: AccessPreset[] = [
  "admin_vexo",
  "gestor",
  "operador",
  "parceiro",
  "client_manager",
  "client_operator",
  "client_viewer",
  "pending",
];

export const USER_MANAGEMENT_PRESETS: AccessPreset[] = [
  "gestor",
];

export const FIXED_ADMIN_ACCOUNTS = [
  {
    email: "conradofl@gmail.com",
    uid: "pKpOKg3Fttf6AnYsTzZD7xjJLaN2",
  },
] as const;

export const ACCESS_SCOPE_LABELS: Record<AccessScope, string> = {
  all_clients: "Todos os tenants",
  assigned_clients: "Tenants vinculados",
  no_client_access: "Sem escopo operacional",
};

export const APPROVAL_LEVEL_LABELS: Record<ApprovalLevel, string> = {
  none: "Sem alcada",
  operator: "Operacional",
  supervisor: "Supervisor",
  manager: "Gerente",
  director: "Diretoria",
};

export const ACCESS_PRESET_LABELS: Record<string, string> = {
  admin_vexo: "Admin Vexo",
  gestor: "Gestor",
  operador: "Operador",
  parceiro: "Parceiro",
  client_manager: "Gestor do cliente",
  client_operator: "Operador do cliente",
  client_viewer: "Leitura do cliente",
  pending: "Aguardando aprovacao",
};

export const ACCESS_PERMISSION_DEFINITIONS: Record<
  AccessPermission,
  { label: string; description: string }
> = {
  "dashboard.view": {
    label: "Dashboard",
    description: "Pode consultar indicadores, paineis do CRM e a aba Inteligencia Comercial.",
  },
  "leads.view": {
    label: "Leads",
    description: "Pode listar e consultar bases de leads.",
  },
  "leads.export": {
    label: "Exportar leads",
    description: "Pode extrair ou baixar dados operacionais de leads.",
  },
  "imports.manage": {
    label: "Planilhas",
    description: "Pode importar, revisar e auditar planilhas.",
  },
  "whatsapp.view": {
    label: "WhatsApp inbox",
    description: "Pode abrir a caixa de entrada e consultar conversas.",
  },
  "whatsapp.reply": {
    label: "Responder WhatsApp",
    description: "Pode enviar mensagens e atuar no atendimento.",
  },
  "campaigns.manage": {
    label: "Campanhas",
    description: "Pode criar, configurar, agendar e disparar campanhas.",
  },
  "agente.view": {
    label: "Agente",
    description: "Pode ler alertas operacionais e notificacoes tecnicas.",
  },
  "tenants.manage": {
    label: "Empresas",
    description: "Pode criar e organizar tenants/empresas que usam o CRM.",
  },
  "users.view": {
    label: "Usuarios",
    description: "Pode consultar usuarios, acessos e aprovacoes.",
  },
  "users.manage": {
    label: "Gerenciar usuarios",
    description: "Pode criar, editar e reconfigurar acessos.",
  },
  "banco_dados.view": {
    label: "Banco de dados (Visualizar)",
    description: "Pode consultar contatos e bases no banco de dados.",
  },
  "banco_dados.import": {
    label: "Banco de dados (Importar)",
    description: "Pode importar contatos para o banco de dados.",
  },
  "banco_dados.extract_wa": {
    label: "Banco de dados (Extrair WhatsApp)",
    description: "Pode sincronizar contatos de instâncias de WhatsApp para o banco.",
  },
  "whatsapp.chips_view": {
    label: "Chips WhatsApp (Visualizar)",
    description: "Pode listar chips e verificar status de conexão.",
  },
  "whatsapp.chips_add": {
    label: "Chips WhatsApp (Conectar)",
    description: "Pode ler QR code e conectar novas instâncias de WhatsApp.",
  },
  "campaigns.view": {
    label: "Campanhas (Visualizar)",
    description: "Pode consultar a lista e detalhes de campanhas.",
  },
  "campaigns.create": {
    label: "Campanhas (Criar)",
    description: "Pode criar e configurar novas campanhas.",
  },
  "campaigns.delete": {
    label: "Campanhas (Excluir)",
    description: "Pode remover campanhas.",
  },
  "dispatches.execute": {
    label: "Disparos (Executar)",
    description: "Pode iniciar e rodar lotes de disparos de campanhas.",
  },
  "dispatches.pause": {
    label: "Disparos (Pausar)",
    description: "Pode pausar lotes de disparos em andamento.",
  },
  "dispatches.export_failed": {
    label: "Disparos (Exportar falhas)",
    description: "Pode exportar relatórios de disparos com erro.",
  },
};

type PresetDefaults = {
  role: AccessRole;
  scopeMode: AccessScope;
  approvalLevel: ApprovalLevel;
  permissions: AccessPermission[];
  internalPages: InternalPage[];
  allowedViews: AccessView[];
};

const PRESET_DEFAULTS: Record<SystemAccessPreset, PresetDefaults> = {
  admin_vexo: {
    role: "internal",
    scopeMode: "all_clients",
    approvalLevel: "director",
    permissions: [...ACCESS_PERMISSION_ORDER],
    internalPages: [...INTERNAL_PAGE_ORDER],
    allowedViews: [],
  },
  gestor: {
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "manager",
    permissions: [
      "dashboard.view",
      "leads.view",
      "leads.export",
      "imports.manage",
      "whatsapp.view",
      "whatsapp.reply",
      "campaigns.manage",
      "agente.view",
      "users.view",
      "users.manage",
    ],
    internalPages: [
      "dashboard",
      "banco-de-dados",
      "planilhas",
      "whatsapp",
      "agente",
      "usuarios",
      "campanhas",
      "followup",
      "fila-de-followup",
      "conexoes",
      "disparos",
      "aquecimento",
      "onboarding-wizard",
      "apresentacao",
      "eventos",
      "relacionamento",
      "livpub",
    ],
    allowedViews: [],
  },
  operador: {
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "operator",
    permissions: [
      "dashboard.view",
      "leads.view",
      "banco_dados.view",
      "banco_dados.import",
      "banco_dados.extract_wa",
      "imports.manage",
      "whatsapp.view",
      "whatsapp.reply",
      "whatsapp.chips_view",
      "whatsapp.chips_add",
      "campaigns.view",
      "campaigns.create",
      "campaigns.delete",
      "campaigns.manage",
      "dispatches.execute",
      "dispatches.pause",
      "dispatches.export_failed",
      "agente.view",
    ],
    internalPages: [
      "dashboard",
      "banco-de-dados",
      "whatsapp",
      "conexoes",
      "campanhas",
      "disparos",
      "planilhas",
      "agente",
    ],
    allowedViews: [],
  },
  parceiro: {
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "supervisor",
    permissions: ["dashboard.view", "leads.view", "whatsapp.view"],
    internalPages: [],
    allowedViews: ["dashboard", "leads", "whatsapp"],
  },
  client_manager: {
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "manager",
    permissions: [
      "dashboard.view",
      "leads.view",
      "leads.export",
      "imports.manage",
      "whatsapp.view",
      "whatsapp.reply",
      "campaigns.manage",
      "agente.view",
    ],
    internalPages: [
      "dashboard",
      "banco-de-dados",
      "whatsapp",
      "followup",
      "fila-de-followup",
      "campanhas",
      "planilhas",
      "agente",
      "conexoes",
      "onboarding-wizard",
    ],
    allowedViews: [...CLIENT_VIEW_ORDER],
  },
  client_operator: {
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "operator",
    permissions: [
      "dashboard.view",
      "leads.view",
      "whatsapp.view",
      "whatsapp.reply",
      "campaigns.manage",
      "agente.view",
    ],
    internalPages: [
      "dashboard",
      "banco-de-dados",
      "whatsapp",
      "followup",
      "fila-de-followup",
      "campanhas",
      "planilhas",
      "agente",
      "conexoes",
      "onboarding-wizard",
    ],
    allowedViews: ["dashboard", "leads", "whatsapp"],
  },
  client_viewer: {
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "none",
    permissions: ["dashboard.view", "leads.view"],
    internalPages: ["dashboard"],
    allowedViews: ["dashboard", "leads"],
  },
  pending: {
    role: "pending",
    scopeMode: "no_client_access",
    approvalLevel: "none",
    permissions: [],
    internalPages: [],
    allowedViews: [],
  },
};

export function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined) return null;

  const normalized = String(value).trim();
  if (!normalized) return null;

  return normalized.startsWith("=") ? normalized.slice(1).trim() : normalized;
}

export function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(
        value
          .map((item) => (typeof item === "string" ? item.trim() : ""))
          .filter(Boolean)
      )
    );
  }

  if (typeof value === "string" && value.trim()) {
    return Array.from(new Set(value.split(",").map((item) => item.trim()).filter(Boolean)));
  }

  return [];
}

export function normalizeAccessRole(value: unknown): AccessRole {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (normalized === "client" || normalized === "cliente" || normalized === "customer") {
    return "client";
  }

  if (normalized === "pending" || normalized === "pendente" || normalized === "pending_client") {
    return "pending";
  }

  return "internal";
}

export function getDefaultPresetForRole(role: AccessRole): AccessPreset {
  if (role === "client") return "client_operator";
  if (role === "pending") return "pending";
  return "operador";
}

function getPresetFallbackKey(preset: string | null | undefined): SystemAccessPreset {
  const normalized = typeof preset === "string" ? preset.trim().toLowerCase() : "";

  if (normalized === "pending" || normalized.startsWith("pending")) {
    return "pending";
  }

  if (normalized.startsWith("client")) {
    return "client_operator";
  }

  return "operador";
}

/**
 * Espelho de resolveAccessPreset em backend/src/access/claims.js. A autoridade é
 * o backend; aqui só se decide o que desenhar. accessPresetParity.test.js falha
 * se as duas listas divergirem.
 *
 * O ramo `if (normalized) return normalized;` que existia aqui devolvia qualquer
 * string de volta — um normalizador que não normalizava. O preset desconhecido
 * atravessava, era reenviado no PATCH e só então o backend recusava com
 * "Unsupported access preset", sem dizer qual valor era.
 */
export function resolveAccessPreset(
  value: unknown,
  role: AccessRole = "internal"
): { preset: AccessPreset; ajustado: boolean; recebido: string | null; motivo: string | null } {
  const bruto = typeof value === "string" ? value.trim() : "";
  const normalized = bruto.toLowerCase();

  if (!normalized) {
    return { preset: getDefaultPresetForRole(role), ajustado: false, recebido: null, motivo: null };
  }

  if ((ACCESS_PRESET_ORDER as readonly string[]).includes(normalized)) {
    const preset = normalized as SystemAccessPreset;
    if (PRESET_DEFAULTS[preset].role === role) {
      return { preset, ajustado: false, recebido: bruto, motivo: null };
    }
    return {
      preset: getDefaultPresetForRole(role),
      ajustado: true,
      recebido: bruto,
      motivo: "papel_incompativel",
    };
  }

  return {
    preset: getDefaultPresetForRole(role),
    ajustado: true,
    recebido: bruto,
    motivo: "preset_desconhecido",
  };
}

export function normalizeAccessPreset(value: unknown, role: AccessRole = "internal"): AccessPreset {
  return resolveAccessPreset(value, role).preset;
}

export function buildPresetDefaults(preset: AccessPreset): PresetDefaults {
  const defaults = PRESET_DEFAULTS[preset as SystemAccessPreset] || PRESET_DEFAULTS[getPresetFallbackKey(preset)];

  return {
    role: defaults.role,
    scopeMode: defaults.scopeMode,
    approvalLevel: defaults.approvalLevel,
    permissions: [...defaults.permissions],
    internalPages: [...defaults.internalPages],
    allowedViews: [...defaults.allowedViews],
  };
}

export function normalizeAccessScope(value: unknown, role: AccessRole): AccessScope {
  if (role === "pending") {
    return "no_client_access";
  }

  if (role === "client") {
    return "assigned_clients";
  }

  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

  if (
    normalized === "all_clients" ||
    normalized === "all" ||
    normalized === "global" ||
    normalized === "all_tenants"
  ) {
    return "all_clients";
  }

  if (
    normalized === "assigned_clients" ||
    normalized === "assigned" ||
    normalized === "restricted" ||
    normalized === "assigned_tenants"
  ) {
    return "assigned_clients";
  }

  if (
    normalized === "no_client_access" ||
    normalized === "none" ||
    normalized === "no_access" ||
    normalized === "sem_escopo"
  ) {
    return "no_client_access";
  }

  return "all_clients";
}

export function normalizeApprovalLevel(value: unknown, role: AccessRole): ApprovalLevel {
  if (role === "pending") {
    return "none";
  }

  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

  if ((APPROVAL_LEVEL_ORDER as readonly string[]).includes(normalized)) {
    return normalized as ApprovalLevel;
  }

  return buildPresetDefaults(getDefaultPresetForRole(role)).approvalLevel;
}

export function getAccessPresetLabel(value: string | null | undefined): string {
  const normalized = normalizeString(value)?.toLowerCase();

  if (!normalized) {
    return "Tipo sem nome";
  }

  return (
    ACCESS_PRESET_LABELS[normalized] ||
    normalized
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

export function normalizePermissions(
  value: unknown,
  role: AccessRole,
  preset: AccessPreset = getDefaultPresetForRole(role)
): AccessPermission[] {
  if (role === "pending") {
    return [];
  }

  const selected = normalizeStringArray(value).filter(
    (item): item is AccessPermission =>
      (ACCESS_PERMISSION_ORDER as readonly string[]).includes(item)
  );

  if (selected.length > 0) {
    return Array.from(new Set(selected));
  }

  return buildPresetDefaults(preset).permissions;
}

export function normalizeInternalPages(
  value: unknown,
  isAdmin = false,
  preset: AccessPreset = "internal_operator"
): InternalPage[] {
  if (isAdmin) {
    return [...INTERNAL_PAGE_ORDER];
  }

  const pages = normalizeStringArray(value).filter(
    (item): item is InternalPage => (INTERNAL_PAGE_ORDER as readonly string[]).includes(item)
  );

  if (pages.length === 0) {
    return buildPresetDefaults(preset).internalPages;
  }

  return Array.from(new Set(pages));
}

export function normalizeAllowedViews(
  value: unknown,
  role: AccessRole,
  preset: AccessPreset = getDefaultPresetForRole(role)
): AccessView[] {
  const views = normalizeStringArray(value).filter(
    (item): item is AccessView =>
      item === "dashboard" || item === "leads" || item === "planilhas" || item === "whatsapp"
  );

  if (role === "client" && views.length === 0) {
    return buildPresetDefaults(preset).allowedViews;
  }

  return Array.from(new Set(views));
}

export function isFixedAdminAccount(uid: string | null | undefined, email: string | null | undefined) {
  return FIXED_ADMIN_ACCOUNTS.some(
    (item) => (uid && item.uid === uid) || (email && item.email.toLowerCase() === email.toLowerCase())
  );
}

export function getDefaultInternalRoute(
  internalPages: InternalPage[],
  isAdmin = false
): string {
  const pages = isAdmin ? [...INTERNAL_PAGE_ORDER] : internalPages;

  for (const page of INTERNAL_PAGE_ORDER) {
    if (pages.includes(page)) {
      return `/crm/${page}`;
    }
  }

  return "/crm/dashboard";
}

export function getDefaultClientRoute(clientId: string, allowedViews: AccessView[]): string {
  for (const view of CLIENT_VIEW_ORDER) {
    if (allowedViews.includes(view)) {
      return `/clientes/${clientId}/${view}`;
    }
  }

  return `/clientes/${clientId}/dashboard`;
}

import { resolveTenantPlan, hasFeatureUnlocked } from "./planTier";

export function isInternalPageAllowed(
  internalPages: InternalPage[],
  page: InternalPage,
  isAdmin = false
): boolean {
  return isAdmin || internalPages.includes(page);
}

export function getInheritedPlanPages(planTier?: string | null, client?: any): InternalPage[] {
  const tier = resolveTenantPlan(client || { plan_tier: planTier });
  if (tier === "avancado") {
    return [...INTERNAL_PAGE_ORDER];
  }
  return [
    "dashboard",
    "banco-de-dados",
    "whatsapp",
    "followup",
    "fila-de-followup",
    "campanhas",
    "planilhas",
    "agente",
    "conexoes",
    "onboarding-wizard",
    "apresentacao",
  ];
}

export function isInternalPageAllowedForClient(
  page: string,
  allowedTabs: string[] | null | undefined
): boolean {
  if (!allowedTabs || !Array.isArray(allowedTabs)) return true;

  const pageToTabKey: Record<string, string> = {
    dashboard: "dashboard",
    "banco-de-dados": "leads",
    planilhas: "campanhas",
    whatsapp: "conversas",
    usuarios: "usuarios",
    empresas: "empresas",
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
    "inbound-agents": "inbound-agents",
    integracoes: "integracoes",
    agente: "inbound-agents",
  };

  const tabKey = pageToTabKey[page];
  if (!tabKey) return true;
  if (tabKey === "empresas") return true;

  return allowedTabs.includes(tabKey);
}

export function isPathAllowedForClient(
  path: string,
  allowedTabs: string[] | null | undefined
): boolean {
  if (!allowedTabs || !Array.isArray(allowedTabs)) return true;

  let tabKey = "";
  if (path.includes("/crm/dashboard")) tabKey = "dashboard";
  else if (path.includes("/crm/banco-de-dados")) tabKey = "leads";
  else if (path.includes("/crm/whatsapp")) tabKey = "conversas";
  else if (path.includes("/crm/inteligencia-comercial")) tabKey = "inteligencia";
  else if (path.includes("/crm/chatbot-settings") || (path.includes("/crm/agente") && path.includes("tab=settings"))) tabKey = "chatbot";
  else if (path.includes("/crm/chatbot-docs") || (path.includes("/crm/agente") && path.includes("tab=docs"))) tabKey = "chatbot-docs";
  else if (path.includes("/crm/inbound-agents") || (path.includes("/crm/agente") && path.includes("tab=inbound"))) tabKey = "inbound-agents";
  else if (path.includes("/crm/chatbot") || (path.includes("/crm/agente") && (path.includes("tab=operacao") || !path.includes("tab=")))) tabKey = "chatbot-kanban";
  else if (path.includes("/crm/followup")) tabKey = "followup";
  else if (path.includes("/crm/chips-whatsapp") || path.includes("/crm/conexoes") || path.includes("/crm/aquecimento")) {
    if (path.includes("tab=aquecimento") || path.includes("/crm/aquecimento")) tabKey = "aquecimento";
    else tabKey = "conexoes";
  }
  else if (path.includes("/crm/planilhas")) tabKey = "campanhas";
  else if (path.includes("/crm/relatorios")) tabKey = "campanhas";
  else if (path.includes("/crm/geracao-digital") || path.includes("/crm/apresentacao-gd") || path.includes("/crm/briefings-gd") || path.includes("/crm/propostas-gd") || path.includes("/crm/contratos-gd") || path.includes("/crm/pacotes-gd") || path.includes("/crm/condicoes-gd")) {
    if (path.includes("tab=briefings") || path.includes("/crm/briefings-gd")) tabKey = "briefings-gd";
    else if (path.includes("/crm/propostas-gd")) tabKey = "propostas-gd";
    else if (path.includes("/crm/contratos-gd")) tabKey = "contratos-gd";
    else if (path.includes("/crm/pacotes-gd")) tabKey = "pacotes-gd";
    else if (path.includes("/crm/condicoes-gd")) tabKey = "condicoes-gd";
    else tabKey = "apresentacao-gd";
  }
  else if (path.includes("/crm/apresentacao")) {
    tabKey = "apresentacao";
  }
  else if (path.includes("/crm/livpub") || path.includes("/crm/eventos") || path.includes("/crm/relacionamento")) {
    if (path.includes("tab=eventos") || path.includes("/crm/eventos")) tabKey = "eventos";
    else if (path.includes("tab=relacionamento") || path.includes("/crm/relacionamento")) tabKey = "relacionamento";
    else tabKey = "livpub";
  }
  else if (path.includes("/crm/onboarding")) tabKey = "onboarding";
  else if (path.includes("/crm/admin") || path.includes("/crm/empresas") || path.includes("/crm/usuarios") || path.includes("/crm/integracoes")) {
    if (path.includes("tab=usuarios") || path.includes("/crm/usuarios")) tabKey = "usuarios";
    else if (path.includes("tab=integracoes") || path.includes("/crm/integracoes")) tabKey = "integracoes";
    else tabKey = "empresas";
  }

  if (!tabKey) return true;
  return allowedTabs.includes(tabKey);
}

/**
 * Espelho de UI para exibição condicional de controles restritos a gestor/admin.
 * A decisão de autorização real e definitiva é SEMPRE validada pelo servidor backend (403).
 */
export function isManagerOrAdmin(access: any): boolean {
  if (!access) return false;
  if (access.isFixedAdmin || access.isAdmin || access.isAdminUser || access.role === "superadmin") return true;
  if (access.approvalLevel === "manager" || access.approvalLevel === "director") return true;
  if (Array.isArray(access.internalPages) && access.internalPages.includes("usuarios")) return true;
  if (Array.isArray(access.permissions) && (access.permissions.includes("users.manage") || access.permissions.includes("users.view"))) return true;
  return false;
}
