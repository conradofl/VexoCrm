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
  KanbanSquare,
  BookOpen,
  ListChecks,
  Settings2,
  Sparkles,
  Wifi,
  Calendar,
  Heart,
  Flame,
  BarChart2,
  Server,
} from "lucide-react";
import { type InternalPage } from "@/lib/access";

// ═══════════════════════════════════════════════════════════════════════════════
// ESTRUTURA GRANULAR DE MÓDULOS — Máquina de Vendas vs Máquina de Disparos
//
// Cada ferramenta tem `key` própria para filtro de permissão por pacote.
// PASSO 2 (futuro): substituir o filter abaixo por:
//   ferramentas.filter(f => canAccessInternalPage(f.page) && clienteTemAcesso(f.key))
//
// Para adicionar uma ferramenta: inclua o objeto aqui e o InternalPage em access.ts.
// ═══════════════════════════════════════════════════════════════════════════════

export type Modo = "vendas" | "disparos";

export type Ferramenta = {
  key: string;          // identificador único — usado no Passo 2 para filtro de pacote
  label: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  badge?: string;
  page: InternalPage;   // controla visibilidade via canAccessInternalPage
};

export type Modulo = {
  labelCurto: string;   // exibido no pill do switcher
  labelLongo: string;   // exibido em tooltip/collapsed
  cor: string;          // cor de identidade hex
  ferramentas: Ferramenta[];
};

export const MODULOS: Record<Modo, Modulo> = {
  vendas: {
    labelCurto: "Vendas",
    labelLongo: "Máquina de Vendas",
    cor: "#6366F1", // Electric Indigo — token oficial (tailwind.config.ts:21, index.css:63)
    ferramentas: [
      // PASSO 2: filtrar esta lista por clienteTemAcesso(f.key) antes de renderizar
      { key: "dashboard",      label: "Dashboard",          url: "/crm/dashboard",              icon: LayoutDashboard, page: "dashboard" },
      { key: "leads",          label: "Leads",              url: "/crm/leads",                  icon: Users,           page: "leads",               badge: "CRM" },
      { key: "conversas",      label: "Conversas",          url: "/crm/whatsapp",               icon: MessageCircle,   page: "whatsapp" },
      { key: "inteligencia",   label: "Int. Comercial",     url: "/crm/inteligencia-comercial", icon: LineChart,       page: "inteligencia-comercial" },
      { key: "chatbot-kanban", label: "Chatbot Kanban",     url: "/crm/chatbot",                icon: KanbanSquare,    page: "chatbot-kanban" },
      { key: "followup",       label: "Follow-up",          url: "/crm/followup",               icon: ListChecks,      page: "fila-de-followup" },
      { key: "inbound-agents", label: "Assistentes Inbound", url: "/crm/inbound-agents",         icon: Bot,             page: "agente" },
      { key: "livpub",         label: "Painel LivPub",      url: "/crm/livpub",                 icon: Sparkles,        page: "livpub",              badge: "LIV" },
      { key: "eventos",        label: "Eventos",            url: "/crm/eventos",                icon: Calendar,        page: "eventos" },
      { key: "relacionamento", label: "Relacionamento",     url: "/crm/relacionamento",         icon: Heart,           page: "relacionamento" },
    ],
  },
  disparos: {
    labelCurto: "Disparos",
    labelLongo: "Máquina de Disparos",
    cor: "#ff7a1a", // Laranja marca — demo-liv-pub.html (--accent, botão primário + logo)
    ferramentas: [
      { key: "campanhas",   label: "Envios por Planilha", url: "/crm/planilhas",   icon: FileSpreadsheet, page: "planilhas" },
      { key: "aquecimento", label: "Aquecimento", url: "/crm/aquecimento", icon: Flame,           page: "aquecimento" },
      { key: "relatorios",  label: "Relatórios",  url: "/crm/relatorios",  icon: BarChart2,       page: "relatorios" },
    ],
  },
} satisfies Record<Modo, Modulo>;

// ─── Configurações ─────────────────────────────────────────────────────────────
export const CONFIG_ITEMS = [
  { key: "inbound-agents", label: "Assistentes Inbound", url: "/crm/inbound-agents",   icon: Bot,         page: "agente" as InternalPage },
  { key: "chatbot",        label: "Chatbot Settings",    url: "/crm/chatbot-settings", icon: Settings2,   page: "chatbot-config" as InternalPage },
  { key: "conexoes",       label: "Chips WhatsApp",      url: "/crm/conexoes",         icon: Wifi,        page: "conexoes" as InternalPage },
  { key: "empresas",       label: "Empresas",            url: "/crm/empresas",         icon: Building2,   page: "empresas" as InternalPage },
  { key: "integracoes",    label: "Integrações",         url: "/crm/integracoes",      icon: Server,      page: "empresas" as InternalPage },
  { key: "usuarios",       label: "Usuários",            url: "/crm/usuarios",         icon: ShieldCheck, page: "usuarios" as InternalPage },
];

// ─── Educação & Ajuda ──────────────────────────────────────────────────────────
export const AJUDA_ITEMS = [
  { key: "onboarding",     label: "Treinamento Vexo",    url: "/crm/onboarding",       icon: ListChecks,  page: "onboarding-wizard" as InternalPage },
  { key: "apresentacao",   label: "Demonstração Vexo",   url: "/crm/apresentacao",     icon: Sparkles,    page: "apresentacao" as InternalPage },
  { key: "chatbot-docs",   label: "Chatbot Docs",        url: "/crm/chatbot-docs",     icon: BookOpen,    page: "chatbot-docs" as InternalPage },
];

// ─── Geração Digital ───────────────────────────────────────────────────────────
export const GERACAO_DIGITAL_ITEMS = [
  { key: "apresentacao-gd",label: "Apresentação GD",     url: "/crm/apresentacao-gd",  icon: Briefcase,   page: "apresentacao-gd" as InternalPage },
  { key: "briefings-gd",   label: "Briefings Salvos",    url: "/crm/briefings-gd",     icon: ListChecks,  page: "briefings-gd" as InternalPage },
];

export const COLOR_PRESETS = {
  default: { label: "Padrão", from: "#8b5cf6", to: "#22d3ee", shadow: "rgba(139,92,246,0.3)" },
  emerald: { label: "Esmeralda", from: "#059669", to: "#10b981", shadow: "rgba(5,150,105,0.3)" },
  rose: { label: "Rose", from: "#e11d48", to: "#f43f5e", shadow: "rgba(225,29,72,0.3)" },
  amber: { label: "Âmbar", from: "#d97706", to: "#f59e0b", shadow: "rgba(217,119,6,0.3)" },
  indigo: { label: "Indigo", from: "#4f46e5", to: "#6366f1", shadow: "rgba(79,70,229,0.3)" },
};

export type ColorPreset = (typeof COLOR_PRESETS)[keyof typeof COLOR_PRESETS];
