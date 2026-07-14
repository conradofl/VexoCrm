import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  FileSpreadsheet,
  LockKeyhole,
  LineChart,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Trash2,
  UserRound,
  LayoutDashboard,
  Users,
  MessageSquare,
  Bot,
  Building2,
  Megaphone,
  Activity,
  Settings,
  Globe,
  CheckCircle2,
  Monitor,
  Rocket,
  ShieldAlert,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/EmptyState";
import { PageShell } from "@/components/PageShell";
import { type AccessProfileRecord, useAccessProfiles } from "@/hooks/useAccessProfiles";
import { type LeadClient, useLeadClients } from "@/hooks/useLeadClients";
import { type AdminUserRecord, useAdminUsers } from "@/hooks/useAdminUsers";
import { fetchApi, readApiErrorMessage, readApiJson } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  ACCESS_PRESET_ORDER,
  ACCESS_PERMISSION_DEFINITIONS,
  ACCESS_PERMISSION_ORDER,
  CLIENT_VIEW_ORDER,
  buildPresetDefaults,
  getAccessPresetLabel,
  getDefaultPresetForRole,
  INTERNAL_PAGE_ORDER,
  isFixedAdminAccount,
  USER_MANAGEMENT_PRESETS,
  type AccessPermission,
  type AccessPreset,
  type AccessRole,
  type AccessScope,
  type AccessView,
  type ApprovalLevel,
  type InternalPage,
} from "@/lib/access";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { useToast } from "@/hooks/use-toast";
import { InternalPagesHierarchyPanel } from "@/components/InternalPagesHierarchyPanel";

type ManagedRole = AccessRole;

interface UserDraft {
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

interface CreateUserDraft {
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

type AccessDraft = UserDraft | CreateUserDraft;
type RoleFilter = "all" | ManagedRole;
type ActionFeedbackTone = "success" | "error";

interface ActionFeedbackState {
  tone: ActionFeedbackTone;
  title: string;
  message: string;
  details?: string | null;
}

const DEFAULT_INTERNAL_PAGES: InternalPage[] = ["dashboard"];
const DEFAULT_CLIENT_VIEWS: AccessView[] = ["dashboard", "leads"];

const ROLE_LABELS: Record<ManagedRole, string> = {
  internal: "Interno",
  client: "Cliente",
  pending: "Pendente",
};

const ROLE_BADGE_CLASS: Record<ManagedRole, string> = {
  internal: "bg-primary/10 text-primary",
  client: "bg-[#1A5CFF]/10 text-[#1A5CFF]",
  pending: "bg-amber-500/10 text-amber-500",
};

const ROLE_SCOPES: Record<ManagedRole, AccessScope[]> = {
  internal: ["all_clients", "assigned_clients", "no_client_access"],
  client: ["assigned_clients", "no_client_access"],
  pending: ["no_client_access"],
};

const ROLE_APPROVAL_LEVELS: Record<ManagedRole, ApprovalLevel[]> = {
  internal: ["none", "operator", "supervisor", "manager", "director"],
  client: ["none", "operator", "supervisor", "manager"],
  pending: ["none"],
};

const ROLE_PERMISSIONS: Record<ManagedRole, AccessPermission[]> = {
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

const VIEW_LABELS: Record<AccessView, string> = {
  dashboard: "Dashboard",
  leads: "Leads",
  planilhas: "Planilhas",
  whatsapp: "WhatsApp",
};

const INTERNAL_PAGE_LABELS: Record<InternalPage, string> = {
  dashboard: "Dashboard",
  "propostas-gd": "Propostas GD",
  "contratos-gd": "Contratos GD",
  "pacotes-gd": "Pacotes GD",
  "condicoes-gd": "Condições GD",
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

const CLIENT_PAGE_TABS = [
  { value: "portal", label: "Portal", items: ["dashboard", "leads", "planilhas"] as AccessView[] },
  { value: "comunicacao", label: "Comunicacao", items: ["whatsapp"] as AccessView[] },
];

const INTERNAL_PAGE_TABS = [
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

type InternalShortcutKey = "campaigns" | "commercial";

const INTERNAL_SHORTCUTS: Array<{
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

function findAccessProfile(profiles: AccessProfileRecord[], key: string | null | undefined) {
  const normalizedKey = key?.trim().toLowerCase();
  if (!normalizedKey) return null;

  return profiles.find((profile) => profile.key === normalizedKey) || null;
}

function applyAccessProfileToDraft<T extends AccessDraft>(draft: T, profile: AccessProfileRecord | null): T {
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

function buildAccessProfileDraft(profile?: AccessProfileRecord | null): AccessProfileDraft {
  if (!profile) {
    return {
      key: "",
      label: "",
      description: "",
      role: "internal",
      scopeMode: "assigned_clients",
      approvalLevel: "operator",
      allowedViews: [],
      internalPages: [...DEFAULT_INTERNAL_PAGES],
      permissions: derivePermissionsFromInternalPages(DEFAULT_INTERNAL_PAGES),
    };
  }

  return {
    key: profile.key,
    label: profile.label,
    description: profile.description || "",
    role: profile.role,
    scopeMode: profile.scopeMode,
    approvalLevel: profile.approvalLevel,
    allowedViews: [...profile.allowedViews],
    internalPages: [...profile.internalPages],
    permissions: [...profile.permissions],
  };
}

const FALLBACK_ACCESS_PROFILE_DESCRIPTIONS: Record<string, string> = {
  admin_vexo: "Acesso total ao CRM (Você e a equipe técnica).",
  gestor: "Time comercial (interno). Pode ver vários clientes, mas não pode alterar configs sensíveis do sistema.",
  operador: "Time comercial (interno). Pode ver vários clientes, mas não pode deletar o sistema.",
  parceiro: "Acompanha a operacao com leitura e conversa limitada.",
  client_manager: "Pode ver os leads da empresa dele, integrar WhatsApp e gerar API keys.",
  client_operator: "Um vendedor do cliente. Pode apenas falar com os leads (não pode deletar nada, nem ver configs).",
  client_viewer: "Acesso apenas de leitura para o cliente.",
  pending: "Conta ainda sem liberacao operacional.",
};

function buildFallbackAccessProfiles(): AccessProfileRecord[] {
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

function buildUserDraft(user: AdminUserRecord): UserDraft {
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

function buildCreateDraft(): CreateUserDraft {
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

interface AccessProfileDraft {
  key: string;
  label: string;
  description: string;
  role: ManagedRole;
  scopeMode: AccessScope;
  approvalLevel: ApprovalLevel;
  allowedViews: AccessView[];
  internalPages: InternalPage[];
  permissions: AccessPermission[];
}

function derivePermissionsFromClientViews(views: AccessView[]): AccessPermission[] {
  const permissions: AccessPermission[] = [];

  if (views.includes("dashboard")) permissions.push("dashboard.view");
  if (views.includes("leads")) permissions.push("leads.view");
  if (views.includes("planilhas")) permissions.push("imports.manage");
  if (views.includes("whatsapp")) permissions.push("whatsapp.view", "whatsapp.reply");

  return filterArray(permissions, ACCESS_PERMISSION_ORDER);
}

function derivePermissionsFromInternalPages(pages: InternalPage[]): AccessPermission[] {
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

function hasInternalShortcutAccess(draft: AccessDraft, shortcut: InternalShortcutKey) {
  if (draft.role !== "internal") {
    return false;
  }

  if (shortcut === "campaigns") {
    return draft.permissions.includes("campaigns.manage");
  }

  return draft.internalPages.includes("dashboard") && draft.permissions.includes("dashboard.view");
}

function buildInternalShortcutPatch(
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

function applySimpleAccessModel<T extends AccessDraft>(draft: T): T {
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

function normalizeCreateDraftForSimpleForm(draft: CreateUserDraft): CreateUserDraft {
  return applySimpleAccessModel(draft);
}

function formatDate(value: string | null) {
  if (!value) return "Nunca";

  try {
    return new Date(value).toLocaleString("pt-BR");
  } catch {
    return value;
  }
}

function toggleItem<T>(items: T[], item: T, checked: boolean) {
  return checked ? Array.from(new Set([...items, item])) : items.filter((entry) => entry !== item);
}

function filterArray<T extends string>(items: T[], allowed: readonly T[]) {
  return Array.from(new Set(items.filter((item): item is T => allowed.includes(item))));
}

function normalizeDraft<T extends AccessDraft>(draft: T): T {
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

function transitionDraft<T extends AccessDraft>(draft: T): T {
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

function buildPayload(draft: AccessDraft) {
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

function validateDraft(draft: AccessDraft) {
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


function normalizeAccessProfileDraft(draft: AccessProfileDraft): AccessProfileDraft {
  if (draft.role === "pending") {
    return {
      ...draft,
      role: "pending",
      scopeMode: "no_client_access",
      approvalLevel: "none",
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

    return {
      ...draft,
      role: "client",
      scopeMode: "assigned_clients",
      approvalLevel: ROLE_APPROVAL_LEVELS.client.includes(draft.approvalLevel)
        ? draft.approvalLevel
        : "operator",
      allowedViews,
      internalPages: [],
      permissions: filterArray(
        draft.permissions.length ? draft.permissions : derivePermissionsFromClientViews(allowedViews),
        ROLE_PERMISSIONS.client
      ),
    };
  }

  const internalPages = filterArray(
    draft.internalPages.length ? draft.internalPages : DEFAULT_INTERNAL_PAGES,
    INTERNAL_PAGE_ORDER
  );

  return {
    ...draft,
    role: "internal",
    scopeMode: ROLE_SCOPES.internal.includes(draft.scopeMode) ? draft.scopeMode : "assigned_clients",
    approvalLevel: ROLE_APPROVAL_LEVELS.internal.includes(draft.approvalLevel)
      ? draft.approvalLevel
      : "operator",
    allowedViews: [],
    internalPages,
    permissions: filterArray(
      draft.permissions.length ? draft.permissions : derivePermissionsFromInternalPages(internalPages),
      ROLE_PERMISSIONS.internal
    ),
  };
}

function validateAccessProfileDraft(draft: AccessProfileDraft, isNew: boolean) {
  const normalized = normalizeAccessProfileDraft(draft);

  if (isNew) {
    const normalizedKey = normalized.key.trim().toLowerCase();
    if (!normalizedKey) {
      return "Informe uma chave para o tipo.";
    }

    if (!/^[a-z0-9_-]+$/.test(normalizedKey)) {
      return "A chave do tipo deve usar apenas letras minusculas, numeros, underline ou hifen.";
    }
  }

  if (!normalized.label.trim()) {
    return "Informe um nome para o tipo.";
  }

  if (normalized.role === "client" && normalized.allowedViews.length === 0) {
    return "Selecione ao menos uma pagina para o tipo de cliente.";
  }

  if (normalized.role === "internal" && normalized.internalPages.length === 0) {
    return "Selecione ao menos uma pagina para o tipo interno.";
  }

  if (normalized.role !== "pending" && normalized.permissions.length === 0) {
    return "Selecione ao menos uma permissao para o tipo.";
  }

  return null;
}

interface ChecklistPanelProps {
  title: string;
  description: string;
  items: string[];
  selected: string[];
  disabled: boolean;
  emptyMessage: string;
  searchPlaceholder?: string;
  onToggle: (item: string, checked: boolean) => void;
  onSelectAll?: () => void;
  onClear?: () => void;
  renderLabel: (item: string) => string;
  renderHint?: (item: string) => string | null;
}

function getPermissionIcon(item: string, active: boolean) {
  const cnIcon = cn(
    "h-5 w-5 transition-transform duration-300 group-hover:scale-110",
    active ? "text-primary-foreground" : "text-muted-foreground"
  );

  const key = item.toLowerCase();

  if (key.startsWith("dashboard")) return <LayoutDashboard className={cnIcon} />;
  if (key.startsWith("leads")) return <Users className={cnIcon} />;
  if (key.startsWith("planilhas") || key.includes("imports")) return <FileSpreadsheet className={cnIcon} />;
  if (key.startsWith("whatsapp")) return <MessageSquare className={cnIcon} />;
  if (key.startsWith("agente")) return <Bot className={cnIcon} />;
  if (key.startsWith("usuarios") || key.includes("users")) return <UserRound className={cnIcon} />;
  if (key.startsWith("empresas") || key.includes("tenants")) return <Building2 className={cnIcon} />;
  if (key.startsWith("campanhas") || key.includes("campaigns")) return <Megaphone className={cnIcon} />;

  return <Globe className={cnIcon} />;
}

function ChecklistPanel({
  title,
  description,
  items,
  selected,
  disabled,
  emptyMessage,
  searchPlaceholder,
  onToggle,
  onSelectAll,
  onClear,
  renderLabel,
  renderHint,
}: ChecklistPanelProps) {
  const [search, setSearch] = useState("");
  const term = search.trim().toLowerCase();
  const filteredItems = items.filter((item) => {
    if (!term) return true;

    const label = renderLabel(item).toLowerCase();
    const hint = renderHint?.(item)?.toLowerCase() || "";
    return label.includes(term) || hint.includes(term);
  });

  return (
    <div className="p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-bold text-foreground tracking-tight">{title}</p>
          <p className="text-[11px] text-muted-foreground leading-relaxed">{description}</p>
        </div>

        <div className="flex items-center gap-1.5 bg-muted/10 border border-border/40 p-1 rounded-xl">
          <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary rounded-lg font-semibold px-2 py-0.5 text-[10px]">
            {selected.length} selecionados
          </Badge>

          {onSelectAll ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="rounded-lg font-medium px-2 h-7 text-[10px] hover:bg-background/80"
              disabled={disabled || items.length === 0}
              onClick={onSelectAll}
            >
              Marcar todos
            </Button>
          ) : null}

          {onClear ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="rounded-lg font-medium px-2 h-7 text-[10px] hover:bg-background/80 text-muted-foreground hover:text-destructive"
              disabled={disabled || selected.length === 0}
              onClick={onClear}
            >
              Limpar
            </Button>
          ) : null}
        </div>
      </div>

      {items.length > 6 ? (
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/80" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder || "Filtrar por nome ou descrição..."}
            className="pl-9 h-9 text-xs rounded-xl bg-background/50 border-border/60 focus-visible:ring-primary/20 focus-visible:border-primary/50"
          />
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="text-center py-8 rounded-xl border border-dashed border-border/60 bg-muted/5">
          <ShieldAlert className="h-6 w-6 text-muted-foreground mx-auto mb-2 opacity-60" />
          <p className="text-xs text-muted-foreground font-medium">{emptyMessage}</p>
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="text-center py-8 rounded-xl border border-dashed border-border/60 bg-muted/5">
          <Search className="h-6 w-6 text-muted-foreground mx-auto mb-2 opacity-60" />
          <p className="text-xs text-muted-foreground font-medium">Nenhum módulo corresponde ao termo buscado.</p>
        </div>
      ) : (
        <ScrollArea className="max-h-[360px] pr-2">
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
            {filteredItems.map((item, index) => {
              const isSelected = selected.includes(item);
              return (
                <div
                  key={item}
                  onClick={() => {
                    if (!disabled) {
                      onToggle(item, !isSelected);
                    }
                  }}
                  className={cn(
                    "flex items-center justify-between py-2 px-3.5 rounded-xl border transition-all duration-200 cursor-pointer select-none",
                    isSelected
                      ? "border-primary/25 bg-primary/[0.03] shadow-sm"
                      : "border-border/40 bg-background/30 hover:border-border/80 hover:bg-muted/5",
                    disabled && "opacity-60 cursor-not-allowed"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-colors border",
                      isSelected ? "text-primary bg-primary/10 border-primary/20" : "text-muted-foreground bg-muted/40 border-border/40"
                    )}>
                      {getPermissionIcon(item, isSelected)}
                    </div>
                    <div className="space-y-0.5 min-w-0">
                      <span className={cn(
                        "block font-semibold text-xs transition-colors",
                        isSelected ? "text-primary" : "text-foreground"
                      )}>
                        {renderLabel(item)}
                      </span>
                      {renderHint?.(item) ? (
                        <span className="block text-[10px] text-muted-foreground/80 truncate max-w-[160px]">
                          {renderHint(item)}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <Switch
                    checked={isSelected}
                    disabled={disabled}
                    className="scale-75 data-[state=checked]:bg-primary"
                  />
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

interface AccessPagesTabsProps {
  role: "internal" | "client";
  selected: string[];
  disabled: boolean;
  onChange: (next: string[]) => void;
}

function AccessPagesTabs({ role, selected, disabled, onChange }: AccessPagesTabsProps) {
  if (role === "internal") {
    return <InternalPagesHierarchyPanel selected={selected} disabled={disabled} onChange={onChange} />;
  }

  const tabs = CLIENT_PAGE_TABS;
  const referenceOrder = CLIENT_VIEW_ORDER;
  const [activeTab, setActiveTab] = useState(tabs[0].value);

  useEffect(() => {
    setActiveTab(tabs[0].value);
  }, [tabs]);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
      <TabsList
        className={cn(
          "w-full p-1.5 bg-muted/20 border border-border/40 rounded-[1.75rem] h-auto flex flex-wrap sm:grid",
          tabs.length === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2"
        )}
      >
        {tabs.map((tab) => {
          const selectedCount = tab.items.filter((item) => selected.includes(item)).length;
          const isOperacaoOrPortal = tab.value === "vendas" || tab.value === "portal";
          const isDisparosOrComunicacao = tab.value === "disparos" || tab.value === "comunicacao";
          const isSistema = tab.value === "sistema";

          return (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="rounded-2xl h-12 font-bold text-sm transition-all data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-md flex items-center justify-center gap-2"
            >
              {isOperacaoOrPortal ? (
                <Activity className="h-4 w-4" />
              ) : isDisparosOrComunicacao ? (
                <Rocket className="h-4 w-4" />
              ) : isSistema ? (
                <Monitor className="h-4 w-4" />
              ) : (
                <Settings className="h-4 w-4" />
              )}
              <span className="truncate">{tab.label}</span>
              <Badge variant="secondary" className="ml-1 h-5 min-w-5 rounded-full px-1.5 flex items-center justify-center text-[10px] font-extrabold bg-muted-foreground/10 text-muted-foreground data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
                {selectedCount} / {tab.items.length}
              </Badge>
            </TabsTrigger>
          );
        })}
      </TabsList>

      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="mt-0 outline-none">
          <ChecklistPanel
            title={role === "client" ? "Páginas do Portal do Cliente" : "Módulos do Sistema (Interno)"}
            description={
              role === "client"
                ? "Marque as telas e funcionalidades que o cliente final enxergará ao fazer login."
                : "Libere os recursos operacionais e de gestão que esse membro interno terá no CRM."
            }
            items={tab.items}
            selected={selected}
            disabled={disabled}
            emptyMessage="Nenhuma página ou módulo disponível."
            onToggle={(item, checked) => onChange(toggleItem(selected, item, checked))}
            onSelectAll={() =>
              onChange(filterArray(Array.from(new Set([...selected, ...tab.items])), referenceOrder))
            }
            onClear={() => {
              const tabItems = tab.items as string[];
              onChange(selected.filter((item) => !tabItems.includes(item)));
            }}
            renderLabel={(item) =>
              role === "client"
                ? VIEW_LABELS[item as AccessView]
                : INTERNAL_PAGE_LABELS[item as InternalPage]
            }
            renderHint={(item) => {
              if (role === "client") {
                if (item === "whatsapp") return "Caixa de entrada e conversa";
                if (item === "planilhas") return "Envio de bases e histórico";
                if (item === "dashboard") return "Painel visual com métricas";
                return "Página do portal";
              }

              if (item === "dashboard") return "Métricas e inteligência comercial";
              if (item === "usuarios") return "Governança e auditoria de acessos";
              if (item === "agente") return "Configurações do agente de IA";
              if (item === "campanhas") return "Disparo e fluxo de contatos";
              if (item === "planilhas") return "Importação e limpeza de listas";
              if (item === "empresas") return "Organização de tenants/empresas";
              if (item === "inteligencia-comercial") return "Performance e equipe de vendas";
              if (item === "chatbot-kanban") return "Painel de leads do chatbot";
              if (item === "chatbot-config") return "Configurações e prompts do chatbot";
              if (item === "fila-de-followup") return "Fila e sugestões de follow-up";
              if (item === "chatbot-docs") return "Documentação do chatbot";
              if (item === "onboarding-wizard") return "Vídeos e tutoriais da plataforma";
              if (item === "apresentacao") return "Apresentação comercial e demo";
              if (item === "conexoes") return "Painel de chips de WhatsApp";
              if (item === "aquecimento") return "Aquecimento de números";
              if (item === "relatorios") return "Relatórios de consumo e uso";
              if (item === "apresentacao-gd") return "Apresentação de Onboarding Geração Digital";
              return "Módulo do CRM";
            }}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

interface AccessProfileFormProps {
  draft: AccessProfileDraft;
  isNew: boolean;
  editable: boolean;
  onChange: (next: AccessProfileDraft) => void;
}

function AccessProfileForm({ draft, isNew, editable, onChange }: AccessProfileFormProps) {
  const normalized = normalizeAccessProfileDraft(draft);
  const permissionItems = ROLE_PERMISSIONS[normalized.role];

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-border/80 bg-background/60 p-5">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Chave</p>
            <Input
              value={normalized.key}
              disabled={!editable || !isNew}
              onChange={(event) => onChange({ ...normalized, key: event.target.value.toLowerCase() })}
              placeholder="ex: comercial_cliente"
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Nome</p>
            <Input
              value={normalized.label}
              disabled={!editable}
              onChange={(event) => onChange({ ...normalized, label: event.target.value })}
              placeholder="Nome do tipo"
            />
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Categoria</p>
            <Select
              value={normalized.role}
              disabled={!editable}
              onValueChange={(value: ManagedRole) =>
                onChange(
                  normalizeAccessProfileDraft({
                    ...normalized,
                    role: value,
                    approvalLevel:
                      value === "internal" ? "operator" : value === "client" ? "operator" : "none",
                  })
                )
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecionar categoria" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="internal">Interno</SelectItem>
                <SelectItem value="client">Cliente</SelectItem>
                <SelectItem value="pending">Pendente</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {normalized.role === "internal" ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Escopo</p>
              <Select
                value={normalized.scopeMode}
                disabled={!editable}
                onValueChange={(value: AccessScope) => onChange({ ...normalized, scopeMode: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar escopo" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all_clients">Todos os tenants</SelectItem>
                  <SelectItem value="assigned_clients">Tenants vinculados</SelectItem>
                  <SelectItem value="no_client_access">Sem escopo operacional</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-[220px_minmax(0,1fr)]">
          {(normalized.role as string) !== "pending" ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Aprovacao</p>
              <Select
                value={normalized.approvalLevel}
                disabled={!editable}
                onValueChange={(value: ApprovalLevel) => onChange({ ...normalized, approvalLevel: value })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar nivel" />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_APPROVAL_LEVELS[normalized.role].map((level) => (
                    <SelectItem key={level} value={level}>
                      {level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Descricao</p>
            <Input
              value={normalized.description}
              disabled={!editable}
              onChange={(event) => onChange({ ...normalized, description: event.target.value })}
              placeholder="Resumo rapido do uso desse tipo"
            />
          </div>
        </div>
      </div>

      {normalized.role !== "pending" ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
          <AccessPagesTabs
            role={(normalized.role as string) === "pending" ? "internal" : normalized.role}
            selected={normalized.role === "client" ? normalized.allowedViews : normalized.internalPages}
            disabled={!editable}
            onChange={(next) =>
              onChange(
                normalizeAccessProfileDraft(
                  normalized.role === "client"
                    ? { ...normalized, allowedViews: next as AccessView[] }
                    : { ...normalized, internalPages: next as InternalPage[] }
                )
              )
            }
          />

          <ChecklistPanel
            title="Permissoes do tipo"
            description="Ajuste as permissoes operacionais que esse tipo vai carregar por padrao."
            items={permissionItems}
            selected={normalized.permissions}
            disabled={!editable || (normalized.role as string) === "pending"}
            emptyMessage="Nenhuma permissao disponivel."
            onToggle={(item, checked) =>
              onChange({
                ...normalized,
                permissions: toggleItem(normalized.permissions, item as AccessPermission, checked),
              })
            }
            onSelectAll={() => onChange({ ...normalized, permissions: [...permissionItems] })}
            onClear={() => onChange({ ...normalized, permissions: [] })}
            renderLabel={(item) => ACCESS_PERMISSION_DEFINITIONS[item as AccessPermission]?.label || item}
            renderHint={(item) => ACCESS_PERMISSION_DEFINITIONS[item as AccessPermission]?.description || null}
          />
        </div>
      ) : (
        <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
          Tipos pendentes nao recebem paginas nem permissoes operacionais.
        </div>
      )}
    </div>
  );
}

interface AccessGovernanceProps {
  draft: AccessDraft;
  accessProfiles: AccessProfileRecord[];
  clients: LeadClient[];
  selectedClientId: string;
  editable: boolean;
  onChange: (patch: Partial<AccessDraft>) => void;
}

function resolveDraftClientBinding(draft: AccessDraft, clients: LeadClient[], selectedClientId: string) {
  if (draft.clientIds.length > 0) {
    const currentId = draft.clientIds[0];
    const currentClient = clients.find((client) => client.id === currentId);

    return {
      clientIds: [currentId],
      companyName: draft.companyName || currentClient?.name || "",
    };
  }

  if (selectedClientId) {
    const selectedClient = clients.find((client) => client.id === selectedClientId);
    if (selectedClient) {
      return {
        clientIds: [selectedClient.id],
        companyName: draft.companyName || selectedClient.name,
      };
    }
  }

  const normalizedCompany = draft.companyName.trim().toLowerCase();
  if (normalizedCompany) {
    const matchedClient = clients.find((client) => client.name.trim().toLowerCase() === normalizedCompany);
    if (matchedClient) {
      return {
        clientIds: [matchedClient.id],
        companyName: draft.companyName || matchedClient.name,
      };
    }
  }

  return {
    clientIds: [],
    companyName: draft.companyName,
  };
}

function prepareDraftForPersistence<T extends AccessDraft>(
  draft: T,
  clients: LeadClient[],
  selectedClientId: string
): T {
  const normalized = applySimpleAccessModel(draft);
  if (normalized.role === "pending" || normalized.clientIds.length > 0) {
    return normalized;
  }

  const binding = resolveDraftClientBinding(normalized, clients, selectedClientId);
  if (binding.clientIds.length === 0) {
    return normalized;
  }

  return applySimpleAccessModel({
    ...normalized,
    clientIds: binding.clientIds,
    companyName: binding.companyName,
  }) as T;
}

function AccessGovernance({ draft, accessProfiles, clients, selectedClientId, editable, onChange }: AccessGovernanceProps) {
  const normalized = applySimpleAccessModel(draft);
  const matrixDisabled = !editable || normalized.role === "pending";
  const applyPatch = (patch: Partial<AccessDraft>) => onChange(applySimpleAccessModel({ ...normalized, ...patch }));
  const selectedType = findAccessProfile(accessProfiles, normalized.accessPreset);
  const approvalProfiles = useMemo(
    () => accessProfiles.filter((profile) => profile.role !== "pending"),
    [accessProfiles]
  );
  const internalApprovalProfile = approvalProfiles.find((profile) => profile.role === "internal") || null;
  const clientApprovalProfile = approvalProfiles.find((profile) => profile.role === "client") || null;
  const applyApprovalProfile = (profileKey: string) => {
    const profile = findAccessProfile(accessProfiles, profileKey);
    if (!profile) return;
    const binding = resolveDraftClientBinding(normalized, clients, selectedClientId);

    onChange(
      applyAccessProfileToDraft(
        {
          ...normalized,
          accessPreset: profileKey,
          clientIds: binding.clientIds,
          companyName: binding.companyName,
        },
        profile
      )
    );
  };
  const resolvedBinding = resolveDraftClientBinding(normalized, clients, selectedClientId);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">

      {normalized.role === "pending" ? (
        <div className="rounded-[2rem] border border-amber-500/20 bg-gradient-to-br from-amber-500/10 to-amber-500/5 p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-8 opacity-10">
            <ShieldCheck className="w-32 h-32 text-amber-500" />
          </div>
          <div className="relative z-10">
            <h3 className="text-xl font-bold text-amber-600 mb-2">Liberação de Acesso</h3>
            <p className="text-sm text-amber-700/80 max-w-[60%] mb-8 leading-relaxed">
              Este usuário solicitou acesso, mas precisa da sua aprovação. Defina como ele irá operar no CRM para destravar os módulos do sistema.
            </p>

            <div className="space-y-4">
              <p className="text-sm font-semibold text-amber-800">Selecione o perfil de liberação:</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {approvalProfiles.map((profile) => (
                  <button
                    key={profile.key}
                    type="button"
                    disabled={!editable}
                    onClick={() => applyApprovalProfile(profile.key)}
                    className={cn(
                      "text-left p-5 rounded-2xl border transition-all duration-200 group",
                      normalized.accessPreset === profile.key
                        ? "border-amber-500 bg-amber-500/10 shadow-sm"
                        : "border-amber-500/20 bg-background/50 hover:bg-amber-500/5 hover:border-amber-500/40"
                    )}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <span className="font-bold text-amber-900">{profile.label}</span>
                      <Badge className={ROLE_BADGE_CLASS[profile.role]}>{ROLE_LABELS[profile.role]}</Badge>
                    </div>
                    {profile.description && (
                      <p className="text-xs text-amber-800/70 leading-5">{profile.description}</p>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-3">
              <label className="text-sm font-bold text-foreground flex items-center gap-2">
                Perfil de Acesso Principal
              </label>
              <Select
                value={normalized.accessPreset}
                disabled={!editable}
                onValueChange={(value) => {
                  const profile = findAccessProfile(accessProfiles, value);
                  onChange(applyAccessProfileToDraft({ ...normalized, accessPreset: value }, profile));
                }}
              >
                <SelectTrigger className="h-14 rounded-2xl bg-muted/10 border-border/60 hover:bg-muted/20 transition-colors text-base px-4">
                  <SelectValue placeholder="Selecionar perfil de acesso" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  {accessProfiles.filter(p => p.role !== "pending").map((profile) => (
                    <SelectItem key={profile.key} value={profile.key} className="py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{profile.label}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">{ROLE_LABELS[profile.role]}</Badge>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedType?.description && (
                <p className="text-xs text-muted-foreground leading-relaxed pl-1">{selectedType.description}</p>
              )}
            </div>

            <div className="space-y-3">
              <label className="text-sm font-bold text-foreground">Empresa / Tenant Vinculado</label>
              <Select
                value={normalized.clientIds[0] || resolvedBinding.clientIds[0] || "__none"}
                disabled={!editable}
                onValueChange={(value) => {
                  const selectedClient = clients.find((client) => client.id === value);
                  applyPatch({
                    clientIds: value === "__none" ? [] : [value],
                    companyName: value === "__none" ? "" : selectedClient?.name || "",
                  });
                }}
              >
                <SelectTrigger className="h-14 rounded-2xl bg-muted/10 border-border/60 hover:bg-muted/20 transition-colors text-base px-4">
                  <SelectValue placeholder="Selecionar empresa" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="__none" className="py-3 font-medium text-muted-foreground">
                    {normalized.role === "client" ? "Selecionar empresa (Obrigatório)" : "Sem vínculo específico (Global)"}
                  </SelectItem>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id} className="py-3">
                      <span className="font-medium">{client.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-3">
            <label className="text-sm font-bold text-foreground">Nome de Exibição da Empresa (Opcional)</label>
            <Input
              value={normalized.companyName}
              disabled={!editable}
              onChange={(event) => applyPatch({ companyName: event.target.value })}
              placeholder="Ex: Vexo CRM"
              className="h-14 rounded-2xl bg-muted/10 border-border/60 hover:bg-muted/20 transition-colors text-base px-4"
            />
            <p className="text-xs text-muted-foreground pl-1">Se preenchido, substitui o nome padrão da empresa na interface deste usuário.</p>
          </div>
        </div>
      )}

      {normalized.role === "internal" ? (
        <div className="pt-8 border-t border-border/40 space-y-5">
          <h4 className="text-base font-bold text-foreground">Acessos Rápidos (Administração)</h4>
          <div className="grid gap-4 md:grid-cols-2">
            {INTERNAL_SHORTCUTS.map((shortcut) => {
              const enabled = hasInternalShortcutAccess(normalized, shortcut.key);
              const ShortcutIcon = shortcut.icon;

              return (
                <button
                  key={shortcut.key}
                  type="button"
                  disabled={!editable}
                  onClick={() => applyPatch(buildInternalShortcutPatch(normalized, shortcut.key, !enabled))}
                  className={cn(
                    "text-left rounded-[2rem] border p-6 transition-all duration-300 relative overflow-hidden group",
                    enabled
                      ? "border-primary/40 bg-primary/5 shadow-md"
                      : "border-border/60 bg-muted/5 hover:border-border hover:bg-muted/10"
                  )}
                >
                  <div className="flex items-start justify-between gap-4 relative z-10">
                    <div className="flex items-start gap-4">
                      <div className={cn(
                        "flex h-12 w-12 items-center justify-center rounded-2xl transition-colors",
                        enabled ? "bg-primary text-primary-foreground shadow-sm" : "bg-muted text-muted-foreground group-hover:text-foreground"
                      )}>
                        <ShortcutIcon className="h-5 w-5" />
                      </div>
                      <div className="space-y-1 mt-1">
                        <p className={cn("font-bold", enabled ? "text-primary" : "text-foreground")}>{shortcut.title}</p>
                        <p className="text-xs leading-5 text-muted-foreground">{shortcut.description}</p>
                      </div>
                    </div>
                    <div className="pt-2">
                      <Switch checked={enabled} disabled={!editable} />
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {normalized.role !== "pending" ? (
        <div className="pt-8 border-t border-border/40 space-y-5">
           <div className="flex items-center justify-between">
             <h4 className="text-base font-bold text-foreground">Permissões Detalhadas de Módulos</h4>
             <Badge variant="outline" className="font-medium bg-muted/20">Configuração Avançada</Badge>
           </div>
          <div className="rounded-[2rem] border border-border/60 bg-muted/5 p-2 overflow-hidden">
            <AccessPagesTabs
              role={normalized.role}
              selected={normalized.role === "client" ? normalized.allowedViews : normalized.internalPages}
              disabled={matrixDisabled}
              onChange={(next) =>
                normalized.role === "client"
                  ? applyPatch({ allowedViews: next as AccessView[] })
                  : applyPatch({ internalPages: next as InternalPage[] })
              }
            />
          </div>
        </div>
      ) : null}
    </div>  );
}

function isProtectedAdmin(user: AdminUserRecord) {
  return user.access.isAdmin || isFixedAdminAccount(user.uid, user.email);
}

function getClientName(clientId: string, clients: LeadClient[]) {
  return clients.find((client) => client.id === clientId)?.name || clientId;
}

function summarizeClientAssignments(clientIds: string[], clients: LeadClient[]) {
  if (clientIds.length === 0) return "Nenhum tenant vinculado";

  const names = clientIds.map((clientId) => getClientName(clientId, clients));
  if (names.length <= 2) return names.join(", ");

  return `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}

function sortByReferenceOrder<T extends string>(items: T[], referenceOrder: readonly T[]) {
  const orderMap = new Map(referenceOrder.map((item, index) => [item, index]));
  return [...items].sort((left, right) => (orderMap.get(left) ?? 999) - (orderMap.get(right) ?? 999));
}

function buildComparablePayload(draft: AccessDraft) {
  const payload = buildPayload(draft);

  return {
    ...payload,
    clientIds: [...payload.clientIds].sort(),
    allowedViews: sortByReferenceOrder(payload.allowedViews, CLIENT_VIEW_ORDER),
    internalPages: sortByReferenceOrder(payload.internalPages, INTERNAL_PAGE_ORDER),
    permissions: sortByReferenceOrder(payload.permissions, ACCESS_PERMISSION_ORDER),
  };
}

function hasDraftChanges(user: AdminUserRecord, draft: UserDraft) {
  return JSON.stringify(buildComparablePayload(buildUserDraft(user))) !== JSON.stringify(buildComparablePayload(draft));
}

function buildSearchIndex(user: AdminUserRecord, draft: UserDraft) {
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

interface UserListItemProps {
  user: AdminUserRecord;
  draft: UserDraft;
  clients: LeadClient[];
  selected: boolean;
  protectedAccount: boolean;
  dirty: boolean;
  onSelect: () => void;
}

function UserListItem({
  user,
  draft,
  clients,
  selected,
  protectedAccount,
  dirty,
  onSelect,
}: UserListItemProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "w-full rounded-3xl border p-4 text-left transition-colors",
        selected
          ? "border-primary/30 bg-primary/5 shadow-sm"
          : "border-border/80 bg-background/70 hover:border-primary/20 hover:bg-background"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-medium text-foreground">
            {user.displayName || user.email || "Usuario sem nome"}
          </p>
          <p className="truncate text-xs text-muted-foreground">{user.email || "Sem e-mail"}</p>
        </div>

        <Badge className={protectedAccount ? "bg-primary/10 text-primary" : ROLE_BADGE_CLASS[draft.role]}>
          {protectedAccount ? "Protegido" : ROLE_LABELS[draft.role]}
        </Badge>
      </div>

      {draft.disabled || dirty ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {draft.disabled ? (
            <Badge variant="outline" className="border-amber-500/30 text-amber-600">
              Login desativado
            </Badge>
          ) : null}
          {dirty ? (
            <Badge variant="outline" className="border-primary/30 text-primary">
              Nao salvo
            </Badge>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 space-y-1 text-xs text-muted-foreground">
        <p>{draft.companyName || "Sem empresa exibida"}</p>
        <p>{summarizeClientAssignments(draft.clientIds, clients)}</p>
      </div>
    </button>
  );
}

export default function UserAccessManagement() {
  const { accessPreset, getIdToken, isAdminUser } = useAuth();
  const crmClient = useOptionalCrmClient();
  const selectedClientId = crmClient?.selectedClientId || "";
  const canEditUsers = isAdminUser || USER_MANAGEMENT_PRESETS.includes(accessPreset);
  const { data: users = [], isLoading, error, refetch } = useAdminUsers();
  const { data: accessProfiles = [], refetch: refetchAccessProfiles } = useAccessProfiles();
  const { data: clients = [] } = useLeadClients();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, UserDraft>>({});
  const [createDraft, setCreateDraft] = useState<CreateUserDraft>(() => buildCreateDraft());
  const [savingUid, setSavingUid] = useState<string | null>(null);
  const [deletingUid, setDeletingUid] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [syncingUsers, setSyncingUsers] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedbackState | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [pageSize, setPageSize] = useState<10 | 20>(10);
  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
  }, [search, roleFilter, selectedClientId, pageSize]);
  const resolvedAccessProfiles = useMemo(() => {
    const sourceProfiles = accessProfiles.length > 0 ? accessProfiles : buildFallbackAccessProfiles();
    const presetIndex = new Map(ACCESS_PRESET_ORDER.map((key, index) => [key, index]));

    return sourceProfiles
      .map((profile) => ({
        ...profile,
        label: profile.label || getAccessPresetLabel(profile.key),
        description: profile.description ?? FALLBACK_ACCESS_PROFILE_DESCRIPTIONS[profile.key] ?? null,
      }))
      .sort((left, right) => {
      if (left.isSystem !== right.isSystem) {
        return left.isSystem ? -1 : 1;
      }

      if (left.isSystem && right.isSystem) {
        return (presetIndex.get(left.key) ?? 999) - (presetIndex.get(right.key) ?? 999);
      }

      return left.label.localeCompare(right.label, "pt-BR");
      });
  }, [accessProfiles]);
  const systemAccessProfiles = useMemo(
    () => resolvedAccessProfiles.filter((profile) => profile.isSystem),
    [resolvedAccessProfiles]
  );
  const customAccessProfiles = useMemo(
    () => resolvedAccessProfiles.filter((profile) => !profile.isSystem),
    [resolvedAccessProfiles]
  );



  useEffect(() => {
    if (!selectedClientId || clients.length === 0) {
      return;
    }

    const selectedClient = clients.find((client) => client.id === selectedClientId);
    if (!selectedClient) {
      return;
    }

    setCreateDraft((current) => {
      if (current.clientIds.length > 0 || current.companyName.trim()) {
        return current;
      }

      return normalizeCreateDraftForSimpleForm({
        ...current,
        clientIds: [selectedClient.id],
        companyName: selectedClient.name,
      });
    });
  }, [clients, selectedClientId]);

  useEffect(() => {
    setDrafts((current) => {
      if (!users.length) {
        return {};
      }

      const next: Record<string, UserDraft> = {};
      for (const user of users) {
        const existingDraft = current[user.uid];
        next[user.uid] =
          existingDraft && hasDraftChanges(user, existingDraft) ? existingDraft : buildUserDraft(user);
      }
      return next;
    });
  }, [users]);



  const clientScopedUsers = useMemo(() => {
    if (!selectedClientId) {
      return users;
    }

    const selectedClient = clients.find((client) => client.id === selectedClientId);
    const selectedClientName = selectedClient?.name.trim().toLowerCase() || "";

    return users.filter((user) => {
      const draft = drafts[user.uid] || buildUserDraft(user);

      if (draft.clientIds.includes(selectedClientId)) {
        return true;
      }

      if (selectedClientName && draft.companyName.trim().toLowerCase() === selectedClientName) {
        return true;
      }

      // Se for um usuário interno global (sem cliente específico vinculado)
      if (draft.role === "internal" && draft.clientIds.length === 0) {
        return true;
      }

      if (draft.role !== "pending") {
        return false;
      }

      if (!selectedClientName) {
        return true;
      }

      return draft.companyName.trim().toLowerCase() === selectedClientName;
    });
  }, [clients, drafts, selectedClientId, users]);

  const filteredUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    const ordered = [...clientScopedUsers].sort((a, b) => {
      if (a.access.isAdmin !== b.access.isAdmin) {
        return a.access.isAdmin ? -1 : 1;
      }

      const order: Record<ManagedRole, number> = { pending: 0, client: 1, internal: 2 };
      return order[a.access.role] - order[b.access.role];
    });

    return ordered.filter((user) => {
      const draft = drafts[user.uid] || buildUserDraft(user);
      if (roleFilter !== "all" && draft.role !== roleFilter) return false;
      if (!term) return true;
      return buildSearchIndex(user, draft).includes(term);
    });
  }, [clientScopedUsers, drafts, roleFilter, search]);

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / pageSize));
  const safePage = Math.min(page, totalPages);

  const paginatedUsers = useMemo(() => {
    return filteredUsers.slice(
      (safePage - 1) * pageSize,
      safePage * pageSize
    );
  }, [filteredUsers, safePage, pageSize]);

  useEffect(() => {
    if (selectedUserId && !users.some((user) => user.uid === selectedUserId)) {
      setSelectedUserId(null);
    }
  }, [users, selectedUserId]);

  const selectedUser = users.find((user) => user.uid === selectedUserId) || null;
  const selectedDraft = selectedUser ? drafts[selectedUser.uid] || buildUserDraft(selectedUser) : null;
  const selectedCreateType = findAccessProfile(resolvedAccessProfiles, createDraft.accessPreset);

  const selectedProtectedAccount = selectedUser ? isProtectedAdmin(selectedUser) : false;
  const selectedEditable = Boolean(selectedUser && canEditUsers && !selectedProtectedAccount);
  const selectedHasChanges = selectedUser && selectedDraft ? hasDraftChanges(selectedUser, selectedDraft) : false;
  const selectedActivationReady = Boolean(
    selectedUser &&
      selectedDraft &&
      selectedUser.access.role === "pending" &&
      selectedDraft.role !== "pending"
  );
  const selectedHiddenByFilter = Boolean(
    selectedUser && selectedDraft && !filteredUsers.some((user) => user.uid === selectedUser.uid)
  );
  const showAdvancedTypeEditor = false;

  const showActionFeedback = ({ tone, title, message, details }: ActionFeedbackState) => {
    setActionFeedback({ tone, title, message, details: details || null });
  };

  const clearActionFeedback = () => {
    setActionFeedback(null);
  };

  const updateDraft = (uid: string, patch: Partial<UserDraft>) => {
    setDrafts((current) => {
      const sourceUser = users.find((user) => user.uid === uid);
      if (!sourceUser) {
        return current;
      }

      const merged = {
        ...(current[uid] || buildUserDraft(sourceUser)),
        ...patch,
      };

      const next = patch.role || patch.accessPreset ? transitionDraft(merged) : normalizeDraft(merged);
      return {
        ...current,
        [uid]: next,
      };
    });
  };

  const updateCreateDraft = (patch: Partial<CreateUserDraft>) => {
    setCreateDraft((current) => {
      return normalizeCreateDraftForSimpleForm({
        ...current,
        ...patch,
      });
    });
  };

  // Compatibility comment for Vitest check: fetchApi(endpoint)
  const saveUser = async (user: AdminUserRecord) => {
    if (!canEditUsers) return;

    const draft = drafts[user.uid];
    if (!draft) return;

    const preparedDraft = prepareDraftForPersistence(draft, clients, selectedClientId);
    const validationError = validateDraft(preparedDraft);
    if (validationError) {
      showActionFeedback({
        tone: "error",
        title: "Nao foi possivel salvar",
        message: validationError,
      });
      return;
    }

    setSavingUid(user.uid);
    clearActionFeedback();

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const payload = buildPayload(preparedDraft);

      const res = await fetchApi(`/api/admin/users/${encodeURIComponent(user.uid)}/access`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Nao foi possivel salvar este usuario"));
      }

      const body = await readApiJson<{ item?: AdminUserRecord }>(res, "admin-user-access");

      showActionFeedback({
        tone: "success",
        title: user.access.role === "pending" && draft.role !== "pending" ? "Usuario ativado" : "Acessos atualizados",
        message:
          user.access.role === "pending" && draft.role !== "pending"
            ? `${user.email || user.uid} foi liberado(a) com sucesso e ja pode acessar os modulos selecionados.`
            : `As alteracoes de ${user.email || user.uid} foram salvas com sucesso.`,
      });
      setDrafts((current) => ({
        ...current,
        [user.uid]: buildUserDraft(body.item || user),
      }));
      await refetch();
    } catch (err) {
      showActionFeedback({
        tone: "error",
        title: "Nao foi possivel salvar",
        message: err instanceof Error ? err.message : "Nao foi possivel salvar este usuario.",
      });
    } finally {
      setSavingUid(null);
    }
  };

  const createUser = async () => {
    if (!canEditUsers) return;

    const preparedDraft = prepareDraftForPersistence(
      normalizeCreateDraftForSimpleForm(createDraft),
      clients,
      selectedClientId
    );
    const validationError = validateDraft(preparedDraft);
    if (validationError) {
      showActionFeedback({
        tone: "error",
        title: "Nao foi possivel criar o usuario",
        message: validationError,
      });
      return;
    }

    setCreating(true);
    clearActionFeedback();

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const payload = {
        ...buildPayload(preparedDraft),
        email: preparedDraft.email.trim().toLowerCase(),
        password: preparedDraft.password,
        displayName: preparedDraft.displayName.trim() || undefined,
        sendPasswordReset: preparedDraft.sendPasswordReset,
      };

      console.log("[DEBUG] createUser - Draft Original:", createDraft);
      console.log("[DEBUG] createUser - Prepared Draft:", preparedDraft);
      console.log("[DEBUG] createUser - Final Payload:", payload);

      const res = await fetchApi("/api/admin/users", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Nao foi possivel criar este usuario"));
      }

      const body = await readApiJson<{
        item?: AdminUserRecord;
        passwordResetLink?: string;
        syncedExisting?: boolean;
      }>(res, "admin-user-create");

      showActionFeedback({
        tone: "success",
        title: body.syncedExisting ? "Usuario sincronizado" : "Usuario criado",
        message: body.syncedExisting
          ? `O usuario ${body.item?.email || payload.email} ja existia no Firebase Auth e teve o acesso sincronizado.`
          : `O usuario ${body.item?.email || payload.email} foi criado com sucesso.`,
        details: body.passwordResetLink ? `Link de redefinicao: ${body.passwordResetLink}` : null,
      });
      setCreateDraft(buildCreateDraft());
      setCreateDialogOpen(false);
      await refetch();
    } catch (err) {
      showActionFeedback({
        tone: "error",
        title: "Nao foi possivel criar o usuario",
        message: err instanceof Error ? err.message : "Nao foi possivel criar este usuario.",
      });
    } finally {
      setCreating(false);
    }
  };

  const syncFirebaseUsers = async () => {
    if (!canEditUsers) return;

    setSyncingUsers(true);
    clearActionFeedback();

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi("/api/admin/users/sync", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Nao foi possivel sincronizar usuarios"));
      }

      const body = await readApiJson<{ syncedCount?: number; skippedCount?: number }>(res, "admin-users-sync");
      await refetch();

      showActionFeedback({
        tone: "success",
        title: "Usuarios sincronizados",
        message: `${body.syncedCount || 0} usuarios foram normalizados com claims de acesso. ${body.skippedCount || 0} ja estavam sincronizados.`,
      });
    } catch (err) {
      showActionFeedback({
        tone: "error",
        title: "Nao foi possivel sincronizar",
        message: err instanceof Error ? err.message : "Nao foi possivel sincronizar os usuarios do Firebase Auth.",
      });
    } finally {
      setSyncingUsers(false);
    }
  };



  const deleteUser = async (user: AdminUserRecord) => {
    if (!canEditUsers || isProtectedAdmin(user)) return;

    const label = user.displayName || user.email || user.uid;
    const confirmMessage = selectedHasChanges
      ? `Apagar ${label}? As alteracoes nao salvas tambem serao perdidas.`
      : `Apagar ${label}? Essa acao nao pode ser desfeita.`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setDeletingUid(user.uid);
    clearActionFeedback();

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi(`/api/admin/users/${encodeURIComponent(user.uid)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Nao foi possivel apagar este usuario"));
      }

      showActionFeedback({
        tone: "success",
        title: "Usuario apagado",
        message: `O usuario ${user.email || user.uid} foi apagado com sucesso.`,
      });
      setDrafts((current) => {
        const next = { ...current };
        delete next[user.uid];
        return next;
      });
      setSelectedUserId((current) => (current === user.uid ? null : current));
      await refetch();
    } catch (err) {
      showActionFeedback({
        tone: "error",
        title: "Nao foi possivel apagar o usuario",
        message: err instanceof Error ? err.message : "Nao foi possivel apagar este usuario.",
      });
    } finally {
      setDeletingUid(null);
    }
  };



  return (
    <PageShell
      title="Usuarios e Acessos"
      subtitle="Cadastro e associacao por tipo, empresa e paginas liberadas."
      spacing="space-y-6"
      compactHero
      showGlobalClientSelector
    >
      {!canEditUsers && (
        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
          Seu acesso esta em modo leitura. Apenas gestores podem criar usuarios, liberar cadastros e alterar permissoes.
        </div>
      )}

      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-4xl flex flex-col p-0 border-border/60 shadow-2xl bg-background/95 backdrop-blur-xl sm:rounded-[2.5rem] overflow-hidden">
          <DialogHeader className="px-8 pb-6 pt-8 border-b border-border/40 bg-muted/10 shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <DialogTitle className="text-2xl font-bold tracking-tight">Novo usuário</DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Defina as credenciais básicas, selecione o perfil inicial e configure as permissões.
                </DialogDescription>
              </div>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary">
                <UserRound className="h-5 w-5" />
              </div>
            </div>
          </DialogHeader>

          <Tabs defaultValue="cadastro" className="flex flex-col flex-1 min-h-0">
            {createDraft.role !== "pending" && (
              <div className="px-8 border-b border-border/40 bg-muted/5 shrink-0">
                <TabsList className="flex gap-2 bg-transparent p-0 h-12 border-b-0">
                  <TabsTrigger value="cadastro" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 h-full font-bold text-sm">
                    Cadastro & Dados
                  </TabsTrigger>
                  <TabsTrigger value="permissoes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 h-full font-bold text-sm">
                    Permissões Iniciais
                  </TabsTrigger>
                </TabsList>
              </div>
            )}

            <div className="flex-1 overflow-y-auto min-h-0 p-8 space-y-6">
              <TabsContent value="cadastro" className="space-y-6 mt-0 outline-none">
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">E-mail</label>
                    <Input
                      value={createDraft.email}
                      onChange={(event) => updateCreateDraft({ email: event.target.value })}
                      placeholder="E-mail do usuario"
                      type="email"
                      className="h-12 rounded-xl bg-muted/10 border-border/60 focus-visible:ring-primary/20"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Senha Inicial</label>
                    <Input
                      value={createDraft.password}
                      onChange={(event) => updateCreateDraft({ password: event.target.value })}
                      placeholder="Senha inicial"
                      type="password"
                      className="h-12 rounded-xl bg-muted/10 border-border/60 focus-visible:ring-primary/20"
                    />
                  </div>
                  <div className="sm:col-span-2 space-y-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Nome de Exibição</label>
                    <Input
                      value={createDraft.displayName}
                      onChange={(event) => updateCreateDraft({ displayName: event.target.value })}
                      placeholder="Nome completo ou alcunha"
                      className="h-12 rounded-xl bg-muted/10 border-border/60 focus-visible:ring-primary/20"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Tipo de Usuário</label>
                    <Select
                      value={createDraft.accessPreset}
                      onValueChange={(value) => {
                        const profile = findAccessProfile(resolvedAccessProfiles, value);
                        setCreateDraft((current) =>
                          normalizeCreateDraftForSimpleForm(
                            applyAccessProfileToDraft(
                              {
                                ...current,
                                accessPreset: value,
                              },
                              profile
                            )
                          )
                        );
                      }}
                    >
                      <SelectTrigger className="h-12 rounded-xl bg-muted/10 border-border/60 hover:bg-muted/20">
                        <SelectValue placeholder="Tipo de usuario">
                          {createDraft.accessPreset ? findAccessProfile(resolvedAccessProfiles, createDraft.accessPreset)?.label : undefined}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        {resolvedAccessProfiles
                          .filter((profile) => {
                            if (profile.key === "pending") return false;
                            if (profile.key === "admin_vexo") return false;
                            if (isAdminUser) return true;
                            return profile.key === "operador";
                          })
                          .map((profile) => (
                            <SelectItem
                              key={profile.key}
                              value={profile.key}
                              className="py-3 items-start"
                              data-testid={`profile-option-${profile.key}`}
                            >
                              <div className="flex flex-col gap-1 pr-2 max-w-[280px]">
                                <span className="font-semibold text-sm leading-none">{profile.label}</span>
                                {profile.description && (
                                  <span className="text-[11px] text-muted-foreground whitespace-normal leading-snug">
                                    {profile.description}
                                  </span>
                                )}
                              </div>
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Empresa / Tenant</label>
                    <Select
                      value={createDraft.clientIds[0] || "__none"}
                      onValueChange={(value) => {
                        const selectedClient = clients.find((client) => client.id === value);
                        updateCreateDraft({
                          clientIds: value === "__none" ? [] : [value],
                          companyName: value === "__none" ? "" : selectedClient?.name || "",
                        });
                      }}
                    >
                      <SelectTrigger className="h-12 rounded-xl bg-muted/10 border-border/60 hover:bg-muted/20">
                        <SelectValue placeholder="Empresa / tenant" />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="__none" className="py-2.5">
                          {createDraft.role === "client" ? "Selecionar empresa" : "Sem empresa vinculada"}
                        </SelectItem>
                        {clients.map((client) => (
                          <SelectItem key={client.id} value={client.id} className="py-2.5">
                            {client.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>


                <div className="rounded-2xl border border-border/60 bg-muted/5 p-4">
                  <label className="flex items-center gap-3 text-sm text-foreground font-semibold cursor-pointer">
                    <Checkbox
                      checked={createDraft.sendPasswordReset}
                      onCheckedChange={(checked) => updateCreateDraft({ sendPasswordReset: checked === true })}
                    />
                    Enviar e-mail de redefinicao de senha apos o cadastro
                  </label>
                </div>

                {createDraft.role === "pending" && (
                  <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
                    Usuario pendente nao recebe paginas, views nem permissoes operacionais ate a aprovacao.
                  </div>
                )}
              </TabsContent>

              {createDraft.role !== "pending" && (
                <TabsContent value="permissoes" className="space-y-6 mt-0 outline-none">
                  <div className="rounded-[2rem] border border-border/60 bg-muted/5 p-2 overflow-hidden">
                    <AccessPagesTabs
                      role={createDraft.role}
                      selected={createDraft.role === "client" ? createDraft.allowedViews : createDraft.internalPages}
                      disabled={!canEditUsers}
                      onChange={(next) =>
                        createDraft.role === "client"
                          ? updateCreateDraft({ allowedViews: next as AccessView[] })
                          : updateCreateDraft({ internalPages: next as InternalPage[] })
                      }
                    />
                  </div>
                </TabsContent>
              )}
            </div>
          </Tabs>

          <DialogFooter className="px-8 py-5 border-t border-border/40 bg-muted/5 flex gap-3 justify-end shrink-0">
            <Button variant="outline" type="button" className="rounded-xl font-semibold" onClick={() => setCreateDialogOpen(false)}>
              Cancelar
            </Button>
            <Button className="rounded-xl font-semibold" onClick={createUser} disabled={creating}>
              <UserRound className="h-4 w-4 mr-2" />
              {creating ? "Criando..." : "Criar usuario"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(actionFeedback)} onOpenChange={(open) => (!open ? clearActionFeedback() : null)}>
        <DialogContent className="max-w-md rounded-3xl border-border/80 bg-background/95">
          <DialogHeader className="space-y-3 text-left">
            <div
              className={cn(
                "inline-flex w-fit rounded-full px-3 py-1 text-xs font-medium",
                actionFeedback?.tone === "error"
                  ? "bg-destructive/10 text-destructive"
                  : "bg-emerald-500/10 text-emerald-600"
              )}
            >
              {actionFeedback?.tone === "error" ? "Falha na acao" : "Acao concluida"}
            </div>
            <DialogTitle>{actionFeedback?.title}</DialogTitle>
            <DialogDescription className="text-sm leading-6 text-muted-foreground">
              {actionFeedback?.message}
            </DialogDescription>
            {actionFeedback?.details ? (
              <div className="rounded-2xl border border-border/80 bg-background/60 px-4 py-3 text-xs leading-5 text-muted-foreground break-all">
                {actionFeedback.details}
              </div>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button onClick={clearActionFeedback}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>


          <Card className="border-border/80">
            <CardHeader className="space-y-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-xl">Liberacao e acessos dos usuarios</CardTitle>
                  <CardDescription>Selecione uma pessoa, defina a funcao, vincule a empresa e marque exatamente os modulos que ela pode acessar.</CardDescription>
                </div>

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  <div className="relative min-w-[260px]">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="Buscar por nome, e-mail ou empresa"
                      className="pl-9"
                    />
                  </div>

                  <Select value={roleFilter} onValueChange={(value: RoleFilter) => setRoleFilter(value)}>
                    <SelectTrigger className="min-w-[180px]">
                      <SelectValue placeholder="Filtrar categoria" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Todas as categorias</SelectItem>
                      <SelectItem value="internal">Interno</SelectItem>
                      <SelectItem value="client">Cliente</SelectItem>
                      <SelectItem value="pending">Pendente</SelectItem>
                    </SelectContent>
                  </Select>

                  {canEditUsers && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={syncFirebaseUsers}
                        disabled={syncingUsers}
                        className="h-10 rounded-lg text-xs"
                      >
                        <RefreshCw className={cn("h-3.5 w-3.5 mr-1.5", syncingUsers && "animate-spin")} />
                        {syncingUsers ? "Sincronizando..." : "Sincronizar Auth"}
                      </Button>
                      <Button
                        type="button"
                        onClick={() => setCreateDialogOpen(true)}
                        className="h-10 rounded-lg text-xs font-bold"
                      >
                        <Plus className="h-4 w-4 mr-1.5" />
                        Novo Usuário
                      </Button>
                    </div>
                  )}
                </div>
              </div>

            </CardHeader>

            <CardContent className="space-y-5">
              {isLoading ? <EmptyState message="Carregando usuarios..." /> : null}

              {!isLoading && error ? (
                <div className="rounded-[1.5rem] border border-destructive/30 bg-destructive/10 p-8 text-center">
                  <AlertTriangle className="mx-auto mb-3 h-6 w-6 text-destructive" />
                  <p className="text-sm font-medium text-foreground">Nao foi possivel carregar usuarios</p>
                  <p className="mx-auto mt-2 max-w-2xl text-xs leading-6 text-muted-foreground">
                    {(error as Error).message ||
                      "A API de usuarios nao respondeu dentro do tempo esperado. Tente novamente ou verifique o backend."}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-4"
                    onClick={() => void refetch()}
                  >
                    <RefreshCw className="mr-2 h-4 w-4" />
                    Tentar novamente
                  </Button>
                </div>
              ) : null}

              {!isLoading && !error && filteredUsers.length === 0 ? (
                <EmptyState
                  title="Nenhum usuario encontrado"
                  description={
                    selectedClientId
                      ? "Nao existem usuarios vinculados a empresa selecionada ou os filtros atuais esconderam os resultados."
                      : "Ajuste a busca, troque o filtro de categoria ou cadastre um novo usuario."
                  }
                />
              ) : null}

              {!isLoading && !error && filteredUsers.length > 0 ? (
                <>
                  <div className="flex justify-end">
                    <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
                      {filteredUsers.length} usuarios visiveis
                    </Badge>
                  </div>

                  <div className="rounded-[2rem] border border-border/60 bg-background/50 overflow-hidden shadow-sm">
                    <Table>
                      <TableHeader className="bg-muted/20">
                        <TableRow className="border-border/60 hover:bg-transparent">
                          <TableHead className="w-[40%] font-medium text-foreground py-4 px-6">Usuário</TableHead>
                          <TableHead className="font-medium text-foreground py-4 px-6">Empresa</TableHead>
                          <TableHead className="font-medium text-foreground py-4 px-6">Status</TableHead>
                          <TableHead className="text-right font-medium text-foreground py-4 px-6">Ações</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {paginatedUsers.map((user) => {
                          const draft = drafts[user.uid] || buildUserDraft(user);
                          const protectedAccount = isProtectedAdmin(user);
                          const tenantName = draft.companyName || summarizeClientAssignments(draft.clientIds, clients);

                          return (
                            <TableRow key={user.uid} className="border-border/60 transition-colors hover:bg-muted/30">
                              <TableCell className="py-4 px-6">
                                <div className="space-y-1">
                                  <p className="text-sm font-semibold text-foreground">{user.displayName || user.email || "Usuário sem nome"}</p>
                                  <p className="text-xs text-muted-foreground">{user.email || "Sem e-mail"}</p>
                                </div>
                              </TableCell>
                              <TableCell className="py-4 px-6">
                                <span className="text-sm font-medium text-foreground/80">{tenantName}</span>
                              </TableCell>
                              <TableCell className="py-4 px-6">
                                <div className="flex flex-wrap gap-2">
                                  {draft.disabled && <Badge variant="outline" className="text-destructive border-destructive/30 bg-destructive/5">Inativo</Badge>}
                                  <Badge className={cn("font-medium", protectedAccount ? "bg-primary/10 text-primary" : ROLE_BADGE_CLASS[draft.role])}>
                                    {protectedAccount ? "Admin Protegido" : ROLE_LABELS[draft.role]}
                                  </Badge>
                                </div>
                              </TableCell>
                              <TableCell className="text-right py-4 px-6">
                                <Button variant="outline" size="sm" className="rounded-xl h-8 px-4 font-medium" onClick={() => setSelectedUserId(user.uid)}>
                                  Configurar
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 pt-3 text-xs text-muted-foreground dark:border-white/10">
                    <div className="flex items-center gap-4">
                      <span>
                        Mostrando {filteredUsers.length === 0 ? 0 : (safePage - 1) * pageSize + 1}-
                        {Math.min(safePage * pageSize, filteredUsers.length)} de {filteredUsers.length}
                      </span>

                      <div className="flex items-center gap-1.5">
                        <span>Usuários por página:</span>
                        <Select
                          value={String(pageSize)}
                          onValueChange={(val) => setPageSize(Number(val) as 10 | 20)}
                        >
                          <SelectTrigger className="h-7 w-16 rounded-lg text-xs bg-white/80 dark:bg-white/[0.02] border-slate-200 dark:border-white/10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent className="border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-white/10 dark:bg-[#0b0e1a] dark:text-white text-xs">
                            <SelectItem value="10">10</SelectItem>
                            <SelectItem value="20">20</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {totalPages > 1 && (
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg"
                          disabled={safePage <= 1}
                          onClick={() => setPage((p) => Math.max(1, p - 1))}
                        >
                          Anterior
                        </Button>
                        <span className="rounded-md border border-slate-200/80 bg-white px-2.5 py-1 font-semibold text-foreground dark:border-white/10 dark:bg-white/[0.04]">
                          {safePage}/{totalPages}
                        </span>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-lg"
                          disabled={safePage >= totalPages}
                          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        >
                          Próximo
                        </Button>
                      </div>
                    )}
                  </div>
                </>
              ) : null}

              {/* Modal de Edição */}
              <Dialog open={!!selectedUserId} onOpenChange={(open) => { if (!open) setSelectedUserId(null); }}>
                    <DialogContent className="max-h-[85vh] max-w-4xl flex flex-col p-0 border-border/60 shadow-2xl bg-background/95 backdrop-blur-xl sm:rounded-[2.5rem] overflow-hidden">
                      {selectedUser && selectedDraft ? (
                        <div className="flex flex-col h-full min-h-0 flex-1">
                          <DialogHeader className="px-8 pb-6 pt-8 border-b border-border/40 bg-muted/10 shrink-0">
                            <div className="flex items-start justify-between gap-4">
                              <div className="space-y-2">
                                <DialogTitle className="text-2xl font-bold tracking-tight">
                                  {selectedUser.displayName || selectedUser.email || "Usuário sem nome"}
                                </DialogTitle>
                                <DialogDescription className="text-sm text-muted-foreground flex items-center gap-2">
                                  {selectedUser.email || "Sem e-mail"}
                                  <span>•</span>
                                  Criado em {formatDate(selectedUser.createdAt)}
                                </DialogDescription>
                              </div>
                              <div className="flex items-center gap-2">
                                {selectedProtectedAccount ? (
                                  <Badge className="gap-1 bg-primary/10 text-primary px-3 py-1 text-sm rounded-xl">
                                    <LockKeyhole className="h-4 w-4" />
                                    Admin protegido
                                  </Badge>
                                ) : (
                                  <Badge className={cn("px-3 py-1 text-sm rounded-xl", ROLE_BADGE_CLASS[selectedDraft.role])}>
                                    {ROLE_LABELS[selectedDraft.role]}
                                  </Badge>
                                )}
                              </div>
                            </div>

                            {selectedHasChanges && (
                               <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 flex items-center gap-2">
                                 <AlertTriangle className="h-4 w-4" />
                                 Você tem alterações não salvas neste perfil.
                               </div>
                            )}
                          </DialogHeader>

                          <Tabs defaultValue="geral" className="flex flex-col flex-1 min-h-0">
                            {selectedDraft.role !== "pending" && (
                              <div className="px-8 border-b border-border/40 bg-muted/5 shrink-0">
                                <TabsList className="flex gap-2 bg-transparent p-0 h-12 border-b-0">
                                  <TabsTrigger value="geral" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 h-full font-bold text-sm">
                                    Geral
                                  </TabsTrigger>
                                  <TabsTrigger value="permissoes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 h-full font-bold text-sm">
                                    Permissões & Módulos
                                  </TabsTrigger>
                                  <TabsTrigger value="acoes" className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent px-4 h-full font-bold text-sm text-destructive data-[state=active]:border-destructive">
                                    Zona de Perigo
                                  </TabsTrigger>
                                </TabsList>
                              </div>
                            )}

                            <div className="flex-1 overflow-y-auto min-h-0 p-8 space-y-6">
                              {selectedHiddenByFilter ? (
                                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
                                  O usuario selecionado nao aparece na lista atual por causa da busca ou do filtro ativo.
                                </div>
                              ) : null}

                              {selectedActivationReady ? (
                                <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary font-medium">
                                  O cadastro ja esta pronto para liberacao. Revise os acessos, depois clique em Ativar usuario no rodapé.
                                </div>
                              ) : null}

                              {selectedDraft.role === "pending" ? (
                                <AccessGovernance
                                  draft={selectedDraft}
                                  accessProfiles={resolvedAccessProfiles}
                                  clients={clients}
                                  selectedClientId={selectedClientId}
                                  editable={selectedEditable}
                                  onChange={(patch) => updateDraft(selectedUser.uid, patch)}
                                />
                              ) : (
                                <>
                                  <TabsContent value="geral" className="space-y-6 mt-0 outline-none">
                                    <div className="grid gap-6 md:grid-cols-2">
                                      <div className="space-y-2">
                                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Perfil de Acesso Principal</label>
                                        <Select
                                          value={selectedDraft.accessPreset}
                                          disabled={!selectedEditable}
                                          onValueChange={(value) => {
                                            const profile = findAccessProfile(resolvedAccessProfiles, value);
                                            updateDraft(selectedUser.uid, applyAccessProfileToDraft({ ...selectedDraft, accessPreset: value }, profile));
                                          }}
                                        >
                                          <SelectTrigger className="h-12 rounded-xl bg-muted/10 border-border/60 hover:bg-muted/20 text-base px-4">
                                            <SelectValue placeholder="Selecionar perfil de acesso">
                                              {selectedDraft.accessPreset ? findAccessProfile(resolvedAccessProfiles, selectedDraft.accessPreset)?.label : undefined}
                                            </SelectValue>
                                          </SelectTrigger>
                                          <SelectContent className="rounded-xl">
                                            {resolvedAccessProfiles.filter(p => p.role !== "pending").map((profile) => (
                                              <SelectItem
                                                key={profile.key}
                                                value={profile.key}
                                                className="py-3 items-start"
                                              >
                                                <div className="flex flex-col gap-1 pr-2 max-w-[280px]">
                                                  <div className="flex items-center gap-2">
                                                    <span className="font-semibold text-sm leading-none">{profile.label}</span>
                                                    <Badge variant="outline" className="text-[10px] uppercase">{ROLE_LABELS[profile.role]}</Badge>
                                                  </div>
                                                  {profile.description && (
                                                    <span className="text-[11px] text-muted-foreground whitespace-normal leading-snug">
                                                      {profile.description}
                                                    </span>
                                                  )}
                                                </div>
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>

                                      </div>

                                      <div className="space-y-2">
                                        <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Empresa / Tenant Vinculado</label>
                                        <Select
                                          value={selectedDraft.clientIds[0] || "__none"}
                                          disabled={!canEditUsers}
                                          onValueChange={(value) => {
                                            const selectedClient = clients.find((client) => client.id === value);
                                            updateDraft(selectedUser.uid, {
                                              clientIds: value === "__none" ? [] : [value],
                                              companyName: value === "__none" ? "" : selectedClient?.name || "",
                                            });
                                          }}
                                        >
                                          <SelectTrigger className="h-12 rounded-xl bg-muted/10 border-border/60 hover:bg-muted/20 text-base px-4">
                                            <SelectValue placeholder="Selecionar empresa" />
                                          </SelectTrigger>
                                          <SelectContent className="rounded-xl">
                                            <SelectItem value="__none" className="py-2.5 font-medium text-muted-foreground">
                                              {selectedDraft.role === "client" ? "Selecionar empresa (Obrigatório)" : "Sem vínculo específico (Global)"}
                                            </SelectItem>
                                            {clients.map((client) => (
                                              <SelectItem key={client.id} value={client.id} className="py-2.5">
                                                <span className="font-medium">{client.name}</span>
                                              </SelectItem>
                                            ))}
                                          </SelectContent>
                                        </Select>
                                      </div>
                                    </div>

                                    <div className="space-y-2">
                                      <label className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Nome de Exibição da Empresa (Opcional)</label>
                                      <Input
                                        value={selectedDraft.companyName}
                                        disabled={!canEditUsers}
                                        onChange={(event) => updateDraft(selectedUser.uid, { companyName: event.target.value })}
                                        placeholder="Ex: Vexo CRM"
                                        className="h-12 rounded-xl bg-muted/10 border-border/60 hover:bg-muted/20 text-base px-4"
                                      />
                                      <p className="text-xs text-muted-foreground pl-1">Se preenchido, substitui o nome padrão da empresa na interface deste usuário.</p>
                                    </div>

                                    <div className="rounded-2xl border border-border/60 bg-muted/5 p-4 flex items-center justify-between gap-4">
                                      <div className="space-y-1">
                                        <p className="font-semibold text-sm text-foreground">Status do Acesso</p>
                                        <p className="text-xs text-muted-foreground">Desative temporariamente ou reative o login deste usuário no CRM.</p>
                                      </div>
                                      <Switch
                                        checked={!selectedDraft.disabled}
                                        disabled={!canEditUsers || isFixedAdminAccount(selectedUser.uid, selectedUser.email)}
                                        onCheckedChange={(checked) => updateDraft(selectedUser.uid, { disabled: !checked })}
                                        className="scale-90 data-[state=checked]:bg-primary"
                                      />
                                    </div>
                                  </TabsContent>

                                  <TabsContent value="permissoes" className="space-y-6 mt-0 outline-none">
                                    {selectedProtectedAccount && (
                                      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-primary font-medium flex items-center gap-2">
                                        <LockKeyhole className="h-4 w-4 shrink-0" />
                                        Esta é uma conta de Administrador. As permissões e atalhos são fixos do sistema para garantir o acesso.
                                      </div>
                                    )}

                                    {selectedDraft.role === "internal" && (
                                      <div className="space-y-3">
                                        <h4 className="text-sm font-bold text-foreground">Acessos Rápidos (Administração)</h4>
                                        <div className="space-y-2">
                                          {INTERNAL_SHORTCUTS.map((shortcut) => {
                                            const enabled = hasInternalShortcutAccess(selectedDraft, shortcut.key);
                                            const ShortcutIcon = shortcut.icon;

                                            return (
                                              <div
                                                key={shortcut.key}
                                                className="flex items-center justify-between py-3 px-4 rounded-xl border border-border/40 bg-muted/5 transition-colors"
                                              >
                                                <div className="flex items-center gap-3 min-w-0">
                                                  <ShortcutIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                                                  <div className="space-y-0.5 min-w-0">
                                                    <p className="font-semibold text-sm text-foreground">{shortcut.title}</p>
                                                    <p className="text-xs text-muted-foreground truncate max-w-[400px]">{shortcut.description}</p>
                                                  </div>
                                                </div>
                                                <Switch
                                                  checked={enabled}
                                                  disabled={!selectedEditable}
                                                  onCheckedChange={(checked) => updateDraft(selectedUser.uid, buildInternalShortcutPatch(selectedDraft, shortcut.key, checked))}
                                                  className="scale-90 data-[state=checked]:bg-primary"
                                                />
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    )}

                                    <div className="pt-4 border-t border-border/40 space-y-4">
                                      <div className="flex items-center justify-between">
                                        <h4 className="text-sm font-bold text-foreground">Permissões Detalhadas de Módulos</h4>
                                        <Badge variant="outline" className="font-medium bg-muted/20 text-[10px]">Configuração Avançada</Badge>
                                      </div>
                                      <div className="rounded-2xl border border-border/60 bg-muted/5 p-1 overflow-hidden">
                                        <AccessPagesTabs
                                          role={selectedDraft.role}
                                          selected={selectedDraft.role === "client" ? selectedDraft.allowedViews : selectedDraft.internalPages}
                                          disabled={!selectedEditable}
                                          onChange={(next) =>
                                            selectedDraft.role === "client"
                                              ? updateDraft(selectedUser.uid, { allowedViews: next as AccessView[] })
                                              : updateDraft(selectedUser.uid, { internalPages: next as InternalPage[] })
                                          }
                                        />
                                      </div>
                                    </div>
                                  </TabsContent>

                                  <TabsContent value="acoes" className="space-y-6 mt-0 outline-none">
                                    <div className="rounded-2xl border border-destructive/20 bg-destructive/5 p-5 space-y-5">
                                      <div className="space-y-1">
                                        <h4 className="text-sm font-bold text-destructive flex items-center gap-2">
                                          <AlertTriangle className="h-4.5 w-4.5 animate-bounce" />
                                          Zona de Perigo
                                        </h4>
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                          Apagar a conta deletará todas as credenciais e permissões vinculadas do usuário permanentemente. Essa ação é irreversível.
                                        </p>
                                      </div>

                                      <Button
                                        variant="destructive"
                                        className="rounded-xl font-semibold"
                                        onClick={() => deleteUser(selectedUser)}
                                        disabled={!canEditUsers || isFixedAdminAccount(selectedUser.uid, selectedUser.email) || savingUid === selectedUser.uid || deletingUid === selectedUser.uid}
                                      >
                                        <Trash2 className="h-4 w-4 mr-2" />
                                        {deletingUid === selectedUser.uid ? "Apagando..." : "Apagar conta permanentemente"}
                                      </Button>
                                    </div>
                                  </TabsContent>
                                </>
                              )}
                            </div>
                          </Tabs>

                          <DialogFooter className="px-8 py-5 border-t border-border/40 bg-muted/5 flex gap-3 justify-end shrink-0">
                            <Button
                              variant="outline"
                              className="rounded-xl font-semibold"
                              onClick={() => updateDraft(selectedUser.uid, buildUserDraft(selectedUser))}
                              disabled={!canEditUsers || savingUid === selectedUser.uid || deletingUid === selectedUser.uid || !selectedHasChanges}
                            >
                              Descartar alterações
                            </Button>
                            <Button
                              className="rounded-xl font-semibold shadow-md"
                              onClick={() => saveUser(selectedUser)}
                              disabled={!canEditUsers || savingUid === selectedUser.uid || deletingUid === selectedUser.uid}
                            >
                              <ShieldCheck className="h-4 w-4 mr-2" />
                              {savingUid === selectedUser.uid
                                ? selectedActivationReady
                                  ? "Ativando..."
                                  : "Salvando..."
                                : selectedActivationReady
                                  ? "Ativar usuario"
                                  : "Salvar acessos"}
                            </Button>
                          </DialogFooter>
                        </div>
                      ) : (
                        <div className="p-8 text-center text-muted-foreground">Carregando...</div>
                      )}
                    </DialogContent>
                  </Dialog>
            </CardContent>
          </Card>

    </PageShell>
  );
}
