import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { ListChecks } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { useFupCompanies } from "@/hooks/useFollowupAdmin";
import { FollowUpJourneys } from "@/components/followup/FollowUpJourneys";
import { AnalyticsTab } from "@/pages/FollowupQueue/AnalyticsTab";
import { ConfigTab } from "@/pages/FollowupQueue/ConfigTab";

// ═══════════════════════════════════════════════════════════════════════════════
// TELA PRINCIPAL (DASHBOARD UNIFICADO DE FOLLOW-UP)
// ═══════════════════════════════════════════════════════════════════════════════

export default function FollowupDashboard() {
  const { canAccessInternalPage, currentTenant } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get("tab") || "fila";
  const crmClient = useOptionalCrmClient();
  const selectedCrmClient = crmClient?.selectedClient;

  const allowedTabs = selectedCrmClient?.n8n_settings?.allowed_tabs;
  const isSubTabAllowed = (subTabKey: string) => {
    if (!allowedTabs || !Array.isArray(allowedTabs)) return true;

    // Migração de permissões de UI
    if (subTabKey === "journeys") {
      if (allowedTabs.includes("followup:journeys")) return true;
      if (allowedTabs.includes("followup:regras") || allowedTabs.includes("followup:fila")) return true;
    }

    return allowedTabs.includes(`followup:${subTabKey}`);
  };

  const followupSubTabs = ["journeys", "metrics", "config"] as const;
  const allowedFollowupSubTabs = followupSubTabs.filter(isSubTabAllowed);

  useEffect(() => {
    if (allowedFollowupSubTabs.length > 0) {
      const isCurrentAllowed = allowedFollowupSubTabs.includes(activeTab as any);
      if (!isCurrentAllowed) {
        setSearchParams({ tab: allowedFollowupSubTabs[0] });
      }
    }
  }, [activeTab, allowedFollowupSubTabs, setSearchParams]);

  const { data: companies = [], isLoading: loadingCompanies } = useFupCompanies();

  // Selected company state shared across all operational tabs
  const [companyId, setCompanyId] = useState("all");

  useEffect(() => {
    // Select first company by default once loaded if none is selected
    if (companies.length > 0 && companyId === "all") {
      setCompanyId(companies[0].id);
    }
  }, [companies, companyId]);

  const setActiveTab = (tab: string) => {
    setSearchParams({ tab });
  };

  if (!canAccessInternalPage("fila-de-followup")) {
    return (
      <PageShell title="Follow-up" subtitle="Acesso restrito">
        <p className="text-sm text-slate-500">Você não tem permissão para acessar o painel de follow-up.</p>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Módulo de Follow-up"
      subtitle="Gerenciamento proativo de leads, campanhas, analytics e conexões no mesmo lugar"
      spacing="space-y-6"
    >
      {/* Cabeçalho Unificado de Controle */}
      <Card className="border-indigo-100 bg-indigo-50/20 dark:border-indigo-950 dark:bg-indigo-950/10">
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <ListChecks className="h-5 w-5 text-indigo-500 shrink-0" />
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Selecione o Número do WhatsApp (Empresa) para gerenciar fila, cadências e métricas.
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 max-w-xs w-full sm:w-auto">
              <Label className="text-xs font-semibold text-slate-600 dark:text-slate-400 shrink-0">Número do WhatsApp:</Label>
              <Select value={companyId} onValueChange={setCompanyId} disabled={loadingCompanies}>
                <SelectTrigger className="h-8 text-xs bg-white dark:bg-slate-900 border-indigo-100 dark:border-indigo-950">
                  <SelectValue placeholder={loadingCompanies ? "Carregando..." : "Selecionar Empresa"} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">Todos os Perfis</SelectItem>
                  {companies.map((c) => (
                    <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs Layout */}
      {allowedFollowupSubTabs.length === 0 ? (
        <div className="flex h-48 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-white/10 bg-card">
          <p className="text-sm text-slate-400">Você não tem permissão para acessar nenhuma sub-aba do Follow-up.</p>
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="w-full flex justify-start rounded-xl border border-slate-200/80 bg-slate-100/50 p-1 dark:border-white/10 dark:bg-white/[0.02]">
            {isSubTabAllowed("journeys") && (
              <TabsTrigger value="journeys" className="text-xs font-semibold px-4 py-2">
                Jornadas Automatizadas
              </TabsTrigger>
            )}
            {isSubTabAllowed("metrics") && (
              <TabsTrigger value="metrics" className="text-xs font-semibold px-4 py-2">
                Estatísticas
              </TabsTrigger>
            )}
            {isSubTabAllowed("config") && (
              <TabsTrigger value="config" className="text-xs font-semibold px-4 py-2">
                Configuração
              </TabsTrigger>
            )}
          </TabsList>

          {isSubTabAllowed("journeys") && (
            <TabsContent value="journeys" className="space-y-4 outline-none">
              <FollowUpJourneys companyId={companyId} />
            </TabsContent>
          )}

          {isSubTabAllowed("metrics") && (
            <TabsContent value="metrics" className="space-y-4 outline-none">
              <AnalyticsTab companyId={companyId} />
            </TabsContent>
          )}

          {isSubTabAllowed("config") && (
            <TabsContent value="config" className="space-y-4 outline-none">
              <ConfigTab />
            </TabsContent>
          )}
        </Tabs>
      )}
    </PageShell>
  );
}
