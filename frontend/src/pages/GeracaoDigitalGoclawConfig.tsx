import React, { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PageShell } from "@/components/PageShell";
import { GeracaoDigitalTabs } from "@/components/GeracaoDigitalTabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/use-toast";
import {
  Bot,
  Cpu,
  Sparkles,
  CheckCircle2,
  XCircle,
  Play,
  Pause,
  Save,
  MessageSquare,
  ShieldCheck,
  Zap,
  Activity,
  Users,
  Terminal,
  Plus,
  Trash2,
  UserPlus,
  Phone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { podeVerClientesGd } from "@/lib/gdClientes";

export interface HeloisaUsuario {
  id: string;
  client_id: string;
  nome: string;
  telefone: string;
  papel: string;
  ativo: boolean;
  created_at?: string;
  updated_at?: string;
}

export function formatarTelefoneExibicao(tel: string) {
  const digits = String(tel || "").replace(/\D/g, "");
  if (!digits) return "—";
  if (digits.startsWith("55") && digits.length >= 12) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    if (rest.length === 9) {
      return `+55 (${ddd}) ${rest.slice(0, 5)}-${rest.slice(5)}`;
    }
    if (rest.length === 8) {
      return `+55 (${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
    }
    return `+55 (${ddd}) ${rest}`;
  }
  if (digits.length === 11) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return tel;
}

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
  const queryClient = useQueryClient();
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

  // ─── Query Usuários Autorizados Heloísa ────────────────────────────────────
  const {
    data: heloisaUsuarios = [],
    isLoading: carregandoUsuarios,
  } = useQuery<HeloisaUsuario[]>({
    queryKey: ["heloisaUsuarios"],
    queryFn: async () => {
      const token = await getIdToken();
      const res = await fetchApi("/api/goclaw/heloisa/usuarios", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Falha ao carregar usuários da Heloísa");
      const json = await res.json();
      return json.data || [];
    },
    enabled: temAcesso,
  });

  // Modal State
  const [modalUsuarioAberto, setModalUsuarioAberto] = useState(false);
  const [formNome, setFormNome] = useState("");
  const [formTelefone, setFormTelefone] = useState("");
  const [formPapel, setFormPapel] = useState("Diretor");
  const [formClientId, setFormClientId] = useState("geracao-digital");

  const abrirModalCriarUsuario = () => {
    setFormNome("");
    setFormTelefone("");
    setFormPapel("Diretor");
    setFormClientId("geracao-digital");
    setModalUsuarioAberto(true);
  };

  // ─── Mutation Salvar Usuário ───────────────────────────────────────────────
  const salvarUsuarioMutation = useMutation({
    mutationFn: async () => {
      const token = await getIdToken();
      const res = await fetchApi("/api/goclaw/heloisa/usuarios", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nome: formNome,
          telefone: formTelefone,
          papel: formPapel,
          client_id: formClientId,
          ativo: true,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao salvar número autorizado.");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Número Autorizado!",
        description: data.message || `O número de ${formNome} foi autorizado na Heloísa com sucesso.`,
      });
      queryClient.invalidateQueries({ queryKey: ["heloisaUsuarios"] });
      setModalUsuarioAberto(false);
      setFormNome("");
      setFormTelefone("");
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao cadastrar",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ─── Mutation Alternar Ativo/Pausar ────────────────────────────────────────
  const toggleAtivoMutation = useMutation({
    mutationFn: async ({ id, ativoAtual }: { id: string; ativoAtual: boolean }) => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/goclaw/heloisa/usuarios/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ ativo: !ativoAtual }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao atualizar status.");
      }
      return res.json();
    },
    onSuccess: (_, vars) => {
      toast({
        title: vars.ativoAtual ? "Acesso Pausado" : "Acesso Ativado",
        description: vars.ativoAtual
          ? "O número foi pausado e não executará comandos temporariamente."
          : "O número agora está ativo e autorizado a enviar comandos para a Heloísa.",
      });
      queryClient.invalidateQueries({ queryKey: ["heloisaUsuarios"] });
    },
    onError: (err: any) => {
      toast({
        title: "Erro",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  // ─── Mutation Excluir Usuário ──────────────────────────────────────────────
  const excluirUsuarioMutation = useMutation({
    mutationFn: async (id: string) => {
      const token = await getIdToken();
      const res = await fetchApi(`/api/goclaw/heloisa/usuarios/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "Falha ao excluir número.");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Número Removido",
        description: "O número foi desautorizado da Heloísa com sucesso.",
      });
      queryClient.invalidateQueries({ queryKey: ["heloisaUsuarios"] });
    },
    onError: (err: any) => {
      toast({
        title: "Erro ao remover",
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
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-xl bg-purple-600 text-white shrink-0">
                    <Sparkles className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                      Heloísa · Secretária Executiva dos Sócios
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Controle dinâmico de diretores autorizados a acionar a secretária no WhatsApp
                    </CardDescription>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={abrirModalCriarUsuario}
                    className="bg-purple-600 hover:bg-purple-700 text-white text-xs h-8 gap-1.5 shadow-sm"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    + Adicionar Número / Diretor
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4 text-xs">
              {/* Listagem Dinâmica dos Usuários Autorizados */}
              <div className="space-y-2 pt-1">
                {carregandoUsuarios ? (
                  <div className="p-6 text-center text-slate-400">Carregando diretores autorizados...</div>
                ) : heloisaUsuarios.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 border border-dashed rounded-xl">
                    Nenhum número cadastrado. Clique no botão acima para adicionar.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {heloisaUsuarios.map((u) => (
                      <div
                        key={u.id}
                        className={cn(
                          "p-3 rounded-xl bg-white dark:bg-slate-800/80 border transition-all flex flex-col justify-between gap-2.5",
                          u.ativo
                            ? "border-purple-200 dark:border-purple-900/40 shadow-xs"
                            : "border-slate-200 dark:border-white/10 opacity-70"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-semibold text-slate-900 dark:text-white flex items-center gap-1.5">
                              <Users className="h-3.5 w-3.5 text-purple-600 shrink-0" />
                              <span>{u.nome}</span>
                            </div>
                            <div className="text-[11px] text-slate-500 font-medium">
                              {u.papel} {u.client_id ? `· ${u.client_id}` : ""}
                            </div>
                          </div>
                          <Badge
                            variant={u.ativo ? "default" : "secondary"}
                            className={cn(
                              "text-[10px] px-1.5 py-0 font-medium",
                              u.ativo
                                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20"
                                : "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-400"
                            )}
                          >
                            {u.ativo ? "Ativo" : "Pausado"}
                          </Badge>
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-slate-100 dark:border-white/5">
                          <a
                            href={`https://wa.me/${u.telefone}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-600 dark:text-slate-300 font-mono text-xs hover:text-purple-600 transition-colors flex items-center gap-1"
                          >
                            <MessageSquare className="h-3 w-3 text-emerald-500" />
                            {formatarTelefoneExibicao(u.telefone)}
                          </a>

                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-500 hover:text-slate-800 dark:hover:text-white"
                              title={u.ativo ? "Pausar autorização" : "Ativar autorização"}
                              onClick={() => toggleAtivoMutation.mutate({ id: u.id, ativoAtual: u.ativo })}
                              disabled={toggleAtivoMutation.isPending}
                            >
                              {u.ativo ? <Pause className="h-3.5 w-3.5 text-amber-500" /> : <Play className="h-3.5 w-3.5 text-emerald-500" />}
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-slate-400 hover:text-red-600 dark:hover:text-red-400"
                              title="Remover autorização"
                              onClick={() => {
                                if (confirm(`Deseja desautorizar "${u.nome}" da Heloísa?`)) {
                                  excluirUsuarioMutation.mutate(u.id);
                                }
                              }}
                              disabled={excluirUsuarioMutation.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
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

      {/* Modal Adicionar / Editar Número Heloísa */}
      <Dialog open={modalUsuarioAberto} onOpenChange={setModalUsuarioAberto}>
        <DialogContent className="max-w-md rounded-2xl">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-600" />
              + Adicionar Número / Diretor
            </DialogTitle>
            <DialogDescription className="text-xs">
              Cadastre o número de WhatsApp do diretor ou gestor para autorizar comandos e áudios com a Heloísa.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2 text-xs">
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Nome Completo *
              </Label>
              <Input
                placeholder="Ex: Conrado Finzi"
                value={formNome}
                onChange={(e) => setFormNome(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                WhatsApp com DDD *
              </Label>
              <Input
                placeholder="Ex: (34) 99781-7660 ou 34997817660"
                value={formTelefone}
                onChange={(e) => setFormTelefone(e.target.value)}
                className="h-9 text-xs font-mono"
              />
              <span className="text-[10px] text-slate-400">
                O número será normalizado e validado automaticamente com código do país 55.
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Cargo / Papel
                </Label>
                <Input
                  placeholder="Ex: Diretor Executivo"
                  value={formPapel}
                  onChange={(e) => setFormPapel(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Empresa / Tenant
                </Label>
                <Input
                  placeholder="Ex: geracao-digital"
                  value={formClientId}
                  onChange={(e) => setFormClientId(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setModalUsuarioAberto(false)}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              size="sm"
              onClick={() => salvarUsuarioMutation.mutate()}
              disabled={salvarUsuarioMutation.isPending || !formNome.trim() || !formTelefone.trim()}
              className="bg-purple-600 hover:bg-purple-700 text-white text-xs gap-1.5"
            >
              <Save className="h-3.5 w-3.5" />
              {salvarUsuarioMutation.isPending ? "Salvando..." : "Salvar Número"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}
export default GeracaoDigitalGoclawConfig;
