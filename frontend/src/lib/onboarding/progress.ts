import type { LeadClient } from "@/hooks/useLeadClients";

export interface OnboardingStep {
  id: "chip" | "agente" | "leads";
  title: string;
  description: string;
  done: boolean;
  route: string;
  ctaLabel: string;
}

export interface OnboardingProgress {
  steps: OnboardingStep[];
  completedCount: number;
  totalSteps: 3;
  percent: number;
  isFullyReady: boolean;
  isLoading: boolean;
}

/**
 * Avalia de forma pura o progresso dos 3 marcos de implantação da empresa:
 * 1. WhatsApp Conectado (pelo menos 1 instância Evolution ativa)
 * 2. Agente IA Comercial Configurado (chatbot_enabled ativo)
 * 3. Base de Leads Importada (baseTotal > 0)
 */
export function computeOnboardingProgress(
  client?: LeadClient | null,
  baseTotal?: number | null,
  isLoading = false
): OnboardingProgress {
  // Passo 1: Conectar Chip
  const rawInstances =
    client?.n8n_settings?.evolution_instances ??
    (client as any)?.evolution_instances;
  const instances = Array.isArray(rawInstances) ? rawInstances : [];
  const hasConnectedChip =
    instances.length > 0 &&
    instances.some((inst: any) => inst.active !== false);

  // Passo 2: Configurar Agente
  const hasConfiguredAgent = Boolean(
    client?.n8n_settings?.chatbot_enabled === true ||
      (client as any)?.chatbot_enabled === true
  );

  // Passo 3: Ativar Base de Leads
  const hasActiveLeads = typeof baseTotal === "number" && baseTotal > 0;

  const steps: OnboardingStep[] = [
    {
      id: "chip",
      title: "Conectar WhatsApp",
      description: "Conecte seu número de WhatsApp via QR Code para habilitar envios e atendimento.",
      done: hasConnectedChip,
      route: "/crm/chips-whatsapp?tab=conexoes",
      ctaLabel: hasConnectedChip ? "Ver Conexões" : "Conectar WhatsApp",
    },
    {
      id: "agente",
      title: "Configurar Agente IA",
      description: "Defina o comportamento e o tom de voz do Agente de IA Comercial.",
      done: hasConfiguredAgent,
      route: "/crm/agente",
      ctaLabel: hasConfiguredAgent ? "Ajustar Tom de Voz" : "Configurar Agente",
    },
    {
      id: "leads",
      title: "Importar Base de Leads",
      description: "Suba sua base de contatos via planilha para iniciar abordagens e conversões.",
      done: hasActiveLeads,
      route: "/crm/planilhas",
      ctaLabel: hasActiveLeads ? "Ver Base de Leads" : "Importar Leads",
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;
  const totalSteps = 3 as const;
  const percent = Math.round((completedCount / totalSteps) * 100);
  const isFullyReady = completedCount === totalSteps;

  return {
    steps,
    completedCount,
    totalSteps,
    percent,
    isFullyReady,
    isLoading,
  };
}
