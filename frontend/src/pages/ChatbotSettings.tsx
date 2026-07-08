import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { PageShell } from "@/components/PageShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useLeadClients } from "@/hooks/useLeadClients";
import { TabGeral } from "./ChatbotSettings/TabGeral";
import { TabTemplate } from "./ChatbotSettings/TabTemplate";
import { TabPrompts } from "./ChatbotSettings/TabPrompts";
import { TabTeste } from "./ChatbotSettings/TabTeste";

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ChatbotSettings() {
  const { canAccessInternalPage } = useAuth();
  const { data: clients = [], isLoading: loadingClients } = useLeadClients();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const tab = searchParams.get("tab") ?? "geral";

  useEffect(() => {
    if (!selectedClientId && clients.length > 0) setSelectedClientId(clients[0].id);
  }, [clients, selectedClientId]);

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  const allowedTabs = selectedClient?.n8n_settings?.allowed_tabs;
  const isSubTabAllowed = (subTabKey: string) => {
    if (!allowedTabs || !Array.isArray(allowedTabs)) return true;
    return allowedTabs.includes(`chatbot:${subTabKey}`);
  };

  const chatbotSubTabs = ["geral", "template", "prompts", "teste"] as const;
  const allowedChatbotSubTabs = chatbotSubTabs.filter(isSubTabAllowed);

  useEffect(() => {
    if (selectedClientId && allowedChatbotSubTabs.length > 0) {
      const isCurrentAllowed = allowedChatbotSubTabs.includes(tab as any);
      if (!isCurrentAllowed) {
        setSearchParams({ tab: allowedChatbotSubTabs[0] });
      }
    }
  }, [selectedClientId, tab, allowedChatbotSubTabs, setSearchParams]);

  if (!canAccessInternalPage("empresas")) {
    return (
      <PageShell title="Chatbot" subtitle="Acesso restrito">
        <p className="text-sm text-slate-500">Você não tem permissão para acessar esta página.</p>
      </PageShell>
    );
  }

  return (
    <PageShell title="Chatbot" subtitle="Configure o chatbot SPIN por empresa" spacing="space-y-6">
      {/* Seletor de empresa */}
      <div className="flex items-center gap-3">
        <Select value={selectedClientId} onValueChange={setSelectedClientId} disabled={loadingClients}>
          <SelectTrigger className="w-64 h-9 text-sm">
            <SelectValue placeholder={loadingClients ? "Carregando..." : "Selecione a empresa"} />
          </SelectTrigger>
          <SelectContent>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id} className="text-sm">{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedClient && (
          <span className="text-xs text-slate-400 font-mono">{selectedClientId}</span>
        )}
      </div>

      {!selectedClientId ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-400">Selecione uma empresa para configurar o chatbot.</p>
        </div>
      ) : allowedChatbotSubTabs.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10">
          <p className="text-sm text-slate-400">Você não tem permissão para acessar nenhuma sub-aba desta ferramenta.</p>
        </div>
      ) : (
        <Tabs value={tab} onValueChange={(v) => setSearchParams({ tab: v })}>
          <TabsList className="h-9">
            {isSubTabAllowed("geral") && <TabsTrigger value="geral" className="text-sm">Geral</TabsTrigger>}
            {isSubTabAllowed("template") && <TabsTrigger value="template" className="text-sm">Template</TabsTrigger>}
            {isSubTabAllowed("prompts") && <TabsTrigger value="prompts" className="text-sm">Prompts</TabsTrigger>}
            {isSubTabAllowed("teste") && <TabsTrigger value="teste" className="text-sm">Teste</TabsTrigger>}
          </TabsList>

          {isSubTabAllowed("geral") && (
            <TabsContent value="geral" className="mt-5">
              {selectedClient && (
                <TabGeral clientId={selectedClientId} clientName={selectedClient.name} client={selectedClient} />
              )}
            </TabsContent>
          )}

          {isSubTabAllowed("template") && (
            <TabsContent value="template" className="mt-5">
              <TabTemplate clientId={selectedClientId} />
            </TabsContent>
          )}

          {isSubTabAllowed("prompts") && (
            <TabsContent value="prompts" className="mt-5">
              <TabPrompts clientId={selectedClientId} />
            </TabsContent>
          )}

          {isSubTabAllowed("teste") && (
            <TabsContent value="teste" className="mt-5">
              <TabTeste clientId={selectedClientId} />
            </TabsContent>
          )}
        </Tabs>
      )}
    </PageShell>
  );
}
