import type { ComponentType } from "react";
import {
  LayoutDashboard,
  Database,
  AlertTriangle,
  MessageCircle,
  ListChecks,
  FileSpreadsheet,
  CalendarDays,
  Bot,
  Wifi,
  Rocket,
  BookOpen,
  ShieldCheck,
} from "lucide-react";
import type { InternalPage, AccessPermission } from "./access";

export type OperatorModuleId =
  | "dashboard"
  | "banco-de-dados"
  | "leads-parados"
  | "conversas"
  | "followup"
  | "campanhas"
  | "calendario"
  | "agente-ia"
  | "chips-whatsapp"
  | "implantacao"
  | "onboarding"
  | "admin";

export interface OperatorModuleConfig {
  id: OperatorModuleId;
  label: string;
  category: "operacao" | "agente_ia" | "canais" | "ajuda" | "admin";
  url: string;
  icon: ComponentType<{ className?: string }>;
  description: string;
  pages: InternalPage[];
  permissions: AccessPermission[];
}

export const OPERATOR_MODULES: OperatorModuleConfig[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    category: "operacao",
    url: "/crm/dashboard",
    icon: LayoutDashboard,
    description: "Métricas gerais, rankings e indicadores comerciais",
    pages: ["dashboard"],
    permissions: ["dashboard.view"],
  },
  {
    id: "banco-de-dados",
    label: "Banco de Dados",
    category: "operacao",
    url: "/crm/banco-de-dados",
    icon: Database,
    description: "Consulta, filtros e gestão da base de leads",
    pages: ["banco-de-dados"],
    permissions: ["banco_dados.view", "banco_dados.import", "banco_dados.extract_wa", "leads.view"],
  },
  {
    id: "leads-parados",
    label: "Leads Parados",
    category: "operacao",
    url: "/crm/leads-parados",
    icon: AlertTriangle,
    description: "Alerta e reativação de leads estagnados no funil",
    pages: ["leads-parados"],
    permissions: ["leads.view"],
  },
  {
    id: "conversas",
    label: "Conversas",
    category: "operacao",
    url: "/crm/whatsapp",
    icon: MessageCircle,
    description: "Inbox de atendimento via WhatsApp e chat ao vivo",
    pages: ["whatsapp"],
    permissions: ["whatsapp.view", "whatsapp.reply"],
  },
  {
    id: "followup",
    label: "Follow-up",
    category: "operacao",
    url: "/crm/followup",
    icon: ListChecks,
    description: "Fila de cadências e régua de recontato comercial",
    pages: ["followup", "fila-de-followup"],
    permissions: [],
  },
  {
    id: "campanhas",
    label: "Campanhas",
    category: "operacao",
    url: "/crm/campanhas",
    icon: FileSpreadsheet,
    description: "Disparos em massa, importação de planilhas e relatórios",
    pages: ["campanhas", "planilhas", "disparos"],
    permissions: [
      "campaigns.view",
      "campaigns.create",
      "campaigns.manage",
      "dispatches.execute",
      "dispatches.pause",
      "imports.manage",
    ],
  },
  {
    id: "calendario",
    label: "Calendário",
    category: "operacao",
    url: "/crm/calendario",
    icon: CalendarDays,
    description: "Agenda de tarefas, compromissos e reuniões de vendas",
    pages: ["followup"],
    permissions: [],
  },
  {
    id: "agente-ia",
    label: "Agente IA",
    category: "agente_ia",
    url: "/crm/agente",
    icon: Bot,
    description: "Configurações, testes e instruções do agente de IA",
    pages: ["agente"],
    permissions: ["agente.view"],
  },
  {
    id: "chips-whatsapp",
    label: "Chips WhatsApp",
    category: "canais",
    url: "/crm/chips-whatsapp",
    icon: Wifi,
    description: "Status de conexões de WhatsApp e pareamento de QR Code",
    pages: ["conexoes"],
    permissions: ["whatsapp.chips_view", "whatsapp.chips_add"],
  },
  {
    id: "implantacao",
    label: "Implantação (Setup)",
    category: "ajuda",
    url: "/crm/implantacao",
    icon: Rocket,
    description: "Esteira de implantação, simulador técnico e briefings",
    pages: ["onboarding-agent"],
    permissions: [],
  },
  {
    id: "onboarding",
    label: "VE Treinamento Vexo",
    category: "ajuda",
    url: "/crm/onboarding",
    icon: BookOpen,
    description: "Tutoriais em vídeo e capacitação operacional Vexo",
    pages: ["onboarding-wizard"],
    permissions: [],
  },
  {
    id: "admin",
    label: "Administração",
    category: "admin",
    url: "/crm/admin",
    icon: ShieldCheck,
    description: "Gestão da equipe de operadores, usuários e empresas",
    pages: ["usuarios", "empresas"],
    permissions: ["users.view", "users.manage", "tenants.manage"],
  },
];

export const ALL_OPERATOR_MODULE_IDS: OperatorModuleId[] = OPERATOR_MODULES.map((m) => m.id);

export const DEFAULT_OPERATOR_MODULE_IDS: OperatorModuleId[] = [
  "dashboard",
  "banco-de-dados",
  "leads-parados",
  "conversas",
  "followup",
  "campanhas",
  "calendario",
  "agente-ia",
  "chips-whatsapp",
  "onboarding",
];

export function deriveOperatorModulesFromPages(pages: string[] = []): OperatorModuleId[] {
  const pageSet = new Set((pages || []).filter(Boolean));
  const result: OperatorModuleId[] = [];

  if (pageSet.has("dashboard")) result.push("dashboard");
  if (pageSet.has("banco-de-dados")) result.push("banco-de-dados");
  if (pageSet.has("leads-parados")) result.push("leads-parados");
  if (pageSet.has("whatsapp")) result.push("conversas");
  if (pageSet.has("followup") || pageSet.has("fila-de-followup")) {
    result.push("followup");
    result.push("calendario");
  }
  if (pageSet.has("campanhas") || pageSet.has("planilhas") || pageSet.has("disparos")) {
    result.push("campanhas");
  }
  if (pageSet.has("agente")) result.push("agente-ia");
  if (pageSet.has("conexoes")) result.push("chips-whatsapp");
  if (pageSet.has("onboarding-agent")) result.push("implantacao");
  if (pageSet.has("onboarding-wizard")) result.push("onboarding");
  if (pageSet.has("usuarios") || pageSet.has("empresas")) result.push("admin");

  return Array.from(new Set(result));
}

export function derivePagesAndPermissionsFromModules(modules: OperatorModuleId[]): {
  internalPages: InternalPage[];
  permissions: AccessPermission[];
} {
  const selected = new Set(modules);
  const pages: InternalPage[] = [];
  const permissions: AccessPermission[] = [];

  for (const mod of OPERATOR_MODULES) {
    if (selected.has(mod.id)) {
      pages.push(...mod.pages);
      permissions.push(...mod.permissions);
    }
  }

  return {
    internalPages: Array.from(new Set(pages)),
    permissions: Array.from(new Set(permissions)),
  };
}

export function isOperatorModuleAllowed(
  moduleId: OperatorModuleId,
  access: {
    role?: string;
    isAdmin?: boolean;
    accessPreset?: string;
    approvalLevel?: string;
    allowedModules?: string[] | null;
    internalPages?: string[];
  } | null | undefined
): boolean {
  if (!access) return false;
  if (access.isAdmin || access.role === "superadmin") return true;

  // Gestores / diretores têm acesso amplo operacional
  if (access.accessPreset === "gestor" || access.accessPreset === "admin_vexo" || access.approvalLevel === "manager" || access.approvalLevel === "director") {
    return true;
  }

  // Se não for internal (ex.: client), não aplica a trava de operador internal
  if (access.role !== "internal") {
    return true;
  }

  // Operador internal:
  if (Array.isArray(access.allowedModules) && access.allowedModules.length > 0) {
    return access.allowedModules.includes(moduleId);
  }

  // Se allowedModules estiver explicitamente como array vazio, todos bloqueados
  if (Array.isArray(access.allowedModules) && access.allowedModules.length === 0) {
    return false;
  }

  // Fallback baseado nas páginas internas do operador
  const pages = access.internalPages || [];
  switch (moduleId) {
    case "dashboard":
      return pages.includes("dashboard");
    case "banco-de-dados":
      return pages.includes("banco-de-dados");
    case "leads-parados":
      return pages.includes("leads-parados");
    case "conversas":
      return pages.includes("whatsapp");
    case "followup":
      return pages.includes("followup") || pages.includes("fila-de-followup");
    case "campanhas":
      return pages.includes("campanhas") || pages.includes("planilhas") || pages.includes("disparos");
    case "calendario":
      return pages.includes("followup") || pages.includes("campanhas");
    case "agente-ia":
      return pages.includes("agente");
    case "chips-whatsapp":
      return pages.includes("conexoes");
    case "implantacao":
      return pages.includes("onboarding-agent");
    case "onboarding":
      return pages.includes("onboarding-wizard");
    case "admin":
      return pages.includes("usuarios") || pages.includes("empresas");
    default:
      return false;
  }
}

export function getModuleIdFromSidebarItemKey(key: string): OperatorModuleId | null {
  switch (key) {
    case "dashboard":
      return "dashboard";
    case "banco-de-dados":
      return "banco-de-dados";
    case "leads-parados":
      return "leads-parados";
    case "conversas":
      return "conversas";
    case "followup":
      return "followup";
    case "campanhas":
      return "campanhas";
    case "calendario":
      return "calendario";
    case "agente-ia":
    case "agente":
      return "agente-ia";
    case "chips-whatsapp":
    case "conexoes":
      return "chips-whatsapp";
    case "implantacao":
      return "implantacao";
    case "onboarding":
      return "onboarding";
    case "admin":
      return "admin";
    default:
      return null;
  }
}

export function getModuleIdFromPath(pathname: string): OperatorModuleId | null {
  if (pathname.includes("/crm/dashboard")) return "dashboard";
  // "/crm/leads-parados" também contém "/crm/leads": precisa ser conferido ANTES do Banco de Dados.
  if (pathname.includes("/crm/leads-parados")) return "leads-parados";
  if (pathname.includes("/crm/banco-de-dados") || pathname.includes("/crm/leads")) return "banco-de-dados";
  if (pathname.includes("/crm/whatsapp")) return "conversas";
  if (pathname.includes("/crm/followup")) return "followup";
  if (pathname.includes("/crm/campanhas") || pathname.includes("/crm/planilhas")) return "campanhas";
  if (pathname.includes("/crm/calendario") || pathname.includes("/crm/agenda")) return "calendario";
  if (pathname.includes("/crm/agente") || pathname.includes("/crm/chatbot") || pathname.includes("/crm/inbound-agents")) return "agente-ia";
  if (pathname.includes("/crm/chips-whatsapp") || pathname.includes("/crm/conexoes") || pathname.includes("/crm/aquecimento")) return "chips-whatsapp";
  if (pathname.includes("/crm/implantacao") || pathname.includes("/crm/setup")) return "implantacao";
  if (pathname.includes("/crm/onboarding")) return "onboarding";
  if (pathname.includes("/crm/admin") || pathname.includes("/crm/usuarios") || pathname.includes("/crm/empresas")) return "admin";
  return null;
}

