import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Briefcase, ListChecks } from "lucide-react";
import GeracaoDigitalPitch from "./GeracaoDigitalPitch";
import GeracaoDigitalBriefings from "./GeracaoDigitalBriefings";
import { useAuth } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageShell, PageShellContext } from "@/components/PageShell";
import { GeracaoDigitalTabs } from "@/components/GeracaoDigitalTabs";

export default function GeracaoDigital() {
  const { canAccessInternalPage } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const hasApresentacao = canAccessInternalPage("apresentacao-gd");
  const hasBriefings = canAccessInternalPage("briefings-gd");

  // Determine default tab based on first allowed page
  const defaultTab = hasApresentacao ? "apresentacao" : hasBriefings ? "briefings" : "";
  const activeTab = searchParams.get("tab") || defaultTab;

  useEffect(() => {
    if (activeTab === "apresentacao" && !hasApresentacao) {
      setSearchParams({ tab: defaultTab });
    } else if (activeTab === "briefings" && !hasBriefings) {
      setSearchParams({ tab: defaultTab });
    }
  }, [activeTab, hasApresentacao, hasBriefings, defaultTab, setSearchParams]);

  const handleTabChange = (val: string) => {
    setSearchParams({ tab: val });
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
    <PageShell title="Geração Digital" subtitle="Módulo específico de inteligência e automação para Geração Digital">
      <PageShellContext.Provider value={true}>
        <div className="w-full space-y-6">
          <GeracaoDigitalTabs />

          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <div className="border-b border-slate-200 dark:border-white/10 pb-2 mb-4">
              <TabsList className="flex w-full max-w-md bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 h-10 p-1 rounded-xl">
                {hasApresentacao && (
                  <TabsTrigger value="apresentacao" className="flex-1 text-xs font-bold data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-purple-650 data-[state=active]:shadow-sm">
                    <Briefcase className="h-3.5 w-3.5 mr-1.5" />
                    Coleta de Briefing
                  </TabsTrigger>
                )}
                {hasBriefings && (
                  <TabsTrigger value="briefings" className="flex-1 text-xs font-bold data-[state=active]:bg-white dark:data-[state=active]:bg-slate-800 data-[state=active]:text-purple-650 data-[state=active]:shadow-sm">
                    <ListChecks className="h-3.5 w-3.5 mr-1.5" />
                    Briefings Salvos
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            {hasApresentacao && (
              <TabsContent value="apresentacao" className="focus-visible:outline-none focus-visible:ring-0">
                <ErrorBoundary>
                  <GeracaoDigitalPitch />
                </ErrorBoundary>
              </TabsContent>
            )}
            {hasBriefings && (
              <TabsContent value="briefings" className="focus-visible:outline-none focus-visible:ring-0">
                <ErrorBoundary>
                  <GeracaoDigitalBriefings />
                </ErrorBoundary>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </PageShellContext.Provider>
    </PageShell>
  );
}
