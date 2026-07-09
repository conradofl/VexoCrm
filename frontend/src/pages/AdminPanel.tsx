import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Building2, ShieldCheck, Server } from "lucide-react";
import Tenants from "./Tenants";
import UserAccessManagement from "./UserAccessManagement";
import WebhooksIntegrations from "./WebhooksIntegrations";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { useAuth } from "@/contexts/AuthContext";
import { PageShell, PageShellContext } from "@/components/PageShell";

export default function AdminPanel() {
  const { canAccessInternalPage } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  
  const hasEmpresas = canAccessInternalPage("empresas");
  const hasUsuarios = canAccessInternalPage("usuarios");
  const hasIntegracoes = canAccessInternalPage("empresas");

  // Determine default tab based on first allowed page
  const defaultTab = hasEmpresas ? "empresas" : hasUsuarios ? "usuarios" : hasIntegracoes ? "integracoes" : "";
  const activeTab = searchParams.get("tab") || defaultTab;

  useEffect(() => {
    // If the active tab is not allowed, redirect to a permitted one
    if (activeTab === "empresas" && !hasEmpresas) {
      setSearchParams({ tab: defaultTab });
    } else if (activeTab === "usuarios" && !hasUsuarios) {
      setSearchParams({ tab: defaultTab });
    } else if (activeTab === "integracoes" && !hasIntegracoes) {
      setSearchParams({ tab: defaultTab });
    }
  }, [activeTab, hasEmpresas, hasUsuarios, hasIntegracoes, defaultTab, setSearchParams]);

  const handleTabChange = (val: string) => {
    setSearchParams({ tab: val });
  };

  if (!defaultTab) {
    return (
      <PageShell title="Administrador" subtitle="Gerencie empresas, usuários e integrações de sistema">
        <div className="p-8 text-center text-muted-foreground">
          Você não possui permissão para acessar nenhuma ferramenta administrativa.
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Administrador" subtitle="Gerencie empresas, usuários e integrações de sistema">
      <PageShellContext.Provider value={true}>
        <div className="w-full space-y-6">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <div className="border-b border-slate-200 dark:border-white/10 pb-2">
              <TabsList className="flex w-full max-w-lg bg-muted border border-border h-10 p-1">
                {hasEmpresas && (
                  <TabsTrigger value="empresas" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                    <Building2 className="h-3.5 w-3.5 mr-1.5" />
                    Empresas
                  </TabsTrigger>
                )}
                {hasUsuarios && (
                  <TabsTrigger value="usuarios" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                    <ShieldCheck className="h-3.5 w-3.5 mr-1.5" />
                    Usuários
                  </TabsTrigger>
                )}
                {hasIntegracoes && (
                  <TabsTrigger value="integracoes" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                    <Server className="h-3.5 w-3.5 mr-1.5" />
                    Integrações
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            {hasEmpresas && (
              <TabsContent value="empresas" className="mt-4 focus-visible:outline-none focus-visible:ring-0">
                <ErrorBoundary>
                  <Tenants />
                </ErrorBoundary>
              </TabsContent>
            )}
            {hasUsuarios && (
              <TabsContent value="usuarios" className="mt-4 focus-visible:outline-none focus-visible:ring-0">
                <ErrorBoundary>
                  <UserAccessManagement />
                </ErrorBoundary>
              </TabsContent>
            )}
            {hasIntegracoes && (
              <TabsContent value="integracoes" className="mt-4 focus-visible:outline-none focus-visible:ring-0">
                <ErrorBoundary>
                  <WebhooksIntegrations />
                </ErrorBoundary>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </PageShellContext.Provider>
    </PageShell>
  );
}
