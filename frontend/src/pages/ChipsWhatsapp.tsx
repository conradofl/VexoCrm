import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Wifi, Flame, ShieldAlert } from "lucide-react";
import Conexoes from "./Conexoes";
import Aquecimento from "./Aquecimento";
import EvolutionAdmin from "./EvolutionAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function ChipsWhatsapp() {
  const { canAccessInternalPage, isAdminUser } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const hasConexoes = canAccessInternalPage("conexoes");
  const hasAquecimento = canAccessInternalPage("aquecimento");
  const hasEvolutionAdmin = isAdminUser;

  // Determine default tab based on first allowed page
  const defaultTab = hasConexoes ? "conexoes" : hasAquecimento ? "aquecimento" : hasEvolutionAdmin ? "evolution-admin" : "";
  const activeTab = searchParams.get("tab") || defaultTab;

  useEffect(() => {
    if (activeTab === "conexoes" && !hasConexoes) {
      setSearchParams({ tab: defaultTab });
    } else if (activeTab === "aquecimento" && !hasAquecimento) {
      setSearchParams({ tab: defaultTab });
    } else if (activeTab === "evolution-admin" && !hasEvolutionAdmin) {
      setSearchParams({ tab: defaultTab });
    }
  }, [activeTab, hasConexoes, hasAquecimento, hasEvolutionAdmin, defaultTab, setSearchParams]);

  const handleTabChange = (val: string) => {
    setSearchParams({ tab: val });
  };

  if (!defaultTab) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Você não possui permissão para gerenciar canais de WhatsApp.
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <div className="border-b border-slate-200 dark:border-white/10 pb-2">
          <TabsList className="flex w-full max-w-lg bg-muted border border-border h-10 p-1">
            {hasConexoes && (
              <TabsTrigger value="conexoes" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                <Wifi className="h-3.5 w-3.5 mr-1.5" />
                Conexões
              </TabsTrigger>
            )}
            {hasAquecimento && (
              <TabsTrigger value="aquecimento" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                <Flame className="h-3.5 w-3.5 mr-1.5" />
                Aquecimento
              </TabsTrigger>
            )}
            {hasEvolutionAdmin && (
              <TabsTrigger value="evolution-admin" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                <ShieldAlert className="h-3.5 w-3.5 mr-1.5" />
                Evolution Admin
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        {hasConexoes && (
          <TabsContent value="conexoes" className="mt-4 focus-visible:outline-none focus-visible:ring-0">
            <ErrorBoundary>
              <Conexoes />
            </ErrorBoundary>
          </TabsContent>
        )}
        {hasAquecimento && (
          <TabsContent value="aquecimento" className="mt-4 focus-visible:outline-none focus-visible:ring-0">
            <ErrorBoundary>
              <Aquecimento />
            </ErrorBoundary>
          </TabsContent>
        )}
        {hasEvolutionAdmin && (
          <TabsContent value="evolution-admin" className="mt-4 focus-visible:outline-none focus-visible:ring-0">
            <ErrorBoundary>
              <EvolutionAdmin />
            </ErrorBoundary>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
