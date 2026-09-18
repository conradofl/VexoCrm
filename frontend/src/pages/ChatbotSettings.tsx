import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useLeadClients } from "@/hooks/useLeadClients";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { TabGeral } from "./ChatbotSettings/TabGeral";
import { TabTemplate } from "./ChatbotSettings/TabTemplate";
import { TabPrompts } from "./ChatbotSettings/TabPrompts";
import { TabTeste } from "./ChatbotSettings/TabTeste";

export default function ChatbotSettings() {
  const { isInternalUser } = useAuth();
  const crmClient = useOptionalCrmClient();
  const { data: clients = [], isLoading: loadingClients } = useLeadClients();
  const [searchParams, setSearchParams] = useSearchParams();

  const [subTab, setSubTab] = useState<string>(searchParams.get("subtab") || "geral");

  // Sync subtab with URL query param `subtab` without wiping `tab=settings`
  useEffect(() => {
    const urlSubtab = searchParams.get("subtab");
    if (urlSubtab && ["geral", "template", "prompts", "teste"].includes(urlSubtab)) {
      setSubTab(urlSubtab);
    }
  }, [searchParams]);

  const handleSubTabChange = (val: string) => {
    setSubTab(val);
    setSearchParams((prev) => {
      prev.set("subtab", val);
      return prev;
    });
  };

  if (!isInternalUser) {
    return (
      <PageShell title="Chatbot" subtitle="Acesso restrito">
        <p className="text-sm text-slate-500">Você não tem permissão para acessar esta página.</p>
      </PageShell>
    );
  }

  // Deriva o tenant ativo diretamente do seletor global do CRM sem duplicar
  // estado em useState estático. Ao mudar no cabeçalho, o painel muda na hora.
  const activeClientId =
    crmClient?.selectedClientId && crmClient.selectedClientId !== "global"
      ? crmClient.selectedClientId
      : (clients[0]?.id || "");

  const selectedClient = activeClientId
    ? clients.find((c) => c.id === activeClientId) || null
    : null;

  if (loadingClients || !activeClientId || !selectedClient) {
    return (
      <PageShell title="Padrões da empresa" subtitle="O que é da empresa, não de um agente: chatbot padrão, modelos de prompt e o relatório da equipe">
        <div className="flex h-32 items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-b-2 border-slate-900 dark:border-slate-100" />
        </div>
      </PageShell>
    );
  }

  const allowedTabs = selectedClient?.n8n_settings?.allowed_tabs;
  const isSubTabAllowed = (subTabKey: string) => {
    if (!allowedTabs || !Array.isArray(allowedTabs)) return true;
    return allowedTabs.includes(`chatbot:${subTabKey}`);
  };

  const currentClientId = activeClientId;

  return (
    <PageShell title="Padrões da empresa" subtitle="O que é da empresa, não de um agente: chatbot padrão, modelos de prompt e o relatório da equipe" spacing="space-y-6">
      {/* Empresa vem do seletor do cabecalho. O seletor proprio que existia aqui
          listava TODOS os tenants (Infinie, Outlier, Vexo...) mesmo com a
          Geracao Digital escolhida no topo — dois controles para a mesma coisa,
          um deles mostrando empresas que nao eram a da tela. */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          {selectedClient?.name || "Empresa"}
        </span>
        <span className="text-xs text-slate-400 font-mono">{currentClientId}</span>
      </div>

      <Tabs value={subTab} onValueChange={handleSubTabChange} className="w-full">
        <TabsList className="h-10 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-white/10 p-1">
          {isSubTabAllowed("geral") && <TabsTrigger value="geral" className="text-xs font-bold px-4">Geral</TabsTrigger>}
          {isSubTabAllowed("template") && <TabsTrigger value="template" className="text-xs font-bold px-4">Template</TabsTrigger>}
          {isSubTabAllowed("prompts") && <TabsTrigger value="prompts" className="text-xs font-bold px-4">Prompts</TabsTrigger>}
          {isSubTabAllowed("teste") && <TabsTrigger value="teste" className="text-xs font-bold px-4">Simulador de Teste</TabsTrigger>}
        </TabsList>

        <div className="pt-4">
          {subTab === "geral" && isSubTabAllowed("geral") && (
            <TabGeral clientId={currentClientId} clientName={selectedClient?.name || "Empresa"} client={selectedClient} />
          )}

          {subTab === "template" && isSubTabAllowed("template") && (
            <TabTemplate clientId={currentClientId} />
          )}

          {subTab === "prompts" && isSubTabAllowed("prompts") && (
            <TabPrompts clientId={currentClientId} />
          )}

          {subTab === "teste" && isSubTabAllowed("teste") && (
            <TabTeste clientId={currentClientId} />
          )}
        </div>
      </Tabs>
    </PageShell>
  );
}
