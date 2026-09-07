// Access control: constantes, presets e claims de acesso (movidos de server.js — grupo A do mapa, Onda 3 Run B).
// Movimento puro: corpos idênticos aos de server.js.

import { normalizeString } from "../textNormalize.js";
import { getAuth } from "../services/firebase.js";
import {
  deriveEffectivePermissions,
  PERMISSION_KEYS,
  MODULAR_BASE_PAGES,
  pagesForContractedModules,
  isValidPermissionKey,
} from "./permissionsRegistry.js";

export const MANAGED_CLAIM_KEYS = [
  "role",
  "userRole",
  "user_type",
  "userType",
  "tipo_usuario",
  "isAdmin",
  "admin",
  "is_admin",
  "accessPreset",
  "scopeMode",
  "tenantScope",
  "approvalLevel",
  "permissions",
  "clientId",
  "client_id",
  "companyId",
  "empresaId",
  "tenantId",
  "clientIds",
  "tenantIds",
  "allowedViews",
  "companyName",
  "internalPages",
  "must_change_password",
  "grant",
  "revoke",
];
export const CLIENT_VIEW_KEYS = ["dashboard", "leads", "planilhas", "whatsapp"];
export const DEFAULT_CLIENT_VIEWS = ["dashboard", "leads"];
export const INTERNAL_PAGE_KEYS = [
  "dashboard",
  "banco-de-dados",
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
];
export const ACCESS_SCOPE_KEYS = ["all_clients", "assigned_clients", "no_client_access"];
export const APPROVAL_LEVEL_KEYS = ["none", "operator", "supervisor", "manager", "director"];
export const ACCESS_PERMISSION_KEYS = [
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
export const ACCESS_PRESET_KEYS = [
  "admin_vexo",
  "gestor",
  "operador",
  "parceiro",
  "client_manager",
  "client_operator",
  "client_viewer",
  "pending",
];
export const ACCESS_PRESET_LABELS = {
  admin_vexo: "Admin Vexo",
  gestor: "Gestor",
  operador: "Operador",
  parceiro: "Parceiro",
  client_manager: "Gestor do cliente",
  client_operator: "Operador do cliente",
  client_viewer: "Leitura do cliente",
  pending: "Aguardando aprovacao",
};
export const FIXED_ADMIN_UIDS = new Set([
  "pKpOKg3Fttf6AnYsTzZD7xjJLaN2",
]);
export const FIXED_ADMIN_EMAILS = new Set([
  "conradofl@gmail.com",
]);

export function isFixedAdminIdentity(identity = {}) {
  const uid = normalizeString(identity.uid);
  const email = normalizeString(identity.email)?.toLowerCase() || null;

  return (uid && FIXED_ADMIN_UIDS.has(uid)) || (email && FIXED_ADMIN_EMAILS.has(email)) || false;
}

export const ACCESS_PRESET_DEFAULTS = {
  admin_vexo: {
    role: "internal",
    scopeMode: "all_clients",
    approvalLevel: "director",
    permissions: [...ACCESS_PERMISSION_KEYS],
    internalPages: [...INTERNAL_PAGE_KEYS],
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
    internalPages: INTERNAL_PAGE_KEYS.filter((p) => p !== "empresas"),
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
    ],
    internalPages: [],
    allowedViews: [...CLIENT_VIEW_KEYS],
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

export const SYSTEM_ACCESS_PROFILES = [
  {
    key: "admin_vexo",
    label: ACCESS_PRESET_LABELS.admin_vexo,
    description: "Acesso total ao CRM (Você e a equipe técnica).",
    role: "internal",
    scopeMode: "all_clients",
    approvalLevel: "director",
    permissions: [...ACCESS_PERMISSION_KEYS],
    internalPages: [...INTERNAL_PAGE_KEYS],
    allowedViews: [],
    isSystem: true,
    isLocked: true,
  },
  {
    key: "gestor",
    label: ACCESS_PRESET_LABELS.gestor,
    description: "Time comercial (interno). Pode ver vários clientes, mas não pode alterar configs sensíveis do sistema.",
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "manager",
    permissions: [...ACCESS_PRESET_DEFAULTS.gestor.permissions],
    internalPages: [...ACCESS_PRESET_DEFAULTS.gestor.internalPages],
    allowedViews: [],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "operador",
    label: ACCESS_PRESET_LABELS.operador,
    description: "Time comercial (interno). Pode ver vários clientes, mas não pode deletar o sistema.",
    role: "internal",
    scopeMode: "assigned_clients",
    approvalLevel: "operator",
    permissions: [...ACCESS_PRESET_DEFAULTS.operador.permissions],
    internalPages: [...ACCESS_PRESET_DEFAULTS.operador.internalPages],
    allowedViews: [],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "parceiro",
    label: ACCESS_PRESET_LABELS.parceiro,
    description: "Acompanha a operacao com leitura e conversa limitada.",
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "supervisor",
    permissions: [...ACCESS_PRESET_DEFAULTS.parceiro.permissions],
    internalPages: [],
    allowedViews: [...ACCESS_PRESET_DEFAULTS.parceiro.allowedViews],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "client_manager",
    label: ACCESS_PRESET_LABELS.client_manager,
    description: "Pode ver os leads da empresa dele, integrar WhatsApp e gerar API keys.",
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "manager",
    permissions: [...ACCESS_PRESET_DEFAULTS.client_manager.permissions],
    internalPages: [],
    allowedViews: [...ACCESS_PRESET_DEFAULTS.client_manager.allowedViews],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "client_operator",
    label: ACCESS_PRESET_LABELS.client_operator,
    description: "Um vendedor do cliente. Pode apenas falar com os leads (não pode deletar nada, nem ver configs).",
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "operator",
    permissions: [...ACCESS_PRESET_DEFAULTS.client_operator.permissions],
    internalPages: [],
    allowedViews: [...ACCESS_PRESET_DEFAULTS.client_operator.allowedViews],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "client_viewer",
    label: ACCESS_PRESET_LABELS.client_viewer,
    description: "Acesso apenas de leitura para o cliente.",
    role: "client",
    scopeMode: "assigned_clients",
    approvalLevel: "none",
    permissions: [...ACCESS_PRESET_DEFAULTS.client_viewer.permissions],
    internalPages: [],
    allowedViews: [...ACCESS_PRESET_DEFAULTS.client_viewer.allowedViews],
    isSystem: true,
    isLocked: false,
  },
  {
    key: "pending",
    label: ACCESS_PRESET_LABELS.pending,
    description: "Conta ainda sem liberacao operacional.",
    role: "pending",
    scopeMode: "no_client_access",
    approvalLevel: "none",
    permissions: [],
    internalPages: [],
    allowedViews: [],
    isSystem: true,
    isLocked: false,
  },
];

export function getPresetFallbackKey(preset) {
  const normalized = normalizeString(preset)?.toLowerCase() || "";

  if (normalized === "pending" || normalized.startsWith("pending")) {
    return "pending";
  }

  if (normalized.startsWith("client")) {
    return "client_operator";
  }

  return "operador";
}

export function normalizeRole(value) {
  const normalized = normalizeString(value)?.toLowerCase();

  if (!normalized) return "internal";

  if (["client", "cliente", "customer"].includes(normalized)) {
    return "client";
  }

  if (["pending", "pendente", "pending_client", "cliente_pendente"].includes(normalized)) {
    return "pending";
  }

  return "internal";
}

export function isValidManagedRoleInput(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  return Boolean(
    normalized &&
      [
        "internal",
        "client",
        "pending",
        "cliente",
        "customer",
        "pendente",
        "pending_client",
        "cliente_pendente",
      ].includes(normalized)
  );
}

export function isValidManagedPresetInput(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  return !normalized || /^[a-z0-9_-]+$/.test(normalized);
}

export function isValidManagedScopeInput(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  if (!normalized) return true;

  return (
    ACCESS_SCOPE_KEYS.includes(normalized) ||
    ["all", "global", "all_tenants", "assigned", "restricted", "assigned_tenants", "none", "no_access", "sem_escopo"].includes(normalized)
  );
}

export function isValidManagedApprovalLevelInput(value) {
  const normalized = normalizeString(value)?.toLowerCase();
  return !normalized || APPROVAL_LEVEL_KEYS.includes(normalized);
}

export function getDefaultPresetForRole(role) {
  if (role === "client") return "client_operator";
  if (role === "pending") return "pending";
  return "operador";
}

/**
 * Normaliza o preset de acesso. SEMPRE devolve uma das chaves de
 * ACCESS_PRESET_KEYS — essa e a lista correta, coerente com
 * ACCESS_PRESET_DEFAULTS, com SYSTEM_ACCESS_PROFILES e com a tela.
 *
 * ANTES havia um `if (normalized) return normalized;` que devolvia QUALQUER
 * string de volta. O resultado era um normalizador que nao normalizava: um
 * preset desconhecido atravessava intacto, era devolvido pela API, a tela o
 * reenviava no PATCH e so entao o validador de auth/routes.js o recusava com
 * "Unsupported access preset" — sem dizer qual valor era. O usuario ficava
 * preso: cada nova tentativa reenviava o mesmo valor invalido.
 *
 * Dois validadores no mesmo backend com regras diferentes: aqui passava tudo,
 * la passavam 8. Agora e um so.
 */
export function normalizeAccessPreset(value, role = "internal") {
  return resolveAccessPreset(value, role).preset;
}

/**
 * Igual a normalizeAccessPreset, mas conta O QUE FEZ. Quem grava claim usa esta
 * versao para poder AVISAR que trocou o valor.
 *
 * Trocar em silencio e a familia de defeito que este repositorio ja pagou caro
 * (o `|| "QUENTE"`, o "FRIO" chumbado): ajustar e necessario, ajustar sem dizer
 * nao e.
 *
 * @returns {{ preset: string, ajustado: boolean, recebido: string|null, motivo: string|null }}
 */
export function resolveAccessPreset(value, role = "internal") {
  const bruto = normalizeString(value);
  const normalized = bruto?.toLowerCase();

  if (!normalized) {
    return { preset: getDefaultPresetForRole(role), ajustado: false, recebido: null, motivo: null };
  }

  if (ACCESS_PRESET_KEYS.includes(normalized)) {
    const papelDoPreset = ACCESS_PRESET_DEFAULTS[normalized].role;
    if (papelDoPreset === role) {
      return { preset: normalized, ajustado: false, recebido: bruto, motivo: null };
    }
    // Perfil valido, mas de outro papel. Ja era reescrito antes — a diferenca e
    // que agora o chamador consegue avisar em vez de trocar calado.
    return {
      preset: getDefaultPresetForRole(role),
      ajustado: true,
      recebido: bruto,
      motivo: "papel_incompativel",
    };
  }

  // Fora das chaves conhecidas: cai no padrao do papel, e AVISA.
  return {
    preset: getDefaultPresetForRole(role),
    ajustado: true,
    recebido: bruto,
    motivo: "preset_desconhecido",
  };
}

/** Frase pronta para a tela, em portugues, dizendo o que foi trocado e por que. */
export function describeAccessPresetAdjustment({ recebido, preset, motivo }) {
  const rotulo = ACCESS_PRESET_LABELS[preset] || preset;
  if (motivo === "papel_incompativel") {
    return `O perfil "${recebido}" pertence a outro tipo de usuário. Foi ajustado para ${rotulo}.`;
  }
  return `O perfil deste usuário era "${recebido}", que não existe. Foi ajustado para ${rotulo}.`;
}

/** Chaves aceitas, para mensagens de erro e para o teste de paridade. */
export function listAccessPresetKeys() {
  return [...ACCESS_PRESET_KEYS];
}

export function getAccessPresetLabel(preset) {
  const normalized = normalizeString(preset)?.toLowerCase() || "";
  if (!normalized) return "Tipo sem nome";

  const labels = {
    admin_vexo: "Admin Vexo",
    gestor: "Gestor",
    operador: "Operador",
    parceiro: "Parceiro",
    client_manager: "Gestor do cliente",
    client_operator: "Operador do cliente",
    client_viewer: "Leitura do cliente",
    pending: "Aguardando aprovacao",
  };

  return (
    labels[normalized] ||
    normalized
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

export function buildPresetDefaults(preset) {
  const defaults = ACCESS_PRESET_DEFAULTS[preset] || ACCESS_PRESET_DEFAULTS[getPresetFallbackKey(preset)];

  return {
    role: defaults.role,
    scopeMode: defaults.scopeMode,
    approvalLevel: defaults.approvalLevel,
    permissions: [...defaults.permissions],
    internalPages: [...defaults.internalPages],
    allowedViews: [...defaults.allowedViews],
  };
}

export function normalizeStringArray(value) {
  if (Array.isArray(value)) {
    return Array.from(
      new Set(value.map((item) => normalizeString(item)).filter(Boolean))
    );
  }

  const normalized = normalizeString(value);
  if (!normalized) return [];

  return Array.from(
    new Set(
      normalized
        .split(",")
        .map((item) => normalizeString(item))
        .filter(Boolean)
    )
  );
}

export function normalizeScopeMode(value, role) {
  if (role === "pending") {
    return "no_client_access";
  }

  if (role === "client") {
    return "assigned_clients";
  }

  const normalized = normalizeString(value)?.toLowerCase();

  if (normalized && ACCESS_SCOPE_KEYS.includes(normalized)) {
    return normalized;
  }

  if (normalized === "all" || normalized === "global" || normalized === "all_tenants") {
    return "all_clients";
  }

  if (normalized === "assigned" || normalized === "restricted" || normalized === "assigned_tenants") {
    return "assigned_clients";
  }

  if (normalized === "none" || normalized === "no_access" || normalized === "sem_escopo") {
    return "no_client_access";
  }

  return role === "internal" ? "all_clients" : "assigned_clients";
}

export function normalizeApprovalLevel(value, role) {
  if (role === "pending") {
    return "none";
  }

  const normalized = normalizeString(value)?.toLowerCase();
  if (normalized && APPROVAL_LEVEL_KEYS.includes(normalized)) {
    return normalized;
  }

  return buildPresetDefaults(getDefaultPresetForRole(role)).approvalLevel;
}

export function normalizePermissions(value, role, preset = getDefaultPresetForRole(role)) {
  if (role === "pending") {
    return [];
  }

  // Aceita tanto as chaves antigas (ACCESS_PERMISSION_KEYS) quanto as granulares novas do
  // PERMISSIONS_REGISTRY, para a matriz de toggles do admin salvar permissões granulares.
  const allowedKeys = new Set([...ACCESS_PERMISSION_KEYS, ...PERMISSION_KEYS]);
  const selected = normalizeStringArray(value)
    .map((item) => item.toLowerCase())
    .filter((item) => allowedKeys.has(item));

  if (selected.length > 0) {
    return Array.from(new Set(selected));
  }

  return buildPresetDefaults(preset).permissions;
}

export function normalizeAllowedViews(value, role, preset = getDefaultPresetForRole(role)) {
  const allowed = normalizeStringArray(value)
    .map((item) => item.toLowerCase())
    .filter((item) => CLIENT_VIEW_KEYS.includes(item));

  if (role === "client" && allowed.length === 0) {
    const defaults = buildPresetDefaults(preset).allowedViews;
    return defaults.length ? defaults : [...DEFAULT_CLIENT_VIEWS];
  }

  return Array.from(new Set(allowed));
}

export function normalizeInternalPages(value, role, isAdmin = false, preset = "internal_operator") {
  if (role !== "internal") {
    return [];
  }

  if (isAdmin) {
    return [...INTERNAL_PAGE_KEYS];
  }

  const pages = normalizeStringArray(value)
    .map((item) => item.toLowerCase())
    .filter((item) => INTERNAL_PAGE_KEYS.includes(item));

  if (pages.length === 0) {
    return buildPresetDefaults(preset).internalPages;
  }

  return Array.from(new Set(pages));
}

export function deriveTenantInternalPages(tenant = {}) {
  const rawTier = String(
    tenant.plan_tier ||
    tenant.planTier ||
    tenant.n8n_settings?.plan_tier ||
    tenant.n8n_settings?.planTier ||
    tenant.plan_type ||
    tenant.planType ||
    ""
  ).toLowerCase().trim();

  if (rawTier.includes("avancad") || rawTier.includes("advanced") || rawTier === "avancado") {
    return [...INTERNAL_PAGE_KEYS];
  }

  const rawModulos =
    tenant.modulos_avulsos ||
    tenant.modulosAvulsos ||
    tenant.n8n_settings?.modulos_avulsos ||
    tenant.n8n_settings?.modulosAvulsos ||
    [];

  const modulosAvulsos = Array.isArray(rawModulos)
    ? rawModulos
    : typeof rawModulos === "string"
      ? rawModulos.split(",").map((s) => s.trim())
      : [];

  if (rawTier.includes("modular") || rawTier.includes("avulso") || rawTier === "modular") {
    // Base universal + o que os modulos contratados liberam. Antes isto era uma
    // cascata de ifs com os apelidos espalhados pelas condicoes; agora vem do
    // MODULE_CATALOG, declarado uma vez em permissionsRegistry.js. Mesmo conjunto
    // de apelidos, nenhum novo — so deixou de estar espalhado.
    const pages = [
      ...MODULAR_BASE_PAGES,
      ...pagesForContractedModules(modulosAvulsos),
    ];

    // "conversas" e o nome do modulo sdr_broadcast; a pagina interna e "whatsapp",
    // que ja esta na base. O filtro por INTERNAL_PAGE_KEYS descarta o resto.
    return Array.from(new Set(pages.filter((p) => INTERNAL_PAGE_KEYS.includes(p))));
  }

  // Plano essencial padrão (inalterado)
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
  ];
}

export function hasManagedAccessClaims(rawClaims = {}) {
  if (!rawClaims || typeof rawClaims !== "object") {
    return false;
  }

  return MANAGED_CLAIM_KEYS.some((key) => Object.prototype.hasOwnProperty.call(rawClaims, key));
}

export function extractManagedAccessClaims(rawClaims = {}, identity = {}) {
  if (!hasManagedAccessClaims(rawClaims) && !isFixedAdminIdentity(identity)) {
    return {
      role: "pending",
      isAdmin: false,
      accessPreset: "pending",
      scopeMode: "no_client_access",
      approvalLevel: "none",
      clientId: null,
      clientIds: [],
      tenantId: null,
      tenantIds: [],
      allowedViews: [],
      internalPages: [],
      permissions: [],
      companyName: normalizeString(rawClaims.companyName),
      mustChangePassword: rawClaims.must_change_password === true,
    };
  }

  const requestedRole = normalizeRole(
    rawClaims.role ??
      rawClaims.userRole ??
      rawClaims.user_type ??
      rawClaims.userType ??
      rawClaims.tipo_usuario
  );
  const directClientId = normalizeString(
    rawClaims.clientId ??
      rawClaims.client_id ??
      rawClaims.companyId ??
      rawClaims.empresaId ??
      rawClaims.tenantId
  );
  const isVexoUser = directClientId === "vexo" || isFixedAdminIdentity(identity);
  const isAdmin = isVexoUser;
  const role = isAdmin ? "internal" : requestedRole;
  const accessPreset = normalizeAccessPreset(rawClaims.accessPreset, role);
  const normalizedPreset = isAdmin ? "admin_vexo" : normalizeAccessPreset(accessPreset, role);
  const scopeMode = isAdmin
    ? "all_clients"
    : normalizeScopeMode(rawClaims.scopeMode ?? rawClaims.tenantScope, role);
  const approvalLevel = isAdmin
    ? "director"
    : normalizeApprovalLevel(rawClaims.approvalLevel, role);
  const clientIds = Array.from(
    new Set([
      directClientId,
      ...normalizeStringArray(rawClaims.clientIds),
      ...normalizeStringArray(rawClaims.tenantIds),
    ].filter(Boolean))
  );
  const preserveClientAssignments = role === "pending";
  const clientId = preserveClientAssignments
    ? directClientId || clientIds[0] || null
    : scopeMode === "no_client_access"
      ? null
      : directClientId || clientIds[0] || null;
  const allowedViews = role === "client"
    ? normalizeAllowedViews(rawClaims.allowedViews, role, normalizedPreset)
    : [];
  const internalPages = role === "internal"
    ? normalizeInternalPages(rawClaims.internalPages, role, isAdmin, normalizedPreset)
    : [];
  const permissions = isAdmin
    ? [...buildPresetDefaults("admin_vexo").permissions]
    : normalizePermissions(rawClaims.permissions, role, normalizedPreset);

  const grantList = normalizeStringArray(rawClaims.grant);
  const revokeSet = new Set(normalizeStringArray(rawClaims.revoke));

  let resolvedPermissions = permissions;
  let resolvedInternalPages = internalPages;
  let resolvedAllowedViews = allowedViews;

  if (grantList.length > 0 || revokeSet.size > 0) {
    const permGrants = grantList.filter((k) => isValidPermissionKey(k));
    const permRevokes = new Set([...revokeSet].filter((k) => isValidPermissionKey(k)));

    resolvedPermissions = Array.from(
      new Set([...resolvedPermissions.filter((k) => !permRevokes.has(k)), ...permGrants])
    );

    const pageGrants = grantList.filter((k) => INTERNAL_PAGE_KEYS.includes(k));
    const pageRevokes = new Set([...revokeSet].filter((k) => INTERNAL_PAGE_KEYS.includes(k)));

    if (role === "internal" && !isAdmin) {
      resolvedInternalPages = Array.from(
        new Set([...resolvedInternalPages.filter((k) => !pageRevokes.has(k)), ...pageGrants])
      );
    }

    const viewGrants = grantList.filter((k) => CLIENT_VIEW_KEYS.includes(k));
    const viewRevokes = new Set([...revokeSet].filter((k) => CLIENT_VIEW_KEYS.includes(k)));

    if (role === "client") {
      resolvedAllowedViews = Array.from(
        new Set([...resolvedAllowedViews.filter((k) => !viewRevokes.has(k)), ...viewGrants])
      );
    }
  }

  // Migração transparente (objetivo 2): o conjunto EFETIVO de permissões granulares que os
  // guards consultam. Deriva do que o usuário já tinha (permissões antigas + páginas/views
  // legadas) sem reduzir acesso. Usuário antigo passa a operar pelo novo modelo no 1º login,
  // sem recriação de cadastro.
  const effectivePermissions = deriveEffectivePermissions({
    isAdmin,
    role,
    storedPermissions: [
      ...resolvedPermissions,
      ...(Array.isArray(rawClaims.permissions) ? rawClaims.permissions : []),
    ],
    internalPages: resolvedInternalPages,
    allowedViews: resolvedAllowedViews,
  });

  const permRevokes = new Set([...revokeSet].filter((k) => isValidPermissionKey(k)));
  const finalEffectivePermissions = effectivePermissions.filter((p) => !permRevokes.has(p));

  return {
    role,
    isAdmin,
    accessPreset: normalizedPreset,
    scopeMode,
    approvalLevel,
    clientId,
    clientIds: preserveClientAssignments || scopeMode !== "no_client_access" ? clientIds : [],
    tenantId: clientId,
    tenantIds: preserveClientAssignments || scopeMode !== "no_client_access" ? clientIds : [],
    allowedViews: resolvedAllowedViews,
    internalPages: resolvedInternalPages,
    permissions: finalEffectivePermissions,
    companyName: normalizeString(rawClaims.companyName),
    mustChangePassword: rawClaims.must_change_password === true,
  };
}

export function buildAccessProfile(decodedToken) {
  const claims = extractManagedAccessClaims(decodedToken, decodedToken);
  const email = normalizeString(decodedToken.email);
  const isFounderMaster = email === "conradofinzi@gmail.com" || email?.endsWith("@vexoia.com") || claims.role === "superadmin";

  return {
    uid: decodedToken.uid,
    email,
    role: isFounderMaster ? "superadmin" : claims.role,
    isAdmin: isFounderMaster ? true : claims.isAdmin,
    accessPreset: isFounderMaster ? "diretoria" : claims.accessPreset,
    scopeMode: isFounderMaster ? "all_clients" : claims.scopeMode,
    approvalLevel: isFounderMaster ? "admin" : claims.approvalLevel,
    clientId: claims.clientId,
    clientIds: claims.clientIds,
    tenantId: claims.tenantId,
    tenantIds: claims.tenantIds,
    allowedViews: claims.allowedViews,
    internalPages: claims.internalPages,
    permissions: claims.permissions,
    companyName: claims.companyName,
    mustChangePassword: claims.mustChangePassword === true,
  };
}

export function mergeManagedClaims(existingClaims = {}, managedClaims = {}) {
  const preserved = { ...existingClaims };

  for (const key of MANAGED_CLAIM_KEYS) {
    delete preserved[key];
  }

  return {
    ...preserved,
    ...managedClaims,
  };
}

export function buildManagedClaims({
  role,
  accessPreset,
  scopeMode,
  approvalLevel,
  permissions = [],
  clientIds = [],
  tenantIds = [],
  clientId,
  tenantId,
  allowedViews = [],
  companyName = null,
  internalPages = [],
}) {
  const normalizedRole = normalizeRole(role);
  const normalizedPreset = normalizeAccessPreset(accessPreset, normalizedRole);
  const normalizedCompanyName = normalizeString(companyName);
  const normalizedClientIds = Array.from(
    new Set(
      [
        ...normalizeStringArray(clientIds),
        ...normalizeStringArray(tenantIds),
        normalizeString(clientId),
        normalizeString(tenantId),
      ].filter(Boolean)
    )
  );
  const normalizedApprovalLevel =
    normalizedRole === "pending"
      ? "none"
      : normalizeApprovalLevel(approvalLevel, normalizedRole);

  if (normalizedRole === "pending") {
    return {
      role: "pending",
      isAdmin: false,
      accessPreset: "pending",
      scopeMode: "no_client_access",
      approvalLevel: "none",
      permissions: [],
      clientId: normalizedClientIds[0] || null,
      clientIds: normalizedClientIds,
      tenantId: normalizedClientIds[0] || null,
      tenantIds: normalizedClientIds,
      allowedViews: [],
      internalPages: [],
      companyName: normalizedCompanyName,
    };
  }

  if (normalizedRole === "client") {
    if (normalizedClientIds.length === 0) {
      throw new Error("Client users must have at least one associated tenant");
    }

    const normalizedAllowedViews = normalizeAllowedViews(allowedViews, normalizedRole, normalizedPreset);

    return {
      role: "client",
      isAdmin: false,
      accessPreset: normalizedPreset,
      scopeMode: "assigned_clients",
      approvalLevel: normalizedApprovalLevel,
      clientId: normalizedClientIds[0],
      clientIds: normalizedClientIds,
      tenantId: normalizedClientIds[0],
      tenantIds: normalizedClientIds,
      allowedViews: normalizedAllowedViews,
      internalPages: [],
      permissions: normalizePermissions(permissions, normalizedRole, normalizedPreset),
      companyName: normalizedCompanyName,
    };
  }

  const isAdmin = normalizedPreset === "admin_vexo";
  const resolvedScopeMode = isAdmin ? "all_clients" : normalizeScopeMode(scopeMode, normalizedRole);
  const normalizedPermissions = isAdmin
    ? [...ACCESS_PERMISSION_KEYS]
    : normalizePermissions(permissions, normalizedRole, normalizedPreset);
  const normalizedInternalPages = isAdmin
    ? [...INTERNAL_PAGE_KEYS]
    : normalizeInternalPages(internalPages, normalizedRole, false, normalizedPreset);
  const effectiveClientIds =
    resolvedScopeMode === "no_client_access" ? [] : normalizedClientIds;

  return {
    role: "internal",
    isAdmin,
    accessPreset: normalizedPreset,
    scopeMode: resolvedScopeMode,
    approvalLevel: isAdmin ? "director" : normalizedApprovalLevel,
    clientId: effectiveClientIds[0] || null,
    clientIds: effectiveClientIds,
    tenantId: effectiveClientIds[0] || null,
    tenantIds: effectiveClientIds,
    allowedViews: [],
    internalPages: normalizedInternalPages,
    permissions: normalizedPermissions,
    companyName: normalizedCompanyName,
  };
}

export async function listAllFirebaseUsers() {
  const auth = getAuth();
  let pageToken;
  const users = [];

  do {
    const page = await auth.listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);

  return users;
}

export function mapAdminUserRecord(user) {
  const access = extractManagedAccessClaims(user.customClaims || {}, {
    uid: user.uid,
    email: user.email,
  });

  return {
    uid: user.uid,
    email: user.email || null,
    displayName: user.displayName || null,
    disabled: user.disabled,
    createdAt: user.metadata.creationTime || null,
    lastSignInAt: user.metadata.lastSignInTime || null,
    access,
  };
}

export async function ensureFirebaseUserAccessClaims(user) {
  const auth = getAuth();
  const existingClaims = user.customClaims || {};

  if (hasManagedAccessClaims(existingClaims)) {
    return {
      user,
      synced: false,
      reason: "already_managed",
    };
  }

  const managedClaims = isFixedAdminIdentity({ uid: user.uid, email: user.email })
    ? buildManagedClaims({
        role: "internal",
        accessPreset: "admin_vexo",
        scopeMode: "all_clients",
        approvalLevel: "director",
        permissions: ACCESS_PERMISSION_KEYS,
        internalPages: INTERNAL_PAGE_KEYS,
      })
    : buildManagedClaims({
        role: "pending",
        companyName: existingClaims.companyName,
      });

  await auth.setCustomUserClaims(user.uid, mergeManagedClaims(existingClaims, managedClaims));

  return {
    user: await auth.getUser(user.uid),
    synced: true,
    reason: managedClaims.accessPreset,
  };
}

export function humanizeAccessProfileKey(value) {
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

export function normalizeAccessProfileRecord(input = {}) {
  const role = normalizeRole(input.role);
  const key = normalizeAccessPreset(input.key ?? input.accessPreset, role);
  const label = normalizeString(input.label) || humanizeAccessProfileKey(key);
  const description = normalizeString(input.description);

  if (role === "pending") {
    return {
      key,
      label,
      description,
      role: "pending",
      scopeMode: "no_client_access",
      approvalLevel: "none",
      permissions: [],
      internalPages: [],
      allowedViews: [],
      isSystem: Boolean(input.isSystem ?? input.is_system),
      isLocked: Boolean(input.isLocked ?? input.is_locked),
      createdAt: input.createdAt ?? input.created_at ?? null,
      updatedAt: input.updatedAt ?? input.updated_at ?? null,
    };
  }

  if (role === "client") {
    return {
      key,
      label,
      description,
      role: "client",
      scopeMode: "assigned_clients",
      approvalLevel: normalizeApprovalLevel(input.approvalLevel ?? input.approval_level, role),
      permissions: normalizePermissions(input.permissions, role, key),
      internalPages: [],
      allowedViews: normalizeAllowedViews(input.allowedViews ?? input.allowed_views, role, key),
      isSystem: Boolean(input.isSystem ?? input.is_system),
      isLocked: Boolean(input.isLocked ?? input.is_locked),
      createdAt: input.createdAt ?? input.created_at ?? null,
      updatedAt: input.updatedAt ?? input.updated_at ?? null,
    };
  }

  const isAdmin = key === "admin_vexo";

  return {
    key,
    label,
    description,
    role: "internal",
    scopeMode: isAdmin
      ? "all_clients"
      : normalizeScopeMode(input.scopeMode ?? input.scope_mode, role),
    approvalLevel: isAdmin
      ? "director"
      : normalizeApprovalLevel(input.approvalLevel ?? input.approval_level, role),
    permissions: isAdmin
      ? [...ACCESS_PERMISSION_KEYS]
      : normalizePermissions(input.permissions, role, key),
    internalPages: isAdmin
      ? [...INTERNAL_PAGE_KEYS]
      : normalizeInternalPages(input.internalPages ?? input.internal_pages, role, false, key),
    allowedViews: [],
    isSystem: Boolean(input.isSystem ?? input.is_system),
    isLocked: Boolean(input.isLocked ?? input.is_locked),
    createdAt: input.createdAt ?? input.created_at ?? null,
    updatedAt: input.updatedAt ?? input.updated_at ?? null,
  };
}

export function buildSystemAccessProfiles() {
  return SYSTEM_ACCESS_PROFILES.map((profile) => normalizeAccessProfileRecord(profile));
}

export function isMissingAccessProfilesTable(error) {
  const code = normalizeString(error?.code);
  const message = `${error?.message || ""} ${error?.details || ""}`.toLowerCase();

  return code === "42P01" || (message.includes("access_profiles") && message.includes("does not exist"));
}

export async function listAccessProfiles() {
  const systemProfiles = buildSystemAccessProfiles();

  // O usuário solicitou que houvesse apenas UMA fonte de verdade para os perfis.
  // Como não há UI para gerenciar a tabela access_profiles, usaremos apenas os perfis nativos blindados (hardcoded).
  return systemProfiles.sort((left, right) => {
    return left.label.localeCompare(right.label, "pt-BR");
  });
}

export function findAccessProfileByKey(profiles, key) {
  const normalizedKey = normalizeString(key)?.toLowerCase();
  if (!normalizedKey) return null;

  return profiles.find((profile) => profile.key === normalizedKey) || null;
}

export function resolveRequestedAccessProfile(profiles, key, role) {
  const explicitProfile = findAccessProfileByKey(profiles, key);
  if (explicitProfile) {
    return explicitProfile;
  }

  return findAccessProfileByKey(profiles, getDefaultPresetForRole(role));
}

export function serializeAccessProfileRecord(profile) {
  return {
    key: profile.key,
    label: profile.label,
    description: profile.description,
    role: profile.role,
    scope_mode: profile.scopeMode,
    approval_level: profile.approvalLevel,
    permissions: profile.permissions,
    internal_pages: profile.internalPages,
    allowed_views: profile.allowedViews,
    is_system: profile.isSystem,
    is_locked: profile.isLocked,
    updated_at: new Date().toISOString(),
  };
}

export async function syncUsersWithAccessProfile(profile) {
  const auth = getAuth();
  const users = await listAllFirebaseUsers();
  let updatedUsers = 0;
  let skippedUsers = 0;

  for (const user of users) {
    const currentAccess = extractManagedAccessClaims(user.customClaims || {}, {
      uid: user.uid,
      email: user.email,
    });

    if (currentAccess.accessPreset !== profile.key) {
      continue;
    }

    if (isFixedAdminIdentity({ uid: user.uid, email: user.email })) {
      skippedUsers += 1;
      continue;
    }

    try {
      const nextClaims = buildManagedClaims({
        role: profile.role,
        accessPreset: profile.key,
        scopeMode: profile.scopeMode,
        approvalLevel: profile.approvalLevel,
        permissions: profile.permissions,
        clientIds: currentAccess.clientIds,
        tenantIds: currentAccess.tenantIds,
        clientId: currentAccess.clientId,
        tenantId: currentAccess.tenantId,
        allowedViews: profile.allowedViews,
        companyName: currentAccess.companyName,
        internalPages: profile.internalPages,
      });

      await auth.setCustomUserClaims(
        user.uid,
        mergeManagedClaims(user.customClaims || {}, nextClaims)
      );
      updatedUsers += 1;
    } catch (error) {
      skippedUsers += 1;
      console.error("access profile sync error:", {
        key: profile.key,
        uid: user.uid,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { updatedUsers, skippedUsers };
}

export async function propagateTenantPermissions(tenantId, allowedTabs) {
  const auth = getAuth();
  const users = await listAllFirebaseUsers();
  let updatedUsers = 0;
  let skippedUsers = 0;

  const companyViews = (allowedTabs || []).filter((view) =>
    CLIENT_VIEW_KEYS.includes(view)
  );

  for (const user of users) {
    const currentAccess = extractManagedAccessClaims(user.customClaims || {}, {
      uid: user.uid,
      email: user.email,
    });

    if (currentAccess.role !== "client") {
      continue;
    }

    const belongsToTenant =
      currentAccess.clientId === tenantId ||
      (currentAccess.clientIds && currentAccess.clientIds.includes(tenantId));

    if (!belongsToTenant) {
      continue;
    }

    try {
      const nextAllowedViews = Array.from(
        new Set([...(currentAccess.allowedViews || []), ...companyViews])
      );

      const nextClaims = buildManagedClaims({
        role: "client",
        accessPreset: currentAccess.accessPreset,
        scopeMode: currentAccess.scopeMode,
        approvalLevel: currentAccess.approvalLevel,
        permissions: currentAccess.permissions,
        clientIds: currentAccess.clientIds,
        tenantIds: currentAccess.tenantIds,
        clientId: currentAccess.clientId,
        tenantId: currentAccess.tenantId,
        allowedViews: nextAllowedViews,
        companyName: currentAccess.companyName,
      });

      await auth.setCustomUserClaims(
        user.uid,
        mergeManagedClaims(user.customClaims || {}, nextClaims)
      );
      updatedUsers += 1;
    } catch (error) {
      skippedUsers += 1;
      console.error("tenant permission propagation error for user:", {
        uid: user.uid,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { updatedUsers, skippedUsers };
}

export function isManagerOrAdmin(access) {
  if (!access) return false;
  if (access.isFixedAdmin || access.isAdmin || access.isAdminUser || access.role === "superadmin") return true;
  if (access.preset === "admin_vexo" || access.preset === "gestor") return true;
  if (access.approvalLevel === "manager" || access.approvalLevel === "director") return true;
  if (Array.isArray(access.internalPages) && access.internalPages.includes("usuarios")) return true;
  if (Array.isArray(access.permissions) && (access.permissions.includes("users.manage") || access.permissions.includes("users.view"))) return true;
  return false;
}
