export type PlanTier = "essencial" | "avancado" | "modular";

export const FEATURE_TIERS = {
  essencial: {
    name: "Plano Essencial",
    badge: "🟢 Base",
    description: "Operação comercial completa com 1 conexão de chip, IA de atendimento e disparos.",
    features: [
      "Dashboard comercial e KPIs em tempo real",
      "Banco de Dados Inteligente",
      "Conversas (Inbox WhatsApp centralizado)",
      "Disparos por Planilha com cadência segura",
      "IA de Atendimento Inbound (1 Conexão de Chip)",
      "Follow-up (2 cadências manuais por oportunidade)",
      "Treinamento Vexo (Academy com trilha prática)",
    ],
  },
  avancado: {
    name: "Plano Avançado",
    badge: "🟣 Completo",
    description: "Automação avançada com múltiplos chips, Base RAG, SDR Broadcast e Follow-up por evento.",
    features: [
      "Todos os recursos do Plano Essencial",
      "Base de Conhecimento RAG com upload de PDFs e catálogos (agente_rag)",
      "Automações por Evento no Follow-up (followup_automations)",
      "Alertas SDR Broadcast para múltiplos atendentes (sdr_broadcast)",
      "Conexão de Chips WhatsApp adicionais / ilimitados (multiplos_chips)",
      "Atribuição e Análise de Origem de Leads (origem_leads)",
    ],
  },
  modular: {
    name: "Plano Modular / Avulso",
    badge: "🧩 Modular",
    description: "Contratação flexível com ferramentas e módulos de software ativados sob demanda.",
    features: [
      "Recursos essenciais sob medida",
      "Módulos avulsos contratados e liberados individualmente",
      "Herança automática de permissões e controle granular",
      "Treinamento Vexo (Academy) liberado por módulo ativo",
    ],
  },
} as const;

export interface CustomModuleDefinition {
  id: string;
  featureKey: string;
  label: string;
  desc: string;
  pages?: readonly string[];
}

export const AVAILABLE_CUSTOM_MODULES: readonly CustomModuleDefinition[] = [
  { id: "disparador_campanhas", featureKey: "disparador_campanhas", label: "Campanhas & Disparos", desc: "Disparos automáticos e importação de planilhas de leads", pages: ["campanhas", "planilhas", "disparos"] },
  { id: "agente_inbound", featureKey: "agente_inbound", label: "Agente IA Inbound", desc: "Atendimento inteligente e qualificação automática 24/7", pages: ["agente", "chatbot-kanban", "chatbot-config", "inbound-agents"] },
  { id: "agente_rag", featureKey: "agente_rag", label: "Base de Conhecimento RAG", desc: "Upload de arquivos, PDFs e documentos de treino para IA", pages: ["chatbot-docs", "agente"] },
  { id: "followup", featureKey: "followup", label: "Follow-up & Cadências", desc: "Fila de follow-up e sugestões de recontato comercial", pages: ["followup", "fila-de-followup", "followup-sugestoes"] },
  { id: "followup_automations", featureKey: "followup_automations", label: "Automações de Follow-up", desc: "Disparos automáticos e cadências pós-atendimento", pages: ["followup", "fila-de-followup", "followup-empresas", "followup-campanhas", "followup-analytics"] },
  { id: "sdr_broadcast", featureKey: "sdr_broadcast", label: "Alertas SDR Broadcast", desc: "Distribuição automática de leads quentes para consultores", pages: ["conversas"] },
  { id: "multiplos_chips", featureKey: "multiplos_chips", label: "Múltiplos Chips WhatsApp", desc: "Conexões extras de WhatsApp para múltiplos números", pages: ["conexoes", "aquecimento"] },
  { id: "origem_leads", featureKey: "origem_leads", label: "Rastreamento de Origens", desc: "Atribuição precisa do canal de aquisição (Instagram/Google/TikTok)", pages: ["inteligencia-comercial"] },
  { id: "antiban_groq", featureKey: "antiban_groq", label: "Variações Antiban Groq", desc: "Reescrita dinâmica de mensagens em tempo real para evitar bloqueios", pages: ["campanhas", "disparos"] },
  { id: "relatorios", featureKey: "relatorios", label: "Relatórios & Inteligência", desc: "Métricas avançadas de disparos e performance operacional", pages: ["inteligencia-comercial"] },
  { id: "banco-de-dados", featureKey: "banco-de-dados", label: "Banco de Dados Inteligente", desc: "Base de leads própria: importação, extração do WhatsApp, exportação e edição em massa", pages: ["banco-de-dados"] },
] as const;

export const AVAILABLE_MODULAR_FEATURES = AVAILABLE_CUSTOM_MODULES;

export function resolveTenantPlan(client?: any): PlanTier {
  if (!client) return "essencial";
  const rawTier = String(
    client.plan_tier ||
    client.planTier ||
    client.n8n_settings?.plan_tier ||
    client.n8n_settings?.planTier ||
    client.plan_type ||
    client.planType ||
    client.n8n_settings?.plan_type ||
    client.n8n_settings?.planType ||
    (client.model_type === "avancado" || client.modelType === "avancado" ? "avancado" : "") ||
    client.model_type ||
    client.modelType ||
    client.n8n_settings?.model_type ||
    client.n8n_settings?.modelType ||
    ""
  ).toLowerCase().trim();

  if (rawTier.includes("avancad") || rawTier.includes("advanced") || rawTier.includes("pro") || rawTier === "avancado") {
    return "avancado";
  }
  if (
    rawTier.includes("modular") ||
    rawTier.includes("avulso") ||
    rawTier.includes("custom") ||
    rawTier === "modular" ||
    (Array.isArray(client.modulos_avulsos) && client.modulos_avulsos.length > 0 && rawTier === "modular") ||
    (Array.isArray(client.n8n_settings?.modulos_avulsos) && client.n8n_settings?.modulos_avulsos.length > 0 && rawTier === "modular")
  ) {
    return "modular";
  }
  return "essencial";
}

export function isDegustacaoExpired(client: any): boolean {
  if (!client) return false;
  const expiraEm =
    client.degustacao_expira_em ||
    client.degustacaoExpiraEm ||
    client.n8n_settings?.degustacao_expira_em ||
    client.n8n_settings?.degustacaoExpiraEm;
  if (!expiraEm) return false;

  const expDate = new Date(expiraEm);
  if (isNaN(expDate.getTime())) return false;
  return expDate.getTime() < Date.now();
}

export function getDegustacaoRemainingDays(client: any): number | null {
  if (!client) return null;
  const expiraEm =
    client.degustacao_expira_em ||
    client.degustacaoExpiraEm ||
    client.n8n_settings?.degustacao_expira_em ||
    client.n8n_settings?.degustacaoExpiraEm;
  if (!expiraEm) return null;

  const expDate = new Date(expiraEm);
  if (isNaN(expDate.getTime())) return null;
  const diffMs = expDate.getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / (1000 * 60 * 60 * 24)));
}

export function hasFeatureUnlocked(client: any, featureKey: string): boolean {
  if (!client) return true;
  const tier = resolveTenantPlan(client);
  if (tier === "avancado") return true;

  // Recursos base universais que sempre estão liberados para todo cliente.
  // "banco_dados"/"banco-de-dados" saíram daqui: viraram módulo vendável avulso.
  // Todo tenant que já enxergava o Banco continua enxergando porque a migration
  // 20260817120000 gravou o módulo como contratado para ele.
  const UNIVERSAL_BASE_FEATURES = new Set([
    "dashboard",
    "conversas",
    "inbox",
    "whatsapp",
    "onboarding",
    "onboarding-wizard",
    "admin",
    "empresas",
    "usuarios",
  ]);
  if (UNIVERSAL_BASE_FEATURES.has(featureKey)) return true;

  const rawModulos =
    client.modulos_avulsos ||
    client.modulosAvulsos ||
    client.n8n_settings?.modulos_avulsos ||
    client.n8n_settings?.modulosAvulsos ||
    client.n8nSettings?.modulos_avulsos ||
    client.n8nSettings?.modulosAvulsos ||
    [];

  const modulosAvulsos: string[] = Array.isArray(rawModulos)
    ? rawModulos
    : typeof rawModulos === "string"
    ? rawModulos.split(",").map((s: string) => s.trim())
    : [];

  const isModuleInList = (list: string[], key: string) => {
    if (!Array.isArray(list) || list.length === 0) return false;
    if (list.includes("all") || list.includes("*")) return true;
    if (list.includes(key)) return true;
    const cleanTarget = key.toLowerCase().replace(/^(mod_|modulo_)/, "").trim();
    return list.some((item: string) => {
      const cleanItem = String(item).toLowerCase().replace(/^(mod_|modulo_)/, "").trim();
      return cleanItem === cleanTarget || cleanItem === key.toLowerCase().trim();
    });
  };

  // Se o plano é Modular/Avulso, APENAS os módulos contratados em modulos_avulsos estão liberados
  if (tier === "modular") {
    if (isModuleInList(modulosAvulsos, featureKey)) return true;

    // Normalização completa de sinônimos / aliases bidirecionais
    const k = featureKey.toLowerCase().trim();

    // 1. Disparos & Campanhas
    if (["campanhas", "planilhas", "disparos", "disparador", "disparador_campanhas"].includes(k)) {
      return (
        isModuleInList(modulosAvulsos, "disparador_campanhas") ||
        isModuleInList(modulosAvulsos, "campanhas") ||
        isModuleInList(modulosAvulsos, "disparos") ||
        isModuleInList(modulosAvulsos, "planilhas")
      );
    }

    // 2. Agente IA (Inbound ou RAG)
    if (["agente", "agente-ia", "agente_inbound", "inbound", "chatbot", "chatbot-kanban", "inbound-agents"].includes(k)) {
      return (
        isModuleInList(modulosAvulsos, "agente_inbound") ||
        isModuleInList(modulosAvulsos, "agente") ||
        isModuleInList(modulosAvulsos, "agente-ia") ||
        isModuleInList(modulosAvulsos, "agente_rag") ||
        isModuleInList(modulosAvulsos, "rag")
      );
    }

    // 3. Base RAG específica
    if (["agente_rag", "rag", "chatbot-docs"].includes(k)) {
      return isModuleInList(modulosAvulsos, "agente_rag") || isModuleInList(modulosAvulsos, "rag");
    }

    // 4. Follow-up & Cadências
    if (["followup", "fila-de-followup"].includes(k)) {
      return (
        isModuleInList(modulosAvulsos, "followup") ||
        isModuleInList(modulosAvulsos, "followup_automations") ||
        isModuleInList(modulosAvulsos, "fila-de-followup")
      );
    }

    // 5. Automações de Follow-up específicas
    if (["followup_automations", "automacoes_followup"].includes(k)) {
      return (
        isModuleInList(modulosAvulsos, "followup_automations") ||
        isModuleInList(modulosAvulsos, "automacoes_followup")
      );
    }

    // 6. SDR Broadcast
    if (["sdr_broadcast", "sdr", "broadcast"].includes(k)) {
      return isModuleInList(modulosAvulsos, "sdr_broadcast") || isModuleInList(modulosAvulsos, "sdr");
    }

    // 7. Chips WhatsApp & Conexões
    if (["conexoes", "multiplos_chips", "chips", "chips-whatsapp", "aquecimento"].includes(k)) {
      return (
        isModuleInList(modulosAvulsos, "multiplos_chips") ||
        isModuleInList(modulosAvulsos, "conexoes") ||
        isModuleInList(modulosAvulsos, "chips-whatsapp") ||
        isModuleInList(modulosAvulsos, "chips")
      );
    }

    // 8. Origem de Leads
    if (["origem_leads", "origens", "rastreamento", "origem"].includes(k)) {
      return (
        isModuleInList(modulosAvulsos, "origem_leads") ||
        isModuleInList(modulosAvulsos, "origens") ||
        isModuleInList(modulosAvulsos, "rastreamento") ||
        isModuleInList(modulosAvulsos, "origem")
      );
    }

    // 9. Antiban Groq
    if (["antiban_groq", "antiban", "groq"].includes(k)) {
      return isModuleInList(modulosAvulsos, "antiban_groq") || isModuleInList(modulosAvulsos, "antiban");
    }

    // 10. Relatórios
    if (["relatorios", "relatorio"].includes(k)) {
      return isModuleInList(modulosAvulsos, "relatorios") || isModuleInList(modulosAvulsos, "relatorio");
    }

    // Comercial Vexo saiu daqui de propósito: não é módulo vendável, é
    // ferramenta interna do dono. Tratá-lo como contratável fazia a tela
    // aparecer com cadeado e sugerir upsell de algo que ninguém compra —
    // e o cadeado era só cosmético, a rota respondia. Agora ele é
    // requiredAdmin no App.tsx e admin-only no backend.

    return false;
  }

  // Se o plano é Essencial (não modular):
  // Módulos avançados requerem degustação ativa ou módulo avulso
  const ADVANCED_ONLY_FEATURES = new Set([
    "agente_rag",
    "followup_automations",
    "sdr_broadcast",
    "multiplos_chips",
    "origem_leads",
    "antiban_groq",
    "agente_campanha",
    "extracao_ilimitada",
  ]);

  if (!ADVANCED_ONLY_FEATURES.has(featureKey)) {
    return true;
  }

  // Se a degustação expirou, módulos em degustação deixam de estar liberados
  if (isDegustacaoExpired(client)) {
    return false;
  }

  // Checar liberação avulsa / degustação ativa
  if (isModuleInList(modulosAvulsos, featureKey)) {
    return true;
  }

  return false;
}

export const isFeatureUnlocked = hasFeatureUnlocked;
