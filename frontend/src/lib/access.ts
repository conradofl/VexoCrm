export const INTERNAL_PAGE_ORDER = [
  "dashboard",
  "leads",
  "planilhas",
  "whatsapp",
  "agente",
  "usuarios",
  "empresas",
  "campanhas",
  "inteligencia-comercial",
  "chatbot-kanban",
  "chatbot-config",
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
  "relatorios",
  "apresentacao",
  "apresentacao-gd",
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
  | "users.manage";
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
    email: "luizz.felipe.santos17@gmail.com",
    uid: "IozfnQTmWHQAxopr3FyNb1SdYs52",
  },
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
      "leads",
      "planilhas",
      "whatsapp",
      "agente",
      "usuarios",
      "campanhas",
      "conexoes",
      "disparos",
      "aquecimento",
      "relatorios",
      "onboarding-wizard",
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
      "imports.manage",
      "whatsapp.view",
      "whatsapp.reply",
    ],
    internalPages: ["dashboard", "leads", "whatsapp", "onboarding-wizard"],
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
    ],
    internalPages: [],
    allowedViews: [...CLIENT_VIEW_ORDER],
  },
  client_operator: {
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "operator",
    permissions: ["dashboard.view", "leads.view", "whatsapp.view", "whatsapp.reply"],
    internalPages: [],
    allowedViews: ["dashboard", "leads", "whatsapp"],
  },
  client_viewer: {
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "none",
    permissions: ["dashboard.view", "leads.view"],
    internalPages: [],
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

export function normalizeAccessPreset(value: unknown, role: AccessRole = "internal"): AccessPreset {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";

  if ((ACCESS_PRESET_ORDER as readonly string[]).includes(normalized)) {
    const preset = normalized as SystemAccessPreset;
    const presetRole = PRESET_DEFAULTS[preset].role;
    return presetRole === role ? preset : getDefaultPresetForRole(role);
  }

  if (normalized) {
    return normalized;
  }

  return getDefaultPresetForRole(role);
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

export function canAccessInternalPage(
  page: InternalPage,
  internalPages: InternalPage[],
  isAdmin = false
): boolean {
  return isAdmin || internalPages.includes(page);
}

export function isInternalPageAllowedForClient(
  page: string,
  allowedTabs: string[] | null | undefined
): boolean {
  if (!allowedTabs || !Array.isArray(allowedTabs)) return true;

  const pageToTabKey: Record<string, string> = {
    dashboard: "dashboard",
    leads: "leads",
    planilhas: "campanhas",
    whatsapp: "conversas",
    usuarios: "usuarios",
    empresas: "empresas",
    campanhas: "campanhas",
    "inteligencia-comercial": "inteligencia",
    "chatbot-kanban": "chatbot-kanban",
    "chatbot-config": "chatbot",
    "fila-de-followup": "followup",
    "followup-empresas": "followup",
    "followup-campanhas": "followup",
    "followup-analytics": "followup",
    "followup-sugestoes": "followup",
    "chatbot-docs": "chatbot-docs",
    "onboarding-wizard": "onboarding",
    "apresentacao": "apresentacao",
    conexoes: "conexoes",
    aquecimento: "aquecimento",
    relatorios: "relatorios",
    "apresentacao-gd": "apresentacao-gd",
    "inbound-agents": "inbound-agents",
    integracoes: "integracoes",
    eventos: "eventos",
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
  else if (path.includes("/crm/leads")) tabKey = "leads";
  else if (path.includes("/crm/whatsapp")) tabKey = "conversas";
  else if (path.includes("/crm/inteligencia-comercial")) tabKey = "inteligencia";
  else if (path.includes("/crm/chatbot-settings")) tabKey = "chatbot";
  else if (path.includes("/crm/chatbot-docs")) tabKey = "chatbot-docs";
  else if (path.includes("/crm/chatbot")) tabKey = "chatbot-kanban";
  else if (path.includes("/crm/followup")) tabKey = "followup";
  else if (path.includes("/crm/conexoes")) tabKey = "conexoes";
  else if (path.includes("/crm/planilhas")) tabKey = "campanhas";
  else if (path.includes("/crm/aquecimento")) tabKey = "aquecimento";
  else if (path.includes("/crm/relatorios")) tabKey = "relatorios";
  else if (path.includes("/crm/apresentacao-gd")) tabKey = "apresentacao-gd";
  else if (path.includes("/crm/apresentacao")) tabKey = "apresentacao";
  else if (path.includes("/crm/onboarding")) tabKey = "onboarding";
  else if (path.includes("/crm/usuarios")) tabKey = "usuarios";
  else if (path.includes("/crm/inbound-agents")) tabKey = "inbound-agents";
  else if (path.includes("/crm/integracoes")) tabKey = "integracoes";
  else if (path.includes("/crm/eventos")) tabKey = "eventos";

  if (!tabKey) return true;
  return allowedTabs.includes(tabKey);
}
