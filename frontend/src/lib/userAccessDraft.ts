import { FileSpreadsheet, LineChart } from "lucide-react";
import type { AccessProfileRecord } from "@/hooks/useAccessProfiles";
import type { AdminUserRecord } from "@/hooks/useAdminUsers";
import type { LeadClient } from "@/hooks/useLeadClients";
import {
  ACCESS_PERMISSION_ORDER,
  buildPresetDefaults,
  CLIENT_VIEW_ORDER,
  getAccessPresetLabel,
  getDefaultPresetForRole,
  INTERNAL_PAGE_ORDER,
  isFixedAdminAccount,
  type AccessPermission,
  type AccessPreset,
  type AccessRole,
  type AccessScope,
  type AccessView,
  type ApprovalLevel,
  type InternalPage,
} from "@/lib/access";

export type ManagedRole = AccessRole;

export interface UserDraft {
  role: ManagedRole;
  accessPreset: AccessPreset;
  scopeMode: AccessScope;
  approvalLevel: ApprovalLevel;
  companyName: string;
  clientIds: string[];
  allowedViews: AccessView[];
  internalPages: InternalPage[];
  permissions: AccessPermission[];
  disabled: boolean;
}

export interface CreateUserDraft {
  email: string;
  password: string;
  displayName: string;
  role: ManagedRole;
  accessPreset: AccessPreset;
  scopeMode: AccessScope;
  approvalLevel: ApprovalLevel;
  companyName: string;
  clientIds: string[];
  allowedViews: AccessView[];
  internalPages: InternalPage[];
  permissions: AccessPermission[];
  sendPasswordReset: boolean;
  disabled: boolean;
}

export type AccessDraft = UserDraft | CreateUserDraft;

export type ActionFeedbackTone = "success" | "error";

export interface ActionFeedbackState {
  tone: ActionFeedbackTone;
  title: string;
  message: string;
  details?: string | null;
}

export const DEFAULT_INTERNAL_PAGES: InternalPage[] = ["dashboard"];
export const DEFAULT_CLIENT_VIEWS: AccessView[] = ["dashboard", "leads"];

export const ROLE_LABELS: Record<ManagedRole, string> = {
  internal: "Interno",
  client: "Cliente",
  pending: "Pendente",
};

export const ROLE_BADGE_CLASS: Record<ManagedRole, string> = {
  internal: "bg-primary/10 text-primary",
  client: "bg-[#1A5CFF]/10 text-[#1A5CFF]",
  pending: "bg-amber-500/10 text-amber-500",
};

export const ROLE_SCOPES: Record<ManagedRole, AccessScope[]> = {
  internal: ["all_clients", "assigned_clients", "no_client_access"],
  client: ["assigned_clients", "no_client_access"],
  pending: ["no_client_access"],
};

export const ROLE_APPROVAL_LEVELS: Record<ManagedRole, ApprovalLevel[]> = {
  internal: ["none", "operator", "supervisor", "manager", "director"],
  client: ["none", "operator", "supervisor", "manager"],
  pending: ["none"],
};

export const ROLE_PERMISSIONS: Record<ManagedRole, AccessPermission[]> = {
  internal: [...ACCESS_PERMISSION_ORDER],
  client: [
    "dashboard.view",
    "leads.view",
    "leads.export",
    "imports.manage",
    "whatsapp.view",
    "whatsapp.reply",
  ],
  pending: [],
};

export const VIEW_LABELS: Record<AccessView, string> = {
  dashboard: "Dashboard",
  leads: "Leads",
  planilhas: "Planilhas",
  whatsapp: "WhatsApp",
};

export const INTERNAL_PAGE_LABELS: Record<InternalPage, string> = {
  dashboard: "Dashboard",
  leads: "Leads",
  planilhas: "Planilhas",
  whatsapp: "WhatsApp",
  agente: "Agente",
  usuarios: "Usuários",
  empresas: "Empresas",
  campanhas: "Campanhas",
  "inteligencia-comercial": "Inteligência Comercial",
  "chatbot-kanban": "Chatbot Kanban",
  "chatbot-config": "Configuração do Chatbot",
  "fila-de-followup": "Fila de Followup",
  "followup-empresas": "Followup Empresas",
  "followup-campanhas": "Followup Campanhas",
  "followup-analytics": "Followup Analytics",
  "followup-sugestoes": "Followup Sugestões",
  "chatbot-docs": "Chatbot Docs",
  "onboarding-wizard": "Treinamento Vexo",
  "onboarding-agent": "Agente de Onboarding",
  conexoes: "Chips WhatsApp",
  disparos: "Disparos",
  aquecimento: "Aquecimento",
  relatorios: "Relatórios",
  apresentacao: "Demonstração Vexo",
  "apresentacao-gd": "Apresentação GD",
  "briefings-gd": "Briefings Salvos",
  followup: "Follow-up",
  integracoes: "Integrações",
  eventos: "Eventos",
  relacionamento: "Relacionamento",
  livpub: "LivPub",
};

export const CLIENT_PAGE_TABS = [
  { value: "portal", label: "Portal", items: ["dashboard", "leads", "planilhas"] as AccessView[] },
  { value: "comunicacao", label: "Comunicacao", items: ["whatsapp"] as AccessView[] },
];

export const INTERNAL_PAGE_TABS = [
  {
    value: "vendas",
    label: "Máquina de Vendas",
    items: [
      "dashboard",
      "leads",
      "whatsapp",
      "inteligencia-comercial",
      "chatbot-kanban",
      "chatbot-config",
      "fila-de-followup",
      "followup-empresas",
      "followup-campanhas",
      "followup-analytics",
      "followup-sugestoes",
    ] as InternalPage[],
  },
  {
    value: "disparos",
    label: "Máquina de Disparos",
    items: [
      "planilhas",
      "campanhas",
      "conexoes",
      "disparos",
      "aquecimento",
      "relatorios",
    ] as InternalPage[],
  },
  {
    value: "sistema",
    label: "Sistema",
    items: [
      "apresentacao",
      "apresentacao-gd",
      "onboarding-wizard",
      "chatbot-docs",
      "usuarios",
      "empresas",
    ] as InternalPage[],
  },
  {
    value: "configuracoes",
    label: "Configurações Extras",
    items: [
      "agente",
      "onboarding-agent",
    ] as InternalPage[],
  },
];

export type InternalShortcutKey = "campaigns" | "commercial";

export const INTERNAL_SHORTCUTS: Array<{
  key: InternalShortcutKey;
  title: string;
  description: string;
  icon: typeof FileSpreadsheet;
}> = [
  {
    key: "campaigns",
    title: "Criar campanhas",
    description: "Libera a operacao de campanhas, disparos e agendamentos no modulo principal do CRM.",
    icon: FileSpreadsheet,
  },
  {
    key: "commercial",
    title: "Dashboard + Inteligencia Comercial",
    description: "Libera o dashboard operacional e a analise da Inteligencia Comercial no menu lateral.",
    icon: LineChart,
  },
];

export function findAccessProfile(profiles: AccessProfileRecord[], key: string | null | undefined) {
  const normalizedKey = key?.trim().toLowerCase();
  if (!normalizedKey) return null;

  return profiles.find((profile) => profile.key === normalizedKey) || null;
}

export function applyAccessProfileToDraft<T extends AccessDraft>(draft: T, profile: AccessProfileRecord | null): T {
  if (!profile) {
    return draft;
  }

  if (profile.role === "pending") {
    return {
      ...draft,
      role: "pending",
      accessPreset: profile.key,
      scopeMode: "no_client_access",
      approvalLevel: "none",
      allowedViews: [],
      internalPages: [],
      permissions: [],
      clientIds: [],
    };
  }

  if (profile.role === "client") {
    return {
      ...draft,
      role: "client",
      accessPreset: profile.key,
      scopeMode: "assigned_clients",
      approvalLevel: profile.approvalLevel,
      allowedViews: [...profile.allowedViews],
      internalPages: [],
      permissions: [...profile.permissions],
    };
  }

  return {
    ...draft,
    role: "internal",
    accessPreset: profile.key,
    scopeMode: profile.scopeMode,
    approvalLevel: profile.approvalLevel,
    allowedViews: [],
    internalPages: [...profile.internalPages],
    permissions: [...profile.permissions],
  };
}

export const FALLBACK_ACCESS_PROFILE_DESCRIPTIONS: Record<string, string> = {
  admin_vexo: "Acesso total ao CRM (Você e a equipe técnica).",
  gestor: "Time comercial (interno). Pode ver vários clientes, mas não pode alterar configs sensíveis do sistema.",
  operador: "Time comercial (interno). Pode ver vários clientes, mas não pode deletar o sistema.",
  parceiro: "Acompanha a operacao com leitura e conversa limitada.",
  client_manager: "Pode ver os leads da empresa dele, integrar WhatsApp e gerar API keys.",
  client_operator: "Um vendedor do cliente. Pode apenas falar com os leads (não pode deletar nada, nem ver configs).",
  client_viewer: "Acesso apenas de leitura para o cliente.",
  pending: "Conta ainda sem liberacao operacional.",
};

export function buildFallbackAccessProfiles(): AccessProfileRecord[] {
  const fallbackKeys: AccessPreset[] = [
    "admin_vexo",
    "gestor",
    "operador",
    "parceiro",
    "client_manager",
    "client_operator",
    "client_viewer",
    "pending",
  ];

  return fallbackKeys.map((key) => {
    const defaults = buildPresetDefaults(key);
    const role = defaults.role;

    return {
      key,
      label: getAccessPresetLabel(key),
      description: FALLBACK_ACCESS_PROFILE_DESCRIPTIONS[key] || null,
      role,
      scopeMode: defaults.scopeMode,
      approvalLevel: defaults.approvalLevel,
      permissions: [...defaults.permissions],
      internalPages: [...defaults.internalPages],
      allowedViews: [...defaults.allowedViews],
      isSystem: true,
      isLocked: key === "admin_vexo",
      createdAt: null,
      updatedAt: null,
    };
  });
}

export function buildUserDraft(user: AdminUserRecord): UserDraft {
  const role = user.access.role;
  const accessPreset = user.access.accessPreset || getDefaultPresetForRole(role);
  const defaults = buildPresetDefaults(accessPreset);

  return {
    role,
    accessPreset,
    scopeMode: user.access.scopeMode || defaults.scopeMode,
    approvalLevel: user.access.approvalLevel || defaults.approvalLevel,
    companyName: user.access.companyName || "",
    clientIds: Array.from(new Set(user.access.clientIds || [])),
    allowedViews: user.access.allowedViews?.length
      ? user.access.allowedViews
      : [...defaults.allowedViews],
    internalPages: user.access.internalPages?.length
      ? user.access.internalPages
      : [...defaults.internalPages],
    permissions: user.access.permissions?.length
      ? user.access.permissions
      : [...defaults.permissions],
    disabled: user.disabled,
  };
}

export function buildCreateDraft(): CreateUserDraft {
  return normalizeCreateDraftForSimpleForm({
    email: "",
    password: "",
    displayName: "",
    role: "pending",
    accessPreset: "pending",
    scopeMode: "no_client_access",
    approvalLevel: "none",
    companyName: "",
    clientIds: [],
    allowedViews: [],
    internalPages: [],
    permissions: [],
    sendPasswordReset: false,
    disabled: false,
  });
}

export function derivePermissionsFromClientViews(views: AccessView[]): AccessPermission[] {
  const permissions: AccessPermission[] = [];

  if (views.includes("dashboard")) permissions.push("dashboard.view");
  if (views.includes("leads")) permissions.push("leads.view");
  if (views.includes("planilhas")) permissions.push("imports.manage");
  if (views.includes("whatsapp")) permissions.push("whatsapp.view", "whatsapp.reply");

  return filterArray(permissions, ACCESS_PERMISSION_ORDER);
}

export function derivePermissionsFromInternalPages(pages: InternalPage[]): AccessPermission[] {
  const permissions: AccessPermission[] = [];

  if (pages.includes("dashboard")) permissions.push("dashboard.view");
  if (pages.includes("leads")) permissions.push("leads.view");
  if (pages.includes("planilhas")) permissions.push("imports.manage");
  if (pages.includes("whatsapp")) permissions.push("whatsapp.view", "whatsapp.reply");
  if (pages.includes("agente")) permissions.push("agente.view");
  if (pages.includes("usuarios")) permissions.push("users.view", "users.manage");
  if (pages.includes("empresas")) permissions.push("tenants.manage");
  if (pages.includes("campanhas")) permissions.push("campaigns.manage");

  return filterArray(permissions, ACCESS_PERMISSION_ORDER);
}

export function hasInternalShortcutAccess(draft: AccessDraft, shortcut: InternalShortcutKey) {
  if (draft.role !== "internal") {
    return false;
  }

  if (shortcut === "campaigns") {
    return draft.permissions.includes("campaigns.manage");
  }

  return draft.internalPages.includes("dashboard") && draft.permissions.includes("dashboard.view");
}

export function buildInternalShortcutPatch(
  draft: AccessDraft,
  shortcut: InternalShortcutKey,
  enabled: boolean
): Partial<AccessDraft> {
  const normalized = applySimpleAccessModel(draft);
  if (normalized.role !== "internal") {
    return {};
  }

  let internalPages = [...normalized.internalPages];
  let permissions = [...normalized.permissions];

  if (shortcut === "campaigns") {
    if (enabled) {
      internalPages = filterArray([...internalPages, "planilhas", "campanhas"], INTERNAL_PAGE_ORDER);
      permissions = filterArray([...permissions, "campaigns.manage"], ACCESS_PERMISSION_ORDER);
    } else {
      internalPages = internalPages.filter((page) => page !== "campanhas");
      permissions = permissions.filter((permission) => permission !== "campaigns.manage");
    }
  }

  if (shortcut === "commercial") {
    if (enabled) {
      internalPages = filterArray([...internalPages, "dashboard"], INTERNAL_PAGE_ORDER);
      permissions = filterArray([...permissions, "dashboard.view"], ACCESS_PERMISSION_ORDER);
    } else {
      internalPages = internalPages.filter((page) => page !== "dashboard");
      permissions = permissions.filter((permission) => permission !== "dashboard.view");
    }
  }

  return {
    internalPages,
    permissions,
  };
}

export function applySimpleAccessModel<T extends AccessDraft>(draft: T): T {
  const selectedClientId = draft.clientIds[0]?.trim() || "";
  if (draft.role === "pending") {
    return {
      ...draft,
      accessPreset: draft.accessPreset || "pending",
      scopeMode: "no_client_access",
      approvalLevel: "none",
      clientIds: selectedClientId ? [selectedClientId] : [],
      allowedViews: [],
      internalPages: [],
      permissions: [],
    };
  }
  if (draft.role === "client") {
    const allowedViews = filterArray(
      draft.allowedViews.length ? draft.allowedViews : DEFAULT_CLIENT_VIEWS,
      CLIENT_VIEW_ORDER
    );
    const accessPreset = draft.accessPreset || getDefaultPresetForRole("client");
    const defaults = buildPresetDefaults(accessPreset);

    return {
      ...draft,
      role: "client",
      accessPreset,
      scopeMode: "assigned_clients",
      approvalLevel: draft.approvalLevel || defaults.approvalLevel,
      clientIds: selectedClientId ? [selectedClientId] : [],
      allowedViews,
      internalPages: [],
      permissions: filterArray(
        draft.permissions.length ? draft.permissions : derivePermissionsFromClientViews(allowedViews),
        ACCESS_PERMISSION_ORDER
      ),
    };
  }

  const internalPages = filterArray(
    draft.internalPages.length ? draft.internalPages : DEFAULT_INTERNAL_PAGES,
    INTERNAL_PAGE_ORDER
  );
  const accessPreset = draft.accessPreset || getDefaultPresetForRole("internal");
  const defaults = buildPresetDefaults(accessPreset);

  return {
    ...draft,
    role: "internal",
    accessPreset,
    scopeMode: selectedClientId ? "assigned_clients" : "all_clients",
    approvalLevel: draft.approvalLevel || defaults.approvalLevel,
    clientIds: selectedClientId ? [selectedClientId] : [],
    allowedViews: [],
    internalPages,
    permissions: filterArray(
      draft.permissions.length ? draft.permissions : derivePermissionsFromInternalPages(internalPages),
      ACCESS_PERMISSION_ORDER
    ),
  };
}

export function normalizeCreateDraftForSimpleForm(draft: CreateUserDraft): CreateUserDraft {
  return applySimpleAccessModel(draft);
}

export function formatDate(value: string | null) {
  if (!value) return "Nunca";

  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return value;
  }
}

export function toggleItem<T>(items: T[], item: T, checked: boolean) {
  return checked ? Array.from(new Set([...items, item])) : items.filter((entry) => entry !== item);
}

export function filterArray<T extends string>(items: T[], allowed: readonly T[]) {
  return Array.from(new Set(items.filter((item): item is T => allowed.includes(item))));
}

export function normalizeDraft<T extends AccessDraft>(draft: T): T {
  const role = draft.role;
  const accessPreset = draft.accessPreset?.trim() || getDefaultPresetForRole(role);
  const defaults = buildPresetDefaults(accessPreset);
  const clientIds = Array.from(new Set(draft.clientIds.map((value) => value.trim()).filter(Boolean)));

  if (role === "pending") {
    return {
      ...draft,
      role,
      accessPreset: "pending",
      scopeMode: "no_client_access",
      approvalLevel: "none",
      companyName: draft.companyName,
      clientIds,
      allowedViews: [],
      internalPages: [],
      permissions: [],
      disabled: draft.disabled,
    };
  }
  const allowedViews = role === "client" ? filterArray(draft.allowedViews, CLIENT_VIEW_ORDER) : [];
  const internalPages = role === "internal" ? filterArray(draft.internalPages, INTERNAL_PAGE_ORDER) : [];
  const permissions = filterArray(draft.permissions, ROLE_PERMISSIONS[role]);

  return {
    ...draft,
    role,
    accessPreset,
    scopeMode: ROLE_SCOPES[role].includes(draft.scopeMode) ? draft.scopeMode : defaults.scopeMode,
    approvalLevel: ROLE_APPROVAL_LEVELS[role].includes(draft.approvalLevel)
      ? draft.approvalLevel
      : defaults.approvalLevel,
    clientIds:
      role === "internal" && draft.scopeMode === "no_client_access" ? [] : clientIds,
    allowedViews: role === "client" ? allowedViews : [],
    internalPages: role === "internal" ? internalPages : [],
    permissions,
  };
}

export function transitionDraft<T extends AccessDraft>(draft: T): T {
  const normalized = normalizeDraft(draft);
  const defaults = buildPresetDefaults(normalized.accessPreset);

  if (normalized.role === "client") {
    return {
      ...normalized,
      scopeMode: "assigned_clients",
      approvalLevel: ROLE_APPROVAL_LEVELS.client.includes(normalized.approvalLevel)
        ? normalized.approvalLevel
        : defaults.approvalLevel,
      allowedViews: normalized.allowedViews.length ? normalized.allowedViews : [...defaults.allowedViews],
      internalPages: [],
      permissions: normalized.permissions.length ? normalized.permissions : [...defaults.permissions],
    };
  }

  if (normalized.role === "internal") {
    return {
      ...normalized,
      scopeMode: ROLE_SCOPES.internal.includes(normalized.scopeMode)
        ? normalized.scopeMode
        : defaults.scopeMode,
      approvalLevel: ROLE_APPROVAL_LEVELS.internal.includes(normalized.approvalLevel)
        ? normalized.approvalLevel
        : defaults.approvalLevel,
      allowedViews: [],
      internalPages: normalized.internalPages.length ? normalized.internalPages : [...defaults.internalPages],
      permissions: normalized.permissions.length ? normalized.permissions : [...defaults.permissions],
    };
  }

  return normalized;
}

export function buildPayload(draft: AccessDraft) {
  const normalized = normalizeDraft(draft);

  return {
    role: normalized.role,
    accessPreset: normalized.accessPreset,
    scopeMode: normalized.scopeMode,
    approvalLevel: normalized.approvalLevel,
    companyName: normalized.companyName ? normalized.companyName.trim() : undefined,
    clientIds: normalized.clientIds,
    allowedViews: normalized.allowedViews,
    internalPages: normalized.internalPages,
    permissions: normalized.permissions,
    disabled: normalized.disabled,
  };
}

export function validateDraft(draft: AccessDraft) {
  const normalized = normalizeDraft(draft);

  if (normalized.role === "client") {
    if (normalized.clientIds.length === 0) {
      return "Selecione ao menos um tenant/cliente para este usuario.";
    }

    if (normalized.allowedViews.length === 0) {
      return "Selecione ao menos uma view para o usuario cliente.";
    }
  }

  if (normalized.role === "internal") {
    if (normalized.scopeMode === "assigned_clients" && normalized.clientIds.length === 0) {
      return "Usuarios internos com escopo vinculado precisam de pelo menos um tenant/cliente.";
    }

    if (normalized.internalPages.length === 0) {
      return "Selecione ao menos uma pagina interna para este usuario.";
    }
  }

  if (normalized.role !== "pending" && normalized.permissions.length === 0) {
    return "Selecione ao menos uma permissao operacional.";
  }

  return null;
}

export function isProtectedAdmin(user: AdminUserRecord) {
  return user.access.isAdmin || isFixedAdminAccount(user.uid, user.email);
}

export function getClientName(clientId: string, clients: LeadClient[]) {
  return clients.find((client) => client.id === clientId)?.name || clientId;
}

export function summarizeClientAssignments(clientIds: string[], clients: LeadClient[]) {
  if (clientIds.length === 0) return "Nenhum tenant vinculado";

  const names = clientIds.map((clientId) => getClientName(clientId, clients));
  if (names.length <= 2) return names.join(", ");

  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

export function sortByReferenceOrder<T extends string>(items: T[], referenceOrder: readonly T[]) {
  const orderMap = new Map(referenceOrder.map((item, index) => [item, index]));
  return [...items].sort((left, right) => (orderMap.get(left) ?? 999) - (orderMap.get(right) ?? 999));
}

export function buildComparablePayload(draft: AccessDraft) {
  const payload = buildPayload(draft);

  return {
    ...payload,
    clientIds: [...payload.clientIds].sort(),
    allowedViews: sortByReferenceOrder(payload.allowedViews, CLIENT_VIEW_ORDER),
    internalPages: sortByReferenceOrder(payload.internalPages, INTERNAL_PAGE_ORDER),
    permissions: sortByReferenceOrder(payload.permissions, ACCESS_PERMISSION_ORDER),
  };
}

export function hasDraftChanges(user: AdminUserRecord, draft: UserDraft) {
  return JSON.stringify(buildComparablePayload(buildUserDraft(user))) !== JSON.stringify(buildComparablePayload(draft));
}

export function buildSearchIndex(user: AdminUserRecord, draft: UserDraft) {
  return [
    user.email,
    user.displayName,
    draft.companyName,
    draft.accessPreset,
    draft.scopeMode,
    ROLE_LABELS[draft.role],
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
