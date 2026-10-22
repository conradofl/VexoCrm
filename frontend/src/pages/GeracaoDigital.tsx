import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Briefcase, ListChecks, Users, Sparkles } from "lucide-react";
import GeracaoDigitalPitch from "./GeracaoDigitalPitch";
import GeracaoDigitalBriefings from "./GeracaoDigitalBriefings";
import ClientPortfolioDashboard from "./GeracaoDigital/ClientPortfolioDashboard";
import BrandIdentityWizard from "./GeracaoDigital/BrandIdentityWizard";
import { useAuth } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageShell, PageShellContext } from "@/components/PageShell";
import { GeracaoDigitalTabs } from "@/components/GeracaoDigitalTabs";
import type { PortfolioClient } from "./GeracaoDigital/components/PortfolioTable";

export default function GeracaoDigital() {
  const { isInternalUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedClientForWizard, setSelectedClientForWizard] = useState<string>("");

  const hasAccess = isInternalUser;

  // Abas disponíveis
  const defaultTab = hasAccess ? "carteira" : "";
  const activeTab = searchParams.get("tab") || defaultTab;

  useEffect(() => {
    if (!searchParams.get("tab") && defaultTab) {
      setSearchParams({ tab: defaultTab });
    }
  }, [defaultTab, searchParams, setSearchParams]);

  const handleTabChange = (val: string) => {
    setSearchParams({ tab: val });
  };

  const handleOpenWizardFromPortfolio = (client?: PortfolioClient) => {
    if (client?.name) {
      setSelectedClientForWizard(client.name);
    }
    setSearchParams({ tab: "identidade" });
  };

  const handleOpenBriefingFromPortfolio = () => {
    setSearchParams({ tab: "apresentacao" });
  };

  if (!defaultTab) {
    return (
      <PageShell title="Geração Digital" subtitle="Módulo específico de inteligência e automação para Geração Digital">
        <GeracaoDigitalTabs />
        <div className="p-8 text-center text-muted-foreground">
          Você não possui permissão para acessar o módulo Geração Digital.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Geração Digital" subtitle="Cockpit executivo da carteira, hub de briefing e esteira de identidade visual">
      <PageShellContext.Provider value={true}>
        <div className="w-full space-y-6">
          <GeracaoDigitalTabs />

          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <div className="border-b border-slate-200 dark:border-white/10 pb-2 mb-4">
              <TabsList className="flex w-full max-w-2xl bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 h-10 p-1 rounded-xl">
                <TabsTrigger
                  value="carteira"
                  className="flex-1 text-xs font-bold data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-purple-650 data-[state=active]:shadow-xs"
                >
                  <Users className="h-3.5 w-3.5 mr-1.5" />
                  Carteira de Clientes
                </TabsTrigger>

                <TabsTrigger
                  value="apresentacao"
                  className="flex-1 text-xs font-bold data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-purple-650 data-[state=active]:shadow-xs"
                >
                  <Briefcase className="h-3.5 w-3.5 mr-1.5" />
                  Hub de Briefing
                </TabsTrigger>

                <TabsTrigger
                  value="identidade"
                  className="flex-1 text-xs font-bold data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-purple-650 data-[state=active]:shadow-xs"
                >
                  <Sparkles className="h-3.5 w-3.5 mr-1.5 text-purple-600" />
                  Identidade Visual & Guia
                </TabsTrigger>

                <TabsTrigger
                  value="briefings"
                  className="flex-1 text-xs font-bold data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-purple-650 data-[state=active]:shadow-xs"
                >
                  <ListChecks className="h-3.5 w-3.5 mr-1.5" />
                  Briefings Salvos
                </TabsTrigger>
              </TabsList>
            </div>

            {/* Aba 1: Carteira de Clientes (Cockpit) */}
            <TabsContent value="carteira" className="focus-visible:outline-none focus-visible:ring-0">
              <ErrorBoundary>
                <ClientPortfolioDashboard
                  onOpenIdentityWizard={handleOpenWizardFromPortfolio}
                  onOpenBriefingHub={handleOpenBriefingFromPortfolio}
                />
              </ErrorBoundary>
            </TabsContent>

            {/* Aba 2: Hub de Briefing */}
            <TabsContent value="apresentacao" className="focus-visible:outline-none focus-visible:ring-0">
              <ErrorBoundary>
                <GeracaoDigitalPitch />
              </ErrorBoundary>
            </TabsContent>

            {/* Aba 3: Wizard de Identidade Visual */}
            <TabsContent value="identidade" className="focus-visible:outline-none focus-visible:ring-0">
              <ErrorBoundary>
                <BrandIdentityWizard
                  initialClientName={selectedClientForWizard}
                  onBackToPortfolio={() => setSearchParams({ tab: "carteira" })}
                />
              </ErrorBoundary>
            </TabsContent>

            {/* Aba 4: Briefings Salvos */}
            <TabsContent value="briefings" className="focus-visible:outline-none focus-visible:ring-0">
              <ErrorBoundary>
                <GeracaoDigitalBriefings />
              </ErrorBoundary>
            </TabsContent>
          </Tabs>
        </div>
      </PageShellContext.Provider>
    </PageShell>
  );
}
