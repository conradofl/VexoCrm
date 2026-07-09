import type { ComponentType } from "react";
import {
  Building2,
  LayoutDashboard,
  Users,
  Bot,
  LineChart,
  Briefcase,
  ShieldCheck,
  FileSpreadsheet,
  MessageCircle,
  BookOpen,
  ListChecks,
  Sparkles,
  Wifi,
  BarChart2,
  Server,
} from "lucide-react";
import { type InternalPage } from "@/lib/access";

export type SidebarItem = {
  key: string;
  label: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  badge?: string;
  page: InternalPage;
};

// ━━ OPERAÇÃO ━━
export const OPERACAO_ITEMS: SidebarItem[] = [
  { key: "dashboard", label: "Dashboard", url: "/crm/dashboard", icon: LayoutDashboard, page: "dashboard" },
  { key: "conversas", label: "Conversas", url: "/crm/whatsapp", icon: MessageCircle, page: "whatsapp" },
  { key: "followup", label: "Follow-up", url: "/crm/followup", icon: ListChecks, page: "fila-de-followup" },
  { key: "campanhas", label: "Campanhas", url: "/crm/campanhas", icon: FileSpreadsheet, page: "planilhas" },
];

// ━━ INTELIGÊNCIA ━━
export const INTELIGENCIA_ITEMS: SidebarItem[] = [
  { key: "inteligencia", label: "Int. Comercial", url: "/crm/inteligencia-comercial", icon: LineChart, page: "inteligencia-comercial" },
  { key: "relatorios", label: "Relatórios", url: "/crm/relatorios", icon: BarChart2, page: "relatorios" },
];

// ━━ AGENTE IA ━━
export const AGENTE_IA_ITEMS: SidebarItem[] = [
  { key: "agente-ia", label: "Agente IA", url: "/crm/agente", icon: Bot, page: "agente" },
];

// ━━ CANAIS ━━
export const CANAIS_ITEMS: SidebarItem[] = [
  { key: "chips-whatsapp", label: "Chips WhatsApp", url: "/crm/chips-whatsapp", icon: Wifi, page: "conexoes" },
];

// ━━ MÓDULOS ━━
export const GERACAO_DIGITAL_ITEMS: SidebarItem[] = [
  { key: "apresentacao-gd", label: "Apresentação GD", url: "/crm/apresentacao-gd", icon: Briefcase, page: "apresentacao-gd" },
  { key: "briefings-gd", label: "Briefings Salvos", url: "/crm/briefings-gd", icon: ListChecks, page: "briefings-gd" },
];

export const LIVPUB_ITEMS: SidebarItem[] = [
  { key: "livpub", label: "Painel LivPub", url: "/crm/livpub", icon: Sparkles, page: "livpub", badge: "LIV" },
];

// ━━ AJUDA & SETUP ━━
export const AJUDA_ITEMS: SidebarItem[] = [
  { key: "onboarding", label: "Treinamento Vexo", url: "/crm/onboarding", icon: ListChecks, page: "onboarding-wizard" },
];

// ━━ ADMIN ━━
export const ADMIN_ITEMS: SidebarItem[] = [
  { key: "admin", label: "Administração", url: "/crm/admin", icon: ShieldCheck, page: "empresas" },
  { key: "apresentacao-vexo", label: "Apresentação Vexo", url: "/crm/apresentacao", icon: Sparkles, page: "apresentacao" },
];

export const COLOR_PRESETS = {
  default: { label: "Padrão", from: "#8b5cf6", to: "#22d3ee", shadow: "rgba(139,92,246,0.3)" },
  emerald: { label: "Esmeralda", from: "#059669", to: "#10b981", shadow: "rgba(5,150,105,0.3)" },
  rose: { label: "Rose", from: "#e11d48", to: "#f43f5e", shadow: "rgba(225,29,72,0.3)" },
  amber: { label: "Âmbar", from: "#d97706", to: "#f59e0b", shadow: "rgba(217,119,6,0.3)" },
  indigo: { label: "Indigo", from: "#4f46e5", to: "#6366f1", shadow: "rgba(79,70,229,0.3)" },
};

export type ColorPreset = (typeof COLOR_PRESETS)[keyof typeof COLOR_PRESETS];
