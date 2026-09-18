import { useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Bot, BookOpen, Database, Building2 } from "lucide-react";
import InboundAgentConfig from "./InboundAgentConfig";
import ChatbotDocs from "./ChatbotDocs";
import { KnowledgeBaseRagTab } from "@/components/agente/KnowledgeBaseRagTab";
import { UpsellCard } from "@/components/UpsellCard";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { resolveTenantPlan, hasFeatureUnlocked } from "@/lib/planTier";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { PageShell, PageShellContext } from "@/components/PageShell";

import { TenantScopeBoundary } from "@/components/TenantScopeBoundary";

export default function AgenteIA() {
  const { isInternalUser, isAdminUser } = useAuth();
  const crmClient = useOptionalCrmClient();
  const selectedClient = crmClient?.selectedClient;
  const activeClientId = selectedClient?.id || crmClient?.selectedClientId || "";
  const [searchParams, setSearchParams] = useSearchParams();

  const isRagUnlocked = hasFeatureUnlocked(selectedClient, "agente_rag");
  const isAgenteUnlocked =
    hasFeatureUnlocked(selectedClient, "agente_inbound") ||
    hasFeatureUnlocked(selectedClient, "agente_rag");

  const hasAgente = isInternalUser;
  const isVexoAdmTenant = selectedClient?.id === "vexo_adm" || selectedClient?.id === "vexo";
  const hasDocs = isAdminUser && isVexoAdmTenant;

  const rawTab = searchParams.get("tab");
  const validTabs = ["agentes", "rag", ...(hasDocs ? ["docs"] : [])];
  const activeTab = validTabs.includes(rawTab || "") ? (rawTab as string) : "agentes";

  const handleTabChange = (val: string) => {
    setSearchParams((prev) => {
      prev.set("tab", val);
      return prev;
    });
  };

  if (!isInternalUser) {
    return (
      <PageShell title="Agente IA" subtitle="Gerencie os agentes que atendem cada número de WhatsApp">
        <div className="p-8 text-center text-muted-foreground">
          Você não possui permissão para acessar o ecossistema do Agente IA.
        </div>
      </PageShell>
    );
  }

  if (!isAgenteUnlocked) {
    return (
      <PageShell title="Agente IA" subtitle="Gerencie os agentes que atendem cada número de WhatsApp">
        <div className="max-w-2xl mx-auto py-8">
          <UpsellCard
            title="Agente IA & Atendimento Automatizado"
            subtitle="Módulo Não Contratado no Plano Modular"
            description="Automatize o primeiro atendimento dos seus leads, faça triagem inteligente, configure múltiplos assistentes com IA e ative a base de conhecimento RAG para responder com base nos seus próprios documentos."
            moduleName="Agente IA"
            benefits={[
              "Chatbot com Inteligência Artificial para atendimento 24/7",
              "Triagem e qualificação de leads com classificação automática",
              "Kanban visual de conversas e transição para atendente humano",
              "Suporte a upload de documentos e base RAG integrada",
            ]}
          />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Agente IA" subtitle="Gerencie os agentes que atendem cada número de WhatsApp">
      <PageShellContext.Provider value={true}>
        <div className="w-full space-y-6">
          <div className="flex justify-end">
            <Link
              to="/crm/padroes-da-empresa"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Building2 className="h-3.5 w-3.5" />
              Padrões da empresa
            </Link>
          </div>
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <div className="border-b border-slate-200 dark:border-white/10 pb-2 overflow-x-auto">
              <TabsList className="flex w-max min-w-full bg-muted border border-border h-10 p-1">
                {hasAgente && (
                  <TabsTrigger value="agentes" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                    <Bot className="h-3.5 w-3.5 mr-1.5" />
                    Agentes
                  </TabsTrigger>
                )}
                {hasAgente && (
                  <TabsTrigger value="rag" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                    <Database className="h-3.5 w-3.5 mr-1.5 text-cyan-500" />
                    Base de Conhecimento
                  </TabsTrigger>
                )}
                {hasDocs && (
                  <TabsTrigger value="docs" className="flex-1 text-xs data-[state=active]:bg-background data-[state=active]:text-foreground">
                    <BookOpen className="h-3.5 w-3.5 mr-1.5" />
                    Documentação
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            {hasAgente && (
              <TabsContent value="agentes" className="mt-4 focus-visible:outline-none focus-visible:ring-0">
                <ErrorBoundary>
                  <TenantScopeBoundary tenantId={activeClientId}>
                    <InboundAgentConfig />
                  </TenantScopeBoundary>
                </ErrorBoundary>
              </TabsContent>
            )}

            {hasAgente && (
              <TabsContent value="rag" className="mt-4 focus-visible:outline-none focus-visible:ring-0">
                <ErrorBoundary>
                  <TenantScopeBoundary tenantId={activeClientId}>
                    {isRagUnlocked ? (
                      <KnowledgeBaseRagTab />
                    ) : (
                      <UpsellCard
                        title="Base de Conhecimento RAG (PDFs & Docs)"
                        subtitle="Exclusivo do Plano Avançado"
                        description="Faça upload de catálogos, tabelas de preços, manuais técnicos e termos contratuais para o Agente IA consultar fatos exatos sem risco de alucinação."
                        moduleName="Base de Conhecimento RAG"
                        benefits={[
                          "Upload de PDFs, DOCX, TXT e planilhas técnicas",
                          "Indexação vetorial automática e busca semântica",
                          "Respostas 100% embasadas na documentação oficial",
                          "Simulador integrado de busca semântica em tempo real",
                        ]}
                      >
                        <KnowledgeBaseRagTab />
                      </UpsellCard>
                    )}
                  </TenantScopeBoundary>
                </ErrorBoundary>
              </TabsContent>
            )}

            {hasDocs && (
              <TabsContent value="docs" className="mt-4 focus-visible:outline-none focus-visible:ring-0">
                <ErrorBoundary>
                  <TenantScopeBoundary tenantId={activeClientId}>
                    <ChatbotDocs />
                  </TenantScopeBoundary>
                </ErrorBoundary>
              </TabsContent>
            )}
          </Tabs>
        </div>
      </PageShellContext.Provider>
    </PageShell>
  );
}
