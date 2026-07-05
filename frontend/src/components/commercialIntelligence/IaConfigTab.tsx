import type { Dispatch, SetStateAction } from "react";
import { Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { DashboardPanel } from "@/components/DashboardPanel";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type {
  CommercialIntelligenceFilters,
  CommercialIntelligencePayload,
  CommercialIntelligenceSettings,
  InsightItem,
} from "@/hooks/useCommercialIntelligence";
import { PERIOD_OPTIONS, severityClasses } from "@/lib/commercialIntelligence/helpers";
import { FilterField } from "./FilterField";

interface IaConfigTabProps {
  insightSeverity: string;
  setInsightSeverity: Dispatch<SetStateAction<string>>;
  insightType: string;
  setInsightType: Dispatch<SetStateAction<string>>;
  insightCampaign: string;
  setInsightCampaign: Dispatch<SetStateAction<string>>;
  insightCity: string;
  setInsightCity: Dispatch<SetStateAction<string>>;
  options: CommercialIntelligencePayload["filters"]["options"] | undefined;
  appliedFilters: CommercialIntelligenceFilters;
  insightsFiltered: InsightItem[];
  handleInsightAction: (insight: InsightItem) => Promise<void> | void;
  updateInsightStatus: {
    mutateAsync: (payload: { id: string; status: string }) => Promise<unknown>;
  };
  settingsDraft: CommercialIntelligenceSettings;
  setSettingsDraft: Dispatch<SetStateAction<CommercialIntelligenceSettings>>;
  handleRestoreSettings: () => void;
  handleSaveSettings: () => Promise<void> | void;
  saveSettings: { isPending: boolean };
}

export function IaConfigTab({
  insightSeverity,
  setInsightSeverity,
  insightType,
  setInsightType,
  insightCampaign,
  setInsightCampaign,
  insightCity,
  setInsightCity,
  options,
  appliedFilters,
  insightsFiltered,
  handleInsightAction,
  updateInsightStatus,
  settingsDraft,
  setSettingsDraft,
  handleRestoreSettings,
  handleSaveSettings,
  saveSettings,
}: IaConfigTabProps) {
  return (
    <>
          <DashboardPanel title="Diagnósticos de IA (Vexo Brain)" subtitle="Alertas automáticos e insights preditivos gerados a partir do histórico operacional" className="p-4">
            <div className="mb-4 grid gap-3 lg:grid-cols-5">
              <FilterField label="Severidade">
                <Select value={insightSeverity} onValueChange={setInsightSeverity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas</SelectItem>
                    <SelectItem value="critical">Critica</SelectItem>
                    <SelectItem value="warning">Alerta</SelectItem>
                    <SelectItem value="info">Informativa</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Tipo">
                <Select value={insightType} onValueChange={setInsightType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="campaign">Campanha</SelectItem>
                    <SelectItem value="city">Cidade</SelectItem>
                    <SelectItem value="consultant">Consultor</SelectItem>
                    <SelectItem value="distribution">Distribuicao</SelectItem>
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Campanha">
                <Select value={insightCampaign} onValueChange={setInsightCampaign}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as campanhas</SelectItem>
                    {(options?.campaigns || []).map((option) => (
                      <SelectItem key={option.id || option.value || option.name} value={option.id || option.value || option.name || ""}>
                        {option.label || option.name || option.value}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Cidade">
                <Select value={insightCity} onValueChange={setInsightCity}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as cidades</SelectItem>
                    {(options?.cities || []).map((option) => {
                      const value = option.value || option.name || option.label || "";
                      return <SelectItem key={value} value={value}>{option.label || option.name || value}</SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </FilterField>
              <FilterField label="Periodo">
                <div className="rounded-md border border-border bg-card px-3 py-2 text-sm text-muted-foreground">
                  {PERIOD_OPTIONS.find((option) => option.value === appliedFilters.period)?.label || "30 dias"}
                </div>
              </FilterField>
            </div>

            {insightsFiltered.length ? (
              <div className="grid gap-3 xl:grid-cols-2">
                {insightsFiltered.map((insight) => (
                  <div key={`${insight.id || insight.title}-${insight.generatedAt || ""}`} className="rounded-[1.35rem] border border-border bg-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-base font-semibold text-foreground">{insight.title}</p>
                        <p className="mt-1 text-sm text-muted-foreground">{insight.message}</p>
                      </div>
                      <Badge className={cn("border-0", severityClasses(insight.severity))}>{insight.severity}</Badge>
                    </div>
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-border bg-card/50 p-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Impacto estimado</p>
                        <p className="mt-1 text-sm font-medium text-foreground">{insight.impact}</p>
                      </div>
                      <div className="rounded-xl border border-border bg-card/50 p-3">
                        <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">Recomendacao</p>
                        <p className="mt-1 text-sm font-medium text-foreground">{insight.recommendation}</p>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button onClick={() => void handleInsightAction(insight)}>{insight.actionLabel}</Button>
                      {insight.id ? (
                        <Button variant="outline" onClick={() => void updateInsightStatus.mutateAsync({ id: insight.id, status: "resolved" }).then(() => toast.success("Insight marcado como resolvido.")).catch((err) => toast.error(err instanceof Error ? err.message : "Falha ao atualizar insight."))}>
                          Resolver
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Nenhum insight encontrado" description="Ajuste os filtros ou aguarde novos sinais operacionais da base." />
            )}
          </DashboardPanel>

          <DashboardPanel title="Parâmetros Operacionais & SLAs" subtitle="Limiar de qualificação, tempos de SLA de atendimento, regras de ranking e permissões" className="p-4">
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="space-y-4 rounded-[1.35rem] border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">Metricas e janelas</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <FilterField label="Limiar de qualificacao">
                    <Input type="number" min={0} max={100} value={settingsDraft.qualificationThreshold} onChange={(event) => setSettingsDraft((current) => ({ ...current, qualificationThreshold: Number(event.target.value) }))} />
                  </FilterField>
                  <FilterField label="SLA padrao (min)">
                    <Input type="number" min={1} value={settingsDraft.slaMinutes} onChange={(event) => setSettingsDraft((current) => ({ ...current, slaMinutes: Number(event.target.value) }))} />
                  </FilterField>
                  <FilterField label="Periodo padrao">
                    <Select value={settingsDraft.defaultPeriod} onValueChange={(value) => setSettingsDraft((current) => ({ ...current, defaultPeriod: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PERIOD_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FilterField>
                  <FilterField label="Estrategia principal">
                    <Select value={settingsDraft.distributionStrategy} onValueChange={(value) => setSettingsDraft((current) => ({ ...current, distributionStrategy: value }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="round_robin">Round-robin</SelectItem>
                        <SelectItem value="weighted_performance">Peso por performance</SelectItem>
                        <SelectItem value="priority_region">Prioridade por regiao</SelectItem>
                        <SelectItem value="priority_contract">Prioridade por valor potencial</SelectItem>
                        <SelectItem value="hybrid">Distribuicao hibrida</SelectItem>
                      </SelectContent>
                    </Select>
                  </FilterField>
                </div>
              </div>

              <div className="space-y-4 rounded-[1.35rem] border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">Regras de ranking</p>
                <div className="grid gap-4 md:grid-cols-3">
                  <FilterField label="Cidades">
                    <Select value={String(settingsDraft.rankingRules?.cities || "qualificationRate")} onValueChange={(value) => setSettingsDraft((current) => ({ ...current, rankingRules: { ...current.rankingRules, cities: value } }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="qualificationRate">Qualificacao</SelectItem>
                        <SelectItem value="conversionRate">Conversao</SelectItem>
                        <SelectItem value="revenue">Receita</SelectItem>
                      </SelectContent>
                    </Select>
                  </FilterField>
                  <FilterField label="Campanhas">
                    <Select value={String(settingsDraft.rankingRules?.campaigns || "qualifiedLeads")} onValueChange={(value) => setSettingsDraft((current) => ({ ...current, rankingRules: { ...current.rankingRules, campaigns: value } }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="qualifiedLeads">Qualificados</SelectItem>
                        <SelectItem value="responseRate">Resposta</SelectItem>
                        <SelectItem value="roiEstimated">ROI</SelectItem>
                      </SelectContent>
                    </Select>
                  </FilterField>
                  <FilterField label="Consultores">
                    <Select value={String(settingsDraft.rankingRules?.consultants || "conversionRate")} onValueChange={(value) => setSettingsDraft((current) => ({ ...current, rankingRules: { ...current.rankingRules, consultants: value } }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="conversionRate">Conversao</SelectItem>
                        <SelectItem value="revenue">Receita</SelectItem>
                        <SelectItem value="leadsReceived">Leads recebidos</SelectItem>
                      </SelectContent>
                    </Select>
                  </FilterField>
                </div>
              </div>

              <div className="space-y-4 rounded-[1.35rem] border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">Alertas e limiares</p>
                <div className="grid gap-4 md:grid-cols-2">
                  <FilterField label="Baixa resposta (%)">
                    <Input type="number" min={0} value={Number(settingsDraft.alertRules?.lowResponseRate || 15)} onChange={(event) => setSettingsDraft((current) => ({ ...current, alertRules: { ...current.alertRules, lowResponseRate: Number(event.target.value) } }))} />
                  </FilterField>
                  <FilterField label="Baixa conversao (%)">
                    <Input type="number" min={0} value={Number(settingsDraft.alertRules?.lowConversionRate || 10)} onChange={(event) => setSettingsDraft((current) => ({ ...current, alertRules: { ...current.alertRules, lowConversionRate: Number(event.target.value) } }))} />
                  </FilterField>
                  <FilterField label="Atraso de qualificacao (h)">
                    <Input type="number" min={0} value={Number(settingsDraft.alertRules?.highQualificationDelayHours || 24)} onChange={(event) => setSettingsDraft((current) => ({ ...current, alertRules: { ...current.alertRules, highQualificationDelayHours: Number(event.target.value) } }))} />
                  </FilterField>
                  <FilterField label="Fator abaixo da media">
                    <Input type="number" min={0} step="0.1" value={Number(settingsDraft.alertRules?.consultantBelowAverageFactor || 0.7)} onChange={(event) => setSettingsDraft((current) => ({ ...current, alertRules: { ...current.alertRules, consultantBelowAverageFactor: Number(event.target.value) } }))} />
                  </FilterField>
                </div>
              </div>

              <div className="space-y-4 rounded-[1.35rem] border border-border bg-card p-4">
                <p className="text-sm font-semibold text-foreground">Permissoes e governanca</p>
                <div className="space-y-3">
                  <label className="flex items-center justify-between rounded-xl border border-border bg-card/50 px-3 py-3 text-sm">
                    <span>Permitir editar configuracoes</span>
                    <Switch checked={Boolean(settingsDraft.permissions?.canEditSettings)} onCheckedChange={(checked) => setSettingsDraft((current) => ({ ...current, permissions: { ...current.permissions, canEditSettings: checked } }))} />
                  </label>
                  <label className="flex items-center justify-between rounded-xl border border-border bg-card/50 px-3 py-3 text-sm">
                    <span>Permitir gerenciar consultores</span>
                    <Switch checked={Boolean(settingsDraft.permissions?.canManageConsultants)} onCheckedChange={(checked) => setSettingsDraft((current) => ({ ...current, permissions: { ...current.permissions, canManageConsultants: checked } }))} />
                  </label>
                  <label className="flex items-center justify-between rounded-xl border border-border bg-card/50 px-3 py-3 text-sm">
                    <span>Permitir gerenciar distribuicao</span>
                    <Switch checked={Boolean(settingsDraft.permissions?.canManageDistribution)} onCheckedChange={(checked) => setSettingsDraft((current) => ({ ...current, permissions: { ...current.permissions, canManageDistribution: checked } }))} />
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">As alteracoes ficam persistidas por empresa e alimentam metricas, rankings, distribuicao e alertas.</p>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={handleRestoreSettings}>
                  Restaurar padrao
                </Button>
                <Button onClick={() => void handleSaveSettings()} disabled={saveSettings.isPending}>
                  {saveSettings.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Salvar configuracoes
                </Button>
              </div>
            </div>
          </DashboardPanel>
    </>
  );
}
