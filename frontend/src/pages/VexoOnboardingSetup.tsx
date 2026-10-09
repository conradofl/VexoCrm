import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Sparkles, Wrench, FolderOpen } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { EmptyState } from "@/components/EmptyState";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { useOnboardingProgress } from "@/hooks/useOnboardingProgress";
import { useAuth } from "@/contexts/AuthContext";
import { SetupCelebration } from "./VexoOnboardingSetup/SetupCelebration";
import { SuperpowersMapTab } from "./VexoOnboardingSetup/SuperpowersMapTab";
import { PracticalPipelineTab } from "./VexoOnboardingSetup/PracticalPipelineTab";
import { SavedImplementationsTab } from "./VexoOnboardingSetup/SavedImplementationsTab";

interface VexoOnboardingSetupProps {
  baseTotal?: number | null;
  defaultTab?: "mapa" | "esteira" | "salvas";
}

export default function VexoOnboardingSetup({
  baseTotal,
  defaultTab,
}: VexoOnboardingSetupProps = {}) {
  const crmClient = useOptionalCrmClient();
  const selectedClient = crmClient?.selectedClient || null;
  const clientId = crmClient?.selectedClientId || "";
  const clientName = selectedClient?.name || clientId || "Sua Empresa";

  const { isAdminUser, canAccessInternalPage } = useAuth();
  const hasTechnicalAccess = Boolean(
    isAdminUser ||
      canAccessInternalPage?.("onboarding-agent") ||
      canAccessInternalPage?.("briefings-gd")
  );

  const progress = useOnboardingProgress(clientId, { baseTotal });

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const resolvedInitialTab: "mapa" | "esteira" | "salvas" = (() => {
    if (!hasTechnicalAccess) return "mapa";
    if (defaultTab && (defaultTab === "mapa" || defaultTab === "esteira" || defaultTab === "salvas")) {
      return defaultTab;
    }
    if (tabParam === "salvas") return "salvas";
    if (tabParam === "esteira" || tabParam === "briefing") return "esteira";
    return "mapa";
  })();

  const [activeTab, setActiveTab] = useState<"mapa" | "esteira" | "salvas">(resolvedInitialTab);

  useEffect(() => {
    if (!hasTechnicalAccess && activeTab !== "mapa") {
      setActiveTab("mapa");
    }
  }, [hasTechnicalAccess, activeTab]);

  const handleTabChange = (val: string) => {
    const nextTab = (hasTechnicalAccess && (val === "esteira" || val === "salvas"))
      ? (val as "esteira" | "salvas")
      : "mapa";
    setActiveTab(nextTab);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", nextTab);
        return next;
      },
      { replace: true }
    );
  };

  if (!clientId) {
    return (
      <PageShell
        title="Implantação Vexo OS"
        subtitle="Acompanhe a ativação da sua máquina comercial inteligente"
      >
        <EmptyState
          title="Selecione uma empresa"
          description="Escolha um cliente no seletor para acompanhar a implantação da sua operação."
        />
      </PageShell>
    );
  }

  // Dados do Passo 1: WhatsApp
  const evolutionInstances =
    selectedClient?.n8n_settings?.evolution_instances ??
    (selectedClient as any)?.evolution_instances ??
    [];
  const connectedInstances = Array.isArray(evolutionInstances)
    ? evolutionInstances.filter((inst: any) => inst.active !== false)
    : [];
  const chipStepDone = progress.steps.find((s) => s.id === "chip")?.done ?? false;

  // Dados do Passo 2: Agente IA
  const chatbotEnabled = Boolean(
    selectedClient?.n8n_settings?.chatbot_enabled === true ||
      (selectedClient as any)?.chatbot_enabled === true
  );
  const chatbotModel =
    selectedClient?.n8n_settings?.chatbot_model ||
    selectedClient?.n8n_settings?.chatbot_llm_model ||
    "Modelo Padrão Vexo";
  const agentStepDone = progress.steps.find((s) => s.id === "agente")?.done ?? false;

  // Dados do Passo 3: Leads
  const leadsStepDone = progress.steps.find((s) => s.id === "leads")?.done ?? false;

  return (
    <PageShell
      title="Implantação Vexo OS"
      subtitle={`${clientName} · Central de Poder e Setup Operacional`}
      spacing="space-y-6"
    >
      {/* Hero com Barra de Progresso Destacada */}
      <div className="rounded-2xl border border-slate-200/80 bg-gradient-to-r from-white via-slate-50 to-indigo-50/20 dark:from-card dark:via-card/80 dark:to-muted/30 p-6 md:p-8 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
          <div className="space-y-1">
            <span className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider">
              Status da Ativação
            </span>
            <h2 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900 dark:text-foreground">
              {progress.isFullyReady
                ? "Operação 100% Configurada e Ativa"
                : "Passos para Colocar sua Operação no Ar"}
            </h2>
            <p className="text-xs md:text-sm text-slate-500 dark:text-muted-foreground">
              {progress.isFullyReady
                ? "Todos os pilares operacionais foram concluídos. Sua empresa está pronta para tracionar."
                : `Você completou ${progress.completedCount} de ${progress.totalSteps} etapas essenciais.`}
            </p>
          </div>

          <div className="flex items-center gap-3 shrink-0 self-start md:self-auto">
            <div className="text-right">
              <span className="text-2xl md:text-3xl font-extrabold text-slate-900 dark:text-foreground">
                {progress.percent}%
              </span>
              <p className="text-[11px] text-slate-500 dark:text-muted-foreground">
                {progress.completedCount} de 3 passos prontos
              </p>
            </div>
          </div>
        </div>

        {/* Barra de Progresso Destacada */}
        <div className="w-full bg-slate-100 dark:bg-muted rounded-full h-3 overflow-hidden p-0.5">
          <div
            className="h-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-emerald-500 rounded-full transition-all duration-700 ease-out"
            style={{ width: `${progress.percent}%` }}
          />
        </div>
      </div>

      {/* Painel Comemorativo quando 100% Concluído */}
      {progress.isFullyReady && <SetupCelebration />}

      {/* Abas Superiores: Se tiver acesso técnico, exibe as 3 abas centralizadas. Caso contrário, exibe direto o Mapa */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full space-y-6">
        {hasTechnicalAccess && (
          <div className="flex justify-center">
            <TabsList className="grid w-full grid-cols-3 max-w-2xl h-11 p-1 bg-slate-100/90 dark:bg-muted/80 rounded-xl border border-slate-200/80 dark:border-border/60 shadow-2xs">
              <TabsTrigger
                value="mapa"
                className="rounded-lg text-xs sm:text-sm font-semibold gap-2 data-[state=active]:bg-white dark:data-[state=active]:bg-card data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400 data-[state=active]:shadow-xs transition-all"
              >
                <Sparkles className="w-4 h-4 text-amber-500" />
                <span className="truncate">🌟 Mapa de Superpoderes</span>
              </TabsTrigger>
              <TabsTrigger
                value="esteira"
                className="rounded-lg text-xs sm:text-sm font-semibold gap-2 data-[state=active]:bg-white dark:data-[state=active]:bg-card data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400 data-[state=active]:shadow-xs transition-all"
              >
                <Wrench className="w-4 h-4 text-indigo-500" />
                <span className="truncate">🛠️ Esteira Técnica & Simulador</span>
              </TabsTrigger>
              <TabsTrigger
                value="salvas"
                className="rounded-lg text-xs sm:text-sm font-semibold gap-2 data-[state=active]:bg-white dark:data-[state=active]:bg-card data-[state=active]:text-indigo-600 dark:data-[state=active]:text-indigo-400 data-[state=active]:shadow-xs transition-all"
              >
                <FolderOpen className="w-4 h-4 text-emerald-500" />
                <span className="truncate">📁 Implantações Salvas</span>
              </TabsTrigger>
            </TabsList>
          </div>
        )}

        {/* ABA 1: Mapa de Superpoderes do Vexo OS */}
        <TabsContent
          value="mapa"
          forceMount
          className="data-[state=inactive]:hidden focus-visible:outline-none"
        >
          <SuperpowersMapTab />
        </TabsContent>

        {/* ABA 2 & 3: Apenas se possuir permissão técnica */}
        {hasTechnicalAccess && (
          <>
            <TabsContent
              value="esteira"
              forceMount
              className="data-[state=inactive]:hidden focus-visible:outline-none"
            >
              <PracticalPipelineTab
                clientId={clientId}
                selectedClient={selectedClient}
                progress={progress}
                connectedInstances={connectedInstances}
                chatbotEnabled={chatbotEnabled}
                chatbotModel={chatbotModel}
                chipStepDone={chipStepDone}
                agentStepDone={agentStepDone}
                leadsStepDone={leadsStepDone}
              />
            </TabsContent>

            <TabsContent
              value="salvas"
              forceMount
              className="data-[state=inactive]:hidden focus-visible:outline-none"
            >
              <SavedImplementationsTab
                clientId={clientId}
                onGoToEsteira={() => handleTabChange("esteira")}
              />
            </TabsContent>
          </>
        )}
      </Tabs>
    </PageShell>
  );
}
