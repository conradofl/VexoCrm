import { useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, KanbanSquare, Settings2, BookOpen, AlertTriangle } from "lucide-react";
import ChatbotKanban from "./ChatbotKanban";
import ChatbotSettings from "./ChatbotSettings";
import InboundAgentConfig from "./InboundAgentConfig";
import ChatbotDocs from "./ChatbotDocs";
import Agente from "./Agente";
import { useAuth } from "@/contexts/AuthContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";

export default function AgenteIA() {
  const { canAccessInternalPage } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const hasAgente = canAccessInternalPage("agente");
  const hasSettings = canAccessInternalPage("chatbot-config");

  // Determine default tab based on first allowed page
  const defaultTab = hasAgente ? "operacao" : hasSettings ? "settings" : "";
  const activeTab = searchParams.get("tab") || defaultTab;

  useEffect(() => {
    if (activeTab === "operacao" && !hasAgente) {
      setSearchParams({ tab: defaultTab });
    } else if (activeTab === "settings" && !hasSettings) {
      setSearchParams({ tab: defaultTab });
    } else if (activeTab === "inbound" && !hasAgente) {
      setSearchParams({ tab: defaultTab });
    } else if (activeTab === "docs" && !hasAgente) {
      setSearchParams({ tab: defaultTab });
    } else if (activeTab === "alertas" && !hasAgente) {
      setSearchParams({ tab: defaultTab });
    }
  }, [activeTab, hasAgente, hasSettings, defaultTab, setSearchParams]);

  const handleTabChange = (val: string) => {
    setSearchParams({ tab: val });
  };

  if (!defaultTab) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Você não possui permissão para acessar o ecossistema do Agente IA.
      </div>
    );
  }

  return (
    <div className="w-full space-y-6">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <div className="border-b border-slate-200 dark:border-white/10 pb-2">
          <TabsList className="flex w-full max-w-2xl bg-muted border border-border h-10 p-1">
            {hasAgente && (
              <TabsTrigger value="operacao" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                <KanbanSquare className="h-3.5 w-3.5 mr-1.5" />
                Operação
              </TabsTrigger>
            )}
            {hasSettings && (
              <TabsTrigger value="settings" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                <Settings2 className="h-3.5 w-3.5 mr-1.5" />
                Configurações
              </TabsTrigger>
            )}
            {hasAgente && (
              <TabsTrigger value="inbound" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                <Bot className="h-3.5 w-3.5 mr-1.5" />
                Inbound
              </TabsTrigger>
            )}
            {hasAgente && (
              <TabsTrigger value="docs" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                Documentação
              </TabsTrigger>
            )}
            {hasAgente && (
              <TabsTrigger value="alertas" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
                Alertas n8n
              </TabsTrigger>
            )}
          </TabsList>
        </div>

        {hasAgente && (
          <TabsContent value="operacao" className="mt-4 focus-visible:outline-none focus-visible:ring-0">
            <ErrorBoundary>
              <ChatbotKanban />
            </ErrorBoundary>
          </TabsContent>
        )}
        {hasSettings && (
          <TabsContent value="settings" className="mt-4 focus-visible:outline-none focus-visible:ring-0">
            <ErrorBoundary>
              <ChatbotSettings />
            </ErrorBoundary>
          </TabsContent>
        )}
        {hasAgente && (
          <TabsContent value="inbound" className="mt-4 focus-visible:outline-none focus-visible:ring-0">
            <ErrorBoundary>
              <InboundAgentConfig />
            </ErrorBoundary>
          </TabsContent>
        )}
        {hasAgente && (
          <TabsContent value="docs" className="mt-4 focus-visible:outline-none focus-visible:ring-0">
            <ErrorBoundary>
              <ChatbotDocs />
            </ErrorBoundary>
          </TabsContent>
        )}
        {hasAgente && (
          <TabsContent value="alertas" className="mt-4 focus-visible:outline-none focus-visible:ring-0">
            <ErrorBoundary>
              <Agente />
            </ErrorBoundary>
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
