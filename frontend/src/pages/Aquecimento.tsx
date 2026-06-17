import { useState, useMemo } from "react";
import {
  Flame,
  CheckCircle2,
  AlertCircle,
  TrendingUp,
  Save,
  RotateCcw,
  Sparkles,
  Link,
  Loader2,
} from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { useAuth } from "@/contexts/AuthContext";
import {
  useLeadClients,
  useSaveLeadClientEvolutionInstance,
  type LeadClient,
  type LeadClientEvolutionInstance,
} from "@/hooks/useLeadClients";
import { toast } from "@/components/ui/use-toast";

export default function Aquecimento() {
  const { clientId, isAdminUser } = useAuth();
  const { data: tenants = [], isLoading, error, refetch } = useLeadClients();
  const saveEvolutionInstance = useSaveLeadClientEvolutionInstance();
  const queryClient = useQueryClient();

  const [selectedClientId, setSelectedClientId] = useState<string>(() => clientId ?? "");
  const [selectedDays, setSelectedDays] = useState<Record<string, number>>({});
  const [updatingChipId, setUpdatingChipId] = useState<string | null>(null);

  const showSelector = isAdminUser || !clientId;
  const activeClientId = selectedClientId || clientId || "";

  // Active tenant matching selectedClientId
  const activeTenant = useMemo(() => {
    return tenants.find((t) => t.id === activeClientId);
  }, [tenants, activeClientId]);

  // List of connected chips (evolution instances) for active tenant
  const instances: LeadClientEvolutionInstance[] = useMemo(() => {
    return activeTenant?.n8n_settings?.evolution_instances ?? [];
  }, [activeTenant]);

  const handleSetWarmingDay = async (
    instance: LeadClientEvolutionInstance,
    day: number
  ) => {
    // Plan: Day 1 = 10, Day 2 = 20, ..., Day 10 = 100
    const limit = day * 10;
    
    try {
      setUpdatingChipId(instance.id);
      await saveEvolutionInstance.mutateAsync({
        tenantId: activeClientId,
        instanceId: instance.id,
        name: instance.name,
        dispatchWebhookUrl: instance.dispatch_webhook_url ?? "",
        chipState: "cold",
        dailyLimitOverride: limit,
      });

      // Clear local day selection
      setSelectedDays((prev) => {
        const next = { ...prev };
        delete next[instance.id];
        return next;
      });

      queryClient.invalidateQueries({ queryKey: ["lead-clients"] });
      toast({
        title: "Cota de aquecimento aplicada",
        description: `Chip "${instance.name}" configurado para o Dia ${day} (Cota: ${limit} msgs/dia).`,
      });
    } catch (err) {
      toast({
        title: "Erro ao atualizar cota",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setUpdatingChipId(null);
    }
  };

  const handlePromoteToWarm = async (instance: LeadClientEvolutionInstance) => {
    try {
      setUpdatingChipId(instance.id);
      await saveEvolutionInstance.mutateAsync({
        tenantId: activeClientId,
        instanceId: instance.id,
        name: instance.name,
        dispatchWebhookUrl: instance.dispatch_webhook_url ?? "",
        chipState: "warm",
        dailyLimitOverride: null, // resets to default 500
      });

      queryClient.invalidateQueries({ queryKey: ["lead-clients"] });
      toast({
        title: "Chip promovido!",
        description: `O chip "${instance.name}" foi promovido a Aquecido. Cota padrão de 500 msgs/dia reativada.`,
      });
    } catch (err) {
      toast({
        title: "Erro ao promover chip",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setUpdatingChipId(null);
    }
  };

  const handleResetToCold = async (instance: LeadClientEvolutionInstance) => {
    if (!confirm(`Deseja mesmo rebaixar o chip "${instance.name}" para Frio e reiniciar o aquecimento?`)) return;

    try {
      setUpdatingChipId(instance.id);
      await saveEvolutionInstance.mutateAsync({
        tenantId: activeClientId,
        instanceId: instance.id,
        name: instance.name,
        dispatchWebhookUrl: instance.dispatch_webhook_url ?? "",
        chipState: "cold",
        dailyLimitOverride: 10, // starts at Day 1 (10 messages)
      });

      queryClient.invalidateQueries({ queryKey: ["lead-clients"] });
      toast({
        title: "Chip rebaixado a Frio",
        description: `O chip "${instance.name}" foi resetado. Cota inicial configurada para 10 msgs/dia.`,
      });
    } catch (err) {
      toast({
        title: "Erro ao resetar chip",
        description: err instanceof Error ? err.message : "Erro desconhecido.",
        variant: "destructive",
      });
    } finally {
      setUpdatingChipId(null);
    }
  };

  // Helper to resolve currently select day for a chip or infer from limit
  const getWarmingDay = (instance: LeadClientEvolutionInstance) => {
    if (selectedDays[instance.id] !== undefined) {
      return selectedDays[instance.id];
    }
    const currentLimit = instance.daily_limit_override ?? 100;
    // Map limit to day: 10->Day 1, 20->Day 2, etc. Max 10.
    const day = Math.min(10, Math.max(1, Math.round(currentLimit / 10)));
    return day;
  };

  return (
    <PageShell
      title="Aquecimento de Chip"
      subtitle="Configure e monitore o plano de aquecimento dos seus números para mitigar o risco de banimento."
      spacing="space-y-6"
      compactHero
      headerRight={
        showSelector ? (
          <Select value={selectedClientId} onValueChange={setSelectedClientId}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Selecione um tenant" />
            </SelectTrigger>
            <SelectContent>
              {tenants.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null
      }
    >
      <ErrorMessage message={error ? (error as Error).message : null} variant="banner" />

      {!activeClientId ? (
        <EmptyState
          title="Selecione um tenant"
          description="Escolha um tenant no seletor acima para gerenciar o aquecimento de chips."
        />
      ) : isLoading ? (
        <div className="flex h-[320px] items-center justify-center text-sm text-muted-foreground gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
          Carregando informações dos chips...
        </div>
      ) : instances.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-slate-300/80 bg-white/70 p-8 text-center dark:border-white/10 dark:bg-white/[0.02]">
          <EmptyState
            title="Nenhum chip conectado"
            description="Você precisa conectar e parear pelo menos um chip WhatsApp antes de iniciar o plano de aquecimento."
          />
          <Button asChild variant="outline" className="rounded-xl h-10 border-slate-200/80 dark:border-white/10">
            <RouterLink to="/crm/conexoes">
              <Link className="h-4 w-4 mr-2" />
              Ir para Conexões
            </RouterLink>
          </Button>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {instances.map((instance) => {
            const isCold = instance.chip_state === "cold";
            const day = getWarmingDay(instance);
            const calculatedLimit = day * 10;
            const currentLimit = instance.daily_limit_override ?? (isCold ? 100 : 500);
            const sent = instance.sent_count_today ?? 0;
            const todayPct = Math.min(100, Math.round((sent / currentLimit) * 100));
            const isPendingChange = selectedDays[instance.id] !== undefined && selectedDays[instance.id] * 10 !== instance.daily_limit_override;
            const isBusy = updatingChipId === instance.id;

            return (
              <Card
                key={instance.id}
                className="border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.04] rounded-2xl flex flex-col justify-between overflow-hidden"
              >
                <div>
                  <CardHeader className="pb-4 border-b border-slate-100 dark:border-white/5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1 min-w-0">
                        <CardTitle className="text-base font-bold truncate">
                          {instance.name}
                        </CardTitle>
                        <CardDescription className="text-xs flex items-center gap-1.5">
                          {instance.is_default && (
                            <Badge className="border border-cyan-400/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200 text-[10px] rounded-xl">
                              Padrão
                            </Badge>
                          )}
                          <Badge
                            className={
                              instance.active
                                ? "border border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 text-[10px] rounded-xl"
                                : "border border-slate-300 bg-slate-100 text-slate-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-white/60 text-[10px] rounded-xl"
                            }
                          >
                            {instance.active ? "Ativo" : "Inativo"}
                          </Badge>
                        </CardDescription>
                      </div>

                      <div className="shrink-0">
                        {isCold ? (
                          <Badge className="border border-blue-400/25 bg-blue-500/10 text-blue-700 dark:text-blue-200 rounded-xl px-2.5 py-1 text-xs font-semibold flex items-center gap-1">
                            <Flame className="h-3.5 w-3.5" />
                            Em Aquecimento
                          </Badge>
                        ) : (
                          <Badge className="border border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 rounded-xl px-2.5 py-1 text-xs font-semibold flex items-center gap-1">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Aquecido
                          </Badge>
                        )}
                      </div>
                    </div>
                  </CardHeader>

                  <CardContent className="p-6 space-y-6">
                    {/* Today's Limit Bar */}
                    <div className="space-y-2.5 rounded-xl border border-slate-200/50 bg-slate-50/50 p-4 dark:border-white/5 dark:bg-white/[0.01]">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground font-medium flex items-center gap-1">
                          Envios de Hoje
                        </span>
                        <span className="font-bold text-foreground font-num">
                          {sent} / {currentLimit} mensagens
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                        <div
                          className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                          style={{ width: `${todayPct}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {todayPct >= 100
                          ? "Cota diária de segurança atingida para este chip."
                          : `Restam ${currentLimit - sent} envios para atingir o limite seguro de hoje.`}
                      </p>
                    </div>

                    {isCold ? (
                      /* PLAN ACTIVE: Stepper for Days 1 to 10 */
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground font-display flex items-center gap-1">
                            <TrendingUp className="h-4 w-4 text-indigo-500" />
                            Plano de Aquecimento Gradual (10 dias)
                          </p>
                          <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">
                            Dia {day} de 10
                          </span>
                        </div>

                        {/* Visual Days Stepper Grid */}
                        <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
                          {Array.from({ length: 10 }, (_, i) => i + 1).map((d) => {
                            const isCurrent = d === day;
                            const isPast = d < day;
                            
                            return (
                              <button
                                key={d}
                                type="button"
                                disabled={isBusy}
                                className={`h-9 w-full flex items-center justify-center text-xs font-bold rounded-xl transition-all duration-200 border ${
                                  isCurrent
                                    ? "bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-500/10 scale-105"
                                    : isPast
                                      ? "bg-indigo-50 border-indigo-200/50 text-indigo-700 dark:bg-indigo-950/20 dark:border-indigo-900/30"
                                      : "bg-white border-slate-200 text-slate-700 hover:border-indigo-300 hover:bg-slate-50 dark:bg-transparent dark:border-white/10 dark:text-white/80"
                                }`}
                                onClick={() =>
                                  setSelectedDays((prev) => ({ ...prev, [instance.id]: d }))
                                }
                              >
                                {d}
                              </button>
                            );
                          })}
                        </div>

                        {/* Day Cota Preview */}
                        <div className="text-xs p-3.5 rounded-xl border border-slate-200 bg-white dark:border-white/5 dark:bg-white/[0.02] flex items-center justify-between">
                          <span className="text-muted-foreground font-medium">
                            Cota sugerida para o Dia {day}:
                          </span>
                          <span className="font-bold text-foreground font-num">
                            {calculatedLimit} mensagens / dia
                          </span>
                        </div>
                      </div>
                    ) : (
                      /* WARM Success Screen */
                      <div className="p-4 border border-emerald-200/40 bg-emerald-500/5 rounded-xl flex items-start gap-3 text-xs">
                        <Sparkles className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                        <div className="space-y-1 text-slate-700 dark:text-white/80">
                          <p className="font-bold text-emerald-700 dark:text-emerald-400">
                            Chip Totalmente Aquecido!
                          </p>
                          <p className="leading-relaxed">
                            Este chip está qualificado para operar com a cota operacional cheia de <strong>500 envios/dia</strong> sem restrições.
                          </p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </div>

                <CardFooter className="p-6 bg-slate-50/50 dark:bg-white/[0.01] border-t border-slate-100 dark:border-white/5 flex flex-wrap items-center justify-between gap-3">
                  {isCold ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl text-xs h-9 border-slate-200/80 dark:border-white/10 hover:bg-slate-100"
                        disabled={isBusy}
                        onClick={() => void handlePromoteToWarm(instance)}
                      >
                        Pular e Concluir Aquecimento
                      </Button>
                      <Button
                        size="sm"
                        variant={isPendingChange ? "default" : "outline"}
                        className={`rounded-xl text-xs h-9 ${
                          isPendingChange ? "bg-indigo-600 hover:bg-indigo-700 text-white" : "border-slate-200/80 dark:border-white/10"
                        }`}
                        disabled={isBusy || !isPendingChange}
                        onClick={() => void handleSetWarmingDay(instance, day)}
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                        ) : (
                          <Save className="h-3.5 w-3.5 mr-1.5" />
                        )}
                        Aplicar Limite do Dia {day}
                      </Button>
                    </>
                  ) : (
                    <>
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <AlertCircle className="h-4 w-4 text-emerald-500" />
                        Pronto para campanhas em massa.
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl text-xs h-9 text-rose-500 border-rose-200/40 hover:bg-rose-500/10 hover:text-rose-600 dark:border-rose-950/20"
                        disabled={isBusy}
                        onClick={() => void handleResetToCold(instance)}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                        Resetar Aquecimento
                      </Button>
                    </>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </PageShell>
  );
}

// Internal Shadcn CardFooter helper since it wasn't imported directly
function CardFooter({ children, className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex items-center p-6 pt-0 ${className || ""}`} {...props}>
      {children}
    </div>
  );
}
