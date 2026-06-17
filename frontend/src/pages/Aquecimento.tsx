import { useState, useMemo, useEffect } from "react";
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
  CheckSquare,
  Square,
  MessageSquare,
  Clock,
  Zap,
} from "lucide-react";
import { Link as RouterLink } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";

import { PageShell } from "@/components/PageShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
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

// Notion-based 10-day checklist guide data
const CHECKLIST_DAYS = [
  {
    day: 1,
    title: "Dia 1: Configuração Manual & Contatos Frequentes",
    tasks: [
      "Instalar o WhatsApp Business",
      "Definir nome e sobrenome realistas (evitar nomes puramente robóticos)",
      "Adicionar foto de perfil profissional, capa e preencher perfil completo",
      "Criar uma mensagem de status/recado comercial e configurar horário de atendimento",
      "Cadastrar um catálogo de produtos simples (mínimo 1 produto cadastrado)",
      "Enviar mensagens manuais para 25 contatos conhecidos ou empresas que respondam automaticamente",
      "Entrar em 3 a 5 grupos de aquecimento e conversar manualmente (áudio, foto, etc)",
    ],
  },
  {
    day: 2,
    title: "Dia 2: Rotina Manual e Humanização",
    tasks: [
      "Enviar mensagens para 25 contatos manuais a cada 3 horas",
      "Entrar em mais 3 grupos de aquecimento (evitar excessos)",
      "Postar pelo menos 3 Status diferentes ao longo do dia",
      "Fazer no mínimo 1 chamada de voz ou vídeo de 15 minutos com um número quente",
      "Salvar o contato de quem interagiu com você no chip",
    ],
  },
  {
    day: 3,
    title: "Dia 3: Repetição de Rotina",
    tasks: [
      "Manter a mesma rotina de interações do Dia 2",
      "Responder a todas as conversas recebidas",
      "Postar Status diário e salvar novos números",
    ],
  },
  {
    day: 4,
    title: "Dia 4: Conexão de Automação Híbrida",
    tasks: [
      "Conectar a esteira MMZAP / Maturador Mútuo",
      "Responder manualmente a interações geradas pela automação",
      "Salvar contatos dos grupos e enviar print de 'contato salvo' para reciprocidade",
      "Manter o limite seguro e não enviar ofertas diretas",
    ],
  },
  {
    day: 5,
    title: "Dia 5: Consolidação Híbrida",
    tasks: [
      "Repetir a rotina híbrida (automatizado + respostas humanas)",
      "Evitar campanhas de tráfego pago ou disparos em massa ainda (chip frágil)",
    ],
  },
  {
    day: 6,
    title: "Dia 6: Automação 1-on-1 e Grupos",
    tasks: [
      "Configurar listas de transmissão para quem salvou seu contato",
      "Ativar ferramentas auxiliares (Pro Sender ou aplicativos de resposta automática)",
      "Configurar respostas automáticas simulando delay humano",
    ],
  },
  {
    day: 7,
    title: "Dia 7 em diante: Blindagem & Monitoramento",
    tasks: [
      "Realizar teste de força de chip (blindagem)",
      "Manter aquecimento por pelo menos 15 a 30 dias se o chip for novo",
      "Promover a 'Aquecido' no painel se não houver alertas de ban",
    ],
  },
];

const DIALOGUES = [
  "Olá! Tudo bem com você?",
  "Tudo ótimo por aqui, e com você?",
  "Tudo bem também! Conseguiu ver aquela proposta comercial?",
  "Sim, acabei de analisar. O preço está excelente, vamos fechar!",
  "Que bom! Vou mandar o contrato em PDF para assinatura agora.",
  "Fechado, fico no aguardo. Obrigado pelo suporte!",
  "Bom dia! Tem um minutinho para conversarmos sobre o projeto?",
  "Olá! Tenho sim, pode falar.",
  "Perfeito, vou te ligar em instantes para alinhar os detalhes.",
  "Combinado, vou me preparar aqui.",
];

export default function Aquecimento() {
  const { clientId, isAdminUser } = useAuth();
  const { data: tenants = [], isLoading, error } = useLeadClients();
  const saveEvolutionInstance = useSaveLeadClientEvolutionInstance();
  const queryClient = useQueryClient();

  const [selectedClientId, setSelectedClientId] = useState<string>(() => clientId ?? "");
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

  const showSelector = isAdminUser || !clientId;
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

  const getWarmingDay = (instance: LeadClientEvolutionInstance) => {
    if (selectedDays[instance.id] !== undefined) {
      return selectedDays[instance.id];
    }
    const currentLimit = instance.daily_limit_override ?? 100;
    return Math.min(10, Math.max(1, Math.round(currentLimit / 10)));
  };

  return (
    <PageShell
      title="Aquecimento de Chip"
      subtitle="Central completa de maturação de números. Configure limites, esteira de mensagens mútuas e checklists manuais."
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

          {activeTab === "esteira" && (
            <div className="grid gap-6 lg:grid-cols-3">
              {/* Left Config Panel */}
              <Card className="lg:col-span-1 border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.04] rounded-2xl flex flex-col justify-between overflow-hidden">
                <CardHeader>
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <Zap className="h-5 w-5 text-indigo-500" />
                    Esteira Automática Mútua
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Simule conversas aleatórias entre os seus próprios chips locais para aumentar a reputação junto ao WhatsApp.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {/* Toggle Loop Active */}
                  <div className="flex items-center justify-between p-3 rounded-xl border border-slate-200/50 bg-slate-50/50 dark:border-white/5 dark:bg-white/[0.01]">
                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-foreground">Status do Aquecimento</p>
                      <p className="text-[10px] text-muted-foreground">Exibição de logs em tempo real</p>
                    </div>
                    <Button
                      size="sm"
                      variant={warmingActive ? "default" : "outline"}
                      className="rounded-xl text-xs h-8 px-4"
                      onClick={() => setWarmingActive(!warmingActive)}
                    >
                      {warmingActive ? "Executando" : "Pausado"}
                    </Button>
                  </div>

                  {/* Interval Selection */}
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-foreground flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                      Intervalo de Envio
                    </label>
                    <Select value={warmingInterval} onValueChange={setWarmingInterval}>
                      <SelectTrigger className="rounded-xl h-9 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="rounded-xl">
                        <SelectItem value="2">Demonstração Rápida (2s)</SelectItem>
                        <SelectItem value="5">Seguro (5s)</SelectItem>
                        <SelectItem value="10">Mais Seguro (10s)</SelectItem>
                        <SelectItem value="15">Extremamente Seguro (15s)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Checklist of participating chips */}
                  <div className="space-y-2">
                    <p className="text-xs font-bold text-foreground">Chips Participantes</p>
                    {instances.length < 2 && (
                      <p className="text-[10px] text-rose-500">
                        Atenção: É necessário pelo menos 2 chips conectados para usar a esteira mútua.
                      </p>
                    )}
                    <div className="space-y-1.5 rounded-xl border border-slate-200/50 bg-slate-50/50 p-3.5 dark:border-white/5 dark:bg-white/[0.01] max-h-[160px] overflow-y-auto">
                      {instances.map((inst) => (
                        <label
                          key={inst.id}
                          className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer hover:opacity-85 py-1"
                        >
                          <input
                            type="checkbox"
                            className="rounded border-slate-300 text-primary focus:ring-primary h-4 w-4"
                            checked={checkedChips[inst.id] ?? false}
                            onChange={(e) =>
                              setCheckedChips((prev) => ({ ...prev, [inst.id]: e.target.checked }))
                            }
                          />
                          <span>{inst.name}</span>
                          {inst.chip_state === "cold" ? (
                            <Badge className="border border-blue-400/25 bg-blue-500/10 text-blue-700 dark:text-blue-200 text-[8px] scale-90 py-0 px-1 rounded-xl">
                              Frio
                            </Badge>
                          ) : (
                            <Badge className="border border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 text-[8px] scale-90 py-0 px-1 rounded-xl">
                              Pronto
                            </Badge>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                </CardContent>
                <CardFooter className="p-6 border-t border-slate-100 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.01] text-[10px] text-muted-foreground leading-relaxed">
                  Esta simulação visual demonstra como os bots conversam entre si no backend para trocar pacotes de dados legítimos, gerando fluxo saudável de entrada e saída.
                </CardFooter>
              </Card>

              {/* Live Chat Log Feed Panel */}
              <Card className="lg:col-span-2 border-slate-200/80 bg-white/90 shadow-[0_20px_50px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-white/[0.04] rounded-2xl overflow-hidden">
                <CardHeader className="pb-3 border-b border-slate-100 dark:border-white/5">
                  <CardTitle className="text-base font-bold flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-indigo-500" />
                    Monitor de Conversas Mútuas
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Logs em tempo real de mensagens trocadas entre seus chips WhatsApp.
                  </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {logs.length === 0 ? (
                    <div className="h-[340px] flex flex-col items-center justify-center text-center p-6 text-muted-foreground gap-2">
                      <Zap className={`h-8 w-8 text-slate-300 ${warmingActive && instances.length >= 2 ? "animate-pulse" : ""}`} />
                      <p className="text-xs font-semibold text-foreground">Nenhuma mensagem trocada ainda</p>
                      <p className="text-[11px] max-w-xs leading-normal">
                        {instances.length < 2
                          ? "Conecte mais de um chip para iniciar o intercâmbio de mensagens."
                          : "Certifique-se de que a esteira está ativada para visualizar o fluxo."}
                      </p>
                    </div>
                  ) : (
                    <div className="p-4 h-[380px] overflow-y-auto font-mono text-[11px] space-y-2.5">
                      {logs.map((log, index) => (
                        <div
                          key={index}
                          className="p-3.5 rounded-xl border border-slate-200/60 bg-gradient-to-br from-white to-slate-50/20 dark:from-white/[0.02] dark:to-transparent dark:border-white/5 shadow-sm space-y-1 flex items-start justify-between gap-4"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-indigo-600 dark:text-indigo-400">
                                {log.from}
                              </span>
                              <span className="text-muted-foreground text-[10px]">➔</span>
                              <span className="font-bold text-teal-600 dark:text-teal-400">
                                {log.to}
                              </span>
                            </div>
                            <p className="text-foreground text-[12px] italic leading-normal">
                              "{log.msg}"
                            </p>
                          </div>
                          <span className="text-muted-foreground text-[9px] whitespace-nowrap pt-0.5">
                            {log.time}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {activeTab === "checklist" && (
            <div className="space-y-6">
              {/* Explanatory Banner */}
              <div className="p-4 rounded-xl border border-blue-200/40 bg-blue-500/5 flex items-start gap-3 text-xs leading-relaxed">
                <TrendingUp className="h-5 w-5 text-blue-500 shrink-0 mt-0.5" />
                <div className="space-y-1 text-slate-700 dark:text-white/80">
                  <p className="font-bold text-blue-700 dark:text-blue-400">
                    Importante: A Rotina Manual é Indispensável!
                  </p>
                  <p>
                    Segundo as regras recomendadas no Notion, **nunca ative nenhuma automação nos primeiros 3 dias**. O comportamento inicial precisa ser 100% humano para não acionar alertas nos servidores do WhatsApp. Utilize o checklist abaixo para guiar a sua operação diária.
                  </p>
                </div>
              </div>

              {/* Stepper Checklist Cards Grid */}
              <div className="grid gap-6 md:grid-cols-2">
                {CHECKLIST_DAYS.map((dayItem) => {
                  const dayKeyPrefix = `${activeClientId}_day_${dayItem.day}`;
                  const completedCount = dayItem.tasks.filter((t, i) => checkedTasks[`${dayKeyPrefix}_${i}`]).length;
                  const isFullyCompleted = completedCount === dayItem.tasks.length;

                  return (
                    <Card
                      key={dayItem.day}
                      className={`border-slate-200/80 bg-white/90 shadow-sm rounded-2xl overflow-hidden transition-all duration-200 ${
                        isFullyCompleted
                          ? "border-emerald-500/30 bg-emerald-500/[0.01] dark:border-emerald-500/20"
                          : ""
                      }`}
                    >
                      <CardHeader className="pb-3 border-b border-slate-100 dark:border-white/5 flex flex-row items-center justify-between">
                        <div>
                          <CardTitle className="text-sm font-bold flex items-center gap-2">
                            {dayItem.title}
                          </CardTitle>
                          <CardDescription className="text-[10px]">
                            {completedCount} de {dayItem.tasks.length} tarefas completas
                          </CardDescription>
                        </div>
                        {isFullyCompleted && (
                          <Badge className="border border-emerald-400/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 text-[9px] rounded-xl">
                            Concluído
                          </Badge>
                        )}
                      </CardHeader>
                      <CardContent className="p-5 space-y-3.5">
                        {dayItem.tasks.map((task, idx) => {
                          const taskKey = `${dayKeyPrefix}_${idx}`;
                          const isChecked = checkedTasks[taskKey] ?? false;

                          return (
                            <div
                              key={idx}
                              onClick={() => toggleTask(taskKey)}
                              className="flex items-start gap-2.5 text-xs text-foreground cursor-pointer select-none hover:opacity-85"
                            >
                              <div className="shrink-0 mt-0.5 text-indigo-500 dark:text-indigo-400">
                                {isChecked ? (
                                  <CheckSquare className="h-4.5 w-4.5 fill-indigo-100 dark:fill-indigo-950/40" />
                                ) : (
                                  <Square className="h-4.5 w-4.5" />
                                )}
                              </div>
                              <span className={`leading-normal ${isChecked ? "line-through text-muted-foreground" : "font-medium"}`}>
                                {task}
                              </span>
                            </div>
                          );
                        })}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
