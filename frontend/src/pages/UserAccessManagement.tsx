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
} from "@/components/ui/dialog";
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
  leads: "Leads",
  planilhas: "Planilhas",
  whatsapp: "WhatsApp",
  agente: "Agente",
  usuarios: "Usuarios",
  empresas: "Empresas",
  campanhas: "Campanhas",
  "inteligencia-comercial": "Inteligencia Comercial",
  "chatbot-kanban": "Chatbot Kanban",
  "chatbot-config": "Configuracao do Chatbot",
  "fila-de-followup": "Fila de Followup",
  "chatbot-docs": "Chatbot Docs",
  "apresentacao-gd": "Apresentacao GD",
};

const CLIENT_PAGE_TABS = [
  { value: "portal", label: "Portal", items: ["dashboard", "leads", "planilhas"] as AccessView[] },
  { value: "comunicacao", label: "Comunicacao", items: ["whatsapp"] as AccessView[] },
];

const INTERNAL_PAGE_TABS = [
  { value: "operacao", label: "Operacao", items: ["dashboard", "leads", "planilhas", "whatsapp"] as InternalPage[] },
  { value: "gestao", label: "Gestao", items: ["agente", "usuarios", "empresas", "campanhas"] as InternalPage[] },
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
  admin_vexo: "Acesso total ao CRM. Reservado aos administradores da Vexo.",
  gestor: "Libera usuarios, organiza empresas e conduz a operacao do CRM.",
  operador: "Operacao padrao do CRM vinculada a um tenant.",
  parceiro: "Acompanha a operacao com leitura e conversa limitada no ambiente do cliente.",
  client_manager: "Tipo de cliente com acesso expandido ao portal.",
  client_operator: "Tipo de cliente operacional para uso diario.",
  client_viewer: "Tipo de cliente com acesso de leitura.",
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
    companyName: normalized.companyName.trim() || undefined,
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
    <div className="rounded-3xl border border-border/80 bg-background/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="text-xs leading-5 text-muted-foreground">{description}</p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant="outline" className="border-primary/20 bg-primary/5 text-primary">
            {selected.length} selecionados
          </Badge>

          {onSelectAll ? (
            <Button type="button" size="sm" variant="ghost" disabled={disabled || items.length === 0} onClick={onSelectAll}>
              Todos
            </Button>
          ) : null}

          {onClear ? (
            <Button type="button" size="sm" variant="ghost" disabled={disabled || selected.length === 0} onClick={onClear}>
              Limpar
            </Button>
          ) : null}
        </div>
      </div>

      {items.length > 6 ? (
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={searchPlaceholder || "Filtrar itens"}
            className="pl-9"
          />
        </div>
      ) : null}

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{emptyMessage}</p>
      ) : filteredItems.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">Nenhum item corresponde ao filtro informado.</p>
      ) : (
        <ScrollArea className="mt-4 max-h-56 pr-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {filteredItems.map((item) => (
              <label
                key={item}
                className={cn(
                  "flex items-start gap-3 rounded-2xl border px-3 py-3 text-sm transition-colors",
                  selected.includes(item) ? "border-primary/30 bg-primary/5" : "border-border/70 bg-background/70",
                  disabled ? "opacity-70" : "hover:border-primary/30 hover:bg-primary/5"
                )}
              >
                <Checkbox
                  checked={selected.includes(item)}
                  disabled={disabled}
                  onCheckedChange={(checked) => onToggle(item, checked === true)}
                />
                <span className="space-y-1">
                  <span className="block font-medium text-foreground">{renderLabel(item)}</span>
                  {renderHint?.(item) ? (
                    <span className="block text-xs text-muted-foreground">{renderHint(item)}</span>
                  ) : null}
                </span>
              </label>
            ))}
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
  const tabs = useMemo(
    () => (role === "client" ? CLIENT_PAGE_TABS : INTERNAL_PAGE_TABS),
    [role]
  );
  const referenceOrder = role === "client" ? CLIENT_VIEW_ORDER : INTERNAL_PAGE_ORDER;
  const [activeTab, setActiveTab] = useState(tabs[0].value);

  useEffect(() => {
    setActiveTab(tabs[0].value);
  }, [tabs]);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
      <TabsList className="grid w-full grid-cols-2">
        {tabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>

      {tabs.map((tab) => (
        <TabsContent key={tab.value} value={tab.value} className="mt-0">
          <ChecklistPanel
            title={role === "client" ? "Paginas do cliente" : "Paginas internas"}
            description={
              role === "client"
                ? "Escolha apenas as paginas que o cliente vai enxergar no portal."
                : "Escolha apenas os modulos que esse usuario vai acessar no CRM."
            }
            items={tab.items}
            selected={selected}
            disabled={disabled}
            emptyMessage="Nenhuma pagina disponivel."
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
                if (item === "whatsapp") return "Inbox e conversa do cliente";
                if (item === "planilhas") return "Importacao e historico";
                if (item === "dashboard") return "Dashboard e indicadores liberados para o cliente";
                return "Pagina visivel no portal";
              }

              if (item === "dashboard") return "Dashboard geral e analise da Inteligencia Comercial";
              if (item === "usuarios") return "Governanca de acessos";
              if (item === "agente") return "Alertas e monitoramento";
              if (item === "campanhas") return "Permite criar, agendar e disparar campanhas";
              if (item === "planilhas") return "Importacao de base, historico e operacao da area Campanhas";
              if (item === "empresas") return "Gestao das empresas e vinculacoes do CRM";
              return "Modulo do CRM";
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
          {normalized.role !== "pending" ? (
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
            role={normalized.role === "pending" ? "internal" : normalized.role}
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
            disabled={!editable || normalized.role === "pending"}
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
    <div className="space-y-5">
      <div className="rounded-3xl border border-border/80 bg-background/60 p-5">
        <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Tipo de usuario</p>
            <Select
              value={normalized.accessPreset}
              disabled={!editable}
              onValueChange={(value) => {
                const profile = findAccessProfile(accessProfiles, value);
                onChange(
                  applyAccessProfileToDraft(
                    {
                      ...normalized,
                      accessPreset: value,
                    },
                    profile
                  )
                );
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Selecionar tipo" />
              </SelectTrigger>
              <SelectContent>
                {accessProfiles.map((profile) => (
                  <SelectItem key={profile.key} value={profile.key}>
                    {profile.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Empresa / tenant</p>
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
              <SelectTrigger>
                <SelectValue placeholder="Selecionar empresa" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none">
                  {normalized.role === "client" ? "Selecionar empresa" : "Sem empresa vinculada"}
                </SelectItem>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Empresa exibida</p>
            <Input
              value={normalized.companyName}
              disabled={!editable}
              onChange={(event) => applyPatch({ companyName: event.target.value })}
              placeholder="Nome exibido da empresa"
            />
          </div>
        </div>

        {selectedType?.description ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground">
            <Badge variant="outline" className="border-border/80 bg-background/60 text-foreground">
              {ROLE_LABELS[selectedType.role]}
            </Badge>
            <span>{selectedType.description}</span>
          </div>
        ) : null}
      </div>

      {normalized.role === "pending" ? (
        <div className="rounded-3xl border border-primary/15 bg-primary/5 p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">Liberar cadastro</p>
              <p className="text-sm text-muted-foreground">
                Escolha como esse usuario vai operar no CRM para liberar modulos como Campanhas e a analise da Inteligencia Comercial.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              {internalApprovalProfile ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!editable}
                  onClick={() => applyApprovalProfile(internalApprovalProfile.key)}
                >
                  Liberar como interno
                </Button>
              ) : null}
              {clientApprovalProfile ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={!editable}
                  onClick={() => applyApprovalProfile(clientApprovalProfile.key)}
                >
                  Liberar como cliente
                </Button>
              ) : null}
            </div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">Tipo para liberacao</p>
              <Select
                value={normalized.accessPreset}
                disabled={!editable}
                onValueChange={applyApprovalProfile}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Selecionar tipo para liberar" />
                </SelectTrigger>
                <SelectContent>
                  {approvalProfiles.map((profile) => (
                    <SelectItem key={profile.key} value={profile.key}>
                      {profile.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
              Usuario pendente nao recebe paginas, views nem permissoes operacionais ate a aprovacao. Ao trocar o tipo, a tela libera a configuracao do que ele pode acessar.
            </div>
          </div>
        </div>
      ) : null}

      {normalized.role === "internal" ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {INTERNAL_SHORTCUTS.map((shortcut) => {
            const enabled = hasInternalShortcutAccess(normalized, shortcut.key);
            const ShortcutIcon = shortcut.icon;

            return (
              <div
                key={shortcut.key}
                className={cn(
                  "rounded-3xl border p-4 transition-colors",
                  enabled ? "border-primary/25 bg-primary/5" : "border-border/80 bg-background/60"
                )}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-primary/15 bg-primary/10 text-primary">
                      <ShortcutIcon className="h-4 w-4" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">{shortcut.title}</p>
                      <p className="text-sm leading-6 text-muted-foreground">{shortcut.description}</p>
                    </div>
                  </div>

                  <Switch
                    checked={enabled}
                    disabled={!editable}
                    onCheckedChange={(checked) => applyPatch(buildInternalShortcutPatch(normalized, shortcut.key, checked))}
                    aria-label={shortcut.title}
                  />
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {normalized.role !== "pending" ? (
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
      ) : null}
    </div>
  );
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
  const [selectedProfileKey, setSelectedProfileKey] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<AccessProfileDraft>(() => buildAccessProfileDraft());
  const [savingProfile, setSavingProfile] = useState(false);
  const [deletingProfile, setDeletingProfile] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<ActionFeedbackState | null>(null);
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

  const canEditUsers = isAdminUser || USER_MANAGEMENT_PRESETS.includes(accessPreset);
  const selectedClientId = crmClient?.selectedClientId || "";

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

  useEffect(() => {
    if (!resolvedAccessProfiles.length) {
      return;
    }

    setSelectedProfileKey((current) => {
      if (current && resolvedAccessProfiles.some((profile) => profile.key === current)) {
        return current;
      }

      return resolvedAccessProfiles[0]?.key || null;
    });
  }, [resolvedAccessProfiles]);

  useEffect(() => {
    if (!selectedProfileKey) {
      return;
    }

    const selectedProfile = findAccessProfile(resolvedAccessProfiles, selectedProfileKey);
    if (selectedProfile) {
      setProfileDraft(buildAccessProfileDraft(selectedProfile));
    }
  }, [resolvedAccessProfiles, selectedProfileKey]);

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

  useEffect(() => {
    if (!clientScopedUsers.length) {
      setSelectedUserId(null);
      return;
    }

    if (selectedUserId && clientScopedUsers.some((user) => user.uid === selectedUserId)) {
      return;
    }

    if (filteredUsers.length > 0) {
      setSelectedUserId(filteredUsers[0].uid);
    }
  }, [clientScopedUsers, filteredUsers, selectedUserId]);

  const selectedUser = clientScopedUsers.find((user) => user.uid === selectedUserId) || null;
  const selectedDraft = selectedUser ? drafts[selectedUser.uid] || buildUserDraft(selectedUser) : null;
  const selectedCreateType = findAccessProfile(resolvedAccessProfiles, createDraft.accessPreset);
  const selectedProfile = selectedProfileKey ? findAccessProfile(resolvedAccessProfiles, selectedProfileKey) : null;
  const selectedProfileAssignedUsers = selectedProfile
    ? users.filter((user) => user.access.accessPreset === selectedProfile.key).length
    : 0;
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

  const saveUser = async (user: AdminUserRecord) => {
    if (!canEditUsers || isProtectedAdmin(user)) return;

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

  const resetNewProfileDraft = () => {
    setSelectedProfileKey("__new__");
    setProfileDraft(buildAccessProfileDraft());
    clearActionFeedback();
  };

  const saveAccessProfile = async () => {
    if (!canEditUsers) return;

    const isNew = selectedProfileKey === "__new__";
    const preparedDraft = normalizeAccessProfileDraft(profileDraft);
    const validationError = validateAccessProfileDraft(preparedDraft, isNew);
    if (validationError) {
      showActionFeedback({
        tone: "error",
        title: "Nao foi possivel salvar o tipo",
        message: validationError,
      });
      return;
    }

    setSavingProfile(true);
    clearActionFeedback();

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const endpoint = isNew
        ? "/api/admin/access-profiles"
        : `/api/admin/access-profiles/${encodeURIComponent(preparedDraft.key)}`;
      const res = await fetchApi(endpoint, {
        method: isNew ? "POST" : "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          key: preparedDraft.key.trim().toLowerCase(),
          label: preparedDraft.label.trim(),
          description: preparedDraft.description.trim() || undefined,
          role: preparedDraft.role,
          scopeMode: preparedDraft.scopeMode,
          approvalLevel: preparedDraft.approvalLevel,
          allowedViews: preparedDraft.allowedViews,
          internalPages: preparedDraft.internalPages,
          permissions: preparedDraft.permissions,
        }),
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Nao foi possivel salvar este tipo de usuario"));
      }

      const body = await readApiJson<{ item?: AccessProfileRecord; sync?: { updatedUsers?: number; skippedUsers?: number } }>(
        res,
        "admin-access-profile-save"
      );

      const savedProfile = body?.item as AccessProfileRecord | undefined;
      const syncMessage =
        body?.sync?.updatedUsers || body?.sync?.skippedUsers
          ? ` ${body.sync.updatedUsers || 0} usuarios atualizados${body.sync.skippedUsers ? `, ${body.sync.skippedUsers} ignorados` : ""}.`
          : "";

      showActionFeedback({
        tone: "success",
        title: isNew ? "Tipo criado" : "Tipo atualizado",
        message: isNew
          ? `O tipo ${savedProfile?.label || preparedDraft.label} foi criado com sucesso.${syncMessage}`
          : `O tipo ${savedProfile?.label || preparedDraft.label} foi atualizado com sucesso.${syncMessage}`,
      });
      await refetchAccessProfiles();
      await refetch();
      setSelectedProfileKey(savedProfile?.key || preparedDraft.key);
    } catch (err) {
      showActionFeedback({
        tone: "error",
        title: "Nao foi possivel salvar o tipo",
        message: err instanceof Error ? err.message : "Nao foi possivel salvar este tipo de usuario.",
      });
    } finally {
      setSavingProfile(false);
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

  const deleteAccessProfile = async () => {
    if (!canEditUsers || !selectedProfile || selectedProfileKey === "__new__") return;

    if (selectedProfile.isLocked) {
      showActionFeedback({
        tone: "error",
        title: "Tipo protegido",
        message: "Este tipo esta protegido e nao pode ser apagado.",
      });
      return;
    }

    const label = selectedProfile.label || selectedProfile.key;
    const confirmMessage =
      selectedProfileAssignedUsers > 0
        ? `Nao da para apagar ${label} agora. Existem ${selectedProfileAssignedUsers} usuarios usando esse tipo.`
        : `Apagar o tipo ${label}? Essa acao nao pode ser desfeita.`;

    if (selectedProfileAssignedUsers > 0) {
      window.alert(confirmMessage);
      return;
    }

    if (!window.confirm(confirmMessage)) {
      return;
    }

    setDeletingProfile(true);
    clearActionFeedback();

    try {
      const token = await getIdToken();
      if (!token) {
        throw new Error("Usuario nao autenticado.");
      }

      const res = await fetchApi(`/api/admin/access-profiles/${encodeURIComponent(selectedProfile.key)}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        throw new Error(await readApiErrorMessage(res, "Nao foi possivel apagar este tipo de usuario"));
      }

      showActionFeedback({
        tone: "success",
        title: "Tipo apagado",
        message: `O tipo ${label} foi apagado com sucesso.`,
      });
      setSelectedProfileKey(null);
      await refetchAccessProfiles();
      await refetch();
    } catch (err) {
      showActionFeedback({
        tone: "error",
        title: "Nao foi possivel apagar o tipo",
        message: err instanceof Error ? err.message : "Nao foi possivel apagar este tipo de usuario.",
      });
    } finally {
      setDeletingProfile(false);
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
              <div className="rounded-2xl border border-border/80 bg-background/60 px-4 py-3 text-xs leading-5 text-muted-foreground">
                {actionFeedback.details}
              </div>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button onClick={clearActionFeedback}>Fechar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="space-y-6">
          <Card className="border-border/80">
            <CardHeader className="space-y-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="space-y-1">
                  <CardTitle className="text-xl">Liberacao e acessos dos usuarios</CardTitle>
                  <CardDescription>Selecione uma pessoa, defina a funcao, vincule a empresa e marque exatamente os modulos que ela pode acessar.</CardDescription>
                </div>

                <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                  {canEditUsers ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={syncFirebaseUsers}
                      disabled={syncingUsers}
                    >
                      <RefreshCw className={cn("h-4 w-4", syncingUsers && "animate-spin")} />
                      {syncingUsers ? "Sincronizando..." : "Sincronizar Auth"}
                    </Button>
                  ) : null}

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

                  <div className="grid gap-5 xl:grid-cols-[340px_1fr]">
                    <div className="space-y-4">
                      <ScrollArea className="h-[720px] pr-3">
                        <div className="space-y-3">
                          {filteredUsers.map((user) => {
                            const draft = drafts[user.uid] || buildUserDraft(user);

                            return (
                              <UserListItem
                                key={user.uid}
                                user={user}
                                draft={draft}
                                clients={clients}
                                protectedAccount={isProtectedAdmin(user)}
                                dirty={hasDraftChanges(user, draft)}
                                selected={selectedUserId === user.uid}
                                onSelect={() => setSelectedUserId(user.uid)}
                              />
                            );
                          })}
                        </div>
                      </ScrollArea>
                    </div>

                    <div>
                      {selectedUser && selectedDraft ? (
                        <Card className="border-border/80 bg-background/70">
                          <CardHeader className="space-y-4">
                            <div className="flex flex-wrap items-start justify-between gap-4">
                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center gap-2">
                                  <CardTitle className="text-xl">
                                    {selectedUser.displayName || selectedUser.email || "Usuario sem nome"}
                                  </CardTitle>
                                  {selectedProtectedAccount ? (
                                    <Badge className="gap-1 bg-primary/10 text-primary">
                                      <LockKeyhole className="h-3.5 w-3.5" />
                                      Admin protegido
                                    </Badge>
                                  ) : (
                                    <Badge className={ROLE_BADGE_CLASS[selectedDraft.role]}>{ROLE_LABELS[selectedDraft.role]}</Badge>
                                  )}
                                  {selectedHasChanges ? (
                                    <Badge variant="outline" className="border-primary/30 text-primary">
                                      Alteracoes nao salvas
                                    </Badge>
                                  ) : null}
                                </div>
                                <CardDescription className="text-sm">
                                  {selectedUser.email || "Sem e-mail"}
                                </CardDescription>
                                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                                  <span>Criado em {formatDate(selectedUser.createdAt)}</span>
                                  <span>Ultimo login {formatDate(selectedUser.lastSignInAt)}</span>
                                </div>
                              </div>

                              <div className="flex flex-wrap justify-end gap-3">
                                <Button
                                  variant="outline"
                                  onClick={() => updateDraft(selectedUser.uid, buildUserDraft(selectedUser))}
                                  disabled={!selectedEditable || savingUid === selectedUser.uid || deletingUid === selectedUser.uid}
                                >
                                  Restaurar
                                </Button>
                                <Button
                                  onClick={() => saveUser(selectedUser)}
                                  disabled={!selectedEditable || savingUid === selectedUser.uid || deletingUid === selectedUser.uid}
                                >
                                  <ShieldCheck className="h-4 w-4" />
                                  {savingUid === selectedUser.uid
                                    ? selectedActivationReady
                                      ? "Ativando..."
                                      : "Salvando..."
                                    : selectedActivationReady
                                      ? "Ativar usuario"
                                      : "Salvar acessos"}
                                </Button>
                                <Button
                                  variant="destructive"
                                  onClick={() => deleteUser(selectedUser)}
                                  disabled={!selectedEditable || savingUid === selectedUser.uid || deletingUid === selectedUser.uid}
                                >
                                  <Trash2 className="h-4 w-4" />
                                  {deletingUid === selectedUser.uid ? "Apagando..." : "Apagar usuario"}
                                </Button>
                              </div>
                            </div>
                          </CardHeader>

                          <CardContent className="space-y-5">
                            {selectedHiddenByFilter ? (
                              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
                                O usuario selecionado nao aparece na lista atual por causa da busca ou do filtro ativo, mas permanece aberto para evitar troca silenciosa de contexto.
                              </div>
                            ) : null}

                            {selectedActivationReady ? (
                              <div className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-primary">
                                O cadastro ja esta pronto para liberacao. Revise os acessos como Campanhas e Dashboard + Inteligencia Comercial, depois clique em <strong>Ativar usuario</strong>.
                              </div>
                            ) : null}

                            <div className="rounded-3xl border border-border/80 bg-background/50 p-4">
                              {selectedProtectedAccount ? (
                                <div className="rounded-2xl border border-primary/20 bg-primary/10 px-4 py-4 text-sm text-primary">
                                  Esta conta esta protegida por allowlist fixa de admin. A tela permanece apenas como leitura para preservar o acesso raiz do ambiente.
                                </div>
                              ) : (
                                <AccessGovernance
                                  draft={selectedDraft}
                                  accessProfiles={resolvedAccessProfiles}
                                  clients={clients}
                                  selectedClientId={selectedClientId}
                                  editable={selectedEditable}
                                  onChange={(patch) => updateDraft(selectedUser.uid, patch)}
                                />
                              )}
                            </div>

                            <label className="flex items-center gap-3 rounded-3xl border border-border/80 bg-background/60 px-4 py-3 text-sm text-muted-foreground">
                              <Checkbox
                                checked={selectedDraft.disabled}
                                disabled={!selectedEditable}
                                onCheckedChange={(checked) => updateDraft(selectedUser.uid, { disabled: checked === true })}
                              />
                              Desativar login deste usuario
                            </label>
                          </CardContent>
                        </Card>
                      ) : (
                        <EmptyState
                          title="Selecione um usuario"
                          description="Escolha um registro na coluna da esquerda para editar suas associacoes."
                        />
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

        {canEditUsers ? (
          <>
            <Card className="border-border/80">
              <CardHeader className="space-y-1">
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Plus className="h-4 w-4 text-primary" />
                  Novo usuario
                </CardTitle>
                <CardDescription>Defina os dados basicos, escolha o tipo, vincule a empresa e ajuste as paginas.</CardDescription>
              </CardHeader>

              <CardContent className="space-y-5">
                <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-5">
                  <Input
                    value={createDraft.email}
                    onChange={(event) => updateCreateDraft({ email: event.target.value })}
                    placeholder="E-mail do usuario"
                    type="email"
                  />
                  <Input
                    value={createDraft.password}
                    onChange={(event) => updateCreateDraft({ password: event.target.value })}
                    placeholder="Senha inicial"
                    type="password"
                  />
                  <Input
                    value={createDraft.displayName}
                    onChange={(event) => updateCreateDraft({ displayName: event.target.value })}
                    placeholder="Nome de exibicao"
                  />
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
                    <SelectTrigger>
                      <SelectValue placeholder="Tipo de usuario" />
                    </SelectTrigger>
                    <SelectContent>
                      {resolvedAccessProfiles
                        .filter((profile) => {
                          if (profile.key === "pending" || profile.role !== "internal") return false;
                          if (profile.key === "admin_vexo") return false;
                          if (isAdminUser) return true;
                          return profile.key === "operador";
                        })
                        .map((profile) => (
                          <SelectItem key={profile.key} value={profile.key}>
                            {profile.label}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
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
                    <SelectTrigger>
                      <SelectValue placeholder="Empresa / tenant" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">
                        {createDraft.role === "client" ? "Selecionar empresa" : "Sem empresa vinculada"}
                      </SelectItem>
                      {clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                        {client.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                </div>

                {selectedCreateType ? (
                  <div className="flex flex-wrap items-center gap-2 text-xs leading-5 text-muted-foreground">
                    <Badge variant="outline" className={cn("border-border/80 bg-background/60", ROLE_BADGE_CLASS[selectedCreateType.role])}>
                      {ROLE_LABELS[selectedCreateType.role]}
                    </Badge>
                    {selectedCreateType.description ? <span>{selectedCreateType.description}</span> : null}
                  </div>
                ) : null}

                <label className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Checkbox
                    checked={createDraft.sendPasswordReset}
                    onCheckedChange={(checked) => updateCreateDraft({ sendPasswordReset: checked === true })}
                  />
                  Enviar e-mail de redefinicao de senha apos o cadastro
                </label>

                {createDraft.role === "pending" ? (
                  <div className="rounded-3xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
                    Usuario pendente nao recebe paginas, views nem permissoes operacionais ate a aprovacao.
                  </div>
                ) : (
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
                )}

                <div className="flex justify-end">
                  <Button onClick={createUser} disabled={creating}>
                    <UserRound className="h-4 w-4" />
                    {creating ? "Criando..." : "Criar usuario"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {showAdvancedTypeEditor ? (
            <Card className="border-border/80">
                <CardHeader className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <CardTitle className="text-xl">Tipos de usuario</CardTitle>
                      <CardDescription>Ajuste os tipos padrao sem sair da tela de usuarios. Esta area e opcional e fica abaixo do fluxo principal para manter a operacao mais enxuta.</CardDescription>
                    </div>

                  <Button variant="outline" onClick={resetNewProfileDraft}>
                      <Plus className="h-4 w-4" />
                      Novo tipo
                  </Button>
                </div>
              </CardHeader>

                <CardContent className="space-y-5">
                  <div className="space-y-5">
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">Tipos padrao</p>
                          <p className="text-xs text-muted-foreground">Modelos base do sistema para interno, cliente e pendente.</p>
                        </div>
                        <Badge variant="outline">{systemAccessProfiles.length}</Badge>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                        {systemAccessProfiles.map((profile) => {
                          const assignedUsers = users.filter((user) => user.access.accessPreset === profile.key).length;
                          const selected = selectedProfileKey === profile.key;

                          return (
                            <button
                              key={profile.key}
                              type="button"
                              onClick={() => {
                                setSelectedProfileKey(profile.key);
                                clearActionFeedback();
                              }}
                              className={cn(
                                "w-full rounded-2xl border p-3 text-left transition-colors",
                                selected
                                  ? "border-primary/30 bg-primary/5 shadow-sm"
                                  : "border-border/80 bg-background/70 hover:border-primary/20 hover:bg-background"
                              )}
                            >
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="space-y-1">
                                  <p className="text-sm font-medium text-foreground">{profile.label}</p>
                                  <p className="text-xs text-muted-foreground">{profile.key}</p>
                                </div>
                                <Badge className={ROLE_BADGE_CLASS[profile.role]}>{ROLE_LABELS[profile.role]}</Badge>
                              </div>

                              <div className="mt-2 flex flex-wrap gap-2">
                                {profile.isLocked ? (
                                  <Badge variant="outline" className="border-primary/30 text-primary">
                                    Protegido
                                  </Badge>
                                ) : null}
                                <Badge variant="outline">{assignedUsers} usuarios</Badge>
                              </div>

                              {profile.description ? (
                                <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{profile.description}</p>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">Tipos customizados</p>
                          <p className="text-xs text-muted-foreground">Tipos criados pela operacao para casos especificos.</p>
                        </div>
                        <Badge variant="outline">{customAccessProfiles.length}</Badge>
                      </div>

                      {customAccessProfiles.length > 0 ? (
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          {customAccessProfiles.map((profile) => {
                            const assignedUsers = users.filter((user) => user.access.accessPreset === profile.key).length;
                            const selected = selectedProfileKey === profile.key;

                            return (
                              <button
                                key={profile.key}
                                type="button"
                                onClick={() => {
                                  setSelectedProfileKey(profile.key);
                                  clearActionFeedback();
                                }}
                                className={cn(
                                  "w-full rounded-2xl border p-3 text-left transition-colors",
                                  selected
                                    ? "border-primary/30 bg-primary/5 shadow-sm"
                                    : "border-border/80 bg-background/70 hover:border-primary/20 hover:bg-background"
                                )}
                              >
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div className="space-y-1">
                                    <p className="text-sm font-medium text-foreground">{profile.label}</p>
                                    <p className="text-xs text-muted-foreground">{profile.key}</p>
                                  </div>
                                  <Badge className={ROLE_BADGE_CLASS[profile.role]}>{ROLE_LABELS[profile.role]}</Badge>
                                </div>

                                <div className="mt-2 flex flex-wrap gap-2">
                                  <Badge variant="outline">{assignedUsers} usuarios</Badge>
                                </div>

                                {profile.description ? (
                                  <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{profile.description}</p>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-dashed border-border/80 bg-background/50 px-4 py-4 text-sm text-muted-foreground">
                          Nenhum tipo customizado criado ainda.
                        </div>
                      )}
                    </div>
                  </div>

                  <Card className="border-border/80 bg-background/70">
                    <CardHeader className="space-y-1">
                      <CardTitle className="text-xl">
                        {selectedProfileKey === "__new__"
                          ? "Novo tipo"
                          : getAccessPresetLabel(selectedProfileKey)}
                      </CardTitle>
                      <CardDescription>
                        {selectedProfileKey === "__new__"
                          ? "Monte um novo tipo com paginas e permissoes padrao."
                          : "Editar este tipo atualiza os usuarios vinculados a ele."}
                      </CardDescription>
                    </CardHeader>

                    <CardContent className="space-y-5">
                      <AccessProfileForm
                        draft={profileDraft}
                        isNew={selectedProfileKey === "__new__"}
                        editable={!savingProfile && (selectedProfileKey === "__new__" || !findAccessProfile(resolvedAccessProfiles, selectedProfileKey)?.isLocked)}
                        onChange={setProfileDraft}
                      />

                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="text-xs text-muted-foreground">
                          {selectedProfile && selectedProfileKey !== "__new__" ? (
                            selectedProfile.isLocked ? (
                              "Este tipo e protegido pelo sistema."
                            ) : selectedProfileAssignedUsers > 0 ? (
                              `${selectedProfileAssignedUsers} usuarios ainda usam este tipo.`
                            ) : (
                              "Tipo pronto para edicao ou exclusao."
                            )
                          ) : (
                            "Crie um novo tipo customizado para regras especificas."
                          )}
                        </div>

                        <div className="flex justify-end gap-3">
                          {selectedProfileKey !== "__new__" ? (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={deleteAccessProfile}
                              disabled={
                                deletingProfile ||
                                savingProfile ||
                                !selectedProfile ||
                                selectedProfile.isLocked ||
                                selectedProfileAssignedUsers > 0
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                              {deletingProfile ? "Apagando tipo..." : "Apagar tipo"}
                            </Button>
                          ) : null}

                        <Button
                          onClick={saveAccessProfile}
                          disabled={
                            savingProfile ||
                            deletingProfile ||
                            !selectedProfileKey ||
                            (selectedProfileKey !== "__new__" && Boolean(findAccessProfile(resolvedAccessProfiles, selectedProfileKey)?.isLocked))
                          }
                        >
                          <ShieldCheck className="h-4 w-4" />
                          {savingProfile ? "Salvando tipo..." : "Salvar tipo"}
                        </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </CardContent>
              </Card>
            ) : null}
          </>
        ) : null}
      </div>
    </PageShell>
  );
}
