import { useState, useMemo, useEffect } from "react";
import { Flame, Link, Loader2, CheckSquare, Zap } from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { PageShell } from "@/components/PageShell";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { ErrorMessage } from "@/components/ErrorMessage";
import { useAuth } from "@/contexts/AuthContext";
import {
  useLeadClients,
  useSaveLeadClientEvolutionInstance,
  type LeadClientEvolutionInstance,
} from "@/hooks/useLeadClients";
import { useCrmClient } from "@/hooks/useCrmClient";
import { toast } from "@/components/ui/use-toast";
import { DIALOGUES } from "@/lib/aquecimento/constants";
import { TabChips } from "./Aquecimento/TabChips";
import { TabEsteira } from "./Aquecimento/TabEsteira";
import { TabChecklist } from "./Aquecimento/TabChecklist";

export default function Aquecimento() {
  const { clientId } = useAuth();
  const { selectedClientId } = useCrmClient();
  const { data: tenants = [], isLoading, error } = useLeadClients();
  const saveEvolutionInstance = useSaveLeadClientEvolutionInstance();
  const queryClient = useQueryClient();

  const [selectedDays, setSelectedDays] = useState<Record<string, number>>({});
  const [updatingChipId, setUpdatingChipId] = useState<string | null>(null);

  // Advanced Warming settings
  const [warmingActive, setWarmingActive] = useState<boolean>(true);
  const [warmingInterval, setWarmingInterval] = useState<string>("5");
  const [checkedChips, setCheckedChips] = useState<Record<string, boolean>>({});
  const [logs, setLogs] = useState<Array<{ time: string; from: string; to: string; msg: string }>>([]);
  const [activeTab, setActiveTab] = useState<"chips" | "esteira" | "checklist">("chips");

  // Checklist state persisted in localStorage
  const [checkedTasks, setCheckedTasks] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem("vexocrm_warming_checklist");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const activeClientId = selectedClientId || clientId || "";

  const activeTenant = useMemo(() => {
    return tenants.find((t) => t.id === activeClientId);
  }, [tenants, activeClientId]);

  const instances: LeadClientEvolutionInstance[] = useMemo(() => {
    return activeTenant?.n8n_settings?.evolution_instances ?? [];
  }, [activeTenant]);

  // Handle task toggles and persist
  const toggleTask = (taskKey: string) => {
    const next = { ...checkedTasks, [taskKey]: !checkedTasks[taskKey] };
    setCheckedTasks(next);
    localStorage.setItem("vexocrm_warming_checklist", JSON.stringify(next));
  };

  // Pre-fill active chips for warming loop
  useEffect(() => {
    if (instances.length > 0) {
      const nextChecked: Record<string, boolean> = {};
      instances.forEach((inst) => {
        nextChecked[inst.id] = checkedChips[inst.id] ?? inst.active;
      });
      setCheckedChips(nextChecked);
    }
  }, [instances]);

  // Generate simulated conversation logs between participating chips
  useEffect(() => {
    if (!warmingActive || instances.length < 2) return;

    const intervalVal = parseInt(warmingInterval, 10) * 1000 * 3; // speed up slightly for UI demonstration
    const interval = setInterval(() => {
      const activeIds = Object.keys(checkedChips).filter((id) => checkedChips[id]);
      if (activeIds.length < 2) return;

      // Randomly pick a sender and receiver
      const fromIdx = Math.floor(Math.random() * activeIds.length);
      let toIdx = Math.floor(Math.random() * activeIds.length);
      while (toIdx === fromIdx) {
        toIdx = Math.floor(Math.random() * activeIds.length);
      }

      const fromInstance = instances.find((i) => i.id === activeIds[fromIdx]);
      const toInstance = instances.find((i) => i.id === activeIds[toIdx]);

      if (fromInstance && toInstance) {
        const randomMsg = DIALOGUES[Math.floor(Math.random() * DIALOGUES.length)];
        const newLog = {
          time: new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          from: fromInstance.name,
          to: toInstance.name,
          msg: randomMsg,
        };

        setLogs((prev) => [newLog, ...prev.slice(0, 19)]);
      }
    }, intervalVal);

    return () => clearInterval(interval);
  }, [warmingActive, warmingInterval, checkedChips, instances]);

  const handleSetWarmingDay = async (
    instance: LeadClientEvolutionInstance,
    day: number
  ) => {
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
        dailyLimitOverride: null,
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
        dailyLimitOverride: 10,
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

  return (
    <PageShell
      title="Aquecimento de Chip"
      subtitle="Central completa de maturação de números. Configure limites, esteira de mensagens mútuas e checklists manuais."
      spacing="space-y-6"
      compactHero
      headerRight={null}
    >
      <ErrorMessage message={error ? (error as Error).message : null} variant="banner" />

      {/* Tabs Selector */}
      <div className="flex border-b border-slate-200 dark:border-white/5 pb-2 gap-6">
        <button
          type="button"
          onClick={() => setActiveTab("chips")}
          className={`pb-2 px-1 text-sm font-bold border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === "chips"
              ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Flame className="h-4 w-4" />
          Status dos Chips
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("esteira")}
          className={`pb-2 px-1 text-sm font-bold border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === "esteira"
              ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <Zap className="h-4 w-4" />
          Esteira Automática
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("checklist")}
          className={`pb-2 px-1 text-sm font-bold border-b-2 transition-all flex items-center gap-1.5 ${
            activeTab === "checklist"
              ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <CheckSquare className="h-4 w-4" />
          Checklist de Maturação
        </button>
      </div>

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
        <>
          {activeTab === "chips" && (
            <TabChips
              instances={instances}
              selectedDays={selectedDays}
              setSelectedDays={setSelectedDays}
              updatingChipId={updatingChipId}
              handleSetWarmingDay={handleSetWarmingDay}
              handlePromoteToWarm={handlePromoteToWarm}
              handleResetToCold={handleResetToCold}
            />
          )}

          {activeTab === "esteira" && (
            <TabEsteira
              instances={instances}
              warmingActive={warmingActive}
              setWarmingActive={setWarmingActive}
              warmingInterval={warmingInterval}
              setWarmingInterval={setWarmingInterval}
              checkedChips={checkedChips}
              setCheckedChips={setCheckedChips}
              logs={logs}
            />
          )}

          {activeTab === "checklist" && (
            <TabChecklist
              activeClientId={activeClientId}
              checkedTasks={checkedTasks}
              toggleTask={toggleTask}
            />
          )}
        </>
      )}
    </PageShell>
  );
}
