import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/PageShell";
import { GeracaoDigitalTabs } from "@/components/GeracaoDigitalTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/use-toast";
import {
  Bot,
  Cpu,
  Sparkles,
  CheckCircle2,
  XCircle,
  Play,
  Save,
  MessageSquare,
  ShieldCheck,
  Zap,
  Activity,
  Users,
  Terminal,
} from "lucide-react";
import { fetchApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { podeVerClientesGd } from "@/lib/gdClientes";

interface GoclawRuntimeStatus {
  online: boolean;
  latencyMs: number | null;
  url: string;
  primaryModel: string;
  fallbackModel: string;
  lanes: string[];
}

interface GoclawStatusResponse {
  ok: boolean;
  runtime: GoclawRuntimeStatus;
  users: Array<{ username: string; name: string; role: string }>;
}

const LANES_METADATA = [
  {
    key: "heloisa",
    nome: "Heloísa (Secretária Executiva WhatsApp)",
    descricao: "Copiloto direto de Conrado e Caio no WhatsApp. Processa áudios, executa cadastros, cobranças e agendamentos.",
    tag: "Exclusivo Sócios (WhatsApp)",
    cor: "purple",
  },
  {
    key: "maestro",
    nome: "Maestro (COO & Triagem)",
    descricao: "Coordenação geral da agência, orquestração de entregas e distribuição.",
    tag: "Coordenação",
    cor: "indigo",
  },
  {
    key: "demandas_cron",
    nome: "Vigia GD (Auditor Trello WhatsApp)",
    descricao: "Robô de monitoramento de prazos que roda às 09h00 e 18h00 disparando alertas no WhatsApp.",
    tag: "Automação Cron",
    cor: "amber",
  },
  {
    key: "onboarding",
    nome: "Onboarding (Boas-vindas Clientes)",
    descricao: "Geração de grupos de WhatsApp, coleta de briefings e boas-vindas dos novos clientes.",
    tag: "Clientes Novos",
    cor: "emerald",
  },
];

export function GeracaoDigitalGoclawConfig() {
  const { accessProfile, getIdToken } = useAuth();
  const temAcesso = podeVerClientesGd(accessProfile);

  const [activeLane, setActiveLane] = useState("heloisa");
  const [promptEditando, setPromptEditando] = useState<Record<string, string>>({});
  const [logDisparo, setLogDisparo] = useState<any>(null);

  // ─── Query Status GoClaw ──────────────────────────────────────────────────
  const { data: statusData, isLoading: carregandoStatus, refetch: refetchStatus } = useQuery<GoclawStatusResponse>({
    queryKey: ["goclawStatus"],
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetchApi("/api/goclaw/status", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao consultar status do GoClaw");
      return res.json();
    },
    enabled: temAcesso,
    refetchInterval: 15000,
  });

  // ─── Query Prompts ────────────────────────────────────────────────────────
  const { data: promptsData, isLoading: carregandoPrompts } = useQuery<{ ok: boolean; prompts: Record<string, string> }>({
    queryKey: ["goclawPrompts"],
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetchApi("/api/goclaw/prompts", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao carregar prompts do GoClaw");
      const json = await res.json();
      setPromptEditando(json.prompts || {});
      return json;
    },
    enabled: temAcesso,
  });

  // ─── Mutation Salvar Prompt ───────────────────────────────────────────────
  const salvarPromptMutation = useMutation({
    mutationFn: async () => {
      const token = await getIdToken();
      const content = promptEditando[activeLane] || "";
      const res = await fetchApi(`/api/goclaw/prompts/${activeLane}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao salvar prompt.");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Prompt Atualizado!",
        description: `O prompt da lane "${activeLane}" foi salvo com sucesso no GoClaw.`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao salvar",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ─── Mutation Testar Vigia ────────────────────────────────────────────────
  const testarVigiaMutation = useMutation({
    mutationFn: async (periodo: string) => {
      const token = await getIdToken();
      const res = await fetchApi("/api/goclaw/test-vigia", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ periodo }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Falha no disparo do Vigia.");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setLogDisparo(data);
      toast({
        title: "Vigia Disparado com Sucesso!",
        description: "Os relatórios foram enviados para o WhatsApp dos sócios.",
      });
    },
    onError: (err: any) => {
      toast({
        title: "Falha no disparo",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (!temAcesso) {
    return (
      <PageShell title="GoClaw Engine">
        <div className="p-8 text-center text-slate-500">
          <ShieldCheck className="h-12 w-12 mx-auto text-amber-500 mb-2" />
          <h2 className="text-lg font-bold">Acesso Restrito</h2>
          <p className="text-sm">Você não tem permissão para configurar o motor GoClaw.</p>
        </div>
      </PageShell>
    );
  }

  const runtime = statusData?.runtime;

  return (
    <PageShell title="GoClaw Engine - Agente Autônomo & Heloísa">
      <GeracaoDigitalTabs />

      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header com Status do Runtime */}
        <div className="bg-white dark:bg-slate-900 p-6 rounded-2xl border border-slate-200 dark:border-white/10 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-2xl bg-purple-50 dark:bg-purple-950/50 border border-purple-200 dark:border-purple-800 flex items-center justify-center text-purple-600">
              <Bot className="h-7 w-7" />
            </div>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-slate-900 dark:text-white">
                  GoClaw Engine & Heloísa (Central WhatsApp)
                </h1>
                {runtime?.online ? (
                  <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white flex items-center gap-1.5 py-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Runtime Online ({runtime.latencyMs}ms)
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="flex items-center gap-1.5 py-1">
                    <XCircle className="h-3.5 w-3.5" />
                    Standby / Local Engine
                  </Badge>
                )}
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                Motor de IA autônomo da Geração Digital & Vexo OS. 100% WhatsApp, sem Slack.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchStatus()}
              className="rounded-xl text-xs"
            >
              <Activity className="h-3.5 w-3.5 mr-1" />
              Atualizar Status
            </Button>
          </div>
        </div>

        {/* Grid de Informações Técnicas e Heloísa */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card Heloísa */}
          <Card className="rounded-2xl border-purple-200 dark:border-purple-900/50 bg-gradient-to-br from-purple-50/50 to-white dark:from-purple-950/20 dark:to-slate-900 md:col-span-2 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-purple-600 text-white">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold text-slate-900 dark:text-white">
                      Heloísa · Secretária Executiva dos Sócios
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Canal exclusivo para Conrado Finzi e Caio Almeida no WhatsApp
                    </CardDescription>
                  </div>
                </div>
                <Badge className="bg-purple-600 text-white text-xs">WhatsApp Ativo</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="p-3 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-white/10">
                  <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-purple-600" />
                    Conrado Finzi
                  </div>
                  <div className="text-slate-500 font-mono mt-0.5">+55 (34) 99781-7660</div>
                  <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                    ✓ Autorizado para áudio e comandos
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-white dark:bg-slate-800/80 border border-slate-200 dark:border-white/10">
                  <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                    <Users className="h-3.5 w-3.5 text-purple-600" />
                    Caio Almeida
                  </div>
                  <div className="text-slate-500 font-mono mt-0.5">+55 (34) 99771-7779</div>
                  <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium mt-1">
                    ✓ Autorizado para áudio e comandos
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-xl bg-slate-100/70 dark:bg-slate-800/40 border border-slate-200 dark:border-white/10 space-y-1.5">
                <div className="font-semibold text-slate-800 dark:text-slate-200">
                  Como falar com a Heloísa no WhatsApp:
                </div>
                <p className="text-slate-600 dark:text-slate-400">
                  Envie mensagens de áudio ou texto direto pelo WhatsApp. Você pode pedir qualquer coisa:
                </p>
                <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400 pl-1">
                  <li><code className="text-[11px] bg-white dark:bg-slate-900 px-1 py-0.5 rounded">"Heloísa, cadastra o cliente Padaria Pão Real no valor de 3500"</code></li>
                  <li><code className="text-[11px] bg-white dark:bg-slate-900 px-1 py-0.5 rounded">"Cobra o Santana no WhatsApp pra ele mandar a arte do cliente X hoje"</code></li>
                  <li><code className="text-[11px] bg-white dark:bg-slate-900 px-1 py-0.5 rounded">"Agenda uma reunião com o Caio amanhã às 15h"</code></li>
                  <li><code className="text-[11px] bg-white dark:bg-slate-900 px-1 py-0.5 rounded">"Me dá um resumo dos clientes com prazo vencido"</code></li>
                </ul>
              </div>
            </CardContent>
          </Card>

          {/* Card Modelos & Vigia */}
          <Card className="rounded-2xl border-slate-200 dark:border-white/10 shadow-sm flex flex-col justify-between">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <Cpu className="h-5 w-5 text-indigo-500" />
                Modelos & Disparo Vigia
              </CardTitle>
              <CardDescription className="text-xs">
                Arquitetura de LLMs e teste em tempo real
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              <div className="space-y-2">
                <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-white/10">
                  <span className="text-slate-500">Modelo Primário:</span>
                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">Gemini 3 Flash</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-white/10">
                  <span className="text-slate-500">Fallback Automático:</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">Groq GPT-OSS 120B</span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-slate-100 dark:border-white/10">
                  <span className="text-slate-500">Transcrição Áudio:</span>
                  <span className="font-mono text-slate-700 dark:text-slate-300">Groq Whisper Large</span>
                </div>
              </div>

              <div className="pt-2">
                <div className="font-semibold text-slate-900 dark:text-white mb-2 flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-amber-500" />
                  Testar Vigia no WhatsApp dos Sócios
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => testarVigiaMutation.mutate("checkin")}
                    disabled={testarVigiaMutation.isPending}
                    className="rounded-xl text-xs"
                  >
                    <Play className="h-3 w-3 mr-1 text-emerald-500" />
                    Vigia 09h (Manhã)
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => testarVigiaMutation.mutate("checkout")}
                    disabled={testarVigiaMutation.isPending}
                    className="rounded-xl text-xs"
                  >
                    <Play className="h-3 w-3 mr-1 text-purple-500" />
                    Vigia 18h (Tarde)
                  </Button>
                </div>
              </div>

              {logDisparo && (
                <div className="p-2.5 rounded-xl bg-slate-900 text-slate-200 font-mono text-[11px] overflow-x-auto max-h-32">
                  ✓ Disparo: {logDisparo.resultado?.relatorio?.slice(0, 180)}...
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Editor de Prompts das Lanes */}
        <Card className="rounded-2xl border-slate-200 dark:border-white/10 shadow-sm">
          <CardHeader className="pb-3 border-b border-slate-100 dark:border-white/10">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  <Terminal className="h-5 w-5 text-purple-600" />
                  Editor de Prompts das Lanes (GoClaw)
                </CardTitle>
                <CardDescription className="text-xs">
                  Ajuste fino visual das instruções de cada robô da agência
                </CardDescription>
              </div>

              <Button
                onClick={() => salvarPromptMutation.mutate()}
                disabled={salvarPromptMutation.isPending}
                className="bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 self-start md:self-auto"
              >
                <Save className="h-4 w-4" />
                {salvarPromptMutation.isPending ? "Salvando..." : "Salvar Prompt da Lane"}
              </Button>
            </div>

            {/* Abas das Lanes */}
            <div className="flex gap-2 pt-4 overflow-x-auto">
              {LANES_METADATA.map((l) => (
                <button
                  key={l.key}
                  onClick={() => setActiveLane(l.key)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-2 border whitespace-nowrap ${
                    activeLane === l.key
                      ? "bg-purple-600 text-white border-purple-600 shadow-sm"
                      : "bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-100"
                  }`}
                >
                  <span>{l.nome}</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 ${
                      activeLane === l.key ? "bg-white/20 text-white border-white/30" : ""
                    }`}
                  >
                    {l.tag}
                  </Badge>
                </button>
              ))}
            </div>
          </CardHeader>

          <CardContent className="pt-4 space-y-3">
            <div className="text-xs text-slate-500">
              {LANES_METADATA.find((l) => l.key === activeLane)?.descricao}
            </div>

            <Textarea
              value={promptEditando[activeLane] || ""}
              onChange={(e) =>
                setPromptEditando((prev) => ({
                  ...prev,
                  [activeLane]: e.target.value,
                }))
              }
              rows={18}
              className="font-mono text-xs leading-relaxed rounded-xl bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-white/10"
              placeholder="Digite o system prompt da lane..."
            />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
export default GeracaoDigitalGoclawConfig;
