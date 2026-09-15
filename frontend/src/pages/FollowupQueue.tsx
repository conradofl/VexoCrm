import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Smartphone, Send, Zap, ChevronDown, CheckCircle2, CalendarDays } from "lucide-react";

import { PageShell } from "@/components/PageShell";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth } from "@/contexts/AuthContext";
import { useOptionalCrmClient } from "@/hooks/useCrmClient";
import { useFupCompanies, useCreateFupCompany, useUpdateFupCompany } from "@/hooks/useFollowupAdmin";
import { FollowUpJourneys } from "@/components/followup/FollowUpJourneys";
import CadenceEditor from "@/components/followup/CadenceEditor";
import FollowupCalendar from "@/components/followup/FollowupCalendar";
import { FollowupQueueTable } from "@/components/followup/FollowupQueueTable";
import { UpsellCard } from "@/components/UpsellCard";
import { resolveTenantPlan, hasFeatureUnlocked } from "@/lib/planTier";
import { cn } from "@/lib/utils";

// ═══════════════════════════════════════════════════════════════════════════════
// MÓDULO DE FOLLOW-UP — fluxo LINEAR (redesenho). Em vez de abas soltas, uma sequência
// de passos de cima para baixo: 1) número de WhatsApp do tenant → 2) cadências (o núcleo,
// usado pelo Banco de Dados) → 3) automações por evento (opcional) → 4) fila & métricas →
// configurações avançadas. As empresas são escopadas ao tenant (sem vazar outro cliente).
// ═══════════════════════════════════════════════════════════════════════════════

// Bloco de passo. `collapsible` recolhe seções secundárias para o fluxo não virar um scroll
// gigante. A seção principal (Cadências) fica sempre aberta.
function StepSection({
  step,
  icon,
  title,
  subtitle,
  children,
  collapsible = false,
  defaultOpen = false,
}: {
  step?: number;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const header = (
    <div className="flex items-center gap-3">
      {step != null && (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
          {step}
        </span>
      )}
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400">
        {icon}
      </span>
      <div className="min-w-0 text-left">
        <p className="text-sm font-bold text-foreground">{title}</p>
        {subtitle && <p className="text-xs text-muted-foreground leading-4">{subtitle}</p>}
      </div>
    </div>
  );

  if (!collapsible) {
    return (
      <Card>
        <CardContent className="p-4 space-y-4">
          {header}
          <div>{children}</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Collapsible defaultOpen={defaultOpen}>
      <Card>
        <CollapsibleTrigger className="group w-full">
          <CardContent className="p-4 flex items-center justify-between gap-3">
            {header}
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
          </CardContent>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="p-4 pt-0">{children}</CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

export default function FollowupDashboard() {
  const { canAccessInternalPage } = useAuth();
  const crmClient = useOptionalCrmClient();
  const selectedCrmClient = crmClient?.selectedClient;
  // Tenant ativo — escopa as empresas de follow-up ao próprio cliente.
  const tenantId = crmClient?.selectedClientId || selectedCrmClient?.id || undefined;

  const allowedTabs = selectedCrmClient?.n8n_settings?.allowed_tabs;
  const isSectionAllowed = (key: string) => {
    if (!allowedTabs || !Array.isArray(allowedTabs)) return true;
    if (key === "journeys") {
      if (allowedTabs.includes("followup:journeys")) return true;
      if (allowedTabs.includes("followup:regras") || allowedTabs.includes("followup:fila")) return true;
    }
    return allowedTabs.includes(`followup:${key}`);
  };

  const { data: companies = [], isLoading: loadingCompanies } = useFupCompanies(tenantId);
  const createCompany = useCreateFupCompany();
  const updateCompany = useUpdateFupCompany();
  const [companyId, setCompanyId] = useState("");
  const [isAutoCreating, setIsAutoCreating] = useState(false);

  // Instâncias Evolution conectadas do tenant ativo
  const connectedInstances = (selectedCrmClient?.n8n_settings?.evolution_instances || []).filter(
    (i: any) => i.active !== false
  );

  // Auto-criação / auto-sincronização transparente da empresa de follow-up caso o tenant tenha chip conectado
  useEffect(() => {
    if (
      !loadingCompanies &&
      companies.length === 0 &&
      connectedInstances.length > 0 &&
      tenantId &&
      !isAutoCreating
    ) {
      setIsAutoCreating(true);
      createCompany
        .mutateAsync({
          name: selectedCrmClient?.name || connectedInstances[0].name,
          evolution_instance: connectedInstances[0].name,
          evolution_instances: connectedInstances.map((i: any) => i.name),
          tenant_id: tenantId,
          webhook_url: "https://api.vexoia.com/webhooks/followup",
          panel_access: true,
          auto_pause_on_reply: true,
          auto_pause_on_calendly: false,
          sending_window_start: "08:00",
          sending_window_end: "18:00",
          sending_days: "1,2,3,4,5",
          engine_scan_interval_hours: 6,
          never_contacted_delay_hours: 2,
          no_reply_delay_hours: 48,
          livpub_inactive_delay_months: 6,
        })
        .then((created) => {
          setCompanyId(created.id);
          setIsAutoCreating(false);
        })
        .catch((err) => {
          console.error("[followup] Auto-provisionamento da empresa falhou:", err);
          setIsAutoCreating(false);
        });
    }
  }, [loadingCompanies, companies.length, connectedInstances.length, tenantId, isAutoCreating]);

  // Reseta seleção ao alternar de empresa (tenant)
  useEffect(() => {
    setCompanyId("");
  }, [tenantId]);

  // Seleciona o número do tenant automaticamente assim que carrega.
  useEffect(() => {
    if (companies.length > 0 && !companies.some((c) => c.id === companyId)) {
      setCompanyId(companies[0].id);
    }
  }, [companies, companyId]);

  const [activeTab, setActiveTab] = useState<"cadencias" | "fila" | "calendario">("cadencias");

  const activeCompany = companies.find((c) => c.id === companyId) || companies[0] || null;
  const hasCompany = companies.length > 0 || connectedInstances.length > 0;

  // Instância ativa atual
  const activeInstanceName =
    activeCompany?.evolution_instance ||
    (connectedInstances.length > 0 ? connectedInstances[0].name : "");

  const handleSelectInstance = (instanceName: string) => {
    const matchedCompany = companies.find(
      (c) =>
        c.evolution_instance === instanceName ||
        (Array.isArray(c.evolution_instances) && c.evolution_instances.includes(instanceName))
    );
    if (matchedCompany) {
      setCompanyId(matchedCompany.id);
    } else if (activeCompany) {
      updateCompany.mutate({
        id: activeCompany.id,
        evolution_instance: instanceName,
      });
    }
  };

  const isFollowupUnlocked =
    hasFeatureUnlocked(selectedCrmClient, "followup") ||
    hasFeatureUnlocked(selectedCrmClient, "followup_automations");

  const isAutomationsUnlocked = hasFeatureUnlocked(selectedCrmClient, "followup_automations");

  if (!isFollowupUnlocked) {
    return (
      <PageShell
        title="Módulo de Follow-up"
        subtitle="Configure o acompanhamento automático dos seus leads."
        spacing="space-y-4"
      >
        <div className="max-w-2xl mx-auto py-8">
          <UpsellCard
            title="Módulo de Follow-up & Cadências"
            subtitle="Módulo Não Contratado no Plano Modular"
            description="Recupere propostas paradas e reengaje leads frios automaticamente com réguas de contato inteligentes."
            moduleName="Módulo de Follow-up"
            benefits={[
              "Cadências de retorno programadas",
              "Gatilhos por evento e status do lead",
              "Sugestões inteligentes de recontato com IA",
              "Aumento comprovado na conversão de vendas",
            ]}
          />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell
      title="Módulo de Follow-up"
      subtitle="Configure, do começo ao fim, como o Vexo faz o acompanhamento automático dos seus leads."
      spacing="space-y-4"
    >
      {/* Navegação entre Abas do Módulo Follow-up */}
      <div className="flex items-center gap-2 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-xl w-fit border border-border">
        <button
          onClick={() => setActiveTab("cadencias")}
          className={cn(
            "rounded-lg px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all",
            activeTab === "cadencias"
              ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <Send className="h-3.5 w-3.5" />
          Cadências de Mensagens
        </button>
        <button
          onClick={() => setActiveTab("fila")}
          className={cn(
            "rounded-lg px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all",
            activeTab === "fila"
              ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <Zap className="h-3.5 w-3.5" />
          Fila de Acompanhamento
        </button>
        <button
          onClick={() => setActiveTab("calendario")}
          className={cn(
            "rounded-lg px-4 py-2 text-xs font-semibold flex items-center gap-1.5 transition-all",
            activeTab === "calendario"
              ? "bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white"
              : "text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
          )}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          Calendário
        </button>
      </div>

      {activeTab === "cadencias" && (
        <div className="space-y-4">
          {/* Passo 1 — Número de WhatsApp do tenant */}
          <StepSection
            step={1}
            icon={<Smartphone className="h-4 w-4" />}
            title="Número de WhatsApp"
            subtitle="O canal conectado por onde as mensagens de follow-up são disparadas automaticamente."
          >
            {loadingCompanies || isAutoCreating ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="h-2 w-2 rounded-full bg-indigo-500 animate-ping" />
                Sincronizando canais de WhatsApp conectados...
              </div>
            ) : connectedInstances.length === 0 ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-4 text-amber-900 dark:text-amber-200">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="font-semibold text-sm">Nenhum WhatsApp conectado</p>
                    <p className="text-xs text-muted-foreground">
                      Para ativar o envio de follow-up, conecte um número de WhatsApp em Canais & Chips.
                    </p>
                  </div>
                  <Button asChild size="sm" variant="default" className="shrink-0">
                    <Link to="/crm/chips-whatsapp">Conectar WhatsApp</Link>
                  </Button>
                </div>
              </div>
            ) : connectedInstances.length === 1 ? (
              <div className="flex flex-wrap items-center gap-3">
                <Badge
                  variant="outline"
                  className="gap-2 border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 px-3 py-1.5 text-sm font-semibold rounded-lg"
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  {connectedInstances[0].name}
                </Badge>
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                  Canal ativo vinculado automaticamente para disparos de follow-up
                </span>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 max-w-lg">
                <Label className="text-xs font-semibold shrink-0">Canal de Disparo:</Label>
                <Select value={activeInstanceName} onValueChange={handleSelectInstance}>
                  <SelectTrigger className="h-9 text-sm rounded-lg bg-background border-border/80">
                    <SelectValue placeholder="Selecione o chip de disparo" />
                  </SelectTrigger>
                  <SelectContent>
                    {connectedInstances.map((inst: any) => (
                      <SelectItem key={inst.id || inst.name} value={inst.name} className="text-sm">
                        <div className="flex items-center gap-2">
                          <span className="h-2 w-2 rounded-full bg-emerald-500" />
                          <span className="font-medium">{inst.name}</span>
                          {inst.is_default && (
                            <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-1.5">
                              Padrão
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <span className="text-[11px] text-muted-foreground">
                  ({connectedInstances.length} chips disponíveis)
                </span>
              </div>
            )}
          </StepSection>

          {/* Passo 2 — Cadências (núcleo, integrado com o Banco de Dados) */}
          {isSectionAllowed("cadencias") && (
            <StepSection
              step={2}
              icon={<Send className="h-4 w-4" />}
              title="Cadências de follow-up"
              subtitle="Monte sequências de mensagens reutilizáveis (ex.: lembretes 7d/3d/1d antes de uma data). É o que você aplica nos leads pelo Banco de Dados."
            >
              {hasCompany ? (
                <CadenceEditor companyId={companyId} />
              ) : (
                <p className="text-xs text-muted-foreground">Cadastre o número de WhatsApp (passo 1) para criar cadências.</p>
              )}
            </StepSection>
          )}

          {/* Passo 3 — Automações por evento (Ocultado até os emissores de eventos serem conectados no CRM) */}
          {false as boolean && isSectionAllowed("journeys") && hasCompany && (
            <StepSection
              step={3}
              icon={<Zap className="h-4 w-4" />}
              title="Automações por evento (opcional)"
              subtitle="Mensagens disparadas automaticamente por gatilhos: novo lead, agendamento, proposta enviada, no-show."
              collapsible
              defaultOpen={isAutomationsUnlocked}
            >
              {isAutomationsUnlocked ? (
                <FollowUpJourneys companyId={companyId} />
              ) : (
                <UpsellCard
                  title="Automações por Evento"
                  subtitle="Exclusivo do Plano Avançado"
                  description="Gatilhos automáticos de Novo Lead, Agendamento e No-Show são exclusivos do Plano Avançado. Automatize 100% do seu pós-venda!"
                  moduleName="Automações por Evento (Follow-up)"
                  benefits={[
                    "Disparo imediato de boas-vindas para novos leads cadastrados",
                    "Lembretes automáticos antes e depois de reuniões (Agendamento & No-Show)",
                    "Reengajamento automático de propostas comerciais sem resposta",
                    "Reciclagem e reativação contínua de leads inativos ou perdidos",
                  ]}
                >
                  <FollowUpJourneys companyId={companyId} />
                </UpsellCard>
              )}
            </StepSection>
          )}
        </div>
      )}

      {/* Aba da Fila de Acompanhamento */}
      {activeTab === "fila" && (
        <FollowupQueueTable companyId={companyId} tenantId={tenantId} />
      )}

      {/* Aba do Calendário — lente, não superfície de criação */}
      {activeTab === "calendario" && <FollowupCalendar tenantId={tenantId} />}
    </PageShell>
  );
}
